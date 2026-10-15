#!/usr/bin/env python3
"""Compare native Contact Trigger count/icon drawing with the port's actual HUD renderer.
Uses real native palette, formatting, clearing and glyph drawing from a
360x480 checkpoint. Compares the field crop, not the full HUD or gameplay.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels,extract_state
from emu.execute import run_fast
parser=argparse.ArgumentParser()
parser.add_argument('checkpoint')
args=parser.parse_args();root=Path(__file__).resolve().parent.parent
cases=[dict(count=n,armed=a,toggle=True,status=1,button=b,x=x,y=y) for n in (0,1)
 for a in (False,True) for b in (1,2) for x,y in ((258,17),(290,28))]
cases += [dict(count=n,armed=a,toggle=True,status=1,button=2,x=x,y=y) for n in (0,1)
 for a in (False,True) for x,y in ((295,17),(335,28))]
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
ds,stack,tank=0x4FC80,0x5F4A0,0xD632
x=mem.read16(ds+0xE9FE);right=mem.read16(ds+0xEA02);y=mem.read16(ds+0x518E)+12
state=extract_state(args.checkpoint)
assert state['width']==360 and state['height']==480
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {WPN} from './web/js/weapons.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {initInput} from './web/js/input.js';
import {createPlayers,players} from './web/js/tank.js';
import {drawHud,contactTriggerHudContains} from './web/js/hud.js';
import {pixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{screenWidth:360,screenHeight:480,numPlayers:2});createPlayers(2);
s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
const p=players[1],results=[];
const listeners={};globalThis.window={addEventListener:(k,f)=>listeners[k]=f};
const mouseListeners={};
initInput({addEventListener:(k,f)=>mouseListeners[k]=f,getBoundingClientRect:()=>({left:0,top:0,width:360,height:480})});
for(let y=16;y<=29;y++)for(let x=257;x<=291;x++)
 assert.equal(contactTriggerHudContains(x,y),x>=258&&x<=290&&y>=17&&y<=28);
for(let y=16;y<=29;y++)for(let x=294;x<=336;x++) {
 assert.equal(contactTriggerHudContains(x,y,2),x>=295&&x<=335&&y>=17&&y<=28);
 assert.equal(contactTriggerHudContains(x,y,0),false);
}
function crop(){
 const rgb=[];for(let y=s.y;y<s.y+12;y++)for(let x=s.x;x<s.right;x++){
  const color=pixels[y*360+x];rgb.push(...palette6.slice(color*3,color*3+3));
 }return rgb;
}
for(const c of s.cases){
 Object.assign(p,{contactTriggerArmed:c.armed,colorIndex:1,
   hudContactTriggerCount:undefined,hudContactTriggerArmed:undefined});
 p.inventory[WPN.CONTACT_TRIGGER]=c.count;
 Object.assign(game,{state:STATE.AIM,currentPlayer:1});config.statusBar=c.status;
 if(c.toggle){
  const e={clientX:c.x,clientY:c.y,button:c.button===1?0:2,preventDefault(){}};
  const angle=p.angle,power=p.power;
  mouseListeners.mouseenter();mouseListeners.mousemove(e);mouseListeners.mousedown(e);gameTick();mouseListeners.mouseup(e);
  assert.equal(game.state,STATE.AIM);assert.equal(p.angle,angle);assert.equal(p.power,power);

 }
 config.statusBar=1;
 drawHud(p,0,1);
 const result={rgb:crop(),armed:p.contactTriggerArmed,count:p.inventory[WPN.CONTACT_TRIGGER]};
 listeners.keydown({code:'Space',key:' ',preventDefault(){}});gameTick();drawHud(p,0,1);
 result.firedRgb=crop();result.debug={count:p.inventory[WPN.CONTACT_TRIGGER],hud:p.hudContactTriggerCount,armed:p.contactTriggerArmed,state:game.state};
 // NEXT_TURN reset is exercised separately by verify_next_player.py.
 p.hudContactTriggerCount=undefined;p.hudContactTriggerArmed=undefined;
 drawHud(p,0,1);result.refreshedRgb=crop();results.push(result);
}
console.log(JSON.stringify(results));
'''],cwd=root,input=json.dumps(dict(cases=cases,palette=state['palette'],x=x,right=right,y=y)),text=True))

def invoke(address,arguments,stop=0x710):
 cpu.segs[:]=[0,0x2945,0x5F4A,0x4FC8];cpu.ip=address-0x6100-0x29450;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,*arguments]):mem.write16(stack+0x2400+i*2,v&65535)
 reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={stop})
 assert reason=='breakpoint',(hex(address),reason)

inventory=mem.read16(ds+tank+0xB2)+mem.read16(ds+tank+0xB4)*16
for case,port in zip(cases,actual):
 for off,value in ((0x5142,1),(0x5188,0),(tank+0x2A,int(case['armed']))):
  mem.write16(ds+off,value)
 mem.write16(inventory+mem.read16(ds+0xD566)*2,case['count'])
 invoke(0x301B2,[tank,0x4FC8])
 if case['toggle']:
  mem.write16(ds+0x5142,case['status']);mem.write16(ds+0xEF46,0)
  cpu.segs[:]=[0,0x2945,0x5F4A,0x4FC8];cpu.ip=0x2F78A-0x6100-0x29450
  cpu.regs[4]=0x2400;cpu.regs[5]=0x2500
  # Execute native hit-region scanning before dispatching its resulting key.
  cpu.ip=0x2F68C-0x6100-0x29450
  for off,value in ((0x24FE,0),(0x24F8,case['x']),(0x24F6,case['y']),(0x24F4,case['button'])):mem.write16(stack+off,value)
  reason,_=run_fast(cpu,mem,ports,handler,10000,bp_set={0x2F6F2-0x6100})
  assert reason=='breakpoint' and mem.read16(stack+0x24FE)==0x0C
  cpu.ip=0x2F78A-0x6100-0x29450
  reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={(0x2F8B6 if case['status'] else 0x2FAFF)-0x6100})
  assert reason=='breakpoint',reason
 assert port['armed']==bool(mem.read16(ds+tank+0x2A))
 assert port['count']==case['count']==mem.read16(inventory+mem.read16(ds+0xD566)*2)
 native=extract_display_pixels(mem,ports)
 rgb=[channel for yy in range(y,y+12) for xx in range(x,right) for channel in ports.palette[native[yy*360+xx]]]
 assert rgb==port['rgb'],(case,'Contact Trigger count/icon RGB differs')
 for off,value in ((0xE344,0),(0x5118,0),(tank+0x22,0),(tank+0x9A,mem.read16(ds+0xD548))):mem.write16(ds+off,value)
 invoke(0x30652,[],0x30769-0x6100)
 native=extract_display_pixels(mem,ports)
 rgb=[channel for yy in range(y,y+12) for xx in range(x,right) for channel in ports.palette[native[yy*360+xx]]]
 assert rgb==port['firedRgb'],(case,port['debug'],'Contact Trigger pixels changed at firing',[(x+(i//3)%(right-x),y+(i//3)//(right-x),a,b) for i,(a,b) in enumerate(zip(rgb,port['firedRgb'])) if a!=b][:12])
 mem.write16(ds+0x5142,1)
 invoke(0x301B2,[tank,0x4FC8])
 native=extract_display_pixels(mem,ports)
 rgb=[channel for yy in range(y,y+12) for xx in range(x,right) for channel in ports.palette[native[yy*360+xx]]]
 assert rgb==port['refreshedRgb'],(case,'Contact Trigger full refresh differs')
print(f'{len(cases)} native mouse Contact Trigger scenarios match before firing, retained at launch, and after full HUD refresh ({len(cases)*3} RGB crops).')
