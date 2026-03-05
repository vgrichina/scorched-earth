"""Main instruction executor: dispatch loop, MOV, PUSH/POP, flow control, string ops."""

import struct
from .modrm import decode_modrm, compute_ea
from .alu import exec_alu, ALU_OPCODES
from .fpu import exec_fpu_int, exec_fpu_native
from .interrupts import EmuExit
from .strings import exec_string

# Segment prefix byte → segment register index (ES=0 CS=1 SS=2 DS=3)
_SEG_PFX = {0x26: 0, 0x2E: 1, 0x36: 2, 0x3E: 3}

# Condition code evaluation: Jcc opcode low nibble → lambda(cpu) → bool
_SEG_PUSH_TABLE = {0x06: 0, 0x0E: 1, 0x16: 2, 0x1E: 3}
_SEG_POP_TABLE = {0x07: 0, 0x17: 2, 0x1F: 3}
_FLAG_OPS_TABLE = {0xF8: 'clc', 0xF9: 'stc', 0xFA: 'cli', 0xFB: 'sti',
                   0xFC: 'cld', 0xFD: 'std', 0xF5: 'cmc'}
_STRING_OPS = frozenset((0xA4, 0xA5, 0xA6, 0xA7, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF))

_CC = {
    0x0: lambda c: c.of == 1,       # JO
    0x1: lambda c: c.of == 0,       # JNO
    0x2: lambda c: c.cf == 1,       # JB/JC
    0x3: lambda c: c.cf == 0,       # JNB/JNC
    0x4: lambda c: c.zf == 1,       # JZ/JE
    0x5: lambda c: c.zf == 0,       # JNZ/JNE
    0x6: lambda c: c.cf == 1 or c.zf == 1,  # JBE/JNA
    0x7: lambda c: c.cf == 0 and c.zf == 0,  # JA/JNBE
    0x8: lambda c: c.sf == 1,       # JS
    0x9: lambda c: c.sf == 0,       # JNS
    0xA: lambda c: c.pf == 1,       # JP
    0xB: lambda c: c.pf == 0,       # JNP
    0xC: lambda c: c.sf != c.of,    # JL
    0xD: lambda c: c.sf == c.of,    # JGE
    0xE: lambda c: c.zf == 1 or c.sf != c.of,  # JLE
    0xF: lambda c: c.zf == 0 and c.sf == c.of,  # JG
}


def step(cpu, mem, ports, int_handler, hooks=None, trace=False):
    """Execute one instruction. Returns number of bytes consumed (IP already advanced)."""
    segs = cpu.segs
    data = mem.data
    ip_phys = ((segs[1] << 4) + cpu.ip) & 0xFFFFF

    # Check hooks
    if hooks and ip_phys in hooks:
        hooks[ip_phys](cpu, mem)

    # Consume prefixes — read directly from data[] (code is never in VGA range)
    seg_override = None
    rep_mode = 0  # 0=none, 1=REP/REPE, 2=REPNE
    pfx_len = 0
    while True:
        b = data[ip_phys + pfx_len]
        if b in _SEG_PFX:
            seg_override = _SEG_PFX[b]
            pfx_len += 1
        elif b == 0xF0:  # LOCK
            pfx_len += 1
        elif b == 0xF3:  # REP/REPE
            rep_mode = 1
            pfx_len += 1
        elif b == 0xF2:  # REPNE
            rep_mode = 2
            pfx_len += 1
        else:
            break

    op = data[ip_phys + pfx_len]
    save_ip = cpu.ip
    cpu.ip = (cpu.ip + pfx_len) & 0xFFFF

    length = _dispatch(op, cpu, mem, ports, int_handler, seg_override, rep_mode, trace)
    total = pfx_len + length
    # Advance IP (if not already changed by a jump/call/ret)
    if cpu.ip == (save_ip + pfx_len) & 0xFFFF:
        cpu.ip = (save_ip + total) & 0xFFFF
    return total


def _push16(cpu, mem, val):
    cpu.sp = (cpu.sp - 2) & 0xFFFF
    addr = ((cpu.segs[2] << 4) + cpu.sp) & 0xFFFFF
    mem.data[addr] = val & 0xFF
    mem.data[addr + 1] = (val >> 8) & 0xFF


