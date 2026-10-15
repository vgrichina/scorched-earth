"""Compare native G-key selection and guidance HUD pixels with the port."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_state,extract_display_pixels
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p);load_state(args.checkpoint,c,m,p,h)
d=0x4fc80;t=0xd632;inv=m.read16(d+t+0xb2)+16*m.read16(d+t+0xb4)
x=m.read16(d+0xe9fa);right=m.read16(d+0xe9fe);y=m.read16(d+0x518e)+12
cases=[dict(selected=s,mask=mask,status=status) for s in range(32,38) for mask in [0,31,21] for status in [0,1]]
code=r'''
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {initInput} from './web/js/input.js';
import {drawHud} from './web/js/hud.js';
import {pixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
let input='';for await(const chunk of process.stdin)input+=chunk;const s=JSON.parse(input);
Object.assign(config,{screenWidth:360,screenHeight:480,numPlayers:2});createPlayers(2);
s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
const listeners={};globalThis.window={addEventListener:(k,f)=>listeners[k]=f};initInput({addEventListener(){}});
const results=[];for(const c of s.cases){
 const p=players[1];p.guidanceWeapon=c.selected+2;p.inventory.fill(0);
 for(let i=0;i<5;i++)p.inventory[35+i]=c.mask&(1<<i)?3:0;
 Object.assign(game,{state:STATE.AIM,currentPlayer:1});config.statusBar=c.status;
 const before=p.inventory.slice();listeners.keydown({code:'KeyG',key:'g',preventDefault(){}});gameTick();
 listeners.keydown({code:'KeyG',key:'g',repeat:true,preventDefault(){}});gameTick();
 assert.deepEqual(p.inventory,before);assert.equal(game.state,STATE.AIM);
 config.statusBar=1;drawHud(p,0,1);
 const rgb=[];for(let y=s.y;y<s.y+12;y++)for(let x=s.x;x<s.right;x++)rgb.push(...palette6.slice(pixels[y*360+x]*3,pixels[y*360+x]*3+3));
 results.push({selected:p.guidanceWeapon-2,rgb});
}console.log(JSON.stringify(results));
'''
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(dict(cases=cases,x=x,right=right,y=y,palette=extract_state(args.checkpoint)['palette'])),text=True))
for case,port in zip(cases,actual):
 m.write16(d+t+0x9a,case['selected']);m.write16(d+0x5142,1)
 for i in range(5):m.write16(inv+2*(33+i),3 if case['mask']&(1<<i) else 0)
 c.segs[:]=[0,0x2945,0x8000,0x4fc8];c.ip=0x301b2-0x6100-0x29450;c.regs[4]=0x2400
 for j,v in enumerate([0x110,0x60,t,0x4fc8]):m.write16(0x82400+2*j,v)
 reason,_=run_fast(c,m,p,h,1000000,bp_set={0x710});assert reason=='breakpoint'
 m.write16(d+0x5142,case['status']);c.ip=0x2f78a-0x6100-0x29450;c.segs[1]=0x2945;c.regs[4]=0x2400;c.regs[5]=0x2500;m.write16(0x824fe,0x22)
 reason,_=run_fast(c,m,p,h,1000000,bp_set={(0x2f9ca if case['status'] else 0x2faff)-0x6100});assert reason=='breakpoint'
 assert m.read16(d+t+0x9a)==port['selected'],case
 native=extract_display_pixels(m,p)
 rgb=[channel for yy in range(y,y+12) for xx in range(x,right) for channel in p.palette[native[yy*360+xx]]]
 assert rgb==port['rgb'],(case,'guidance HUD RGB differs')
print('36 native G-key scenarios match selection and HUD RGB; repeated keys do not cycle twice or spend inventory.')
