#!/usr/bin/env python3
"""Compare native sell/Description dialog openings across items at 360x480.

Requires a shop fixture owning all 48 native items. Each case starts from the
same Inventory, exercises a real mouse click and compares the complete frame.
--descriptions includes all items and five native dismissal paths.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--descriptions',action='store_true',help='Compare right-click descriptions, including Baby Missile and dismissal controls')
parser.add_argument('--output-dir',default='/tmp/scorched-sell-layouts');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 result=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if result.returncode:print(result.stdout,result.stderr);result.check_returncode()
start=extract_state(args.checkpoint)
assert all(n>0 for n in start['tanks'][start['currentPlayer']]['inventory'][:48])
run('python3',root/'disasm/capture_shop_click.py',args.checkpoint,out/'inventory',275,85)
for idx in range(0 if args.descriptions else 1,48):
 x=71+15+(idx%7)*30;y=192+30+(idx//7)*15;prefix=out/f'item-{idx:02d}'
 run('python3',root/'disasm/capture_shop_click.py',out/'inventory.state',prefix,x,y,'--button',2 if args.descriptions else 1)
 native=extract_state(str(prefix)+'.state');state=dict(start,palette=native['palette'])
 write_state_json(state,out/'input.json');write_emu_png(native,str(prefix)+'-native.png')
 run('node',root/'disasm/web_screenshot.mjs','shop',str(prefix)+'-port.png','--from-state',out/'input.json','--shop-click','275,85','--shop-click',f'{x},{y},{4 if args.descriptions else 1}')
 run('python3',root/'disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
 print('Item',idx,'full RGB match',flush=True)

 if args.descriptions and idx<5:
  closing=out/f'close-{idx}'
  if idx<3:
   code,scan,asc=[('Enter',28,13),('KeyD',32,100),('Escape',1,27)][idx]
   run('python3',root/'disasm/capture_shop_click.py',str(prefix)+'.state',closing,180,275,'--key',scan,'--ascii',asc)
   tail=['--shop-key',code]
  else:
   run('python3',root/'disasm/capture_shop_click.py',str(prefix)+'.state',closing,180,275,'--button',1 if idx==3 else 2)
   tail=['--shop-click',f'180,275,{1 if idx==3 else 4}']
  native=extract_state(str(closing)+'.state');state=dict(start,palette=native['palette'])
  write_state_json(state,out/'input.json');write_emu_png(native,str(closing)+'-native.png')
  run('node',root/'disasm/web_screenshot.mjs','shop',str(closing)+'-port.png','--from-state',out/'input.json','--shop-click','275,85','--shop-click',f'{x},{y},4',*tail)
  run('python3',root/'disasm/compare_screenshots.py',str(closing)+'-native.png',str(closing)+'-port.png',str(closing)+'-diff.png')
  print('Dismissal',idx,'full RGB match',flush=True)
