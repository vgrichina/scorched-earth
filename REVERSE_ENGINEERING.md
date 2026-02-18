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
Header size:     27,136 bytes (1696 paragraphs = 0x06A0)
Relocations:     6,136
Initial CS:IP:   0000:0000
Initial SS:SP:   5EBA:0080
Code+Data:       388,320 bytes
Total:           415,456 bytes
Data segment:    0x4F38 (file base = 0x055D80)
```

### Source Files (from debug strings)

Each .cpp file has its own code segment (Borland large memory model). Code segments identified via assert string cross-references.

| Source File | String Offset | Code Segment | Code File Base | Purpose |
|-------------|--------------|--------------|----------------|---------|
| `comments.cpp` | 0x055FE5 | 0x117B | ~0x17F50 | Tank talking/speech bubbles |
| `equip.cpp` | 0x05793A | 0x16BC | ~0x1D560 | Equipment/weapon shop management |
| `extras.cpp` | 0x0579C7 | 0x1895 | ~0x20EA0 | Explosion/damage/projectile system |
| `icons.cpp` | 0x05AD16 | 0x1F7F+ | ~0x263F0 | Icon rendering (5 asserts) |
| `play.cpp` | 0x05B4B2 | 0x28B9 | ~0x2F830 | Main game loop |
| `player.cpp` | 0x05B5B9 | 0x2B3B+ | ~0x31FB0 | Player/tank management |
| `ranges.cpp` | 0x05BD5B | 0x2CBF | ~0x33690 | Terrain/mountain generation |
| `score.cpp` | 0x05BEB2 | 0x30B2 | ~0x37520 | Scoring system |
| `shark.cpp` | 0x05BEDA | 0x3167 | ~0x38070 | AI trajectory solver |
| `shields.cpp` | 0x05BF66 | 0x31D8 | ~0x38780 | Shield system |
| `team.cpp` | 0x05C55D | 0x3A56+ | ~0x40F60 | Team management |

### Key Data Regions

| Region | File Offset | Content |
|--------|-------------|---------|
| Borland runtime | 0x055000-0x055D80 | C++ runtime, string class |
| Config format strings | 0x056100-0x056900 | `GRAVITY=%lf`, etc. |
| **Weapon struct array** | **0x056F7A-0x05792A** | **52-byte structs, see below** |
| Weapon name pointer table | 0x057D08-0x057DFC | Far ptrs (4F38:xxxx) to names |
| UI string pointer tables | 0x058000-0x058193 | 98 far ptrs to UI strings |
| **Weapon name strings** | **0x058193-0x05841A** | **Null-terminated, contiguous** |
| AI type names | 0x058442-0x058492 | Moron through Sentient |
| Config enum strings | 0x0584EB-0x0585A6 | Off/On, wall types, scoring, etc. |
| Config menu labels | 0x0585A7-0x058830 | ~Start, ~Players, ~Gravity, etc. |
| Status/HUD strings | 0x058830-0x058900 | Power, Angle, Wind, etc. |
| System menu strings | 0x058900-0x058A00 | ~Quit Game, Mass Kill, etc. |
| Shop UI strings | 0x058A00-0x058D00 | Inventory, Shields, Buy/Sell, etc. |
| Sky type names | 0x058B68-0x058B8D | Plain, Shaded, Stars, Storm, Sunset, Black |
| War quotes | ~0x05B580-0x05BC30 | Inter-round quotes |
| MTN file list | 0x05BCDA-0x05BD4E | ice001.mtn through snow001.mtn |
| Class names | 0x029AAE-0x029B60 | ScannedMountain, LandGenerator, DefaultLand |

**Intermediate files**: `disasm/all_strings.txt`, `disasm/game_strings.txt`, `disasm/ui_complete.txt`

---

## Weapons — Binary Struct Data (VERIFIED)

### Weapon Struct Layout

Found at file offset **0x056F76** (DS:0x11F6), stride **52 bytes**, starting at weapon index 2 (Baby Missile).
Jump Jets (idx 0) and Popcorn Bomb (idx 1) have no struct data.

```
Offset  Size  Field
+00     4     Name pointer (far ptr to name string)
+04     2     Price (uint16)
+06     2     Bundle quantity (uint16)
+08     2     Arms level required (uint16, 0-4)
+0A     2     Behavior type code (uint16)
+0C     2     Behavior handler ptr (uint16, seg-relative)
+0E     2     Blast radius / param (int16, negative = dig direction)
+10     2     Runtime field (cleared/set by init code)
+12     2     Behavior fn ptr offset (set by init code)
+14     2     Behavior fn data (set by init code)
+16     2     Behavior fn ptr 2 (set by init code)
+18-33  28    Additional fields (zeros for most items)
Total: 52 bytes
```

### Complete Weapon Table (from binary)

57 entries in name pointer table (indices 0-56). Struct data verified for indices 2-49.

| Idx | Name | Price | Bundle | Arms | BhvType | Param | Notes |
|-----|------|-------|--------|------|---------|-------|-------|
| 0 | Jump Jets | - | - | - | - | - | Special/non-functional |
| 1 | Popcorn Bomb | - | - | - | - | - | Special (no struct) |
| 2 | Baby Missile | 400 | 10 | 0 | 0x0021 | 10 | Standard projectile |
| 3 | Missile | 1,875 | 5 | 0 | 0x0021 | 20 | Standard projectile |
| 4 | Baby Nuke | 10,000 | 3 | 0 | 0x0021 | 40 | Standard projectile |
| 5 | Nuke | 12,000 | 1 | 1 | 0x0021 | 75 | Standard projectile |
| 6 | LeapFrog | 10,000 | 2 | 3 | 0x0006 | 3 | Bouncing (3 bounces) |
| 7 | Funky Bomb | 7,000 | 2 | 4 | 0x0000 | 80 | Scatter (sub=0x1DCE) |
| 8 | MIRV | 10,000 | 3 | 2 | 0x0239 | 0 | Splits at apogee |
| 9 | Death's Head | 20,000 | 1 | 4 | 0x0239 | 1 | Wide MIRV variant |
| 10 | Napalm | 10,000 | 10 | 2 | 0x01A0 | 15 | Fire particles |
| 11 | Hot Napalm | 20,000 | 2 | 4 | 0x01A0 | 20 | Stronger napalm |
| 12 | Tracer | 10 | 20 | 0 | 0x0002 | 0 | No damage, shows path |
| 13 | Smoke Tracer | 500 | 10 | 0 | 0x0002 | 1 | Smoky trail, no damage |
| 14 | Baby Roller | 5,000 | 10 | 2 | 0x0003 | 10 | Rolls along terrain |
| 15 | Roller | 6,000 | 5 | 2 | 0x0003 | 20 | Rolls along terrain |
| 16 | Heavy Roller | 6,750 | 2 | 3 | 0x0003 | 45 | Rolls along terrain |
| 17 | Plasma Blast | 2,000 | 10 | 2 | 0x000D | 0 | Variable radius |
| 18 | Riot Charge | 5,000 | 5 | 3 | 0x000D | 1 | Earth-moving |
| 19 | Riot Blast | 5,000 | 5 | 3 | 0x03BD | 30 | Earth-moving |
| 20 | Riot Bomb | 4,750 | 2 | 3 | 0x03BD | 45 | Earth-moving |
| 21 | Heavy Riot Bomb | 3,000 | 10 | 0 | 0x000A | -10 | Tunneling |
| 22 | Baby Digger | 2,500 | 5 | 0 | 0x000A | -20 | Tunneling |
| 23 | Digger | 6,750 | 2 | 1 | 0x000A | -35 | Tunneling |
| 24 | Heavy Digger | 10,000 | 10 | 0 | 0x000A | 10 | Tunneling |
| 25 | Baby Sandhog | 16,750 | 5 | 0 | 0x000A | 20 | Wider tunnel |
| 26 | Sandhog | 25,000 | 2 | 1 | 0x000A | 35 | Wider tunnel |
| 27 | Heavy Sandhog | 5,000 | 10 | 0 | 0x0009 | 20 | Dirt (terrain adding) |
| 28 | Dirt Clod | 5,000 | 5 | 0 | 0x0009 | 35 | Dirt (terrain adding) |
| 29 | Dirt Ball | 6,750 | 2 | 1 | 0x0009 | 70 | Dirt (terrain adding) |
| 30 | Ton of Dirt | 5,000 | 5 | 2 | 0x01A0 | -20 | Liquid dirt (napalm-style) |
| 31 | Liquid Dirt | 5,000 | 10 | 1 | 0x0081 | 0 | Liquid dirt variant |
| 32 | Dirt Charge | 5,000 | 10 | 0 | 0x013E | 0 | Dirt charge |
| 33 | Dirt Tower | 9,000 | 5 | 3 | 0x0009 | 0 | Vertical dirt (sub=0x2770) |
| 34 | Earth Disrupter | 5,000 | 5 | 2 | 0x0004 | 0 | Forces dirt to fall |
| 35 | Laser | 10,000 | 6 | 2 | 0x0000 | 0 | Accessory (beam weapon) |
| 36 | Plasma Laser | 10,000 | 2 | 2 | 0x0000 | 0 | Accessory (beam weapon) |
| 37 | Heat Guidance | 15,000 | 5 | 1 | 0x0000 | 0 | Guidance system |
| 38 | Bal Guidance | 20,000 | 5 | 1 | 0x0000 | 0 | Guidance system |
| 39 | Horz Guidance | 20,000 | 2 | 3 | 0x0000 | 0 | Guidance system |
| 40 | Vert Guidance | 10,000 | 8 | 2 | 0x0000 | 0 | Guidance system |
| 41 | Lazy Boy | 5,000 | 10 | 2 | 0x0000 | 0 | Accessory |
| 42 | Parachute | 10,000 | 2 | 2 | 0x0000 | 0 | Accessory |
| 43 | Battery | 20,000 | 3 | 3 | 0x0000 | 0 | Energy supply |
| 44 | ~Batteries: | 25,000 | 3 | 3 | 0x0000 | 0 | *(UI label, not a real item)* |
| 45 | Mag Deflector | 30,000 | 2 | 4 | 0x0000 | 0 | Magnetic defense |
| 46 | Shield | 40,000 | 2 | 4 | 0x0000 | 0 | Basic shield |
| 47 | Warp Shield | 1,500 | 1 | 3 | 0x0000 | 0 | Teleport on hit |
| 48 | Teleport Shield | 10,000 | 10 | 3 | 0x0000 | 0 | Shield variant |
| 49 | Flicker Shield | 1,000 | 25 | 3 | 0x0000 | 0 | Cheapest shield |
| 50 | Force Shield | **CORRUPT** | | | | | *(struct overlaps equip.cpp string)* |
| 51 | Heavy Shield | **CORRUPT** | | | | | *(struct overlaps debug strings)* |
| 52 | Super Mag | **CORRUPT** | | | | | *(struct overlaps format strings)* |
| 53 | Patriot Missiles | **CORRUPT** | | | | | *(struct overlaps format strings)* |
| 54 | Auto Defense | **CORRUPT** | | | | | *(struct overlaps float constants)* |
| 55 | Fuel Tank | **CORRUPT** | | | | | *(struct overlaps debug strings)* |
| 56 | Contact Trigger | **CORRUPT** | | | | | *(struct overlaps float constants)* |

**Status**: Items 2-49 fully verified. Items 50-56 have a **data layout bug** — the Borland C++ linker placed the `equip.cpp` debug string and `"Failed to identify item"` assert message at file offset 0x05793A, which is exactly where item 50's struct starts (0x056F76 + 48×52 = 0x05793A). The game code reads prices only from the struct field (`[bx + 0x11FA]`) with no fallback, so items 50-56 have garbage prices at runtime. This is a confirmed linker-era bug in v1.50.

**Intermediate files**: `disasm/weapon_data_corrected.txt`, `disasm/weapon_name_ptrtable.txt`, `disasm/weapon_structs.txt`, `disasm/accessory_prices.txt`

### Behavior Type Groups

| BhvType | Hex | Category | Weapons |
|---------|-----|----------|---------|
| 0 | 0x0000 | Non-projectile | Accessories, shields, guidance, Funky Bomb(!) |
| 2 | 0x0002 | Tracer | Tracer, Smoke Tracer |
| 3 | 0x0003 | Roller | Baby Roller, Roller, Heavy Roller |
| 4 | 0x0004 | Beam/disrupter | Earth Disrupter |
| 6 | 0x0006 | Bouncing | LeapFrog |
| 9 | 0x0009 | Dirt adding | Heavy Sandhog, Dirt Clod, Dirt Ball, Dirt Tower |
| 10 | 0x000A | Tunneling | Heavy Riot Bomb, Baby Digger, Digger, Heavy Digger, Baby Sandhog, Sandhog |
| 13 | 0x000D | Plasma | Plasma Blast, Riot Charge |
| 33 | 0x0021 | Standard projectile | Baby Missile, Missile, Baby Nuke, Nuke |
| 129 | 0x0081 | Liquid dirt | Liquid Dirt |
| 318 | 0x013E | Dirt charge | Dirt Charge |
| 416 | 0x01A0 | Napalm/fire | Napalm, Hot Napalm, Ton of Dirt |
| 569 | 0x0239 | Splitting (MIRV) | MIRV, Death's Head |
| 957 | 0x03BD | Riot (earth-moving) | Riot Blast, Riot Bomb |

---

## UI System (from binary strings)

### Config Menu Structure

Extracted from `disasm/ui_complete.txt` (offset 0x0585A7+):

**Main Config Screen**:
- ~Start, ~Players:, ~Rounds:, S~ound..., ~Hardware..., ~Economics..., ~Landscape..., Ph~ysics..., Play Op~tions..., ~Weapons..., Save ~Changes

**Sound/Hardware**: ~Sound:, ~Flight Sounds:, ~Graphics Mode:, ~Bios Keyboard, ~Small Memory, ~Mouse Enabled, ~Firing Delay:, ~Hardware Delay:

**Economics**: ~Interest Rate:, ~Cash at Start:, Computers ~Buy, ~Free Market, ~Scoring Mode:

**Landscape**: ~Bumpiness: (=LAND1), S~lope: (=LAND2), ~Flatten Peaks, ~Random Land, ~Percent Scanned Mountains: (at 0x05C103)

**Physics**: ~Air Viscosity:, ~Gravity:, ~Borders Extend:, ~Effect of Walls:, ~Suspend Dirt:, ~Sky:, ~Max. Wind:, ~Changing Wind, Tanks ~Fall, ~Impact Damage

**Play Options**: ~Mode: (Sequential/Simultaneous/Synchronous), Play ~Order: (Random/Losers-First/Winners-First/Round-Robin), ~Teams:, Ta~lking Tanks:, ~Attack File:, ~Die File:, ~Fast Computers, Talk ~Probability:

**Weapons**: ~Arms Level:, ~Bomb Icon: (Small/Big/Invisible), ~Tunneling, ~Scale: (Small/Medium/Large), Trace ~Paths, ~Extra Dirt, ~Useless Items

### Status Bar / HUD

- Power, Angle, Wind, "No Wind"
- "deployed" / "passive" (shield status)
- Player (name display)
- Remaining Power:, Energy Left, Guidance, ~Fuel Remaining:

### Shop Screen

- Score, Weapons, Miscellaneous, ~Done
- ~Inventory, ~Parachutes, ~Triggers, ~Guidance, Shields, ~Batteries:
- Cash Left:, Max
- Description, Amount in stock, ~Quantity to sell:, Offer
- Sell Equipment, ~Accept, ~Reject
- Earned interest
- ~Energy Left (shield energy), ~Launch, Batteries to discharge:

### System Menu

- System Menu, ~Clear Screen, ~Mass Kill, ~Quit Game
- Reassign Players, Reassign ~Players, Reassign ~Teams
- Save ~Game, ~Restore Game, ~New Game
- Engage, ~Go, ~Quit, New ~Game

### Dialog Strings

- "Do you want to retreat?", "Do you want to quit?"
- "Do you really want to restart the game?"
- "Mass kill everyone?"
- "%s rounds remain", "1 round remains"
- "NO KIBITZING!!" (anti-peek during hot-seat)
- "Preparing Next Level..."
- "Automatic Defense System"
- "You seriously want to disgrace / and humiliate yourself / by retreating?"

### Sky Types

| Name | Offset |
|------|--------|
| Plain | 0x058B68 |
| Shaded | 0x058B6E |
| Stars | 0x058B75 |
| Storm | 0x058B7B |
| Sunset | 0x058B81 |
| Black | 0x058B88 |
| Random | 0x058507 |

### Wall Types

| Name | Offset |
|------|--------|
| None | *(default)* |
| Erratic | 0x0584FF |
| Random | 0x058507 |
| Wrap-around | 0x05850E |
| Padded | 0x05851A |
| Rubber | 0x058521 |
| Spring | 0x058528 |
| Concrete | 0x05852F |

### Scoring Modes

Standard, Corporate, Vicious (at 0x058560, 0x058571, 0x05857B)

### Bomb Icon Sizes

Small, Big, Invisible (at 0x058538, 0x05853E, 0x058542)

### Explosion Scales

Small, Medium, Large (at 0x058538, 0x058553, 0x05855A)

### AI Types

| Name | Offset | Menu Label |
|------|--------|------------|
| Moron | 0x058442 | ~Moron |
| Shooter | 0x058448 | S~hooter |
| Poolshark | 0x058450 | ~Poolshark |
| Tosser | 0x05845A | ~Tosser |
| Chooser | 0x058461 | ~Chooser |
| Spoiler | 0x058469 | ~Spoiler |
| Cyborg | 0x058471 | C~yborg |
| Unknown | 0x058478 | ~Unknown |
| Sentient | 0x058480 | *(no menu entry)* |
| Sentient? | 0x058489 | *(debug?)* |

**Note**: "Tosser" and "Unknown" are AI types not in previous RE docs. "Sentient?" with question mark is likely a debug label.

### Miscellaneous

- Title strings: "Scorched Earth" (0x05841B), "The Mother of All Games" (0x05842A)
- Version: "1.50" (0x05AF7F)
- Copyright: "%s %s Copyright (c) 1991-1995 Wendell Hicken" (0x05AF4F)
- Shareware nags: "Register Scorch!", "Pay for Scorch!", "What more do you want for $20?"
- Terrain: "Cavern" mode string at 0x058F6D
- Easter egg strings: "ASGARD", "frondheim", "ragnarok", "mayhem", "nofloat" (cheat codes?)
- Config file: "scorch.cfg" (0x05AF44), debug: "scorch.dbg" (0x057CB4)

---

## Physics System

### Configurable Parameters (from SCORCH.CFG)

```ini
GRAVITY=0.200000        # Range: 0.05-10.0 (default 0.2 in shipped config)
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

