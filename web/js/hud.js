// Scorched Earth - HUD Display
// EXE source: play.cpp (seg 0x28B9, file base 0x2F830)
//
// EXE functions:
//   draw_hud()              — file 0x2FC84 (2910:0184) — main HUD draw (basic mode)
//   compute_hud_layout()    — file 0x2FBCA (2910:00CA) — basic mode X-position calc
//   compute_hud_layout_full — file 0x2FEBE (294B:000E) — full mode layout
//   draw_hud_full()         — file 0x301B2 (2950:02B2) — full mode draw
//   draw_player_icon()      — file 0x261D7 (1F7D:0007) — per-player icon (icons.cpp)
//   update_hud_row1()       — file 0x307E8 (29C0:01E8) — partial Row 1 redraw
//
// EXE mode flag DS:0x5142: 0 = basic (Row 1 only), nonzero = expanded (Row 1 + Row 2)
// Web port always draws expanded (both rows).
//
// EXE colors — ALL HUD text uses the player's color:
//   DS:0xEF22 = player color [EF22] — set to current player's base color before each draw
//   DS:0xEF24 = dim text [EF24] — depleted/zero-ammo items
//   DS:0xEF28 = UI_BACKGROUND [EF28] — HUD background fill (gray panel, palette 203)
//   DS:0xEF2C = deep shadow [EF2C] — bar interior fill
//   Palette 163 (0xA3) = DYNAMIC — fg_setrgb(0xA3, R, G, B) at file 0x3030E
//     sets palette 163 to current player's base color from tank sub-struct +0x1C/+0x1E/+0x20
//     Used for player name display at E9DC; effectively same as [EF22] = player color
//
// EXE Row 1 layout:
//   Basic mode: Name + multi-player power bar (6px columns) + player icons
//   Full mode:  Name + Power + Angle + PlayerName (struct+0xB6 name ptr) + Weapon
//
// EXE Row 2 layout (if [0x5142] != 0):
//   Basic mode: 'Max:' + multi-player health bar + 'Shields:' + multi-player shield bar
//   Full mode:  Name + 7 inventory widgets (fuel, items, shields, ammo bars)
//
// EXE draw_player_icon (0x261D7): generic icon renderer (both tank + weapon icons)
//   Icon data: DS:0x3826, stride 125 bytes (max 48 icons)
//   Per icon: x_offset(1B), y_offset(1B), row_width(1B), signed samples ending at -99
//
// EXE draw_hud_full Row 2 widget call sequence (7 widgets):
//   Widget 1: 0x2A16:0xD78 (file 0x318D8) — tank icon + fuel %
//   Widget 2: 0x3713:0x36B (file 0x3DE9B) — inventory bar + count
//   Widget 3: 0x3713:0x32E (file 0x3DE5E) — defense icon + bar
//   Widget 4: 0x3713:0x000 (file 0x3DB30) — item display + name + bar
//   Widget 5: 0x3713:0x164 (file 0x3DC94) — shield selector + bar
//   Widget 6: 0x3713:0x229 (file 0x3DD59) — item icon + bar
//   Widget 7: 0x3713:0x265 (file 0x3DD95) — conditional display
//   Each widget: clear sub-area, draw icon, display count, color by ammo>0

import { config } from './config.js';
import { hline, vline, fillRect, setPixel, getPixel, drawBox3DRaised, drawBox3DSunken } from './framebuffer.js';
import { setPaletteRgb, getPlayerColor } from './palette.js';
import { getEffectiveWallType } from './physics.js';
import { drawText, measureText } from './font.js';
import { WEAPONS, WPN } from './weapons.js';
import { players, getTankAim } from './tank.js';
import { PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         UI_DARK_TEXT, UI_DEEP_SHADOW, UI_BACKGROUND,
         UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER } from './constants.js';
import { PLAYFIELD_TOP } from './terrain.js';
import { SHIELD_CONFIG } from './shields.js';
import { prepareWindIndicator, windPixelVisible, resetWindIndicator } from './wind-indicator-state.js';
import { projectileDrawing } from './projectile-render.js';

