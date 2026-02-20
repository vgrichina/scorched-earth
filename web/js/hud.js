// Scorched Earth - HUD Display
// EXE: status bar rendered in top 14 rows (VGA rows 0-13) of Mode 13h framebuffer
// EXE: displays Power, Angle, Wind, player name, weapon + ammo
// EXE: key config values stored in DS offsets, mouse click regions at DS:0x56AE
// All rendered into the indexed framebuffer using 8x8 bitmap font

import { config } from './config.js';
import { hline, fillRect } from './framebuffer.js';
import { drawText } from './font.js';
import { BLACK } from './palette.js';
import { WEAPONS } from './weapons.js';
import { isSoundEnabled } from './sound.js';

// HUD layout constants (from RE: 2 rows at top of screen)
const HUD_Y = 1;
const BAR_HEIGHT = 5;
const BAR_WIDTH = 62;
const ROW2_Y = HUD_Y + 7;

// Draw the full HUD into the framebuffer
export function drawHud(player, wind, round, opts) {
  // Background strip (true black)
  fillRect(0, 0, config.screenWidth - 1, 14, BLACK);

  const baseColor = player.index * 8 + 4;  // full player color

  // --- Row 1: Player name | Power bar + value | Angle ---

  // Player name in player's color
  drawText(2, HUD_Y, player.name, baseColor);

  // "Pwr" label
  drawText(76, HUD_Y, 'Pwr', 150);

  // Power bar outline
  const barX = 100;
  hline(barX, barX + BAR_WIDTH + 1, HUD_Y, 150);
  hline(barX, barX + BAR_WIDTH + 1, HUD_Y + BAR_HEIGHT + 1, 150);
  // Power bar fill
  const powerFill = Math.floor((player.power / 1000) * BAR_WIDTH);
  for (let row = 1; row <= BAR_HEIGHT; row++) {
    hline(barX + 1, barX + powerFill, HUD_Y + row, baseColor);
  }

  // Power value
  drawText(166, HUD_Y, String(player.power), 150);

  // "Ang" label + value
  drawText(200, HUD_Y, 'Ang', 150);
  drawText(224, HUD_Y, String(player.angle), 150);

  // HP
  drawText(260, HUD_Y, 'HP', 150);
  const hpColor = player.energy > 50 ? 150 : (player.energy > 25 ? 199 : 179);
  drawText(276, HUD_Y, String(player.energy), hpColor);

  // --- Row 2: Weapon name + ammo | Wind ---

  // Weapon name and ammo count
  const weapon = WEAPONS[player.selectedWeapon];
  const weaponName = weapon ? weapon.name : 'Baby Missile';
  const ammo = player.inventory[player.selectedWeapon];
  const ammoStr = ammo === -1 ? '' : ` x${ammo}`;
  drawText(2, ROW2_Y, weaponName + ammoStr, 199);  // yellow fire color

  // Wind display
  const windBarX = 170;
  const windBarW = 60;
  const windCenter = windBarX + Math.floor(windBarW / 2);

  drawText(140, ROW2_Y, 'W', 150);

  // Wind bar outline
  hline(windBarX, windBarX + windBarW, ROW2_Y + 1, 150);
  hline(windBarX, windBarX + windBarW, ROW2_Y + 5, 150);

  // Center tick
  for (let row = 1; row <= 5; row++) {
    hline(windCenter, windCenter, ROW2_Y + row, 150);
  }

  // Wind fill from center
  const maxWindDisplay = config.wind * 4 || 20;
  const windFill = Math.round((wind / maxWindDisplay) * (windBarW / 2));
  if (windFill > 0) {
    for (let row = 2; row <= 4; row++) {
      hline(windCenter + 1, windCenter + windFill, ROW2_Y + row, baseColor);
    }
  } else if (windFill < 0) {
    for (let row = 2; row <= 4; row++) {
      hline(windCenter + windFill, windCenter - 1, ROW2_Y + row, baseColor);
    }
  }

  // Wind value text
  if (wind === 0) {
    drawText(240, ROW2_Y, 'None', 150);
  } else {
    const sign = wind > 0 ? '>' : '<';
    drawText(240, ROW2_Y, sign + Math.abs(wind), 150);
  }

  // Fuel tank indicator
  const fuelCount = player.inventory ? player.inventory[55] : 0;
  if (fuelCount > 0) {
    drawText(260, ROW2_Y, 'F' + fuelCount, 150);
  }

  // Round number (if provided)
  if (round) {
    drawText(296, ROW2_Y, 'R' + round, 150);
  }

  // Sound indicator (top-right)
  drawText(296, HUD_Y, isSoundEnabled() ? 'S' : 'x', isSoundEnabled() ? 150 : 179);

  // Guided missile indicator
  if (opts && opts.guided) {
    drawText(240, ROW2_Y, 'GUIDED', 199);
  }

  // Simultaneous mode aim timer
  if (opts && opts.aimTimer > 0) {
    drawText(240, ROW2_Y, 'T:' + opts.aimTimer, 199);
  }
}
