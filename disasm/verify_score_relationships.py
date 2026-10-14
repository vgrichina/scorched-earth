#!/usr/bin/env python3
"""Compare enemy classification and score-event amounts with native routines.

Executes 0x324ED, 0x375E3 and 0x37688. Intercepts add_score at its entry;
checks amounts and port team aggregation, not native bignum/cash storage.
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
cases=[dict(mode=mode,teamMode=team_mode,teams=teams,alive=alive,a=a,b=b)
       for mode in range(3) for team_mode in range(4) for teams in ([0,1,2],[0,0,1],[0,0,0],[2,1,1])
       for alive in ([True,True,True],[True,True,False],[False,False,False])
       for a in range(3) for b in range(3)]
port=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {isEnemy,scoreOnDamage,scoreOnDeath} from './web/js/score.js';
import {resetTeamScores,getTeamScore} from './web/js/team-scoring.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 config.scoringMode=c.mode;config.teamMode=c.teamMode;createPlayers(3);
 players.forEach((p,i)=>Object.assign(p,{team:c.teams[i],alive:c.alive[i],score:0}));
 const enemy=isEnemy(players[c.a],players[c.b]);
 const events=['kill',0,1].map(kind=>{
  players.forEach(p=>p.score=0);resetTeamScores();
  if(kind==='kill')scoreOnDeath(players[c.a],players[c.b]);
  else scoreOnDamage(players[c.a],players[c.b],17,kind===1);
  return {scores:players.map(p=>p.score),teams:[0,1,2].map(t=>getTeamScore(t).score)};
 });
 return {enemy,events};
})));
'''],input=json.dumps(cases),cwd=root,text=True))
for case,actual in zip(cases,port):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m
 load_exe(root/'earth/SCORCH.EXE',m)
 h=InterruptHandler(m,c,str(root/'earth'),p);ds=0x4FC80;stack=0x5F4A0
 for off,value in ((0x519A,65535),(0x50EA,case['teamMode']),(0x50D4,3),(0x5148,case['mode'])):m.write16(ds+off,value)
 for i in range(3):
  for off,value in ((0x30,case['teams'][i]),(0x18,int(case['alive'][i])),(0xA0,i)):
   m.write16(ds+0xD568+i*0xCA+off,value)
 arguments=[0xD568+case['a']*0xCA,0x4FC8,0xD568+case['b']*0xCA,0x4FC8]
 for event,address,segment in [(-1,0x324ED,0x2AA6),(0,0x375E3,0x3128),(1,0x37688,0x3128),(2,0x37688,0x3128)]:
  c.segs[:]=[0,segment,0x5F4A,0x4FC8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
  values=[0x110,0x60,*arguments,*([17,0,event-1] if event>0 else [])]
  for i,value in enumerate(values):m.write16(stack+0x2400+i*2,value)
  scores=[0,0,0]
  for _ in range(3):
   reason,_=run_fast(c,m,p,h,100000,bp_set={0x710,0x377D9-0x6100})
   pc=c.segs[1]*16+c.ip
   assert reason=='breakpoint',(case,event,reason,hex(pc))
   if pc==0x710:break
   sp=stack+c.regs[4];index=(m.read16(sp+4)-0xD568)//0xCA
   amount=m.read16(sp+8)|(m.read16(sp+10)<<16)
   if amount>=0x80000000:amount-=0x100000000
   scores[index]+=amount
   c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
  else:raise AssertionError('event did not return')
  if event==-1:assert bool(c.regs[0])==actual['enemy'],(case,'enemy',c.regs[0],actual)
  else:
   teams=[sum(v for i,v in enumerate(scores) if case['teams'][i]==t) if case['teamMode'] else 0 for t in range(3)]
   assert dict(scores=scores,teams=teams)==actual['events'][event],(case,event,scores,teams,actual)
print(f'{len(cases)} native relationship cases and {len(cases)*3} kill/body/shield score events match.')
