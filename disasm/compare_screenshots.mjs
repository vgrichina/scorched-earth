#!/usr/bin/env node
// Pixel-perfect comparison between EMU and web screenshots.
// Usage:
//   node disasm/compare_screenshots.mjs <emu.png> <web.png> [diff.png]
//
// Outputs per-region diff stats, magnitude breakdown, pixel categorization,
// and optional visual diff image.

import { readFileSync, writeFileSync } from 'fs';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node disasm/compare_screenshots.mjs <emu.png> <web.png> [diff.png]');
  process.exit(1);
}

const emu = PNG.sync.read(readFileSync(args[0]));
const web = PNG.sync.read(readFileSync(args[1]));
const diffPath = args[2];

if (emu.width !== web.width || emu.height !== web.height) {
  console.error(`Size mismatch: emu ${emu.width}x${emu.height} vs web ${web.width}x${web.height}`);
  process.exit(1);
}

const W = emu.width, H = emu.height;

// --- Helper: read pixel ---
function px(img, x, y) {
  const i = (y * W + x) * 4;
  return [img.data[i], img.data[i+1], img.data[i+2]];
}

// --- Sample pixel comparison at key positions ---
console.log(`Size: ${W}x${H}`);
console.log('\n--- Sample pixels (x=W/2) ---');
const sampleX = Math.min(Math.floor(W / 2), W - 1);
for (const frac of [0.06, 0.08, 0.2, 0.4, 0.6, 0.85, 0.95]) {
  const y = Math.min(Math.floor(frac * H), H - 1);
  const [eR, eG, eB] = px(emu, sampleX, y);
  const [wR, wG, wB] = px(web, sampleX, y);
  const match = eR === wR && eG === wG && eB === wB;
  console.log(`  y=${y}: emu=(${eR},${eG},${eB}) web=(${wR},${wG},${wB})${match ? ' ✓' : ' ✗'}`);
}

// --- Per-region diff analysis ---
const hudEnd = Math.round(26 * H / 480);
const terrainStart = Math.round(410 * H / 480);
const regions = [
  ['HUD', 0, hudEnd],
  ['Sky', hudEnd + 1, terrainStart],
  ['Terrain', terrainStart + 1, H - 1],
];

console.log('\n--- Region diff ---');
let totalDiff = 0, totalPx = 0;
for (const [name, y0, y1] of regions) {
  let total = 0, diff = 0, totalDelta = 0;
  for (let y = y0; y <= Math.min(y1, H - 1); y++) {
    for (let x = 0; x < W; x++) {
      total++;
      const i = (y * W + x) * 4;
      const dr = Math.abs(web.data[i] - emu.data[i]);
      const dg = Math.abs(web.data[i+1] - emu.data[i+1]);
      const db = Math.abs(web.data[i+2] - emu.data[i+2]);
      if (dr + dg + db > 0) { diff++; totalDelta += dr + dg + db; }
    }
  }
  totalDiff += diff;
  totalPx += total;
  const pct = (diff / total * 100).toFixed(1);
  const avg = diff > 0 ? (totalDelta / diff).toFixed(1) : '0';
  console.log(`  ${name} (${y0}-${y1}): ${diff}/${total} (${pct}%) avgDelta=${avg}`);
}
console.log(`  Total: ${totalDiff}/${totalPx} (${(totalDiff / totalPx * 100).toFixed(1)}%)`);

// --- Diff magnitude breakdown ---
let exact = 0, off12 = 0, off60 = 0, offBig = 0;
for (let i = 0; i < W * H; i++) {
  const idx = i * 4;
  const dr = Math.abs(web.data[idx] - emu.data[idx]);
  const dg = Math.abs(web.data[idx+1] - emu.data[idx+1]);
  const db = Math.abs(web.data[idx+2] - emu.data[idx+2]);
  const d = dr + dg + db;
  if (d === 0) exact++;
  else if (d <= 12) off12++;
  else if (d <= 60) off60++;
  else offBig++;
}
console.log('\n--- Diff magnitude ---');
console.log(`  Exact match: ${exact} (${(exact / (W*H) * 100).toFixed(1)}%)`);
console.log(`  Off ≤12 RGB: ${off12} (${(off12 / (W*H) * 100).toFixed(1)}%)`);
console.log(`  Off ≤60 RGB: ${off60} (${(off60 / (W*H) * 100).toFixed(1)}%)`);
console.log(`  Off >60 RGB: ${offBig} (${(offBig / (W*H) * 100).toFixed(1)}%)`);

// --- Pixel category breakdown (what kind of pixels differ) ---
const cats = { hud: 0, stars: 0, tanks: 0, terrain: 0, skyGradient: 0 };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const dr = Math.abs(web.data[i] - emu.data[i]);
    const dg = Math.abs(web.data[i+1] - emu.data[i+1]);
    const db = Math.abs(web.data[i+2] - emu.data[i+2]);
    if (dr + dg + db === 0) continue;

    const eR = emu.data[i], eG = emu.data[i+1], eB = emu.data[i+2];
    const wR = web.data[i], wG = web.data[i+1], wB = web.data[i+2];

    if (y <= hudEnd) { cats.hud++; continue; }
    if (y > terrainStart) {
      // In terrain area: distinguish tanks from terrain
      // Tank = bright saturated colors (green, red, etc)
      const eSat = Math.max(eR, eG, eB) - Math.min(eR, eG, eB);
      const wSat = Math.max(wR, wG, wB) - Math.min(wR, wG, wB);
      if (eSat > 80 || wSat > 80) cats.tanks++;
      else cats.terrain++;
      continue;
    }
    // Sky area: stars = isolated bright/white pixels on dark sky
    const eBright = Math.max(eR, eG, eB);
    const wBright = Math.max(wR, wG, wB);
    if (eBright > 200 || wBright > 200 ||
        (eR === eG && eG === eB && eR > 100) ||
        (wR === wG && wG === wB && wR > 100)) {
      cats.stars++;
    } else {
      cats.skyGradient++;
    }
  }
}
console.log('\n--- Diff categories ---');
for (const [cat, count] of Object.entries(cats)) {
  if (count > 0) console.log(`  ${cat}: ${count}`);
}

// --- Write visual diff image ---
if (diffPath) {
  const diff = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const idx = i * 4;
    const dr = Math.abs(web.data[idx] - emu.data[idx]);
    const dg = Math.abs(web.data[idx+1] - emu.data[idx+1]);
    const db = Math.abs(web.data[idx+2] - emu.data[idx+2]);
    const d = dr + dg + db;
    if (d === 0) {
      diff.data[idx] = diff.data[idx+1] = diff.data[idx+2] = 0;
    } else if (d <= 12) {
      diff.data[idx] = 0; diff.data[idx+1] = Math.min(255, d * 8); diff.data[idx+2] = 0;
    } else if (d <= 60) {
      diff.data[idx] = Math.min(255, d * 3); diff.data[idx+1] = Math.min(255, d * 3); diff.data[idx+2] = 0;
    } else {
      diff.data[idx] = 255; diff.data[idx+1] = 0; diff.data[idx+2] = 0;
    }
    diff.data[idx+3] = 255;
  }
  writeFileSync(diffPath, PNG.sync.write(diff));
  console.log(`\nDiff image: ${diffPath}`);
}
