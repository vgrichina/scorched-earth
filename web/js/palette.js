// Scorched Earth - VGA Palette System
// EXE: VGA Mode 13h — 256-entry DAC palette, 6-bit per channel (0-63)
// EXE: palette ranges:
//   0-79:   player colors (10 players × 8 gradient slots) — DS:0x57E2 base colors
//   80-104: sky gradient (25 entries) — varies by sky type
//   105-119: unused
//   120-149: terrain gradient (30 entries) — varies by terrain type
//   150:    wall color
//   170-199: explosion fire palette (3 bands × 10)
//   210-219: shield per-player entries
//   252:    system black (UI screens only)
//   253:    laser sight green (remapped from EXE 0x78 to avoid terrain overlap)
//   254:    laser sight white (EXE 0xFE)
// EXE: palette analysis in disasm/vga_palette_analysis.txt, disasm/color_palettes.txt

import { vga6to8, random } from './utils.js';

// Palette buffer: 256 entries × 3 channels (R, G, B) in 6-bit VGA space
export const palette6 = new Uint8Array(256 * 3);

// Resolved sky type after Random (6) resolution — used by terrain.js drawSky()
export let resolvedSkyType = 0;

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

// EXE: fg_setrgb equivalent — set a single palette entry and update the 32-bit lookup
// Used for dynamic per-frame palette changes (shield color, shop animation, etc.)
export function setPaletteRgb(index, r, g, b) {
  setEntry(index, r, g, b);
  const r8 = vga6to8(r);
  const g8 = vga6to8(g);
  const b8 = vga6to8(b);
  palette32[index] = (255 << 24) | (b8 << 16) | (g8 << 8) | r8;
}

// --- Player colors (VGA 0-79): 10 players × 8 gradient slots ---
// EXE: tank color gradient setup at file 0x28540 (icons.cpp)
// EXE: setup_player_palette (0x285A2) — slots 0-4,6 all get same color: base*8/10
//   slot 5 = white(63,63,63), slot 7 = grey(30,30,30)
//   Color stored in tank struct +0x1C/+0x1E/+0x20 at player.cpp 0x326EA
export function setupPlayerPalette() {
  for (let p = 0; p < 10; p++) {
    const [br, bg, bb] = PLAYER_COLORS[p];
    const base = p * 8;
    // EXE: base_color * 8 / 10 (integer division, 80% brightness)
    const r80 = Math.floor(br * 8 / 10);
    const g80 = Math.floor(bg * 8 / 10);
    const b80 = Math.floor(bb * 8 / 10);

    // Slots 0-4: all same 80% color
    for (let s = 0; s < 5; s++) {
      setEntry(base + s, r80, g80, b80);
    }
    // Slot 5: white flash
    setEntry(base + 5, 63, 63, 63);
    // Slot 6: same 80% color
    setEntry(base + 6, r80, g80, b80);
    // Slot 7: grey smoke
    setEntry(base + 7, 30, 30, 30);
  }
}

// --- Sky palette (VGA 80-104, 25 entries) ---
// 7 sky types: 0=Plain, 1=Shaded, 2=Stars, 3=Storm, 4=Sunset, 5=Black, 6=Random
// EXE Random resolution (file 0x3978E): random(6)→0-5, re-rolls Cavern if no .mtn
export function setupSkyPalette(skyType) {
  // Resolve Random (6) to a concrete type (0-5)
  if (skyType === 6) skyType = random(6);
  resolvedSkyType = skyType;
  switch (skyType) {
    case 1: // Shaded — EXE 0x39969: 30-entry gradient R=G=29-di, B=63 at VGA 120-149
      // Mapped to 25 sky entries: R=G=floor(i*29/24), B=63 (dark blue top → lighter bottom)
      for (let i = 0; i < 25; i++) {
        const rg = Math.floor(i * 29 / 24);
        setEntry(80 + i, rg, rg, 63);
      }
      break;
    case 2: // Stars — black background
      for (let i = 0; i < 25; i++) {
        setEntry(80 + i, 0, 0, Math.floor(i * 0.5));
      }
      break;
    case 3: // Storm — dark grey gradient
      for (let i = 0; i < 25; i++) {
        const t = i / 24;
        const grey = Math.floor(8 + t * 15);
        setEntry(80 + i, grey, grey, Math.floor(grey * 1.1));
      }
      break;
    case 4: // Sunset — cool blue/indigo at top → warm orange/red at bottom (verified from v86)
      for (let i = 0; i < 25; i++) {
        const t = i / 24;
        const r = Math.floor(28 + t * 35);   // 28→63 (warm at bottom)
        const g = Math.floor(5 + t * 15);    // 5→20
        const b = Math.floor(50 - t * 40);   // 50→10 (cool at top)
        setEntry(80 + i, r, g, b);
      }
      break;
    case 5: // Black — solid black
      for (let i = 0; i < 25; i++) {
        setEntry(80 + i, 0, 0, 0);
      }
      break;
    case 0: // Plain — gradient blue (default)
    default:
      for (let i = 0; i < 25; i++) {
        const t = i / 24;
        const r = Math.floor(t * 20);
        const g = Math.floor(t * 20 + (1 - t) * 5);
        const b = Math.floor(40 + t * 23);
        setEntry(80 + i, r, g, b);
      }
      break;
  }
}

