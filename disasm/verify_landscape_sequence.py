#!/usr/bin/env python3
"""Run the complete EXE landscape routine with one continuous RNG stream.

No reseeding between ground/wall/wind/sky/walk, and no imported pixels/heights.
Scanned files are optional; spoiler initialization is disabled. It does not
cover shops, turn ordering, tank sprites, or the rest of the game lifecycle.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import struct
from emu.cpu import CPU
from emu.memory import Memory
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state
from emu.execute import run_fast
from compare_pipeline import extract_display_pixels

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--wind',type=int,default=0)
parser.add_argument('--mountains',action='store_true')
parser.add_argument('--mtn-percent',type=float,default=100)
parser.add_argument('--rounds',type=int,default=1)
parser.add_argument('--case',type=int,choices=range(4))
parser.add_argument('--seed',type=int)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
for case,(seed,sky,wall) in enumerate(((0,1,0),(1,3,1),(42,7,6),(65535,5,7))):
    if args.case is not None and case != args.case: continue
    if args.seed is not None: seed=args.seed
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    ds=0x4FC80
    cpu.segs[:]=[0,0,cpu.segs[2],0x4FC8]
    stack=(cpu.segs[2]<<4)+0x2400
    for off,value in ((0x519A,65535),(0x624C,0),(0x624E,7),(0x623C,0),
                      (0x621A,0),(0x50FA,0),(0x5150,0),(0x5156,wall),(0x515C,args.wind),
                      (0x5110,sky),(0xE1EA,int(args.mountains)),(0xD4C6,65535)):
        mem.write16(ds+off,value)
    if args.mountains:
        struct.pack_into('<d',mem.data,ds+0x5132,args.mtn_percent)
        mem.write16(ds+0x5F54,65535)
    def call(offset,segment,arguments=()):
        cpu.segs[1]=segment;cpu.ip=offset-0x6100-segment*16;cpu.regs[4]=0x2400
        for i,value in enumerate([0x110,0x60,*arguments]):mem.write16(stack+i*2,value)
        reason,count=run_fast(cpu,mem,ports,handler,30000000,bp_set={0x710})
        assert reason=='breakpoint',(hex(offset),reason,count)
    actual_rounds=json.loads(subprocess.check_output([
        'node','--input-type=module','-e',
        "import {config} from './web/js/config.js';import {prepareRoundBackground,game} from './web/js/game.js';"
        "import {drawWindIndicator} from './web/js/hud.js';"
        "import {getEffectiveWallType} from './web/js/physics.js';"
        "import {seedRandom,getRandomState} from './web/js/utils.js';"
        "import {palette6,resolvedSkyType} from './web/js/palette.js';"
        "import * as t from './web/js/terrain.js';import {pixels} from './web/js/framebuffer.js';"
        "import fs from 'node:fs';"
        "const [seed,sky,wall,wind,mountains,percent,rounds]=process.argv.slice(1).map(Number);Object.assign(config,{skyType:sky,wallType:wall,wind,mtnPercent:percent});"
        "if(mountains){globalThis.fetch=async path=>({ok:fs.existsSync(path),arrayBuffer:async()=>fs.readFileSync(path)});await t.loadMTNFiles();}"
        "t.reinitTerrainBuffers();seedRandom(seed);const results=[];for(let round=0;round<rounds;round++){prepareRoundBackground();t.generateTerrain();t.drawSky();t.drawTerrain();drawWindIndicator(game.wind);"
        "const p=pixels.map(c=>c>=80&&c<110?c+40:c===120?80:c===127?87:c>=128&&c<=143?c-40:c);"
        "results.push({wind:game.wind,sky:resolvedSkyType,wall:getEffectiveWallType(),rng:getRandomState(),"
        "pixels:Buffer.from(p).toString('base64'),palette:[...palette6]});}console.log(JSON.stringify(results));",
        str(seed),str(sky),str(wall),str(args.wind),str(int(args.mountains)),str(args.mtn_percent),str(args.rounds)],cwd=root,text=True))
    call(0x32994,0x2C89,[seed])
    for round,actual in enumerate(actual_rounds):
        call(0x2927E,0x22CA)
        selected = 'procedural'
        if mem.read16(ds+0xD4DC) == 0xD4CE:
            filename = mem.read16(ds+0xD4D8) + (mem.read16(ds+0xD4DA)<<4)
            selected = bytes(mem.data[filename:filename+32]).split(b'\0')[0].decode('ascii')
            assert selected.upper().endswith('.MTN') and (root/'earth'/selected).is_file(), selected
        wind=mem.read16(ds+0x515A)
        if wind>=32768:wind-=65536
        resolved=mem.read16(ds+0x5110)
        resolved_wall=mem.read16(ds+0x5154)
        assert (actual['wind'],actual['sky'],actual['wall']) == (wind,resolved,resolved_wall), (seed,round,'state')
        expected_rng = dict(index=mem.read16(ds+0xEC06), words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
        assert actual['rng'] == expected_rng, (seed,round,'RNG',actual['rng']['index'],expected_rng['index'])
        expected=extract_display_pixels(mem,ports);pixels=base64.b64decode(actual['pixels'])
        differences=[]
        for y in range(38,477):
            for x in range(3,357):
                i=y*360+x
                if expected[i]!=pixels[i]:differences.append((x,y,expected[i],pixels[i]))
                index=pixels[i]
                port_index=index-40 if 120<=index<150 else 120 if index==80 else index+40 if 87<=index<=103 else index
                assert actual['palette'][port_index*3:port_index*3+3]==list(ports.palette[index]),(seed,x,y,'RGB')
        assert not differences,(seed,len(differences),differences[:10])
        print(f'Round {round+1}, seed {seed}, sky {sky}->{resolved}, wall {wall}, max wind {args.wind}, generator {selected}: complete landscape pixels, RGB, state and RNG match EXE.',flush=True)
