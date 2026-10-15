#!/usr/bin/env python3
"""Compare real native/port Done activation around all edges at 360x480.

Native exits are identified at interest crediting; outside clicks must remain
in the input loop for 121 mouse polls. This is activation, not pixel/timing proof.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
points=[(x,y) for x in (249,250,310,311) for y in (101,102,120,121)]
points += [(275,y) for y in (101,102,120,121)]+[(x,110) for x in (249,250,310,311)]
cases=[dict(x=x,y=y,button=button) for button in (1,2) for x,y in points]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import fs from 'node:fs';
import {players,createPlayers} from './web/js/tank.js';
import {openShop,shopTick,isShopActive} from './web/js/shop.js';
import {initInput,mouse} from './web/js/input.js';
const events={};globalThis.window={addEventListener(){}};
initInput({addEventListener(name,callback){events[name]=callback;},
 getBoundingClientRect(){return {left:0,top:0,width:360,height:480};}});
createPlayers(2);players[0].aiType=0;
console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(c=>{
 mouse.buttons=mouse.clicked=0;openShop(0,10,{showPrivacy:false});
 const e={button:c.button===1?0:2,clientX:c.x,clientY:c.y,preventDefault(){}};
 events.mouseenter();events.mousemove(e);events.mousedown(e);
 const done=shopTick(players[0]);events.mouseup(e);
 if(done===isShopActive())throw Error('Completion and active state disagree');
 return done;
})));
'''],input=json.dumps(cases),text=True,cwd=root))
for case,port in zip(cases,actual):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h)
 exit_point=0x176dd-0x6100
 stops={exit_point,0x4bda3-0x6100,0x4be8c-0x6100,0x4c117-0x6100}
 native=False
 for tick in range(121):
  reason,_=run_fast(c,m,p,h,1000000,bp_set=stops)
  assert reason=='breakpoint',(case,reason)
  address=c.segs[1]*16+c.ip
  if address==exit_point:native=True;break
  sp=c.segs[2]*16+c.regs[4]
  if address==0x4bda3-0x6100 and (m.read16(sp+4) or m.read16(sp+6)):
   for i,v in enumerate((case['x'],case['y'])):
    m.write16(m.read16(sp+4+i*4)+16*m.read16(sp+6+i*4),v)
  c.regs[0]=case['button'] if tick<60 else 0
  c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
 assert native==port,(case,native,port)
print(f'{len(cases)} Done edge/corner/outside activations match native for both buttons.')
