"""
seg_offset.py — Convert between SEG:OFF, DS offset, and file offset for SCORCH.EXE

Binary layout constants:
    MZ header size: 0x6A00 bytes
    Load segment:   0x4F38 (first paragraph after header = 0x6A00/16 = 0x6A0)
                    Wait — the load address is where the OS loads the EXE.
                    For analysis purposes we treat file offset 0 as the MZ header.
                    Segment 0x4F38 corresponds to DS, which is at file 0x055D80.
                    General formula: file_off = header + (seg - load_seg) * 16 + off
                    where load_seg is the first code segment.

From project notes:
    - Header: 0x6A00 bytes
    - Data segment (DS): para 0x4F38, file base 0x055D80
    - DS offset: file = ds_off + 0x055D80  (i.e. para base = 0x055D80 - 0 = file offset of DS:0000)
    - Code segments mapped: extras=0x1A4A, icons=0x1F7F, shark=0x3167, etc.

Usage:
    python3 seg_offset.py SEG:OFF            # → file offset
    python3 seg_offset.py DS:OFF             # → file offset (DS segment)
    python3 seg_offset.py 0xFILEOFF          # → DS:OFF or nearest seg:off
    python3 seg_offset.py SEG:OFF DS:OFF ... # multiple in one call

Examples:
    python3 seg_offset.py 1A4A:0000          # extras.cpp base
    python3 seg_offset.py DS:0x3826          # icon data
    python3 seg_offset.py 0x261D7            # → SEG:OFF
    python3 seg_offset.py 2910:0184          # draw_hud
"""

import sys
import re

HEADER    = 0x6A00
DS_SEG    = 0x4F38           # DS paragraph (matches file base 0x055D80 when: DS_SEG*16 + ... hmm)
# Actual mapping verified: ds_off + 0x055D80 = file offset
# => DS file base = 0x055D80, DS_SEG * 16 = 0x4F380
# => file_base_of_DS = 0x055D80 means: header_end - exe_load_offset + DS_SEG*16
# => load_seg = (0x6A00/16) = 0x6A0? No...
# From ds_lookup.py: file = ds_off + (DS_SEG * 16) - ???
# Actually: file = ds_off + 0x055D80 directly (the project uses this constant)
DS_FILE_BASE = 0x055D80      # file offset of DS:0x0000

# Code segment file base formula (from project notes):
# file_off = (seg - LOAD_SEG) * 16 + HEADER
# We need LOAD_SEG. From: DS_FILE_BASE = (DS_SEG - LOAD_SEG)*16 + HEADER
# => LOAD_SEG = DS_SEG - (DS_FILE_BASE - HEADER) / 16
LOAD_SEG = DS_SEG - (DS_FILE_BASE - HEADER) // 16

def seg_off_to_file(seg, off):
    return (seg - LOAD_SEG) * 16 + off + HEADER

def file_to_seg_off(file_off, seg=None):
    """Convert file offset to seg:off. Uses DS by default, or supplied seg."""
    if seg is None:
        seg = DS_SEG
    off = file_off - (seg - LOAD_SEG) * 16 - HEADER
    return seg, off

def ds_to_file(ds_off):
    return ds_off + DS_FILE_BASE

def file_to_ds(file_off):
    ds_off = file_off - DS_FILE_BASE
    if 0 <= ds_off <= 0xFFFF:
        return ds_off
    return None

def parse_addr(token):
    """Parse 'SEG:OFF', 'DS:OFF', '0xFILE', or plain hex. Returns (kind, value)."""
    token = token.strip()
    lo = token.lower()
    if lo.startswith('ds:'):
        off = int(token[3:], 16)
        return ('ds', off)
    m = re.match(r'^([0-9A-Fa-f]{1,5}):([0-9A-Fa-f]{1,5})$', token)
    if m:
        seg = int(m.group(1), 16)
        off = int(m.group(2), 16)
        return ('seg', (seg, off))
    if lo.startswith('0x') or (len(token) > 2 and all(c in '0123456789abcdefABCDEF' for c in token)):
        val = int(token, 16)
        return ('file', val)
    return ('unknown', token)

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    print(f"(LOAD_SEG=0x{LOAD_SEG:04X}, DS_SEG=0x{DS_SEG:04X}, header=0x{HEADER:04X})\n")

    for token in sys.argv[1:]:
        kind, val = parse_addr(token)
        if kind == 'ds':
            file_off = ds_to_file(val)
            seg_calc, off_calc = file_to_seg_off(file_off, DS_SEG)
            print(f"DS:0x{val:04X}  →  file 0x{file_off:05X}  (={DS_SEG:04X}:{val:04X})")
        elif kind == 'seg':
            seg, off = val
            file_off = seg_off_to_file(seg, off)
            ds_off = file_to_ds(file_off)
            ds_str = f"  DS:0x{ds_off:04X}" if ds_off is not None else ''
            print(f"{seg:04X}:{off:04X}  →  file 0x{file_off:05X}{ds_str}")
        elif kind == 'file':
            file_off = val
            ds_off = file_to_ds(file_off)
            # Try DS as reference segment
            _, off_in_ds = file_to_seg_off(file_off, DS_SEG)
            if ds_off is not None:
                print(f"file 0x{file_off:05X}  →  DS:0x{ds_off:04X}  ({DS_SEG:04X}:{ds_off:04X})")
            else:
                # Show as nearest code seg:off using DS_SEG as base
                seg_approx = (file_off - HEADER) // 16 + LOAD_SEG
                off_approx = (file_off - HEADER) % 16
                print(f"file 0x{file_off:05X}  →  approx {seg_approx:04X}:{off_approx:04X}  (outside DS)")
        else:
            print(f"Cannot parse: {token}")

if __name__ == '__main__':
    main()
