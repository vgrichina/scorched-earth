# Scorched Earth v1.50 - Reverse Engineering Notes

## Overview

- **Game**: Scorched Earth - "The Mother of All Games"
- **Version**: 1.50 (June 4, 1995)
- **Author**: Wendell Hicken, Copyright (c) 1991-1995
- **Compiler**: Borland C++ 1993 (`"Borland C++ - Copyright 1993 Borland Intl."` — c0*.obj startup ID)
- **Graphics Library**: Fastgraph V4.02 (Ted Gruber Software) — **NOT Borland BGI** (no .BGI drivers, no .CHR fonts)
- **Borland Runtime**: C++ runtime with xalloc exceptions, "Pure virtual function called" (×2, confirms virtual dispatch), FPU error handlers
- **Borland FPU Emulation**: 3,327 INT 34h-3Dh calls (INT 39h=1130, INT 3Dh=584, INT 3Bh=331 most frequent)
- **No other Borland libs**: No BGI, no Turbo Vision, no OWL, no BIDS, no VROOMM overlay manager
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
| *(hud bars)* | *(no debug string)* | 0x3249 | ~0x38E90 | HUD bar column fill helpers (power/angle per-player) |
| `team.cpp` | 0x05C55D | 0x3A56+ | ~0x40F60 | Team management |
| *(menu module)* | *(no debug string)* | 0x34ED | ~0x3B8D0 | Main menu/config UI, sub-dialogs |

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
        spawn_sub_warheads();  // 5 sub-warheads (MIRV) or 9 (Death's Head)
        do_crater(pos_x, pos_y);
        kill_projectile(DS:E4DA);
        return 0;  // consumed
    }
    return 1;  // still in flight
}
```

**Sub-warhead damage** (file 0x2C759): `damage = (radius - dist) * 100 / radius`, capped at 110. Death's Head (param=1) uses wider spread table than MIRV (param=0) via DS:529E.

**Sub-warhead spawn parameters** — three packed 2-word arrays at DS:0x529E, each indexed by `weapon.param * 2` (MIRV=0, Death's Head=1):

| DS Offset | param=0 (MIRV) | param=1 (Death's Head) | Usage |
|-----------|----------------|------------------------|-------|
| DS:0x529E | 20 | 35 | Sub-warhead explosion radius |
| DS:0x52A2 | 5 | 9 | Sub-warhead spawn count |
| DS:0x52A6 | 50 | 20 | vx spread coefficient per slot |

**Sub-warhead spawn code** (function at file 0x2CB6B, seg 0x25D5:012B):
```c
// sub_count  = DS:0x52A2[param]   → 5 (MIRV) or 9 (Death's Head)
// sub_radius = DS:0x529E[param]   → 20 (MIRV) or 35 (Death's Head)
// spread_coeff = DS:0x52A6[param] → 50 (MIRV) or 20 (Death's Head)

int center_idx = sub_count + 1;  // 6 or 10
for (int i = 0; i < sub_count; i++) {
    int vx_offset = (i - center_idx) * spread_coeff;
    // MIRV:   vx_offset = -300, -250, -200, -150, -100  (all negative / left-biased)
    // D.Head: vx_offset = -200, -180, -160, ..., -20
    spawn_sub_warhead(parent.x, parent.y,
        parent.vx + vx_offset,  // spread is pure horizontal offset
        parent.vy,              // vy unchanged from parent
        sub_radius);
}
```
Note: Spread is purely horizontal (vx-only), no angle/sin/cos math. All offsets are negative relative to parent vx, so sub-warheads fan left of the parent trajectory; net spread depends on parent vx magnitude. EXE velocity units are internal integers (not pixels/sec).

#### Funky Bomb (BhvType 0x0000, Segment 0x1DCE)

BhvType=0 but with non-zero BhvSeg=0x1DCE — offset 0 is literally the entry point.
Main handler at file 0x246E0, sub-bomb spawner at file 0x24894.

```c
void funky_bomb_handler(int x, int y) {           // file 0x246E0
    int weapon_param = weapon_table[current_weapon].param;  // 80

    // Direct hit check
    if (hit_player_ptr != NULL) {
        if (shielded) {                             // file 0x2470D
            fg_tone(1000, 10);                      // shield impact sound
            shield_damage(hit_player_ptr, 10, 0);   // call 0x3912:0x04B2
            return;                                  // NOTE: no sub-bombs if shielded!
        }
        damage_tank(hit_player_ptr, hit_player[0xA2], 1);  // file 0x2474E
        // damage value = player struct field 0xA2 (health → instant kill on direct hit)
    }

    spawn_sub_bombs(x, y, weapon_param);            // file 0x24761 → 0x24894
}

void spawn_sub_bombs(int x, int y, int param) {    // file 0x24894
    int count = random(6) + 5;                      // 5-10 sub-bombs
    fg_setrgb(254, 30, 30, 63);                     // flash color setup

    // Setup sub-bomb positions
    for (int i = 0; i < count; i++) {
        if (param == -1) {
            sub_x[i] = random(screen_width) + screen_left;  // full screen scatter
        } else {
            sub_x[i] = random(param * 2) - param + x;       // scatter within ±80px
            clamp(&sub_x[i], screen_left, screen_right);
        }
        sub_y[i] = screen_top;                      // DS:EF38 (fall from top of screen)
    }

    // Phase 1: Palette setup (5 base colors × 6 gradient levels = 30 VGA entries at 170+)
    // Phase 2: Parent explosion visual — radius 20, palette base 170
    draw_explosion(x, y, 170, 20);                  // file 0x24AB5, hardcoded radius=20

    // Phase 3: Sub-bomb fall animation + explosion
    for (int i = 0; i < count; i++) {
        animate_fall(x, y, sub_x[i], sub_y[i], ...);  // file 0x24CBF — custom fall, NOT a weapon projectile
        int sub_radius = (random(10) + 15) * DS:0x50DA; // file 0x24B0C-0x24B23
        // DS:0x50DA = EXPLOSION_SCALE float (Small/Medium/Large config)
        // Base range 15-24, scaled by config
        draw_explosion(sub_x[i], sub_y[i], palette, sub_radius);
    }

    // Phase 4: Damage application pass (re-draws explosions with damage detection)
    // ...
}
```

**Key constants:**
- Parent explosion radius: **20** (hardcoded at file 0x24AA9, NOT scaled by EXPLOSION_SCALE)
- Sub-bomb explosion radius: **(random(10)+15) × DS:0x50DA** (EXPLOSION_SCALE float)
- Sub-bomb count: random(6)+5 = **5-10**
- Sub-bomb X scatter: random(param×2) - param + x = **±80px** (param=80)
- Shield hit damage: **10** (blocks sub-bomb spawn — early return)
- Sub-bombs are **NOT weapon projectiles** — custom animated fall objects with their own explosion

#### LeapFrog / Bounce (BhvType 0x0006, Segment 0x2382)

Handler at file 0x2A226 (seg 0x1F7F:0x4036, in icons.cpp region).
Uses a **damage_type countdown** (player struct +0x54) to control bounce count and explosion radius per bounce.

```c
void bounce_handler(int x, int y) {                   // file 0x2A226
    int damage_type = player[cur].damage_type;         // +0x54, initially 2
    int base_radius = bounce_radius_table[damage_type]; // DS:0x50CA[type*2]
    int radius = (int)(base_radius * DS:0x50DA);       // × EXPLOSION_SCALE_FLOAT

    // Store hit position
    hit_x[cur] = x;                                    // DS:E34A[cur*2]
    hit_y[cur] = y;                                    // DS:E412[cur*2]

    // Direct hit check
    if (hit_player_ptr != NULL) {
        if (shielded) {                                // file 0x2A28D
            fg_tone(1000, 10);
            shield_damage(hit_player_ptr, 10, 0);      // 0x3912:0x04B2
            // NOTE: shield hit skips explosion, falls through to bounce
        } else {
            damage_tank(hit_player_ptr, hit_player[0xA2], 1);  // file 0x2A2CE
        }
    }

    // Explosion at hit point (skipped if shield absorbed)
    create_explosion(x, y, radius, 0);                 // file 0x2A2E1 → 0x3D1E:0x015A

    // Bounce check: if damage_type == 0, this was the final hit
    if (damage_type == 0) return;                      // file 0x2A2E9

    // Bounce: compute new velocity
    double speed = player[cur].fpu_workspace_56;       // player+0x56 (speed magnitude)
    speed /= 1.5;                                      // DS:0x50D0 = 1.5f
    double angle = player[cur].fpu_workspace_5E;       // player+0x5E (trajectory angle)
    double new_vx = sin(angle) * speed;
    double new_vy = cos(angle) * speed;

    // Re-launch projectile at hit position with new velocity
    int new_player = launch_projectile(y, x, 0,        // file 0x2A3C2 → 0x1A4A:0x0763
        player[cur].defense_counter,                    // +0x24
        player[cur].warhead_count,                      // +0x2E
        player[cur].weapon_index,                       // +0x26
        player[cur].warhead_ptr,                        // +0x2A/+0x2C
        new_vx, new_vy);

    if (new_player >= 0) {
        player[new_player].damage_type = damage_type - 1;  // file 0x2A3DB: lea ax,[di-1]
        // Copy speed and angle to new player's FPU workspace
        player[new_player].fpu_workspace_56 = speed;
        player[new_player].fpu_workspace_5E = angle;
    }
}
```

**Bounce radius table** at DS:0x50CA (3 × int16, indexed by damage_type):

| DS Offset | damage_type | Base Radius | Bounce # |
|-----------|-------------|-------------|----------|
| DS:0x50CA | 0 | 20 | 3rd (final) |
| DS:0x50CC | 1 | 25 | 2nd |
| DS:0x50CE | 2 | 30 | 1st |

All radii scaled by **EXPLOSION_SCALE_FLOAT** (DS:0x50DA, float64, default 1.0).

**Key constants:**
- DS:0x50CA = bounce_radius_table: {20, 25, 30} (3 entries, indexed by damage_type 0/1/2)
- DS:0x50D0 = 1.5f (float32) — velocity divisor per bounce (speed ÷ 1.5 each bounce)
- DS:0x50DA = EXPLOSION_SCALE_FLOAT (float64, set from EXPLOSION_SCALE config)
- Initial damage_type = 2 (hardcoded at file 0x21397, condition: weapon.behavior_type == 0x0006)

**Bounce sequence** (LeapFrog weapon.param=3 in struct, but bounces controlled by damage_type countdown):
1. **First hit**: radius = 30 × EXPLOSION_SCALE (damage_type=2), re-launch at speed/1.5
2. **Second hit**: radius = 25 × EXPLOSION_SCALE (damage_type=1), re-launch at speed/1.5
3. **Third hit**: radius = 20 × EXPLOSION_SCALE (damage_type=0), no re-launch (final)

**Web port discrepancies found:**
- Web used fixed radius=20 (final) and radius=5 (intermediate) — should be decreasing 30→25→20
- Web used 0.7× vy / 0.9× vx damping — should be speed÷1.5 (≈0.667× both components)
- Web counted bounces against weapon.param — should use damage_type countdown from 2

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

99-slot particle pool with 6-byte particle structs at DS:0xE754 (x:word, y:word, next_ptr:word).
Main handler at file 0x2DA00. **NOT velocity-based** — uses pixel-walking cellular automaton.

```c
void napalm_handler(int x, int y) {  // file 0x2DA00
    int param = weapon[DS:E344].explosion_radius;  // 15=Napalm, 20=Hot Napalm, -20=Ton of Dirt

    if (param < 0) {
        param = -param;
        DS:E702 = 0x50;       // dirt palette (brown/VGA 80)
    } else {
        DS:E702 = 0xFE;       // fire palette (bright/VGA 254)
        fg_drect(0x3C, 0x14, 0x14, fire_color);  // initial flash
    }
    if (param > 20) param = 20;  // max simultaneous particles

    // Initialize: pool_avail=99 (DS:E9B2), pool_index=2 (DS:E9B4),
    //   wrapped=0 (DS:E9B6), list_head=1 (DS:E9BA), spawn_count=1 (DS:E9B8)

    // === PHASE 1: Particle spawn loop (file 0x2DB18–0x2DD34) ===
    while (spawn_count < param && !overflow) {
        frame_counter++;                   // bp-0x14
        if (frame_counter > 1000) overflow = 1;  // safety limit

        int slot = get_list_head();        // DS:E9BA (file 0x2DFB7)
        if (slot == 0) break;              // list empty
        int px = particle[slot].x;         // [slot*6 - 0x18AC]
        int py = particle[slot].y;         // [slot*6 - 0x18AA]

        int dir = check_direction(px, py); // file 0x2DFCC

        switch (dir) {
        case 2:  // no horizontal neighbor → fall down
            // check pixel above (py-1): if terrain, erode it
            new_x = px; new_y = py - 1;   // actually erodes upward
            break;
        case 0:  // terrain below → drop down
            new_x = px; new_y = py + 1;
            break;
        default: // -1 or +1 → move sideways
            new_x = px + dir; new_y = py;
            // clamp/wrap to screen bounds (DS:510E = wall wrap)
            break;
        }

        draw_pixel(new_x, new_y, fire_color);
        insert_particle(new_x, new_y);     // file 0x2D8DA

        // Every 20 particles: store position in explosion array
        particle_count++;                   // bp-0x08
        if (particle_count >= 20) {         // 0x14
            particle_count = 0;
            explosion_pts[spawn_count] = {new_x, new_y};  // DS:E704 array, 4 bytes each
            spawn_count++;                  // DS:E9B8
        }

        // Odd frames + fire mode: call flame flicker animation (file 0x2D99E)
        //   random(18)+2 → x_offset mod 40, random(8)+2 → y_offset mod 10
        //   fg_drect at flicker position with fire color
    }

    if (dirt_mode) goto cleanup;  // skip damage phase for Ton of Dirt

    // === PHASE 2: Damage phase (file 0x2DD41–0x2DEF4) ===
    for (int i = 0; i < spawn_count; i++) {
        erase_particle(explosion_pts[i]);
        for (int p = 0; p < NUM_PLAYERS; p++) {
            if (!tank[p].alive) continue;
            double dist = sqrt(distance_squared(explosion_pts[i], tank[p]));
            if (param > 15) {              // Hot Napalm
                if (dist < 40.0)           // DS:0x5682 = 40.0f
                    damage_tank(1, tank[p], (int)(50.0 - dist));  // DS:0x5686 = 50.0f
            } else {                       // Regular Napalm
                if (dist < 25.0)           // DS:0x568A = 25.0f
                    damage_tank(1, tank[p], (int)(30.0 - dist));  // DS:0x568E = 30.0f
            }
        }
    }

    // === PHASE 3: 50-frame fire fade animation (file 0x2DEFE–0x2DF32) ===
    for (int f = 0; f < 50; f++) {
        fg_locate(0x1E, 0xAA); check_keyboard(); fg_sound(random(50), 5);
    }

    // cleanup: erase dirty rect, redraw terrain
}

// check_direction(x, y) — file 0x2DFCC
// Returns: 0 = terrain below (drop), -1 = go left, +1 = go right, 2 = fall/erode
int check_direction(int x, int y) {
    // Check pixel below (y+1)
    if (y < screen_bottom) {
        int below = getpixel(x, y+1);
        if (below != fire_color && below >= 0x69)
            return 0;  // terrain below → drop down
    }
    // Check pixel left (x-1) and right (x+1) — with wall wrap via DS:510E
    bool can_left  = getpixel(x-1, y) is terrain;
    bool can_right = getpixel(x+1, y) is terrain;
    if (can_left && can_right) return (DS:515A > 0) ? +1 : -1;  // wind direction
    if (can_left)  return -1;
    if (can_right) return +1;
    return 2;  // no horizontal neighbor → erode upward
}
```

**Key constants:**
| Address | Type | Value | Purpose |
|---------|------|-------|---------|
| DS:0x5682 | float32 | 40.0 | Hot Napalm damage check radius |
| DS:0x5686 | float32 | 50.0 | Hot Napalm max damage (at distance 0) |
| DS:0x568A | float32 | 25.0 | Regular Napalm damage check radius |
| DS:0x568E | float32 | 30.0 | Regular Napalm max damage (at distance 0) |
| DS:0x515A | word | (runtime) | Current wind value — determines lateral spread |
| DS:0xE702 | word | 0xFE/0x50 | Fire color (VGA 254) or dirt color (VGA 80) |
| DS:0xE9B2 | word | 99 | Pool available count (decremented on alloc) |
| DS:0xE9B4 | word | 2 | Pool circular index (wraps at 101) |
| DS:0xE9BA | word | 1 | Linked list head pointer |

**Critical correction**: Previous documentation claimed "0.7x velocity dampening/frame (DS:1D60)" and "speed² < 0.001 (DS:1D68 epsilon)". **Both are WRONG for napalm.** DS:0x1D60=0.7 is the explosion damage falloff between successive player hits (at file 0x235B6). DS:0x1D68=0.001 is a numerical epsilon for explosion sqrt (at file 0x23638). The napalm system has **no velocity vectors and no damping** — particles walk 1 pixel per step.

- Negative param (Ton of Dirt = -20) switches to dirt mode with brown palette, skips damage phase
- Circular allocation with recycling after all 99 slots used once
- Sorted linked list maintains render order by Y position
- Damage formula: `max_damage - distance` (linear falloff), different per weapon variant

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

### Main Menu / Configuration Screen (VERIFIED from disassembly)

The main menu is the first screen shown after startup. Left panel has buttons/spinners, right panel shows title + terrain preview. Menu labels at file offset 0x0585A7-0x058830. The `~` character marks the keyboard accelerator (hotkey letter) for each item. Main menu rendering function at file 0x3D140 (far address 0x34ED:0x1870), called from game loop at file 0x2A850. Uses a dialog system library at segment 0x3F19 and text rendering at segment 0x4589.

**Top-Level Main Menu**:

| Menu Item | Config Key | Type | Notes |
|-----------|-----------|------|-------|
| ~Start | — | Button | Start game |
| ~Players: | `MAXPLAYERS=%d` | Spinner (2-10) | Mouse arrows visible in UI |
| ~Rounds: | `MAXROUNDS=%d` | Spinner | |
| S~ound... | — | Submenu | → Sound submenu |
| ~Hardware... | — | Submenu | → Hardware submenu |
| ~Economics... | — | Submenu | → Economics submenu |
| Ph~ysics... | — | Submenu | → Physics submenu |
| ~Landscape... | — | Submenu | → Landscape submenu |
| Play Op~tions... | — | Submenu | → Play Options submenu |
| ~Weapons... | — | Submenu | → Weapons submenu |
| Save ~Changes | — | Button | Write SCORCH.CFG |

**Sound Submenu**:

| Menu Item | Config Key | Values |
|-----------|-----------|--------|
| ~Sound: | `SOUND=%s` | Off / On |
| ~Flight Sounds: | `FLY_SOUND=%s` | Off / On |

**Hardware Submenu** (0x0585A7+ and extended at 0x058ABE):

| Menu Item | Config Key | Values / Default |
|-----------|-----------|-----------------|
| ~Graphics Mode: | `GRAPHICS_MODE=%s` | 320x200 / 320x240 / 320x400 / 320x480 / **360x480** / 640x400 / 640x480 / 800x600 / 1024x768 |
| ~Bios Keyboard | `BIOS_KEYBOARD=%s` | Off / On |
| ~Small Memory | `LOWMEM=%s` | Off / On |
| ~Mouse Enabled | `POINTER=%s` | Mouse / Joystick (disabled = no pointer) |
| ~Pointer: | `POINTER=%s` | Mouse / Joystick (enum at 0x058AAF) |
| ~Mouse Rate: | `MOUSE_RATE=%.2lf` | 0.50 |
| ~Joystick Rate: | — | Joystick sensitivity |
| Joystick ~Threshold: | — | Joystick dead zone |
| ~Firing Delay: | `FIRE_DELAY=%d` | 100 |
| ~Hardware Delay: | — | Frame timing |
| Falling ~Delay: | `FALLING_DELAY=%d` | 10 |
| ~Calibrate Joystick | — | Runtime calibration |
| ~Fast Computers | `FAST_COMPUTERS=%s` | Off / On |

**Economics Submenu**:

| Menu Item | Config Key | Values / Default |
|-----------|-----------|-----------------|
| ~Interest Rate: | `INTEREST_RATE=%lf` | 0.30 (30%) |
| ~Cash at Start: | `INITIAL_CASH=%ld` | 1000000 |
| Computers ~Buy | `COMPUTERS_BUY=%s` | Basic / Greedy / Erratic / Random |
| ~Free Market | `FREE_MARKET=%s` | Off / On |
| ~Scoring Mode: | `SCORING=%s` | Standard / Corporate / Vicious |

**Physics Submenu**:

| Menu Item | Config Key | Values / Default |
|-----------|-----------|-----------------|
| ~Air Viscosity: | `AIR_VISCOSITY=%d` | 0 (0-20) |
| ~Gravity: | `GRAVITY=%lf` | 0.20 (0.05-10.0) |
| ~Borders Extend: | `EDGES_EXTEND=%d` | 75 pixels |
| ~Effect of Walls: | `ELASTIC=%s` | None / Wrap-around / Padded / Rubber / Spring / Concrete |
| ~Suspend Dirt: | `SUSPEND_DIRT=%d` | 0 (0-100%) |
| ~Sky: | `SKY=%s` | Plain / Shaded / Stars / Storm / Sunset / Black / Random |
| ~Max. Wind: | `MAX_WIND=%d` | 0 |
| ~Changing Wind | `CHANGING_WIND=%s` | Off / On |

**Landscape Submenu**:

| Menu Item | Config Key | Values / Default |
|-----------|-----------|-----------------|
| ~Bumpiness: | `LAND1=%d` | 20 (terrain amplitude) |
| S~lope: | `LAND2=%d` | 20 (terrain frequency) |
| ~Flatten Peaks | `FLATLAND=%s` | Off / On |
| ~Random Land | `RANDOM_LAND=%s` | Off / On |
| ~Percent Scanned Mountains: | `MTN_PERCENT=%f` | 20.0 (at 0x05C103) |

**Play Options Submenu** (0x0585A7+ and extended at 0x058B2E):

| Menu Item | Config Key | Values / Default |
|-----------|-----------|-----------------|
| Ta~lking Tanks: | `TALKING_TANKS=%s` | Off / Computers / All |
| ~Attack File: | `ATTACK_COMMENTS=%s` | talk1.cfg |
| ~Die File: | `DIE_COMMENTS=%s` | talk2.cfg |
| Talk ~Probability: | `TALK_PROBABILITY=%d` | 100 (%) |
| Tanks ~Fall | `FALLING_TANKS=%s` | Off / On |
| ~Impact Damage | `DAMAGE_TANKS_ON_IMPACT=%s` | Off / On |
| ~Arms Level: | `ARMS=%d` | 4 (0-4 weapon tiers) |
| ~Bomb Icon: | `BOMB_ICON=%s` | Small / Big / Invisible |
| ~Tunneling | `TUNNELLING=%s` | Off / On |
| ~Scale: | `EXPLOSION_SCALE=%s` | Small / Medium / Large |
| Trace ~Paths | `TRACE=%s` | Off / On |
| ~Extra Dirt | `EXTRA_DIRT=%s` | Off / On |
| ~Useless Items | `USELESS_ITEMS=%s` | Off / On |
| ~Mode: | `PLAY_MODE=%s` | Sequential / Simultaneous / Synchronous |
| Play ~Order: | `PLAY_ORDER=%s` | Random / Losers-First / Winners-First / Round-Robin / Sequential |
| ~Teams: | `TEAM_MODE=%s` | None / On |
| ~Hostile Environment | `HOSTILE_ENVIRONMENT=%s` | Off / On |
| ~Language | — | UI language (?) |
| Status ~Bar | `STATUS_BAR=%s` | Off / On |
| ~Icon Bar | — | Icon bar toggle |
| Final Scoring | — | End-game score display |

**Weapons Submenu** (subset of Play Options):

| Menu Item | Config Key | Notes |
|-----------|-----------|-------|
| ~Arms Level: | `ARMS=%d` | Weapon tier gate (0-4) |
| ~Bomb Icon: | `BOMB_ICON=%s` | Projectile display size |
| ~Tunneling | `TUNNELLING=%s` | Weapons dig through terrain |
| ~Scale: | `EXPLOSION_SCALE=%s` | Explosion radius multiplier |
| Trace ~Paths | `TRACE=%s` | Show projectile trajectory |
| ~Extra Dirt | `EXTRA_DIRT=%s` | Explosions generate loose dirt |
| ~Useless Items | `USELESS_ITEMS=%s` | Include joke/novelty items |


#### Main Menu Rendering Code (VERIFIED from disassembly)

**Source Module**: No `.cpp` debug string found; likely `menu.cpp` or `config.cpp`. Code spans file 0x3B8D0–0x3D927 (segments 0x34ED–0x366D). Called from the game loop at file 0x2A850 in segment 0x23E0.

**Function**: `main_menu()` at file 0x3D140 (far address 0x34ED:0x1870)

**String Pointer Table** at DS:0x20C8: Master far-pointer array (4 bytes per entry, seg=0x4F38=DS) indexing all menu/UI strings. Entries [0]–[21] are option value strings ("Off", "On", "Basic", "Greedy", etc.), entries [22]–[24] are play mode strings ("Sequential", "Simultaneous", "Synchronous"), entries [25]–[51+] are menu labels ("~Start", "~Players:", "~Rounds:", sub-dialog labels, etc.).

**Menu button string table** specifically at DS:0x212C–0x2154 (entries [25]–[39] in the master table), with far pointers to:

| Table Index | DS Offset | String |
|:-----------:|:---------:|--------|
| 25 (0x212C) | DS:0x2827 | "~Start" |
| 26 (0x2130) | DS:0x282E | "~Players:" |
| 27 (0x2134) | DS:0x2838 | "~Rounds:" |
| 28 (0x2138) | DS:0x2841 | "S~ound..." |
| 29 (0x213C) | DS:0x284B | "~Hardware..." |
| 30 (0x2140) | DS:0x2858 | "~Economics..." |
| 31 (0x2144) | DS:0x2866 | "~Landscape..." |
| 32 (0x2148) | DS:0x2874 | "Ph~ysics..." |
| 33 (0x214C) | DS:0x2880 | "Play Op~tions..." |
| 34 (0x2150) | DS:0x2891 | "~Weapons..." |
| 35 (0x2154) | DS:0x289D | "Save ~Changes" |

**Resolution-Adaptive Layout** (from 0x3D161):

| Setting | Small Mode (height ≤ 200) | Normal Mode (height > 200) |
|---------|:------------------------:|:-------------------------:|
| Layout selector (DS:0xED58) | 1 (compact) | 0 (spacious) |
| Row height (DS:0x6316[n]) | 17 px | 25 px |
| First item index (DS:0xECD4) | 4 | 5 |
| Start Y position | 5 | 15 |
| Item spacing | 5 px | 12 px |

**Note**: DS:0xED58 is a **layout mode selector**, not a font selector. Both modes render the same proportional bitmap glyphs from Fastgraph — the selector is never referenced in text_display or text_measure. Only menu row height and positioning change between modes.

**Row Height Table** at DS:0x6316: `[0]=25` (spacious layout), `[1]=17` (compact layout). Indexed by DS:0xED58.

**Menu Item Y Positioning**: Each button is placed at `y = row_height * item_number + start_y`. The dialog system function at 0x3F19:0x2A9B (`add_button`) receives 13 parameters (0x1A bytes): dialog ptr, x, y, width, height, string far ptr, callback far ptr, flags, extra params.

**Item Callbacks** (in segment 0x34ED):
- ~Start → 0x34ED:0x014C (file 0x3BA1C): returns 1 to start the game
- Sub-dialog buttons → 0x34ED:0x01AF (file 0x3BA7F): opens sub-dialogs (Sound, Hardware, etc.)
- Save Changes → 0x34ED:0x0161 (file 0x3BA31): calls save function, refreshes dialog
- Save Changes alt → 0x34ED:0x16EC (file 0x3CFBC): alternate save path

**Dialog System Library** at segment 0x3F19 (file base 0x45B90):

| Function | Far Address | File Offset | Purpose |
|----------|:-----------:|:-----------:|---------|
| dialog_create | 0x3F19:0x00E2 | 0x45C72 | Create dialog with dimensions |
| dialog_draw | 0x3F19:0x024C | 0x45DDC | Render dialog to screen |
| dialog_run | 0x3F19:0x045D | 0x45FED | Run event loop |
| add_button | 0x3F19:0x2A9B | 0x4862B | Add button/label item |
| add_spinner | 0x3F19:0x2CD1 | 0x48861 | Add numeric spinner |

#### Title Area Rendering (right panel)

After menu buttons are created, the right side is rendered (starting at file 0x3D59B):

1. **Background fill**: `draw_3d_box(0, 0, screen_width, screen_height, bg_color)` fills entire screen with the 3D raised box effect.

2. **Terrain preview frame**: `draw_flat_box(menu_right+1, 6, screen_height-37, screen_width-6)` draws a sunken 3D frame for the terrain preview area. Height adjusts to `screen_height-51` if the copyright text is too wide.

3. **Terrain generation**: Called via 0x223A:0x083F, renders a live terrain preview inside the frame using current landscape settings.

4. **Title text rendering** (centered in space right of menu panel):

| Row | Y Position (large/small) | Content | Rendering Function |
|:---:|:------------------------:|---------|:------------------:|
| 1 | 11 / 2 | "Scorched Earth" | `title_3d_text` (5-layer emboss) |
| 2 | 41 / 27 | "The Mother of All Games" | `text_display` (normal) |
| 3 | 71 / 52 | "Registered Version" | `text_display` (normal) |
| 4 | varies | Copyright + "1.50" | `text_display` (normal) |

**Horizontal centering formula**: `x = (screen_max_x - menu_right - text_width) / 2 + menu_right`

**Copyright layout adapts to screen width**: If the full "Copyright (c) 1991-1995 Wendell Hicken" string is too wide (checked via `text_measure`), it splits across two lines:
- Line 1: "Copyright (c) 1991-1995" (at `screen_height - 33`)
- Line 2: "Wendell Hicken" (at `screen_height - 20`)

Otherwise, rendered as single line. Version string built via `sprintf(buf, "%s %s", "1.50", ...)`.

#### 3D Embossed Title Text (file 0x4CEFD)

The "Scorched Earth" title uses function `title_3d_text` at 0x4589:0x0C6D which renders 5 overlapping layers of the same text at pixel offsets (0,0) through (4,4), each in a different color from the palette system:

| Layer | Offset | Color Source | Visual Role |
|:-----:|:------:|:------------:|-------------|
| 1 | (x+0, y+0) | DS:0xEF2C | Deepest shadow |
| 2 | (x+1, y+1) | DS:0xEF32 | Shadow highlight |
| 3 | (x+2, y+2) | DS:0xEF24 | Mid-tone |
| 4 | (x+3, y+3) | DS:0xEF2A | Light |
| 5 | (x+4, y+4) | DS:0xEF26 | Top surface |

This creates the characteristic beveled/embossed look of the title. The inner text rendering function handles the `~` hotkey marker (character 0x7E) by skipping it in both measurement and display.

#### 3D Box Drawing Functions (file 0x444BB)

**draw_3d_box** (0x3DAB:0x000B at file 0x444BB): Raised box with Windows 3.1-style beveled edges.
- Parameters: `(x1, y1, width, height, fill_color)`
- Left/Top edges: 2-pixel border using colors DS:0xEF26 (dark) and DS:0xEF2E (light)
- Right/Bottom edges: 2-pixel border using colors DS:0xEF30 and DS:0xEF32 (bright)
- Interior: filled with `fill_color` via `fg_fillregion` ([DS:0xEF14])
- In hi-res VGA mode (`[DS:0x6E28]==3`): 3-pixel borders instead of 2

**draw_flat_box** (0x3DAB:0x0180 at file 0x44630): Sunken/inset frame (reversed highlight/shadow).
- Top: DS:0xEF30, Left: DS:0xEF32, Bottom: DS:0xEF26, Right: DS:0xEF2E
- Used for the terrain preview frame

#### Text Rendering System (segment 0x4589)

| Function | Far Address | File | Purpose |
|----------|:-----------:|:----:|---------|
| fg_setcolor | 0x3EA1:0x028F | 0x4569F | Set current draw color (stores to DS:0x6E2A) |
| font_init | 0x4589:0x0000 | 0x4C290 | Initialize glyph pointer table (once, guarded by DS:0x94EA) |
| text_display | 0x4589:0x0684 | 0x4C914 | Render formatted text at (x, y); handles `~` hotkey markers |
| text_measure | 0x4589:0x0B87 | 0x4CE17 | Measure pixel width of string; skips `~` chars |
| title_3d_text | 0x4589:0x0C6D | 0x4CEFD | 5-layer beveled text for title |

**Font System**: Single proportional bitmap font from Fastgraph V4.02 (NOT the VGA BIOS 8x8 font). The same glyphs are used at all resolutions — DS:0xED58 only controls menu layout spacing, never text rendering.

**font_init** (file 0x4C290): Called once on first text_display invocation (guard flag DS:0x94EA). Initializes a 256-entry far pointer table at `DS:[(char*4) - 0xCA6]`. All slots default to DS:0x70E4 (width=0 null glyph), then 161 specific characters are overridden with pointers to actual glyph data.

**Glyph Data** at DS:0x70E4–0x94EA (file 0x05CE64–0x05F26A, 9,222 bytes):
- Format: byte 0 = width (pixels), then width×12 bytes of 1-byte-per-pixel bitmap data (0x00=transparent, 0x01=set)
- Height: always 12 rows (hardcoded `cmp si, 0xC` in renderer)
- Coverage: 161 characters — ASCII 0x20–0x7E (95 printable) + 66 CP437 extended (accented Latin, Greek, math symbols)
- Characters without glyphs render as invisible (width=0)

**text_measure** iterates over each character, looks up glyph width from the font table (far pointer at `DS:[char*4 - 0xCA6]`), reads the first byte (width), adds 1 for spacing, and sums the total. Skips `~` (0x7E).

**text_display** uses `sprintf` (via 0x0:0x577A) to format the string into a buffer at DS:0xF2DA (max 128 chars), then renders character by character using the same font table. If the formatted string exceeds 128 chars, an error handler is invoked.

#### Fastgraph Function Pointer Table

Drawing primitives are called through indirect far pointers in the data segment, allowing the same code to work across different video modes:

| DS Offset | Function | Parameters |
|:---------:|----------|------------|
| DS:0xEEF4 | fg_getpixel (variant) | (x, y, color) |
| DS:0xEEF8 | fg_getpixel | (x, y) → color |
| DS:0xEF0C | fg_rect (horiz line) | (x1, x2, y, color) |
| DS:0xEF10 | fg_drect (vert line) | (x, y1, y2, color) |
| DS:0xEF14 | fg_fillregion | (x1, x2, y1, y2, color) |

These pointers are initialized at runtime based on the selected graphics mode.

#### UI Color Variables

All colors are stored as palette indices set at runtime via `fg_setrgb` calls at file 0x2A640–0x2A770 (icons.cpp init). Values extracted from disassembly:

| DS Offset | Palette Index | RGB (6-bit) | RGB (8-bit) | Role in 3D UI | Used In |
|:---------:|:-------------:|:-----------:|:-----------:|---------------|---------|
| DS:0xEF22 | dynamic (player) | player color | — | Bright highlight | Menu selection, HUD text; initially = EF2C |
| DS:0xEF24 | 0x99 (153) | (30,30,30) | (120,120,120) | Dark text / mid shadow | 3D title layer 3, unselected text |
| DS:0xEF26 | 0x9B (155) | **(63,63,63)** | **(255,255,255)** | **Outer highlight (WHITE)** | Raised box outer TL, title layer 5, sunken box bottom |
| DS:0xEF28 | 0x97 (151) | (45,45,45) | (180,180,180) | Background fill | Screen clear, box interiors; initially = EF2A |
| DS:0xEF2A | 0x97 (151) | (45,45,45) | (180,180,180) | Light accent (= background) | 3D title layer 4 |
| DS:0xEF2C | 0x98 (152) | **(0,0,0)** | **(0,0,0)** | Deep shadow (BLACK) | 3D title layer 1, bar fill, HUD highlight init |
| DS:0xEF2E | 0x9F (159) | (55,55,55) | (222,222,222) | Inner highlight, light border | Raised box inner TL, sunken box right |
| DS:0xEF30 | 0x9E (158) | **(5,5,5)** | **(20,20,20)** | Near-black shadow | Raised box inner BR, sunken box top |
| DS:0xEF32 | 0x9C (156) | (15,15,15) | (61,61,61) | Dark outer shadow | Raised box outer BR, sunken box left, title layer 2 |

**Key insight**: EF26 (labeled "dark" in old code comments) is actually **pure white (63,63,63)** — it serves as the outermost highlight of raised boxes and the bottom bright edge of sunken boxes. The label "dark" was misleading; it means "dark side context" (bottom/shadow edge in sunken) not "dark color".

**Draw_3d_box raised** (0x444BB): outer TL=EF26(white), inner TL=EF2E, inner BR=EF30, outer BR=EF32
**Draw_flat_box sunken** (0x44630): outer top=EF30, outer left=EF32, outer bottom=EF26(white), outer right=EF2E

**Also**: Wall palette (index 150) = `fg_setrgb(150, 50,50,50)` at file 0x2A73B = medium gray (200,200,200).


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

### Projectile Physics — VERIFIED from disassembly

#### Adaptive Timestep (dt)

**dt is NOT a fixed constant** — it is calibrated to CPU speed via a MIPS benchmark at startup. The fallback value is **0.02**.

CPU calibration (`get_mips_count()`, file 0x20F63) runs timing loops at startup, stores result at DS:1C86. Before each firing sequence, `setup_physics_constants()` (file 0x21064) computes:

```c
d = (float)FIRE_DELAY * (float)mips / ((float)num_projectiles * 100.0);

