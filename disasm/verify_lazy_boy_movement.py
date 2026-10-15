"""Compare full Lazy Boy callback event order, movement budget and writeback.
Rendering/collision/terrain callees are recorded, not executed: this is not RGB validation.
"""
import argparse,itertools,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;m,c,p=Memory(),CPU(),PortIO();p.mem=m
h=InterruptHandler(m,c,str(root/'earth'),p);load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;b=0x90000;cases=[]
addresses={'erase':0x1a4a0+0x211c+0x6a00,'hit':0x1a4a0+0x2228+0x6a00,'remove':0x1a4a0+0x2827+0x6a00,'draw':0x1a4a0+0x1f5a+0x6a00,'sound':0x4c117,'mark':0x162c0+0x104+0x6a00,'dig':0x32c20+0x1519+0x6a00}
names={v-0x6100:k for k,v in addresses.items()}
for pixel,target,dt,ref in itertools.product([5,8,13,80,105,120],[(180,100),(100,103),(100,100)],[0,.002,.005],[None,1,10]):
 for off,v in [(0xceb8,0),(0xceba,0x9000),(0xe4da,0),(0xeef8,0x100),(0xeefa,0x60),(0xef40,38),(0xe1e8,0)]:m.write16(d+off,v)
 for off,v in [(0,100),(2,100),(0x44,target[0]),(0x46,target[1]),(0x3e,0 if ref is None else 0xd568+ref*0xca),(0x40,0 if ref is None else 0x4fc8),(0x2a,0xd568),(0x2c,0x4fc8)]:m.write16(b+off,v)
 m.write_float64(b+0x14,100);m.write_float64(b+0x1c,100);m.write_float64(d+0xceac,dt)
 c.segs[:]=[0,0x1a4a,0x8000,0x4fc8];c.ip=0x24fcf-0x6100-0x1a4a0;c.regs[4]=0x2400
 m.write16(0x82400,0x110);m.write16(0x82402,0x60)
 events=[];changed={};completed=False
 stops={0x710,0x700,0x25491-0x6100,*names}
 for _ in range(100):
  reason,detail=run_fast(c,m,p,h,100000,bp_set=stops);assert reason=='breakpoint',(reason,detail)
  address=c.segs[1]*16+c.ip
  if address==0x710:break
  if address==0x25491-0x6100:
   completed=True;stops.remove(address);continue
  sp=0x80000+c.regs[4];x=m.read16(sp+4);y=m.read16(sp+6)
  if address==0x700:
   if m.read16(sp)+m.read16(sp+2)*16==0x25390-0x6100:
    events.append(dict(kind='velocity',dx=m.read_float64(b+4),dy=m.read_float64(b+12)))
   c.regs[0]=changed.get((x,y),pixel)
  else:
   kind=names[address]
   if kind=='erase':events.append(dict(kind=kind))
   if kind in ['dig','draw','hit']:
    event=dict(kind=kind,x=x,y=y)
    if kind=='hit':event['pixel']=m.read16(0x80000+c.regs[5]-0x2c)
    events.append(event)
   if kind=='dig':changed[x,y]=120
  c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
 else:raise AssertionError('callback did not finish')
 result=dict(completed=completed)
 if completed:result.update(x=m.read_float64(b+20),y=m.read_float64(b+28),ix=m.read16(b),iy=m.read16(b+2))
 cases.append(dict(pixel=pixel,target=dict(zip(['x','y'],target)),dt=dt,ref=ref,events=events,result=result))
code=r'''
import assert from 'node:assert/strict';
import {lazyBoyMovement} from './web/js/lazy-boy.js';
let input='';for await(const c of process.stdin)input+=c;
const cases=JSON.parse(input);
for(const c of cases) {
 const changed=new Map(),events=[];
 const gen=lazyBoyMovement({x:100,y:100,target:c.target,referenceIndex:c.ref,attackerIdx:0},c.dt,(x,y)=>changed.get(`${x},${y}`)??c.pixel);
 let step;while(!(step=gen.next()).done) {events.push(step.value);if(step.value.kind==='dig')changed.set(`${step.value.x},${step.value.y}`,120);}
 assert.deepEqual(events,c.events,JSON.stringify(c));assert.deepEqual(step.value,c.result,JSON.stringify(c));
}
console.log(`${cases.length} native Lazy Boy callback event/budget/writeback comparisons pass.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
