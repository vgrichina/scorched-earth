#!/usr/bin/env python3
"""Compare initial aim and barrel endpoints with directly executed EXE code."""
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
positions = [dict(x=x, y=y) for x in (30, 91, 179, 268, 330) for y in (50, 82, 240, 400)]
barrels = [dict(x=180, y=240, angle=angle, tankType=kind)
           for angle in (0, 1, 27, 45, 76, 89, 90, 91, 104, 135, 153, 179, 180) for kind in range(7)]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {initializeTankAim,getTankAim,getTankBarrel} from './web/js/tank.js';"
    "const [positions,barrels]=JSON.parse(process.argv[1]);"
    "console.log(JSON.stringify({aim:positions.map(p=>{initializeTankAim(p);return getTankAim(p);}),"
    "barrels:barrels.map(getTankBarrel)}));", json.dumps([positions, barrels])
], cwd=root, text=True))
mem = Memory()
load_exe(root / 'earth/SCORCH.EXE', mem)
ds, stack, tank = 0x4FC80, 0x80000, 0x90000
mem.write16(ds + 0x519A, 0xFFFF)
mem.write16(ds + 0xEF3E, 359)
mem.write16(ds + 0xEF40, 38)
mem.write16(ds + 0xEF34, 36044)  # Default 360x480 signed 16.16 X scale.
mem.write16(ds + 0xEF36, 0)

def machine():
    cpu, ports = CPU(), PortIO()
    ports.mem = mem
    cpu.segs[:] = [0, 0x22CA, 0x8000, 0x4FC8]
    cpu.regs[4], cpu.regs[5] = 0x23BC, 0x2400
    return cpu, ports, InterruptHandler(mem, cpu, str(root / 'earth'), ports)

for point, expected in zip(positions, actual['aim']):
    cpu, ports, handler = machine()
    mem.write16(tank + 14, point['x'])
    mem.write16(tank + 16, point['y'])
    mem.write16(stack + 0x2400 - 4, 0)
    mem.write16(stack + 0x2400 - 2, 0x9000)
    cpu.ip = 0x2B1B3 - 0x6100 - 0x22CA0
    reason, detail = run_fast(cpu, mem, ports, handler, 10000, bp_set={0x2B21D - 0x6100})
    assert reason == 'breakpoint', (point, reason, detail, hex(cpu.segs[1]), hex(cpu.ip))
    angle = mem.read16(stack + 0x2400 - 8)
    direction = mem.read16(stack + 0x2400 - 10)
    direction = direction if direction < 32768 else direction - 65536
    assert expected == dict(angle=angle, direction=direction), (point, expected, angle, direction)

for point, expected in zip(barrels, actual['barrels']):
    cpu, ports, handler = machine()
    mem.data[tank:tank + 202] = bytes(202)
    # Read geometry from the binary's type table, not a duplicate JS table.
    for offset in range(0, 10, 2):
        mem.write16(tank + 2 + offset, mem.read16(ds + 0x6734 + point['tankType'] * 18 + offset))
    mem.write16(tank + 14, point['x'])
    mem.write16(tank + 16, point['y'])
    direction = 1 if point['angle'] <= 90 else -1
    angle = point['angle'] if direction == 1 else 180 - point['angle']
    mem.write16(tank + 0x92, angle)
    mem.write16(tank + 0x94, direction & 65535)
    cpu.segs[1], cpu.ip, cpu.regs[4] = 0x39A2, 0x21F, 0x2400
    for i, value in enumerate([0x110, 0x60, 0, 0x9000]):
        mem.write16(stack + 0x2400 + i * 2, value)
    reason, _ = run_fast(cpu, mem, ports, handler, 10000, bp_set={0x710})
    assert reason == 'breakpoint', (point, reason)
    assert [expected['endX'], expected['endY']] == [mem.read16(tank + 18), mem.read16(tank + 20)], (point, expected, mem.read16(tank + 18), mem.read16(tank + 20))
print(f'{len(positions)} initial aims and {len(barrels)} barrel endpoints match EXE execution.')
