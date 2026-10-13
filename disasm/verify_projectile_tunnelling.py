#!/usr/bin/env python3
"""Compare native integration, collision traversal and tunnelling state over 4 steps.

Synthetic terrain reads and sky restoration; impact and drawing are intercepted.
No walls, shields, guidance, terrain settling or full-frame comparison.
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
cases=[dict(vx=vx,vy=vy,pattern=p,gravity=g,wind=100,viscosity=20,superMag=sm,weapon=w)
       for vx,vy in ((600,-400),(40,-20),(1600,-1200),(0,0),(20,0))
       for p in (0,1,2) for g in (.2,1) for sm,w in ((False,2),(True,2),(False,13),(False,31),(False,7),(False,14))]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createProjectile,stepSingleProjectile} from './web/js/physics.js';
import {terrainBitmap,reinitTerrainBuffers} from './web/js/terrain.js';
Object.assign(config,{screenWidth:360,screenHeight:480,wallType:0,tunneling:1});
reinitTerrainBuffers();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 Object.assign(config,c);terrainBitmap.fill(0);
 const initial=[];
 for(let y=80;y<160;y++)for(let x=80;x<160;x++)
  if(c.pattern===0?x===104:c.pattern===1?x>=100&&x<=110:x===100&&y===100){
   const i=y*360+x;terrainBitmap[i]=120;initial.push(i);
  }
 const p=createProjectile(100.25,100.25,c.vx,c.vy,c.weapon,0);p.superMagActive=c.superMag;
 const states=[];
 for(let i=0;i<4;i++){
  const status=stepSingleProjectile(p,()=>120,c.wind);
  states.push({status,v:[p.vx,p.vy],pos:[p.x,p.y],flag:p.tunnelState,cleared:initial.filter(j=>!terrainBitmap[j])});
  if(status!=='flying')break;
 }
 return states;
})));
''',json.dumps(cases)],cwd=root,text=True))
for case,states in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack,pr=0x4FC80,0x5F4A0,0x90000
 for off,val in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
                 (0x5154,0),(0x513A,1),(0x1C76,int(case['superMag'])),(0x5146,0),
                 (0xE1E4,0),(0xE1E6,0),(0xE1E8,0),(0xE4DA,0),(0xCEB8,0),(0xCEBA,0x9000),
                 (0xEEF8,0x100),(0xEEFA,0x60)):
  mem.write16(ds+off,val)
 def put(a,v):struct.pack_into('<d',mem.data,a,v)
 for off,val in ((4,case['vx']),(12,case['vy']),(20,100.25),(28,100.25)):put(pr+off,val)
 # Run native weapon-specific initialization, rather than supplying its result.
 cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
 cpu.regs[5],cpu.regs[4],cpu.regs[7]=0x2400,0x23E0,0
 mem.write16(stack+0x240A,case['weapon']-2)
 cpu.ip=0x218BE-0x6100-0x1ADA0
 reason,_=run_fast(cpu,mem,ports,handler,10000,bp_set={0x21924-0x6100})
 assert reason=='breakpoint',reason
 for off,val in ((0xCEAC,.02),(0xCE9C,50*case['gravity']),(0xCEA4,case['wind']/40),
                 (0x5178,1-case['viscosity']/10000)):put(ds+off,val)
 cleared=set()
 for step,port in enumerate(states):
  for off,pof in ((0,20),(2,28)):mem.write16(pr+off,int(mem.read_float64(pr+pof)))
  mem.write16(ds+0x1C7E,0)
  cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
  cpu.regs[5],cpu.regs[4],cpu.regs[6]=0x2400,0x23E0,0
  cpu.ip=0x21AA2-0x6100-0x1ADA0
  impact=None
  for _ in range(1000):
   reason,count=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x21E3B-0x6100,
                        0x22FBC-0x6100,0x230C8-0x6100,0x3AB39-0x6100})
   assert reason=='breakpoint',(case,step,reason,count,hex(cpu.segs[1]*16+cpu.ip))
   addr=cpu.segs[1]*16+cpu.ip
   if addr==0x21E3B-0x6100:break
   sp=cpu.regs[4];x,y=(mem.read16(stack+sp+o) for o in (4,6))
   if addr==0x700:
    solid=x==104 if case['pattern']==0 else 100<=x<=110 if case['pattern']==1 else x==100 and y==100
    cpu.ax=80 if solid and y*360+x not in cleared else 120
   elif addr==0x3AB39-0x6100:cleared.add(y*360+x)
   elif addr==0x230C8-0x6100:impact=[x,y]
   cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
  else:raise AssertionError('native step did not finish')
  expected=dict(status='hit_terrain' if impact else 'flying',
                v=[mem.read_float64(pr+o) for o in (4,12)],
                pos=impact or [mem.read_float64(pr+o) for o in (20,28)],
                flag=mem.read16(pr+0x4A) if mem.read16(pr+0x4A)!=65535 else -1,cleared=sorted(cleared))
  assert port==expected,(case,step,port,expected)
print(f'{len(cases)} tunnelling sequences match native velocities, impacts and erased terrain pixels.')
