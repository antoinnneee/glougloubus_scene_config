import './style.css';
import { WIDTH, HEIGHT, mapToLedIndex, hslToRgb } from './modules/led-mapping.js';
import { applyEasing } from './modules/easing.js';
import {
  processImage,
  buildPaletteMedianCut,
  nearestPaletteIdx
} from './modules/image-process.js';
import { GifEncoder } from './modules/gif-encoder.js';
import { initBottomSheet, sheetAutoOpen } from './modules/sheet.js';
import {
  SCENE_VERSION,
  createEmptyProject,
  createObject,
  evaluateScene,
  setKeyframe,
  removeKeyframe,
  setPropertyAtFrame,
  setVisibleFrom,
  getValueAt,
  makeTextObject,
  makeImageObject,
  makeDrawingObject,
  makeShapeObject,
} from './modules/scene.js';
import { renderKeyframeEditor } from './modules/keyframe-editor.js';
import { renderLayersPanel } from './modules/layers-panel.js';
import { renderGlobalTimeline } from './modules/timeline-global.js';

// --- DOM Elements ---
const canvas = document.getElementById('led-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const btnPlayPause = document.getElementById('btn-play-pause');
const inputFps = document.getElementById('fps-input');
const btnClear = document.getElementById('btn-clear-canvas');

// --- BLE Config ---
const SERVICE_VIDEO_UUID = "cb47ec30-0000-1000-8000-00805f9b34fb";
const VIDEO_CONTROL_UUID = "cb47ec31-0000-1000-8000-00805f9b34fb";
const VIDEO_DATA_UUID = "cb47ec32-0000-1000-8000-00805f9b34fb";
const SERVICE_GENERAL_UUID = "cb47ec90-0000-1000-8000-00805f9b34fb";

let gattServer = null;
let videoControlCharacteristic = null;
let videoDataCharacteristic = null;
let isBleConnected = false;

const btnConnectBle = document.getElementById('btn-connect-ble');
const bleStatusText = document.getElementById('ble-status-text');
const btnStreamBle = document.getElementById('btn-stream-ble');

const btnAddFrame = document.getElementById('btn-add-frame');
const btnDupFrame = document.getElementById('btn-dup-frame');
const btnDelFrame = document.getElementById('btn-del-frame');
const timelineContainer = document.getElementById('timeline-container');

// Tools DOM
const imgUpload = document.getElementById('image-upload');
const imgX = document.getElementById('img-x');
const imgY = document.getElementById('img-y');
const imgScale = document.getElementById('img-scale');
const btnApplyImage = document.getElementById('btn-apply-image');

const textInput = document.getElementById('text-input');
const textColor = document.getElementById('text-color');
const textSize = document.getElementById('text-size');
const textX = document.getElementById('text-x');
const textY = document.getElementById('text-y');
const textFont = document.getElementById('text-font');
const btnApplyText = document.getElementById('btn-apply-text');

const selectionTools = document.getElementById('selection-tools');
const btnDeleteItem = document.getElementById('btn-delete-item');

const btnTogglePencil = document.getElementById('btn-toggle-pencil');
const pencilColor = document.getElementById('pencil-color');

// Layers (Phase 3 : panneau de calques)
const layersListEl = document.getElementById('layers-list');
const layersCountEl = document.getElementById('layers-count');
const btnLayerUp = document.getElementById('btn-layer-up');
const btnLayerDown = document.getElementById('btn-layer-down');
const btnLayerDuplicate = document.getElementById('btn-layer-duplicate');
const btnLayerDelete = document.getElementById('btn-layer-delete');
const btnLayerGroup = document.getElementById('btn-layer-group');
const btnLayerUngroup = document.getElementById('btn-layer-ungroup');

// Animation (Phase 2 : éditeur de keyframes)
const kfEditorEl = document.getElementById('kf-editor');
const btnPresetScrollL = document.getElementById('btn-preset-scroll-left');
const btnPresetScrollR = document.getElementById('btn-preset-scroll-right');
const btnPresetBlink = document.getElementById('btn-preset-blink');
const btnPresetFadeIn = document.getElementById('btn-preset-fadein');
const btnPresetFadeOut = document.getElementById('btn-preset-fadeout');

// Undo/Redo/Project
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnSaveProject = document.getElementById('btn-save-project');
const btnLoadProject = document.getElementById('btn-load-project');
const fileLoadProject = document.getElementById('file-load-project');
const btnNewProject = document.getElementById('btn-new-project');

// Tools selector (shapes / pencil / eyedropper / bucket)
const toolButtons = document.querySelectorAll('[data-tool]');

// Palette
const paletteContainer = document.getElementById('palette-container');

// Snap / Onion / Fullscreen
const snapSelect = document.getElementById('snap-select');
const toggleOnion = document.getElementById('toggle-onion');
const toggleSnapObjects = document.getElementById('toggle-snap-objects');
const btnFullscreen = document.getElementById('btn-fullscreen');

// Transforms (Phase 5)
const propRotation = document.getElementById('prop-rotation');
const btnRotReset = document.getElementById('btn-rot-reset');
const btnFlipH = document.getElementById('btn-flip-h');
const btnFlipV = document.getElementById('btn-flip-v');
const btnDistH = document.getElementById('btn-dist-h');
const btnDistV = document.getElementById('btn-dist-v');
const alignButtons = document.querySelectorAll('[data-align]');
const cursorCoords = document.getElementById('cursor-coords');
const selectionInfo = document.getElementById('selection-info');
const btnDeleteSelected = document.getElementById('btn-delete-selected');

// Zoom controls
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const canvasWrapper = document.getElementById('canvas-wrapper');

// Image dither
const imgDither = document.getElementById('img-dither');
const imgPalette = document.getElementById('img-palette');

// BLE test pattern
const btnBleTestPattern = document.getElementById('btn-ble-test-pattern');
const bleStatusBadge = document.getElementById('ble-status-badge');

// Export GIF
const btnExportGif = document.getElementById('btn-export-gif');

// --- Constantes globales ---
const AUTOSAVE_KEY = 'glougloubus-autosave-v3';
const AUTOSAVE_TS_KEY = 'glougloubus-autosave-v3-ts';

// --- State (Scene v3) ---
// project.objects[] est la source de vérité. Chaque objet est global et porte
// des keyframes par propriété. evaluateScene(project, f) retourne la liste
// d'items à rasteriser pour la frame f. Plus de tableau frames[] qui se
// dupliquait à chaque frame.
let project = createEmptyProject({ width: WIDTH, height: HEIGHT, fps: 20, frameCount: 1 });
let currentFrameIndex = 0;
let isPlaying = false;
let playInterval = null;

// Image cache — items stockent un imgId (string) au lieu d'un HTMLImageElement
// pour pouvoir sérialiser project en JSON (undo/redo, save/load, autosave).
const imageCache = new Map();       // imgId -> HTMLImageElement (pour draw)
// imageDataUrls vit désormais dans project.imageDataUrls (sérialisé direct).

// Undo / Redo (snapshots de project)
const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];

// Clipboard pour copy/paste d'objet (snapshot JSON)
let clipboardItem = null;

// Helpers fps / recentColors : raccourcis sur project pour ne pas tout réécrire
function getFps()          { return project.fps; }
function setFps(v)         { project.fps = v; }
function getRecentColors() { return project.recentColors; }

// Items rasterisés pour la frame courante (cache court-terme dans renderCanvas /
// getItemBounds). NB : ces items sont des SNAPSHOTS — modifier item.x ne change
// rien dans project. Pour modifier, il faut passer par updateObjectAtFrame().
function currentItems() { return evaluateScene(project, currentFrameIndex); }

// Trouve l'objet source dans project.objects à partir d'un id (sourceId d'un item
// matérialisé OU id direct d'un objet).
function getObject(id) {
  if (!id) return null;
  return project.objects.find(o => o.id === id) || null;
}

// Met à jour une propriété d'un objet à la frame courante. Pour les propriétés
// "statiques" (text, font, points, shape, imgId), MAJ obj.static. Pour les
// propriétés animables, passe par setPropertyAtFrame.
const STATIC_PROPS = new Set(['text', 'font', 'points', 'shape', 'imgId']);
function updateObjectProp(obj, prop, value) {
  if (!obj) return;
  if (STATIC_PROPS.has(prop)) {
    obj.static[prop] = value;
  } else {
    setPropertyAtFrame(obj, prop, currentFrameIndex, value);
  }
}

// Snap & onion-skin
let snapSize = 0;          // 0 = off, sinon 1, 8 ou 16
let onionSkinEnabled = false;

// Zoom / pan du canvas (CSS transform sur wrapper)
let viewZoom = 1;
let viewPanX = 0;
let viewPanY = 0;

// Object Selection and Tool State
// `selectedIds` est la source de vérité (Set d'ids). `selectedItemId` est un
// cache du "primary" id (dernier ajouté à la sélection) pour les opérations
// qui ne traitent qu'un seul objet (resize handles, keyframe editor, presets).
let selectedIds = new Set();
let selectedItemId = null;

function syncPrimaryFromSet() {
  if (selectedIds.size === 0) { selectedItemId = null; return; }
  // Préserve le primary actuel s'il est toujours sélectionné, sinon prend le dernier ajouté
  if (selectedItemId && selectedIds.has(selectedItemId)) return;
  selectedItemId = [...selectedIds].pop();
}
function setSingleSelection(id) {
  selectedIds.clear();
  if (id) selectedIds.add(id);
  selectedItemId = id || null;
}
function clearSelection() {
  selectedIds.clear();
  selectedItemId = null;
}
function addSelection(id) {
  if (!id) return;
  selectedIds.add(id);
  selectedItemId = id; // le dernier ajouté devient primary
}
function removeFromSelection(id) {
  selectedIds.delete(id);
  if (selectedItemId === id) syncPrimaryFromSet();
}
function toggleSelection(id) {
  if (!id) return;
  if (selectedIds.has(id)) removeFromSelection(id);
  else addSelection(id);
}
// 'select' | 'pencil' | 'eyedropper' | 'line' | 'rect' | 'rect-outline' | 'ellipse' | 'bucket'
let currentTool = 'select';
let isDragging = false;
let currentDrawingId = null;
let dragStartX = 0;
let dragStartY = 0;
let itemStartX = 0;
let itemStartY = 0;
// Preview shape en cours (line/rect/ellipse)
let shapePreview = null;

// Pinch multi-touch sur canvas : resize item ou zoom vue
const canvasPointers = new Map();   // pointerId -> { x, y }
let pinchStartDist = null;
let pinchStartItem = null;          // snapshot {size, scale, x, y}
let pinchStartZoom = null;
let pinchMode = null;               // 'resize' | 'zoom'

// Resize State
let isResizing = false;
let resizeHandle = null;
let resizeStartWidth = 0;
let resizeStartHeight = 0;
let resizeStartScale = 1;
let resizeStartSize = 16;
let resizeItemStartX = 0;
let resizeItemStartY = 0;

// Rotation drag state (Phase 5)
let isRotating = false;
let rotateStartAngleScreen = 0;   // angle (rad) du pointer par rapport au centre de l'item au pointerdown
let rotateStartItemAngle = 0;     // valeur degrés du track rotation au pointerdown
let rotateCenter = null;          // {x, y} en coords logiques

// Offscreen canvas for thumbnail generation and hit testing text measurement
const offCanvas = document.createElement('canvas');
offCanvas.width = WIDTH;
offCanvas.height = HEIGHT;
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

// --- Utils ---
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// Snapshot du projet entier (JSON-safe : pas d'HTMLImageElement)
function snapshotProject() {
  return JSON.parse(JSON.stringify(project));
}

function pushUndo() {
  undoStack.push(snapshotProject());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
  scheduleAutosave();
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(snapshotProject());
  project = undoStack.pop();
  if (currentFrameIndex >= project.frameCount) currentFrameIndex = project.frameCount - 1;
  if (currentFrameIndex < 0) currentFrameIndex = 0;
  clearSelection();
  updateUI();
  updateUndoButtons();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotProject());
  project = redoStack.pop();
  if (currentFrameIndex >= project.frameCount) currentFrameIndex = project.frameCount - 1;
  if (currentFrameIndex < 0) currentFrameIndex = 0;
  clearSelection();
  updateUI();
  updateUndoButtons();
}

function updateUndoButtons() {
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

function pushRecentColor(color) {
  if (!color) return;
  color = color.toLowerCase();
  const list = project.recentColors;
  const idx = list.indexOf(color);
  if (idx !== -1) list.splice(idx, 1);
  list.unshift(color);
  project.recentColors = list.slice(0, 8);
  renderPalette();
}

// --- Custom Modal ---
const customModal = document.getElementById('custom-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalBtnConfirm = document.getElementById('modal-btn-confirm');
const modalBtnCancel = document.getElementById('modal-btn-cancel');

function showModal(title, message, showCancel = false) {
  return new Promise((resolve) => {
    modalTitle.innerText = title;
    modalMessage.innerText = message;
    
    modalBtnCancel.style.display = showCancel ? 'block' : 'none';
    
    const onConfirm = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    
    function cleanup() {
      modalBtnConfirm.removeEventListener('click', onConfirm);
      modalBtnCancel.removeEventListener('click', onCancel);
      customModal.close();
    }
    
    modalBtnConfirm.addEventListener('click', onConfirm);
    modalBtnCancel.addEventListener('click', onCancel);
    
    customModal.showModal();
  });
}

// --- Initialization ---
function init() {
  // Project déjà initialisé avec frameCount=1
  updateUI();

  // Event Listeners
  btnAddFrame.addEventListener('click', addFrame);
  btnDupFrame.addEventListener('click', duplicateFrame);
  btnDelFrame.addEventListener('click', deleteFrame);
  btnClear.addEventListener('click', clearCurrentFrame);

  btnPlayPause.addEventListener('click', togglePlay);
  inputFps.addEventListener('change', (e) => { setFps(parseInt(e.target.value) || 20); if(isPlaying) { stop(); play(); } });

  // Update button texts
  btnApplyImage.innerText = "Add Image";
  btnApplyText.innerText = "Add Text";
  btnApplyImage.addEventListener('click', applyImageTool);
  btnApplyText.addEventListener('click', applyTextTool);
  btnConnectBle.addEventListener('click', connectBle);
  btnStreamBle.addEventListener('click', streamToBle);

  btnDeleteItem.addEventListener('click', deleteSelectedItem);
  btnTogglePencil.addEventListener('click', togglePencilMode);

  // Pointer events — unifié mouse + touch + stylet
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  
  // Keyboard Delete
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeTag = document.activeElement.tagName.toLowerCase();
      if (activeTag !== 'input' && activeTag !== 'textarea') {
        if (selectedItemId) {
          e.preventDefault();
          deleteSelectedItem();
        }
      }
    }
  });
  
  // Property changes live update the selected item.
  // pushUndo au premier focus = 1 point d'undo par session d'édition (pas par frappe).
  const propertyInputs = [textInput, textColor, textSize, textX, textY, textFont, imgX, imgY, imgScale];
  propertyInputs.forEach(el => {
    if (!el) return;
    el.addEventListener('input', updateSelectedItemProperties);
    el.addEventListener('focus', () => { if (selectedItemId) pushUndo(); });
  });

  // Init des fonctionnalités additionnelles
  initExtras();
}

