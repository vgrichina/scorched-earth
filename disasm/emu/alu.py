"""Arithmetic, logic, and shift instruction execution."""

import struct
from .modrm import decode_modrm, compute_ea


def exec_alu(op, cpu, mem, seg_override):
    """Execute ALU opcode (0x00-0x3F range, 0x80-0x83, 0xF6-0xF7, etc).
    Returns instruction length or 0 if not handled."""

    # ---- ALU reg/mem group: ADD OR ADC SBB AND SUB XOR CMP (0x00-0x3D) ----
    # Pattern: each group of 6 opcodes at base+0..5
    # base+0: r/m8, r8    base+1: r/m16, r16   base+2: r8, r/m8
    # base+3: r16, r/m16  base+4: AL, imm8     base+5: AX, imm16
    _ALU_BASES = {0x00: 'add', 0x08: 'or', 0x10: 'adc', 0x18: 'sbb',
                  0x20: 'and', 0x28: 'sub', 0x30: 'xor', 0x38: 'cmp'}

    for base, name in _ALU_BASES.items():
        if base <= op <= base + 5:
            return _exec_alu_group(op - base, name, op, cpu, mem, seg_override)

    # ---- Group 1: 0x80-0x83 (immediate ALU) --------------------------------
    if op in (0x80, 0x81, 0x82, 0x83):
        return _exec_grp1(op, cpu, mem, seg_override)

    # ---- Group 3: 0xF6/0xF7 (TEST/NOT/NEG/MUL/IMUL/DIV/IDIV) -------------
    if op in (0xF6, 0xF7):
        return _exec_grp3(op, cpu, mem, seg_override)

    # ---- INC/DEC r16: 0x40-0x4F -------------------------------------------
    if 0x40 <= op <= 0x47:
        idx = op - 0x40
        old = cpu.regs[idx]
        saved_cf = cpu.cf
        cpu.update_flags_add(old, 1, 16)
        cpu.cf = saved_cf  # INC doesn't affect CF
        cpu.regs[idx] = (old + 1) & 0xFFFF
        return 1

    if 0x48 <= op <= 0x4F:
        idx = op - 0x48
        old = cpu.regs[idx]
        saved_cf = cpu.cf
        cpu.update_flags_sub(old, 1, 16)
        cpu.cf = saved_cf  # DEC doesn't affect CF
        cpu.regs[idx] = (old - 1) & 0xFFFF
        return 1

    # ---- INC/DEC byte: 0xFE (Group 4) -------------------------------------
    if op == 0xFE:
        return _exec_grp4(cpu, mem, seg_override)

    # ---- Shift/Rotate: 0xD0-0xD3, 0xC0-0xC1 (Group 2) --------------------
    if op in (0xD0, 0xD1, 0xD2, 0xD3, 0xC0, 0xC1):
        return _exec_grp2(op, cpu, mem, seg_override)

    # ---- CBW/CWD -----------------------------------------------------------
    if op == 0x98:  # CBW
        al = cpu.get_reg8(0)
        cpu.ax = al if al < 0x80 else al | 0xFF00
        return 1
    if op == 0x99:  # CWD
        cpu.dx = 0xFFFF if cpu.ax & 0x8000 else 0x0000
        return 1

    # ---- TEST AL/AX, imm: 0xA8/0xA9 ----------------------------------------
    if op == 0xA8:
        ip_phys = mem.phys(cpu.segs[1], cpu.ip)
        cpu.update_flags_logic(cpu.get_reg8(0) & mem.read8(ip_phys + 1), 8)
        return 2
    if op == 0xA9:
        ip_phys = mem.phys(cpu.segs[1], cpu.ip)
        cpu.update_flags_logic(cpu.ax & mem.read16(ip_phys + 1), 16)
        return 3

    # ---- NEG handled in grp3 above -----------------------------------------
    # ---- TEST r/m, r: 0x84-0x85 -------------------------------------------
    if op == 0x84:
        return _exec_test_rm_r(cpu, mem, seg_override, 8)
    if op == 0x85:
        return _exec_test_rm_r(cpu, mem, seg_override, 16)

    return 0  # not handled


# -- Internal helpers --------------------------------------------------------

def _read_operand(cpu, mem, mod, rm, seg_override, width):
    """Read operand value from register (mod=3) or memory."""
    if mod == 3:
        return cpu.get_reg8(rm) if width == 8 else cpu.get_reg16(rm)
    # Already have phys addr from caller? No — need disp. Caller should pass phys.
    raise ValueError("_read_operand needs phys addr for memory ops")


def _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width):
    """Get value from r/m operand."""
    if mod == 3:
        return cpu.get_reg8(rm) if width == 8 else cpu.get_reg16(rm)
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    return mem.read8(phys) if width == 8 else mem.read16(phys)


def _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, val):
    """Set value to r/m operand."""
    if mod == 3:
        if width == 8:
            cpu.set_reg8(rm, val)
        else:
            cpu.set_reg16(rm, val)
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        if width == 8:
            mem.write8(phys, val)
        else:
            mem.write16(phys, val)


