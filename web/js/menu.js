// Scorched Earth - Title Screen & Configuration Menu
// EXE: config menu structure found in binary UI strings (disasm/ui_complete.txt)
// EXE: sub-menus for terrain, sky, walls, scoring, player setup
// States: TITLE → CONFIG → PLAYER_SETUP → game starts

import { config, saveConfig } from './config.js';
import { fillRect, hline } from './framebuffer.js';
import { drawText, drawTextShadow } from './font.js';
import { BLACK } from './palette.js';
import { consumeKey } from './input.js';
import { AI_TYPE, AI_NAMES } from './ai.js';

// Menu state
export const menu = {
  screen: 'title',       // 'title' | 'config' | 'player_setup'
  selectedOption: 0,
  playerSetupIdx: 0,     // which player we're configuring
  playerSetupField: 0,   // 0=name, 1=AI type
  blinkTimer: 0,
};

// Config options displayed in the menu
const CONFIG_OPTIONS = [
  { key: 'numPlayers', label: 'Players',   min: 2, max: 10, step: 1 },
  { key: 'rounds',     label: 'Rounds',    min: 1, max: 100, step: 1 },
  { key: 'landType',   label: 'Land Type', min: 0, max: 6, step: 1,
    names: ['Flat', 'Slope', 'Rolling', 'Mountain', 'V-Shaped', 'Castle', 'Cavern'] },
  { key: 'skyType',    label: 'Sky',       min: 0, max: 6, step: 1,
    names: ['Plain', 'Shaded', 'Stars', 'Storm', 'Sunset', 'Cavern', 'Black'] },
  { key: 'wallType',   label: 'Walls',     min: 0, max: 7, step: 1,
    names: ['None', 'Erratic', 'Random', 'Wrap', 'Padded', 'Rubber', 'Spring', 'Concrete'] },
  { key: 'armsLevel',  label: 'Arms Level', min: 0, max: 4, step: 1 },
  { key: 'wind',       label: 'Wind',      min: 0, max: 20, step: 1 },
  { key: 'scoringMode', label: 'Scoring',  min: 0, max: 2, step: 1,
    names: ['Standard', 'Corporate', 'Vicious'] },
  { key: 'startCash',  label: 'Start Cash', min: 0, max: 100000, step: 5000 },
  { key: 'interest',   label: 'Interest %', min: 0, max: 50, step: 5 },
  { key: 'soundEnabled', label: 'Sound', min: 0, max: 1, step: 1,
    names: ['Off', 'On'] },
  { key: 'talkingTanks', label: 'Talking', min: 0, max: 1, step: 1,
    names: ['Off', 'On'] },
  { key: 'playOrder', label: 'Play Order', min: 0, max: 3, step: 1,
    names: ['Sequential', 'Random', 'Losers First', 'Winners First'] },
  { key: 'fallingTanks', label: 'Fall Damage', min: 0, max: 1, step: 1,
    names: ['Off', 'On'] },
  { key: 'explosionScale', label: 'Explosions', min: 0, max: 2, step: 1,
    names: ['Small', 'Medium', 'Large'] },
  { key: 'tracePaths', label: 'Trace Paths', min: 0, max: 1, step: 1,
    names: ['Off', 'On'] },
  { key: 'extraDirt', label: 'Extra Dirt', min: 0, max: 1, step: 1,
    names: ['Off', 'On'] },
  { key: 'hostileEnvironment', label: 'Environment', min: 0, max: 1, step: 1,
    names: ['Calm', 'Hostile'] },
  { key: 'playMode', label: 'Play Mode', min: 0, max: 2, step: 1,
    names: ['Sequential', 'Simultaneous', 'Synchronous'] },
];

// Player names — EXE: default names extracted from binary (DS player name table)
// Note: "Napolean" preserves original EXE misspelling
const DEFAULT_NAMES = [
  'Wolfgang', 'Gilligan', 'Cleopatra', 'Mussolini', 'Napolean',
  'Barbarella', 'Antoinette', 'Elizabeth', 'Persephone', 'Mata Hari',
];

// Player setup storage (before game starts)
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

// Handle menu input, returns 'title' | 'config' | 'player_setup' | 'start_game'
export function menuTick() {
  menu.blinkTimer++;

  switch (menu.screen) {
    case 'title':
      if (consumeKey('Space') || consumeKey('Enter')) {
        menu.screen = 'config';
        menu.selectedOption = 0;
      }
      return 'title';

    case 'config':
      return handleConfigInput();

    case 'player_setup':
      return handlePlayerSetupInput();
  }
  return menu.screen;
}

function handleConfigInput() {
  // Navigate options
  if (consumeKey('ArrowUp')) {
    menu.selectedOption = Math.max(0, menu.selectedOption - 1);
  }
  if (consumeKey('ArrowDown')) {
    menu.selectedOption = Math.min(CONFIG_OPTIONS.length - 1, menu.selectedOption + 1);
  }

  // Adjust value
  const opt = CONFIG_OPTIONS[menu.selectedOption];
  if (consumeKey('ArrowLeft')) {
    config[opt.key] = Math.max(opt.min, config[opt.key] - opt.step);
  }
  if (consumeKey('ArrowRight')) {
    config[opt.key] = Math.min(opt.max, config[opt.key] + opt.step);
  }

  // Proceed to player setup
  if (consumeKey('Enter') || consumeKey('Space')) {
    saveConfig();
    initPlayerSetup();
    menu.screen = 'player_setup';
    menu.playerSetupIdx = 0;
    menu.playerSetupField = 0;
    return 'player_setup';
  }

  // Back to title
  if (consumeKey('Escape')) {
    menu.screen = 'title';
    return 'title';
  }

  return 'config';
}

