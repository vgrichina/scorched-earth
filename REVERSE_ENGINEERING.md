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
| 50 | Force Shield | 25,000 | 3 | 4 | 0x0000 | 0 | *(binary corrupt — price from official manual)* |
| 51 | Heavy Shield | 30,000 | 2 | 4 | 0x0000 | 0 | *(binary corrupt — price from official manual)* |
| 52 | Super Mag | 40,000 | 2 | 4 | 0x0000 | 0 | *(binary corrupt — price from official manual)* |
| 53 | Patriot Missiles | ??? | — | — | 0x0000 | 0 | *(binary corrupt — not listed in official manual)* |
| 54 | Auto Defense | 1,500 | 1 | 2 | 0x0000 | 0 | *(binary corrupt — price from official manual)* |
| 55 | Fuel Tank | 10,000 | 10 | 2 | 0x0000 | 0 | *(binary corrupt — price from official manual)* |
| 56 | Contact Trigger | 1,000 | 25 | 1 | 0x0000 | 0 | *(binary corrupt — price from official manual)* |

**Status**: Items 2-49 fully verified from binary struct data. Items 50-56 have a **data layout bug** — the Borland C++ linker placed the `equip.cpp` debug string and `"Failed to identify item"` assert message at file offset 0x05793A, which is exactly where item 50's struct starts (0x056F76 + 48×52 = 0x05793A). The game code reads prices only from the struct field (`[bx + 0x11FA]`) with no fallback, so items 50-56 have garbage prices at runtime. This is a confirmed linker-era bug in v1.50. **Intended prices for 50-56 recovered from the official Scorched Earth manual** (abandonwaredos.com bundle). Patriot Missiles (idx 53) are not listed in the manual — possibly a hidden/debug item or added after the manual was printed.

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

### Weapon Behavior Dispatch (VERIFIED)

#### Central Dispatch (file 0x1C6C8)

The weapon fire handler dispatches through far pointers stored in the weapon struct. BhvType is the code offset within the handler's segment, and BhvSeg is the segment paragraph address. Together they form a `lcall [weapon_idx * 52 + DS:0x1200]` indirect far call.

```c
void weapon_fire_handler(int x, int y) {
    DS:CE94++;                        // shot counter
    projectile_t *proj = &proj_array[DS:E4DA];  // stride 0x6C

    if (proj->flags_3a & 0x01) {
        // MIRV sub-warhead special case
        DS:CEBC--;                    // warhead counter
        lcall 0x25D5:0x0239;          // mirv handler
        if (DS:CEBC <= 0) lcall 0x25D5:0x0009;  // cleanup
    } else {
        // Generic dispatch through weapon struct far pointer
        lcall [DS:E344 * 0x34 + 0x1200];  // weapon_struct.bhv_handler
    }
}
```

#### Handler Segment Map

Each weapon behavior type has its handler in a **dedicated code segment**, NOT all in extras.cpp:

| Handler | Segment | File Offset | Weapons |
|---------|---------|-------------|---------|
| Standard projectile | 0x3D1E | 0x43BE0 | Baby Missile, Missile, Baby Nuke, Nuke |
| MIRV/Death's Head | 0x25D5 | 0x2C750 | MIRV, Death's Head |
| Roller | 0x2FBD | 0x365D0 | Baby Roller, Roller, Heavy Roller |
| Napalm/fire | 0x26E6 | 0x2D860 | Napalm, Hot Napalm, Ton of Dirt |
| Funky Bomb/scatter | 0x1DCE | 0x246E0 | Funky Bomb |
| LeapFrog/bounce | 0x2382 | 0x2A220 | LeapFrog |
| Digger/tunnel | 0x151B | 0x1BBB0 | Diggers, Sandhogs, Riot Bomb |
| Dirt adding | 0x15A0 | 0x1C400 | Dirt Clod, Dirt Ball, Heavy Sandhog |

#### MIRV / Death's Head (BhvType 0x0239, Segment 0x25D5)

**Apogee detection** (file 0x25B30): Compares velocity sign against stored "last sign" fields. When sign flips in either axis → split triggered.

```c
// Per-frame update detects apex of trajectory arc
int mirv_per_frame() {
    double vx = (double)proj->origin_x - proj->fpos_x;
    double vy = proj->fpos_y - (double)proj->origin_y;

    int split_flag = 0;
    if (sign(vx) != proj->last_sign_x) split_flag = 1;  // +0x66
    if (sign(vy) != proj->last_sign_y) split_flag = 1;  // +0x68

    if (split_flag && proj->split_type == 1) {  // +0x6A
        spawn_sub_warheads();  // 6 sub-warheads, 12-byte stride
        do_crater(pos_x, pos_y);
        kill_projectile(DS:E4DA);
        return 0;  // consumed
    }
    return 1;  // still in flight
}
```

**Sub-warhead damage** (file 0x2C759): `damage = (radius - dist) * 100 / radius`, capped at 110. Death's Head (param=1) uses wider spread table than MIRV (param=0) via DS:529E.

#### Funky Bomb (BhvType 0x0000, Segment 0x1DCE)

BhvType=0 but with non-zero BhvSeg=0x1DCE — offset 0 is literally the entry point.

```c
void funky_bomb_handler(int x, int y) {
    int blast_radius = weapon_param;  // 80

    // Direct hit check
    if (hit_player && !shielded)
        apply_damage(1, blast_radius / 10, hit_player);

    // Spawn 5-10 sub-bombs
    int num_bombs = random(6) + 5;
    for (int i = 0; i < num_bombs; i++) {
        sub_x = random(2 * radius) - radius + x;  // scatter within 2x radius
        sub_y = screen_top;                         // fall from top
        clamp(&sub_x, screen_left, screen_right);
    }
    // Simulate sub-bombs falling under gravity
    // Each triggers small explosion on terrain contact
}
```

#### Roller (BhvType 0x0003, Segment 0x2FBD)

Two-phase: impact handler (0x365D3) + per-frame terrain follower (0x3684B).

```c
void roller_on_impact(int x, int y) {
    // Determine roll direction from horizontal velocity
    int direction = (DS:E4DC > 0.0) ? 1 : -1;

    // Scan terrain left and right to find deeper valley
    int left_depth = scan_terrain_depth(x, -1);
    int right_depth = scan_terrain_depth(x, +1);
    // Roll toward deeper valley; fall back to velocity direction

    // Spawn rolling projectile with terrain-follower callback
    proj->callback_seg = 0x2FBD;   // +0x4E
    proj->callback_off = 0x027B;   // +0x4C
    proj->roll_direction = direction;  // +0x66
}

void roller_per_frame() {
    // Gravity acceleration: speed += gravity * factor
    // Terrain pixel test: color >= 0x69 (105) = solid
    // Follow surface contour, handle walls (wrap/bounce/explode)
    // Explode on player contact or edge of screen
}
```

- Terrain threshold: pixel color >= 0x69 (105)
- Supports all wall types during rolling (wrap-around, concrete, rubber, etc.)
- Rolling speed increases via gravity: `speed += gravity * acceleration_factor`

#### Napalm / Hot Napalm (BhvType 0x01A0, Segment 0x26E6)

99-slot particle pool with 6-byte particle structs (x, y, next_ptr).

```c
void napalm_handler(int x, int y) {
    int param = weapon_param;  // 15=Napalm, 20=Hot Napalm, -20=Ton of Dirt

    if (param < 0) {
        param = -param;
        DS:E702 = 0x50;       // dirt palette (brown)
    } else {
        DS:E702 = 0xFE;       // fire palette (bright)
    }
    if (param > 20) param = 20;  // max 20 simultaneous particles

    // Main simulation loop:
    //   1. Allocate particle from 99-slot circular pool
    //   2. Animate flame with random flicker (40x10 grid)
    //   3. Particles spread outward, fall under gravity
    //   4. Burn/melt terrain on contact, damage nearby players
    //   5. Velocity dampened 0.7x per frame (DS:1D60)
    //   6. Stop when speed² < 0.001 (DS:1D68 epsilon)
}
```

- Negative param (Ton of Dirt = -20) switches to dirt mode with brown palette
- Circular allocation with recycling after all 99 slots used once
- Sorted linked list maintains render order by Y position
- Same 0.7x velocity falloff constant as the damage system

#### Popcorn Bomb (Special Case)

No weapon struct data. Hardcoded special case in the projectile physics loop, before the dispatch mechanism is reached.

**Intermediate files**: `disasm/weapon_dispatch_decoded.txt`, `disasm/extras_decoded.txt`



#### Laser / Plasma Laser Accessories (VERIFIED)

Laser and Plasma Laser are **accessories**, not fireable beam weapons. They have NULL behavior function pointers (`0x0000:0x0000`) and are classified as accessories by `equipInit` (file 0x1D5D4).

**Key discovery**: Struct fields `+0x0A`/`+0x0C` are a **far function pointer** (offset:segment), dispatched at file 0x2120A via `call word far [bx + 0x1200]`. NULL pointers indicate non-weapon accessories.

**Accessory boundary**: `DS:E4F0 = 33` (Laser), `DS:D548 = 32` (Earth Disrupter = last weapon). Weapon cycling wraps at this boundary.

**Targeting line function** (file 0x36321, segment 0x2F76:0x01C1):

```c
void draw_laser_sight(int x, int y, int angle, int end_angle, int power, int type) {
    double angle_rad = angle * PI_180;      // DS:6100
    double end_rad = end_angle * PI_180;
    if (type == 1) {        // Plasma Laser
        DS:EC4C = 0xFFFF;   // no erase mask
        DS:EC4E = 0xFE;     // bright white (254)
    } else {                // Standard Laser
        DS:EC4C = 0xFE;     // erase on white pixels
        DS:EC4E = 0x78;     // green/turquoise (120)
    }
    while (angle_rad < end_rad) {
        int dx = (int)(sin(angle_rad) * (-power));
        int dy = (int)(cos(angle_rad) * power);
        bresenham_line(old_pos, new_pos, pixel_callback);
        angle_rad += ANGLE_STEP;  // DS:6108 ~0.3 rad
    }
    bresenham_line(old_pos, final_pos, pixel_callback);
}
```

**Per-pixel callback** (file 0x36271, segment 0x2F76:0x0111): checks bounds, cavern wrapping. Laser (0x78) blends with terrain; Plasma Laser (0xFE) overwrites background.

| Property | Laser | Plasma Laser |
|----------|-------|--------------|
| Price | 10,000 | 10,000 |
| Bundle | 6 uses/buy | 2 uses/buy |
| Arms Level | 2 | 2 |
| Sight Color | 0x78 (green) | 0xFE (white) |
| Erase Mode | 0xFE mask | -1 (no mask) |

