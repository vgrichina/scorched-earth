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
//     Used for wind indicator; effectively same as [EF22] = player color
//
// EXE Row 1 layout:
//   Basic mode: Name + multi-player power bar (6px columns) + player icons
//   Full mode:  Name + Power + Angle + Wind (struct+0xB6 text) + Weapon
//
// EXE Row 2 layout (if [0x5142] != 0):
//   Basic mode: Name + multi-player energy bar + Angle + multi-player angle bar
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
import { WEAPONS } from './weapons.js';
import { players } from './tank.js';
import { SHIELD_CONFIG } from './shields.js';
import { PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         UI_DARK_TEXT, UI_DEEP_SHADOW, UI_BACKGROUND } from './constants.js';

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
      if (p.alive) {
        fillRect(ix, HUD_Y + 3, ix + 4, HUD_Y + 7, pColor);
      } else {
        hline(ix, ix + 4, HUD_Y + 3, pColor);
        hline(ix, ix + 4, HUD_Y + 7, pColor);
        fillRect(ix, HUD_Y + 4, ix, HUD_Y + 6, pColor);
        fillRect(ix + 4, HUD_Y + 4, ix + 4, HUD_Y + 6, pColor);
      }
      if (i === player.index) {
        setPixel(ix + 2, HUD_Y + 9, pColor);
      }
    }
  } else {
    // --- Full mode Row 1: all text (EXE: draw_hud_full 0x301B2) ---
    // EXE: all text drawn in [EF22] = player color
    let x = barX;
    // EXE: sprintf(buf, "%4d", player.power) at [E9D6]
    drawText(x, HUD_Y, String(player.power).padStart(4), baseColor);
    x += barWidth;
    // EXE: sprintf(buf, "%s:", "Angle") at [E9D8]
    drawText(x, HUD_Y, 'Angle:', baseColor);
    x += measureText('Angle') + 8; // EXE: E9DA = E9D8 + measureText("Angle") + 8
    // EXE: sprintf(buf, "%2d", player.angle) at [E9DA] — DS:0x57BE = "%2d"
    drawText(x, HUD_Y, String(player.angle).padStart(2), baseColor);
    x += measureText('99  '); // EXE: DS:0x577E = "99  " (2 digits + 2 spaces)
    // EXE: fg_setrgb(0xA3, R, G, B) sets palette 163 = player color
    // EXE: text_display(E9DC, HUD_Y, struct+0xB6) draws wind string in palette 163
    // Web port approximates with text (same color = baseColor)
    if (wind === 0) {
      drawText(x, HUD_Y, 'No Wind', baseColor);
    } else {
      drawText(x, HUD_Y, 'Wind: ' + wind, baseColor);
    }
    x += measureText('No Wind  ');
    // EXE: weapon — format "%d: %s" or "%s", drawn in [EF22]
    const wpnFull = ammo === -1 ? weaponName : ammo + ': ' + weaponName;
    const wpnX = config.screenWidth - LEFT - measureText(wpnFull);
    if (wpnX > x) {
      drawText(wpnX, HUD_Y, wpnFull, baseColor);
    }
  }

  // === Row 2 ===

  if (config.screenWidth <= 320) {
    // --- Basic mode Row 2: multi-player energy + angle bars ---
    // EXE: Row 2 label = player name (DS:0x2364 set to current player name)
    drawText(LEFT, ROW2_Y, player.name + ':', baseColor);

    // EXE: multi-player comparison bar (same structure as Row 1 power bar)
    // EXE: helper at 0x3959F reads struct+0xA2-0xA8 (energy/fuel metric)
    // Web port: shows energy comparison (player.energy / 10 for 0-10px height)
    const barW = numP * 6;
    drawBarOutline(barX, ROW2_Y, barW, baseColor);
    drawBarFill(barX, ROW2_Y, barW, UI_DEEP_SHADOW);
    for (let i = 0; i < numP && i < players.length; i++) {
      const fillH = Math.floor(players[i].energy / 10);
      const pColor = i * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
      drawBarColumn(barX, ROW2_Y, i, fillH, pColor);
    }

    // EXE: "Angle:" label + multi-player angle bar
    // EXE: helper at 0x39544, angle / 10 for column height (0-18 → 0-10px)
    const angleLabelX = barX + BAR_RESERVED + AFTER_BAR_GAP;
    drawText(angleLabelX, ROW2_Y, 'Angle:', baseColor);
    const angleBarX = angleLabelX + measureText('Angle:');
    if (angleBarX + barW < config.screenWidth - LEFT) {
      drawBarOutline(angleBarX, ROW2_Y, barW, baseColor);
      drawBarFill(angleBarX, ROW2_Y, barW, UI_DEEP_SHADOW);
      for (let i = 0; i < numP && i < players.length; i++) {
        const fillH = Math.floor(players[i].angle / 18);
        const pColor = i * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
        drawBarColumn(angleBarX, ROW2_Y, i, fillH, pColor);
      }
    }

    // Wind text — not in EXE basic mode, added for gameplay usability
    const windTextX = angleBarX + barW + 4;
    if (windTextX + measureText('W:-20') < config.screenWidth - LEFT) {
      const windStr = wind === 0 ? 'W:0' : 'W:' + wind;
      drawText(windTextX, ROW2_Y, windStr, baseColor);
    }
  } else {
    // --- Full mode Row 2: inventory widgets (EXE: draw_hud_full 0x301B2) ---
    // EXE: Row 2 label = player name (DS:0x2364), drawn in [EF22]
    drawText(LEFT, ROW2_Y, player.name + ':', baseColor);

    let x = barX;

    // Widget 1: Energy/fuel bar (EXE: 0x318D8, 48px bar, fuel percentage)
    // EXE: (total - spent) * 100 / total → percentage, formats "%4ld"
    const energyBarW = Math.min(40, barWidth);
    drawBarOutline(x, ROW2_Y, energyBarW, baseColor);
    drawBarFill(x, ROW2_Y, energyBarW, UI_DEEP_SHADOW);
    const energyFill = Math.floor((player.energy / 100) * energyBarW);
    drawBarFill(x, ROW2_Y, energyFill, baseColor);
    x += energyBarW + 2;
    // EXE: energy text (format "%d%%")
    const energyColor = player.energy > 0 ? baseColor : dimColor;
    drawText(x, ROW2_Y, player.energy + '%', energyColor);
    x += measureText('100% ');

    // Widget 5: Shield display (EXE: 0x3DC94, reads struct[0x9A] = activeShield)
    // EXE: if shield != [D548](none), show count + bar; else show filled bar
    if (player.activeShield > 0 && x + measureText('Shd:200 ') < config.screenWidth - LEFT) {
      const shieldCfg = SHIELD_CONFIG[player.activeShield];
      const sName = shieldCfg ? shieldCfg.name.slice(0, 4) : 'Shd';
      const sText = sName + ':' + player.shieldEnergy;
      drawText(x, ROW2_Y, sText, baseColor);
      x += measureText(sText) + measureText(' ');
    }

    // Widget 3/6: Key inventory items (EXE: checks struct[0x28], struct[0x2A])
    // Web port: show batteries, parachutes, laser counts
    // EXE pattern: color = count > 0 ? [EF22] : [EF24]
    if (player.batteries > 0 && x + measureText('B:9 ') < config.screenWidth - LEFT) {
      drawText(x, ROW2_Y, 'B:' + player.batteries, baseColor);
      x += measureText('B:9 ');
    }
    const parachutes = player.inventory[42]; // WPN index 42 = Parachute
    if (parachutes > 0 && x + measureText('P:9 ') < config.screenWidth - LEFT) {
      drawText(x, ROW2_Y, 'P:' + parachutes, baseColor);
      x += measureText('P:9 ');
    }
    const lasers = player.inventory[35]; // WPN index 35 = Laser
    if (lasers > 0 && x + measureText('L:9 ') < config.screenWidth - LEFT) {
      drawText(x, ROW2_Y, 'L:' + lasers, baseColor);
      x += measureText('L:9 ');
    }

    // Weapon name + ammo — right-aligned (EXE: format "%d: %s" or "%s")
    const ammoStr = ammo === -1 ? '' : ' x' + ammo;
    const wpnStr = weaponName + ammoStr;
    const wpnX = config.screenWidth - LEFT - measureText(wpnStr);
    if (wpnX > x) {
      drawText(wpnX, ROW2_Y, wpnStr, baseColor);
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
