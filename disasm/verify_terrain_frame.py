#!/usr/bin/env python3
"""Compare independently seeded terrain rendering with a pre-walk EXE checkpoint.

Capture it using emu_dialog_key.py --stop-at 0x29808 on the final shop's Done.
Tests the full LandGenerator wrapper with a selected sky, excluding HUD/border.
Cavern includes both floor and ceiling passes. RNG is reseeded before the first walk.
No terrain heights, pixels, palette or RNG table are injected into the port.
"""
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
parser.add_argument('--output-dir', type=Path, help='Save the verified playfield crops for visual review')
parser.add_argument('--sky', type=int, choices=(0, 1, 2, 3, 4, 5, 6), default=1)
parser.add_argument('--wrap', action='store_true', help='Check the sky bitmap with wrap-around walls')
parser.add_argument('--place-tanks', action='store_true', help='Also verify two tank positions and terrain footprint edits (no tank sprites)')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
for seed in (0, 1, 42, 65535):
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    handler = InterruptHandler(mem, cpu, str(root / 'earth'), ports)
    load_state(args.checkpoint, cpu, mem, ports, handler)
    assert (cpu.segs[1] << 4) + cpu.ip == 0x29808 - 0x6100, 'Expected kernel entry checkpoint'
    ds = cpu.segs[3] << 4
    sp = (cpu.segs[2] << 4) + cpu.regs[4]
    generator = mem.read16(sp + 4) + (mem.read16(sp + 6) << 4)
    left, bottom, right, top = [mem.read16(sp + i) for i in (8, 10, 12, 14)]
    width, height = ports.get_resolution()
    assert (left, bottom, right, top) == (3, height - 4, width - 4, 38)
    assert mem.read16(generator + 8) == 1, 'Only forward generation supported by this fixture'
    assert mem.read16(ds + 0x5110) == 1, 'Expected shaded sky'
    settings = dict(seed=seed, wallType=1 if args.wrap else 0, placeTanks=args.place_tanks, screenWidth=width, screenHeight=height, landType=2, skyType=args.sky,
                    land1=mem.read16(generator + 10), land2=mem.read16(generator + 12),
                    flattenPeaks=bool(mem.read16(generator + 14)))
    # Generate colors and terrain independently from the same two seeds.
    # The live kernel CPU is preserved while EXE helper routines run on a spare stack.
    rng_cpu = CPU()
    rng_cpu.segs[:] = [0, 0, 0x8000, cpu.segs[3]]
    mem.write16(ds + 0x519A, 0xFFFF)
    rng_handler = InterruptHandler(mem, rng_cpu, str(root / 'earth'), ports)

    def call(offset, segment, arguments=()):
        rng_cpu.segs[1] = segment
        rng_cpu.ip = offset - 0x6100 - (segment << 4)
        rng_cpu.regs[4] = 0x2400
        for i, value in enumerate([0x110, 0x60, *arguments]):
            mem.write16(0x82400 + 2 * i, value)
        reason, _ = run_fast(rng_cpu, mem, ports, rng_handler, 10000000, bp_set={0x710})
        assert reason == 'breakpoint', (hex(offset), reason)

    call(0x32994, 0x2C89, [seed])
    call(0x2923C, 0x22CA)  # Select the ground color using the EXE RNG/table.
    mem.write16(ds + 0x510E, int(args.wrap))
    mem.write16(ds + 0x5110, args.sky)
    mem.write16(ds + 0x623C, 0)
    mem.write16(ds + 0x624C, 0)
    mem.write16(ds + 0x624E, 0xFFFF)
    call(0x3971F, 0x3352)  # Build selected sky DAC entries and row table.
    ground = [mem.read16(ds + offset) for offset in (0xDD4C, 0xDD4E, 0xDD50)]
    if args.sky != 6:  # The wrapper leaves ground black for Black sky.
        call(0x4C0B5, 0x45FB, [80, *ground])
    call(0x32E1B, 0x2C89, [65535])
    expected_sky_next = rng_cpu.ax
    # The wrapper invokes sky setup again. Storm rebuilds its bitmap on every
    # call (Stars caches it), so reproduce the same palette-phase RNG position.
    call(0x32994, 0x2C89, [seed])
    call(0x2923C, 0x22CA)
    return_address = mem.read16(sp) + (mem.read16(sp + 2) << 4)
    # Kernel and wrapper accept the same six argument words. Start the wrapper
    # with constructor direction -1; it flips to +1 and dispatches one or two passes.
    mem.write16(generator + 8, 0xFFFF)
    mem.write16(generator + 2, 0)
    cpu.segs[1], cpu.ip = 0x22CA, 0x295DF - 0x6100 - 0x22CA0
    reason, _ = run_fast(cpu, mem, ports, handler, 10000000,
                         bp_set={0x29808 - 0x6100, return_address})
    assert reason == 'breakpoint' and (cpu.segs[1] << 4) + cpu.ip == 0x29808 - 0x6100
    call(0x32994, 0x2C89, [seed])  # Same walk seed; do not reseed the ceiling pass.
    reason, _ = run_fast(cpu, mem, ports, handler, 10000000, bp_set={return_address})
    assert reason == 'breakpoint', reason
    expected_positions = []
    if args.place_tanks:
        # Initial placement uses a single ground fill color (EXE constructor state).
        assert mem.read16(ds + 0xD4E4) == 1 and mem.read16(ds + 0xD4E6) == 80
        spacing = (width - 6) // 2
        for slot in range(2):
            x = 3 + spacing // 2 + slot * spacing
            mem.write16(0x90008, 4)  # Type 3 footprint half-width.
            mem.write16(0x9000E, x)
            call(0x2ACF7 if args.sky == 5 else 0x2AC02, 0x22CA, [0, 0x9000])
            expected_positions.append([x, mem.read16(0x90010)])
    call(0x32E1B, 0x2C89, [65535])
    expected_next = rng_cpu.ax
    expected = extract_display_pixels(mem, ports)
    rendered = json.loads(subprocess.check_output([
        'node', '--input-type=module', '-e',
        "import {config} from './web/js/config.js';"
        "import {seedRandom,random} from './web/js/utils.js';"
        "import {initPalette,palette6} from './web/js/palette.js';"
        "import {placeTanks,players} from './web/js/tank.js';"
        "import * as fb from './web/js/framebuffer.js';"
        "import * as terrain from './web/js/terrain.js';"
        "const c=JSON.parse(process.argv[1]);Object.assign(config,c);"
        "fb.reinitFramebuffer();terrain.reinitTerrainBuffers();"
        "seedRandom(c.seed);initPalette(c.landType,c.skyType);terrain.initSkyBackground();const skyNext=random(65535);"
        "seedRandom(c.seed);terrain.generateTerrain();if(c.placeTanks)placeTanks(2);terrain.drawSky();terrain.drawTerrain();"
        "const pixels=fb.pixels.map(p=>p>=80&&p<110?p+40:p===120?80:p);"
        "console.log(JSON.stringify({skyNext,pixels:Buffer.from(pixels).toString('base64'),palette:[...palette6],positions:players.map(p=>[p.x,p.y]),next:random(65535)}));", json.dumps(settings)
    ], cwd=root))
    assert rendered['skyNext'] == expected_sky_next, (seed, 'sky RNG consumption')
    assert rendered['positions'] == expected_positions
    assert rendered['next'] == expected_next, (seed, 'RNG consumption')
    actual = base64.b64decode(rendered['pixels'])
    differences = [(x, y, expected[y * width + x], actual[y * width + x])
                   for y in range(top, bottom + 1) for x in range(left, right + 1)
                   if expected[y * width + x] != actual[y * width + x]]
    assert not differences, (seed, len(differences), differences[:10])
    # Compare native 6-bit DAC RGB as well as indices; no injected colors.
    for y in range(top, bottom + 1):
        for x in range(left, right + 1):
            index = actual[y * width + x]
            port_index = index - 40 if 120 <= index < 150 else 120 if index == 80 else index
            rgb = rendered['palette'][port_index * 3:port_index * 3 + 3]
            assert rgb == list(ports.palette[index]), (seed, x, y, rgb, ports.palette[index])
    print(f'Sky {args.sky}, seed {seed}: {(right-left+1)*(bottom-top+1)} terrain/sky pixels and RGB colors match EXE exactly.', flush=True)

    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        crop = [y * width + x for y in range(top, bottom + 1) for x in range(left, right + 1)]
        emu_crop = bytes(expected[i] for i in crop)
        web_crop = bytes(actual[i] - 40 if 120 <= actual[i] < 150 else 120 if actual[i] == 80 else actual[i] for i in crop)
        web_palette = [rendered['palette'][i:i + 3] for i in range(0, 768, 3)]
        for label, pixels, palette in [('emu', emu_crop, ports.palette), ('web', web_crop, web_palette)]:
            write_emu_png(dict(width=right-left+1, height=bottom-top+1, pixels=pixels, palette=palette),
                          args.output_dir / f'sky-{args.sky}-seed-{seed}-{label}.png')
