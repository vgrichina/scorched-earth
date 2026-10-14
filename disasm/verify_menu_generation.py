#!/usr/bin/env python3
"""Compare full menu frames with independently seeded procedural terrain.

Input: capture_menu.py --stop-at-walk checkpoint, or --stop-before-palette
with --independent-palette. The latter generates colors as well as terrain.
No terrain heights, terrain pixels or RNG tables are injected into the port.
This checks the procedural preview, not scanned mountains or boot-time RNG.
"""
import argparse
import json
from pathlib import Path
import subprocess
from compare_pipeline import Memory, CPU, PortIO, InterruptHandler, load_state, extract_state, write_state_json, write_emu_png
from emu.execute import run_fast
from emu.state import save_state

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--independent-palette', action='store_true', help='Use a --stop-before-palette capture and generate both colors and terrain')
parser.add_argument('--output-dir', type=Path, default=Path('/tmp/scorched-menu-generation'))
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
args.output_dir.mkdir(parents=True, exist_ok=True)
for seed in (0, 1, 42, 65535):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root/'earth'), ports)
    load_state(args.checkpoint, cpu, mem, ports, handler)
    entry = 0x3d5fd if args.independent_palette else 0x29808
    assert cpu.segs[1]*16+cpu.ip == entry-0x6100, 'Unexpected menu checkpoint entry'
    if not args.independent_palette:
        assert mem.read16(0x4fc80+0x6310) == 1, 'Expected menu preview, not gameplay'
    # Seed native R250 on a separate stack, preserving the menu CPU and stack.
    rng = CPU()
    rng.segs[:] = [0, 0x2c89, 0x8000, 0x4fc8]
    rng.ip = 0x32994-0x6100-0x2c890
    rng.regs[4] = 0x2400
    for i,value in enumerate((0x110,0x60,seed)):
        mem.write16(0x82400+i*2,value)
    seed_handler = InterruptHandler(mem,rng,str(root/'earth'),ports)
    assert run_fast(rng,mem,ports,seed_handler,100000,bp_set={0x710})[0] == 'breakpoint'
    stop = 0x460c3-0x6100
    reason,steps = run_fast(cpu,mem,ports,handler,100000000,bp_set={0x710,stop})
    assert reason == 'breakpoint' and cpu.segs[1]*16+cpu.ip == stop, (reason,steps)
    prefix = args.output_dir/f'seed-{seed}'
    save_state(str(prefix)+'.state',cpu,mem,ports,handler)
    state = extract_state(str(prefix)+'.state')
    write_emu_png(state,str(prefix)+'-native.png')
    write_state_json(state,str(prefix)+'.json')
    payload = json.loads(Path(str(prefix)+'.json').read_text())
    del payload['terrainHeights']
    if args.independent_palette:
        del payload['palette']
        payload['menuPreviewSeed'] = seed
    else:
        payload['menuTerrainSeed'] = seed
    Path(str(prefix)+'.json').write_text(json.dumps(payload))
    subprocess.run(['node','disasm/web_screenshot.mjs','menu',str(prefix)+'-port.png','--from-state',str(prefix)+'.json','--rng-output',str(prefix)+'-rng.json'],cwd=root,check=True)
    expected_rng = dict(index=mem.read16(0x4fc80+0xec06),words=[mem.read16(0x4fc80+0xea12+i*2) for i in range(250)])
    assert json.loads(Path(str(prefix)+'-rng.json').read_text()) == expected_rng, (seed,'RNG state differs')
    subprocess.run(['python3','disasm/compare_screenshots.py',str(prefix)+'-native.png',str(prefix)+'-port.png',str(prefix)+'-diff.png'],cwd=root,check=True)
    print(f'Seed {seed}: independently generated menu {"palette and terrain" if args.independent_palette else "terrain"} matches full native frame and RNG state.',flush=True)
