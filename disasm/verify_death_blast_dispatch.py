#!/usr/bin/env python3
"""Real death branches 1..3: palette/blast/delay/erase order and arguments.
Callees are intercepted; this does not verify their pixels, damage or timing.
"""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
# Include production scaled radii and irregular values to verify table lookup.
cases=[dict(effect=e,radii=r) for e in (1,2,3) for r in ([10,20,37],[15,30,56],[20,40,75],[40,80,150],[60,120,225],[17,43,91])]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {deathBlastSequence} from './web/js/death-effects.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>deathBlastSequence(c.effect,c.radii))));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack,tank=0x4FC80,0x5F4A0,0xD632
mem.write16(ds+0x519A,65535);mem.write16(ds+tank+0x1A,8)
for case,port in zip(cases,actual):
 for off,radius in zip((0x1242,0x1276,0x12AA),case['radii']):mem.write16(ds+off,radius)
 entry={1:0x1DCF5,2:0x1DD0A,3:0x1DD37}[case['effect']]
 cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip=entry-0x6100-0x17AB0
 cpu.regs[5]=0x2400;cpu.regs[4]=0x23D0;cpu.regs[6]=123;cpu.regs[7]=240
 mem.write16(stack+0x2406,tank);mem.write16(stack+0x2408,0x4FC8)
 events=[]
 for _ in range(30):
  reason,_=run_fast(cpu,mem,ports,handler,10000,bp_set={a-0x6100 for a in (0x1DF65,0x43D3A,0x104F6,0x3FC7D,0x1DE63)})
  addr=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(case,reason,hex(addr))
  if addr==0x1DE63:break
  sp=stack+cpu.regs[4]
  if addr==0x1DF65:
   assert mem.read16(sp+4)==8
   events.append(dict(kind='palette'))
  elif addr==0x43D3A:
   assert [mem.read16(sp+o) for o in (4,6)]==[123,240]
   flag=mem.read16(sp+10);assert flag in (0,1)
   events.append(dict(kind='blast',radius=mem.read16(sp+8),settle=bool(flag)))
  elif addr==0x104F6:events.append(dict(kind='delay',duration=mem.read16(sp+4)))
  else:
   assert [mem.read16(sp+o) for o in (4,6)]==[tank,0x4FC8]
   events.append(dict(kind='erase'))
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('death blast branch did not finish')
 assert events==port,(case,events,port)
print(f'{len(cases)} native death-blast branches match palette/blast/delay/erase ordering, coordinates, radii and final-settling flags.')
