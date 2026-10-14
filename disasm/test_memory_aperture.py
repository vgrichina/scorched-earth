#!/usr/bin/env python3
"""Check mapped VGA accesses, ROM reads, and transfers across memory boundaries."""
import sys
script_dir = sys.path.pop(0)
import unittest
sys.path.insert(0, script_dir)
from emu.memory import Memory


class MemoryApertureTests(unittest.TestCase):
    def test_rom_stays_outside_video_planes(self):
        m = Memory()
        m._mode_x = True
        m._read_plane = 2
        m._map_mask = 5
        m.load_bytes(0xc0025, b'VESA BIOS')
        self.assertEqual(m.read_bytes(0xc0025, 9), b'VESA BIOS')
        self.assertEqual(m.read16(0xc0025), 0x4556)
        self.assertEqual(m.read32(0xc0025), 0x41534556)
        self.assertTrue(all(not any(p) for p in m.vga_planes))
        m.write8(0xaffff, 0x71)
        self.assertEqual([p[-1] for p in m.vga_planes], [0x71, 0, 0x71, 0])
        self.assertEqual(m.read8(0xaffff), 0x71)
        self.assertEqual(m.data[0xaffff], 0)

    def test_integer_bulk_and_float_boundaries(self):
        for planar in (False, True):
            for address in (0x9fffd, 0x9ffff, 0xa0000, 0xafffd,
                            0xaffff, 0xb0000, 0xc0000, 0xffffd, 0xfffff):
                for size in (2, 4, 8):
                    with self.subTest(planar=planar, address=hex(address), size=size):
                        m = Memory()
                        m._mode_x = planar
                        m._map_mask = 5
                        m._read_plane = 2
                        data = bytes(range(1, size + 1))
                        m.load_bytes(address, data)
                        self.assertEqual(m.read_bytes(address, size), data)
                        for i, value in enumerate(data):
                            a = (address + i) & 0xfffff
                            if planar and 0xa0000 <= a < 0xb0000:
                                self.assertEqual([p[a-0xa0000] for p in m.vga_planes], [value, 0, value, 0])
                                self.assertEqual(m.data[a], 0)
                            else:
                                self.assertEqual(m.data[a], value)
                        if size in (2, 4):
                            value = (1 << (8 * size)) - 0x4321
                            getattr(m, f'write{size*8}')(address, value)
                            self.assertEqual(getattr(m, f'read{size*8}')(address), value)
                        if size in (4, 8):
                            getattr(m, f'write_float{size*8}')(address, -12.5)
                            self.assertEqual(getattr(m, f'read_float{size*8}')(address), -12.5)
                        self.assertEqual(len(m.data), m.SIZE)


if __name__ == '__main__':
    unittest.main()
