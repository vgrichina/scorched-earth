#!/usr/bin/env python3
"""Compare shield activation masks then lower-half recoloring with native code.

Runs real 0x404C9 shape dispatch, 0x4336F circle walker, 0x38649 drawing
callback and 0x389DA recoloring. Only pixel I/O and palette upload are stubbed.
Does not model activation timing, occlusion history, or tank exclusion rectangles.
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
W,H=80,120
cases=[dict(mode=m,wall=w,kind=k,x=x,y=y,bg=bg,color=(k+3)%10)
       for m in (0,4,7) for w in (0,1) for k in range(1,6)
       for x,y in ((40,76),(3,76),(76,76),(40,38),(40,116))
       for bg in (120,80,0,110,-1)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {drawShield,SHIELD_CONFIG} from './web/js/shields.js';
import {palette6} from './web/js/palette.js';
Object.assign(config,{screenWidth:80,screenHeight:120});reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 Object.assign(config,{graphicsMode:c.mode,wallType:c.wall});
 const native=[];
 for(let i=0;i<pixels.length;i++){
  const n=c.bg<0?([80,104,120,149,0,110][i%6]):c.bg;native.push(n);
  pixels[i]=n===80?120:n===104?144:n>=120&&n<=149?n-40:n;
 }
 drawShield({index:2,colorIndex:c.color,x:c.x,y:c.y,activeShield:c.kind,shieldEnergy:SHIELD_CONFIG[c.kind].energy});
 const changed=[];
 for(let i=0;i<pixels.length;i++)if(pixels[i]===c.color*8+5||pixels[i]===202)changed.push([i,pixels[i]]);
 return {aspect:GRAPHICS_MODES[c.mode].displayAspect,changed,palette:[...palette6.slice(606,609)]};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack,player=0x4FC80,0x5F4A0,0x90000
 a=port['aspect'];cfg=0x616C+c['kind']*16
 for off,v in ((0x519A,65535),(0xEF42,3),(0xEF3C,W-4),(0xEF40,38),(0xEF38,H-4),
  (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),
  (0x510E,c['wall']),(0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60),
  (0xEC7C,0),(0xEC7E,0),(0xEC80,c['color']*8+5)):
  mem.write16(ds+off,v)
 for off,v in ((0xE,c['x']),(0x10,c['y']),(0x1A,c['color']*8),(0xA0,2),
               (0x96,mem.read16(ds+cfg+2)),(0xC6,cfg),(0xC8,0x4FC8)):
  mem.write16(player+off,v)
 pixels=[c['bg'] if c['bg']>=0 else (80,104,120,149,0,110)[i%6] for i in range(W*H)]
 rgb=[]
 def call(seg,ip,args):
  cpu.segs[:]=[0,seg,0x5F4A,0x4FC8];cpu.ip=ip;cpu.regs[4]=0x2400
  for i,v in enumerate((0x110,0x60,*args)):mem.write16(stack+0x2400+2*i,v)
  for _ in range(4000):
   reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x720,0x4C0B5-0x6100})
   addr=cpu.segs[1]*16+cpu.ip
   assert reason=='breakpoint',(c,reason,hex(addr))
   if addr==0x710:return
   sp=cpu.regs[4]
   values=[mem.read16(stack+sp+4+2*i) for i in range(4)]
   if addr in (0x700,0x720):
    x,y=values[:2];assert 0<=x<W and 0<=y<H,(c,x,y)
    if addr==0x700:cpu.regs[0]=pixels[y*W+x]
    else:pixels[y*W+x]=values[2]
   else:rgb.append(values)
   cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
  raise AssertionError('native shield drawing did not finish')
 call(0x39A2,0x9A9,[0,0x9000,0x339,0x3221])
 call(0x3221,0x6CA,[0,0x9000])
 expected=[[i,v] for i,v in enumerate(pixels) if v in (c['color']*8+5,202)]
 assert expected==port['changed'],(c,len(expected),len(port['changed']),expected[:10],port['changed'][:10])
 assert rgb==[[202,*port['palette']]],(c,rgb,port['palette'])
print(f'{len(cases)} shield masks and lower-half palettes match native shape dispatch, drawing and recoloring.')
