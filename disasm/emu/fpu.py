"""x87 FPU instruction execution.

Handles both native ESC opcodes (D8-DF) and Borland INT 34h-3Dh sequences.
Uses instruction_set_x86._decode_fpu_int() for Borland sequences and
_fpu_op() to identify the operation, then executes on the CPU's FPU stack.
"""

import math
import struct
from .modrm import decode_modrm, compute_ea


def exec_fpu_int(cpu, mem, seg_override):
    """Execute Borland FPU INT 34h-3Dh sequence at current CS:IP.
    Returns instruction length (including the CD xx prefix)."""
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)
    int_num = mem.read8(ip_phys + 1)

    if int_num == 0x3D:  # FWAIT — no-op
        return 2

    if int_num == 0x3E:  # Register D9 form: CD 3E modrm 90
        d9_byte = mem.read8(ip_phys + 2)
        _exec_d9_reg(cpu, d9_byte)
        return 4

    # Normal ESC: CD 34..3C modrm [disp]
    _INT_TO_ESC = {
        0x34: 0xD8, 0x35: 0xD9, 0x36: 0xDA, 0x37: 0xDB,
        0x38: 0xDC, 0x39: 0xDD, 0x3A: 0xDE, 0x3B: 0xDF,
        0x3C: 0xD8,
    }
    base_op = _INT_TO_ESC[int_num]
    ds_seg = 3 if int_num == 0x3C else seg_override  # DS override for 0x3C

    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 2)
    _exec_esc(cpu, mem, base_op, mod, reg, rm, disp, ds_seg)
    return 2 + ml


def exec_fpu_native(op, cpu, mem, seg_override):
    """Execute native ESC opcode (D8-DF) at current CS:IP.
    Returns instruction length."""
    ip_phys = mem.phys(cpu.segs[1], cpu.ip)
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    _exec_esc(cpu, mem, op, mod, reg, rm, disp, seg_override)
    return 1 + ml


def _read_mem_float(mem, cpu, mod, rm, disp, seg_override, size):
    """Read float from memory. size: 32 or 64."""
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    if size == 32:
        return mem.read_float32(phys)
    return mem.read_float64(phys)


def _read_mem_int(mem, cpu, mod, rm, disp, seg_override, size):
    """Read integer from memory. size: 16 or 32."""
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    if size == 16:
        v = mem.read16(phys)
        return v if v < 0x8000 else v - 0x10000
    v = mem.read32(phys)
    return v if v < 0x80000000 else v - 0x100000000


def _write_mem_float(mem, cpu, mod, rm, disp, seg_override, size, val):
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    if size == 32:
        mem.write_float32(phys, val)
    else:
        mem.write_float64(phys, val)


def _write_mem_int(mem, cpu, mod, rm, disp, seg_override, size, val):
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    ival = int(round(val))
    if size == 16:
        mem.write16(phys, ival & 0xFFFF)
    elif size == 32:
        mem.write32(phys, ival & 0xFFFFFFFF)
    elif size == 64:
        # Write as two 32-bit words
        mem.write32(phys, ival & 0xFFFFFFFF)
        mem.write32(phys + 4, (ival >> 32) & 0xFFFFFFFF)


def _fpu_compare(cpu, a, b):
    """Set FPU status word condition codes for comparison a vs b."""
    if math.isnan(a) or math.isnan(b):
        cpu.fpu_sw = (cpu.fpu_sw & 0x38FF) | 0x4500  # C0=C2=C3=1 (unordered)
    elif a > b:
        cpu.fpu_sw = (cpu.fpu_sw & 0x38FF)  # C0=C2=C3=0
    elif a < b:
        cpu.fpu_sw = (cpu.fpu_sw & 0x38FF) | 0x0100  # C0=1
    else:
        cpu.fpu_sw = (cpu.fpu_sw & 0x38FF) | 0x4000  # C3=1 (equal)


