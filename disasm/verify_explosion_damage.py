#!/usr/bin/env python3
"""Compare native area-damage requests; intercept final shield/energy accounting."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(mode=m,wall=w,x=x,y=y,r=r,weapon=weapon) for m in range(9) for w in (0,1)
       for x,y in ((100,100),(105,100),(110,100),(100,110),(103,104),(110,110),(450,100))
       for r in (10,40) for weapon in (2,3,5)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {getExplosionDamage} from './web/js/explosions.js';
config.screenWidth=360;
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.graphicsMode=c.mode;config.wallType=c.wall;
 return {aspect:GRAPHICS_MODES[c.mode].displayAspect,damage:getExplosionDamage(100,100,c.r,c.x,c.y,c.weapon)};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,v in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0x5154,c['wall']),
               (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),
               (0x50D4,1),(0xD580,1),(0xD576,c['x']),(0xD578,c['y']),(0xE344,c['weapon']-2),(0x683A,0)):
  mem.write16(ds+off,v)
 cpu.segs[:]=[0,0x3DAE,0x5F4A,0x4FC8];cpu.ip=0x43EAB-0x6100-0x3DAE0
 cpu.regs[5],cpu.regs[4],cpu.regs[7]=0x2400,0x23EC,c['r']
 mem.write16(stack+0x2406,100);mem.write16(stack+0x2408,100)
 damage=0
 for _ in range(3):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x43F69-0x6100,0x3FFD2-0x6100})
  assert reason=='breakpoint',(c,reason)
  if cpu.segs[1]*16+cpu.ip==0x43F69-0x6100:break
  sp=cpu.regs[4];damage=mem.read16(stack+sp+8)
  assert mem.read16(stack+sp+10)==1
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('damage loop did not finish')
 assert damage==port['damage'],(c,port,damage)
print(f'{len(cases)} area-damage requests match native distance, aspect, wrap, truncation and weapon scaling.')