def _do_alu(name, cpu, dst, src, width):
    """Perform ALU op, update flags, return result."""
    mask = (1 << width) - 1
    if name == 'add':
        r = cpu.update_flags_add(dst, src, width)
    elif name == 'or':
        r = cpu.update_flags_logic(dst | src, width)
    elif name == 'adc':
        r = cpu.update_flags_add(dst, src + cpu.cf, width)
    elif name == 'sbb':
        r = cpu.update_flags_sub(dst, src + cpu.cf, width)
    elif name == 'and':
        r = cpu.update_flags_logic(dst & src, width)
    elif name == 'sub':
        r = cpu.update_flags_sub(dst, src, width)
    elif name == 'xor':
        r = cpu.update_flags_logic(dst ^ src, width)
    elif name == 'cmp':
        cpu.update_flags_sub(dst, src, width)
        return None  # don't store
    else:
        raise ValueError(f"Unknown ALU op: {name}")
    return r & mask


def _exec_alu_group(subop, name, op, cpu, mem, seg_override):
    """Execute one of the 6 ALU sub-opcodes."""
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)

    if subop == 4:  # AL, imm8
        imm = mem.read8(ip_phys + 1)
        al = cpu.get_reg8(0)
        r = _do_alu(name, cpu, al, imm, 8)
        if r is not None:
            cpu.set_reg8(0, r)
        return 2

    if subop == 5:  # AX, imm16
        imm = mem.read16(ip_phys + 1)
        r = _do_alu(name, cpu, cpu.ax, imm, 16)
        if r is not None:
            cpu.ax = r
        return 3

    # ModRM-based (subop 0-3)
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    width = 8 if (subop & 1) == 0 else 16

    if subop <= 1:  # r/m, r
        dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
        src = cpu.get_reg8(reg) if width == 8 else cpu.get_reg16(reg)
        r = _do_alu(name, cpu, dst, src, width)
        if r is not None:
            _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, r)
    else:  # r, r/m
        dst = cpu.get_reg8(reg) if width == 8 else cpu.get_reg16(reg)
        src = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
        r = _do_alu(name, cpu, dst, src, width)
        if r is not None:
            if width == 8:
                cpu.set_reg8(reg, r)
            else:
                cpu.set_reg16(reg, r)

    return 1 + ml


def _exec_grp1(op, cpu, mem, seg_override):
    """Group 1: 0x80-0x83 — immediate ALU with ModR/M."""
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    _GRP1 = ('add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp')
    name = _GRP1[reg]

    if op in (0x80, 0x82):  # r/m8, imm8
        dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 8)
        imm = mem.read8(ip_phys + 1 + ml)
        r = _do_alu(name, cpu, dst, imm, 8)
        if r is not None:
            _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 8, r)
        return 1 + ml + 1

    if op == 0x81:  # r/m16, imm16
        dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 16)
        imm = mem.read16(ip_phys + 1 + ml)
        r = _do_alu(name, cpu, dst, imm, 16)
        if r is not None:
            _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 16, r)
        return 1 + ml + 2

    # 0x83: r/m16, sign-extended imm8
    dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 16)
    imm = struct.unpack_from('b', mem.data, ip_phys + 1 + ml)[0]
    imm = imm & 0xFFFF  # sign-extend to 16-bit unsigned
    r = _do_alu(name, cpu, dst, imm, 16)
    if r is not None:
        _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 16, r)
    return 1 + ml + 1


def _exec_grp2(op, cpu, mem, seg_override):
    """Group 2: shifts/rotates."""
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)

    if op in (0xD0, 0xD1):  # shift by 1
        count = 1
        extra = 0
    elif op in (0xD2, 0xD3):  # shift by CL
        count = cpu.get_reg8(1) & 0x1F  # CL, masked to 5 bits
        extra = 0
    else:  # 0xC0, 0xC1: shift by imm8
        count = mem.read8(ip_phys + 1 + ml) & 0x1F
        extra = 1

    width = 16 if (op & 1) else 8
    val = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
    mask = (1 << width) - 1

    _GRP2 = ('rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'sal', 'sar')
    name = _GRP2[reg]

    for _ in range(count):
        if name in ('shl', 'sal'):
            cpu.cf = 1 if val & (1 << (width - 1)) else 0
            val = (val << 1) & mask
        elif name == 'shr':
            cpu.cf = val & 1
            val = val >> 1
        elif name == 'sar':
            cpu.cf = val & 1
            sign = val & (1 << (width - 1))
            val = (val >> 1) | sign
        elif name == 'rol':
            bit = (val >> (width - 1)) & 1
            val = ((val << 1) | bit) & mask
            cpu.cf = bit
        elif name == 'ror':
            bit = val & 1
            val = (bit << (width - 1)) | (val >> 1)
            cpu.cf = bit
        elif name == 'rcl':
            bit = cpu.cf
            cpu.cf = (val >> (width - 1)) & 1
            val = ((val << 1) | bit) & mask
        elif name == 'rcr':
            bit = cpu.cf
            cpu.cf = val & 1
            val = (bit << (width - 1)) | (val >> 1)

    if count > 0:
        cpu.zf = 1 if val == 0 else 0
        cpu.sf = 1 if val & (1 << (width - 1)) else 0
        cpu.pf = cpu._parity(val)

    _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, val)
    return 1 + ml + extra


