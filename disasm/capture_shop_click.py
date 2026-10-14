#!/usr/bin/env python3
"""Capture a shop after a native mouse click, supplying mouse driver polls.

Runs native dialog dispatch. Cursor drawing and wall-clock timing are excluded.
"""
import argparse
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state,save_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');parser.add_argument('output');parser.add_argument('x',type=int);parser.add_argument('y',type=int);args=parser.parse_args()
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(Path(__file__).resolve().parent.parent/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
for tick in range(121):
 reason,_=run_fast(c,m,p,h,1000000,bp_set={0x4bda3-0x6100,0x4be8c-0x6100})
 assert reason=='breakpoint',(reason,hex(c.segs[1]*16+c.ip+0x6100))
 if tick==120:break
 sp=c.segs[2]*16+c.regs[4]
 if c.segs[1]*16+c.ip+0x6100==0x4bda3:
  for i,value in enumerate((args.x,args.y)):
   m.write16(m.read16(sp+4+i*4)+16*m.read16(sp+6+i*4),value)
 c.regs[0]=int(tick<60)
 c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
save_state(args.output+'.state',c,m,p,h);m.dump_screen_png(args.output+'.png',p)
print('Saved',args.output,'category',m.read16(0x4fc80+0xcab4),'items',m.read16(0x4fc80+0xcac0))
