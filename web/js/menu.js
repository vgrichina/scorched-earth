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
// EXE: item list width = 0x50 (80px); left panel = getBtnX + BTN_W + right margin
// EXE: large mode start_x=12, item_w=80 → panel ends at x≈96; small=5+80+4=89
const BTN_W = 80;  // EXE: 0x50 — item list/button width (was 120 before)
function getLeftW()  { return (isSmallMode() ? 5 : 12) + BTN_W + 4; }
function getRightX() { return getLeftW() + 1; }

function isSmallMode() { return config.screenHeight <= 200; }
function getBtnX()   { return isSmallMode() ? 5 : 12; }   // EXE: small=5, large=12
function getRowH()   { return isSmallMode() ? 17 : 25; }  // EXE: DS:0x6316[font_sel]
function getStartY() { return isSmallMode() ? 5 : 15; }   // EXE: small=5, large=15
function getBtnH()   { return getRowH() - 2; }             // button height = row_h - 2 gap
// EXE: dialog item spacing — adds 5px at screenH >= 400px (shop analysis confirmed)
function getSubRowH() { return getScreenH() >= 400 ? 19 : 14; }
function getScreenW() { return config.screenWidth; }
function getScreenH() { return config.screenHeight; }

// Terrain preview frame (EXE: draw_flat_box at file 0x3D59B)
function getFrameX() { return getRightX(); }
function getFrameY() { return 6; }
function getFrameW() { return getScreenW() - 6 - getRightX(); }
// EXE: height = screenH - 37 (reduced to screenH - 51 if copyright overflows)
function getFrameH() { return getScreenH() - 37; }
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
      { label: '~Sound:', key: 'soundEnabled', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Flight Sounds:', key: 'flySoundEnabled', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
  hardware: {
    title: 'Hardware',
    items: [
      { label: '~Graphics Mode:', key: 'graphicsMode', min: 0, max: GRAPHICS_MODES.length - 1, step: 1,
        names: GRAPHICS_MODES.map(m => m.name) },
      { label: '~Bios Keyboard', key: null, fixed: 'N/A', disabled: true },
      { label: '~Small Memory', key: null, fixed: 'N/A', disabled: true },
      { label: '~Mouse Enabled', key: null, fixed: 'On', disabled: true },
      { label: '~Firing Delay:', key: null, fixed: 'N/A', disabled: true },
      { label: '~Hardware Delay:', key: null, fixed: 'N/A', disabled: true },
      { label: 'Falling ~Delay:', key: null, fixed: 'N/A', disabled: true },
      { label: '~Calibrate Joystick', key: null, fixed: 'N/A', disabled: true },
      { label: '~Fast Computers', key: null, fixed: 'N/A', disabled: true },
    ],
  },
  economics: {
    title: 'Economics',
    items: [
      { label: '~Interest Rate:', key: 'interest', min: 0, max: 50, step: 5, suffix: '%' },
      { label: '~Cash at Start:', key: 'startCash', min: 0, max: 10000000, step: 50000 },
      { label: 'Computers ~Buy', key: 'computersBuy', min: 0, max: 3, step: 1,
        names: ['Basic', 'Greedy', 'Erratic', 'Random'] },
      { label: '~Free Market', key: 'freeMarket', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Scoring Mode:', key: 'scoringMode', min: 0, max: 2, step: 1,
        names: ['Standard', 'Corporate', 'Vicious'] },
    ],
  },
  physics: {
    title: 'Physics',
    items: [
      { label: '~Air Viscosity:', key: 'viscosity', min: 0, max: 20, step: 1 },
      { label: '~Gravity:', key: 'gravity', min: 0.05, max: 10, step: 0.05, float: true },
      { label: '~Borders Extend:', key: 'edgesExtend', min: 0, max: 500, step: 5 },
      { label: '~Effect of Walls:', key: 'wallType', min: 0, max: 7, step: 1,
        names: ['None', 'Wrap-around', 'Padded', 'Rubber', 'Spring', 'Concrete', 'Random', 'Erratic'] },
      { label: '~Suspend Dirt:', key: 'suspendDirt', min: 0, max: 100, step: 5, suffix: '%' },
      { label: '~Sky:', key: 'skyType', min: 0, max: 6, step: 1,
        names: ['Plain', 'Shaded', 'Stars', 'Storm', 'Sunset', 'Black', 'Random'] },
      { label: '~Max. Wind:', key: 'wind', min: 0, max: 500, step: 5 },
      { label: '~Changing Wind', key: 'changeWind', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
  landscape: {
    title: 'Landscape',
    items: [
      { label: 'Land ~Type:', key: 'landType', min: 0, max: 6, step: 1,
        names: ['Flat', 'Slope', 'Rolling', 'Mountain', 'V-Shaped', 'Castle', 'Cavern'] },
      { label: '~Bumpiness:', key: 'land1', min: 0, max: 100, step: 5 },
      { label: 'S~lope:', key: 'land2', min: 0, max: 100, step: 5 },
      { label: '~Flatten Peaks', key: 'flattenPeaks', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Random Land', key: 'randomLand', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Percent Scanned Mountains:', key: 'mtnPercent', min: 0, max: 100, step: 5 },
    ],
  },
  playoptions: {
    title: 'Play Options',
    items: [
      { label: 'Ta~lking Tanks:', key: 'talkingTanks', min: 0, max: 2, step: 1, names: ['Off', 'Computers', 'All'] },
      { label: 'Talk ~Probability:', key: 'talkProbability', min: 0, max: 100, step: 10, suffix: '%' },
      { label: 'Tanks ~Fall', key: 'fallingTanks', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Impact Damage', key: 'impactDamage', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Arms Level:', key: 'armsLevel', min: 0, max: 4, step: 1 },
      { label: '~Bomb Icon:', key: 'bombIcon', min: 0, max: 2, step: 1,
        names: ['Small', 'Big', 'Invisible'] },
      { label: '~Tunneling', key: 'tunneling', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Scale:', key: 'explosionScale', min: 0, max: 2, step: 1,
        names: ['Small', 'Medium', 'Large'] },
      { label: 'Trace ~Paths', key: 'tracePaths', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Extra Dirt', key: 'extraDirt', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Useless Items', key: 'uselessItems', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Mode:', key: 'playMode', min: 0, max: 2, step: 1,
        names: ['Sequential', 'Simultaneous', 'Synchronous'] },
      { label: 'Play ~Order:', key: 'playOrder', min: 0, max: 4, step: 1,
        names: ['Random', 'Losers-First', 'Winners-First', 'Round-Robin', 'Sequential'] },
      { label: '~Teams:', key: 'teamMode', min: 0, max: 1, step: 1, names: ['None', 'On'] },
      { label: '~Hostile Environment', key: 'hostileEnvironment', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: 'Status ~Bar', key: 'statusBar', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
    ],
  },
  weapons: {
    title: 'Weapons',
    items: [
      { label: '~Arms Level:', key: 'armsLevel', min: 0, max: 4, step: 1 },
      { label: '~Bomb Icon:', key: 'bombIcon', min: 0, max: 2, step: 1,
        names: ['Small', 'Big', 'Invisible'] },
      { label: '~Tunneling', key: 'tunneling', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Scale:', key: 'explosionScale', min: 0, max: 2, step: 1,
        names: ['Small', 'Medium', 'Large'] },
      { label: 'Trace ~Paths', key: 'tracePaths', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Extra Dirt', key: 'extraDirt', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
      { label: '~Useless Items', key: 'uselessItems', min: 0, max: 1, step: 1, names: ['Off', 'On'] },
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

// Compute submenu dialog width from content (EXE dialog system computes width, not hardcoded)
function computeSubmenuWidth(sub) {
  const pad = 16; // 8px left + 8px right margin
  const gap = 6;  // min gap between label and value
  let w = measureText(sub.title) + pad;
  w = Math.max(w, measureText('ESC/Enter: Back') + pad);
  for (const item of sub.items) {
    const labelW = measureText(item.label);
    // Find widest possible value for this item
    let maxValW = 0;
    if (item.disabled) {
      maxValW = measureText(item.fixed);
    } else if (item.names) {
      for (const name of item.names) {
        maxValW = Math.max(maxValW, measureText(name));
      }
    } else {
      const suffix = item.suffix || '';
      const fmtVal = v => item.float ? v.toFixed(2) : String(v);
      maxValW = Math.max(
        measureText(fmtVal(item.min) + suffix),
        measureText(fmtVal(item.max) + suffix)
      );
    }
    w = Math.max(w, labelW + gap + maxValW + pad);
  }
  return w;
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
  return Math.floor((getScreenW() - 6 - getRightX() - tw) / 2) + getRightX();
}

// --- 3D box helpers with standard UI colors ---
function boxRaised(x, y, w, h) {
  // EXE draw_3d_box: outer TL=EF26(UI_DARK_BORDER=WHITE), inner TL=EF2E(UI_LIGHT_BORDER),
  //                 inner BR=EF30(UI_MED_BORDER), outer BR=EF32(UI_BRIGHT_BORDER)
  drawBox3DRaised(x, y, w, h, UI_BACKGROUND, UI_DARK_BORDER, UI_LIGHT_BORDER, UI_MED_BORDER, UI_BRIGHT_BORDER);
}
function boxSunken(x, y, w, h, fill) {
  // EXE draw_flat_box: Top=EF30(MED), Left=EF32(BRIGHT), Bottom=EF26(DARK), Right=EF2E(LIGHT)
  drawBox3DSunken(x, y, w, h, fill !== undefined ? fill : BLACK, UI_MED_BORDER, UI_BRIGHT_BORDER, UI_DARK_BORDER, UI_LIGHT_BORDER);
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
    const bx = getBtnX(), by = getStartY() + i * getRowH();
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

  // EXE: hotkey letters — extract char after '~' in label, match Key<X>
  // EXE dialog system handles this generically for all item lists
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const mi = MENU_ITEMS[i];
    const tildeIdx = mi.label.indexOf('~');
    if (tildeIdx >= 0 && tildeIdx + 1 < mi.label.length) {
      const hotkey = mi.label[tildeIdx + 1].toUpperCase();
      if (consumeKey('Key' + hotkey)) {
        menu.selectedOption = i;
        if (mi.type === 'spinner') {
          // For spinners, just select (user adjusts with arrows)
        } else {
          const result = activateMenuItem(mi);
          if (result) return result;
        }
        break;
      }
    }
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
          const midX = getBtnX() + BTN_W / 2;
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

  // EXE: hotkey letters — extract char after '~' in label, match Key<X>
  // EXE dialog system handles hotkeys generically for all submenu items
  for (let i = 0; i < sub.items.length; i++) {
    const si = sub.items[i];
    if (si.disabled) continue;
    const tildeIdx = si.label.indexOf('~');
    if (tildeIdx >= 0 && tildeIdx + 1 < si.label.length) {
      const hotkey = si.label[tildeIdx + 1].toUpperCase();
      if (consumeKey('Key' + hotkey)) {
        menu.submenuSelected = i;
        // Select + increment value (same as right-arrow)
        adjustValue(si, 1);
        break;
      }
    }
  }

  // Mouse: click items to select, left/right half to adjust value
  if (mouse.over && consumeClick(0)) {
    const rowH = getSubRowH();
    const dlgW = computeSubmenuWidth(sub);
    const dlgH = 30 + sub.items.length * rowH;
    const dlgX = Math.floor((getScreenW() - dlgW) / 2);
    const dlgY = Math.floor((getScreenH() - dlgH) / 2);

    // Check if click is inside dialog
    if (mouse.x >= dlgX && mouse.x < dlgX + dlgW && mouse.y >= dlgY && mouse.y < dlgY + dlgH) {
      // Hit-test items
      for (let i = 0; i < sub.items.length; i++) {
        const iy = dlgY + 18 + i * rowH;
        if (mouse.y >= iy - 1 && mouse.y < iy + rowH - 1) {
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
    if (consumeKey('ArrowRight')) setup.aiType = Math.min(AI_TYPE.SENTIENT, setup.aiType + 1);
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

  // Tab cycles fields (EXE: Tab key navigation between Name/Type)
  if (consumeKey('Tab')) menu.playerSetupField = (menu.playerSetupField + 1) % 2;
  if (consumeKey('ArrowUp')) menu.playerSetupField = Math.max(0, menu.playerSetupField - 1);
  if (consumeKey('ArrowDown')) menu.playerSetupField = Math.min(1, menu.playerSetupField + 1);

  if (consumeKey('Enter')) {
    menu.playerSetupIdx++;
    menu.playerSetupField = 0;
    if (menu.playerSetupIdx >= config.numPlayers) return 'start_game';
  }

  // Mouse: click name or AI field based on dialog layout
  if (mouse.over && consumeClick(0)) {
    const lay = getPlayerSetupLayout();
    if (mouse.x >= lay.dlgX && mouse.x < lay.dlgX + lay.dlgW) {
      if (mouse.y >= lay.nameFieldY - 2 && mouse.y < lay.nameFieldY + lay.fieldH) {
        menu.playerSetupField = 0;
      } else if (mouse.y >= lay.typeFieldY - 2 && mouse.y < lay.typeFieldY + lay.fieldH) {
        menu.playerSetupField = 1;
        // Left/right half adjusts AI type
        const midX = lay.dlgX + Math.floor(lay.dlgW / 2);
        if (mouse.x > midX) {
          setup.aiType = Math.min(AI_TYPE.SENTIENT, setup.aiType + 1);
        } else if (mouse.x > lay.valX - 10) {
          setup.aiType = Math.max(0, setup.aiType - 1);
        }
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
    const bx = getBtnX();
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
      // Label on left, value right-aligned (EXE: no < > arrows, just the value)
      drawText(bx + 4, textY, item.label, textColor);
      const valStr = String(config[item.key]);
      drawText(bx + BTN_W - measureText(valStr), textY, valStr, textColor);
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
  const embossLayers = 5;
  const embossShift = embossLayers - 1; // 4px total shift from layer 0 to layer 4
  const titleX = centerXRight(titleStr) - Math.floor(embossShift / 2); // center the full embossed width
  const titleY = isSmallMode() ? 2 : 11;   // EXE: Y=2 (small) / Y=11 (large)
  drawTextEmbossed(titleX, titleY, titleStr, [
    UI_DEEP_SHADOW, UI_BRIGHT_BORDER, UI_DARK_TEXT, UI_LIGHT_ACCENT, UI_DARK_BORDER
  ]);

  // 6. Subtitle "The Mother of All Games" (EXE: Y=27 small / Y=41 large)
  const subStr = 'The Mother of All Games';
  drawText(centerXRight(subStr), isSmallMode() ? 27 : 41, subStr, UI_DARK_TEXT);

  // 6b. "Registered Version" (EXE: Row 3, Y=52 small / Y=71 large)
  const regStr = 'Registered Version';
  drawText(centerXRight(regStr), isSmallMode() ? 52 : 71, regStr, UI_DARK_TEXT);

  // 7. Copyright at bottom of right panel
  // EXE: sprintf produces "1.50 Copyright (c) 1991-1995 Wendell Hicken",
  // split to two lines only if text_measure says it's too wide for the panel
  const copyFull = '1.50 Copyright (c) 1991-1995 Wendell Hicken';
  const panelW = getScreenW() - 6 - getRightX();
  if (measureText(copyFull) <= panelW) {
    drawText(centerXRight(copyFull), getScreenH() - 33, copyFull, UI_DARK_TEXT);
  } else {
    const copy1 = '1.50 Copyright (c) 1991-1995';
    const copy2 = 'Wendell Hicken';
    drawText(centerXRight(copy1), getScreenH() - 33, copy1, UI_DARK_TEXT);
    drawText(centerXRight(copy2), getScreenH() - 20, copy2, UI_DARK_TEXT);
  }

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
  // EXE: item spacing 14px; +5px at screenH >= 400
  const rowH = getSubRowH();
  const dlgW = computeSubmenuWidth(sub);
  const dlgH = 30 + itemCount * rowH;
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
    const iy = dlgY + 18 + i * rowH;
    const selected = i === menu.submenuSelected;
    const color = item.disabled ? UI_MED_BORDER : (selected ? UI_HIGHLIGHT : UI_DARK_TEXT);

    // Highlight bar
    if (selected && !item.disabled) {
      fillRect(dlgX + 3, iy - 1, dlgX + dlgW - 4, iy + rowH - 3, UI_DEEP_SHADOW);
    }

    drawText(dlgX + 8, iy, item.label, color);

    // Value right-aligned (EXE: no < > arrows, just the value)
    const valStr = formatValue(item);
    drawText(dlgX + dlgW - 8 - measureText(valStr), iy, valStr, color);
  }

  // Footer
  drawText(dlgX + 8, dlgY + dlgH - 12, 'ESC/Enter: Back', UI_MED_BORDER);
}

// --- Player setup dialog layout (EXE: dialog widget system, centered) ---
// EXE: player setup uses segment 0x3F19 dialog system with sunken input fields,
// spinner for AI type, Tab key navigation, centered on screen.
function getPlayerSetupLayout() {
  const rowH = isSmallMode() ? 16 : 22;
  const labelW = measureText('Type:') + 8;
  const inputW = measureText('WWWWWWWWWWWW_') + 8; // 12-char name + cursor + padding
  const footerW = measureText('Tab/Arrows:Field  L/R:Type  Enter  Esc') + 20;
  const dlgW = Math.max(labelW + inputW + 24, footerW, 180);
  const dlgH = rowH * 2 + 60; // title + separator + 2 fields + footer
  const dlgX = Math.floor((getScreenW() - dlgW) / 2);
  const dlgY = Math.floor((getScreenH() - dlgH) / 2);
  const fieldH = rowH + 2;
  const labelX = dlgX + 10;
  const valX = dlgX + 10 + labelW;
  const nameFieldY = dlgY + 26;
  const typeFieldY = nameFieldY + rowH + 6;
  return { dlgX, dlgY, dlgW, dlgH, rowH, labelX, valX, inputW, nameFieldY, typeFieldY, fieldH };
}

export function drawPlayerSetupScreen() {
  // Full-screen raised 3D background (EXE: dialog over raised base)
  boxRaised(0, 0, getScreenW(), getScreenH());

  const idx = menu.playerSetupIdx;
  if (idx >= config.numPlayers) return;

  const setup = playerSetup[idx];
  const baseColor = idx * PLAYER_PALETTE_STRIDE + PLAYER_COLOR_FULL;
  const lay = getPlayerSetupLayout();

  // Centered raised dialog box
  boxRaised(lay.dlgX, lay.dlgY, lay.dlgW, lay.dlgH);

  // Title: "Player N of M" centered in dialog, in player color
  const titleStr = `Player ${idx + 1} of ${config.numPlayers}`;
  const titleX = lay.dlgX + Math.floor((lay.dlgW - measureText(titleStr)) / 2);
  drawText(titleX, lay.dlgY + 5, titleStr, baseColor);
  hline(lay.dlgX + 4, lay.dlgX + lay.dlgW - 5, lay.dlgY + 17, UI_MED_BORDER);

  // Name field — label + sunken input box
  const nameSelected = menu.playerSetupField === 0;
  const nameColor = nameSelected ? UI_HIGHLIGHT : UI_DARK_TEXT;
  drawText(lay.labelX, lay.nameFieldY + 2, '~Name:', nameColor);
  // Sunken input field for name
  boxSunken(lay.valX, lay.nameFieldY, lay.inputW, lay.fieldH, UI_BACKGROUND);
  drawText(lay.valX + 3, lay.nameFieldY + 2, setup.name, baseColor);
  if (nameSelected) {
    // Blinking cursor
    if (Math.floor(menu.blinkTimer / 20) % 2 === 0) {
      drawText(lay.valX + 3 + measureText(setup.name), lay.nameFieldY + 2, '_', UI_HIGHLIGHT);
    }
  }

  // AI type field — label + value as spinner
  const aiSelected = menu.playerSetupField === 1;
  const aiColor = aiSelected ? UI_HIGHLIGHT : UI_DARK_TEXT;
  drawText(lay.labelX, lay.typeFieldY + 2, '~Type:', aiColor);
  const typeName = AI_NAMES[setup.aiType] || 'Human';
  // Sunken field for type value
  boxSunken(lay.valX, lay.typeFieldY, lay.inputW, lay.fieldH, UI_BACKGROUND);
  drawText(lay.valX + 3, lay.typeFieldY + 2, typeName, aiColor);

  // Footer: key hints
  const footerY = lay.dlgY + lay.dlgH - 13;
  hline(lay.dlgX + 4, lay.dlgX + lay.dlgW - 5, footerY - 4, UI_MED_BORDER);
  drawText(lay.dlgX + 8, footerY, 'Tab/Arrows:Field  L/R:Type  Enter  Esc', UI_MED_BORDER);
}

// Reset menu state when re-entering from game over / system menu
export function resetMenuState() {
  menu.screen = 'config';
  menu.activeSubmenu = null;
  menu.terrainDirty = true;
  menu.saveFlash = 0;
}
