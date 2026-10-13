// Scorched Earth - Explosion & Crater System
// EXE source: extras.cpp (seg 0x1895, file base 0x20EA0)
// EXE: damage function at file 0x23327 (seg 0x1C90:0x0027)
// EXE: damage formula — velocity-rotation with atan2/cos/sin:
//   angle1 = atan2(dy, dx); angle2 = atan2(vy, vx)
//   adjusted = (angle2 - angle1) * 2.0  [DS:1D5C = f32 2.0]
//   negate velocity, rotate by adjusted angle, magnitude / 100 * radius
//   0.7x attenuation per hit [DS:1D60 = f64 0.7], threshold [DS:1D68 = f64 0.001]
// EXE: explosion fire palette VGA 170-199 (3 bands × 10 entries)

import { config, GRAPHICS_MODES } from './config.js';
import { palette6, setPaletteRgb } from './palette.js';
import { getEffectiveWallType, WALL } from './physics.js';
import { getPixel, getBackgroundColor } from './framebuffer.js';
import { writeWorldPixel as setPixel } from './projectile-render.js';
import { terrain, terrainBitmap, PLAYFIELD_TOP } from './terrain.js';
import { players } from './tank.js';
import { scoreOnDamage } from './score.js';
import { playExplosionSound, playShieldHitSound } from './sound.js';
import { random } from './utils.js';
import { TERRAIN_PAL_START, FIRE_PAL_BASE, FIRE_PAL_COUNT,
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
        setPixel(x, y, getBackgroundColor(y, x));
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
        terrainBitmap[y * W + x] = TERRAIN_PAL_START;
        setPixel(x, y, TERRAIN_PAL_START);
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
        terrainBitmap[y * W + x] = TERRAIN_PAL_START;
        setPixel(x, y, TERRAIN_PAL_START);
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
        setPixel(x, y, getBackgroundColor(y, x));
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
          setPixel(x, y, getBackgroundColor(y, x));
          setPixel(x, writeY, color);
        }
        writeY--;
      }
    }
    // Clear anything above the compacted terrain
    for (let y = writeY; y >= PLAYFIELD_TOP; y--) {
      if (terrainBitmap[y * W + x]) {
        terrainBitmap[y * W + x] = 0;
        setPixel(x, y, getBackgroundColor(y, x));
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

// Legacy overlay state; ordinary native blasts do not trigger a white flash.
export const screenFlash = { active: false, frames: 0 };

// Explosion animation state — supports queue of multiple explosions
const explosionQueue = [];
let currentExplosion = null;

function setupExplosionPalette() {
  // EXE 0x43C8E uploads a 40-entry red ramp at native indices 200..239.
  for (let i = 0; i < 20; i++) {
    setPaletteRgb(200 + i, Math.trunc(i * 63 / 19), 0, 0);
    setPaletteRgb(220 + i, Math.trunc((19 - i) * 63 / 19), 0, 0);
  }
}

export function startExplosion(cx, cy, radius, attackerIndex, onComplete = null) {
  setupExplosionPalette();
  playExplosionSound(radius);
  const anim = {
    cx, cy, radius, attackerIndex, onComplete,
    frame: 0,
    maxFrames: Math.ceil(radius / (radius < 40 ? 1 : 2)),
    currentRadius: 1,
    radiusStep: radius < 40 ? 1 : 2,
    pixels: new Map(),
    cycleCount: 0,
    blackened: false,
  };
  if (!currentExplosion) {
    currentExplosion = anim;
  } else {
    explosionQueue.push(anim);
  }
}

// Bresenham filled circle — matches EXE bresenham_circle_fill at file 0x43690
// Draws horizontal scanlines with 4-fold symmetry using doubled-coordinate Bresenham
export function bresenhamCircleFill(cx, cy, radius, colorIdx,
  { protectedMin = 1, protectedMax = 0, writePixel = setPixel,
    wrap = getEffectiveWallType() === WALL.WRAP } = {}) {
  const W = config.screenWidth;
  const H = config.screenHeight;
  const aspect = GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const scaleX = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const scaleY = aspect > 1 ? Math.trunc(65536 / aspect) : 65536;
  let si = 0;             // x step (doubled coords)
  let di = 2 * radius;    // y step (doubled coords)
  let decision = 0;

  // Draw scanline: horizontal line from (cx-halfW, y) to (cx+halfW, y)
  const scanline = (halfW, offsetY) => {
    // EXE 0x43B4E: signed fixed-point transform before playfield clipping.
    const y = cy + Math.floor(offsetY * scaleY / 65536);
    if (y < PLAYFIELD_TOP || y > H - 4) return;
    let x0 = cx + Math.floor(-halfW * scaleX / 65536);
    let x1 = cx + Math.floor(halfW * scaleX / 65536);
    // Native scanline fills inward from both ends until a protected pixel.
    const protectedAt = x => {
      const color = getPixel(x, y);
      return color >= protectedMin && color <= protectedMax;
    };
    // Native 0x434AE/0x4352A draws each spill inward from its far end,
    // stopping at a protected pixel before clipping the central span.
    if (x0 < 3) {
      if (wrap) {
        for (let x = W - 4 - (3 - x0 - 1); x <= W - 4; x++) {
          if (protectedAt(x)) break;
          writePixel(x, y, colorIdx);
        }
      }
      x0 = 3;
      if (x0 > x1) return;
    }
    if (x1 > W - 4) {
      if (wrap) {
        for (let x = x1 - (W - 4) + 3 - 1; x >= 3; x--) {
          if (protectedAt(x)) break;
          writePixel(x, y, colorIdx);
        }
      }
      x1 = W - 4;
      if (x0 > x1) return;
    }
    let left = x0, right = x1;
    while (left <= right && !protectedAt(left)) writePixel(left++, y, colorIdx);
    while (right >= left && !protectedAt(right)) writePixel(right--, y, colorIdx);
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

// EXE 0x43E97 invokes the unconditional callback circle at 0x43ACA.
// Restore every covered pixel, including blast colors and traces, to sky.
export function restoreExplosionTerrain(cx, cy, radius) {
  const columns = new Set();
  bresenhamCircleFill(cx, cy, radius, 0, {
    writePixel(x, y) {
      terrainBitmap[y * config.screenWidth + x] = 0;
      setPixel(x, y, getBackgroundColor(y, x));
      columns.add(x);
    },
  });
  for (const x of columns) updateTerrainColumn(x);
}

// Native ordinary-blast growth, then large-blast palette cycling.
// Native delay timing and post-restoration damage still need matching.
export function stepExplosion() {
  if (!currentExplosion) return false;
  const anim = currentExplosion;
  if (anim.currentRadius > anim.radius && (anim.radius <= 30 || anim.blackened)) {
    restoreExplosionTerrain(anim.cx, anim.cy, anim.radius);
    anim.onComplete?.();
    currentExplosion = explosionQueue.shift() || null;
    if (currentExplosion) setupExplosionPalette();
    return currentExplosion !== null;
  }
  // Keep the earlier color bands across the main loop's clean-world repaint.
  for (const [index, color] of anim.pixels)
    setPixel(index % config.screenWidth, Math.floor(index / config.screenWidth), color);
  if (anim.currentRadius > anim.radius) {
    if (anim.cycleCount < 49) {
      // EXE 0x443EB rotates entries 200..239 one position toward lower indices.
      const first = [...palette6.slice(600, 603)];
      for (let i = 200; i < 239; i++)
        setPaletteRgb(i, ...palette6.slice((i + 1) * 3, (i + 2) * 3));
      setPaletteRgb(239, ...first);
      anim.cycleCount++;
    } else {
      // EXE 0x43E50 clears only the first 25 entries before the final upload.
      for (let i = 200; i < 225; i++) setPaletteRgb(i, 0, 0, 0);
      anim.blackened = true;
    }
    return true;
  }
  const colorIdx = 220 - Math.trunc(anim.currentRadius * 20 / anim.radius);
  bresenhamCircleFill(anim.cx, anim.cy, anim.currentRadius, colorIdx, {
    protectedMin: colorIdx + 1, protectedMax: 240,
    writePixel(x, y, color) {
      anim.pixels.set(y * config.screenWidth + x, color);
      setPixel(x, y, color);
    },
  });
  anim.currentRadius += anim.radiusStep;
  anim.frame++;
  return true;
}

export function isExplosionActive() {
  return currentExplosion !== null;
}

// Native area-damage request at 0x43EAB, before shield/energy accounting.
export function getExplosionDamage(cx, cy, radius, x, y, weaponIdx = 2) {
  const aspect = GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const scaleX = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const scaleY = aspect > 1 ? Math.trunc(65536 / aspect) : 65536;
  const squared = dx => {
    const ax = Math.trunc(Math.abs(dx) * 65536 / scaleX);
    const ay = Math.trunc(Math.abs(y - cy) * 65536 / scaleY);
    return ax * ax + ay * ay;
  };
  let distanceSquared = squared(x - cx);
  if (getEffectiveWallType() === WALL.WRAP)
    distanceSquared = Math.min(distanceSquared, squared(Math.abs(x - cx) - (config.screenWidth - 7)));
  const distance = Math.sqrt(distanceSquared);
  if (distance >= radius) return 0;
  const damage = Math.trunc((radius - distance) * 100 / radius) * (weaponIdx - 1);
  return damage > 100 ? 110 : damage;
}

export function applyExplosionDamage(cx, cy, radius, attackerIndex, weaponIdx = 2) {
  for (const player of players) {
    if (!player.alive) continue;
    let damage = getExplosionDamage(cx, cy, radius, player.x, player.y, weaponIdx);

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
