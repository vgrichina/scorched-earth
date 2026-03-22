// Scorched Earth - Terrain Generation
// EXE source: ranges.cpp (seg 0x2CBF, file base 0x33690)
// EXE: height generation random walk kernel at file 0x29808
// EXE: drawColumn per-column renderer at file 0x29720
// EXE: setTerrainPixel per-pixel color at file 0x3AB39
// EXE: 7 terrain types from SCORCH.CFG LAND_TYPE config
// EXE: LAND1 = bumpiness (flat chance), LAND2 = slope component

import { random, clamp } from './utils.js';
import { config } from './config.js';
import { setPixel, setBackground, clearToBackground } from './framebuffer.js';
import { SKY_PAL_START, SKY_PAL_COUNT, TERRAIN_PAL_START } from './constants.js';
import { resolvedSkyType } from './palette.js';

// Terrain height map: terrain[x] = top Y of ground at column x
// NOTE: This is a DERIVED index for collision lookups only. The authoritative
// terrain shape is stored in terrainBitmap[] — a per-pixel map that preserves
// crater holes, tunnels, and other sub-column detail. In the original EXE,
// VGA VRAM itself served this role; pixels persisted between frames.
export let terrain = new Uint16Array(config.screenWidth);

// Ceiling terrain for cavern mode: ceilingTerrain[x] = bottom Y of ceiling at column x
export let ceilingTerrain = new Uint16Array(config.screenWidth);

// Per-pixel terrain bitmap: non-zero = terrain palette index, 0 = sky.
// Equivalent to VGA VRAM in the original EXE — the source of truth for terrain
// shape including crater holes and tunnels. drawTerrain() reads this instead of
// filling solid columns from terrain[x], which would lose sub-column detail.
let WIDTH = config.screenWidth;
let HEIGHT = config.screenHeight;
export let terrainBitmap = new Uint8Array(WIDTH * HEIGHT);

// Sky region: HUD occupies top rows, rest is playfield
// EXE: HUD raised box covers y=0–34, 3px playfield border at y=35–37, playfield at y=38
// EXE: SHIELD_DRAW_Y_MIN (DS:EF40) = 38 — first playfield row
export const HUD_HEIGHT = 38;
export const PLAYFIELD_TOP = HUD_HEIGHT;
let PLAYFIELD_BOTTOM = config.screenHeight - 1;

// Reinitialize terrain buffers for new graphics mode dimensions
export function reinitTerrainBuffers() {
  WIDTH = config.screenWidth;
  HEIGHT = config.screenHeight;
  PLAYFIELD_BOTTOM = config.screenHeight - 1;
  terrain = new Uint16Array(WIDTH);
  ceilingTerrain = new Uint16Array(WIDTH);
  terrainBitmap = new Uint8Array(WIDTH * HEIGHT);
}

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
    case 6: // EXE: No separate "Cavern" terrain shape exists. The EXE's
            // TERRAIN_TYPE 6 is "Black" sky mode with standard random walk terrain.
            // The Landscape menu has only LAND1/LAND2/FLATLAND params, no shape selector.
      generateRolling(width, yStart, yEnd);
      break;
  }

  // Build per-pixel terrain bitmap from height map
  buildTerrainBitmap();
}

// EXE: Type 0 (Flat) uses the SAME random walk kernel as all other types.
// "Flat" refers to the palette (single solid color VGA 120), not the terrain shape.
function generateFlat(width, yStart, yEnd) {
  generateRolling(width, yStart, yEnd);
}

// EXE: Type 1 (Slope) uses the SAME random walk kernel as all other types
// (file 0x29808). Only the terrain PALETTE differs (linear Y-gradient via
// height_array at 0x3999A). The web port handles palette via setupSkyPalette().
function generateSlope(width, yStart, yEnd) {
  generateRolling(width, yStart, yEnd);
}

