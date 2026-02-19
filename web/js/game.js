// Scorched Earth - Game State Machine
// EXE source: play.cpp (seg 0x28B9, file base 0x2F830)
// EXE: main game loop dispatch at file 0x2F78A
// States: AIM → FLIGHT → EXPLOSION → FALLING → NEXT_TURN → ROUND_OVER → SHOP → ROUND_SETUP → GAME_OVER
// EXE: weapon dispatch via extras.cpp behaviors + fire_weapon at file 0x30652
// EXE: play modes — Sequential (0), Simultaneous (1), Synchronous (2) at DS config

import { config } from './config.js';
import { random, clamp } from './utils.js';
import { players, checkTanksFalling, stepFallingTanks, placeTanks, resetAndPlaceTanks } from './tank.js';
import { launchProjectile, stepSingleProjectile, projectiles, spawnProjectiles,
         clearProjectiles, hasActiveProjectiles } from './physics.js';
import { getPixel } from './framebuffer.js';
import { createCrater, startExplosion, stepExplosion, isExplosionActive,
         applyExplosionDamage, addDirt, addDirtTower, createTunnel,
         applyDisrupter } from './explosions.js';
import { isKeyDown, consumeKey } from './input.js';
import { WEAPONS, BHV, WPN, cycleWeapon } from './weapons.js';
import { handleBehavior, handleFlightBehavior, napalmParticleStep, applyGuidance } from './behaviors.js';
import { isAI, startAITurn, stepAITurn, setAIWind } from './ai.js';
import { endOfRoundScoring, applyInterest, scoreOnDeath } from './score.js';
import { openShop, closeShop, isShopActive, shopTick, drawShop } from './shop.js';
import { generateTerrain } from './terrain.js';

// War quotes — EXE: 15 strings extracted from binary (see disasm/war_quotes.txt)
const WAR_QUOTES = [
  '"War is hell." - W.T. Sherman',
  '"The quickest way to end a war is to lose it." - George Orwell',
  '"In war there is no substitute for victory." - MacArthur',
  '"Only the dead have seen the end of war." - Plato',
  '"War does not determine who is right, only who is left."',
  '"The art of war is of vital importance to the state." - Sun Tzu',
  '"Know thy enemy." - Sun Tzu',
  '"War is a continuation of politics." - Clausewitz',
  '"All warfare is based on deception." - Sun Tzu',
  '"To secure peace is to prepare for war." - Carl von Clausewitz',
  '"War is the unfolding of miscalculations." - Barbara Tuchman',
  '"Fortune favors the bold." - Virgil',
  '"A good plan executed now beats a perfect plan next week."',
  '"Victorious warriors win first and then go to war." - Sun Tzu',
  '"The supreme art of war is to subdue without fighting." - Sun Tzu',
];

// Game states
export const STATE = {
  TITLE: 'title',
  CONFIG: 'config',
  PLAYER_SETUP: 'player_setup',
  AIM: 'aim',
  FLIGHT: 'flight',
  EXPLOSION: 'explosion',
  FALLING: 'falling',
  NEXT_TURN: 'next_turn',
  ROUND_OVER: 'round_over',
  SHOP: 'shop',
  ROUND_SETUP: 'round_setup',
  GAME_OVER: 'game_over',
};

export const game = {
  state: STATE.TITLE,
  currentPlayer: 0,
  wind: 0,
  round: 1,
  turnCount: 0,
  nextTurnTimer: 0,
  aiActive: false,
  shopPlayerIdx: 0,
  warQuote: '',
  roundOverTimer: 0,
};

// EXE: wind generation — center-biased with random doubling
// EXE: 20% chance double, 40% chance double again (from disasm/physics_timestep_wind_analysis.txt)
export function generateWind() {
  const maxWind = config.wind;
  if (maxWind === 0) { game.wind = 0; return; }
  let wind = random(Math.floor(maxWind / 2) + 1) - Math.floor(maxWind / 4);
  if (random(100) < 20) wind *= 2;
  if (random(100) < 40) wind *= 2;
  game.wind = clamp(wind, -maxWind * 4, maxWind * 4);
}

