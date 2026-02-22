"""
font_dump.py — Extract and render font glyphs from SCORCH.EXE

Font data (from RE notes + struct_dump.py glyph analysis):
    Pointer table: DS:[(char*4) - 0xCA6] & 0xFFFF — 256 far pointers (seg:off)
      For char c: ptr_ds = (c*4 - 0xCA6) & 0xFFFF
      Each entry: 4 bytes = offset(2B) + segment(2B), little-endian
    Glyph data format: 1 byte width + width*12 bytes (column-major, byte-per-pixel)
      Byte 0: advance width in pixels
      Bytes 1+: column data, 12 bytes per column (one byte per row, top to bottom)
        Byte value = VGA palette index; nonzero = pixel drawn, 0 = transparent
    All glyphs: 12 rows tall (FONT_HEIGHT = 12)
    161 chars: ASCII 0x20-0x7E (printable) + CP437 0x80-0xFF (extended)

IMPORTANT: Glyph pixel data at DS:0x70E4 is BSS — zero-initialized at EXE load time.
    font_init at file 0x4C290 copies glyph data (from the font code segment 0x4589)
    into DS:0x70E4+ at runtime, then fills the pointer table. The raw EXE file has
    zeros there. This tool cannot extract pixel data from the raw binary.
    Use a DOSBox runtime memory dump (after font_init) to get pixel data, or
    use web/js/font.js which has all 95 glyphs already extracted from a runtime dump.

Font pointer table verified:
    DS:0xF45E → far ptr for 'A' (0x41): (0x41*4 - 0xCA6) & 0xFFFF = 0xF45E
    (pointer entries are also BSS zeros in raw file; populated at runtime)

Usage:
    python3 font_dump.py earth/SCORCH.EXE 65          # glyph for 'A'
    python3 font_dump.py earth/SCORCH.EXE 65 -n 26    # glyphs A-Z
    python3 font_dump.py earth/SCORCH.EXE 32 -n 95    # all printable ASCII
    python3 font_dump.py earth/SCORCH.EXE --widths     # dump WIDTHS[] for web port
    python3 font_dump.py earth/SCORCH.EXE --all        # all 95 printable glyphs
"""

import sys
import struct

DS_FILE_BASE = 0x055D80
DS_SEG       = 0x4F38
FONT_HEIGHT  = 12

def ds_to_file(ds_off):
    return ds_off + DS_FILE_BASE

def glyph_file_offset(exe_data, char_code):
    """Look up glyph data file offset via font pointer table."""
    ptr_ds   = (char_code * 4 - 0xCA6) & 0xFFFF
    ptr_file = ds_to_file(ptr_ds)
    if ptr_file + 4 > len(exe_data):
        return None, None
    glyph_off = struct.unpack_from('<H', exe_data, ptr_file)[0]
    glyph_seg = struct.unpack_from('<H', exe_data, ptr_file + 2)[0]
    if glyph_seg != DS_SEG:
        return None, glyph_seg
    return ds_to_file(glyph_off), None

def read_glyph(exe_data, file_off):
    """Read glyph: returns (width, pixel_data) where pixel_data is column-major."""
    if file_off is None or file_off >= len(exe_data):
        return 0, b''
    width = exe_data[file_off]
    pixel_data = exe_data[file_off + 1 : file_off + 1 + width * FONT_HEIGHT]
    return width, pixel_data

def render_glyph_ascii(width, pixel_data):
    """Render glyph as ASCII art (# = pixel, . = transparent)."""
    rows = []
    for row in range(FONT_HEIGHT):
        line = ''
        for col in range(width):
            idx = col * FONT_HEIGHT + row
            px  = pixel_data[idx] if idx < len(pixel_data) else 0
            line += '#' if px else '.'
        rows.append(line)
    return rows

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    with open(exe_path, 'rb') as f:
        exe_data = f.read()

    args = sys.argv[2:]

    # --widths: print WIDTHS array for web port font.js
    if '--widths' in args:
        print("// Font advance widths from SCORCH.EXE pointer table")
        print("// For web/js/font.js WIDTHS array (chars 32-126)")
        widths = []
        for c in range(32, 127):
            file_off, _ = glyph_file_offset(exe_data, c)
            if file_off:
                w = exe_data[file_off]
            else:
                w = 0
            widths.append(w)
        per_line = 16
        first_char = 32
        for i in range(0, len(widths), per_line):
            chunk = widths[i:i+per_line]
            chars = ''.join(chr(first_char+i+j) if 32 <= first_char+i+j <= 126 else '.'
                            for j in range(len(chunk)))
            print(f"  {', '.join(str(w) for w in chunk)},  // {chars}")
        return

    # --all: all 95 printable ASCII glyphs
    if '--all' in args:
        start_char = 32
        count = 95
    elif not args:
        print(__doc__)
        sys.exit(0)
    else:
        start_char = int(args[0], 0)
        count = 1
        if '-n' in args:
            ni = args.index('-n')
            count = int(args[ni + 1])

    for char_code in range(start_char, start_char + count):
        ch_disp = chr(char_code) if 32 <= char_code <= 126 else f'0x{char_code:02X}'
        file_off, bad_seg = glyph_file_offset(exe_data, char_code)
        if file_off is None:
            print(f"Char {char_code} '{ch_disp}' — pointer not in DS (seg {bad_seg:04X})")
            continue
        width, pixel_data = read_glyph(exe_data, file_off)
        ptr_ds = (char_code * 4 - 0xCA6) & 0xFFFF
        print(f"Char {char_code} '{ch_disp}'  width={width}  ptr=DS:0x{ptr_ds:04X}  data=file:0x{file_off:05X}")
        if width > 0:
            for row in render_glyph_ascii(width, pixel_data):
                print('  ' + row)
        print()

if __name__ == '__main__':
    main()
