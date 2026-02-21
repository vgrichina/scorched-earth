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

### 1c. Angle Label Spacing (MINOR)
- **EXE**: Angle value X = angle_label_x + measureText("Angle") + 8. The "Angle:" label has its colon measured separately; +8 is added AFTER the label text without colon.
- **Web**: `x += measureText('Angle') + 8` — close match, but the code draws "Angle:" (with colon), so the colon occupies extra pixels beyond the +8 gap.
- **Impact**: ~3px shift in angle value position.

---

## 2. HUD — Full Mode Row 2

### 2a. Widget System (SIMPLIFIED — largest gap)
- **EXE**: 7 distinct inventory widgets, each with its own rendering function:
  | Widget | File | Display | Bar Width |
  |--------|------|---------|-----------|
  | 1 | 0x318D8 | Tank icon + fuel % (with scale animation) | 48px |
  | 2 | 0x3DE9B | Inventory bar + count | 25px |
  | 3 | 0x3DE5E | Defense icon + bar (Parachute) | 25px |
  | 4 | 0x3DB30 | Item name + percentage bar | 31px |
  | 5 | 0x3DC94 | Shield selector + bar | 18px |
  | 6 | 0x3DD59 | Item icon + bar (Super Mag) | 34px |
  | 7 | 0x3DD95 | Conditional display (flag-based) | 33px |

  Each widget: clears sub-area → draws icon → draws fill bar → formats value. Color = `count > 0 ? [EF22] : [EF24]`.

- **Web**: Text-only approximation:
  ```
  [Energy bar + %] [Shd:NNN] [B:n] [P:n] [L:n] [weapon name]
  ```
  No icons. No per-widget bars. Only 3 inventory items shown (batteries, parachutes, lasers) vs. 7 widget slots. Shield shown as text not bar.

- **Impact**: Row 2 in full mode looks fundamentally different. Missing tank icon, item bars, fill animations.

### 2b. Energy Bar Width (MINOR)
- **EXE**: Widget 1 bar is 48px (0x30).
- **Web**: `energyBarW = Math.min(40, barWidth)` — typically 40px or less.
- **Impact**: Bar is ~8px narrower than EXE.

---

## 3. HUD — Basic Mode (320x200)

### 3a. Player Icons (SIMPLIFIED)
- **EXE**: Icon bitmap data at DS:0x3826, stride 125 bytes, 48 icons. Each icon has `pattern_type(1B), width(1B), height(1B), pixel_data(122B)`. Rendered via `draw_icon_alive` (filled), `draw_icon_dead` (outline), `draw_icon_blank` (erase).
- **Web**: Simple rectangles: alive = `fillRect(ix, HUD_Y+3, ix+4, HUD_Y+7)` (5x5 filled), dead = 4 edge lines (5x5 outline).
- **Impact**: Original icons are likely detailed tank silhouettes; web shows plain squares.

### 3b. Row 2 Wind Text (INTENTIONAL ADDITION)
- **EXE**: Basic mode Row 2 does NOT display wind. Only shows: name + energy bar + "Angle:" + angle bar.
- **Web**: Adds "W:N" text after the angle bar when space permits. Code comment: "not in EXE basic mode, added for gameplay usability."
- **Impact**: Extra element not in original. Acceptable deviation for playability.

---

## 4. Menu — Main Config Screen

### 4a. Button X Margin (OFF BY 1-8px)
- **EXE** (from decoded menu init at 0x3D140):
  - Small mode (≤200px): start_x = 5, start_y = 5
  - Large mode (>200px): start_x = 12, start_y = 15
  - Also sets DS:0xECD4 = 4/5, DS:0xECD6 = 0/4 (button text padding)
- **Web**: `BTN_X = 4` (fixed), `getStartY() = isSmallMode() ? 5 : 15`.
- **Impact**: Buttons shifted 1px left in small mode, 8px left in large mode. Y is correct.

### 4b. Button Width (UNVERIFIED)
- **EXE**: add_item_list parameter 0x50 = 80px button width. But this is the dialog widget item width, and actual rendered button width may include dialog padding.
- **Web**: `BTN_W = LEFT_W - 8 = 120px`.
- **Impact**: Buttons may be ~40px wider in web port. Need to verify how the dialog system expands widgets.

