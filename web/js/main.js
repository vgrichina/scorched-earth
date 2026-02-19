// Scorched Earth - Main entry point + game loop
// Phase 6: Title screen, config menu, full game flow

import { config } from './config.js';
import { initFramebuffer, blit, setPixel, getPixel, fillRect } from './framebuffer.js';
import { initPalette, BLACK } from './palette.js';
import { generateTerrain, drawSky, drawTerrain } from './terrain.js';
import { placeTanks, drawAllTanks, players } from './tank.js';
import { seedRandom, bresenhamLine } from './utils.js';
import { initInput } from './input.js';
import { drawHud } from './hud.js';
import { drawText, drawTextShadow } from './font.js';
import { projectiles } from './physics.js';
import { gameTick, game, STATE, generateWind, getCurrentPlayer } from './game.js';
import { drawShield } from './shields.js';
import { isShopActive, drawShop } from './shop.js';
import { getLeaderboard } from './score.js';
import { menuTick, drawTitleScreen, drawConfigScreen, drawPlayerSetupScreen, playerSetup } from './menu.js';
import { WPN } from './weapons.js';

function init() {
  const canvas = document.getElementById('screen');
  initFramebuffer(canvas);

  initInput();
  seedRandom(Date.now());

  // Set up palette for title screen (default terrain/sky)
  initPalette(config.landType, config.skyType);

  // Start in title screen state
  game.state = STATE.TITLE;

  requestAnimationFrame(gameLoop);
}

// Called when transitioning from menu to game
function startGame() {
  // Re-init palette with configured types
  initPalette(config.landType, config.skyType);
  generateTerrain();
  generateWind();
  placeTanks(config.numPlayers);

  // Apply player setup from menu
  for (let i = 0; i < players.length && i < playerSetup.length; i++) {
    players[i].name = playerSetup[i].name;
    players[i].aiType = playerSetup[i].aiType;
  }

  game.round = 1;
  game.turnCount = 0;
  game.currentPlayer = 0;
  game.state = STATE.AIM;
}

function redrawWorld() {
  drawSky();
  drawTerrain();
  drawAllTanks();
  // Draw shields on top of tanks
  for (const p of players) {
    if (p.alive) drawShield(p);
  }
}

function drawAllProjectiles() {
  for (const proj of projectiles) {
    if (!proj.active) continue;

    // Draw trail
    const trail = proj.trail;
    const trailLen = proj.isNapalmParticle ? 5 : 20;
    for (let i = Math.max(0, trail.length - trailLen); i < trail.length; i++) {
      const p = trail[i];
      const age = trail.length - i;
      if (p.x >= 0 && p.x < config.screenWidth && p.y >= 0 && p.y < config.screenHeight) {
        if (proj.isNapalmParticle) {
          const palIdx = proj.isDirtParticle ? 140 : (190 + Math.min(9, age));
          setPixel(p.x, p.y, palIdx);
        } else {
          setPixel(p.x, p.y, age < 5 ? 199 : age < 10 ? 189 : 179);
        }
      }
    }

    // Draw projectile head
    const hx = Math.round(proj.x);
    const hy = Math.round(proj.y);
    if (hx >= 0 && hx < config.screenWidth && hy >= 0 && hy < config.screenHeight) {
      if (proj.isNapalmParticle) {
        setPixel(hx, hy, proj.isDirtParticle ? 145 : 199);
      } else {
        setPixel(hx, hy, 199);
        if (hx + 1 < config.screenWidth) setPixel(hx + 1, hy, 189);
        if (hx - 1 >= 0) setPixel(hx - 1, hy, 189);
        if (hy + 1 < config.screenHeight) setPixel(hx, hy + 1, 189);
        if (hy - 1 >= 0) setPixel(hx, hy - 1, 189);
      }
    }
  }
}

// Laser sight state for sweep animation (RE: draw_laser_sight at file 0x36321)
const laserState = {
  displayAngle: -1,  // current visual angle in radians (-1 = uninitialized)
  lastPlayerIdx: -1, // track player changes to reset sweep
};
const LASER_ANGLE_STEP = 0.3;  // radians per frame (RE: DS:6108 ~0.3 rad)

// Draw laser sight line from barrel tip (RE: segment 0x2F76:0x01C1)
// Original sweeps from old angle to new angle in ~0.3 rad steps
// Standard Laser: green (0x78=120), blends with terrain
// Plasma Laser: white (0xFE=254), overwrites background
function drawLaserSight(player) {
  if (!player.alive) return;
  // Check if player has Laser (idx 35) or Plasma Laser (idx 36)
  const hasLaser = player.inventory[WPN.LASER] > 0;
  const hasPlasma = player.inventory[WPN.PLASMA_LASER] > 0;
  if (!hasLaser && !hasPlasma) return;

  // Plasma takes priority (RE: type==1 check)
  const isPlasma = hasPlasma;
  const color = isPlasma ? 254 : 120;  // RE: 0xFE white vs 0x78 green

  const targetAngleRad = player.angle * Math.PI / 180;

  // Reset sweep on player change
  if (laserState.lastPlayerIdx !== player.index) {
    laserState.displayAngle = targetAngleRad;
    laserState.lastPlayerIdx = player.index;
  }

  // Initialize on first use
  if (laserState.displayAngle < 0) {
    laserState.displayAngle = targetAngleRad;
  }

  // Sweep animation: step display angle toward target (RE: angle_rad += ANGLE_STEP)
  const diff = targetAngleRad - laserState.displayAngle;
  if (Math.abs(diff) > LASER_ANGLE_STEP) {
    laserState.displayAngle += Math.sign(diff) * LASER_ANGLE_STEP;
  } else {
    laserState.displayAngle = targetAngleRad;
  }

  const angleRad = laserState.displayAngle;
  const barrelLength = 12;
  const domeTopY = player.y - 4 - 4;
  const startX = Math.round(player.x + Math.cos(angleRad) * barrelLength);
  const startY = Math.round(domeTopY - Math.sin(angleRad) * barrelLength);

  // RE: dx = sin(angle_rad) * (-power) — power controls laser reach (0-1000 pixels)
  const maxDist = player.power;
  const endX = Math.round(player.x + Math.cos(angleRad) * maxDist);
  const endY = Math.round(domeTopY - Math.sin(angleRad) * maxDist);

  bresenhamLine(startX, startY, endX, endY, (x, y) => {
    if (x >= 0 && x < config.screenWidth && y >= 0 && y < config.screenHeight) {
      if (!isPlasma) {
        // Standard laser: terrain blend mode (RE: EC4E == 0x78)
        // Skip pixels matching 254 (RE: EC4C mask) and terrain pixels >= 105
        const existing = getPixel(x, y);
        if (existing === 254 || existing >= 105) return;
      }
      setPixel(x, y, color);
    }
  });
}

