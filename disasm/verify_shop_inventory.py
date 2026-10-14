#!/usr/bin/env python3
"""Compare cumulative Inventory keyboard input against native full RGB frames.

Starts at an input-ready shop. Uses native keyboard IRQ press/release and mouse
polls, and production port input. Ending DAC phase is aligned; cursor drawing
and wall-clock animation timing are excluded.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');parser.add_argument('--output-dir',default='/tmp/scorched-inventory-input')
args=parser.parse_args();root=Path(__file__).resolve().parent.parent
out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):subprocess.run(list(map(str,cmd)),cwd=root,check=True,stdout=subprocess.DEVNULL)
start=extract_state(args.checkpoint);previous=args.checkpoint
inv_y=85 if start['height']>400 else 75
inputs=['--shop-click',f'275,{inv_y}']
cases=[('open',None),('ArrowLeft',0x4b),('ArrowRight',0x4d),('End',0x4f),('Home',0x47),
       ('ArrowUp',0x48),('ArrowDown',0x50),('PageDown',0x51),('PageUp',0x49),
       ('Enter',0x1c),('Escape',0x01)]
for index,(key,scan) in enumerate(cases):
 prefix=out/f'{index:02d}-{key}'
 cmd=['python3',root/'disasm/capture_shop_click.py',previous,prefix,275,inv_y]
 if scan is not None:cmd+=['--key',hex(scan)];inputs+=['--shop-key',key]
 run(*cmd);previous=str(prefix)+'.state'
 native=extract_state(previous);state=dict(start,palette=native['palette'])
 write_state_json(state,out/'input.json');write_emu_png(native,str(prefix)+'-native.png')
 run('node',root/'disasm/web_screenshot.mjs','shop',str(prefix)+'-port.png','--from-state',out/'input.json',*inputs)
 run('python3',root/'disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
 print(key,'full RGB match',flush=True)