// EXE: wind random walk per turn — delta in [-5, +5], clamped to ±wind*4
function updateWind() {
  if (!config.changeWind) return;
  const delta = random(11) - 5;  // [-5, +5]
  game.wind = clamp(game.wind + delta, -config.wind * 4, config.wind * 4);
}

// Get the current active player
export function getCurrentPlayer() {
  return players[game.currentPlayer];
}

// Advance to next living player
function advancePlayer() {
  const numPlayers = players.length;
  let next = (game.currentPlayer + 1) % numPlayers;
  let checked = 0;
  while (checked < numPlayers) {
    if (players[next].alive) {
      game.currentPlayer = next;
      return true;
    }
    next = (next + 1) % numPlayers;
    checked++;
  }
  return false;  // no living players
}

// Check if the round is over (1 or 0 players alive)
function checkRoundOver() {
  const alive = players.filter(p => p.alive);
  return alive.length <= 1;
}

// Start a new round
function startNewRound() {
  game.round++;
  game.turnCount = 0;
  game.currentPlayer = 0;

  // Regenerate terrain and place tanks
  generateTerrain();
  generateWind();

  // Reuse existing players (preserves score/cash/wins/inventory/aiType/name)
  resetAndPlaceTanks();
  game.state = STATE.AIM;
}

// Input handling during AIM state
function handleAimInput(player) {
  // Angle: left/right arrows
  if (isKeyDown('ArrowLeft')) {
    player.angle = clamp(player.angle + 1, 0, 180);
  }
  if (isKeyDown('ArrowRight')) {
    player.angle = clamp(player.angle - 1, 0, 180);
  }
  // Power: up/down arrows
  if (isKeyDown('ArrowUp')) {
    player.power = clamp(player.power + 5, 0, 1000);
  }
  if (isKeyDown('ArrowDown')) {
    player.power = clamp(player.power - 5, 0, 1000);
  }

  // Weapon cycling: Tab = next, Shift+Tab = previous
  if (consumeKey('Tab')) {
    const dir = isKeyDown('ShiftLeft') || isKeyDown('ShiftRight') ? -1 : 1;
    player.selectedWeapon = cycleWeapon(player.inventory, player.selectedWeapon, dir);
  }

  // Fire: space bar
  if (consumeKey('Space')) {
    return true;  // fire!
  }
  return false;
}

// Fire the weapon
// EXE: fire_weapon at file 0x30652 — computes barrel tip from icons.cpp geometry
// EXE: decrements ammo in player struct, switches to Baby Missile if depleted
//
// BUG: EXE differs — two missing interactions in this JS implementation:
//   1. Super Mag per-shot decrement (EXE 0x306A8): if sub+0x2A != 0 (Super Mag active),
//      decrements inventory[DS:D566] (Super Mag ammo). Deactivates when depleted.
//      JS does not track or decrement Super Mag ammo per shot.
//   2. Shield consume on fire (EXE 0x30668): calls shield_consume (0x1144:0x361) before
//      launching if active_shield != 0 and play_mode <= 1 (Sequential/Simultaneous).
//      JS has no equivalent per-fire shield interaction.
function fireWeapon(player) {
  // EXE: barrel tip = dome center + BARREL_LENGTH (12) in angle direction (icons.cpp)
  const barrelLength = 12;
  const domeTopY = player.y - 4 - 4;  // body(4) + dome peak(4)
  const angleRad = player.angle * Math.PI / 180;
  const startX = player.x + Math.cos(angleRad) * barrelLength;
  const startY = domeTopY - Math.sin(angleRad) * barrelLength;

  const weaponIdx = player.selectedWeapon;

  // EXE VERIFIED: ammo decrement at fire_weapon 0x30683; fallback to Baby Missile
  // at 0x3078E when depleted. Matches this JS implementation.
  // Decrement ammo (unless infinite = -1)
  if (player.inventory[weaponIdx] > 0) {
    player.inventory[weaponIdx]--;
    // If ammo depleted, switch to Baby Missile
    if (player.inventory[weaponIdx] === 0) {
      player.selectedWeapon = WPN.BABY_MISSILE;
    }
  }

  clearProjectiles();
  launchProjectile(startX, startY, player.angle, player.power, weaponIdx, player.index);
  game.state = STATE.FLIGHT;
}

