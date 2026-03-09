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
import { setPixel, getBackgroundColor } from './framebuffer.js';
import { terrain, terrainBitmap, PLAYFIELD_TOP } from './terrain.js';
import { players } from './tank.js';
import { scoreOnDamage } from './score.js';
import { playExplosionSound, playShieldHitSound, playImpactFrame } from './sound.js';
import { random } from './utils.js';
import { TERRAIN_PAL_START, TERRAIN_PAL_COUNT, FIRE_PAL_BASE, FIRE_PAL_COUNT,
         PLAYER_PALETTE_STRIDE } from './constants.js';

// Create a circular crater at (cx, cy) with given radius
// Removes terrain from the per-pixel bitmap and framebuffer, updates terrain[] height map
export function createCrater(cx, cy, radius) {
  const r2 = radius * radius;
  const W = config.screenWidth;

  for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= W) continue;

    for (let dy = -radius; dy <= radius; dy++) {
      if (dx * dx + dy * dy > r2) continue;  // circular shape

      const y = cy + dy;
      if (y < 0 || y >= config.screenHeight) continue;

      if (terrainBitmap[y * W + x]) {
        terrainBitmap[y * W + x] = 0;
        setPixel(x, y, getBackgroundColor(y));
      }
    }

    // Update terrain height map for this column
    updateTerrainColumn(x);
  }

  // EXE: extra dirt — scatter 3-5 small dirt clumps around crater rim
  if (config.extraDirt && radius > 5) {
    const count = 3 + random(3);
    for (let i = 0; i < count; i++) {
      const angle = random(360) * Math.PI / 180;
      const dist = radius + random(radius);
      const dx = Math.round(cx + Math.cos(angle) * dist);
      const dy = Math.round(cy + Math.sin(angle) * dist);
      addDirt(dx, dy, 3 + random(3));
    }
  }
}

// Add dirt in a circle (inverse crater) — used by dirt-adding weapons
export function addDirt(cx, cy, radius) {
  const r2 = radius * radius;
  const W = config.screenWidth;

  for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= W) continue;

    for (let dy = -radius; dy <= radius; dy++) {
      if (dx * dx + dy * dy > r2) continue;

      const y = cy + dy;
      if (y < PLAYFIELD_TOP || y >= config.screenHeight) continue;

      if (!terrainBitmap[y * W + x]) {
        const palIdx = TERRAIN_PAL_START + Math.floor(Math.max(0, Math.min(TERRAIN_PAL_COUNT - 1, (config.screenHeight - 1 - y) * (TERRAIN_PAL_COUNT - 1) / (config.screenHeight - PLAYFIELD_TOP))));
        terrainBitmap[y * W + x] = palIdx;
        setPixel(x, y, palIdx);
      }
    }

    updateTerrainColumn(x);
  }
}

