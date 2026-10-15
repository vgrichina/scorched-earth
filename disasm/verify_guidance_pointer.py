"""Compare native held-button target dispatch, including inclusive bounds."""
import argparse,itertools,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;t=d+0xd568
for off,value in [(0x5182,0xd568),(0x5184,0x4fc8),(0x50d4,2),(0xef42,3),(0xef3c,356),(0xef40,38),(0xef38,476)]:m.write16(d+off,value)
for i,x in enumerate([80,240]):
 for off,value in [(14,x),(16,200),(24,1),(160,i)]:m.write16(t+i*0xca+off,value)
points=[(2,200),(3,200),(356,200),(357,200),(80,37),(80,38),(80,476),(80,477),(80,200),(240,200),(160,200),(80,299),(80,300)]
cases=[]
for (x,y),buttons in itertools.product(points,range(8)):
 m.write16(t+0xae,0);m.write16(t+0xb0,0);m.write16(t+0x3a,0);m.write16(t+0x3c,0)
 c.segs[:]=[0,0x900,0x8000,0x4fc8];c.ip=0x111fe-0x6100-0x9000
 c.regs[4]=0x2300;c.regs[5]=0x2400;c.regs[7]=0;c.regs[0]=buttons
 m.write16(0x82400-10,x);m.write16(0x82400-12,y)
 for _ in range(3):
  reason,detail=run_fast(c,m,p,h,100000,bp_set={0x112d3-0x6100,0x4c117-0x6100})
  assert reason=='breakpoint',(x,y,buttons,reason,detail)
  if c.segs[1]*16+c.ip==0x112d3-0x6100:break
  # Audible invalid-target feedback only; selection logic has already run.
  sp=c.segs[2]*16+c.regs[4];c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
 else:raise AssertionError('dispatch failed to return')
 result=None
 if c.regs[7]:
  ptr=m.read16(t+0xae)
  result=dict(player=(ptr-0xd568)//0xca) if ptr else dict(x=m.read16(t+0x3a),y=m.read16(t+0x3c))
 cases.append(dict(x=x,y=y,buttons=buttons,result=result))
code=r'''
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {guidancePointerTarget} from './web/js/guidance-target.js';
Object.assign(config,{screenWidth:360,screenHeight:480});
const roster=[80,240].map((x,index)=>({x,y:200,index,alive:true}));
let input='';for await(const c of process.stdin)input+=c;
const cases=JSON.parse(input);
for(const c of cases) {
 const target=guidancePointerTarget(roster,c.x,c.y,c.buttons);
 const result=target===null?null:target.index===undefined?target:{player:target.index};
 assert.deepEqual(result,c.result,JSON.stringify(c));
}
console.log(`${cases.length} native held-button/boundary/precedence target comparisons pass.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
