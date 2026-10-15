#!/usr/bin/env python3
"""Compare native post-setup duplicate computer naming, including RNG order."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
ds=0x4fc80
samples=[]
for names,types in [(['Bob','Bob'],[0,5]),(['Bob','bOb'],[0,5]),(['Bob','Bob'],[5,5]),(['Bob','Bob'],[0,0]),(['Bob','Joe'],[5,5])]:
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h)
 m.write16(ds+0x50d4,2)
 def call(address,arguments):
  c.segs[:]=[0,0x2000,0x8000,0x4fc8];c.ip=address-0x6100-0x20000;c.regs[4]=0x2400
  for j,value in enumerate([0x110,0x60,*arguments]):m.write16(0x82400+2*j,value)
  reason,detail=run_fast(c,m,p,h,1000000,bp_set={0x710})
  assert reason=='breakpoint',(reason,detail)
 for i,(name,ai) in enumerate(zip(names,types)):
  raw=name.encode()+b'\0';m.data[0x90000:0x90000+len(raw)]=raw
  call(0x3151f,[0xd568+i*0xca,0x4fc8,0,0x9000])
  m.write16(ds+0xd568+i*0xca+0x22,ai)
 words=list(range(20))+[0]*230
 for i,value in enumerate(words):m.write16(ds+0xea12+i*2,value)
 m.write16(ds+0xec06,0)
 # Enter the native post-editor loop with its caller frame; stop before scoring UI.
 c.segs[:]=[0,0x2000,0x8000,0x4fc8];c.ip=0x26dc2-0x6100-0x20000
 c.regs[4]=0x23e0;c.regs[5]=0x2400
 reason,detail=run_fast(c,m,p,h,1000000,bp_set={0x26e12-0x6100})
 assert reason=='breakpoint',(reason,detail)
 result=[]
 for i in range(2):
  a=ds+0xd568+i*0xca+0xb6;ptr=m.read16(a)+16*m.read16(a+2)
  result.append(bytes(m.data[ptr:ptr+80]).split(b'\0')[0].decode('ascii'))
 samples.append(dict(names=names,types=types,words=words,result=result,state=dict(index=m.read16(ds+0xec06),words=[m.read16(ds+0xea12+2*i) for i in range(250)])))
code="""
import assert from 'node:assert/strict';
import {setRandomState,getRandomState} from './web/js/utils.js';
import {resolveDuplicateComputerNames} from './web/js/player-names.js';
for(const s of JSON.parse(process.argv[1])) {
 setRandomState({index:0,words:s.words});
 const roster=s.names.map((name,i)=>({name,aiType:s.types[i]}));
 resolveDuplicateComputerNames(roster);
 assert.deepEqual(roster.map(p=>p.name),s.result,JSON.stringify(s.names));
 assert.deepEqual(getRandomState(),s.state);
}
console.log('5 native duplicate-name passes match names and full R250 state.');
"""
subprocess.run(['node','--input-type=module','-e',code,json.dumps(samples)],cwd=root,check=True)