### Key Float Constants (from binary)

| Value | File Offsets | Likely Use |
|-------|-------------|------------|
| 0.2 | 0x055E72, 0x056198, 0x05AEAA+ | Default gravity |
| 0.1 | 0x05AFE8, 0x05B066+ | Physics param |
| 0.5 | 0x05B0C6, 0x05C978 | Half (used in calculations) |
| 1.0 | 0x0579EE, 0x05AE5A+ | Unit value |
| 2.0 | 0x057863, 0x05B03E+ | Doubling |

**FPU Emulation**: Borland C++ 1993 uses **INT 34h-3Dh** for 8087 FPU emulation, not native FPU opcodes. This is why raw FPU instructions are scarce — all floating-point math is encoded as software interrupts:
- INT 34h = DC xx (fsub/fcomp qword)
- INT 35h = D8 xx (fadd/fmul dword)
- INT 36h = DA xx (fiadd/fimul dword int)
- INT 37h = DE xx (fiadd/fimul word int)
- INT 38h = DD xx (fld/fst qword)
- INT 39h = D9 xx (fld/fst dword)
- INT 3Ah = DB xx (fild dword)
- INT 3Bh = DF xx (fild/fistp word)
- INT 3Ch = D8 xx (near-data segment FPU ops)
- INT 3Dh = 9B (fwait)

