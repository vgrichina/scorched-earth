// Scorched Earth - VGA Palette System
// EXE: VGA Mode 13h — 256-entry DAC palette, 6-bit per channel (0-63)
// EXE: palette ranges:
//   0-79:   player colors (10 players × 8 gradient slots) — DS:0x57E2 base colors
//   80-103: sky gradient (24 entries) — varies by sky type
//   104:    system black
//   105-119: unused
//   120-149: terrain gradient (30 entries) — varies by terrain type
//   150:    wall color
//   170-199: explosion fire palette (3 bands × 10)
//   253:    laser sight green (remapped from EXE 0x78 to avoid terrain overlap)
//   254:    laser sight white (EXE 0xFE)
// EXE: palette analysis in disasm/vga_palette_analysis.txt, disasm/color_palettes.txt

import { vga6to8, random } from './utils.js';

// Palette buffer: 256 entries × 3 channels (R, G, B) in 6-bit VGA space
export const palette6 = new Uint8Array(256 * 3);

// Pre-computed 32-bit RGBA lookup for fast blit (updated when palette changes)
export const palette32 = new Uint32Array(256);

// EXE: 10 player base colors (VGA 6-bit) from DS:0x57E2 (file 0x0C562)
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

// EXE: Type 5 (Varied) base color table from DS:0x5036 (file 0x0BDB6)
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
// EXE: tank color gradient setup at file 0x28540 (icons.cpp)
// EXE: slots 0-3 = dark→light body/dome, slot 4 = full color, slot 5 = white flash,
//   slot 6 = base repeat, slot 7 = grey smoke
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
// EXE: explosion player palette at VGA 81-85, fire palette at VGA 170-199
// EXE: 3 bands: Dark Red (170-179), Orange (180-189), Yellow (190-199)
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
// EXE: fg_setrgb(150, 50,50,50) at file 0x2A73B — medium gray wall
function setupWallPalette() {
  setEntry(150, 50, 50, 50); // Gray wall (was 40, EXE verified 50)
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

// --- 3D UI palette (VGA 200-208) ---
// EXE: UI color variables at DS:0xEF22-0xEF32 → palette indices 151-159
// Values extracted from fg_setrgb calls at file 0x2A640-0x2A770 (icons.cpp init):
//   fg_setrgb(151, 45,45,45) → EF2A=EF28 — background fill, medium gray
//   fg_setrgb(152,  0, 0, 0) → EF2C=EF22 — deepest shadow, black
//   fg_setrgb(153, 30,30,30) → EF24 — dark text, dark gray
//   fg_setrgb(155, 63,63,63) → EF26 — raised outer highlight, white (outer top-left)
//   fg_setrgb(156, 15,15,15) → EF32 — raised outer shadow, dark gray (outer bottom-right)
//   fg_setrgb(158,  5, 5, 5) → EF30 — sunken outer top, near-black
//   fg_setrgb(159, 55,55,55) → EF2E — raised inner highlight, light gray (inner top-left)
// EXE: UI_HIGHLIGHT (EF22) is dynamic — set to current player's base color before HUD draw
//   Web uses static white (63,63,63) as substitute since menus aren't per-player
function setupUIPalette() {
  setEntry(200, 63, 63, 63);  // UI_HIGHLIGHT — white (EXE: dynamic player color)
  setEntry(201, 30, 30, 30);  // UI_DARK_TEXT  — EF24→pal 153, dark gray (was 20)
  setEntry(202, 63, 63, 63);  // UI_DARK_BORDER — EF26→pal 155, WHITE outer highlight (was 32!)
  setEntry(203, 45, 45, 45);  // UI_BACKGROUND  — EF28→pal 151, medium gray (was 48)
  setEntry(204, 45, 45, 45);  // UI_LIGHT_ACCENT — EF2A→pal 151, same as background (was 52)
  setEntry(205,  0,  0,  0);  // UI_DEEP_SHADOW — EF2C→pal 152, black (was 8)
  setEntry(206, 55, 55, 55);  // UI_LIGHT_BORDER — EF2E→pal 159, light gray (was 63)
  setEntry(207,  5,  5,  5);  // UI_MED_BORDER  — EF30→pal 158, near-black (was 24!)
  setEntry(208, 15, 15, 15);  // UI_BRIGHT_BORDER — EF32→pal 156, dark gray (was 40!)
}

// --- Laser sight palette (VGA 253-254) ---
// EXE: draw_laser_sight at file 0x36321 (seg 0x2F76:0x01C1)
// EXE: DS:EC4E holds the draw color for the laser sight line
// EXE: Standard Laser — DS:EC4E = 0x78 (green/turquoise)
//   In the EXE, index 0x78 = 120 which is the terrain palette base. We remap to
//   VGA 253 to avoid conflict with terrain gradient at 120-149.
// EXE: Plasma Laser — DS:EC4E = 0xFE (bright white) = index 254
// EXE: DS:EC4C = erase mask — 0xFE for standard (skip white), -1 for plasma (no skip)
// Both entries must be explicitly set; palette6.fill(0) leaves them black.
export const LASER_GREEN = 253;  // remapped from EXE 0x78 (=120, terrain conflict)
export const LASER_WHITE = 254;  // matches EXE 0xFE (=254)
function setupLaserPalette() {
  // EXE: Laser green — 0x78 maps to a green/turquoise in the original VGA DAC
  setEntry(LASER_GREEN, 0, 48, 0);
  // EXE: Plasma white — 0xFE is bright white in the original VGA DAC
  setEntry(LASER_WHITE, 63, 63, 63);
}

// --- Shop accent palette animation (EXE: palette tick at file 0x14E34) ---
// EXE: accent color table at DS:0x1F62, 5 entries × 6 bytes RGB words.
// Cycles palette indices 8-11 every 8 frames (test [EC], 7).
// Palette entries 8-11 are player-1 slots 0-3 (dark gradient); they're safe
// to hijack during the shop because those dark shades aren't used in shop UI.
const ACCENT_COLORS = [
  [63,  0,  0],  // bright red
  [63, 32, 10],  // orange
  [63,  0, 63],  // magenta
  [63, 12, 12],  // dark red
  [63,  0, 30],  // deep pink
];
// Saved copies of palette entries 8-11 for restore after shop
const _savedAccent = new Uint8Array(4 * 3);

export function saveAccentPalette() {
  for (let i = 0; i < 4; i++) {
    const j = (8 + i) * 3;
    _savedAccent[i * 3]     = palette6[j];
    _savedAccent[i * 3 + 1] = palette6[j + 1];
    _savedAccent[i * 3 + 2] = palette6[j + 2];
  }
}

export function restoreAccentPalette() {
  for (let i = 0; i < 4; i++) {
    setEntry(8 + i, _savedAccent[i * 3], _savedAccent[i * 3 + 1], _savedAccent[i * 3 + 2]);
  }
  updatePalette32();
}

// Called each shop frame. Only updates palette (and returns true) every 8 frames.
export function tickAccentPalette(frame) {
  if ((frame & 7) !== 0) return false;
  const step = Math.floor(frame / 8) % ACCENT_COLORS.length;
  for (let i = 0; i < 4; i++) {
    const [r, g, b] = ACCENT_COLORS[(step + i) % ACCENT_COLORS.length];
    setEntry(8 + i, r, g, b);
  }
  updatePalette32();
  return true;
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
  setupUIPalette();
  setupLaserPalette();

  updatePalette32();
}

// Get the player base color (for external use)
export function getPlayerColor(playerIndex) {
  return PLAYER_COLORS[playerIndex];
}
