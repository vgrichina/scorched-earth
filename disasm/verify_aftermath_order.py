#!/usr/bin/env python3
"""Execute native outer_sim_loop; intercept effect/fall/settle callees only.
Verify serial death dispatch and rescans when effects kill earlier players.
This is a caller-order oracle, not a screenshot or scoring comparison.
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
cases=[dict(hp=hp,hits={},falls={}) for hp in ([100,100,100],[0,-10,100],[-1,-2,-3],[0,0,0])]
cases += [dict(hp=[100,100,0],hits={'2':[[0,-1]],'0':[[1,0]]},falls={}),
 dict(hp=[0,100,100],hits={'0':[[2,-5]]},falls={'2':[[1,0]]}),
 dict(hp=[100,100,100],hits={},falls={'1':[[1,-1]]})]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {aftermathSequence} from './web/js/aftermath.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 const players=c.hp.map(energy=>({energy,alive:true}));const events=[];let falls=0;
 for(const op of aftermathSequence(players)){
  events.push(op);
  let changes=[];
  if(op.kind==='death'){players[op.index].alive=false;changes=c.hits[op.index]??[];}
  if(op.kind==='fall')changes=c.falls[++falls]??[];
  for(const [i,hp] of changes)players[i].energy=hp;
 }
 return events;
})));
'''],cwd=root,input=json.dumps(cases),text=True))
for case,port in zip(cases,actual):
 mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
 load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
 ds,stack=0x4FC80,0x5F4A0
 mem.write16(ds+0x519A,65535);mem.write16(ds+0x50D4,len(case['hp']))
 def set_hp(i,hp):
  base=ds+0xD568+i*0xCA
  mem.write16(base+0xA2,hp&65535);mem.write16(base+0xA4,(hp>>16)&65535)
 for i,hp in enumerate(case['hp']):
  set_hp(i,hp);mem.write16(ds+0xD568+i*0xCA+0x18,1)
 cpu.segs[:]=[0,0x1ADA,0x5F4A,0x4FC8];cpu.ip=0x23298-0x6100-0x1ADA0;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 events=[];falls=0
 for _ in range(200):
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710,*[a-0x6100 for a in (0x3FF85,0x1CEF8,0x20158,0x1DBB5)]})
  address=cpu.segs[1]*16+cpu.ip
  assert reason=='breakpoint',(case,reason,hex(address))
  if address==0x710:break
  addr=address+0x6100;sp=stack+cpu.regs[4];changes=[]
  if addr==0x1CEF8:events.append(dict(kind='settle'))
  elif addr==0x20158:
   events.append(dict(kind='fall'));falls+=1;changes=case['falls'].get(str(falls),[])
  elif addr==0x1DBB5:
   tank=mem.read16(sp+4);index=(tank-0xD568)//0xCA
   events.append(dict(kind='death',index=index));mem.write16(ds+tank+0x18,0)
   changes=case['hits'].get(str(index),[])
  for i,hp in changes:set_hp(i,hp)
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('aftermath did not finish')
 assert events==port,(case,events,port)
print(f'{len(cases)} native aftermath traces match settling, falling, serial deaths and earlier-player rescans.')
