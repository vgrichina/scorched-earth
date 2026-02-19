// Scorched Earth - Shield System (shields.cpp RE)
// 6 shield types with flat 1:1 HP absorption
// Shield config from RE: DS:0x616C, 6 entries × 16 bytes

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
};

// Shield config table (from RE: DS:0x616C)
// energy: max HP, radius: visual size, color: VGA 6-bit RGB
export const SHIELD_CONFIG = [
  { name: 'None',            energy: 0,   radius: 0,  r: 0,  g: 0,  b: 0,  flags: 0 },
  { name: 'Shield',          energy: 55,  radius: 16, r: 63, g: 63, b: 23, flags: 2 },
  { name: 'Warp Shield',     energy: 100, radius: 15, r: 63, g: 63, b: 63, flags: 0 },
  { name: 'Teleport Shield', energy: 100, radius: 15, r: 63, g: 23, b: 63, flags: 1 },
  { name: 'Force Shield',    energy: 150, radius: 16, r: 63, g: 63, b: 63, flags: 0 },
  { name: 'Heavy Shield',    energy: 200, radius: 16, r: 63, g: 53, b: 33, flags: 4 },
];

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

  // Flat 1:1 absorption (from RE)
  if (player.shieldEnergy >= damage) {
    player.shieldEnergy -= damage;
    return 0;  // fully absorbed
  } else {
    const remaining = damage - player.shieldEnergy;
    player.shieldEnergy = 0;
    player.activeShield = SHIELD_TYPE.NONE;
    return remaining;  // excess passes through
  }
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

  // Shield color fades with energy (from RE: color * energy / maxEnergy)
  const energyRatio = player.shieldEnergy / cfg.energy;
  const baseColor = player.index * 8 + 5;  // white flash slot

  // Draw shield as circle outline
  for (let angle = 0; angle < 360; angle += 4) {
    const rad = angle * Math.PI / 180;
    const px = Math.round(cx + Math.cos(rad) * radius);
    const py = Math.round(cy + Math.sin(rad) * radius);
    if (px >= 0 && px < config.screenWidth && py >= 0 && py < config.screenHeight) {
      // Use player's bright color modulated by energy
      setPixel(px, py, energyRatio > 0.5 ? baseColor : player.index * 8 + 3);
    }
    // Inner ring for heavy shields
    if (cfg.flags === 4 && radius > 2) {
      const px2 = Math.round(cx + Math.cos(rad) * (radius - 1));
      const py2 = Math.round(cy + Math.sin(rad) * (radius - 1));
      if (px2 >= 0 && px2 < config.screenWidth && py2 >= 0 && py2 < config.screenHeight) {
        setPixel(px2, py2, player.index * 8 + 3);
      }
    }
  }
}
