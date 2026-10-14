#!/usr/bin/env python3
"""Execute full EXE order dispatch, sorter and comparator with initialized heap.

Checkpoint supplies runtime initialization only. Wins/scores, RNG seed and mode
are explicitly set; no comparator or tie-shuffle calls are intercepted.
"""
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
parser.add_argument('checkpoint')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
fixtures = [
    [(0, 0)] * 2,
    [(0, 0)] * 10,
    [(0, -100), (0, 99), (0, 99), (0, -100), (0, 1)],
    [(1, -100), (0, 999999), (2, -999999), (1, 0), (2, -1000000)],
    [(i % 3, 10 - i) for i in range(10)],
    [(0, 32767), (0, -32768), (0, -65536), (0, 65536), (0, -1)],
    [(0, 2147483647), (0, -2147483648), (0, 0)],
]
cases = [dict(scoring=scoring,seed=seed, mode=mode, players=[dict(index=i, wins=w, score=s,cash=1000*(len(f)-i),inventory=[0,0,99,i+1]) for i, (w, s) in enumerate(f)])
         for scoring in range(3) for seed in (0, 1, 42, 65535) for mode in (1, 2) for f in fixtures]
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {seedRandom,random} from './web/js/utils.js';"
    "import {config} from './web/js/config.js';"
    "import {roundOrder} from './web/js/turn-order.js';"
    "let input='';for await(const chunk of process.stdin) input+=chunk;"
    "console.log(JSON.stringify(JSON.parse(input).map(c=>{config.scoringMode=c.scoring;seedRandom(c.seed);"
    "return {...roundOrder(c.players,c.mode),next:random(65535)};})));"
], cwd=root, input=json.dumps(cases), text=True))
for case, port in zip(cases, actual):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    load_state(args.checkpoint, cpu, mem, ports, handler)
    ds, stack = 0x4FC80, 0x80000
    mem.write16(ds + 0x519A, 0xFFFF)
    cpu.segs[:] = [0, 0, 0x8000, 0x4FC8]

    def call(offset, segment, arguments=(), stop=0x710):
        cpu.segs[1] = segment
        cpu.ip = offset - 0x6100 - (segment << 4)
        cpu.regs[4] = 0x2400
        for i, value in enumerate([0x110, 0x60, *arguments]):
            mem.write16(stack + 0x2400 + 2 * i, value & 65535)
        reason, _ = run_fast(cpu, mem, ports, handler, 2000000, bp_set={stop})
        assert reason == 'breakpoint', (case, hex(offset), reason)

    count = len(case['players'])
    for offset, value in ((0x50D4, count), (0x519C, case['mode']), (0x51A4, 65535), (0x5148, case['scoring']), (0x50EA,0)):
        mem.write16(ds + offset, value)
    for player in case['players']:
        offset = 0xD568 + player['index'] * 0xCA
        mem.write16(ds + offset + 0xA0, player['index'])
        mem.write16(ds + offset + 0xAC, player['wins'])
        # Construct the EXE's arbitrary-precision score using its own long ctor.
        call(0x11B2C, 0xB87, [offset + 0xBA, 0x4FC8, player['score'] & 65535, (player['score'] >> 16) & 65535])
        call(0x11B2C,0xB87,[offset+0xBE,0x4FC8,player['cash'],0])
        inv=0x94000+128*player['index']
        for item in range(48):mem.write16(inv+2*item,player['inventory'][item+2] if item<2 else 0)
        mem.write16(ds+offset+0xB2,128*player['index']);mem.write16(ds+offset+0xB4,0x9400)
    call(0x32994, 0x2C89, [case['seed']])
    call(0x2AE53, 0x2431, stop=0x2B133 - 0x6100)
    slots = [(mem.read16(ds + 0xE4F6 + i * 4) - 0xD568) // 0xCA for i in range(count)]
    expected = dict(slots=slots, start=mem.read16(ds + 0xE4F4), lastFirst=-1)
    call(0x32E1B, 0x2C89, [65535])
    expected['next'] = cpu.ax
    assert port == expected, (case, port, expected)
print(f'{len(cases)} score-order cases match full EXE dispatch, slots, starter and next RNG.')
values = [-2147483648, -1000000, -65536, -32769, -32768, -1, 0, 1, 32767, 32768, 65536, 1000000, 2147483647]
pairs = [(a, b) for a in values for b in values]
comparisons = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {compareRoundPlayers} from './web/js/turn-order.js';"
    "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(([a,b])=>"
    "compareRoundPlayers({wins:0,score:a},{wins:0,score:b}))));", json.dumps(pairs)
], cwd=root, text=True))
mem.write16(ds+0x5148,0)
for (a, b), expected in zip(pairs, comparisons):
    for i, score in enumerate((a, b)):
        offset = 0xD568 + i * 0xCA
        mem.write16(ds + offset + 0xAC, 0)
        call(0x11B2C, 0xB87, [offset + 0xBA, 0x4FC8, score & 65535, (score >> 16) & 65535])
    call(0x317D1, 0x2AA6, [0xD568, 0x4FC8, 0xD632, 0x4FC8])
    result = cpu.ax if cpu.ax < 32768 else cpu.ax - 65536
    assert result == expected, (a, b, result, expected)
print(f'{len(pairs)} score comparisons match EXE, including limb/sign/overflow boundaries.')
