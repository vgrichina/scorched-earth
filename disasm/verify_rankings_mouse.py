#!/usr/bin/env python3
"""Compare Rankings mouse transitions with real native dialog dispatch.

Only mouse driver position/button polling is supplied by the harness. Checks
Go press/release, release outside, outside dismissal and blank-panel clicks.
Uses the 360x480 two-player composed rankings fixture; excludes mouse cursor.
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
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
for xy,release in [([180,267],[180,267]),([180,267],[20,20]),
                   ([20,20],[20,20]),([180,240],[180,240])]:
    port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {resetRankingsInput} from './web/js/rankings.js';
import {mouse} from './web/js/input.js';
const [xy,release]=JSON.parse(process.argv[1]);
Object.assign(config,{scoringMode:0,rounds:10,numPlayers:2});createPlayers(2);
Object.assign(players[0],{name:'a',wins:1,score:2000});
Object.assign(players[1],{name:'b',wins:0,score:-1500,alive:false});
Object.assign(game,{state:STATE.ROUND_OVER,round:1,currentPlayer:1,roundOverTimer:0});resetRankingsInput();
Object.assign(mouse,{x:xy[0],y:xy[1],clicked:1,buttons:1});gameTick();
const pressed=game.state==='shop';
Object.assign(mouse,{x:release[0],y:release[1],buttons:0});
if(!pressed)gameTick();
console.log(JSON.stringify([pressed,game.state==='shop']));
''',json.dumps([xy,release])],cwd=root,text=True))
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    # Fixture geometry is fixed by the known composed capture, not port output.
    ptr=mem.read16(0x4FC80+0xEC38)+16*mem.read16(0x4FC80+0xEC3A)
    assert [mem.read16(ptr+i) for i in (0,2,4,6)]==[119,192,239,286]
    pressed=exited=False
    for tick in range(120):
        reason,_=run_fast(cpu,mem,ports,handler,1000000,
                         bp_set={p-0x6100 for p in (0x4BDA3,0x4BE8C,0x348FD)})
        address=cpu.segs[1]*16+cpu.ip+0x6100
        assert reason=='breakpoint',(reason,hex(address))
        if address==0x348FD:
            exited=True;pressed=tick<=60;break
        sp=cpu.segs[2]*16+cpu.regs[4]
        if address==0x4BDA3:
            for i,value in enumerate(xy if tick<60 else release):
                mem.write16(mem.read16(sp+4+i*4)+16*mem.read16(sp+6+i*4),value)
        cpu.regs[0]=int(tick<60)
        cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
    assert [pressed,exited]==port,(xy,release,[pressed,exited],port)
    print(f'{xy} -> {release}: native press/release exits {port} match gameTick.')
