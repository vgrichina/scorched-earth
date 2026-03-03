# Scorched Earth Web Port Architecture

## Module Dependency Graph

```
                          +----------+
                          | main.js  |  Entry point + requestAnimationFrame loop
                          +----+-----+
                               |
          +----------+---------+---------+----------+
          |          |         |         |          |
     +----v---+ +---v----+ +-v------+ +-v------+ +-v-----+
     |config  | |frame-  | |palette | |input   | |game   |
     |settings| |buffer  | |VGA DAC | |kbd+mouse |state  |
     +--------+ |pixel   | +--------+ +--------+ |machine|
                |buffer  |                        +---+---+
                +--------+                            |
                                     +------+---------+-----+------+
                                     |      |         |     |      |
                               +-----v+ +--v---+ +--v--+ +v----+ +v------+
                               |terrain| |tank  | |phys | |weap| |behav  |
                               |gen+   | |player| |proj | |data| |on-hit |
                               |render | |state | |step | |table|+in-flt|
                               +-------+ +------+ +-----+ +----+ +-------+
                                                     |
                           +------------+------------+----------+
                           |            |            |          |
                     +-----v---+ +-----v---+ +-----v--+ +-----v---+
                     |explosions| |shields  | |score   | |talk     |
                     |crater+  | |absorb+  | |damage+ | |speech   |
                     |animate  | |deflect  | |kills   | |bubbles  |
                     +---------+ +---------+ +--------+ +---------+

     +--------+  +--------+  +--------+  +--------+  +--------+
     | hud.js |  | shop.js|  | menu.js|  | sound.js|  | ai.js  |
     | display|  | buy/   |  | config |  | WebAudio|  | solver |
     | widgets|  | sell   |  | dialogs|  | tones   |  | target |
     +--------+  +--------+  +--------+  +--------+  +--------+

     +-----------+  +------------+
     | utils.js  |  |constants.js|   Shared by all modules
     | PRNG,math |  |colors,sizes|
     +-----------+  +------------+
```

