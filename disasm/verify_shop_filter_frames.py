#!/usr/bin/env python3
"""Check both shop tabs after native equipment initialization with varied settings.

Settings are injected, not changed through dialogs. Runs native equip_init and
real tab clicks; full RGB comparisons align palette and omit the cursor.
"""
import argparse,copy,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.state import save_state
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-filter-frames');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 result=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if result.returncode:print(result.stdout,result.stderr);result.check_returncode()
# arms, useless, suspended dirt, trace, falling, tunneling, play mode
cases=[(4,0,50,1,0,0,0),(4,0,0,0,1,1,1),(4,0,0,0,1,1,2),
       (4,1,0,1,0,0,1),(0,1,0,1,0,0,1)]
for index,values in enumerate(cases):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h);saved=copy.deepcopy(c);ds=0x4fc80
 arms,useless,suspended,trace,falling,tunneling,mode=values
 for off,v in ((0x518a,arms),(0x50fe,useless),(0x5158,100-suspended),
               (0x5168,trace),(0x5162,falling),(0x513a,tunneling),(0x5188,mode)):
  m.write16(ds+off,v)
 limit=m.read16(ds+0x519a);m.write16(ds+0x519a,65535)
 c.segs[:]=[0,0x1700,0x8800,0x4fc8];c.ip=0x1d5d4-0x6100-0x17000;c.regs[4]=0x2400
 for i,v in enumerate((0x110,0x60)):m.write16(0x8a400+2*i,v)
 reason,_=run_fast(c,m,p,h,1000000,bp_set={0x710});assert reason=='breakpoint',reason
 for slot in CPU.__slots__:setattr(c,slot,getattr(saved,slot))
 m.write16(ds+0x519a,limit)
 before=out/f'{index}-input.state';save_state(str(before),c,m,p,h)
 for tab,x in [('misc',222),('weapons',201)]:
  prefix=out/f'{index}-{tab}'
  run('python3',root/'disasm/capture_shop_click.py',before,prefix,x,240)
  after=str(prefix)+'.state'
  run('python3',root/'disasm/verify_shop_selector.py',before,after,x,240,'--output-dir',out/f'{index}-{tab}-compare')
  before=after
  print(values,tab,'full RGB match',flush=True)
