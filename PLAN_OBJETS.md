# Plan — refonte de la gestion des objets

> Décisions actées avec l'utilisateur :
> - **Modèle de données** : passage à un modèle **scène + timeline** (un objet existe globalement et porte des keyframes par propriété), au lieu d'items dupliqués par frame.
> - **Compat ancien format** : aucune. On repart from scratch (autosave en localStorage purgée, anciens .json non chargeables).
> - **Scope** : layers UI, multi-sélection + groupes, transforms avancés, et fix du bug de tracé lié au zoom.

## État d'avancement

| Phase | Sujet | Statut |
|---|---|---|
| 0 | Quick fix bug de tracé | ✅ **Fait** |
| 1 | Nouveau modèle de données + moteur d'évaluation | ✅ **Fait** |
| 2 | Animations via keyframes (UI mini-timelines) | ✅ **Fait** |
| 3 | Panneau de calques | ✅ **Fait** |
| 4 | Multi-sélection + groupes | ✅ **Fait** |
| 5 | Transforms avancés (rotation, flip, alignement) | ✅ **Fait** |
| 6 | Timeline visuelle complète | ⏳ Non démarré (optionnel) |

**Bonus livrés en route** (hors plan initial) :
- Fix CSS aspect-ratio : le `<canvas>` porte désormais `aspect-ratio: 192/32` directement (au lieu du `.canvas-container`), supprimant le letterbox horizontal causé par le `padding/border` du container. Combinaison avec le fix `Math.floor` → clic = pixel attendu sous le doigt, partout.
- Fix zoom : `transform-origin: center`, `setZoom` zoome au centre du wrapper si pas d'ancrage curseur (boutons +/-), `.canvas-wrapper` passe en `flex: 1` pour utiliser toute la hauteur disponible. Plus de crop prématuré au coin haut-gauche.

---

## 1. Diagnostic actuel

### Modèle de données existant

```js
frames = [
  [item, item, ...],   // frame 0
  [item, item, ...],   // frame 1
  ...
]
```

Chaque frame contient ses items (texte / image / drawing / shape). Les animations sont **générées** : `generateAnimation()` produit N frames avec des items interpolés. Les items conservent le même `id` à travers les frames pour permettre le re-matching, mais c'est fragile :
- `duplicateFrame()` regénère des nouveaux ids → casse la chaîne d'animation
- éditer "le même objet" sur 5 frames = éditer 5 items différents à la main
- le z-order est implicite (ordre du tableau), pas d'UI

### Pain points relevés

| # | Symptôme | Cause |
|---|---|---|
| P1 | Bug de tracé : le point peint est à droite du clic, surtout en zoom | `Math.round(x)` mappe la moitié droite d'une cellule LED vers la cellule suivante. Devrait être `Math.floor(x)` pour convertir une coordonnée flottante en index de cellule. |
| P2 | Pas de panneau de calques | Pas d'UI pour réordonner / nommer / cacher / verrouiller |
| P3 | Sélection difficile sur recouvrements | Click prend le top-most, pas de "cycle through" ni de moyen de sélectionner un item caché derrière |
| P4 | Édition multi-frame pénible | Modifier un objet sur N frames = N copier-coller |
| P5 | Pas de multi-sélection ni de groupes | `selectedItemId` est unique |
| P6 | Pas de rotation, flip, alignement | Le seul transform est resize via 4 handles |

---

## 2. Cible — nouveau modèle de données

### Schéma

