#!/usr/bin/env python3
"""Compare native shop palette initialization and two complete callback cycles."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
before=[list(rgb) for rgb in p.palette]
c.segs[:]=[0,0xd00,0x8000,0x4fc8];c.ip=0x160c6-0x6100-0xd000;c.regs[4]=0x2400;c.regs[5]=0x2500
reason,detail=run_fast(c,m,p,h,100000,bp_set={0x1620d-0x6100})
assert reason=='breakpoint',(reason,detail)
m.write16(0x4fc80+0xec,0)
samples=[]
for tick in range(203):
 if tick:
  c.segs[:]=[0,0xd00,0x8000,0x4fc8];c.ip=0x14e34-0x6100-0xd000;c.regs[4]=0x2400
  m.write16(0x82400,0x110);m.write16(0x82402,0x60)
  reason,detail=run_fast(c,m,p,h,100000,bp_set={0x710});assert reason=='breakpoint',(reason,detail)
 for i in list(range(170))+list(range(191,256)):assert list(p.palette[i])==before[i],(tick,i,'native changed unrelated color')
 samples.append([v for rgb in p.palette[170:191] for v in rgb])
code="""
import assert from 'node:assert/strict';
import {palette6,setupShopPalette,tickAccentPalette} from './web/js/palette.js';
palette6.fill(23);setupShopPalette();
for(const [tick,expected] of JSON.parse(process.argv[1]).entries()) {
 if(tick)tickAccentPalette(tick);
 assert.deepEqual(Array.from(palette6.slice(170*3,191*3)),expected,`tick ${tick}`);
 assert(palette6.slice(0,170*3).every(v=>v===23));
 assert(palette6.slice(191*3).every(v=>v===23));
}
console.log('Shop initialization and 202 callbacks match all 21 colors; unrelated colors unchanged.');
"""
subprocess.run(['node','--input-type=module','-e',code,json.dumps(samples)],cwd=root,check=True)
