#!/usr/bin/env python3
"""Compare EXE icon bitmaps against web/js/hud.js ICONS array."""
import struct, re, sys

EXE = 'earth/SCORCH.EXE'
ICON_BASE_DS = 0x3826  # DS offset of icon table
DS_FILE_BASE = 0x055D80  # DS segment file base
ICON_STRIDE = 125
NUM_ICONS = 48

with open(EXE, 'rb') as f:
    exe_data = f.read()

# Read icons from EXE binary directly
exe_icons = []
for i in range(NUM_ICONS):
    file_off = DS_FILE_BASE + ICON_BASE_DS + i * ICON_STRIDE
    block = exe_data[file_off:file_off + ICON_STRIDE]
    # First 3 bytes: type, width, height
    t, w, h = block[0], block[1], block[2]
    # Pixel data: column-major, 1 byte per pixel (0 or nonzero)
    px = []
    if w > 0 and h > 0:
        for col in range(w):
            for row in range(h):
                idx = 3 + col * h + row
                px.append(1 if block[idx] else 0)
    exe_icons.append({'t': t, 'w': w, 'h': h, 'px': px})

# Parse web ICONS from hud.js
with open('web/js/hud.js') as f:
    text = f.read()
m = re.search(r'const ICONS = \[(.*?)\];', text, re.DOTALL)
icons_text = m.group(1)
web_icons = []
for m in re.finditer(r'\{t:(\d+),w:(\d+),h:(\d+),px:\[([^\]]*)\]\}', icons_text):
    t, w, h = int(m.group(1)), int(m.group(2)), int(m.group(3))
    px_str = m.group(4).strip()
    px = [int(x) for x in px_str.split(',')] if px_str else []
    web_icons.append({'t': t, 'w': w, 'h': h, 'px': px})

# Compare
mismatches = 0
for i in range(min(len(exe_icons), len(web_icons))):
    e, w = exe_icons[i], web_icons[i]
    if e['t'] != w['t'] or e['w'] != w['w'] or e['h'] != w['h']:
        print(f"Icon {i:2d}: DIMENSION MISMATCH  EXE t={e['t']} {e['w']}x{e['h']}  Web t={w['t']} {w['w']}x{w['h']}")
        mismatches += 1
        continue
    if e['px'] != w['px']:
        print(f"Icon {i:2d}: PIXEL MISMATCH  {e['w']}x{e['h']}px")
        for col in range(e['w']):
            for row in range(e['h']):
                idx = col * e['h'] + row
                ep = e['px'][idx] if idx < len(e['px']) else 0
                wp = w['px'][idx] if idx < len(w['px']) else 0
                if ep != wp:
                    print(f"  col={col} row={row}: EXE={ep} Web={wp}")
        mismatches += 1

if mismatches == 0:
    print(f"All {len(web_icons)} icons match perfectly!")
else:
    print(f"\n{mismatches} icon(s) differ out of {len(web_icons)}")
