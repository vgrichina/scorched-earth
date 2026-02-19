// Scorched Earth - Projectile Physics
// EXE source: extras.cpp (seg 0x1895, file base 0x20EA0)
// EXE: physics timestep calibrated via MIPS benchmark (adaptive dt, default 0.02)
// EXE: viscosity factor = 1.0 - config/10000 (multiplicative per step)
// EXE: gravity = 4.9 px/sec² (from SCORCH.CFG GRAVITY=0.05-10.0, default 1.0)
// EXE: wind = horizontal only, WIND_SCALE applied per step
// EXE: speed limit = 1.5 speed-squared threshold

import { config } from './config.js';
import { clamp } from './utils.js';

// Physics tuning — per-second values matching original RE scale
// EXE: dt calibrated via CPU MIPS benchmark, stored in DS for adaptive timestep
export const DT = 0.02;           // EXE: default timestep (from disasm/physics_timestep_wind_analysis.txt)
const MAX_SPEED = 400;             // EXE: pixels/sec at power=1000 (power/1000 * MAX_SPEED)
const GRAVITY = 4.9;               // EXE: pixels/sec² downward (SCORCH.CFG GRAVITY scaled)
const WIND_SCALE = 0.15;           // EXE: wind config → pixels/sec² horizontal accel

// Wall types — EXE: ELASTIC config variable, wall collision in physics loop
export const WALL = {
  CONCRETE: 0,  // EXE: detonate on wall impact
  RUBBER:   1,  // EXE: reflect with 0.8x velocity loss
  SPRING:   2,  // EXE: reflect with 1.2x velocity increase
  WRAP:     3,  // EXE: wrap-around screen edges
  NONE:     4,  // EXE: fly off screen
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

// Wall collision handling
function handleWallCollision(proj) {
  const wallType = config.wallType;
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
      // Reflect with slight velocity loss
      proj.vx = -proj.vx * 0.8;
      proj.x = hitLeft ? 1 : w - 2;
      return 'flying';

    case WALL.SPRING:
      // Reflect with velocity increase
      proj.vx = -proj.vx * 1.2;
      proj.x = hitLeft ? 1 : w - 2;
      return 'flying';

    case WALL.NONE:
    default:
      // Fly off screen
      if (proj.x < -50 || proj.x > w + 50) return 'offscreen';
      return 'flying';
  }
}

// Advance a single projectile one physics step
// Returns: 'flying' | 'hit_terrain' | 'hit_tank' | 'hit_wall' | 'offscreen'
export function stepSingleProjectile(proj, getPixelFn, wind) {
  if (!proj.active) return 'offscreen';

  // Rollers in rolling mode handled by behavior system
  if (proj.rolling) return 'flying';

  // Track projectile age for spawn grace period
  proj.age++;

  // Store trail point
  proj.trail.push({ x: Math.round(proj.x), y: Math.round(proj.y) });
  if (proj.trail.length > 200) proj.trail.shift();

  // 1. Viscosity (air resistance) — skip for napalm particles (they have own damping)
  if (!proj.isNapalmParticle) {
    const visc = getViscosityFactor();
    proj.vx *= visc;
    proj.vy *= visc;
  }

  // 2. Gravity (reduce upward velocity)
  proj.vy -= GRAVITY * DT;

  // 3. Wind (horizontal only, from RE) — skip for napalm particles
  if (!proj.isNapalmParticle) {
    proj.vx += wind * WIND_SCALE * DT;
  }

  // 4. Integrate position (screen coords: y increases downward)
  proj.x += proj.vx * DT;
  proj.y -= proj.vy * DT;  // subtract because screen y is inverted

  // 5. Wall collision
  const wallResult = handleWallCollision(proj);
  if (wallResult === 'hit_wall') return 'hit_wall';
  if (wallResult === 'offscreen') return 'offscreen';

  const sx = Math.round(proj.x);
  const sy = Math.round(proj.y);

  // 6. Vertical bounds check
  if (sy > config.screenHeight + 50) {
    proj.active = false;
    return 'offscreen';
  }
  if (sy < -500) {
    proj.active = false;
    return 'offscreen';
  }

  // 7. Collision detection via pixel color (only when on-screen and below HUD)
  // EXE: fire_weapon at file 0x30652 launches from barrel tip (icons.cpp BARREL_LENGTH=12)
  // EXE: pixel-based collision — player colors 0-79, terrain >= 105
  // EXE VERIFIED: thresholds (>0 && <80 = tank, >=105 = terrain) match EXE collision
  // checks in extras.cpp projectile step. Sky/HUD pixels (0, 80-104) pass through.
  // Skip first 2 steps (grace period) to clear barrel/body pixels at low power
  if (proj.age > 2 && sx >= 0 && sx < config.screenWidth && sy >= 15 && sy < config.screenHeight) {
    const pixel = getPixelFn(sx, sy);

    // Tank hit: pixel < 80 and pixel > 0 (player colors are 0-79)
    if (pixel > 0 && pixel < 80) {
      return 'hit_tank';
    }

    // Terrain hit: pixel >= 105
    if (pixel >= 105) {
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
