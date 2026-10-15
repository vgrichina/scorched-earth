#!/usr/bin/env python3
"""Native textured animation pixels and VGA palette at each rotation.

Synthetic texture segment and framebuffer; terrain restoration callback writes
constant sky zero. Native circle, texture reads, color-band selection and VGA
palette rotation run unchanged. Delay/audio/input and heap lifecycle excluded.
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
cases=[dict(mode=m,x=x,y=76,r=40,pattern=p,wall=wall)
       for m in (0,4,8) for x,wall in ((40,0),(3,1)) for p in (0,1)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {terrainBitmap,reinitTerrainBuffers} from './web/js/terrain.js';
import {palette6} from './web/js/palette.js';
import {explosionTextureCache} from './web/js/explosion-texture.js';
import {startExplosion,stepExplosion,isExplosionActive} from './web/js/explosions.js';
Object.assign(config,{screenWidth:80,screenHeight:120,explosionScale:0});
reinitFramebuffer();reinitTerrainBuffers();
Object.assign(explosionTextureCache,{width:81,pixels:Uint8Array.from({length:65536},(_,i)=>(i*13+Math.floor(i/81)*7)%40)});
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.graphicsMode=c.mode;config.wallType=c.wall;
 const base=Uint8Array.from({length:9600},(_,i)=>c.pattern&&i%7===0?230:80);
 pixels.set(base);terrainBitmap.fill(120);
 startExplosion(c.x,c.y,c.r,0);const frames=[];
 while(isExplosionActive()){
  pixels.set(base);
  if(stepExplosion())frames.push({pixels:Buffer.from(pixels).toString('base64'),palette:[...palette6.slice(600,720)]});
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
 for off,v in ((0x519A,65535),(0xEF42,3),(0xEF3C,76),(0xEF40,38),(0xEF38,116),
               (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),
               (0x510E,c['wall']),(0xEF46,0),(0xEEF8,0x100),(0xEEFA,0x60),
               (0xEEF4,0x120),(0xEEF6,0x60),(0x5104,0),(0x5106,0x8000),(0xE51E,81),
               (0xEF04,0x3B),(0xEF06,0x3E2B),(0xEF08,0xA8),(0xEF0A,0x3E2B),
               (0xEEFC,0xDB),(0xEEFE,0x3E2B)):
  mem.write16(ds+off,v)
 for i in range(65536):mem.write8(0x80000+i,(i*13+(i//81)*7)%40)
 cpu.segs[:]=[0,0x3DAE,0x5F4A,0x4FC8];cpu.regs[4]=0x2400
 cpu.ip=0x43C8E-0x6100-0x3DAE0
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x710})
 assert reason=='breakpoint'
 cpu.segs[1]=0x3DAE;cpu.ip=0x43FC3-0x6100-0x3DAE0;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,c['x'],c['y'],c['r']]):mem.write16(stack+0x2400+i*2,v)
 frame=bytearray(230 if c['pattern'] and i%7==0 else 80 for i in range(9600));count=0
 checkpoints={v-0x6100 for v in (0x4403F,0x44086,0x440D5)}
 skipped={v-0x6100 for v in (0x104F6,0x28A80)}
 restore=0x3AB39-0x6100
 for _ in range(1000000):
  reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x700,0x710,0x720,restore}|checkpoints|skipped)
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  if addr in checkpoints:
   expected=base64.b64decode(port['frames'][count]['pixels'])
   assert frame==expected,(c,count,next((i,a,b) for i,(a,b) in enumerate(zip(frame,expected)) if a!=b))
   assert port['frames'][count]['palette']==[v for rgb in ports.palette[200:240] for v in rgb],(c,count,'palette')
   count+=1;cpu.regs[4]+=4;cpu.ip+=3;continue
  sp=cpu.regs[4]
  if addr not in skipped:
   x,y=(mem.read16(stack+sp+o) for o in (4,6))
   assert 0<=x<80 and 0<=y<120,(c,x,y)
   if addr==0x700:cpu.ax=frame[y*80+x]
   else:frame[y*80+x]=0 if addr==restore else mem.read16(stack+sp+8)
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('animation did not finish')
 assert count==len(port['frames'])==c['r']+109,(c,count,len(port['frames']))
 total+=count
print(f'{total} textured animation frames and VGA palettes match native across {len(cases)} cases.')
