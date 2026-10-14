#!/usr/bin/env python3
"""Compare native Update/Inventory button edges using full RGB shop frames.

360x480 checkpoint. Both buttons, inside/outside edge pixels, and gaps.
Palette phase is aligned; cursor and wall-clock animation are excluded.
"""
import argparse,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-action-bounds');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
points=[(x,y) for x in (249,250,310,311) for y in (60,85)]
points += [(275,y) for y in (51,52,53,69,70,71,76,77,78,94,95,96)]
for button in (1,2):
 for x,y in points:
  prefix=out/f'button-{button}-{x}-{y}'
  run('python3',root/'disasm/capture_shop_click.py',args.checkpoint,prefix,x,y,'--button',button)
  run('python3',root/'disasm/verify_shop_selector.py',args.checkpoint,str(prefix)+'.state',x,y,'--button',button,'--output-dir',prefix)
 print('Button',button,':',len(points),'full RGB comparisons pass',flush=True)
