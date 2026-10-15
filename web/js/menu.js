// Scorched Earth - Main Menu (EXE-faithful split-panel layout)
// EXE: main_menu() at file 0x3D140 (far address 0x34ED:0x1870)
// EXE: dialog system at segment 0x3F19, 3D box at 0x444BB, embossed title at 0x4CEFD
// EXE: small mode (320x200): row_height=17, start_y=5, font=1

import { config, saveConfig, GRAPHICS_MODES, getUIBorderHeight, getUIButtonHeight } from './config.js';
import { fillRect, hline, vline, drawBox3DRaised, drawBox3DSunken, setPixel } from './framebuffer.js';
import { drawText, drawTextEmbossed, measureText, FONT_HEIGHT } from './font.js';
import { BLACK, initPalette, getPlayerColor, setPaletteRgb, updatePalette32 } from './palette.js';
import { consumeKey, consumeClick, consumeTextInput, isKeyDown, mouse } from './input.js';
import { TANK_TYPES, players, createUninitializedPlayer } from './tank.js';
import { drawUIIcon, drawIconSlider } from './hud.js';
import { bresenhamLine, random } from './utils.js';
import { AI_TYPE, AI_NAMES } from './ai.js';
import { randomComputerName, resolveDuplicateComputerNames } from './player-names.js';
import { generateMenuTerrain, terrain } from './terrain.js';
import { prepareExplosionTexture } from './explosion-texture.js';
import { UI_HIGHLIGHT, UI_DARK_TEXT, UI_DARK_BORDER, UI_BACKGROUND,
         UI_LIGHT_ACCENT, UI_DEEP_SHADOW, UI_LIGHT_BORDER, UI_MED_BORDER,
         UI_BRIGHT_BORDER, PLAYER_PALETTE_STRIDE, PLAYER_COLOR_FULL,
         SKY_PAL_START, SKY_PAL_COUNT, TERRAIN_PAL_START
         } from './constants.js';

// --- Layout helpers (EXE-verified, mode-dependent) ---
// EXE at 0x3D161: if screenHeight <= 200 → small mode, else large mode
// EXE: DS:0x6316 row height table: [0]=25 (large), [1]=17 (small)
// EXE: item list width = 0x50 (80px); terrain frame x = dialog.x1 + max(item.x+w-1) + getBtnX
// EXE: terrain_frame_x follows the widest auto-sized menu button plus the margins.
const BTN_W = 80;  // EXE: 0x50 — item list/button width
function getLeftW()  { return 2 * getBtnX() + Math.max(BTN_W, ...MENU_ITEMS.filter(i => i.type !== 'spinner').map(i => measureText(i.label) + 12)) - 2; }  // terrain_frame_x - 1
function getRightX() { return getLeftW() + 1; }  // terrain_frame_x

function isSmallMode() { return config.screenHeight <= 200; }
function getBtnX()   { return isSmallMode() ? 5 : 12; }   // EXE: small=5, large=12
function getRowH()   { return isSmallMode() ? 17 : 25; }  // EXE: DS:0x6316[font_sel]
function getStartY() { return isSmallMode() ? 5 : 15; }   // EXE: small=5, large=15
function getBtnH()   { return getUIButtonHeight(); }  // EXE: dialog_create_button auto-height at file 0x48755
// EXE: submenu item pitch 15px ([bp-0x0A]=15 at 0x3BA92; items at y=5,20,35,50...n*15+5)
function getSubRowH() { return 15; }
function getScreenW() { return config.screenWidth; }
function getScreenH() { return config.screenHeight; }

// Terrain preview frame (EXE: draw_flat_box at file 0x3D59B)
function getFrameX() { return getRightX(); }
function getFrameY() { return 6; }
function getFrameW() { return getScreenW() - 6 - getRightX(); }
// Native 0x3D53B..0x3D586 reserves 14 extra rows when copyright wraps.
function getFrameH() {
  const wraps = measureText('Copyright (c) 1991-1995 Wendell Hicken') > getScreenW() - 1 - getRightX() - 10;
  return getScreenH() - (wraps ? 56 : 42);
}
// Interior (1px inset)
function getPrevX() { return getFrameX() + 1; }
function getPrevY() { return getFrameY() + 1; }
function getPrevW() { return getFrameW() - 2; }
function getPrevH() { return getFrameH() - 2; }

