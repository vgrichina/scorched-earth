// Scorched Earth - Utility functions
// EXE: Bresenham line used at file 0x1E2E3 (seg 0x171B:0x0733) for barrel + laser drawing
// EXE: random() from Borland C++ runtime, VGA 6-bit→8-bit via DAC shift

// Borland C++ R250 PRNG — exact match of EXE runtime (file 0x32994, 0x32A29)
// Uses Kirkpatrick-Stoll R250 generator seeded by a 32-bit LCG

// LCG state (32-bit): seed = seed * 0x015A4E35 + 1, returns (seed >> 16) & 0x7FFF
let _lcgLo = 0;  // DS:0xC2E6 — low word
let _lcgHi = 0;  // DS:0xC2E8 — high word

function lcgSrand(seed) {
  _lcgLo = seed & 0xFFFF;
  _lcgHi = 0;
}

// Borland 32-bit multiply: (hi:lo) * 0x015A4E35 + 1
// EXE at file 0x089A5: calls mul32 helper then adds 1
function lcgRand() {
  // 32-bit seed = (hi << 16) | lo
  // new_seed = seed * 0x015A4E35 + 1
  const seed = (_lcgHi << 16 | _lcgLo) >>> 0;
  const result = (Math.imul(seed, 0x015A4E35) + 1) >>> 0;
  _lcgLo = result & 0xFFFF;
  _lcgHi = (result >>> 16) & 0xFFFF;
  return _lcgHi & 0x7FFF;
}

// R250 table (250 x 16-bit words) and index
const _r250Table = new Uint16Array(250);
let _r250Index = 0;

// R250 init — EXE file 0x32994
export function seedRandom(seed) {
  lcgSrand(seed & 0xFFFF);
  _r250Index = 0;

  // Fill table with LCG values
  for (let i = 0; i < 250; i++) {
    _r250Table[i] = lcgRand();
  }

  // Second pass: randomly set high bit
  for (let i = 0; i < 250; i++) {
    if (lcgRand() > 0x4000) {
      _r250Table[i] |= 0x8000;
    }
  }

  // Third pass: ensure each bit position has at least one set bit
  // Visits indices 3, 14, 25, 36, ... (i*11+3) for i=0..15
  let mask = 0x8000;
  let andMask = 0xFFFF;
  for (let i = 0; i < 16; i++) {
    const idx = i * 11 + 3;
    _r250Table[idx] = (_r250Table[idx] & andMask) | mask;
    mask >>>= 1;
    andMask >>>= 1;
  }
}

// R250 next — EXE file 0x32A29
function r250Next() {
  const j = _r250Index >= 147 ? _r250Index - 147 : _r250Index + 103;
  _r250Table[_r250Index] ^= _r250Table[j];
  const val = _r250Table[_r250Index];
  _r250Index = _r250Index >= 249 ? 0 : _r250Index + 1;
  return val;
}

// Returns integer in [0, max) matching original random(max) behavior
// EXE file 0x32E1B: r250_next() % max (unsigned 16-bit division)
export function random(max) {
  if (max === 0) return 0;
  return r250Next() % max;
}

// Default seed — overridden by main.js init()
seedRandom(1);

export function clamp(val, min, max) {
  return val < min ? min : val > max ? max : val;
}

// EXE: VGA DAC stores 6-bit values (0-63), display hardware maps to analog
// Standard VGA shift: val6 << 2 gives 0-252; we use 255/63 for full 8-bit range
export function vga6to8(val6) {
  // Map 0-63 to 0-255: multiply by 4.047619 (255/63)
  // Original VGA DAC: val6 << 2 gives 0-252, but we want full 0-255 range
  return Math.round(val6 * 255 / 63);
}

// Bresenham line - calls callback(x, y) for each pixel
// EXE: Bresenham at file 0x1E2E3 (seg 0x171B:0x0733)
// EXE: used for barrel drawing (icons.cpp) and laser sight (seg 0x2F76:0x01C1)
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
