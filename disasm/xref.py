#!/usr/bin/env python3
"""
Cross-reference finder for Scorched Earth v1.50 EXE.

Scans code regions for references to a given DS offset, far pointer,
or immediate value. Finds MOV, CMP, PUSH, LEA, and other instructions
that reference the target value.

Usage:
    python3 xref.py <exe_path> <target> [options]

    Target formats:
        DS:0x1234   — find references to DS offset 0x1234
        0x1234      — find references to immediate value 0x1234
        far:SEG:OFF — find far call/jmp to SEG:OFF

    Options:
        -r START END — restrict scan to file range (default: 0x6A00..end)
        --code       — only scan known code segments (faster)
        -c N         — show N bytes of context around each hit (default: 0)

Examples:
    python3 xref.py earth/SCORCH.EXE DS:0xED58       # who reads/writes font selector?
    python3 xref.py earth/SCORCH.EXE DS:0xEF22       # who uses highlight color?
    python3 xref.py earth/SCORCH.EXE 0x7E             # who checks for ~ (0x7E)?
    python3 xref.py earth/SCORCH.EXE DS:0x518E        # who uses HUD Y position?
"""

import sys
import struct

DS_FILE_BASE = 0x055D80
MZ_HEADER = 0x6A00

# Known code segment file ranges (from CLAUDE.md source file segments)
CODE_SEGMENTS = [
    (0x20EA0, 0x263F0, "extras.cpp"),
    (0x263F0, 0x31FB0, "icons.cpp+"),
    (0x2F830, 0x33690, "play.cpp"),
    (0x33690, 0x38070, "ranges.cpp"),
    (0x38070, 0x38780, "shark.cpp"),
    (0x38780, 0x3B8D0, "shields.cpp+"),
    (0x3B8D0, 0x45B90, "menu module"),
    (0x45B90, 0x4C290, "dialog system"),
    (0x4C290, 0x4D000, "font/text module"),
]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    target_str = sys.argv[2]
    args = sys.argv[3:]

    scan_start = MZ_HEADER
    scan_end = None
    code_only = False
    context = 0

    i = 0
    while i < len(args):
        if args[i] == '-r' and i + 2 < len(args):
            scan_start = int(args[i + 1], 16)
            scan_end = int(args[i + 2], 16)
            i += 3
        elif args[i] == '--code':
            code_only = True
            i += 1
        elif args[i] == '-c' and i + 1 < len(args):
            context = int(args[i + 1])
            i += 2
        else:
            print(f"Unknown option: {args[i]}")
            sys.exit(1)

    # Parse target
    target_str_lower = target_str.lower()
    if target_str_lower.startswith('ds:'):
        ds_off = int(target_str[3:], 16)
        # Search for the 16-bit DS offset value in little-endian
        needle = struct.pack('<H', ds_off)
        desc = f"DS:0x{ds_off:04X}"
    elif target_str_lower.startswith('far:'):
        parts = target_str[4:].split(':')
        seg = int(parts[0], 16)
        off = int(parts[1], 16)
        needle = struct.pack('<HH', off, seg)
        desc = f"far {seg:04X}:{off:04X}"
    else:
        val = int(target_str, 0)
        if val <= 0xFF:
            needle = bytes([val])
            desc = f"byte 0x{val:02X}"
        elif val <= 0xFFFF:
            needle = struct.pack('<H', val)
            desc = f"word 0x{val:04X}"
        else:
            needle = struct.pack('<I', val)
            desc = f"dword 0x{val:08X}"

    with open(exe_path, 'rb') as f:
        data = f.read()

    if scan_end is None:
        scan_end = len(data)

    print(f"Searching for {desc} in file 0x{scan_start:05X}..0x{scan_end:05X}")
    print(f"Needle: {' '.join(f'{b:02X}' for b in needle)}")
    print()

    # Build scan ranges
    if code_only:
        ranges = [(s, e, name) for s, e, name in CODE_SEGMENTS
                  if s < scan_end and e > scan_start]
    else:
        ranges = [(scan_start, scan_end, "full scan")]

    hits = 0
    for range_start, range_end, range_name in ranges:
        rs = max(range_start, scan_start)
        re_ = min(range_end, scan_end)

        pos = rs
        while pos < re_:
            idx = data.find(needle, pos, re_)
            if idx == -1:
                break

            # Identify likely instruction context
            # Look at preceding byte(s) for common x86 opcodes
            prefix = ''
            if idx >= 1:
                prev = data[idx - 1]
                prev2 = data[idx - 2] if idx >= 2 else 0
                if prev in (0x8B, 0x89, 0x8E, 0x8C):  # MOV variants
                    prefix = 'MOV'
                elif prev in (0x3B, 0x3D, 0x81, 0x83):  # CMP variants
                    prefix = 'CMP'
                elif prev == 0x68 or (prev & 0xF8) == 0x50:  # PUSH
                    prefix = 'PUSH'
                elif prev in (0xA1, 0xA3):  # MOV AX,[imm16] / MOV [imm16],AX
                    prefix = 'MOV AX,' if prev == 0xA1 else 'MOV ,AX'
                elif prev2 == 0xC7:  # MOV word [mem], imm
                    prefix = 'MOV [mem],'
                elif prev in (0xFF,):
                    prefix = 'CALL/JMP'
                elif prev in (0x01, 0x29, 0x09, 0x21):
                    prefix = 'ADD/SUB/OR/AND'

            # Find segment name
            seg_name = range_name
            if not code_only:
                for s, e, name in CODE_SEGMENTS:
                    if s <= idx < e:
                        seg_name = name
                        break

            ds_at = idx - DS_FILE_BASE
            loc = f"DS:0x{ds_at:04X}" if 0 <= ds_at < 0x10000 else f"file 0x{idx:05X}"
            instr_hint = f"  ({prefix})" if prefix else ""
            print(f"  file 0x{idx:05X}  [{seg_name}]{instr_hint}")

            if context > 0:
                ctx_start = max(0, idx - context)
                ctx_end = min(len(data), idx + len(needle) + context)
                chunk = data[ctx_start:ctx_end]
                hex_str = ' '.join(f'{b:02X}' for b in chunk)
                print(f"    context: {hex_str}")

            hits += 1
            pos = idx + 1

    print(f"\n--- {hits} references found ---")


if __name__ == '__main__':
    main()
