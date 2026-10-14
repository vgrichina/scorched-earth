#!/usr/bin/env python3
"""Compare the Standard between-round panel's indexed pixels and bounds.

Checkpoint supplies initialized native heap/video only. Both renderers receive
the same names, wins and scores; no native layout or framebuffer feeds the port.
Checks player palette restoration too. --final compares the whole final screen
and ring palette using production UI palette initialization. Excludes dialog
interaction and the gameplay background of between-round rankings.
"""
import argparse
import json
import subprocess
from pathlib import Path
from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.execute import run_fast
from emu.state import load_state

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--final',action='store_true',help='Compare the final screen instead of between-round rankings')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
fixtures=[ [('a',1,5000),('b',0,-1500)], [('Same',0,0),('Tie',0,0)],
 [('Long Player',3,1234567),('Short',2,-99999),('Third',2,100)],
 [(f'Tank {i+1}',i%3,1000*i) for i in range(10)] ]
if args.final:
 fixtures += [[('Human',1,5000,0),('Bot',0,0,t)] for t in range(1,8)]
for completed in ((10,) if args.final else (1,9)):
 for fixture in fixtures:
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    ds,stack=0x4FC80,0x5F4A0
    def call(address,segment,arguments=(),stop=0x710):
        cpu.segs[:]=[0,segment,0x5F4A,0x4FC8]
        cpu.ip=address-0x6100-segment*16;cpu.regs[4]=0x2400
        for i,value in enumerate([0x110,0x60,*arguments]):
            mem.write16(stack+0x2400+i*2,value&65535)
        reason,_=run_fast(cpu,mem,ports,handler,10000000,bp_set={stop})
        assert reason=='breakpoint',(reason,hex(cpu.segs[1]*16+cpu.ip))
    for off,value in ((0x519A,65535),(0x50D4,len(fixture)),(0x50EA,0),
                      (0xE342,completed),(0x5160,10),(0x50F6,0),(0x5188,0),(0x5110,2)):
        mem.write16(ds+off,value)
    players=[]
    for i,entry in enumerate(fixture):
        name,wins,score=entry[:3]
        ai_type=entry[3] if len(entry)>3 else 0
        tank=0xD568+i*0xCA
        rgb=[63-i,10+i,20+i]
        for j,ch in enumerate(name.encode()+b'\0'):mem.write8(0x90000+i*64+j,ch)
        for off,value in ((0xB6,i*64),(0xB8,0x9000),(0xAC,wins),(0xA0,i),
                          (0x1A,i*8),(0x22,ai_type),(0x18,int(i==0))):
            mem.write16(ds+tank+off,value)
        call(0x11B2C,0xB87,[tank+0xBA,0x4FC8,score&65535,(score>>16)&65535])
        for j,value in enumerate(rgb):mem.write16(ds+tank+0x1C+j*2,value)
        players.append(dict(aiType=ai_type,name=name,wins=wins,score=score,colorIndex=i,displayColor=rgb,alive=i==0))
    call(0x33FC3,0x2D54,stop=0x460C3-0x6100)
    width,height=ports.get_resolution()
    port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {drawRankings} from './web/js/rankings.js';
import {drawFinalScoring} from './web/js/final-scoring.js';
import {palette6,initPalette} from './web/js/palette.js';
const c=JSON.parse(process.argv[1]);
Object.assign(config,{screenWidth:c.width,screenHeight:c.height});reinitFramebuffer();
if(c.final)initPalette(2,2);
const layout=c.final?drawFinalScoring(c.players):drawRankings(c.players,c.completed,10);
const result={layout,pixels:Array.from(pixels),palette:Array.from(palette6)};
result.ringPhases=c.final?[3,4].map(phase=>{drawFinalScoring(c.players,{phase});return Array.from(palette6.slice(180*3,220*3));}):[];
result.toggles=c.final&&c.players.some(p=>p.aiType)?[true,false].map(showTypes=>{
  drawFinalScoring(c.players,{phase:4,showTypes,namesRestored:!showTypes});return Array.from(pixels);
}):[];
console.log(JSON.stringify(result));
''',json.dumps(dict(players=players,completed=completed,width=width,height=height,final=args.final))],cwd=root,text=True))
    bp=cpu.segs[2]*16+cpu.regs[5]
    ptr=(mem.read16(bp+6)+16*mem.read16(bp+8)) if args.final else mem.read16(ds+0xEC38)+16*mem.read16(ds+0xEC3A)
    x,y,x2,y2=[mem.read16(ptr+i) for i in (0,2,4,6)]
    layout=port['layout']
    assert [x,y,x2-x,y2-y]==[layout[k] for k in ('x','y','width','height')],(fixture,completed,layout,[x,y,x2,y2])
    start=(ports.crtc_regs[12]<<8)|ports.crtc_regs[13]
    differences=[]
    for py in (range(height) if args.final else range(y,y2+1)):
        for px in (range(width) if args.final else range(x,x2+1)):
            native=(mem.vga_planes[px&3][start+(px>>2)+py*(width//4)] if ports.mode_x
                    else mem.read8(0xA0000+py*width+px))
            actual=port['pixels'][py*width+px]
            different=(list(ports.palette[native])!=port['palette'][actual*3:actual*3+3]) if args.final else native!=actual
            if different:differences.append((px,py,native,actual))
    assert not differences,(fixture,completed,len(differences),differences[:12])
    for py in ([] if args.final else range(mem.read16(ds+0x518E),mem.read16(ds+0x518E)+12)):
        for px in range(mem.read16(ds+0xE9DC),mem.read16(ds+0xE9DE)):
            native=mem.vga_planes[px&3][start+(px>>2)+py*(width//4)] if ports.mode_x else mem.read8(0xA0000+py*width+px)
            assert native==port['pixels'][py*width+px],('winner name',fixture,px,py,native,port['pixels'][py*width+px])
    for i in (range(180,220) if args.final else range(len(players)*8)):
        assert list(ports.palette[i])==port['palette'][i*3:i*3+3],(i,ports.palette[i],port['palette'][i*3:i*3+3])
    for expected in port['ringPhases']:
        run_fast(cpu,mem,ports,handler,1)
        reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x460C3-0x6100})
        assert reason=='breakpoint',('final palette polling',reason)
        assert [channel for rgb in ports.palette[180:220] for channel in rgb]==expected
    for expected in port['toggles']:
        # Execute the native Type/Name action callback on the third button.
        call(0x34A1D,0x2D54,[ptr&15,ptr>>4,1+4*len(players)+2])
        # The event loop redraws the activated button after its callback.
        call(0x474E1,0x3FA9,[ptr&15,ptr>>4,1+4*len(players)+2])
        differences=[]
        for py in range(y,y2+1):
            for px in range(x,x2+1):
                native=(mem.vga_planes[px&3][start+(px>>2)+py*(width//4)] if ports.mode_x
                        else mem.read8(0xA0000+py*width+px))
                actual=expected[py*width+px]
                if list(ports.palette[native])!=port['palette'][actual*3:actual*3+3]:
                    differences.append((px,py,native,actual))
        assert not differences,('Type/Name callback',fixture,len(differences),differences[:12])
    print(f'{len(fixture)} players, {10-completed} rounds left: '+('full final-screen RGB and three ring palette phases match.' if args.final else 'panel, winner name and player palette match.'))
