#!/usr/bin/env python3
"""Verify renderer tables against EXE bytes; optionally audit initialized names."""
import argparse
import json
from pathlib import Path
import re
import struct
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--state', help='Initialized emulator checkpoint for weapon names')
args = parser.parse_args()
exe = (root / 'earth/SCORCH.EXE').read_bytes()
weapons = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {WEAPONS} from './web/js/weapons.js'; console.log(JSON.stringify(WEAPONS));"
], cwd=root, text=True))
assert len(weapons) == 50, '48 EXE items plus two internal slots'
for i, weapon in enumerate(weapons[2:]):
    expected = struct.unpack_from('<5Hh', exe, 0x56F76 + i * 52 + 4)
    actual = tuple(weapon[key] for key in
                   ('price', 'bundle', 'arms', 'bhv', 'handlerSegment', 'param'))
    assert actual == expected, (i, actual, expected)

source = (root / 'web/js/hud.js').read_text()
icons = json.loads(re.search(r'const UI_ICONS = (\[.*?\]);', source, re.S)[1])
assert len(icons) == 12
for i, icon in enumerate(icons):
    record = exe[0x58FCA + i * 125:0x58FCA + (i + 1) * 125]
    samples = [
        value if value < 128 else value - 256
        for value in record[3:record.index(0x9D, 3)]]
    assert icon == dict(x=record[0], y=record[1], w=record[2],
                        h=(len(samples) + record[2] - 1) // record[2], px=samples), i

source = (root / 'web/js/tank.js').read_text()
tanks = json.loads(re.search(r'export const TANK_TYPES = (\[.*?\]);', source, re.S)[1])
assert len(tanks) == 7
for i, tank in enumerate(tanks):
    table = 0x55D80 + 0x673E + i * 18
    offset = struct.unpack_from('<H', exe, table)[0]
    cursor = 0x55D80 + offset
    pixels = []
    while exe[cursor] != 99:
        pixels.append(list(struct.unpack_from('bbb', exe, cursor)))
        cursor += 3
    assert tank['pixels'] == pixels, i
    geometry = struct.unpack_from('<4h', exe, table - 10)
    assert tuple(tank[key] for key in
                 ('barrelLen', 'barrelXOff', 'barrelYOff', 'halfWidth')) == geometry, i

if args.state:
    from emu.cpu import CPU
    from emu.memory import Memory
    from emu.ports import PortIO
    from emu.interrupts import InterruptHandler
    from emu.state import load_state
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    load_state(args.state, cpu, mem, ports, handler)
    ds = cpu.segs[3] << 4
    assert mem.read16(ds + 0x1BB6) == 48
    for i, weapon in enumerate(weapons[2:]):
        address = ds + 0x11F6 + i * 52
        pointer = (mem.read16(address + 2) << 4) + mem.read16(address)
        name = bytearray()
        for j in range(100):
            value = mem.read8(pointer + j)
            if not value:
                break
            name.append(value)
        assert name.decode('ascii') == weapon['name'], (i, name, weapon['name'])
    print('All 48 initialized weapon names match the checkpoint.')
print('48 weapon records, 12 UI icons and 7 tank records match EXE bytes.')
