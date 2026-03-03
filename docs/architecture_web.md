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
| **main.js** | Entry point, animation loop, world draw | `init()`, `startGame()`, `gameLoop()` |
| **game.js** | State machine, turn logic, fire/collide | `game`, `STATE`, `gameTick()`, `generateWind()` |
| **config.js** | Mutable settings, graphics modes | `config`, `saveConfig()`, `GRAPHICS_MODES` |
| **framebuffer.js** | 256-color pixel buffer, WebGL/Canvas2D | `initFramebuffer()`, `blit()`, `setPixel()`, `getPixel()` |
| **palette.js** | VGA 256-entry palette management | `initPalette()`, `palette6`, `palette32`, color constants |
| **font.js** | 12px proportional bitmap text | `drawText()`, `measureText()`, `FONT_HEIGHT` |
| **terrain.js** | Height map generation + rendering | `generateTerrain()`, `drawTerrain()`, `terrain`, `getTerrainY()` |
| **tank.js** | Player state array + tank rendering | `players`, `createPlayer()`, `drawAllTanks()`, `stepFallingTanks()` |
| **physics.js** | Projectile position/velocity stepping | `projectiles`, `launchProjectile()`, `stepSingleProjectile()` |
| **weapons.js** | 57-weapon data table + constants | `WEAPONS`, `WPN`, `BHV`, `cycleWeapon()` |
| **behaviors.js** | On-hit + in-flight weapon handlers | `handleBehavior()`, `handleFlightBehavior()`, `applyGuidance()` |
| **explosions.js** | Crater creation + explosion animation | `createCrater()`, `startExplosion()`, `applyExplosionDamage()` |
| **shields.js** | Shield activation + damage absorption | `activateShield()`, `applyShieldDamage()`, `SHIELD_TYPE` |
| **ai.js** | AI trajectory solver (7 levels) | `isAI()`, `startAITurn()`, `stepAITurn()`, `AI_TYPE` |
| **menu.js** | Main menu + player setup screens | `menuTick()`, `drawMainMenu()`, `playerSetup` |
| **hud.js** | Two-row HUD with icons + bars | `drawHud()` |
| **shop.js** | Equipment shop between rounds | `openShop()`, `shopTick()`, `drawShop()` |
| **score.js** | Scoring + interest calculations | `scoreOnDamage()`, `scoreOnDeath()`, `applyInterest()` |
| **talk.js** | Speech bubbles on fire/death | `triggerAttackSpeech()`, `triggerDeathSpeech()` |
| **sound.js** | PC speaker emulation via WebAudio | `initSound()`, `playFireSound()`, `playExplosionSound()` |
| **input.js** | Keyboard + mouse event tracking | `mouse`, `isKeyDown()`, `consumeKey()`, `consumeClick()` |
| **utils.js** | PRNG (xorshift32), math, Bresenham | `seedRandom()`, `random()`, `clamp()`, `vga6to8()` |
| **constants.js** | Color indices, thresholds, sizes | `UI_*`, `PLAYER_COLOR_*`, `TERRAIN_THRESHOLD` |

## State Machine (game.js)

```
                     +--------+
                     | CONFIG |  Main menu
                     +---+----+
                         |  ~Start
                  +------v--------+
                  | PLAYER_SETUP  |  Name/color/AI per player
                  +------+--------+
                         |
                  +------v--------+
              +-->|     SHOP      |  Buy/sell equipment (round > 1)
              |   +------+--------+
              |          |
              |   +------v--------+
              |   |  SCREEN_HIDE  |  "No Kibitzing" (hot-seat AI)
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
                         |
                  +------v--------+     +------v--------+
                  |     SHOP      |---->|   GAME_OVER   |
                  +---------------+     +---------------+
                  (more rounds)         (rounds exhausted)

  F9 at any time --> SYSTEM_MENU (overlay, resumes on dismiss)

  Simultaneous play modes use SYNC_AIM / SYNC_FIRE states
  (all players aim concurrently, then fire in sequence)
```

## Game Loop (requestAnimationFrame)

```
main.js gameLoop()  [called ~60 fps]
|
+-- if STATE == CONFIG or PLAYER_SETUP:
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
+-- Graphics: mode, screenWidth, screenHeight, aspectRatio
+-- Physics:  gravity, viscosity, wind, changeWind, wallType
+-- Terrain:  landType, skyType, land1, land2, numPeaks, mtnPercent
+-- Gameplay: numPlayers, rounds, scoringMode, playOrder, playMode
+-- Economy:  startCash, interest, freeTurns, freeMarket
+-- Misc:     talkingTanks, soundEnabled, fallingTanks, impactDamage

game (game.js) -- runtime game state
|
+-- state:           current STATE enum value
+-- round:           current round number (1-based)
+-- currentPlayer:   active player index
+-- turnOrder[]:     computed turn sequence per round
+-- wind:            current horizontal wind force
+-- guidedActive:    guidance weapon in flight
+-- explosion:       { x, y, radius, frame, ... }
+-- warQuote:        between-round quote text

players[] (tank.js) -- per-player state, 10 max
|
+-- index, name, color
+-- x, y (world position)
+-- angle, power (turret aiming)
+-- selectedWeapon (weapon index)
+-- inventory[] (per-weapon ammo counts)
+-- alive, energy (HP 0-100)
+-- cash, score, wins
+-- activeShield, shieldEnergy
+-- aiType (0=HUMAN, 1-8=computer)
+-- falling, fallStartY, fallVelocity
+-- deathAnimation { active, frame }

projectiles[] (physics.js) -- active projectile pool
|
+-- x, y, vx, vy
+-- active, weaponIdx, attackerIdx
+-- trail[] (position history for drawing)
+-- guidanceType, magDeflection
+-- mirvSplit, napalmParticle

terrain (terrain.js) -- height array
  terrain[x] = Y position of ground at column x

terrainBitmap (terrain.js) -- per-pixel collision bitmap
  terrainBitmap[y * width + x] = color index (0 = sky)
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
  VGA 0-79:    Player colors (8 per player, 10 players)
  VGA 80-103:  Sky gradient (25 entries)
  VGA 104:     Black separator
  VGA 105-119: Reserved
  VGA 120-149: Terrain gradient (30 entries)
  VGA 150-169: UI palette (grays, highlight, shadow)
  VGA 170-199: Fire/explosion palette (30 entries)
  VGA 200-208: UI accent colors (shop, HUD)
  VGA 240-255: System colors (white, laser, cursor)
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
