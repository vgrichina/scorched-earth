#!/usr/bin/env python3
"""Search for code references to a DS variable by common instruction patterns."""
import sys

ds_off = int(sys.argv[1], 16)
lo = ds_off & 0xFF
hi = (ds_off >> 8) & 0xFF

data = open('earth/SCORCH.EXE', 'rb').read()

patterns = [
    (bytes([0xA1, lo, hi]), f"mov ax, [0x{ds_off:04X}]"),
    (bytes([0xA3, lo, hi]), f"mov [0x{ds_off:04X}], ax"),
    (bytes([0x83, 0x3E, lo, hi]), f"cmp word [0x{ds_off:04X}], imm8"),
    (bytes([0xFF, 0x36, lo, hi]), f"push word [0x{ds_off:04X}]"),
    (bytes([0x8B, 0x06, lo, hi]), f"mov ax/r, [0x{ds_off:04X}]"),
    (bytes([0x8B, 0x0E, lo, hi]), f"mov cx, [0x{ds_off:04X}]"),
    (bytes([0x8B, 0x16, lo, hi]), f"mov dx, [0x{ds_off:04X}]"),
    (bytes([0x8B, 0x1E, lo, hi]), f"mov bx, [0x{ds_off:04X}]"),
    (bytes([0x8B, 0x36, lo, hi]), f"mov si, [0x{ds_off:04X}]"),
    (bytes([0x8B, 0x3E, lo, hi]), f"mov di, [0x{ds_off:04X}]"),
    (bytes([0x89, 0x06, lo, hi]), f"mov [0x{ds_off:04X}], ax"),
    (bytes([0x89, 0x0E, lo, hi]), f"mov [0x{ds_off:04X}], cx"),
    (bytes([0x89, 0x16, lo, hi]), f"mov [0x{ds_off:04X}], dx"),
    (bytes([0x89, 0x1E, lo, hi]), f"mov [0x{ds_off:04X}], bx"),
    (bytes([0x89, 0x36, lo, hi]), f"mov [0x{ds_off:04X}], si"),
    (bytes([0xC7, 0x06, lo, hi]), f"mov word [0x{ds_off:04X}], imm16"),
    (bytes([0x3B, 0x06, lo, hi]), f"cmp reg, [0x{ds_off:04X}]"),
    (bytes([0x39, 0x06, lo, hi]), f"cmp [0x{ds_off:04X}], reg"),
    (bytes([0xF7, 0x06, lo, hi]), f"test word [0x{ds_off:04X}], imm16"),
]

code_start = 0x6A00
code_end = 0x656E0
found = 0
for needle, desc in patterns:
    off = code_start
    while True:
        idx = data.find(needle, off)
        if idx == -1 or idx > code_end:
            break
        print(f"  file 0x{idx:05X}  {desc}")
        off = idx + 1
        found += 1

print(f"\n--- {found} references found ---")
