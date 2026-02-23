#!/usr/bin/env python3
"""
x86 16-bit real-mode instruction decoder for Scorched Earth v1.50 (DOS/Borland C++ 1993).

Features:
  - All common x86 16-bit instructions (complete ModRM decoding)
  - Borland FPU emulation: INT 34h-3Eh decoded to x87 mnemonics (no subprocess needed)
  - Group 1/2/3/4/5 via ModRM /reg field
  - Segment override / REP / LOCK prefixes
  - Intel syntax output
  - No external dependencies (pure Python stdlib)

API:
    decode(data, pos, labels=None)
        -> (length, mnemonic, op_str, is_fpu, ds_ref)

    data     : bytes or bytearray (full EXE file)
    pos      : file offset to decode from
    labels   : optional dict {file_offset: name} for jump/call target annotation

    Returns:
      length   : int — bytes consumed (including any prefix bytes)
      mnemonic : str — instruction name (lowercase Intel)
      op_str   : str — formatted operands
      is_fpu   : bool — True if this decoded as an x87 FPU instruction
      ds_ref   : int or None — DS offset if instruction directly addresses DS memory
"""

import struct

# MZ header size for SCORCH.EXE — used to convert far-call seg:off → file offset
_MZ_HEADER = 0x6A00

# ---------------------------------------------------------------------------
# Register tables
# ---------------------------------------------------------------------------

R8  = ['al',  'cl',  'dl',  'bl',  'ah',  'ch',  'dh',  'bh' ]
R16 = ['ax',  'cx',  'dx',  'bx',  'sp',  'bp',  'si',  'di' ]
SEG = ['es',  'cs',  'ss',  'ds'                              ]
ST  = [f'st({i})' for i in range(8)]

# 16-bit ModRM base expressions (mod 0/1/2); None = direct disp16 (rm=6 mod=0)
_MEM16 = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', None, 'bx']

# ---------------------------------------------------------------------------
# ModRM / EA decoder
# ---------------------------------------------------------------------------

def _parse_ea(data, pos, seg_pfx=''):
    """
    Parse ModRM byte at data[pos] for 16-bit addressing.
    Returns (modrm_total_bytes, ea_str_or_None, mod, reg, rm).
    ea_str is None when mod=3 (register operand, caller uses R8/R16).
    modrm_total_bytes includes the ModRM byte itself plus any displacement.
    """
    if pos >= len(data):
        return 1, '[??]', 0, 0, 0
    modrm = data[pos]
    mod = (modrm >> 6) & 3
    reg = (modrm >> 3) & 7
    rm  = modrm & 7
    sp  = f'{seg_pfx}:' if seg_pfx else ''

    if mod == 3:
        return 1, None, mod, reg, rm

    # For mod=0 rm=6: direct [disp16]; for mod=1/2 rm=6: [bp + disp]
    base = _MEM16[rm] if (mod != 0 or rm != 6) else None
    if base is None and mod != 0:
        base = 'bp'

    if mod == 0 and rm == 6:                          # [disp16]
        if pos + 2 >= len(data):
            return 3, f'[{sp}??]', mod, reg, rm
        disp = struct.unpack_from('<H', data, pos+1)[0]
        return 3, f'[{sp}0x{disp:04X}]', mod, reg, rm

    if mod == 0:
        return 1, f'[{sp}{base}]', mod, reg, rm

    if mod == 1:                                       # [base + disp8]
        if pos + 1 >= len(data):
            return 2, f'[{sp}{base}+??]', mod, reg, rm
        d = struct.unpack_from('b', data, pos+1)[0]
        if d == 0:
            ea = f'[{sp}{base}]'
        elif d > 0:
            ea = f'[{sp}{base}+0x{d:02X}]'
        else:
            ea = f'[{sp}{base}-0x{(-d):02X}]'
        return 2, ea, mod, reg, rm

    # mod == 2: [base + disp16]
    if pos + 2 >= len(data):
        return 3, f'[{sp}{base}+??]', mod, reg, rm
    d = struct.unpack_from('<h', data, pos+1)[0]
    if d == 0:
        ea = f'[{sp}{base}]'
    elif d > 0:
        ea = f'[{sp}{base}+0x{d:04X}]'
    else:
        ea = f'[{sp}{base}-0x{(-d):04X}]'
    return 3, ea, mod, reg, rm


def _get_ds_ref(data, pos, seg_pfx=''):
    """Return the DS offset if ModRM at pos is a direct [disp16] reference, else None."""
    if pos >= len(data):
        return None
    modrm = data[pos]
    mod = (modrm >> 6) & 3
    rm  = modrm & 7
    if mod == 0 and rm == 6 and not seg_pfx:
        if pos + 2 < len(data):
            return struct.unpack_from('<H', data, pos+1)[0]
    return None


# ---------------------------------------------------------------------------
# FPU decoder (x87 ESC opcodes D8-DF, via Borland INT 34h-3Eh emulation)
# ---------------------------------------------------------------------------

