#!/usr/bin/env python3
"""Compare native 0x2B405 round-end decision with the production aftermath exit.

Exhausts alive masks for 2/3/5 players over four roster patterns and all four
team modes. Runs gameTick with an already completed aftermath iterator, so
physics, scoring amounts and rankings rendering remain separate coverage.
"""
import json
import subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[dict(mode=mode,teams=teams,alive=[bool(mask&(1<<i)) for i in range(n)])
       for n in (2,3,5) for mode in range(4)
       for teams in (list(range(n)),[0]*n,[i%2 for i in range(n)],[0]*(n-1)+[1])
       for mask in range(1<<n)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 Object.assign(config,{teamMode:c.mode,scoringMode:1,numPlayers:c.teams.length,soundEnabled:0});
 createPlayers(c.teams.length);
 players.forEach((p,i)=>Object.assign(p,{team:c.teams[i],alive:c.alive[i],energy:c.alive[i]?100:0}));
 Object.assign(game,{state:STATE.EXPLOSION,round:1,currentPlayer:0,
   aftermath:{next:()=>({done:true})},aftermathOperation:null,afterFalling:false});
 gameTick();
 if(![STATE.ROUND_OVER,STATE.NEXT_TURN].includes(game.state))throw new Error(game.state);
 return game.state===STATE.ROUND_OVER;
})));
'''],input=json.dumps(cases),cwd=root,text=True))
for case,expected in zip(cases,actual):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;load_exe(root/'earth/SCORCH.EXE',m)
 h=InterruptHandler(m,c,str(root/'earth'),p);ds=0x4FC80;stack=0x5F4A0
 for off,value in ((0x519A,65535),(0x50EA,case['mode']),(0x50D4,len(case['teams'])),(0xE340,sum(case['alive']))):m.write16(ds+off,value)
 for i,team in enumerate(case['teams']):
  m.write16(ds+0xD568+i*0xCA+0x30,team)
  m.write16(ds+0xD568+i*0xCA+0x18,int(case['alive'][i]))
 c.segs[:]=[0,0x200F,0x5F4A,0x4FC8];c.ip=0x2B405-0x6100-0x200F0;c.regs[4]=0x2400
 m.write16(stack+0x2400,0x110);m.write16(stack+0x2402,0x60)
 reason,_=run_fast(c,m,p,h,100000,bp_set={0x710})
 assert reason=='breakpoint',(case,reason)
 assert bool(c.regs[0])==expected,(case,c.regs[0],expected)
print(f'{len(cases)} native round-end decisions match production gameTick across four team modes.')
