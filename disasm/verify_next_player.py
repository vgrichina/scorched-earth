#!/usr/bin/env python3
"""Native next-living-slot selection vs production NEXT_TURN gameTick.
Enters after a completed turn, with round continuation forced. Intercepts
round-over checks, shield maintenance and input; runs the full HUD prologue.
Does not prove round-over, HUD pixels, wind, or the enclosing shot sequence.
"""
import json,subprocess
from pathlib import Path
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.loader import load_exe
from emu.execute import run_fast
root=Path(__file__).resolve().parent.parent
cases=[]
for n in range(2,6):
 orders=[list(range(n)),list(reversed(range(n))),list(range(1,n))+[0]]
 for order in orders:
  for mask in range(1<<n):
   if mask.bit_count()<2:continue
   alive=[bool(mask&(1<<i)) for i in range(n)]
   for slot in range(n):cases.append(dict(order=order,alive=alive,slot=slot))
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
let input='';for await(const c of process.stdin)input+=c;
Object.assign(config,{wind:0,wallType:0,playMode:0});
console.log(JSON.stringify(JSON.parse(input).map(c=>{
 config.numPlayers=c.alive.length;createPlayers(c.alive.length);
 players.forEach((p,i)=>Object.assign(p,{alive:c.alive[i],aiType:0,
   hudEnergy:77,hudPower:777,hudParachuteCount:1,hudShieldEnergy:30,
   hudContactTriggerCount:3,hudContactTriggerArmed:true,
   activeShield:i%6,selectedShield:(i+1)%6}));
 Object.assign(game,{state:STATE.NEXT_TURN,nextTurnTimer:15,turnOrder:c.order,
   turnOrderIdx:c.slot,currentPlayer:c.order[c.slot],wind:0});
 gameTick();
 return {slot:game.turnOrderIdx,player:game.currentPlayer,
   cleared:players.every(p=>p.hudEnergy===undefined&&p.hudPower===undefined&&
     p.hudParachuteCount===undefined&&p.hudShieldEnergy===undefined&&
     p.hudContactTriggerCount===undefined&&p.hudContactTriggerArmed===undefined),
   selectedShield:players[game.currentPlayer].selectedShield??players[game.currentPlayer].activeShield};
})));
'''],cwd=root,input=json.dumps(cases),text=True))
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem);handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
for off,value in ((0x519A,65535),(0x50EE,0),(0xE1E2,0),(0x50F6,0)):mem.write16(ds+off,value)
for case,port in zip(cases,actual):
 mem.write16(ds+0x50D4,len(case['alive']))
 for i,alive in enumerate(case['alive']):
  tank=0xD568+i*0xCA
  mem.write16(ds+tank+0x18,int(alive))
  mem.write16(ds+tank+0xC6,0x616C+(i%6)*16);mem.write16(ds+tank+0xC8,0x4FC8)
 mem.write16(ds+0xE1DE,0x616C+5*16);mem.write16(ds+0xE1E0,0x4FC8)
 for slot,player in enumerate(case['order']):
  mem.write16(ds+0xE4F6+slot*4,0xD568+player*0xCA)
  mem.write16(ds+0xE4F8+slot*4,0x4FC8)
 cpu.segs[:]=[0,0x200F,0x5F4A,0x4FC8]
 cpu.ip=0x2ABDA-0x6100-0x200F0;cpu.regs[4]=0x23D0;cpu.regs[5]=0x2400;cpu.regs[6]=case['slot']
 for _ in range(10):
  reason,_=run_fast(cpu,mem,ports,handler,10000,bp_set={a-0x6100 for a in (0x2B405,0x238AE,0x28A80,0x301B2)})
  address=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',(case,reason,hex(address))
  sp=stack+cpu.regs[4]
  if address==0x301B2:
   assert mem.read16(sp+6)==0x4FC8
   selected=(mem.read16(sp+4)-0xD568)//0xCA
   assert (selected,cpu.regs[6])==(port['player'],port['slot']),(case,port,selected,cpu.regs[6])
   assert port['cleared'],(case,'retained HUD fields not reset for full redraw')
   reason,_=run_fast(cpu,mem,ports,handler,1000,bp_set={0x301E3-0x6100})
   assert reason=='breakpoint'
   assert mem.read16(ds+0xE1DE)==0x616C+port['selectedShield']*16
   assert mem.read16(ds+0xE1E0)==0x4FC8
   break
  if address==0x2B405:cpu.regs[0]=0
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('next-player loop did not reach HUD')
print(f'{len(cases)} native next-player selections match production gameTick, including slot wrap and dead-player skips; port HUD retention resets on selection.')
