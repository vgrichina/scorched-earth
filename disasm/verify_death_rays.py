#!/usr/bin/env python3
"""Native effect-5 growth: actual trig, aspect transform, line walk and clipping.
Random values and VGA writes are intercepted. Damage/cleanup are not covered.
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
cases=[dict(mode=m,x=x,y=y,wrap=w,seed=seed,radius=radius)
       for m,x,y,w,seed,radius in [(0,100,120,0,7,45),(4,180,240,0,31,104),
       (4,3,42,0,9,70),(4,3,42,1,9,70),(4,356,475,0,17,65),
       (4,356,475,1,17,65),(8,500,380,0,19,46),(2,160,190,0,29,103)]]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {createDeathRays,stepDeathRays} from './web/js/death-rays.js';
import {palette6} from './web/js/palette.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 const mode=GRAPHICS_MODES[c.mode];Object.assign(config,{graphicsMode:c.mode,screenWidth:mode.w,screenHeight:mode.h});
 let seed=c.seed;const bounds=[],frames=[];let writes=[];
 const roll=b=>{bounds.push(b);seed=(Math.imul(seed,1664525)+1013904223)>>>0;return b===60?c.radius-45:(seed>>>16)%b;};
 const rays=createDeathRays(c.x,c.y,roll);
 while(stepDeathRays(rays,{roll,wrap:!!c.wrap,writePixel:(x,y,color)=>writes.push([x,y,color])})){
  frames.push(writes);writes=[];
 }
 return {frames,bounds,aspect:mode.displayAspect,w:mode.w,h:mode.h,rgb:[...palette6.slice(750,753)]};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0;a=port['aspect']
 for off,v in [(0x519A,65535),(0xEF34,int(a*65536) if a<1 else 0),
   (0xEF36,int(65536/a) if a>1 else 0),(0xEF42,3),(0xEF3C,port['w']-4),
   (0xEF40,38),(0xEF38,port['h']-4),(0xEF46,0),(0x510E,case['wrap']),
   (0xEEF4,0x200),(0xEEF6,0x60)]:mem.write16(ds+off,v)
 cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip=0x1E0F3-0x6100-0x17AB0
 cpu.regs[4]=0x2400
 for off,v in [(0,0x110),(2,0x60),(4,case['x']),(6,case['y'])]:mem.write16(stack+0x2400+off,v)
 frames=[];writes=[];bounds=[];seed=case['seed']
 for _ in range(200000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x800,0x32E1B-0x6100,0x1E222-0x6100,0x1E236-0x6100})
  addr=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(case,reason,hex(addr))
  if addr==0x1E236:break
  if addr==0x1E222:
   assert writes==port['frames'][len(frames)],(case,len(frames),'pixel write sequence differs',writes[:8],port['frames'][len(frames)][:8])
   frames.append(writes);writes=[];cpu.ip+=5;continue
  sp=stack+cpu.regs[4]
  if addr==0x32E1B:
   b=mem.read16(sp+4);bounds.append(b);seed=(seed*1664525+1013904223)&0xffffffff
   cpu.regs[0]=case['radius']-45 if b==60 else (seed>>16)%b
  else:
   signed=lambda n:n if n<32768 else n-65536
   writes.append([signed(mem.read16(sp+o)) for o in (4,6,8)])
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('rays did not finish')
 assert len(frames)==len(port['frames'])
 assert bounds==port['bounds'],(case,'random bounds/order differs')
 assert list(ports.palette[250])==port['rgb']
 print(f"{case}: {len(frames)} growth frames and {len(bounds)} random calls match.",flush=True)
print(f'{len(cases)} native radial-ray growth cases match ordered pixel writes, random calls and palette.')
