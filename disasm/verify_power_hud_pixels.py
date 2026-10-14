#!/usr/bin/env python3
"""Compare retained/refreshed power-field RGB against real native drawing.
Uses a 360x480 checkpoint for VGA/font setup. Only the power-field crop is
compared; this is not a complete HUD or shot-sequence verification.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels,extract_state
from emu.execute import run_fast
parser=argparse.ArgumentParser()
parser.add_argument('checkpoint')
args=parser.parse_args();root=Path(__file__).resolve().parent.parent
cases=[dict(energy=e,power=p) for e in (-6,0,6,20,55,100) for p in (0,200,1000)]
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
ds,stack,tank=0x4FC80,0x5F4A0,0xD632
x=mem.read16(ds+0xE9D6);right=mem.read16(ds+0xE9D8);y=mem.read16(ds+0x518E)
state=extract_state(args.checkpoint)
assert state['width']==360 and state['height']==480
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players,updateTankDamageState} from './web/js/tank.js';
import {drawHud} from './web/js/hud.js';
import {pixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{screenWidth:360,screenHeight:480,numPlayers:2});createPlayers(2);
s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
const p=players[1],results=[];
for(const c of s.cases){
 Object.assign(p,{...c,maxEnergy:100,hudPower:777,colorIndex:1});
 updateTankDamageState(p);drawHud(p,0,1);
 const rgb=[];for(let y=s.y;y<s.y+12;y++)for(let x=s.x;x<s.right;x++){
  const color=pixels[y*360+x];rgb.push(...palette6.slice(color*3,color*3+3));
 }
 results.push({power:p.power,rgb});
}
console.log(JSON.stringify(results));
'''],cwd=root,input=json.dumps(dict(cases=cases,palette=state['palette'],x=x,right=right,y=y)),text=True))

def invoke(address,arguments):
 cpu.segs[:]=[0,0x2AA6,0x5F4A,0x4FC8];cpu.ip=address-0x6100-0x2AA60;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,*arguments]):mem.write16(stack+0x2400+i*2,v&65535)
 reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x710})
 assert reason=='breakpoint',(hex(address),reason)

for case,port in zip(cases,actual):
 # Seed a visible 777 independently of stored power, reproducing a retained
 # HUD field after an earlier damage operation suppressed its refresh.
 for off,value in ((0x50D6,1),(0x5188,0),(0x5182,tank),(0x5184,0x4FC8),
  (tank+0x9C,1000),(tank+0x9E,0),(tank+0xA6,100),(tank+0xA8,0)):
  mem.write16(ds+off,value)
 invoke(0x316CE,[tank,0x4FC8,777])
 mem.write16(ds+tank+0x9E,case['power'])
 mem.write16(ds+tank+0xA2,case['energy']&65535)
 mem.write16(ds+tank+0xA4,65535 if case['energy']<0 else 0)
 invoke(0x31663,[tank,0x4FC8])
 native=extract_display_pixels(mem,ports)
 rgb=[channel for yy in range(y,y+12) for xx in range(x,right) for channel in ports.palette[native[yy*360+xx]]]
 assert rgb==port['rgb'],(case,'power-field RGB differs')
 assert mem.read16(ds+tank+0x9E)==port['power'],(case,'stored power differs')
print(f'{len(cases)} native power-field RGB crops and stored powers match, including retained 777 displays and lethal/nonlethal clamping.')
