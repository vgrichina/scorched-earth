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
const { drawHud, drawWindIndicator, drawPlayfieldBorder } = await import(WEB + 'hud.js');
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
  drawPlayfieldBorder();
  drawHud(player, game.wind, game.round, {});
  drawWindIndicator(game.wind);
}

// ─── Render shop from emulator state JSON ────────────────────────────────

function renderShopFromState(stateJsonPath) {
  const state = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));

  // Set config from state
  config.numPlayers = state.numPlayers || 2;
  config.numRounds = state.numRounds || 10;
  if (state.armsLevel !== undefined) config.armsLevel = state.armsLevel;
  if (state.landType !== undefined) config.landType = state.landType;
  if (state.skyType !== undefined) config.skyType = state.skyType;
  initPalette(config.landType, config.skyType);

  // Create players and inject state from emulator checkpoint
  while (players.length < config.numPlayers) {
    players.push(createPlayer(players.length, `Player ${players.length + 1}`));
  }
  if (state.tanks) {
    for (let i = 0; i < state.tanks.length && i < players.length; i++) {
      const t = state.tanks[i];
      const p = players[i];
      p.x = t.x;
      p.y = t.y;
      p.alive = t.alive !== 0;
      if (t.name !== undefined) p.name = t.name;
      if (t.colorBase !== undefined) {
        p.colorBase = t.colorBase;
        p.colorIndex = Math.floor(t.colorBase / 8);
      }
      // Cash: EXE stores in bignum score system, not simple int.
      // At round 0 (first shop), cash = startCash. For later rounds,
      // use extracted value if non-zero, else fall back to startCash.
      if (t.cash !== undefined && t.cash > 0) {
        p.cash = t.cash;
      } else if (state.roundNumber === 0 || state.roundNumber === undefined) {
        p.cash = config.startCash;
      }
      if (t.inventory) {
        for (let w = 0; w < t.inventory.length && w < p.inventory.length; w++) {
          p.inventory[w] = t.inventory[w];
        }
      }
      if (t.selectedWeapon !== undefined) p.selectedWeapon = t.selectedWeapon;
      if (t.activeShield !== undefined) p.activeShield = t.activeShield;
      if (t.shieldEnergy !== undefined) p.shieldEnergy = t.shieldEnergy;
    }
  }

  // Compute rounds remaining
  const roundNumber = state.roundNumber || 0;
  const roundsLeft = Math.max(1, config.numRounds - roundNumber);

  // Open shop for player 0 and draw
  openShop(0, roundsLeft);
  game.state = STATE.SHOP;
  game.shopPlayerIdx = 0;
  drawShop(players[0]);
}

// ─── Render from emulator state JSON ─────────────────────────────────────

function renderFromState(stateJsonPath) {
  const state = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));

  // Set config from state and init base palette
  if (state.landType !== undefined) config.landType = state.landType;
  if (state.skyType !== undefined) config.skyType = state.skyType;
  initPalette(config.landType, config.skyType);

  // Inject EXE palette with index remapping:
  //   EXE: VGA 80 = terrain body (solid), VGA 120-149 = sky gradient
  //   Web: VGA 80-109 = sky gradient (30 entries), VGA 120-149 = terrain body
  // Also inject player colors (0-79), UI (150+), fire (170-199), etc.
  if (state.palette && state.palette.length === 256) {
    const pal = state.palette;
    // Player colors (0-79): same mapping in both EXE and web
    for (let i = 0; i < 80; i++) {
      paletteMod.setPaletteRgb(i, pal[i][0], pal[i][1], pal[i][2]);
    }
    // Sky: EXE VGA 120-149 → web VGA 80-109 (30 entries, 1:1 mapping)
    for (let i = 0; i < 30; i++) {
      paletteMod.setPaletteRgb(80 + i, pal[120 + i][0], pal[120 + i][1], pal[120 + i][2]);
    }
    // Terrain: EXE VGA 80 (solid ground color) → web VGA 120-149 (all same color)
    const gc = pal[80];
    for (let i = 0; i < 30; i++) {
      paletteMod.setPaletteRgb(120 + i, gc[0], gc[1], gc[2]);
    }
    // Wall color (150)
    paletteMod.setPaletteRgb(150, pal[150][0], pal[150][1], pal[150][2]);
    // Wind indicator (154)
    if (pal[154]) paletteMod.setPaletteRgb(154, pal[154][0], pal[154][1], pal[154][2]);
    // Fire palette (170-199)
    for (let i = 170; i < 200; i++) {
      paletteMod.setPaletteRgb(i, pal[i][0], pal[i][1], pal[i][2]);
    }
    paletteMod.updatePalette32();
  }

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
    // Inject tank positions and state
    for (let i = 0; i < state.tanks.length && i < players.length; i++) {
      const t = state.tanks[i];
      players[i].x = t.x;
      players[i].y = t.y;
      players[i].alive = t.alive !== 0;
      if (t.name !== undefined) players[i].name = t.name;
      players[i].turretAngle = t.turretAngle;
      players[i].power = t.power;
      players[i].angle = t.turretAngle || 0;
      if (t.selectedWeapon !== undefined) players[i].selectedWeapon = t.selectedWeapon;
      else if (t.weaponIdx !== undefined) players[i].selectedWeapon = t.weaponIdx;
      if (t.colorBase !== undefined) {
        players[i].colorBase = t.colorBase;
        players[i].colorIndex = Math.floor(t.colorBase / 8);
      }
    }
    drawAllTanks();
  }

  // Playfield border (EXE: draw_playfield_border 0x290A8)
  drawPlayfieldBorder();

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

if (fromStatePath && stateName === 'shop') {
  renderShopFromState(fromStatePath);
} else if (fromStatePath) {
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
