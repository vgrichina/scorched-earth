"""Arithmetic, logic, and shift instruction execution."""

from .modrm import decode_modrm, compute_ea
from .cpu import _PARITY_TABLE

# ALU operation IDs
_ADD, _OR, _ADC, _SBB, _AND, _SUB, _XOR, _CMP = range(8)

# Opcode → (alu_op_id, subop) for 0x00-0x3D range (tuple for O(1) lookup)
_ALU_INFO = [None] * 256
_ALU_BASES = ((0x00, _ADD), (0x08, _OR), (0x10, _ADC), (0x18, _SBB),
              (0x20, _AND), (0x28, _SUB), (0x30, _XOR), (0x38, _CMP))
for _base, _alu_id in _ALU_BASES:
    for _sub in range(6):
        _ALU_INFO[_base + _sub] = (_alu_id, _sub)
_ALU_INFO = tuple(_ALU_INFO)

# Group 1 reg field → alu op id
_GRP1_OPS = (_ADD, _OR, _ADC, _SBB, _AND, _SUB, _XOR, _CMP)

# Shift/rotate reg field constants
_GRP2_SHL, _GRP2_SHR, _GRP2_SAR = 4, 5, 7
_GRP2_ROL, _GRP2_ROR, _GRP2_RCL, _GRP2_RCR = 0, 1, 2, 3


# -- Internal helpers --------------------------------------------------------

def _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width):
    if mod == 3:
        return cpu.get_reg8(rm) if width == 8 else cpu.regs[rm]
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    return mem.read8(phys) if width == 8 else mem.read16(phys)


def _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, val):
    if mod == 3:
        if width == 8:
            cpu.set_reg8(rm, val)
        else:
            cpu.regs[rm] = val & 0xFFFF
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        if width == 8:
            mem.write8(phys, val)
        else:
            mem.write16(phys, val)


def _do_alu(alu_id, cpu, dst, src, width):
    mask = 0xFFFF if width == 16 else 0xFF
    if alu_id == _ADD:
        r = cpu.update_flags_add(dst, src, width)
    elif alu_id == _OR:
        r = cpu.update_flags_logic(dst | src, width)
    elif alu_id == _ADC:
        r = cpu.update_flags_add(dst, src + cpu.cf, width)
    elif alu_id == _SBB:
        r = cpu.update_flags_sub(dst, src + cpu.cf, width)
    elif alu_id == _AND:
        r = cpu.update_flags_logic(dst & src, width)
    elif alu_id == _SUB:
        r = cpu.update_flags_sub(dst, src, width)
    elif alu_id == _XOR:
        r = cpu.update_flags_logic(dst ^ src, width)
    else:  # _CMP
        cpu.update_flags_sub(dst, src, width)
        return None
    return r & mask


def _exec_alu_group(subop, alu_id, cpu, mem, seg_override, ip_phys):
    data = mem.data

    if subop == 4:  # AL, imm8
        imm = data[ip_phys + 1]
        al = cpu.get_reg8(0)
        r = _do_alu(alu_id, cpu, al, imm, 8)
        if r is not None:
            cpu.set_reg8(0, r)
        return 2

    if subop == 5:  # AX, imm16
        imm = data[ip_phys + 1] | (data[ip_phys + 2] << 8)
        r = _do_alu(alu_id, cpu, cpu.regs[0], imm, 16)
        if r is not None:
            cpu.regs[0] = r & 0xFFFF
        return 3

    # ModRM-based (subop 0-3)
    ml, mod, reg, rm, disp = decode_modrm(data, ip_phys + 1)
    width = 8 if (subop & 1) == 0 else 16

    if subop <= 1:  # r/m, r
        dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
        src = cpu.get_reg8(reg) if width == 8 else cpu.regs[reg]
        r = _do_alu(alu_id, cpu, dst, src, width)
        if r is not None:
            _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, r)
    else:  # r, r/m
        dst = cpu.get_reg8(reg) if width == 8 else cpu.regs[reg]
        src = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
        r = _do_alu(alu_id, cpu, dst, src, width)
        if r is not None:
            if width == 8:
                cpu.set_reg8(reg, r)
            else:
                cpu.regs[reg] = r & 0xFFFF

    return 1 + ml


def _exec_grp1(op, cpu, mem, seg_override, ip_phys):
    data = mem.data
    ml, mod, reg, rm, disp = decode_modrm(data, ip_phys + 1)
    alu_id = _GRP1_OPS[reg]

    if op in (0x80, 0x82):  # r/m8, imm8
        dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 8)
        imm = data[ip_phys + 1 + ml]
        r = _do_alu(alu_id, cpu, dst, imm, 8)
        if r is not None:
            _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 8, r)
        return 1 + ml + 1

    if op == 0x81:  # r/m16, imm16
        dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 16)
        pos = ip_phys + 1 + ml
        imm = data[pos] | (data[pos + 1] << 8)
        r = _do_alu(alu_id, cpu, dst, imm, 16)
        if r is not None:
            _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 16, r)
        return 1 + ml + 2

    # 0x83: r/m16, sign-extended imm8
    dst = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 16)
    b = data[ip_phys + 1 + ml]
    imm = (b if b < 0x80 else b - 0x100) & 0xFFFF
    r = _do_alu(alu_id, cpu, dst, imm, 16)
    if r is not None:
        _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 16, r)
    return 1 + ml + 1


