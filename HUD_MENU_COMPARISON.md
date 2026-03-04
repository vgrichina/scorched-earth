# HUD / Menu / Shop — EXE vs Web Pixel Comparison

Detailed audit of all rendering differences between SCORCH.EXE v1.50 and the web port.
Each item lists what the EXE does (from disasm), what the web does, and severity.

---

## 1. HUD — Full Mode Row 1

### ~~1a. Weapon Position~~ — **FIXED**
- **EXE**: Weapon text **left-aligned** at computed position `E9E0 = E9DE + 15`, where E9DE = wind_x + measureText("MMMMMMMMMMMMMMM") + 2. The weapon sits at a fixed column after the wind area.
- **Web**: ~~Weapon text **right-aligned** to `screenWidth - LEFT` (flush right edge).~~ Now: `wpnX = windX + measureText("MMMMMMMMMMMMMMM") + 2 + 15` matching EXE formula exactly.
- **Impact**: ~~Weapon name jumps to a completely different location. On a 640px screen the difference is ~200px.~~ Resolved.

### ~~1b. Wind Display String~~ — **RESOLVED**
- **EXE**: struct+0xB6 is a **far pointer to the player name** (NOT wind). `text_display(E9DC, HUD_Y, struct+0xB6)` draws the **player name** at position E9DC in palette 163 (player color). The wind display is a **separate playfield indicator** at file 0x28F1D (not part of HUD).
- **Web**: Now correctly shows player.name at E9DC position in player color (fixed in session 10).
- **Impact**: Resolved — player name display is correct. Playfield wind indicator is a separate gap (see section 11).

### 1c. Angle Label Spacing ~~(MINOR)~~ **FIXED**
- **EXE**: `sprintf("%s:", "Angle")` at DS:0x57BA → draws "Angle:". E9DA = E9D8 + measureText("Angle") + 8 (advance uses bare "Angle" width, not "Angle:").
- **Web**: Now draws "Angle:" with `x += measureText('Angle') + 8` — matches EXE exactly.

---

## 2. HUD — Full Mode Row 2

### 2a. Widget System ~~(SIMPLIFIED — largest gap)~~ **PARTIALLY FIXED**
- **EXE**: 7 distinct inventory widgets with icons (via icons.cpp), using exact positions from `compute_hud_layout_full`:
  | Position | Content | Format | Source |
  |----------|---------|--------|--------|
  | E9EA=barX | fuel% text | `%4ld` | W1 (0x318D8) |
  | E9EC | battery count | `%2d` DS:647D | W2 (0x3DE9B) |
  | E9EE | battery indicator (icon) | 25px | W2 icons.cpp |
  | E9F0 | parachute count | `%2d` DS:57D0 | inline |
  | E9F2 | parachute indicator (icon) | 25px | W3 (0x3DE5E) |
  | E9F4 | item count | `%d` | W4 (0x3DB30) |
  | E9F6 | item bar | 20px | W4 |
  | E9F8 | item% text | `%d%%` | W4 |
  | E9FA | shield count | `%d` DS:6476 | W5 (0x3DC94) |
  | E9FC | shield bar | 20px | W5 |
  | E9FE | [D566] item | `%2d` DS:57D4 | inline |

- **Web**: X-positions now match EXE layout. All items always shown (dimColor if zero). Icons replaced with fill-bars. No tank icon or animation. Fuel display fixed to 0-1000 per-mille (×10). Battery count now reads inventory[43] correctly.
- **Remaining gap**: No actual icons (battery icon, parachute icon). Item%/bar fill formulas are approximations. Widgets 6-7 not implemented.
- **Icon data extracted** (via `disasm/icon_dump.py`): 48 icons at DS:0x3826, stride 125B. Icons are tiny (1-5px wide, 5-11px tall) HUD widget indicators. Notable shapes: icons 25-27 = oval/capsule (parachute?), icon 40 = right-arrow indicator. Icons with width=0 (entries 5,6,16,19-24,31,36,41-44) appear to be null/empty slots or handled via pattern_type. Implementing them would require pixel-by-pixel drawing at each widget position.

### 2b. Energy Bar Width ~~(MINOR)~~ **RESOLVED**
- **EXE**: Widget 1 (fuel) draws text-only at E9EA — no separate fuel bar in Row 2 HUD. The 0x30=48 value appears in widget descriptor structs, not as a visible bar width.
- **Web**: Removed the fuel bar; now shows fuel% text only, matching EXE layout.

---

## 3. HUD — Basic Mode (320x200)

### ~~3a. Player Icons (SIMPLIFIED)~~ — **MOSTLY FIXED**
- **EXE**: Icon bitmap data at DS:0x3826, stride 125 bytes, 48 icons. Each icon has `pattern_type(1B), width(1B), height(1B), pixel_data(122B)`. Column-major pixel format. Rendered via `draw_icon_alive` (0x261D7, flag=1, filled in player color), `draw_icon_dead` (0x26245, flag=0, outline in palette 0xA9=169). Icon index from sub struct +0x16; draw_hud always calls draw_icon_alive. Dead player color = dimmed.
- **Web**: Now renders icon 0 (4×7px) as actual bitmap (column-major). Alive = player color, dead = UI_DARK_TEXT. Active player indicator dot at y=HUD_Y+ICON_H+2.
- **Remaining**: Exact EXE icon index (sub struct +0x16) not traced — using icon 0 as default. EXE may use different icon per player type.

### 3b. Row 2 Wind Text (INTENTIONAL ADDITION)
- **EXE**: Basic mode Row 2 does NOT display wind. Only shows: name + energy bar + "Angle:" + angle bar.
- **Web**: Adds "W:N" text after the angle bar when space permits. Code comment: "not in EXE basic mode, added for gameplay usability."
- **Impact**: Extra element not in original. Acceptable deviation for playability.

---

## 4. Menu — Main Config Screen

### ~~4a. Button X Margin~~ — **FIXED**
- **EXE** (from decoded menu init at 0x3D140):
  - Small mode (≤200px): start_x = 5, start_y = 5
  - Large mode (>200px): start_x = 12, start_y = 15
  - Also sets DS:0xECD4 = 4/5, DS:0xECD6 = 0/4 (button text padding)
- **Web**: ~~`BTN_X = 4` (fixed)~~ Now: `getBtnX() = isSmallMode() ? 5 : 12`. Y was already correct.
- **Impact**: Resolved — buttons now at correct X margin per mode.

### ~~4b. Button Width~~ — **FIXED**
- **EXE**: add_item_list parameter 0x50 = 80px button width.
- **Web**: ~~`BTN_W = LEFT_W - 8 = 120px`~~ Now: `BTN_W = 80`, matching EXE exactly.
- **Impact**: Resolved — buttons are 40px narrower, matching EXE width.

### ~~4c. Left Panel Width~~ — **FIXED** (re-fixed session 106)
- **EXE**: `terrain_frame_x = 2*getBtnX() + BTN_W - 1` (89 small / 103 large). See section 42.
- **Web**: ~~`LEFT_W = 128px` (hardcoded)~~ → intermediate fix used `getBtnX() + BTN_W + 4` (90 small / 97 large, both wrong) → now: `getLeftW() = 2*getBtnX() + BTN_W - 2`, `getRightX() = 89/103`.
- **Impact**: Resolved — terrain frame left X matches EXE exactly in both modes.

### ~~4d. 3D Box Borders in Hi-Res~~ — **FIXED**
- **EXE**: `draw_3d_box` uses **3-pixel borders** when `[DS:0x6E28]==3` (hi-res mode, e.g., 640x480+).
- **Web**: `drawBox3DRaised/Sunken` uses `config.screenHeight >= 400 ? 3 : 2` — matches EXE exactly.
- **Impact**: Resolved.

### ~~4e. Terrain Preview Frame Height~~ — **FIXED**
- **EXE**: Height = `screen_height - 37`, reduced to `screen_height - 51` if copyright text width exceeds the available right panel width.
- **Web**: ~~`getFrameH() = getScreenH() - 37 - 6`~~ Now: `getScreenH() - 37`, matching EXE normal case. Copyright overflow reduction not implemented (minor edge case).
- **Impact**: Frame is now 6px taller, matching EXE.

### ~~4f. Embossed Title Position~~ — **FIXED**
- **EXE**: Title rendered with 5-layer emboss. Position computed based on right panel dimensions, accounting for 4px emboss shift.
- **Web**: ~~`titleX = centerXRight(titleStr) - 2`~~ Now: `centerXRight(titleStr) - Math.floor((embossLayers - 1) / 2)` where `embossLayers = 5`. Offset derived from layer count, not hardcoded.
- **Impact**: Resolved.

---

## 5. Menu — Submenu Dialogs

### ~~5a. Dialog Dimensions~~ — **FIXED**
- **EXE**: Dialog system creates properly-sized dialogs with the widget engine at seg 0x3F19.
- **Web**: ~~`dlgW = 220` (hardcoded)~~ Now: `computeSubmenuWidth(sub)` measures title, footer, and all label+value pairs to auto-size dialog width. Height = `30 + itemCount * rowH`.
- **Impact**: Resolved — dialogs now auto-size to fit their content.

### ~~5b. Dialog Item Spacing~~ — **FIXED**
- **EXE**: Item spacing varies by resolution (adds 5px extra at screenH ≥ 400px, per shop analysis).
- **Web**: ~~Fixed 14px item spacing~~ Now: `getSubRowH()` returns 19px at ≥400px, 14px otherwise. Applied in both rendering and mouse hit-testing.
- **Impact**: Resolved — submenu dialogs now use correct spacing at all resolutions.

---

## 6. Shop Screen

### ~~6a. Layout Architecture~~ — **MOSTLY FIXED**
- **EXE**: Full dialog system modal. Created via `dialog_alloc(screenW, screenH, 0, 0)`. Has:
  - 3D beveled boxes for all UI elements
  - Scrollbar widget for item list
  - Tab buttons at bottom ("Score", "Weapons", "Miscellaneous", "~Done")
  - "Miscellaneous" expands to sub-categories: Parachutes, Triggers, Guidance, Shields, Inventory
  - Sell sub-dialog: "Sell Equipment" title, "Quantity to sell:", "Accept"/"Reject"
  - Left item panel: 200px wide (0xC8), 14-15 visible rows
  - Resolution-dependent spacing (+5px at ≥400px height)
  - Paint callback at 0x0DBC:0x124D for player-colored highlights
  - Tick callback at 0x0DBC:0x18F2 for animation
  - Palette animation: accent colors cycle palette indices 8-11 every 8 frames
  - Mouse click: item rows select/buy on single/double click; tabs switch; Done exits

- **Web**: ~~Flat black background. 4 text categories at top. No sell dialog. No animation.~~ 3D raised outer frame + sunken item panel. 3 tabs + ~Done. Score tab. **Now**: Sell sub-dialog with "Sell Equipment" title, Description/Amount/Quantity/Offer fields, Accept/Reject buttons. Palette animation: cycles accent colors (bright red, orange, magenta, dark red, deep pink) through palette entries 8-11 every 8 frames, restored on shop close. Mouse: click item to select, click selected to buy; click tabs to switch; click Done to exit.
- **Remaining gap**: ~~Miscellaneous sub-categories not implemented~~ **DONE** (shop.js MISC_GROUPS with 5 headers: Parachutes, Triggers, Guidance, Shields, Inventory). ~~No real scrollbar widget~~ **DONE** (shop.js full 3D scrollbar with track, thumb, arrows, drag).

### ~~6b. Selection Highlight Color~~ — **FIXED**
- **EXE**: Selection highlight = player_color + 4 (lighter shade).
- **Web**: ~~`PLAYER_PALETTE_STRIDE + 1` (slot 1 = darkest)~~ Now: slot 3 = 80% brightness (visible player-colored highlight).
- **Impact**: Resolved — highlight bar now clearly shows player color.

### ~~6c. Tab Structure~~ — **FIXED**
- **EXE**: 3 main tabs: "Score" (view scores), "Weapons" (buy projectiles), "Miscellaneous" (all non-weapon items grouped by sub-category), plus "~Done" button.
- **Web**: ~~4 flat categories: "Weapons", "Guidance", "Defense", "Accessories".~~ Now: Score | Weapons | Miscellaneous | ~Done matching EXE. Score tab shows ranked player table.
- **Impact**: Resolved — tab structure and Score tab now match EXE.

### ~~6d. Cash Label + Interest~~ — **FIXED**
- **EXE**: "Cash Left:" (DS:0x22F8 at file 0x58B5D), plus "Earned interest" (DS:0x235C) shown between rounds.
- **Web**: ~~"Cash: $N"~~ Now: "Cash Left: $N" + "Earned interest: $N" (when > 0). `applyInterest()` now saves `player.earnedInterest` for display.
- **Impact**: Resolved — label and interest display now match EXE.

### ~~6e. Privacy Guard~~ — **FIXED**
- **EXE**: "NO KIBITZING!!" screen (DS:0x231C) displayed between players in hotseat mode to prevent peeking at opponent's inventory.
- **Web**: ~~Missing.~~ Now: full black screen showing "NO KIBITZING!!" + player name, waits for any key before opening shop. Triggered for all non-first human players.
- **Impact**: Resolved — hotseat mode now hides previous player's shop between turns.

### ~~6f. Item Count~~ — **FIXED**
- **EXE**: 14-15 visible rows, +5px row height at screenH ≥ 400px.
- **Web**: ~~Fixed 10 rows.~~ Now: `getItemsPerPage()` derives from panel height / rowH, capped at 15. `getRowH()` returns 18px at ≥400px height, 13px otherwise.
- **Impact**: Resolved — item count and row spacing now scale with resolution.

---

## 7. Font System

### ~~7a. Extended Character Set~~ — **DONE**
- **EXE**: 161 glyphs — ASCII 0x20-0x7E (95 printable) + CP437 extended 0x80-0xFF (66 accented Latin, Greek, math symbols).
- **Web**: Now has all 161 glyphs — WIDTHS_EXT/GLYPHS_EXT arrays added to font.js covering chars 0x80-0xFD. charWidth(), drawChar(), and measureText() handle full range.
- **Impact**: Resolved.

### ~~7b. Quote Character (ZERO WIDTH)~~ — **FIXED**
- **EXE**: `"` (0x22) has a real glyph: font_init at 0x4C290 maps it to DS:0x7116 (width_byte=1, vertical-bar pattern). Exact visual unverified without execution.
- **Web**: ~~WIDTHS array has `0` for index 2 (char 34 = `"`), making it invisible.~~ Now: WIDTHS[2]=3, glyph = two-tick design (rows 2-4: 0xA0=X.X). Close approximation since EXE glyph may actually be width=1.
- **Impact**: Resolved — double quotes now render.

---

## 8. Palette / Colors

### ~~8a. UI Palette RGB Values~~ — **FIXED**
Extracted from `fg_setrgb` calls at file 0x2A640–0x2A770 (icons.cpp HUD init):
| Web Palette | DS Var→EXE idx | EXE RGB (6-bit) | Old Web RGB | Updated |
|-------------|----------------|-----------------|-------------|---------|
| 200 UI_HIGHLIGHT | EF22 (dynamic) | player color | (63,63,63) | kept white (static sub) |
| 201 UI_DARK_TEXT | EF24→153 | **(30,30,30)** | (20,20,20) | ✓ fixed |
| 202 UI_DARK_BORDER | EF26→155 | **(63,63,63) WHITE** | (32,32,32) | ✓ fixed — outer raised highlight! |
| 203 UI_BACKGROUND | EF28→151 | **(45,45,45)** | (48,48,48) | ✓ fixed |
| 204 UI_LIGHT_ACCENT | EF2A→151 | **(45,45,45)** | (52,52,52) | ✓ fixed |
| 205 UI_DEEP_SHADOW | EF2C→152 | **(0,0,0) BLACK** | (8,8,8) | ✓ fixed |
| 206 UI_LIGHT_BORDER | EF2E→159 | **(55,55,55)** | (63,63,63) | ✓ fixed |
| 207 UI_MED_BORDER | EF30→158 | **(5,5,5) near-black** | (24,24,24) | ✓ fixed |
| 208 UI_BRIGHT_BORDER | EF32→156 | **(15,15,15)** | (40,40,40) | ✓ fixed |

