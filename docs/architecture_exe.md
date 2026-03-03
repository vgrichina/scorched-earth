# Scorched Earth v1.50 EXE Architecture

## Binary Layout

```
+------------------------------------------------------+
| MZ DOS Header + Relocations        0x0000 - 0x69FF   |
+------------------------------------------------------+
| Code Segments (per .cpp file)      0x6A00 - 0x4F37F   |
|   comments.cpp  seg 0x1144  base 0x17E40              |
|   equip.cpp     seg 0x16BC  base 0x1D560              |
|   extras.cpp    seg 0x1895  base 0x20EA0              |
|   icons.cpp     seg 0x1F7F  base 0x263F0              |
|   play.cpp      seg 0x28B9  base 0x2F830              |
|   player.cpp    seg 0x2B3B  base 0x31FB0              |
|   ranges.cpp    seg 0x2CBF  base 0x33690              |
|   score.cpp     seg 0x30B2  base 0x37520              |
|   shark.cpp     seg 0x3167  base 0x38070              |
|   shields.cpp   seg 0x31D8  base 0x38780              |
|   HUD bars      seg 0x3249  base 0x38E90              |
|   menu module   seg 0x34ED  base 0x3B8D0              |
|   team.cpp      seg 0x3A56  base 0x40F60              |
|   font module   seg 0x4589  base 0x4C290              |
|   weapon handlers (8 segments, various)               |
+------------------------------------------------------+
| Data Segment (DS base 0x4F38)      0x55D80 - EOF      |
|   Weapon structs   DS:0x11F6  (57 x 52 bytes)        |
|   Icon bitmaps     DS:0x3826  (48 x 125 bytes)       |
|   Config variables DS:0x5100 - 0x51FF                 |
|   Float constants  DS:0x5178 - 0x5830+                |
|   Format strings   DS:0x5700 - 0x6500+                |
|   Font glyph data  DS:0x70E4 - 0x94EA                |
|   Player array     DS:0xCEB8  (10 x 108 bytes)       |
|   Talk data        DS:0xCC8E  (attack) / CC94 (die)  |
|   Sub-struct array DS:0xD568  (10 x 202 bytes)       |
|   Equip init vars  DS:0xD546 - 0xD566                |
|   HUD layout vars  DS:0xE344 - 0xEA04                |
|   Fastgraph ptrs   DS:0xEEF4 - 0xEF14                |
|   Drawing colors   DS:0xEF22 - 0xEF46                |
|   Font selector    DS:0xED58                          |
+------------------------------------------------------+
```

## Module Call Graph

```
                        +-----------+
                        |  STARTUP  |
                        |  (entry)  |
                        +-----+-----+
                              |
                    parse SCORCH.CFG
                              |
                    +---------v---------+
                    |    menu module    |
                    |   seg 0x34ED     |
                    | main_menu()      |
                    | config dialogs   |
                    +----+--------+----+
                         |        |
            terrain preview     ~Start pressed
                 |                |
       +---------v----+    +------v-------+
       | ranges.cpp   |   | player.cpp   |
       | terrain gen  |   | alloc/init   |
       +--------------+   +------+-------+
                                 |
                          +------v-------+
                          |  play.cpp    |
                          |  game_loop() |
                          +------+-------+
                                 |
          +----------+-----------+-----------+----------+
          |          |           |           |          |
    +-----v---+ +---v-----+ +--v------+ +--v----+ +---v------+
    |shark.cpp| |extras.cpp| |comments | |score  | |equip.cpp |
    |AI solver| |projectile| |talk     | |scoring| |shop      |
    |         | |physics   | |bubbles  | |       | |buy/sell  |
    +---------+ +----+-----+ +---------+ +-------+ +----------+
                     |
          +----------+-----------+
          |          |           |
    +-----v---+ +---v-----+ +--v------+
    |shields  | |weapon   | |icons.cpp|
    |absorb   | |handlers | |tank draw|
    |deflect  | |(8 segs) | |HUD icons|
    +---------+ +---------+ +---------+
                     |
    +----------------+----------------+
    |        |       |       |        |
  0x3D1E  0x25D5  0x2FBD  0x26E6  0x1DCE ...
  missile  MIRV   roller  napalm  funky
```

## Per-Turn Execution Flow

