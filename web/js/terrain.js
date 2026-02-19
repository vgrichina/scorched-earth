// Scorched Earth - Terrain Generation
// EXE source: ranges.cpp (seg 0x2CBF, file base 0x33690)
// EXE: height generation random walk kernel at file 0x29808
// EXE: drawColumn per-column renderer at file 0x29720
// EXE: setTerrainPixel per-pixel color at file 0x3AB39
// EXE: 7 terrain types from SCORCH.CFG LAND_TYPE config
// EXE: LAND1 = bumpiness (flat chance), LAND2 = slope component

import { random, clamp } from './utils.js';
import { config } from './config.js';
import { setPixel, hline, setBackground, clearToBackground } from './framebuffer.js';

// Terrain height map: terrain[x] = top Y of ground at column x
export const terrain = new Uint16Array(config.screenWidth);

// Ceiling terrain for cavern mode: ceilingTerrain[x] = bottom Y of ceiling at column x
export const ceilingTerrain = new Uint16Array(config.screenWidth);

// Sky region: rows 0 to ~14 reserved for HUD, rest is playfield
const HUD_HEIGHT = 14;
const PLAYFIELD_TOP = HUD_HEIGHT;
const PLAYFIELD_BOTTOM = config.screenHeight - 1;

// Generate terrain using random walk with momentum (from RE)
export function generateTerrain() {
  const width = config.screenWidth;
  const yStart = PLAYFIELD_TOP;
  const yEnd = PLAYFIELD_BOTTOM;

  // Reset ceiling terrain
  ceilingTerrain.fill(0);

  switch (config.landType) {
    case 0: // Flat
      generateFlat(width, yStart, yEnd);
      break;
    case 1: // Slope
      generateSlope(width, yStart, yEnd);
      break;
    case 2: // Rolling (default)
    default:
      generateRolling(width, yStart, yEnd);
      break;
    case 3: // Mountain
      generateMountain(width, yStart, yEnd);
      break;
    case 4: // V-Shaped
      generateVShaped(width, yStart, yEnd);
      break;
    case 5: // Castle
      generateCastle(width, yStart, yEnd);
      break;
    case 6: // Cavern
      generateCavern(width, yStart, yEnd);
      break;
  }
}

function generateFlat(width, yStart, yEnd) {
  const midY = Math.floor((yStart + yEnd) / 2) + 20;
  for (let x = 0; x < width; x++) {
    terrain[x] = midY;
  }
}

function generateSlope(width, yStart, yEnd) {
  const margin = 40;
  const top = yStart + margin;
  const bottom = yEnd - 1;
  for (let x = 0; x < width; x++) {
    terrain[x] = Math.floor(top + (bottom - top) * x / (width - 1));
  }
}

function generateVShaped(width, yStart, yEnd) {
  const center = Math.floor(width / 2);
  const highY = yStart + 50;
  const lowY = yEnd - 20;
  for (let x = 0; x < width; x++) {
    const dist = Math.abs(x - center) / center;
    terrain[x] = Math.floor(lowY - (lowY - highY) * dist);
  }
}

// Mountain terrain: sharp peaks with multiple overlaid random walk passes
function generateMountain(width, yStart, yEnd) {
  // Start with high base
  for (let x = 0; x < width; x++) {
    terrain[x] = yEnd - 1;
  }

  // Multiple passes of sharp peaks overlaid
  const passes = 3;
  for (let pass = 0; pass < passes; pass++) {
    let y = random(yEnd - yStart - 80) + yStart + 50;
    let walkDelta = 0;

    for (let col = 0; col < width; col++) {
      const proposedY = clamp(Math.floor(y), yStart + 20, yEnd - 1);
      // Take the minimum (highest peak) across passes
      if (proposedY < terrain[col]) {
        terrain[col] = proposedY;
      }

      // High bump chance, low flat chance for sharp peaks
      if (random(100) < 8) {
        // Rare flat segments
      } else {
        walkDelta = random(5) - 2;  // {-2, -1, 0, +1, +2}
        if (random(100) < 40) {
          walkDelta *= 2;  // sharper peaks
        }
      }

      y += walkDelta;

      if (y < yStart + 25) {
        y = yStart + 25;
        if (walkDelta < 0) walkDelta = 2;
      }
      if (y > yEnd - 1) {
        y = yEnd - 1;
        if (walkDelta > 0) walkDelta = -1;
      }
    }
  }
}

