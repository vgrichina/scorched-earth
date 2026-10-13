#!/usr/bin/env python3
"""Compare actual ground/wall/sky phase ordering against production game setup.

Checks RNG continuation, ground RGB, resolved sky, and every playfield index.
EXE bitmap and row tables are decoded here; per-pixel drawing arithmetic is
also independently covered by verify_terrain_frame.py.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
for sky, wall in ((3, 6), (3, 7), (7, 6), (7, 7)):
    actual = json.loads(subprocess.check_output([
        'node','--input-type=module','-e',
        "import {prepareRoundBackground,game} from './web/js/game.js';"
        "import {getEffectiveWallType} from './web/js/physics.js';"
        "import {config} from './web/js/config.js';"
        "import {seedRandom,random} from './web/js/utils.js';"
        "import {initPalette,palette6,resolvedSkyType} from './web/js/palette.js';"
        "import {initSkyBackground,reinitTerrainBuffers,drawSky} from './web/js/terrain.js';"
        "import {pixels} from './web/js/framebuffer.js';"
        "config.skyType=Number(process.argv[1]);config.wallType=Number(process.argv[2]);reinitTerrainBuffers();seedRandom(42);let results=[];"
        "for(let round=0;round<8;round++){prepareRoundBackground();drawSky();"
        "results.push({wind:game.wind,wall:getEffectiveWallType(),resolved:resolvedSkyType,ground:[...palette6.slice(360,363)],"
        "pixels:Buffer.from(pixels).toString('base64'),next:random(65535)});}"
        "console.log(JSON.stringify(results));",str(sky),str(wall)
    ],cwd=root,text=True))
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    ds=0x4FC80
    cpu.segs[:]=[0,0,0x8000,0x4FC8]
    mem.write16(ds+0x519A,65535)
    mem.write16(ds+0x624C,0)
    mem.write16(ds+0x624E,7)
    mem.write16(ds+0x621A,0)
    def call(offset,segment,arguments=(),stop=0x710):
        cpu.segs[1]=segment;cpu.ip=offset-0x6100-segment*16;cpu.regs[4]=0x2400
        for i,value in enumerate([0x110,0x60,*arguments]):mem.write16(0x82400+i*2,value)
        reason,_=run_fast(cpu,mem,ports,handler,10000000,bp_set={stop})
        assert reason=='breakpoint',(hex(offset),reason)
    def pointer(off):return mem.read16(ds+off)+(mem.read16(ds+off+2)<<4)
    mem.write16(ds+0x5110,sky)
    mem.write16(ds+0x623C,0)
    call(0x32994,0x2C89,[42])
    for round,port in enumerate(actual):
        mem.write16(ds+0x5150,0) # Disable unrelated spoiler setup.
        mem.write16(ds+0x5156,wall)
        mem.write16(ds+0x515C,0)
        mem.write16(ds+0xE1EA,0) # No loaded MTN files, matching this Node fixture.
        call(0x2927E,0x22CA,stop=0x294B1-0x6100)
        assert mem.read16(ds+0x515A)==port['wind'],(sky,wall,round,'wind')
        assert mem.read16(ds+0x5154)==port['wall'],(sky,wall,round,'resolved wall')
        call(0x3971F,0x3352)
        resolved=mem.read16(ds+0x5110)
        assert resolved==port['resolved'],(sky,round,'resolved')
        ground=[mem.read16(ds+o) for o in (0xDD4C,0xDD4E,0xDD50)]
        assert port['ground']==ground,(sky,round,'ground')
        call(0x32E1B,0x2C89,[65535])
        assert cpu.ax==port['next'],(sky,round,'RNG',cpu.ax,port['next'])
        pixels=base64.b64decode(port['pixels'])
        rows,aux,bitmap=pointer(0x6242),pointer(0x623E),pointer(0x6246)
        for x in range(3,357):
            col=mem.read16(bitmap+x*4)+(mem.read16(bitmap+x*4+2)<<4)
            for y in range(38,477):
                bit=bool(mem.read8(col+y//8)&(1<<(y%8)))
                color=80 if resolved==0 else mem.read16(rows+y*2)-40
                if resolved==2:
                    product=(mem.read16(aux+y*2)*x)&65535
                    if product>=32768:product-=65536
                    color=80+max(0,abs(product)%30-mem.read16(rows+y*2)) if bit else 80
                elif resolved==3 and bit:
                    shade=min(20,(y-38)//3)
                    color=150 if shade==20 else 90+shade
                elif resolved==4 and bit:color=80
                assert pixels[y*360+x]==color,(sky,round,resolved,x,y,pixels[y*360+x],color)
        print(f'Wall {wall}, sky setting {sky}, round {round+1}, resolved {resolved}: pixels, ground and RNG match EXE.',flush=True)