// Process a projectile hit
function processHit(proj, hitResult) {
  const result = handleBehavior(proj, hitResult);
  const cx = Math.round(proj.x);
  const cy = Math.round(proj.y);

  // Spawn sub-projectiles
  if (result.spawn && result.spawn.length > 0) {
    spawnProjectiles(result.spawn);
  }

  if (result.tunnel) {
    createTunnel(cx, cy, result.radius, result.tunnelDown);
  } else if (result.disrupt) {
    applyDisrupter(cx, cy, result.radius);
  } else if (result.dirtAdd) {
    if (result.dirtTower) {
      addDirtTower(cx, cy, result.dirtRadius || 30);
    } else {
      addDirt(cx, cy, result.radius);
    }
  } else if (result.explode && result.radius > 0) {
    // Apply damage before crater
    if (!result.skipDamage) {
      // Track deaths for scoring
      const beforeAlive = players.filter(p => p.alive).map(p => p.index);
      applyExplosionDamage(cx, cy, result.radius, proj.attackerIdx, proj.vx, proj.vy);
      const afterAlive = players.filter(p => p.alive).map(p => p.index);

      // Score deaths
      const attacker = players[proj.attackerIdx];
      for (const idx of beforeAlive) {
        if (!afterAlive.includes(idx)) {
          scoreOnDeath(attacker, players[idx]);
        }
      }
    }
    createCrater(cx, cy, result.radius);
    startExplosion(cx, cy, result.radius, proj.attackerIdx);
  }

  // Remove projectile unless behavior says to keep it alive
  if (!result.keepAlive) {
    proj.active = false;
  }
}

