"""Compare native first-purchase parachute arming for humans and computers."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;cases=[]
for ai in [0,1,2]:
 for count in [0,1,99]:
  for armed in [0,1]:
   m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
   load_state(args.checkpoint,c,m,p,h);d=0x4fc80;t=0xd568
   inv=m.read16(d+t+0xb2)+16*m.read16(d+t+0xb4);idx=m.read16(d+0xd554)
   m.write16(inv+2*idx,count);m.write16(d+t+0x28,armed);m.write16(d+t+0x22,ai)
   c.segs[:]=[0,0x900,0x8000,0x4fc8];c.ip=0x14924-0x6100-0x9000;c.regs[4]=0x2400
   for j,v in enumerate([0x110,0x60,t,0x4fc8,idx]):m.write16(0x82400+2*j,v)
   for _ in range(10):
    reason,_=run_fast(c,m,p,h,1000000,bp_set={0x710,0x4c117-0x6100})
    assert reason=='breakpoint',reason
    if c.segs[1]*16+c.ip==0x710:break
    sp=c.segs[2]*16+c.regs[4];c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
   else:raise AssertionError('purchase did not return')
   cases.append(dict(ai=ai,count=count,armed=armed,afterCount=m.read16(inv+2*idx),afterArmed=bool(m.read16(d+t+0x28))))
code=r'''
import assert from 'node:assert/strict';
import {createPlayers,players} from './web/js/tank.js';
import {buyWeapon} from './web/js/shop.js';
import {WPN} from './web/js/weapons.js';
let input='';for await(const c of process.stdin)input+=c;
for(const c of JSON.parse(input)){
 createPlayers(1);const p=players[0];Object.assign(p,{cash:50000,aiType:c.ai,parachuteArmed:!!c.armed});
 p.inventory[WPN.PARACHUTE]=c.count;buyWeapon(p,WPN.PARACHUTE);
 assert.equal(p.parachuteArmed,c.afterArmed,JSON.stringify(c));
 assert.equal(p.inventory[WPN.PARACHUTE],c.afterCount,JSON.stringify(c));
}
console.log('18 native parachute purchase arming cases match: human, Moron, other AI; empty, existing and full stock.');
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
