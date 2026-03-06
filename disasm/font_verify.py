#!/usr/bin/env python3
"""Verify web font.js glyph data against EXE font data.

Reads the font pointer table from font_init (0x4C290) to build char→DS_offset mapping,
then reads each glyph's width + bitmap from the EXE, converts to packed 1-bit format,
and compares against web font.js WIDTHS/GLYPHS arrays.
"""

import struct, re

EXE = "earth/SCORCH.EXE"
DS_FILE_BASE = 0x055D80

def read_exe():
    with open(EXE, "rb") as f:
        return f.read()

def build_char_map(data):
    """Extract char→DS_offset from font_init pointer table assignments.

    Pattern: mov word [TABLE_ENTRY], DS_GLYPH_OFFSET
    where TABLE_ENTRY = char*4 - 0xCA6, so char = (TABLE_ENTRY + 0xCA6) / 4

    Default: all chars point to DS:0x70E4 (the "default" glyph).
    Then specific chars get overridden.
    """
    # Parse the disassembly to find all 'mov word [XXXX], YYYY' instructions
    # in font_init. Instead, let's just scan the binary for the pattern.
    # The instructions are: C7 06 XX XX YY YY (mov word [imm16], imm16)

    char_map = {}

    # Default: all 256 chars → DS:0x70E4
    for c in range(256):
        char_map[c] = 0x70E4

    # Scan font_init region (0x4C2BF to 0x4C905) for mov word [xxxx], yyyy
    start = 0x4C2BB
    end = 0x4C905
    pos = start
    while pos < end:
        if data[pos] == 0xC7 and data[pos+1] == 0x06:
            table_off = struct.unpack_from("<H", data, pos+2)[0]
            glyph_ds = struct.unpack_from("<H", data, pos+4)[0]
            # Check if this is a pointer table entry (even offset in the right range)
            char_code = ((table_off + 0x0CA6) & 0xFFFF) // 4
            remainder = ((table_off + 0x0CA6) & 0xFFFF) % 4
            if remainder == 0 and 0 <= char_code <= 255:
                # Only update if this sets the offset part (not the segment part)
                # Segment entries set table_off + 2 (odd alignment)
                char_map[char_code] = glyph_ds
            pos += 6
        elif data[pos] == 0x8C and data[pos+1] == 0x1E:
            # mov [imm16], ds — segment store, skip
            pos += 4
        else:
            pos += 1

    return char_map

def glyph_to_packed(width, raw_bytes):
    """Convert EXE row-major byte-per-pixel to packed 1-bit-per-row."""
    packed = []
    for row in range(12):
        byte_val = 0
        for col in range(width):
            idx = row * width + col
            pixel = raw_bytes[idx] if idx < len(raw_bytes) else 0
            if pixel:
                byte_val |= (0x80 >> col)
        packed.append(byte_val)
    return bytes(packed)

def read_glyph(data, ds_offset):
    """Read a glyph from EXE at given DS offset. Returns (width, packed_12_bytes)."""
    file_off = DS_FILE_BASE + ds_offset
    width = data[file_off]
    raw = data[file_off+1 : file_off+1+width*12]
    packed = glyph_to_packed(width, raw)
    return width, packed

