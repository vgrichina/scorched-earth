#!/usr/bin/env python3
"""Check VGA identification and the actual Fastgraph mode-19 probe."""
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
m,c,p=Memory(),CPU(),PortIO();p.mem=m
root=Path(__file__).resolve().parent.parent
load_exe(root/'earth/SCORCH.EXE',m)
h=InterruptHandler(m,c,str(root/'earth'),p)
for stale in (0,0xffff,0x1234):
 c.ax=0x1a00;c.bx=stale;c.cx=0x1234;c.dx=0x5678
 h.handle(0x10)
 assert (c.ax,c.bx,c.cx,c.dx)==(0x1a1a,8,0x1234,0x5678)
for page,expected in ((0,1),(1,1),(65,0)):
 c.segs[:]=[0,0x4c00,0x8800,0x4fc8];c.ip=0x5210a-0x6100-0x4c000;c.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,19,page)):m.write16(0x8a400+2*i,v)
 reason,_=run_fast(c,m,p,h,100000,bp_set={0x710})
 assert reason=='breakpoint',reason
 assert c.ax==expected,(page,c.ax,expected)
print('BIOS color-VGA identification and three native Fastgraph mode-19 probes pass.')
# Reserved sequencer registers must not impersonate a vendor extension.
for idx in (5,6,7):
 p.port_out(0x3c4,idx)
 for value in (0,0x12,0xff):
  p.port_out(0x3c5,value)
  assert p.port_in(0x3c5)==0xff,(idx,value)
# Execute native automatic adapter detection, without forcing the VESA branch.
# A writable register 6 used to return adapter 20 before reaching this query.
queries=[]
h.on_int=lambda n,ah: queries.append(c.ax) if n==0x10 else None
c.segs[:]=[0,0x4ab1,0x8800,0x4fc8];c.ip=0x50c13-0x6100-0x4ab10;c.regs[4]=0x2400
for i,v in enumerate((0x110,0x60,0)):m.write16(0x8a400+2*i,v)
reason,_=run_fast(c,m,p,h,100000,bp_set={0x710})
assert reason=='breakpoint',reason
assert 0x4f03 in queries,queries
assert c.ax!=20,c.ax
print('Reserved sequencer registers and native automatic VESA-query path pass.')
