#!/usr/bin/env python3
"""Exercise the EXE's atan2 wrapper, including its Borland unary atan extension."""
import math
from pathlib import Path
import struct
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root = Path(__file__).resolve().parent.parent
cases = [(y, x) for y in (-362., -44., 0., 44., 362.) for x in (-88., -1., 0., 1., 88.) if x or y]
for y, x in cases:
    mem, cpu, ports = Memory(), CPU(), PortIO()
    load_exe(root / 'earth/SCORCH.EXE', mem)
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    cpu.segs[:] = [0, 0x90, 0x8000, 0x4FC8]
    cpu.ip, cpu.regs[4] = 0x1421, 0x2400
    mem.write16(0x82400, 0x110)
    mem.write16(0x82402, 0x60)
    mem.data[0x82404:0x82414] = struct.pack('<dd', y, x)
    reason, _ = run_fast(cpu, mem, ports, handler, 10000, bp_set={0x710})
    assert reason == 'breakpoint', (y, x, reason)
    actual = cpu.fpu_pop()
    assert math.isclose(actual, math.atan2(y, x), abs_tol=1e-14), (y, x, actual, math.atan2(y, x))
print(f'{len(cases)} EXE atan2 cases match across quadrants and axes.')