## 23 Modules — Purpose & Exports

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| **main.js** | Entry point, animation loop, world draw | `init()`, `gameLoop()`, `redrawWorld()` |
| **game.js** | State machine, turn logic, wind, system menu | `game`, `STATE`, `gameTick()`, `generateWind()`, `getCurrentPlayer()`, `initGameRound()`, `SYSTEM_MENU_OPTIONS` |
| **config.js** | Mutable settings, graphics modes | `config`, `saveConfig()`, `GRAPHICS_MODES`, `applyGraphicsMode()` |
| **framebuffer.js** | 256-color pixel buffer, WebGL/Canvas2D | `initFramebuffer()`, `blit()`, `setPixel()`, `getPixel()`, `fillRect()`, `hline()`, `vline()`, `drawBox3DRaised()`, `drawBox3DSunken()`, `setBackground()`, `clearToBackground()` |
| **palette.js** | VGA 256-entry palette management | `initPalette()`, `palette6`, `palette32`, `setupPlayerPalette()`, `setupSkyPalette()`, `setupTerrainPalette()`, `setupExplosionPalette()`, `tickAccentPalette()`, `BLACK`, `LASER_GREEN`, `LASER_WHITE` |
| **font.js** | 12px proportional bitmap text | `drawText()`, `drawTextShadow()`, `drawTextEmbossed()`, `measureText()`, `FONT_HEIGHT` |
| **terrain.js** | Height map generation + rendering | `generateTerrain()`, `drawTerrain()`, `drawSky()`, `terrain`, `ceilingTerrain`, `getTerrainY()`, `PLAYFIELD_TOP`, `HUD_HEIGHT` |
| **tank.js** | Player state array + tank rendering | `players`, `createPlayer()`, `drawAllTanks()`, `drawTank()`, `placeTanks()`, `resetAndPlaceTanks()`, `stepFallingTanks()`, `checkTanksFalling()`, `startDeathAnimation()`, `drawDeathAnimations()` |
| **physics.js** | Projectile position/velocity stepping | `projectiles`, `launchProjectile()`, `createProjectile()`, `spawnProjectiles()`, `stepSingleProjectile()`, `hasActiveProjectiles()`, `WALL`, `DT`, `applyMagDamping()` |
| **weapons.js** | 57-weapon data table + constants | `WEAPONS`, `WPN`, `BHV`, `CATEGORY`, `cycleWeapon()`, `createInventory()` |
| **behaviors.js** | On-hit + in-flight weapon handlers | `handleBehavior()`, `handleFlightBehavior()`, `applyGuidance()`, `selectGuidanceType()`, `napalmParticleStep()` |
| **explosions.js** | Crater/dirt creation + explosion animation | `createCrater()`, `addDirt()`, `addDirtTower()`, `createTunnel()`, `applyDisrupter()`, `startExplosion()`, `stepExplosion()`, `applyExplosionDamage()`, `screenFlash` |
| **shields.js** | Shield activation + damage absorption | `activateShield()`, `applyShieldDamage()`, `checkShieldDeflection()`, `handleShieldHit()`, `drawShield()`, `drawShieldBreak()`, `SHIELD_TYPE`, `SHIELD_CONFIG`, `shieldBreak` |
| **ai.js** | AI trajectory solver (8 levels) | `isAI()`, `startAITurn()`, `stepAITurn()`, `aiComputeShot()`, `setAIWind()`, `resetAINoise()`, `AI_TYPE`, `AI_NAMES` |
| **menu.js** | Main menu + player setup screens | `menuTick()`, `drawMainMenu()`, `drawPlayerSetupScreen()`, `resetMenuState()`, `menu`, `playerSetup`, `initPlayerSetup()` |
| **hud.js** | Two-row HUD with icons + bars | `drawHud()`, `drawWindIndicator()` |
| **shop.js** | Equipment shop between rounds | `openShop()`, `closeShop()`, `shopTick()`, `drawShop()`, `initMarket()`, `mktUpdate()`, `aiAutoPurchase()` |
| **score.js** | Scoring + interest calculations | `scoreOnDamage()`, `scoreOnDeath()`, `endOfRoundScoring()`, `applyInterest()`, `getLeaderboard()`, `SCORE_MODE` |
| **talk.js** | Speech bubbles on fire/death | `triggerAttackSpeech()`, `triggerDeathSpeech()`, `stepSpeechBubble()`, `drawSpeechBubble()`, `bubble` |
| **sound.js** | PC speaker emulation via WebAudio | `initSound()`, `toggleSound()`, `playFireSound()`, `playExplosionSound()`, `playFlightSound()`, `playDeathSound()`, `playTerrainGenPing()`, `playShieldHitSound()`, `playLightningSound()` |
| **input.js** | Keyboard + mouse event tracking | `mouse`, `initInput()`, `isKeyDown()`, `consumeKey()`, `consumeAnyKey()`, `consumeClick()`, `getMouseDelta()` |
| **utils.js** | PRNG (xorshift32), math, Bresenham | `seedRandom()`, `random()`, `clamp()`, `vga6to8()`, `bresenhamLine()` |
| **constants.js** | Color indices, thresholds, palette offsets | `UI_HIGHLIGHT`, `UI_DARK_TEXT`, `UI_DARK_BORDER`, `UI_BACKGROUND`, `UI_LIGHT_ACCENT`, `UI_DEEP_SHADOW`, `UI_LIGHT_BORDER`, `UI_MED_BORDER`, `UI_BRIGHT_BORDER`, `PLAYER_COLOR_MAX`, `TERRAIN_THRESHOLD`, `SKY_PAL_START`, `TERRAIN_PAL_START`, `FIRE_PAL_BASE` |

## State Machine (game.js)

