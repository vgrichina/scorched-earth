# Scorched Earth v1.50 - Reverse Engineering Notes

## Overview

- **Game**: Scorched Earth - "The Mother of All Games"
- **Version**: 1.50 (June 4, 1995)
- **Author**: Wendell Hicken, Copyright (c) 1991-1995
- **Compiler**: Borland C++ 1993
- **Graphics Library**: Fastgraph V4.02
- **Platform**: MS-DOS (16-bit real mode)
- **EXE size**: 415,456 bytes (MZ DOS executable)
- **Entry point**: CS:IP = 0000:0000 (file offset 0x6A00, after 27,136-byte header)

---

## Binary Analysis

### EXE Structure

```
Header size:     27,136 bytes (1696 paragraphs)
Relocations:     6,136
Code+Data:       388,320 bytes
Total:           415,456 bytes
```

### Source Files (from debug strings)

The original game was compiled from these C++ source files:
- `comments.cpp` - Tank talking/speech bubbles
- `equip.cpp` - Equipment/weapon management
- `extras.cpp` - Extra game features
- `icons.cpp` - Icon rendering (referenced 5 times)
- `play.cpp` - Main game loop
- `player.cpp` - Player/tank management
- `ranges.cpp` - Terrain/mountain management
- `score.cpp` - Scoring system
- `shark.cpp` - AI (Poolshark AI type)
- `shields.cpp` - Shield system
- `team.cpp` - Team management

### Key String Offsets in Binary

| Offset   | Content |
|----------|---------|
| 0x029AAE | `ScannedMountain` (class name) |
| 0x02B79E | `Player[10]` (player array) |
| 0x055DA0 | `Borland C++ - Copyright 1993 Borland Intl.` |
| 0x056339 | `scorch.cfg` reference |
| 0x056360 | `Scorched Earth` title |
| 0x05662B | `GRAVITY=%lf` (physics) |
| 0x058193 | Weapon name table start (`Jump Jets`) |
| 0x0583E3 | Last weapon (`Patriot Missiles`) |
| 0x05AF4F | Copyright notice |
| 0x05B4DC | `scorch.pcx` (splash screen) |
| 0x05BCDA | Mountain file list (`ice001.mtn` through `snow001.mtn`) |

---

## Weapons (Complete List - 54 items)

### Offensive Weapons

