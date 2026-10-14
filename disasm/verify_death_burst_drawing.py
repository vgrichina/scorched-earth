#!/usr/bin/env python3
"""Native death-burst concentric drawing over protected colors, including wrap.
Actual burst, circle and aspect code executes; pixel I/O and dirty marking are stubbed.
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
cases=[dict(mode=m,x=x,y=y,r=r,wrap=w) for m in (0,4) for x,y,r,w in ((180,240,30,0),(3,38,20,0),(3,38,20,1),(356,476,6,1))]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {pixels,reinitFramebuffer,setPixel} from './web/js/framebuffer.js';
import {drawDeathBurst} from './web/js/death-bursts.js';
Object.assign(config,{screenWidth:360,screenHeight:480,wallType:0});reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.graphicsMode=c.mode;
 const colors=[0,105,170,200,210,219,220,239,240,241,255];
 for(let y=0;y<480;y++)for(let x=0;x<360;x++)pixels[y*360+x]=colors[(x+y*7)%11];
 let writes=0;const bounds=drawDeathBurst({x:c.x,y:c.y,radius:c.r},{wrap:!!c.wrap,writePixel:(x,y,color)=>{writes++;setPixel(x,y,color);}});
 return {aspect:GRAPHICS_MODES[c.mode].displayAspect,bounds,writes,changed:[...pixels.keys()].filter(i=>pixels[i]!==colors[(i%360+Math.floor(i/360)*7)%11]).map(i=>[i,pixels[i]])};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,value in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
                   (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),
                   (0x510E,c['wrap']),(0xEF46,0),(0xECC0,c['x']),(0xECC4,c['x']),(0xECC2,c['y']),(0xECC6,c['y']),(0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60)):
  mem.write16(ds+off,value)
 cpu.segs[:]=[0,0x34E1,0x5F4A,0x4FC8];cpu.ip=0xF;cpu.regs[4]=0x2400
 for i,value in enumerate([0x110,0x60,c['x'],c['y'],c['r']]):mem.write16(stack+0x2400+2*i,value)
 colors=[0,105,170,200,210,219,220,239,240,241,255]
 painted={};writes=0
 for _ in range(500000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x720,0x1CD38-0x6100})
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=cpu.regs[4]
  x,y=(mem.read16(stack+sp+off) for off in (4,6))
  if addr==0x700:cpu.ax=painted.get(y*360+x,colors[(x+y*7)%11])
  elif addr==0x720:
   painted[y*360+x]=mem.read16(stack+sp+8);writes+=1
  cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native circle did not finish')
 expected=sorted([i,color] for i,color in painted.items() if color!=colors[(i%360+(i//360)*7)%11])
 assert port['changed']==expected,(c,'pixel differences')
 assert port['writes']==writes,(c,port['writes'],writes)
 signed=lambda v:v if v<32768 else v-65536
 bounds={k:signed(mem.read16(ds+o)) for k,o in [('left',0xECC0),('right',0xECC4),('top',0xECC2),('bottom',0xECC6)]}
 assert port['bounds']==bounds,(c,port['bounds'],bounds)
print(f'{len(cases)} native concentric bursts match indexed pixels, write counts and bounds over protected colors and viewport edges.')
