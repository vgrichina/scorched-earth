#!/usr/bin/env python3
"""Compare survivor award amounts with native standard round completion at 0x37473.

Executes the native arithmetic and intercepts add_score at its entry. Does not
verify score storage, nonstandard scoring modes, round-end UI or timing.
"""
import json
import subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root = Path(__file__).resolve().parent.parent
cases = [dict(teams=teams, round=r, hp=hp, shields=[55, 150, 0])
         for teams in (False, True) for r in (0, 1, 3, 8, 17, 60)
         for hp in ([58, 100, 0], [1, 0, 0], [0, 0, 0])]
actual = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', r'''
import {config} from './web/js/config.js';
import {players,createPlayer} from './web/js/tank.js';
import {endOfRoundScoring} from './web/js/score.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 config.scoringMode=0;
 players.splice(0,players.length,...c.hp.map((energy,i)=>Object.assign(createPlayer(i,'Tank'),
  {energy,alive:energy>0,shieldEnergy:c.shields[i],team:c.teams?0:i,score:0,wins:0})));
 endOfRoundScoring(c.round);
 return {awards:players.filter(p=>p.alive).map(p=>[p.index,p.score]),wins:players.map(p=>p.wins)};
})));
'''], cwd=root, input=json.dumps(cases), text=True))

for case, port in zip(cases, actual):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    load_exe(root/'earth/SCORCH.EXE', mem)
    handler = InterruptHandler(mem, cpu, str(root/'earth'), ports)
    ds, stack = 0x4FC80, 0x5F4A0
    for off, value in ((0x519A, 65535), (0x50D4, 3),
                       (0x50EA, 0), (0x5148, int(case['teams'])), (0xE340, sum(hp > 0 for hp in case['hp']))):
        mem.write16(ds+off, value)
    for i, hp in enumerate(case['hp']):
        base = ds+0xD568+i*0xCA
        for off, value in ((0x18, int(hp > 0)), (0xA2, hp), (0xA4, 0),
                           (0xAC, 0), (0x96, case['shields'][i])):
            mem.write16(base+off, value)
    cpu.segs[:] = [0, 0x3128, 0x5F4A, 0x4FC8]
    cpu.ip = 0x37473-0x6100-0x31280
    cpu.regs[4] = 0x2400
    mem.write16(stack+0x2400, 0x110)
    mem.write16(stack+0x2402, 0x60)
    awards = []
    for _ in range(4):
        reason, _ = run_fast(cpu, mem, ports, handler, 100000,
                             bp_set={0x710, 0x377D9-0x6100})
        address = cpu.segs[1]*16+cpu.ip
        assert reason == 'breakpoint', (case, reason, hex(address))
        if address == 0x710:
            break
        sp = stack+cpu.regs[4]
        index = (mem.read16(sp+4)-0xD568)//0xCA
        amount = mem.read16(sp+8) | (mem.read16(sp+10) << 16)
        if amount >= 0x80000000:
            amount -= 0x100000000
        awards.append([index, amount])
        cpu.ip = mem.read16(sp)
        cpu.segs[1] = mem.read16(sp+2)
        cpu.regs[4] += 4
    else:
        raise AssertionError('native scoring did not return')
    assert awards == port['awards'], (case, awards, port)
    wins = [mem.read16(ds+0xD568+i*0xCA+0xAC) for i in range(3)]
    assert wins == port['wins'], (case, wins, port)
print(f'{len(cases)} native standard round-award cases match bonus amounts and win counters.')
