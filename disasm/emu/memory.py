"""Flat 1MB memory model with VGA framebuffer region (Mode 13h + Mode X)."""

import struct


class Memory:
    """1MB flat memory: IVT at 0, VGA at 0xA0000, everything else available.

    For Mode X (planar VGA), the 0xA0000-0xAFFFF region is backed by 4 planes
    of 64KB each instead of the flat data array.
    """

    SIZE = 1 << 20  # 1MB
    VGA_BASE = 0xA0000
    VGA_END = 0xB0000
    VGA_PLANE_SIZE = 0x10000  # 64KB per plane

    def __init__(self):
        self.data = bytearray(self.SIZE)
        self.vesa_vram = bytearray(1 << 20)
        self._vesa = False
        self._vesa_bank = 0
        # 4 VGA planes for Mode X (each 64KB)
        self.vga_planes = [bytearray(self.VGA_PLANE_SIZE) for _ in range(4)]
        # Cached VGA state (updated by PortIO.port_out via notify)
        self._mode_x = False
        self._map_mask = 0x0F
        self._read_plane = 0

    # -- byte/word/dword reads ------------------------------------------------

    def read8(self, addr):
        addr &= 0xFFFFF
        if 0xA0000 <= addr < 0xB0000 and self._vesa:
            return self.vesa_vram[self._vesa_bank * 65536 + addr - 0xA0000]
        if 0xA0000 <= addr < 0xB0000 and self._mode_x:
            return self.vga_planes[self._read_plane][addr - 0xA0000]
        return self.data[addr]

    def _split_access(self, addr, size):
        # Split accesses crossing the 20-bit wrap or touching the VGA aperture.
        return addr + size > self.SIZE or (
            (self._mode_x or self._vesa) and addr < self.VGA_END and addr + size > self.VGA_BASE)

    def read16(self, addr):
        addr &= 0xFFFFF
        if self._split_access(addr, 2):
            return self.read8(addr) | (self.read8(addr + 1) << 8)
        return self.data[addr] | (self.data[addr + 1] << 8)

    def read32(self, addr):
        addr &= 0xFFFFF
        if self._split_access(addr, 4):
            return int.from_bytes(self.read_bytes(addr, 4), 'little')
        return struct.unpack_from('<I', self.data, addr)[0]

    def read_float32(self, addr):
        return struct.unpack('<f', self.read_bytes(addr, 4))[0]

    def read_float64(self, addr):
        return struct.unpack('<d', self.read_bytes(addr, 8))[0]

    # -- byte/word/dword writes -----------------------------------------------

    def write8(self, addr, val):
        addr &= 0xFFFFF
        if 0xA0000 <= addr < 0xB0000 and self._vesa:
            self.vesa_vram[self._vesa_bank * 65536 + addr - 0xA0000] = val & 0xFF
        elif 0xA0000 <= addr < 0xB0000 and self._mode_x:
            off = addr - 0xA0000
            mask = self._map_mask
            planes = self.vga_planes
            if mask & 1: planes[0][off] = val & 0xFF
            if mask & 2: planes[1][off] = val & 0xFF
            if mask & 4: planes[2][off] = val & 0xFF
            if mask & 8: planes[3][off] = val & 0xFF
        else:
            self.data[addr] = val & 0xFF

    def write16(self, addr, val):
        addr &= 0xFFFFF
        if self._split_access(addr, 2):
            self.write8(addr, val & 0xFF)
            self.write8(addr + 1, (val >> 8) & 0xFF)
        else:
            self.data[addr] = val & 0xFF
            self.data[addr + 1] = (val >> 8) & 0xFF

    def write32(self, addr, val):
        self.load_bytes(addr, struct.pack('<I', val & 0xFFFFFFFF))

    def write_float32(self, addr, val):
        self.load_bytes(addr, struct.pack('<f', val))

    def write_float64(self, addr, val):
        self.load_bytes(addr, struct.pack('<d', val))

    # -- bulk operations ------------------------------------------------------

    def load_bytes(self, addr, data):
        """Copy bytes into memory at addr."""
        addr &= 0xFFFFF
        if self._split_access(addr, len(data)):
            for i, b in enumerate(data):
                self.write8(addr + i, b)
        else:
            n = len(data)
            self.data[addr:addr + n] = data

    def read_bytes(self, addr, n):
        """Read n bytes from memory."""
        addr &= 0xFFFFF
        if self._split_access(addr, n):
            return bytes(self.read8(addr + i) for i in range(n))
        return bytes(self.data[addr:addr + n])

    # -- physical address from seg:off ----------------------------------------

    @staticmethod
    def phys(seg, off):
        """Compute physical address from segment:offset."""
        return ((seg << 4) + off) & 0xFFFFF

    # -- VGA framebuffer dump -------------------------------------------------

    def dump_screen_png(self, path, ports):
        """Dump VGA framebuffer to PNG file using current palette.

        Supports both Mode 13h (linear) and Mode X (planar).
        Uses only stdlib (zlib + struct) — no PIL needed.
        """
        import zlib

        width, height = ports.get_resolution()

        if ports.vesa_mode:
            pixels = bytes(self.vesa_vram[ports.vesa_start:ports.vesa_start + width * height])
        elif ports.mode_x:
            # Mode X: dump visible page only (CRTC start address determines page)
            stride = width // 4
            start_addr = (ports.crtc_regs[0x0C] << 8) | ports.crtc_regs[0x0D]
            pixels = bytearray(width * height)
            for y in range(height):
                for x in range(width):
                    plane = x & 3
                    off = start_addr + (x >> 2) + y * stride
                    if off < self.VGA_PLANE_SIZE:
                        pixels[y * width + x] = self.vga_planes[plane][off]
        else:
            # Mode 13h: linear framebuffer at 0xA0000
            pixels = bytes(self.data[self.VGA_BASE:self.VGA_BASE + width * height])

        # Build 8-bit indexed PNG with PLTE chunk
        def _chunk(tag, data):
            c = tag + data
            return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

        # IHDR
        ihdr = struct.pack('>IIBBBBB', width, height, 8, 3, 0, 0, 0)  # 8-bit indexed (type 3)
        # PLTE: 256 entries, VGA 6-bit → 8-bit
        plte = bytearray(768)
        for i in range(256):
            r, g, b = ports.palette[i]
            plte[i*3] = min(255, r * 4 + (r >> 4))    # 6-bit → 8-bit
            plte[i*3+1] = min(255, g * 4 + (g >> 4))
            plte[i*3+2] = min(255, b * 4 + (b >> 4))
        # IDAT: filtered rows (filter byte 0 = None for each row)
        raw = bytearray()
        for y in range(height):
            raw.append(0)  # filter: none
            raw.extend(pixels[y*width:(y+1)*width])
        idat = zlib.compress(bytes(raw), 9)

        with open(path, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n')
            f.write(_chunk(b'IHDR', ihdr))
            f.write(_chunk(b'PLTE', bytes(plte)))
            f.write(_chunk(b'IDAT', idat))
            f.write(_chunk(b'IEND', b''))
