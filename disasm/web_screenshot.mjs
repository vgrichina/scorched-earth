#!/usr/bin/env node
// Web port headless screenshot renderer.
// Imports the web modules in Node.js with minimal DOM stubs,
// ticks the game to a target state, and writes the framebuffer as PNG.
//
// Usage:
//   node disasm/web_screenshot.mjs menu /tmp/web_menu.png
//   node disasm/web_screenshot.mjs shop /tmp/web_shop.png
//   node disasm/web_screenshot.mjs game /tmp/web_game.png

import { createWriteStream, readFileSync, writeFileSync } from 'fs';
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
  _writes: 0,
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); this._writes++; },
};

// ─── Import web modules ──────────────────────────────────────────────────────

const WEB = new URL('../web/js/', import.meta.url).pathname;

const { config } = await import(WEB + 'config.js');
const { setResolvedWallType } = await import(WEB + 'physics.js');
const { initPalette, palette32 } = await import(WEB + 'palette.js');
const fb = await import(WEB + 'framebuffer.js');
const { initSkyBackground, generateTerrain, loadMTNFiles, buildTerrainBitmap } = await import(WEB + 'terrain.js');
const { placeTanks, players, createPlayer } = await import(WEB + 'tank.js');
const { drawHud, drawWindIndicator, drawPlayfieldBorder } = await import(WEB + 'hud.js');
const { drawMainMenu, generateMenuPreviewTerrain, drawPlayerSetupScreen, menuTick, initPlayerSetup, menu, playerSetup } = await import(WEB + 'menu.js');
const { game, STATE, initGameRound, generateWind } = await import(WEB + 'game.js');
const { isShopActive, drawShop, openShop, selectShopCategory, shopTick } = await import(WEB + 'shop.js');
const { drawText } = await import(WEB + 'font.js');
const {getTeamScore,resetTeamScores}=await import(WEB+'team-scoring.js');
const {mouse,initInput}=await import(WEB+'input.js');
const { seedRandom, getRandomState } = await import(WEB + 'utils.js');
const { drawAllTanks } = await import(WEB + 'tank.js');
const { blit, pixels, getWidth, getHeight } = fb;
const terrainMod = await import(WEB + 'terrain.js');
const paletteMod = await import(WEB + 'palette.js');

// ─── Init ────────────────────────────────────────────────────────────────────

const { GRAPHICS_MODES, applyGraphicsMode } = await import(WEB + 'config.js');
const { reinitFramebuffer } = fb;
const { reinitTerrainBuffers } = await import(WEB + 'terrain.js');

