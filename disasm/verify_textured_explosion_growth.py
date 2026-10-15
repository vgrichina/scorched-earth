#!/usr/bin/env python3
"""Compare native textured growth pixels (0x43FC3), excluding palette/timing.

Synthetic full 64KB texture segment/framebuffer inputs; native transform, circle, and texture
lookup execute unchanged. Tests all mode aspects, clipping, protected colors.
"""
import base64,json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(mode=m,x=x,y=y,r=20,pattern=p,wall=wall) for m in range(9)
       for x,y in ((40,76),(3,38),(76,116)) for p in (0,1) for wall in (0,1)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {drawTexturedExplosionGrowth} from './web/js/explosions.js';
Object.assign(config,{screenWidth:80,screenHeight:120,wallType:0});reinitFramebuffer();
const texture={width:81,pixels:Uint8Array.from({length:65536},(_,i)=>(i*13+Math.floor(i/81)*7)%40)};
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.graphicsMode=c.mode;config.wallType=c.wall;
 pixels.set(Uint8Array.from({length:9600},(_,i)=>c.pattern&&i%7===0?230:80));
 const frames=[];
 for(let r=1;r<=c.r;r++){
  drawTexturedExplosionGrowth(c.x,c.y,c.r,r,texture);
  frames.push(Buffer.from(pixels).toString('base64'));
 }
 return {aspect:GRAPHICS_MODES[c.mode].displayAspect,frames};
})));
''',json.dumps(cases)],cwd=root,text=True))
total=0
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,value in ((0x519A,65535),(0xEF42,3),(0xEF3C,76),(0xEF40,38),(0xEF38,116),
                   (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),
                   (0x510E,c['wall']),(0xEF46,0),(0xEEF8,0x100),(0xEEFA,0x60),
                   (0xEEF4,0x120),(0xEEF6,0x60),(0x5104,0),(0x5106,0x8000),(0xE51E,81)):
  mem.write16(ds+off,value)
 for i in range(65536):mem.write8(0x80000+i,(i*13+(i//81)*7)%40)
 cpu.segs[:]=[0,0x3DAE,0x5F4A,0x4FC8];cpu.ip=0x43FC3-0x6100-0x3DAE0;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,c['x'],c['y'],c['r']]):mem.write16(stack+0x2400+i*2,v)
 frame=bytearray(230 if c['pattern'] and i%7==0 else 80 for i in range(9600))
 count=0
 for _ in range(500000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x720,0x44036-0x6100,0x44047-0x6100})
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x44047-0x6100:break
  if addr==0x44036-0x6100:
   expected=base64.b64decode(port['frames'][count])
   assert frame==expected,(c,count,next((i,a,b) for i,(a,b) in enumerate(zip(frame,expected)) if a!=b))
   count+=1
   cpu.ip=0x44042-0x6100-0x3DAE0
   continue
  sp=cpu.regs[4];x,y=(mem.read16(stack+sp+o) for o in (4,6))
  assert 0<=x<80 and 0<=y<120,(c,x,y)
  if addr==0x700:cpu.ax=frame[y*80+x]
  else:frame[y*80+x]=mem.read16(stack+sp+8)
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('growth did not finish')
 assert count==c['r'],(c,count)
 total+=count
print(f'{total} textured growth frames match native across {len(cases)} cases; palette/timing excluded.')
