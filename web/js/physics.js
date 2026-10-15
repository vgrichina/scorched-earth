import {triggerVerticalGuidance} from './guidance-trigger.js';
// Scorched Earth - Projectile Physics
// EXE source: extras.cpp (seg 0x1895, file base 0x20EA0)
// EXE: physics timestep calibrated via MIPS benchmark (adaptive dt, default 0.02)
// EXE: viscosity factor = 1.0 - config/10000 (multiplicative per step)
// EXE: gravity_accel = 2500 × GRAVITY_CONFIG px/sec² (DS:512A, default 0.2, range 0.05-10.0)
// EXE: wind_accel = 1.25 × wind px/sec² (horizontal only)
// EXE: speed capped at 1000 before position integration (0x21AA2).

import { WPN, WEAPONS } from './weapons.js';
import { config, getActiveGraphicsMode } from './config.js';
import { walkExeLine } from './utils.js';
import { players } from './tank.js';
import { PLAYFIELD_TOP, terrainBitmap } from './terrain.js';
import { PLAYER_COLOR_MAX } from './constants.js';
import { setPaletteRgb } from './palette.js';
import { getPixel, getBackgroundColor } from './framebuffer.js';
import { projectileDrawing, writeWorldPixel } from './projectile-render.js';
import { eraseShieldContact } from './shields.js';
import {applyShieldFlight} from './shield-flight.js';

// Physics tuning — per-second values matching original RE scale
// EXE: dt calibrated via CPU MIPS benchmark, stored in DS for adaptive timestep
export const DT = 0.02;           // EXE: default timestep (DS:0x1CFA = 0.02)

// EXE-derived gravity/wind constants (from setup_physics_constants at file 0x21064)
// EXE: gravity_accel = 2500 × GRAVITY_CONFIG px/sec² (DS:1CF2=50.0, gravity_step=50²×G×dt)
// EXE: wind_accel = 1.25 × wind px/sec² (DS:1CF6=40.0, wind_step=wind×50/(40)×dt)
export const GRAVITY_FACTOR = 2500.0;
export const WIND_FACTOR = 1.25;

// Wall types — EXE: ELASTIC config variable DS:0x5154, dispatch at file 0x2220F
// Enum ordering verified from config parser at 0x29290 and dispatch code
export const WALL = {
  NONE:     0,  // EXE: fly off screen
  WRAP:     1,  // EXE: wrap-around screen edges
  PADDED:   2,  // EXE: reflect with coeff -0.5 (DS:0x1D3C)
  RUBBER:   3,  // EXE: perfect reflect with coeff -1.0 (DS:0x1D34)
  SPRING:   4,  // EXE: amplified reflect with coeff -2.0 (DS:0x1D44)
  CONCRETE: 5,  // EXE: detonate on wall impact
  RANDOM:   6,  // EXE: random(6) → 0-5 per round
  ERRATIC:  7,  // EXE: random(6) → 0-5 per turn
};

// Active projectiles array (replaces single projectile)
export const projectiles = [];

// Legacy single-projectile reference (for backward compat with main.js drawing)
export const projectile = { active: false, x: 0, y: 0, vx: 0, vy: 0, trail: [] };

// EXE: viscosity factor applied multiplicatively each physics step
// EXE: factor = 1.0 - (VISCOSITY config value / 10000.0)
function getViscosityFactor() {
  return 1.0 - config.viscosity / 10000.0;
}

// EXE: velocity damping constants (shared by Mag Deflector defense and TUNNELLING)
// DS:1D54 = 0.75 (damping coefficient), DS:1D58 = 2000.0 (absorption threshold in EXE units)
const MAG_DAMP_COEFF = 0.75;
const MAG_ABSORB_THRESHOLD = 2000.0;

export function applyMagDamping(proj) {
  if (proj.contactTriggerActive) return false;  // Contact Trigger bypasses damping

  proj.vx *= MAG_DAMP_COEFF;
  proj.vy *= MAG_DAMP_COEFF;

  const speedSq = proj.vx * proj.vx + proj.vy * proj.vy;
  if (speedSq < MAG_ABSORB_THRESHOLD) {
    proj.active = false;  // absorbed — no damage
    return true;
  }
  return false;
}

