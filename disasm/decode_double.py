#!/usr/bin/env python3
"""Decode IEEE 754 doubles/floats from file offsets."""
import struct
import sys

exe = sys.argv[1] if len(sys.argv) > 1 else 'earth/SCORCH.EXE'

# Decode multiple offsets if provided
offsets = sys.argv[2:] if len(sys.argv) > 2 else ['0x5BFD8']

for arg in offsets:
    offset = int(arg, 16)
    with open(exe, 'rb') as f:
        f.seek(offset)
        d8 = f.read(8)
        f.seek(offset)
        d4 = f.read(4)
    val64 = struct.unpack('<d', d8)[0]
    val32 = struct.unpack('<f', d4)[0]
    print(f'0x{offset:X}: float={val32:.6g}, double={val64:.6g}  (bytes: {d8.hex()})')
