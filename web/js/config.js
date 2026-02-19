// Scorched Earth - Game configuration defaults (from SCORCH.CFG RE)

export const config = {
  // Screen
  screenWidth: 320,
  screenHeight: 200,

  // Physics
  gravity: 1.0,        // GRAVITY=1.000000
  viscosity: 0,        // VISCOSITY=0 (air resistance: factor = 1.0 - viscosity/10000)
  wind: 5,             // WIND=5 (max initial wind)
  changeWind: 1,       // CHANGE_WIND=On

  // Terrain
  landType: 2,         // LAND_TYPE=Rolling (0=Flat,1=Slope,2=Rolling,3=MTN,4=V,5=Castle,6=Cavern)
  skyType: 0,          // SKY=Plain (0-7)
  land1: 20,           // LAND1=20 (bumpiness)
  land2: 0,            // LAND2=0 (slope component)
  numPeaks: 20,        // NUM_PEAKS=20
  randomLand: 0,       // RANDOM_LAND=Off

  // Players
  numPlayers: 2,       // PLAYERS=2
  rounds: 10,          // ROUNDS=10
  armsLevel: 0,        // ARMS_LEVEL=0

  // Scoring
  scoringMode: 0,      // SCORING=Standard (0=Standard, 1=Bonus, 2=FreeMarket)

  // Walls
  wallType: 0,         // WALLS=Concrete (0=Concrete,1=Rubber,2=Spring,3=Wrap,4=None)

  // Economy
  startCash: 25000,    // START_CASH=25000
  interest: 10,        // INTEREST=10 (%)
  freeTurns: 5,        // FREE_TURNS=5

  // Misc
  talkingTanks: 1,     // TALKING=On
  playOrder: 0,        // PLAY_ORDER=Sequential
};