// --- Interaction Logic ---
function getCanvasCoords(event) {
  const rect = canvas.getBoundingClientRect();
  // Le canvas a object-fit: contain → son contenu (192×32, ratio 6:1) est
  // letterboxé à l'intérieur de l'élément quand le ratio de l'élément n'est
  // pas pile 6:1 (cas réel : .canvas-container a un padding/border qui rend
  // sa content box plus large que 6:1, donc letterbox horizontal).
  const elemAspect = rect.width / rect.height;
  const canvasAspect = WIDTH / HEIGHT;
  let dispW, dispH, offsetX, offsetY;
  if (elemAspect > canvasAspect) {
    dispH = rect.height;
    dispW = dispH * canvasAspect;
    offsetX = (rect.width - dispW) / 2;
    offsetY = 0;
  } else {
    dispW = rect.width;
    dispH = dispW / canvasAspect;
    offsetX = 0;
    offsetY = (rect.height - dispH) / 2;
  }
  return {
    x: (event.clientX - rect.left - offsetX) * (WIDTH / dispW),
    y: (event.clientY - rect.top - offsetY) * (HEIGHT / dispH)
  };
}

// Hit radius des handles de resize : cible ~24 CSS px. Converti en unités logiques
// (192×32) d'après la taille affichée réelle du canvas.
function getResizeHitRadius() {
  const rect = canvas.getBoundingClientRect();
  return Math.max(6, 24 * (WIDTH / rect.width));
}

function applySnap(v) {
  // Math.floor pour convertir une coord flottante en index de cellule LED.
  // Math.round décalerait la moitié droite/basse d'une cellule vers la voisine.
  return snapSize > 1 ? Math.floor(v / snapSize) * snapSize : Math.floor(v);
}

function handlePointerDown(e) {
  if (isPlaying) return;
  canvas.setPointerCapture(e.pointerId);
  canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // Deuxième pointer : bascule en mode pinch (resize item ou zoom vue)
  if (canvasPointers.size === 2) {
    // Annule toute interaction single-finger en cours
    isDragging = false;
    isResizing = false;
    resizeHandle = null;
    // Supprime la dernière stroke du pinceau si elle vient d'être amorcée
    if (currentTool === 'pencil' && currentDrawingId) {
      const obj = getObject(currentDrawingId);
      if (obj && obj.static.points.length <= 2) {
        project.objects = project.objects.filter(o => o.id !== currentDrawingId);
      }
    }
    currentDrawingId = null;
    shapePreview = null;

    const pts = [...canvasPointers.values()];
    pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);

    const selObj = getObject(selectedItemId);
    if (selObj && (selObj.type === 'text' || selObj.type === 'image')) {
      pinchMode = 'resize';
      pushUndo();
      const it = currentItems().find(i => i.sourceId === selObj.id);
      pinchStartItem = {
        size: it && it.size != null ? it.size : 16,
        scale: it && it.scale != null ? it.scale : 1,
        x: it ? it.x : 0,
        y: it ? it.y : 0
      };
    } else {
      pinchMode = 'zoom';
      pinchStartZoom = viewZoom;
    }
    renderCanvas();
    return;
  }
  if (canvasPointers.size > 2) return;

  const raw = getCanvasCoords(e);
  const x = raw.x, y = raw.y;

  // Eyedropper : lit la couleur au pixel et l'applique à la palette + tool actif
  if (currentTool === 'eyedropper') {
    const px = Math.max(0, Math.min(WIDTH - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(HEIGHT - 1, Math.floor(y)));
    drawFrameToContext(offCtx, currentFrameIndex);
    const data = offCtx.getImageData(px, py, 1, 1).data;
    const hex = rgbToHex(data[0], data[1], data[2]);
    applyColorToActiveTool(hex);
    pushRecentColor(hex);
    setTool('select');
    return;
  }

  // Bucket fill : remplit la zone connectée de même couleur
  if (currentTool === 'bucket') {
    pushUndo();
    bucketFillAt(Math.floor(x), Math.floor(y), pencilColor.value);
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
    updateLayersPanel();
    return;
  }

  // Shape tools (line, rect, rect-outline, ellipse) : commence une preview
  if (['line','rect','rect-outline','ellipse'].includes(currentTool)) {
    isDragging = true;
    const sx = applySnap(x), sy = applySnap(y);
    shapePreview = {
      id: generateId(),
      type: 'shape',
      shape: currentTool,
      x1: sx, y1: sy, x2: sx, y2: sy,
      color: pencilColor.value
    };
    renderCanvas();
    return;
  }

  // Rotation handle (cercle au-dessus du bbox)
  if (selectedItemId && selectedIds.size === 1) {
    const it = currentItems().find(i => i.sourceId === selectedItemId);
    if (it) {
      const rh = getRotationHandlePoints(it);
      const hHit = getResizeHitRadius();
      if (Math.hypot(x - rh.handle.x, y - rh.handle.y) <= hHit) {
        pushUndo();
        isRotating = true;
        const c = getItemCenter(it);
        rotateCenter = c;
        rotateStartAngleScreen = Math.atan2(y - c.y, x - c.x);
        rotateStartItemAngle = it.rotation || 0;
        return;
      }
    }
  }

  // Resize handles : seulement si rotation = 0 (handles dessinés uniquement dans ce cas)
  if (selectedItemId) {
    const it = currentItems().find(i => i.sourceId === selectedItemId);
    if (it && !it.rotation && (it.type === 'text' || it.type === 'image')) {
      const bounds = getItemBounds(it);
      const hHit = getResizeHitRadius();
      const isHit = (hx, hy) => Math.abs(x - hx) <= hHit && Math.abs(y - hy) <= hHit;

      if (isHit(bounds.x + bounds.width, bounds.y + bounds.height)) resizeHandle = 'br';
      else if (isHit(bounds.x, bounds.y)) resizeHandle = 'tl';
      else if (isHit(bounds.x + bounds.width, bounds.y)) resizeHandle = 'tr';
      else if (isHit(bounds.x, bounds.y + bounds.height)) resizeHandle = 'bl';

      if (resizeHandle) {
        pushUndo();
        isResizing = true;
        dragStartX = x;
        dragStartY = y;
        resizeStartWidth = bounds.width;
        resizeStartHeight = bounds.height;
        resizeStartScale = it.scale || 1.0;
        resizeStartSize = it.size || 16;
        resizeItemStartX = it.x;
        resizeItemStartY = it.y;
        return;
      }
    }
  }

  if (currentTool === 'pencil') {
    pushUndo();
    pushRecentColor(pencilColor.value);
    isDragging = true;
    const obj = makeDrawingObject({
      points: [{ x: Math.floor(x), y: Math.floor(y) }],
      color: pencilColor.value,
      f: currentFrameIndex
    });
    setVisibleFrom(obj, currentFrameIndex);
    project.objects.push(obj);
    currentDrawingId = obj.id;
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
    updateLayersPanel();
    return;
  }

  const hitItem = findItemAtCoord(x, y);
  const additive = e.shiftKey;

  if (hitItem) {
    pushUndo();
    if (additive) {
      // Shift-click : toggle dans la sélection (sans démarrer un drag)
      toggleSelection(hitItem.sourceId);
    } else if (!selectedIds.has(hitItem.sourceId)) {
      // Click sur un item non sélectionné : remplace la sélection
      setSingleSelection(hitItem.sourceId);
    }
    // Si on click sur un item déjà sélectionné (et pas additive), on garde la
    // sélection courante (utile pour drag groupé).

    if (!additive) {
      isDragging = true;
      dragStartX = x;
      dragStartY = y;
      itemStartX = hitItem.x;
      itemStartY = hitItem.y;
      // Snapshot des positions de départ pour TOUS les objets sélectionnés
      // (drag groupé : tous bougent ensemble du même delta).
      captureGroupDragStart();
    }

    if (hitItem.type === 'drawing') {
      // Pour drawing : on bouge l'objet via tracks.x/y, points restent statiques
      // dans obj.static.points. itemStartX/Y captent l'offset courant (track).
    } else if (hitItem.type === 'shape') {
      const obj = getObject(hitItem.sourceId);
      if (obj) {
        obj._dragOriginX1 = hitItem.x1; obj._dragOriginY1 = hitItem.y1;
        obj._dragOriginX2 = hitItem.x2; obj._dragOriginY2 = hitItem.y2;
      }
    }

    populatePropertiesPanel(hitItem);
  } else if (currentTool === 'select') {
    // Drag dans le vide avec l'outil sélection : démarre une marquee selection
    if (!additive) clearSelection();
    marqueeStart = { x, y };
    marqueeRect = { x1: x, y1: y, x2: x, y2: y };
    marqueeBaseSelection = additive ? new Set(selectedIds) : new Set();
    isDragging = true;
  } else {
    if (!additive) clearSelection();
  }

  updateSelectionUI();
  renderCanvas();
}

// Capture la position de départ de chaque objet sélectionné pour permettre
// un drag groupé (tous bougent ensemble). On stocke (x,y) ou (x1,y1,x2,y2) selon
// le type. Réinitialisé à chaque pointerdown.
let groupDragStarts = new Map(); // id -> { x, y } ou { x1, y1, x2, y2 }
let primaryStartBounds = null;   // { x, y, width, height } du primary au pointerdown (pour snap-objets)
function captureGroupDragStart() {
  groupDragStarts.clear();
  primaryStartBounds = null;
  for (const id of selectedIds) {
    const it = currentItems().find(i => i.sourceId === id);
    if (!it) continue;
    if (it.type === 'shape') {
      groupDragStarts.set(id, { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 });
    } else {
      groupDragStarts.set(id, { x: it.x, y: it.y });
    }
    if (id === selectedItemId) primaryStartBounds = getItemBounds(it);
  }
}

// État marquee selection (rectangle de sélection rubber-band)
let marqueeStart = null;             // { x, y } en coords logiques
let marqueeRect = null;              // { x1, y1, x2, y2 } courant
let marqueeBaseSelection = null;     // Set d'ids présents au démarrage (additif Shift)

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function applyColorToActiveTool(hex) {
  pencilColor.value = hex;
  textColor.value = hex;
  const obj = getObject(selectedItemId);
  if (obj && (obj.type === 'text' || obj.type === 'drawing' || obj.type === 'shape')) {
    pushUndo();
    updateObjectProp(obj, 'color', hex);
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
  }
}

// Flood-fill sur la représentation rasterisée de la frame courante.
// Résultat stocké comme un objet 'drawing' composé des pixels remplis.
function bucketFillAt(startX, startY, newColorHex) {
  if (startX < 0 || startX >= WIDTH || startY < 0 || startY >= HEIGHT) return;
  drawFrameToContext(offCtx, currentFrameIndex);
  const imgData = offCtx.getImageData(0, 0, WIDTH, HEIGHT);
  const d = imgData.data;
  const idx = (x, y) => (y * WIDTH + x) * 4;
  const tr = d[idx(startX, startY)];
  const tg = d[idx(startX, startY) + 1];
  const tb = d[idx(startX, startY) + 2];
  const nh = newColorHex.replace('#', '');
  const nr = parseInt(nh.slice(0,2), 16), ng = parseInt(nh.slice(2,4), 16), nb = parseInt(nh.slice(4,6), 16);
  if (tr === nr && tg === ng && tb === nb) return;

  const visited = new Uint8Array(WIDTH * HEIGHT);
  const stack = [[startX, startY]];
  const points = [];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
    const p = y * WIDTH + x;
    if (visited[p]) continue;
    const i = p * 4;
    if (d[i] !== tr || d[i+1] !== tg || d[i+2] !== tb) continue;
    visited[p] = 1;
    points.push({ x, y });
    stack.push([x+1, y], [x-1, y], [x, y+1], [x, y-1]);
  }
  if (points.length === 0) return;
  const obj = makeDrawingObject({ points, color: newColorHex, f: currentFrameIndex });
  setVisibleFrom(obj, currentFrameIndex);
  project.objects.push(obj);
  pushRecentColor(newColorHex);
}

