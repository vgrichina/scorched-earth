// Scorched Earth - Tank Rendering
// EXE source: icons.cpp (seg 0x1F7F+, file base 0x263F0)
// EXE: tank color gradient at file 0x28540, 10 base colors at DS:0x57E2
// EXE: player struct stride 0x6C (108 bytes), far ptr base at DS:CEB8
// EXE: tank/sub struct stride 0xCA (202 bytes), base at DS:D568
// 7 tank types with pixel data tables at DS:0x673E (stride 0x12)
// render_pixel_table at 0x40C19: direction-aware X mirroring
// Barrel: Bresenham line from type-specific origin point

import { setPixel, getPixel } from './framebuffer.js';
import { getTerrainY, terrain, terrainBitmap, PLAYFIELD_TOP } from './terrain.js';
import { config, GRAPHICS_MODES } from './config.js';
import { resolvedSkyType, getPlayerColor, palette6, setPaletteRgb } from './palette.js';
import { walkExeLine, random } from './utils.js';
import { createInventory, WPN } from './weapons.js';
import { PLAYER_PALETTE_STRIDE, FIRE_PAL_BASE, TERRAIN_PAL_START } from './constants.js';
import { playParachuteDeploySound, playLandingThudSound, playCrushGlanceSound } from './sound.js';
import { applyShieldDamage } from './shields.js';

