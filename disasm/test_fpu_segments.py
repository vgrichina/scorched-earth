"""Borland INT 3Ch must keep far-pointer numeric widgets in separate segments."""
import sys
script_dir = sys.path.pop(0)
import unittest
sys.path.insert(0, script_dir)

from emu.cpu import CPU
from emu.memory import Memory
from emu.fpu import exec_fpu_int
from instruction_set_x86 import _decode_fpu_int


class FPUSegmentTest(unittest.TestCase):
    def setUp(self):
        self.cpu = CPU()
        self.mem = Memory()
        self.cpu.segs[:] = [0x2000, 0x1000, 0x3000, 0x4000]
        self.cpu.regs[3] = 0x100  # BX
        self.cpu.ip = 0

    def instruction(self, encoded, modrm, disp):
        code = bytes([0xCD, 0x3C, encoded, modrm, disp])
        self.mem.data[0x10000:0x10005] = code
        return code

    def test_all_encoded_segments_load_and_store(self):
        for encoded, segment, name in [(0x1D, 3, 'ds'), (0x5D, 2, 'ss'),
                                       (0x9D, 1, 'cs'), (0xDD, 0, 'es')]:
            with self.subTest(segment=name):
                for s in self.cpu.segs:
                    self.mem.write_float64((s << 4) + 0x126, -5.0)
                code = self.instruction(encoded, 0x5F, 0x26)  # FSTP [BX+26]
                self.cpu.fpu_push(2.0)
                self.assertEqual(exec_fpu_int(self.cpu, self.mem, None), 5)
                for i, s in enumerate(self.cpu.segs):
                    self.assertEqual(self.mem.read_float64((s << 4) + 0x126),
                                     2.0 if i == segment else -5.0)
                self.assertEqual(_decode_fpu_int(code, 0)[:3],
                                 (5, 'fstp', f'qword [{name}:bx+0x26]'))
                self.instruction(encoded, 0x47, 0x26)  # FLD [BX+26]
                exec_fpu_int(self.cpu, self.mem, None)
                self.assertEqual(self.cpu.fpu_pop(), 2.0)

    def test_players_and_rounds_do_not_alias(self):
        for segment, value in [(0x2000, 2.0), (0x2100, 10.0)]:
            self.cpu.segs[0] = segment
            self.instruction(0xDD, 0x5F, 0x26)
            self.cpu.fpu_push(value)
            exec_fpu_int(self.cpu, self.mem, None)
        for segment, value in [(0x2000, 2.0), (0x2100, 10.0)]:
            self.cpu.segs[0] = segment
            self.instruction(0xDD, 0x47, 0x26)
            exec_fpu_int(self.cpu, self.mem, None)
            self.assertEqual(self.cpu.fpu_pop(), value)

    def test_ss_extended_real_store_decodes(self):
        self.assertEqual(_decode_fpu_int(bytes.fromhex('CD 3C 5B 3F'), 0)[:3],
                         (4, 'fstp', 'tword [ss:bx]'))


if __name__ == '__main__':
    unittest.main()
