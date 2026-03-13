#!/usr/bin/env node
// Web port headless screenshot renderer.
// Imports the web modules in Node.js with minimal DOM stubs,
// ticks the game to a target state, and writes the framebuffer as PNG.
//
// Usage:
//   node disasm/web_screenshot.mjs menu /tmp/web_menu.png
//   node disasm/web_screenshot.mjs shop /tmp/web_shop.png
//   node disasm/web_screenshot.mjs game /tmp/web_game.png

import { createWriteStream, readFileSync } from 'fs';
import { PNG } from 'pngjs';

// ─── DOM stubs ───────────────────────────────────────────────────────────────
// Minimal fakes so the web modules can load without a browser.

const _listeners = {};
// Fake Canvas2D context — just enough for framebuffer.js fallback path
const fakeCtx = {
  createImageData(w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    return { data, width: w, height: h };
  },
  putImageData() {},
};

const fakeCanvas = {
  width: 320, height: 200,
  getContext(type) {
    if (type === '2d') return fakeCtx;
    return null;  // no WebGL
  },
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 200 }; },
  addEventListener() {},
  toBlob() {},
  style: {},
};

globalThis.document = {
  getElementById(id) {
    if (id === 'screen') return fakeCanvas;
    return null;
  },
  createElement() { return { href: '', download: '', click() {}, style: {} }; },
  documentElement: { style: { setProperty() {} } },
};

globalThis.window = globalThis;
globalThis.AudioContext = undefined;
globalThis.webkitAudioContext = undefined;
globalThis.requestAnimationFrame = () => {};
globalThis.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
};

// ─── Import web modules ──────────────────────────────────────────────────────

const WEB = new URL('../web/js/', import.meta.url).pathname;

const { config } = await import(WEB + 'config.js');
const { initPalette, palette32 } = await import(WEB + 'palette.js');
const fb = await import(WEB + 'framebuffer.js');
const { initSkyBackground, generateTerrain, loadMTNFiles, buildTerrainBitmap } = await import(WEB + 'terrain.js');
const { placeTanks, players, createPlayer } = await import(WEB + 'tank.js');
const { drawHud, drawWindIndicator } = await import(WEB + 'hud.js');
const { drawMainMenu, drawPlayerSetupScreen, menuTick, initPlayerSetup } = await import(WEB + 'menu.js');
const { game, STATE, initGameRound, generateWind } = await import(WEB + 'game.js');
const { isShopActive, drawShop, openShop } = await import(WEB + 'shop.js');
const { drawText } = await import(WEB + 'font.js');
const { seedRandom } = await import(WEB + 'utils.js');
const { drawAllTanks } = await import(WEB + 'tank.js');
const { blit, pixels, getWidth, getHeight } = fb;
const terrainMod = await import(WEB + 'terrain.js');
const paletteMod = await import(WEB + 'palette.js');

// ─── Init ────────────────────────────────────────────────────────────────────

const { GRAPHICS_MODES, applyGraphicsMode } = await import(WEB + 'config.js');
const { reinitFramebuffer } = fb;
const { reinitTerrainBuffers } = await import(WEB + 'terrain.js');

function initHeadless(modeIndex = 0) {
  // Set graphics mode before init
  if (modeIndex > 0 && modeIndex < GRAPHICS_MODES.length) {
    config.graphicsMode = modeIndex;
    applyGraphicsMode();
  }
  fakeCanvas.width = config.screenWidth;
  fakeCanvas.height = config.screenHeight;
  fb.initFramebuffer(fakeCanvas);
  if (modeIndex > 0) {
    reinitFramebuffer();
    reinitTerrainBuffers();
  }
  seedRandom(12345);  // deterministic
  initPalette(config.landType, config.skyType);
  initSkyBackground();
  game.state = STATE.CONFIG;
}

// ─── Render states ───────────────────────────────────────────────────────────

function renderMenu() {
  drawMainMenu();
}

function renderPlayerSetup() {
  drawMainMenu();
  initPlayerSetup();
  drawPlayerSetupScreen();
}

function renderShop() {
  config.numPlayers = 2;
  config.numRounds = 10;
  initPalette(config.landType, config.skyType);
  generateTerrain();
  placeTanks(config.numPlayers);
  openShop(0, config.numRounds);
  game.state = STATE.SHOP;
  game.shopPlayerIdx = 0;
  drawShop(players[0]);
}

