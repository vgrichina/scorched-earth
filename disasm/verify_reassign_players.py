#!/usr/bin/env python3
"""Compare Reassign Players edits, dismissal, RGB and committed settings.

Uses native palette/backdrop. Does not cover held input or persistence.
"""
import argparse
import json
import subprocess
import struct
from pathlib import Path
from emu.state import save_state
from compare_pipeline import Memory, CPU, PortIO, InterruptHandler, load_state, extract_state, write_state_json

parser = argparse.ArgumentParser(description='Compare native Reassign Players roster and edits')
parser.add_argument('checkpoint')
parser.add_argument('--check-each-step',action='store_true',help='With aligned idle, compare RGB and callback counter after every input')
parser.add_argument('--align-setup-idle',action='store_true',help='Replay native callback counts for every input and verify the persistent counter')
parser.add_argument('--empty-first-name',action='store_true')
parser.add_argument('--start',action='store_true')
parser.add_argument('--start-shop',action='store_true',help='Complete both retained-name human editors and compare the first shop')
parser.add_argument('--start-tanks',action='store_true',help='Check tank defaults across ordinary startup editors')
parser.add_argument('--ten-players',action='store_true')
parser.add_argument('--icons',action='store_true')
parser.add_argument('--names',action='store_true')
parser.add_argument('--ai',action='store_true')
parser.add_argument('--mouse',action='store_true')
parser.add_argument('--case-prefix',default='')
parser.add_argument('--output-dir',type=Path,default=Path('/tmp/scorched-reassign'))
args = parser.parse_args()
if args.start_tanks or args.start_shop:args.start=True
if args.check_each_step and not args.align_setup_idle:parser.error('--check-each-step requires --align-setup-idle')
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
    state=extract_state(checkpoint)
    roster=[]
    for i,t in enumerate(state['tanks']):
        roster.append(dict(identityIndex=mem.read16(ds+0xd568+i*0xca+0xa0),colorRgb=[mem.read16(ds+0xd568+i*0xca+o) for o in (0x1c,0x1e,0x20)],name=t['name'],aiType=mem.read16(ds+0xd568+i*0xca+0x22),aiSelection=struct.unpack('<h',struct.pack('<H',mem.read16(ds+0xd568+i*0xca+0x24)))[0],colorIndex=t['colorBase']//8,tankType=t['tankType']))
    return dict(interest=mem.read_float64(ds+0x5190)*100,startCash=mem.read32(ds+0x516a),computersBuy=mem.read16(ds+0x515e),freeMarket=mem.read16(ds+0x514a),scoringMode=mem.read16(ds+0x5148),reassignRoster=roster,configDirty=bool(mem.read16(ds+0x6314)))

if args.start:
    load_state(args.checkpoint,cpu,mem,ports,handler)
    if args.empty_first_name:
        address=0x4fc80+0xd568+0xb6
        pointer=mem.read16(address)+16*mem.read16(address+2)
        assert pointer, 'Expected allocated initial name buffer'
        mem.write8(pointer,0)
    assert mem.read16(0x618a0)==0x110 and mem.read16(0x618a2)==0x60,'Expected capture_menu caller'
    mem.write16(0x618a0,0x445);mem.write16(0x618a2,0x2431);mem.write16(0x6189e,0x2500)
    args.checkpoint=str(args.output_dir/'caller.state')
    save_state(args.checkpoint,cpu,mem,ports,handler)
if args.ten_players:
    # Reach the ten-player roster through native menu input, not synthetic tanks.
    for i in range(10-extract_state(args.checkpoint)['numPlayers']):
        target=args.output_dir/f'add-player-{i}'
        run('python3','disasm/capture_shop_click.py',args.checkpoint,target,0,0,'--key',0x19,'--ascii',112)
        args.checkpoint=str(target)+'.state'
base = args.output_dir/'open'
run('python3', 'disasm/emu_dialog_key.py', args.checkpoint, base, '--key', '0x12:101', '--stop-at', '0x460c3')
state = extract_state(str(base)+'.state')
fixture = args.output_dir/'base.json'
write_state_json(state, fixture)
payload = json.loads(fixture.read_text())
payload.update(settings(str(base)+'.state'), activeSubmenu='economics')
if args.align_setup_idle:payload['setupBackdropPolls']=mem.read16(0x4fc80+0x5008)
if args.start_shop:payload['shopFrame']=mem.read16(0x4fc80+0xec)
payload['explosionTextureRadius']=mem.read16(0x4fc80+0x51a6)
payload['randomState']=dict(index=mem.read16(0x4fc80+0xec06),words=[mem.read16(0x4fc80+0xea12+i*2) for i in range(250)])
payload['terrainHeights'] = extract_state(args.checkpoint)['terrainHeights']
fixture.write_text(json.dumps(payload))
keys=dict(Digit0=(0x0b,48),KeyM=(0x32,109),KeyH=(0x23,104),KeyT=(0x14,116),KeyC=(0x2e,99),KeyY=(0x15,121),KeyU=(0x16,117),KeyI=(0x17,105),KeyS=(0x1f,115),KeyP=(0x19,112),KeyN=(0x31,110),KeyX=(0x2d,120),KeyD=(0x20,100),Digit1=(2,49),Digit2=(3,50),Escape=(1,27),Enter=(0x1c,13),Space=(0x39,32))
entry=['Alt+KeyS','KeyP']
cases=[('open',entry),('escape',entry+['Escape']),('enter',entry+['Enter']),('space',entry+['Space']),
       ('player1',entry+['Digit1']),('player1-done',entry+['Digit1','KeyD']),
       ('rename',entry+['Digit1','KeyN','KeyX','Enter','KeyD']),
       ('player2',entry+['Digit2']),('player2-escape',entry+['Digit2','Escape'])]
if args.ten_players:
    rename_last=entry+['Digit0','KeyN','KeyX','Enter','KeyD']
    cases=[('open',entry),('last',entry+['Digit0']),('last-done',rename_last),('last-reopen',rename_last+['Digit0']),('first-done',entry+['Digit1','KeyD'])]
    small=state['height']<=200
    y=(state['height']-1-(195 if small else 212))//2
    x=(state['width']-1-130)//2
    for button in (1,2):
        cases.append((f'last-mouse{button}',entry+[(x+31,y+(24 if small else 25)+9*(17 if small else 18),button)]))
if args.ai:
    editor=entry+['Digit1','Space']
    cases=[('computer',editor),('computer-done',editor+['KeyD']),
           ('computer-reopen',editor+['KeyD','Digit1']),
           ('human-again',editor+['Space','KeyD']),
           ('tank-change',entry+['Digit1','KeyI','KeyD'])]
    for key in ('KeyM','KeyH','KeyP','KeyT','KeyC','KeyS','KeyY','KeyU'):
        cases += [(key,editor+[key]),(key+'-done',editor+[key,'KeyD'])]
    cases += [('unknown-reopen',editor+['KeyU','KeyD','Digit1']),('unknown-twice',editor+['KeyU','KeyD','Digit1','KeyD']),('unknown-to-human',editor+['KeyU','KeyD','Digit1','Space','KeyD']),('unknown-to-moron',editor+['KeyU','KeyD','Digit1','KeyM','KeyD'])]
if args.start:
    start=entry+['Digit1','KeyN','KeyX','Enter','KeyD','Escape','Escape','KeyS']
    cases=[('start-after-rename',start),('start-cancel-name',start+['Escape']),
           ('start-computer',start+['Escape','Space','KeyC']),
           ('start-next-human',start+['Escape','KeyD']),
           ('start-next-computer',start+['Escape','Space','KeyC','KeyD']),
           ('start-next-unknown',start+['Escape','Space','KeyU','KeyD'])]
if args.start_shop:
    cases=[('start-first-shop',start+['Escape','KeyD','Escape','KeyD']),
           ('ordinary-first-shop',['Escape','KeyS','KeyX','Enter','KeyD','KeyY','Enter','KeyD']),
           ('start-second-shop',start+['Escape','KeyD','Escape','KeyD','KeyD'])]
if args.start and args.empty_first_name:
    cases=[('empty-computer',['Escape','KeyS','Escape','Space','KeyC','KeyD']),
           ('empty-unknown',['Escape','KeyS','Escape','Space','KeyU','KeyD'])]
if args.start_tanks:
    x=(state['width']-202)//2;y=(state['height']-146)//2
    computer=['Escape','KeyS','Escape','Space','KeyC']
    cases=[]
    for tank in (0,5,6):
        chosen=computer+[(x+25+tank*25,y+90,1)]
        cases += [(f'start-tank-{tank}-next',chosen+['KeyD']),
                  (f'start-tank-{tank}-human',chosen+['Space'])]
if args.names:
    rename=entry+['Digit1','KeyN']+['KeyM']*15+['Enter','KeyD']
    cases=[('long-name',rename),('long-name-reopen',rename+['Digit1']),
           ('shorten',rename+['Digit1','KeyN','KeyX','Enter','KeyD']),
           ('shorten-reopen',rename+['Digit1','KeyN','KeyX','Enter','KeyD','Escape']+entry)]
if args.icons:
    x=(state['width']-202)//2;y=(state['height']-146)//2
    cases=[]
    for computer,tanks in [(False,(0,5)),(True,(6,))]:
        for tank in tanks:
            for button in (1,2):
                actions=entry+['Digit1']+(['Space'] if computer else [])+[(x+25+tank*25,y+90,button)]
                cases += [(f'icon-{computer}-{tank}-{button}-pending',actions),(f'icon-{computer}-{tank}-{button}-done',actions+['KeyD']),(f'icon-{computer}-{tank}-{button}-reopen',actions+['KeyD','Digit1'])]
if args.mouse:
    # These two-player fixtures have the native minimum-name width.
    x=(state['width']-1-130)//2
    height=68 if state['height']>300 else 67
    y=(state['height']-1-height)//2
    cases=[('outside',entry+[(0,0,1)]),('outside-right',entry+[(0,0,2)])]
    for i in range(2):
        for button in (1,2):cases += [(f'player{i+1}-mouse{button}',entry+[(x+18,y+25+i*18,button)])]
for name, actions in cases:
    if not name.startswith(args.case_prefix):continue
    native = base
    port_args = []
    for i, key in enumerate(actions):
        target = args.output_dir/f'{name}-{i}'
        trace=args.output_dir/f'{name}-{i}-callbacks.json'
        trace_args=['--setup-trace',trace] if args.align_setup_idle else []
        shop_trace=args.output_dir/f'{name}-{i}-shop-callbacks.json'
        if args.start_shop:trace_args+=['--shop-trace',shop_trace]
        if isinstance(key, tuple):
            cx, cy, button = key
            run('python3','disasm/capture_shop_click.py',str(native)+'.state',target,cx,cy,'--button',button,*trace_args)
            port_args += ['--menu-click', f'{cx},{cy},{1 if button==1 else 4}']
        else:
            scan, ascii_code = keys[key.split('+')[-1]]
            run('python3','disasm/capture_shop_click.py',str(native)+'.state',target,0,0,'--key',scan,'--ascii',ascii_code,'--modifiers',8 if '+' in key else 0,'--max-steps',10000000 if args.start else 5000000,*trace_args)
            port_args += ['--menu-key', key]
        if args.align_setup_idle:port_args += ['--menu-setup-callbacks',len(json.loads(trace.read_text()))]
        if args.start_shop:port_args += ['--menu-shop-callbacks',len(json.loads(shop_trace.read_text()))]
        if args.check_each_step:
            step_port=args.output_dir/f'{name}-{i}-port.png'
            step_output=args.output_dir/f'{name}-{i}-port.json'
            run('node','disasm/web_screenshot.mjs','menu',step_port,'--from-state',fixture,'--menu-output',step_output,*port_args)
            load_state(str(target)+'.state',cpu,mem,ports,handler)
            assert json.loads(step_output.read_text())['setupBackdropPolls']==mem.read16(0x4fc80+0x5008),(name,i,'idle counter mismatch')
            run('python3','disasm/compare_screenshots.py',str(target)+'.png',step_port,args.output_dir/f'{name}-{i}-diff.png')
            print(f'{name} step {i}: full RGB and callback counter match.',flush=True)
        native = target
    port = args.output_dir/f'{name}-port.png'
    output = args.output_dir/f'{name}-settings.json'
    run('node','disasm/web_screenshot.mjs','menu',port,'--from-state',fixture,'--rng-output',args.output_dir/f'{name}-rng.json','--menu-output',output,*port_args)
    expected = settings(str(native)+'.state')
    actual = json.loads(output.read_text())
    if args.align_setup_idle:
        assert actual['setupBackdropPolls']==mem.read16(0x4fc80+0x5008),(name,'idle counter mismatch')
    if args.start_shop:
        assert actual['playerSetup'] is None
        assert actual['shopFrame']==mem.read16(0x4fc80+0xec),(name,'shop counter mismatch')
    elif args.start:
        native_setup=extract_state(str(native)+'.state')['playerSetup']
        wanted={key:native_setup[key] for key in ('name','tankType','human','editName','aiType') if key in native_setup}
        assert actual['playerSetup']==wanted,(name,actual['playerSetup'],wanted)
        print(f'{name}: player editor fields match.',flush=True)
    assert json.loads((args.output_dir/f'{name}-rng.json').read_text()) == dict(index=mem.read16(0x4fc80+0xec06),words=[mem.read16(0x4fc80+0xea12+i*2) for i in range(250)]), (name,'RNG mismatch')
    assert {key:actual[key] for key in expected} == expected, (name, actual, expected)
    run('python3','disasm/compare_screenshots.py',str(native)+'.png',port,args.output_dir/f'{name}-diff.png')
    print(f"{state['width']}x{state['height']} {name}: RGB, committed settings and full R250 state match.", flush=True)
