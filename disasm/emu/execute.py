"""Main instruction executor: dispatch loop, MOV, PUSH/POP, flow control."""

import struct
from .modrm import decode_modrm, compute_ea
from .fpu import exec_fpu_int, exec_fpu_native
from .interrupts import EmuExit
from . import alu as _alu_mod
from . import strings as _str_mod

# Segment prefix byte → segment register index (ES=0 CS=1 SS=2 DS=3)
_SEG_PFX = {0x26: 0, 0x2E: 1, 0x36: 2, 0x3E: 3}
_SEG_PFX_SET = frozenset(_SEG_PFX.keys()) | {0xF0, 0xF2, 0xF3}

# Condition codes (tuple for O(1) indexing)
_CC = (
    lambda c: c.of == 1,       # 0: JO
    lambda c: c.of == 0,       # 1: JNO
    lambda c: c.cf == 1,       # 2: JB/JC
    lambda c: c.cf == 0,       # 3: JNB/JNC
    lambda c: c.zf == 1,       # 4: JZ/JE
    lambda c: c.zf == 0,       # 5: JNZ/JNE
    lambda c: c.cf == 1 or c.zf == 1,  # 6: JBE/JNA
    lambda c: c.cf == 0 and c.zf == 0,  # 7: JA/JNBE
    lambda c: c.sf == 1,       # 8: JS
    lambda c: c.sf == 0,       # 9: JNS
    lambda c: c.pf == 1,       # A: JP
    lambda c: c.pf == 0,       # B: JNP
    lambda c: c.sf != c.of,    # C: JL
    lambda c: c.sf == c.of,    # D: JGE
    lambda c: c.zf == 1 or c.sf != c.of,  # E: JLE
    lambda c: c.zf == 0 and c.sf == c.of,  # F: JG
)

_SEG_PUSH_TABLE = {0x06: 0, 0x0E: 1, 0x16: 2, 0x1E: 3}
_SEG_POP_TABLE = {0x07: 0, 0x17: 2, 0x1F: 3}


def step(cpu, mem, ports, int_handler, hooks=None, trace=False):
    """Execute one instruction. Returns number of bytes consumed."""
    segs = cpu.segs
    data = mem.data
    ip_phys = ((segs[1] << 4) + cpu.ip) & 0xFFFFF

    if hooks and ip_phys in hooks:
        hooks[ip_phys](cpu, mem)

    seg_override = None
    rep_mode = 0
    pfx_len = 0
    b = data[ip_phys]
    while b in _SEG_PFX_SET:
        if b <= 0x3E:
            seg_override = _SEG_PFX[b]
        elif b == 0xF3:
            rep_mode = 1
        elif b == 0xF2:
            rep_mode = 2
        pfx_len += 1
        b = data[ip_phys + pfx_len]

    save_ip = cpu.ip
    cpu.ip = (cpu.ip + pfx_len) & 0xFFFF

    handler = _DISPATCH[b]
    if handler is None:
        raise RuntimeError(f"Unhandled opcode 0x{b:02X} at "
                           f"CS:IP={segs[1]:04X}:{cpu.ip:04X}")
    length = handler(b, cpu, mem, ip_phys + pfx_len, seg_override, rep_mode, ports, int_handler)

    total = pfx_len + length
    if cpu.ip == (save_ip + pfx_len) & 0xFFFF:
        cpu.ip = (save_ip + total) & 0xFFFF
    return total


