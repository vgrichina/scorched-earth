// Scorched Earth - Shield System
// EXE source: shields.cpp (seg 0x31D8, file base 0x38780)
// EXE: shield config table at DS:0x616C, 7 entries × 16 bytes
// EXE: flat 1:1 HP absorption model — shield absorbs damage point-for-point
// EXE: shield energy values: Shield=55, Warp/Teleport=100, Flicker=80, Force=150, Heavy=200
// EXE: special effects — Warp/Teleport shields trigger tank repositioning on hit
// EXE: Flicker shield has 50% chance of being "off" each hit
// EXE: Force/Heavy shields deflect projectiles

import { config } from './config.js';
import { setPixel } from './framebuffer.js';
import { random } from './utils.js';

// Shield type constants
export const SHIELD_TYPE = {
  NONE:     0,
  SHIELD:   1,
  WARP:     2,
  TELEPORT: 3,
  FORCE:    4,
  HEAVY:    5,
  FLICKER:  6,
};

// EXE: shield config table at DS:0x616C, 16 bytes per entry
// Fields: energy (max HP), radius (visual), r/g/b (VGA 6-bit), flags
export const SHIELD_CONFIG = [
  { name: 'None',            energy: 0,   radius: 0,  r: 0,  g: 0,  b: 0,  flags: 0 },
  { name: 'Shield',          energy: 55,  radius: 16, r: 63, g: 63, b: 23, flags: 2 },
  { name: 'Warp Shield',     energy: 100, radius: 15, r: 63, g: 63, b: 63, flags: 0 },
  { name: 'Teleport Shield', energy: 100, radius: 15, r: 63, g: 23, b: 63, flags: 1 },
  { name: 'Force Shield',    energy: 150, radius: 16, r: 63, g: 63, b: 63, flags: 0 },
  { name: 'Heavy Shield',    energy: 200, radius: 16, r: 63, g: 53, b: 33, flags: 4 },
  { name: 'Flicker Shield',  energy: 80,  radius: 14, r: 50, g: 50, b: 63, flags: 8 },
];

// Shield break animation state — exported for main.js to render
export const shieldBreak = { active: false, x: 0, y: 0, radius: 0, frame: 0, maxFrames: 50, playerIdx: 0 };

// Activate a shield on a player
export function activateShield(player, shieldType) {
  const cfg = SHIELD_CONFIG[shieldType];
  if (!cfg || shieldType === SHIELD_TYPE.NONE) {
    player.activeShield = SHIELD_TYPE.NONE;
    player.shieldEnergy = 0;
    return;
  }
  player.activeShield = shieldType;
  player.shieldEnergy = cfg.energy;
}

// Apply damage to shield, returns remaining damage that passes through
export function applyShieldDamage(player, damage) {
  if (player.activeShield === SHIELD_TYPE.NONE || player.shieldEnergy <= 0) {
    return damage;
  }

  // EXE: Flicker shield — 50% chance per hit of being "off" (full damage passes through)
  if (player.activeShield === SHIELD_TYPE.FLICKER) {
    if (random(2) === 0) {
      return damage;  // shield was "off" this hit
    }
  }

  // Flat 1:1 absorption (from RE)
  if (player.shieldEnergy >= damage) {
    player.shieldEnergy -= damage;
    return 0;  // fully absorbed
  } else {
    const remaining = damage - player.shieldEnergy;
    // EXE: trigger shield break animation when energy depleted
    const cfg = SHIELD_CONFIG[player.activeShield];
    if (cfg) {
      shieldBreak.active = true;
      shieldBreak.x = player.x;
      shieldBreak.y = player.y - 6;
      shieldBreak.radius = cfg.radius;
      shieldBreak.frame = 0;
      shieldBreak.playerIdx = player.index;
    }
    player.shieldEnergy = 0;
    player.activeShield = SHIELD_TYPE.NONE;
    return remaining;  // excess passes through
  }
}

