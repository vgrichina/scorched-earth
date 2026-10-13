#!/usr/bin/env python3
"""Ensure comparison captures the same visible page as emulator PNG output."""
import tempfile
import sys
script_dir = sys.path.pop(0)
import unittest
sys.path.insert(0, script_dir)
from pathlib import Path

from compare_pipeline import extract_display_pixels
from compare_screenshots import read_png
from emu.memory import Memory
from emu.ports import PortIO


class DisplayCaptureTest(unittest.TestCase):
    def test_visible_planar_page_and_linear_memory(self):
        for planar in (False, True):
            with self.subTest(planar=planar):
                mem, ports = Memory(), PortIO()
                ports.seq_regs[4] = 0 if planar else 8
                ports.get_resolution = lambda: (8, 4)
                ports.crtc_regs[0x0C] = 1
                ports.crtc_regs[0x0D] = 7
                for plane in range(4):
                    mem.vga_planes[plane][:8] = bytes([99] * 8)
                    mem.vga_planes[plane][263:271] = bytes(range(plane * 8, plane * 8 + 8))
                mem.data[0xA0000:0xA0020] = bytes(range(32))
                ports.palette = [(i % 64, i % 64, i % 64) for i in range(256)]
                actual = extract_display_pixels(mem, ports)
                expected = ([((x & 3) * 8 + y * 2 + (x >> 2))
                             for y in range(4) for x in range(8)]
                            if planar else list(range(32)))
                self.assertEqual(actual, expected)
                with tempfile.TemporaryDirectory() as directory:
                    png = str(Path(directory) / 'visible.png')
                    mem.dump_screen_png(png, ports)
                    _, _, rgba = read_png(png)
                    self.assertEqual(list(rgba[::4]), [(i << 2) | (i >> 4) for i in actual])


if __name__ == '__main__':
    unittest.main()
