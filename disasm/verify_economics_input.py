#!/usr/bin/env python3
"""Compare Economics keyboard edits, dismissal, RGB and committed settings.

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
parser.add_argument('--arrows',action='store_true',help='Compare ignored extended keys and dismissal')
parser.add_argument('--mouse', action='store_true', help='Run mouse rows and outside-dismissal sequences')
parser.add_argument('--alt', action='store_true', help='Run reversed keyboard shortcuts')
parser.add_argument('--system', action='store_true', help='Run nested System Menu opening, Sound and dismissal')
parser.add_argument('--confirm', action='store_true', help='Run Quit/New confirmation opening and cancellation')
parser.add_argument('--output-dir', type=Path, default=Path('/tmp/scorched-economics-input'))
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
    return dict(soundEnabled=mem.read16(ds+0xef46),flySoundEnabled=mem.read16(ds+0x5146),interest=mem.read_float64(ds+0x5190)*100,
                startCash=mem.read32(ds+0x516a), computersBuy=mem.read16(ds+0x515e),
                freeMarket=mem.read16(ds+0x514a), scoringMode=mem.read16(ds+0x5148),
                configDirty=bool(mem.read16(ds+0x6314)))
base = args.output_dir/'open'
run('python3', 'disasm/emu_dialog_key.py', args.checkpoint, base, '--key', '0x12:101', '--stop-at', '0x460c3')
state = extract_state(str(base)+'.state')
fixture = args.output_dir/'base.json'
write_state_json(state, fixture)
payload = json.loads(fixture.read_text())
payload.update(settings(str(base)+'.state'), activeSubmenu='economics')
payload['terrainHeights'] = extract_state(args.checkpoint)['terrainHeights']
fixture.write_text(json.dumps(payload))
keys = dict(ArrowLeft=(0x4b,0),ArrowRight=(0x4d,0),ArrowUp=(0x48,0),ArrowDown=(0x50,0),KeyI=(0x17,105), KeyC=(0x2e,99), KeyB=(0x30,98), KeyF=(0x21,102),
            KeyS=(0x1f,115), KeyE=(0x12,101), KeyQ=(0x10,113), KeyN=(0x31,110), Escape=(1,27), Enter=(0x1c,13), Space=(0x39,32))
cases = [('open', []), ('escape', ['Escape']), ('enter', ['Enter']), ('space', ['Space'])]
for key in ['KeyI', 'KeyC', 'KeyB', 'KeyF', 'KeyS']:
    cases += [(key, [key]), (key+'-escape', [key,'Escape'])]
cases += [('scoring-wrap', ['KeyS']*3), ('reverted', ['KeyB','KeyB','Escape']),
          ('changed-enter', ['KeyF','Enter']), ('changed-space', ['KeyF','Space']),
          ('reopen', ['KeyB','Escape','KeyE'])]
if args.arrows:
    cases=[(key,[key]) for key in ('ArrowLeft','ArrowRight','ArrowUp','ArrowDown')]
    cases += [('down-right-close',['ArrowDown','ArrowRight','Escape']),
              ('changed-arrows-close',['KeyC','ArrowUp','ArrowLeft','Escape'])]
if args.alt:
    cases = []
    for key in ['KeyI','KeyC','KeyB','KeyF','KeyS']:
        cases += [(key+'-alt', ['Alt+'+key]),
                  (key+'-alt-close', ['AltRight+'+key,'Escape']),
                  (key+'-alt-restore', ['Alt+'+key,key,'Escape'])]
if args.mouse:
    # Locate the actual native dialog rather than assuming the port's width.
    matches = []
    for width in range(80, 300):
        x = 100+(state['width']-1-100-width)//2
        y = (state['height']-1-86)//2
        address = mem.data.find(struct.pack('<5H', x, y, x+width, y+86, 5))
        if address >= 0:
            matches.append((x, y))
    assert len(matches) == 1, matches
    x, y = matches[0]
    cases = []
    for row in range(5):
        for spot, dx, dy in [('upper', 13, 2), ('lower', 13, 9), ('label', 30, 5)]:
            for button in (1, 2):
                cases.append((f'row{row}-{spot}-{button}', [(x+dx,y+5+row*15+dy,button)]))
    cases += [('outside-left', [(0,0,1)]), ('outside-right', [(0,0,2)]),
              ('changed-outside', ['KeyF',(0,0,1)]),
              ('changed-outside-right', ['KeyF',(0,0,2)])]
if args.system:
    row_h=24 if state['height']>201 else 20
    sy=(state['height']-1-(row_h*5+26))//2+5+5*row_h+5
    sx=(state['width']-1-210)//2+54
    cases=[('system-open',['Alt+KeyS']),('system-escape',['Alt+KeyS','Escape']),
           ('system-enter',['Alt+KeyS','Enter']),('system-space',['Alt+KeyS','Space']),
           ('system-sound',['Alt+KeyS','KeyS']),('system-sound-close',['Alt+KeyS','KeyS','Escape']),
           ('system-sound-left',['Alt+KeyS',(sx,sy,1)]),
           ('system-sound-right',['Alt+KeyS',(sx,sy,2)]),
           ('system-outside',['Alt+KeyS',(0,0,1)]),
           ('system-edited-outside',['Alt+KeyS','KeyS',(0,0,2)]),
           ('system-preserve-draft',['KeyF','Alt+KeyS','Escape','Escape'])]
if args.confirm:
    cases=[]
    for name,key,width in [('quit','KeyQ',128),('new','KeyN',230)]:
        entry=['Alt+KeyS',key]
        x=(state['width']-1-width)//2;y=(state['height']-1-53)//2
        gap=(width-29-23)//3;no_x=x+2*gap+29+6
        cases += [(name+'-open',entry), (name+'-no',entry+['KeyN']),
                  (name+'-escape',entry+['Escape']), (name+'-enter',entry+['Enter']),
                  (name+'-space',entry+['Space']), (name+'-outside',entry+[(0,0,1)]),
                  (name+'-no-left',entry+[(no_x,y+29,1)]),
                  (name+'-no-right',entry+[(no_x,y+29,2)])]
for name, actions in cases:
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
