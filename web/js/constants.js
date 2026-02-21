// Scorched Earth - Shared Constants
// Magic numbers extracted from EXE reverse engineering, used across multiple files.
// Centralizes palette indices, collision thresholds, and font dimensions.

// --- HUD/UI colors (VGA palette indices) ---
export const COLOR_HUD_TEXT = 150;      // gold/tan — labels, values, outlines
export const COLOR_HUD_HIGHLIGHT = 199; // bright yellow — selected items, active text
export const COLOR_HUD_WARNING = 179;   // muted red/grey — low HP, disabled indicators

// --- Player color math ---
// EXE: 10 players × 8 palette slots each (indices 0-79)
export const PLAYER_PALETTE_STRIDE = 8;   // palette slots per player
export const PLAYER_COLOR_FULL = 4;       // slot 4 = full brightness (used for text, barrel)

// --- Collision thresholds (pixel-based, from EXE extras.cpp) ---
// EXE VERIFIED: >0 && <80 = tank hit, >=105 = terrain hit
// Sky/HUD pixels (0, 80-104) pass through
export const PLAYER_COLOR_MAX = 80;       // pixel < 80 = tank hit
export const TERRAIN_THRESHOLD = 105;     // pixel >= 105 = terrain hit

// --- Terrain palette ---
// EXE: palette indices 120-149 (30 entries), depth-gradient coloring
export const TERRAIN_PAL_START = 120;
export const TERRAIN_PAL_COUNT = 30;

// --- Fire/explosion palette ---
// EXE: VGA 170-199 (3 bands x 10 entries)
export const FIRE_PAL_BASE = 170;
export const FIRE_PAL_COUNT = 30;

// --- Sky palette ---
// EXE: VGA 80-103 (24 entries), row-gradient mapping
export const SKY_PAL_START = 80;
export const SKY_PAL_COUNT = 24;

// --- 3D UI palette (VGA indices 200-208) ---
// EXE: UI color variables at DS:0xEF22-0xEF32, used by 3D box/title rendering
// Mapped to unused palette range 200-208 for web implementation
export const UI_HIGHLIGHT    = 200;  // DS:0xEF22 — selected item text (white)
export const UI_DARK_TEXT    = 201;  // DS:0xEF24 — unselected text, title layer 3
export const UI_DARK_BORDER  = 202;  // DS:0xEF26 — dark border edge, title layer 5
export const UI_BACKGROUND   = 203;  // DS:0xEF28 — button/panel fill (gray)
export const UI_LIGHT_ACCENT = 204;  // DS:0xEF2A — title layer 4
export const UI_DEEP_SHADOW  = 205;  // DS:0xEF2C — deepest shadow, title layer 1
export const UI_LIGHT_BORDER = 206;  // DS:0xEF2E — top-left highlight (raised box)
export const UI_MED_BORDER   = 207;  // DS:0xEF30 — bottom-right inner (raised box)
export const UI_BRIGHT_BORDER = 208; // DS:0xEF32 — bottom-right outer, title layer 2

// --- Font dimensions ---
// Fastgraph V4.02 proportional bitmap font (extracted from SCORCH.EXE)
// FONT_HEIGHT is exported from font.js; use measureText() for text widths