if (d > 0) {
    dt           = 1.0 / (50.0 * d);          // DS:CEAC
    gravity_step = 50.0 * GRAVITY / d;         // DS:CE9C
    wind_step    = (float)wind / (d * 40.0);   // DS:CEA4
} else {
    dt           = 0.02;                       // fallback (DS:1CFA)
    gravity_step = 50.0 * GRAVITY;
    wind_step    = (float)wind / 40.0;
}
```

**Constants confirmed from binary**: DS:0x1CF2 = 50.0 (f32, gravity multiplier), DS:0x1CF6 = 40.0 (f32, wind divisor), DS:0x1CFA = 0.02 (f64, fallback dt), DS:0x1CC8 = 100.0 (f32, d computation divisor).

#### Gravity/Wind Pre-Scaling — Derived Formulas

Substituting `dt = 1/(50*d)` yields equivalent per-step formulas independent of `d`:

```
gravity_step = 50.0 * GRAVITY / d = 50.0 * GRAVITY * 50.0 * dt = 2500.0 * GRAVITY * dt
wind_step    = wind / (d * 40.0)  = wind * 50.0 * dt / 40.0   = 1.25 * wind * dt
```

Both branches (d>0 and fallback) produce identical effective accelerations:
- **Gravity acceleration** = `2500.0 × GRAVITY_CONFIG` px/sec² (downward)
- **Wind acceleration** = `1.25 × wind` px/sec² (horizontal)

These are applied WITHOUT further dt multiplication in the sim loop — they are pre-scaled.

**Launch velocity**: `vx = (int)(cos(angle_rad) × power)`, `vy = (int)(sin(angle_rad) × power)` (file 0x212C9-0x21318). Power range 0–1000, so max speed = 1000 px/sec. No scaling factor — power maps directly to velocity.

**Web port scaling**: The web port uses `MAX_SPEED=400` (launch speed = power × 0.4). To preserve trajectory shape and range with this velocity scale factor k=0.4, all accelerations must scale by k²=0.16:
- Web gravity = 2500 × GRAVITY_CONFIG × k² = **400 × config.gravity** px/sec²
- Web wind = 1.25 × wind × k² = **0.2 × wind** px/sec²
- Trade-off: trajectories land at correct screen positions but flight time is 2.5× longer. For exact timing fidelity, MAX_SPEED should be 1000.

**Previous web port values** (GRAVITY=4.9 fixed, WIND_SCALE=0.15) were invented constants with no connection to the EXE. At default gravity=0.2: EXE gravity per step = 10.0, old web = 0.098 (102× too weak). Wind at 100: EXE per step = 2.5, old web = 0.3 (8× too weak).

#### Simulation Loop (file 0x21A80-0x21D09)

Per-step, per-projectile. **Note**: viscosity is multiplicative damping, NOT the differential form previously documented.

The function is ~649 bytes and includes both Mag Deflector deflection and standard physics. The Mag Deflector section was previously undocumented (INT 3Ch encoding made it hard to trace).

```c
void sim_step(projectile_t *proj) {
    // 0. Mag Deflector in-flight deflection (file 0x21A80-0x21C3A)
    //    Iterates all players (stride 0x6C, base DS:CEB8).
    //    Per player: checks +0x3C (active flag), computes distance².
    //    DS:1D2C = 1000000.0 (range² threshold = 1000px radius)
    //    DS:1D30 = 1000.0 (normalization divisor)
    //    If distSq <= 1000000.0:
    //      normDist = sqrt(distSq) / 1000.0
    //      velocity adjusted by (player_field / normDist) * dt
    //    Stores result to DS:E4DC (vx), DS:E4E4 (vy)
    //    NOTE: INT 3Ch encoding (ES: prefixed FPU ops on player sub-struct)
    //    makes exact field accesses hard to decode — fpu_decode.py bug.
    //    Conditional on DS:5146 flag: plays distance-based sound effect
    //    via sqrt(distSq) * DS:1CA2 + 1000.0 → _ftol → call 0xA281
    //    DS:1CA2 = 1.5 is ONLY used here as a sound frequency multiplier.
    //    It is NOT a speed limit threshold (earlier doc was wrong).

    // NOTE: There is NO explicit speed limit check in the EXE physics loop.
    // DS:1CA2 = 1.5 appears only in: (a) MIPS benchmark timing loop
    // (file 0x21000), and (b) Mag Deflector sound distance scaling here.
    // Speed is bounded naturally by viscosity damping per step.
    // The web port's `speedSq > 160000` check is non-original.

    // 1. Position update (screen Y inverted)
    proj->x += proj->vx * dt;       // DS:CEAC
    proj->y -= proj->vy * dt;       // FSUBR: y = y - vy*dt

    // 3. Air viscosity — MULTIPLICATIVE damping
    proj->vx *= viscosity_factor;    // DS:5178
    proj->vy *= viscosity_factor;

    // 4. Gravity (pre-scaled, screen coords)
    proj->vy -= gravity_step;        // DS:CE9C

    // 5. Wind (horizontal only, pre-scaled)
    proj->vx += wind_step;           // DS:CEA4
}
```

Projectile sub-struct fields (via ES:BX): `+0x04`=f64 vx, `+0x0C`=f64 vy, `+0x14`=f64 x, `+0x1C`=f64 y.

#### Air Viscosity — VERIFIED from disassembly

**Range clamping** (file 0x19B54–0x19B7D, seg 0x130F): after parsing AIR_VISCOSITY as float, the EXE clamps to [0.0, 20.0] (min = 0.0 via `fldz`; max = DS:0x0408 = 20.0 via `fcomp dword [0x408]`).

**Factor computation** (file 0x19B87–0x19BA4, seg 0x130F):
```c
DS:0x5180 = (int16_t)AIR_VISCOSITY_float;       // integer intermediate
DS:0x5178 = 1.0 - (double)DS:0x5180 / 10000.0; // divisor DS:0x040C = 10000.0 (f32)
// value 0  → factor 1.000 (no damping)
// value 20 → factor 0.998 (max damping per step)
```
Menu module repeats same computation at file 0x3CA0A–0x3CA19 (DS:0x637C = 10000.0).

**Per-step application** (file 0x21C56–0x21CA7, extras.cpp; also file 0x14391–0x143BA, earlier physics path):
```c
// Skip optimization: if factor == 1.0 (viscosity=0), skip multiply entirely
if (DS:5178 != 1.0) {
    vx *= DS:5178;
    vy *= DS:5178;
}
```
Applied to vx and vy each physics sub-step, both in extras.cpp and an earlier trajectory module.

**Web port**: formula and per-step application in `physics.js` are correct. Range 0–20 matches EXE.

#### Wind System — VERIFIED from disassembly

**Wind is horizontal only** — `wind_y` always set to 0 (file 0x226D3).

**Generation** (round start, file 0x2943A) — positive-biased with nested random doubling:
```c
int generate_wind(int max_wind) {
    // file 0x2943A: mov ax,[515c]; push ax; call rand(n); then mov ax,[515c]; mov bx,4; idiv
    int wind = random(max_wind) - max_wind / 4;  // [-max/4, +3*max/4)  NOTE: asymmetric!
    // file 0x29462-0x29485: NESTED — second double only if first fires
    if (random(100) < 20) {      // 20% chance
        wind *= 2;
        if (random(100) < 40)    // 40% of that 20% = 8% total chance of ×4
            wind *= 2;
    }
    return wind;                 // no clamp on generation; per-turn update clamps to ±max_wind
}
// Distribution: 80% base [-max/4, +3max/4), 12% doubled, 8% quadrupled
// Mean ≈ +max/4 (positive-biased); e.g. max_wind=200 → mean ≈ +49.5
// DS:515c = MAX_WIND (slider 5–500, default 200); DS:515a = current wind (signed int16)
// DS:633c = 5.0 (slider min float32); DS:6348 = 500.0 (slider max float32)
```

**Changing wind** (per-turn, file 0x28E99) — random walk when `CHANGING_WIND=On`:
```c
void update_wind(int *wind, int max_wind_limit) {
    int delta = random(11) - 5;    // [-5, +5]
    *wind += delta;
    *wind = clamp(*wind, -max_wind_limit, +max_wind_limit);
}
```

#### Physics DS Offsets

| DS Offset | Type | Purpose |
|-----------|------|---------|
| DS:CEAC | f64 | dt (adaptive timestep) |
| DS:CE9C | f64 | gravity_step (pre-scaled: 2500×GRAVITY×dt) |
| DS:CEA4 | f64 | wind_step (pre-scaled: 1.25×wind×dt) |
| DS:512A | f64 | GRAVITY config value (default 0.2, range 0.05–10.0) |
| DS:5140 | i16 | FIRE_DELAY (default 100) |
| DS:5152 | i16 | CHANGING_WIND flag |
| DS:515A | i16 | current wind (signed int16) |
| DS:515C | i16 | MAX_WIND (0-200) |
| DS:5178 | f64 | viscosity factor (= 1.0 − AIR_VISCOSITY/10000) |
| DS:5180 | i16 | AIR_VISCOSITY integer (0–20), intermediate for DS:5178 computation |
| DS:0408 | f32 | 20.0 — max AIR_VISCOSITY clamp value |
| DS:040C | f32 | 10000.0 — viscosity divisor constant |
| DS:1C86 | u32 | MIPS count |
| DS:1CC8 | f32 | 100.0 — d computation divisor |
| DS:1CF2 | f32 | 50.0 — gravity multiplier constant |
| DS:1CF6 | f32 | 40.0 — wind divisor constant |
| DS:1CFA | f64 | 0.02 (fallback dt) |
| DS:1CA2 | f32 | 1.5 (Mag Deflector sound multiplier: sqrt(distSq)*1.5+1000 → sound frequency) |

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
- INT 3Ch = ES: prefix + DD/DC (player sub-struct FPU ops — **fpu_decode.py bug**: maps to D8, should be ES:DD/DC)
- INT 3Dh = 9B (fwait)

A **PI/180 constant (0.0174532930)** was found at DS:0x1D08, confirming the game does use degree-to-radian conversion for trig — it was just hidden behind the INT emulation layer.

**Intermediate files**: `disasm/float_constants.txt`, `disasm/explosion_physics.txt`, `disasm/damage_formula.txt`, `disasm/physics_timestep_wind_analysis.txt`

### Wall Types (ELASTIC setting) (VERIFIED)

**Config variable**: DS:0x5154 (ELASTIC enum, set by config parser at 0x29290)

**Enum ordering** (from config string table and dispatch code at file 0x2220F):

| Value | Name | EXE Behavior |
|-------|------|--------------|
| 0 | None | Projectiles fly offscreen (DS:CE98=1, terminates flight) |
| 1 | Wrap | Wrap-around: teleport X to opposite side |
| 2 | Padded | Reflect with 0.5× velocity (coeff = -0.5) |
| 3 | Rubber | Perfect reflect (coeff = -1.0, no energy loss) |
| 4 | Spring | Amplified reflect (coeff = -2.0, doubles speed) |
| 5 | Concrete | Detonate on wall impact (calls explosion handler) |
| 6 | Random | Resolved to random(6) → 0–5 once per round |
| 7 | Erratic | Resolved to random(6) → 0–5 each turn |

**Bounce coefficient dispatch** (file 0x21EFD–0x21F24):
```
; At file 0x21EFD (extras.cpp):
cmp [DS:5154], 3      ; Rubber?
jnz .check_padded
fld qword [DS:1D34]   ; coeff = -1.0
jmp .apply

.check_padded:
cmp [DS:5154], 2      ; Padded?
jnz .default_spring
fld qword [DS:1D3C]   ; coeff = -0.5
jmp .apply

.default_spring:       ; Spring (type 4) is the fallthrough default
fld qword [DS:1D44]   ; coeff = -2.0

.apply:
fstp qword [bp-1C]    ; store bounce_coeff
; Then: vx_new = vx * bounce_coeff (for X walls)
;        vy_new = vy * bounce_coeff (for Y ceiling)
```

**Bounce coefficient float64 constants**:
| DS Offset | File Offset | Value | Used by |
|-----------|-------------|-------|---------|
| DS:0x1D34 | 0x57AB4 | -1.0 | Rubber (type 3) — perfect reflection |
| DS:0x1D3C | 0x57ABC | -0.5 | Padded (type 2) — half velocity |
| DS:0x1D44 | 0x57AC4 | -2.0 | Spring (type 4) — double velocity |

The negative sign handles the velocity direction reversal (reflection). The coefficient is applied to vx for left/right wall hits and to vy for ceiling hits.

**X-wall boundary check** (file 0x2220F):
- Left boundary: `proj.x < DS:EF3C + DS:513E` (screen left + margin)
- Right boundary: `proj.x > DS:EF42 - DS:513E` (screen right - margin)

**Bounce count limit**: Player struct offset 0x30 is checked `<= 6` (max 6 bounces before alternative handling at file 0x21F35).

**Random/Erratic resolution** (file 0x22140): `random(6)` yields 0–5, mapping to None/Wrap/Padded/Rubber/Spring/Concrete.

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
//   DS:1D60 (f64) = 0.7 (explosion damage falloff between successive player hits)

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

**VERIFIED by decode_mtn.py / render_mtn.py (9 of 10 files decode cleanly).**

### File List (from binary at DS:0x5F04 descriptor table)

The descriptor table starts at DS:0x5F04 (file 0x5BC84); each entry is 8 bytes:
`filename_far_ptr (4 bytes) + file_size_32bit (4 bytes)`. Filenames at DS:0x5F5A+.

| File | Filename DS: | Size | Theme |
|------|-----------|------|-------|
| ice001.mtn | DS:0x5F5A | 45,972 | Ice/glacier |
| ice002.mtn | DS:0x5F65 | 54,281 | Ice/glacier |
| ice003.mtn | DS:0x5F70 | 139,961 | Ice/glacier |
| rock001.mtn | DS:0x5F7B | 63,114 | Rocky terrain |
| rock002.mtn | DS:0x5F87 | 73,730 | Rocky terrain |
| rock003.mtn | DS:0x5F93 | 136,992 | Rocky terrain |
| rock004.mtn | DS:0x5F9F | 69,068 | Rocky terrain |
| rock005.mtn | DS:0x5FB7 | 41,767 | Rocky terrain |
| rock006.mtn | DS:0x5FC3 | 33,738 | Rocky terrain |
| snow001.mtn | DS:0x5FCF | 67,134 | Snowy mountains |

### Header Structure (72 bytes total)

| Offset | Size | Field | Value |
|--------|------|-------|-------|
| 0x00 | 2 | Magic `"MT"` | 0x4D54 |
| 0x02 | 2 | Magic2 | 0xBEEF |
| 0x04 | 2 | Version | Always 0x0100 (1.0) |
| 0x06 | 2 | `h` — rows per column | 419–1483 |
| 0x08 | 2 | `x_start` — first encoded column | 0–104 |
| 0x0A | 2 | `x_end` — last encoded column + 1 | 174–294 |
| 0x0C | 2 | `n_colors` | Always 16 (0x0010) |
| 0x0E | 2 | `data_size` — `file_size - 24` (palette+pixels) | varies |
| 0x10 | 2 | Unknown (always 0x0000) | 0 |
| 0x12 | 2 | Unknown (varies) | varies |
| 0x14 | 4 | Unknown (often 0x38FC_29FB or 0x1F31_29FC) | varies |
| 0x18 | 48 | Palette: 16 × RGB888 (8-bit per channel) | see below |

**Note:** `data_size` field equals `file_size - 24` for small files (rock001/ice001/ice002/rock005/rock006); for large files the field stores a different (smaller) value — interpretation unknown. Always skip this field; use `file_size - HEADER_SIZE` directly.

### Palette (at byte offset 0x18 = 24, 48 bytes)

- 16 colors × 3 bytes (R, G, B), values 0–255 (NOT VGA 6-bit)
- **Index 0 = (255,255,255) white = sky / transparent** (consistent across all 10 files)
- **Index 15 = (0,0,0) black** (consistent across all 10 files)
- Indices 1–14: terrain colors (rock/ice/snow shades, file-specific)
- Example ROCK001 palette: index 14=(49,41,33) dark brown, index 13=(66,57,49) very dark brown, index 1=(165,156,140) light tan

### Pixel Data (at byte offset 0x48 = 72)

**Encoding:** PCX-RLE applied to nibble-packed (4bpp) bytes, column-major ordering.

- **4-bit pixels**: each byte encodes TWO pixels — high nibble = pixel 0, low nibble = pixel 1
- Each byte ≥ 0xC0 is a PCX-RLE run header: `count = byte & 0x3F` copies of next byte
- Each byte < 0xC0 is a literal packed byte (2 pixels)
- Columns encoded from `x_start` to `x_end - 1`, each column `h` pixels tall
- Bytes per column (uncompressed): `ceil(h / 2)` packed bytes = `h` pixels
- Column scan direction: row 0 = TOP of image (sky at top, terrain below)

**Sky/terrain boundary**: for each column `x`, scan from row 0 downward. First non-zero (non-sky) pixel = terrain ceiling row. `terrain_height_fraction = first_terrain_row / h`. Terrain fills from that row to the bottom; sky is above.

**Two data blocks**: each file contains TWO consecutive PCX-RLE blocks of column data (same format, same bytes_per_col). Block 1 covers columns `x_start..x_end-1`. Block 2 covers additional columns (count varies). Purpose of block 2 unknown (background layer? shadow? cached rotated view?). The game's ScannedMountain loader reads from file offset 72 onward.

### Terrain Height Extraction (for web port)

```
for x in range(x_start, x_end):
    col = decode_column(pixel_data, x)   # h pixels, nibble-unpacked from PCX-RLE
    for row in range(h):
        if col[row] != 0:                # first non-sky pixel from top
            terrain_y_frac[x] = row / h  # 0=top, 1=bottom
            break
    else:
        terrain_y_frac[x] = 1.0          # entirely sky column

# Map x_start..x_end-1 → playfield 0..319
# Map terrain_y_frac → playfield y 0..199
```

### MTN_PERCENT Control

`MTN_PERCENT` (DS:0x??? — exact offset TBD) defaults to 20.0 (config file). It is a **selection probability** (not a visual blend): when terrain generation runs, if `rand() < MTN_PERCENT/100`, the `ScannedMountain` class is used to load a random .MTN file; otherwise, procedural terrain (`DefaultLand` / `LandGenerator`) is used. This is a binary switch, not a texture blend.

### Terrain Class Names (from debug strings)

| Name | File Offset | Purpose |
|------|-------------|---------|
| ScannedMountain | 0x029AAE | MTN-loaded terrain class |
| LandGenerator | 0x029AEC | Procedural terrain base class |
| DefaultLand | 0x029B4E | Default procedural generator |

### Reference Tools

- `disasm/decode_mtn.py` — Full decoder (nibble-packed PCX-RLE from offset 72), verifies 9/10 files
- `disasm/render_mtn.py` — ASCII silhouette renderer to visualize column data
- `disasm/inspect_mtn_header.py` — Dumps raw header fields for all .MTN files
- Reference parser (Python): https://github.com/zsennenga/scorched-earth-mountain

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
//
// VERIFIED constants (decoded from binary — DS offsets with IEEE double/float values):
//   DS:0x322C = harmonic count (runtime, init to 0; max 5, min 2)
//   DS:0x322E = π     = 3.14159  (double) — freq_base divisor
//   DS:0x3236 = 2π    = 6.28318  (double) — freq_cap divisor
//   DS:0x323E = 4.0   (float)    — freq multiplier scale per harmonic
//   DS:0x3242 = 0.5   (float)    — amplitude scale factor
//   DS:0x3246 = 2.0   (float)    — budget deduction factor per harmonic
//   Runtime tables (BSS, zero in binary, initialized by this function):
//     freq table:  DS:[i*8 - 0x3070]  (= DS:0xCF90 for i=0)
//     phase table: DS:[i*8 - 0x2FD0]  (= DS:0xD030 for i=0)
//     amp table:   DS:[i*8 - 0x3020]  (= DS:0xCFE0 for i=0)

void ai_inject_noise(int noise_amplitude, int shot_range) {
    // freq_base = π / (2 * noise_amplitude)
    double freq_base = 3.14159 / (double)(noise_amplitude * 2);
    // freq_cap = 2π / 10
    double freq_cap  = 6.28318 / 10.0;
    // freq_mult starts at freq_base * 4.0, multiplied by 4.0 each harmonic
    double freq_mult = freq_base * 4.0;

    int budget = shot_range - 30;  // remaining amplitude budget
    int n = 0;  // DS:0x322C = harmonic count

    while (budget > 10 && n < 5) {
        // amplitude = rand01() * budget * 0.5
        amplitude[n] = random_float() * (double)budget * 0.5;

        // frequency: rejection-sample into [freq_base, freq_cap]
        do { frequency[n] = random_float() * freq_mult; }
        while (frequency[n] < freq_base || frequency[n] > freq_cap);

        // phase: random integer 0–299
        phase[n] = (double)random_int(300);

        // reduce remaining budget by 2 * amplitude
        budget = (int)((double)budget - amplitude[n] * 2.0);
        freq_mult *= 4.0;  // next harmonic has 4× higher frequency range
        n++;
    }
    if (n < 2) goto retry;  // need at least 2 harmonics; retry entire generation
}

// Noise application (file 0x25F37): called with (player_ptr, min_target, min_angle,
//   max_angle, max_target, min_angle2). For each target si from min_target..max_target:
//   shot_number increments once per outer call; base_angle chosen once per call as:
//     base_angle = ftol(min_angle + total_amp + rand(shot_range - 20 - 2*total_amp))
//   angle_for_target = base_angle + SUM(i=0..n-1; amplitude[i] * sin(frequency[i]*(phase[i]+shot_number)))
//   → ftol(angle_for_target) → simulate trajectory at that angle
// This is a SCANNING mechanism — the AI explores the angle space smoothly across
// successive firing attempts, NOT random noise added to a solved answer.
```

**IMPORTANT web port discrepancy — AI noise is architecturally different:**
The EXE does NOT compute a "correct" angle and add noise. Instead, `ai_inject_noise` generates
a sinusoidal scan pattern: the base angle is a random starting point within the valid range,
and each successive firing attempt uses `shot_number++` to walk the sinusoid. More accurate AI
types (lower `noise_amplitude`) have higher-frequency harmonics (smaller wavelength, faster
scanning), meaning they cover more of the angle space per shot. The web port's model of
`analytically solved angle + sinusoidalNoise() * 0.15 (angle) / * 3.0 (power)` is architecturally
incorrect — those multipliers (0.15, 3.0) are guesses with no basis in the EXE constants.

**Actual EXE amplitude for Moron (noise_amplitude=50, shot_range≈90°):**
- freq_base = π/100 ≈ 0.031 rad, freq_cap = 2π/10 ≈ 0.628 rad
- budget = 90 - 30 = 60, amp[0] ≈ rand() * 30 (±30° first harmonic)
- After 1 harmonic, budget ≈ 0 → typically 2 harmonics forced by min_count=2
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

6 entries of 16 bytes each. Count at DS:0x61E4 = 5 (excluding "None"). Pointer array at DS:0x61CC (6 far ptrs).

Config entry mapping formula (dialog builder at file 0x3E9D2): `config_ptr = (weapon_index - DS:D558 + 1) × 16 + DS:0x616C`. DS:D558 = Mag Deflector weapon index (45 at runtime). Config +0x0E field = 0 for all entries → `dispatch_type = 0 + 1 = 1` for all standard shields.

| Entry | Weapon | Name | Energy (HP) | Radius (px) | Color VGA (R,G,B) | +0x0C | +0x0E |
|-------|--------|------|-------------|-------------|--------------------|----|------|
| 0 | — | None | 0 | 0 | (0, 0, 0) | 0 | 0xFFFF |
| 1 | 45 | Mag Deflector | 55 | 16 | (63, 63, 23) yellow | 2 | 0 |
| 2 | 46 | Shield | 100 | 15 | (63, 63, 63) white | 0 | 0 |
| 3 | 47 | Warp Shield | 100 | 15 | (63, 23, 63) purple | 1 | 0 |
| 4 | 48 | Teleport Shield | 150 | 16 | (63, 63, 63) white | 0 | 0 |
| 5 | 49 | Flicker Shield | 200 | 16 | (63, 53, 33) orange | 4 | 0 |

**Field +0x0C** is a dialog navigation aid (stored to DS:0x6FF0 during equip dialog), NOT a gameplay behavior flag.

**Field +0x0E** determines dispatch_type: `dispatch_type = config[+0x0E] + 1`. All standard shields have +0x0E=0 → dispatch_type=1. If dispatch_type=8, it's "Random Shield" (randomized to 1-7 at equip time, file 0x27A24).

**Flicker Shield** (config entry 5) is a **regular absorption shield** with 200 HP, orange color, radius 16. It has NO probabilistic on/off cycling, NO flickering behavior, NO special dispatch handler in v1.50. Same flat 1:1 absorption as all other shields. Despite the name, its behavior is identical to all other standard shields — only energy, radius, and color differ. It is the highest-energy shield in the game at the cheapest price (1,000) with the most generous quantity (25).

**Force Shield (weapon 50), Heavy Shield (weapon 51), Super Mag (weapon 52)** are OUTSIDE the shield config range [DS:D558=45, DS:D560=49]. They have corrupted weapon struct data (linker bug, see weapon table notes) and are NOT in the config table.

### Shield Dispatch Table — DS:0x026A (16 bytes/entry, 7 types)

Used ONLY when Random Shield is selected (dispatch_type=8 → random(7)+1). Standard shields all use type 1 (NULL per-step, HUD per-frame).

| Type | Per-frame (DS+0x026A) | Per-step (DS+0x026E) | File offset | Purpose |
|------|----------------------|---------------------|-------------|---------|
| 1 | 262C:0241 | NULL | 0x2CF01 | Inventory counting / HUD update |
| 2 | 320D:007E | 320D:0380 | 0x38B4E / 0x38E50 | Flicker toggle (DS:EC88) |
| 3 | 315D:000C | 315D:0241 | 0x37FDC / 0x38211 | Unknown |
| 4 | 3B6B:0007 | 3B6B:00FE | 0x420B7 / 0x421AE | Unknown |
| 5 | 1132:000F | 1132:00F0 | 0x17D2F / 0x17E10 | Unknown |
| 6 | 34B2:0163 | 34B2:02F3 | 0x3B683 / 0x3B813 | Unknown |
| 7 | 14C8:03E3 | 14C8:0501 | 0x1BA63 / 0x1BB81 | Unknown |

Types 2-7 have unique per-step handlers for Random Shield gameplay effects. Type 2's flicker toggle (DS:EC88) is the only confirmed special behavior, used exclusively by the Random Shield mechanism.

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

### Visual Feedback — Shield Color Rendering

**Color formula** (continuous energy-based fade): `update_shield_color` at file 0x389DA.

```c
// Per-channel continuous fade — NOT quantized, NOT stepped
R = shieldEnergy × configR / maxEnergy
G = shieldEnergy × configG / maxEnergy
B = shieldEnergy × configB / maxEnergy
// Written to VGA palette entry (player_number + 200) via fg_setrgb
```

Where `configR/G/B` = shield config entry offsets +0x06/+0x08/+0x0A, `maxEnergy` = config +0x02.

