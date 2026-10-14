#!/usr/bin/env python3
"""Native contact scan, landing and damage dispatch against synthetic support rows."""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
from verify_falling_frames import signed_energy
root=Path(__file__).resolve().parent.parent
cases=[dict(kind=k,half=h,mask=m,impact=impact,mixed=mixed) for k,h in ((5,3),(0,4),(2,5))
 for m in range(1<<(2*h+1)) for impact,mixed in ((0,False),(1,False),(1,True))]
def color(c,bit):
 if not c['mask']&(1<<bit):return 120
 return 80 if c['mixed'] and bit%3==0 else 8 if bit%2 else 16
for c in cases:c['row']=[color(c,b) for b in range(2*c['half']+1)]
port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,setPixel} from './web/js/framebuffer.js';
import {terrainBitmap,terrain} from './web/js/terrain.js';
import {createPlayers,players,stepFallingTanks,fallingFlash} from './web/js/tank.js';
let input='';for await(const c of process.stdin)input+=c;createPlayers(3);
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 pixels.fill(80);terrainBitmap.fill(0);terrain.fill(config.screenHeight);
 players.forEach((p,i)=>{Object.assign(p,{x:i?200:16,y:i?300:44,tankType:c.kind,alive:true,falling:i===0,
 colorIndex:i,energy:100,fallDamageAccum:i?0:8,parachuteDeployed:false,shieldEnergy:0,activeShield:0});p.inventory.fill(0);});
 c.row.forEach((v,i)=>setPixel(16-c.half+i,45,v===120?80:v===80?120:v));
 config.impactDamage=c.impact;stepFallingTanks();while(fallingFlash.delay)stepFallingTanks();
 return {x:players[0].x,y:players[0].y,damage:players[0].fallDamageAccum,energy:players.map(p=>p.energy)};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,val in ((0x519A,65535),(0x50D4,3),(0xEF38,476),(0xEF42,3),(0xEF3C,356),(0xEEF8,0x100),(0xEEFA,0x60),(0x5164,2)):
 mem.write16(ds+off,val)
stubs={0x3FB27,0x1CD38,0x403F5,0x4C117,0x31B48,0x3FFD2,0x104F6}
for c,actual in zip(cases,port):
 for i in range(3):
  base=ds+0xD568+i*0xCA
  for off,val in ((8,c['half']),(14,16 if i==0 else 200),(16,44 if i==0 else 300),(0x18,1),(0x0C,0),(0x28,0),(0xA0,i),(0xA2,100),(0xA4,0)):mem.write16(base+off,val)
  for off,val in ((0xCE58,int(i==0)),(0xCE80,8 if i==0 else 0),(0xCE6C,0)):mem.write16(ds+off+i*2,val)
 mem.write16(ds+0x5114,c['impact'])
 cpu.segs[:]=[0,0x1A05,0x5F4A,0x4FC8];cpu.ip=0x48C;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 for _ in range(100):
  reason,count=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,*[a-0x6100 for a in stubs]})
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c,reason,hex(addr))
  if addr==0x710:break
  sp=stack+cpu.regs[4]
  if addr==0x700:
   x,y=mem.read16(sp+4),mem.read16(sp+6);assert y==45
   cpu.regs[0]=c['row'][x-16+c['half']]
  elif addr+0x6100 in (0x31B48,0x3FFD2):
   target=mem.read16(sp+4)+16*mem.read16(sp+6);amount=mem.read16(sp+8)
   value=signed_energy(mem,target)-amount
   mem.write16(target+0xA2,value&65535);mem.write16(target+0xA4,(value>>16)&65535)
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native falling pass did not return')
 base=ds+0xD568
 expected=dict(x=mem.read16(base+14),y=mem.read16(base+16),damage=mem.read16(ds+0xCE80),energy=[signed_energy(mem,base+i*0xCA) for i in range(3)])
 assert actual==expected,(c,actual,expected)
print(f'{len(cases)} native contact/landing/damage-dispatch cases match across tank widths, mixed terrain, competing victims and impact modes.')