Code segment 0x2F76 is shared between laser sight display and Plasma Blast/Riot beam animations (`plasma_blast_handler` at 0x2F76:0x000D, `riot_blast_handler` at 0x2F76:0x03BD).

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
- Cheat strings: "ASGARD", "frondheim", "ragnarok", "mayhem", "nofloat" (see Cheat Codes section)
- Config file: "scorch.cfg" (0x05AF44), debug: "scorch.dbg" (0x057CB4)

### Cheat Codes (VERIFIED — fully traced)

Handler function at file offset 0x02A42D. Uses `getenv()` and `stricmp()` for matching.

| Activation | String | Flag | DS Offset | Effect |
|-----------|--------|------|-----------|--------|
| `SET ASGARD=frondheim` | frondheim | cheat_mode=1 | DS:0x6E64 | **Monochrome debug overlay** — renders debug text to B000:0000 (MDA/Hercules VRAM), 80x25 chars, scrolling. Wendell Hicken's second-monitor debug console. |
| `SET ASGARD=ragnarok` | ragnarok | cheat_mode=2 | DS:0x6E64 | **Debug log to file** — opens `scorch.dbg` in write-text mode, all debug output goes to file instead of overlay. |
| `SCORCH.EXE mayhem` | mayhem | mayhem_flag=1 | DS:0x50F2 | **All weapons, max ammo** — sets every weapon type (1-47) to quantity 99 at round init. |
| `SCORCH.EXE nofloat` | nofloat | nofloat_flag=1 | DS:0x1C84 | **Disable FPU physics** — skips FPU-based terrain settling loop, uses coarse integer positions. For machines without 8087/80287 coprocessor. |
| `SCORCH.EXE <name>` | player name | human_player=idx | DS:0x6E26 | **Select human player** — matches against registered player names (base DS:0x6B66, stride 0x44, up to 9 players). |

```c
void process_args(int argc, char far **argv) {
    char far *env_val = getenv("ASGARD");
    if (env_val == NULL || stricmp(env_val, "frondheim") != 0)
        cheat_mode = 0;          // DS:6E64 = disabled
    if (stricmp(env_val, "ragnarok") == 0)
        cheat_mode = 2;          // DS:6E64 = file debug

    for (int i = 1; i < argc; i++) {
        // Check player names first
        for (int j = 0; j < num_players; j++)
            if (stricmp(argv[i], player_names[j]) == 0) { human_player = j; break; }
        if (stricmp(argv[i], "mayhem") == 0)  { mayhem_flag = 1; continue; }
        if (stricmp(argv[i], "nofloat") == 0) { nofloat_flag = 1; continue; }
        cfg_file = argv[i];      // unrecognized = config path
    }
}
```

**Key finding**: ASGARD/frondheim/ragnarok are **debug modes**, not gameplay cheats. Only `mayhem` (all weapons) affects gameplay. `nofloat` is a compatibility switch for FPU-less machines.

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

**Damage formula (TRACED from FPU decode — rotation-based, not polynomial)**:

The actual damage system uses a 2D rotation of the projectile velocity vector, not a simple
distance falloff. Damage is proportional to impact speed, with directional weighting.

Three functions implement the core damage logic (all in extras.cpp segment):

```c
// =====================================================================
// Function 1: apply_damage_to_player (file 0x23327-0x235DD)
// Called per-player by the explosion iteration loop.
// Returns: 1 = projectile still approaching (skip), 0 = damage applied
// =====================================================================
// Globals:
//   DS:E4DC (f64) = projectile velocity X
//   DS:E4E4 (f64) = projectile velocity Y
//   DS:1C7A (u16) = "damage applied" flag
//   DS:CE9A (u16) = state counter (set to 3)
//   DS:1D5C (f32) = 2.0    DS:1CC8 (f32) = 100.0
//   DS:1D60 (f64) = 0.7 (velocity falloff per hit)

int apply_damage_to_player(player_t far *player, int expl_x, int expl_y) {
    DS:CE9A = 3;

    int dx = expl_x - player->x;       // player.x at +0x0E
    int dy = player->y - expl_y;        // player.y at +0x10

    on_screen(expl_y, expl_x);          // visibility check (0x32C2:0x1519)

    // Sign comparison: is the projectile approaching or receding?
    // If velocity points same direction as player→explosion displacement
    // in BOTH axes, projectile hasn't passed yet — skip damage.
    int sign_dx = sign(dx);    // -1, 0, or +1
    int sign_vx = sign(DS:E4DC);
    if (sign_dx == sign_vx) {
        int sign_dy = sign(dy);
        int sign_vy = sign(DS:E4E4);
        if (sign_dy == sign_vy)
            return 1;          // still approaching, don't apply yet
    }

    // Projectile has passed or is receding — compute damage
    DS:1C7A = 1;               // flag: damage was applied this frame

    // Angle from explosion to player
    double angle1 = atan2((double)dy, (double)dx);

    // Projectile direction angle
    double angle2 = atan2(DS:E4E4, DS:E4DC);

    // Double the angular difference for rotation
    double adjusted = (angle2 - angle1) * 2.0;

    double cos_val = cos(adjusted);
    double sin_val = sin(adjusted);

    // Negate velocity (reverse direction for impact calculation)
    DS:E4DC = -DS:E4DC;
    DS:E4E4 = -DS:E4E4;

    // 2D rotation of negated velocity vector
    double new_vx = cos_val * DS:E4DC + sin_val * DS:E4E4;
    double new_vy = cos_val * DS:E4E4 - sin_val * DS:E4DC;

    DS:E4DC = new_vx;
    DS:E4E4 = new_vy;

    // Damage = rotated speed magnitude / 100
    double distance = sqrt(new_vx * new_vx + new_vy * new_vy);
    int damage = (int)(distance / 100.0);

    apply_damage(player, damage, 0);     // 0x3912:0x4B2

    // Attenuate velocity for subsequent player hits
    DS:E4DC *= 0.7;
    DS:E4E4 *= 0.7;

    return 0;
}


// =====================================================================
// Function 2: scatter_damage (file 0x235DE-0x236C4)
// Called for scatter-type weapons (Funky Bomb, etc.).
// Picks a random screen point, applies fixed 10 damage, then
// triggers another explosion processing pass at that point.
// =====================================================================

void scatter_damage(player_t far *player) {
    // Random point within visible screen bounds
    int rand_x = random(screen_max_x - screen_min_x + 1) + screen_min_x;
    int rand_y = random(screen_max_y - screen_min_y + 1) + screen_min_y;
    // screen bounds: DS:EF3C/EF42 (x), DS:EF38/EF40 (y)

    // Normalize velocity if above epsilon threshold
    double mag_sq = DS:E4DC * DS:E4DC + DS:E4E4 * DS:E4E4;
    if (mag_sq > 0.001) {
        double mag = sqrt(mag_sq);
        normalize_vector(&DS:E4DC, &DS:E4E4);  // 0x2BF9:0x3F4
        DS:E4DC *= mag;
        DS:E4E4 *= mag;
    }

    // Apply fixed 10 damage to this player
    apply_damage(player, 10, 0);

    // Trigger explosion processing at random point
    // (iterates all players near rand_x, rand_y)
    process_explosion_at(rand_x, rand_y);    // file 0x22DFA

    DS:CE9A = 3;
}


// =====================================================================
// Function 3: post_damage_cleanup (file 0x236C7+)
// Called after damage is applied to decrement weapon counters.
// =====================================================================

void post_damage_cleanup(int player_index) {
    player_t *p = &players[player_index];   // stride 0x6C, base DS:CEB8
    sub_struct_t *sub = p->sub_ptr;          // far ptr at +0x2A
    sub->counter--;                          // +0x2E: warhead/charge counter
    p->flag_3c = 0;                          // +0x3C: clear active flag
}
```

**Key insight**: The old "polynomial falloff" hypothesis was **incorrect**. The actual algorithm
uses atan2/cos/sin rotation to compute how much of the projectile's remaining velocity is
directed at each player. Damage is speed-based (faster impact = more damage), reduced by
0.7× per player hit. The rotation step effectively computes a directional impact factor —
a direct hit transfers full velocity, while a glancing angle transfers less.

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

### AI Solver (shark.cpp at 0x05BEDA) — TRACED

Code segment **0x3167** (file base ~0x38070). Uses Borland INT 34h-3Dh FPU emulation.

**AI solver pseudocode (from FPU decode of `ai_solver_decoded.txt`)**:

The AI solver is a **step-by-step projectile simulation** — not a closed-form ballistic equation.
It normalizes the direction toward the target, steps one pixel at a time checking `fg_getpixel`
for terrain/player collisions, and decrements scaled gravity each pass to try flatter arcs.