// EXE: Type 4 (V-Shaped) uses the SAME random walk kernel as all other types.
// "V-Shaped" refers only to the palette/coloring pattern, not the terrain shape.
function generateVShaped(width, yStart, yEnd) {
  generateRolling(width, yStart, yEnd);
}

// ======================================================================
// MTN TERRAIN FILE LOADER
// EXE: ScannedMountain class, file 0x029AAE; descriptor table at DS:0x5F04
// Format: 72-byte header + PCX-RLE nibble-packed 4bpp, column-major
// Header: magic=MT\xBE\xEF, h=rows/col, x_start/x_end, n_colors=16, palette@0x18
// Pixel data @0x48: byte>=0xC0 → run (count=b&0x3F, repeat next byte); byte<0xC0 → literal
// High nibble = first pixel, low nibble = second pixel; index 0 = sky (transparent)
// Height = first non-zero row from top per column; fraction 0=top, 1=bottom

const MTN_FILENAMES = [
  'ICE001.MTN', 'ICE002.MTN', 'ICE003.MTN',
  'ROCK001.MTN', 'ROCK002.MTN', 'ROCK003.MTN', 'ROCK004.MTN',
  'ROCK005.MTN', 'ROCK006.MTN', 'SNOW001.MTN',
];

// Array of parsed height maps: { xStart, xEnd, heights: Float32Array }
const mtnHeightMaps = [];

function parseMTNFile(buffer) {
  const d = new Uint8Array(buffer);
  if (d.length < 72) return null;
  // Verify magic: 'MT' 0xBE 0xEF
  if (d[0] !== 0x4D || d[1] !== 0x54 || d[2] !== 0xBE || d[3] !== 0xEF) return null;

  const h       = d[6]  | (d[7]  << 8);  // rows per column
  const xStart  = d[8]  | (d[9]  << 8);  // first encoded column
  const xEnd    = d[10] | (d[11] << 8);  // last encoded column + 1
  const numCols = xEnd - xStart;
  if (numCols <= 0 || h <= 0) return null;

  // Decode PCX-RLE into packed nibble bytes (column-major)
  const bytesPerCol = Math.ceil(h / 2);
  const totalBytes  = numCols * bytesPerCol;
  const packed = new Uint8Array(totalBytes);
  let outIdx = 0, i = 72;
  while (outIdx < totalBytes && i < d.length) {
    const b = d[i++];
    if (b >= 0xC0) {
      const count = b & 0x3F;
      const val   = d[i++];
      const end   = Math.min(outIdx + count, totalBytes);
      while (outIdx < end) packed[outIdx++] = val;
    } else {
      packed[outIdx++] = b;
    }
  }

  // Extract terrain height fraction for each column
  // For column c, scan rows 0..h-1 and find first non-zero (non-sky) pixel
  const heights = new Float32Array(numCols);
  for (let c = 0; c < numCols; c++) {
    const base = c * bytesPerCol;
    let found = false;
    for (let row = 0; row < h; row++) {
      const nibble = (row & 1) === 0
        ? (packed[base + (row >> 1)] >> 4) & 0xF
        :  packed[base + (row >> 1)]       & 0xF;
      if (nibble !== 0) {
        heights[c] = row / h;
        found = true;
        break;
      }
    }
    if (!found) heights[c] = 1.0;
  }

  return { xStart, xEnd, heights };
}

// Pre-load all MTN files into mtnHeightMaps[]. Called once at startup.
export async function loadMTNFiles() {
  for (const filename of MTN_FILENAMES) {
    try {
      const resp = await fetch(`earth/${filename}`);
      if (!resp.ok) continue;
      const parsed = parseMTNFile(await resp.arrayBuffer());
      if (parsed) mtnHeightMaps.push(parsed);
    } catch (_) { /* silently skip missing files */ }
  }
}

