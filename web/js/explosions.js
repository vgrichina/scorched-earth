// Scorched Earth - Explosion & Crater System (extras.cpp RE)
// Circular crater, expanding ring animation, damage calculation

import { config } from './config.js';
import { setPixel, getPixel } from './framebuffer.js';
import { terrain } from './terrain.js';
import { players } from './tank.js';

const BABY_MISSILE_RADIUS = 10;  // from weapon table: param=10

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

// Recalculate terrain[x] by scanning from top to find first solid pixel
// Start at y=15 to skip HUD area (rows 0-14 have palette 150 outlines/text
// which read as >= 105 and would corrupt terrain heights)
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

// Explosion animation state
let explosionAnim = null;

export function startExplosion(cx, cy, radius, attackerIndex) {
  explosionAnim = {
    cx, cy, radius, attackerIndex,
    frame: 0,
    maxFrames: 12,
    currentRadius: 0,
  };
}

// Step the explosion animation, returns true while active
export function stepExplosion() {
  if (!explosionAnim) return false;

  const { cx, cy, radius, attackerIndex, frame, maxFrames } = explosionAnim;

  // Expanding ring animation using fire palette (VGA 170-199)
  const t = frame / maxFrames;
  const ringRadius = Math.floor(radius * t);
  const ringWidth = Math.max(2, Math.floor(radius * 0.3));

  // Draw explosion ring
  for (let angle = 0; angle < 360; angle += 3) {
    const rad = angle * Math.PI / 180;
    for (let r = Math.max(0, ringRadius - ringWidth); r <= ringRadius; r++) {
      const px = Math.round(cx + Math.cos(rad) * r);
      const py = Math.round(cy + Math.sin(rad) * r);
      if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
        // Color: inner = yellow (190+), middle = orange (180+), outer = red (170+)
        const colorT = (r - (ringRadius - ringWidth)) / Math.max(ringWidth, 1);
        const palIdx = 170 + Math.floor(colorT * 29);
        setPixel(px, py, palIdx);
      }
    }
  }

  explosionAnim.frame++;
  if (explosionAnim.frame > maxFrames) {
    explosionAnim = null;
    return false;
  }
  return true;
}

export function isExplosionActive() {
  return explosionAnim !== null;
}

// Calculate and apply damage to all players from explosion at (cx, cy)
// Using simplified version of RE velocity-rotation damage formula
export function applyExplosionDamage(cx, cy, radius, attackerIndex) {
  for (const player of players) {
    if (!player.alive) continue;
    if (player.index === attackerIndex) continue;  // can still self-damage

    const dx = player.x - cx;
    const dy = player.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < radius + 10) {
      // Damage: closer = more damage, linear falloff
      const damage = Math.max(0, Math.floor((1 - dist / (radius + 10)) * radius));
      player.energy -= damage;
      if (player.energy <= 0) {
        player.energy = 0;
        player.alive = false;
      }
    }
  }

  // Self-damage check (attacker can hurt themselves)
  const attacker = players[attackerIndex];
  if (attacker && attacker.alive) {
    const dx = attacker.x - cx;
    const dy = attacker.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < radius + 10) {
      const damage = Math.max(0, Math.floor((1 - dist / (radius + 10)) * radius));
      attacker.energy -= damage;
      if (attacker.energy <= 0) {
        attacker.energy = 0;
        attacker.alive = false;
      }
    }
  }
}

export function getDefaultRadius() {
  return BABY_MISSILE_RADIUS;
}