// EXE tank type pixel tables (DS:0x673E, stride 0x12, 7 types)
// Each entry: [x_offset_i8, y_offset_i8, color_slot] relative to tank center (bottom-center)
// Terminated by sentinel 0x63 in EXE. Color slot added to player palette base.
// render_pixel_table at file 0x40C19: direction +1 = X+offset, direction -1 = X-offset (mirrored)
// Signed triples in EXE order; DS:673E links seven records, terminated by x=99.
export const TANK_TYPES = [
  {"pixels":[[-1,-4,0],[0,-4,0],[1,-4,0],[-3,-3,0],[-2,-3,0],[2,-3,0],[3,-3,0],[-3,-2,0],[3,-2,0],[-4,-1,0],[4,-1,0],[-4,0,0],[4,0,0],[-1,-3,1],[0,-3,1],[1,-3,1],[-2,-2,1],[2,-2,1],[-3,-1,1],[3,-1,1],[-3,0,1],[3,0,1],[-1,-2,2],[0,-2,2],[1,-2,2],[-2,-1,2],[2,-1,2],[-2,0,2],[2,0,2],[-1,0,3],[0,0,3],[1,0,3],[0,-1,3],[-1,-1,3],[1,-1,3]],"barrelLen":8,"barrelXOff":0,"barrelYOff":0,"halfWidth":4},
  {"pixels":[[-4,0,0],[-3,0,0],[-2,0,0],[-1,0,0],[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0],[-4,-1,1],[-3,-1,1],[3,-1,1],[4,-1,1],[-4,-2,2],[4,-2,2],[-1,-1,1],[0,-1,1],[1,-1,1],[-1,-2,2],[0,-2,2],[1,-2,2],[-1,-3,2],[0,-3,2],[1,-3,2]],"barrelLen":7,"barrelXOff":0,"barrelYOff":-4,"halfWidth":4},
  {"pixels":[[-5,-1,0],[5,-1,0],[-5,-2,0],[-4,-2,0],[-3,-2,0],[-2,-2,0],[5,-2,0],[4,-2,0],[3,-2,0],[2,-2,0],[-1,-2,1],[0,-2,1],[1,-2,1],[-4,0,7],[-3,0,7],[-2,0,7],[-1,0,7],[0,0,7],[1,0,7],[2,0,7],[3,0,7],[4,0,7],[-4,-1,7],[-2,-1,7],[0,-1,7],[2,-1,7],[4,-1,7],[-2,-3,2],[-3,-3,2],[-4,-4,2],[-4,-5,2]],"barrelLen":8,"barrelXOff":-3,"barrelYOff":-4,"halfWidth":5},
  {"pixels":[[-4,-1,0],[4,-1,0],[-4,-2,0],[-3,-2,0],[-2,-2,0],[-1,-2,0],[0,-2,0],[1,-2,0],[2,-2,0],[3,-2,0],[4,-2,0],[-3,-3,1],[-2,-3,1],[-1,-3,1],[0,-3,1],[1,-3,1],[2,-3,1],[3,-3,1],[-3,0,7],[-2,0,7],[-1,0,7],[0,0,7],[1,0,7],[2,0,7],[3,0,7],[-3,-1,7],[-1,-1,7],[1,-1,7],[3,-1,7],[-4,-3,2],[-2,-4,2],[-1,-4,2],[-3,-5,2],[-3,-6,2]],"barrelLen":8,"barrelXOff":-2,"barrelYOff":-5,"halfWidth":4},
  {"pixels":[[-5,-1,0],[5,-1,0],[-5,-2,0],[-4,-2,0],[-3,-2,0],[-2,-2,0],[5,-2,0],[4,-2,0],[3,-2,0],[2,-2,0],[-1,-2,1],[0,-2,1],[1,-2,1],[-1,-3,2],[0,-3,2],[1,-3,2],[-4,0,7],[-3,0,7],[-2,0,7],[-1,0,7],[0,0,7],[1,0,7],[2,0,7],[3,0,7],[4,0,7],[-4,-1,7],[-2,-1,7],[0,-1,7],[2,-1,7],[4,-1,7],[-3,-4,2],[-2,-4,2],[-1,-4,2],[0,-4,3],[1,-4,3],[2,-4,3]],"barrelLen":5,"barrelXOff":1,"barrelYOff":-5,"halfWidth":5},
  {"pixels":[[-3,0,0],[-2,0,0],[-2,-1,0],[-1,-1,0],[3,-1,0],[-1,-2,0],[0,-2,0],[1,-2,0],[2,-2,0],[3,-2,0],[-1,-3,0],[-2,-4,0],[0,0,7],[0,-1,7],[1,0,7],[2,0,7],[2,-1,7]],"barrelLen":6,"barrelXOff":-1,"barrelYOff":-4,"halfWidth":3},
  {"pixels":[[-4,-1,0],[4,-1,0],[-4,-2,0],[-3,-2,0],[-2,-2,0],[-1,-2,0],[0,-2,0],[4,-2,0],[3,-2,0],[2,-2,0],[1,-2,0],[-3,-1,7],[-1,-1,7],[1,-1,7],[3,-1,7],[-3,0,7],[-2,0,7],[-1,0,7],[0,0,7],[1,0,7],[2,0,7],[3,0,7],[-4,-3,1],[-3,-3,1],[-2,-3,1],[-1,-3,1],[0,-3,1],[2,-3,1],[1,-3,1],[-4,-4,2],[-3,-4,2],[-2,-4,2],[-1,-4,2],[0,-4,2],[-3,-5,3],[-2,-5,3]],"barrelLen":6,"barrelXOff":-1,"barrelYOff":-5,"halfWidth":4}
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
    power: 200,          // EXE player_round_init (0x30E66); range 0-1000
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
    // batteries: use inventory[WPN.BATTERY] (Battery item) — not a separate field

    // Color index (0-9, default = player index; overridden by player setup color picker)
    colorIndex: index,

    // Tank type (0-6, EXE sub struct [0x00], initial selection 3)
    tankType: 3,

    // Phase 5: scoring
    team: index,         // EXE: player struct +0x30, default = player index (each on own team)
    score: 0,
    wins: 0,
    earnedInterest: 0,  // EXE: DS:0x235C "Earned interest" shown in shop
  };
}

// EXE 0x2B13E: center each slot in the inclusive playfield, using integer spacing.
export function getTankPlacementX(slot, count) {
  const spacing = Math.trunc((config.screenWidth - 6) / count);
  return 3 + Math.trunc(spacing / 2) + slot * spacing;
}

// EXE 0x2B1B3: aim from the tank toward the horizontal center at playfield top.
// Keep the port's world-angle convention; convert to EXE angle/direction at use.
export function initializeTankAim(player) {
  player.angle = Math.trunc(Math.atan2(player.y - PLAYFIELD_TOP,
    Math.trunc((config.screenWidth - 1) / 2) - player.x) * 57.29577951);
}

export function getTankAim(player) {
  // Checkpoint players carry explicit EXE direction and a local angle.
  if (player.direction !== undefined) return { direction: player.direction, angle: player.angle };
  return player.angle <= 90 ? { direction: 1, angle: player.angle }
    : { direction: -1, angle: 180 - player.angle };
}