// Check if Force/Heavy shield should deflect a projectile
// Returns true if projectile was deflected (caller should skip normal explosion)
export function checkShieldDeflection(player, proj) {
  if (!player || !player.alive) return false;
  if (player.activeShield !== SHIELD_TYPE.FORCE && player.activeShield !== SHIELD_TYPE.HEAVY) return false;
  if (player.shieldEnergy <= 0) return false;

  // Absorb partial damage to shield
  const shieldDmg = Math.min(10, player.shieldEnergy);
  player.shieldEnergy -= shieldDmg;
  if (player.shieldEnergy <= 0) {
    const cfg = SHIELD_CONFIG[player.activeShield];
    if (cfg) {
      shieldBreak.active = true;
      shieldBreak.x = player.x;
      shieldBreak.y = player.y - 6;
      shieldBreak.radius = cfg.radius;
      shieldBreak.frame = 0;
      shieldBreak.playerIdx = player.index;
    }
    player.activeShield = SHIELD_TYPE.NONE;
  }

  // Deflect: reverse and scatter projectile velocity
  proj.vx = -proj.vx * (0.6 + Math.random() * 0.4);
  proj.vy = -proj.vy * (0.6 + Math.random() * 0.4);
  proj.vx += (Math.random() - 0.5) * 100;
  proj.vy += (Math.random() - 0.5) * 50;
  // Move projectile away from shield
  proj.x += Math.sign(proj.vx) * 5;
  proj.y += Math.sign(proj.vy) * 5;

  return true;  // deflected
}

// Handle special shield effects on hit
export function handleShieldHit(player) {
  switch (player.activeShield) {
    case SHIELD_TYPE.WARP:
      // Teleport to random position
      warpTank(player);
      return true;
    case SHIELD_TYPE.TELEPORT:
      // Teleport when triggered
      warpTank(player);
      return true;
    default:
      return false;
  }
}

// Warp tank to random position on terrain
function warpTank(player) {
  const margin = 20;
  const newX = random(config.screenWidth - margin * 2) + margin;
  player.x = newX;
  // Will be adjusted to terrain in next redraw cycle
  player.falling = true;
  player.fallTargetY = player.y;
}

// Draw shield circle around a tank
export function drawShield(player) {
  if (player.activeShield === SHIELD_TYPE.NONE || player.shieldEnergy <= 0) return;

  const cfg = SHIELD_CONFIG[player.activeShield];
  if (!cfg) return;

  const cx = player.x;
  const cy = player.y - 6;  // center on tank body
  const radius = cfg.radius;

  // EXE: continuous color fade based on energy ratio
  const energyRatio = player.shieldEnergy / cfg.energy;
  const slot = Math.floor(energyRatio * 4) + 1;  // 1-5 color slots
  const color = player.index * 8 + slot;

  // Draw shield as circle outline
  for (let angle = 0; angle < 360; angle += 4) {
    // EXE: Flicker shield randomly skips pixels for visual flicker
    if (player.activeShield === SHIELD_TYPE.FLICKER && random(3) === 0) continue;

    const rad = angle * Math.PI / 180;
    const px = Math.round(cx + Math.cos(rad) * radius);
    const py = Math.round(cy + Math.sin(rad) * radius);
    if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
      setPixel(px, py, color);
    }
    // Inner ring for heavy shields
    if (cfg.flags === 4 && radius > 2) {
      const px2 = Math.round(cx + Math.cos(rad) * (radius - 1));
      const py2 = Math.round(cy + Math.sin(rad) * (radius - 1));
      if (px2 >= 0 && px2 < config.screenWidth && py2 >= 0 && py2 < config.screenHeight) {
        setPixel(px2, py2, player.index * 8 + Math.max(1, slot - 1));
      }
    }
  }
}

// Draw shield break animation — expanding/fading ring
export function drawShieldBreak() {
  if (!shieldBreak.active) return;

  const t = shieldBreak.frame / shieldBreak.maxFrames;
  const expandRadius = shieldBreak.radius + t * 20;
  const baseColor = shieldBreak.playerIdx * 8;

  // Final frame: white flash
  if (shieldBreak.frame === 0) {
    for (let angle = 0; angle < 360; angle += 3) {
      const rad = angle * Math.PI / 180;
      const px = Math.round(shieldBreak.x + Math.cos(rad) * shieldBreak.radius);
      const py = Math.round(shieldBreak.y + Math.sin(rad) * shieldBreak.radius);
      if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
        setPixel(px, py, 199);  // white
      }
    }
  } else {
    // Expanding fading ring
    const alpha = 1.0 - t;
    if (alpha > 0.1) {
      const slot = Math.max(1, Math.floor(alpha * 5));
      for (let angle = 0; angle < 360; angle += 5) {
        if (random(3) === 0) continue;  // sparse for fading effect
        const rad = angle * Math.PI / 180;
        const px = Math.round(shieldBreak.x + Math.cos(rad) * expandRadius);
        const py = Math.round(shieldBreak.y + Math.sin(rad) * expandRadius);
        if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
          setPixel(px, py, baseColor + slot);
        }
      }
    }
  }

  shieldBreak.frame++;
  if (shieldBreak.frame >= shieldBreak.maxFrames) {
    shieldBreak.active = false;
  }
}
