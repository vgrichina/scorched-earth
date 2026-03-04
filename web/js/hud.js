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
//   Per icon: pattern_type(1B), width(1B), height(1B), pixel_data(122B)
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
import { hline, fillRect, setPixel } from './framebuffer.js';
import { drawText, measureText } from './font.js';
import { WEAPONS, WPN } from './weapons.js';
import { players } from './tank.js';
import { PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         UI_DARK_TEXT, UI_DEEP_SHADOW, UI_BACKGROUND } from './constants.js';
import { PLAYFIELD_TOP } from './terrain.js';
import { SHIELD_CONFIG } from './shields.js';

// Icon bitmap table — all 48 icons from EXE DS:0x3826 (stride 125 bytes)
// Per icon: {t:pattern_type, w:width, h:height, px:[column-major pixels]}
// EXE draw_icon_alive (0x261D7): validates idx 0-47, calls internal renderer
// px[col * h + row] = 0 (transparent) or 1 (filled in caller-supplied color)
// Icons: 0=player tank, 1-34=weapons, 35-40=accessories, 41-44=blank, 45-47=misc
const ICONS = [
  {t:2,w:4,h:7,px:[1,1,1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,0,0]},
  {t:0,w:3,h:10,px:[1,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1]},
  {t:1,w:3,h:8,px:[1,0,0,0,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]},
  {t:0,w:3,h:10,px:[1,1,1,0,0,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1]},
  {t:0,w:2,h:11,px:[1,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0]},
  {t:0,w:0,h:11,px:[]},{t:0,w:0,h:11,px:[]},
  {t:2,w:1,h:7,px:[0,1,1,1,1,1,0]},
  {t:3,w:2,h:6,px:[0,0,1,0,0,0,0,0,0,1,0,0]},
  {t:1,w:1,h:10,px:[0,0,0,1,1,0,0,0,0,0]},
  {t:5,w:5,h:1,px:[1,1,0,0,0]},
  {t:4,w:4,h:3,px:[0,1,0,1,1,1,0,1,0,1,0,0]},
  {t:3,w:3,h:5,px:[0,1,1,0,0,1,0,0,1,0,1,0,1,1,0]},
  {t:3,w:1,h:6,px:[1,1,1,1,0,0]},
  {t:1,w:1,h:9,px:[0,0,1,1,1,1,0,0,0]},
  {t:3,w:1,h:5,px:[0,0,0,0,1]},
  {t:2,w:0,h:7,px:[]},
  {t:3,w:3,h:7,px:[0,0,1,0,1,0,0,0,1,0,1,1,1,0,1,1,1,1,0,1,1]},
  {t:2,w:2,h:9,px:[0,0,0,1,1,1,0,0,0,0,0,1,1,0,0,1,0,0]},
  {t:0,w:0,h:11,px:[]},{t:0,w:0,h:11,px:[]},{t:0,w:0,h:11,px:[]},
  {t:0,w:0,h:11,px:[]},{t:0,w:0,h:11,px:[]},{t:0,w:0,h:11,px:[]},
  {t:3,w:3,h:4,px:[0,1,1,0,1,1,1,1,1,1,1,1]},
  {t:3,w:3,h:5,px:[0,1,1,1,0,1,1,1,1,1,1,1,1,1,1]},
  {t:0,w:3,h:11,px:[0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1,0,0,0,0,0,1,1,1,1,1,1,1,0,0]},
  {t:4,w:3,h:4,px:[0,1,0,0,0,1,1,0,1,1,1,1]},
  {t:0,w:1,h:11,px:[1,1,0,1,1,1,0,1,0,1,1]},
  {t:3,w:1,h:5,px:[0,0,1,0,0]},
  {t:0,w:0,h:11,px:[]},
  {t:1,w:3,h:9,px:[0,0,0,0,1,0,0,1,1,0,1,0,0,1,0,0,1,1,1,1,1,1,1,1,1,1,1]},
  {t:0,w:1,h:11,px:[1,0,0,0,0,0,0,0,0,0,0]},
  {t:0,w:1,h:11,px:[0,0,0,0,1,1,0,0,0,0,0]},
  {t:0,w:3,h:11,px:[0,0,1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,1,0,1,1,1,1,1,1,1,1,1,1,1]},
  {t:3,w:0,h:5,px:[]},
  {t:0,w:2,h:11,px:[0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0]},
  {t:0,w:2,h:11,px:[0,0,0,1,1,1,1,1,0,0,0,0,1,1,1,1,1,1,1,1,1,0]},
  {t:0,w:2,h:11,px:[0,1,1,0,0,0,0,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1]},
  {t:0,w:3,h:11,px:[0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1,0,0,0]},
  {t:0,w:0,h:11,px:[]},{t:0,w:0,h:11,px:[]},
  {t:0,w:0,h:11,px:[]},{t:0,w:0,h:11,px:[]},
  {t:0,w:1,h:11,px:[0,0,1,1,1,1,1,1,1,0,0]},
  {t:2,w:1,h:7,px:[0,1,1,1,1,1,0]},
  {t:2,w:4,h:7,px:[0,0,1,1,1,0,0,0,1,1,1,1,1,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0]},
];

