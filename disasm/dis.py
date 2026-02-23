#!/usr/bin/env python3
"""
dis.py — Zero-dependency x86 16-bit disassembler for Scorched Earth v1.50.

Replaces the r2 + fpu_decode.py pipeline. Handles all x86 16-bit instructions
and Borland FPU INT 34h-3Eh emulation natively. Annotates DS constants and
loads labels/comments from CSV knowledge files.

Usage:
    python3 disasm/dis.py <addr> [count]

    addr   : file offset (hex, 0x prefix optional)  — e.g. 0x20EA0
             DS:XXXX (DS offset)                     — e.g. DS:0x1234
             SEG:OFF (code segment:offset)           — e.g. 1A4A:0000

    count  : instructions to disassemble (default 40)

Examples:
    python3 disasm/dis.py 0x25DE9 60        # ai_inject_noise
    python3 disasm/dis.py 0x2943A 30        # generate_wind
    python3 disasm/dis.py DS:0x11F6 20      # weapon struct area
    python3 disasm/dis.py 1A4A:0 50         # extras.cpp from start

Reads (from project root):
    disasm/labels.csv    — file_offset_hex,name  OR  DS:offset_hex,name
    disasm/comments.csv  — file_offset_hex,comment  OR  DS:offset_hex,comment

Output columns:
    file_offset  SEG:OFF  raw_bytes  mnemonic  operands  ; comment/DS-ref
"""

import sys
import os
import csv
import struct

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT       = os.path.dirname(SCRIPT_DIR)
EXE_PATH   = os.path.join(ROOT, 'earth', 'SCORCH.EXE')
LABELS_CSV = os.path.join(SCRIPT_DIR, 'labels.csv')
COMMENTS_CSV = os.path.join(SCRIPT_DIR, 'comments.csv')

# ---------------------------------------------------------------------------
# EXE / address constants
# ---------------------------------------------------------------------------

MZ_HEADER   = 0x6A00          # header size in bytes; code starts at file 0x6A00
DS_FILE_BASE = 0x055D80       # file offset of DS base (paragraph 0x4F38 * 16 + header)
DS_SEG      = 0x4F38          # DS paragraph number