```js
project = {
  version: 3,                    // marqueur du nouveau format
  width: 192, height: 32,
  fps: 20,
  frameCount: 60,                // longueur de la timeline en frames
  objects: [
    {
      id: 'obj_xxx',
      name: 'Texte 1',           // user-éditable
      type: 'text',              // 'text' | 'image' | 'drawing' | 'shape' | 'group'
      visible: true,
      locked: false,
      parentId: null,            // pour groupes
      // propriétés statiques (jamais animées)
      static: {
        text: 'HELLO',           // pour text
        font: 'JetBrains Mono',
        imgId: null,             // pour image
        shape: 'rect',           // pour shape
        points: [...]            // pour drawing
      },
      // propriétés animables — chacune est un tableau de keyframes triés par f
      tracks: {
        x:        [{ f: 0, v: 10, easing: 'linear' }, { f: 30, v: 100, easing: 'ease-in-out' }],
        y:        [{ f: 0, v: 5 }],
        size:     [{ f: 0, v: 16 }],
        scale:    [{ f: 0, v: 1.0 }],
        color:    [{ f: 0, v: '#ff0000' }, { f: 30, v: '#00ff00' }],
        opacity:  [{ f: 0, v: 1.0 }],
        rotation: [{ f: 0, v: 0 }]
      },
      // visibilité par range de frames (pour blink, intermittence)
      visibleRanges: [[0, 60]]   // [[startF, endF], ...] inclusive both ends
    },
    ...
  ],
  groups: [],                    // optionnel : ids triés par appartenance
  imageDataUrls: { 'imgxxx': 'data:image/png;base64,...' },
  recentColors: [...],
}
```

**Avantages** :
- Un objet = une entité. Tu le modifies à un endroit, ça impacte toute la timeline.
- L'animation = ajouter/déplacer des keyframes. Plus de "régénérer N frames".
- Le z-order = position dans `objects[]` (réordonnable depuis le panneau de calques).
- `parentId` permet les groupes naturels (groupe = pseudo-objet de type `'group'` avec ses propres tracks).

### Évaluation à une frame donnée

Une fonction pure `evaluateScene(project, frameIndex) → renderableItems[]` :
- pour chaque `object`, trouve les valeurs interpolées de chaque track au temps `f = frameIndex`
- applique les transforms hérités du parent (groupes)
- filtre via `visibleRanges` et `visible` flag
- retourne la liste à rasteriser, dans l'ordre de `objects[]`

Cette fonction remplace l'accès direct à `frames[currentFrameIndex]` partout.

### Interpolation par track

Chaque track a son interpolateur :
- `x`, `y`, `size`, `scale`, `opacity`, `rotation` → linear / easing function entre keyframes adjacents
- `color` → interpolation RGB (déjà implémentée)
- `text`, `font`, `shape` → propriétés statiques (pas dans tracks, dans `static`)
- `points` (drawing) → statique, pas animable

---

## 3. Plan d'exécution par phases

Chaque phase est shippable indépendamment. Phase 0 = quick fix isolé. Les phases 1-2 cassent la compat (volontaire). Les phases 3-6 ajoutent par-dessus.

### Phase 0 — Quick fix : bug de tracé `Math.round` → `Math.floor` 🐛 ✅ FAIT

**Fichiers** : `main.js` autour de `handlePointerDown` (outil pencil) et `handlePointerMove` (push de points).

**Patch appliqué** :
```diff
- points: [{ x: Math.round(x), y: Math.round(y) }]
+ points: [{ x: Math.floor(x), y: Math.floor(y) }]
```
Idem pour `applySnap()` (`Math.floor` au lieu de `Math.round` quand `snapSize ≤ 1`).

**Cause profonde du décalage > 1 px (en plus du `floor`)** : le `<canvas>` était dimensionné en `width: 100%; height: 100%` à l'intérieur d'un `.canvas-container` qui avait `aspect-ratio: 192/32` mais aussi `padding: 4px + border: 2px`, donc la content box n'était PAS en 6:1. `object-fit: contain` letterboxait le canvas, et `getCanvasCoords` mappait sur `rect.width` du DOM (pas la zone de bitmap visible). Fix : `aspect-ratio: 192/32` est maintenant porté par le canvas lui-même (`width: 100%; height: auto`), et `.canvas-container` passe en `box-sizing: border-box`. Plus aucun letterbox.

**Test** : ratio canvas = 6.000 vérifié dans le navigateur. Click sur la première colonne paint bien la colonne 0.

**Effort** : ~15 min initial → ~1 h avec le fix CSS sous-jacent.

---

### Phase 1 — Nouveau modèle de données + moteur d'évaluation ✅ FAIT