// Create a new projectile object
export function createProjectile(startX, startY, vx, vy, weaponIdx, attackerIdx, opts = {}) {
  return {
    active: true,
    x: startX,
    y: startY,
    vx,
    vy,
    trail: [],
    age: 0,
    // EXE projectile+4A: 0 disables tunnelling, 1 suppresses forces while
    // tunnelling, -1 is ordinary flight (native initialization 0x218BE).
    tunnelState: (() => {
      const w = WEAPONS[weaponIdx ?? 2];
      return (w?.handlerSegment === 0x2fbd && w.bhv === 3) ||
        (w?.handlerSegment === 0x3d1e && w.bhv === 2) ||
        (w?.handlerSegment === 0x15a0 && w.bhv === 0x81) ? 0 : -1;
    })(),
    weaponIdx: weaponIdx ?? 2,
    attackerIdx: attackerIdx ?? 0,
    // EXE 0x2186F: snapshot TRACE / Smoke Tracer at projectile creation.
    traceColor: config.tracePaths || weaponIdx === WPN.SMOKE_TRACER
      ? 110 + (players[attackerIdx ?? 0]?.colorIndex ?? (attackerIdx ?? 0)) : null,
    // Optional fields set by behaviors
    isSubWarhead: opts.isSubWarhead || false,
    subRadius: opts.subRadius || 0,
    isNapalmParticle: opts.isNapalmParticle || false,
    isDirtParticle: opts.isDirtParticle || false,
    napalmLife: opts.napalmLife || 0,
    rolling: false,
    bounceCount: 0,
    wallBounceScale: 0.8, // EXE +32, multiplied by .8 after the sixth bounce
    hasSplit: false,
    prevVy: undefined,
    contactTriggerActive: opts.contactTriggerActive || false,  // EXE: DS:0x1C76 — armed Contact Trigger at launch
    ...opts,
  };
}

// Launch projectile from tank position at given angle/power
export function getLaunchVelocity(angleDeg, power) {
  // EXE 0x211AD / 0x212BF: truncate trig components before applying the
  // graphics mode's signed 16.16 aspect transform (0x44761).
  const angleRad = angleDeg * 0.017453293;
  const aspect = getActiveGraphicsMode().displayAspect;
  const sx = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const sy = aspect > 1 ? Math.trunc(65536 / aspect) : 65536;
  return { vx: Math.floor(Math.trunc(Math.cos(angleRad) * power) * sx / 65536),
    vy: Math.floor(Math.trunc(Math.sin(angleRad) * power) * sy / 65536) };
}

// EXE 0x20ECD, called by launch at 0x21264 when EDGES_EXTEND > 0.
// This is a snapshot of the visible edge columns, not the terrain height map.
let extendedEdgeHeights = null;
export function refreshProjectileEdges(getPixelFn = getPixel) {
  extendedEdgeHeights = [3, config.screenWidth - 4].map(x => {
    for (let y = config.screenHeight - 4; y > PLAYFIELD_TOP; y--) {
      // Native terrain 80..104 is relocated to port indices 120..144.
      const pixel = getPixelFn(x, y);
      if (pixel < 120 || pixel > 144) return y;
    }
    return PLAYFIELD_TOP;
  });
  return [...extendedEdgeHeights];
}

export function launchProjectile(startX, startY, angleDeg, power, weaponIdx, attackerIdx) {
  if (config.edgesExtend > 0) refreshProjectileEdges();
  // EXE 0x21296 uploads white to DAC 255 for each launch.
  setPaletteRgb(255, 63, 63, 63);
  const { vx, vy } = getLaunchVelocity(angleDeg, power);

  const proj = createProjectile(startX, startY, vx, vy, weaponIdx, attackerIdx);
  projectiles.push(proj);

  // Update legacy reference
  syncLegacyProjectile();
}

// Spawn sub-projectiles (from behaviors)
export function spawnProjectiles(newProjs) {
  for (const p of newProjs) {
    const proj = createProjectile(p.x, p.y, p.vx, p.vy, p.weaponIdx, p.attackerIdx, p);
    projectiles.push(proj);
  }
}

// Remove a projectile by reference
export function removeProjectile(proj) {
  proj.active = false;
}

// Clear all projectiles
export function clearProjectiles() {
  for (const proj of projectiles) projectileDrawing.finish(proj);
  projectiles.length = 0;
  projectile.active = false;
}

// Resolved wall type for Erratic/Random modes (set by game.js)
export let resolvedWallType = WALL.CONCRETE;  // default Concrete

export function setResolvedWallType(type) {
  resolvedWallType = type;
}

// Get effective wall type (resolves Erratic/Random to their resolved value)
export function getEffectiveWallType() {
  const wt = config.wallType;
  if (wt === WALL.ERRATIC || wt === WALL.RANDOM) return resolvedWallType;
  return wt;
}

