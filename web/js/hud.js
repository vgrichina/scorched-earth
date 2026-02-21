// Scorched Earth - HUD Display
// EXE source: play.cpp (seg 0x28B9, file base 0x2F830)
//
// EXE functions:
//   draw_hud()              — file 0x2FC84 (2910:0184) — main HUD draw
//   compute_hud_layout()    — file 0x2FBCA (2910:00CA) — basic mode X-position calc
//   compute_hud_layout_full — file 0x2FEBE (294B:000E) — expanded mode full layout
//   draw_hud_full()         — file 0x301B2 (2950:02B2) — expanded mode draw
//   draw_player_icon()      — file 0x261D7 (1F7D:0007) — per-player icon (icons.cpp)
//   update_hud_row1()       — file 0x307E8 (29C0:01E8) — partial Row 1 redraw
//
// EXE layout variables (all computed dynamically via fg_getwidth):
//   DS:0xE9D4 = left margin (always 5)
//   DS:0xE9D6 = Row 1 bar X (power bar left edge)
//   DS:0xE9D8 = after bar (power value area), = barX + fg_getwidth("8888 ")
//   DS:0xE9DA = per-player icon base X
//   DS:0xE9E8 = Row 2 left margin
//   DS:0xE9EA = Row 2 bar X (wind bar), aligned with Row 1 bar
//   DS:0xE9EC = Row 2 after-bar (angle label)
//   DS:0xE9EE = Row 2 angle bar X
//   DS:0x518E = HUD Y position (default 5)
//
// EXE mode flag DS:0x5142: 0 = basic (Row 1 only), nonzero = expanded (Row 1 + Row 2)
// Web port always draws expanded (both rows).
//
// EXE label strings:
//   DS:0x2AF8 "Power"  (file 0x058878)  — Row 1 label (expanded mode)
//   DS:0x2AFE "Angle"  (file 0x05887E)  — Row 2 angle label
//   DS:0x2B04 "Wind"   (file 0x058884)  — Row 2 wind label
//   DS:0x2B09 "No Wind" (file 0x058889) — Row 2 no-wind label
//   Format: sprintf(buf, "%s:", label) via DS:0x576C = "%s:"
//
// EXE measurement strings (for dynamic column widths):
//   DS:0x5778 "8888 "   — power bar width measurement
//   DS:0x577E "99  "    — angle value column width
//   DS:0x5783 "MMMMMMMMMMMMMMM" — weapon name column (15 M's)
//   DS:0x57AD "999 "    — wide-screen extra field (screen > 320px)
//
// EXE colors:
//   DS:0xEF22 = bright highlight / player color (bar fills, selected items)
//   DS:0xEF24 = dark text (depleted weapon color)
//   DS:0xEF28 = background fill (HUD clear)
//   DS:0xEF2C = deep shadow (bar outlines)
//   0xA3 (163) = fixed color for wind label (push word 0xA3 at 0x3030B)
//
// EXE background clear: fg_fillregion(5, DS:0x518E, screenW-5, screenH-7, DS:0xEF28)
//   — clears from HUD top to near screen bottom (file 0x2FCB0)

import { config } from './config.js';
import { hline, fillRect, setPixel } from './framebuffer.js';
import { drawText, measureText } from './font.js';
import { BLACK } from './palette.js';
import { WEAPONS } from './weapons.js';
import { players } from './tank.js';
import { COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL } from './constants.js';

// HUD layout constants
// EXE: compute_hud_layout at file 0x2FBCA computes all positions dynamically
const LEFT = 5;            // EXE: mov word [0xE9D4], 0x5 — left margin
const HUD_Y = 5;           // EXE: DS:0x518E default = 5
const ROW2_Y = HUD_Y + 12; // EXE: add ax, 0xC at file 0x303F5 — row2 = row1 + 12
const BAR_H = 11;          // EXE: add ax, 0xB at file 0x2FCF0 — bar outline 12px total
const ICON_SPACING = 11;   // EXE: imul ax, ax, 0xB at file 0x2FE71

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

