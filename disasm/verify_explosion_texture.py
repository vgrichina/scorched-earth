#!/usr/bin/env python3
"""Compare every texture byte and R250 word with native 0x2F111."""
import argparse
import json
import subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
for width,height in [(11,9),(17,15),(151,151),(248,451)]:
    for seed in (0,42):
        mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
        handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
        load_state(args.checkpoint,cpu,mem,ports,handler)
        def call(file,segment,arguments):
            cpu.segs[:]=[0,segment,0x8000,0x4fc8]
            cpu.ip=file-0x6100-segment*16;cpu.regs[4]=0x2400
            for i,word in enumerate([0x110,0x60,*arguments]):mem.write16(0x82400+2*i,word)
            reason,steps=run_fast(cpu,mem,ports,handler,20000000,bp_set={0x710})
            assert reason=='breakpoint',(file,reason,steps)
        call(0x32994,0x2c89,[seed])
        call(0x2f111,0x28f9,[width,height,40])
        address=cpu.regs[0]+16*cpu.regs[2]
        expected=None if not address else list(mem.read_bytes(address,width*height))
        rng=dict(index=mem.read16(0x4fc80+0xec06),words=[mem.read16(0x4fc80+0xea12+2*i) for i in range(250)])
        actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',
            "import {seedRandom,getRandomState} from './web/js/utils.js';"
            "import {generateExplosionTexture} from './web/js/explosion-texture.js';"
            f"seedRandom({seed});const p=generateExplosionTexture({width},{height});"
            "console.log(JSON.stringify({pixels:p?Array.from(p):null,rng:getRandomState()}));"],cwd=root,text=True))
        assert actual['pixels']==expected,(width,height,seed,'texture bytes')
        assert actual['rng']==rng,(width,height,seed,'R250 state')
        print(f'{width}x{height} seed {seed}: native texture and RNG match.',flush=True)
