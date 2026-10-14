#!/usr/bin/env python3
"""Compare native Rankings held keys with production gameTick and button pixels.

Requires rankings.state plus rankings-port.json from the composed shot oracle.
Checks keyboard transitions and panel indices; --final compares panel RGB
and native action codes. --ai exercises both Type/Name toggle directions.
Does not test mouse, ring timing, or the following menu/shop screen.
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
parser.add_argument('--final',action='store_true')
parser.add_argument('--ai',action='store_true',help='Use a Moron opponent in the final dialog')
parser.add_argument('--teams',action='store_true',help='Exercise team rankings page switches')
parser.add_argument('--team-page',action='store_true',help='Begin final keyboard cases on the team page')
parser.add_argument('--key',help='Run one named key case')
args=parser.parse_args()
assert not args.team_page or (args.final and args.teams)
assert not args.ai or args.final
root=Path(__file__).resolve().parent.parent
source=json.loads(args.checkpoint.with_name('rankings-port.json').read_text())
for code,scan,char in [('KeyA',0x1E,97),('Enter',0x1C,13),('Space',0x39,32),('KeyG',0x22,103),('Escape',1,27),*([('KeyQ',0x10,113),('KeyT',0x14,116),('KeyN',0x31,110)] if args.final else [('KeyT',0x14,116),('KeyP',0x19,112)] if args.teams else []),*([('KeyY',0x15,121),('KeyP',0x19,112)] if args.teams and args.final else [])]:
    if args.key and args.key!=code:continue
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    ds=0x4FC80;players=[]
    for i,score in enumerate(source['scores']):
        tank=ds+0xD568+i*0xCA
        ptr=mem.read16(tank+0xB6)+16*mem.read16(tank+0xB8)
        name=bytes(mem.data[ptr:ptr+40]).split(b'\0')[0].decode('ascii')
        players.append(dict(name=name,score=score,wins=source['wins'][i],
                            alive=bool(mem.read16(tank+0x18)),colorIndex=mem.read16(tank+0x1A)//8))
    if args.teams:
        mem.write16(ds+0x50EA,1);mem.write16(ds+0x6022,0)
        for i,player in enumerate(players):
            team=0xE1EC+22*i;name=['Red','Blue'][i]
            for j,ch in enumerate(name.encode()+b'\0'):mem.write8(0x92000+i*64+j,ch)
            for off,value in ((0,1),(4,player['wins']),(6,i*64),(8,0x9200)):mem.write16(ds+team+off,value)
            mem.write16(ds+0xD568+i*0xCA+0x30,i)
            player.update(team=i,teamName=name)
    if args.final or args.teams:
        if args.final:mem.write16(ds+0xE342,mem.read16(ds+0x5160))
        mem.write16(ds+0x50F6,0)
        if args.ai:
            mem.write16(ds+0xD568+0xCA+0x22,1)
            players[1]['aiType']=1
        cpu.segs[:]=[0,0x2D54,0x5F4A,0x4FC8]
        cpu.ip=0x33FC3-0x6100-0x2D540;cpu.regs[4]=0x2400
        mem.write16(0x5F4A0+0x2400,0x110);mem.write16(0x5F4A0+0x2402,0x60)
        reason,_=run_fast(cpu,mem,ports,handler,10000000,bp_set={0x460C3-0x6100})
        assert reason=='breakpoint',reason
        bp=cpu.segs[2]*16+cpu.regs[5]
        dialog=mem.read16(bp+6)+16*mem.read16(bp+8)
    else:dialog=mem.read16(ds+0xEC38)+16*mem.read16(ds+0xEC3A)
    c=dict(teamPage=args.team_page,teams=args.teams,ai=args.ai,final=args.final,code=code,players=players,round=mem.read16(ds+0xE342),rounds=mem.read16(ds+0x5160))
    port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {getTeamScore} from './web/js/team-scoring.js';
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {drawRankings,resetRankingsInput} from './web/js/rankings.js';
import {pixels} from './web/js/framebuffer.js';
import {drawFinalScoring,resetFinalScoringInput} from './web/js/final-scoring.js';
import {palette6,initPalette} from './web/js/palette.js';
import {initInput} from './web/js/input.js';
const c=JSON.parse(process.argv[1]),listeners={};
globalThis.window={addEventListener:(k,f)=>listeners[k]=f};initInput({addEventListener(){}});
Object.assign(config,{teamMode:c.teams?1:0,scoringMode:0,rounds:c.rounds,numPlayers:c.players.length,soundEnabled:0});
createPlayers(c.players.length);if(c.teams)c.players.forEach(p=>Object.assign(getTeamScore(p.team),{name:p.teamName,score:0,wins:p.wins}));players.forEach((p,i)=>Object.assign(p,c.players[i]));
Object.assign(game,{state:STATE.ROUND_OVER,round:c.round,currentPlayer:1,roundOverTimer:0});resetRankingsInput();resetFinalScoringInput();if(c.final)initPalette(2,2);
if(c.teamPage||c.ai&&c.code==='KeyN'||c.teams&&c.code==='KeyP') {
  const key=!c.teamPage&&c.final&&c.teams&&c.code==='KeyN'?'KeyY':'KeyT';
  listeners.keydown({code:key,preventDefault(){}});gameTick();
  listeners.keyup({code:key,preventDefault(){}});gameTick();
}
listeners.keydown({code:c.code,preventDefault(){}});gameTick();
const press=game.state;if(c.final)drawFinalScoring(players);else drawRankings(players,c.round,c.rounds);const frame=Array.from(pixels);
listeners.keyup({code:c.code,preventDefault(){}});
if(game.state===STATE.ROUND_OVER)gameTick();
if(game.state===STATE.ROUND_OVER){if(c.final)drawFinalScoring(players);else drawRankings(players,c.round,c.rounds);}
console.log(JSON.stringify({releasePixels:Array.from(pixels),press,release:game.state,pixels:frame,palette:Array.from(palette6),action:game.finalScoringAction}));
''',json.dumps(c)],cwd=root,text=True))
    def run():
        reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={(0x35155 if args.final else 0x348FD)-0x6100},
                         timer_period=1000,tick_addr=ds+0xEE78,isr_divisor=200)
        assert reason in ('max_steps','breakpoint'),reason
        return reason=='breakpoint'
    if args.team_page or (args.ai and code=='KeyN') or (args.teams and code=='KeyP'):
        scan_before=0x15 if not args.team_page and args.final and args.teams and code=='KeyN' else 0x14
        deliver_key(cpu,mem,ports,handler,scan_before,121 if scan_before==0x15 else 116);assert not run()
        deliver_key(cpu,mem,ports,handler,scan_before|128,0);assert not run()
        if args.teams and not args.final:dialog=mem.read16(ds+0xEC3C)+16*mem.read16(ds+0xEC3E)
    deliver_key(cpu,mem,ports,handler,scan,char)
    exited=run()
    assert exited==(port['press']==('config' if args.final else 'shop')),(code,'press',exited,port['press'])
    if not exited:
        ptr=dialog
        x,y,x2,y2=[mem.read16(ptr+i) for i in (0,2,4,6)]
        native=extract_display_pixels(mem,ports)
        differences=[(px,py,native[py*360+px],port['pixels'][py*360+px])
                     for py in range(y,y2+1) for px in range(x,x2+1)
                     if (list(ports.palette[native[py*360+px]])!=port['palette'][port['pixels'][py*360+px]*3:port['pixels'][py*360+px]*3+3] if args.final else native[py*360+px]!=port['pixels'][py*360+px])]
        assert not differences,(code,len(differences),differences[:15])
        deliver_key(cpu,mem,ports,handler,scan|128,0)
        exited=run()
        assert exited==(port['release']==('config' if args.final else 'shop')),(code,'release',exited,port['release'])
    if (args.final or args.teams) and not exited:
        native=extract_display_pixels(mem,ports)
        differences=[(px,py) for py in range(y,y2+1) for px in range(x,x2+1)
          if (list(ports.palette[native[py*360+px]])!=port['palette'][port['releasePixels'][py*360+px]*3:port['releasePixels'][py*360+px]*3+3] if args.final else native[py*360+px]!=port['releasePixels'][py*360+px])]
        assert not differences,(code,'released panel',len(differences),differences[:15])
    if args.final and exited:assert mem.read16(ds+0x50F6)==port['action'],(code,'action')
    print(f'{code}: native press/release transition and retained panel pixels match production gameTick.')