A **PI/180 constant (0.0174532930)** was found at DS:0x1D08, confirming the game does use degree-to-radian conversion for trig — it was just hidden behind the INT emulation layer.

**Intermediate files**: `disasm/float_constants.txt`, `disasm/explosion_physics.txt`, `disasm/damage_formula.txt`

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

### Explosion/Damage System (VERIFIED)

The explosion code lives in code segment **0x1A4A** (file base 0x20EA0, ~11 KB). Uses Borland's INT 34h-3Dh FPU emulation throughout.

**Debug strings**: `"Bd=%lf  FireDelay=%d  WarheadsLeft=%d"` at DS:0x1CCB, `"BogoMips: %ld %ld"` at DS:0x1CA5

**Key functions**:
| Function | File Offset | Purpose |
|----------|-------------|---------|
| DoExplosion | 0x20EAD | Main explosion handler (~2.7 KB) |
| ExplosionPalette | 0x21B25 | 8-color explosion palette setup |
| ExplosionAnim | 0x21B92 | Explosion animation loop |
| DistanceHelper | 0x21CF4 | sqrt/distance calculation |
| ConfigLoader | 0x21D09 | Load 8 physics doubles from config |
| CoordTransform | 0x21DD5 | Player-to-explosion offset + clamping |
| CoreDamage | 0x22BDF | Core damage function (93 FPU calls, ~2.5 KB) |

