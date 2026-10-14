#!/usr/bin/env python3
"""Native particle update body: exact floating state and ordered pixel I/O.
The timer gate is outside this oracle; pixel and sound callbacks are stubbed.
"""
import json,struct,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[]
for x,y in [(100,200),(3,38),(356,476),(2.9,200),(356.1,200),(100,37.9),(100,476.1)]:
 for vx,vy in [(0,40),(.1,40.1),(70,110),(-400,500),(400,-500),(2000,80)]:
  for color in (0,80,104,105,250):
   for wrap in (False,True):cases.append(dict(particles=[dict(x=x,y=y,vx=vx,vy=vy,color=12)],under=color,wrap=wrap))
cases.append(dict(particles=[dict(x=100,y=200,vx=140,vy=40,color=4),dict(x=102,y=200,vx=-140,vy=40,color=12)],under=120,wrap=False))
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {stepDeathParticles} from './web/js/death-particles.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 const events=[],pixels=new Map();
 const active=stepDeathParticles(c.particles,{
  getPixel:(x,y)=>{events.push(['read',x,y]);return pixels.get(`${x},${y}`)??c.under;},
  erasePixel:(x,y)=>{events.push(['erase',x,y]);pixels.set(`${x},${y}`,120);},
  setPixel:(x,y,color)=>{events.push(['write',x,y,color]);pixels.set(`${x},${y}`,color);},
 },{wrap:c.wrap});
 return {particles:c.particles,events,active};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,val in [(0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
 (0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60)]:mem.write16(ds+off,val)
for case,port in zip(cases,actual):
 mem.write16(ds+0x510E,int(case['wrap']))
 cpu.segs[:]=[0,0x2862,0x5F4A,0x4FC8];cpu.ip=0x2ECEC-0x6100-0x28620
 cpu.regs[5]=0x2400;cpu.regs[4]=0x23C0;cpu.regs[7]=len(case['particles'])
 for off,ptr in [(-4,0x3000),(-8,0x3100),(-12,0x3200),(-16,0x3300),(10,0x3400)]:
  mem.write16(stack+0x2400+off,ptr);mem.write16(stack+0x2402+off,0x5F4A)
 mem.write16(stack+0x23EE,0)
 for i,p in enumerate(case['particles']):
  for ptr,key in [(0x3000,'vx'),(0x3100,'vy'),(0x3200,'x'),(0x3300,'y')]:struct.pack_into('<d',mem.data,stack+ptr+i*8,p[key])
  mem.write16(stack+0x3404+i*6,p['color'])
 events=[];pixels={}
 for _ in range(100):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x720,*[a-0x6100 for a in (0x3AB39,0x4C117,0x2F07B)]})
  address=cpu.segs[1]*16+cpu.ip;addr=address+0x6100
  assert reason=='breakpoint',(case,reason,hex(addr))
  if addr==0x2F07B:break
  sp=stack+cpu.regs[4]
  signed=lambda v:v if v<32768 else v-65536
  x,y=[signed(mem.read16(sp+o)) for o in (4,6)]
  if address==0x700:
   events.append(['read',x,y]);cpu.regs[0]=pixels.get((x,y),case['under'])
  elif address==0x720:
   color=mem.read16(sp+8);events.append(['write',x,y,color]);pixels[x,y]=color
  elif addr==0x3AB39:events.append(['erase',x,y]);pixels[x,y]=120
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('particle update did not finish')
 native=[]
 for i,p in enumerate(case['particles']):
  q=dict(color=p['color'])
  for ptr,key in [(0x3000,'vx'),(0x3100,'vy'),(0x3200,'x'),(0x3300,'y')]:q[key]=struct.unpack_from('<d',mem.data,stack+ptr+i*8)[0]
  native.append(q)
 expected=dict(particles=native,events=events,active=bool(mem.read16(stack+0x23EE)))
 assert port==expected,(case,port,expected)
print(f'{len(cases)} native particle updates match exact state, liveness and ordered reads/writes/erasures.')