def _exec_d9_reg(cpu, modrm_byte):
    """Execute D9 register-only forms (mod=3)."""
    rm = modrm_byte & 7
    if 0xC0 <= modrm_byte <= 0xC7:  # FLD ST(i)
        cpu.fpu_push(cpu.fpu_st(rm))
    elif 0xC8 <= modrm_byte <= 0xCF:  # FXCH ST(i)
        a, b = cpu.fpu_st(0), cpu.fpu_st(rm)
        cpu.fpu_set_st(0, b)
        cpu.fpu_set_st(rm, a)
    elif modrm_byte == 0xD0:  # FNOP
        pass
    elif modrm_byte == 0xE0:  # FCHS
        cpu.fpu_set_st(0, -cpu.fpu_st(0))
    elif modrm_byte == 0xE1:  # FABS
        cpu.fpu_set_st(0, abs(cpu.fpu_st(0)))
    elif modrm_byte == 0xE4:  # FTST
        _fpu_compare(cpu, cpu.fpu_st(0), 0.0)
    elif modrm_byte == 0xE8:  # FLD1
        cpu.fpu_push(1.0)
    elif modrm_byte == 0xE9:  # FLDL2T
        cpu.fpu_push(math.log2(10))
    elif modrm_byte == 0xEA:  # FLDL2E
        cpu.fpu_push(math.log2(math.e))
    elif modrm_byte == 0xEB:  # FLDPI
        cpu.fpu_push(math.pi)
    elif modrm_byte == 0xEC:  # FLDLG2
        cpu.fpu_push(math.log10(2))
    elif modrm_byte == 0xED:  # FLDLN2
        cpu.fpu_push(math.log(2))
    elif modrm_byte == 0xEE:  # FLDZ
        cpu.fpu_push(0.0)
    elif modrm_byte == 0xF0:  # F2XM1
        cpu.fpu_set_st(0, 2.0 ** cpu.fpu_st(0) - 1.0)
    elif modrm_byte == 0xF1:  # FYL2X
        val = cpu.fpu_st(1) * math.log2(cpu.fpu_st(0))
        cpu.fpu_pop()
        cpu.fpu_set_st(0, val)
    elif modrm_byte == 0xF2:  # FPTAN
        cpu.fpu_set_st(0, math.tan(cpu.fpu_st(0)))
        cpu.fpu_push(1.0)
    elif modrm_byte == 0xF3:  # FPATAN
        val = math.atan2(cpu.fpu_st(1), cpu.fpu_st(0))
        cpu.fpu_pop()
        cpu.fpu_set_st(0, val)
    elif modrm_byte == 0xFA:  # FSQRT
        cpu.fpu_set_st(0, math.sqrt(cpu.fpu_st(0)))
    elif modrm_byte == 0xFB:  # FSINCOS
        v = cpu.fpu_st(0)
        cpu.fpu_set_st(0, math.sin(v))
        cpu.fpu_push(math.cos(v))
    elif modrm_byte == 0xFC:  # FRNDINT
        cpu.fpu_set_st(0, float(round(cpu.fpu_st(0))))
    elif modrm_byte == 0xFD:  # FSCALE
        cpu.fpu_set_st(0, cpu.fpu_st(0) * (2.0 ** int(cpu.fpu_st(1))))
    elif modrm_byte == 0xFE:  # FSIN
        cpu.fpu_set_st(0, math.sin(cpu.fpu_st(0)))
    elif modrm_byte == 0xFF:  # FCOS
        cpu.fpu_set_st(0, math.cos(cpu.fpu_st(0)))


