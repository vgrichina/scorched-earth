#!/usr/bin/env python3
"""Compare emulator and web port screenshots pixel-by-pixel.

Usage:
  python3 disasm/compare_screenshots.py <emu.png> <web.png> [output_diff.png]

Produces a side-by-side image with pixel differences highlighted in red.
Also prints diff statistics (total pixels, % match, worst regions).
"""

import sys
import struct
import zlib

def read_png(path):
    """Minimal PNG reader — returns (width, height, rgba_bytes)."""
    with open(path, 'rb') as f:
        sig = f.read(8)
        assert sig == b'\x89PNG\r\n\x1a\n', f"Not a PNG: {path}"

        width = height = bpp = 0
        color_type = 0
        palette = None
        idat_chunks = []

        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            length = struct.unpack('>I', hdr[:4])[0]
            ctype = hdr[4:8]
            data = f.read(length)
            _crc = f.read(4)

            if ctype == b'IHDR':
                width = struct.unpack('>I', data[0:4])[0]
                height = struct.unpack('>I', data[4:8])[0]
                bit_depth = data[8]
                color_type = data[9]
                if color_type == 2:
                    bpp = 3  # RGB
                elif color_type == 6:
                    bpp = 4  # RGBA
                elif color_type == 3:
                    bpp = 1  # Indexed
                else:
                    raise ValueError(f"Unsupported color type {color_type}")
            elif ctype == b'PLTE':
                palette = data  # R,G,B triples
            elif ctype == b'IDAT':
                idat_chunks.append(data)
            elif ctype == b'IEND':
                break

        raw = zlib.decompress(b''.join(idat_chunks))

        # Defilter
        stride = width * bpp
        pixels = bytearray(height * stride)
        prev_row = bytearray(stride)

        pos = 0
        for y in range(height):
            filt = raw[pos]
            pos += 1
            row = bytearray(raw[pos:pos + stride])
            pos += stride

            if filt == 0:  # None
                pass
            elif filt == 1:  # Sub
                for x in range(bpp, stride):
                    row[x] = (row[x] + row[x - bpp]) & 0xFF
            elif filt == 2:  # Up
                for x in range(stride):
                    row[x] = (row[x] + prev_row[x]) & 0xFF
            elif filt == 3:  # Average
                for x in range(stride):
                    a = row[x - bpp] if x >= bpp else 0
                    row[x] = (row[x] + (a + prev_row[x]) // 2) & 0xFF
            elif filt == 4:  # Paeth
                for x in range(stride):
                    a = row[x - bpp] if x >= bpp else 0
                    b = prev_row[x]
                    c = prev_row[x - bpp] if x >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    if pa <= pb and pa <= pc:
                        pr = a
                    elif pb <= pc:
                        pr = b
                    else:
                        pr = c
                    row[x] = (row[x] + pr) & 0xFF

            pixels[y * stride:(y + 1) * stride] = row
            prev_row = row

        # Convert indexed to RGBA
        if color_type == 3 and palette:
            rgba = bytearray(width * height * 4)
            for i in range(width * height):
                idx = pixels[i]
                pi = idx * 3
                rgba[i*4] = palette[pi] if pi+2 < len(palette) else 0
                rgba[i*4+1] = palette[pi+1] if pi+2 < len(palette) else 0
                rgba[i*4+2] = palette[pi+2] if pi+2 < len(palette) else 0
                rgba[i*4+3] = 255
            return width, height, rgba

        # Convert to RGBA if RGB
        if bpp == 3:
            rgba = bytearray(width * height * 4)
            for i in range(width * height):
                rgba[i*4] = pixels[i*3]
                rgba[i*4+1] = pixels[i*3+1]
                rgba[i*4+2] = pixels[i*3+2]
                rgba[i*4+3] = 255
            return width, height, rgba

        return width, height, pixels


def write_png(path, width, height, rgba):
    """Minimal PNG writer — writes RGBA data."""
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # no filter
        raw.extend(rgba[y * stride:(y + 1) * stride])

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw), 9)))
        f.write(chunk(b'IEND', b''))


