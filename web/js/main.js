// Scorched Earth - Main entry point + game loop
// Phase 2: aim, fire, flight, crater, turns

import { config } from './config.js';
import { initFramebuffer, blit, setPixel } from './framebuffer.js';
import { initPalette } from './palette.js';
import { generateTerrain, drawSky, drawTerrain } from './terrain.js';
import { placeTanks, drawAllTanks, players } from './tank.js';
import { seedRandom } from './utils.js';
import { initInput } from './input.js';
import { drawHud } from './hud.js';
import { drawText, drawTextShadow } from './font.js';
import { projectile } from './physics.js';
import { gameTick, game, STATE, generateWind, getCurrentPlayer } from './game.js';

function init() {
  const canvas = document.getElementById('screen');
  initFramebuffer(canvas);

  initInput();
  seedRandom(Date.now());

  initPalette(config.landType, config.skyType);
  generateTerrain();
  generateWind();
  placeTanks(config.numPlayers);

  requestAnimationFrame(gameLoop);
}

function redrawWorld() {
  drawSky();
  drawTerrain();
  drawAllTanks();
}

function drawProjectile() {
  if (!projectile.active) return;

  // Draw trail
  const trail = projectile.trail;
  for (let i = Math.max(0, trail.length - 20); i < trail.length; i++) {
    const p = trail[i];
    const age = trail.length - i;
    if (p.x >= 0 && p.x < config.screenWidth && p.y >= 0 && p.y < config.screenHeight) {
      setPixel(p.x, p.y, age < 5 ? 199 : age < 10 ? 189 : 179);
    }
  }

  // Draw projectile head
  const hx = Math.round(projectile.x);
  const hy = Math.round(projectile.y);
  if (hx >= 0 && hx < config.screenWidth && hy >= 0 && hy < config.screenHeight) {
    setPixel(hx, hy, 199);
    setPixel(hx + 1, hy, 189);
    setPixel(hx - 1, hy, 189);
    setPixel(hx, hy + 1, 189);
    setPixel(hx, hy - 1, 189);
  }
}

function drawRoundOver() {
  const alive = players.filter(p => p.alive);
  if (alive.length === 1) {
    drawTextShadow(104, 90, alive[0].name + ' wins!', alive[0].index * 8 + 4, 0);
  } else {
    drawTextShadow(136, 90, 'Draw!', 150, 0);
  }
  drawTextShadow(72, 106, 'Press SPACE for new round', 150, 0);
}

function gameLoop() {
  // 1. Redraw clean world FIRST (no HUD) so gameTick reads clean pixels
  redrawWorld();

  // 2. Game logic — reads clean framebuffer for collisions/terrain scanning
  //    Explosion fire ring drawn here stays visible through blit
  gameTick();

  // 3. Overlays on top of game world
  const player = getCurrentPlayer();
  drawHud(player, game.wind);
  drawProjectile();

  if (game.state === STATE.ROUND_OVER) {
    drawRoundOver();
  }

  blit();

  requestAnimationFrame(gameLoop);
}

init();
