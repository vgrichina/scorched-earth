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
cases=[dict(count=n,armed=a,toggle=t,status=st) for n in (0,1,2,9,10,99)
 for a in (False,True) for t in (False,True) for st in (0,1)]
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
ds,stack,tank=0x4FC80,0x5F4A0,0xD632
x=mem.read16(ds+0xE9FE);right=mem.read16(ds+0xEA02);y=mem.read16(ds+0x518E)+12
state=extract_state(args.checkpoint)
assert state['width']==360 and state['height']==480
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {WPN} from './web/js/weapons.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {initInput} from './web/js/input.js';
import {createPlayers,players} from './web/js/tank.js';
import {drawHud} from './web/js/hud.js';
import {pixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{screenWidth:360,screenHeight:480,numPlayers:2});createPlayers(2);
s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
const p=players[1],results=[];
const listeners={};globalThis.window={addEventListener:(k,f)=>listeners[k]=f};
initInput({addEventListener(){}});
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
  listeners.keydown({code:'Minus',key:'-',preventDefault(){}});gameTick();
  listeners.keydown({code:'Minus',key:'-',repeat:true,preventDefault(){}});gameTick();
 }
 config.statusBar=1;
 drawHud(p,0,1);
 const result={rgb:crop(),armed:p.contactTriggerArmed,count:p.inventory[WPN.CONTACT_TRIGGER]};
 listeners.keydown({code:'Space',key:' ',preventDefault(){}});gameTick();drawHud(p,0,1);
 result.firedRgb=crop();
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
  cpu.regs[4]=0x2400;cpu.regs[5]=0x2500;mem.write16(stack+0x24FE,0x0C)
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
 assert rgb==port['firedRgb'],(case,'Contact Trigger pixels changed at firing')
 mem.write16(ds+0x5142,1)
 invoke(0x301B2,[tank,0x4FC8])
 native=extract_display_pixels(mem,ports)
 rgb=[channel for yy in range(y,y+12) for xx in range(x,right) for channel in ports.palette[native[yy*360+xx]]]
 assert rgb==port['refreshedRgb'],(case,'Contact Trigger full refresh differs')
print(f'{len(cases)} native Contact Trigger scenarios match before firing, retained at launch, and after full HUD refresh ({len(cases)*3} RGB crops).')