// Apply a parsed MTN height map to the terrain[] array.
// EXE: MTN data is 320px-wide; scale to current screen width.
function applyMTNHeights(mtn, width, yStart, yEnd) {
  const { xStart, xEnd, heights } = mtn;
  const playH = yEnd - yStart;
  const scale = width / 320;  // MTN columns are indexed in 320px space
  for (let x = 0; x < width; x++) {
    const mtnX = Math.floor(x / scale);
    let frac;
    if (mtnX < xStart)       frac = heights[0];
    else if (mtnX >= xEnd)   frac = heights[heights.length - 1];
    else                     frac = heights[mtnX - xStart];
    terrain[x] = clamp(Math.round(yStart + frac * playH), yStart, yEnd - 1);
  }
}

// EXE: Type 3 (Mountain) uses ScannedMountain (MTN files) or the same random walk.
// The EXE selects ScannedMountain vs LandGenerator based on MTN_PERCENT probability.
// When LandGenerator is selected, it's the same random walk as all other types.
function generateMountain(width, yStart, yEnd) {
  // EXE: MTN_PERCENT% chance of ScannedMountain class (default 20%)
  if (mtnHeightMaps.length > 0 && random(100) < config.mtnPercent) {
    applyMTNHeights(mtnHeightMaps[random(mtnHeightMaps.length)], width, yStart, yEnd);
    return;
  }
  // Non-MTN: same random walk kernel as all types
  generateRolling(width, yStart, yEnd);
}

// EXE: Type 5 (Castle) uses TWO random walk passes (file 0x29677).
// First pass generates ceiling terrain (yStart to midY), second pass generates
// floor terrain (midY to yEnd). drawColumn's +0x02 flag (set between passes)
// inverts draw direction: first pass fills from midY up, second from height down.
// Result: terrain on both top and bottom with an air gap between, like a castle hall.
function generateCastle(width, yStart, yEnd) {
  const midY = Math.floor((yStart + yEnd) / 2);

  // First pass: ceiling terrain — random walk in upper half
  generateRolling(width, yStart, midY);
  // Save as ceiling heights (terrain drawn from PLAYFIELD_TOP down to this height)
  for (let x = 0; x < width; x++) {
    ceilingTerrain[x] = terrain[x];
  }

  // Second pass: floor terrain — random walk in lower half
  generateRolling(width, midY, yEnd);
  // terrain[] now holds floor heights (terrain drawn from this height down to bottom)
}