| # | Weapon | Offset | Price | Bundle | Blast | Arms Level | Behavior |
|---|--------|--------|-------|--------|-------|------------|----------|
| 1 | Jump Jets | 0x058193 | - | - | - | - | Non-functional in v1.5 |
| 2 | Popcorn Bomb | 0x05819D | - | - | - | - | Scatters small bombs |
| 3 | Baby Missile | 0x0581AA | $400 | 10 | 10 | 0 | Standard small projectile |
| 4 | Missile | 0x0581AF | $1,875 | 5 | 20 | 0 | Standard projectile |
| 5 | Baby Nuke | 0x0581BF | $10,000 | 3 | 40 | 0 | Large explosion |
| 6 | Nuke | 0x0581C4 | $12,000 | 1 | 75 | 1 | Massive explosion |
| 7 | LeapFrog | 0x0581CE | $10,000 | 2 | 20/25/30 | 3 | Bounces 3 times |
| 8 | MIRV | 0x0581E2 | $10,000 | 3 | 20 | 2 | Splits into 5 sub-munitions at apogee |
| 9 | Funky Bomb | 0x0581D7 | $7,000 | 2 | 80 | 4 | Scatters multiple explosions |
| 10 | Death's Head | 0x0581E7 | $20,000 | 1 | 35 | 4 | Devastating |
| 11 | Napalm | 0x0581F4 | $10,000 | 10 | - | 2 | Liquid fire, burns terrain |
| 12 | Hot Napalm | 0x0581FB | $20,000 | 2 | - | 4 | Stronger napalm |
| 13 | Tracer | 0x058206 | $10 | 20 | 0 | 0 | Shows trajectory, no damage |
| 14 | Smoke Tracer | 0x05820D | $500 | 10 | 0 | 1 | Smoky trail, no damage |
| 15 | Baby Roller | 0x05821A | $5,000 | 10 | 10 | 2 | Rolls along terrain |
| 16 | Roller | 0x05821F | $6,000 | 5 | 20 | 2 | Rolls along terrain |
| 17 | Heavy Roller | 0x05822D | $6,750 | 2 | 45 | 3 | Rolls along terrain |
| 18 | Plasma Blast | 0x05823A | $9,000 | 5 | 10-75 | 3 | Variable radius |
| 19 | Riot Charge | 0x058247 | $2,000 | 10 | 36 | 2 | Earth-moving |
| 20 | Riot Blast | 0x058253 | $5,000 | 5 | 60 | 3 | Earth-moving |
| 21 | Riot Bomb | 0x05825E | $5,000 | 5 | 30 | 3 | Earth-moving |
| 22 | Heavy Riot Bomb | 0x058268 | $4,750 | 2 | 45 | 3 | Earth-moving |
| 23 | Baby Digger | 0x058278 | $3,000 | 10 | - | 0 | Tunnels through terrain |
| 24 | Digger | 0x05827D | $2,500 | 5 | - | 0 | Tunnels through terrain |
| 25 | Heavy Digger | 0x05828B | $6,750 | 2 | - | 1 | Tunnels through terrain |
| 26 | Baby Sandhog | 0x058298 | $10,000 | 10 | - | 0 | Larger tunnel |
| 27 | Sandhog | 0x05829D | $16,750 | 5 | - | 0 | Larger tunnel |
| 28 | Heavy Sandhog | 0x0582AD | $25,000 | 2 | - | 1 | Larger tunnel |

### Terrain Weapons

| # | Weapon | Offset | Price | Behavior |
|---|--------|--------|-------|----------|
| 29 | Dirt Clod | 0x0582BB | $5,000 | Adds dirt (radius 20) |
| 30 | Dirt Ball | 0x0582C5 | $5,000 | Adds dirt (radius 35) |
| 31 | Ton of Dirt | 0x0582CF | $6,750 | Adds dirt (radius 70) |
| 32 | Liquid Dirt | 0x0582DB | $5,000 | Liquid dirt |
| 33 | Dirt Charge | 0x0582E7 | $5,000 | Dirt charge |
| 34 | Dirt Tower | 0x0582F3 | - | Creates vertical dirt |
| 35 | Earth Disrupter | 0x0582FE | $5,000 | Causes suspended dirt to fall |
| 36 | Plasma Laser | 0x058314 | $5,000 | Beam weapon |

### Accessories/Items

| # | Item | Offset | Price | Function |
|---|------|--------|-------|----------|
| 37 | Heat Guidance | 0x058321 | $10,000 | Homes toward heat |
| 38 | Bal Guidance | 0x05832F | $10,000 | Ballistic trajectory correction |
| 39 | Horz Guidance | 0x05833C | $15,000 | Horizontal correction |
| 40 | Vert Guidance | 0x05834A | $20,000 | Vertical correction |
| 41 | Lazy Boy | 0x058358 | $20,000 | Full targeting |
| 42 | Parachute | 0x058361 | $10,000 | Prevents fall damage |
| 43 | Battery | 0x05836B | $5,000 | Repairs tank |
| 44 | Mag Deflector | 0x05837F | $10,000 | Repels projectiles |
| 45 | Warp Shield | 0x058394 | - | Teleports on hit |
| 46 | Teleport Shield | 0x0583A0 | - | Teleports tank |
| 47 | Flicker Shield | 0x0583B0 | - | Intermittent shield |
| 48 | Force Shield | 0x0583BF | $25,000 | Deflects projectiles |
| 49 | Heavy Shield | 0x0583CC | $30,000 | Strong shield |
| 50 | Super Mag | 0x0583D9 | $40,000 | Mag + force shield combined |
| 51 | Patriot Missiles | 0x0583E3 | - | Auto-intercept incoming |
| 52 | Auto Defense | 0x0583F4 | $1,500 | Auto-activate defenses |
| 53 | Fuel Tank | 0x058401 | $10,000 | Tank movement |
| 54 | Contact Trigger | 0x05840B | $1,000 | Detonate on terrain contact |