// EXE DS:3826, 48 records of 125 bytes. Header: x offset, y offset,
// row width. Signed row-major samples end at -99; preserve shade values.
const ICONS = [
  {"x":2,"y":4,"w":7,"h":3,"px":[1,1,1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,0,0,0,0]},
  {"x":0,"y":3,"w":10,"h":5,"px":[1,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,0,1,1,1,1,0,0,0,0,0,0]},
  {"x":1,"y":3,"w":8,"h":5,"px":[1,0,0,0,1,1,1,0,1,1,1,1,1,1,1,8,1,1,1,1,1,1,1,8,1,1,1,1,1,1,1,8,1,0,0,0,1,1,1,0]},
  {"x":0,"y":3,"w":10,"h":5,"px":[1,1,1,0,0,1,1,8,8,0,0,1,1,1,1,1,1,8,8,8,0,1,1,1,1,1,1,8,8,8,0,1,1,1,1,1,1,8,8,8,1,1,1,0,0,1,1,8,8,0]},
  {"x":0,"y":2,"w":11,"h":8,"px":[1,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,1,0,0,0,0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0]},
  {"x":0,"y":0,"w":11,"h":11,"px":[0,9,0,0,0,0,0,0,0,10,0,9,9,9,0,0,0,0,0,10,10,10,0,9,0,0,0,0,0,0,0,10,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,8,8,8,0,0,0,0,0,0,0,8,8,8,8,8,0,0,0,0,0,0,0,8,8,8,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,11,0,0,0,0,0,0,0,12,0,11,11,11,0,0,0,0,0,12,12,12,0,11,0,0,0,0,0,0,0,12,0]},
  {"x":0,"y":0,"w":11,"h":11,"px":[0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,0,1,0,1,0,0,0,0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,0,0,0,1,0,0,0,1,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,8,0,0,0,8,0,8,8,8,0,8,8,8,0,8,8,8,0,8,0,0,0,8,0,0,0,8,0]},
  {"x":2,"y":1,"w":7,"h":9,"px":[0,3,3,3,3,3,0,3,3,3,3,3,3,3,3,3,0,3,0,3,3,3,3,0,3,0,3,3,0,3,3,3,3,3,0,0,0,3,0,3,0,0,0,0,3,3,3,0,0,0,0,0,0,0,0,0,0,0,3,3,3,0,0]},
  {"x":3,"y":2,"w":6,"h":8,"px":[0,0,2,0,0,0,0,0,0,2,0,0,0,2,0,2,0,0,0,2,0,8,2,0,2,2,8,2,8,8,8,3,8,8,2,8,8,8,3,3,8,8,0,8,8,8,0,0]},
  {"x":1,"y":1,"w":10,"h":10,"px":[0,0,0,2,2,0,0,0,0,0,0,0,0,0,8,3,0,0,0,0,0,0,2,0,2,8,0,0,2,0,0,2,2,0,2,3,0,2,2,0,0,2,8,0,0,8,0,8,2,0,0,3,8,2,2,8,8,8,2,0,2,8,3,3,8,8,3,3,8,2,2,8,3,8,8,3,8,8,8,2,8,3,8,3,8,8,8,8,3,8,0,8,8,8,3,8,8,3,8,0]},
  {"x":5,"y":5,"w":1,"h":1,"px":[1]},
  {"x":4,"y":4,"w":3,"h":3,"px":[0,1,0,1,1,1,0,1,0]},
  {"x":3,"y":3,"w":5,"h":6,"px":[0,16,15,0,0,17,0,0,19,0,18,0,15,18,0,19,0,16,17,0,15,0,0,0,0,0,16,17,18,19]},
  {"x":3,"y":1,"w":6,"h":8,"px":[15,19,18,17,0,0,0,0,0,0,16,0,0,17,16,0,0,15,18,0,0,15,0,19,19,0,16,19,0,18,15,0,17,18,0,17,16,0,0,0,0,16,0,17,18,19,15,0]},
  {"x":1,"y":1,"w":9,"h":10,"px":[0,0,16,15,19,18,0,0,0,0,17,0,0,0,0,17,0,0,18,0,0,18,17,0,0,16,0,19,0,19,0,0,16,0,15,0,15,0,15,0,17,15,0,19,0,16,0,16,0,18,19,0,18,0,17,0,17,0,0,0,0,17,0,18,0,0,18,19,15,16,0,0,0,19,0,0,0,0,0,0,16,0,0,15,16,17,18,19,15,0]},
  {"x":3,"y":1,"w":5,"h":9,"px":[0,0,0,0,6,0,0,0,6,0,0,0,0,6,6,0,6,6,6,0,6,0,6,6,6,0,6,6,0,6,0,0,0,6,0,0,0,0,6,6,0,0,0,0,6]},
  {"x":2,"y":0,"w":7,"h":11,"px":[0,0,0,0,0,6,6,0,0,0,0,6,6,6,0,0,0,6,0,6,0,0,0,0,6,6,0,6,0,6,6,6,0,6,6,6,0,6,6,6,0,6,0,6,6,0,6,0,6,0,0,0,6,0,6,0,0,0,0,6,6,0,6,0,0,0,0,6,6,6,0,0,0,0,0,6,6]},
  {"x":3,"y":3,"w":7,"h":7,"px":[0,0,6,0,6,0,0,0,6,0,6,6,6,0,6,6,6,6,0,6,6,6,0,6,0,6,6,6,6,6,6,0,6,0,6,0,6,0,6,6,6,0,0,0,6,6,6,0,0]},
  {"x":2,"y":2,"w":9,"h":9,"px":[0,0,0,6,6,6,0,0,0,0,0,6,6,0,0,6,0,0,6,6,6,0,6,6,6,6,0,6,0,6,6,6,0,6,6,6,0,6,0,6,0,6,6,0,6,6,6,6,6,0,6,0,6,6,0,6,0,0,6,6,6,6,0,0,0,6,6,6,0,6,0,0,0,0,0,0,6,6,0,0,0]},
  {"x":0,"y":0,"w":11,"h":11,"px":[-7,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,20,20,-7,-7,-7,-7,-7,-7,20,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,20,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7]},
  {"x":0,"y":0,"w":11,"h":11,"px":[-7,-7,20,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,20,-7,20,20,-7,-7,-7,-7,-7,-7,20,-7,20,20,-7,20,-7,-7,-7,-7,20,-7,-7,20,-7,20,-7,-7,-7,-7,-7,20,-7,20,-7,20,20,-7,-7,-7,-7,20,-7,20,-7,20,-7,-7,20,-7,-7,-7,-7,20,-7,20,-7,-7,20,20,-7,-7,-7,-7,-7,20,-7,-7,20,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7]},
  {"x":0,"y":0,"w":11,"h":11,"px":[-7,-7,20,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,20,-7,20,20,-7,20,20,-7,-7,-7,20,-7,20,20,-7,20,-7,-7,20,-7,20,-7,-7,20,-7,20,-7,-7,20,-7,-7,20,-7,20,-7,20,20,-7,20,20,-7,20,-7,20,-7,20,-7,-7,20,-7,-7,20,-7,20,-7,20,-7,-7,20,20,-7,-7,20,-7,-7,20,-7,-7,20,-7,-7,-7,20,-7,-7,20,-7,20,-7,-7,20,20,-7,-7,-7,20,-7,-7,-7,20,20,-7,-7,20,-7,-7,-7,-7,-7,20,-7,-7,20,-7,-7,20,-7]},
  {"x":0,"y":0,"w":11,"h":11,"px":[-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,20,20,20,20,20,20,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,20,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,-7,20,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,-7]},
  {"x":0,"y":0,"w":11,"h":11,"px":[-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,20,-7,-7,-7,-7,-7,20,-7,20,-7,20,-7,-7,-7,-7,-7,20,-7,-7,-7,20,-7,-7,-7,20,-7,20,-7,-7,-7,-7,-7,20,-7,20,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,20,20,20,-7,-7,-7,20,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,20,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,-7,20,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,-7,20,-7,-7]},
  {"x":0,"y":0,"w":11,"h":11,"px":[-7,-7,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,20,20,20,20,20,20,20,-7,20,-7,20,-7,20,-7,-7,-7,-7,-7,-7,-7,20,-7,-7,-7,20,-7,-7,-7,-7,-7,20,-7,20,-7,20,-7,20,-7,20,20,20,-7,-7,-7,20,-7,-7,-7,20,-7,-7,-7,-7,-7,20,20,-7,-7,-7,-7,20,-7,-7,-7,20,-7,20,20,-7,-7,-7,-7,20,-7,20,-7,-7,20,-7,20,-7,-7,20,-7,20,-7,-7,-7,20,-7,-7,20,-7,20,-7,-7,20,-7,20,20,-7,-7,-7,20,20,-7]},
  {"x":3,"y":3,"w":4,"h":4,"px":[0,7,7,0,7,7,7,7,7,7,7,7,0,7,7,0]},
  {"x":3,"y":3,"w":5,"h":5,"px":[0,7,7,7,0,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,0,7,7,7,0]},
  {"x":0,"y":3,"w":11,"h":7,"px":[0,0,0,0,7,7,7,0,0,0,0,0,0,0,7,7,7,7,7,0,0,0,0,0,7,7,7,7,7,7,7,0,0,0,0,7,7,7,7,7,7,7,0,0,0,0,7,7,7,7,7,7,7,0,0,0,0,0,7,7,7,7,7,0,0,0,0,0,0,0,7,7,7,0,0,0,0]},
  {"x":4,"y":3,"w":4,"h":5,"px":[0,7,0,0,0,7,7,0,7,7,7,7,7,7,7,7,0,7,7,0]},
  {"x":0,"y":1,"w":11,"h":8,"px":[7,7,0,7,7,7,0,7,0,7,7,7,0,7,0,7,0,7,7,7,0,7,0,7,0,7,7,7,0,7,7,7,0,0,0,7,7,7,7,7,0,7,0,0,0,0,0,7,0,7,0,7,0,0,0,0,0,0,0,7,0,7,0,0,0,0,0,0,0,0,7,7,0,0,0,0,0,0,0,0,0,0,7,0,0,0,0,0]},
  {"x":3,"y":1,"w":5,"h":7,"px":[0,0,1,0,0,1,0,0,0,1,0,0,1,0,0,1,1,0,1,1,0,0,1,0,0,1,0,0,0,1,0,0,1,0,0]},
  {"x":0,"y":0,"w":11,"h":10,"px":[0,0,0,1,1,1,1,1,0,0,0,0,0,1,1,1,1,1,1,1,0,0,0,1,-2,-2,1,1,1,-2,-2,1,0,1,-2,-2,-2,-2,1,-2,-2,-2,-2,1,1,-2,-2,-2,-2,1,-2,-2,-2,-2,1,1,1,1,1,1,-2,1,1,1,1,1,1,1,1,1,-2,-2,-2,1,1,1,1,0,1,1,-2,-2,-2,-2,-2,1,1,0,0,0,1,-2,-2,-2,-2,-2,1,0,0,0,0,0,1,1,1,1,1,0,0,0]},
  {"x":1,"y":3,"w":9,"h":5,"px":[0,0,0,0,8,0,0,1,1,0,8,0,0,8,0,0,1,1,19,8,18,17,8,16,15,1,1,0,8,0,0,8,0,0,1,1,0,0,0,0,8,0,0,1,1]},
  {"x":0,"y":1,"w":11,"h":10,"px":[1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,1,1,1,1,1]},
  {"x":0,"y":1,"w":11,"h":10,"px":[0,0,0,0,1,1,0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,1,0,1,1,0,0,0,0,0,0,1,1,1,0,1,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0]},
  {"x":0,"y":3,"w":11,"h":5,"px":[0,0,1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,1,0,1,1,1,1,1,1,1,1,1,1,1,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0]},
  {"x":3,"y":0,"w":5,"h":11,"px":[0,0,1,0,0,0,1,1,1,0,1,0,1,0,1,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,1,0,1,0,1,0,1,1,1,0,0,0,1,0,0]},
  {"x":0,"y":2,"w":11,"h":8,"px":[0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,1,0,0,1,0,0,0,0,1,1,0,0,1,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0]},
  {"x":0,"y":2,"w":11,"h":7,"px":[0,0,0,4,4,4,4,4,0,0,0,0,4,4,4,4,4,4,4,4,4,0,4,4,4,0,0,1,0,0,4,4,4,4,0,0,0,0,1,0,0,0,0,4,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,0,0,1,0,0,0,0,0,1,0,1,0,1,0,0,0]},
  {"x":0,"y":2,"w":11,"h":8,"px":[0,1,1,0,0,0,0,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,1,1,0,0,8,0,0,0,0,0,0,1,1,0,8,8,8,0,1,1,1,0,1,1,0,0,8,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1]},
  {"x":0,"y":3,"w":11,"h":6,"px":[0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,1,1,1,0,0,1,0,0,1,1,1]},
  {"x":0,"y":0,"w":11,"h":11,"px":[0,0,0,0,4,4,4,0,0,0,0,0,0,4,4,0,0,0,4,4,0,0,0,4,0,0,0,0,0,0,0,4,0,0,4,0,0,0,0,0,0,0,4,0,4,0,0,0,0,0,0,0,0,0,4,4,0,0,0,0,0,0,0,0,0,4,4,0,0,0,0,0,0,0,0,0,4,0,4,0,0,0,0,0,0,0,4,0,0,4,0,0,0,0,0,0,0,4,0,0,0,4,4,0,0,0,4,4,0,0,0,0,0,0,4,4,4,0,0,0,0]},
  {"x":0,"y":0,"w":11,"h":11,"px":[0,0,0,0,5,5,5,0,0,0,0,0,0,5,5,0,0,0,5,5,0,0,0,5,0,0,0,1,0,0,0,5,0,0,5,0,0,1,1,1,0,0,5,0,5,0,0,1,1,1,1,1,0,0,5,5,0,0,0,0,1,0,0,0,0,5,5,0,0,0,0,1,0,0,0,0,5,0,5,0,0,0,1,0,0,0,5,0,0,5,0,0,0,0,0,0,0,5,0,0,0,5,5,0,0,0,5,5,0,0,0,0,0,0,5,5,5,0,0,0,0]},
  {"x":0,"y":0,"w":11,"h":11,"px":[0,0,0,4,4,4,4,4,0,0,0,0,0,4,4,4,4,4,4,4,0,0,0,4,4,4,0,0,0,4,4,4,0,4,4,4,0,0,0,0,0,4,4,4,4,4,0,0,0,0,0,0,0,4,4,4,4,0,0,0,0,0,0,0,4,4,4,4,0,0,0,0,0,0,0,4,4,4,4,4,0,0,0,0,0,4,4,4,0,4,4,4,0,0,0,4,4,4,0,0,0,4,4,4,4,4,4,4,0,0,0,0,0,4,4,4,4,4,0,0,0]},
  {"x":0,"y":0,"w":11,"h":11,"px":[0,0,0,5,5,5,5,5,0,0,0,0,0,5,1,1,1,1,1,5,0,0,0,5,1,1,0,0,0,1,1,5,0,5,1,1,0,4,4,4,0,1,1,5,5,1,0,0,4,0,0,0,0,1,5,5,1,0,0,4,4,4,0,0,1,5,5,1,0,0,0,0,4,0,0,1,5,5,1,1,0,4,4,4,0,1,1,5,0,5,1,1,0,0,0,1,1,5,0,0,0,5,1,1,1,1,1,5,0,0,0,0,0,5,5,5,5,5,0,0,0]},
  {"x":0,"y":1,"w":11,"h":9,"px":[0,0,1,1,1,1,1,1,1,0,0,0,0,1,-13,-13,-13,-13,-13,1,0,0,0,0,1,-13,-13,-13,-13,-13,1,0,0,0,0,1,-13,-13,-13,-13,-13,1,0,0,0,0,1,1,1,1,1,1,1,0,0,0,1,1,-4,1,1,1,-4,1,1,0,1,-4,1,1,1,-4,1,1,1,-4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]},
  {"x":2,"y":1,"w":7,"h":9,"px":[0,1,1,1,1,1,0,0,1,0,0,0,1,0,1,1,1,1,1,1,1,1,-14,-14,-14,-14,-14,1,1,-14,1,-14,1,-14,1,1,-14,-14,1,-14,-14,1,1,-14,1,-14,1,-14,1,1,-14,-14,-14,-14,-14,1,1,1,1,1,1,1,1]},
  {"x":2,"y":4,"w":7,"h":3,"px":[0,0,1,1,1,0,0,0,1,14,14,14,1,0,1,1,1,1,1,1,1]}
];

