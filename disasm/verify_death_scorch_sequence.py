#!/usr/bin/env python3
"""Effect-8 full control flow with real native RNG and soil helpers.
Pixel, tank-rendering, palette and dirty-marking callbacks are intercepted.
This verifies dispatch/order and RNG, not tank rasterization or frame timing.
"""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(x=x,y=y,seed=seed,ground=ground) for x,y,seed,ground in
 [(180,240,0,[24,16,8]),(3,450,17,[63,0,31]),(356,476,1234,[0,63,63]),
  (180,466,42,[17,33,51]),(180,467,43,[17,33,51])]]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {deathScorchSequence} from './web/js/death-scorch.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 seedRandom(c.seed);const initial=getRandomState(),events=[],painted=new Map();
 const colors=[0,80,104,105,106,120,170,200,255];
 const key=(x,y)=>`${x},${y}`;
 const io={
  getPixel:(x,y)=>{events.push(['read',x,y]);return painted.get(key(x,y))??colors[((x+y*7)%9+9)%9];},
  setPixel:(x,y,color)=>{events.push(['write',x,y,color]);painted.set(key(x,y),color);},
  restorePixel:(x,y)=>{events.push(['restore',x,y]);painted.set(key(x,y),120);},
  palette:colors=>colors.forEach((rgb,i)=>events.push(['palette',i,...rgb])),
  eraseBarrel:()=>events.push(['barrel']),
  drawTank:(tank,erase)=>events.push(['tank',tank.y,+erase]),
  setupTank:tank=>events.push(['setup',tank.y]),
  beginCycle:(...args)=>events.push(['beginCycle',...args]),
  cycle:(...args)=>events.push(['cycle',...args]),
  markDirty:(...args)=>events.push(['dirty',...args])};
 const tank={x:c.x,y:c.y};
 const frames=[...deathScorchSequence(tank,io,{ground:c.ground})];
 return {initial,events,final:getRandomState(),y:tank.y,frames:frames.length};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack,tank=0x4FC80,0x5F4A0,0xD568
 for off,val in [(0x519A,65535),(0xEF46,0),(0xEF40,38),(0xEF38,476),
  (tank+0xE,case['x']),(tank+0x10,case['y']),(0xEC06,port['initial']['index']),
  *zip((0xDD4C,0xDD4E,0xDD50),case['ground'])]:mem.write16(ds+off,val)
 callbacks={0xEEF8:0x100,0xEEF4:0x120,0xEF08:0x130,0xEEFC:0x140,0xEF00:0x150,0xEF04:0x160}
 for off,value in callbacks.items():mem.write16(ds+off,value);mem.write16(ds+off+2,0x60)
 for i,word in enumerate(port['initial']['words']):mem.write16(ds+0xEA12+i*2,word)
 cpu.segs[:]=[0,0x200F,0x5F4A,0x4FC8];cpu.ip=0x5B99;cpu.regs[4]=0x2400
 for i,val in enumerate([0x110,0x60,tank,0x4FC8]):mem.write16(stack+0x2400+i*2,val)
 dirty=0x162C*16+0x104+0x6A00
 setup=0x3912*16+0x15D+0x6A00
 hooks={a-0x6100 for a in (0x403F5,0x3FB27,setup,0x3AB39,dirty)}|{0x700,0x710,0x720,0x730,0x740,0x750,0x760}
 events=[];painted={};colors=[0,80,104,105,106,120,170,200,255]
 signed=lambda v:v if v<32768 else v-65536
 for _ in range(200000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set=hooks)
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(case,reason,hex(addr+0x6100))
  if addr==0x710:break
  sp=stack+cpu.regs[4];args=[signed(mem.read16(sp+o)) for o in (4,6,8,10)]
  x,y=args[:2]
  if addr==0x700:
   events.append(['read',x,y]);cpu.ax=painted.get((x,y),colors[(x+y*7)%9])
  elif addr==0x720:
   events.append(['write',*args[:3]]);painted[x,y]=args[2]
  elif addr==0x730:events.append(['palette',*args])
  elif addr==0x750:events.append(['beginCycle',*args[:2]])
  elif addr==0x760:events.append(['cycle',*args[:2]])
  elif addr==0x403F5-0x6100:events.append(['barrel'])
  elif addr==0x3FB27-0x6100:events.append(['tank',mem.read16(ds+tank+0x10),args[3]])
  elif addr==setup-0x6100:events.append(['setup',mem.read16(ds+tank+0x10)])
  elif addr==0x3AB39-0x6100:
   events.append(['restore',x,y]);painted[x,y]=120
  elif addr==dirty-0x6100:events.append(['dirty',x,y])
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('scorch sequence did not finish')
 if events!=port['events']:
  for i,(native,js) in enumerate(zip(events,port['events'])):
   assert native==js,(case,i,native,js)
  raise AssertionError(('event count',len(events),len(port['events'])))
 assert mem.read16(ds+tank+0x10)==port['y']
 final=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert final==port['final'],(case,'RNG state differs')
 print(f"seed={case['seed']} y={case['y']}->{port['y']}: {len(events)} ordered callbacks match")
print(f'{len(cases)} native effect-8 sequences match palette, sinking, beam, sparks, cleanup, tank Y and complete RNG state.')
