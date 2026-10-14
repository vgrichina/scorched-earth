#!/usr/bin/env python3
"""Execute native player value 0x31379 and its decimal formatter.

Verifies all native inventory items, quantity/truncation cases, current market
prices, independent scoring/team modes and Corporate shared-cash selection.
Cash/score values are explicitly constructed; no arithmetic is intercepted.
Does not verify purchasing, score-to-cash updates or team setup.
"""
import argparse,json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
cases=[dict(scoring=2,teamMode=0,teamType=0,cash=1234,teamCash=4321,score=-123,
            item=i,quantity=q,market=market)
       for i in range(48) for q in (-1,0,1,3,7,99) for market in (False,True)]
cases += [dict(scoring=scoring,teamMode=mode,teamType=kind,cash=cash,teamCash=70000,score=-123,
               item=2,quantity=7,market=False)
          for scoring in range(3) for mode in range(4) for kind in range(4) for cash in (0,32768)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {WEAPONS} from './web/js/weapons.js';
import {initMarket} from './web/js/shop.js';
import {playerRankingValue} from './web/js/ranking-value.js';
import {getTeamScore} from './web/js/team-scoring.js';
let input='';for await(const c of process.stdin)input+=c;
const base=WEAPONS.map(w=>w.price);
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 Object.assign(config,{scoringMode:c.scoring,teamMode:c.teamMode,freeMarket:0});
 WEAPONS.forEach((w,i)=>w.price=c.market?base[i]+17:base[i]);initMarket();
 // Reset base prices after snapshot: the ranking must read market, even with
 // Free Market disabled. This distinguishes +0x1A from the base price field.
 WEAPONS.forEach((w,i)=>w.price=base[i]);
 Object.assign(getTeamScore(0),{type:c.teamType,cash:c.teamCash});
 const inventory=Array(50).fill(0);inventory[c.item+2]=c.quantity;
 return playerRankingValue({team:0,cash:c.cash,score:c.score,inventory});
})));
'''],input=json.dumps(cases),cwd=root,text=True))
for case,expected in zip(cases,actual):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
 def call(address,segment,arguments):
  c.segs[:]=[0,segment,0x5f4a,0x4fc8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
  for i,v in enumerate([0x110,0x60,*arguments]):m.write16(0x5f4a0+0x2400+2*i,v&65535)
  reason,_=run_fast(c,m,p,h,10000000,bp_set={0x710});assert reason=='breakpoint',(case,address,reason)
 for off,value in ((0x519a,65535),(0x5148,case['scoring']),(0x50ea,case['teamMode']),
                   (0xe1ee,case['teamType']),(0xd568+0x30,0),(0xd568+0xb2,0),(0xd568+0xb4,0x9400)):
  m.write16(ds+off,value)
 for i in range(48):
  m.write16(0x94000+2*i,case['quantity']&65535 if i==case['item'] else 0)
  if case['market']:
   addr=ds+0x1210+52*i;m.write32(addr,m.read32(addr)+17)
 for off,value in ((0xd568+0xba,case['score']),(0xd568+0xbe,case['cash']),(0xe1ec+0xe,case['teamCash'])):
  call(0x11b2c,0xb87,[off,0x4fc8,value&65535,(value>>16)&65535])
 call(0x31379,0x2aa6,[0,0x9800,0xd568,0x4fc8])
 call(0x114bb,0xb18,[0,0x9800])
 ptr=c.regs[0]+16*c.regs[2]
 value=int(bytes(m.data[ptr:ptr+80]).split(b'\0')[0].replace(b',',b''))
 assert value==expected,(case,value,expected)
print(f'{len(cases)} native ranking-value cases match, including all 48 items and Corporate cash.')
