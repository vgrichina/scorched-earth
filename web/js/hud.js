// Scorched Earth - HUD Display
// EXE: HUD draw at file 0x2FC84, layout compute at 0x2FBCA
// EXE: Row 1 = "Name:" [power bar] + per-player status icons
// EXE: Row 2 = "Wind:"/"No Wind:" [wind bar] "Angle:" [angle bar] + per-player data
// EXE: bar outline at barX-1 (fg_drect), fill at barX (fg_rect)
// EXE: angle shown as BAR (second bar on Row 2), not just a number
// EXE: background cleared from (5,y) to (screenW-5, bottom)

import { config } from './config.js';
import { hline, fillRect, setPixel } from './framebuffer.js';
import { drawText, measureText } from './font.js';
import { BLACK } from './palette.js';
import { WEAPONS } from './weapons.js';
import { players } from './tank.js';
import { COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL } from './constants.js';

// HUD layout constants (from EXE disasm at file 0x2FBCA)
const LEFT = 5;            // EXE: left margin = 5 (mov word [0xe9d4], 0x5)
const HUD_Y = 5;           // EXE: DS:0x518E default = 5
const ROW2_Y = HUD_Y + 12; // EXE: row2 = row1_y + 0x0C (add ax, 0xC at 0x2FD6A)
const BAR_WIDTH = 62;      // EXE: 0x3E (mov si, 0x3E at 0x2FC26)
const BAR_H = 11;          // EXE: bar outline y to y+11 (12px total, add ax,0xB)
const AFTER_BAR_GAP = 10;  // EXE: 0x0A (add ax, 0xA at 0x2FC2E)
const ICON_SPACING = 11;   // EXE: imul ax, ax, 0xb at 0x2FE71 — per-player column

// Draw a bar outline — EXE: fg_drect(x-1, y, x+w, y+0xB) 4-sided rect
// x is the interior left edge; outline extends 1px left and 1px right
function drawBarOutline(x, y, w, color) {
  hline(x - 1, x + w, y, color);           // top
  hline(x - 1, x + w, y + BAR_H, color);   // bottom
  fillRect(x - 1, y + 1, x - 1, y + BAR_H - 1, color); // left side
  fillRect(x + w, y + 1, x + w, y + BAR_H - 1, color);  // right side
}

// Draw bar fill — EXE: fg_rect(barX, y+1, barX+fill-1, y+0xA)
function drawBarFill(x, y, fill, color) {
  if (fill <= 0) return;
  for (let row = 1; row <= BAR_H - 1; row++) {
    hline(x, x + fill - 1, y + row, color);
  }
}