```c
// =====================================================================
// Function 1: ai_select_target (file 0x24F01-0x24FCE)
// Iterates all players, finds closest alive enemy within threshold.
// Target struct stride = 0xCA (202 bytes), base at DS:D568.
// =====================================================================

int ai_select_target(int my_x, int my_y) {
    for (int i = 0; i < max_players /* DS:50D4 */; i++) {
        target_t *candidate = &targets[i];  // DS:D568 + i * 0xCA

        player_t *me = &players[DS:E4DA];   // stride 0x6C, base DS:CEB8
        if (me->sub_ptr == candidate)        // +0x2A: skip self
            continue;
        if (candidate->alive == 0)           // +0x18: skip dead
            continue;

        int dist = compute_distance(my_x, my_y, candidate->x, candidate->y);
        if (dist >= DS:5186)                 // distance threshold
            continue;

        // Store target in player struct
        me->target_ptr = candidate;          // +0x3E/+0x40
        me->target_x = candidate->x;        // +0x44
        me->target_y = candidate->y;        // +0x46
        return 1;  // target found
    }
    return 0;  // no valid target
}


// =====================================================================
// Function 2: ai_solve_trajectory (file 0x24FCF-0x254E8) — MAIN SOLVER
// Step-by-step simulation. Decrements scaled_gravity by 1.0 each pass.
// =====================================================================

void ai_solve_trajectory(void) {
    // Compute scaled gravity
    DS:31F4 = DS:CEAC * DS:31FC;  // gravity * multiplier

    player_t *me = &players[DS:E4DA];
    double pos_x = me->f64_x;       // +0x14 (f64, via INT 3Ch)
    double pos_y = me->f64_y;       // +0x1C (f64)
    int cur_ix = (int)pos_x;
    int cur_iy = (int)pos_y;

    // === OUTER LOOP: try arcs, reducing gravity each pass ===
    while (DS:31F4 > 0.0) {
        // Direction to target (Chebyshev normalization)
        double dx = (double)me->target_x - pos_x;
        double dy = (double)me->target_y - pos_y;
        double max_comp = max(abs(dx), abs(dy));
        if (max_comp == 0.0) break;  // at target

        dx /= max_comp;  dy /= max_comp;  // normalize to [-1,1]

        // Compute next integer position
        int next_ix = (int)(pos_x + dx);
        int next_iy = (int)(pos_y + dy);
        int step_x = next_ix - cur_ix;
        int step_y = next_iy - cur_iy;

        if (step_x == 0 && step_y == 0) {
            pos_x += dx;  pos_y += dy;     // sub-pixel advance
            goto next_pass;
        }

        // Check pixel at next position
        int pixel = fg_getpixel(next_ix, next_iy);

        if (pixel >= 0x69)                  // sky/background
            goto advance;
        if (pixel < 0x50) {                 // hit a player/entity
            int idx = pixel / 8;
            if (&targets[idx] == me->target_ptr)
                goto advance;               // hit our target = success
            // Hit obstacle — try lateral movement or abort
        }
        // ... terrain collision handling, wall-hugging logic ...

    advance:
        pos_x += dx;  pos_y += dy;
        cur_ix += step_x;  cur_iy += step_y;

        // Store velocity components as output
        DS:E4DC = (double)step_x;           // global vx
        DS:E4E4 = (double)step_y;           // global vy

        // Check if reached target
        if (me->target_x == cur_ix && me->target_y == cur_iy) {
            // SUCCESS — draw crosshair, fire
            return;
        }

    next_pass:
        DS:31F4 -= 1.0;                     // try flatter arc
    }

    // Gravity exhausted — store final position
    me->field_00 = cur_ix;
    me->field_02 = cur_iy;
    me->f64_x = pos_x;
    me->f64_y = pos_y;
}


// =====================================================================
// Function 3: ai_compute_power (file 0x254E9-0x2589B)
// Ballistic power calculator. Given angle and target, computes
// required power using projectile range formula with sin/cos.
// =====================================================================

int ai_compute_power(tank_t far *tank, int target_x, int target_y, int recurse) {
    // Determine firing direction from turret angle
    int dir = (tank->angle < 90) ? 1 : (tank->angle > 90) ? -1 : tank->direction;

    // Convert angle to radians, compute barrel tip position
    double angle_rad = (double)effective_angle * DS:320C;  // pi/180
    double barrel_x = cos(full_angle_rad) * power + tank->x;
    double barrel_y = tank->y - sin(angle_rad) * power;

    // Relative offset to target
    double dx = (double)target_x - barrel_x;
    double dy = barrel_y - (double)target_y;

    // Ballistic formula: power^2 = ref_dist * dx^2 / (cos^2 * sin_component)
    double cos_a = cos(angle_rad);
    double sin_component = sin(2 * angle_rad) * dx - dy;
    double power_sq = DS:3214 * cos_a * cos_a * sin_component;

    if (power_sq == 0.0) {
        if (recurse == 0) { tank->angle++; /* retry */ }
        else return -2;
    }

    double power_val = sqrt(abs(ref_dist * dx * dx / power_sq)) * DS:3218;
    return (int)power_val;
}


// =====================================================================
// Function 4-5: ai_wind_correction (file 0x2589C-0x25DC0)
// Two variants. Checks if wind opposes shot direction.
// If so: abort or zero velocity. Otherwise: apply correction
// proportional to gravity / dist^(1/4).
// =====================================================================

int ai_wind_correction(void) {
    player_t *me = &players[DS:E4DA];
    double dx = (double)me->target_x - me->f64_x;
    double dy = me->f64_y - (double)me->target_y;

    // Check if wind opposes direction
    if ((dx > 0 && me->wind_x < 0) || (dx < 0 && me->wind_x > 0))
        return abort_or_zero();
    if ((dy > 0 && me->wind_y > 0) || (dy < 0 && me->wind_y < 0))
        return abort_or_zero();

    double dist_sq = dx * dx + dy * dy;
    if (dist_sq < DS:321C) return 1;     // too close

    // Correction = gravity * constant / dist^(1/4)
    double correction = DS:3224 * DS:CEAC / sqrt(sqrt(dist_sq));
    me->vel_x += correction * dx;
    me->vel_y += correction * dy;
    return 1;
}


// =====================================================================
// Function 6-7: ai_inject_noise (file 0x25DE9-0x2610F)
// Generates 2-5 sinusoidal harmonics with random amplitude/frequency.
// Difficulty param controls wavelength (higher = smaller noise = more accurate).
// Harmonics are summed per-column to produce aim wobble.
// =====================================================================

void ai_inject_noise(int difficulty, int arc_center) {
    double wavelength_x = DS:322E / (double)(difficulty * 2);
    double wavelength_y = DS:3236 / 10.0;
    double amp_decay = wavelength_x * DS:323E;

    int x_pos = arc_center - 30;
    int n = 0;  // DS:322C = harmonic count

    while (x_pos > 10 && n < 5) {
        amplitude[n] = random_float() * (double)x_pos * DS:3242;

        // Rejection-sample frequency into valid band
        do { frequency[n] = random_float() * amp_decay; }
        while (frequency[n] >= wavelength_x || frequency[n] <= wavelength_y);

        phase[n] = (double)random_int(300);

        x_pos = (int)((double)x_pos - amplitude[n] * DS:3246);
        amp_decay *= DS:323E;
        n++;
    }
    if (n < 2) goto retry;  // need at least 2 harmonics
}

// Noise application: for each column in firing arc:
//   displacement = base_y + SUM(amplitude[h] * sin(frequency[h] * (phase[h] + step)))
// This produces smooth sinusoidal aim wobble proportional to AI difficulty.
```

**Key architecture insight**: The AI does NOT use a closed-form ballistic equation to solve for
angle/power. Instead, it uses **pixel-level ray marching** — stepping one pixel at a time along
a normalized direction vector, reading screen pixels via `fg_getpixel` to detect terrain and
players. The gravity parameter is decremented by 1.0 each outer pass, scanning progressively
flatter trajectory arcs. This brute-force approach is why the AI is called "shark" — it swims
through the screen pixel by pixel until it finds the target.

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

Two-level vtable indirection:

**Level 1 — Pointer table** at **DS:0x02E2** (file 0x056062): Array of 7 far pointers (4 bytes each), each pointing to a 16-byte vtable block within DS (segment 0x4F38).

**Level 2 — Vtable blocks** at **DS:0x0272** (file 0x055FF2): Each block has 4 far function pointers (slot[0]=reserved/NULL, slot[1]=AI init, slot[2]=primary action, slot[3]=secondary action).

| Type | Name | Pointer Table Entry | Vtable Block | slot[1] (init) | slot[2] (primary) | slot[3] (secondary) |
|------|------|--------------------|--------------|---------|-----------|----|
| 0 | Human | DS:0x02E2 → 4F38:0272 | DS:0x0272 | 262C:004E | 262C:0241 | NULL |
| 1 | Moron | DS:0x02E6 → 4F38:0282 | DS:0x0282 | 11B5:05F7 | 320D:007E | 320D:0380 |
| 2 | Shooter | DS:0x02EA → 4F38:0292 | DS:0x0292 | 11B5:05F7 | 315D:000C | 315D:0241 |
| 3 | Poolshark | DS:0x02EE → 4F38:02A2 | DS:0x02A2 | 11B5:05F7 | 3B6B:0007 | 3B6B:00FE |
| 4 | Tosser | DS:0x02F2 → 4F38:02B2 | DS:0x02B2 | 11B5:05F7 | 1132:000F | 1132:00F0 |
| 5 | Chooser | DS:0x02F6 → 4F38:02C2 | DS:0x02C2 | 11B5:05F7 | 34B2:0163 | 34B2:02F3 |
| 6 | Spoiler | DS:0x02FA → 4F38:02D2 | DS:0x02D2 | 11B5:05F7 | 14C8:03E3 | 14C8:0501 |
| 7 | Cyborg | DS:0x02FE → **6F53:0007** | CORRUPTED | Randomized to 0-5 at runtime |
| 8 | Unknown | DS:0x0302 → **656D:6420** | CORRUPTED | Randomized to 0-5 at runtime |
| 9 | Sentient | DS:0x0306 → **2062:6D75** | CORRUPTED | **NOT randomized — crashes DOS** |

Entries 7-9 read from the string `"Some dumb tank: %s\n"` at DS:0x0300, misinterpreted as far pointers.

Dispatch code at file 0x29280 (segment 0x2288):
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

Sentient (type 8) is **never randomized** and would index into garbage data. See "Sentient AI" section below for full corruption analysis.

**Intermediate files**: `disasm/ai_code.txt`, `disasm/ai_solver.txt`, `disasm/play_modes_sentient_analysis.txt`

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

See full **Player Data Structures** section for complete layout. Shield-relevant fields in the sub-struct (0xCA):

| Offset | Field |
|--------|-------|
| +0x0E | X position |
| +0x10 | Y position |
| +0x92 | Turret angle (fine) |
| +0x94 | Turret direction (-1 or 1) |
| +0x96 | Shield energy remaining (HP) |
| +0xC6 | Far pointer to shield config entry (16 bytes) |

### Mag Deflector / Super Mag

These are **not shield types** — they modify projectile trajectories through the physics system rather than absorbing damage. Work via separate deflection zone mechanics.

**Intermediate files**: `disasm/shields_code.txt`, `disasm/shield_mechanics.txt`

---

## Player Data Structures (VERIFIED)

### Architecture: Two-Level Player Records

The game uses a **two-level player data structure**:

1. **Player struct** (0x6C = 108 bytes) — compact record for hot-loop iteration (explosion damage, projectile sim). Contains per-frame state: positions, velocities, targets, callbacks, wind, fire mode.
2. **Target/sub struct** (0xCA = 202 bytes) — full tank state with turret, shields, AI targeting, power, linked-list nodes, config pointers. Each player's player struct points to one of these via far pointer at +0x2A/+0x2C.

**Access patterns:**
- Player: `mov ax,[DS:E4DA]; imul ax,ax,0x6C; les bx,[DS:CEB8]; add bx,ax`
- Sub/target: `imul ax,ax,0xCA; add ax,0xD568` or via `les bx,[DS:5182]`
- Pixel color on screen ÷ 8 = sub-struct index (each player owns 8 consecutive VGA colors)

### Player Struct (stride 0x6C = 108 bytes, base DS:CEB8)

Current player index at DS:E4DA.

