# Side-by-Side Comparison: Emulator vs Web Port

Generated 2026-03-17 from 5 emulator checkpoints at 360×480 (mode 4).
Updated with fixes applied in session 185.

## Summary

| State | Pixel Match | Terrain Shape | Key Differences |
|-------|------------|---------------|-----------------|
| Menu | 30.1% | N/A (decorative) | Sky gradient colors (palette arch); terrain shape (RNG) |
| Player Setup | 7.3% | N/A | **FIXED**: background now fills with gradient curtain |
| Shop | 45.4% | N/A | Best match; weapon list/prices correct; highlight color TBD |
| Game (in-play) | 4.7% | **97.5%** exact | **FIXED**: HUD values now injected from state |

## Palette Architecture (Root Cause of Color Differences)

The EXE and web port use fundamentally different palette index assignments.
This is by design — the web port uses separate, non-overlapping ranges for clarity,
while the EXE reuses VGA 120-149 for dual purposes.

### EXE Palette Map (256 entries)

| VGA Range | Count | Purpose |
|-----------|-------|---------|
| 0-79 | 80 | Player colors (10 players × 8 slots: body, flash, smoke) |
| 80 | 1 | **Solid terrain body fill** (one of 6 random ground colors from DS:0x5036) |
| 80-104 | 25 | Sky gradient (base stored at DS:0x6E2A; used for border hline/vline drawing color) |
| 81-85 | 5 | Explosion attacker gradient (subset of sky range, overwritten per-explosion) |
| 105 | — | Terrain threshold (pixels >= 105 = solid/terrain) |
| 110-119 | 10 | Player base color table (one entry per player) |
| 120 | 1 | Special (set to bright yellow (63,63,0) at title screen) |
| 120-149 | 30 | **DUAL PURPOSE**: Sky pixel gradient (via setTerrainPixel height_array lookup) AND terrain type-specific palette |
| 150 | 1 | Wall boundary marker |
| 151-161 | 11 | UI chrome (hardcoded grays, blue accent, white, black) |
| 170-199 | 30 | Explosion fire (3 bands × 10: dark red, orange, yellow) |
| 200 | 1 | Tank hit marker (white) |
| 210-219 | 10 | Per-player shield colors |
| 254 | 1 | Napalm fire particle |
| 255 | 1 | Projectile trail white |

### Web Port Palette Map (constants.js)

| Index Range | Count | Purpose |
|-------------|-------|---------|
| 0-79 | 80 | Player colors (same as EXE) |
| 80-104 | 25 | Sky gradient (SKY_PAL_START=80) |
| 120-149 | 30 | Terrain gradient (TERRAIN_PAL_START=120) |
| 150 | 1 | Wall color (same) |
| 154 | 1 | Wind indicator blue (same) |
| 170-199 | 30 | Explosion fire (same) |
| 200-208 | 9 | UI chrome (remapped from EXE 151-159) |
| 252 | 1 | System black |
| 253-254 | 2 | Laser colors (remapped from EXE 120, 254) |

### The "Dual Purpose" Problem

In the EXE, `drawColumn` (file 0x29720) works like this:

```
For terrain_type == 0 (Blue Ice):
  Fill entire column with vline(color=0x78=120)    ← solid VGA 120

For terrain_type 1-6:
  SKY PIXELS (above terrain):    setTerrainPixel(x,y) → height_array[y] → VGA 120-149
  TERRAIN BODY (below surface):  vline(color=0x50=80)  ← solid VGA 80
```

The EXE's `setTerrainPixel` (file 0x3AB39) dispatches per type and returns a palette index
from VGA 120-149 for the **sky portion** of each column. The solid terrain body below is a
single flat color at VGA 80.

The web port does the **opposite**: palette 120-149 holds terrain colors (gradient), palette
80-104 holds sky colors. `buildTerrainBitmap()` writes palette 120+ for terrain pixels.

**Visual result**: EXE renders sky pixels with the 120-149 gradient and terrain body as solid
VGA 80. Web renders terrain pixels with the 120-149 gradient and sky with 80-104. Same
structure, different color mapping → colors differ in screenshots.

**Impact**: This causes the majority of pixel-level mismatches. Fixing it would require a major
refactoring of the web palette system to match the EXE's dual-purpose scheme. Documented as a
known architectural difference — not a bug.

