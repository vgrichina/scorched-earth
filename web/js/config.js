// Scorched Earth - Game configuration defaults
// EXE: parsed from SCORCH.CFG text file at startup
// EXE: config strings at file region identified in disasm/config_strings_region.txt
// EXE: values stored in DS data segment, referenced throughout gameplay code

// EXE: 9 graphics modes in mode table at DS:0x6B66 (stride 0x44)
// EXE: aspect ratio stored as IEEE 754 double per mode entry
// EXE: default mode index 4 (360×480, custom Mode-X via CRTC table at DS:0x6840)
// displayAspect = pixel aspect ratio — CSS display height = canvas height × displayAspect
export const GRAPHICS_MODES = [
  { name: '320x200',   w: 320,  h: 200,  displayAspect: 1.00 },  // 0: VGA Mode 13h (FG 19)
  { name: '320x240',   w: 320,  h: 240,  displayAspect: 1.00 },  // 1: Mode-X (FG 22)
  { name: '320x400',   w: 320,  h: 400,  displayAspect: 0.50 },  // 2: Mode-X doubled (FG 21)
  { name: '320x480',   w: 320,  h: 480,  displayAspect: 0.50 },  // 3: Mode-X doubled (FG 23)
  { name: '360x480',   w: 360,  h: 480,  displayAspect: 0.55 },  // 4: Custom Mode-X (FG 0) — EXE default
  { name: '640x400',   w: 640,  h: 400,  displayAspect: 1.00 },  // 5: SVGA/VESA 0x100 (FG 24)
  { name: '640x480',   w: 640,  h: 480,  displayAspect: 1.00 },  // 6: SVGA/VESA 0x101 (FG 25)
  { name: '800x600',   w: 800,  h: 600,  displayAspect: 1.00 },  // 7: SVGA/VESA 0x103 (FG 26)
  { name: '1024x768',  w: 1024, h: 768,  displayAspect: 1.00 },  // 8: SVGA/VESA 0x105 (FG 27)
];

