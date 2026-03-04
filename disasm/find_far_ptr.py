#!/usr/bin/env python3
"""Search for a far pointer (seg:off) stored in SCORCH.EXE."""
import sys

data = open('earth/SCORCH.EXE', 'rb').read()
seg = int(sys.argv[1], 16)
off = int(sys.argv[2], 16)
needle = bytes([off & 0xFF, (off >> 8) & 0xFF, seg & 0xFF, (seg >> 8) & 0xFF])
pos = 0
count = 0
while True:
    pos = data.find(needle, pos)
    if pos == -1:
        break
    print(f'  File 0x{pos:05X}: far ptr {seg:04X}:{off:04X}')
    pos += 1
    count += 1
print(f'--- {count} match(es) ---')