```
play.cpp game_loop()
|
+-- Per Round:
|   |
|   +-- ranges.cpp: generate terrain + sky palette
|   +-- player.cpp: spawn tanks on terrain
|   +-- equip.cpp: shop phase (if rounds > 1)
|   |
|   +-- Per Turn:
|       |
|       +-- [1] Wind
|       |   generate_wind() at 0x2943A
|       |   formula: rand(MAX_WIND) - MAX_WIND/4
|       |   nested doubling: 8% chance x4
|       |   clamp to +/- DS:515C
|       |
|       +-- [2] AI targeting (if computer player)
|       |   shark.cpp ai_select_target() at 0x254AF
|       |   shark.cpp ai_inject_noise() at 0x25DE9
|       |   pixel-level ray-march trajectory solver
|       |
|       +-- [3] Fire weapon
|       |   extras.cpp fire_weapon() at 0x21D7F
|       |   spawns projectile in player struct
|       |   sets callback far ptr to handler segment
|       |
|       +-- [4] Physics loop (per frame)
|       |   extras.cpp physics_step()
|       |   |
|       |   +-- Read velocity from player struct (+0x04, +0x0C)
|       |   +-- Apply gravity_step (DS:CE9C)
|       |   +-- Apply wind_step (DS:CEA4)
|       |   +-- Apply viscosity factor (DS:5178)
|       |   +-- Update world position (+0x14, +0x1C)
|       |   +-- Check collision (fg_getpixel)
|       |   +-- If hit: dispatch weapon handler
|       |
|       +-- [5] Explosion / damage
|       |   extras.cpp DoExplosion() at 0x20EAD
|       |   |
|       |   +-- Iterate all players (DS:CEB8 + i*0x6C)
|       |   +-- Distance check vs blast_radius
|       |   +-- shields.cpp: check absorption
|       |   +-- Apply remaining damage to HP
|       |   +-- score.cpp: award points
|       |   +-- comments.cpp: trigger talk bubble
|       |
|       +-- [6] Tank falling (gravity settling)
|       |   player.cpp: drop tanks to new terrain
|       |   damage: 2 * fall_distance (if impact mode)
|       |
|       +-- [7] Death check
|       |   comments.cpp: death comment
|       |   score.cpp: kill bonus
|       |
|       +-- [8] Next player / round over check
```

## Shared Data Segment Architecture

All modules share a single flat Data Segment (DS). No encapsulation.
Writers and readers access the same memory directly via DS:offset.

```
DS Layout (key regions)
================================================================

Config flags (set by menu, read by game logic):
  DS:5110  sky_type           menu --> ranges, play
  DS:5114  impact_damage      menu --> player
  DS:5118  talking_tanks      menu --> comments
  DS:511A  talk_probability   menu --> comments
  DS:511C  talk_delay         menu --> comments
  DS:513C  hostile_env        menu --> extras
  DS:5140  fire_delay         menu --> play
  DS:514A  free_market        menu --> equip
  DS:5152  changing_wind      menu --> play
  DS:515C  max_wind           menu --> play, shark
  DS:5180  air_viscosity_int  menu --> extras

Pre-computed physics constants (set once, read per frame):
  DS:5178  viscosity_factor   extras (init) --> extras (step)
  DS:CE9C  gravity_step       extras (init) --> extras (step)
  DS:CEA4  wind_step          extras (init) --> extras (step)
  DS:CEAC  dt                 extras (init) --> extras (step)

Player state (2-level pointer architecture):
  DS:CEB8  player_array_ptr   player (alloc) --> all modules
  DS:D568  substruct_array_ptr player (alloc) --> all modules
  DS:E4DA  current_player_idx play --> extras, shark, icons

  Player struct (108 bytes each, stride 0x6C):
    +0x00  cur_ix, cur_iy     (world position, integer)
    +0x04  vx (f64)           (horizontal velocity)
    +0x0C  vy (f64)           (vertical velocity)
    +0x14  world_x (f64)      (precise position)
    +0x1C  world_y (f64)      (precise position)
    +0x24  guidance_type      (active guidance)
    +0x26  projectile_type    (weapon index)
    +0x28  blast_radius       (current explosion)
    +0x2A  sub_struct_ptr     (far ptr to 202-byte sub)
    +0x44  target_x, target_y (AI target)
    +0x4C  callback_fptr      (weapon handler)

  Sub-struct (202 bytes each, stride 0xCA):
    +0x18  alive              (tank alive flag)
    +0x96  shield_energy      (current shield HP)
    +0xA2  max_power          (power cap)
    +0xAA  heavy_shield_bonus (computed shield energy)

Weapon data (static, read-only):
  DS:11F6  weapon_structs     57 entries x 52 bytes
    +0x00  name_ptr (far)     +0x04  price
    +0x08  bundle             +0x0C  blast_radius
    +0x10  arms_level         +0x14  behavior_type
    +0x18  handler_segment    +0x1A  mkt_cost
    +0x22  unsold_rounds      +0x24  price_signal (f64)
    +0x2C  demand_avg (f64)

Rendering state:
  DS:EF22  tank_draw_color    icons --> framebuffer
  DS:EF24  shadow_color       icons --> framebuffer
  DS:ED58  layout_mode        menu --> font (0=spacious, 1=compact)
  DS:EEF4-EF14  Fastgraph fn ptrs  (indirect calls)

HUD layout (computed per player, per frame):
  DS:E6FC  hud_x_base
  DS:E9DE-EA04  widget positions (Row 1 + Row 2)

Equip init (weapon index aliases):
  DS:D548  FUEL_TANK=41       DS:D54A  HEAT_GUIDANCE
  DS:D54E  HORZ_GUIDANCE      DS:D550  VERT_GUIDANCE
  DS:D554  BATTERY=43         DS:D556  SHIELD index
  DS:D564  HEAVY_SHIELD=51    DS:D566  SUPER_MAG=52
```