**Explosion types** (tracked in DS:0xD0AC):
- **Type 0**: Single blast — finds closest target, applies direct damage
- **Type 1**: Multi-warhead (MIRV) — iterates **6 sub-warheads** (12-byte stride)
- **Type 2**: Special — **8 particles** distributed at 1/3 radius intervals

**Damage formula constants** (DS:0x1D00-0x1D70, mixed float64 and float32):
| Offset | Type | Value | Purpose |
|--------|------|-------|---------|
| DS:0x1D08 | f64 | 0.0174532930 | PI/180 (degree-to-radian) |
| DS:0x1D10 | f64 | 1.02 | +2% damage randomization |
| DS:0x1D18 | f64 | 0.98 | -2% damage randomization |
| DS:0x1D20 | f32 | 5000.0 | Max effective distance |
| DS:0x1D28 | f32 | 1.825 | Damage coefficient |
| DS:0x1D2C | f32 | 1000000.0 | Distance squared threshold |
| DS:0x1D30 | f32 | 1000.0 | Scaling factor |
| DS:0x1D38 | f32 | -1.875 | Polynomial curve coefficient |
| DS:0x1D40 | f32 | -1.75 | Polynomial curve coefficient |
| DS:0x1D48 | f32 | -2.0 | Polynomial curve coefficient |
| DS:0x1D50 | f32 | -3.140625 | ~-PI |
| DS:0x1D54 | f32 | 0.75 | Coefficient |
| DS:0x1D58 | f32 | 2000.0 | Scaling |
| DS:0x1D5C | f32 | 2.0 | Doubling |
| DS:0x1D60 | f64 | 0.7 | Damage falloff coefficient |
| DS:0x1D68 | f64 | 0.001 | Minimum damage threshold |

**Inferred damage formula**:
```
distance = sqrt(dx*dx + dy*dy)
if distance > max_radius: damage = 0
else:
    normalized = distance / max_radius
    damage = base_damage * (1.0 - normalized^0.7)  // polynomial falloff
    damage *= random(0.98, 1.02)                    // +-2% variation
```

**Energy/shield subtraction**:
- Inner blast: **17 points** (`sub es:[bx+0x4A], 0x11`)
- Outer blast: **16 points** (`sub es:[bx+0x4A], 0x10`)

**Explosion palette** (8 entries):
- Index 5: RGB(63,63,63) = bright white flash
- Index 7: RGB(30,30,30) = medium grey smoke
- Other indices: attacking player's colors

**BogoMIPS calibration**: The game benchmarks CPU speed at startup (strings: `"Getting MIPS"`, `"BogoMips: %ld %ld"`) to calibrate explosion animation timing, similar to Linux's BogoMIPS.

**Firewall defense system**: `"FIREWALL_FATAL"` at DS:0x1D7C, `"** %d firewall%s triggered!"` — a defensive item that intercepts incoming explosions.

