#!/usr/bin/env python3
"""Native shield activation/prelaunch inventory vs E then Space in the port.

Uses initialized inventory mappings. Stops native immediately before the
launch call, so this checks firing setup, not the projectile flight or pixels.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser();parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
cases=[dict(shield=s,stock=n,trigger=t,armed=a) for s in range(6)
 for n in (0,1,3) for t,a in ((0,False),(1,False),(3,False),(1,True),(3,True))]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {initInput} from './web/js/input.js';
import {projectiles} from './web/js/physics.js';
import {WPN} from './web/js/weapons.js';
import {shieldActivation,stepShieldActivation} from './web/js/shield-activation.js';
const listeners={};globalThis.window={addEventListener:(k,f)=>listeners[k]=f};
initInput({addEventListener(){}});Object.assign(config,{talkingTanks:0,soundEnabled:0});
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 createPlayers(2);const p=players[0];p.inventory.fill(0);p.inventory[WPN.BABY_MISSILE]=-1;
 Object.assign(p,{x:100,y:200,activeShield:0,selectedShield:c.shield,shieldEnergy:0,
   contactTriggerArmed:false,shieldFlightUses:123});
 p.inventory[WPN.SUPER_MAG]=c.stock;p.inventory[WPN.CONTACT_TRIGGER]=c.trigger;
 if(c.shield)p.inventory[WPN.MAG_DEFLECTOR+c.shield-1]++;
 Object.assign(game,{state:STATE.AIM,currentPlayer:0});
 if(c.armed){listeners.keydown({code:'Minus',key:'-',preventDefault(){}});gameTick();}
 listeners.keydown({code:'KeyE',key:'e',preventDefault(){}});gameTick();
 while(shieldActivation.active)stepShieldActivation();
 listeners.keydown({code:'Space',key:' ',preventDefault(){}});gameTick();
 if(game.state!==STATE.FLIGHT||projectiles.length!==1)throw new Error('Space did not launch');
 return {stock:p.inventory[WPN.SUPER_MAG],trigger:p.inventory[WPN.CONTACT_TRIGGER],
   armed:p.contactTriggerArmed,flag:projectiles[0].contactTriggerActive,
   shield:p.activeShield,energy:p.shieldEnergy,uses:p.shieldFlightUses};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
ds,stack,tank=0x4FC80,0x5F4A0,0xD568
inventory=mem.read16(ds+tank+0xB2)+mem.read16(ds+tank+0xB4)*16
assert mem.read16(ds+0xD566)==47
for case,port in zip(cases,actual):
 cfg=0x616C+case['shield']*16
 for off,value in ((0x519A,65535),(0x5118,0),(0x5182,tank),(0x5184,0x4FC8),
   (0xEF46,0),(0x1C18,0),(0x5142,1),(0xE1DE,cfg),(0xE1E0,0x4FC8),
   (0xE344,0),(tank+0x22,0),(tank+0x2A,0),
   (tank+0x9A,mem.read16(ds+0xD548)),(tank+0xC6,0x616C),(tank+0xC8,0x4FC8),
   (tank+0x96,0),(tank+0x98,123)):
  mem.write16(ds+off,value)
 mem.write16(inventory+44*2,case['stock']);mem.write16(inventory+47*2,case['trigger'])
 if case['shield']:
  item=mem.read16(ds+cfg+14)
  mem.write16(inventory+item*2,(case['stock'] if item==44 else 0)+1)
 cpu.segs[:]=[0,0x2945,0x5F4A,0x4FC8];cpu.ip=0x2F78A-0x6100-0x29450
 if case['armed']:
  cpu.regs[4]=0x2400;cpu.regs[5]=0x2500;mem.write16(stack+0x24FE,0x0C)
  reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={0x2F8B6-0x6100})
  assert reason=='breakpoint',('arming',case,reason)
  cpu.segs[:]=[0,0x2945,0x5F4A,0x4FC8];cpu.ip=0x2F78A-0x6100-0x29450
 cpu.regs[4]=0x2400;cpu.regs[5]=0x2500;mem.write16(stack+0x24FE,0x12)
 reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={0x2F98F-0x6100})
 assert reason=='breakpoint',('activation',case,reason)
 cpu.segs[:]=[0,0x2945,0x5F4A,0x4FC8];cpu.ip=0x30652-0x6100-0x29450;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={0x30769-0x6100})
 assert reason=='breakpoint',reason
 native=dict(stock=mem.read16(inventory+44*2),trigger=mem.read16(inventory+47*2),
   armed=bool(mem.read16(ds+tank+0x2A)),flag=bool(mem.read16(ds+0x1C76)),
   shield=(mem.read16(ds+tank+0xC6)-0x616C)//16,energy=mem.read16(ds+tank+0x96),uses=mem.read16(ds+tank+0x98))
 assert native==port,(case,native,port)
print(f'{len(cases)} native activation-to-prelaunch inventory/flag cases match E then Space in the port; Super Mag stock and active shield energy/reserve remain unchanged when firing.')
