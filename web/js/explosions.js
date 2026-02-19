// Scorched Earth - Explosion & Crater System
// EXE source: extras.cpp (seg 0x1895, file base 0x20EA0)
// EXE: damage function at file 0x23327 (seg 0x1C90:0x0027)
// EXE: damage formula — velocity-rotation with atan2/cos/sin:
//   angle1 = atan2(dy, dx); angle2 = atan2(vy, vx)
//   adjusted = (angle2 - angle1) * 2.0  [DS:1D5C = f32 2.0]
//   negate velocity, rotate by adjusted angle, magnitude / 100 * radius
//   0.7x attenuation per hit [DS:1D60 = f64 0.7], threshold [DS:1D68 = f64 0.001]
// EXE: explosion fire palette VGA 170-199 (3 bands × 10 entries)

import { config } from './config.js';
import { setPixel, getPixel } from './framebuffer.js';
import { terrain } from './terrain.js';
import { players } from './tank.js';

// Create a circular crater at (cx, cy) with given radius
// Removes terrain pixels, replaces with sky, updates terrain[] height map
export function createCrater(cx, cy, radius) {
  const r2 = radius * radius;

  for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= config.screenWidth) continue;

    for (let dy = -radius; dy <= radius; dy++) {
      if (dx * dx + dy * dy > r2) continue;  // circular shape

      const y = cy + dy;
      if (y < 0 || y >= config.screenHeight) continue;

      const pixel = getPixel(x, y);
      // Only remove terrain pixels (>= 105) and non-player pixels
      if (pixel >= 105) {
        // Replace with sky color based on Y position (80-103 range)
        const skyIdx = 80 + Math.floor(y * 23 / (config.screenHeight - 1));
        setPixel(x, y, skyIdx);
      }
    }

    // Update terrain height map for this column
    updateTerrainColumn(x);
  }
}

// Add dirt in a circle (inverse crater) — used by dirt-adding weapons
export function addDirt(cx, cy, radius) {
  const r2 = radius * radius;

  for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= config.screenWidth) continue;

    for (let dy = -radius; dy <= radius; dy++) {
      if (dx * dx + dy * dy > r2) continue;

      const y = cy + dy;
      if (y < 15 || y >= config.screenHeight) continue;

      const pixel = getPixel(x, y);
      // Only fill non-terrain pixels (sky/empty)
      if (pixel < 105) {
        // Terrain color based on depth
        const palIdx = 120 + Math.floor(Math.max(0, Math.min(29, (config.screenHeight - 1 - y) * 29 / (config.screenHeight - 15))));
        setPixel(x, y, palIdx);
      }
    }

    updateTerrainColumn(x);
  }
}

// Add a vertical dirt tower from impact point upward
export function addDirtTower(cx, cy, height) {
  const width = 3;
  for (let dx = -width; dx <= width; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= config.screenWidth) continue;
    for (let dy = 0; dy < height; dy++) {
      const y = cy - dy;
      if (y < 15 || y >= config.screenHeight) continue;
      const pixel = getPixel(x, y);
      if (pixel < 105) {
        const palIdx = 120 + Math.floor(Math.max(0, Math.min(29, (config.screenHeight - 1 - y) * 29 / (config.screenHeight - 15))));
        setPixel(x, y, palIdx);
      }
    }
    updateTerrainColumn(x);
  }
}

// Create a tunnel through terrain from impact point
export function createTunnel(cx, cy, depth, goesDown) {
  const tunnelWidth = Math.max(3, Math.floor(depth / 4));
  const dir = goesDown ? 1 : -1;

  for (let d = 0; d < depth; d++) {
    const y = cy + d * dir;
    if (y < 15 || y >= config.screenHeight) break;

    for (let dx = -tunnelWidth; dx <= tunnelWidth; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= config.screenWidth) continue;
      const pixel = getPixel(x, y);
      if (pixel >= 105) {
        const skyIdx = 80 + Math.floor(y * 23 / (config.screenHeight - 1));
        setPixel(x, y, skyIdx);
      }
    }
  }

  // Update terrain columns
  for (let dx = -tunnelWidth; dx <= tunnelWidth; dx++) {
    const x = cx + dx;
    if (x >= 0 && x < config.screenWidth) updateTerrainColumn(x);
  }
}

// Earth disrupter: force unsupported dirt to fall
export function applyDisrupter(cx, cy, radius) {
  const left = Math.max(0, cx - radius);
  const right = Math.min(config.screenWidth - 1, cx + radius);

  for (let x = left; x <= right; x++) {
    // Scan column from bottom up, let dirt fall to fill gaps
    let writeY = config.screenHeight - 1;
    for (let y = config.screenHeight - 1; y >= 15; y--) {
      const pixel = getPixel(x, y);
      if (pixel >= 105) {
        if (y !== writeY) {
          // Move this terrain pixel down
          const skyIdx = 80 + Math.floor(y * 23 / (config.screenHeight - 1));
          setPixel(x, y, skyIdx);
          setPixel(x, writeY, pixel);
        }
        writeY--;
      }
    }
    // Clear anything above the compacted terrain
    for (let y = writeY; y >= 15; y--) {
      const pixel = getPixel(x, y);
      if (pixel >= 105) {
        const skyIdx = 80 + Math.floor(y * 23 / (config.screenHeight - 1));
        setPixel(x, y, skyIdx);
      }
    }
    updateTerrainColumn(x);
  }
}

