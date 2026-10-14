#!/usr/bin/env python3
"""Compare damage-time power clamping with native 0x31663."""
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
console.log(JSON.stringify(JSON.parse(input).map(c=>{const p={...c,maxEnergy:100,colorIndex:0};updateTankDamageState(p);return p.power;})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack,base=0x4FC80,0x5F4A0,0x90000
for off,v in ((0x519A,65535),(0x50D6,0),(0x5188,0)):mem.write16(ds+off,v)
for c,port in zip(cases,actual):
 for off,v in ((0xA2,c['energy']),(0xA4,0),(0xA6,100),(0xA8,0),(0x9E,c['power'])):mem.write16(base+off,v)
 cpu.segs[:]=[0,0x2AA6,0x5F4A,0x4FC8];cpu.ip=0x31663-0x6100-0x2AA60;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,0,0x9000)):mem.write16(stack+0x2400+i*2,v)
 reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710})
 assert reason=='breakpoint',(c,reason)
 assert mem.read16(base+0x9E)==port,(c,port,mem.read16(base+0x9E))
print(f'{len(cases)} native damage-time power clamps match across energies 0..100 and five power levels.')