# D9 register-only forms (mod=3): modrm byte -> (mnemonic, operand)
_D9_REG_OPS = {
    0xD0: ('fnop',    ''),
    0xE0: ('fchs',    ''),     0xE1: ('fabs',    ''),
    0xE4: ('ftst',    ''),     0xE5: ('fxam',    ''),
    0xE8: ('fld1',    ''),     0xE9: ('fldl2t',  ''),
    0xEA: ('fldl2e',  ''),     0xEB: ('fldpi',   ''),
    0xEC: ('fldlg2',  ''),     0xED: ('fldln2',  ''),
    0xEE: ('fldz',    ''),
    0xF0: ('f2xm1',   ''),     0xF1: ('fyl2x',   ''),
    0xF2: ('fptan',   ''),     0xF3: ('fpatan',  ''),
    0xF4: ('fxtract', ''),     0xF5: ('fprem1',  ''),
    0xF6: ('fdecstp', ''),     0xF7: ('fincstp', ''),
    0xF8: ('fprem',   ''),     0xF9: ('fyl2xp1', ''),
    0xFA: ('fsqrt',   ''),     0xFB: ('fsincos', ''),
    0xFC: ('frndint', ''),     0xFD: ('fscale',  ''),
    0xFE: ('fsin',    ''),     0xFF: ('fcos',    ''),
}


def _d9_reg(byte2):
    """Decode a D9 mod=3 byte (the modrm byte with mod=3 already known)."""
    rm = byte2 & 7
    if 0xC0 <= byte2 <= 0xC7:  return 'fld',  ST[rm]
    if 0xC8 <= byte2 <= 0xCF:  return 'fxch', ST[rm]
    return _D9_REG_OPS.get(byte2, (f'db 0xD9, 0x{byte2:02X}', ''))


def _fpu_op(base_op, mod, reg, rm, ea):
    """
    Build (mnemonic, operands) for x87 ESC byte base_op (0xD8-0xDF)
    given a decoded ModRM (mod, reg, rm, ea).
    ea is None for mod=3, otherwise the memory EA string.
    """
    stN = ST[rm]
    modrm_byte = (mod << 6) | (reg << 3) | rm

    # ---- D8 ---------------------------------------------------------------
    if base_op == 0xD8:
        ops = ('fadd','fmul','fcom','fcomp','fsub','fsubr','fdiv','fdivr')
        if mod == 3:
            mn = ops[reg]
            return (mn, stN) if reg in (2, 3) else (mn, f'st(0), {stN}')
        return ops[reg], f'dword {ea}'

    # ---- D9 ---------------------------------------------------------------
    if base_op == 0xD9:
        if mod == 3:
            return _d9_reg(modrm_byte)
        mem_ops = ('fld', None, 'fst', 'fstp', 'fldenv', 'fldcw', 'fnstenv', 'fnstcw')
        mn = mem_ops[reg]
        if mn is None:
            return f'db 0xD9, 0x{modrm_byte:02X}', ''
        sz = {0:'dword ', 2:'dword ', 3:'dword '}.get(reg, '')
        return mn, f'{sz}{ea}'

    # ---- DA ---------------------------------------------------------------
    if base_op == 0xDA:
        if mod == 3:
            if modrm_byte == 0xE9: return 'fucompp', ''
            return f'db 0xDA, 0x{modrm_byte:02X}', ''
        ops = ('fiadd','fimul','ficom','ficomp','fisub','fisubr','fidiv','fidivr')
        return ops[reg], f'dword {ea}'

    # ---- DB ---------------------------------------------------------------
    if base_op == 0xDB:
        if mod == 3:
            if modrm_byte == 0xE2: return 'fclex',  ''
            if modrm_byte == 0xE3: return 'finit',  ''
            if modrm_byte == 0xE4: return 'fsetpm', ''
            return f'db 0xDB, 0x{modrm_byte:02X}', ''
        mem_ops = ('fild', None, 'fist', 'fistp', None, 'fld', None, 'fstp')
        mn = mem_ops[reg]
        if mn is None:
            return f'db 0xDB, 0x{modrm_byte:02X}', ''
        sz = 'tword ' if reg in (5, 7) else 'dword '
        return mn, f'{sz}{ea}'

    # ---- DC ---------------------------------------------------------------
    if base_op == 0xDC:
        if mod == 3:
            rev = {0:'fadd', 1:'fmul', 4:'fsubr', 5:'fsub', 6:'fdivr', 7:'fdiv'}
            mn = rev.get(reg)
            if mn:
                return mn, f'{stN}, st(0)'
            return f'db 0xDC, 0x{modrm_byte:02X}', ''
        ops = ('fadd','fmul','fcom','fcomp','fsub','fsubr','fdiv','fdivr')
        return ops[reg], f'qword {ea}'

    # ---- DD ---------------------------------------------------------------
    if base_op == 0xDD:
        if mod == 3:
            if 0xC0 <= modrm_byte <= 0xC7: return 'ffree',  stN
            if 0xD0 <= modrm_byte <= 0xD7: return 'fst',    stN
            if 0xD8 <= modrm_byte <= 0xDF: return 'fstp',   stN
            if 0xE0 <= modrm_byte <= 0xE7: return 'fucom',  stN
            if 0xE8 <= modrm_byte <= 0xEF: return 'fucomp', stN
            return f'db 0xDD, 0x{modrm_byte:02X}', ''
        mem_ops = ('fld', None, 'fst', 'fstp', 'frstor', None, 'fsave', 'fnstsw')
        mn = mem_ops[reg]
        if mn is None:
            return f'db 0xDD, 0x{modrm_byte:02X}', ''
        sz = 'qword ' if reg in (0, 2, 3) else ''
        return mn, f'{sz}{ea}'

    # ---- DE ---------------------------------------------------------------
    if base_op == 0xDE:
        if mod == 3:
            if modrm_byte == 0xD9:           return 'fcompp', ''
            if 0xC0 <= modrm_byte <= 0xC7:   return 'faddp',  f'{stN}, st(0)'
            if 0xC8 <= modrm_byte <= 0xCF:   return 'fmulp',  f'{stN}, st(0)'
            if 0xE0 <= modrm_byte <= 0xE7:   return 'fsubrp', f'{stN}, st(0)'
            if 0xE8 <= modrm_byte <= 0xEF:   return 'fsubp',  f'{stN}, st(0)'
            if 0xF0 <= modrm_byte <= 0xF7:   return 'fdivrp', f'{stN}, st(0)'
            if 0xF8 <= modrm_byte <= 0xFF:   return 'fdivp',  f'{stN}, st(0)'
            return f'db 0xDE, 0x{modrm_byte:02X}', ''
        ops = ('fiadd','fimul','ficom','ficomp','fisub','fisubr','fidiv','fidivr')
        return ops[reg], f'word {ea}'

    # ---- DF ---------------------------------------------------------------
    if base_op == 0xDF:
        if mod == 3:
            if modrm_byte == 0xE0: return 'fnstsw', 'ax'
            return f'db 0xDF, 0x{modrm_byte:02X}', ''
        mem_ops = ('fild', None, 'fist', 'fistp', None, 'fild', None, 'fistp')
        mn = mem_ops[reg]
        if mn is None:
            return f'db 0xDF, 0x{modrm_byte:02X}', ''
        sz = 'qword ' if reg in (5, 7) else 'word '
        return mn, f'{sz}{ea}'

    return f'db 0x{base_op:02X}', ''


