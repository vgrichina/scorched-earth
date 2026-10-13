#!/usr/bin/env python3
"""Native large-blast palette phases, including actual VGA palette uploads.

Delay, sound and input servicing are skipped; no wall-clock timing claim.
Port checks retained blast pixels across clean-world repaint during cycling.
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
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {palette6} from './web/js/palette.js';
import {startExplosion,stepExplosion,isExplosionActive} from './web/js/explosions.js';
Object.assign(config,{screenWidth:80,screenHeight:120,graphicsMode:4,wallType:0});reinitFramebuffer();
console.log(JSON.stringify([31,40,70].map(radius=>{
 pixels.fill(80);startExplosion(40,76,radius,0);
 for(let i=0;i<Math.ceil(radius/(radius<40?1:2));i++){pixels.fill(80);stepExplosion();}
 const mask=Buffer.from(pixels),palettes=[];
 while(isExplosionActive()){
  pixels.fill(80);if(!stepExplosion())break;
  if(!mask.equals(Buffer.from(pixels)))throw new Error('cycle lost blast pixels');
  palettes.push([...palette6.slice(600,720)]);
 }
 return {radius,palettes};
})));
'''],cwd=root,text=True))
for port in actual:
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 for off,v in ((0x519A,65535),(0xEF46,0),(0xEF04,0x3B),(0xEF06,0x3E2B),
               (0xEF08,0xA8),(0xEF0A,0x3E2B),(0xEEFC,0xDB),(0xEEFE,0x3E2B)):
  mem.write16(ds+off,v)
 cpu.segs[:]=[0,0x3DAE,0x5F4A,0x4FC8];cpu.regs[4]=0x2400
 cpu.ip=0x43C8E-0x6100-0x3DAE0
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x710})
 assert reason=='breakpoint',(reason,hex(cpu.segs[1]*16+cpu.ip),hex(cpu.segs[1]),hex(cpu.ip))
 cpu.segs[1]=0x3DAE
 cpu.ip=0x43DEF-0x6100-0x3DAE0;cpu.regs[5]=0x2400;cpu.regs[4]=0x23E0
 palettes=[]
 for _ in range(1000):
  reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x43E2E-0x6100,0x43E71-0x6100,
                    0x43E8A-0x6100,0x104F6-0x6100,0x28A80-0x6100})
  assert reason=='breakpoint',(reason,hex(cpu.segs[1]*16+cpu.ip),hex(cpu.segs[1]),hex(cpu.ip))
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x43E8A-0x6100:break
  if addr in (0x43E2E-0x6100,0x43E71-0x6100):
   palettes.append([v for rgb in ports.palette[200:240] for v in rgb])
   cpu.regs[4]+=4;cpu.ip+=3;continue
  sp=cpu.regs[4];cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('cycle did not finish')
 assert port['palettes']==palettes,(port['radius'],len(port['palettes']),len(palettes))
 assert len(palettes)==50
print('150 palette phases match native VGA uploads; blast pixels survive world repaint through cycling and final blackening.')
