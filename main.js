const WIDTH = 192;
const HEIGHT = 32;

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

// --- State ---
// A frame is now an ARRAY of objects: { id, type, x, y, ...specificProps }
let frames = [];
let currentFrameIndex = 0;
let isPlaying = false;
let fps = 20;
let playInterval = null;

// Object Selection and Tool State
let selectedItemId = null;
let currentTool = 'select'; // 'select' | 'pencil'
let isDragging = false;
let currentDrawingId = null;
let dragStartX = 0;
let dragStartY = 0;
let itemStartX = 0;
let itemStartY = 0;

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
  
  // Property changes live update the selected item
  textInput.addEventListener('input', updateSelectedItemProperties);
  textColor.addEventListener('input', updateSelectedItemProperties);
  textSize.addEventListener('input', updateSelectedItemProperties);
  textX.addEventListener('input', updateSelectedItemProperties);
  textY.addEventListener('input', updateSelectedItemProperties);
  textFont.addEventListener('input', updateSelectedItemProperties);
  
  imgX.addEventListener('input', updateSelectedItemProperties);
  imgY.addEventListener('input', updateSelectedItemProperties);
  imgScale.addEventListener('input', updateSelectedItemProperties);
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

function handlePointerDown(e) {
  if (isPlaying) return;
  // Capture le pointer pour recevoir move/up même hors canvas
  canvas.setPointerCapture(e.pointerId);
  const { x, y } = getCanvasCoords(e);

  // Check if clicking on a resize handle first
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
        isResizing = true;
        dragStartX = x;
        dragStartY = y;
        resizeStartWidth = bounds.width;
        resizeStartHeight = bounds.height;
        resizeStartScale = item.scale || 1.0;
        resizeStartSize = item.size || 16;
        resizeItemStartX = item.x;
        resizeItemStartY = item.y;
        return; // Skip normal selection/dragging logic
      }
    }
  }
  
  if (currentTool === 'pencil') {
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
    selectedItemId = hitItem.id;
    isDragging = true;
    dragStartX = x;
    dragStartY = y;
    itemStartX = hitItem.x;
    itemStartY = hitItem.y;
    
    if (hitItem.type === 'drawing') {
      hitItem.originalPoints = JSON.parse(JSON.stringify(hitItem.points));
    }
    
    // Populate properties panel with selected item data
    populatePropertiesPanel(hitItem);
  } else {
    selectedItemId = null;
  }
  
  updateSelectionUI();
  renderCanvas();
}

function handlePointerMove(e) {
  const { x, y } = getCanvasCoords(e);
  
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
      item.x = Math.round(itemStartX + dx);
      item.y = Math.round(itemStartY + dy);
      
      // Sync UI inputs with dragging
      if (item.type === 'text') {
        textX.value = item.x;
        textY.value = item.y;
      } else if (item.type === 'image') {
        imgX.value = item.x;
        imgY.value = item.y;
      }
    } else if (item.type === 'drawing' && item.originalPoints) {
      item.points = item.originalPoints.map(pt => ({
        x: Math.round(pt.x + dx),
        y: Math.round(pt.y + dy)
      }));
    }
  }
  
  renderCanvas();
}

