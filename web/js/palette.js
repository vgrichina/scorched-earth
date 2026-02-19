// Scorched Earth - VGA Palette System
// 256-entry palette, all values stored as VGA 6-bit (0-63)
// Converted to 8-bit on blit to canvas

import { vga6to8, random } from './utils.js';

// Palette buffer: 256 entries × 3 channels (R, G, B) in 6-bit VGA space
export const palette6 = new Uint8Array(256 * 3);

// Pre-computed 32-bit RGBA lookup for fast blit (updated when palette changes)
export const palette32 = new Uint32Array(256);

// 10 player base colors (VGA 6-bit) from DS:0x57E2
const PLAYER_COLORS = [
  [63, 10, 10],  // 0: Red
  [35, 55, 10],  // 1: Lime Green
  [40, 20, 63],  // 2: Purple
  [63, 63, 10],  // 3: Yellow
  [10, 63, 63],  // 4: Cyan
  [63, 10, 63],  // 5: Magenta
  [60, 60, 60],  // 6: White
  [63, 40, 20],  // 7: Orange
  [20, 63, 40],  // 8: Sea Green
  [ 0,  0, 63],  // 9: Blue
];

// Type 5 (Varied) base color table from DS:0x5036
const VARIED_COLORS = [
  [38, 25, 17],  // Warm brown
  [54, 36, 28],  // Light tan
  [53, 53, 47],  // Silver gray
  [20, 62, 20],  // Bright green
  [ 9, 35,  9],  // Dark green
  [36, 54, 28],  // Yellow-green
];

function setEntry(index, r, g, b) {
  const i = index * 3;
  palette6[i]     = r;
  palette6[i + 1] = g;
  palette6[i + 2] = b;
}

function getEntry(index) {
  const i = index * 3;
  return [palette6[i], palette6[i + 1], palette6[i + 2]];
}

// Rebuild the 32-bit RGBA lookup from current 6-bit palette
export function updatePalette32() {
  for (let i = 0; i < 256; i++) {
    const r = vga6to8(palette6[i * 3]);
    const g = vga6to8(palette6[i * 3 + 1]);
    const b = vga6to8(palette6[i * 3 + 2]);
    // RGBA in little-endian: ABGR
    palette32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  }
}

// --- Player colors (VGA 0-79): 10 players × 8 gradient slots ---
export function setupPlayerPalette() {
  for (let p = 0; p < 10; p++) {
    const [br, bg, bb] = PLAYER_COLORS[p];
    const base = p * 8;

    // Slots 0-3: darkest to light (base * (n+1) / 5)
    for (let s = 0; s < 4; s++) {
      setEntry(base + s,
        Math.floor(br * (s + 1) / 5),
        Math.floor(bg * (s + 1) / 5),
        Math.floor(bb * (s + 1) / 5)
      );
    }
    // Slot 4: full base color
    setEntry(base + 4, br, bg, bb);
    // Slot 5: white flash
    setEntry(base + 5, 63, 63, 63);
    // Slot 6: base color (repeat)
    setEntry(base + 6, br, bg, bb);
    // Slot 7: grey smoke
    setEntry(base + 7, 30, 30, 30);
  }
}

// --- Sky palette (VGA 80-103, 24 entries) ---
// Entry 104 reserved for system black
// 7 sky types: 0=Plain, 1=Shaded, 2=Stars, 3=Storm, 4=Sunset, 5=Cavern, 6=Black
export function setupSkyPalette(skyType) {
  switch (skyType) {
    case 1: // Shaded — gentle variation on plain
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const r = Math.floor(t * 15 + random(5));
        const g = Math.floor(t * 15 + (1 - t) * 8 + random(3));
        const b = Math.floor(35 + t * 28);
        setEntry(80 + i, r, g, b);
      }
      break;
    case 2: // Stars — black background
      for (let i = 0; i < 24; i++) {
        setEntry(80 + i, 0, 0, Math.floor(i * 0.5));
      }
      break;
    case 3: // Storm — dark grey gradient
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const grey = Math.floor(8 + t * 15);
        setEntry(80 + i, grey, grey, Math.floor(grey * 1.1));
      }
      break;
    case 4: // Sunset — warm orange to purple gradient
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const r = Math.floor(63 - t * 35);
        const g = Math.floor(20 - t * 15);
        const b = Math.floor(10 + t * 40);
        setEntry(80 + i, Math.max(0, r), Math.max(0, g), Math.min(63, b));
      }
      break;
    case 5: // Cavern — dark brownish
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        setEntry(80 + i, Math.floor(5 + t * 8), Math.floor(3 + t * 5), Math.floor(2 + t * 3));
      }
      break;
    case 6: // Black — solid black
      for (let i = 0; i < 24; i++) {
        setEntry(80 + i, 0, 0, 0);
      }
      break;
    case 0: // Plain — gradient blue (default)
    default:
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const r = Math.floor(t * 20);
        const g = Math.floor(t * 20 + (1 - t) * 5);
        const b = Math.floor(40 + t * 23);
        setEntry(80 + i, r, g, b);
      }
      break;
  }
}

