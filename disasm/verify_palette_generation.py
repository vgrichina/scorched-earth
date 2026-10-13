#!/usr/bin/env python3
"""Execute EXE palette generation and compare production JS, without palette injection."""
import argparse
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint', help='Initialized pre-walk checkpoint from verify_terrain_frame.py')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
cases = [(sky, seed) for sky in range(7) for seed in ((0, 1, 42, 65535) if sky == 5 else (42,))]
cases += [(7, seed) for seed in (0, 1, 42, 65535)]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {seedRandom} from './web/js/utils.js';"
    "import {initPalette,palette6,resolvedSkyType} from './web/js/palette.js';"
    "import {initSkyBackground} from './web/js/terrain.js';"
    "import {clearToBackground,pixels} from './web/js/framebuffer.js';"
    "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(([sky,seed])=>{"
    "seedRandom(seed);initPalette(2,sky);initSkyBackground();clearToBackground();return {palette:[...palette6],resolved:resolvedSkyType,rows:Array.from({length:480},(_,y)=>pixels[y*360]+40)};})));", json.dumps(cases)
], cwd=root, text=True))
for (sky, seed), result in zip(cases, actual):
    port = result['palette']
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    load_state(args.checkpoint, cpu, mem, ports, handler)
    ds, stack = cpu.segs[3] << 4, cpu.segs[2] << 4
    mem.write16(ds + 0x519A, 0xFFFF)

    def call(offset, segment, arguments=()):
        cpu.segs[1], cpu.ip = segment, offset - 0x6100 - (segment << 4)
        cpu.regs[4] = 0x2400
        for i, value in enumerate([0x110, 0x60, *arguments]):
            mem.write16(stack + 0x2400 + i * 2, value)
        reason, _ = run_fast(cpu, mem, ports, handler, 10000000, bp_set={0x710})
        assert reason == 'breakpoint', (hex(offset), reason)

    call(0x32994, 0x2C89, [seed])
    call(0x2923C, 0x22CA)
    expected_ground = [mem.read16(ds + offset) for offset in (0xDD4C, 0xDD4E, 0xDD50)]
    mem.write16(ds + 0x5110, sky)
    mem.write16(ds + 0x623C, int(sky == 7))  # Disable the previous round's Random selection flag.
    mem.write16(ds + 0x624E, 0xFFFF)  # Invalidate cached selection.
    call(0x3971F, 0x3352)
    resolved = mem.read16(ds + 0x5110)
    assert resolved == result['resolved'], (sky, seed, resolved, result['resolved'])
    # Plain writes/uses only entry 120; the other 29 DAC entries remain stale.
    count = 1 if resolved == 0 else 30
    expected = [v for rgb in ports.palette[120:120 + count] for v in rgb]
    assert port[240:240 + count * 3] == expected, (sky, seed, 'sky palette', port[240:240 + count * 3], expected)
    if resolved == 6:
        assert port[:240] == [v for rgb in ports.palette[:80] for v in rgb], 'Black tank colors'
        assert port[360:450] == list(ports.palette[80]) * 30, 'Black ground colors'
    else:
        assert port[360:450] == expected_ground * 30, (sky, seed, 'ground color')
    if resolved in (1, 4, 5, 6):
        row_pointer = mem.read16(ds + 0x6242) + (mem.read16(ds + 0x6244) << 4)
        top, bottom = mem.read16(ds + 0xEF40), mem.read16(ds + 0xEF38)
        expected_rows = [mem.read16(row_pointer + y * 2) for y in range(top, bottom + 1)]
        assert result['rows'][top:bottom + 1] == expected_rows, (sky, seed, 'sky row mapping')
    print(f'Sky {sky}, seed {seed}: palette and applicable sky rows match EXE.', flush=True)
