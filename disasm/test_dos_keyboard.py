"""DOS extended-key byte reads and status must not consume the next key."""
import sys
script_dir = sys.path.pop(0)
import unittest
sys.path.insert(0, script_dir)
from emu.cpu import CPU
from emu.memory import Memory
from emu.interrupts import InterruptHandler

class DosKeyboardTest(unittest.TestCase):
    def setUp(self):
        self.cpu=CPU()
        self.handler=InterruptHandler(Memory(),self.cpu,'.')
    def call(self,ah):
        self.cpu.ax=ah<<8
        self.handler.handle(0x21)
        return self.cpu.get_reg8(0)
    def test_extended_bytes_and_following_ascii(self):
        self.handler.push_key(0x4b,0)
        self.handler.push_key(0xcb,0)  # release is not a DOS character
        self.handler.push_key(0x1e,ord('a'))
        self.assertEqual(self.call(0x0b),0xff)
        self.assertEqual(self.call(0x07),0)
        self.assertEqual(self.call(0x0b),0xff)
        self.assertEqual(self.call(0x07),0x4b)
        self.assertEqual(self.call(0x07),ord('a'))
        self.assertEqual(self.call(0x0b),0)
        self.cpu.ip=0x802
        self.call(0x07)
        self.assertEqual(self.cpu.ip,0x800,'empty read must wait')
    def test_pending_scan_keeps_input_ready(self):
        self.handler.push_key(0x3b,0)
        self.assertEqual(self.call(0x07),0)
        self.assertFalse(self.handler.key_queue)
        self.assertEqual(self.call(0x0b),0xff)
        self.assertEqual(self.call(0x07),0x3b)
        self.assertEqual(self.call(0x0b),0)
    def test_bios_read_is_single_word(self):
        self.handler.push_key(0x4d,0)
        self.cpu.ax=0
        self.handler.handle(0x16)
        self.assertEqual(self.cpu.ax,0x4d00)
        self.assertEqual(self.call(0x0b),0)

if __name__=='__main__': unittest.main()
