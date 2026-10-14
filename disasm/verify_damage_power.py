#!/usr/bin/env python3
"""Compare native power clamping and active-player HUD refresh decisions.
Drawing callees are intercepted; this checks refresh timing, not glyph pixels.
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
cases=[dict(energy=e,power=p) for e in range(101) for p in (0,100,200,500,1000)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {updateTankDamageState} from './web/js/tank.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{const p={...c,maxEnergy:100,colorIndex:0,hudPower:777};updateTankDamageState(p);return {power:p.power,refresh:p.hudPower===undefined};})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack,base=0x4FC80,0x5F4A0,0x90000
for off,v in ((0x519A,65535),(0x50D6,1),(0x5188,0),(0x5182,0),(0x5184,0x9000),(0xEF14,0x100),(0xEF16,0x60)):mem.write16(ds+off,v)
for c,port in zip(cases,actual):
 for off,v in ((0xA2,c['energy']),(0xA4,0),(0xA6,100),(0xA8,0),(0x9E,c['power'])):mem.write16(base+off,v)
 cpu.segs[:]=[0,0x2AA6,0x5F4A,0x4FC8];cpu.ip=0x31663-0x6100-0x2AA60;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,0,0x9000)):mem.write16(stack+0x2400+i*2,v)
 draws=[]
 for _ in range(8):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710,0x700,0x4569F-0x6100,0x4C914-0x6100})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x710:break
  if addr==0x700:draws.append('clear')
  if addr==0x4C914-0x6100:draws.append('text')
  sp=stack+cpu.regs[4]
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native power update did not return')
 assert mem.read16(base+0x9E)==port['power'],(c,port,mem.read16(base+0x9E))
 assert draws in ([],['clear','text']),(c,draws)
 assert bool(draws)==port['refresh'],(c,port,draws)
print(f'{len(cases)} native power clamps and HUD refresh decisions match across energies 0..100 and five power levels.')
