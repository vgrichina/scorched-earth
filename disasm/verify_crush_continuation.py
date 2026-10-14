#!/usr/bin/env python3
"""Native landing/crush/absorption sequence through two shield fades.
Real falling dispatch and shield absorption run; pixel reads, drawing, sound
and final HP mutation are intercepted. Checks every fade and HP request.
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
port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players,stepFallingTanks} from './web/js/tank.js';
import {pixels,setPixel,setBackground} from './web/js/framebuffer.js';
import {shieldBreak,drawShieldBreak} from './web/js/shields.js';
Object.assign(config,{impactDamage:1,wallType:0});createPlayers(4);
pixels.fill(80);setBackground(new Uint8Array(480).fill(80));
const events=[];
players.forEach((p,i)=>{
 Object.assign(p,{x:i<2?16:116,y:i%2?50:44,tankType:0,colorIndex:i,falling:i%2===0,
 fallDamageAccum:8,activeShield:2,shieldEnergy:i%2?55:0,energy:100});p.inventory.fill(0);
 let energy=100;Object.defineProperty(p,'energy',{get:()=>energy,set:value=>{if(value!==energy)events.push(['hp',i,energy-value]);energy=value;}});
});
setPixel(16,45,8);setPixel(116,45,24);
// Stationary victims remain supported during the wrapper support rescan.
setPixel(16,51,120);setPixel(116,51,120);
let active=stepFallingTanks();
for(let tick=0;active&&tick<200;tick++){
 if(shieldBreak.active){events.push(['fade',shieldBreak.playerIdx]);drawShieldBreak();}
 active=stepFallingTanks();
}
if(active)throw new Error('crush continuation did not finish');
console.log(JSON.stringify(events));
'''],cwd=root,text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,v in ((0x519A,65535),(0x50D4,4),(0xEF38,476),(0xEF42,3),(0xEF3C,356),(0xEEF8,0x100),(0xEEFA,0x60),(0x5114,1),(0x5164,2),(0x5154,0)):
 mem.write16(ds+off,v)
for i in range(4):
 base=ds+0xD568+i*0xCA
 for off,v in ((8,4),(14,16 if i<2 else 116),(16,50 if i%2 else 44),(0x18,1),(0x1A,i*8),(0xA0,i),(0x0C,0),(0x28,0),(0x96,55 if i%2 else 0),(0xA2,100),(0xA4,0),(0xC6,0x618C),(0xC8,0x4FC8)):
  mem.write16(base+off,v)
 for off,v in ((0xCE58,int(i%2==0)),(0xCE80,8),(0xCE6C,0)):mem.write16(ds+off+i*2,v)
cpu.segs[:]=[0,0x1A05,0x5F4A,0x4FC8];cpu.ip=0x48C;cpu.regs[4]=0x2400
mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
stubs={0x3A046,0x37688,0x4C0B5,0x4C117,0x4043B,0x1CD38,0x31B48,0x104F6}
events=[]
for _ in range(500):
 reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,*[v-0x6100 for v in stubs]})
 addr=cpu.segs[1]*16+cpu.ip
 assert reason=='breakpoint',(reason,hex(addr))
 if addr==0x710:break
 sp=stack+cpu.regs[4]
 if addr==0x700:
  x,y=mem.read16(sp+4),mem.read16(sp+6);assert y==45
  cpu.regs[0]=8 if x==16 else 24 if x==116 else 120
 if addr+0x6100==0x4C0B5:events.append(['fade',mem.read16(sp+4)//8])
 if addr+0x6100==0x31B48:
  target=(mem.read16(sp+4)-0xD568)//0xCA;amount=mem.read16(sp+8)
  if amount:events.append(['hp',target,amount])
  base=ds+0xD568+target*0xCA;mem.write16(base+0xA2,max(0,mem.read16(base+0xA2)-amount))
 cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
else:raise AssertionError('native crush sequence did not finish')
assert events==port,(events,port)
assert events==[['hp',0,8]]+[['fade',1]]*51+[['hp',1,3],['hp',0,14],['hp',2,8]]+[['fade',3]]*51+[['hp',3,3],['hp',2,14]]
print('Native crush order matches: impact HP, 51 shield frames, victim remainder, self-damage, then the next landing; repeated for a second shield.')