def main():
    data = read_exe()
    char_map = build_char_map(data)

    # Read web font.js data inline for comparison
    # ASCII 32-126 widths
    web_widths = [
        4, 1, 3, 5, 5, 6, 5, 2, 3, 3, 5, 5, 3, 5, 2, 5,
        5, 4, 5, 5, 5, 5, 5, 5, 5, 5, 2, 2, 4, 5, 4, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 3, 5, 5,
        3, 5, 5, 5, 5, 5, 3, 5, 5, 3, 3, 4, 3, 5, 5, 5,
        5, 5, 4, 5, 3, 5, 5, 5, 5, 5, 5, 4, 1, 4, 5,
    ]

    # Count non-default chars
    non_default = sum(1 for c in range(256) if char_map[c] != 0x70E4)
    print(f"Font pointer table: {non_default} chars with custom glyphs (rest → default at DS:0x70E4)")

    # Default glyph info
    def_w, def_p = read_glyph(data, 0x70E4)
    print(f"Default glyph: width={def_w}, all-zero={all(b==0 for b in def_p)}")

    # Compare ASCII 32-126
    width_errs = []
    glyph_errs = []

    for i in range(95):
        ch = 32 + i
        exe_w, exe_packed = read_glyph(data, char_map[ch])
        web_w = web_widths[i]

        if exe_w != web_w:
            width_errs.append((ch, exe_w, web_w))
        else:
            # Compare bitmap - need web GLYPHS data
            # We'll do this comparison by re-reading font.js
            pass

    print(f"\n=== ASCII 32-126 Width Comparison ===")
    if width_errs:
        print(f"WIDTH MISMATCHES: {len(width_errs)}")
        for ch, ew, ww in width_errs:
            print(f"  char {ch} ({chr(ch)}): EXE={ew} web={ww}")
    else:
        print("All 95 widths match!")

    # Now let's do full glyph comparison by reading font.js
    import os
    font_js = os.path.join(os.path.dirname(__file__), '..', 'web', 'js', 'font.js')
    with open(font_js) as f:
        content = f.read()

    # Extract GLYPHS array bytes
    def extract_hex_array(content, var_name):
        pattern = rf'const {var_name}\s*=\s*new Uint8Array\(\[([\s\S]*?)\]\)'
        m = re.search(pattern, content)
        if not m: return None
        hex_str = m.group(1)
        # Remove comments and whitespace
        hex_str = re.sub(r'//[^\n]*', '', hex_str)
        vals = re.findall(r'0x([0-9A-Fa-f]{2})', hex_str)
        return bytes(int(v, 16) for v in vals)

    web_glyphs = extract_hex_array(content, 'GLYPHS')
    web_glyphs_ext = extract_hex_array(content, 'GLYPHS_EXT')

    web_widths_ext_raw = extract_hex_array(content, 'WIDTHS_EXT')

    if web_glyphs:
        print(f"\n=== ASCII 32-126 Glyph Bitmap Comparison ===")
        mismatches = 0
        for i in range(95):
            ch = 32 + i
            exe_w, exe_packed = read_glyph(data, char_map[ch])
            web_w = web_widths[i]
            web_packed = web_glyphs[i*12:(i+1)*12]

            if exe_w == web_w and exe_packed != web_packed:
                mismatches += 1
                print(f"  char {ch} ({chr(ch)}) width={exe_w}:")
                for row in range(12):
                    if exe_packed[row] != web_packed[row]:
                        # Show visual diff
                        def bits(b, w):
                            return ''.join('#' if b & (0x80>>c) else '.' for c in range(w))
                        print(f"    row {row:2d}: EXE={bits(exe_packed[row], exe_w)} (0x{exe_packed[row]:02X})  web={bits(web_packed[row], exe_w)} (0x{web_packed[row]:02X})")

        if mismatches == 0:
            print("  All matching-width glyphs have identical bitmaps!")

    # Extended chars (0x80-0xFD)
    if web_widths_ext_raw and web_glyphs_ext:
        print(f"\n=== Extended Chars 0x80-0xFD Width Comparison ===")
        ext_w_errs = []
        ext_g_errs = []
        for i in range(126):  # 0x80 to 0xFD
            ch = 0x80 + i
            exe_w, exe_packed = read_glyph(data, char_map[ch])
            web_w = web_widths_ext_raw[i]

            if exe_w != web_w:
                ext_w_errs.append((ch, exe_w, web_w))
            elif exe_w > 0:
                web_packed = web_glyphs_ext[i*12:(i+1)*12]
                if exe_packed != web_packed:
                    ext_g_errs.append((ch, exe_w, exe_packed, web_packed))

        if ext_w_errs:
            print(f"WIDTH MISMATCHES: {len(ext_w_errs)}")
            for ch, ew, ww in ext_w_errs:
                print(f"  char 0x{ch:02X}: EXE={ew} web={ww}")
        else:
            print("All extended widths match!")

        if ext_g_errs:
            print(f"\nGLYPH MISMATCHES: {len(ext_g_errs)}")
            for ch, w, ep, wp in ext_g_errs:
                print(f"  char 0x{ch:02X} width={w}:")
                for row in range(12):
                    if ep[row] != wp[row]:
                        def bits(b, w):
                            return ''.join('#' if b & (0x80>>c) else '.' for c in range(w))
                        print(f"    row {row:2d}: EXE={bits(ep[row], w)} (0x{ep[row]:02X})  web={bits(wp[row], w)} (0x{wp[row]:02X})")
        else:
            print("All extended glyph bitmaps match!")

    # Summary
    ext_total = 0
    if web_widths_ext_raw:
        ext_total = len(ext_w_errs) + len(ext_g_errs)
    total = len(width_errs) + (mismatches if web_glyphs else 0) + ext_total
    print(f"\n{'PASS' if total == 0 else 'FAIL'}: {total} total discrepancies")

if __name__ == "__main__":
    main()
