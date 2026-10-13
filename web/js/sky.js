import { random } from './utils.js';

// EXE DS:0B28 feedback masks, used by the point iterator at 0x1D09B.
const feedback = [0, 0, 0x3, 0x6, 0xc, 0x14, 0x30, 0x60, 0xb8, 0x110,
  0x240, 0x500, 0xca0, 0x1b00, 0x3500, 0x6000, 0xb400, 0x12000,
  0x20400, 0x72000, 0x90000, 0x140000, 0x300000];

// EXE 0x39A2F builds this pattern once, then 0x3AB6B restores individual
// background pixels from it. Positions do not consume the gameplay RNG.
export function createStarSky(width, height) {
  const left = 3, top = 38, bottom = height - 4;
  const w = width - 6, h = bottom - top + 1;
  const rowSeeds = new Uint16Array(height);
  for (let y = top; y <= bottom; y++) rowSeeds[y] = random(32000);
  const pixels = new Uint8Array(width * height).fill(80);
  const yBits = 32 - Math.clz32(h);
  const mask = feedback[32 - Math.clz32(w) + yBits];
  const yMask = (1 << yBits) - 1;
  let state = 1, remaining = Math.trunc(w * h / 30);
  while (remaining > 0) {
    const dx = state >>> yBits, dy = state & yMask;
    if (dx < w && dy < h) {
      const x = left + dx, y = top + dy;
      // IMUL's high word is discarded by CWD before signed division by 30.
      const product = (rowSeeds[y] * x << 16) >> 16;
      const cutoff = 30 - Math.trunc((bottom - y) * 29 / (bottom - top));
      pixels[y * width + x] = 80 + Math.max(0, Math.abs(product % 30) - cutoff);
      remaining--;
    }
    state = (state >>> 1) ^ ((state & 1) ? mask : 0);
  }
  return pixels;
}

// EXE 0x43ACA: filled circle callback, using doubled integer coordinates
// and the graphics mode's signed 16.16 aspect scaling (0x43B4E).
function fillSkyCircle(pixels, width, height, cx, cy, radius, aspect, color, wrap = false) {
  const sx = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const sy = aspect > 1 ? Math.trunc(65536 / aspect) : 65536;
  function span(dx, dy) {
    const y = cy + Math.floor(dy * sy / 65536);
    if (y < 38 || y > height - 4) return;
    const rawLeft = cx + Math.floor(-dx * sx / 65536);
    const rawRight = cx + Math.floor(dx * sx / 65536);
    const left = Math.max(3, rawLeft), right = Math.min(width - 4, rawRight);
    // EXE 0x439E8/0x43A2B emits overflow spans on the opposite edge.
    if (wrap && rawLeft < 3)
      pixels.fill(color, y * width + width - 6 + rawLeft, y * width + width - 3);
    if (wrap && rawRight > width - 4)
      pixels.fill(color, y * width + 3, y * width + rawRight - (width - 6) + 1);
    if (left <= right) pixels.fill(color, y * width + left, y * width + right + 1);
  }
  function mirror(a, b) {
    span(a, b); span(a, -b); span(b, a); span(b, -a);
  }
  let x = 0, y = radius * 2, error = 0;
  while (x <= y) {
    if (!(x & 1)) mirror(x >> 1, (y + 1) >> 1);
    error += 2 * x + 1;
    x++;
    if (error > 0) { error -= 2 * y - 1; y--; }
  }
  mirror(x >> 1, (y + 1) >> 1);
}

export function createSunsetSky(width, height, aspect) {
  const pixels = new Uint8Array(width * height);
  const bottom = height - 4;
  for (let y = 0; y < height; y++) {
    const row = Math.max(38, Math.min(bottom, y));
    pixels.fill(81 + Math.trunc((bottom - row) * 28 / (bottom - 38)), y * width, (y + 1) * width);
  }
  // EXE 0x39E42: the yellow sun is stored in the sky bitmap, behind terrain.
  fillSkyCircle(pixels, width, height, (width - 1) >> 1, bottom - 5,
    Math.trunc((width - 1) / 3), aspect, 80);
  return pixels;
}

export function createStormSky(width, height, aspect, wrap = false) {
  const pixels = new Uint8Array(width * height);
  const clouds = new Uint8Array(width * height);
  const bottom = height - 4, depthDivisor = width === 360 ? 3 : 2;
  // EXE 0x39BE5: overlapping circles across the ceiling, flattened by 1.8.
  for (let x = 0; x < width - 1; x += 15 + random(20)) {
    fillSkyCircle(clouds, width, height, x, 38, 30 + random(20), aspect * 1.8, 1, wrap);
  }
  for (let y = 0; y < height; y++) {
    const row = Math.max(38, Math.min(bottom, y));
    const background = 80 + Math.trunc((bottom - row) * 9 / (bottom - 38));
    const shade = Math.min(20, Math.trunc((row - 38) / depthDivisor));
    const cloud = shade === 20 ? 150 : 90 + shade;
    for (let x = 0; x < width; x++) pixels[y * width + x] = clouds[y * width + x] ? cloud : background;
  }
  return pixels;
}
