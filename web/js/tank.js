// Scorched Earth - Tank Rendering
// EXE source: icons.cpp (seg 0x1F7F+, file base 0x263F0)
// EXE: tank color gradient at file 0x28540, 10 base colors at DS:0x57E2
// EXE: player struct stride 0x6C (108 bytes), far ptr base at DS:CEB8
// EXE: tank/sub struct stride 0xCA (202 bytes), base at DS:D568
// 6 tank types with pixel data tables at DS:0x673E (stride 0x12)
// render_pixel_table at 0x40C19: direction-aware X mirroring
// Barrel: Bresenham line from type-specific origin point

import { setPixel } from './framebuffer.js';
import { getTerrainY, terrain } from './terrain.js';
import { config } from './config.js';
import { bresenhamLine, clamp } from './utils.js';
import { createInventory, WPN } from './weapons.js';
import { PLAYER_PALETTE_STRIDE, FIRE_PAL_BASE } from './constants.js';
import { playParachuteDeploySound, playLandingThudSound, playCrushGlanceSound } from './sound.js';
import { applyShieldDamage } from './shields.js';

// EXE tank type pixel tables (DS:0x673E, stride 0x12, 6 types)
// Each entry: [x_offset_i8, y_offset_i8, color_slot] relative to tank center (bottom-center)
// Terminated by sentinel 0x63 in EXE. Color slot added to player palette base.
// render_pixel_table at file 0x40C19: direction +1 = X+offset, direction -1 = X-offset (mirrored)
export const TANK_TYPES = [
  { // Type 0: Classic dome (DS:0x649C, 35 pixels, 9×5)
    pixels: [
      [-1,-4,0],[0,-4,0],[1,-4,0],
      [-3,-3,0],[-2,-3,0],[-1,-3,1],[0,-3,1],[1,-3,1],[2,-3,0],[3,-3,0],
      [-3,-2,0],[-2,-2,1],[-1,-2,2],[0,-2,2],[1,-2,2],[2,-2,1],[3,-2,0],
      [-4,-1,0],[-3,-1,1],[-2,-1,2],[-1,-1,3],[0,-1,3],[1,-1,3],[2,-1,2],[3,-1,1],[4,-1,0],
      [-4,0,0],[-3,0,1],[-2,0,2],[-1,0,3],[0,0,3],[1,0,3],[2,0,2],[3,0,1],[4,0,0],
    ],
    barrelLen: 7, barrelXOff: 0, barrelYOff: -4, halfWidth: 4
  },
  { // Type 1: Low profile (DS:0x6640, 24 pixels, 9×4)
    pixels: [
      [-1,-3,2],[0,-3,2],[1,-3,2],
      [-4,-2,2],[-1,-2,2],[0,-2,2],[1,-2,2],[4,-2,2],
      [-4,-1,1],[-3,-1,1],[-1,-1,1],[0,-1,1],[1,-1,1],[3,-1,1],[4,-1,1],
      [-4,0,0],[-3,0,0],[-2,0,0],[-1,0,0],[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0],
    ],
    barrelLen: 8, barrelXOff: -3, barrelYOff: -4, halfWidth: 4
  },
  { // Type 2: Antenna tank (DS:0x6577, 31 pixels, 11×6)
    pixels: [
      [-4,-5,2],
      [-4,-4,2],
      [-3,-3,2],[-2,-3,2],
      [-5,-2,0],[-4,-2,0],[-3,-2,0],[-2,-2,1],[-1,-2,1],[0,-2,1],[1,-2,0],[2,-2,0],[3,-2,0],[4,-2,0],[5,-2,0],
      [-5,-1,0],[-3,-1,7],[-1,-1,7],[1,-1,7],[3,-1,7],[5,-1,0],
      [-4,0,7],[-3,0,7],[-2,0,7],[-1,0,7],[0,0,7],[1,0,7],[2,0,7],[3,0,7],[4,0,7],
    ],
    barrelLen: 8, barrelXOff: -2, barrelYOff: -5, halfWidth: 5
  },
  { // Type 3: Tall antenna (DS:0x65D7, 34 pixels, 9×7)
    pixels: [
      [-3,-6,2],
      [-3,-5,2],
      [-2,-4,2],[-1,-4,2],
      [-4,-3,2],[-3,-3,1],[-2,-3,1],[-1,-3,1],[0,-3,1],[1,-3,1],[2,-3,1],[3,-3,1],
      [-4,-2,0],[-3,-2,0],[-2,-2,0],[-1,-2,0],[0,-2,0],[1,-2,0],[2,-2,0],[3,-2,0],[4,-2,0],
      [-4,-1,0],[-2,-1,7],[0,-1,7],[2,-1,7],[4,-1,0],
      [-3,0,7],[-2,0,7],[-1,0,7],[0,0,7],[1,0,7],[2,0,7],[3,0,7],
    ],
    barrelLen: 5, barrelXOff: 1, barrelYOff: -5, halfWidth: 4
  },
  { // Type 4: Turret tank (DS:0x6508, 36 pixels, 11×5)
    pixels: [
      [-3,-4,2],[-2,-4,2],[-1,-4,2],[0,-4,3],[1,-4,3],[2,-4,3],
      [-1,-3,2],[0,-3,2],[1,-3,2],
      [-5,-2,0],[-4,-2,0],[-3,-2,0],[-2,-2,1],[-1,-2,1],[0,-2,1],[1,-2,0],[2,-2,0],[3,-2,0],[4,-2,0],[5,-2,0],
      [-5,-1,0],[-3,-1,7],[-1,-1,7],[1,-1,7],[3,-1,7],[5,-1,0],
      [-4,0,7],[-3,0,7],[-2,0,7],[-1,0,7],[0,0,7],[1,0,7],[2,0,7],[3,0,7],[4,0,7],
    ],
    barrelLen: 6, barrelXOff: -1, barrelYOff: -4, halfWidth: 5
  },
  { // Type 5: Small tank (DS:0x668B, 17 pixels, 7×5)
    pixels: [
      [-3,-4,0],
      [-2,-3,0],
      [-2,-2,0],[-1,-2,0],[0,-2,0],[1,-2,0],[2,-2,0],
      [-3,-1,0],[-2,-1,0],[-1,-1,7],[0,-1,7],[1,-1,0],
      [-4,0,0],[-3,0,0],[-1,0,7],[0,0,7],[1,0,7],
    ],
    barrelLen: 6, barrelXOff: -1, barrelYOff: -5, halfWidth: 4
  },
];

