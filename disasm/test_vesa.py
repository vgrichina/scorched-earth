#!/usr/bin/env python3
"""Check VESA memory banks, native-callable callback, captures and checkpoints."""
import sys
script_dir=sys.path.pop(0)
import unittest
sys.path.insert(0,script_dir)
import tempfile
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.execute import run_fast
from emu.state import save_state,load_state
from emu.vesa import MODES,BANK_CALLBACK
from compare_pipeline import extract_display_pixels
from compare_screenshots import read_png

class VesaTests(unittest.TestCase):
 def setUp(self):
  self.m,self.c,self.p=Memory(),CPU(),PortIO()
  self.p.mem=self.m
  self.h=InterruptHandler(self.m,self.c,'.',self.p)
 def bios(self,fn,bx=0,cx=0,dx=0):
  self.c.ax=0x4f00+fn;self.c.bx=bx;self.c.cx=cx;self.c.dx=dx
  self.h.handle(0x10)
  return self.c.ax
 def test_modes_and_banks(self):
  for mode,(w,h) in MODES.items():
   self.c.segs[0]=0x8000;self.c.regs[7]=0
   self.assertEqual(self.bios(1,cx=mode),0x4f)
   self.assertEqual((self.m.read16(0x80012),self.m.read16(0x80014)),(w,h))
   self.assertEqual(self.bios(2,bx=mode),0x4f)
   self.assertEqual(self.p.get_resolution(),(w,h))
   self.assertFalse(self.p.mode_x)
   for bank in (0,1,7,15):
    self.assertEqual(self.bios(5,dx=bank),0x4f)
    self.m.write32(0xafffc,0x12345600+bank)
   for bank in (15,7,1,0):
    self.bios(5,dx=bank)
    self.assertEqual(self.m.read32(0xafffc),0x12345600+bank)
   self.assertEqual(self.bios(5,dx=16),0x14f)
   self.assertEqual(self.p.vesa_bank,0)
   self.assertEqual(self.bios(2,bx=mode|0x4000),0x14f)
   self.bios(2,bx=mode|0x8000)
   self.assertEqual(self.m.read32(0xafffc),0x12345600)
   self.bios(2,bx=mode)
   self.assertFalse(any(self.m.vesa_vram))
  self.assertEqual(self.bios(1,cx=0x999),0x14f)
  self.assertEqual(self.bios(0xff),0x14f)
 def test_callback_capture_and_round_trip(self):
  self.c.segs[0]=0x8000;self.c.regs[7]=0
  self.bios(1,cx=0x100);self.bios(2,bx=0x100)
  self.c.segs[:]=[0,0xf000,0x8800,0];self.c.ip=BANK_CALLBACK-0xf0000
  self.c.regs[4]=0x2400;self.c.bx=0;self.c.dx=3
  self.m.write16(0x8a400,0x110);self.m.write16(0x8a402,0x60)
  reason,_=run_fast(self.c,self.m,self.p,self.h,100,bp_set={0x710})
  self.assertEqual(reason,'breakpoint');self.assertEqual(self.p.vesa_bank,3)
  self.m.write8(0xa0000,73)
  self.assertEqual(self.m.vesa_vram[3*65536],73)
  self.m.vesa_vram[640*400]=77
  self.assertEqual(self.bios(7,dx=400),0x4f)
  self.assertEqual(extract_display_pixels(self.m,self.p)[0],77)
  self.p.palette[77]=(63,0,0)
  with tempfile.TemporaryDirectory() as folder:
   state=Path(folder)/'video.state';png=Path(folder)/'video.png'
   save_state(state,self.c,self.m,self.p,self.h)
   self.m.dump_screen_png(png,self.p)
   w,h,rgba=read_png(png)
   self.assertEqual((w,h),(640,400));self.assertEqual(list(rgba[:3]),[255,0,0])
   self.bios(2,bx=0x105)
   load_state(state,self.c,self.m,self.p,self.h)
   self.assertEqual((self.p.vesa_mode,self.p.vesa_bank,self.p.vesa_start),(0x100,3,256000))
   self.assertEqual(self.m.read8(0xa0000),73)
   self.assertEqual(extract_display_pixels(self.m,self.p)[0],77)
  self.p.set_mode(0x13)
  self.assertFalse(self.m._vesa);self.assertEqual(self.p.get_resolution(),(320,200))

if __name__=='__main__':unittest.main()
