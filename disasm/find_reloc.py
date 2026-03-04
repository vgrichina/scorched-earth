#!/usr/bin/env python3
"""Find MZ relocation entry patching a specific file offset."""
import struct
import sys

exe_path = sys.argv[1]
target_file_offset = int(sys.argv[2], 16)
header_size = 0x6A00  # MZ header size

target_loaded = target_file_offset - header_size

with open(exe_path, 'rb') as f:
    f.seek(0x06)
    nrelocs = struct.unpack('<H', f.read(2))[0]
    f.seek(0x18)
    reloc_ofs = struct.unpack('<H', f.read(2))[0]
    print(f'Relocation table at 0x{reloc_ofs:X}, {nrelocs} entries')
    print(f'Looking for relocation patching loaded offset 0x{target_loaded:X} (file 0x{target_file_offset:X})')

    f.seek(reloc_ofs)
    entries = []
    for i in range(nrelocs):
        off, seg = struct.unpack('<HH', f.read(4))
        entries.append((seg, off, i))

    found = False
    for seg, off, i in entries:
        patched_addr = seg * 16 + off
        if patched_addr == target_loaded:
            print(f'FOUND: reloc entry #{i}: seg=0x{seg:04X} off=0x{off:04X}')
            f.seek(header_size + patched_addr)
            val = struct.unpack('<H', f.read(2))[0]
            print(f'  Raw segment value at file offset: 0x{val:04X}')
            found = True

    if not found:
        print('Not found exactly. Nearby:')
        for seg, off, i in entries:
            patched_addr = seg * 16 + off
            if abs(patched_addr - target_loaded) < 32:
                f.seek(header_size + patched_addr)
                val = struct.unpack('<H', f.read(2))[0]
                print(f'  reloc #{i}: seg=0x{seg:04X} off=0x{off:04X} -> loaded 0x{patched_addr:05X} (file 0x{patched_addr+header_size:05X}) val=0x{val:04X}')
