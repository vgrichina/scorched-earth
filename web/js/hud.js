// Scorched Earth - HUD Display
// EXE: HUD at file 0x2FBCA, two 12px rows, DS:0x518E = base Y (default 5)
// EXE: Row 1 = "Name:" [power bar] power_value  (name IS the bar label, no separate "Power:")
// EXE: Row 2 = "Wind:"/"No Wind:" [wind bar] "Angle:" angle_value
// EXE: bar outline 12px, fill 10px, width 62px, after-bar gap 10px
// EXE: background cleared from (5,y) to (screenW-5,bottom) — 5px margins

import { config } from './config.js';
import { hline, fillRect } from './framebuffer.js';
import { drawText } from './font.js';
import { BLACK } from './palette.js';
import { WEAPONS } from './weapons.js';
import { isSoundEnabled } from './sound.js';
import { CHAR_W, COLOR_HUD_TEXT, COLOR_HUD_HIGHLIGHT, COLOR_HUD_WARNING,
         PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL } from './constants.js';

// HUD layout constants (from EXE disasm at file 0x2FBCA)
const LEFT = 5;            // EXE: left margin = 5 (mov word [0xe9d4], 0x5)
const HUD_Y = 5;           // EXE: DS:0x518E default = 5
const ROW2_Y = HUD_Y + 12; // EXE: row2 = row1_y + 0x0C (add ax, 0xC at 0x2FD6A)
const BAR_WIDTH = 62;      // EXE: 0x3E (mov si, 0x3E at 0x2FC26)
const BAR_H = 11;          // EXE: bar outline y to y+11 (12px total, add ax,0xB)
const AFTER_BAR_GAP = 10;  // EXE: 0x0A (add ax, 0xA at 0x2FC2E)

// Draw a bar outline — 4-sided rect matching EXE fg_drect call
function drawBarOutline(x, y, w, color) {
  hline(x, x + w + 1, y, color);           // top
  hline(x, x + w + 1, y + BAR_H, color);   // bottom
  fillRect(x, y + 1, x, y + BAR_H - 1, color);         // left side
  fillRect(x + w + 1, y + 1, x + w + 1, y + BAR_H - 1, color); // right side
}

// Draw the full HUD into the framebuffer
export function drawHud(player, wind, round, opts) {
  const baseColor = player.index * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;

  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];
  const ammoStr = ammo === -1 ? '' : ` x${ammo}`;

  // EXE: si = max(fg_getwidth(name)+8, fg_getwidth(label1)+fg_getwidth(":"),
  //              fg_getwidth(label2)+fg_getwidth(": "))
  // barX = 5 + si — both rows share the same barX for vertical alignment
  // name+8 accounts for the ":" appended by sprintf "%s:"
  // label1 = weapon/row2 label (+":"), label2 = "Wind" (+":")
  const nameColonW = (player.name.length + 1) * CHAR_W;
  const wpnColonW = (weaponName.length + 1) * CHAR_W;
  const windColonW = 6 * CHAR_W; // "Wind" + ": " = 48px (EXE label2 measurement)
  const barX = LEFT + Math.max(nameColonW, wpnColonW, windColonW);
  const afterBarX = barX + BAR_WIDTH + AFTER_BAR_GAP;

  // Background — EXE: fg_rect from (5, row1_y) to (screenW-5, bottom)
  fillRect(LEFT, HUD_Y, config.screenWidth - LEFT - 1, ROW2_Y + BAR_H + 1, BLACK);

  // --- Row 1: "Name:" + [power bar] + power_value ---
  // EXE: sprintf(buf, "%s:", player_name) → "Wolfgang:" in player color
  drawText(LEFT, HUD_Y, player.name + ':', baseColor);

  // Power bar (EXE: fg_drect outline + fg_rect fill)
  drawBarOutline(barX, HUD_Y, BAR_WIDTH, COLOR_HUD_TEXT);
  const powerFill = Math.floor((player.power / 1000) * BAR_WIDTH);
  if (powerFill > 0) {
    for (let row = 1; row < BAR_H; row++) {
      hline(barX + 1, barX + powerFill, HUD_Y + row, baseColor);
    }
  }

  // Power value + weapon name (after bar)
  let rx = afterBarX;
  rx += drawText(rx, HUD_Y, String(player.power), COLOR_HUD_TEXT);
  rx += CHAR_W;
  drawText(rx, HUD_Y, weaponName + ammoStr, COLOR_HUD_HIGHLIGHT);

  // Sound indicator (top-right)
  drawText(config.screenWidth - LEFT - CHAR_W, HUD_Y, isSoundEnabled() ? 'S' : 'x',
    isSoundEnabled() ? COLOR_HUD_TEXT : COLOR_HUD_WARNING);

  // --- Row 2: "Wind:"/"No Wind:" + [wind bar] + "Angle:" + angle ---

  if (wind === 0) {
    // EXE: "No Wind:" (DS:0x2B09, sprintf "%s:") — bar not drawn
    drawText(LEFT, ROW2_Y, 'No Wind:', COLOR_HUD_TEXT);
  } else {
    // EXE: "Wind:" (DS:0x2B04, sprintf "%s:")
    drawText(LEFT, ROW2_Y, 'Wind:', COLOR_HUD_TEXT);

    // Wind bar — same dimensions as power bar, with center tick
    const windCenter = barX + Math.floor(BAR_WIDTH / 2);
    drawBarOutline(barX, ROW2_Y, BAR_WIDTH, COLOR_HUD_TEXT);
    fillRect(windCenter, ROW2_Y + 1, windCenter, ROW2_Y + BAR_H - 1, COLOR_HUD_TEXT);

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
  }

  // "Angle:" after wind bar (EXE: sprintf "%s:", "Angle" at after_bar_x, row2_y)
  let ax = afterBarX;
  ax += drawText(ax, ROW2_Y, 'Angle:', COLOR_HUD_TEXT);
  ax += drawText(ax, ROW2_Y, String(player.angle), COLOR_HUD_TEXT);

  // Wind numeric value (after angle)
  if (wind !== 0) {
    ax += CHAR_W;
    const sign = wind > 0 ? '>' : '<';
    ax += drawText(ax, ROW2_Y, sign + Math.abs(wind), COLOR_HUD_TEXT);
  }

  // HP (EXE: extra elements shown when screen_width > 320)
  ax += CHAR_W;
  const hpColor = player.energy > 50 ? COLOR_HUD_TEXT : (player.energy > 25 ? COLOR_HUD_HIGHLIGHT : COLOR_HUD_WARNING);
  drawText(ax, ROW2_Y, 'HP' + player.energy, hpColor);

  // Round number (right-aligned)
  if (round) {
    drawText(config.screenWidth - LEFT - 16, ROW2_Y, 'R' + round, COLOR_HUD_TEXT);
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
