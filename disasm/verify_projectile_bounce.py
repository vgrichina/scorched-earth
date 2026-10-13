#!/usr/bin/env python3
"""Native wall bounce integration/collision/draw-coordinate updates over four steps.

Synthetic terrain reads; pixel writes, head drawing and impact effects stubbed.
Executes the real tracking wrapper and post-collision coordinate transfer.
"""
import json, struct, subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(x=x,y=y,vx=vx,vy=vy,g=g,obstacle=o,wall=wall,count=count) for x,y,vx,vy in
       ((350.25,100.25,600,-400),(8.25,100.25,-600,-400),
        (356,100,50,0),(3,100,-50,0),(350,37,600,400),
        (8,-510,-600,0),(350,474,600,-400),(100,474,0,-400),
        (350,100,1600,-1200),(8,100,-1600,1200),(100,39,0,400),(100,476,0,-49),
        (100,476,0,-50),(100,476,0,49),(100,476,0,50))
       for g in (.2,1) for o in (0,1,2) for wall in (2,3,4) for count in (0,5,6,7)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createProjectile,stepSingleProjectile} from './web/js/physics.js';
import {terrainBitmap,reinitTerrainBuffers} from './web/js/terrain.js';
Object.assign(config,{screenWidth:360,screenHeight:480,wallType:1,tunneling:0,viscosity:20});
reinitTerrainBuffers();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.gravity=c.g;config.wallType=c.wall;terrainBitmap.fill(0);
 if(c.obstacle)for(let y=38;y<476;y++){
  const x=c.obstacle===1?Math.trunc(c.x):(c.vx>0?3:356);
  terrainBitmap[y*360+x]=120;
 }
 const p=createProjectile(c.x,c.y,c.vx,c.vy,2,0),states=[];p.bounceCount=c.count;p.wallBounceScale=.8;
 for(let i=0;i<4;i++){
  const status=stepSingleProjectile(p,()=>120,100);
  states.push({status,pos:[p.x,p.y],v:[p.vx,p.vy],count:p.bounceCount,scale:p.wallBounceScale});
  if(status!=='flying')break;
 }
 return states;
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,states in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack,pr=0x4FC80,0x5F4A0,0x90000
 for off,val in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF3E,359),(0xEF40,38),(0xEF38,476),
                 (0x5154,c['wall']),(0x513A,0),(0x5146,0),(0x50D8,0),(0xE1E4,0),(0xE1E6,0),(0xE1E8,0),
                 (0xE4DA,0),(0xCEB8,0),(0xCEBA,0x9000),(0xEEF8,0x100),(0xEEFA,0x60),
                 (0xEEF4,0x120),(0xEEF6,0x60),(0x1C8A,0x130),(0x1C8C,0x60)):
  mem.write16(ds+off,val)
 def put(a,v):struct.pack_into('<d',mem.data,a,v)
 for off,val in ((4,c['vx']),(12,c['vy']),(20,c['x']),(28,c['y'])):put(pr+off,val)
 mem.write16(pr+0x4A,65535)
 mem.write16(pr+0x30,c['count']);put(pr+0x32,.8)
 for off,val in ((0xCEAC,.02),(0xCE9C,50*c['g']),(0xCEA4,2.5),(0x5178,.998)):put(ds+off,val)
 for step,port in enumerate(states):
  for off,pof,dso in ((0,20,0xE34A),(2,28,0xE412)):
   value=int(mem.read_float64(pr+pof))&65535
   mem.write16(pr+off,value);mem.write16(ds+dso,value)
  for off in (0x1C7E,0xCE98,0xCE9A):mem.write16(ds+off,0)
  cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
  cpu.regs[5],cpu.regs[4],cpu.regs[6]=0x2400,0x23E0,0
  cpu.ip=0x21AA2-0x6100-0x1ADA0;impact=None
  for _ in range(1000):
   reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x720,0x730,0x21E3B-0x6100,
                         0x22064-0x6100,0x4C117-0x6100,0x22FBC-0x6100,0x230C8-0x6100})
   assert reason=='breakpoint',(c,step,reason)
   addr=cpu.segs[1]*16+cpu.ip
   if addr==0x22064-0x6100:break
   if addr==0x21E3B-0x6100:
    if impact:break
    cpu.ip=0x21E52-0x6100-0x1ADA0;continue
   sp=cpu.regs[4]
   def signed(v):return v if v<32768 else v-65536
   x,y=(signed(mem.read16(stack+sp+o)) for o in (4,6))
   if addr==0x700:
    obstacleX=int(c['x']) if c['obstacle']==1 else 3 if c['vx']>0 else 356
    cpu.ax=80 if c['obstacle'] and x==obstacleX and 38<=y<476 else 120
   elif addr==0x230C8-0x6100:impact=[x,y]
   cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
  else:raise AssertionError('native step did not finish')
  expected=dict(status=('hit_wall' if impact[1]>=476 else 'hit_terrain') if impact else 'flying',
                pos=impact or [mem.read_float64(pr+o) for o in (20,28)],v=[mem.read_float64(pr+o) for o in (4,12)],
                count=mem.read16(pr+0x30),scale=mem.read_float64(pr+0x32))
  assert port==expected,(c,step,port,expected)
print(f'{len(cases)} bounce sequences match native coordinates, velocities, counts and attenuation.')