function handlePointerMove(e) {
  // Suivi multi-touch
  if (canvasPointers.has(e.pointerId)) {
    canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  // Pinch : resize item sélectionné ou zoom vue
  if (pinchMode && canvasPointers.size >= 2) {
    const pts = [...canvasPointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ratio = dist / (pinchStartDist || dist);

    if (pinchMode === 'resize') {
      const obj = getObject(selectedItemId);
      if (obj && pinchStartItem) {
        if (obj.type === 'text') {
          const newSize = Math.max(1, Math.round(pinchStartItem.size * ratio));
          updateObjectProp(obj, 'size', newSize);
          if (textSize) textSize.value = newSize;
        } else if (obj.type === 'image') {
          const newScale = Math.max(0.01, pinchStartItem.scale * ratio);
          updateObjectProp(obj, 'scale', newScale);
          if (imgScale) imgScale.value = newScale.toFixed(2);
        }
        renderCanvas();
      }
    } else if (pinchMode === 'zoom') {
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      setZoom((pinchStartZoom || viewZoom) * ratio, cx, cy);
    }
    return;
  }

  const { x, y } = getCanvasCoords(e);

  // Preview pendant drag d'un shape
  if (isDragging && shapePreview && ['line','rect','rect-outline','ellipse'].includes(currentTool)) {
    shapePreview.x2 = applySnap(x);
    shapePreview.y2 = applySnap(y);
    renderCanvas();
    return;
  }

  // Drag du handle de rotation
  if (isRotating && selectedItemId && rotateCenter) {
    const obj = getObject(selectedItemId);
    if (obj) {
      const angleNow = Math.atan2(y - rotateCenter.y, x - rotateCenter.x);
      let deg = rotateStartItemAngle + (angleNow - rotateStartAngleScreen) * 180 / Math.PI;
      // Snap aux multiples de 15° si Shift
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      // Normalise dans [-180, 180] pour rester lisible
      deg = ((deg + 180) % 360 + 360) % 360 - 180;
      updateObjectProp(obj, 'rotation', deg);
      if (propRotation && document.activeElement !== propRotation) {
        propRotation.value = (Math.round(deg * 10) / 10).toString();
      }
      renderCanvas();
    }
    return;
  }

  if (isResizing && selectedItemId) {
    const dx = x - dragStartX;
    const dy = y - dragStartY;
    const obj = getObject(selectedItemId);
    if (obj) {
       let currentWidth = resizeStartWidth;
       let newX = resizeItemStartX, newY = resizeItemStartY;

       if (resizeHandle === 'br') { currentWidth += dx; }
       else if (resizeHandle === 'tl') { currentWidth -= dx; newX = Math.round(resizeItemStartX + dx); newY = Math.round(resizeItemStartY + dy); }
       else if (resizeHandle === 'tr') { currentWidth += dx; newY = Math.round(resizeItemStartY + dy); }
       else if (resizeHandle === 'bl') { currentWidth -= dx; newX = Math.round(resizeItemStartX + dx); }

       if (currentWidth < 2) currentWidth = 2;

       if (obj.type === 'text') {
          const newSize = Math.max(1, Math.round(resizeStartSize * (currentWidth / Math.max(1, resizeStartWidth))));
          updateObjectProp(obj, 'size', newSize);
          updateObjectProp(obj, 'x', newX);
          updateObjectProp(obj, 'y', newY);
          textSize.value = newSize;
          textX.value = newX;
          textY.value = newY;
       } else if (obj.type === 'image') {
          const newScale = Math.max(0.01, resizeStartScale * (currentWidth / Math.max(1, resizeStartWidth)));
          updateObjectProp(obj, 'scale', newScale);
          updateObjectProp(obj, 'x', newX);
          updateObjectProp(obj, 'y', newY);
          imgScale.value = newScale.toFixed(2);
          imgX.value = newX;
          imgY.value = newY;
       }

       renderCanvas();
    }
    return;
  }
  
  if (!isDragging) return;

  if (currentTool === 'pencil' && currentDrawingId) {
    const obj = getObject(currentDrawingId);
    if (obj) {
      obj.static.points.push({ x: Math.floor(x), y: Math.floor(y) });
      renderCanvas();
    }
    return;
  }

  // Marquee selection : MAJ rect et selectedIds en temps réel
  if (marqueeStart) {
    marqueeRect.x2 = x;
    marqueeRect.y2 = y;
    updateMarqueeSelection();
    renderCanvas();
    return;
  }

  if (selectedIds.size === 0) return;

  let dx = x - dragStartX;
  let dy = y - dragStartY;

  // Snap aux objets non-sélectionnés. Projeté = bbox au pointerdown + (dx, dy).
  if (snapToObjectsEnabled && primaryStartBounds) {
    const moved = {
      x: primaryStartBounds.x + dx,
      y: primaryStartBounds.y + dy,
      width: primaryStartBounds.width,
      height: primaryStartBounds.height,
    };
    const snap = computeObjectSnap(moved);
    dx += snap.dx;
    dy += snap.dy;
  }

  const dxSnap = snapSize > 1 ? (applySnap(dx) - applySnap(0)) : dx;
  const dySnap = snapSize > 1 ? (applySnap(dy) - applySnap(0)) : dy;

  // Drag groupé : tous les sélectionnés bougent ensemble du même delta
  // (par rapport à leurs positions de départ capturées au pointerdown).
  for (const id of selectedIds) {
    const obj = getObject(id);
    if (!obj || obj.locked) continue;
    const start = groupDragStarts.get(id);
    if (!start) continue;

    if (obj.type === 'text' || obj.type === 'image' || obj.type === 'drawing') {
      const newX = applySnap(start.x + dx);
      const newY = applySnap(start.y + dy);
      updateObjectProp(obj, 'x', newX);
      updateObjectProp(obj, 'y', newY);
      if (id === selectedItemId) {
        if (obj.type === 'text')  { textX.value = newX; textY.value = newY; }
        if (obj.type === 'image') { imgX.value = newX;  imgY.value = newY; }
      }
    } else if (obj.type === 'shape') {
      updateObjectProp(obj, 'x1', Math.round(start.x1 + dxSnap));
      updateObjectProp(obj, 'y1', Math.round(start.y1 + dySnap));
      updateObjectProp(obj, 'x2', Math.round(start.x2 + dxSnap));
      updateObjectProp(obj, 'y2', Math.round(start.y2 + dySnap));
    }
  }

  renderCanvas();
}

// Pendant un drag marquee, recalcule selectedIds = base ∪ items intersectant le rect.
function updateMarqueeSelection() {
  if (!marqueeRect) return;
  const minX = Math.min(marqueeRect.x1, marqueeRect.x2);
  const maxX = Math.max(marqueeRect.x1, marqueeRect.x2);
  const minY = Math.min(marqueeRect.y1, marqueeRect.y2);
  const maxY = Math.max(marqueeRect.y1, marqueeRect.y2);
  const inside = new Set(marqueeBaseSelection || []);
  const items = currentItems();
  for (const it of items) {
    const obj = getObject(it.sourceId);
    if (!obj || obj.locked) continue;
    const b = getItemBounds(it);
    if (b.width === 0 && b.height === 0) continue;
    // Intersection rectangles
    const ix = b.x < maxX && (b.x + b.width) > minX;
    const iy = b.y < maxY && (b.y + b.height) > minY;
    if (ix && iy) inside.add(it.sourceId);
  }
  selectedIds = inside;
  syncPrimaryFromSet();
}

function handlePointerUp(e) {
  if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
  canvasPointers.delete(e.pointerId);

  // Fin de pinch
  if (pinchMode && canvasPointers.size < 2) {
    pinchMode = null;
    pinchStartDist = null;
    pinchStartItem = null;
    pinchStartZoom = null;
    renderCanvas();
    if (selectedItemId) updateTimelineThumb(currentFrameIndex);
    updateSelectionUI();
    return;
  }

  // Commit shape preview en objet réel
  if (shapePreview) {
    pushUndo();
    pushRecentColor(shapePreview.color);
    const obj = makeShapeObject({
      shape: shapePreview.shape,
      x1: shapePreview.x1, y1: shapePreview.y1,
      x2: shapePreview.x2, y2: shapePreview.y2,
      color: shapePreview.color,
      f: currentFrameIndex
    });
    setVisibleFrom(obj, currentFrameIndex);
    project.objects.push(obj);
    shapePreview = null;
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
    updateLayersPanel();
  }

  // Commit marquee selection
  if (marqueeStart) {
    marqueeStart = null;
    marqueeRect = null;
    marqueeBaseSelection = null;
    isDragging = false;
    renderCanvas();
    updateSelectionUI();
    return;
  }

  // Nettoie les pseudo-props de drag posées sur les objets shape sélectionnés
  for (const id of selectedIds) {
    const obj = getObject(id);
    if (obj && obj._dragOriginX1 !== undefined) {
      delete obj._dragOriginX1;
      delete obj._dragOriginY1;
      delete obj._dragOriginX2;
      delete obj._dragOriginY2;
    }
  }

  isDragging = false;
  isResizing = false;
  resizeHandle = null;
  isRotating = false;
  rotateCenter = null;
  currentDrawingId = null;
  groupDragStarts.clear();

  if (selectedIds.size > 0) {
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
    updateSelectionUI();
  }
}

function findItemAtCoord(cx, cy) {
  const items = currentItems();
  // Itération backwards pour hit-test top-most en premier
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const obj = getObject(item.sourceId);
    if (obj && obj.locked) continue;
    // Inverse rotation/flip : on teste le clic dans le repère local de l'item
    const local = inverseItemTransform(item, cx, cy);
    const bounds = getItemBounds(item);
    if (local.x >= bounds.x && local.x <= bounds.x + bounds.width &&
        local.y >= bounds.y && local.y <= bounds.y + bounds.height) {
      return item;
    }
  }
  return null;
}

function getItemBounds(item) {
  if (item.type === 'text') {
    const font = item.font || '"JetBrains Mono", monospace';
    offCtx.font = `${item.size}px ${font}`;
    offCtx.textBaseline = 'middle';
    const metrics = offCtx.measureText(item.text);
    const height = item.size;
    return {
      x: item.x,
      y: item.y - height/2,
      width: metrics.width,
      height: height
    };
  } else if (item.type === 'image') {
    const img = imageCache.get(item.imgId);
    const w = img ? img.width : 0;
    const h = img ? img.height : 0;
    return {
      x: item.x,
      y: item.y,
      width: w * item.scale,
      height: h * item.scale
    };
  } else if (item.type === 'drawing') {
    if (!item.points || item.points.length === 0) return {x:0,y:0,width:0,height:0};
    const ox = item.x || 0, oy = item.y || 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    item.points.forEach(pt => {
      minX = Math.min(minX, pt.x + ox);
      minY = Math.min(minY, pt.y + oy);
      maxX = Math.max(maxX, pt.x + ox);
      maxY = Math.max(maxY, pt.y + oy);
    });
    return { x: minX - 1, y: minY - 1, width: maxX - minX + 3, height: maxY - minY + 3 };
  } else if (item.type === 'shape') {
    const { shape, x1, y1, x2, y2 } = item;
    const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2), maxY = Math.max(y1, y2);
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }
  return { x:0, y:0, width:0, height:0 };
}

function populatePropertiesPanel(item) {
  if (item.type === 'text') {
    textInput.value = item.text;
    textColor.value = item.color;
    textSize.value = item.size;
    textX.value = item.x;
    textY.value = item.y;
    textFont.value = item.font || '"JetBrains Mono", monospace';
  } else if (item.type === 'image') {
    imgX.value = item.x;
    imgY.value = item.y;
    imgScale.value = item.scale;
  }
}