**Intermediate files**: `disasm/extras_region.txt`, `disasm/explosion_physics.txt`, `disasm/damage_formula.txt`

---

## MTN Terrain File Format

### File List (from binary at 0x05BCDA)

| File | Offset | Size | Theme |
|------|--------|------|-------|
| ice001.mtn | 0x05BCDA | 45,972 | Ice/glacier |
| ice002.mtn | 0x05BCE5 | 54,281 | Ice/glacier |
| ice003.mtn | 0x05BCF0 | 139,961 | Ice/glacier |
| rock001.mtn | 0x05BCFB | 63,114 | Rocky terrain |
| rock002.mtn | 0x05BD07 | 73,730 | Rocky terrain |
| rock003.mtn | 0x05BD13 | 136,992 | Rocky terrain |
| rock004.mtn | 0x05BD1F | 69,068 | Rocky terrain |
| rock005.mtn | 0x05BD2B | 41,767 | Rocky terrain |
| rock006.mtn | 0x05BD37 | 33,738 | Rocky terrain |
| snow001.mtn | 0x05BD43 | 67,134 | Snowy mountains |

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

### Palette (48 bytes after header)

- 16 colors, stored as RGB triplets (3 bytes each)
- 8-bit values (0-255) per channel
- First color typically `FF FF FF` (white/sky)

### Pixel Data

- **4-bit packed** (2 pixels per byte, 16 colors max)
- **Column-major** ordering (vertical strips)
- Uses RLE-like compression
- Reference parser: https://github.com/zsennenga/scorched-earth-mountain

### Terrain Class Names

| Name | Offset | Purpose |
|------|--------|---------|
| ScannedMountain | 0x029AAE | MTN-loaded terrain |
| LandGenerator | 0x029AEC | Procedural terrain base class |
| DefaultLand | 0x029B4E | Default procedural generator |

---

## AI System

### AI Types (from binary)

| AI | Internal Name | Offset | Difficulty |
|----|--------------|--------|------------|
| Moron | Moron | 0x058442 | Lowest |
| Shooter | Shooter | 0x058448 | Low |
| Poolshark | Poolshark | 0x058450 | Medium |
| Tosser | Tosser | 0x05845A | *(new, not in prior docs)* |
| Chooser | Chooser | 0x058461 | Medium-High |
| Spoiler | Spoiler | 0x058469 | Medium-High |
| Cyborg | Cyborg | 0x058471 | High |
| Unknown | Unknown | 0x058478 | *(placeholder?)* |
| Sentient | Sentient | 0x058480 | Highest |

### AI Solver (shark.cpp at 0x05BEDA)

Code segment **0x3167** (file base ~0x38070). Uses Borland INT 34h-3Dh FPU emulation.

### AI Accuracy Parameters (VERIFIED)

Found at file 0x29505 (segment 0x223A:0x0765). A switch on effective AI type (DS:0x5154) pushes noise values, then calls a common trajectory handler. **Lower values = more accurate, higher = more random noise**.

| Type | AI Name | Noise Values | Interpretation |
|------|---------|-------------|----------------|
| 0 | Moron | [50, 50, 50] | Maximum inaccuracy on all parameters |
| 1 | Shooter | [23] | Accurate (single noise param) |
| 2 | Poolshark | [23] | Accurate (single noise param) |
| 3 | Tosser | [63, 23] | Wild on 1st param, accurate on 2nd |
| 4 | Chooser | [63, 63, 23] | Wild on 2 params, accurate on 3rd |
| 5 | Spoiler | [63, 63, 63] | Maximum wildness (strategic chaos) |

Common handler pushes **0x9D (157)** as max trajectory distance parameter, then calls far function 0x456B:0x0005.

### AI Type Dispatch (VERIFIED)

AI vtable at **DS:0x027A** (16 bytes per type, 4 far function pointers each):

- **Types 0-5** (Moron-Spoiler): Have real code segment function pointers
- **Type 6 (Cyborg)**: First 2 ptrs are real (segment 0x14C8), last 2 are **NULL** (point to DS:0x0272/0x0282 = zeroed data). At runtime, **randomized to type 0-5** before dispatch.
- **Type 7 (Unknown)**: ALL 4 vtable entries are **NULL** pointers (DS:0x0292-0x02C2). Randomized to type 0-5 at runtime — effectively a random AI personality each turn.
- **Type 8 (Sentient)**: Vtable **overflows into string data** (entries [1]-[3] decode to ASCII `"oS"`, `"d me"`, `" bum"`). This is a **second data layout bug** identical to the weapon struct corruption. Sentient appears non-functional in v1.50.

Dispatch code at file 0x29280 (segment 0x223A):
```
mov ax, [DS:5156]    ; load original AI type
mov [DS:5154], ax    ; copy to effective type
cmp [DS:5154], 6     ; Cyborg?
jz randomize
cmp [DS:5154], 7     ; Unknown?
jnz skip
randomize:
  push 6; call random  ; random(0..5)
  mov [DS:5154], ax    ; overwrite effective type
```

**Intermediate files**: `disasm/ai_code.txt`, `disasm/ai_solver.txt`

### Computer Player Names (Default)

Wolfgang, Gilligan, Cleopatra, Mussolini, Napolean, Barbarella,
Antoinette, Elizabeth, Persephone, Mata Hari, Bethsheba, Guineverre,
Roseanne

Additional names: Ajax, Amin, Angie, Arnold, Atilla, Bach, Biff, Bubba,
Bubbles, Castro, Charo, Cher, Chuck, Diane, Doug, Edward, Elvira,
Esther, Fisher, Frank, Fred, Galileo, George, Godiva, Grace, Hank,
Helen, Jacque, Jezebel, Juan, Khadafi, Leroy, Macchiavelli, Madonna,
Mary, Medusa, Moria, Mozart

---

## Shield System (VERIFIED)

### Shield Type Configuration Table — DS:0x616C (file 0x05BF4C)

6 entries of 16 bytes each. Count at DS:0x61E4 = 5 (excluding "None").

