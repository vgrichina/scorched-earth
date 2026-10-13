#!/usr/bin/env python3
"""Audit the known cavern ceiling gap; not a passing parity verifier.

Executes native sky-flag selection and line traversal. Intercepts impact effects,
so repeated dispatch counts describe the walker absent weapon-handler side effects.
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
cases=[dict(sky=sky,wall=wall,dy=dy) for sky in (0,5) for wall in (0,1) for dy in (-1,-4,-12)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {setupSkyPalette} from './web/js/palette.js';
import {createProjectile,stepSingleProjectile} from './web/js/physics.js';
import {reinitTerrainBuffers} from './web/js/terrain.js';
Object.assign(config,{screenWidth:360,screenHeight:480,gravity:0,viscosity:0,tunneling:0});
reinitTerrainBuffers();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.wallType=c.wall;setupSkyPalette(c.sky);
 const p=createProjectile(100,38,0,-50*c.dy,2,0);
 return {status:stepSingleProjectile(p,()=>120,0),x:p.x,y:p.y};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 for off,value in ((0x519A,65535),(0x5110,c['sky']),(0xEF42,3),(0xEF3C,356),
                   (0xEF40,38),(0xEF38,476),(0x5154,c['wall']),(0x513E,75),
                   (0x513A,0),(0xE1E4,0),(0xE1E6,0),(0xE1E8,0),(0xCE98,0),
                   (0xEEF8,0x100),(0xEEFA,0x60)):
  mem.write16(ds+off,value)
 # Native resolved-sky flag selection, before terrain allocation.
 cpu.segs[:]=[0,0x3352,0x5F4A,0x4FC8]
 cpu.ip=0x397A9-0x6100-0x33520
 reason,_=run_fast(cpu,mem,ports,handler,10000,bp_set={0x397BE-0x6100})
 assert reason=='breakpoint'
 assert mem.read16(ds+0x50D8)==int(c['sky']==5)
 cpu.segs[1]=0x17AB;cpu.ip=0x733;cpu.regs[4]=0x2400
 for i,value in enumerate([0x110,0x60,100,38,100,38+c['dy'],0x1349,0x1ADA]):
  mem.write16(stack+0x2400+2*i,value)
 impacts=[]
 for _ in range(100):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x22FBC-0x6100,0x230C8-0x6100})
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=cpu.regs[4]
  if addr==0x700:cpu.ax=120
  elif addr==0x230C8-0x6100:impacts.append([mem.read16(stack+sp+4),mem.read16(stack+sp+6)])
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native traversal did not finish')
 print(json.dumps(dict(case=c,port=port,nativeImpactCalls=impacts,nativeImpactFlag=mem.read16(ds+0xCE98))))
