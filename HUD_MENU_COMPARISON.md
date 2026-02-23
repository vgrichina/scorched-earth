# HUD / Menu / Shop — EXE vs Web Pixel Comparison

Detailed audit of all rendering differences between SCORCH.EXE v1.50 and the web port.
Each item lists what the EXE does (from disasm), what the web does, and severity.

---

## 1. HUD — Full Mode Row 1

### ~~1a. Weapon Position~~ — **FIXED**
- **EXE**: Weapon text **left-aligned** at computed position `E9E0 = E9DE + 15`, where E9DE = wind_x + measureText("MMMMMMMMMMMMMMM") + 2. The weapon sits at a fixed column after the wind area.
- **Web**: ~~Weapon text **right-aligned** to `screenWidth - LEFT` (flush right edge).~~ Now: `wpnX = windX + measureText("MMMMMMMMMMMMMMM") + 2 + 15` matching EXE formula exactly.
- **Impact**: ~~Weapon name jumps to a completely different location. On a 640px screen the difference is ~200px.~~ Resolved.

### 1b. Wind Display String (APPROXIMATED)
- **EXE**: Renders pre-formatted string from player struct+0xB6 via `text_display(E9DC, HUD_Y, struct+0xB6)`. The format of this string is unknown (could include directional arrows, ">>>"/"<<<" style, or magnitude text).
- **Web**: Generates "No Wind" or "Wind: N" manually.
- **Impact**: Minor visual difference in wind indicator text. Functional equivalent but not pixel-identical.

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

### ~~4c. Left Panel Width~~ — **FIXED**
- **EXE**: Menu items at x=5/12 with 80px width → left panel ends at x=89/96 (small/large mode).
- **Web**: ~~`LEFT_W = 128px` (hardcoded)~~ Now: `getLeftW() = getBtnX() + BTN_W + 4` (89/96 per mode). Right panel `getRightX()` shifts ~33px left.
- **Impact**: Resolved — right panel now starts at correct position, terrain preview is wider.

### ~~4d. 3D Box Borders in Hi-Res~~ — **FIXED**
- **EXE**: `draw_3d_box` uses **3-pixel borders** when `[DS:0x6E28]==3` (hi-res mode, e.g., 640x480+).
- **Web**: `drawBox3DRaised/Sunken` uses `config.screenHeight >= 400 ? 3 : 2` — matches EXE exactly.
- **Impact**: Resolved.

### ~~4e. Terrain Preview Frame Height~~ — **FIXED**
- **EXE**: Height = `screen_height - 37`, reduced to `screen_height - 51` if copyright text width exceeds the available right panel width.
- **Web**: ~~`getFrameH() = getScreenH() - 37 - 6`~~ Now: `getScreenH() - 37`, matching EXE normal case. Copyright overflow reduction not implemented (minor edge case).
- **Impact**: Frame is now 6px taller, matching EXE.

### 4f. Embossed Title Position
- **EXE**: Title rendered with 5-layer emboss. Position computed based on right panel dimensions. Exact X calculation involves the right panel center.
- **Web**: `titleX = centerXRight(titleStr) - 2` — reasonable but the `-2` is a manual fudge for the emboss offset. Not derived from EXE math.
- **Impact**: Title may be a few pixels off-center.

---

## 5. Menu — Submenu Dialogs

### 5a. Dialog Dimensions (HARDCODED vs COMPUTED)
- **EXE**: Dialog system creates properly-sized dialogs with the widget engine at seg 0x3F19. Dialog has title bar, separator, scrollable items, close button — all managed by the widget library.
- **Web**: `dlgW = 220` (hardcoded), `dlgH = 30 + itemCount * 14` (computed). Simple box with text.
- **Impact**: Dialog may be wider/narrower than EXE at various resolutions.

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
- **Remaining gap**: Miscellaneous sub-categories not implemented (all misc shown flat). No real scrollbar widget (uses simple vline indicator).

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

### 7a. Extended Character Set (MISSING)
- **EXE**: 161 glyphs — ASCII 0x20-0x7E (95 printable) + CP437 extended 0x80-0xFF (66 accented Latin, Greek, math symbols).
- **Web**: 95 glyphs — ASCII 32-126 only.
- **Impact**: Extended characters render as empty. Not critical for English, but affects display if config/player names use CP437 chars.

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

## Priority Summary

| Priority | Issue | Effort |
|----------|-------|--------|
| ~~**HIGH**~~ | ~~Shop fundamentally different (6a)~~ | **MOSTLY FIXED** — sell dialog, palette anim, mouse clicks added |
| ~~**HIGH**~~ | ~~Sunken box bevel order (9a)~~ | **FIXED** |
| ~~**HIGH**~~ | ~~Full Row 2 widgets missing (2a)~~ | **PARTIALLY FIXED** (positions correct; icons still bars) |
| ~~**HIGH**~~ | ~~UI palette RGB wrong (8a)~~ | **FIXED** (extracted from fg_setrgb calls) |
| ~~**MEDIUM**~~ | ~~Weapon position in full Row 1 (1a)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Menu button X margin (4a)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Button width (4b)~~ | **FIXED** (BTN_W=80) |
| ~~**MEDIUM**~~ | ~~Left panel width (4c)~~ | **FIXED** (dynamic, getBtnX+80+4) |
| ~~**MEDIUM**~~ | ~~3px borders in hi-res (4d)~~ | **FIXED** (was already in code) |
| ~~**MEDIUM**~~ | ~~Frame height (4e)~~ | **FIXED** (SH-37, removed extra -6) |
| ~~**MEDIUM**~~ | ~~Dialog spacing (5b)~~ | **FIXED** (19px at ≥400px) |
| ~~**MEDIUM**~~ | ~~Player icons simplified (3a)~~ | **MOSTLY FIXED** — bitmap icon 0 used |
| ~~**MEDIUM**~~ | ~~Shop highlight color (6b)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Quote char zero-width (7b)~~ | **FIXED** |
| ~~**MEDIUM**~~ | ~~Angle label colon (1c)~~ | **FIXED** |
| **LOW** | Wind string format unknown (1b) | Unknown — need struct+0xB6 analysis |
| ~~**LOW**~~ | ~~Energy bar in Row 2 (2b)~~ | **RESOLVED** (no bar, text only matches EXE) |
| ~~**LOW**~~ | ~~Privacy guard (6e)~~ | **FIXED** |
| **LOW** | Extended font chars (7a) | Medium — extract CP437 glyphs |
| ~~n/a~~ | ~~Shop cash label (6d)~~ | **FIXED** ("Cash Left:") |
| ~~n/a~~ | ~~Shop items per page (6f)~~ | **FIXED** (dynamic, up to 15) |
| ~~**LOW**~~ | ~~Shop sell dialog (6a partial)~~ | **FIXED** — "Sell Equipment" sub-dialog with quantity/offer/Accept/Reject |
| ~~**HIGH**~~ | ~~Raised box bevel order (9b)~~ | **FIXED** (caused by palette fix, now correct) |
| **LOW** | Spinner text right-align bug | **FIXED** (bx+BTN_W instead of BTN_W) |
| **INFO** | Row 2 wind text added (3b) | Intentional divergence |
| **INFO** | HUD clear area smaller (noted in code) | Intentional divergence |