| Type | Name | Energy (HP) | Radius (px) | Color VGA (R,G,B) | Flags | Behavior |
|------|------|-------------|-------------|--------------------|----|------|
| 0 | None | 0 | 0 | (0, 0, 0) | 0 | No shield |
| 1 | Shield | 55 | 16 | (63, 63, 23) yellow | 2 | Basic absorption |
| 2 | Warp Shield | 100 | 15 | (63, 63, 63) white | 0 | Random teleport on hit |
| 3 | Teleport Shield | 100 | 15 | (63, 23, 63) purple | 1 | Teleport when triggered |
| 4 | Force Shield | 150 | 16 | (63, 63, 63) white | 0 | Absorption + deflection |
| 5 | Heavy Shield | 200 | 16 | (63, 53, 33) orange | 4 | Max absorption + deflection |

**Flicker Shield** (type 4 in switch) has **no config table entry** — uses probabilistic on/off cycling. When "on", fully blocks; when "off", no protection at all.

### Damage Absorption Formula

**Flat 1:1 HP absorption**. No percentage reduction.

```c
if (shieldEnergy > damage) {
    shieldEnergy -= damage;    // shield absorbs all
    return 0;                  // no damage passes through
} else {
    remainingDamage = damage - shieldEnergy;
    shieldEnergy = 0;          // shield breaks
    // 50-frame fade-to-black animation (accelerating: 6000ms → 1100ms)
    return remainingDamage;    // excess hits the tank
}
```

### Visual Feedback

- Shield color = `shieldEnergy * configColor / maxEnergy` (fades as energy depletes)
- Shield drawn as circular region using VGA palette index `playerIndex + 5`
- Shield pixels marked with color 0xFF; terrain boundary at 0x69 (105)
- Break animation: 50-frame accelerating fade (`delay -= 100` per frame) + final white flash

### Battery Interaction

Shields require Battery charges to maintain energy across turns. Without batteries, shield type resets to 0 (disabled). Code at file 0x39750 handles allocation.

### Player Struct Shield Fields

| Offset | Field |
|--------|-------|
| +0x96 | Shield energy remaining (HP) |
| +0xC6 | Far pointer to shield config entry (16 bytes) |
| +0x0E | X position |
| +0x10 | Y position |
| +0x92 | Turret angle |
| +0x94 | Turret direction (-1 or 1) |

### Mag Deflector / Super Mag

These are **not shield types** — they modify projectile trajectories through the physics system rather than absorbing damage. Work via separate deflection zone mechanics.

**Intermediate files**: `disasm/shields_code.txt`, `disasm/shield_mechanics.txt`

---

## Game Configuration (SCORCH.CFG)

### Full Parameter List

```ini
MAXPLAYERS=2              # 2-10 players
MAXROUNDS=10              # Rounds per game
SOUND=On
FLY_SOUND=Off             # Projectile flight sound
GRAPHICS_MODE=360x480     # VGA mode
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
SCORING=Standard          # Standard/Corporate/Vicious
AIR_VISCOSITY=0           # 0-20
GRAVITY=0.200000          # 0.05-10.0
SUSPEND_DIRT=0            # 0-100%
FALLING_TANKS=On
EDGES_EXTEND=75           # Border extension pixels
ELASTIC=None              # Wall bounce type
SKY=Random                # Plain/Shaded/Stars/Storm/Sunset/Black/Random
MAX_WIND=0
CHANGING_WIND=Off
HOSTILE_ENVIRONMENT=On    # Random lightning/meteors
LAND1=20                  # Terrain bumpiness (amplitude)
LAND2=20                  # Terrain slope (frequency)
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
BOMB_ICON=Big             # Small/Big/Invisible
TUNNELLING=On             # Weapons tunnel through terrain
EXPLOSION_SCALE=Large     # Small/Medium/Large
TRACE=Off                 # Show projectile path
EXTRA_DIRT=Off            # Explosions generate loose dirt
USELESS_ITEMS=Off         # Include joke items
DAMAGE_TANKS_ON_IMPACT=On # Collision damage
```

---

## Talk Files

### TALK1.CFG - Attack Comments (54 phrases)

Full file in `earth/TALK1.CFG`. Loaded from path in `ATTACK_COMMENTS` config.

### TALK2.CFG - Death Comments (61 phrases)

Full file in `earth/TALK2.CFG`. Loaded from path in `DIE_COMMENTS` config.

---

## War Quotes (COMPLETE — 15 quotes at 0x05B580-0x05BC5E)

The game displays random war quotes between rounds. **Pointer table** at 0x05B5E2 holds 30 entries (15 quote ptrs + 15 attribution ptrs). Multi-line quotes contain embedded `\n` characters.

| # | Quote | Attribution | Offset |
|---|-------|-------------|--------|
| 1 | "There's many a boy here today who looks on war as all glory, but, boys, it is all hell." | Gen. William T. Sherman | 0x05B65C |
| 2 | "The essence of war is violence. Moderation in war is imbecility." | Fisher | 0x05B6CC |
| 3 | "War is the science of destruction." | John Abbott | 0x05B715 |
| 4 | "Providence is always on the side of the big battalions." | Sevigne | 0x05B744 |
| 5 | "War is a matter of vital importance to the State; the province of life or death; the road to survival or ruin. It is mandatory that it be throughly studied." | Sun Tzu | 0x05B784 |
| 6 | "War should be the only study of a prince. He should consider peace only as a breathing-time, which gives him leisure to contrive, and furnishes as ability to execute, military plans." | Macchiavelli | 0x05B82A |
| 7 | "Not with dreams but with blood and iron, Shall a nation be moulded at last." | Swinburne | 0x05B8EF |
| 8 | "No one can guarantee success in war, but only deserve it." | Winston Churchill | 0x05B945 |
| 9 | "The grim fact is that we prepare for war like precocious giants and for peace like retarded pygmies." | Lester Pearson | 0x05B991 |
| 10 | "We cannot live by power, and a culture that seeks to live by it becomes brutal and sterile. But we can die without it." | Max Lerner | 0x05BA05 |
| 11 | "No man is wise enough, nor good enough to be trusted with unlimited power." | Charles Colton | 0x05BA88 |
| 12 | "Nothing good ever comes of violence." | Martin Luther | 0x05BAE2 |
| 13 | "Give me the money that has been spent in war, and ... I will clothe every man, woman and child in attire of which kings and queens would be proud." | Henry Richard | 0x05BB15 |
| 14 | "That mad game the world so loves to play." | Jonathon Swift | 0x05BBB6 |
| 15 | "Nearly all men can stand adversity, but if you want to test a man's character, give him power." | Abraham Lincoln | 0x05BBEF |

