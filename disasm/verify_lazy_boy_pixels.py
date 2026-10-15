"""Compare complete synthetic flight framebuffers after native Lazy Boy callbacks.
Original movement and drawing run; raw pixel IO and sky restoration are supplied.
Collision aftermath, real landscapes and launch/modal HUD are outside this test.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;cases=[];w=40;ht=64
for icon in [0,1,2]:
 for trace in [None,110]:
  for wall in [False,True]:
   m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p);load_state(args.checkpoint,c,m,p,h)
   d=0x4fc80;b=0x90000
   fields=[(0xceb8,0),(0xceba,0x9000),(0xe4da,0),(0xeef4,0x100),(0xeef6,0x60),(0xeef8,0x120),(0xeefa,0x60),(0xef42,3),(0xef3c,36),(0xef40,38),(0xef38,60),(0xef3e,39),(0xef26,155),(0xef2c,171),(0x514e,int(icon==2)),(0xe34a,0),(0xe412,0),(0xe4ec,120 if trace is None else trace),(0x1c8a,(0x22a14 if icon==1 else 0x228db)-0x6100-0x1ada0),(0x1c8c,0x1ada)]
   for off,v in fields:m.write16(d+off,v)
   for off,v in [(0,10),(2,45),(0x44,34),(0x46,55),(0x3e,0),(0x40,0),(0x48,0),(0x2a,0xd568),(0x2c,0x4fc8)]:m.write16(b+off,v)
   m.write_float64(b+20,10);m.write_float64(b+28,45);m.write_float64(d+0xceac,.02)
   frame=[120]*(w*ht)
   for y in range(38,ht):
    for x in [1,38]:frame[y*w+x]=171
   for x in range(w):frame[36*w+x]=171
   if wall:
    for y in range(42,60):frame[y*w+18]=80
   frames=[]
   for tick in range(2):
    c.segs[:]=[0,0x1a4a,0x8000,0x4fc8];c.ip=0x24fcf-0x6100-0x1a4a0;c.regs[4]=0x2400;m.write16(0x82400,0x110);m.write16(0x82402,0x60)
    for _ in range(2000):
     reason,detail=run_fast(c,m,p,h,100000,bp_set={0x700,0x710,0x720,0x3ab39-0x6100,0x4c117-0x6100,0x1cdc4-0x6100})
     assert reason=='breakpoint',(icon,trace,wall,reason,detail)
     addr=c.segs[1]*16+c.ip
     if addr==0x710:break
     sp=0x80000+c.regs[4];x=m.read16(sp+4);y=m.read16(sp+6)
     if addr in [0x700,0x720,0x3ab39-0x6100]:
      assert x<w and y<ht,(addr,x,y)
      if addr==0x720:c.regs[0]=frame[y*w+x]
      else:frame[y*w+x]=m.read16(sp+8) if addr==0x700 else 120
     c.ip=m.read16(sp);c.segs[1]=m.read16(sp+2);c.regs[4]+=4
    else:raise AssertionError('callback stuck')
    frames.append(dict(pixels=frame.copy(),x=m.read_float64(b+20),y=m.read_float64(b+28)))
   cases.append(dict(icon=icon,trace=trace,wall=wall,frames=frames))
code=r'''
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {pixels,reinitFramebuffer,setBackground} from './web/js/framebuffer.js';
import {terrainBitmap} from './web/js/terrain.js';
import {projectileDrawing,nativeIndex,drawProjectileTrackingMarks} from './web/js/projectile-render.js';
import {stepLazyBoyProjectile} from './web/js/game.js';
Object.assign(config,{screenWidth:40,screenHeight:64});reinitFramebuffer();setBackground(new Uint8Array(64).fill(80));
let input='';for await(const c of process.stdin)input+=c;
const cases=JSON.parse(input);
for(const c of cases) {
 config.bombIcon=c.icon;projectileDrawing.clear();pixels.fill(80);terrainBitmap.fill(0);
 const border=()=>{for(let y=38;y<64;y++){pixels[y*40+1]=171;pixels[y*40+38]=171;}for(let x=0;x<40;x++)pixels[36*40+x]=171;};border();
 if(c.wall)for(let y=42;y<60;y++){pixels[y*40+18]=120;terrainBitmap[y*40+18]=1;}
 const proj={x:10,y:45,vx:0,vy:0,attackerIdx:0,guidanceTarget:{x:34,y:55},guidanceTargetReference:null,traceColor:c.trace};
 for(const expected of c.frames) {
  assert.equal(stepLazyBoyProjectile(proj),'flying');projectileDrawing.draw();border();
  if(c.icon!==2)drawProjectileTrackingMarks(proj.x,proj.y,c.icon);
  const actual=Array.from(pixels,nativeIndex);
  const diff=actual.flatMap((v,i)=>v===expected.pixels[i]?[]:[[i%40,Math.floor(i/40),v,expected.pixels[i]]]);
  assert.equal(diff.length,0,JSON.stringify({icon:c.icon,trace:c.trace,wall:c.wall,diff:diff.slice(0,15)}));
  assert.equal(proj.x,expected.x);assert.equal(proj.y,expected.y);
 }
}
console.log(`${cases.length*2} complete synthetic Lazy Boy frames and positions match native.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
