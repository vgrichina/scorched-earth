#!/usr/bin/env python3
"""Compare complete sun masks with the EXE filled-circle callback at 0x43ACA.

No terrain occlusion: every generated sun pixel is checked, including its edge.
Graphics-mode dimensions/aspects come from the port; this verifies their use
by the circle routine, not the mode table against hardware initialization.
"""
import base64
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
cases = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {GRAPHICS_MODES} from './web/js/config.js';"
    "import {createSunsetSky} from './web/js/sky.js';"
    "console.log(JSON.stringify(GRAPHICS_MODES.map(({w,h,displayAspect:a})=>"
    "({w,h,a,pixels:Buffer.from(createSunsetSky(w,h,a).map(p=>p===80?1:0)).toString('base64')}))));"
], cwd=root, text=True))
mem = Memory()
load_exe(root / 'earth/SCORCH.EXE', mem)
ds, stack = 0x4FC80, 0x80000
for case in cases:
    w, h, aspect = case['w'], case['h'], case['a']
    cpu, ports = CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    for off, value in ((0x519A,65535),(0xEF42,3),(0xEF3C,w-4),(0xEF40,38),(0xEF38,h-4),
                       (0xEF34,int(aspect*65536) if aspect < 1 else 0),
                       (0xEF36,int(65536/aspect) if aspect > 1 else 0),(0x510E,0)):
        mem.write16(ds + off, value)
    cpu.segs[:] = [0,0x3D00,0x8000,0x4FC8]
    cpu.ip, cpu.regs[4] = 0x9CA, 0x2400
    for i, value in enumerate([0x110,0x60,(w-1)//2,h-9,(w-1)//3,0x100,0x60]):
        mem.write16(stack+0x2400+2*i,value)
    expected = bytearray(w*h)
    while True:
        reason, _ = run_fast(cpu,mem,ports,handler,100000,bp_set={0x700,0x710})
        assert reason == 'breakpoint', (w,h,reason)
        if cpu.segs[1]*16+cpu.ip == 0x710:
            break
        sp = cpu.regs[4]
        x,y = mem.read16(stack+sp+4),mem.read16(stack+sp+6)
        expected[y*w+x] = 1
        cpu.ip = mem.read16(stack+sp)
        cpu.segs[1] = mem.read16(stack+sp+2)
        cpu.regs[4] += 4
    actual = base64.b64decode(case['pixels'])
    differences = sum(a != b for a,b in zip(actual,expected))
    assert not differences,(w,h,aspect,differences)
    print(f'{w}x{h}, aspect {aspect}: all {sum(expected)} sun pixels match EXE.',flush=True)