// Draw the full HUD into the framebuffer
export function drawHud(player, wind, round, opts) {
  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;

  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];
  const ammoStr = ammo === -1 ? '' : ` x${ammo}`;

  // EXE: barX computed as LEFT + max(nameW+8, row2_label1W+colonW, row2_label2W+colonW)
  // name+8 accounts for the ":" appended by sprintf "%s:"
  const nameColonW = measureText(player.name + ':');
  const windLabelW = measureText('No Wind:'); // worst case for alignment
  const barX = LEFT + Math.max(nameColonW, windLabelW);
  const afterBarX = barX + BAR_WIDTH + AFTER_BAR_GAP;

  // Row 2 second bar position: afterBarX + "Angle:" width
  const angleLabelW = measureText('Angle: ');
  const angleBarX = afterBarX + angleLabelW;
  const angleBarW = Math.min(BAR_WIDTH, config.screenWidth - LEFT - angleBarX - 2);

  // Background — EXE: fg_rect(5, row1_y, screenW-5, bottom, bgColor)
  fillRect(LEFT, HUD_Y, config.screenWidth - LEFT - 1, ROW2_Y + BAR_H + 1, BLACK);

  // === Row 1: "Name:" + [power bar] + per-player icons ===
  // EXE: sprintf(buf, "%s:", player_name) → "Wolfgang:" in player color
  drawText(LEFT, HUD_Y, player.name + ':', baseColor);

  // Power bar — EXE: fg_drect outline at barX-1, fg_rect fill at barX
  drawBarOutline(barX, HUD_Y, BAR_WIDTH, COLOR_HUD_TEXT);
  const powerFill = Math.floor((player.power / 1000) * BAR_WIDTH);
  drawBarFill(barX, HUD_Y, powerFill, baseColor);

  // Power value (overlaid after bar — web UX addition for precision aiming)
  let rx = afterBarX;
  rx += drawText(rx, HUD_Y, String(player.power), COLOR_HUD_TEXT);

  // Per-player alive/dead status icons (EXE: 11px columns in after-bar area)
  // EXE: function at 0x1f71:0xc7 draws per-player indicator at afterBarX + idx*11
  const iconBaseX = afterBarX + measureText('0000'); // after power value
  for (let i = 0; i < config.numPlayers && i < players.length; i++) {
    const p = players[i];
    const ix = iconBaseX + i * ICON_SPACING;
    if (ix + 6 > config.screenWidth - LEFT) break; // clip to screen
    const pColor = i * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
    if (p.alive) {
      // Alive: filled 5x5 colored square
      fillRect(ix, HUD_Y + 3, ix + 4, HUD_Y + 7, pColor);
    } else {
      // Dead: outline only
      hline(ix, ix + 4, HUD_Y + 3, pColor);
      hline(ix, ix + 4, HUD_Y + 7, pColor);
      fillRect(ix, HUD_Y + 4, ix, HUD_Y + 6, pColor);
      fillRect(ix + 4, HUD_Y + 4, ix + 4, HUD_Y + 6, pColor);
    }
    // Highlight current player
    if (i === player.index) {
      setPixel(ix + 2, HUD_Y + 9, pColor);
    }
  }

  // === Row 2: "Wind:" + [wind bar] + "Angle:" + [angle bar] ===

  if (wind === 0) {
    // EXE: "No Wind:" (DS:0x2B09, sprintf "%s:") — bar not drawn
    drawText(LEFT, ROW2_Y, 'No Wind:', COLOR_HUD_TEXT);
  } else {
    // EXE: "Wind:" (DS:0x2B04, sprintf "%s:")
    drawText(LEFT, ROW2_Y, 'Wind:', COLOR_HUD_TEXT);

    // Wind bar — same dimensions as power bar, with center tick
    drawBarOutline(barX, ROW2_Y, BAR_WIDTH, COLOR_HUD_TEXT);
    const windCenter = barX + Math.floor(BAR_WIDTH / 2);
    fillRect(windCenter, ROW2_Y + 1, windCenter, ROW2_Y + BAR_H - 1, COLOR_HUD_TEXT);

    // Wind fill from center
    const maxWindDisplay = config.wind * 4 || 20;
    const windFill = Math.round((wind / maxWindDisplay) * (BAR_WIDTH / 2));
    if (windFill > 0) {
      for (let row = 2; row < BAR_H - 1; row++) {
        hline(windCenter + 1, Math.min(windCenter + windFill, barX + BAR_WIDTH - 1), ROW2_Y + row, baseColor);
      }
    } else if (windFill < 0) {
      for (let row = 2; row < BAR_H - 1; row++) {
        hline(Math.max(windCenter + windFill, barX), windCenter - 1, ROW2_Y + row, baseColor);
      }
    }
  }

  // "Angle:" label + angle bar (EXE: second bar on Row 2 at [0xe9ee])
  drawText(afterBarX, ROW2_Y, 'Angle:', COLOR_HUD_TEXT);

  if (angleBarW > 10) {
    // Angle bar: 0-180° mapped to bar width
    drawBarOutline(angleBarX, ROW2_Y, angleBarW, COLOR_HUD_TEXT);
    const angleFill = Math.floor((player.angle / 180) * angleBarW);
    drawBarFill(angleBarX, ROW2_Y, angleFill, baseColor);

    // Angle value after bar (web UX addition for precision)
    const angleAfterX = angleBarX + angleBarW + 3;
    if (angleAfterX + measureText('180') < config.screenWidth - LEFT) {
      drawText(angleAfterX, ROW2_Y, String(player.angle), COLOR_HUD_TEXT);
    }
  } else {
    // Not enough room for angle bar — just show number
    drawText(angleBarX, ROW2_Y, String(player.angle), COLOR_HUD_TEXT);
  }

  // Weapon name (Row 2, right-aligned — web UX addition)
  const wpnStr = weaponName + ammoStr;
  const wpnX = config.screenWidth - LEFT - measureText(wpnStr);
  if (wpnX > angleBarX + angleBarW + measureText('    ')) {
    drawText(wpnX, ROW2_Y, wpnStr, COLOR_HUD_HIGHLIGHT);
  }

  // Guided missile indicator (overwrites after-bar area)
  if (opts && opts.guided) {
    drawText(afterBarX, ROW2_Y, 'GUIDED', COLOR_HUD_HIGHLIGHT);
  }

  // Simultaneous mode aim timer
  if (opts && opts.aimTimer > 0) {
    drawText(afterBarX, ROW2_Y, 'T:' + opts.aimTimer, COLOR_HUD_HIGHLIGHT);
  }
}
