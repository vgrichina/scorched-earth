// Scorched Earth - Tank Rendering
// EXE source: icons.cpp (seg 0x1F7F+, file base 0x263F0)
// EXE: tank color gradient at file 0x28540, 10 base colors at DS:0x57E2
// EXE: player struct stride 0x6C (108 bytes), far ptr base at DS:CEB8
// EXE: tank/sub struct stride 0xCA (202 bytes), base at DS:D568
// Dome: 7px wide, 5px tall (1 base line + 4px rise)
// Body: 7px wide rectangle below dome
// Barrel: Bresenham line from dome center, BARREL_LENGTH=12

import { setPixel, hline } from './framebuffer.js';
import { getTerrainY, terrain } from './terrain.js';
import { config } from './config.js';
import { bresenhamLine, clamp } from './utils.js';
import { createInventory, WPN } from './weapons.js';

// Tank dimensions — EXE: verified from icons.cpp disassembly (file 0x263F0+)
const TANK_WIDTH = 7;       // EXE: 7px wide dome and body
const DOME_HEIGHT = 5;      // EXE: 1px base line + 4px rise (dome peak at y-4)
const BODY_HEIGHT = 4;      // EXE: 4px tall body rectangle below dome
const BARREL_LENGTH = 12;   // EXE: barrel extends 12px from dome center (fire_weapon at 0x30652)
const FALL_SPEED = 2;       // pixels per frame when falling

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

    // Phase 3: weapon inventory
    inventory: createInventory(),
    selectedWeapon: WPN.BABY_MISSILE,

    // Phase 3: falling state
    falling: false,
    fallTargetY: 0,

    // Phase 4: AI + shields
    aiType: 0,           // 0 = human
    activeShield: 0,     // shield type index
    shieldEnergy: 0,
    batteries: 0,

    // Phase 5: scoring
    score: 0,
    wins: 0,
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

// Reset existing players for a new round and reposition on terrain
// Preserves identity (name, aiType, score, cash, wins, inventory)
export function resetAndPlaceTanks() {
  const width = config.screenWidth;
  const margin = 20;
  const usable = width - 2 * margin;
  const numPlayers = players.length;
  const spacing = Math.floor(usable / numPlayers);

  for (let i = 0; i < numPlayers; i++) {
    const p = players[i];
    p.alive = true;
    p.energy = 100;
    p.angle = 90;
    p.power = 500;
    p.falling = false;
    p.shieldEnergy = 0;
    p.activeShield = 0;

    const baseX = margin + Math.floor(spacing * (i + 0.5));
    p.x = clamp(baseX, margin, width - margin - 1);
    flattenTerrainAt(p.x);
    p.y = getTerrainY(p.x);
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

// Check all tanks and start falling if terrain was removed beneath them
export function checkTanksFalling() {
  let anyFalling = false;
  for (const player of players) {
    if (!player.alive) continue;
    const terrainY = getTerrainY(player.x);
    if (terrainY > player.y + 1) {  // terrain is below tank
      player.falling = true;
      player.fallTargetY = terrainY;
      anyFalling = true;
    }
  }
  return anyFalling;
}

// Step falling animation for all tanks, returns true while any are still falling
export function stepFallingTanks() {
  let anyFalling = false;
  for (const player of players) {
    if (!player.alive || !player.falling) continue;

    // Move tank downward
    player.y += FALL_SPEED;

    // Check if reached terrain
    const terrainY = getTerrainY(player.x);
    if (player.y >= terrainY) {
      player.y = terrainY;
      player.falling = false;

      // EXE: Parachute (idx 42) prevents fall damage, consumed on use
      const fallDist = terrainY - player.fallTargetY;
      if (fallDist > 10) {
        if (player.inventory[42] > 0) {
          player.inventory[42]--;  // consume parachute
        } else {
          // Fall damage: 1 point per 5 pixels fallen
          const damage = Math.floor(fallDist / 5);
          player.energy -= damage;
          if (player.energy <= 0) {
            player.energy = 0;
            player.alive = false;
          }
        }
      }

      // Flatten terrain at landing spot
      flattenTerrainAt(player.x);
    } else {
      anyFalling = true;
    }
  }
  return anyFalling;
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

// --- Tank death animation system ---
// Visual overlay only — does not affect alive/dead game logic
export const deathAnimations = [];

export function startDeathAnimation(player) {
  deathAnimations.push({
    x: player.x,
    y: player.y - 4,  // center of tank body
    baseColor: player.index * 8,
    frame: 0,
    maxFrames: 20,
  });
}

export function stepDeathAnimations() {
  for (let i = deathAnimations.length - 1; i >= 0; i--) {
    deathAnimations[i].frame++;
    if (deathAnimations[i].frame >= deathAnimations[i].maxFrames) {
      deathAnimations.splice(i, 1);
    }
  }
}

export function drawDeathAnimations() {
  for (const anim of deathAnimations) {
    const t = anim.frame / anim.maxFrames;
    const radius = Math.floor(12 * t);

    // Expanding ring of fire-palette particles
    for (let angle = 0; angle < 360; angle += 15) {
      const rad = angle * Math.PI / 180;
      const px = Math.round(anim.x + Math.cos(rad) * radius);
      const py = Math.round(anim.y + Math.sin(rad) * radius);
      if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
        const palIdx = 170 + Math.floor(t * 29);
        setPixel(px, py, palIdx);
      }
    }

    // Disintegrating pixels in player's color scattering outward
    const scatterCount = Math.floor(8 * (1 - t));
    for (let i = 0; i < scatterCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = radius * 0.5 + Math.random() * radius * 0.5;
      const px = Math.round(anim.x + Math.cos(ang) * dist);
      const py = Math.round(anim.y + Math.sin(ang) * dist);
      if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
        setPixel(px, py, anim.baseColor + 2 + Math.floor(Math.random() * 3));
      }
    }
  }
}
