#!/usr/bin/env python3
"""Native 0x20CE7 dirt settling vs production JS: every pass and deposit count.

Synthetic indexed pixels include stacked overhangs, tank blockers and Castle
ceilings. Pixel I/O, ground deposits, sky restore and palette/input are stubbed;
all native column discovery, movement and queue ordering execute.
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
W,H=32,64
cases=[]
for castle in (False,True):
 for shape in ('flat','overhang','stacked','blocker','boundary'):
  pixels=[120]*(W*H)
  for x in range(W):
   for y in range(38,H):
    if y>=56+x%3 or (shape!='flat' and 10<=x<=20 and 42<=y<=44):pixels[y*W+x]=80
    if shape=='stacked' and 12<=x<=18 and 48<=y<=50:pixels[y*W+x]=80
    if shape=='blocker' and 14<=x<=16 and y==50:pixels[y*W+x]=8
    if shape=='boundary' and x==14 and y==49:pixels[y*W+x]=105
    if castle and y<=40:pixels[y*W+x]=80
    if y>H-4:pixels[y*W+x]=155
  cases.append(dict(castle=castle,shape=shape,pixels=pixels))
cases += [dict(c,shape=c['shape']+'-shaded',
               pixels=[81+i%5 if p==80 else p for i,p in enumerate(c['pixels'])])
          for c in list(cases)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer,setBackground} from './web/js/framebuffer.js';
import {terrainBitmap,reinitTerrainBuffers} from './web/js/terrain.js';
import {clearTerrainCollapse,markTerrainCollapse,stepTerrainCollapse} from './web/js/terrain-collapse.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
let input='';for await(const c of process.stdin)input+=c;
Object.assign(config,{screenWidth:32,screenHeight:64,suspendDirt:0});
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 reinitFramebuffer();reinitTerrainBuffers();setBackground(new Uint8Array(64).fill(80));seedRandom(0);
 config.landType=c.castle?5:2;clearTerrainCollapse();
 pixels.set(c.pixels.map(p=>p>=80&&p<=104?p+40:p===120?80:p===105?145:p));
 for(let i=0;i<pixels.length;i++)terrainBitmap[i]=c.pixels[i]>=80&&c.pixels[i]<=104?pixels[i]:0;
 markTerrainCollapse(10,20);const frames=[];
 for(let pass=0;pass<200;pass++){
  if(!stepTerrainCollapse())break;
  frames.push([...pixels].map(p=>p>=120&&p<=144?p-40:p===80?120:p===145?105:p));
 }
 return {frames,index:getRandomState().index};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for c,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem)
 handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds=0x4FC80;stack=0x5F4A0
 for off,val in ((0x519A,65535),(0xEF40,38),(0xEF38,H-4),(0xEF42,3),(0xEF3C,W-4),
                 (0x5174,10),(0x5176,20),(0x50D8,int(c['castle'])),(0xCE18,0),(0xCE1A,0x8000),
                 (0xEEF8,0x100),(0xEEFA,0x60)):
  mem.write16(ds+off,val)
 for i,seg in enumerate((0x8100,0x8200,0x8300)):
  mem.write16(0x80000+i*4,0);mem.write16(0x80002+i*4,seg)
 cpu.segs[:]=[0,0x1AAE,0x5F4A,0x4FC8];cpu.ip=0x107;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 expected=c['pixels'].copy();frames=[];deposits=0
 stops={0x700,0x710,*[o-0x6100 for o in (0x20EA2,0x3AB39,0x299C0,0x1CF5F,0x28A80)]}
 for _ in range(20000):
  reason,count=run_fast(cpu,mem,ports,handler,100000,bp_set=stops)
  addr=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(c['shape'],reason,hex(addr))
  if addr==0x710:break
  if addr==0x20EA2-0x6100:
   frames.append(expected.copy())
   run_fast(cpu,mem,ports,handler,1)
   continue
  sp=stack+cpu.regs[4]
  if addr in (0x700,0x3AB39-0x6100,0x299C0-0x6100):
   x,y=mem.read16(sp+4),mem.read16(sp+6)
   assert 0<=x<W and 0<=y<H,(c['shape'],x,y)
   if addr==0x700:cpu.regs[0]=expected[y*W+x]
   elif addr==0x3AB39-0x6100:expected[y*W+x]=120
   else:expected[y*W+x]=80;deposits+=1
  elif addr==0x28A80-0x6100:cpu.regs[0]=0x80
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('collapse did not finish')
 assert len(frames)==len(port['frames']),(c['shape'],c['castle'],len(frames),len(port['frames']))
 for i,(a,b) in enumerate(zip(frames,port['frames'])):
  differences=[(j%W,j//W,x,y) for j,(x,y) in enumerate(zip(a,b)) if x!=y]
  assert not differences,(c['shape'],c['castle'],i,differences[:10])
 assert port['index']==deposits%250,(c['shape'],port['index'],deposits)
print(f'{len(cases)} dirt-collapse cases match every native pass and ground-deposit RNG count.')