---

## Physics System

### Configurable Parameters (from SCORCH.CFG)

```ini
GRAVITY=0.200000        # Range: 0.05-10.0 (default 9.8 for earth-like)
AIR_VISCOSITY=0         # Range: 0-20 (drag coefficient)
MAX_WIND=0              # Max wind strength (0 = disabled)
CHANGING_WIND=Off       # Wind changes between turns
FALLING_TANKS=On        # Gravity affects unsupported tanks
FALLING_DELAY=10        # Animation speed for falling
SUSPEND_DIRT=0          # % of dirt that floats (0-100)
EDGES_EXTEND=75         # World extends beyond screen edges
ELASTIC=None            # Wall bounce behavior
```

### Projectile Trajectory (Euler Integration)

```
// Initial velocity from player input:
vx = power * cos(angle)
vy = power * sin(angle)

// Per simulation timestep:
vx += (wind - air_viscosity * vx) * dt
vy += gravity * dt
x  += vx * dt
y  += vy * dt
```

### Wall Types (ELASTIC setting)

| Type | Behavior |
|------|----------|
| None | Projectiles fly offscreen |
| Concrete | Detonate on wall impact |
| Padded | Reflect with velocity reduction |
| Rubber | Reflect with little/no loss |
| Spring | Reflect with velocity increase |
| Wrap-around | Left wraps to right |
| Random | Random type per round |
| Erratic | Random type per turn |

---

## MTN Terrain File Format

### File List

| File | Size | Theme |
|------|------|-------|
| ICE001.MTN | 45,972 | Ice/glacier |
| ICE002.MTN | 54,281 | Ice/glacier |
| ICE003.MTN | 139,961 | Ice/glacier |
| ROCK001.MTN | 63,114 | Rocky terrain |
| ROCK002.MTN | 73,730 | Rocky terrain |
| ROCK003.MTN | 136,992 | Rocky terrain |
| ROCK004.MTN | 69,068 | Rocky terrain |
| ROCK005.MTN | 41,767 | Rocky terrain |
| ROCK006.MTN | 33,738 | Rocky terrain |
| SNOW001.MTN | 67,134 | Snowy mountains |

### Header Structure (16 bytes)

| Offset | Size | Field | Value |
|--------|------|-------|-------|
| 0x00 | 2 | Magic | `"MT"` (0x4D54) |
| 0x02 | 2 | Magic2 | `0xBEEF` |
| 0x04 | 2 | Version | Always 256 (0x0100) |
| 0x06 | 2 | Height/rows | Varies (419-1483) |
| 0x08 | 2 | Y-offset or param | Varies (0-104) |
| 0x0A | 2 | Width or param | Varies (174-294) |
| 0x0C | 2 | Color count | Always 16 (0x0010) |
| 0x0E | 2 | Data offset/size | Varies |

### Palette

- 16 colors, stored as RGB triplets (48 bytes)
- Located immediately after the header
- 8-bit values (0-255) per channel
- First color typically `FF FF FF` (white/sky)

### Example Palettes

**ICE**: White, light gray-greens, blue-whites
```
FF FF FF  A5 B5 A5  9C AD 9C  94 A5 9C
9C AD A5  84 9C 94  73 8C 84  EF EF EF
DE E7 E7  63 7B 7B  4A 63 6B  29 4A 5A
21 42 52  10 31 42  08 21 31  00 00 00
```