// Castle terrain: flat base with rectangular rampart towers at intervals
function generateCastle(width, yStart, yEnd) {
  // Generate a gentle rolling base
  const baseY = Math.floor((yStart + yEnd) * 0.65);
  for (let x = 0; x < width; x++) {
    terrain[x] = baseY + random(5) - 2;
  }

  // Add castle towers at regular intervals
  const towerCount = 4 + random(3);  // 4-6 towers
  const towerSpacing = Math.floor(width / (towerCount + 1));

  for (let t = 0; t < towerCount; t++) {
    const cx = towerSpacing * (t + 1) + random(20) - 10;
    const towerWidth = 10 + random(8);
    const towerHeight = 30 + random(25);
    const towerTop = baseY - towerHeight;

    // Tower body
    for (let x = cx - towerWidth; x <= cx + towerWidth; x++) {
      if (x >= 0 && x < width) {
        terrain[x] = Math.min(terrain[x], towerTop);
      }
    }

    // Crenellations on top
    const crenWidth = 3;
    for (let x = cx - towerWidth; x <= cx + towerWidth; x += crenWidth * 2) {
      for (let bx = x; bx < x + crenWidth && bx <= cx + towerWidth; bx++) {
        if (bx >= 0 && bx < width) {
          terrain[bx] = Math.min(terrain[bx], towerTop - 5);
        }
      }
    }
  }
}

// Cavern terrain: ceiling + floor with open space between
function generateCavern(width, yStart, yEnd) {
  const midY = Math.floor((yStart + yEnd) / 2);
  const gap = 50 + random(20);  // min gap between ceiling and floor

  // Generate floor using rolling algorithm
  let floorY = midY + Math.floor(gap / 2);
  let floorDelta = 0;
  for (let col = 0; col < width; col++) {
    terrain[col] = clamp(Math.floor(floorY), midY, yEnd - 1);

    if (random(100) < 20) {
      // maintain momentum
    } else {
      floorDelta = random(3) - 1;
      if (random(100) < 15) floorDelta *= 2;
    }
    floorY += floorDelta;
    if (floorY < midY) { floorY = midY; if (floorDelta < 0) floorDelta = 1; }
    if (floorY > yEnd - 1) { floorY = yEnd - 1; if (floorDelta > 0) floorDelta = 0; }
  }

  // Generate ceiling
  let ceilY = midY - Math.floor(gap / 2);
  let ceilDelta = 0;
  for (let col = 0; col < width; col++) {
    ceilingTerrain[col] = clamp(Math.floor(ceilY), yStart, midY - 10);

    if (random(100) < 20) {
      // maintain
    } else {
      ceilDelta = random(3) - 1;
      if (random(100) < 15) ceilDelta *= 2;
    }
    ceilY += ceilDelta;
    if (ceilY < yStart + 15) { ceilY = yStart + 15; if (ceilDelta < 0) ceilDelta = 1; }
    if (ceilY > midY - 10) { ceilY = midY - 10; if (ceilDelta > 0) ceilDelta = -1; }
  }
}

