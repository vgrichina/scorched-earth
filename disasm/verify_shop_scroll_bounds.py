#!/usr/bin/env python3
"""Compare native and port shop-arrow boundaries at 360x480.

Uses real native clicks and full RGB comparisons with ending palette phase
aligned. Excludes cursor, speaker waits and wall-clock animation timing.
"""
import argparse,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-scroll-bounds');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
points=[(x,y) for x in (199,200,214,215) for y in (59,459)]
points += [(207,y) for y in (51,52,53,54,55,64,65,66,67,451,452,453,454,455,464,465,466,467,300)]
for button in (1,2):
 for x,y in points:
  prefix=out/f'button-{button}-{x}-{y}'
  run('python3',root/'disasm/capture_shop_click.py',args.checkpoint,prefix,x,y,'--button',button)
  run('python3',root/'disasm/verify_shop_selector.py',args.checkpoint,str(prefix)+'.state',x,y,'--button',button,'--output-dir',prefix)
 print('Button',button,':',len(points),'full RGB comparisons pass',flush=True)