const TANK_WIDTH = 9;       // EXE type 0: 9px wide (-4..+4)
const TANK_HEIGHT = 5;      // EXE type 0: 5px tall (y=-4..0)
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
    fallStartY: 0,          // Y position when fall began (for damage calculation)
    fallDamageAccum: 0,     // EXE: DS:0xCE80[player] — accumulated fall damage
    parachuteDeployed: false, // EXE: sub[0x0C] — true when parachute is actively deployed mid-fall

    // Phase 4: AI + shields
    aiType: 0,           // 0 = human
    activeShield: 0,     // shield type index
    shieldEnergy: 0,
    // batteries: use inventory[43] (Battery item) — not a separate field

    // Tank type (0-5, EXE sub struct [0x00], default type 0)
    tankType: 0,

    // Phase 5: scoring
    team: index,         // EXE: player struct +0x30, default = player index (each on own team)
    score: 0,
    wins: 0,
    earnedInterest: 0,  // EXE: DS:0x235C "Earned interest" shown in shop
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
    flattenTerrainAt(player.x, player.tankType);

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
    p.fallDamageAccum = 0;
    p.parachuteDeployed = false;
    p.shieldEnergy = 0;
    p.activeShield = 0;

    const baseX = margin + Math.floor(spacing * (i + 0.5));
    p.x = clamp(baseX, margin, width - margin - 1);
    flattenTerrainAt(p.x, p.tankType);
    p.y = getTerrainY(p.x);
  }
}

// Flatten a small area of terrain under the tank
function flattenTerrainAt(cx, tankType = 0) {
  const halfW = TANK_TYPES[tankType].halfWidth;
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
      player.fallStartY = player.y;   // record starting position for damage calc
      player.fallDamageAccum = 0;     // EXE: reset accumulator
      player.parachuteDeployed = false; // EXE: sub[0x0C] = 0 at fall start
      anyFalling = true;
    }
  }
  return anyFalling;
}

// EXE: DS:0x5164 = 2 — fall damage per pixel (hardcoded constant)
const FALL_DAMAGE_PER_PIXEL = 2;

// EXE: DS:0x1C68 — frame counter for parachute half-speed (file 0x205F4)
let fallFrameCounter = 0;

// EXE: check_deploy(tank) at 0x202F6 — simulate remaining fall to predict total damage
// Scans terrain below tank, accumulates FALL_DAMAGE_PER_PIXEL per pixel of air
function predictFallDamage(player) {
  const terrainY = getTerrainY(player.x);
  const remainingPixels = Math.max(0, terrainY - player.y);
  return remainingPixels * FALL_DAMAGE_PER_PIXEL;
}

