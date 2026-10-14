#!/usr/bin/env python3
"""Exhaustive support masks against native falling detection at 0x20468."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(kind=kind,half=half,mask=mask) for kind,half in ((5,3),(0,4),(2,5)) for mask in range(1<<(2*half+1))]
port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,setPixel} from './web/js/framebuffer.js';
import {terrain,terrainBitmap} from './web/js/terrain.js';
import {players,createPlayers,checkTanksFalling,stepFallingTanks} from './web/js/tank.js';
createPlayers(1);let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 pixels.fill(80);terrainBitmap.fill(0);terrain.fill(config.screenHeight);
 Object.assign(players[0],{x:16,y:44,tankType:c.kind,alive:true,falling:false});
 for(let dx=-c.half;dx<=c.half;dx++)if(c.mask&(1<<(dx+c.half))){
  setPixel(16+dx,45,120);terrainBitmap[45*config.screenWidth+16+dx]=120;terrain[16+dx]=45;
 }
 const starts=checkTanksFalling();
 Object.assign(players[0],{falling:true,energy:100,fallDamageAccum:0,parachuteDeployed:false});
 players[0].inventory.fill(0);config.impactDamage=1;
 stepFallingTanks();
 return {starts,x:players[0].x,y:players[0].y,damage:players[0].fallDamageAccum};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,val in ((0x519A,65535),(0x50D4,1),(0xEF38,476),(0xEEF8,0x100),(0xEEFA,0x60)):
 mem.write16(ds+off,val)
for c,actual in zip(cases,port):
 base=ds+0xD568
 for off,val in ((8,c['half']),(14,16),(16,44),(0x18,1)):mem.write16(base+off,val)
 cpu.segs[:]=[0,0x1A05,0x5F4A,0x4FC8];cpu.ip=0x318;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 for _ in range(30):
  reason,count=run_fast(cpu,mem,ports,handler,10000,bp_set={0x700,0x710})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x710:break
  sp=stack+cpu.regs[4];x=mem.read16(sp+4);y=mem.read16(sp+6)
  assert y==45
  cpu.regs[0]=80 if c['mask']&(1<<(x-16+c['half'])) else 120
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native support check did not return')
 expected=bool(mem.read16(ds+0xCE58))
 assert actual['starts']==expected,(c,actual,expected)
 # Run a real falling iteration with drawing/sound/damage side effects stubbed.
 for off,val in ((0xCE58,1),(0xCE80,0),(0xCE6C,0),(0x5114,1),(0x5164,2),(0xEF42,3),(0xEF3C,356)):
  mem.write16(ds+off,val)
 for off,val in ((0x0C,0),(0x28,0),(0xA0,0),(0xA2,100),(0xA4,0)):mem.write16(base+off,val)
 cpu.segs[:]=[0,0x1A05,0x5F4A,0x4FC8];cpu.ip=0x48C;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 stubs={0x3FB27,0x1CD38,0x403F5,0x4C117,0x31B48,0x104F6}
 for _ in range(100):
  reason,count=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,*[o-0x6100 for o in stubs]})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x710:break
  sp=stack+cpu.regs[4]
  if addr==0x700:
   x,y=mem.read16(sp+4),mem.read16(sp+6)
   assert y==45
   cpu.regs[0]=80 if c['mask']&(1<<(x-16+c['half'])) else 120
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native falling step did not return')
 native=dict(starts=expected,x=mem.read16(base+14),y=mem.read16(base+16),damage=mem.read16(ds+0xCE80))
 assert actual==native,(c,actual,native)
print(f'{len(cases)} support masks match native fall-start detection and one-step slide/descent/damage across all tank widths.')
