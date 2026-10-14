import {stepFinalScoringInput,resetFinalScoringInput} from './final-scoring.js';
import {stepRankingsInput,resetRankingsInput} from './rankings.js';
import {startFunkyBomb,stepFunkyBomb,isFunkyBombActive,clearFunkyBombs} from './funky-bomb.js';
import { projectileDrawing, retainWorldPixel } from './projectile-render.js';
// Scorched Earth - Game State Machine
// EXE source: play.cpp (seg 0x28B9, file base 0x2F830)
// EXE: main game loop dispatch at file 0x2F78A
// States: AIM → FLIGHT → EXPLOSION → FALLING → NEXT_TURN → ROUND_OVER → SHOP → ROUND_SETUP → GAME_OVER
// EXE: weapon dispatch via extras.cpp behaviors + fire_weapon at file 0x30652
// EXE: play modes — Sequential (0), Simultaneous (1), Synchronous (2) at DS config

import { config } from './config.js';
import { roundOrder } from './turn-order.js';
import { random, clamp } from './utils.js';
import { PLAYER_COLOR_MAX, PLAYER_PALETTE_STRIDE } from './constants.js';
import { players, checkTanksFalling, stepFallingTanks, createPlayers, resetAndPlaceTanks, startDeathAnimation, stepDeathAnimations, deathAnimations, deathHudName, getTankBarrel, updateTankDamageState } from './tank.js';
import { getTerrainY } from './terrain.js';
import { launchProjectile, stepSingleProjectile, projectiles, spawnProjectiles,
         clearProjectiles, hasActiveProjectiles,
         WALL, setResolvedWallType, getEffectiveWallType } from './physics.js';
import { getPixel, setPixel, getBackgroundColor } from './framebuffer.js';
import { drawWindIndicator } from './hud.js';
import { startExplosion, stepExplosion, isExplosionActive,
         applyExplosionDamage, resumeExplosionDamage, addDirt, addDirtTower, createTunnel,
         applyDisrupter } from './explosions.js';
import { isKeyDown, consumeKey, consumeClick, consumeAnyKey, getMouseDelta, mouse } from './input.js';
import { WEAPONS, BHV, WPN, cycleWeapon } from './weapons.js';
import { handleBehavior, handleFlightBehavior, napalmParticleStep, applyGuidance, selectGuidanceType } from './behaviors.js';
import { isAI, startAITurn, stepAITurn, setAIWind } from './ai.js';
import { endOfRoundScoring, applyInterest, scoreOnDeath, scoreOnDamage } from './score.js';
import { checkShieldDeflection, applyShieldDamage, shieldBreak, cycleShield } from './shields.js';
import { clearTerrainCollapse, stepTerrainCollapse } from './terrain-collapse.js';
import { resetWindIndicator } from './wind-indicator-state.js';
import {refreshShieldFlight} from './shield-flight.js';
import {activateShield,shieldActivation} from './shield-activation.js';
import { aftermathSequence } from './aftermath.js';
import { playFireSound, playExplosionSound, playFlightSound, playDeathSound, playTerrainGenPing, playTerrainHitSound, playShieldHitSound, initSound, toggleSound } from './sound.js';
import { triggerAttackSpeech, triggerDeathSpeech, stepSpeechBubble } from './talk.js';
import { openShop, closeShop, isShopActive, shopTick, drawShop, initMarket, mktUpdate } from './shop.js';
import { generateTerrain, terrainBitmap, PLAYFIELD_TOP, initSkyBackground, prepareTerrainGenerator } from './terrain.js';
import { initPalette } from './palette.js';
import { resetMenuState } from './menu.js';

// EXE System Menu items (DS:0x2B22 pointer table at DS:0x2224)
// confirm: EXE yes/no prompt text (DS:0x2C06, DS:0x2BC9, DS:0x2BDE)
export const SYSTEM_MENU_OPTIONS = [
  { label: '~Clear Screen', action: 'clear' },
  { label: '~Mass Kill', action: 'mass_kill', confirm: 'Mass kill everyone?' },
  { label: '~Quit Game', action: 'quit', confirm: 'Do you want to quit?' },
  { label: 'Reassign ~Players', action: null, disabled: true },
  { label: 'Reassign ~Teams', action: null, disabled: true },
  { label: 'Save ~Game', action: null, disabled: true },
  { label: '~Restore Game', action: null, disabled: true },
  { label: '~New Game', action: 'new_game', confirm: 'Do you really want to restart the game?' },
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
  SCREEN_HIDE: 'screen_hide', // EXE: K-key "No Kibitzing" dialog
  SYSTEM_MENU: 'system_menu', // EXE: F9 system menu
  TERRAIN_REVEAL: 'terrain_reveal', // EXE: progressive left-to-right terrain draw
};