**ROCK**: Earth tones, browns, grays
```
A5 9C 8C  DE D6 C6  9C 94 84  F7 EF DE
94 8C 73  C6 C6 B5  52 52 4A  9C 9C 8C
42 42 39  B5 B5 9C  63 63 52  84 84 6B
73 73 5A  73 7B 6B  00 00 00  ...
```

### Pixel Data

- **4-bit packed** (2 pixels per byte, 16 colors max)
- **Column-major** ordering (vertical strips)
- Uses RLE-like compression
- Reference parser: https://github.com/zsennenga/scorched-earth-mountain

---

## AI System

### AI Types (from strings)

| AI | Difficulty | Description |
|----|-----------|-------------|
| Moron | Lowest | Random/bad aim |
| Shooter | Low | Basic aiming |
| Poolshark | Medium | Decent trajectory calc |
| Chooser | Medium | Selects weapons wisely |
| Spoiler | Medium-High | Targets winning players |
| Cyborg | High | Advanced targeting |
| Sentient | Highest | Near-perfect aim |

### Computer Player Names (Default)

Wolfgang, Gilligan, Cleopatra, Mussolini, Napolean, Barbarella,
Antoinette, Elizabeth, Persephone, Mata Hari, Bethsheba, Guineverre,
Roseanne

### Additional names found in binary:
Ajax, Amin, Angie, Arnold, Atilla, Bach, Bethsheba, Biff, Bubba,
Bubbles, Castro, Charo, Cher, Chuck, Diane, Doug, Edward, Elvira,
Esther, Fisher, Frank, Fred, Galileo, George, Godiva, Grace, Hank,
Helen, Jacque, Jezebel, Juan, Khadafi, Leroy, Macchiavelli, Madonna,
Mary, Medusa, Moria, Mozart, Mussolini, Napolean, Persephone, Roseanne,
Wolfgang

---

## Game Configuration (SCORCH.CFG)

### Full Parameter List

```ini
MAXPLAYERS=2              # 2-10 players
MAXROUNDS=10              # Rounds per game
SOUND=On
FLY_SOUND=Off             # Projectile flight sound
GRAPHICS_MODE=360x480     # VGA mode (see below)
BIOS_KEYBOARD=Off
LOWMEM=Off
POINTER=mouse             # mouse/joystick
MOUSE_RATE=0.50
FIRE_DELAY=100            # Firing animation delay
FALLING_DELAY=10          # Gravity animation speed
INTEREST_RATE=0.300000    # 30% cash interest between rounds
INITIAL_CASH=1000000      # Starting money
COMPUTERS_BUY=On          # AI purchases weapons
FREE_MARKET=Off           # Market prices fluctuate
SCORING=Standard          # Standard/Corporate
AIR_VISCOSITY=0           # 0-20
GRAVITY=0.200000          # 0.05-10.0
SUSPEND_DIRT=0            # 0-100%
FALLING_TANKS=On
EDGES_EXTEND=75           # Border extension pixels
ELASTIC=None              # Wall bounce type
SKY=Random                # Sky background type
MAX_WIND=0
CHANGING_WIND=Off
HOSTILE_ENVIRONMENT=On    # Random lightning/meteors
LAND1=20                  # Terrain roughness param 1
LAND2=20                  # Terrain roughness param 2
FLATLAND=Off              # Flat terrain mode
RANDOM_LAND=Off           # Random terrain params
MTN_PERCENT=20.000000     # % chance of scanned mountain
FAST_COMPUTERS=Off        # Skip AI animation
TALKING_TANKS=Off         # Speech bubbles
TALK_PROBABILITY=100      # % chance of speech
TALK_DELAY=18
ATTACK_COMMENTS=talk1.cfg # Attack phrases file
DIE_COMMENTS=talk2.cfg    # Death phrases file
PLAY_MODE=Sequential      # Sequential/Simultaneous/Synchronous
STATUS_BAR=On
PLAY_ORDER=Random         # Random/Losers-First/Winners-First/Round-Robin
TEAM_MODE=None
ARMS=4                    # Arms level 0-4 (weapon availability)
BOMB_ICON=Big             # Projectile visual size
TUNNELLING=On             # Weapons tunnel through terrain
EXPLOSION_SCALE=Large     # Small/Medium/Large
TRACE=Off                 # Show projectile path
EXTRA_DIRT=Off            # Explosions generate loose dirt
USELESS_ITEMS=Off         # Include joke items
DAMAGE_TANKS_ON_IMPACT=On # Collision damage
```

