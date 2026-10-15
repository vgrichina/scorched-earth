"""Execute native falling arming guards and compare the port's falling behavior."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
cases=[]
for armed in [0,1]:
 for count in [-1,0,1,8]:
  for energy in [0,100]:
   m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
   load_state(args.checkpoint,c,m,p,h)
   d=0x4fc80;tank=0xd568;inventory=m.read16(d+tank+0xb2)+16*m.read16(d+tank+0xb4)
   slot=inventory+2*m.read16(d+0xd554)
   m.write16(slot,count&65535);m.write16(d+tank+0x28,armed)
   m.write16(d+tank+0xa2,energy);m.write16(d+tank+0xa4,0)
   c.segs[:]=[0x4fc8,0x1a05,0x8000,0x4fc8];c.ip=0x20871-0x6100-0x1a050
   c.regs[3]=tank;c.regs[4]=0x2400;c.regs[5]=0x2500
   m.write16(0x824fc,tank);m.write16(0x824fe,0x4fc8)
   reason,_=run_fast(c,m,p,h,10000,bp_set={0x208ca-0x6100,0x20919-0x6100})
   assert reason=='breakpoint',reason
   value=m.read16(slot);value=value if value<32768 else value-65536
   cases.append(dict(armed=armed,count=count,energy=energy,eligible=c.segs[1]*16+c.ip==0x208ca-0x6100,afterArmed=bool(m.read16(d+tank+0x28)),afterCount=value))
code=r'''
import assert from 'node:assert/strict';
import {createPlayers,players,stepFallingTanks} from './web/js/tank.js';
import {config} from './web/js/config.js';
import {pixels,setPixel} from './web/js/framebuffer.js';
import {WPN} from './web/js/weapons.js';
let input='';for await(const c of process.stdin)input+=c;
for(const c of JSON.parse(input)){
 createPlayers(1);config.numPlayers=1;pixels.fill(80);
 for(let x=0;x<config.screenWidth;x++)setPixel(x,100,120);
 const p=players[0];Object.assign(p,{x:50,y:44,falling:true,energy:c.energy,parachuteArmed:!!c.armed});
 p.inventory.fill(0);p.inventory[WPN.PARACHUTE]=c.count;
 stepFallingTanks();
 assert.equal(p.parachuteDeployed,c.eligible,JSON.stringify(c));
 assert.equal(p.parachuteArmed,c.afterArmed,JSON.stringify(c));
 assert.equal(p.inventory[WPN.PARACHUTE],c.afterCount,JSON.stringify(c));
}
console.log('16 native parachute arming guards match port falling behavior, including empty stock and zero health.');
'''
subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(cases),text=True,cwd=root,check=True)
