#!/usr/bin/env python3
"""Native effect-6 death-mode spray through its pre-settling boundary.
Real RNG, floating-point boundaries, palette mixing and ground-deposit color
selection execute. Pixel, palette, dirty marking and tank erase are intercepted.
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
cases=[dict(x=x,y=y,seed=seed,wrap=wrap,blocked=blocked,sound=sound,full=full)
 for x,y,seed,wrap,blocked,sound,full in
 [(40,100,0,0,0,0,0),(40,100,17,0,1,0,0),(3,100,42,1,0,0,0),
  (76,100,1234,1,0,0,0),(40,100,56,0,1,1,0),(40,45,18,0,0,0,1)]]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {deathDirtSequence} from './web/js/death-dirt.js';
import {seedRandom,getRandomState,random} from './web/js/utils.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 seedRandom(c.seed);const initial=getRandomState(),events=[],painted=new Map();
 const key=(x,y)=>`${x},${y}`;
 const background=(x,y)=>c.blocked&&y<c.y-8&&Math.abs(x-c.x)>=3+Math.floor((c.y-y)/5)?80:120;
 const io={
  getPixel:(x,y)=>{events.push(['read',x,y]);return painted.get(key(x,y))??background(x,y);},
  deposit:(x,y)=>{const color=[80,87,104][random(3)];events.push(['write',x,y,color]);painted.set(key(x,y),color);},
  palette:(slot,rgb)=>events.push(['palette',slot,...rgb]),
  markDirty:(...args)=>events.push(['dirty',...args]),
  markCircle:(...args)=>events.push(['circle',...args]),
  eraseTank:()=>events.push(['erase'])};
 const tank={x:c.x,y:c.y,baseColor:8,rgb:[63,20,7]};
 const frames=[...deathDirtSequence(tank,io,{ground:[24,16,8],maxY:119,right:76,
   wrap:!!c.wrap,sound:!!c.sound,fullHeight:!!c.full})];
 return {initial,events,final:getRandomState()};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack,tank=0x4FC80,0x5F4A0,0xD568
 for off,val in [(0x519A,65535),(0xEF46,case['sound']),(0xEF40,38),(0xEF38,116),
  (0xEF42,3),(0xEF3C,76),(0xEF3A,119),(0x50FC,case['full']),(0x510E,case['wrap']),
  (0xDD58,tank),(0xDD5A,0x4FC8),(tank+0xE,case['x']),(tank+0x10,case['y']),
  (tank+0x1A,8),(tank+0x1C,63),(tank+0x1E,20),(tank+0x20,7),
  (0xD4E4,3),(0xD4E6,80),(0xD4E8,87),(0xD4EA,104),
  (0xEC06,port['initial']['index']),(0xDD4C,24),(0xDD4E,16),(0xDD50,8)]:mem.write16(ds+off,val)
 for off,data in [(0xB22,struct.pack('<f',100)),(0x6E5A,struct.pack('<d',.55))]:
  for i,b in enumerate(data):mem.write8(ds+off+i,b)
 for off,value in {0xEEF8:0x100,0xEEF4:0x120}.items():
  mem.write16(ds+off,value);mem.write16(ds+off+2,0x60)
 for i,word in enumerate(port['initial']['words']):mem.write16(ds+0xEA12+i*2,word)
 cpu.segs[:]=[0,0x1630,0x5F4A,0x4FC8];cpu.ip=0x81;cpu.regs[4]=0x2400
 for i,val in enumerate([0x110,0x60,case['x'],case['y']]):mem.write16(stack+0x2400+i*2,val)
 hooks={a-0x6100 for a in (0x4C0B5,0x104F6,0x10C81,0x4C278,0x28A80,0x1CDC4,0x1CD38,0x3FC7D,0x1CCC1)}|{0x700,0x720}
 events=[];painted={}
 signed=lambda v:v if v<32768 else v-65536
 def background(x,y):
  return 80 if case['blocked'] and y<case['y']-8 and abs(x-case['x'])>=3+(case['y']-y)//5 else 120
 for _ in range(100000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set=hooks)
  addr=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(case,reason,hex(addr))
  if addr==0x1CCC1:break
  sp=stack+cpu.regs[4];args=[signed(mem.read16(sp+o)) for o in (4,6,8,10)]
  x,y=args[:2]
  if addr==0x6800:
   events.append(['read',x,y]);cpu.ax=painted.get((x,y),background(x,y))
  elif addr==0x6820:
   events.append(['write',*args[:3]]);painted[x,y]=args[2]
  elif addr==0x4C0B5:events.append(['palette',*args])
  elif addr==0x1CDC4:events.append(['dirty',x,y])
  elif addr==0x1CD38:events.append(['circle',x,y])
  elif addr==0x3FC7D:events.append(['erase'])
  elif addr==0x28A80:cpu.ax=0x80
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('dirt spray did not finish')
 if events!=port['events']:
  for i,(native,js) in enumerate(zip(events,port['events'])):
   assert native==js,(case,i,native,js)
  raise AssertionError(('event count',len(events),len(port['events'])))
 final=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert final==port['final'],(case,'RNG state differs')
 print(f"seed={case['seed']}: {len(events)} palette/pixel/dirty callbacks match",flush=True)
print(f'{len(cases)} native effect-6 spray sequences match palette mixing, terrain reads, deposition, dirty marking and complete RNG.')