function handlePlayerSetupInput() {
  const setup = playerSetup[menu.playerSetupIdx];

  if (menu.playerSetupField === 1) {
    // AI type selection
    if (consumeKey('ArrowLeft')) {
      setup.aiType = Math.max(0, setup.aiType - 1);
    }
    if (consumeKey('ArrowRight')) {
      setup.aiType = Math.min(AI_TYPE.UNKNOWN, setup.aiType + 1);
    }
  }

  // Toggle field
  if (consumeKey('ArrowUp')) {
    menu.playerSetupField = Math.max(0, menu.playerSetupField - 1);
  }
  if (consumeKey('ArrowDown')) {
    menu.playerSetupField = Math.min(1, menu.playerSetupField + 1);
  }

  // Confirm this player and move to next
  if (consumeKey('Enter') || consumeKey('Space')) {
    menu.playerSetupIdx++;
    menu.playerSetupField = 0;
    if (menu.playerSetupIdx >= config.numPlayers) {
      // All players configured — start game
      return 'start_game';
    }
  }

  // Back to config
  if (consumeKey('Escape')) {
    menu.screen = 'config';
    return 'config';
  }

  return 'player_setup';
}

// Draw the title screen
export function drawTitleScreen() {
  fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);

  drawTextShadow(48, 30, 'SCORCHED  EARTH', 199, 0);
  drawTextShadow(112, 44, 'v1.50', 150, 0);

  drawText(56, 70, 'A Wendell Hicken game', 150);
  drawText(72, 82, '(1995, Borland C++)', 150);

  drawText(32, 110, 'Web port - faithful RE', 150);

  if (Math.floor(menu.blinkTimer / 30) % 2 === 0) {
    drawTextShadow(56, 150, 'Press SPACE to start', 199, 0);
  }

  drawText(40, 180, 'Arrow keys, Tab, Space', 150);
}

// Draw the config menu
export function drawConfigScreen() {
  fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);

  drawTextShadow(72, 4, 'GAME  SETTINGS', 199, 0);
  hline(8, 310, 14, 150);

  for (let i = 0; i < CONFIG_OPTIONS.length; i++) {
    const opt = CONFIG_OPTIONS[i];
    const y = 20 + i * 14;
    const selected = i === menu.selectedOption;
    const textColor = selected ? 199 : 150;

    if (selected) {
      fillRect(6, y - 1, 312, y + 9, 1);
    }

    drawText(8, y, opt.label, textColor);

    // Value display
    let valueStr;
    if (opt.names) {
      valueStr = opt.names[config[opt.key]] || String(config[opt.key]);
    } else {
      valueStr = String(config[opt.key]);
    }

    if (selected) {
      drawText(170, y, '< ' + valueStr + ' >', textColor);
    } else {
      drawText(178, y, valueStr, textColor);
    }
  }

  const footerY = config.screenHeight - 18;
  hline(8, 310, footerY - 4, 150);
  drawText(8, footerY, 'UP/DOWN:Select  L/R:Adjust', 150);
  drawText(8, footerY + 10, 'ENTER:Players  ESC:Back', 150);
}

// Draw the player setup screen
export function drawPlayerSetupScreen() {
  fillRect(0, 0, config.screenWidth - 1, config.screenHeight - 1, BLACK);

  const idx = menu.playerSetupIdx;
  if (idx >= config.numPlayers) return;

  const setup = playerSetup[idx];
  const baseColor = idx * 8 + 4;

  drawTextShadow(56, 10, 'PLAYER  SETUP', 199, 0);
  hline(8, 310, 20, 150);

  drawText(8, 30, `Player ${idx + 1} of ${config.numPlayers}`, baseColor);

  // Name field
  const nameSelected = menu.playerSetupField === 0;
  const nameColor = nameSelected ? 199 : 150;
  drawText(8, 50, 'Name:', nameColor);
  drawText(56, 50, setup.name, baseColor);

  // AI type field
  const aiSelected = menu.playerSetupField === 1;
  const aiColor = aiSelected ? 199 : 150;
  drawText(8, 68, 'Type:', aiColor);
  const typeName = AI_NAMES[setup.aiType] || 'Human';
  if (aiSelected) {
    drawText(56, 68, '< ' + typeName + ' >', aiColor);
  } else {
    drawText(56, 68, typeName, aiColor);
  }

  // Instructions
  const footerY = config.screenHeight - 18;
  hline(8, 310, footerY - 4, 150);
  drawText(8, footerY, 'UP/DOWN:Field  L/R:Adjust', 150);
  drawText(8, footerY + 10, 'ENTER:Next Player  ESC:Back', 150);
}
