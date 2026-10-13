#!/usr/bin/env python3
"""Compare the port's callback line iterator directly with EXE 0x1E2E3."""
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root = Path(__file__).resolve().parent.parent
mem = Memory()
load_exe(root / 'earth/SCORCH.EXE', mem)
mem.write16((0x4FC8 << 4) + 0x519A, 0xFFFF)  # runtime stack guard
cases = [(100, 100, 100 + x, 100 + y) for x in range(-8, 9) for y in range(-8, 9)]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {walkExeLine} from './web/js/utils.js'; "
    "const cases=JSON.parse(process.argv[1]); console.log(JSON.stringify(cases.map(c=>{"
    "const points=[];walkExeLine(...c,(x,y)=>{points.push([x,y]);});return points;})));",
    json.dumps(cases)
], cwd=root, text=True))
for case, port_points in zip(cases, actual):
    cpu, ports = CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    cpu.segs[:] = [0, 0x17AB, 0x5F4A, 0x4FC8]
    cpu.ip = 0x0733
    cpu.regs[4] = 0x2400
    stack = cpu.segs[2] << 4
    # Synthetic far call, stopping at callback/return before executing either.
    for i, value in enumerate([0x110, 0x60, *case, 0x100, 0x60]):
        mem.write16(stack + 0x2400 + i * 2, value)
    expected = []
    while True:
        reason, _ = run_fast(cpu, mem, ports, handler, 10000, bp_set={0x700, 0x710})
        assert reason == 'breakpoint', (case, reason, hex(cpu.segs[1]),hex(cpu.ip),hex(cpu.regs[4]))
        if cpu.segs[1] == 0x60 and cpu.ip == 0x110:
            break
        sp = cpu.regs[4]
        expected.append([mem.read16(stack + sp + 4), mem.read16(stack + sp + 6)])
        cpu.ax = 1
        cpu.ip = mem.read16(stack + sp)
        cpu.segs[1] = mem.read16(stack + sp + 2)
        cpu.regs[4] += 4
    assert port_points == expected, (case, port_points, expected)
print(f'{len(cases)} line paths match EXE execution, including all octants, ties and zero length.')
