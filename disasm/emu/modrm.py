"""ModR/M decoding and effective address computation for execution."""


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

    if mod == 0:
        if rm == 6:
            disp = mem_data[pos + 1] | (mem_data[pos + 2] << 8)
            return 3, mod, reg, rm, disp
        return 1, mod, reg, rm, 0

    if mod == 1:
        b = mem_data[pos + 1]
        disp = b if b < 0x80 else b - 0x100
        return 2, mod, reg, rm, disp

    # mod == 2
    w = mem_data[pos + 1] | (mem_data[pos + 2] << 8)
    disp = w if w < 0x8000 else w - 0x10000
    return 3, mod, reg, rm, disp


# EA base register computation tables (indexed by rm field)
_EA_BASES = (
    (3, 6),     # rm=0: BX+SI
    (3, 7),     # rm=1: BX+DI
    (5, 6),     # rm=2: BP+SI
    (5, 7),     # rm=3: BP+DI
    (6, -1),    # rm=4: SI
    (7, -1),    # rm=5: DI
    (5, -1),    # rm=6: BP (only for mod!=0; mod=0 rm=6 is [disp16])
    (3, -1),    # rm=7: BX
)

# Default segment for each rm value (SS for BP-based, DS for rest)
_EA_DEFAULT_SEG = (3, 3, 2, 2, 3, 3, 2, 3)


def compute_ea(cpu, mod, rm, disp, seg_override=None):
    """Compute physical address from ModR/M fields + CPU state.
    Returns (physical_addr, offset_16bit).
    """
    if mod == 0 and rm == 6:
        offset = disp & 0xFFFF
        seg_idx = seg_override if seg_override is not None else 3
    else:
        r1, r2 = _EA_BASES[rm]
        offset = cpu.regs[r1]
        if r2 >= 0:
            offset += cpu.regs[r2]
        offset = (offset + disp) & 0xFFFF
        seg_idx = seg_override if seg_override is not None else _EA_DEFAULT_SEG[rm]

    phys = ((cpu.segs[seg_idx] << 4) + offset) & 0xFFFFF
    return phys, offset
