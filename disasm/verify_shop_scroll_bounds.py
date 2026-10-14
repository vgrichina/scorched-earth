#!/usr/bin/env python3
"""Compare native and port shop-arrow boundaries across VGA/VESA resolutions.

Uses real native clicks and full RGB comparisons with ending palette phase
aligned. Excludes cursor, speaker waits and wall-clock animation timing.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-scroll-bounds');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
state=extract_state(args.checkpoint)
# Native builder 15BBA: row baseline 55, stride 20, stop at FG_MAXY-20.
# The tall/narrow VGA modes use their native aspect-dependent border.
per_page=min(44,(state['height']-76)//20+1)
border=3 if state['width'] in (320,360) and state['height']>=400 else 2
top=55-border;bottom=top+(per_page-1)*20
points=[(x,y) for x in (199,200,214,215) for y in (top+7,bottom+7)]
points += [(207,base+dy) for base in (top,bottom) for dy in (-1,0,1,2,3,12,13,14,15)]
points += [(207,(top+bottom)//2)]
for button in (1,2):
 for x,y in points:
  prefix=out/f'button-{button}-{x}-{y}'
  run('python3',root/'disasm/capture_shop_click.py',args.checkpoint,prefix,x,y,'--button',button)
  run('python3',root/'disasm/verify_shop_selector.py',args.checkpoint,str(prefix)+'.state',x,y,'--button',button,'--output-dir',prefix)
 print('Button',button,':',len(points),'full RGB comparisons pass',flush=True)