// EXE: Deploy threshold = sub[0x2C]: default 5, with Battery = 10
// File 0x18852: set sub[0x2C]=5; file 0x18872: if Battery owned, sub[0x2C]=10
function getDeployThreshold(player) {
  return player.inventory[WPN.BATTERY] > 0 ? 10 : 5;
}

// EXE: Per-step pixel scan for crush detection (file 0x20690)
// Checks if falling tank overlaps another tank's bounding box
// Returns { victim, overlapCols } or null if no overlap
function detectCrush(faller) {
  const fallerHW = TANK_TYPES[faller.tankType].halfWidth;
  const fallerLeft = faller.x - fallerHW;
  const fallerRight = faller.x + fallerHW;
  const fallerBottom = faller.y; // bottom of tank body (ground line)

  for (const other of players) {
    if (other === faller || !other.alive || other.falling) continue;

    const otherHW = TANK_TYPES[other.tankType].halfWidth;
    const otherLeft = other.x - otherHW;
    const otherRight = other.x + otherHW;
    const otherTop = other.y + TANK_TYPES[other.tankType].barrelYOff; // top of tank
    const otherBottom = other.y; // ground line

    // Check vertical overlap: faller's bottom must be within other tank's vertical extent
    if (fallerBottom < otherTop || fallerBottom > otherBottom) continue;

    // Count horizontal column overlap
    const overlapLeft = Math.max(fallerLeft, otherLeft);
    const overlapRight = Math.min(fallerRight, otherRight);
    const overlapCols = overlapRight - overlapLeft + 1;

    if (overlapCols > 0) {
      return { victim: other, overlapCols };
    }
  }
  return null;
}

// Step falling animation for all tanks, returns true while any are still falling
// EXE: handle_falling_tanks at file 0x205DC
export function stepFallingTanks() {
  fallFrameCounter++; // EXE: DS:0x1C68 incremented each outer loop iteration (0x205F4)

  let anyFalling = false;
  for (const player of players) {
    if (!player.alive || !player.falling) continue;

    // EXE: Parachute half-speed (file 0x20626–0x2063A)
    // When deployed, skip even frames → tank falls on odd frames only = half speed
    if (player.parachuteDeployed) {
      if (fallFrameCounter % 2 === 0) continue;
    }

    // Move tank downward
    player.y += FALL_SPEED;

    // EXE: Parachute deployment check (0x208CD–0x20913)
    // Guard checks (0x20871–0x208CA): sub[0x28]!=0, health>0, inventory[42]>0
    if (!player.parachuteDeployed && player.inventory[42] > 0) {
      const predictedDamage = predictFallDamage(player);
      const threshold = getDeployThreshold(player);
      // EXE: deploy if predicted_damage > threshold (or threshold==0 → immediate)
      if (threshold === 0 || predictedDamage > threshold) {
        // Deploy action (0x208EA–0x20913)
        player.parachuteDeployed = true;   // sub[0x0C] = 1
        player.inventory[42]--;            // consume parachute
        playParachuteDeploySound();        // sound(0x1E, 0x07D0) = 2000 Hz
        // EXE: fg_setrgb flash to white — visual flash handled by palette (omitted for simplicity)
      }
    }

    // EXE: Per-step behavior (0x20A41–0x20A96)
    if (!player.parachuteDeployed) {
      // No parachute: accumulate damage
      player.fallDamageAccum += FALL_DAMAGE_PER_PIXEL * FALL_SPEED;

      // EXE: When DAMAGE_TANKS_ON_IMPACT = Off (0), deal per-step damage
      if (!config.impactDamage) {
        player.energy -= FALL_DAMAGE_PER_PIXEL * FALL_SPEED;
        if (player.energy <= 0) {
          player.energy = 0;
          player.alive = false;
        }
      }
    }
    // EXE: parachute deployed → NO damage accumulation; damage_tank(tank, 0, 1) = no-op
    // EXE: delay(20) per step for visual effect — approximated by half-speed frame skip above

    // EXE: Per-step crush detection (file 0x20690)
    // Check if falling tank overlaps another tank
    const crush = detectCrush(player);
    if (crush) {
      if (crush.overlapCols > 2) {
        // EXE: >2 columns overlap → immediate landing + crush damage (file 0x2071C)
        player.y = crush.victim.y + TANK_TYPES[crush.victim.tankType].barrelYOff; // land on top
        player.falling = false;

        // EXE: Post-landing impact self-damage (0x20AE4)
        if (!player.parachuteDeployed && config.impactDamage) {
          player.energy -= player.fallDamageAccum;
          if (player.energy <= 0) {
            player.energy = 0;
            player.alive = false;
          }
        }

        // EXE: Crush damage to victim: shield_and_damage(victim, accum+50, 1)
        // Damage goes through shield first (file 0x20B4C → 0x3FFD2)
        const crushDmgToVictim = player.fallDamageAccum + 50;
        const throughShield = applyShieldDamage(crush.victim, crushDmgToVictim);
        if (throughShield > 0) {
          crush.victim.energy -= throughShield;
          if (crush.victim.energy <= 0) {
            crush.victim.energy = 0;
            crush.victim.alive = false;
          }
        }

        // EXE: Crush self-damage to faller: damage_tank(self, accum/2+10, 1)
        // Direct damage, no shield (file 0x20B8C)
        const crushSelfDmg = Math.floor(player.fallDamageAccum / 2) + 10;
        player.energy -= crushSelfDmg;
        if (player.energy <= 0) {
          player.energy = 0;
          player.alive = false;
        }

        playLandingThudSound();
        player.parachuteDeployed = false;
        flattenTerrainAt(player.x);
        continue; // skip normal terrain landing check
      } else {
        // EXE: Glancing contact (1-2 columns) → sound(5, 200) but no landing (file 0x207CB)
        playCrushGlanceSound();
      }
    }

    // Check if reached terrain
    const terrainY = getTerrainY(player.x);
    if (player.y >= terrainY) {
      player.y = terrainY;
      player.falling = false;

      // EXE: Post-landing (0x20ACA): sound(0x1E, 0xC8) = 200 Hz thud
      playLandingThudSound();

      if (!player.parachuteDeployed && config.impactDamage) {
        // EXE: DAMAGE_TANKS_ON_IMPACT = On (1) — deal accumulated damage on landing
        // EXE: 0x20AE4: damage_tank(tank, fall_damage_accum[player], 1)
        player.energy -= player.fallDamageAccum;
        if (player.energy <= 0) {
          player.energy = 0;
          player.alive = false;
        }
      }

      player.parachuteDeployed = false;

      // Flatten terrain at landing spot
      flattenTerrainAt(player.x);
    } else {
      anyFalling = true;
    }
  }
  return anyFalling;
}