function updateSelectedItemProperties(e) {
  const obj = getObject(selectedItemId);
  if (!obj) return;

  if (obj.type === 'text') {
    updateObjectProp(obj, 'text',  textInput.value);
    updateObjectProp(obj, 'color', textColor.value);
    updateObjectProp(obj, 'size',  parseInt(textSize.value) || 16);
    updateObjectProp(obj, 'x',     parseInt(textX.value) || 0);
    updateObjectProp(obj, 'y',     parseInt(textY.value) || 16);
    updateObjectProp(obj, 'font',  textFont.value);
  } else if (obj.type === 'image') {
    updateObjectProp(obj, 'x',     parseInt(imgX.value) || 0);
    updateObjectProp(obj, 'y',     parseInt(imgY.value) || 0);
    updateObjectProp(obj, 'scale', parseFloat(imgScale.value) || 1.0);
  }

  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

function updateSelectionUI() {
  const has = !!selectedItemId;
  selectionTools.hidden = !has;
  if (btnDeleteSelected) btnDeleteSelected.disabled = !has;
  if (has) {
    const it = currentItems().find(i => i.sourceId === selectedItemId);
    if (it) {
      sheetAutoOpen(it);
      // Sync rotation input avec l'objet courant
      if (propRotation && document.activeElement !== propRotation) {
        propRotation.value = (Math.round((it.rotation || 0) * 10) / 10).toString();
      }
    }
  }
  updateKeyframeEditor();
  updateLayersPanel();
  // Re-render la timeline globale : les lanes dépendent de l'objet sélectionné
  renderTimeline();
}

// --- Layers panel (Phase 3) ---
function updateLayersPanel() {
  if (!layersListEl) return;
  renderLayersPanel(layersListEl, {
    project,
    selectedIds,
    callbacks: {
      onSelect(id, modifier) {
        if (modifier) {
          toggleSelection(id);
        } else {
          setSingleSelection(id);
        }
        const it = currentItems().find(i => i.sourceId === selectedItemId);
        if (it) populatePropertiesPanel(it);
        renderCanvas();
        updateSelectionUI();
      },
      onToggleVisible(id) {
        const obj = getObject(id);
        if (!obj) return;
        pushUndo();
        obj.visible = !obj.visible;
        renderCanvas();
        updateLayersPanel();
        updateTimelineThumb(currentFrameIndex);
      },
      onToggleLock(id) {
        const obj = getObject(id);
        if (!obj) return;
        pushUndo();
        obj.locked = !obj.locked;
        updateLayersPanel();
      },
      onRename(id, name) {
        const obj = getObject(id);
        if (!obj) return;
        pushUndo();
        obj.name = name;
        updateLayersPanel();
      },
      onReorder(fromIdx, toIdx) {
        if (fromIdx === toIdx) return;
        if (fromIdx < 0 || fromIdx >= project.objects.length) return;
        if (toIdx < 0 || toIdx >= project.objects.length) return;
        pushUndo();
        const [obj] = project.objects.splice(fromIdx, 1);
        project.objects.splice(toIdx, 0, obj);
        renderCanvas();
        updateLayersPanel();
        updateTimelineThumb(currentFrameIndex);
      },
      onDuplicate(id) {
        const obj = getObject(id);
        if (!obj) return;
        pushUndo();
        const copy = JSON.parse(JSON.stringify(obj));
        copy.id = generateId();
        if (copy.tracks && copy.tracks.x) {
          const curX = getValueAt(copy.tracks.x, currentFrameIndex, 0);
          setKeyframe(copy, 'x', currentFrameIndex, curX + 2);
        }
        if (copy.tracks && copy.tracks.y) {
          const curY = getValueAt(copy.tracks.y, currentFrameIndex, 0);
          setKeyframe(copy, 'y', currentFrameIndex, curY + 2);
        }
        const origIdx = project.objects.findIndex(o => o.id === id);
        project.objects.splice(origIdx + 1, 0, copy);
        setSingleSelection(copy.id);
        renderCanvas();
        updateSelectionUI();
        updateTimelineThumb(currentFrameIndex);
      },
      onDelete(id) {
        pushUndo();
        project.objects = project.objects.filter(o => o.id !== id);
        if (selectedIds.has(id)) removeFromSelection(id);
        renderCanvas();
        updateSelectionUI();
        updateTimelineThumb(currentFrameIndex);
      },
      onSendToTop(id) {
        const idx = project.objects.findIndex(o => o.id === id);
        if (idx === -1 || idx === project.objects.length - 1) return;
        pushUndo();
        const [obj] = project.objects.splice(idx, 1);
        project.objects.push(obj);
        renderCanvas();
        updateLayersPanel();
        updateTimelineThumb(currentFrameIndex);
      },
      onSendToBottom(id) {
        const idx = project.objects.findIndex(o => o.id === id);
        if (idx <= 0) return;
        pushUndo();
        const [obj] = project.objects.splice(idx, 1);
        project.objects.unshift(obj);
        renderCanvas();
        updateLayersPanel();
        updateTimelineThumb(currentFrameIndex);
      },
    },
  });
  if (layersCountEl) {
    const n = project.objects.length;
    layersCountEl.textContent = `${n} objet${n > 1 ? 's' : ''}`;
  }
  // Toolbar buttons : actifs uniquement si une sélection existe
  const has = !!selectedItemId;
  [btnLayerUp, btnLayerDown, btnLayerDuplicate, btnLayerDelete].forEach(b => {
    if (b) b.disabled = !has;
  });
}

function updateKeyframeEditor() {
  if (!kfEditorEl) return;
  const obj = getObject(selectedItemId);
  renderKeyframeEditor(kfEditorEl, {
    obj,
    currentFrame: currentFrameIndex,
    frameCount: project.frameCount,
    callbacks: {
      onAdd(prop, f) {
        if (!obj) return;
        const it = currentItems().find(i => i.sourceId === obj.id);
        const v = (it && it[prop] !== undefined) ? it[prop] : (obj.tracks[prop]?.[0]?.v ?? 0);
        pushUndo();
        setKeyframe(obj, prop, f, v);
        renderCanvas();
        updateKeyframeEditor();
      },
      onRemove(prop, f) {
        if (!obj) return;
        pushUndo();
        removeKeyframe(obj, prop, f);
        renderCanvas();
        updateKeyframeEditor();
      },
      onSeek(f) {
        currentFrameIndex = Math.max(0, Math.min(project.frameCount - 1, f));
        renderCanvas();
        renderTimeline();
        updateKeyframeEditor();
      },
      onMove(prop, oldF, newF) {
        if (!obj) return;
        const track = obj.tracks[prop];
        if (!track) return;
        const kf = track.find(k => k.f === oldF);
        if (!kf) return;
        const { v, easing } = kf;
        pushUndo();
        removeKeyframe(obj, prop, oldF);
        setKeyframe(obj, prop, newF, v, easing);
        renderCanvas();
        updateKeyframeEditor();
      },
      onEasing(prop, f, easing) {
        if (!obj) return;
        const track = obj.tracks[prop];
        if (!track) return;
        const kf = track.find(k => k.f === f);
        if (!kf) return;
        pushUndo();
        kf.easing = easing;
        renderCanvas();
        updateKeyframeEditor();
      },
    },
  });
}

function deleteSelectedItem() {
  if (selectedIds.size === 0 || isPlaying) return;
  pushUndo();
  const toRemove = new Set(selectedIds);
  project.objects = project.objects.filter(o => !toRemove.has(o.id));
  clearSelection();
  updateSelectionUI();
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

function setTool(tool) {
  currentTool = tool;
  if (tool !== 'select') {
    clearSelection();
    updateSelectionUI();
    renderCanvas();
  }
  // Cursor
  canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  // Active state sur les boutons
  if (toolButtons) {
    toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  }
  // Compat bouton pencil legacy
  if (btnTogglePencil) {
    const pencilish = (tool === 'pencil');
    btnTogglePencil.innerText = pencilish ? 'Enable Select Mode' : 'Enable Pencil Mode';
    btnTogglePencil.classList.toggle('primary', pencilish);
    btnTogglePencil.classList.toggle('outline', !pencilish);
  }
}

function togglePencilMode() {
  setTool(currentTool === 'pencil' ? 'select' : 'pencil');
}

// --- Core Rendering ---
function updateUI() {
  if (project.frameCount < 1) project.frameCount = 1;
  if (currentFrameIndex >= project.frameCount) currentFrameIndex = project.frameCount - 1;
  if (currentFrameIndex < 0) currentFrameIndex = 0;
  clearSelection(); // deselect on frame change
  updateSelectionUI();
  renderCanvas();
  renderTimeline();
}

function drawItem(context, item) {
  const opacity = item.opacity != null ? item.opacity : 1;
  if (opacity <= 0) return;
  context.save();
  if (opacity < 1) context.globalAlpha = opacity;

  // Rotation + flip : transformations appliquées autour du centre du bbox
  // unrotaté/unflippé. La rotation vient du track (degrés), flipX/flipY sont
  // statiques.
  const rot = item.rotation || 0;
  const fx = item.flipX ? -1 : 1;
  const fy = item.flipY ? -1 : 1;
  if (rot !== 0 || fx !== 1 || fy !== 1) {
    const c = getItemCenter(item);
    context.translate(c.x, c.y);
    if (rot) context.rotate(rot * Math.PI / 180);
    if (fx !== 1 || fy !== 1) context.scale(fx, fy);
    context.translate(-c.x, -c.y);
  }

  if (item.type === 'text') {
    context.fillStyle = item.color;
    const font = item.font || '"JetBrains Mono", monospace';
    context.font = `${item.size}px ${font}`;
    context.textBaseline = 'middle';
    context.fillText(item.text, item.x, item.y);
  } else if (item.type === 'image') {
    const img = imageCache.get(item.imgId);
    if (img) context.drawImage(img, item.x, item.y, img.width * item.scale, img.height * item.scale);
  } else if (item.type === 'drawing') {
    context.fillStyle = item.color;
    const ox = item.x || 0, oy = item.y || 0;
    item.points.forEach(pt => context.fillRect(pt.x + ox, pt.y + oy, 1, 1));
  } else if (item.type === 'shape') {
    drawShape(context, item);
  }
  context.restore();
}

// Centre du bbox unrotaté d'un item (point pivot pour rotation/flip)
function getItemCenter(item) {
  const b = getItemBounds(item);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Inverse-transforme un point (px, py) du repère "écran logique" vers le repère
// local de l'item (annule rotation + flip autour du centre du bbox unrotaté).
// Utilisé par hit-test pour cliquer sur un item rotaté/flippé.
function inverseItemTransform(item, px, py) {
  const rot = item.rotation || 0;
  const fx = item.flipX ? -1 : 1;
  const fy = item.flipY ? -1 : 1;
  if (rot === 0 && fx === 1 && fy === 1) return { x: px, y: py };
  const c = getItemCenter(item);
  let x = px - c.x, y = py - c.y;
  if (rot) {
    const r = -rot * Math.PI / 180;
    const cs = Math.cos(r), sn = Math.sin(r);
    const xr = x * cs - y * sn;
    const yr = x * sn + y * cs;
    x = xr; y = yr;
  }
  if (fx !== 1) x = -x;
  if (fy !== 1) y = -y;
  return { x: x + c.x, y: y + c.y };
}

// Distance (en unités logiques) entre le bord supérieur du bbox et le handle
// de rotation à l'écran. Convertie depuis ~26 CSS px.
function getRotationHandleOffset() {
  const rect = canvas.getBoundingClientRect();
  return Math.max(2, 26 * (WIDTH / Math.max(1, rect.width)));
}

// Renvoie deux points en coords logiques :
//   anchor — milieu de l'arête supérieure du bbox rotaté
//   handle — position du cercle handle (anchor + offset le long de la normale "haut")
function getRotationHandlePoints(item) {
  const b = getItemBounds(item);
  const c = getItemCenter(item);
  const rot = (item.rotation || 0) * Math.PI / 180;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const off = getRotationHandleOffset();
  // Milieu top du bbox unrotaté
  const topMidLocal = { x: 0, y: -b.height / 2 };
  // Direction "vers le haut" en world space après rotation
  const ax = topMidLocal.x * cs - topMidLocal.y * sn;
  const ay = topMidLocal.x * sn + topMidLocal.y * cs;
  const anchor = { x: c.x + ax, y: c.y + ay };
  // Direction normalisée vers l'extérieur (depuis center vers anchor) + offset
  const len = Math.hypot(ax, ay) || 1;
  const ux = ax / len, uy = ay / len;
  const handle = { x: anchor.x + ux * off, y: anchor.y + uy * off };
  return { anchor, handle };
}

// Renvoie les 4 coins du bbox APRÈS rotation+flip (pour dessiner le cadre de
// sélection à l'écran). Ordre : tl, tr, br, bl.
function getRotatedCorners(item) {
  const b = getItemBounds(item);
  const c = getItemCenter(item);
  const rot = (item.rotation || 0) * Math.PI / 180;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  // Le flip ne change pas la forme du bbox extérieur (pas la peine de l'appliquer)
  const corners = [
    { x: b.x,           y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x,           y: b.y + b.height },
  ];
  return corners.map(p => {
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
  });
}

function drawShape(context, item) {
  const { shape, x1, y1, x2, y2, color } = item;
  context.fillStyle = color;
  if (shape === 'line') {
    drawPixelLine(context, x1, y1, x2, y2, color);
  } else if (shape === 'rect' || shape === 'rect-outline') {
    const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
    const w = Math.abs(x2 - x1) + 1, h = Math.abs(y2 - y1) + 1;
    if (shape === 'rect') {
      context.fillRect(minX, minY, w, h);
    } else {
      // outline (1px)
      context.fillRect(minX, minY, w, 1);
      context.fillRect(minX, minY + h - 1, w, 1);
      context.fillRect(minX, minY, 1, h);
      context.fillRect(minX + w - 1, minY, 1, h);
    }
  } else if (shape === 'ellipse') {
    drawPixelEllipse(context, x1, y1, x2, y2, color);
  }
}

function drawPixelLine(context, x1, y1, x2, y2, color) {
  x1 = Math.round(x1); y1 = Math.round(y1);
  x2 = Math.round(x2); y2 = Math.round(y2);
  context.fillStyle = color;
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy, x = x1, y = y1;
  for (let safety = 0; safety < 4096; safety++) {
    context.fillRect(x, y, 1, 1);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function drawPixelEllipse(context, x1, y1, x2, y2, color) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const rx = Math.max(1, Math.abs(x2 - x1) / 2);
  const ry = Math.max(1, Math.abs(y2 - y1) / 2);
  context.fillStyle = color;
  // midpoint ellipse — outline only
  const minX = Math.round(cx - rx), maxX = Math.round(cx + rx);
  const minY = Math.round(cy - ry), maxY = Math.round(cy + ry);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = dx*dx + dy*dy;
      if (d >= 0.85 && d <= 1.15) context.fillRect(x, y, 1, 1);
    }
  }
}

function drawFrameToContext(context, frameIndex, drawActiveSelectionBox = false, opts = {}) {
  const items = evaluateScene(project, frameIndex);

  // Fond
  context.fillStyle = '#050505';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // Onion skin : frame précédente en fantôme
  if (opts.onionSkin && frameIndex > 0) {
    const prev = evaluateScene(project, frameIndex - 1);
    context.save();
    context.globalAlpha = 0.3;
    prev.forEach(it => drawItem(context, it));
    context.restore();
  }

  items.forEach(item => {
    drawItem(context, item);

    // Legacy Selection Box (thumbnails only)
    if (drawActiveSelectionBox && item.sourceId === selectedItemId) {
      const bounds = getItemBounds(item);
      context.strokeStyle = '#3b82f6';
      context.lineWidth = 1;
      context.setLineDash([2, 2]);
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.setLineDash([]);
    }
  });

  // Preview de shape en cours (pendant drag)
  if (opts.shapePreview) {
    drawShape(context, opts.shapePreview);
  }
}

function renderCanvas() {
  if (project.frameCount < 1) return;

  // 1. Draw logical scene to offscreen backbuffer
  drawFrameToContext(offCtx, currentFrameIndex, false, {
    onionSkin: onionSkinEnabled && !isPlaying,
    shapePreview: shapePreview
  });
  
  // 2. Read logical pixels
  const imgData = offCtx.getImageData(0, 0, WIDTH, HEIGHT).data;
  
  // 3. Clear the high-res display canvas
  ctx.fillStyle = '#000000'; // Pure black between LEDs
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // 4. Calculate scaling for dots
  const scaleX = canvas.width / WIDTH;
  const scaleY = canvas.height / HEIGHT;
  const radius = Math.min(scaleX, scaleY) * 0.40; // 40% of cell size to leave a distinct gap
  
  // 5. Draw LED dots
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const idx = (y * WIDTH + x) * 4;
      let r = imgData[idx];
      let g = imgData[idx+1];
      let b = imgData[idx+2];
      
      // Enhance contrast of "off" LEDs
      if (r === 5 && g === 5 && b === 5) {
        r = 15; g = 15; b = 15; // Unused, we check actual rgb from #050505 background
      }
      
      const cx = x * scaleX + scaleX / 2;
      const cy = y * scaleY + scaleY / 2;
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();
    }
  }
  
  // 6. Draw vector Selection UI on top of the LED grid
  if (!isPlaying && selectedIds.size > 0) {
    const items = currentItems();
    const singleSelection = selectedIds.size === 1;
    const cssWidth = canvas.getBoundingClientRect().width || canvas.width;
    const bufferPerCss = canvas.width / cssWidth;
    for (const it of items) {
      if (!selectedIds.has(it.sourceId)) continue;
      const isPrimary = it.sourceId === selectedItemId;
      const corners = getRotatedCorners(it).map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));

      // Cadre rotaté (4 coins)
      ctx.strokeStyle = isPrimary ? '#3b82f6' : '#60a5fa';
      ctx.lineWidth = isPrimary ? 2 : 1.5;
      ctx.setLineDash(isPrimary ? [6, 6] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Handles uniquement si sélection unique
      if (singleSelection) {
        const hSize = 18 * bufferPerCss;
        const drawHandle = (hx, hy) => {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = Math.max(2, 2 * bufferPerCss);
          ctx.fillRect(hx - hSize/2, hy - hSize/2, hSize, hSize);
          ctx.strokeRect(hx - hSize/2, hy - hSize/2, hSize, hSize);
        };

        // Resize handles : seulement pour text/image et seulement si rotation = 0
        // (resize sur item rotaté nécessiterait une logique de delta dans le repère
        // local, hors scope ici).
        const noRotation = !it.rotation;
        if (noRotation && (it.type === 'text' || it.type === 'image')) {
          drawHandle(corners[0].x, corners[0].y); // tl
          drawHandle(corners[1].x, corners[1].y); // tr
          drawHandle(corners[2].x, corners[2].y); // br
          drawHandle(corners[3].x, corners[3].y); // bl
        }

        // Handle de rotation : cercle au-dessus du milieu de l'arête supérieure,
        // à 22 CSS px de distance le long de la normale "haut" du bbox rotaté.
        const rh = getRotationHandlePoints(it);
        const anchorScreen = { x: rh.anchor.x * scaleX, y: rh.anchor.y * scaleY };
        const handleScreen = { x: rh.handle.x * scaleX, y: rh.handle.y * scaleY };
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = Math.max(1.5, 1.5 * bufferPerCss);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(anchorScreen.x, anchorScreen.y);
        ctx.lineTo(handleScreen.x, handleScreen.y);
        ctx.stroke();
        const rR = 9 * bufferPerCss;
        ctx.fillStyle = '#3b82f6';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, 2 * bufferPerCss);
        ctx.beginPath();
        ctx.arc(handleScreen.x, handleScreen.y, rR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // 7. Marquee selection rectangle (pendant drag dans le vide)
  if (!isPlaying && marqueeRect) {
    const minX = Math.min(marqueeRect.x1, marqueeRect.x2) * scaleX;
    const maxX = Math.max(marqueeRect.x1, marqueeRect.x2) * scaleX;
    const minY = Math.min(marqueeRect.y1, marqueeRect.y2) * scaleY;
    const maxY = Math.max(marqueeRect.y1, marqueeRect.y2) * scaleY;
    ctx.fillStyle = 'rgba(59,130,246,0.12)';
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    ctx.setLineDash([]);
  }
}

// Phase 6 : la frame strip est devenue une vraie timeline scrubbable. Il n'y
// a plus de thumbs à mettre à jour individuellement — un re-render complet
// de la timeline suffit (ce qu'on faisait déjà à chaque changement majeur via
// updateUI). Helper conservé pour ne pas casser les call sites existants.
function updateTimelineThumb(_index) {
  renderTimeline();
}

function renderTimeline() {
  if (!timelineContainer) return;
  const selectedObj = getObject(selectedItemId);
  renderGlobalTimeline(timelineContainer, {
    project,
    currentFrame: currentFrameIndex,
    selectedObj,
    callbacks: {
      onSeek(f) {
        const target = Math.max(0, Math.min(project.frameCount - 1, f));
        if (target === currentFrameIndex) return;
        currentFrameIndex = target;
        if (isPlaying) togglePlay();
        renderCanvas();
        renderTimeline();
        updateKeyframeEditor();
      },
      onAddKf(prop, f) {
        const obj = getObject(selectedItemId);
        if (!obj) return;
        // Valeur par défaut au moment t = valeur courante de la track au temps f
        const cur = getValueAt(obj.tracks[prop], f, undefined);
        // Fallback : la valeur visible à f côté rendu (pour size/scale/etc.)
        let v = cur;
        if (v === undefined) {
          const it = currentItems().find(i => i.sourceId === obj.id);
          v = it && it[prop] !== undefined ? it[prop] : 0;
        }
        pushUndo();
        setKeyframe(obj, prop, f, v);
        renderCanvas();
        renderTimeline();
        updateKeyframeEditor();
      },
      onMoveKf(prop, oldF, newF) {
        const obj = getObject(selectedItemId);
        if (!obj) return;
        const track = obj.tracks[prop];
        if (!track) return;
        const kf = track.find(k => k.f === oldF);
        if (!kf) return;
        const { v, easing } = kf;
        pushUndo();
        removeKeyframe(obj, prop, oldF);
        setKeyframe(obj, prop, newF, v, easing);
        renderCanvas();
        renderTimeline();
        updateKeyframeEditor();
      },
      onRemoveKf(prop, f) {
        const obj = getObject(selectedItemId);
        if (!obj) return;
        pushUndo();
        removeKeyframe(obj, prop, f);
        renderCanvas();
        renderTimeline();
        updateKeyframeEditor();
      },
    },
  });
}

// Quand une frame est déplacée dans la timeline, on remappe les valeurs f des
// keyframes : les keyframes à f=from se retrouvent à f=to, et celles entre
// from et to se décalent d'1 dans le sens inverse.
function shiftKeyframesForReorder(from, to) {
  if (from === to) return;
  const remap = (f) => {
    if (f === from) return to;
    if (from < to) return (f > from && f <= to) ? f - 1 : f;
    return (f >= to && f < from) ? f + 1 : f;
  };
  for (const obj of project.objects) {
    for (const prop of Object.keys(obj.tracks)) {
      const tr = obj.tracks[prop];
      tr.forEach(k => { k.f = remap(k.f); });
      tr.sort((a, b) => a.f - b.f);
    }
  }
}

// --- Frame Management ---
// Note v3 : ajouter/dupliquer une frame = juste étendre frameCount. Les objets
// existent globalement et restent visibles sur toute la timeline tant qu'ils
// n'ont pas de visibleRanges qui dit le contraire.
function addFrame() {
  pushUndo();
  project.frameCount++;
  currentFrameIndex = project.frameCount - 1;
  updateUI();
}

function duplicateFrame() {
  if (project.frameCount === 0) return;
  pushUndo();
  // En v3, "dupliquer" la frame courante = insérer un nouveau slot juste après
  // (les objets persistent), puis décaler les keyframes des frames suivantes.
  shiftKeyframesAtOrAfter(currentFrameIndex + 1, +1);
  project.frameCount++;
  currentFrameIndex++;
  updateUI();
}

function deleteFrame() {
  if (project.frameCount <= 1) {
    // Cas dégénéré : on garde 1 frame mais on vide tout (purge keyframes à f=0
    // pour les remettre à leur valeur par défaut). Plus simple : pas de purge,
    // juste un signal "rien à faire".
    return;
  }
  pushUndo();
  // Supprime les keyframes posés à currentFrameIndex et décale les suivants.
  for (const obj of project.objects) {
    for (const prop of Object.keys(obj.tracks)) {
      const tr = obj.tracks[prop];
      // Filtre les keyframes pile à currentFrameIndex puis shift les > currentFrameIndex
      obj.tracks[prop] = tr.filter(k => k.f !== currentFrameIndex)
                          .map(k => k.f > currentFrameIndex ? { ...k, f: k.f - 1 } : k);
    }
  }
  project.frameCount--;
  if (currentFrameIndex >= project.frameCount) currentFrameIndex = project.frameCount - 1;
  updateUI();
}

function clearCurrentFrame() {
  // En v3 il n'y a plus d'items "appartenant à" une frame en particulier. On
  // interprète clear comme "retirer tous les objets dont au moins un keyframe
  // tombe sur cette frame". Comportement plus prévisible : retire tous les
  // objets visibles sur cette frame (= tout objet visible à f=currentFrameIndex).
  if (project.frameCount === 0) return;
  pushUndo();
  const visibleIds = new Set(currentItems().map(it => it.sourceId));
  project.objects = project.objects.filter(o => !visibleIds.has(o.id));
  clearSelection();
  updateUI();
}

// Décale les keyframes >= fromF de delta sur tous les objets/tracks.
function shiftKeyframesAtOrAfter(fromF, delta) {
  for (const obj of project.objects) {
    for (const prop of Object.keys(obj.tracks)) {
      const tr = obj.tracks[prop];
      tr.forEach(k => { if (k.f >= fromF) k.f += delta; });
      tr.sort((a, b) => a.f - b.f);
    }
  }
}

// --- Playback ---
function togglePlay() {
  if (isPlaying) {
    stop();
  } else {
    play();
  }
}

function play() {
  if (project.frameCount <= 1) return;
  clearSelection(); // Hide selection boxes during playback
  isPlaying = true;
  btnPlayPause.innerText = 'Pause';
  btnPlayPause.classList.remove('primary');

  playInterval = setInterval(() => {
    currentFrameIndex = (currentFrameIndex + 1) % project.frameCount;
    renderCanvas();
    // Maj rapide du playhead sans re-render complet (= pas de DOM rebuild)
    const ph = timelineContainer && timelineContainer.querySelector('.gtl-playhead');
    if (ph) {
      const pct = project.frameCount <= 1 ? 0 : (currentFrameIndex / (project.frameCount - 1)) * 100;
      ph.style.left = `${pct}%`;
    }
  }, 1000 / project.fps);
}

function stop() {
  isPlaying = false;
  btnPlayPause.innerText = 'Play';
  btnPlayPause.classList.add('primary');
  clearInterval(playInterval);
  updateUI();
}

// --- Tools (Object Addition) ---
function applyImageTool() {
  const file = imgUpload.files[0];
  if (!file) {
    showModal("Notice", "Please select an image first.", false);
    return;
  }

  const x = parseInt(imgX.value) || 0;
  const y = parseInt(imgY.value) || 0;
  const scale = parseFloat(imgScale.value) || 1.0;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    loadImageWithOptions(dataUrl, x, y, scale);
  };
  reader.readAsDataURL(file);
}

// Charge une image, applique dithering/quantize si demandé, stocke en cache, pushe l'item
function loadImageWithOptions(dataUrl, x, y, scale) {
  const img = new Image();
  img.onload = async () => {
    let finalScale = scale;
    if (img.width > WIDTH || img.height > HEIGHT) {
      finalScale = Math.min(WIDTH / img.width, HEIGHT / img.height);
      imgScale.value = finalScale.toFixed(2);
    }

    const ditherMode = imgDither ? imgDither.value : 'none';
    const paletteSize = imgPalette ? parseInt(imgPalette.value) || 0 : 0;
    let finalImg = img;
    let finalDataUrl = dataUrl;
    if (ditherMode !== 'none' || paletteSize > 0) {
      const processed = await processImage(img, ditherMode, paletteSize);
      finalImg = processed.image;
      finalDataUrl = processed.dataUrl;
    }

    const imgId = generateId();
    imageCache.set(imgId, finalImg);
    project.imageDataUrls[imgId] = finalDataUrl;

    pushUndo();
    const obj = makeImageObject({ imgId, x, y, scale: finalScale, f: currentFrameIndex });
    setVisibleFrom(obj, currentFrameIndex);
    project.objects.push(obj);
    setSingleSelection(obj.id);
    updateSelectionUI();
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
  };
  img.src = dataUrl;
}

function applyTextTool() {
  const text = textInput.value;
  if (!text) return;

  pushUndo();
  const color = textColor.value;
  const size = parseInt(textSize.value) || 16;
  const x = parseInt(textX.value) || 0;
  const y = parseInt(textY.value) || 16;
  const font = textFont.value;
  pushRecentColor(color);

  const obj = makeTextObject({ text, font, x, y, size, color, f: currentFrameIndex });
  setVisibleFrom(obj, currentFrameIndex);
  project.objects.push(obj);
  setSingleSelection(obj.id);
  updateSelectionUI();
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

// --- Video Export (.bin) ---
const btnExportVideo = document.getElementById('btn-export-video');
const exportFilename = document.getElementById('export-filename');
const exportMapping = document.getElementById('export-mapping');
const exportProgressContainer = document.getElementById('export-progress-container');
const exportProgressBar = document.getElementById('export-progress-bar');
const exportProgressText = document.getElementById('export-progress-text');
const exportStatusText = document.getElementById('export-status-text');

async function exportToBin() {
  if (project.frameCount === 0) {
    showModal("Notice", "Aucune frame à exporter.", false);
    return;
  }

  const filename = (exportFilename.value.trim() || 'video') + '.bin';
  const useCustomMapping = exportMapping.value === 'custom';
  const totalFrames = project.frameCount;
  const totalPixels = WIDTH * HEIGHT;

  btnExportVideo.disabled = true;
  exportProgressContainer.hidden = false;
  exportStatusText.innerText = `Traitement de ${totalFrames} frames...`;

  const framesData = [];

  for (let i = 0; i < totalFrames; i++) {
    drawFrameToContext(offCtx, i, false);
    const imageData = offCtx.getImageData(0, 0, WIDTH, HEIGHT).data;

    const frameBytes = new Uint8Array(totalPixels * 3);

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const pixelIdx = (y * WIDTH + x) * 4;

        let physicalLedIndex;
        if (useCustomMapping) {
          physicalLedIndex = mapToLedIndex(x, y);
        } else {
          physicalLedIndex = y * WIDTH + x;
        }

        if (physicalLedIndex >= 0 && physicalLedIndex < totalPixels) {
          const byteIdx = physicalLedIndex * 3;
          frameBytes[byteIdx]     = imageData[pixelIdx];     // R
          frameBytes[byteIdx + 1] = imageData[pixelIdx + 1]; // G
          frameBytes[byteIdx + 2] = imageData[pixelIdx + 2]; // B
        }
      }
    }

    framesData.push(frameBytes);
  }

  const finalBlob = new Blob(framesData, { type: 'application/octet-stream' });

  // Use native "Save As" dialog via File System Access API
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: 'Fichier binaire LED',
        accept: { 'application/octet-stream': ['.bin'] }
      }]
    });
    const writable = await handle.createWritable();
    await writable.write(finalBlob);
    await writable.close();

    exportProgressBar.style.width = '100%';
    exportProgressText.innerText = '100%';
    exportStatusText.innerText = `Terminé ! ${filename} enregistré (${totalFrames} frames).`;
  } catch (err) {
    if (err.name === 'AbortError') {
      exportStatusText.innerText = 'Export annulé.';
    } else {
      console.error('Erreur lors de l\'enregistrement :', err);
      exportStatusText.innerText = `Erreur : ${err.message}`;
    }
  }

  btnExportVideo.disabled = false;

  // Re-render current view since offCtx was used for export
  renderCanvas();
}

