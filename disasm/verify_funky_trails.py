#!/usr/bin/env python3
"""Actual native 0x24CBF traversal against the production 16.16 trail walker.
Pixel callbacks are intercepted; compare ordered reads/writes/restorations and
saved collision coordinates, including erase termination and viewport limits.
"""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
paths=[((268,260),(40,476),(154,38)),((40,260),(320,476),(180,38)),
 ((180,240),(180,476),(180,38)),((3,39),(356,476),(179,38)),
 ((356,476),(3,476),(179,38)),((180,240),(180,240),(180,240)),
 ((180,240),(180,600),(180,38)),((10,100),(-20,476),(-5,38))]
cases=[dict(start=dict(zip(('x','y'),a)),end=dict(zip(('x','y'),b)),control=dict(zip(('x','y'),c)),
  mode=mode,color=color,hit=dict(x=a[0],y=a[1]) if mode==2 else dict(x=0,y=0))
  for a,b,c in paths for mode in range(3) for color in (254,120)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {traverseFunkyTrail} from './web/js/death-funky.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 const events=[];const io={
  getPixel:(x,y)=>{events.push(['read',x,y]);return c.mode===1&&y>=300?80:120;},
  setPixel:(...args)=>events.push(['write',...args]),
  restorePixel:(...args)=>events.push(['restore',...args])};
 const hit=traverseFunkyTrail(c.start,c.end,c.control,io,{color:c.color,hit:c.hit});
 return {events,hit};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 for off,value in [(0x519A,65535),(0xEF46,0),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
  (0xCF8C,0),(0xCF8E,0),(0xCF64,case['hit']['x']),(0xCF66,case['hit']['y']),(0x6E2A,case['color']),
  (0xEEF8,0x100),(0xEEFA,0x60),(0xEEF4,0x120),(0xEEF6,0x60)]:mem.write16(ds+off,value)
 cpu.segs[:]=[0,0x1E5E,0x5F4A,0x4FC8];cpu.ip=0x5DF;cpu.regs[4]=0x2400
 values=[0x110,0x60]+[case[k][axis] for k in ('start','end','control') for axis in ('x','y')]
 for i,value in enumerate(values):mem.write16(stack+0x2400+i*2,value&65535)
 events=[];signed=lambda v:v if v<32768 else v-65536
 for _ in range(10000):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710,0x720,0x3AB39-0x6100})
  assert reason=='breakpoint',(case,reason)
  addr=cpu.segs[1]*16+cpu.ip
  if addr==0x710:break
  sp=stack+cpu.regs[4];args=[signed(mem.read16(sp+o)) for o in (4,6,8)]
  if addr==0x700:
   events.append(['read',*args[:2]]);cpu.ax=80 if case['mode']==1 and args[1]>=300 else 120
  elif addr==0x720:events.append(['write',*args])
  else:events.append(['restore',*args[:2]])
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('native trail did not finish')
 if events!=port['events']:
  for i,(native,js) in enumerate(zip(events,port['events'])):assert native==js,(case,i,native,js)
  raise AssertionError((case,'event count',len(events),len(port['events'])))
 hit=dict(x=signed(mem.read16(ds+0xCF64)),y=signed(mem.read16(ds+0xCF66)))
 assert hit==port['hit'],(case,hit,port['hit'])
print(f'{len(cases)} native Funky Bomb trails match ordered pixel I/O and collision/erase endpoints.')
