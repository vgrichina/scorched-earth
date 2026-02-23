#!/usr/bin/env python3
"""Search for far call/jump references to a given segment value in EXE code."""
import struct
import sys

exe_path = sys.argv[1] if len(sys.argv) > 1 else 'earth/SCORCH.EXE'
target_seg = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x1F3E
offset_filter = int(sys.argv[3], 16) if len(sys.argv) > 3 else None

HEADER = 0x6A00
seg_lo = target_seg & 0xFF
seg_hi = (target_seg >> 8) & 0xFF

with open(exe_path, 'rb') as f:
    data = f.read()

code_start = HEADER
code_end = len(data)

print(f"Searching for segment 0x{target_seg:04X} (bytes {seg_hi:02X} {seg_lo:02X}) in code region...")
matches = []
i = code_start
while i < code_end - 3:
    # Look for the segment bytes in little-endian word
    if data[i] == seg_lo and data[i+1] == seg_hi:
        # The 2 bytes before might be the offset (for a far call/jmp which is 5 bytes: opcode + 4 bytes addr)
        # far call is: 9A [off_lo] [off_hi] [seg_lo] [seg_hi]
        if i >= 3 and data[i-3] == 0x9A:  # call far
            off = struct.unpack_from('<H', data, i-2)[0]
            if offset_filter is None or off == offset_filter:
                print(f"  call far 0x{target_seg:04X}:{off:04X} at file 0x{i-3:X}")
                matches.append(i-3)
        elif i >= 2 and data[i-2] == 0xEA:  # jmp far
            off = struct.unpack_from('<H', data, i-1)[0]
            if offset_filter is None or off == offset_filter:
                print(f"  jmp far 0x{target_seg:04X}:{off:04X} at file 0x{i-2:X}")
                matches.append(i-2)
    i += 1

print(f"\n{len(matches)} references found")
