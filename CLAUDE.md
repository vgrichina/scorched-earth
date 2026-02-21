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
- Font glyph data: DS:0x70E4–0x94EA (file 0x05CE64–0x05F26A), 161 chars, proportional width, 12px tall
- Font pointer table: DS:[(char*4) - 0xCA6], 256 far pointers to glyph data
- Layout selector: DS:0xED58 (0=spacious/25px rows, 1=compact/17px rows) — same font both modes

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
| *(menu module)* | 0x34ED | 0x3B8D0 | Main menu/config UI, sub-dialogs |
| *(font module)* | 0x4589 | 0x4C290 | Fastgraph text rendering (font_init, text_display, text_measure) |

## v86 DOS Emulator (browser-based EXE comparison)

Run the original SCORCH.EXE in-browser via v86 (x86 emulator in JS/WASM):
- `v86.html` — Launcher page (boot FreeDOS, then click SCORCH)
- `v86/bios/` — SeaBIOS + VGA BIOS ROMs
- `v86/images/freedos722.img` — FreeDOS boot floppy
- `v86/images/game.img` — FAT disk image with SCORCH.EXE + data files
- `build_v86/` — libv86.js + v86.wasm (copied from ../supaplex/build_v86/)
- `build/` — v86.wasm + v86-fallback.wasm (libv86.js resolves wasm relative to page root)

To rebuild game.img after changing earth/ files:
```bash
dd if=/dev/zero of=v86/images/game.img bs=512 count=10240
mformat -i v86/images/game.img -F -h 16 -s 63 -T 10240 ::
mcopy -i v86/images/game.img earth/*.EXE earth/*.CFG earth/*.MTN ::
```
Image must be FAT32 with HD geometry (16 heads, 63 sectors/track) — FAT12 causes read errors.

Serve from project root: `python3 -m http.server 8090` → http://localhost:8090/v86.html

## Conventions

- File offsets are always hex with 0x prefix (e.g., 0x263F0)
- DS offsets written as DS:XXXX (e.g., DS:CEB8)
- Segment:offset pairs as SEG:OFF (e.g., 1E50:0001)
- All findings go into REVERSE_ENGINEERING.md with section headers
- Mark resolved items with ~~strikethrough~~ in the Open Tasks section
- Intermediate disassembly output goes in `disasm/` directory