def compare(emu_path, web_path, diff_path=None, mask_hud=0):
    ew, eh, epx = read_png(emu_path)
    ww, wh, wpx = read_png(web_path)

    print(f"EMU: {ew}x{eh}  WEB: {ww}x{wh}")

    if ew != ww or eh != wh:
        print(f"WARNING: size mismatch ({ew}x{eh} vs {ww}x{wh})")
        # Compare overlapping region
        cw, ch = min(ew, ww), min(eh, wh)
    else:
        cw, ch = ew, eh

    total = cw * ch
    masked = 0
    diff_count = 0
    diff_map = bytearray(cw * ch)  # 1 = different

    for y in range(ch):
        for x in range(cw):
            # Skip HUD text region from diff (state mismatch artifact)
            if mask_hud and y < mask_hud:
                masked += 1
                continue
            ei = (y * ew + x) * 4
            wi = (y * ww + x) * 4
            er, eg, eb = epx[ei], epx[ei+1], epx[ei+2]
            wr, wg, wb = wpx[wi], wpx[wi+1], wpx[wi+2]
            if er != wr or eg != wg or eb != wb:
                # Use a small tolerance for VGA 6-bit DAC rounding
                if abs(er-wr) > 1 or abs(eg-wg) > 1 or abs(eb-wb) > 1:
                    diff_count += 1
                    diff_map[y * cw + x] = 1

    compared = total - masked
    match_pct = (compared - diff_count) / compared * 100 if compared else 0
    hud_note = f"  (HUD masked: y<{mask_hud})" if mask_hud else ""
    print(f"Pixels: {compared}  Match: {compared - diff_count} ({match_pct:.1f}%)  Diff: {diff_count} ({100-match_pct:.1f}%){hud_note}")

    # Find bounding box of differences
    if diff_count > 0:
        min_x, min_y, max_x, max_y = cw, ch, 0, 0
        for y in range(ch):
            for x in range(cw):
                if diff_map[y * cw + x]:
                    min_x = min(min_x, x)
                    min_y = min(min_y, y)
                    max_x = max(max_x, x)
                    max_y = max(max_y, y)
        print(f"Diff region: ({min_x},{min_y}) to ({max_x},{max_y}) = {max_x-min_x+1}x{max_y-min_y+1}")

    # Write diff image: side-by-side with red overlay on differences
    if diff_path:
        out_w = ew + ww + 10  # emu | gap | web
        out_h = max(eh, wh)
        out = bytearray(out_w * out_h * 4)

        # Fill gap with dark gray
        for y in range(out_h):
            for x in range(ew, ew + 10):
                i = (y * out_w + x) * 4
                out[i] = out[i+1] = out[i+2] = 40
                out[i+3] = 255

        # Copy emu image (left)
        for y in range(eh):
            for x in range(ew):
                si = (y * ew + x) * 4
                di = (y * out_w + x) * 4
                out[di:di+4] = epx[si:si+4]

        # Copy web image (right) with diff highlight
        ox = ew + 10
        for y in range(wh):
            for x in range(ww):
                si = (y * ww + x) * 4
                di = (y * out_w + ox + x) * 4
                if x < cw and y < ch and diff_map[y * cw + x]:
                    # Red highlight (blend 50% red)
                    out[di] = min(255, wpx[si] // 2 + 128)
                    out[di+1] = wpx[si+1] // 2
                    out[di+2] = wpx[si+2] // 2
                    out[di+3] = 255
                else:
                    out[di:di+4] = wpx[si:si+4]

        write_png(diff_path, out_w, out_h, out)
        print(f"Diff image: {diff_path}")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    mask_hud = 0
    args = list(sys.argv[1:])
    if '--mask-hud' in args:
        idx = args.index('--mask-hud')
        mask_hud = int(args[idx + 1])
        del args[idx:idx+2]
    compare(args[0], args[1], args[2] if len(args) > 2 else None, mask_hud=mask_hud)