export function getTankBarrel(player) {
  const type = TANK_TYPES[player.tankType] || TANK_TYPES[0];
  const { direction, angle } = getTankAim(player);
  const x = player.x + direction * (player.barrelXOff ?? type.barrelXOff);
  const y = player.y + (player.barrelYOff ?? type.barrelYOff);
  // EXE 0x3FD3F truncates trig components before signed 16.16 aspect scaling.
  const radians = angle * 0.017453293;
  const dx = Math.trunc(direction * Math.cos(radians) * type.barrelLen);
  const dy = Math.trunc(-Math.sin(radians) * type.barrelLen);
  const aspect = GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const sx = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const sy = aspect > 1 ? Math.trunc(65536 / aspect) : 65536;
  return { x, y, endX: x + Math.floor(dx * sx / 65536), endY: y + Math.floor(dy * sy / 65536) };
}

// Create identities before resolving the round's player-to-slot order.
export function createPlayers(numPlayers, setup = []) {
  players.length = 0;

  for (let i = 0; i < numPlayers; i++) {
    const player = createPlayer(i, `Player ${i + 1}`);

    if (setup[i]) {
      const { name, aiType, colorIndex, tankType } = setup[i];
      Object.assign(player, { name, aiType, colorIndex, tankType });
    }

    players.push(player);
  }
}

export function placeTanks(numPlayers, setup = [], resolveSlots = null) {
  createPlayers(numPlayers, setup);
  const slots = resolveSlots ? resolveSlots() : players.map(p => p.index);
  for (let slot = 0; slot < slots.length; slot++) {
    const player = players[slots[slot]];
    player.x = getTankPlacementX(slot, numPlayers);
    settleTankForPlacement(player);
    initializeTankAim(player);
  }
}

// Reset existing players for a new round and reposition on terrain
// Preserves identity (name, aiType, score, cash, wins, inventory)
export function resetAndPlaceTanks(slots = players.map(p => p.index)) {
  const numPlayers = players.length;

  for (let i = 0; i < numPlayers; i++) {
    const p = players[slots[i]];
    p.alive = true;
    p.energy = 100;
    p.angle = 90;
    p.power = 200; // EXE 0x30E66 initializes each round to 200.
    p.contrastPending = true;
    p.falling = false;
    p.fallDamageAccum = 0;
    p.parachuteDeployed = false;
    p.shieldEnergy = 0;
    p.activeShield = 0;
    p.shieldContactHoles = null;
    p.shieldLowerColor = null;

    p.x = getTankPlacementX(i, numPlayers);
    settleTankForPlacement(p);
    initializeTankAim(p);
  }
}