**Objectif (atteint)** : remplacer `frames[]` par `project.objects[]` avec tracks. Toute la lecture pour rendu/export passe par `evaluateScene()`.

**Fichiers livrés** :
- ✅ `modules/scene.js` — `createEmptyProject`, `createObject`, `setKeyframe`, `removeKeyframe`, `getValueAt` (interpolation linéaire + easing + interp hex pour couleurs), `setPropertyAtFrame` (statique vs animé), `evaluateScene`, helpers `makeText/Image/Drawing/ShapeObject`.
- ❌ `modules/migration.js` non créé : pas utile vu qu'on ne supporte pas l'ancien format. Le rejet de l'ancien format se fait directement dans `loadProjectFromObject`.

**Fichiers touchés** :
- `main.js` :
  - ✅ `frames[]` retiré, `project = createEmptyProject(...)` à la place. `currentFrameIndex` reste un simple curseur.
  - ✅ `renderCanvas()` / `drawFrameToContext` lisent `evaluateScene(project, f)`.
  - ✅ Tous les outils (text, image, pencil, bucket, shapes) créent des **objets** via `make…Object` puis `project.objects.push(obj)`.
  - ✅ `findItemAtCoord` itère `evaluateScene` et respecte `obj.locked` (préparation pour Phase 3).
  - ✅ Drag/resize/pinch/nudge passent par `updateObjectProp(obj, prop, value)` qui décide statique vs keyframe automatiquement.
  - ✅ Frame ops : `addFrame`/`duplicateFrame` → `frameCount++`, `deleteFrame` retire les keyframes à la frame courante et shift les suivants, `clearCurrentFrame` retire les objets visibles à cette frame, drag-réordonnage de frame → `shiftKeyframesForReorder`.
- ✅ `generateAnimation` : pose 2 keyframes (start/end) sur `x/y/color` au lieu de dupliquer N frames.
- ✅ Presets : `presetScroll` ré-appelle `generateAnimation`. `presetBlink` pose 8 keyframes opacity step (1/0/1/0…). `presetFade` pose 2 keyframes opacity (0→1 ou 1→0).
- ✅ Undo/redo snapshot tout `project` (JSON).
- ✅ `serializeProject` / `loadProjectFromObject` : format v3 (`SCENE_VERSION = 3`). Refus explicite des anciens formats avec toast.
- ✅ Autosave : clé `glougloubus-autosave-v3` (anciennes purgées au boot).
- ✅ `imageDataUrls` migré dans `project.imageDataUrls` (sérialisé direct).
- ✅ `recentColors` migré dans `project.recentColors`.
- ✅ Copy/paste shortcut clone l'objet entier et décale via keyframe à la frame courante.

**Test exécuté** : ajout texte "HELLO" → 60k pixels lumineux. Outil pencil → tracé visible. Frames add/dup/del → 1→2→3→2 thumbs.

**Effort réel** : ~1 jour.

---

### Phase 2 — Animations via keyframes

**Objectif** : remplacer `generateAnimation()` (qui dupliquait des frames) par une vraie édition de keyframes.

**Comportement** :
- Sélectionner un objet → onglet "Anim" du bottom-sheet montre :
  - liste des tracks animées (x, y, color, etc.) avec mini-timelines
  - bouton "+" sur chaque track → ajoute un keyframe à `currentFrameIndex` avec la valeur courante
  - les keyframes existants sont représentés comme des points cliquables sur la mini-timeline (clic → seek + sélection)
- Drag d'un keyframe horizontal pour changer son `f` (frame index)
- Click droit / long-press sur un keyframe → menu (delete, change easing)
- Le bouton "Generate" disparaît (remplacé par "Add keyframe at current frame")

**Presets** (Scroll, Blink, Fade) : réécrits pour insérer 2 keyframes (start + end) directement, plus de génération de frames.

**Fichiers nouveaux** :
- `modules/keyframe-editor.js` — UI mini-timeline par track

