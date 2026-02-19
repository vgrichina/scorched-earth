// Scorched Earth - Game State Machine (play.cpp RE)
// States: AIM → FLIGHT → EXPLOSION → NEXT_TURN
// Wind generation from RE: center-biased + random doubling

import { config } from './config.js';
import { random, clamp } from './utils.js';
import { players } from './tank.js';
import { launchProjectile, stepProjectile, getProjectilePos, projectile } from './physics.js';
import { getPixel } from './framebuffer.js';
import { createCrater, startExplosion, stepExplosion, isExplosionActive, applyExplosionDamage, getDefaultRadius } from './explosions.js';
import { isKeyDown, consumeKey } from './input.js';

// Game states
export const STATE = {
  AIM: 'aim',
  FLIGHT: 'flight',
  EXPLOSION: 'explosion',
  NEXT_TURN: 'next_turn',
  ROUND_OVER: 'round_over',
};

export const game = {
  state: STATE.AIM,
  currentPlayer: 0,
  wind: 0,
  round: 1,
  turnCount: 0,
  nextTurnTimer: 0,
};

// Wind generation (from RE: center-biased with random doubling)
export function generateWind() {
  const maxWind = config.wind;
  if (maxWind === 0) { game.wind = 0; return; }
  let wind = random(Math.floor(maxWind / 2) + 1) - Math.floor(maxWind / 4);
  if (random(100) < 20) wind *= 2;
  if (random(100) < 40) wind *= 2;
  game.wind = clamp(wind, -maxWind * 4, maxWind * 4);
}

// Wind change per turn (from RE)
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

// Input handling during AIM state
const ANGLE_SPEED = 1;          // degrees per frame when held
const POWER_SPEED = 5;          // power units per frame when held
let inputRepeatTimer = 0;

function handleAimInput(player) {
  // Angle: left/right arrows
  if (isKeyDown('ArrowLeft')) {
    player.angle = clamp(player.angle + ANGLE_SPEED, 0, 180);
  }
  if (isKeyDown('ArrowRight')) {
    player.angle = clamp(player.angle - ANGLE_SPEED, 0, 180);
  }
  // Power: up/down arrows
  if (isKeyDown('ArrowUp')) {
    player.power = clamp(player.power + POWER_SPEED, 0, 1000);
  }
  if (isKeyDown('ArrowDown')) {
    player.power = clamp(player.power - POWER_SPEED, 0, 1000);
  }

  // Fire: space bar
  if (consumeKey('Space')) {
    return true;  // fire!
  }
  return false;
}

// Fire the weapon
function fireWeapon(player) {
  // Barrel tip position (match tank.js dome geometry)
  const barrelLength = 12;
  const domeTopY = player.y - 4 - 4;  // body(4) + dome peak(4)
  const angleRad = player.angle * Math.PI / 180;
  const startX = player.x + Math.cos(angleRad) * barrelLength;
  const startY = domeTopY - Math.sin(angleRad) * barrelLength;

  launchProjectile(startX, startY, player.angle, player.power);
  game.state = STATE.FLIGHT;
}

// Main game tick (called every frame)
export function gameTick() {
  switch (game.state) {
    case STATE.AIM: {
      const player = getCurrentPlayer();
      if (!player.alive) {
        // Skip dead players
        game.state = STATE.NEXT_TURN;
        break;
      }
      if (handleAimInput(player)) {
        fireWeapon(player);
      }
      break;
    }

    case STATE.FLIGHT: {
      // Run multiple physics steps per frame for speed
      const stepsPerFrame = 3;
      for (let i = 0; i < stepsPerFrame; i++) {
        const result = stepProjectile(getPixel, game.wind);

        if (result === 'hit_terrain' || result === 'hit_tank') {
          const pos = getProjectilePos();
          const radius = getDefaultRadius();

          // Apply damage before crater (so positions are still valid)
          applyExplosionDamage(pos.x, pos.y, radius, game.currentPlayer);

          // Create crater
          createCrater(pos.x, pos.y, radius);

          // Start explosion animation
          startExplosion(pos.x, pos.y, radius, game.currentPlayer);
          game.state = STATE.EXPLOSION;
          break;
        }
        if (result === 'offscreen') {
          game.state = STATE.NEXT_TURN;
          break;
        }
      }
      break;
    }

    case STATE.EXPLOSION: {
      if (!stepExplosion()) {
        // Explosion finished
        if (checkRoundOver()) {
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
          game.state = STATE.ROUND_OVER;
        }
      }
      break;
    }

    case STATE.ROUND_OVER: {
      // Press space to start new round
      if (consumeKey('Space')) {
        // For now just stay here — Phase 3 will add multi-round flow
      }
      break;
    }
  }
}
