#!/usr/bin/env python3
"""Execute EXE trace-color selection and trace DAC initialization.

Does not verify persistent path pixels, drawing cadence or erasure.
"""
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root=Path(__file__).resolve().parent.parent
cases=[dict(color=color,trace=trace,weapon=weapon)
       for color in range(10) for trace in (0,1) for weapon in (2,13)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {players,createPlayers} from './web/js/tank.js';
import {createProjectile} from './web/js/physics.js';
import {palette6,setupTracePalette} from './web/js/palette.js';
createPlayers(2);setupTracePalette();
console.log(JSON.stringify({rgb:[...palette6.slice(330,360)],cases:JSON.parse(process.argv[1]).map(c=>{
 config.tracePaths=c.trace;players[0].colorIndex=c.color;
 const p=createProjectile(20,50,10,10,c.weapon,0);
 config.tracePaths=1-c.trace;
 return p.traceColor;
})}));
''',json.dumps(cases)],cwd=root,text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
mem.write16(ds+0x519A,65535)
cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
cpu.regs[4]=0x2400
mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
# Use a segment that places the far routine within a 16-bit IP.
cpu.segs[1]=0x2AA6;cpu.ip=0x32430-0x6100-0x2AA60
reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710})
assert reason=='breakpoint'
assert actual['rgb']==[v for rgb in ports.palette[110:120] for v in rgb]
for case,port in zip(cases,actual['cases']):
    cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
    cpu.ip=0x2186F-0x6100-0x1ADA0
    cpu.regs[5]=0x2400;cpu.regs[4]=0x23E0;cpu.regs[7]=0
    for off,value in ((0x5168,case['trace']),(0xD546,13),(0xCEB8,0),(0xCEBA,0x9000)):
        mem.write16(ds+off,value)
    mem.write16(stack+0x240A,case['weapon'])
    mem.write16(0x9002A,0);mem.write16(0x9002C,0x9100)
    mem.write16(0x910A0,case['color'])
    reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x218BE-0x6100})
    assert reason=='breakpoint'
    expected=mem.read16(0x90028)
    assert port==(None if expected==120 else expected),(case,port,expected)
print('40 trace-color selections and all ten trace DAC entries match EXE; selection survives config changes.')
