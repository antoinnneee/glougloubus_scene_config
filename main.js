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

// Animation
const animStartX = document.getElementById('anim-start-x');
const animStartY = document.getElementById('anim-start-y');
const animEndX = document.getElementById('anim-end-x');
const animEndY = document.getElementById('anim-end-y');
const animStartColor = document.getElementById('anim-start-color');
const animEndColor = document.getElementById('anim-end-color');
const animMode = document.getElementById('anim-mode');
const animValue = document.getElementById('anim-value');
const btnAnimSetStart = document.getElementById('btn-anim-set-start');
const btnAnimSetEnd = document.getElementById('btn-anim-set-end');
const btnAnimApplyStart = document.getElementById('btn-anim-apply-start');
const btnAnimApplyEnd = document.getElementById('btn-anim-apply-end');
const btnGenerateAnim = document.getElementById('btn-generate-anim');
const animEasing = document.getElementById('anim-easing');
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
const btnFullscreen = document.getElementById('btn-fullscreen');
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

// --- State ---
// A frame is now an ARRAY of objects: { id, type, x, y, ...specificProps }
let frames = [];
let currentFrameIndex = 0;
let isPlaying = false;
let fps = 20;
let playInterval = null;

// Image cache — items stockent un imgId (string) au lieu d'un HTMLImageElement
// pour pouvoir sérialiser frames en JSON (undo/redo, save/load, autosave).
const imageCache = new Map();       // imgId -> HTMLImageElement (pour draw)
const imageDataUrls = new Map();    // imgId -> dataURL base64 (pour export/import)

// Undo / Redo
const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];

// Clipboard pour copy/paste d'item
let clipboardItem = null;

// Palette : 8 couleurs récentes (plus récente en premier)
let recentColors = ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800'];

// Snap & onion-skin
let snapSize = 0;          // 0 = off, sinon 1, 8 ou 16
let onionSkinEnabled = false;

// Zoom / pan du canvas (CSS transform sur wrapper)
let viewZoom = 1;
let viewPanX = 0;
let viewPanY = 0;

// Object Selection and Tool State
let selectedItemId = null;
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

// Offscreen canvas for thumbnail generation and hit testing text measurement
const offCanvas = document.createElement('canvas');
offCanvas.width = WIDTH;
offCanvas.height = HEIGHT;
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

// --- Utils ---
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// Deep clone des frames — les items sont full JSON-safe (imgId au lieu d'HTMLImageElement)
function snapshotFrames() {
  return JSON.parse(JSON.stringify(frames));
}

function pushUndo() {
  undoStack.push(snapshotFrames());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
  scheduleAutosave();
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(snapshotFrames());
  frames = undoStack.pop();
  if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
  selectedItemId = null;
  updateUI();
  updateUndoButtons();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotFrames());
  frames = redoStack.pop();
  if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
  selectedItemId = null;
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
  const idx = recentColors.indexOf(color);
  if (idx !== -1) recentColors.splice(idx, 1);
  recentColors.unshift(color);
  recentColors = recentColors.slice(0, 8);
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
  // Start with one blank frame
  frames.push([]);
  updateUI();

  // Event Listeners
  btnAddFrame.addEventListener('click', addFrame);
  btnDupFrame.addEventListener('click', duplicateFrame);
  btnDelFrame.addEventListener('click', deleteFrame);
  btnClear.addEventListener('click', clearCurrentFrame);

  btnPlayPause.addEventListener('click', togglePlay);
  inputFps.addEventListener('change', (e) => { fps = parseInt(e.target.value) || 20; if(isPlaying) { stop(); play(); } });

  // Update button texts
  btnApplyImage.innerText = "Add Image";
  btnApplyText.innerText = "Add Text";
  btnApplyImage.addEventListener('click', applyImageTool);
  btnApplyText.addEventListener('click', applyTextTool);
  btnGenerateAnim.addEventListener('click', generateAnimation);
  
  btnConnectBle.addEventListener('click', connectBle);
  btnStreamBle.addEventListener('click', streamToBle);
  
  btnAnimSetStart.addEventListener('click', () => {
    if (selectedItemId) {
      const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
      if (item) {
        animStartX.value = item.x;
        animStartY.value = item.y;
        if (item.color) animStartColor.value = item.color;
      }
    }
  });
  
  btnAnimSetEnd.addEventListener('click', () => {
    if (selectedItemId) {
      const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
      if (item) {
        animEndX.value = item.x;
        animEndY.value = item.y;
        if (item.color) animEndColor.value = item.color;
      }
    }
  });

  btnAnimApplyStart.addEventListener('click', () => {
    if (selectedItemId) {
      const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
      if (item) {
        pushUndo();
        item.x = parseInt(animStartX.value) || 0;
        item.y = parseInt(animStartY.value) || 0;
        item.color = animStartColor.value;
        renderCanvas();
        updateTimelineThumb(currentFrameIndex);
        populatePropertiesPanel(item);
      }
    }
  });

  btnAnimApplyEnd.addEventListener('click', () => {
    if (selectedItemId) {
      const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
      if (item) {
        pushUndo();
        item.x = parseInt(animEndX.value) || 0;
        item.y = parseInt(animEndY.value) || 0;
        item.color = animEndColor.value;
        renderCanvas();
        updateTimelineThumb(currentFrameIndex);
        populatePropertiesPanel(item);
      }
    }
  });
  
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
  // Map CSS coordinates to logic (192x32) coordinates
  const scaleX = WIDTH / rect.width;
  const scaleY = HEIGHT / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

