"""String instruction execution: MOVS, STOS, LODS, CMPS, SCAS with REP."""

from .modrm import compute_ea


def exec_string(op, cpu, mem, seg_override, rep_mode):
    """Execute string operation, handling REP prefix. Returns 1 (instruction length)."""
    def do_once():
        src_seg = seg_override if seg_override is not None else 3  # DS
        delta = -1 if cpu.df else 1

        if op == 0xA4:  # MOVSB
            val = mem.read8(mem.phys(cpu.segs[src_seg], cpu.si))
            mem.write8(mem.phys(cpu.segs[0], cpu.di), val)
            cpu.si = (cpu.si + delta) & 0xFFFF
            cpu.di = (cpu.di + delta) & 0xFFFF
        elif op == 0xA5:  # MOVSW
            val = mem.read16(mem.phys(cpu.segs[src_seg], cpu.si))
            mem.write16(mem.phys(cpu.segs[0], cpu.di), val)
            cpu.si = (cpu.si + delta * 2) & 0xFFFF
            cpu.di = (cpu.di + delta * 2) & 0xFFFF
        elif op == 0xAA:  # STOSB
            mem.write8(mem.phys(cpu.segs[0], cpu.di), cpu.get_reg8(0))
            cpu.di = (cpu.di + delta) & 0xFFFF
        elif op == 0xAB:  # STOSW
            mem.write16(mem.phys(cpu.segs[0], cpu.di), cpu.ax)
            cpu.di = (cpu.di + delta * 2) & 0xFFFF
        elif op == 0xAC:  # LODSB
            cpu.set_reg8(0, mem.read8(mem.phys(cpu.segs[src_seg], cpu.si)))
            cpu.si = (cpu.si + delta) & 0xFFFF
        elif op == 0xAD:  # LODSW
            cpu.ax = mem.read16(mem.phys(cpu.segs[src_seg], cpu.si))
            cpu.si = (cpu.si + delta * 2) & 0xFFFF
        elif op == 0xA6:  # CMPSB
            a = mem.read8(mem.phys(cpu.segs[src_seg], cpu.si))
            b = mem.read8(mem.phys(cpu.segs[0], cpu.di))
            cpu.update_flags_sub(a, b, 8)
            cpu.si = (cpu.si + delta) & 0xFFFF
            cpu.di = (cpu.di + delta) & 0xFFFF
        elif op == 0xA7:  # CMPSW
            a = mem.read16(mem.phys(cpu.segs[src_seg], cpu.si))
            b = mem.read16(mem.phys(cpu.segs[0], cpu.di))
            cpu.update_flags_sub(a, b, 16)
            cpu.si = (cpu.si + delta * 2) & 0xFFFF
            cpu.di = (cpu.di + delta * 2) & 0xFFFF
        elif op == 0xAE:  # SCASB
            a = cpu.get_reg8(0)
            b = mem.read8(mem.phys(cpu.segs[0], cpu.di))
            cpu.update_flags_sub(a, b, 8)
            cpu.di = (cpu.di + delta) & 0xFFFF
        elif op == 0xAF:  # SCASW
            a = cpu.ax
            b = mem.read16(mem.phys(cpu.segs[0], cpu.di))
            cpu.update_flags_sub(a, b, 16)
            cpu.di = (cpu.di + delta * 2) & 0xFFFF

    if rep_mode == 0:
        do_once()
    elif rep_mode == 1:  # REP / REPE
        while cpu.cx > 0:
            do_once()
            cpu.cx = (cpu.cx - 1) & 0xFFFF
            if op in (0xA6, 0xA7, 0xAE, 0xAF) and cpu.zf == 0:
                break
    elif rep_mode == 2:  # REPNE
        while cpu.cx > 0:
            do_once()
            cpu.cx = (cpu.cx - 1) & 0xFFFF
            if op in (0xA6, 0xA7, 0xAE, 0xAF) and cpu.zf == 1:
                break
    return 1
