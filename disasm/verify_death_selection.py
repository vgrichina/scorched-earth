#!/usr/bin/env python3
"""Native death selector: reachable effects and castle reroll/draw count.
RNG return values are supplied identically to both; this is not an RNG oracle.
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
cases=[dict(castle=c,rolls=[i,3]) for c in (0,1) for i in range(11)]
cases+=[dict(castle=1,rolls=[8]*n+[i]) for n in (2,5) for i in range(11) if i!=8]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {chooseDeathEffect} from './web/js/death-effects.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 const bounds=[];let i=0;const effect=chooseDeathEffect(c.castle,b=>{bounds.push(b);return c.rolls[i++];});
 return {effect,bounds};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for case,port in zip(cases,actual):
 mem.write16(ds+0x50D8,case['castle'])
 cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip=0x1DCA4-0x6100-0x17AB0
 cpu.regs[5]=0x2400;cpu.regs[4]=0x23D0;bounds=[]
 for _ in range(20):
  reason,_=run_fast(cpu,mem,ports,handler,10000,bp_set={0x32E1B-0x6100,0x1DCC7-0x6100})
  addr=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(case,reason,hex(addr))
  if addr==0x1DCC7:break
  sp=stack+cpu.regs[4];bounds.append(mem.read16(sp+4));cpu.regs[0]=case['rolls'][len(bounds)-1]
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('selector did not finish')
 assert dict(effect=cpu.regs[3],bounds=bounds)==port,(case,cpu.regs[3],bounds,port)
print(f'{len(cases)} native death selections match effect index, random(11) bounds and castle reroll counts.')
