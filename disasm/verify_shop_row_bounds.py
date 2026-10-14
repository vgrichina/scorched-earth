#!/usr/bin/env python3
"""Compare full native/port frames for shop-row edge, gap and hidden-row clicks.

360x480 input-ready Weapons shop; both native mouse buttons are exercised.
Ending DAC phase is aligned and cursor/speaker/wall-clock timing is excluded.
"""
import argparse,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-row-bounds');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
points=[(x,y) for x in (11,12,178,179) for y in (75,86)]
points += [(90,y) for y in (54,55,66,67,74,75,86,87,94,95,454,455,466,467,474,475)]
for button in (1,2):
 for x,y in points:
  prefix=out/f'button-{button}-{x}-{y}'
  run('python3',root/'disasm/capture_shop_click.py',args.checkpoint,prefix,x,y,'--button',button)
  run('python3',root/'disasm/verify_shop_selector.py',args.checkpoint,str(prefix)+'.state',x,y,'--button',button,'--output-dir',prefix)
 print('Button',button,':',len(points),'full RGB comparisons pass',flush=True)
