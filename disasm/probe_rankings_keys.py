#!/usr/bin/env python3
"""Establish native Rankings key press/release behavior from input-ready state.

Pass a rankings.state produced by the composed shot comparison. This is native
evidence for implementing input; it does not compare the port's input yet.
"""
import argparse
from pathlib import Path
from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.execute import run_fast
from emu.state import load_state
from emu_dialog_key import deliver_key

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--final',action='store_true')
args=parser.parse_args()
earth=Path(__file__).resolve().parent.parent/'earth'
for name,scan,ascii_char in [('A',0x1E,97),('Enter',0x1C,13),
                             ('Space',0x39,32),('G',0x22,103),('Escape',1,27),*([('Q',0x10,113)] if args.final else [])]:
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(earth),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    def run():
        reason,_=run_fast(cpu,mem,ports,handler,1000000,
                         bp_set={(0x35155 if args.final else 0x348FD)-0x6100},timer_period=1000,
                         tick_addr=0x4FC80+0xEE78,isr_divisor=200)
        assert reason in ('max_steps','breakpoint'),reason
        return reason=='breakpoint'
    deliver_key(cpu,mem,ports,handler,scan,ascii_char)
    pressed=run()
    assert pressed==(name=='Escape'),(name,'press',pressed)
    if not pressed:
        deliver_key(cpu,mem,ports,handler,scan|128,0)
        released=run()
        expected=name in ('G','Q') if args.final else name!='A'
        assert released==expected,(name,'release',released)
        if args.final and released:assert mem.read16(0x4FC80+0x50F6)==int(name=='G')
    print(f'{name}: '+('exits on press' if pressed else 'stays open' if not released else 'exits after release'))
