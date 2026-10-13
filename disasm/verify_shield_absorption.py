#!/usr/bin/env python3
"""Compare real native shield absorption and break dispatch, with effects stubbed.

Runs 0x38344 to return. Palette, sound, scoring, erase and shape dispatch are
intercepted; this verifies energy/remainder/break decisions, not shield pixels.
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
cases = [dict(kind=kind, energy=energy, damage=damage)
         for kind, maximum in enumerate((0, 55, 100, 100, 150, 200)) if kind
         for energy in (0, 1, maximum // 2, maximum)
         for damage in (0, 1, 10, energy, energy + 1, 110, 250)]
actual = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', r'''
import {applyShieldDamage,shieldBreak,drawShieldBreak} from './web/js/shields.js';
import {palette6} from './web/js/palette.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 const p={activeShield:c.kind,shieldEnergy:c.energy,x:100,y:100,index:0,colorIndex:c.kind};
 shieldBreak.active=false;
 const remainder=applyShieldDamage(p,c.damage);
 const broken=shieldBreak.active,fade=[];
 while(shieldBreak.active){drawShieldBreak();fade.push([c.kind*8+5,...palette6.slice((c.kind*8+5)*3,(c.kind*8+6)*3)]);}
 return {energy:p.shieldEnergy,remainder,broken,type:p.activeShield,fade};
})));
''', json.dumps(cases)], cwd=root, text=True))

def address(seg, off):
    return seg * 16 + off + 0x900

palette = address(0x32C2, 0xA26)
score = address(0x3098, 0x308)
rgb = address(0x456B, 5)
sound = address(0x4571, 7)
erase = address(0x3912, 0x91B)
shape = address(0x162C, 0x78)
stubs = {palette, score, rgb, sound, erase, shape}
for c, port in zip(cases, actual):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    load_exe(root / 'earth/SCORCH.EXE', mem)
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    ds, stack, player = 0x4FC80, 0x5F4A0, 0x90000
    mem.write16(ds + 0x519A, 65535)
    mem.write16(ds + 0x5188, 0)
    mem.write16(player + 0x96, c['energy'])
    mem.write16(player + 0x1A, c['kind'] * 8)
    mem.write16(player + 0xC6, 0x616C + c['kind'] * 16)
    mem.write16(player + 0xC8, 0x4FC8)
    cpu.segs[:] = [0, 0x3221, 0x5F4A, 0x4FC8]
    cpu.ip = 0x34
    cpu.regs[4] = 0x2400
    for i, value in enumerate((0x110, 0x60, 0, 0x9000, c['damage'])):
        mem.write16(stack + 0x2400 + 2 * i, value)
    erased, fades, scored, fade = 0, 0, [], []
    for _ in range(200):
        reason, _ = run_fast(cpu, mem, ports, handler, 100000, bp_set=stubs | {0x710})
        addr = cpu.segs[1] * 16 + cpu.ip
        assert reason == 'breakpoint', (c, reason, hex(addr))
        if addr == 0x710:
            break
        sp = cpu.regs[4]
        erased += addr == erase
        fades += addr == rgb
        if addr == rgb:
            fade.append([mem.read16(stack + sp + 4 + i * 2) for i in range(4)])
        if addr == score:
            scored.append(mem.read16(stack + sp + 12))
        cpu.ip = mem.read16(stack + sp)
        cpu.segs[1] = mem.read16(stack + sp + 2)
        cpu.regs[4] += 4
    else:
        raise AssertionError('native absorption did not return')
    native = dict(energy=mem.read16(player + 0x96), remainder=cpu.regs[0],
                  broken=bool(erased), fade=fade, type=(mem.read16(player + 0xC6) - 0x616C) // 16)
    assert native == port, (c, native, port)
    assert fades == (51 if erased else 0), (c, fades)
    expected_score = [min(c['energy'], c['damage'])] if c['energy'] and c['damage'] else []
    assert scored == expected_score, (c, scored, expected_score)
print(f'{len(cases)} shield absorption cases match native energy, remainder, break dispatch, all fade palette writes and retained shield type; native absorbed-damage score arguments checked.')
