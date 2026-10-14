#!/usr/bin/env python3
"""Compare native purchase/sale inventory and personal/Corporate cash mutations.

Runs 0x14924 with AI type 1 to omit human dialog repaint; skips the rejection
sound dispatcher (its timer wait requires live interrupts). Explicitly enables
items and sets current prices; does not verify shop availability, UI or team setup.
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
cases=[dict(item=i,quantity=q,mode=mode,kind=kind,cash=cash,teamCash=team_cash)
 for i in range(48) for q in (0,98,99)
 for mode,kind,cash,team_cash in ((0,2,1000000,0),(1,0,1000000,0),(2,2,0,1000000),(3,2,1000000,0))]
cases += [dict(item=3,quantity=0,mode=mode,kind=2,cash=cash,teamCash=team_cash)
 for mode,cash,team_cash in ((0,11999,0),(0,12000,0),(2,0,11999),(2,0,12000))]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {buyWeapon,sellWeapon,initMarket} from './web/js/shop.js';
import {WEAPONS} from './web/js/weapons.js';
import {getTeamScore,resetTeamScores} from './web/js/team-scoring.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 Object.assign(config,{teamMode:c.mode,freeMarket:0});resetTeamScores();initMarket();
 const team=getTeamScore(0);Object.assign(team,{type:c.kind,cash:c.teamCash});
 const p={team:0,cash:c.cash,inventory:Array(50).fill(0)};p.inventory[c.item+2]=c.quantity;
 const purchased=buyWeapon(p,c.item+2),w=WEAPONS[c.item+2];
 const state=[p.cash,team.cash,p.inventory[c.item+2],Number(purchased)];
 const sales=[];
 for(const freeMarket of [0,1]){
  config.freeMarket=freeMarket;
  const quantity=Math.min(p.inventory[c.item+2],w.bundle);
  sellWeapon(p,c.item+2,quantity);
  sales.push({quantity,state:[p.cash,team.cash,p.inventory[c.item+2],Number(purchased)]});
 }
 return {state,sales,price:w.price,bundle:w.bundle};
})));
'''],input=json.dumps(cases),text=True,cwd=root))
for case,expected in zip(cases,actual):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
 def call(address,segment,arguments):
  c.segs[:]=[0,segment,0x5f4a,0x4fc8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
  for i,v in enumerate([0x110,0x60,*arguments]):m.write16(0x5f4a0+0x2400+2*i,v&65535)
  while True:
   reason,_=run_fast(c,m,p,h,10000000,bp_set={0x710,0x4c117-0x6100})
   assert reason=='breakpoint',(case,address,reason)
   if c.segs[1]*16+c.ip==0x710:break
   stack=c.segs[2]*16+c.regs[4]
   c.ip=m.read16(stack);c.segs[1]=m.read16(stack+2);c.regs[4]+=4
 item=case['item'];weapon=ds+52*item
 for off,value in ((0x519a,65535),(0x50ea,case['mode']),(0xe1ee,case['kind']),
                   (0xd568+0x30,0),(0xd568+0x22,1),(0xd568+0xb2,0),(0xd568+0xb4,0x9400)):
  m.write16(ds+off,value)
 m.write16(0x94000+2*item,case['quantity'])
 m.write16(weapon+0x1216,1);m.write16(weapon+0x1214,0)
 m.write32(weapon+0x1210,expected['price']);m.write16(weapon+0x11fc,expected['bundle'])
 fields=(0xd568+0xbe,0xe1ec+0xe)
 for off,value in zip(fields,(case['cash'],case['teamCash'])):
  call(0x11b2c,0xb87,[off,0x4fc8,value&65535,(value>>16)&65535])
 call(0x14924,0xe4c,[0xd568,0x4fc8,item])
 def storage():
  result=[]
  for off in fields:
   obj=m.read16(ds+off)+16*m.read16(ds+off+2)
   limbs=m.read16(obj)+16*m.read16(obj+2);count=m.read16(obj+4)
   assert 0<count<16,(case,off,count)
   value=0
   for j in range(count):value=(value<<16)|m.read16(limbs+2*j)
   if m.read16(limbs)&0x8000:value-=1<<(16*count)
   result.append(value)
  return result+[m.read16(0x94000+2*item),m.read16(weapon+0x1214)]
 assert storage()==expected['state'],(case,storage(),expected)
 for free_market,sale in enumerate(expected['sales']):
  for off,value in ((0x514a,free_market),(0xec6e,sale['quantity']),(0xec76,item),(0xec78,0xd568),(0xec7a,0x4fc8)):
   m.write16(ds+off,value)
  call(0x37c0c,0x3128,[])
  assert storage()==sale['state'],(case,free_market,storage(),sale)
print(f'{len(cases)} native purchase and {2*len(cases)} subsequent sale cases match inventory, sales count and personal/team cash.')
