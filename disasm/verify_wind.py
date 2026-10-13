#!/usr/bin/env python3
"""Execute the EXE wind kernel and check wind plus RNG continuation."""
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
cases=[dict(seed=seed,wind=wind) for seed in range(32) for wind in (0,1,2,3,5,10,25,50,100,500)]
actual=json.loads(subprocess.check_output([
 'node','--input-type=module','-e',
 "import {config} from './web/js/config.js';import {seedRandom,random} from './web/js/utils.js';"
 "import {game,generateWind} from './web/js/game.js';"
 "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{config.wind=c.wind;seedRandom(c.seed);"
 "generateWind();return {wind:game.wind,next:random(65535)};})));",json.dumps(cases)
],cwd=root,text=True))
mem=Memory();load_exe(root/'earth/SCORCH.EXE',mem)
ds,stack=0x4FC80,0x80000
mem.write16(ds+0x519A,65535)
for case,port in zip(cases,actual):
 cpu,ports=CPU(),PortIO();ports.mem=mem
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 cpu.segs[:]=[0,0,0x8000,0x4FC8]
 def call(offset,segment,args=(),stop=0x710):
  cpu.segs[1]=segment;cpu.ip=offset-0x6100-segment*16;cpu.regs[4]=0x2400
  for i,value in enumerate([0x110,0x60,*args]):mem.write16(stack+0x2400+i*2,value)
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={stop})
  assert reason=='breakpoint',(case,hex(offset),reason)
 call(0x32994,0x2C89,[case['seed']])
 mem.write16(ds+0x515C,case['wind'])
 call(0x2943A,0x22CA,stop=0x29488-0x6100)
 wind=mem.read16(ds+0x515A)
 if wind>=32768:wind-=65536
 call(0x32E1B,0x2C89,[65535])
 assert port==dict(wind=wind,next=cpu.ax),(case,port,wind,cpu.ax)
print(f'{len(cases)} wind cases match EXE value and subsequent RNG, including zero and odd maxima.')