// Draw the full HUD into the framebuffer
// EXE: draw_hud() at file 0x2FC84, draw_hud_full() at file 0x301B2
export function drawHud(player, wind, round, opts) {
  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;

  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];
  const ammoStr = ammo === -1 ? '' : ` x${ammo}`;

  // EXE: compute_hud_layout at file 0x2FEBE measures label strings with fg_getwidth()
  // barX = LEFT + fg_getwidth(sprintf("%s:", name))
  // Bars align Row 1 and Row 2 — barX = max(nameColonW, windLabelW)
  const nameColonW = measureText(player.name + ':');
  const windLabelW = measureText('No Wind:'); // DS:0x2B09 — worst case for alignment
  const barX = LEFT + Math.max(nameColonW, windLabelW);

  // EXE: bar width = fg_getwidth("8888 ") at DS:0x5778 (file 0x2FF07)
  const barWidth = measureText('8888 ');
  const afterBarX = barX + barWidth;

  // EXE: Row 2 angle bar position = afterBarX + fg_getwidth("99  ") + fg_getwidth("Angle:")
  // DS:0xE9EC = after wind bar value, DS:0xE9EE = angle bar X
  const angleLabelW = measureText('Angle:');
  const angleBarX = afterBarX + measureText('99  ') + angleLabelW;
  const angleBarW = Math.min(barWidth, config.screenWidth - LEFT - angleBarX - 2);

  // EXE: fg_fillregion(5, DS:0x518E, screenW-5, screenH-7, DS:0xEF28) at file 0x2FCB0
  fillRect(LEFT, HUD_Y, config.screenWidth - LEFT - 1, ROW2_Y + BAR_H + 1, BLACK);

  // === Row 1: "Name:" + [power bar] + per-player icons ===
  // EXE: sprintf(buf, "%s:", player_name) at file 0x2FCC1 using DS:0x576C = "%s:"
  // EXE: fg_setcolor(DS:0xEF22) then fg_text() at file 0x2FCDA
  drawText(LEFT, HUD_Y, player.name + ':', baseColor);

  // Power bar — EXE: fg_drect outline at barX-1 (file 0x2FD08), fg_rect fill (file 0x2FD30)
  // EXE: outline color = DS:0xEF2C (deep shadow)
  drawBarOutline(barX, HUD_Y, barWidth, COLOR_HUD_TEXT);
  const powerFill = Math.floor((player.power / 1000) * barWidth);
  drawBarFill(barX, HUD_Y, powerFill, baseColor);

  // EXE: power value at DS:0xE9D8 = barX + fg_getwidth("8888 "), format "%4d" (DS:0x57B6)
  drawText(afterBarX, HUD_Y, String(player.power), COLOR_HUD_TEXT);

  // Per-player alive/dead status icons
  // EXE: draw_player_icon() at file 0x261D7 (icons.cpp, 1F7D:0007)
  // EXE: x = DS:0xE9DA + player.field_0xA0 * 11, y = DS:0x518E (file 0x2FE5A-0x2FE7E)
  // EXE: icon data from DS:0x3826 (stride 0x7D, 48 icons max)
  const iconBaseX = afterBarX + measureText('0000');
  for (let i = 0; i < config.numPlayers && i < players.length; i++) {
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

  // === Row 2: "Wind:" + [wind bar] + "Angle:" + [angle bar] ===
  // EXE: Row 2 y = DS:0x518E + 0x0C (file 0x303F5)

  if (wind === 0) {
    // EXE: "No Wind:" — DS:0x2B09 (file 0x058889), sprintf "%s:" (DS:0x576C)
    drawText(LEFT, ROW2_Y, 'No Wind:', COLOR_HUD_TEXT);
  } else {
    // EXE: "Wind:" — DS:0x2B04 (file 0x058884), sprintf "%s:" (DS:0x576C)
    drawText(LEFT, ROW2_Y, 'Wind:', COLOR_HUD_TEXT);

    // Wind bar — same dimensions as power bar, with center tick
    drawBarOutline(barX, ROW2_Y, barWidth, COLOR_HUD_TEXT);
    const windCenter = barX + Math.floor(barWidth / 2);
    fillRect(windCenter, ROW2_Y + 1, windCenter, ROW2_Y + BAR_H - 1, COLOR_HUD_TEXT);

    const maxWindDisplay = config.wind * 4 || 20;
    const windFill = Math.round((wind / maxWindDisplay) * (barWidth / 2));
    if (windFill > 0) {
      for (let row = 2; row < BAR_H - 1; row++) {
        hline(windCenter + 1, Math.min(windCenter + windFill, barX + barWidth - 1), ROW2_Y + row, baseColor);
      }
    } else if (windFill < 0) {
      for (let row = 2; row < BAR_H - 1; row++) {
        hline(Math.max(windCenter + windFill, barX), windCenter - 1, ROW2_Y + row, baseColor);
      }
    }
  }

  // "Angle:" label + angle bar
  // EXE: "Angle" at DS:0x2AFE (file 0x05887E), sprintf "%s:" (DS:0x5774)
  // EXE: angle bar X at DS:0xE9EE, angle value format "%2d" (DS:0x57BE)
  const angleLabelX = afterBarX + measureText('99  ');
  drawText(angleLabelX, ROW2_Y, 'Angle:', COLOR_HUD_TEXT);

  if (angleBarW > 10) {
    drawBarOutline(angleBarX, ROW2_Y, angleBarW, COLOR_HUD_TEXT);
    const angleFill = Math.floor((player.angle / 180) * angleBarW);
    drawBarFill(angleBarX, ROW2_Y, angleFill, baseColor);

    const angleAfterX = angleBarX + angleBarW + 3;
    if (angleAfterX + measureText('180') < config.screenWidth - LEFT) {
      drawText(angleAfterX, ROW2_Y, String(player.angle), COLOR_HUD_TEXT);
    }
  } else {
    drawText(angleBarX, ROW2_Y, String(player.angle), COLOR_HUD_TEXT);
  }

  // Weapon name — right-aligned on Row 2
  // EXE: weapon name at DS:0xE9DE area, format "%d: %s" (DS:0x57C5) or "%s" (DS:0x57C2)
  // EXE: depleted weapons use DS:0xEF24 color (file 0x30452-0x30462)
  const wpnStr = weaponName + ammoStr;
  const wpnX = config.screenWidth - LEFT - measureText(wpnStr);
  if (wpnX > angleBarX + angleBarW + measureText('    ')) {
    drawText(wpnX, ROW2_Y, wpnStr, COLOR_HUD_HIGHLIGHT);
  }

  // Guided missile indicator
  if (opts && opts.guided) {
    drawText(afterBarX, ROW2_Y, 'GUIDED', COLOR_HUD_HIGHLIGHT);
  }

  // Simultaneous mode aim timer
  if (opts && opts.aimTimer > 0) {
    drawText(afterBarX, ROW2_Y, 'T:' + opts.aimTimer, COLOR_HUD_HIGHLIGHT);
  }
}