// EXE 0x2AC02: descend until every footprint pixel on the next row is
// terrain. Clear partial support rows on the way; retain holes in the bitmap.
export function settleTankForPlacement(player) {
  const width = config.screenWidth, height = config.screenHeight;
  const halfW = TANK_TYPES[player.tankType].halfWidth;
  const left = Math.max(0, player.x - halfW);
  const right = Math.min(width - 1, player.x + halfW);
  const cavern = resolvedSkyType === 5;
  if (cavern) {
    // EXE 0x2ACF7: find the floor surface from below, then cut a level
    // footprint by clearing upward and filling downward until an unchanged row.
    const bottom = height - 4;
    const middle = Math.trunc((PLAYFIELD_TOP + bottom) / 2);
    let y = bottom;
    while (y >= middle && terrainBitmap[y * width + player.x]) y--;
    player.y = y;
    let changed = true;
    for (; y >= middle && changed; y--) {
      changed = false;
      for (let x = left; x <= right; x++) {
        if (terrainBitmap[y * width + x]) {
          terrainBitmap[y * width + x] = 0;
          changed = true;
        }
      }
    }
    changed = true;
    for (y = player.y + 1; y <= bottom && changed; y++) {
      changed = false;
      for (let x = left; x <= right; x++) {
        if (!terrainBitmap[y * width + x]) {
          // EXE 0x299C0 consumes RNG even with the initial single ground color.
          random(1);
          terrainBitmap[y * width + x] = TERRAIN_PAL_START;
          changed = true;
        }
      }
    }
  } else {
    player.y = PLAYFIELD_TOP;
    while (player.y < height - 2) {
      player.y++;
      const row = (player.y + 1) * width;
      let supported = true;
      for (let x = left; x <= right; x++) {
        if (!terrainBitmap[row + x]) supported = false;
      }
      if (supported) break;
      terrainBitmap.fill(0, row + left, row + right + 1);
    }
  }
  // Refresh only the affected columns; never reconstruct the bitmap from heights.
  for (let x = left; x <= right; x++) {
    // Cavern caches the floor below the tank, not the separate ceiling.
    let y = cavern ? player.y + 1 : PLAYFIELD_TOP;
    while (y < height && !terrainBitmap[y * width + x]) y++;
    terrain[x] = y;
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
    // Guard checks (0x20871–0x208CA): sub[0x28]!=0, health>0, inventory[WPN.PARACHUTE]>0
    if (!player.parachuteDeployed && player.inventory[WPN.PARACHUTE] > 0) {
      const predictedDamage = predictFallDamage(player);
      const threshold = getDeployThreshold(player);
      // EXE: deploy if predicted_damage > threshold (or threshold==0 → immediate)
      if (threshold === 0 || predictedDamage > threshold) {
        // Deploy action (0x208EA–0x20913)
        player.parachuteDeployed = true;   // sub[0x0C] = 1
        player.inventory[WPN.PARACHUTE]--;            // consume parachute
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
  const baseColor = player.colorIndex * PLAYER_PALETTE_STRIDE;
  const type = TANK_TYPES[player.tankType] || TANK_TYPES[0];

  // Direction: EXE sub[0x94], +1=right, -1=left. Determined by angle.
  const dir = getTankAim(player).direction;

  // Draw body pixels from type table
  for (const [dx, dy, slot] of type.pixels) {
    const px = dir === 1 ? cx + dx : cx - dx;  // mirror X for left-facing
    const py = groundY + dy;
    setPixel(px, py, baseColor + slot);
  }

  // Draw barrel — EXE: draw_barrel at 0x403F5
  // Barrel origin: (cx + dir*barrelXOff, groundY + barrelYOff) — from type table
  const barrel = getTankBarrel(player);
  const barrelX = barrel.x, barrelY = barrel.y;
  const barrelColor = baseColor + 4;
  const endX = player.barrelEndX ?? barrel.endX;
  const endY = player.barrelEndY ?? barrel.endY;

  walkExeLine(barrelX, barrelY, endX, endY, (x, y) => {
    // EXE 0x3FF55: preserve player pixels and omit the barrel endpoint.
    if (getPixel(x, y) > 79 && (x !== endX || y !== endY))
      setPixel(x, y, barrelColor);
  });
}

// Draw all tanks
export function drawAllTanks({ updateContrast = true } = {}) {
  for (const player of players) {
    drawTank(player);
    if (updateContrast && player.alive && player.contrastPending) {
      updateTankContrast(player);
      player.contrastPending = false;
    }
  }
}

// EXE 0x32638 / 0x32580: count similar-colored background samples around
// body and barrel pixels. Repeated samples count separately.
export function updateTankContrast(player) {
  const base = getPlayerColor(player.colorIndex);
  const direction = getTankAim(player).direction;
  let similar = 0;
  const sampleNeighbors = (x, y) => {
    for (const [sx, sy] of [[x-1,y], [x+1,y], [x,y+1], [x,y-1]]) {
      const index = getPixel(sx, sy);
      if (index < 80) continue;
      let distance = 0;
      for (let channel = 0; channel < 3; channel++)
        distance += (palette6[index * 3 + channel] - base[channel]) ** 2;
      if (distance <= 100) similar++;
    }
  };
  for (const [dx, dy] of TANK_TYPES[player.tankType].pixels)
    sampleNeighbors(player.x + direction * dx, player.y + dy);
  const barrel = getTankBarrel(player);
  walkExeLine(barrel.x, barrel.y, player.barrelEndX ?? barrel.endX,
    player.barrelEndY ?? barrel.endY, sampleNeighbors);
  player.displayColor = similar > 15 ? base.map(c => Math.trunc(c * 8 / 10)) : [...base];
  if (resolvedSkyType !== 6) {
    for (const slot of [0, 1, 2, 3, 4, 6])
      setPaletteRgb(player.colorIndex * PLAYER_PALETTE_STRIDE + slot, ...player.displayColor);
  }
  return similar;
}

// --- Tank death animation system ---
// Visual overlay only — does not affect alive/dead game logic
export const deathAnimations = [];

export function startDeathAnimation(player) {
  deathAnimations.push({
    x: player.x,
    y: player.y + Math.floor(TANK_TYPES[player.tankType].barrelYOff / 2),  // center of tank body
    baseColor: player.colorIndex * PLAYER_PALETTE_STRIDE,
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
