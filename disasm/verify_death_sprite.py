#!/usr/bin/env python3
"""Native 0x408B7 ordered tank particle records; only allocation is stubbed."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(kind=k,direction=d,index=i,end=end) for k in range(7)
       for d in (-1,1) for i in (0,4,9) for end in ((0,-12),(8,-3),(-8,-3),(0,0),(3,-7))]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {getDeathSpritePixels,TANK_TYPES} from './web/js/tank.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 const type=TANK_TYPES[c.kind];
 const player={index:c.index,tankType:c.kind,direction:c.direction,angle:45,x:100,y:200,
  barrelEndX:100+c.end[0],barrelEndY:200+c.end[1]};
 return {pixels:getDeathSpritePixels(player),bx:type.barrelXOff,by:type.barrelYOff};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack,tank=0x4FC80,0x5F4A0,0xD568
mem.write16(ds+0x519A,65535)
for case,port in zip(cases,actual):
 for off,val in [(0,case['kind']),(4,port['bx']),(6,port['by']),(14,100),(16,200),
   (18,100+case['end'][0]),(20,200+case['end'][1]),(0x94,case['direction']),(0xA0,case['index'])]:
  mem.write16(ds+tank+off,val&65535)
 cpu.segs[:]=[0,0x3A64,0x5F4A,0x4FC8];cpu.ip=0x177;cpu.regs[4]=0x2400
 for off,val in [(0,0x110),(2,0x60),(4,tank),(6,0x4FC8),(8,0x2500),(10,0x5F4A)]:
  mem.write16(stack+0x2400+off,val)
 reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x8897-0x6100})
 assert reason=='breakpoint',(case,reason)
 sp=stack+cpu.regs[4];allocated=mem.read16(sp+4)
 cpu.regs[0]=0;cpu.regs[2]=0x7000
 cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710})
 assert reason=='breakpoint',(case,reason)
 count=mem.read16(stack+0x2500)
 signed=lambda v:v if v<32768 else v-65536
 expected=[[signed(mem.read16(0x70000+i*6+j*2)) for j in range(3)] for i in range(count)]
 assert count*6<=allocated
 assert expected==port['pixels'],(case,expected,port['pixels'])
print(f'{len(cases)} native particle source lists match: seven tank types, both directions, three palette slots and five barrel endpoints.')
