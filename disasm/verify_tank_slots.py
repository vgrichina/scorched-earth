#!/usr/bin/env python3
"""Compare spawn slot geometry with EXE arithmetic at 0x2B13E..0x2B15D."""
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
cases = [(width, count) for width in (320, 360, 640, 800, 1024) for count in range(2, 11)]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {config} from './web/js/config.js';"
    "import {getTankPlacementX} from './web/js/tank.js';"
    "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(([w,n])=>{"
    "config.screenWidth=w;return Array.from({length:n},(_,i)=>getTankPlacementX(i,n));})));", json.dumps(cases)
], cwd=root, text=True))
mem = Memory()
load_exe(root / 'earth/SCORCH.EXE', mem)
for (width, count), positions in zip(cases, actual):
    cpu, ports = CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    cpu.segs[:] = [0, 0x22CA, 0x5F4A, 0x4FC8]
    cpu.ip = 0x2B13E - 0x6100 - 0x22CA0
    cpu.regs[5] = 0x2400
    for offset, value in ((0xEF3C, width - 4), (0xEF42, 3), (0xE340, count)):
        mem.write16(0x4FC80 + offset, value)
    reason, _ = run_fast(cpu, mem, ports, handler, 100, bp_set={0x2B15D - 0x6100})
    assert reason == 'breakpoint'
    first = mem.read16(0x5F4A0 + 0x2400 - 14)
    spacing = mem.read16(0x5F4A0 + 0x2400 - 12)
    assert positions[0] == first
    assert all(b - a == spacing for a, b in zip(positions, positions[1:]))
print(f'{len(cases)} spawn layouts match EXE first-slot and spacing arithmetic.')
