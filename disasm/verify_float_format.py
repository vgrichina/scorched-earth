#!/usr/bin/env python3
"""Run the native Borland sprintf used by numeric menu widgets.

Requires an initialized checkpoint for the runtime's locale and dispatch table.
Checks decimal output; does not claim full x87 precision or exception support.
"""
import argparse
from pathlib import Path
from compare_pipeline import Memory, CPU, PortIO, InterruptHandler, load_state
from emu.execute import run_fast

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
cases = [(0, 2, '0.00'), (.01, 2, '0.01'), (.12, 2, '0.12'),
         (.3, 2, '0.30'), (-.3, 2, '-0.30'), (1.25, 2, '1.25'),
         (123456.75, 2, '123456.75'), (1.125, 3, '1.125'),
         (-12.5, 1, '-12.5'), (42, 0, '42')]
for value, precision, expected in cases:
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root/'earth'), ports)
    load_state(args.checkpoint, cpu, mem, ports, handler)
    # Native sprintf at file C154, with isolated argument/output buffers.
    cpu.segs[:] = [0, 0x90, 0x9000, 0x4fc8]
    cpu.ip, cpu.regs[4] = 0x5754, 0x2400
    mem.load_bytes(0x80100, b'%.*lf\0')
    for i, word in enumerate([0x110, 0x60, 0, 0x8000, 0x100, 0x8000, precision]):
        mem.write16(0x92400+2*i, word)
    mem.write_float64(0x9240e, value)
    reason, steps = run_fast(cpu, mem, ports, handler, 100000, bp_set={0x710})
    assert reason == 'breakpoint', (value, precision, reason, steps)
    actual = mem.read_bytes(0x80000, 64).split(b'\0')[0].decode('ascii')
    assert actual == expected, (value, precision, actual, expected)
print(f'{len(cases)} native sprintf decimal cases match.')
