#!/usr/bin/env python3
"""Full-frame native/port sell flow from a shop owning Baby Missiles and Missiles.

Uses real dialog/input paths, aligns ending DAC phase, excludes cursor/speaker
and wall-clock timing. The fixture must own at least two Missiles.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--controls',action='store_true',help='Exercise right click, Q, and accept/reject keyboard shortcuts')
parser.add_argument('--output-dir',default='/tmp/scorched-sell-flow');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 result=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if result.returncode:print(result.stdout,result.stderr);result.check_returncode()
start=extract_state(args.checkpoint);previous=args.checkpoint;inputs=[]
assert start['tanks'][start['currentPlayer']]['inventory'][1]>=2,'Expected at least two Missiles'
cases=[('inventory',[275,85]),('sell',[165,267]),('down',('ArrowDown',0x50)),
 ('up',('ArrowUp',0x48)),('reject',[200,276]),('reopen',[165,267]),
 ('accept-one',[150,276]),('reopen-again',[165,267]),
 ('wrap-to-stock',[129,240]),('accept-rest',[150,276]),('close',('Escape',0x01))]
if args.controls:
 cases=[('inventory',[275,85]),('sell',[165,267]),('alt-wrap',('Alt+KeyQ',0x10,0x71)),('alt-decrease',('Alt+KeyQ',0x10,0x71)),
  ('q-back-to-five',('KeyQ',0x10,0x71)),('q-back-to-one',('KeyQ',0x10,0x71)),('right-increase',[129,240,2]),
  ('q-increase',('KeyQ',0x10,0x71)),('left-decrease',[129,240]),
  ('q-3',('KeyQ',0x10,0x71)),('q-4',('KeyQ',0x10,0x71)),('q-5',('KeyQ',0x10,0x71)),
  ('q-wrap',('KeyQ',0x10,0x71)),('left-wrap',[129,240]),('right-wrap',[129,240,2]),
  ('enter-ignored',('Enter',0x1c,13)),('space-ignored',('Space',0x39,32)),
  ('r-reject',('KeyR',0x13,0x72)),('reopen',[165,267]),('a-accept',('KeyA',0x1e,0x61)),
  ('reopen-again',[165,267]),('escape-reject',('Escape',1,27)),
  ('reopen-right',[165,267]),('right-accept',[150,276,2]),('close',('Escape',1,27))]
# Dialog coordinates translate with the centered native popup. Action buttons
# stay fixed at x=250 and use extra spacing only above 400 pixels high.
for _,action in cases:
 if isinstance(action,list):
  if action[:2]==[275,85]:action[1]=85 if start['height']>400 else 75
  else:
   action[0]+=(start['width']-360)//2
   action[1]+=(start['height']-480)//2
for index,(name,action) in enumerate(cases):
 prefix=out/f'{index:02d}-{name}'
 if isinstance(action,list):
  button=action[2] if len(action)>2 else 1
  run('python3',root/'disasm/capture_shop_click.py',previous,prefix,*action[:2],'--button',button)
  inputs+=['--shop-click',','.join(map(str,[*action[:2],4 if button==2 else 1]))]
 else:
  key,scan=action[:2];ascii_value=action[2] if len(action)>2 else 0
  run('python3',root/'disasm/capture_shop_click.py',previous,prefix,165,267,'--key',hex(scan),'--ascii',ascii_value,'--modifiers',8 if key.startswith('Alt+') else 0)
  inputs+=['--shop-key',key]
 previous=str(prefix)+'.state';native=extract_state(previous)
 state=dict(start,palette=native['palette']);write_state_json(state,out/'input.json')
 write_emu_png(native,str(prefix)+'-native.png')
 run('node',root/'disasm/web_screenshot.mjs','shop',str(prefix)+'-port.png','--from-state',out/'input.json',*inputs)
 run('python3',root/'disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
 print(name,'full RGB match',flush=True)