**Test** : ajouter 2 keyframes sur `x` (f=0 → x=10, f=30 → x=100), vérifier que l'objet glisse de gauche à droite quand on scrub la timeline.

**Effort** : ~1 jour.

---

### Phase 3 — Panneau de calques ✅ FAIT

**Objectif (atteint)** : un panneau listant les objets, avec drag pour réordonner (z-order), lock, hide, rename.

**Livré** :
- ✅ Nouvel onglet "🗂 Calques" en première position dans le bottom-sheet (actif par défaut).
- ✅ `modules/layers-panel.js` : rendu stateless de la liste, callbacks pour toutes les actions.
- ✅ Liste affichée dans l'ordre **avant-plan d'abord** (inverse de `project.objects[]`).
- ✅ Par row : poignée drag `⠿`, toggle visibilité (👁/⌀), toggle lock (🔒/🔓), icône type, nom, bouton menu `⋯`.
- ✅ **Drag-to-reorder** via pointer events (compatible touch, pas HTML5 dnd) avec indicateur visuel `drop-target`.
- ✅ **Rename** inline via dblclick sur le nom (ou via menu ⋯).
- ✅ **Menu ⋯** : Renommer, Dupliquer, Mettre en avant/arrière, Supprimer.
- ✅ **Toolbar** au-dessus de la liste : ▲ ▼ ⎘ 🗑 (opèrent sur la sélection courante).
- ✅ **Highlight** de la sélection courante (border bleu) — bidirectionnel : tap row = select, sélection canvas = highlight row.
- ✅ `findItemAtCoord` filtre déjà `obj.locked` (Phase 1) → click canvas ignore les calques verrouillés.
- ✅ Noms par défaut intelligents : `"HELLO"` pour text, `Rectangle`/`Ligne`/etc. pour shapes, `Image`/`Tracé`.

**À noter** : les groupes (objet `type: 'group'`, `parentId`) sont prévus dans le schéma mais le rendu hiérarchique avec indentation est laissé à la **Phase 4** (multi-sélection + groupes).

**UI** : nouvel onglet **"Calques"** (ou "Layers") dans le bottom-sheet, premier dans la liste.

**Layout** :
```
[ ⠿ ]  [👁]  [🔒]  Texte HELLO         [⋯]
[ ⠿ ]  [👁]  [🔒]  Image bus            [⋯]
[ ⠿ ]  [👁]  [🔒]  📁 Groupe (3)        [⋯]
            └─ [👁]  [🔒]  Cercle rouge   [⋯]
            └─ [👁]  [🔒]  Cercle vert    [⋯]
            └─ [👁]  [🔒]  Cercle bleu    [⋯]
```

- `⠿` = drag handle pour réordonner
- `👁` = visible toggle (modifie `object.visible`)
- `🔒` = lock toggle (modifie `object.locked` — empêche sélection sur le canvas)
- nom cliquable → édition inline
- `⋯` menu : duplicate, delete, group with selection, send to top/bottom

**Fichiers nouveaux** :
- `modules/layers-panel.js` — render de la liste + handlers drag/click

**Test** : créer 3 objets, les réordonner par drag, lock l'arrière-plan, vérifier qu'on ne peut plus le sélectionner sur le canvas.

**Effort** : ~1 jour.

---

### Phase 4 — Multi-sélection + groupes ✅ FAIT

**Objectif (atteint)** : sélectionner plusieurs objets pour les déplacer/grouper/aligner.

