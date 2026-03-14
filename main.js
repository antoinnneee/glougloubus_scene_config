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
let frames = [];
let currentFrameIndex = 0;
let isPlaying = false;
let fps = 20;
let playInterval = null;

// Offscreen canvas for tools
const offCanvas = document.createElement('canvas');
offCanvas.width = WIDTH;
offCanvas.height = HEIGHT;
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

// --- Initialization ---
function init() {
  // Start with one blank frame
  frames.push(createBlankFrame());
  updateUI();

  // Event Listeners
  btnAddFrame.addEventListener('click', addFrame);
  btnDupFrame.addEventListener('click', duplicateFrame);
  btnDelFrame.addEventListener('click', deleteFrame);
  btnClear.addEventListener('click', clearCurrentFrame);

  btnPlayPause.addEventListener('click', togglePlay);
  inputFps.addEventListener('change', (e) => { fps = parseInt(e.target.value) || 20; if(isPlaying) { stop(); play(); } });

  btnApplyImage.addEventListener('click', applyImageTool);
  btnApplyText.addEventListener('click', applyTextTool);
  btnGenerateAnim.addEventListener('click', generateTextAnimation);
}

// --- Core Logic ---
function createBlankFrame() {
  const imgData = new ImageData(WIDTH, HEIGHT);
  // Fill with black
  for (let i = 0; i < imgData.data.length; i += 4) {
    imgData.data[i] = 0;     // R
    imgData.data[i+1] = 0;   // G
    imgData.data[i+2] = 0;   // B
    imgData.data[i+3] = 255; // A
  }
  return imgData;
}

function updateUI() {
  if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
  if (currentFrameIndex < 0 && frames.length > 0) currentFrameIndex = 0;

  renderCanvas();
  renderTimeline();
}

function renderCanvas() {
  if (frames.length === 0) return;
  const frame = frames[currentFrameIndex];
  ctx.putImageData(frame, 0, 0);
}

function renderTimeline() {
  timelineContainer.innerHTML = '';
  frames.forEach((frameData, index) => {
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
    thumbCanvas.getContext('2d').putImageData(frameData, 0, 0);

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
  frames.push(createBlankFrame());
  currentFrameIndex = frames.length - 1;
  updateUI();
}

function duplicateFrame() {
  if (frames.length === 0) return;
  const current = frames[currentFrameIndex];
  const copy = new ImageData(new Uint8ClampedArray(current.data), WIDTH, HEIGHT);
  frames.splice(currentFrameIndex + 1, 0, copy);
  currentFrameIndex++;
  updateUI();
}

function deleteFrame() {
  if (frames.length <= 1) return;
  frames.splice(currentFrameIndex, 1);
  updateUI();
}

function clearCurrentFrame() {
  if (frames.length === 0) return;
  frames[currentFrameIndex] = createBlankFrame();
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
  isPlaying = true;
  btnPlayPause.innerText = 'Pause';
  btnPlayPause.classList.remove('primary');
  
  playInterval = setInterval(() => {
    currentFrameIndex = (currentFrameIndex + 1) % frames.length;
    renderCanvas();
    // Highlight timeline without full re-render for performance
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

// --- Tools ---
function applyImageTool() {
  const file = imgUpload.files[0];
  if (!file) {
    alert("Please select an image first.");
    return;
  }
  
  const x = parseInt(imgX.value) || 0;
  const y = parseInt(imgY.value) || 0;
  const scale = parseFloat(imgScale.value) || 1.0;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Draw current frame to offcanvas preserving background
      offCtx.putImageData(frames[currentFrameIndex], 0, 0);
      
      // Draw new image on top
      offCtx.drawImage(img, x, y, img.width * scale, img.height * scale);
      
      // Save back
      frames[currentFrameIndex] = offCtx.getImageData(0, 0, WIDTH, HEIGHT);
      updateUI();
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

  // Restore current to offcanvas
  offCtx.putImageData(frames[currentFrameIndex], 0, 0);
  
  offCtx.fillStyle = color;
  offCtx.font = `${size}px "JetBrains Mono", monospace`;
  offCtx.textBaseline = 'middle';
  offCtx.fillText(text, x, y);

  frames[currentFrameIndex] = offCtx.getImageData(0, 0, WIDTH, HEIGHT);
  updateUI();
}

// Generate a scrolling text animation from right to left
function generateTextAnimation() {
  const text = textInput.value;
  if (!text) {
    alert("Please enter some text in the text tool first.");
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
  const steps = WIDTH + textWidth; // Complete scroll
  
  if (!confirm(`This will append ${steps} frames to the timeline. Proceed?`)) return;

  for(let i=0; i<steps; i+=2) { // step by 2 pixels for speed
    const frame = createBlankFrame();
    offCtx.putImageData(frame, 0, 0);
    offCtx.fillStyle = color;
    offCtx.font = `${size}px "JetBrains Mono", monospace`;
    offCtx.textBaseline = 'middle';
    offCtx.fillText(text, currentX, y);
    
    frames.push(offCtx.getImageData(0, 0, WIDTH, HEIGHT));
    currentX -= 2;
  }
  
  updateUI();
  alert(`Added ${Math.ceil(steps/2)} frames.`);
}

// Run
init();