// Recalculate terrain[x] by scanning from top to find first solid pixel
function updateTerrainColumn(x) {
  for (let y = 15; y < config.screenHeight; y++) {
    if (getPixel(x, y) >= 105) {
      terrain[x] = y;
      return;
    }
  }
  // No terrain in this column
  terrain[x] = config.screenHeight;
}

// Explosion animation state — supports queue of multiple explosions
const explosionQueue = [];
let currentExplosion = null;

export function startExplosion(cx, cy, radius, attackerIndex) {
  const anim = {
    cx, cy, radius, attackerIndex,
    frame: 0,
    maxFrames: Math.max(8, Math.floor(radius * 0.5)),
    currentRadius: 0,
  };
  if (!currentExplosion) {
    currentExplosion = anim;
  } else {
    explosionQueue.push(anim);
  }
}

// Step the explosion animation, returns true while active
export function stepExplosion() {
  if (!currentExplosion) return false;

  // Check if done BEFORE drawing — prevents fire pixels on the transition frame
  if (currentExplosion.frame >= currentExplosion.maxFrames) {
    currentExplosion = explosionQueue.shift() || null;
    return currentExplosion !== null;
  }

  const { cx, cy, radius, maxFrames } = currentExplosion;

  // Expanding ring animation using fire palette (VGA 170-199)
  const t = currentExplosion.frame / maxFrames;
  const ringRadius = Math.floor(radius * t);
  const ringWidth = Math.max(2, Math.floor(radius * 0.3));

  // Draw explosion ring — outer ring uses fire palette, inner ring uses attacker's color
  const attackerBase = (currentExplosion.attackerIndex || 0) * 8;
  for (let angle = 0; angle < 360; angle += 3) {
    const rad = angle * Math.PI / 180;
    for (let r = Math.max(0, ringRadius - ringWidth); r <= ringRadius; r++) {
      const px = Math.round(cx + Math.cos(rad) * r);
      const py = Math.round(cy + Math.sin(rad) * r);
      if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
        const colorT = (r - (ringRadius - ringWidth)) / Math.max(ringWidth, 1);
        // Inner portion: attacker color gradient, outer: fire palette
        const palIdx = colorT < 0.4
          ? attackerBase + Math.floor(colorT * 12.5)  // player color slots 0-4
          : 170 + Math.floor(colorT * 29);
        setPixel(px, py, palIdx);
      }
    }
  }

  currentExplosion.frame++;
  return true;
}

export function isExplosionActive() {
  return currentExplosion !== null;
}

// Calculate and apply damage to all players from explosion at (cx, cy)
// EXE: damage function at file 0x23327 (seg 0x1C90:0x0027) in extras.cpp
// EXE: reads velocity from DS:E4DC (vx) and DS:E4E4 (vy)
// EXE: calls _atan2 at file 0x1421, _cos at 0x13D1, _sin at 0x1204
// EXE: doubling constant at DS:1D5C (f32 2.0)
// EXE: 0.7x attenuation at DS:1D60 (f64 0.7), threshold at DS:1D68 (f64 0.001)
// EXE: sign comparison — checks if projectile approaching via velocity vs displacement
export function applyExplosionDamage(cx, cy, radius, attackerIndex, projVx, projVy) {
  // If we have projectile velocity, use the RE velocity-rotation formula
  // Otherwise fall back to distance-based damage
  const useVelocityDamage = (projVx !== undefined && projVy !== undefined);
  let vx = projVx || 0;
  let vy = projVy || 0;

  for (const player of players) {
    if (!player.alive) continue;

    const dx = player.x - cx;
    const dy = cy - player.y;  // world coords: positive = up
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > radius + 10) continue;

    let damage;
    if (useVelocityDamage && (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1)) {
      // RE velocity-rotation formula
      const angle1 = Math.atan2(dy, dx);
      const angle2 = Math.atan2(vy, vx);
      const adjusted = (angle2 - angle1) * 2.0;
      const cosVal = Math.cos(adjusted);
      const sinVal = Math.sin(adjusted);

      // Negate velocity for impact
      const nvx = -vx;
      const nvy = -vy;

      // 2D rotation
      const newVx = cosVal * nvx + sinVal * nvy;
      const newVy = cosVal * nvy - sinVal * nvx;

      damage = Math.floor(Math.sqrt(newVx * newVx + newVy * newVy) / 100.0 * radius);

      // Attenuate velocity 0.7x for subsequent hits (RE: DS:1D60)
      vx *= 0.7;
      vy *= 0.7;
    } else {
      // Fallback: linear distance-based
      damage = Math.max(0, Math.floor((1 - dist / (radius + 10)) * radius));
    }

    if (damage > 0) {
      // Check shield first (Phase 4)
      if (player.shieldEnergy > 0) {
        if (player.shieldEnergy >= damage) {
          player.shieldEnergy -= damage;
          damage = 0;
        } else {
          damage -= player.shieldEnergy;
          player.shieldEnergy = 0;
        }
      }

      player.energy -= damage;
      if (player.energy <= 0) {
        player.energy = 0;
        player.alive = false;
      }
    }
  }
}

export function getDefaultRadius() {
  return 10;  // Baby Missile fallback
}
