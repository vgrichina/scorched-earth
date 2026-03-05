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
        # 4 VGA planes for Mode X (each 64KB)
        self.vga_planes = [bytearray(self.VGA_PLANE_SIZE) for _ in range(4)]
        # Reference to PortIO for map mask / read plane (set by __main__)
        self.ports = None

    def _is_vga(self, addr):
        return self.VGA_BASE <= addr < self.VGA_END

    # -- byte/word/dword reads ------------------------------------------------

    def read8(self, addr):
        addr &= 0xFFFFF
        if self.ports and self.ports.mode_x and self._is_vga(addr):
            off = addr - self.VGA_BASE
            return self.vga_planes[self.ports.read_plane][off]
        return self.data[addr]

    def read16(self, addr):
        addr &= 0xFFFFF
        if self.ports and self.ports.mode_x and self._is_vga(addr):
            return self.read8(addr) | (self.read8(addr + 1) << 8)
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
        addr &= 0xFFFFF
        val &= 0xFF
        if self.ports and self.ports.mode_x and self._is_vga(addr):
            off = addr - self.VGA_BASE
            mask = self.ports.map_mask
            for plane in range(4):
                if mask & (1 << plane):
                    self.vga_planes[plane][off] = val
        else:
            self.data[addr] = val

    def write16(self, addr, val):
        addr &= 0xFFFFF
        if self.ports and self.ports.mode_x and self._is_vga(addr):
            self.write8(addr, val & 0xFF)
            self.write8(addr + 1, (val >> 8) & 0xFF)
        else:
            self.data[addr] = val & 0xFF
            self.data[addr + 1] = (val >> 8) & 0xFF

    def write32(self, addr, val):
        addr &= 0xFFFFF
        if self.ports and self.ports.mode_x and self._is_vga(addr):
            self.write8(addr, val & 0xFF)
            self.write8(addr + 1, (val >> 8) & 0xFF)
            self.write8(addr + 2, (val >> 16) & 0xFF)
            self.write8(addr + 3, (val >> 24) & 0xFF)
        else:
            struct.pack_into('<I', self.data, addr, val & 0xFFFFFFFF)

    def write_float32(self, addr, val):
        struct.pack_into('<f', self.data, addr & 0xFFFFF, val)

    def write_float64(self, addr, val):
        struct.pack_into('<d', self.data, addr & 0xFFFFF, val)

    # -- bulk operations ------------------------------------------------------

    def load_bytes(self, addr, data):
        """Copy bytes into memory at addr."""
        addr &= 0xFFFFF
        if self.ports and self.ports.mode_x and self._is_vga(addr):
            for i, b in enumerate(data):
                self.write8(addr + i, b)
        else:
            n = len(data)
            self.data[addr:addr + n] = data

    def read_bytes(self, addr, n):
        """Read n bytes from memory."""
        addr &= 0xFFFFF
        if self.ports and self.ports.mode_x and self._is_vga(addr):
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

        if ports.mode_x:
            # Mode X: dump ALL VGA plane memory as a tall image showing all pages
            # Each plane has VGA_PLANE_SIZE bytes; stride = width/4
            stride = width // 4
            total_rows = self.VGA_PLANE_SIZE // stride
            # Cap to something reasonable (e.g. 4 pages worth)
            max_rows = min(total_rows, height * 4)
            pixels = bytearray(width * max_rows)
            for y in range(max_rows):
                for x in range(width):
                    plane = x & 3
                    off = (x >> 2) + y * stride
                    if off < self.VGA_PLANE_SIZE:
                        pixels[y * width + x] = self.vga_planes[plane][off]
            height = max_rows
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
