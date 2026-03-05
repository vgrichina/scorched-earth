"""Flat 1MB memory model with VGA framebuffer region."""

import struct


class Memory:
    """1MB flat memory: IVT at 0, VGA at 0xA0000, everything else available."""

    SIZE = 1 << 20  # 1MB

    def __init__(self):
        self.data = bytearray(self.SIZE)

    # -- byte/word/dword reads ------------------------------------------------

    def read8(self, addr):
        return self.data[addr & 0xFFFFF]

    def read16(self, addr):
        addr &= 0xFFFFF
        return self.data[addr] | (self.data[addr + 1] << 8)

    def read32(self, addr):
        addr &= 0xFFFFF
        return struct.unpack_from('<I', self.data, addr)[0]

    def read_float32(self, addr):
        return struct.unpack_from('<f', self.data, addr & 0xFFFFF)[0]

    def read_float64(self, addr):
        return struct.unpack_from('<d', self.data, addr & 0xFFFFF)[0]

    # -- byte/word/dword writes -----------------------------------------------

    def write8(self, addr, val):
        self.data[addr & 0xFFFFF] = val & 0xFF

    def write16(self, addr, val):
        addr &= 0xFFFFF
        self.data[addr] = val & 0xFF
        self.data[addr + 1] = (val >> 8) & 0xFF

    def write32(self, addr, val):
        struct.pack_into('<I', self.data, addr & 0xFFFFF, val & 0xFFFFFFFF)

    def write_float32(self, addr, val):
        struct.pack_into('<f', self.data, addr & 0xFFFFF, val)

    def write_float64(self, addr, val):
        struct.pack_into('<d', self.data, addr & 0xFFFFF, val)

    # -- bulk operations ------------------------------------------------------

    def load_bytes(self, addr, data):
        """Copy bytes into memory at addr."""
        addr &= 0xFFFFF
        n = len(data)
        self.data[addr:addr + n] = data

    def read_bytes(self, addr, n):
        """Read n bytes from memory."""
        addr &= 0xFFFFF
        return bytes(self.data[addr:addr + n])

    # -- physical address from seg:off ----------------------------------------

    @staticmethod
    def phys(seg, off):
        """Compute physical address from segment:offset."""
        return ((seg << 4) + off) & 0xFFFFF
