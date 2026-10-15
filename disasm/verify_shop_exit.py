#!/usr/bin/env python3
"""Trace final initial-shop Done into landscape generation and player order."""
import argparse,json,subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
from emu_dialog_key import deliver_key
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint',help='Input-ready final human shop checkpoint')
parser.add_argument('--button',type=int,choices=[1,2],help='Click Done using a native mouse button instead of D')
args=parser.parse_args()
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(Path(__file__).resolve().parent.parent/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
kw=dict(timer_period=1000,tick_addr=(cpu.segs[3]<<4)+0xEE78,isr_divisor=200)
points={0x176dd-0x6100,0x2bb5e-0x6100,0x2927e-0x6100,0x2ae53-0x6100}
if args.button:
    # Supply the mouse driver's position/button polls, then stop at interest.
    polls={0x4bda3-0x6100,0x4be8c-0x6100,0x4c117-0x6100}
    for tick in range(400):
        reason,count=run_fast(cpu,mem,ports,handler,3000000,bp_set=points|polls,**kw)
        assert reason=='breakpoint',(reason,count)
        address=cpu.segs[1]*16+cpu.ip
        if address in points:break
        sp=cpu.segs[2]*16+cpu.regs[4]
        if address==0x4bda3-0x6100 and (mem.read16(sp+4) or mem.read16(sp+6)):
            for i,value in enumerate((275,110)):
                mem.write16(mem.read16(sp+4+i*4)+16*mem.read16(sp+6+i*4),value)
        cpu.regs[0]=args.button if tick<60 else 0
        cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
    else:raise AssertionError('Done did not leave the shop')
    subprocess.run(['node','--input-type=module','-e',r"""
import assert from 'node:assert/strict';
import {players,createPlayers} from './web/js/tank.js';
import {openShop,shopTick,isShopActive} from './web/js/shop.js';
import {initInput} from './web/js/input.js';
const events={};globalThis.window={addEventListener(){}};
initInput({addEventListener(name,callback){events[name]=callback;},
 getBoundingClientRect(){return {left:0,top:0,width:360,height:480};}});
createPlayers(2);players[0].aiType=0;
openShop(0,10,{showPrivacy:false});
const e={button:Number(process.argv[1])===1?0:2,clientX:275,clientY:110,preventDefault(){}};
events.mouseenter();events.mousemove(e);events.mousedown(e);
assert.equal(shopTick(players[0]),true);assert.equal(isShopActive(),false);
console.log('Port Done mouse input closes the shop.');
""",str(args.button)],check=True,cwd=Path(__file__).resolve().parent.parent)
else:
    deliver_key(cpu,mem,ports,handler,0xa0,0)
    reason,count=run_fast(cpu,mem,ports,handler,3000000,bp_set={0x460c3-0x6100,0x28b31-0x6100},**kw)
    assert reason=='breakpoint',(reason,count)
    deliver_key(cpu,mem,ports,handler,0x20,100)
    reason,count=run_fast(cpu,mem,ports,handler,2000000,bp_set=points,**kw)
    if reason=='max_steps':
        # Dialog completion waits for key release.
        deliver_key(cpu,mem,ports,handler,0xa0,0)
        reason,count=run_fast(cpu,mem,ports,handler,12000000,bp_set=points,**kw)
ds=0x4fc80
import struct
def number(off):
    obj=mem.read16(ds+off)+16*mem.read16(ds+off+2)
    limbs=mem.read16(obj)+16*mem.read16(obj+2);count=mem.read16(obj+4)
    assert 0<count<16,(off,count)
    value=0
    for j in range(count):value=(value<<16)|mem.read16(limbs+2*j)
    if mem.read16(limbs)&0x8000:value-=1<<(16*count)
    return value
def balances():
    n=mem.read16(ds+0x50d4)
    return [[number(0xd568+0xca*i+0xbe),number(0xd568+0xca*i+0xc2)] for i in range(n)]+[
        [number(0xe1ec+0x16*i+0xe),number(0xe1ec+0x16*i+0x12)] for i in range(n)]
expected=None;order=[]
while reason=='breakpoint':
    address=(cpu.segs[1]<<4)+cpu.ip+0x6100
    if address not in (0x176dd,0x2bb5e):break
    order.append(address);points.remove(address-0x6100)
    if address==0x176dd:
        before=balances();n=mem.read16(ds+0x50d4)
        fixture=dict(mode=mem.read16(ds+0x50ea),rate=struct.unpack('<d',mem.data[ds+0x5190:ds+0x5198])[0]*100,values=before,n=n)
        expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',r"""
import {config} from './web/js/config.js';
import {players} from './web/js/tank.js';
import {applyInterest} from './web/js/score.js';
import {getTeamScore,resetTeamScores} from './web/js/team-scoring.js';
const c=JSON.parse(process.argv[1]);Object.assign(config,{teamMode:c.mode,interest:c.rate});
resetTeamScores();players.splice(0,players.length,...c.values.slice(0,c.n).map(([cash,earnedInterest])=>({cash,earnedInterest})));
c.values.slice(c.n).forEach(([cash,earnedInterest],i)=>Object.assign(getTeamScore(i),{cash,earnedInterest}));
applyInterest();console.log(JSON.stringify([...players,...Array.from({length:c.n},(_,i)=>getTeamScore(i))].map(p=>[p.cash,p.earnedInterest])));
""",json.dumps(fixture)],text=True,cwd=Path(__file__).resolve().parent.parent))
    else:
        assert expected is not None,'market update preceded interest'
        assert balances()==expected,('post-shop cash/interest',balances(),expected)
    reason,count=run_fast(cpu,mem,ports,handler,12000000,bp_set=points,**kw)
assert order==[0x176dd,0x2bb5e],order
print('Final Done credits native personal/team cash and accumulated interest, then updates the market.',flush=True)
address=(cpu.segs[1]<<4)+cpu.ip+0x6100
assert reason=='breakpoint' and address==0x2927e,(reason,count,hex(address))
print('Final shop Done reaches landscape setup 0x2927E before player order.',flush=True)
deliver_key(cpu,mem,ports,handler,0xa0,0)
reason,count=run_fast(cpu,mem,ports,handler,30000000,bp_set={0x2ae53-0x6100},**kw)
assert reason=='breakpoint',(reason,count)
print('EXE completes landscape generation, then enters player-order setup 0x2AE53.',flush=True)