// Add a vertical dirt tower from impact point
// EXE: file 0x2DF00 — ±45px wide, dy=-30 (above) to +20 (below) from impact
export function addDirtTower(cx, cy, _height) {
  const width = 45;  // EXE: ±45px horizontal
  const W = config.screenWidth;
  for (let dx = -width; dx <= width; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= W) continue;
    for (let dy = -30; dy <= 20; dy++) {  // EXE: top=-30, bottom=+20 from impact
      const y = cy + dy;
      if (y < PLAYFIELD_TOP || y >= config.screenHeight) continue;
      if (!terrainBitmap[y * W + x]) {  // only fill empty pixels (EXE: pixel < 170)
        const palIdx = TERRAIN_PAL_START + Math.floor(Math.max(0, Math.min(TERRAIN_PAL_COUNT - 1, (config.screenHeight - 1 - y) * (TERRAIN_PAL_COUNT - 1) / (config.screenHeight - PLAYFIELD_TOP))));
        terrainBitmap[y * W + x] = palIdx;
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
  const W = config.screenWidth;

  for (let d = 0; d < depth; d++) {
    const y = cy + d * dir;
    if (y < PLAYFIELD_TOP || y >= config.screenHeight) break;

    for (let dx = -tunnelWidth; dx <= tunnelWidth; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      if (terrainBitmap[y * W + x]) {
        terrainBitmap[y * W + x] = 0;
        setPixel(x, y, getBackgroundColor(y));
      }
    }
  }

  // Update terrain columns
  for (let dx = -tunnelWidth; dx <= tunnelWidth; dx++) {
    const x = cx + dx;
    if (x >= 0 && x < W) updateTerrainColumn(x);
  }
}

// Earth disrupter: force unsupported dirt to fall
export function applyDisrupter(cx, cy, radius) {
  const left = Math.max(0, cx - radius);
  const right = Math.min(config.screenWidth - 1, cx + radius);
  const W = config.screenWidth;

  for (let x = left; x <= right; x++) {
    // Scan column from bottom up, let dirt fall to fill gaps
    let writeY = config.screenHeight - 1;
    for (let y = config.screenHeight - 1; y >= PLAYFIELD_TOP; y--) {
      const color = terrainBitmap[y * W + x];
      if (color) {
        if (y !== writeY) {
          // Move this terrain pixel down
          terrainBitmap[y * W + x] = 0;
          terrainBitmap[writeY * W + x] = color;
          setPixel(x, y, getBackgroundColor(y));
          setPixel(x, writeY, color);
        }
        writeY--;
      }
    }
    // Clear anything above the compacted terrain
    for (let y = writeY; y >= PLAYFIELD_TOP; y--) {
      if (terrainBitmap[y * W + x]) {
        terrainBitmap[y * W + x] = 0;
        setPixel(x, y, getBackgroundColor(y));
      }
    }
    updateTerrainColumn(x);
  }
}

// Recalculate terrain[x] from the per-pixel bitmap (not the framebuffer,
// which may contain non-terrain overlay pixels like tanks or shields)
function updateTerrainColumn(x) {
  const W = config.screenWidth;
  for (let y = PLAYFIELD_TOP; y < config.screenHeight; y++) {
    if (terrainBitmap[y * W + x]) {
      terrain[x] = y;
      return;
    }
  }
  // No terrain in this column
  terrain[x] = config.screenHeight;
}

// Screen flash state — triggered by large explosions (nukes)
export const screenFlash = { active: false, frames: 0 };

// Explosion animation state — supports queue of multiple explosions
const explosionQueue = [];
let currentExplosion = null;

export function startExplosion(cx, cy, radius, attackerIndex) {
  // EXE: large explosions (radius > 30) trigger screen flash
  if (radius > 30) {
    screenFlash.active = true;
    screenFlash.frames = 3;
  }
  playExplosionSound(radius);
  const anim = {
    cx, cy, radius, attackerIndex,
    frame: 0,
    maxFrames: radius,  // EXE: loops di from 0 to radius (one Bresenham circle per frame)
    currentRadius: 0,
  };
  if (!currentExplosion) {
    currentExplosion = anim;
  } else {
    explosionQueue.push(anim);
  }
}

// Bresenham filled circle — matches EXE bresenham_circle_fill at file 0x43690
// Draws horizontal scanlines with 4-fold symmetry using doubled-coordinate Bresenham
function bresenhamCircleFill(cx, cy, radius, colorIdx) {
  const W = config.screenWidth;
  const H = config.screenHeight;
  let si = 0;             // x step (doubled coords)
  let di = 2 * radius;    // y step (doubled coords)
  let decision = 0;

  // Draw scanline: horizontal line from (cx-halfW, y) to (cx+halfW, y)
  const scanline = (halfW, offsetY) => {
    const y = cy + offsetY;
    if (y < 0 || y >= H) return;
    const x0 = Math.max(0, cx - halfW);
    const x1 = Math.min(W - 1, cx + halfW);
    for (let x = x0; x <= x1; x++) {
      setPixel(x, y, colorIdx);
    }
  };

  while (si <= di) {
    // Only draw on even si values (EXE: test si, 1; jnz skip)
    if ((si & 1) === 0) {
      const hw = (di + 1) >> 1;   // half-width = (di+1)/2
      const h = si >> 1;          // height offset = si/2
      // 4-fold symmetry: (±hw, ±h) and (±h, ±hw)
      scanline(hw, h);
      scanline(hw, -h);
      scanline(h, hw);
      scanline(h, -hw);
    }
    decision += 2 * si + 1;
    si++;
    if (decision > 0) {
      decision -= 2 * di - 1;
      di--;
    }
  }
  // Final scanline after loop
  const hw = (di + 1) >> 1;
  const h = si >> 1;
  scanline(hw, h);
  scanline(hw, -h);
  scanline(h, hw);
  scanline(h, -hw);
}

// Step the explosion animation, returns true while active
// EXE: draw_explosion_expanding at file 0x2476B — one filled circle per frame,
// expanding from radius 0 to max. Color gradient: palette base+8 down to base.
export function stepExplosion() {
  if (!currentExplosion) return false;

  // Check if done BEFORE drawing — prevents fire pixels on the transition frame
  if (currentExplosion.frame >= currentExplosion.maxFrames) {
    currentExplosion = explosionQueue.shift() || null;
    return currentExplosion !== null;
  }

  const { cx, cy, radius, maxFrames } = currentExplosion;

  // EXE: random(3000) Hz tone per explosion frame (extras.cpp 0x247BA)
  playImpactFrame();

  // EXE: palette_base(170) += 6 → 176, then color = 176+2 - (frame*6/radius)
  // Range: 178 (bright, frame 0) → 172 (darker, last frame)
  const colorOffset = Math.floor(currentExplosion.frame * 6 / maxFrames);
  const colorIdx = Math.max(FIRE_PAL_BASE, FIRE_PAL_BASE + 8 - colorOffset);

  // EXE: frame di draws filled circle of radius di (1:1 frame-to-radius)
  bresenhamCircleFill(cx, cy, currentExplosion.frame, colorIdx);

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
      const attacker = players[attackerIndex];

      // Check shield first (Phase 4)
      if (player.shieldEnergy > 0) {
        const shieldDmg = Math.min(damage, player.shieldEnergy);
        player.shieldEnergy -= shieldDmg;
        damage -= shieldDmg;
        // EXE: random(50) Hz tone per shield hit (shields.cpp 0x3AF33)
        playShieldHitSound();
        // EXE: score_on_damage for shield absorption (+2x enemy, -1x friendly)
        if (attacker) scoreOnDamage(attacker, player, shieldDmg, true);
      }

      // EXE: score_on_damage for HP damage (+30x enemy, -15x friendly)
      if (damage > 0 && attacker) {
        scoreOnDamage(attacker, player, damage, false);
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