# Known code-segment to module name mapping (from CLAUDE.md)
MODULES = [
    # (file_start, file_end, code_seg_paragraph, name)
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
    """Return (seg, off) for a file offset, using known module code segments."""
    for start, end, seg, name in MODULES:
        if start <= file_off < end:
            off = (file_off - MZ_HEADER) - (seg * 16)
            return seg, off
    # Fallback: compute raw paragraph:offset
    code_off = file_off - MZ_HEADER
    if code_off >= 0:
        return code_off >> 4, code_off & 0xF
    return 0, file_off

def ds_to_file(ds_off):
    return DS_FILE_BASE + ds_off

def file_to_ds(file_off):
    v = file_off - DS_FILE_BASE
    return v if 0 <= v < 0x10000 else None

# ---------------------------------------------------------------------------
# Known DS constants for inline annotation (merged from fpu_decode.py + RE doc)
# ---------------------------------------------------------------------------

DS_CONSTANTS = {
    # FPU constants (from fpu_decode.py)
    0x1CC8: ('f32',  100.0,        'distance divisor'),
    0x1D08: ('f64',  0.0174532930, 'PI/180 deg-to-rad'),
    0x1D10: ('f64',  1.02,         '+2% damage randomization'),
    0x1D18: ('f64',  0.98,         '-2% damage randomization'),
    0x1D20: ('f32',  5000.0,       'max effective distance'),
    0x1D28: ('f32',  1.825,        'damage coefficient'),
    0x1D2C: ('f32',  1000000.0,    'distance^2 threshold'),
    0x1D30: ('f32',  1000.0,       'scaling factor'),
    0x1D38: ('f32',  -1.875,       'polynomial coefficient'),
    0x1D40: ('f32',  -1.75,        'polynomial coefficient'),
    0x1D48: ('f32',  -2.0,         'polynomial coefficient'),
    0x1D50: ('f32',  -3.140625,    '~-PI'),
    0x1D54: ('f32',  0.75,         'coefficient'),
    0x1D58: ('f32',  2000.0,       'scaling'),
    0x1D5C: ('f32',  2.0,          'doubling'),
    0x1D60: ('f64',  0.7,          'damage falloff'),
    0x1D68: ('f64',  0.001,        'epsilon threshold'),
    # AI / wind constants
    0x322E: ('f64',  3.14159,      'PI'),
    0x3236: ('f64',  6.28318,      '2*PI'),
    0x323E: ('f64',  4.0,          '4.0'),
    0x3242: ('f64',  0.5,          '0.5'),
    0x3246: ('f64',  2.0,          '2.0'),
    # Config / physics
    0x0408: ('f64',  20.0,         'max AIR_VISCOSITY'),
    0x040C: ('f64',  10000.0,      'viscosity divisor'),
    0x637C: ('f64',  10000.0,      'viscosity divisor (alias)'),
    0x633C: ('f64',  5.0,          'wind slider min'),
    0x6348: ('f64',  500.0,        'wind slider max'),
}

# ---------------------------------------------------------------------------
# CSV loaders
# ---------------------------------------------------------------------------

def _parse_addr_key(s):
    """
    Parse a CSV key into (kind, value):
      '0x20EA0' or '20EA0' → ('file', 0x20EA0)
      'DS:0x1234'          → ('ds',   0x1234)
    Returns None on failure.
    """
    s = s.strip()
    sl = s.lower()
    if sl.startswith('ds:'):
        try:
            return ('ds', int(s[3:], 16))
        except ValueError:
            return None
    try:
        return ('file', int(s, 16))
    except ValueError:
        return None


def load_labels(path):
    """Return dict file_offset -> name  (DS offsets are converted to file offsets)."""
    labels = {}
    if not os.path.exists(path):
        return labels
    with open(path, newline='') as f:
        for row in csv.reader(f):
            if not row or row[0].strip().startswith('#'):
                continue
            if len(row) < 2:
                continue
            key = _parse_addr_key(row[0])
            name = row[1].strip()
            if key and name:
                kind, val = key
                foff = ds_to_file(val) if kind == 'ds' else val
                labels[foff] = name
    return labels


def load_comments(path):
    """Return dict file_offset -> comment."""
    comments = {}
    if not os.path.exists(path):
        return comments
    with open(path, newline='') as f:
        for row in csv.reader(f):
            if not row or row[0].strip().startswith('#'):
                continue
            if len(row) < 2:
                continue
            key = _parse_addr_key(row[0])
            cmt = ','.join(row[1:]).strip()
            if key and cmt:
                kind, val = key
                foff = ds_to_file(val) if kind == 'ds' else val
                comments[foff] = cmt
    return comments


# ---------------------------------------------------------------------------
# DS variable name lookup
# ---------------------------------------------------------------------------

def load_ds_labels(path):
    """Return dict ds_offset -> name (only DS: entries from labels.csv)."""
    dl = {}
    if not os.path.exists(path):
        return dl
    with open(path, newline='') as f:
        for row in csv.reader(f):
            if not row or row[0].strip().startswith('#'):
                continue
            if len(row) < 2:
                continue
            key = _parse_addr_key(row[0])
            name = row[1].strip()
            if key and name and key[0] == 'ds':
                dl[key[1]] = name
    return dl


# ---------------------------------------------------------------------------
# Address parser (command-line arg)
# ---------------------------------------------------------------------------

def parse_start_addr(s):
    """
    Parse command-line address:
      '0x20EA0' or '20EA0'  → file offset
      'DS:0x1234'            → DS offset → file offset
      'SEG:OFF' hex pair     → file offset
    Returns file offset as int.
    """
    s = s.strip()
    sl = s.lower()

    if sl.startswith('ds:'):
        ds_off = int(s[3:], 16)
        return ds_to_file(ds_off)

    if ':' in s:
        seg_s, off_s = s.split(':', 1)
        seg = int(seg_s, 16)
        off = int(off_s, 16)
        return MZ_HEADER + seg * 16 + off

    return int(s, 16)


# ---------------------------------------------------------------------------
# Disassembler core
# ---------------------------------------------------------------------------

from instruction_set_x86 import decode

def disassemble(data, file_start, n_lines, labels, comments, ds_labels):
    """
    Disassemble n_lines instructions starting at file_start.
    Yields formatted output lines.
    """
    pos = file_start

    # Build a flat labels dict keyed by file offset (already done by load_labels)
    # but decode() needs it for jump target annotation.
    label_lookup = labels

    for _ in range(n_lines):
        if pos >= len(data):
            yield f'  0x{pos:05X}  ; <end of file>'
            break

        # --- Label line ---
        lbl = labels.get(pos)
        if lbl:
            yield ''
            yield f'{lbl}:'

        # --- Comment line (before instruction) ---
        cmt = comments.get(pos)

        # --- Decode ---
        length, mn, op_str, is_fpu, ds_ref = decode(data, pos, label_lookup)

        # --- Raw bytes ---
        raw = data[pos:pos+length]
        hex_bytes = ' '.join(f'{b:02X}' for b in raw)

        # --- SEG:OFF ---
        seg, off = file_to_segoff(pos)
        segoff = f'{seg:04X}:{off:04X}'

        # --- Operand with DS variable name substitution ---
        op_display = op_str

        # --- Annotation ---
        ann_parts = []

        # DS constant annotation
        if ds_ref is not None:
            ds_name = ds_labels.get(ds_ref)
            if ds_name:
                ann_parts.append(f'DS:{ds_ref:04X} = {ds_name}')
            elif ds_ref in DS_CONSTANTS:
                typ, val, desc = DS_CONSTANTS[ds_ref]
                ann_parts.append(f'DS:{ds_ref:04X} = [{typ}] {val} ({desc})')
            else:
                ann_parts.append(f'DS:{ds_ref:04X}')

        # Inline comment from CSV
        if cmt:
            ann_parts.append(cmt)

        ann_str = '  ; ' + ' | '.join(ann_parts) if ann_parts else ''

        # --- Format line ---
        full_mn = mn + (' ' + op_display if op_display else '')
        line = f'  0x{pos:05X}  {segoff}  {hex_bytes:<14}  {full_mn}{ann_str}'
        yield line

        pos += length
        if length <= 0:
            yield f'  0x{pos:05X}  ; <decoder returned length 0, aborting>'
            break


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)

    try:
        file_start = parse_start_addr(args[0])
    except (ValueError, IndexError) as e:
        print(f'Error parsing address: {args[0]!r} — {e}', file=sys.stderr)
        sys.exit(1)

    n_lines = int(args[1]) if len(args) > 1 else 40

    if not os.path.exists(EXE_PATH):
        print(f'Error: EXE not found at {EXE_PATH}', file=sys.stderr)
        sys.exit(1)

    with open(EXE_PATH, 'rb') as f:
        data = f.read()

    if file_start >= len(data):
        print(f'Error: offset 0x{file_start:X} beyond file size 0x{len(data):X}', file=sys.stderr)
        sys.exit(1)

    labels    = load_labels(LABELS_CSV)
    comments  = load_comments(COMMENTS_CSV)
    ds_labels = load_ds_labels(LABELS_CSV)

    seg, off = file_to_segoff(file_start)
    ds_rel = file_to_ds(file_start)
    ds_str = f'  DS:0x{ds_rel:04X}' if ds_rel is not None else ''
    print(f'; 0x{file_start:05X}  {seg:04X}:{off:04X}{ds_str}  ({n_lines} instructions)')
    print()

    for line in disassemble(data, file_start, n_lines, labels, comments, ds_labels):
        print(line)


if __name__ == '__main__':
    main()
