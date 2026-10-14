#!/usr/bin/env python3
"""Compare Update opening/dismissal using native shop input and full RGB frames."""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import extract_state,write_state_json,write_emu_png
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint')
parser.add_argument('--output-dir',default='/tmp/scorched-shop-update');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
def run(*cmd):
 r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
 if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
def compare(name,before,after,events):
 state,ending=extract_state(before),extract_state(after);state['palette']=ending['palette']
 prefix=out/name;write_state_json(state,str(prefix)+'.json');write_emu_png(ending,str(prefix)+'-native.png')
 run('node',root/'disasm/web_screenshot.mjs','shop',str(prefix)+'-port.png','--from-state',str(prefix)+'.json',*events)
 run('python3',root/'disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
 print(name,'full RGB match',flush=True)
for name,extra,event in [('left',[],['--shop-click','275,60,1']),('right',['--button','2'],['--shop-click','275,60,4']),('key',['--key','0x16','--ascii','117'],['--shop-key','KeyU'])]:
 prefix=out/name
 run('python3',root/'disasm/capture_shop_click.py',args.checkpoint,prefix,275,60,*extra)
 compare(name,args.checkpoint,str(prefix)+'.state',event)
opened=str(out/'left.state')
for name,scan,ascii_value in [('Enter',0x1c,13),('Escape',1,27),('Space',0x39,32),('ArrowUp',0x48,0),('KeyA',0x1e,97)]:
 prefix=out/('dismiss-'+name)
 run('python3',root/'disasm/capture_shop_click.py',opened,prefix,0,0,'--key',hex(scan),'--ascii',ascii_value)
 compare('dismiss-'+name,args.checkpoint,str(prefix)+'.state',['--shop-click','275,60,1','--shop-key',name])
dimensions=extract_state(args.checkpoint)
for button in (1,2):
 for x,y in [(dimensions['width']//2,dimensions['height']//2),(10,dimensions['height']-20)]:
  name=f'dismiss-mouse-{button}-{x}';prefix=out/name
  run('python3',root/'disasm/capture_shop_click.py',opened,prefix,x,y,'--button',button)
  compare(name,args.checkpoint,str(prefix)+'.state',['--shop-click','275,60,1','--shop-click',f'{x},{y},{1 if button==1 else 4}'])
