"""
palette_dump.py — Extract and display VGA palette data from SCORCH.EXE

The EXE uses Fastgraph's fg_setpalette / fg_setrgb to program the VGA DAC.
Palette init sequences are typically stored as tables of (index, R, G, B) tuples
or as flat 768-byte blocks (256 × 3 bytes, 6-bit VGA values 0-63).

Known palette regions (from RE notes):
    UI colors at DS:0xEF22-0xEF32 are VARIABLE REFERENCES, not palette data.
    Palette 163 (0xA3) = current player color (set via fg_setrgb at file 0x3030E)
    Player palettes: 8 slots per player, baseColor = player.index * 8
    Accent animation table at DS:0x1F62: 5 entries × 6 bytes (R,G,B words)
      bright red (63,0,0), orange (63,32,10), magenta (63,0,63),
      dark red (63,12,12), deep pink (63,0,30)

Usage:
    python3 palette_dump.py earth/SCORCH.EXE --scan      # scan for 768-byte palette blocks
    python3 palette_dump.py earth/SCORCH.EXE DS:0x1F62   # dump accent animation table
    python3 palette_dump.py earth/SCORCH.EXE 0xFILEOFF -n 16  # dump 16 palette entries
    python3 palette_dump.py earth/SCORCH.EXE --accent    # show accent color table

Output: palette index, R/G/B as 6-bit (0-63) and 8-bit (0-255), and a color swatch.
"""

import sys
import struct

DS_FILE_BASE = 0x055D80

def ds_to_file(ds_off):
    return ds_off + DS_FILE_BASE

def to_8bit(v6):
    return round(v6 * 255 / 63)

def color_swatch(r6, g6, b6):
    """ANSI 24-bit color block for terminal preview."""
    r8, g8, b8 = to_8bit(r6), to_8bit(g6), to_8bit(b6)
    return f"\x1b[48;2;{r8};{g8};{b8}m  \x1b[0m"

def dump_palette_entries(exe_data, file_off, count=16):
    """Dump palette entries as (idx, R, G, B) starting at file_off."""
    print(f"Palette entries at file 0x{file_off:05X} (6-bit VGA):")
    print(f"  {'idx':>4}  {'R':>3} {'G':>3} {'B':>3}  {'R8':>3} {'G8':>3} {'B8':>3}  swatch")
    for i in range(count):
        off = file_off + i * 3
        if off + 3 > len(exe_data):
            break
        r, g, b = exe_data[off], exe_data[off+1], exe_data[off+2]
        swatch = color_swatch(r, g, b)
        r8, g8, b8 = to_8bit(r), to_8bit(g), to_8bit(b)
        print(f"  {i+0:>4}  {r:>3} {g:>3} {b:>3}   {r8:>3} {g8:>3} {b8:>3}  {swatch}")

def dump_accent_table(exe_data):
    """Dump the shop palette animation accent table at DS:0x1F62."""
    # 5 entries × 6 bytes each (3 × uint16 R,G,B in 6-bit VGA)
    file_off = ds_to_file(0x1F62)
    print(f"Accent animation table at DS:0x1F62 = file 0x{file_off:05X}")
    print("EXE: cycles palette indices 8-11 every 8 frames (shop animation)\n")
    names = ['bright red', 'orange', 'magenta', 'dark red', 'deep pink']
    for i in range(5):
        off = file_off + i * 6
        r, g, b = struct.unpack_from('<HHH', exe_data, off)
        swatch = color_swatch(r, g, b)
        r8, g8, b8 = to_8bit(r), to_8bit(g), to_8bit(b)
        name = names[i] if i < len(names) else f'entry {i}'
        print(f"  {i}: {name:12s}  R={r:2d} G={g:2d} B={b:2d}  → #{r8:02X}{g8:02X}{b8:02X}  {swatch}")

def scan_palette_blocks(exe_data):
    """Scan for 768-byte blocks that look like full VGA palette data (values 0-63)."""
    print("Scanning for 768-byte VGA palette blocks (all bytes 0-63)...")
    hits = []
    for off in range(0, len(exe_data) - 768, 16):
        chunk = exe_data[off:off+768]
        if all(b <= 63 for b in chunk):
            # Additional heuristic: should have non-trivial spread of values
            unique = len(set(chunk))
            if unique > 20:
                hits.append((off, unique))
    if hits:
        for off, u in hits:
            print(f"  file 0x{off:05X}  ({u} unique values)")
    else:
        print("  No clean 768-byte palette blocks found.")
    return hits

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    with open(exe_path, 'rb') as f:
        exe_data = f.read()

    args = sys.argv[2:]

    if not args or '--scan' in args:
        scan_palette_blocks(exe_data)
        return

    if '--accent' in args:
        dump_accent_table(exe_data)
        return

    # Parse address
    token = args[0]
    count = 16
    if '-n' in args:
        ni = args.index('-n')
        count = int(args[ni + 1])

    lo = token.lower()
    if lo.startswith('ds:'):
        ds_off = int(token[3:], 16)
        file_off = ds_to_file(ds_off)
        print(f"DS:0x{ds_off:04X} → file 0x{file_off:05X}")
    else:
        file_off = int(token, 16)

    dump_palette_entries(exe_data, file_off, count)

if __name__ == '__main__':
    main()