**Note**: Quote 5 contains a typo — "throughly" instead of "thoroughly" — faithful to the original binary.

**Intermediate files**: `disasm/war_quotes.txt`

---

## Terrain Color Palettes (VERIFIED)

### Palette System

Terrain uses **VGA DAC registers 120-149** (30 colors). DAC 149 = surface, DAC 120 = deepest underground. Y-to-palette mapping:
```
palette_index = (terrain_bottom - y) * 29 / terrain_height + 120
```

### Key Code/Data Locations

| Item | Location |
|------|----------|
| Terrain palette function | file 0x03971F (CS=0x32C2:0x00FF) |
| Terrain type switch | file 0x039951 (7-way jump table at CS:0x0A18) |
| Terrain type variable | DS:0x5110 |
| Base color table | DS:0x5036 (file 0x05ADB6) |
| FP gradient constants | DS:0x6258-0x6270 (9.0, 10.0, 20.0, 63.0, 29.0, 31.0, 45.0) |
| fg_setcolor | indirect via DS:0xEF08 |
| fg_setdacs | indirect via DS:0xEEFC (hardware ports 0x3C8/0x3C9) |

### 7 Terrain Types

| Type | Theme | Method | Colors (VGA 6-bit R,G,B) |
|------|-------|--------|--------------------------|
| 0 | **Blue Ice** | `setTerrainPalette(120, 9, 9, 31)` | Black → dark blue (9,9,31) |
| 1 | **Snow/Ice** | Loop: `R=29-di, G=29-di, B=63` | White-blue (29,29,63) → pure blue (0,0,63) |
| 2 | **Rock/Gray** | Loop: `R=G=B=di*2+7` + random scatter | Dark gray (7,7,7) → white (63,63,63) |
| 3 | **Night** | Two-part: blue core + gray surface | Dark blue (0,0,30) → black → gray (38,38,38) |
| 4 | **Desert/Lava** | FP gradient from (63,63,0) | Yellow (63,59,2) → red-brown (63,20,20) |
| 5 | **Varied** | Random base from 6-entry table | See base color table below |
| 6 | **Scanned MTN** | Palette from .MTN file | 8-bit→6-bit: `VGA = val >> 2` |

### Base Color Table (Type 5) — DS:0x5036 (file 0x05ADB6)

6 earth-tone entries, one randomly selected per round. Gradient formula: `Channel[di] = BaseChannel * (di + 8) / 45.0`

| Idx | VGA (R,G,B) | Hex (24-bit) | Theme |
|-----|-------------|--------------|-------|
| 0 | (38, 25, 17) | #9A6545 | Warm brown (desert/dirt) |
| 1 | (54, 36, 28) | #DB9271 | Light tan (sand/clay) |
| 2 | (53, 53, 47) | #D7D7BE | Silver gray (rock/stone) |
| 3 | (20, 62, 20) | #51FB51 | Bright green (grass) |
| 4 | (9, 35, 9) | #248E24 | Dark green (forest) |
| 5 | (36, 54, 28) | #92DB71 | Yellow-green (savanna) |

### Desert/Lava Gradient Detail (Type 4)

Two FP interpolation loops over 30 DAC entries:

```
Loop 1 (di=0..9): underground to mid-depth
  t1 = (9-di)/10, t2 = (1+di)/10
  R = round(t1*63 + t2*63)  ≈ 63 (constant)
  G = round(t1*63 + t2*20)  = 59→20 (yellow→orange)
  B = round(t2*20)           = 2→20 (black→red)

Result: yellow (63,59,2) through orange to red-brown (63,20,20)
```

### Fastgraph Palette Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `setTerrainPalette` | file 0x04C0B5 | 16-step gradient from black to target color |
| `setColorGradient5` | file 0x03A046 | Store base RGB + call setTerrainPalette |
| `fg_setcolor` | via DS:0xEF08 | Set single palette buffer entry |
| `fg_setdacs` | via DS:0xEEFC | Flush palette buffer to VGA DAC hardware |
| `fg_getdacs` | file 0x0443C8 | Read from VGA ports 0x3C7/0x3C9 |
| `fg_setdacs` (hw) | file 0x04443A | Write to VGA ports 0x3C8/0x3C9 |

**Intermediate files**: `disasm/palette_search_extended.txt`, `disasm/color_palettes.txt`, `disasm/terrain_and_sky.txt`, `disasm/terrain_palettes_search.txt`

---

## Intermediate Disassembly Files

All located in `disasm/` directory:

| File | Contents |
|------|----------|
| `all_strings.txt` | Every string ≥4 chars from binary (31KB) |
| `game_strings.txt` | Filtered weapon/game strings (2.5KB) |
| `ui_complete.txt` | All strings in data region 0x055000-0x060000 (30KB) |
| `ui_strings.txt` | UI-keyword-filtered strings (10KB) |
| `weapon_data_corrected.txt` | Final weapon table with correct ordering (8KB) |
| `weapon_name_ptrtable.txt` | 57-entry name pointer table (5.5KB) |
| `weapon_name_refs.txt` | Code cross-references to weapon names (2.3KB) |
| `weapon_structs.txt` | Raw hex dumps of weapon structs (34KB) |
| `weapon_pointers.txt` | Pointer table analysis + MZ header (5.9KB) |
| `weapon_table.txt` | Initial weapon name extraction (3.6KB) |
| `weapon_data_final.txt` | Earlier extraction attempt (5.9KB) |
| `weapon_data_search.txt` | Price/blast sequence search results |
| `bundle_price_search.txt` | Bundle quantity pattern match (found stride=52) |
| `float_constants.txt` | IEEE 754 double search results (945KB) |
| `config_strings_region.txt` | Hex dump of config region (11KB) |
| `extras_region.txt` | Disassembly near extras.cpp (7.3KB) |
| `explosion_physics.txt` | Explosion strings and FPU code |
| `ai_code.txt` | AI/shark.cpp analysis |
| `shields_code.txt` | Shield code disassembly |
| `terrain_and_sky.txt` | Terrain/sky strings and class names (188KB) |
| `color_palettes.txt` | VGA palette search results (30KB) |
| `palette_search_extended.txt` | Extended palette search (1.9MB) |
| `r2_analysis.txt` | Radare2 auto-analysis output (2.6KB) |
| **`accessory_prices.txt`** | **Accessory/shield price verification + equip.cpp code analysis** |
| **`terrain_palettes_search.txt`** | **All 7 terrain type palettes with gradient calculations** |
| **`damage_formula.txt`** | **Explosion/damage system: functions, constants, formula** |
| **`war_quotes.txt`** | **All 15 war quotes with attributions** |