function initHeadless(modeIndex = config.graphicsMode) {
  // Set graphics mode before init
  if (modeIndex >= 0 && modeIndex < GRAPHICS_MODES.length) {
    config.graphicsMode = modeIndex;
    applyGraphicsMode();
  }
  fakeCanvas.width = config.screenWidth;
  fakeCanvas.height = config.screenHeight;
  fb.initFramebuffer(fakeCanvas);
  if (modeIndex >= 0) {
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

function renderMenuFromState(stateJsonPath) {
  const state = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));
  menu.activeSubmenu = state.activeSubmenu ?? null;
  menu.configDirty = state.configDirty ?? false;
  for(const key of ['interest','startCash','computersBuy','freeMarket','scoringMode'])if(state[key]!==undefined)config[key]=state[key];
  if(state.soundEnabled!==undefined)config.soundEnabled=state.soundEnabled;
  if(state.flySoundEnabled!==undefined)config.flySoundEnabled=state.flySoundEnabled;
  config.numPlayers = state.numPlayers;
  config.rounds = state.numRounds;
  if (state.landType !== undefined) config.landType = state.landType;
  if (state.skyType !== undefined) config.skyType = state.skyType;
  if (state.wallType !== undefined) config.wallType = state.wallType;
  if (state.resolvedWallType !== undefined) setResolvedWallType(state.resolvedWallType);
  if (state.menuPreviewSeed !== undefined) {
    seedRandom(state.menuPreviewSeed);
    menu.terrainDirty = true;
    drawMainMenu();
    return;
  }
  if (state.seed !== undefined) seedRandom(state.seed);
  initPalette(config.landType, config.skyType);
  // Inject EXE palette if available
  if (state.palette && state.palette.length === 256) {
    const pal = state.palette;
    for (let i = 0; i < 80; i++) {
      paletteMod.setPaletteRgb(i, pal[i][0], pal[i][1], pal[i][2]);
    }
    for (let i = 0; i < 30; i++) {
      paletteMod.setPaletteRgb(80 + i, pal[120 + i][0], pal[120 + i][1], pal[120 + i][2]);
    }
    const gc = pal[80];
    for (let i = 0; i < 30; i++) {
      paletteMod.setPaletteRgb(120 + i, gc[0], gc[1], gc[2]);
    }
    paletteMod.setPaletteRgb(150, pal[150][0], pal[150][1], pal[150][2]);
    if (pal[154]) paletteMod.setPaletteRgb(154, pal[154][0], pal[154][1], pal[154][2]);
    for (let i = 170; i < 200; i++) {
      paletteMod.setPaletteRgb(i, pal[i][0], pal[i][1], pal[i][2]);
    }
    // UI palette including cyan hotkey color (151-161)
    for (let i = 151; i <= 161; i++) {
      paletteMod.setPaletteRgb(i, pal[i][0], pal[i][1], pal[i][2]);
    }
    paletteMod.updatePalette32();
  }
  initSkyBackground();

  // Inject terrain heights from EMU checkpoint — skip ensureTerrainPreview
  if (state.menuTerrainSeed !== undefined) {
    menu.terrainDirty = false;
    seedRandom(state.menuTerrainSeed);
    generateMenuPreviewTerrain();
  } else if (state.terrainHeights) {
    menu.terrainDirty = false;  // prevent regeneration
    const w = Math.min(state.terrainHeights.length, terrainMod.terrain.length);
    for (let x = 0; x < w; x++) {
      terrainMod.terrain[x] = state.terrainHeights[x];
    }
    buildTerrainBitmap();
  }
  drawMainMenu();
}

function renderPlayerSetup() {
  drawMainMenu();
  initPlayerSetup();
  drawPlayerSetupScreen();
}

