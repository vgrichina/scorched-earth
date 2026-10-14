#!/usr/bin/env python3
"""Capture native team rankings with explicit team fixture names/scores.

Uses an initialized two-player video/heap checkpoint. Enters rankings directly;
not a round-award or port rendering comparison. Saves state, PNG and widgets.
Team rows are painted directly by 0x33B63, so they appear in the PNG but
are not represented by text widgets in the JSON dump.
"""
import argparse,json
from pathlib import Path
from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.execute import run_fast
from emu.state import load_state,save_state
from emu_dialog_key import deliver_key
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');parser.add_argument('output',type=Path)
parser.add_argument('--final',action='store_true')
parser.add_argument('--team-view',action='store_true')
args=parser.parse_args();root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h);ds=0x4FC80;stack=0x5F4A0

def call(address,segment,arguments=(),stop=0x710):
 c.segs[:]=[0,segment,0x5F4A,0x4FC8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
 for i,value in enumerate([0x110,0x60,*arguments]):m.write16(stack+0x2400+i*2,value&65535)
 reason,count=run_fast(c,m,p,h,10000000,bp_set={stop})
 assert reason=='breakpoint',(reason,count,hex(c.segs[1]*16+c.ip+0x6100))
for off,value in ((0x519A,65535),(0x50D4,2),(0x50EA,1),(0x5148,1),(0xE342,10 if args.final else 1),(0x5160,10),(0x50F6,0),(0x5188,0)):
 m.write16(ds+off,value)
for i in range(10):m.write16(ds+0xE1EC+i*22,0)
for i,(name,score,wins) in enumerate([('Red',5000,1),('Blue',-1500,0)]):
 team=0xE1EC+22*i;tank=0xD568+0xCA*i
 for j,ch in enumerate(name.encode()+b'\0'):m.write8(0x90000+64*i+j,ch)
 for off,value in ((0,1),(4,wins),(6,64*i),(8,0x9000)):m.write16(ds+team+off,value)
 m.write16(ds+tank+0x30,i)
 call(0x11B2C,0xB87,[team+10,0x4FC8,score&65535,(score>>16)&65535])
call(0x33FC3,0x2D54,stop=0x460C3-0x6100)
if args.team_view:
 deliver_key(c,m,p,h,0x14,116)
 run_fast(c,m,p,h,1000000,timer_period=1000,tick_addr=ds+0xEE78,isr_divisor=200)
 deliver_key(c,m,p,h,0x94,0)
 reason,_=run_fast(c,m,p,h,10000000,bp_set={0x460C3-0x6100},timer_period=1000,tick_addr=ds+0xEE78,isr_divisor=200)
 assert reason=='breakpoint',reason
bp=c.segs[2]*16+c.regs[5];dialog=m.read16(bp+6)+16*m.read16(bp+8)
def text_at(a):
 ptr=m.read16(a)+16*m.read16(a+2);out=[]
 for j in range(100):
  b=m.read8(ptr+j)
  if b==0:break
  out.append(b)
 return bytes(out).decode('cp437')
widgets=[]
for i in range(m.read16(dialog+8)):
 a=m.read16(dialog+0x20+4*i)+16*m.read16(dialog+0x22+4*i)
 widgets.append(dict(index=i,type=m.read16(a),text=text_at(a+0x12) if m.read16(a)!=9 else None,
   bounds=[m.read16(a+o) for o in (0x48,0x4A,0x4C,0x4E)]))
args.output.parent.mkdir(parents=True,exist_ok=True)
save_state(str(args.output)+'.state',c,m,p,h);m.dump_screen_png(str(args.output)+'.png',p)
result=dict(bounds=[m.read16(dialog+o) for o in (0,2,4,6)],widgets=widgets)
args.output.with_suffix('.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