// --- Main menu items (EXE string table at DS:0x212C-0x2154) ---
// EXE string table at DS:0x212C-0x2154: labels include ~ for hotkey markers
const MENU_ITEMS = [
  { label: '~Start',           type: 'button',  action: 'start' },
  { label: '~Players:',        type: 'spinner', key: 'numPlayers', min: 2, max: 10, step: 1 },
  { label: '~Rounds:',         type: 'spinner', key: 'rounds', min: 1, max: 100, step: 1 },
  { label: 'S~ound...',        type: 'submenu', submenu: 'sound' },
  { label: '~Hardware...',     type: 'submenu', submenu: 'hardware' },
  { label: '~Economics...',    type: 'submenu', submenu: 'economics' },
  { label: 'Ph~ysics...',      type: 'submenu', submenu: 'physics' },
  { label: '~Landscape...',    type: 'submenu', submenu: 'landscape' },
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
      { label: '~Flight Sounds:', key: 'flySoundEnabled', min: 0, max: 2, step: 1, names: ['Off', 'Vel', 'Pos'] },
    ],
  },
  hardware: {
    title: 'Hardware',
    items: [
      { label: '~Graphics Mode:', key: 'graphicsMode', min: 0, max: GRAPHICS_MODES.length - 1, step: 1,
        names: GRAPHICS_MODES.map(m => m.name) },
      { label: '~Bios Keyboard', key: 'biosKeyboard', checkbox: true, min: 0, max: 1, step: 1 },
      { label: '~Small Memory', key: 'smallMemory', checkbox: true, min: 0, max: 1, step: 1 },
      { label: '~Pointer:', key: null, fixed: 'None', disabled: true },
      { label: '~Mouse Rate:', key: null, fixed: '0.0', disabled: true },
      { label: '~Firing Delay:', key: 'firingDelay', min: 0, max: 500, step: 5 },
      { label: 'Falling ~Delay:', key: 'fallingDelay', grouped: true, min: 0, max: 1000, step: 5 },
    ],
  },
  economics: {
    title: 'Economics',
    items: [
      { label: '~Interest Rate:', key: 'interest', min: 0, max: 30, step: 1, rate: true },
      { label: '~Cash at Start:', key: 'startCash', min: 0, max: 1000000, step: 5000, cash: true },
      { label: 'Computers ~Buy', key: 'computersBuy', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Free Market', key: 'freeMarket', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Scoring Mode:', key: 'scoringMode', min: 0, max: 2, step: 1,
        names: ['Basic', 'Standard', 'Greedy'] },
    ],
  },
  physics: {
    title: 'Physics',
    items: [
      { label: '~Air Viscosity:', key: 'viscosity', min: 0, max: 20, step: 1 },
      { label: '~Gravity:', key: 'gravity', min: 0.05, max: 10, step: 0.1, float: true, decimals: 1 },
      { label: '~Suspend Dirt:', key: 'suspendDirt', min: 0, max: 100, step: 5 },
      { label: 'Tanks ~Fall', key: 'fallingTanks', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Borders Extend:', key: 'edgesExtend', min: 0, max: 10000, step: 5, grouped: true },
      { label: '~Effect of Walls:', key: 'wallType', min: 0, max: 7, step: 1,
        names: ['None', 'Wrap-around', 'Padded', 'Rubber', 'Spring', 'Concrete', 'Random', 'Erratic'] },
    ],
  },
  landscape: {
    title: 'Landscape',
    items: [
      { label: '~Sky:', key: 'skyType', min: 0, max: 7, step: 1,
        names: ['Plain', 'Shaded', 'Stars', 'Storm', 'Sunset', 'Cavern', 'Black', 'Random'] },
      { label: '~Max. Wind:', key: 'wind', min: 0, max: 500, step: 5 },
      { label: '~Changing Wind', key: 'changeWind', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Hostile Environment', key: 'hostileEnvironment', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Bumpiness:', key: 'land1', min: 0, max: 100, step: 2 },
      { label: 'S~lope:', key: 'land2', min: 0, max: 100, step: 2 },
      { label: '~Flatten Peaks', key: 'flattenPeaks', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Random Land', key: 'randomLand', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Percent Scanned Mountains:', key: 'mtnPercent', min: 0, max: 100, step: 2 },
    ],
  },
  playoptions: {
    title: 'Play Options',
    items: [
      { label: '~Mode:', key: 'playMode', min: 0, max: 2, step: 1, names: ['Sequential', 'Simultaneous', 'Synchronous'] },
      { label: '~Teams:', key: 'teamMode', min: 0, max: 3, step: 1, names: ['None', 'Standard', 'Corporate', 'Vicious'] },
      { label: 'Status ~Bar', key: 'statusBar', min: 0, max: 1, step: 1, checkbox: true },
      { label: 'Play ~Order:', key: 'playOrder', min: 0, max: 3, step: 1, names: ['Random', 'Losers-First', 'Winners-First', 'Round-Robin'] },
      { label: '~Fast Computers', key: 'fastComputers', min: 0, max: 1, step: 1, checkbox: true },
      { label: 'Ta~lking Tanks:', key: 'talkingTanks', min: 0, max: 2, step: 1, names: ['Off', 'Computers', 'All'] },
      { label: 'Talk ~Probability:', key: 'talkProbability', min: 0, max: 100, step: 5 },
      { label: '~Attack File:', key: 'attackFile', text: true, maxLength: 12 },
      { label: '~Die File:', key: 'dieFile', text: true, maxLength: 12 },
    ],
  },
  weapons: {
    title: 'Weapons',
    items: [
      { label: '~Arms Level:', key: 'armsLevel', min: 0, max: 4, step: 1 },
      { label: '~Bomb Icon:', key: 'bombIcon', min: 0, max: 2, step: 1,
        names: ['Small', 'Big', 'Invisible'] },
      { label: '~Tunneling', key: 'tunneling', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Scale:', key: 'explosionScale', min: 0, max: 2, step: 1,
        names: ['Normal', 'Medium', 'Large'] },
      { label: 'Trace ~Paths', key: 'tracePaths', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Extra Dirt', key: 'extraDirt', min: 0, max: 1, step: 1, checkbox: true },
      { label: '~Useless Items', key: 'uselessItems', min: 0, max: 1, step: 1, checkbox: true },
    ],
  },
};

// --- Menu state ---
export const menu = {
  screen: 'config',        // 'config' | 'player_setup' (no 'title' — EXE goes straight to menu)
  selectedOption: 0,       // main menu selected index
  activeSubmenu: null,     // null or submenu key string
  soundDraft: null,
  economicsDraft: null,
  hardwareDraft: null,
  physicsDraft: null,
  landscapeDraft: null,
  playoptionsDraft: null,
  weaponsDraft: null,
  textEdit: null,
  systemOverlay: null,
  systemConfirmation: null,
  reassignPlayers: false,
  reassignEditing: false,
  systemFlightSound: null,
  configDirty: false,
  submenuSelected: 0,      // selected item within submenu
  terrainDirty: true,      // regenerate terrain preview
  playerSetupIdx: 0,
  playerSetupField: 0,
  setupBackdropPolls: 0, // Native DS:5008 persists across setup sessions.
  blinkTimer: 0,
  saveFlash: 0,            // frames to show "Saved!" feedback
};

// --- Player setup ---
export const playerSetup = [];

// EXE 0x26B69 builds a 40-color ramp; 0x26C74 paints nine-pixel stripes.
// Native DS:500C persists after opening an existing-player editor.
let setupReassignmentMode = false;
let setupBackdropPhase = 0, setupBackdropColor = 0;
function setupPlayerBackdrop(colorIndex, initialRotation = false) {
  setupBackdropColor = colorIndex;
  setupBackdropPhase = initialRotation ? 1 : 0;
  // Rebuilding the native ramp does not publish it until the next rotation.
  if (initialRotation) paintPlayerBackdrop();
}
function paintPlayerBackdrop() {
  const colorIndex = setupBackdropColor;
  const rgb = getPlayerColor(colorIndex);
  for (let i = 0; i < 40; i++) {
    const source = (i + setupBackdropPhase) % 40;
    const scale = source < 20 ? source + 5 : 44 - source;
    setPaletteRgb(180 + i, ...rgb.map(channel => Math.trunc(channel * scale / 24)));
  }
  updatePalette32();
}

// One native idle callback (0x273A0), also called by modal text entry at 0x4A042.
export function tickPlayerSetupBackdrop(pointer = false) {
  menu.setupBackdropPolls = (menu.setupBackdropPolls + 1) & 0xffff;
  if (menu.setupBackdropPolls > 100 || pointer) {
    menu.setupBackdropPolls = 0;
    setupBackdropPhase = (setupBackdropPhase + 1) % 40;
    paintPlayerBackdrop();
  }
}

export function initPlayerSetup() {
  setupPlayerBackdrop(0, true);
  playerSetup.length = 0;
  for (let i = 0; i < config.numPlayers; i++) {
    playerSetup.push({
      name: setupReassignmentMode ? (players[i]?.name ?? '') : '',
      editName: '',
      aiType: AI_TYPE.HUMAN,
      colorIndex: i % 10,
      tankType: 3,
      computerType: AI_TYPE.TOSSER,
    });
  }
}

// --- Helper: format a config value for display ---
function formatValue(item) {
  if (item.disabled) return item.fixed;
  const val = menu.activeSubmenu==='sound' && SUBMENUS.sound.items.includes(item)
    ? soundSettings()[item.key] : menu.activeSubmenu==='economics' && SUBMENUS.economics.items.includes(item)
      ? economicsSettings()[item.key] : menu.activeSubmenu==='hardware' && SUBMENUS.hardware.items.includes(item) ? hardwareSettings()[item.key] : menu.activeSubmenu==='physics' && SUBMENUS.physics.items.includes(item) ? physicsSettings()[item.key] : menu.activeSubmenu==='landscape' && SUBMENUS.landscape.items.includes(item) ? landscapeSettings()[item.key] : menu.activeSubmenu==='playoptions' && SUBMENUS.playoptions.items.includes(item) ? playoptionsSettings()[item.key] : menu.activeSubmenu==='weapons' && SUBMENUS.weapons.items.includes(item) ? weaponsSettings()[item.key] : config[item.key];
  if(item.rate)return (val/100).toFixed(2);
  if(item.cash||item.grouped)return val.toLocaleString('en-US');
  if (item.names) return item.names[val] || String(val);
  if (item.float) return val.toFixed(item.decimals ?? 2);
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
  if (item.text) {menu.textEdit={key:item.key,value:''};menu.blinkTimer=0;return;}
  if (SUBMENUS.sound.items.includes(item)) {
    const count=item.max-item.min+1;
    const settings=soundSettings();
    settings[item.key]=item.min+(settings[item.key]-item.min+dir+count)%count;
    return;
  }
  if (SUBMENUS.economics.items.includes(item) || SUBMENUS.hardware.items.includes(item) || SUBMENUS.physics.items.includes(item) || SUBMENUS.landscape.items.includes(item) || SUBMENUS.playoptions.items.includes(item) || SUBMENUS.weapons.items.includes(item)) {
    const settings=SUBMENUS.weapons.items.includes(item)?weaponsSettings():SUBMENUS.playoptions.items.includes(item)?playoptionsSettings():SUBMENUS.landscape.items.includes(item)?landscapeSettings():SUBMENUS.physics.items.includes(item)?physicsSettings():SUBMENUS.hardware.items.includes(item)?hardwareSettings():economicsSettings();
    if(item.checkbox)settings[item.key]=settings[item.key]?0:1;
    else if(item.names)settings[item.key]=(settings[item.key]+dir+item.names.length)%item.names.length;
    else {
      const next=settings[item.key]+item.step*dir;
      settings[item.key]=next>item.max?item.min:next<item.min?item.max:next;
    }
    return;
  }
  const step = item.step * dir;
  if (item.float) {
    config[item.key] = Math.round(Math.max(item.min, Math.min(item.max, config[item.key] + step)) * 100) / 100;
  } else {
    config[item.key] = Math.max(item.min, Math.min(item.max, config[item.key] + step));
  }
}

function soundSettings() {
  return menu.soundDraft ??= {soundEnabled:config.soundEnabled,flySoundEnabled:config.flySoundEnabled};
}
function economicsSettings() {
  return menu.economicsDraft ??= Object.fromEntries(SUBMENUS.economics.items.map(item=>[item.key,config[item.key]]));
}
function hardwareSettings() {
  return menu.hardwareDraft ??= Object.fromEntries(SUBMENUS.hardware.items.filter(i=>i.key).map(i=>[i.key,config[i.key]]));
}
function physicsSettings() {
  return menu.physicsDraft ??= Object.fromEntries(SUBMENUS.physics.items.map(item=>[item.key,config[item.key]]));
}
function landscapeSettings() {
  return menu.landscapeDraft ??= Object.fromEntries(SUBMENUS.landscape.items.map(item=>[item.key,config[item.key]]));
}
function playoptionsSettings() {
  return menu.playoptionsDraft ??= Object.fromEntries(SUBMENUS.playoptions.items.map(item=>[item.key,config[item.key]]));
}
function weaponsSettings() {
  return menu.weaponsDraft ??= Object.fromEntries(SUBMENUS.weapons.items.map(item=>[item.key,config[item.key]]));
}
function closeSubmenu() {
  if(menu.activeSubmenu==='weapons') {
    for(const [key,value] of Object.entries(weaponsSettings())) {
      if(config[key]!==value) {config[key]=value;menu.configDirty=true;}
    }
    menu.weaponsDraft=null;
  }
  if(menu.activeSubmenu==='playoptions') {
    for(const [key,value] of Object.entries(playoptionsSettings())) {
      if(config[key]!==value) {config[key]=value;menu.configDirty=true;}
    }
    menu.playoptionsDraft=null;
    menu.textEdit=null;
  }
  if(menu.activeSubmenu==='landscape') {
    for(const [key,value] of Object.entries(landscapeSettings())) {
      if(config[key]!==value) {config[key]=value;menu.configDirty=true;}
    }
    menu.landscapeDraft=null;
  }
  if(menu.activeSubmenu==='physics') {
    for(const [key,value] of Object.entries(physicsSettings())) {
      if(config[key]!==value) {config[key]=value;menu.configDirty=true;}
    }
    menu.physicsDraft=null;
  }
  if(menu.activeSubmenu==='hardware') {
    if(hardwareSettings().graphicsMode!==config.graphicsMode)
      config.activeGraphicsMode ??= config.graphicsMode;
    for(const [key,value] of Object.entries(hardwareSettings())) {
      if(config[key]!==value)menu.configDirty=true;
      config[key]=value;
    }
    menu.hardwareDraft=null;
  }
  if(menu.activeSubmenu==='economics') {
    for(const [key,value] of Object.entries(economicsSettings())) {
      if(config[key]!==value)menu.configDirty=true;
      config[key]=value;
    }
    menu.economicsDraft=null;
  }
  if(menu.activeSubmenu==='sound') {
    for(const [key,value] of Object.entries(soundSettings())) {
      if(config[key]!==value)menu.configDirty=true;
      config[key]=value;
    }
    menu.soundDraft=null;
  }
  menu.activeSubmenu=null;
}

// --- Helper: center text X in right panel ---
// EXE: centering uses FG_MAXX (screenW-1), NOT the terrain frame inset (screenW-6)
// See 0x3D72B: mov ax,[EF3E]; sub ax,[bp-0x3A]; sub ax,di; cwd; sub ax,dx; sar ax,1; add ax,[bp-0x3A]
function centerXRight(str) {
  const tw = measureText(str);
  return Math.floor((getScreenW() - 1 - getRightX() - tw) / 2) + getRightX();
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
  if(menu.screen==='config') {
    if(menu.reassignPlayers) {
      if(menu.reassignEditing) {
        handlePlayerSetupInput();
      } else {
        const {x,y,width,height,rowH,rowY,buttonW}=reassignLayout();
        const click=mouse.over&&(consumeClick(0)||consumeClick(2));
        if(consumeKey('Escape') || (click&&(mouse.x<x||mouse.x>x+width||mouse.y<y||mouse.y>y+height)))menu.reassignPlayers=false;
        else for(let i=0;i<config.numPlayers;i++) {
          const by=y+rowY+i*rowH;
          if(consumeKey('Digit'+((i+1)%10)) || (click&&mouse.x>=x+10&&mouse.x<x+10+buttonW&&mouse.y>=by-getUIBorderHeight()&&mouse.y<by-getUIBorderHeight()+getUIButtonHeight())) {
            const p=players[i];
            playerSetup[i]={identityIndex:p?.identityIndex??i,colorRgb:p?.colorRgb,doneEnabled:true,name:p?.name??'',aiType:p?.aiType?(p.aiSelection===-2?AI_TYPE.UNKNOWN:p.aiType):0,computerType:p?.aiType?(p.aiSelection===-2?AI_TYPE.UNKNOWN:p.aiType):AI_TYPE.TOSSER,colorIndex:p?.colorIndex??i,tankType:p?.tankType??3};
            menu.playerSetupIdx=i;menu.playerSetupField=0;menu.reassignEditing=true;setupReassignmentMode=true;
            break;
          }
        }
      }
      return menu.screen;
    }
    if(menu.systemConfirmation) {
      const {x,y,width,height,noX,noW,yesX,yesW}=systemConfirmationLayout();
      const click=mouse.over&&(consumeClick(0)||consumeClick(2));
      const noClick=click&&mouse.x>=noX&&mouse.x<noX+noW&&mouse.y>=y+27-getUIBorderHeight()&&mouse.y<y+27-getUIBorderHeight()+getUIButtonHeight();
      const yesClick=click&&mouse.x>=yesX&&mouse.x<yesX+yesW&&mouse.y>=y+27-getUIBorderHeight()&&mouse.y<y+27-getUIBorderHeight()+getUIButtonHeight();
      if(menu.systemConfirmation==='new'&&(consumeKey('KeyY')||yesClick)) {
        closeSubmenu();
        prepareExplosionTexture();
        resetMenuState();
        return menu.screen;
      }
      const outside=click&&(mouse.x<x||mouse.x>x+width||mouse.y<y||mouse.y>y+height);
      if(consumeKey('KeyN')||consumeKey('Escape')||noClick||outside)menu.systemConfirmation=null;
      consumeKey('Enter');consumeKey('Space');
      return menu.screen;
    }
    if(menu.systemOverlay) {
      const left=mouse.over&&consumeClick(0),right=mouse.over&&consumeClick(2);
      const {x,y,width,height,rowH}=systemOverlayLayout();
      let action=consumeKey('KeyQ')?'quit':consumeKey('KeyN')?'new':consumeKey('KeyP')?'players':null;
      const layout=systemOverlayLayout();
      for(const [row,name] of [[2,'new'],[3,'quit']]) {
        const bx=x+layout.column,by=y+5+(row+1)*rowH-getUIBorderHeight();
        if((left||right)&&mouse.x>=bx&&mouse.x<bx+measureText(layout.right[row])+12&&mouse.y>=by&&mouse.y<by+getUIButtonHeight())action=name;
      }
      const playersY=y+5+3*rowH-getUIBorderHeight();
      if((left||right)&&mouse.x>=x+10&&mouse.x<x+22+measureText(layout.left[2])&&mouse.y>=playersY&&mouse.y<playersY+getUIButtonHeight())action='players';
      const soundY=y+5+5*rowH,soundEnd=x+20+measureText('~Sound:')+11;
      if(consumeKey('KeyS') || ((left||right) && mouse.x>=x+10&&mouse.x<=soundEnd&&mouse.y>=soundY&&mouse.y<=soundY+11))menu.systemOverlay.sound=menu.systemOverlay.sound?0:1;
      if(action || consumeKey('Escape') || ((left||right) && (mouse.x<x||mouse.x>x+width||mouse.y<y||mouse.y>y+height))) {
        config.soundEnabled=menu.systemOverlay.sound;
        menu.systemFlightSound ??= config.flySoundEnabled;
        config.flySoundEnabled=config.soundEnabled?menu.systemFlightSound:0;
        menu.systemOverlay=null;
        if(action==='players') {while(players.length<config.numPlayers)players.push(createUninitializedPlayer(players.length));menu.reassignPlayers=true;menu.reassignNameWidth=0;menu.reassignOrder=Array.from({length:config.numPlayers},(_,i)=>i);}
        else if(action)menu.systemConfirmation=action;
      }
      consumeKey('Enter');consumeKey('Space');
      return menu.screen;
    }
    if((isKeyDown('AltLeft')||isKeyDown('AltRight')) && consumeKey('KeyS')) {
      menu.systemOverlay={sound:config.soundEnabled};
      return menu.screen;
    }
  }
  const previousConfig={...config};
  let result=menu.screen;
  switch (menu.screen) {
    case 'config':
      result=menu.activeSubmenu?handleSubmenuInput():handleMainMenuInput();
      break;
    case 'player_setup':
      result=handlePlayerSetupInput();
      break;
  }
  if(Object.keys(config).some(key=>config[key]!==previousConfig[key]))menu.configDirty=true;
  return result;
}

// Hit-test: is mouse over a main menu button?
function hitTestMenuButton(mx, my) {
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const bx = getBtnX(), by = getStartY() + i * getRowH();
    const item = MENU_ITEMS[i];
    const spinner = item.type === 'spinner';
    const width = spinner ? 10 + measureText(item.label) + measureText(String(config[item.key]))
      : item.action === 'start' ? BTN_W : measureText(item.label) + 12;
    const top = spinner ? by : by - getUIBorderHeight();
    if (mx >= bx && mx < bx + width && my >= top && my < top + (spinner ? 12 : getBtnH())) return i;
  }
  return -1;
}