## Weapon Handler Dispatch

```
fire_weapon() sets player+0x4C = far ptr to handler segment
physics_step() calls weapon_fire_handler() on collision

weapon_fire_handler() at 0x1C6C8:
  lcall [weapon_idx * 52 + DS:0x1200]  (segment from weapon struct)

Handler segments:
  0x3D1E (0x43BE0)  Standard projectiles  Baby/Missile/Nuke family
  0x25D5 (0x2C750)  MIRV/Death's Head     sub-warhead spawning
  0x2FBD (0x365D0)  Rollers               Baby/Heavy Roller
  0x26E6 (0x2D860)  Napalm/fire           Napalm, Hot Napalm, Ton of Dirt
  0x1DCE (0x246E0)  Funky Bomb            5-10 random sub-bombs
  0x2382 (0x2A220)  LeapFrog              3-bounce behavior
  0x151B (0x1BBB0)  Digger/tunnel         Diggers, Sandhogs, Riot Charge
  0x15A0 (0x1C400)  Dirt adding           Dirt Clod/Ball, Heavy Sandhog
```

## Shield Dispatch

```
shields.cpp at 0x31D8 (0x38780)
  Invoked by extras.cpp at 0x231B0:
    shl bx, 4          ; shield_type * 16
    call far [bx+0x26E] ; index into config table

Shield config table at DS:0x616C (6 entries x 16 bytes):
  [0] None       (no shield active)
  [1] Shield     (flat 1:1 HP absorption)
  [2] Warp       (teleport on hit)
  [3] Teleport   (teleport on hit, different range)
  [4] Force      (deflects projectiles)
  [5] Heavy      (high HP, battery-powered)
  Special: Flicker Shield = probabilistic cycling through types
```

## AI Solver Architecture

```
shark.cpp at 0x3167 (0x38070)

ai_select_target() at 0x254AF:
  for each live tank (sub+0x18 != 0):
    skip self
    prefer previous target (sticky targeting)
    fallback: random live enemy

ai_inject_noise() at 0x25DE9:
  SCANNING architecture (not additive noise):
    freq_base = pi / (2 * noise_amp)
    freq_cap  = 2*pi / 10
    amp       = rand01 * budget * 0.5
    budget   -= 2 * amp
    4x freq multiplier per harmonic
    phase     = rand(300)
    2-5 harmonics per solution

  Noise budgets by AI type (file 0x29505):
    [0] Moron:     50, 50, 50   (very poor)
    [1] Shooter:   23           (good)
    [2] Poolshark: 23           (good)
    [3] Tosser:    63, 23       (mixed)
    [4] Chooser:   63, 63, 23   (mixed)
    [5] Spoiler:   random       (unpredictable)

solve_trajectory() main loop:
  Ray-march 1 pixel at a time along direction
  fg_getpixel to detect terrain (>= 0x69) or player
  Decrement gravity by 1.0 per outer pass (flatter arcs)
  Return (angle, power) or fail
```

## Font System

```
font module at 0x4589 (0x4C290)

font_init():
  Scans for MOV instructions: C7 06 [ptr_lo] [ptr_hi] [val_lo] [val_hi]
  Builds 256-entry far pointer table to glyph bitmap data
  char_code = ((ptr_ds + 0xCA6) / 4) & 0xFF

Glyph data: DS:0x70E4 - 0x94EA (file 0x5CE64 - 0x5F26A)
  161 active characters (ASCII 32-126 + 66 CP437 extended)
  12 pixels tall, proportional width (1-12 px)
  Row-major, byte-per-pixel format

Layout modes (DS:0xED58):
  0 = spacious (25px row height)
  1 = compact  (17px row height)
  Same font glyphs in both modes
```