| Offset | Size | Type | Field | Evidence |
|--------|------|------|-------|----------|
| +0x00 | 2 | int16 | cur_ix | Integer X position. Written by AI solver (extras 0x216C5) |
| +0x02 | 2 | int16 | cur_iy | Integer Y position. Written after +0x00 (extras 0x216D6, ai_solver 0x254AF) |
| +0x04 | 8 | f64 | fpu_slot_04 | FPU store target. INT 3Ch FSTP. Likely step_x or velocity_x |
| +0x0C | 8 | f64 | fpu_slot_0C | FPU store target. INT 3Ch FSTP. Likely step_y or velocity_y |
| +0x14 | 8 | f64 | world_x | Float64 world X. Loaded/stored via INT 3Ch FLD/FSTP. AI trajectory uses this |
| +0x1C | 8 | f64 | world_y | Float64 world Y. FLD qword [bx+0x1C] in damage_formula.txt |
| +0x24 | 2 | int16 | guidance_type | Guidance/weapon mode. Compared to DS:D54E/D550. Set to 0 when consumed |
| +0x26 | 2 | int16 | weapon_index | Weapon type index. Read at extras 0x22114 to index weapon struct table |
| +0x28 | 2 | int16 | blast_radius | Explosion radius. Set from sub+0xA0 + 0x6E, or default 0x78 (120) |
| +0x2A | 4 | fptr | sub_ptr | Far pointer to own sub-struct. `les bx,[es:bx+0x2a]` to follow |
| +0x2E | 2 | int16 | warhead_count | Warhead counter. `dec [es:bx+0x2e]` post-damage (0x236E8). Set to 1 at 0x217AA |
| +0x30 | 2 | int16 | mirv_counter | MIRV index. Set to 0 at 0x21869, inc at 0x21EB3, cmp to 6 at 0x21F35 |
| +0x3A | 2 | uint16 | flags | Bitfield. `or word [es:bx+0x3a],0x1` = set active/hit bit (0x21427, 0x21570) |
| +0x3C | 2 | int16 | active | In-flight flag. Set to 1 at 0x2171D, cleared at 0x236F7 |
| +0x3E | 4 | fptr | target_ptr | Far pointer to TARGET's sub-struct. Written by ai_select_target (0x24F85) |
| +0x44 | 2 | int16 | target_x | Target X (copied from target sub+0x0E). Written at 0x24F9D |
| +0x46 | 2 | int16 | target_y | Target Y (copied from target sub+0x10). Written at 0x24FB5 |
| +0x48 | 2 | int16 | hit_flag | Collision flag. Set to 0 at 0x21685, set to 1 at 0x2299B |
| +0x4A | 2 | int16 | energy | Shield absorption. `sub es:[bx+0x4A],0x11` (17 pts inner), `0x10` (16 pts outer) |
| +0x4C | 4 | fptr | callback | Far function pointer. Called via `call far [es:bx+0x4c]` at 0x21A85. Seg=0x1E50 (shark.cpp) |
| +0x50 | 4 | fptr | callback2 | Second far callback. `call far [es:bx+0x50]` at 0x220FF. Set to 0 at 0x21771 |
| +0x54 | 2 | int16 | damage_type | Explosion type code. Set to 2 at 0x21397 |
| +0x56 | 16 | f64[] | fpu_workspace | FPU store area for intermediate calculations |
| +0x66 | 2 | int16 | wind_x | Wind X component. Checked in wind correction (ai_solver 0x2592A) |
| +0x68 | 2 | int16 | wind_y | Wind Y component. Checked in wind correction (ai_solver 0x25997) |
| +0x6A | 2 | int16 | fire_mode | 1=direct fire, 2=guided. `cmp [es:bx+0x6a],0x1` at ai_solver 0x25A08 |

### Target/Sub Struct (stride 0xCA = 202 bytes, base DS:D568)

Full tank state record. Global pointer at DS:5182/5184.

| Offset | Size | Type | Field | Evidence |
|--------|------|------|-------|----------|
| +0x00 | 2 | int16 | struct_type | Compared to 6 at extras 0x213FC. Identifies struct variant |
| +0x02 | 2 | int16 | power | Power value. Read at ai_solver 0x25588 |
| +0x04 | 4 | fptr | fn_ptr | Power mult / far call target in projectile iteration (0x220BE) |
| +0x08 | 4 | fptr | linked_next | Linked list next. `les bx,[es:bx+0x8]` at 0x239B8 |
| +0x0C | 4 | fptr | linked_prev | Linked list prev / shield flags. `les bx,[es:bx+0xc]` at 0x239DF |
| +0x0E | 2 | int16 | x_pos | X position (pixels). `sub ax,[es:bx+0xe]` in damage calc (0x23344) |
| +0x10 | 2 | int16 | y_pos | Y position (pixels). `mov ax,[es:bx+0x10]` in damage calc (0x2334D) |
| +0x18 | 2 | int16 | alive | Alive flag. `cmp [es:bx+0x18],0x0` in ai_select_target (0x24F46) |
| +0x22 | 2 | int16 | active_shield | Shield type index. Dispatch: `shl bx,4; call far [bx+0x26e]` at 0x231B0 |
| +0x24 | 2 | int16 | defense_counter | Defense/parachute counter. Checked at 0x2263D |
| +0x26 | 2 | int16 | projectile_type | Current weapon type for shot. Read at 0x21964 |
| +0x28 | 2 | int16 | explosion_radius | Explosion radius param. Set from +0xA0 at 0x218A1 |
| +0x2A | 4 | fptr | warhead_ptr | Far pointer to warhead/projectile data. `les bx,[es:bx+0x2a]` at 0x2188A |
| +0x2E | 2 | int16 | warhead_count | Charge counter. `dec [es:bx+0x2e]` at 0x236E8, `inc` at 0x21662 |
| +0x30 | 2 | int16 | mirv_index | MIRV sub-warhead index. 0→6 (6 sub-warheads) |
| +0x32 | 2 | int16 | turret_angle | Turret angle (0-180°). `cmp [es:bx+0x32],0x5a` (90°) at ai_solver 0x25500 |
| +0x34 | 2 | int16 | power_level | Current power for shot |
| +0x38 | 2 | int16 | retry_counter | AI retry counter. If > 4, resets target (ai_solver line 170) |
| +0x3A | 2 | uint16 | flags | Status flags. `test byte [es:bx+0x3a],0x1` at 0x23114 |
| +0x3C | 2 | int16 | active | In-flight flag. `cmp [es:bx+0x3c],0x0` at 0x2163F |
| +0x44 | 2 | int16 | proj_target_x | Projectile target X. `cmp [es:bx+0x44],si` at 0x22720 |
| +0x46 | 2 | int16 | proj_target_y | Projectile target Y. `cmp [es:bx+0x46],di` at 0x2266C |
| +0x48 | 2 | int16 | collision_flag | Hit detection. Set to 0 at 0x21685, set to 1 at 0x2299B |
| +0x4A | 2 | int16 | energy_field | Energy/shield. Set to 0 at 0x2190B, -1 at 0x2191E, 1 at 0x21DAC |
| +0x4C | 4 | fptr | callback | Far callback. `call far [es:bx+0x4c]` at 0x21A85 |
| +0x50 | 4 | fptr | callback2 | Second callback. `call far [es:bx+0x50]` at 0x220FF |
| +0x66 | 2 | int16 | wind_x | Wind X. Written at 0x226C3. Checked in wind correction |
| +0x68 | 2 | int16 | wind_y | Wind Y. Written at 0x226D3 |
| +0x6A | 2 | int16 | fire_mode | 1=direct, 2=guided. Set at 0x226E5, 0x22868 |
| +0x7A | 2 | int16 | dead_flag | Death/elimination. Separate from +0x18 (alive) |
| +0x92 | 2 | int16 | turret_angle_2 | Fine turret angle. `cmp 0x4b` (75°), `cmp 0xf` (15°) at 0x21456-0x214B5 |
| +0x94 | 2 | int16 | turret_direction | Direction (-1 or 1). Read at 0x21462 (negated), ai_solver 0x2551E |
| +0x96 | 2 | int16 | shield_energy | Shield HP remaining. `cmp [es:bx+0x96],0x0` at 0x238F2 |
| +0xA0 | 2 | int16 | base_radius | Base explosion radius. Value + 0x6E → player+0x28 |
| +0xA2 | 4 | uint32 | max_power | 32-bit max power. Low: `[es:bx+0xa2]`, High: `[es:bx+0xa4]` |
| +0xAE | 4 | fptr | ai_target | AI target far pointer. `mov ax,[es:bx+0xae]` at 0x217E4 |
| +0xB6 | 4 | fptr | name_ptr | Far pointer to player name string |
| +0xC6 | 4 | fptr | shield_cfg | Far pointer to shield config entry. `les bx,[es:bx+0xc6]` at 0x22469 |

### Key Relationships

```
DS:CEB8 → Player[0..9] (stride 0x6C)
             │
             ├── +0x2A/2C: far ptr ──→ DS:D568 → Sub[0..9] (stride 0xCA)
             │                                      ├── +0x0E/+0x10: x,y pos
             │                                      ├── +0x18: alive
             │                                      ├── +0x32: turret angle
             │                                      ├── +0x96: shield HP
             │                                      ├── +0xB6: name ptr
             │                                      └── +0xC6: shield cfg ptr
             │
             ├── +0x3E/40: far ptr ──→ TARGET's Sub struct
             ├── +0x44/46: target x,y (cached copy)
             ├── +0x14/1C: world x,y (f64)
             └── +0x4C/50: callback far ptrs
```

**Intermediate files**: `disasm/ai_solver_decoded.txt`, `disasm/damage_decoded.txt`, `disasm/extras_decoded.txt`

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
| Sky/terrain type variable | DS:0x5110 (controls both sky palette AND terrain shape; see "Sky/Landscape Mode System" section) |
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

## Sky/Landscape Mode System (VERIFIED)

The "terrain type" variable DS:0x5110 is actually a **sky mode** that controls both sky palette rendering AND terrain shape generation. Config key: `SKY=%s`.

### Sky Type Enum (DS:0x5110)

| Index | Name | Terrain Handler | Notes |
|-------|------|----------------|-------|
| 0 | Plain | file 0x3E700 | Flat terrain, basic sky gradient |
| 1 | Shaded | file 0x4758B | Simple terrain, gentle shading |
| 2 | Stars | file 0x4726B | Star-based sky palette |
| 3 | Storm | file 0x42103 | Storm sky effects |
| 4 | Sunset | file 0x3F587 | Sunset gradient sky |
| 5 | Cavern | file 0x44BDD | Mountain .mtn terrain (DS:0x50D8=1) |
| 6 | Black | file 0x3E700 | Underground visual mode (same terrain as Plain) |
| 7 | Random | (runtime) | Randomizes to 0-5 via `random(6)` |

### Key Data Locations

