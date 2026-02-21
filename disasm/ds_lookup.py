#!/usr/bin/env python3
"""
DS offset ↔ file offset converter for Scorched Earth v1.50.

Converts between DS-relative offsets (e.g. DS:0x2B04) and file offsets,
and optionally dumps raw bytes or interprets data at that location.

Usage:
    python3 ds_lookup.py <exe_path> <offset> [options]

    Offset formats:
        DS:0x1234   — DS-relative offset → shows file offset + data
        0x58884     — file offset → shows DS-relative offset + data
        ds:1234     — case-insensitive

    Options:
        -n N        — dump N bytes (default: 16)
        -s          — interpret as null-terminated string
        -w          — interpret as 16-bit words
        -d          — interpret as 32-bit dwords (far pointers)
        -f32        — interpret as float32
        -f64        — interpret as float64

Examples:
    python3 ds_lookup.py earth/SCORCH.EXE DS:0x2B04 -s
    python3 ds_lookup.py earth/SCORCH.EXE 0x058884 -s
    python3 ds_lookup.py earth/SCORCH.EXE DS:0xEF22 -w -n 32
    python3 ds_lookup.py earth/SCORCH.EXE DS:0x11F6 -d -n 8
"""

import sys
import struct

# Scorched Earth v1.50 binary layout
MZ_HEADER_SIZE = 0x6A00
DS_SEGMENT = 0x4F38
DS_FILE_BASE = 0x055D80  # DS:0x0000 in file


def ds_to_file(ds_offset):
    """Convert DS:offset to file offset."""
    return DS_FILE_BASE + ds_offset


def file_to_ds(file_offset):
    """Convert file offset to DS:offset (returns None if outside DS)."""
    ds_off = file_offset - DS_FILE_BASE
    if 0 <= ds_off < 0x10000:
        return ds_off
    return None


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    offset_str = sys.argv[2]
    args = sys.argv[3:]

    # Parse options
    num_bytes = 16
    mode = 'hex'
    i = 0
    while i < len(args):
        if args[i] == '-n' and i + 1 < len(args):
            num_bytes = int(args[i + 1])
            i += 2
        elif args[i] == '-s':
            mode = 'string'
            i += 1
        elif args[i] == '-w':
            mode = 'words'
            i += 1
        elif args[i] == '-d':
            mode = 'dwords'
            i += 1
        elif args[i] == '-f32':
            mode = 'f32'
            i += 1
        elif args[i] == '-f64':
            mode = 'f64'
            i += 1
        else:
            print(f"Unknown option: {args[i]}")
            sys.exit(1)

    # Parse offset
    offset_str_lower = offset_str.lower()
    if offset_str_lower.startswith('ds:'):
        ds_off = int(offset_str[3:], 16)
        file_off = ds_to_file(ds_off)
        print(f"DS:0x{ds_off:04X} → file 0x{file_off:05X}")
    else:
        file_off = int(offset_str, 16)
        ds_off = file_to_ds(file_off)
        if ds_off is not None:
            print(f"file 0x{file_off:05X} → DS:0x{ds_off:04X}")
        else:
            print(f"file 0x{file_off:05X} (outside DS segment)")

    # Read data
    with open(exe_path, 'rb') as f:
        f.seek(file_off)
        data = f.read(max(num_bytes, 256) if mode == 'string' else num_bytes)

    if not data:
        print("(no data at offset)")
        return

    if mode == 'string':
        # Find null terminator
        end = data.find(b'\x00')
        if end == -1:
            end = len(data)
        s = data[:end]
        try:
            text = s.decode('cp437')
        except Exception:
            text = s.decode('latin-1')
        print(f'String: "{text}"')
        print(f'Length: {len(s)} bytes')
        print(f'Hex: {s.hex(" ")}')
    elif mode == 'words':
        count = num_bytes // 2
        for j in range(count):
            if j * 2 + 2 > len(data):
                break
            val = struct.unpack_from('<H', data, j * 2)[0]
            off = file_off + j * 2
            ds = file_to_ds(off)
            ds_str = f"DS:0x{ds:04X}" if ds is not None else f"file 0x{off:05X}"
            print(f"  [{ds_str}] = 0x{val:04X} ({val})")
    elif mode == 'dwords':
        count = num_bytes // 4
        for j in range(count):
            if j * 4 + 4 > len(data):
                break
            lo, hi = struct.unpack_from('<HH', data, j * 4)
            off = file_off + j * 4
            ds = file_to_ds(off)
            ds_str = f"DS:0x{ds:04X}" if ds is not None else f"file 0x{off:05X}"
            print(f"  [{ds_str}] = {hi:04X}:{lo:04X}")
    elif mode == 'f32':
        count = num_bytes // 4
        for j in range(count):
            if j * 4 + 4 > len(data):
                break
            val = struct.unpack_from('<f', data, j * 4)[0]
            off = file_off + j * 4
            ds = file_to_ds(off)
            ds_str = f"DS:0x{ds:04X}" if ds is not None else f"file 0x{off:05X}"
            print(f"  [{ds_str}] = {val}")
    elif mode == 'f64':
        count = num_bytes // 8
        for j in range(count):
            if j * 8 + 8 > len(data):
                break
            val = struct.unpack_from('<d', data, j * 8)[0]
            off = file_off + j * 8
            ds = file_to_ds(off)
            ds_str = f"DS:0x{ds:04X}" if ds is not None else f"file 0x{off:05X}"
            print(f"  [{ds_str}] = {val}")
    else:
        # Hex dump
        for j in range(0, len(data), 16):
            chunk = data[j:j + 16]
            off = file_off + j
            hex_str = ' '.join(f'{b:02X}' for b in chunk)
            ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
            print(f"  {off:05X}: {hex_str:<48s} {ascii_str}")


if __name__ == '__main__':
    main()
