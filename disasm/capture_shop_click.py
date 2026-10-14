#!/usr/bin/env python3
"""Capture a shop after a native mouse click, supplying mouse driver polls.

Runs native dialog dispatch. Cursor drawing, speaker waits and wall-clock
animation timing are excluded.
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
parser.add_argument('checkpoint');parser.add_argument('output');parser.add_argument('x',type=int);parser.add_argument('y',type=int);parser.add_argument('--key',type=lambda value:int(value,0),help='Inject a scan code instead of pressing the mouse');parser.add_argument('--hold-polls',type=int,default=60,help='Mouse poll count before release');parser.add_argument('--button',type=int,choices=[1,2],default=1,help='Native mouse button mask');parser.add_argument('--ascii',type=lambda value:int(value,0),default=0,help='ASCII value accompanying the key scan code');parser.add_argument('--modifiers',type=lambda value:int(value,0),default=0,help='BIOS modifier flags held through the key event');parser.add_argument('--max-steps',type=int,default=5000000,help='Instruction budget between mouse polls; SVGA redraws can exceed one million');args=parser.parse_args()
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(Path(__file__).resolve().parent.parent/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
elapsed=0;max_poll_steps=0
key_events={10:(args.key,args.ascii,args.modifiers),2000:(args.key|0x80,0,args.modifiers)} if args.key is not None else {}
for tick in range(121):
 reason,steps=run_fast(c,m,p,h,args.max_steps,bp_set={0x4bda3-0x6100,0x4be8c-0x6100,0x4c117-0x6100},scheduled_keys={at-elapsed:event for at,event in key_events.items() if at>=elapsed})
 max_poll_steps=max(max_poll_steps,steps)
 elapsed+=steps+1
 assert reason=='breakpoint',(reason,hex(c.segs[1]*16+c.ip+0x6100))
 if tick==120:break
 sp=c.segs[2]*16+c.regs[4]
 if c.segs[1]*16+c.ip+0x6100==0x4bda3:
  for i,value in enumerate((args.x,args.y)):
   m.write16(m.read16(sp+4+i*4)+16*m.read16(sp+6+i*4),value)
 c.regs[0]=args.button if args.key is None and tick<args.hold_polls else 0
 c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
if args.modifiers:m.write8(0x417,0)
save_state(args.output+'.state',c,m,p,h);m.dump_screen_png(args.output+'.png',p)
print('Saved',args.output,'category',m.read16(0x4fc80+0xcab4),'items',m.read16(0x4fc80+0xcac0))

print('Maximum instructions between polls:',max_poll_steps)
