#!/usr/bin/env python3
"""Compare filled explosion masks with native 0x43690 + aspect/clipping helpers.

No wrap or protected-color interval. Native pixel reads/writes are synthetic.
Mode aspect factors are shared inputs, not verification of mode setup.
"""
import json, subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(mode=m,x=x,y=y,r=r) for m in range(9)
       for x,y in ((180,240),(3,38),(356,476),(0,40),(360,480)) for r in (0,1,5,10)]
cases += [dict(mode=m,x=180,y=240,r=r) for m in range(9) for r in (20,40,70)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {bresenhamCircleFill} from './web/js/explosions.js';
Object.assign(config,{screenWidth:360,screenHeight:480,wallType:0});reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.graphicsMode=c.mode;pixels.fill(0);bresenhamCircleFill(c.x,c.y,c.r,178);
 return {aspect:GRAPHICS_MODES[c.mode].displayAspect,mask:[...pixels.keys()].filter(i=>pixels[i]===178)};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,value in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
                   (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),
                   (0x510E,0),(0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60)):
  mem.write16(ds+off,value)
 cpu.segs[:]=[0,0x3D00,0x5F4A,0x4FC8];cpu.ip=0x590;cpu.regs[4]=0x2400
 for i,value in enumerate([0x110,0x60,c['x'],c['y'],c['r'],250,249,178]):mem.write16(stack+0x2400+2*i,value)
 mask=set()
 for _ in range(500000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x720})
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=cpu.regs[4]
  if addr==0x700:cpu.ax=0
  else:
   x,y,color=(mem.read16(stack+sp+off) for off in (4,6,8))
   assert color==178
   mask.add(y*360+x)
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native circle did not finish')
 assert port['mask']==sorted(mask),(c,'port pixels',len(port['mask']),'native pixels',len(mask),'first difference',sorted(set(port['mask'])^mask)[:10])
print(f'{len(cases)} explosion masks match native aspect-scaled, playfield-clipped circles.')
