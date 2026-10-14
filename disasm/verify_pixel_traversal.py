#!/usr/bin/env python3
"""Compare every callback coordinate from native rectangle traversal 0x1CFC7."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[(1,1),(1,7),(8,1),(2,2),(3,5),(16,16),(31,32),(32,48),(105,127)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {rectanglePixelOrder} from './web/js/pixel-traversal.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(([w,h])=>[...rectanglePixelOrder(w,h)])));
''',json.dumps(cases)],cwd=root,text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0;mem.write16(ds+0x519A,65535)
for (w,h),port in zip(cases,actual):
 cpu.segs[:]=[0,0x16EA,0x5F4A,0x4FC8];cpu.ip=0x27;cpu.regs[4]=0x2400
 for off,val in [(0,0x110),(2,0x60),(4,w),(6,h),(8,0x100),(10,0x60)]:mem.write16(stack+0x2400+off,val)
 points=[]
 for _ in range(w*h+2):
  reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x700,0x710})
  assert reason=='breakpoint',(w,h,reason)
  if cpu.segs[1]*16+cpu.ip==0x710:break
  sp=stack+cpu.regs[4];points.append([mem.read16(sp+4),mem.read16(sp+6)])
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('rectangle traversal did not finish')
 assert points==port,(w,h,'callback order differs')
 assert len(points)==w*h and len(set(map(tuple,points)))==w*h
print(f'{len(cases)} native rectangle traversals match every callback in order, including origin last.')