| Item | Location |
|------|----------|
| Sky type variable | DS:0x5110 |
| Sky name table | DS:0x621C (8 far ptrs, init at file 0x3AEA0) |
| Max sky type | DS:0x624E (value 7 = "Random") |
| Mountain mode flag | DS:0x50D8 (1 when type 5) |
| Mountain files available | DS:0x621A (0 = no .mtn files) |
| Random land flag | DS:0x623C |
| Terrain jump table | file 0x3A118 (cs:0x0A18, 7 word entries) |
| Terrain generation | file 0x3971F (main function in ranges.cpp) |
| Sky palette rendering | file 0x285A7 (black sky check for type 6) |

### "Black" Sky (Type 6) — Underground Visual Mode

When SKY=Black, 7 code patches create an underground visual environment:

1. **Black sky** (file 0x285A7): All sky palette entries set to (0,0,0)
2. **Dark terrain** (file 0x32FF4): RGB values attenuated (right-shifted) for dark underground look
3. **Dark ground** (file 0x33061): Ground color uses attenuated palette at index 0x50
4. **Ceiling palette** (file 0x3A0A9): Special ceiling gradient (40 entries) + darkened floor gradient
5. **No edge fade** (file 0x31925): Terrain edge fading skipped
6. **No tank colors** (file 0x390F7): Tank palette setup skipped
7. **No white flash** (file 0x3F2D1): Explosion flash effect disabled

### Random Selection

`random(6)` generates types 0-5 (Plain through Cavern). Type 6 (Black) and type 7 (Random) are excluded from random rotation. Type 5 (Cavern) is also excluded if no .mtn files exist.

**Note**: Despite the name "Cavern" (type 5), it does NOT create a ceiling+floor cave — it uses mountain .mtn terrain files. The actual underground visual is "Black" (type 6) with flat terrain.

**Intermediate files**: `disasm/cavern_shop_analysis.txt`

---

## Shop/Equipment System — equip.cpp (VERIFIED)

### Equipment Initialization (file 0x1D5D4)

The `equipInit()` function maps 16 category boundaries by calling `findWeaponByName()` for each boundary item. Results stored at DS:0xD546-0xD566:

| DS Offset | Category Boundary Item |
|-----------|----------------------|
| DS:0xD546 | Smoke Tracer (first purchasable weapon) |
| DS:0xD548 | (DS:0xD546 - 1, last free weapon) |
| DS:0xD54A | Heat Guidance |
| DS:0xD54C | Bal Guidance |
| DS:0xD54E | Horz Guidance |
| DS:0xD550 | Vert Guidance |
| DS:0xD552 | Lazy Boy |
| DS:0xD554 | Parachute |
| DS:0xD556 | Battery |
| DS:0xD558 | Mag Deflector |
| DS:0xD55A | Shield |
| DS:0xD55C | Warp Shield |
| DS:0xD55E | Teleport Shield |
| DS:0xD560 | Flicker Shield |
| DS:0xD562 | Force Shield |
| DS:0xD564 | Heavy Shield |
| DS:0xD566 | Super Mag |

Additional init variables:
- DS:0xE4F0: first free weapon index
- DS:0xE4F2: count of non-free (purchasable) weapons
- DS:0x1BB8: init flag (prevent re-initialization)

### Item Enable/Disable Config

| DS Offset | Flag | Effect |
|-----------|------|--------|
| DS:0x50FE | Free market | 1 = all items purchasable |
| DS:0x5158 | Scoring mode | 0x64 (100) enables Earth Disrupter |
| DS:0x513A | Contact trigger | 0 = Contact Trigger disabled |
| DS:0x5168 | Useless items | 0 = hide Tracers etc. |
| DS:0x5162 | Parachute | 0 = Parachute disabled |
| DS:0x5188 | Play mode | 0=Standard, 1=Limited, 2=Restricted |
| DS:0x518A | Arms level | 0-4, gates item tier availability |

### Shop UI (file 0x1DBB5)

The shop screen dispatches through a 12-case jump table at file 0x1DF4D. For computer players, a random action (0-10) is selected via `random(0x0B)`:

| Case | File Offset | Action |
|------|-------------|--------|
| 0 | 0x1DCCE | Buy weapon category + sell back |
| 1 | 0x1DCF5 | Buy weapon + guidance |
| 2 | 0x1DD0A | Buy weapon + specific item + guidance |
| 3 | 0x1DD37 | Buy weapon + specific item + accessory |
| 4 | 0x1DD95 | Display money |
| 5 | 0x1DDB0 | Buy shields |
| 6 | 0x1DDC9 | Buy defense items |
| 7 | 0x1DDEE | Show equipment summary |
| 8 | 0x1DE12 | Buy guidance (like case 1) |
| 9 | 0x1DE20 | Buy mountain gear |
| 10 | 0x1DE29 | Sell equipment |
| 11 | 0x1DE59 | Display inventory |

Mountain mode check: if DS:0x50D8 != 0 and action == 8, re-roll (skip guidance in mountain terrain).

**Intermediate files**: `disasm/cavern_shop_analysis.txt`

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
| **`fpu_decode.py`** | **Borland INT 34h-3Dh FPU instruction decoder script** |
| **`ai_solver_decoded.txt`** | **AI solver (shark.cpp) with decoded FPU instructions** |
| **`damage_decoded.txt`** | **Damage system (extras.cpp) with decoded FPU instructions** |
| **`extras_decoded.txt`** | **Explosion system with decoded FPU instructions** |
| **`borland_rtl.txt`** | **Borland RTL function signatures (sin, cos, atan2, sqrt, etc.)** |
| **`play_modes_sentient_analysis.txt`** | **Play modes (Sequential/Simultaneous/Synchronous) and Sentient AI vtable corruption analysis** |
| **`cavern_shop_analysis.txt`** | **Sky/landscape mode system (8 sky types) and shop/equipment system (16 categories, buy/sell flow)** |

---

## Open Disassembly Tasks

### COMPLETED

1. ~~**Accessory/shield prices (items 35-56)**~~ — **RESOLVED**. Items 35-49 verified from struct data. Items 50-56 confirmed as a **linker data layout bug** — debug strings overwrite struct entries. No fallback pricing exists in code.

2. ~~**Terrain color palettes**~~ — **RESOLVED**. All 7 terrain types fully documented with gradient formulas. Palettes are generated algorithmically in code, not stored as raw data.

3. ~~**Explosion/damage formula**~~ — **RESOLVED**. Fully traced via FPU decoder. Not a polynomial falloff — uses 2D rotation of velocity vector (atan2/cos/sin). Damage = rotated speed / 100, attenuated 0.7× per hit. See pseudocode above.

4. ~~**AI accuracy parameters**~~ — **RESOLVED**. Switch at 0x29505 pushes noise values per AI type (Moron=[50,50,50] through Spoiler=[63,63,63]). Cyborg/Unknown randomize to type 0-5. Sentient has **corrupted vtable** (second linker data overlap bug).

5. ~~**War quotes**~~ — **RESOLVED**. All 15 quotes with attributions extracted.

6. ~~**Shield system**~~ — **RESOLVED**. Config table at DS:0x616C: Shield=55HP, Warp=100HP, Teleport=100HP, Force=150HP, Heavy=200HP. Flat 1:1 absorption. Flicker = probabilistic on/off.

7. ~~**Borland FPU emulation**~~ — **RESOLVED**. INT 34h-3Dh emulation layer documented. PI/180 constant found at DS:0x1D08.

### HIGH PRIORITY (blocks game implementation)

8. ~~**Items 50-56 actual prices**~~ — **RESOLVED**. Official Scorched Earth manual (bundled with game download on abandonwaredos.com) contains intended prices: Force Shield=$25K/3, Heavy Shield=$30K/2, Super Mag=$40K/2, Auto Defense=$1.5K/1, Fuel Tank=$10K/10, Contact Trigger=$1K/25. Patriot Missiles not listed in manual. Binary struct data confirmed corrupt (linker overlap bug) but prices now recovered from authoritative source.

9. ~~**AI trajectory solver internals**~~ — **RESOLVED**. Not a closed-form ballistic equation — uses pixel-level ray marching via `fg_getpixel`. Steps one pixel at a time, decrements gravity each pass. Full pseudocode for 7 functions (target selection, main solver, power calc, wind correction x2, noise injection x2) traced from FPU decode.

10. ~~**Exact polynomial damage curve**~~ — **RESOLVED**. Not a polynomial — uses velocity rotation. Full pseudocode traced via FPU decoder. See "Damage formula" section above.

11. ~~**Tank rendering dimensions**~~ — **RESOLVED**. Dome: 7px wide, 5px tall (base line + 4px rise), 3D shading with left/right color asymmetry. Body: 66x12px (HUD), 101x11 virtual units (viewer) with 10 gradient bands. Barrel: Bresenham-like pixel iterator, max ~400 steps, angle capped at 20. Color system: VGA 80-104, 8 per player. See "Tank Rendering" section.

### MEDIUM PRIORITY

12. ~~**Popcorn Bomb / Funky Bomb behavior**~~ — **RESOLVED**. Funky Bomb (BhvType=0, Seg=0x1DCE) spawns 5-10 sub-bombs from screen top, scatter within 2x blast radius (160px). Popcorn Bomb has no struct — hardcoded special case before dispatch. Full dispatch architecture documented with handler segment map. See "Weapon Behavior Dispatch" section.

13. ~~**Player struct full layout**~~ — **RESOLVED**. Two-level architecture: Player struct (0x6C/108 bytes, base DS:CEB8) + Target/sub struct (0xCA/202 bytes, base DS:D568). 30+ player fields and 40+ sub-struct fields mapped with file offset evidence. See "Player Data Structures" section above.

14. ~~**Napalm/fire particle system**~~ — **RESOLVED**. 99-slot particle pool (6-byte structs), negative param = dirt mode (brown 0x50 vs fire 0xFE), max 20 simultaneous particles, 0.7x velocity dampening/frame, circular allocation with recycling. See "Weapon Behavior Dispatch" section.

15. ~~**Roller physics**~~ — **RESOLVED**. Two-phase: impact handler scans terrain left/right for deeper valley to determine roll direction, then spawns rolling projectile with per-frame terrain-follower callback. Gravity acceleration increases speed. Supports all wall types. Terrain threshold = pixel >= 0x69. See "Weapon Behavior Dispatch" section.

16. ~~**MIRV split mechanics**~~ — **RESOLVED**. Apogee detected via velocity sign flip (stored last_sign at +0x66/+0x68). At split: 6 sub-warheads (12-byte stride). Damage = (radius-dist)*100/radius, capped at 110. Death's Head uses wider spread table (param=1 vs param=0). See "Weapon Behavior Dispatch" section.