// Draw a single tank — EXE: render_pixel_table at file 0x40C19
// Pixel data tables at DS:0x649C+ (6 types), direction-aware X mirroring from sub[0x94]
export function drawTank(player) {
  if (!player.alive) return;

  const cx = player.x;            // center X (sub[0x0E])
  const groundY = player.y;       // ground line Y (sub[0x10])
  const baseColor = player.index * PLAYER_PALETTE_STRIDE;
  const type = TANK_TYPES[player.tankType] || TANK_TYPES[0];

  // Direction: EXE sub[0x94], +1=right, -1=left. Determined by angle.
  const dir = player.angle <= 90 ? 1 : -1;

  // Draw body pixels from type table
  for (const [dx, dy, slot] of type.pixels) {
    const px = dir === 1 ? cx + dx : cx - dx;  // mirror X for left-facing
    const py = groundY + dy;
    setPixel(px, py, baseColor + slot);
  }

  // Draw barrel — EXE: draw_barrel at 0x403F5
  // Barrel origin: (cx + dir*barrelXOff, groundY + barrelYOff) — from type table
  const barrelX = cx + dir * type.barrelXOff;
  const barrelY = groundY + type.barrelYOff;
  const barrelColor = baseColor + 4;  // EXE: sub[0x1A]+4

  const angleRad = player.angle * Math.PI / 180;
  // EXE: dir=+1 → endX = startX + cos*len, dir=-1 → endX = startX - cos*len
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const endX = Math.round(barrelX + (dir === 1 ? cosA : -cosA) * type.barrelLen);
  const endY = Math.round(barrelY - sinA * type.barrelLen);

  bresenhamLine(barrelX, barrelY, endX, endY, (x, y) => {
    setPixel(x, y, barrelColor);
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
    y: player.y + Math.floor(TANK_TYPES[player.tankType].barrelYOff / 2),  // center of tank body
    baseColor: player.index * PLAYER_PALETTE_STRIDE,
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
        const palIdx = FIRE_PAL_BASE + Math.floor(t * 29);
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
