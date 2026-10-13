#!/usr/bin/env python3
"""Compare the EXE's background-dependent tank color adjustment with the port."""
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
cases=[dict(tankType=t,direction=d,pattern=p,colorIndex=(t+p)%10)
       for t in range(7) for d in (-1,1) for p in range(5)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {TANK_TYPES,updateTankContrast} from './web/js/tank.js';
import {getPlayerColor,setPaletteRgb} from './web/js/palette.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
config.screenWidth=40;config.screenHeight=64;reinitFramebuffer();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 const base=getPlayerColor(c.colorIndex),rgb=[...base];
 const delta=c.pattern===2?11:10;
 rgb[0]+=base[0]+delta<=63?delta:-delta;
 setPaletteRgb(80,...rgb);setPaletteRgb(81,0,0,0);
 for(let y=0;y<64;y++)for(let x=0;x<40;x++)pixels[y*40+x]=
   c.pattern===0?81:c.pattern===3&&x%2?81:c.pattern===4&&(x+y)%3?81:80;
 for(const [dx,dy] of TANK_TYPES[c.tankType].pixels)
   pixels[(50+dy)*40+20+c.direction*dx]=c.colorIndex*8;
 const p={...c,x:20,y:50,angle:45,barrelXOff:0,barrelYOff:0,barrelEndX:20+c.direction*6,barrelEndY:35};const count=updateTankContrast(p);
 return {count,rgb:p.displayColor,background:rgb,pixels:[...pixels]};
})));
''',json.dumps(cases)],cwd=root,text=True))
for case,port in zip(cases,actual):
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    load_exe(root/'earth/SCORCH.EXE',mem)
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    ds,stack=0x4FC80,0x5F4A0
    # Startup fills these near-data table pointers' segment halves.
    for t in range(7):mem.write16(ds+0x6740+t*18,0x4FC8)
    index=case['colorIndex'];tank=ds+0xD568+index*0xCA
    base=[mem.read16(ds+0x57E2+index*6+i*2) for i in range(3)]
    for off,value in ((0,case['tankType']),(4,0),(6,0),(14,20),(16,50),(18,20+case['direction']*6),(20,35),(0x94,case['direction']),(0xA0,index)):
        mem.write16(tank+off,value&65535)
    for channel,value in enumerate(base):
        # Start alternating cases dimmed to exercise restoration as well.
        mem.write16(tank+0x1C+channel*2,value*8//10 if case['direction']==-1 else value)
    for color,rgb in ((80,port['background']),(81,[0,0,0])):
        for channel,value in enumerate(rgb):mem.write8(ds+0xDD5E+color*3+channel,value)
    for off,value in ((0x519A,65535),(0x5110,1),(0x5182,tank-ds),(0x5184,0x4FC8),(0xEEF8,0x100),(0xEEFA,0x60)):
        mem.write16(ds+off,value)
    cpu.segs[:]=[0,0x2AA6,0x5F4A,0x4FC8];cpu.ip=0x1AD8;cpu.regs[4]=0x2400
    mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
    for _ in range(1000):
        reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x28592-0x6100})
        assert reason=='breakpoint',(case,reason)
        address=cpu.segs[1]*16+cpu.ip
        if address==0x710:break
        sp=cpu.regs[4]
        if address==0x700:
            x=mem.read16(stack+sp+4);y=mem.read16(stack+sp+6)
            assert 0<=x<40 and 0<=y<64,(case,x,y,hex(cpu.segs[3]))
            cpu.ax=port['pixels'][y*40+x]
        # Palette upload is outside this kernel check; inspect stored RGB below.
        cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
    else:raise AssertionError('contrast routine did not finish')
    expected=[mem.read16(tank+0x1C+i*2) for i in range(3)]
    assert port['rgb']==expected,(case,port['rgb'],expected)
    assert port['count']==mem.read16(ds+0x581E),(case,port['count'],mem.read16(ds+0x581E))
print(f'{len(cases)} contrast cases match EXE sample counts and RGB: seven types, both directions, threshold colors and restoration.')
