#!/usr/bin/env python3
"""Verify EXE generation wrapper pass order, heights and alternating direction.

Intercept palette setup and drawing; run the real wrapper, walk and RNG.
Palette generation is tested separately by verify_palette_generation.py.
"""
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
cases = [dict(seed=seed, width=w, height=h, sky=sky)
         for seed in (0, 1, 42, 65535) for w, h in ((320, 200), (360, 480), (640, 400))
         for sky in (1, 5)]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {config} from './web/js/config.js';"
    "import {seedRandom,random} from './web/js/utils.js';"
    "import {setupSkyPalette} from './web/js/palette.js';"
    "import * as t from './web/js/terrain.js';"
    "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{"
    "Object.assign(config,{screenWidth:c.width,screenHeight:c.height,landType:2,land1:20,land2:20,flattenPeaks:false});"
    "t.reinitTerrainBuffers();setupSkyPalette(c.sky);seedRandom(c.seed);const rounds=[];"
    "for(let r=0;r<2;r++){t.generateTerrain();rounds.push({floor:[...t.terrain],ceiling:[...t.ceilingTerrain]});}"
    "return {rounds,next:random(65535)};})));", json.dumps(cases)
], cwd=root, text=True))
for case, port in zip(cases, actual):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    load_exe(root / 'earth/SCORCH.EXE', mem)
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    ds, stack, generator = 0x4FC80, 0x5F4A0, 0x70000
    mem.write16(ds + 0x519A, 0xFFFF)
    mem.write16(ds + 0x5110, case['sky'])
    mem.write16(ds + 0x50D8, int(case['sky'] == 5))
    cpu.segs[:] = [0, 0, 0x5F4A, 0x4FC8]
    for offset, value in ((0, 0x508C), (2, 0), (8, 0xFFFF), (10, 20), (12, 20), (14, 0)):
        mem.write16(generator + offset, value)

    def call(offset, segment, arguments):
        cpu.segs[1], cpu.ip = segment, offset - 0x6100 - (segment << 4)
        cpu.regs[4] = 0x2400
        for i, value in enumerate([0x110, 0x60, *arguments]):
            mem.write16(stack + 0x2400 + 2 * i, value)

    def ret():
        sp = cpu.regs[4]
        cpu.ip = mem.read16(stack + sp)
        cpu.segs[1] = mem.read16(stack + sp + 2)
        cpu.regs[4] += 4

    call(0x32994, 0x2C89, [case['seed']])
    assert run_fast(cpu, mem, ports, handler, 100000, bp_set={0x710})[0] == 'breakpoint'
    for round_index in range(2):
        width, height = case['width'], case['height']
        call(0x295DF, 0x22CA, [0, 0x7000, 3, height - 4, width - 4, 38])
        columns = []
        # Skip palette generation, RGB write, and drawing-color selection only.
        breaks = {0x710, *(offset - 0x6100 for offset in (0x3971F, 0x4C0B5, 0x29665, 0x29720))}
        for _ in range(width * 2 + 10):
            reason, _ = run_fast(cpu, mem, ports, handler, 100000, bp_set=breaks)
            assert reason == 'breakpoint', (case, reason)
            address = (cpu.segs[1] << 4) + cpu.ip
            if address == 0x710:
                break
            if address == 0x29665 - 0x6100:
                cpu.ip += 8
                continue
            if address == 0x29720 - 0x6100:
                sp = cpu.regs[4]
                x, y = mem.read16(stack + sp + 8), mem.read16(stack + sp + 10)
                columns.append((mem.read16(generator + 2), x, y))
            ret()
        else:
            raise AssertionError('Wrapper did not return')
        passes = 2 if case['sky'] == 5 else 1
        order = list(range(3, width - 3))
        if round_index == 1:
            order.reverse()
        assert [x for _, x, _ in columns] == order * passes, (case, round_index, 'direction')
        assert [flag for flag, _, _ in columns] == [0] * len(order) + ([1] * len(order) if passes == 2 else [])
        for flag, x, y in columns:
            actual_y = port['rounds'][round_index]['ceiling' if flag else 'floor'][x]
            assert actual_y == y - int(bool(flag)), (case, round_index, flag, x, actual_y, y)
    call(0x32E1B, 0x2C89, [65535])
    assert run_fast(cpu, mem, ports, handler, 10000, bp_set={0x710})[0] == 'breakpoint'
    assert cpu.ax == port['next'], (case, 'RNG consumption')
print(f'{len(cases) * 2} rounds match EXE pass order, direction, floor/ceiling heights and RNG consumption.')
