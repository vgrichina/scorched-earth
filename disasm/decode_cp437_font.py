"""
decode_cp437_font.py — Extract CP437 extended glyph data from SCORCH.EXE

Parses font_init at file 0x4C290 to find all (char_code → glyph_ds_off) mappings,
then reads each glyph's pixel data and converts it to the packed-bit format
used in web/js/font.js.

FINDINGS:
  - Glyph pixel data is ROW-MAJOR (not column-major as documented in font_dump.py)
  - Format: 1 byte width W, then W×12 bytes row-major (row 0..11, W bytes each)
  - Pixel value: 0 = transparent, nonzero = set
  - Data IS present in the raw EXE file (not BSS as font_dump.py incorrectly stated)
  - Pointer table (DS:0xF35A–0xF756) IS BSS (all zeros in file, filled by font_init)

Usage:
  python3 disasm/decode_cp437_font.py earth/SCORCH.EXE           # CP437 chars only
  python3 disasm/decode_cp437_font.py earth/SCORCH.EXE --all     # all 161 glyphs
  python3 disasm/decode_cp437_font.py earth/SCORCH.EXE --js      # JS output for font.js
  python3 disasm/decode_cp437_font.py earth/SCORCH.EXE --render  # ASCII art render
"""

import sys
import struct

DS_FILE_BASE = 0x055D80
DS_SEG       = 0x4F38
FONT_HEIGHT  = 12
FONT_INIT_START = 0x4C290   # file offset of font_init function
FONT_INIT_END   = 0x4C910   # approximate end of pointer-filling code

def ds_to_file(ds_off):
    return DS_FILE_BASE + ds_off

def scan_font_init(exe_data):
    """
    Scan font_init for 'mov word [ptr_ds], glyph_ds_off' instructions.
    Pattern: C7 06 [addr_lo addr_hi] [val_lo val_hi]
    Returns dict: char_code -> glyph_ds_off
    """
    char_to_glyph = {}
    region = exe_data[FONT_INIT_START:FONT_INIT_END]
    i = 0
    while i < len(region) - 5:
        if region[i] == 0xC7 and region[i+1] == 0x06:
            ptr_ds = struct.unpack_from('<H', region, i+2)[0]
            val    = struct.unpack_from('<H', region, i+4)[0]
            # Compute char_code: ptr_ds = (char * 4 - 0xCA6) & 0xFFFF
            # → char * 4 = (ptr_ds - 0xF35A) & 0xFFFF  (0xF35A = ptr for char 0)
            delta = (ptr_ds - 0xF35A) & 0xFFFF
            if delta % 4 == 0:
                char_code = delta // 4
                if 0 <= char_code <= 255 and val != 0x70E4:  # skip null-glyph default
                    char_to_glyph[char_code] = val
            i += 6
        else:
            i += 1
    return char_to_glyph

def read_glyph_row_major(exe_data, glyph_ds_off):
    """
    Read glyph at DS:glyph_ds_off.
    Format: byte width, then width*12 bytes row-major (byte-per-pixel, 0=transparent).
    Returns (width, pixels_2d) where pixels_2d[row][col] is 0 or 1.
    """
    file_off = ds_to_file(glyph_ds_off)
    if file_off >= len(exe_data):
        return 0, []
    width = exe_data[file_off]
    if width == 0:
        return 0, []
    data = exe_data[file_off + 1 : file_off + 1 + width * FONT_HEIGHT]
    if len(data) < width * FONT_HEIGHT:
        return 0, []
    pixels = []
    for row in range(FONT_HEIGHT):
        row_pixels = [data[row * width + col] for col in range(width)]
        pixels.append(row_pixels)
    return width, pixels

def pixels_to_packed(width, pixels):
    """
    Convert row-major pixel array to 12-byte packed-bit array (MSB = leftmost pixel).
    Matches the format used in web/js/font.js GLYPHS array.
    """
    result = []
    for row in range(FONT_HEIGHT):
        byte = 0
        for col in range(min(width, 8)):
            if pixels[row][col]:
                byte |= (0x80 >> col)
        result.append(byte)
    return result

def render_glyph(width, pixels):
    """Render glyph as ASCII art for verification."""
    lines = []
    for row in range(FONT_HEIGHT):
        line = ''.join('#' if pixels[row][col] else '.' for col in range(width))
        lines.append(line)
    return lines