```
                  +-------+
                  | TITLE |  Initial state (treated same as CONFIG)
                  +---+---+
                      | (immediate)
                  +---v----+
                  | CONFIG |  Main menu
                  +---+----+
                      |  ~Start
               +------v--------+
               | PLAYER_SETUP  |  Name/color/AI per player
               +------+--------+
                      | (first round goes direct to AIM)
                      |
              +-------v-------+
          +-->|     SHOP      |  Buy/sell equipment (round >= 2)
          |   +------+--------+
          |          |  (all players done)
          |   +------v--------+
          |   |  ROUND_SETUP  |  Battery check; terrain regen; place tanks
          |   +------+--------+
          |          |
          |   +------v--------+
          |   |  SCREEN_HIDE  |  "No Kibitzing" (hot-seat between humans)
          |   +------+--------+
          |          |
          |   +------v--------+
          +---|      AIM      |<-----------+
              +------+--------+            |
                     | Space / AI fire     |
              +------v--------+            |
              |    FLIGHT     |            |
              |  (per-frame   |            |
              |   physics)    |            |
              +------+--------+            |
                     | collision           |
              +------v--------+            |
              |   EXPLOSION   |            |
              |  (ring anim)  |            |
              +------+--------+            |
                     |                     |
              +------v--------+            |
              |    FALLING    |            |
              |  (settle)     |            |
              +------+--------+            |
                     |                     |
              +------v--------+            |
              |   NEXT_TURN   +------------+
              +------+--------+  (alive > 1)
                     |
               (alive <= 1)
              +------v--------+
              |  ROUND_OVER   |
              +------+--------+
                     |                    (rounds exhausted)
              +------v--------+          +---------------+
              |     SHOP      |--------->|   GAME_OVER   |
              +---------------+          +---------------+
              (more rounds)

  F9 at any time --> SYSTEM_MENU overlay (resumes on dismiss)

  Simultaneous/Synchronous play modes (config.playMode >= 1):
    AIM replaced by SYNC_AIM → SYNC_FIRE → EXPLOSION/FALLING/...
    SYNC_AIM: players aim one-by-one (aims queued)
    SYNC_FIRE: all queued projectiles launch simultaneously
```

## Game Loop (requestAnimationFrame)

```
main.js gameLoop()  [called ~60 fps]
|
+-- if STATE == TITLE or CONFIG or PLAYER_SETUP:
|     menuTick()       -- handle menu input, draw menu
|     blit()           -- upload framebuffer to GPU
|     return
|
+-- if STATE == SHOP:
|     gameTick()        -- shop logic
|     drawShop()        -- shop UI
|     blit()
|     return
|
+-- if STATE == GAME_OVER:
|     drawGameOver()
|     blit()
|     return
|
+-- Main gameplay states (AIM, FLIGHT, EXPLOSION, FALLING, etc.):
|
|   [1] redrawWorld()
|   |   drawSky()           -- gradient background per sky type
|   |   drawTerrain()       -- per-pixel terrain bitmap
|   |   drawAllTanks()      -- dome + body + barrel per alive tank
|   |   drawShield()        -- per active shield
|   |
|   [2] gameTick()          -- game.js state logic
|   |   |
|   |   +-- AIM state:
|   |   |   handleAimInput()   -- arrow keys / mouse delta
|   |   |   Tab: cycleWeapon()
|   |   |   Space: fireWeapon() --> launchProjectile()
|   |   |   AI: startAITurn() -> stepAITurn()
|   |   |
|   |   +-- FLIGHT state:
|   |   |   stepSingleProjectile() per active projectile
|   |   |     apply gravity (4.9), wind (0.15*wind), viscosity
|   |   |     check collision via getPixel() color thresholds
|   |   |   handleFlightBehavior() (MIRV apogee, roller follow)
|   |   |   on collision --> handleBehavior() --> STATE.EXPLOSION
|   |   |
|   |   +-- EXPLOSION state:
|   |   |   stepExplosion()    -- animate expanding fire ring
|   |   |   createCrater()     -- carve terrain pixels
|   |   |   applyExplosionDamage() --> scoreOnDamage()
|   |   |   --> STATE.FALLING
|   |   |
|   |   +-- FALLING state:
|   |   |   stepFallingTanks() -- gravity settling
|   |   |   applyImpactDamage() if config.impactDamage
|   |   |   --> STATE.NEXT_TURN
|   |   |
|   |   +-- NEXT_TURN state:
|   |       check alive count
|   |       advancePlayer() --> STATE.AIM or STATE.ROUND_OVER
|   |
|   [3] Overlay rendering
|   |   drawHud()              -- power bar, angle, wind, ammo
|   |   drawLaserSight()       -- barrel sight line (if Laser weapon)
|   |   drawAllProjectiles()   -- trail + projectile head
|   |   drawShieldBreak()      -- shield impact ring animation
|   |   drawSpeechBubble()     -- attack/death talk text
|   |   screenFlash()          -- white-out fade
|   |
|   [4] blit()                 -- upload pixel buffer to canvas
```

