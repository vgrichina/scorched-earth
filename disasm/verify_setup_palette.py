#!/usr/bin/env python3
"""Compare setup palette idle callbacks, including full wrap and pointer mode.

Starts from native setup after its initial rotation; no final palette is
supplied to the port. Callback counts are aligned, not wall-clock rates.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--modal',action='store_true',help='Exercise palette callbacks through player-name editing menu ticks')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m
h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
ds=0x4fc80
m.write16(ds+0x5008,0)
def callback(pointer):
    m.write16(ds+0x6e42,int(pointer))
    c.segs[:]=[0,0x2000,0x8000,0x4fc8]
    c.ip=0x273a0-0x6100-0x20000;c.regs[4]=0x2400
    m.write16(0x82400,0x110);m.write16(0x82402,0x60)
    reason,detail=run_fast(c,m,p,h,100000,bp_set={0x710})
    assert reason=='breakpoint',(reason,detail)
samples=[]
for n in range(4042):
    if n:callback(False)
    if n in (0,1,100,101,102,202,4039,4040,4041):
        samples.append(dict(n=n,pointer=False,palette=[v for rgb in p.palette[180:220] for v in rgb]))
for n in range(1,4):
    callback(True)
    samples.append(dict(n=n,pointer=True,palette=[v for rgb in p.palette[180:220] for v in rgb]))
code="""
import assert from 'node:assert/strict';
import {initPlayerSetup,tickPlayerSetupBackdrop,menu,menuTick,playerSetup} from './web/js/menu.js';
import {palette6} from './web/js/palette.js';
initPlayerSetup();menu.screen='player_setup';menu.playerSetupIdx=0;let previous=0;
const modal=process.argv[2]==='modal';
for(const sample of JSON.parse(process.argv[1])) {
  if(sample.pointer)tickPlayerSetupBackdrop(true);
  else {for(let i=previous;i<sample.n;i++){if(modal)menuTick();else tickPlayerSetupBackdrop();}previous=sample.n;}
  assert.deepEqual(Array.from(palette6.slice(180*3,220*3)),sample.palette,JSON.stringify({n:sample.n,pointer:sample.pointer}));
}
if(modal)assert.equal(playerSetup[0].editName,'','idle callbacks must leave name entry active');
console.log((modal?'Modal name entry: ':'Direct callback: ')+'12 native setup palette samples match: 101-poll threshold, full wrap, pointer callbacks.');
"""
subprocess.run(['node','--input-type=module','-e',code,json.dumps(samples),'modal' if args.modal else 'direct'],cwd=root,check=True)
