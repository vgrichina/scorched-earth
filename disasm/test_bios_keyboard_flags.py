#!/usr/bin/env python3
"""INT 16h/AH=02h returns BIOS flags, independent of incoming AL."""
from emu.cpu import CPU
from emu.memory import Memory
from emu.interrupts import InterruptHandler
m,c=Memory(),CPU();h=InterruptHandler(m,c,'.')
for flags in range(256):
 for stale in (0,8,255):
  m.write8(0x417,flags);c.ax=0x200|stale;h.handle(0x16)
  assert c.get_reg8(0)==flags,(flags,c.ax)
print('768 BIOS keyboard modifier/toggle flag cases pass')

from emu.ports import PortIO
from emu.execute import run_fast
p=PortIO();p.mem=m
for event,expected in [((0x10,0x71),0),((0x10,0x51),2),
                       ((0x10,0x71,8),8),((0x90,0,8),8),((0x90,0,0),0)]:
 c.segs[1]=0;c.ip=0x800;c.intf=False;m.write8(0x800,0x90)
 run_fast(c,m,p,h,1,scheduled_keys={0:event})
 c.ax=0x208;h.handle(0x16)
 assert c.get_reg8(0)==expected,(event,c.ax)
print('Scheduled key legacy/default and explicit modifier cases pass')
