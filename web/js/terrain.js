// Scorched Earth - Terrain Generation
// EXE source: ranges.cpp (seg 0x2CBF, file base 0x33690)
// EXE: height generation random walk kernel at file 0x29808
// EXE: drawColumn per-column renderer at file 0x29720
// EXE: setTerrainPixel per-pixel color at file 0x3AB39
// EXE: 7 terrain types from SCORCH.CFG LAND_TYPE config
// EXE: LAND1 = bumpiness (flat chance), LAND2 = slope component

import { random, clamp } from './utils.js';
import { createStarSky, createSunsetSky, createStormSky } from './sky.js';
import { config, GRAPHICS_MODES } from './config.js';
import { setPixel, setBackground, setBackgroundPixels, clearToBackground } from './framebuffer.js';
import { SKY_PAL_START, SKY_PAL_COUNT, TERRAIN_PAL_START } from './constants.js';
import { resolvedSkyType, setPaletteRgb } from './palette.js';
import { selectScannedMountain } from './mountain-selection.js';
import { decodeMountain, renderMountain } from './mountain.js';

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
let cachedStars = null;
let previousSkyType = -1;
let generationDirection = -1; // EXE LandGenerator constructor 0x295C8
let selectedMountain = -1;
export let terrainBitmap = new Uint8Array(WIDTH * HEIGHT);

// Sky region: HUD occupies top rows, rest is playfield
// EXE: HUD raised box covers y=0–34, 3px playfield border at y=35–37, playfield at y=38
// EXE: SHIELD_DRAW_Y_MIN (DS:EF40) = 38 — first playfield row
export const HUD_HEIGHT = 38;
export const PLAYFIELD_TOP = HUD_HEIGHT;
let PLAYFIELD_BOTTOM = config.screenHeight - 1;

