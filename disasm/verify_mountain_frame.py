#!/usr/bin/env python3
"""Compare MTN columns rendered by the actual EXE with independent JS decoding."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
from compare_pipeline import extract_display_pixels, write_emu_png

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--file', default='ROCK001.MTN')
parser.add_argument('--mountain-dir', type=Path, help='Optional directory containing synthetic MTN fixtures')
parser.add_argument('--seed', type=int, default=42)
parser.add_argument('--sky', type=int, choices=(0,1,2,3,4,6), default=1)
parser.add_argument('--place-tanks', action='store_true')
parser.add_argument('--output-dir', type=Path)
parser.add_argument('--play-height', type=int, help='Shorter viewport within checkpoint mode, to exercise vertical cropping')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
mem, cpu, ports = Memory(), CPU(), PortIO()
ports.mem = mem
mountain_dir = args.mountain_dir or root / 'earth'
handler = InterruptHandler(mem, cpu, str(mountain_dir), ports)
load_state(args.checkpoint, cpu, mem, ports, handler)
ds = 0x4FC80
cpu.segs[:] = [0, 0, 0x8000, 0x4FC8]
mem.write16(ds + 0x519A, 65535)

def call(offset, segment, arguments=()):
    cpu.segs[1] = segment
    cpu.ip = offset - 0x6100 - segment * 16
    cpu.regs[4] = 0x2400
    for i, value in enumerate([0x110, 0x60, *arguments]):
        mem.write16(0x82400 + i * 2, value)
    reason, count = run_fast(cpu, mem, ports, handler, 30000000, bp_set={0x710})
    assert reason == 'breakpoint', (hex(offset), reason, count, hex(cpu.segs[1]*16+cpu.ip))

width, height = ports.get_resolution()
if args.play_height:
    assert 42 < args.play_height <= height
    height = args.play_height
    mem.write16(ds + 0xEF38, height - 4)
    mem.write16(ds + 0xEF3A, height - 1)
# Initialize the selected sky separately from the mountain RNG phase.
call(0x32994, 0x2C89, [args.seed])
mem.write16(ds + 0x5110, args.sky)
mem.write16(ds + 0x624C, 0)
mem.write16(ds + 0x50D8, 0)
mem.write16(ds + 0x623C, 0)
mem.write16(ds + 0x624E, 65535)
call(0x3971F, 0x3352)
name = args.file.encode() + b'\0'
mem.data[0x7000:0x7000 + len(name)] = name
mem.write16(ds + 0xD4D8, 0)
mem.write16(ds + 0xD4DA, 0x700)
call(0x32994, 0x2C89, [args.seed])
call(0x32E44, 0x2CD4, [0xD4CE, 0x4FC8, 3, height-4, width-4, 38])
positions = []
if args.place_tanks:
    for slot in range(2):
        x = 3 + ((width-6)//2)//2 + slot*((width-6)//2)
        mem.write16(0x90008, 4)
        mem.write16(0x9000E, x)
        call(0x2AC02, 0x22CA, [0, 0x9000])
        positions.append([x,mem.read16(0x90010)])
call(0x32E1B, 0x2C89, [65535])
next_rng = cpu.ax
expected = extract_display_pixels(mem, ports)
actual = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import fs from 'node:fs';import * as terrain from './web/js/terrain.js';"
    "import {config} from './web/js/config.js';import * as fb from './web/js/framebuffer.js';"
    "import {initPalette,palette6} from './web/js/palette.js';"
    "import {seedRandom,random} from './web/js/utils.js';"
    "import {placeTanks,players} from './web/js/tank.js';"
    "const [file,w,h,seed,sky,place,source]=process.argv.slice(1);"
    "globalThis.fetch=async path=>({ok:path==='earth/'+file,arrayBuffer:async()=>fs.readFileSync(source)});"
    "await terrain.loadMTNFiles();Object.assign(config,{screenWidth:Number(w),screenHeight:Number(h),skyType:Number(sky),mtnPercent:100});"
    "fb.reinitFramebuffer();terrain.reinitTerrainBuffers();initPalette(2,Number(sky));"
    "if(terrain.prepareTerrainGenerator()<0)throw Error('fixture did not load MTN');seedRandom(Number(seed));terrain.initSkyBackground();"
    "seedRandom(Number(seed));terrain.generateTerrain();if(place==='true')placeTanks(2);terrain.drawSky();terrain.drawTerrain();"
    "const pixels=fb.pixels.map(p=>p>=80&&p<110?p+40:p===120?80:p>=128&&p<=143?p-40:p);"
    "console.log(JSON.stringify({pixels:Buffer.from(pixels).toString('base64'),palette:[...palette6],positions:players.map(p=>[p.x,p.y]),next:random(65535)}));",
    args.file, str(width), str(height), str(args.seed), str(args.sky), str(args.place_tanks).lower(), str(mountain_dir / args.file)
], cwd=root, text=True))
pixels = base64.b64decode(actual['pixels'])
diff = []
for y in range(38, height-3):
    for x in range(3, width-3):
        index = pixels[y*width+x]
        if expected[y*width+x] != index:
            diff.append((x, y, expected[y*width+x], index))
assert not diff, (args.file, len(diff), diff[:15])
assert actual['positions'] == positions, (actual['positions'],positions)
assert actual['next'] == next_rng, (args.file, 'RNG', actual['next'], next_rng)
for y in range(38, height-3):
    for x in range(3, width-3):
        index = pixels[y*width+x]
        web_index = index-40 if 120 <= index < 150 else index+40 if 88 <= index <= 103 else 120 if index==80 else index
        assert actual['palette'][web_index*3:web_index*3+3] == list(ports.palette[index]), (x,y,index,'RGB',actual['palette'][web_index*3:web_index*3+3],list(ports.palette[index]))
if args.output_dir:
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, values in (('emulator', expected), ('web', pixels)):
        crop = bytes(values[y*width+x] for y in range(38,height-3) for x in range(3,width-3))
        write_emu_png(dict(width=width-6, height=height-41, pixels=crop, palette=ports.palette),
                      args.output_dir / f'{args.file}-seed-{args.seed}-sky-{args.sky}-{name}.png')
print(f'{args.file}, seed {args.seed}, sky {args.sky}, tanks {args.place_tanks}: every playfield index, RGB and next RNG match EXE.', flush=True)
