#!/usr/bin/env python3
"""Compare native launch edge scan + outside collisions using synthetic pixels.

Includes holes/player/trace pixels and cache persistence across a terrain edit.
Impact effects, head erasure and framebuffer rendering are intercepted.
"""
import json, subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(pattern=p,side=side,y=y,refresh=refresh) for p in range(6)
       for side in (0,1) for y in (38,39,99,100,101,299,300,301,439,440,441,475) for refresh in (False,True)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {launchProjectile,clearProjectiles,projectiles,stepSingleProjectile} from './web/js/physics.js';
import {setPixel} from './web/js/framebuffer.js';
import {reinitTerrainBuffers} from './web/js/terrain.js';
Object.assign(config,{screenWidth:360,screenHeight:480,gravity:0,viscosity:0,wallType:0,edgesExtend:75,tunneling:0});
reinitTerrainBuffers();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 const color=(x,y)=>{
  if(c.pattern===0)return 80;
  if(c.pattern===1)return 120;
  if(y<=(x===3?100:300))return 120;
  if(c.pattern===3&&y===440)return 120;
  if(c.pattern===4&&y===440)return 0;
  if(c.pattern===5&&y===440)return 110;
  return 104;
 };
 for(const x of [3,356])for(let y=38;y<=476;y++){
  const native=color(x,y);setPixel(x,y,native>=80&&native<=104?native+40:native===120?80:native);
 }
 clearProjectiles();launchProjectile(c.side?358:1,c.y,0,0,2,0);
 // Change the visible edge after launch: current flight must keep its cache.
 for(const x of [3,356])for(let y=38;y<=476;y++)setPixel(x,y,80);
 if(c.refresh){clearProjectiles();launchProjectile(c.side?358:1,c.y,0,0,2,0);}
 const p=projectiles[0];p.vx=c.side?50:-50;
 const status=stepSingleProjectile(p,()=>80,0);
 return {status,pos:[p.x,p.y]};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 for off,v in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
               (0x5154,0),(0x513E,75),(0x513A,0),(0x50D8,0),
               (0xE1E4,0),(0xE1E6,0),(0xE1E8,0),(0xEEF8,0x100),(0xEEFA,0x60)):
  mem.write16(ds+off,v)
 def color(x,y,edited):
  if edited:return 120
  if c['pattern']==0:return 80
  if c['pattern']==1:return 120
  if y<=(100 if x==3 else 300):return 120
  if c['pattern']>=3 and y==440:return {3:120,4:0,5:110}[c['pattern']]
  return 104
 for edited in ([False,True] if c['refresh'] else [False]):
  # Actual launch condition/call: stop just after scan returns.
  cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8];cpu.ip=0x2125C-0x6100-0x1ADA0;cpu.regs[4]=0x2400
  for _ in range(1000):
   reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x21267-0x6100})
   assert reason=='breakpoint',(c,reason)
   if cpu.segs[1]*16+cpu.ip!=0x700:break
   sp=cpu.regs[4];x,y=(mem.read16(stack+sp+o) for o in (4,6))
   cpu.ax=color(x,y,edited)
   cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
  else:raise AssertionError('scan did not finish')
 x=358 if c['side'] else 1;y=c['y'];dx=1 if c['side'] else -1
 cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip=0x733;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,x,y,x+dx,y,0x1349,0x1ADA]):mem.write16(stack+0x2400+2*i,v)
 impact=None
 for _ in range(30):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710,0x22FBC-0x6100,0x230C8-0x6100})
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=cpu.regs[4]
  if addr==0x230C8-0x6100:impact=[mem.read16(stack+sp+o) for o in (4,6)]
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('collision did not finish')
 expected=dict(status='hit_terrain' if impact else 'flying',pos=impact or [x+dx,y])
 assert port==expected,(c,port,expected)
print(f'{len(cases)} launch edge-cache/collision cases match native scan, persistence and refresh.')