// Main random walk algorithm
// EXE: height generation kernel at file 0x29808, ranges.cpp
// EXE: LAND1 controls flat chance (% momentum maintained), LAND2 controls bump chance
// EXE: LandGenerator struct +0x0A=flat_chance, +0x0C=bump_chance, +0x0E=flatten_peaks
// EXE: flatten_peaks (DS:5172=FLATLAND): suppresses walk_delta to 0 when |delta| > 3
function generateRolling(width, yStart, yEnd) {
  const flatChance = config.land1;         // default 20: % chance to maintain momentum
  const bumpChance = config.land2;         // default 20: % chance to double delta
  const flattenPeaks = config.flattenPeaks; // EXE: DS:5172=FLATLAND, struct+0x0E

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

    // EXE file 0x29849: if flatten_peaks and |delta| > 3, suppress to 0
    if (flattenPeaks && (walkDelta < -3 || walkDelta > 3))
      walkDelta = 0;

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
// Called once when sky type changes. The row→palette index mapping (80-109) is
// independent of the palette RGB values — those are set by setupSkyPalette().
// This enables clearToBackground() to fill the entire framebuffer in a single
// memcpy, emulating VGA hardware where every pixel always has a valid DAC color.
export function initSkyBackground() {
  // EXE: fill_height_array_palIdx (0x3999A) — uniform gradient, NOT per-column.
  // Formula: height_array[y] = (MAXY - y) * 29 / playfield_height + 120
  // where MAXY = screenHeight - 4 (DS:EF38), playfield_height = MAXY - YMIN (DS:ECB8)
  // EXE: YMIN (DS:EF40) = 38 at 480px, MAXY (DS:EF38) = 476 at 480px
  const MAXY = config.screenHeight - 4;
  const YMIN = Math.round(38 * config.screenHeight / 480);
  const playH = MAXY - YMIN;
  const rowColors = new Uint8Array(config.screenHeight);
  for (let y = 0; y < config.screenHeight; y++) {
    // Clamp to valid range: rows above YMIN get darkest, rows below MAXY get brightest
    const idx = Math.floor((MAXY - Math.max(YMIN, Math.min(y, MAXY))) * 29 / playH);
    rowColors[y] = SKY_PAL_START + Math.min(idx, SKY_PAL_COUNT - 1);
  }
  setBackground(rowColors);
}

// Draw sky (VGA 80-109 mapped to screen rows, 30 entries matching EXE VGA 120-149)
// Supports: 0=Plain, 1=Shaded, 2=Stars, 3=Storm, 4=Sunset, 5=Cavern, 6=Black
export function drawSky() {
  const width = config.screenWidth;

  // Base gradient fill from precomputed background table (single memcpy)
  clearToBackground();

  // Stars: scatter pixels (use resolvedSkyType for Random support)
  // EXE: palette 154 (VGA 0x9A) = (40,40,63) light blue-white, same as wind indicator
  if (resolvedSkyType === 2) {
    for (let i = 0; i < 80; i++) {
      const sx = random(width);
      const sy = random(PLAYFIELD_BOTTOM - HUD_HEIGHT) + HUD_HEIGHT;
      const brightness = random(3);  // EXE consumes this RNG call but uses single color
      setPixel(sx, sy, 154);
    }
  }

  // Storm: occasional bright lightning pixels (use resolvedSkyType for Random support)
  // EXE: also uses palette 154 for storm pixels
  if (resolvedSkyType === 3) {
    for (let i = 0; i < 15; i++) {
      const sx = random(width);
      const sy = random(PLAYFIELD_BOTTOM - HUD_HEIGHT) + HUD_HEIGHT;
      setPixel(sx, sy, 154);
    }
  }
}

// Build per-pixel terrain bitmap from the height map arrays.
// Called once after terrain generation. Subsequent terrain modifications
// (craters, dirt, tunnels) update the bitmap directly.
// EXE: terrain body is solid VGA 80; web uses TERRAIN_PAL_START (120) which
// all share the same ground color RGB, so a single constant index suffices.
export function buildTerrainBitmap() {
  terrainBitmap.fill(0);
  const bottom = PLAYFIELD_BOTTOM;

  for (let x = 0; x < WIDTH; x++) {
    // Floor terrain — single solid palette index (all 120-149 have same color)
    for (let y = terrain[x]; y <= bottom; y++) {
      terrainBitmap[y * WIDTH + x] = TERRAIN_PAL_START;
    }
    // Ceiling terrain (Castle mode — EXE type 5 draws terrain on both top and bottom)
    if (config.landType === 5 && ceilingTerrain[x] > 0) {
      for (let y = PLAYFIELD_TOP; y <= ceilingTerrain[x]; y++) {
        terrainBitmap[y * WIDTH + x] = TERRAIN_PAL_START;
      }
    }
  }
}

// Draw terrain from per-pixel bitmap (preserves crater holes, tunnels, etc.)
// EXE: drawColumn at file 0x29720, setTerrainPixel at file 0x3AB39
// EXE: palette_index = (terrain_bottom - y) * 29 / terrain_height + 120
export function drawTerrain(maxCol) {
  const xLimit = maxCol !== undefined ? Math.min(maxCol, WIDTH) : WIDTH;
  for (let y = PLAYFIELD_TOP; y < HEIGHT; y++) {
    const base = y * WIDTH;
    for (let x = 0; x < xLimit; x++) {
      const color = terrainBitmap[base + x];
      if (color) {
        setPixel(x, y, color);
      }
    }
  }
}

// Get terrain height at a given X coordinate
export function getTerrainY(x) {
  if (x < 0 || x >= config.screenWidth) return config.screenHeight;
  return terrain[x];
}
