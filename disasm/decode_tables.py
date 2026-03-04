#!/usr/bin/env python3
"""
decode_tables.py — Universal struct/table decoder for Scorched Earth v1.50.

Usage:
    python3 disasm/decode_tables.py <addr> <count> <format> [--follow]

Arguments:
    addr    File offset (0xXXXXX) or DS:XXXX or SEG:OFF
    count   Number of table entries
    format  One of:
              u8        1 unsigned byte
              s8        1 signed byte
              u16       2-byte little-endian unsigned int
              s16       2-byte little-endian signed int
              u32       4-byte little-endian unsigned int
              ptr16     2-byte near pointer (DS-relative)
              farptr    4-byte far pointer (seg:off LE)
              b8        1 byte shown in binary
              nullstr   null-terminated string at each entry address
              struct:<n>:<f,f,...>
                        n-byte struct; fields: u8/s8/u16/s16/u32/ptr16/farptr/b8

Options:
    --follow   For ptr16/farptr tables: disassemble 8 lines at each target

Examples:
    python3 disasm/decode_tables.py DS:0x2158 37 farptr
    python3 disasm/decode_tables.py DS:0x2158 37 farptr --follow
    python3 disasm/decode_tables.py DS:0x11F6 10 struct:52:ptr16,u16,u16,u16,s16,s16
    python3 disasm/decode_tables.py DS:0x6234 9  struct:16:u16,u16,u16
    python3 disasm/decode_tables.py 0x3F445 20 farptr --follow
    python3 disasm/decode_tables.py DS:0xEF22 8 u16
"""

import sys
import os
import csv
import struct
import subprocess

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
ROOT         = os.path.dirname(SCRIPT_DIR)
EXE_PATH     = os.path.join(ROOT, 'earth', 'SCORCH.EXE')
LABELS_CSV   = os.path.join(SCRIPT_DIR, 'labels.csv')

MZ_HEADER    = 0x6A00
DS_FILE_BASE = 0x055D80
DS_SEG       = 0x4F38

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


# ---------------------------------------------------------------------------
# Address helpers
# ---------------------------------------------------------------------------

def ds_to_file(ds_off):
    return DS_FILE_BASE + ds_off


def file_to_ds(file_off):
    v = file_off - DS_FILE_BASE
    return v if 0 <= v < 0x10000 else None


def file_to_segoff(file_off):
    for start, end, seg, _name in MODULES:
        if start <= file_off < end:
            off = (file_off - MZ_HEADER) - (seg * 16)
            return seg, off
    code_off = file_off - MZ_HEADER
    if code_off >= 0:
        return code_off >> 4, code_off & 0xF
    return 0, file_off


def parse_addr(s):
    s = s.strip()
    sl = s.lower()
    if sl.startswith('ds:'):
        return ds_to_file(int(s[3:], 16))
    if ':' in s and not sl.startswith('0x'):
        seg_s, off_s = s.split(':', 1)
        seg = int(seg_s, 16)
        off = int(off_s, 16)
        return MZ_HEADER + seg * 16 + off
    return int(s, 16)


# ---------------------------------------------------------------------------
# Label loader
# ---------------------------------------------------------------------------

def load_labels(path):
    labels = {}
    if not os.path.exists(path):
        return labels
    with open(path, newline='') as f:
        for row in csv.reader(f):
            if not row or row[0].strip().startswith('#'):
                continue
            if len(row) < 2:
                continue
            key = row[0].strip()
            name = row[1].strip()
            if not name:
                continue
            try:
                kl = key.lower()
                if kl.startswith('ds:'):
                    foff = ds_to_file(int(key[3:], 16))
                elif ':' in key and not kl.startswith('0x'):
                    seg_s, off_s = key.split(':', 1)
                    foff = MZ_HEADER + int(seg_s, 16) * 16 + int(off_s, 16)
                else:
                    foff = int(key, 16)
                labels[foff] = name
            except ValueError:
                pass
    return labels


# ---------------------------------------------------------------------------
# Formatters — each returns (bytes_consumed, display_string)
# ---------------------------------------------------------------------------

def fmt_u8(exe, pos, labels):
    v = exe[pos]
    return 1, f'0x{v:02X}  ({v:3d})'


def fmt_s8(exe, pos, labels):
    v = exe[pos]
    sv = v if v < 128 else v - 256
    return 1, f'0x{v:02X}  ({sv:+4d})'


def fmt_b8(exe, pos, labels):
    v = exe[pos]
    return 1, f'{v:08b}  (0x{v:02X})'


def fmt_u16(exe, pos, labels):
    v = struct.unpack_from('<H', exe, pos)[0]
    return 2, f'0x{v:04X}  ({v:5d})'


def fmt_s16(exe, pos, labels):
    v = struct.unpack_from('<h', exe, pos)[0]
    return 2, f'0x{v & 0xFFFF:04X}  ({v:+6d})'


def fmt_u32(exe, pos, labels):
    v = struct.unpack_from('<I', exe, pos)[0]
    return 4, f'0x{v:08X}  ({v:9d})'


def fmt_ptr16(exe, pos, labels):
    v = struct.unpack_from('<H', exe, pos)[0]
    file_tgt = ds_to_file(v)
    lbl = labels.get(file_tgt, '')
    note = f'  -> {lbl}' if lbl else ''
    return 2, f'DS:0x{v:04X}  (file 0x{file_tgt:05X}){note}'


