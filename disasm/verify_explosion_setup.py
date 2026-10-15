#!/usr/bin/env python3
"""Native equipment scaling + texture setup vs port cache, including RNG.

Initialized heap checkpoint; mode dimensions/aspects are shared inputs.
Runs native 0x2B471 through texture-cache setup, before unrelated setup work.
"""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
modes=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {GRAPHICS_MODES} from './web/js/config.js';console.log(JSON.stringify(GRAPHICS_MODES));"],cwd=root,text=True))
for mode in (0,2,4,8):
 for scale in range(3):
  mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
  handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
  load_state(args.checkpoint,cpu,mem,ports,handler)
  ds=0x4fc80;a=modes[mode]['displayAspect']
  for off,v in ((0xEF3E,modes[mode]['w']-1),(0xEF34,int(a*65536) if a<1 else 0),
                (0xEF36,int(65536/a) if a>1 else 0),(0x5112,scale),(0x51A6,65535),
                (0x5104,0),(0x5106,0),(0x510A,0),(0x6E2C,256)):
   mem.write16(ds+off,v)
  def enter(file,segment,arguments=()):
   cpu.segs[:]=[0,segment,0x5f4a,0x4fc8]
   cpu.ip=file-0x6100-segment*16;cpu.regs[4]=0x2400
   for i,w in enumerate([0x110,0x60,*arguments]):mem.write16(0x618a0+i*2,w)
  enter(0x32994,0x2c89,[42])
  reason,_=run_fast(cpu,mem,ports,handler,20000000,bp_set={0x710});assert reason=='breakpoint'
  native=[]
  for repeat,lowmem in enumerate((0,0,1,1,0)):
   mem.write16(ds+0x510A,lowmem)
   enter(0x2B471,0x2431)
   reason,steps=run_fast(cpu,mem,ports,handler,20000000,bp_set={0x2B64B-0x6100})
   assert reason=='breakpoint',(mode,scale,repeat,reason,steps)
   width,height=mem.read16(ds+0xE51E),mem.read16(ds+0xE520)
   address=mem.read16(ds+0x5104)+16*mem.read16(ds+0x5106)
   native.append(dict(radius=(lambda r:-1 if r==65535 else r)(mem.read16(ds+0x51A6)),width=width,height=height,
    pixels=list(mem.read_bytes(address,width*height)) if address else None,
    rng=dict(index=mem.read16(ds+0xec06),words=[mem.read16(ds+0xea12+2*i) for i in range(250)])))
  actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',
   "import {config,GRAPHICS_MODES} from './web/js/config.js';"
   "import {seedRandom,getRandomState} from './web/js/utils.js';"
   "import {explosionTextureCache as c} from './web/js/explosion-texture.js';"
   "import {initGameRound} from './web/js/game.js';"
   f"Object.assign(config,{{graphicsMode:{mode},screenWidth:GRAPHICS_MODES[{mode}].w,screenHeight:GRAPHICS_MODES[{mode}].h,explosionScale:{scale},numPlayers:2}});"
   "seedRandom(42);const result=[];for(const lowmem of [0,0,1,1,0]){config.smallMemory=lowmem;initGameRound([{name:'Alice',aiType:0},{name:'Bob',aiType:0}]);result.push({...c,pixels:c.pixels?[...c.pixels]:null,rng:getRandomState()});}console.log(JSON.stringify(result));"],cwd=root,text=True))
  assert actual==native,(mode,scale,'setup/cache/RNG mismatch')
  print(f'Mode {mode}, scale {scale}: texture bytes, dimensions, radius, RNG cache reuse and Small Memory transitions match.',flush=True)
