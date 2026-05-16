# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — lance Vite en mode dev (HMR).
- `npm run build` — build statique dans `dist/` (utilise `base: '/glougloubus_scene_config/'` pour GitHub Pages).
- `npm run preview` — sert le build localement.

Pas de tests, linter ou typecheck configurés. Déploiement automatique via `.github/workflows/deploy.yml` sur push `main`/`master` vers GitHub Pages.

## Architecture

Éditeur de scènes pour une matrice LED **192×32** (24 panneaux 16×16 en grille 12×2). Application web vanilla JS à page unique servie par Vite, utilisable en ligne ou streamée via Web Bluetooth vers un appareil BLE nommé `glougloubus`.

### Layout des fichiers

À la racine : `index.html`, `main.js` (~3700 lignes — état + DOM refs + interactions + rendu + export + BLE + handlers timeline/props/opacité/transform), `style.css` (entry qui ne fait que `@import` les fichiers de `styles/`).

- `modules/` — utilitaires extraits :
  - `easing.js` — `applyEasing`, `bounceOut`
  - `led-mapping.js` — `WIDTH`/`HEIGHT` (192/32), `mapToLedIndex`, `hslToRgb`
  - `gif-encoder.js` — `GifEncoder` + `lzwEncode`
  - `image-process.js` — Floyd-Steinberg, médian-cut, `nearestColor` / `nearestPaletteIdx`
  - `sheet.js` — bottom-sheet UI (drag handle + tabs + `sheetAutoOpen(item)`)
  - `scene.js` — modèle de données v3 : `createObject`, `setKeyframe`, `getValueAt`, `setPropertyAtFrame`, `materialize(obj, f)`, et helpers `makeTextObject` / `makeImageObject` / `makeDrawingObject` / `makeShapeObject` / `makePacmanObject`.
  - `timeline-global.js` — `renderGlobalTimeline()` stateless : règle, lanes par track, dots, viewport pan, drag/scrub, menus contextuels.
  - `layers-panel.js` — `renderLayersPanel()` stateless : liste des calques, drag-reorder, group/ungroup.
- `styles/` — `base.css` (tokens, reset, formulaires, modal, iconbtn + état `aria-pressed`), `layout.css` (app-shell + chrome + timeline ruler/lanes/pan-bar), `sheet.css` (bottom sheet et son contenu, kf-menu contextuel partagé timeline+calques).
- `public/` — `pacman.svg` (icône bouton outil), `favicon.svg`, `icons.svg`, `manifest.webmanifest`, `sw.js`.

Le dossier `src/` contient du scaffolding Vite **non utilisé** — ignorer.

### Pattern Vite pour les CSS

Le CSS est importé depuis `main.js` via `import './style.css'`, pas via `<link rel="stylesheet">`. En dev, Vite sert le CSS comme un module HMR-aware : un `<link>` recevrait du JS et n'appliquerait pas les styles. Pour la même raison, `style.css` peut faire `@import url('./styles/...')` qui sont inlinés au build.

### UI mobile-first

Layout en CSS Grid (`.app-shell`) sur 4 lignes : `topbar | stage (1fr) | dock | strip`, plus une bottom-sheet en `position: fixed` qui s'ouvre/se ferme via drag du handle ou clic onglet. Tap sur un item dans le canvas → la sheet s'auto-ouvre sur l'onglet pertinent (`text` / `image` / `props`) via `sheetAutoOpen()` appelé depuis `updateSelectionUI()`.

La hauteur du canvas est limitée par l'aspect 6:1 et la largeur de l'écran (sur portrait phone le canvas reste fin) ; la variable CSS `--stage-h` calcule l'espace dispo et capture une largeur max via `min(100%, calc(var(--stage-h) * 6))`.

Onglets de la sheet (ordre) : `timeline`, `layers`, `props`, `text`, `image`, `export`, `project`. Pas d'onglet « Anim » — la timeline globale (onglet `timeline`) sert d'éditeur d'animation. Les presets (scroll/blink/fade) ont aussi été retirés avec cet onglet.

**Contrôles tactiles Android** : un handler global `contextmenu` dans `init()` fait `preventDefault()` sauf sur les `input/textarea/[contenteditable]`, ce qui bloque le menu « Télécharger / Partager / Imprimer » qui parasitait les long-press sur canvas/images. Le canvas et les vignettes stock ont aussi `-webkit-touch-callout: none`. Tous les boutons interactifs visent au moins ~32px de cible tappable.

### Service Worker