// Main game tick (called every frame)
export function gameTick() {
  switch (game.state) {
    case STATE.AIM: {
      const player = getCurrentPlayer();
      if (!player.alive) {
        game.state = STATE.NEXT_TURN;
        break;
      }

      if (isAI(player)) {
        // AI player
        if (!game.aiActive) {
          setAIWind(game.wind);
          startAITurn(player);
          game.aiActive = true;
        }
        const aiResult = stepAITurn(player);
        if (aiResult === 'fire') {
          game.aiActive = false;
          fireWeapon(player);
        }
      } else {
        // Human player
        if (handleAimInput(player)) {
          fireWeapon(player);
        }
      }
      break;
    }

    case STATE.FLIGHT: {
      // Run multiple physics steps per frame for speed
      const stepsPerFrame = 3;

      for (let step = 0; step < stepsPerFrame; step++) {
        let anyActive = false;

        // Step all projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
          const proj = projectiles[i];
          if (!proj.active) continue;

          // Napalm particle special handling
          if (proj.isNapalmParticle) {
            const napResult = napalmParticleStep(proj);
            if (napResult.remove) {
              if (napResult.burnRadius) {
                const cx = Math.round(proj.x);
                const cy = Math.round(proj.y);
                applyExplosionDamage(cx, cy, napResult.burnRadius, proj.attackerIdx);
                createCrater(cx, cy, napResult.burnRadius);
              }
              if (napResult.addDirt) {
                addDirt(Math.round(proj.x), Math.round(proj.y), 3);
              }
              proj.active = false;
              continue;
            }
          }

          // In-flight behavior check (MIRV apogee, roller terrain-follow)
          const flightResult = handleFlightBehavior(proj);
          if (flightResult.split) {
            if (flightResult.spawn.length > 0) {
              spawnProjectiles(flightResult.spawn);
            }
            if (flightResult.explodeHere) {
              const radius = flightResult.radius || 10;
              const cx = Math.round(proj.x);
              const cy = Math.round(proj.y);
              applyExplosionDamage(cx, cy, radius, proj.attackerIdx);
              createCrater(cx, cy, radius);
              startExplosion(cx, cy, radius, proj.attackerIdx);
            }
            if (flightResult.remove) {
              proj.active = false;
              continue;
            }
          }

          // Apply guidance corrections before physics step
          applyGuidance(proj);

          // Physics step
          const result = stepSingleProjectile(proj, getPixel, game.wind);

          if (result === 'hit_terrain' || result === 'hit_tank' || result === 'hit_wall') {
            processHit(proj, result);
          } else if (result === 'offscreen') {
            proj.active = false;
          }

          if (proj.active) anyActive = true;
        }

        // Clean up inactive projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
          if (!projectiles[i].active) projectiles.splice(i, 1);
        }

        if (!anyActive) {
          // No more projectiles — transition to explosion state
          // (stepExplosion will animate any active explosions before checking aftermath)
          game.state = STATE.EXPLOSION;
          break;
        }
      }

      // If we still have active projectiles but finished steps, stay in FLIGHT
      if (hasActiveProjectiles()) {
        game.state = STATE.FLIGHT;
      }
      break;
    }

    case STATE.EXPLOSION: {
      if (stepExplosion()) {
        // Explosion still animating
        break;
      }
      // All explosions done — check for falling tanks
      if (checkTanksFalling()) {
        game.state = STATE.FALLING;
      } else if (checkRoundOver()) {
        endOfRoundScoring(game.round);
        game.warQuote = WAR_QUOTES[random(WAR_QUOTES.length)];
        game.roundOverTimer = 0;
        game.state = STATE.ROUND_OVER;
      } else {
        game.state = STATE.NEXT_TURN;
      }
      break;
    }

    case STATE.FALLING: {
      if (!stepFallingTanks()) {
        // All tanks settled
        if (checkRoundOver()) {
          endOfRoundScoring(game.round);
          game.warQuote = WAR_QUOTES[random(WAR_QUOTES.length)];
          game.roundOverTimer = 0;
          game.state = STATE.ROUND_OVER;
        } else {
          game.state = STATE.NEXT_TURN;
        }
      }
      break;
    }

    case STATE.NEXT_TURN: {
      game.nextTurnTimer++;
      if (game.nextTurnTimer > 15) {  // brief pause between turns
        game.nextTurnTimer = 0;
        updateWind();
        game.turnCount++;
        if (advancePlayer()) {
          game.state = STATE.AIM;
        } else {
          endOfRoundScoring(game.round);
          game.warQuote = WAR_QUOTES[random(WAR_QUOTES.length)];
          game.roundOverTimer = 0;
          game.state = STATE.ROUND_OVER;
        }
      }
      break;
    }

    case STATE.ROUND_OVER: {
      game.roundOverTimer++;
      // Press space to continue (after brief delay)
      if (game.roundOverTimer > 30 && consumeKey('Space')) {
        if (game.round >= config.rounds) {
          game.state = STATE.GAME_OVER;
        } else {
          // Go to shop
          game.shopPlayerIdx = 0;
          applyInterest();
          openShop(0);
          game.state = STATE.SHOP;
        }
      }
      break;
    }

    case STATE.SHOP: {
      const shopPlayer = players[game.shopPlayerIdx];
      if (shopTick(shopPlayer)) {
        // This player's shopping is done, move to next
        game.shopPlayerIdx++;
        if (game.shopPlayerIdx >= players.length) {
          // All players done shopping
          closeShop();
          game.state = STATE.ROUND_SETUP;
        } else {
          openShop(game.shopPlayerIdx);
        }
      }
      break;
    }

    case STATE.ROUND_SETUP: {
      startNewRound();
      break;
    }

    case STATE.GAME_OVER: {
      // Press space to go back to title screen
      if (consumeKey('Space')) {
        game.state = STATE.TITLE;
      }
      break;
    }
  }
}
