#!/usr/bin/env python3
"""Compare no-team final-dialog mouse dispatch and panel RGB with gameTick.

Uses a two-player composed rankings checkpoint and companion rankings-port.json.
Adds a Moron opponent to exercise Type. Supplies only native mouse driver
polls; excludes cursor drawing, wall-clock ring timing and the following menu.
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
from emu_dialog_key import deliver_key
from compare_pipeline import extract_display_pixels

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint',type=Path)
parser.add_argument('--teams',action='store_true')
parser.add_argument('--team-page',action='store_true')
args=parser.parse_args()
assert not args.team_page or args.teams
root=Path(__file__).resolve().parent.parent
source=json.loads(args.checkpoint.with_name('rankings-port.json').read_text())
assert len(source['scores'])==2,'Requires a two-player composed checkpoint'
for target,outside in [('quit',False),('quit',True),('new',False),('new',True),
                       ('type',False),('type',True),*([('teams',False),('teams',True)] if args.teams else []),('outside',False),('blank',False)]:
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    ds=0x4FC80
    mem.write16(ds+0xE342,10);mem.write16(ds+0x50F6,0)
    mem.write16(ds+0xD568+0xCA+0x22,1)
    if args.teams:
        mem.write16(ds+0x50EA,1);mem.write16(ds+0x6022,0)
        for i,name in enumerate(['Red','Blue']):
            team=0xE1EC+22*i
            for j,ch in enumerate(name.encode()+b'\0'):mem.write8(0x92000+i*64+j,ch)
            for off,value in ((0,1),(4,source['wins'][i]),(6,i*64),(8,0x9200)):mem.write16(ds+team+off,value)
            mem.write16(ds+0xD568+i*0xCA+0x30,i)
    cpu.segs[:]=[0,0x2D54,0x5F4A,0x4FC8]
    cpu.ip=0x33FC3-0x6100-0x2D540;cpu.regs[4]=0x2400
    mem.write16(0x5F4A0+0x2400,0x110);mem.write16(0x5F4A0+0x2402,0x60)
    reason,_=run_fast(cpu,mem,ports,handler,10000000,bp_set={0x460C3-0x6100})
    assert reason=='breakpoint',reason
    if args.team_page:
        deliver_key(cpu,mem,ports,handler,0x14,116)
        run_fast(cpu,mem,ports,handler,1000000,timer_period=1000,tick_addr=ds+0xEE78,isr_divisor=200)
        deliver_key(cpu,mem,ports,handler,0x94,0)
        reason,_=run_fast(cpu,mem,ports,handler,10000000,bp_set={0x460C3-0x6100},timer_period=1000,tick_addr=ds+0xEE78,isr_divisor=200)
        assert reason=='breakpoint',reason
    bp=cpu.segs[2]*16+cpu.regs[5]
    ptr=mem.read16(bp+6)+16*mem.read16(bp+8)
    x,y,x2,y2=[mem.read16(ptr+i) for i in (0,2,4,6)]
    if target in ('quit','new','type','teams'):
        i=(11 if args.teams else 9)+('quit','new','type','teams').index(target)
        widget=mem.read16(ptr+0x20+4*i)+16*mem.read16(ptr+0x22+4*i)
        bx,by,bx2,by2=[mem.read16(widget+o) for o in (0x48,0x4A,0x4C,0x4E)]
        xy=[x+(bx+bx2)//2,y+(by+by2)//2]
    else:xy=[20,20] if target=='outside' else [x+5,y+25]
    release=[20,20] if outside else xy
    port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {getTeamScore} from './web/js/team-scoring.js';
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {resetFinalScoringInput,drawFinalScoring,finalScoringInput} from './web/js/final-scoring.js';
import {pixels} from './web/js/framebuffer.js';
import {initPalette,palette6} from './web/js/palette.js';
import {mouse} from './web/js/input.js';
const [xy,release,source,teams,teamPage]=JSON.parse(process.argv[1]);
Object.assign(config,{teamMode:teams?1:0,scoringMode:0,rounds:10,numPlayers:2});createPlayers(2);initPalette(2,2);
Object.assign(players[0],{name:'a',wins:source.wins[0],score:source.scores[0],aiType:0});
Object.assign(players[1],{name:'b',wins:source.wins[1],score:source.scores[1],alive:false,aiType:1});
if(teams)['Red','Blue'].forEach((name,i)=>Object.assign(getTeamScore(i),{name,wins:source.wins[i],score:0}));
Object.assign(game,{state:STATE.ROUND_OVER,round:10,currentPlayer:1,roundOverTimer:0});resetFinalScoringInput();if(teamPage){finalScoringInput.showTeams=true;finalScoringInput.redrawn=3;}
const sample=()=>{
  drawFinalScoring(players);
  return {exited:game.state!==STATE.ROUND_OVER,action:game.finalScoringAction,
    pixels:Array.from(pixels),palette:Array.from(palette6)};
};
Object.assign(mouse,{x:xy[0],y:xy[1],clicked:1,buttons:1});gameTick();
const pressed=sample();
Object.assign(mouse,{x:release[0],y:release[1],buttons:0});
if(!pressed.exited)gameTick();
console.log(JSON.stringify([pressed,sample()]));
''',json.dumps([xy,release,dict(scores=source['scores'],wins=source['wins']),args.teams,args.team_page])],cwd=root,text=True))
    def check_frame(sample):
        native=extract_display_pixels(mem,ports)
        differences=[]
        for py in range(y,y2+1):
            for px in range(x,x2+1):
                actual=sample['pixels'][py*360+px]
                if list(ports.palette[native[py*360+px]])!=sample['palette'][actual*3:actual*3+3]:
                    differences.append((px,py,native[py*360+px],actual))
        assert not differences,(target,outside,len(differences),differences[:12])
    pressed=exited=False
    for tick in range(121):
        reason,_=run_fast(cpu,mem,ports,handler,1000000,
                         bp_set={p-0x6100 for p in (0x4BDA3,0x4BE8C,0x35155)})
        address=cpu.segs[1]*16+cpu.ip+0x6100
        assert reason=='breakpoint',(reason,hex(address))
        if address==0x35155:
            exited=True;pressed=tick<=60;break
        if tick==60:check_frame(port[0])
        if tick==120:
            check_frame(port[1]);break
        sp=cpu.segs[2]*16+cpu.regs[4]
        if address==0x4BDA3 and (mem.read16(sp+4) or mem.read16(sp+6)):
            for i,value in enumerate(xy if tick<60 else release):
                mem.write16(mem.read16(sp+4+i*4)+16*mem.read16(sp+6+i*4),value)
        cpu.regs[0]=int(tick<60)
        cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
    assert [pressed,exited]==[sample['exited'] for sample in port],(target,outside,pressed,exited)
    if exited:assert mem.read16(ds+0x50F6)==port[1]['action'],(target,'action')
    print(f'{target}, release outside={outside}: transitions, action and retained panel RGB match.')
