// Scorched Earth - Main Menu (EXE-faithful split-panel layout)
// EXE: main_menu() at file 0x3D140 (far address 0x34ED:0x1870)
// EXE: dialog system at segment 0x3F19, 3D box at 0x444BB, embossed title at 0x4CEFD
// EXE: small mode (320x200): row_height=17, start_y=5, font=1

import { config, saveConfig, GRAPHICS_MODES, applyGraphicsMode } from './config.js';
import { fillRect, hline, drawBox3DRaised, drawBox3DSunken, setPixel } from './framebuffer.js';
import { drawText, drawTextEmbossed, measureText, FONT_HEIGHT } from './font.js';
import { BLACK, initPalette } from './palette.js';
import { consumeKey, consumeClick, mouse } from './input.js';
import { AI_TYPE, AI_NAMES } from './ai.js';
import { generateTerrain, terrain, initSkyBackground, PLAYFIELD_TOP } from './terrain.js';
import { UI_HIGHLIGHT, UI_DARK_TEXT, UI_DARK_BORDER, UI_BACKGROUND,
         UI_LIGHT_ACCENT, UI_DEEP_SHADOW, UI_LIGHT_BORDER, UI_MED_BORDER,
         UI_BRIGHT_BORDER, PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         SKY_PAL_START, SKY_PAL_COUNT, TERRAIN_PAL_START, TERRAIN_PAL_COUNT
         } from './constants.js';

// --- Layout helpers (EXE-verified, mode-dependent) ---
// EXE at 0x3D161: if screenHeight <= 200 → small mode, else large mode
// EXE: DS:0x6316 row height table: [0]=25 (large), [1]=17 (small)
const LEFT_W = 128;     // left panel width (fits "Play Options..." + padding)
const RIGHT_X = LEFT_W + 1;  // right panel start
const BTN_X = 4;        // button left margin
const BTN_W = LEFT_W - 8;  // button width

function isSmallMode() { return config.screenHeight <= 200; }
function getRowH()   { return isSmallMode() ? 17 : 25; }  // EXE: DS:0x6316[font_sel]
function getStartY() { return isSmallMode() ? 5 : 15; }   // EXE: small=5, large=15
function getBtnH()   { return getRowH() - 2; }             // button height = row_h - 2 gap
function getScreenW() { return config.screenWidth; }
function getScreenH() { return config.screenHeight; }

// Terrain preview frame (EXE: draw_flat_box at file 0x3D59B)
function getFrameX() { return RIGHT_X; }
function getFrameY() { return 6; }
function getFrameW() { return getScreenW() - 6 - RIGHT_X; }
function getFrameH() { return getScreenH() - 37 - 6; }
// Interior (2px inset)
function getPrevX() { return getFrameX() + 2; }
function getPrevY() { return getFrameY() + 2; }
function getPrevW() { return getFrameW() - 4; }
function getPrevH() { return getFrameH() - 4; }

// --- Main menu items (EXE string table at DS:0x212C-0x2154) ---
// EXE string table at DS:0x212C-0x2154: labels include ~ for hotkey markers
const MENU_ITEMS = [
  { label: '~Start',           type: 'button',  action: 'start' },
  { label: '~Players:',        type: 'spinner', key: 'numPlayers', min: 2, max: 10, step: 1 },
  { label: '~Rounds:',         type: 'spinner', key: 'rounds', min: 1, max: 100, step: 1 },
  { label: 'S~ound...',        type: 'submenu', submenu: 'sound' },
  { label: '~Hardware...',     type: 'submenu', submenu: 'hardware' },
  { label: '~Economics...',    type: 'submenu', submenu: 'economics' },
  { label: '~Landscape...',    type: 'submenu', submenu: 'landscape' },
  { label: 'Ph~ysics...',      type: 'submenu', submenu: 'physics' },
  { label: 'Play Op~tions...', type: 'submenu', submenu: 'playoptions' },
  { label: '~Weapons...',      type: 'submenu', submenu: 'weapons' },
  { label: 'Save ~Changes',    type: 'button',  action: 'save' },
];