17. ~~**Laser/beam weapons**~~ — **RESOLVED**. Laser and Plasma Laser are ACCESSORIES (not fireable beam weapons). They provide a visual "laser sight" targeting line during aiming — Laser draws green (0x78), Plasma Laser draws white (0xFE). Both have NULL behavior function pointers (0:0). Targeting line at file 0x36321 uses Bresenham with per-pixel callback (0x2F76:0x0111). BhvType/BhvSub are far function pointers (offset:segment), not type codes. See `disasm/laser_weapons_analysis.txt`.

### LOW PRIORITY

18. ~~**Cheat codes**~~ — **RESOLVED**. All 5 cheat/debug codes fully traced. ASGARD=frondheim (MDA debug overlay), ASGARD=ragnarok (file debug log), mayhem (all weapons x99), nofloat (disable FPU physics), player name selection. See "Cheat Codes" section above.

19. ~~**Tosser/Unknown/Sentient AI details**~~ — **RESOLVED**. Tosser is functional (noise=[63,23]). Unknown (type 7) and Cyborg (type 6) randomize to 0-5 at runtime via dispatch at 0x292A5. Sentient (type 8) has **corrupted vtable** — pointer table at DS:0x02E2 has only 7 valid entries; Sentient's entry at DS:0x0302 reads ASCII string "Some dumb tank: %s\n" as a far pointer (656D:6420), producing a wild pointer crash. Confirmed non-functional in v1.50. See "Sentient AI" section below.

20. ~~**Cavern terrain mode**~~ — **RESOLVED**. "Cavern" is sky type 5 (DS:0x5110), which uses mountain .mtn terrain generation — NOT ceiling+floor. The underground visual effect (black sky, dark palette, skip flash/fade) is triggered by sky type 6 ("Black"), not "Cavern". DS:0x5110 controls both sky palette and terrain shape via 7-entry jump table at file 0x3A118. 8 sky modes: Plain(0), Shaded(1), Stars(2), Storm(3), Sunset(4), Cavern(5), Black(6), Random(7). Name table at DS:0x621C initialized at file 0x3AEA0. See `disasm/cavern_shop_analysis.txt`.

21. ~~**Score system**~~ — **RESOLVED**. score.cpp at segment 0x30B2 (file base 0x37520). All three scoring modes traced: Standard, Corporate, and Vicious share the same per-damage and per-death formulas. Standard and Corporate include end-of-round survival pool bonuses; Vicious does not. Corporate mode hides scores during play. Per-weapon-damage: attacker gets +30x (enemy) or -15x (friendly fire). Per-shield-damage: +2x (enemy) or -1x (friendly). Kill bonuses: +500/+4000 (enemy), -2000 (teammate), -1500 (self). End-of-round pool: based on surviving players' max_power and shield_energy. See `disasm/score_system_analysis.txt` and "Score System" section below.

22. ~~**Equip.cpp shop system**~~ — **RESOLVED**. Equipment init at file 0x1D5D4 maps 16 category boundaries via `findWeaponByName()` to DS:0xD546-0xD566 (Smoke Tracer through Super Mag). Shop UI at file 0x1DBB5 dispatches through 12-case jump table (file 0x1DF4D) with random action selection for AI. Items enabled/disabled by 6 config flags: free market (DS:0x50FE), scoring mode (DS:0x5158), triggers (DS:0x513A), useless items (DS:0x5168), parachute (DS:0x5162), play mode (DS:0x5188). Arms level (DS:0x518A) gates item tiers 0-4. See `disasm/cavern_shop_analysis.txt`.

23. **Sound system** — How sound effects are triggered, what format they use, Fastgraph sound integration.

24. ~~**Simultaneous/Synchronous play modes**~~ — **RESOLVED**. Play mode variable at DS:0x5188 (0=Sequential, 1=Simultaneous, 2=Synchronous). 36 code references across binary. Sequential: one-at-a-time turns with full display updates. Simultaneous: all aim at once, fire callbacks cleared (player +0xAE/+0xB0 = NULL), timer-controlled, projectile screen-wrapping enabled. Synchronous: sequential aiming + simultaneous firing. See "Play Modes" section below.

---

## Tank Rendering — icons.cpp (VERIFIED from disassembly)

### Overview

Tank rendering in Scorched Earth v1.50 is implemented primarily in `icons.cpp` (code segment 0x1F7F+, file base ~0x263F0). The tank is drawn pixel-by-pixel using Fastgraph V4.02 graphics library calls through an indirect function pointer table in the data segment.

### Fastgraph Function Pointer Table (Indirect Calls)

| DS Offset | Function | Params | Cleanup | Description |
|-----------|----------|--------|---------|-------------|
| 0xEEF4 | `fg_point` wrapper | 3 words | 6 bytes | `point(x, y, color)` — draws single pixel |
| 0xEEF8 | `fg_getpixel` wrapper | 2 words | 4 bytes | `getpixel(x, y)` — returns color in AX |
| 0xEF04 | `fg_locate`/`fg_move` | 2 words | 4 bytes | Move cursor position |
| 0xEF08 | `fg_setcolor` | 1 word | 2 bytes | Set drawing color |
| 0xEF0C | `draw_hline` wrapper | 4 words | 8 bytes | `hline(minx, maxx, y, color)` — horizontal line |
| 0xEF10 | `draw_vline` wrapper | 4 words | 8 bytes | `vline(x, miny, maxy, color)` — vertical line |
| 0xEF14 | `fg_drect` wrapper | 5 words | 10 bytes | `drect(minx, miny, maxx, maxy, color)` — filled rectangle |

### Key Global Variables

| DS Offset | Purpose |
|-----------|---------|
| 0xEF22 | Current tank drawing color (player-specific) |
| 0xEF24 | Tank body shadow/outline color |
| 0xEF26 | Dome highlight color (right side) |
| 0xEF28 | Background/fill color |
| 0xEF2E | Dome base line color (direction 1) |
| 0xEF30 | Dome outline color (left side) |
| 0xEF32 | Dome base line color (direction 2) |
| 0xEF3C | Screen left boundary |
| 0xEF3E | Screen width |
| 0xEF40 | Screen/viewport Y base |
| 0xEF42 | Screen right boundary |
| 0xEF46 | Sound/animation effects enabled flag |
| 0xE344 | Current player index |
| 0xE346 | Barrel start X position |
| 0xE348 | Barrel start Y position |
| 0xE6FC | Horizontal base coordinate (for HUD/info panels) |
| 0xE702 | Tank facing direction (0x50=left, 0xFE=right) |
| 0x5182/0x5184 | Current player struct far pointer |

### Player/Target Struct Layout

- **Stride**: 0xCA (202 bytes)
- **Array base**: DS:0xD568 (calculated as: pixel_color / 8 * 0xCA + 0xD568)
- **Key fields**:
  - `+0x08`: Direction/scale multiplier
  - `+0x0E`: Player X position (screen pixels)
  - `+0x10`: Player Y position (screen pixels)
  - `+0x12`: Barrel X velocity/offset
  - `+0x14`: Barrel Y velocity/offset
  - `+0x36`: Selected weapon index
  - `+0x92`: Equipment parameter
  - `+0xB2`: Far pointer to weapon/sprite sub-struct (stride 0x6C = 108 bytes)

### Tank Color Scheme

- **Tank body pixel colors**: 0x50-0x68 (80-104), 8 colors per player
- **Player index from color**: `pixel_color / 8`
- **Sky/background threshold**: color >= 0x69 (105)
- **Special boundary colors**: 0x96 (150) and 0xA9 (169) — wall/obstacle detection
- **Tank hit marker**: 0xC8 (200) — drawn on top of damaged tank pixels
- **Dome gradient**: Uses 3 separate color globals (0xEF26, 0xEF2E, 0xEF30, 0xEF32)

### Turret Dome — Pixel-by-Pixel Pattern (file offset 0x2694C)

Function signature: `draw_dome(start_x, center_y, x_step)`

The dome is drawn as a series of `fg_point` calls forming a semicircular cap. Parameters:
- `si` = start_x (initially `[bp+6]`)
- `di` = center_y (`[bp+8]`)
- `[bp+0xa]` = x_step (horizontal advance per column group)
- Color from global `[0xEF22]`

**Pixel map** (21 total fg_point calls across 7 column groups):

```
Column 1 (x = si):
  fg_point(si, di, color)             → center

  si -= x_step

Column 2 (x = si):
  fg_point(si, di-1, color)           → center-1
  fg_point(si, di, color)             → center
  fg_point(si, di+1, color)           → center+1

  si -= x_step

Column 3 (x = si):
  fg_point(si, di-2, color)           → center-2
  fg_point(si, di+2, color)           → center+2
  fg_point(si, di-1, color)           → center-1
  fg_point(si, di, color)             → center
  fg_point(si, di+1, color)           → center+1

  si -= x_step

Columns 4-7: Repeat the 3-pixel pattern (di-1, di, di+1) with x_step decrements
  Each column: fg_point at (si, di-1), (si, di), (si, di+1)
  Then: si -= x_step
```

**Dome dimensions**:
- Height: 5 pixels (Y offsets: -2 to +2 from center_y)
- Width: 7 columns with x_step spacing between them
- Total width = 6 * x_step + 1 pixels (depends on x_step parameter)
- The dome is asymmetric: column 1 is 1px, column 2 is 3px, column 3 is 5px, columns 4-7 are 3px each
- This creates a rounded cap shape that peaks at center (5px tall) and tapers to 1px at the starting edge

The function spans from 0x2694C to 0x26AB2 (retf at 0x26AB2), 358 bytes.

### In-Game Tank Dome (Alternate Rendering Path)

Found at file offset 0x3FC9A (within the per-frame tank drawing routine). This draws the dome using the actual player position:

**Direction 1 dome** (barrel pointing right):
```
Base position: si = player_X, y_base = player_Y + 11

Horizontal line:  hline(si, si+6, y_base-6, dome_base_color)     ← 7px base line

Dome pixels (left side, color=[0xEF30]):
  point(si+0, y_base-7)    ← ascending
  point(si+1, y_base-8)
  point(si+2, y_base-9)
  point(si+3, y_base-10)   ← peak (4px above base line)

Dome pixels (right side, color=[0xEF26] = highlight):
  point(si+4, y_base-9)    ← descending
  point(si+5, y_base-8)
  point(si+6, y_base-7)
```

**Direction 2 dome** (barrel pointing left):
```
Horizontal line:  hline(si, si+6, y_base-4, dome_base_color)     ← 7px base line

Dome pixels (left side):
  point(si+0, y_base-3)
  point(si+1, y_base-2)
  point(si+2, y_base-1)

Dome pixels (right side = highlight):
  point(si+3, y_base+0)    ← peak at base level
  point(si+4, y_base-1)
  point(si+5, y_base-2)
  point(si+6, y_base-3)
```

