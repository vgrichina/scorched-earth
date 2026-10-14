#!/usr/bin/env python3
"""Native 0x2476B growth: real circle rasterizer and sound-choice RNG.
Pixel callbacks, dirty marking, sound output and damage iteration are stubbed.
Compare every ordered write and final RNG; damage is outside this check.
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
cases=[dict(mode=m,x=x,y=y,r=r,base=b,wrap=w,sound=s) for m in (0,4)
 for x,y,r,b,w,s in [(180,240,20,170,0,0),(3,38,12,182,1,1),(356,476,6,218,0,1)]]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {pixels,reinitFramebuffer,setPixel} from './web/js/framebuffer.js';
import {drawFunkyBlast} from './web/js/death-funky.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
Object.assign(config,{screenWidth:360,screenHeight:480});reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 config.graphicsMode=c.mode;seedRandom(17);const initial=getRandomState();
 const colors=[0,80,105,c.base,c.base+1,c.base+6,c.base+7,c.base+8,c.base+9,254,255];
 for(let y=0;y<480;y++)for(let x=0;x<360;x++)pixels[y*360+x]=colors[(x+y*7)%11];
 const writes=[];
 const frames=[...drawFunkyBlast(c.x,c.y,c.r,c.base,{wrap:!!c.wrap,sound:!!c.sound,
  writePixel:(x,y,color)=>{writes.push([x,y,color]);setPixel(x,y,color);}})];
 return {writes,initial,final:getRandomState(),aspect:GRAPHICS_MODES[c.mode].displayAspect};
})));
''',json.dumps(cases)],cwd=root,text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,v in [(0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
  (0xEF34,int(a*65536) if a<1 else 0),(0xEF36,int(65536/a) if a>1 else 0),
  (0x510E,c['wrap']),(0xEF46,c['sound']),(0xEC06,port['initial']['index']),
  (0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60)]:mem.write16(ds+off,v)
 for i,word in enumerate(port['initial']['words']):mem.write16(ds+0xEA12+i*2,word)
 cpu.segs[:]=[0,0x1E5E,0x5F4A,0x4FC8];cpu.ip=0x8B;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,c['x'],c['y'],c['base'],c['r']]):mem.write16(stack+0x2400+i*2,v)
 colors=[0,80,105,c['base'],c['base']+1,c['base']+6,c['base']+7,c['base']+8,c['base']+9,254,255]
 writes=[];painted={}
 hooks={0x700,0x710,0x720}|{a-0x6100 for a in (0x1CD38,0x32166,0x10C81,0x4C278)}
 for _ in range(300000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set=hooks)
  assert reason=='breakpoint',(c,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=stack+cpu.regs[4];args=[mem.read16(sp+o) for o in (4,6,8)]
  x,y=args[:2]
  if addr==0x700:cpu.ax=painted.get((x,y),colors[(x+y*7)%11])
  elif addr==0x720:writes.append(args);painted[x,y]=args[2]
  elif addr==0x32166-0x6100:cpu.ax=0
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native growth did not finish')
 if writes!=port['writes']:
  for i,(native,js) in enumerate(zip(writes,port['writes'])):assert native==js,(c,i,native,js)
  raise AssertionError((c,len(writes),len(port['writes'])))
 final=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert final==port['final'],(c,'RNG differs')
print(f'{len(cases)} native Funky Bomb growth cases match ordered writes, protected colors, aspect/wrap and complete RNG.')
