#!/usr/bin/env python3
"""Compare team rankings mouse dispatch and panel pixels with production gameTick.

Requires capture_team_rankings.py's two-player Player Rankings checkpoint.
Checks Teams/Go clicks and release outside; supplies mouse driver polls only.
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
from compare_pipeline import extract_display_pixels

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
source=dict(scores=[5000,-1500],wins=[1,0])
for target,outside in [('go',False),('go',True),('teams',False),('teams',True),('outside',False),('blank',False)]:
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    ds=0x4FC80
    bp=cpu.segs[2]*16+cpu.regs[5]
    ptr=mem.read16(bp+6)+16*mem.read16(bp+8)
    x,y,x2,y2=[mem.read16(ptr+i) for i in (0,2,4,6)]
    if target in ('go','teams'):
        i=12+('go','teams').index(target)
        widget=mem.read16(ptr+0x20+4*i)+16*mem.read16(ptr+0x22+4*i)
        bx,by,bx2,by2=[mem.read16(widget+o) for o in (0x48,0x4A,0x4C,0x4E)]
        xy=[x+(bx+bx2)//2,y+(by+by2)//2]
    else:xy=[20,20] if target=='outside' else [x+5,y+25]
    release=[20,20] if outside else xy
    port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {resetRankingsInput,drawRankings,rankingsInput} from './web/js/rankings.js';
import {getTeamScore} from './web/js/team-scoring.js';
import {pixels} from './web/js/framebuffer.js';
import {initPalette,palette6} from './web/js/palette.js';
import {mouse} from './web/js/input.js';
const [xy,release,source]=JSON.parse(process.argv[1]);
Object.assign(config,{teamMode:1,scoringMode:1,rounds:10,numPlayers:2});createPlayers(2);initPalette(2,2);
Object.assign(players[0],{name:'a',wins:source.wins[0],score:source.scores[0],aiType:0});
Object.assign(players[1],{name:'b',wins:source.wins[1],score:source.scores[1],alive:false,aiType:1});
['Red','Blue'].forEach((name,i)=>Object.assign(getTeamScore(i),{name,wins:source.wins[i],score:source.scores[i]}));
Object.assign(game,{state:STATE.ROUND_OVER,round:1,currentPlayer:1,roundOverTimer:0});resetRankingsInput();
const sample=()=>{
  drawRankings(players,1,10);
  return {exited:game.state!==STATE.ROUND_OVER,showTeams:rankingsInput.showTeams,
    pixels:Array.from(pixels),palette:Array.from(palette6)};
};
Object.assign(mouse,{x:xy[0],y:xy[1],clicked:1,buttons:1});gameTick();
const pressed=sample();
Object.assign(mouse,{x:release[0],y:release[1],buttons:0});
if(!pressed.exited)gameTick();
console.log(JSON.stringify([pressed,sample()]));
''',json.dumps([xy,release,dict(scores=source['scores'],wins=source['wins'])])],cwd=root,text=True))
    def check_frame(sample):
        native=extract_display_pixels(mem,ports)
        differences=[]
        for py in range(y,y2+1):
            for px in range(x,x2+1):
                actual=sample['pixels'][py*360+px]
                if native[py*360+px]!=actual:
                    differences.append((px,py,native[py*360+px],actual))
        assert not differences,(target,outside,len(differences),differences[:12])
    pressed=exited=False
    for tick in range(121):
        reason,_=run_fast(cpu,mem,ports,handler,1000000,
                         bp_set={p-0x6100 for p in (0x4BDA3,0x4BE8C,0x348FD)})
        address=cpu.segs[1]*16+cpu.ip+0x6100
        assert reason=='breakpoint',(reason,hex(address))
        if address==0x348FD:
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
    if not exited:assert bool(mem.read16(ds+0x6022))==port[1]['showTeams'],(target,'page')
    print(f'{target}, release outside={outside}: transitions, page and retained panel pixels match.')
