#!/usr/bin/env python3
"""
search_bytes.py — Byte-pattern search across Scorched Earth v1.50 EXE.

Usage:
    python3 disasm/search_bytes.py <hex_pattern> [--context N] [--disasm [lines]]

    hex_pattern  — hex bytes to find, e.g. "8B 46 FC" or "8B46FC"
    --context N  — show N raw bytes before/after each match (default 4)
    --disasm     — invoke dis.py at each match location
    lines        — number of instructions to disassemble (default 8, only with --disasm)

Examples:
    python3 disasm/search_bytes.py "8B 46 FC"
    python3 disasm/search_bytes.py CD34 --context 8 --disasm
    python3 disasm/search_bytes.py "FF 1E" --disasm 12
"""

import sys
import os
import subprocess
import struct

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
ROOT         = os.path.dirname(SCRIPT_DIR)
EXE_PATH     = os.path.join(ROOT, 'earth', 'SCORCH.EXE')

MZ_HEADER    = 0x6A00
DS_FILE_BASE = 0x055D80

MODULES = [
    (0x20EA0, 0x263F0, 0x1A4A, 'extras.cpp'),
    (0x263F0, 0x2F830, 0x1F7F, 'icons.cpp'),
    (0x2F830, 0x31FB0, 0x28B9, 'play.cpp'),
    (0x31FB0, 0x33690, 0x2B3B, 'player.cpp'),
    (0x33690, 0x38070, 0x2CBF, 'ranges.cpp'),
    (0x38070, 0x38780, 0x3167, 'shark.cpp'),
    (0x38780, 0x3B8D0, 0x31D8, 'shields.cpp'),
    (0x3B8D0, 0x4C290, 0x34ED, 'menu+dialogs'),
    (0x4C290, 0x4D000, 0x4589, 'font module'),
]


def file_to_segoff(file_off):
    for start, end, seg, name in MODULES:
        if start <= file_off < end:
            off = (file_off - MZ_HEADER) - (seg * 16)
            return seg, off, name
    code_off = file_off - MZ_HEADER
    if code_off >= 0:
        return code_off >> 4, code_off & 0xF, '?'
    return 0, file_off, 'data'


def file_to_ds(file_off):
    v = file_off - DS_FILE_BASE
    return v if 0 <= v < 0x10000 else None


def main():
    args = sys.argv[1:]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)

    pattern_str = args[0].replace(' ', '')
    try:
        pattern = bytes.fromhex(pattern_str)
    except ValueError:
        print(f"Invalid hex pattern: {args[0]!r}")
        sys.exit(1)

    context   = 4
    do_disasm = False
    disasm_n  = 8
    i = 1
    while i < len(args):
        if args[i] == '--context' and i + 1 < len(args):
            context = int(args[i + 1]); i += 2
        elif args[i] == '--disasm':
            do_disasm = True
            if i + 1 < len(args) and args[i + 1].isdigit():
                disasm_n = int(args[i + 1]); i += 2
            else:
                i += 1
        else:
            i += 1

    with open(EXE_PATH, 'rb') as f:
        exe = f.read()

    matches = []
    pos = 0
    while True:
        idx = exe.find(pattern, pos)
        if idx == -1:
            break
        matches.append(idx)
        pos = idx + 1

    print(f"Pattern: {pattern.hex().upper()}  ({len(pattern)} bytes)")
    print(f"Found {len(matches)} match(es)")
    print()

    for off in matches:
        seg, segoff, module = file_to_segoff(off)
        ds_rel = file_to_ds(off)
        ds_str = f'  DS:0x{ds_rel:04X}' if ds_rel is not None else ''
        print(f"  0x{off:05X}  {seg:04X}:{segoff:04X}{ds_str}  ({module})")

        # Context bytes with match highlighted in [brackets]
        start = max(0, off - context)
        end   = min(len(exe), off + len(pattern) + context)
        region = exe[start:end]
        hex_parts = []
        for j, b in enumerate(region):
            abs_off = start + j
            if off <= abs_off < off + len(pattern):
                hex_parts.append(f'[{b:02X}]')
            else:
                hex_parts.append(f' {b:02X} ')
        print(f"    {''.join(hex_parts)}")

        if do_disasm:
            result = subprocess.run(
                [sys.executable, os.path.join(SCRIPT_DIR, 'dis.py'),
                 f'0x{off:05X}', str(disasm_n)],
                capture_output=True, text=True
            )
            for line in result.stdout.splitlines():
                print('    ' + line)

        print()


if __name__ == '__main__':
    main()
