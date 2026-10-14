#!/usr/bin/env python3
"""Execute native falling movement, intercepting only pixel reads and RNG draws."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(wind=w,seed=s,block=b,x=x,slide=slide,deployed=d,kind=k,half=h)
 for w in (-100,-50,-11,-10,0,10,11,50,100) for s in range(8)
 for b in range(4) for x,slide in ((12,-1),(50,0),(347,1))
 for d in (False,True) for k,h in ((5,3),(0,4),(2,5))]
port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {pixels,setPixel} from './web/js/framebuffer.js';
import {moveFallingTank} from './web/js/tank.js';
import {seedRandom,random,getRandomState} from './web/js/utils.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 pixels.fill(80);const edge=c.x+c.slide+(c.half+1)*(c.wind<0?-1:1);
 if(c.block&1)setPixel(101,edge,120);if(c.block&2)setPixel(100,edge,120);
 seedRandom(c.seed);const roll=random(100);seedRandom(c.seed);
 const before=getRandomState().index;
 const p={x:c.x,y:100,tankType:c.kind,parachuteDeployed:c.deployed};
 moveFallingTank(p,c.slide,c.wind);
 return {x:p.x,y:p.y,roll,draws:(getRandomState().index-before+250)%250};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,val in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEEF8,0x100),(0xEEFA,0x60)):mem.write16(ds+off,val)
for c,actual in zip(cases,port):
 base=ds+0xD568
 for off,val in ((8,c['half']),(14,c['x']),(16,100),(12,int(c['deployed']))):mem.write16(base+off,val)
 mem.write16(ds+0x515A,c['wind']&65535)
 cpu.segs[:]=[0,0x1A05,0x5F4A,0x4FC8];cpu.ip=0x20919-0x6100-0x1A050
 cpu.regs[5]=0x2400;cpu.regs[4]=0x23C0
 mem.write16(stack+0x23FC,0xD568);mem.write16(stack+0x23FE,0x4FC8);mem.write16(stack+0x23F8,c['slide']&65535)
 draws=0
 for _ in range(10):
  reason,count=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x32E1B-0x6100,0x20A2C-0x6100})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x20A2C-0x6100:break
  sp=stack+cpu.regs[4]
  if addr==0x700:
   x,y=mem.read16(sp+4),mem.read16(sp+6)
   edge=c['x']+c['slide']+(c['half']+1)*(-1 if c['wind']<0 else 1)
   assert y==edge and x in (100,101),(c,x,y)
   cpu.regs[0]=80 if c['block']&(1 if x==101 else 2) else 120
  else:
   assert mem.read16(sp+4)==100
   cpu.regs[0]=actual['roll'];draws+=1
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native wind did not return')
 expected=dict(x=mem.read16(base+14),y=mem.read16(base+16),roll=actual['roll'],draws=draws)
 assert actual==expected,(c,actual,expected)
print(f'{len(cases)} native wind movement cases match, including threshold, RNG calls, transposed obstruction reads and wall clamps.')