// --- Terrain palette (VGA 120-149): 30 entries ---
// VGA 149 = surface (top), VGA 120 = deepest underground
export function setupTerrainPalette(terrainType) {
  switch (terrainType) {
    case 0: // Blue Ice: black → dark blue (9,9,31) in 16 steps
      setupTerrainGradient(9, 9, 31);
      break;

    case 1: // Snow/Ice: white-blue (29,29,63) → pure blue (0,0,63)
      for (let di = 0; di < 30; di++) {
        setEntry(120 + di, 29 - di, 29 - di, 63);
      }
      break;

    case 2: // Rock/Gray: dark gray → white with scatter
      for (let di = 0; di < 30; di++) {
        const base = di * 2 + 7;
        const scatter = random(6) - 3;
        const val = Math.max(0, Math.min(63, base + scatter));
        setEntry(120 + di, val, val, val);
      }
      break;

    case 3: // Night: dark blue core + gray surface
      for (let di = 0; di < 15; di++) {
        const t = di / 14;
        setEntry(120 + di, 0, 0, Math.floor(30 * t));
      }
      for (let di = 15; di < 30; di++) {
        const t = (di - 15) / 14;
        const gray = Math.floor(38 * t);
        setEntry(120 + di, gray, gray, gray);
      }
      break;

    case 4: // Desert/Lava: yellow → red-brown
      for (let di = 0; di < 30; di++) {
        const t = di / 29;
        setEntry(120 + di,
          63,
          Math.floor(20 + (63 - 20) * (1 - t)),
          Math.floor(2 + (20 - 2) * t)
        );
      }
      break;

    case 5: { // Varied: random from 6-entry table
      const cidx = random(6);
      const [cr, cg, cb] = VARIED_COLORS[cidx];
      for (let di = 0; di < 30; di++) {
        setEntry(120 + di,
          Math.floor(cr * (di + 8) / 45),
          Math.floor(cg * (di + 8) / 45),
          Math.floor(cb * (di + 8) / 45)
        );
      }
      break;
    }

    default: // Fallback to Rock/Gray
      setupTerrainPalette(2);
      break;
  }
}

// setTerrainPalette: 16-step gradient from black to target color (used by type 0)
function setupTerrainGradient(tr, tg, tb) {
  for (let di = 0; di < 30; di++) {
    const t = di / 29;
    setEntry(120 + di,
      Math.floor(tr * t),
      Math.floor(tg * t),
      Math.floor(tb * t)
    );
  }
}

// --- Explosion fire palette (VGA 170-199) ---
export function setupExplosionPalette() {
  for (let si = 0; si < 10; si++) {
    // Group 1 (170-179): Dark Red Fire
    setEntry(170 + si, si * 2 + 43, si + 10, si + 10);
    // Group 2 (180-189): Orange Fire
    setEntry(180 + si, si * 2 + 43, si * 2 + 10, si + 10);
    // Group 3 (190-199): Yellow Fire
    setEntry(190 + si, si * 2 + 43, si * 2 + 43, si + 10);
  }
}

// --- Wall color (VGA 150) ---
function setupWallPalette() {
  setEntry(150, 40, 40, 40); // Gray wall
}

// --- System colors ---
// Dedicated true-black entry for HUD background, outlines, etc.
// Must be < 80 (tank threshold) to avoid collision false positives,
// but not in range 0-79 (player gradients). Use entry 80 and shift sky to 81-104.
// Simpler: use entry 104 (last sky slot) as black — sky only needs 24 entries (80-103).
export const BLACK = 104;
function setupSystemColors() {
  setEntry(BLACK, 0, 0, 0);
}

// Initialize entire palette
export function initPalette(terrainType, skyType) {
  // Clear all to black
  palette6.fill(0);

  setupPlayerPalette();
  setupSkyPalette(skyType);
  setupTerrainPalette(terrainType);
  setupExplosionPalette();
  setupWallPalette();
  setupSystemColors();

  updatePalette32();
}

// Get the player base color (for external use)
export function getPlayerColor(playerIndex) {
  return PLAYER_COLORS[playerIndex];
}
