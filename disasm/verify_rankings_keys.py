#!/usr/bin/env python3
"""Compare native Rankings held keys with production gameTick and button pixels.

Requires rankings.state plus rankings-port.json from the composed shot oracle.
Checks keyboard transitions and panel indices; does not test mouse or the shop.
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
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
source=json.loads(args.checkpoint.with_name('rankings-port.json').read_text())
for code,scan,char in [('KeyA',0x1E,97),('Enter',0x1C,13),('Space',0x39,32),('KeyG',0x22,103),('Escape',1,27)]:
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
    c=dict(code=code,players=players,round=mem.read16(ds+0xE342),rounds=mem.read16(ds+0x5160))
    port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {drawRankings,resetRankingsInput} from './web/js/rankings.js';
import {pixels} from './web/js/framebuffer.js';
import {initInput} from './web/js/input.js';
const c=JSON.parse(process.argv[1]),listeners={};
globalThis.window={addEventListener:(k,f)=>listeners[k]=f};initInput({addEventListener(){}});
Object.assign(config,{scoringMode:0,rounds:c.rounds,numPlayers:c.players.length,soundEnabled:0});
createPlayers(c.players.length);players.forEach((p,i)=>Object.assign(p,c.players[i]));
Object.assign(game,{state:STATE.ROUND_OVER,round:c.round,currentPlayer:1,roundOverTimer:0});resetRankingsInput();
listeners.keydown({code:c.code,preventDefault(){}});gameTick();
const press=game.state;drawRankings(players,c.round,c.rounds);const frame=Array.from(pixels);
listeners.keyup({code:c.code,preventDefault(){}});
if(game.state===STATE.ROUND_OVER)gameTick();
console.log(JSON.stringify({press,release:game.state,pixels:frame}));
''',json.dumps(c)],cwd=root,text=True))
    def run():
        reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x348FD-0x6100},
                         timer_period=1000,tick_addr=ds+0xEE78,isr_divisor=200)
        assert reason in ('max_steps','breakpoint'),reason
        return reason=='breakpoint'
    deliver_key(cpu,mem,ports,handler,scan,char)
    exited=run()
    assert exited==(port['press']=='shop'),(code,'press',exited,port['press'])
    if not exited:
        ptr=mem.read16(ds+0xEC38)+16*mem.read16(ds+0xEC3A)
        x,y,x2,y2=[mem.read16(ptr+i) for i in (0,2,4,6)]
        native=extract_display_pixels(mem,ports)
        differences=[(px,py,native[py*360+px],port['pixels'][py*360+px])
                     for py in range(y,y2+1) for px in range(x,x2+1)
                     if native[py*360+px]!=port['pixels'][py*360+px]]
        assert not differences,(code,len(differences),differences[:15])
        deliver_key(cpu,mem,ports,handler,scan|128,0)
        exited=run()
        assert exited==(port['release']=='shop'),(code,'release',exited,port['release'])
    print(f'{code}: native press/release transition and retained panel pixels match production gameTick.')