## Shared State Objects

```
config (config.js) -- mutable settings, persisted to localStorage
|
+-- Graphics:  graphicsMode, screenWidth, screenHeight
+-- Physics:   gravity, viscosity, edgesExtend, suspendDirt, wind,
|              changeWind, wallType
+-- Terrain:   landType, skyType, land1, land2, numPeaks, mtnPercent,
|              randomLand, flattenPeaks
+-- Gameplay:  numPlayers, rounds, armsLevel, scoringMode, playOrder,
|              playMode, hostileEnvironment, bombIcon, tunneling,
|              uselessItems, teamMode, statusBar, explosionScale,
|              tracePaths, extraDirt
+-- Economy:   startCash, interest, freeTurns, freeMarket, computersBuy
+-- Misc:      talkingTanks, talkProbability, soundEnabled,
|              flySoundEnabled, fallingTanks, impactDamage

game (game.js) -- runtime game state
|
+-- state:                current STATE enum value
+-- round:                current round number (1-based)
+-- currentPlayer:        active player index
+-- turnOrder[]:          computed turn sequence per round
+-- turnOrderIdx:         position within current turn order
+-- wind:                 current horizontal wind force
+-- guidedActive:         guided missile currently steering
+-- warQuote:             between-round quote text
+-- roundOverTimer:       frames displayed on round-over screen
+-- shopPlayerIdx:        index of player currently shopping
+-- aimQueue[]:           stored aims for SYNC_AIM/SYNC_FIRE mode
+-- syncPlayerIdx:        player aiming in sync mode
+-- aimTimer:             countdown for simultaneous aim phase
+-- hostileLightningX/Frames: hostile environment lightning state
+-- screenHideTarget:     target player index for "No Kibitzing"
+-- systemMenuOption/Actions/Confirm/PendingAction: F9 system menu

players[] (tank.js) -- per-player state, 10 max
|
+-- index, name
+-- x, y (center-x, ground-y on screen)
+-- angle (0=right, 90=up, 180=left), power (0-1000)
+-- selectedWeapon (weapon index)
+-- inventory[] (per-weapon ammo counts, indexed by WPN.*)
+-- alive, energy (HP 0-100)
+-- cash, score, wins, earnedInterest
+-- activeShield (SHIELD_TYPE index), shieldEnergy
+-- aiType (0=HUMAN, 1-8=computer levels)
+-- falling, fallStartY, fallDamageAccum, parachuteDeployed
+-- team (0-based team index; default = player index)

projectiles[] (physics.js) -- active projectile pool
|
+-- active, x, y, vx, vy
+-- weaponIdx, attackerIdx
+-- trail[] (position history for drawing)
+-- age (frames since launch)
+-- isSubWarhead, subRadius   (MIRV children)
+-- isNapalmParticle, napalmLife, isDirtParticle
+-- rolling, bounceCount      (roller behavior)
+-- hasSplit                  (MIRV already split)
+-- prevVy                    (apogee detection)
+-- superMagActive            (bypasses Mag Deflector)

terrain (terrain.js) -- height array
  terrain[x] = Y position of ground at column x
  ceilingTerrain[x] = Y position of ceiling (cavern mode)

terrainBitmap (terrain.js) -- per-pixel collision/draw buffer
  terrainBitmap[y * width + x] = palette color index (0 = sky)
```

## Rendering Pipeline

