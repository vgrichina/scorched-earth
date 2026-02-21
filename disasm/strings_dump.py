#!/usr/bin/env python3
"""
Dump strings from the Scorched Earth v1.50 data segment.

Scans the DS region for printable ASCII/CP437 strings and reports their
DS offset, file offset, and content. Useful for finding UI labels, format
strings, error messages, and debug strings.

Usage:
    python3 strings_dump.py <exe_path> [options]

    Options:
        -m N        — minimum string length (default: 4)
        -g PATTERN  — grep: only show strings matching pattern (case-insensitive)
        -r START END — restrict scan to DS:START..DS:END (hex)
        --all       — scan entire file, not just DS segment

Examples:
    python3 strings_dump.py earth/SCORCH.EXE -g "wind"
    python3 strings_dump.py earth/SCORCH.EXE -g "~" -m 2
    python3 strings_dump.py earth/SCORCH.EXE -r 0x2000 0x3000
    python3 strings_dump.py earth/SCORCH.EXE -g "%s" -m 2
"""

import sys
import re

DS_FILE_BASE = 0x055D80
DS_SIZE = 0x10000  # 64KB segment


def is_printable_cp437(b):
    """Check if byte is printable in CP437 (ASCII 0x20-0x7E + extended 0x80-0xFE)."""
    return 0x20 <= b <= 0x7E


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    args = sys.argv[2:]

    min_len = 4
    grep_pat = None
    range_start = 0
    range_end = DS_SIZE
    scan_all = False

    i = 0
    while i < len(args):
        if args[i] == '-m' and i + 1 < len(args):
            min_len = int(args[i + 1])
            i += 2
        elif args[i] == '-g' and i + 1 < len(args):
            grep_pat = args[i + 1].lower()
            i += 2
        elif args[i] == '-r' and i + 2 < len(args):
            range_start = int(args[i + 1], 16)
            range_end = int(args[i + 2], 16)
            i += 3
        elif args[i] == '--all':
            scan_all = True
            i += 1
        else:
            print(f"Unknown option: {args[i]}")
            sys.exit(1)

    with open(exe_path, 'rb') as f:
        if scan_all:
            data = f.read()
            base_offset = 0
        else:
            f.seek(DS_FILE_BASE + range_start)
            length = range_end - range_start
            data = f.read(length)
            base_offset = DS_FILE_BASE + range_start

    # Scan for strings
    current = []
    start_pos = 0
    count = 0

    for pos in range(len(data)):
        b = data[pos]
        if is_printable_cp437(b):
            if not current:
                start_pos = pos
            current.append(b)
        else:
            if len(current) >= min_len and b == 0:  # null-terminated
                text = bytes(current).decode('cp437', errors='replace')
                file_off = base_offset + start_pos
                ds_off = file_off - DS_FILE_BASE

                if grep_pat is None or grep_pat in text.lower():
                    if 0 <= ds_off < DS_SIZE and not scan_all:
                        print(f"DS:0x{ds_off:04X}  file 0x{file_off:05X}  [{len(current):3d}]  \"{text}\"")
                    else:
                        print(f"file 0x{file_off:05X}  [{len(current):3d}]  \"{text}\"")
                    count += 1
            current = []

    # Handle string at end of buffer
    if len(current) >= min_len:
        text = bytes(current).decode('cp437', errors='replace')
        file_off = base_offset + start_pos
        ds_off = file_off - DS_FILE_BASE
        if grep_pat is None or grep_pat in text.lower():
            if 0 <= ds_off < DS_SIZE and not scan_all:
                print(f"DS:0x{ds_off:04X}  file 0x{file_off:05X}  [{len(current):3d}]  \"{text}\"")
            else:
                print(f"file 0x{file_off:05X}  [{len(current):3d}]  \"{text}\"")
            count += 1

    print(f"\n--- {count} strings found ---")


if __name__ == '__main__':
    main()
