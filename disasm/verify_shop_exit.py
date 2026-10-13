#!/usr/bin/env python3
"""Trace final initial-shop Done into landscape generation and player order."""
import argparse
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
points={0x2927e-0x6100,0x2ae53-0x6100}
deliver_key(cpu,mem,ports,handler,0x20,100)
reason,count=run_fast(cpu,mem,ports,handler,2000000,bp_set=points,**kw)
if reason=='max_steps':
    # Dialog completion waits for key release.
    deliver_key(cpu,mem,ports,handler,0xa0,0)
    reason,count=run_fast(cpu,mem,ports,handler,12000000,bp_set=points,**kw)
address=(cpu.segs[1]<<4)+cpu.ip+0x6100
assert reason=='breakpoint' and address==0x2927e,(reason,count,hex(address))
print('Final shop Done reaches landscape setup 0x2927E before player order.',flush=True)
deliver_key(cpu,mem,ports,handler,0xa0,0)
reason,count=run_fast(cpu,mem,ports,handler,30000000,bp_set={0x2ae53-0x6100},**kw)
assert reason=='breakpoint',(reason,count)
print('EXE completes landscape generation, then enters player-order setup 0x2AE53.',flush=True)
