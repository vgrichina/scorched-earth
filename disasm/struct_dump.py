#!/usr/bin/env python3
"""
Dump structured data arrays from Scorched Earth v1.50 EXE.

Reads arrays of fixed-size structs from the binary and displays fields
in a readable table format. Pre-configured for known struct types.

Usage:
    python3 struct_dump.py <exe_path> <struct_type> [index] [options]

    Struct types:
        weapon      — weapon table at DS:0x11F6, stride 0x34 (52 bytes)
        player      — player struct array, stride 0x6C (108 bytes), base DS:CEB8 (far ptrs)
        tank        — tank/sub struct array, stride 0xCA (202 bytes), base DS:D568
        glyph       — font glyph pointer table at DS:[(char*4)-0xCA6]
        mode        — graphics mode table at DS:0x6234

    Options:
        -n N        — number of entries to dump (default: all or 10)
        -r          — dump raw hex of each entry
        -f FIELD    — show only specific field(s), comma-separated

Examples:
    python3 struct_dump.py earth/SCORCH.EXE weapon 5        # weapon index 5
    python3 struct_dump.py earth/SCORCH.EXE weapon -n 60    # first 60 weapons
    python3 struct_dump.py earth/SCORCH.EXE glyph 65        # glyph for 'A'
    python3 struct_dump.py earth/SCORCH.EXE mode -n 9       # all 9 graphics modes
"""

import sys
import struct as st

DS_FILE_BASE = 0x055D80
MZ_HEADER = 0x6A00


def ds_to_file(ds_off):
    return DS_FILE_BASE + ds_off


def read_u16(data, off):
    return st.unpack_from('<H', data, off)[0]


def read_u32(data, off):
    return st.unpack_from('<I', data, off)[0]


def read_i16(data, off):
    return st.unpack_from('<h', data, off)[0]


def read_string_at(data, file_off, max_len=64):
    """Read null-terminated string at file offset."""
    end = min(file_off + max_len, len(data))
    s = []
    for i in range(file_off, end):
        if data[i] == 0:
            break
        s.append(data[i])
    return bytes(s).decode('cp437', errors='replace')


def dump_weapon(data, index, count, raw, fields):
    """Dump weapon struct entries."""
    base_ds = 0x11F6
    stride = 0x34  # 52 bytes
    total = 60  # approximate weapon count

    if index is not None:
        start, end = index, index + 1
    else:
        start, end = 0, min(count or total, total)

    print(f"{'Idx':>3}  {'Name':<24s}  {'Price':>6}  {'Bndl':>4}  {'Arms':>4}  {'Radius':>6}  {'Damage':>6}  {'Cat':>3}  DS Offset")
    print("-" * 95)

    for i in range(start, end):
        ds_off = base_ds + i * stride
        file_off = ds_to_file(ds_off)
        if file_off + stride > len(data):
            break

        # Read fields from weapon struct
        # +0x00/+0x02: far ptr to name string
        name_off = read_u16(data, file_off + 0x00)
        name_seg = read_u16(data, file_off + 0x02)
        # Name pointer: if segment == DS (0x4F38), resolve directly
        if name_seg == 0x4F38:
            name = read_string_at(data, ds_to_file(name_off))
        else:
            name = f"({name_seg:04X}:{name_off:04X})"

        price = read_u16(data, file_off + 0x04)
        bundle = read_u16(data, file_off + 0x06)
        arms = read_u16(data, file_off + 0x08)
        radius = read_i16(data, file_off + 0x0A)
        damage = read_i16(data, file_off + 0x0C)
        category = read_u16(data, file_off + 0x20)

        print(f"{i:3d}  {name:<24s}  {price:6d}  {bundle:4d}  {arms:4d}  {radius:6d}  {damage:6d}  {category:3d}  DS:0x{ds_off:04X}")

        if raw:
            chunk = data[file_off:file_off + stride]
            hex_str = ' '.join(f'{b:02X}' for b in chunk)
            print(f"     RAW: {hex_str}")