// --- Ground color table (EXE DS:0x5036, 6 entries × 3 words R,G,B) ---
// random(6) selects one per round; used as solid terrain fill for types 1,5,6
const GROUND_COLORS = [
  [38, 25, 17],  // Brown
  [54, 36, 28],  // Salmon
  [53, 53, 47],  // Light gray
  [20, 62, 20],  // Green
  [ 9, 35,  9],  // Dark green
  [36, 54, 28],  // Olive/tan
];

// --- Terrain palette (VGA 120-149): 30 entries ---
// VGA 149 = surface (top), VGA 120 = deepest underground
export function setupTerrainPalette(terrainType) {
  switch (terrainType) {
    case 0: // Blue Ice: black → dark blue (9,9,31) in 16 steps
      setupTerrainGradient(9, 9, 31);
      break;

    case 1: { // Shaded: solid ground color from random(6) table (EXE 0x2923C)
      // EXE: drawColumn fills terrain body with VGA 80 (solid), sky with VGA 120-149 gradient.
      // Web: terrain body uses VGA 120-149 range, so fill all 30 entries with one ground color.
      const gc = GROUND_COLORS[random(GROUND_COLORS.length)];
      for (let di = 0; di < 30; di++) {
        setEntry(120 + di, gc[0], gc[1], gc[2]);
      }
      break;
    }

    case 2: // Rock/Gray: dark gray → white with scatter
      for (let di = 0; di < 30; di++) {
        const base = di * 2 + 7;
        const scatter = random(6) - 3;
        const val = Math.max(0, Math.min(63, base + scatter));
        setEntry(120 + di, val, val, val);
      }
      break;

    case 3: // Night/MTN: 10-entry blue-gray + 20-entry gray depth (EXE 0x39AEF)
      // Loop 1 (VGA 120-129): R=G=di, B=di+30 — blue-tinted terrain gradient
      for (let di = 0; di < 10; di++) {
        setEntry(120 + di, di, di, di + 30);
      }
      // Loop 2 (VGA 130-149): R=G=B=(di-10)*2 — gray depth gradient
      for (let di = 10; di < 30; di++) {
        setEntry(120 + di, (di - 10) * 2, (di - 10) * 2, (di - 10) * 2);
      }
      break;

    case 5: // Castle: same 3-band Sunset-style FPU gradient as Type 4 (EXE 0x39C31)
    case 4: { // Desert/Lava + Castle: 3-segment FPU gradient matching EXE (file 0x39C31)
      // VGA 120: bright yellow (set separately in EXE via set_sky_palette_entry)
      setEntry(120, 63, 63, 0);
      // Loop 1 (VGA 121-130): warm gold → red-brown
      for (let di = 0; di < 10; di++) {
        const t2 = (9 - di) / 10, t1 = 1 - t2;
        setEntry(121 + di,
          Math.trunc(t2 * 63 + t1 * 63),  // R: 63 constant
          Math.trunc(t2 * 63 + t1 * 20),  // G: 58→20
          Math.trunc(t1 * 20)             // B: 2→20
        );
      }
      // Loop 2 (VGA 131-140): red → blue-purple
      for (let di = 0; di < 10; di++) {
        const t2 = (9 - di) / 10, t1 = 1 - t2;
        setEntry(131 + di,
          Math.trunc(t2 * 63 + t1 * 29),  // R: 59→29
          Math.trunc(t2 * 20 + t1 * 29),  // G: 20→29
          Math.trunc(t2 * 20 + t1 * 63)   // B: 24→63
        );
      }
      // Loop 3 (VGA 141-149): blue-purple → dark indigo (same t2=(9-di)/10 formula)
      for (let di = 0; di < 9; di++) {
        const t2 = (9 - di) / 10, t1 = 1 - t2;
        setEntry(141 + di,
          Math.trunc(t2 * 29 + t1 * 9),   // R=G: 27→11
          Math.trunc(t2 * 29 + t1 * 9),
          Math.trunc(t2 * 63 + t1 * 31)   // B: 59→34
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
  // VGA 154 (0x9A) — wind indicator text+arrow color (file 0x28FBC: fg_setcolor(0x9A))
  // EXE: fg_setrgb(0x9A, 0x28, 0x28, 0x3F) at file 0x2A71A (icons.cpp init block)
  // = (40, 40, 63) medium blue — subtle against most sky types
  setEntry(154, 40, 40, 63);
}

// --- System colors ---
// Dedicated true-black entry for HUD background, outlines, etc.
// Entry 252 is in unused palette space (above shield entries 210-219, below laser 253-254).
// Only used for UI screens (menus, shop, game-over) — not in playfield during projectile flight.
export const BLACK = 252;
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

// --- Shop palette animation (EXE: palette tick at file 0x14E34) ---
// Three animation effects driven by DS:0x00EC frame counter (0..100 wrapping):
//   1. VGA 2: pulsing red/orange triangle wave (every frame, 100-frame period)
//   2. VGA 8-11: accent color cycling using entries 1-4 (every 8 frames, 4-step rotation)
//   3. VGA 14-18: gray gradient cycling with 5 levels (every frame, changes every 2 frames)
//
// Accent color table at DS:0x1F62 (5 entries × 6 bytes RGB words):
//   [0] bright red (63,0,0) — used by sparkle animation only, NOT accent cycling
//   [1] orange (63,32,10)
//   [2] magenta (63,0,63)
//   [3] dark red (63,12,12)
//   [4] deep pink (63,0,30)
const ACCENT_COLORS = [
  [63,  0,  0],  // [0] bright red (sparkle only)
  [63, 32, 10],  // [1] orange
  [63,  0, 63],  // [2] magenta
  [63, 12, 12],  // [3] dark red
  [63,  0, 30],  // [4] deep pink
];
// 5 gray levels for VGA 14-18 cycling (0x00, 0x0F, 0x1E, 0x2D, 0x3C)
const GRAY_LEVELS = [0, 15, 30, 45, 60];

// Saved copies of palette entries 2, 8-11, 14-18 for restore after shop
const _savedAccent = new Uint8Array((1 + 4 + 5) * 3);

export function saveAccentPalette() {
  // Save VGA 2
  for (let c = 0; c < 3; c++) _savedAccent[c] = palette6[2 * 3 + c];
  // Save VGA 8-11
  for (let i = 0; i < 4; i++) {
    for (let c = 0; c < 3; c++) _savedAccent[3 + i * 3 + c] = palette6[(8 + i) * 3 + c];
  }
  // Save VGA 14-18
  for (let i = 0; i < 5; i++) {
    for (let c = 0; c < 3; c++) _savedAccent[15 + i * 3 + c] = palette6[(14 + i) * 3 + c];
  }
}

export function restoreAccentPalette() {
  // Restore VGA 2
  setEntry(2, _savedAccent[0], _savedAccent[1], _savedAccent[2]);
  // Restore VGA 8-11
  for (let i = 0; i < 4; i++) {
    const o = 3 + i * 3;
    setEntry(8 + i, _savedAccent[o], _savedAccent[o + 1], _savedAccent[o + 2]);
  }
  // Restore VGA 14-18
  for (let i = 0; i < 5; i++) {
    const o = 15 + i * 3;
    setEntry(14 + i, _savedAccent[o], _savedAccent[o + 1], _savedAccent[o + 2]);
  }
  updatePalette32();
}

// Called each shop frame. EXE counter wraps 0..100 with triangle wave.
export function tickAccentPalette(frame) {
  // EXE: DS:0x00EC counter wraps at 100
  const counter = frame % 101;

  // Part 1: VGA 2 — pulsing red/orange triangle wave
  // tri = (counter < 50) ? counter : (100 - counter)  → range 0..50
  // R = tri*63/50, G = tri*10/50, B = 0
  const tri = (counter < 50) ? counter : (100 - counter);
  setEntry(2, Math.floor(tri * 63 / 50), Math.floor(tri * 10 / 50), 0);

  // Part 2: VGA 8-11 — accent cycling every 8 frames
  // EXE: si = ((counter >> 3) & 3) + 1, uses entries 1-4 only
  if ((counter & 7) === 0) {
    let si = ((counter >> 3) & 3) + 1;
    for (let idx = 8; idx <= 11; idx++) {
      const [r, g, b] = ACCENT_COLORS[si];
      setEntry(idx, r, g, b);
      si++;
      if (si > 4) si = 1;
    }
  }

  // Part 3: VGA 14-18 — gray gradient cycling
  // EXE: si = (counter/2) % 5 + 14, writes 5 gray levels cycling through 14-18
  let gi = Math.floor(counter / 2) % 5;
  for (let k = 0; k < 5; k++) {
    const palIdx = 14 + gi;
    const g = GRAY_LEVELS[k];
    setEntry(palIdx, g, g, g);
    gi++;
    if (gi >= 5) gi = 0;
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
