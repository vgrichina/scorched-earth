#!/usr/bin/env python3
"""Verify every native computer-name table entry and its single RNG draw."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
samples=[]
for value in list(range(67))+[32767,65535]:
    words=[0]*250;words[0]=value
    m.write16(ds+0xec06,0)
    for i,w in enumerate(words):m.write16(ds+0xea12+2*i,w)
    c.segs[:]=[0,0x2000,0x8000,0x4fc8];c.ip=0x2d844-0x6100-0x20000;c.regs[4]=0x2400
    m.write16(0x82400,0x110);m.write16(0x82402,0x60)
    reason,detail=run_fast(c,m,p,h,100000,bp_set={0x710});assert reason=='breakpoint',(reason,detail)
    ptr=c.regs[0]+16*c.regs[2]
    name=bytes(m.data[ptr:ptr+80]).split(b'\0')[0].decode('ascii')
    samples.append(dict(value=value,name=name,state=dict(index=m.read16(ds+0xec06),words=[m.read16(ds+0xea12+2*i) for i in range(250)])))
code="""
import assert from 'node:assert/strict';
import {setRandomState,getRandomState} from './web/js/utils.js';
import {randomComputerName} from './web/js/player-names.js';
for(const sample of JSON.parse(process.argv[1])) {
 const words=Array(250).fill(0);words[0]=sample.value;setRandomState({index:0,words});
 assert.equal(randomComputerName(),sample.name);assert.deepEqual(getRandomState(),sample.state);
}
console.log('69 native computer-name/R250 cases match, including all 67 names and unsigned modulo.');
"""
subprocess.run(['node','--input-type=module','-e',code,json.dumps(samples)],cwd=root,check=True)
