#!/usr/bin/env python3
"""Compare every item availability flag against native equip_init.

Exercises all arms levels, play modes, and interacting context filters.
Does not establish purchase behavior, list pixels or market prices.
"""
import argparse,itertools,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
keys=('armsLevel','uselessItems','suspendDirt','tracePaths','fallingTanks','tunneling','playMode')
cases=[dict(zip(keys,values)) for values in itertools.product(range(5),range(2),(0,50,100),range(2),range(2),range(2),range(3))]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {WEAPONS} from './web/js/weapons.js';
import {isShopItemAvailable,buyWeapon} from './web/js/shop.js';
console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(c=>{
 Object.assign(config,c);
 const flags=WEAPONS.slice(2).map(w=>Number(isShopItemAvailable(w)));
 flags.forEach((enabled,i)=>{
  if(enabled)return;
  const p={cash:1000000,inventory:Array(50).fill(0)};
  assert.equal(buyWeapon(p,i+2),false);
  assert.equal(p.cash,1000000);assert.equal(p.inventory[i+2],0);
 });
 return flags;
})));
'''],input=json.dumps(cases),cwd=root,text=True))
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
m.write16(ds+0x519a,65535)
for case,port in zip(cases,actual):
 for off,value in ((0x518a,case['armsLevel']),(0x50fe,case['uselessItems']),
                   (0x5158,100-case['suspendDirt']),(0x5168,case['tracePaths']),
                   (0x5162,case['fallingTanks']),(0x513a,case['tunneling']),
                   (0x5188,case['playMode'])):m.write16(ds+off,value)
 c.segs[:]=[0,0x1700,0x8800,0x4fc8];c.ip=0x1d5d4-0x6100-0x17000;c.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60)):m.write16(0x8a400+2*i,v)
 reason,_=run_fast(c,m,p,h,1000000,bp_set={0x710})
 assert reason=='breakpoint',(case,reason)
 native=[m.read16(ds+0x1216+52*i) for i in range(m.read16(ds+0x1bb6))]
 assert native==port,(case,[(i,n,v) for i,(n,v) in enumerate(zip(native,port)) if n!=v])
print(f'{len(cases)} configurations × {len(native)} item availability flags match native equip_init.')