def _decode_fpu_int(data, pos):
    """
    Decode a Borland FPU emulation INT sequence: CD xx [modrm [disp]].
    Returns (length, mnemonic, op_str, ds_ref) or None if not FPU.
    ds_ref is set when the instruction directly addresses [DS:disp16].
    """
    if pos + 1 >= len(data) or data[pos] != 0xCD:
        return None
    int_num = data[pos + 1]
    if not (0x34 <= int_num <= 0x3E):
        return None

    # FWAIT: CD 3D
    if int_num == 0x3D:
        return 2, 'fwait', '', None

    # Register D9 form: CD 3E modrm 90  (always mod=3, e.g. D9 E8 = fld1)
    if int_num == 0x3E:
        if pos + 2 >= len(data):
            return 2, 'db', f'0xCD, 0x3E ; truncated', None
        d9_byte = data[pos + 2]
        mn, op = _d9_reg(d9_byte)
        return 4, mn, op, None

    # Normal ESC: CD 34..3C modrm [disp]
    INT_TO_ESC = {
        0x34: 0xD8, 0x35: 0xD9, 0x36: 0xDA, 0x37: 0xDB,
        0x38: 0xDC, 0x39: 0xDD, 0x3A: 0xDE, 0x3B: 0xDF,
        0x3C: 0xD8,  # DS: segment override variant
    }
    seg_pfx = 'ds' if int_num == 0x3C else ''
    base_op = INT_TO_ESC[int_num]

    if pos + 2 >= len(data):
        return 2, 'db', f'0xCD, 0x{int_num:02X} ; truncated', None

    modrm_len, ea, mod, reg, rm = _parse_ea(data, pos + 2, seg_pfx)
    total = 2 + modrm_len

    # Extract DS reference for annotation
    ds_ref = None
    if mod == 0 and rm == 6 and not seg_pfx:
        if pos + 4 < len(data):
            ds_ref = struct.unpack_from('<H', data, pos + 3)[0]

    if mod == 3:
        # Register operand: ea is None, use R8/R16 based on opcode
        mn, op = _fpu_op(base_op, mod, reg, rm, None)
    else:
        mn, op = _fpu_op(base_op, mod, reg, rm, ea)

    return total, mn, op, ds_ref


# ---------------------------------------------------------------------------
# Main x86 16-bit decoder
# ---------------------------------------------------------------------------

# Group 1: opcode 0x80-0x83 — /reg selects operation
_GRP1 = ('add','or','adc','sbb','and','sub','xor','cmp')

# Group 2: shift/rotate — /reg selects operation
_GRP2 = ('rol','ror','rcl','rcr','shl','shr','sal','sar')

# Group 3: 0xF6/0xF7 — /reg selects operation
_GRP3 = ('test','test','not','neg','mul','imul','div','idiv')

# Group 5: 0xFF — /reg selects operation
_GRP5 = ('inc','dec','call','call far','jmp','jmp far','push','??')


def _lbl(addr, labels, default_fmt):
    """Return label name for addr if known, else format with default_fmt."""
    if labels and addr in labels:
        return labels[addr]
    return default_fmt % addr