def _exec_esc(cpu, mem, base_op, mod, reg, rm, disp, seg_override):
    """Execute an x87 ESC instruction (D8-DF) given decoded ModR/M."""

    # -- D8: float32 arith / register arith ----------------------------------
    if base_op == 0xD8:
        ops = [lambda a, b: a+b, lambda a, b: a*b, None, None,
               lambda a, b: a-b, lambda a, b: b-a, lambda a, b: a/b, lambda a, b: b/a]
        if mod == 3:
            if reg in (2, 3):  # FCOM/FCOMP
                _fpu_compare(cpu, cpu.fpu_st(0), cpu.fpu_st(rm))
                if reg == 3:
                    cpu.fpu_pop()
            else:
                cpu.fpu_set_st(0, ops[reg](cpu.fpu_st(0), cpu.fpu_st(rm)))
        else:
            val = _read_mem_float(mem, cpu, mod, rm, disp, seg_override, 32)
            if reg in (2, 3):
                _fpu_compare(cpu, cpu.fpu_st(0), val)
                if reg == 3:
                    cpu.fpu_pop()
            else:
                cpu.fpu_set_st(0, ops[reg](cpu.fpu_st(0), val))

    # -- D9: load/store/misc ------------------------------------------------
    elif base_op == 0xD9:
        if mod == 3:
            _exec_d9_reg(cpu, (mod << 6) | (reg << 3) | rm)
        else:
            if reg == 0:  # FLD dword
                cpu.fpu_push(_read_mem_float(mem, cpu, mod, rm, disp, seg_override, 32))
            elif reg == 2:  # FST dword
                _write_mem_float(mem, cpu, mod, rm, disp, seg_override, 32, cpu.fpu_st(0))
            elif reg == 3:  # FSTP dword
                _write_mem_float(mem, cpu, mod, rm, disp, seg_override, 32, cpu.fpu_pop())
            elif reg == 5:  # FLDCW
                pass  # no-op
            elif reg == 7:  # FNSTCW
                phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
                mem.write16(phys, cpu.fpu_cw)

    # -- DA: integer arith dword / FUCOMPP -----------------------------------
    elif base_op == 0xDA:
        if mod == 3:
            if (mod << 6 | reg << 3 | rm) == 0xE9:  # FUCOMPP (DA E9)
                _fpu_compare(cpu, cpu.fpu_st(0), cpu.fpu_st(1))
                cpu.fpu_pop()
                cpu.fpu_pop()
        else:
            val = float(_read_mem_int(mem, cpu, mod, rm, disp, seg_override, 32))
            ops = [lambda a, b: a+b, lambda a, b: a*b, None, None,
                   lambda a, b: a-b, lambda a, b: b-a, lambda a, b: a/b, lambda a, b: b/a]
            if reg in (2, 3):
                _fpu_compare(cpu, cpu.fpu_st(0), val)
                if reg == 3:
                    cpu.fpu_pop()
            else:
                cpu.fpu_set_st(0, ops[reg](cpu.fpu_st(0), val))

    # -- DB: integer load/store dword / FCLEX/FINIT --------------------------
    elif base_op == 0xDB:
        if mod == 3:
            modrm_byte = (mod << 6) | (reg << 3) | rm
            if modrm_byte == 0xE2:  # FCLEX
                cpu.fpu_sw = 0
            elif modrm_byte == 0xE3:  # FINIT
                cpu.fpu_top = 0
                cpu.fpu_sw = 0
                cpu.fpu_cw = 0x037F
                cpu.fpu_stack = [0.0] * 8
        else:
            if reg == 0:  # FILD dword
                cpu.fpu_push(float(_read_mem_int(mem, cpu, mod, rm, disp, seg_override, 32)))
            elif reg == 2:  # FIST dword
                _write_mem_int(mem, cpu, mod, rm, disp, seg_override, 32, cpu.fpu_st(0))
            elif reg == 3:  # FISTP dword
                _write_mem_int(mem, cpu, mod, rm, disp, seg_override, 32, cpu.fpu_pop())
            elif reg == 5:  # FLD tword (80-bit) — approximate with float64
                phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
                # Read 10 bytes, interpret as 80-bit extended
                raw = mem.read_bytes(phys, 10)
                val = _decode_float80(raw)
                cpu.fpu_push(val)
            elif reg == 7:  # FSTP tword — approximate
                phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
                _encode_float80(mem, phys, cpu.fpu_pop())

    # -- DC: float64 arith / reverse register arith --------------------------
    elif base_op == 0xDC:
        if mod == 3:
            rev = {0: lambda a, b: a+b, 1: lambda a, b: a*b,
                   4: lambda a, b: b-a, 5: lambda a, b: a-b,
                   6: lambda a, b: b/a, 7: lambda a, b: a/b}
            if reg in rev:
                cpu.fpu_set_st(rm, rev[reg](cpu.fpu_st(rm), cpu.fpu_st(0)))
        else:
            val = _read_mem_float(mem, cpu, mod, rm, disp, seg_override, 64)
            ops = [lambda a, b: a+b, lambda a, b: a*b, None, None,
                   lambda a, b: a-b, lambda a, b: b-a, lambda a, b: a/b, lambda a, b: b/a]
            if reg in (2, 3):
                _fpu_compare(cpu, cpu.fpu_st(0), val)
                if reg == 3:
                    cpu.fpu_pop()
            else:
                cpu.fpu_set_st(0, ops[reg](cpu.fpu_st(0), val))

    # -- DD: float64 load/store / FFREE/FUCOM --------------------------------
    elif base_op == 0xDD:
        if mod == 3:
            modrm_byte = (mod << 6) | (reg << 3) | rm
            if 0xD0 <= modrm_byte <= 0xD7:  # FST ST(i)
                cpu.fpu_set_st(rm, cpu.fpu_st(0))
            elif 0xD8 <= modrm_byte <= 0xDF:  # FSTP ST(i)
                cpu.fpu_set_st(rm, cpu.fpu_st(0))
                cpu.fpu_pop()
            elif 0xE0 <= modrm_byte <= 0xE7:  # FUCOM ST(i)
                _fpu_compare(cpu, cpu.fpu_st(0), cpu.fpu_st(rm))
            elif 0xE8 <= modrm_byte <= 0xEF:  # FUCOMP ST(i)
                _fpu_compare(cpu, cpu.fpu_st(0), cpu.fpu_st(rm))
                cpu.fpu_pop()
        else:
            if reg == 0:  # FLD qword
                cpu.fpu_push(_read_mem_float(mem, cpu, mod, rm, disp, seg_override, 64))
            elif reg == 2:  # FST qword
                _write_mem_float(mem, cpu, mod, rm, disp, seg_override, 64, cpu.fpu_st(0))
            elif reg == 3:  # FSTP qword
                _write_mem_float(mem, cpu, mod, rm, disp, seg_override, 64, cpu.fpu_pop())
            elif reg == 7:  # FNSTSW mem
                phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
                mem.write16(phys, cpu.fpu_sw)

    # -- DE: integer arith word / FCOMPP / pop register arith ----------------
    elif base_op == 0xDE:
        if mod == 3:
            modrm_byte = (mod << 6) | (reg << 3) | rm
            if modrm_byte == 0xD9:  # FCOMPP
                _fpu_compare(cpu, cpu.fpu_st(0), cpu.fpu_st(1))
                cpu.fpu_pop()
                cpu.fpu_pop()
            elif reg == 0:  # FADDP
                cpu.fpu_set_st(rm, cpu.fpu_st(rm) + cpu.fpu_st(0))
                cpu.fpu_pop()
            elif reg == 1:  # FMULP
                cpu.fpu_set_st(rm, cpu.fpu_st(rm) * cpu.fpu_st(0))
                cpu.fpu_pop()
            elif reg == 4:  # FSUBRP
                cpu.fpu_set_st(rm, cpu.fpu_st(0) - cpu.fpu_st(rm))
                cpu.fpu_pop()
            elif reg == 5:  # FSUBP
                cpu.fpu_set_st(rm, cpu.fpu_st(rm) - cpu.fpu_st(0))
                cpu.fpu_pop()
            elif reg == 6:  # FDIVRP
                cpu.fpu_set_st(rm, cpu.fpu_st(0) / cpu.fpu_st(rm))
                cpu.fpu_pop()
            elif reg == 7:  # FDIVP
                cpu.fpu_set_st(rm, cpu.fpu_st(rm) / cpu.fpu_st(0))
                cpu.fpu_pop()
        else:
            val = float(_read_mem_int(mem, cpu, mod, rm, disp, seg_override, 16))
            ops = [lambda a, b: a+b, lambda a, b: a*b, None, None,
                   lambda a, b: a-b, lambda a, b: b-a, lambda a, b: a/b, lambda a, b: b/a]
            if reg in (2, 3):
                _fpu_compare(cpu, cpu.fpu_st(0), val)
                if reg == 3:
                    cpu.fpu_pop()
            else:
                cpu.fpu_set_st(0, ops[reg](cpu.fpu_st(0), val))

    # -- DF: FILD/FIST/FISTP word + FNSTSW AX + FILD/FISTP qword -----------
    elif base_op == 0xDF:
        if mod == 3:
            modrm_byte = (mod << 6) | (reg << 3) | rm
            if modrm_byte == 0xE0:  # FNSTSW AX
                cpu.ax = cpu.fpu_sw
        else:
            if reg == 0:  # FILD word
                cpu.fpu_push(float(_read_mem_int(mem, cpu, mod, rm, disp, seg_override, 16)))
            elif reg == 2:  # FIST word
                _write_mem_int(mem, cpu, mod, rm, disp, seg_override, 16, cpu.fpu_st(0))
            elif reg == 3:  # FISTP word
                _write_mem_int(mem, cpu, mod, rm, disp, seg_override, 16, cpu.fpu_pop())
            elif reg == 5:  # FILD qword
                phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
                lo = mem.read32(phys)
                hi = mem.read32(phys + 4)
                val = lo | (hi << 32)
                if val >= (1 << 63):
                    val -= (1 << 64)
                cpu.fpu_push(float(val))
            elif reg == 7:  # FISTP qword
                _write_mem_int(mem, cpu, mod, rm, disp, seg_override, 64, cpu.fpu_pop())


def _decode_float80(raw):
    """Decode 80-bit x87 extended precision to Python float (approximate)."""
    if len(raw) < 10:
        return 0.0
    sign = (raw[9] >> 7) & 1
    exp = ((raw[9] & 0x7F) << 8) | raw[8]
    mantissa = int.from_bytes(raw[0:8], 'little')
    if exp == 0 and mantissa == 0:
        return 0.0
    if exp == 0x7FFF:
        return float('inf') if sign == 0 else float('-inf')
    # Bias is 16383
    val = mantissa / (1 << 63) * (2.0 ** (exp - 16383))
    return -val if sign else val


def _encode_float80(mem, phys, val):
    """Encode Python float as 80-bit extended precision (approximate)."""
    # Simple: just write as float64 in the first 8 bytes, fill rest
    mem.write_float64(phys, val)
    mem.write16(phys + 8, 0)
