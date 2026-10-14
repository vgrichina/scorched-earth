#!/usr/bin/env python3
"""Run native shield cycling and compare selection, inventory and HUD pixels.

Uses a real 360x480 gameplay checkpoint for initialized inventory mappings,
palette and HUD layout. Only the no-change sound is intercepted. The port
uses production game/input and HUD code; this does not exercise activation.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels
from emu.execute import run_fast

parser=argparse.ArgumentParser();parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
assert ports.get_resolution()==(360,480)
ds,stack,tank=0x4FC80,0x5F4A0,0xD632
inventory=mem.read16(ds+tank+0xB2)+mem.read16(ds+tank+0xB4)*16
items=[mem.read16(ds+0x616C+k*16+14) for k in range(1,6)]
assert items==[40,41,42,43,44],items
x,right=mem.read16(ds+0xE9F4),mem.read16(ds+0xE9FA)
y=mem.read16(ds+0x518E)+12
cases=[]
for mask in range(32):
 for selected in range(6):
  for status in (0,1):
   active=(mask+selected)%6
   cases.append(dict(selected=selected,active=active,status=status,
     energy=(0 if active==0 or mask%3==0 else 17),
     counts=[(k+1 if mask&(1<<k) else (-1 if k%2 else 0)) for k in range(5)]))

actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {initInput} from './web/js/input.js';
import {drawHud} from './web/js/hud.js';
import {pixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
import {WPN} from './web/js/weapons.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{screenWidth:360,screenHeight:480,numPlayers:2});createPlayers(2);
s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
const listeners={};globalThis.window={addEventListener:(k,f)=>listeners[k]=f};
initInput({addEventListener(){}});
const p=players[1],results=[];
for(const c of s.cases){
 Object.assign(p,{alive:true,aiType:0,selectedShield:c.selected,activeShield:c.active,
   shieldEnergy:c.energy,hudShieldEnergy:undefined,colorIndex:1});
 c.counts.forEach((n,i)=>p.inventory[WPN.MAG_DEFLECTOR+i]=n);
 Object.assign(game,{state:STATE.AIM,currentPlayer:1});config.statusBar=c.status;
 listeners.keydown({code:'KeyS',key:'s',preventDefault(){}});gameTick();
 // Compare widget rendering independently of the status-bar visibility gate.
 config.statusBar=1;drawHud(p,0,1);
 const rgb=[];for(let y=s.y;y<s.y+12;y++)for(let x=s.x;x<s.right;x++){
  const color=pixels[y*360+x];rgb.push(...palette6.slice(color*3,color*3+3));
 }
 results.push({selected:p.selectedShield,active:p.activeShield,energy:p.shieldEnergy,
   counts:c.counts.map((_,i)=>p.inventory[WPN.MAG_DEFLECTOR+i]),rgb});
}
console.log(JSON.stringify(results));
'''],cwd=root,input=json.dumps(dict(cases=cases,palette=ports.palette,x=x,right=right,y=y)),text=True))

def invoke(address,segment,arguments=(),stop=0x710):
 cpu.segs[:]=[0,segment,0x5F4A,0x4FC8];cpu.ip=address-0x6100-segment*16;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,*arguments)):mem.write16(stack+0x2400+i*2,v&65535)
 while True:
  reason,_=run_fast(cpu,mem,ports,handler,1000000,bp_set={stop,0x4C117-0x6100})
  address=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(hex(address),reason)
  if address==stop:return
  sp=stack+cpu.regs[4]
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4

for case,port in zip(cases,actual):
 for off,value in ((0x519A,65535),(0x5142,case['status']),
   (0x5182,tank),(0x5184,0x4FC8),(0xE1DE,0x616C+case['selected']*16),(0xE1E0,0x4FC8),
   (tank+0xC6,0x616C+case['active']*16),(tank+0xC8,0x4FC8),(tank+0x96,case['energy'])):
  mem.write16(ds+off,value)
 for item,count in zip(items,case['counts']):mem.write16(inventory+item*2,count&65535)
 # Native scan-code dispatch for S, stopping before its key-release wait.
 cpu.regs[5]=0x2500;mem.write16(stack+0x24FE,0x1F)
 invoke(0x2F78A,0x2945,stop=(0x2F943 if case['status'] else 0x2FAFF)-0x6100)
 selected=(mem.read16(ds+0xE1DE)-0x616C)//16
 assert port['selected']==selected,(case,port['selected'],selected)
 assert port['active']==case['active'] and port['energy']==case['energy']
 assert port['counts']==case['counts']
 assert [mem.read16(inventory+i*2) for i in items]==[n&65535 for n in case['counts']]
 invoke(0x3DB30,0x37A3,(tank,0x4FC8))
 native=extract_display_pixels(mem,ports)
 rgb=[v for yy in range(y,y+12) for xx in range(x,right) for v in ports.palette[native[yy*360+xx]]]
 assert rgb==port['rgb'],(case,selected,'shield widget RGB differs',sum(a!=b for a,b in zip(rgb,port['rgb'])))
print(f'{len(cases)} native S-key selection and HUD RGB cases match: every inventory subset, all selections, active/inactive shields and status-bar gating; inventory unchanged.')