def _pop16(cpu, mem):
    addr = ((cpu.segs[2] << 4) + cpu.sp) & 0xFFFFF
    val = mem.data[addr] | (mem.data[addr + 1] << 8)
    cpu.sp = (cpu.sp + 2) & 0xFFFF
    return val


def _dispatch(op, cpu, mem, ports, int_handler, seg_override, rep_mode, trace):
    """Dispatch single opcode. Returns instruction byte length (excluding prefixes)."""
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF

    # ---- ALU range (delegated, guarded) ----
    if op in ALU_OPCODES:
        return exec_alu(op, cpu, mem, seg_override)

    # ---- PUSH/POP segment: 06/07/0E/16/17/1E/1F ----
    _SEG_PUSH = _SEG_PUSH_TABLE
    _SEG_POP = _SEG_POP_TABLE
    if op in _SEG_PUSH:
        _push16(cpu, mem, cpu.segs[_SEG_PUSH[op]])
        return 1
    if op in _SEG_POP:
        cpu.segs[_SEG_POP[op]] = _pop16(cpu, mem)
        return 1

    # ---- PUSH/POP r16: 0x50-0x5F ----
    if 0x50 <= op <= 0x57:
        _push16(cpu, mem, cpu.regs[op - 0x50])
        return 1
    if 0x58 <= op <= 0x5F:
        cpu.regs[op - 0x58] = _pop16(cpu, mem)
        return 1

    # ---- PUSH imm: 0x68 (imm16), 0x6A (imm8 sign-extended) ----
    if op == 0x68:
        _push16(cpu, mem, mem.read16(ip_phys + 1))
        return 3
    if op == 0x6A:
        val = struct.unpack_from('b', mem.data, ip_phys + 1)[0]
        _push16(cpu, mem, val & 0xFFFF)
        return 2

    # ---- PUSHA/POPA: 0x60/0x61 ----
    if op == 0x60:
        tmp = cpu.sp
        for i in range(8):
            _push16(cpu, mem, cpu.regs[i] if i != 4 else tmp)
        return 1
    if op == 0x61:
        for i in range(7, -1, -1):
            v = _pop16(cpu, mem)
            if i != 4:  # skip SP
                cpu.regs[i] = v
        return 1

    # ---- XCHG: 0x86-0x87, 0x90-0x97 ----
    if op == 0x86 or op == 0x87:
        return _exec_xchg(op, cpu, mem, seg_override)
    if op == 0x90:
        return 1  # NOP
    if 0x91 <= op <= 0x97:
        idx = op - 0x90
        cpu.regs[0], cpu.regs[idx] = cpu.regs[idx], cpu.regs[0]
        return 1

    # ---- MOV: 0x88-0x8E, 0xA0-0xA3, 0xB0-0xBF, 0xC6-0xC7 ----
    if 0x88 <= op <= 0x8C or op == 0x8E:
        return _exec_mov_modrm(op, cpu, mem, seg_override)
    if 0xA0 <= op <= 0xA3:
        return _exec_mov_acc_mem(op, cpu, mem, seg_override)
    if 0xB0 <= op <= 0xB7:
        cpu.set_reg8(op - 0xB0, mem.read8(ip_phys + 1))
        return 2
    if 0xB8 <= op <= 0xBF:
        cpu.set_reg16(op - 0xB8, mem.read16(ip_phys + 1))
        return 3
    if op == 0xC6 or op == 0xC7:
        return _exec_mov_imm(op, cpu, mem, seg_override)

    # ---- LEA: 0x8D ----
    if op == 0x8D:
        ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
        _, offset = compute_ea(cpu, mod, rm, disp, seg_override)
        cpu.set_reg16(reg, offset)
        return 1 + ml

    # ---- LES/LDS: 0xC4/0xC5 ----
    if op == 0xC4 or op == 0xC5:
        ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        cpu.set_reg16(reg, mem.read16(phys))
        seg_idx = 0 if op == 0xC4 else 3  # ES or DS
        cpu.segs[seg_idx] = mem.read16(phys + 2)
        return 1 + ml

    # ---- POP r/m: 0x8F ----
    if op == 0x8F:
        ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
        val = _pop16(cpu, mem)
        if mod == 3:
            cpu.set_reg16(rm, val)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write16(phys, val)
        return 1 + ml

    # ---- Jcc short: 0x70-0x7F ----
    if 0x70 <= op <= 0x7F:
        disp = struct.unpack_from('b', mem.data, ip_phys + 1)[0]
        if _CC[op & 0xF](cpu):
            cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
        else:
            cpu.ip = (cpu.ip + 2) & 0xFFFF
        return 0  # IP already set

    # ---- Jcc near (0F 80-8F): ----
    if op == 0x0F:
        op2 = mem.read8(ip_phys + 1)
        if 0x80 <= op2 <= 0x8F:
            disp = struct.unpack_from('<h', mem.data, ip_phys + 2)[0]
            if _CC[op2 & 0xF](cpu):
                cpu.ip = (cpu.ip + 4 + disp) & 0xFFFF
            else:
                cpu.ip = (cpu.ip + 4) & 0xFFFF
            return 0
        # MOVSX/MOVZX (0F B6/B7/BE/BF)
        if op2 in (0xB6, 0xB7, 0xBE, 0xBF):
            return _exec_movsx_zx(op2, cpu, mem, seg_override)
        # Unknown 0F — skip 2 bytes
        return 2

    # ---- JMP/CALL/RET ----
    if op == 0xE8:  # CALL near rel16
        disp = struct.unpack_from('<h', mem.data, ip_phys + 1)[0]
        _push16(cpu, mem, (cpu.ip + 3) & 0xFFFF)
        cpu.ip = (cpu.ip + 3 + disp) & 0xFFFF
        return 0
    if op == 0xE9:  # JMP near rel16
        disp = struct.unpack_from('<h', mem.data, ip_phys + 1)[0]
        cpu.ip = (cpu.ip + 3 + disp) & 0xFFFF
        return 0
    if op == 0xEB:  # JMP short rel8
        disp = struct.unpack_from('b', mem.data, ip_phys + 1)[0]
        cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
        return 0
    if op == 0x9A:  # CALL FAR seg:off
        off = mem.read16(ip_phys + 1)
        seg = mem.read16(ip_phys + 3)
        _push16(cpu, mem, cpu.segs[1])  # push CS
        _push16(cpu, mem, (cpu.ip + 5) & 0xFFFF)  # push next IP
        cpu.segs[1] = seg
        cpu.ip = off
        return 0
    if op == 0xEA:  # JMP FAR seg:off
        off = mem.read16(ip_phys + 1)
        seg = mem.read16(ip_phys + 3)
        cpu.segs[1] = seg
        cpu.ip = off
        return 0
    if op == 0xC3:  # RET
        cpu.ip = _pop16(cpu, mem)
        return 0
    if op == 0xC2:  # RET imm16
        n = mem.read16(ip_phys + 1)
        cpu.ip = _pop16(cpu, mem)
        cpu.sp = (cpu.sp + n) & 0xFFFF
        return 0
    if op == 0xCB:  # RETF
        cpu.ip = _pop16(cpu, mem)
        cpu.segs[1] = _pop16(cpu, mem)
        return 0
    if op == 0xCA:  # RETF imm16
        n = mem.read16(ip_phys + 1)
        cpu.ip = _pop16(cpu, mem)
        cpu.segs[1] = _pop16(cpu, mem)
        cpu.sp = (cpu.sp + n) & 0xFFFF
        return 0

    # ---- Group 5 (0xFF): INC/DEC/CALL/JMP/PUSH ----
    if op == 0xFF:
        return _exec_grp5(cpu, mem, seg_override)

    # ---- ENTER/LEAVE: 0xC8/0xC9 ----
    if op == 0xC8:  # ENTER imm16, imm8
        frame_size = mem.read16(ip_phys + 1)
        nest = mem.read8(ip_phys + 3)
        _push16(cpu, mem, cpu.bp)
        cpu.bp = cpu.sp
        if nest == 0:
            cpu.sp = (cpu.sp - frame_size) & 0xFFFF
        return 4
    if op == 0xC9:  # LEAVE
        cpu.sp = cpu.bp
        cpu.bp = _pop16(cpu, mem)
        return 1

    # ---- PUSHF/POPF: 0x9C/0x9D ----
    if op == 0x9C:
        _push16(cpu, mem, cpu.get_flags())
        return 1
    if op == 0x9D:
        cpu.set_flags(_pop16(cpu, mem))
        return 1

    # ---- SAHF/LAHF: 0x9E/0x9F ----
    if op == 0x9E:  # SAHF: load AH into flags
        ah = cpu.get_reg8(4)
        cpu.cf = (ah >> 0) & 1
        cpu.pf = (ah >> 2) & 1
        cpu.af = (ah >> 4) & 1
        cpu.zf = (ah >> 6) & 1
        cpu.sf = (ah >> 7) & 1
        return 1
    if op == 0x9F:  # LAHF
        val = (cpu.cf | (1 << 1) | (cpu.pf << 2) | (cpu.af << 4)
               | (cpu.zf << 6) | (cpu.sf << 7))
        cpu.set_reg8(4, val)
        return 1

    # ---- INT: 0xCC/0xCD/0xCF ----
    if op == 0xCC:  # INT 3
        int_handler.handle(3)
        return 1
    if op == 0xCD:
        int_num = mem.read8(ip_phys + 1)
        # Borland FPU: INT 34h-3Dh
        if 0x34 <= int_num <= 0x3E:
            return exec_fpu_int(cpu, mem, seg_override)
        # Software interrupt
        cpu.ip = (cpu.ip + 2) & 0xFFFF  # advance past INT xx before handling
        if not int_handler.handle(int_num):
            # Chain to IVT: push flags, CS, IP; jump to vector
            _push16(cpu, mem, cpu.get_flags())
            _push16(cpu, mem, cpu.segs[1])
            _push16(cpu, mem, cpu.ip)
            vec_off = mem.read16(int_num * 4)
            vec_seg = mem.read16(int_num * 4 + 2)
            cpu.segs[1] = vec_seg
            cpu.ip = vec_off
        return 0
    if op == 0xCF:  # IRET
        cpu.ip = _pop16(cpu, mem)
        cpu.segs[1] = _pop16(cpu, mem)
        cpu.set_flags(_pop16(cpu, mem))
        return 0

    # ---- String ops: 0xA4-0xAF ----
    if op in _STRING_OPS:
        return exec_string(op, cpu, mem, seg_override, rep_mode)

    # ---- IN/OUT: 0xE4-0xE7, 0xEC-0xEF ----
    if op == 0xE4:
        cpu.set_reg8(0, ports.port_in(mem.read8(ip_phys + 1)))
        return 2
    if op == 0xE5:
        cpu.ax = ports.port_in(mem.read8(ip_phys + 1))
        return 2
    if op == 0xE6:
        ports.port_out(mem.read8(ip_phys + 1), cpu.get_reg8(0))
        return 2
    if op == 0xE7:
        ports.port_out(mem.read8(ip_phys + 1), cpu.ax)
        return 2
    if op == 0xEC:
        cpu.set_reg8(0, ports.port_in(cpu.dx))
        return 1
    if op == 0xED:
        cpu.ax = ports.port_in(cpu.dx)
        return 1
    if op == 0xEE:
        ports.port_out(cpu.dx, cpu.get_reg8(0))
        return 1
    if op == 0xEF:
        ports.port_out(cpu.dx, cpu.ax)
        return 1

    # ---- LOOP/JCXZ: 0xE0-0xE3 ----
    if op == 0xE2:  # LOOP
        cpu.cx = (cpu.cx - 1) & 0xFFFF
        disp = struct.unpack_from('b', mem.data, ip_phys + 1)[0]
        if cpu.cx != 0:
            cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
        else:
            cpu.ip = (cpu.ip + 2) & 0xFFFF
        return 0
    if op == 0xE0:  # LOOPNZ
        cpu.cx = (cpu.cx - 1) & 0xFFFF
        disp = struct.unpack_from('b', mem.data, ip_phys + 1)[0]
        if cpu.cx != 0 and cpu.zf == 0:
            cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
        else:
            cpu.ip = (cpu.ip + 2) & 0xFFFF
        return 0
    if op == 0xE1:  # LOOPZ
        cpu.cx = (cpu.cx - 1) & 0xFFFF
        disp = struct.unpack_from('b', mem.data, ip_phys + 1)[0]
        if cpu.cx != 0 and cpu.zf == 1:
            cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
        else:
            cpu.ip = (cpu.ip + 2) & 0xFFFF
        return 0
    if op == 0xE3:  # JCXZ
        disp = struct.unpack_from('b', mem.data, ip_phys + 1)[0]
        if cpu.cx == 0:
            cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
        else:
            cpu.ip = (cpu.ip + 2) & 0xFFFF
        return 0

    # ---- Flag ops ----
    if op in _FLAG_OPS_TABLE:
        name = _FLAG_OPS_TABLE[op]
        if name == 'clc': cpu.cf = 0
        elif name == 'stc': cpu.cf = 1
        elif name == 'cmc': cpu.cf ^= 1
        elif name == 'cld': cpu.df = 0
        elif name == 'std': cpu.df = 1
        return 1

    # ---- FWAIT: 0x9B ----
    if op == 0x9B:
        return 1

    # ---- Native FPU: 0xD8-0xDF ----
    if 0xD8 <= op <= 0xDF:
        return exec_fpu_native(op, cpu, mem, seg_override)

    # ---- XLAT: 0xD7 ----
    if op == 0xD7:
        addr = ((cpu.segs[seg_override if seg_override is not None else 3] << 4) +
                ((cpu.bx + cpu.get_reg8(0)) & 0xFFFF)) & 0xFFFFF
        cpu.set_reg8(0, mem.read8(addr))
        return 1

    # ---- HLT: 0xF4 ----
    if op == 0xF4:
        cpu.halted = True
        return 1

    # ---- IMUL r16, r/m16, imm: 0x69/0x6B ----
    if op == 0x69 or op == 0x6B:
        return _exec_imul3(op, cpu, mem, seg_override)

    # ---- INTO: 0xCE ----
    if op == 0xCE:
        if cpu.of:
            int_handler.handle(4)
        return 1

    # ---- AAM/AAD/DAA/DAS/AAA/AAS: rarely used, minimal stubs ----
    if op in (0x27, 0x2F, 0x37, 0x3F, 0xD4, 0xD5):
        return 2 if op in (0xD4, 0xD5) else 1

    raise RuntimeError(f"Unhandled opcode 0x{op:02X} at "
                       f"CS:IP={cpu.segs[1]:04X}:{cpu.ip:04X} "
                       f"(file 0x{ip_phys:05X})")


