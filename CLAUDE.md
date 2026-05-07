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

À la racine : `index.html`, `main.js` (entry, ~2240 lignes — état + DOM refs + interactions + rendu + export + BLE), `style.css` (entry qui ne fait que `@import` les fichiers de `styles/`).

- `modules/` — utilitaires extraits (purs, sans état partagé) :
  - `easing.js` — applyEasing + bounceOut
  - `led-mapping.js` — `WIDTH`/`HEIGHT` (192/32), `mapToLedIndex`, `hslToRgb`
  - `gif-encoder.js` — GifEncoder + lzwEncode
  - `image-process.js` — Floyd-Steinberg, médian-cut, nearestColor / nearestPaletteIdx
  - `sheet.js` — bottom-sheet UI (drag handle + tabs + `sheetAutoOpen(item)`)
- `styles/` — `base.css` (tokens, reset, formulaires, modal), `layout.css` (app-shell + chrome), `sheet.css` (bottom sheet et son contenu).

Le dossier `src/` contient du scaffolding Vite **non utilisé** — ignorer.

### Pattern Vite pour les CSS

Le CSS est importé depuis `main.js` via `import './style.css'`, pas via `<link rel="stylesheet">`. En dev, Vite sert le CSS comme un module HMR-aware : un `<link>` recevrait du JS et n'appliquerait pas les styles. Pour la même raison, `style.css` peut faire `@import url('./styles/...')` qui sont inlinés au build.

### UI mobile-first

Layout en CSS Grid (`.app-shell`) sur 4 lignes : `topbar | stage (1fr) | dock | strip`, plus une bottom-sheet en `position: fixed` qui s'ouvre/se ferme via drag du handle ou clic onglet. Tap sur un item dans le canvas → la sheet s'auto-ouvre sur l'onglet pertinent (`text` / `image` / `props`) via `sheetAutoOpen()` appelé depuis `updateSelectionUI()`.

La hauteur du canvas est limitée par l'aspect 6:1 et la largeur de l'écran (sur portrait phone le canvas reste fin) ; la variable CSS `--stage-h` calcule l'espace dispo et capture une largeur max via `min(100%, calc(var(--stage-h) * 6))`.

### Service Worker

`public/sw.js` (cache `glougloubus-v2`) est enregistré **uniquement en build** : `registerPwa()` skip le `register()` quand `import.meta.env.DEV` et désinscrit tout SW existant. Un bootstrap inline dans `index.html` désinstalle aussi l'ancien SW v1 (cache-first cassait les hot updates et bloquait les nouveaux assets) au premier load et reload une fois.

Si tu changes l'app shell servi en prod (chemins de fichiers), bumper `CACHE` dans `sw.js` pour forcer l'eviction côté clients.

### Modèle de données

`frames` est un tableau de frames ; chaque frame est un tableau d'**items** (objets vectoriels, pas un bitmap). Un item a toujours `{ id, type, x, y, ... }` où `type` vaut :
- `text` — `{ text, font, color, size, x, y }`
- `image` — `{ img: HTMLImageElement, x, y, scale }` (la référence `img` n'est pas sérialisable par JSON — voir `duplicateFrame` et `generateAnimation` qui la réattachent manuellement après `JSON.parse(JSON.stringify(...))`).
- `drawing` — `{ color, points: [{x,y},...] }` tracé libre pixel par pixel (outil Pencil).

### Pipeline de rendu

1. `drawFrameToContext(ctx, frameIndex)` — dessine la scène logique en **coordonnées 192×32** dans un canvas cible (fond `#050505`).
2. `renderCanvas()` — rend la frame courante sur un **offscreen canvas 192×32**, lit l'`ImageData`, puis redessine chaque pixel logique comme un **disque** sur `led-canvas` (960×160) pour simuler des LEDs discrètes avec gap. Les handles de resize et le cadre de sélection sont dessinés **par-dessus** la grille LED en coordonnées écran.
3. Les thumbnails de la timeline sont des mini-canvas 192×32 qui utilisent directement `drawFrameToContext`.

Toujours convertir les coordonnées souris via `getCanvasCoords()` — il mappe les pixels CSS vers l'espace logique 192×32.

### Export `.bin` et mapping LED physique

`mapToLedIndex(col, row)` convertit les coordonnées logiques vers l'**index LED physique** dans la chaîne matérielle. C'est du serpentin :
- 24 panneaux 16×16 arrangés 12 colonnes × 2 lignes, indexés de droite à gauche et de bas en haut.
- Dans chaque panneau, les rangées sont inversées verticalement et alternent direction (rangée paire : droite→gauche, rangée impaire : gauche→droite).

Cette logique est partagée **à l'identique** par `exportToBin()` (téléchargement local via File System Access API) et `streamToBle()`. Toute modification doit être appliquée aux deux endroits. Le format `.bin` est un flux brut RGB (3 octets/pixel, 192×32×3 = 18432 octets par frame) concaténé sans header.

### BLE

UUIDs définis en haut de `main.js`. Protocole : `videoControlCharacteristic.writeValue([1])` pour START, envoi des données par chunks de 500 octets sur `videoDataCharacteristic`, puis `writeValue([0])` pour STOP. Nécessite un navigateur supportant Web Bluetooth (Chrome/Edge desktop).

### Interaction et sélection

- Un seul item sélectionné à la fois (`selectedItemId`). `findItemAtCoord` teste les items du dernier au premier (top-most).
- L'outil Pencil crée un item `drawing` et y pousse des points pendant le drag.
- L'outil Animation interpole position et couleur entre start/end sur N frames ; il écrase l'item existant dans chaque frame cible (matché par id) ou en ajoute un sur un **background figé** (la frame courante sans l'item animé) si les frames cibles n'existent pas encore.
- Les modifications d'inputs du panneau Tools mettent à jour en live l'item sélectionné via `updateSelectedItemProperties`.
