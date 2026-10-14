// Scorched Earth - Tank Rendering
// EXE source: icons.cpp (seg 0x1F7F+, file base 0x263F0)
// EXE: tank color gradient at file 0x28540, 10 base colors at DS:0x57E2
// EXE: player struct stride 0x6C (108 bytes), far ptr base at DS:CEB8
// EXE: tank/sub struct stride 0xCA (202 bytes), base at DS:D568
// 7 tank types with pixel data tables at DS:0x673E (stride 0x12)
// render_pixel_table at 0x40C19: direction-aware X mirroring
// Barrel: Bresenham line from type-specific origin point

import { setPixel, getPixel, getBackgroundColor } from './framebuffer.js';
import { getTerrainY, terrain, terrainBitmap, PLAYFIELD_TOP } from './terrain.js';
import { config, GRAPHICS_MODES } from './config.js';
import { resolvedSkyType, getPlayerColor, getGroundColor, palette6, setPaletteRgb } from './palette.js';
import { walkExeLine, random } from './utils.js';
import { createInventory, WPN } from './weapons.js';
import { PLAYER_PALETTE_STRIDE, TERRAIN_PAL_START } from './constants.js';
import { playParachuteDeploySound, playLandingThudSound, playCrushGlanceSound } from './sound.js';
import { applyShieldDamage, shieldBreak, redrawTankShield, eraseMovingShield } from './shields.js';
import { markTerrainCollapse, stepTerrainCollapse } from './terrain-collapse.js';
import {chooseDeathEffect,createDeathPaletteCycle,stepDeathPaletteCycle,deathBlastSequence} from './death-effects.js';
import {startExplosion,stepExplosion,isExplosionActive,drawExplosion,applyExplosionDamage,applyDeathRayDamage,bresenhamCircleFill} from './explosions.js';
import {retainWorldPixel,writeWorldPixel,projectileDrawing} from './projectile-render.js';
import {randomDeathVelocity,stepDeathParticles} from './death-particles.js';
import {deathBurstSequence,deathBurstPalette,drawDeathBurst} from './death-bursts.js';
import {rectanglePixelOrder} from './pixel-traversal.js';
import {createDeathRays,stepDeathRays} from './death-rays.js';
import {deathScorchSequence} from './death-scorch.js';
import {deathFlameSequence,drawDeathFlameCircle} from './death-flames.js';
import {deathDirtSequence} from './death-dirt.js';
import {funkyBombStages} from './funky-bomb.js';
import {getEffectiveWallType,WALL} from './physics.js';

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
const FALL_SPEED = 1;       // EXE 0x2091C increments Y by one per fall step

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
  deathAnimations.length=0;
  fallingContinuation = null;
  fallingMovement = null;
  fallingFlash.delay = 0;
  fallingSettling = false;
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
  deathAnimations.length=0;
  fallingContinuation = null;
  fallingMovement = null;
  fallingFlash.delay = 0;
  fallingSettling = false;
  const numPlayers = players.length;

  for (let i = 0; i < numPlayers; i++) {
    const p = players[slots[i]];
    p.alive = true;
    p.pendingFallDeath = false;
    p.energy = 100;
    p.angle = 90;
    p.power = 200; // EXE 0x30E66 initializes each round to 200.
    p.contrastPending = true;
    p.falling = false;
    p.fallingBodyOnly = false;
    p.fallDamageAccum = 0;
    p.parachuteDeployed = false;
    p.hudParachuteCount = undefined;
    p.hudEnergy = undefined;
    p.hudPower = undefined;
    p.hudShieldEnergy = undefined;
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

// Native 0x20468 counts occupied pixels across the row below the tank.
// Three supports, any of the center three, or two straddling the center
// keep the tank stable. A height-map lookup cannot represent these cases.
function tankSupport(player) {
  if (player.y === config.screenHeight - 4) return {stable:true,slide:0};
  const half = TANK_TYPES[player.tankType].halfWidth;
  let count = 0, leftCount = 0, center = false, victim = null;
  for (let dx = -half; dx <= half; dx++) {
    const color = getPixel(player.x + dx, player.y + 1);
    const occupied = color < 80 || color === 120 || color === 127 ||
      (color >= 128 && color <= 144);
    if (!occupied) continue;
    count++;
    if (color < 80) victim = players.find(p=>p.colorIndex===Math.floor(color/8)) ?? null;
    if (dx <= 0) leftCount++;
    if (dx >= -1 && dx <= 1) center = true;
  }
  return {stable:count > 2 || center || (count === 2 && leftCount === 1),
    slide:count === 0 ? 0 : leftCount ? 1 : -1, count, victim};
}
export function hasTankSupport(player) {
  return tankSupport(player).stable;
}

// EXE 0x318D8: damage darkens slots 1..3 progressively; other body slots
// retain their stored (possibly contrast-adjusted) color. Black sky skips it.
export function updateTankEnergyPalette(player) {
  if (resolvedSkyType === 6) return;
  const maximum = player.maxEnergy ?? 100;
  const missing = Math.trunc((maximum-player.energy)*100/maximum);
  const base = player.displayColor ?? getPlayerColor(player.colorIndex ?? player.index);
  for (let slot=1;slot<=3;slot++) {
    const factor=(100-Math.trunc(slot*missing/3))/100;
    setPaletteRgb((player.colorIndex ?? player.index)*PLAYER_PALETTE_STRIDE+slot,
      ...base.map(c=>Math.trunc(c*factor)&63));
  }
}

// Native damage updates both the energy gradient and the maximum shot power.
export function updateTankDamageState(player, {refreshHud=true} = {}) {
  if (refreshHud) {
    player.hudEnergy = undefined;
    player.hudPower = undefined;
  }
  const maximum = Math.max(0,Math.trunc(player.energy*1000/(player.maxEnergy??100)));
  player.power = Math.min(player.power,maximum);
  updateTankEnergyPalette(player);
}

// Falling damage leaves signed HP and the alive flag intact until the outer
// aftermath death dispatcher. The lethal notification changes palette slot 0
// permanently; the normal energy update immediately replaces slots 1..3.
function* applyFallingHit(player, damage, options) {
  const previous = player.energy;
  player.energy -= damage;
  if (previous > 0 && player.energy <= 0) {
    player.pendingFallDeath = true;
    player.hudEnergy ??= previous;
    player.hudPower ??= player.power;
    for (let slot=0;slot<4;slot++)
      setPaletteRgb((player.colorIndex ?? player.index)*8+slot,63,20,20);
    // Native 0x31AE3/0x31AF8 blocks twice before shield erasure, HUD/power
    // refresh and any subsequent tank damage. Preserve both visible states.
    fallingFlash.delay = 5;
    yield;
    fallingFlash.delay = 10;
    yield;
    fallingFlash.delay = 0;
    if (player.shieldEnergy) {
      eraseMovingShield(player);
      player.shieldEnergy=0;
    }
  }
  updateTankDamageState(player,options);
}

// Check all tanks and start falling if their footprint loses support.
export function checkTanksFalling() {
  let anyFalling = false;
  for (const player of players) {
    if (!player.alive) continue;
    if (!hasTankSupport(player)) {
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
// Simulates footprint support and sliding without changing the real tank.
export function predictFallDamage(player) {
  const probe = {x:player.x,y:player.y,tankType:player.tankType};
  let damage = 0;
  while (probe.y < config.screenHeight - 4) {
    const support = tankSupport(probe);
    if (support.stable) break;
    probe.y++;
    probe.x = Math.max(12,Math.min(config.screenWidth-13,probe.x+support.slide));
    damage += FALL_DAMAGE_PER_PIXEL;
  }
  return damage;
}

// EXE: Deploy threshold = sub[0x2C]: default 5, with Battery = 10
// File 0x18852: set sub[0x2C]=5; file 0x18872: if Battery owned, sub[0x2C]=10
function getDeployThreshold(player) {
  return player.inventory[WPN.BATTERY] > 0 ? 10 : 5;
}

let fallingContinuation = null;
let fallingMovement = null;
let fallingSettling = false;
export const fallingFlash = {delay:0};
export function isFallingSettling() { return fallingSettling; }

// Step falling animation for all tanks, returns true while any are still falling
// EXE: handle_falling_tanks at file 0x205DC
export function stepFallingTanks(wind = 0) {
  if (shieldBreak.active) return true;
  if (fallingSettling) return finishFallingSettlement();
  if (fallingContinuation) return resumeFallingLanding();
  fallingMovement ??= fallingMovementPass(wind);
  const result=fallingMovement.next();
  if (!result.done) return true;
  fallingMovement=null;
  return result.value;
}

function* fallingMovementPass(wind) {
  fallFrameCounter++; // EXE: DS:0x1C68 incremented each outer loop iteration (0x205F4)

  let anyFalling = false;
  const landings = [];
  for (const player of players) {
    if (!player.alive || !player.falling) continue;

    // EXE: Parachute half-speed (file 0x20626–0x2063A)
    // When deployed, skip even frames → tank falls on odd frames only = half speed
    if (player.parachuteDeployed) {
      if (fallFrameCounter % 2 === 0) { anyFalling = true; continue; }
    }

    const support = tankSupport(player);
    if (!support.stable && support.count) playCrushGlanceSound();
    if (!support.stable) {
      markTerrainCollapse(player.x-16,player.x+16);
      // Native 0x207E8 erases every old body pixel to sky, including dirt
      // overwritten during sideways movement (0x40C19 -> 0x40BA3).
      const direction = getTankAim(player).direction;
      for (const [dx,dy] of TANK_TYPES[player.tankType].pixels) {
        const x=player.x+dx*direction,y=player.y+dy;
        if (x<3 || x>config.screenWidth-4 || y<PLAYFIELD_TOP || y>config.screenHeight-4) continue;
        terrainBitmap[y*config.screenWidth+x]=0;
        setPixel(x,y,getBackgroundColor(y,x));
        if (terrain[x]===y) {
          while (terrain[x]<config.screenHeight && !terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
        }
      }
      eraseMovingShield(player);
    }
    // EXE: Parachute deployment check (0x208CD–0x20913)
    // Guard checks (0x20871–0x208CA): sub[0x28]!=0, health>0, inventory[WPN.PARACHUTE]>0
    if (!support.stable && !player.parachuteDeployed && player.inventory[WPN.PARACHUTE] > 0) {
      const predictedDamage = predictFallDamage(player);
      const threshold = getDeployThreshold(player);
      // EXE: deploy if predicted_damage > threshold (or threshold==0 → immediate)
      if (threshold === 0 || predictedDamage > threshold) {
        // Deploy action (0x208EA–0x20913)
        player.parachuteDeployed = true;   // sub[0x0C] = 1
        playParachuteDeploySound();        // sound(0x1E, 0x07D0) = 2000 Hz
        setPaletteRgb(player.colorIndex*PLAYER_PALETTE_STRIDE+6,63,63,63);
      }
    }

    // Deployment is decided before the native movement at 0x20919.
    if (!support.stable) {
      player.fallingBodyOnly = true;
      moveFallingTank(player,support.slide,wind);
      // Native redraws before scanning the next player in this same pass.
      drawTank(player);
      redrawTankShield(player);
      markTerrainCollapse(player.x-16,player.x+16);
    }

    // EXE: Per-step behavior (0x20A41–0x20A96)
    if (!support.stable && !player.parachuteDeployed) {
      // No parachute: accumulate damage
      player.fallDamageAccum += FALL_DAMAGE_PER_PIXEL * FALL_SPEED;

      // EXE: When DAMAGE_TANKS_ON_IMPACT = Off (0), deal per-step damage
      if (!config.impactDamage) {
        yield* applyFallingHit(player,FALL_DAMAGE_PER_PIXEL * FALL_SPEED);
      }
    }
    // EXE: parachute deployed → NO damage accumulation; damage_tank(tank, 0, 1) = no-op
    // EXE: delay(20) per step for visual effect — approximated by half-speed frame skip above

    if (support.stable) {
      player.falling = false;
      landings.push({player,support});
    } else {
      anyFalling = true;
    }
  }
  fallingContinuation = {damage:applyLandingDamage(landings),anyFalling,recheck:landings.length>0};
  return resumeFallingLanding();
}

function* applyLandingDamage(landings) {
  // Native 0x20AB0 completes every movement before dispatching any landing
  // damage. A tank crushed this pass still gets its scheduled movement first.
  for (const {player,support} of landings) {
    // EXE: Post-landing (0x20ACA): sound(0x1E, 0xC8) = 200 Hz thud
    playLandingThudSound();

    if (config.impactDamage) {
      // EXE: DAMAGE_TANKS_ON_IMPACT = On (1) — deal accumulated damage on landing
      // EXE: 0x20AE4: damage_tank(tank, fall_damage_accum[player], 1)
      yield* applyFallingHit(player,player.fallDamageAccum);
    }

    // The last player-colored support pixel selects the crushed tank.
    // Ground supports count toward landing too; one central tank pixel suffices.
    if (support.victim) {
      const victim = support.victim;
      const damage = applyShieldDamage(victim,player.fallDamageAccum+50,{refreshHud:false});
      // Native shield_and_damage blocks inside absorption until fade/erasure.
      if (shieldBreak.active) yield;
      // Native temporarily makes the faller current while damaging the victim;
      // 0x319E8 therefore skips the victim's HUD energy refresh.
      victim.hudEnergy ??= victim.energy;
      victim.hudPower ??= victim.power;
      yield* applyFallingHit(victim,damage,{refreshHud:false});
      yield* applyFallingHit(player,Math.trunc(player.fallDamageAccum/2)+10);
      playLandingThudSound();
    }
  }
}

function resumeFallingLanding() {
  if (!fallingContinuation.damage.next().done) return true;
  let {anyFalling,recheck} = fallingContinuation;
  fallingContinuation = null;
  fallingSettling = false;
  // Native wrapper 0x201CC rescans support after every landing pass. A shield
  // erased by crush damage may have been the tank's only support. Preserve
  // accumulated damage and deployment state when falling continues.
  if (recheck) {
    anyFalling = false;
    for (const player of players) {
      if (!player.alive) continue;
      player.falling = !hasTankSupport(player);
      anyFalling ||= player.falling;
    }
  }
  // EXE 0x201F9: consume and remove deployed parachutes after all falls settle.
  if (!anyFalling) {
    for (const player of players) {
      player.fallingBodyOnly = false;
      redrawTankShield(player);
      if (!player.parachuteDeployed) continue;
      // Cleanup does not repaint the native inventory widget. Keep its count
      // until player selection performs the next full HUD refresh.
      player.hudParachuteCount ??= player.inventory[WPN.PARACHUTE];
      player.inventory[WPN.PARACHUTE] = Math.max(0,player.inventory[WPN.PARACHUTE]-1);
      player.parachuteDeployed = false;
    }
    // Native 0x202E4 settles dirt before recursively checking for new falls.
    fallingSettling = true;
    return finishFallingSettlement();
  }
  return anyFalling;
}

function finishFallingSettlement() {
  if (stepTerrainCollapse()) return true;
  fallingSettling = false;
  return checkTanksFalling();
}

// EXE 0x20919..0x20A2C: descent, optional random parachute drift, then clamp.
export function moveFallingTank(player, slide, wind) {
  player.y += FALL_SPEED;
  player.x += slide;
  if (player.parachuteDeployed && Math.abs(wind)>10 && random(100)<Math.abs(wind)) {
    const direction = wind<0 ? -1 : 1;
    const edge = player.x+(TANK_TYPES[player.tankType].halfWidth+1)*direction;
    const clear = (x,y) => {
      const c = getPixel(x,y);
      return c>=80 && !(c>=120 && c<=144);
    };
    // Native pushes X before Y here: the pixel callback receives transposed
    // coordinates, unlike the support scan. Preserve that original behavior.
    if (clear(player.y,edge) && clear(player.y-1,edge)) player.x += direction;
  }
  player.x = Math.max(12,Math.min(config.screenWidth-13,player.x));
}

// Draw a single tank — EXE: render_pixel_table at file 0x40C19
// Pixel data tables at DS:0x649C+ (6 types), direction-aware X mirroring from sub[0x94]
export function drawTank(player, includeDead = false, plot = setPixel) {
  if (!player.alive && !includeDead) return;

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
    plot(px, py, baseColor + slot);
  }

  if (player.parachuteDeployed) {
    // Type-table sub[0x0A] places the suspension lines above the body.
    const offset = [5,4,3,4,5,4,5][player.tankType];
    drawParachute(cx, groundY-offset, baseColor+6,plot);
  }

  // EXE 0x20A36 draws only the body during a fall; 0x20296 restores the barrel.
  // Support rescan can mark a previously stationary tank before its first
  // movement. Native erases its barrel only when that movement begins.
  if (player.fallingBodyOnly) return;

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
      plot(x, y, barrelColor);
  });
}

// Native 0x40046: draw canopy/lines only over native colors >=105.
export function drawParachute(x, y, color, writePixel = setPixel) {
  const plot = (dx,dy) => {
    const old = getPixel(x+dx,y+dy);
    if (old >= 80 && !(old >=120 && old <=144))
      writePixel(x+dx,y+dy,color);
  };
  for (let i=0;i<7;i++) plot(0,-i);
  for (let i=0;i<6;i++) { plot(i+2,-i); plot(-i-2,-i); }
  for (let i=5;i<9;i++) { plot(i,-6); plot(-i,-6); }
  for (let i=-7;i<8;i++) plot(i,-7);
  for (let i=-5;i<6;i++) plot(i,-8);
  for (let i=-2;i<3;i++) plot(i,-9);
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

// Native 0x408B7: particle source records, in allocation order. Unlike normal
// drawing, this includes the barrel endpoint and overlap with the body.
export function getDeathSpritePixels(player) {
  const type=TANK_TYPES[player.tankType];
  const direction=getTankAim(player).direction;
  const barrel=getTankBarrel(player);
  const base=player.index*8;
  const records=[];
  walkExeLine(direction*(player.barrelXOff ?? type.barrelXOff),
    player.barrelYOff ?? type.barrelYOff,
    (player.barrelEndX ?? barrel.endX)-player.x,
    (player.barrelEndY ?? barrel.endY)-player.y,
    (x,y)=>{records.push([x,y,base+4]);});
  for (const [x,y,color] of type.pixels) records.push([x*direction,y,base+color]);
  return records;
}

// --- Tank death animation system ---
// Sequential native palette preludes and all eleven death-effect branches.
export const deathAnimations = [];

export function startDeathAnimation(player, attackerIndex=player.index, weaponIdx=2) {
  deathAnimations.push({
    player, attackerIndex, weaponIdx, effect:null, cycle:null,
    baseColor: player.colorIndex * PLAYER_PALETTE_STRIDE,
  });
}

export function stepDeathAnimations() {
  const anim=deathAnimations[0];
  if (!anim) return false;
  if (anim.effect===null) {
    anim.effect=chooseDeathEffect(config.landType===3 || config.landType===5);
    if (anim.effect<=5) anim.cycle=createDeathPaletteCycle(anim.baseColor);
  }
  if (anim.cycle && stepDeathPaletteCycle(anim.cycle)) return true;
  if (anim.effect===0) {
    eraseDeathTank(anim.player);
    deathAnimations.shift();
    return deathAnimations.length>0;
  }
  if (anim.effect>=1 && anim.effect<=3) return stepDeathBlasts(anim);
  if (anim.effect===5) return stepDeathRadialRays(anim);
  if (anim.effect===10) return stepDeathSpriteParticles(anim);
  if (anim.effect===9) return stepDeathOverlappingBursts(anim);
  if (anim.effect===8) return stepDeathScorch(anim);
  if (anim.effect===7) return stepDeathFlames(anim);
  if (anim.effect===6) return stepDeathDirt(anim);
  if (anim.effect===4) return stepDeathFunky(anim);
  throw new RangeError(`Unknown death effect ${anim.effect}`);
}


function stepDeathFunky(anim) {
  if(!anim.funky) {
    drawTank(anim.player,true,retainWorldPixel);
    anim.corpseErased=true;
    anim.funky=funkyBombStages(anim.player.x,anim.player.y,-1);
  }
  projectileDrawing.draw();
  if(anim.operations) return stepDeathBlasts(anim);
  if(anim.funkyDamagePending && !anim.damageComplete) return true;
  const next=anim.funky.next();
  if(next.done) throw new Error('Funky death ended without its final explosion');
  const op=next.value;
  if(op.kind==='damage') {
    anim.funkyDamagePending=true;anim.damageComplete=false;
    // Native 0x2476B uses the ordinary linear damage profile, without a
    // weapon multiplier. Weapon index 2 selects that same unit multiplier.
    applyExplosionDamage(op.x,op.y,op.radius,anim.attackerIndex,2,
      ()=>{anim.damageComplete=true;},{deferDeath:true});
    return true;
  }
  if(op.kind==='final') {
    anim.operations=[{kind:'blast',radius:op.radius,settle:true},{kind:'erase'}];
    anim.operation=0;
    return stepDeathBlasts(anim);
  }
  return true;
}

function stepDeathDirt(anim) {
  if (!anim.dirt) {
    drawTank(anim.player,true,retainWorldPixel);
    const p=anim.player;
    anim.dirt=deathDirtSequence({x:p.x,y:p.y,baseColor:anim.baseColor,
      rgb:p.displayColor??getPlayerColor(p.colorIndex)},{
      palette:(slot,rgb)=>setPaletteRgb(slot,...rgb),
      getPixel:(x,y)=>{
        const c=getPixel(x,y);
        return c>=80&&c<110?c+40:c>=120&&c<=144?c-40:c;
      },
      deposit:(x,y)=>{
        random(1); // Native ground-deposit table currently contains color 80.
        terrainBitmap[y*config.screenWidth+x]=120;
        terrain[x]=Math.min(terrain[x],y);
        retainWorldPixel(x,y,120);
      },
      markDirty:markTerrainCollapse,
      markCircle:(x,radius)=>{
        const aspect=GRAPHICS_MODES[config.graphicsMode].displayAspect;
        const scale=aspect<1?Math.trunc(aspect*65536):65536;
        const left=x+Math.floor(-radius*scale/65536)-1;
        const right=x+Math.floor(radius*scale/65536)+1;
        markTerrainCollapse(left,right);
        if(getEffectiveWallType()===WALL.WRAP && (left+1<3||right-1>config.screenWidth-4))
          markTerrainCollapse(3,config.screenWidth-4);
      },
      eraseTank:()=>eraseDeathTank(p,false),
    },{ground:getGroundColor(),maxY:config.screenHeight-1,
      top:PLAYFIELD_TOP,right:config.screenWidth-4,
      wrap:getEffectiveWallType()===WALL.WRAP,sound:!!config.soundEnabled});
  }
  projectileDrawing.draw();
  if(!anim.dirtDone) {
    if(!anim.dirt.next().done) return true;
    anim.dirtDone=true;
  }
  if(stepTerrainCollapse()) return true;
  deathAnimations.shift();
  return deathAnimations.length>0;
}

function stepDeathFlames(anim) {
  if (!anim.flames) {
    drawTank(anim.player,true,retainWorldPixel);
    eraseDeathTank(anim.player);
    const toPort=color=>color>=80&&color<=104?color+40:
      color>=120&&color<150?color-40:color;
    const io={
      getPixel:(x,y)=>{
        const color=getPixel(x,y);
        return color>=80&&color<110?color+40:color>=120&&color<=144?color-40:color;
      },
      setPixel:(x,y,color)=>{
        const mapped=toPort(color);
        if(color>=80&&color<=104 && x>=0&&x<config.screenWidth&&y>=0&&y<config.screenHeight)
          terrainBitmap[y*config.screenWidth+x]=mapped;
        retainWorldPixel(x,y,mapped);
      },
      restorePixel:(x,y)=>{
        if(x<3||x>config.screenWidth-4||y<PLAYFIELD_TOP||y>config.screenHeight-4) return;
        terrainBitmap[y*config.screenWidth+x]=0;
        retainWorldPixel(x,y,getBackgroundColor(y,x));
        if(terrain[x]===y)
          while(terrain[x]<config.screenHeight&&!terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
      },
      palette:(base,colors)=>{
        colors.forEach((rgb,i)=>setPaletteRgb(toPort(base+i),...rgb));
        if(base===170) anim.flamePalette=colors.map(rgb=>rgb.slice());
      },
      cycle:base=>{
        const colors=anim.flamePalette;
        colors.push(colors.shift());
        colors.forEach((rgb,i)=>setPaletteRgb(base+i,...rgb));
      },
    };
    io.circle=(x,y,radius,color)=>drawDeathFlameCircle(x,y,radius,color,io);
    anim.flames=deathFlameSequence(anim.player.x,anim.player.y,io,{ground:getGroundColor()});
  }
  projectileDrawing.draw();
  if(!anim.flames.next().done) return true;
  deathAnimations.shift();
  return deathAnimations.length>0;
}

function stepDeathScorch(anim) {
  if (!anim.scorch) {
    const restorePixel=(x,y)=>{
      if (x<3 || x>config.screenWidth-4 || y<PLAYFIELD_TOP || y>config.screenHeight-4) return;
      terrainBitmap[y*config.screenWidth+x]=0;
      retainWorldPixel(x,y,getBackgroundColor(y,x));
      if (terrain[x]===y)
        while (terrain[x]<config.screenHeight && !terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
    };
    const eraseBarrel=player=>{
      const b=getTankBarrel(player);
      walkExeLine(b.x,b.y,player.barrelEndX??b.endX,player.barrelEndY??b.endY,(x,y)=>{
        if (getPixel(x,y)===player.colorIndex*8+4) restorePixel(x,y);
      });
    };
    const drawBody=(player,erase)=>{
      const type=TANK_TYPES[player.tankType],direction=getTankAim(player).direction;
      for(const [dx,dy,slot] of type.pixels) {
        const x=player.x+dx*direction,y=player.y+dy;
        if(erase) restorePixel(x,y);
        else retainWorldPixel(x,y,player.colorIndex*8+slot);
      }
      if(erase) eraseMovingShield(player);
      else redrawTankShield(player);
    };
    drawTank(anim.player,true,retainWorldPixel);
    anim.scorch=deathScorchSequence(anim.player,{
      getPixel:(x,y)=>{
        const color=getPixel(x,y);
        return color>=80&&color<110?color+40:color>=120&&color<=144?color-40:color;
      },
      setPixel:retainWorldPixel,restorePixel,eraseBarrel,drawTank:drawBody,
      setupTank:player=>{eraseBarrel(player);drawBody(player,true);},
      palette:colors=>colors.forEach((rgb,i)=>setPaletteRgb(170+i,...rgb)),
      beginCycle:(base,count)=>{anim.scorchPalette=palette6.slice(base*3,(base+count)*3);},
      cycle:(base,count)=>{
        const saved=anim.scorchPalette;
        anim.scorchPalette=new Uint8Array([...saved.slice(3),...saved.slice(0,3)]);
        for(let i=0;i<count;i++) setPaletteRgb(base+i,...anim.scorchPalette.slice(i*3,i*3+3));
      },
      markDirty:markTerrainCollapse,
    },{top:PLAYFIELD_TOP,bottom:config.screenHeight-4,ground:getGroundColor()});
  }
  projectileDrawing.draw();
  if (!anim.scorch.next().done) return true;
  deathAnimations.shift();
  return deathAnimations.length>0;
}

function stepDeathOverlappingBursts(anim) {
  if (!anim.bursts) {
    anim.bursts=deathBurstSequence(anim.player.x,anim.player.y);
    anim.burstBounds={left:anim.player.x,right:anim.player.x,top:anim.player.y,bottom:anim.player.y};
    deathBurstPalette().forEach((rgb,index)=>setPaletteRgb(200+index,...rgb));
    drawTank(anim.player,true,retainWorldPixel);
  }
  projectileDrawing.draw();
  const next=anim.bursts.next();
  const wrap=getEffectiveWallType()===WALL.WRAP;
  if (!next.done) {
    const bounds=drawDeathBurst(next.value,{writePixel:retainWorldPixel,wrap});
    for (const key of ['left','top']) anim.burstBounds[key]=Math.min(anim.burstBounds[key],bounds[key]);
    for (const key of ['right','bottom']) anim.burstBounds[key]=Math.max(anim.burstBounds[key],bounds[key]);
    markTerrainCollapse(bounds.left-1,bounds.right+1);
    if (wrap && (bounds.left<3 || bounds.right>config.screenWidth-4)) markTerrainCollapse(3,config.screenWidth-4);
    return true;
  }
  const b=anim.burstBounds;
  const left=b.left-1,right=b.right+1;
  const top=Math.max(PLAYFIELD_TOP,Math.min(config.screenHeight-4,b.top-1));
  const bottom=Math.max(PLAYFIELD_TOP,Math.min(config.screenHeight-4,b.bottom+1));
  for (const [dx,dy] of rectanglePixelOrder(right-left+1,bottom-top+1)) {
    let x=left+dx;const y=top+dy;
    if (x<3 || x>config.screenWidth-4) {
      if (!wrap) continue;
      x+=x<3?config.screenWidth-6:-(config.screenWidth-6);
    }
    if (getPixel(x,y)<170) continue;
    terrainBitmap[y*config.screenWidth+x]=0;
    retainWorldPixel(x,y,getBackgroundColor(y,x));
    if (terrain[x]===y)
      while (terrain[x]<config.screenHeight && !terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
  }
  eraseDeathTank(anim.player);deathAnimations.shift();
  return deathAnimations.length>0;
}

function stepDeathSpriteParticles(anim) {
  if (!anim.particles) {
    if (anim.player.shieldEnergy>0) eraseMovingShield(anim.player);
    const rgb=anim.player.displayColor ?? getPlayerColor(anim.player.colorIndex);
    for (let slot=0;slot<8;slot++)
      setPaletteRgb(anim.baseColor+slot,...(slot===5?[63,63,63]:slot===7?[30,30,30]:rgb));
    drawTank(anim.player,true,retainWorldPixel);
    anim.particles=getDeathSpritePixels(anim.player).map(([x,y,color])=>({
      x:anim.player.x+x,y:anim.player.y+y,color,...randomDeathVelocity(),
    }));
  }
  projectileDrawing.draw();
  const active=stepDeathParticles(anim.particles,{
    getPixel:(x,y)=>{
      const color=getPixel(x,y);
      return color>=80&&color<110?color+40:color>=120&&color<=144?color-40:color;
    },
    erasePixel:(x,y)=>{
      if (x<3 || x>config.screenWidth-4 || y<PLAYFIELD_TOP || y>config.screenHeight-4) return;
      terrainBitmap[y*config.screenWidth+x]=0;
      retainWorldPixel(x,y,getBackgroundColor(y,x));
      if (terrain[x]===y)
        while (terrain[x]<config.screenHeight && !terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
    },
    setPixel:retainWorldPixel,
  },{right:config.screenWidth-4,bottom:config.screenHeight-4,wrap:getEffectiveWallType()===WALL.WRAP});
  if (active) return true;
  deathAnimations.shift();
  return deathAnimations.length>0;
}

function stepDeathRadialRays(anim) {
  if (!anim.rays) {
    anim.rays=createDeathRays(anim.player.x,anim.player.y);
    anim.rayPixels=new Map();
  }
  if (stepDeathRays(anim.rays,{writePixel:(x,y,color)=>{
    anim.rayPixels.set(y*config.screenWidth+x,color);
    writeWorldPixel(x,y,color);
  }})) return true;
  if (!anim.rayDamageStarted) {
    anim.rayDamageStarted=true;
    applyDeathRayDamage(anim.player.x,anim.player.y,anim.rays.radius,anim.attackerIndex,
      ()=>{anim.damageComplete=true;});
  }
  if (!anim.damageComplete) return true;
  // Restore only pixels still carrying the ray color, not the entire circle.
  // Reapply retained rays before the native read/erase callback sees the world.
  for (const [index,color] of anim.rayPixels)
    setPixel(index%config.screenWidth,Math.floor(index/config.screenWidth),color);
  bresenhamCircleFill(anim.player.x,anim.player.y,anim.rays.radius,0,{writePixel:(x,y)=>{
    if (getPixel(x,y)!==250) return;
    terrainBitmap[y*config.screenWidth+x]=0;
    retainWorldPixel(x,y,getBackgroundColor(y,x));
    if (terrain[x]===y)
      while (terrain[x]<config.screenHeight && !terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
  }});
  const aspect=GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const scaleX=aspect<1?Math.trunc(aspect*65536):65536;
  const left=anim.player.x+Math.floor(-anim.rays.radius*scaleX/65536);
  const right=anim.player.x+Math.floor(anim.rays.radius*scaleX/65536);
  markTerrainCollapse(left-1,right+1); // Native 0x1CD38.
  if (getEffectiveWallType()===WALL.WRAP && (left<3 || right>config.screenWidth-4))
    markTerrainCollapse(3,config.screenWidth-4);
  eraseDeathTank(anim.player);deathAnimations.shift();
  return deathAnimations.length>0;
}

function stepDeathBlasts(anim) {
  if (!anim.operations) {
    const scale=config.screenWidth<=320?[0.5,0.75,1][config.explosionScale]:[1,2,3][config.explosionScale];
    anim.operations=deathBlastSequence(anim.effect,[20,40,75].map(r=>Math.trunc(r*scale))).slice(1);
    anim.operation=0;
  }
  anim.delay=0;
  while (anim.operation<anim.operations.length) {
    const op=anim.operations[anim.operation];
    if (op.kind==='delay') {anim.delay=op.duration;anim.operation++;return true;}
    if (op.kind==='erase') {
      eraseDeathTank(anim.player);deathAnimations.shift();return deathAnimations.length>0;
    }
    if (!anim.blastStarted) {
      anim.blastStarted=true;anim.blastFinished=false;anim.damageComplete=false;
      startExplosion(anim.player.x,anim.player.y,op.radius,anim.attackerIndex,(restored)=>{
        anim.blastFinished=true;
        anim.corpseErased=true;
        anim.restoredPixels ??= new Map();
        for (const [index,color] of restored) anim.restoredPixels.set(index,color);
        applyExplosionDamage(anim.player.x,anim.player.y,op.radius,anim.attackerIndex,anim.weaponIdx,
          ()=>{anim.damageComplete=true;},{deferDeath:true});
      },{captureRestoration:true});
    }
    if (isExplosionActive()) {stepExplosion();return true;}
    if (!anim.damageComplete) return true;
    if (op.settle) {
      // Native dirt settling starts by redrawing live tanks (0x1CF06).
      anim.restoredPixels=null;
      if (stepTerrainCollapse()) return true;
    }
    anim.operation++;anim.blastStarted=false;
  }
  return true;
}

function eraseDeathTank(player,markDirty=true) {
  const aim=getTankAim(player),type=TANK_TYPES[player.tankType];
  const barrel=getTankBarrel(player),color=player.colorIndex*8+4;
  walkExeLine(barrel.x,barrel.y,barrel.endX,barrel.endY,(x,y)=>{
    if (getPixel(x,y)===color) retainWorldPixel(x,y,getBackgroundColor(y,x));
  });
  for (const [dx,dy] of type.pixels) {
    const x=player.x+dx*aim.direction,y=player.y+dy;
    if (x<3 || x>config.screenWidth-4 || y<PLAYFIELD_TOP || y>config.screenHeight-4) continue;
    terrainBitmap[y*config.screenWidth+x]=0;
    retainWorldPixel(x,y,getBackgroundColor(y,x));
    if (terrain[x]===y)
      while (terrain[x]<config.screenHeight && !terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
  }
  eraseMovingShield(player);
  if(markDirty) markTerrainCollapse(player.x-16,player.x+16);
}

export function drawDeathAnimations() {
  for (const [index,anim] of deathAnimations.entries()) {
    if(index===0 && anim.funky) {
      projectileDrawing.draw();
      for(const [pixel,color] of anim.restoredPixels??[])
        setPixel(pixel%config.screenWidth,Math.floor(pixel/config.screenWidth),color);
      drawExplosion();continue;
    }
    if (index===0 && (anim.particles || anim.bursts || anim.scorch || anim.flames || anim.dirt)) {projectileDrawing.draw();continue;}
    if (index===0 && anim.rays) {
      drawTank(anim.player,true);
      for (const [pixel,color] of anim.rayPixels)
        setPixel(pixel%config.screenWidth,Math.floor(pixel/config.screenWidth),color);
      continue;
    }
    if (index===0 && anim.operations) {
      if (!anim.corpseErased) drawTank(anim.player,true);
      for (const [index,color] of anim.restoredPixels ?? [])
        setPixel(index%config.screenWidth,Math.floor(index/config.screenWidth),color);
      drawExplosion();
      continue;
    }
    drawTank(anim.player,true);
  }
}
