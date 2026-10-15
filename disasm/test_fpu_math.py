"""Regression tests for Borland trig extensions and _ftol rounding control."""
import sys
script_dir = sys.path.pop(0)
import math
import unittest
sys.path.insert(0, script_dir)
from emu.cpu import CPU
from emu.memory import Memory
from emu.fpu import exec_fpu_int
from instruction_set_x86 import _decode_fpu_int


class FPUMathTest(unittest.TestCase):
    def setUp(self):
        self.cpu, self.mem = CPU(), Memory()
        self.cpu.segs[:] = [0x2000, 0x1000, 0x3000, 0x4000]

    def execute(self, code):
        self.mem.data[0x10000:0x10000 + len(code)] = code
        return exec_fpu_int(self.cpu, self.mem, None)

    def test_borland_trig_does_not_push_constants(self):
        for opcode, fn, mnemonic in [(0xEC, math.sin, 'fsin'),
                                     (0xEE, math.cos, 'fcos'),
                                     (0xF0, math.tan, 'ftan'),
                                     (0xF2, math.atan, 'fatan')]:
            for value in [-1.2, 0.0, 0.785398185]:
                self.cpu.fpu_push(19.0)
                self.cpu.fpu_push(value)
                top = self.cpu.fpu_top
                code = bytes([0xCD, 0x3E, opcode, 0x90])
                self.assertEqual(self.execute(code), 4)
                self.assertEqual(self.cpu.fpu_top, top)
                self.assertAlmostEqual(self.cpu.fpu_pop(), fn(value))
                self.assertEqual(self.cpu.fpu_pop(), 19.0)
                self.assertEqual(_decode_fpu_int(code, 0)[:3], (4, mnemonic, ''))

    def test_native_borland_d9_constants_still_push(self):
        self.execute(bytes.fromhex('CD 35 EC'))
        self.assertAlmostEqual(self.cpu.fpu_pop(), math.log10(2))
        self.execute(bytes.fromhex('CD 35 EE'))
        self.assertEqual(self.cpu.fpu_pop(), 0)

    def test_control_word_rounding_for_integer_store(self):
        for mode, expected in [(0, (3, -3)), (1, (2, -3)),
                               (2, (3, -2)), (3, (2, -2))]:
            self.mem.write16(0x40100, 0x037F | mode << 10)
            self.execute(bytes.fromhex('CD 35 2E 00 01'))  # FLDCW DS:100
            for value, result in zip((2.75, -2.75), expected):
                self.cpu.fpu_push(value)
                self.execute(bytes.fromhex('CD 3B 3E 02 01'))  # FISTP qword DS:102
                self.assertEqual(self.mem.read32(0x40102), result & 0xFFFFFFFF)
                self.assertEqual(self.mem.read32(0x40106), 0xFFFFFFFF if result < 0 else 0)

    def test_fxam_replaces_stale_comparison_flags(self):
        for value, flags in [(0.3, 0x0400), (-0.3, 0x0600),
                             (0.0, 0x4000), (-0.0, 0x4200),
                             (math.inf, 0x0500), (-math.inf, 0x0700),
                             (math.nan, 0x0100)]:
            self.cpu.fpu_push(value)
            self.cpu.fpu_sw = 0x4501
            top = self.cpu.fpu_top
            self.execute(bytes.fromhex('CD 35 E5'))
            self.assertEqual(self.cpu.fpu_sw, flags | 1)
            self.assertEqual(self.cpu.fpu_top, top)
            self.cpu.fpu_pop()

    def test_extended_store_has_real_x87_layout(self):
        for value, encoded in [
            (0.0, '00000000000000000000'),
            (-0.0, '00000000000000000080'),
            (1.0, '0000000000000080ff3f'),
            (0.3, '0098999999999999fd3f'),
            (-2.5, '00000000000000a000c0'),
            (math.inf, '0000000000000080ff7f'),
        ]:
            self.cpu.fpu_push(value)
            top = self.cpu.fpu_top
            self.execute(bytes.fromhex('CD 37 3E 00 01'))
            self.assertEqual(self.mem.read_bytes(0x40100, 10).hex(), encoded)
            self.assertEqual(self.cpu.fpu_top, (top+1)&7)

    def test_packed_decimal_store(self):
        for value, encoded in [(30, '30000000000000000000'),
                               (-1234567890123456, '56341290785634120080'),
                               (-0.0, '00000000000000000080'),
                               (2.5, '02000000000000000000')]:
            self.cpu.fpu_push(float(value))
            self.execute(bytes.fromhex('CD 3B 36 00 01'))
            self.assertEqual(self.mem.read_bytes(0x40100, 10).hex(), encoded)

    def test_packed_decimal_rounding_and_invalid_values(self):
        for mode, digits in [(0, 2), (1, 3), (2, 2), (3, 2)]:
            self.cpu.fpu_cw = 0x037F | mode << 10
            self.cpu.fpu_push(-2.5)
            self.execute(bytes.fromhex('CD 3B 36 00 01'))
            self.assertEqual(self.mem.read8(0x40100), digits)
            self.assertEqual(self.mem.read8(0x40109), 0x80)
        for value in [1e18, math.inf, math.nan]:
            self.cpu.fpu_push(value)
            self.execute(bytes.fromhex('CD 3B 36 00 01'))
            self.assertEqual(self.mem.read_bytes(0x40100, 10).hex(), '00000000000000c0ffff')
            self.assertTrue(self.cpu.fpu_sw & 1)


if __name__ == '__main__':
    unittest.main()
