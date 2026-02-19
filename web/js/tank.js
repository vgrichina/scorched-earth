// Scorched Earth - Tank Rendering (icons.cpp RE)
// Dome: 7px wide, 5px tall (1 base line + 4px rise)
// Body: 7px wide rectangle below dome
// Barrel: Bresenham line from dome center

import { setPixel, hline } from './framebuffer.js';
import { getTerrainY, terrain } from './terrain.js';
import { config } from './config.js';
import { bresenhamLine, clamp } from './utils.js';

// Tank dimensions
const TANK_WIDTH = 7;
const DOME_HEIGHT = 5;      // 4px rise + 1px base line
const BODY_HEIGHT = 4;
const BARREL_LENGTH = 12;

// Player state
export const players = [];

export function createPlayer(index, name) {
  return {
    index,
    name,
    x: 0,                // center X on screen
    y: 0,                // ground Y (bottom of tank body)
    angle: 90,           // 0=right, 90=up, 180=left (degrees)
    power: 500,          // 0-1000
    alive: true,
    energy: 100,
    cash: config.startCash,
  };
}

// Place tanks evenly across terrain with some randomization
export function placeTanks(numPlayers) {
  players.length = 0;
  const width = config.screenWidth;
  const margin = 20;
  const usable = width - 2 * margin;
  const spacing = Math.floor(usable / numPlayers);

  for (let i = 0; i < numPlayers; i++) {
    const player = createPlayer(i, `Player ${i + 1}`);

    // Distribute evenly with small random offset
    const baseX = margin + Math.floor(spacing * (i + 0.5));
    player.x = clamp(baseX, margin, width - margin - 1);

    // Flatten terrain under tank for stable placement
    flattenTerrainAt(player.x);

    // Tank sits on terrain
    player.y = getTerrainY(player.x);

    players.push(player);
  }
}

// Flatten a small area of terrain under the tank
function flattenTerrainAt(cx) {
  const halfW = Math.floor(TANK_WIDTH / 2);
  // Find average height in tank footprint
  let sum = 0, count = 0;
  for (let x = cx - halfW; x <= cx + halfW; x++) {
    if (x >= 0 && x < config.screenWidth) {
      sum += terrain[x];
      count++;
    }
  }
  const avgY = Math.floor(sum / count);

  // Set terrain to average
  for (let x = cx - halfW; x <= cx + halfW; x++) {
    if (x >= 0 && x < config.screenWidth) {
      terrain[x] = avgY;
    }
  }
}

// Draw a single tank
export function drawTank(player) {
  if (!player.alive) return;

  const cx = player.x;            // center X
  const groundY = player.y;       // ground line Y (terrain surface)
  const baseColor = player.index * 8;  // VGA palette base for this player

  // --- Body: filled rectangle ---
  const bodyTop = groundY - BODY_HEIGHT;
  const bodyLeft = cx - 3;
  const bodyRight = cx + 3;

  // Body with gradient bands (slots 1-4: dark to light, bottom to top)
  for (let row = 0; row < BODY_HEIGHT; row++) {
    const y = bodyTop + row;
    // Gradient: top rows lighter (slot 4), bottom rows darker (slot 1)
    const slot = 4 - Math.floor(row * 3 / BODY_HEIGHT);
    hline(bodyLeft, bodyRight, y, baseColor + slot);
  }

  // --- Dome: 7px wide, 5 rows high, 3D shading ---
  // Dome sits on top of body
  const domeBaseY = bodyTop;
  const domeLeft = cx - 3;

  // Base line (7px wide)
  hline(domeLeft, domeLeft + 6, domeBaseY, baseColor + 3);

  // Left side ascending (darker color, slot 2)
  const leftColor = baseColor + 2;
  setPixel(domeLeft + 0, domeBaseY - 1, leftColor);
  setPixel(domeLeft + 1, domeBaseY - 2, leftColor);
  setPixel(domeLeft + 2, domeBaseY - 3, leftColor);
  setPixel(domeLeft + 3, domeBaseY - 4, leftColor);  // peak

  // Right side descending (highlight, slot 4)
  const rightColor = baseColor + 4;
  setPixel(domeLeft + 4, domeBaseY - 3, rightColor);
  setPixel(domeLeft + 5, domeBaseY - 2, rightColor);
  setPixel(domeLeft + 6, domeBaseY - 1, rightColor);

  // Fill dome interior
  // Row by row, fill between left and right outlines
  // Row -1 from base: columns 0 and 6 are edges, fill 1-5
  for (let col = 1; col <= 5; col++) setPixel(domeLeft + col, domeBaseY - 1, baseColor + 3);
  // Row -2: columns 1 and 5 are edges, fill 2-4
  for (let col = 2; col <= 4; col++) setPixel(domeLeft + col, domeBaseY - 2, baseColor + 3);
  // Row -3: columns 2 and 4 are edges, fill 3
  setPixel(domeLeft + 3, domeBaseY - 3, baseColor + 3);

  // --- Barrel ---
  drawBarrel(player, cx, domeBaseY - 4, baseColor + 4);
}

// Draw barrel as a line from dome top in the direction of angle
function drawBarrel(player, cx, domeTopY, color) {
  const angleRad = player.angle * Math.PI / 180;
  const endX = Math.round(cx + Math.cos(angleRad) * BARREL_LENGTH);
  const endY = Math.round(domeTopY - Math.sin(angleRad) * BARREL_LENGTH);

  bresenhamLine(cx, domeTopY, endX, endY, (x, y) => {
    setPixel(x, y, color);
  });
}

// Draw all tanks
export function drawAllTanks() {
  for (const player of players) {
    drawTank(player);
  }
}
