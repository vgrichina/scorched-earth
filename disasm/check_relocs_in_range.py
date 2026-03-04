#!/usr/bin/env python3
"""Check MZ relocation entries that overlap with the terrain gen jump table."""
import struct

EXE = "earth/SCORCH.EXE"
HEADER_SIZE = 0x6A00
TABLE_FILE_START = 0x39198  # CS:0x0A18 in segment 0x31D8
TABLE_FILE_END = TABLE_FILE_START + 14  # 7 x 2-byte entries

with open(EXE, "rb") as f:
    # Read MZ header
    f.seek(0)
    magic = f.read(2)
    assert magic == b'MZ', f"Not MZ: {magic}"

    f.seek(6)
    num_relocs = struct.unpack("<H", f.read(2))[0]

    f.seek(8)
    header_paragraphs = struct.unpack("<H", f.read(2))[0]
    header_bytes = header_paragraphs * 16

    f.seek(24)
    reloc_table_offset = struct.unpack("<H", f.read(2))[0]

    print(f"MZ header: {header_bytes} bytes, {num_relocs} relocations at offset 0x{reloc_table_offset:04X}")
    print(f"Table range: file 0x{TABLE_FILE_START:05X} - 0x{TABLE_FILE_END:05X}")
    print(f"Table loaded range: 0x{TABLE_FILE_START - HEADER_SIZE:05X} - 0x{TABLE_FILE_END - HEADER_SIZE:05X}")
    print()

    # Read all relocations
    f.seek(reloc_table_offset)
    relocs_in_range = []
    for i in range(num_relocs):
        off, seg = struct.unpack("<HH", f.read(4))
        loaded_addr = seg * 16 + off
        file_addr = loaded_addr + HEADER_SIZE
        # Check if this relocation modifies any byte in the table range
        if file_addr >= TABLE_FILE_START and file_addr < TABLE_FILE_END:
            relocs_in_range.append((file_addr, seg, off, loaded_addr))
        # Also check file_addr + 1 since relocations modify 2 bytes
        if file_addr + 1 >= TABLE_FILE_START and file_addr + 1 < TABLE_FILE_END:
            if file_addr not in [r[0] for r in relocs_in_range]:
                relocs_in_range.append((file_addr, seg, off, loaded_addr))

    if relocs_in_range:
        print(f"Found {len(relocs_in_range)} relocations in table range:")
        for file_addr, seg, off, loaded_addr in sorted(relocs_in_range):
            entry_idx = (file_addr - TABLE_FILE_START) // 2
            byte_in_entry = (file_addr - TABLE_FILE_START) % 2
            print(f"  file 0x{file_addr:05X} (loaded 0x{loaded_addr:05X}, seg:off {seg:04X}:{off:04X})")
            print(f"    -> affects table entry {entry_idx} (byte {byte_in_entry}) and possibly entry {entry_idx + (1 if byte_in_entry == 1 else 0)}")
            # Read the raw value and show what it would be after relocation
            f_pos = f.tell()
            f.seek(file_addr)
            raw_val = struct.unpack("<H", f.read(2))[0]
            print(f"    -> raw value at this address: 0x{raw_val:04X}")
            f.seek(f_pos)
    else:
        print("No relocations found in table range.")

    # Now show the raw table entries and which are affected
    print("\nTable entries (raw file values):")
    f.seek(TABLE_FILE_START)
    for i in range(7):
        val = struct.unpack("<H", f.read(2))[0]
        affected = any(r[0] >= TABLE_FILE_START + i*2 and r[0] < TABLE_FILE_START + i*2 + 2
                      for r in relocs_in_range)
        # Also check if a relocation at the previous position affects this entry
        affected2 = any(r[0] + 1 >= TABLE_FILE_START + i*2 and r[0] + 1 < TABLE_FILE_START + i*2 + 2
                       for r in relocs_in_range)
        status = " *** RELOCATED ***" if (affected or affected2) else ""
        target = 0x38780 + val
        print(f"  Type {i}: CS:0x{val:04X} → file 0x{target:05X}{status}")
