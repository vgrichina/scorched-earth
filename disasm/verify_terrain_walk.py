#!/usr/bin/env python3
"""Execute the EXE random-walk kernel and compare actual terrain.js output.

Only drawColumn is intercepted; the EXE runs its own seeding and RNG code.
No checkpoint heights or separately translated terrain algorithm are used.
"""
import argparse
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--menu", action="store_true", help="Check menu preview bounds and fixed settings")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
cases = [dict(seed=seed, width=width, height=height, land1=land1, land2=land2, flattenPeaks=flat)
         for seed in (0, 1, 42, 65535)
         for width, height in ((320, 200), (360, 480), (640, 400))
         for land1, land2, flat in ((20, 20, False), (0, 100, False), (100, 100, False), (100, 100, True))]
if args.menu:
    cases = [dict(seed=seed, width=w, height=h, land1=20, land2=20, flattenPeaks=False)
             for seed in (0, 1, 42, 65535)
             for w,h in ((320,200),(320,240),(320,400),(320,480),(360,480),(640,400),(640,480),(800,600),(1024,768))]
for case in cases:
    case.update(left=(96 if case['height']==200 else 110) if args.menu else 3, top=7 if args.menu else 38,
                right=case['width']-(8 if args.menu else 4),
                bottom=case['height']-(52 if args.menu and case['width']==320 and case['height']!=200 else 38 if args.menu else 4),
                menu=args.menu)
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {config} from './web/js/config.js';"
    "import {seedRandom,random} from './web/js/utils.js';"
    "import {reinitTerrainBuffers,generateTerrain,generateMenuTerrain,terrain} from './web/js/terrain.js';"
    "let input='';for await(const chunk of process.stdin) input+=chunk;"
    "console.log(JSON.stringify(JSON.parse(input).map(c=>{"
    "Object.assign(config,c,{screenWidth:c.width,screenHeight:c.height,landType:2});"
    "reinitTerrainBuffers();seedRandom(c.seed);if(c.menu){config.land1=0;config.land2=100;config.flattenPeaks=true;generateMenuTerrain(c.left,c.top,c.right,c.bottom);}else generateTerrain();"
    "return {heights:[...terrain],next:random(65535)};})));"
], cwd=root, input=json.dumps(cases), text=True))
for case, port in zip(cases, actual):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    load_exe(root / 'earth/SCORCH.EXE', mem)
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    ds, stack, generator = 0x4FC80, 0x5F4A0, 0x70000
    mem.write16(ds + 0x519A, 0xFFFF)
    cpu.segs[:] = [0, 0, 0x5F4A, 0x4FC8]

    def call(file_offset, args):
        # Keep relative near calls before the entry within the code segment.
        cpu.segs[1] = 0x2000 if file_offset == 0x29808 else 0x2C89
        cpu.ip = file_offset - 0x6100 - (cpu.segs[1] << 4)
        cpu.regs[4] = 0x2400
        for i, value in enumerate([0x110, 0x60, *args]):
            mem.write16(stack + 0x2400 + 2 * i, value)

    call(0x32994, [case['seed']])
    reason, _ = run_fast(cpu, mem, ports, handler, 100000, bp_set={0x710})
    assert reason == 'breakpoint', ('seed', reason)
    for offset, value in ((8, 1), (10, case['land1']), (12, case['land2']), (14, int(case['flattenPeaks']))):
        mem.write16(generator + offset, value)
    call(0x29808, [0, 0x7000, case['left'], case['bottom'], case['right'], case['top']])
    expected = [case['bottom']] * case['width']
    count = 0
    for _ in range(case['width'] + 1):
        reason, _ = run_fast(cpu, mem, ports, handler, 100000, bp_set={0x710, 0x29720 - 0x6100})
        assert reason == 'breakpoint', ('walk', reason)
        if (cpu.segs[1] << 4) + cpu.ip == 0x710:
            break
        sp = cpu.regs[4]
        x, y = (mem.read16(stack + sp + offset) for offset in (8, 10))
        assert x == count + case['left'], (x, count)
        expected[x] = y
        count += 1
        cpu.ip = mem.read16(stack + sp)
        cpu.segs[1] = mem.read16(stack + sp + 2)
        cpu.regs[4] += 4
    assert count == case['right'] - case['left'] + 1
    if port['heights'] != expected:
        x = next(x for x in range(case['width']) if port['heights'][x] != expected[x])
        raise AssertionError((case, 'column', x, 'web', port['heights'][x], 'EXE', expected[x]))
    call(0x32E1B, [65535])
    reason, _ = run_fast(cpu, mem, ports, handler, 10000, bp_set={0x710})
    assert reason == 'breakpoint'
    assert port['next'] == cpu.ax, (case, 'RNG consumption differs')
print(f'{len(cases)} seeded {"menu" if args.menu else "gameplay"} terrain walks match every EXE column and subsequent RNG output.')
