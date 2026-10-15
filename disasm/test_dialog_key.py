"""A dialog key must be delivered even when capture stopped inside an ISR."""
import sys
script_dir = sys.path.pop(0)
import unittest
sys.path.insert(0, script_dir)

from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu_dialog_key import deliver_key


class DialogKeyTest(unittest.TestCase):
    def test_press_and_release_wait_for_interrupt_enable(self):
        cpu, mem, ports = CPU(), Memory(), PortIO()
        ports.mem = mem
        cpu.segs[:] = [0, 0x2000, 0x1000, 0x3000]
        cpu.sp = 0x8000
        handler = InterruptHandler(mem, cpu, 'earth', ports)
        mem.write16(9 * 4, 0x500)
        mem.write16(9 * 4 + 2, 0)
        mem.data[0x500] = 0xCF  # IRET
        for scancode, ascii_char in [(0x20, 100), (0xA0, 0)]:
            with self.subTest(scancode=scancode):
                cpu.ip = 0
                cpu.intf = False
                # Return from an in-progress interrupt with IF restored.
                cpu.sp = 0x7FFA
                mem.write16(0x17FFA, 0x10)
                mem.write16(0x17FFC, 0x2000)
                mem.write16(0x17FFE, 0x202)
                mem.data[0x20000] = 0xCF  # IRET
                deliver_key(cpu, mem, ports, handler, scancode, ascii_char)
                self.assertEqual(ports.kbd_scancode, scancode)
                self.assertEqual(cpu.segs[1], 0x2000)
                self.assertEqual(cpu.ip, 0x10)
                self.assertEqual(cpu.sp, 0x8000)
                self.assertTrue(cpu.intf)
                if scancode & 0x80:
                    self.assertFalse(handler.key_queue)
                else:
                    self.assertEqual(handler.key_queue.popleft(), (scancode, ascii_char))


if __name__ == '__main__':
    unittest.main()