// Run
init();
btnExportVideo.addEventListener('click', exportToBin);

// --- BLE Logic ---
async function connectBle() {
  if (isBleConnected) {
    if (gattServer) gattServer.disconnect();
    return;
  }
  
  try {
    setBleStatus('connecting', 'Connexion…');

    const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'glougloubus' }],
        optionalServices: [SERVICE_GENERAL_UUID, SERVICE_VIDEO_UUID]
    });

    gattServer = await device.gatt.connect();

    const service = await gattServer.getPrimaryService(SERVICE_VIDEO_UUID);
    videoControlCharacteristic = await service.getCharacteristic(VIDEO_CONTROL_UUID);
    videoDataCharacteristic = await service.getCharacteristic(VIDEO_DATA_UUID);

    isBleConnected = true;
    setBleStatus('connected', 'Connecté');
    btnConnectBle.innerText = 'Disconnect BLE';
    btnStreamBle.hidden = false;
    if (btnBleTestPattern) btnBleTestPattern.disabled = false;

    device.addEventListener('gattserverdisconnected', onBleDisconnected);
  } catch(err) {
    console.error(err);
    setBleStatus('error', 'Erreur');
  }
}

function setBleStatus(state, label) {
  if (bleStatusText) bleStatusText.innerText = label;
  if (bleStatusBadge) {
    bleStatusBadge.dataset.state = state; // 'disconnected' | 'connecting' | 'connected' | 'error'
  }
  // Mirror in the export pane
  const mirror = document.getElementById('ble-status-badge-mirror');
  if (mirror) mirror.dataset.state = state;
}

