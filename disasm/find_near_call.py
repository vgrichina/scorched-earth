#!/usr/bin/env python3
"""Find near calls to a specific offset within a code segment."""
import struct

# find_mtn_file at 2B3B:1706 (file 0x334B6)
# Near call from within segment 2B3B: E8 + rel16 where rel16 = target_off - (call_off+3)
# Or: FF xx pattern (indirect call, harder to trace)
# Or: push cs; call near_offset (0x0E E8 xx xx)
# The function at 0x334B6 is at seg offset 0x1706 within 2B3B

TARGET_OFF = 0x1706
SEG_BASE = 0x31DB0  # 2B3B * 16 + 0x6A00 = segment file base

with open('earth/SCORCH.EXE', 'rb') as f:
    data = f.read()

# Search for all E8 (CALL near) instructions that target 0x1706
found = []
for i in range(SEG_BASE, SEG_BASE + 0x4000):  # search within play.cpp range
    if data[i] == 0xE8:  # CALL near
        rel = struct.unpack_from('<h', data, i+1)[0]  # signed relative offset
        target_off = (i - SEG_BASE + 3 + rel) & 0xFFFF
        if target_off == TARGET_OFF:
            found.append(i)
            print(f"Near call to find_mtn_file at file 0x{i:05X} (seg off 0x{i-SEG_BASE:04X})")

# Also search for push cs + call pattern (0x0E E8 xx xx)
for i in range(SEG_BASE, SEG_BASE + 0x4000):
    if data[i] == 0x0E and data[i+1] == 0xE8:  # push cs; call near
        rel = struct.unpack_from('<h', data, i+2)[0]
        target_off = (i - SEG_BASE + 4 + rel) & 0xFFFF
        if target_off == TARGET_OFF:
            found.append(i)
            print(f"PUSH CS; near call to find_mtn_file at file 0x{i:05X} (seg off 0x{i-SEG_BASE:04X})")

print(f"\nTotal callers found: {len(found)}")
