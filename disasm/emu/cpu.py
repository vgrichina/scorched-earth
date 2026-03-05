"""CPU state: 16-bit registers, segment registers, flags, FPU stack."""


class CPU:
    def __init__(self):
        # General-purpose (index matches R16 table: AX=0 CX=1 DX=2 BX=3 SP=4 BP=5 SI=6 DI=7)
        self.regs = [0] * 8
        # Segment registers (index matches SEG table: ES=0 CS=1 SS=2 DS=3)
        self.segs = [0] * 4
        self.ip = 0

        # Flags
        self.cf = 0  # carry
        self.zf = 0  # zero
        self.sf = 0  # sign
        self.of = 0  # overflow
        self.pf = 0  # parity
        self.af = 0  # aux carry
        self.df = 0  # direction
        self.intf = 1  # interrupt enable (always 1 in emulator)
        self.tf = 0  # trap

        # FPU
        self.fpu_stack = [0.0] * 8
        self.fpu_top = 0
        self.fpu_sw = 0  # status word
        self.fpu_cw = 0x037F  # control word (round-to-nearest, all masked)

        # Halted flag
        self.halted = False

    # -- Register accessors (16-bit) -----------------------------------------

    # R16 indices
    AX, CX, DX, BX, SP, BP, SI, DI = range(8)
    # SEG indices
    ES, CS, SS, DS = range(4)

    @property
    def ax(self): return self.regs[0]
    @ax.setter
    def ax(self, v): self.regs[0] = v & 0xFFFF

    @property
    def cx(self): return self.regs[1]
    @cx.setter
    def cx(self, v): self.regs[1] = v & 0xFFFF

    @property
    def dx(self): return self.regs[2]
    @dx.setter
    def dx(self, v): self.regs[2] = v & 0xFFFF

    @property
    def bx(self): return self.regs[3]
    @bx.setter
    def bx(self, v): self.regs[3] = v & 0xFFFF

    @property
    def sp(self): return self.regs[4]
    @sp.setter
    def sp(self, v): self.regs[4] = v & 0xFFFF

    @property
    def bp(self): return self.regs[5]
    @bp.setter
    def bp(self, v): self.regs[5] = v & 0xFFFF

    @property
    def si(self): return self.regs[6]
    @si.setter
    def si(self, v): self.regs[6] = v & 0xFFFF

    @property
    def di(self): return self.regs[7]
    @di.setter
    def di(self, v): self.regs[7] = v & 0xFFFF

    # -- 8-bit register access ------------------------------------------------
    # R8: AL=0 CL=1 DL=2 BL=3 AH=4 CH=5 DH=6 BH=7

    def get_reg8(self, idx):
        if idx < 4:
            return self.regs[idx] & 0xFF
        return (self.regs[idx - 4] >> 8) & 0xFF

    def set_reg8(self, idx, val):
        val &= 0xFF
        if idx < 4:
            self.regs[idx] = (self.regs[idx] & 0xFF00) | val
        else:
            r = idx - 4
            self.regs[r] = (self.regs[r] & 0x00FF) | (val << 8)

    # -- 16-bit register access by index --------------------------------------

    def get_reg16(self, idx):
        return self.regs[idx]

    def set_reg16(self, idx, val):
        self.regs[idx] = val & 0xFFFF

    # -- Segment register access ----------------------------------------------

    def get_seg(self, idx):
        return self.segs[idx]

    def set_seg(self, idx, val):
        self.segs[idx] = val & 0xFFFF

    # -- Flags pack/unpack (for PUSHF/POPF/IRET) -----------------------------

    def get_flags(self):
        return (self.cf
                | (1 << 1)  # always 1
                | (self.pf << 2)
                | (self.af << 4)
                | (self.zf << 6)
                | (self.sf << 7)
                | (self.tf << 8)
                | (self.intf << 9)
                | (self.df << 10)
                | (self.of << 11))

    def set_flags(self, val):
        self.cf = (val >> 0) & 1
        self.pf = (val >> 2) & 1
        self.af = (val >> 4) & 1
        self.zf = (val >> 6) & 1
        self.sf = (val >> 7) & 1
        self.tf = (val >> 8) & 1
        self.intf = (val >> 9) & 1
        self.df = (val >> 10) & 1
        self.of = (val >> 11) & 1

    # -- Flag update helpers --------------------------------------------------

    @staticmethod
    def _parity(val):
        """Parity of low byte: 1 if even number of set bits."""
        b = val & 0xFF
        b ^= b >> 4
        b ^= b >> 2
        b ^= b >> 1
        return (b & 1) ^ 1

    def update_flags_add(self, a, b, width=16):
        mask = (1 << width) - 1
        result = (a + b) & 0xFFFFFFFF
        r = result & mask
        self.cf = 1 if result > mask else 0
        self.zf = 1 if r == 0 else 0
        self.sf = 1 if r & (1 << (width - 1)) else 0
        self.of = 1 if (~(a ^ b) & (a ^ r)) & (1 << (width - 1)) else 0
        self.af = 1 if (a ^ b ^ r) & 0x10 else 0
        self.pf = self._parity(r)
        return r

    def update_flags_sub(self, a, b, width=16):
        mask = (1 << width) - 1
        result = a - b
        r = result & mask
        self.cf = 1 if a < b else 0
        self.zf = 1 if r == 0 else 0
        self.sf = 1 if r & (1 << (width - 1)) else 0
        self.of = 1 if ((a ^ b) & (a ^ r)) & (1 << (width - 1)) else 0
        self.af = 1 if (a ^ b ^ r) & 0x10 else 0
        self.pf = self._parity(r)
        return r

    def update_flags_logic(self, result, width=16):
        mask = (1 << width) - 1
        r = result & mask
        self.cf = 0
        self.of = 0
        self.zf = 1 if r == 0 else 0
        self.sf = 1 if r & (1 << (width - 1)) else 0
        self.pf = self._parity(r)
        return r

    # -- FPU helpers ----------------------------------------------------------

    def fpu_push(self, val):
        self.fpu_top = (self.fpu_top - 1) & 7
        self.fpu_stack[self.fpu_top] = val

    def fpu_pop(self):
        val = self.fpu_stack[self.fpu_top]
        self.fpu_stack[self.fpu_top] = 0.0
        self.fpu_top = (self.fpu_top + 1) & 7
        return val

    def fpu_st(self, i=0):
        return self.fpu_stack[(self.fpu_top + i) & 7]

    def fpu_set_st(self, i, val):
        self.fpu_stack[(self.fpu_top + i) & 7] = val

    # -- Debug ----------------------------------------------------------------

    def dump(self):
        s = (f"AX={self.ax:04X} BX={self.bx:04X} CX={self.cx:04X} DX={self.dx:04X} "
             f"SI={self.si:04X} DI={self.di:04X} BP={self.bp:04X} SP={self.sp:04X}\n"
             f"CS={self.segs[1]:04X} DS={self.segs[3]:04X} "
             f"ES={self.segs[0]:04X} SS={self.segs[2]:04X} IP={self.ip:04X}\n"
             f"CF={self.cf} ZF={self.zf} SF={self.sf} OF={self.of} "
             f"DF={self.df} PF={self.pf} AF={self.af}")
        return s