// Hit radius des handles de resize : cible ~24 CSS px. Converti en unités logiques
// (192×32) d'après la taille affichée réelle du canvas.
function getResizeHitRadius() {
  const rect = canvas.getBoundingClientRect();
  return Math.max(6, 24 * (WIDTH / rect.width));
}

function applySnap(v) {
  return snapSize > 1 ? Math.round(v / snapSize) * snapSize : Math.round(v);
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
    currentDrawingId = null;
    // Supprime la dernière stroke du pinceau si elle vient d'être amorcée
    if (currentTool === 'pencil' && frames[currentFrameIndex].length > 0) {
      const last = frames[currentFrameIndex][frames[currentFrameIndex].length - 1];
      if (last.type === 'drawing' && last.points.length <= 2) {
        frames[currentFrameIndex].pop();
      }
    }
    shapePreview = null;

    const pts = [...canvasPointers.values()];
    pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);

    const selItem = selectedItemId && frames[currentFrameIndex].find(i => i.id === selectedItemId);
    if (selItem && (selItem.type === 'text' || selItem.type === 'image')) {
      pinchMode = 'resize';
      pushUndo();
      pinchStartItem = {
        size: selItem.size || 16,
        scale: selItem.scale || 1,
        x: selItem.x,
        y: selItem.y
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

  // Resize handles
  if (selectedItemId) {
    const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
    if (item && (item.type === 'text' || item.type === 'image')) {
      const bounds = getItemBounds(item);
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
        resizeStartScale = item.scale || 1.0;
        resizeStartSize = item.size || 16;
        resizeItemStartX = item.x;
        resizeItemStartY = item.y;
        return;
      }
    }
  }

  if (currentTool === 'pencil') {
    pushUndo();
    pushRecentColor(pencilColor.value);
    isDragging = true;
    currentDrawingId = generateId();
    frames[currentFrameIndex].push({
      id: currentDrawingId,
      type: 'drawing',
      color: pencilColor.value,
      points: [{ x: Math.round(x), y: Math.round(y) }]
    });
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
    return;
  }

  const hitItem = findItemAtCoord(x, y);

  if (hitItem) {
    pushUndo();
    selectedItemId = hitItem.id;
    isDragging = true;
    dragStartX = x;
    dragStartY = y;
    itemStartX = hitItem.x;
    itemStartY = hitItem.y;

    if (hitItem.type === 'drawing') {
      hitItem.originalPoints = JSON.parse(JSON.stringify(hitItem.points));
    } else if (hitItem.type === 'shape') {
      hitItem.originalX1 = hitItem.x1; hitItem.originalY1 = hitItem.y1;
      hitItem.originalX2 = hitItem.x2; hitItem.originalY2 = hitItem.y2;
    }

    populatePropertiesPanel(hitItem);
  } else {
    selectedItemId = null;
  }

  updateSelectionUI();
  renderCanvas();
}

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function applyColorToActiveTool(hex) {
  pencilColor.value = hex;
  textColor.value = hex;
  const selItem = selectedItemId && frames[currentFrameIndex].find(i => i.id === selectedItemId);
  if (selItem) {
    if (selItem.type === 'text' || selItem.type === 'drawing' || selItem.type === 'shape') {
      pushUndo();
      selItem.color = hex;
      renderCanvas();
      updateTimelineThumb(currentFrameIndex);
    }
  }
}

