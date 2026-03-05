"""String instruction execution: MOVS, STOS, LODS, CMPS, SCAS with REP."""


def exec_string(op, cpu, mem, seg_override, rep_mode):
    """Execute string operation, handling REP prefix. Returns 1 (instruction length)."""
    src_seg = seg_override if seg_override is not None else 3  # DS
    segs = cpu.segs
    regs = cpu.regs

    if rep_mode == 0:
        _string_once(op, cpu, mem, segs, regs, src_seg)
    elif rep_mode == 1:  # REP / REPE
        is_cmps_scas = op in (0xA6, 0xA7, 0xAE, 0xAF)
        while regs[1] > 0:  # CX
            _string_once(op, cpu, mem, segs, regs, src_seg)
            regs[1] = (regs[1] - 1) & 0xFFFF
            if is_cmps_scas and cpu.zf == 0:
                break
    elif rep_mode == 2:  # REPNE
        is_cmps_scas = op in (0xA6, 0xA7, 0xAE, 0xAF)
        while regs[1] > 0:
            _string_once(op, cpu, mem, segs, regs, src_seg)
            regs[1] = (regs[1] - 1) & 0xFFFF
            if is_cmps_scas and cpu.zf == 1:
                break
    return 1


def _string_once(op, cpu, mem, segs, regs, src_seg):
    delta = -1 if cpu.df else 1

    if op == 0xA4:  # MOVSB
        val = mem.read8(((segs[src_seg] << 4) + regs[6]) & 0xFFFFF)
        mem.write8(((segs[0] << 4) + regs[7]) & 0xFFFFF, val)
        regs[6] = (regs[6] + delta) & 0xFFFF
        regs[7] = (regs[7] + delta) & 0xFFFF
    elif op == 0xA5:  # MOVSW
        val = mem.read16(((segs[src_seg] << 4) + regs[6]) & 0xFFFFF)
        mem.write16(((segs[0] << 4) + regs[7]) & 0xFFFFF, val)
        regs[6] = (regs[6] + delta * 2) & 0xFFFF
        regs[7] = (regs[7] + delta * 2) & 0xFFFF
    elif op == 0xAA:  # STOSB
        mem.write8(((segs[0] << 4) + regs[7]) & 0xFFFFF, regs[0] & 0xFF)
        regs[7] = (regs[7] + delta) & 0xFFFF
    elif op == 0xAB:  # STOSW
        mem.write16(((segs[0] << 4) + regs[7]) & 0xFFFFF, regs[0])
        regs[7] = (regs[7] + delta * 2) & 0xFFFF
    elif op == 0xAC:  # LODSB
        v = mem.read8(((segs[src_seg] << 4) + regs[6]) & 0xFFFFF)
        regs[0] = (regs[0] & 0xFF00) | v
        regs[6] = (regs[6] + delta) & 0xFFFF
    elif op == 0xAD:  # LODSW
        regs[0] = mem.read16(((segs[src_seg] << 4) + regs[6]) & 0xFFFFF)
        regs[6] = (regs[6] + delta * 2) & 0xFFFF
    elif op == 0xA6:  # CMPSB
        a = mem.read8(((segs[src_seg] << 4) + regs[6]) & 0xFFFFF)
        b = mem.read8(((segs[0] << 4) + regs[7]) & 0xFFFFF)
        cpu.update_flags_sub(a, b, 8)
        regs[6] = (regs[6] + delta) & 0xFFFF
        regs[7] = (regs[7] + delta) & 0xFFFF
    elif op == 0xA7:  # CMPSW
        a = mem.read16(((segs[src_seg] << 4) + regs[6]) & 0xFFFFF)
        b = mem.read16(((segs[0] << 4) + regs[7]) & 0xFFFFF)
        cpu.update_flags_sub(a, b, 16)
        regs[6] = (regs[6] + delta * 2) & 0xFFFF
        regs[7] = (regs[7] + delta * 2) & 0xFFFF
    elif op == 0xAE:  # SCASB
        a = regs[0] & 0xFF
        b = mem.read8(((segs[0] << 4) + regs[7]) & 0xFFFFF)
        cpu.update_flags_sub(a, b, 8)
        regs[7] = (regs[7] + delta) & 0xFFFF
    elif op == 0xAF:  # SCASW
        a = regs[0]
        b = mem.read16(((segs[0] << 4) + regs[7]) & 0xFFFFF)
        cpu.update_flags_sub(a, b, 16)
        regs[7] = (regs[7] + delta * 2) & 0xFFFF
