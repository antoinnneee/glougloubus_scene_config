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

const selectionTools = document.getElementById('selection-tools');
const btnDeleteItem = document.getElementById('btn-delete-item');

const btnTogglePencil = document.getElementById('btn-toggle-pencil');
const pencilColor = document.getElementById('pencil-color');

const animDir = document.getElementById('anim-dir');
const animSpeed = document.getElementById('anim-speed');
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
  
  btnDeleteItem.addEventListener('click', deleteSelectedItem);
  btnTogglePencil.addEventListener('click', togglePencilMode);

  // Mouse/Touch Events for Dragging
  canvas.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove); // Window to handle dragging out of bounds
  window.addEventListener('mouseup', handleMouseUp);
  
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

function handleMouseDown(e) {
  if (isPlaying) return;
  const { x, y } = getCanvasCoords(e);
  
  // Check if clicking on a resize handle first
  if (selectedItemId) {
    const item = frames[currentFrameIndex].find(i => i.id === selectedItemId);
    if (item && (item.type === 'text' || item.type === 'image')) {
      const bounds = getItemBounds(item);
      const hHit = 4; // hit radius
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

function handleMouseMove(e) {
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
          item.size = Math.max(4, Math.round(resizeStartSize * (currentWidth / Math.max(1, resizeStartWidth))));
          textSize.value = item.size;
       } else if (item.type === 'image') {
          item.scale = Math.max(0.01, resizeStartScale * (currentWidth / Math.max(1, resizeStartWidth)));
          imgScale.value = item.scale.toFixed(2);
       }
       
       // Sync coordinate fields
       if (item.type === 'text') {textX.value = item.x; textY.value = item.y;} 
       else {imgX.value = item.x; imgY.value = item.y;}
       
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

function handleMouseUp(e) {
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
      context.font = `${item.size}px "JetBrains Mono", monospace`;
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
      
      // Draw 4 resize handles
      if (item.type === 'text' || item.type === 'image') {
        const hSize = 8;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
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

// Generate a scrolling animation for the currently selected item
async function generateAnimation() {
  if (!selectedItemId) {
    showModal("Notice", "Please select an item on the canvas first to animate it.", false);
    return;
  }
  
  const selectedItem = frames[currentFrameIndex].find(i => i.id === selectedItemId);
  if (!selectedItem) return;

  const dir = animDir.value;
  const speed = parseInt(animSpeed.value) || 2;
  const bounds = getItemBounds(selectedItem);
  
  let steps = 0;
  if (dir === 'left') {
    steps = Math.ceil((bounds.x + bounds.width) / speed);
  } else if (dir === 'right') {
    steps = Math.ceil((WIDTH - bounds.x) / speed);
  } else if (dir === 'up') {
    steps = Math.ceil((bounds.y + bounds.height) / speed);
  } else if (dir === 'down') {
    steps = Math.ceil((HEIGHT - bounds.y) / speed);
  }
  
  if (steps <= 0) steps = 20; // Failsafe if completely offscreen
  
  const confirmed = await showModal(
    "Confirm Generation", 
    `This will append ${steps} frames to animate the item ${dir}wards at ${speed}px/frame. Proceed?`, 
    true
  );
  if (!confirmed) return;

  let currentX = selectedItem.x;
  let currentY = selectedItem.y;
  
  for(let i = 0; i < steps; i++) {
    if (dir === 'left') currentX -= speed;
    else if (dir === 'right') currentX += speed;
    else if (dir === 'up') currentY -= speed;
    else if (dir === 'down') currentY += speed;
    
    // Duplicate item properties
    let newItem = JSON.parse(JSON.stringify(selectedItem));
    newItem.id = generateId();
    newItem.x = currentX;
    newItem.y = currentY;
    
    // Re-attach HTML element references that JSON.stringify strips out
    if (selectedItem.type === 'image') {
       newItem.img = selectedItem.img;
    }
    
    // Recalculate inner points for drawings
    if (selectedItem.type === 'drawing') {
      const dx = currentX - selectedItem.x;
      const dy = currentY - selectedItem.y;
      newItem.points = selectedItem.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
      if (selectedItem.originalPoints) {
         newItem.originalPoints = selectedItem.originalPoints.map(opt => ({ x: opt.x + dx, y: opt.y + dy }));
      }
    }
    
    frames.push([newItem]); 
  }
  
  updateUI();
  showModal("Success", `Added ${steps} frames.`, false);
}

// Run
init();
