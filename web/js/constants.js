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
// EXE uses Fastgraph dual-page: display has sky VGA 120-149 (>=105),
// collision page has sky=0. Web uses terrainBitmap[] for terrain detection.
// Player hit still uses framebuffer pixel < 80.
export const PLAYER_COLOR_MAX = 80;       // pixel < 80 = tank hit

// --- Terrain palette ---
// EXE: palette indices 120-149 (30 entries), depth-gradient coloring
export const TERRAIN_PAL_START = 120;
export const TERRAIN_PAL_COUNT = 30;

// --- Fire/explosion palette ---
// EXE: VGA 170-199 (3 bands x 10 entries)
export const FIRE_PAL_BASE = 170;
export const FIRE_PAL_COUNT = 30;

// --- Sky palette ---
// EXE: VGA 120-149 (30 entries), row-gradient mapping
// Web: VGA 80-109 (30 entries) — matches EXE count for pixel-perfect gradients
export const SKY_PAL_START = 80;
export const SKY_PAL_COUNT = 30;

// --- 3D UI palette (VGA indices 151-160, matching EXE) ---
// EXE: UI color variables at DS:0xEF22-0xEF32, used by 3D box/title rendering
// Aligned to EXE VGA indices (151-159, skipping 154=wind indicator)
export const UI_HIGHLIGHT    = 152;  // DS:0xEF22 — selected item text (white); EXE: dynamic per-player
export const UI_DARK_TEXT    = 153;  // DS:0xEF24 — unselected text, dark gray
export const UI_DARK_BORDER  = 155;  // DS:0xEF26 — dark border edge, white (outer top-left)
export const UI_BACKGROUND   = 151;  // DS:0xEF28 — button/panel fill, medium gray
export const UI_LIGHT_ACCENT = 157;  // DS:0xEF2A — title layer 4 (EXE: same RGB as background)
export const UI_DEEP_SHADOW  = 160;  // DS:0xEF2C — deepest shadow, title layer 1 (EXE: same RGB as highlight)
export const UI_LIGHT_BORDER = 159;  // DS:0xEF2E — top-left highlight (raised box), light gray
export const UI_MED_BORDER   = 158;  // DS:0xEF30 — bottom-right inner (raised box), near-black
export const UI_BRIGHT_BORDER = 156; // DS:0xEF32 — bottom-right outer, dark gray

// --- Font dimensions ---
// Fastgraph V4.02 proportional bitmap font (extracted from SCORCH.EXE)
// FONT_HEIGHT is exported from font.js; use measureText() for text widths