### Graphics Modes Supported

| Mode | Resolution | Type |
|------|-----------|------|
| 320x200 | Standard VGA Mode 13h | Works everywhere |
| 320x240 | Mode X (square pixels) | Tweaked VGA |
| 320x400 | Tweaked mode | Tweaked VGA |
| 320x480 | Tweaked mode | Tweaked VGA |
| **360x480** | **Default/recommended** | **Tweaked VGA** |
| 640x400 | SVGA | Requires SVGA card |
| 640x480 | SVGA | Requires SVGA card |
| 800x600 | SVGA | Requires SVGA card |
| 1024x768 | SVGA | Requires SVGA card |

---

## Talk Files

### TALK1.CFG - Attack Comments (54 phrases)

Used when a tank fires at another. Examples:
- "Die!", "Eat my shorts!", "Banzai!"
- "From Hell's heart I stab at thee..."
- "I love the smell of Napalm in the morning."
- "Hasta la vista, Baby!"
- "I shall oil my turret with your blood."

### TALK2.CFG - Death Comments (61 phrases)

Used when a tank takes damage. Examples:
- "Ugh!", "Aargh!", "I'm melting!"
- "I've fallen and I can't get up!"
- "I'll be back..."
- "Somehow I don't feel like killing anymore."

---

## War Quotes (from binary at ~0x05B580)

The game displays random war quotes between rounds:

- "War should be the only study of a prince." - Macchiavelli
- "The essence of war is violence. Moderation in war is imbecility."
- "No one can guarantee success in war, but only deserve it." - Winston Churchill
- "Nearly all men can stand adversity, but if you want to test a man's character, give him power." - Abraham Lincoln
- "Nothing good ever comes of violence." - Martin Luther
- "That mad game the world so loves to play." - Jonathon Swift

---

## Terrain Generation

### Procedural Terrain

The game uses two parameters for procedural terrain generation:
- `LAND1=20` - Controls terrain roughness/amplitude
- `LAND2=20` - Controls terrain frequency/detail
- `FLATLAND=Off` - When on, generates flat terrain
- `RANDOM_LAND=Off` - When on, randomizes LAND1/LAND2

### Scanned Mountains (MTN files)

- `MTN_PERCENT=20.0` - 20% chance of using a scanned mountain instead of procedural terrain
- 10 MTN files total: 3 ice, 6 rock, 1 snow
- Selected randomly from available files

---

## Reference Resources

### Existing RE Work
- MTN format parser: https://github.com/zsennenga/scorched-earth-mountain
- Article: https://zach-ennenga.medium.com/please-destroy-my-face-reverse-engineering-scorched-earths-mtn-file-format-e64a1a2c9b9f
- TCRF unused content: https://tcrf.net/Scorched_Earth

### Open Source Clones (Web)
- https://github.com/andymason/Scorched-Earth-HTML5
- https://github.com/joshdaws/scorched-earth-clone (playable: https://joshdaws.github.io/scorched-earth-clone/)
- https://github.com/tomlokhorst/ScorchedCanvas
- https://github.com/benapetr/OpenScorchedEarth (C++ to WASM)
- https://github.com/webermn15/Scorch_a-scorched-earth-clone

### Official
- Manual: https://www.abandonwaredos.com/docawd.php?sf=scorchedearthmanual.txt&st=manual&sg=Scorched+Earth&idg=1912
- Official site: https://www.whicken.com/scorch/
- Wikipedia: https://en.wikipedia.org/wiki/Scorched_Earth_(video_game)
