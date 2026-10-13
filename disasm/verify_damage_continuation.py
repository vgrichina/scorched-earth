#!/usr/bin/env python3
"""Compare two-target native area-damage ordering through sequential shield fades.
Real area loop and shield absorption execute; drawing, sound, scoring and final
HP mutation are intercepted. Checks the order of fade frames and HP requests.
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
import {createPlayer,players} from './web/js/tank.js';
import {applyExplosionDamage,resumeExplosionDamage} from './web/js/explosions.js';
import {shieldBreak,drawShieldBreak} from './web/js/shields.js';
Object.assign(config,{graphicsMode:4,wallType:0});
players.splice(0,players.length,...[0,1].map(i=>Object.assign(createPlayer(i,'Tank'),{x:100,y:100,activeShield:2,shieldEnergy:55})));
const events=[],energy=[100,100];let completed=0;
applyExplosionDamage(100,100,10,0,2,()=>completed++);
for(let i=0;i<200&&completed===0;i++){
 if(shieldBreak.active){events.push(['fade',shieldBreak.playerIdx]);drawShieldBreak();}
 resumeExplosionDamage();
 players.forEach((p,i)=>{if(p.energy!==energy[i]){events.push(['hp',i,energy[i]-p.energy]);energy[i]=p.energy;}});
}
if(completed!==1)throw new Error('damage continuation did not finish exactly once');
console.log(JSON.stringify(events));
'''],cwd=root,text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,v in ((0x519A,65535),(0xEF34,int(.55*65536)),(0xEF36,0),(0x5154,0),(0x50D4,2),(0xE344,0),(0x5182,0),(0x5184,0),(0x5188,0)):
 mem.write16(ds+off,v)
for i in range(2):
 base=ds+0xD568+i*0xCA
 for off,v in ((14,100),(16,100),(0x18,1),(0x1A,i*8),(0x96,55),(0xA2,100),(0xC6,0x618C),(0xC8,0x4FC8)):
  mem.write16(base+off,v)
cpu.segs[:]=[0,0x3DAE,0x5F4A,0x4FC8];cpu.ip=0x43EAB-0x6100-0x3DAE0
cpu.regs[5],cpu.regs[4],cpu.regs[7]=0x2400,0x23EC,10
mem.write16(stack+0x2406,100);mem.write16(stack+0x2408,100)
stubs={0x3A046,0x37688,0x4C0B5,0x4C117,0x4043B,0x1CD38,0x31B48}
events=[]
for _ in range(300):
 reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={v-0x6100 for v in stubs|{0x43F69}})
 addr=cpu.segs[1]*16+cpu.ip+0x6100
 assert reason=='breakpoint',(reason,hex(addr))
 if addr==0x43F69:break
 sp=cpu.regs[4]
 if addr==0x4C0B5:events.append(['fade',mem.read16(stack+sp+4)//8])
 if addr==0x31B48:
  target=(mem.read16(stack+sp+4)-0xD568)//0xCA
  events.append(['hp',target,mem.read16(stack+sp+8)])
  assert mem.read16(stack+sp+10)==0
 cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
else:raise AssertionError('native area loop did not finish')
assert events==port,(events,port)
assert events==[['fade',0]]*51+[['hp',0,45]]+[['fade',1]]*51+[['hp',1,45]]
print('Native two-target sequence matches: 51 fade frames, HP remainder, then the next shield; completion runs once.')