`public/sw.js` (cache `glougloubus-v2`) est enregistré **uniquement en build** : `registerPwa()` skip le `register()` quand `import.meta.env.DEV` et désinscrit tout SW existant. Un bootstrap inline dans `index.html` désinstalle aussi l'ancien SW v1 (cache-first cassait les hot updates et bloquait les nouveaux assets) au premier load et reload une fois.

Si tu changes l'app shell servi en prod (chemins de fichiers), bumper `CACHE` dans `sw.js` pour forcer l'eviction côté clients.

### Modèle de données (v3)

`project = { version, fps, frameCount, objects[], imageDataUrls{}, recentColors[] }`. Les **objets** vivent dans `project.objects[]` (l'ordre du tableau = z-order ascendant) et persistent à travers toute la timeline. Une frame n'est PAS un container d'items — c'est juste un index temporel utilisé pour évaluer les tracks.

Chaque objet a la forme :
```
{ id, type, name, locked, hidden, parentId?,
  static: { /* propriétés non-animables : text, font, points, shape, imgId, color (pacman), flipX, flipY */ },
  tracks: { propName: [ { f, v, easing }, ... ] sorted by f, ... } }
```

Types : `text`, `image`, `drawing` (pencil), `shape` (line / rect / rect-outline / ellipse), `pacman`, `group`. Les helpers `make*Object` dans `modules/scene.js` posent les keyframes initiaux. Note importante : chaque helper pose maintenant un `rotation = 0` à la création pour que la lane rotation ne soit pas vide à la sélection.

Pour évaluer la scène à une frame `f`, `materialize(obj, f)` retourne un item plat compatible avec `drawItem(ctx, item)` : il échantillonne chaque track via `getValueAt(track, f, default)`. C'est le seul pont entre le modèle (objets/tracks) et le rendu.

`setPropertyAtFrame(obj, prop, f, v)` : à `f === 0` ou si la track est vide, met juste à jour la valeur de référence ; à `f > 0`, pose un nouveau keyframe → la modification devient automatiquement une animation.

### Pipeline de rendu

1. `drawFrameToContext(ctx, frameIndex)` — pour chaque `obj` dans `project.objects[]`, appelle `materialize(obj, frameIndex)` pour obtenir un item plat, puis `drawItem(ctx, item)`. Le fond est `#050505`.
2. `drawItem(ctx, item)` — applique opacité, rotation et flip (sauf pour pacman : voir plus bas), puis délègue au handler par type.
3. `renderCanvas()` — rend la frame courante sur un **offscreen canvas 192×32**, lit l'`ImageData`, puis redessine chaque pixel logique comme un **disque** sur `led-canvas` (960×160) pour simuler des LEDs discrètes avec gap. Les handles de resize / le cadre de sélection / la rotation handle sont dessinés **par-dessus** la grille LED en coordonnées écran.

Toujours convertir les coordonnées souris via `getCanvasCoords()` — il mappe les pixels CSS vers l'espace logique 192×32. Pour les items rotatés/flippés, `inverseItemTransform()` ramène le point cliqué dans le repère local de l'item avant hit-test.

**Cas spécial Pacman** : la transform canvas rotation+flip est court-circuitée pour le pacman dans `drawItem`. La rotation est appliquée en interne dans `drawPacman` (variable `dir`) sur le corps uniquement, pour ne pas faire tourner la trace mangée et les miettes qui vivent en espace monde. Le **flip** est appliqué au **niveau des données** dans `materialize` (cas `pacman`) : on miroir les positions de la trace autour de `(item.x, item.y)`. C'est obligatoire parce que `drawPacman` fait des `getImageData(px, py)` en coordonnées brutes pour détecter ce qu'il « mange » — une transform canvas désynchroniserait lecture pixel et tracé.

**Pacman invisible (opacity = 0)** : `drawItem` ne fait PAS un retour précoce sur opacity ≤ 0 pour le pacman — il appelle `drawPacman(ctx, item, /* bodyHidden */ true)` qui exécute uniquement l'étape « eating » (effacement BG le long du trajet), pas le corps/œil/miettes. Sinon le contenu déjà mangé sous la trace ré-apparaîtrait dès qu'on décoche Visible.

### Export `.bin` et mapping LED physique

`mapToLedIndex(col, row)` convertit les coordonnées logiques vers l'**index LED physique** dans la chaîne matérielle. C'est du serpentin :
- 24 panneaux 16×16 arrangés 12 colonnes × 2 lignes, indexés de droite à gauche et de bas en haut.
- Dans chaque panneau, les rangées sont inversées verticalement et alternent direction (rangée paire : droite→gauche, rangée impaire : gauche→droite).

Cette logique est partagée **à l'identique** par `exportToBin()` (téléchargement local via File System Access API) et `streamToBle()`. Toute modification doit être appliquée aux deux endroits. Le format `.bin` est un flux brut RGB (3 octets/pixel, 192×32×3 = 18432 octets par frame) concaténé sans header.

### BLE

UUIDs définis en haut de `main.js`. Protocole : `videoControlCharacteristic.writeValue([1])` pour START, envoi des données par chunks de 500 octets sur `videoDataCharacteristic`, puis `writeValue([0])` pour STOP. Nécessite un navigateur supportant Web Bluetooth (Chrome/Edge desktop ou Chrome Android).

### Timeline globale

Rendue par `renderGlobalTimeline(container, { project, currentFrame, selectedObj, viewStart, viewFrames, callbacks })` (module `timeline-global.js`). Composants :
- **Pan-bar** (visible seulement si toute la timeline ne tient pas dans la fenêtre courante) : 6 boutons `⏮ ⏪ ◀ info ▶ ⏩ ⏭` tappables (~30 px). `⏮/⏭` : saut au début/fin via callback `onJumpTo(f)`. `⏪/⏩` : pan ± 10 s (= 10 × fps). `◀/▶` : pan ± demi-fenêtre. Long-press → auto-repeat 180 ms pour les pans (pas pour les jumps). Labels affichés en **secondes** (`fmtTime(f, fps)`), pas en frames.
- **Ruler** avec ticks à chaque frame visible, label tous les 1/5/10/20 selon la densité. Le label du dernier tick a la classe `.gtl-tick-label-end` qui le réaligne à gauche du tick pour ne pas déborder du ruler.
- **Lanes** par track (`x`, `y`, `size`/`scale`, `rotation`, `color`, `opacity`, etc.) — dots positionnés en %.
- **Playhead** vertical sur ruler et chaque lane (uniquement dans la fenêtre visible).

État du viewport côté `main.js` :
- `timelineViewStart` : index frame du début du viewport.
- `timelineViewSeconds` : durée affichée en secondes (paramétrable via l'input `#timeline-view-seconds` dans la pan-bar de l'onglet Timeline ; défaut 3 s).
- `getTimelineMaxVisible()` retourne `round(timelineViewSeconds × fps)` à chaque appel → le viewport s'adapte automatiquement à un changement de FPS.
- `computeTimelineView()` clampe seulement (pas d'auto-follow à chaque rendu, sinon le pan manuel se ferait écraser).
- `ensurePlayheadVisible()` : smooth-follow (shift d'1 frame), utilisé par la nav clavier et `onJumpTo`.
- `pageViewToPlayhead()` : page-step (saut d'une fenêtre entière, playhead atterrit au début du nouveau viewport), utilisé par la **boucle de lecture** uniquement.
- `panTimelineBy(delta)` : pan manuel ; **déplace aussi `currentFrameIndex` du même delta** pour que le playhead garde sa position relative dans la fenêtre — évite la désync (où le viewport se ferait re-snapper sur le playhead orphelin).
- `playheadPctInView()` : position % viewport-relative du playhead, utilisée par la maj cheap pendant la lecture.

**Important** : le viewport casse l'hypothèse « f / frameCount = position ». Toute coordonnée frame↔position passe par `pct(f, viewStart, viewFrames)` ou `clientXToFrame(rect, x, vs, vf, frameCount)`. Lors d'un ajout de feature touchant la timeline (rendu, hit-test, drag), penser à propager `vs`/`vf`.

**Auto-repeat des boutons pan** : les timers (`_panStopTimer` + `_panRepeatTimer`) sont au niveau **module**, pas locaux au bouton. À chaque fire, `renderTimeline()` détruit le bouton qui hébergerait un timer local → boucle infinie (timer orphelin que rien n'arrête, parce que son `pointerup` listener est lui aussi détruit). Cleanup global via deux listeners `pointerup` / `pointercancel` attachés à `window` au chargement du module → `stopPanRepeat()`.

**Bug evité dans `attachScrub`** : le premier `seek` déclenche un `renderTimeline()` côté host qui détruit l'élément ruler (`innerHTML = ''`). Si les listeners `pointermove`/`pointerup` sont attachés sur le ruler, ils partent en orphelin et le drag se casse. Solution : capturer `rect` au pointerdown et attacher move/up sur `window`. Même pattern dans `attachLaneInteraction` et dans `buildDot`.

Menus contextuels (clic droit ou long-press sur tablette) :
- **Sur un dot keyframe** : Supprimer + choix d'easing (linear / ease-in / ease-out / ease-in-out / bounce). Le handler appelle `e.stopPropagation()` pour ne pas remonter au menu frame-level.
- **Sur ruler / lane vide** : Dupliquer la frame (avec timestamp), Supprimer la frame (avec timestamp), Vider les keyframes à `<temps>` (objet sélectionné seulement), Vider tous les keyframes (idem). Les labels affichent le temps en secondes, pas la frame.

Les menus partagent les classes CSS `.kf-menu` / `.kf-menu-item` / `.kf-menu-sep` définies dans `styles/sheet.css`. Le module `layers-panel.js` les réutilise aussi — ne pas supprimer ce CSS même si les noms ressemblent à de l'orphelin.

**Contrainte de débordement** : `.gtl-root` a `overflow-x: hidden` + `min-width: 0` ; `.gtl-view-info` a `text-overflow: ellipsis` ; `.gtl-tick-label` a `white-space: nowrap`. Les labels de temps avec décimales (« 1.55s ») ne peuvent plus déclencher une scrollbar horizontale sur petit écran.

### Interaction et sélection

- **Sélection primaire** : `selectedItemId` (un seul). **Multi-sélection** : `selectedIds` (Set). `findItemAtCoord` teste les items du dernier au premier (top-most).
- L'outil **Pencil / Line / Rect / Ellipse / Bucket** crée des objets de type `drawing` ou `shape`. Le sous-outil dessin est sélectionné via le dropdown `#draw-dropdown` (clic sur le bouton ✏️ ouvre le menu).
- L'outil **Pacman** : drag = définit point de départ → point d'arrivée du trajet (durée par défaut 20 frames, étend `frameCount` si nécessaire). Une fois le pacman posé, `setTool('select')` ramène automatiquement à la sélection pour que l'utilisateur puisse directement manipuler l'objet.
- **Onglet Props** : rotation (champ + reset), flip H/V (état `aria-pressed` reflète `item.flipX/flipY`), alignement (3 sous-groupes : centrage, bords, distribution), slider de taille unifié (texte=size, image=scale, pacman=size, range logarithmique), slider d'**opacité** + checkbox `Visible` qui force opacité à 0 (la dernière valeur > 0 est mémorisée dans `dataset.lastOpacity` pour restauration). L'ensemble du pane est compacté (CSS `.transform-grid .iconbtn` à 30 × 30 px, sliders à 30 px de haut au lieu de `--tap-min`) pour gagner ~80–100 px de hauteur sur portrait phone.
- Les modifications d'inputs du panneau Tools mettent à jour en live l'item sélectionné via `updateObjectProp(obj, prop, value)` qui route vers `setPropertyAtFrame` pour les props animables ou `obj.static[prop]` pour les autres.

### Ajout / suppression de frames

- `addFrame(count = 1)` étend `frameCount` de N (utilisé par le popup `#add-frames-modal` accessible via le bouton `+` de la timeline : saisie en secondes, conversion live en frames selon le FPS courant).
- `duplicateFrameAt(f)` / `deleteFrameAt(f)` paramétrés par frame ; les wrappers `duplicateFrame()` / `deleteFrame()` les appellent avec `currentFrameIndex`. Les versions paramétrées sont aussi appelées depuis le menu contextuel timeline.
- `clearKeyframesOfSelected()` : « gèle » l'objet sélectionné — pour chaque track, capture la valeur à la frame courante via `getValueAt` et la réécrit comme unique keyframe à `f=0`. L'apparence est préservée, l'animation est supprimée.
- `clearKeyframesOfSelectedAtFrame(f)` : coupe chirurgicale — filtre `k.f !== f` sur toutes les tracks de l'objet, sans shift.

### Bucket fill tolérant

`bucketFillAt(x, y, color)` (flood-fill 4-connected) compare les pixels du fond à la cible avec une **tolérance de 3 par canal** (`Math.abs(d[i] - tr) > TOL`). Pourquoi : sur fond uniforme, en pratique des drifts subtils (compositing GPU, color management sur certains Android) peuvent laisser quelques pixels à (6,5,5) au lieu de (5,5,5). Une comparaison exacte laissait alors des trous dans le remplissage sur un projet neuf. La tolérance reste largement assez basse pour ne pas confondre deux couleurs intentionnellement différentes.
