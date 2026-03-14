const WIDTH = 192;
const HEIGHT = 32;

// --- DOM Elements ---
const canvas = document.getElementById('led-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const btnPlayPause = document.getElementById('btn-play-pause');
const inputFps = document.getElementById('fps-input');
const btnClear = document.getElementById('btn-clear-canvas');

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
const btnApplyText = document.getElementById('btn-apply-text');

const btnGenerateAnim = document.getElementById('btn-generate-anim');

// --- State ---
// A frame is now an ARRAY of objects: { id, type, x, y, ...specificProps }
let frames = [];
let currentFrameIndex = 0;
let isPlaying = false;
let fps = 20;
let playInterval = null;

// Object Selection State
let selectedItemId = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let itemStartX = 0;
let itemStartY = 0;

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
  btnGenerateAnim.addEventListener('click', generateTextAnimation);

  // Mouse/Touch Events for Dragging
  canvas.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove); // Window to handle dragging out of bounds
  window.addEventListener('mouseup', handleMouseUp);
  
  // Property changes live update the selected item
  textInput.addEventListener('input', updateSelectedItemProperties);
  textColor.addEventListener('input', updateSelectedItemProperties);
  textSize.addEventListener('input', updateSelectedItemProperties);
  textX.addEventListener('input', updateSelectedItemProperties);
  textY.addEventListener('input', updateSelectedItemProperties);
  
  imgX.addEventListener('input', updateSelectedItemProperties);
  imgY.addEventListener('input', updateSelectedItemProperties);
  imgScale.addEventListener('input', updateSelectedItemProperties);
}

// --- Interaction Logic ---
function getCanvasCoords(event) {
  const rect = canvas.getBoundingClientRect();
  // Map CSS coordinates to logic (192x32) coordinates
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function handleMouseDown(e) {
  if (isPlaying) return;
  const { x, y } = getCanvasCoords(e);
  
  const hitItem = findItemAtCoord(x, y);
  
  if (hitItem) {
    selectedItemId = hitItem.id;
    isDragging = true;
    dragStartX = x;
    dragStartY = y;
    itemStartX = hitItem.x;
    itemStartY = hitItem.y;
    
    // Populate properties panel with selected item data
    populatePropertiesPanel(hitItem);
  } else {
    selectedItemId = null;
  }
  
  renderCanvas();
}

function handleMouseMove(e) {
  if (!isDragging || !selectedItemId) return;
  
  const { x, y } = getCanvasCoords(e);
  const dx = x - dragStartX;
  const dy = y - dragStartY;
  
  const frameItems = frames[currentFrameIndex];
  const item = frameItems.find(i => i.id === selectedItemId);
  if (item) {
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
  }
  
  renderCanvas();
}

function handleMouseUp(e) {
  isDragging = false;
  
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
    offCtx.font = `${item.size}px "JetBrains Mono", monospace`;
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
  } else if (item.type === 'image') {
    item.x = parseInt(imgX.value) || 0;
    item.y = parseInt(imgY.value) || 0;
    item.scale = parseFloat(imgScale.value) || 1.0;
  }
  
  renderCanvas();
  updateTimelineThumb(currentFrameIndex);
}

// --- Core Rendering ---
function updateUI() {
  if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
  if (currentFrameIndex < 0 && frames.length > 0) currentFrameIndex = 0;
  selectedItemId = null; // deselect on frame change
  renderCanvas();
  renderTimeline();
}

function drawFrameToContext(context, frameIndex, drawActiveSelectionBox = false) {
  const items = frames[frameIndex] || [];
  
  // Clear context
  context.fillStyle = 'black';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // Draw items
  items.forEach(item => {
    if (item.type === 'text') {
      context.fillStyle = item.color;
      context.font = `${item.size}px "JetBrains Mono", monospace`;
      context.textBaseline = 'middle';
      context.fillText(item.text, item.x, item.y);
    } else if (item.type === 'image') {
      context.drawImage(item.img, item.x, item.y, item.img.width * item.scale, item.img.height * item.scale);
    }
    
    // Draw Selection Box
    if (drawActiveSelectionBox && item.id === selectedItemId) {
      const bounds = getItemBounds(item);
      context.strokeStyle = '#3b82f6'; // Accent color
      context.lineWidth = 1;
      context.setLineDash([2, 2]);
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.setLineDash([]); // Reset
    }
  });
}

function renderCanvas() {
  if (frames.length === 0) return;
  drawFrameToContext(ctx, currentFrameIndex, !isPlaying);
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
      const newItem = {
        id: generateId(),
        type: 'image',
        img: img,
        x: x,
        y: y,
        scale: scale
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

  const newItem = {
    id: generateId(),
    type: 'text',
    text: text,
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

// Generate a scrolling text animation from right to left using objects
async function generateTextAnimation() {
  const text = textInput.value;
  if (!text) {
    showModal("Notice", "Please enter some text in the text tool first.", false);
    return;
  }

  const color = textColor.value;
  const size = parseInt(textSize.value) || 16;
  const y = parseInt(textY.value) || 16;
  
  // Measure text
  offCtx.font = `${size}px "JetBrains Mono", monospace`;
  const metrics = offCtx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  
  // Start from right edge
  let currentX = WIDTH;
  const targetX = -textWidth;
  const steps = WIDTH + textWidth;
  
  const confirmed = await showModal("Confirm Generation", `This will append ${Math.ceil(steps/2)} frames to the timeline. Proceed?`, true);
  if (!confirmed) return;

  for(let i=0; i<steps; i+=2) {
    const newItem = {
      id: generateId(),
      type: 'text',
      text: text,
      color: color,
      size: size,
      x: currentX,
      y: y
    };
    
    frames.push([newItem]); // Create new frame with just this object
    currentX -= 2;
  }
  
  updateUI();
  showModal("Success", `Added ${Math.ceil(steps/2)} frames.`, false);
}

// Run
init();
