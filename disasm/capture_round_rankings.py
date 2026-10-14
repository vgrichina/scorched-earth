#!/usr/bin/env python3
"""Capture native standard rankings from a completed-shot checkpoint.

Enters the real round wrapper at 0x2AA7A: scoring, completed-round increment,
rankings construction and rendering all execute without intercepted callees.
This captures a reference, not a port pixel comparison or the shot-return path.
"""
import argparse
from pathlib import Path
from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.execute import run_fast
from emu.state import load_state, save_state

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('output', help='Output prefix for .state and .png')
parser.add_argument('--completed', type=int, default=0)
parser.add_argument('--rounds', type=int, default=10)
args = parser.parse_args()
if not 0 <= args.completed < args.rounds:
    parser.error('Completed rounds must be below the total round count')
root = Path(__file__).resolve().parent.parent
mem, cpu, ports = Memory(), CPU(), PortIO()
ports.mem = mem
handler = InterruptHandler(mem, cpu, str(root/'earth'), ports)
load_state(args.checkpoint, cpu, mem, ports, handler)
ds, stack = 0x4FC80, 0x5F4A0
count = mem.read16(ds+0x50D4)
alive = sum(bool(mem.read16(ds+0xD568+i*0xCA+0x18)) for i in range(count))
for offset, value in ((0xE342, args.completed), (0xE340, alive),
                      (0x5160, args.rounds), (0x50EA, 0), (0x50F6, 0),
                      (0x519A, 65535)):
    mem.write16(ds+offset, value)

def rng():
    return [mem.read16(ds+0xEA12+2*i) for i in range(250)] + [mem.read16(ds+0xEC06)]

before = rng()
cpu.segs[:] = [0, 0x200F, 0x5F4A, 0x4FC8]
cpu.ip = 0x2AA7A-0x6100-0x200F0
cpu.regs[4] = 0x2400
mem.write16(stack+0x2400, 0x110)
mem.write16(stack+0x2402, 0x60)
reason, count = run_fast(cpu, mem, ports, handler, 20000000,
                        bp_set={0x710, 0x460C3-0x6100, 0x32E1B-0x6100})
address = cpu.segs[1]*16+cpu.ip+0x6100
assert reason == 'breakpoint' and address == 0x460C3, (reason, hex(address), count)
assert rng() == before, 'Native rankings unexpectedly changed RNG'
assert mem.read16(ds+0xE342) == args.completed+1
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
save_state(args.output+'.state', cpu, mem, ports, handler)
mem.dump_screen_png(args.output+'.png', ports)
print(f'Native scoring and rankings reached input-ready state in {count} instructions; full RNG unchanged.')
print(f'Wrote {args.output}.state and {args.output}.png')
