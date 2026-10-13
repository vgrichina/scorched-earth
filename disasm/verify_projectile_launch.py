#!/usr/bin/env python3
"""Compare production launch velocity with EXE trig, truncation and aspect scaling."""
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
cases=[dict(mode=m,angle=a,power=p) for m in range(9)
       for a in (0,1,27,45,76,89,90,91,104,135,153,179,180)
       for p in (0,1,200,500,1000)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config,GRAPHICS_MODES} from './web/js/config.js';
import {launchProjectile,clearProjectiles,projectiles} from './web/js/physics.js';
import {palette6,setPaletteRgb} from './web/js/palette.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 setPaletteRgb(255,10,20,30);
 config.graphicsMode=c.mode;clearProjectiles();launchProjectile(100,200,c.angle,c.power,2,0);
 return {vx:projectiles[0].vx,vy:projectiles[0].vy,aspect:GRAPHICS_MODES[c.mode].displayAspect,rgb:[...palette6.slice(765,768)]};
})));
''',json.dumps(cases)],cwd=root,text=True))
mem=Memory();load_exe(root/'earth/SCORCH.EXE',mem)
ds,stack=0x4FC80,0x5F4A0
mem.write16(ds+0x519A,65535)
for case,port in zip(cases,actual):
    cpu,ports=CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8];cpu.regs[5]=0x2400;cpu.regs[4]=0x23E6
    mem.write16(stack+0x240A,case['power']);mem.write16(stack+0x240C,case['angle'])
    a=port['aspect']
    mem.write16(ds+0xEF34,int(a*65536) if a<1 else 0)
    mem.write16(ds+0xEF36,int(65536/a) if a>1 else 0)
    def run(start,stop):
        cpu.ip=start-0x6100-(cpu.segs[1]<<4)
        reason,count=run_fast(cpu,mem,ports,handler,100000,bp_set={stop-0x6100})
        assert reason=='breakpoint',(case,reason,count)
    run(0x211A3,0x211B8) # Actual degree-to-radian multiplication.
    run(0x21296,0x212A7) # Actual palette upload through fg_setrgb and VGA ports.
    assert port['rgb']==list(ports.palette[255]),(case,port['rgb'],ports.palette[255])
    run(0x212BF,0x21325) # Actual trig, integer conversion and aspect transform.
    signed=lambda n:n if n<32768 else n-65536
    expected=[signed(mem.read16(stack+0x23F2)),signed(mem.read16(stack+0x23F0))]
    assert [port['vx'],port['vy']]==expected,(case,port,expected)
print(f'{len(cases)} launch vectors and shot-time RGB match EXE across nine modes, 13 angles and five powers.')
