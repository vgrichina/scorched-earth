#!/usr/bin/env python3
"""Compare native 0x318D8 energy gradient before its HUD refresh."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(rgb=rgb,energy=e,sky=sky) for rgb in ([35,55,10],[63,63,63],[50,17,0],[28,44,8]) for e in range(-100,101) for sky in (2,6)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {updateTankEnergyPalette} from './web/js/tank.js';
import {setupSkyPalette,palette6} from './web/js/palette.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 setupSkyPalette(c.sky);palette6.fill(42,27,36);
 updateTankEnergyPalette({index:1,energy:c.energy,displayColor:c.rgb});
 return [...palette6.slice(27,36)];
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack,player=0x4FC80,0x5F4A0,0x90000
mem.write16(ds+0x519A,65535)
for c,port in zip(cases,actual):
 mem.write16(ds+0x5110,c['sky'])
 for off,val in ((0x1A,8),(0xA2,c['energy']&65535),(0xA4,65535 if c['energy']<0 else 0),(0xA6,100),(0xA8,0),*zip((0x1C,0x1E,0x20),c['rgb'])):
  mem.write16(player+off,val)
 cpu.segs[:]=[0,0x2AA6,0x5F4A,0x4FC8];cpu.ip=0xD78;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,0,0x9000)):mem.write16(stack+0x2400+2*i,v)
 expected=[42]*9
 for _ in range(5):
  reason,count=run_fast(cpu,mem,ports,handler,100000,bp_set={0x319BC-0x6100,0x3A046-0x6100})
  addr=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x319BC:break
  sp=stack+cpu.regs[4];index=mem.read16(sp+4)
  # VGA DAC retains six bits, including negative gradient values after death.
  expected[(index-9)*3:(index-8)*3]=[mem.read16(sp+o)&63 for o in (6,8,10)]
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 assert expected==port,(c,expected,port)
print(f'{len(cases)} native energy-palette cases match, including contrast-adjusted colors and Black sky.')
