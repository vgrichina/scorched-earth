// Scorched Earth - HUD Display
// EXE: HUD at file 0x2FBCA, two 12px rows, DS:0x518E = base Y (default 5)
// EXE: labels formatted as "%s:" → "Power:", "Angle:", "Wind:"
// EXE: bar outline 12px (y to y+11), fill 10px (y+1 to y+10), width 62px (0x3E)
// EXE: left margin 5px, bar X computed dynamically from max text widths
// All rendered into the indexed framebuffer using 8x8 bitmap font

import { config } from './config.js';
import { hline, fillRect } from './framebuffer.js';
import { drawText } from './font.js';
import { BLACK } from './palette.js';
import { WEAPONS } from './weapons.js';
import { isSoundEnabled } from './sound.js';

// HUD layout constants (from EXE disasm at file 0x2FBCA)
const LEFT = 5;           // EXE: left margin = 5 (mov word [0xe9d4], 0x5)
const HUD_Y = 1;          // EXE default DS:0x518E = 5; we use 1 to save space
const ROW2_Y = HUD_Y + 12; // EXE: row2 = row1_y + 0x0C (add ax, 0xC at 0x2FD6A)
const BAR_WIDTH = 62;     // EXE: 0x3E (mov si, 0x3E at 0x2FC26)
const BAR_H = 11;         // EXE: bar outline y to y+11 (12px total, add ax,0xB)

// Draw a bar outline — 4-sided rect matching EXE fg_drect call
function drawBarOutline(x, y, w, color) {
  hline(x, x + w + 1, y, color);           // top
  hline(x, x + w + 1, y + BAR_H, color);   // bottom
  fillRect(x, y + 1, x, y + BAR_H - 1, color);         // left side
  fillRect(x + w + 1, y + 1, x + w + 1, y + BAR_H - 1, color); // right side
}

// Draw the full HUD into the framebuffer
export function drawHud(player, wind, round, opts) {
  // Background strip — covers both 12px rows (EXE: fg_rect clear)
  fillRect(0, 0, config.screenWidth - 1, ROW2_Y + BAR_H + 1, BLACK);

  const baseColor = player.index * 8 + 4;  // full player color

  // EXE computes barX dynamically: margin + max(nameW+8, labelW+colonW)
  // Both rows share the same barX for vertical alignment
  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];
  const ammoStr = ammo === -1 ? '' : ` x${ammo}`;
  const nameW = player.name.length * 8;
  const wpnW = (weaponName + ammoStr).length * 8;
  // barX after "Power:" label (48px) + 2px gap, ensuring name/weapon fit too
  const barX = LEFT + Math.max(nameW + 8, wpnW + 8, 48) + 50;
  const valX = barX + BAR_WIDTH + 4;   // EXE: after bar + gap (0x0A in EXE)
  const angX = valX + 36;              // after max power value "1000" (32px) + gap

  // --- Row 1: Player name | Power: bar + value | Angle: value ---

  drawText(LEFT, HUD_Y, player.name, baseColor);
  drawText(barX - 50, HUD_Y, 'Power:', 150); // EXE: "%s:" format, DS:0x2AF8

  // Power bar (EXE: fg_drect outline + fg_rect fill)
  drawBarOutline(barX, HUD_Y, BAR_WIDTH, 150);
  const powerFill = Math.floor((player.power / 1000) * BAR_WIDTH);
  if (powerFill > 0) {
    for (let row = 1; row < BAR_H; row++) {
      hline(barX + 1, barX + powerFill, HUD_Y + row, baseColor);
    }
  }

  drawText(valX, HUD_Y, String(player.power), 150);
  drawText(angX, HUD_Y, 'Angle:', 150);       // EXE: "%s:", DS:0x2AFE
  drawText(angX + 50, HUD_Y, String(player.angle), 150);

  // Sound indicator (top-right)
  drawText(config.screenWidth - 12, HUD_Y, isSoundEnabled() ? 'S' : 'x',
    isSoundEnabled() ? 150 : 179);

  // --- Row 2: Weapon name + ammo | Wind: bar + value | HP | Round ---

  drawText(LEFT, ROW2_Y, weaponName + ammoStr, 199);  // yellow fire color
  drawText(barX - 42, ROW2_Y, 'Wind:', 150);  // EXE: "%s:", DS:0x2B04

  // Wind bar — same width & height as power bar, with center tick
  const windCenter = barX + Math.floor(BAR_WIDTH / 2);
  drawBarOutline(barX, ROW2_Y, BAR_WIDTH, 150);
  fillRect(windCenter, ROW2_Y + 1, windCenter, ROW2_Y + BAR_H - 1, 150); // center tick

  // Wind fill from center
  const maxWindDisplay = config.wind * 4 || 20;
  const windFill = Math.round((wind / maxWindDisplay) * (BAR_WIDTH / 2));
  if (windFill > 0) {
    for (let row = 2; row < BAR_H - 1; row++) {
      hline(windCenter + 1, Math.min(windCenter + windFill, barX + BAR_WIDTH), ROW2_Y + row, baseColor);
    }
  } else if (windFill < 0) {
    for (let row = 2; row < BAR_H - 1; row++) {
      hline(Math.max(windCenter + windFill, barX + 1), windCenter - 1, ROW2_Y + row, baseColor);
    }
  }

  // Wind value text
  if (wind === 0) {
    drawText(valX, ROW2_Y, 'None', 150);
  } else {
    const sign = wind > 0 ? '>' : '<';
    drawText(valX, ROW2_Y, sign + Math.abs(wind), 150);
  }

  // HP (EXE: extra elements shown only when screen > 320px; we always show)
  const hpColor = player.energy > 50 ? 150 : (player.energy > 25 ? 199 : 179);
  drawText(angX, ROW2_Y, 'HP' + player.energy, hpColor);

  // Round number
  if (round) {
    drawText(config.screenWidth - 20, ROW2_Y, 'R' + round, 150);
  }

  // Guided missile indicator (overwrites wind value area)
  if (opts && opts.guided) {
    drawText(valX, ROW2_Y, 'GUIDED', 199);
  }

  // Simultaneous mode aim timer
  if (opts && opts.aimTimer > 0) {
    drawText(valX, ROW2_Y, 'T:' + opts.aimTimer, 199);
  }
}
