#!/usr/bin/env python3
"""Check EXE probability branch, file index and RNG continuation (not MTN drawing)."""
import json
from pathlib import Path
import struct
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root = Path(__file__).resolve().parent.parent
cases = [dict(seed=seed, sky=sky, percent=percent, count=count)
         for seed in range(16) for sky in (0, 5, 7)
         for percent in (0, 20, 100) for count in (0, 1, 10)]
# Force exact probability boundaries, including the inclusive 0 and 100 ends.
cases += [dict(seed=1, sky=0, percent=word / 65535 * 100 + delta,
               count=10, word=word)
          for word in (0, 1, 32768, 65535) for delta in (-1e-9, 0, 1e-9)]
# Boundary cases inject the first R250 word only on the EXE side.
mem = Memory()
load_exe(root / 'earth/SCORCH.EXE', mem)
ds = 0x4FC80
mem.write16(ds + 0x519A, 65535)
cpu, ports = CPU(), PortIO()
ports.mem = mem
handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
cpu.segs[:] = [0, 0, 0x8000, 0x4FC8]

def call(offset, segment, arguments=(), stops=(0x710,)):
    cpu.segs[1] = segment
    cpu.ip = offset - 0x6100 - segment * 16
    cpu.regs[4] = 0x2400
    cpu.regs[5] = 0x2500  # scratch BP frame for the landscape fragment
    for i, value in enumerate([0x110, 0x60, *arguments]):
        mem.write16(0x82400 + i * 2, value)
    reason, _ = run_fast(cpu, mem, ports, handler, 100000, bp_set=set(stops))
    assert reason == 'breakpoint', (hex(offset), reason)
    return cpu.segs[1] * 16 + cpu.ip

# Injected words are checked against the actual branch separately. Production
# selection is compared over seeded cases without any injected RNG state.
seeded = [c for c in cases if 'word' not in c]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {selectScannedMountain} from './web/js/mountain-selection.js';"
    "import {seedRandom,random} from './web/js/utils.js';"
    "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{seedRandom(c.seed);"
    "return {index:selectScannedMountain(c.sky,c.percent,c.count),next:random(65535)};})));",
    json.dumps(seeded)
], cwd=root, text=True))
for i, case in enumerate(cases):
    call(0x32994, 0x2C89, [case['seed']])
    if 'word' in case:
        mem.write16(ds + 0xEA12, case['word'])
        mem.write16(ds + 0xEA12 + 103 * 2, 0)
    mem.write16(ds + 0x5110, case['sky'])
    mem.write16(ds + 0xE1EA, int(case['count'] > 0))
    struct.pack_into('<d', mem.data, ds + 0x5132, case['percent'])
    stop = call(0x29488, 0x22CA, stops=(0x294B1 - 0x6100, 0x294C5 - 0x6100))
    index = -1
    if stop == 0x294C5 - 0x6100:
        mem.write16(ds + 0x5F54, case['count'])
        call(0x33416, 0x2CD4, [0xD4CE, 0x4FC8], stops=(0x33444 - 0x6100,))
        index = cpu.ax
    if 'word' in case:
        assert (index >= 0) == (case['word'] / 65535 * 100 <= case['percent']), case
    else:
        call(0x32E1B, 0x2C89, [65535])
        assert actual[i] == dict(index=index, next=cpu.ax), (case, actual[i], index, cpu.ax)
print(f'{len(seeded)} seeded mountain selections and RNG continuations match EXE; '
      f'{len(cases)-len(seeded)} inclusive probability boundary checks pass.')

sky_cases = [dict(seed=seed, allow=allow) for seed in range(32) for allow in (True, False)]
sky_actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {setupSkyPalette,resolvedSkyType} from './web/js/palette.js';"
    "import {seedRandom,random} from './web/js/utils.js';"
    "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{seedRandom(c.seed);"
    "setupSkyPalette(7,{allowCavern:c.allow});return {sky:resolvedSkyType,next:random(65535)};})));",
    json.dumps(sky_cases)
], cwd=root, text=True))
for case, port in zip(sky_cases, sky_actual):
    call(0x32994, 0x2C89, [case['seed']])
    mem.write16(ds + 0x621A, int(not case['allow']))
    call(0x3978E, 0x3352, stops=(0x397A9 - 0x6100,))
    sky = mem.read16(ds + 0x5110)
    call(0x32E1B, 0x2C89, [65535])
    assert port == dict(sky=sky, next=cpu.ax), (case, port, sky, cpu.ax)
print('64 Random sky eligibility cases match EXE resolution and RNG continuation.')
