#!/usr/bin/env python3
"""Find all callers of a function (far + near calls) in SCORCH.EXE.

Searches for far call (9A) and near call (E8) instructions targeting the
given file offset. Handles MZ relocations for far calls via xref.py logic.

Usage:
    python3 find_callers.py <exe> <file_offset>

    file_offset     — target function file offset (e.g. 0x334B6)

    For far-call callers, prefer xref.py --callers which is more robust:
        python3 disasm/xref.py earth/SCORCH.EXE --callers 0x334B6

    This tool adds near-call scanning on top of that.

Examples:
    python3 disasm/find_callers.py earth/SCORCH.EXE 0x334B6
    python3 disasm/find_callers.py earth/SCORCH.EXE 0x21C56
"""
import sys
import struct

HEADER = 0x6A00

# Known code segment bases (file offset of segment start)
CODE_SEGS = [
    (0x0000, 0x6A00),   # seg 0x0000
    (0x1A4A, 0x21AA0),  # extras.cpp
    (0x1F7F, 0x263F0),  # icons.cpp
    (0x28B9, 0x2F830),  # play.cpp
    (0x2B3B, 0x31FB0),  # player.cpp
    (0x2CBF, 0x33690),  # ranges.cpp
    (0x3167, 0x38070),  # shark.cpp
    (0x31D8, 0x38780),  # shields.cpp
    (0x34ED, 0x3B8D0),  # menu module
    (0x3F19, 0x45990),  # dialog module
    (0x4589, 0x4C290),  # font module
]

def parse_mz_relocs(data):
    """Return set of file offsets that hold relocated segment words."""
    reloc_off = struct.unpack_from('<H', data, 0x18)[0]
    reloc_cnt = struct.unpack_from('<H', data, 0x06)[0]
    relocs = set()
    for i in range(reloc_cnt):
        off, seg = struct.unpack_from('<HH', data, reloc_off + i * 4)
        file_off = HEADER + seg * 16 + off
        relocs.add(file_off)
    return relocs

def seg_to_file(seg):
    return HEADER + seg * 16

def file_to_seg_off(file_off):
    seg = (file_off - HEADER) >> 4
    off = (file_off - HEADER) & 0xF
    return seg, off

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    exe_path = sys.argv[1]
    target_file = int(sys.argv[2], 16)

    data = open(exe_path, 'rb').read()
    relocs = parse_mz_relocs(data)

    # Compute target seg:off
    target_seg = (target_file - HEADER) >> 4
    target_off = target_file - HEADER - target_seg * 16

    far_results = []
    near_results = []

    # Far call pattern: 9A OFF_LO OFF_HI SEG_LO SEG_HI
    # Segment value is MZ-relocated, so search via relocation table
    for roff in sorted(relocs):
        if roff + 4 > len(data):
            continue
        # The segment word is at roff; the call opcode is at roff-3
        call_off = roff - 3
        if call_off < HEADER:
            continue
        if data[call_off] != 0x9A:
            continue
        callee_off = struct.unpack_from('<H', data, call_off + 1)[0]
        callee_seg = struct.unpack_from('<H', data, call_off + 3)[0]
        callee_file = HEADER + callee_seg * 16 + callee_off
        if callee_file == target_file:
            far_results.append(call_off)

    # Near call (E8 rel16) within each known code segment
    for seg, seg_file_base in CODE_SEGS:
        # Find segment end (next segment or EOF)
        seg_end = len(data)
        for s2, b2 in CODE_SEGS:
            if b2 > seg_file_base:
                seg_end = min(seg_end, b2)
        # Target must be in same segment
        if target_file < seg_file_base or target_file >= seg_end:
            continue
        target_seg_off = target_file - seg_file_base
        for i in range(seg_file_base, seg_end - 2):
            if data[i] == 0xE8:
                rel = struct.unpack_from('<h', data, i + 1)[0]
                called_off = (i - seg_file_base + 3 + rel) & 0xFFFF
                if called_off == target_seg_off:
                    near_results.append(i)

    print(f"Callers of file 0x{target_file:05X} (seg 0x{target_seg:04X}:0x{target_off:04X}):")
    print(f"\nFar calls ({len(far_results)}):")
    for addr in far_results:
        print(f"  file 0x{addr:05X}")

    print(f"\nNear calls ({len(near_results)}):")
    for addr in near_results:
        seg_off = addr - HEADER
        print(f"  file 0x{addr:05X}")

    print(f"\nTotal: {len(far_results) + len(near_results)}")

if __name__ == '__main__':
    main()