// Draw icon bitmap at (x, y) in given color — column-major pixel data
// EXE: internal renderer at 0x26110, called by draw_icon_alive/dead/blank wrappers
function drawIconBitmap(x, y, pixels, width, height, color) {
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      if (pixels[col * height + row]) setPixel(x + col, y + row, color);
    }
  }
}

// Draw icon by index from ICONS table
// EXE: draw_icon_alive (0x261D7) — validates idx 0-47, extracts type/w/h/px, calls renderer
// Vertically centers small icons within the 12px row height
function drawIcon(x, y, iconIdx, color) {
  if (iconIdx < 0 || iconIdx >= ICONS.length) return;
  const icon = ICONS[iconIdx];
  if (icon.w === 0) return; // blank icon — nothing to draw
  // EXE: type 0 = full height (11px), type 2 = short (7px), others = variable
  // Center vertically within BAR_H (12px row). Full height icons start at y.
  const yOff = icon.h >= 10 ? 0 : Math.floor((BAR_H - icon.h) / 2);
  drawIconBitmap(x, y + yOff, icon.px, icon.w, icon.h, color);
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

// Draw a bar outline
// EXE: fg_drect(barX-1, y, barX+w, y+0xB) at file 0x2FD08 — 4-sided rectangle
function drawBarOutline(x, y, w, color) {
  hline(x - 1, x + w, y, color);
  hline(x - 1, x + w, y + BAR_H, color);
  fillRect(x - 1, y + 1, x - 1, y + BAR_H - 1, color);
  fillRect(x + w, y + 1, x + w, y + BAR_H - 1, color);
}

// Draw bar fill
// EXE: fg_rect(barX, y+1, barX+fill-1, y+0xA) at file 0x2FD30
function drawBarFill(x, y, fill, color) {
  if (fill <= 0) return;
  for (let row = 1; row <= BAR_H - 1; row++) {
    hline(x, x + fill - 1, y + row, color);
  }
}

// Draw a per-player column inside a multi-player bar
// EXE: helper at file 0x394F2 — fills 6px-wide column from bottom up
function drawBarColumn(barX, barY, idx, fillH, color) {
  const colX = barX + idx * 6;
  if (fillH <= 0) return;
  const h = Math.min(fillH, BAR_H - 1); // EXE: clamped to 0..10 at 0x39498 (10px bar interior)
  const bottom = barY + BAR_H - 1;       // bottom of fill area (y + 10)
  for (let row = 0; row < h; row++) {
    hline(colX, colX + 5, bottom - row, color);
  }
}

// Draw the full HUD into the framebuffer
// EXE: draw_hud() at file 0x2FC84, draw_hud_full() at file 0x301B2
export function drawHud(player, wind, round, opts) {
  // EXE: [EF22] = player's base color (set via fg_setcolor before each draw)
  // EXE: palette 163 = also player's color (fg_setrgb at 0x3030E)
  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
  // EXE: [EF24] = dim text color for depleted/zero-ammo items
  const dimColor = UI_DARK_TEXT;
  const numP = Math.min(config.numPlayers, players.length);

  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];

  // EXE: compute_hud_layout — barX aligned for both rows
  // EXE: si = measureText(name) + 8 (0x2FBF1: add ax,0x8), NOT measureText(name+':')
  // The +8 provides padding between name colon and bar start (~4px more than colon width)
  const barX = LEFT + measureText(player.name) + 8;
  const barWidth = measureText('8888 '); // EXE: DS:0x5778 measurement string
  const afterBarX = barX + barWidth;

  // EXE: fg_fillregion(5, DS:0x518E, screenW-5, screenH-7, [EF28])
  fillRect(LEFT, HUD_Y, config.screenWidth - LEFT - 1, ROW2_Y + BAR_H + 1, UI_BACKGROUND);

  // === Row 1 ===
  // EXE: sprintf(buf, "%s:", name) then fg_text at (5, HUD_Y) in [EF22]
  drawText(LEFT, HUD_Y, player.name + ':', baseColor);

  if (config.screenWidth <= 320) {
    // --- Basic mode Row 1: multi-player power bar + icons (EXE: draw_hud 0x2FC84) ---
    const barW = numP * 6;
    drawBarOutline(barX, HUD_Y, barW, baseColor);
    drawBarFill(barX, HUD_Y, barW, UI_DEEP_SHADOW);
    // EXE: per-player power columns (helper 0x394F2), height = power/100
    for (let i = 0; i < numP && i < players.length; i++) {
      const fillH = Math.floor(players[i].power / 100);
      const pColor = i * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      drawBarColumn(barX, HUD_Y, i, fillH, pColor);
    }
    // EXE: player icons at afterBarX = barX + 62 + 10
    const iconBaseX = barX + BAR_RESERVED + AFTER_BAR_GAP;
    for (let i = 0; i < numP && i < players.length; i++) {
      const p = players[i];
      const ix = iconBaseX + i * ICON_SPACING;
      if (ix + 6 > config.screenWidth - LEFT) break;
      const pColor = i * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      // EXE: draw_icon_alive (filled in player color) / draw_icon_dead (outline in palette 0xA9)
      const iconColor = p.alive ? pColor : UI_DARK_TEXT;
      drawIcon(ix, HUD_Y, 0, iconColor); // icon 0 = player tank
      if (i === player.index) {
        setPixel(ix + 2, HUD_Y + ICONS[0].h + 2, pColor);
      }
    }
  } else {
    // --- Full mode Row 1: all text (EXE: draw_hud_full 0x301B2) ---
    // EXE: all text drawn in [EF22] = player color
    let x = barX;
    // EXE: sprintf(buf, "%4d", player.power) at [E9D6]
    drawText(x, HUD_Y, String(player.power).padStart(4), baseColor);
    x += barWidth;
    // EXE: sprintf("%s:", "Angle") at DS:0x57BA formats "Angle:" → drawn at E9D8
    // E9DA = E9D8 + measureText("Angle") + 8 (advance uses "Angle" width, not "Angle:")
    drawText(x, HUD_Y, 'Angle:', baseColor);
    x += measureText('Angle') + 8; // EXE: E9DA = E9D8 + measureText("Angle") + 8
    // EXE: sprintf(buf, "%2d", player.angle) at [E9DA] — DS:0x57BE = "%2d"
    drawText(x, HUD_Y, String(player.angle).padStart(2), baseColor);
    x += measureText('99  '); // EXE: DS:0x577E = "99  " (2 digits + 2 spaces)
    // EXE: fg_setrgb(0xA3, R, G, B) sets palette 163 = player color
    // EXE: text_display(E9DC, HUD_Y, struct+0xB6) draws PLAYER NAME in palette 163
    // struct+0xB6 is a far pointer to the player name string (not wind!)
    const nameX = x;  // E9DC — player name x position
    drawText(nameX, HUD_Y, player.name, baseColor);
    // EXE: E9DE = E9DC + measureText("MMMMMMMMMMMMMMM") + 2 → weapon icon position
    // EXE: E9E0 = E9DE + 15 → weapon text position
    const wpnIconX = nameX + measureText('MMMMMMMMMMMMMMM') + 2; // E9DE
    // EXE: draw_player_icon([E9DE], HUD_Y, wpn_idx) — draws selected weapon's icon
    if (player.selectedWeapon >= 0 && player.selectedWeapon < ICONS.length) {
      drawIcon(wpnIconX, HUD_Y, player.selectedWeapon, baseColor);
    }
    const wpnX = wpnIconX + 15; // E9E0 = E9DE + 15
    const wpnFull = ammo === -1 ? weaponName : ammo + ': ' + weaponName;
    drawText(wpnX, HUD_Y, wpnFull, baseColor);
  }

  // === Row 2 ===

  if (config.screenWidth <= 320) {
    // --- Basic mode Row 2: multi-player health + shields bars ---
    // EXE: L1 label = "Max:" (DS:0x2364→DS:0x2EFA, static — no runtime writes)
    drawText(LEFT, ROW2_Y, 'Max:', baseColor);

    // EXE: multi-player health bar
    // EXE: helper at 0x3959F reads struct+0xA2-0xA8 = health/maxHealth*10
    // Web port: player.energy (0-100) / 10 = equivalent 0-10 fill
    const barW = numP * 6;
    drawBarOutline(barX, ROW2_Y, barW, baseColor);
    drawBarFill(barX, ROW2_Y, barW, UI_DEEP_SHADOW);
    for (let i = 0; i < numP && i < players.length; i++) {
      const fillH = Math.floor(players[i].energy / 10);
      const pColor = i * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      drawBarColumn(barX, ROW2_Y, i, fillH, pColor);
    }

    // EXE: "Shields:" label + multi-player shield bar
    // EXE: L2 label = "Shields:" (DS:0x2368→DS:0x2EFE, static)
    // EXE: helper at 0x39544, compute_item_percentage = sub[0x96]*100/maxEnergy/10
    const shieldsLabelX = barX + BAR_RESERVED + AFTER_BAR_GAP;
    drawText(shieldsLabelX, ROW2_Y, 'Shields:', baseColor);
    const shieldsBarX = shieldsLabelX + measureText('Shields:');
    if (shieldsBarX + barW < config.screenWidth - LEFT) {
      drawBarOutline(shieldsBarX, ROW2_Y, barW, baseColor);
      drawBarFill(shieldsBarX, ROW2_Y, barW, UI_DEEP_SHADOW);
      for (let i = 0; i < numP && i < players.length; i++) {
        const p = players[i];
        const maxEnergy = (SHIELD_CONFIG[p.activeShield] || SHIELD_CONFIG[0]).energy || 1;
        const fillH = Math.floor(p.shieldEnergy * 10 / maxEnergy);
        const pColor = i * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
        drawBarColumn(shieldsBarX, ROW2_Y, i, fillH, pColor);
      }
    }

    // Wind text — not in EXE basic mode, added for gameplay usability
    const windTextX = shieldsBarX + barW + 4;
    if (windTextX + measureText('W:-20') < config.screenWidth - LEFT) {
      const windStr = wind === 0 ? 'W:0' : 'W:' + wind;
      drawText(windTextX, ROW2_Y, windStr, baseColor);
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
    drawText(LEFT, ROW2_Y, player.name + ':', baseColor);

    const countFieldW = measureText('99 ');    // DS:579B / 579F / 57A9
    const pctFieldW   = measureText('100% ');  // DS:57A3

    // Widget 1 (0x318D8): fuel at barX = E9EA, format "%4ld" → 4-char integer
    // EXE: shows 0-1000 (per mille). Web: player.energy = 0-100%, so multiply by 10.
    let x = barX; // E9EA
    const fuelVal = Math.max(0, Math.min(1000, Math.round((player.energy || 0) * 10)));
    const fuelColor = fuelVal > 0 ? baseColor : dimColor;
    drawText(x, ROW2_Y, String(fuelVal).padStart(4), fuelColor);
    x += barWidth; // → E9EC

    // Widget 2 (0x3DE9B): battery count at E9EC ("%2d"), icon at E9EE
    // EXE: clears area, formats "%2d" count, calls draw_icon_alive(E9EE, ROW2_Y, D556=43, color)
    // Icon 43 (battery) has width=0 in EXE — blank icon. Web port adds fill bar for usability.
    const batCount = (player.inventory && player.inventory[43]) || 0;
    const batColor = batCount > 0 ? baseColor : dimColor;
    drawText(x, ROW2_Y, String(batCount).padStart(2), batColor);
    x += countFieldW; // → E9EE
    // EXE: draw_icon_alive(x, ROW2_Y, 43, color) — icon 43 is blank (w=0)
    drawIcon(x, ROW2_Y, 43, batColor);
    // Web port: bar fill for visual feedback (not in EXE, but icon is blank there too)
    drawBarOutline(x, ROW2_Y, 25, batColor);
    drawBarFill(x, ROW2_Y, 25, UI_DEEP_SHADOW);
    if (batCount > 0) drawBarFill(x, ROW2_Y, Math.min(25, Math.ceil(batCount * 2.5)), batColor);
    x += 25; // → E9F0

    // Inline (draw_hud_full 0x303CC): parachute count at E9F0, format "%2d" [DS:57D0]
    // EXE: inventory[D554=42] = parachute count
    const paraCount = player.inventory ? (player.inventory[42] || 0) : 0;
    const paraColor = paraCount > 0 ? baseColor : dimColor;
    drawText(x, ROW2_Y, String(paraCount).padStart(2), paraColor);
    x += countFieldW; // → E9F2

    // Widget 3 (0x3DE5E): parachute icon at E9F2
    // EXE: color = struct[0x28] > 0 ? [EF22] : [EF24]
    // EXE: draw_icon_alive(E9F2, ROW2_Y, D554=42, color) — icon 42 is blank (w=0)
    drawIcon(x, ROW2_Y, 42, paraColor);
    // Web port: bar fill for visual feedback
    drawBarOutline(x, ROW2_Y, 25, paraColor);
    drawBarFill(x, ROW2_Y, 25, UI_DEEP_SHADOW);
    if (paraCount > 0) drawBarFill(x, ROW2_Y, Math.min(25, paraCount * 5), paraColor);
    x += 25; // → E9F4

    // Widget 4 (0x3DB30): item display at E9F4, weapon icon at E9F6, % at E9F8
    // EXE: clears E9F4 to E9FA-1, shows count text, draws weapon icon, shows percentage
    const itemCount = ammo === -1 ? 0 : Math.max(0, ammo || 0);
    const itemColor = (ammo === -1 || itemCount > 0) ? baseColor : dimColor;
    drawText(x, ROW2_Y, String(Math.min(99, itemCount)), itemColor);
    x += countFieldW; // → E9F6
    // EXE: draw_icon_alive(E9F6, ROW2_Y, item_index, color) — draws selected weapon icon
    if (player.selectedWeapon >= 0 && player.selectedWeapon < ICONS.length) {
      drawIcon(x, ROW2_Y, player.selectedWeapon, itemColor);
    }
    x += 20; // → E9F8
    // EXE: "%d%%" format at E9F8 — percentage = floor(current * 100 / max)
    // EXE: caps at 99 if not exactly full, min 1 if non-zero (file 0x31D7F)
    // DS:0x5830 = 100.0f multiplier. Web port: use weapon.bundle as max reference.
    let itemPct;
    if (ammo === -1) {
      itemPct = 100;
    } else if (itemCount <= 0) {
      itemPct = 0;
    } else {
      const maxAmmo = weapon ? weapon.bundle : 1;
      itemPct = Math.floor(itemCount * 100 / Math.max(1, maxAmmo));
      if (itemPct >= 100 && itemCount < maxAmmo) itemPct = 99;
      if (itemPct <= 0) itemPct = 1;
      itemPct = Math.min(100, itemPct);
    }
    drawText(x, ROW2_Y, itemPct + '%', itemColor);
    x += pctFieldW; // → E9FA

    // Widget 5 (0x3DC94): shield count at E9FA ("%d" DS:6476), icon/bar at E9FC
    // EXE: clears E9FA to E9FE-1, shows shield type info + bar
    const shieldCount = player.shieldEnergy || 0;
    const shieldColor = shieldCount > 0 ? baseColor : dimColor;
    drawText(x, ROW2_Y, String(Math.min(99, shieldCount)), shieldColor);
    x += countFieldW; // → E9FC
    // EXE: draws shield icon or bar (20px area). Web port: bar fill.
    drawBarOutline(x, ROW2_Y, 20, shieldColor);
    drawBarFill(x, ROW2_Y, 20, UI_DEEP_SHADOW);
    if (shieldCount > 0) drawBarFill(x, ROW2_Y, Math.min(20, Math.round(shieldCount / 5)), shieldColor);
    x += 20; // → E9FE

    // Inline (draw_hud_full 0x303CC): Super Mag count at E9FE, format "%2d" [DS:57D4]
    // EXE: inventory[D566=52] = Super Mag count
    const magCount = player.inventory ? (player.inventory[WPN.SUPER_MAG] || 0) : 0;
    const magColor = magCount > 0 ? baseColor : dimColor;
    drawText(x, ROW2_Y, String(magCount).padStart(2), magColor);
    x += countFieldW; // → EA00

    // Widget 6 (0x3DD59): Super Mag icon at EA00
    // EXE: color = struct[0x2A] != 0 ? [EF22] : [EF24]
    // EXE: draw_icon_alive(EA00, ROW2_Y, D566=52, color) — icon 52 is blank (w=0)
    drawIcon(x, ROW2_Y, WPN.SUPER_MAG, magColor);
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
      const w7Color = shieldTotal > 0 ? baseColor : dimColor;
      drawText(x, ROW2_Y, String(shieldTotal).padStart(3), w7Color);
    }
  }

  // Guided missile indicator (gameplay feature, not from EXE HUD)
  if (opts && opts.guided) {
    drawText(afterBarX, ROW2_Y, 'GUIDED', baseColor);
  }

  // Simultaneous mode aim timer
  if (opts && opts.aimTimer > 0) {
    drawText(afterBarX, ROW2_Y, 'T:' + opts.aimTimer, baseColor);
  }
}

// Draw wind indicator on playfield — separate from HUD
// EXE: draw_wind_indicator at file 0x28F1D (seg 1F7F:2D2D)
// Shows "Wind: N" or "No Wind" text right-aligned with 20px margin,
// plus a directional pixel-arrow triangle (5 columns, narrowing).
// Color: VGA 154 (0x9A). Position: top-right viewport area.
const WIND_COLOR = 154; // VGA 0x9A — wind indicator text + arrow color
export function drawWindIndicator(wind) {
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
  drawText(x, y, text, WIND_COLOR);

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
      setPixel(arrowX, arrowCenterY + di, WIND_COLOR);
      if (di > 0) setPixel(arrowX, arrowCenterY - di, WIND_COLOR);
    }
    arrowX += direction;
  }
}
