// Scorched Earth - Projectile Physics
// EXE source: extras.cpp (seg 0x1895, file base 0x20EA0)
// EXE: physics timestep calibrated via MIPS benchmark (adaptive dt, default 0.02)
// EXE: viscosity factor = 1.0 - config/10000 (multiplicative per step)
// EXE: gravity_accel = 2500 × GRAVITY_CONFIG px/sec² (DS:512A, default 0.2, range 0.05-10.0)
// EXE: wind_accel = 1.25 × wind px/sec² (horizontal only)
// EXE: no explicit speed limit — velocity bounded naturally by viscosity damping

import { config } from './config.js';
import { clamp } from './utils.js';
import { players } from './tank.js';
import { PLAYFIELD_TOP } from './terrain.js';
import { PLAYER_COLOR_MAX, TERRAIN_THRESHOLD } from './constants.js';

// Physics tuning — per-second values matching original RE scale
// EXE: dt calibrated via CPU MIPS benchmark, stored in DS for adaptive timestep
export const DT = 0.02;           // EXE: default timestep (DS:0x1CFA = 0.02)
const MAX_SPEED = 400;             // Web velocity scale: power × (MAX_SPEED/1000)

// EXE-derived gravity/wind constants (from setup_physics_constants at file 0x21064)
// EXE: gravity_accel = 2500 × GRAVITY_CONFIG px/sec² (DS:1CF2=50.0, gravity_step=50²×G×dt)
// EXE: wind_accel = 1.25 × wind px/sec² (DS:1CF6=40.0, wind_step=wind×50/(40)×dt)
// Web scaling: k = MAX_SPEED/1000 = 0.4, k² = 0.16 — preserves trajectory shape & range
const GRAVITY_FACTOR = 400.0;     // EXE: 2500 × k² = 2500 × 0.16 (config-scaled)
const WIND_FACTOR = 0.2;          // EXE: 1.25 × k² = 1.25 × 0.16

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

// EXE: Mag Deflector in-flight deflection (file 0x21A80-0x21C3A, inside sim_step)
// EXE: Iterates all players per step. Deflection strength = 1/normDist * dt.
// EXE: DS:1D2C = 1000000.0 (distance² threshold = 1000px radius)
// EXE: DS:1D30 = 1000.0 (normalization divisor)
// EXE: No additional multiplier — scales as (direction / normDist) * dt only.
const MAG_RANGE_SQ = 1000000.0;
const MAG_RANGE = 1000.0;
const MAG_DEFLECTOR_IDX = 45;
const SUPER_MAG_IDX = 52;

function applyMagDeflection(proj) {
  for (const player of players) {
    if (!player.alive) continue;
    if (player.index === proj.attackerIdx) continue;

    // EXE: checks player inventory for Mag Deflector (idx 45) or Super Mag (idx 52)
    const magCount = (player.inventory[MAG_DEFLECTOR_IDX] || 0) +
                     (player.inventory[SUPER_MAG_IDX] || 0);
    if (magCount <= 0) continue;

    const dx = proj.x - player.x;
    const dy = proj.y - (player.y - 4);  // center of tank body
    const distSq = dx * dx + dy * dy;

    // EXE: fcomp [DS:1D2C] — range check, 1000px radius
    if (distSq > MAG_RANGE_SQ || distSq < 1.0) continue;

    // EXE: normDist = sqrt(distSq) / 1000.0 (DS:1D30)
    const dist = Math.sqrt(distSq);
    const normDist = Math.max(dist / MAG_RANGE, 0.05);  // cap to prevent infinity

    // EXE: deflection = (direction / normDist) * dt — no extra multiplier
    const pushX = (dx / dist) / normDist;
    const pushY = (dy / dist) / normDist;

    proj.vx += pushX * DT;
    proj.vy -= pushY * DT;  // screen Y inverted
  }
}

// EXE: collision velocity damping at 0x2251A
// When projectile hits near a Mag Deflector player and attacker has no Super Mag:
// velocity *= 0.75, absorb if speed² < 2000
// EXE: DS:1D54 = 0.75 (damping coefficient), DS:1D58 = 2000.0 (absorption threshold)
const MAG_DAMP_COEFF = 0.75;
const MAG_ABSORB_THRESHOLD = 2000.0;

export function applyMagDamping(proj) {
  if (proj.superMagActive) return false;  // Super Mag bypasses damping

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
    weaponIdx: weaponIdx ?? 2,
    attackerIdx: attackerIdx ?? 0,
    // Optional fields set by behaviors
    isSubWarhead: opts.isSubWarhead || false,
    subRadius: opts.subRadius || 0,
    isNapalmParticle: opts.isNapalmParticle || false,
    isDirtParticle: opts.isDirtParticle || false,
    napalmLife: opts.napalmLife || 0,
    rolling: false,
    bounceCount: 0,
    hasSplit: false,
    prevVy: undefined,
    superMagActive: opts.superMagActive || false,  // EXE: DS:0x1C76 — bypasses Mag Deflector defense
    ...opts,
  };
}

// Launch projectile from tank position at given angle/power
export function launchProjectile(startX, startY, angleDeg, power, weaponIdx, attackerIdx) {
  const angleRad = angleDeg * Math.PI / 180;
  const speed = (power / 1000) * MAX_SPEED;
  const vx = Math.cos(angleRad) * speed;
  const vy = Math.sin(angleRad) * speed;

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
  projectiles.length = 0;
  projectile.active = false;
}

// Resolved wall type for Erratic/Random modes (set by game.js)
export let resolvedWallType = WALL.CONCRETE;  // default Concrete

export function setResolvedWallType(type) {
  resolvedWallType = type;
}