# -- Instruction helpers ----------------------------------------------------

def _exec_mov_modrm(op, cpu, mem, seg_override):
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)

    if op == 0x88:  # MOV r/m8, r8
        val = cpu.get_reg8(reg)
        if mod == 3:
            cpu.set_reg8(rm, val)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write8(phys, val)
    elif op == 0x89:  # MOV r/m16, r16
        val = cpu.get_reg16(reg)
        if mod == 3:
            cpu.set_reg16(rm, val)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write16(phys, val)
    elif op == 0x8A:  # MOV r8, r/m8
        if mod == 3:
            cpu.set_reg8(reg, cpu.get_reg8(rm))
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            cpu.set_reg8(reg, mem.read8(phys))
    elif op == 0x8B:  # MOV r16, r/m16
        if mod == 3:
            cpu.set_reg16(reg, cpu.get_reg16(rm))
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            cpu.set_reg16(reg, mem.read16(phys))
    elif op == 0x8C:  # MOV r/m16, Sreg
        val = cpu.segs[reg & 3]
        if mod == 3:
            cpu.set_reg16(rm, val)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write16(phys, val)
    elif op == 0x8E:  # MOV Sreg, r/m16
        if mod == 3:
            cpu.segs[reg & 3] = cpu.get_reg16(rm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            cpu.segs[reg & 3] = mem.read16(phys)
    return 1 + ml


def _exec_mov_acc_mem(op, cpu, mem, seg_override):
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
    addr = mem.read16(ip_phys + 1)
    seg = seg_override if seg_override is not None else 3  # DS default
    phys = ((cpu.segs[seg] << 4) + addr) & 0xFFFFF
    if op == 0xA0:
        cpu.set_reg8(0, mem.read8(phys))
    elif op == 0xA1:
        cpu.ax = mem.read16(phys)
    elif op == 0xA2:
        mem.write8(phys, cpu.get_reg8(0))
    elif op == 0xA3:
        mem.write16(phys, cpu.ax)
    return 3


def _exec_mov_imm(op, cpu, mem, seg_override):
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    if op == 0xC6:  # MOV r/m8, imm8
        imm = mem.read8(ip_phys + 1 + ml)
        if mod == 3:
            cpu.set_reg8(rm, imm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write8(phys, imm)
        return 1 + ml + 1
    else:  # 0xC7: MOV r/m16, imm16
        imm = mem.read16(ip_phys + 1 + ml)
        if mod == 3:
            cpu.set_reg16(rm, imm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write16(phys, imm)
        return 1 + ml + 2


def _exec_xchg(op, cpu, mem, seg_override):
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    width = 8 if op == 0x86 else 16
    if mod == 3:
        if width == 8:
            a, b = cpu.get_reg8(reg), cpu.get_reg8(rm)
            cpu.set_reg8(reg, b)
            cpu.set_reg8(rm, a)
        else:
            a, b = cpu.get_reg16(reg), cpu.get_reg16(rm)
            cpu.set_reg16(reg, b)
            cpu.set_reg16(rm, a)
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        if width == 8:
            a = cpu.get_reg8(reg)
            b = mem.read8(phys)
            cpu.set_reg8(reg, b)
            mem.write8(phys, a)
        else:
            a = cpu.get_reg16(reg)
            b = mem.read16(phys)
            cpu.set_reg16(reg, b)
            mem.write16(phys, a)
    return 1 + ml


def _exec_grp5(cpu, mem, seg_override):
    """Group 5 (0xFF): INC/DEC/CALL near/CALL far/JMP near/JMP far/PUSH."""
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)

    if reg == 0:  # INC word
        val = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        saved_cf = cpu.cf
        r = cpu.update_flags_add(val, 1, 16)
        cpu.cf = saved_cf
        _set_rm16(cpu, mem, mod, rm, disp, seg_override, r)
        return 1 + ml
    if reg == 1:  # DEC word
        val = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        saved_cf = cpu.cf
        r = cpu.update_flags_sub(val, 1, 16)
        cpu.cf = saved_cf
        _set_rm16(cpu, mem, mod, rm, disp, seg_override, r)
        return 1 + ml
    if reg == 2:  # CALL near indirect
        target = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        _push16(cpu, mem, (cpu.ip + 1 + ml) & 0xFFFF)
        cpu.ip = target
        return 0
    if reg == 3:  # CALL far indirect
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        off = mem.read16(phys)
        seg = mem.read16(phys + 2)
        _push16(cpu, mem, cpu.segs[1])
        _push16(cpu, mem, (cpu.ip + 1 + ml) & 0xFFFF)
        cpu.segs[1] = seg
        cpu.ip = off
        return 0
    if reg == 4:  # JMP near indirect
        cpu.ip = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        return 0
    if reg == 5:  # JMP far indirect
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        cpu.ip = mem.read16(phys)
        cpu.segs[1] = mem.read16(phys + 2)
        return 0
    if reg == 6:  # PUSH r/m16
        _push16(cpu, mem, _get_rm16(cpu, mem, mod, rm, disp, seg_override))
        return 1 + ml
    return 1 + ml


def _get_rm16(cpu, mem, mod, rm, disp, seg_override):
    if mod == 3:
        return cpu.get_reg16(rm)
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    return mem.read16(phys)


def _set_rm16(cpu, mem, mod, rm, disp, seg_override, val):
    if mod == 3:
        cpu.set_reg16(rm, val)
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        mem.write16(phys, val)


def _exec_imul3(op, cpu, mem, seg_override):
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    src = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
    if src >= 0x8000:
        src -= 0x10000
    if op == 0x69:
        imm = struct.unpack_from('<h', mem.data, ip_phys + 1 + ml)[0]
        extra = 2
    else:  # 0x6B
        imm = struct.unpack_from('b', mem.data, ip_phys + 1 + ml)[0]
        extra = 1
    result = src * imm
    cpu.set_reg16(reg, result & 0xFFFF)
    cpu.of = cpu.cf = 0 if -32768 <= result <= 32767 else 1
    return 1 + ml + extra


def _exec_movsx_zx(op2, cpu, mem, seg_override):
    ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 2)
    if op2 == 0xB6:  # MOVZX r16, r/m8
        if mod == 3:
            val = cpu.get_reg8(rm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            val = mem.read8(phys)
        cpu.set_reg16(reg, val)
    elif op2 == 0xBE:  # MOVSX r16, r/m8
        if mod == 3:
            val = cpu.get_reg8(rm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            val = mem.read8(phys)
        if val >= 0x80:
            val |= 0xFF00
        cpu.set_reg16(reg, val)
    elif op2 == 0xB7:  # MOVZX r16, r/m16 (no-op extend)
        val = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        cpu.set_reg16(reg, val)
    elif op2 == 0xBF:  # MOVSX r16, r/m16 (no-op sign extend for 16→16)
        val = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        cpu.set_reg16(reg, val)
    return 2 + ml