**In-game dome dimensions**: 7 pixels wide, 5 pixels tall (base line + 4 pixel rise), with left/right color asymmetry for 3D shading effect.

### Tank Body Rectangle

The tank body is drawn as a filled rectangle using `fg_drect` (via `[0xEF14]` or wrapper `0x3dab:0xb`).

**In the equipment/HUD panel** (file offset 0x26C76):
```
fg_drect_wrapper(
  [0xe6fc] + 0x18,    // minx = horizontal_base + 24
  [0xef40] + 5,        // miny = vertical_base + 5
  [0xe6fc] + 0x59,    // maxx = horizontal_base + 89
  [0xef40] + 0x10,    // maxy = vertical_base + 16
  [0xef28]             // color = background fill color
)
```
Panel body dimensions: **66 pixels wide x 12 pixels tall** (89-24+1 = 66, 16-5+1 = 12).

**In the virtual coordinate tank viewer** (file offset 0x27745-0x2781E):
Uses a virtual coordinate system set up with `fg_setworld(100, 100, 240, 165)`:

Tank body gradient bands (10 bands, loop si=0..9):
```
For each band si:
  y_range = 118 to 128 (10 virtual units tall)
  x_range = si*10+105 to si*10+115 (10 virtual units wide per band)

  Draw outlined rectangle:
    hline(si*10+105, si*10+115, 118, [0x6e2a])    top edge
    hline(si*10+105, si*10+115, 128, [0x6e2a])    bottom edge
    vline(si*10+105, 118, 128, [0x6e2a])           left edge
    vline(si*10+115, 118, 128, [0x6e2a])           right edge
```
Virtual body dimensions: **101 units wide x 11 units tall** (105 to 205 horizontal, 118 to 128 vertical).

Tank treads (below body):
```
wrapper(125, 135, 50, 20, [0xef28])
```
Virtual treads: **50 units wide x 20 units tall** at position (125, 135).

### Barrel Drawing — Main Draw Tank Function (file offset 0x27000-0x275B3)

The barrel is drawn using an iterative stepping algorithm similar to Bresenham's line algorithm.

**Function signature**: `draw_barrel(player_x)` — enter 0x22 (34 bytes local variables)

**Key parameters**:
- Barrel angle from weapon struct: `[0xe344] * 0x34 + 0x120E`
- Angle magnitude capped at **20** (0x14)
- Direction: negative angle → left (0x50), positive → right (0xFE)

**Algorithm**:
1. Read angle, determine direction
2. Initialize starting position from player struct `[0xE346]`, `[0xE348]`
3. Initialize state: max iterations = 99 (`[0xE9B2]`), step size = 2 (`[0xE9B4]`)
4. Main loop (up to 1000 iterations timeout):
   - Advance position using stepping algorithm entries (stride 6 array at `[bx-0x18AC]`, `[bx-0x18AA]`)
   - Draw pixel at current position using `fg_point` (right-facing) or `fg_move` (left-facing)
   - Track bounding box: update min/max X (`[bp-0xa]`, `[bp-0xe]`) and Y (`[bp-0xc]`, `[bp-0x10]`)
   - Every **20 pixels** (`[bp-8]` counter), record a waypoint in array at `[bx-0x18FC]`
   - Increment waypoint counter `[0xE9B8]`
5. Loop terminates when waypoints count >= angle magnitude OR error flag set

**Barrel length**: `angle_value` waypoints x 20 pixels per waypoint interval.
Maximum barrel = 20 * 20 = **~400 pixel steps** (theoretical maximum).

**Bounding box expansion** (post-render, for redraw region):
```
X: waypoint_x + 0xFFD3 (-45) to waypoint_x + 0x2D (+45)   → 91 pixel margin
Y: waypoint_y + 0xFFE2 (-30) to waypoint_y + 0x14 (+20)    → 51 pixel margin
```

**Post-barrel rendering**:
After barrel is drawn, the function enters a cleanup/animation phase:
- Iterates through recorded waypoints (0 to `[0xE9B8]`)
- For each waypoint, calls `fg_locate` with (0x1E, 0xAA)
- Calls display delay functions
- Scans pixels in the bounding box region for tank hit detection (color >= 0xAA)
- Calls terrain restoration function `0x32C2:0x1519` for damaged pixels

### Tank Placement — Terrain Scanning (file offset 0x26AB3-0x26D3D)

**Function signature**: `place_tank(x_offset)` — enter 0x12 (18 bytes local variables)

This function places the tank on terrain after a move (e.g., gravity settling, Jump Jets):

1. Calculate new X: `player_x + x_offset`
2. Calculate scan position: `player_x + (player[0x08] * x_offset)` — direction-scaled
3. Scan UPWARD from terrain using `fg_getpixel`:
   - If pixel color < 0x69 (105): found sky → increment counter, move up
   - If counter reaches **4**: terrain too steep → abort placement
   - Check for special colors 0x96 (150) and 0xA9 (169): wall boundaries
4. On success: update player position, call rendering functions

### Tank Hit Detection (file offset 0x27A85)

**Function signature**: `check_tank_hit(x, y)` — simple function

Algorithm:
```
pixel = fg_getpixel(x, y)
player_index = pixel / 8
player_struct = DS:0xD568 + player_index * 0xCA

if (player_struct == current_player):
    return  // skip self

if (pixel >= 0x50 && pixel <= 0x68):  // color range 80-104
    return 1  // hit a tank!

fg_point(x, y, 0xC8)  // draw hit marker (color 200)
```

### Summary of Dimensions

| Component | Width (px) | Height (px) | Notes |
|-----------|-----------|-------------|-------|
| Turret dome (icons.cpp version) | 6*x_step+1 | 5 | Semicircular, 21 pixel calls |
| Turret dome (in-game) | 7 | 5 | 7px base line + 4px rise |
| Tank body (HUD panel) | 66 | 12 | Filled rectangle on equipment screen |
| Tank body (virtual viewer) | ~101 | ~11 | 10 gradient bands in virtual coords |
| Tank treads (virtual viewer) | 50 | 20 | Below body in virtual coords |
| Barrel max length | ~400 steps | 1 | Iterative pixel-by-pixel drawing |
| Barrel bounding margin | 91 (X) | 51 (Y) | Redraw region around waypoints |
| Tank pixel color range | N/A | N/A | Colors 80-104 (0x50-0x68) |
| Players (max) | N/A | N/A | 8 colors per player, color/8 = index |

### Key Function Addresses (file offsets)

| Address | Function | Description |
|---------|----------|-------------|
| 0x2694C | `draw_dome_pixels()` | Pixel-by-pixel dome drawing (21 fg_point calls) |
| 0x26AB3 | `place_tank()` | Terrain scanning and tank placement |
| 0x26C3E | *(continuation)* | Tank HUD panel rendering (rectangles + text) |
| 0x26E31 | `set_dome_params()` | Store 2 params to globals 0x99FE/0x9A00 |
| 0x26E44 | `random_dome_color()` | Uses random(0x43), accesses array at 0x53B0 |
| 0x26E6B | `find_anim_slot()` | Find free slot in animation queue (max 101 entries) |
| 0x26EDA | `record_barrel_point()` | Record barrel waypoint in animation queue |
| 0x26F9E | `random_wind_update()` | Random viewport offset update (wind visual) |
| 0x27000 | `draw_barrel()` | **Main barrel drawing function** — Bresenham-like iterator |
| 0x275B7 | `get_anim_state()` | Return animation state from `[0xE9BA]` |
| 0x275CC | `check_pixel_bounds()` | Pixel color/bounds checking for barrel path |
| 0x276C1 | `calc_anim_distance()` | Distance between animation queue entries |
| 0x27709 | `tank_body_viewer()` | Virtual-coord tank body with gradient bands |
| 0x27A85 | `check_tank_hit()` | Pixel color → player index hit detection |
| 0x27B1D | `draw_tank_sprite()` | Animated tank sprite rendering with bitmap |
| 0x28698 | `capture_sprite()` | Sprite/bitmap capture from screen region |
| 0x28830 | `render_sprite_pixel()` | Pixel-level bitmap rendering with fg_point |

---

## Play Modes — play.cpp (VERIFIED from disassembly)

### Overview

Scorched Earth v1.50 supports three play modes controlled by the variable at **DS:0x5188** (file 0x5AF08). The mode is configured via `PLAY_MODE` in `scorch.cfg` and stored as an integer: 0=Sequential, 1=Simultaneous, 2=Synchronous.

Mode name strings: `"Sequential"` at DS:0x2803, `"Simultaneous"` at DS:0x280E, `"Synchronous"` at DS:0x281B.

**36 code references** to DS:0x5188 found across extras.cpp, player.cpp, play.cpp, icons.cpp, shields.cpp, and shark.cpp.

### Mode Behaviors

| Feature | Sequential (0) | Simultaneous (1) | Synchronous (2) |
|---------|---------------|-------------------|-----------------|
| Aiming | One player at a time | All players at once | One at a time |
| Firing | After each aim | All at once (batch) | All at once (batch) |
| Fire callback (+0xAE/+0xB0) | Active | Cleared to NULL | Active during aim |
| Screen wrapping | Disabled | Enabled | Enabled |
| Timer-controlled | No | Yes (DS:0xD506) | No |
| Display updates | Full per-turn | Minimal during aim | Full during aim |
| AI flag (DS:0x510E) | 0 | 1 | 0 |

### Sequential Mode (0)

Classic turn-based play. One player aims and fires at a time. The turn handler at file 0x30560 animates the turret rotation with smooth stepping (clamped to +/-15 pixels per frame, 15ms delay). After firing, the projectile resolves completely before advancing to the next alive player.

Key code at file 0x3056D:
```
cmp word [0x5188], 1    ; Simultaneous?
jnz use_sequential      ; no -> animate turret normally
jmp clear_callbacks     ; yes -> skip animation
```

### Simultaneous Mode (1)

All players aim simultaneously with a timer countdown. The fire callback far pointers in the player struct are cleared to prevent individual firing:

```
; File 0x3063A:
les bx, [0x5182]               ; load current player ptr
mov word [es:bx+0xB0], 0       ; clear fire callback segment
mov word [es:bx+0xAE], 0       ; clear fire callback offset
```

After the timer expires, all projectiles fire and resolve simultaneously. Screen wrapping is enabled for projectiles that exit the viewport horizontally (file 0x29CA8-0x29CC2):
```
if x < screen_left:  x += (screen_right - screen_left + 1)
if x > screen_right: x -= (screen_right - screen_left + 1)
```

