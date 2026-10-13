#!/usr/bin/env python3
"""Compare production free flight with EXE 0x21AA2..0x21D09.

Uses the default .02 timestep with supplied force/viscosity constants. Does
not cover calibration, callbacks, collision traversal or projectile drawing.
"""
import json
from pathlib import Path
import struct
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root = Path(__file__).resolve().parent.parent
cases = [dict(vx=vx, vy=vy, gravity=g, wind=w, viscosity=v)
         for vx, vy in [(0, 0), (100, 250), (-100, -250), (600, 800),
                        (600.01, 800), (1600, -1200), (-1600, 1200)]
         for g in (0.05, 0.2, 1) for w in (-100, 0, 100) for v in (0, 5, 20)]
actual = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', r'''
import {config} from './web/js/config.js';
import {createProjectile,stepSingleProjectile} from './web/js/physics.js';
import {reinitTerrainBuffers} from './web/js/terrain.js';
Object.assign(config,{screenWidth:360,screenHeight:480,wallType:0});
reinitTerrainBuffers();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 Object.assign(config,c);
 const p=createProjectile(180,240,c.vx,c.vy,2,0), states=[];
 for(let i=0;i<4;i++){
  const status=stepSingleProjectile(p,()=>120,c.wind);
  if(status!=='flying')throw new Error(status);
  states.push([p.vx,p.vy,p.x,p.y]);
 }
 return states;
})));
''', json.dumps(cases)], cwd=root, text=True))
mem = Memory()
load_exe(root/'earth/SCORCH.EXE', mem)
ds, projectile = 0x4FC80, 0x90000
mem.write16(ds+0x519A, 65535)
mem.write16(ds+0xCEB8, 0)
mem.write16(ds+0xCEBA, projectile >> 4)
mem.write16(ds+0x5146, 0)  # Disable sound only.
def put_double(address, value):
    struct.pack_into('<d', mem.data, address, value)
for case, states in zip(cases, actual):
    cpu, ports = CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root/'earth'), ports)
    cpu.segs[:] = [0, 0x1ADA, 0x5F4A, 0x4FC8]
    cpu.regs[5], cpu.regs[4], cpu.regs[6] = 0x2400, 0x23E0, 0
    for offset, value in [(4, case['vx']), (12, case['vy']), (20, 180), (28, 240)]:
        put_double(projectile+offset, value)
    put_double(ds+0xCEAC, .02)
    put_double(ds+0xCE9C, 50*case['gravity'])
    put_double(ds+0xCEA4, case['wind']/40)
    put_double(ds+0x5178, 1-case['viscosity']/10000)
    for step, port in enumerate(states):
        cpu.ip = 0x21AA2-0x6100-(cpu.segs[1]<<4)
        reason, count = run_fast(cpu, mem, ports, handler, 100000,
                                 bp_set={0x21D09-0x6100})
        assert reason == 'breakpoint', (case, step, reason, count)
        expected = [mem.read_float64(projectile+off) for off in (4, 12, 20, 28)]
        assert port == expected, (case, step, port, expected)
print(f'{len(cases)*4} free-flight steps match EXE, including speed-cap boundaries.')
