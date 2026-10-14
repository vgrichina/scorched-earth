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
args=parser.parse_args()
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(Path(__file__).resolve().parent.parent/'earth'),ports)
load_state(args.checkpoint,cpu,mem,ports,handler)
kw=dict(timer_period=1000,tick_addr=(cpu.segs[3]<<4)+0xEE78,isr_divisor=200)
deliver_key(cpu,mem,ports,handler,0xa0,0)
reason,count=run_fast(cpu,mem,ports,handler,3000000,bp_set={0x460c3-0x6100,0x28b31-0x6100},**kw)
assert reason=='breakpoint',(reason,count)
points={0x176dd-0x6100,0x2bb5e-0x6100,0x2927e-0x6100,0x2ae53-0x6100}
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
