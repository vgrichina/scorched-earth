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

    Caller search (find all call sites targeting a function):
        --callers <file_offset>  — find far+near calls to function at file offset

Examples:
    python3 xref.py earth/SCORCH.EXE DS:0xED58       # who reads/writes font selector?
    python3 xref.py earth/SCORCH.EXE DS:0xEF22       # who uses highlight color?
    python3 xref.py earth/SCORCH.EXE 0x7E             # who checks for ~ (0x7E)?
    python3 xref.py earth/SCORCH.EXE DS:0x518E        # who uses HUD Y position?
    python3 xref.py earth/SCORCH.EXE --callers 0x3B07F  # who calls shield_hit_draw?
    python3 xref.py earth/SCORCH.EXE --callers 0x38344  # who calls shield_absorb_damage?
    python3 xref.py earth/SCORCH.EXE --callers 0x3971F  # who calls terrain_generate?
"""

import sys
import struct
import os

DS_FILE_BASE = 0x055D80
MZ_HEADER = 0x6A00
DS_SEG = 0x4F38
LOAD_SEG = DS_SEG - (DS_FILE_BASE - MZ_HEADER) // 16

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

# Known code modules with segment paragraphs (for near call resolution)
MODULES = [
    (0x06A00, 0x20EA0, 0x0000, "startup+libs"),
    (0x20EA0, 0x263F0, 0x1A4A, "extras.cpp"),
    (0x263F0, 0x2F830, 0x1F7F, "icons.cpp"),
    (0x2F830, 0x31FB0, 0x28B9, "play.cpp"),
    (0x31FB0, 0x33690, 0x2B3B, "player.cpp"),
    (0x33690, 0x38070, 0x2CBF, "ranges.cpp"),
    (0x38070, 0x38780, 0x3167, "shark.cpp"),
    (0x38780, 0x3B8D0, 0x31D8, "shields.cpp"),
    (0x3B8D0, 0x4C290, 0x34ED, "menu+dialogs"),
    (0x4C290, 0x4D000, 0x4589, "font module"),
]


def parse_mz_relocs(data):
    """Parse MZ relocation table, return set of file offsets where relocations apply."""
    assert data[:2] == b'MZ', "Not an MZ executable"
    num_relocs = struct.unpack_from('<H', data, 0x06)[0]
    reloc_table_off = struct.unpack_from('<H', data, 0x18)[0]
    relocs = set()
    for i in range(num_relocs):
        pos = reloc_table_off + i * 4
        off, seg = struct.unpack_from('<HH', data, pos)
        reloc_file = seg * 16 + off + MZ_HEADER
        relocs.add(reloc_file)
    return relocs


def seg_name_for_file_off(file_off):
    """Return module name for a file offset."""
    for start, end, _seg, name in MODULES:
        if start <= file_off < end:
            return name
    return "unknown"


def file_to_segoff_str(file_off):
    """Return SEG:OFF string for a file offset."""
    for start, end, seg, name in MODULES:
        if start <= file_off < end:
            seg_off = file_off - start
            if seg_off <= 0xFFFF:
                return f"{seg:04X}:{seg_off:04X}"
            # Offset exceeds 16-bit — use raw paragraph:offset
            break
    linear = file_off - MZ_HEADER
    if linear >= 0:
        return f"{(linear >> 4):04X}:{(linear & 0xF):04X}"
    return f"????:{file_off:04X}"


def load_labels():
    """Load labels.csv if available, return dict of file_offset -> name."""
    labels = {}
    script_dir = os.path.dirname(os.path.abspath(__file__))
    labels_path = os.path.join(script_dir, 'labels.csv')
    if not os.path.exists(labels_path):
        return labels
    with open(labels_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(',', 1)
            if len(parts) != 2:
                continue
            addr_str, name = parts
            addr_str = addr_str.strip()
            name = name.strip()
            if addr_str.lower().startswith('ds:'):
                ds_off = int(addr_str[3:], 16)
                file_off = ds_off + DS_FILE_BASE
                labels[file_off] = name
            else:
                file_off = int(addr_str, 16)
                labels[file_off] = name
    return labels


def find_callers(data, target_file_offset):
    """Find all call sites (far and near) targeting a given function file offset.

    Far calls: 9A off16 seg16 where seg field is MZ-relocated.
    Target file offset = MZ_HEADER + raw_seg * 16 + off16.
    (The load segment P cancels out: runtime target = (raw_seg+P)*16 + off,
     load image offset = (raw_seg+P)*16 + off - P*16 = raw_seg*16 + off.)

    Near calls: E8 rel16 within code modules.
    Target file offset = call_file + 3 + rel16 (signed).

    Push CS + near call: 0E E8 rel16.
    Target file offset = call_file + 4 + rel16 (signed).
    """
    relocs = parse_mz_relocs(data)
    results = []

    # Scan range: all code from header to data segment start
    code_end = min(len(data), DS_FILE_BASE)

    # 1. Far calls: 0x9A off16 seg16, where seg field is relocated
    #    target_file = MZ_HEADER + raw_seg * 16 + off16
    for i in range(MZ_HEADER, code_end - 4):
        if data[i] != 0x9A:
            continue
        seg_reloc_pos = i + 3
        if seg_reloc_pos not in relocs:
            continue
        call_off = struct.unpack_from('<H', data, i + 1)[0]
        raw_seg = struct.unpack_from('<H', data, i + 3)[0]
        computed_target = MZ_HEADER + raw_seg * 16 + call_off
        if computed_target == target_file_offset:
            results.append(('far', i, f"CALL FAR {raw_seg:04X}:{call_off:04X}"))

    # 2. Near calls (0xE8 rel16) — target = call_file + 3 + rel16
    for i in range(MZ_HEADER, code_end - 2):
        if data[i] == 0xE8:
            rel = struct.unpack_from('<h', data, i + 1)[0]  # signed 16-bit
            target_file = i + 3 + rel
            if target_file == target_file_offset:
                results.append(('near', i, f"CALL NEAR {rel:+05X}"))

    # 3. push cs; call near (0x0E 0xE8 rel16) — target = call_file + 4 + rel16
    for i in range(MZ_HEADER, code_end - 3):
        if data[i] == 0x0E and data[i + 1] == 0xE8:
            rel = struct.unpack_from('<h', data, i + 2)[0]
            target_file = i + 4 + rel
            if target_file == target_file_offset:
                results.append(('pushcs_near', i, f"PUSH CS; CALL NEAR {rel:+05X}"))

    # Deduplicate: when push cs (0x0E) + call near (0xE8) overlap,
    # the near scan finds the 0xE8 at offset+1 — suppress it
    pushcs_e8_offsets = {off + 1 for kind, off, _ in results if kind == 'pushcs_near'}
    deduped = [(kind, off, desc) for kind, off, desc in results
               if not (kind == 'near' and off in pushcs_e8_offsets)]

    return sorted(deduped, key=lambda x: x[1])


def run_callers_mode(exe_path, target_str):
    """Run --callers mode: find all callers of a function."""
    target_file_offset = int(target_str, 16)

    with open(exe_path, 'rb') as f:
        data = f.read()

    labels = load_labels()
    target_name = labels.get(target_file_offset, "")
    target_label = f" ({target_name})" if target_name else ""

    print(f"Finding callers of function at file 0x{target_file_offset:05X}{target_label}")
    print(f"Target SEG:OFF: {file_to_segoff_str(target_file_offset)}")
    print()

    results = find_callers(data, target_file_offset)

    for kind, offset, desc in results:
        module = seg_name_for_file_off(offset)
        caller_label = labels.get(offset, "")
        label_str = f"  <{caller_label}>" if caller_label else ""
        segoff = file_to_segoff_str(offset)
        print(f"  file 0x{offset:05X}  {segoff}  [{module}]  {kind:12s}  {desc}{label_str}")

    print(f"\n--- {len(results)} caller(s) found ---")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]

    # Check for --callers mode
    if sys.argv[2] == '--callers':
        if len(sys.argv) < 4:
            print("Usage: xref.py <exe> --callers <file_offset>")
            sys.exit(1)
        run_callers_mode(exe_path, sys.argv[3])
        return

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