function renderGame() {
  config.numPlayers = 2;
  config.numRounds = 10;
  initPalette(config.landType, config.skyType);
  initSkyBackground();
  // Terrain + tanks (placeTanks creates players)
  generateTerrain();
  placeTanks(config.numPlayers);
  generateWind();
  game.currentPlayer = 0;
  game.round = 1;
  game.state = STATE.AIM;

  // Draw the full game screen
  const { clearToBackground } = fb;
  if (clearToBackground) clearToBackground();
  drawAllTanks();
  const player = players[game.currentPlayer];
  drawHud(player, game.wind, game.round, {});
  drawWindIndicator(game.wind);
}

// ─── Render from emulator state JSON ─────────────────────────────────────

function renderFromState(stateJsonPath) {
  const state = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));

  // Use web port's own palette (from initPalette) — don't inject emulator palette.
  // The EXE and web port use different palette index assignments:
  //   EXE: terrain at ~80, sky at 120+
  //   Web: terrain at 120, sky at 80
  // Injecting emulator palette would cause color mismatch with web's index scheme.

  // Set config from state
  if (state.landType !== undefined) config.landType = state.landType;
  if (state.skyType !== undefined) config.skyType = state.skyType;
  initPalette(config.landType, config.skyType);
  initSkyBackground();

  // Inject terrain heights
  if (state.terrainHeights) {
    const w = Math.min(state.terrainHeights.length, terrainMod.terrain.length);
    for (let x = 0; x < w; x++) {
      terrainMod.terrain[x] = state.terrainHeights[x];
    }
  }

  // Build terrain bitmap from injected heights, then draw
  buildTerrainBitmap();
  terrainMod.drawSky();
  terrainMod.drawTerrain(getWidth());

  // Set up players from state
  if (state.tanks && state.tanks.length > 0) {
    config.numPlayers = state.numPlayers || state.tanks.length;
    // Create players if needed
    while (players.length < config.numPlayers) {
      players.push(createPlayer(players.length, `Player ${players.length + 1}`));
    }
    // Inject tank positions
    for (let i = 0; i < state.tanks.length && i < players.length; i++) {
      const t = state.tanks[i];
      players[i].x = t.x;
      players[i].y = t.y;
      players[i].alive = t.alive !== 0;
      players[i].turretAngle = t.turretAngle;
      players[i].power = t.power;
      if (t.colorBase !== undefined) players[i].colorBase = t.colorBase;
    }
    drawAllTanks();
  }

  // Set wind and draw HUD
  if (state.wind !== undefined) game.wind = state.wind;
  game.currentPlayer = 0;
  game.round = 1;
  game.state = STATE.AIM;
  const player = players[0] || { x: 0, y: 0, power: 100, turretAngle: 0, weaponIdx: 0, score: 0 };
  drawHud(player, game.wind, game.round, {});
  drawWindIndicator(game.wind);
}

// ─── Write PNG ───────────────────────────────────────────────────────────────

function writePNG(outPath) {
  const w = getWidth();
  const h = getHeight();
  const px = fb.pixels;
  const png = new PNG({ width: w, height: h });

  for (let i = 0; i < w * h; i++) {
    const c = palette32[px[i]];
    // palette32 is ABGR on little-endian: byte0=R, byte1=G, byte2=B, byte3=A
    png.data[i * 4 + 0] = c & 0xFF;          // R
    png.data[i * 4 + 1] = (c >> 8) & 0xFF;   // G
    png.data[i * 4 + 2] = (c >> 16) & 0xFF;  // B
    png.data[i * 4 + 3] = 255;                // A
  }

  const stream = createWriteStream(outPath);
  png.pack().pipe(stream);
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

// Parse args: state output.png [--mode N] [--from-state state.json]
const args = process.argv.slice(2);
let stateName = null, outPath = null, modeIndex = 4, fromStatePath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode') { modeIndex = parseInt(args[++i]); }
  else if (args[i] === '--from-state') { fromStatePath = args[++i]; }
  else if (!stateName) { stateName = args[i]; }
  else if (!outPath) { outPath = args[i]; }
}

if (!stateName || !outPath) {
  console.error('Usage: node disasm/web_screenshot.mjs <menu|shop|game> <output.png> [--mode N] [--from-state state.json]');
  process.exit(1);
}

initHeadless(modeIndex);

if (fromStatePath) {
  renderFromState(fromStatePath);
} else {
  switch (stateName) {
    case 'menu':
      renderMenu();
      break;
    case 'player':
    case 'player_setup':
      renderPlayerSetup();
      break;
    case 'shop':
      renderShop();
      break;
    case 'game':
      renderGame();
      break;
    default:
      console.error(`Unknown state: ${stateName}. Use menu, shop, or game.`);
      process.exit(1);
  }
}

await writePNG(outPath);
console.log(`Written ${outPath} (${getWidth()}x${getHeight()})`);