// --- Submenu definitions (EXE verified from RE doc) ---
const SUBMENUS = {
  sound: {
    title: 'Sound',
    items: [
      { label: 'Sound:', key: 'soundEnabled', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: 'Flight Sounds:', key: 'flySoundEnabled', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
  hardware: {
    title: 'Hardware',
    items: [
      { label: 'Graphics Mode:', key: 'graphicsMode', min: 0, max: GRAPHICS_MODES.length - 1, step: 1,
        names: GRAPHICS_MODES.map(m => m.name) },
      { label: 'BIOS Keyboard', key: null, fixed: 'N/A', disabled: true },
      { label: 'Small Memory', key: null, fixed: 'N/A', disabled: true },
      { label: 'Mouse Enabled', key: null, fixed: 'On', disabled: true },
    ],
  },
  economics: {
    title: 'Economics',
    items: [
      { label: 'Interest Rate:', key: 'interest', min: 0, max: 50, step: 5, suffix: '%' },
      { label: 'Cash at Start:', key: 'startCash', min: 0, max: 100000, step: 5000 },
      { label: 'Scoring Mode:', key: 'scoringMode', min: 0, max: 2, step: 1,
        names: ['Standard', 'Corporate', 'Vicious'] },
    ],
  },
  physics: {
    title: 'Physics',
    items: [
      { label: 'Air Viscosity:', key: 'viscosity', min: 0, max: 20, step: 1 },
      { label: 'Gravity:', key: 'gravity', min: 0.05, max: 10, step: 0.05, float: true },
      { label: 'Effect of Walls:', key: 'wallType', min: 0, max: 7, step: 1,
        names: ['None', 'Erratic', 'Random', 'Wrap', 'Padded', 'Rubber', 'Spring', 'Concrete'] },
      { label: 'Sky:', key: 'skyType', min: 0, max: 6, step: 1,
        names: ['Plain', 'Shaded', 'Stars', 'Storm', 'Sunset', 'Cavern', 'Black'] },
      { label: 'Max. Wind:', key: 'wind', min: 0, max: 20, step: 1 },
      { label: 'Changing Wind', key: 'changeWind', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
  landscape: {
    title: 'Landscape',
    items: [
      { label: 'Land Type:', key: 'landType', min: 0, max: 6, step: 1,
        names: ['Flat', 'Slope', 'Rolling', 'Mountain', 'V-Shaped', 'Castle', 'Cavern'] },
      { label: 'Bumpiness:', key: 'land1', min: 0, max: 100, step: 5 },
      { label: 'Slope:', key: 'land2', min: 0, max: 100, step: 5 },
      { label: 'Random Land', key: 'randomLand', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
  playoptions: {
    title: 'Play Options',
    items: [
      { label: 'Talking Tanks:', key: 'talkingTanks', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: 'Talk Prob.:', key: 'talkProbability', min: 0, max: 100, step: 10, suffix: '%' },
      { label: 'Tanks Fall', key: 'fallingTanks', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: 'Arms Level:', key: 'armsLevel', min: 0, max: 4, step: 1 },
      { label: 'Scale:', key: 'explosionScale', min: 0, max: 2, step: 1,
        names: ['Small', 'Medium', 'Large'] },
      { label: 'Trace Paths', key: 'tracePaths', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: 'Extra Dirt', key: 'extraDirt', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: 'Mode:', key: 'playMode', min: 0, max: 2, step: 1,
        names: ['Sequential', 'Simultaneous', 'Synchronous'] },
      { label: 'Play Order:', key: 'playOrder', min: 0, max: 3, step: 1,
        names: ['Sequential', 'Random', 'Losers First', 'Winners First'] },
      { label: 'Hostile Env.', key: 'hostileEnvironment', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
  weapons: {
    title: 'Weapons',
    items: [
      { label: 'Arms Level:', key: 'armsLevel', min: 0, max: 4, step: 1 },
      { label: 'Scale:', key: 'explosionScale', min: 0, max: 2, step: 1,
        names: ['Small', 'Medium', 'Large'] },
      { label: 'Trace Paths', key: 'tracePaths', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: 'Extra Dirt', key: 'extraDirt', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
};

// --- Menu state ---
export const menu = {
  screen: 'config',        // 'config' | 'player_setup' (no 'title' — EXE goes straight to menu)
  selectedOption: 0,       // main menu selected index
  activeSubmenu: null,     // null or submenu key string
  submenuSelected: 0,      // selected item within submenu
  terrainDirty: true,      // regenerate terrain preview
  playerSetupIdx: 0,
  playerSetupField: 0,
  blinkTimer: 0,
  saveFlash: 0,            // frames to show "Saved!" feedback
};

// --- Player setup ---
const DEFAULT_NAMES = [
  'Wolfgang', 'Gilligan', 'Cleopatra', 'Mussolini', 'Napolean',
  'Barbarella', 'Antoinette', 'Elizabeth', 'Persephone', 'Mata Hari',
];

export const playerSetup = [];

export function initPlayerSetup() {
  playerSetup.length = 0;
  for (let i = 0; i < config.numPlayers; i++) {
    playerSetup.push({
      name: DEFAULT_NAMES[i] || `Player ${i + 1}`,
      aiType: i === 0 ? AI_TYPE.HUMAN : AI_TYPE.SHOOTER,
    });
  }
}

// --- Helper: format a config value for display ---
function formatValue(item) {
  if (item.disabled) return item.fixed;
  const val = config[item.key];
  if (item.names) return item.names[val] || String(val);
  if (item.float) return val.toFixed(2);
  return String(val) + (item.suffix || '');
}

// --- Helper: adjust a config value ---
function adjustValue(item, dir) {
  if (item.disabled || !item.key) return;
  const step = item.step * dir;
  if (item.float) {
    config[item.key] = Math.round(Math.max(item.min, Math.min(item.max, config[item.key] + step)) * 100) / 100;
  } else {
    config[item.key] = Math.max(item.min, Math.min(item.max, config[item.key] + step));
  }
}

// --- Helper: center text X in right panel ---
function centerXRight(str) {
  const tw = measureText(str);
  return Math.floor((getScreenW() - 6 - RIGHT_X - tw) / 2) + RIGHT_X;
}

// --- 3D box helpers with standard UI colors ---
function boxRaised(x, y, w, h) {
  drawBox3DRaised(x, y, w, h, UI_BACKGROUND, UI_LIGHT_BORDER, UI_BRIGHT_BORDER, UI_MED_BORDER, UI_DARK_BORDER);
}
function boxSunken(x, y, w, h, fill) {
  drawBox3DSunken(x, y, w, h, fill !== undefined ? fill : BLACK, UI_DARK_BORDER, UI_MED_BORDER, UI_LIGHT_BORDER, UI_BRIGHT_BORDER);
}

// ======================================================================
// INPUT HANDLING
// ======================================================================

export function menuTick() {
  menu.blinkTimer++;
  if (menu.saveFlash > 0) menu.saveFlash--;

  switch (menu.screen) {
    case 'config':
      if (menu.activeSubmenu) return handleSubmenuInput();
      return handleMainMenuInput();
    case 'player_setup':
      return handlePlayerSetupInput();
  }
  return menu.screen;
}

// Hit-test: is mouse over a main menu button?
function hitTestMenuButton(mx, my) {
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const bx = BTN_X, by = getStartY() + i * getRowH();
    if (mx >= bx && mx < bx + BTN_W && my >= by && my < by + getBtnH()) return i;
  }
  return -1;
}

// Activate the currently selected menu item
function activateMenuItem(item) {
  if (item.type === 'button' && item.action === 'start') {
    saveConfig();
    initPlayerSetup();
    menu.screen = 'player_setup';
    menu.playerSetupIdx = 0;
    menu.playerSetupField = 0;
    return 'player_setup';
  }
  if (item.type === 'button' && item.action === 'save') {
    saveConfig();
    menu.saveFlash = 60;
  }
  if (item.type === 'submenu') {
    menu.activeSubmenu = item.submenu;
    menu.submenuSelected = 0;
  }
  return null;
}

function handleMainMenuInput() {
  if (consumeKey('ArrowUp')) {
    menu.selectedOption = (menu.selectedOption - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
  }
  if (consumeKey('ArrowDown')) {
    menu.selectedOption = (menu.selectedOption + 1) % MENU_ITEMS.length;
  }

  const item = MENU_ITEMS[menu.selectedOption];

  // Spinner adjustment (keyboard)
  if (item.type === 'spinner') {
    if (consumeKey('ArrowLeft')) {
      config[item.key] = Math.max(item.min, config[item.key] - item.step);
    }
    if (consumeKey('ArrowRight')) {
      config[item.key] = Math.min(item.max, config[item.key] + item.step);
    }
  }

  // Keyboard activate
  if (consumeKey('Enter') || consumeKey('Space')) {
    const result = activateMenuItem(item);
    if (result) return result;
  }

  // Mouse: hover to select, click to activate
  if (mouse.over) {
    const hit = hitTestMenuButton(mouse.x, mouse.y);
    if (hit >= 0) {
      menu.selectedOption = hit;
      if (consumeClick(0)) {
        const hitItem = MENU_ITEMS[hit];
        // For spinners, check left/right click region for value adjustment
        if (hitItem.type === 'spinner') {
          const midX = BTN_X + BTN_W / 2;
          if (mouse.x > midX) {
            config[hitItem.key] = Math.min(hitItem.max, config[hitItem.key] + hitItem.step);
          } else {
            config[hitItem.key] = Math.max(hitItem.min, config[hitItem.key] - hitItem.step);
          }
        } else {
          const result = activateMenuItem(hitItem);
          if (result) return result;
        }
      }
    } else {
      // Consume click outside buttons (don't let it bleed through)
      consumeClick(0);
    }
  }

  return 'config';
}

function handleSubmenuInput() {
  const sub = SUBMENUS[menu.activeSubmenu];
  if (!sub) { menu.activeSubmenu = null; return 'config'; }

  if (consumeKey('ArrowUp')) {
    menu.submenuSelected = (menu.submenuSelected - 1 + sub.items.length) % sub.items.length;
  }
  if (consumeKey('ArrowDown')) {
    menu.submenuSelected = (menu.submenuSelected + 1) % sub.items.length;
  }

  const item = sub.items[menu.submenuSelected];
  const prevSky = config.skyType;
  const prevLand = config.landType;
  const prevGfxMode = config.graphicsMode;

  if (consumeKey('ArrowLeft')) adjustValue(item, -1);
  if (consumeKey('ArrowRight')) adjustValue(item, 1);

  // Mouse: click items to select, left/right half to adjust value
  if (mouse.over && consumeClick(0)) {
    const dlgW = 220;
    const dlgH = 30 + sub.items.length * 14;
    const dlgX = Math.floor((getScreenW() - dlgW) / 2);
    const dlgY = Math.floor((getScreenH() - dlgH) / 2);

    // Check if click is inside dialog
    if (mouse.x >= dlgX && mouse.x < dlgX + dlgW && mouse.y >= dlgY && mouse.y < dlgY + dlgH) {
      // Hit-test items
      for (let i = 0; i < sub.items.length; i++) {
        const iy = dlgY + 18 + i * 14;
        if (mouse.y >= iy - 1 && mouse.y < iy + 10) {
          menu.submenuSelected = i;
          const clickedItem = sub.items[i];
          if (!clickedItem.disabled) {
            const midX = dlgX + dlgW / 2;
            adjustValue(clickedItem, mouse.x > midX ? 1 : -1);
          }
          break;
        }
      }
    } else {
      // Click outside dialog = close
      menu.activeSubmenu = null;
    }
  }

  // Mark terrain dirty if landscape/sky changed
  if (config.skyType !== prevSky || config.landType !== prevLand) {
    menu.terrainDirty = true;
  }

  // Apply graphics mode change — updates screenWidth/screenHeight
  if (config.graphicsMode !== prevGfxMode) {
    applyGraphicsMode();
  }

  if (consumeKey('Escape') || consumeKey('Enter') || consumeKey('Space')) {
    menu.activeSubmenu = null;
  }

  return 'config';
}

function handlePlayerSetupInput() {
  const setup = playerSetup[menu.playerSetupIdx];

  // AI type spinner (keyboard)
  if (menu.playerSetupField === 1) {
    if (consumeKey('ArrowLeft')) setup.aiType = Math.max(0, setup.aiType - 1);
    if (consumeKey('ArrowRight')) setup.aiType = Math.min(AI_TYPE.UNKNOWN, setup.aiType + 1);
  }

  // Name editing — handle typed characters and backspace
  if (menu.playerSetupField === 0) {
    if (consumeKey('Backspace')) {
      setup.name = setup.name.slice(0, -1);
    }
    // Check for typed printable characters via the key buffer
    for (let code = 65; code <= 90; code++) {  // A-Z
      const keyCode = 'Key' + String.fromCharCode(code);
      if (consumeKey(keyCode)) {
        if (setup.name.length < 12) {
          setup.name += String.fromCharCode(code);
        }
      }
    }
    for (let d = 0; d <= 9; d++) {
      if (consumeKey('Digit' + d)) {
        if (setup.name.length < 12) setup.name += String(d);
      }
    }
    if (consumeKey('Space') && setup.name.length < 12) {
      setup.name += ' ';
    }
  }

  if (consumeKey('ArrowUp')) menu.playerSetupField = Math.max(0, menu.playerSetupField - 1);
  if (consumeKey('ArrowDown')) menu.playerSetupField = Math.min(1, menu.playerSetupField + 1);

  if (consumeKey('Enter')) {
    menu.playerSetupIdx++;
    menu.playerSetupField = 0;
    if (menu.playerSetupIdx >= config.numPlayers) return 'start_game';
  }

  // Mouse: click name field (y~48) or AI field (y~66) to select
  if (mouse.over && consumeClick(0)) {
    if (mouse.y >= 42 && mouse.y < 58) {
      menu.playerSetupField = 0;
    } else if (mouse.y >= 58 && mouse.y < 78) {
      menu.playerSetupField = 1;
      // Left/right half adjusts AI type
      if (mouse.x > 160) {
        setup.aiType = Math.min(AI_TYPE.UNKNOWN, setup.aiType + 1);
      } else if (mouse.x > 80) {
        setup.aiType = Math.max(0, setup.aiType - 1);
      }
    }
  }

  if (consumeKey('Escape')) {
    menu.screen = 'config';
    return 'config';
  }

  return 'player_setup';
}

// ======================================================================
// RENDERING
// ======================================================================

// Generate terrain preview if needed
function ensureTerrainPreview() {
  if (!menu.terrainDirty) return;
  menu.terrainDirty = false;
  initPalette(config.landType, config.skyType);
  initSkyBackground();
  generateTerrain();
}

export function drawMainMenu() {
  ensureTerrainPreview();

  // 1. Full-screen raised 3D box background (EXE: file 0x3D59B step 1)
  boxRaised(0, 0, getScreenW(), getScreenH());

  // 2. Left panel: 11 buttons
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const item = MENU_ITEMS[i];
    const bx = BTN_X;
    const by = getStartY() + i * getRowH();
    const selected = i === menu.selectedOption && !menu.activeSubmenu;

    if (selected) {
      boxSunken(bx, by, BTN_W, getBtnH(), UI_BACKGROUND);
    } else {
      boxRaised(bx, by, BTN_W, getBtnH());
    }

    const textColor = selected ? UI_HIGHLIGHT : UI_DARK_TEXT;
    const textY = by + Math.floor((getBtnH() - FONT_HEIGHT) / 2);

    if (item.type === 'spinner') {
      // Label on left, value on right with arrows when selected
      drawText(bx + 4, textY, item.label, textColor);
      const valStr = String(config[item.key]);
      if (selected) {
        const arrowStr = '< ' + valStr + ' >';
        drawText(BTN_W - measureText(arrowStr), textY, arrowStr, textColor);
      } else {
        drawText(BTN_W - measureText(valStr), textY, valStr, textColor);
      }
    } else {
      // Center text in button
      const tx = bx + Math.floor((BTN_W - measureText(item.label)) / 2);
      drawText(tx, textY, item.label, textColor);
    }
  }

  // 3. Right panel: sunken terrain preview frame (EXE: draw_flat_box)
  boxSunken(getFrameX(), getFrameY(), getFrameW(), getFrameH(), BLACK);

  // 4. Render terrain preview inside frame
  drawTerrainPreview();

  // 5. Embossed title "Scorched Earth" (EXE: title_3d_text at 0x4CEFD)
  // EXE layers: deep_shadow(0,0), bright(1,1), dark(2,2), light(3,3), dark_border(4,4)
  const titleStr = 'Scorched Earth';
  const titleX = centerXRight(titleStr) - 2; // offset for emboss width
  const titleY = 2;
  drawTextEmbossed(titleX, titleY, titleStr, [
    UI_DEEP_SHADOW, UI_BRIGHT_BORDER, UI_DARK_TEXT, UI_LIGHT_ACCENT, UI_DARK_BORDER
  ]);

  // 6. Subtitle "The Mother of All Games" (EXE: plain text, Y=27 small mode)
  const subStr = 'The Mother of All Games';
  drawText(centerXRight(subStr), 27, subStr, UI_DARK_TEXT);

  // 7. Copyright at bottom of right panel (EXE: split across 2 lines in small mode)
  const copy1 = 'Copyright (c) 1991-1995';
  const copy2 = 'Wendell Hicken';
  drawText(centerXRight(copy1), getScreenH() - 33, copy1, UI_DARK_TEXT);
  drawText(centerXRight(copy2), getScreenH() - 20, copy2, UI_DARK_TEXT);

  // 8. Save feedback
  if (menu.saveFlash > 0) {
    drawText(centerXRight('Saved!'), getScreenH() - 46, 'Saved!', UI_HIGHLIGHT);
  }

  // 9. Submenu overlay (if active)
  if (menu.activeSubmenu) {
    drawSubmenu();
  }
}

function drawTerrainPreview() {
  // Map terrain[] (320 wide, heights in screen coords) into the preview area
  const playH = getScreenH() - PLAYFIELD_TOP;
  for (let cx = 0; cx < getPrevW(); cx++) {
    const tx = Math.floor(cx * getScreenW() / getPrevW());
    const terrainY = terrain[tx];
    // Scale terrain height into preview coordinates
    const scaledTerrainRow = Math.floor((terrainY - PLAYFIELD_TOP) * getPrevH() / playH);

    for (let cy = 0; cy < getPrevH(); cy++) {
      const px = getPrevX() + cx;
      const py = getPrevY() + cy;
      if (cy < scaledTerrainRow) {
        // Sky — map row to sky palette
        const screenRow = PLAYFIELD_TOP + Math.floor(cy * playH / getPrevH());
        const skyIdx = SKY_PAL_START + Math.floor(screenRow * (SKY_PAL_COUNT - 1) / (getScreenH() - 1));
        setPixel(px, py, skyIdx);
      } else {
        // Terrain — depth-based coloring
        const depth = getPrevH() - 1 - cy;
        const palIdx = TERRAIN_PAL_START + Math.floor(depth * (TERRAIN_PAL_COUNT - 1) / Math.max(getPrevH() - scaledTerrainRow, 1));
        setPixel(px, py, palIdx);
      }
    }
  }
}

function drawSubmenu() {
  const sub = SUBMENUS[menu.activeSubmenu];
  if (!sub) return;

  const itemCount = sub.items.length;
  // Size the dialog to fit contents
  const dlgW = 220;
  const dlgH = 30 + itemCount * 14;
  const dlgX = Math.floor((getScreenW() - dlgW) / 2);
  const dlgY = Math.floor((getScreenH() - dlgH) / 2);

  // Raised dialog box
  boxRaised(dlgX, dlgY, dlgW, dlgH);

  // Title bar
  const titleX = dlgX + Math.floor((dlgW - measureText(sub.title)) / 2);
  drawText(titleX, dlgY + 4, sub.title, UI_HIGHLIGHT);
  hline(dlgX + 4, dlgX + dlgW - 5, dlgY + 14, UI_MED_BORDER);

  // Items
  for (let i = 0; i < itemCount; i++) {
    const item = sub.items[i];
    const iy = dlgY + 18 + i * 14;
    const selected = i === menu.submenuSelected;
    const color = item.disabled ? UI_MED_BORDER : (selected ? UI_HIGHLIGHT : UI_DARK_TEXT);

    // Highlight bar
    if (selected && !item.disabled) {
      fillRect(dlgX + 3, iy - 1, dlgX + dlgW - 4, iy + 9, UI_DEEP_SHADOW);
    }

    drawText(dlgX + 8, iy, item.label, color);

    // Value on right side
    const valStr = formatValue(item);
    if (selected && !item.disabled) {
      const arrowStr = '< ' + valStr + ' >';
      drawText(dlgX + dlgW - 8 - measureText(arrowStr), iy, arrowStr, color);
    } else {
      drawText(dlgX + dlgW - 8 - measureText(valStr), iy, valStr, color);
    }
  }

  // Footer
  drawText(dlgX + 8, dlgY + dlgH - 12, 'ESC/Enter: Back', UI_MED_BORDER);
}

// --- Player setup screen (kept similar to original) ---
export function drawPlayerSetupScreen() {
  // Use 3D background
  boxRaised(0, 0, getScreenW(), getScreenH());

  const idx = menu.playerSetupIdx;
  if (idx >= config.numPlayers) return;

  const setup = playerSetup[idx];
  const baseColor = idx * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;

  // Title area
  const titleStr = 'PLAYER SETUP';
  drawText(Math.floor((getScreenW() - measureText(titleStr)) / 2), 8, titleStr, UI_HIGHLIGHT);
  hline(8, getScreenW() - 9, 18, UI_MED_BORDER);

  // Player indicator
  drawText(8, 28, `Player ${idx + 1} of ${config.numPlayers}`, baseColor);

  // Sunken fields area
  boxSunken(20, 42, getScreenW() - 40, 50, UI_BACKGROUND);

  // Name field
  const nameSelected = menu.playerSetupField === 0;
  const nameColor = nameSelected ? UI_HIGHLIGHT : UI_DARK_TEXT;
  drawText(28, 48, 'Name:', nameColor);
  drawText(80, 48, setup.name, baseColor);
  if (nameSelected) {
    // Blinking cursor
    if (Math.floor(menu.blinkTimer / 20) % 2 === 0) {
      drawText(80 + measureText(setup.name), 48, '_', UI_HIGHLIGHT);
    }
  }

  // AI type field
  const aiSelected = menu.playerSetupField === 1;
  const aiColor = aiSelected ? UI_HIGHLIGHT : UI_DARK_TEXT;
  drawText(28, 66, 'Type:', aiColor);
  const typeName = AI_NAMES[setup.aiType] || 'Human';
  if (aiSelected) {
    drawText(80, 66, '< ' + typeName + ' >', aiColor);
  } else {
    drawText(80, 66, typeName, aiColor);
  }

  // Instructions
  const footerY = getScreenH() - 24;
  hline(8, getScreenW() - 9, footerY - 4, UI_MED_BORDER);
  drawText(8, footerY, 'UP/DOWN:Field  L/R:Type  Type name', UI_DARK_TEXT);
  drawText(8, footerY + 10, 'ENTER:Next  ESC:Back', UI_DARK_TEXT);
}

// Reset menu state when re-entering from game over / system menu
export function resetMenuState() {
  menu.screen = 'config';
  menu.activeSubmenu = null;
  menu.terrainDirty = true;
  menu.saveFlash = 0;
}