**Two palette indices** used:
- **Activation**: VGA entry `player_number × 8 + 5` (sub-struct +0x1A + 5, within player's 8-color block). Temporarily used during 50-frame fade-in animation. Source: 0x388CE.
- **Ongoing gameplay**: VGA entry `player_number + 200` (sub-struct +0xA0 + 0xC8, dedicated per-player shield entry). RGB updated continuously when shield takes damage. Source: 0x38A8C.

**Activation animation** (`shields_start` at file 0x38780, 50 frames):
```c
fg_setrgb(player*8+5, 0, 0, 0);           // start black
draw_shield_shape();                        // draw pixels with palette index player*8+5
for (i = 0; i <= 50; i++) {
    delay(2*i);                             // accelerating: 0, 2, 4, ... 100 ticks
    sound(20, 1000 + i*100);               // rising pitch
    brightness = clamp(i * 63 / 50, 0, 63);
    R = configR * brightness / 63;
    G = configG * brightness / 63;
    B = configB * brightness / 63;
    fg_setrgb(player*8+5, R, G, B);        // VGA hardware palette animation
}
```

**Break animation** (within `shield_absorb_damage` at file 0x38344, break path at 0x38421):
```c
// Step 1: Trigger one last shield hit visual effect with remaining energy
call_shield_hit_effect(player, shieldEnergy);

// Step 2: Set palette to full brightness (start of fade)
fg_setrgb(player*8+5, configR, configG, configB);

// Step 3: 51-frame fade-to-dark (di=0 to 50 inclusive)
freq = 6000;
for (di = 0; di <= 50; di++) {
    fg_sound(20, freq);                    // constant 20-tick delay, descending tone
    freq -= 100;                           // 6000 → 5900 → ... → 1100 Hz
    R = configR * (60 - di) / 60;          // fade from 100% to 10/60 ≈ 17%
    G = configG * (60 - di) / 60;
    B = configB * (60 - di) / 60;
    fg_setrgb(player*8+5, R, G, B);        // VGA palette animation
}

// Step 4: Final beep
fg_sound(10, 1000);                        // short 1000 Hz tone

// Step 5: Erase shield pixels (callback replaces shield color with terrain)
erase_shield_shape(player, callback_restore_terrain);  // file 0x3FC11

// Step 6: Cleanup
player.shieldEnergy = 0;
redraw_area(config.radius, player.x);
```

**Break animation key details**:
- **No white flash**: The EXE has NO distinct white flash — just a smooth fade starting at full config color. The web port's frame-0 white flash is spurious.
- **Constant delay**: Unlike activation (which has accelerating delay `2*i`), break uses constant 20-tick sound duration per frame.
- **Fade range**: Full brightness → ~17% (NOT to black). Formula divisor is 60, not 50.
- **Sound**: Descending tone 6000→1100 Hz (reverse of activation's ascending 1000→6000 Hz).
- **Erase callback** (file 0x3FC11): For each shield pixel, checks `fg_getpixel(x,y) == player*8+5`; if so, calls `setTerrainPixel(x,y)` to restore the underlying terrain.
- **Draw callback** (file 0x3FC46): For shield drawing, checks `fg_getpixel(x,y) >= 0x69` (105 = terrain boundary); if so, draws with shield palette entry.

**Pixel replacement** (callback at file 0x3899C): After activation, `update_shield_color` redraws the shield shape using a callback that replaces pixels of value `player*8+5` with `player+200`, switching them to the dedicated per-player shield palette entry.

**Pixel drawing callback** (activation, at file 0x38649): Gets current pixel via `fg_getpixel(x,y)`; first checks bounds (DS:EF42/EF3C/EF40/EF38 screen rect), then checks tank bounding box (DS:EC7C far ptr to rect — excludes own tank body), then skips pixels in VGA 0x50-0x68 (80-104 = sky range); otherwise sets pixel to `DS:EC80` (player*8+5). Shield pixels are only drawn over terrain (>= 0x69) and tank pixels (< 0x50), never over sky. The 0xFF white impact marker (set by projectile terrain collision at 0x3EBD7) is >= 0x69, so shields can be drawn over impact points.

**Key DS globals**:
- DS:EC80 = shield pixel value = player*8+5 (set at 0x387D3)
- DS:EC82 = tank Y position (set at 0x389FC)
- DS:EC84 = shield pixel match value = player*8+5 (set at 0x38A09)
- DS:EC86 = replacement pixel value = player+200 (set at 0x38A17)

### Battery Interaction

Shields require Battery charges to maintain energy across turns. Without batteries, shield type resets to 0 (disabled). Code at file 0x39750 handles allocation.

### Player Struct Shield Fields

See full **Player Data Structures** section for complete layout. Shield-relevant fields in the sub-struct (0xCA):

| Offset | Field |
|--------|-------|
| +0x0E | X position |
| +0x10 | Y position |
| +0x1A | Player palette base = player_number × 8 (set at 0x30F38: `shl di, 3`) |
| +0x1C | Player color R (from DS:0x57E2 table, 6 bytes/player) |
| +0x1E | Player color G |
| +0x20 | Player color B |
| +0x92 | Turret angle (fine) |
| +0x94 | Turret direction (-1 or 1) |
| +0x96 | Shield energy remaining (HP) |
| +0xA0 | Player number (0-9) (set at 0x30E96) |
| +0xC6 | Far pointer to shield config entry (16 bytes) |

### Mag Deflector / Super Mag

These are **not shield types** — they modify projectile trajectories through the physics system rather than absorbing damage.

#### In-Flight Deflection (file 0x21A80-0x21C3A, inside sim_step)

Integrated into the per-step simulation loop, BEFORE speed limit/position/viscosity/gravity/wind. Iterates all players per projectile step:

```c
// Per-player deflection check (inside sim_step at 0x21A80)
for each player (stride 0x6C, base DS:CEB8):
    if (!player.active) continue;       // +0x3C check

    // Compute distance² from projectile to player
    double dx = proj.x - player.x;
    double dy = proj.y - player.y;
    double distSq = dx*dx + dy*dy;

    // Range check: DS:1D2C = 1000000.0 (1000px radius)
    if (distSq > 1000000.0) {
        // Out of range — reset distSq to threshold (DS:1D2C)
        distSq = 1000000.0;            // 0x21B68: fld [0x1D2C]
        goto skip_deflection;
    }

    // In range: normalize and deflect
    double normDist = sqrt(distSq) / 1000.0;   // DS:1D30 = 1000.0
    // Velocity adjusted: (field / normDist) * dt
    // NOTE: exact field access unclear due to INT 3Ch encoding bug
    //       (ES: prefixed FPU ops on player sub-struct not fully decoded)

skip_deflection:
    // Conditional sound: DS:5146 flag check
    // if set: pitch = sqrt(distSq) * DS:1CA2 + 1000.0 → play sound

    // Standard physics continues (speed limit, position, viscosity, gravity, wind)
    // Velocity stored to DS:E4DC (vx), DS:E4E4 (vy) globals
```

**Key constants**:
| DS Offset | Type | Value | Purpose |
|-----------|------|-------|---------|
| DS:1D2C | f32 | 1000000.0 | Distance² threshold (1000px range) |
| DS:1D30 | f32 | 1000.0 | Normalization divisor |

**Note**: The deflection scales as `1/normDist * dt` — NO additional multiplier. Web implementation previously had an erroneous `×30` factor that caused projectiles to reverse direction when multiple players had Mag Deflectors (e.g., after MAYHEM cheat).

#### Collision Damping (file 0x2253A)

On impact near a Mag Deflector player, velocity attenuated by **0.75×** (DS:0x1D54 = 0.75 f32). Absorption if speed² < 2000.0 (DS:0x1D58). **Correction**: previously documented as 0.7× (DS:1D60) — that is the explosion damage falloff coefficient, NOT the Mag Deflector collision damping. Verified by disassembly at 0x22540: `fld dword [0x1D54]; fmul qword [0xE4DC]; fstp qword [0xE4DC]` (same for E4E4/vy).
```c
// file 0x2253A: check super_mag first (DS:1C76)
if (DS:1C76 != 0) goto explosion;   // Super Mag bypasses damping
DS:1C7E = 1;                         // damping-applied flag
DS:E4DC *= DS:1D54;   // vx *= 0.75
DS:E4E4 *= DS:1D54;   // vy *= 0.75
if (vx² + vy² < DS:1D58) goto absorbed;  // speed² < 2000.0 → no damage
```

#### Super Mag (DS:0x1C76)

Flag set on projectile at fire time (file 0x2142C: `mov word [0x1C76], 0x1`) when attacker has Super Mag inventory. **Bypasses collision damping** (checked at impact), but does NOT bypass in-flight deflection field.

**Intermediate files**: `disasm/shields_code.txt`, `disasm/shield_mechanics.txt`, `disasm/extras_decoded.txt`

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
| +0x24 | 2 | int16 | guidance_type | Guidance type (single value, not bitmask). Checked at 0x2263D per physics step in cascading if-else: Horz (DS:D54E) → Vert (DS:D550) → Heat (DS:D54A). Set to 0 when consumed (one-shot per flight). See "Guidance System" section. |
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
PLAY_ORDER=Random         # Random/Losers-First/Winners-First/Round-Robin/Sequential
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

## Talk Files — comments.cpp (seg 0x1144, file base ~0x17E40)

### Overview

The "Talking Tanks" system displays speech bubble taunts above tanks when they fire (attack comment) or are destroyed (die comment). Lines are loaded from plain-text config files (one phrase per line). Source file: `comments.cpp`.

### Config Variables

| DS Offset | Name | Type | Default | Description |
|-----------|------|------|---------|-------------|
| 0x5118 | TALKING_TANKS | word | 0 (Off) | 0=Off, 1=Computers only, 2=All players |
| 0x511A | TALK_PROBABILITY | word | 100 | Percentage chance (0–100) of showing a bubble |
| 0x511C | TALK_DELAY | word | 18 | Display duration in timer ticks (~1 second at 18.2 Hz) |
| 0xECD8 | attack_filename | string | "talk1.cfg" | Path to attack comments file (from ATTACK_COMMENTS= in SCORCH15.CFG) |
| 0xED18 | die_filename | string | "talk2.cfg" | Path to die comments file (from DIE_COMMENTS= in SCORCH15.CFG) |
| 0x0128 | talk_files_loaded | word | 0 | Set to 1 after load_talk_files() completes |

### Talk Data Structure (6 bytes each)

Two instances: attack at DS:0xCC8E, die at DS:0xCC94.

| Offset | Type | Description |
|--------|------|-------------|
| +0 | word | count — number of lines loaded |
| +2 | dword | far pointer to line pointer array (count × 4 bytes; each entry is a far ptr to a strdup'd string) |

### Functions

| File Offset | Name | Description |
|-------------|------|-------------|
| 0x17E49 | alloc_talk_struct | Allocates 6-byte talk struct via malloc(6), zeroes count |
| 0x17E8D | free_talk_data | Frees all strdup'd lines, the pointer array, and optionally the struct itself (flag param bit 0) |
| 0x17F09 | get_random_line | `get_random_line(talk_struct*)` → returns far ptr to a random line; if count==0, returns DS:0x0152 (empty string ""); selection: `lines[random(count)]` |
| 0x17F50 | load_talk_file | `load_talk_file(talk_struct*, filename)` — opens file with fopen(filename, "rt"); first pass counts lines via fgets(buf, 0x50, fp) + strips '\n' via strchr(buf, '\n'); allocates `count * 4` bytes for pointer array; second pass reads again and strdup's each line into the array; returns count or -1 on failure |
| 0x18107 | load_talk_files | Loads both files: `load_talk_file(&attack_talk, attack_filename)` then `load_talk_file(&die_talk, die_filename)`; sets talk_files_loaded=1 |
| 0x18155 | show_die_comment | Called when a tank is destroyed; if talk_files_loaded, calls load_talk_files first; calls `get_random_line(&die_talk)` → `display_talk_bubble(tank_ptr, line)` |
| 0x181A1 | show_attack_comment | Called when a tank fires; complex trigger logic (see below); calls `get_random_line(&attack_talk)` → `display_talk_bubble(tank_ptr, line)` |
| 0x182FD | display_talk_bubble | Renders bordered speech bubble: checks TALKING_TANKS!=0, TALK_PROBABILITY!=0, DS:0x50F0==0 (sound idle); rolls `random(100) < TALK_PROBABILITY`; measures text width via text_measure; positions bubble above tank (Y = tank.y - 19); clamps X to screen bounds; saves screen region via fg_getblock; draws border rectangle via draw_border (0x1826C); renders text via text_display; delays TALK_DELAY ticks; restores screen via fg_putblock |
| 0x18433 | talk_delay | Busy-waits for TALK_DELAY timer ticks using BIOS timer (int 1Ah / far call to timer) |
| 0x184A7 | CommentGenerator | Overlay entry point — calls alloc_talk_struct for both, loads files |
| 0x184E5 | free_all_talk | Calls free_talk_data for both attack (DS:0xCC8E) and die (DS:0xCC94) structs |

### Attack Comment Trigger Logic (show_attack_comment at 0x181A1)

```
show_attack_comment(tank_ptr):
    if tank_ptr == NULL:
        assertion_fail("comments.cpp", 143)   // DS:0x0265
        return
    if talk_files_loaded:
        load_talk_files()   // reload if needed
    if DS:0x5198 != 0:      // simultaneous/network mode
        goto skip_special
    if tank_ptr->alive == 0:
        goto skip_special
    if tank_ptr->target->alive == 0:  // target already dead
        goto skip_special
    // Special case: 2% chance of random player taunt
    if random(100) == 2:
        save TALKING_TANKS; set TALKING_TANKS=1
        pick random player from DS:0x012A table (10 entries)
        display_talk_bubble(random_player, random_attack_line)
        restore TALKING_TANKS
        return
skip_special:
    line = get_random_line(&attack_talk)
    if line[0] != '\0':
        display_talk_bubble(tank_ptr, line)
```

### File Format

Both `TALK1.CFG` and `TALK2.CFG` are plain text, one phrase per line, max 79 chars per line (fgets buffer = 0x50 = 80 bytes). Trailing newlines are stripped. Empty file = no taunts shown (count stays 0).

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

## Guidance System — extras.cpp (VERIFIED)

Guidance is checked per physics step at file 0x2263D. It uses a **single int16** in the player struct (+0x24), not a bitmask. Only one guidance type can be active per flight. The check is a cascading if-else that evaluates types in priority order.

### Per-Step Guidance Check (file 0x2263D)

```
if (player->guidance_type == 0) skip;

if (guidance_type == DS:D54E [Horz Guidance]):
  if (proj_target_Y == current_Y):
    correction = call 0x3bac:0x22c(Y, X, player_idx)
    if (correction != 0):
      guidance_type = 0  // consumed
      callback = 0x1E50:0x0C30
      wind_x = correction; wind_y = 0; fire_mode = 1

elif (guidance_type == DS:D550 [Vert Guidance]):
  if (proj_target_X == current_X):
    guidance_type = 0  // consumed
    callback = 0x1E50:0x099C
    wind_x = 0; wind_y = (target_Y > Y) ? -1 : +1; fire_mode = 1

elif (guidance_type == DS:D54A [Heat Guidance]):
  result = call 0x1E50:0x0001(X, Y)  // shark.cpp heat_seek
  if (result != 0):
    guidance_type = 0  // consumed
    callback = 0x1E50:0x099C
    wind_x = (target_X > X) ? -1 : +1
    wind_y = (target_Y > Y) ? -1 : +1
    fire_mode = 2
```

### Key Behaviors

- **Single-type**: Only one guidance type stored per flight (player struct +0x24)
- **One-shot**: guidance_type set to 0 when triggered — applies ONCE per flight
- **Trigger conditions**: Each type has a spatial condition that must be met before activating
- **Priority order**: Horz → Vert → Heat (cascading if-else, first match wins)
- **Callback installation**: When triggered, installs a far function pointer at +0x4C/+0x4E (segment 0x1E50 = shark.cpp), sets wind correction vector at +0x66/+0x68, and fire_mode at +0x6A
- **Bal Guidance override**: At fire_weapon 0x3070C, if weapon == DS:D54C (Bal Guidance), it is replaced with DS:D548 (Earth Disrupter). Bal Guidance is intentionally non-functional as a guidance mode.

### Heat Guidance — Trigger and Correction (VERIFIED)

**Trigger**: `ai_select_target` (file 0x24F01, aka 0x1E50:0x0001) is called each physics step. Iterates all tanks, computes Euclidean distance via `compute_distance` (file 0x2640F: `sqrt(dx²+dy²)` truncated to int). Threshold = **DS:0x5186 = 40 pixels** (NOT 60 as web port used). If any alive enemy is within 40 pixels → stores target ptr (+0x3E), target X/Y (+0x44/+0x46), returns 1.

**Wind vector sign** (overshoot detection, NOT correction direction):
- `wind_x = (target_X > current_X) ? -1 : +1` — **inverted** from direction to target
- `wind_y = (target_Y > current_Y) ? -1 : +1` — **inverted** from direction to target
- These are used ONLY for overshoot detection in the callback, NOT as velocity correction

**Callback** (0x1E50:099C = file 0x2589C, same as Vert guidance):
Called every physics step at file 0x21A85 via `call far [es:bx+0x4C]`. Per-step logic:
```
dx = (double)target_X - current_X_f64    // target minus current
dy = current_Y_f64 - (double)target_Y    // current minus target (reversed for screen Y)
distSq = dx * dx + dy * dy

// Overshoot check: sign(dx) matches sign(wind_x) OR sign(dy) opposes sign(wind_y)
overshot = false
if (wind_x != 0):
  if (dx < 0 && wind_x < 0) || (dx > 0 && wind_x > 0): overshot = true
if (wind_y != 0):
  if (dy < 0 && wind_y > 0) || (dy > 0 && wind_y < 0): overshot = true

if (overshot):
  if (fire_mode == 1):  // Vert: redirect to target
    call recalc_physics(); fire_at_position(X, Y); return 0
  else:                  // Heat (fire_mode==2): stop guidance
    callback = NULL      // clear +0x4C/+0x4E to 0
    return
else:
  if (distSq < DS:0x321C [0.001]):  return 1   // too close, skip correction
  correction = DS:0x3224 [10000.0] * DS:0xCEAC [dt] / sqrt(sqrt(distSq))
  vel_x += correction * dx
  vel_y += correction * dy
  return 1
```

**Key constants**:
| DS Offset | Value | Purpose |
|-----------|-------|---------|
| DS:0x5186 | 40 (int16) | Heat seek proximity threshold (pixels) |
| DS:0x321C | 0.001 (float64) | Min distSq for correction (skip if closer) |
| DS:0x3224 | 10000.0 (float32) | Guidance correction multiplier |
| DS:0xCEAC | runtime (float64) | Adaptive timestep dt (default 0.02) |

**Correction model**: Continuous attraction force toward stored target position. Magnitude = `10000.0 * dt * dist^(3/4)` (scales with distance via 4th-root normalization). Applied each physics step via callback until overshoot, then callback removed. This is fundamentally different from the web port's constant ±2.0 per step.

### DS Offset Cross-Reference

| DS Offset | Item |
|-----------|------|
| DS:0xD54A | Heat Guidance (weapon index) |
| DS:0xD54C | Bal Guidance (weapon index, overridden at fire) |
| DS:0xD54E | Horz Guidance (weapon index) |
| DS:0xD550 | Vert Guidance (weapon index) |
| DS:0x5186 | Heat seek distance threshold (40 pixels) |
| DS:0x321C | Min distSq threshold (0.001) |
| DS:0x3224 | Guidance correction multiplier (10000.0) |

### JS Implementation

The web port (`behaviors.js`) implements the EXE model:
- `selectGuidanceType()`: at fire time, picks highest-priority guidance (Horz > Vert > Heat), decrements ammo, returns type constant. Called from `game.js:fireWeapon()`.
- `applyGuidance()`: per-step check with spatial trigger conditions. Heat guidance uses continuous attraction force model matching EXE callback: `correction = GUIDANCE_K * dt / distSq^(1/4)`, applied per step until overshoot.

**Intermediate files**: Plan transcript from laser/MAYHEM investigation session.

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
| 4 | **Desert/Lava** | 3-segment FPU gradient from (63,63,0) | Yellow (63,58,2) → red (63,20,20) → blue (29,29,63) → indigo (11,11,34) |
| 5 | **Castle** | Same 3-band FPU gradient as Type 4 | Yellow → red → blue → indigo (shares 0x39C31 handler) |
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

### Desert/Lava Gradient Detail (Type 4 / Sunset)

VGA 120 set separately: `set_sky_palette_entry(120, 63, 63, 0, 1)` → **(63, 63, 0)** bright yellow.

Three FPU-interpolated loops over VGA 121–149 (29 entries, 10+10+9):

```
t2 = (9-di)/10, t1 = 1-t2 = (1+di)/10, _ftol = truncate toward zero

Loop 1 (di=0..9): VGA 121–130, warm gold → red-brown
  R = ftol(t2*63 + t1*63) = 63 constant
  G = ftol(t2*63 + t1*20) = 58→20
  B = ftol(t1*20)          = 2→20

Loop 2 (di=0..9): VGA 131–140, red → blue-purple
  R = ftol(t2*63 + t1*29) = 59→29
  G = ftol(t2*20 + t1*29) = 20→29
  B = ftol(t2*20 + t1*63) = 24→63

Loop 3 (di=0..8): VGA 141–149, blue-purple → dark indigo
  R = G = ftol(t2*29 + t1*9)  = 27→11
  B     = ftol(t2*63 + t1*31) = 59→34
```

Full table (exact values via rational arithmetic matching x87 _ftol truncation):

| VGA | R  | G  | B  | VGA | R  | G  | B  | VGA | R  | G  | B  |
|-----|----|----|-----|-----|----|----|-----|-----|----|----|----|
| 120 | 63 | 63 |  0 | 131 | 59 | 20 | 24 | 141 | 27 | 27 | 59 |
| 121 | 63 | 58 |  2 | 132 | 56 | 21 | 28 | 142 | 25 | 25 | 56 |
| 122 | 63 | 54 |  4 | 133 | 52 | 22 | 32 | 143 | 23 | 23 | 53 |
| 123 | 63 | 50 |  6 | 134 | 49 | 23 | 37 | 144 | 21 | 21 | 50 |
| 124 | 63 | 45 |  8 | 135 | 46 | 24 | 41 | 145 | 19 | 19 | 47 |
| 125 | 63 | 41 | 10 | 136 | 42 | 25 | 45 | 146 | 17 | 17 | 43 |
| 126 | 63 | 37 | 12 | 137 | 39 | 26 | 50 | 147 | 15 | 15 | 40 |
| 127 | 63 | 32 | 14 | 138 | 35 | 27 | 54 | 148 | 13 | 13 | 37 |
| 128 | 63 | 28 | 16 | 139 | 32 | 28 | 58 | 149 | 11 | 11 | 34 |
| 129 | 63 | 24 | 18 | 140 | 29 | 29 | 63 |     |    |    |    |
| 130 | 63 | 20 | 20 |     |    |    |    |     |    |    |    |

After loops: `fg_setdacs(121, 29)` uploads palette buffer to VGA DAC 121–149.

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

| Index | Name | Menu Dialog Handler | Notes |
|-------|------|----------------|-------|
| 0 | Plain | file 0x3E700 | Flat terrain, basic sky gradient |
| 1 | Shaded | file 0x4758B | Simple terrain, gentle shading |
| 2 | Stars | file 0x4726B | Star-based sky palette |
| 3 | Storm | file 0x42103 | Storm sky effects |
| 4 | Sunset | file 0x3F587 | Sunset gradient sky |
| 5 | Cavern | file 0x44BDD | Mountain .mtn terrain (DS:0x50D8=1) |
| 6 | Black | file 0x3E700 | Underground visual mode (same terrain as Plain) |
| 7 | Random | (runtime) | Randomizes to 0-5 via `random(6)`, re-rolls if 5 (Cavern) and no .mtn files |

**VERIFIED from name table init (file 0x3AEA0)**: The 8-entry string table at DS:0x621C is initialized from source far pointers: DS:0x22FC→"Plain", DS:0x2300→"Shaded", DS:0x2304→"Stars", DS:0x2308→"Storm", DS:0x230C→"Sunset", DS:0x2404→"Cavern", DS:0x2310→"Black", DS:0x20DC→"Random". Config key: `SKY\0` at DS:0x0454, format `SKY=%s\n` at DS:0x08F8.

**NOTE**: The "handler" addresses listed above are **menu dialog handlers** (segment 0x34ED, the menu module) that render sky selection UI options — they are NOT sky palette initialization functions. Sky palette setup is scattered across several modules.

**Random resolution** (file 0x3978E): `push 6; call random` → result 0-5 stored in DS:0x5110. If result is 5 (Cavern) and DS:0x621A==0 (no .mtn files), loops back to re-roll. Black (6) is never selected by Random.

### Key Data Locations

| Item | Location |
|------|----------|
| Sky type variable | DS:0x5110 |
| Sky name table | DS:0x621C (8 far ptrs, init at file 0x3AEA0 from source ptrs DS:0x22FC–0x20DC) |
| Config key string | DS:0x0454 (`SKY\0`), format DS:0x08F8 (`SKY=%s\n`) |
| Max sky type | DS:0x624E (value 7 = "Random") |
| Mountain mode flag | DS:0x50D8 (1 when type 5) |
| Mountain files available | DS:0x621A (0 = no .mtn files) |
| Random land flag | DS:0x623C |
| Terrain jump table | file 0x3A118 (cs:0x0A18, 7 word entries) |
| Terrain generation | file 0x3971F (main function in ranges.cpp) |
| Sky gradient base index | DS:0x6E2A (set to 0x50=80; stored by `call far 0x3EA1:0x028F` = file 0x4569F) |
| Sky palette rendering | file 0x285A7 (player color + black sky check for type 6) |
| Black sky ceiling | file 0x3A0A9 (sets VGA 0–104 and VGA 110–149 all black) |

### Sky Palette Architecture (VERIFIED from disassembly)

The sky gradient occupies **VGA 80–104** (25 entries). The base index 80 is stored at DS:0x6E2A and used as the drawing color for terrain border rendering in ranges.cpp and extras.cpp (calls to `[DS:0xEF0C]` draw_hline and `[DS:0xEF10]` draw_vline).

**VGA Palette Ranges (confirmed):**
- VGA 0–79: Player tank colors (10 players × 8 entries; set by `fg_setdacs(start=0, count=80)` at file 0x28676)
- VGA 80–104: Sky gradient (25 entries; base = DS:0x6E2A = 80)
- VGA 110–149: Combined terrain+sky ceiling gradient (40 entries: 10 sky + 30 terrain); uploaded via `fg_setdacs(start=110, count=40)` at file 0x3A0F3 (Black sky context)
- VGA 120–149: Terrain palette (30 entries); uploaded via `fg_setdacs(start=120, count=30)` in ranges.cpp

**Black Sky (type 6) — ceiling palette init** at file 0x3A0A9:
- If `[bp+6] != 0`: reads DS:0xDEA8 table (stride 3: R, G, B per entry), uploads 40 entries to VGA 110; then reads DS:0xDD5E table, uploads 105 entries via `fg_setdacs(start=0, count=105)` — all black
- If `[bp+6] == 0`: fills 40 entries all (0,0,0) → `fg_setdacs(start=110, count=40)`; then fills si=40..104 all black → `fg_setdacs(start=0, count=105)`

**Player palette init** at file 0x28592 (icons.cpp): loops si=0..79, for each:
- If sky_type == 6 (Black): setrgb(si, 0, 0, 0)
- If si%8 == 5: setrgb(si, 63, 63, 63) — white highlight/star slot
- If si%8 == 7: setrgb(si, 30, 30, 30) — grey shadow slot
- Otherwise: setrgb(si, tank[si/8].R, tank[si/8].G, tank[si/8].B) — player color
Then: `fg_setdacs(start=0, count=80)` uploads to VGA 0–79.

**Sunset sky gradient direction** (verified from v86 screenshot): **cool-blue/indigo at TOP → warm-orange/red at BOTTOM**. Web port was previously reversed (warm→cool). Fixed in web/js/palette.js.

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

### Sun/Planet Rendering — **RESOLVED: No Explicit Sun Circle**

**Investigation**: v86 screenshots show a bright circle resembling a "sun" in the Sunset terrain preview. Traced the full Sunset (type 4) case handler and all Fastgraph circle/ellipse calls in the EXE.

**Finding**: There is NO explicit sun/circle drawing call for the Sunset sky type. The "sun" appearance is an optical illusion created by the warm palette gradient (bright yellow-gold at the horizon fading to dark indigo at the top) visible in the gap between terrain mountain silhouettes. The large centered mountain in Sunset mode frames this gradient, making the bright horizon region look like a sun disc.

**Evidence**:
- Fastgraph circle functions identified: `fg_circlef` (3F19:1951, 1 caller at file 0x276CE), `fg_ellipsef` (3F19:3781, 3 callers), `fg_circle` (3F19:3D91, 2 callers) — NONE called from terrain generation or sky palette code paths
- The Sunset case handler (file 0x39C31) only sets palette entries and generates terrain height; no drawing primitives

#### Sunset Palette Interpolation (Case 4, file 0x39C31)

Entry condition: `DS:0x624A == 1` (sunset available flag); falls back to type 0 (Plain) if not set.

**VGA 120** = (63, 63, 0) — bright yellow, set via `set_sky_palette_entry(120, 63, 63, 0, 1)` at file 0x3A046.

Three FPU-interpolated gradient segments of 10 entries each, using float32 constants:

| DS Offset | Value | Role |
|-----------|-------|------|
| DS:0x6258 | 9.0 | R interpolation divisor |
| DS:0x625C | 10.0 | loop count (10 entries per segment) |
| DS:0x6260 | 20.0 | G/B base offset |
| DS:0x6264 | 63.0 | max component value |
| DS:0x6268 | 29.0 | loop 2 R/G end, loop 3 R/G source |
| DS:0x626C | 31.0 | loop 3 B end |
| DS:0x6270 | 45.0 | unused in palette loops |

Computed palette (VGA 121–149, 29 entries mapped to sky rows bottom→top):

| VGA Range | Gradient | RGB Start → End |
|-----------|----------|-----------------|
| 121–130 | Warm gold → red-brown | (63,58,2) → (63,20,20) |
| 131–140 | Red → blue-purple | (59,20,24) → (29,29,63) |
| 141–149 | Blue-purple → dark indigo | (27,27,59) → (11,11,34) |

See "Desert/Lava Gradient Detail (Type 4 / Sunset)" above for full per-entry table.

**Sky row mapping**: `color[row] = (bottom - row) * 28 / height + 121` — row 0 (bottom) = VGA 149 (dark indigo), row max (top) = VGA 121 (warm gold). Wait — actually bottom=warm, top=cool: the formula maps bottom rows to higher VGA indices (warm colors) and top rows to lower VGA indices (cool/dark). This matches the verified sunset gradient direction (cool top → warm bottom).

**Sunset terrain**: Large centered mountain via `mountain_gen(width/2, bottom-5, width/3, shape=109, seed=0x32C2)`.

#### Sky Type Case Handlers (Sequential Disassembly)

All 7 case handlers identified by sequential disassembly from file 0x39956. Each ends with `jmp 0x3A01C` (switch exit). The jump table at cs:0x0A18 (file 0x39198) could not be decoded directly due to a relocation entry at file 0x3919F overlapping the table data.

| Case | Sky Type | Handler Start | Summary |
|------|----------|--------------|---------|
| 0 | Normal | 0x39956 | VGA 120 = dark blue (9,9,31) |
| 1 | Plain | 0x39969 | Blue gradient loop, VGA 121–149 |
| 2 | DalSky | 0x399C1 | Complex: bitmap loading + palette |
| 3 | Random | 0x39AEF | Random terrain with FPU palette |
| 4 | Sunset | 0x39C31 | FPU-interpolated warm gradient (see above) |
| 5 | Cavern | 0x39E6A | V-shaped terrain (uses .mtn files) |
| 6 | Black | 0x39F30 | All-black sky with red terrain gradient |

#### Gradient Helper Function (file 0x3A046)

`set_sky_palette_entry(vga_idx, r, g, b, immediate_flag)` — stores RGB at `DS:0xDD5E + idx*3`, then if `immediate_flag != 0` calls `fg_setrgb(idx, r, g, b)` immediately.

**Correction**: `DS:0xEF08` is NOT `fg_setcolor` (1 arg) as previously assumed — it is `fg_setrgb` with 4 args (index, r, g, b), confirmed by 8-byte stack cleanup (`add sp, 8`) at multiple call sites.

**Intermediate files**: `disasm/read_sky_dispatch.py`, `disasm/find_fg_ellipse.py`, `disasm/read_sunset_floats.py`, `disasm/find_sky_table.py`

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

### Sell Equipment — Refund Price Formula (file 0x37955, VERIFIED)

Function `compute_sell_refund` at file 0x37955 (seg 0x2CBF:0x4365):

```
// DS:0x613C = 0.8 (float64, normal sell factor)
// DS:0x6144 = 0.65 (float64, free market sell factor)
// DS:0x514A = FREE_MARKET config toggle

if (FREE_MARKET != 0) {
    DS:0x613C = DS:0x6144;   // overwrite: 0.8 → 0.65 for session
}
gross = qty × weapon_price;               // 32-bit multiply (call far 0x17A6)
refund = floor(gross × DS:0x613C / weapon_bundle);  // FPU: fild, fmul, fild, fdivp, _ftol
return refund;
```

| Constant | DS Offset | File Offset | Value | Purpose |
|----------|-----------|-------------|-------|---------|
| SELL_FACTOR | DS:0x613C | 0x5BEBC | 0.8 (float64) | Normal sell refund = 80% of per-unit price |
| SELL_FACTOR_MKT | DS:0x6144 | 0x5BEC4 | 0.65 (float64) | Free Market sell refund = 65% of per-unit price |

**Web port**: Fixed in `web/js/shop.js` — sell factor changed from 0.5 to `config.freeMarket ? 0.65 : 0.8`. Config toggle `freeMarket` added to `web/js/config.js` (DS:0x514A, default Off). Menu toggle added to Economics sub-dialog in `web/js/menu.js`.

**Intermediate files**: `disasm/cavern_shop_analysis.txt`

### Shop Palette Animation (file 0x14E34, VERIFIED)

Function `palette_tick` at file 0x14E34 (seg 0x0DBC:0x0874). Called as a shop dialog callback. Uses frame counter at DS:0x00EC (0..100, wrapping). Three animation effects:

**Part 1: VGA 2 — Pulsing Red/Orange** (every frame)
```
counter = ++DS:0x00EC
if counter > 100: counter = 0
tri = (counter < 50) ? counter : (100 - counter)   // triangle wave 0→50→0
R = tri * 63 / 50    // 0→63→0 (full red pulse)
G = tri * 10 / 50    // 0→10→0 (orange tint)
B = 0
fg_setrgb(2, R, G, B)
```

**Part 2: VGA 8-11 — Accent Color Cycling** (every 8 frames)
```
if (counter & 7) != 0: skip
si = ((counter >> 3) & 3) + 1    // cycles 1,2,3,4
for palette_idx in [8, 9, 10, 11]:
    fg_setrgb(palette_idx, accent[si].R, accent[si].G, accent[si].B)
    si++; if si > 4: si = 1      // wraps to entry 1, never uses entry 0
```
Uses accent table entries 1-4 only (orange, magenta, dark red, deep pink). Entry 0 (bright red) is reserved for sparkle animation at file 0x24894.

**Part 3: VGA 14-18 — Gray Gradient Cycling** (every frame, changes every 2)
```
si = (counter / 2) % 5 + 14     // starting VGA index: 14..18
for gray in [0, 15, 30, 45, 60]:
    fg_setrgb(si, gray, gray, gray)
    si++; if si > 18: si = 14    // wraps within 14-18
```

**Accent Color Table** at DS:0x1F62 (5 entries × 6 bytes = 3 uint16 R,G,B per entry):

| Index | R | G | B | 8-bit RGB | Name | Used By |
|:-----:|:--:|:--:|:--:|:---------:|------|---------|
| 0 | 63 | 0 | 0 | (255,0,0) | Bright red | Sparkle animation only |
| 1 | 63 | 32 | 10 | (255,130,40) | Orange | Accent cycling |
| 2 | 63 | 0 | 63 | (255,0,255) | Magenta | Accent cycling |
| 3 | 63 | 12 | 12 | (255,49,49) | Dark red | Accent cycling |
| 4 | 63 | 0 | 30 | (255,0,121) | Deep pink | Accent cycling |

**Web port**: Fixed in `web/js/palette.js`. Corrections: (1) accent cycling now uses entries 1-4 with 4-step modulo (was using all 5 entries with 5-step modulo); (2) added pulsing VGA 2 red/orange triangle wave; (3) added gray gradient cycling on VGA 14-18. Save/restore expanded to cover VGA 2, 8-11, and 14-18.

---

## SCORCH.PCX Background Image (VERIFIED from disassembly)

### Overview

SCORCH.PCX is an **optional user-provided** PCX background image that can be displayed during gameplay by pressing the **'B' key** (scancode 0x30). The file is NOT shipped with the game distribution — it is a customization feature allowing players to provide their own full-screen backdrop.

### Loading Code — play.cpp

The PCX display is triggered via the play loop's keyboard/click switch table at file 0x2FB6B (CS:0x05DB in segment 0x28B9). Action code 0x30 (scancode for 'B') dispatches to CS:0x0550 (file 0x2FAE0):

```
; Play loop switch case for 'B' key (scancode 0x30)
; CS:0x0550 (file 0x2FAE0)
push ds
push 0x575C              ; far ptr to "scorch.pcx" (DS:0x575C)
call far fg_pcxopen      ; 0x480A:0x0009 — returns file handle in AX
push ax                  ; file handle
push 0x00                ; page 0
call far fg_pcxhead      ; 0x480A:0x0004 — read PCX header
push ax                  ; width/status
push 0x00                ; page 0
call far fg_pcximage     ; 0x4847:0x0002 — display PCX on screen
add sp, 0x0C             ; clean up 12 bytes (6 pushes × 2)
jmp common_exit          ; return to play loop
```

### Key Details

| Property | Value |
|----------|-------|
| Filename string | DS:0x575C = "scorch.pcx" |
| Trigger | 'B' key (scancode 0x30) during gameplay turn |
| Switch table entry | Index 46 at CS:0x05DB (file 0x2FB6B), value CS:0x0550 |
| Code location | File 0x2FAE0–0x2FAFB (CS:0x0550–0x056B) |
| Fastgraph calls | fg_pcxopen (0x480A:0x0009), fg_pcxhead (0x480A:0x0004), fg_pcximage (0x4847:0x0002) |
| Error handling | **None** — no check on fg_pcxopen return value; if file missing, behavior undefined |
| References | **1 total** — only play.cpp at file 0x2FAE0 |
| File present | **No** — not in earth/ directory, not shipped with game |

### Clarification: DS:0x5188 is NOT related

The task description noted "conditional on DS:0x5188 != 0" but this is incorrect. DS:0x5188 is the **PLAY_MODE** variable (0=Sequential, 1=Simultaneous, 2=Synchronous), already documented in the Play Modes section. The code at file 0x2FAD1 that checks DS:0x5188 is a **separate switch case** (action 0x28) adjacent to but independent from the PCX loading block. The PCX block at 0x2FADF is only reachable via the switch table dispatch for action 0x30.

### Web Port Impact

No action needed — SCORCH.PCX is an optional customization file that was never part of the standard game content. The web port does not need to support this feature. The file should NOT be added to v86/images/game.img.

---

## SCORCH.MKT Market File Format (VERIFIED from disassembly)

### Overview

SCORCH.MKT is a persistent binary file storing the arms market state. It implements a **dynamic pricing economy** where weapon prices fluctuate based on player purchasing behavior. The system is gated by the "Free Market" config toggle (DS:0x514A). When disabled, all weapons use their static base prices.

- **File size**: 1060 bytes (4-byte header + 48 × 22-byte records)
- **Load function**: `mkt_load` at file 0x2B873 (icons.cpp segment)
- **Save function**: `mkt_save` at file 0x2BA52 (deletes then recreates with mode "ab")
- **Default init**: `mkt_init_defaults` at file 0x2B80A (sets market cost = base price, EMAs = 0.1)
- **Per-round update**: `mkt_update` at file 0x2BB5E

### Binary File Layout

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 2 | uint16 | Version (must equal 2) |
| 2 | 2 | uint16 | Weapon count (must match DS:0x1BB6 = 48) |
| 4 | 22×48 | records | Per-weapon market data (1056 bytes) |

### Per-Weapon Record (22 bytes)

| Record Offset | Size | Type | Weapon Struct Offset | Field |
|---------------|------|------|---------------------|-------|
| 0 | 4 | int32 | +0x1A | `mkt_cost` — current market price (replaces base Price at +0x04) |
| 4 | 2 | int16 | +0x22 | `unsold_rounds` — consecutive rounds with zero sales |
| 6 | 8 | float64 | +0x24 | `price_signal` — EMA of squared price ratio (measures "expensiveness") |
| 14 | 8 | float64 | +0x2C | `demand_avg` — EMA of normalized sales rate per player |

### Extended Weapon Struct Fields (+0x18 to +0x33)

These fields within the weapon struct's "Additional fields" region are used exclusively by the market system:

| Struct Offset | Size | Type | Stored in MKT? | Field |
|---------------|------|------|----------------|-------|
| +0x1A | 4 | int32 | Yes | `mkt_cost` — current market price (dword) |
| +0x1E | 2 | int16 | No | `sold_qty` — units sold this round (reset to 0 after each update) |
| +0x20 | 2 | int16 | No | `purchasable` — flag (0=not in economy, 1=available for purchase) |
| +0x22 | 2 | int16 | Yes | `unsold_rounds` — rounds since last sale |
| +0x24 | 8 | float64 | Yes | `price_signal` — expensiveness EMA |
| +0x2C | 8 | float64 | Yes | `demand_avg` — demand EMA |

### Market Constants

| DS Offset | Type | Value | Name |
|-----------|------|-------|------|
| DS:0x514A | word | 0/1 | `FREE_MARKET` — config toggle |
| DS:0x5260 | float64 | 0.7 | `MKT_ALPHA` — EMA smoothing factor |
| DS:0x5268 | float64 | 0.1 | `MKT_INIT` — default init value for EMAs; also minimum price ratio |
| DS:0x5298 | float32 | 10.0 | `MKT_SIGNAL_DIV` — price signal divisor |
| DS:0x5190 | float64 | 0.05 | `MKT_SENSITIVITY` — price adjustment multiplier |
| DS:0x50D4 | word | (runtime) | `NUM_PLAYERS` — denominator for demand normalization |
| DS:0x1BB6 | word | 48 | `WEAPON_COUNT` — total weapons in economy |

### Price Validation (on MKT load)

When loading from file, each weapon's `mkt_cost` is validated against its base price:
- **Minimum**: `base_cost × 0.1` (10% of base — floor at DS:0x5268)
- **Maximum**: `base_cost × 100` (10000% of base)
- If out of range, `mkt_cost` is clamped to `base_cost` (reset to default)

### Market Update Algorithm (per round)

```c
// Called at end of each round when FREE_MARKET enabled
void mkt_update() {
    const double alpha = 0.7;          // DS:0x5260
    const double sensitivity = 0.05;   // DS:0x5190
    const float signal_div = 10.0;     // DS:0x5298

    for (int i = 0; i < WEAPON_COUNT; i++) {
        if (weapon[i].purchasable == 0) continue;

        // Track unsold duration
        if (weapon[i].sold_qty == 0)
            weapon[i].unsold_rounds++;
        else
            weapon[i].unsold_rounds = 0;

        // Update demand EMA (normalized by player count)
        weapon[i].demand_avg = weapon[i].demand_avg * alpha
            + weapon[i].sold_qty * (1 - alpha) / NUM_PLAYERS;

        // Update price signal EMA (tracks squared price ratio)
        double price_ratio = (double)weapon[i].mkt_cost / (double)weapon[i].base_cost;
        double signal_update = price_ratio * price_ratio * (1 - alpha) / signal_div;
        weapon[i].price_signal = weapon[i].price_signal * alpha + signal_update;

        // Adjust market price
        //   demand > signal → price rises  (popular weapon, underpriceed)
        //   demand < signal → price falls  (unpopular weapon, overpriced)
        double factor = 1.0 + (weapon[i].demand_avg - weapon[i].price_signal) * sensitivity;
        weapon[i].mkt_cost = (int32_t)((double)weapon[i].mkt_cost * factor);

        // Reset per-round purchase counter
        weapon[i].sold_qty = 0;
    }
}
```

### Purchase Tracking

The buy function at file 0x14924 increments `weapon[i].sold_qty` (field +0x1E) at file 0x14A2A (`inc [bx+0x1214]`) each time a player purchases a weapon. This is the demand signal consumed by `mkt_update`.

### Web Port Impact

The free market system is a complete economic simulation. Web port implementation:
- ~~Add `FREE_MARKET` toggle to config~~ — DONE (`config.freeMarket` in config.js + menu.js Economics)
- ~~Use `mkt_cost` for shop prices when enabled (fall back to base price when disabled)~~ — DONE (`getWeaponPrice()` in shop.js)
- ~~Call `mkt_update()` at end of each round~~ — DONE (game.js ROUND_OVER→SHOP transition)
- ~~Initialize EMAs to 0.1 and prices to base prices on first run~~ — DONE (`initMarket()` in game.js `initGameRound()`)
- Persist market state to localStorage (optional — EXE uses SCORCH.MKT file persistence across game sessions)

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
| **`fpu_decode.py`** | **Borland INT 34h-3Dh FPU instruction decoder script (legacy — uses ndisasm)** |
| **`instruction_set_x86.py`** | **Complete x86 16-bit + FPU decoder, no external deps** |
| **`dis.py`** | **Primary disassembler: file/DS/SEG:OFF addr, loads labels.csv+comments.csv** |
| **`labels.csv`** | **Knowledge base: file_offset→name and DS:offset→name** |
| **`comments.csv`** | **Knowledge base: per-address inline annotations** |
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

14. ~~**Napalm/fire particle system**~~ — **RESOLVED**. 99-slot particle pool (6-byte structs), negative param = dirt mode (brown 0x50 vs fire 0xFE), max 20 simultaneous particles, **pixel-walking cellular automaton** (NOT velocity-based — previous "0.7x dampening" claim was incorrect; DS:0x1D60=0.7 is explosion damage falloff), circular allocation with recycling. See "Weapon Behavior Dispatch" section.

15. ~~**Roller physics**~~ — **RESOLVED**. Two-phase: impact handler scans terrain left/right for deeper valley to determine roll direction, then spawns rolling projectile with per-frame terrain-follower callback. Gravity acceleration increases speed. Supports all wall types. Terrain threshold = pixel >= 0x69. See "Weapon Behavior Dispatch" section.

16. ~~**MIRV split mechanics**~~ — **RESOLVED**. Apogee detected via velocity sign flip (stored last_sign at +0x66/+0x68). At split: **5 sub-warheads** (MIRV, param=0) or **9** (Death's Head, param=1) — confirmed from spawn function DS:0x52A2 table (file 0x2CB6B). Damage = (radius-dist)*100/radius, capped at 110. Sub-warhead radii: 20 (MIRV) / 35 (Death's Head) from DS:0x529E. Spread is pure horizontal vx offset, no angle math. See "Weapon Behavior Dispatch" section.

17. ~~**Laser/beam weapons**~~ — **RESOLVED**. Laser and Plasma Laser are ACCESSORIES (not fireable beam weapons). They provide a visual "laser sight" targeting line during aiming — Laser draws green (0x78), Plasma Laser draws white (0xFE). Both have NULL behavior function pointers (0:0). Targeting line at file 0x36321 uses Bresenham with per-pixel callback (0x2F76:0x0111). BhvType/BhvSub are far function pointers (offset:segment), not type codes. See `disasm/laser_weapons_analysis.txt`.

### LOW PRIORITY

18. ~~**Cheat codes**~~ — **RESOLVED**. All 5 cheat/debug codes fully traced. ASGARD=frondheim (MDA debug overlay), ASGARD=ragnarok (file debug log), mayhem (all weapons x99), nofloat (disable FPU physics), player name selection. See "Cheat Codes" section above.

19. ~~**Tosser/Unknown/Sentient AI details**~~ — **RESOLVED**. Tosser is functional (noise=[63,23]). Unknown (type 7) and Cyborg (type 6) randomize to 0-5 at runtime via dispatch at 0x292A5. Sentient (type 8) has **corrupted vtable** — pointer table at DS:0x02E2 has only 7 valid entries; Sentient's entry at DS:0x0302 reads ASCII string "Some dumb tank: %s\n" as a far pointer (656D:6420), producing a wild pointer crash. Confirmed non-functional in v1.50. See "Sentient AI" section below.

20. ~~**Cavern terrain mode**~~ — **RESOLVED**. "Cavern" is sky type 5 (DS:0x5110), which uses mountain .mtn terrain generation — NOT ceiling+floor. The underground visual effect (black sky, dark palette, skip flash/fade) is triggered by sky type 6 ("Black"), not "Cavern". DS:0x5110 controls both sky palette and terrain shape via 7-entry jump table at file 0x3A118. 8 sky modes: Plain(0), Shaded(1), Stars(2), Storm(3), Sunset(4), Cavern(5), Black(6), Random(7). Name table at DS:0x621C initialized at file 0x3AEA0. See `disasm/cavern_shop_analysis.txt`.

21. ~~**Score system**~~ — **RESOLVED**. score.cpp at segment 0x30B2 (file base 0x37520). All three scoring modes traced: Standard, Corporate, and Vicious share the same per-damage and per-death formulas. Standard and Corporate include end-of-round survival pool bonuses; Vicious does not. Corporate mode hides scores during play. Per-weapon-damage: attacker gets +30x (enemy) or -15x (friendly fire). Per-shield-damage: +2x (enemy) or -1x (friendly). Kill bonuses: +500/+4000 (enemy), -2000 (teammate), -1500 (self). End-of-round pool: based on surviving players' max_power and shield_energy. See `disasm/score_system_analysis.txt` and "Score System" section below.

22. ~~**Equip.cpp shop system**~~ — **RESOLVED**. Equipment init at file 0x1D5D4 maps 16 category boundaries via `findWeaponByName()` to DS:0xD546-0xD566 (Smoke Tracer through Super Mag). Shop UI at file 0x1DBB5 dispatches through 12-case jump table (file 0x1DF4D) with random action selection for AI. Items enabled/disabled by 6 config flags: free market (DS:0x50FE), scoring mode (DS:0x5158), triggers (DS:0x513A), useless items (DS:0x5168), parachute (DS:0x5162), play mode (DS:0x5188). Arms level (DS:0x518A) gates item tiers 0-4. See `disasm/cavern_shop_analysis.txt`.

23. ~~**Sound system**~~ — **RESOLVED**. PC Speaker via Fastgraph 4.02. DS:0xEF46 = device type (0=off, 1=speaker). Hardware primitives at file 0x010C81 (fg_sound_on, PIT divisor = 1193277/freq_hz, ports 0x42/0x43/0x61) and 0x010CB1 (fg_sound_off). Game calls: explosion=rising 1000→10000 Hz sweep (extras.cpp 0x21267), impact=random freq per frame (0x247BA), terrain-hit=+200 Hz per pixel (0x24DCD), shield-hit=random freq (shields.cpp 0x3AF33), flight=velocity-based PIT divisor (play.cpp 0x31663), turn-change=100 clicks (0x30991), terrain-gen=click ping (ranges.cpp 0x35D41). See "PC Speaker Sound System" section.

25. ~~**Main menu rendering**~~ — **RESOLVED**. Menu module at segment 0x34ED (file 0x3B8D0), no .cpp debug string. Main function at 0x3D140. Dialog system library at 0x3F19. Resolution-adaptive layout: row height 25/17px, font 0/1. Title uses 5-layer 3D emboss. 3D box drawing at 0x444BB (Windows 3.1-style bevels). String pointer table at DS:0x20C8. See "Main Menu Rendering Code" section.

26. ~~**Graphics mode initialization**~~ — **RESOLVED**. Mode table at DS:0x6B66, 9 entries of 68 bytes with FG mode number, aspect ratio, and 11-slot function dispatch table. Config parsing at 0x195F6, mode detection at 0x451E1, init at 0x45413. 360x480 custom Mode X: dual mode set (12h→13h) + 17 CRTC register pairs from DS:0x6840. SVGA uses fg_testmode + VESA VBE. See "Graphics/Video Mode System" section.

27. ~~**Mouse/joystick wrapper functions**~~ — **RESOLVED**. No direct INT 33h calls in game code — all 3 `cd 33` byte matches (0x9D18, 0x130B2, 0x1C1C2) are false positives spanning instruction boundaries. Mouse is accessed entirely through Fastgraph V4.02's mouse API (fg_mouseini, fg_mousepos, etc.), which internally calls INT 33h. Input mode at DS:0x5030 (0=keyboard, 1=mouse/buffered, 2=joystick/direct). MOUSE_RATE (DS:0x6BF8) = 0.50 default (IEEE double), scales mouse delta to angle/power. Click regions: 12-byte structs at DS:0x56AE with dynamic count at DS:0xEA10 (4 or 11 entries). Menu dialog system at seg 0x3F19 handles pointer via DS:0x5148. See "Mouse/Pointer System" section below.

24. ~~**Simultaneous/Synchronous play modes**~~ — **RESOLVED**. Play mode variable at DS:0x5188 (0=Sequential, 1=Simultaneous, 2=Synchronous). 36 code references across binary. Sequential: one-at-a-time turns with full display updates. Simultaneous: all aim at once, fire callbacks cleared (player +0xAE/+0xB0 = NULL), timer-controlled, projectile screen-wrapping enabled. Synchronous: sequential aiming + simultaneous firing. See "Play Modes" section below.

---

## Next Tasks

### RE Investigation

- [x] Trace sky palette init for all 6 sky types: investigated code at 0x285A7, 0x3A0A9, 0x3A182, ranges.cpp fg_setdacs calls. **Key finding**: the handler addresses (0x3E700, 0x4758B, etc.) are menu dialog renderers (segment 0x34ED), NOT palette init functions. Sky gradient base = DS:0x6E2A = 80 (VGA 80). Sky gradient VGA 80–104 (25 entries). Player colors VGA 0–79 set by icons.cpp:0x28592. Black sky ceiling init at 0x3A0A9 (sets VGA 0–104 and 110–149 all black). Exact per-entry RGB for all types not recoverable from static analysis (runtime-computed). **Sunset gradient direction confirmed reversed in web port**: EXE goes cool-blue/indigo at top → warm-orange at bottom; web port was reversed. Fixed in web/js/palette.js: r=28+t×35, g=5+t×15, b=50-t×40 (i=0=top=cool, i=23=bottom=warm). See "Sky Palette Architecture" subsection in Sky/Landscape Mode System section.
- [x] Decode .MTN mountain bitmap format and terrain compositing: **RESOLVED**. Format fully decoded by `disasm/decode_mtn.py` (9/10 files verified). 72-byte header (16b core + 8b unknown + 48b palette). Fields: magic=`MT\xBE\xEF`, version=0x0100, h=rows_per_column (419–1483), x_start/x_end=encoded column range, n_colors=16, palette=16×RGB888 at byte 24. Pixel data at byte 72: **PCX-RLE nibble-packed 4bpp, column-major**. Index 0=(255,255,255)=sky, indices 1–15=terrain. Terrain height at column x = first non-zero pixel row from the top (row 0=top of image). Files contain TWO consecutive PCX-RLE blocks (block2 purpose unknown, possibly background layer). MTN_PERCENT is a **selection probability** (binary choice: scanned vs. procedural), not a visual blend. Sky type jump table at file 0x39198 (CS:0x0A18 in seg 0x31D8) dispatches terrain handlers per sky type; type 5 (Cavern) handler at file 0x3F146. Descriptor table at DS:0x5F04 (8 bytes/entry: 4-byte far ptr to filename + 4-byte file_size). Reference parser: https://github.com/zsennenga/scorched-earth-mountain. See "MTN Terrain File Format" section for full spec.
- [x] Trace sun/planet rendering: **RESOLVED — No explicit sun circle**. The "sun" in Sunset mode is an optical illusion from the warm palette gradient visible between terrain silhouettes. No Fastgraph circle/ellipse calls originate from terrain gen or sky palette code. Sunset case handler (file 0x39C31) only sets palette entries (VGA 120–149) and generates terrain height. Full sunset palette interpolation documented (3 gradient segments of 10 entries, FPU-computed from float32 constants at DS:0x6258–0x6270). See "Sun/Planet Rendering" subsection in Sky/Landscape Mode System section.
- [x] Decode SCORCH.MKT binary format: **RESOLVED**. 1060-byte file = 4-byte header (version=2, count=48) + 48×22-byte records. Per-weapon record: int32 mkt_cost (weapon+0x1A), int16 unsold_rounds (+0x22), float64 price_signal (+0x24), float64 demand_avg (+0x2C). Implements a dynamic pricing economy: EMA-based market simulation with α=0.7 smoothing, demand tracks purchase rate per player, price_signal tracks squared price ratio / 10.0, adjustment = mkt_cost × (1 + (demand - signal) × 0.05). Price clamped to [base×0.1, base×100] on load. Purchase tracking via `inc sold_qty` at file 0x14A2A in buy function. Gated by FREE_MARKET config (DS:0x514A). Key constants: DS:0x5260=0.7 (α), DS:0x5268=0.1 (init), DS:0x5298=10.0 (divisor), DS:0x5190=0.05 (sensitivity). **Correction**: DS:0x5190 is MKT_SENSITIVITY (0.05), not AIR_VISCOSITY as previously labeled. See "SCORCH.MKT Market File Format" section.
- [x] Trace SCORCH.PCX loading context: **RESOLVED — optional user background**. (a) Code runs when **'B' key** (scancode 0x30) is pressed during gameplay turn, dispatched via play loop switch table at CS:0x05DB index 46 → CS:0x0550 (file 0x2FAE0). (b) DS:0x5188 is **PLAY_MODE** (already documented) — NOT related to PCX; the DS:0x5188 check at 0x2FAD1 is a separate adjacent switch case (fire action for Sequential mode). (c) SCORCH.PCX is a **user-provided full-screen PCX background image** — loaded via fg_pcxopen→fg_pcxhead→fg_pcximage with no error handling if file missing. (d) File should **NOT** be added to v86/images/game.img — it was never shipped with the game. Only 1 real reference in entire binary (play.cpp 0x2FAE0; other xref hits are false positives matching 0x5C8D quote strings). See "SCORCH.PCX Background Image" section.
- [x] Trace terrain generation for each sky type: **RESOLVED**. All 7 terrain types fully decoded. Main function at file 0x3971F, setTerrainPixel at 0x3AB39 (7-way switch, jump table at CS:0x16E5 partially corrupted by MZ relocations). **Type 0 (Flat)**: solid VGA 120, constant height. **Type 1 (Slope)**: linear Y-gradient height_array, gray palette. **Type 2 (Rolling)**: bitmap texture + aux_array(rand(32000)×x%30) pattern; falls back to Flat if no bitmap. **Type 3 (MTN)**: scanned mountain data; depth gradient VGA 130–150 for recesses; falls back to Flat if no .MTN file. **Type 4 (V-Shaped)**: reversed bitmap logic, shallow 9-level gradient, Sunset-style 3-band FPU palette. **Type 5 (Castle)**: multiple LandGenerator segments with random gaps creating rampart shapes; Sunset palette. **Type 6 (Cavern)**: mountains+slope underground, 3-band gradient. Types 1/5/6 share identical setTerrainPixel code (pure height_array[y] lookup); visual difference is palette only. **HOSTILE_ENVIRONMENT** at **DS:0x513C**: config flag (On/Off); when enabled, projectiles inflict 1 damage per pixel traversed through tank body (file 0x3EB72: `damage_tank(10, tank_ptr, 1)` when pixel < 0x50). See "Per-Type Height Generation Handlers" and "HOSTILE_ENVIRONMENT System" subsections in Terrain Generation section.
- [x] Trace TALK1.CFG / TALK2.CFG parsing: **RESOLVED**. Source: `comments.cpp` (seg 0x1144, file base ~0x17E40). Plain text files, one phrase per line, max 79 chars. **Loader** `load_talk_file` (0x17F50): fopen(filename, "rt"), 2-pass (count lines, then strdup each into malloc'd pointer array). **Data struct** (6 bytes, at DS:0xCC8E for attack, DS:0xCC94 for die): {word count, dword far_ptr_to_line_array}. **Selection**: `get_random_line` (0x17F09) returns `lines[random(count)]` or empty string if count==0. **Trigger**: `show_attack_comment` (0x181A1) called on fire — has 2% random-player taunt special case; `show_die_comment` (0x18155) called on tank death. **Display**: `display_talk_bubble` (0x182FD) checks TALKING_TANKS(DS:0x5118)!=0, TALK_PROBABILITY(DS:0x511A)!=0; rolls random(100)<TALK_PROBABILITY; measures text, positions bubble at tank.y-19, clamps X to screen, draws bordered box, renders text, delays TALK_DELAY(DS:0x511C, default 18) ticks. **Web port** `web/js/talk.js` exists and is functional with all 54 attack + 61 death phrases; minor gaps: treats talkingTanks as boolean (EXE has Off/Computers/All), no 2% random-player taunt, no bordered rectangle style. See "Talk Files" section.
- [x] Verify physics speed limit: traced DS:1CA2 = 1.5 — confirmed it is NOT a speed limit; it is only used in (a) MIPS benchmark timing loop (file 0x21000) and (b) Mag Deflector sound distance scaling (`sqrt(distSq)*1.5+1000 → _ftol → sound call`). The EXE has NO explicit speed-squared check in the per-step physics loop. Speed is bounded naturally by viscosity. Removed the false `speedSq > 160000` check from physics.js and corrected the DS offsets table and pseudocode in RE doc.
- [x] Decode MIRV/Death's Head spread table: Confirmed — DS:0x529E is NOT angle offsets; it is three packed 2-word arrays indexed by `weapon.param * 2`. Handler at file 0x2C989 (seg 0x25D5:0x0239). Sub-warhead parameters: **count** = DS:0x52A2[param] = {5, 9}, **explosion radius** = DS:0x529E[param] = {20, 35}, **vx spread coeff** = DS:0x52A6[param] = {50, 20}. Spread formula (file 0x2CBFE): `vx_offset = (i − (count+1)) × coeff` — all offsets are negative (left-biased relative to parent vx); no angle math used. EXE uses linear integer vx offsets only; vy for sub-warheads is unchanged from parent. Web port updated: subCount 6→5/9, subRadius 15/25→20/35, spread replaced with symmetric linear vx model. See "MIRV / Death's Head" section for full pseudocode.
- [x] Verify AI noise calibration: traced shark.cpp `ai_inject_noise` at file 0x25DE9-0x2610F. The EXE uses a SCANNING architecture (not noise injection): freq_base = π/(2×noise_amp), freq_cap = 2π/10, amp = rand01×budget×0.5, budget reduction = 2×amp, 4× freq multiplier per harmonic, phase = rand(300), 2–5 harmonics. DS constants: DS:0x322E=π, DS:0x3236=2π, DS:0x323E=4.0, DS:0x3242=0.5, DS:0x3246=2.0. Web port multipliers 0.15 (angle) and 3.0 (power) have no basis in EXE — the model is architecturally different. See updated ai_inject_noise pseudocode section.
- [x] Verify viscosity formula scaling: confirmed formula `1.0 - AIR_VISCOSITY/10000` per-step, range 0–20 (clamped by EXE at file 0x19B54; max constant DS:0x0408 = 20.0). Divisor DS:0x040C = DS:0x637C = 10000.0. Integer intermediate DS:0x5180. Skip-when-1.0 optimization at file 0x21C56. Two application sites: extras.cpp (0x21C56) and earlier trajectory module (0x14391). Web port formula and range are correct.
- [x] Verify wind generation distribution: traced wind code at file 0x2943A (generate_wind) and 0x28E99 (update_wind). **Corrections to previous doc**: (1) initial formula is `rand(max_wind) - max_wind/4` NOT `rand(max_wind/2) - max_wind/4` — range is `[-max/4, +3*max/4)`, twice as wide and positive-biased; (2) second doubling is NESTED inside first (8% total ×4 chance) NOT independent (was mis-documented as independent 40%). DS:515c = MAX_WIND (default 200, slider 5–500); DS:633c = 5.0 (slider min), DS:6348 = 500.0 (slider max). Per-turn clamp uses ±DS:515c directly. Web port game.js fixed: `random(maxWind)` replacing `random(Math.floor(maxWind/2)+1)`, nested doubling, clamp changed from `config.wind*4` to `config.wind`.
- [x] Verify UI palette RGB values (200-208): decoded fg_setrgb calls at file 0x2A640–0x2A770 (icons.cpp init). **All 9 web port values are CORRECT** — no changes needed to palette.js. Confirmed mapping: pal 151=(45,45,45)→web203/204, pal 152=(0,0,0)→web205, pal 153=(30,30,30)→web201, pal 155=(63,63,63)→web202, pal 156=(15,15,15)→web208, pal 158=(5,5,5)→web207, pal 159=(55,55,55)→web206. web200=UI_HIGHLIGHT is dynamic player color (correct as static white). **New discovery**: three additional hardcoded palette entries in same init block not accessed via DS:EFxx variables — pal 154=(40,40,63) medium blue, pal 157=(50,50,50) medium gray, pal 161=(10,63,63) cyan — purpose unknown, not needed by web port. Also: pal 80 overridden with (20,63,20)=green (overwritten by sky setup), pal 87 overridden with (40,40,63) (overwritten by player color setup). See VGA Palette System section.
- [x] Extend font to 161 chars: traced CP437 0x80-0xFF glyph data via font_init at file 0x4C290. **Key corrections to font_dump.py comments**: (1) glyph pixel data is NOT BSS — it IS present in the raw EXE binary; (2) format is ROW-MAJOR byte-per-pixel (not column-major as commented) — confirmed by cross-checking 'A' glyph at DS:0x775A (file 0x5D4DA) against font.js packed data. font_init assigns 161 glyph pointers by scanning for `C7 06 [ptr_ds lo hi] [val lo hi]` patterns; char_code derived from `ptr_ds = (char*4 - 0xCA6) & 0xFFFF`. **66 CP437 extended glyphs** found (chars 0x80–0xFD with gaps): Latin accented (0x80–0xA8), fractions/punctuation (0xAB–0xAD), box-drawing absent (0xB0–0xDF), Greek/math (0xE0–0xEF: α β Γ π Σ σ µ τ Φ Θ Ω δ ∞ φ ε ∩), math symbols (0xF1–0xF3: ± ≥ ≤), degree (0xF8: °), superscripts (0xFC–0xFD: ⁿ ²). New script `disasm/decode_cp437_font.py` performs the extraction. `web/js/font.js` updated: added `WIDTHS_EXT` (126 entries, chars 0x80–0xFD) and `GLYPHS_EXT` (126×12 bytes) arrays; `charWidth()`, `drawChar()`, and `measureText()` now handle full range.

### Web Port Implementation

- [x] Fix title screen missing "Registered Version" line: EXE renders Row 3 at Y=52 (small) / Y=71 (large) with text "Registered Version" via `text_display` (see Title Area Rendering table in Main Menu section); added to `drawMainMenu()` in web/js/menu.js between the subtitle and copyright lines, with mode-dependent Y position (`isSmallMode() ? 52 : 71`)
- [x] Fix title screen Y positions for large mode: EXE uses mode-dependent Y values — title "Scorched Earth" at Y=2 (small) / Y=11 (large); subtitle "The Mother of All Games" at Y=27 (small) / Y=41 (large); "Registered Version" at Y=52 (small) / Y=71 (large); web/js/menu.js now uses `isSmallMode()` ternaries for all three: title Y `2:11`, subtitle Y `27:41`, registered version Y `52:71` (was already correct)
- [x] Fix copyright format: EXE builds `sprintf(buf, "%s %s Copyright (c) 1991-1995 Wendell Hicken", "1.50", ...)` producing "1.50 Copyright (c) 1991-1995 Wendell Hicken" as the full string, split to two lines only if too wide (checked via `text_measure`); web port now builds the full string "1.50 Copyright (c) 1991-1995 Wendell Hicken" and checks `measureText` against panel width — displays as one line if it fits, otherwise splits to "1.50 Copyright (c) 1991-1995" / "Wendell Hicken" on two lines (web/js/menu.js:523-534)
- [x] Fix sky palette gradients in web port: Sunset (type 4) gradient direction fixed in web/js/palette.js — now goes cool-blue/indigo at top (i=0: R=28,G=5,B=50) to warm-orange at bottom (i=23: R=63,G=20,B=10). Other sky types unchanged (no verified EXE values found from static analysis for types 0–3, 5).
- [x] Add sun/planet rendering to terrain preview: **CANCELLED** — RE investigation resolved as "No explicit sun circle"; the "sun" in Sunset mode is an optical illusion from the warm palette gradient visible between terrain silhouettes (see "Sun/Planet Rendering" section). No draw call to implement. Sunset palette gradient already fixed in web/js/palette.js.
- [x] Implement impact damage system: **DS:0x5114** = DAMAGE_TANKS_ON_IMPACT (0=Off, 1=On, default On). **DS:0x5164** = 2 (hardcoded fall damage per pixel). Two modes: Off = per-step damage during fall; On = accumulated damage on landing. Total damage identical (2 × fall_distance). Parachute negates all damage. Web port: `config.impactDamage` toggle added (config.js, menu.js); `tank.js` fall damage corrected from `fallDist/5` to `2*fallDist`; `fallStartY` tracks fall origin for accurate distance; both damage modes implemented. See "Falling Tank / Impact Damage System" section.
- [x] Implement shop sell sub-dialog: EXE sell refund formula = `floor(qty × price × factor / bundle)` where factor = **0.8** (normal, DS:0x613C) or **0.65** (free market, DS:0x6144). Web port had 0.5 — fixed to 0.8/0.65 in shop.js; `config.freeMarket` toggle added (config.js, menu.js Economics sub-dialog). Sell dialog UI was already implemented. See "Sell Equipment — Refund Price Formula" subsection.
- [x] Implement shop palette animation: Full palette tick function traced at file 0x14E34. Three effects: (1) VGA 2 pulsing red/orange triangle wave (100-frame counter, R=tri×63/50, G=tri×10/50), (2) VGA 8-11 accent cycling entries 1-4 only (every 8 frames, si=((counter>>3)&3)+1, 4-step rotation), (3) VGA 14-18 gray gradient cycling (5 levels: 0/15/30/45/60, starting index = (counter/2)%5+14). Web port corrected: was using all 5 entries with 5-step modulo; now uses entries 1-4 with 4-step modulo; added pulsing VGA 2 and gray gradient VGA 14-18. See "Shop Palette Animation" subsection.
- [x] Implement Full Row 2 HUD widgets: All 48 icons extracted from DS:0x3826 into ICONS array (hud.js). All 7 widgets implemented in full mode Row 2: W1 fuel per-mille, W2 battery count+icon(blank w=0)+bar, W3 parachute count+icon(blank)+bar, W4 weapon ammo count+weapon icon+percentage (EXE formula: floor(current×100.0/max) at 0x31D7F, DS:0x5830=100.0f, cap 1-99 unless exactly full), W5 shield count+bar, W6 Super Mag count+icon(DS:D566=52, blank w=0), W7 Heavy Shield energy conditional (EXE: check1 at 0x31249 = inventory[D564=HeavyShield]×10+struct[0xAA], check2 at 0x3121E = shield type active, format "%3d" at DS:0x6479, skip if not enough screen width). Row 1 full mode: weapon icon at E9DE. Row 1 basic: player tank icons with alive/dead colors. WPN constants added: PARACHUTE=42, BATTERY=43, MAG_DEFLECTOR=45, HEAVY_SHIELD=51, SUPER_MAG=52

### Documentation

- [x] Draw ASCII architecture diagrams: created `docs/architecture_exe.md` (binary layout, module call graph, per-turn execution flow, shared DS data layout with writer/reader annotations, weapon handler dispatch, shield dispatch, AI solver architecture, font system) and `docs/architecture_web.md` (23-module dependency graph, state machine diagram, game loop per-frame flow, shared state objects, VGA-style rendering pipeline, event flow, EXE-to-web module mapping table)
- [x] Full fidelity audit: read every section of REVERSE_ENGINEERING.md against every web/js/*.js file, compare documented EXE values/formulas/behaviors against the implementation, and add new `- [ ]` tasks here for every gap found. **Completed**: 8 parallel audit agents compared all major sections. Found ~70 discrepancies across physics, AI, shields, terrain, score, config, tank, explosions, shop, sound, HUD, and palette. All gaps added as new tasks below.

### RE Investigation (from audit)

- [x] Trace wall bounce coefficients: **RESOLVED**. Bounce coefficient dispatch at file 0x21EFD: Rubber(type 3)→DS:0x1D34=-1.0 (perfect reflection), Padded(type 2)→DS:0x1D3C=-0.5 (half velocity), Spring(type 4)→DS:0x1D44=-2.0 (doubled velocity). Negative sign handles reflection. Web port fixed: Rubber 0.8→1.0, Spring 1.2→2.0 (in physics.js and behaviors.js roller wall code). Bounce count limit: player struct +0x30 checked ≤6. See "Wall Types (ELASTIC setting)" section.
- [x] Trace WALL enum ordering: **RESOLVED**. Config variable DS:0x5154 (ELASTIC). Enum from config parser at 0x29290 and dispatch at 0x2220F: 0=None, 1=Wrap, 2=Padded, 3=Rubber, 4=Spring, 5=Concrete, 6=Random, 7=Erratic. Random/Erratic resolve via random(6)→0-5 at file 0x22140. Web port fixed: WALL enum, config default (7→5=Concrete), menu names array, resolveRandomWallType simplified to random(6). See "Wall Types (ELASTIC setting)" section.
- [x] Trace Funky Bomb parent explosion radius and sub-bomb weapon index: **RESOLVED**. Main handler at file 0x246E0, spawner at 0x24894. Parent explosion radius = **20** (hardcoded at 0x24AA9, NOT scaled by EXPLOSION_SCALE). Sub-bomb explosion radius = **(random(10)+15) × DS:0x50DA** (EXPLOSION_SCALE float, base 15-24). Sub-bombs are **NOT weapon projectiles** — custom animated fall objects with own explosion logic (no weapon index). Shield hit (damage=10) blocks sub-bomb spawn (early return). Web port fixed: parent radius 15→20, sub-bomb radius 10→random(10)+15 scaled by explosionScale. See "Funky Bomb" section in Weapon Behavior Dispatch.
- [x] Trace Leap Frog / Bounce explosion radii: **RESOLVED**. Handler at file 0x2A226. Uses damage_type countdown (player+0x54, initial=2, set at 0x21397). Bounce radius table at DS:0x50CA = {20, 25, 30} indexed by damage_type. Sequence: 1st hit radius=30, 2nd=25, 3rd(final)=20, all × EXPLOSION_SCALE (DS:0x50DA). Speed ÷ 1.5 (DS:0x50D0=1.5f) per bounce via sin/cos angle reconstruction. Web port fixed: decreasing radii 30→25→20 × explosionScale, speed ÷ 1.5 (was 0.7/0.9), damage_type countdown (was bounceCount vs param). See "LeapFrog / Bounce" section in Weapon Behavior Dispatch.
- [x] Trace napalm particle physics: **RESOLVED — NOT velocity-based**. Main handler at file 0x2DA00. Particles use **pixel-walking cellular automaton**: each step checks adjacent pixels via `check_direction(x,y)` (file 0x2DFCC) and moves 1 pixel. Direction: 0=terrain below (drop), -1/+1=move left/right (wind via DS:0x515A determines when both available), 2=erode upward. No velocity vectors, no damping. DS:0x1D60=0.7 is explosion damage falloff (file 0x235B6), NOT particle damping. DS:0x1D68=0.001 is explosion sqrt epsilon (file 0x23638), NOT speed threshold. Damage: Hot Napalm (param>15) max 50 at range 40 (DS:0x5682/0x5686), Regular Napalm max 30 at range 25 (DS:0x568A/0x568E). Max 1000 steps per particle, explosion array stores every 20th position. See "Napalm / Hot Napalm" section in Weapon Behavior Dispatch.
- [x] Trace heat guidance trigger and correction: **RESOLVED**. Trigger: `ai_select_target` (file 0x24F01) iterates all tanks, computes Euclidean distance, threshold = DS:0x5186 = **40 pixels** (web port had 60). Callback (0x2589C): continuous attraction force `correction = 10000.0 × dt / distSq^(1/4)` applied per step toward stored target, with overshoot detection (sign flip of dx/dy vs initial wind_x/wind_y → removes callback). Wind vectors are **inverted**: wind_x = -sign(target.X - current.X) — used ONLY for overshoot detection, NOT as correction direction. Web port fixed: HEAT_PROXIMITY 60→40, replaced constant GUIDANCE_STRENGTH=2.0 with continuous attraction model (GUIDANCE_K=10000, GUIDANCE_DT=0.02, GUIDANCE_MIN_DISTSQ=0.001), added overshoot detection and callback removal. See "Heat Guidance — Trigger and Correction" subsection.
- [x] Trace gravity/wind pre-scaling formula: **RESOLVED**. `setup_physics_constants` at file 0x21064. Constants: DS:0x1CF2=50.0 (f32, gravity mult), DS:0x1CF6=40.0 (f32, wind div), DS:0x1CFA=0.02 (f64, fallback dt), DS:0x1CC8=100.0 (f32, d divisor). Formulas: gravity_step = 2500 × GRAVITY_CONFIG × dt, wind_step = 1.25 × wind × dt (both pre-scaled, applied without further dt multiply). Launch velocity = power directly (no scaling). GRAVITY_CONFIG at DS:0x512A = 0.2 default (f64), range 0.05–10.0. Effective accelerations: gravity = 2500 × G px/sec², wind = 1.25 × W px/sec². Web port corrected: GRAVITY=4.9 → 400×config.gravity, WIND_SCALE=0.15 → 0.2 (using k²=0.16 scaling for MAX_SPEED=400). Config default gravity fixed 1.0→0.2. See "Gravity/Wind Pre-Scaling — Derived Formulas" subsection.
- [x] Trace sky type enum mapping: **VERIFIED**. Name table init at file 0x3AEA0 copies 8 far ptrs to DS:0x621C: 0=Plain (DS:0x2DE8), 1=Shaded (DS:0x2DEE), 2=Stars (DS:0x2DF5), 3=Storm (DS:0x2DFB), 4=Sunset (DS:0x2E01), 5=Cavern (DS:0x31ED), 6=Black (DS:0x2E08), 7=Random (DS:0x2787). Config key `SKY\0` at DS:0x0454, format `SKY=%s\n` at DS:0x08F8. Random resolution (file 0x3978E): `random(6)` → 0-5, re-rolls if 5 (Cavern) and no .mtn files (DS:0x621A==0). Black (6) never in Random pool. Web port was correct for indices 0-6 but missing Random (7); added Random to menu.js with runtime resolution to 0-6 (including Black, unlike EXE 0-5). See "Sky Type Enum" subsection in Sky/Landscape Mode System section.
- [x] Trace play order enum: **VERIFIED**. Config variable DS:0x519C, 5 options via name table at DS:0x62E4 (init at 0x3DA90). Enum: 0=Random (DS:0x2787), 1=Losers-First (DS:0x2CFA), 2=Winners-First (DS:0x2D07), 3=Round-Robin (DS:0x2D15), 4=Sequential (DS:0x2803). Config key `PLAY_ORDER\0` at DS:0x0541, format `PLAY_ORDER=%s\n` at DS:0x0A03. Dispatch at file 0x2AE64: cases 0-3 via jump table, case 4 skips to common code. Case 0: Fisher-Yates shuffle + random(2) start. Case 1: shuffle + rotate start via DS:0x51A4 (player_id tracking). Case 2: sort by score, reverse fill (winners first). Case 3: sort by score, forward fill (lowest first). Case 4: no modification (existing order). Web port fixed: enum corrected 0→Random etc., Round-Robin (3) added, Sequential (4) added, config comment fixed (was conflating with PLAY_MODE), default remains 0 (Random, matching SCORCH.CFG). See "Play Order System" section.
- [x] Trace shield color rendering formula: **RESOLVED**. `update_shield_color` at file 0x389DA. Formula: `R = shieldEnergy × configR / maxEnergy`, `G = shieldEnergy × configG / maxEnergy`, `B = shieldEnergy × configB / maxEnergy` — continuous fade, NOT quantized. Two palette indices: activation uses `player*8+5` (shared player entry, 50-frame fade-in), ongoing uses `player+200` (dedicated per-player shield entry, RGB updated on damage). Key init: struct[+0x1A] = player_number×8 (file 0x30F32), struct[+0xA0] = player_number (file 0x30E96). DS globals: EC80/EC84=pixel value, EC82=tank Y, EC86=replacement value. Web port fixed: replaced quantized 4-step slot system (`player.index*8+slot`) with continuous formula using dedicated palette entries (210+playerIndex), added `setPaletteRgb()` to palette.js. See "Visual Feedback — Shield Color Rendering" subsection.
- [x] Trace shield break animation sequence: **RESOLVED — No white flash**. `shield_absorb_damage` at file 0x38344, break path at 0x38421. Break animation: (1) set palette to full config color, (2) 51-frame fade (di=0..50): `R = configR × (60-di)/60` with constant 20-tick delay and descending tone 6000→1100 Hz, (3) final beep sound(10, 1000), (4) erase shield pixels via callback 0x3FC11 (restores terrain), (5) zero energy. NO white flash — EXE smoothly fades from full config color to ~17% brightness. NO accelerating delay (unlike activation which uses delay=2×i). NO ring expansion — all shield pixels change via VGA palette register. Web port fixed: removed spurious frame-0 white flash, replaced expanding ring with in-place palette fade using shield config colors, 51 frames. See "Break animation" in Visual Feedback section.
- [x] Trace Flicker Shield implementation: **RESOLVED — plain absorption shield**. Flicker Shield = config entry 5 (weapon 49) with energy=200, radius=16, RGB=(63,53,33) orange, dispatch_type=1 (same as all shields). NO probabilistic on/off cycling, NO flickering visual effect, NO special handler. The name is misleading — behavior is identical to all other shields. Web port fixed: removed invented SHIELD_CONFIG[6] (energy=80, radius=14, rgb=50/50/63), removed fabricated 50% damage bypass and random pixel skipping, removed inner ring rendering, renamed SHIELD_TYPE enum to match EXE config indices (MAG_DEFLECTOR=1, SHIELD=2, WARP=3, TELEPORT=4, FLICKER=5), stubbed checkShieldDeflection (Force/Heavy not in EXE config table). See "Shield Type Configuration Table" section.
- [x] Trace terrain bitmap shading direction: **VERIFIED — RE doc and web port are both correct**. Traced height_array population loop at file 0x3999A: `height_array[y] = (terrain_bottom - y) × 29 / terrain_height + 120`. At surface (small y, top of terrain): index approaches **149**. At deepest underground (y = terrain_bottom): index = **120**. Web port formula at terrain.js:324 is identical: `120 + floor((bottom - y) × 29 / globalRange)`. Palette color directions confirmed per-type: type 1 (Snow/Ice) VGA 120=(29,29,63) bright → 149=(0,0,63) dark; type 2 (Rock/Gray) VGA 121=(7,7,7) dark → 149=(63,63,63) bright; type 5 (Varied) VGA 120=dark → 149=bright. Direction is type-dependent via palette setup, but index mapping (surface→149, underground→120) is consistent. No fix needed.
- [x] Trace Type 4 (Desert/Lava) terrain palette: **RESOLVED**. 3-segment FPU interpolation (10+10+9 entries) at file 0x39C31 using float32 constants DS:0x6258-0x626C. VGA 120=(63,63,0) set by set_sky_palette_entry. Loop 1 (VGA 121-130): R=63, G=58→20, B=2→20 (warm gold→red-brown). Loop 2 (VGA 131-140): R=59→29, G=20→29, B=24→63 (red→blue-purple). Loop 3 (VGA 141-149): R=G=27→11, B=59→34 (blue→dark indigo). Previous doc had Loop 2 RGB values swapped (said (24,20,59) start, correct is (59,20,24)) and Loop 3 end wrong (said (9,9,31), correct is (11,11,34)). DS:0x626C=31.0 (not 31.5). DS:0x6270=45.0 is unused by these loops. Full 30-entry table with exact integer values added to "Desert/Lava Gradient Detail" section. Web port palette.js case 4 uses single linear lerp — needs 3-segment replacement.
- [x] Trace Type 3 (Night/MTN) terrain palette: **RESOLVED — blue tint, not greenish**. Two palette loops at file 0x39AEF: Loop 1 (di=0..9, VGA 120–129): `fg_setrgb(di, di, di, di+30)` — R=G=i, B=i+30, creating dark **blue** gradient (not green as doc previously stated). Loop 2 (di=10..29, VGA 130–149): `fg_setrgb(di, (di-10)*2, (di-10)*2, (di-10)*2)` — gray depth gradient (0,0,0)→(38,38,38). Previous doc notation "(i, i+30, i, i)" had +30 on wrong channel (R instead of B). Type 3 falls through to Type 4's shared code (fg_setdacs upload, 9-level height_array, bitmap fill, LandGenerator). setTerrainPixel case 3: bitmap clear → height_array[y] (VGA 120–128 blue); bitmap set → depth+130 (VGA 130–150 gray depth). Web port had 15/15 split with pure-blue ramp; EXE has 10/20 split with blue-gray terrain + gray depth. See "Night/MTN Palette Detail" table.
- [x] Trace parachute deploy mechanics: **RESOLVED**. Sub struct field `sub[0x2C]` is a deploy damage threshold (NOT inventory count): default=5, with Battery item=10 (0x18852/0x18872). `check_deploy` (0x202F6) simulates remaining fall returning predicted damage (2/pixel). Deploy when predicted_damage > threshold. Deploy action: sound(30, 2000Hz), flash white (63,63,63), set `sub[0x0C]=1`. Half-speed: `DS:0x1C68` frame counter % 2 == 0 → skip iteration (0x20626). Per-step delay(20) for visual effect (0x20A8F). Parachuted tanks accumulate zero damage. Web port gaps: no mid-fall threshold check, no frame-skipping half-speed, no deploy sound/flash, no Battery interaction. See "Parachute Deploy Mechanics" subsection in Falling Tank section.
- [x] Trace landing crater explosion: **RESOLVED — crush damage mechanic, NOT universal crater**. The "landing crater" at 0x20B4C only triggers when a falling tank lands on top of another tank (>2 pixel columns overlap, detected by per-step pixel scan at 0x20690). Crush damage to victim = faller_accum + 50 (through shield via shield_and_damage at 0x3912:0x04B2 / file 0x3FFD2). Faller self-damage = faller_accum/2 + 10 (direct). Pixel scan: pixel < 0x50 = tank pixel, hit_player = pixel/8, tank substruct = DS:D568 + hit_player × 0xCA. Glancing contact (1-2 columns): sound(5, 200) but no landing. Normal terrain landings have NO crater explosion. See "Crush Damage Summary" in Falling Tank section.
- [x] Trace dome direction-dependent rendering: **RESOLVED — no direction-dependent dome shape**. Previous doc was incorrect. EXE uses pixel data tables at DS:0x673E (6 tank types, 18 bytes/entry) with 3-byte pixel entries (x_i8, y_i8, color_u8). Direction (sub[+0x94]) only mirrors X axis (`tank.X + offset` vs `tank.X - offset`); Y is unchanged. Type 0 dome is 9×5 semicircle with concentric color rings (0=outline, 3=interior), fully X-symmetric — both directions produce identical visual output. Color globals EF26/EF30 are for panel rendering (icons.cpp), not in-game dome. Previous "In-Game Tank Dome" section at 0x3FC9A was incorrect — that address is within draw_tank_setup (barrel erase + globals init), not a dome function. Draw chain: 0x3FC7D → 0x3FB27 → 0x40A75 → 0x40C19. Web port's single dome shape is correct; no fix needed. See "In-Game Tank Rendering — Pixel Table System" section.

### Web Port Fixes (from audit)

#### Config defaults (config.js)
- [x] Fix config defaults to match EXE: config.js updated — startCash 25000→1000000, interest 10→30, wind 5→0, changeWind 1→0 (Off), hostileEnvironment 0→1 (On), talkingTanks 1→0 (Off), land2 0→20, armsLevel 0→4, explosionScale 1→2 (Large). gravity was already 0.2, playOrder already 0 (Random). soundEnabled kept at 1 (matching EXE's SOUND=On default in shipped SCORCH.CFG)

#### Physics (physics.js)
- [x] Fix gravity/wind formulas once RE investigation resolves the pre-scaling: **RESOLVED**. physics.js: removed hardcoded GRAVITY=4.9 and WIND_SCALE=0.15, replaced with EXE-derived GRAVITY_FACTOR=400 (2500×k², where k=MAX_SPEED/1000=0.4) × config.gravity and WIND_FACTOR=0.2 (1.25×k²) × wind. config.js: gravity default 1.0→0.2. ai.js: solver constants updated to match. Note: for exact flight-time fidelity, MAX_SPEED should be 1000 (currently 400, trajectories land correctly but take 2.5× longer).

#### AI system (ai.js)
- [x] Fix AI noise parameter counts: Shooter/Poolshark should have 1 param [23] not 3; Tosser should have 2 [63,23] not 3. Rewrite sinusoidalNoise to use EXE scanning architecture: shot-number domain (not wall-clock), budget-driven random amplitudes, freq_base=π/(2×amp) with 4× multiplier, 2-5 harmonics, random phase 0-299. **DONE**: AI_NOISE table corrected (Shooter=[23], Poolshark=[23], Tosser=[63,23]). Replaced wall-clock sinusoidalNoise with EXE-faithful `generateHarmonics`/`evaluateHarmonics` using budget=SHOT_RANGE-30, freq_base=π/(2×amp), 4× freq multiplier, 2-5 harmonics, phase=random(300). Per-player noise state persists harmonics for cross-turn scanning correlation. Param[0]→angle noise, param[1]→power noise (absent for 1-param types like Shooter = no power noise), param[2]→additional angle noise. Noise scaled by noise_amplitude/100 for per-type differentiation.
- [x] Fix Cyborg/Unknown randomization range: EXE randomizes to 0-5 (includes Human, excludes Spoiler); web port uses 1-6 (excludes Human, includes Spoiler). **DONE**: ai.js `getEffectiveType()` changed from `random(6)+1` (1-6) to `random(6)` (0-5). When type 0 (Human) is selected, AI_NOISE falls back to Moron params via `|| AI_NOISE[AI_TYPE.MORON]`.
- [x] Add Sentient AI type (EXE type 9): web port omits it entirely, only has types 0-8. **DONE**: ai.js — added SENTIENT: 9 to AI_TYPE enum, 'Sentient' to AI_NAMES, empty AI_NOISE entry [] (EXE accuracy switch at 0x29505 only covers types 0-5; Sentient gets zero noise = perfect accuracy). Noise application guarded with `noise.length > 0` check. menu.js — AI type cap changed from UNKNOWN to SENTIENT so it's selectable. Sentient was non-functional in v1.50 (corrupted vtable crash); web port implements the developer's apparent intent as highest-difficulty perfect-accuracy AI.
- [x] Fix AI target selection: EXE uses Euclidean distance via `compute_distance` (file 0x2640F: `sqrt(dx²+dy²)`); web port used horizontal-only `Math.abs(p.x - shooter.x)`. **DONE**: ai.js `selectTarget()` and `selectWeapon()` changed to use Euclidean distance `sqrt(dx²+dy²)`. Note: DS:0x5186=40 threshold is for heat guidance proximity (already correct in behaviors.js HEAT_PROXIMITY=40), not general AI targeting. EXE per-type AI functions (e.g., Moron at 0x38B4E) iterate all players using both x and y for visibility/targeting.

#### Score system (score.js)
- [x] Fix scoreOnDeath teams-enabled branch: EXE gives +500 (not +4000) when teams enabled. **DONE**: score.js — `scoreOnDeath()` now checks `teamsEnabled()`: +500 when teams enabled (players share team numbers), +4000 when teams disabled (default). Added `teamsEnabled()` helper (checks if any players share `.team` property) and updated `isEnemy()` to compare team numbers. tank.js — added `team: index` to `createPlayer()` (each player on own team by default, matching EXE player struct +0x30). Current default: teams disabled → +4000 (unchanged behavior until team assignment UI is added).
- [x] Fix scoreOnDamage teams-disabled guard: EXE suppresses per-damage scoring when teams disabled (the default). **DONE**: score.js — `scoreOnDamage()` now calls `teamsEnabled()` early-return guard matching EXE pseudocode `if teams_disabled (DS:0x5148 == 0): return`. Per-damage scoring (+30x/+2x enemy, -15x/-1x friendly) only activates when players share team numbers. Default behavior (each player on own team) = no per-damage scoring, matching EXE.
- [x] Fix endOfRoundScoring teams-enabled branch: missing pool formula (round×500+5000+maxPower×30+shieldEnergy×2). **DONE**: score.js — `endOfRoundScoring()` now has two branches matching EXE (file 0x37381): teams-enabled pool = `round×500 + 5000 + Σ(alive: 100×30 + shieldEnergy×2)`, teams-disabled pool = `numPlayers×1000 + round×4000`. Both distribute `floor(pool/round)` to each alive player. MAX_POWER = 100 (DS:0x50E4, player starting energy at sub-struct +0xA2, confirmed from init at file 0x30DC9). Previously only had teams-disabled formula.

#### Shield system (shields.js)
- [x] Fix Mag Deflector collision damping: **VERIFIED — web port already correct**. Disassembly at file 0x2253A confirms: coefficient = DS:0x1D54 = **0.75** (f32), NOT 0.7 (DS:1D60 is explosion damage falloff, different system). Absorption threshold = DS:0x1D58 = 2000.0 (speed²). physics.js `MAG_DAMP_COEFF=0.75` and `MAG_ABSORB_THRESHOLD=2000.0` both match EXE. No random scatter or additive ±100/±50 in current code. Corrected RE doc "Collision Damping" section (was citing wrong DS offset/value).
- [x] Add shield pixel marker 0xFF and terrain boundary 0x69 detection: **DONE**. EXE shield callbacks use pixel-based discrimination: shield_draw_pixel_callback (0x38649) skips sky range 0x50-0x68 (VGA 80-104) — shields only drawn over terrain/tanks, NOT sky. shield_draw_terrain_callback (0x3FC46) only draws where pixel >= 0x69 (105 = terrain). White 0xFF marker is the terrain impact pixel (0x3EBD7) which >= 0x69 so shields can be drawn over it. Web port shields.js: `drawShield()` and `drawShieldBreak()` now call `getPixel()` before each shield pixel — skip if existing pixel is in sky range (80-104). Shields now only appear where they overlap terrain, matching EXE visual behavior

#### Talk system (talk.js)
- [x] Fix talk bubble Y offset: EXE uses tank.y-19, web uses player.y-20. **DONE**: talk.js — changed `bubble.y = player.y - 20` to `player.y - 19` in both `triggerAttackSpeech()` and `triggerDeathSpeech()`, matching EXE `display_talk_bubble` positioning at tank.y-19 (file 0x182FD).
- [x] Add death speech probability roll: **DONE**. talk.js — `triggerDeathSpeech()` now has `if (random(100) >= config.talkProbability) return;` matching EXE `display_talk_bubble` (0x182FD) which rolls `random(100) < TALK_PROBABILITY` for both attack and death speeches. Previously only `triggerAttackSpeech()` had this check.
- [x] Add 2% random-player attack taunt: **DONE**. talk.js — `triggerAttackSpeech()` now checks `random(100) === 2` before normal speech logic, matching EXE `show_attack_comment` (0x181A1) special case. When triggered: picks a random player from `players[]`, positions bubble at that player's tank (bypasses talkingTanks/probability checks, matching EXE's forced TALKING_TANKS=1). Also requires `player.alive` check matching EXE guard. Imported `players` from tank.js.
- [x] Fix talkingTanks to be 3-way enum (Off/Computers/All) not binary Off/On: **DONE**. EXE DS:0x5118 TALKING_TANKS is 0=Off, 1=Computers, 2=All. Attack speech guard at play.cpp 0x30661: `if TALKING_TANKS > 1` → always show; else check `player[+0x22] != 0` (skip humans). Death speech has NO caller guard — display_talk_bubble's `TALKING_TANKS != 0` check suffices (death bubbles show for all players when enabled). Web port: menu.js — changed from Off/On to Off/Computers/All (max: 2). talk.js — `triggerAttackSpeech()` added `if (config.talkingTanks === 1 && player.aiType === 0) return;` to skip humans in Computers mode. `triggerDeathSpeech()` unchanged (JS falsy check `!config.talkingTanks` already handles Off=0 correctly).

#### Terrain/palette (terrain.js, palette.js)
- [x] Fix sky gradient to 25 entries (VGA 80-104) not 24 (VGA 80-103): **DONE**. palette.js — all 7 sky type loops changed from 24 to 25 entries (i<25, t=i/24), writing VGA 80-104. BLACK constant moved from 104→252 (unused palette space) to avoid conflict with 25th sky entry. constants.js SKY_PAL_COUNT changed 24→25. Comments updated in terrain.js, framebuffer.js, palette.js.
- [x] Fix terrain palette type 4 (Sunset/Desert) to use 3-segment FPU gradient: **DONE**. palette.js case 4 replaced single linear ramp with EXE-faithful 3-segment interpolation: VGA 120=(63,63,0) bright yellow, Loop 1 (121-130) gold→red-brown using t2=(9-di)/10, Loop 2 (131-140) red→blue-purple, Loop 3 (141-149) blue-purple→dark indigo (9 entries, same t formula). All 30 entries verified against "Desert/Lava Gradient Detail" table. Uses Math.trunc matching x87 _ftol truncation.
- [x] Fix terrain palette type 5 (Castle) to use Sunset-style 3-band FPU gradient, not Varied base-color table: **DONE**. palette.js — case 5 now falls through to case 4 (same 3-band FPU gradient: VGA 120=(63,63,0) yellow, Loop 1 gold→red-brown, Loop 2 red→blue-purple, Loop 3 blue→dark indigo). Removed unused VARIED_COLORS base color table. EXE handler 0x39C31 is shared between Type 4 and Type 5.
- [x] Fix terrain palette type 3 (Night/MTN) to use EXE's 10/20 split: **DONE**. palette.js case 3 replaced 15/15 pure-blue split with EXE-faithful 10/20 split (file 0x39AEF): Loop 1 (VGA 120–129): R=G=di, B=di+30 (10 entries, blue-tinted terrain gradient). Loop 2 (VGA 130–149): R=G=B=(di-10)×2 (20 entries, gray depth gradient 0→38). Previous code used `t*30` interpolated pure-blue and `t*38` gray with wrong 15/15 boundaries.
- [x] Fix terrain bitmap shading direction once RE investigation confirms correct mapping (surface=120 or surface=149): **No fix needed** — web port already has correct direction (surface=149, underground=120), matching EXE. See RE investigation task above.

#### Sound system (sound.js)
- [x] Fix config.soundEnabled to actually control sound output (currently disconnected from playTone): **DONE**. sound.js had a local `soundEnabled` variable (initialized `true`) that was independent of `config.soundEnabled`. Removed local variable; `playTone()` and `playFlightSound()` now gate on `config.soundEnabled`. `toggleSound()` toggles `config.soundEnabled` (0/1). `isSoundEnabled()` returns `config.soundEnabled`. 'H' key toggle and config menu setting now properly control all sound output.
- [x] Fix explosion sound: should be 7 discrete frequency steps (1000→10000 Hz, +100 per step, 5-tick delay), not continuous ramp. **DONE**: sound.js `playExplosionSound()` replaced continuous `linearRampToValueAtTime(1000→10000)` with 7 discrete `setValueAtTime` steps matching EXE loop `for(si=0;si<100;si+=15): freq=si*100+1000`: 1000, 2500, 4000, 5500, 7000, 8500, 10000 Hz. Each step held for 5 clock ticks (5/18.2≈275ms). Radius parameter retained for API compat but unused (EXE doesn't scale explosion sound by radius).
- [x] Fix turn-change click sound: EXE uses 100 rapid speaker toggles (fg_click), not a 40 Hz continuous tone. **DONE**: sound.js `playBeep()` replaced 40 Hz continuous tone (0.2s duration) with ~3ms noise burst via AudioBuffer — alternating +1/-1 samples toggling every 3 samples, matching fg_click(20, 100) which performs 200 speaker toggles with delay=20 busy-wait loops (~1-2ms total on 286). Result is a short "tick" pop sound matching the EXE's player-change click.
- [x] Add missing sounds: terrain generation ping, impact random tone, terrain-hit rising sound, shield-hit random tone. **DONE**: sound.js — added 4 new functions: (1) `playTerrainGenPing()`: 10 accelerating click bursts (fg_click(0,20) with delay 25→7 ticks, matching ranges.cpp 0x35D41), called from game.js after generateTerrain(). (2) `playImpactFrame()`: random(3000) Hz tone per frame (extras.cpp 0x247BA, confirmed no base — just random(0xBB8) directly to fg_sound_on), called from explosions.js stepExplosion(). (3) `playTerrainHitSound(steps)`: rising tone starting 1000 Hz +200 Hz/step (extras.cpp 0x24DCD, init 0x3E8 at 0x24CE4, step 0xC8 at 0x24DDD), called from game.js on hit_terrain. (4) `playShieldHitSound()`: random(50) Hz low buzz (shields.cpp 0x3AF33, confirmed no base — just random(0x32) to fg_sound_on), called from explosions.js when shield absorbs damage.

#### Shop system (shop.js)
- [x] Implement dynamic market pricing (mkt_update per round): **DONE**. shop.js — added market state array (per-weapon: mktCost, soldQty, unsoldRounds, priceSignal, demandAvg), `initMarket()` (resets to base prices + EMA init=0.1), `getWeaponPrice(idx)` (returns mktCost when freeMarket on, base price otherwise), `trackPurchase(idx)` (increments soldQty), `mktUpdate()` (EMA algorithm: alpha=0.7, sensitivity=0.05, signal_div=10.0, clamped to [base×0.1, base×100]). All price references replaced with `getWeaponPrice()` — buy actions, sell refunds, AI auto-purchase, draw code, info panel, sell dialog. game.js — `initMarket()` called in `initGameRound()` (game start), `mktUpdate()` called in ROUND_OVER→SHOP transition (between rounds). Constants match EXE DS:0x5260=0.7, DS:0x5190=0.05, DS:0x5298=10.0, DS:0x5268=0.1.
- [x] Fix AI auto-purchase to use 12-case jump table (random(11) dispatch) instead of hardcoded 3-condition sequence: **DONE**. shop.js — replaced deterministic 3-buy sequence (missiles/nukes/shield) with EXE-faithful `random(11)` dispatch (file 0x1DCA4). 12 cases matching jump table at file 0x1DF4D: cases 0-3 buy random weapon (+ optional guidance/accessory/defense), case 5 buy random shield (idx 46-52), case 6 buy random defense item, case 8 buy random guidance, case 9 buy mountain gear (fuel/battery), case 10 sell random inventory item (refund at 0.8/0.65 factor), cases 4/7/11 are display-only no-ops. Mountain mode re-roll: if landType is MTN(3) or Castle(5) and action==8, re-roll (matching EXE DS:0x50D8 check at 0x1DCAF). All purchases gated by arms level and affordability, use `getWeaponPrice()` for market pricing support.

#### HUD (hud.js)
- [x] Fix Widget 6: should read WPN.SUPER_MAG (52) inventory, not WPN.MAG_DEFLECTOR (45). **DONE**: hud.js line 399 — changed `player.inventory[WPN.MAG_DEFLECTOR]` to `player.inventory[WPN.SUPER_MAG]`, matching EXE inventory[D566=52] at draw_hud_full 0x303CC.

#### Menu system (menu.js)
- [x] Add missing config sub-dialog options: Computers Buy (Economics), Flatten Peaks / MTN Percent (Landscape), Bomb Icon / Tunneling / Useless Items / Teams / Status Bar (Play Options). **DONE**: config.js — added 8 new properties with EXE defaults: computersBuy=0 (Basic), flattenPeaks=0 (Off), mtnPercent=20, bombIcon=1 (Big), tunneling=1 (On), uselessItems=0 (Off), teamMode=0 (None), statusBar=1 (On). menu.js — Economics submenu: added Computers Buy (Basic/Greedy/Erratic/Random). Landscape submenu: added Flatten Peaks (Off/On) and % Scanned MTN (0-100). Play Options submenu: added Bomb Icon (Small/Big/Invisible), Tunneling (Off/On), Useless Items (Off/On), Teams (None/On), Status Bar (Off/On). Weapons submenu: added Bomb Icon, Tunneling, Useless Items (matching EXE's shared subset). All persisted via localStorage PERSIST_KEYS.
- [x] Fix sky type list: should be Plain/Shaded/Stars/Storm/Sunset/Black/Random (not ...Cavern/Black). **DONE**: Remapped enum to 0=Plain, 1=Shaded, 2=Stars, 3=Storm, 4=Sunset, 5=Black, 6=Random (removed Cavern — no .MTN support in web port). menu.js — names array updated. palette.js — case 5 changed from Cavern to Black; Random (6) resolved via `random(6)→0-5` at top of `setupSkyPalette()`; `resolvedSkyType` exported for terrain.js `drawSky()` Stars/Storm checks. config.js — comment updated. EXE Random resolution (file 0x3978E) re-rolls Cavern when no .mtn; web port equivalent: Cavern removed entirely, Black included in Random pool.

#### Tank rendering (tank.js)
- [x] Fix parachute deploy and fall speed: **DONE**. tank.js — replaced immediate parachute check with EXE-faithful mid-fall deployment: `predictFallDamage()` simulates remaining fall (2 damage/pixel), deploys only when predicted > threshold (5 default, 10 with Battery via `WPN.BATTERY`). `parachuteDeployed` field tracks deployment state. Half-speed fall via `fallFrameCounter % 2 === 0` skip (matching EXE 0x20626). Deploy sound `playParachuteDeploySound()` (2000 Hz). Landing thud `playLandingThudSound()` (200 Hz). Parachute consumed at deploy time (not landing). No damage accumulation when deployed. sound.js — added `playParachuteDeploySound()` and `playLandingThudSound()` exports.
- [x] Add crush damage: **DONE**. tank.js — added `detectCrush(faller)` function: per-step bounding-box overlap check against all alive non-falling tanks (column overlap counted from tank width=7). >2 columns overlap → immediate landing, crush victim damage (fallDamageAccum+50 through shield via `applyShieldDamage()`), crush self-damage (floor(fallDamageAccum/2)+10 direct), plus normal impact self-damage if config.impactDamage on. 1-2 columns → glancing contact sound only (200 Hz). sound.js — added `playCrushGlanceSound()` (200 Hz, 30ms). Matching EXE: victim damage at 0x20B4C via shield_and_damage(0x3FFD2), self-damage at 0x20B8C via damage_tank, glancing sound at 0x207CB, >2 threshold at 0x2071C.

#### Napalm particles (behaviors.js)
- [x] Fix napalm particle pool cap: EXE allows 99 particles; web caps at 20. **DONE**: behaviors.js `bhvNapalm()` — changed `Math.min(Math.abs(weapon.param), 20)` to `Math.min(Math.abs(weapon.param), 99)`, matching EXE's 99-slot particle pool at DS:0xE754 (pool_avail=99 at DS:0xE9B2). Current weapons (Napalm=15, Hot Napalm=20, Ton of Dirt=20) are unaffected since params ≤ 20, but cap now correctly reflects EXE pool capacity.
- [x] Fix napalm speed threshold: **DONE**. Fully rewritten — old velocity-based model (0.7× damping, speedSq<25 threshold) replaced with EXE-faithful pixel-walking cellular automaton (behaviors.js `napalmParticleStep`). game.js napalm result handler updated: passes `game.wind` for lateral spread direction, applies EXE damage formula per explosion point (Hot Napalm: maxDmg=50, range=40 DS:0x5686/0x5682; Regular: maxDmg=30, range=25 DS:0x568E/0x568A; damage = floor(maxDmg - dist) through shield via `applyShieldDamage`), erases fire pixels on completion. No velocity vectors or damping — particles walk 1 pixel/step via `checkNapalmDirection()`.

#### HUD/Menu/Shop fidelity (from HUD_MENU_COMPARISON.md audit)
- [x] Add hotkey `~` underline rendering: EXE `text_display` (0x4C914) underlines the character after `~` (hotkey letter). Web `drawText()` in font.js skips `~` correctly but does NOT underline the next char. Menu labels like `~Start`, `S~ound...`, `Save ~Changes` show no hotkey indicator. Fix: set flag on `~`, draw 1px underline at y+FONT_HEIGHT-1 for next char. **DONE**: font.js `drawText()` — added `underlineNext` flag; when `~` (0x7E) encountered, sets flag; next char with w>0 gets a full-width underline drawn at `y+FONT_HEIGHT-1` using `setPixel` loop before the glyph is drawn. All menu labels (`~Start`, `S~ound...`, `Save ~Changes`, etc.) now show hotkey underlines matching EXE.
- [x] Fix submenu dialog width — hardcoded 220px: EXE dialog system (seg 0x3F19) computes width from content. Web uses `dlgW = 220` for all submenus. **DONE**: menu.js — added `computeSubmenuWidth(sub)` helper that measures title, footer ("ESC/Enter: Back"), and all item label+value pairs (widest possible value including `< >` arrows for all named options, min/max numeric values with suffix). Returns `max(titleW, footerW, max(labelW + gap + maxValW)) + 16px` padding. Used in both `drawSubmenu()` and `handleSubmenuInput()` mouse hit-testing (both previously hardcoded 220). Narrower dialogs (e.g., Sound with 2 items) now fit tightly; wider ones (e.g., Play Options with long names like "Winners-First") expand to fit.
- [x] Add shop Miscellaneous sub-category headers: EXE groups misc items under 5 headers — "Parachutes" (DS:0x2E5B), "Triggers" (DS:0x2E67), "Guidance" (DS:0x2E71), "Shields" (DS:0x2EFE), "Inventory" (DS:0x2EEF). Web shows flat list. **DONE**: shop.js — added `MISC_GROUPS` constant defining 5 sub-categories with header names and weapon indices (Guidance=[37-40], Parachutes=[41-42], Triggers=[56], Shields=[46-52], Inventory=[35,36,43-45,53-55]). `updateItemList()` inserts `{isHeader:true}` rows before each non-empty group. `adjustSelectionPastHeader(dir)` skips header rows during keyboard/mouse navigation. `drawShop()` renders headers as hline separator + tinted text (non-selectable). Info panel and buy/sell handlers check `isHeader` to skip header items.
- [x] Fix shop tab buttons — plain text vs 3D boxes: EXE renders tabs as 3D raised boxes (active=sunken) via dialog widget system. Web draws tab names as plain text with underline for active. **DONE**: shop.js `drawShop()` — replaced plain text tabs + underline with 3D boxes: inactive tabs use `drawBox3DRaised()`, active tab uses `drawBox3DSunken()`, text centered vertically inside each box with 6px horizontal padding. Done button also rendered as 3D raised box. Mouse hit-testing updated to match new box-based layout (variable-width tabs walked sequentially with 3px gap).
- [x] Fix embossed title X-position — manual fudge vs computed: EXE centers "Scorched Earth" in right panel accounting for 4px emboss shift. Web uses `centerXRight(titleStr) - 2` hardcoded. Fix: derive offset from emboss layer count (5 layers → 4px shift → offset = 2). **DONE**: menu.js `drawMainMenu()` — replaced hardcoded `- 2` with computed `Math.floor((embossLayers - 1) / 2)` where `embossLayers = 5`. font.js `drawTextEmbossed()` — loop bound changed from hardcoded `5` to `colors.length` for consistency.
- [x] Trace wind display string format (struct+0xB6): **RESOLVED — NOT wind, it's the player NAME**. struct+0xB6/+0xB8 is a far pointer to the player name string (already documented in Sub-Struct field table at line 2293). The HUD Row 1 Full sequence at 0x302ED sets VGA 163 = player's RGB color, then displays the player name at position E9DC. The **actual wind display** is a separate playfield indicator (function at 0x28F1D): formats "Wind: <magnitude>" or "No Wind" via `sprintf(DS:E05E, "%s: %d", "Wind", abs(wind))` (DS:0x505A/0x5061/0x5068 format strings, DS:0x2B04="Wind", DS:0x2B09="No Wind"), draws right-aligned at viewport top (X=screenW-textW-20, Y=viewportY+5) in VGA 154, plus a directional pixel-arrow triangle (5-column narrowing pattern at viewportY+10). Web port hud.js fixed: replaced "Wind: N"/"No Wind" at E9DC with player.name in player color. **Files**: hud.js, REVERSE_ENGINEERING.md
- [x] Add extended font characters CP437: EXE has 161 glyphs (95 ASCII + 66 CP437 extended 0x80-0xFD). Web has 95 ASCII only. Extract 66 glyphs from DS:0x70E4–0x94EA using font_dump.py, add GLYPHS_EXT/WIDTHS_EXT arrays to font.js. **DONE** (completed during RE investigation session — WIDTHS_EXT/GLYPHS_EXT already in font.js). **Files**: font.js
- [x] Add shop scrollbar widget: EXE uses full scrollbar from dialog system (seg 0x3F19:0x2CD1) — track, thumb, up/down arrows, drag. **DONE** (already implemented): shop.js has full 3D scrollbar — `drawBox3DRaised` up/down arrow buttons with triangle glyphs (▲/▼), `drawBox3DSunken` track, proportional `drawBox3DRaised` thumb, mouse drag support (scrollDrag/scrollDragY/scrollDragOff state), arrow button clicks, track page-up/down on click above/below thumb. SB_W=12px width, border-aware thumb positioning. **Files**: shop.js
- [x] Fix player setup screen layout fidelity: EXE uses dialog widget system — sunken input field, spinner widget, Tab key navigation, centered layout. Web had hardcoded Y positions (42, 48, 66), no Tab key, not resolution-aware. **DONE**: menu.js — `drawPlayerSetupScreen()` rewritten: centered raised dialog box (computed from screen dimensions), "Player N of M" title in player color, `~Name:` and `~Type:` labels with EXE-style hotkey underlines, individual sunken input boxes for both fields (name with blinking cursor, type with AI name), resolution-aware layout via `getPlayerSetupLayout()` helper (adapts to small/large mode). `handlePlayerSetupInput()` — added Tab key cycling between fields, mouse hit-testing updated to use computed dialog coordinates. Footer shows key hints inside dialog.
- [x] Remove `< >` arrow display on spinner values: Web shows `< N >` around spinner values when selected — not in EXE. EXE uses keyboard left/right arrows without visible `< >` indicators. **DONE**: menu.js — removed `'< ' + valStr + ' >'` formatting from main menu spinner rendering (line ~539) and submenu value rendering (line ~665); both now show just the value right-aligned. `computeSubmenuWidth()` updated to measure values without `< >` padding, producing tighter dialog widths. Player setup screen was already correct (uses sunken input fields, no arrows). **Files**: menu.js

#### Meta: fidelity audit (self-replicating)
- [ ] Full HUD/Menu/Shop fidelity re-audit: Read HUD_MENU_COMPARISON.md and all web/js UI files (hud.js, menu.js, shop.js, font.js). Compare every rendering detail against EXE behavior documented in REVERSE_ENGINEERING.md. For each remaining discrepancy found, add a new `- [ ]` task to this section with: what EXE does (with file offsets/DS refs), what web does wrong, and the fix. Also re-add this same meta audit task as a new `- [ ]` entry so it runs again after the next batch of fixes. Update HUD_MENU_COMPARISON.md with any new findings. **Files**: HUD_MENU_COMPARISON.md, REVERSE_ENGINEERING.md

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

- **Tank body pixel colors**: VGA 0-79 (0x00-0x4F), 8 colors per player
- **Player base VGA index**: `player_index * 8` (stored at sub-struct +0x1A)
- **Player index from pixel**: `pixel_value / 8` (integer division)
- **Tank collision threshold**: pixel < 0x50 (80) = tank body hit
- **Sky/background threshold**: color >= 0x69 (105) = solid ground
- **Special boundary colors**: 0x96 (150) and 0xA9 (169) — wall/obstacle detection
- **Tank hit marker**: 0xC8 (200) — drawn on top of damaged tank pixels
- **Dome gradient**: Uses 3 separate color globals (0xEF26, 0xEF2E, 0xEF30, 0xEF32)

#### Per-player 8-Color Gradient (file 0x28540)
```
Slot 0: (base_R/5, base_G/5, base_B/5)      — darkest
Slot 1: (base_R*2/5, base_G*2/5, base_B*2/5) — dark
Slot 2: (base_R*3/5, base_G*3/5, base_B*3/5) — medium
Slot 3: (base_R*4/5, base_G*4/5, base_B*4/5) — light
Slot 4: (base_R, base_G, base_B)              — full color
Slot 5: (63, 63, 63)                           — white flash
Slot 6: (base_R, base_G, base_B)              — base color
Slot 7: (30, 30, 30)                           — grey smoke
```

#### 10 Player Default Base Colors (DS:0x57E2)
| Player | Color | R | G | B |
|--------|-------|---|---|---|
| 0 | Red | 63 | 10 | 10 |
| 1 | Lime Green | 35 | 55 | 10 |
| 2 | Purple | 40 | 20 | 63 |
| 3 | Yellow | 63 | 63 | 10 |
| 4 | Cyan | 10 | 63 | 63 |
| 5 | Magenta | 63 | 10 | 63 |
| 6 | White | 60 | 60 | 60 |
| 7 | Orange | 63 | 40 | 20 |
| 8 | Sea Green | 20 | 63 | 40 |
| 9 | Blue | 0 | 0 | 63 |

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

### In-Game Tank Rendering — Pixel Table System

**CORRECTION**: Previous documentation described two asymmetric dome shapes at file 0x3FC9A. This was incorrect. The in-game tank rendering uses a **pixel data table** system, not hardcoded hline+point calls.

**Pixel table** at DS:0x673E, 18 bytes per entry, indexed by tank type (sub[0x00]):

| Type | DS Offset | Pixels | Shape Description |
|------|-----------|--------|-------------------|
| 0 | DS:0x649C | 35 | Classic dome: 9×5 semicircle, concentric color rings |
| 1 | DS:0x6640 | 24 | Low profile: 9×4, dashed outline pattern |
| 2 | DS:0x6577 | 31 | Antenna tank: 11×6, asymmetric antenna left, tread dots |
| 3 | DS:0x65D7 | 34 | Tall antenna: 9×7, 2px antenna + turret bar |
| 4 | DS:0x6508 | 36 | Turret tank: 11×5, offset dome cap |
| 5 | DS:0x668B | 17 | Small tank: 7×5, minimal body |

**Pixel data format**: 3-byte entries `[x_offset_i8, y_offset_i8, color_index_u8]`, terminated by sentinel byte 0x63. Color values 0-3 are offsets from the player's base palette color (sub[+0x1A]).

**Direction handling** (sub[+0x94] = turret_direction, +1 or -1):
- Direction +1 (right): `X = tank.X + x_offset`
- Direction -1 (left): `X = tank.X - x_offset` (X mirrored)
- Y is always: `Y = tank.Y + y_offset` (unchanged by direction)

The dome shape is **identical** for both directions — direction only mirrors the X axis. Types 0 and 1 are X-symmetric so both directions look the same. Types 2-5 have asymmetric features (antenna, protrusions) that flip horizontally.

**Type 0 pixel art** (default tank dome, color 0=outline → 3=interior):
```
y=-4: ...000...
y=-3: .0011100.
y=-2: .0122210.
y=-1: 012333210
y= 0: 012333210
```

**Draw function chain** (in-game):
1. `draw_tank_setup` (file 0x3FC7D): validate visibility, set up barrel globals (DS:EE4A-EE50), call barrel erase (0x171B:0x0733), then call draw_tank_complete
2. `draw_tank_complete` (file 0x3FB27): call draw_body (pixel table), draw barrel, draw parachute, draw shield
3. `draw_tank_type` (file 0x40A75): look up pixel data far ptr from DS:0x673E[type*18], call pixel renderer
4. `render_pixel_table` (file 0x40C19): iterate pixel data, direction-check mirrors X, call `point_with_clip` (0x40ABB) for each pixel

**Color globals** (EF26=highlight, EF2E=body fill, EF30=shadow) are used by the **panel/HUD rendering** (icons.cpp at 0x26527), NOT the in-game pixel table renderer. The in-game renderer uses palette offsets 0-3 from the pixel data directly.

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

if (pixel < 0x50):  // color range 0-79 = tank pixels
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
| Tank pixel color range | N/A | N/A | VGA 0-79 (8 per player, player_index*8) |
| Players (max) | N/A | N/A | 10 players, pixel/8 = player index |

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

## Play Order System — player.cpp (VERIFIED from disassembly)

### Overview

The PLAY_ORDER config variable (DS:0x519C) controls the turn sequence within each round. The play order function at file 0x2AE53 is called at the start of each round. It fills the order array at DS:0xE4F6 (array of far pointers to tank structs, 4 bytes/entry) and sets the start index DS:0xE4F4.

### Play Order Enum (DS:0x519C, 5 options)

Name table at DS:0x62E4 (BSS, initialized at file 0x3DA90 from static far pointers). Config key `PLAY_ORDER\0` at DS:0x0541, format `PLAY_ORDER=%s\n` at DS:0x0A03. Config parser at file 0x1A4C0 loops si=0..4, comparing input string against name table entries, stores match index into DS:0x519C.

| Index | String | DS Source Ptr | Code Block | Behavior |
|-------|--------|---------------|------------|----------|
| 0 | Random | DS:0x2787 | 0x2AE77–0x2AF26 | Fill order sequentially, Fisher-Yates shuffle (50 swaps), `random(2)` start |
| 1 | Losers-First | DS:0x2CFA | 0x2AF29–0x2B038 | Fill + shuffle, rotate start via DS:0x51A4 tracking (first player's ID ±1 next round) |
| 2 | Winners-First | DS:0x2D07 | 0x2B03B–0x2B0B9 | Sort players by score (`sort_players(buf,1)` at 0x2CC4:0x0184), fill order array in **reverse** sorted order (highest first), random start |
| 3 | Round-Robin | DS:0x2D15 | 0x2B0BB–0x2B131 | Sort players by score (same sort call), fill order array in **forward** sorted order (lowest first), random start |
| 4 | Sequential | DS:0x2803 | (skips to 0x2B133) | No modification to order array — uses existing/default player index order |

Default in SCORCH.CFG: `PLAY_ORDER=Random` (index 0).

### Dispatch Code (file 0x2AE64)

```
mov bx, [DS:0x519C]     ; PLAY_ORDER
cmp bx, 3
jbe use_jump_table       ; cases 0-3 via CS:0x0E7C jump table
jmp 0x2B133              ; case 4 (Sequential) → skip order modification
```

### Case 0 — Random (file 0x2AE77)

1. Fill order array: `order[i] = far_ptr(DS:0xD568 + i*0xCA)` for i=0..NUM_PLAYERS-1
2. Fisher-Yates shuffle: 50 iterations, each picks two `random(NUM_PLAYERS)` indices and swaps
3. Start index: `random(2)` → stored in DS:0xE4F4

### Case 1 — Losers-First (file 0x2AF29)

1. Fill order array sequentially (same as case 0)
2. Fisher-Yates shuffle (50 iterations)
3. Start position tracking via DS:0x51A4:
   - If DS:0x51A4 == -1 (first round): `random(NUM_PLAYERS)` start
   - Else: start = DS:0x51A4 + 1 (wrapping mod NUM_PLAYERS)
   - Scan order array to find slot matching the target player's tank struct
4. Save first player's `struct+0xA0` (player_id) to DS:0x51A4 for next round

### Case 2 — Winners-First (file 0x2B03B)

1. Random start: `random(NUM_PLAYERS)` → DS:0xE4F4
2. Sort players: `sort_players(buffer, 1)` — sorts player indices by score
3. Fill order array reading sorted buffer in **reverse** order: `buffer[NUM_PLAYERS - si]`
4. Rotate order to start at the random position

### Case 3 — Round-Robin (file 0x2B0BB)

1. Random start: `random(NUM_PLAYERS)` → DS:0xE4F4
2. Sort players: `sort_players(buffer, 1)` — same sort as case 2
3. Fill order array reading sorted buffer in **forward** order: `buffer[si]`
4. Rotate order to start at the random position

### Case 4 — Sequential (falls through to 0x2B133)

No code — the order array is not modified. Players fire in their existing index order (0, 1, 2, ..., N-1) from previous initialization.

### Key Data Locations

| Address | Type | Name | Purpose |
|---------|------|------|---------|
| DS:0x519C | int16 | PLAY_ORDER | Config variable, enum 0-4 |
| DS:0x51A4 | int16 | last_round_starter | Tracks first player's ID for Losers-First rotation |
| DS:0xE4F4 | int16 | turn_start_index | Which slot in order array fires first |
| DS:0xE4F6 | far_ptr[] | turn_order_array | Array of far pointers to tank structs (4 bytes × NUM_PLAYERS) |
| DS:0x62E4 | far_ptr[] | play_order_names | BSS name table (8 bytes × 5), init at 0x3DA90 |
| DS:0x0541 | string | "PLAY_ORDER" | Config key |
| DS:0x0A03 | string | "PLAY_ORDER=%s\n" | Config format string |
| DS:0x50D4 | int16 | NUM_PLAYERS | Number of players in game |

### Web Port Discrepancies (Fixed)

**Before fix**: Web port used wrong enum (0=Sequential, 1=Random, 2=Losers First, 3=Winners First), missing Round-Robin, wrong default. Config comment conflated PLAY_ORDER with PLAY_MODE.

**After fix**: Enum corrected to 0=Random, 1=Losers-First, 2=Winners-First, 3=Round-Robin, 4=Sequential. Round-Robin added. Default set to 0 (Random). Config comment corrected. Note: behavioral implementation (EXE's shuffle+rotate for Losers-First, score-sort+rotate for Winners/Round-Robin) is approximate — web port sorts by score for cases 1-3 which matches the practical effect.

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

## Terrain Generation Algorithm — ranges.cpp (VERIFIED from disassembly)

### Overview

The terrain generation system lives in `ranges.cpp` (code segment 0x2CBF, file base ~0x33690). Main entry point at file **0x3971F**. The core height generation algorithm is a **random walk with momentum** — not midpoint displacement or sine sums. A 7-way jump table dispatches terrain type-specific handlers.

### 7 Terrain Types

| Type | Name | Handler Offset | Height Method | Palette Theme |
|------|------|---------------|---------------|---------------|
| 0 | **Flat** | 0x39959 | Constant height | Blue Ice (31,9,9) |
| 1 | **Slope** | 0x3997B | Linear slope L-to-R | Snow/Ice (29,29,63→0,0,63) |
| 2 | **Rolling** | 0x399E2 | LandGenerator + random aux | Rock/Gray (7,7,7→63,63,63) |
| 3 | **MTN** | 0x39A66 | ScannedMountain from .mtn files | Night gray |
| 4 | **V-Shaped** | 0x39AB8 | Symmetric V centered | Desert/Lava |
| 5 | **Castle** | 0x39BCC | Ramparts + slope or V-shape | Varied |
| 6 | **Cavern** | 0x39CC0 | Mountains + slope (underground) | 3-band gradient |

### drawColumn — Per-Column Terrain Renderer (file 0x29720)

Called from the random walk kernel for each column. Draws terrain from the current height to the screen edge.

```c
// drawColumn(LandGenerator *this, int screen_x, int y_height)
// file 0x29720, segment 22D2

void drawColumn(LandGenerator *this, int screen_seg, int col, int y) {
    // Clamp y to [start_bound, end_bound + 20]
    if (y < this->start_col) y = this->start_col;
    if (y > this->end_col + 20) y = this->end_col + 20;

    if (terrain_type == 0) {
        // TYPE 0 (Flat): single-color vertical line
        draw_vline(col, y, end_bound, 120);   // palette 120 = terrain base
    } else {
        // ALL OTHER TYPES: per-pixel rendering loop
        for (int row = y; row <= end_bound; row++) {
            setTerrainPixel(col, row);    // 0x32C2:0x1519
        }
    }

    // Draw sky/ground boundary line with color 0x50 (palette 80 = sky base)
    draw_vline(col, end_bound, y - 1, 80);
}
```

### setTerrainPixel — Per-Pixel Color Function (file 0x3AB39)

7-way dispatch on terrain_type (DS:0x5110). Determines palette index for each individual terrain pixel.

```c
// setTerrainPixel(int x, int y) — file 0x3AB39, segment 31D8:23B9
// Jump table at CS:0x16E5 (7 entries, some corrupted by MZ relocations)
void setTerrainPixel(int x, int y) {
    switch (terrain_type) {
    case 0: // Flat: solid palette 120
        fg_setpixel(x, y, 120);
        break;

    case 1: // Slope: pure Y-gradient from height_array
    case 5: // Castle: same as Slope (palette differs)
    case 6: // Cavern: same as Slope (palette differs)
        // handler at 0x3ACE7 — all three share identical code
        fg_setpixel(x, y, height_array[y]);
        break;

    case 2: // Rolling/Rock/Gray: bitmap + aux_array texture
        // bitmap_array[x] has per-column bitmask (1 bit per row)
        bit = bitmap_array[x][y / 8] & (1 << (y & 7));
        if (!bit) {
            fg_setpixel(x, y, 120);    // base terrain
        } else {
            remainder = abs((aux_array[y] * x) % 30);
            color_offset = remainder - height_array[y];
            if (color_offset < 1)
                fg_setpixel(x, y, 120);
            else
                fg_setpixel(x, y, color_offset + 120);  // 120-149 range
        }
        break;

    case 3: // MTN/Night: bitmap + depth gradient
        // handler at 0x3AC0C
        bit = bitmap_array[x][y / 8] & (1 << (y & 7));
        if (!bit) {
            fg_setpixel(x, y, height_array[y]);    // terrain color from palette
        } else {
            depth = (y - screen_y_base) / depth_divisor;  // DS:ECBE
            if (depth > 20) depth = 20;
            fg_setpixel(x, y, depth + 130);         // VGA 130-150 depth gradient
        }
        break;

    case 4: // V-Shaped/Desert: bitmap reversed logic
        // handler at 0x3AC88
        bit = bitmap_array[x][y / 8] & (1 << (y & 7));
        if (bit) {
            fg_setpixel(x, y, 120);                 // bit set = solid terrain base
        } else {
            fg_setpixel(x, y, height_array[y]);     // bit clear = gradient color
        }
        break;
    }
}
```

**Key insights**:
- Type 2 (Rolling) uses a **textured pattern** dependent on both X and Y via random per-row data (`aux_array[y] * x % 30`), creating the rocky/scattered appearance.
- Types 1, 5, 6 all share the **same pixel coloring code** (pure Y-gradient); the visual difference comes entirely from the palette loaded into `height_array[]` during terrain generation.
- Type 3 (MTN) has a unique **depth gradient** (VGA 130–150) for areas where the bitmap bit is set, creating a fade-to-dark effect in mountain recesses.
- Type 4 (V-Shaped) **reverses** the bitmap logic vs Type 3: bit=1 → solid 120, bit=0 → gradient.

### Height Generation Kernel: Random Walk (file 0x29808)

```c
int walk_delta = 0;
int y = random(y_end - y_start - 60) + y_start + 40;
int current_col = this->start_col;

while (true) {
    drawColumn(this, screen_seg, current_col, y);

    if (random(100) < this->flat_chance) {    // 20% default: maintain trajectory
        // no change to walk_delta
    } else {
        walk_delta = random(3) - 1;           // {-1, 0, +1}
        if (random(100) < this->bump_chance)  // 20% default: amplify
            walk_delta *= 2;                  // {-2, 0, +2}
    }

    if (this->flatten_peaks && (walk_delta < -3 || walk_delta > 3))
        walk_delta = 0;                       // suppress extreme slopes

    y += walk_delta;

    // Clamp with bounce-back
    if (y < y_start + 40) { y = y_start + 40; if (walk_delta < 0) walk_delta = 1; }
    if (y > y_end - 1)    { y = y_end - 1;    if (walk_delta > 0) walk_delta = 0; }

    current_col += this->direction;
    if (direction == +1 && current_col > end_col) break;
    if (direction == -1 && current_col < start_col) break;
}
```

**Key properties**: Momentum (walk_delta persists), flat_chance creates plateaus, bump_chance creates ridges, no smoothing pass — single-pass generation.

### LandGenerator Object Layout (16 bytes)

| Offset | Field | Default | Purpose |
|--------|-------|---------|---------|
| +0x00 | vtable (far) | DS:5078 | DefaultLand vtable |
| +0x04 | start_col | left bound | Starting column |
| +0x06 | end_col | right bound | Ending column |
| +0x08 | direction | +1 | L-to-R (+1) or R-to-L (-1) |
| +0x0A | flat_chance | 20 | % chance of maintaining delta |
| +0x0C | bump_chance | 20 | % chance of doubling delta |
| +0x0E | flatten_peaks | 0 | Clamp extreme deltas to ±3 |

### LAND1/LAND2 Parameter Mapping

| Variable | DS Offset | Range | Default | Purpose |
|----------|-----------|-------|---------|---------|
| LAND1 (bumpiness) | DS:5170 | 0-100 | 20 | Terrain roughness |
| LAND2 (slope) | DS:5172 | 0-1 | 0 | Adds slope component |
| numPeaks | DS:516E | 0-100 | 20 | Mountain count (type 3) |
| FLATLAND | DS:5174 | - | 1000 | Flat terrain param |
| RANDOM_LAND | DS:5176 | 0-1 | 0 | Randomize each round |
| MTN_PERCENT | DS:5178 | double | 1.0 | Mountain amplitude scale |

**RANDOM_LAND** (file 0x29558): Each round randomizes LAND2=rand(2), numPeaks=rand(100), LAND1=rand(100).

### 3-Band Sky Palette (Types 3, 5, 6)

```c
// Band 1 (entries 0-9): blue-green sky
for (i = 0; i < 10; i++) {
    t = (9.0 - i) / 10.0; inv_t = 1.0 - t;
    R = inv_t * 20; G = t * 63 + inv_t * 20; B = t * 63 + inv_t * 63;
}
// Band 2 (entries 10-19): transition to warm
for (i = 0; i < 10; i++) {
    t = (9.0 - i) / 10.0; inv_t = 1.0 - t;
    R = t * 20 + inv_t * 63; G = t * 20 + inv_t * 29; B = t * 63 + inv_t * 29;
}
// Band 3 (entries 20-28): warm earth tones
for (i = 0; i < 9; i++) {
    t = (9.0 - i) / 10.0; inv_t = 1.0 - t;
    R = t * 63 + inv_t * 31; G = t * 29 + inv_t * 9; B = t * 29 + inv_t * 9;
}
```

### Mountain Drawing (file 0x43ACA)

Bresenham-like octant stepping for mountain silhouettes. Used by type 3 (MTN):
```c
srand(1.0 * 1.8);
current_x = 0;
while (current_x < screen_width) {
    int mtn_height = random(20) + 30;   // 30-50 pixels
    int spacing = random(20) + 15;       // 15-35 pixel gap
    mountain_draw(current_x, start_y, mtn_height, column_callback);
    current_x += spacing;
}
```

### Per-Type Height Generation Handlers (VERIFIED from disassembly)

Each terrain type has a handler in the main terrain gen function (0x3971F) that sets up palette, height_array, bitmap_array, and aux_array, then optionally runs the random walk kernel.

**Type 0 — Flat** (handler at 0x39959):
- Palette: 30 entries of blue-ice gradient `(0, 29-i, 29-i)` for VGA 120–149
- Height: constant — all columns same Y; no random walk
- No bitmap or aux arrays used

**Type 1 — Slope** (handler at 0x3997B):
- Palette: 30 entries gray gradient via `setcolor(i, 63, 29-i, 29-i)` (white→dark)
- height_array[y] = `(screen_bottom - y) * 29 / screen_height + 120` — linear slope, lighter at bottom
- LandGenerator runs random walk with slope component

**Type 2 — Rolling** (handler at 0x399C1):
- Checks bitmap array ptr (DS:623E); if null → **falls back to Type 0** (sets TERRAIN_TYPE=0, recursive call)
- Palette: 29 entries gray gradient `(i*2+7, i*2+7, i*2+7)` for VGA 121–149
- aux_array[y] = `rand(32000)` — random texture seed per row
- height_array[y] = `30 - (screen_bottom - y) * 29 / screen_height` — inverted depth (darker at bottom)
- Runs LandGenerator random walk

**Type 3 — MTN/Night** (handler at 0x39AEF, falls through to Type 4 shared code at 0x39B40):
- Checks DS:0x624A (scanned_mtn_flag); if not loaded → **falls back to Type 0**
- **Palette Loop 1** (di=0..9, 10 entries → VGA 120–129): `fg_setrgb(di, R=di, G=di, B=di+30)` — **blue tint** gradient (NOT greenish as previously documented). Blue channel leads by +30, creating dark blue tones. VGA 120=(0,0,30) dark blue → VGA 129=(9,9,39) slightly brighter blue-gray.
- **Palette Loop 2** (di=10..29, 20 entries → VGA 130–149): `fg_setrgb(di, R=(di-10)*2, G=(di-10)*2, B=(di-10)*2)` — **gray depth gradient** from black to medium gray. VGA 130=(0,0,0) black → VGA 149=(38,38,38). This is the depth palette for mountain recesses (setTerrainPixel case 3: `depth + 130`).
- `fg_setdacs(120, 30)` uploads palette buffer to VGA DAC 120–149.
- **Falls through** to Type 4 shared code: depth_divisor, 9-level height_array, bitmap fill, LandGenerator.
- height_array[y] = `(screen_bottom - y) * 9 / screen_height + 120` — 9-level gradient (VGA 120–128)
- setTerrainPixel case 3: bitmap NOT set → height_array[y] (blue gradient VGA 120–128); bitmap SET → `depth + 130` capped at depth=20 (gray gradient VGA 130–150). Note: VGA 150 not explicitly set by palette loops (only 120–149 initialized); depth cap of 20 can reach VGA 150.
- bitmap_array columns filled with rand() data for texture mask
- LandGenerator called with scanned mountain callback (0x32C2 = setTerrainPixel) and column count from screen dimensions

#### Night/MTN Palette Detail

| VGA | R | G | B | Source |
|-----|---|---|---|--------|
| 120 | 0 | 0 | 30 | Loop 1: terrain gradient (darkest) |
| 121 | 1 | 1 | 31 | |
| 122 | 2 | 2 | 32 | |
| 123 | 3 | 3 | 33 | |
| 124 | 4 | 4 | 34 | |
| 125 | 5 | 5 | 35 | |
| 126 | 6 | 6 | 36 | |
| 127 | 7 | 7 | 37 | |
| 128 | 8 | 8 | 38 | Loop 1: terrain gradient (surface, brightest) |
| 129 | 9 | 9 | 39 | Loop 1: unused by height_array (max 128) |
| 130 | 0 | 0 | 0 | Loop 2: depth gradient (shallowest recess) |
| 131 | 2 | 2 | 2 | |
| 132 | 4 | 4 | 4 | |
| 133 | 6 | 6 | 6 | |
| 134 | 8 | 8 | 8 | |
| 135 | 10 | 10 | 10 | |
| 140 | 20 | 20 | 20 | |
| 145 | 30 | 30 | 30 | |
| 149 | 38 | 38 | 38 | Loop 2: depth gradient (deepest recess) |

**Type 4 — V-Shaped** (handler at 0x39B40, shared with Type 3 after palette):
- Sets depth_divisor (DS:ECBE): 3 if screen_width == 0x167 (359), else 2
- Palette: height_array[y] = `(screen_bottom - y) * 9 / screen_height + 120` — shallow gradient (only 9 levels)
- bitmap_array column fill + LandGenerator random walk
- FPU-computed 3-band Sunset-style palette for VGA 120–149 (using DS:6258–6270 float constants)
- V-shape: LandGenerator creates symmetric terrain centered on screen

**Type 5 — Castle** (handler at 0x39C31):
- Checks scanned_mtn_flag; if not loaded → **falls back to Type 0**
- Sets DS:50D8 = 1 (is_castle_terrain flag)
- Palette: `setGradientPalette(120, 63, 63, 0, 1)` + 3-band FPU gradient (same Sunset formula)
- Height: loop generating **multiple LandGenerator segments** with random gaps: each segment runs `rand(20)+30` columns wide with `rand(20)+15` gap spacing → creates rampart/battlement shapes
- Creates LandGenerator with callback at 0x3C70:0x09CA

**Type 6 — Cavern** (handler at 0x39CC0):
- Similar palette setup to Type 5 (3-band gradient)
- Mountains + slope underground; terrain drawn from top AND bottom to create enclosed cave
- Shares height_array gradient code with Types 1/5

### Key Data Structures for Terrain

| DS Offset | Name | Purpose |
|-----------|------|---------|
| DS:0x5110 | TERRAIN_TYPE | Current type (0–6) |
| DS:0x6242 | height_array | Far ptr; per-row palette index lookup (size = (screen_rows+1)*2) |
| DS:0x6246 | bitmap_array | Far ptr; per-column bitmasks (1 bit/pixel; determines texture vs solid) |
| DS:0x623E | aux_array | Far ptr; per-row random seed values for Rolling texture |
| DS:0x624A | scanned_mtn_flag | 1=MTN file loaded; 0/-1=unavailable → fallback to Flat |
| DS:0x624C | terrain_cached | 1=reuse previous terrain; 0=regenerate |
| DS:0xECB8 | screen_height | EF38 − EF40 (total playfield height in pixels) |
| DS:0xECBA | bitmap_col_bytes | (screen_rows+9)/8 + 1 — bytes per column in bitmap_array |
| DS:0xECBE | depth_divisor | Used by Type 3 MTN for depth gradient (VGA 130+) |

### HOSTILE_ENVIRONMENT System (VERIFIED from disassembly)

**Config variable**: DS:0x513C (HOSTILE_ENVIRONMENT), read from `HOSTILE_ENVIRONMENT=On/Off` in config parser (file 0x3CBBC: `mov [0x513C], ax`).

**4 references found**:
| File Offset | Context |
|-------------|---------|
| 0x3C1A2 | Config dialog: pushes DS:0x513C value for display |
| 0x3CBAC | Config parser: compares loaded value |
| 0x3CBBC | Config parser: stores parsed On/Off → DS:0x513C |
| 0x3EB72 | Projectile collision: conditional tank damage |

**Projectile collision handler** (file 0x3EB60, seg 34ED:3290):
```c
// Part of per-pixel projectile movement function
pixel = fg_getpixel(x, y);   // file 0x3EB62

if (pixel < 0x50) {           // Tank hit (VGA 0-79 = tank body)
    if (HOSTILE_ENVIRONMENT) { // DS:0x513C != 0
        player_idx = pixel / 8;
        tank_ptr = player_idx * 0xCA + 0xD568;
        damage_tank(10, tank_ptr, 1);  // call 0x3912:0x04B2 with args (1, 10, tank_far_ptr)
    }
    // Store hit position, set dirty flags
    hit_x = x; hit_y = y;
    dirty_x = 1; dirty_y = 1;
}
else if (pixel >= 0x69) {      // Ground hit (VGA 105+ = terrain)
    // Track bounding box for explosion area
    // Draw white pixel (0xFF) at impact point
    fg_setpixel(x, y, 255);
    // random(10) check for secondary effects
}
```

**Key behavior**: When HOSTILE_ENVIRONMENT is On, any projectile passing through a tank pixel inflicts **1 unit of damage per pixel traversed** via `damage_tank(10, tank_ptr, 1)`. The first argument (10) is likely the damage type/source, and the third (1) is the damage amount. This creates a "hostile" environment where projectiles that clip tanks during flight do incremental damage even before the final explosion.

**Intermediate files**: `disasm/terrain_generation_analysis.txt`

---

## Falling Tank / Impact Damage System (VERIFIED from disassembly)

### Overview

When terrain is removed by an explosion, unsupported tanks fall to the new terrain level. The fall handler function is at file **0x205DC** (seg 0x19BD, `enter 0x007A`). The system is controlled by three config flags:

| DS Offset | Config Key | Values | Default | Purpose |
|-----------|-----------|--------|---------|---------|
| DS:0x5162 | FALLING_TANKS | 0=Off, 1=On | On | Enable/disable tank falling |
| DS:0x5114 | DAMAGE_TANKS_ON_IMPACT | 0=Off, 1=On | On | Fall damage delivery mode |
| DS:0x5116 | FALLING_DELAY | integer | 10 | Animation speed for falling |

### Fall Damage Constant

**DS:0x5164 = 2** — hardcoded fall damage per pixel. Never written by code; initialized from data segment. Total fall damage for a fall of N pixels = 2 × N.

### Fall Handler Algorithm (file 0x205DC)

```
function handle_falling_tanks():
    frame_counter++                              // DS:0x1C68

    // Per-player init: zero out fall_damage_accum[] and needs_fall[]
    for each player (si = 0..NUM_PLAYERS-1):
        fall_damage_accum[player] = 0            // DS:0xCE80[player*2]
        needs_fall[player] = check_needs_fall()  // DS:0xCE58[player*2]

    // Main fall loop: repeat until no tanks move
    while any_tank_moved:
        for each falling tank (via iterator at 0x2A16:0x1606):
            if tank_has_parachute (tank[0x0C] != 0):
                // Parachuted tanks fall at half speed (skip every other frame)
                if frame_counter % 2 == 0: skip

            // Erase old position, move tank down, redraw
            tank[0x0E] += step_amount       // Y position
            tank[0x10]++                    // fall distance counter

            // Wind slide: if abs(WIND) > 10, tank slides horizontally
            // (complex lateral movement logic at 0x20937-0x209BC)

            // Parachute deployment check (0x208CD):
            if tank[0x2C] > 0:              // parachute inventory
                call check_deploy(tank)     // near call 0x202F6
                if should_deploy:
                    sound(0x1E, 2000)        // deployment sound
                    set_flash_color(tank)    // RGB 63,63,63 highlight
                    tank[0x0C] = 1           // mark parachute deployed

            // Clamp Y to screen bounds (EF42+9 .. EF3C-9)

            // Redraw tank: call 0x3912:0x0007(tank, 0, 0)

            // === DAMAGE LOGIC (per step) ===
            if tank[0x0C] == 0:             // NO parachute
                fall_damage_accum[player] += 2          // always accumulate
                if DAMAGE_TANKS_ON_IMPACT == 0 (Off):   // DS:0x5114
                    damage_tank(tank, 2, 1)              // per-step damage
            else:                            // HAS parachute
                if DAMAGE_TANKS_ON_IMPACT == 0 (Off):
                    damage_tank(tank, 0, 1)              // no-op (0 damage skipped)
                delay(20)                                // slow landing animation

    // === PER-STEP CRUSH DETECTION (0x20690–0x20717) ===
    // Scans pixels below falling tank, column by column:
    //   pixel >= 0x69: solid terrain (ignored for crush)
    //   pixel 0x50-0x68: sky/effects (ignored)
    //   pixel < 0x50: another tank → hit_player = pixel / 8
    // Stores crushed tank substruct far ptr in local array:
    //   crushed_tank[faller_player] = DS:D568 + hit_player * 0xCA
    // If >2 columns overlap (0x2071C): immediate landing on that tank
    // If 1-2 columns overlap (0x207CB): sound(5, 200) glancing ping, continue falling

    // === POST-LANDING PHASE (after all tanks settled) ===
    for each player that fell (landing_flag[player] != 0):   // [bp-0x7A]
        sound(0x1E, 0xC8)                               // impact thud (200 Hz)
        if DAMAGE_TANKS_ON_IMPACT != 0 (On):             // DS:0x5114
            damage_tank(tank, fall_damage_accum[player], 1)  // total impact damage

        // Crush damage — ONLY when landed on another tank (0x20B09)
        if crushed_tank[faller_player] != NULL:           // [bp-0x66 + player*4]
            save DS:5182/5184                             // save current attacker ptr
            DS:5182/5184 = falling_tank                   // set faller as attacker
            sound(0x1E, 0xC8)                             // second thud (200 Hz)

            // Deal crush damage to victim through shield (0x20B4C)
            accum = fall_damage_accum[player]             // DS:CE80[player]
            shield_and_damage(crushed_tank, accum + 50, 1)  // at 0x3912:0x04B2
            // shield_and_damage: increments attacker stats (+0x52, +0x66),
            // calls shield_absorb_damage, remaining damage via damage_tank(victim, rem, 0)

            restore DS:5182/5184

            // Faller self-damage from crushing impact (0x20B8C)
            damage_tank(falling_tank, accum/2 + 10, 1)   // round-toward-zero division
```

### Crush Damage Summary (VERIFIED from disassembly)

The "landing crater explosion" is actually a **crush damage** mechanic. It does NOT always fire — it only triggers when a falling tank lands directly on top of another tank (detected by pixel scan finding >2 columns of overlap).

| Damage Target | Formula | Through Shield? | Address |
|---------------|---------|-----------------|---------|
| Crushed victim | faller_accum + 50 | Yes (shield_absorb_damage first) | 0x20B4C → 0x3912:0x04B2 |
| Falling tank (self) | faller_accum/2 + 10 | No (direct damage_tank) | 0x20B8C |
| Impact damage (self) | faller_accum | No (direct damage_tank) | 0x20AE4 (if DAMAGE_ON_IMPACT=On) |

**Example**: Tank falls 30 pixels (accum = 60). Lands on another tank with shield.
- Impact self-damage: 60
- Crush damage to victim: 60 + 50 = 110 (reduced by shield)
- Crush self-damage: 60/2 + 10 = 40
- Total self-damage: 60 + 40 = 100

### Damage Mode Summary

The **total fall damage is identical** in both modes (2 × fall_distance). The setting controls **when** damage is applied:

| DAMAGE_TANKS_ON_IMPACT | During Fall | On Landing | Visual |
|------------------------|-------------|------------|--------|
| Off (0) | 2 damage/pixel (continuous) | None | Health decreases gradually |
| On (1, default) | None (accumulate only) | 2 × total_pixels | Single big hit on impact |

### Parachute Deploy Mechanics (VERIFIED from disassembly)

**Sub struct field `sub[0x2C]`** = deploy damage threshold (NOT inventory count as previously documented):
- Default = **5** (set at init 0x30F0E and per-turn 0x18852)
- With **Battery** item (inventory[DS:D556] > 0): **10** (set at 0x18872)
- Meaning: parachute only deploys if predicted fall damage **exceeds** this threshold

**Guard checks** before deploy (0x20871–0x208CA):
1. `sub[0x28] != 0` — parachute check enabled flag (cleared at 0x208C2 when inventory empty)
2. Health > 0 — `sub[0xA4]:sub[0xA2]` 32-bit check (skip if dead)
3. `inventory[42] > 0` — has parachutes (accessed via `sub[0xB2]` far ptr + DS:D554×2)
4. If inventory ≤ 0: set `inventory[42] = 0`, set `sub[0x28] = 0`, skip

**Deploy condition** (0x208CD–0x208E8):
- `check_deploy(tank)` at 0x202F6 simulates remaining fall: scans terrain below tank column-by-column, steps downward accumulating `DS:0x5164` (=2) per pixel, returns predicted total damage
- If `sub[0x2C] == 0`: deploy immediately (dead code in practice — always 5 or 10)
- If predicted_damage > `sub[0x2C]`: deploy
- If predicted_damage ≤ `sub[0x2C]`: don't deploy (fall is too short to warrant parachute)

**Deploy action** (0x208EA–0x20913):
- `sound(30, 2000)` — deployment tone (0x1E duration, 0x07D0 Hz)
- `fg_setrgb(sub[0x1A]+6, 63, 63, 63)` — flash palette entry to white
- `sub[0x0C] = 1` — mark parachute as deployed

**Half-speed fall** (0x20626–0x2063A):
- Frame counter `DS:0x1C68` incremented each outer loop iteration (0x205F4)
- When `sub[0x0C] == 1`: check `frame_counter % 2`; skip iteration if even (remainder == 0)
- Result: parachuted tank falls on odd frames only = **half speed**

**Per-step behavior** (0x20A41–0x20A96):
- No parachute (`sub[0x0C] == 0`): accumulate `FALL_DAMAGE_PER_PIXEL` (2) into DS:CE80[player]; optionally deal per-step damage (DAMAGE_ON_IMPACT=Off)
- Parachute deployed (`sub[0x0C] == 1`): NO damage accumulation; `damage_tank(tank, 0, 1)` = no-op; `delay(20)` for visual effect

**Key differences from web port**:
- Web port checks inventory at loop start and applies immediately — EXE deploys mid-fall after threshold check
- Web port has no speed reduction — EXE halves fall speed (frame skipping) + delay(20)
- Web port has no deploy threshold — EXE requires predicted damage > 5 (or 10 with Battery)
- Web port has no deploy sound/flash — EXE plays tone and flashes white
- Web port decrements inventory on landing — EXE deployment code does not visibly decrement inventory (consumption may occur in post-round cleanup)

### damage_tank Function (0x2A16:0x0FE8, file 0x31B48)

Signature: `damage_tank(tank_far_ptr, amount, flag)`

- `flag` ([bp+0x0A] = di) — always 1 for fall damage
- If `flag > 0`: subtract `amount` from `tank[0xA2]` (health), capped at 0
- If `flag <= 0`: different branch (healing/other)
- If `amount == 0`: early return (no-op) — used for parachute branch
- Tracks damage stats: increments kill/damage counters at `tank[0x52]` and `tank[0x66]`
- Delegates to `0x3098:0x0308` for actual HP subtraction and visual effects

### Key File Offsets

| Address | Description |
|---------|-------------|
| 0x18852 | Per-turn: set `sub[0x2C] = 5` (deploy threshold default) |
| 0x18872 | Per-turn: set `sub[0x2C] = 10` (if Battery owned) |
| 0x202F6 | `check_deploy(tank)` — simulate fall, return predicted damage |
| 0x205DC | `handle_falling_tanks` entry (enter 0x007A) |
| 0x20626 | Parachute half-speed check (frame_counter % 2) |
| 0x208CD | Parachute deployment threshold check (`sub[0x2C]`) |
| 0x208EA | Deploy action: sound + flash + set flag |
| 0x20913 | Set tank[0x0C]=1 (parachute deployed) |
| 0x20937 | Wind-based horizontal slide during fall |
| 0x20A41 | Per-step damage branch (parachute check) |
| 0x20A59 | DAMAGE_TANKS_ON_IMPACT check (per-step) |
| 0x20A8F | Parachute delay(20) per step |
| 0x20AE4 | DAMAGE_TANKS_ON_IMPACT check (post-landing) |
| 0x20B09 | Crush detection: check crushed_tank far ptr non-null |
| 0x20B4C | Crush damage to victim: shield_and_damage(victim, accum+50, 1) |
| 0x20B8C | Crush self-damage to faller: damage_tank(self, accum/2+10, 1) |
| 0x20690 | Per-step pixel scan for crush detection (column loop) |
| 0x2071C | Crush threshold check: >2 columns overlap → immediate landing |
| 0x207CB | Glancing contact: 1-2 columns → sound(5, 200) |
| 0x3FFD2 | shield_and_damage(tank_ptr, damage, flag): shield absorb + damage_tank wrapper |
| 0x30F0E | Init: set `sub[0x2C] = 5` (default deploy threshold) |
| 0x31B48 | damage_tank function entry |

### Web Port Implementation

`web/js/tank.js`: Fall damage formula corrected from `fallDist / 5` to `fallDist * 2` (matching EXE constant DS:0x5164 = 2). Config toggle `impactDamage` added (default On). When On, accumulated damage dealt at landing. When Off, per-step damage during fall animation. Parachute negates damage in both modes. `fallStartY` tracks tank position at fall start for accurate distance calculation. **Parachute deploy fixed**: mid-fall deployment with `predictFallDamage()` threshold check (5 default, 10 with Battery); half-speed via frame counter skip; deploy sound (2000 Hz) and landing thud (200 Hz) via sound.js; `parachuteDeployed` state field; parachute consumed at deploy time. **Crush damage added**: `detectCrush()` per-step bounding-box scan; >2 column overlap → victim damage (accum+50 through shield), self-damage (accum/2+10 direct); 1-2 columns → glancing sound (200 Hz). sound.js `playCrushGlanceSound()` added.

---

## VGA Palette System (VERIFIED from disassembly)

### Full 256-Entry VGA Palette Map

| VGA Range | Count | Purpose |
|-----------|-------|---------|
| 0-79 | 80 | Tank colors (10 players × 8 colors each) |
| 80-104 | 25 | Buffer zone / dynamic effects |
| 81-85 | 5 | Explosion player cycling palette (attacker gradient) |
| 105+ | — | Terrain threshold (pixel ≥ 0x69 = solid ground) |
| 120-149 | 30 | Terrain palette (surface-to-underground gradient) |
| 130-149 | 20 | Storm sky overwrites (alternating grey for lightning) |
| 150 | 1 | Wall/obstacle boundary marker |
| 169 | 1 | Wall/obstacle boundary marker |
| 170-199 | 30 | Explosion fire palette (red/orange/yellow) |
| 200 | 1 | Tank hit marker pixel |
| 254 | 1 | Napalm fire particle color |

### Explosion Player Palette (VGA 81-85, file 0x23F63)

5-entry gradient based on attacker's base color:
```
for si = 0 to 4:
    R = (si + 1) * attacker_base_R / 6
    G = (si + 1) * attacker_base_G / 6
    B = (si + 1) * attacker_base_B / 6
fg_setdacs(81, 5)
```
Attacker colors loaded from DS:0xDD4C (R), DS:0xDD4E (G), DS:0xDD50 (B).

### Explosion Fire Palette (VGA 170-199, file 0x23FBC)

30 entries in 3 groups of 10 (all use VGA 6-bit values 0-63):

| Group | VGA Range | Name | R | G | B |
|-------|-----------|------|---|---|---|
| 1 | 170-179 | Dark Red Fire | si×2+43 | si+10 | si+10 |
| 2 | 180-189 | Orange Fire | si×2+43 | si×2+10 | si+10 |
| 3 | 190-199 | Yellow Fire | si×2+43 | si×2+43 | si+10 |

(si = 0..9 within each group)
All groups share R ramp (43-61). Green distinguishes: low=red, medium=orange, high=yellow.

### UI Color Palette Entries (VERIFIED from disassembly)

All set via `fg_setrgb` calls at file 0x2A640–0x2A770 (icons.cpp init), calling `0x456B:0x0005`. Calling convention: `fg_setrgb(index, R, G, B)` → push B, G, R, index (cdecl right-to-left).

| Palette Index | DS Var | R | G | B | 8-bit RGB | Role |
|:---:|:---:|:-:|:-:|:-:|:---------:|------|
| 151 (0x97) | EF28=EF2A | 45 | 45 | 45 | (180,180,180) | Background fill / light accent |
| 152 (0x98) | EF2C=EF22 | 0 | 0 | 0 | (0,0,0) | Deep shadow (black) |
| 153 (0x99) | EF24 | 30 | 30 | 30 | (120,120,120) | Dark text / mid shadow |
| 154 (0x9A) | *(none)* | 40 | 40 | 63 | (160,160,255) | Medium blue — purpose TBD |
| 155 (0x9B) | EF26 | 63 | 63 | 63 | (255,255,255) | White outer highlight |
| 156 (0x9C) | EF32 | 15 | 15 | 15 | (61,61,61) | Dark outer shadow |
| 157 (0x9D) | *(none)* | 50 | 50 | 50 | (200,200,200) | Medium gray — purpose TBD |
| 158 (0x9E) | EF30 | 5 | 5 | 5 | (20,20,20) | Near-black sunken border |
| 159 (0x9F) | EF2E | 55 | 55 | 55 | (222,222,222) | Inner highlight |
| 161 (0xA1) | *(none)* | 10 | 63 | 63 | (40,255,255) | Cyan — purpose TBD |

Also in same init block (overridden later by game setup):
- `fg_setrgb(80, 20, 63, 20)` = green — overwritten by sky palette setup each round
- `fg_setrgb(87, 40, 40, 63)` = medium blue — player 9 slot 7, overwritten by player setup
- `fg_setrgb(120, 9, 9, 31)` = dark blue — terrain palette base, overwritten per terrain type

**Web port mapping** (DS EF22–EF32 → web indices 200–208): ALL verified correct. `setupUIPalette()` in palette.js uses the exact EXE values.

### Underground/Black Mode (file 0x39F90)

When cavern_flag (DS:0x50D8) is set:
```
for di = 0 to 103: fg_setcolor(di, 0, 0, 0)
fg_setdacs(0, 104)  // blacks out VGA 0-103
```

### Fastgraph V4.02 Function Pointer Table

| DS Offset | Function | Purpose |
|-----------|----------|---------|
| DS:0xEEF4 | fg_getpixel | Read pixel color at (x,y) |
| DS:0xEEF8 | fg_setpixel/fg_getmap | Set pixel / read bitmap |
| DS:0xEEFC | fg_setdacs | Write palette buffer to VGA DAC |
| DS:0xEF00 | fg_getdacs | Read VGA DAC to palette buffer |
| DS:0xEF04 | fg_drect | Draw filled rectangle |
| DS:0xEF08 | fg_setcolor | Set single palette buffer entry (index, R, G, B) |
| DS:0xEF0C | fg_text | Draw text string |
| DS:0xEF14 | fg_rect | Draw rectangle outline |

Palette buffer at DS:0x6862 (256×3 = 768 bytes): `buffer[index*3] = R, [+1] = G, [+2] = B`.

**Intermediate files**: `disasm/vga_palette_analysis.txt`

---

## Graphics/Video Mode System (VERIFIED from binary analysis)

### Supported Resolutions

9 graphics modes, configurable via `GRAPHICS_MODE` config key. Mode strings at file offset 0x05CB4C.

| Mode | Resolution | Type | INT 10h / VESA |
|------|-----------|------|----------------|
| `320x200` | 320×200×256 | Standard VGA Mode 13h | `AX=0013h, INT 10h` (at 0x440F3) |
| `320x240` | 320×240×256 | Mode-X VGA | Tweaked Mode 13h (unchained) |
| `320x400` | 320×400×256 | Mode-X VGA | Tweaked Mode 13h (unchained) |
| `320x480` | 320×480×256 | Mode-X VGA | Tweaked Mode 13h (unchained) |
| `360x480` | 360×480×256 | Mode-X VGA | Tweaked Mode 13h (unchained) |
| `640x400` | 640×400×256 | SVGA/VESA | `AX=4F02h, INT 10h` (at 0x5081B) |
| `640x480` | 640×480 | VGA Mode 12h / VESA | `AX=0012h, INT 10h` (at 0x440EE) |
| `800x600` | 800×600×256 | SVGA/VESA | VESA mode set |
| `1024x768` | 1024×768×256 | SVGA/VESA | VESA mode set |

Default: `GRAPHICS_MODE=360x480` (in SCORCH.CFG).

### Mode Table Structure (DS:0x6B66)

9 entries of 68 bytes (stride 0x44) each, containing per-mode configuration:

```c
struct GraphicsMode {       // 68 bytes (0x44)
    far char*  name;        // +0x00: far ptr to mode name string
    uint16     width;       // +0x04: pixel width (0 = query FG at runtime)
    uint16     height;      // +0x06: pixel height (0 = query FG at runtime)
    uint16     num_colors;  // +0x08: always 256
    double     aspect_ratio;// +0x0A: pixel aspect ratio (IEEE 754)
    far void*  init_func;   // +0x12: per-mode init function pointer
    far void*  fptr[11];    // +0x16: Fastgraph function dispatch table
    uint16     fg_mode;     // +0x42: Fastgraph mode number
};
```

| Index | Name | FG Mode | Aspect | VGA Type |
|:-----:|------|:-------:|:------:|----------|
| 0 | 320x200 | 19 | 1.00 | Mode X chain-4 |
| 1 | 320x240 | 22 | 1.00 | Mode X |
| 2 | 320x400 | 21 | 0.50 | Mode X doubled |
| 3 | 320x480 | 23 | 0.50 | Mode X doubled |
| **4** | **360x480** | **0** | **0.55** | **Custom Mode X (default)** |
| 5 | 640x400 | 24 | 1.00 | SVGA/VESA 0x100 |
| 6 | 640x480 | 25 | 1.00 | SVGA/VESA 0x101 |
| 7 | 800x600 | 26 | 1.00 | SVGA/VESA 0x103 |
| 8 | 1024x768 | 27 | 1.00 | SVGA/VESA 0x105 |

Note: Mode 4 (360x480) has FG mode 0 (text mode in Fastgraph) because it bypasses Fastgraph's built-in mode handling and uses a custom CRTC programming path.

### Initialization Sequence

1. **Config parsing** (file 0x195F6): Reads `GRAPHICS_MODE` from `SCORCH.CFG`, loops through mode table comparing names, sets `selected_mode` index (DS:0x6E26).

2. **Mode detection** (file 0x451E1): For SVGA modes (FG >= 24), calls `fg_testmode` to check VESA availability. Probes video pages 1-15. Shows error on failure.

3. **Graphics init** (file 0x45413): Bounds-checks mode index, copies 11 function pointers from mode entry into dispatch table (DS:0xEEF4-0xEF1F), calls the per-mode `init_func`, reads resolution via `fg_getmaxx`/`fg_getmaxy`, computes scale factors from aspect ratio, sets clipping rectangle.

4. **Mode-specific init**: Standard modes call `fg_setmode(fg_mode)`. The custom 360x480 mode (file 0x440EC) uses a two-step approach: sets VGA mode 0x12 (640x480x16) then 0x13 (320x200x256), disables chain-4, reprograms CRTC via 17 register pairs from table at DS:0x6840.

### Function Dispatch Table (DS:0xEEF4-0xEF1F)

Populated from mode entry at init time; 11 far pointers for mode-specific drawing:

| Slot | DS Offset | Call Count | Function | Purpose |
|:----:|:---------:|:----------:|----------|---------|
| 0 | DS:0xEEF4 | 294 | fg_point(color, y, x) | Put pixel |
| 1 | DS:0xEEF8 | 142 | fg_getpixel(x, y) | Read pixel |
| 2 | DS:0xEEFC | 34 | fg_getimage(buf, w, h) | Grab screen region |
| 3 | DS:0xEF00 | 2 | fg_waitfor(count) | VSync wait |
| 4 | DS:0xEF04 | 21 | fg_restore(buf, w, h) | Blit to screen |
| 5 | DS:0xEF08 | 93 | fg_rect(x1, y1, x2, y2) | Filled rectangle |
| 6 | DS:0xEF0C | 85 | fg_line(x1, y1, x2, y2) | Line/outline |
| 7 | DS:0xEF10 | 50 | fg_box(x1, y1, x2, y2) | Box/region |
| 8 | DS:0xEF14 | 65 | fg_move(x, y) | Set cursor position |
| 9 | DS:0xEF18 | 2 | fg_copypage(src, dst) | Page copy |
| 10 | DS:0xEF1C | 2 | fg_setpage(page) | Select page |

Standard modes (0-3, 5-8) share dispatch pointers (seg 0x3E7E/0x3D9B/0x4815). Mode 4 (360x480) uses different set (seg 0x3D6E) since it bypasses Fastgraph.

### Key Global Variables

| DS Offset | Name | Default | Purpose |
|-----------|------|:-------:|---------|
| DS:0x6DCA | mode_count | 9 | Number of available modes |
| DS:0x6E26 | selected_mode | 4 | Index into mode table |
| DS:0x6E28 | num_pages | 3 | Video pages (2 or 3) |
| DS:0x6E2A | draw_color | 1 | Current drawing color |
| DS:0x6E2C | num_colors | 256 | Palette size |
| DS:0x6ED6 | gfx_initialized | 0 | Set to 1 after init |
| DS:0xEF3E | screen_max_x | runtime | fg_getmaxx() result |
| DS:0xEF3A | screen_max_y | runtime | fg_getmaxy() result |

### 360x480 Custom Mode X (CRTC Table at DS:0x6840)

The 360x480 default mode bypasses Fastgraph entirely. Initialization at file 0x440EC:
1. Set VGA Mode 12h (640x480x16) via `AX=0012h, INT 10h`
2. Set VGA Mode 13h (320x200x256) via `AX=0013h, INT 10h`
3. Disable chain-4 (unchained planar mode)
4. Program 17 CRTC register pairs from table at DS:0x6840

CRTC configuration:
- **28.322 MHz dot clock** (Misc Output register = 0xE7)
- **H display: 90 chars = 360 pixels** (4 pixels per character clock in Mode X)
- **V display: 480 lines** (VDE = 0x1DF from Overflow bits)
- **Stride: 45 words = 90 bytes/plane/row** (360 pixels across 4 planes)
- **Memory: 172,800 bytes** (fits in 256KB VGA RAM, ~1.5 video pages)

### VESA/SVGA Driver

Full VESA VBE support via Fastgraph V4.02:

| VESA Call | AX Value | Count | Offsets | Purpose |
|-----------|----------|-------|---------|---------|
| Get SVGA Info | 0x4F00 | — | — | Enumerate VESA capabilities |
| Get Mode Info | 0x4F01 | 4 | 0x51555, 0x51794, 0x517B1, 0x52263 | Query mode capabilities |
| Set Mode | 0x4F02 | 1 | 0x5081B | Set SVGA video mode (with success check: `CMP AX, 004Fh`) |

Error messages: `"Unable to initialize svga graphics mode: %s."` and `"Unable to initialize graphics mode: %s."` — separate code paths for standard VGA and SVGA initialization.

### VGA Detection & Hardware Queries

53 total INT 10h calls in the binary. Key categories:

| Function | AH Value | Purpose |
|----------|----------|---------|
| 0x00 | Set video mode | Modes 12h (640×480×16) and 13h (320×200×256) |
| 0x03 | Get cursor position | Text mode cursor state |
| 0x0F | Get current video mode | Detect active mode |
| 0x10 | Palette/DAC | VGA DAC register manipulation |
| 0x11 | Font info | `AL=30h` — get font pointer (for text rendering) |
| 0x12 | Alternate select | VGA feature detection |
| 0x1A | Display combination | VGA adapter identification |
| 0xF1 | Custom/vendor | 8 calls — Fastgraph-specific VGA register access |

### Mode-X VGA

Modes 320x240 through 360x480 use VGA "Mode X" — unchained 256-color planar mode achieved by reprogramming VGA CRTC/Sequencer registers after setting Mode 13h. This gives higher resolutions than standard 320×200 while staying within 256KB VGA RAM. Fastgraph V4.02 handles Mode-X setup transparently.

### Screen Dimension Variables

| DS Offset | Purpose | Notes |
|-----------|---------|-------|
| DS:0xEF3E | Screen width (pixels) | Checked against 0x140 (320) for HUD layout |
| DS:0xEF40 | Screen height (pixels) | Used for HUD bottom margin |

---

## Keyboard & Input System (VERIFIED from disassembly)

### Input Architecture (VERIFIED)

Three input modes controlled by DS:0x5030 (set by `set_input_mode()` at file 0x288A0):
- **0**: Direct keyboard polling — scancodes in DS:0xD0B8, key states in DS:0xD1BE array (default)
- **1**: Mouse mode — keyboard scancodes buffered in 128-entry circular queue; mouse position read separately via Fastgraph
- **2**: Joystick/direct — same as mode 0 plus joystick callback init via DS:0xD1BE

BIOS keyboard flag (DS:0x502E): 0=custom INT 9h (default), 1=BIOS INT 16h polling.

### INT 9h Custom Handler (file 0x2898E)

- Reads scan code from port 0x60
- Key state array at DS:0xD1BE (128 words: 1=pressed, 0=released)
- Modifier flags at DS:0xD0B2: bit 0=RShift, 1=LShift, 2=Ctrl, 3=Alt
- Last scan code stored at DS:0xD0B8

### Main Game Loop Key Dispatch (file 0x2F78A)

80-entry switch table at 28B3:0x5DB (file 0x2FB0B).
Actions 2-81 (scan code = action in direct mode):

| Key | Scan | Action | Function |
|-----|------|--------|----------|
| Space | 0x39 | 10 | FIRE / Autopilot |
| = | 0x0D | 13 | FIRE (direct) |
| Enter | 0x1C | 28 | SURRENDER / Pass turn |
| S | 0x1F | 31 | POWER ADJUST (shift=down, no shift=up) |
| G | 0x22 | 34 | CHANGE DEFENSE (toggle shield) |
| H | 0x23 | 35 | TOGGLE SOUND |
| Z | 0x2C | 44 | WEAPON CYCLE |
| V | 0x2F | 47 | GUIDED MISSILE steer right |
| M | 0x32 | 50 | AI AIM & FIRE (autopilot) |
| N | 0x31 | 49 | DISPLAY TOGGLE |
| F9 | 0x43 | 67 | SYSTEM MENU |
| F10 | 0x44 | 68 | INVENTORY / Guided steer left |
| PgUp | 0x49 | 73 | WEAPON CYCLE |
| 1-0 | 0x02-0x0B | 2-11 | Select/view player 1-10 |

Arrow keys go to default handler — angle/power via continuous key-state polling of DS:0xD1BE array.

### Input Timing

| Mode | Repeat Delay | Timer Ticks |
|------|-------------|-------------|
| Normal (no modifier) | ~0.82s | 15 ticks @ 18.2 Hz |
| Shift held | ~1.65s | 30 ticks @ 18.2 Hz |
| Alt held | Immediate | No throttle |

Angle adjustment: ±1° (fine), ±15° (coarse).

### Mouse/Pointer System (VERIFIED)

**No direct INT 33h calls in game code.** All 3 `cd 33` byte pattern matches are false positives:
- 0x9D18: `eb cd` (jmp displacement) + `33 c0` (xor ax, ax) spanning instruction boundary
- 0x130B2: `7d cd` (jge displacement) + `33 c0` (xor ax, ax) spanning instruction boundary
- 0x1C1C2: `89 3E EC CD` (mov [0xCDEC], di — high byte of address) + `33 F6` (xor si, si)

Mouse access is entirely through **Fastgraph V4.02 mouse API** (fg_mouseini, fg_mousepos, fg_mousebut, etc.), which internally calls INT 33h. The game never issues INT 33h directly.

#### Input Mode System (file 0x288A0)

`set_input_mode(mode)` — sets DS:0x5030 and initializes the selected input device:

```c
void set_input_mode(int mode) {  // file 0x288A0
    int old = DS:0x5030;
    if (mode == old) return old;
    DS:0x5030 = mode;
    switch (mode) {
        case 0: break;                          // Keyboard direct (default)
        case 1: DS:0x5034 = DS:0x5032 = 0;      // Mouse: reset scancode buffer
                break;
        case 2: init_joystick(0x100, 0, DS:0xD1BE);  // Joystick: init callback
                break;
    }
    return old;
}
```

7 references to DS:0x5030 across the input system (file 0x288AC–0x28B8A).

#### INT 9h Integration with Mouse Mode

The custom INT 9h handler (file 0x2898E) dispatches differently per mode:
- **Mode 0** (keyboard): Direct scancode in DS:0xD0B8, key state array at DS:0xD1BE
- **Mode 1** (mouse): Scancodes are **enqueued** into a 128-entry circular buffer
  - Write pointer: DS:0x5034, Read pointer: DS:0x5032
  - Buffer arrays: DS:(-0x2D42) for scancodes, DS:(-0x2C42) for shift states
  - `enqueue_key(scancode, shift)` at file 0x288F6
  - `dequeue_key(&scan, &shift)` at file 0x2893A
- **Mode 2** (joystick): Same as keyboard direct mode, plus callback dispatch

#### Key Polling Functions

| File Offset | Function | Description |
|-------------|----------|-------------|
| 0x28A80 | `get_key_noblock()` | Non-blocking poll: returns scancode or 0x80 if none |
| 0x28B31 | `wait_for_key(&key, &shift)` | Blocking read: returns 0 if none, 1 if dequeued |
| 0x28C0B | `get_key_blocking()` | Loops until key available, applies key mapping |
| 0x28C53 | `init_keyboard()` | Installs custom INT 9h handler, saves old vector to DS:0xD0AE |

All three polling functions dispatch via DS:0x5030: mode 0/2 read DS:0xD0B8 directly, mode 1 dequeues from buffer. Key mapping callback at DS:0xD0B4:0xD0B6 (far ptr, NULL if disabled).

#### Mouse Position & Aiming

Mouse position read through Fastgraph `fg_mousepos()` (indirect via function pointer table). During AIM phase, mouse delta (pixels moved since last frame) is scaled by MOUSE_RATE:
- **Horizontal delta** → angle change (±degrees)
- **Vertical delta** → power change (±units)
- Scaling: `delta * MOUSE_RATE` where MOUSE_RATE default = 0.50

#### Config Keys

- `POINTER=%s` — `Mouse`, `Joystick`, or disabled (enum at 0x058AAF: "Mouse", "Joystick")
- `MOUSE_RATE=%.2lf` — Sensitivity (default 0.50, stored as IEEE double at DS:0x6BF8)
- Hardware submenu labels: `~Mouse Enabled`, `~Pointer:`, `~Mouse Rate:`

#### Click Regions (DS:0x56AE)

12-byte structs, dynamic count at DS:0xEA10:

```
Offset  Size  Field
+00     2     x1 (left boundary)
+02     2     y1 (top boundary)
+04     2     x2 (right boundary)
+06     2     y2 (bottom boundary)
+08     2     left_click_action
+0A     2     right_click_action
```

Region count depends on context:
- **4 regions** when DS:0x5142 == 0 (basic HUD: power, angle, weapon, fire)
- **11 regions** when DS:0x5142 != 0 (expanded: all HUD labels + weapon + controls)

Regions computed dynamically at file 0x2FECC by measuring text widths of HUD labels ("Power:", "Angle:", "Wind:", etc.) via Fastgraph `fg_getwidth()` at 0x4589:0xB87. Click region dispatch loop at file 0x2F6D0: iterates regions, checks mouse position within bounds, returns action code. Special action 0x0F with left button sets shift state flag.

#### Menu Pointer Integration

Menu dialog system (seg 0x3F19) uses DS:0x5148 to track selected item:
- Keyboard navigation updates DS:0x5148 via arrow keys
- Mouse clicks update DS:0x5148 by hit-testing item rectangles
- Menu rendering at seg 0x34ED (file 0x3BEC0) pushes DS:0x5148 as parameter to dialog functions
- Dialog item struct accessed via ES:BX linked list: `[ES:BX+0x2C]` = prev item ptr, `[ES:BX+0x30]` = next item ptr, `[ES:BX+0x0E]` = item index

### Joystick Support

Config keys in Hardware submenu:
- `~Joystick Rate:` — Joystick sensitivity
- `Joystick ~Threshold:` — Dead zone
- `~Calibrate Joystick` — Runtime calibration routine

### Key Config Values

| Variable | DS Offset | Default | Purpose |
|----------|-----------|---------|---------|
| POINTER | DS:0x5030 | mouse | Input device: 0/2=keyboard, 1=mouse |
| MOUSE_RATE | DS:0x6BF8 | 0.50 | Mouse sensitivity (pixels → angle/power) |
| FIRE_DELAY | DS:0x515C | 200 | Delay before projectile launch |
| BIOS_KEYBOARD | DS:0x502E | 0 | Use BIOS INT 16h instead of custom handler |

## PC Speaker Sound System (VERIFIED from disassembly)

### Architecture Overview

SCORCH.EXE uses the **Fastgraph 4.02** library for all PC speaker sound. The system has three layers:

1. **Hardware primitives** (file 0x010C81-0x010CBC): directly program 8253 PIT chip and port 0x61
2. **Fastgraph mid-layer** (file 0x4C117-0x4C290): wrap primitives, add device dispatch logic
3. **Game call sites** (extras.cpp, play.cpp, shields.cpp, ranges.cpp): call primitives directly

Sound is **off by default** (DS:0xEF46 = 0). User must enable PC Speaker in the Sound submenu.

**Address mapping** (image_base = 0): `file_offset = runtime_addr + 0x6A00`.  
So `call 0x0:0xA281` (runtime) targets file 0x010C81, and `call 0x4571:0x0007` targets file 0x4C117.

### Hardware Layer — PC Speaker Primitives

**fg_sound_on** (file 0x010C81, runtime 0x0:0xA281):
```asm
; Parameters: [bp+6] = freq_hz
mov bx, [bp+6]       ; freq_hz argument
mov ax, 0x34DD       ; 0x1234DD = 1,193,277 (PIT base clock)
mov dx, 0x12
div bx               ; ax = PIT divisor = 1,193,277 / freq_hz
in al, 0x61          ; read speaker gate byte
or al, 0x3           ; set bit0 (timer2 gate) + bit1 (speaker enable)
out 0x61, al
mov al, 0xB6         ; PIT mode: channel 2, square wave, lo+hi byte load
out 0x43, al
mov al, bl           ; divisor low byte  -> PIT channel 2
out 0x42, al
mov al, bh           ; divisor high byte -> PIT channel 2
out 0x42, al
retf
```

**fg_sound_off** (file 0x010CB1, runtime 0x0:0xA2B1):
```asm
in al, 0x61          ; read speaker gate
and al, 0xFC         ; clear bits 0+1 (disable speaker)
out 0x61, al
retf
```

- **PIT base clock**: 1,193,277 Hz (0x1234DD)
- **Frequency formula**: `pit_divisor = 1193277 / freq_hz`
- **Minimum freq**: 19 Hz (0x13) — clamped in fg_sound()
- **PIT mode 0xB6**: channel 2, square wave, 16-bit divisor load

### Fastgraph Sound Library Functions (file 0x4C117-0x4C290)

All in virtual display segment 0x4570 / runtime segment 0x4571:

| Function | File | Runtime Call | Signature | Notes |
|----------|------|--------------|-----------|-------|
| fg_sound_dispatch | 0x4C117 | 0x4571:0x0007 | (freq, dur) | Checks DS:0xEF46, routes to primitives |
| fg_click | 0x4C143 | 0x4570:0x0043 | (delay, count) | Toggle speaker bit 1 N times |
| fg_beep | 0x4C177 | 0x4570:0x0077 | (dur_lo, dur_hi) | Click-based tone for duration |
| fg_tone | 0x4C1D8 | 0x4570:0x00D8 | (start, end, step) | Frequency sweep |
| fg_sound | 0x4C221 | 0x4570:0x0121 | (freq_hz) | Continuous PIT tone |
| fg_nosound | 0x4C278 | 0x4571:0x0168 | () | Stop speaker (AND port 0x61 with 0xFC) |

The **fg_sound_dispatch** at file 0x4C117:
- `if DS:0xEF46 == 0`: return immediately (no sound device configured)
- `if DS:0xEF46 == 1`: call fg_sound_on (0x0:0xA281), delay (0x0:0x9AF6), fg_nosound

### DS Variables — Sound Configuration

| DS Offset | File | Name | Default | Description |
|-----------|------|------|---------|-------------|
| DS:0xEF46 | 0x64CC6 | sound_device | 0 | 0=off, 1=PC speaker (set in Sound menu) |
| DS:0x519E | — | sound_enabled | 0 | Game-level sound on/off flag |
| DS:0x50EE | — | flight_sounds | 0 | Flight sounds enabled flag |
| DS:0x50F0 | — | flight_sound_state | 0 | Current flight sound playback state |

Config keys in SCORCH.CFG: `SOUND` (DS:0x0335), `FLY_SOUND` (DS:0x033B)

### Sound Call Sites — All Game Files

#### 1. Explosion Rising Tone (extras.cpp, file 0x21267)
```c
if (sound_device == 1) {  // DS:0xEF46
    for (si = 0; si < 100; si += 15) {
        freq = si * 100 + 1000;       // 1000 Hz rising to ~10000 Hz
        fg_sound_on(freq);             // CALL 0x0:0xA281
        delay(5);                      // CALL 0x0:0x9AF6
    }
    fg_nosound();                      // CALL 0x4571:0x0168
}
```
**Effect**: Rising sweep 1000→10000 Hz in 7 steps of 100 Hz, 5-tick delay each.

#### 2. Impact Random Tone (extras.cpp, file 0x247BA)
```c
if (sound_device != 0) {
    // Inside impact animation loop (si = frame index, count = num_frames):
    freq = random(0xBB8) + computed_base;   // random up to 3000 Hz
    fg_sound_on(freq);  // CALL 0x0:0xA281 — updated each frame
}
// After loop:
fg_nosound();           // CALL 0x4571:0x0168
```
**Effect**: Rapidly varying random-frequency tone during impact animation frames.

#### 3. Terrain Hit Rising Sound (extras.cpp, file 0x24DCD)
```c
if (DS[0xCF8E] == 0 && sound_device != 0) {
    fg_sound_on([bp-0x2A]);    // CALL 0x0:0xA281 at current freq
    [bp-0x2A] += 200;          // +200 Hz each step
}
```
**Effect**: Rising pitch stepping +200 Hz per terrain pixel traversed by projectile.

#### 4. Shield Hit Random Tone (shields.cpp, file 0x3AF33)
```c
if (sound_device != 0) {
    freq = random(50) + base;  // random(0x32), CALL 0x2BF9:0x048B
    fg_sound_on(freq);         // CALL 0x0:0xA281
}
```
**Effect**: Random-frequency noise updated each shield-hit animation frame.

#### 5. Shield Hit End — Stop Sound (shields.cpp, file 0x3B1F9 and 0x3B4AE)
```c
if (sound_device != 0) {
    fg_sound_off();   // CALL 0x0:0xA2B1 (hardware primitive directly)
}
```
Two separate call sites at end of different shield animation loops.

#### 6. Flight Sound Start (play.cpp, file 0x3162C)
```c
if (sound_device == 1) {
    fg_sound_on(0x14);   // CALL 0x0:0xA281 — 20 Hz start (minimum pitch)
}
// ... compute velocity-based frequency (see #7) ...
if (sound_device == 1) {
    fg_nosound();         // CALL 0x4571:0x0168
}
```

#### 7. Flight Sound Frequency Computation (play.cpp, file 0x31663)
```c
// proj = far pointer to projectile struct
vx = proj[+0xA2 : +0xA4];   // X velocity components (32-bit)
vy = proj[+0xA6 : +0xA8];   // Y velocity components (32-bit)
speed = magnitude(vx, vy) * 1000;   // CALL 0x0:0x17A6
pit_div = 1193277 / speed;           // CALL 0x0:0x1816
proj[+0x9C] = pit_div;              // store PIT divisor
// If proj[+0x9E] != proj[+0x9C]: update sound output
```
**Effect**: Velocity-to-pitch mapping — faster projectiles make higher-pitched sounds.

#### 8. Another Flight Sound Update (play.cpp, file 0x31F59 and 0x32038)
```c
if (DS[0x50E2] != 0 && sound_device == 1) {
    fg_sound_on(0x14);    // CALL 0x0:0xA281 — 20 Hz
}
// ... HUD/display update ...
if (DS[0x50E2] != 0 && sound_device == 1) {
    fg_nosound();          // CALL 0x4571:0x0168
}
```

#### 9. Player/Turn Change Click (play.cpp, file 0x30991 and 0x30A39)
```c
if (sound_device == 1) {
    fg_click(20, 100);    // CALL 0x4571:0x0007 — push 0x14, 0x64
}
```
**Effect**: 100 rapid speaker toggle clicks — a menu "tick" or player-change pop sound.

#### 10. Terrain Generation Ping (ranges.cpp, file 0x35D41)
```c
if (sound_device != 0) {
    for (si = 10; si < 20; si++) {
        fg_click(0, 20);   // CALL 0x4571:0x0007 — push 0, 0x14
        delay(25 - (si-10)*2);  // CALL 0x0:0x9AF6 — decreasing delay
    }
}
```
**Effect**: Rising-speed click train during terrain generation (map building).

### Sound Design Summary

| Event | Source | Mechanism | Frequency Range |
|-------|--------|-----------|-----------------|
| Explosion | extras.cpp | Rising PIT sweep | 1000 → ~10000 Hz in 7 steps |
| Terrain hit | extras.cpp | Rising PIT steps | base + N*200 Hz per pixel |
| Impact animation | extras.cpp | Random PIT tone | random(3000) + base |
| Shield hit | shields.cpp | Random PIT tone | random(50) + base per frame |
| Projectile flight | play.cpp | Velocity-based PIT | speed * 1000 → divisor |
| Player change | play.cpp | Click train | N/A (digital toggle) |
| Terrain generation | ranges.cpp | Click ping | N/A (click sequence) |

### Sound Function Runtime Address Table

| CALL Bytes | Runtime | File Offset | Identified As |
|------------|---------|-------------|---------------|
| `call 0x0:0xA281` | 0x0000:0xA281 | 0x010C81 | fg_sound_on(freq_hz) — PIT + port 0x61 enable |
| `call 0x0:0xA2B1` | 0x0000:0xA2B1 | 0x010CB1 | fg_sound_off() — port 0x61 disable |
| `call 0x0:0x9AF6` | 0x0000:0x9AF6 | 0x010AF6 | delay(n) — busy-wait loop |
| `call 0x0:0x17A6` | 0x0000:0x17A6 | 0x081A6 | magnitude(vx,vy) — flight speed |
| `call 0x0:0x1816` | 0x0000:0x1816 | 0x08216 | 1193277_div(n) — compute PIT divisor |
| `call 0x4571:0x0007` | 0x4571:0x0007 | 0x4C117 | fg_sound_dispatch(freq, dur) |
| `call 0x4571:0x0168` | 0x4571:0x0168 | 0x4C278 | fg_nosound() — stop speaker |

### HUD System — Two Renderers

The EXE has **two completely different HUD renderers** selected based on resolution/mode.
Key variable: DS:0x5142 (0 = basic/Row 1 only, nonzero = expanded/both rows).
DS:0x50D4 = **numPlayers** (confirmed by `cmp si,[0x50D4]; jl` loop patterns).

#### HUD Function Index

| Function | Seg:Off | File Offset | Source | Purpose |
|----------|---------|-------------|--------|---------|
| `compute_hud_layout` | 2910:00CA | 0x2FBCA | play.cpp | Basic mode X-position calc |
| `draw_hud` | 2910:0184 | 0x2FC84 | play.cpp | Main HUD draw (bar mode) |
| `compute_hud_layout_full` | 294B:000E | 0x2FEBE | play.cpp | Expanded mode full layout |
| `draw_hud_full` | 2950:02B2 | 0x301B2 | play.cpp | Expanded mode draw (text mode) |
| `update_hud_row1` | 29C0:01E8 | 0x307E8 | play.cpp | Partial Row 1 redraw |
| `draw_player_icon` | 1F7D:0007 | 0x261D7 | icons.cpp | Per-player alive/dead icon |
| bar column helper 1 | 3249:0662 | 0x394F2 | *(hud bars)* | Fill power columns per player |
| bar column helper 2 | 3249:06B4 | 0x39544 | *(hud bars)* | Fill angle columns per player |
| bar column helper 3 | 3249:070F | 0x3959F | *(hud bars)* | Fill Row 2 bar columns |

#### HUD Colors (DS variables)

| DS Offset | Palette | Purpose | Usage |
|-----------|---------|---------|-------|
| DS:0xEF22 | Player color | Bright highlight | Bar outlines (draw_hud), ALL text (draw_hud_full) |
| DS:0xEF24 | Dim text | Dark/depleted | Depleted weapon ammo color |
| DS:0xEF28 | Background | HUD clear fill | fg_fillregion background at 0x2FCB0 |
| DS:0xEF2C | Deep shadow | Bar interior | Bar fill color in draw_hud |
| *(dynamic)* | 0xA3 (163) | **Player color** | `fg_setrgb(0xA3, R, G, B)` at file 0x3030E |

**Palette 163 is NOT a fixed color** — it's dynamically set to the current player's base RGB
via `fg_setrgb(0xA3, struct[0x1C], struct[0x1E], struct[0x20])` at file 0x3030E.
Tank sub-struct offsets +0x1C, +0x1E, +0x20 hold the player's base R, G, B values
(same values stored at DS:0x57E2 player color table). This means ALL HUD text
(wind indicator, labels, weapon text, widget values) uses the player's color.
The only color variation is [EF24] for depleted/zero-ammo items.

#### Renderer 1: `draw_hud` — Multi-Player Bar Mode (file 0x2FC84)

Used at lower resolutions (320×200). Bars are **per-player comparison columns**,
NOT single-player level indicators. Each player gets a **6px-wide column** inside
a shared bar container. Bar width = `numPlayers * 6` pixels.

Layout reserved width = 62px (0x3E) to fit max 10 players × 6px + 2px margin.

**Row 1** (y = DS:0x518E, default 5):
```
fg_setcolor([0xef22])                       ; PLAYER COLOR for outline
sprintf(buf, "%s:", [0x220C] name_ptr)      ; "Wolfgang:"
fg_text(buf, 5, HUD_Y)                     ; label at (LEFT, HUD_Y)
fg_drect(bar_x-1, HUD_Y, bar_x+numPlayers*6, HUD_Y+11)  ; outline in PLAYER color
fg_rect(bar_x, HUD_Y+1, bar_x+numPlayers*6-1, HUD_Y+10, [0xef2c])  ; fill in SHADOW color
```

**Per-player column fill** (helper at file 0x394F2):
```
For each player i:
  fill_height = player[i].power / 100       ; 0-10 pixels (max 1000 → 10px)
  x = bar_x + player[i].field_0xA0 * 6      ; 6px column position
  draw_column(x, HUD_Y+1, fill_height, player[i].color)
  draw_player_icon(icon_base + player[i].field_0xA0 * 11, HUD_Y, ...)
```

**Row 2** (if [0x5142] != 0, y = HUD_Y + 12):
```
sprintf(buf, "%s:", [0x2364] label_ptr)     ; runtime label (set before call)
fg_text(buf, 5, HUD_Y+12)                  ; label at (LEFT, Row2_Y)
fg_drect(bar_x-1, row2_y, ...)             ; bar container (same width)
fg_rect(bar_x, row2_y+1, ...)              ; shadow fill
sprintf(buf, "%s:", "Angle")                ; DS:0x2AFE
fg_text(buf, [0xe9ec], row2_y)             ; "Angle:" after first bar
fg_drect/fg_rect for angle bar...           ; second bar container
```

Per-player Row 2 helpers fill columns inside each bar:
- Helper at 0x39544 (0x3249:0x6b4): fills angle bar columns, value / 10
- Helper at 0x3959F (0x3249:0x70f): fills Row 2 bar columns, reads player+0xA2/0xA4/0xA6/0xA8

**KEY**: Bar outline = PLAYER COLOR (via fg_drect using current fg_setcolor).
Bar interior = SHADOW COLOR ([0xEF2C]). Web port now matches: outline=baseColor, fill=UI_DEEP_SHADOW.

#### Renderer 2: `draw_hud_full` — Text Mode (file 0x301B2)

Used at higher resolutions. Row 1 has **NO bars** — all text values.
Uses `compute_hud_layout_full` (file 0x2FEBE) with many more DS variables.

**Row 1** (ALL text, single line):
```
fg_setcolor([0xef22])                       ; player color
sprintf(buf, "%s:", name)                   ; "Wolfgang:" at (5, HUD_Y)
sprintf(buf, "%4d", player.power)           ; "1000" at (bar_x, HUD_Y)   [0xe9d6]
sprintf(buf, "%s:", "Angle")                ; "Angle:" at [0xe9d8]
sprintf(buf, "%2d", player.angle)           ; "90" at [0xe9da]
fg_setcolor(0xA3)                           ; wind color (163, fixed)
draw_wind_indicator(player+0x1C..0x20, 0xA3) ; custom wind display
fg_text(weapon_name, [0xe9dc], HUD_Y)       ; weapon name
draw_player_icon([0xe9de], HUD_Y, wpn_idx)  ; weapon selector icon
if wpn_idx == 0: sprintf("%s", name)         ; "Baby Missile"
else:            sprintf("%d: %s", ammo, name) ; "3: Nuke"
fg_text(buf, [0xe9e0], HUD_Y)               ; weapon+ammo text
```

**Row 2** (if [0x5142] != 0, much more complex):
```
sprintf(buf, "%s:", [0x2364] label_ptr)     ; runtime label at (5, Row2_Y)
call helper_0x2a16:0xd78(player)            ; bar widget 1
call helper_0x3713:0x36b(player)            ; bar widget 2
sprintf(buf, "%2d", ammo_for_weapon_1)      ; ammo count at [0xe9f0]
  color = ammo > 0 ? [0xef22] : [0xef24]   ; highlight or dim
call helper_0x3713:0x32e(player)            ; bar widget 3
call helper_0x3713:0x000(player)            ; bar widget 4
call helper_0x3713:0x164(player)            ; bar widget 5
sprintf(buf, "%2d", ammo_for_weapon_2)      ; second ammo at [0xe9fe]
call helper_0x3713:0x229(player)            ; bar widget 6
call helper_0x3713:0x265(player, 0)         ; bar widget 7
```

Row 2 bar widths in full mode: 0x30 (48px), 0x19 (25px), 0x1F (31px), 0x12 (18px),
0x22 (34px), 0x21 (33px), 0x0C (12px). Each drawn by separate helper functions.

**Row 2 label pointer** (DS:0x2364): Far pointer to player name string.
Static initial value → DS:0x2EFA = "Max" (first default player name).
Set indirectly at runtime to current player's name before draw_hud call.
Format: `sprintf(buf, "%s:", player_name)` → "Wolfgang:" displayed at Row 2 left.

#### Row 2 Widget Details (Decoded)

Each widget follows the same pattern: (1) clear sub-area with `fg_fillregion(..., [EF28])`,
(2) draw icon or text, (3) color conditionally: `ammo > 0 ? [EF22] : [EF24]`.

| Widget | Seg:Off | File Offset | Source Module | What It Displays |
|--------|---------|-------------|---------------|-----------------|
| 1 | 2A16:0D78 | 0x318D8 | player.cpp | Tank icon + fuel %, FPU math for scale animation |
| 2 | 3713:036B | 0x3DE9B | menu module | Angle bar, inventory[D556] count, bar at [E9EE] |
| 3 | 3713:032E | 0x3DE5E | menu module | Defense bar, struct[0x28] check, draw_icon with [D554] |
| 4 | 3713:0000 | 0x3DB30 | menu module | Item name + "%d%%" value, complex shield/fuel display |
| 5 | 3713:0164 | 0x3DC94 | menu module | Shield selector, struct[0x9A] field, draw_icon + bar |
| 6 | 3713:0229 | 0x3DD59 | menu module | Item bar, struct[0x2A] check, draw_icon with [D566] |
| 7 | 3713:0265 | 0x3DD95 | menu module | Conditional display, 3 args (0, struct), checks 2 funcs |

**Widget 1** (0x318D8, player.cpp) — Most complex:
- Reads struct[0xA6:0xA8] (32-bit resource total) and struct[0xA2:0xA4] (resource spent)
- Computes percentage: `(total - spent) * 100 / total`
- Loops si=1..3: scales icon drawing coordinates by percentage factor (FPU math)
- Calls icon renderer with scaled dimensions — creates shrinking tank animation as fuel depletes
- If expanded mode: computes `(total - spent) * 1000 / total`, formats as `"%4ld"` (DS:0x5834)

**Widget 3** (0x3DE5E) — Simplest widget:
```
color = struct[0x28] > 0 ? [EF22] : [EF24]
draw_icon([E9F2], Row2_Y, [D554], color)         ; 4 args
```

**Widget 4** (0x3DB30) — Complex item display:
- Clears area: `fg_fillregion([E9F4], Row2_Y, [E9FA]-1, Row2_Y+0xB, [EF28])`
- Reads item index from far ptr [0xE1DE]+0x0E
- If index < 0: draw filled bar icon with color [EF2C] (shadow) or [EF24] (dim)
- If index ≥ 0: display inventory item name at [E9F4], draw bar at [E9F6]
- Formats value as `"%d%%"` (percentage) via DS:0x6471
- Color depends on struct[0x96] and ptr comparison with [E1DE]

**Widget 5** (0x3DC94) — Shield selector:
- Clears area: `fg_fillregion([E9FA], Row2_Y, [E9FE]-1, Row2_Y+0xB, [EF28])`
- Reads struct[0x9A] (shield type), compares with DS:0xD548
- If different: show item name (from inventory[struct[0x9A]]) + draw bar
- If same: draw filled bar icon (10px fill)

**Widget 4 percentage** (0x31D7F) — Item ammo percentage:
```
compute_item_percentage(struct):
  if struct[0x96] == 0: return 0
  ptr = struct[0xC6:0xC8]     // far ptr to item info
  pct = floor(struct[0x96] * 100.0 / ptr[0x02])  // DS:0x5830 = 100.0f
  if pct == 100 && struct[0x96] != ptr[0x02]: pct = 99  // cap at 99 if not exactly full
  if pct == 0: pct = 1                                    // min 1% if non-zero
  return pct
```

**Widget 6** (0x3DD59) — Super Mag icon (DS:D566=52):
```
color = struct[0x2A] != 0 ? [EF22] : [EF24]      // struct[0x2A] = mag deflector state
draw_icon([EA00], Row2_Y, [D566], color)           // icon 52 has w=0 (blank)
```

**Widget 7** (0x3DD95) — Heavy Shield energy display:
- Takes 3 args: (struct_far_ptr, extra_flag=0)
- **check1** (0x31249): `return inventory[D564=HeavyShield] * 10 + struct[0xAA]` — total shield energy
- **check2** (0x3121E): `return struct[0] > 1` — 1 if shield type active (not 0=none/1=basic)
- Color: if check1==0 → dim; elif check2 → player color; else → dim
- If [EA02] == 0: skip entirely (not enough screen width)
- If extra_flag != 0: clear area [EA02] to [EA04]-1
- Formats value as `"%3d"` (DS:0x6479), displays at [EA02]

**Widget format strings:**

| Format | DS Offset | File Offset | Used By |
|--------|-----------|-------------|---------|
| "%d" | DS:0x646E | 0x5C1EE | Widget 4 (item count) |
| "%d%%" | DS:0x6471 | 0x5C1F1 | Widget 4 (percentage) |
| "%d" | DS:0x6476 | 0x5C1F6 | Widget 5 (shield count) |
| "%2d" | DS:0x647D | 0x5C1FD | Widget 2 (battery count) |
| "%3d" | DS:0x6479 | 0x5C1F9 | Widget 7 (heavy shield energy) |
| "%4ld" | DS:0x5834 | 0x5B5B4 | Widget 1 (fuel long) |

**Inventory index variables** (set at runtime during game setup):

| DS Offset | Initial | Used By | Purpose |
|-----------|---------|---------|---------|
| DS:0xD548 | 0x0000 | Widget 5 (compare) | Last free weapon (Earth Disrupter=32); "no shield" sentinel |
| DS:0xD554 | 0x0000 | Widget 3, Row 2 inline | Parachute weapon index (=42) |
| DS:0xD556 | 0x0000 | Widget 2 | Battery weapon index (=43) |
| DS:0xD564 | 0x0000 | Widget 7 (check1) | Heavy Shield weapon index (=51) |
| DS:0xD566 | 0x0000 | Widget 6, Row 2 inline | Super Mag weapon index (=52) |

#### Icon Data Structure (DS:0x3826)

`draw_player_icon` at 0x261D7 (icons.cpp) is actually a **generic icon renderer** used for
tank icons, weapon icons, and item icons throughout the HUD.

Icon table at DS:0x3826, stride **125 bytes** (0x7D), max **48 icons** (0x30):
```
struct icon_entry {           // 125 bytes per icon
    uint8_t pattern_type;     // DS:0x3826 + idx*125 — rendering mode flag
    uint8_t width;            // DS:0x3827 + idx*125 — pixel width
    uint8_t height;           // DS:0x3828 + idx*125 — pixel height
    uint8_t pixels[122];      // DS:0x3829 + idx*125 — bitmap data
};
```

Three call variants (same internal renderer, different wrappers):
- `draw_icon_alive` (0x261D7): flag=1, caller-supplied color → renders filled icon
- `draw_icon_dead` (0x26245): flag=0, color=0xA9 (169) → renders outline/dead icon
- `draw_icon_blank` (0x262B3): flag=0, color=-1 → erases icon area

Internal renderer at ~0x26120 (near call from all three): 9 args:
`renderer(x, y, pattern_type, width, height, data_far_ptr, color, flag)`

#### Player Name Display (draw_hud_full Row 1, position E9DC)

The player name display sequence in draw_hud_full (0x302ED-0x30330):
1. `fg_setcolor(0xA3)` — set drawing color to palette 163
2. `fg_setrgb(0xA3, struct+0x1C, struct+0x1E, struct+0x20)` — set palette 163 = player's RGB
3. `text_display(E9DC, HUD_Y, struct+0xB6)` — draw **player name** at E9DC in player's color

struct+0xB6/+0xB8 is a far pointer to the player name string (see Sub-Struct field table).
The full HUD Row 1 sequence is: "Power:" (E9D4) → power value (E9D6, "%4d" DS:0x57B6) →
"Angle:" (E9D8) → angle value (E9DA, "%2d" DS:0x57BE) → **player name** (E9DC, in player color) →
weapon icon (E9DE). Column width at E9DC is `measureText("MMMMMMMMMMMMMMM") + 2` (15 M's).

Function at 0x456B:0x5 (file 0x4C0B5) is **fg_setrgb**:
```
; Build 16-byte Fastgraph DAC control packet on stack:
[bp-0x10] = 0x10             ; packet type 16 (set DAC registers)
[bp-0x0F] = 0x10             ; packet length (16 bytes)
[bp-0x0E] = palette (word)   ; 0xA3 = palette entry 163
[bp-0x0C] = B color (byte)   ; struct+0x20 = player blue
[bp-0x0B] = G color (byte)   ; struct+0x1E = player green
[bp-0x09] = R color (byte)   ; struct+0x1C = player red
call fg_dispctl(packet_ptr, packet_ptr, 16)  ; Fastgraph palette setter
```

#### Wind Playfield Indicator (function at 0x28F1D)

Separate from HUD — draws wind text + directional arrow in the top-right viewport area.
Called per turn (not per HUD redraw). Source: icons.cpp+ (seg 0x1F7F).

```
function draw_wind_indicator():   // file 0x28F1D, seg 1F7F:2D2D
    fg_setrgb(87, 40, 40, 63)     // set VGA 87 = blueish gray
    if DS:0x50FA != 0:             // CHANGING_WIND enabled?
        update_wind()              // add random(-5..+5), clamp ±MAX_WIND

    if wind < 0:
        direction = -1
        sprintf(DS:E05E, "%s: %d", "Wind", abs(wind))   // DS:505A, DS:2214→"Wind"
    elif wind > 0:
        direction = +1
        sprintf(DS:E05E, "%s: %d", "Wind", wind)        // DS:5061, DS:2214→"Wind"
    else:
        direction = 0
        sprintf(DS:E05E, "%s", "No Wind")                // DS:5068, DS:2218→"No Wind"

    fg_setcolor(0x9A)              // VGA 154 for text
    textW = text_measure(DS:E05E)
    x = screenWidth - textW - 20   // right-aligned with 20px margin
    DS:D4E0 = x                    // store wind display X
    DS:D4E2 = viewportY + 5       // store wind display Y
    text_display_styled(DS:E05E, 0xA3, ???)  // 0x4589:0x0BD4

    if direction == 0: return
    // Draw directional arrow (pixel triangle):
    if direction == -1: arrowX = x - 5       // left of text
    if direction == +1: arrowX = screenW - 15 // right edge
    for col = 4 downto 0:          // 5 columns, narrowing
        for row = -col to +col:    // symmetric around center
            draw_pixel(arrowX, viewportY + 10 + row)
            draw_pixel(arrowX, viewportY + 10 - row)
        arrowX += direction         // advance in wind direction
```

Key constants:
- Format strings: DS:0x505A = "%s: %d" (negative), DS:0x5061 = "%s: %d" (positive), DS:0x5068 = "%s" (zero)
- String labels: DS:0x2B04 = "Wind", DS:0x2B09 = "No Wind" (far ptrs at DS:0x2214/0x2218)
- Buffer: DS:0xE05E (global sprintf destination, reused by HUD)
- Position storage: DS:0xD4E0 (X), DS:0xD4E2 (Y)
- Text color: VGA 154 (0x9A)
- Arrow center: viewportY + 10 (DS:EF40 + 0x0A)

**Key difference from web port**: wind magnitude only in text (no sign), direction shown by arrow.
Web port was incorrectly displaying wind at HUD position E9DC (which is the player name column).

#### Column Fill Helper (file 0x39482)

Internal function that draws a per-player 6px column inside a multi-player bar:
```
; Args: (colX, y, fillH, color)
; Clamp fillH to 0..10 (cmp si,0xA; mov si,0xA / xor si,si)
if fillH < 10:
    fg_rect(colX, y, colX+5, y+9-fillH, [EF2C])     ; shadow (top portion)
if fillH > 0:
    fg_rect(colX, y+10-fillH, colX+5, y+9, color)    ; fill (bottom portion)
```
Column is 6px wide (colX to colX+5), fill area 10px tall (y to y+9).
Power column caller at 0x394F2: fillH = power / 100 (max 10), y = HUD_Y + 1.

#### Layout Computation: `compute_hud_layout` (file 0x2FBCA)

Basic mode X-position computation:
```
[0xe9d4] = 5                              ; left margin
si = max(fg_getwidth(name)+8, fg_getwidth([0x2364])+fg_getwidth(":"))
si = max(si, fg_getwidth([0x2368])+fg_getwidth(": "))
[0xe9d6] = 5 + si                         ; bar_x (row 1 AND row 2 share same bar X)
[0xe9d8] = [0xe9d6] + 0x3E + 0x0A        ; after_bar_x = bar_x + 62 + 10
[0xe9da] = [0xe9d8]                        ; icon_base_x = after_bar_x
[0xe9e8] = 5                              ; row2 left margin (same as row1)
[0xe9ea] = [0xe9d6]                       ; row2 bar_x = row1 bar_x
[0xe9ec] = [0xe9ea] + 0x3E + 0x0A        ; row2 after_bar_x
[0xe9ee] = [0xe9ec] + fg_getwidth([0x2368]) + fg_getwidth(": ")  ; angle bar X
```

#### Layout Computation: `compute_hud_layout_full` (file 0x2FEBE)

Expanded mode with many more variables:
```
[0xea10] = [0x5142]==0 ? 4 : 11           ; row height factor
[0xe9d4] = 5                              ; left margin
[0xe9d6] = 5 + fg_getwidth(name) + 8      ; bar_x (name + ":" width)
[0xe9d8] = [0xe9d6] + fg_getwidth("8888 ")  ; after power column
[0xe9da] = [0xe9d8] + fg_getwidth(angle_label) + 8  ; after angle label
[0xe9dc] = [0xe9da] + fg_getwidth("99 ")   ; after angle value
[0xe9de] = [0xe9dc] + fg_getwidth("MMMMMMMMMMMMMMM") + 2  ; weapon area
[0xe9e0] = [0xe9de] + 15                  ; weapon end area
; Row 2:
[0xe9e8] = 5                              ; row2 left margin
[0xe9ea] = max([0xe9e8] + label_w, [0xe9d6])  ; row2 bar_x (aligned with row1)
[0xe9ec] = [0xe9ea] + fg_getwidth("8888 ")
[0xe9ee] = [0xe9ec] + fg_getwidth("99 ")
[0xe9f0] = [0xe9ee] + 25                  ; bar widget (25px)
[0xe9f2] = [0xe9f0] + fg_getwidth("99 ")
[0xe9f4] = [0xe9f2] + 25                  ; another bar (25px)
[0xe9f6] = [0xe9f4] + fg_getwidth("99 ")
[0xe9f8] = [0xe9f6] + 20                  ; gap
[0xe9fa] = [0xe9f8] + fg_getwidth("100% ")
[0xe9fc] = [0xe9fa] + fg_getwidth("99 ")
[0xe9fe] = [0xe9fc] + 20
[0xea00] = [0xe9fe] + fg_getwidth("99 ")
if screenW > 320: [0xea02] = [0xea00] + 20; [0xea04] = [0xea02] + 20
else: [0xea02] = 0
```

#### Key Dimensions

| Parameter | Value | Source |
|-----------|-------|--------|
| Row 1 Y | DS:0x518E (default **5**) | Binary data segment |
| Row 2 Y | Row1_Y + **12** (0x0C) | `add ax, 0xC` at 0x2FD6A |
| Bar reserved width | **62px** (0x3E) | `mov si, 0x3E` at 0x2FC26 |
| Actual bar width | **numPlayers × 6** | `imul ax,ax,0x6` at 0x2FCF7 |
| numPlayers | DS:0x50D4 | Loop bound variable |
| Bar outline height | **12px** (y to y+11) | `add ax, 0xB` at 0x2FCF0 |
| Bar fill height | **10px** (y+1 to y+10) | `inc ax`/`add ax,0xA` at 0x2FD2A/0x2FD17 |
| Left margin | **5px** | `mov word [0xe9d4], 0x5` at 0x2FBDB |
| After-bar gap | **10px** | `add ax, 0xA` at 0x2FC2E |
| Per-player column | **6px** wide | `imul ax,ax,0x6` at 0x39530 |
| Player icon spacing | **11px** | `imul ax,ax,0xB` at 0x2FE71 |
| Per-player fill | power/100 (0–10px) | `idiv bx` (bx=0x64) at 0x39517 |
| Background | fg_rect(5, HUD_Y, screenW-5, screenH-7) | Call at 0x2FCB0 |

#### Label Strings (all use `"%s:"` format)

| String | DS Offset | File Offset | Rendered |
|--------|-----------|-------------|----------|
| "Power" | DS:0x2AF8 | 0x058878 | "Power:" |
| "Angle" | DS:0x2AFE | 0x05887E | "Angle:" |
| "Wind" | DS:0x2B04 | 0x058884 | "Wind:" |
| "No Wind" | DS:0x2B09 | 0x058889 | "No Wind:" |
| Format | DS:0x576C | 0x05B4EC | "%s:" |
| Format2 | DS:0x5769 | 0x05B4E9 | ": " |

#### Format Strings (draw_hud_full)

| String | DS Offset | File Offset | Purpose |
|--------|-----------|-------------|---------|
| "%s:" | DS:0x57B2 | 0x5B532 | Name label (Row 1) |
| "%4d" | DS:0x57B6 | 0x5B536 | Power value (Row 1) |
| "%s:" | DS:0x57BA | 0x5B53A | Angle label (Row 1) |
| "%2d" | DS:0x57BE | 0x5B53E | Angle value (Row 1) |
| "%s" | DS:0x57C2 | 0x5B542 | Weapon name (no ammo) |
| "%d: %s" | DS:0x57C5 | 0x5B545 | Weapon with ammo |
| "%s:" | DS:0x57CC | 0x5B54C | Row 2 label |
| "%2d" | DS:0x57D0 | 0x5B550 | Row 2 ammo count 1 |
| "%2d" | DS:0x57D4 | 0x5B554 | Row 2 ammo count 2 |

#### Measurement Strings (compute_hud_layout_full)

| String | DS Offset | Purpose |
|--------|-----------|---------|
| "8888 " | DS:0x5778 | Power column width |
| "99 " | DS:0x579B | Angle/value column width |
| "MMMMMMMMMMMMMMM" | DS:0x5783 | Weapon name column (15 M's) |
| "100% " | DS:0x57A3 | Percentage column width |
| "999 " | DS:0x57AD | Wide-screen extra column |

#### Runtime Pointer Variables (set before HUD calls)

| DS Offset | Default Value | Purpose |
|-----------|--------------|---------|
| DS:0x220C:0x220E | → DS:0x2AF8 "Power" | Row 1 name label ptr (set to player name) |
| DS:0x2210:0x2212 | → DS:0x2AFE "Angle" | Angle label ptr |
| DS:0x2364:0x2366 | (runtime) | Row 2 label ptr |
| DS:0x2368:0x236A | (runtime) | Angle label ptr (basic mode) |

#### Web Port vs EXE Discrepancies

The web port (hud.js) implements a mode-split renderer matching the EXE's two modes.
Basic mode (≤320px) uses multi-player column bars; full mode (>320px) uses text layout.

| Aspect | EXE | Web Port | Status |
|--------|-----|----------|--------|
| **Basic mode Row 1** | Name + multi-player bar + icons | Name + multi-player bar + icons | **Correct** |
| **Full mode Row 1** | Name + Power + Angle + **PlayerName** + Weapon | Name + Power + Angle + ~~Wind~~ PlayerName + Weapon | **Fixed** (was "Wind: N", now player name) |
| Bar outline color | Player color ([EF22]) | Player color (baseColor) | **Correct** |
| Bar fill color | Shadow ([EF2C]) | Shadow (UI_DEEP_SHADOW) | **Correct** |
| Bar width | numPlayers × 6 (variable) | numPlayers × 6 | **Correct** |
| Per-player columns | power/100, clamped 0-10 | power/100, clamped 0-10 | **Fixed** (was 0-9) |
| barX padding | measureText(name) + 8 (0x2FBF1) | measureText(name) + 8 | **Fixed** (was name+':') |
| Background | UI_BACKGROUND ([EF28], gray) | UI_BACKGROUND (palette 203) | **Correct** |
| All text color | Player color ([EF22], palette 163) | baseColor (player slot 4) | **Fixed** |
| Angle format (full) | "%2d" (DS:0x57BE) | padStart(2) | **Fixed** (was padStart(3)) |
| Player name (E9DC) | text_display(E9DC, struct+0xB6) in pal 163 = player name | Player name in player color | **Fixed** (was "Wind: N") |
| Player icons | Bitmap from icon table (48 icons) | Simple 5×5 squares/outlines | Simplified |
| Weapon position (full) | Left-aligned at E9E0 (after icon at E9DE) | Right-aligned to screen edge | Divergent |
| **Basic Row 2** | Name + energy bars + Angle + angle bars | Name + energy bars + Angle + angle bars + W:N | **Fixed** (+wind text) |
| **Full Row 2** | Name + 7 inventory widgets (icon+bar) | Name + energy bar + shield + items + weapon | **Approx** (text, no icons) |
| Full Row 2 widgets | draw_icon + ammo bars per item | Text counts (B:n, P:n, L:n) | Simplified |
| Weapon icon (full) | draw_icon for selected weapon | Text only | Simplified |
| Background clear | fg_rect(5, HUD_Y, screenW-5, screenH-7) | fillRect(5, HUD_Y, ..., ROW2_Y+12) | Intentional (web redraws terrain separately) |

**Remaining gaps** — full audit in `HUD_MENU_COMPARISON.md`. Summary:

HIGH:
- ~~Shop sell sub-dialog~~ — FIXED (sell factor 0.5→0.8/0.65; freeMarket config toggle added)
- Shop palette animation missing (accent colors cycle indices 8-11 every 8 frames)
- Full Row 2: 7 inventory widgets (icon + fill bar each) replaced by text approximations; no actual battery/parachute icons
- ~~Sunken box bevel order~~ — verified correct (outer edges match EF26/EE/30/32 mapping)

MEDIUM:
- ~~Full Row 1 weapon position~~ — FIXED (left-aligned at E9E0)
- ~~Menu button X margin~~ — FIXED (5px small / 12px large)
- ~~3D box hi-res borders~~ — already implemented (3px at screenH≥400)
- Player icon bitmaps: need icon data extraction from DS:0x3826 (48 × 125 bytes)
- ~~Shop selection highlight~~ — FIXED (slot 3 = 80% brightness)
- ~~Font double-quote zero width~~ — FIXED (WIDTHS[2]=3)

LOW:
- Full Row 2 widget icons: need icon data + exact inventory index mapping (DS:0xD548/D554/D556/D566)
- ~~Wind display string: struct+0xB6 format unknown~~ — **RESOLVED**: struct+0xB6 is the **player name** far pointer, NOT wind. Wind is a separate playfield indicator (function 0x28F1D) with "Wind: N" + directional arrow. HUD E9DC now displays player name in player color.
- HUD fuel display: ~~0-100% scale~~ — FIXED (now 0-1000 per mille, player.energy×10)
- HUD battery count: ~~reads stale player.batteries~~ — FIXED (now reads inventory[43])
- ~~Shop Score tab missing~~ — FIXED (Score tab shows ranked player table)
- ~~Shop row count 10 vs EXE 14-15~~ — FIXED (scales with resolution)
- ~~Shop "Cash Left:" label~~ — FIXED
- ~~Shop tab structure~~ — FIXED (Score/Weapons/Miscellaneous/~Done)
- ~~Shop interest display~~ — FIXED (shows "Earned interest: $N" when > 0)
- ~~Extended font: 95 chars vs EXE 161 (missing CP437 0x80-0xFF)~~ — FIXED (added WIDTHS_EXT + GLYPHS_EXT for 66 CP437 glyphs 0x80–0xFD in font.js)
- ~~UI palette RGB values (200-208)~~ — VERIFIED CORRECT. All 9 entries (web 200–208 → EXE 151–159) confirmed from fg_setrgb disassembly at file 0x2A640–0x2A770. No changes needed to palette.js.

**Intermediate files**: `disasm/keyboard_input_analysis.txt`

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