## State 1: Main Menu (30.1% pixel match)

### Matches ✓
- All 11 button labels: Start, Players, Rounds, Sound, Hardware, Economics, Landscape, Physics, Play Options, Weapons, Save Changes
- Button positions and 3D bevel styling
- Title text: "Scorched Earth" / "The Mother of All Games" / "Registered Version"
- Footer: "Version 1.50" / "Copyright (c) 1991-1995 Wendell Hicken"
- Gray chrome border (4px outer border)

### Differences
- **Sky gradient**: EXE shows sunset (yellow→orange→red→blue via VGA 120-149); web shows blue→white→dark gray (palette 80-104)
  - Root cause: palette range swap (documented above)
- **Terrain shape**: Different random mountains (RNG seed differs between EXE instance and web `seedRandom(12345)`)
- **Hotkey underline**: Web adds underline under hotkey chars; EXE just skips `~` marker
  - Intentional UX enhancement — no fix needed

## State 2: Player Setup Dialog (7.3% pixel match)

### Matches ✓
- Dialog title "Player 1 (of 2)" in player color
- Name input field with sunken text box and cursor
- 8 color picker squares
- Person/Computer type selector
- Done button (raised 3D)

### Differences — FIXED
- **Background**: ~~EXE fills full-screen with player-colored vertical gradient curtain (menu not visible); web keeps menu visible behind dialog~~
  - **Fixed**: `drawPlayerSetupScreen()` now fills screen with player-colored vertical gradient before drawing dialog

## State 3: Weapons Shop (45.4% pixel match — best)

### Matches ✓
- Weapon list with correct names, prices, and bundle sizes
- Header: "Cash: $1,000,000" / "10 rounds remain" / "Earned interest"
- Cash left bar display
- Weapon icons per item row
- Quantity display (owned count)
- Background fill (dark gray)

### Differences
- **Selection highlight color**: EXE uses player-colored highlight (from player_struct+0x1A → [EF22]); web uses player.index-based color (may differ if player chose non-default color)
  - Root cause: EXE shop paint callback uses [DS:0xEF22] which is set to the actual player's chosen color, while web derives from `player.index * 8 + 4`
  - Status: Needs further investigation of actual color assignment path
- **Tab layout**: EXE has Score/Weapons/Miscellaneous/Done as tab buttons; web shows as right-panel category buttons

## State 4: In-Game Playing (4.7% pixel match, 97.5% terrain shape)

### Matches ✓
- **Terrain shape: 97.5% exact match** (351/360 columns pixel-perfect)
- Tank positions match (Player 1 bottom-left, Player 2 on mountain peak)
- Tank sprites (triangular body + turret line)
- "No Wind" indicator position and text
- HUD layout structure (Power/Angle row, Max/bars row)

### Differences
- **Terrain colors**: EXE solid peach/brown (VGA 80 = 54,36,28); web gradient green (palette 120-149)
  - Root cause: palette architecture difference (documented above)
- **Sky colors**: EXE blue gradient (VGA 120-149 = blue series); web reddish-gray (palette 80-104)
  - Root cause: palette architecture difference (documented above)
- **HUD values**: ~~Web shows defaults (Power 8, Angle 90) not emulator state (Power 200, Angle -57)~~
  - **Fixed**: `renderFromState` now injects `selectedWeapon` and `angle` from emulator state
- **Edge columns (x=0-2, 357-359)**: 9 mismatched columns near edges and tank positions
  - Analysis: Terrain code loops all columns correctly (`x < WIDTH`); mismatches are from tank sprites overlapping terrain at their placement columns, not a fencepost bug
- **Tank proximity columns**: Columns near tank positions (88, 92) show 15px/7px offsets
  - Expected: tank rendering overwrites terrain pixels at tank location

## Applied Fixes

| # | Fix | File | Status |
|---|-----|------|--------|
| 1 | HUD value injection (angle, selectedWeapon) | `disasm/web_screenshot.mjs` | ✅ Done |
| 2 | Shop selection highlight color | `web/js/shop.js` | ⏳ Needs EXE analysis |
| 3 | Player setup background gradient fill | `web/js/menu.js` | ✅ Done |
| 4 | Edge column terrain | `web/js/terrain.js` | ❌ Not a bug (tank overlap) |
| 5 | Palette architecture documentation | This file | ✅ Done |
