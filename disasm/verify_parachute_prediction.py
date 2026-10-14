#!/usr/bin/env python3
"""Compare parachute damage prediction to the real native 0x202F6 routine."""
import json, subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(kind=k,half=h,mask=m,depth=d,x=x) for k,h in ((5,3),(0,4),(2,5))
       for m in range(1<<(2*h+1)) for d,x in ((4,16),(8,12),(8,347))]
port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,setPixel} from './web/js/framebuffer.js';
import {predictFallDamage,createPlayers,players,stepFallingTanks} from './web/js/tank.js';
import {WPN} from './web/js/weapons.js';
createPlayers(1);
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 pixels.fill(80);
 for(let x=0;x<config.screenWidth;x++)setPixel(x,44+c.depth,120);
 for(let dx=-c.half;dx<=c.half;dx++)if(c.mask&(1<<(dx+c.half)))setPixel(c.x+dx,45,120);
 const p=players[0];
 Object.assign(p,{x:c.x,y:44,tankType:c.kind,alive:true,falling:true,energy:100,fallDamageAccum:0,parachuteDeployed:false});
 p.inventory.fill(0);p.inventory[WPN.PARACHUTE]=1;p.inventory[WPN.BATTERY]=c.depth===8?1:0;
 const damage=predictFallDamage(p);
 stepFallingTanks();
 return {damage,deployed:p.parachuteDeployed};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,val in ((0x519A,65535),(0xEF38,476),(0xEF42,3),(0xEF3C,356),(0x5164,2),(0xEEF8,0x100),(0xEEFA,0x60)):
 mem.write16(ds+off,val)
for c,actual in zip(cases,port):
 base=ds+0xD568
 for off,val in ((8,c['half']),(14,c['x']),(16,44)):mem.write16(base+off,val)
 cpu.segs[:]=[0,0x1A05,0x5F4A,0x4FC8];cpu.ip=0x1A6;cpu.regs[4]=0x2400
 for off,val in ((0,0x110),(2,0x60),(4,0xD568),(6,0x4FC8)):mem.write16(stack+0x2400+off,val)
 for _ in range(200):
  reason,count=run_fast(cpu,mem,ports,handler,10000,bp_set={0x700,0x710})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x710:break
  sp=stack+cpu.regs[4];x,y=mem.read16(sp+4),mem.read16(sp+6)
  bit=x-c['x']+c['half']
  occupied=y==44+c['depth'] or (y==45 and 0<=bit<=2*c['half'] and c['mask']&(1<<bit))
  cpu.regs[0]=80 if occupied else 120
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError(('prediction failed to return',c))
 assert actual['damage']==cpu.regs[0],(c,actual,cpu.regs[0])
 assert actual['deployed']==(cpu.regs[0]>(10 if c['depth']==8 else 5)),(c,actual,cpu.regs[0])
print(f'{len(cases)} native parachute predictions match across support masks, depths, widths and wall clamps.')
