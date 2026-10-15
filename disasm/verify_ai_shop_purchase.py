"""Compare native AI buyers with the port, including exact-cash boundaries."""
import json,subprocess,argparse
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');parser.add_argument('--moron',action='store_true');parser.add_argument('--restricted',action='store_true');parser.add_argument('--market',action='store_true');parser.add_argument('--team',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
D=0x4fc80
results=[]
# Generate a changed-price fixture through the public market lifecycle. This
# tests buyers against identical supplied prices, not market-update parity.
prices=json.loads(subprocess.check_output(['node','--input-type=module','-e',"""
import {config} from './web/js/config.js';
import {players} from './web/js/tank.js';
import {WEAPONS} from './web/js/weapons.js';
import {initMarket,mktUpdate,getMarketPrice} from './web/js/shop.js';
config.freeMarket=1;players.length=2;initMarket();
for(let i=0;i<12;i++)mktUpdate();
console.log(JSON.stringify(WEAPONS.map((_,i)=>getMarketPrice(i)).slice(2)));
"""],cwd=root,text=True)) if args.market else None
for ai,cash,stock,seed in [(ai,cash,stock,seed) for ai in ([1] if args.moron else range(2,8)) for cash in [0,1875,1876,10000,10001,50000,50001,100000,200000] for stock in [0,4,8] for seed in ([0,1,0xd8891750,0xffffffff] if args.moron else [42])]:
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h)
 if prices:
  m.write16(D+0x514a,1)
  for i,price in enumerate(prices):
   m.write16(D+0x1210+i*52,price&65535);m.write16(D+0x1212+i*52,price>>16)
 if args.restricted:
  # Arms=0 removes all equipment and advanced weapons; retain the fixture's
  # other native availability filters for the remaining records.
  m.write16(D+0x518a,0)
  for i in range(48):
   if m.read16(D+0x11f6+i*52+8)>0:m.write16(D+0x1216+i*52,0)
 def ptr(a):return m.read16(a)+16*m.read16(a+2)
 cash_slot=D+0xd568+0xbe
 personal_slot=cash_slot
 if args.team:
  team_slot=D+0xe1ec+0xe
  # Swap existing allocated objects, preserving native ownership/refcounts.
  personal=bytes(m.data[cash_slot:cash_slot+4]);team=bytes(m.data[team_slot:team_slot+4])
  m.data[cash_slot:cash_slot+4]=team;m.data[team_slot:team_slot+4]=personal
  cash_slot=team_slot
  m.write16(D+0x50ea,1);m.write16(D+0xe1ec+2,2);m.write16(D+0xd568+0x30,0)
 def number(slot):
  obj=ptr(slot);limbs=ptr(obj);n=m.read16(obj+4);value=0
  for j in range(n):value=(value<<16)|m.read16(limbs+2*j)
  return value
 personal_before=number(personal_slot)
 obj=ptr(cash_slot);limbs=ptr(obj);n=m.read16(obj+4)
 assert n>=2,n
 n=1 if cash<32768 else 2
 m.write16(obj+4,n)
 for j in range(n):m.write16(limbs+j*2,(cash>>(16*(n-1-j)))&65535)
 m.write16(D+0x515e,1);m.write16(D+0xd568+0x22,ai)
 m.write16(D+0xd568+0x28,0)
 inv=ptr(D+0xd568+0xb2)
 for j in range(48):m.write16(inv+2*j,99 if j==0 else stock)
 m.write16(D+0xc2e6,seed&65535);m.write16(D+0xc2e8,seed>>16)
 rng=bytes(m.data[D+0xea12:D+0xec08]);calls=[]
 c.segs[:]=[0,0x1000,0x8000,0x4fc8];c.ip=0x18a2f-0x16100;c.regs[4]=0x2400
 for j,v in enumerate([0x110,0x60,0xd568,0x4fc8]):m.write16(0x82400+2*j,v)
 for _ in range(50):
  reason,detail=run_fast(c,m,p,h,1000000,timer_period=1000,tick_addr=D+0xee78,isr_divisor=200,bp_set={0x710,0x14924-0x6100,0x4c117-0x6100})
  assert reason=='breakpoint',(ai,cash,stock,seed,reason,detail,hex(c.segs[1]*16+c.ip+0x6100))
  if c.segs[1]*16+c.ip==0x710:break
  # Full-stock rejection can beep; bypass only the hardware sound wait.
  if c.segs[1]*16+c.ip==0x4c117-0x6100:
   sp=c.segs[2]*16+c.regs[4];c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
   continue
  calls.append(m.read16(c.segs[2]*16+c.regs[4]+8))
  reason,detail=run_fast(c,m,p,h,1)
 else:raise Exception('loop')
 remaining=number(cash_slot)
 if args.team:assert number(personal_slot)==personal_before,'personal funds changed'
 assert rng==bytes(m.data[D+0xea12:D+0xec08]),'native RNG changed'
 results.append(dict(team=args.team,personal=personal_before,restricted=args.restricted,market=args.market,seed=seed,legacyAfter=m.read16(D+0xc2e6)+(m.read16(D+0xc2e8)<<16),aiType=ai,cash=cash,stock=stock,remaining=remaining,inventory=[0,0]+[m.read16(inv+2*j) for j in range(48)],parachuteArmed=bool(m.read16(D+0xd568+0x28)),calls=calls))
code="""
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {players} from './web/js/tank.js';
import {getTeamScore,resetTeamScores} from './web/js/team-scoring.js';
import {playerCash} from './web/js/cash.js';
import {aiAutoPurchase,initMarket,mktUpdate} from './web/js/shop.js';
import {seedRandom,getRandomState,setLegacyRandomState,getLegacyRandomState} from './web/js/utils.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
config.computersBuy=1;config.freeMarket=0;config.teamMode=0;
for(const c of JSON.parse(input)) {
 config.armsLevel=c.restricted?0:4;config.freeMarket=c.market?1:0;
 players.length=2;initMarket();if(c.market)for(let i=0;i<12;i++)mktUpdate();
 config.teamMode=c.team?1:0;resetTeamScores();
 if(c.team)Object.assign(getTeamScore(0),{type:2,cash:c.cash});
 const player={team:0,aiType:c.aiType,cash:c.team?c.personal:c.cash,parachuteArmed:false,inventory:c.inventory.map((_,i)=>i<2?0:i===2?99:c.stock)};
 seedRandom(42);setLegacyRandomState(c.seed);const rng=getRandomState();aiAutoPurchase(player);
 assert.equal(playerCash(player),c.remaining,JSON.stringify(c));
 if(c.team)assert.equal(player.cash,c.personal);
 assert.deepEqual(player.inventory,c.inventory,JSON.stringify(c));
 assert.equal(player.parachuteArmed,c.parachuteArmed,JSON.stringify(c));
 assert.deepEqual(getRandomState(),rng);
 assert.equal(getLegacyRandomState(),c.legacyAfter,JSON.stringify(c));
}
console.log('AI buyers match native cash, inventory, parachute arming, LCG and unchanged R250 across '+JSON.parse(input).length+' cases.');
"""
subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(results),text=True,cwd=root,check=True)