The AI dispatch at file 0x292CA sets DS:0x510E = 1 to flag simultaneous AI behavior.

### Synchronous Mode (2)

Hybrid mode: players aim one at a time (like Sequential), but all projectiles fire simultaneously (like Simultaneous). Three code locations specifically check for mode 2:
- File 0x1D8EA: Fire phase handling
- File 0x1DBCD: Combined check with mode 0 for display behavior
- File 0x306FE: Round completion handling

At file 0x1DBC6, Sequential and Synchronous are grouped together (`if mode==0 OR mode==2`) for certain display update behaviors.

### Key Functions

| File Offset | Segment | Purpose |
|-------------|---------|---------|
| 0x30560 | ~0x29B6 | Turn handler: turret animation, mode-specific fire dispatch |
| 0x30652 | ~0x29B6 | Fire check: alive player count, ready-to-fire flag |
| 0x29280 | 0x2288 | AI type dispatch: randomize Cyborg/Unknown, set AI flags |
| 0x29505 | 0x22B0 | AI accuracy: noise parameter switch (types 0-5 only) |

**Intermediate file**: `disasm/play_modes_sentient_analysis.txt`

---

## Sentient AI — shark.cpp (VERIFIED from disassembly)

### Overview

Sentient is AI type 8 (or type 9 in the user-facing menu). It has a **corrupted vtable** due to the pointer table at DS:0x02E2 having only 7 valid entries (types 0-6). Sentient's pointer table entry reads from the ASCII string `"Some dumb tank: %s\n"`, producing a wild far pointer that would crash DOS. Sentient is **non-functional in v1.50**.

### Corruption Mechanism

The AI vtable uses two-level indirection:

1. **Pointer table** at DS:0x02E2 (file 0x056062): 7 entries of 4 bytes each (total 28 bytes), spanning DS:0x02E2 to DS:0x02FD.

2. **Vtable blocks** at DS:0x0272 (file 0x055FF2): 7 blocks of 16 bytes each, spanning DS:0x0272 to DS:0x02E1.

The string `"Some dumb tank: %s\n"` begins at **DS:0x0300** (file 0x056080). When indexing the pointer table for type 8:

```
entry_address = DS:0x02E2 + 8 * 4 = DS:0x0302
```

This lands inside the string data at offset +2, reading the bytes `65 6D 64 20` ("me d") as a far pointer `656D:6420`. This points to physical address 0x6BAF0 + 0x6420 = 0x71F10, which is unmapped memory in standard DOS.

### Why Cyborg and Unknown Don't Crash

Types 6 (Cyborg) and 7 (Unknown) also have corrupted vtable entries, but the dispatch code at file 0x292A5 explicitly randomizes them to types 0-5 **before** any vtable access:

```asm
cmp word [0x5154], 6    ; Cyborg?
jz randomize
cmp word [0x5154], 7    ; Unknown?
jnz skip                ; other types pass through unchanged
randomize:
  push 6
  call random           ; random(0..5)
  mov [0x5154], ax      ; overwrite with valid type
```

Type 8 (Sentient) is **not covered** by this check, so it passes through with its original value and attempts to use the corrupted vtable.

### Additional Safety Gaps

The AI accuracy dispatch at file 0x29505 bounds-checks against 5:
```asm
mov bx, [0x5154]       ; load effective AI type
cmp bx, 5              ; bounds check
ja exit                 ; type > 5: skip entirely
```

If Sentient somehow survived the vtable crash, it would have **uninitialized noise parameters** because the accuracy switch only handles types 0-5.

### Evidence of Incomplete Implementation

- The string `"Sentient?"` (with question mark) at DS:0x2709 suggests developer uncertainty
- The `"Some dumb tank: %s\n"` debug string adjacent to the vtable data suggests the developer knew invalid AI types could occur
- The vtable was sized for exactly 7 types (Human + 6 AI personalities), with Cyborg and Unknown designed as wrappers over the existing 6 AI types rather than independent implementations

### Summary

| Aspect | Status |
|--------|--------|
| Vtable pointer (DS:0x0302) | CORRUPTED: reads ASCII string as far pointer |
| Randomization protection | ABSENT: only types 6, 7 are randomized |
| Accuracy parameters | ABSENT: switch only covers types 0-5 |
| Runtime behavior | CRASH: wild far pointer to unmapped DOS memory |
| Conclusion | Sentient was never completed; non-functional in v1.50 |

**Intermediate file**: `disasm/play_modes_sentient_analysis.txt`

---

## Score System — score.cpp (VERIFIED from disassembly)

### Overview

Score system implemented in `score.cpp` (segment 0x30B2, file base 0x37520). Three scoring modes configured via DS:0x5188: Standard (0), Corporate (1), Vicious (2). All three modes share the same per-damage and per-death formulas. The differences are:

| Feature | Standard | Corporate | Vicious |
|---------|----------|-----------|---------|
| Per-damage scoring | Yes | Yes | Yes |
| Per-death bonuses | Yes | Yes | Yes |
| End-of-round pool | Yes | Yes | **No** |
| Interest display | Yes | Hidden | No |
| Score visibility | Visible | **Hidden** | Visible |

### Per-Damage Scoring (score.cpp offset 0x168, file 0x37688)

Called from `player.cpp` (weapon damage, type 0) and `shields.cpp` (shield damage, type 1) whenever damage is dealt. Scoring is applied to the **attacker**, not the victim.

```
score_on_damage(attacker, target, damage_amount, damage_type):
    // damage_amount is POSITIVE (HP/shield points removed)
    // damage_type: 0 = weapon, 1 = shield

    if attacker == NULL: return
    if teams_disabled (DS:0x5148 == 0): return

    if different_team(attacker, target):
        // REWARD for hitting enemy
        if damage_type == 0:  score = damage * 30
        if damage_type == 1:  score = damage * 2
        add_score(attacker, score)

    else if attacker != target:  // same team, not self
        // PENALTY for friendly fire
        if damage_type == 0:  score = damage * (-15)
        if damage_type == 1:  score = damage * (-1)
        add_score(attacker, score)

    // Self-hits: no scoring change
```

**Multiplier summary:**

| Situation | Weapon Damage (type 0) | Shield Damage (type 1) |
|-----------|----------------------|----------------------|
| Enemy hit | +30x | +2x |
| Friendly fire | -15x | -1x |
| Self-hit | 0 | 0 |

### Per-Death Scoring (score.cpp offset 0xC3, file 0x375E3)

Called from `equip.cpp` (file 0x1DC2B) when a tank is destroyed. Applied to the **attacker** (killer). Called unconditionally for all scoring modes.

```
score_on_death(attacker, victim):
    if attacker == NULL: return

    if different_team(attacker, victim):
        // BOUNTY for killing enemy
        if teams_enabled (DS:0x5148 != 0):
            add_score(attacker, +500)
        else:
            add_score(attacker, +4000)

    else if attacker != victim:
        // PENALTY for killing teammate
        add_score(attacker, -2000)

    else:
        // PENALTY for self-destruction
        add_score(attacker, -1500)
```

### End-of-Round Scoring (file 0x37381)

Called for Standard and Corporate modes after each round. **Skipped entirely for Vicious mode** (check at file 0x306FE: `cmp [0x5188], 2; jz skip`).

```
end_of_round_scoring():
    if teams_enabled (DS:0x5148 != 0):
        pool = round_number * 500 + 5000
        for each alive player:
            pool += max_power * 30
            pool += shield_energy * 2
            player.wins++
        for each alive player:
            share = pool / round_number
            add_score(player, share)
    else:
        pool = num_players * 1000 + round_number * 4000
        for each alive player:
            player.wins++
            add_score(player, pool / round_number)
```

### Score Storage

Two separate systems track player performance:

1. **Cash** (sub-struct +0x9E): Spendable currency for buying weapons. Modified by `add_cash()` (0x2A16:0xABE). Capped at 0 and `max_cash` (+0x9C). Max cash computed as: `max_power * 1000 / interest_rate`.

2. **Score table** (DS:0xE1EC, stride 22 bytes): Cumulative performance metrics per event type (10 slots). Modified by `add_score()` (score.cpp offset 0x2B9). Uses bignum arithmetic for accumulation.

### Interest System (Standard Mode Only)

Standard mode has an interest mechanism displayed after each shot (file 0x28F1D, called at 0x307B9). The interest calculation at file 0x37964 uses FPU math:

```
profit = (weapon_cost[slot] * round_count * interest_rate) / base_cost
```

Interest amount stored at DS:0x515A (signed). Displayed as "Earned interest" with positive/negative formatting.

### Corporate Mode Details

Corporate mode uses identical scoring formulas to Standard. The key differences are:
- **Hidden scores**: The `set_cash()` function (0x2A16:0x0DE) has a special Corporate path that uses a different display method, hiding individual score changes during gameplay.
- **No interest display**: The interest display call at 0x307B9 is gated by `cmp [0x5188], 0` (Standard only).
- **End-of-round pool**: Same formula as Standard.
- **Reveal at end**: Final scores shown only at game end ("Final Scoring" dialog).

### Vicious Mode Details

Vicious mode uses the same per-damage and per-death formulas as Standard, but:
- **No end-of-round pool**: The survival bonus is completely disabled. Score depends entirely on damage dealt and kills.
- **No interest**: No interest mechanism.
- **Visible scores**: Unlike Corporate, individual scores are displayed during play.

### Team System (same_team function at 0x2A16:0x198D, file 0x324ED)

```
same_team(player_a, player_b):
    if player_a.player_id (+0xA0) == player_b.player_id: special handling
    compare player_a.team_number (+0x30) vs player_b.team_number (+0x30)
    return 0 if same team, 1 if different team
```

Teams enabled/disabled via DS:0x5148. When teams are disabled, kill bounty increases from 500 to 4000.

### Key File Offsets

| Function | File Offset | Call Pattern |
|----------|-------------|-------------|
| `score_event_distribute` | 0x37520 | Callback via function pointer |
| `score_on_death` | 0x375E3 | `lcall 0x3098:0x263` from equip.cpp |
| `score_on_damage` | 0x37688 | `lcall 0x3098:0x308` from player.cpp, shields.cpp |
| `add_score` | 0x377D9 | Near call within score.cpp |
| `end_of_round_scoring` | 0x37381 | Near call from play.cpp post-fire handler |
| `interest_calculation` | 0x37964 | FPU-based, within score.cpp |
| `score_dialog_setup` | 0x37CA0 | `lcall` from UI system |
| `same_team` | 0x324ED | `lcall 0x2A16:0x198D` |
| `add_cash` | 0x3161E | `lcall 0x2A16:0xABE` (6 call sites) |
| `set_cash` | 0x316CE | Near call from add_cash |

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
