#!/usr/bin/env python3
"""Enter native main_menu from an initialized video/heap checkpoint.

A reconstructed menu entry, not a fresh-process boot or mode-switch proof.
"""
import argparse
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
from emu.state import save_state
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');parser.add_argument('output');parser.add_argument('--max-steps',type=int,default=100000000)
stops=parser.add_mutually_exclusive_group()
stops.add_argument('--stop-at-walk',action='store_true',help='Save before the procedural terrain kernel for seeded comparisons')
stops.add_argument('--stop-before-palette',action='store_true',help='Save before native menu ground-color initialization')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
m.write16(0x4fc80+0x519a,65535)
# Native caller 0x2A828..0x2A83D restores full-screen terrain bounds.
for offset,value in ((0xef42,0),(0xef40,0),(0xef3c,m.read16(0x4fc80+0xef3e)),(0xef38,m.read16(0x4fc80+0xef3a))):
    m.write16(0x4fc80+offset,value)
# A mode-rebuilt checkpoint can retain terrain buffers sized for its old mode.
# Invalidate the fixture cache so native terrain_gen_main allocates fresh buffers.
for offset in (0x6242,0x6244,0x6246,0x6248,0x624a):m.write16(0x4fc80+offset,0)
c.segs[:]=[0,0x357d,0x5f4a,0x4fc8];c.ip=0x1870;c.regs[4]=0x2400
m.write16(0x618a0,0x110);m.write16(0x618a2,0x60)
stop=(0x3d5fd if args.stop_before_palette else 0x29808 if args.stop_at_walk else 0x460c3)-0x6100
reason,steps=run_fast(c,m,p,h,args.max_steps,bp_set={0x710,stop})
assert reason=='breakpoint' and c.segs[1]*16+c.ip==stop,(reason,steps,hex(c.segs[1]*16+c.ip+0x6100))
save_state(args.output+'.state',c,m,p,h);m.dump_screen_png(args.output+'.png',p)
print('Native menu checkpoint:',hex(stop+0x6100),p.get_resolution(),steps,'instructions',flush=True)