---

## Open Disassembly Tasks

### COMPLETED

1. ~~**Accessory/shield prices (items 35-56)**~~ — **RESOLVED**. Items 35-49 verified from struct data. Items 50-56 confirmed as a **linker data layout bug** — debug strings overwrite struct entries. No fallback pricing exists in code.

2. ~~**Terrain color palettes**~~ — **RESOLVED**. All 7 terrain types fully documented with gradient formulas. Palettes are generated algorithmically in code, not stored as raw data.

3. ~~**Explosion/damage formula**~~ — **PARTIALLY RESOLVED**. Core damage function at file 0x22BDF (93 FPU calls). Constants: PI/180, 0.7 falloff, +-2% randomization, polynomial coefficients. Three explosion types (single/MIRV-6/particle-8).

4. ~~**AI accuracy parameters**~~ — **RESOLVED**. Switch at 0x29505 pushes noise values per AI type (Moron=[50,50,50] through Spoiler=[63,63,63]). Cyborg/Unknown randomize to type 0-5. Sentient has **corrupted vtable** (second linker data overlap bug).

5. ~~**War quotes**~~ — **RESOLVED**. All 15 quotes with attributions extracted.

6. ~~**Shield system**~~ — **RESOLVED**. Config table at DS:0x616C: Shield=55HP, Warp=100HP, Teleport=100HP, Force=150HP, Heavy=200HP. Flat 1:1 absorption. Flicker = probabilistic on/off.

7. ~~**Borland FPU emulation**~~ — **RESOLVED**. INT 34h-3Dh emulation layer documented. PI/180 constant found at DS:0x1D08.

### HIGH PRIORITY (blocks game implementation)

8. **Items 50-56 actual prices** — Binary has corrupt data. Web search found no external source. Options:
   - Download Scorched Earth v1.2 from whicken.com and check if that binary has uncorrupted struct data
   - Run v1.50 in DOSBox debugger, check if prices are fixed up at runtime
   - Check the official HTML manual bundled with the game download
   - Ref: `disasm/accessory_prices.txt`

9. **AI trajectory solver internals** — Code segment 0x3167 identified. Need to decode how the AI calculates angle+power given target position, gravity, wind. Look for INT 34h-3Dh FPU patterns in this segment.
   - Ref: `disasm/ai_solver.txt`, `disasm/ai_code.txt`
   - Try: r2 disassemble segment 0x3167 (file ~0x38070), decode INT 34h-3Dh sequences

10. **Exact polynomial damage curve** — Core function at 0x22BDF uses coefficients -1.875, -1.75, -2.0, 0.7. Need full INT 34h-3Dh decode to get precise formula.
   - Ref: `disasm/damage_formula.txt`
   - Try: Write a Borland FPU emulation decoder script, apply to 0x22BDF region

11. **Tank rendering dimensions** — Exact pixel dimensions of tank body, turret, barrel for faithful reproduction. Likely in `icons.cpp` (5 assert references suggest complex drawing code).
   - Ref: icons.cpp code segments 0x1F7F-0x1F9B (file ~0x263F0)

### MEDIUM PRIORITY

12. **Popcorn Bomb / Funky Bomb behavior** — bhvType=0 (Funky) or no struct (Popcorn). Funky has bhvSub=0x1DCE (handler ptr). Need to trace the behavior dispatch to understand scatter/split mechanics.

13. **Player struct full layout** — Partial fields known from shield+explosion code:
   - +0x0E/+0x10: x/y position, +0x12/+0x14: dimensions
   - +0x4A: energy/shield field, +0x92: turret angle, +0x94: turret direction
   - +0x96: shield energy, +0xC6: shield config ptr, +0xB6: name far ptr
   - Need: cash, score, health, inventory array, team, AI type, alive flag

14. **Napalm/fire particle system** — bhvType 0x01A0 (Napalm, Hot Napalm, Ton of Dirt). How fire particles spread and deal damage over time.

15. **Roller physics** — bhvType 0x0003. How rollers interact with terrain slopes, velocity on hills, detonation conditions.

16. **MIRV split mechanics** — bhvType 0x0239. How/when MIRV splits at apogee, sub-warhead distribution pattern, Death's Head wider spread.

17. **Laser/beam weapons** — How Laser and Plasma Laser render and deal damage (continuous beam vs projectile).

### LOW PRIORITY

18. **Cheat codes** — "ASGARD", "frondheim", "ragnarok", "mayhem", "nofloat". Trace string references to find what each activates.

19. **Tosser/Unknown/Sentient AI details** — Tosser is functional (noise=[63,23]). Unknown randomizes to 0-5. Sentient has corrupted vtable — confirm non-functional.

20. **Cavern terrain mode** — "Cavern" string at 0x058F6D. Trace reference to find how this alternate mode works (ceiling + floor terrain?).

21. **Score system** — score.cpp at segment 0x30B2. Standard/Corporate/Vicious scoring mode formulas.

22. **Equip.cpp shop system** — Equipment init at 0x16BD4 maps 16 categories via `findWeaponByName()`. Could clarify shop UI flow and buy/sell mechanics.

23. **Sound system** — How sound effects are triggered, what format they use, Fastgraph sound integration.

24. **Simultaneous/Synchronous play modes** — How these differ from Sequential in the main game loop (play.cpp).

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
