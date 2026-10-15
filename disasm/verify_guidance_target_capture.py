"""Native target-pointer classification and projectile target-field copying."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;t=d+0xd568;cases=[]
m.write16(d+0x5182,0xd568);m.write16(d+0x5184,0x4fc8)
m.write16(d+0xceb8,0);m.write16(d+0xceba,0x9000)
def run(start,end,cs):
 c.segs[:]=[0,cs,0x8000,0x4fc8];c.ip=start-0x6100-cs*16;c.regs[4]=0x2300;c.regs[5]=0x2400
 reason,detail=run_fast(c,m,p,h,10000,bp_set={end-0x6100})
 assert reason=='breakpoint',(hex(start),reason,detail)
for player in [False,True]:
 for pixel in range(256):
  m.write16(t+0xae,0xd632 if player else 0);m.write16(t+0xb0,0x4fc8 if player else 0)
  m.write16(t+0x3a,240);m.write16(t+0x3c,200)
  if not player:
   # Pixel reader has returned; execute the actual signed threshold/pointer assignment.
   c.regs[0]=pixel;run(0x11322,0x1133b,0x900)
  c.regs[7]=0;m.write16(0x82406,0xd568);m.write16(0x82408,0x4fc8)
  run(0x217b0,0x217fc,0x1a4a)
  ptr=m.read16(0x9003e);segment=m.read16(0x90040)
  reference='player' if ptr==0xd632 else 'dummy' if ptr==0xdd4c else None
  assert (ptr==0 and segment==0) or segment==0x4fc8
  cases.append(dict(player=player,pixel=pixel,point=dict(x=m.read16(0x90044),y=m.read16(0x90046)),reference=reference))
code=r'''
import assert from 'node:assert/strict';
import {captureGuidanceTarget,GUIDANCE_DUMMY_TARGET} from './web/js/guidance-target.js';
let input='';for await(const c of process.stdin)input+=c;
const cases=JSON.parse(input);
for(const c of cases) {
 const target={x:240,y:200,...(c.player?{index:1}:{})};
 const result=captureGuidanceTarget(target,c.pixel);
 assert.deepEqual(result.point,c.point);
 assert.equal(result.reference===target?'player':result.reference===GUIDANCE_DUMMY_TARGET?'dummy':null,c.reference);
 target.x=0;target.y=0;assert.deepEqual(result.point,c.point);
}
console.log(`${cases.length} native target-pointer and coordinate-copy comparisons pass.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
