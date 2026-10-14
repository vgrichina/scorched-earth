#!/usr/bin/env python3
"""Compare the real native 40-frame death prelude, including DAC I/O.

Sound and delay are intercepted; palette reads/rotations/uploads execute.
This verifies the shared palette kernel, not death dispatch or sprite lifetime.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels,write_emu_png
from emu.execute import run_fast
parser=argparse.ArgumentParser()
parser.add_argument('checkpoint')
parser.add_argument('--output-dir',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
initial=[list(rgb) for rgb in ports.palette]
pixels=extract_display_pixels(mem,ports)
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {palette6,setPaletteRgb} from './web/js/palette.js';
import {createDeathPaletteCycle,stepDeathPaletteCycle} from './web/js/death-effects.js';
let input='';for await(const c of process.stdin)input+=c;
const initial=JSON.parse(input);
console.log(JSON.stringify(Array.from({length:10},(_,index)=>{
 initial.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
 const cycle=createDeathPaletteCycle(index*8),frames=[];
 while(stepDeathPaletteCycle(cycle))frames.push({frequency:cycle.frequency,palette:[...palette6]});
 return frames;
})));
'''],cwd=root,input=json.dumps(initial),text=True))
ds,stack=0x4FC80,0x5F4A0
for player in range(10):
 ports.palette=[tuple(rgb) for rgb in initial]
 mem.write16(ds+0xEF46,1)
 cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8]
 cpu.ip=0x1DF65-0x6100-0x17AB0;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,player*8)):mem.write16(stack+0x2400+i*2,v)
 frame=0
 for _ in range(200):
  reason,count=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x710,*[a-0x6100 for a in (0x10C81,0x104F6,0x4C278)]})
  addr=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(player,reason,hex(addr))
  if addr==0x6810:break
  sp=stack+cpu.regs[4]
  if addr==0x10C81:
   expected=actual[player][frame]
   assert mem.read16(sp+4)==expected['frequency'],(player,frame,'frequency')
   flat=[channel for rgb in ports.palette for channel in rgb]
   assert flat==expected['palette'],(player,frame,'palette')
   assert extract_display_pixels(mem,ports)==pixels,(player,frame,'unexpected pixel writes')
   if args.output_dir and player==1:
    args.output_dir.mkdir(parents=True,exist_ok=True)
    for name,pal in [('emulator',ports.palette),('port',[expected['palette'][i:i+3] for i in range(0,768,3)])]:
     write_emu_png(dict(width=360,height=480,pixels=pixels,palette=pal),args.output_dir/f'death-palette-{frame:02d}-{name}.png')
   frame+=1
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('death palette cycle did not finish')
 assert frame==40,(player,frame)
 assert [list(rgb) for rgb in ports.palette]==initial
print('400 native death-palette frames match all DAC entries and sound frequencies; framebuffer unchanged and palette restored after each 40-frame cycle.')