// Activate the currently selected menu item
function activateMenuItem(item) {
  if (item.type === 'button' && item.action === 'start') {
    saveConfig();
    prepareExplosionTexture();
    initPlayerSetup();
    menu.screen = 'player_setup';
    menu.playerSetupIdx = 0;
    menu.playerSetupField = 0;
    return 'player_setup';
  }
  if (item.type === 'button' && item.action === 'save') {
    if (!menu.configDirty) return null;
    saveConfig();
    menu.configDirty = false;
    menu.saveFlash = 0;
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
  if(menu.textEdit) {
    if(consumeKey('Backspace'))menu.textEdit.value=menu.textEdit.value.slice(0,-1);
    menu.textEdit.value=(menu.textEdit.value+consumeTextInput().replace(/[^a-zA-Z0-9.]/g,'')).slice(0,12);
    if(consumeKey('Enter')) {
      if(menu.textEdit.value)playoptionsSettings()[menu.textEdit.key]=menu.textEdit.value;
      menu.textEdit=null;
    } else if(consumeKey('Escape'))menu.textEdit=null;
    return 'config';
  }
  if (!sub) { menu.activeSubmenu = null; return 'config'; }

  // Native configuration dialogs ignore extended arrows; they do not
  // select a row or change values. Text editors consume input above.
  for(const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])consumeKey(key);
  const prevSky = config.skyType;
  const prevLand = config.landType;

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
        // Native dialog key dispatch reverses shortcuts when BIOS Alt is held.
        const reverse=isKeyDown('AltLeft')||isKeyDown('AltRight');
        adjustValue(si, reverse ? -1 : 1);
        break;
      }
    }
  }

  // Sound lists use left/right buttons; other submenu controls use screen halves.
  const leftClick=mouse.over&&consumeClick(0);
  const rightClick=mouse.over&&['sound','economics','hardware','physics','landscape','playoptions','weapons'].includes(menu.activeSubmenu)&&consumeClick(2);
  if (leftClick || rightClick) {
    const rowH = getSubRowH();
    const nativeLayout=menu.activeSubmenu==='sound'?soundSubmenuLayout():menu.activeSubmenu==='economics'?economicsSubmenuLayout():menu.activeSubmenu==='hardware'?hardwareSubmenuLayout():menu.activeSubmenu==='physics'?settingsSubmenuLayout():['landscape','playoptions','weapons'].includes(menu.activeSubmenu)?settingsSubmenuLayout(menu.activeSubmenu):null;
    const dlgW = nativeLayout ? nativeLayout.width+1 : computeSubmenuWidth(sub);
    const dlgH = nativeLayout ? nativeLayout.height+1 : 30 + sub.items.length * rowH;
    const dlgX = nativeLayout ? nativeLayout.x : Math.floor((getScreenW() - dlgW) / 2);
    const dlgY = nativeLayout ? nativeLayout.y : Math.floor((getScreenH() - dlgH) / 2);

    // Check if click is inside dialog
    if (mouse.x >= dlgX && mouse.x < dlgX + dlgW && mouse.y >= dlgY && mouse.y < dlgY + dlgH) {
      // Hit-test items
      for (let i = 0; i < sub.items.length; i++) {
        const iy = dlgY + (nativeLayout ? 5 : 18) + i * rowH;
        if (mouse.y >= iy - (nativeLayout ? 0 : 1) && mouse.y < iy + (nativeLayout ? (sub.items[i].text?13:12) : rowH - 1)) {
          menu.submenuSelected = i;
          const clickedItem = sub.items[i];
          if (!clickedItem.disabled) {
            if(nativeLayout) {
              const end=clickedItem.text ? dlgX+nativeLayout.width-10 : clickedItem.checkbox ? (menu.activeSubmenu==='playoptions'?dlgX+nativeLayout.width-10:dlgX+20+Math.max(...sub.items.filter(i=>i.checkbox).map(i=>measureText(i.label)))+12)
                : dlgX+20+measureText(clickedItem.label)+(clickedItem.names?Math.max(...clickedItem.names.map(measureText)):measureText(['physics','landscape','playoptions','weapons'].includes(menu.activeSubmenu)?numericMaximumText(clickedItem):menu.activeSubmenu==='hardware'?clickedItem.max.toLocaleString('en-US'):clickedItem.cash?'1,000,000':'0.30')+5);
              const start=clickedItem.text?dlgX+20+measureText(clickedItem.label):dlgX+10;
              // Native type-4 editor observes the activating mouse button and
              // immediately exits with an empty edit (0x49FE1..0x4A02C).
              if(!clickedItem.text && mouse.x>=start && mouse.x<=end)adjustValue(clickedItem,rightClick?1:-1);
              break;
            }
            const midX = dlgX + dlgW / 2;
            adjustValue(clickedItem, mouse.x > midX ? 1 : -1);
          }
          break;
        }
      }
    } else {
      // Click outside dialog = close
      closeSubmenu();
    }
  }

  // Mark terrain dirty if landscape/sky changed
  if (sub!==SUBMENUS.landscape && (config.skyType !== prevSky || config.landType !== prevLand)) {
    menu.terrainDirty = true;
  }


  const space=consumeKey('Space'),enter=consumeKey('Enter');
  if (consumeKey('Escape') || ((space || enter) && !['sound','economics','hardware','physics','landscape','playoptions','weapons'].includes(menu.activeSubmenu))) {
    closeSubmenu();
  }

  return 'config';
}