**Livré** :
- ✅ État `selectedIds: Set<string>` source de vérité, `selectedItemId` cache du primary (= dernier ajouté).
- ✅ Helpers `setSingleSelection`, `clearSelection`, `addSelection`, `removeFromSelection`, `toggleSelection`, `syncPrimaryFromSet`.
- ✅ Tap canvas : remplace la sélection ; Shift-click : toggle dans la sélection (additif).
- ✅ **Drag groupé** : tous les objets sélectionnés bougent ensemble du même delta. Capture des positions de départ par objet au pointerdown via `groupDragStarts`.
- ✅ **Marquee selection** : drag dans le vide avec l'outil select → rectangle de sélection rubber-band, sélectionne tous les objets dont les bounds intersectent. Shift-drag pour ajouter à la sélection existante.
- ✅ **Suppression groupée** : Delete supprime tous les sélectionnés.
- ✅ **Nudge groupé** : flèches clavier déplacent tous les sélectionnés.
- ✅ **Layers panel** multi-select : Shift/Ctrl-click toggle un calque, sélection visible sur toutes les rows highlightées simultanément.
- ✅ Selection box rendering : box pleine bleue sur le primary, box pointillée plus discrète sur les secondaires. Resize handles uniquement si sélection unique (text/image).
- ✅ **Groupes** : type `'group'` avec ses propres tracks `x/y/opacity`. Enfants référencent via `parentId`. `evaluateScene` accumule les transforms parents en cascade.
- ✅ Boutons `📁` Group / `📂` Ungroup dans le toolbar layers. Group disponible si ≥2 objets sélectionnés. Ungroup démantèle le groupe sélectionné OU détache les enfants sélectionnés de leur parent.
- ✅ **Render hiérarchique** dans le panel : groupes affichés avec teint violet, enfants indentés (14px par niveau de profondeur, ligne verticale de gauche). Algorithme `buildVisualOrder` qui place chaque enfant juste après son parent dans l'affichage.

**Limitations connues** (acceptables pour cette itération) :
- L'ungroup ne "bake" pas le transform du parent dans les positions des enfants : ils retrouvent leurs coordonnées locales (sans le décalage hérité du groupe).
- Pas de drag-to-reorder hiérarchique : drag d'un enfant peut le sortir de l'ordre attendu, mais préserve son `parentId`. Pour détacher, passer par `📂 Dégrouper`.
- Click direct sur un enfant dans le canvas sélectionne l'enfant (pas le groupe parent). Pour éditer le groupe, le sélectionner via le panel.

**Comportement** :
- État : `selectedItemId` → `selectedIds: Set<string>`
- Tap sur un item : sélection unique (remplace)
- Tap avec modifier (Shift, ou via le panneau de calques avec Ctrl) : ajoute/retire de la sélection
- Outil sélection rectangulaire : drag dans le vide → marquee box, sélectionne tous les objets dans la box
- Drag d'un item sélectionné : tous les objets sélectionnés bougent ensemble
- Suppression : supprime tous les objets sélectionnés
- Bouton "Group" dans la sheet → crée un objet `type: 'group'` avec `parentId` mis à jour sur tous les sélectionnés
- Bouton "Ungroup" → casse le groupe, restaure `parentId: null`

**Note z-order** : un groupe a sa propre position dans `objects[]` ; ses enfants sont rendus AU-DESSUS de leur position dans la liste mais en respectant leur ordre relatif. À détailler dans `evaluateScene`.

**Effort** : ~1 jour.

---

### Phase 5 — Transforms avancés ✅ FAIT

**Objectif (atteint)** : rotation animable, flip H/V statique, alignement, distribution, snap-aux-objets.

