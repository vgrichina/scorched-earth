# Next Session Plan — Scorched Earth RE

Read `REVERSE_ENGINEERING.md` first — it has everything found so far.

## Quick Wins (do first)

### 1. Get v1.2 binary, check items 50-56 prices
Download from https://www.whicken.com/scorch/ — v1.2 may not have the linker bug that corrupts items 50-56 (Force Shield, Heavy Shield, Super Mag, Patriot Missiles, Auto Defense, Fuel Tank, Contact Trigger). Compare struct data at same offsets.

### 2. Get the bundled HTML manual
The game download includes an HTML manual. Extract it and check for item price tables.

### 3. DOSBox debugger alternative
Run v1.50 in DOSBox debug build, break at shop code, dump DS:0x11F6 region at runtime to see if any init code fixes up the corrupted prices before the shop renders them.

## Medium Effort

### 4. Write a Borland FPU emulation decoder
The biggest blocker for deeper RE is that all FPU math uses INT 34h-3Dh. Write a python3 script that:
- Takes a binary region
- Decodes `CD 34`-`CD 3D` sequences into readable x87 mnemonics
- Resolves DS:xxxx operand references to known constants

This unlocks: AI solver, exact damage formula, and any other floating-point code.

### 5. AI trajectory solver (shark.cpp)
Code segment 0x3167 (file ~0x38070). With the FPU decoder from #4, disassemble to find:
- How AI picks target angle + power
- Whether it simulates trajectories or uses closed-form solution
- How noise values [50/23/63] are applied (additive? multiplicative?)

### 6. Tank rendering (icons.cpp)
5 code segments (0x1F7F-0x1F9B). Find pixel dimensions of tank body, turret, barrel. Look for coordinate arrays or draw calls with hardcoded sizes.

## Bigger Tasks

### 7. Weapon behavior dispatch
Trace how bhvType+bhvSub route to specific weapon behavior:
- Napalm fire particles (0x01A0)
- Roller terrain interaction (0x0003)
- MIRV split at apogee (0x0239)
- Popcorn Bomb / Funky Bomb special handling

### 8. Player struct full layout
Known fields so far (from shield + explosion code):
```
+0x0E/+0x10  x/y position
+0x12/+0x14  dimensions
+0x4A        energy field
+0x92        turret angle
+0x94        turret direction
+0x96        shield energy
+0xB6        name far ptr
+0xC6        shield config ptr
```
Need: cash, score, health, inventory, team, AI type, alive flag. Trace player.cpp (segment 0x2B3B).

### 9. Cheat codes
Strings: ASGARD, frondheim, ragnarok, mayhem, nofloat. Search for xrefs to find what each activates.

## Key Technical Notes

- **Binary**: `earth/SCORCH.EXE` (415,456 bytes, 16-bit DOS MZ)
- **Tools**: radare2 (`r2 -a x86 -b 16`), python3, ndisasm
- **FPU**: All float math is `INT 34h-3Dh`, NOT native x87
- **Memory model**: Borland large — each .cpp = own code segment, shared DS=0x4F38
- **Data segment**: file offset 0x055D80
- **Header**: 0x6A00 bytes (6136 relocations)
- **Two confirmed linker bugs**: weapon struct items 50-56 and Sentient AI vtable both overflow into debug string data
