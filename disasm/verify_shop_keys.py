#!/usr/bin/env python3
"""Compare native shop navigation keys to real port input, full RGB frames.

Each key starts from the supplied input-ready shop checkpoint. Palette phase
is aligned; cursor and wall-clock animation timing are excluded.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--keys',nargs='+',help='Choose named keys instead of the navigation set')
parser.add_argument('--sequence',action='store_true',help='Run keys cumulatively instead of resetting between keys')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-keys');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
cases=[('ArrowUp',0x48),('ArrowDown',0x50),('Home',0x47),('End',0x4f),('PageUp',0x49),('PageDown',0x51),('ArrowLeft',0x4b),('ArrowRight',0x4d)]
if args.keys:
 mapping=dict(cases,Tab=0x0f,Backspace=0x0e,Delete=0x53)
 cases=[(name,mapping[name]) for name in args.keys]
previous=args.checkpoint;keys=[]
for step,(name,scan) in enumerate(cases):
 prefix=out/(f'{step}-{name}' if args.sequence else name)
 run('python3',root/'disasm/capture_shop_click.py',previous,prefix,0,0,'--key',hex(scan),'--ascii',{'Tab':9,'Backspace':8}.get(name,0))
 before,after=extract_state(args.checkpoint),extract_state(str(prefix)+'.state')
 before['palette']=after['palette'];write_state_json(before,str(prefix)+'-input.json');write_emu_png(after,str(prefix)+'-native.png')
 keys=keys+[name] if args.sequence else [name]
 run('node',root/'disasm/web_screenshot.mjs','shop',str(prefix)+'-port.png','--from-state',str(prefix)+'-input.json',*[arg for key in keys for arg in ('--shop-key',key)])
 if args.sequence:previous=str(prefix)+'.state'
 run('python3',root/'disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
 print(name,'full RGB match',flush=True)
