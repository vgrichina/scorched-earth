"""Compare Lazy Boy movement decisions before collision/dig/render side effects."""
import argparse,itertools,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;cases=[]
m.write16(d+0xceb8,0);m.write16(d+0xceba,0x9000);m.write16(d+0xe4da,0)
m.write16(d+0xeef8,0x100);m.write16(d+0xeefa,0x60);m.write16(d+0xef40,38)
for (x,y),target,pixel,fallbackPixel,reference in itertools.product(
 [(100.,100.),(100.75,100.25),(100.,38.)],[(180,100),(20,80),(100,180),(100,100)],
 [0,8,79,80,104,105,106,120],[8,80,105,120],[None,1,10]):
 c.segs[:]=[0,0x1a4a,0x8000,0x4fc8];c.ip=0x25037-0x6100-0x1a4a0
 c.regs[4]=0x2300;c.regs[5]=0x2400;c.regs[7]=int(x)
 m.write16(0x823fe,int(y));m.write_float64(0x823f6,x);m.write_float64(0x823ee,y)
 for off,v in [(0x44,target[0]),(0x46,target[1]),(0x3e,0 if reference is None else 0xd568+reference*0xca),(0x40,0 if reference is None else 0x4fc8)]:m.write16(0x90000+off,v)
 reads=[]
 for _ in range(4):
  reason,detail=run_fast(c,m,p,h,100000,bp_set={0x700,*[a-0x6100 for a in [0x252fc,0x25250,0x254e1,0x25468]]})
  assert reason=='breakpoint',(reason,detail)
  address=c.segs[1]*16+c.ip
  if address!=0x700:break
  sp=0x80000+c.regs[4];reads.append([m.read16(sp+4),m.read16(sp+6)])
  c.regs[0]=pixel if len(reads)==1 else fallbackPixel;c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
 else:raise AssertionError('route did not terminate')
 result=dict(atTarget=True) if address==0x254e1-0x6100 else dict(
 dx=m.read_float64(0x823e6),dy=m.read_float64(0x823de),stepX=m.read16(0x823dc),stepY=m.read16(0x823da))
 if 'atTarget' not in result:
  for k in ['stepX','stepY']:
   if result[k]>=32768:result[k]-=65536
  result.update(nextX=int(x)+result['stepX'],nextY=int(y)+result['stepY'])
  if address==0x25468-0x6100:result['subpixel']=True
  else:result.update(pixel=m.read16(0x823d4),blocked=address==0x25250-0x6100)
 cases.append(dict(x=x,y=y,target=dict(zip(['x','y'],target)),pixel=pixel,fallbackPixel=fallbackPixel,reference=reference,result=result,reads=reads))
code=r'''
import assert from 'node:assert/strict';
import {lazyBoyRouteStep} from './web/js/lazy-boy.js';
let input='';for await(const c of process.stdin)input+=c;
const cases=JSON.parse(input);
for(const c of cases) {
 const reads=[];const result=lazyBoyRouteStep(c.x,c.y,c.target,c.reference,38,(x,y)=>{reads.push([x,y]);return reads.length===1?c.pixel:c.fallbackPixel;});
 assert.deepEqual(result,c.result,JSON.stringify(c));assert.deepEqual(reads,c.reads,JSON.stringify(c));
}
console.log(`${cases.length} native Lazy Boy movement and pixel-read sequences match.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