// Generic UI icons: DS:324A, 12 records; caller 0x26320.
const UI_ICONS = [
  {"x":1,"y":2,"w":9,"h":6,"px":[0,0,0,0,1,1,1,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,1,1,0,1,0,1,0,0,0,1,0,1,1,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0]},
  {"x":1,"y":2,"w":9,"h":6,"px":[0,0,1,1,1,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,1,0,0,0,1,0,1,0,1,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,0,0]},
  {"x":2,"y":2,"w":5,"h":6,"px":[0,0,1,0,0,0,1,1,1,0,1,1,1,1,1,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0]},
  {"x":2,"y":2,"w":5,"h":6,"px":[0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,1,1,1,0,1,1,1,0,0,0,1,0,0]},
  {"x":0,"y":0,"w":9,"h":9,"px":[0,0,0,0,1,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,1,0,1,0,1,0,0,0,1,0,0,1,0,0,1,0,1,1,1,1,0,1,1,1,1,0,1,0,0,1,0,0,1,0,0,0,1,0,1,0,1,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,0,0,0,0]},
  {"x":1,"y":2,"w":9,"h":7,"px":[0,1,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,1,1,0,0,1,0,0,0,0,1,1,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0]},
  {"x":1,"y":0,"w":9,"h":11,"px":[0,0,0,1,1,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,1,1,0,1,1,0,0,0,1,1,0,0,0,1,1,0,0,1,0,0,0,0,0,1,0,1,1,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1]},
  {"x":0,"y":1,"w":11,"h":9,"px":[0,0,0,1,1,1,1,1,1,1,1,0,0,1,0,0,0,0,0,0,1,1,0,1,0,0,0,0,0,0,1,-14,1,1,1,1,1,1,1,1,1,-14,-14,1,1,0,0,0,0,0,0,1,-14,-14,1,1,0,1,1,1,1,0,1,-14,-14,1,1,0,0,0,0,0,0,1,-14,1,0,1,0,0,0,0,0,0,1,1,0,0,1,1,1,1,1,1,1,1,0,0,0]},
  {"x":0,"y":2,"w":11,"h":6,"px":[0,0,0,1,1,1,1,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0,0,0,1,1,0,0,0,0,1,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1]},
  {"x":0,"y":1,"w":11,"h":9,"px":[0,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,1,1,0,0,0,1,0,0,0,1,0,0,0,0,0,1,1,1,1,1,1,1,0,0,0,1,1,1,0,0,0,1,1,1,0,0,1,1,1,0,0,0,1,1,1,0,0,1,1,1,0,0,0,1,1,1,0,0,1,1,1,1,1,1,1,1,1,0]},
  {"x":1,"y":0,"w":9,"h":11,"px":[0,0,0,1,1,1,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,1,1,1,1,0,0,0,1,0,0,1,0,0,1,0,1,0,0,0,1,0,0,0,1,0,0,0,1,1,1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,0,1,1,0,0,0,1,1,0]},
  {"x":0,"y":1,"w":11,"h":9,"px":[0,0,1,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,1,1,1,1,1,1,1,0,0,0,1,1,0,1,1,1,0,1,1,0,1,0,1,1,1,0,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]}
];

