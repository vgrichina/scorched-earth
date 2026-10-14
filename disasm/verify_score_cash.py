#!/usr/bin/env python3
"""Compare full native 0x377D9 score/cash storage, without score-add interception.

Explicitly initializes personal/team score and cash; reads resulting native
bignum limbs after each award. Covers normal signed additions and 16-bit boundaries.
Does not initialize teams through the menu or execute purchasing/interest.
"""
import argparse,json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');parser.add_argument('--boundaries-only',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
cases=[dict(scoring=scoring,mode=mode,kind=kind,cash=cash,amount=amount,score=100)
 for scoring in range(3) for mode in range(4) for kind in range(4)
 for cash in (0,1000,32767,32768,65535,65536,1000000)
 for amount in (-70000,-2000,-1500,0,500,5000,70000)]
cases += [dict(scoring=1,mode=1,kind=0,cash=1000000,score=score,amount=amount)
 for score in (-70000,-65536,-32769,-32768,-2000,0,32767,65536,2147483647)
 for amount in (-2147483648,-70000,-65536,-32769,-32768,-2000,0,5000,70000,2147483647)]
if args.boundaries_only:cases=cases[-90:]
for case in cases:case['teamScore']=min(2147483647,case['score']+100)
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {addPlayerScore} from './web/js/score.js';
import {getTeamScore,resetTeamScores} from './web/js/team-scoring.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 Object.assign(config,{scoringMode:c.scoring,teamMode:c.mode});resetTeamScores();
 const p={team:0,score:c.score,cash:c.cash};
 const team=getTeamScore(0);Object.assign(team,{type:c.kind,score:c.teamScore,cash:c.cash+300});
 addPlayerScore(p,c.amount);
 return [p.score,p.cash,team.score,team.cash];
})));
'''],input=json.dumps(cases),text=True,cwd=root))
failures=[]
for case,expected in zip(cases,actual):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
 def call(address,segment,arguments):
  c.segs[:]=[0,segment,0x5f4a,0x4fc8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
  for i,v in enumerate([0x110,0x60,*arguments]):m.write16(0x5f4a0+0x2400+2*i,v&65535)
  reason,_=run_fast(c,m,p,h,10000000,bp_set={0x710});assert reason=='breakpoint',(case,address,reason)
 for off,value in ((0x519a,65535),(0x5148,case['scoring']),(0x50ea,case['mode']),
                   (0xe1ee,case['kind']),(0xd568+0x30,0)):
  m.write16(ds+off,value)
 fields=(0xd568+0xba,0xd568+0xbe,0xe1ec+0xa,0xe1ec+0xe)
 for off,value in zip(fields,(case['score'],case['cash'],case['teamScore'],case['cash']+300)):
  call(0x11b2c,0xb87,[off,0x4fc8,value&65535,(value>>16)&65535])
 call(0x377d9,0x3128,[0xd568,0x4fc8,case['amount']&65535,(case['amount']>>16)&65535])
 result=[]
 for off in fields:
  obj=m.read16(ds+off)+16*m.read16(ds+off+2)
  limbs=m.read16(obj)+16*m.read16(obj+2);count=m.read16(obj+4)
  assert 0<count<16,(case,off,count)
  value=0
  for j in range(count):value=(value<<16)|m.read16(limbs+2*j)
  if m.read16(limbs)&0x8000:value-=1<<(16*count)
  result.append(value)
 if result!=expected:
  failures.append((case,result,expected))
  if len(failures)==10:raise AssertionError(failures)
assert not failures,failures
print(f'{len(cases)} native score/cash additions match personal/team storage.')
