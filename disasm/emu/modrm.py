"""ModR/M decoding and effective address computation for execution."""

import struct


def decode_modrm(mem_data, pos):
    """Parse ModR/M byte at pos in raw bytes.
    Returns (total_bytes, mod, reg, rm, disp).
    total_bytes includes the ModR/M byte + any displacement bytes.
    disp is the raw displacement value (0 if none).
    """
    modrm = mem_data[pos]
    mod = (modrm >> 6) & 3
    reg = (modrm >> 3) & 7
    rm = modrm & 7

    if mod == 3:
        return 1, mod, reg, rm, 0

    if mod == 0 and rm == 6:
        disp = struct.unpack_from('<H', mem_data, pos + 1)[0]
        return 3, mod, reg, rm, disp

    if mod == 0:
        return 1, mod, reg, rm, 0

    if mod == 1:
        disp = struct.unpack_from('b', mem_data, pos + 1)[0]
        return 2, mod, reg, rm, disp

    # mod == 2
    disp = struct.unpack_from('<h', mem_data, pos + 1)[0]
    return 3, mod, reg, rm, disp


# EA base register computation tables (indexed by rm field)
# Each entry: (reg_index_1, reg_index_2) or (reg_index_1, None)
# Register indices match CPU.regs: AX=0 CX=1 DX=2 BX=3 SP=4 BP=5 SI=6 DI=7
_EA_BASES = [
    (3, 6),   # rm=0: BX+SI
    (3, 7),   # rm=1: BX+DI
    (5, 6),   # rm=2: BP+SI
    (5, 7),   # rm=3: BP+DI
    (6, None),  # rm=4: SI
    (7, None),  # rm=5: DI
    (5, None),  # rm=6: BP (only for mod!=0; mod=0 rm=6 is [disp16])
    (3, None),  # rm=7: BX
]

# Default segment for each rm value (SS for BP-based, DS for rest)
# Index: 0=ES 1=CS 2=SS 3=DS
_EA_DEFAULT_SEG = [3, 3, 2, 2, 3, 3, 2, 3]


def compute_ea(cpu, mod, rm, disp, seg_override=None):
    """Compute physical address from ModR/M fields + CPU state.
    Returns (physical_addr, offset_16bit).
    seg_override: segment register index (0-3) or None for default.
    """
    if mod == 0 and rm == 6:
        offset = disp & 0xFFFF
        seg_idx = seg_override if seg_override is not None else 3  # DS
    else:
        r1, r2 = _EA_BASES[rm]
        offset = cpu.regs[r1]
        if r2 is not None:
            offset += cpu.regs[r2]
        offset = (offset + disp) & 0xFFFF
        seg_idx = seg_override if seg_override is not None else _EA_DEFAULT_SEG[rm]

    seg_val = cpu.segs[seg_idx]
    phys = ((seg_val << 4) + offset) & 0xFFFFF
    return phys, offset
