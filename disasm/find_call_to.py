#!/usr/bin/env python3
"""Find far call instructions targeting a given function file offset."""
import struct, sys

EXE = "earth/SCORCH.EXE"
HEADER = 0x6A00

# Target: terrain generation at file 0x3971F
target_file = 0x3971F

# Read MZ header to get relocation info
with open(EXE, "rb") as f:
    # Read MZ header fields
    f.seek(0)
    magic = f.read(2)
    assert magic == b'MZ', f"Not MZ: {magic}"

    f.seek(0x06)
    num_relocs = struct.unpack('<H', f.read(2))[0]
    f.seek(0x18)
    reloc_offset = struct.unpack('<H', f.read(2))[0]

    print(f"MZ relocation table: {num_relocs} entries at file offset 0x{reloc_offset:04X}")

    # Read relocation table
    f.seek(reloc_offset)
    relocs = set()
    for _ in range(num_relocs):
        off, seg = struct.unpack('<HH', f.read(4))
        # Relocation address in the load image
        reloc_addr = seg * 16 + off
        # File offset of relocation
        reloc_file = reloc_addr + HEADER
        relocs.add(reloc_file)

    # Now search for far calls (opcode 9A) where the target matches
    # Far call format: 9A off_lo off_hi seg_lo seg_hi
    # The seg field gets relocated at load time
    # In the raw binary, seg = 0 (before relocation) for most calls
    # The actual runtime seg is: raw_seg + load_base_segment

    # We need to find calls where: (raw_seg + load_base) * 16 + offset + HEADER = target_file
    # i.e., offset_in_call + (raw_seg + load_base) * 16 = target_file - HEADER = target_linear

    target_linear = target_file - HEADER  # 0x32F1F

    # Read entire code region
    f.seek(HEADER)
    code = f.read(0x60000)

    print(f"\nTarget file offset: 0x{target_file:05X}")
    print(f"Target linear address: 0x{target_linear:05X}")

    # For each segment that could address target_linear:
    # seg * 16 + off = target_linear, where off < 0x10000
    # So seg ranges from (target_linear - 0xFFFF) / 16 to target_linear / 16

    # Search for 9A xx xx yy yy where the relocation at that position's seg field
    # is in the relocs set
    found = []
    for i in range(len(code) - 5):
        if code[i] != 0x9A:  # far call opcode
            continue
        call_off = struct.unpack_from('<H', code, i + 1)[0]
        raw_seg = struct.unpack_from('<H', code, i + 3)[0]
        file_pos = HEADER + i

        # Check if the seg field at file_pos+3 is in the relocation table
        seg_reloc_pos = file_pos + 3
        if seg_reloc_pos not in relocs:
            continue

        # This is a relocated far call. The raw_seg in the file is meaningless;
        # at runtime it becomes raw_seg + load_base.
        # We need: (raw_seg + load_base) * 16 + call_off = target_linear
        # We don't know load_base. But we can solve:
        # actual_seg * 16 = target_linear - call_off
        # If target_linear - call_off is non-negative and divisible by 16, it's a candidate
        needed = target_linear - call_off
        if needed >= 0 and needed % 16 == 0:
            actual_seg = needed // 16
            load_base = actual_seg - raw_seg
            found.append((file_pos, call_off, raw_seg, actual_seg, load_base))

    if found:
        print(f"\nFound {len(found)} far call(s) to target:")
        for file_pos, call_off, raw_seg, actual_seg, load_base in found:
            print(f"  File 0x{file_pos:05X}: CALL FAR {raw_seg:04X}:{call_off:04X}"
                  f" -> runtime {actual_seg:04X}:{call_off:04X} (load_base=0x{load_base:04X})")
    else:
        print("\nNo far calls found to target.")

    # Also compute load_base from known segment: shields.cpp seg=0x31D8, file_base=0x38780
    # seg_linear = 0x38780 - 0x6A00 = 0x31D80, so runtime seg = 0x31D8
    # If raw_seg_in_file = R, then runtime_seg = R + load_base = 0x31D8
    # We need to find R from any relocated far call to a known function
    print("\n\n--- Computing load_base from known functions ---")
    # Look for a far call to the stack check at 0x0000:0xA2CE (which appears everywhere)
    # Actually, let's use a different approach: read the MZ initial CS:IP
    f.seek(0x14)
    init_ip = struct.unpack('<H', f.read(2))[0]
    f.seek(0x16)
    init_cs = struct.unpack('<H', f.read(2))[0]
    f.seek(0x0E)
    init_sp = struct.unpack('<H', f.read(2))[0]
    f.seek(0x10)
    init_ss = struct.unpack('<H', f.read(2))[0]

    print(f"MZ initial CS:IP = {init_cs:04X}:{init_ip:04X}")
    print(f"MZ initial SS:SP = {init_ss:04X}:{init_sp:04X}")

    # The init_cs is the raw value, runtime CS = init_cs + load_base
    # For the entry point, file offset = (init_cs * 16 + init_ip) + HEADER
    entry_file = init_cs * 16 + init_ip + HEADER
    print(f"Entry point file offset: 0x{entry_file:05X}")