// Flood-fill sur la représentation rasterisée de la frame courante.
// Résultat stocké comme un item 'drawing' composé des pixels remplis.
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
  frames[currentFrameIndex].push({
    id: generateId(),
    type: 'drawing',
    color: newColorHex,
    points
  });
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
      const item = selectedItemId && frames[currentFrameIndex].find(i => i.id === selectedItemId);
      if (item && pinchStartItem) {
        if (item.type === 'text') {
          item.size = Math.max(1, Math.round(pinchStartItem.size * ratio));
          if (textSize) textSize.value = item.size;
        } else if (item.type === 'image') {
          item.scale = Math.max(0.01, pinchStartItem.scale * ratio);
          if (imgScale) imgScale.value = item.scale.toFixed(2);
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

  if (isResizing && selectedItemId) {
    const dx = x - dragStartX;
    const dy = y - dragStartY;
    const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
    if (item) {
       let currentWidth = resizeStartWidth;
       
       if (resizeHandle === 'br') { currentWidth += dx; }
       else if (resizeHandle === 'tl') { currentWidth -= dx; item.x = Math.round(resizeItemStartX + dx); item.y = Math.round(resizeItemStartY + dy); }
       else if (resizeHandle === 'tr') { currentWidth += dx; item.y = Math.round(resizeItemStartY + dy); }
       else if (resizeHandle === 'bl') { currentWidth -= dx; item.x = Math.round(resizeItemStartX + dx); }
       
       if (currentWidth < 2) currentWidth = 2; // Math.max(1) for scale division safety
       
       if (item.type === 'text') {
          item.size = Math.max(1, Math.round(resizeStartSize * (currentWidth / Math.max(1, resizeStartWidth))));
          textSize.value = item.size;
          textX.value = item.x; 
          textY.value = item.y;
       } else if (item.type === 'image') {
          item.scale = Math.max(0.01, resizeStartScale * (currentWidth / Math.max(1, resizeStartWidth)));
          imgScale.value = item.scale.toFixed(2);
          imgX.value = item.x; 
          imgY.value = item.y;
       }
       
       renderCanvas();
    }
    return;
  }
  
  if (!isDragging) return;
  
  if (currentTool === 'pencil' && currentDrawingId) {
    const item = frames[currentFrameIndex].find(i => i.id === currentDrawingId);
    if (item) {
      item.points.push({ x: Math.round(x), y: Math.round(y) });
      renderCanvas();
    }
    return;
  }
  
  if (!selectedItemId) return;

  const dx = x - dragStartX;
  const dy = y - dragStartY;

  const frameItems = frames[currentFrameIndex];
  const item = frameItems.find(i => i.id === selectedItemId);
  if (item) {
    if (item.type === 'text' || item.type === 'image') {
      item.x = applySnap(itemStartX + dx);
      item.y = applySnap(itemStartY + dy);

      if (item.type === 'text') {
        textX.value = item.x;
        textY.value = item.y;
      } else if (item.type === 'image') {
        imgX.value = item.x;
        imgY.value = item.y;
      }
    } else if (item.type === 'drawing' && item.originalPoints) {
      const rdx = applySnap(dx) - applySnap(0);
      const rdy = applySnap(dy) - applySnap(0);
      item.points = item.originalPoints.map(pt => ({
        x: Math.round(pt.x + (snapSize > 1 ? rdx : dx)),
        y: Math.round(pt.y + (snapSize > 1 ? rdy : dy))
      }));
    } else if (item.type === 'shape' && item.originalX1 !== undefined) {
      const rdx = applySnap(dx) - applySnap(0);
      const rdy = applySnap(dy) - applySnap(0);
      const useDx = snapSize > 1 ? rdx : dx;
      const useDy = snapSize > 1 ? rdy : dy;
      item.x1 = Math.round(item.originalX1 + useDx);
      item.y1 = Math.round(item.originalY1 + useDy);
      item.x2 = Math.round(item.originalX2 + useDx);
      item.y2 = Math.round(item.originalY2 + useDy);
    }
  }

  renderCanvas();
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

  // Commit shape preview en item réel
  if (shapePreview) {
    pushUndo();
    pushRecentColor(shapePreview.color);
    const committed = { ...shapePreview };
    delete committed.id;
    committed.id = generateId();
    frames[currentFrameIndex].push(committed);
    shapePreview = null;
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
  }

  isDragging = false;
  isResizing = false;
  resizeHandle = null;
  currentDrawingId = null;

  if (selectedItemId) {
    renderCanvas();
    updateTimelineThumb(currentFrameIndex);
    updateSelectionUI();
  }
}

function findItemAtCoord(cx, cy) {
  const frameItems = frames[currentFrameIndex];
  // Iterate backwards to hit-test top-most items first
  for (let i = frameItems.length - 1; i >= 0; i--) {
    const item = frameItems[i];
    const bounds = getItemBounds(item);
    if (cx >= bounds.x && cx <= bounds.x + bounds.width &&
        cy >= bounds.y && cy <= bounds.y + bounds.height) {
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
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    item.points.forEach(pt => {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
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
  if (!selectedItemId) return;
  const frameItems = frames[currentFrameIndex];
  const item = frameItems.find(i => i.id === selectedItemId);
  if (!item) return;

  if (item.type === 'text') {
    item.text = textInput.value;
    item.color = textColor.value;
    item.size = parseInt(textSize.value) || 16;
    item.x = parseInt(textX.value) || 0;
    item.y = parseInt(textY.value) || 16;
    item.font = textFont.value;
  } else if (item.type === 'image') {
    item.x = parseInt(imgX.value) || 0;
    item.y = parseInt(imgY.value) || 0;
    item.scale = parseFloat(imgScale.value) || 1.0;
  }
  
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

function updateSelectionUI() {
  const has = !!selectedItemId;
  selectionTools.hidden = !has;
  if (btnDeleteSelected) btnDeleteSelected.disabled = !has;
  if (has) {
    const item = frames[currentFrameIndex] && frames[currentFrameIndex].find(i => i.id === selectedItemId);
    if (item) sheetAutoOpen(item);
  }
}

function deleteSelectedItem() {
  if (!selectedItemId || isPlaying) return;
  pushUndo();
  const frameItems = frames[currentFrameIndex];
  frames[currentFrameIndex] = frameItems.filter(i => i.id !== selectedItemId);
  selectedItemId = null;
  updateSelectionUI();
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

function setTool(tool) {
  currentTool = tool;
  if (tool !== 'select') {
    selectedItemId = null;
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
  if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
  if (currentFrameIndex < 0 && frames.length > 0) currentFrameIndex = 0;
  selectedItemId = null; // deselect on frame change
  updateSelectionUI();
  renderCanvas();
  renderTimeline();
}

function drawItem(context, item) {
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
    item.points.forEach(pt => context.fillRect(pt.x, pt.y, 1, 1));
  } else if (item.type === 'shape') {
    drawShape(context, item);
  }
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
  const items = frames[frameIndex] || [];

  // Fond
  context.fillStyle = '#050505';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // Onion skin : frame précédente en fantôme
  if (opts.onionSkin && frameIndex > 0) {
    const prev = frames[frameIndex - 1] || [];
    context.save();
    context.globalAlpha = 0.3;
    prev.forEach(it => drawItem(context, it));
    context.restore();
  }

  items.forEach(item => {
    drawItem(context, item);

    // Legacy Selection Box (thumbnails only)
    if (drawActiveSelectionBox && item.id === selectedItemId) {
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
  if (frames.length === 0) return;

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
  if (!isPlaying && selectedItemId) {
    const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
    if (item) {
      const bounds = getItemBounds(item); // logical bounds
      
      const sx = bounds.x * scaleX;
      const sy = bounds.y * scaleY;
      const sw = bounds.width * scaleX;
      const sh = bounds.height * scaleY;
      
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]); // Reset
      
      // Draw 4 resize handles — taille ~18 CSS px quelle que soit la taille d'affichage
      if (item.type === 'text' || item.type === 'image') {
        const cssWidth = canvas.getBoundingClientRect().width || canvas.width;
        const bufferPerCss = canvas.width / cssWidth;
        const hSize = 18 * bufferPerCss;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(2, 2 * bufferPerCss);
        const drawHandle = (hx, hy) => {
          ctx.fillRect(hx - hSize/2, hy - hSize/2, hSize, hSize);
          ctx.strokeRect(hx - hSize/2, hy - hSize/2, hSize, hSize);
        };
        drawHandle(sx, sy); // top-left
        drawHandle(sx + sw, sy); // top-right
        drawHandle(sx, sy + sh); // bottom-left
        drawHandle(sx + sw, sy + sh); // bottom-right
      }
    }
  }
}

function updateTimelineThumb(index) {
  const thumbs = timelineContainer.querySelectorAll('.frame-thumb');
  if (thumbs[index]) {
    const thumbCtx = thumbs[index].getContext('2d');
    drawFrameToContext(thumbCtx, index, false);
  }
}

function renderTimeline() {
  timelineContainer.innerHTML = '';
  frames.forEach((_, index) => {
    const container = document.createElement('div');
    container.className = `frame-thumb-container ${index === currentFrameIndex ? 'active' : ''}`;
    container.dataset.index = String(index);
    container.draggable = true;

    container.addEventListener('click', (e) => {
      if (container._isDragging) return;
      currentFrameIndex = index;
      if (isPlaying) togglePlay();
      updateUI();
    });

    // Drag-to-reorder (HTML5 drag & drop)
    container.addEventListener('dragstart', (e) => {
      container._isDragging = true;
      container.classList.add('dragging');
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.effectAllowed = 'move';
    });
    container.addEventListener('dragend', () => {
      container._isDragging = false;
      container.classList.remove('dragging');
      document.querySelectorAll('.frame-thumb-container.drop-target').forEach(el => el.classList.remove('drop-target'));
    });
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.classList.add('drop-target');
    });
    container.addEventListener('dragleave', () => container.classList.remove('drop-target'));
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      container.classList.remove('drop-target');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to = index;
      if (isNaN(from) || from === to) return;
      pushUndo();
      const [moved] = frames.splice(from, 1);
      frames.splice(to, 0, moved);
      if (currentFrameIndex === from) currentFrameIndex = to;
      else if (from < currentFrameIndex && to >= currentFrameIndex) currentFrameIndex--;
      else if (from > currentFrameIndex && to <= currentFrameIndex) currentFrameIndex++;
      updateUI();
    });

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.className = 'frame-thumb';
    thumbCanvas.width = WIDTH;
    thumbCanvas.height = HEIGHT;
    drawFrameToContext(thumbCanvas.getContext('2d'), index, false);

    const label = document.createElement('div');
    label.className = 'frame-thumb-label';
    label.innerText = `Frame ${index + 1}`;

    container.appendChild(thumbCanvas);
    container.appendChild(label);
    timelineContainer.appendChild(container);
  });
}

// --- Frame Management ---
function addFrame() {
  pushUndo();
  frames.push([]);
  currentFrameIndex = frames.length - 1;
  updateUI();
}

function duplicateFrame() {
  if (frames.length === 0) return;
  pushUndo();
  const currentItems = frames[currentFrameIndex];
  // Deep clone JSON-safe (items contiennent imgId, pas img)
  const copyItems = JSON.parse(JSON.stringify(currentItems)).map(item => ({ ...item, id: generateId() }));
  frames.splice(currentFrameIndex + 1, 0, copyItems);
  currentFrameIndex++;
  updateUI();
}

function deleteFrame() {
  pushUndo();
  if (frames.length <= 1) {
    frames[0] = []; // Just clear if it's the last one
  } else {
    frames.splice(currentFrameIndex, 1);
  }
  updateUI();
}

function clearCurrentFrame() {
  if (frames.length === 0) return;
  pushUndo();
  frames[currentFrameIndex] = [];
  updateUI();
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
  if (frames.length <= 1) return;
  selectedItemId = null; // Hide selection boxes during playback
  isPlaying = true;
  btnPlayPause.innerText = 'Pause';
  btnPlayPause.classList.remove('primary');
  
  playInterval = setInterval(() => {
    currentFrameIndex = (currentFrameIndex + 1) % frames.length;
    renderCanvas();
    const thumbs = document.querySelectorAll('.frame-thumb-container');
    thumbs.forEach((t, i) => t.classList.toggle('active', i === currentFrameIndex));
  }, 1000 / fps);
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
    imageDataUrls.set(imgId, finalDataUrl);

    pushUndo();
    const newItem = {
      id: generateId(),
      type: 'image',
      imgId,
      x, y,
      scale: finalScale
    };
    frames[currentFrameIndex].push(newItem);
    selectedItemId = newItem.id;
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

  const newItem = {
    id: generateId(),
    type: 'text',
    text: text,
    font: font,
    color: color,
    size: size,
    x: x,
    y: y
  };
  
  frames[currentFrameIndex].push(newItem);
  selectedItemId = newItem.id;
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

// Generate a scrolling animation for the currently selected item
async function generateAnimation() {
  if (!selectedItemId) {
    showModal("Notice", "Please select an item on the canvas first to animate it.", false);
    return;
  }
  
  const selectedItem = frames[currentFrameIndex].find(i => i.id === selectedItemId);
  if (!selectedItem) return;

  const startX = parseInt(animStartX.value) || 0;
  const startY = parseInt(animStartY.value) || 0;
  const endX = parseInt(animEndX.value) || 0;
  const endY = parseInt(animEndY.value) || 0;
  
  const startCol = animStartColor.value;
  const endCol = animEndColor.value;

  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
  };

  const rgbToHex = (r, g, b) => {
    return "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
  };

  const c1 = hexToRgb(startCol);
  const c2 = hexToRgb(endCol);

  const mode = animMode.value; // 'duration' or 'speed'
  const val = parseInt(animValue.value) || 1;
  
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  let steps = 1;
  if (mode === 'duration') {
     steps = val;
  } else if (mode === 'speed') {
     steps = Math.max(1, Math.ceil(distance / val));
  }
  
  const confirmed = await showModal(
    "Confirm Generation",
    `This will generate ${steps} frames interpolating from (${startX},${startY}) to (${endX},${endY}) with color transition. Existing frames will be updated. Proceed?`,
    true
  );
  if (!confirmed) return;

  pushUndo();
  const easingName = animEasing ? animEasing.value : 'linear';

  // Base frame to clone if we need to append new frames (clone without the animated item to form a background)
  const baseFrame = frames[currentFrameIndex].filter(i => i.id !== selectedItemId);

  for(let i = 0; i < steps; i++) {
    const tRaw = steps > 1 ? (i / (steps - 1)) : 1;
    const t = applyEasing(tRaw, easingName);
    const currentX = Math.round(startX + dx * t);
    const currentY = Math.round(startY + dy * t);

    const curR = c1.r + (c2.r - c1.r) * t;
    const curG = c1.g + (c2.g - c1.g) * t;
    const curB = c1.b + (c2.b - c1.b) * t;
    const currentColor = rgbToHex(curR, curG, curB);
    
    // Duplicate item properties (imgId reste valide après JSON round-trip)
    let newItem = JSON.parse(JSON.stringify(selectedItem));
    newItem.x = currentX;
    newItem.y = currentY;
    newItem.color = currentColor;

    // Recalculate inner points for drawings
    if (selectedItem.type === 'drawing') {
      const offsetX = currentX - selectedItem.x;
      const offsetY = currentY - selectedItem.y;
      newItem.points = selectedItem.points.map(pt => ({ x: pt.x + offsetX, y: pt.y + offsetY }));
      if (selectedItem.originalPoints) {
         newItem.originalPoints = selectedItem.originalPoints.map(opt => ({ x: opt.x + offsetX, y: opt.y + offsetY }));
      }
    }

    const targetFrameIndex = currentFrameIndex + i;

    if (targetFrameIndex >= frames.length) {
       // Frame neuve : base figée (sans l'item animé) + item repositionné
       const newFrame = JSON.parse(JSON.stringify(baseFrame));
       newFrame.push(newItem);
       frames.push(newFrame);
    } else {
       // Overwrite the existing item in this target frame, or push it if it doesn't exist yet
       const existingItemIndex = frames[targetFrameIndex].findIndex(k => k.id === selectedItemId);
       if (existingItemIndex > -1) {
          frames[targetFrameIndex][existingItemIndex] = newItem;
       } else {
          frames[targetFrameIndex].push(newItem);
       }
    }
  }
  
  updateUI();
  showModal("Success", `Generated ${steps} animation frames starting from frame ${currentFrameIndex + 1}.`, false);
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
  if (frames.length === 0) {
    showModal("Notice", "Aucune frame à exporter.", false);
    return;
  }

  const filename = (exportFilename.value.trim() || 'video') + '.bin';
  const useCustomMapping = exportMapping.value === 'custom';
  const totalFrames = frames.length;
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
  
  if (frames.length === 0) {
    showModal("Notice", "Aucune frame à exporter.", false);
    return;
  }

  const useCustomMapping = exportMapping.value === 'custom';
  const totalFrames = frames.length;
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

// ---- Animation presets ----
function presetScroll(direction) {
  if (!selectedItemId) { showModal('Notice', 'Sélectionne un item d\'abord.', false); return; }
  const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
  if (!item) return;
  const b = getItemBounds(item);
  if (direction === 'left') {
    animStartX.value = WIDTH;              animStartY.value = Math.round(b.y);
    animEndX.value   = -Math.round(b.width); animEndY.value   = Math.round(b.y);
  } else {
    animStartX.value = -Math.round(b.width); animStartY.value = Math.round(b.y);
    animEndX.value   = WIDTH;                animEndY.value   = Math.round(b.y);
  }
  animStartColor.value = item.color || '#ffffff';
  animEndColor.value = item.color || '#ffffff';
  animMode.value = 'duration';
  animValue.value = 40;
  if (animEasing) animEasing.value = 'linear';
  generateAnimation();
}
function presetBlink() {
  if (!selectedItemId) { showModal('Notice','Sélectionne un item.', false); return; }
  const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
  if (!item) return;
  pushUndo();
  const total = 8;
  for (let i = 0; i < total; i++) {
    const targetFrameIndex = currentFrameIndex + i;
    const baseFrame = frames[currentFrameIndex].filter(k => k.id !== selectedItemId);
    const on = (i % 2 === 0);
    const newFrame = JSON.parse(JSON.stringify(baseFrame));
    if (on) {
      const copy = JSON.parse(JSON.stringify(item));
      newFrame.push(copy);
    }
    if (targetFrameIndex >= frames.length) frames.push(newFrame);
    else frames[targetFrameIndex] = newFrame;
  }
  updateUI();
}
function presetFade(dir) {
  if (!selectedItemId) { showModal('Notice','Sélectionne un item.', false); return; }
  const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
  if (!item) return;
  animStartX.value = Math.round(item.x);
  animStartY.value = Math.round(item.y);
  animEndX.value   = Math.round(item.x);
  animEndY.value   = Math.round(item.y);
  const itemCol = item.color || '#ffffff';
  if (dir === 'in') { animStartColor.value = '#000000'; animEndColor.value = itemCol; }
  else              { animStartColor.value = itemCol;  animEndColor.value = '#000000'; }
  animMode.value = 'duration';
  animValue.value = 20;
  if (animEasing) animEasing.value = 'ease-in-out';
  generateAnimation();
}

// ---- Palette ----
function renderPalette() {
  if (!paletteContainer) return;
  paletteContainer.innerHTML = '';
  recentColors.forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'palette-chip';
    chip.style.backgroundColor = c;
    chip.title = c;
    chip.setAttribute('aria-label', `Utiliser ${c}`);
    chip.addEventListener('click', () => applyColorToActiveTool(c));
    paletteContainer.appendChild(chip);
  });
}

// ---- Save / Load projet .json ----
function serializeProject() {
  const images = {};
  imageDataUrls.forEach((v, k) => images[k] = v);
  return {
    version: 2,
    width: WIDTH, height: HEIGHT,
    fps,
    frames,
    images,
    recentColors
  };
}

async function loadProjectFromObject(obj) {
  if (!obj || !obj.frames) { showModal('Erreur','Fichier projet invalide.', false); return; }
  // Reconstruit imageCache depuis les dataURL
  imageCache.clear();
  imageDataUrls.clear();
  const imgEntries = Object.entries(obj.images || {});
  await Promise.all(imgEntries.map(([id, dataUrl]) => new Promise(res => {
    const im = new Image();
    im.onload = () => { imageCache.set(id, im); imageDataUrls.set(id, dataUrl); res(); };
    im.onerror = () => res();
    im.src = dataUrl;
  })));
  frames = obj.frames;
  currentFrameIndex = 0;
  fps = obj.fps || 20;
  if (inputFps) inputFps.value = fps;
  if (Array.isArray(obj.recentColors)) { recentColors = obj.recentColors.slice(0, 8); renderPalette(); }
  undoStack = []; redoStack = [];
  updateUndoButtons();
  selectedItemId = null;
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
  frames = [[]];
  currentFrameIndex = 0;
  undoStack = []; redoStack = [];
  imageCache.clear(); imageDataUrls.clear();
  selectedItemId = null;
  updateUndoButtons();
  updateUI();
  localStorage.removeItem('glougloubus-autosave');
}

// ---- Autosave ----
let autosaveTimer = null;
function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem('glougloubus-autosave', JSON.stringify(serializeProject()));
      localStorage.setItem('glougloubus-autosave-ts', String(Date.now()));
    } catch (err) {
      // localStorage quota — silencieux, les images peuvent exploser la taille
      console.warn('Autosave skipped:', err.message);
    }
  }, 1500);
}

