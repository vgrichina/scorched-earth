#!/usr/bin/env python3
"""Execute native shield flight callback and compare reserve/velocity boundaries."""
import json,subprocess,struct
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[]
for height in (200,350,480):
 for dx in (-16,-15.99,-15,0,15,15.99,16):
  for dy in (-1,0,.99,1,((height-1)//4)+.99,((height-1)//4)+1):
   for delay in (0,1,100,200):
    cases.append(dict(height=height,x=180+dx,y=150-dy,vx=10,vy=-7.25,
      uses=1000,energy=55,alive=True,attackerIdx=1,delay=delay))
base=dict(height=480,x=180,y=100,vx=10,vy=-7.25,uses=1000,energy=55,alive=True,attackerIdx=1,delay=100)
for field,values in dict(vx=[0,-10],uses=[0,1],energy=[0],alive=[False],attackerIdx=[0]).items():
 for value in values:cases.append({**base,field:value})
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {applyShieldFlight} from './web/js/shield-flight.js';
let input='';for await(const c of process.stdin)input+=c;
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 Object.assign(config,{screenHeight:c.height,fireDelay:c.delay});
 const p={index:0,x:180,y:150,alive:c.alive,shieldEnergy:c.energy,shieldFlightUses:c.uses};
 const shot={x:c.x,y:c.y,vx:c.vx,vy:c.vy,attackerIdx:c.attackerIdx};
 applyShieldFlight(p,shot);return {uses:p.shieldFlightUses,vx:shot.vx,vy:shot.vy};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack,tank,shot,node=0x4FC80,0x80000,0xD568,0x90000,0x91000
for off,v in ((0x519A,65535),(0xCEB8,0),(0xCEBA,0x9000),(tank+14,180),(tank+16,150)):
 mem.write16(ds+off,v)
mem.write16(node,tank);mem.write16(node+2,0x4FC8)
for case,port in zip(cases,actual):
 for off,v in ((0xEF3A,case['height']-1),(0x5140,case['delay']),
  (tank+0x18,int(case['alive'])),(tank+0x96,case['energy']),(tank+0x98,case['uses'])):mem.write16(ds+off,v)
 for off,key in ((4,'vx'),(12,'vy'),(20,'x'),(28,'y')):struct.pack_into('<d',mem.data,shot+off,case[key])
 mem.write16(shot+0x2A,tank+case['attackerIdx']*0xCA);mem.write16(shot+0x2C,0x4FC8)
 cpu.segs[:]=[0,0x1ADA,0x8000,0x4FC8];cpu.ip=0x23754-0x6100-0x1ADA0;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,0,0,0x9100)):mem.write16(stack+0x2400+i*2,v)
 reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710})
 assert reason=='breakpoint',(case,reason)
 expected=dict(uses=mem.read16(ds+tank+0x98),vx=mem.read_float64(shot+4),vy=mem.read_float64(shot+12))
 assert port==expected,(case,port,expected)
print(f'{len(cases)} native shield-flight callback cases match reserve and exact velocities, including fractional boundaries, delay, ownership, zero velocity and exhaustion.')

# Run the real reserve setter path, stopping before linked-list maintenance.
reserve_cases=[dict(kind=k,energy=e,alive=a) for k in range(6) for e in (-1,0,1,200) for a in (False,True)]
reserves=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {refreshShieldFlight} from './web/js/shield-flight.js';
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 const p={activeShield:c.kind,shieldEnergy:c.energy,alive:c.alive,shieldFlightUses:17};
 refreshShieldFlight(p);return p.shieldFlightUses;
})));
''',json.dumps(reserve_cases)],cwd=root,text=True))
for case,port in zip(reserve_cases,reserves):
 for off,v in ((tank+0xC6,0x616C+case['kind']*16),(tank+0xC8,0x4FC8),
  (tank+0x18,int(case['alive'])),(tank+0x96,case['energy']&65535),(tank+0x98,17)):mem.write16(ds+off,v)
 cpu.segs[:]=[0,0x1ADA,0x8000,0x4FC8];cpu.ip=0x238E0-0x6100-0x1ADA0;cpu.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60,tank,0x4FC8)):mem.write16(stack+0x2400+i*2,v)
 reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x23928-0x6100})
 assert reason=='breakpoint',(case,reason)
 assert port==mem.read16(ds+tank+0x98),(case,port,mem.read16(ds+tank+0x98))
print(f'{len(reserve_cases)} native reserve-refresh cases match all shield configs, signed energy and alive/dead state.')
