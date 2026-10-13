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
parser.add_argument('--projectile-head',type=int,nargs=2,metavar=('X','Y'),help='Draw a launch-colored head at fixed input coordinates (not a flight simulation)')
parser.add_argument('--bomb-icon',type=int,choices=range(3),default=1)
parser.add_argument('--erase-head',action='store_true',help='Erase the head through the native callback before comparing')
parser.add_argument('--restore-sky-grid',action='store_true',help='Compare native setTerrainPixel against cached sky on a 7-pixel grid')
parser.add_argument('--flight-steps',type=int,default=0,help='Compose launch, free-flight and drawing for up to 30 steps; no native collisions')
parser.add_argument('--flight-collisions',action='store_true',help='Execute native collision traversal and wall response during flight; impacts fail the fixture')
parser.add_argument('--explosion',type=int,nargs=3,metavar=('X','Y','RADIUS'),help='Compare ordinary blast growth/cycling/restoration before damage')
parser.add_argument('--trace',action='store_true',help='Enable trace color for composed flight')
args=parser.parse_args()
if args.explosion and (not args.full_frame or args.projectile_head or args.restore_sky_grid or args.explosion[2]<=0): parser.error('--explosion requires --full-frame, positive radius, and no head/sky-grid')
if args.flight_collisions and not args.flight_steps: parser.error('--flight-collisions requires --flight-steps')
if not 0<=args.flight_steps<=30: parser.error('--flight-steps must be 0..30')
if args.flight_steps and (not args.projectile_head or not args.full_frame or args.erase_head or args.restore_sky_grid): parser.error('--flight-steps requires --full-frame and --projectile-head, without erasure/grid')
if args.erase_head and not args.projectile_head: parser.error('--erase-head requires --projectile-head')
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
        "import {getEffectiveWallType,launchProjectile,clearProjectiles,projectiles,stepSingleProjectile} from './web/js/physics.js';import {projectileDrawing,drawProjectileHead,drawProjectileTrackingMarks} from './web/js/projectile-render.js';"
        "import {seedRandom,getRandomState} from './web/js/utils.js';"
        "import {palette6,resolvedSkyType} from './web/js/palette.js';"
        "import * as t from './web/js/terrain.js';import {pixels,setPixel,getPixel,getBackgroundColor} from './web/js/framebuffer.js';"
        "import {startExplosion,stepExplosion,isExplosionActive} from './web/js/explosions.js';"
        "import fs from 'node:fs';"
        "const [seed,sky,wall,wind,mountains,percent,rounds,withPlayers,fullFrame]=process.argv.slice(1,10).map(Number);const [names,types,head,icon,erase,restoreGrid,flightSteps,trace,explosion]=JSON.parse(process.argv[10]);Object.assign(config,{skyType:sky,wallType:wall,wind,mtnPercent:percent,playOrder:0,numPlayers:2,tracePaths:Number(trace),gravity:0.2,viscosity:0});"
        "if(mountains){globalThis.fetch=async path=>({ok:fs.existsSync(path),arrayBuffer:async()=>fs.readFileSync(path)});await t.loadMTNFiles();}"
        "t.reinitTerrainBuffers();if(withPlayers){createPlayers(2);players.forEach((p,i)=>Object.assign(p,{name:names[i],tankType:types[i]}));game.round=1;game.initialShop=true;}seedRandom(seed);const results=[];for(let round=0;round<rounds;round++){"
        "if(withPlayers){game.state=STATE.ROUND_SETUP;gameTick();}else{prepareRoundBackground();t.generateTerrain();}"
        "t.drawSky();t.drawTerrain();drawWindIndicator(game.wind);if(withPlayers)drawAllTanks();"
        "if(fullFrame){drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});}"
        "const frames=[],motion=[],explosionPalettes=[];const encode=()=>Buffer.from(pixels.map(c=>c>=80&&c<110?c+40:c===120?80:c===127?87:c>=128&&c<=143?c-40:c)).toString('base64');"
        "if(head){clearProjectiles();launchProjectile(head[0],head[1],45,200,2,0);drawProjectileTrackingMarks(head[0],head[1],icon);if(erase){config.bombIcon=icon;projectileDrawing.advance(projectiles[0]);projectileDrawing.draw();projectileDrawing.finish(projectiles[0]);projectileDrawing.draw();}else if(!flightSteps)drawProjectileHead(head[0],head[1],icon);}"
        "if(flightSteps){config.bombIcon=icon;const shot=projectiles[0];for(let i=0;i<flightSteps;i++){"
        "t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);"
        "const status=stepSingleProjectile(shot,getPixel,game.wind);if(status!=='flying')throw new Error('fixture hit '+status);"
        "projectileDrawing.advance(shot);projectileDrawing.draw();drawProjectileTrackingMarks(shot.x,shot.y,icon);"
        "frames.push(encode());motion.push([shot.vx,shot.vy,shot.x,shot.y]);}}"
        "if(explosion){startExplosion(...explosion,0);while(isExplosionActive()){"
        "t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);"
        "stepExplosion();frames.push(encode());explosionPalettes.push([...palette6]);}}"
        "if(restoreGrid)for(let y=38;y<=476;y+=7)for(let x=3;x<=356;x+=7)setPixel(x,y,getBackgroundColor(y,x));"
        "const p=pixels.map(c=>c>=80&&c<110?c+40:c===120?80:c===127?87:c>=128&&c<=143?c-40:c);"
        "results.push({frames,motion,explosionPalettes,wind:game.wind,sky:resolvedSkyType,wall:getEffectiveWallType(),rng:getRandomState(),"
        "players:players.map(p=>({tankType:p.tankType,x:p.x,y:p.y,power:p.power,...getTankAim(p),endX:getTankBarrel(p).endX,endY:getTankBarrel(p).endY})),"
        "order:game.turnOrder,pixels:Buffer.from(p).toString('base64'),palette:[...palette6]});}console.log(JSON.stringify(results));",
        str(seed),str(sky),str(wall),str(args.wind),str(int(args.mountains)),str(args.mtn_percent),str(args.rounds),str(int(args.players)),str(int(args.full_frame)),json.dumps([names,args.tank_types,args.projectile_head,args.bomb_icon,args.erase_head,args.restore_sky_grid,args.flight_steps,args.trace,args.explosion])],cwd=root,text=True))
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
        if args.projectile_head:
            # Execute the actual launch palette block, including VGA upload.
            cpu.segs[1]=0x1ADA;cpu.ip=0x21296-0x6100-0x1ADA0;cpu.regs[4]=0x2400
            reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x212A7-0x6100})
            assert reason=='breakpoint'
            # Fixture has no previous head; retain real VGA read/write callbacks.
            for off,value in ((0xE4DA,0),(0xCEB8,0),(0xCEBA,0x9000),
                              (0xE34A,0),(0xE412,0),(0x514E,int(args.bomb_icon==2)),
                              (0x1C8A,0x1B74 if args.bomb_icon==1 else 0x1A3B),(0x1C8C,0x1ADA)):
                mem.write16(ds+off,value)
            mem.write16(0x90048,0)
            mem.write16(ds+0xE4EC,110 if args.trace else 120)
            if not args.flight_steps: call(0x22DFA,0x1ADA,args.projectile_head)
            if args.flight_steps:
                def block(start, stop):
                    cpu.segs[1]=0x1ADA;cpu.ip=start-0x6100-0x1ADA0
                    cpu.regs[5]=0x2400;cpu.regs[4]=0x23E6 if start<0x21400 else 0x23E0;cpu.regs[6]=0
                    reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={stop-0x6100})
                    assert reason=='breakpoint'
                mem.write16(stack+10,200);mem.write16(stack+12,45)
                block(0x211A3,0x211B8);block(0x212BF,0x21325)
                signed=lambda v:v if v<32768 else v-65536
                vx=signed(mem.read16(stack-14));vy=signed(mem.read16(stack-16))
                for off,value in ((4,vx),(12,vy),(20,args.projectile_head[0]),(28,args.projectile_head[1])):
                    struct.pack_into('<d',mem.data,0x90000+off,value)
                mem.write16(0x9004A,0);mem.write16(ds+0x5146,0)
                wind=signed(mem.read16(ds+0x515A))
                for off,value in ((0xCEAC,.02),(0xCE9C,10),(0xCEA4,wind/40),(0x5178,1)):
                    struct.pack_into('<d',mem.data,ds+off,value)
                if args.flight_collisions:
                    for off,value in ((0xE1E4,0),(0xE1E6,0),(0xE1E8,0),(0x1C7A,0),(0x513A,0)):
                        mem.write16(ds+off,value)
                    mem.write16(0x9004A,65535);mem.write16(0x90030,0)
                    struct.pack_into('<d',mem.data,0x90032,.8)
                    call(0x20ECD,0x1ADA)
                for step in range(args.flight_steps):
                    if args.flight_collisions:
                        for off,pof in ((0,20),(2,28)):
                            mem.write16(0x90000+off,int(mem.read_float64(0x90000+pof))&65535)
                        for off in (0x1C7E,0xCE98,0xCE9A):mem.write16(ds+off,0)
                        cpu.segs[1]=0x1ADA;cpu.ip=0x21AA2-0x6100-0x1ADA0
                        cpu.regs[5]=0x2400;cpu.regs[4]=0x23E0;cpu.regs[6]=0
                        for _ in range(100):
                            reason,count=run_fast(cpu,mem,ports,handler,1000000,
                                bp_set={0x22064-0x6100,0x230C8-0x6100,0x4C117-0x6100})
                            assert reason=='breakpoint',(step,reason,count)
                            address=cpu.segs[1]*16+cpu.ip
                            assert address!=0x230C8-0x6100,('native fixture impact',step)
                            if address==0x22064-0x6100:break
                            # Skip sound dispatch only; all pixel reads/writes and heads run.
                            sp=(cpu.segs[2]<<4)+cpu.regs[4]
                            cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
                        else:raise AssertionError('flight block did not finish')
                    else:block(0x21AA2,0x21D09)
                    motion=[mem.read_float64(0x90000+off) for off in (4,12,20,28)]
                    assert motion==actual['motion'][step],(step,motion,actual['motion'][step])
                    if not args.flight_collisions: call(0x22DFA,0x1ADA,[int(motion[2])&65535,int(motion[3])&65535])
                    native_frame=extract_display_pixels(mem,ports)
                    port_frame=base64.b64decode(actual['frames'][step])
                    for index,(native_color,port_color) in enumerate(zip(native_frame,port_frame)):
                        pi=port_color-40 if 120<=port_color<150 else 120 if port_color==80 else port_color+40 if 87<=port_color<=103 else port_color
                        assert actual['palette'][pi*3:pi*3+3]==list(ports.palette[native_color]),(seed,step,index%360,index//360,native_color,port_color)

            if args.erase_head:
                call(0x22A14 if args.bomb_icon==1 else 0x228DB,0x1ADA,[*args.projectile_head,1])
        if args.explosion:
            # Ordinary path only: stop before terrain settling, damage and debris.
            for off,value in ((0xEF46,0),(0x5104,0),(0x5106,0)):
                mem.write16(ds+off,value)
            cpu.segs[1]=0x3DAE;cpu.ip=0x43D3A-0x6100-0x3DAE0;cpu.regs[4]=0x2400
            for j,value in enumerate([0x110,0x60,*args.explosion,0]):mem.write16(stack+j*2,value&65535)
            stage=0
            capture_points={0x43DDD:12,0x43E2E:4,0x43E71:4,0x43E9F:0}
            for _ in range(1000):
                reason,count=run_fast(cpu,mem,ports,handler,10000000,
                    bp_set={*(p-0x6100 for p in capture_points),0x104F6-0x6100,0x28A80-0x6100})
                assert reason=='breakpoint',('explosion',stage,reason,count)
                offset=cpu.segs[1]*16+cpu.ip+0x6100
                if offset in capture_points:
                    native_frame=extract_display_pixels(mem,ports)
                    port_frame=base64.b64decode(actual['frames'][stage])
                    palette=actual['explosionPalettes'][stage]
                    mapped=[palette[(i-40 if 120<=i<150 else 120 if i==80 else i+40 if 87<=i<=103 else i)*3:][:3] for i in range(256)]
                    differences=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native_frame,port_frame)) if list(ports.palette[n])!=mapped[p]]
                    if args.output_dir:
                        args.output_dir.mkdir(parents=True,exist_ok=True)
                        for name,frame,pal in (('emulator',native_frame,ports.palette),('web',port_frame,mapped)):
                            write_emu_png(dict(width=360,height=480,pixels=frame,palette=pal),args.output_dir/f'explosion-{stage:03d}-{name}.png')
                    assert not differences,('explosion',stage,len(differences),differences[:10])
                    stage+=1
                    if offset==0x43E9F:break
                    cpu.regs[4]+=capture_points[offset];cpu.ip+=3
                else:
                    # Delays/input service only; native drawing/palette callbacks run.
                    sp=(cpu.segs[2]<<4)+cpu.regs[4]
                    cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
            else:raise AssertionError('explosion did not finish')
            assert stage==len(actual['frames']),(stage,len(actual['frames']))
            print(f'{stage} complete explosion RGB frames match through restoration (before damage/debris).',flush=True)
        if args.restore_sky_grid:
            for y in range(38,477,7):
                for x in range(3,357,7):
                    call(0x3AB39,0x3352,[x,y])
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
        print(f'Round {round+1}, seed {seed}, sky {sky}->{resolved}, wall {wall}, max wind {args.wind}, generator {selected}, tank types {args.tank_types}, head {args.projectile_head}, icon {args.bomb_icon}, erased {args.erase_head}, sky grid {args.restore_sky_grid}, flight steps {args.flight_steps}, native collisions {args.flight_collisions}, explosion {args.explosion}, trace {args.trace}: complete {scope} pixels, RGB, state and RNG match EXE.',flush=True)