function setSetupHuman(setup, human) {
  if (setup.aiType !== AI_TYPE.HUMAN || !human) setup.extraTankEnabled = true;
  if (setup.aiType !== AI_TYPE.HUMAN) setup.computerType = setup.aiType;
  setup.aiType = human ? AI_TYPE.HUMAN : setup.computerType;
  // Native 0x27575..0x27577 skips the old computer-only tank reset.
  // Switching player type preserves the tank selection, including index 6.
}

function finishReassignPlayer() {
  const i=menu.playerSetupIdx;
  if(players[i]) {
    const p=players[i],setup=playerSetup[i],previousSelection=p.aiSelection;
    // This roster is opened from configuration (native DS:50E2=0).
    // Native 0x27E83..0x27E97 commits tank changes only during active play
    // and for a live tank; the editor preview still follows the selection.
    Object.assign(p,Object.fromEntries(['name','aiType','colorIndex'].map(key=>[key,setup[key]])));
    // Native 0x27DBE: Unknown retains its label separately from the AI used.
    if(p.aiType===AI_TYPE.UNKNOWN) {
      p.aiSelection=-2;
      if(previousSelection!==-2)p.aiType=random(7)+1;
    } else if(p.aiType!==AI_TYPE.HUMAN)p.aiSelection=p.aiType-1;
  }
  menu.reassignEditing=false;
  menu.reassignOrder=menu.reassignOrder.filter(index=>index!==i).concat(i);
  return 'config';
}
function advancePlayerSetup() {
  if(menu.reassignEditing)return finishReassignPlayer();
  const setup=playerSetup[menu.playerSetupIdx];
  setup.resolvedAiType=setup.aiType===AI_TYPE.UNKNOWN?random(7)+1:setup.aiType;
  if(setup.aiType!==AI_TYPE.HUMAN&&!setup.name.length)setup.name=randomComputerName();
  const p=players[menu.playerSetupIdx];
  if(p) {
    Object.assign(p,{name:setup.name,aiType:setup.resolvedAiType,tankType:setup.tankType});
    if(setup.aiType)p.aiSelection=setup.aiType===AI_TYPE.UNKNOWN?-2:setup.aiType-1;
  }
  menu.playerSetupIdx++;
  menu.playerSetupField = 0;
  if (menu.playerSetupIdx >= config.numPlayers) {
    resolveDuplicateComputerNames(playerSetup);
    for (let i=0;i<playerSetup.length;i++)if(players[i])players[i].name=playerSetup[i].name;
    return 'start_game';
  }
  const next=playerSetup[menu.playerSetupIdx];
  next.aiType=setup.aiType;
  next.computerType=setup.aiType||setup.computerType;
  next.tankType=setup.tankType;
  if(next.aiType!==AI_TYPE.HUMAN)delete next.editName;
  setupPlayerBackdrop(next.colorIndex);
  return 'player_setup';
}

