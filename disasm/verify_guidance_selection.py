"""Compare native guidance cycling and firing selection/ammo with the port."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;cases=[];d=0x4fc80;t=0xd632
for selected in range(32,38):
 for stock in [0,1,3]:
  for mode in [0,1,2]:
   # Sequential non-Heat guidance enters a target-selection dialog. Its
   # interaction/trajectory needs a separate composed verifier.
   if mode==0 and selected==34 and stock>0:continue
   targeting=mode==0 and selected>=35 and stock>0
   m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
   load_state(args.checkpoint,c,m,p,h)
   inv=m.read16(d+t+0xb2)+16*m.read16(d+t+0xb4)
   for i in range(48):m.write16(inv+2*i,99 if i==0 else stock)
   for off,value in [(0x5182,t),(0x5184,0x4fc8),(0x5188,mode),(0x5118,0),(0x5142,0),(0xe344,0),(t+0x22,0),(t+0x2a,0),(t+0x9a,selected)]:m.write16(d+off,value)
   def call(address,stop):
    c.segs[:]=[0,0x2945,0x8000,0x4fc8];c.ip=address-0x6100-0x29450;c.regs[4]=0x2400
    for j,v in enumerate([0x110,0x60]):m.write16(0x82400+2*j,v)
    reason,detail=run_fast(c,m,p,h,3000000,bp_set={stop})
    assert reason=='breakpoint',(selected,stock,mode,reason,detail,hex(c.segs[1]*16+c.ip+0x6100))
   call(0x30af0,0x710);cycled=m.read16(d+t+0x9a)
   m.write16(d+t+0x9a,selected)
   call(0x30652,(0x11192 if targeting else 0x30769)-0x6100)
   cases.append(dict(targeting=targeting,selected=selected+2,stock=stock,mode=mode,cycled=cycled+2,afterSelected=m.read16(d+t+0x9a)+2,used=m.read16(d+0xe4ee),inventory=[0,0]+[m.read16(inv+2*i) for i in range(48)]))
code=r'''
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {cycleGuidance} from './web/js/behaviors.js';
import {initInput} from './web/js/input.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {projectiles,clearProjectiles} from './web/js/physics.js';
const listeners={};globalThis.window={addEventListener:(k,f)=>listeners[k]=f};initInput({addEventListener(){}});
let input='';for await(const chunk of process.stdin)input+=chunk;
for(const c of JSON.parse(input)){
 config.playMode=c.mode;config.talkingTanks=0;config.numPlayers=2;createPlayers(2);clearProjectiles();
 const p=players[1];p.inventory=c.inventory.map((_,i)=>i<2?0:i===2?99:c.stock);p.guidanceWeapon=c.selected;
 cycleGuidance(p);assert.equal(p.guidanceWeapon,c.cycled,JSON.stringify(c));
 p.guidanceWeapon=c.selected;Object.assign(game,{state:STATE.AIM,currentPlayer:1});
 listeners.keydown({code:'Space',key:' ',preventDefault(){}});gameTick();
 assert.equal(game.state,c.targeting?STATE.GUIDANCE_TARGET:STATE.FLIGHT);
 assert.equal(p.guidanceWeapon,c.afterSelected,JSON.stringify(c));
 assert.deepEqual(p.inventory,c.inventory,JSON.stringify(c));
 if(c.targeting) assert.equal(projectiles.length,0);
 else assert.equal(projectiles[0].guidanceType??0,c.used===32?0:c.used+2,JSON.stringify(c));
 listeners.keyup({code:'Space',preventDefault(){}});
}
console.log('52 native guidance cycling/firing/modal-entry cases match selection, inventory and launch guidance across all three play modes.');
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
