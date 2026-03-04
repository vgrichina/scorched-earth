#!/usr/bin/env python3
"""Find all `call far SEG:OFF` sites in the EXE binary."""
import sys, struct

if len(sys.argv) < 3:
    print(f"Usage: {sys.argv[0]} <exe> <seg:off> [seg:off ...]")
    sys.exit(1)

exe = open(sys.argv[1], 'rb').read()

for arg in sys.argv[2:]:
    seg_str, off_str = arg.split(':')
    seg = int(seg_str, 16)
    off = int(off_str, 16)
    # call far encoding: 9A OFF_LO OFF_HI SEG_LO SEG_HI
    pattern = bytes([0x9A, off & 0xFF, (off >> 8) & 0xFF, seg & 0xFF, (seg >> 8) & 0xFF])
    pos = 0
    results = []
    while True:
        pos = exe.find(pattern, pos)
        if pos < 0:
            break
        results.append(pos)
        pos += 1
    print(f"call far {seg:04X}:{off:04X} — {len(results)} site(s):")
    for r in results:
        print(f"  file {r:#07x}")
