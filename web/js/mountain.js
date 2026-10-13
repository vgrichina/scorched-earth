import { random, randomFraction } from './utils.js';

// EXE 0x32ED7..0x331B7: 24-byte header, RGB palette, then one height word
// and ceil(height/2) packed bytes per column. Low nibble is the bottom pixel.
export function decodeMountain(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = off => view.getUint16(off, true);
  if (word(0) !== 0x544D || word(2) !== 0xEFBE) return null;
  const width = word(6), colors = word(12);
  let offset = 24 + colors * 3;
  if (!width || colors !== 16 || offset > bytes.length) return null;
  const palette = bytes.slice(24, offset);
  const columns = [];
  for (let x = 0; x < width; x++) {
    if (offset + 2 > bytes.length) return null;
    const height = word(offset);
    offset += 2;
    const count = Math.ceil(height / 2);
    if (offset + count > bytes.length) return null;
    const column = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
      column[y] = (bytes[offset + (y >> 1)] >> ((y & 1) * 4)) & 15;
    }
    columns.push(column);
    offset += count;
  }
  return { width, minHeight: word(8), maxHeight: word(10), groundIndex: word(16),
    fillMask: word(18), palette, columns, bytesRead: offset };
}

const signed16 = n => (n << 16) >> 16;

// EXE ScannedMountain renderer 0x32E44, excluding sky drawing. Zero means
// preserve the sky; other values are original EXE VGA indices (88..103 or 80).
export function renderMountain(mountain, width, height) {
  const left = 3, right = width - 4, top = 38, bottom = height - 4;
  const span = right - left + 1, playHeight = bottom - top + 1;
  const start = span <= mountain.width
    ? Math.trunc(randomFraction() * (mountain.width - span - 1)) : 0;
  let crop = 0;
  const target = Math.trunc(signed16(playHeight * 4) / 5);
  if (target < mountain.maxHeight) {
    crop = mountain.maxHeight - target;
    if (crop > mountain.minHeight) {
      crop = mountain.minHeight;
      const limit = Math.trunc(signed16(playHeight * 95) / 100);
      if (limit < mountain.maxHeight - crop) crop = mountain.maxHeight - limit;
    }
    if (crop & 1) crop++;
  }
  const fill = [];
  for (let i = 0; i < 16; i++) if (mountain.fillMask & (1 << i)) fill.push(88 + i);
  if (!fill.length) fill.push(80);
  const pixels = new Uint8Array(width * height);
  const put = (x, y, color) => {
    if (y >= top && y <= bottom) pixels[y * width + x] = color;
  };
  let source = start, direction = 1;
  for (let x = left; x <= right; x++) {
    const col = mountain.columns[source];
    // The EXE's following sky-fill loop overwrites the highest encoded pixel.
    for (let row = crop; row < col.length - 1; row++) put(x, bottom - row + crop, 88 + col[row]);
    // EXE adds three random ground pixels when less than three rows survive.
    if (bottom - col.length + crop + 1 > bottom - 2) {
      for (let y = bottom; y >= bottom - 2; y--) put(x, y, fill[random(fill.length)]);
    }
    source += direction;
    if (source >= mountain.width) { source = mountain.width - 2; direction = -1; }
    if (source < 0) { source = 1; direction = 1; }
  }
  return pixels;
}
