#!/usr/bin/env python3
"""Native effect-9 burst dispatch with real RNG/trig/aspect calculation.
Palette and burst-drawing callees are intercepted; cleanup is outside scope.
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
cases=[dict(mode=m,seed=s,x=x,y=y) for m in (0,4,8) for s,x,y in ((0,180,240),(17,3,38),(1234,356,476))]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
import {deathBurstSequence,deathBurstPalette} from './web/js/death-bursts.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 config.graphicsMode=c.mode;seedRandom(c.seed);const initial=getRandomState();
 const events=[...deathBurstSequence(c.x,c.y)];
 return {initial,events,palette:deathBurstPalette(),final:getRandomState(),aspect:GRAPHICS_MODES[c.mode].displayAspect};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,val in [(0x519A,65535),(0xEF46,0),(0xEF34,int(a*65536) if a<1 else 0),
  (0xEF36,int(65536/a) if a>1 else 0),(0xEF08,0x100),(0xEF0A,0x60),
  (0xEEFC,0x120),(0xEEFE,0x60),(0xEC06,port['initial']['index'])]:mem.write16(ds+off,val)
 for i,word in enumerate(port['initial']['words']):mem.write16(ds+0xEA12+i*2,word)
 cpu.segs[:]=[0,0x34E1,0x5F4A,0x4FC8];cpu.ip=0x16F;cpu.regs[4]=0x2400
 for off,val in [(0,0x110),(2,0x60),(4,case['x']),(6,case['y'])]:mem.write16(stack+0x2400+off,val)
 events=[];palette=[]
 for _ in range(150):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x720,0x3AF1F-0x6100,0x3B1F9-0x6100})
  addr=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(case,reason,hex(addr))
  if addr==0x3B1F9:break
  sp=stack+cpu.regs[4]
  if addr==0x3AF1F:
   signed=lambda v:v if v<32768 else v-65536
   events.append(dict(zip(('x','y','radius'),[signed(mem.read16(sp+o)) for o in (4,6,8)])))
  elif addr==0x6800:
   assert mem.read16(sp+4)==len(palette)
   palette.append([mem.read16(sp+o) for o in (6,8,10)])
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('burst dispatch did not finish')
 assert events==port['events'],(case,events,port['events'])
 assert palette==port['palette'],(case,'grayscale ramp differs')
 final=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert final==port['final'],'RNG differs'
print(f'{len(cases)} native effect-9 sequences match all 61 burst centers/radii, 40 palette entries and complete RNG state.')