function renderPlayerSetupFromState(stateJsonPath) {
  const state = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));
  config.numPlayers = state.numPlayers;
  initPlayerSetup();
  menu.playerSetupIdx = state.currentPlayer ?? 0;
  for (let i = 0; i < playerSetup.length; i++) {
    const tank = state.tanks?.[i];
    if (tank?.name !== undefined) playerSetup[i].name = tank.name;
    if (tank?.colorBase !== undefined) playerSetup[i].colorIndex = Math.floor(tank.colorBase / 8);
  }
  if (state.playerSetup) {
    const current = playerSetup[menu.playerSetupIdx];
    current.name = state.playerSetup.name;
    current.editName = state.playerSetup.editName;
    current.doneEnabled = state.playerSetup.doneEnabled;
    current.cursorX = state.playerSetup.cursorX;
    current.tankType = state.playerSetup.tankType;
    current.aiType = state.playerSetup.human ? 0 : state.playerSetup.aiType;
  }
  if (state.palette?.length === 256) {
    state.palette.forEach((rgb, i) => paletteMod.setPaletteRgb(i, ...rgb));
    paletteMod.updatePalette32();
  }
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

  config.suspendDirt=state.suspendDirt??0;
  config.uselessItems=state.uselessItems??0;
  config.tracePaths=state.tracePaths??0;
  config.fallingTanks=state.fallingTanks??1;
  config.tunneling=state.tunneling??1;
  config.playMode=state.playMode??0;
  config.teamMode=state.teamMode??0;
  config.statusBar=state.statusBar??1;
  resetTeamScores();
  state.teams?.forEach((team,i)=>Object.assign(getTeamScore(i),team));
  // Set config from state
  config.numPlayers = state.numPlayers || 2;
  config.numRounds = state.numRounds || 10;
  config.rounds = config.numRounds;
  if (state.armsLevel !== undefined) config.armsLevel = state.armsLevel;
  if (state.landType !== undefined) config.landType = state.landType;
  if (state.skyType !== undefined) config.skyType = state.skyType;
  if (state.wallType !== undefined) config.wallType = state.wallType;
  if (state.resolvedWallType !== undefined) setResolvedWallType(state.resolvedWallType);
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
      if(t.cash==null||t.earnedInterest==null)throw new Error('Shop checkpoint lacks initialized cash/interest');
      p.cash=t.cash;p.earnedInterest=t.earnedInterest;p.team=t.team;
      if (t.inventory) {
        for (let w = 0; w < t.inventory.length && w < p.inventory.length; w++) {
          if (w + 2 < p.inventory.length) p.inventory[w + 2] = t.inventory[w];
        }
      }
      if (t.selectedWeapon !== undefined) p.selectedWeapon = t.selectedWeapon;
      if (t.activeShield !== undefined) p.activeShield = t.activeShield;
      if (t.shieldEnergy !== undefined) p.shieldEnergy = t.shieldEnergy;
      if (t.fuelEnergy !== undefined) p.fuelEnergy = t.fuelEnergy;
    }
  }

  // Compute rounds remaining
  const roundNumber = state.roundNumber || 0;
  const roundsLeft = Math.max(1, config.numRounds - roundNumber);

  // Use the active tank from the checkpoint for subsequent shoppers.
  const playerIndex = state.currentPlayer ?? 0;
  // --state shop denotes the visible shop, after any privacy prompt.
  openShop(playerIndex, roundsLeft, { showPrivacy: false });
  selectShopCategory(state.shopCategory??0,state.shopSelectedItem??0,state.shopScrollOffset??0);
  game.state = STATE.SHOP;
  game.shopPlayerIdx = playerIndex;
  if(shopInputs.length){
    globalThis.addEventListener=(type,handler)=>{_listeners[type]=handler;};
    initInput(fakeCanvas);
    for(const input of shopInputs){
      if(Array.isArray(input)){
        Object.assign(mouse,{x:input[0],y:input[1],over:true,clicked:input[2]??1,buttons:input[2]??1});
        shopTick(players[playerIndex]);mouse.buttons=0;shopTick(players[playerIndex]);
      }else{
        const alt=input.startsWith('Alt+'),code=alt?input.slice(4):input;
        if(alt)_listeners.keydown({code:'AltLeft',key:'Alt',preventDefault(){}});
        _listeners.keydown({code,key:code,preventDefault(){}});
        shopTick(players[playerIndex]);
        _listeners.keyup({code,preventDefault(){}});
        if(alt)_listeners.keyup({code:'AltLeft',preventDefault(){}});
      }
    }
  }
  // Match the checkpoint's animated DAC phase, just as menu/game captures do.
  if (state.palette) {
    for (let i = 0; i < 256; i++) paletteMod.setPaletteRgb(i, ...state.palette[i]);
  }
  drawShop(players[playerIndex]);
}

// ─── Render from emulator state JSON ─────────────────────────────────────

