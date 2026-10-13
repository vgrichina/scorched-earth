#!/usr/bin/env python3
"""Compare normal/Cavern placement with EXE 0x2AC02/0x2ACF7 via bitmap callbacks."""
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
width, height = 32, 64
cases = []
for shape in ('flat', 'slope', 'pit', 'holes', 'overhang'):
    pixels = [0] * (width * height)
    for y in range(38, height):
        for x in range(width):
            floor = 50 if shape == 'flat' else 45 + x // 3
            solid = y >= floor
            if shape == 'pit' and 14 <= x <= 18 and y < 60:
                solid = False
            if shape == 'holes' and (x + y) % 5 == 0 and y < 60:
                solid = False
            if shape == 'overhang' and 10 <= x <= 20 and 42 <= y <= 44:
                solid = True
            pixels[y * width + x] = 120 if solid else 0
    for tank_type in range(7):
        cases.append(dict(shape=shape, tankType=tank_type, pixels=pixels))
# Run the same irregular floor fixtures under a solid ceiling as well.
for case in list(cases):
    pixels = case['pixels'].copy()
    for y in range(38, 44):
        pixels[y * width:(y + 1) * width] = [120] * width
    cases.append(dict(case, cavern=True, pixels=pixels))
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {config} from './web/js/config.js';"
    "import {reinitTerrainBuffers,terrainBitmap,terrain} from './web/js/terrain.js';"
    "import {setupSkyPalette} from './web/js/palette.js';"
    "import {settleTankForPlacement} from './web/js/tank.js';"
    "let input='';for await(const chunk of process.stdin) input+=chunk;"
    "config.screenWidth=32;config.screenHeight=64;"
    "console.log(JSON.stringify(JSON.parse(input).map(c=>{reinitTerrainBuffers();"
    "setupSkyPalette(c.cavern?5:1);terrainBitmap.set(c.pixels);let p={x:16,tankType:c.tankType};"
    "settleTankForPlacement(p);return {y:p.y,pixels:[...terrainBitmap],heights:[...terrain]};})));"
], cwd=root, input=json.dumps(cases), text=True))
for case, port in zip(cases, actual):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    load_exe(root / 'earth/SCORCH.EXE', mem)
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    ds, stack, tank = 0x4FC80, 0x5F4A0, 0x70000
    mem.write16(ds + 0x519A, 0xFFFF)
    mem.write16(ds + 0xEF40, 38)
    mem.write16(ds + 0xEF38, height - 4)
    mem.write16(ds + 0xEEF8, 0x100)
    mem.write16(ds + 0xEEFA, 0x60)
    half_width = [4, 4, 5, 4, 5, 3, 4][case['tankType']]
    mem.write16(tank + 8, half_width)
    mem.write16(tank + 14, 16)
    cpu.segs[:] = [0, 0x24B0, 0x5F4A, 0x4FC8]
    cpu.ip, cpu.regs[4] = (0xF7 if case.get('cavern') else 2), 0x2400
    for i, value in enumerate([0x110, 0x60, 0, 0x7000]):
        mem.write16(stack + 0x2400 + i * 2, value)
    expected = case['pixels'].copy()
    for _ in range(2000):
        reason, _ = run_fast(cpu, mem, ports, handler, 10000,
                             bp_set={0x700, 0x710, 0x34A39, 0x238C0})
        assert reason == 'breakpoint', (case['shape'], reason)
        address = (cpu.segs[1] << 4) + cpu.ip
        if address == 0x710:
            break
        sp = cpu.regs[4]
        x, y = (mem.read16(stack + sp + offset) for offset in (4, 6))
        assert 0 <= x < width and 0 <= y < height, (x, y)
        if address == 0x700:
            cpu.ax = 80 if expected[y * width + x] else 146
        elif address == 0x238C0:
            expected[y * width + x] = 120
        else:
            expected[y * width + x] = 0
        cpu.ip = mem.read16(stack + sp)
        cpu.segs[1] = mem.read16(stack + sp + 2)
        cpu.regs[4] += 4
    else:
        raise AssertionError('Placement failed to finish')
    assert port['y'] == mem.read16(tank + 16), case['shape']
    assert port['pixels'] == expected, (case['shape'], case['tankType'])
    for x in range(16 - half_width, 17 + half_width):
        top = next((y for y in range(port['y'] + 1 if case.get('cavern') else 38, height) if expected[y * width + x]), height)
        assert port['heights'][x] == top
print(f'{len(cases)} placements match EXE tank Y and full terrain bitmap across all seven types.')