def fmt_farptr(exe, pos, labels):
    off = struct.unpack_from('<H', exe, pos)[0]
    seg = struct.unpack_from('<H', exe, pos + 2)[0]
    file_tgt = MZ_HEADER + seg * 16 + off
    lbl = labels.get(file_tgt, '')
    note = f'  -> {lbl}' if lbl else ''
    return 4, f'{seg:04X}:{off:04X}  (file 0x{file_tgt:05X}){note}'


def fmt_nullstr(exe, pos, labels):
    end = pos
    while end < len(exe) and exe[end] != 0:
        end += 1
    s = exe[pos:end].decode('cp437', errors='replace')
    return end - pos + 1, repr(s)


def make_struct_fmt(size, field_names):
    FMAP = {
        'u8':     (1, fmt_u8),
        's8':     (1, fmt_s8),
        'b8':     (1, fmt_b8),
        'u16':    (2, fmt_u16),
        's16':    (2, fmt_s16),
        'u32':    (4, fmt_u32),
        'ptr16':  (2, fmt_ptr16),
        'farptr': (4, fmt_farptr),
    }
    field_fmts = []
    foff = 0
    for fn in field_names:
        fn = fn.strip()
        fsz, ffmt = FMAP.get(fn, (1, fmt_u8))
        field_fmts.append((fn, foff, fsz, ffmt))
        foff += fsz

    def _struct(exe, pos, labels):
        parts = []
        for fname, fo, _fsz, ffmt in field_fmts:
            _, s = ffmt(exe, pos + fo, labels)
            parts.append(f'{fname}={s}')
        return size, '  '.join(parts)

    return _struct


FORMATTERS = {
    'u8':     fmt_u8,
    's8':     fmt_s8,
    'b8':     fmt_b8,
    'u16':    fmt_u16,
    's16':    fmt_s16,
    'u32':    fmt_u32,
    'ptr16':  fmt_ptr16,
    'farptr': fmt_farptr,
    'nullstr': fmt_nullstr,
}

ENTRY_SIZES = {
    'u8': 1, 's8': 1, 'b8': 1,
    'u16': 2, 's16': 2,
    'u32': 4,
    'ptr16': 2,
    'farptr': 4,
    'nullstr': None,  # variable
}


def get_formatter(fmt_str):
    if fmt_str in FORMATTERS:
        return FORMATTERS[fmt_str]
    if fmt_str.startswith('struct:'):
        parts = fmt_str.split(':', 2)
        if len(parts) == 3:
            size   = int(parts[1])
            fields = parts[2].split(',')
            return make_struct_fmt(size, fields)
    raise ValueError(f"Unknown format: {fmt_str!r}")


def get_entry_size(fmt_str):
    if fmt_str in ENTRY_SIZES:
        return ENTRY_SIZES[fmt_str]
    if fmt_str.startswith('struct:'):
        return int(fmt_str.split(':')[1])
    return 1


def follow_target(file_tgt, disasm_n=6):
    """Disassemble N lines at a target file offset, indented."""
    result = subprocess.run(
        [sys.executable, os.path.join(SCRIPT_DIR, 'dis.py'),
         f'0x{file_tgt:05X}', str(disasm_n)],
        capture_output=True, text=True
    )
    for line in result.stdout.splitlines():
        print('      ' + line)
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)

    if len(args) < 3:
        print("Usage: python3 disasm/decode_tables.py <addr> <count> <format> [--follow]")
        sys.exit(1)

    addr    = parse_addr(args[0])
    count   = int(args[1])
    fmt_str = args[2]
    follow  = '--follow' in args

    with open(EXE_PATH, 'rb') as f:
        exe = f.read()

    labels  = load_labels(LABELS_CSV)
    fmt_fn  = get_formatter(fmt_str)
    esize   = get_entry_size(fmt_str)

    # Header
    ds_rel = file_to_ds(addr)
    addr_disp = f'DS:0x{ds_rel:04X}  (file 0x{addr:05X})' if ds_rel is not None else f'0x{addr:05X}'
    print(f'; Table at {addr_disp}  count={count}  format={fmt_str}')
    print()

    cur = addr
    for i in range(count):
        if cur >= len(exe):
            print(f'  [{i:3d}]  <out of range>')
            break

        size_used, text = fmt_fn(exe, cur, labels)

        ds_r = file_to_ds(cur)
        addr_str = f'DS:0x{ds_r:04X}' if ds_r is not None else f'0x{cur:05X}'
        print(f'  [{i:3d}]  {addr_str}  {text}')

        if follow and fmt_str in ('ptr16', 'farptr'):
            if fmt_str == 'ptr16':
                v = struct.unpack_from('<H', exe, cur)[0]
                file_tgt = ds_to_file(v)
            else:
                off = struct.unpack_from('<H', exe, cur)[0]
                seg = struct.unpack_from('<H', exe, cur + 2)[0]
                file_tgt = MZ_HEADER + seg * 16 + off
            follow_target(file_tgt)

        cur += size_used

    print()
    ds_end = file_to_ds(cur)
    end_str = f'DS:0x{ds_end:04X}  (file 0x{cur:05X})' if ds_end is not None else f'0x{cur:05X}'
    print(f'; End  {end_str}')


if __name__ == '__main__':
    main()