export function drawUIIcon(x, y, iconIdx, color) {
  drawIconRecord(x, y, UI_ICONS[iconIdx], color, false);
}

// EXE type-6 track (0x47DF7) and beveled thumb (0x4B0B4).
export function drawIconSlider(left, right, y, thumbX) {
  drawBox3DSunken(left, y + 3, right - left + 1, 5, UI_BACKGROUND,
    UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
  setPixel(thumbX, y + 1, UI_BACKGROUND);
  fillRect(thumbX - 1, y + 2, thumbX + 1, y + 7, UI_BACKGROUND);
  setPixel(thumbX, y, UI_DARK_BORDER);
  setPixel(thumbX - 1, y + 1, UI_DARK_BORDER);
  vline(thumbX - 2, y + 2, y + 8, UI_DARK_BORDER);
  hline(thumbX - 1, thumbX + 2, y + 8, UI_BRIGHT_BORDER);
  setPixel(thumbX + 1, y + 1, UI_MED_BORDER);
  vline(thumbX + 2, y + 2, y + 7, UI_MED_BORDER);
}

// EXE 0x26110: live icons draw positive samples in the caller's color;
// shaded icons draw every nonzero sample using palette 169 + abs(sample).
export function drawIcon(x, y, iconIdx, color, shaded = false) {
  drawIconRecord(x, y, ICONS[iconIdx], color, shaded);
}

function drawIconRecord(x, y, icon, color, shaded) {
  if (!icon) return;
  for (let i = 0; i < icon.px.length; i++) {
    const sample = icon.px[i];
    if (shaded ? sample !== 0 : sample > 0) {
      setPixel(x + icon.x + i % icon.w,
        y + icon.y + Math.floor(i / icon.w),
        shaded ? 169 + Math.abs(sample) : color);
    }
  }
}

// HUD layout constants
// EXE: compute_hud_layout at file 0x2FBCA computes all positions dynamically
const LEFT = 5;            // EXE: mov word [0xE9D4], 0x5 — left margin
const HUD_Y = 5;           // EXE: DS:0x518E default = 5
const ROW2_Y = HUD_Y + 12; // EXE: add ax, 0xC at file 0x303F5 — row2 = row1 + 12
const BAR_H = 11;          // EXE: add ax, 0xB at file 0x2FCF0 — bar outline 12px total
const ICON_SPACING = 11;   // EXE: imul ax, ax, 0xB at file 0x2FE71
const BAR_RESERVED = 62;   // EXE: mov si, 0x3E — reserved bar area width (max 10 players × 6 + 2)
const AFTER_BAR_GAP = 10;  // EXE: add ax, 0xA at file 0x2FC2E — gap after bar area

// EXE icon indices — runtime-resolved from weapon table, differ from web WEAPONS array indices
// These are the icon bitmap indices in the ICONS table (DS:0x3826), NOT weapon array positions
const ICON_PARACHUTE = 38;       // DS:D554 — parachute icon (2×11px)
const ICON_BATTERY = 39;         // DS:D556 — battery icon (2×11px)
const ICON_CONTACT_TRIGGER = 47; // DS:D566 — contact trigger icon (4×7px)

// Draw a per-player column inside a multi-player bar
// EXE: bar_column at file 0x39482 — fills 6px-wide column from bottom up
function drawBarColumn(barX, barY, idx, fillH, color) {
  const colX = barX + idx * 6;
  if (fillH <= 0) return;
  const h = Math.min(fillH, BAR_H - 1); // EXE: clamped to 0..10 at 0x39498 (10px bar interior)
  const bottom = barY + BAR_H - 1;       // bottom of fill area (y + 10)
  for (let row = 0; row < h; row++) {
    hline(colX, colX + 5, bottom - row, color);
  }
}

// Draw 3-pixel sunken frame around the playfield viewport
// EXE: draw_playfield_border at file 0x290A8 (icons.cpp)
// Step 1 (0x290CC): draw_3d_box(0, 0, FG_MAXX=[EF3E], YMIN=[EF40]-4, [EF28]) — HUD raised frame
// Step 2 (0x290D4–0x29220): three concentric rectangles via hline/vline callbacks
//   Layer 0 (0x290D4, pal 0x96=150): offset ±3 from playfield (XMIN-3, YMIN-3, XMAX+3, YMAX+3)
//   Layer 1 (0x29143, pal 0x9D=157): offset ±1 from playfield (XMIN-1, YMIN-1, XMAX+1, YMAX+1)
//   Layer 2 (0x291B8, pal [EF2C]=152): offset ±2 from playfield (XMIN-2, YMIN-2, XMAX+2, YMAX+2)
// Callbacks: [DS:EF0C]=fg_drawhline, [DS:EF10]=fg_drawvline
// DS:EF38=SHIELD_DRAW_Y_MAX(476), DS:EF3C=SHIELD_DRAW_X_MAX(356),
// DS:EF40=SHIELD_DRAW_Y_MIN(38), DS:EF42=SHIELD_DRAW_X_MIN(3)
export function drawPlayfieldBorder() {
  const W = config.screenWidth;
  const H = config.screenHeight;

  // Step 1 (0x290CC): draw_3d_box(0, 0, FG_MAXX, YMIN-4, [EF28]) — HUD raised frame
  // EXE: dx=FG_MAXX=319, dy=SHIELD_DRAW_Y_MIN-4=34; web w=dx+1, h=dy+1
  drawBox3DRaised(0, 0, W, PLAYFIELD_TOP - 3, UI_BACKGROUND,
    UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);

  // Step 2: three concentric rectangles for playfield border
  // EXE playfield viewport: XMIN=3, YMIN=PLAYFIELD_TOP, XMAX=W-4, YMAX=H-4
  const XMIN = 3;
  const YMIN = PLAYFIELD_TOP;
  const XMAX = W - 4;
  const YMAX = H - 4;
  // Layer 0 (file 0x290FF–0x2913B): pal 150 — wall color, outermost (offset ±3)
  const L0 = 150;
  hline(XMIN - 3, XMAX + 3, YMIN - 3, L0); // top
  hline(XMIN - 3, XMAX + 3, YMAX + 3, L0); // bottom
  vline(XMIN - 3, YMIN - 3, YMAX + 3, L0); // left
  vline(XMAX + 3, YMIN - 3, YMAX + 3, L0); // right
  // EXE 0x29505 colors VGA 157 by resolved wall type. Keep it separate
  // from the port's UI accent alias at 157 and the fixed outer grey at 150.
  const wallColors = [[50,50,50], [63,63,23], [23,63,23],
    [63,23,63], [23,63,63], [63,63,63]];
  const L1 = 165;
  setPaletteRgb(L1, ...wallColors[getEffectiveWallType()]);
  hline(XMIN - 1, XMAX + 1, YMIN - 1, L1); // top
  hline(XMIN - 1, XMAX + 1, YMAX + 1, L1); // bottom
  vline(XMIN - 1, YMIN - 1, YMAX + 1, L1); // left
  vline(XMAX + 1, YMIN - 1, YMAX + 1, L1); // right
  // Layer 2 (file 0x291E6–0x29220): pal [EF2C]=152 — black shadow, middle (offset ±2)
  const L2 = UI_DEEP_SHADOW; // pal 152 = black
  hline(XMIN - 2, XMAX + 2, YMIN - 2, L2); // top
  hline(XMIN - 2, XMAX + 2, YMAX + 2, L2); // bottom
  vline(XMIN - 2, YMIN - 2, YMAX + 2, L2); // left
  vline(XMAX + 2, YMIN - 2, YMAX + 2, L2); // right
}

// Draw the full HUD into the framebuffer
// EXE: draw_hud() at file 0x2FC84, draw_hud_full() at file 0x301B2
// Native 0x318D8 refreshes this field independently during damage. Other HUD
// widgets retain their existing pixels until their own refresh calls.
export function drawHudEnergy(player) {
  const x=LEFT+Math.max(measureText('Power'),measureText('Max'))+8;
  const width=measureText('8888 ');
  fillRect(x,ROW2_Y,x+width-1,ROW2_Y+11,UI_BACKGROUND);
  // Native 0x31A30 clamps negative values to zero, without an upper cap.
  const fuelVal=Math.max(0,Math.trunc(
    (player.hudEnergy??player.energy??0)*1000/(player.maxEnergy??100)));
  drawText(x,ROW2_Y,String(fuelVal).padStart(4),UI_DEEP_SHADOW);
}

// Native 0x3DB30 refreshes only this widget after activation/selection.
export function drawHudShield(player) {
  const countFieldW = measureText('99 '), pctFieldW = measureText('100% ');
  let x = LEFT + Math.max(measureText('Power'),measureText('Max')) + 8 +
    measureText('8888 ') + 2*countFieldW + 50;
  const hudTextColor = UI_DEEP_SHADOW, dimColor = UI_DARK_TEXT;
  fillRect(x,ROW2_Y,x+countFieldW+20+pctFieldW-1,ROW2_Y+11,UI_BACKGROUND);
  // Widget 4 (0x3DB30): selected shield config +0x0E selects the item;
  // a negative index draws a generic empty-defense symbol, with no count.
  const selectedShield = player.selectedShield ?? player.activeShield;
  const shieldWeapon = player.shieldWeapon ?? (selectedShield > 0
    ? WPN.MAG_DEFLECTOR + selectedShield - 1 : -1);
  const shieldEnergy = player.hudShieldEnergy ?? player.shieldEnergy ?? 0;
  const selectedActive = selectedShield === player.activeShield;
  if (shieldWeapon >= 2) {
    drawText(x, ROW2_Y, String(player.inventory?.[shieldWeapon] || 0), hudTextColor);
  }
  x += countFieldW; // E9F6
  if (shieldWeapon < 0) {
    drawUIIcon(x, ROW2_Y, shieldEnergy > 0 ? 3 : 10,
      shieldEnergy > 0 ? UI_DEEP_SHADOW : dimColor);
  } else {
    drawIcon(x, ROW2_Y, shieldWeapon - 2,
      shieldEnergy > 0 && selectedActive ? (player.colorIndex ?? player.index) * PLAYER_PALETTE_STRIDE + 5 : hudTextColor);
  }
  x += 20; // E9F8
  const shieldMax = player.shieldMaxEnergy ?? SHIELD_CONFIG[player.activeShield || 0]?.energy ?? 0;
  let shieldPct = shieldEnergy === 0 ? 0 : Math.max(1,
    Math.floor(shieldEnergy * 100 / Math.max(1, shieldMax)));
  if (shieldPct === 100 && shieldEnergy !== shieldMax) shieldPct = 99;
  drawText(x, ROW2_Y, shieldPct + '%', shieldEnergy !== 0 && selectedActive ? hudTextColor : dimColor);
}

export function drawHud(player, wind, round, opts) {
  // EXE: [EF22] = VGA 152 = black → web palette 205 (UI_DEEP_SHADOW) — used for most HUD text
  // EXE: palette 163 = player's color (fg_setrgb at 0x3030E) — only for player name at E9DC
  const baseColor = player.colorIndex * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
  const hudTextColor = UI_DEEP_SHADOW; // VGA 152 = black, remapped to web palette 205
  // EXE: [EF24] = dim text color for depleted/zero-ammo items
  const dimColor = UI_DARK_TEXT;
  const numP = Math.min(config.numPlayers, players.length);

  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];

  // EXE: compute_hud_layout — barX aligned for both rows
  // EXE: DS:0x220C → "Power", DS:0x2364 → "Max" — these are the Row 1/2 labels (NOT player name)
  // EXE: si = measureText("Power") + 8 (0x2FBF1: add ax,0x8), then max with measureText("Max")+8
  const barX = LEFT + Math.max(measureText('Power'), measureText('Max')) + 8;
  const barWidth = measureText('8888 '); // EXE: DS:0x5778 measurement string
  const afterBarX = barX + barWidth;

  // EXE: fg_fillregion(5, DS:0x518E, screenW-5, SHIELD_DRAW_Y_MIN-7, [EF28])
  // Fills entire HUD interior: y=5 to y=PLAYFIELD_TOP-7 (31 in 320×200)
  fillRect(LEFT, HUD_Y, config.screenWidth - LEFT - 1, PLAYFIELD_TOP - 7, UI_BACKGROUND);

  // === Row 1 ===
  // EXE: sprintf(buf, "%s:", DS:0x220C→"Power") then fg_text at (5, HUD_Y) in [EF22]
  drawText(LEFT, HUD_Y, 'Power:', hudTextColor);

  if (config.screenWidth <= 320) {
    // --- Basic mode Row 1: multi-player power bar + icons (EXE: draw_hud 0x2FC84) ---
    const barW = numP * 6;
    // EXE: draw_flat_box(barX-1, HUD_Y, barX+barW, HUD_Y+0xB) + fg_rect fill with [EF2C]
    drawBox3DSunken(barX - 1, HUD_Y, barW + 2, BAR_H + 1, UI_DEEP_SHADOW,
      UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
    // EXE: per-player power columns (helper 0x394F2), height = power/100
    for (let i = 0; i < numP && i < players.length; i++) {
      const fillH = Math.floor(players[i].power / 100);
      const pColor = players[i].colorIndex * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      drawBarColumn(barX, HUD_Y, i, fillH, pColor);
    }
    // EXE: player icons at afterBarX = barX + 62 + 10
    const iconBaseX = barX + BAR_RESERVED + AFTER_BAR_GAP;
    for (let i = 0; i < numP && i < players.length; i++) {
      const p = players[i];
      const ix = iconBaseX + i * ICON_SPACING;
      if (ix + 6 > config.screenWidth - LEFT) break;
      const pColor = players[i].colorIndex * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      // EXE: draw_icon_alive (filled in player color) / draw_icon_dead (outline in palette 0xA9=169=UI_DARK_TEXT)
      // EXE: icon index from tank sub-struct (stride 0xCA) +0x16 = always 0 (confirmed session 110/140)
      //      draw_hud_basic reads from tank sub-struct (DS:D568+i*0xCA), NOT player struct (stride 0x6C)
      //      tank_sub[+0x16] is always 0 (not weapon selection; weapon is in player_struct via DS:0x5182)
      const iconColor = p.alive ? pColor : UI_DARK_TEXT;
      drawIcon(ix, HUD_Y, 0, iconColor); // icon 0 = player tank (EXE: always 0 from tank sub-struct)
      if (i === player.index) {
        setPixel(ix + 2, HUD_Y + ICONS[0].h + 2, pColor);
      }
    }
  } else {
    // --- Full mode Row 1: all text (EXE: draw_hud_full 0x301B2) ---
    // EXE: most text drawn in [EF22] = VGA 152 = black; player name at E9DC in palette 163
    let x = barX;
    // EXE: sprintf(buf, "%4d", player.power) at [E9D6]
    drawText(x, HUD_Y, String(player.hudPower ?? player.power).padStart(4), hudTextColor);
    x += barWidth;
    // EXE: sprintf("%s:", "Angle") at DS:0x57BA formats "Angle:" → drawn at E9D8
    // E9DA = E9D8 + measureText("Angle") + 8 (advance uses "Angle" width, not "Angle:")
    drawText(x, HUD_Y, 'Angle:', hudTextColor);
    x += measureText('Angle') + 8; // EXE: E9DA = E9D8 + measureText("Angle") + 8
    // EXE: sprintf(buf, "%2d", player.angle) at [E9DA] — DS:0x57BE = "%2d"
    drawText(x, HUD_Y, String(getTankAim(player).angle).padStart(2), hudTextColor);
    x += measureText('99  '); // EXE: DS:0x577E = "99  " (2 digits + 2 spaces)
    // EXE: fg_setrgb(0xA3, R, G, B) sets palette 163 = player color
    // EXE: text_display(E9DC, HUD_Y, struct+0xB6) draws PLAYER NAME in palette 163
    // struct+0xB6 is a far pointer to the player name string (not wind!)
    const nameX = x;  // E9DC — player name x position
    // The name uses its own DAC entry, remaining visible even when Black
    // sky suppresses all tank sprite entries 0..79.
    setPaletteRgb(163, ...(player.displayColor || getPlayerColor(player.colorIndex)));
    drawText(nameX, HUD_Y, player.name, 163);
    // EXE: E9DE = E9DC + measureText("MMMMMMMMMMMMMMM") + 2 → weapon icon position
    // EXE: E9E0 = E9DE + 15 → weapon text position
    const wpnIconX = nameX + measureText('MMMMMMMMMMMMMMM') + 2; // E9DE
    // EXE: draw_player_icon([E9DE], HUD_Y, wpn_idx) — draws selected weapon's icon
    if (player.selectedWeapon >= 2 && player.selectedWeapon - 2 < ICONS.length) {
      drawIcon(wpnIconX, HUD_Y, player.selectedWeapon - 2, hudTextColor);
    }
    const wpnX = wpnIconX + 15; // E9E0 = E9DE + 15
    const wpnFull = player.selectedWeapon === WPN.BABY_MISSILE || ammo === -1
      ? weaponName : ammo + ': ' + weaponName;
    drawText(wpnX, HUD_Y, wpnFull, hudTextColor);
  }

  // === Row 2 ===

  if (config.screenWidth <= 320) {
    // --- Basic mode Row 2: multi-player health + shields bars ---
    // EXE: L1 label = "Max:" (DS:0x2364→DS:0x2EFA, static — no runtime writes)
    drawText(LEFT, ROW2_Y, 'Max:', hudTextColor);

    // EXE: multi-player health bar
    // EXE: helper at 0x3959F reads struct+0xA2-0xA8 = health/maxHealth*10
    // Web port: player.energy (0-100) / 10 = equivalent 0-10 fill
    const barW = numP * 6;
    // EXE: draw_flat_box(barX-1, ROW2_Y, barX+barW, ROW2_Y+0xB) + fg_rect fill with [EF2C]
    drawBox3DSunken(barX - 1, ROW2_Y, barW + 2, BAR_H + 1, UI_DEEP_SHADOW,
      UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
    for (let i = 0; i < numP && i < players.length; i++) {
      const fillH = Math.floor(players[i].energy / 10);
      const pColor = players[i].colorIndex * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      drawBarColumn(barX, ROW2_Y, i, fillH, pColor);
    }

    // EXE: "Shields:" label + multi-player shield bar
    // EXE: L2 label = "Shields:" (DS:0x2368→DS:0x2EFE, static)
    // EXE: helper at 0x39544, compute_item_percentage = sub[0x96]*100/maxEnergy/10
    const shieldsLabelX = barX + BAR_RESERVED + AFTER_BAR_GAP;
    drawText(shieldsLabelX, ROW2_Y, 'Shields:', hudTextColor);
    const shieldsBarX = shieldsLabelX + measureText('Shields:');
    if (shieldsBarX + barW < config.screenWidth - LEFT) {
      // EXE: draw_flat_box + fg_rect for shields bar
      drawBox3DSunken(shieldsBarX - 1, ROW2_Y, barW + 2, BAR_H + 1, UI_DEEP_SHADOW,
        UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
      for (let i = 0; i < numP && i < players.length; i++) {
        const p = players[i];
        const maxEnergy = (SHIELD_CONFIG[p.activeShield] || SHIELD_CONFIG[0]).energy || 1;
        const fillH = Math.floor(p.shieldEnergy * 10 / maxEnergy);
        const pColor = p.colorIndex * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
        drawBarColumn(shieldsBarX, ROW2_Y, i, fillH, pColor);
      }
    }

    // Wind text — not in EXE basic mode, added for gameplay usability
    const windTextX = shieldsBarX + barW + 4;
    if (windTextX + measureText('W:-20') < config.screenWidth - LEFT) {
      const windStr = wind === 0 ? 'W:0' : 'W:' + wind;
      drawText(windTextX, ROW2_Y, windStr, hudTextColor);
    }
  } else {
    // --- Full mode Row 2: inventory widgets (EXE: draw_hud_full 0x301B2) ---
    // Layout from compute_hud_layout_full (0x2FEBE). Color rule:
    //   baseColor if count > 0, dimColor if count == 0 — ALL items always shown.
    //
    //   E9E8 = LEFT=5           → player name "Name:"
    //   E9EA = barX             → W1: fuel% text ("%4ld") [field=m("8888 ")]
    //   E9EC = E9EA+m("8888 ") → W2 (0x3DE9B): battery count ("%2d") [DS:647D]
    //   E9EE = E9EC+m("99 ")   → W2: battery indicator (25px, icons.cpp)
    //   E9F0 = E9EE+25          → inline: parachute count ("%2d") [DS:57D0, inv[D554=42]]
    //   E9F2 = E9F0+m("99 ")   → W3 (0x3DE5E): parachute indicator (25px, icons.cpp)
    //   E9F4 = E9F2+25          → W4 (0x3DB30): item count [field=m("99 ")]
    //   E9F6 = E9F4+m("99 ")   → W4: item bar (20px)
    //   E9F8 = E9F6+20          → W4: item% text [field=m("100% ")]
    //   E9FA = E9F8+m("100% ") → W5 (0x3DC94): shield count ("%d") [DS:6476]
    //   E9FC = E9FA+m("99 ")   → W5: shield bar (20px)
    //   E9FE = E9FC+20          → inline: [D566] item ("%2d") [DS:57D4]
    // EXE: sprintf(buf, "%s:", DS:0x2364→"Max") — Row 2 label is "Max:", not player name
    drawText(LEFT, ROW2_Y, 'Max:', hudTextColor);

    const countFieldW = measureText('99 ');    // DS:579B / 579F / 57A9
    const pctFieldW   = measureText('100% ');  // DS:57A3

    // Widget 1 (0x318D8): fuel at barX = E9EA, format "%4ld" → 4-char integer
    // EXE: shows 0-1000 (per mille). Web: player.energy = 0-100%, so multiply by 10.
    let x = barX; // E9EA
    drawHudEnergy(player);
    x += barWidth; // → E9EC

    // Widget 2 (0x3DE9B): battery count at E9EC ("%2d"), icon at E9EE
    // EXE: clears area, formats "%2d" count, calls draw_icon_alive(E9EE, ROW2_Y, D556=39, [6E2A]=153)
    const batCount = (player.inventory && player.inventory[WPN.BATTERY]) || 0;
    const batColor = batCount > 0 ? hudTextColor : dimColor;
    drawText(x, ROW2_Y, String(batCount).padStart(2), batColor);
    x += countFieldW; // → E9EE
    // EXE: draw_icon_alive(x, ROW2_Y, 39, [6E2A]) — icon color always DS:6E2A=153=[EF24]
    drawIcon(x, ROW2_Y, ICON_BATTERY, dimColor);
    x += 25; // → E9F0

    // Inline (draw_hud_full 0x303CC): parachute count at E9F0, format "%2d" [DS:57D0]
    // EXE: inventory[D554=38] = parachute count
    const paraCount = player.hudParachuteCount ?? player.inventory?.[WPN.PARACHUTE] ?? 0;
    const paraColor = paraCount > 0 ? hudTextColor : dimColor;
    drawText(x, ROW2_Y, String(paraCount).padStart(2), paraColor);
    x += countFieldW; // → E9F2

    // Widget 3 (0x3DE5E): parachute icon at E9F2
    // EXE: color = struct[0x28] > 0 ? [EF22] : [EF24]
    // EXE: draw_icon_alive(E9F2, ROW2_Y, D554=38, color)
    drawIcon(x, ROW2_Y, ICON_PARACHUTE, paraColor);
    x += 25; // → E9F4

    drawHudShield(player);
    x += countFieldW + 20 + pctFieldW; // E9FA

    // Widget 5 (0x3DC94): tank+0x9A selected guidance. EXE item 32 is
    // the empty sentinel here; generic icon 10 replaces both count and icon.
    const guidanceWeapon = player.guidanceWeapon ?? WPN.LASER;
    if (guidanceWeapon !== WPN.LASER) {
      drawText(x, ROW2_Y, String(player.inventory?.[guidanceWeapon] || 0), hudTextColor);
    }
    x += countFieldW; // E9FC
    if (guidanceWeapon === WPN.LASER) drawUIIcon(x, ROW2_Y, 10, hudTextColor);
    else drawIcon(x, ROW2_Y, guidanceWeapon - 2, hudTextColor);
    x += 20; // E9FE

    // Inline (draw_hud_full 0x303CC): contact trigger count at E9FE, format "%2d" [DS:57D4]
    // EXE: inventory[D566=47] = contact trigger count
    const trigCount = player.hudContactTriggerCount ?? player.inventory?.[WPN.CONTACT_TRIGGER] ?? 0;
    const trigColor = trigCount > 0 ? hudTextColor : dimColor;
    drawText(x, ROW2_Y, String(trigCount).padStart(2), trigColor);
    x += countFieldW; // → EA00

    // Widget 6 (0x3DD59): contact trigger icon at EA00
    // EXE: color = struct[0x2A] != 0 ? [EF22] : [EF24]
    // EXE: draw_icon_alive(EA00, ROW2_Y, D566=47, color)
    drawIcon(x, ROW2_Y, ICON_CONTACT_TRIGGER,
      (player.hudContactTriggerArmed ?? player.contactTriggerArmed) ? hudTextColor : dimColor);
    x += 20; // → EA02 (EXE: EA02 = EA00 + 20 at 0x3005D, not 25 like W2/W3 icons)

    // Widget 7 (0x3DD95): Heavy Shield energy, conditional on screen width
    // EXE: check1 (0x31249) = inventory[D564=FuelTank] * 10 + struct[+0xAA]
    //   struct[+0xAA] = fractional fuel energy (0-9 per Fuel Tank unit, starts at 0)
    //   Heavy Shield is powered by Fuel Tanks, NOT by the Heavy Shield count itself
    // EXE: check2 (0x3121E) = struct[0] > 1 (shield type active)
    // EXE: format "%3d" (DS:0x6479), display at [EA02]
    // EXE: skips if [EA02] == 0 (not enough screen width)
    if (x + measureText('999') < config.screenWidth - LEFT) {
      const fuelCount = player.inventory ? (player.inventory[WPN.FUEL_TANK] || 0) : 0;
      const fuelEnergy = player.fuelEnergy || 0; // struct[+0xAA], 0-9 fractional per tank
      const shieldTotal = fuelCount * 10 + fuelEnergy;
      const w7Color = shieldTotal > 0 ? hudTextColor : dimColor;
      drawText(x, ROW2_Y, String(shieldTotal).padStart(3), w7Color);
      drawIcon(x + 20, ROW2_Y, WPN.FUEL_TANK - 2, w7Color);
    }
  }

  // Guided missile indicator (gameplay feature, not from EXE HUD)
  if (opts && opts.guided) {
    drawText(afterBarX, ROW2_Y, 'GUIDED', hudTextColor);
  }

  // Simultaneous mode aim timer
  if (opts && opts.aimTimer > 0) {
    drawText(afterBarX, ROW2_Y, 'T:' + opts.aimTimer, hudTextColor);
  }
}

// Draw wind indicator on playfield — separate from HUD
// EXE: draw_wind_indicator at file 0x28F1D (seg 1F7F:2D2D)
// Shows "Wind: N" or "No Wind" text right-aligned with 20px margin,
// plus a directional pixel-arrow triangle (5 columns, narrowing).
// Color: VGA 154 (0x9A). Position: top-right viewport area.
const WIND_COLOR = 154; // VGA 0x9A — wind indicator text + arrow color
function drawWindPixel(x, y, redraw = false) {
  if (!windPixelVisible(y * config.screenWidth + x)) return;
  // EXE 0x28E43: original VGA 80..104 uses wind-on-ground color 87.
  const under = getPixel(x, y);
  if (redraw) projectileDrawing.writes.delete(y * config.screenWidth + x);
  setPixel(x, y, under >= 120 && under <= 144 ? 127 : WIND_COLOR);
}
export function drawWindIndicator(wind, { redraw = false } = {}) {
  // An actual native label redraw replaces prior world writes. Ordinary
  // animation-frame repaint must retain pixels erased during the shot.
  if (redraw) resetWindIndicator();
  prepareWindIndicator(`${config.screenWidth}:${config.screenHeight}:${wind}`);
  setPaletteRgb(127, 40, 40, 63); // Remapped EXE VGA 87.
  const viewportY = PLAYFIELD_TOP;
  let direction, text;
  if (wind < 0) {
    direction = -1;
    text = 'Wind: ' + Math.abs(wind);
  } else if (wind > 0) {
    direction = 1;
    text = 'Wind: ' + wind;
  } else {
    direction = 0;
    text = 'No Wind';
  }

  // EXE: x = FG_MAXX - textW - 20 (0x28FD1: dx = [EF3E] - textW - 20), y = viewportY + 5
  const textW = measureText(text);
  const FG_MAXX = config.screenWidth - 1;
  const x = FG_MAXX - textW - 20;
  const y = viewportY + 5;
  drawText(x, y, text, WIND_COLOR, (px, py) => drawWindPixel(px, py, redraw));

  if (direction === 0) return;

  // EXE: directional arrow — 5 columns, narrowing triangle
  // direction=-1: arrowX starts at x-5, moves left (arrow points left)
  // direction=+1: arrowX starts at FG_MAXX-15 (0x29010: ax = [EF3E] + 0xFFF1)
  const arrowCenterY = viewportY + 10;
  let arrowX;
  if (direction === -1) {
    arrowX = x - 5;
  } else {
    arrowX = FG_MAXX - 15;
  }

  // EXE: for col = 4 downto 0, for di = 0 to col:
  //   pixel(arrowX, centerY + di), pixel(arrowX, centerY - di)
  //   arrowX += direction
  for (let col = 4; col >= 0; col--) {
    for (let di = 0; di <= col; di++) {
      drawWindPixel(arrowX, arrowCenterY + di, redraw);
      if (di > 0) drawWindPixel(arrowX, arrowCenterY - di, redraw);
    }
    arrowX += direction;
  }
}
