#!/usr/bin/env python3
"""Compare interior terrain impacts with the native walker and collision callback.

Pixel reads use synthetic terrain; head erasure/impact effects are intercepted.
Covers first-step terrain and ordinary tank pixels, including owner pixels.
Includes ordinary absorption shields and Mag Deflector arcs.
Excludes wall behavior, reflecting shields, impact effects and tunnelling.
"""
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast

root=Path(__file__).resolve().parent.parent
cases=[dict(dx=dx,dy=dy,pattern=p,age=age,color=80,hostile=0) for dx,dy in
       ((12,8),(8,12),(-12,8),(-8,-12),(12,-8),(-12,-8),(0,12),(12,0),(0,0))
       for p in range(5) for age in (0,1,2)]
cases += [dict(dx=12,dy=8,pattern=3,age=age,color=color,hostile=hostile)
          for color in range(80) if color%8!=5 or color==5
          for age in (0,1,2) for hostile in (0,1)]
cases += [dict(dx=12,dy=8,pattern=3,age=age,color=color,hostile=0,kind=kind)
          for kind in (1,2,4,5) for color in (5,13,77) for age in (0,1,2)]
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {players,createPlayer} from './web/js/tank.js';
import {config} from './web/js/config.js';
import {createProjectile,stepSingleProjectile} from './web/js/physics.js';
import {terrainBitmap,reinitTerrainBuffers} from './web/js/terrain.js';
Object.assign(config,{screenWidth:360,screenHeight:480,gravity:0,viscosity:0,wallType:0,tunneling:0});
reinitTerrainBuffers();
console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>{
 players.splice(0,players.length,...Array.from({length:10},(_,i)=>Object.assign(createPlayer(i,'Tank'),{activeShield:c.kind??0})));
 terrainBitmap.fill(0);
 config.hostileEnvironment=c.hostile;
 const solidAt=(x,y)=>c.pattern===1?(x===104||x===96):c.pattern===2?(y===104||y===96):
   c.pattern===3?(x===100&&y===100):c.pattern===4?((x+y)%7===0):false;
 for(let y=80;y<=120;y++)for(let x=80;x<=120;x++){
  const solid=c.pattern===1?(x===104||x===96):c.pattern===2?(y===104||y===96):
   c.pattern===3?(x===100&&y===100):c.pattern===4?((x+y)%7===0):false;
  if(solid && c.color===80)terrainBitmap[y*360+x]=120;
 }
 const p=createProjectile(100.25,100.25,c.dx*50,-c.dy*50,2,0);p.age=c.age;
 const status=stepSingleProjectile(p,(x,y)=>solidAt(x,y)&&c.color<80?c.color:120,0);
 return {status,x:p.x,y:p.y};
})));
''',json.dumps(cases)],cwd=root,text=True))
for case,port in zip(cases,actual):
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    load_exe(root/'earth/SCORCH.EXE',mem)
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    ds,stack=0x4FC80,0x5F4A0
    for off,value in ((0x519A,65535),(0xEF42,3),(0xEF3C,356),(0xEF40,38),(0xEF38,476),
                      (0x5154,0),(0x513A,0),(0x513C,case['hostile']),(0x5182,0xD568),(0x5184,0x4FC8),(0xE1E4,0),(0xE1E6,0),(0xE1E8,0),
                      (0xEEF8,0x100),(0xEEFA,0x60)):
        mem.write16(ds+off,value)
    if case.get('kind'):
        tank=ds+0xD568+(case['color']//8)*0xCA
        mem.write16(tank+0xC6,0x616C+case['kind']*16);mem.write16(tank+0xC8,0x4FC8)
    cpu.segs[:]=[0,0x17AB,0x5F4A,0x4FC8];cpu.ip=0x733;cpu.regs[4]=0x2400
    args=[0x110,0x60,100,100,100+case['dx'],100+case['dy'],0x1349,0x1ADA]
    for i,value in enumerate(args):mem.write16(stack+0x2400+2*i,value)
    impact=None
    for _ in range(200):
        reason,_=run_fast(cpu,mem,ports,handler,100000,
                         bp_set={0x700,0x710,0x22FBC-0x6100,0x230C8-0x6100})
        assert reason=='breakpoint',(case,reason)
        address=cpu.segs[1]*16+cpu.ip
        if address==0x710:break
        sp=cpu.regs[4]
        x,y=(mem.read16(stack+sp+off) for off in (4,6))
        if address==0x700:
            p=case['pattern']
            solid=(x in (96,104)) if p==1 else (y in (96,104)) if p==2 else (x==100 and y==100) if p==3 else (x+y)%7==0 if p==4 else False
            cpu.ax=case['color'] if solid else 120
        elif address==0x230C8-0x6100:impact=(x,y)
        cpu.ip=mem.read16(stack+sp);cpu.segs[1]=mem.read16(stack+sp+2);cpu.regs[4]+=4
    else:raise AssertionError('collision did not finish')
    expected=dict(status='hit_terrain' if case['color']==80 else 'hit_tank',x=impact[0],y=impact[1]) if impact else dict(
        status='flying',x=100.25+case['dx'],y=100.25+case['dy'])
    assert port==expected,(case,port,expected)
print(f'{len(cases)} collision cases match native first-impact coordinates across launch ages, terrain, tank colors and Hostile Environment settings.')