### 4c. Left Panel Width
- **EXE**: Menu items rendered via dialog widget system. Left panel boundary is implicit from button positioning. Item list at width 0x50 starting at x=5/12.
- **Web**: `LEFT_W = 128px` (hardcoded), which determines where the right panel begins.
- **Impact**: If the EXE's left panel is narrower (~85-92px = start_x + item_width), the right panel in the web port is shifted ~36-43px to the right.

### 4d. 3D Box Borders in Hi-Res (MISSING)
- **EXE**: `draw_3d_box` uses **3-pixel borders** when `[DS:0x6E28]==3` (hi-res mode, e.g., 640x480+).
- **Web**: Always uses 2-pixel borders regardless of resolution.
- **Impact**: At 640x480, box edges are 1px thinner than EXE. Subtle but affects all menu elements.

### 4e. Terrain Preview Frame Height (MINOR)
- **EXE**: Height = `screen_height - 37`, reduced to `screen_height - 51` if copyright text width exceeds the available right panel width.
- **Web**: Fixed `getFrameH() = getScreenH() - 37 - 6`. No copyright width check.
- **Impact**: Frame may be 14px too tall in edge cases where copyright overflows.

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

### 5b. Dialog Item Spacing
- **EXE**: Item spacing varies by resolution (adds 5px extra at screenH ≥ 400px, per shop analysis).
- **Web**: Fixed 14px item spacing regardless of resolution.
- **Impact**: At high resolutions items may be packed too tightly.

---

## 6. Shop Screen

### 6a. Layout Architecture (FUNDAMENTALLY DIFFERENT)
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

- **Web**: Flat black background. 4 text categories at top. 10 visible rows. No 3D elements. No scrollbar. No sell dialog. No animation.
- **Impact**: Shop is the most visually divergent screen. Barely resembles the EXE.

### 6b. Selection Highlight Color (WRONG SHADE)
- **EXE**: Selection highlight = player_color + 4 (lighter shade, palette slot 4 relative to player base = slot 8 effectively? Or player_struct+0x1A + 4).
- **Web**: `player.index * PLAYER_PALETTE_STRIDE + 1` (slot 1 = darkest gradient shade).
- **Impact**: Selection bar is very dark instead of a bright player-colored highlight.

### 6c. Tab Structure (DIFFERENT CATEGORIES)
- **EXE**: 3 main tabs: "Score" (view scores), "Weapons" (buy projectiles), "Miscellaneous" (all non-weapon items grouped by sub-category), plus "~Done" button.
- **Web**: 4 flat categories: "Weapons", "Guidance", "Defense", "Accessories".
- **Impact**: Different navigation structure. "Score" tab missing entirely.

### 6d. Cash Label
- **EXE**: "Cash Left:" (DS:0x22F8 at file 0x58B5D), plus "Earned interest" (DS:0x235C) shown between rounds.
- **Web**: "Cash: $N" with no interest display.
- **Impact**: Different wording, missing interest feedback.

### 6e. Privacy Guard (MISSING)
- **EXE**: "NO KIBITZING!!" screen (DS:0x231C) displayed between players in hotseat mode to prevent peeking at opponent's inventory.
- **Web**: No privacy guard. Next player sees previous player's shop.
- **Impact**: Hotseat fairness compromised.

### 6f. Item Count (HARDCODED)
- **EXE**: 14-15 visible rows, increases with resolution.
- **Web**: Fixed 10 rows (`ITEMS_PER_PAGE = 10`).
- **Impact**: Shows fewer items on larger screens.

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

### 8a. UI Palette RGB Values (UNVERIFIED)
The web port sets these UI palette entries in `setupUIPalette()`:
| Palette | Web RGB (6-bit) | Purpose |
|---------|----------------|---------|
| 200 | (63,63,63) | UI_HIGHLIGHT |
| 201 | (20,20,20) | UI_DARK_TEXT |
| 202 | (32,32,32) | UI_DARK_BORDER |
| 203 | (48,48,48) | UI_BACKGROUND |
| 204 | (52,52,52) | UI_LIGHT_ACCENT |
| 205 | (8,8,8) | UI_DEEP_SHADOW |
| 206 | (63,63,63) | UI_LIGHT_BORDER |
| 207 | (24,24,24) | UI_MED_BORDER |
| 208 | (40,40,40) | UI_BRIGHT_BORDER |

