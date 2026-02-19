// Scorched Earth - Utility functions

// Seeded PRNG (xorshift32) for reproducible terrain
let _seed = Date.now() & 0xFFFFFFFF;

export function seedRandom(s) {
  _seed = s >>> 0 || 1;
}

// Returns integer in [0, max) matching original random(max) behavior
export function random(max) {
  _seed ^= _seed << 13;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5;
  return ((_seed >>> 0) % max);
}

export function clamp(val, min, max) {
  return val < min ? min : val > max ? max : val;
}

// VGA 6-bit (0-63) to 8-bit (0-255) conversion
export function vga6to8(val6) {
  // Map 0-63 to 0-255: multiply by 4.047619 (255/63)
  // Original VGA DAC: val6 << 2 gives 0-252, but we want full 0-255 range
  return Math.round(val6 * 255 / 63);
}

// Bresenham line - calls callback(x, y) for each pixel
export function bresenhamLine(x0, y0, x1, y1, callback) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    callback(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}
