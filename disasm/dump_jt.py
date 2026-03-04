#!/usr/bin/env python3
"""Dump jump table at CS:0x05DB (file 0x267CB) for play.cpp action dispatcher."""
import struct
import sys

EXE = 'earth/SCORCH.EXE'
TABLE_FILE_OFF = 0x267CB
CS = 0x1F7F
HEADER = 0x6A00

with open(EXE, 'rb') as f:
    f.seek(TABLE_FILE_OFF)
    data = f.read(160)  # 80 * 2 bytes

for i in range(80):
    val = struct.unpack_from('<H', data, i*2)[0]
    file_off = CS * 16 + val + HEADER
    action = i + 2  # action = index + 2
    print(f"  action={action:3d} [{i:3d}] near_off={val:#06x} → file {file_off:#07x}")
