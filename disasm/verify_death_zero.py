#!/usr/bin/env python3
"""Full RGB branch-0 death comparison from an after-falling checkpoint.

Enters native effect 0 directly (selector/scoring/HUD prelude are outside this
fixture). Executes real palette cycling and corpse erasure, stopping before
post-effect dirt settling. Port uses the runtime death queue/rendering.
"""
import argparse,base64,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels,write_emu_png,extract_state
from emu.execute import run_fast
parser=argparse.ArgumentParser()
parser.add_argument('checkpoint')
parser.add_argument('--output-dir',type=Path)
args=parser.parse_args();root=Path(__file__).resolve().parent.parent
state=extract_state(args.checkpoint)
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {createPlayers,players,startDeathAnimation,deathAnimations,stepDeathAnimations,drawDeathAnimations} from './web/js/tank.js';
import {createDeathPaletteCycle} from './web/js/death-effects.js';
import {pixels,getBackgroundColor} from './web/js/framebuffer.js';
import {palette6,setPaletteRgb} from './web/js/palette.js';
import {projectileDrawing} from './web/js/projectile-render.js';
import {seedRandom} from './web/js/utils.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{skyType:2,wallType:0,wind:0,playOrder:0,numPlayers:2});
createPlayers(2);players.forEach((p,i)=>Object.assign(p,{name:s.tanks[i].name,tankType:s.tanks[i].tankType}));
game.round=1;game.initialShop=true;seedRandom(0);game.state=STATE.ROUND_SETUP;gameTick();
const toPort=c=>c>=120&&c<150?c-40:c===80?120:c>=87&&c<=103?c+40:c;
s.palette.forEach((rgb,i)=>setPaletteRgb(toPort(i),...rgb));
const baseline=Uint8Array.from(s.pixels,toPort);
players.forEach((p,i)=>{const t=s.tanks[i];Object.assign(p,{x:t.x,y:t.y,tankType:t.tankType,
 colorIndex:t.colorBase/8,angle:t.direction===1?t.turretAngle:180-t.turretAngle,
 barrelXOff:t.barrelXOff,barrelYOff:t.barrelYOff,barrelEndX:t.barrelEndX,barrelEndY:t.barrelEndY,
 alive:!!t.alive,falling:false,fallingBodyOnly:false,contrastPending:false});});
const victim=players[1];victim.alive=false;
// Clean-world repaint removes the corpse; the runtime death overlay must keep
// it visible during cycling. Other player's pixels remain untouched.
for(let y=victim.y-24;y<=victim.y;y++)for(let x=victim.x-16;x<=victim.x+16;x++){
 const i=y*config.screenWidth+x;if(baseline[i]>=8&&baseline[i]<16)baseline[i]=getBackgroundColor(y,x);
}
startDeathAnimation(victim);deathAnimations[0].effect=0;
deathAnimations[0].cycle=createDeathPaletteCycle(8);
const frames=[];
for(let tick=0;tick<42;tick++){
 pixels.set(baseline);drawDeathAnimations();
 const active=stepDeathAnimations();
 pixels.set(baseline);drawDeathAnimations();projectileDrawing.draw();
 frames.push({pixels:Buffer.from(pixels).toString('base64'),palette:[...palette6]});
 if(!active)break;
}
console.log(JSON.stringify(frames));
'''],cwd=root,input=json.dumps(state),text=True))
ds,stack=0x4FC80,0x5F4A0;tank=0xD632
mem.write16(ds+tank+0x18,0);mem.write16(ds+0xEF46,0)
cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip=0x1DCCE-0x6100-0x17AB0
cpu.regs[5]=0x2400;cpu.regs[4]=0x23D0
mem.write16(stack+0x2406,tank);mem.write16(stack+0x2408,0x4FC8)
cpu.regs[6]=mem.read16(ds+tank+14);cpu.regs[7]=mem.read16(ds+tank+16)
stage=0
for _ in range(200):
 reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={a-0x6100 for a in (0x1DE63,0x104F6,0x4C117)})
 addr=cpu.segs[1]*16+cpu.ip+0x6100
 assert reason=='breakpoint',(reason,hex(addr))
 if addr in (0x104F6,0x1DE63):
  native=extract_display_pixels(mem,ports);frame=actual[stage];port=base64.b64decode(frame['pixels']);pal=frame['palette']
  def to_port(c):return c-40 if 120<=c<150 else 120 if c==80 else c+40 if 87<=c<=103 else c
  mapped=[pal[to_port(i)*3:to_port(i)*3+3] for i in range(256)]
  diffs=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native,port)) if list(ports.palette[n])!=pal[p*3:p*3+3]]
  if args.output_dir:
   args.output_dir.mkdir(parents=True,exist_ok=True)
   for name,pix,colors in [('emulator',native,ports.palette),('port',port,[pal[i:i+3] for i in range(0,768,3)])]:
    write_emu_png(dict(width=360,height=480,pixels=pix,palette=colors),args.output_dir/f'death-zero-{stage:02d}-{name}.png')
  assert not diffs,(stage,len(diffs),diffs[:12])
  stage+=1
 if addr==0x1DE63:break
 sp=stack+cpu.regs[4];cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
else:raise AssertionError('death branch did not finish')
assert stage==len(actual)==41,(stage,len(actual))
print('41 native death-effect-0 RGB frames match runtime corpse rendering, palette cycling and final erasure. Selector and subsequent settling are outside this fixture.')
