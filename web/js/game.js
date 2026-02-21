// Scorched Earth - Game State Machine
// EXE source: play.cpp (seg 0x28B9, file base 0x2F830)
// EXE: main game loop dispatch at file 0x2F78A
// States: AIM → FLIGHT → EXPLOSION → FALLING → NEXT_TURN → ROUND_OVER → SHOP → ROUND_SETUP → GAME_OVER
// EXE: weapon dispatch via extras.cpp behaviors + fire_weapon at file 0x30652
// EXE: play modes — Sequential (0), Simultaneous (1), Synchronous (2) at DS config

import { config } from './config.js';
import { random, clamp } from './utils.js';
import { PLAYER_COLOR_MAX, PLAYER_PALETTE_STRIDE } from './constants.js';
import { players, checkTanksFalling, stepFallingTanks, placeTanks, resetAndPlaceTanks, startDeathAnimation, stepDeathAnimations } from './tank.js';
import { getTerrainY } from './terrain.js';
import { launchProjectile, stepSingleProjectile, projectiles, spawnProjectiles,
         clearProjectiles, hasActiveProjectiles, applyMagDamping,
         WALL, setResolvedWallType } from './physics.js';
import { getPixel } from './framebuffer.js';
import { createCrater, startExplosion, stepExplosion, isExplosionActive,
         applyExplosionDamage, addDirt, addDirtTower, createTunnel,
         applyDisrupter } from './explosions.js';
import { isKeyDown, consumeKey, consumeClick, getMouseDelta, mouse } from './input.js';
import { WEAPONS, BHV, WPN, cycleWeapon } from './weapons.js';
import { handleBehavior, handleFlightBehavior, napalmParticleStep, applyGuidance, selectGuidanceType } from './behaviors.js';
import { isAI, startAITurn, stepAITurn, setAIWind } from './ai.js';
import { endOfRoundScoring, applyInterest, scoreOnDeath } from './score.js';
import { checkShieldDeflection } from './shields.js';
import { playFireSound, playExplosionSound, playFlightSound, playLightningSound, playDeathSound, initSound, toggleSound } from './sound.js';
import { triggerAttackSpeech, triggerDeathSpeech, stepSpeechBubble } from './talk.js';
import { openShop, closeShop, isShopActive, shopTick, drawShop } from './shop.js';
import { generateTerrain } from './terrain.js';
import { resetMenuState } from './menu.js';

// War quotes — EXE: 15 strings extracted from binary at 0x05B580-0x05BC5E
// See disasm/war_quotes.txt for full extraction with offsets
// Note: preserves original typos ("throughly", "Macchiavelli", "Jonathon")
const WAR_QUOTES = [
  '"There\'s many a boy here today who looks on war as all glory, but, boys, it is all hell." - Gen. William T. Sherman',
  '"The essence of war is violence. Moderation in war is imbecility." - Fisher',
  '"War is the science of destruction." - John Abbott',
  '"Providence is always on the side of the big battalions." - Sevigne',
  '"War is a matter of vital importance to the State; the province of life or death; the road to survival or ruin. It is mandatory that it be throughly studied." - Sun Tzu',
  '"War should be the only study of a prince. He should consider peace only as a breathing-time, which gives him leisure to contrive, and furnishes as ability to execute, military plans." - Macchiavelli',
  '"Not with dreams but with blood and iron, Shall a nation be moulded at last." - Swinburne',
  '"No one can guarantee success in war, but only deserve it." - Winston Churchill',
  '"The grim fact is that we prepare for war like precocious giants and for peace like retarded pygmies." - Lester Pearson',
  '"We cannot live by power, and a culture that seeks to live by it becomes brutal and sterile. But we can die without it." - Max Lerner',
  '"No man is wise enough, nor good enough to be trusted with unlimited power." - Charles Colton',
  '"Nothing good ever comes of violence." - Martin Luther',
  '"Give me the money that has been spent in war, and ... I will clothe every man, woman and child in attire of which kings and queens would be proud." - Henry Richard',
  '"That mad game the world so loves to play." - Jonathon Swift',
  '"Nearly all men can stand adversity, but if you want to test a man\'s character, give him power." - Abraham Lincoln',
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
  SYNC_AIM: 'sync_aim',       // EXE: synchronous mode — sequential aim collection
  SYNC_FIRE: 'sync_fire',     // EXE: synchronous mode — batch launch
  SCREEN_HIDE: 'screen_hide', // EXE: "No Kibitzing" screen between human turns
  SYSTEM_MENU: 'system_menu', // EXE: F9 system menu
};

