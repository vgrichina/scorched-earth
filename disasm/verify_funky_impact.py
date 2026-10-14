#!/usr/bin/env python3
"""Native Funky Bomb impact dispatch, intercepting damage/sound/animation.
Checks shield early return and body-damage request. Animation pixels are
covered separately; this intentionally does not validate weapon sub-bombs.
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
cases=[dict(hit=hit,energy=energy) for hit in ('terrain','shield','body') for energy in (0,6,100)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {handleBehavior} from './web/js/behaviors.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 seedRandom(17);const initial=getRandomState();
 const result=handleBehavior({x:180,y:240,weaponIdx:7,attackerIdx:1,
   hitPixel:c.hit==='shield'?5:0},c.hit==='terrain'?'hit_terrain':'hit_tank');
 return {directHit:result.directHit,explode:result.explode,spawn:result.spawn.length,spread:result.funkySpread??null,
   unchanged:JSON.stringify(initial)===JSON.stringify(getRandomState())};
})));
''',json.dumps(cases)],cwd=root,text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack,tank=0x4FC80,0x5F4A0,0xD568
 for off,v in [(0x519A,65535),(0xE344,5),(0x120E+5*52,80),
  (0xE1E4,0 if case['hit']=='terrain' else tank),
  (0xE1E6,0 if case['hit']=='terrain' else 0x4FC8),
  (0xE1E8,int(case['hit']=='shield')),(tank+0xA2,case['energy'])]:mem.write16(ds+off,v)
 cpu.segs[:]=[0,0x1E5E,0x5F4A,0x4FC8];cpu.ip=0;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,180,240]):mem.write16(stack+0x2400+i*2,v)
 events=[]
 for _ in range(10):
  reason,_=run_fast(cpu,mem,ports,handler,10000,bp_set={0x710}|{a-0x6100 for a in (0x4C117,0x3FFD2,0x31B48,0x24894)})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(case,reason,hex(addr))
  if addr==0x710:break
  sp=stack+cpu.regs[4];args=[mem.read16(sp+o) for o in (4,6,8,10)]
  if addr==0x4C117-0x6100:assert args[:2]==[1000,10]
  elif addr==0x24894-0x6100:
   assert args[:3]==[180,240,80];events.append('sequence')
  else:
   assert args[:2]==[tank,0x4FC8]
   shield=addr==0x3FFD2-0x6100
   assert args[2:]==([10,0] if shield else [case['energy'],1]),(case,args)
   events.append('shield' if shield else 'body')
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native handler did not return')
 direct=next((event for event in events if event!='sequence'),None)
 assert port['directHit']==direct,(case,port,events)
 if direct=='shield':
  assert events==['shield'] and not port['explode'] and port['spawn']==0 and port['unchanged'],(case,port,events)
 else:
  assert events==(['body','sequence'] if direct else ['sequence'])
  assert port['spread']==80 and not port['explode'] and port['spawn']==0 and port['unchanged'],(case,port)
  # The runtime consumes sequence RNG after direct-hit damage, when stepped.
print(f'{len(cases)} native Funky Bomb impacts match shield early return and body-damage dispatch; shield contacts preserve RNG and spawn nothing. Animation callees are intercepted.')
