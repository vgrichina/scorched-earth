#!/usr/bin/env python3
"""Decode float32/float64 values from EXE at given DS or file offsets.

Usage:
    python3 decode_float64.py <exe> <addr> [addr ...] [-f32] [-f64] [-n N]

    addr formats:
        DS:0x1234   — DS-relative offset
        0x57AB4     — file offset

    Options:
        -f32        — decode as 32-bit floats (4 bytes each)
        -f64        — decode as 64-bit doubles (8 bytes each, default)
        -n N        — decode N consecutive values starting at addr

    Note: ds_lookup.py also supports -f32/-f64 with identical semantics.

Examples:
    python3 disasm/decode_float64.py earth/SCORCH.EXE DS:0x613C DS:0x6144
    python3 disasm/decode_float64.py earth/SCORCH.EXE DS:0x50D0 -f32
    python3 disasm/decode_float64.py earth/SCORCH.EXE DS:0x5250 -f32 -n 4
    python3 disasm/decode_float64.py earth/SCORCH.EXE 0x57AB4
"""
import sys
import struct

DS_FILE_BASE = 0x055D80  # DS:0 → file 0x055D80

def decode_addr(arg):
    if arg.upper().startswith('DS:'):
        ds_off = int(arg[3:], 16)
        return ds_off, DS_FILE_BASE + ds_off
    else:
        file_off = int(arg, 16)
        return file_off - DS_FILE_BASE, file_off

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    exe_path = args[0]
    args = args[1:]

    fmt = 'f64'
    count = 1
    addrs = []

    i = 0
    while i < len(args):
        a = args[i]
        if a == '-f32':
            fmt = 'f32'
        elif a == '-f64':
            fmt = 'f64'
        elif a == '-n':
            i += 1
            count = int(args[i])
        else:
            addrs.append(a)
        i += 1

    size = 4 if fmt == 'f32' else 8
    pack_fmt = '<f' if fmt == 'f32' else '<d'

    exe = open(exe_path, 'rb').read()

    for addr_str in addrs:
        ds_off, file_off = decode_addr(addr_str)
        for j in range(count):
            off = file_off + j * size
            ds = ds_off + j * size
            raw = exe[off:off + size]
            val = struct.unpack(pack_fmt, raw)[0]
            print(f"DS:0x{ds:04X} (file 0x{off:05X}): {val} (raw: {raw.hex()})")

if __name__ == '__main__':
    main()