**Livré** :
- ✅ Track `rotation` (degrés) animable, intégré dans `materialize` et exposé dans l'éditeur de keyframes pour text/image/drawing/shape.
- ✅ Statics `flipX`/`flipY` booleans sur tous les types non-group, sérialisés via `obj.static`.
- ✅ `drawItem` applique rotation + flip via `ctx.translate / rotate / scale` autour du centre du bbox unrotaté. Hit-test (`findItemAtCoord`) fait l'inverse-transform du clic pour respecter la rotation/flip.
- ✅ **Selection box rotée** : 4 coins dessinés via `getRotatedCorners`, suit la rotation visuellement.
- ✅ **Handle de rotation** : cercle bleu au-dessus du bbox (relié par une ligne au milieu de l'arête supérieure rotée). Drag le cercle pour modifier `rotation`. Maintenir Shift = pas de 15°.
- ✅ Resize handles : dessinés et hit-testés UNIQUEMENT si `rotation === 0` (limitation acceptée pour rester simple).
- ✅ Onglet "Props" enrichi avec :
  - input numérique `Rotation` + bouton reset
  - boutons Flip horizontal / vertical
  - boutons Align L/centerH/R/T/centerV/B (1 sélectionné → canvas 192×32, ≥2 → bbox commun)
  - boutons Distribute H/V (besoin ≥3 sélectionnés)
  - toggle "Snap objets" : magnétisme sur bords/centres des autres objets non-sélectionnés pendant un drag (tolérance ~2 px logiques)
- ✅ Helpers `translateObject`, `getCommonBounds`, `computeObjectSnap`. Transformations passent par `updateObjectProp` → keyframe à la frame courante si déjà animé, sinon écrit le statique.
- ✅ Snap-aux-objets utilise un snapshot du bbox du primary au pointerdown (`primaryStartBounds`) projeté du delta brut ; ne se déclenche que sur sélection multiple ou drag d'un primary.

**Limitations connues** :
- Pas de resize sur item rotaté (handles cachés). Reset rotation à 0 pour redimensionner.
- Snap-aux-objets se déclenche depuis la position du primary uniquement (pas une recherche par item de la sélection).
- Pas de flip/rotation sur les groupes pour l'instant.
- Distribution équidistante par centre (les bbox extrêmes restent en place).

**Effort réel** : ~1 jour.

---

### Phase 6 — Timeline visuelle complète

**Objectif** : remplacer la simple frame strip par une timeline scrubbable avec visualisation des keyframes par objet.

**UI** : zone strip transformée en :
- Timeline horizontale avec curseur de frame courante
- Une ligne par objet sélectionné montrant ses keyframes (point par keyframe)
- Drag du curseur pour scrubber
- Clic-droit ou long-press dans la timeline → ajouter keyframe à cet endroit

C'est en gros une fusion de la phase 2 (mini-timelines par track) et de la frame strip actuelle, mais à l'échelle de la timeline globale et non d'un seul track.

**Effort** : ~1 jour. Optionnel — la phase 2 couvre déjà l'essentiel.

---

## 4. Risques et points à surveiller

- **Animation par frame index discret** : on suppose que toutes les frames sont équidistantes en temps (1/fps). Si plus tard tu veux une timeline en secondes, faudra abstraire `f` en `t`.
- **Performance d'évaluation** : `evaluateScene` est appelé pour chaque frame en export (potentiellement des centaines de frames × N objets). Cache les keyframes triés et utilise une recherche binaire pour `getValueAt`.
- **Drawing items lourds** : un drawing avec des milliers de points reste statique (pas dans tracks) mais peut faire grossir le projet. Considérer un `.bin` interne par drawing si ça devient un problème.
- **Groupes imbriqués** : limiter la profondeur (genre max 5) pour éviter les boucles ou les coûts d'évaluation pathologiques.
- **Undo/redo** : le système actuel snapshot `frames`. Avec le nouveau modèle, snapshot `project` (sérialisable JSON). Aucun changement de logique côté undo, juste la structure cible.

---

## 5. Hors scope (pour l'instant)

- Onion skin multi-frames (avant + après) — actuellement seulement avant
- Variables d'expression (objet qui suit la souris, oscillation, etc.)
- Layout responsive de la timeline pour les très longs projets (> 200 frames)
- Sons synchronisés
- Préviz à FPS variable

---

## 6. Ordre de mise en œuvre suggéré

```
Phase 0 (15 min)        — bug fix Math.floor, isolé ✅
   └─ ship en patch
Phase 1 (1-2 j)         — nouveau modèle, casse l'ancien format ✅
Phase 2 (1 j)           — keyframes UI + presets refait ✅
Phase 3 (1 j)           — layers panel ✅
Phase 4 (1 j)           — multi-sélection + groupes ✅
Phase 5 (1-2 j)         — rotation, flip, alignement ✅
Phase 6 (1 j, opt.)     — timeline complète
```

Total : **~6-9 jours de dev**.

Phase 0 peut être livrée tout de suite, indépendamment du reste. Phase 1 est le pivot ; rien après n'a de sens sans elle.