def _exec_grp3(op, cpu, mem, seg_override):
    """Group 3: TEST/NOT/NEG/MUL/IMUL/DIV/IDIV."""
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)
    width = 8 if op == 0xF6 else 16
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    val = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
    mask = (1 << width) - 1

    if reg in (0, 1):  # TEST r/m, imm
        if width == 8:
            imm = mem.read8(ip_phys + 1 + ml)
            cpu.update_flags_logic(val & imm, 8)
            return 1 + ml + 1
        else:
            imm = mem.read16(ip_phys + 1 + ml)
            cpu.update_flags_logic(val & imm, 16)
            return 1 + ml + 2

    if reg == 2:  # NOT
        _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, (~val) & mask)
        return 1 + ml

    if reg == 3:  # NEG
        r = cpu.update_flags_sub(0, val, width)
        cpu.cf = 0 if val == 0 else 1
        _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, r)
        return 1 + ml

    if reg == 4:  # MUL (unsigned)
        if width == 8:
            result = cpu.get_reg8(0) * val  # AL * r/m8
            cpu.ax = result & 0xFFFF
            cpu.of = cpu.cf = 0 if (result >> 8) == 0 else 1
        else:
            result = cpu.ax * val  # AX * r/m16
            cpu.ax = result & 0xFFFF
            cpu.dx = (result >> 16) & 0xFFFF
            cpu.of = cpu.cf = 0 if cpu.dx == 0 else 1
        return 1 + ml

    if reg == 5:  # IMUL (signed)
        if width == 8:
            a = cpu.get_reg8(0)
            if a >= 0x80: a -= 0x100
            b = val
            if b >= 0x80: b -= 0x100
            result = a * b
            cpu.ax = result & 0xFFFF
            cpu.of = cpu.cf = 0 if -128 <= result <= 127 else 1
        else:
            a = cpu.ax
            if a >= 0x8000: a -= 0x10000
            b = val
            if b >= 0x8000: b -= 0x10000
            result = a * b
            cpu.ax = result & 0xFFFF
            cpu.dx = (result >> 16) & 0xFFFF
            cpu.of = cpu.cf = 0 if -32768 <= result <= 32767 else 1
        return 1 + ml

    if reg == 6:  # DIV (unsigned)
        if width == 8:
            dividend = cpu.ax
            if val == 0:
                raise RuntimeError("Division by zero (DIV byte)")
            cpu.set_reg8(0, (dividend // val) & 0xFF)   # AL = quotient
            cpu.set_reg8(4, (dividend % val) & 0xFF)    # AH = remainder
        else:
            dividend = (cpu.dx << 16) | cpu.ax
            if val == 0:
                raise RuntimeError("Division by zero (DIV word)")
            cpu.ax = (dividend // val) & 0xFFFF
            cpu.dx = (dividend % val) & 0xFFFF
        return 1 + ml

    if reg == 7:  # IDIV (signed)
        if width == 8:
            dividend = cpu.ax
            if dividend >= 0x8000: dividend -= 0x10000
            divisor = val
            if divisor >= 0x80: divisor -= 0x100
            if divisor == 0:
                raise RuntimeError("Division by zero (IDIV byte)")
            q = int(dividend / divisor)  # truncate toward zero
            r = dividend - q * divisor
            cpu.set_reg8(0, q & 0xFF)
            cpu.set_reg8(4, r & 0xFF)
        else:
            dividend = (cpu.dx << 16) | cpu.ax
            if dividend >= 0x80000000: dividend -= 0x100000000
            divisor = val
            if divisor >= 0x8000: divisor -= 0x10000
            if divisor == 0:
                raise RuntimeError("Division by zero (IDIV word)")
            q = int(dividend / divisor)
            r = dividend - q * divisor
            cpu.ax = q & 0xFFFF
            cpu.dx = r & 0xFFFF
        return 1 + ml

    return 1 + ml


def _exec_grp4(cpu, mem, seg_override):
    """Group 4: INC/DEC byte (0xFE)."""
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    val = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 8)
    saved_cf = cpu.cf
    if reg == 0:  # INC
        r = cpu.update_flags_add(val, 1, 8)
    else:  # DEC
        r = cpu.update_flags_sub(val, 1, 8)
    cpu.cf = saved_cf
    _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 8, r)
    return 1 + ml


def _exec_test_rm_r(cpu, mem, seg_override, width):
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    a = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
    b = cpu.get_reg8(reg) if width == 8 else cpu.get_reg16(reg)
    cpu.update_flags_logic(a & b, width)
    return 1 + ml
