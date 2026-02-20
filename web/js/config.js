// Scorched Earth - Game configuration defaults
// EXE: parsed from SCORCH.CFG text file at startup
// EXE: config strings at file region identified in disasm/config_strings_region.txt
// EXE: values stored in DS data segment, referenced throughout gameplay code

export const config = {
  // Screen — EXE: VGA Mode 13h = 320×200, 256 colors
  screenWidth: 320,
  screenHeight: 200,

  // Physics — EXE: from SCORCH.CFG, used in extras.cpp physics loop
  gravity: 1.0,        // EXE: GRAVITY=1.000000 (scaled to 4.9 px/sec² in physics.js)
  viscosity: 0,        // EXE: VISCOSITY=0 (factor = 1.0 - viscosity/10000)
  wind: 5,             // EXE: WIND=5 (max initial wind magnitude)
  changeWind: 1,       // EXE: CHANGE_WIND=On (random walk per turn)

  // Terrain — EXE: ranges.cpp generation params
  landType: 2,         // EXE: LAND_TYPE=Rolling (0=Flat,1=Slope,2=Rolling,3=MTN,4=V,5=Castle,6=Cavern)
  skyType: 0,          // EXE: SKY=Plain (0=Plain,1=Shaded,2=Stars,3=Storm,4=Sunset,5=Cavern,6=Black)
  land1: 20,           // EXE: LAND1=20 (bumpiness/flat chance %)
  land2: 0,            // EXE: LAND2=0 (slope component)
  numPeaks: 20,        // EXE: NUM_PEAKS=20
  randomLand: 0,       // EXE: RANDOM_LAND=Off

  // Players
  numPlayers: 2,       // EXE: PLAYERS=2
  rounds: 10,          // EXE: ROUNDS=10
  armsLevel: 0,        // EXE: ARMS_LEVEL=0 (gates weapon availability at struct +08)

  // Scoring — EXE: score.cpp modes
  scoringMode: 0,      // EXE: SCORING=Standard (0=Standard, 1=Corporate, 2=Vicious)

  // Walls — EXE: physics wall collision types (reordered to match EXE enum)
  wallType: 7,         // EXE: WALLS=Concrete (0=None,1=Erratic,2=Random,3=Wrap,4=Padded,5=Rubber,6=Spring,7=Concrete)

  // Economy — EXE: equip.cpp shop system
  startCash: 25000,    // EXE: START_CASH=25000
  interest: 10,        // EXE: INTEREST=10 (% applied between rounds)
  freeTurns: 5,        // EXE: FREE_TURNS=5

  // Misc
  talkingTanks: 1,     // EXE: TALKING=On (comments.cpp speech bubbles)
  playOrder: 0,        // EXE: PLAY_ORDER=Sequential (0=Sequential,1=Simultaneous,2=Synchronous)

  // Sound
  soundEnabled: 1,     // EXE: SOUND=On
  flySoundEnabled: 0,  // EXE: FLY_SOUND=Off (in-flight projectile tone, can be annoying)

  // Additional gameplay options
  fallingTanks: 1,       // EXE: toggle fall damage
  explosionScale: 1,     // 0=Small(0.5x), 1=Medium(1x), 2=Large(1.5x)
  tracePaths: 0,         // EXE: permanent projectile trails
  extraDirt: 0,          // EXE: debris scatter from explosions
  playMode: 0,           // EXE: 0=Sequential, 1=Simultaneous, 2=Synchronous
  hostileEnvironment: 0, // EXE: random lightning/meteor events
  talkProbability: 100,  // EXE: % chance of speech on fire/death
};

// Keys to persist in localStorage (exclude derived/constant values)
const PERSIST_KEYS = [
  'gravity', 'viscosity', 'wind', 'changeWind',
  'landType', 'skyType', 'wallType',
  'numPlayers', 'rounds', 'armsLevel',
  'scoringMode', 'startCash', 'interest', 'freeTurns',
  'talkingTanks', 'playOrder',
  'soundEnabled', 'flySoundEnabled',
  'fallingTanks', 'explosionScale', 'tracePaths', 'extraDirt',
  'playMode', 'hostileEnvironment', 'talkProbability',
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

loadConfig();
