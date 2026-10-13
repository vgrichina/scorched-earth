#!/usr/bin/env python3
"""Compare stateful head erasure with EXE, using a synthetic sky restoration callback.

Use --layer to test the production drawing layer across full-world repaints.
"""
import argparse
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--layer',action='store_true',help='Test production persistent layer across world repaints')
args=parser.parse_args()
root = Path(__file__).resolve().parent.parent
path = [(20,50),(20,50),(21,50),(22,51),(20,50),(3,38),(2,37),(20,50)]
cases = [dict(icon=icon, trace=trace, color=color)
         for icon in (0,1,2) for trace in (None,110,119) for color in (80,109,120)]
actual = json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer,setPixel} from './web/js/framebuffer.js';
import {transitionProjectileHead,ProjectileDrawingLayer} from './web/js/projectile-render.js';
Object.assign(config,{screenWidth:40,screenHeight:64});reinitFramebuffer();
const path=[[20,50],[20,50],[21,50],[22,51],[20,50],[3,38],[2,37],[20,50]];
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 pixels.fill(c.color);
 const state={icon:c.icon,traceColor:c.trace}, frames=[];
 const layer=process.argv[2]==='1'?new ProjectileDrawingLayer(()=>80):null;
 const projectile={traceColor:c.trace};config.bombIcon=c.icon;
 for(const [x,y] of path){
  if(layer){pixels.fill(c.color);Object.assign(projectile,{x,y});layer.advance(projectile);layer.draw();}
  else transitionProjectileHead(state,x,y,(px,py)=>setPixel(px,py,80));
  frames.push([...pixels]);
 }
 if(layer){pixels.fill(c.color);layer.finish(projectile);layer.draw();}
 else transitionProjectileHead(state,0,0,(px,py)=>setPixel(px,py,80),true);
 frames.push([...pixels]);
 if(layer){
  const final=[...pixels];pixels.fill(c.color);layer.draw();
  if(JSON.stringify(final)!==JSON.stringify([...pixels]))throw new Error('trace lost after removal');
  layer.clear();pixels.fill(c.color);layer.draw();
  if(pixels.some(v=>v!==c.color)||layer.states.size)throw new Error('round reset retained drawing');
 }
 return frames;
})));
''',json.dumps(cases),str(int(args.layer))],cwd=root,text=True))
def native(c):
    if 80<=c<110:return c+40
    if c==120:return 80
    if c==127:return 87
    if 128<=c<=143:return c-40
    return c
for case, port in zip(cases,actual):
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    load_exe(root/'earth/SCORCH.EXE',mem)
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    ds,stack=0x4FC80,0x5F4A0
    for off,value in ((0x519A,65535),(0xEF42,3),(0xEF3C,36),(0xEF40,38),(0xEF38,60),
                      (0x514E,int(case['icon']==2)),(0xCEB8,0),(0xCEBA,0x9000),
                      (0xEEF4,0x100),(0xEEF6,0x60),(0xEEF8,0x120),(0xEEFA,0x60),
                      (0xE34A,65500),(0xE412,65500)):
        mem.write16(ds+off,value)
    mem.write16(0x90048,0)
    mem.write16(ds+0xE4EC,case['trace'] if case['trace'] is not None else 120)
    frame=[native(case['color'])]*2560
    old=None
    for step,(x,y) in enumerate(path+[(0,0)]):
        erase=int(step==len(path))
        if erase or old!=(x,y):
            cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
            cpu.ip=(0x22A14 if case['icon']==1 else 0x228DB)-0x6100-0x1ADA0
            cpu.regs[4]=0x2400
            for off,value in ((0,0x110),(2,0x60),(4,x),(6,y),(8,erase)):
                mem.write16(stack+0x2400+off,value)
            for _ in range(100):
                reason,_=run_fast(cpu,mem,ports,handler,100000,
                                  bp_set={0x700,0x710,0x720,0x3AB39-0x6100})
                assert reason=='breakpoint',(case,reason)
                address=cpu.segs[1]*16+cpu.ip
                if address==0x710:break
                sp=cpu.regs[4]
                px,py=(mem.read16(stack+sp+off) for off in (4,6))
                assert 0<=px<40 and 0<=py<64,(case,px,py)
                if address==0x720:cpu.ax=frame[py*40+px]
                elif address==0x700:frame[py*40+px]=mem.read16(stack+sp+8)
                else:frame[py*40+px]=120
                cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
            else:raise AssertionError('draw routine did not finish')
            if not erase:
                mem.write16(ds+0xE34A,x);mem.write16(ds+0xE412,y);old=(x,y)
        assert list(map(native,port[step]))==frame,(case,step)
print(f'{len(cases)*(len(path)+1)} stateful frames (persistent layer={args.layer}) match EXE, including final erasure and retraced paths.')