export function stepSingleProjectile(proj, getPixelFn, wind) {
  proj.hitPixel = null;
  if (!proj.active) return 'offscreen';

  // Rollers in rolling mode handled by behavior system
  if (proj.rolling) return 'flying';

  // Napalm particles use pixel-walking cellular automaton, not velocity physics
  // EXE: napalm handler at file 0x2DA00 — NO velocity vectors, NO damping
  // DS:1D60=0.7 is explosion damage falloff, DS:1D68=0.001 is explosion sqrt epsilon
  // Neither is related to napalm. See napalmParticleStep() in behaviors.js.
  if (proj.isNapalmParticle) return 'flying';

  // Track projectile age for weapon behaviors
  proj.age++;

  // Store trail point
  proj.trail.push({ x: Math.round(proj.x), y: Math.round(proj.y) });
  if (proj.trail.length > 200) proj.trail.shift();

  // EXE 0x21AA2..0x21B73: cap velocity magnitude before integrating position.
  const speedSquared = proj.vx * proj.vx + proj.vy * proj.vy;
  if (speedSquared > 1000000) {
    const divisor = Math.sqrt(speedSquared) / 1000;
    proj.vx /= divisor;
    proj.vy /= divisor;
  }

  const startX = Math.trunc(proj.x), startY = Math.trunc(proj.y);

  // 2. Integrate position (screen coords: y increases downward)
  proj.x += proj.vx * DT;
  proj.y -= proj.vy * DT;  // subtract because screen y is inverted

  // EXE saves the capped, pre-force velocity for collision damping.
  let tunnelVx = proj.vx, tunnelVy = proj.vy;
  let tunnelDamped = false;

  if (proj.tunnelState !== 1) {
    // 3. Viscosity (air resistance)
    const visc = getViscosityFactor();
    proj.vx *= visc;
    proj.vy *= visc;

    // 4. Gravity (EXE: vy -= 2500 × GRAVITY_CONFIG × dt)
    proj.vy -= GRAVITY_FACTOR * config.gravity * DT;

    // 5. Wind (EXE: vx += 1.25 × wind × dt)
    proj.vx += WIND_FACTOR * wind * DT;
  }

  const wallType = getEffectiveWallType();
  const sx = Math.trunc(proj.x), sy = Math.trunc(proj.y);
  const bouncingWall = wallType === WALL.PADDED || wallType === WALL.RUBBER || wallType === WALL.SPRING;

  // 8. EXE 0x21D15 calls the inclusive line walker at 0x1E2E3.
  // Visit every crossed pixel, stopping at the first collision.
  let boundaryPosition = null, bounceAxis = null;
  let outwardShieldContact = null;
  const sampleCollision = (sx, sy) => {
    const left = 3, right = config.screenWidth - 4;
    const outside = sx < left || sx > right;
    if (outside) {
      if (wallType === WALL.CONCRETE) return 'hit_wall';
      if (wallType === WALL.WRAP) {
        boundaryPosition = [sx < left ? right : left, sy];
        return 'wrapped';
      }
      if (bouncingWall) {
        boundaryPosition = [sx < left ? left : right, sy];
        bounceAxis = 'vx';
        return 'bounced';
      }
      if (sx < left - config.edgesExtend || sx > right + config.edgesExtend) {
        proj.active = false;
        return 'offscreen';
      }
    }
    if (wallType === WALL.CONCRETE && sy < PLAYFIELD_TOP) return 'hit_wall';
    if (bouncingWall && sy < PLAYFIELD_TOP) {
      boundaryPosition = [sx, PLAYFIELD_TOP]; bounceAxis = 'vy';
      return 'bounced';
    }
    const bottom = config.screenHeight - 4;
    if (sy >= bottom) {
      if (wallType !== WALL.RUBBER && wallType !== WALL.SPRING) return 'hit_wall';
      if (sy === bottom && tunnelVy > -50 && tunnelVy < 50) return 'hit_wall';
      if (sy > bottom) {
        boundaryPosition = [sx, bottom]; bounceAxis = 'vy';
        return 'bounced';
      }
    }
    // EXE does not read HUD or border pixels as tank/terrain collision data.
    if (outside) {
      const edgeY = extendedEdgeHeights?.[sx < left ? 0 : 1] ?? config.screenHeight - 4;
      if (sy > edgeY) return 'hit_terrain';
      return 'flying';
    }
    if (sy < PLAYFIELD_TOP) return 'flying';
    // EXE 0x223CD: native 80..104 is solid terrain, >=105 continues.
    // The port stores terrain separately because its palette indices differ.
    // The native walker also checks the launch point on the first step.
    if (sx >= 0 && sx < config.screenWidth && sy >= PLAYFIELD_TOP && sy < config.screenHeight) {
      // Terrain hit: check the relocated native terrain bitmap.
      if (terrainBitmap[sy * config.screenWidth + sx]) {
        // EXE 0x2253A damps the saved pre-force velocity per solid pixel.
        if (config.tunneling && proj.tunnelState !== 0 && !proj.contactTriggerActive) {
          tunnelVx *= MAG_DAMP_COEFF;
          tunnelVy *= MAG_DAMP_COEFF;
          tunnelDamped = true;
          if (tunnelVx * tunnelVx + tunnelVy * tunnelVy < MAG_ABSORB_THRESHOLD)
            return 'hit_terrain';
          terrainBitmap[sy * config.screenWidth + sx] = 0;
          writeWorldPixel(sx, sy, getBackgroundColor(sy, sx));
          return 'flying';
        }
        return 'hit_terrain';
      }

      // EXE 0x223E2: every player slot is collidable, including index 0.
      // Slot 5 is shield color; the firing tank's shield passes its own shot
      // (0x224DA). Other shield responses still need matching.
      const pixel = getPixelFn(sx, sy);
      if (pixel >= 0 && pixel < PLAYER_COLOR_MAX) {
        const ownerColor = players[proj.attackerIdx]?.colorIndex ?? proj.attackerIdx;
        if (pixel === ownerColor * 8 + 5) return 'flying';
        // Native 0x22423: enemy Mag Deflector arc pixels pass through.
        if (pixel % 8 === 5 && players[Math.floor(pixel / 8)]?.activeShield === 1)
          return 'flying';
        const target = players[Math.floor(pixel / 8)];
        if (pixel % 8 === 5 && target?.activeShield === 3 &&
            Math.sign(sx - target.x) === Math.sign(tunnelVx) &&
            Math.sign(target.y - sy) === Math.sign(tunnelVy)) {
          // Native 0x23327 returns 1 for outward contact: erase it and let the
          // line walker reach later obstacles before applying CE9A=3 aftermath.
          eraseShieldContact(target,sx,sy);
          outwardShieldContact = [sx, sy];
          return 'flying';
        }
        proj.hitPixel = pixel;
        proj.hitVelocity = {vx:tunnelVx,vy:tunnelVy};
        return 'hit_tank';
      }
    }

    return 'flying';
  };
  let collision = 'flying';
  walkExeLine(startX, startY, sx, sy, (x, y) => {
    const result = sampleCollision(x, y);
    if (result === 'flying') {
      triggerVerticalGuidance(proj,x,y);
      return true;
    }
    proj.x = x; proj.y = y;
    collision = result;
    return false;
  });

  // EXE 0x21D6C discards this step's forces after any tunnelling damping.
  if (tunnelDamped) {
    proj.vx = tunnelVx; proj.vy = tunnelVy;
    proj.tunnelState = 1;
  } else if (proj.tunnelState === 1 && (proj.x !== startX || proj.y !== startY)) {
    proj.tunnelState = -1;
  }
  if (boundaryPosition) {
    if (bounceAxis) {
      let coefficient = wallType === WALL.RUBBER ? -1 : wallType === WALL.PADDED ? -.5 : -2;
      proj.bounceCount++;
      if (proj.bounceCount > 6) {
        coefficient *= proj.wallBounceScale;
        proj.wallBounceScale *= .8;
      }
      proj[bounceAxis] *= coefficient;
    }
    [proj.x, proj.y] = boundaryPosition;
    for (const player of players) applyShieldFlight(player, proj);
    return 'flying';
  }
  if (collision === 'flying' && outwardShieldContact) {
    [proj.x, proj.y] = outwardShieldContact;
    if (wallType !== WALL.WRAP) {
      proj.bounceCount++;
      if (proj.bounceCount > 6) proj.wallBounceScale *= .8;
    }
  }
  if (collision === 'flying') {
    for (const player of players) applyShieldFlight(player, proj);
  }
  return collision;
}

// Legacy compatibility: step the first projectile (used by old game.js)
export function stepProjectile(getPixelFn, wind) {
  if (projectiles.length === 0) return 'offscreen';
  const result = stepSingleProjectile(projectiles[0], getPixelFn, wind);
  syncLegacyProjectile();
  if (result !== 'flying') {
    // Don't remove yet — let game.js handle behavior dispatch
  }
  return result;
}

// Keep legacy projectile object in sync for drawing code
function syncLegacyProjectile() {
  if (projectiles.length > 0 && projectiles[0].active) {
    const p = projectiles[0];
    projectile.active = true;
    projectile.x = p.x;
    projectile.y = p.y;
    projectile.vx = p.vx;
    projectile.vy = p.vy;
    projectile.trail = p.trail;
  } else {
    projectile.active = false;
  }
}

export function getProjectilePos() {
  if (projectiles.length > 0) {
    return { x: Math.round(projectiles[0].x), y: Math.round(projectiles[0].y) };
  }
  return { x: 0, y: 0 };
}

// Check if any projectiles are still active
export function hasActiveProjectiles() {
  return projectiles.some(p => p.active);
}