// Main random walk algorithm
// EXE: height generation kernel at file 0x29808, ranges.cpp
// EXE: LAND1 controls flat chance (% momentum maintained), LAND2 controls slope
function generateRolling(width, yStart, yEnd) {
  const flatChance = config.land1;   // default 20: % chance to maintain momentum
  const bumpChance = config.land1;   // default 20: % chance to double delta

  // Starting height: random within playfield
  let y = random(yEnd - yStart - 60) + yStart + 40;
  let walkDelta = 0;

  for (let col = 0; col < width; col++) {
    terrain[col] = clamp(Math.floor(y), yStart + 20, yEnd - 1);

    if (random(100) < flatChance) {
      // Maintain current momentum (no change to walkDelta)
    } else {
      walkDelta = random(3) - 1;           // {-1, 0, +1}
      if (random(100) < bumpChance) {
        walkDelta *= 2;                     // {-2, 0, +2}
      }
    }

    y += walkDelta;

    // Clamp with bounce-back
    if (y < yStart + 40) {
      y = yStart + 40;
      if (walkDelta < 0) walkDelta = 1;
    }
    if (y > yEnd - 1) {
      y = yEnd - 1;
      if (walkDelta > 0) walkDelta = 0;
    }
  }
}

// Precompute per-row sky gradient palette indices into framebuffer background table.
// Called once when sky type changes. The row→palette index mapping (80-103) is
// independent of the palette RGB values — those are set by setupSkyPalette().
// This enables clearToBackground() to fill the entire framebuffer in a single
// memcpy, emulating VGA hardware where every pixel always has a valid DAC color.
export function initSkyBackground() {
  const rowColors = new Uint8Array(config.screenHeight);
  for (let y = 0; y < config.screenHeight; y++) {
    rowColors[y] = 80 + Math.floor(y * 23 / (config.screenHeight - 1));
  }
  setBackground(rowColors);
}

// Draw sky (VGA 80-103 mapped to screen rows)
// Supports: 0=Plain, 1=Shaded, 2=Stars, 3=Storm, 4=Sunset, 5=Cavern, 6=Black
export function drawSky() {
  const width = config.screenWidth;

  // Base gradient fill from precomputed background table (single memcpy)
  clearToBackground();

  // Stars: scatter white pixels
  if (config.skyType === 2) {
    for (let i = 0; i < 80; i++) {
      const sx = random(width);
      const sy = random(PLAYFIELD_BOTTOM - HUD_HEIGHT) + HUD_HEIGHT;
      const brightness = random(3);
      // Use explosion palette white-ish entries for stars
      setPixel(sx, sy, brightness === 0 ? 199 : 189);
    }
  }

  // Storm: occasional bright lightning pixels
  if (config.skyType === 3) {
    for (let i = 0; i < 15; i++) {
      const sx = random(width);
      const sy = random(PLAYFIELD_BOTTOM - HUD_HEIGHT) + HUD_HEIGHT;
      setPixel(sx, sy, 199);
    }
  }
}

// Draw terrain columns using palette indices 120-149
// EXE: drawColumn at file 0x29720, setTerrainPixel at file 0x3AB39
// EXE: palette_index = (terrain_bottom - y) * 29 / terrain_height + 120
// Uses GLOBAL Y mapping so adjacent columns at same depth have same color
export function drawTerrain() {
  const width = config.screenWidth;
  const bottom = PLAYFIELD_BOTTOM;
  // Global range: map from deepest possible terrain to bottom of screen
  const globalTop = PLAYFIELD_TOP + 20;  // minimum terrain height
  const globalRange = Math.max(bottom - globalTop, 1);

  for (let x = 0; x < width; x++) {
    // Draw floor terrain
    const top = terrain[x];
    for (let y = top; y <= bottom; y++) {
      const palIdx = 120 + Math.floor((bottom - y) * 29 / globalRange);
      setPixel(x, y, palIdx);
    }

    // Draw ceiling terrain (cavern mode)
    if (config.landType === 6 && ceilingTerrain[x] > 0) {
      for (let y = PLAYFIELD_TOP; y <= ceilingTerrain[x]; y++) {
        const palIdx = 120 + Math.floor((y - PLAYFIELD_TOP) * 29 / globalRange);
        setPixel(x, y, palIdx);
      }
    }
  }
}

// Get terrain height at a given X coordinate
export function getTerrainY(x) {
  if (x < 0 || x >= config.screenWidth) return config.screenHeight;
  return terrain[x];
}
