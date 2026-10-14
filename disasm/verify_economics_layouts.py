#!/usr/bin/env python3
"""Compare native Economics opening frames with matching port settings.

Reuses native palette and terrain. Optional variants alter configuration before
opening the real dialog. Does not verify editing, dismissal or saving.
"""
import argparse
import json
from pathlib import Path
import subprocess
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_state,write_state_json
from emu.state import save_state

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--variants',action='store_true')
parser.add_argument('--output-dir',type=Path,default=Path('/tmp/scorched-economics'))
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
args.output_dir.mkdir(parents=True,exist_ok=True)
cases=[None]
if args.variants:cases += [(0,0,0,0,0),(30,1000000,1,1,2),(1,5000,0,1,1),(12,123456,1,0,0)]
def run(*cmd):
    r=subprocess.run(list(map(str,cmd)),cwd=root,capture_output=True,text=True)
    if r.returncode:print(r.stdout,r.stderr);r.check_returncode()
for index,values in enumerate(cases):
    m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
    load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
    if values is not None:
        interest,cash,buy,market,scoring=values
        m.write_float64(ds+0x5190,interest/100);m.write32(ds+0x516a,cash)
        for offset,value in ((0x515e,buy),(0x514a,market),(0x5148,scoring)):m.write16(ds+offset,value)
    settings=dict(interest=m.read_float64(ds+0x5190)*100,startCash=m.read32(ds+0x516a),
                  computersBuy=m.read16(ds+0x515e),freeMarket=m.read16(ds+0x514a),scoringMode=m.read16(ds+0x5148))
    prefix=args.output_dir/f'case-{index}'
    save_state(str(prefix)+'-before.state',c,m,p,h)
    run('python3','disasm/emu_dialog_key.py',str(prefix)+'-before.state',prefix,'--key','0x12:101','--stop-at','0x460c3')
    state=extract_state(str(prefix)+'.state');write_state_json(state,str(prefix)+'.json')
    fixture=Path(str(prefix)+'.json');payload=json.loads(fixture.read_text())
    payload.update(settings,activeSubmenu='economics',configDirty=bool(m.read16(ds+0x6314)))
    payload['terrainHeights']=extract_state(args.checkpoint)['terrainHeights']
    fixture.write_text(json.dumps(payload))
    run('node','disasm/web_screenshot.mjs','menu',str(prefix)+'-port.png','--from-state',fixture)
    run('python3','disasm/compare_screenshots.py',str(prefix)+'.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
    print(f"{state['width']}x{state['height']} Economics {index}: full RGB frame matches.",flush=True)
