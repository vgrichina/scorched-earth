#!/usr/bin/env python3
"""Compare web ICONS array against EXE icon data at DS:0x3826."""

import json, re, sys

data = open('earth/SCORCH.EXE', 'rb').read()

# Read web ICONS from hud.js
with open('web/js/hud.js') as f:
    hud = f.read()

# Extract ICONS array
m = re.search(r'const ICONS = \[(.*?)\];', hud, re.DOTALL)
if not m:
    print("ERROR: Could not find ICONS array in hud.js")
    sys.exit(1)

# Parse each icon object
icon_text = m.group(1)
web_icons = []
for im in re.finditer(r'\{t:(\d+),w:(\d+),h:(\d+),px:\[(.*?)\]\}', icon_text):
    t, w, h = int(im.group(1)), int(im.group(2)), int(im.group(3))
    px_str = im.group(4).strip()
    px = [int(x) for x in px_str.split(',')] if px_str else []
    web_icons.append({'t': t, 'w': w, 'h': h, 'px': px})

print(f"Web icons: {len(web_icons)}")

# Compare against EXE
ICON_FILE_BASE = 0x595A6
STRIDE = 125
diffs = 0

for i in range(min(len(web_icons), 48)):
    off = ICON_FILE_BASE + i * STRIDE
    exe_t = data[off]
    exe_w = data[off + 1]
    exe_h = data[off + 2]
    n_px = exe_w * exe_h
    exe_px = [1 if data[off + 3 + j] else 0 for j in range(n_px)]

    wi = web_icons[i]

    if wi['t'] != exe_t or wi['w'] != exe_w or wi['h'] != exe_h:
        print(f"Icon {i:2d}: STRUCT MISMATCH — EXE t={exe_t} w={exe_w} h={exe_h}, web t={wi['t']} w={wi['w']} h={wi['h']}")
        diffs += 1
        continue

    if wi['w'] == 0:
        continue  # blank icon

    if len(wi['px']) != n_px:
        print(f"Icon {i:2d}: LENGTH MISMATCH — EXE {n_px} px, web {len(wi['px'])} px")
        diffs += 1
        continue

    px_diffs = []
    for j in range(n_px):
        if wi['px'][j] != exe_px[j]:
            col = j // exe_h
            row = j % exe_h
            px_diffs.append(f"  px[{j}] col={col},row={row}: web={wi['px'][j]} exe={exe_px[j]} (raw=0x{data[off+3+j]:02X})")

    if px_diffs:
        print(f"Icon {i:2d}: {len(px_diffs)} pixel diff(s) (t={exe_t} {exe_w}x{exe_h})")
        for d in px_diffs:
            print(d)
        diffs += 1

if diffs == 0:
    print("All icons match!")
else:
    print(f"\n{diffs} icon(s) with differences")
