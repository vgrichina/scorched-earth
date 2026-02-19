// Scorched Earth - Terrain Generation (ranges.cpp RE)
// Random walk with momentum algorithm, 7 terrain types

import { random, clamp } from './utils.js';
import { config } from './config.js';
import { setPixel, hline } from './framebuffer.js';

// Terrain height map: terrain[x] = top Y of ground at column x
export const terrain = new Uint16Array(config.screenWidth);

// Sky region: rows 0 to ~14 reserved for HUD, rest is playfield
const HUD_HEIGHT = 14;
const PLAYFIELD_TOP = HUD_HEIGHT;
const PLAYFIELD_BOTTOM = config.screenHeight - 1;

// Generate terrain using random walk with momentum (from RE)
export function generateTerrain() {
  const width = config.screenWidth;
  const yStart = PLAYFIELD_TOP;
  const yEnd = PLAYFIELD_BOTTOM;

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
    case 4: // V-Shaped
      generateVShaped(width, yStart, yEnd);
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

// Main random walk algorithm from RE (ranges.cpp)
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

// Draw sky gradient (VGA 80-103 mapped to screen rows)
export function drawSky() {
  const width = config.screenWidth;
  const skyHeight = PLAYFIELD_BOTTOM;

  for (let y = 0; y < skyHeight; y++) {
    const palIdx = 80 + Math.floor(y * 23 / (skyHeight - 1));
    hline(0, width - 1, y, palIdx);
  }
}

// Draw terrain columns using palette indices 120-149
// From RE: palette_index = (terrain_bottom - y) * 29 / terrain_height + 120
// Uses GLOBAL Y mapping so adjacent columns at same depth have same color
export function drawTerrain() {
  const width = config.screenWidth;
  const bottom = PLAYFIELD_BOTTOM;
  // Global range: map from deepest possible terrain to bottom of screen
  const globalTop = PLAYFIELD_TOP + 20;  // minimum terrain height
  const globalRange = Math.max(bottom - globalTop, 1);

  for (let x = 0; x < width; x++) {
    const top = terrain[x];

    for (let y = top; y <= bottom; y++) {
      // Map absolute Y position to palette: higher Y (deeper) = lower palette index
      const palIdx = 120 + Math.floor((bottom - y) * 29 / globalRange);
      setPixel(x, y, palIdx);
    }
  }
}

// Get terrain height at a given X coordinate
export function getTerrainY(x) {
  if (x < 0 || x >= config.screenWidth) return config.screenHeight;
  return terrain[x];
}
