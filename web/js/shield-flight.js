// Native per-turn reserve (0x238E0) and projectile callback (0x23754).
import {config} from './config.js';

export function refreshShieldFlight(player) {
  player.shieldFlightUses = player.alive && player.shieldEnergy > 0 &&
    (player.activeShield === 1 || player.activeShield === 5) ? 1000 : 0;
}

export function applyShieldFlight(player, projectile) {
  if (!player.alive || !player.shieldEnergy || !(player.shieldFlightUses > 0) ||
      player.index === projectile.attackerIdx) return;
  const dx = Math.trunc(projectile.x - player.x);
  const dy = Math.trunc(player.y - projectile.y);
  if (dx < -15 || dx > 15 || dy <= 0 || dy > ((config.screenHeight - 1) >> 2)) return;
  player.shieldFlightUses--;
  // Native consumes a use even for a vertical shot, but only adds lift when
  // horizontal velocity is nonzero. This runs after integration/collisions.
  if (projectile.vx !== 0) {
    const delay = config.fireDelay ?? 100;
    projectile.vy += delay === 0 ? 50 : 50 / delay;
  }
}
