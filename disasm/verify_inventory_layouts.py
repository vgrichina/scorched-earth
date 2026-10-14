#!/usr/bin/env python3
"""Check full Inventory frames around every native column-count threshold.

Uses synthetic owned quantities with native shop repaint and native Inventory
opening. This is rendering coverage, not a continuous purchase/session proof.
"""
import argparse,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-inventory-layouts');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 result=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if result.returncode:print(result.stdout,result.stderr);result.check_returncode()
for count in (16,17,25,26,36,37,48):
 prefix=out/f'owned-{count}'
 run('python3',root/'disasm/capture_shop_inventory.py',args.checkpoint,prefix,count)
 before=str(prefix)+'-ready.state';opened=str(prefix)+'-open'
 run('python3',root/'disasm/capture_shop_click.py',before,opened,275,85)
 run('python3',root/'disasm/verify_shop_selector.py',before,opened+'.state',275,85,'--output-dir',out/f'compare-{count}')
 print(count,'owned items: full RGB match',flush=True)