async function tryRestoreAutosave() {
  const raw = localStorage.getItem('glougloubus-autosave');
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (!obj.frames || obj.frames.length === 0) return;
    const ts = parseInt(localStorage.getItem('glougloubus-autosave-ts') || '0', 10);
    const ago = Math.round((Date.now() - ts) / 1000);
    const ok = await showModal('Restaurer l\'autosave',
      `Un projet sauvegardé automatiquement a été trouvé (il y a ${ago}s, ${obj.frames.length} frame(s)). Le restaurer ?`,
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
function applyCanvasTransform() {
  if (!canvasWrapper) return;
  const container = canvasWrapper.querySelector('.canvas-container');
  if (!container) return;
  container.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
  container.style.transformOrigin = '0 0';
}
function setZoom(z, centerX, centerY) {
  const newZ = Math.max(0.5, Math.min(8, z));
  if (canvasWrapper && centerX !== undefined) {
    const rect = canvas.getBoundingClientRect();
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    const cx = centerX - wrapperRect.left;
    const cy = centerY - wrapperRect.top;
    // Maintient le point sous le curseur
    const ratio = newZ / viewZoom;
    viewPanX = cx - (cx - viewPanX) * ratio;
    viewPanY = cy - (cy - viewPanY) * ratio;
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
  if (frames.length === 0) { showModal('Notice', 'Aucune frame.', false); return; }
  if (btnExportGif) btnExportGif.disabled = true;
  if (exportStatusText) exportStatusText.innerText = 'Génération GIF…';
  if (exportProgressContainer) exportProgressContainer.hidden = false;

  // Collecte toutes les frames en RGBA + construit palette globale
  const framesRgb = [];
  for (let i = 0; i < frames.length; i++) {
    drawFrameToContext(offCtx, i, false);
    framesRgb.push(offCtx.getImageData(0, 0, WIDTH, HEIGHT));
    if (exportProgressBar) exportProgressBar.style.width = `${Math.round((i+1)/frames.length*40)}%`;
  }

  // Palette 256 via median-cut sur pixels concaténés
  const allPixels = new Uint8ClampedArray(framesRgb.length * WIDTH * HEIGHT * 4);
  framesRgb.forEach((f, i) => allPixels.set(f.data, i * f.data.length));
  const palette = buildPaletteMedianCut(allPixels, 256);
  // Index indirecte pour lookup rapide
  const paletteFlat = new Uint8Array(768);
  palette.forEach((c, i) => { paletteFlat[i*3] = c[0]; paletteFlat[i*3+1] = c[1]; paletteFlat[i*3+2] = c[2]; });

  // Délai par frame (en centièmes de secondes)
  const delayCs = Math.max(2, Math.round(100 / fps));

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

  if (exportStatusText) exportStatusText.innerText = `Terminé ! GIF ${frames.length} frames.`;
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
      const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
      if (item) clipboardItem = JSON.parse(JSON.stringify(item));
      return;
    }
    if (ctrl && (e.key === 'v' || e.key === 'V') && clipboardItem && !inInput) {
      e.preventDefault();
      pushUndo();
      const copy = JSON.parse(JSON.stringify(clipboardItem));
      copy.id = generateId();
      copy.x = (copy.x || 0) + 2;
      copy.y = (copy.y || 0) + 2;
      frames[currentFrameIndex].push(copy);
      selectedItemId = copy.id;
      renderCanvas(); updateTimelineThumb(currentFrameIndex); updateSelectionUI();
      return;
    }

    if (inInput) return;

    if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'Escape') {
      if (document.fullscreenElement) return;
      selectedItemId = null;
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
      currentFrameIndex = Math.min(frames.length - 1, currentFrameIndex + 1); updateUI(); return;
    }
  });
}

function nudgeSelected(dx, dy) {
  const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
  if (!item) return;
  pushUndo();
  if (item.type === 'drawing') {
    item.points = item.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  } else if (item.type === 'shape') {
    item.x1 += dx; item.x2 += dx; item.y1 += dy; item.y2 += dy;
  } else {
    item.x += dx; item.y += dy;
  }
  populatePropertiesPanel(item);
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
  updateSelectionUI();
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

  // Bottom sheet (mobile UI)
  initBottomSheet();

  // Autosave restore + register PWA
  tryRestoreAutosave();
  registerPwa();
}

// (initBottomSheet est dans modules/sheet.js — l'auto-open est appelé depuis updateSelectionUI)
