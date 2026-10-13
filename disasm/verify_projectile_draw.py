#!/usr/bin/env python3
"""Compare bomb-head pixels with actual EXE routines; old head is offscreen.

Framebuffer callbacks substitute indexed reads/writes. Erasure and path history
are outside this test. Inputs cover clipping and relocated palette ranges.
"""
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root = Path(__file__).resolve().parent.parent
cases = [dict(icon=icon,x=x,y=y,color=color)
         for icon in (0,1,2) for x,y in ((20,50),(2,50),(3,38),(36,60),(37,50),(20,37),(20,61))
         for color in (0,79,80,109,119,120,127,128,143,144,170,255)]
actual = json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {drawProjectileHead} from './web/js/projectile-render.js';
Object.assign(config,{screenWidth:40,screenHeight:64});reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 pixels.fill(c.color);drawProjectileHead(c.x,c.y,c.icon);return [...pixels];
})));
''',json.dumps(cases)],cwd=root,text=True))
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
    cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
    cpu.ip=(0x22A14 if case['icon']==1 else 0x228DB)-0x6100-0x1ADA0
    cpu.regs[4]=0x2400
    for off,value in ((0,0x110),(2,0x60),(4,case['x']),(6,case['y']),(8,0)):
        mem.write16(stack+0x2400+off,value)
    frame=[native(case['color'])]*2560
    for _ in range(100):
        reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x720})
        assert reason=='breakpoint',(case,reason)
        address=cpu.segs[1]*16+cpu.ip
        if address==0x710:break
        sp=cpu.regs[4]
        x,y=(mem.read16(stack+sp+off) for off in (4,6))
        assert 0<=x<40 and 0<=y<64,(case,x,y)
        if address==0x720:cpu.ax=frame[y*40+x]
        else:frame[y*40+x]=mem.read16(stack+sp+8)
        cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
    else:raise AssertionError('draw routine did not finish')
    assert list(map(native,port))==frame,case
print(f'{len(cases)} bomb-head frames match EXE: sizes, invisibility, clipping and palette boundaries.')
