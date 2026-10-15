"""Compare vertical guidance activation to the native per-pixel branch."""
import argparse,itertools,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;m,c,p=Memory(),CPU(),PortIO();p.mem=m
h=InterruptHandler(m,c,str(root/'earth'),p);load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;b=0x90000;cases=[]
m.write16(d+0xceb8,0);m.write16(d+0xceba,0x9000);m.write16(d+0xe4da,0)
for x,y,tx,ty in itertools.product(range(98,103),[98,100,102],[99,100,101],[98,100,102]):
 for off,value in [(0x24,36),(0x44,tx),(0x46,ty),(0x66,7),(0x68,7),(0x6a,0)]:m.write16(b+off,value)
 c.segs[:]=[0,0x1a4a,0x8000,0x4fc8];c.ip=0x22714-0x6100-0x1a4a0;c.regs[4]=0x2400;c.regs[5]=0x2500;c.regs[6]=x;c.regs[7]=y
 reason,detail=run_fast(c,m,p,h,10000,bp_set={0x227a2-0x6100,0x227af-0x6100});assert reason=='breakpoint',(reason,detail)
 active=m.read16(b+0x24)==0
 result=dict(active=active)
 if active:result.update(dx=m.read16(b+0x66),dy=-1 if m.read16(b+0x68)==65535 else m.read16(b+0x68))
 cases.append(dict(x=x,y=y,tx=tx,ty=ty,result=result))
code=r'''
import assert from 'node:assert/strict';
import {triggerVerticalGuidance} from './web/js/guidance-trigger.js';
import {WPN} from './web/js/weapons.js';
let input='';for await(const c of process.stdin)input+=c;
const cases=JSON.parse(input);
for(const c of cases) {
 const p={guidanceType:WPN.VERT_GUIDANCE,guidanceTarget:{x:c.tx,y:c.ty}};
 const active=triggerVerticalGuidance(p,c.x,c.y);
 const result={active,...(active?{dx:p.guidanceCorrX,dy:p.guidanceCorrY}:{})};
 assert.deepEqual(result,c.result);
 if(active)assert.equal(triggerVerticalGuidance(p,c.x,c.y),false);
}
console.log(`${cases.length} native vertical-guidance trigger comparisons pass.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