function onBleDisconnected() {
    isBleConnected = false;
    setBleStatus('disconnected', 'Not connected');
    btnConnectBle.innerText = 'Connect BLE';
    btnStreamBle.hidden = true;
    if (btnBleTestPattern) btnBleTestPattern.disabled = true;
    gattServer = null;
    videoControlCharacteristic = null;
    videoDataCharacteristic = null;
}

async function streamToBle() {
  if (!isBleConnected || !videoControlCharacteristic || !videoDataCharacteristic) {
    showModal("Notice", "Non connecté ou caractéristiques manquantes", false);
    return;
  }
  
  if (project.frameCount === 0) {
    showModal("Notice", "Aucune frame à exporter.", false);
    return;
  }

  const useCustomMapping = exportMapping.value === 'custom';
  const totalFrames = project.frameCount;
  const totalPixels = WIDTH * HEIGHT;

  btnStreamBle.disabled = true;
  exportProgressContainer.hidden = false;
  exportStatusText.innerText = `Génération des frames...`;
  exportProgressBar.style.width = '0%';
  exportProgressText.innerText = '0%';

  const framesData = [];
  let totalDataLength = 0;

  for (let i = 0; i < totalFrames; i++) {
    drawFrameToContext(offCtx, i, false);
    const imageData = offCtx.getImageData(0, 0, WIDTH, HEIGHT).data;

    const frameBytes = new Uint8Array(totalPixels * 3);

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const pixelIdx = (y * WIDTH + x) * 4;

        let physicalLedIndex;
        if (useCustomMapping) {
          physicalLedIndex = mapToLedIndex(x, y);
        } else {
          physicalLedIndex = y * WIDTH + x;
        }

        if (physicalLedIndex >= 0 && physicalLedIndex < totalPixels) {
          const byteIdx = physicalLedIndex * 3;
          frameBytes[byteIdx]     = imageData[pixelIdx];     // R
          frameBytes[byteIdx + 1] = imageData[pixelIdx + 1]; // G
          frameBytes[byteIdx + 2] = imageData[pixelIdx + 2]; // B
        }
      }
    }

    framesData.push(frameBytes);
    totalDataLength += frameBytes.length;
  }

  // Flatten the frames into a single Uint8Array
  const fullData = new Uint8Array(totalDataLength);
  let offset = 0;
  for(let i=0; i<framesData.length; i++){
     fullData.set(framesData[i], offset);
     offset += framesData[i].length;
  }

  // Start BLE Transmission
  exportStatusText.innerText = `Envoi BLE (${totalDataLength} octets)...`;
  try {
     await videoControlCharacteristic.writeValue(new Uint8Array([1])); // Start
     
     const CHUNK_SIZE = 500; // Safe chunk size for BLE
     let sentOffset = 0;
     
     while(sentOffset < totalDataLength) {
         let chunkEnd = sentOffset + CHUNK_SIZE;
         if(chunkEnd > totalDataLength) chunkEnd = totalDataLength;
         
         const chunk = fullData.subarray(sentOffset, chunkEnd);
         await videoDataCharacteristic.writeValue(chunk);
         
         sentOffset = chunkEnd;
         
         const progress = Math.round((sentOffset / totalDataLength) * 100);
         exportProgressBar.style.width = `${progress}%`;
         exportProgressText.innerText = `${progress}%`;
     }
     
     await videoControlCharacteristic.writeValue(new Uint8Array([0])); // Stop
     
     exportProgressBar.style.width = '100%';
     exportProgressText.innerText = '100%';
     exportStatusText.innerText = `Terminé ! ${totalFrames} frames envoyées via BLE.`;
  } catch (err) {
     console.error('Erreur BLE:', err);
     exportStatusText.innerText = `Erreur : ${err.message}`;
     try { await videoControlCharacteristic.writeValue(new Uint8Array([0])); } catch(e){} // Safety attempt
  }

  btnStreamBle.disabled = false;
  renderCanvas();
}

// =========================================================================
// === EXTRAS : easing, presets, palette, save/load, dithering, zoom, GIF ===
// =========================================================================

// ---- Animation presets (V3 : pose des keyframes) ----
function presetScroll(direction) {
  const obj = getObject(selectedItemId);
  if (!obj) { showModal('Notice', 'Sélectionne un item d\'abord.', false); return; }
  const it = currentItems().find(i => i.sourceId === obj.id);
  if (!it) return;
  const b = getItemBounds(it);
  const y = Math.round(b.y);
  const color = it.color || '#ffffff';
  const startF = currentFrameIndex;
  const endF = currentFrameIndex + 39;
  let startX, endX;
  if (direction === 'left') {
    startX = WIDTH; endX = -Math.round(b.width);
  } else {
    startX = -Math.round(b.width); endX = WIDTH;
  }
  pushUndo();
  setKeyframe(obj, 'x', startF, startX, 'linear');
  setKeyframe(obj, 'y', startF, y, 'linear');
  setKeyframe(obj, 'color', startF, color, 'linear');
  setKeyframe(obj, 'x', endF, endX, 'linear');
  setKeyframe(obj, 'y', endF, y, 'linear');
  setKeyframe(obj, 'color', endF, color, 'linear');
  if (project.frameCount <= endF) project.frameCount = endF + 1;
  renderCanvas();
  renderTimeline();
  updateKeyframeEditor();
}

function presetBlink() {
  const obj = getObject(selectedItemId);
  if (!obj) { showModal('Notice','Sélectionne un item.', false); return; }
  pushUndo();
  const total = 8;
  for (let i = 0; i < total; i++) {
    setKeyframe(obj, 'opacity', currentFrameIndex + i, i % 2 === 0 ? 1 : 0, 'linear');
  }
  const endF = currentFrameIndex + total - 1;
  if (project.frameCount <= endF) project.frameCount = endF + 1;
  renderCanvas();
  renderTimeline();
  updateKeyframeEditor();
}

function presetFade(dir) {
  const obj = getObject(selectedItemId);
  if (!obj) { showModal('Notice','Sélectionne un item.', false); return; }
  pushUndo();
  const startF = currentFrameIndex;
  const endF = currentFrameIndex + 19;
  if (dir === 'in') {
    setKeyframe(obj, 'opacity', startF, 0, 'linear');
    setKeyframe(obj, 'opacity', endF,   1, 'ease-in-out');
  } else {
    setKeyframe(obj, 'opacity', startF, 1, 'linear');
    setKeyframe(obj, 'opacity', endF,   0, 'ease-in-out');
  }
  if (project.frameCount <= endF) project.frameCount = endF + 1;
  renderCanvas();
  renderTimeline();
  updateKeyframeEditor();
}

// ---- Palette ----
function renderPalette() {
  if (!paletteContainer) return;
  paletteContainer.innerHTML = '';
  project.recentColors.forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'palette-chip';
    chip.style.backgroundColor = c;
    chip.title = c;
    chip.setAttribute('aria-label', `Utiliser ${c}`);
    chip.addEventListener('click', () => applyColorToActiveTool(c));
    paletteContainer.appendChild(chip);
  });
}

// ---- Save / Load projet .json (v3) ----
// Le format v3 sérialise le `project` directement. Les anciennes versions
// (frames[]) ne sont volontairement plus chargées.
function serializeProject() {
  return JSON.parse(JSON.stringify(project));
}

async function loadProjectFromObject(obj) {
  if (!obj || obj.version !== SCENE_VERSION || !Array.isArray(obj.objects)) {
    showModal('Erreur', `Fichier projet invalide ou format obsolète (v${obj && obj.version}). Cette version requiert v${SCENE_VERSION}.`, false);
    return;
  }
  // Reconstruit imageCache depuis les dataURL
  imageCache.clear();
  const imgEntries = Object.entries(obj.imageDataUrls || {});
  await Promise.all(imgEntries.map(([id, dataUrl]) => new Promise(res => {
    const im = new Image();
    im.onload = () => { imageCache.set(id, im); res(); };
    im.onerror = () => res();
    im.src = dataUrl;
  })));
  project = obj;
  // Garanties minimales sur les champs (au cas où le fichier est corrompu)
  if (typeof project.frameCount !== 'number' || project.frameCount < 1) project.frameCount = 1;
  if (typeof project.fps !== 'number')   project.fps = 20;
  if (!Array.isArray(project.recentColors) || project.recentColors.length === 0) {
    project.recentColors = ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800'];
  }
  if (!project.imageDataUrls) project.imageDataUrls = {};
  currentFrameIndex = 0;
  if (inputFps) inputFps.value = project.fps;
  renderPalette();
  undoStack = []; redoStack = [];
  updateUndoButtons();
  clearSelection();
  updateUI();
}

function saveProjectToFile() {
  const blob = new Blob([JSON.stringify(serializeProject())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'glougloubus-scene.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerLoadProject() {
  if (fileLoadProject) fileLoadProject.click();
}

async function handleLoadProjectFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    await loadProjectFromObject(obj);
  } catch (err) {
    console.error(err);
    showModal('Erreur', `Lecture impossible : ${err.message}`, false);
  }
  e.target.value = '';
}

async function newProject() {
  const ok = await showModal('Nouveau projet', 'Vider le projet en cours ? (cela efface tout, undo inclus)', true);
  if (!ok) return;
  project = createEmptyProject({ width: WIDTH, height: HEIGHT, fps: 20, frameCount: 1 });
  currentFrameIndex = 0;
  undoStack = []; redoStack = [];
  imageCache.clear();
  clearSelection();
  updateUndoButtons();
  renderPalette();
  updateUI();
  localStorage.removeItem(AUTOSAVE_KEY);
}

// ---- Autosave (v3) ---- (clés déclarées en tête du fichier pour TDZ)
let autosaveTimer = null;
function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeProject()));
      localStorage.setItem(AUTOSAVE_TS_KEY, String(Date.now()));
    } catch (err) {
      // localStorage quota — silencieux, les images peuvent exploser la taille
      console.warn('Autosave skipped:', err.message);
    }
  }, 1500);
}

async function tryRestoreAutosave() {
  // Purge automatique des anciens autosaves v1/v2 (incompatibles)
  localStorage.removeItem('glougloubus-autosave');
  localStorage.removeItem('glougloubus-autosave-ts');

  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (obj.version !== SCENE_VERSION || !Array.isArray(obj.objects) || obj.objects.length === 0) return;
    const ts = parseInt(localStorage.getItem(AUTOSAVE_TS_KEY) || '0', 10);
    const ago = Math.round((Date.now() - ts) / 1000);
    const ok = await showModal('Restaurer l\'autosave',
      `Un projet sauvegardé automatiquement a été trouvé (il y a ${ago}s, ${obj.objects.length} objet(s)). Le restaurer ?`,
      true);
    if (ok) await loadProjectFromObject(obj);
  } catch {}
}

