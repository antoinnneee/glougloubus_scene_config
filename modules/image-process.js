// Image processing : Floyd-Steinberg dithering and median-cut palette quantization.
// All functions are pure — no DOM/state dependencies beyond what's passed in.

// Process a source image (HTMLImageElement) by applying optional dithering and/or
// palette quantization. Returns a Promise<{ image: HTMLImageElement, dataUrl: string }>.
//
//   ditherMode: 'none' | 'floyd-steinberg'
//   paletteSize: 0 (full color) | 8 | 16 | 32 | 64 | ... up to 256
export function processImage(srcImg, ditherMode, paletteSize) {
  // Draw the source onto a canvas at native size to access raw pixels
  const c = document.createElement('canvas');
  c.width = srcImg.width; c.height = srcImg.height;
  const cc = c.getContext('2d');
  cc.drawImage(srcImg, 0, 0);
  const imgData = cc.getImageData(0, 0, c.width, c.height);
  const d = imgData.data;

  let palette = null;
  if (paletteSize > 0) palette = buildPaletteMedianCut(d, paletteSize);

  if (ditherMode === 'floyd-steinberg') {
    floydSteinberg(d, c.width, c.height, palette);
  } else if (palette) {
    quantizeWithPalette(d, palette);
  }

  cc.putImageData(imgData, 0, 0);
  const dataUrl = c.toDataURL('image/png');
  return new Promise((resolve) => {
    const out = new Image();
    out.onload = () => resolve({ image: out, dataUrl });
    out.src = dataUrl;
  });
}

// Find the closest color in a palette (squared euclidean distance in RGB space).
export function nearestColor(r, g, b, palette) {
  let best = palette[0], bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bd) { bd = dist; best = p; }
  }
  return best;
}

// Same as nearestColor but returns the palette INDEX (used by GIF export).
export function nearestPaletteIdx(r, g, b, palette) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bd) { bd = dist; bi = i; }
  }
  return bi;
}

// In-place Floyd-Steinberg error-diffusion dithering.
// If `palette` is null, falls back to 3-3-2 bit quantization (no palette).
export function floydSteinberg(data, w, h, palette) {
  const buf = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const or = buf[i], og = buf[i + 1], ob = buf[i + 2];
      let nr, ng, nb;
      if (palette) {
        const n = nearestColor(or, og, ob, palette);
        nr = n[0]; ng = n[1]; nb = n[2];
      } else {
        // 3-3-2 bit quantize
        nr = (Math.round(or / 32) * 32) & 0xFF;
        ng = (Math.round(og / 32) * 32) & 0xFF;
        nb = (Math.round(ob / 64) * 64) & 0xFF;
      }
      buf[i] = nr; buf[i + 1] = ng; buf[i + 2] = nb;
      const er = or - nr, eg = og - ng, eb = ob - nb;
      const diffuse = (dx, dy, f) => {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy >= h) return;
        const k = (yy * w + xx) * 4;
        buf[k]     += er * f;
        buf[k + 1] += eg * f;
        buf[k + 2] += eb * f;
      };
      diffuse(1, 0, 7 / 16);
      diffuse(-1, 1, 3 / 16);
      diffuse(0, 1, 5 / 16);
      diffuse(1, 1, 1 / 16);
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.max(0, Math.min(255, buf[i]));
    data[i + 1] = Math.max(0, Math.min(255, buf[i + 1]));
    data[i + 2] = Math.max(0, Math.min(255, buf[i + 2]));
  }
}

// Snap each pixel of `data` to the nearest palette color.
export function quantizeWithPalette(data, palette) {
  for (let i = 0; i < data.length; i += 4) {
    const n = nearestColor(data[i], data[i + 1], data[i + 2], palette);
    data[i] = n[0]; data[i + 1] = n[1]; data[i + 2] = n[2];
  }
}

// Build a `k`-color palette from `data` (RGBA pixel array) using median-cut.
// Returns an array of [r, g, b] triplets.
export function buildPaletteMedianCut(data, k) {
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  const boxes = [pixels];
  while (boxes.length < k) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (!box || box.length < 2) { boxes.push(box); break; }
    let min = [255, 255, 255], max = [0, 0, 0];
    for (const p of box) {
      for (let c = 0; c < 3; c++) {
        if (p[c] < min[c]) min[c] = p[c];
        if (p[c] > max[c]) max[c] = p[c];
      }
    }
    const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const axis = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a[axis] - b[axis]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid));
    boxes.push(box.slice(mid));
  }
  return boxes.filter(b => b.length).map(box => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    const n = box.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}
