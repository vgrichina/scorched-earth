#!/usr/bin/env python3
"""Compare Weapons keyboard edits, dismissal, RGB and committed settings.

Uses native palette/backdrop. Does not cover held input or persistence.
"""
import argparse
import json
import subprocess
import struct
from pathlib import Path
from compare_pipeline import Memory, CPU, PortIO, InterruptHandler, load_state, extract_state, write_state_json

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--case-prefix',default='',help='Run cases whose names start with this prefix')
parser.add_argument('--arrows',action='store_true',help='Compare extended-key input')
parser.add_argument('--limits',action='store_true',help='Compare reverse steps and list wrapping')
parser.add_argument('--edges',action='store_true',help='Compare native widget boundary coordinates')
parser.add_argument('--mouse', action='store_true', help='Compare row clicks, checkbox bounds and dismissal')
parser.add_argument('--output-dir', type=Path, default=Path('/tmp/scorched-weapons-input'))
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
args.output_dir.mkdir(parents=True, exist_ok=True)
def run(*cmd):
    result = subprocess.run(list(map(str, cmd)), cwd=root, capture_output=True, text=True)
    if result.returncode:
        print(result.stdout, result.stderr)
        result.check_returncode()
mem, cpu, ports = Memory(), CPU(), PortIO()
ports.mem = mem
handler = InterruptHandler(mem, cpu, str(root/'earth'), ports)
def settings(checkpoint):
    load_state(str(checkpoint), cpu, mem, ports, handler)
    ds = 0x4fc80
    return dict(armsLevel=mem.read16(ds+0x518a),bombIcon=mem.read16(ds+0x51a2),
                tunneling=mem.read16(ds+0x513a),explosionScale=mem.read16(ds+0x5112),
                tracePaths=mem.read16(ds+0x5168),extraDirt=mem.read16(ds+0x50fc),
                uselessItems=mem.read16(ds+0x50fe),configDirty=bool(mem.read16(ds+0x6314)))


base = args.output_dir/'open'
run('python3', 'disasm/emu_dialog_key.py', args.checkpoint, base, '--key', '0x11:119', '--stop-at', '0x460c3')
state = extract_state(str(base)+'.state')
fixture = args.output_dir/'base.json'
write_state_json(state, fixture)
payload = json.loads(fixture.read_text())
payload.update(settings(str(base)+'.state'), activeSubmenu='weapons')
payload['terrainHeights'] = extract_state(args.checkpoint)['terrainHeights']
fixture.write_text(json.dumps(payload))
keys=dict(ArrowLeft=(0x4b,0),ArrowRight=(0x4d,0),ArrowUp=(0x48,0),ArrowDown=(0x50,0),KeyW=(0x11,119),KeyA=(0x1e,97),KeyB=(0x30,98),KeyT=(0x14,116),KeyS=(0x1f,115),KeyP=(0x19,112),KeyE=(0x12,101),KeyU=(0x16,117),Escape=(1,27),Enter=(0x1c,13),Space=(0x39,32))
cases=[('open',[]),('escape',['Escape']),('enter',['Enter']),('space',['Space'])]
for key in ('KeyA','KeyB','KeyT','KeyS','KeyP','KeyE','KeyU'):
    cases += [(key,[key]), (key+'-close',[key,'Escape'])]
if args.limits:
    cases=[(key+'-reverse',['Alt+'+key,'Escape']) for key in ('KeyA','KeyB','KeyT','KeyS','KeyP','KeyE','KeyU')]
    cases += [(key+'-cycle',[key]*n+['Escape']) for key,n in [('KeyA',5),('KeyB',3),('KeyS',3)]]
    cases += [('reopen',['KeyT','Escape','KeyW'])]
if args.arrows:
    cases=[(key,[key]) for key in ('ArrowLeft','ArrowRight','ArrowUp','ArrowDown')]
if args.mouse or args.edges:
    matches=[]
    for width in range(80,300):
        x=100+(state['width']-1-100-width)//2
        y=(state['height']-1-116)//2
        address=mem.data.find(struct.pack('<5H',x,y,x+width,y+116,7))
        if address>=0: matches.append((x,y,address))
    assert len(matches)==1,matches
    x,y,address=matches[0]
    cases=[(f'row{row}-{button}',[(x+30,y+10+row*15,button),'Escape']) for row in range(7) for button in (1,2)]
    cases += [('outside-left',[(0,0,1)]),('outside-right',[(0,0,2)]),('scale-outside',['KeyS',(0,0,1)])]
    if args.edges:
        cases=[]
        for row in (0,2,6):
            widget=mem.read16(address+32+row*4)+16*mem.read16(address+34+row*4)
            left,top,right,bottom=[mem.read16(widget+off) for off in (0x48,0x4a,0x4c,0x4e)]
            for edge,cx,cy in [('right-in',right-1,top+5),('right',right,top+5),('right-out',right+1,top+5),
                               ('bottom-in',left+20,bottom-1),('bottom',left+20,bottom),('bottom-out',left+20,bottom+1)]:
                for button in (1,2):
                    cases.append((f'row{row}-{edge}-{button}',[(x+cx,y+cy,button),'Escape']))
for name, actions in cases:
    if not name.startswith(args.case_prefix): continue
    native = base
    port_args = []
    for i, key in enumerate(actions):
        target = args.output_dir/f'{name}-{i}'
        if isinstance(key, tuple):
            cx, cy, button = key
            run('python3','disasm/capture_shop_click.py',str(native)+'.state',target,cx,cy,'--button',button)
            port_args += ['--menu-click', f'{cx},{cy},{1 if button==1 else 4}']
        else:
            scan, ascii_code = keys[key.split('+')[-1]]
            run('python3','disasm/capture_shop_click.py',str(native)+'.state',target,0,0,'--key',scan,'--ascii',ascii_code,'--modifiers',8 if '+' in key else 0)
            port_args += ['--menu-key', key]
        native = target
    port = args.output_dir/f'{name}-port.png'
    output = args.output_dir/f'{name}-settings.json'
    run('node','disasm/web_screenshot.mjs','menu',port,'--from-state',fixture,'--menu-output',output,*port_args)
    expected = settings(str(native)+'.state')
    actual = json.loads(output.read_text())
    assert {key:actual[key] for key in expected} == expected, (name, actual, expected)
    run('python3','disasm/compare_screenshots.py',str(native)+'.png',port,args.output_dir/f'{name}-diff.png')
    print(f"{state['width']}x{state['height']} {name}: RGB and committed settings match.", flush=True)
