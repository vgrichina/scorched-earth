#!/usr/bin/env python3
"""Compare native reflection kernel, stubbing sky restoration and shield damage.
Does not cover collision caller's pre-force velocity transfer or frame timing.
"""
import json,math,struct,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(dx=x,dy=y,vx=vx,vy=vy) for x,y in ((0,15),(15,0),(-15,0),(0,-15),(9,12),(-9,12),(9,-12),(-9,-12))
       for vx in (-321,-40,0,40,321) for vy in (-217,0,217) if vx or vy]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {reflectShieldVelocity} from './web/js/shields.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>reflectShieldVelocity(c.vx,c.vy,c.dx,c.dy))));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 mem.write16(ds+0x519A,65535);mem.write16(ds+0x1C7A,0)
 mem.write16(0x9000E,100);mem.write16(0x90010,100)
 struct.pack_into('<dd',mem.data,ds+0xE4DC,c['vx'],c['vy'])
 cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8];cpu.ip=0x23327-0x6100-0x1ADA0;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,0,0x9000,100+c['dx'],100-c['dy'])):mem.write16(stack+0x2400+2*i,v)
 damage=0;restores=0
 for _ in range(5):
  reason,_=run_fast(cpu,mem,ports,handler,200000,bp_set={0x710,0x3AB39-0x6100,0x3FFD2-0x6100})
  addr=cpu.segs[1]*16+cpu.ip;assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x710:break
  sp=cpu.regs[4]
  if addr==0x3AB39-0x6100:restores+=1
  else:
   damage=mem.read16(stack+sp+8);assert mem.read16(stack+sp+10)==0
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('reflection did not return')
 vx,vy=struct.unpack_from('<dd',mem.data,ds+0xE4DC)
 assert restores==1
 assert damage==port['damage'] and bool(mem.read16(ds+0x1C7A))==port['reflected'],(c,damage,port)
 assert math.isclose(vx,port['vx'],abs_tol=1e-8) and math.isclose(vy,port['vy'],abs_tol=1e-8),(c,(vx,vy),port)
print(f'{len(cases)} native reflection cases match velocity, outward-sign gate, attenuation and shield-only damage requests.')
