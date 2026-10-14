#!/usr/bin/env python3
"""Repaint a live shop's native cash bars with explicit accumulated interest.

Leaves cash/inventory and the dialog unchanged; this is a rendering fixture,
not a claim that the balances resulted from a continuous game session.
"""
import argparse,copy
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.state import save_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');parser.add_argument('output');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h);original=copy.deepcopy(c);ds=0x4fc80
assert m.read16(ds+0x50d4)==2,'Fixture requires two shoppers'
def call(address,segment,arguments):
 c.segs[:]=[0,segment,0x8800,0x4fc8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,*arguments]):m.write16(0x88000+0x2400+2*i,v&65535)
 reason,_=run_fast(c,m,p,h,10000000,bp_set={0x710});assert reason=='breakpoint',(hex(address),reason)
for i,value in enumerate((300000,90000)):
 call(0x11b2c,0xb87,[0xd568+0xca*i+0xc2,0x4fc8,value&65535,value>>16])
call(0x16a7a,0xe4c,[])
save_state(args.output,original,m,p,h)
print('Saved native shop fixture with accumulated interest 300000 / 90000:',args.output)
