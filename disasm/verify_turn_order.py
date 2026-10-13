#!/usr/bin/env python3
"""Run EXE shuffle-mode kernels, checking slots, starter and subsequent RNG."""
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
cases = [dict(seed=seed, count=count, mode=mode, last=last)
         for seed in (0, 1, 42, 65535) for count in (2, 3, 5, 10)
         for mode in (0, 3) for last in (-1, 0, count - 1)]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {seedRandom,random} from './web/js/utils.js';"
    "import {shuffledRoundOrder} from './web/js/turn-order.js';"
    "let input='';for await(const chunk of process.stdin) input+=chunk;"
    "console.log(JSON.stringify(JSON.parse(input).map(c=>{seedRandom(c.seed);"
    "return {...shuffledRoundOrder(c.count,c.mode,c.last),next:random(65535)};})));"
], cwd=root, input=json.dumps(cases), text=True))
for case, port in zip(cases, actual):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    load_exe(root / 'earth/SCORCH.EXE', mem)
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    ds, stack = 0x4FC80, 0x5F4A0
    mem.write16(ds + 0x519A, 0xFFFF)
    cpu.segs[:] = [0, 0, 0x5F4A, 0x4FC8]

    def call(offset, args, segment=0x2C89):
        cpu.segs[1] = segment
        cpu.ip = offset - 0x6100 - (segment << 4)
        cpu.regs[4] = 0x2400
        for i, value in enumerate([0x110, 0x60, *args]):
            mem.write16(stack + 0x2400 + 2 * i, value)

    call(0x32994, [case['seed']])
    reason, _ = run_fast(cpu, mem, ports, handler, 100000, bp_set={0x710})
    assert reason == 'breakpoint'
    for offset, value in ((0x50D4, case['count']), (0x519C, case['mode']), (0x51A4, case['last'])):
        mem.write16(ds + offset, value & 0xFFFF)
    for i in range(case['count']):
        mem.write16(ds + 0xD568 + i * 0xCA + 0xA0, i)
    call(0x2AE53, [], 0x2431)
    reason, _ = run_fast(cpu, mem, ports, handler, 100000, bp_set={0x2B133 - 0x6100})
    assert reason == 'breakpoint', (case, reason)
    slots = [(mem.read16(ds + 0xE4F6 + i * 4) - 0xD568) // 0xCA for i in range(case['count'])]
    last = mem.read16(ds + 0x51A4)
    if last >= 0x8000:
        last -= 65536
    expected = dict(slots=slots, start=mem.read16(ds + 0xE4F4), lastFirst=last)
    call(0x32E1B, [65535])
    reason, _ = run_fast(cpu, mem, ports, handler, 10000, bp_set={0x710})
    assert reason == 'breakpoint'
    expected['next'] = cpu.ax
    assert port == expected, (case, port, expected)
print(f'{len(cases)} shuffle-mode cases match EXE slots, starter, tracking and next RNG.')