def _exec_grp2(op, cpu, mem, seg_override, ip_phys):
    data = mem.data
    ml, mod, reg, rm, disp = decode_modrm(data, ip_phys + 1)

    if op in (0xD0, 0xD1):
        count = 1
        extra = 0
    elif op in (0xD2, 0xD3):
        count = cpu.get_reg8(1) & 0x1F
        extra = 0
    else:  # 0xC0, 0xC1
        count = data[ip_phys + 1 + ml] & 0x1F
        extra = 1

    width = 16 if (op & 1) else 8
    val = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)
    mask = 0xFFFF if width == 16 else 0xFF
    sign_bit = 0x8000 if width == 16 else 0x80

    for _ in range(count):
        if reg == _GRP2_SHL or reg == 6:  # SHL/SAL
            cpu.cf = 1 if val & sign_bit else 0
            val = (val << 1) & mask
        elif reg == _GRP2_SHR:
            cpu.cf = val & 1
            val = val >> 1
        elif reg == _GRP2_SAR:
            cpu.cf = val & 1
            sign = val & sign_bit
            val = (val >> 1) | sign
        elif reg == _GRP2_ROL:
            bit = (val >> (width - 1)) & 1
            val = ((val << 1) | bit) & mask
            cpu.cf = bit
        elif reg == _GRP2_ROR:
            bit = val & 1
            val = (bit << (width - 1)) | (val >> 1)
            cpu.cf = bit
        elif reg == _GRP2_RCL:
            bit = cpu.cf
            cpu.cf = (val >> (width - 1)) & 1
            val = ((val << 1) | bit) & mask
        elif reg == _GRP2_RCR:
            bit = cpu.cf
            cpu.cf = val & 1
            val = (bit << (width - 1)) | (val >> 1)

    if count > 0:
        cpu.zf = 1 if val == 0 else 0
        cpu.sf = 1 if val & sign_bit else 0
        cpu.pf = _PARITY_TABLE[val & 0xFF]

    _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, val)
    return 1 + ml + extra