def dump_glyph(data, index, count, raw, fields):
    """Dump font glyph pointer table entries."""
    if index is not None:
        start, end = index, index + 1
    else:
        start, end = 32, min(32 + (count or 95), 127)

    print(f"{'Char':>4}  {'Code':>4}  {'Width':>5}  {'DS Ptr':>10}  {'Data Loc':>10}  Glyph")
    print("-" * 65)

    for ch in range(start, end):
        # Pointer at DS:[(ch*4) - 0xCA6], wraps 16-bit
        ptr_ds = (ch * 4 - 0xCA6) & 0xFFFF
        ptr_file = ds_to_file(ptr_ds)
        if ptr_file + 4 > len(data):
            continue

        glyph_off = read_u16(data, ptr_file)
        glyph_seg = read_u16(data, ptr_file + 2)

        if glyph_seg == 0x4F38:  # DS segment
            glyph_file = ds_to_file(glyph_off)
            if glyph_file < len(data):
                width = data[glyph_file]
                # Show first few bytes of glyph data
                preview = data[glyph_file:glyph_file + min(1 + width * 12, 20)]
                hex_preview = ' '.join(f'{b:02X}' for b in preview[:13])
            else:
                width = '?'
                hex_preview = ''
        else:
            width = '?'
            hex_preview = f"seg {glyph_seg:04X}"
            glyph_off_str = f"{glyph_seg:04X}:{glyph_off:04X}"

        ch_repr = chr(ch) if 32 <= ch < 127 else f'x{ch:02X}'
        print(f" '{ch_repr}'  0x{ch:02X}  {width:>5}  DS:0x{ptr_ds:04X}  DS:0x{glyph_off:04X}  {hex_preview}")


def dump_mode(data, index, count, raw, fields):
    """Dump graphics mode table."""
    base_ds = 0x6234
    stride = 0x10  # 16 bytes per mode entry (estimated)
    total = 9

    if index is not None:
        start, end = index, index + 1
    else:
        start, end = 0, min(count or total, total)

    print(f"{'Idx':>3}  {'Width':>5}  {'Height':>6}  {'Aspect':>6}  {'ModeID':>6}  DS Offset")
    print("-" * 50)

    for i in range(start, end):
        ds_off = base_ds + i * stride
        file_off = ds_to_file(ds_off)
        if file_off + stride > len(data):
            break

        width = read_u16(data, file_off + 0x00)
        height = read_u16(data, file_off + 0x02)
        mode_id = read_u16(data, file_off + 0x04)
        aspect = read_u16(data, file_off + 0x0A)

        print(f"{i:3d}  {width:5d}  {height:6d}  {aspect:6d}  0x{mode_id:04X}  DS:0x{ds_off:04X}")

        if raw:
            chunk = data[file_off:file_off + stride]
            print(f"     RAW: {' '.join(f'{b:02X}' for b in chunk)}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    struct_type = sys.argv[2].lower()
    args = sys.argv[3:]

    index = None
    count = None
    raw = False
    fields = None

    i = 0
    while i < len(args):
        if args[i] == '-n' and i + 1 < len(args):
            count = int(args[i + 1])
            i += 2
        elif args[i] == '-r':
            raw = True
            i += 1
        elif args[i] == '-f' and i + 1 < len(args):
            fields = args[i + 1].split(',')
            i += 2
        elif args[i].isdigit() or (args[i].startswith('0x') and len(args[i]) > 2):
            index = int(args[i], 0)
            i += 1
        else:
            print(f"Unknown option: {args[i]}")
            sys.exit(1)

    with open(exe_path, 'rb') as f:
        data = f.read()

    dispatch = {
        'weapon': dump_weapon,
        'glyph': dump_glyph,
        'mode': dump_mode,
    }

    fn = dispatch.get(struct_type)
    if fn is None:
        print(f"Unknown struct type: {struct_type}")
        print(f"Available: {', '.join(dispatch.keys())}")
        sys.exit(1)

    fn(data, index, count, raw, fields)


if __name__ == '__main__':
    main()
