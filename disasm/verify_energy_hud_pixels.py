#!/usr/bin/env python3
"""Compare native energy-field drawing with the port's actual HUD renderer.
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
cases=[dict(energy=e,maxEnergy=m) for m in (50,100,200) for e in (-6,0,1,6,20,49,50,99,100,101,200)]
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
ds,stack,tank=0x4FC80,0x5F4A0,0xD632
x=mem.read16(ds+0xE9D6);right=mem.read16(ds+0xE9D8);y=mem.read16(ds+0x518E)+12
state=extract_state(args.checkpoint)
assert state['width']==360 and state['height']==480
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {drawHud} from './web/js/hud.js';
import {pixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{screenWidth:360,screenHeight:480,numPlayers:2});createPlayers(2);
s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
const p=players[1],results=[];
for(const c of s.cases){
 Object.assign(p,{...c,power:200,hudEnergy:undefined,colorIndex:1});
 drawHud(p,0,1);
 const rgb=[];for(let y=s.y;y<s.y+12;y++)for(let x=s.x;x<s.right;x++){
  const color=pixels[y*360+x];rgb.push(...palette6.slice(color*3,color*3+3));
 }
 results.push({rgb});
}
console.log(JSON.stringify(results));
'''],cwd=root,input=json.dumps(dict(cases=cases,palette=state['palette'],x=x,right=right,y=y)),text=True))

def invoke(address,arguments):
 cpu.segs[:]=[0,0x2AA6,0x5F4A,0x4FC8];cpu.ip=address-0x6100-0x2AA60;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,*arguments]):mem.write16(stack+0x2400+i*2,v&65535)
 reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x710})
 assert reason=='breakpoint',(hex(address),reason)

for case,port in zip(cases,actual):
 for off,value in ((0x50D6,1),(0x5142,1),(0x5188,0),(0x5182,tank),(0x5184,0x4FC8),
  (tank+0xA6,case['maxEnergy']),(tank+0xA8,0)):
  mem.write16(ds+off,value)
 mem.write16(ds+tank+0xA2,case['energy']&65535)
 mem.write16(ds+tank+0xA4,65535 if case['energy']<0 else 0)
 invoke(0x318D8,[tank,0x4FC8])
 native=extract_display_pixels(mem,ports)
 rgb=[channel for yy in range(y,y+12) for xx in range(x,right) for channel in ports.palette[native[yy*360+xx]]]
 assert rgb==port['rgb'],(case,'energy-field RGB differs')
print(f'{len(cases)} native energy-field RGB crops match across signed HP and three maximum-energy values.')
