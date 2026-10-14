#!/usr/bin/env python3
"""Effect-8 soil helpers: actual native branches, intercepted pixel I/O and RNG.

Exercise every indexed input color and every possible random result, including
the asymmetric negative-offset branch and the two distinct color-105 tests.
"""
import json
import subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root=Path(__file__).resolve().parent.parent
cases=[dict(kind=kind,color=color,roll=roll) for kind,count in [('pixel',5),('column',9)]
       for color in range(256) for roll in range(count)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {scorchDeathPixel,clearDeathScorchColumn} from './web/js/death-scorch.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 const events=[];
 const io={getPixel:(x,y)=>{events.push(['read',x,y]);return c.color;},
   setPixel:(x,y,color)=>events.push(['write',x,y,color]),
   restorePixel:(x,y)=>events.push(['restore',x,y])};
 const roll=n=>{events.push(['random',n]);return c.roll;};
 (c.kind==='pixel'?scorchDeathPixel:clearDeathScorchColumn)(180,240,io,roll);
 return events;
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,value in [(0x519A,65535),(0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60)]:
 mem.write16(ds+off,value)
for case,expected in zip(cases,actual):
 address=0x2BCC3 if case['kind']=='pixel' else 0x2BD07
 cpu.segs[:]=[0,0x200F,0x5F4A,0x4FC8]
 cpu.ip=address-0x6100-0x200F0;cpu.regs[4]=0x2400
 for i,value in enumerate([0x110,0x60,180,240]):mem.write16(stack+0x2400+2*i,value)
 events=[]
 for _ in range(30):
  reason,_=run_fast(cpu,mem,ports,handler,10000,
      bp_set={0x700,0x710,0x720,0x32E1B-0x6100,0x3AB39-0x6100})
  assert reason=='breakpoint',(case,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=stack+cpu.regs[4]
  args=[mem.read16(sp+o) for o in (4,6,8)]
  if addr==0x700:
   events.append(['read',*args[:2]]);cpu.ax=case['color']
  elif addr==0x720:events.append(['write',*args])
  elif addr==0x32E1B-0x6100:
   events.append(['random',args[0]]);cpu.ax=case['roll']
  else:events.append(['restore',*args[:2]])
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError(('helper did not return',case))
 assert events==expected,(case,events,expected)
print(f'{len(cases)} native effect-8 helper cases match ordered pixel I/O and random calls.')
