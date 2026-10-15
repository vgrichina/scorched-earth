"""Compare native attraction velocity and overshoot action before render/impact."""
import argparse,itertools,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p);load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;b=0x90000;cases=[]
m.write16(d+0xceb8,0);m.write16(d+0xceba,0x9000);m.write16(d+0xe4da,0)
for x,y,sx,sy,mode,dt in itertools.product([90.,99.99,100.,110.],[90.,100.,110.],[-1,0,1],[-1,0,1],[0,1,2],[0.,.002,.02]):
 for off,v in [(0x44,100),(0x46,100),(0x66,sx),(0x68,sy),(0x6a,mode),(0x4c,0x99c),(0x4e,0x1e50)]:m.write16(b+off,v&65535)
 for off,v in [(4,13.),(12,-17.),(20,x),(28,y)]:m.write_float64(b+off,v)
 m.write_float64(d+0xceac,dt)
 c.segs[:]=[0,0x1a4a,0x8000,0x4fc8];c.ip=0x2589c-0x6100-0x1a4a0;c.regs[4]=0x2400
 m.write16(0x82400,0x110);m.write16(0x82402,0x60)
 reason,detail=run_fast(c,m,p,h,100000,bp_set={0x710,0x25a0f-0x6100});assert reason=='breakpoint',(reason,detail)
 action='explode' if c.segs[1]*16+c.ip!=0x710 else 'disable' if m.read16(b+0x4e)==0 else 'continue'
 cases.append(dict(x=x,y=y,sx=sx,sy=sy,mode=mode,dt=dt,result=dict(action=action,vx=m.read_float64(b+4),vy=m.read_float64(b+12))))
code=r'''
import assert from 'node:assert/strict';
import {applyGuidance} from './web/js/behaviors.js';
import {guidanceAttractionStep} from './web/js/guidance-attraction.js';
let input='';for await(const c of process.stdin)input+=c;const cases=JSON.parse(input);
for(const c of cases){const result=guidanceAttractionStep({x:c.x,y:c.y,vx:13,vy:-17},{x:100,y:100},c.sx,c.sy,c.mode,c.dt);assert.deepEqual(result,c.result,JSON.stringify(c));
 if(c.mode===2 && c.dt===.02) {
  const p={x:c.x,y:c.y,vx:13,vy:-17,heatTarget:{x:100,y:100},heatWindX:c.sx,heatWindY:c.sy};
  assert.equal(applyGuidance(p),undefined);
  assert.deepEqual({action:p.heatTarget?'continue':'disable',vx:p.vx,vy:p.vy},c.result,JSON.stringify(c));
 }
}
console.log(`${cases.length} native attraction comparisons pass, including 108 production Heat callbacks.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
