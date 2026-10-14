#!/usr/bin/env python3
"""Effect 7: actual native RNG, callback circles and conditional soil shading.
Intercept pixel/palette I/O, sound, input and delay; compare every ordered
pixel operation, palette setup, cycle request and the complete final RNG.
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
cases=[dict(mode=mode,x=x,y=y,seed=seed,wrap=wrap) for mode in (0,4)
 for x,y,seed,wrap in [(180,240,0,0),(3,45,17,1),(356,476,1234,0)]]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {deathFlameSequence,drawDeathFlameCircle} from './web/js/death-flames.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 Object.assign(config,{screenWidth:360,screenHeight:480,graphicsMode:c.mode});
 seedRandom(c.seed);const initial=getRandomState(),events=[],painted=new Map(),palette={};
 const colors=[0,79,80,81,85,104,105,120,169,170,199,200,255];
 const key=(x,y)=>`${x},${y}`;
 const io={
  getPixel:(x,y)=>{events.push(['read',x,y]);return painted.get(key(x,y))??colors[((x+y*7)%13+13)%13];},
  setPixel:(x,y,color)=>{events.push(['write',x,y,color]);painted.set(key(x,y),color);},
  restorePixel:(x,y)=>{events.push(['restore',x,y]);painted.set(key(x,y),120);},
  palette:(base,colors)=>colors.forEach((rgb,i)=>palette[base+i]=rgb),
  cycle:(...args)=>events.push(['cycle',...args])};
 io.circle=(x,y,r,color)=>drawDeathFlameCircle(x,y,r,color,io,undefined,{wrap:!!c.wrap});
 const frames=[...deathFlameSequence(c.x,c.y,io,{ground:[24,16,8]})];
 return {initial,events,palette,final:getRandomState(),aspect:GRAPHICS_MODES[c.mode].displayAspect};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,val in [(0x519A,65535),(0xEF46,0),(0xEF40,38),(0xEF38,476),(0xEF42,3),(0xEF3C,356),
  (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),(0x510E,case['wrap']),
  (0xEC06,port['initial']['index']),(0xDD4C,24),(0xDD4E,16),(0xDD50,8)]:mem.write16(ds+off,val)
 for off,value in {0xEEF8:0x100,0xEEF4:0x120,0xEF08:0x130,0xEEFC:0x140,0xEF04:0x150}.items():
  mem.write16(ds+off,value);mem.write16(ds+off+2,0x60)
 for i,word in enumerate(port['initial']['words']):mem.write16(ds+0xEA12+i*2,word)
 cpu.segs[:]=[0,0x1DDF,0x5F4A,0x4FC8];cpu.ip=0x258;cpu.regs[4]=0x2400
 for i,val in enumerate([0x110,0x60,case['x'],case['y']]):mem.write16(stack+0x2400+i*2,val)
 hooks={a-0x6100 for a in (0x3AB39,0x104F6,0x4C117,0x28A80)}|{0x700,0x710,0x720,0x730,0x740,0x750}
 events=[];painted={};buffer={};palette={};colors=[0,79,80,81,85,104,105,120,169,170,199,200,255]
 signed=lambda v:v if v<32768 else v-65536
 for _ in range(500000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set=hooks)
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(case,reason,hex(addr+0x6100))
  if addr==0x710:break
  sp=stack+cpu.regs[4];args=[signed(mem.read16(sp+o)) for o in (4,6,8,10)]
  x,y=args[:2]
  if addr==0x700:
   events.append(['read',x,y]);cpu.ax=painted.get((x,y),colors[(x+y*7)%13])
  elif addr==0x720:
   events.append(['write',*args[:3]]);painted[x,y]=args[2]
  elif addr==0x730:buffer[x]=args[1:]
  elif addr==0x740:
   for i in range(y):palette[str(x+i)]=buffer[i]
  elif addr==0x750:events.append(['cycle',x,y])
  elif addr==0x3AB39-0x6100:
   events.append(['restore',x,y]);painted[x,y]=120
  elif addr==0x28A80-0x6100:cpu.ax=0x80
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('flame sequence did not finish')
 if events!=port['events']:
  for i,(native,js) in enumerate(zip(events,port['events'])):
   assert native==js,(case,i,native,js)
  raise AssertionError(('event count',len(events),len(port['events'])))
 assert palette==port['palette'],(case,'palette differs')
 final=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert final==port['final'],(case,'RNG state differs')
 print(f"mode={case['mode']} seed={case['seed']}: {len(events)} ordered callbacks match",flush=True)
print(f'{len(cases)} native effect-7 sequences match pixel traversal, conditional shading, palette setup/cycle requests, cleanup and complete RNG.')
