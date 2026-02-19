// Scorched Earth - Projectile Physics (extras.cpp RE)
// Euler integration with gravity, wind, viscosity
// Original: dt=0.02, viscosity = 1.0 - config/10000, gravity/wind pre-scaled

import { config } from './config.js';

// Physics tuning (calibrated for 320x200 screen)
const MAX_SPEED = 8;       // pixels/step at power=1000
const GRAVITY = 0.098;     // per-step downward acceleration
const WIND_SCALE = 0.003;  // wind value → per-step horizontal acceleration

export const projectile = {
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,        // positive = upward (world coords)
  trail: [],    // recent positions for drawing
};

// Viscosity factor: multiplicative per step (from RE)
function getViscosityFactor() {
  return 1.0 - config.viscosity / 10000.0;
}

// Launch projectile from tank position at given angle/power
export function launchProjectile(startX, startY, angleDeg, power) {
  const angleRad = angleDeg * Math.PI / 180;
  const speed = (power / 1000) * MAX_SPEED;

  projectile.active = true;
  projectile.x = startX;
  projectile.y = startY;
  projectile.vx = Math.cos(angleRad) * speed;
  projectile.vy = Math.sin(angleRad) * speed;  // positive = up
  projectile.trail = [];
}

// Advance projectile one physics step
// Returns: 'flying' | 'hit_terrain' | 'hit_tank' | 'offscreen'
export function stepProjectile(getPixelFn, wind) {
  if (!projectile.active) return 'offscreen';

  // Store trail point
  projectile.trail.push({ x: Math.round(projectile.x), y: Math.round(projectile.y) });
  if (projectile.trail.length > 200) projectile.trail.shift();

  // 1. Viscosity (air resistance)
  const visc = getViscosityFactor();
  projectile.vx *= visc;
  projectile.vy *= visc;

  // 2. Gravity (reduce upward velocity)
  projectile.vy -= GRAVITY;

  // 3. Wind (horizontal only, from RE)
  projectile.vx += wind * WIND_SCALE;

  // 4. Integrate position (screen coords: y increases downward)
  projectile.x += projectile.vx;
  projectile.y -= projectile.vy;  // subtract because screen y is inverted

  const sx = Math.round(projectile.x);
  const sy = Math.round(projectile.y);

  // 5. Bounds check
  if (sx < -50 || sx > config.screenWidth + 50 || sy > config.screenHeight + 50) {
    projectile.active = false;
    return 'offscreen';
  }
  // Allow flying above screen (negative y)
  if (sy < -500) {
    projectile.active = false;
    return 'offscreen';
  }

  // 6. Collision detection via pixel color (only when on-screen and below HUD)
  // Skip y < 15: HUD area has palette 150 (outlines/text) that reads as terrain
  if (sx >= 0 && sx < config.screenWidth && sy >= 15 && sy < config.screenHeight) {
    const pixel = getPixelFn(sx, sy);

    // Tank hit: pixel < 80 and pixel > 0 (player colors are 0-79)
    if (pixel > 0 && pixel < 80) {
      projectile.active = false;
      return 'hit_tank';
    }

    // Terrain hit: pixel >= 105
    if (pixel >= 105) {
      projectile.active = false;
      return 'hit_terrain';
    }
  }

  return 'flying';
}

export function getProjectilePos() {
  return { x: Math.round(projectile.x), y: Math.round(projectile.y) };
}
