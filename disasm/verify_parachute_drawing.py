#!/usr/bin/env python3
"""Native parachute rasterizer vs port, including all mapped gameplay background colors."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
# Native-to-port palette mapping used by full-frame comparisons.
def mapped(c):return c-40 if 120<=c<150 else c+40 if 80<=c<=104 else c
cases=list(range(150))
port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {pixels} from './web/js/framebuffer.js';
import {drawParachute} from './web/js/tank.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 pixels.fill(c);drawParachute(40,40,6);
 return [...pixels].flatMap((v,i)=>v===6&&c!==6?[i]:[]);
})));
'''],cwd=root,input=json.dumps([mapped(c) for c in cases]),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,val in ((0x519A,65535),(0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60)):mem.write16(ds+off,val)
for bg,actual in zip(cases,port):
 cpu.segs[:]=[0,0x39A2,0x5F4A,0x4FC8];cpu.ip=0x526;cpu.regs[4]=0x2400
 for off,val in ((0,0x110),(2,0x60),(4,40),(6,40),(8,6),(10,120)):mem.write16(stack+0x2400+off,val)
 drawn=set()
 for _ in range(200):
  reason,count=run_fast(cpu,mem,ports,handler,10000,bp_set={0x700,0x710,0x720})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(bg,reason,hex(addr))
  if addr==0x710:break
  sp=stack+cpu.regs[4];x,y=mem.read16(sp+4),mem.read16(sp+6)
  if addr==0x700:cpu.regs[0]=6 if y*360+x in drawn else bg
  else:
   assert mem.read16(sp+8)==6
   drawn.add(y*360+x)
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native drawing did not return')
 assert actual==sorted(drawn),(bg,len(actual),len(drawn),actual[:5],sorted(drawn)[:5])
print(f'{len(cases)} mapped native background colors match parachute geometry and pixel preservation.')