export const game = {
  state: STATE.CONFIG,
  currentPlayer: 0,
  wind: 0,
  round: 1,
  turnCount: 0,
  nextTurnTimer: 0,
  afterFalling: false,
  aiActive: false,
  shopPlayerIdx: 0,
  initialShop: false,  // EXE: first shop before round 1 (no terrain regen after)
  warQuote: '',
  roundOverTimer: 0,
  // Play order system
  turnOrder: [],
  turnOrderIdx: 0,
  playOrderLastFirstId: -1,  // EXE DS:0x51A4: tracks first player's index for Losers-First rotation (-1 = first round)
  // Sync play mode
  aimQueue: [],        // stored aims for sync mode
  syncPlayerIdx: 0,    // which player is aiming in sync mode
  // Hostile environment

  // No Kibitzing
  // System menu
  systemMenuOption: 0,
  systemMenuActions: [],  // populated from SYSTEM_MENU_OPTIONS at F9 open
  systemMenuConfirm: null, // EXE: confirmation prompt text (DS:0x2C06, DS:0x2BC9, DS:0x2BDE)
  systemMenuPendingAction: null, // action to execute if confirmed
  // Guided missile steering
  guidedActive: false,
  // Simultaneous mode timer
  aimTimer: 0,
};

// EXE: wind generation — centered with NESTED random doubling (file 0x2943A)
// Formula: rand(max_wind/2) - max_wind/4 → range [-max/4, +max/4); approximately centered
// 20% chance ×2; nested 40% of that = 8% total chance of ×4
export function generateWind() {
  const maxWind = config.wind;
  // Even zero wind consumes the doubling draws in EXE 0x2945A.
  let wind = random(Math.floor(maxWind / 2)) - Math.floor(maxWind / 4);
  if (random(100) < 20) {
    wind *= 2;
    if (random(100) < 40) wind *= 2;  // nested: only if first double fired
  }
  game.wind = wind;  // EXE has no clamp on initial generation; natural range ≈ [-max, +max]
}

// Resolve Erratic/Random wall types to a concrete wall type
// EXE (file 0x22140): random(6) → 0-5 (None through Concrete)
function resolveRandomWallType() {
  setResolvedWallType(random(6));  // EXE: 0=None,1=Wrap,2=Padded,3=Rubber,4=Spring,5=Concrete
}

// EXE: wind random walk per turn — delta in [-5, +5], clamped to ±max_wind (file 0x28E99)
function updateWind() {
  if (!config.changeWind) return;
  const delta = random(11) - 5;  // [-5, +5]
  game.wind = clamp(game.wind + delta, -config.wind, config.wind);
  return delta !== 0; // Native tests before clamping, including max wind zero.
}

// Native sequential fire returns through 0x307B9: update and redraw the wind
// label before selecting the next tank. Reconstruct retained overlays first,
// since main.js repaints the underlying world before gameTick.
function redrawTurnWind() {
  drawWindIndicator(game.wind);
  projectileDrawing.draw();
  if (updateWind()) {
    const width = config.screenWidth;
    for (let x = width - 81; x < width - 4; x++) {
      for (let y = PLAYFIELD_TOP + 5; y < PLAYFIELD_TOP + 16; y++) {
        const color = getPixel(x, y);
        const ground = color >= 120 && color <= 144;
        if (ground) random(1);
        terrainBitmap[y * width + x] = ground ? 120 : 0;
        retainWorldPixel(x, y, ground ? 120 : getBackgroundColor(y, x));
      }
    }
  }
  drawWindIndicator(game.wind, { redraw: true });
}

// Get the current active player
export function getCurrentPlayer() {
  return players[game.currentPlayer];
}

