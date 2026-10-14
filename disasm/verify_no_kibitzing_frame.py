#!/usr/bin/env python3
"""Real native modal creation/paint/restoration versus the port dialog layer.
Imports the underlying checkpoint framebuffer only; no native dialog pixels
are supplied to the port. Event-loop timing and input are covered separately.
"""
import argparse,base64,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels,write_emu_png
from emu.execute import run_fast
parser=argparse.ArgumentParser();parser.add_argument('checkpoint');parser.add_argument('--output-dir',type=Path)
args=parser.parse_args();root=Path(__file__).resolve().parent.parent
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
assert ports.get_resolution()==(360,480)
before=bytes(extract_display_pixels(mem,ports));palette=[list(c) for c in ports.palette]
stack=0x5F4A0

def invoke(address,segment,arguments=(),stop=0x710):
 cpu.segs[:]=[0,segment,0x5F4A,0x4FC8];cpu.ip=address-0x6100-segment*16;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,*arguments)):mem.write16(stack+0x2400+i*2,v)
 reason,_=run_fast(cpu,mem,ports,handler,4000000,bp_set={stop})
 assert reason=='breakpoint',(hex(address),reason)
invoke(0x43080,0x3CBF,stop=0x46039-0x6100)
shown=bytes(extract_display_pixels(mem,ports))
bp=stack+cpu.regs[5];dialog=(mem.read16(bp+6),mem.read16(bp+8))
invoke(0x45ECB,0x3FA9,dialog)
invoke(0x45DDC,0x3FA9,dialog)
restored=bytes(extract_display_pixels(mem,ports))
assert restored==before,'native dialog did not restore original framebuffer'
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {pixels} from './web/js/framebuffer.js';
import {setPaletteRgb,palette6} from './web/js/palette.js';
import {drawNoKibitzing,closeNoKibitzing} from './web/js/no-kibitzing.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
pixels.set(Buffer.from(s.pixels,'base64'));s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
drawNoKibitzing();const shown=Buffer.from(pixels).toString('base64');
drawNoKibitzing();closeNoKibitzing();
console.log(JSON.stringify({shown,restored:Buffer.from(pixels).toString('base64'),palette:[...palette6]}));
'''],cwd=root,input=json.dumps(dict(pixels=base64.b64encode(before).decode(),palette=palette)),text=True))
port=base64.b64decode(actual['shown']);pal=actual['palette'];mapped=[pal[i*3:i*3+3] for i in range(256)]
diffs=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(shown,port)) if list(ports.palette[n])!=mapped[p]]
if args.output_dir:
 args.output_dir.mkdir(parents=True,exist_ok=True)
 for name,pixels,palette in [('emulator',shown,ports.palette),('web',port,mapped)]:
  write_emu_png(dict(width=360,height=480,pixels=pixels,palette=palette),args.output_dir/f'no-kibitzing-{name}.png')
assert not diffs,(len(diffs),diffs[:15])
assert base64.b64decode(actual['restored'])==restored
print('Native No Kibitzing: all 360x480 RGB pixels and exact framebuffer restoration match; repeated modal repaint preserves its original background.')
