#!/usr/bin/env python3
"""Native Funky Bomb target selection and 60-entry palette before parent blast.
Actual RNG and ramp arithmetic execute; palette output is intercepted.
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
cases=[dict(x=x,spread=spread,seed=seed) for x,spread in [(180,-1),(3,80),(356,80)] for seed in (0,17,1234)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {chooseFunkyTargets,funkyPalette} from './web/js/death-funky.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 seedRandom(c.seed);const initial=getRandomState();
 return {initial,targets:chooseFunkyTargets(c.x,c.spread),palette:funkyPalette(),final:getRandomState()};
})));
''',json.dumps(cases)],cwd=root,text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 for off,v in [(0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
  (0xEF08,0x100),(0xEF0A,0x60),(0xEF04,0x120),(0xEF06,0x60),(0xEC06,port['initial']['index'])]:mem.write16(ds+off,v)
 for i,word in enumerate(port['initial']['words']):mem.write16(ds+0xEA12+i*2,word)
 cpu.segs[:]=[0,0x1E5E,0x5F4A,0x4FC8];cpu.ip=0x1B4;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,case['x'],240,case['spread']]):mem.write16(stack+0x2400+i*2,v&65535)
 palette=[];cycles=[];rgb=[]
 for _ in range(100):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x720,0x4C0B5-0x6100,0x24AA9-0x6100})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(case,reason)
  if addr==0x24AA9-0x6100:break
  sp=stack+cpu.regs[4];args=[mem.read16(sp+o) for o in (4,6,8,10)]
  if addr==0x700:
   assert args[0]==len(palette);palette.append(args[1:])
  elif addr==0x720:cycles.append(args[:2])
  else:rgb.append(args)
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native setup did not finish')
 bp=stack+cpu.regs[5];count=mem.read16(bp-4)
 targets=[dict(x=mem.read16(bp-0x2E+i*4),y=mem.read16(bp-0x2C+i*4)) for i in range(count)]
 assert targets==port['targets'],(case,targets,port['targets'])
 assert palette==port['palette'],(case,palette,port['palette'])
 assert cycles==[[170,60]] and rgb==[[254,30,30,63]],(cycles,rgb)
 final=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert final==port['final'],(case,'RNG differs')
print(f'{len(cases)} native Funky Bomb setups match targets, 60 palette entries, initial cycle request, trail color and complete RNG.')
