#!/usr/bin/env python3
"""Native human-turn entry and K-key dispatch vs production game/input state.
Intercepts the dialog at entry; does not validate its pixels or event loop.
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
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
load_exe(root/'earth/SCORCH.EXE',mem)
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
ds,stack=0x4FC80,0x5F4A0
mem.write16(ds+0x519A,65535)
# Continue directly from the native full-HUD return into a human's input loop.
for count in range(2,6):
 mem.write16(ds+0x50D4,count)
 for i in range(count):
  tank=0xD568+i*0xCA
  mem.write16(ds+tank+0x22,0)
  mem.write16(stack+0x23FC,tank);mem.write16(stack+0x23FE,0x4FC8)
  cpu.segs[:]=[0,0x200F,0x5F4A,0x4FC8]
  cpu.ip=0x2AB99-0x6100-0x200F0;cpu.regs[4]=0x23D0;cpu.regs[5]=0x2400
  reason,_=run_fast(cpu,mem,ports,handler,1000,bp_set={0x2F550-0x6100,0x43080-0x6100})
  assert reason=='breakpoint' and cpu.segs[1]*16+cpu.ip==0x2F550-0x6100
# Execute the scan-code jump table, then return from the intercepted dialog.
cpu.segs[:]=[0,0x2945,0x5F4A,0x4FC8]
cpu.ip=0x2F78A-0x6100-0x29450;cpu.regs[4]=0x23D0;cpu.regs[5]=0x2400
mem.write16(stack+0x23FE,0x25) # AT scan code for K
reason,_=run_fast(cpu,mem,ports,handler,1000,bp_set={0x43080-0x6100,0x2FAFD-0x6100})
assert reason=='breakpoint' and cpu.segs[1]*16+cpu.ip==0x43080-0x6100
sp=stack+cpu.regs[4]
cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
reason,_=run_fast(cpu,mem,ports,handler,1000,bp_set={0x2FAFF-0x6100})
assert reason=='breakpoint'
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {createPlayers,players} from './web/js/tank.js';
import {game,gameTick,STATE} from './web/js/game.js';
import {initInput,mouse} from './web/js/input.js';
const listeners={};globalThis.window={addEventListener:(k,f)=>listeners[k]=f};
initInput({addEventListener(){}});
const press=code=>listeners.keydown({code,key:code,preventDefault(){}});
Object.assign(config,{wind:0,changeWind:0,wallType:0,playMode:0});
const results=[];
for(let n=2;n<=5;n++){
 config.numPlayers=n;createPlayers(n);players.forEach(p=>Object.assign(p,{aiType:0,alive:true}));
 Object.assign(game,{state:STATE.NEXT_TURN,nextTurnTimer:15,turnOrder:players.map(p=>p.index),
  turnOrderIdx:0,currentPlayer:0,wind:0});
 gameTick();const afterTurn=game.state,selected=game.currentPlayer;
 // Isolate keyboard dispatch even if automatic privacy already failed.
 game.state=STATE.AIM;press('KeyK');gameTick();const afterK=game.state;
 press('KeyX');gameTick();const afterKey=game.state;
 press('KeyK');gameTick();mouse.clicked=1;gameTick();
 results.push({n,afterTurn,afterK,afterKey,afterClick:game.state,selected,
  unchanged:game.currentPlayer===selected});
}
console.log(JSON.stringify(results));
'''],cwd=root,text=True))
for c in actual:
 assert c['afterTurn']=='aim',(c,'native enters human input directly')
 assert c['afterK']=='screen_hide',(c,'native K dispatch opens dialog')
 assert c['afterKey']==c['afterClick']=='aim' and c['unchanged'],c
print('14 native human-turn entries skip privacy; K dispatch opens the dialog and returns to input. Port matches for 2..5 humans, with key/click dismissal preserving the current player.')