```
VGA-style indexed framebuffer (not direct RGBA):

  pixels[]  (Uint8Array, W*H)     palette32[]  (Uint32Array, 256)
  +--------+                       +---------+
  | index  |---palette lookup--->  | RGBA    |
  | buffer |                       | entries |
  +--------+                       +---------+
       |                                |
       v                                v
  [WebGL path]                    [Canvas2D path]
  Upload as GL texture            Build ImageData from
  Palette as uniform array        palette-expanded RGBA
  Fragment shader does lookup     putImageData to canvas
       |                                |
       +-----------> <canvas> <---------+

Collision detection uses pixel COLOR, not separate collision map:
  getPixel(x, y) returns palette index
  index < PLAYER_COLOR_MAX (80)  --> tank hit
  index >= TERRAIN_THRESHOLD (105) --> terrain hit
  else --> sky (no collision)

Palette regions:
  VGA 0-79:    Player colors (8 per player × 10 players; PLAYER_COLOR_MAX=80)
  VGA 80-104:  Sky gradient (SKY_PAL_START=80, SKY_PAL_COUNT=25; 104=unused)
  VGA 105-119: Reserved / sky overlap
  VGA 120-149: Terrain gradient (TERRAIN_PAL_START=120, TERRAIN_PAL_COUNT=30)
  VGA 150-169: UI grays (status bars, HUD backgrounds)
  VGA 170-199: Fire/explosion palette (FIRE_PAL_BASE=170, FIRE_PAL_COUNT=30)
  VGA 200-208: UI drawing colors (UI_HIGHLIGHT=200 … UI_BRIGHT_BORDER=208)
  VGA 209-251: Unused
  VGA 252:     BLACK (solid black)
  VGA 253:     LASER_GREEN
  VGA 254:     LASER_WHITE
  VGA 255:     Unused
```

## Event Flow

```
Browser Events                    Game Logic                    Rendering
==============                    ==========                    =========

keydown/keyup ──> input.js        game.js gameTick()            main.js
  keys[code] = bool               |                             |
                                  +-- AIM:                      +-- redrawWorld()
mousemove ──> input.js            |   read keys[]/mouse         |   drawSky()
  mouse.x, .y, .dx, .dy          |   adjust angle/power        |   drawTerrain()
                                  |   Tab: cycle weapon         |   drawAllTanks()
mousedown/up ──> input.js         |   Space: fire               |   drawShield()
  mouse.buttons, .clicked         |                             |
                                  +-- FLIGHT:                   +-- drawHud()
                                  |   stepSingleProjectile()    |   drawProjectiles()
consumeKey() / consumeClick()     |   check collision           |   drawSpeechBubble()
  one-shot read, then clear       |   dispatch behavior         |   screenFlash()
                                  |                             |
                                  +-- EXPLOSION:                +-- blit()
                                  |   stepExplosion()           |   framebuffer -> canvas
                                  |   createCrater()            |
                                  |   applyDamage()             |
                                  |                             |
                                  +-- FALLING:                  |
                                  |   stepFallingTanks()        |
                                  |   applyImpact()             |
                                  |                             |
                                  +-- NEXT_TURN:                |
                                      advance player            |
                                      or end round              |
```

## EXE-to-Web Module Mapping

| EXE Module (segment) | Web Module | Notes |
|----------------------|------------|-------|
| extras.cpp (0x1895) | physics.js + explosions.js + behaviors.js | Split into 3 modules |
| icons.cpp (0x1F7F) | tank.js + hud.js | Tank draw + HUD separated |
| play.cpp (0x28B9) | game.js + main.js | State machine + render loop |
| player.cpp (0x2B3B) | tank.js | Player state in same module |
| ranges.cpp (0x2CBF) | terrain.js | Direct 1:1 mapping |
| score.cpp (0x30B2) | score.js | Direct 1:1 mapping |
| shark.cpp (0x3167) | ai.js | Direct 1:1 mapping |
| shields.cpp (0x31D8) | shields.js | Direct 1:1 mapping |
| menu module (0x34ED) | menu.js | Direct 1:1 mapping |
| equip.cpp (0x16BC) | shop.js | Direct 1:1 mapping |
| comments.cpp (0x1144) | talk.js | Direct 1:1 mapping |
| font module (0x4589) | font.js | Direct 1:1 mapping |
| Fastgraph library | framebuffer.js | VGA primitives replaced |
| DS flat memory | config.js + constants.js | Config split from rendering |
| — (no equivalent) | palette.js | New: explicit palette mgmt |
| — (no equivalent) | input.js | New: browser event handling |
| — (no equivalent) | sound.js | New: WebAudio PC speaker |
| — (no equivalent) | utils.js | New: shared utilities |
| — (no equivalent) | weapons.js | New: weapon table (was DS) |
