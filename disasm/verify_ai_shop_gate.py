#!/usr/bin/env python3
"""Compare native Computers Buy=Off returns with the port's shop transition."""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
for ai in range(1,8):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h)
 ds=0x4fc80;m.write16(ds+0x515e,0);m.write16(ds+0xd568+0x22,ai)
 before=bytes(m.data[ds:ds+0x10000]);palette=[list(rgb) for rgb in p.palette]
 c.segs[:]=[0,0x1000,0x8000,0x4fc8];c.ip=0x18a2f-0x6100-0x10000;c.regs[4]=0x2400
 for j,value in enumerate([0x110,0x60,0xd568,0x4fc8]):m.write16(0x82400+2*j,value)
 reason,detail=run_fast(c,m,p,h,1000,bp_set={0x710})
 assert reason=='breakpoint',(ai,reason,detail)
 assert bytes(m.data[ds:ds+0x10000])==before,(ai,'native mutated data')
 assert [list(rgb) for rgb in p.palette]==palette
code="""
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {players} from './web/js/tank.js';
import {game,STATE,initGameRound,gameTick} from './web/js/game.js';
import {palette6} from './web/js/palette.js';
import {shop,aiAutoPurchase} from './web/js/shop.js';
import {seedRandom,getRandomState} from './web/js/utils.js';
config.numPlayers=2;config.computersBuy=0;
for(let ai=1;ai<=7;ai++) {
 initGameRound([{name:'Computer',aiType:ai,colorIndex:0,tankType:3},{name:'Human',aiType:0,colorIndex:1,tankType:3}]);
 seedRandom(42);
 const before=JSON.stringify(players),rng=getRandomState(),counter=shop.frame,palette=Array.from(palette6);
 aiAutoPurchase(players[0]);
 assert.equal(JSON.stringify(players),before);assert.deepEqual(getRandomState(),rng);assert.deepEqual(Array.from(palette6),palette);
 gameTick();
 assert.equal(game.state,STATE.SHOP);assert.equal(game.shopPlayerIdx,1);
 assert.equal(shop.kibitz,false);assert.equal(shop.frame,counter);
 assert.equal(JSON.stringify(players),before);assert.deepEqual(getRandomState(),rng);assert.deepEqual(Array.from(palette6),palette);
}
console.log('All 7 AI types skip buying without data/RNG/palette changes when Computers Buy is off; port advances to the next shopper.');
"""
subprocess.run(['node','--input-type=module','-e',code],cwd=root,check=True)