function handlePlayerSetupInput() {
  const setup = playerSetup[menu.playerSetupIdx];
  const lay = getPlayerSetupLayout();
  if (!menu.reassignEditing && !setupReassignmentMode) tickPlayerSetupBackdrop();

  // EXE 0x49F52 edits a separate buffer. Enter commits it and returns to
  // the dialog; a subsequent Done action advances to the next player.
  if (setup.editName !== undefined) {
    if (consumeKey('Backspace')) setup.editName = setup.editName.slice(0, -1);
    setup.editName = (setup.editName + consumeTextInput()).slice(0, 15);
    if (consumeKey('Enter')) {
      if (setup.editName.length) setup.name = setup.editName;
      delete setup.editName;
    } else if (consumeKey('Escape')) {
      delete setup.editName;
    }
    return 'player_setup';
  }
  if (setup.aiType === AI_TYPE.HUMAN && consumeKey('KeyN')) {
    setup.editName = '';
    menu.playerSetupField = 0;
    return 'player_setup';
  }

  if (consumeKey('Space')) setSetupHuman(setup, setup.aiType !== AI_TYPE.HUMAN);
  const tankCount = setup.aiType !== AI_TYPE.HUMAN || setup.extraTankEnabled ? 7 : 6;
  consumeKey('KeyI'); // Native tank selector has no I shortcut.
  if (setup.aiType !== AI_TYPE.HUMAN) {
    for (let i = 0; i < AI_SETUP_LABELS.length; i++) {
      const label = AI_SETUP_LABELS[i];
      if (consumeKey('Key' + label[label.indexOf('~') + 1].toUpperCase()))
        setup.aiType = i + 1;
    }
  }

  // Tank selector navigation (field 1)
  if (menu.playerSetupField === 1) {
    if (consumeKey('ArrowLeft')) setup.tankType = Math.max(0, setup.tankType - 1);
    if (consumeKey('ArrowRight')) setup.tankType = Math.min(tankCount - 1, setup.tankType + 1);
  }

  // AI type icons (field 2): left/right cycles type
  if (menu.playerSetupField === 2) {
    if (consumeKey('ArrowLeft')) setSetupHuman(setup, false);
    if (consumeKey('ArrowRight')) setSetupHuman(setup, true);
  }

  // Tab/arrows cycle name, tank and player-type fields.
  if (consumeKey('Tab')) menu.playerSetupField = (menu.playerSetupField + 1) % 3;
  if (consumeKey('ArrowUp') && menu.playerSetupField > 0) menu.playerSetupField--;
  if (consumeKey('ArrowDown') && menu.playerSetupField < 2) menu.playerSetupField++;

  // Enter or the Done hotkey advances after the name has been committed.
  if ((consumeKey('Enter') || consumeKey('KeyD')) && (setup.doneEnabled ?? (setup.name.trim() || setup.aiType !== AI_TYPE.HUMAN))) {
    return advancePlayerSetup();
  }

  // Mouse clicks
  if (mouse.over && (consumeClick(0) || consumeClick(2))) {
    // Name field click
    if (setup.aiType !== AI_TYPE.HUMAN &&
        mouse.x >= lay.dlgX + 20 && mouse.x <= lay.dlgX + 191 &&
        mouse.y >= lay.dlgY + 20 && mouse.y < lay.dlgY + 65) {
      const choice = Math.floor((mouse.x - lay.dlgX - 20) / 60) * 3 +
        Math.floor((mouse.y - lay.dlgY - 20) / 15);
      if (choice < 8) setup.aiType = choice + 1;
    } else if (setup.aiType === AI_TYPE.HUMAN &&
        mouse.x >= lay.valX && mouse.x < lay.valX + lay.inputW &&
        mouse.y >= lay.nameFieldY && mouse.y < lay.nameFieldY + lay.fieldH) {
      menu.playerSetupField = 0;
      setup.editName = '';
    }
    // Tank icons and slider share the same selection positions.
    else if (mouse.y >= lay.dlgY + 83 && mouse.y <= lay.dlgY + 108 &&
             mouse.x >= lay.dlgX + 19 && mouse.x <= lay.dlgX + 180) {
      const tankType = Math.round((mouse.x - lay.dlgX - 25) / 25);
      if (tankType >= 0 && tankType < tankCount) setup.tankType = tankType;
      menu.playerSetupField = 1;
    }
    else if (mouse.y >= lay.dlgY + 111 && mouse.y <= lay.dlgY + 136 &&
             mouse.x >= lay.dlgX + 42 && mouse.x <= lay.dlgX + 81) {
      setSetupHuman(setup, mouse.x >= lay.dlgX + 62);
      menu.playerSetupField = 2;
    }
    // Done button click
    else if (mouse.x >= lay.doneX && mouse.x < lay.doneX + lay.doneW &&
             mouse.y >= lay.doneY && mouse.y < lay.doneY + lay.doneH && (setup.doneEnabled ?? (setup.name.trim() || setup.aiType !== AI_TYPE.HUMAN))) {
      return advancePlayerSetup();
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
  // Native menu temporarily selects Sunset independently of Landscape settings.
  initPalette(config.landType, 4);
  generateMenuPreviewTerrain();
}

export function generateMenuPreviewTerrain() {
  generateMenuTerrain(getPrevX(), getPrevY(), getPrevX() + getPrevW() - 1, getPrevY() + getPrevH() - 1);
}

export function drawMainMenu() {
  ensureTerrainPreview();

  // 1. Full-screen raised 3D box background (EXE: file 0x3D59B step 1)
  boxRaised(0, 0, getScreenW(), getScreenH());

  // 2. Left panel: 11 buttons
  const nativeModal = ['sound','economics','hardware','physics','landscape','playoptions','weapons'].includes(menu.activeSubmenu);
  const menuLabel = (x,y,label,color=UI_HIGHLIGHT) => {
    if(nativeModal) {
      drawText(x+1,y,label.replace('~',''),UI_LIGHT_BORDER);
      drawText(x,y,label.replace('~',''),UI_DARK_TEXT);
    } else drawText(x,y,label,color);
  };
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const item = MENU_ITEMS[i];
    const bx = getBtnX();
    const by = getStartY() + i * getRowH();

    if (item.type === 'spinner') {
      // EXE spinner is an unboxed label/value with two small arrow glyphs.
      drawText(bx+8,by,nativeModal?item.label.replace('~',''):item.label,nativeModal?UI_DARK_TEXT:UI_HIGHLIGHT);
      drawText(bx+10+measureText(item.label),by,String(config[item.key]),UI_HIGHLIGHT);
      // Spinner arrow edge pixels, EXE 0x478EF..0x47A6E.
      hline(bx, bx + 6, by + 5, UI_BRIGHT_BORDER);
      hline(bx, bx + 6, by + 7, UI_LIGHT_BORDER);
      for (let k = 0; k < 4; k++) {
        setPixel(bx + k, by + 4 - k, UI_DARK_BORDER);
        if (k < 3) setPixel(bx + 6 - k, by + 4 - k, UI_MED_BORDER);
        setPixel(bx + k, by + 8 + k, k === 3 ? UI_MED_BORDER : UI_DARK_BORDER);
        setPixel(bx + 6 - k, by + 8 + k, UI_MED_BORDER);
      }
    } else {
      const width = item.action === 'start' ? BTN_W : measureText(item.label) + 12;
      if(nativeModal && item.submenu===menu.activeSubmenu) {
        drawBox3DSunken(bx,by-getUIBorderHeight(),width,getBtnH(),UI_BACKGROUND,
          UI_MED_BORDER,UI_BRIGHT_BORDER,UI_DARK_BORDER,UI_LIGHT_BORDER);
        drawText(bx+7,by+2,item.label.replace('~',''),UI_HIGHLIGHT);
        continue;
      }
      // dialog_create_button subtracts DS:6E28 (2 or 3) from the text baseline.
      boxRaised(bx, by - getUIBorderHeight(), width, getBtnH());
      if (item.action === 'save' && !nativeModal && !menu.configDirty) drawText(bx + 6, by, item.label, UI_LIGHT_BORDER);
      menuLabel(bx + 5, by, item.label, item.action === 'save' && !menu.configDirty ? UI_DARK_TEXT : UI_HIGHLIGHT);
    }
  }

  // 3. Right panel: sunken terrain preview frame (EXE: draw_flat_box)
  boxSunken(getFrameX(), getFrameY(), getFrameW(), getFrameH(), BLACK);

  // 4. Render sky+terrain at native resolution inside frame interior.
  // EXE: terrain_gen_main renders full-screen, Fastgraph clips to frame.
  // Web: render only pixels inside frame to avoid overwriting UI.
  drawTerrainPreview();

  // 5. Embossed title "Scorched Earth" (EXE: title_3d_text at 0x4CEFD)
  // EXE layers: deep_shadow(0,0), bright(1,1), dark(2,2), light(3,3), dark_border(4,4)
  // EXE centering at 0x3D6CF: width = 2*textW + 4 (not textW + 4), shifts title left of center
  const titleStr = 'Scorched Earth';
  const titleW = measureText(titleStr);
  const embossCenterW = 2 * titleW + 4; // EXE: add ax,ax; add ax,4 at 0x3D6CF
  const titleX = Math.floor((getScreenW() - 1 - getRightX() - embossCenterW) / 2) + getRightX();
  const titleY = isSmallMode() ? 2 : 11;   // EXE: Y=2 (small) / Y=11 (large)
  drawTextEmbossed(titleX, titleY, titleStr, [
    UI_DEEP_SHADOW, UI_BRIGHT_BORDER, UI_DARK_TEXT, UI_BACKGROUND, UI_DARK_BORDER
  ]);

  // 6. Subtitle "The Mother of All Games" (EXE: Y=27 small / Y=41 large)
  // EXE: no fg_setcolor between title_3d_text and subtitle — inherits last layer color EF26
  const subStr = 'The Mother of All Games';
  drawText(centerXRight(subStr), isSmallMode() ? 27 : 41, subStr, UI_DARK_BORDER);

  // 6b. "Registered Version" (EXE: Row 3, Y=52 small / Y=71 large)
  // EXE: still inheriting EF26 from title_3d_text (no fg_setcolor call)
  const regStr = 'Registered Version';
  drawText(centerXRight(regStr), isSmallMode() ? 52 : 71, regStr, UI_DARK_BORDER);

  // 7. Copyright at bottom of right panel (EXE: 0x3D790-0x3D84E)
  // EXE renders copyright and version as SEPARATE lines:
  //   copyright at Y = screenH-21, version "Version 1.50" above at Y = copyrightY - 13
  // If copyright is too wide (checked at 0x3D7C0), splits to two lines (Y -= 13 each)
  const copyrightStr = 'Copyright (c) 1991-1995 Wendell Hicken';
  let copyrightY = getScreenH() - 21; // EXE: FG_MAXY - 20 = screenH - 21 (0x3D793)
  const panelW = getScreenW() - 1 - getRightX() - 10; // EXE: FG_MAXX - bp_3A - 10 (0x3D7BD)
  // EXE: fg_setcolor(EF2C) at 0x3D786 — copyright/version in deep shadow (black)
  if (measureText(copyrightStr) <= panelW) {
    // Single-line copyright
    drawText(centerXRight(copyrightStr), copyrightY, copyrightStr, UI_DEEP_SHADOW);
  } else {
    // Two-line copyright: first line shifted up by 13
    copyrightY -= 13; // EXE: sub [bp-0x2E], 0x0D (0x3D7C4)
    const copy1 = 'Copyright (c) 1991-1995';
    const copy2 = 'Wendell Hicken';
    drawText(centerXRight(copy1), copyrightY, copy1, UI_DEEP_SHADOW);
    drawText(centerXRight(copy2), copyrightY + 13, copy2, UI_DEEP_SHADOW);
  }
  // Version line above copyright (EXE: sprintf "%s %s", "Version", "1.50" at 0x3D855)
  const versionStr = 'Version 1.50';
  drawText(centerXRight(versionStr), copyrightY - 13, versionStr, UI_DEEP_SHADOW);

  // 8. Save feedback
  if (menu.saveFlash > 0) {
    drawText(centerXRight('Saved!'), getScreenH() - 46, 'Saved!', UI_HIGHLIGHT);
  }

  // 9. Submenu overlay (if active)
  if (menu.activeSubmenu) {
    drawSubmenu();
  }
  if(menu.systemOverlay)drawSystemOverlay();
  if(menu.systemConfirmation)drawSystemConfirmation();
  if(menu.reassignPlayers) {drawReassignPlayers();if(menu.reassignEditing)drawPlayerSetupScreen(true);}
}

function reassignLayout() {
  // Native DS:EC46 grows after edits (0x35420), but only resets on opening.
  const nameWidth=menu.reassignNameWidth=Math.max(menu.reassignNameWidth??0,measureText('Minimum'),...players.slice(0,config.numPlayers).map(p=>measureText(p.name)));
  const typeWidth=Math.max(...['Sentient',...AI_NAMES].map(measureText));
  const width=40+Math.max(measureText('Reassign Players'),nameWidth+typeWidth);
  let rowY=25,rowH=18,height=25+(config.numPlayers-1)*18+getUIButtonHeight()-getUIBorderHeight()-1+10;
  if(height>getScreenH()-1) {rowY=24;rowH=17;height-=config.numPlayers+6;}
  return {x:Math.floor((getScreenW()-1-width)/2),y:Math.floor((getScreenH()-1-height)/2),width,height,rowH,rowY,nameWidth,buttonW:12+Math.max(...Array.from({length:config.numPlayers},(_,i)=>measureText(String(i+1))))};
}
function drawReassignPlayers() {
  const {x,y,width,height,rowH,rowY,nameWidth,buttonW}=reassignLayout();
  boxRaised(x,y,width+1,height+1);
  drawText(x+Math.floor((width-measureText('Reassign Players')+1)/2),y+5,'Reassign Players',UI_HIGHLIGHT);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  for(const i of menu.reassignOrder) {
    const by=y+rowY+i*rowH,p=players[i];
    const pressed=menu.reassignEditing&&i===menu.playerSetupIdx;
    if(pressed)boxSunken(x+10,by-getUIBorderHeight(),buttonW,getUIButtonHeight(),UI_BACKGROUND);
    else boxRaised(x+10,by-getUIBorderHeight(),buttonW,getUIButtonHeight());
    const offset=pressed?2:0;
    const label=menu.reassignEditing?String(i+1):(i===9?'1~0':'~'+(i+1));
    if(menu.reassignEditing&&!pressed)drawText(x+16,by,label,UI_LIGHT_BORDER);
    drawText(x+15+offset,by+offset,label,menu.reassignEditing&&!pressed?UI_DARK_TEXT:UI_HIGHLIGHT);
    drawText(x+14+buttonW,by-getUIBorderHeight()+2,p?.name??'',(p?.colorIndex??i)*PLAYER_PALETTE_STRIDE);
    drawText(x+19+buttonW+nameWidth,by-getUIBorderHeight()+2,p?.aiType?AI_NAMES[p.aiSelection===-2?AI_TYPE.UNKNOWN:p.aiType]:'Sentient',UI_HIGHLIGHT);
  }
}

function systemConfirmationLayout() {
  const text=menu.systemConfirmation==='quit'?'Do you want to quit?':'Do you really want to restart the game?';
  const width=Math.max(measureText(text)+20,measureText('~Yes')+measureText('~No')+30),height=53;
  const x=Math.floor((getScreenW()-1-width)/2),y=Math.floor((getScreenH()-1-height)/2);
  const yesW=measureText('~Yes')+12,noW=measureText('~No')+12;
  const gap=Math.floor((width-(yesW-1)-(noW-1))/3);
  return {text,x,y,width,height,yesX:x+gap,yesW,noX:x+2*gap+yesW-1,noW};
}
function drawSystemConfirmation() {
  const {text,x,y,width,height,yesX,yesW,noX,noW}=systemConfirmationLayout();
  boxRaised(x,y,width+1,height+1);
  drawText(x+10,y+10,text,UI_HIGHLIGHT);
  for(const [bx,bw,label] of [[yesX,yesW,'~Yes'],[noX,noW,'~No']]) {
    boxRaised(bx,y+27-getUIBorderHeight(),bw,getUIButtonHeight());
    drawText(bx+5,y+27,label,UI_HIGHLIGHT);
  }
}

// Native 0x3F4F8: two columns and a Sound checkbox, centered on the screen.
function systemOverlayLayout() {
  const left=['~Clear Screen','~Mass Kill','Reassign ~Players','Reassign ~Teams'];
  const right=['Save ~Game','~Restore Game','~New Game','~Quit Game'];
  const column=10+Math.max(...left.map(label=>10+measureText(label)+11));
  const width=column+Math.max(...right.map(label=>measureText(label)+11))+10;
  const rowH=getScreenH()>201?24:20,height=5*rowH+26;
  return {left,right,column,width,height,rowH,x:Math.floor((getScreenW()-1-width)/2),y:Math.floor((getScreenH()-1-height)/2)};
}
function drawSystemOverlay() {
  const {left,right,column,width,height,rowH,x,y}=systemOverlayLayout();
  boxRaised(x,y,width+1,height+1);
  const title='System Menu';
  drawText(x+Math.floor((width-measureText(title)+1)/2),y+5,title,UI_HIGHLIGHT);
  hline(x+5,x+width-5,y+18,UI_LIGHT_BORDER);
  hline(x+5,x+width-5,y+19,UI_MED_BORDER);
  for(const [col,labels] of [left,right].entries()) {
    for(const [row,label] of labels.entries()) {
      const bx=x+(col?column:10),by=y+5+(row+1)*rowH;
      boxRaised(bx,by-getUIBorderHeight(),measureText(label)+12,getUIButtonHeight());
      const disabled=col===0 && row!==2;
      if(disabled)drawText(bx+6,by,label.replace('~',''),UI_LIGHT_BORDER);
      drawText(bx+5,by,disabled?label.replace('~',''):label,disabled?UI_DARK_TEXT:UI_HIGHLIGHT);
    }
  }
  const by=y+5+5*rowH,cx=x+20+measureText('~Sound:');
  drawText(x+18,by,'~Sound:',UI_HIGHLIGHT);
  hline(cx,cx+11,by,UI_BRIGHT_BORDER);hline(cx,cx+11,by+11,UI_LIGHT_BORDER);
  vline(cx,by,by+10,UI_MED_BORDER);vline(cx+11,by+1,by+11,UI_DARK_BORDER);
  if(menu.systemOverlay.sound) {
    for(let k=0;k<3;k++)setPixel(cx+3+k,by+6+k,UI_HIGHLIGHT);
    for(let k=0;k<5;k++)setPixel(cx+5+k,by+8-k,UI_HIGHLIGHT);
  }
}

function drawTerrainPreview() {
  // EXE: terrain_gen_main renders at native screen resolution, Fastgraph clips
  // to the sunken frame area. Render 1:1 (no scaling) — frame interior shows
  // the screen columns that fall within it.
  // Sky gradient: EXE menu has YMIN=0, MAXY=screenH-1 (full screen, no HUD offset)
  // Sunset gradient: 121 + floor((MAXY - y) * 28 / playH), file 0x39DF1.
  const MAXY = getScreenH() - 1;
  const YMIN = 0;
  const playH = MAXY - YMIN;
  const x0 = getPrevX(), y0 = getPrevY();
  const x1 = x0 + getPrevW(), y1 = y0 + getPrevH();

  for (let x = x0; x < x1; x++) {
    const terrainY = x < terrain.length ? terrain[x] : getScreenH();
    for (let y = y0; y < y1; y++) {
      if (y >= terrainY) {
        // Terrain body — solid ground color
        setPixel(x, y, TERRAIN_PAL_START);
      } else {
        // Menu preview always uses the sunset gradient.
        const idx = 1 + Math.floor((MAXY - Math.max(YMIN, Math.min(y, MAXY))) * 28 / playH);
        setPixel(x, y, SKY_PAL_START + Math.min(idx, SKY_PAL_COUNT - 1));
      }
    }
  }

  // Sunset bitmap: EXE 0x39E42 calls the filled-circle iterator at 0x43ACA.
  // Its X coordinate uses signed 16.16 pixel-aspect scaling (0x43B4E).
  const centerX = (getScreenW() - 1) >> 1, centerY = MAXY - 5;
  const radius = Math.trunc((getScreenW() - 1) / 3);
  const aspect = (GRAPHICS_MODES.find(m=>m.w===config.screenWidth&&m.h===config.screenHeight)?.displayAspect ?? 1);
  const xScale = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const span = (dx, dy) => {
    const y = centerY + dy;
    if (y < y0 || y >= y1) return;
    const left = Math.max(x0, centerX + Math.floor(-dx * xScale / 65536));
    const right = Math.min(x1 - 1, centerX + Math.floor(dx * xScale / 65536));
    for (let x = left; x <= right; x++)
      if (y < terrain[x]) setPixel(x, y, SKY_PAL_START);
  };
  const mirror = (dx, dy) => { span(dx, dy); span(dx, -dy); span(dy, dx); span(dy, -dx); };
  let dx = 0, dy = radius * 2, error = 0;
  while (dx <= dy) {
    if ((dx & 1) === 0) mirror(dx >> 1, (dy + 1) >> 1);
    error += dx * 2 + 1;
    dx++;
    if (error > 0) { error -= dy * 2 - 1; dy--; }
  }
  mirror(dx >> 1, (dy + 1) >> 1);
}

function drawSubmenu() {
  if (menu.activeSubmenu === 'sound') { drawSoundSubmenu(); return; }
  if (menu.activeSubmenu === 'economics') { drawSettingsSubmenu(); return; }
  if (menu.activeSubmenu === 'weapons') { drawSettingsSubmenu('weapons'); return; }
  if (menu.activeSubmenu === 'playoptions') { drawSettingsSubmenu('playoptions'); return; }
  if (menu.activeSubmenu === 'landscape') { drawSettingsSubmenu('landscape'); return; }
  if (menu.activeSubmenu === 'physics') { drawSettingsSubmenu('physics'); return; }
  if (menu.activeSubmenu === 'hardware') { drawSettingsSubmenu('hardware'); return; }
  const sub = SUBMENUS[menu.activeSubmenu];
  if(menu.textEdit) {
    if(consumeKey('Backspace'))menu.textEdit.value=menu.textEdit.value.slice(0,-1);
    menu.textEdit.value=(menu.textEdit.value+consumeTextInput().replace(/[^a-zA-Z0-9.]/g,'')).slice(0,12);
    if(consumeKey('Enter')) {
      if(menu.textEdit.value)playoptionsSettings()[menu.textEdit.key]=menu.textEdit.value;
      menu.textEdit=null;
    } else if(consumeKey('Escape'))menu.textEdit=null;
    return 'config';
  }
  if (!sub) return;

  const itemCount = sub.items.length;
  // Native submenu item pitch is 15 pixels in every graphics mode.
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

// Native 0x3BB2A..0x3BB80: two list widgets, no title or footer.
function soundSubmenuLayout() {
  const width = Math.max(...SUBMENUS.sound.items.map(item =>
    30 + measureText(item.label) + Math.max(...item.names.map(measureText))));
  const height = 41;
  return {x:100+Math.floor((getScreenW()-1-100-width)/2),y:Math.floor((getScreenH()-1-height)/2),width,height};
}
function drawSoundSubmenu() {
  const {x,y,width,height}=soundSubmenuLayout();
  boxRaised(x,y,width+1,height+1);
  for (const [i,item] of SUBMENUS.sound.items.entries()) {
    const bx=x+10,by=y+5+i*15;
    drawText(bx+8,by,item.label,UI_HIGHLIGHT);
    drawText(bx+10+measureText(item.label),by,formatValue(item),UI_HIGHLIGHT);
    hline(bx,bx+6,by+5,UI_BRIGHT_BORDER);
    hline(bx,bx+6,by+7,UI_LIGHT_BORDER);
    for(let k=0;k<4;k++) {
      setPixel(bx+k,by+4-k,UI_DARK_BORDER);
      if(k<3)setPixel(bx+6-k,by+4-k,UI_MED_BORDER);
      setPixel(bx+k,by+8+k,k===3?UI_MED_BORDER:UI_DARK_BORDER);
      setPixel(bx+6-k,by+8+k,UI_MED_BORDER);
    }
  }
}

function economicsSubmenuLayout() {
  const sub=SUBMENUS.economics;
  const width=Math.max(...sub.items.map(item=>item.checkbox ? 42+measureText(item.label)
    : (item.names?30:35)+measureText(item.label)+(item.names?Math.max(...item.names.map(measureText)):measureText(item.cash?'1,000,000':'0.30'))));
  const height=86;
  return {x:100+Math.floor((getScreenW()-1-100-width)/2),y:Math.floor((getScreenH()-1-height)/2),width,height};
}
function hardwareSubmenuLayout() {
  const width=Math.max(...SUBMENUS.hardware.items.map(item=>item.checkbox ? 42+measureText(item.label)
    : (item.names?30:35)+measureText(item.label)+measureText(item.names?'1024x768':item.fixed??String(item.max))));
  const height=116;
  return {x:100+Math.floor((getScreenW()-1-100-width)/2),y:Math.floor((getScreenH()-1-height)/2),width,height};
}
function numericMaximumText(item) {
  return item.float ? item.max.toFixed(item.decimals) : item.max.toLocaleString('en-US');
}
function settingsSubmenuLayout(kind='physics') {
  const width=Math.max(...SUBMENUS[kind].items.map(item=>item.text ? 33+measureText(item.label)+item.maxLength*7 : item.checkbox ? 42+measureText(item.label)
    : (item.names?30:35)+measureText(item.label)+(item.names?Math.max(...item.names.map(measureText)):measureText(numericMaximumText(item)))));
  const height=(kind==='playoptions'?12:11)+15*SUBMENUS[kind].items.length;
  return {x:100+Math.floor((getScreenW()-1-100-width)/2),y:Math.floor((getScreenH()-1-height)/2),width,height};
}
function drawSettingsSubmenu(kind='economics') {
  const sub=SUBMENUS[kind];
  const settings=kind==='weapons'?weaponsSettings():kind==='playoptions'?playoptionsSettings():kind==='landscape'?landscapeSettings():kind==='physics'?physicsSettings():kind==='hardware'?hardwareSettings():economicsSettings();
  const {x,y,width,height}=['physics','landscape','playoptions','weapons'].includes(kind)?settingsSubmenuLayout(kind):kind==='hardware'?hardwareSubmenuLayout():economicsSubmenuLayout();
  boxRaised(x,y,width+1,height+1);
  const checkboxX=kind==='playoptions'?x+width-22:x+20+Math.max(...sub.items.filter(i=>i.checkbox).map(i=>measureText(i.label)));
  for(const [i,item] of sub.items.entries()) {
    const bx=x+10,by=y+5+i*15;
    drawText(bx+8,by,item.label,item.disabled?UI_DARK_TEXT:UI_HIGHLIGHT);
    if(item.text) {
      const tx=x+20+measureText(item.label);
      boxSunken(tx,by-1,x+width-10-tx+1,14,UI_BACKGROUND);
      const editing=menu.textEdit?.key===item.key;
      const value=editing?menu.textEdit.value:settings[item.key];
      drawText(tx+2,by,value,UI_HIGHLIGHT);
      if(editing) {
        // Native editor blinks by changing cursor palette entry 162.
        const shade=Math.floor(menu.blinkTimer/20)%2===0?10:45;
        setPaletteRgb(162,shade,shade,shade);
        updatePalette32();
      }
      if(editing)vline(tx+2+measureText(value)+(value.length?1:0),by+1,by+10,162);
    } else if(item.checkbox) {
      const cy=by;
      fillRect(checkboxX,cy,checkboxX+11,cy+11,UI_BACKGROUND);
      hline(checkboxX,checkboxX+11,cy,UI_BRIGHT_BORDER);
      hline(checkboxX,checkboxX+11,cy+11,UI_LIGHT_BORDER);
      vline(checkboxX,cy,cy+10,UI_MED_BORDER);
      vline(checkboxX+11,cy+1,cy+11,UI_DARK_BORDER);
      if(settings[item.key]) {
        for(let k=0;k<3;k++)setPixel(checkboxX+3+k,cy+6+k,UI_HIGHLIGHT);
        for(let k=0;k<5;k++)setPixel(checkboxX+5+k,cy+8-k,UI_HIGHLIGHT);
      }
    } else {
      drawText(bx+10+measureText(item.label),by,formatValue(item),item.disabled?UI_DARK_TEXT:UI_HIGHLIGHT);
      hline(bx,bx+6,by+5,UI_BRIGHT_BORDER);hline(bx,bx+6,by+7,UI_LIGHT_BORDER);
      for(let k=0;k<4;k++) {
        setPixel(bx+k,by+4-k,UI_DARK_BORDER);
        if(k<3)setPixel(bx+6-k,by+4-k,UI_MED_BORDER);
        setPixel(bx+k,by+8+k,k===3?UI_MED_BORDER:UI_DARK_BORDER);
        setPixel(bx+6-k,by+8+k,UI_MED_BORDER);
      }
    }
  }
}

// --- Player setup dialog layout (EXE: dialog widget system, centered) ---
// EXE: name field, tank silhouettes, computer/human icons and Done button.
function getPlayerSetupLayout() {
  // EXE 0x2782E / 0x284EB: both person/computer dialogs share these bounds.
  // D08A=73; the highest widget bottom is 135, with a ten-pixel margin.
  const dlgW = 202, dlgH = 146;
  const dlgX = Math.floor((getScreenW() - dlgW) / 2);
  const dlgY = Math.floor((getScreenH() - dlgH) / 2);
  const labelX = dlgX + 23, valX = dlgX + 52;
  const inputW = 109, nameFieldY = dlgY + 19, fieldH = 14;
  const colorSize = 13, colorRowX = dlgX + 19, colorRowY = dlgY + 83;
  const iconRowY = dlgY + 111;
  const doneX = dlgX + 122, doneY = dlgY + 120-getUIBorderHeight(), doneW = 36, doneH = getUIButtonHeight();
  return { dlgX, dlgY, dlgW, dlgH, rowH: 22, labelX, valX, inputW,
    nameFieldY, fieldH, colorRowY, colorRowX, colorSize, iconRowY,
    doneX, doneY, doneW, doneH };
}

// EXE 0x44E93 circle iterator; DS:6FF2/6FF4 are 3/2 in small mode,
// otherwise 5/3 (small-mode initialization at 0x4961F).
function drawSetupRadio(cx, cy, selected) {
  const aspect = (GRAPHICS_MODES.find(m=>m.w===config.screenWidth&&m.h===config.screenHeight)?.displayAspect ?? 1);
  const sx = aspect < 1 ? Math.trunc(aspect * 65536) : 65536;
  const sy = aspect > 1 ? Math.trunc(65536 / aspect) : 65536;
  const ring = (radius, color) => {
    const span = (x, y) => hline(cx + Math.floor(-x * sx / 65536),
      cx + Math.floor(x * sx / 65536), cy + Math.floor(y * sy / 65536), color);
    const mirror = (x, y) => { span(x, y); span(x, -y); span(y, x); span(y, -x); };
    let x = 0, y = radius * 2, error = 0;
    while (x <= y) {
      if (!(x & 1)) mirror(x >> 1, (y + 1) >> 1);
      error += x * 2 + 1;
      x++;
      if (error > 0) { error -= y * 2 - 1; y--; }
    }
    mirror(x >> 1, (y + 1) >> 1);
  };
  ring(getScreenH() - 1 < 210 ? 3 : 5, UI_DEEP_SHADOW);
  ring(getScreenH() - 1 < 210 ? 2 : 3, selected ? UI_DARK_BORDER : UI_DARK_TEXT);
}

const AI_SETUP_LABELS = ['~Moron', 'S~hooter', '~Poolshark', '~Tosser',
  '~Chooser', '~Spoiler', 'C~yborg', '~Unknown'];

export function drawPlayerSetupScreen(overlay=false) {
  // EXE: full-screen player-colored fill hides the menu behind the dialog.
  // EXE fills screen with the current player's color, then draws the centered
  // dialog on top — menu buttons are NOT visible.
  const idx = menu.playerSetupIdx;
  if (idx >= config.numPlayers) return;

  const setup = playerSetup[idx];
  setPaletteRgb(164, ...(setup.colorRgb ?? getPlayerColor(setup.colorIndex)));
  updatePalette32();

  if(!overlay)for (let x = 0; x < getScreenW(); x += 9) {
    fillRect(x, 0, Math.min(x + 8, getScreenW() - 1), getScreenH() - 1,
      180 + Math.floor(x / 9) % 40);
  }

  const lay = getPlayerSetupLayout();

  // Centered raised dialog box (popup over menu background)
  boxRaised(lay.dlgX, lay.dlgY, lay.dlgW, lay.dlgH);

  // Title: "Player N (of M)" centered in dialog, in player color
  // EXE: x = dlg.left + (dlg.right - dlg.left - textWidth) / 2  (0x26F09-0x26F1D)
  const titleStr = `Player ${(setup.identityIndex ?? idx) + 1} (of ${config.numPlayers})`;
  const titleX = lay.dlgX + Math.floor((lay.dlgW - 1 - measureText(titleStr)) / 2);
  drawText(titleX, lay.dlgY + 2, titleStr, UI_HIGHLIGHT);
  boxSunken(lay.dlgX + 10, lay.dlgY + 15, lay.dlgW - 20, 59, UI_BACKGROUND);

  if (setup.aiType === AI_TYPE.HUMAN) {
    // Name field — label + sunken input box
    drawText(lay.labelX, lay.nameFieldY + 1, '~Name:', UI_HIGHLIGHT);
    boxSunken(lay.valX, lay.nameFieldY, lay.inputW, lay.fieldH, UI_BACKGROUND);
    const displayName = setup.editName ?? setup.name;
    drawText(lay.valX + 2, lay.nameFieldY + 1, displayName, UI_HIGHLIGHT);
    if (setup.editName !== undefined && Math.floor(menu.blinkTimer / 20) % 2 === 0) {
      vline(setup.cursorX ?? (lay.valX + 2 + measureText(displayName) + (displayName.length ? 1 : 0)), lay.nameFieldY + 2, lay.nameFieldY + 11, 162);
    }
  } else {
    for (let i = 0; i < AI_SETUP_LABELS.length; i++) {
      const x = lay.dlgX + 20 + Math.floor(i / 3) * 60;
      const y = lay.dlgY + 20 + (i % 3) * 15;
      drawText(x + 10, y, AI_SETUP_LABELS[i], UI_HIGHLIGHT);
      drawSetupRadio(x + 5, y + 5, setup.aiType === i + 1);
    }
  }

  // EXE 0x27081: tank silhouettes, followed by the type-6 slider.
  for (let i = 0; i < TANK_TYPES.length; i++) {
    const cx = lay.dlgX + 25 + i * 25, cy = lay.dlgY + 95;
    const enabled = i < 6 || setup.aiType !== AI_TYPE.HUMAN || setup.extraTankEnabled;
    boxSunken(cx - 6, cy - 12, 14, 15, enabled ? UI_DEEP_SHADOW : UI_DARK_TEXT);
    const tank = TANK_TYPES[i];
    const color = 164;
    for (const [dx, dy] of tank.pixels) setPixel(cx + dx, cy + dy, color);
    // EXE 0x40747 uses a fixed 45-degree angle and an inclusive line.
    const angle = 0.785398185;
    const bx = cx + tank.barrelXOff, by = cy + tank.barrelYOff;
    // Fastgraph's upward lines resolve midpoint ties from the upper endpoint.
    bresenhamLine(Math.trunc(bx + Math.cos(angle) * tank.barrelLen),
      Math.trunc(by - Math.sin(angle) * tank.barrelLen), bx, by,
      (x, y) => setPixel(x, y, color));
  }
  drawText(lay.dlgX + 12, lay.dlgY + 99, '~I', UI_HIGHLIGHT);
  drawIconSlider(lay.dlgX + 20, lay.dlgX + 180, lay.dlgY + 100,
    lay.dlgX + 25 + setup.tankType * 25);

  // EXE 0x27265: computer and human icons.
  for (let i = 0; i < 2; i++) {
    const cx = lay.dlgX + 49 + i * 25, cy = lay.dlgY + 123;
    boxSunken(cx - 7, cy - 12, 15, 15, UI_DEEP_SHADOW);
    drawUIIcon(cx - 5, cy - 10, i === 0 ? 11 : 10, UI_DARK_BORDER);
  }
  drawIconSlider(lay.dlgX + 44, lay.dlgX + 79, lay.dlgY + 128,
    lay.dlgX + (setup.aiType === AI_TYPE.HUMAN ? 74 : 49));

  // Done button (EXE: raised 3D button at bottom-right)
  boxRaised(lay.doneX, lay.doneY, lay.doneW, lay.doneH);
  const doneTx = lay.doneX + 5;
  const doneTy = lay.doneY + Math.floor((lay.doneH - FONT_HEIGHT) / 2);
  if (!(setup.doneEnabled ?? (setup.aiType !== AI_TYPE.HUMAN || (setup.editName === undefined && !!setup.name.trim())))) {
    drawText(doneTx + 1, doneTy, '~Done', UI_LIGHT_BORDER);
    drawText(doneTx, doneTy, '~Done', UI_DARK_TEXT);
  } else drawText(doneTx, doneTy, '~Done', UI_HIGHLIGHT);
}

// Reset menu state when re-entering from game over / system menu
export function resetMenuState() {
  // Native main_menu entry copies the active mode (DS:6E26) into its
  // editable graphics selection (DS:6312), without switching hardware.
  if(config.activeGraphicsMode!==undefined)config.graphicsMode=config.activeGraphicsMode;
  menu.screen = 'config';
  menu.activeSubmenu = null;
  menu.soundDraft = null;
  menu.economicsDraft = null;
  menu.hardwareDraft = null;
  menu.physicsDraft = null;
  menu.landscapeDraft = null;
  menu.playoptionsDraft = null;
  menu.weaponsDraft = null;
  menu.textEdit = null;
  menu.systemOverlay = null;
  menu.systemConfirmation = null;
  menu.reassignPlayers = false;
  menu.reassignEditing = false;
  menu.terrainDirty = true;
  menu.saveFlash = 0;
}