def run_fast(cpu, mem, ports, int_handler, max_steps, hooks=None, bp_set=None,
             timer_period=0, scheduled_keys=None):
    """Tight execution loop — merges step+dispatch to avoid function call overhead.

    timer_period: if >0, fire INT 08h every N instructions (simulates hardware timer).
    scheduled_keys: dict of step_number → (scancode, ascii) for key injection.
    """
    segs = cpu.segs
    data = mem.data
    dispatch = _DISPATCH
    seg_pfx = _SEG_PFX
    seg_pfx_set = _SEG_PFX_SET
    has_hooks = hooks is not None and len(hooks) > 0
    has_bp = bp_set is not None and len(bp_set) > 0
    timer_counter = timer_period
    has_sched_keys = scheduled_keys is not None and len(scheduled_keys) > 0

    i = 0
    try:
        for i in range(max_steps):
            if cpu.halted:
                return 'halted', i

            # Hardware timer interrupt
            if timer_period and timer_counter <= 0:
                timer_counter = timer_period
                if cpu.intf:
                    vec_off = mem.read16(0x08 * 4)
                    vec_seg = mem.read16(0x08 * 4 + 2)
                    if vec_seg != 0 or vec_off != 0:
                        _push16(cpu, mem, cpu.get_flags())
                        _push16(cpu, mem, segs[1])
                        _push16(cpu, mem, cpu.ip)
                        segs[1] = vec_seg
                        cpu.ip = vec_off
            timer_counter -= 1

            # Scheduled key injection
            if has_sched_keys and i in scheduled_keys:
                sc, asc = scheduled_keys[i]
                int_handler.push_key(sc, asc)

            ip_phys = ((segs[1] << 4) + cpu.ip) & 0xFFFFF

            if has_hooks and ip_phys in hooks:
                hooks[ip_phys](cpu, mem)

            if has_bp and ip_phys in bp_set:
                return 'breakpoint', i

            seg_override = None
            rep_mode = 0
            pfx_len = 0
            b = data[ip_phys]
            while b in seg_pfx_set:
                if b <= 0x3E:
                    seg_override = seg_pfx[b]
                elif b == 0xF3:
                    rep_mode = 1
                elif b == 0xF2:
                    rep_mode = 2
                pfx_len += 1
                b = data[ip_phys + pfx_len]

            save_ip = cpu.ip
            cpu.ip = (cpu.ip + pfx_len) & 0xFFFF

            handler = dispatch[b]
            if handler is None:
                raise RuntimeError(f"Unhandled opcode 0x{b:02X} at "
                                   f"CS:IP={segs[1]:04X}:{cpu.ip:04X}")

            length = handler(b, cpu, mem, ip_phys + pfx_len, seg_override, rep_mode, ports, int_handler)

            total = pfx_len + length
            if cpu.ip == (save_ip + pfx_len) & 0xFFFF:
                cpu.ip = (save_ip + total) & 0xFFFF

        return 'max_steps', max_steps

    except EmuExit as e:
        return 'exit', e.code
    except Exception as e:
        return 'error', e


# -- Stack helpers -----------------------------------------------------------

def _push16(cpu, mem, val):
    sp = (cpu.regs[4] - 2) & 0xFFFF
    cpu.regs[4] = sp
    addr = ((cpu.segs[2] << 4) + sp) & 0xFFFFF
    mem.data[addr] = val & 0xFF
    mem.data[addr + 1] = (val >> 8) & 0xFF


def _pop16(cpu, mem):
    sp = cpu.regs[4]
    addr = ((cpu.segs[2] << 4) + sp) & 0xFFFFF
    val = mem.data[addr] | (mem.data[addr + 1] << 8)
    cpu.regs[4] = (sp + 2) & 0xFFFF
    return val


def _sign8(b):
    return b if b < 0x80 else b - 0x100


def _sign16(w):
    return w if w < 0x8000 else w - 0x10000


# ---- MOV handlers (per-opcode, no if-chain) --------------------------------

