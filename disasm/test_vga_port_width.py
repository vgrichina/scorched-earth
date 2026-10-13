#!/usr/bin/env python3
"""VGA zero high-byte writes and the EXE's Mode X pixel reads."""
import sys
script_dir = sys.path.pop(0)
import unittest
sys.path.insert(0, script_dir)
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast, step


class PortWidthTest(unittest.TestCase):
    def test_word_zero_data_and_byte_index_only(self):
        for port, register, attribute in [(0x3C4, 2, 'seq_regs'), (0x3CE, 4, 'gc_regs'), (0x3D4, 0xC, 'crtc_regs')]:
            for opcode in (0xEE, 0xEF):
                with self.subTest(port=port, opcode=opcode):
                    mem, cpu, ports = Memory(), CPU(), PortIO()
                    ports.mem = mem
                    getattr(ports, attribute)[register] = 3
                    cpu.segs[1], cpu.ip = 0x60, 0x100
                    cpu.ax, cpu.regs[2] = register, port
                    mem.write8(0x700, opcode)
                    step(cpu, mem, ports, None)
                    self.assertEqual(getattr(ports, attribute)[register], 0 if opcode == 0xEF else 3)

    def test_exe_getpixel_reads_all_four_planes(self):
        root = Path(__file__).resolve().parent.parent
        mem, ports = Memory(), PortIO()
        load_exe(root / 'earth/SCORCH.EXE', mem)
        ports.mem = mem
        mem._mode_x = True
        for plane in range(4):
            mem.vga_planes[plane][81 * 90 + 67] = 140 + plane
        for x in (271, 268, 270, 269, 268):
            cpu = CPU()
            handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
            cpu.segs[:] = [0, 0x3E05, 0x5F4A, 0x4FC8]
            cpu.ip, cpu.regs[4] = 0xD, 0x2400
            for i, value in enumerate([0x110, 0x60, x, 81]):
                mem.write16(0x5F4A0 + 0x2400 + 2 * i, value)
            reason, _ = run_fast(cpu, mem, ports, handler, 1000, bp_set={0x710})
            self.assertEqual(reason, 'breakpoint')
            self.assertEqual(cpu.ax, 140 + (x & 3))


if __name__ == '__main__':
    unittest.main()