function handlePointerUp(e) {
  if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
  isDragging = false;
  isResizing = false;
  resizeHandle = null;
  
  // Re-render to finalize active bounds etc if needed
  if (selectedItemId) {
    renderCanvas();
    updateTimelineThumb(currentFrameIndex); 
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
    // Approximate bounding box for text
    const height = item.size;
    return {
      x: item.x,
      y: item.y - height/2,
      width: metrics.width,
      height: height
    };
  } else if (item.type === 'image') {
    return {
      x: item.x,
      y: item.y,
      width: item.img.width * item.scale,
      height: item.img.height * item.scale
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
    // Add +2 padding for hit area
    return { x: minX - 1, y: minY - 1, width: maxX - minX + 3, height: maxY - minY + 3 };
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
  if (selectedItemId) {
    selectionTools.style.display = 'flex';
  } else {
    selectionTools.style.display = 'none';
  }
}

function deleteSelectedItem() {
  if (!selectedItemId || isPlaying) return;
  const frameItems = frames[currentFrameIndex];
  frames[currentFrameIndex] = frameItems.filter(i => i.id !== selectedItemId);
  selectedItemId = null;
  updateSelectionUI();
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

function togglePencilMode() {
  if (currentTool === 'select') {
    currentTool = 'pencil';
    selectedItemId = null;
    updateSelectionUI();
    renderCanvas();
    btnTogglePencil.innerText = 'Enable Select Mode';
    btnTogglePencil.classList.replace('outline', 'primary');
    canvas.style.cursor = 'crosshair';
  } else {
    currentTool = 'select';
    btnTogglePencil.innerText = 'Enable Pencil Mode';
    btnTogglePencil.classList.replace('primary', 'outline');
    canvas.style.cursor = 'default';
  }
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

function drawFrameToContext(context, frameIndex, drawActiveSelectionBox = false) {
  const items = frames[frameIndex] || [];
  
  // Clear context with standard background
  context.fillStyle = '#050505';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // Draw items
  items.forEach(item => {
    if (item.type === 'text') {
      context.fillStyle = item.color;
      const font = item.font || '"JetBrains Mono", monospace';
      context.font = `${item.size}px ${font}`;
      context.textBaseline = 'middle';
      context.fillText(item.text, item.x, item.y);
    } else if (item.type === 'image') {
      context.drawImage(item.img, item.x, item.y, item.img.width * item.scale, item.img.height * item.scale);
    } else if (item.type === 'drawing') {
      context.fillStyle = item.color;
      item.points.forEach(pt => {
        context.fillRect(pt.x, pt.y, 1, 1);
      });
    }
    
    // Legacy Selection Box (only used for thumbnails now)
    if (drawActiveSelectionBox && item.id === selectedItemId) {
      const bounds = getItemBounds(item);
      context.strokeStyle = '#3b82f6';
      context.lineWidth = 1;
      context.setLineDash([2, 2]);
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.setLineDash([]);
    }
  });
}

function renderCanvas() {
  if (frames.length === 0) return;
  
  // 1. Draw logical scene to offscreen backbuffer
  drawFrameToContext(offCtx, currentFrameIndex, false);
  
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
    container.onclick = () => {
      currentFrameIndex = index;
      if (isPlaying) togglePlay();
      updateUI();
    };

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
  frames.push([]);
  currentFrameIndex = frames.length - 1;
  updateUI();
}

function duplicateFrame() {
  if (frames.length === 0) return;
  const currentItems = frames[currentFrameIndex];
  
  // Deep clone items but preserve image references properly
  const copyItems = currentItems.map(item => {
    return { ...item, id: generateId() }; 
  });
  
  frames.splice(currentFrameIndex + 1, 0, copyItems);
  currentFrameIndex++;
  updateUI();
}

function deleteFrame() {
  if (frames.length <= 1) {
    frames[0] = []; // Just clear if it's the last one
  } else {
    frames.splice(currentFrameIndex, 1);
  }
  updateUI();
}

function clearCurrentFrame() {
  if (frames.length === 0) return;
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
    const img = new Image();
    img.onload = () => {
      let finalScale = scale;
      if (img.width > WIDTH || img.height > HEIGHT) {
        finalScale = Math.min(WIDTH / img.width, HEIGHT / img.height);
        imgScale.value = finalScale.toFixed(2);
      }

      const newItem = {
        id: generateId(),
        type: 'image',
        img: img,
        x: x,
        y: y,
        scale: finalScale
      };
      frames[currentFrameIndex].push(newItem);
      selectedItemId = newItem.id;
      renderCanvas();
      updateTimelineThumb(currentFrameIndex);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function applyTextTool() {
  const text = textInput.value;
  if (!text) return;
  
  const color = textColor.value;
  const size = parseInt(textSize.value) || 16;
  const x = parseInt(textX.value) || 0;
  const y = parseInt(textY.value) || 16;
  const font = textFont.value;

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

  // Base frame to clone if we need to append new frames (clone without the animated item to form a background)
  const baseFrame = frames[currentFrameIndex].filter(i => i.id !== selectedItemId);
  
  for(let i = 0; i < steps; i++) {
    const t = steps > 1 ? (i / (steps - 1)) : 1; 
    const currentX = Math.round(startX + dx * t);
    const currentY = Math.round(startY + dy * t);
    
    const curR = c1.r + (c2.r - c1.r) * t;
    const curG = c1.g + (c2.g - c1.g) * t;
    const curB = c1.b + (c2.b - c1.b) * t;
    const currentColor = rgbToHex(curR, curG, curB);
    
    // Duplicate item properties
    let newItem = JSON.parse(JSON.stringify(selectedItem));
    newItem.x = currentX;
    newItem.y = currentY;
    newItem.color = currentColor;
    
    // Re-attach HTML element references that JSON.stringify strips out
    if (selectedItem.type === 'image') newItem.img = selectedItem.img;
    
    // Recalculate inner points for drawings
    if (selectedItem.type === 'drawing') {
      const offsetX = currentX - selectedItem.x;
      const offsetY = currentY - selectedItem.y;
      newItem.points = selectedItem.points.map(pt => ({ x: pt.x + offsetX, y: pt.y + offsetY }));
      if (selectedItem.originalPoints) {
         newItem.originalPoints = selectedItem.originalPoints.map(opt => ({ x: opt.x + offsetX, y: opt.y + offsetY }));
      }
    }
    
    const targetFrameIndex = currentFrameIndex + i; // Merge starting from current frame
    
    if (targetFrameIndex >= frames.length) {
       // Create a new frame appending the newly positioned item to the frozen background
       const newFrame = JSON.parse(JSON.stringify(baseFrame));
       // Fix image refs for background items
       newFrame.forEach(item => {
           if (item.type === 'image') {
              const srcItem = baseFrame.find(b => b.id === item.id);
              if (srcItem) item.img = srcItem.img;
           }
       });
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

// Ported from convertisseur_video.html — maps logical (col,row) to physical LED index
function mapToLedIndex(col, row) {
  const NUMBER_OF_PANEL_WIDTH = 12;
  const NUMBER_OF_PANEL_HEIGHT = 2;
  const LED_PER_ROW = 16;
  const LED_PER_COL = 16;
  const LED_PER_PANEL = 256;

  if (col < 0 || row < 0) return -1;
  if (col > (NUMBER_OF_PANEL_WIDTH * LED_PER_ROW) - 1 ||
      row > (NUMBER_OF_PANEL_HEIGHT * LED_PER_COL) - 1) return -1;

  const panel_col = Math.floor(col / LED_PER_ROW);
  const panel_row = (NUMBER_OF_PANEL_HEIGHT - 1) - Math.floor(row / LED_PER_COL);
  const panel_index = panel_row * NUMBER_OF_PANEL_WIDTH + (NUMBER_OF_PANEL_WIDTH - 1 - panel_col);

  const local_col = col % LED_PER_ROW;
  const local_row = (LED_PER_COL - 1) - (row % LED_PER_COL);

  let local_led_index;
  if (local_row % 2 === 0) {
    local_led_index = local_row * LED_PER_ROW + (LED_PER_ROW - 1 - local_col);
  } else {
    local_led_index = local_row * LED_PER_ROW + local_col;
  }

  return panel_index * LED_PER_PANEL + local_led_index;
}

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
  exportProgressContainer.style.display = 'flex';
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
    bleStatusText.innerText = 'Connexion...';
    
    const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'glougloubus' }],
        optionalServices: [SERVICE_GENERAL_UUID, SERVICE_VIDEO_UUID]
    });
    
    gattServer = await device.gatt.connect();
    
    const service = await gattServer.getPrimaryService(SERVICE_VIDEO_UUID);
    videoControlCharacteristic = await service.getCharacteristic(VIDEO_CONTROL_UUID);
    videoDataCharacteristic = await service.getCharacteristic(VIDEO_DATA_UUID);
    
    isBleConnected = true;
    bleStatusText.innerText = 'Connecté';
    bleStatusText.style.color = '#4ade80';
    btnConnectBle.innerText = 'Disconnect BLE';
    btnStreamBle.style.display = 'block';
    
    device.addEventListener('gattserverdisconnected', onBleDisconnected);
  } catch(err) {
    console.error(err);
    bleStatusText.innerText = 'Erreur';
    bleStatusText.style.color = '#f87171';
  }
}

function onBleDisconnected() {
    isBleConnected = false;
    bleStatusText.innerText = 'Not connected';
    bleStatusText.style.color = '#94a3b8';
    btnConnectBle.innerText = 'Connect BLE';
    btnStreamBle.style.display = 'none';
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
  exportProgressContainer.style.display = 'flex';
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