// ---- Fullscreen ----
async function toggleFullscreen() {
  const el = canvasWrapper || canvas.parentElement;
  if (!document.fullscreenElement) {
    document.body.classList.add('preview-mode');
    try { await (el.requestFullscreen ? el.requestFullscreen() : Promise.resolve()); } catch {}
  } else {
    document.body.classList.remove('preview-mode');
    try { await document.exitFullscreen(); } catch {}
  }
  setTimeout(renderCanvas, 50);
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('preview-mode');
  setTimeout(renderCanvas, 50);
});

// ---- Zoom / Pan ----
// Le container est flex-centré dans le wrapper. On utilise transform-origin:
// center pour que scale() ne déplace pas le centre (sinon le coin haut-gauche
// reste fixe et le container déborde toujours en bas-droite). viewPanX/Y est
// alors un offset SUPPLÉMENTAIRE par rapport à la position centrée.
function applyCanvasTransform() {
  if (!canvasWrapper) return;
  const container = canvasWrapper.querySelector('.canvas-container');
  if (!container) return;
  container.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
  container.style.transformOrigin = '50% 50%';
}
function setZoom(z, centerX, centerY) {
  const newZ = Math.max(0.5, Math.min(8, z));
  if (canvasWrapper) {
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    // Référentiel "depuis le centre du wrapper" : dx, dy = offset du point
    // d'ancrage par rapport au centre du wrapper.
    let dx, dy;
    if (centerX !== undefined) {
      dx = (centerX - wrapperRect.left) - wrapperRect.width / 2;
      dy = (centerY - wrapperRect.top)  - wrapperRect.height / 2;
    } else {
      // Boutons +/- : ancre = centre wrapper → offset nul → reste centré.
      dx = 0;
      dy = 0;
    }
    const ratio = newZ / viewZoom;
    viewPanX = dx - (dx - viewPanX) * ratio;
    viewPanY = dy - (dy - viewPanY) * ratio;
  }
  viewZoom = newZ;
  applyCanvasTransform();
}
function resetZoom() { viewZoom = 1; viewPanX = 0; viewPanY = 0; applyCanvasTransform(); }

function initZoomPan() {
  if (!canvasWrapper) return;

  canvasWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(viewZoom * factor, e.clientX, e.clientY);
  }, { passive: false });

  // Pinch-zoom 2 doigts — capture sur wrapper (laisse le canvas gérer ses pointer events 1 doigt)
  const active = new Map(); // pointerId -> {x,y}
  let pinchStart = null;
  canvasWrapper.addEventListener('pointerdown', (e) => {
    if (e.target === canvas) return; // canvas gère ses propres events
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvasWrapper.setPointerCapture(e.pointerId);
  });
  canvasWrapper.addEventListener('pointermove', (e) => {
    if (!active.has(e.pointerId)) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size === 2) {
      const pts = [...active.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      if (!pinchStart) pinchStart = { dist, zoom: viewZoom };
      const ratio = dist / pinchStart.dist;
      setZoom(pinchStart.zoom * ratio, cx, cy);
    }
  });
  const endPinch = (e) => {
    active.delete(e.pointerId);
    if (active.size < 2) pinchStart = null;
  };
  canvasWrapper.addEventListener('pointerup', endPinch);
  canvasWrapper.addEventListener('pointercancel', endPinch);

  if (btnZoomIn) btnZoomIn.addEventListener('click', () => setZoom(viewZoom * 1.25));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => setZoom(viewZoom / 1.25));
  if (btnZoomReset) btnZoomReset.addEventListener('click', resetZoom);
}

// ---- BLE test pattern ----
async function sendBleTestPattern() {
  if (!isBleConnected) { showModal('Notice', 'Non connecté.', false); return; }
  const useCustomMapping = exportMapping ? exportMapping.value === 'custom' : true;
  const totalPixels = WIDTH * HEIGHT;
  const bytes = new Uint8Array(totalPixels * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      // Damier coloré : 8×8 blocs, couleur HSL en fonction de (col_block + row_block*12)
      const cb = Math.floor(x / 8), rb = Math.floor(y / 8);
      const hue = ((cb + rb * 12) * 31) % 360;
      const [r, g, b] = hslToRgb(hue, 70, 50);
      const idx = useCustomMapping ? mapToLedIndex(x, y) : (y * WIDTH + x);
      if (idx < 0 || idx >= totalPixels) continue;
      bytes[idx*3]   = r;
      bytes[idx*3+1] = g;
      bytes[idx*3+2] = b;
    }
  }
  try {
    await videoControlCharacteristic.writeValue(new Uint8Array([1]));
    const CHUNK = 500;
    for (let off = 0; off < bytes.length; off += CHUNK) {
      await videoDataCharacteristic.writeValue(bytes.subarray(off, Math.min(off + CHUNK, bytes.length)));
    }
    await videoControlCharacteristic.writeValue(new Uint8Array([0]));
  } catch (err) {
    showModal('Erreur BLE', err.message, false);
  }
}
// ---- Export GIF ----
async function exportGif() {
  if (project.frameCount === 0) { showModal('Notice', 'Aucune frame.', false); return; }
  if (btnExportGif) btnExportGif.disabled = true;
  if (exportStatusText) exportStatusText.innerText = 'Génération GIF…';
  if (exportProgressContainer) exportProgressContainer.hidden = false;

  const totalFrames = project.frameCount;

  // Collecte toutes les frames en RGBA + construit palette globale
  const framesRgb = [];
  for (let i = 0; i < totalFrames; i++) {
    drawFrameToContext(offCtx, i, false);
    framesRgb.push(offCtx.getImageData(0, 0, WIDTH, HEIGHT));
    if (exportProgressBar) exportProgressBar.style.width = `${Math.round((i+1)/totalFrames*40)}%`;
  }

  // Palette 256 via median-cut sur pixels concaténés
  const allPixels = new Uint8ClampedArray(framesRgb.length * WIDTH * HEIGHT * 4);
  framesRgb.forEach((f, i) => allPixels.set(f.data, i * f.data.length));
  const palette = buildPaletteMedianCut(allPixels, 256);
  // Index indirecte pour lookup rapide
  const paletteFlat = new Uint8Array(768);
  palette.forEach((c, i) => { paletteFlat[i*3] = c[0]; paletteFlat[i*3+1] = c[1]; paletteFlat[i*3+2] = c[2]; });

  // Délai par frame (en centièmes de secondes)
  const delayCs = Math.max(2, Math.round(100 / project.fps));

  // Construction du GIF (LZW)
  const enc = new GifEncoder(WIDTH, HEIGHT, paletteFlat, palette.length, delayCs);
  for (let i = 0; i < framesRgb.length; i++) {
    const indices = new Uint8Array(WIDTH * HEIGHT);
    const d = framesRgb[i].data;
    for (let p = 0, j = 0; p < d.length; p += 4, j++) {
      indices[j] = nearestPaletteIdx(d[p], d[p+1], d[p+2], palette);
    }
    enc.addFrame(indices);
    if (exportProgressBar) exportProgressBar.style.width = `${40 + Math.round((i+1)/framesRgb.length*60)}%`;
  }
  const blob = enc.finish();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'glougloubus.gif'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  if (exportStatusText) exportStatusText.innerText = `Terminé ! GIF ${totalFrames} frames.`;
  if (exportProgressBar) exportProgressBar.style.width = '100%';
  if (btnExportGif) btnExportGif.disabled = false;
}
// ---- Keyboard shortcuts ----
function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    const inInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (ctrl && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo(); return;
    }
    if (ctrl && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); saveProjectToFile(); return;
    }
    if (ctrl && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault(); duplicateFrame(); return;
    }
    if (ctrl && (e.key === 'c' || e.key === 'C') && selectedItemId && !inInput) {
      const obj = getObject(selectedItemId);
      if (obj) clipboardItem = JSON.parse(JSON.stringify(obj));
      return;
    }
    if (ctrl && (e.key === 'v' || e.key === 'V') && clipboardItem && !inInput) {
      e.preventDefault();
      pushUndo();
      const copy = JSON.parse(JSON.stringify(clipboardItem));
      copy.id = generateId();
      // Décale x/y du clone à la frame courante (sur le track) pour éviter
      // de superposer pile sur l'original.
      const curX = getValueAt(copy.tracks && copy.tracks.x, currentFrameIndex, 0);
      const curY = getValueAt(copy.tracks && copy.tracks.y, currentFrameIndex, 0);
      setKeyframe(copy, 'x', currentFrameIndex, curX + 2);
      setKeyframe(copy, 'y', currentFrameIndex, curY + 2);
      project.objects.push(copy);
      setSingleSelection(copy.id);
      renderCanvas(); updateTimelineThumb(currentFrameIndex); updateSelectionUI();
      return;
    }

    if (inInput) return;

    if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'Escape') {
      if (document.fullscreenElement) return;
      clearSelection();
      shapePreview = null;
      updateSelectionUI();
      renderCanvas();
      return;
    }
    if (e.key === 'ArrowLeft' && selectedItemId) {
      e.preventDefault(); nudgeSelected(e.shiftKey ? -10 : -1, 0); return;
    }
    if (e.key === 'ArrowRight' && selectedItemId) {
      e.preventDefault(); nudgeSelected(e.shiftKey ? 10 : 1, 0); return;
    }
    if (e.key === 'ArrowUp' && selectedItemId) {
      e.preventDefault(); nudgeSelected(0, e.shiftKey ? -10 : -1); return;
    }
    if (e.key === 'ArrowDown' && selectedItemId) {
      e.preventDefault(); nudgeSelected(0, e.shiftKey ? 10 : 1); return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      currentFrameIndex = Math.max(0, currentFrameIndex - 1); updateUI(); return;
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      currentFrameIndex = Math.min(project.frameCount - 1, currentFrameIndex + 1); updateUI(); return;
    }
  });
}

function nudgeSelected(dx, dy) {
  if (selectedIds.size === 0) return;
  pushUndo();
  for (const id of selectedIds) {
    const obj = getObject(id);
    if (!obj || obj.locked) continue;
    if (obj.type === 'shape') {
      const curX1 = getValueAt(obj.tracks.x1, currentFrameIndex, 0);
      const curY1 = getValueAt(obj.tracks.y1, currentFrameIndex, 0);
      const curX2 = getValueAt(obj.tracks.x2, currentFrameIndex, 0);
      const curY2 = getValueAt(obj.tracks.y2, currentFrameIndex, 0);
      updateObjectProp(obj, 'x1', curX1 + dx);
      updateObjectProp(obj, 'y1', curY1 + dy);
      updateObjectProp(obj, 'x2', curX2 + dx);
      updateObjectProp(obj, 'y2', curY2 + dy);
    } else {
      const curX = getValueAt(obj.tracks.x, currentFrameIndex, 0);
      const curY = getValueAt(obj.tracks.y, currentFrameIndex, 0);
      updateObjectProp(obj, 'x', curX + dx);
      updateObjectProp(obj, 'y', curY + dy);
    }
  }
  const primary = getObject(selectedItemId);
  if (primary) {
    const it = currentItems().find(i => i.sourceId === primary.id);
    if (it) populatePropertiesPanel(it);
  }
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
  updateSelectionUI();
}

// =========================================================================
// === Phase 5 — Transforms avancés : flip, align, distribute, snap-objs ===
// =========================================================================

// Toggle flip H/V sur tous les sélectionnés (statique).
function toggleFlip(axis /* 'x' | 'y' */) {
  if (selectedIds.size === 0) return;
  pushUndo();
  for (const id of selectedIds) {
    const obj = getObject(id);
    if (!obj || obj.locked) continue;
    if (obj.type === 'group') continue; // pas de flip sur les groupes pour l'instant
    if (axis === 'x') obj.static.flipX = !obj.static.flipX;
    else              obj.static.flipY = !obj.static.flipY;
  }
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
  updateLayersPanel();
}

// Translate un objet (x/y ou x1/x2/y1/y2 pour shape) à la frame courante en
// décalant la valeur courante du delta donné. Utilise updateObjectProp pour
// poser un keyframe si la track est animée, sinon écrit la propriété statique.
function translateObject(obj, dx, dy) {
  if (!obj || obj.locked) return;
  if (obj.type === 'shape') {
    const x1 = getValueAt(obj.tracks.x1, currentFrameIndex, 0);
    const y1 = getValueAt(obj.tracks.y1, currentFrameIndex, 0);
    const x2 = getValueAt(obj.tracks.x2, currentFrameIndex, 0);
    const y2 = getValueAt(obj.tracks.y2, currentFrameIndex, 0);
    updateObjectProp(obj, 'x1', Math.round(x1 + dx));
    updateObjectProp(obj, 'y1', Math.round(y1 + dy));
    updateObjectProp(obj, 'x2', Math.round(x2 + dx));
    updateObjectProp(obj, 'y2', Math.round(y2 + dy));
  } else if (obj.type === 'group') {
    const x = getValueAt(obj.tracks.x, currentFrameIndex, 0);
    const y = getValueAt(obj.tracks.y, currentFrameIndex, 0);
    updateObjectProp(obj, 'x', Math.round(x + dx));
    updateObjectProp(obj, 'y', Math.round(y + dy));
  } else {
    const x = getValueAt(obj.tracks.x, currentFrameIndex, 0);
    const y = getValueAt(obj.tracks.y, currentFrameIndex, 0);
    updateObjectProp(obj, 'x', Math.round(x + dx));
    updateObjectProp(obj, 'y', Math.round(y + dy));
  }
}

// Renvoie le bbox unrotaté (en coords logiques) d'un id sélectionné, ou null.
function getSelectionBoundsById(id) {
  const it = currentItems().find(i => i.sourceId === id);
  if (!it) return null;
  return getItemBounds(it);
}

