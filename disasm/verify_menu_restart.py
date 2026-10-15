#!/usr/bin/env python3
"""Run native New Game acceptance through the real caller back into main_menu.

Uses reconstructed menu fixtures, not boot. Repairs their synthetic return
address and supplies the caller's local frame. Seeds R250 at confirmation;
the restarted palette/terrain must be generated independently by the port.
"""
import argparse
import json
import subprocess
from pathlib import Path
from compare_pipeline import Memory, CPU, PortIO, InterruptHandler, load_state, extract_state, write_state_json
from emu.execute import run_fast
from emu.state import save_state

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint', help='Input-ready main menu from capture_menu.py')
parser.add_argument('--output-dir',type=Path,default=Path('/tmp/scorched-restart'))
parser.add_argument('--seeds',type=int,nargs='+',default=[0,1,42,65535])
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
args.output_dir.mkdir(parents=True,exist_ok=True)
def run(*cmd):
    result=subprocess.run(list(map(str,cmd)),cwd=root,text=True,capture_output=True)
    if result.returncode:
        print(result.stdout,result.stderr)
        result.check_returncode()
base=args.output_dir/'economics'
run('python3','disasm/emu_dialog_key.py',args.checkpoint,base,'--key','0x12:101','--stop-at','0x460c3')
system=args.output_dir/'system';confirm=args.output_dir/'confirm'
run('python3','disasm/capture_shop_click.py',str(base)+'.state',system,0,0,'--key',0x1f,'--ascii',115,'--modifiers',8)
run('python3','disasm/capture_shop_click.py',str(system)+'.state',confirm,0,0,'--key',0x31,'--ascii',110)
fixture=args.output_dir/'base.json'
write_state_json(extract_state(str(base)+'.state'),fixture)
payload=json.loads(fixture.read_text())
payload.update(activeSubmenu='economics',terrainHeights=extract_state(args.checkpoint)['terrainHeights'])
for seed in args.seeds:
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(str(confirm)+'.state',cpu,mem,ports,handler)
    ds=0x4fc80
    payload.update(explosionTextureRadius=mem.read16(ds+0x51a6),interest=mem.read_float64(ds+0x5190)*100,startCash=mem.read32(ds+0x516a),
                   computersBuy=mem.read16(ds+0x515e),freeMarket=mem.read16(ds+0x514a),
                   scoringMode=mem.read16(ds+0x5148),soundEnabled=mem.read16(ds+0xef46),
                   flySoundEnabled=mem.read16(ds+0x5146),configDirty=bool(mem.read16(ds+0x6314)))
    fixture.write_text(json.dumps(payload))
    assert mem.read16(0x618a0)==0x110 and mem.read16(0x618a2)==0x60,'Not a capture_menu fixture'
    mem.write16(0x618a0,0x445);mem.write16(0x618a2,0x2431);mem.write16(0x6189e,0x2500)
    rng=CPU();rng.segs[:]=[0,0x2c89,0x8000,0x4fc8]
    rng.ip=0x32994-0x6100-0x2c890;rng.regs[4]=0x2400
    for i,v in enumerate((0x110,0x60,seed)):mem.write16(0x82400+i*2,v)
    seed_handler=InterruptHandler(mem,rng,str(root/'earth'),ports)
    assert run_fast(rng,mem,ports,seed_handler,100000,bp_set={0x710})[0]=='breakpoint'
    reason,steps=run_fast(cpu,mem,ports,handler,20000000,bp_set={0x3d140-0x6100},scheduled_keys={10:(0x15,121),2000:(0x95,0)})
    assert reason=='breakpoint',(reason,steps)
    assert mem.read16(ds+0x50f6)==0,'Caller did not clear restart flag'
    save_state(str(args.output_dir/f'seed-{seed}-entry.state'),cpu,mem,ports,handler)
    print(f'Seed {seed}: native caller reached main_menu; R250 index {mem.read16(ds+0xec06)}.',flush=True)
    reason,steps=run_fast(cpu,mem,ports,handler,100000000,bp_set={0x460c3-0x6100})
    assert reason=='breakpoint',(reason,steps)
    prefix=args.output_dir/f'seed-{seed}'
    save_state(str(prefix)+'.state',cpu,mem,ports,handler)
    mem.dump_screen_png(str(prefix)+'-native.png',ports)
    run('node','disasm/web_screenshot.mjs','menu',str(prefix)+'-port.png','--from-state',fixture,
        '--input-seed',seed,'--menu-key','Alt+KeyS','--menu-key','KeyN','--menu-key','KeyY',
        '--rng-output',str(prefix)+'-rng.json')
    expected=dict(index=mem.read16(ds+0xec06),words=[mem.read16(ds+0xea12+i*2) for i in range(250)])
    assert json.loads(Path(str(prefix)+'-rng.json').read_text())==expected,(seed,'RNG mismatch')
    run('python3','disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png')
    print(f'Seed {seed}: native restart, full RGB and full R250 state match.',flush=True)
