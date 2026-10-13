#!/usr/bin/env python3
"""Compare consecutive tracking-mark frames with EXE 0x22DFA.

The head callback is stubbed: this tests border drawing, old-mark erasure,
coordinate clipping and same-pixel suppression independently of the head.
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

root=Path(__file__).resolve().parent.parent
path=[(20,50),(20,50),(21,50),(21,51),(2,37),(-10,20),
      (36,60),(37,61),(50,62),(20,50)]
cases=[dict(icon=icon,path=path if direction==1 else list(reversed(path)))
       for icon in (0,1,2) for direction in (1,-1)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {drawProjectileTrackingMarks} from './web/js/projectile-render.js';
Object.assign(config,{screenWidth:40,screenHeight:64});reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>c.path.map(([x,y])=>{
 pixels.fill(160);drawProjectileTrackingMarks(x,y,c.icon);return [...pixels];
}))));
''',json.dumps(cases)],cwd=root,text=True))
for case,frames in zip(cases,actual):
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    load_exe(root/'earth/SCORCH.EXE',mem)
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    ds,stack=0x4FC80,0x5F4A0
    for off,value in ((0x519A,65535),(0xEF42,3),(0xEF3C,36),(0xEF3E,39),
                      (0xEF40,38),(0xEF38,60),(0xEF26,155),(0xEF2C,160),
                      (0x514E,int(case['icon']==2)),(0xE4DA,0),(0xE34A,0),(0xE412,0),
                      (0xEEF4,0x100),(0xEEF6,0x60),(0x1C8A,0x130),(0x1C8C,0x60)):
        mem.write16(ds+off,value)
    frame=[160]*2560
    old=(0,0)
    for (x,y),port in zip(case['path'],frames):
        cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8]
        cpu.ip=0x22DFA-0x6100-0x1ADA0;cpu.regs[4]=0x2400
        for off,value in ((0,0x110),(2,0x60),(4,x),(6,y)):
            mem.write16(stack+0x2400+off,value&65535)
        draws=0
        for _ in range(100):
            reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x730})
            assert reason=='breakpoint',(case,reason)
            address=cpu.segs[1]*16+cpu.ip
            if address==0x710:break
            sp=cpu.regs[4]
            if address==0x700:
                px,py,color=(mem.read16(stack+sp+off) for off in (4,6,8))
                if 0<=px<40 and 0<=py<64:frame[py*40+px]=color
            else:draws+=1
            cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
        else:raise AssertionError('tracking routine did not finish')
        assert draws==int((x,y)!=old),(case,x,y,draws)
        assert port==frame,(case,x,y)
        old=(x,y)
print(f'{len(cases)*len(path)} consecutive tracking frames match EXE, including old-mark erasure and clipping.')