export const config = {
  // Screen — EXE: mode index into GRAPHICS_MODES table (default=4, 360×480)
  graphicsMode: 0,     // start at 320×200 for backwards compat; menu can change
  screenWidth: 320,    // derived from GRAPHICS_MODES[graphicsMode]
  screenHeight: 200,

  // Physics — EXE: from SCORCH.CFG, used in extras.cpp physics loop
  gravity: 0.2,        // EXE: GRAVITY=0.200000 (DS:0x512A, range 0.05-10.0, accel = 2500×G px/sec²)
  viscosity: 0,        // EXE: AIR_VISCOSITY=0 (range 0–20; factor = 1.0 - value/10000 per step; DS:5178)
  edgesExtend: 75,     // EXE: EDGES_EXTEND=75 (DS:0x5158, border extension pixels beyond screen edges)
  suspendDirt: 0,      // EXE: SUSPEND_DIRT=0 (DS:0x5166, 0-100% of dirt that floats)
  wind: 0,             // EXE: MAX_WIND=0 (max initial wind magnitude)
  changeWind: 0,       // EXE: CHANGING_WIND=Off (random walk per turn)

  // Terrain — EXE: ranges.cpp generation params
  landType: 2,         // EXE: LAND_TYPE=Rolling (0=Flat,1=Slope,2=Rolling,3=MTN,4=V,5=Castle,6=Cavern)
  skyType: 0,          // EXE: SKY=Plain (0=Plain,1=Shaded,2=Stars,3=Storm,4=Sunset,5=Black,6=Random)
  land1: 20,           // EXE: LAND1=20 (bumpiness/flat chance %)
  land2: 20,           // EXE: LAND2=20 (terrain slope/frequency)
  numPeaks: 20,        // EXE: NUM_PEAKS=20
  randomLand: 0,       // EXE: RANDOM_LAND=Off

  // Players
  numPlayers: 2,       // EXE: PLAYERS=2
  rounds: 10,          // EXE: ROUNDS=10
  armsLevel: 4,        // EXE: ARMS=4 (gates weapon availability at struct +08)

  // Scoring — EXE: score.cpp modes
  scoringMode: 0,      // EXE: SCORING=Standard (0=Standard, 1=Corporate, 2=Vicious)

  // Walls — EXE: ELASTIC config variable DS:0x5154
  wallType: 5,         // EXE: WALLS=Concrete (0=None,1=Wrap,2=Padded,3=Rubber,4=Spring,5=Concrete,6=Random,7=Erratic)

  // Economy — EXE: equip.cpp shop system
  startCash: 1000000,  // EXE: INITIAL_CASH=1000000
  interest: 30,        // EXE: INTEREST_RATE=0.300000 (30% applied between rounds)
  freeTurns: 5,        // EXE: FREE_TURNS=5
  freeMarket: 0,       // EXE: FREE_MARKET=Off (DS:0x514A) — dynamic weapon pricing

  // Misc
  talkingTanks: 0,     // EXE: TALKING_TANKS=Off (0=Off, 1=Computers, 2=All)
  playOrder: 0,        // EXE: PLAY_ORDER=Random (0=Random,1=Losers-First,2=Winners-First,3=Round-Robin,4=Sequential)

  // Sound
  soundEnabled: 1,     // EXE: SOUND=On
  flySoundEnabled: 0,  // EXE: FLY_SOUND=Off (in-flight projectile tone, can be annoying)

  // Additional gameplay options
  fallingTanks: 1,       // EXE: FALLING_TANKS=On (DS:0x5162) — tanks fall when terrain removed
  impactDamage: 1,       // EXE: DAMAGE_TANKS_ON_IMPACT=On (DS:0x5114) — 0=per-step, 1=on-impact
  explosionScale: 2,     // EXE: EXPLOSION_SCALE=Large (0=Small/0.5x, 1=Medium/1x, 2=Large/1.5x)
  tracePaths: 0,         // EXE: permanent projectile trails
  extraDirt: 0,          // EXE: debris scatter from explosions
  playMode: 0,           // EXE: 0=Sequential, 1=Simultaneous, 2=Synchronous
  hostileEnvironment: 1, // EXE: HOSTILE_ENVIRONMENT=On (DS:0x513C) — 1 damage per tank pixel traversed by projectile
  talkProbability: 100,  // EXE: % chance of speech on fire/death

  // Economics
  computersBuy: 0,       // EXE: COMPUTERS_BUY (0=Basic, 1=Greedy, 2=Erratic, 3=Random)

  // Landscape
  flattenPeaks: 0,       // EXE: FLATLAND=Off (flatten terrain peaks)
  mtnPercent: 20,        // EXE: MTN_PERCENT=20.0 (% chance of scanned mountain vs procedural)

  // Play options
  bombIcon: 1,           // EXE: BOMB_ICON=Big (0=Small, 1=Big, 2=Invisible)
  tunneling: 1,          // EXE: TUNNELLING=On (weapons dig through terrain)
  uselessItems: 0,       // EXE: USELESS_ITEMS=Off (include joke/novelty items)
  teamMode: 0,           // EXE: TEAM_MODE=None (0=None, 1=On)
  statusBar: 1,          // EXE: STATUS_BAR=On (show status bar)
};

// Keys to persist in localStorage (exclude derived/constant values)
const PERSIST_KEYS = [
  'graphicsMode',
  'gravity', 'viscosity', 'edgesExtend', 'suspendDirt', 'wind', 'changeWind',
  'landType', 'skyType', 'wallType', 'land1', 'land2', 'randomLand',
  'numPlayers', 'rounds', 'armsLevel',
  'scoringMode', 'startCash', 'interest', 'freeTurns', 'freeMarket',
  'talkingTanks', 'playOrder',
  'soundEnabled', 'flySoundEnabled',
  'fallingTanks', 'impactDamage', 'explosionScale', 'tracePaths', 'extraDirt',
  'playMode', 'hostileEnvironment', 'talkProbability',
  'computersBuy', 'flattenPeaks', 'mtnPercent',
  'bombIcon', 'tunneling', 'uselessItems', 'teamMode', 'statusBar',
];

const STORAGE_KEY = 'scorched_earth_config';

export function saveConfig() {
  try {
    const data = {};
    for (const key of PERSIST_KEYS) {
      data[key] = config[key];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // localStorage unavailable or full
  }
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const key of PERSIST_KEYS) {
      if (key in data && typeof data[key] === typeof config[key]) {
        config[key] = data[key];
      }
    }
  } catch (e) {
    // Corrupt data — ignore
  }
}

// Apply graphics mode → update screenWidth/screenHeight from mode table
export function applyGraphicsMode() {
  const mode = GRAPHICS_MODES[config.graphicsMode] || GRAPHICS_MODES[0];
  config.screenWidth = mode.w;
  config.screenHeight = mode.h;
}

loadConfig();
applyGraphicsMode();
