# Scorched Earth v1.50 Reverse Engineering Project

## Project Context

Reverse engineering the DOS game Scorched Earth v1.50 (1995, Wendell Hicken, Borland C++ 1993).
Goal: extract game mechanics, data structures, and algorithms for faithful reimplementation.

## Key Files

- `earth/SCORCH.EXE` — Original DOS binary (MZ format, 415,456 bytes, header=0x6A00)
- `REVERSE_ENGINEERING.md` — Master document with all findings (weapons, AI, physics, shields, etc.)
- `disasm/instruction_set_x86.py` — Complete x86 16-bit decoder with native FPU emulation (no subprocess)
- `disasm/dis.py` — **Primary disassembler** — replaces r2+fpu_decode pipeline; loads labels/comments
- `disasm/labels.csv` — Knowledge base: file_offset→name and DS:offset→name
- `disasm/comments.csv` — Knowledge base: per-address inline annotations
- `disasm/fpu_decode.py` — Legacy Borland INT 34h-3Dh decoder (uses ndisasm subprocess; kept for reference)
- `disasm/*_decoded.txt` — Decoded disassembly regions (historical output files)

## Tools & Techniques

### Primary Disassembler (dis.py) — use this for all new work
Zero-dependency x86 16-bit disassembler. Handles all instructions + Borland FPU emulation natively.
Loads `disasm/labels.csv` and `disasm/comments.csv` and inlines them into output.

```bash
# Disassemble by file offset (default 40 instructions):
python3 disasm/dis.py 0x25DE9 60        # ai_inject_noise
python3 disasm/dis.py 0x2943A 30        # generate_wind
python3 disasm/dis.py 0x20EA0 50        # extras.cpp start

# Disassemble by DS offset (data region or near-data code):
python3 disasm/dis.py DS:0x11F6 20      # weapon struct area

# Disassemble by segment:offset:
python3 disasm/dis.py 1A4A:0 50         # extras.cpp from seg start
python3 disasm/dis.py 34ED:1870 40      # main_menu function
```

Output columns: `file_offset  SEG:OFF  raw_bytes  mnemonic  operands  ; comment/DS-ref`

### Knowledge Files (labels.csv / comments.csv)
Add new findings here — they appear automatically in all future dis.py runs.

```
# labels.csv format:  file_offset_hex,name[,dtype]   OR   DS:offset_hex,name[,dtype]
0x25DE9,ai_inject_noise
DS:0x515C,MAX_WIND

# Optional 3rd column: dtype — makes dis.py render data instead of code at that address
# Supported dtype values: data/bytes  data/str  data/ptr16  data/farptr  data/table:N
DS:0x11F6,weapon_struct_base,data/table:52
DS:0x2158,config_label_ptrs,data/farptr

# comments.csv format:  file_offset_hex,comment   OR   DS:offset_hex,comment
0x25DE9,ai_inject_noise: scanning architecture with harmonics
DS:0x515C,MAX_WIND: maximum wind speed (default 200; slider 5-500)
```

### Legacy FPU Decoder (fpu_decode.py) — kept for reference only
Uses ndisasm subprocess. Prefer dis.py for all new work.

```bash
# Legacy usage (requires ndisasm installed):
python3 disasm/fpu_decode.py earth/SCORCH.EXE 0x24F01 0x2610F -c -f
```

### Research Tools

```bash
# DS offset ↔ file offset converter + data viewer
python3 disasm/ds_lookup.py earth/SCORCH.EXE DS:0x2B04 -s      # string at DS offset
python3 disasm/ds_lookup.py earth/SCORCH.EXE 0x058884 -s        # string at file offset
python3 disasm/ds_lookup.py earth/SCORCH.EXE DS:0xEF22 -w -n 32 # dump as 16-bit words
python3 disasm/ds_lookup.py earth/SCORCH.EXE DS:0x5250 -f32 -n 4 # 4 float32 values
python3 disasm/ds_lookup.py earth/SCORCH.EXE DS:0x613C -f64     # one float64/double

# Float decoder (same as ds_lookup -f32/-f64 but prints DS+file offset + raw bytes)
python3 disasm/decode_float64.py earth/SCORCH.EXE DS:0x613C DS:0x6144  # two float64s
python3 disasm/decode_float64.py earth/SCORCH.EXE DS:0x5250 -f32 -n 4  # four float32s
python3 disasm/decode_float64.py earth/SCORCH.EXE 0x57AB4               # by file offset

# String scanner with grep
python3 disasm/strings_dump.py earth/SCORCH.EXE -g "wind"    # find wind-related strings
python3 disasm/strings_dump.py earth/SCORCH.EXE -g "~" -m 2  # find hotkey markers
python3 disasm/strings_dump.py earth/SCORCH.EXE -r 0x2000 0x3000  # scan DS range

# Struct array dumper (weapon, glyph, mode tables)
python3 disasm/struct_dump.py earth/SCORCH.EXE weapon -n 60   # all weapons
python3 disasm/struct_dump.py earth/SCORCH.EXE glyph 65       # glyph for 'A'
python3 disasm/struct_dump.py earth/SCORCH.EXE mode -n 9      # graphics modes

# Raw byte-pattern search (hex string, any spacing)
python3 disasm/search_bytes.py "8B 46 FC"                         # find all occurrences
python3 disasm/search_bytes.py CD34 --context 8 --disasm          # with context + disasm
python3 disasm/search_bytes.py "FF 1E" --disasm 12                # disasm 12 lines at each match

# Universal struct/table decoder (generic, any format)
python3 disasm/decode_tables.py DS:0x2158 37 farptr               # far-ptr table (config menu labels)
python3 disasm/decode_tables.py DS:0x2158 10 farptr --follow      # + disassemble at each target
python3 disasm/decode_tables.py DS:0xEF22 8 u16                   # raw u16 table
python3 disasm/decode_tables.py DS:0x11F6 10 struct:52:ptr16,u16,u16,u16,s16,s16
# formats: u8 s8 u16 s16 u32 ptr16 farptr b8 nullstr struct:<n>:<f,f,...>

# Cross-reference finder (who reads/writes a DS variable? who calls a function?)
python3 disasm/xref.py earth/SCORCH.EXE DS:0xED58 --code         # font selector refs
python3 disasm/xref.py earth/SCORCH.EXE DS:0xEF22 --code         # highlight color refs
python3 disasm/xref.py earth/SCORCH.EXE DS:0x518E -c 8           # HUD Y with context
python3 disasm/xref.py earth/SCORCH.EXE --callers 0x38344        # far-call callers only

# Far+near caller finder (xref.py --callers for far calls only; this adds near calls)
python3 disasm/find_callers.py earth/SCORCH.EXE 0x334B6          # all callers of function

# SEG:OFF ↔ file offset converter
python3 disasm/seg_offset.py 2910:0184 DS:0x3826 0x261D7       # multiple at once

# Icon bitmap extractor (DS:0x3826, 48 icons × 125 bytes)
python3 disasm/icon_dump.py earth/SCORCH.EXE                   # list all icons
python3 disasm/icon_dump.py earth/SCORCH.EXE 0 -n 8            # render icons 0-7 as ASCII
python3 disasm/icon_dump.py earth/SCORCH.EXE 0 --raw           # raw hex bytes

# VGA palette dump
python3 disasm/palette_dump.py earth/SCORCH.EXE --accent       # shop animation colors
python3 disasm/palette_dump.py earth/SCORCH.EXE --scan         # find palette blocks
```

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
