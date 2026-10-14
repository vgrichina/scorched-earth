#!/usr/bin/env python3
"""Compare real port shop selector input to a native mouse-click checkpoint.

Uses starting state and the ending native DAC phase. Verifies full-frame pixels
but excludes wall-clock palette animation timing and native cursor drawing.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('before');parser.add_argument('after');parser.add_argument('x',type=int);parser.add_argument('y',type=int)
parser.add_argument('--button',type=int,choices=[1,2],default=1)
parser.add_argument('--output-dir',default='/tmp/scorched-shop-selector');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
before,after=extract_state(args.before),extract_state(args.after)
before['palette']=after['palette']
write_state_json(before,out/'input.json');write_emu_png(after,out/'native.png')
subprocess.run(['node',str(root/'disasm/web_screenshot.mjs'),'shop',str(out/'port.png'),'--from-state',str(out/'input.json'),'--shop-click',f'{args.x},{args.y},{4 if args.button==2 else 1}'],cwd=root,check=True)
subprocess.run(['python3',str(root/'disasm/compare_screenshots.py'),str(out/'native.png'),str(out/'port.png'),str(out/'diff.png')],check=True)
