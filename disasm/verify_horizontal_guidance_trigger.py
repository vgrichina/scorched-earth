"""Diagnose horizontal guidance activation against the current production port.

Runs the native direction callee with obstacle avoidance disabled. Stops before
the drawing callback; this does not verify guided flight or impact rendering."""
import argparse,itertools,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;m,c,p=Memory(),CPU(),PortIO();p.mem=m
h=InterruptHandler(m,c,str(root/'earth'),p);load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;b=0x90000;cases=[]
m.write16(d+0xceb8,0);m.write16(d+0xceba,0x9000);m.write16(d+0xe4da,0)
m.write16(d+0x510e,0)
for x,y,tx,ty,vy in itertools.product([98,100,102],range(97,104),[100],[100],[-10.,0.,10.]):
 for off,value in [(0x24,35),(0x44,tx),(0x46,ty),(0x66,7),(0x68,7),(0x6a,0)]:m.write16(b+off,value)
 m.write_float64(b+12,vy)
 c.segs[:]=[0,0x1a4a,0x8000,0x4fc8];c.ip=0x22660-0x6100-0x1a4a0;c.regs[4]=0x2400;c.regs[5]=0x2500;c.regs[6]=x;c.regs[7]=y
 reason,detail=run_fast(c,m,p,h,10000,bp_set={0x226eb-0x6100,0x226f8-0x6100});assert reason=='breakpoint',(reason,detail)
 active=m.read16(b+0x24)==0
 result=dict(active=active)
 if active:result.update(dx=-1 if m.read16(b+0x66)==65535 else m.read16(b+0x66),dy=-1 if m.read16(b+0x68)==65535 else m.read16(b+0x68))
 cases.append(dict(x=x,y=y,tx=tx,ty=ty,vy=vy,result=result))
code=r'''
import {applyGuidance} from './web/js/behaviors.js';
import {WPN} from './web/js/weapons.js';
let input='';for await(const c of process.stdin)input+=c;
const cases=JSON.parse(input);let failures=0;const examples=[];
for(const c of cases) {
 const p={x:c.x,y:c.y,vx:0,vy:c.vy,guidanceType:WPN.HORZ_GUIDANCE,guidanceTarget:{x:c.tx,y:c.ty}};
 applyGuidance(p);
 const active=p.guidanceType===0;
 const result={active,...(active?{dx:p.guidanceCorrX,dy:p.guidanceCorrY}:{})};
 if(JSON.stringify(result)!==JSON.stringify(c.result)) {
  failures++;if(examples.length<8)examples.push({...c,port:result});
 }
}
console.log(JSON.stringify({cases:cases.length,failures,examples},null,2));
process.exitCode=failures?1:0;
'''
raise SystemExit(subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True).returncode)
