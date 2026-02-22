"""
icon_dump.py — Extract and render icon bitmaps from SCORCH.EXE

Icon data at DS:0x3826 (file offset 0x0595A6):
  stride = 125 bytes per icon, max 48 icons
  Per icon:
    +0x00  pattern_type  (1 byte)  — rendering mode
    +0x01  width         (1 byte)  — icon width in pixels
    +0x02  height        (1 byte)  — icon height in pixels
    +0x03  pixel_data    (122 bytes) — packed pixel rows

Usage:
    python3 icon_dump.py earth/SCORCH.EXE            # list all icons
    python3 icon_dump.py earth/SCORCH.EXE 0          # render icon 0 as ASCII
    python3 icon_dump.py earth/SCORCH.EXE 0 -n 8     # render icons 0-7
    python3 icon_dump.py earth/SCORCH.EXE 0 --raw    # dump raw hex bytes
    python3 icon_dump.py earth/SCORCH.EXE 0 --png /tmp/icon.png  # export PNG

DS memory layout:
    DS:0x3826 → file 0x059BA6
    Stride: 0x7D = 125 bytes
    Count: 48 (0x30) icons

Related:
    draw_player_icon at file 0x261D7 (icons.cpp seg 0x1F7D:0x0007)
    draw_icon_alive, draw_icon_dead, draw_icon_blank variants
"""

import sys
import struct

HEADER_SIZE  = 0x6A00        # MZ header + relocations
DS_BASE_FILE = 0x055D80      # DS segment file offset (DS=0x4F38, para 0x4F38*16=0x4F380, +header=0x055D80 ... wait, actual = 0x4F38*16? No.)
# Correct: DS segment paragraphs = 0x4F38, file base = 0x6A00 + 0x4F38*16 - <exe_load_offset>
# Actually from project notes: "Data segment (DS): 0x4F38 (file base 0x055D80)"
# ds_to_file(off) = off + 0x055D80 - (0x4F38 * 16) ... no
# From ds_lookup.py: file = DS_OFFSET + 0x4F38_base_file
# DS offset 0x0000 → file 0x055D80, so: file = ds_off + 0x055D80

ICON_DS_BASE = 0x3826        # DS offset of icon array
ICON_STRIDE  = 125           # bytes per icon struct
ICON_COUNT   = 48

def ds_to_file(ds_off):
    return ds_off + 0x055D80

def render_icon_ascii(width, height, pixel_data):
    """Render icon pixels as ASCII art (. = background, # = set pixel).
    Format: column-major byte-per-pixel — pixel[row][col] = pixel_data[col*height + row]
    """
    lines = []
    for row in range(height):
        line = ''
        for col in range(width):
            idx = col * height + row
            b = pixel_data[idx] if idx < len(pixel_data) else 0
            line += '#' if b else '.'
        lines.append(line)
    return lines

def dump_icon(exe_data, icon_idx):
    file_off = ds_to_file(ICON_DS_BASE) + icon_idx * ICON_STRIDE
    if file_off + ICON_STRIDE > len(exe_data):
        print(f"Icon {icon_idx}: out of range (file offset 0x{file_off:05X})")
        return

    raw = exe_data[file_off : file_off + ICON_STRIDE]
    pattern_type = raw[0]
    width        = raw[1]
    height       = raw[2]
    pixel_data   = raw[3:]

    print(f"Icon {icon_idx:2d}  file=0x{file_off:05X}  type={pattern_type}  {width}x{height}px")
    return pattern_type, width, height, pixel_data, raw

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    with open(exe_path, 'rb') as f:
        exe_data = f.read()

    args = sys.argv[2:]

    # Parse flags
    raw_mode  = '--raw'  in args
    png_path  = None
    if '--png' in args:
        idx = args.index('--png')
        if idx + 1 < len(args):
            png_path = args[idx + 1]
            args = [a for a in args if a not in ('--png', png_path)]
    args = [a for a in args if a not in ('--raw',)]

    # Determine which icons to show
    start_idx = 0
    count     = 1
    if not args:
        # List mode: show all icons (type/size only)
        print(f"Icon data at DS:0x{ICON_DS_BASE:04X} = file 0x{ds_to_file(ICON_DS_BASE):05X}")
        print(f"Stride={ICON_STRIDE} bytes, {ICON_COUNT} icons\n")
        for i in range(ICON_COUNT):
            result = dump_icon(exe_data, i)
            if result:
                _, w, h, _, _ = result
        return
    else:
        start_idx = int(args[0], 0)
        if '-n' in args:
            ni = args.index('-n')
            count = int(args[ni + 1])
        else:
            count = 1

    for icon_idx in range(start_idx, start_idx + count):
        result = dump_icon(exe_data, icon_idx)
        if not result:
            continue
        pattern_type, width, height, pixel_data, raw = result

        if raw_mode:
            print(f"  Raw bytes ({ICON_STRIDE}):")
            for off in range(0, ICON_STRIDE, 16):
                chunk = raw[off:off+16]
                print(f"    {off:02X}: {' '.join(f'{b:02X}' for b in chunk)}")
        elif width > 0 and height > 0:
            lines = render_icon_ascii(width, height, pixel_data)
            for line in lines:
                print('  ' + line)

        if png_path and width > 0 and height > 0:
            try:
                from PIL import Image
                img = Image.new('P', (width, height), 0)
                pixels = []
                for b in pixel_data[:width * height]:
                    pixels.append(b)
                img.putdata(pixels)
                img.save(png_path)
                print(f"  Saved PNG: {png_path}")
            except ImportError:
                print("  (PIL not available for PNG export)")

if __name__ == '__main__':
    main()
