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

// --- Font dimensions ---
// CP437 8x8 BIOS font (IBM VGA standard, Fastgraph V4.02)
export const CHAR_W = 8;
export const CHAR_H = 8;