// EXE dispatch table at 0x2B28C: Random, Losers, Winners, Round-Robin.
function computeTurnOrder() {
  const { slots, start, lastFirst } = roundOrder(
    players, config.playOrder, game.playOrderLastFirstId);
  game.playOrderLastFirstId = lastFirst;
  game.turnOrder = [...slots.slice(start), ...slots.slice(0, start)];
  game.turnOrderIdx = 0;
  return slots;
}

// Advance to next living player using turn order
function advancePlayer() {
  deathHudName.player=null;
  // Native player selection redraws the full HUD (0x2AB94 / 0x3EFEA).
  for (const player of players) {
    player.hudParachuteCount = undefined;
    player.hudEnergy = undefined;
    player.hudPower = undefined;
    player.hudShieldEnergy = undefined;
    player.hudWeapon = undefined;
    player.hudContactTriggerCount = undefined;
    player.hudContactTriggerArmed = undefined;
    player.selectedShield = undefined;
  }
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
    // Keep the round's slot order; dead players are skipped below.
    game.turnOrderIdx = 0;
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

// Create player identities and open shopping before the first landscape setup.
export function initGameRound(setup = []) {
  initMarket();  // Initialize market prices at game start (EXE: mkt_init_defaults)
  game.playOrderLastFirstId = -1;  // EXE DS:0x51A4: reset to -1 (first round) on new game
  createPlayers(config.numPlayers, setup);
  game.turnOrder = [];
  game.turnOrderIdx = 0;
  game.currentPlayer = 0;

  // EXE: initial shop before round 1 — each player buys weapons/defenses
  game.initialShop = true;
  game.shopPlayerIdx = 0;
  const rl = config.rounds;
  openShop(0, rl);
  game.state = STATE.SHOP;
}

// Transition from shop to gameplay (called after initial shop or between-round shop)
function enterPlayState() {
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

// Native 0x2B405: Standard/Corporate teams win together. Vicious teams
// continue fighting within the last team until only one player survives.
function checkRoundOver() {
  const alive = players.filter(p => p.alive);
  if(config.teamMode===0 || config.teamMode===3)return alive.length<=1;
  return new Set(alive.map(p=>p.team)).size<=1;
}

// EXE 0x2928F selects ground color, then resolves Random/Erratic walls,
// then generates wind before the landscape wrapper builds its sky.
export function prepareRoundBackground() {
  game.afterFalling = false;
  game.aftermath = null;
  game.aftermathOperation = null;
  clearTerrainCollapse();
  clearFunkyBombs();
  projectileDrawing.clear();
  resetWindIndicator();
  initPalette(config.landType, config.skyType, { beforeSky() {
    if (config.wallType === WALL.RANDOM || config.wallType === WALL.ERRATIC)
      resolveRandomWallType();
    generateWind();
    return { allowCavern: prepareTerrainGenerator() < 0 };
  } });
  initSkyBackground({ reuseStars: true, wrap: getEffectiveWallType() === WALL.WRAP });
}

// Start a new round
function startNewRound() {
  if (game.initialShop) game.initialShop = false;
  else game.round++;
  game.turnCount = 0;
  game.currentPlayer = 0;

  prepareRoundBackground();
  // Regenerate terrain and place tanks
  generateTerrain();
  // Native 0x294FC draws the initial wind label after terrain generation;
  // with changing wind enabled this consumes a random step before placement.
  if (updateWind()) {
    // Native 0x28EF2 clears the label rectangle. Each ground pixel calls
    // 0x299C0, consuming random(1) even with a single ground color.
    const width = config.screenWidth;
    for (let x = width - 81; x < width - 4; x++) {
      for (let y = PLAYFIELD_TOP + 5; y < PLAYFIELD_TOP + 16; y++) {
        const index = y * width + x, color = terrainBitmap[index];
        if (color >= 120 && color <= 144) {
          random(1);
          terrainBitmap[index] = 120;
        }
      }
    }
  }
  playTerrainGenPing();

  // Reuse existing players (preserves score/cash/wins/inventory/aiType/name)
  resetAndPlaceTanks(computeTurnOrder());
  if (game.turnOrder.length > 0) {
    game.currentPlayer = game.turnOrder[0];
  }

  // EXE: progressive terrain draw — columns sweep left-to-right during generation
  // EXE drawColumn at file 0x29720 called per column from random walk kernel
  game.terrainRevealCol = 0;
  game.state = STATE.TERRAIN_REVEAL;
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
  const FUEL_TANK_IDX = WPN.FUEL_TANK;
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
// Native 0x30661 guards attack speech using TALKING_TANKS and the player's
// AI type. Shield state does not control the speech call.
function fireWeapon(player) {
  const { endX: startX, endY: startY } = getTankBarrel(player);

  let weaponIdx = player.selectedWeapon;

  // EXE 0x3070C compares DS:D54C (Bal Guidance) and substitutes DS:D548
  // (Laser). Web indices add two to the EXE table index.
  if (weaponIdx === WPN.BAL_GUIDANCE) weaponIdx = WPN.LASER;

  // Native firing decrements inventory without repainting the weapon widget.
  // Selection falls back only after the blocking flight/aftermath call returns.
  player.hudWeapon = {index:weaponIdx,ammo:player.inventory[weaponIdx]};
  if (weaponIdx !== WPN.BABY_MISSILE && player.inventory[weaponIdx] > 0)
    player.inventory[weaponIdx]--;

  // Native 0x3069D tests tank+0x2A, then consumes inventory[D566]
  // (Contact Trigger). Owning a shield never spends it when firing.
  const contactTriggerActive = !!player.contactTriggerArmed;
  if (contactTriggerActive) {
    // Native consumption does not redraw the count/icon at firing.
    player.hudContactTriggerCount ??= player.inventory[WPN.CONTACT_TRIGGER];
    player.hudContactTriggerArmed ??= player.contactTriggerArmed;
    player.inventory[WPN.CONTACT_TRIGGER]--;
    if (player.inventory[WPN.CONTACT_TRIGGER] <= 0) player.contactTriggerArmed=false;
  }

  // EXE: guidance_type set on projectile at fire time, ammo consumed
  const guidanceType = selectGuidanceType(player);

  clearProjectiles();
  playFireSound();
  // Native 0x30661 skips the entire speech call for humans unless All is set.
  // The routine's random-player taunt draws RNG before its own speech guard.
  if (config.talkingTanks > 1 || isAI(player)) triggerAttackSpeech(player);
  launchProjectile(startX, startY, player.angle, player.power, weaponIdx, player.index);

  // Set guidance type on the newly launched projectile
  if (guidanceType && projectiles.length > 0) {
    projectiles[projectiles.length - 1].guidanceType = guidanceType;
  }

  // EXE: DS:0x1C76 pushed to launchProjectile at extras.cpp 0x21357
  if (contactTriggerActive && projectiles.length > 0) {
    projectiles[projectiles.length - 1].contactTriggerActive = true;
  }

  game.state = STATE.FLIGHT;
}

// Native 0x30771 runs after all flight/aftermath work. Only a depleted
// selection redraws row 1; remaining ammo stays visually stale until next turn.
function finishFiring() {
  const player=getCurrentPlayer();
  if (player.hudWeapon && player.hudWeapon.index!==WPN.BABY_MISSILE &&
      player.inventory[player.hudWeapon.index] <= 0) {
    player.selectedWeapon=WPN.BABY_MISSILE;
    player.hudWeapon=undefined;
  }
}

// Find which player was hit based on projectile position pixel color
function findHitPlayer(proj) {
  const px = Math.round(proj.x);
  const py = Math.round(proj.y);
  const pixel = proj.hitPixel ?? getPixel(px, py);
  if (pixel >= 0 && pixel < PLAYER_COLOR_MAX) {
    const playerIdx = Math.floor(pixel / PLAYER_PALETTE_STRIDE);
    return players[playerIdx] || null;
  }
  return null;
}

// Process a projectile hit
export function processHit(proj, hitResult) {
  // Native reflecting-shield contact; body hits continue to weapon dispatch.
  if (hitResult === 'hit_tank') {
    const targetPlayer = findHitPlayer(proj);
    if (targetPlayer?.activeShield === 3 && proj.hitPixel % 8 === 5 &&
        targetPlayer.index !== proj.attackerIdx) {
      // Native 0x22498 draws/tracks the contact head before reflection erases
      // its center; the retained drawing layer must observe that same order.
      projectileDrawing.advance(proj);
      projectileDrawing.draw();
    }
    if (targetPlayer && checkShieldDeflection(targetPlayer, proj)) {
      return;  // projectile deflected, no explosion
    }
  }

  const result = handleBehavior(proj, hitResult);
  if (result.directHit) {
    const target = findHitPlayer(proj);
    const attacker = players[proj.attackerIdx];
    if (target && result.directHit === 'shield') {
      const remainder = applyShieldDamage(target, 10);
      if (attacker) scoreOnDamage(attacker, target, 10 - remainder, true);
    } else if (target) {
      if (attacker) scoreOnDamage(attacker, target, target.energy, false);
      target.energy = 0;
      updateTankDamageState(target);
      // Native leaves alive set here; aftermath handles death after the blast.
    }
  }

  // EXE: explosion scale is resolution-dependent (file 0x2B4A8, icons.cpp)
  // 320×200 (FG_MAXX==319): Normal=0.5, Medium=0.75, Large=1.0 (DS:0x5250/0x5254/default)
  // >320 wide:               Normal=1.0, Medium=2.0, Large=3.0 (default/DS:0x5258/0x525C)
  if (result.radius > 0) {
    const scale = config.screenWidth <= 320
      ? [0.5, 0.75, 1.0][config.explosionScale] || 1.0
      : [1.0, 2.0, 3.0][config.explosionScale] || 1.0;
    result.radius = Math.floor(result.radius * scale);
  }

  const cx = Math.round(proj.x);
  const cy = Math.round(proj.y);

  // Spawn sub-projectiles
  if (result.spawn && result.spawn.length > 0) {
    spawnProjectiles(result.spawn);
  }

  if (result.funkySpread!==undefined) {
    startFunkyBomb(cx,cy,result.funkySpread,proj.attackerIdx);
  } else if (result.tunnel) {
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
    const afterRestoration = () => {
      if (!result.skipDamage) {
        // Native damage_tank preserves signed HP and alive until outer_sim_loop
        // finishes settling/falling and dispatches deaths in player order.
        applyExplosionDamage(cx,cy,result.radius,proj.attackerIdx,proj.weaponIdx,
          null,{deferDeath:true});
      }
    };
    startExplosion(cx, cy, result.radius, proj.attackerIdx, afterRestoration);
  }

  // Remove projectile unless behavior says to keep it alive
  if (!result.keepAlive) {
    proj.active = false;
  }
}

// EXE: system menu item activation — shows confirmation prompt if needed
function activateSystemMenuItem(opt) {
  if (opt.confirm) {
    game.systemMenuConfirm = opt.confirm;
    game.systemMenuPendingAction = opt.action;
  } else {
    executeSystemMenuAction(opt.action);
  }
}

// EXE: execute confirmed system menu action
function executeSystemMenuAction(action) {
  switch (action) {
    case 'clear':
      // EXE: ~Clear Screen — redraw playfield (clear craters/debris)
      game.state = STATE.AIM;
      break;
    case 'mass_kill':
      // EXE: ~Mass Kill — kills all players (DS:0x2C06 confirmed)
      for (const p of players) p.alive = false;
      endOfRoundScoring(game.round);
      game.warQuote = '';
      resetRankingsInput();
      resetFinalScoringInput();
      game.roundOverTimer = 0;
      game.state = STATE.ROUND_OVER;
      break;
    case 'quit':
      // EXE: ~Quit Game — back to main menu (DS:0x2BC9 confirmed)
      resetMenuState();
      game.state = STATE.CONFIG;
      break;
    case 'new_game':
      // EXE: ~New Game — restart game (DS:0x2BDE confirmed)
      resetMenuState();
      game.state = STATE.CONFIG;
      break;
    default:
      game.state = STATE.AIM;
      break;
  }
}

// Main game tick (called every frame)
export function gameTick() {
  if (shieldActivation.active) return;
  // Native shield absorption does not return until its fade/erase completes.
  // Rendering advances the fade; gameplay must not run ahead of that call.
  if (shieldBreak.active) return;
  if (!resumeExplosionDamage() || shieldBreak.active) return;
  if (isFunkyBombActive()) {stepFunkyBomb();return;}
  if (stepDeathAnimations()) return;
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
        // Native scan 0x0C -> 0x1F2C5: arm/disarm Contact Trigger.
        if (consumeKey('Minus') && config.statusBar && player.inventory[WPN.CONTACT_TRIGGER]>0) {
          player.contactTriggerArmed=!player.contactTriggerArmed;
          player.hudContactTriggerArmed=undefined;
        }
        if (consumeKey('KeyS') && config.statusBar) cycleShield(player);
        if (consumeKey('KeyE') && config.statusBar && activateShield(player)) break;
        // Native input dispatch 0x2F78A: scan code 0x25 (K) calls
        // show_no_kibitzing at 0x2F7EF, returning to this player's input.
        if (consumeKey('KeyK')) {
          game.state = STATE.SCREEN_HIDE;
          break;
        }
        // EXE: F9 opens system menu during aim phase
        if (consumeKey('F9')) {
          game.systemMenuOption = 0;
          game.systemMenuActions = SYSTEM_MENU_OPTIONS;
          game.state = STATE.SYSTEM_MENU;
          break;
        }
        // EXE: Enter = SURRENDER — player forfeits, treated as self-kill
        if (consumeKey('Enter')) {
          player.alive = false;
          player.energy = 0;
          scoreOnDeath(player, player);
          triggerDeathSpeech(player);
          startDeathAnimation(player,game.currentPlayer,players[game.currentPlayer]?.selectedWeapon ?? 2);
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
          if (shieldBreak.active) return;
          const proj = projectiles[i];
          if (!proj.active) continue;

          // Napalm pixel-walking cellular automaton (EXE: 0x2DA00)
          if (proj.isNapalmParticle) {
            const napResult = napalmParticleStep(proj, game.wind);
            if (napResult.remove) {
              // Phase 2: damage at explosion points (EXE: 0x2DD41–0x2DEF4)
              if (napResult.napalmDamage) {
                const weapon = WEAPONS[proj.weaponIdx];
                const isHot = weapon && weapon.param > 15;
                const maxDmg = isHot ? 50 : 30;   // DS:0x5686 / DS:0x568E
                const maxRange = isHot ? 40 : 25;  // DS:0x5682 / DS:0x568A
                for (const pt of napResult.napalmDamage) {
                  for (const player of players) {
                    if (!player.alive) continue;
                    const dx = player.x - pt.x;
                    const dy = (player.y - 6) - pt.y;  // tank center offset
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < maxRange) {
                      let damage = Math.floor(maxDmg - dist);
                      if (damage > 0) {
                        // EXE: damage_tank(1, ...) goes through shield
                        damage = applyShieldDamage(player, damage);
                        if (damage > 0) {
                          const attacker = players[proj.attackerIdx];
                          if (attacker) scoreOnDamage(attacker, player, damage, false);
                          player.energy -= damage;
                          if (player.energy <= 0) {
                            player.energy = 0;
                            player.alive = false;
                          }
                        }
                      }
                    }
                  }
                }
              }
              // Phase 3: erase fire pixels (EXE: 50-frame fade, simplified to instant)
              if (napResult.napalmFirePixels) {
                for (const fp of napResult.napalmFirePixels) {
                  const cur = getPixel(fp.x, fp.y);
                  if (cur === 254 || cur === 80) {  // fire or dirt napalm color (EXE: 0x50=80)
                    setPixel(fp.x, fp.y, napResult.isDirt ? 80 : 0);  // dirt stays, fire erased to sky
                  }
                }
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
              startExplosion(cx, cy, radius, proj.attackerIdx,
                () => applyExplosionDamage(cx, cy, radius, proj.attackerIdx, proj.weaponIdx,
                  null,{deferDeath:true}));
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
          if (result === 'flying') projectileDrawing.advance(proj);

          if (result === 'hit_terrain' || result === 'hit_tank' || result === 'hit_wall') {
            // EXE: rising tone on terrain hit (extras.cpp 0x24DCD), starts 1000 Hz, +200/step
            if (result === 'hit_terrain') playTerrainHitSound(3);
            processHit(proj, result);
            if (shieldBreak.active || isFunkyBombActive()) {
              if (!proj.active) {
                projectileDrawing.finish(proj);
                projectiles.splice(i, 1);
              }
              return;
            }
          } else if (result === 'offscreen') {
            proj.active = false;
          }

          if (proj.active) anyActive = true;
        }

        // Clean up inactive projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
          if (!projectiles[i].active) {
            projectileDrawing.finish(projectiles[i]);
            projectiles.splice(i, 1);
          }
        }

        if (shieldBreak.active) return;
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
      const explosionActive = stepExplosion();
      if (explosionActive || shieldBreak.active) {
        // Explosion still animating
        break;
      }
      if (!game.aftermath) {
        game.aftermath=aftermathSequence(players,{afterFalling:game.afterFalling});
        game.aftermathOperation=null;
      }
      game.afterFalling=false;
      let aftermathDone=false;
      while (!aftermathDone) {
        game.aftermathOperation ??= game.aftermath.next();
        if (game.aftermathOperation.done) {aftermathDone=true;break;}
        const operation=game.aftermathOperation.value;
        if (operation.kind==='settle') {
          if (stepTerrainCollapse()) break;
          game.aftermathOperation=null;
        } else if (operation.kind==='fall') {
          game.aftermathOperation=null;
          if (config.fallingTanks && checkTanksFalling()) {
            game.state=STATE.FALLING;
            break;
          }
        } else {
          const player=players[operation.index];
          player.pendingFallDeath = false;
          player.alive = false;
          scoreOnDeath(players[game.currentPlayer],player);
          triggerDeathSpeech(player);
          startDeathAnimation(player,game.currentPlayer,players[game.currentPlayer]?.selectedWeapon ?? 2);
          playDeathSound();
          game.aftermathOperation=null;
          break;
        }
      }
      if (!aftermathDone) break;
      game.aftermath=null;
      game.aftermathOperation=null;
      if (checkRoundOver()) {
        endOfRoundScoring(game.round);
        game.warQuote = '';
        resetRankingsInput();
        resetFinalScoringInput();
        game.roundOverTimer = 0;
        game.state = STATE.ROUND_OVER;
      } else {
        game.state = STATE.NEXT_TURN;
      }
      break;
    }

    case STATE.FALLING: {
      if (!stepFallingTanks(game.wind)) {
        // Native outer_sim_loop (0x232BC) settles dirt again after falling.
        game.afterFalling = true;
        game.state = STATE.EXPLOSION;
      }
      break;
    }

    case STATE.NEXT_TURN: {
      finishFiring();
      game.nextTurnTimer++;
      if (game.nextTurnTimer > 15) {  // brief pause between turns
        game.nextTurnTimer = 0;
        redrawTurnWind();
        // EXE: Erratic wall type resolves each turn
        if (config.wallType === WALL.ERRATIC) resolveRandomWallType();

        // EXE: HOSTILE_ENVIRONMENT (DS:0x513C) per-pixel damage is applied in physics.js
        // stepSingleProjectile (file 0x3EB72) — not a turn-based event.
        // No turn-level hostile event in EXE.

        game.turnCount++;
        if (advancePlayer()) {
          players.forEach(refreshShieldFlight);
          // Sync mode: go back to SYNC_AIM for next round of aims
          if (config.playMode >= 1) {
            game.aimQueue = [];
            game.syncPlayerIdx = 0;
            game.aimTimer = config.playMode === 1 ? 600 : 0;
            game.state = STATE.SYNC_AIM;
          } else {
            // Native 0x2AB99 enters the next human's input loop directly.
            const nextPlayer = getCurrentPlayer();
            if (!isAI(nextPlayer)) nextPlayer.contrastPending = true;
            game.state = STATE.AIM;
          }
        } else {
          endOfRoundScoring(game.round);
          game.warQuote = '';
          resetRankingsInput();
          resetFinalScoringInput();
          game.roundOverTimer = 0;
          game.state = STATE.ROUND_OVER;
        }
      }
      break;
    }

    case STATE.ROUND_OVER: {
      finishFiring();
      game.roundOverTimer++;
      if(game.round>=config.rounds) {
        const action=stepFinalScoringInput(players);
        if(action!==null) {
          game.finalScoringAction=action;
          // The web host returns to its menu for Quit; native action 0 exits DOS.
          resetMenuState();game.state=STATE.CONFIG;
        }
        break;
      }
      if (stepRankingsInput(players,game.round,config.rounds)) {
        mktUpdate();  // EXE: adjust dynamic market prices before shopping.
        game.shopPlayerIdx = 0;
        applyInterest();
        const rl = config.rounds - game.round + 1;
        openShop(0, rl);
        game.state = STATE.SHOP;
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
          const rl = config.rounds - game.round + 1;
          openShop(game.shopPlayerIdx, rl);
        }
      }
      break;
    }

    case STATE.ROUND_SETUP: {
      // EXE: battery system — shields persist between rounds only if player has batteries
      for (const p of players) {
        if (p.activeShield !== 0) {
          if (p.inventory[WPN.BATTERY] > 0) {
            p.inventory[WPN.BATTERY]--;  // consume Battery (idx 43)
          } else {
            p.activeShield = 0;
            p.shieldEnergy = 0;
          }
        }
      }
      startNewRound();
      break;
    }

    case STATE.TERRAIN_REVEAL: {
      // EXE: height_random_walk (0x29808) draws ALL columns in tight loop, no frame sync.
      // Visual reveal is just CPU speed. We approximate ~1s total at 60fps.
      const revealSpeed = Math.max(4, Math.floor(config.screenWidth / 60));
      game.terrainRevealCol += revealSpeed;
      if (game.terrainRevealCol >= config.screenWidth) {
        game.terrainRevealCol = config.screenWidth;
        // Transition to gameplay
        if (config.playMode >= 1) {
          game.aimQueue = [];
          game.syncPlayerIdx = 0;
          game.aimTimer = config.playMode === 1 ? 600 : 0;
          game.state = STATE.SYNC_AIM;
        } else {
          game.state = STATE.AIM;
        }
      }
      break;
    }

    case STATE.GAME_OVER: {
      // EXE: fg_getkey() — any key to go back to main menu
      if (consumeAnyKey() || consumeClick(0)) {
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

        const { endX: startX, endY: startY } = getTankBarrel({ ...p, angle: aim.angle });

        launchProjectile(startX, startY, aim.angle, aim.power, aim.weaponIdx, aim.playerIdx);
      }
      game.aimQueue = [];
      playFireSound();
      game.state = STATE.FLIGHT;
      break;
    }

    // --- No Kibitzing / System Menu states ---

    case STATE.SCREEN_HIDE: {
      // Native modal privacy dialog returns to the same player's input.
      if (consumeAnyKey() || consumeClick(0)) {
        game.state = STATE.AIM;
      }
      break;
    }

    case STATE.SYSTEM_MENU: {
      // EXE: F9 system menu — 8 items from DS:0x2224 pointer table

      // Confirmation sub-dialog active?
      if (game.systemMenuConfirm) {
        // EXE: yes/no confirmation — Y=confirm, N/Escape=cancel
        if (consumeKey('KeyY') || consumeKey('Enter')) {
          const action = game.systemMenuPendingAction;
          game.systemMenuConfirm = null;
          game.systemMenuPendingAction = null;
          executeSystemMenuAction(action);
        } else if (consumeKey('KeyN') || consumeKey('Escape')) {
          game.systemMenuConfirm = null;
          game.systemMenuPendingAction = null;
        }
        break;
      }

      // Navigate: skip disabled items
      if (consumeKey('ArrowUp')) {
        let n = game.systemMenuOption - 1;
        while (n >= 0 && game.systemMenuActions[n].disabled) n--;
        if (n >= 0) game.systemMenuOption = n;
      }
      if (consumeKey('ArrowDown')) {
        const max = game.systemMenuActions.length - 1;
        let n = game.systemMenuOption + 1;
        while (n <= max && game.systemMenuActions[n].disabled) n++;
        if (n <= max) game.systemMenuOption = n;
      }

      // EXE: hotkey letters — extract char after '~' in label, match Key<X>
      for (let i = 0; i < game.systemMenuActions.length; i++) {
        const opt = game.systemMenuActions[i];
        if (opt.disabled) continue;
        const tildeIdx = opt.label.indexOf('~');
        if (tildeIdx >= 0 && tildeIdx + 1 < opt.label.length) {
          const hotkey = opt.label[tildeIdx + 1].toUpperCase();
          if (consumeKey('Key' + hotkey)) {
            game.systemMenuOption = i;
            activateSystemMenuItem(opt);
            break;
          }
        }
      }

      if (consumeKey('Enter') || consumeKey('Space')) {
        const opt = game.systemMenuActions[game.systemMenuOption];
        if (opt && !opt.disabled) {
          activateSystemMenuItem(opt);
        }
      }
      if (consumeKey('Escape')) {
        game.state = STATE.AIM;
      }
      break;
    }
  }
}