def decode(data, pos, labels=None):
    """
    Decode one x86 16-bit instruction at data[pos].

    data   : full EXE bytes (file offset = array index)
    pos    : file offset
    labels : optional dict {file_offset: name} for jump/call annotation

    Returns (length, mnemonic, op_str, is_fpu, ds_ref):
      length   : bytes consumed
      mnemonic : lowercase Intel mnemonic string
      op_str   : operands string (may be empty)
      is_fpu   : bool
      ds_ref   : int DS offset if direct DS memory reference, else None
    """
    if pos >= len(data):
        return 1, 'db', '0x00 ; <eof>', False, None

    # ------------------------------------------------------------------
    # 1. Consume prefix bytes
    # ------------------------------------------------------------------
    seg_pfx = ''
    rep_pfx = ''
    pfx_len = 0
    start   = pos

    while pos < len(data):
        b = data[pos]
        if b == 0x26:   seg_pfx = 'es'; pos += 1; pfx_len += 1
        elif b == 0x2E: seg_pfx = 'cs'; pos += 1; pfx_len += 1
        elif b == 0x36: seg_pfx = 'ss'; pos += 1; pfx_len += 1
        elif b == 0x3E: seg_pfx = 'ds'; pos += 1; pfx_len += 1
        elif b == 0xF0: rep_pfx = 'lock ';  pos += 1; pfx_len += 1
        elif b == 0xF2: rep_pfx = 'repne '; pos += 1; pfx_len += 1
        elif b == 0xF3: rep_pfx = 'rep ';   pos += 1; pfx_len += 1
        else:
            break

    if pos >= len(data):
        return pfx_len + 1, 'db', f'0x{data[start]:02X} ; prefix at eof', False, None

    op = data[pos]

    # ------------------------------------------------------------------
    # 2. Check for Borland FPU INT emulation (CD 34..3E)
    # ------------------------------------------------------------------
    if op == 0xCD and pos + 1 < len(data):
        fpu = _decode_fpu_int(data, pos)
        if fpu is not None:
            fpu_len, mn, op_str, ds_ref = fpu
            return pfx_len + fpu_len, mn, op_str, True, ds_ref

    # ------------------------------------------------------------------
    # 3. Helper: shorthand for ModRM-based instructions
    # ------------------------------------------------------------------
    def modrm_at(p):
        return _parse_ea(data, p, seg_pfx)

    def ds_ref_at(p):
        return _get_ds_ref(data, p, seg_pfx)

    def rel8_target(instr_end):
        if pos + 1 >= len(data): return pos + 2
        d = struct.unpack_from('b', data, pos + 1)[0]
        return start + pfx_len + 1 + 1 + d  # file offset of target

    def rel16_target(instr_end):
        if pos + 2 >= len(data): return pos + 3
        d = struct.unpack_from('<h', data, pos + 1)[0]
        return start + pfx_len + 1 + 2 + d

    def imm8():
        if pos + 1 >= len(data): return 0
        return data[pos + 1]

    def imm16():
        if pos + 2 >= len(data): return 0
        return struct.unpack_from('<H', data, pos + 1)[0]

    def simm16():
        if pos + 2 >= len(data): return 0
        return struct.unpack_from('<h', data, pos + 1)[0]

    # ------------------------------------------------------------------
    # 4. Decode by opcode
    # ------------------------------------------------------------------

    # ---- 0x00-0x05: ADD -----------------------------------------------
    if op == 0x00:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'add', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x01:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'add', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x02:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'add', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x03:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'add', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x04:
        return 2+pfx_len, 'add', f'al, 0x{imm8():02X}', False, None
    if op == 0x05:
        return 3+pfx_len, 'add', f'ax, 0x{imm16():04X}', False, None

    if op == 0x06: return 1+pfx_len, 'push', 'es', False, None
    if op == 0x07: return 1+pfx_len, 'pop',  'es', False, None

    # ---- 0x08-0x0D: OR -----------------------------------------------
    if op == 0x08:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'or', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x09:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'or', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x0A:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'or', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x0B:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'or', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x0C: return 2+pfx_len, 'or', f'al, 0x{imm8():02X}', False, None
    if op == 0x0D: return 3+pfx_len, 'or', f'ax, 0x{imm16():04X}', False, None

    if op == 0x0E: return 1+pfx_len, 'push', 'cs', False, None

    # 0x0F: two-byte escape — common 80286+ forms
    if op == 0x0F:
        if pos + 1 < len(data):
            op2 = data[pos+1]
            # Jcc near (0F 80..8F)
            if 0x80 <= op2 <= 0x8F:
                _JCC = ('jo','jno','jb','jnb','jz','jnz','jbe','ja',
                        'js','jns','jp','jnp','jl','jge','jle','jg')
                tgt = start + pfx_len + 2 + 2 + struct.unpack_from('<h', data, pos+2)[0]
                return 4+pfx_len, _JCC[op2-0x80], _lbl(tgt, labels, '0x%05X'), False, None
            # PUSH/POP FS/GS, movsx/movzx, etc — just show raw for now
            ml, ea, mod, reg, rm = modrm_at(pos+2) if pos+2 < len(data) else (1,'[??]',0,0,0)
            return 2+ml+pfx_len, f'db 0x0F,0x{op2:02X}', '', False, None
        return 2+pfx_len, 'db', '0x0F', False, None

    # ---- 0x10-0x15: ADC -----------------------------------------------
    if op == 0x10:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'adc', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x11:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'adc', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x12:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'adc', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x13:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'adc', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x14: return 2+pfx_len, 'adc', f'al, 0x{imm8():02X}', False, None
    if op == 0x15: return 3+pfx_len, 'adc', f'ax, 0x{imm16():04X}', False, None

    if op == 0x16: return 1+pfx_len, 'push', 'ss', False, None
    if op == 0x17: return 1+pfx_len, 'pop',  'ss', False, None

    # ---- 0x18-0x1D: SBB -----------------------------------------------
    if op == 0x18:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sbb', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x19:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sbb', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x1A:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sbb', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x1B:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sbb', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x1C: return 2+pfx_len, 'sbb', f'al, 0x{imm8():02X}', False, None
    if op == 0x1D: return 3+pfx_len, 'sbb', f'ax, 0x{imm16():04X}', False, None

    if op == 0x1E: return 1+pfx_len, 'push', 'ds', False, None
    if op == 0x1F: return 1+pfx_len, 'pop',  'ds', False, None

    # ---- 0x20-0x25: AND -----------------------------------------------
    if op == 0x20:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'and', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x21:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'and', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x22:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'and', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x23:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'and', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x24: return 2+pfx_len, 'and', f'al, 0x{imm8():02X}', False, None
    if op == 0x25: return 3+pfx_len, 'and', f'ax, 0x{imm16():04X}', False, None

    if op == 0x27: return 1+pfx_len, 'daa',  '', False, None

    # ---- 0x28-0x2D: SUB -----------------------------------------------
    if op == 0x28:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sub', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x29:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sub', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x2A:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sub', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x2B:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'sub', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x2C: return 2+pfx_len, 'sub', f'al, 0x{imm8():02X}', False, None
    if op == 0x2D: return 3+pfx_len, 'sub', f'ax, 0x{imm16():04X}', False, None

    if op == 0x2F: return 1+pfx_len, 'das',  '', False, None

    # ---- 0x30-0x35: XOR -----------------------------------------------
    if op == 0x30:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'xor', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x31:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'xor', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x32:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'xor', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x33:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'xor', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x34: return 2+pfx_len, 'xor', f'al, 0x{imm8():02X}', False, None
    if op == 0x35: return 3+pfx_len, 'xor', f'ax, 0x{imm16():04X}', False, None

    if op == 0x37: return 1+pfx_len, 'aaa',  '', False, None

    # ---- 0x38-0x3D: CMP -----------------------------------------------
    if op == 0x38:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'cmp', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x39:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'cmp', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x3A:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'cmp', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x3B:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'cmp', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x3C: return 2+pfx_len, 'cmp', f'al, 0x{imm8():02X}', False, None
    if op == 0x3D: return 3+pfx_len, 'cmp', f'ax, 0x{imm16():04X}', False, None

    if op == 0x3F: return 1+pfx_len, 'aas', '', False, None

    # ---- 0x40-0x4F: INC/DEC r16 ----------------------------------------
    if 0x40 <= op <= 0x47: return 1+pfx_len, 'inc', R16[op-0x40], False, None
    if 0x48 <= op <= 0x4F: return 1+pfx_len, 'dec', R16[op-0x48], False, None

    # ---- 0x50-0x5F: PUSH/POP r16 ---------------------------------------
    if 0x50 <= op <= 0x57: return 1+pfx_len, 'push', R16[op-0x50], False, None
    if 0x58 <= op <= 0x5F: return 1+pfx_len, 'pop',  R16[op-0x58], False, None

    # ---- 0x60-0x6F: PUSHA/POPA/BOUND/IMUL/PUSH imm --------------------
    if op == 0x60: return 1+pfx_len, 'pusha', '', False, None
    if op == 0x61: return 1+pfx_len, 'popa',  '', False, None
    if op == 0x62:  # BOUND
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        return 1+ml+pfx_len, 'bound', f'{R16[reg]}, {ea}', False, None
    if op == 0x68:
        return 3+pfx_len, 'push', f'0x{imm16():04X}', False, None
    if op == 0x69:  # IMUL r16, r/m16, imm16
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        src = R16[rm] if mod == 3 else ea
        i16 = struct.unpack_from('<h', data, pos+1+ml)[0] if pos+1+ml+1 < len(data) else 0
        return 1+ml+2+pfx_len, 'imul', f'{R16[reg]}, {src}, 0x{i16 & 0xFFFF:04X}', False, None
    if op == 0x6A:
        d = struct.unpack_from('b', data, pos+1)[0] if pos+1 < len(data) else 0
        return 2+pfx_len, 'push', f'0x{d & 0xFF:02X}', False, None
    if op == 0x6B:  # IMUL r16, r/m16, imm8
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        src = R16[rm] if mod == 3 else ea
        i8 = struct.unpack_from('b', data, pos+1+ml)[0] if pos+1+ml < len(data) else 0
        return 1+ml+1+pfx_len, 'imul', f'{R16[reg]}, {src}, 0x{i8 & 0xFF:02X}', False, None

    # ---- 0x70-0x7F: Jcc rel8 -------------------------------------------
    _JCC8 = ('jo','jno','jb','jnb','jz','jnz','jbe','ja',
              'js','jns','jp','jnp','jl','jge','jle','jg')
    if 0x70 <= op <= 0x7F:
        tgt = rel8_target(2)
        return 2+pfx_len, _JCC8[op-0x70], _lbl(tgt, labels, '0x%05X'), False, None

    # ---- 0x80-0x83: Group 1 (immediate ALU) ----------------------------
    if op in (0x80, 0x82):  # r/m8, imm8
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else f'byte {ea}'
        i = imm8() if not ml else (data[pos+1+ml] if pos+1+ml < len(data) else 0)
        # recalculate imm after modrm
        i = data[pos+1+ml] if pos+1+ml < len(data) else 0
        return 1+ml+1+pfx_len, _GRP1[reg], f'{r}, 0x{i:02X}', False, ds_ref_at(pos+1)
    if op == 0x81:  # r/m16, imm16
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else f'word {ea}'
        i = struct.unpack_from('<H', data, pos+1+ml)[0] if pos+1+ml+1 < len(data) else 0
        return 1+ml+2+pfx_len, _GRP1[reg], f'{r}, 0x{i:04X}', False, ds_ref_at(pos+1)
    if op == 0x83:  # r/m16, sign-extended imm8
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else f'word {ea}'
        i = struct.unpack_from('b', data, pos+1+ml)[0] if pos+1+ml < len(data) else 0
        i_str = f'0x{i & 0xFFFF:04X}' if i >= 0 else f'-0x{(-i):02X}'
        return 1+ml+1+pfx_len, _GRP1[reg], f'{r}, {i_str}', False, ds_ref_at(pos+1)

    # ---- 0x84-0x87: TEST, XCHG with ModRM ------------------------------
    if op == 0x84:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'test', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x85:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'test', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x86:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'xchg', f'{R8[reg]}, {r}', False, None
    if op == 0x87:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'xchg', f'{R16[reg]}, {r}', False, None

    # ---- 0x88-0x8F: MOV group / LEA / POP r/m --------------------------
    if op == 0x88:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else f'byte {ea}'
        return 1+ml+pfx_len, 'mov', f'{r}, {R8[reg]}', False, ds_ref_at(pos+1)
    if op == 0x89:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'mov', f'{r}, {R16[reg]}', False, ds_ref_at(pos+1)
    if op == 0x8A:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'mov', f'{R8[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x8B:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'mov', f'{R16[reg]}, {r}', False, ds_ref_at(pos+1)
    if op == 0x8C:  # MOV r/m16, Sreg
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'mov', f'{r}, {SEG[reg & 3]}', False, None
    if op == 0x8D:  # LEA
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        return 1+ml+pfx_len, 'lea', f'{R16[reg]}, {ea}', False, None
    if op == 0x8E:  # MOV Sreg, r/m16
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'mov', f'{SEG[reg & 3]}, {r}', False, None
    if op == 0x8F:  # POP r/m16
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        return 1+ml+pfx_len, 'pop', r, False, None

    # ---- 0x90-0x97: NOP / XCHG AX, r16 --------------------------------
    if op == 0x90: return 1+pfx_len, 'nop', '', False, None
    if 0x91 <= op <= 0x97:
        return 1+pfx_len, 'xchg', f'ax, {R16[op-0x90]}', False, None

    # ---- 0x98-0x9F: CBW/CWD/CALL FAR/FWAIT/PUSHF/POPF/SAHF/LAHF ------
    if op == 0x98: return 1+pfx_len, 'cbw',   '', False, None
    if op == 0x99: return 1+pfx_len, 'cwd',   '', False, None
    if op == 0x9A:  # CALL FAR ptr16:16
        if pos + 4 < len(data):
            off16 = struct.unpack_from('<H', data, pos+1)[0]
            seg16 = struct.unpack_from('<H', data, pos+3)[0]
            file_tgt = _MZ_HEADER + seg16 * 16 + off16
            lname = (labels.get(file_tgt) if labels else None) or f'0x{seg16:04X}:0x{off16:04X}'
            return 5+pfx_len, 'call far', lname, False, None
        return 5+pfx_len, 'call far', '??:??', False, None
    if op == 0x9B: return 1+pfx_len, 'fwait', '', True, None
    if op == 0x9C: return 1+pfx_len, 'pushf', '', False, None
    if op == 0x9D: return 1+pfx_len, 'popf',  '', False, None
    if op == 0x9E: return 1+pfx_len, 'sahf',  '', False, None
    if op == 0x9F: return 1+pfx_len, 'lahf',  '', False, None

    # ---- 0xA0-0xA3: MOV AL/AX, [mem] / MOV [mem], AL/AX ---------------
    if op == 0xA0:
        a = imm16(); sp = f'{seg_pfx}:' if seg_pfx else ''
        return 3+pfx_len, 'mov', f'al, [{sp}0x{a:04X}]', False, a if not seg_pfx else None
    if op == 0xA1:
        a = imm16(); sp = f'{seg_pfx}:' if seg_pfx else ''
        return 3+pfx_len, 'mov', f'ax, [{sp}0x{a:04X}]', False, a if not seg_pfx else None
    if op == 0xA2:
        a = imm16(); sp = f'{seg_pfx}:' if seg_pfx else ''
        return 3+pfx_len, 'mov', f'[{sp}0x{a:04X}], al', False, a if not seg_pfx else None
    if op == 0xA3:
        a = imm16(); sp = f'{seg_pfx}:' if seg_pfx else ''
        return 3+pfx_len, 'mov', f'[{sp}0x{a:04X}], ax', False, a if not seg_pfx else None

    # ---- 0xA4-0xAF: string ops -----------------------------------------
    _STR = {0xA4:'movsb',0xA5:'movsw',0xA6:'cmpsb',0xA7:'cmpsw',
            0xAA:'stosb',0xAB:'stosw',0xAC:'lodsb',0xAD:'lodsw',
            0xAE:'scasb',0xAF:'scasw'}
    if op in _STR: return 1+pfx_len, rep_pfx+_STR[op] if rep_pfx else _STR[op], '', False, None

    # ---- 0xA8-0xA9: TEST AL/AX, imm ------------------------------------
    if op == 0xA8: return 2+pfx_len, 'test', f'al, 0x{imm8():02X}', False, None
    if op == 0xA9: return 3+pfx_len, 'test', f'ax, 0x{imm16():04X}', False, None

    # ---- 0xB0-0xBF: MOV r, imm -----------------------------------------
    if 0xB0 <= op <= 0xB7:
        return 2+pfx_len, 'mov', f'{R8[op-0xB0]}, 0x{imm8():02X}', False, None
    if 0xB8 <= op <= 0xBF:
        return 3+pfx_len, 'mov', f'{R16[op-0xB8]}, 0x{imm16():04X}', False, None

    # ---- 0xC0-0xC1: Shift group 2 with imm8 (286+) ---------------------
    if op in (0xC0, 0xC1):
        w = op & 1
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = (R16 if w else R8)[rm] if mod == 3 else ('' if w else 'byte ') + ea
        i = data[pos+1+ml] if pos+1+ml < len(data) else 0
        return 1+ml+1+pfx_len, _GRP2[reg], f'{r}, 0x{i:02X}', False, None

    # ---- 0xC2-0xC9: RET/ENTER/LEAVE ------------------------------------
    if op == 0xC2: return 3+pfx_len, 'ret',   f'0x{imm16():04X}', False, None
    if op == 0xC3: return 1+pfx_len, 'ret',   '', False, None
    if op == 0xC4:  # LES
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        return 1+ml+pfx_len, 'les', f'{R16[reg]}, {ea}', False, None
    if op == 0xC5:  # LDS
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        return 1+ml+pfx_len, 'lds', f'{R16[reg]}, {ea}', False, None
    if op == 0xC6:  # MOV r/m8, imm8
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else f'byte {ea}'
        i = data[pos+1+ml] if pos+1+ml < len(data) else 0
        return 1+ml+1+pfx_len, 'mov', f'{r}, 0x{i:02X}', False, ds_ref_at(pos+1)
    if op == 0xC7:  # MOV r/m16, imm16
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else f'word {ea}'
        i = struct.unpack_from('<H', data, pos+1+ml)[0] if pos+1+ml+1 < len(data) else 0
        return 1+ml+2+pfx_len, 'mov', f'{r}, 0x{i:04X}', False, ds_ref_at(pos+1)
    if op == 0xC8:  # ENTER imm16, imm8
        i16 = struct.unpack_from('<H', data, pos+1)[0] if pos+2 < len(data) else 0
        i8  = data[pos+3] if pos+3 < len(data) else 0
        return 4+pfx_len, 'enter', f'0x{i16:04X}, 0x{i8:02X}', False, None
    if op == 0xC9: return 1+pfx_len, 'leave', '', False, None
    if op == 0xCA: return 3+pfx_len, 'retf',   f'0x{imm16():04X}', False, None
    if op == 0xCB: return 1+pfx_len, 'retf',   '', False, None
    if op == 0xCC: return 1+pfx_len, 'int',    '3', False, None
    if op == 0xCD:  # INT n (non-FPU)
        n = imm8()
        return 2+pfx_len, 'int', f'0x{n:02X}', False, None
    if op == 0xCE: return 1+pfx_len, 'into',   '', False, None
    if op == 0xCF: return 1+pfx_len, 'iret',   '', False, None

    # ---- 0xD0-0xD3: Shift group 2 (1 / CL) ----------------------------
    if op in (0xD0, 0xD1, 0xD2, 0xD3):
        w   = op & 1
        cl  = op & 2
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = (R16 if w else R8)[rm] if mod == 3 else ('' if w else 'byte ') + ea
        cnt = 'cl' if cl else '1'
        return 1+ml+pfx_len, _GRP2[reg], f'{r}, {cnt}', False, None

    # ---- 0xD4-0xD7: AAM, AAD, SALC, XLAT ------------------------------
    if op == 0xD4: return 2+pfx_len, 'aam',  f'0x{imm8():02X}', False, None
    if op == 0xD5: return 2+pfx_len, 'aad',  f'0x{imm8():02X}', False, None
    if op == 0xD6: return 1+pfx_len, 'salc', '', False, None
    if op == 0xD7: return 1+pfx_len, 'xlat', '', False, None

    # ---- 0xD8-0xDF: native FPU ESC (not via INT emulation) -------------
    if 0xD8 <= op <= 0xDF:
        if pos + 1 < len(data):
            ml, ea, mod, reg, rm = modrm_at(pos+1)
            mn, op_str = _fpu_op(op, mod, reg, rm, ea if mod != 3 else None)
            ds_ref2 = ds_ref_at(pos+1)
            return 1+ml+pfx_len, mn, op_str, True, ds_ref2
        return 1+pfx_len, f'db 0x{op:02X}', '', False, None

    # ---- 0xE0-0xE3: LOOP / JCXZ ----------------------------------------
    if op == 0xE0:
        tgt = rel8_target(2)
        return 2+pfx_len, 'loopnz', _lbl(tgt, labels, '0x%05X'), False, None
    if op == 0xE1:
        tgt = rel8_target(2)
        return 2+pfx_len, 'loopz',  _lbl(tgt, labels, '0x%05X'), False, None
    if op == 0xE2:
        tgt = rel8_target(2)
        return 2+pfx_len, 'loop',   _lbl(tgt, labels, '0x%05X'), False, None
    if op == 0xE3:
        tgt = rel8_target(2)
        return 2+pfx_len, 'jcxz',   _lbl(tgt, labels, '0x%05X'), False, None

    # ---- 0xE4-0xE7: IN/OUT imm8 ----------------------------------------
    if op == 0xE4: return 2+pfx_len, 'in',  f'al, 0x{imm8():02X}', False, None
    if op == 0xE5: return 2+pfx_len, 'in',  f'ax, 0x{imm8():02X}', False, None
    if op == 0xE6: return 2+pfx_len, 'out', f'0x{imm8():02X}, al', False, None
    if op == 0xE7: return 2+pfx_len, 'out', f'0x{imm8():02X}, ax', False, None

    # ---- 0xE8-0xEB: CALL/JMP near/short --------------------------------
    if op == 0xE8:
        tgt = rel16_target(3)
        return 3+pfx_len, 'call', _lbl(tgt, labels, '0x%05X'), False, None
    if op == 0xE9:
        tgt = rel16_target(3)
        return 3+pfx_len, 'jmp',  _lbl(tgt, labels, '0x%05X'), False, None
    if op == 0xEA:  # JMP FAR ptr16:16
        if pos + 4 < len(data):
            off16 = struct.unpack_from('<H', data, pos+1)[0]
            seg16 = struct.unpack_from('<H', data, pos+3)[0]
            file_tgt = _MZ_HEADER + seg16 * 16 + off16
            lname = (labels.get(file_tgt) if labels else None) or f'0x{seg16:04X}:0x{off16:04X}'
            return 5+pfx_len, 'jmp far', lname, False, None
        return 5+pfx_len, 'jmp far', '??:??', False, None
    if op == 0xEB:
        tgt = rel8_target(2)
        return 2+pfx_len, 'jmp',  _lbl(tgt, labels, '0x%05X'), False, None

    # ---- 0xEC-0xEF: IN/OUT DX ------------------------------------------
    if op == 0xEC: return 1+pfx_len, 'in',  'al, dx', False, None
    if op == 0xED: return 1+pfx_len, 'in',  'ax, dx', False, None
    if op == 0xEE: return 1+pfx_len, 'out', 'dx, al', False, None
    if op == 0xEF: return 1+pfx_len, 'out', 'dx, ax', False, None

    # ---- 0xF4-0xF5: HLT/CMC -------------------------------------------
    if op == 0xF4: return 1+pfx_len, 'hlt', '', False, None
    if op == 0xF5: return 1+pfx_len, 'cmc', '', False, None

    # ---- 0xF6-0xF7: Group 3 -------------------------------------------
    if op == 0xF6:  # byte
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else f'byte {ea}'
        mn = _GRP3[reg]
        if reg in (0, 1):  # TEST
            i = data[pos+1+ml] if pos+1+ml < len(data) else 0
            return 1+ml+1+pfx_len, mn, f'{r}, 0x{i:02X}', False, ds_ref_at(pos+1)
        return 1+ml+pfx_len, mn, r, False, None
    if op == 0xF7:  # word
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else f'word {ea}'
        mn = _GRP3[reg]
        if reg in (0, 1):  # TEST
            i = struct.unpack_from('<H', data, pos+1+ml)[0] if pos+1+ml+1 < len(data) else 0
            return 1+ml+2+pfx_len, mn, f'{r}, 0x{i:04X}', False, ds_ref_at(pos+1)
        return 1+ml+pfx_len, mn, r, False, None

    # ---- 0xF8-0xFD: flag ops -------------------------------------------
    _FLAGS = {0xF8:'clc',0xF9:'stc',0xFA:'cli',0xFB:'sti',0xFC:'cld',0xFD:'std'}
    if op in _FLAGS: return 1+pfx_len, _FLAGS[op], '', False, None

    # ---- 0xFE: Group 4 (INC/DEC byte) ----------------------------------
    if op == 0xFE:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R8[rm] if mod == 3 else f'byte {ea}'
        return 1+ml+pfx_len, 'inc' if reg == 0 else 'dec', r, False, None

    # ---- 0xFF: Group 5 (INC/DEC/CALL/JMP/PUSH word) -------------------
    if op == 0xFF:
        ml, ea, mod, reg, rm = modrm_at(pos+1)
        r = R16[rm] if mod == 3 else ea
        mn = _GRP5[reg]
        if reg == 2:   # CALL near indirect
            return 1+ml+pfx_len, 'call', f'[{r}]' if mod != 3 else r, False, None
        if reg == 3:   # CALL far indirect
            return 1+ml+pfx_len, 'call far', f'[{r}]' if mod != 3 else r, False, None
        if reg == 4:   # JMP near indirect
            return 1+ml+pfx_len, 'jmp', f'[{r}]' if mod != 3 else r, False, None
        if reg == 5:   # JMP far indirect
            return 1+ml+pfx_len, 'jmp far', f'[{r}]' if mod != 3 else r, False, None
        return 1+ml+pfx_len, mn, r, False, None

    # ---- Unknown opcode ------------------------------------------------
    return 1+pfx_len, 'db', f'0x{op:02X}', False, None


if __name__ == '__main__':
    # Quick self-test
    test_cases = [
        (bytes([0x55]),           'push bp'),
        (bytes([0x89, 0xE5]),     'mov bp, sp'),
        (bytes([0xE8, 0x10, 0x00]), 'call 0x00013'),
        (bytes([0x74, 0x05]),     'jz ...'),
        (bytes([0xCD, 0x35, 0x06, 0x16, 0x00]),  'fld dword [0x0016]'),  # FPU INT 35h D9/0 [disp16]
        (bytes([0xCD, 0x3D]),              'fwait'),
        (bytes([0xCD, 0x3E, 0xE8, 0x90]), 'fld1'),                 # CD 3E E8 90
        (bytes([0x8B, 0x46, 0x08]),       'mov ax, [bp+0x08]'),
    ]
    print('instruction_set_x86.py self-test:')
    for raw, expected in test_cases:
        length, mn, op_str, is_fpu, ds_ref = decode(raw, 0)
        result = f'{mn} {op_str}'.strip()
        ok = '✓' if expected in result else '?'
        print(f'  {ok}  {" ".join(f"{b:02X}" for b in raw):<16}  → {result}  (expected: {expected})')
