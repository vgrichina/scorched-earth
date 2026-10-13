#!/usr/bin/env python3
"""Native None/Concrete boundary impacts using the actual line walker.

Synthetic sky/obstacle reads; erasure, removal and impact effects intercepted.
No bounce/wrap, cavern ceiling, extended side terrain or impact rendering.
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
vectors=[(8,100,-12,8),(350,100,12,8),(100,42,8,-12),(100,470,8,12),
         (3,100,-1,0),(356,100,1,0),(100,38,0,-1),(100,475,0,1),
         (2,100,0,0),(357,100,0,0),(100,476,0,0),(100,-510,0,1),
         (-70,100,-12,8),(430,100,12,8)]
cases=[dict(x=x,y=y,dx=dx,dy=dy,wall=w,extend=e,obstacle=o)
       for x,y,dx,dy in vectors for w in (0,5) for e in (0,75,150) for o in (False,True)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createProjectile,stepSingleProjectile} from './web/js/physics.js';
import {terrainBitmap,reinitTerrainBuffers} from './web/js/terrain.js';
Object.assign(config,{screenWidth:360,screenHeight:480,gravity:0,viscosity:0,tunneling:0});
reinitTerrainBuffers();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 Object.assign(config,{wallType:c.wall,edgesExtend:c.extend});terrainBitmap.fill(0);
 if(c.obstacle&&c.x>=3&&c.x<=356&&c.y>=38&&c.y<476)terrainBitmap[c.y*360+c.x]=120;
 const p=createProjectile(c.x,c.y,c.dx*50,-c.dy*50,2,0);
 const status=stepSingleProjectile(p,()=>120,0);
 return {status,pos:status==='offscreen'?null:[p.x,p.y]};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 for off,v in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
               (0x5154,c['wall']),(0x513E,c['extend']),(0x513A,0),(0x50D8,0),
               (0xCEB4,476),(0xCEB6,476),(0xE1E4,0),(0xE1E6,0),(0xE1E8,0),
               (0xEEF8,0x100),(0xEEFA,0x60)):
  mem.write16(ds+off,v)
 cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip=0x733;cpu.regs[4]=0x2400
 args=[0x110,0x60,c['x'],c['y'],c['x']+c['dx'],c['y']+c['dy'],0x1349,0x1ADA]
 for i,v in enumerate(args):mem.write16(stack+0x2400+2*i,v&65535)
 impact=None;removed=False
 for _ in range(200):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x22FBC-0x6100,0x230C8-0x6100,0x231D7-0x6100})
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=cpu.regs[4]
  def signed(v):return v if v<32768 else v-65536
  x,y=(signed(mem.read16(stack+sp+o)) for o in (4,6))
  if addr==0x700:cpu.ax=80 if c['obstacle'] and (x,y)==(c['x'],c['y']) else 120
  elif addr==0x230C8-0x6100:impact=[x,y]
  elif addr==0x231D7-0x6100:removed=True
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native traversal did not finish')
 status='offscreen' if removed else 'hit_wall' if impact and (impact[0]<3 or impact[0]>356 or impact[1]<38 or impact[1]>=476) else 'hit_terrain' if impact else 'flying'
 expected=dict(status=status,pos=None if removed else impact or [c['x']+c['dx'],c['y']+c['dy']])
 assert port==expected,(c,port,expected)
print(f'{len(cases)} None/Concrete boundary cases match native first impacts and removals.')
