#!/usr/bin/env python3
"""Compare death effects 1..10 or Funky Bomb weapon impacts at native boundaries.
Native callees execute; only sound/input/delay waits are bypassed. Enters a
chosen effect directly, so selection and caller scoring are outside coverage.
"""
import argparse,base64,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels,write_emu_png,extract_state
from emu.execute import run_fast
parser=argparse.ArgumentParser()
parser.add_argument('checkpoint')
parser.add_argument('--effect',type=int,choices=(1,2,3,4,5,6,7,8,9,10),default=1)
parser.add_argument('--output-dir',type=Path)
parser.add_argument('--funky-impact',choices=('terrain','body'),help='Run the Funky Bomb weapon handler instead of a death branch')
parser.add_argument('--sound',action='store_true',help='Enable native sound-device RNG paths')
parser.add_argument('--settle',action='store_true',help='Continue through common post-death dirt settling')
args=parser.parse_args();root=Path(__file__).resolve().parent.parent
if args.funky_impact and args.settle:parser.error('--funky-impact includes inner settling; --settle is for death branches')
label='Funky Bomb '+args.funky_impact+' impact' if args.funky_impact else 'death effect '+str(args.effect)
state=extract_state(args.checkpoint);state['deathEffect']=args.effect;state['settle']=args.settle;state['sound']=args.sound;state['funkyImpact']=args.funky_impact
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
for i,tank_state in enumerate(state['tanks']):
 base=0x4FC80+0xD568+i*0xCA
 value=mem.read16(base+0xA2)+(mem.read16(base+0xA4)<<16)
 tank_state['energy']=value-0x100000000 if value>=0x80000000 else value
 if args.funky_impact:
  tank_state['energy']=100;tank_state['alive']=True
  mem.write16(base+0xA2,100);mem.write16(base+0xA4,0);mem.write16(base+0x18,1)
 tank_state['displayColor']=[mem.read16(base+o) for o in (0x1C,0x1E,0x20)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {drawWindIndicator,drawHudEnergy} from './web/js/hud.js';
import {game,gameTick,STATE,processHit} from './web/js/game.js';
import {createPlayers,players,drawAllTanks,startDeathAnimation,deathAnimations,stepDeathAnimations,drawDeathAnimations} from './web/js/tank.js';
import {isFunkyBombActive,drawFunkyBomb} from './web/js/funky-bomb.js';
import {createDeathPaletteCycle} from './web/js/death-effects.js';
import {pixels,getBackgroundColor} from './web/js/framebuffer.js';
import {palette6,setPaletteRgb} from './web/js/palette.js';
import {projectileDrawing} from './web/js/projectile-render.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
import * as terrain from './web/js/terrain.js';
import {stepTerrainCollapse} from './web/js/terrain-collapse.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{skyType:2,wallType:0,wind:0,playOrder:0,numPlayers:2,soundEnabled:+s.sound});
createPlayers(2);players.forEach((p,i)=>Object.assign(p,{name:s.tanks[i].name,tankType:s.tanks[i].tankType}));
game.round=1;game.initialShop=true;seedRandom(0);game.state=STATE.ROUND_SETUP;gameTick();
const toPort=c=>c>=120&&c<150?c-40:c>=80&&c<=104?c+40:c;
s.palette.forEach((rgb,i)=>setPaletteRgb(toPort(i),...rgb));
const baseline=Uint8Array.from(s.pixels,toPort);
players.forEach((p,i)=>{const t=s.tanks[i];Object.assign(p,{x:t.x,y:t.y,tankType:t.tankType,
 colorIndex:t.colorBase/8,angle:t.direction===1?t.turretAngle:180-t.turretAngle,
 barrelXOff:t.barrelXOff,barrelYOff:t.barrelYOff,barrelEndX:t.barrelEndX,barrelEndY:t.barrelEndY,
 displayColor:t.displayColor,energy:t.energy,power:t.power,alive:!!t.alive,falling:false,fallingBodyOnly:false,contrastPending:false});});
const victim=players[1];if(!s.funkyImpact)victim.alive=false;
// Clean-world repaint removes the corpse; the runtime death overlay must keep
// it visible during cycling. Other player's pixels remain untouched.
if(!s.funkyImpact)for(let y=victim.y-24;y<=victim.y;y++)for(let x=victim.x-16;x<=victim.x+16;x++){
 const i=y*config.screenWidth+x;if(baseline[i]>=8&&baseline[i]<16)baseline[i]=getBackgroundColor(y,x);
}
for(let i=0;i<s.pixels.length;i++)terrain.terrainBitmap[i]=s.pixels[i]>=80&&s.pixels[i]<=104?baseline[i]:0;
if(s.funkyImpact) {
 processHit({x:victim.x,y:victim.y,weaponIdx:7,attackerIdx:1,hitPixel:8,active:true},
   s.funkyImpact==='body'?'hit_tank':'hit_terrain');
} else {
 startDeathAnimation(victim,1,2);deathAnimations[0].effect=s.deathEffect;
 if(s.deathEffect<=5)deathAnimations[0].cycle=createDeathPaletteCycle(8);
}
const frames=[];
const world=()=>{pixels.set(baseline);terrain.drawSky();terrain.drawTerrain();for(let y=0;y<480;y++)for(let x=0;x<360;x++)if(y<38||y>476||x<3||x>356)pixels[y*360+x]=baseline[y*360+x];drawAllTanks();drawWindIndicator(0);if(s.funkyImpact)drawHudEnergy(players[1]);};
for(let tick=0;tick<2000;tick++){
 world();drawDeathAnimations();drawFunkyBomb();
 let active;
 if(s.funkyImpact) {gameTick();active=isFunkyBombActive();}
 else active=stepDeathAnimations();
 world();drawDeathAnimations();projectileDrawing.draw();drawFunkyBomb();
 frames.push({alive:players.map(p=>p.alive),energy:players.map(p=>p.energy),pixels:Buffer.from(pixels).toString('base64'),palette:[...palette6]});
 if(!active)break;
}
if(s.settle)for(let tick=0;tick<2000;tick++){
 world();projectileDrawing.draw();const active=stepTerrainCollapse();
 world();projectileDrawing.draw();
 frames.push({alive:players.map(p=>p.alive),energy:players.map(p=>p.energy),pixels:Buffer.from(pixels).toString('base64'),palette:[...palette6]});
 if(!active)break;
}
frames.at(-1).rng=getRandomState();console.log(JSON.stringify(frames));
'''],cwd=root,input=json.dumps(state),text=True))
ds,stack=0x4FC80,0x5F4A0;tank=0xD632
if not args.funky_impact:mem.write16(ds+tank+0x18,0)
mem.write16(ds+0xEF46,int(args.sound))
cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip={1:0x1DCF5,2:0x1DD0A,3:0x1DD37,4:0x1DD95,5:0x1DDB0,6:0x1DDC9,7:0x1DDEE,8:0x1DE12,10:0x1DE29,9:0x1DE20}[args.effect]-0x6100-0x17AB0
cpu.regs[5]=0x2400;cpu.regs[4]=0x23D0
mem.write16(stack+0x2406,tank);mem.write16(stack+0x2408,0x4FC8)
cpu.regs[6]=mem.read16(ds+tank+14);cpu.regs[7]=mem.read16(ds+tank+16)
if args.funky_impact:
 mem.write16(ds+0xE344,5)
 mem.write16(ds+0xE1E4,tank if args.funky_impact=='body' else 0)
 mem.write16(ds+0xE1E6,0x4FC8 if args.funky_impact=='body' else 0)
 mem.write16(ds+0xE1E8,0)
 cpu.segs[:]=[0,0x1E5E,0x5F4A,0x4FC8];cpu.ip=0;cpu.regs[4]=0x2400
 for i,v in enumerate([0x110,0x60,mem.read16(ds+tank+14),mem.read16(ds+tank+16)]):mem.write16(stack+0x2400+i*2,v)
stage=0;budgets=0;particle_iterations=0
for _ in range(10000):
 reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={a-0x6100 for a in (0x6810,0x24882,0x24C2F,0x1CC85,0x2C011,0x2C12E,0x2C1A1,0x3B132,0x3B1E1,0x2ECCE,0x2ECEC,0x2F07B,0x1DE63,0x1DE68,0x1E222,0x104F6,0x10C81,0x4C278,0x4C117,0x28A80,0x43DDD,0x43E2E,0x43E71,0x43F69,0x20EA2)})
 addr=cpu.segs[1]*16+cpu.ip+0x6100
 if reason=='max_steps':
  budgets+=1
  assert budgets<100,('native death instruction budget',hex(addr))
  continue
 budgets=0
 assert reason=='breakpoint',(reason,hex(addr))
 if addr==0x2ECCE:
  # Execute one native update per observation, satisfying its 30-tick gate.
  # This verifies update frames, not elapsed wall-clock timing.
  mem.write16(ds+0xEE78,(mem.read16(stack+cpu.regs[5]-20)+30)&65535)
  run_fast(cpu,mem,ports,handler,1);continue
 if addr==0x2ECEC:
  particle_iterations+=1;run_fast(cpu,mem,ports,handler,1);continue
 sp=stack+cpu.regs[4]
 caller=mem.read16(sp+2)*16+mem.read16(sp)+0x6100
 capture=(addr==0x2F07B and particle_iterations>0 and bool(mem.read16(stack+cpu.regs[5]-18))) or addr in (0x6810,0x24882,0x24C2F,0x1CC85,0x2C011,0x2C12E,0x2C1A1,0x3B132,0x3B1E1,0x1DE63,0x1DE68,0x1E222,0x43DDD,0x43E2E,0x43E71,0x43F69,0x20EA2) or (addr==0x104F6 and caller in (0x1DFBE,0x1DD2E,0x1DD5B,0x1DD73,0x24288,0x242B2,0x1C5F5,0x24BC7))
 # The sound-enabled palette prelude calls sound_on instead of delay.
 capture |= addr==0x10C81 and caller==0x1DFB5
 if capture:
  native=extract_display_pixels(mem,ports);frame=actual[stage];port=base64.b64decode(frame['pixels']);pal=frame['palette']
  def to_port(c):return c-40 if 120<=c<150 else c+40 if 80<=c<=104 else c
  mapped=[pal[to_port(i)*3:to_port(i)*3+3] for i in range(256)]
  diffs=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native,port)) if list(ports.palette[n])!=pal[p*3:p*3+3]]
  if args.output_dir:
   args.output_dir.mkdir(parents=True,exist_ok=True)
   for name,pix,colors in [('emulator',native,ports.palette),('port',port,[pal[i:i+3] for i in range(0,768,3)])]:
    write_emu_png(dict(width=360,height=480,pixels=pix,palette=colors),args.output_dir/f'{"funky-"+args.funky_impact if args.funky_impact else "death-"+str(args.effect)}-{stage:03d}-{name}.png')
  assert not diffs,(stage,len(diffs),[(x,y,n,p,list(ports.palette[n]),pal[p*3:p*3+3]) for x,y,n,p in diffs[:12]])
  print(f'{label}, frame {stage}, native {addr:#x}: RGB matches.',flush=True)
  stage+=1
 if addr==0x6810:break
 if addr in (0x24882,0x24C2F,0x2C011,0x2C12E,0x2C1A1,0x3B132,0x3B1E1):
  run_fast(cpu,mem,ports,handler,1);continue
 if addr==0x2F07B:
  run_fast(cpu,mem,ports,handler,1);continue
 if addr==0x1DE68:break
 if addr==0x1DE63:
  if not args.settle:break
  run_fast(cpu,mem,ports,handler,1);continue
 if addr in (0x1E222,0x1CC85):cpu.ip+=5;continue
 if addr in (0x43DDD,0x43E2E,0x43E71):
  cpu.regs[4]+={0x43DDD:12,0x43E2E:4,0x43E71:4}[addr];cpu.ip+=3;continue
 if addr in (0x43F69,0x20EA2):
  run_fast(cpu,mem,ports,handler,1);continue
 if addr==0x28A80:cpu.regs[0]=0x80
 sp=stack+cpu.regs[4];cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
else:raise AssertionError('death branch did not finish')
assert stage==len(actual),(stage,len(actual))
energies=[]
for i in range(2):
 base=ds+0xD568+i*0xCA
 value=mem.read16(base+0xA2)+(mem.read16(base+0xA4)<<16)
 energies.append(value-0x100000000 if value>=0x80000000 else value)
assert actual[-1]['energy']==energies,(actual[-1]['energy'],energies)
assert actual[-1]['alive']==[bool(mem.read16(ds+0xD568+i*0xCA+0x18)) for i in range(2)]
expected_rng=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
assert actual[-1]['rng']==expected_rng,'final RNG differs'
label='Funky Bomb '+args.funky_impact+' impact' if args.funky_impact else 'death effect '+str(args.effect)
boundary='weapon handler return' if args.funky_impact else 'post-death settling' if args.settle else 'branch completion'
print(f'{label}: {stage} RGB frames, signed HP, alive flags and complete RNG match through {boundary}.')
