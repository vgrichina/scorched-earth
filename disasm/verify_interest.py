#!/usr/bin/env python3
"""Execute native 0x176DD twice per fixture; compare all cash/interest limbs.

Explicit player/team balances isolate arithmetic and accumulation. Does not
verify shop timing, resets, team initialization or interest display pixels.
"""
import argparse,json,struct,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
cases=[dict(mode=mode,cash=cash,rate=rate,earned=earned)
 for mode in range(4) for cash in (0,1,3,101,32767,32768,65535,65536,1000000,2147483647)
 for rate in (0,1,29,30,33.333,100) for earned in (0,1234)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {applyInterest} from './web/js/score.js';
import {players} from './web/js/tank.js';
import {getTeamScore,resetTeamScores} from './web/js/team-scoring.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 Object.assign(config,{teamMode:c.mode,interest:c.rate});resetTeamScores();
 players.splice(0,players.length,{cash:c.cash,earnedInterest:c.earned});
 const team=getTeamScore(0);Object.assign(team,{cash:c.cash,earnedInterest:c.earned});
 const results=[];
 for(let i=0;i<2;i++){
  applyInterest();results.push([players[0].cash,players[0].earnedInterest,team.cash,team.earnedInterest]);
 }
 return results;
})));
'''],input=json.dumps(cases),text=True,cwd=root))
for case,expected in zip(cases,actual):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
 def call(address,segment,arguments):
  c.segs[:]=[0,segment,0x5f4a,0x4fc8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
  for i,v in enumerate([0x110,0x60,*arguments]):m.write16(0x5f4a0+0x2400+2*i,v&65535)
  reason,_=run_fast(c,m,p,h,10000000,bp_set={0x710});assert reason=='breakpoint',(case,address,reason)
 for off,value in ((0x519a,65535),(0x50ea,case['mode']),(0x50d4,1)):
  m.write16(ds+off,value)
 m.data[ds+0x5190:ds+0x5198]=struct.pack('<d',case['rate']/100)
 fields=(0xd568+0xbe,0xd568+0xc2,0xe1ec+0xe,0xe1ec+0x12)
 for off,value in zip(fields,(case['cash'],case['earned'],case['cash'],case['earned'])):
  call(0x11b2c,0xb87,[off,0x4fc8,value&65535,(value>>16)&65535])
 for iteration in range(2):
  call(0x176dd,0x1119,[])
  result=[]
  for off in fields:
   obj=m.read16(ds+off)+16*m.read16(ds+off+2)
   limbs=m.read16(obj)+16*m.read16(obj+2);count=m.read16(obj+4)
   assert 0<count<16,(case,off,count)
   value=0
   for j in range(count):value=(value<<16)|m.read16(limbs+2*j)
   if m.read16(limbs)&0x8000:value-=1<<(16*count)
   result.append(value)
  assert result==expected[iteration],(case,iteration,result,expected[iteration])
print(f'{len(cases)*2} native interest updates match personal/team cash and accumulated interest.')
