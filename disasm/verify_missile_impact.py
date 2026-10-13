#!/usr/bin/env python3
"""Compare ordinary missile handler dispatch; damage/blast callees intercepted.

Checkpoint uses Large explosions (3x at 360 pixels wide).
Does not prove special shield reflection, energy accounting or blast scheduling.
"""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(weapon=w,hit=hit,energy=e) for w in (2,3,4,5)
       for hit in ('terrain','body','shield') for e in (0,1,55,100)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {handleBehavior} from './web/js/behaviors.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 const result=handleBehavior({weaponIdx:c.weapon,hitPixel:c.hit==='shield'?13:8},c.hit==='terrain'?'hit_terrain':'hit_tank');
 const events=[];
 if(result.directHit==='shield')events.push(['shield',10,0]);
 if(result.directHit==='body')events.push(['body',c.energy,1]);
 if(result.explode)events.push(['blast',100,110,result.radius*3,0]);
 return events;
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 load_state('/tmp/scorched-before-walk.state',cpu,mem,ports,handler)
 ds,stack=0x4FC80,0x5F4A0
 for off,v in ((0x519A,65535),(0xE344,c['weapon']-2),(0xE1E4,0),
               (0xE1E6,0 if c['hit']=='terrain' else 0x9000),(0xE1E8,int(c['hit']=='shield'))):
  mem.write16(ds+off,v)
 mem.write16(0x900A2,c['energy'])
 cpu.segs[:]=[0,0x3DAE,0x5F4A,0x4FC8];cpu.ip=0x21;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,100,110)):mem.write16(stack+0x2400+2*i,v)
 events=[]
 for _ in range(10):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710,*[v-0x6100 for v in (0x3FFD2,0x31B48,0x43D3A,0x4C117)]})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x710:break
  sp=cpu.regs[4]
  if addr==0x43D3A-0x6100:events.append(['blast',*[mem.read16(stack+sp+o) for o in (4,6,8,10)]])
  elif addr in (0x3FFD2-0x6100,0x31B48-0x6100):
   events.append(['shield' if addr==0x3FFD2-0x6100 else 'body',mem.read16(stack+sp+8),mem.read16(stack+sp+10)])
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native missile did not return')
 assert events==port,(c,events,port)
print(f'{len(cases)} ordinary missile dispatch sequences match native body/shield damage requests and blast ordering.')