// Bbox commun de tous les ids sélectionnés (union AABB).
function getCommonBounds(ids) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const b = getSelectionBoundsById(id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Aligne la sélection. Mode = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom'.
// Référence : si ≥2 items sélectionnés → bbox commun ; si 1 → canvas (192×32).
function alignSelection(mode) {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds].filter(id => {
    const o = getObject(id);
    return o && !o.locked && o.type !== 'group';
  });
  if (ids.length === 0) return;

  let ref;
  if (ids.length >= 2) {
    ref = getCommonBounds(ids);
  } else {
    ref = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  }
  if (!ref) return;

  pushUndo();
  for (const id of ids) {
    const obj = getObject(id);
    const b = getSelectionBoundsById(id);
    if (!obj || !b) continue;
    let dx = 0, dy = 0;
    switch (mode) {
      case 'left':    dx = ref.x - b.x; break;
      case 'centerH': dx = (ref.x + ref.width / 2) - (b.x + b.width / 2); break;
      case 'right':   dx = (ref.x + ref.width) - (b.x + b.width); break;
      case 'top':     dy = ref.y - b.y; break;
      case 'centerV': dy = (ref.y + ref.height / 2) - (b.y + b.height / 2); break;
      case 'bottom':  dy = (ref.y + ref.height) - (b.y + b.height); break;
    }
    if (dx || dy) translateObject(obj, dx, dy);
  }
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
  updateSelectionUI();
}

// Distribue uniformément les items sélectionnés sur l'axe donné.
// Algorithme classique : trie par centre, garde les extrêmes en place,
// répartit les centres des intermédiaires à intervalles égaux.
function distributeSelection(axis /* 'h' | 'v' */) {
  const ids = [...selectedIds].filter(id => {
    const o = getObject(id);
    return o && !o.locked && o.type !== 'group';
  });
  if (ids.length < 3) {
    showModal('Notice', 'Sélectionne au moins 3 objets pour distribuer.', false);
    return;
  }
  const entries = ids.map(id => {
    const b = getSelectionBoundsById(id);
    if (!b) return null;
    const center = axis === 'h' ? (b.x + b.width / 2) : (b.y + b.height / 2);
    return { id, center };
  }).filter(Boolean);
  entries.sort((a, b) => a.center - b.center);

  const first = entries[0].center;
  const last = entries[entries.length - 1].center;
  const step = (last - first) / (entries.length - 1);

  pushUndo();
  for (let i = 1; i < entries.length - 1; i++) {
    const target = first + step * i;
    const obj = getObject(entries[i].id);
    const delta = target - entries[i].center;
    if (Math.abs(delta) < 0.5) continue;
    if (axis === 'h') translateObject(obj, delta, 0);
    else              translateObject(obj, 0, delta);
  }
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
  updateSelectionUI();
}

// ---- Snap aux objets pendant un drag ----
// snapToObjects: bool ; tolérance ~2 px logiques.
let snapToObjectsEnabled = false;
const SNAP_OBJ_TOL = 2;

// Renvoie {dx, dy} : ajustement à appliquer au delta de drag pour qu'au moins
// un bord/centre du groupe sélectionné s'aligne avec un bord/centre d'un objet
// non-sélectionné. Retourne { dx: 0, dy: 0 } si aucun snap.
// movingBounds = bbox courant du primary après application du delta brut.
function computeObjectSnap(movingBounds) {
  if (!snapToObjectsEnabled || !movingBounds) return { dx: 0, dy: 0, hits: [] };
  const items = currentItems();
  const targetsX = []; // { v, type } — bords/centres verticaux des autres objets
  const targetsY = [];
  for (const it of items) {
    if (selectedIds.has(it.sourceId)) continue;
    const b = getItemBounds(it);
    if (!b) continue;
    targetsX.push(b.x, b.x + b.width / 2, b.x + b.width);
    targetsY.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  if (targetsX.length === 0) return { dx: 0, dy: 0, hits: [] };

  const candidatesX = [movingBounds.x, movingBounds.x + movingBounds.width / 2, movingBounds.x + movingBounds.width];
  const candidatesY = [movingBounds.y, movingBounds.y + movingBounds.height / 2, movingBounds.y + movingBounds.height];

  let bestDx = 0, bestDxAbs = SNAP_OBJ_TOL + 0.001;
  let bestDy = 0, bestDyAbs = SNAP_OBJ_TOL + 0.001;
  for (const c of candidatesX) for (const t of targetsX) {
    const d = t - c;
    if (Math.abs(d) < bestDxAbs) { bestDx = d; bestDxAbs = Math.abs(d); }
  }
  for (const c of candidatesY) for (const t of targetsY) {
    const d = t - c;
    if (Math.abs(d) < bestDyAbs) { bestDy = d; bestDyAbs = Math.abs(d); }
  }
  return { dx: bestDx, dy: bestDy };
}

// ---- Group / Ungroup (Phase 4) ----
function groupSelection() {
  if (selectedIds.size < 2) {
    showModal('Notice', 'Sélectionne au moins 2 objets pour les grouper.', false);
    return;
  }
  pushUndo();
  const ids = [...selectedIds];
  // Trie les enfants dans leur ordre actuel dans objects[] pour préserver z-order relatif
  const positions = ids.map(id => ({ id, idx: project.objects.findIndex(o => o.id === id) })).filter(p => p.idx !== -1);
  positions.sort((a, b) => a.idx - b.idx);

  // Position d'insertion = juste APRÈS l'enfant le plus en avant-plan, pour
  // que dans le panel UI (top-first) le group apparaisse au-dessus de ses enfants.
  const maxIdx = positions[positions.length - 1].idx;

  // Crée un group avec position 0,0 (juste pour avoir des tracks valides).
  const group = createObject('group', { name: 'Groupe' });
  setKeyframe(group, 'x', currentFrameIndex, 0);
  setKeyframe(group, 'y', currentFrameIndex, 0);
  setKeyframe(group, 'opacity', currentFrameIndex, 1);

  // Marque les enfants : parentId vers le group
  for (const { id } of positions) {
    const o = project.objects.find(x => x.id === id);
    if (o) o.parentId = group.id;
  }
  // Insère le group à maxIdx + 1
  project.objects.splice(maxIdx + 1, 0, group);

  setSingleSelection(group.id);
  renderCanvas();
  updateLayersPanel();
  updateSelectionUI();
  updateTimelineThumb(currentFrameIndex);
}

function ungroupSelection() {
  if (selectedIds.size === 0) return;
  let didSomething = false;
  pushUndo();
  const idsSnapshot = [...selectedIds];
  for (const id of idsSnapshot) {
    const obj = getObject(id);
    if (!obj) continue;
    if (obj.type === 'group') {
      // Restore tous les enfants à parentId=null et supprime le group
      const children = project.objects.filter(o => o.parentId === id);
      for (const c of children) c.parentId = null;
      project.objects = project.objects.filter(o => o.id !== id);
      removeFromSelection(id);
      // Sélectionne les enfants à la place
      children.forEach(c => addSelection(c.id));
      didSomething = true;
    } else if (obj.parentId) {
      // Item enfant d'un group : juste détacher
      obj.parentId = null;
      didSomething = true;
    }
  }
  if (!didSomething) {
    // Rollback du pushUndo
    if (undoStack.length > 0) undoStack.pop();
    updateUndoButtons();
    showModal('Notice', 'Rien à dégrouper dans la sélection.', false);
    return;
  }
  renderCanvas();
  updateLayersPanel();
  updateSelectionUI();
  updateTimelineThumb(currentFrameIndex);
}

// ---- PWA ----
function registerPwa() {
  if (!('serviceWorker' in navigator)) return;
  // En dev, le SW casse les hot-updates Vite (cache-first sur same-origin).
  // Désinscrire tout SW existant + skip register.
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(r => r.unregister()))
      .catch(() => {});
    if (window.caches) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
    }
    return;
  }
  const base = import.meta.env.BASE_URL || '/';
  navigator.serviceWorker.register(base + 'sw.js').catch(err => console.warn('SW register failed:', err));
}

// ---- initExtras : binde tous les extras aux contrôles ----
function initExtras() {
  // Undo/redo buttons
  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);
  updateUndoButtons();

  // Bouton supprimer sélection (proche du canvas)
  if (btnDeleteSelected) btnDeleteSelected.addEventListener('click', deleteSelectedItem);

  // Save/load project
  if (btnSaveProject) btnSaveProject.addEventListener('click', saveProjectToFile);
  if (btnLoadProject) btnLoadProject.addEventListener('click', triggerLoadProject);
  if (fileLoadProject) fileLoadProject.addEventListener('change', handleLoadProjectFile);
  if (btnNewProject) btnNewProject.addEventListener('click', newProject);

  // Tool buttons
  if (toolButtons && toolButtons.length) {
    toolButtons.forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });
  }
  setTool('select');

  // Palette
  renderPalette();

  // Snap / onion
  if (snapSelect) {
    snapSelect.addEventListener('change', () => { snapSize = parseInt(snapSelect.value, 10) || 0; });
  }
  if (toggleOnion) {
    toggleOnion.addEventListener('change', () => { onionSkinEnabled = toggleOnion.checked; renderCanvas(); });
  }
  if (toggleSnapObjects) {
    toggleSnapObjects.addEventListener('change', () => { snapToObjectsEnabled = toggleSnapObjects.checked; });
  }

  // Transform controls (Phase 5)
  if (propRotation) {
    propRotation.addEventListener('focus', () => { if (selectedItemId) pushUndo(); });
    propRotation.addEventListener('input', () => {
      const obj = getObject(selectedItemId);
      if (!obj) return;
      const v = parseFloat(propRotation.value);
      if (Number.isNaN(v)) return;
      updateObjectProp(obj, 'rotation', v);
      renderCanvas();
      updateTimelineThumb(currentFrameIndex);
    });
  }
  if (btnRotReset) btnRotReset.addEventListener('click', () => {
    const obj = getObject(selectedItemId);
    if (!obj) return;
    pushUndo();
    updateObjectProp(obj, 'rotation', 0);
    if (propRotation) propRotation.value = '0';
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
  });
  if (btnFlipH) btnFlipH.addEventListener('click', () => toggleFlip('x'));
  if (btnFlipV) btnFlipV.addEventListener('click', () => toggleFlip('y'));
  if (alignButtons) alignButtons.forEach(b => {
    b.addEventListener('click', () => alignSelection(b.dataset.align));
  });
  if (btnDistH) btnDistH.addEventListener('click', () => distributeSelection('h'));
  if (btnDistV) btnDistV.addEventListener('click', () => distributeSelection('v'));

  // Fullscreen
  if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);

  // Zoom/Pan
  initZoomPan();

  // Animation presets + easing
  if (btnPresetScrollL) btnPresetScrollL.addEventListener('click', () => presetScroll('left'));
  if (btnPresetScrollR) btnPresetScrollR.addEventListener('click', () => presetScroll('right'));
  if (btnPresetBlink) btnPresetBlink.addEventListener('click', presetBlink);
  if (btnPresetFadeIn) btnPresetFadeIn.addEventListener('click', () => presetFade('in'));
  if (btnPresetFadeOut) btnPresetFadeOut.addEventListener('click', () => presetFade('out'));

  // BLE test pattern
  if (btnBleTestPattern) {
    btnBleTestPattern.disabled = true;
    btnBleTestPattern.addEventListener('click', sendBleTestPattern);
  }
  setBleStatus('disconnected', 'Not connected');

  // GIF export
  if (btnExportGif) btnExportGif.addEventListener('click', exportGif);

  // Keyboard shortcuts
  initShortcuts();

  // Layers panel toolbar (Phase 3)
  if (btnLayerUp) btnLayerUp.addEventListener('click', () => {
    if (!selectedItemId) return;
    const idx = project.objects.findIndex(o => o.id === selectedItemId);
    if (idx === -1 || idx === project.objects.length - 1) return;
    pushUndo();
    const [obj] = project.objects.splice(idx, 1);
    project.objects.splice(idx + 1, 0, obj);
    renderCanvas();
    updateLayersPanel();
    updateTimelineThumb(currentFrameIndex);
  });
  if (btnLayerDown) btnLayerDown.addEventListener('click', () => {
    if (!selectedItemId) return;
    const idx = project.objects.findIndex(o => o.id === selectedItemId);
    if (idx <= 0) return;
    pushUndo();
    const [obj] = project.objects.splice(idx, 1);
    project.objects.splice(idx - 1, 0, obj);
    renderCanvas();
    updateLayersPanel();
    updateTimelineThumb(currentFrameIndex);
  });
  if (btnLayerDuplicate) btnLayerDuplicate.addEventListener('click', () => {
    if (!selectedItemId) return;
    const obj = getObject(selectedItemId);
    if (!obj) return;
    pushUndo();
    const copy = JSON.parse(JSON.stringify(obj));
    copy.id = generateId();
    if (copy.tracks && copy.tracks.x) {
      const curX = getValueAt(copy.tracks.x, currentFrameIndex, 0);
      setKeyframe(copy, 'x', currentFrameIndex, curX + 2);
    }
    if (copy.tracks && copy.tracks.y) {
      const curY = getValueAt(copy.tracks.y, currentFrameIndex, 0);
      setKeyframe(copy, 'y', currentFrameIndex, curY + 2);
    }
    const origIdx = project.objects.findIndex(o => o.id === selectedItemId);
    project.objects.splice(origIdx + 1, 0, copy);
    setSingleSelection(copy.id);
    renderCanvas();
    updateSelectionUI();
    updateTimelineThumb(currentFrameIndex);
  });
  if (btnLayerDelete) btnLayerDelete.addEventListener('click', deleteSelectedItem);
  if (btnLayerGroup) btnLayerGroup.addEventListener('click', groupSelection);
  if (btnLayerUngroup) btnLayerUngroup.addEventListener('click', ungroupSelection);

  // Bottom sheet (mobile UI)
  initBottomSheet({ onTabChange: tab => { if (tab === 'anim') updateKeyframeEditor(); } });

  // Autosave restore + register PWA
  tryRestoreAutosave();
  registerPwa();
}

// (initBottomSheet est dans modules/sheet.js — l'auto-open est appelé depuis updateSelectionUI)
