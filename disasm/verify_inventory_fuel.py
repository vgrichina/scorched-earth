#!/usr/bin/env python3
"""Full-frame native Inventory comparisons with fractional fuel and zero stock.

Injects stock/energy as rendering fixtures; does not simulate fuel consumption.
Checks column thresholds and selling the final whole Fuel Tank with energy left.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--sale-only',action='store_true',help='Run only the final-whole-tank sale sequence')
parser.add_argument('--output-dir',default='/tmp/scorched-inventory-fuel');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
def compare(start,native_path,prefix,inputs):
 native=extract_state(native_path);state=dict(start,palette=native['palette'])
 write_state_json(state,out/'input.json');write_emu_png(native,str(prefix)+'-native.png')
 run('node',root/'disasm/web_screenshot.mjs','shop',str(prefix)+'-port.png','--from-state',out/'input.json',*inputs)
 run('python3',root/'disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
for count in (() if args.sale_only else (1,16,25,36)):
 for energy in (0,1,9):
  prefix=out/f'items-{count}-energy-{energy}'
  run('python3',root/'disasm/capture_shop_inventory.py',args.checkpoint,prefix,count,'--fuel-energy',energy)
  before=str(prefix)+'-ready.state';start=extract_state(before)
  run('python3',root/'disasm/capture_shop_click.py',before,str(prefix)+'-open',275,85)
  compare(start,str(prefix)+'-open.state',prefix,['--shop-click','275,85'])
  print(count,'items, energy',energy,'full RGB match',flush=True)
prefix=out/'last-tank'
run('python3',root/'disasm/capture_shop_inventory.py',args.checkpoint,prefix,1,'--fuel-energy',7,'--fuel-stock',1)
previous=str(prefix)+'-ready.state';start=extract_state(previous);inputs=[]
for name,action in [('inventory',[275,85]),('sell',[165,267]),('accept',[150,276]),
                    ('close','Escape'),('reopen',[275,85]),('zero-stock-click',[165,267]),('zero-stock-enter','Enter')]:
 p=out/('last-tank-'+name)
 if isinstance(action,list):
  run('python3',root/'disasm/capture_shop_click.py',previous,p,*action);inputs+=['--shop-click',','.join(map(str,action))]
 else:
  run('python3',root/'disasm/capture_shop_click.py',previous,p,165,267,'--key',1 if action=='Escape' else 28)
  inputs+=['--shop-key',action]
 previous=str(p)+'.state';compare(start,previous,p,inputs)
 print(name,'full RGB match',flush=True)
