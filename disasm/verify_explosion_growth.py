#!/usr/bin/env python3
"""Native ordinary growth frames + palette; excludes cycling/restoration/damage.

Native circle/scanline/transform execute with synthetic framebuffer callbacks.
Port repaints the base world before every step, as the production loop does.
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
cases=[dict(radius=r,pattern=p,x=40,wall=0) for r in (1,10,30,40,41) for p in (0,1)]
cases += [dict(radius=r,pattern=p,x=x,wall=1) for r in (10,40) for p in (0,1) for x in (0,3,76,79)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {palette6} from './web/js/palette.js';
import {startExplosion,stepExplosion,isExplosionActive} from './web/js/explosions.js';
Object.assign(config,{screenWidth:80,screenHeight:120,graphicsMode:4,wallType:0});reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.wallType=c.wall;
 const base=Uint8Array.from({length:9600},(_,i)=>c.pattern&&i%7===0?230:80);
 pixels.set(base);startExplosion(c.x,76,c.radius,0);const frames=[];let step=0;const initialPalette=[...palette6.slice(600,720)];
 while(isExplosionActive()){
  pixels.set(base);if(stepExplosion() && step++ < Math.ceil(c.radius/(c.radius<40?1:2)))frames.push(Buffer.from(pixels).toString('base64'));
 }
 return {frames,palette:initialPalette};
})));
''',json.dumps(cases)],cwd=root,text=True))
total=0
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 for off,v in ((0x519A,65535),(0xEF42,3),(0xEF3C,76),(0xEF40,38),(0xEF38,116),
               (0xEF34,int(.55*65536)),(0xEF36,0),(0x510E,c['wall']),(0xEF46,0),
               (0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60),
               (0xEF08,0x130),(0xEF0A,0x60),(0xEEFC,0x140),(0xEEFE,0x60)):
  mem.write16(ds+off,v)
 cpu.segs[:]=[0,0x3DAE,0x5F4A,0x4FC8];cpu.ip=0x43C8E-0x6100-0x3DAE0;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 palette=[0]*120
 while True:
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710,0x730,0x740})
  assert reason=='breakpoint'
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=cpu.regs[4]
  if addr==0x730:
   i,r,g,b=(mem.read16(stack+sp+o) for o in (4,6,8,10));palette[i*3:i*3+3]=[r,g,b]
  else:assert [mem.read16(stack+sp+o) for o in (4,6)]==[200,40]
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 assert port['palette']==palette,(c,'palette')
 frame=bytearray(230 if c['pattern'] and i%7==0 else 80 for i in range(9600))
 cpu.segs[1]=0x3DAE;cpu.ip=0x43D87-0x6100-0x3DAE0
 cpu.regs[5],cpu.regs[4],cpu.regs[7]=0x2400,0x23E0,c['radius']
 mem.write16(stack+0x2406,c['x']);mem.write16(stack+0x2408,76)
 count=0
 for _ in range(1000000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x720,0x43DDD-0x6100,0x43DE7-0x6100})
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x43DE7-0x6100:break
  if addr==0x43DDD-0x6100:
   expected=base64.b64decode(port['frames'][count])
   assert frame==expected,(c,count,'pixel',next(i for i,(a,b) in enumerate(zip(frame,expected)) if a!=b))
   count+=1;cpu.regs[4]+=12;cpu.ip=0x43DE0-0x6100-0x3DAE0;continue
  sp=cpu.regs[4];x,y=(mem.read16(stack+sp+o) for o in (4,6))
  if addr==0x700:cpu.ax=frame[y*80+x]
  else:frame[y*80+x]=mem.read16(stack+sp+8)
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('growth did not finish')
 assert count==len(port['frames']),(c,count,len(port['frames']))
 total+=count
print(f'{total} growth frames and {len(cases)} palette initializations match native, including protected pixels and world repaint.')
