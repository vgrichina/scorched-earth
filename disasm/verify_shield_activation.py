#!/usr/bin/env python3
"""Compare native E-key activation frames against the retained-frame port.

Imports only the pre-activation framebuffer/palette from a gameplay checkpoint.
Native shape, palette fade, inventory mutation and HUD execute normally;
Only the PIT busy-wait is intercepted; progress and sound dispatch run normally.
"""
import argparse,base64,hashlib,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels,write_emu_png
from emu.execute import run_fast

parser=argparse.ArgumentParser();parser.add_argument('checkpoint')
parser.add_argument('--old-shield',type=int,choices=range(6),default=0)
parser.add_argument('--status-bar',type=int,choices=(0,1),default=1)
parser.add_argument('--repaint',action='store_true',help='Recompose shields/retained writes over the unshielded scene after activation')
parser.add_argument('--clock',action='store_true',help='Drive activation at irregular wall-clock times and verify scheduled audio')
parser.add_argument('--silent',action='store_true',help='Native SOUND_DEVICE=0 and port sound disabled')
parser.add_argument('--output-dir',type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
ds,stack,tank=0x4FC80,0x5F4A0,0xD632
for kind in range(6):
 for count in (0,1,3):
  mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
  handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
  load_state(args.checkpoint,cpu,mem,ports,handler)
  assert ports.get_resolution()==(360,480)
  assert mem.read16(ds+0x1C18)==0,'keyboard fixture must not have the equip-dialog progress bar active'
  mem.write16(ds+0xEF46,0 if args.silent else 1)
  delays=[]
  inventory=mem.read16(ds+tank+0xB2)+mem.read16(ds+tank+0xB4)*16
  for off,value in ((0x519A,65535),(0x5142,args.status_bar),(0x5108,0),(0x5182,tank),(0x5184,0x4FC8),
    (0xE1DE,0x616C+kind*16),(0xE1E0,0x4FC8),(tank+0xC6,0x616C),(tank+0xC8,0x4FC8),
    (tank+0x96,0),(tank+0x98,17)):
   mem.write16(ds+off,value)
  for i in range(5):mem.write16(inventory+(40+i)*2,count)

  def enter(address,segment,arguments=()):
   cpu.segs[:]=[0,segment,0x5F4A,0x4FC8];cpu.ip=address-0x6100-segment*16;cpu.regs[4]=0x2400
   for i,v in enumerate((0x110,0x60,*arguments)):mem.write16(stack+0x2400+i*2,v)

  def resume(stop):
   while True:
    reason,_=run_fast(cpu,mem,ports,handler,4000000,bp_set=set(stop)|{0x104F6-0x6100})
    address=cpu.segs[1]*16+cpu.ip
    assert reason=='breakpoint',(kind,count,hex(address),reason)
    if address in stop:return address
    sp=stack+cpu.regs[4]
    delays.append((mem.read16(stack+cpu.regs[5]+6),mem.read16(sp+4)))
    cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4

  enter(0x3DB30,0x37A3,(tank,0x4FC8));resume({0x710})
  background=bytes(extract_display_pixels(mem,ports))
  clean=background
  if args.old_shield:
   oldcfg=0x616C+args.old_shield*16
   for off,value in ((tank+0xC6,oldcfg),(tank+0x96,17),(0xEC7C,0),(0xEC7E,0),
     (0xEC80,mem.read16(ds+tank+0x1A)+5)):mem.write16(ds+off,value)
   enter(0x404C9,0x39A2,(tank,0x4FC8,0x339,0x3221));resume({0x710})
   enter(0x389DA,0x3221,(tank,0x4FC8));resume({0x710})
   rgb=[17*mem.read16(ds+oldcfg+off)//mem.read16(ds+oldcfg+2) for off in (6,8,10)]
   enter(0x4C0B5,0x45FB,(mem.read16(ds+tank+0x1A)+5,*rgb));resume({0x710})
   enter(0x3DB30,0x37A3,(tank,0x4FC8));resume({0x710})
   # Sample the pre-existing native sky underneath the old shield. Copying
   # the unshielded framebuffer is insufficient where the outline covered a
   # tank: native erasure restores sky, not the overwritten tank pixels.
   oldpixels=bytes(extract_display_pixels(mem,ports))
   color=mem.read16(ds+tank+0x1A)+5
   locations=[i for i,n in enumerate(oldpixels) if i//360>=38 and n in (color,201)]
   for i in locations:
    enter(0x3AB39,0x3352,(i%360,i//360));resume({0x710})
   background=bytes(extract_display_pixels(mem,ports))
   seg=mem.read16(ds+0xEEF6);address=seg*16+mem.read16(ds+0xEEF4)+0x6100
   for i in locations:
    enter(address,seg,(i%360,i//360,oldpixels[i]));resume({0x710})
  before=bytes(extract_display_pixels(mem,ports));palette=[list(c) for c in ports.palette]
  player=dict(index=1,colorIndex=mem.read16(ds+tank+0x1A)//8,
    x=mem.read16(ds+tank+0xE),y=mem.read16(ds+tank+0x10),activeShield=args.old_shield,
    selectedShield=kind,shieldEnergy=17 if args.old_shield else 0,shieldFlightUses=17)
  if args.old_shield:player['shieldLowerColor']=dict(key=f"{player['x']},{player['y']},{args.old_shield}",rgb=palette[201])
  enter(0x2F78A,0x2945);cpu.regs[5]=0x2500;mem.write16(stack+0x24FE,0x12)
  expected=[]
  end=(0x2F98F if args.status_bar else 0x2FAFF)-0x6100
  while True:
   stop=resume({0x3896B-0x6100,end})
   pixels=bytes(extract_display_pixels(mem,ports))
   lut=[bytes(c) for c in ports.palette]
   expected.append(dict(hash=hashlib.sha256(b''.join(lut[c] for c in pixels)).hexdigest(),
     energy=mem.read16(ds+tank+0x96),uses=mem.read16(ds+tank+0x98),
     kind=(mem.read16(ds+tank+0xC6)-0x616C)//16,
     counts=[mem.read16(inventory+(40+i)*2) for i in range(5)]))
   if stop==end:break
   # Complete the palette call's stack cleanup before resuming this loop.
   cpu.ip+=3;cpu.regs[4]+=8

  if args.repaint:
   # Continue the actual E return path through key/mouse release and power
   # refresh to the next input iteration. Explicit continuing-round fixture.
   for off,value in ((0x502E,0),(0x5030,0),(0xD0B8,0x80),(0xD0B2,0),
     (0xE340,2),(tank+0x18,1)):mem.write16(ds+off,value)
   resume({0x2F5AE-0x6100})
   pixels=bytes(extract_display_pixels(mem,ports));lut=[bytes(c) for c in ports.palette]
   idle=dict(hash=hashlib.sha256(b''.join(lut[c] for c in pixels)).hexdigest(),
     energy=mem.read16(ds+tank+0x96),uses=mem.read16(ds+tank+0x98),
     kind=(mem.read16(ds+tank+0xC6)-0x616C)//16,
     counts=[mem.read16(inventory+(40+i)*2) for i in range(5)])

  clock_times=[0,19,20,39,40,67,499,500,1000,1019,1020,2000]
  actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {createHash} from 'node:crypto';
import {config} from './web/js/config.js';
import {pixels,setBackgroundPixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
import {stepShieldActivation,advanceShieldActivation,shieldActivation} from './web/js/shield-activation.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {initInput} from './web/js/input.js';
import {WPN} from './web/js/weapons.js';
import {drawShield} from './web/js/shields.js';
import {drawHudShield} from './web/js/hud.js';
import {projectileDrawing} from './web/js/projectile-render.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
const remap=n=>n>=80&&n<=104?n+40:n>=120&&n<=149?n-40:n;
pixels.set(Buffer.from(s.pixels,'base64').map(remap));
setBackgroundPixels(Buffer.from(s.background,'base64').map(remap));
s.palette.forEach((rgb,i)=>setPaletteRgb(remap(i),...rgb));
createPlayers(2);const p=players[1];Object.assign(p,s.player,{alive:true,aiType:0});
for(let i=0;i<5;i++)p.inventory[WPN.MAG_DEFLECTOR+i]=s.count;
const listeners={},tones=[],stops=[];
class AudioContext {
 constructor(){this.currentTime=10;this.destination={};}
 createOscillator(){return {frequency:{setValueAtTime:(...v)=>tones.push(v)},connect(){},start(){},stop:t=>stops.push(t)};}
 createGain(){return {gain:{setValueAtTime(){}},connect(){}};}
}
globalThis.window={addEventListener:(k,f)=>listeners[k]=f,AudioContext};
initInput({addEventListener(){}});config.statusBar=s.status;config.soundEnabled=s.silent?0:1;
Object.assign(game,{state:STATE.AIM,currentPlayer:1});
listeners.keydown({code:'KeyE',key:'e',preventDefault(){}});gameTick();
const frames=[];
function capture(){
 const rgb=Buffer.alloc(pixels.length*3);
 for(let i=0;i<pixels.length;i++)rgb.set(palette6.slice(pixels[i]*3,pixels[i]*3+3),i*3);
 frames.push({hash:createHash('sha256').update(rgb).digest('hex'),energy:p.shieldEnergy,
   uses:p.shieldFlightUses,kind:p.activeShield,counts:Array.from({length:5},(_,i)=>p.inventory[WPN.MAG_DEFLECTOR+i])});
}
if(s.clock && shieldActivation.active){
 for(const t of s.times){advanceShieldActivation(t);capture();}
}else if(shieldActivation.active)do{
 listeners.keydown({code:'KeyE',key:'e',repeat:true,preventDefault(){}});
 gameTick(); // Native activation blocks input and other gameplay work.
 if(game.state!==STATE.AIM)throw new Error('activation changed game state');
 stepShieldActivation();capture();
}while(shieldActivation.active);
else capture();
gameTick();if(shieldActivation.active)throw new Error('held E reactivated shield');
if(s.repaint){
 pixels.set(Buffer.from(s.clean,'base64').map(remap));
 drawShield(p);projectileDrawing.draw();drawHudShield(p);capture();
}
console.log(JSON.stringify({frames,tones,stops,pixels:Buffer.from(pixels).toString('base64'),palette:[...palette6]}));
'''],cwd=root,input=json.dumps(dict(pixels=base64.b64encode(before).decode(),background=base64.b64encode(background).decode(),clean=base64.b64encode(clean).decode(),repaint=args.repaint,clock=args.clock,silent=args.silent,times=clock_times,palette=palette,player=player,count=count,status=args.status_bar)),text=True))
  if args.clock and len(expected)>1:
   expected=[expected[-1] if args.silent or t>=1020 else expected[max(0,t//20-1)] for t in clock_times]
   assert actual['tones']==([] if args.silent else [[1000+i*100,10+i*.02] for i in range(51)])
   assert actual['stops']==([] if args.silent else [11.02])
  else:
   assert actual['tones']==[] and actual['stops']==[]
   if args.clock and kind==0 and args.status_bar:expected=expected*len(clock_times)
  if args.repaint:expected.append(idle)
  assert delays==([(1000+i*100,20) for i in range(51)] if kind and count and args.status_bar and not args.silent else []),delays
  if args.output_dir:
   args.output_dir.mkdir(parents=True,exist_ok=True)
   pp=base64.b64decode(actual['pixels']);pal=actual['palette']
   for name,data,colors in [('emulator',pixels,ports.palette),('web',pp,[pal[i*3:i*3+3] for i in range(256)])]:
    write_emu_png(dict(width=360,height=480,pixels=data,palette=colors),args.output_dir/f'activation-{kind}-{count}-{name}.png')
  assert len(expected)==len(actual['frames']),(kind,count,len(expected),len(actual['frames']))
  for i,(native,port) in enumerate(zip(expected,actual['frames'])):
   if native!=port:
    pp=base64.b64decode(actual['pixels']);pal=actual['palette']
    diffs=[(j%360,j//360,n,p) for j,(n,p) in enumerate(zip(pixels,pp)) if list(ports.palette[n])!=pal[p*3:p*3+3]]
    raise AssertionError((kind,count,i,native,port,'final RGB diff',len(diffs),diffs[:15]))
  print(f'Shield {kind}, inventory {count}: {len(expected)} full RGB frames and inventory/energy/reserve states match.',flush=True)
