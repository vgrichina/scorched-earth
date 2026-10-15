#!/usr/bin/env python3
"""Compare Sound submenu frames, pending settings and dismissal with native dispatch.

Input is a main-menu checkpoint. Uses its palette and extracted backdrop;
does not verify audio synthesis, held input, cursor timing or other submenus.
"""
import argparse
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
from compare_pipeline import extract_state,write_state_json,Memory,CPU,PortIO,InterruptHandler,load_state

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--arrows',action='store_true',help='Compare ignored extended keys and dismissal')
parser.add_argument('--save',action='store_true',help='Verify Save Changes in an isolated DOS file directory')
parser.add_argument('--output-dir',type=Path,default=Path('/tmp/scorched-sound-submenu'))
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
args.output_dir.mkdir(parents=True,exist_ok=True)
def run(*cmd):
    result=subprocess.run(list(map(str,cmd)),cwd=root,text=True,capture_output=True)
    if result.returncode: print(result.stdout,result.stderr);result.check_returncode()
base=args.output_dir/'open'
run('python3','disasm/emu_dialog_key.py',args.checkpoint,base,'--key','0x18:111','--stop-at','0x460c3')
state=extract_state(str(base)+'.state')
fixture=args.output_dir/'base.json'
write_state_json(state,fixture)
mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
load_state(str(base)+'.state',cpu,mem,ports,handler)
payload=json.loads(fixture.read_text())
payload['terrainHeights']=extract_state(args.checkpoint)['terrainHeights']
payload.update(activeSubmenu='sound',soundEnabled=mem.read16(0x4fc80+0xef46),flySoundEnabled=mem.read16(0x4fc80+0x5146))
payload['configDirty']=bool(mem.read16(0x4fc80+0x6314))
fixture.write_text(json.dumps(payload))
x=(state['width']+100)//2;y=state['height']//2+5
cases=[('open',[]),('left',[('click',1)]),('right',[('click',2)]),
       ('flight',[('key','KeyF')]),('flight-twice',[('key','KeyF')]*2),
       ('flight-wrap',[('key','KeyF')]*3),('sound',[('key','KeyS')]),('sound-wrap',[('key','KeyS')]*2),
       ('escape',[('key','Escape')]),('enter',[('key','Enter')]),('space',[('key','Space')]),
       ('outside',[('outside',1)]),('changed-escape',[('key','KeyS'),('key','Escape')]),
       ('changed-enter',[('key','KeyF'),('key','Enter')]),('changed-space',[('key','KeyF'),('key','Space')]),
       ('changed-outside',[('key','KeyF'),('outside',1)]),
       ('reverted-escape',[('key','KeyS')]*2+[('key','Escape')]),
       ('reopen',[('key','KeyF'),('key','Escape'),('key','KeyO')])]
if args.arrows:
    cases=[(key,[('key',key)]) for key in ('ArrowLeft','ArrowRight','ArrowUp','ArrowDown')]
    cases += [('down-right-close',[('key','ArrowDown'),('key','ArrowRight'),('key','Escape')]),
              ('changed-arrows-close',[('key','KeyF'),('key','ArrowUp'),('key','ArrowLeft'),('key','Escape')])]
if args.save:
    cases=[('disabled-save',[('key','Escape'),('key','KeyC')]),
           ('sound-save',[('key','KeyS'),('key','Escape'),('key','KeyC')]),
           ('flight-save',[('key','KeyF'),('key','Escape'),('key','KeyC')]),
           ('repeat-save',[('key','KeyS'),('key','Escape'),('key','KeyC'),('key','KeyC')]),
           ('save-reopen',[('key','KeyF'),('key','Escape'),('key','KeyC'),('key','KeyO')])]
    isolated=tempfile.TemporaryDirectory(prefix='scorched-save-')
    shutil.copytree(root/'earth',Path(isolated.name)/'earth')
    earth=Path(isolated.name)/'earth'
else:
    earth=root/'earth'
for name,actions in cases:
    if args.save: shutil.copyfile(root/'earth/SCORCH.CFG',earth/'SCORCH.CFG')
    native=base;port_args=[]
    for index,(kind,value) in enumerate(actions):
        target=args.output_dir/f'{name}-{index}'
        if kind in ('click','outside'):
            cx,cy=(x,y) if kind=='click' else (0,0)
            run('python3','disasm/capture_shop_click.py',str(native)+'.state',target,cx,cy,'--button',value,'--earth-dir',earth)
            port_args+=['--menu-click',f'{cx},{cy},{1 if value==1 else 4}']
        else:
            scan,ascii_code={'ArrowLeft':(0x4b,0),'ArrowRight':(0x4d,0),'ArrowUp':(0x48,0),'ArrowDown':(0x50,0),'KeyF':(0x21,102),'KeyS':(0x1f,115),'Escape':(1,27),'Enter':(0x1c,13),'Space':(0x39,32),'KeyO':(0x18,111),'KeyC':(0x2e,99)}[value]
            run('python3','disasm/capture_shop_click.py',str(native)+'.state',target,0,0,'--key',scan,'--ascii',ascii_code,'--earth-dir',earth)
            port_args+=['--menu-key',value]
        native=target
    port=args.output_dir/f'{name}-port.png'
    run('node','disasm/web_screenshot.mjs','menu',port,'--from-state',fixture,'--menu-output',args.output_dir/f'{name}-settings.json','--storage-output',args.output_dir/f'{name}-storage.json',*port_args)
    load_state(str(native)+'.state',cpu,mem,ports,handler)
    expected=dict(soundEnabled=mem.read16(0x4fc80+0xef46),flySoundEnabled=mem.read16(0x4fc80+0x5146),configDirty=bool(mem.read16(0x4fc80+0x6314)))
    actual=json.loads((args.output_dir/f'{name}-settings.json').read_text())
    assert {key:actual[key] for key in expected}==expected,(name,'committed settings differ')
    if args.save:
        storage=json.loads((args.output_dir/f'{name}-storage.json').read_text())
        assert storage['writes']==(0 if name=='disabled-save' else 1),(name,'save count',storage['writes'])
        if name!='disabled-save':
            persisted=json.loads(storage['data']['scorched_earth_config'])
            native_config=dict(line.split('=',1) for line in (earth/'SCORCH.CFG').read_text().splitlines() if '=' in line)
            assert native_config['SOUND']==['Off','On'][persisted['soundEnabled']],name
            assert native_config['FLY_SOUND']==['Off','Vel','Pos'][persisted['flySoundEnabled']],name
        else:
            assert (earth/'SCORCH.CFG').read_bytes()==(root/'earth/SCORCH.CFG').read_bytes()
    run('python3','disasm/compare_screenshots.py',str(native)+'.png',port,args.output_dir/f'{name}-diff.png')
    print(f"{state['width']}x{state['height']} {name}: full native RGB frame matches.",flush=True)
