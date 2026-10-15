#!/usr/bin/env python3
"""Compare Play Options keyboard edits, dismissal, RGB and committed settings.

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
parser.add_argument('--text',action='store_true',help='Compare filename editing')
parser.add_argument('--limits',action='store_true',help='Compare reverse steps and list wrapping')
parser.add_argument('--mouse', action='store_true', help='Compare row clicks, checkbox bounds and dismissal')
parser.add_argument('--output-dir', type=Path, default=Path('/tmp/scorched-playoptions-input'))
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
    def filename(offset): return bytes(mem.data[ds+offset:ds+offset+64]).split(b'\0')[0].decode('ascii')
    return dict(playMode=mem.read16(ds+0x5188),teamMode=mem.read16(ds+0x50ea),
                statusBar=mem.read16(ds+0x5142),playOrder=mem.read16(ds+0x519c),
                fastComputers=mem.read16(ds+0x50ee),talkingTanks=mem.read16(ds+0x5118),
                talkProbability=mem.read16(ds+0x511a),attackFile=filename(0xecd8),dieFile=filename(0xed18),
                configDirty=bool(mem.read16(ds+0x6314)))


base = args.output_dir/'open'
run('python3', 'disasm/emu_dialog_key.py', args.checkpoint, base, '--key', '0x14:116', '--stop-at', '0x460c3')
state = extract_state(str(base)+'.state')
fixture = args.output_dir/'base.json'
write_state_json(state, fixture)
payload = json.loads(fixture.read_text())
payload.update(settings(str(base)+'.state'), activeSubmenu='playoptions')
payload['terrainHeights'] = extract_state(args.checkpoint)['terrainHeights']
fixture.write_text(json.dumps(payload))
keys=dict(ArrowLeft=(0x4b,0),ArrowRight=(0x4d,0),ArrowUp=(0x48,0),ArrowDown=(0x50,0),KeyT=(0x14,116),KeyM=(0x32,109),KeyB=(0x30,98),KeyO=(0x18,111),KeyF=(0x21,102),KeyL=(0x26,108),KeyP=(0x19,112),KeyA=(0x1e,97),KeyD=(0x20,100),KeyX=(0x2d,120),Period=(0x34,46),Backspace=(0x0e,8),Escape=(1,27),Enter=(0x1c,13),Space=(0x39,32))
cases=[('open',[]),('escape',['Escape']),('enter',['Enter']),('space',['Space'])]
for key in ('KeyM','KeyT','KeyB','KeyO','KeyF','KeyL','KeyP'):
    cases += [(key,[key]), (key+'-close',[key,'Escape'])]
for key in ('KeyA','KeyD'):
    cases += [(key,[key]),(key+'-cancel',[key,'Escape']), (key+'-edit',[key,'KeyX','Enter']), (key+'-edit-close',[key,'KeyX','Enter','Escape'])]
if args.limits:
    cases=[(key+'-reverse',['Alt+'+key,'Escape']) for key in ('KeyM','KeyT','KeyB','KeyO','KeyF','KeyL','KeyP')]
    cases += [('mode-'+str(n),['KeyM']*n) for n in range(2,4)]
    cases += [('teams-'+str(n),['KeyT']*n) for n in range(2,5)]
if args.text:
    cases=[('typing',['KeyA','KeyX']),('period',['KeyD','KeyX','Period','KeyX']),
           ('backspace',['KeyA','KeyX','KeyX','Backspace']),('empty-enter',['KeyA','Enter']),
           ('typed-cancel',['KeyD','KeyX','Escape']),('length-limit',['KeyA']+['KeyX']*13+['Enter','Escape'])]
if args.arrows:
    cases=[(key,[key]) for key in ('ArrowLeft','ArrowRight','ArrowUp','ArrowDown')]
if args.mouse:
    matches=[]
    for width in range(80,300):
        x=100+(state['width']-1-100-width)//2
        y=(state['height']-1-147)//2
        if mem.data.find(struct.pack('<5H',x,y,x+width,y+147,9))>=0: matches.append((x,y))
    assert len(matches)==1,matches
    x,y=matches[0]
    cases=[(f'row{row}-{button}',[(x+30,y+10+row*15,button),'Escape']) for row in range(9) for button in (1,2)]
    cases += [(f'field{row}-{button}',[(x+150,y+10+row*15,button),'Escape']) for row in (7,8) for button in (1,2)]
    cases += [('mode-outside',['KeyM',(0,0,1)]),('outside-right',[(0,0,2)])]
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
    # Align cursor animation phase only; native CPU polling and port RAF clocks differ.
    cursor_rgb=extract_state(str(native)+'.state')['palette'][162]
    port_args += ['--menu-blink-frame', '20' if cursor_rgb[0]==45 else '0']
    run('node','disasm/web_screenshot.mjs','menu',port,'--from-state',fixture,'--menu-output',output,*port_args)
    expected = settings(str(native)+'.state')
    actual = json.loads(output.read_text())
    assert {key:actual[key] for key in expected} == expected, (name, actual, expected)
    run('python3','disasm/compare_screenshots.py',str(native)+'.png',port,args.output_dir/f'{name}-diff.png')
    print(f"{state['width']}x{state['height']} {name}: RGB and committed settings match.", flush=True)