function renderFromState(stateJsonPath) {
  const state = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));

  // Set config from state and init base palette
  if (state.landType !== undefined) config.landType = state.landType;
  if (state.skyType !== undefined) config.skyType = state.skyType;
  if (state.wallType !== undefined) config.wallType = state.wallType;
  if (state.resolvedWallType !== undefined) setResolvedWallType(state.resolvedWallType);
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
      players[i].tankType = t.tankType;
      for (const key of ['direction', 'barrelXOff', 'barrelYOff', 'barrelEndX', 'barrelEndY'])
        players[i][key] = t[key];
      if (t.inventory) {
        players[i].inventory.fill(0);
        for (let w = 0; w < t.inventory.length && w + 2 < players[i].inventory.length; w++)
          players[i].inventory[w + 2] = t.inventory[w];
      }
      players[i].shieldEnergy = t.shieldEnergy ?? 0;
      players[i].shieldMaxEnergy = t.shieldMaxEnergy;
      players[i].shieldWeapon = t.shieldWeaponIdx >= 0 ? t.shieldWeaponIdx + 2 : -1;
      players[i].guidanceWeapon = (t.guidanceWeaponIdx ?? 32) + 2;
      players[i].angle = t.turretAngle || 0;
      if (t.selectedWeapon !== undefined) players[i].selectedWeapon = t.selectedWeapon + 2;
      else if (t.weaponIdx !== undefined) players[i].selectedWeapon = t.weaponIdx + 2;
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
  game.currentPlayer = state.currentPlayer ?? 0;
  game.round = 1;
  game.state = STATE.AIM;
  const player = players[game.currentPlayer] || { x: 0, y: 0, power: 100, turretAngle: 0, weaponIdx: 0, score: 0 };
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
let stateName = null, outPath = null, modeIndex = 4, fromStatePath = null, rngOutputPath = null, menuOutputPath = null, storageOutputPath = null, shopInputs = [], menuInputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode') { modeIndex = parseInt(args[++i]); }
  else if (args[i] === '--shop-click') { shopInputs.push(args[++i].split(',').map(Number)); }
  else if (args[i] === '--shop-key') { shopInputs.push(args[++i]); }
  else if (args[i] === '--menu-click') { menuInputs.push(args[++i].split(',').map(Number)); }
  else if (args[i] === '--menu-key') { menuInputs.push(args[++i]); }
  else if (args[i] === '--from-state') { fromStatePath = args[++i]; }
  else if (args[i] === '--storage-output') { storageOutputPath = args[++i]; }
  else if (args[i] === '--menu-output') { menuOutputPath = args[++i]; }
  else if (args[i] === '--rng-output') { rngOutputPath = args[++i]; }
  else if (!stateName) { stateName = args[i]; }
  else if (!outPath) { outPath = args[i]; }
}

if (!stateName || !outPath) {
  console.error('Usage: node disasm/web_screenshot.mjs <menu|shop|game> <output.png> [--mode N] [--from-state state.json]');
  process.exit(1);
}

if (fromStatePath) {
  const state = JSON.parse(readFileSync(fromStatePath, 'utf-8'));
  modeIndex = GRAPHICS_MODES.findIndex(mode => mode.w === state.width && mode.h === state.height);
  if (modeIndex < 0) throw new Error(`Unsupported checkpoint resolution ${state.width}x${state.height}`);
}
initHeadless(modeIndex);

if (fromStatePath && stateName === 'shop') {
  renderShopFromState(fromStatePath);
} else if (fromStatePath && stateName === 'menu') {
  renderMenuFromState(fromStatePath);
} else if (fromStatePath && ['player', 'player_setup'].includes(stateName)) {
  renderPlayerSetupFromState(fromStatePath);
} else if (fromStatePath && stateName === 'game') {
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

if(menuInputs.length) {
  globalThis.addEventListener=(type,handler)=>{_listeners[type]=handler;};
  initInput({addEventListener(){}});
  for(const input of menuInputs) {
    if(Array.isArray(input)) {
      mouse.x=input[0];mouse.y=input[1];mouse.over=true;mouse.clicked=input[2]??1;
      menuTick();
    } else {
      _listeners.keydown({code:input,key:input,preventDefault(){}});
      menuTick();
      _listeners.keyup({code:input,preventDefault(){}});
    }
  }
  drawMainMenu();
}
if(storageOutputPath)writeFileSync(storageOutputPath,JSON.stringify({writes:localStorage._writes,data:localStorage._data}));
if(menuOutputPath)writeFileSync(menuOutputPath,JSON.stringify({soundEnabled:config.soundEnabled,flySoundEnabled:config.flySoundEnabled,configDirty:menu.configDirty}));
await writePNG(outPath);
if (rngOutputPath) writeFileSync(rngOutputPath, JSON.stringify(getRandomState()));
console.log(`Written ${outPath} (${getWidth()}x${getHeight()})`);
