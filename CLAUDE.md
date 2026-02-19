# Scorched Earth v1.50 Reverse Engineering Project

## Project Context

Reverse engineering the DOS game Scorched Earth v1.50 (1995, Wendell Hicken, Borland C++ 1993).
Goal: extract game mechanics, data structures, and algorithms for faithful reimplementation.

## Key Files

- `earth/SCORCH.EXE` — Original DOS binary (MZ format, 415,456 bytes, header=0x6A00)
- `REVERSE_ENGINEERING.md` — Master document with all findings (weapons, AI, physics, shields, etc.)
- `disasm/fpu_decode.py` — Borland INT 34h-3Dh FPU instruction decoder
- `disasm/*_decoded.txt` — Decoded disassembly regions with readable FPU mnemonics
- `disasm/*.txt` — Raw disassembly and analysis intermediate files

## Tools & Techniques

### FPU Decoder (critical tool)
Borland C++ 1993 encodes ALL floating-point math as INT 34h-3Dh software interrupts.
Raw radare2 disassembly is unreadable without decoding these first.

```bash
# Decode a region with constant annotations and function boundaries:
python3 disasm/fpu_decode.py earth/SCORCH.EXE <start_offset> <end_or_+length> -c -f

# Example: decode AI solver region
python3 disasm/fpu_decode.py earth/SCORCH.EXE 0x24F01 0x2610F -c -f
```

Always decode with `-c -f` flags for maximum annotation.

### Radare2
```bash
r2 -a x86 -b 16 -s 0x6a00 earth/SCORCH.EXE
# Then: s <file_offset>; pd 200
```

Note: r2 misinterprets INT 34h-3Dh as software interrupts. Use fpu_decode.py instead for FPU-heavy regions.

### Key Binary Layout
- Header: 0x6A00 bytes (MZ DOS header + relocations)
- Data segment (DS): 0x4F38 (file base 0x055D80)
- Player struct: stride 0x6C (108 bytes), far ptr base at DS:CEB8
- Tank/sub struct: stride 0xCA (202 bytes), base at DS:D568
- Weapon struct: stride 0x34 (52 bytes), base at DS:11F6 (file 0x056F76)

### Source File Segments (from debug strings)
| File | Code Segment | File Base | Purpose |
|------|-------------|-----------|---------|
| extras.cpp | 0x1A4A | 0x20EA0 | Explosions/damage/projectiles |
| icons.cpp | 0x1F7F+ | 0x263F0 | Tank/icon rendering |
| shark.cpp | 0x3167 | 0x38070 | AI trajectory solver |
| shields.cpp | 0x31D8 | 0x38780 | Shield system |
| player.cpp | 0x2B3B+ | 0x31FB0 | Player/tank management |
| play.cpp | 0x28B9 | 0x2F830 | Main game loop |
| ranges.cpp | 0x2CBF | 0x33690 | Terrain generation |

## Conventions

- File offsets are always hex with 0x prefix (e.g., 0x263F0)
- DS offsets written as DS:XXXX (e.g., DS:CEB8)
- Segment:offset pairs as SEG:OFF (e.g., 1E50:0001)
- All findings go into REVERSE_ENGINEERING.md with section headers
- Mark resolved items with ~~strikethrough~~ in the Open Tasks section
- Intermediate disassembly output goes in `disasm/` directory
