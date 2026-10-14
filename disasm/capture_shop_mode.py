#!/usr/bin/env python3
"""Rebuild native shop after native graphics initialization in another mode.

Reuses initialized players/economy from a checkpoint; not a boot-to-shop proof.
Executes graphics init, player palette/bounds setup, and the native shop builder.
Clears the new framebuffer through the native rectangle routine before setup;
invalidates the cached shop header layout so the new width is used.
"""
import argparse
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.state import save_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');parser.add_argument('output');parser.add_argument('mode',type=int,choices=range(5));args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
h.on_int=lambda n,ah: print('DOS:',m.read_bytes(m.phys(c.segs[3],c.dx),c.cx),flush=True) if n==0x21 and ah==0x40 and c.bx in (1,2) else None
player=[m.read16(ds+0xcab8),m.read16(ds+0xcaba)]
m.write16(ds+0xee,1);m.write16(ds+0x519a,65535);m.write16(ds+0x6e26,args.mode)
def call(address,segment,arguments=(),stop=0x710):
 c.segs[:]=[0,segment,0x8800,0x4fc8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,*arguments]):m.write16(0x8a400+2*i,v&65535)
 reason,steps=run_fast(c,m,p,h,5000000,bp_set={stop})
 assert reason=='breakpoint',(hex(address),reason,steps,hex(c.segs[1]*16+c.ip+0x6100))
call(0x45413,0x3f31)
expected=[(320,200),(320,240),(320,400),(320,480),(360,480)][args.mode]
assert p.get_resolution()==expected,(args.mode,p.get_resolution(),expected)
print('Graphics initialized:',p.get_resolution(),flush=True)
segment=m.read16(ds+0xef16);address=0x6100+16*segment+m.read16(ds+0xef14)
call(address,segment,[0,0,m.read16(ds+0xef3e),m.read16(ds+0xef3a),m.read16(ds+0xef28)])
call(0x28592,0x20a4)
call(0x2905d,0x20a4)
print('Bounds:',[m.read16(ds+a) for a in (0xef42,0xef40,0xef3c,0xef38)],flush=True)
call(0x16068,0xe4c,[*player,0],stop=0x460c3-0x6100)
save_state(args.output+'.state',c,m,p,h);m.dump_screen_png(args.output+'.png',p)
print('Saved',args.output,'resolution',p.get_resolution(),'rows',m.read16(ds+0xcabe),flush=True)