// Reinitialize terrain buffers for new graphics mode dimensions
export function reinitTerrainBuffers() {
  cachedStars = null;
  previousSkyType = -1;
  generationDirection = -1;
  selectedMountain = -1;
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
  const yEnd = config.screenHeight - 4; // EXE EF38: inside the 3px bottom border

  ceilingTerrain.fill(0);
  if (selectedMountain >= 0) {
    applyMountain(scannedMountains[selectedMountain]);
    return;
  }
  // EXE 0x295F5 toggles the selected generator object's direction. Scanned
  // rounds must not advance the procedural object's direction.
  generationDirection = -generationDirection;
  if (resolvedSkyType === 5) {
    generateCastle(width, yStart, yEnd);
    buildTerrainBitmap();
    return;
  }

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
    case 3:
      generateRolling(width, yStart, yEnd);
      break;
    case 4: // V-Shaped
      generateVShaped(width, yStart, yEnd);
      break;
    case 5: // Cavern geometry is selected by the resolved sky, above.
      generateRolling(width, yStart, yEnd);
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
// EXE 0x32E44: variable-height columns of bottom-up nibble-packed colors.
// See mountain.js for the decoder and crop/reflection renderer.

const MTN_FILENAMES = [
  'ICE001.MTN', 'ICE002.MTN', 'ICE003.MTN',
  'ROCK001.MTN', 'ROCK002.MTN', 'ROCK003.MTN', 'ROCK004.MTN',
  'ROCK005.MTN', 'ROCK006.MTN', 'SNOW001.MTN',
];

const scannedMountains = [];

// Pre-load all MTN files into scannedMountains[]. Called once at startup.
export async function loadMTNFiles() {
  for (const filename of MTN_FILENAMES) {
    try {
      const resp = await fetch(`earth/${filename}`);
      if (!resp.ok) continue;
      const parsed = decodeMountain(await resp.arrayBuffer());
      if (parsed) scannedMountains.push(parsed);
    } catch (_) { /* silently skip missing files */ }
  }
}

// Preserve scanned colors and per-pixel geometry instead of reducing them to
// a scaled height map. Web slots 128..143 map original VGA slots 88..103.
function applyMountain(mountain) {
  const bitmap = renderMountain(mountain, WIDTH, HEIGHT);
  terrainBitmap.fill(0);
  terrain.fill(HEIGHT - 4);
  for (let y = PLAYFIELD_TOP; y <= HEIGHT - 4; y++) {
    for (let x = 3; x <= WIDTH - 4; x++) {
      const color = bitmap[y * WIDTH + x];
      if (!color) continue;
      terrainBitmap[y * WIDTH + x] = color === 80 ? 120 : color + 40;
      if (y < terrain[x]) terrain[x] = y;
    }
  }
  // EXE 0x32FF4 stores dim colors for later illumination in Black mode,
  // but does not write them to the visible DAC during landscape generation.
  // Keep the black entries established by sky setup.
  if (resolvedSkyType === 6) return;
  const shift = 2;
  for (let i = 0; i < 16; i++) {
    setPaletteRgb(128 + i, ...mountain.palette.slice(i * 3, i * 3 + 3).map(c => c >> shift));
  }
  const base = mountain.groundIndex * 3;
  setPaletteRgb(120, ...mountain.palette.slice(base, base + 3).map(c => c >> shift));
}

// Run between wind and sky initialization, independently of ground palette.
// Scanned pixels are decoded and rendered by mountain.js.
export function prepareTerrainGenerator() {
  // The EXE retains the last resolved sky between Random rounds. A previous
  // Cavern therefore skips this round's mountain probability draw as well.
  const selectionSky = config.skyType === 7 && previousSkyType >= 0
    ? previousSkyType : config.skyType;
  selectedMountain = selectScannedMountain(selectionSky, config.mtnPercent, scannedMountains.length);
  return selectedMountain;
}

// EXE 0x29677: floor pass first, then an inverted ceiling pass, using
// the same horizontal direction. The ceiling ends just before the walk Y.
function generateCastle(width, yStart, yEnd) {
  const midY = Math.trunc((yStart + yEnd) / 2);
  generateRolling(width, midY, yEnd);
  generateRolling(width, yStart, midY, ceilingTerrain);
  for (let x = 3; x <= width - 4; x++) ceilingTerrain[x]--;
  // No ceiling outside the playfield frame.
  ceilingTerrain.fill(0, 0, 3);
  ceilingTerrain.fill(0, width - 3);
}

// Main random walk algorithm
// EXE: height generation kernel at file 0x29808, ranges.cpp
// EXE: LAND1 is the chance to change momentum; LAND2 doubles that change
// EXE: LandGenerator struct +0x0A=flat_chance, +0x0C=bump_chance, +0x0E=flatten_peaks
// EXE: flatten_peaks (DS:5172=FLATLAND): suppresses walk_delta to 0 when |delta| > 3
function generateRolling(width, yStart, yEnd, heights = terrain, {
  left = 3, right = width - 4, direction = generationDirection,
  changeChance = config.land1, bumpChance = config.land2,
  flattenPeaks = config.flattenPeaks,
} = {}) {

  // Starting height: random within playfield
  let y = random(yEnd - yStart - 60) + yStart + 40;
  let walkDelta = 0;

  // EXE EF42..EF3C: inclusive horizontal bounds inside the 3px frame.
  heights.fill(yEnd);
  const first = direction === 1 ? left : right;
  const last = direction === 1 ? right : left;
  for (let col = first; direction === 1 ? col <= last : col >= last; col += direction) {
    heights[col] = clamp(Math.floor(y), yStart + 20, yEnd - 1);

    if (random(100) < changeChance) {
      let change = random(3) - 1;
      if (random(100) < bumpChance) change *= 2;
      walkDelta += change;

      // EXE 0x29890: accumulate the change, then suppress extreme momentum.
      if (flattenPeaks && (walkDelta < -3 || walkDelta > 3))
        walkDelta = 0;
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

// Native main_menu 0x3D61C..0x3D671: a fresh procedural generator with
// fixed landscape settings, bounded by the preview interior. It does not
// advance the persistent gameplay generator's alternating direction.
export function generateMenuTerrain(left, top, right, bottom) {
  generateRolling(config.screenWidth, top, bottom, terrain, {
    left, right, direction: 1, changeChance: 20, bumpChance: 20, flattenPeaks: false,
  });
}

// Build the persistent sky background: row gradients plus any bitmap pattern.
// Redraws copy these pixels; only initialization may consume gameplay RNG.
export function initSkyBackground({ reuseStars = false, wrap = config.wallType === 1 } = {}) {
  // EXE row tables: shaded/black use 29 levels (0x3999A), Sunset uses
  // 28 levels above entry 121 (0x39DF1), Cavern mirrors about mid-height (0x39EFC).
  const MAXY = config.screenHeight - 4;
  const YMIN = PLAYFIELD_TOP;
  const playH = MAXY - YMIN;
  const middle = Math.trunc((MAXY + YMIN) / 2);
  const halfHeight = Math.trunc(playH / 2);
  const rowColors = new Uint8Array(config.screenHeight);
  for (let y = 0; y < config.screenHeight; y++) {
    const row = clamp(y, YMIN, MAXY);
    let idx;
    if (resolvedSkyType === 0) {
      idx = 0; // Plain uses just VGA entry 120.
    } else if (resolvedSkyType === 4) {
      idx = 1 + Math.trunc((MAXY - row) * 28 / playH);
    } else if (resolvedSkyType === 5) {
      idx = Math.trunc(Math.abs(row - middle) * 29 / halfHeight);
    } else {
      idx = Math.trunc((MAXY - row) * 29 / playH);
    }
    rowColors[y] = SKY_PAL_START + Math.min(idx, SKY_PAL_COUNT - 1);
  }
  setBackground(rowColors);
  if (resolvedSkyType === 2) {
    // EXE 0x39A1C compares the prior resolved sky with the new one. Consecutive
    // Stars retain their field even when both were selected through Random.
    if (!reuseStars || previousSkyType !== 2 || !cachedStars)
      cachedStars = createStarSky(config.screenWidth, config.screenHeight);
    setBackgroundPixels(cachedStars);
  }
  if (resolvedSkyType === 3) setBackgroundPixels(createStormSky(config.screenWidth, config.screenHeight,
    GRAPHICS_MODES[config.graphicsMode].displayAspect, wrap));
  if (resolvedSkyType === 4) setBackgroundPixels(createSunsetSky(config.screenWidth, config.screenHeight,
    GRAPHICS_MODES[config.graphicsMode].displayAspect));
  previousSkyType = resolvedSkyType;
}

// Draw sky (VGA 80-109 mapped to screen rows, 30 entries matching EXE VGA 120-149)
// Supports: 0=Plain, 1=Shaded, 2=Stars, 3=Storm, 4=Sunset, 5=Cavern, 6=Black
export function drawSky() {
  clearToBackground();
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
    if (ceilingTerrain[x] > 0) {
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