// Get effective wall type (resolves Erratic/Random to their resolved value)
function getEffectiveWallType() {
  const wt = config.wallType;
  if (wt === WALL.ERRATIC || wt === WALL.RANDOM) return resolvedWallType;
  return wt;
}

// Wall collision handling
function handleWallCollision(proj) {
  const wallType = getEffectiveWallType();
  const w = config.screenWidth;

  // Wrap-around (type 3)
  if (wallType === WALL.WRAP) {
    if (proj.x < 0) proj.x += w;
    if (proj.x >= w) proj.x -= w;
    return 'flying';
  }

  // Check if projectile hit left or right wall
  const hitLeft = proj.x < 0;
  const hitRight = proj.x >= w;

  if (!hitLeft && !hitRight) return 'flying';

  switch (wallType) {
    case WALL.CONCRETE:
      // Detonate on wall impact
      proj.x = clamp(proj.x, 0, w - 1);
      return 'hit_wall';

    case WALL.RUBBER:
      // EXE: coeff = -1.0 (DS:0x1D34) — perfect reflection, no energy loss
      proj.vx = -proj.vx;
      proj.x = hitLeft ? 1 : w - 2;
      return 'flying';

    case WALL.PADDED:
      // EXE: coeff = -0.5 (DS:0x1D3C) — half velocity reflection
      proj.vx = -proj.vx * 0.5;
      proj.x = hitLeft ? 1 : w - 2;
      return 'flying';

    case WALL.SPRING:
      // EXE: coeff = -2.0 (DS:0x1D44) — doubled velocity reflection
      proj.vx = -proj.vx * 2.0;
      proj.x = hitLeft ? 1 : w - 2;
      return 'flying';

    case WALL.NONE:
    default:
      // EXE: EDGES_EXTEND=75 (DS:0x5158, default 75px)
      if (proj.x < -75 || proj.x > w + 75) return 'offscreen';
      return 'flying';
  }
}

// Advance a single projectile one physics step
// Returns: 'flying' | 'hit_terrain' | 'hit_tank' | 'hit_wall' | 'offscreen'
export function stepSingleProjectile(proj, getPixelFn, wind) {
  if (!proj.active) return 'offscreen';

  // Rollers in rolling mode handled by behavior system
  if (proj.rolling) return 'flying';

  // Napalm particles use pixel-walking cellular automaton, not velocity physics
  // EXE: napalm handler at file 0x2DA00 — NO velocity vectors, NO damping
  // DS:1D60=0.7 is explosion damage falloff, DS:1D68=0.001 is explosion sqrt epsilon
  // Neither is related to napalm. See napalmParticleStep() in behaviors.js.
  if (proj.isNapalmParticle) return 'flying';

  // Track projectile age for spawn grace period
  proj.age++;

  // Store trail point
  proj.trail.push({ x: Math.round(proj.x), y: Math.round(proj.y) });
  if (proj.trail.length > 200) proj.trail.shift();

  // EXE physics order: Mag → Position → Viscosity → Gravity → Wind
  // NOTE: The EXE has NO explicit speed limit check. DS:1CA2 = 1.5 is only
  // used as a sound frequency multiplier in Mag Deflector (sqrt(dist)*1.5+1000),
  // not a speed threshold. Speed is bounded naturally by viscosity damping.

  // 1. Mag Deflector zone deflection (EXE: extras.cpp 0x21A80 inner loop)
  applyMagDeflection(proj);

  // 2. Integrate position (screen coords: y increases downward)
  proj.x += proj.vx * DT;
  proj.y -= proj.vy * DT;  // subtract because screen y is inverted

  // 3. Viscosity (air resistance)
  const visc = getViscosityFactor();
  proj.vx *= visc;
  proj.vy *= visc;

  // 4. Gravity (EXE: vy -= 2500 × GRAVITY_CONFIG × dt, scaled by k²)
  proj.vy -= GRAVITY_FACTOR * config.gravity * DT;

  // 5. Wind (EXE: vx += 1.25 × wind × dt, scaled by k²)
  proj.vx += WIND_FACTOR * wind * DT;

  // 6. Wall collision
  const wallResult = handleWallCollision(proj);
  if (wallResult === 'hit_wall') return 'hit_wall';
  if (wallResult === 'offscreen') return 'offscreen';

  const sx = Math.round(proj.x);
  const sy = Math.round(proj.y);

  // 7. Vertical bounds check
  if (sy > config.screenHeight + 50) {
    proj.active = false;
    return 'offscreen';
  }
  if (sy < -500) {
    proj.active = false;
    return 'offscreen';
  }

  // 8. Collision detection via pixel color (only when on-screen and below HUD)
  // EXE: fire_weapon at file 0x30652 launches from barrel tip (icons.cpp BARREL_LENGTH=12)
  // EXE: pixel-based collision — player colors 0-79, terrain >= 105
  // EXE VERIFIED: thresholds (>0 && <80 = tank, >=105 = terrain) match EXE collision
  // checks in extras.cpp projectile step. Sky/HUD pixels (0, 80-104) pass through.
  // Skip first 2 steps (grace period) to clear barrel/body pixels at low power
  if (proj.age > 2 && sx >= 0 && sx < config.screenWidth && sy >= PLAYFIELD_TOP && sy < config.screenHeight) {
    const pixel = getPixelFn(sx, sy);

    // Tank hit: pixel < PLAYER_COLOR_MAX and pixel > 0 (player colors are 0-79)
    if (pixel > 0 && pixel < PLAYER_COLOR_MAX) {
      return 'hit_tank';
    }

    // Terrain hit: pixel >= TERRAIN_THRESHOLD
    if (pixel >= TERRAIN_THRESHOLD) {
      return 'hit_terrain';
    }
  }

  return 'flying';
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
