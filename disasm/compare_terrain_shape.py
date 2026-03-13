#!/usr/bin/env python3
"""Compare terrain SHAPE between emulator and web port screenshots.

Instead of pixel-exact RGB comparison, this classifies each pixel as
terrain/sky/HUD and compares the terrain boundary (heights array).

Usage:
  python3 disasm/compare_terrain_shape.py <emu.png> <web.png> [--heights emu_heights.json web_heights.json]
"""
import sys, json, struct, zlib


def read_png(path):
    """Minimal PNG reader — returns (width, height, rgba_bytes)."""
    with open(path, 'rb') as f:
        sig = f.read(8)
        assert sig == b'\x89PNG\r\n\x1a\n'
        width = height = bpp = 0
        color_type = 0
        palette = None
        idat_chunks = []
        while True:
            hdr = f.read(8)
            if len(hdr) < 8: break
            length = struct.unpack('>I', hdr[:4])[0]
            ctype = hdr[4:8]
            data = f.read(length)
            f.read(4)  # crc
            if ctype == b'IHDR':
                width = struct.unpack('>I', data[0:4])[0]
                height = struct.unpack('>I', data[4:8])[0]
                color_type = data[9]
                bpp = {2: 3, 6: 4, 3: 1}.get(color_type, 0)
            elif ctype == b'PLTE': palette = data
            elif ctype == b'IDAT': idat_chunks.append(data)
            elif ctype == b'IEND': break
        raw = zlib.decompress(b''.join(idat_chunks))
        stride = width * bpp
        pixels = bytearray(height * stride)
        prev_row = bytearray(stride)
        pos = 0
        for y in range(height):
            filt = raw[pos]; pos += 1
            row = bytearray(raw[pos:pos + stride]); pos += stride
            if filt == 1:
                for x in range(bpp, stride): row[x] = (row[x] + row[x - bpp]) & 0xFF
            elif filt == 2:
                for x in range(stride): row[x] = (row[x] + prev_row[x]) & 0xFF
            elif filt == 3:
                for x in range(stride):
                    a = row[x - bpp] if x >= bpp else 0
                    row[x] = (row[x] + (a + prev_row[x]) // 2) & 0xFF
            elif filt == 4:
                for x in range(stride):
                    a = row[x - bpp] if x >= bpp else 0
                    b = prev_row[x]
                    c = prev_row[x - bpp] if x >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    row[x] = (row[x] + pr) & 0xFF
            pixels[y * stride:(y + 1) * stride] = row
            prev_row = row
        if color_type == 3 and palette:
            rgba = bytearray(width * height * 4)
            for i in range(width * height):
                idx = pixels[i]; pi = idx * 3
                rgba[i*4:i*4+3] = palette[pi:pi+3] if pi+2 < len(palette) else b'\0\0\0'
                rgba[i*4+3] = 255
            return width, height, rgba
        if bpp == 3:
            rgba = bytearray(width * height * 4)
            for i in range(width * height):
                rgba[i*4:i*4+3] = pixels[i*3:i*3+3]
                rgba[i*4+3] = 255
            return width, height, rgba
        return width, height, pixels


def extract_terrain_boundary(w, h, rgba, hud_rows=38):
    """Extract terrain height for each column by finding the sky-terrain boundary.
    Uses luminance/color change detection scanning from top down."""
    heights = []
    for x in range(w):
        # Sample pixel at bottom-4 (terrain reference)
        bi = ((h - 4) * w + x) * 4
        br, bg, bb = rgba[bi], rgba[bi+1], rgba[bi+2]

        # Scan from hud_rows down to find first pixel that's different from sky
        # Sky pixels form a gradient; terrain is distinctly different
        found = h
        for y in range(hud_rows, h - 3):
            i = (y * w + x) * 4
            r, g, b = rgba[i], rgba[i+1], rgba[i+2]
            # Check if pixel is closer to bottom (terrain) than to typical sky
            # Simple: if it matches the bottom pixel's channel ratios
            tdist = abs(r - br) + abs(g - bg) + abs(b - bb)
            if tdist < 80:  # close enough to terrain color
                found = y
                break
        heights.append(found)
    return heights


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    emu_path, web_path = sys.argv[1], sys.argv[2]

    ew, eh, epx = read_png(emu_path)
    ww, wh, wpx = read_png(web_path)

    print(f"EMU: {ew}x{eh}  WEB: {ww}x{wh}")

    # Extract terrain boundaries from RGB pixels
    emu_heights = extract_terrain_boundary(ew, eh, epx)
    web_heights = extract_terrain_boundary(ww, wh, wpx)

    # Compare heights
    w = min(len(emu_heights), len(web_heights))
    total_diff = 0
    max_diff = 0
    exact_match = 0
    close_match = 0  # within 2px

    for x in range(w):
        d = abs(emu_heights[x] - web_heights[x])
        total_diff += d
        max_diff = max(max_diff, d)
        if d == 0: exact_match += 1
        if d <= 2: close_match += 1

    avg_diff = total_diff / w if w > 0 else 0

    print(f"\nTerrain shape comparison ({w} columns):")
    print(f"  Exact match: {exact_match}/{w} ({exact_match/w*100:.1f}%)")
    print(f"  Within 2px:  {close_match}/{w} ({close_match/w*100:.1f}%)")
    print(f"  Average diff: {avg_diff:.1f}px")
    print(f"  Max diff:     {max_diff}px")

    # Show worst columns
    diffs = [(abs(emu_heights[x] - web_heights[x]), x) for x in range(w)]
    diffs.sort(reverse=True)
    if diffs[0][0] > 0:
        print(f"\nWorst columns:")
        for d, x in diffs[:10]:
            if d == 0: break
            print(f"  x={x}: emu={emu_heights[x]} web={web_heights[x]} diff={d}")


if __name__ == '__main__':
    main()