These values have not been verified against the EXE's actual `fg_setcolor` calls. The EXE sets UI colors via indirect function pointers (`fg_setcolor` at DS:0xEF08) in the dialog init code. The actual RGB values need to be extracted from the dialog system initialization or from VGA DAC dumps.

**Known issue**: The web maps DS:0xEF22-0xEF32 to palette 200-208, but in the EXE these are **not palette indices** — they're variables holding the active drawing color. The EXE uses `fg_setcolor(color_variable)` then draws. The web treats them as fixed palette slots. This works functionally but means the web can't replicate the EXE's dynamic color switching (e.g., the HUD dynamically sets palette 163 to the player's RGB).

### 8b. HUD Player Color (WORKAROUND)
- **EXE**: Sets palette 163 (0xA3) to current player's RGB via `fg_setrgb(0xA3, R, G, B)` at file 0x3030E. All HUD text then draws in palette 163.
- **Web**: Uses `baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL` (palette slot 4 of the player's 8-slot block, e.g., palette 4 for player 0, palette 12 for player 1).
- **Impact**: Functionally equivalent — both resolve to the same RGB. The web approach is correct since player slot 4 = full base color = same RGB that the EXE writes to palette 163.

---

## 9. 3D Box Drawing

### 9a. Sunken Box Bevel Order (NEEDS VERIFICATION)
- **EXE draw_flat_box** (0x44630): Top=DS:0xEF30, Left=DS:0xEF32, Bottom=DS:0xEF26, Right=DS:0xEF2E.
- **Web drawBox3DSunken**: Takes `(medBorder, brightBorder, darkBorder, lightBorder)`. Called from `boxSunken()` with:
  ```javascript
  drawBox3DSunken(x, y, w, h, fill, UI_DARK_BORDER, UI_MED_BORDER, UI_LIGHT_BORDER, UI_BRIGHT_BORDER)
  ```
  Which maps to: Top=UI_DARK_BORDER(202), Left=UI_MED_BORDER(207), Bottom=UI_LIGHT_BORDER(206), Right=UI_BRIGHT_BORDER(208).

  Compared to EXE: Top=EF30(MED), Left=EF32(BRIGHT), Bottom=EF26(DARK), Right=EF2E(LIGHT).

  Web mapping: Top=DARK, Left=MED vs. EXE: Top=MED, Left=BRIGHT.

- **Impact**: The sunken box border colors appear in the wrong positions. The dark/light bevels are swapped between top/left and bottom/right edges, making sunken boxes look raised and vice versa at the inner border level.

---

## Priority Summary

| Priority | Issue | Effort |
|----------|-------|--------|
| **HIGH** | Shop is fundamentally different (6a) | Large — needs dialog system |
| **HIGH** | Sunken box bevel order may be wrong (9a) | Small — swap parameters |
| **HIGH** | Full Row 2 widgets missing (2a) | Large — needs icon extraction + 7 renderers |
| **MEDIUM** | Weapon position in full Row 1 (1a) | Small — change to left-align |
| **MEDIUM** | Menu button X margin off (4a) | Small — change BTN_X per mode |
| **MEDIUM** | 3px borders in hi-res (4d) | Medium — conditional in drawBox3D |
| **MEDIUM** | Player icons simplified (3a) | Medium — needs icon data extraction |
| **MEDIUM** | Shop highlight color wrong (6b) | Small — change slot 1 → slot 4+ |
| **MEDIUM** | Quote char zero-width (7b) | Small — fix WIDTHS[2] |
| **LOW** | Wind string format unknown (1b) | Unknown — need struct+0xB6 analysis |
| **LOW** | Energy bar 8px narrower (2b) | Trivial — change to 48 |
| **LOW** | Privacy guard missing (6e) | Medium — add "NO KIBITZING" screen |
| **LOW** | Extended font chars (7a) | Medium — extract CP437 glyphs |
| **LOW** | UI palette RGB unverified (8a) | Medium — need DAC dump from EXE |
| **INFO** | Row 2 wind text added (3b) | Intentional divergence |
| **INFO** | HUD clear area smaller (noted in code) | Intentional divergence |
