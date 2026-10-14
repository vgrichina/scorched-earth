#!/usr/bin/env python3
"""Native effect-10 velocity source with real R250 sampling and retry loop."""
import json,struct,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {seedRandom,getRandomState} from './web/js/utils.js';
import {randomDeathVelocity} from './web/js/death-particles.js';
console.log(JSON.stringify([0,1,1234].map(seed=>{
 seedRandom(seed);const initial=getRandomState();
 const velocities=Array.from({length:500},()=>randomDeathVelocity());
 return {seed,initial,velocities,final:getRandomState()};
})));
'''],cwd=root,text=True))
for case in actual:
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 mem.write16(ds+0x519A,65535);mem.write16(ds+0xEC06,case['initial']['index'])
 for i,word in enumerate(case['initial']['words']):mem.write16(ds+0xEA12+i*2,word)
 for index,port in enumerate(case['velocities']):
  cpu.segs[:]=[0,0x2C89,0x5F4A,0x4FC8];cpu.ip=0x3F4;cpu.regs[4]=0x2400
  for off,val in [(0,0x110),(2,0x60),(4,0x2600),(6,0x5F4A),(8,0x2608),(10,0x5F4A)]:mem.write16(stack+0x2400+off,val)
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710})
  assert reason=='breakpoint',(case['seed'],index,reason)
  x,y=struct.unpack_from('<dd',mem.data,stack+0x2600)
  expected=dict(vx=x*400,vy=abs(y*400))
  assert port==expected,(case['seed'],index,port,expected)
 final=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert final==case['final'],'RNG mismatch'
print('1500 particle velocities match native sampled vectors exactly; all three complete RNG states match.')