def _h_mov88(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    # MOV r/m8, r8
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    val = cpu.get_reg8(reg)
    if mod == 3:
        cpu.set_reg8(rm, val)
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        mem.write8(phys, val)
    return 1 + ml

def _h_mov89(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    # MOV r/m16, r16
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    if mod == 3:
        cpu.regs[rm] = cpu.regs[reg]
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        mem.write16(phys, cpu.regs[reg])
    return 1 + ml

def _h_mov8A(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    # MOV r8, r/m8
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    if mod == 3:
        cpu.set_reg8(reg, cpu.get_reg8(rm))
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        cpu.set_reg8(reg, mem.read8(phys))
    return 1 + ml

def _h_mov8B(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    # MOV r16, r/m16
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    if mod == 3:
        cpu.regs[reg] = cpu.regs[rm]
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        cpu.regs[reg] = mem.read16(phys)
    return 1 + ml

def _h_mov8C(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    # MOV r/m16, Sreg
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    val = cpu.segs[reg & 3]
    if mod == 3:
        cpu.regs[rm] = val
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        mem.write16(phys, val)
    return 1 + ml

def _h_mov8E(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    # MOV Sreg, r/m16
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    if mod == 3:
        cpu.segs[reg & 3] = cpu.regs[rm]
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        cpu.segs[reg & 3] = mem.read16(phys)
    return 1 + ml


def _h_mov_acc(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    data = mem.data
    addr = data[ip_phys + 1] | (data[ip_phys + 2] << 8)
    seg = seg_override if seg_override is not None else 3
    phys = ((cpu.segs[seg] << 4) + addr) & 0xFFFFF
    if op == 0xA0:
        cpu.set_reg8(0, mem.read8(phys))
    elif op == 0xA1:
        cpu.regs[0] = mem.read16(phys)
    elif op == 0xA2:
        mem.write8(phys, cpu.get_reg8(0))
    elif op == 0xA3:
        mem.write16(phys, cpu.regs[0])
    return 3


def _h_mov_r8_imm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.set_reg8(op - 0xB0, mem.data[ip_phys + 1])
    return 2

def _h_mov_r16_imm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[op - 0xB8] = mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8)
    return 3

def _h_mov_imm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    data = mem.data
    ml, mod, reg, rm, disp = decode_modrm(data, ip_phys + 1)
    if op == 0xC6:  # MOV r/m8, imm8
        imm = data[ip_phys + 1 + ml]
        if mod == 3:
            cpu.set_reg8(rm, imm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write8(phys, imm)
        return 1 + ml + 1
    else:  # 0xC7: MOV r/m16, imm16
        pos = ip_phys + 1 + ml
        imm = data[pos] | (data[pos + 1] << 8)
        if mod == 3:
            cpu.regs[rm] = imm
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            mem.write16(phys, imm)
        return 1 + ml + 2


# ---- Segment push/pop, register push/pop ----------------------------------

def _h_push_seg(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    _push16(cpu, mem, cpu.segs[_SEG_PUSH_TABLE[op]])
    return 1

def _h_pop_seg(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.segs[_SEG_POP_TABLE[op]] = _pop16(cpu, mem)
    return 1

def _h_push_r16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    _push16(cpu, mem, cpu.regs[op - 0x50])
    return 1

def _h_pop_r16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[op - 0x58] = _pop16(cpu, mem)
    return 1

def _h_push_imm16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    _push16(cpu, mem, mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8))
    return 3

def _h_push_imm8(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    _push16(cpu, mem, _sign8(mem.data[ip_phys + 1]) & 0xFFFF)
    return 2

def _h_pusha(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    tmp = cpu.regs[4]
    for i in range(8):
        _push16(cpu, mem, cpu.regs[i] if i != 4 else tmp)
    return 1

def _h_popa(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    for i in range(7, -1, -1):
        v = _pop16(cpu, mem)
        if i != 4:
            cpu.regs[i] = v
    return 1


# ---- XCHG -----------------------------------------------------------------

def _h_xchg(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    width = 8 if op == 0x86 else 16
    if mod == 3:
        if width == 8:
            a, b = cpu.get_reg8(reg), cpu.get_reg8(rm)
            cpu.set_reg8(reg, b)
            cpu.set_reg8(rm, a)
        else:
            cpu.regs[reg], cpu.regs[rm] = cpu.regs[rm], cpu.regs[reg]
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        if width == 8:
            a = cpu.get_reg8(reg)
            b = mem.read8(phys)
            cpu.set_reg8(reg, b)
            mem.write8(phys, a)
        else:
            a = cpu.regs[reg]
            b = mem.read16(phys)
            cpu.regs[reg] = b
            mem.write16(phys, a)
    return 1 + ml

def _h_nop(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return 1

def _h_xchg_ax(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    idx = op - 0x90
    cpu.regs[0], cpu.regs[idx] = cpu.regs[idx], cpu.regs[0]
    return 1


# ---- LEA, LES, LDS, POP r/m -----------------------------------------------

def _h_lea(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    _, offset = compute_ea(cpu, mod, rm, disp, seg_override)
    cpu.regs[reg] = offset & 0xFFFF
    return 1 + ml

def _h_les_lds(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    cpu.regs[reg] = mem.read16(phys)
    cpu.segs[0 if op == 0xC4 else 3] = mem.read16(phys + 2)
    return 1 + ml

def _h_pop_rm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 1)
    val = _pop16(cpu, mem)
    if mod == 3:
        cpu.regs[rm] = val & 0xFFFF
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        mem.write16(phys, val)
    return 1 + ml


# ---- Jcc, 0F extended Jcc, MOVSX/MOVZX ------------------------------------

def _h_jcc_short(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    disp = _sign8(mem.data[ip_phys + 1])
    if _CC[op & 0xF](cpu):
        cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
    else:
        cpu.ip = (cpu.ip + 2) & 0xFFFF
    return 0

def _h_0f(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    op2 = mem.data[ip_phys + 1]
    if 0x80 <= op2 <= 0x8F:
        disp = _sign16(mem.data[ip_phys + 2] | (mem.data[ip_phys + 3] << 8))
        if _CC[op2 & 0xF](cpu):
            cpu.ip = (cpu.ip + 4 + disp) & 0xFFFF
        else:
            cpu.ip = (cpu.ip + 4) & 0xFFFF
        return 0
    if op2 in (0xB6, 0xB7, 0xBE, 0xBF):
        return _exec_movsx_zx(op2, cpu, mem, seg_override, ip_phys)
    return 2


# ---- CALL / JMP / RET -----------------------------------------------------

def _h_call_near(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    disp = _sign16(mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8))
    _push16(cpu, mem, (cpu.ip + 3) & 0xFFFF)
    cpu.ip = (cpu.ip + 3 + disp) & 0xFFFF
    return 0

def _h_jmp_near(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    disp = _sign16(mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8))
    cpu.ip = (cpu.ip + 3 + disp) & 0xFFFF
    return 0

def _h_jmp_short(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    disp = _sign8(mem.data[ip_phys + 1])
    cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
    return 0

def _h_call_far(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    off = mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8)
    seg = mem.data[ip_phys + 3] | (mem.data[ip_phys + 4] << 8)
    _push16(cpu, mem, cpu.segs[1])
    _push16(cpu, mem, (cpu.ip + 5) & 0xFFFF)
    cpu.segs[1] = seg
    cpu.ip = off
    return 0

def _h_jmp_far(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    off = mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8)
    seg = mem.data[ip_phys + 3] | (mem.data[ip_phys + 4] << 8)
    cpu.segs[1] = seg
    cpu.ip = off
    return 0

def _h_ret(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.ip = _pop16(cpu, mem)
    return 0

def _h_ret_imm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    n = mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8)
    cpu.ip = _pop16(cpu, mem)
    cpu.regs[4] = (cpu.regs[4] + n) & 0xFFFF
    return 0

def _h_retf(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.ip = _pop16(cpu, mem)
    cpu.segs[1] = _pop16(cpu, mem)
    return 0

def _h_retf_imm(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    n = mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8)
    cpu.ip = _pop16(cpu, mem)
    cpu.segs[1] = _pop16(cpu, mem)
    cpu.regs[4] = (cpu.regs[4] + n) & 0xFFFF
    return 0

def _h_grp5(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return _exec_grp5(cpu, mem, seg_override, ip_phys)


# ---- ENTER / LEAVE / PUSHF / POPF -----------------------------------------

def _h_enter(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    frame_size = mem.data[ip_phys + 1] | (mem.data[ip_phys + 2] << 8)
    nest = mem.data[ip_phys + 3]
    _push16(cpu, mem, cpu.regs[5])
    cpu.regs[5] = cpu.regs[4]
    if nest == 0:
        cpu.regs[4] = (cpu.regs[4] - frame_size) & 0xFFFF
    return 4

def _h_leave(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[4] = cpu.regs[5]
    cpu.regs[5] = _pop16(cpu, mem)
    return 1

def _h_pushf(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    _push16(cpu, mem, cpu.get_flags())
    return 1

def _h_popf(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.set_flags(_pop16(cpu, mem))
    return 1

def _h_sahf(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ah = cpu.get_reg8(4)
    cpu.cf = ah & 1
    cpu.pf = (ah >> 2) & 1
    cpu.af = (ah >> 4) & 1
    cpu.zf = (ah >> 6) & 1
    cpu.sf = (ah >> 7) & 1
    return 1

def _h_lahf(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.set_reg8(4, cpu.cf | 2 | (cpu.pf << 2) | (cpu.af << 4) | (cpu.zf << 6) | (cpu.sf << 7))
    return 1


# ---- INT / IRET -----------------------------------------------------------

def _h_int3(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    int_handler.handle(3)
    return 1

def _h_int(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    int_num = mem.data[ip_phys + 1]
    if 0x34 <= int_num <= 0x3E:
        return exec_fpu_int(cpu, mem, seg_override)
    cpu.ip = (cpu.ip + 2) & 0xFFFF
    if not int_handler.handle(int_num):
        _push16(cpu, mem, cpu.get_flags())
        _push16(cpu, mem, cpu.segs[1])
        _push16(cpu, mem, cpu.ip)
        vec_off = mem.read16(int_num * 4)
        vec_seg = mem.read16(int_num * 4 + 2)
        cpu.segs[1] = vec_seg
        cpu.ip = vec_off
    return 0

def _h_iret(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.ip = _pop16(cpu, mem)
    cpu.segs[1] = _pop16(cpu, mem)
    cpu.set_flags(_pop16(cpu, mem))
    return 0


# ---- I/O ------------------------------------------------------------------

def _h_in_imm8(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.set_reg8(0, ports.port_in(mem.data[ip_phys + 1]))
    return 2

def _h_in_imm16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[0] = ports.port_in(mem.data[ip_phys + 1]) & 0xFFFF
    return 2

def _h_out_imm8(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ports.port_out(mem.data[ip_phys + 1], cpu.get_reg8(0))
    return 2

def _h_out_imm16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ports.port_out(mem.data[ip_phys + 1], cpu.regs[0])
    return 2

def _h_in_dx8(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.set_reg8(0, ports.port_in(cpu.regs[2]))
    return 1

def _h_in_dx16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[0] = ports.port_in(cpu.regs[2]) & 0xFFFF
    return 1

def _h_out_dx8(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ports.port_out(cpu.regs[2], cpu.get_reg8(0))
    return 1

def _h_out_dx16(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    ports.port_out(cpu.regs[2], cpu.regs[0])
    return 1


# ---- LOOP / JCXZ ----------------------------------------------------------

def _h_loop(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[1] = cx = (cpu.regs[1] - 1) & 0xFFFF
    disp = _sign8(mem.data[ip_phys + 1])
    if cx != 0:
        cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
    else:
        cpu.ip = (cpu.ip + 2) & 0xFFFF
    return 0

def _h_loopnz(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[1] = cx = (cpu.regs[1] - 1) & 0xFFFF
    disp = _sign8(mem.data[ip_phys + 1])
    if cx != 0 and cpu.zf == 0:
        cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
    else:
        cpu.ip = (cpu.ip + 2) & 0xFFFF
    return 0

def _h_loopz(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.regs[1] = cx = (cpu.regs[1] - 1) & 0xFFFF
    disp = _sign8(mem.data[ip_phys + 1])
    if cx != 0 and cpu.zf == 1:
        cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
    else:
        cpu.ip = (cpu.ip + 2) & 0xFFFF
    return 0

def _h_jcxz(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    disp = _sign8(mem.data[ip_phys + 1])
    if cpu.regs[1] == 0:
        cpu.ip = (cpu.ip + 2 + disp) & 0xFFFF
    else:
        cpu.ip = (cpu.ip + 2) & 0xFFFF
    return 0


# ---- Flags / misc ----------------------------------------------------------

def _h_clc(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.cf = 0; return 1
def _h_stc(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.cf = 1; return 1
def _h_cmc(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.cf ^= 1; return 1
def _h_cld(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.df = 0; return 1
def _h_std(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.df = 1; return 1

def _h_fwait(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return 1

def _h_fpu(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return exec_fpu_native(op, cpu, mem, seg_override)

def _h_xlat(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    addr = ((cpu.segs[seg_override if seg_override is not None else 3] << 4) +
            ((cpu.regs[3] + (cpu.regs[0] & 0xFF)) & 0xFFFF)) & 0xFFFFF
    cpu.set_reg8(0, mem.read8(addr))
    return 1

def _h_hlt(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    cpu.halted = True; return 1

def _h_imul3(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return _exec_imul3(op, cpu, mem, seg_override, ip_phys)

def _h_into(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    if cpu.of: int_handler.handle(4)
    return 1

def _h_stub1(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return 1
def _h_stub2(op, cpu, mem, ip_phys, seg_override, rep_mode, ports, int_handler):
    return 2


# ---- Build dispatch table (256 entries) ----
_DISPATCH = [None] * 256

# ALU — registered from alu module (direct handlers, no exec_alu dispatch)
_alu_mod.register(_DISPATCH)

# String ops — registered from strings module
_str_mod.register(_DISPATCH)

# Segment push/pop
for _op in _SEG_PUSH_TABLE: _DISPATCH[_op] = _h_push_seg
for _op in _SEG_POP_TABLE: _DISPATCH[_op] = _h_pop_seg

# PUSH/POP r16
for _op in range(0x50, 0x58): _DISPATCH[_op] = _h_push_r16
for _op in range(0x58, 0x60): _DISPATCH[_op] = _h_pop_r16

_DISPATCH[0x68] = _h_push_imm16
_DISPATCH[0x6A] = _h_push_imm8
_DISPATCH[0x60] = _h_pusha
_DISPATCH[0x61] = _h_popa
_DISPATCH[0x86] = _h_xchg
_DISPATCH[0x87] = _h_xchg
_DISPATCH[0x90] = _h_nop
for _op in range(0x91, 0x98): _DISPATCH[_op] = _h_xchg_ax

# MOV (per-opcode handlers)
_DISPATCH[0x88] = _h_mov88
_DISPATCH[0x89] = _h_mov89
_DISPATCH[0x8A] = _h_mov8A
_DISPATCH[0x8B] = _h_mov8B
_DISPATCH[0x8C] = _h_mov8C
_DISPATCH[0x8E] = _h_mov8E
for _op in range(0xA0, 0xA4): _DISPATCH[_op] = _h_mov_acc
for _op in range(0xB0, 0xB8): _DISPATCH[_op] = _h_mov_r8_imm
for _op in range(0xB8, 0xC0): _DISPATCH[_op] = _h_mov_r16_imm
_DISPATCH[0xC6] = _h_mov_imm
_DISPATCH[0xC7] = _h_mov_imm

_DISPATCH[0x8D] = _h_lea
_DISPATCH[0xC4] = _h_les_lds
_DISPATCH[0xC5] = _h_les_lds
_DISPATCH[0x8F] = _h_pop_rm

# Jcc short
for _op in range(0x70, 0x80): _DISPATCH[_op] = _h_jcc_short

_DISPATCH[0x0F] = _h_0f
_DISPATCH[0xE8] = _h_call_near
_DISPATCH[0xE9] = _h_jmp_near
_DISPATCH[0xEB] = _h_jmp_short
_DISPATCH[0x9A] = _h_call_far
_DISPATCH[0xEA] = _h_jmp_far
_DISPATCH[0xC3] = _h_ret
_DISPATCH[0xC2] = _h_ret_imm
_DISPATCH[0xCB] = _h_retf
_DISPATCH[0xCA] = _h_retf_imm
_DISPATCH[0xFF] = _h_grp5

_DISPATCH[0xC8] = _h_enter
_DISPATCH[0xC9] = _h_leave
_DISPATCH[0x9C] = _h_pushf
_DISPATCH[0x9D] = _h_popf
_DISPATCH[0x9E] = _h_sahf
_DISPATCH[0x9F] = _h_lahf

_DISPATCH[0xCC] = _h_int3
_DISPATCH[0xCD] = _h_int
_DISPATCH[0xCF] = _h_iret

# I/O
_DISPATCH[0xE4] = _h_in_imm8
_DISPATCH[0xE5] = _h_in_imm16
_DISPATCH[0xE6] = _h_out_imm8
_DISPATCH[0xE7] = _h_out_imm16
_DISPATCH[0xEC] = _h_in_dx8
_DISPATCH[0xED] = _h_in_dx16
_DISPATCH[0xEE] = _h_out_dx8
_DISPATCH[0xEF] = _h_out_dx16

# Loop
_DISPATCH[0xE2] = _h_loop
_DISPATCH[0xE0] = _h_loopnz
_DISPATCH[0xE1] = _h_loopz
_DISPATCH[0xE3] = _h_jcxz

# Flags
_DISPATCH[0xF8] = _h_clc
_DISPATCH[0xF9] = _h_stc
_DISPATCH[0xF5] = _h_cmc
_DISPATCH[0xFC] = _h_cld
_DISPATCH[0xFD] = _h_std

_DISPATCH[0x9B] = _h_fwait
for _op in range(0xD8, 0xE0): _DISPATCH[_op] = _h_fpu
_DISPATCH[0xD7] = _h_xlat
_DISPATCH[0xF4] = _h_hlt
_DISPATCH[0x69] = _h_imul3
_DISPATCH[0x6B] = _h_imul3
_DISPATCH[0xCE] = _h_into

# Stubs
for _op in (0x27, 0x2F, 0x37, 0x3F): _DISPATCH[_op] = _h_stub1
_DISPATCH[0xD4] = _h_stub2
_DISPATCH[0xD5] = _h_stub2
_DISPATCH[0xFA] = _h_nop  # CLI
_DISPATCH[0xFB] = _h_nop  # STI

_DISPATCH = tuple(_DISPATCH)


# -- Instruction helpers ----------------------------------------------------

def _exec_grp5(cpu, mem, seg_override, ip_phys):
    """Group 5 (0xFF): INC/DEC/CALL near/CALL far/JMP near/JMP far/PUSH."""
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
        return cpu.regs[rm]
    phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
    return mem.read16(phys)


def _set_rm16(cpu, mem, mod, rm, disp, seg_override, val):
    if mod == 3:
        cpu.regs[rm] = val & 0xFFFF
    else:
        phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
        mem.write16(phys, val)


def _exec_imul3(op, cpu, mem, seg_override, ip_phys):
    data = mem.data
    ml, mod, reg, rm, disp = decode_modrm(data, ip_phys + 1)
    src = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
    if src >= 0x8000:
        src -= 0x10000
    if op == 0x69:
        pos = ip_phys + 1 + ml
        w = data[pos] | (data[pos + 1] << 8)
        imm = w if w < 0x8000 else w - 0x10000
        extra = 2
    else:  # 0x6B
        b = data[ip_phys + 1 + ml]
        imm = b if b < 0x80 else b - 0x100
        extra = 1
    result = src * imm
    cpu.regs[reg] = result & 0xFFFF
    cpu.of = cpu.cf = 0 if -32768 <= result <= 32767 else 1
    return 1 + ml + extra


def _exec_movsx_zx(op2, cpu, mem, seg_override, ip_phys):
    ml, mod, reg, rm, disp = decode_modrm(mem.data, ip_phys + 2)
    if op2 == 0xB6:  # MOVZX r16, r/m8
        if mod == 3:
            val = cpu.get_reg8(rm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            val = mem.read8(phys)
        cpu.regs[reg] = val
    elif op2 == 0xBE:  # MOVSX r16, r/m8
        if mod == 3:
            val = cpu.get_reg8(rm)
        else:
            phys, _ = compute_ea(cpu, mod, rm, disp, seg_override)
            val = mem.read8(phys)
        if val >= 0x80:
            val |= 0xFF00
        cpu.regs[reg] = val
    elif op2 == 0xB7:  # MOVZX r16, r/m16
        val = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        cpu.regs[reg] = val
    elif op2 == 0xBF:  # MOVSX r16, r/m16
        val = _get_rm16(cpu, mem, mod, rm, disp, seg_override)
        cpu.regs[reg] = val
    return 2 + ml