def char_name(code):
    """Human-readable name for CP437 extended chars."""
    cp437_names = {
        0x80: 'Ç', 0x81: 'ü', 0x82: 'é', 0x83: 'â', 0x84: 'ä', 0x85: 'à',
        0x86: 'å', 0x87: 'ç', 0x88: 'ê', 0x89: 'ë', 0x8A: 'è', 0x8B: 'ï',
        0x8C: 'î', 0x8D: 'ì', 0x8E: 'Ä', 0x8F: 'Å', 0x90: 'É', 0x91: 'æ',
        0x92: 'Æ', 0x93: 'ô', 0x94: 'ö', 0x95: 'ò', 0x96: 'û', 0x97: 'ù',
        0x98: 'ÿ', 0x99: 'Ö', 0x9A: 'Ü', 0x9B: '¢', 0x9C: '£', 0x9D: '¥',
        0x9E: 'Pt', 0x9F: 'ƒ', 0xA0: 'á', 0xA1: 'í', 0xA2: 'ó', 0xA3: 'ú',
        0xA4: 'ñ', 0xA5: 'Ñ', 0xA6: 'ª', 0xA7: 'º', 0xA8: '¿',
        0xAB: '½', 0xAC: '¼', 0xAD: '¡',
        0xE0: 'α', 0xE1: 'β', 0xE2: 'Γ', 0xE3: 'π', 0xE4: 'Σ', 0xE5: 'σ',
        0xE6: 'µ', 0xE7: 'τ', 0xE8: 'Φ', 0xE9: 'Θ', 0xEA: 'Ω', 0xEB: 'δ',
        0xEC: '∞', 0xED: 'φ', 0xEE: 'ε', 0xEF: '∩',
        0xF1: '±', 0xF2: '≥', 0xF3: '≤',
        0xF8: '°', 0xFC: 'ⁿ', 0xFD: '²',
    }
    if 32 <= code <= 126:
        return repr(chr(code))
    return cp437_names.get(code, f'0x{code:02X}')

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    with open(exe_path, 'rb') as f:
        exe_data = f.read()

    args = sys.argv[2:]
    show_all    = '--all'    in args
    js_output   = '--js'     in args
    render_mode = '--render' in args

    # Extract all char→glyph mappings from font_init
    char_to_glyph = scan_font_init(exe_data)

    # Filter to CP437 range (0x80+) unless --all
    if show_all:
        chars = sorted(char_to_glyph.keys())
    else:
        chars = sorted(c for c in char_to_glyph if c >= 0x80)

    if js_output:
        # Output JS-compatible WIDTHS_EXT and GLYPHS_EXT arrays for font.js
        # Covers chars 0x80-0xFD (max observed CP437 char = 0xFD = 253)
        # Missing chars get width=0 and all-zero glyph bytes
        max_char = max(chars) if chars else 0xFF
        print(f"// CP437 extended font glyphs extracted from SCORCH.EXE font_init")
        print(f"// Chars 0x80-0x{max_char:02X} ({max_char - 0x80 + 1} slots), {len(chars)} glyphs present")
        print(f"// Format: 12 bytes per char, 1 byte per row, MSB = leftmost pixel")
        print(f"// Width=0 entries: char not present in EXE font")
        print()
        # Widths array
        widths = []
        for code in range(0x80, max_char + 1):
            if code in char_to_glyph:
                glyph_ds = char_to_glyph[code]
                width, _ = read_glyph_row_major(exe_data, glyph_ds)
                widths.append(width)
            else:
                widths.append(0)
        print("const WIDTHS_EXT = new Uint8Array([")
        per_line = 16
        for i in range(0, len(widths), per_line):
            chunk = widths[i:i+per_line]
            codes = [0x80 + i + j for j in range(len(chunk))]
            comment = ' '.join(char_name(c) for c in codes[:8])
            print(f"  {', '.join(str(w) for w in chunk)},  // 0x{0x80+i:02X}.. {comment}")
        print("]);")
        print()
        # Glyphs array
        print("const GLYPHS_EXT = new Uint8Array([")
        for code in range(0x80, max_char + 1):
            if code in char_to_glyph:
                glyph_ds = char_to_glyph[code]
                width, pixels = read_glyph_row_major(exe_data, glyph_ds)
                if width > 0:
                    packed = pixels_to_packed(width, pixels)
                    hex_bytes = ','.join(f'0x{b:02X}' for b in packed)
                    print(f"  {hex_bytes},  // {code}: {char_name(code)} (w={width})")
                    continue
            # Missing or zero-width: 12 zero bytes
            print(f"  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // {code}: {char_name(code)} (missing)")
        print("]);")
        return

    if render_mode:
        for code in chars:
            glyph_ds = char_to_glyph[code]
            width, pixels = read_glyph_row_major(exe_data, glyph_ds)
            print(f"Char 0x{code:02X} {char_name(code):4s}  w={width}  glyph=DS:0x{glyph_ds:04X}")
            if width > 0:
                for row in render_glyph(width, pixels):
                    print('  ' + row)
            print()
        return

    # Default: summary table
    print(f"Font_init char→glyph mapping ({'CP437 only' if not show_all else 'all chars'}):")
    print(f"{'Code':>6}  {'Char':4}  {'GlyphDS':>10}  {'W':>3}  {'FileOff':>8}")
    for code in chars:
        glyph_ds = char_to_glyph[code]
        file_off = ds_to_file(glyph_ds)
        width, _ = read_glyph_row_major(exe_data, glyph_ds)
        print(f"  0x{code:02X}  {char_name(code):4s}  DS:0x{glyph_ds:04X}  {width:3}  file:0x{file_off:05X}")
    print(f"\nTotal: {len(chars)} chars")

if __name__ == '__main__':
    main()
