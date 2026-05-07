// Minimal GIF89a encoder with LZW compression.
// Self-contained, no external dependencies.

// Encoder usage:
//   const enc = new GifEncoder(width, height, paletteFlat /* Uint8Array of RGB triplets */, paletteCount, delayCs);
//   for each frame:  enc.addFrame(indices /* Uint8Array of palette indices */);
//   const blob = enc.finish();   // returns Blob('image/gif')

export class GifEncoder {
  constructor(w, h, paletteFlat, paletteCount, delayCs) {
    this.w = w; this.h = h;
    this.paletteCount = paletteCount;
    this.delayCs = delayCs;
    // Color table size must be a power of two between 2 and 256
    let tableSize = 2;
    let tableExp = 1;
    while (tableSize < paletteCount) { tableSize *= 2; tableExp++; }
    this.tableExp = tableExp - 1; // GIF stores size as (value-1)
    this.tableSize = tableSize;
    this.paddedPalette = new Uint8Array(tableSize * 3);
    this.paddedPalette.set(paletteFlat.subarray(0, paletteCount * 3));
    this.bytes = [];
    this._writeHeader();
  }

  _writeHeader() {
    this._writeStr('GIF89a');
    // Logical screen descriptor
    this._writeU16(this.w); this._writeU16(this.h);
    this._writeByte(0b10000000 | this.tableExp); // GCT flag + size
    this._writeByte(0); // bg index
    this._writeByte(0); // px aspect
    // Global color table
    for (let i = 0; i < this.paddedPalette.length; i++) this._writeByte(this.paddedPalette[i]);
    // NETSCAPE2.0 loop extension
    this._writeByte(0x21); this._writeByte(0xFF); this._writeByte(11);
    this._writeStr('NETSCAPE2.0');
    this._writeByte(3); this._writeByte(1);
    this._writeU16(0); // 0 = infinite loop
    this._writeByte(0);
  }

  addFrame(indices) {
    // Graphics Control Extension
    this._writeByte(0x21); this._writeByte(0xF9); this._writeByte(4);
    this._writeByte(0); // flags
    this._writeU16(this.delayCs);
    this._writeByte(0); // transparent index
    this._writeByte(0); // terminator
    // Image descriptor
    this._writeByte(0x2C);
    this._writeU16(0); this._writeU16(0);
    this._writeU16(this.w); this._writeU16(this.h);
    this._writeByte(0); // no local table, no interlace
    // LZW
    const minCodeSize = Math.max(2, this.tableExp + 1);
    this._writeByte(minCodeSize);
    const lzw = lzwEncode(indices, minCodeSize);
    // Sub-blocks (max 255 bytes each)
    for (let off = 0; off < lzw.length; off += 255) {
      const len = Math.min(255, lzw.length - off);
      this._writeByte(len);
      for (let i = 0; i < len; i++) this._writeByte(lzw[off + i]);
    }
    this._writeByte(0); // block terminator
  }

  finish() {
    this._writeByte(0x3B); // trailer
    return new Blob([new Uint8Array(this.bytes)], { type: 'image/gif' });
  }

  _writeByte(b) { this.bytes.push(b & 0xFF); }
  _writeU16(n) { this._writeByte(n); this._writeByte(n >> 8); }
  _writeStr(s) { for (let i = 0; i < s.length; i++) this._writeByte(s.charCodeAt(i)); }
}

// Variable-length-code LZW encoder for GIF.
// pixels: Uint8Array of palette indices.
// Returns a Uint8Array of packed code bytes.
export function lzwEncode(pixels, minCodeSize) {
  const CLEAR = 1 << minCodeSize;
  const END = CLEAR + 1;
  let nextCode = END + 1;
  let codeSize = minCodeSize + 1;
  const dict = new Map();
  const out = [];
  let buf = 0, bufBits = 0;
  const emit = (code) => {
    buf |= code << bufBits;
    bufBits += codeSize;
    while (bufBits >= 8) { out.push(buf & 0xFF); buf >>= 8; bufBits -= 8; }
  };
  emit(CLEAR);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = prefix * 4096 + k; // palette ≤ 256, nextCode ≤ 4095
    if (dict.has(key)) {
      prefix = dict.get(key);
    } else {
      emit(prefix);
      if (nextCode < 4096) {
        dict.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(CLEAR);
        dict.clear();
        nextCode = END + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(END);
  if (bufBits > 0) out.push(buf & 0xFF);
  return Uint8Array.from(out);
}