def _exec_grp3(op, cpu, mem, seg_override, ip_phys):
    width = 8 if op == 0xF6 else 16
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    val = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, width)

    if reg in (0, 1):  # TEST r/m, imm
        if width == 8:
            imm = mem.data[ip_phys + 1 + ml]
            cpu.update_flags_logic(val & imm, 8)
            return 1 + ml + 1
        else:
            pos = ip_phys + 1 + ml
            imm = mem.data[pos] | (mem.data[pos + 1] << 8)
            cpu.update_flags_logic(val & imm, 16)
            return 1 + ml + 2

    if reg == 2:  # NOT
        mask = 0xFFFF if width == 16 else 0xFF
        _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, (~val) & mask)
        return 1 + ml

    if reg == 3:  # NEG
        r = cpu.update_flags_sub(0, val, width)
        cpu.cf = 0 if val == 0 else 1
        _set_rm_val(cpu, mem, mod, rm, disp, seg_override, width, r)
        return 1 + ml

    if reg == 4:  # MUL (unsigned)
        if width == 8:
            result = cpu.get_reg8(0) * val
            cpu.ax = result & 0xFFFF
            cpu.of = cpu.cf = 0 if (result >> 8) == 0 else 1
        else:
            result = cpu.regs[0] * val
            cpu.regs[0] = result & 0xFFFF
            cpu.regs[2] = (result >> 16) & 0xFFFF
            cpu.of = cpu.cf = 0 if cpu.regs[2] == 0 else 1
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
            a = cpu.regs[0]
            if a >= 0x8000: a -= 0x10000
            b = val
            if b >= 0x8000: b -= 0x10000
            result = a * b
            cpu.regs[0] = result & 0xFFFF
            cpu.regs[2] = (result >> 16) & 0xFFFF
            cpu.of = cpu.cf = 0 if -32768 <= result <= 32767 else 1
        return 1 + ml

    if reg == 6:  # DIV (unsigned)
        if width == 8:
            dividend = cpu.regs[0]
            if val == 0:
                raise RuntimeError("Division by zero (DIV byte)")
            cpu.set_reg8(0, (dividend // val) & 0xFF)
            cpu.set_reg8(4, (dividend % val) & 0xFF)
        else:
            dividend = (cpu.regs[2] << 16) | cpu.regs[0]
            if val == 0:
                raise RuntimeError("Division by zero (DIV word)")
            cpu.regs[0] = (dividend // val) & 0xFFFF
            cpu.regs[2] = (dividend % val) & 0xFFFF
        return 1 + ml

    if reg == 7:  # IDIV (signed)
        if width == 8:
            dividend = cpu.regs[0]
            if dividend >= 0x8000: dividend -= 0x10000
            divisor = val
            if divisor >= 0x80: divisor -= 0x100
            if divisor == 0:
                raise RuntimeError("Division by zero (IDIV byte)")
            q = int(dividend / divisor)
            r = dividend - q * divisor
            cpu.set_reg8(0, q & 0xFF)
            cpu.set_reg8(4, r & 0xFF)
        else:
            dividend = (cpu.regs[2] << 16) | cpu.regs[0]
            if dividend >= 0x80000000: dividend -= 0x100000000
            divisor = val
            if divisor >= 0x8000: divisor -= 0x10000
            if divisor == 0:
                raise RuntimeError("Division by zero (IDIV word)")
            q = int(dividend / divisor)
            r = dividend - q * divisor
            cpu.regs[0] = q & 0xFFFF
            cpu.regs[2] = r & 0xFFFF
        return 1 + ml

    return 1 + ml


def _exec_grp4(cpu, mem, seg_override, ip_phys):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    val = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 8)
    saved_cf = cpu.cf
    if reg == 0:
        r = cpu.update_flags_add(val, 1, 8)
    else:
        r = cpu.update_flags_sub(val, 1, 8)
    cpu.cf = saved_cf
    _set_rm_val(cpu, mem, mod, rm, disp, seg_override, 8, r)
    return 1 + ml


# -- Handlers (standard dispatcher signature) --------------------------------

def _h_alu_rm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    alu_id, subop = _ALU_INFO[op]
    return _exec_alu_group(subop, alu_id, cpu, mem, seg_override, ip_phys)


def _h_grp1(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return _exec_grp1(op, cpu, mem, seg_override, ip_phys)


def _h_grp2(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return _exec_grp2(op, cpu, mem, seg_override, ip_phys)


def _h_grp3(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return _exec_grp3(op, cpu, mem, seg_override, ip_phys)


def _h_grp4(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return _exec_grp4(cpu, mem, seg_override, ip_phys)


def _h_inc_r16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    idx = op - 0x40
    old = cpu.regs[idx]
    saved_cf = cpu.cf
    cpu.update_flags_add(old, 1, 16)
    cpu.cf = saved_cf
    cpu.regs[idx] = (old + 1) & 0xFFFF
    return 1


def _h_dec_r16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    idx = op - 0x48
    old = cpu.regs[idx]
    saved_cf = cpu.cf
    cpu.update_flags_sub(old, 1, 16)
    cpu.cf = saved_cf
    cpu.regs[idx] = (old - 1) & 0xFFFF
    return 1


def _h_cbw(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    al = cpu.regs[0] & 0xFF
    cpu.regs[0] = al if al < 0x80 else al | 0xFF00
    return 1


def _h_cwd(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[2] = 0xFFFF if cpu.regs[0] & 0x8000 else 0x0000
    return 1


def _h_test_al_imm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.update_flags_logic(cpu.get_reg8(0) & mem.data[ip_phys + 1], 8)
    return 2


def _h_test_ax_imm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.update_flags_logic(cpu.regs[0] & (mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8)), 16)
    return 3


def _h_test_rm8(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    a = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 8)
    cpu.update_flags_logic(a & cpu.get_reg8(reg), 8)
    return 1 + ml


def _h_test_rm16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    a = _get_rm_val(cpu, mem, mod, rm, disp, seg_override, 16)
    cpu.update_flags_logic(a & cpu.regs[reg], 16)
    return 1 + ml


# -- Registration ------------------------------------------------------------

# Opcodes in the 0x00-0x3D ALU range
_ALU_RM_OPCODES = set()
for _base, _ in _ALU_BASES:
    for _sub in range(6):
        _ALU_RM_OPCODES.add(_base + _sub)


def register(table):
    """Register ALU handlers into the dispatch table."""
    # ALU reg/mem (0x00-0x3D)
    for op in _ALU_RM_OPCODES:
        table[op] = _h_alu_rm
    # Group 1 immediate (0x80-0x83)
    for op in (0x80, 0x81, 0x82, 0x83):
        table[op] = _h_grp1
    # Group 2 shifts (0xD0-0xD3, 0xC0-0xC1)
    for op in (0xD0, 0xD1, 0xD2, 0xD3, 0xC0, 0xC1):
        table[op] = _h_grp2
    # Group 3 (0xF6-0xF7)
    table[0xF6] = _h_grp3
    table[0xF7] = _h_grp3
    # Group 4 INC/DEC byte (0xFE)
    table[0xFE] = _h_grp4
    # INC/DEC r16
    for op in range(0x40, 0x48):
        table[op] = _h_inc_r16
    for op in range(0x48, 0x50):
        table[op] = _h_dec_r16
    # CBW/CWD
    table[0x98] = _h_cbw
    table[0x99] = _h_cwd
    # TEST AL/AX, imm
    table[0xA8] = _h_test_al_imm
    table[0xA9] = _h_test_ax_imm
    # TEST r/m, r
    table[0x84] = _h_test_rm8
    table[0x85] = _h_test_rm16
