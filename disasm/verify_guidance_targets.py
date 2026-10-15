"""Compare native digit and nearest-player guidance target selection."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;cases=[]
for xs in [(80,240),(240,80),(160,160)]:
 for alive in [(0,0),(1,0),(0,1),(1,1)]:
  for current in [0,1]:
   m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p);load_state(args.checkpoint,c,m,p,h)
   d=0x4fc80
   m.write16(d+0x50d4,2);m.write16(d+0xe340,sum(alive));m.write16(d+0x5182,0xd568+0xca*current);m.write16(d+0x5184,0x4fc8)
   for i in range(2):
    t=d+0xd568+0xca*i
    for off,v in [(0xe,xs[i]),(0x10,100),(0x18,alive[i]),(0xa0,i)]:m.write16(t+off,v)
   def call(address,arguments):
    c.segs[:]=[0,0x900,0x8000,0x4fc8];c.ip=address-0x6100-0x9000
    if c.ip>65535:c.segs[1]=0x1fa0;c.ip=address-0x6100-0x1fa00
    c.regs[4]=0x2400
    for j,v in enumerate([0x110,0x60,*arguments]):m.write16(0x82400+2*j,v&65535)
    reason,detail=run_fast(c,m,p,h,100000,bp_set={0x710});assert reason=='breakpoint',(reason,detail)
    if c.regs[0]==0 and c.regs[2]==0:return None
    assert c.regs[2]==0x4fc8
    return (c.regs[0]-0xd568)//0xca
   digits=[call(0x11341,[digit-1]) for digit in range(0,4)]
   points=[(0,100),(80,100),(160,100),(240,100),(340,100),(80,199),(80,200),(160,101)]
   mouse=[call(0x26491,[x,y,100]) for x,y in points]
   cases.append(dict(xs=xs,alive=alive,current=current,digits=digits,points=points,mouse=mouse))
code=r'''
import assert from 'node:assert/strict';
import {guidanceDigitTarget,guidanceMouseTarget} from './web/js/guidance-target.js';
let input='';for await(const c of process.stdin)input+=c;
for(const c of JSON.parse(input)) {
 const roster=c.xs.map((x,i)=>({index:i,x,y:100,alive:!!c.alive[i]}));
 const digits=Array.from({length:4},(_,i)=>guidanceDigitTarget(roster,roster[c.current],i)?.index??null);
 assert.deepEqual(digits,c.digits,JSON.stringify(c));
 assert.deepEqual(c.points.map(([x,y])=>guidanceMouseTarget(roster,x,y)?.index??null),c.mouse,JSON.stringify(c));
}
console.log('288 native digit/nearest-target selections match, covering dead tanks, self-selection, x ties and the 100-pixel boundary.');
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
