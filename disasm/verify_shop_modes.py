#!/usr/bin/env python3
"""Rebuild and compare native initial shop frames across the five VGA modes.

Constructed rendering fixtures reuse initialized player/economy state. They do
not prove boot flow, user mode switching, modal input or timing across modes.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-vga-modes');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
for mode in range(5):
 prefix=out/f'mode-{mode}'
 run('python3',root/'disasm/capture_shop_mode.py',args.checkpoint,prefix,mode)
 state=extract_state(str(prefix)+'.state')
 write_state_json(state,str(prefix)+'.json');write_emu_png(state,str(prefix)+'-native.png')
 run('node',root/'disasm/web_screenshot.mjs','shop',str(prefix)+'-port.png','--from-state',str(prefix)+'.json')
 run('python3',root/'disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
 print(f"Mode {mode}: {state['width']}x{state['height']}, all {state['width']*state['height']} RGB pixels match.",flush=True)