export const game = {
  state: STATE.CONFIG,
  currentPlayer: 0,
  wind: 0,
  round: 1,
  turnCount: 0,
  nextTurnTimer: 0,
  aiActive: false,
  shopPlayerIdx: 0,
  warQuote: '',
  roundOverTimer: 0,
  // Play order system
  turnOrder: [],
  turnOrderIdx: 0,
  // Sync play mode
  aimQueue: [],        // stored aims for sync mode
  syncPlayerIdx: 0,    // which player is aiming in sync mode
  // Hostile environment
  hostileLightningX: 0,
  hostileLightningFrames: 0,
  // No Kibitzing
  screenHideTarget: -1,
  // System menu
  systemMenuOption: 0,
  // Guided missile steering
  guidedActive: false,
  // Simultaneous mode timer
  aimTimer: 0,
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

// Resolve Erratic/Random wall types to a concrete wall type
// EXE: Erratic changes each turn, Random changes each round
function resolveRandomWallType() {
  // Pick from the non-meta types: NONE(0), WRAP(3), PADDED(4), RUBBER(5), SPRING(6), CONCRETE(7)
  const concreteTypes = [WALL.NONE, WALL.WRAP, WALL.PADDED, WALL.RUBBER, WALL.SPRING, WALL.CONCRETE];
  setResolvedWallType(concreteTypes[random(concreteTypes.length)]);
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

// EXE: compute turn order based on playOrder config
// 0=Sequential (round-robin), 1=Random (Fisher-Yates), 2=Losers-First, 3=Winners-First
function computeTurnOrder() {
  const alive = players.filter(p => p.alive).map(p => p.index);
  switch (config.playOrder) {
    case 1: {
      // Fisher-Yates shuffle
      for (let i = alive.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [alive[i], alive[j]] = [alive[j], alive[i]];
      }
      break;
    }
    case 2:
      // Losers first: sort by score ascending
      alive.sort((a, b) => players[a].score - players[b].score);
      break;
    case 3:
      // Winners first: sort by score descending
      alive.sort((a, b) => players[b].score - players[a].score);
      break;
    default:
      // Sequential: already in index order
      break;
  }
  game.turnOrder = alive;
  game.turnOrderIdx = 0;
}

// Advance to next living player using turn order
function advancePlayer() {
  // If using turn order system
  if (game.turnOrder.length > 0) {
    game.turnOrderIdx++;
    while (game.turnOrderIdx < game.turnOrder.length) {
      const idx = game.turnOrder[game.turnOrderIdx];
      if (players[idx].alive) {
        game.currentPlayer = idx;
        return true;
      }
      game.turnOrderIdx++;
    }
    // Wrapped around — recompute order for next cycle
    computeTurnOrder();
    while (game.turnOrderIdx < game.turnOrder.length) {
      const idx = game.turnOrder[game.turnOrderIdx];
      if (players[idx].alive) {
        game.currentPlayer = idx;
        return true;
      }
      game.turnOrderIdx++;
    }
    return false;
  }

  // Fallback: sequential round-robin
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

// Called by main.js startGame to set up first round state (turn order, sync mode, wall type)
export function initGameRound() {
  computeTurnOrder();
  if (game.turnOrder.length > 0) {
    game.currentPlayer = game.turnOrder[0];
  }

  // Resolve wall types for first round
  if (config.wallType === WALL.RANDOM || config.wallType === WALL.ERRATIC) {
    resolveRandomWallType();
  }

  if (config.playMode >= 1) {
    // Both Simultaneous (1) and Synchronous (2) use SYNC_AIM/SYNC_FIRE
    game.aimQueue = [];
    game.syncPlayerIdx = 0;
    game.aimTimer = config.playMode === 1 ? 600 : 0;  // 10s timer for simultaneous
    game.state = STATE.SYNC_AIM;
  } else {
    game.state = STATE.AIM;
  }
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

  // EXE: Random wall type resolves once per round
  if (config.wallType === WALL.RANDOM) resolveRandomWallType();

  // Regenerate terrain and place tanks
  generateTerrain();
  generateWind();

  // Reuse existing players (preserves score/cash/wins/inventory/aiType/name)
  resetAndPlaceTanks();
  computeTurnOrder();
  if (game.turnOrder.length > 0) {
    game.currentPlayer = game.turnOrder[0];
  }

  // EXE: synchronous/simultaneous play mode — all players aim then all fire at once
  if (config.playMode >= 1) {
    game.aimQueue = [];
    game.syncPlayerIdx = 0;
    game.aimTimer = config.playMode === 1 ? 600 : 0;
    game.state = STATE.SYNC_AIM;
  } else {
    game.state = STATE.AIM;
  }
}

// EXE: MOUSE_RATE (DS:0x6BF8) = 0.50 default — scales mouse delta to angle/power
const MOUSE_RATE = 0.50;

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

  // Mouse aiming: horizontal delta → angle, vertical delta → power
  // EXE: mouse delta scaled by MOUSE_RATE, horizontal=angle, vertical=power
  const { dx, dy } = getMouseDelta();
  if (dx !== 0 || dy !== 0) {
    // Horizontal: right = decrease angle (aim right), left = increase (aim left)
    player.angle = clamp(player.angle - dx * MOUSE_RATE, 0, 180);
    // Vertical: up (negative dy) = increase power, down = decrease
    player.power = clamp(Math.round(player.power - dy * MOUSE_RATE * 10), 0, 1000);
  }

  // Weapon cycling: Tab = next, Shift+Tab = previous
  if (consumeKey('Tab')) {
    const dir = isKeyDown('ShiftLeft') || isKeyDown('ShiftRight') ? -1 : 1;
    player.selectedWeapon = cycleWeapon(player.inventory, player.selectedWeapon, dir);
  }

  // EXE: Tank movement with Fuel Tank (idx 55) — A/D keys move tank along terrain
  const FUEL_TANK_IDX = 55;
  if (player.inventory[FUEL_TANK_IDX] > 0) {
    if (isKeyDown('KeyA')) {
      const newX = clamp(player.x - 1, 5, config.screenWidth - 5);
      if (newX !== player.x) {
        player.x = newX;
        player.y = getTerrainY(player.x);
        player.inventory[FUEL_TANK_IDX]--;
      }
    }
    if (isKeyDown('KeyD')) {
      const newX = clamp(player.x + 1, 5, config.screenWidth - 5);
      if (newX !== player.x) {
        player.x = newX;
        player.y = getTerrainY(player.x);
        player.inventory[FUEL_TANK_IDX]--;
      }
    }
  }

  // Fire: space bar or left click
  if (consumeKey('Space') || consumeClick(0)) {
    return true;  // fire!
  }
  return false;
}

// Fire the weapon
// EXE: fire_weapon at file 0x30652 — computes barrel tip from icons.cpp geometry
// EXE: decrements ammo in player struct, switches to Baby Missile if depleted
//
// EXE 0x30668: calls pre-fire handler (0x1144:0x361) before launching if
// active_shield != 0 and play_mode <= 1 (Sequential/Simultaneous).
// Binary analysis: this function is the TALKING TANK speech handler (comments.cpp),
// NOT shield energy consumption. It loads a string from DS:0xCC8E and calls
// Fastgraph text display (0x3F19:0x4695). See Task 5: Talking Tanks.
function fireWeapon(player) {
  // EXE: barrel tip = dome center + BARREL_LENGTH (12) in angle direction (icons.cpp)
  const barrelLength = 12;
  const domeTopY = player.y - 4 - 4;  // body(4) + dome peak(4)
  const angleRad = player.angle * Math.PI / 180;
  const startX = player.x + Math.cos(angleRad) * barrelLength;
  const startY = domeTopY - Math.sin(angleRad) * barrelLength;

  let weaponIdx = player.selectedWeapon;

  // EXE: fire_weapon 0x3070C — Bal Guidance (DS:D54C, idx 38) replaced with
  // Earth Disrupter (DS:D548, idx 34). Bal Guidance is intentionally non-fireable.
  if (weaponIdx === 38) weaponIdx = WPN.EARTH_DISRUPTER;

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

  // EXE VERIFIED: fire_weapon 0x306A8 — Super Mag (idx 52) ammo decremented per shot.
  // EXE: DS:0x1C76 flag set on projectile — bypasses enemy Mag Deflector damping.
  // EXE: Mag Deflector (idx 45) is NOT decremented at fire time (passive defense).
  const SUPER_MAG_IDX = 52;
  let superMagActive = false;
  if (player.inventory[SUPER_MAG_IDX] > 0) {
    player.inventory[SUPER_MAG_IDX]--;
    superMagActive = true;
  }

  // EXE: guidance_type set on projectile at fire time, ammo consumed
  const guidanceType = selectGuidanceType(player);

  clearProjectiles();
  playFireSound();
  triggerAttackSpeech(player);
  launchProjectile(startX, startY, player.angle, player.power, weaponIdx, player.index);

  // Set guidance type on the newly launched projectile
  if (guidanceType && projectiles.length > 0) {
    projectiles[projectiles.length - 1].guidanceType = guidanceType;
  }

  // EXE: DS:0x1C76 pushed to launchProjectile at extras.cpp 0x21357
  if (superMagActive && projectiles.length > 0) {
    projectiles[projectiles.length - 1].superMagActive = true;
  }

  game.state = STATE.FLIGHT;
}

// Find which player was hit based on projectile position pixel color
function findHitPlayer(proj) {
  const px = Math.round(proj.x);
  const py = Math.round(proj.y);
  const pixel = getPixel(px, py);
  if (pixel > 0 && pixel < PLAYER_COLOR_MAX) {
    const playerIdx = Math.floor(pixel / PLAYER_PALETTE_STRIDE);
    return players[playerIdx] || null;
  }
  return null;
}

// Process a projectile hit
function processHit(proj, hitResult) {
  // EXE 0x2251A: Mag Deflector collision damping
  // If target player has Mag Deflector and attacker has no Super Mag, dampen velocity
  if (hitResult === 'hit_tank') {
    const targetPlayer = findHitPlayer(proj);
    if (targetPlayer) {
      const magCount = (targetPlayer.inventory[45] || 0) + (targetPlayer.inventory[52] || 0);
      if (magCount > 0) {
        const absorbed = applyMagDamping(proj);
        if (absorbed) return;  // projectile absorbed, no damage
      }
    }
  }

  // EXE: Force/Heavy shield deflection — reverse and scatter projectile
  if (hitResult === 'hit_tank') {
    const targetPlayer = findHitPlayer(proj);
    if (targetPlayer && checkShieldDeflection(targetPlayer, proj)) {
      return;  // projectile deflected, no explosion
    }
  }

  const result = handleBehavior(proj, hitResult);

  // EXE: explosion scale config — 0=Small(0.5x), 1=Medium(1x), 2=Large(1.5x)
  if (result.radius > 0) {
    const scale = [0.5, 1.0, 1.5][config.explosionScale] || 1.0;
    result.radius = Math.floor(result.radius * scale);
  }

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

      // Score deaths and trigger death speech + death animation
      const attacker = players[proj.attackerIdx];
      for (const idx of beforeAlive) {
        if (!afterAlive.includes(idx)) {
          scoreOnDeath(attacker, players[idx]);
          triggerDeathSpeech(players[idx]);
          startDeathAnimation(players[idx]);
          playDeathSound();
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
  stepDeathAnimations();
  switch (game.state) {
    case STATE.AIM: {
      stepSpeechBubble();
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
        // EXE: F9 opens system menu during aim phase
        if (consumeKey('F9')) {
          game.systemMenuOption = 0;
          game.state = STATE.SYSTEM_MENU;
          break;
        }
        // EXE: Enter = SURRENDER — player forfeits, treated as self-kill
        if (consumeKey('Enter')) {
          player.alive = false;
          player.energy = 0;
          scoreOnDeath(player, player);
          triggerDeathSpeech(player);
          startDeathAnimation(player);
          playDeathSound();
          game.state = STATE.NEXT_TURN;
          break;
        }
        // Human player
        if (handleAimInput(player)) {
          fireWeapon(player);
        }
      }
      break;
    }

    case STATE.FLIGHT: {
      stepSpeechBubble();

      // Guided missile keyboard/mouse steering — human players only
      game.guidedActive = false;
      const gd = getMouseDelta(); // always consume delta to prevent buildup
      const firingPlayer = players[game.currentPlayer];
      if (firingPlayer && !isAI(firingPlayer)) {
        for (const proj of projectiles) {
          if (proj.active && proj.attackerIdx === game.currentPlayer && proj.guidanceCorrX !== undefined) {
            game.guidedActive = true;
            // Arrow keys adjust correction direction
            if (isKeyDown('ArrowLeft'))  proj.guidanceCorrX -= 0.3;
            if (isKeyDown('ArrowRight')) proj.guidanceCorrX += 0.3;
            if (isKeyDown('ArrowUp'))    proj.guidanceCorrY += 0.3;
            if (isKeyDown('ArrowDown'))  proj.guidanceCorrY -= 0.3;
            // Mouse delta also steers guided missiles
            proj.guidanceCorrX += gd.dx * 0.15;
            proj.guidanceCorrY -= gd.dy * 0.15;
            break;
          }
        }
      }

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

      // Flight sound: play pitch based on distance to nearest enemy
      if (hasActiveProjectiles() && config.flySoundEnabled) {
        for (const proj of projectiles) {
          if (proj.active && !proj.isNapalmParticle) {
            // Find distance to nearest enemy for pitch calculation
            let minDistSq = 100000;
            for (const p of players) {
              if (!p.alive || p.index === proj.attackerIdx) continue;
              const dx = p.x - proj.x;
              const dy = (p.y - 4) - proj.y;
              minDistSq = Math.min(minDistSq, dx * dx + dy * dy);
            }
            playFlightSound(minDistSq);
            break;  // only one flight sound per frame
          }
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
      // All explosions done — check for falling tanks (if enabled)
      if (config.fallingTanks && checkTanksFalling()) {
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
        // EXE: Erratic wall type resolves each turn
        if (config.wallType === WALL.ERRATIC) resolveRandomWallType();

        // EXE: hostile environment — ~10% chance per turn of lightning or meteor
        if (config.hostileEnvironment && random(100) < 10) {
          if (random(2) === 0) {
            // Lightning: random X column, damage tanks in range
            const lx = random(config.screenWidth);
            for (const p of players) {
              if (p.alive && Math.abs(p.x - lx) <= 5) {
                p.energy -= 20;
                if (p.energy <= 0) {
                  p.energy = 0;
                  p.alive = false;
                  startDeathAnimation(p);
                  playDeathSound();
                }
              }
            }
            game.hostileLightningX = lx;
            game.hostileLightningFrames = 8;
            playLightningSound();
          } else {
            // Meteor: spawn projectile from top, Baby Missile, no attacker
            clearProjectiles();
            const mx = random(config.screenWidth);
            launchProjectile(mx, 16, 270, 200, 2, -1);
            game.state = STATE.FLIGHT;
            break;
          }
        }

        game.turnCount++;
        if (advancePlayer()) {
          // Sync mode: go back to SYNC_AIM for next round of aims
          if (config.playMode >= 1) {
            game.aimQueue = [];
            game.syncPlayerIdx = 0;
            game.aimTimer = config.playMode === 1 ? 600 : 0;
            game.state = STATE.SYNC_AIM;
          } else {
            // EXE: No Kibitzing — show interstitial between human turns in hotseat
            const nextPlayer = getCurrentPlayer();
            const humanCount = players.filter(p => p.alive && !isAI(p)).length;
            if (humanCount > 1 && !isAI(nextPlayer)) {
              game.screenHideTarget = nextPlayer.index;
              game.state = STATE.SCREEN_HIDE;
            } else {
              game.state = STATE.AIM;
            }
          }
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
      if (game.roundOverTimer > 30 && (consumeKey('Space') || consumeClick(0))) {
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
      // EXE: battery system — shields persist between rounds only if player has batteries
      for (const p of players) {
        if (p.activeShield !== 0) {
          if (p.inventory[43] > 0) {
            p.inventory[43]--;  // consume Battery (idx 43)
          } else {
            p.activeShield = 0;
            p.shieldEnergy = 0;
          }
        }
      }
      startNewRound();
      break;
    }

    case STATE.GAME_OVER: {
      // Press space/click to go back to main menu
      if (consumeKey('Space') || consumeClick(0)) {
        resetMenuState();
        game.state = STATE.CONFIG;
      }
      break;
    }

    // --- Synchronous play mode states ---

    case STATE.SYNC_AIM: {
      // Each player aims sequentially, aims stored in queue
      const syncPlayer = players[game.syncPlayerIdx];
      if (!syncPlayer || !syncPlayer.alive) {
        // Skip dead players
        game.syncPlayerIdx++;
        if (game.syncPlayerIdx >= players.length) {
          // All players have aimed — fire all
          game.state = STATE.SYNC_FIRE;
        } else if (config.playMode === 1) {
          game.aimTimer = 600;  // reset timer for next player
        }
        break;
      }

      game.currentPlayer = game.syncPlayerIdx;

      // Helper: advance to next player or fire all
      const syncAdvance = () => {
        game.syncPlayerIdx++;
        if (game.syncPlayerIdx >= players.length) {
          game.state = STATE.SYNC_FIRE;
        } else if (config.playMode === 1) {
          game.aimTimer = 600;  // reset timer for next player
        }
      };

      if (isAI(syncPlayer)) {
        if (!game.aiActive) {
          setAIWind(game.wind);
          startAITurn(syncPlayer);
          game.aiActive = true;
        }
        const aiResult = stepAITurn(syncPlayer);
        if (aiResult === 'fire') {
          game.aiActive = false;
          game.aimQueue.push({
            playerIdx: game.syncPlayerIdx,
            angle: syncPlayer.angle,
            power: syncPlayer.power,
            weaponIdx: syncPlayer.selectedWeapon,
          });
          syncAdvance();
        }
      } else {
        // Simultaneous mode: countdown timer for human players
        let timerExpired = false;
        if (config.playMode === 1 && game.aimTimer > 0) {
          game.aimTimer--;
          if (game.aimTimer <= 0) timerExpired = true;
        }

        if (handleAimInput(syncPlayer) || timerExpired) {
          game.aimQueue.push({
            playerIdx: game.syncPlayerIdx,
            angle: syncPlayer.angle,
            power: syncPlayer.power,
            weaponIdx: syncPlayer.selectedWeapon,
          });
          syncAdvance();
        }
      }
      break;
    }

    case STATE.SYNC_FIRE: {
      // Fire all queued aims at once
      clearProjectiles();
      for (const aim of game.aimQueue) {
        const p = players[aim.playerIdx];
        if (!p.alive) continue;

        const barrelLength = 12;
        const domeTopY = p.y - 4 - 4;
        const angleRad = aim.angle * Math.PI / 180;
        const startX = p.x + Math.cos(angleRad) * barrelLength;
        const startY = domeTopY - Math.sin(angleRad) * barrelLength;

        launchProjectile(startX, startY, aim.angle, aim.power, aim.weaponIdx, aim.playerIdx);
      }
      game.aimQueue = [];
      playFireSound();
      game.state = STATE.FLIGHT;
      break;
    }

    // --- No Kibitzing / System Menu states ---

    case STATE.SCREEN_HIDE: {
      // Black screen between human turns — press space/click to continue
      if (consumeKey('Space') || consumeClick(0)) {
        game.state = STATE.AIM;
      }
      break;
    }

    case STATE.SYSTEM_MENU: {
      // F9 system menu
      if (consumeKey('ArrowUp')) {
        game.systemMenuOption = Math.max(0, game.systemMenuOption - 1);
      }
      if (consumeKey('ArrowDown')) {
        game.systemMenuOption = Math.min(1, game.systemMenuOption + 1);
      }
      if (consumeKey('Enter') || consumeKey('Space')) {
        if (game.systemMenuOption === 0) {
          // Mass Kill — end round immediately
          for (const p of players) p.alive = false;
          endOfRoundScoring(game.round);
          game.warQuote = WAR_QUOTES[random(WAR_QUOTES.length)];
          game.roundOverTimer = 0;
          game.state = STATE.ROUND_OVER;
        } else {
          // New Game — back to main menu
          resetMenuState();
          game.state = STATE.CONFIG;
        }
      }
      if (consumeKey('Escape')) {
        game.state = STATE.AIM;
      }
      break;
    }
  }
}