**Key insight**: EF26 (UI_DARK_BORDER) = WHITE (63,63,63) — it's the **outer top-left highlight** of raised boxes, not a dark color. The naming is misleading; it means "dark side" in sunken-box context (bottom edge), not "dark color".

**Also fixed**: Wall palette (150) updated from (40,40,40) to (50,50,50) per `fg_setrgb(150, 50,50,50)` at file 0x2A73B.

**Known issue**: The web maps DS:0xEF22-0xEF32 to palette 200-208, but in the EXE these are **not palette indices** — they're variables holding the active drawing color. The EXE uses `fg_setcolor(color_variable)` then draws. The web treats them as fixed palette slots. This works functionally but means the web can't replicate the EXE's dynamic color switching (e.g., the HUD dynamically sets palette 163 to the player's RGB).

### 8b. HUD Player Color (WORKAROUND)
- **EXE**: Sets palette 163 (0xA3) to current player's RGB via `fg_setrgb(0xA3, R, G, B)` at file 0x3030E. All HUD text then draws in palette 163.
- **Web**: Uses `baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL` (palette slot 4 of the player's 8-slot block, e.g., palette 4 for player 0, palette 12 for player 1).
- **Impact**: Functionally equivalent — both resolve to the same RGB. The web approach is correct since player slot 4 = full base color = same RGB that the EXE writes to palette 163.

---

## 9. 3D Box Drawing

### ~~9b. Raised Box Bevel Order~~ — **FIXED**
- **EXE draw_3d_box** (0x444BB): outer TL=EF26(WHITE,63,63,63), inner TL=EF2E(55,55,55), inner BR=EF30(5,5,5), outer BR=EF32(15,15,15).
- **Web**: ~~`boxRaised()` passed `UI_LIGHT_BORDER, UI_BRIGHT_BORDER, UI_MED_BORDER, UI_DARK_BORDER)` — happened to look correct by accident before palette fix (UI_LIGHT_BORDER was incorrectly set to white).~~ After palette fix, outer TL was (55,55,55) and outer BR was white (inverted). Now passes `(UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER)` matching EXE exactly.
- **Impact**: Resolved — raised boxes now have correct white outer highlight on top-left and dark shadow on bottom-right.

### ~~9a. Sunken Box Bevel Order~~ — **FIXED**
- **EXE draw_flat_box** (0x44630): Top=DS:0xEF30(MED), Left=DS:0xEF32(BRIGHT), Bottom=DS:0xEF26(DARK), Right=DS:0xEF2E(LIGHT).
- **Web**: ~~`boxSunken()` passed `(UI_DARK_BORDER, UI_MED_BORDER, UI_LIGHT_BORDER, UI_BRIGHT_BORDER)` yielding Top=DARK, Left=MED — wrong.~~ Now passes `(UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER)` matching EXE edge assignment exactly.
- **Impact**: Resolved — sunken box bevels now use correct color per edge.

---

## Priority Summary (Completed)

| Priority | Issue | Effort |
|----------|-------|--------|
| ~~**HIGH**~~ | ~~Shop fundamentally different (6a)~~ | **MOSTLY FIXED** — sell dialog, palette anim, mouse clicks added |
| ~~**HIGH**~~ | ~~Sunken box bevel order (9a)~~ | **FIXED** |
| ~~**HIGH**~~ | ~~Full Row 2 widgets missing (2a)~~ | **PARTIALLY FIXED** (positions correct; icons still bars) |
| ~~**HIGH**~~ | ~~UI palette RGB wrong (8a)~~ | **FIXED** (extracted from fg_setrgb calls) |
| ~~**MEDIUM**~~ | ~~Weapon position in full Row 1 (1a)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Menu button X margin (4a)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Button width (4b)~~ | **FIXED** (BTN_W=80) |
| ~~**MEDIUM**~~ | ~~Left panel width (4c)~~ | **FIXED** (2×getBtnX+BTN_W-1, see §42) |
| ~~**MEDIUM**~~ | ~~3px borders in hi-res (4d)~~ | **FIXED** (was already in code) |
| ~~**MEDIUM**~~ | ~~Frame height (4e)~~ | **FIXED** (SH-37, removed extra -6) |
| ~~**MEDIUM**~~ | ~~Dialog spacing (5b)~~ | **FIXED** (19px at ≥400px) |
| ~~**MEDIUM**~~ | ~~Player icons simplified (3a)~~ | **MOSTLY FIXED** — bitmap icon 0 used |
| ~~**MEDIUM**~~ | ~~Shop highlight color (6b)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Quote char zero-width (7b)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Angle label colon (1c)~~ | **FIXED** |
| ~~**LOW**~~ | ~~Energy bar in Row 2 (2b)~~ | **RESOLVED** (no bar, text only matches EXE) |
| ~~**LOW**~~ | ~~Privacy guard (6e)~~ | **FIXED** |
| ~~n/a~~ | ~~Shop cash label (6d)~~ | **FIXED** ("Cash Left:") |
| ~~n/a~~ | ~~Shop items per page (6f)~~ | **FIXED** (dynamic, up to 15) |
| ~~**LOW**~~ | ~~Shop sell dialog (6a partial)~~ | **FIXED** — "Sell Equipment" sub-dialog with quantity/offer/Accept/Reject |
| ~~**HIGH**~~ | ~~Raised box bevel order (9b)~~ | **FIXED** (caused by palette fix, now correct) |
| ~~**LOW**~~ | ~~Spinner text right-align bug~~ | **FIXED** (bx+BTN_W instead of BTN_W) |
| **INFO** | Row 2 wind text added (3b) | Intentional divergence |
| **INFO** | HUD clear area smaller (noted in code) | Intentional divergence |

---

## 10. Previously Remaining Fix Tasks (ALL DONE)

All items from the first fidelity audit have been completed across sessions 55-68.

| Task | Status |
|------|--------|
| ~~Hotkey `~` underline rendering~~ | **DONE** (font.js drawText) |
| ~~Submenu dialog width auto-sizing~~ | **DONE** (menu.js computeSubmenuWidth) |
| ~~Shop misc sub-category headers~~ | **DONE** (shop.js MISC_GROUPS) |
| ~~Shop tab buttons as 3D boxes~~ | **DONE** (shop.js drawBox3DRaised/Sunken) |
| ~~Embossed title X from emboss width~~ | **DONE** (menu.js embossLayers) |
| ~~Wind display string format~~ | **RESOLVED** — struct+0xB6 = player NAME, not wind |
| ~~Extended font chars CP437~~ | **DONE** (font.js WIDTHS_EXT/GLYPHS_EXT, 161 chars) |
| ~~Shop scrollbar widget~~ | **DONE** (shop.js full 3D scrollbar) |
| ~~Player setup screen layout~~ | **DONE** (menu.js centered dialog, Tab key, sunken fields) |
| ~~Remove `< >` arrow display on spinners~~ | **DONE** (menu.js, value only) |

---

## 11. Discrepancies from re-audit session 69 (ALL DONE)

All items from the re-audit have been completed across sessions 70-74.

| Task | Status |
|------|--------|
| ~~Submenu `~` hotkey markers~~ | **DONE** (menu.js — all 40+ labels, session 70) |
| ~~Playfield wind indicator~~ | **DONE** (hud.js drawWindIndicator, session 10/72) |
| ~~Physics: Borders Extend + Suspend Dirt~~ | **DONE** (config.js + menu.js, session 73) |
| ~~Cash at Start max too low~~ | **DONE** (menu.js max→10M step→50k, session 74) |

---

## 12. Discrepancies from re-audit session 76 (ALL DONE)

All items found and fixed in session 76.

| Task | Status |
|------|--------|
| ~~Max Wind slider range (max=20→500, step=1→5)~~ | **DONE** (menu.js, EXE DS:0x515C default=200) |
| ~~land1/land2/randomLand missing from PERSIST_KEYS~~ | **DONE** (config.js) |
| ~~Scoring Mode hotkey (`Scoring ~M`→`~S`)~~ | **DONE** (menu.js, EXE DS:0x295B) |
| ~~Percent Scanned Mountains label abbreviated~~ | **DONE** (menu.js, EXE DS:0x6383) |
| ~~Wrap→Wrap-around wall type name~~ | **DONE** (menu.js, EXE DS:0x278E) |
| ~~Extra colons on Economics toggles~~ | **DONE** (menu.js, EXE DS:0x293F/0x294E) |

---

## 13. Discrepancies from re-audit session 77 (ALL DONE)

All items found and fixed in session 77.

| Task | Status |
|------|--------|
| ~~Hardware submenu labels missing `~` hotkey markers~~ | **DONE** (menu.js — `Graphics Mode:`→`~Graphics Mode:`, `Mouse Enabled`→`~Mouse Enabled`, `Small Memory`→`~Small Memory`; EXE DS:0x28C3/0x28E2/0x28F0) |
| ~~Hardware submenu "BIOS" case mismatch~~ | **DONE** (menu.js — `BIOS Keyboard`→`~Bios Keyboard`; EXE DS:0x28D3 = "~Bios Keyboard") |
| ~~Hardware submenu missing 5 EXE items~~ | **DONE** (menu.js — added ~Firing Delay:, ~Hardware Delay:, Falling ~Delay:, ~Calibrate Joystick, ~Fast Computers as disabled N/A; EXE DS:0x28FF/0x290E/etc.) |
| Land ~Type: in Landscape submenu | **INFO** — intentional web addition. EXE has no "Land Type" labeled menu item; LAND_TYPE is config-file-only in EXE. Web adds it for usability. |

---

## 14. Discrepancies from re-audit session 78 (ALL DONE)

All items found and fixed in session 78.

| Task | Status |
|------|--------|
| ~~Talk bubble fill color wrong (palette 199 → UI_DARK_BORDER white)~~ | **DONE** (talk.js — EXE draw_border 0x1826C fills interior with EF26=white; web used palette 199 bright yellow) |
| ~~Talk bubble border rendering~~ | **DONE** (talk.js — EXE draws 4 edge lines in EF2C=black + white fill via draw_border; web had two overlapping fillRects) |
| ~~Talk bubble text color wrong (palette 0 → UI_DEEP_SHADOW)~~ | **DONE** (talk.js — EXE sets fg_setcolor(EF2C) before text_display; web now uses UI_DEEP_SHADOW) |
| ~~Talk bubble Y position 7px too high~~ | **DONE** (talk.js — EXE text at tank.Y-19, box from Y-1 to Y+12; web had `by=bubble.y-8, text=by+1` placing text at Y-26; now text at bubble.y directly) |
| ~~Talk bubble height too short (11px → 14px)~~ | **DONE** (talk.js — EXE box 14px tall for 12px font; web had 11px cutting off glyphs; now uses FONT_HEIGHT for correct sizing) |
| ~~Talk bubble X clamp hardcoded 320px~~ | **DONE** (talk.js — was `Math.min(318 - textWidth - 4, ...)`, now uses `config.screenWidth - 11 - textWidth`) |
| ~~Talk bubble text truncation removed~~ | **DONE** (talk.js — EXE doesn't truncate, just clamps X; web had 35-char maxChars truncation) |
| ~~Talk bubble X padding (2px → 3px left)~~ | **DONE** (talk.js — EXE has text at si, box at si-3 = 3px left padding; web had 2px; now matches EXE) |
| ~~RE doc stale pseudocode at line 5385~~ | **DONE** (REVERSE_ENGINEERING.md — corrected "weapon_name" → "player_name" at E9DC and "wind display" → "fg_setrgb palette 163" matching HUD_MENU_COMPARISON section 1b resolution) |

---

## 15. Discrepancies from re-audit session 79 (ALL DONE)

All items found and fixed in session 79.

| Task | Status |
|------|--------|
| ~~Shop scrollbar raised box bevel order swapped~~ | **DONE** (shop.js — scrollbar up arrow, down arrow, and thumb used `UI_LIGHT_BORDER, UI_DARK_BORDER` (swapped first two params) vs all other raised boxes which correctly use `UI_DARK_BORDER, UI_LIGHT_BORDER`. EXE draw_3d_box: outer TL=EF26=UI_DARK_BORDER(white), inner TL=EF2E=UI_LIGHT_BORDER. Fixed 3 calls at lines 890, 901, 923.) |

---

## 16. Discrepancies from re-audit session 80 (ALL DONE)

All items found and fixed in session 80.

| Task | Status |
|------|--------|
| ~~Round-over accepts only Space/click, not any key~~ | **DONE** (game.js — EXE uses `fg_getkey()` at file 0x2A9AE which waits for ANY key press, matching "<<Press any key>>" text at DS:0x5212. Web had `consumeKey('Space')`. Added `consumeAnyKey()` to input.js; ROUND_OVER now uses it.) |
| ~~Game-over accepts only Space/click, not any key~~ | **DONE** (game.js — same `fg_getkey()` pattern. GAME_OVER now uses `consumeAnyKey()`) |
| ~~Game-over title "GAME OVER"→"Final Scoring"~~ | **DONE** (main.js — EXE has "Final Scoring" at DS:0x2A9F, no "GAME OVER" string exists in EXE. Changed title and removed "Final Scores" subtitle.) |
| ~~Game-over "Press SPACE to restart"→"<<Press any key>>"~~ | **DONE** (main.js — EXE uses same "<<Press any key>>" string DS:0x5212 as round-over. Changed text to match.) |

---

## 17. Discrepancies from re-audit session 81 (ALL DONE)

All items found and fixed in session 81.

| Task | Status |
|------|--------|
| ~~SCREEN_HIDE "Press SPACE"→"<<Press any key>>"~~ | **DONE** (main.js + game.js — between-turn screen showed "Press SPACE" and only accepted Space/click. Changed text to "<<Press any key>>" matching EXE pattern DS:0x5212, and handler to `consumeAnyKey()` matching fg_getkey pattern used in ROUND_OVER/GAME_OVER.) |
| ~~System menu missing hotkey support~~ | **DONE** (game.js — EXE menu items have `~` hotkey markers: ~Clear Screen=C, ~Mass Kill=M, ~Quit Game=Q, ~New Game=N, etc. Added hotkey extraction from `~` marker in label and consumeKey('Key'+char) dispatch. Pressing the hotkey letter now selects and activates the item.) |
| ~~System menu missing confirmation dialogs~~ | **DONE** (game.js + main.js — EXE shows yes/no confirmation before destructive actions: "Mass kill everyone?" DS:0x2C06, "Do you want to quit?" DS:0x2BC9, "Do you really want to restart the game?" DS:0x2BDE. Added confirmation sub-dialog: Y=confirm, N/Escape=cancel. Renders as overlay in system menu box.) |

---

## 18. Discrepancies from re-audit session 82 (ALL DONE)

All items found and fixed in session 82.

| Task | Status |
|------|--------|
| ~~Main menu missing hotkey support~~ | **DONE** (menu.js `handleMainMenuInput()` — EXE dialog system supports `~` hotkey markers on all item lists: `~Start`=S, `~Players:`=P, `~Rounds:`=R, `S~ound...`=O, `~Hardware...`=H, `~Economics...`=E, `~Landscape...`=L, `Ph~ysics...`=Y, `Play Op~tions...`=T, `~Weapons...`=W, `Save ~Changes`=C. Pressing the hotkey letter selects the item; for buttons/submenus also activates. For spinners, just selects (user adjusts with arrows). Matching system menu hotkey implementation from session 81.) |
| ~~Submenu missing hotkey support~~ | **DONE** (menu.js `handleSubmenuInput()` — EXE dialog system applies same `~` hotkey mechanism to submenu items (e.g., Sound: `~Sound:`=S, `~Flight Sounds:`=F; Physics: `~Air Viscosity:`=A, `~Gravity:`=G, etc.). Pressing hotkey selects the item and increments value by one step (matching right-arrow behavior). Skips disabled items.) |

---

## 19. Discrepancies from re-audit session 83 (ALL DONE)

All items found and fixed in session 83.

| Task | Status |
|------|--------|
| ~~System menu row height not resolution-dependent~~ | **DONE** (main.js — EXE dialog system (seg 0x3F19) applies +5px item spacing when screenH >= 400, same as config submenus. System menu used hardcoded `rowH = 14`. Fixed to `config.screenHeight >= 400 ? 19 : 14`, matching menu.js `getSubRowH()` logic. Affects both dialog height and item positioning.) |

---

## 20. Discrepancies from re-audit session 84 (ALL DONE)

All items found and fixed in session 84.

| Task | Status |
|------|--------|
| ~~Shop score tab missing "Player Rankings" title~~ | **DONE** (shop.js — EXE score tab builder at file 0x34190 displays "Player Rankings" (DS:0x6042) as a centered title header via `add_item_list` (0x3F19:0x2577). Web had flat "Player"/"Score" column headers without title. Now shows "Player Rankings" centered in UI_HIGHLIGHT above separator line.) |
| ~~Shop score tab missing rank numbers "#1", "#2"~~ | **DONE** (shop.js — EXE score tab at file 0x342AB formats ranking prefix as "#%d" (DS:0x6052="#%d") before each player name. Score displayed via "%d" (DS:0x6056). Web had plain name+score. Now shows "#N" prefix per row.) |
| ~~Shop score tab row height wrong formula~~ | **DONE** (shop.js — EXE score tab at file 0x341F5 uses DS:0xEF3A (screen height) vs 0xDC (220): row spacing = 11 if < 220, 13 if >= 220. Web used `getRowH()` (13/18 at 400px threshold) which is for item lists, not score tab. Score tab now uses dedicated `scoreRowH = screenH >= 220 ? 13 : 11`.) |

---

## 21. Discrepancies from re-audit session 85 (ALL DONE)

All items found and fixed in session 85.

| Task | Status |
|------|--------|
| ~~Wind generation formula wrong~~ | **DONE** (game.js — EXE at file 0x2943A uses `random(max_wind/2) - max_wind/4`: `mov ax,[515c]; cwd; sub ax,dx; sar ax,1; push ax; call random` clearly divides max_wind by 2 before calling random. Range is [-max/4, +max/4), approximately centered. Web had `random(maxWind)` (range [-max/4, +3*max/4), positive-biased) due to an earlier erroneous RE doc correction that missed the `sar ax,1` instruction. Fixed to `random(Math.floor(maxWind/2))`. Also removed `clamp(wind, -maxWind*4, maxWind*4)` — EXE has no clamp on initial generation; natural range after quadrupling is ≈[-max, +max].) |

### Observations (resolved in session 85/86)

| Item | Notes |
|------|-------|
| ~~Round-over winner text format~~ | **RESOLVED** (session 85): Winner display at file 0x340E5 shows bare player name only (far ptr from sub_struct[+0xB6]/[+0xB8]) in player's color. No "wins!" suffix. Web port fixed: removed `' wins!'` from main.js:249. |

---

## 22. Discrepancies from re-audit session 86 (NONE FOUND)

Full systematic audit of all 9 web/js UI files (hud.js, menu.js, shop.js, font.js, talk.js, game.js, main.js, input.js, constants.js) against EXE behavior. **No new actionable discrepancies found.**

### Verified correct (all previous fixes from sessions 76-85)

| Component | Verification |
|-----------|-------------|
| HUD basic mode | Angle bar (angle/18), power bar (struct[0x9E]/100), player name, weapon name — all match EXE |
| HUD full mode | All bars, labels, wind indicator — all match EXE |
| Menu hotkeys | Main menu + submenu `~` hotkey dispatch — working correctly |
| Talk bubbles | Border colors (UI_DEEP_SHADOW/UI_DARK_BORDER), position, height, X clamp — all match session 78 fixes |
| System menu | Hotkeys, confirmation dialogs ("Mass kill everyone?", "Do you want to quit?", "Do you really want to restart the game?"), row height (14/19 at 400px threshold) — all correct |
| Round-over screen | "No Winner" / bare player name, format strings ("%d of %d rounds fought.", "1 round remains", "%s rounds remain"), any-key input — all correct |
| Game-over screen | "Final Scoring" title (DS:0x2A9F), "<<Press any key>>", any-key input — all correct |
| Shop score tab | "Player Rankings" title, "#N" rank prefix, row height (11/13 at 220px threshold) — all correct |
| Wind generation | `random(max_wind/2) - max_wind/4`, no clamp — matches EXE `sar ax,1` at 0x2943A |
| Winner display | Bare player name, no "wins!" suffix — matches EXE at 0x340E5 |

### Structural differences (accepted simplifications)

| Area | EXE | Web | Notes |
|------|-----|-----|-------|
| Round-over scoring | Full dialog widget system (dialog_alloc + add_item_list at seg 0x3F19) with scrollable item list | Flat text overlay with fixed layout | Functionally equivalent; dialog widget system not implemented in web port |
| "Scores:" label | Not present in EXE (score display is inside dialog item list) | Shows "Scores:" header above leaderboard | Web-only label for clarity; no EXE basis |
| "Team Rankings" | DS:0x6063 exists as alternate dialog title for team mode | Not implemented | Team mode not implemented in web port |
| Game-over "pts"/"W" | Score format "%d" (DS:0x6056), no suffix strings | `${p.score} pts` and `${p.wins}W` | Web-only suffixes for readability; part of dialog→flat-text simplification |

## 23. Session 87 — Full HUD/Menu/Shop fidelity re-audit (no new discrepancies)

**Scope**: All 9 web/js UI files (hud.js, menu.js, shop.js, font.js, talk.js, game.js, main.js, input.js, constants.js) + targeted EXE disassembly.

**EXE investigation**: Disassembled draw_hud_full Row 2 from 0x304A6 through 0x30530 (retf). Verified:
- Super Mag inline count: format "%2d" (DS:0x57D4), color toggle highlight (EF22) vs dim (EF24) based on inventory[D566] > 0. Web port: `String(magCount).padStart(2)` with baseColor/dimColor — matches.
- widget6_item2 call at 0x3050D (Super Mag icon). Web port: `drawIcon(x, ROW2_Y, WPN.SUPER_MAG, magColor)` — matches.
- widget7_conditional at 0x3051D (Heavy Shield energy). Web port: conditional on screen width, format padStart(3) — matches EXE "%3d" (DS:0x6479).
- Basic mode Row 2 layout at 0x300E0: widget config loop with stride 0x0C, Y positions HUD_Y+0x0C and HUD_Y+0x17.
- Game-over screen: confirmed no "pts", "wins", or "W" strings in EXE binary. Added to structural differences table.

| Check | Result |
|-------|--------|
| HUD full mode Row 1 | All format strings verified ("%s:", "%4d", "%2d", "%s", "%d: %s") |
| HUD full mode Row 2 | All 7 widgets verified including Super Mag "%2d" and Heavy Shield "%3d" |
| HUD basic mode | Row 1 power bars, Row 2 energy/angle bars — correct |
| Menu/submenu hotkeys | All `~` markers and dispatch — correct |
| Talk bubbles | Border colors, position, height — correct |
| System menu | Confirmation dialogs, hotkeys, row height — correct |
| Round-over | Winner display (bare name), format strings, any-key — correct |
| Game-over | "Final Scoring" title, any-key input — correct; `pts`/`W` suffixes are web-only (accepted) |
| Shop score tab | "Player Rankings", "#N" ranks, row height — correct |
| Wind generation | `random(max_wind/2) - max_wind/4`, no clamp — correct |
| Font rendering | Hotkey underlines, proportional width — correct |

## 24. Session 88 — Full HUD/Menu/Shop fidelity re-audit (no new discrepancies)

**Scope**: All 9 web/js UI files (hud.js, menu.js, shop.js, font.js, talk.js, game.js, main.js, input.js, constants.js) + targeted EXE investigation.

**EXE investigation**: Disassembled play loop dispatch at 0x2F78A to verify between-turn behavior. Confirmed no "NO KIBITZING!!" or privacy screen between Sequential gameplay turns — the EXE transitions directly to the next player. Web port's SCREEN_HIDE between gameplay turns is a web-only hotseat usability addition (shop kibitzing in shop.js is correct). Verified EXPLOSION_SCALE at DS:0x50DA = 1.0 (float64), matching default Medium (config file overrides to Large). Verified shop sell refund formula, scrollbar bevel order, tab rendering, and Done button layout.

| Check | Result |
|-------|--------|
| HUD full mode Row 1 | Player name, power, angle, weapon icon+text — correct |
| HUD full mode Row 2 | All 7 widgets, fuel ×10, battery/parachute/shield bars — correct |
| HUD basic mode | Multi-player bars, icon rendering, angle bars — correct |
| Menu main + submenu | Hotkeys, spinner values, dialog auto-sizing, row height — correct |
| Player setup screen | Centered dialog, Tab key, sunken fields, blinking cursor — correct |
| Talk bubbles | Border (EF2C), fill (EF26), text (EF2C), Y-19, 14px height — correct |
| System menu | F9 open, hotkeys, confirmation Y/N, row height 14/19 — correct |
| Round-over | Bare winner name, "No Winner", format strings, any-key — correct |
| Game-over | "Final Scoring", any-key, `pts`/`W` suffixes web-only (accepted) |
| Shop rendering | 3D frame, sunken panel, score tab, scrollbar, sell dialog — correct |
| Shop tabs | Score/Weapons/Miscellaneous (3D boxes) + ~Done button — correct |
| Wind indicator | "Wind: N"/"No Wind", right-aligned, directional arrow — correct |
| Font | 161 glyphs, `~` hotkey underlines, measureText skip — correct |
| Config defaults | All match EXE/SCORCH.CFG shipped defaults — correct |

### Intentional divergences (unchanged, accepted)

| Area | Notes |
|------|-------|
| SCREEN_HIDE between gameplay turns | Web-only hotseat usability feature; EXE has no between-turn privacy screen during Sequential mode |
| "Scores:" label on round-over | Web-only label for clarity; EXE uses dialog widget system |
| "pts"/"W" suffixes on game-over | Web-only for readability; EXE shows bare numbers via dialog |
| Basic mode Row 2 "W:N" wind text | Web-only for gameplay usability |
| Bomb icon: web uses Small mode only | EXE supports Small/Big/Invisible; web always draws 1 white pixel (cosmetic preference) |

---

## 25. Session 89 — Full HUD/Menu/Shop fidelity re-audit (4th consecutive clean audit)

**Scope**: All 9 web/js UI files (hud.js, menu.js, shop.js, font.js, talk.js, game.js, main.js, input.js, constants.js) + targeted EXE investigation.

**EXE investigation**: Disassembled basic mode HUD Row 2 widget config at 0x300E0 and draw_hud at 0x2FC84/0x2FD34. Confirmed Row 2 comparison bars use Y range [HUD_Y+0x0C, HUD_Y+0x17] = [17, 28], i.e. 11px tall — matching web port's BAR_H=11. The two Y positions are top/bottom of the same bar, not separate rows. Row 1 bar: [HUD_Y, HUD_Y+0x0B] = [5, 16], also 11px. Format strings at DS:0x5770 and DS:0x5774 are both "%s:" for Row 2 labels.

| Check | Result |
|-------|--------|
| HUD full mode Row 1 | Player name, power, angle, weapon icon+text — correct |
| HUD full mode Row 2 | All 7 widgets, fuel ×10, battery/parachute/shield bars — correct |
| HUD basic mode | Multi-player bars, icon rendering, angle bars — correct |
| HUD basic Row 2 bars | Y=[17,28], 11px tall, "%s:" labels — matches web BAR_H=11 |
| Menu main + submenu | Hotkeys, spinner values, dialog auto-sizing, row height — correct |
| Player setup screen | Centered dialog, Tab key, sunken fields, blinking cursor — correct |
| Talk bubbles | Border (EF2C), fill (EF26), text (EF2C), Y-19, 14px height — correct |
| System menu | F9 open, hotkeys, confirmation Y/N, row height 14/19 — correct |
| Round-over | Bare winner name, "No Winner", format strings, any-key — correct |
| Game-over | "Final Scoring", any-key, `pts`/`W` suffixes web-only (accepted) |
| Shop rendering | 3D frame, sunken panel, score tab, scrollbar, sell dialog — correct |
| Shop tabs | Score/Weapons/Miscellaneous (3D boxes) + ~Done button — correct |
| Wind indicator | "Wind: N"/"No Wind", right-aligned, directional arrow — correct |
| Font | 161 glyphs, `~` hotkey underlines, measureText skip — correct |
| Config defaults | All match EXE/SCORCH.CFG shipped defaults — correct |

### Intentional divergences (unchanged, accepted)

| Area | Notes |
|------|-------|
| SCREEN_HIDE between gameplay turns | Web-only hotseat usability feature; EXE has no between-turn privacy screen during Sequential mode |
| "Scores:" label on round-over | Web-only label for clarity; EXE uses dialog widget system |
| "pts"/"W" suffixes on game-over | Web-only for readability; EXE shows bare numbers via dialog |
| Basic mode Row 2 "W:N" wind text | Web-only for gameplay usability |
| Bomb icon: web uses Small mode only | EXE supports Small/Big/Invisible; web always draws 1 white pixel (cosmetic preference) |

---

## 26. Session 90 — Terrain preview frame height fix (1 discrepancy found and fixed)

**Scope**: All 9 web/js UI files + targeted EXE investigation of main menu terrain preview frame.

**EXE investigation**: Disassembled terrain preview frame call at file 0x3D593 → `draw_flat_box(leftPanelW, 6, FG_MAXX-6, FG_MAXY-36)`. Confirmed draw_flat_box at 0x44630 uses inclusive (minx, miny, maxx, maxy) coordinates via 4 border lines: left (EF30), top (EF32), right (EF26), bottom (EF2E). Identified DS:EF3A = FG_MAXY = screenH-1 (fg_getmaxy) and DS:EF3E = FG_MAXX = screenW-1 (fg_getmaxx) — confirmed by: full-screen draw_3d_box call at 0x3D55A passing (0, 0, EF3E, EF3A, EF28); copy to SHIELD_DRAW_X/Y_MAX at 0x2A834; and Fastgraph convention.

**Discrepancy**: `getFrameH()` in menu.js returned `screenH - 37`. This is the EXE's **inclusive maxy coordinate** (= (screenH-1) - 36), not the height. Web's `drawBox3DSunken(x, y, w, h)` draws from y to y+h-1, so bottom = 6 + (screenH-37) - 1 = screenH-32, which is **5 pixels too far down** vs EXE's screenH-37.

**Fix**: `getFrameH() = getScreenH() - 42` (= maxy - miny + 1 = (screenH-37) - 6 + 1). For 320×200: height=158, bottom=163 (matching EXE). Width confirmed correct: `getFrameW() = screenW - 6 - getRightX()` → maxx = screenW-7 ✓.

| Check | Result |
|-------|--------|
| **Terrain preview frame** | **FIXED**: getFrameH() screenH-37 → screenH-42 (5px too tall) |
| HUD full mode Row 1 | Player name, power, angle, weapon icon+text — correct |
| HUD full mode Row 2 | All 7 widgets, fuel ×10, battery/parachute/shield bars — correct |
| HUD basic mode | Multi-player bars, icon rendering, angle bars — correct |
| Menu main + submenu | Hotkeys, spinner values, dialog auto-sizing, row height — correct |
| Talk bubbles | Border (EF2C), fill (EF26), text (EF2C), Y-19, 14px height — correct |
| System menu | F9 open, hotkeys, confirmation Y/N, row height 14/19 — correct |
| Round-over | Bare winner name, "No Winner", format strings, any-key — correct |
| Game-over | "Final Scoring", any-key, `pts`/`W` suffixes web-only (accepted) |
| Shop rendering | 3D frame, sunken panel, score tab, scrollbar, sell dialog — correct |
| Wind indicator | "Wind: N"/"No Wind", right-aligned, directional arrow — correct |
| Font | 161 glyphs, `~` hotkey underlines, measureText skip — correct |
| Config defaults | All match EXE/SCORCH.CFG shipped defaults — correct |

### Intentional divergences (session 26, unchanged)

| Area | Notes |
|------|-------|
| SCREEN_HIDE between gameplay turns | Web-only hotseat usability feature; EXE has no between-turn privacy screen during Sequential mode |
| "Scores:" label on round-over | Web-only label for clarity; EXE uses dialog widget system |
| "pts"/"W" suffixes on game-over | Web-only for readability; EXE shows bare numbers via dialog |
| Basic mode Row 2 "W:N" wind text | Web-only for gameplay usability |
| Bomb icon: web uses Small mode only | EXE supports Small/Big/Invisible; web always draws 1 white pixel (cosmetic preference) |

---

## 27. Session 91 — Right panel text centering fix (1 discrepancy found and fixed)

**Scope**: All 9 web/js UI files (hud.js, menu.js, shop.js, font.js, talk.js, game.js, main.js, input.js, constants.js) + targeted EXE disassembly of title/subtitle/copyright centering.

**EXE investigation**: Disassembled title centering at 0x3D6CF-0x3D6EE and subtitle centering at 0x3D72B-0x3D738. Both use `FG_MAXX - bp_3A` (= `(screenW-1) - panelStart`) as the panel width for text centering. Confirmed `bp-0x3A` is computed at 0x3D538: `dialog.x + maxWidgetWidth + startX` = the right panel starting X coordinate (matching web's `getRightX()`). Copyright centering at 0x3D7B7 uses the same formula.

**Discrepancy**: `centerXRight()` in menu.js used `getScreenW() - 6` (the terrain frame right inset) instead of `getScreenW() - 1` (`FG_MAXX`). This made the effective centering panel 5px narrower than the EXE, shifting subtitle, registered version, and copyright text ~2px to the left. Note: the embossed title already used `getScreenW() - 1` (correct after session 91a fix), so only the other centered text was affected.

**Fix**: `centerXRight()` changed from `getScreenW() - 6` to `getScreenW() - 1`, matching EXE centering formula exactly.

| Check | Result |
|-------|--------|
| **centerXRight panel width** | **FIXED**: getScreenW()-6 → getScreenW()-1 (2px subtitle/copyright shift) |
| Embossed title centering | Correct — uses `2*textW + 4` and `getScreenW()-1` (session 91a fix) |
| Copyright Y/width/split | Correct — all match EXE (0x3D793, 0x3D7BD, DS:0x643C/0x6454) |
| Version format | Correct — "Version 1.50" (DS:0x31DD + DS:0x6469) |
| HUD full mode | All Row 1 + Row 2 rendering — correct |
| HUD basic mode | Multi-player bars, icons, angle bars — correct |
| Menu + submenu | Hotkeys, sizing, row height — correct |
| Talk bubbles | Border, fill, text, position — correct |
| System menu | Hotkeys, confirmations, row height — correct |
| Round/game over | Format strings, any-key input — correct |
| Shop | 3D frame, score tab, scrollbar, sell dialog — correct |
| Wind indicator | Text + arrow — correct |
| Font | 161 glyphs, underlines — correct |
| Input system | All handlers — correct |

---

## 28. Session 92 — Clean audit + submenu string table investigation (no discrepancies)

**Scope**: All 9 web/js UI files (hud.js, menu.js, shop.js, font.js, talk.js, game.js, main.js, input.js, constants.js) + targeted EXE investigation of submenu string tables and cash display function.

**EXE investigation**: Dumped all DS string tables for config submenus (DS:0x2827–0x2DD5). Verified all 11 main menu button labels match web order. Confirmed submenu item ordering: Hardware (DS:0x28C3–0x290E), Economics (DS:0x291F–0x295B), Landscape (DS:0x296A–0x298D), Physics (DS:0x299A–0x29F8 — includes Sky, Max Wind, Changing Wind), Play Options (DS:0x2A07–0x2A90). Sky correctly placed in Physics submenu (matches web). Found 4 Hardware-only items not in web port (Pointer, Mouse Rate, Joystick Rate, Joystick Threshold at DS:0x2D3E–0x2D65) — these are DOS input device settings, not applicable to web. Found Attack File/Die File items (DS:0x2A17/0x2A25) — talk config file selectors, not applicable to web. Verified `@` prefix in `@~Percent Scanned Mountains:` (DS:0x6383) is a dialog system conditional visibility marker. Disassembled cash_display at 0x16A7C — verified "Cash Left:" (DS:0x2DDD) and "Earned interest" (DS:0x2EDF) format strings match web.

**Result**: No new actionable discrepancies found (2nd consecutive clean audit after session 91 fix).

| Check | Result |
|-------|--------|
| Main menu 11 buttons | Labels + order match EXE DS:0x2827–0x288C — correct |
| Submenu item labels | All match EXE DS string tables — correct |
| Sky in Physics submenu | Confirmed by DS string order (0x299A–0x29F8) — correct |
| Shop cash display | "Cash Left:" and "Earned interest" match DS:0x2DDD/0x2EDF — correct |
| HUD full + basic mode | All widgets, bars, wind — correct |
| Menu + submenu | Hotkeys, sizing, row height — correct |
| Talk bubbles | Border, fill, text, position — correct |
| System menu | Hotkeys, confirmations, row height — correct |
| Round/game over | Format strings, any-key input — correct |
| Shop | Score tab, scrollbar, Done button — correct |
| Font | 161 glyphs, underlines — correct |
| Input system | All handlers — correct |

**Noted for future reference** (not bugs — DOS-only features):
- Hardware submenu items Pointer/Mouse Rate/Joystick Rate/Joystick Threshold: DOS input device settings
- Play Options items Attack File/Die File: talk config file selectors

---

## 29. Session 93 — Config value name audit: 1 discrepancy found and fixed

**Scope**: All 9 web/js UI files + deep EXE investigation of config spinner value name pointer arrays.

**EXE investigation**: Traced the config dialog item builder for Physics submenu at file 0x3C0B2. The "~Effect of Walls:" spinner (DS:0x29C5) passes DS:0x6294 (BSS) as its value name array with 8 entries. Disassembled the runtime initialization at file 0x3D978 that populates DS:0x6294 from static pointer tables:
- Wall type 0: DS:0x2284 → DS:0x2C7A = "None" (matches web ✓)
- Wall type 1: DS:0x20E0 → DS:0x278E = "Wrap-around" ✓
- Wall type 2-5: "Padded"/"Rubber"/"Spring"/"Concrete" ✓
- Wall type 6: DS:0x20DC → DS:0x2787 = "Random" ✓
- Wall type 7: DS:0x20D8 → DS:0x277F = "Erratic" ✓

Traced Scale (Explosion Scale) name array at DS:0x2100 (3 far pointers):
- Scale 0: DS:0x2100 → DS:0x27CC = **"Normal"** (web had "Small" ✗)
- Scale 1: DS:0x2104 → DS:0x27D3 = "Medium" ✓
- Scale 2: DS:0x2108 → DS:0x27DA = "Large" ✓

Runtime init at file 0x3DA44 copies DS:0x2100 entries to BSS array DS:0x62CC. Confirmed EXE Scale 0 = "Normal", not "Small".

Also verified: Bomb Icon names (DS:0x27B8 "Small", DS:0x27BE "Big", DS:0x27C2 "Invisible") ✓, Scoring Mode (DS:0x27E0 "Standard", DS:0x27F1 "Corporate", DS:0x27FB "Vicious") ✓, Play Mode (DS:0x2803 "Sequential", DS:0x280E "Simultaneous", DS:0x281B "Synchronous") ✓, Play Order (DS:0x2CFA "Losers-First", DS:0x2D07 "Winners-First", DS:0x2D15 "Round-Robin") ✓.

**Discrepancy fixed**: Scale value 0 name "Small" → "Normal" in both Play Options and Weapons submenus in menu.js (EXE DS:0x27CC).

| Check | Result |
|-------|--------|
| Wall type names (0-7) | None/Wrap-around/Padded/Rubber/Spring/Concrete/Random/Erratic — correct |
| **Scale names (0-2)** | **"Small" → "Normal"** / Medium / Large — **FIXED** |
| Bomb Icon names (0-2) | Small/Big/Invisible — correct |
| Scoring Mode names (0-2) | Standard/Corporate/Vicious — correct |
| Play Mode names (0-2) | Sequential/Simultaneous/Synchronous — correct |
| Play Order names (0-4) | Random/Losers-First/Winners-First/Round-Robin/Sequential — correct |
| Computers Buy names (0-3) | Basic/Greedy/Erratic/Random — correct |
| HUD full + basic mode | All widgets, bars, icons — correct |
| Menu + submenu | Hotkeys, sizing, row height — correct |
| Talk bubbles | Border, fill, text, position — correct |
| Shop | Score tab, scrollbar, tabs, misc headers — correct |

---

### Section 30 — Session 94: Full HUD/Menu/Shop Fidelity Re-audit

**Focus**: Explosion scale multiplier values (game.js)

Traced explosion scale system end-to-end:
- Config key "EXPLOSION_SCALE" (DS:0x0570) → parser at 0x1A6A0 → index 0/1/2 stored at DS:0x5112
- Scale setup at file 0x2B4A8 (icons.cpp): reads DS:0x5112 index, checks FG_MAXX (DS:0xEF3E)
- **Resolution-dependent multiplier tables**:

| Scale | Name | 320×200 (FG_MAXX==319) | >320 wide |
|-------|------|------------------------|-----------|
| 0 | Normal | 0.5 (DS:0x5250) | 1.0 (fld1 default) |
| 1 | Medium | 0.75 (DS:0x5254) | 2.0 (DS:0x5258) |
| 2 | Large | 1.0 (fld1 default) | 3.0 (DS:0x525C) |

Float32 values decoded: 0x3F000000=0.5, 0x3F400000=0.75, 0x40000000=2.0, 0x40400000=3.0

Web port had hardcoded `[0.5, 1.0, 1.5]` — doesn't match either EXE table.

**Discrepancy fixed**: game.js explosion scale now resolution-dependent:
- `config.screenWidth <= 320 ? [0.5, 0.75, 1.0] : [1.0, 2.0, 3.0]`

| Check | Result |
|-------|--------|
| **Explosion scale multipliers** | **[0.5, 1.0, 1.5] → resolution-dependent tables — FIXED** |
| HUD full + basic mode | All widgets, bars, icons — correct |
| Menu + submenu | Hotkeys, sizing, row height, config value names — correct |
| Talk bubbles | Border, fill, text, position — correct |
| Shop | Score tab, scrollbar, tabs, misc headers — correct |
| Font rendering | Proportional width, CP437 glyphs — correct |

---

### Section 31 — Session 95: Wind Indicator X Position Fix (1 discrepancy found and fixed)

**Focus**: Wind indicator `drawWindIndicator()` in hud.js

Traced draw_wind_indicator at file 0x28F1D:
- Format strings: DS:0x505A = "%s: %d" (neg/pos wind), DS:0x5068 = "%s" (zero → "No Wind")
- Color: push 0x009A → palette 154 (matches web WIND_COLOR=154 ✓)
- Text Y: SHIELD_DRAW_Y_MIN + 5 (matches web viewportY + 5 ✓)
- **Text X**: `dx = [EF3E] - textWidth - 20` → FG_MAXX - textW - 20
  - Web had: `config.screenWidth - textW - 20` (off by 1px, same pattern as session 91)
- **Arrow X (positive wind)**: `ax = [EF3E] + 0xFFF1` → FG_MAXX - 15
  - Web had: `config.screenWidth - 15` (off by 1px)
- Arrow X (negative wind): `si = si - 5` → relative to text X (auto-corrected)
- Arrow shape: 5 columns, col 4→0, draws ±di from center Y ✓

**Discrepancy fixed**: hud.js `drawWindIndicator()` now uses `FG_MAXX = screenWidth - 1`:
- Text: `FG_MAXX - textW - 20` (was `screenWidth - textW - 20`)
- Arrow: `FG_MAXX - 15` (was `screenWidth - 15`)

| Check | Result |
|-------|--------|
| **Wind indicator X position** | **screenWidth → FG_MAXX (screenWidth-1) — FIXED** |
| HUD full + basic mode | All widgets, bars, icons — correct |
| Menu + submenu | Hotkeys, sizing, row height — correct |
| Talk bubbles | Border, fill, text, position — correct |
| Shop | Score tab, scrollbar, tabs, misc headers — correct |
| Font rendering | Proportional width, CP437 glyphs — correct |

## 32. Session 96 — Talk bubble right X-clamp fix (1 discrepancy found and fixed)

**Audit scope**: All 9 web/js UI files vs EXE behavior. Targeted EXE investigation of
draw_hud (0x2FC84), draw_hud_full (0x301B2), display_talk_bubble (0x182FD), draw_border (0x1826C),
cash_display (0x16A7C), and main_menu title text (0x3D6D0).

Traced display_talk_bubble at file 0x182FD:
- Text X centering: `si = playerX - textWidth/2` ✓
- Left X-clamp: if `si <= EF42 + 4`, set `si = EF42 + 5` → default = 5 ✓
- **Right X-clamp**: if `si + di > [EF3C] - 10`, set `si = [EF3C] - di - 11`
  - EF3C = SHIELD_DRAW_X_MAX = FG_MAXX = screenWidth - 1
  - EXE: `si = screenWidth - 1 - textWidth - 11 = screenWidth - textWidth - 12`
  - Web had: `tx = screenWidth - 11 - textWidth = screenWidth - textWidth - 11` (1px too far right)
  - Same FG_MAXX vs screenWidth pattern as sessions 91 and 95
- Text Y: playerY - 19 ✓
- Box coords: (tx-3, ty-1) to (tx+textWidth+2, ty+12) ✓
- Border: 4 edges in EF2C (deep shadow), fill in EF26 (white) ✓
- Text drawn in EF2C (black) ✓

**Discrepancy fixed**: talk.js `drawSpeechBubble()` now uses `FG_MAXX = screenWidth - 1`:
- Right clamp: `FG_MAXX - textWidth - 11` (was `sw - 11 - textWidth`)

Also verified (no discrepancies):
- HUD draw_hud (0x2FC84): background fill, Row 1 widgets, Row 2 layout — all correct
- HUD draw_hud_full (0x301B2): format strings "%s:", "%4d", "%2d", "%d: %s" — match web
- Cash display (0x16A7C): "Cash Left:" / "Earned interest" layout — matches web shop
- Main menu title (0x3D6D0): centerXRight, subtitle/copyright Y positions — correct
- Laser sight, font hotkey underline, round-over display — all correct

| Check | Result |
|-------|--------|
| **Talk bubble right X-clamp** | **screenWidth → FG_MAXX (screenWidth-1) — FIXED** |
| HUD full + basic mode | All widgets, format strings, layout — correct |
| Menu centering + copyright | centerXRight uses FG_MAXX ✓, Y positions ✓ |
| Laser sight | Barrel tip, Bresenham line, plasma/standard logic — correct |
| Font hotkey underline | Underline at FONT_HEIGHT-1 — correct |

---

### 33. Session 97 — Bar column rendering & basic mode Row 2 deep dive (clean audit)

**EXE bar column draw (0x39482)**: 6px wide (x to x+5), 10px tall (y to y+9). Clamps fillH
to 0-10. Draws empty portion top-down in [EF2C] (deep shadow), then filled portion bottom-up
in player color. Web `drawBarColumn()` fills from bottom-up equivalently.

**Power bar helper (0x394F2)**: Reads struct[0x9E], divides by 100 (`idiv 0x64`).
Web: `Math.floor(power / 100)` — matches.

**Angle bar helper (0x39544)**: Calls `compute_item_percentage` (0x31D7F) which returns
`floor(struct[0x96] * 100.0 / ptr[0x02])` via Borland FPU, then divides by 10.
For max_angle=180: `floor(angle * 100 / 180) / 10 ≈ angle / 18`.
Web: `Math.floor(angle / 18)` — equivalent for all practical values.

**Basic mode Row 2 (0x2FD40)**: Energy bar at E9EA, angle bar at E9EE. Outlines
(y=ROW2_Y to ROW2_Y+11), fill (y+1 to y+10) in [EF2C]. Matches web layout.

**UI color BSS variables (DS:0xEF22-0xEF32)**: All 0 in static EXE, set at runtime.
Web palette indices 200-208 correctly mapped.

No discrepancies found.

| Check | Result |
|-------|--------|
| Bar column draw (0x39482) | 6px×10px, clamp 0-10, fill from bottom — correct |
| Power bar divisor | struct[0x9E] / 100 — matches web |
| Angle bar divisor | percentage/10 ≈ angle/18 — matches web |
| Basic mode Row 2 | Energy bar + angle bar layout — correct |
| UI color mapping | DS:0xEF22-0xEF32 → palette 200-208 — correct |

---

## 34. Dead Player Icon Color & Draw Mode (session 98)

**EXE `draw_icon_dead` at file 0x26245**: Renders icon with two key differences from `draw_icon_alive`:
1. **Color**: hardcoded palette 0xA9 (169) instead of player color
2. **Fill mode**: fill=0 instead of fill=1

**Fill mode behavior** (icon_internal_renderer at 0x26110):
- fill=1 (alive): draws pixels where byte value > 0 (signed), all in the single specified color
- fill=0 (dead): draws pixels where byte value ≠ 0, color = `|signed_pixel_value| + baseColor`

**Pixel data impact**: Icon 0 (player tank, 4×7) raw EXE data at DS:0x3826:
- Columns 0-2: pixel values 0x00/0x01 (standard binary)
- Column 3, row 0: pixel value 0x9D = -99 (signed byte)
  - In alive mode (fill=1): **skipped** because -99 ≤ 0
  - In dead mode (fill=0): **drawn** in color |(-99)| + 169 = 268 → palette 12 (player 1 color)

**Web port (hud.js:214)**: Uses `UI_DARK_TEXT` (palette 201 = dark gray 30,30,30) for all dead pixels;
draws with standard fill (all non-zero pixels rendered). Two sub-issues:
- **Extra pixel**: col3,row0 pixel (0x9D) is drawn in alive mode (web treats as 1>0) but EXE skips it
  (because -99≤0 in fill=1 signed check). Web alive icons are 1px too wide.
- **Dead color**: EXE uses palette 169 + |offset|, producing fire-palette-adjacent colors.
  Web uses uniform dark gray (palette 201). Visual character differs.

**Impact**: Minor — 4×7 pixel icons in basic mode HUD. One extra pixel in alive mode barely visible.
Dead icon color difference (fire-adjacent vs dark gray) is subtle.

**Fix needed**: Low priority. Would require:
(a) Storing raw signed byte pixel values in ICONS table instead of 0/1
(b) Adding fill mode parameter to drawIcon() / drawIconBitmap()
(c) Implementing color-offset calculation for fill=0 mode

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| Dead icon palette | 0xA9 (169) | UI_DARK_TEXT (201) | ✗ |
| Dead icon fill mode | outline (fill=0, color offset) | solid fill | ✗ |
| Alive icon col3,row0 pixel | skipped (0x9D ≤ 0 signed) | drawn (treated as 1) | ✗ |
| HUD background x2 | FG_MAXX - 5 = screenW-6 | screenW-LEFT-1 = screenW-6 | ✓ |
| Attack speech taunt | random(100)==2 = 1% | random(100)===2 = 1% | ✓ |

---

## 34. 3D Box Bevel Per-Edge Color Assignment — **FIXED** (session 98)

**EXE draw_3d_box at file 0x444BB** (raised 3D box, Windows 3.1-style bevel):
- Border width: 2px (lo-res, `[DS:0x6E28]!=3`) or 3px (hi-res 640×480+, `[DS:0x6E28]==3`)
- Each edge uses **ONE color** for ALL its border lines:
  - LEFT = DS:0xEF26 (UI_DARK_BORDER = white 63,63,63)
  - TOP = DS:0xEF2E (UI_LIGHT_BORDER = light gray 55,55,55)
  - RIGHT = DS:0xEF30 (UI_MED_BORDER = near-black 5,5,5)
  - BOTTOM = DS:0xEF32 (UI_BRIGHT_BORDER = dark gray 15,15,15)
- Draw order: hlines first (TOP then BOTTOM, each claiming corner pixels), then vlines (LEFT then RIGHT, skipping corner rows)

**EXE draw_flat_box at file 0x44630** (sunken/inset frame):
- Same structure but reversed bevel colors:
  - LEFT = DS:0xEF30 (near-black), TOP = DS:0xEF32 (dark gray)
  - RIGHT = DS:0xEF26 (white), BOTTOM = DS:0xEF2E (light gray)

**Web port (framebuffer.js) before fix**: Grouped TOP+LEFT edges together using alternating outer/inner colors. Outer loop drew outermost line of TOP and LEFT in one color, inner lines in another. Same for BOTTOM+RIGHT. This meant:
- TOP outer line was white (EF26) instead of light gray (EF2E)
- LEFT inner lines were light gray (EF2E) instead of white (EF26)
- BOTTOM outer line was dark gray (EF32) instead of itself
- RIGHT inner lines were wrong color
- Corner pixel ownership also differed (vlines claimed corners in web, hlines claim in EXE)

**Fix**: Refactored both `drawBox3DRaised` and `drawBox3DSunken` to use 4 per-edge color parameters (leftColor, topColor, rightColor, bottomColor). Each edge draws ALL its border lines in one color. Hlines draw first (claiming corners), vlines skip corner rows. All 17 callers verified — positional args unchanged.

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| Raised TOP color | EF2E (light gray) all lines | EF26 outer, EF2E inner | EF2E all lines | ✓ |
| Raised LEFT color | EF26 (white) all lines | EF26 outer, EF2E inner | EF26 all lines | ✓ |
| Raised RIGHT color | EF30 (near-black) all lines | EF32 outer, EF30 inner | EF30 all lines | ✓ |
| Raised BOTTOM color | EF32 (dark gray) all lines | EF32 outer, EF30 inner | EF32 all lines | ✓ |
| Corner pixel ownership | hlines claim corners | vlines claimed corners | hlines claim corners | ✓ |
| Border width (hi-res) | 3px when DS:6E28==3 | 3px when screenH≥400 | 3px when screenH≥400 | ✓ |
| Sunken box (reversed) | LEFT=EF30,TOP=EF32,RIGHT=EF26,BOTTOM=EF2E | same grouping bug | per-edge correct | ✓ |

## 35. Sunken Box Border Width: 1px (EXE draw_flat_box) vs 2-3px (Web drawBox3DSunken)

**Session**: 99 (2026-02-26)

**EXE draw_flat_box at file 0x44630**: 1px sunken border only (4 single-line draw calls):
- LEFT: `vline(minx, miny, maxy-1, EF30)` — owns top-left corner
- TOP: `hline(minx+1, maxx, miny, EF32)` — owns top-right corner
- RIGHT: `vline(maxx, miny+1, maxy, EF26)` — owns bottom-right corner
- BOTTOM: `hline(minx, maxx-1, maxy, EF2E)` — owns bottom-left corner

Compare with **draw_3d_box at 0x444BB** (raised): 2-3px borders (multi-line loops), hlines claim ALL corners, vlines skip corner rows.

**Web drawBox3DSunken before fix**: Used same 2-3px multi-pixel border structure as drawBox3DRaised. Every sunken element (terrain preview frame, pressed buttons, shop panels, input fields, scrollbar tracks, active tabs) had 1-2px extra border thickness compared to EXE.

**25 EXE callers of draw_flat_box**: Confirmed via xref — all use 1px. No multi-pixel sunken box function exists in the EXE (draw_3d_box doesn't take color params, so can't be called with reversed colors). The EXE's entire UI convention is: raised = thick border (2-3px), sunken/inset = thin border (1px).

**Corner ownership difference**: draw_flat_box corners are each owned by a different edge (TL=Left, TR=Top, BR=Right, BL=Bottom). draw_3d_box corners are all owned by hlines (top/bottom).

**Fix**: Refactored `drawBox3DSunken` in framebuffer.js to use 1px borders with correct corner ownership. Also fixed 3 scrollbar track calculations in shop.js that used old 2-3px border width for thumb positioning.

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| Sunken border width | 1px always | 2-3px (screenH-dependent) | 1px always | ✓ |
| Corner ownership (sunken) | TL=Left, TR=Top, BR=Right, BL=Bottom | All by hlines | TL=Left, TR=Top, BR=Right, BL=Bottom | ✓ |
| Scrollbar thumb track inset | 1px | 2-3px | 1px | ✓ |
| Raised border width (unchanged) | 2-3px | 2-3px | 2-3px | ✓ |

---

### 36. Raised box (draw_3d_box) asymmetric hi-res border widths (session 100)

**EXE draw_3d_box (0x444BB)**: In hi-res mode (DS:0x6E28==3, 640×480+), the 3rd border line conditional (`cmp [0x6E28], 3; jne skip`) only appears for TOP/BOTTOM hlines — at 0x44526 (top 3rd hline at y=miny+2) and 0x445B9 (bottom 3rd hline at y=maxy-2). LEFT/RIGHT vlines always draw exactly 2 lines with no hi-res check. The fill rect is also asymmetric: (minx+2, miny+3, maxx-2, maxy-3) — 2px X inset, 3px Y inset.

**Web (before)**: `const b = screenHeight >= 400 ? 3 : 2` used symmetrically for all 4 edges and fill rect. In hi-res mode, drew 3px borders on all edges (too thick on left/right by 1px).

**Fix**: Split into `bV` (top/bottom, 2 or 3) and `bH` (left/right, always 2). Fill rect uses asymmetric inset: `fillRect(x+bH, y+bV, x+w-bH-1, y+h-bV-1)`.

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| Hi-res TOP/BOTTOM border | 3px | 3px | 3px | ✓ |
| Hi-res LEFT/RIGHT border | 2px | 3px (wrong) | 2px | ✓ |
| Lo-res all borders | 2px | 2px | 2px | ✓ |
| Hi-res fill rect X inset | 2px | 3px (wrong) | 2px | ✓ |
| Hi-res fill rect Y inset | 3px | 3px | 3px | ✓ |

### 37. Main menu subtitle/copyright text colors (session 101)

**EXE main_menu (0x3D140)**: After `title_3d_text` (0x4CEFD) returns, the Fastgraph current color is EF26 (last emboss layer). The subtitle "The Mother of All Games" and "Registered Version" text are rendered WITHOUT any `fg_setcolor` call — they inherit EF26 (UI_DARK_BORDER = palette 155 = white, 63,63,63). Then at 0x3D786, `fg_setcolor([EF2C])` explicitly sets EF2C (UI_DEEP_SHADOW = palette 152 = black, 0,0,0) for the copyright and version text.

**Web (before)**: All four text elements used `UI_DARK_TEXT` (palette 201 = 30,30,30 dark gray). Subtitle and "Registered Version" should be white (EF26), copyright and version should be black (EF2C).

**Fix**: Changed subtitle + "Registered Version" to `UI_DARK_BORDER` (white); copyright + "Version 1.50" to `UI_DEEP_SHADOW` (black).

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| Subtitle color | EF26 white (63,63,63) | UI_DARK_TEXT dark gray (30,30,30) | UI_DARK_BORDER white | ✓ |
| "Registered Version" color | EF26 white (63,63,63) | UI_DARK_TEXT dark gray (30,30,30) | UI_DARK_BORDER white | ✓ |
| Copyright color | EF2C black (0,0,0) | UI_DARK_TEXT dark gray (30,30,30) | UI_DEEP_SHADOW black | ✓ |
| "Version 1.50" color | EF2C black (0,0,0) | UI_DARK_TEXT dark gray (30,30,30) | UI_DEEP_SHADOW black | ✓ |

### 38. Wind indicator color VGA 154 (session 102)

**EXE icons.cpp palette init (0x2A6F4)**: `fg_setrgb(0x9A, 0x28, 0x28, 0x3F)` — VGA palette index 154 (0x9A) set to RGB (40, 40, 63) = medium blue. This color is used for the wind indicator text and arrow on the playfield (file 0x28FBC: `fg_setcolor(0x9A)`). The subtle blue is intentional — it's visible against most sky gradients without being overly bright.

**Web (before)**: `setEntry(154, 63, 63, 63)` = white. Comment said "Set to white for visibility" — a deliberate but non-faithful choice.

**Fix**: Changed to `setEntry(154, 40, 40, 63)` matching the EXE's medium blue exactly.

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| VGA 154 R | 40 | 63 (wrong) | 40 | ✓ |
| VGA 154 G | 40 | 63 (wrong) | 40 | ✓ |
| VGA 154 B | 63 | 63 | 63 | ✓ |
| Wind indicator appearance | medium blue | white | medium blue | ✓ |

### 39. Shop selection highlight fill color (session 103)

**EXE paint callback (0x1580D)**: The shop's selected item row is filled using `[EF22]` — the player's dynamically-set base color. `[EF22]` is loaded from the tank sub-struct's palette index before each shop draw, and corresponds to the player's full-brightness color (palette slot 4 within the player's 8-slot block, e.g., VGA 4 for player 0 = full red 63,10,10).

**Player palette structure verified**: `setup_player_palette` at file 0x28592 loops VGA 0–79 (10 players × 8 slots). For each entry: slot%8==5 → white (63,63,63), slot%8==7 → grey (30,30,30), all other slots → player's base RGB from tank struct +0x1C/+0x1E/+0x20. ALL 6 non-special slots (0-4, 6) receive the SAME full base color — no gradient exists in the EXE palette.

**Web (before)**: `selFill = player.index * PLAYER_PALETTE_STRIDE + 3` — used palette slot 3, which in the web port's gradient formula = floor(base × 4/5) ≈ 80% brightness. For the red player: (50,8,8) instead of full (63,10,10).

**Note on web gradient**: The web port intentionally creates a 5-level gradient (slots 0-3 = base×1/5 through base×4/5, slot 4 = full) for tank body shading. This is a creative enhancement not present in the EXE. The tank dome/body rendering in tank.js uses these gradient slots. This is NOT being changed — it's an intentional visual improvement. However, the shop highlight should use the full-brightness slot to match the EXE.

**Fix**: Changed `selFill` from slot 3 to `baseColor` (slot 4 = PLAYER_COLOR_FULL) in shop.js.

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| Selection fill color | [EF22] = full base (slot 4) | slot 3 (80% brightness) | slot 4 (full base) | ✓ |
| Player palette slots 0-4,6 | all same base color | gradient (intentional) | gradient (unchanged) | intentional |

### 40. Submenu item row pitch (session 104)

**EXE submenu creation (0x3BA7F)**: `mov word [bp-0x0A], 0x000F` at file 0x3BA92 — unconditionally sets row pitch to **15 pixels** for all screen modes. Each submenu item is positioned at `y = n * [bp-0x0A] + 5`, producing y-offsets 5, 20, 35, 50, 65, 80... with pitch = 15. Confirmed across multiple items and two different item-add functions (`3F19:0x34FF` and `3F19:0x2F39`). Item box occupies y to y+11 (height = 12), leaving a 3px gap between consecutive item boxes.

**Web (before)**: `getSubRowH() = getScreenH() >= 400 ? 19 : 14` — used 14 for lo-res (≤320x200). Comment incorrectly stated "EXE: item spacing 14px". With pitch=14, item highlight bars are height=12 (matching EXE) but the gap between bars is only 2px instead of EXE's 3px.

**Fix**: Changed `14` → `15` in `getSubRowH()`, updated comment. The hi-res value (19) remains unchanged — it's a web-specific enhancement (EXE uses 15 unconditionally across all modes).

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| Row pitch (lo-res) | 15px (`[bp-0x0A]=15`) | 14px (wrong) | 15px | ✓ |
| Item 0 y-offset | dialog.miny + 5 | dlgY + 18 | dlgY + 18 | n/a (different ref) |
| Gap between item boxes | 3px (15 − 12) | 2px (14 − 12) | 3px (15 − 12) | ✓ |
| Hi-res row pitch | 15px (EXE unchanged) | 19px (web enhancement) | 19px (web enhancement) | intentional |

---

### 41. Clean audit — intentional enhancements confirmed (session 105)

**`~` hotkey underline**: EXE `text_display` at 0x4C914 simply skips `~` (0x7E) silently for normal palette colors (only color 152 triggers a color-change via `fg_setcolor`; no underline drawn). Web `font.js` draws an underline under the next character as a readability enhancement. **Intentional web addition — not a bug.**

**Dialog positioning**: EXE submenus use fixed absolute screen regions (e.g., x1=110,y1=50,x2=310,y2=140 in 320×200) computed by the Fastgraph dialog library at seg 0x3F19. Web centers dynamically relative to screen. **Intentional redesign — not a bug.**

**Copyright/version Y positions**: EXE at 0x3D790 sets `fg_setcolor([EF2C])` then draws copyright at `FG_MAXY-20` (= screenH-21). Version at `copyrightY-13`. Two-line copyright path confirmed. Web formulas verified correct ✓.

**Score tab row height off-by-one**: EXE at file 0x341F5 checks `FG_MAXY >= 220` (i.e., screenH ≥ 221). Web uses `screenH >= 220`. No standard VGA mode has screenH exactly 220 so this has no practical impact. **Not fixed.**

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| `~` underline | not drawn (skip only) | drawn (intentional) | intentional |
| Dialog centering | fixed absolute coords | dynamic centering | intentional |
| Copyright Y | FG_MAXY-20 = screenH-21 | screenH-21 | ✓ |
| Version Y | copyrightY-13 | copyrightY-13 | ✓ |
| Score row height threshold | FG_MAXY>=220 → screenH>=221 | screenH>=220 | near-match |

---

### 42. Terrain frame left X / main menu left panel width (session 106)

**EXE main_menu (0x3D4C7–0x3D538)**: After adding all items to the dialog, the code loops over all items to find `max(item.+0x4C)` where `item.+0x4C = item.x + item.width - 1` (the right edge of each item, inclusive). For main menu buttons with `item.x = getBtnX()` and `item.width = 80`: `item.+0x4C = getBtnX() + 80 - 1`. Then at 0x3D523–0x3D538:
```
ax = dialog.x1 (= 0)
ax += max(item.+0x4C)  ; = getBtnX() + 79
ax += [bp-0x38]        ; = getBtnX() (stored at function entry: 5 or 12)
mov [bp-0x3A], ax      ; terrain_frame_x = 2*getBtnX() + BTN_W - 1
```
Result: terrain frame left x = `2*getBtnX() + BTN_W - 1`. Large mode (getBtnX=12): **103**. Small mode (getBtnX=5): **89**.

**Web (before)**: `getLeftW() = getBtnX() + BTN_W + 4` → `getRightX() = getBtnX() + BTN_W + 5`. Large mode: **97** (6 too small). Small mode: **90** (1 too large). The formula was estimated, not derived from EXE code.

**Fix**: Changed `getLeftW()` to `2 * getBtnX() + BTN_W - 2` → `getRightX() = 2*getBtnX() + BTN_W - 1`. Now matches EXE exactly in both modes. Updated comment documenting the derivation.

| Check | EXE | Web (before) | Web (after) | Match |
|-------|-----|-------------|-------------|-------|
| Terrain frame x (large mode, 640×480) | 103 | 97 (wrong) | 103 | ✓ |
| Terrain frame x (small mode, 320×200) | 89 | 90 (wrong) | 89 | ✓ |
| Gap between buttons and terrain frame (large) | 11px | 5px | 11px | ✓ |
| Gap between buttons and terrain frame (small) | 4px | 5px | 4px | ✓ |

---

### 43. Basic HUD Row 1 — icon draw sequence (session 110)

**EXE icon loop (`draw_hud_basic` 0x2FEA4–0x2FEB8)**: Iterates ALL players (alive and dead alike) using the all-players iterator at 0x32166 (2B3B:03B6). Iterator formula: DS:D568 + i×0xCA for i=0..NUM_PLAYERS-1 (tank sub-struct pointer). No alive/dead filtering in the loop.

**Per-player draw (file 0x2FE49–0x2FE79)**:
1. Calls 3249:0662 → draws power-bar column at X=player_id×6+E9D6, Y=HUD_Y+1, height=power/100
2. Reads icon_idx = [tank+0x16] = **always 0** (confirmed: player_init_substruct at 0x30F3F writes 0 and nothing else changes it)
3. Reads color = [tank+0x1A] (player base palette color, set at init)
4. Calls `draw_icon_alive` (0x261D7) with X=player_id×11+E9DA, Y=HUD_Y, icon=0, color=[tank+0x1A]

**draw_icon_dead (0x26245) is NOT called from draw_hud_basic**: its 3 far-call callers are at 0x16903 (early segment) and 0x37B29/0x37B6E (ranges.cpp). The basic HUD always uses `draw_icon_alive` for all players. Dead icon color behavior (palette 169) is only used in other draw contexts (see section 34 for pixel-level detail).

**No active player indicator dot**: no separate pixel/dot indicator exists in draw_hud_basic or its subroutines. The active player's icon cell is refreshed by `update_hud_row1` (0x307E8 / 28B9:1258) when the weapon changes or turn changes:
- PLAY_MODE==1 (Simultaneous): clears cell (fillH background), redraws DS:E344 (current weapon icon) at player_id×11+E9DA with active player color
- Other modes: clears weapon area (E9DE to FG_MAXX-5), draws weapon name text, draws weapon icon at E9DE

**Web port status**: Already correct — no new discrepancies found. Prior section 34 documents the alive/dead pixel rendering differences. Icon 0 for all players is faithful to EXE behavior.

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| Icon used for each player | icon 0 ([tank+0x16]=0 always) | icon 0 | ✓ |
| draw_icon_alive for alive players | flag=1, player color [tank+0x1A] | player color | ✓ |
| draw_icon_dead for dead players | NOT called from basic HUD loop | uses UI_DARK_TEXT | n/a (different context) |
| Active player indicator dot | not present | not present | ✓ |
| Icon X spacing | player_id × 11px + E9DA | `px * 11` | ✓ |
| update_hud_row1 weapon icon | DS:E344 at active-player cell | DS:E344 via hud.js | ✓ |

---

### 44. Basic HUD Row 2 — bar rendering (session 111)

**EXE `draw_hud_basic` Row 2 (file 0x2FD37–0x2FE44)**: Only drawn if DS:0x5142 (STATUS_BAR) != 0.

**Layout (`compute_hud_layout_basic` 0x2FBCA)**:
- `E9E8 = 5` = E9D4 (Row 2 first label X, same as Row 1 player name X)
- `E9EA = E9D6` (Row 2 first bar X = same column as power bar)
- `E9EC = E9EA + 0x3E + 0x0A = E9D6 + 72` (Row 2 second label X)
- `E9EE = E9EC + measureText("Shields") + measureText(": ")` (Row 2 second bar X)

**Row 2 geometry**: outer draw_flat_box from (E9EA−1, HUD_Y+0x0C) to (E9EA+numP×6, HUD_Y+0x17) = **12px tall** (HUD_Y+12 to HUD_Y+23 inclusive). Inner fill HUD_Y+0x0D → HUD_Y+0x16 = **10px** tall.

**bar_column helper (0x39482)**: 6px wide (X to X+5), 10px tall (Y_TOP to Y_TOP+9), fillH clamped 0–10, fills from bottom up. Background (EF2C) fills empty top portion; fill color fills bottom portion.

**Row 2 labels (static, never changed at runtime)**:
- Label 1: DS:0x2364 → DS:0x2EFA = **"Max"** → format "%s:" → draws **"Max:"** at (5, HUD_Y+12)
- Label 2: DS:0x2368 → DS:0x2EFE = **"Shields"** → format "%s:" → draws **"Shields:"** at (E9EC, HUD_Y+12)

**Row 2 per-player bars** (called in loop for each player):
1. **Energy bar** at E9EA (helper 0x3959F `hud_draw_angle_bar_col`): reads `[sub+0xA2/A4]` (energy/health 32-bit value) divided by `[sub+0xA6/A8]` (max health 32-bit) × 10 → bar height 0–10
2. **Shields bar** at E9EE (helper 0x39544 `hud_draw_item_bar_col`): calls `compute_item_percentage` = `floor(sub[0x96] × 100.0 / ptr[0x02]) / 10` where `sub[0x96]` = shield count (init 0 at 0x30EE7) and `sub[+0xC6/C8]` = SHIELD_CONFIG_PTR_ARRAY (init at 0x30EF5 from DS:0x61CC/61CE), `ptr[0x02]` = max shield count from weapon record

**CORRECTION**: Prior sessions 83 and 97 incorrectly identified the second bar (E9EE) as an "angle" bar (formula angle/18). The label "Shields:" and the sub-struct init code (0x30EE7 and 0x30EF5) confirm it is a **shields inventory percentage** bar.

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| Row 2 outer box height | 12px (HUD_Y+0xC to HUD_Y+0x17) | `BAR_H+1=12` | ✓ |
| Bar interior height | 10px (HUD_Y+0xD to HUD_Y+0x16) | `BAR_H-1=10` | ✓ |
| Column width | 6px (X to X+5) | `colX to colX+5` | ✓ |
| Fill direction | bottom-up | bottom-up | ✓ |
| fillH clamp | 0–10 | `Math.min(fillH, BAR_H-1)` | ✓ |
| Row 2 Y position | HUD_Y+0x0C=HUD_Y+12 | `ROW2_Y = HUD_Y+12` | ✓ |
| Row 2 label 1 | **"Max:"** (static DS:0x2EFA) | `player.name + ':'` | ✗ **DISCREPANCY** |
| Row 2 label 2 | **"Shields:"** (static DS:0x2EFE) | `'Angle:'` | ✗ **DISCREPANCY** |
| First bar metric | energy/health ratio ×10 | `players[i].energy / 10` | ✓ (if `player.energy`=energy%) |
| Second bar metric | shields inventory % / 10 | `players[i].angle / 18` | ✗ **DISCREPANCY** |

### 45. HUD bars segment (seg 0x3249, base 0x38E90) — full audit (session 112)

**Segment contents** (0x38E90 onwards, segment register 0x3249):

Non-HUD functions also in this segment: large game-loop/turn-management function (0x38E9F), key-handler per player (0x3907E), fog-color setter (0x390E5), per-player action dispatcher (0x3918E), projectile-in-flight loop (0x39266), shield bit-plotting helpers (0x39628, 0x3968D), terrain-type cache flush (0x396FA), terrain_gen_main (0x3971F+).

HUD bar functions:

| Function | File offset | Description |
|----------|-------------|-------------|
| `bar_column` | 0x39482 | Primitive: 6px wide, 10px tall, fill bottom-up, clamped 0–10 |
| `hud_draw_power_bar_col` | 0x394F2 | Power bar: reads `sub[+0x9E]`, height=`floor(power/100)`, X=`player_id×6+E9D6`, Y=`HUD_Y+1` |
| `hud_draw_item_bar_col` | 0x39544 | Shields bar: calls `compute_item_percentage`, height=`result/10`, X=`player_id×6+E9EE`, Y=`HUD_Y+0xD`; checks DS:0x5142 guard |
| `hud_draw_angle_bar_col` | 0x3959F | Energy/health bar: `floor(health×10/maxHealth)`, X=`player_id×6+E9EA`, Y=`HUD_Y+0xD`; checks DS:0x5142 guard |

**Row 1 power bar geometry (draw_hud_basic 0x2FCA4–0x2FD36)**:
- Outer box: `draw_flat_box(E9D6-1, HUD_Y, E9D6+numP×6, HUD_Y+11)` = **12px tall** (HUD_Y to HUD_Y+11)
- Inner fill: `fillH(E9D6, HUD_Y+1, E9D6+numP×6-1, HUD_Y+10, EF2C)` = **10px** (HUD_Y+1 to HUD_Y+10)
- `hud_draw_power_bar_col` calls `bar_column(E9D6+player_id×6, HUD_Y+1, floor(power/100), [tank+0x1A])`

**STATUS_BAR flag (DS:0x5142) full guard chain**:
- `draw_hud_basic` at 0x2FD37: if `[0x5142]==0` → jump to 0x2FE47 (skip **entire** Row 2 block)
- `draw_hud_basic` at 0x2FE81: if `[0x5142]==0` → skip item+angle bar columns (but Row 2 box still drawn)
- `hud_draw_item_bar_col` / `hud_draw_angle_bar_col` both also check `[0x5142]` internally

Result: when STATUS_BAR=0, **Row 2 is not drawn at all** in basic mode.

**bar_column fillH=0 case**: EXE fills the entire 6-wide column with EF2C background; web `drawBarColumn` returns early (`if (fillH <= 0) return`), relying on the preceding `drawBarFill` to have already painted the full bar interior with `UI_DEEP_SHADOW`. Visually identical since both EF2C and `UI_DEEP_SHADOW` are the same dark color.

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| Row 1 outer box | 12px (HUD_Y to HUD_Y+11) | `drawBarOutline(barX, HUD_Y)` → y to y+11 | ✓ |
| Row 1 inner fill | 10px (HUD_Y+1 to HUD_Y+10) | `drawBarFill(barX, HUD_Y, barW, UI_DEEP_SHADOW)` rows y+1..y+10 | ✓ |
| Column X stride | player_id × 6 + E9D6 | `barX + idx * 6` | ✓ |
| Column fill rows | Y_TOP+10-fill … Y_TOP+9 | `barY+10, barY+9, …, barY+11-h` (same rows) | ✓ |
| Power fill formula | `floor(sub[+0x9E] / 100)` | `Math.floor(players[i].power / 100)` | ✓ |
| STATUS_BAR=Off → hide Row 2 | Row 2 completely skipped | Row 2 **always drawn** (config.statusBar not checked in hud.js) | ✗ **INTENTIONAL** |

Note: The web hud.js comment explicitly documents the STATUS_BAR deviation: "Web port always draws expanded (both rows)." `config.statusBar` exists in config.js and is shown in the menu UI but has no effect on rendering — this is an intentional web-port design choice for usability.

### 46. Wind Playfield Indicator — full disassembly audit (session 113)

**EXE: `draw_wind_indicator` file 0x28F1D (seg 1F7F:2D2D)**

Text content (formatted into DS:0xE05E buffer):
- wind < 0: `sprintf("%s: %d", "Wind", abs(wind))` using DS:0x505A format, DS:0x2B04="Wind" far ptr → `"Wind: N"`
- wind > 0: `sprintf("%s: %d", "Wind", wind)` using DS:0x5061 format, DS:0x2B04="Wind" far ptr → `"Wind: N"`
- wind = 0: `sprintf("%s", "No Wind")` using DS:0x5068 format, DS:0x2B09="No Wind" far ptr → `"No Wind"`

Position:
- X = `DS:EF3E` (FG_MAXX) − textW − 20, stored to DS:D4E0
- Y = `DS:EF40` (= PLAYFIELD_TOP) + 5, stored to DS:D4E2

Color (adaptive, same logic for text pixels and arrow pixels):
- Reads background pixel color at each draw point via fg_getpixel
- If background color index is in [80, 104] (sky gradient palette range): use palette **87** (set by `fg_setrgb(87, 40, 40, 63)` at function start)
- Otherwise: use palette **154** (0x9A)

Arrow (when wind ≠ 0):
- direction = sign(wind)
- Rightward (wind > 0): arrowX = FG_MAXX − 15, direction = +1 → base at left, tip at right
- Leftward (wind < 0): arrowX = WIND_DISPLAY_X − 5, direction = −1 → base at right, tip at left
- Arrow center Y = PLAYFIELD_TOP + 10
- Loop: col = 4 down to 0; for di = 0..col: draw pixel at (arrowX, centerY+di) and (arrowX, centerY−di); then arrowX += direction
- Produces 5-column triangle, 9px→1px height, pointing in wind direction

Text rendering mechanism: font module `text_display` (0x4589:0x0BD4) takes (char far* str, far ptr pixel_callback). Callback at file 0x28E43 (1F7F:2C53) adds DS:D4E0/D4E2 offsets and applies sky-adaptive color.

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| Text format | `"Wind: N"` / `"No Wind"` | `'Wind: ' + abs(wind)` / `'No Wind'` | ✓ |
| Text X | `FG_MAXX − textW − 20` | `FG_MAXX − textW − 20` | ✓ |
| Text Y | `PLAYFIELD_TOP + 5` | `PLAYFIELD_TOP + 5` | ✓ |
| Arrow right X | `FG_MAXX − 15` | `FG_MAXX − 15` | ✓ |
| Arrow left X | `WIND_DISPLAY_X − 5` | `x − 5` | ✓ |
| Arrow center Y | `PLAYFIELD_TOP + 10` | `PLAYFIELD_TOP + 10` | ✓ |
| Arrow shape | 5-col triangle col=4..0, col+1 pixel half-height | same loop | ✓ |
| Color | Adaptive: palette 87 (sky) / 154 (other) | Always palette 154 | ✗ minor |

Minor discrepancy: EXE dynamically picks between palette 87 (blueish, for drawing over sky gradient pixels 80–104) and 154 (standard) at each pixel. Web always uses palette 154. The difference is visible only when the wind text/arrow overlaps the sky area, which in practice occurs at high playfield. Low priority.

### 47. HUD Color Variables DS:0xEF22–0xEF46 — full audit (session 114)

**EXE: Init function at file 0x2A630 (icons.cpp) — called at startup**

Color variable assignments (VGA DAC indices and their RGB values):
- **DS:0xEF22** = VGA 152 = (R=0, G=0, B=0) = **BLACK** — HUD/UI text color and weapon icon color; NOT per-player (fixed)
- **DS:0xEF24** = VGA 153 = (R=30, G=30, B=30) = dim gray — depleted/zero-ammo item text
- **DS:0xEF26** = VGA 155 = (R=63, G=63, B=63) = **WHITE** — 3D box top/left bevel highlight
- **DS:0xEF28** = VGA 151 = (R=45, G=45, B=45) = light gray — HUD panel background fill (= EF2A at init)
- **DS:0xEF2A** = VGA 151 = same as EF28
- **DS:0xEF2C** = VGA 152 = BLACK — bar interior background fill (same VGA entry as EF22)
- **DS:0xEF2E** = VGA 159 = (R=55, G=55, B=55) = medium-light gray — 3D box inner bevel
- **DS:0xEF30** = VGA 158 = (R=5, G=5, B=5) = near-black — 3D box deepest shadow edge
- **DS:0xEF32** = VGA 156 = (R=15, G=15, B=15) = very dark gray — 3D box shadow edge
- **DS:0xEF20** = VGA 162 — role TBD (assigned but not commonly referenced in HUD path)
- **DS:0xEF3E** = FG_MAXX (screen width − 1) — not a color variable
- **DS:0xEF40** = PLAYFIELD_TOP — not a color variable
- **DS:0xEF46** = SOUND_DEVICE — not a color variable

**text_display color mechanism (0x4589:0x0684):**
`store_sky_base_index(n)` [file 0x4569F] sets DS:0x6E2A = n. `text_display` reads DS:0x6E2A at file 0x4C95C as the text color (VGA palette index). All text drawn through text_display uses DS:6E2A as the foreground color.

**HUD text color sequence (draw_hud_basic 0x2FC84 / draw_hud_full 0x301B2):**
1. `store_sky_base_index(EF22=152)` → DS:6E2A = 152 → **BLACK text** for player name label ("PlayerName:")
2. No intervening color change → power "%4d", "Angle:", angle "%2d" all drawn in BLACK
3. `store_sky_base_index(0xA3=163)` + `fg_setrgb(163, R, G, B)` sets VGA 163 = player's actual RGB
4. player name text drawn in VGA 163 = **PLAYER COLOR**
5. `store_sky_base_index(EF22=152)` resets → weapon icon + weapon name drawn in **BLACK**

**EF24 active/depleted branching (draw_hud_full Row 2, file 0x30452 and 0x304C4):**
```asm
cmp [item_count], 0
jle use_EF24         ; depleted → dim gray (VGA 153 = 30,30,30)
push [EF22]          ; active → black (VGA 152 = 0,0,0)
jmp done
use_EF24:
push [EF24]
done:
call store_sky_base_index
; then call text_display → draws count text in EF22 or EF24
```

**Per-player colors (NOT via EF22):**
- `[tank+0x1A]` = player base VGA index (player i = VGA i×8) — used for bar column fills and tank icons
- VGA 163 (0xA3): set per player via `fg_setrgb(163, R, G, B)` from `tank[+0x1C/1E/20]` — used for player name text in draw_hud_full

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| EF22 (text color) | VGA 152 = BLACK (0,0,0) — fixed | Not used for text; web uses `player.index*8+4` | ✗ (intentional) |
| EF24 (depleted) | VGA 153 = dim gray (30,30,30) | `UI_DARK_TEXT` (VGA 201) | ✓ equivalent |
| EF26 (highlight) | VGA 155 = WHITE (63,63,63) | mapped to UI box highlight | ✓ equivalent |
| EF28 (background) | VGA 151 = light gray (45,45,45) | `UI_BACKGROUND` (VGA 203) | ✓ equivalent |
| EF2C (bar fill) | VGA 152 = BLACK | `UI_DEEP_SHADOW` (VGA 205) | ✓ equivalent |
| Player name text | VGA 163 = player's actual RGB | `player.index*8+4` = player slot | ✓ equivalent |
| Icon/bar color | `[tank+0x1A]` = VGA i×8 | `player.index*8+4` = VGA i×8+4 | ✓ equivalent |
| Most HUD text | VGA 152 = BLACK | `player.index*8+4` = player color | ✗ (intentional) |

**Intentional web divergence**: EXE draws most HUD text (labels, power, angle, weapon name) in VGA 152 = black against a light-gray HUD background. Web port draws ALL HUD text in the player's specific color for visual clarity. This is a known aesthetic divergence, not a bug.

---

### 48. Main menu button layout — full disassembly audit (session 115)

**EXE `main_menu` (file 0x3D140 = 34ED:1870)**

**Mode selection** (at 0x3D161): compares `FG_MAXY` with 200 (0xC8):
- `FG_MAXY ≤ 200` → small/compact mode: DS:ED58=1, BTN_X=5, start_y=5, DS:ECD4=4, DS:ECD6=0
- `FG_MAXY > 200` → large/spacious mode: DS:ED58=0, BTN_X=12, start_y=15, DS:ECD4=5, DS:ECD6=4

**Row height table** at DS:0x6316:
- DS:0x6316 = 25 (spacious, layout_mode=0)
- DS:0x6318 = 17 (compact, layout_mode=1)

**Button Y formula**: `y = row_height * row_index + start_y` (verified from multipliers at 0x3D266/0x3D2CC/0x3D30B etc.)

**Controls in order** (call sequence in main_menu):

| Row | Y (large) | Y (small) | Label | Type | Width |
|:---:|:---------:|:---------:|-------|------|:-----:|
| 0 | 15 | 5 | "~Start" | button (add_button) | 80 (explicit) |
| 1 | 40 | 22 | "~Players:" | spinner (add_spinner) | auto |
| 2 | 65 | 39 | "~Rounds:" | spinner (add_spinner) | auto |
| 3 | 90 | 56 | "S~ound..." | button | auto |
| 4 | 115 | 73 | "~Hardware..." | button | auto |
| 5 | 140 | 90 | "~Economics..." | button | auto |
| 6 | 165 | 107 | "Ph~ysics..." | button | auto |
| 7 | 190 | 124 | "~Landscape..." | button | auto |
| 8 | 215 | 141 | "Play Op~tions..." | button | auto |
| 9 | 240 | 158 | "~Weapons..." | button | auto |
| 10 | 265 | 175 | "Save ~Changes" | button | auto |

**Left panel width (terrain frame x-origin)**:
- Loop at 0x3D4D0: finds `max_right = max(control.field_0x4C)` = BTN_W-1 = 79 (largest button right edge, 0-indexed)
- At 0x3D51C: `terrain_frame_x = dialog.x0 + max_right + BTN_X = BTN_X + 79 + BTN_X = 2×BTN_X + BTN_W - 1`
- Large mode: 2×12+80-1 = **103**; Small mode: 2×5+80-1 = **89**

**Terrain frame** (draw_flat_box at 0x3D593):
- x1 = terrain_frame_x = 2×BTN_X+BTN_W-1
- y1 = 6
- x2 = FG_MAXX - 6
- y2 = FG_MAXY - 36 (normal) or FG_MAXY - 50 (compact: copyright text too wide for right panel)

**Outer frame** (draw_3d_box at 0x3D56A): spans (0, 0, FG_MAXX, FG_MAXY) with fill = EF28 = VGA 151 = light gray (45,45,45)

**Doc correction**: REVERSE_ENGINEERING.md terrain frame args previously said `(menu_right+1, 6, screen_height-37, screen_width-6)` — corrected to `(menu_right, 6, FG_MAXX-6, FG_MAXY-36)` (x2 was 1 off; removed off-by-1 FG_MAXX/screen_width confusion).

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| BTN_X (large mode) | 12 | `getBtnX()=12` | ✓ |
| BTN_X (small mode) | 5 | `getBtnX()=5` | ✓ |
| BTN_W (Start button) | 80 | `BTN_W=80` | ✓ |
| start_y (large) | 15 | `getStartY()=15` | ✓ |
| start_y (small) | 5 | `getStartY()=5` | ✓ |
| Row height (large) | 25 | `getRowH()=25` | ✓ |
| Row height (small) | 17 | `getRowH()=17` | ✓ |
| Terrain frame x1 | 2×BTN_X+BTN_W-1 | `getRightX()=2*getBtnX()+BTN_W-1` | ✓ (fixed session 106) |
| Terrain frame y1 | 6 | 6 | ✓ |
| Terrain frame x2 | FG_MAXX-6 | `FG_MAXX-6` | ✓ |
| Terrain frame y2 | FG_MAXY-36 | `FG_MAXY-36` | ✓ |
| ~Players:, ~Rounds: | spinner controls | spinner UI | ✓ |
| Save ~Changes | button at row 10 | button present | ✓ |

---

## Section 49 — Main Menu Title Area Text Colors

**Source**: `main_menu_right_panel` (file 0x3D59B), `draw_embossed_text` (file 0x4CEFD = 0x4589:0x0C6D)

### draw_embossed_text (0x4589:0x0C6D = file 0x4CEFD)
Draws text 5 times at successive diagonal offsets, each in a progressively brighter color, creating a 3D shadow effect. Signature: `draw_embossed_text(int x, int y, char far* str)`.

| Layer | Offset | Color var | VGA idx | RGB | Role |
|:-----:|:------:|-----------|:-------:|-----|------|
| 1 | (0,0) | EF2C | 152 | (0,0,0) | Deep shadow |
| 2 | (+1,+1) | EF32 | 156 | (15,15,15) | Dark shadow |
| 3 | (+2,+2) | EF24 | 153 | (30,30,30) | Dim mid |
| 4 | (+3,+3) | EF2A | 151 | (45,45,45) | Light mid |
| 5 | (+4,+4) | EF26 | 155 | (63,63,63) | White surface |

After return: DS:6E2A = EF26 = WHITE (last store_sky_base_index call).

### Title area text elements

| Element | String | Source | Color | Y (small/large) | Threshold |
|---------|--------|--------|-------|:---------------:|-----------|
| Game title | "Scorched Earth" | DS:0x269B via [DS:0x206C/0x206E] | Embossed (5-layer) | 2 / 11 | FG_MAXY < 200 |
| Subtitle | "The Mother of All Games" | DS:0x26AA via [DS:0x2070/0x2072] | EF26 = WHITE (inherited) | 27 / 41 | FG_MAXY < 210 |
| Edition | "Registered Version" | DS:0x63FD | EF26 = WHITE (inherited) | 52 / 71 | FG_MAXY < 210 |
| Copyright (wide) | "Copyright (c) 1991-1995 Wendell Hicken" | DS:0x6415 | EF2C = BLACK | FG_MAXY−20 | fits in panel |
| Copyright line 1 (narrow) | "Copyright (c) 1991-1995" | DS:0x643C | EF2C = BLACK | FG_MAXY−33 | too wide |
| Copyright line 2 (narrow) | "Wendell Hicken" | DS:0x6454 | EF2C = BLACK | FG_MAXY−20 | too wide |
| Version | "Version 1.50" | sprintf DS:0x6463+DS:0x31DD+DS:0x6469 | EF2C = BLACK | copyright_y−13 | — |

Color switch: `store_sky_base_index(EF2C)` at file 0x3D786 — copyright and version use BLACK. No color switch between title and subtitle/registered — they inherit EF26=WHITE from last emboss layer.

X-centering formula (all elements): `x = (FG_MAXX - right_panel_x - textWidth) / 2 + right_panel_x`
Title special: EXE uses `embossCenterW = textWidth×2 + 4` as the "width" for centering (the `add ax,ax; add ax,4` at 0x3D6CF); web uses same formula.

Copyright wide/narrow check (0x3D7C0): `FG_MAXX - right_panel_x - 10 >= textWidth` → single line; else → two lines.

| Check | EXE | Web | Match |
|-------|-----|-----|-------|
| draw_embossed_text layer colors | EF2C→EF32→EF24→EF2A→EF26 | UI_DEEP_SHADOW→UI_BRIGHT_BORDER→UI_DARK_TEXT→UI_LIGHT_ACCENT→UI_DARK_BORDER | ✓ |
| Subtitle color | EF26 = WHITE (inherited) | UI_DARK_BORDER = EF26 | ✓ |
| "Registered Version" color | EF26 = WHITE (inherited) | UI_DARK_BORDER = EF26 | ✓ |
| Copyright/Version color | EF2C = BLACK | UI_DEEP_SHADOW = EF2C | ✓ |
| Title Y (small/large) | 2 / 11 (threshold FG_MAXY<200) | `isSmallMode()?2:11` | ✓ |
| Subtitle Y (small/large) | 27 / 41 (threshold FG_MAXY<210) | `isSmallMode()?27:41` (threshold ≤200) | ✓ (standard resolutions only) |
| Registered Y (small/large) | 52 / 71 (threshold FG_MAXY<210) | `isSmallMode()?52:71` (threshold ≤200) | ✓ (standard resolutions only) |
| Copyright Y | FG_MAXY−20 = screenH−21 | `screenH−21` | ✓ |
| Version Y | copyright_y−13 | `copyrightY−13` | ✓ |
| Version string | sprintf("%s %s","Version","1.50") | "Version 1.50" | ✓ |

---

## Section 50 — Player Setup Screen Layout

**Source**: `end_of_round_scoring` (file 0x33FC3 = 2CBF:09D3), `reassign_players` (file 0x357B0 = 2CBF:21C0), `add_widget_type9` (file 0x483F2 = 0x3F19:0x2862)

### Key Finding: EXE Has No Pre-Game Player Setup Screen

The EXE game flow is:

```
main_menu (0x3D140)
  → equip_init (0x2B471)  [allocate player structs, load configs]
  → terrain_gen            [generate landscape]
  → game_round_loop (0x2A9FE)
  → end_of_round_scoring (0x33FC3)  [player name/type editing happens HERE]
  → repeat
```

There is no player setup dialog before the first round. Player names and AI types are configured **between rounds** via `end_of_round_scoring`, or during the game via the F9 system menu → "Reassign Players".

### Player Name/Type Editing: end_of_round_scoring (file 0x33FC3)

Between-rounds dialog uses widget type 9 (text input field). Three type-9 widgets per player row:

| Call | Widget param | Callback | Purpose |
|------|:------------:|----------|---------|
| 1st  | 9  | 0x2CC4:0x0927 = file 0x33F67 | Computer/Person toggle; toggles DS:0x6022 (0=Person, 1=Computer) |
| 2nd  | 32 | stub (returns 1) | Player name text input (max 32 chars) |
| 3rd  | 13 | stub (returns 1) | Additional field (col width or aux data) |

Dialog tabs: "~Players" (per-player name/type) and "~Teams".

**Per-player callback** (file 0x352B7 = 2CBF:1CC7):
- Loads player index from arg
- Computes `tank_ptr = DS:0xD568 + player_idx × 0xCA` (tank struct stride = 0xCA)
- Copies player name from `[tank+0xB6/+0xB8]` (far ptr to name string) into local buffer
- Calls `0x3F19:0x5260` to populate dialog with player data

### Player Name/Type Editing: Reassign Players (file 0x357B0 = 2CBF:21C0)

Called from the F9 system menu. Shows one button per player (labeled "~1"…"~N"). Clicking opens a per-player name edit flow using the same dialog infrastructure.

### Widget Type 9 Internal Structure (add_widget_type9 at file 0x483F2)

Allocates 90-byte (0x5A) widget struct:

| Offset | Size | Value | Meaning |
|--------|------|-------|---------|
| 0x00 | word | 9 | Widget type = text input |
| 0x04/0x06 | far ptr | 0x3F19:0x17D0 | Default-text callback (stub; returns AX=1) |
| 0x0C | word | param | Max chars or column param (9 / 32 / 13) |
| 0x0E | word | group | Parent widget index (tab group) |
| 0x48 | word | 1 | Flags |
| 0x4A | word | 1 | Flags |
| 0x4C | word | 0 | Flags |
| 0x4E | word | 0 | Flags |
| 0x52/0x54 | far ptr | callback | On-change / on-toggle callback |

### No Color Selector

No color selector widget was found in player setup dialogs. Player colors are assigned via the VGA palette at startup (player i = VGA base index i×8), not interactively chosen.

### Web Port Comparison

| Feature | EXE | Web port | Match |
|---------|-----|----------|-------|
| Pre-game player setup screen | NOT PRESENT | Present (dedicated screen) | Enhancement |
| Player name editing location | Between-rounds dialog + F9 menu | Pre-game screen + Scoreboard | Intentional difference |
| Name input field (chars) | param=32 (max 32 chars) | 12-char display width | Acceptable (names fit) |
| Computer/Person toggle | DS:0x6022 toggle callback | Type cycling via L/R keys | Equivalent |
| Color selector | Not in setup dialog | Not in setup screen | ✓ |
| Tab key navigation | Handled by widget system | `handlePlayerSetupInput()` Tab key | ✓ |
| Blinking cursor | Widget system (DS:6E2A text draw) | Implemented in `drawPlayerSetupScreen()` | ✓ |

**Verdict**: The web port's pre-game player setup screen is an intentional UX enhancement. The EXE only permits name/type changes between rounds or via F9 during play. No discrepancy requiring a fix.

---

## Section 51 — Config Submenu Items: Labels, Order, Row Height (session 118)

**Source**: Item label pointer table DS:0x2158–0x21E8 (37 entries × 4 bytes); submenu callback at file 0x3BA7F (34ED:01AF); row height at 0x3BA92.

### Submenu Structure

**37 total items** stored in a global label far-pointer table starting at DS:0x2158. Button params (from `main_menu` add_button calls at 0x3D2E7–0x3D48B):

| Param | Button label | Items | First label DS offset |
|-------|-------------|-------|----------------------|
| 0 | S~ound... | 2 | DS:0x28AB |
| 1 | ~Hardware... | 6 | DS:0x28C3 |
| 2 | ~Economics... | 5 | DS:0x291F |
| 3 | Ph~ysics... | 8 | DS:0x299A |
| 4 | ~Landscape... | 4 | DS:0x296A |
| 5 | Play Op~tions... | 5 (inferred) | DS:0x2A07 |
| 6 | ~Weapons... | 7 (inferred) | DS:0x2A4B |

Note: String table stores Landscape items (DS:0x296A) *before* Physics items (DS:0x299A), but button dispatch uses param 3=Physics, param 4=Landscape. The item descriptor dispatch table maps params to items independently of string order.

### EXE Submenu Item Labels (all 37)

**Sound** (items 0–1):
1. `~Sound:` (DS:0x28AB)
2. `~Flight Sounds:` (DS:0x28B3)

**Hardware** (items 2–7):
1. `~Graphics Mode:` (DS:0x28C3)
2. `~Bios Keyboard` (DS:0x28D3)
3. `~Small Memory` (DS:0x28E2)
4. `~Mouse Enabled` (DS:0x28F0)
5. `~Firing Delay:` (DS:0x28FF)
6. `~Hardware Delay:` (DS:0x290E)

**Economics** (items 8–12):
1. `~Interest Rate:` (DS:0x291F)
2. `~Cash at Start:` (DS:0x292F)
3. `Computers ~Buy` (DS:0x293F) — values: Basic/Greedy/Erratic/Random (DS:0x2772–0x2787)
4. `~Free Market` (DS:0x294E)
5. `~Scoring Mode:` (DS:0x295B) — values: Standard/Corporate/Vicious (DS:0x27E0/27F1/27FB)

**Landscape** (items 13–16):
1. `~Bumpiness:` (DS:0x296A)
2. `S~lope:` (DS:0x2976)
3. `~Flatten Peaks` (DS:0x297E)
4. `~Random Land` (DS:0x298D)

**Physics** (items 17–24):
1. `~Air Viscosity:` (DS:0x299A)
2. `~Gravity:` (DS:0x29AA)
3. `~Borders Extend:` (DS:0x29B4)
4. `~Effect of Walls:` (DS:0x29C5) — values: None/Wrap-around/Padded/Rubber/Spring/Concrete/Random/Erratic
5. `~Suspend Dirt:` (DS:0x29D7)
6. `~Sky:` (DS:0x29E6)
7. `~Max. Wind:` (DS:0x29EC)
8. `~Changing Wind` (DS:0x29F8)

**Play Options** (items 25–29, inferred from semantic grouping):
1. `Ta~lking Tanks:` (DS:0x2A07)
2. `~Attack File:` (DS:0x2A17) — DOS path to .WAV for attack sound
3. `~Die File:` (DS:0x2A25) — DOS path to .WAV for death sound
4. `Tanks ~Fall` (DS:0x2A30)
5. `~Impact Damage` (DS:0x2A3C)

**Weapons** (items 30–36, inferred from semantic grouping + web port confirmation):
1. `~Arms Level:` (DS:0x2A4B)
2. `~Bomb Icon:` (DS:0x2A58)
3. `~Tunneling` (DS:0x2A64)
4. `~Scale:` (DS:0x2A6F)
5. `Trace ~Paths` (DS:0x2A77)
6. `~Extra Dirt` (DS:0x2A84)
7. `~Useless Items` (DS:0x2A90)

### Row Height

EXE submenu callback (file 0x3BA7F = 34ED:01AF):
- `mov word [bp-0x0A], 0x000F` at 0x3BA92 — **unconditionally 15** for all screen sizes
- No hi-res branch modifies row_height
- Items render at y = 5, 20, 35, 50 … (n×15+5)

Web: `getSubRowH()` returns 15 (lo-res) or **19** (screenH≥400) — intentional 4px hi-res enhancement.

### Web Port Discrepancies

| Submenu | EXE items | Web items | Discrepancy |
|---------|-----------|-----------|-------------|
| Sound | 2 (exact match) | 2 | ✓ |
| Hardware | 6 | 9 | Web adds 3 non-EXE items: "Falling ~Delay:", "~Calibrate Joystick", "~Fast Computers" |
| Economics | 5 (exact match) | 5 | ✓ |
| Landscape | 4 | 6 | Web adds "Land ~Type:" (first!) and "~Percent Scanned Mountains:" — neither in EXE |
| Physics | 8 (exact match) | 8 | ✓ |
| Play Options | 5 | 16 | Web replaces ~Attack File:/~Die File: with "Talk ~Probability:"; adds Weapons items + ~Mode:, Play ~Order:, ~Teams:, ~Hostile Environment, Status ~Bar |
| Weapons | 7 (exact match) | 7 | ✓ |
| Row height | 15 always | 15/19 | Web uses 19 for hi-res (intentional) |

**Non-EXE strings in web Hardware submenu**: "Falling ~Delay:", "~Calibrate Joystick", "~Fast Computers" — confirmed absent from EXE binary (full string scan returned 0 results).

**Non-EXE strings in web Landscape submenu**: "Land ~Type:", "~Percent Scanned Mountains:" — confirmed absent from EXE binary.

**Play Options note**: EXE items `~Attack File:` and `~Die File:` are file-path text inputs (DOS .WAV filenames for talking tanks), not spinners. Web replaces these with a `Talk ~Probability:` spinner — intentional web adaptation. The remaining Play Options extras (~Arms Level: through ~Useless Items, plus ~Mode:/Play ~Order:/~Teams:/~Hostile Environment/Status ~Bar) are all web-only additions.

---

## Section 52 — System Menu (F9) Rendering

**EXE**: `system_menu_display` at file 0x3F4F8 (34ED:3C28). Accessed via F9 during game play.

### Dialog Structure

- Title: "System Menu" (DS:0x2B22), set via `0x3F19:0x2577` (set_dialog_title)
- Dialog alloc: `0x3F19:0x00E2` with (0,0,0,0) → auto-sized, centered on screen
- Dialog callback: 3891:0145 (file 0x3F455)
- Button callback: all buttons share 3891:00BA (file 0x3F3CA) → jump table dispatch
- Jump table: at 3891:0135 (file 0x3F445), 8 cases (0–7)

### Row Height

- **EXE**: `FG_MAXY > 200` → SI = 24; else SI = 20
- Button y = SI × row_num + 5 (row_num = 1..4 for each column)
- **Web**: `screenH >= 400` → rowH = 19; else rowH = 14
- **Discrepancy**: EXE uses 20/24; web uses 14/19 (minor visual difference)

### Layout — TWO-COLUMN

EXE uses two side-by-side button columns. Web uses a single-column list.

**Left column** (x = 0x0A = 10px):
| Row | Label (EXE string) | DS offset | Jump case | Handler |
|-----|-------------------|-----------|-----------|---------|
| 1 | `~Clear Screen` | DS:0x2B2E | case 0 | file 0x3F405 → 0x3FAA5 (clears terrain debris) |
| 2 | `~Mass Kill` | DS:0x2B3C | case 1 | file 0x3F40C → 0x3F8D6 (confirm + kill all) |
| 3 | `Reassign ~Players` | DS:0x2B63 | case 3 | file 0x3F41A → far reassign_players 0x357B0 |
| 4 | `Reassign ~Teams` | DS:0x2B75 | case 7 | file 0x3F436 → far 0x3A4C:0x0646 |
| 5 | `~Sound:` *(spinner)* | DS:0x28AB | — | `0x3F19:0x2F39`; initial value = SOUND_DEVICE (DS:0xEF46) |

Row 5 is a **sound device spinner** (different widget type via 0x3F19:0x2F39), not a button. On dialog close, selected value is stored back to DS:0xEF46 (0x3F816).

**Right column** (x = DI = max_left_width + 0x0A):
| Row | Label (EXE string) | DS offset | Jump case | Handler |
|-----|-------------------|-----------|-----------|---------|
| 1 | `Save ~Game` | DS:0x2B85 | case 5 | file 0x3F428 → far 0x300B:0x04AB |
| 2 | `~Restore Game` | DS:0x2B90 | case 6 | file 0x3F42F → far 0x300B:0x0686 |
| 3 | `~New Game` | DS:0x2B9E | case 4 | file 0x3F421 → 0x3F89C (confirm + restart) |
| 4 | `~Quit Game` | DS:0x2B47 | case 2 | file 0x3F413 → 0x3F871 (confirm + quit) |

### Confirmation Dialog (file 0x3F93B)

All confirmations use a shared confirm_dialog function. Sizes dialog to fit message + ~Yes/~No buttons.

| Action | Confirmation text | DS offset |
|--------|------------------|-----------|
| Quit Game | "Do you want to quit?" | DS:0x2BC9 (via DS:0x2258/0x225A) |
| New Game | "Do you really want to restart the game?" | DS:0x2BDE (via DS:0x225C/0x225E) |
| Mass Kill | "Mass kill everyone?" | DS:0x2C06 (via DS:0x2260/0x2262) |

Yes button: "~Yes" (DS:0x2BC0 via DS:0x2250/0x2252)
No button: "~No" (DS:0x2BC5 via DS:0x2254/0x2256)

Note: "Do you want to retreat?" (DS:0x2BA8) exists in the binary but is **NOT** used in the system menu. It appears in the data pointer table at DS:0x224C but is not referenced by any system menu button.

### Web Port Discrepancies

| Feature | EXE | Web | Verdict |
|---------|-----|-----|---------|
| Layout | Two-column (5 left + 4 right) | Single column (8 items) | Structural simplification — intentional |
| Sound device spinner | Yes (left col row 5, "~Sound:") | No | Missing — web has no sound device selection |
| Row height | 20 (lo-res) / 24 (hi-res) | 14 / 19 | Minor visual discrepancy |
| Item labels | See table above | All 8 labels match | ✓ |
| Confirmation strings | "Do you want to quit?", "Do you really want to restart the game?", "Mass kill everyone?" | Same | ✓ |
| Yes/No text | "~Yes", "~No" | "Y: Yes  N: No" prompt | Web keyboard-only adaptation |

**Web item order** (single column): Clear Screen, Mass Kill, Quit Game, Reassign Players, Reassign Teams, Save Game, Restore Game, New Game.
**EXE item order** (two-column): left col top-down Clear/Kill/Players/Teams/Sound; right col top-down Save/Restore/New/Quit.

No critical bugs in web port SYSTEM_MENU_OPTIONS — all action labels and confirmation strings match EXE. The single-column layout and missing Sound spinner are intentional simplifications appropriate for a browser port.