function drawRoundOver() {
  const alive = players.filter(p => p.alive);

  if (alive.length === 1) {
    drawTextShadow(104, 60, alive[0].name + ' wins!', alive[0].index * 8 + 4, 0);
  } else {
    drawTextShadow(136, 60, 'Draw!', 150, 0);
  }

  // Show scores
  drawTextShadow(8, 80, 'Scores:', 199, 0);
  const board = getLeaderboard();
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    const color = p.index * 8 + 4;
    drawText(16, 92 + i * 10, `${p.name}: ${p.score}`, color);
  }

  // War quote
  if (game.warQuote) {
    drawTextShadow(8, 140, game.warQuote.substring(0, 38), 150, 0);
    if (game.warQuote.length > 38) {
      drawTextShadow(8, 150, game.warQuote.substring(38), 150, 0);
    }
  }

  drawTextShadow(60, 170, `Round ${game.round}/${config.rounds}`, 150, 0);
  drawTextShadow(60, 182, 'Press SPACE to continue', 150, 0);
}

function drawGameOver() {
  fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);

  drawTextShadow(96, 20, 'GAME OVER', 199, 0);

  // Final leaderboard
  drawTextShadow(32, 40, 'Final Scores', 150, 0);

  const board = getLeaderboard();
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    const color = p.index * 8 + 4;
    const medal = i === 0 ? '* ' : '  ';
    drawTextShadow(24, 60 + i * 14, `${medal}${p.name}`, color, 0);
    drawText(200, 60 + i * 14, `${p.score} pts`, 150);
    drawText(270, 60 + i * 14, `${p.wins}W`, 150);
  }

  drawTextShadow(56, 160, 'Press SPACE to restart', 150, 0);
}

// MAYHEM cheat code tracker
const MAYHEM_SEQ = ['KeyM', 'KeyA', 'KeyY', 'KeyH', 'KeyE', 'KeyM'];
let mayhemIdx = 0;

function checkMayhemCheat() {
  // Check for keypress matching next character in sequence
  // We piggyback on the input system by checking the raw key events
  // This is handled via a global listener set up once
}

function gameLoop() {
  // --- Menu screens ---
  if (game.state === STATE.TITLE || game.state === STATE.CONFIG || game.state === STATE.PLAYER_SETUP) {
    const result = menuTick();

    if (result === 'start_game') {
      startGame();
    } else if (result === 'title') {
      game.state = STATE.TITLE;
      drawTitleScreen();
    } else if (result === 'config') {
      game.state = STATE.CONFIG;
      drawConfigScreen();
    } else if (result === 'player_setup') {
      game.state = STATE.PLAYER_SETUP;
      drawPlayerSetupScreen();
    }

    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // Shop mode: draw shop UI instead of game world
  if (game.state === STATE.SHOP && isShopActive()) {
    gameTick();
    drawShop(players[game.shopPlayerIdx]);
    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // Game over: draw final screen
  if (game.state === STATE.GAME_OVER) {
    gameTick();
    drawGameOver();
    blit();
    requestAnimationFrame(gameLoop);
    return;
  }

  // 1. Redraw clean world FIRST (no HUD) so gameTick reads clean pixels
  redrawWorld();

  // 2. Game logic — reads clean framebuffer for collisions/terrain scanning
  gameTick();

  // 3. Overlays on top of game world
  const player = getCurrentPlayer();
  drawHud(player, game.wind, game.round);
  drawAllProjectiles();

  // Draw laser sight during AIM state for human players
  if (game.state === STATE.AIM && player.alive) {
    drawLaserSight(player);
  }

  if (game.state === STATE.ROUND_OVER) {
    drawRoundOver();
  }

  blit();

  requestAnimationFrame(gameLoop);
}

// MAYHEM cheat: global key listener for the sequence
window.addEventListener('keydown', (e) => {
  if (e.code === MAYHEM_SEQ[mayhemIdx]) {
    mayhemIdx++;
    if (mayhemIdx >= MAYHEM_SEQ.length) {
      mayhemIdx = 0;
      // Unlock all weapons for all players
      for (const p of players) {
        for (let w = 2; w < p.inventory.length; w++) {
          if (p.inventory[w] === 0) {
            p.inventory[w] = 99;
          }
        }
      }
    }
  } else {
    mayhemIdx = e.code === MAYHEM_SEQ[0] ? 1 : 0;
  }
});

init();
