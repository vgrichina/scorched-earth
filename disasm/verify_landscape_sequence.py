#!/usr/bin/env python3
"""Run the complete EXE landscape routine with one continuous RNG stream.

No reseeding between ground/wall/wind/sky/walk, and no imported pixels/heights.
Scanned files are optional; spoiler initialization is disabled. It does not
cover shops or the rest of the game lifecycle. --players additionally runs
the actual round setup through player ordering, placement and tank sprites.
--full-frame also runs HUD layout/drawing and border drawing, comparing all
360x480 RGB pixels with zero tolerance. Only input names come from the
checkpoint; generated terrain, player state and palette are never injected.
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
from compare_pipeline import extract_display_pixels, write_emu_png

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--wind',type=int,default=0)
parser.add_argument('--mountains',action='store_true')
parser.add_argument('--mtn-percent',type=float,default=100)
parser.add_argument('--rounds',type=int,default=1)
parser.add_argument('--case',type=int,choices=range(4))
parser.add_argument('--seed',type=int)
parser.add_argument('--sky',type=int,choices=range(8),help='Override sky in selected cases')
parser.add_argument('--wall',type=int,choices=range(8),help='Override wall in selected cases')
parser.add_argument('--output-dir',type=Path,help='Save PNG pairs, including diagnostic images on pixel mismatch')
parser.add_argument('--players',action='store_true',help='Compare two-player round setup and sprites as well')
parser.add_argument('--tank-types',type=int,nargs=2,choices=range(7),default=[3,3],help='Tank shapes for the two players')
parser.add_argument('--full-frame',action='store_true',help='Include HUD and border; implies --players')
args=parser.parse_args()
if args.full_frame: args.players=True
root=Path(__file__).resolve().parent.parent
for case,(seed,sky,wall) in enumerate(((0,1,0),(1,3,1),(42,7,6),(65535,5,7))):
    if args.case is not None and case != args.case: continue
    if args.seed is not None: seed=args.seed
    if args.sky is not None: sky=args.sky
    if args.wall is not None: wall=args.wall
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    assert ports.get_resolution()==(360,480), 'This verifier requires a 360x480 checkpoint'
    ds=0x4FC80
    cpu.segs[:]=[0,0,cpu.segs[2],0x4FC8]
    stack=(cpu.segs[2]<<4)+0x2400
    for off,value in ((0x519A,65535),(0x624C,0),(0x624E,7),(0x623C,0),
                      (0x621A,0),(0x50FA,0),(0x5150,0),(0x5156,wall),(0x515C,args.wind),
                      (0x5110,sky),(0xE1EA,int(args.mountains)),(0xD4C6,65535)):
        mem.write16(ds+off,value)
    if args.players:
        assert mem.read16(ds+0x50D4)==2, 'Use a two-player checkpoint'
        mem.write16(ds+0x519C,0)
        mem.write16(ds+0x51A4,65535)
        for i,kind in enumerate(args.tank_types):
            tank=ds+0xD568+i*0xCA
            mem.write16(tank,kind)
            # Player-setup input geometry comes from the original type table.
            for off in range(0,10,2):
                mem.write16(tank+2+off,mem.read16(ds+0x6734+kind*18+off))
    names=[]
    for i in range(2):
        base=ds+0xD568+i*0xCA
        pointer=mem.read16(base+0xB6)+(mem.read16(base+0xB8)<<4)
        names.append(bytes(mem.data[pointer:pointer+20]).split(b'\0')[0].decode('ascii'))
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
        "import {drawWindIndicator,drawHud,drawPlayfieldBorder} from './web/js/hud.js';import {gameTick,STATE} from './web/js/game.js';"
        "import {createPlayers,players,drawAllTanks,getTankAim,getTankBarrel} from './web/js/tank.js';"
        "import {getEffectiveWallType} from './web/js/physics.js';"
        "import {seedRandom,getRandomState} from './web/js/utils.js';"
        "import {palette6,resolvedSkyType} from './web/js/palette.js';"
        "import * as t from './web/js/terrain.js';import {pixels} from './web/js/framebuffer.js';"
        "import fs from 'node:fs';"
        "const [seed,sky,wall,wind,mountains,percent,rounds,withPlayers,fullFrame]=process.argv.slice(1,10).map(Number);const [names,types]=JSON.parse(process.argv[10]);Object.assign(config,{skyType:sky,wallType:wall,wind,mtnPercent:percent,playOrder:0,numPlayers:2});"
        "if(mountains){globalThis.fetch=async path=>({ok:fs.existsSync(path),arrayBuffer:async()=>fs.readFileSync(path)});await t.loadMTNFiles();}"
        "t.reinitTerrainBuffers();if(withPlayers){createPlayers(2);players.forEach((p,i)=>Object.assign(p,{name:names[i],tankType:types[i]}));game.round=1;game.initialShop=true;}seedRandom(seed);const results=[];for(let round=0;round<rounds;round++){"
        "if(withPlayers){game.state=STATE.ROUND_SETUP;gameTick();}else{prepareRoundBackground();t.generateTerrain();}"
        "t.drawSky();t.drawTerrain();drawWindIndicator(game.wind);if(withPlayers)drawAllTanks();"
        "if(fullFrame){drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});}"
        "const p=pixels.map(c=>c>=80&&c<110?c+40:c===120?80:c===127?87:c>=128&&c<=143?c-40:c);"
        "results.push({wind:game.wind,sky:resolvedSkyType,wall:getEffectiveWallType(),rng:getRandomState(),"
        "players:players.map(p=>({tankType:p.tankType,x:p.x,y:p.y,power:p.power,...getTankAim(p),endX:getTankBarrel(p).endX,endY:getTankBarrel(p).endY})),"
        "order:game.turnOrder,pixels:Buffer.from(p).toString('base64'),palette:[...palette6]});}console.log(JSON.stringify(results));",
        str(seed),str(sky),str(wall),str(args.wind),str(int(args.mountains)),str(args.mtn_percent),str(args.rounds),str(int(args.players)),str(int(args.full_frame)),json.dumps([names,args.tank_types])],cwd=root,text=True))
    call(0x32994,0x2C89,[seed])
    for round,actual in enumerate(actual_rounds):
        call(0x2927E,0x22CA)
        if args.players:
            call(0x2AE53,0x2431)
            slots=[(mem.read16(ds+0xE4F6+i*4)-0xD568)//0xCA for i in range(2)]
            start=mem.read16(ds+0xE4F4)
            assert actual['order']==slots[start:]+slots[:start], (seed,round,'order',actual['order'],slots,start)
            for i,player in enumerate(actual['players']):
                base=ds+0xD568+i*0xCA
                expected_player={key:mem.read16(base+off) for key,off in
                                 (('tankType',0),('x',14),('y',16),('power',0x9E),('angle',0x92),('direction',0x94),('endX',18),('endY',20))}
                if expected_player['direction']>=32768: expected_player['direction']-=65536
                assert player==expected_player,(seed,round,i,player,expected_player)
            if args.full_frame:
                # The play loop enables incremental HUD widgets at 0x2AB88.
                mem.write16(ds+0x50D6,1)
                call(0x290A8,0x22CA)
                call(0x2FEBE,0x2945)
                call(0x301B2,0x2945,[0xD568+slots[start]*0xCA,0x4FC8])
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
        left,top,right,bottom=(0,0,360,480) if args.full_frame else (3,38,357,477)
        for y in range(top,bottom):
            for x in range(left,right):
                i=y*360+x
                if not args.full_frame and expected[i]!=pixels[i]:differences.append((x,y,expected[i],pixels[i]))
                index=pixels[i]
                port_index=index-40 if 120<=index<150 else 120 if index==80 else index+40 if 87<=index<=103 else index
                if actual['palette'][port_index*3:port_index*3+3]!=list(ports.palette[expected[i]]):
                    differences.append((x,y,'RGB',index,expected[i],actual['palette'][port_index*3:port_index*3+3],list(ports.palette[expected[i]])))
        if args.output_dir:
            args.output_dir.mkdir(parents=True,exist_ok=True)
            actual_palette=[actual['palette'][i:i+3] for i in range(0,768,3)]
            mapped_palette=[actual_palette[i-40 if 120<=i<150 else 120 if i==80 else i+40 if 87<=i<=103 else i] for i in range(256)]
            for name,source,palette in (('emulator',expected,ports.palette),('web',pixels,mapped_palette)):
                crop=bytes(source[y*360+x] for y in range(top,bottom) for x in range(left,right))
                write_emu_png(dict(width=right-left,height=bottom-top,pixels=crop,palette=palette),
                              args.output_dir/f'seed-{seed}-sky-{sky}-round-{round+1}-{name}.png')
        assert not differences,(seed,len(differences),differences[:10])
        scope='full frame' if args.full_frame else 'landscape + player setup' if args.players else 'landscape'
        print(f'Round {round+1}, seed {seed}, sky {sky}->{resolved}, wall {wall}, max wind {args.wind}, generator {selected}, tank types {args.tank_types}: complete {scope} pixels, RGB, state and RNG match EXE.',flush=True)
