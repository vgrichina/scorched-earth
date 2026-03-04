#!/usr/bin/env python3
"""Check MZ header and verify segment-to-file mapping."""
import struct

EXE = "earth/SCORCH.EXE"

with open(EXE, "rb") as f:
    # MZ header fields
    f.seek(0x00); magic = f.read(2)
    f.seek(0x02); last_page_bytes = struct.unpack('<H', f.read(2))[0]
    f.seek(0x04); pages = struct.unpack('<H', f.read(2))[0]
    f.seek(0x06); num_relocs = struct.unpack('<H', f.read(2))[0]
    f.seek(0x08); header_paragraphs = struct.unpack('<H', f.read(2))[0]
    f.seek(0x14); init_ip = struct.unpack('<H', f.read(2))[0]
    f.seek(0x16); init_cs = struct.unpack('<H', f.read(2))[0]
    f.seek(0x18); reloc_offset = struct.unpack('<H', f.read(2))[0]

    header_bytes = header_paragraphs * 16
    exe_size = (pages - 1) * 512 + last_page_bytes if last_page_bytes else pages * 512

    print(f"MZ header:")
    print(f"  Magic: {magic}")
    print(f"  Pages: {pages} ({pages*512} bytes)")
    print(f"  Last page bytes: {last_page_bytes}")
    print(f"  EXE size: {exe_size} (0x{exe_size:X})")
    print(f"  Header paragraphs: {header_paragraphs} = 0x{header_paragraphs:X}")
    print(f"  Header bytes: {header_bytes} = 0x{header_bytes:X}")
    print(f"  Relocations: {num_relocs}")
    print(f"  Relocation table offset: 0x{reloc_offset:04X}")
    print(f"  Initial CS:IP = {init_cs:04X}:{init_ip:04X}")
    print(f"  Entry file offset = 0x{header_bytes + init_cs * 16 + init_ip:05X}")

    # Now check: is there a relocation at the position of our jump table?
    # The jump instruction at file 0x39951 uses CS: prefix to access cs:bx+0x0A18
    # This doesn't involve a relocation (it uses the current CS register)
    # But let's check the relocation table for entries near the table area

    f.seek(reloc_offset)
    relocs = []
    for i in range(num_relocs):
        off, seg = struct.unpack('<HH', f.read(4))
        linear = seg * 16 + off
        file_off = header_bytes + linear
        relocs.append((off, seg, file_off))

    # Check if there are relocations between file 0x39198 and 0x391A8
    print(f"\nRelocations near table area (file 0x39190-0x391B0):")
    for off, seg, foff in relocs:
        if 0x39190 <= foff <= 0x391B0:
            print(f"  Reloc at file 0x{foff:05X} (seg {seg:04X}:{off:04X})")

    # Also look at the SECOND jump table at 0x391C9: jmp [cs:bx+0x03CA]
    # Table at cs:0x03CA = file 0x38780 + 0x03CA = 0x38B4A
    # Check relocations near there
    print(f"\nRelocations near second table area (file 0x38B40-0x38B60):")
    for off, seg, foff in relocs:
        if 0x38B40 <= foff <= 0x38B60:
            print(f"  Reloc at file 0x{foff:05X} (seg {seg:04X}:{off:04X})")

    # Let's also check: what are the actual case handler offsets we identified?
    # Case 0: file 0x39956 = seg_base + offset
    # If seg_base = 0x38780 (header_bytes=0x6A00, seg=0x31D8):
    #   offset = 0x39956 - 0x38780 = 0x11D6
    # If the table should contain 0x11D6, let's search for it in the segment
    seg_base = header_bytes  # Load module starts at header_bytes

    # Actually, let me check: is header_bytes 0x6A00?
    print(f"\nHeader bytes: 0x{header_bytes:04X} (expected 0x6A00)")

    # The code at 0x3971F should be at:
    # With CS=0x31D8: file = 0x31D8*16 + 0x0F9F + header_bytes
    test = 0x31D8 * 16 + 0x0F9F + header_bytes
    print(f"0x31D8:0x0F9F + header = file 0x{test:05X} (expected 0x3971F)")

    # And cs:0x0A18 should be at:
    table = 0x31D8 * 16 + 0x0A18 + header_bytes
    print(f"0x31D8:0x0A18 + header = file 0x{table:05X} (expected 0x39198)")
