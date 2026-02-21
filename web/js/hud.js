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
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         UI_DEEP_SHADOW } from './constants.js';

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
  const h = Math.min(fillH, BAR_H - 2); // max 10px (bar interior: y+1 to y+10)
  const bottom = barY + BAR_H - 1;       // bottom of fill area (y + 10)
  for (let row = 0; row < h; row++) {
    hline(colX, colX + 5, bottom - row, color);
  }
}

// Draw the full HUD into the framebuffer
// EXE: draw_hud() at file 0x2FC84, draw_hud_full() at file 0x301B2
export function drawHud(player, wind, round, opts) {
  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
  const numP = Math.min(config.numPlayers, players.length);

  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];
  const ammoStr = ammo === -1 ? '' : ` x${ammo}`;

  // EXE: compute_hud_layout — barX aligned for both rows
  const nameColonW = measureText(player.name + ':');
  const windLabelW = measureText('No Wind:');
  const barX = LEFT + Math.max(nameColonW, windLabelW);
  const barWidth = measureText('8888 '); // Row 2 bar width / text column width
  const afterBarX = barX + barWidth;

  // EXE: fg_fillregion(5, DS:0x518E, screenW-5, screenH-7, DS:0xEF28)
  fillRect(LEFT, HUD_Y, config.screenWidth - LEFT - 1, ROW2_Y + BAR_H + 1, BLACK);

  // === Row 1 ===
  drawText(LEFT, HUD_Y, player.name + ':', baseColor);

  if (config.screenWidth <= 320) {
    // --- Basic mode: multi-player power bar + icons (EXE: draw_hud 0x2FC84) ---
    // EXE: bar width = numPlayers × 6, outline = player color, fill = shadow
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
    // --- Full mode: all text Row 1 (EXE: draw_hud_full 0x301B2) ---
    let x = barX;
    drawText(x, HUD_Y, String(player.power).padStart(4), baseColor);
    x += barWidth;
    drawText(x, HUD_Y, 'Angle:', baseColor);
    x += measureText('Angle:');
    drawText(x, HUD_Y, String(player.angle).padStart(3), baseColor);
    x += measureText('999 ');
    // EXE: wind at fixed color 0xA3 (163)
    if (wind === 0) {
      drawText(x, HUD_Y, 'No Wind', COLOR_HUD_TEXT);
    } else {
      drawText(x, HUD_Y, 'Wind: ' + wind, COLOR_HUD_TEXT);
    }
    x += measureText('No Wind  ');
    // EXE: weapon — format "%d: %s" or "%s"
    const wpnFull = ammo === -1 ? weaponName : ammo + ': ' + weaponName;
    const wpnX = config.screenWidth - LEFT - measureText(wpnFull);
    if (wpnX > x) {
      drawText(wpnX, HUD_Y, wpnFull, COLOR_HUD_HIGHLIGHT);
    }
  }

  // === Row 2: Wind + Angle + Weapon ===

  if (wind === 0) {
    drawText(LEFT, ROW2_Y, 'No Wind:', COLOR_HUD_TEXT);
  } else {
    drawText(LEFT, ROW2_Y, 'Wind:', COLOR_HUD_TEXT);
    // Wind bar — EXE: outline = player color, fill = shadow
    drawBarOutline(barX, ROW2_Y, barWidth, baseColor);
    drawBarFill(barX, ROW2_Y, barWidth, UI_DEEP_SHADOW);
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

  // "Angle:" + angle bar
  const angleLabelW = measureText('Angle:');
  const angleLabelX = afterBarX + measureText('99  ');
  const angleBarX = angleLabelX + angleLabelW;
  const angleBarW = Math.min(barWidth, config.screenWidth - LEFT - angleBarX - 2);
  drawText(angleLabelX, ROW2_Y, 'Angle:', COLOR_HUD_TEXT);

  if (angleBarW > 10) {
    drawBarOutline(angleBarX, ROW2_Y, angleBarW, baseColor);
    drawBarFill(angleBarX, ROW2_Y, angleBarW, UI_DEEP_SHADOW);
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
