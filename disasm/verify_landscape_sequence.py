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
parser.add_argument('--change-wind',action='store_true',help='Enable native changing wind during round setup; requires --players or --full-frame')
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
parser.add_argument('--fall-shield',type=int,help='Shield (config 2) HP for the stacked-fall victim')
parser.add_argument('--stacked-fall',action='store_true',help='Place player 0 above player 1 for the falling-offsets fixture')
parser.add_argument('--falling-offsets',type=int,nargs=2,help='Lift both tanks by these pixels, then compare native falling frames')
parser.add_argument('--wind-overwrite',type=int,nargs=3,action='append',default=[],metavar=('X','Y','NATIVE_COLOR'),help='Write a retained pixel before next-player wind redraw')
parser.add_argument('--next-player',action='store_true',help='Compare wind redraw and next-player HUD directly after round setup')
parser.add_argument('--shot-next-player',action='store_true',help='Compare wind redraw and next-player HUD after surviving aftermath')
parser.add_argument('--shot-parachute',action='store_true',help='Give falling target one parachute for composed shot capture')
parser.add_argument('--shot-falling',action='store_true',help='Compare each moving falling-tank frame; requires --shot-aftermath')
parser.add_argument('--shot-aftermath',action='store_true',help='Also compare the completed native impact aftermath; requires --shot-impact')
parser.add_argument('--shot-impact',action='store_true',help='Continue real flight into ordinary impact and blast restoration; add --shot-aftermath for falling/settling')
parser.add_argument('--flight-collisions',action='store_true',help='Execute native collision traversal and wall response during flight; impacts fail the fixture')
parser.add_argument('--explosion',type=int,nargs=3,metavar=('X','Y','RADIUS'),help='Compare ordinary blast growth/cycling/restoration before damage')
parser.add_argument('--shields',type=int,nargs=2,choices=range(6),help='Compose settled shield drawing for both tanks after HUD setup')
parser.add_argument('--shield-hole',action='store_true',help='Erase the top shield pixel before the break fade fixture')
parser.add_argument('--shield-break',type=int,choices=range(1,6),help='Compare all 51 fade frames of player 1 shield destruction')
parser.add_argument('--shield-fade-hud',action='store_true',help='Show damaged tank HUD and compare 51 fade frames, stopping before erasure')
parser.add_argument('--shield-shot',action='store_true',help='Start flight at the top of player 1 Warp Shield')
parser.add_argument('--trace',action='store_true',help='Enable trace color for composed flight')
args=parser.parse_args()
if args.next_player:
    args.shot_next_player=True
    args.full_frame=True
if args.wind_overwrite and not args.shot_next_player:parser.error('--wind-overwrite requires --next-player or --shot-next-player')
if any(not (0<=x<360 and 0<=y<480 and 0<=c<=255) for x,y,c in args.wind_overwrite):parser.error('wind overwrite must be inside the 360x480 fixture with color 0..255')
if args.fall_shield is not None and not args.stacked_fall:parser.error('--fall-shield requires --stacked-fall')
if args.stacked_fall and not args.falling_offsets:parser.error('--stacked-fall requires --falling-offsets')
if args.falling_offsets:
    args.full_frame=True
    if any(v<0 or v>40 for v in args.falling_offsets):parser.error('falling offsets must be 0..40')
if args.shot_next_player and (((not args.next_player or args.shot_impact) and not args.shot_aftermath) or args.rounds!=1 or args.wall not in (None,0)):
    parser.error('next-player capture requires one round and ordinary walls; shots also require --shot-aftermath')
if args.shot_parachute and not args.shot_falling: parser.error('--shot-parachute requires --shot-falling')
if args.shot_falling and not args.shot_aftermath: parser.error('--shot-falling requires --shot-aftermath')
if args.shot_aftermath and not args.shot_impact: parser.error('--shot-aftermath requires --shot-impact')
if args.shot_impact:
    if args.shields or args.explosion or args.shield_shot or args.shield_break: parser.error('--shot-impact requires an ordinary unshielded shot')
    args.flight_collisions=True
if args.shield_fade_hud and not args.shield_break: parser.error('--shield-fade-hud requires --shield-break')
if args.shield_hole and not args.shield_break: parser.error('--shield-hole requires --shield-break')
if args.shield_break:
    if args.shield_shot or args.flight_steps or args.rounds!=1: parser.error('--shield-break requires a single round and no flight')
    args.shields=[0,args.shield_break]
if args.shield_shot:
    args.shields=[0,3];args.projectile_head=[0,0];args.flight_collisions=True
    if not args.flight_steps: parser.error('--shield-shot requires --flight-steps')
if args.shields and (not args.full_frame or (args.projectile_head and not args.shield_shot and not args.flight_collisions) or args.explosion or args.restore_sky_grid): parser.error('--shields requires --full-frame with collision-enabled flight and without explosion/sky-grid')
if args.explosion and (not args.full_frame or args.projectile_head or args.restore_sky_grid or args.explosion[2]<=0): parser.error('--explosion requires --full-frame, positive radius, and no head/sky-grid')
if args.flight_collisions and not args.flight_steps: parser.error('--flight-collisions requires --flight-steps')
if not 0<=args.flight_steps<=(500 if args.shot_impact else 30): parser.error('--flight-steps must be 0..30, or 0..500 with --shot-impact')
if args.flight_steps and (not args.projectile_head or not args.full_frame or args.erase_head or args.restore_sky_grid): parser.error('--flight-steps requires --full-frame and --projectile-head, without erasure/grid')
if args.erase_head and not args.projectile_head: parser.error('--erase-head requires --projectile-head')
if args.full_frame: args.players=True
if args.change_wind and not args.players: parser.error('--change-wind requires --players or --full-frame')
root=Path(__file__).resolve().parent.parent
for case,(seed,sky,wall) in enumerate(((0,1,0),(1,3,1),(42,7,6),(65535,5,7))):
    if args.case is not None and case != args.case: continue
    if args.seed is not None: seed=args.seed
    if args.sky is not None: sky=args.sky
    if args.wall is not None: wall=args.wall
    if args.shot_next_player and wall!=0:parser.error('--shot-next-player requires --wall 0 for this case')
    mem,cpu,ports=Memory(),CPU(),PortIO();ports.mem=mem
    handler=InterruptHandler(mem,cpu,str(root/'earth'),ports)
    load_state(args.checkpoint,cpu,mem,ports,handler)
    assert ports.get_resolution()==(360,480), 'This verifier requires a 360x480 checkpoint'
    ds=0x4FC80
    cpu.segs[:]=[0,0,cpu.segs[2],0x4FC8]
    stack=(cpu.segs[2]<<4)+0x2400
    for off,value in ((0x519A,65535),(0x624C,0),(0x624E,7),(0x623C,0),
                      (0x621A,0),(0x50FA,int(args.change_wind)),(0x5150,0),(0x5156,wall),(0x515C,args.wind),
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
        "import {config} from './web/js/config.js';import {prepareRoundBackground,game,processHit} from './web/js/game.js';"
        "import {drawWindIndicator,drawHud,drawPlayfieldBorder} from './web/js/hud.js';import {gameTick,STATE} from './web/js/game.js';"
        "import {createPlayers,players,drawAllTanks,getTankAim,getTankBarrel,checkTanksFalling,stepFallingTanks,isFallingSettling,fallingFlash} from './web/js/tank.js';"
        "import {getEffectiveWallType,launchProjectile,clearProjectiles,projectiles,stepSingleProjectile} from './web/js/physics.js';import {retainWorldPixel,projectileDrawing,drawProjectileHead,drawProjectileTrackingMarks} from './web/js/projectile-render.js';"
        "import {seedRandom,getRandomState} from './web/js/utils.js';"
        "import {palette6,resolvedSkyType} from './web/js/palette.js';"
        "import * as t from './web/js/terrain.js';import {pixels,setPixel,getPixel,getBackgroundColor} from './web/js/framebuffer.js';"
        "import {startExplosion,stepExplosion,isExplosionActive} from './web/js/explosions.js';"
        "import {drawShield,SHIELD_CONFIG,applyShieldDamage,drawShieldBreak,shieldBreak,eraseShieldContact} from './web/js/shields.js';"
        "import {refreshShieldFlight} from './web/js/shield-flight.js';"
        "import {WPN} from './web/js/weapons.js';"
        "import fs from 'node:fs';"
        "const [seed,sky,wall,wind,mountains,percent,rounds,withPlayers,fullFrame]=process.argv.slice(1,10).map(Number);const [names,types,head,icon,erase,restoreGrid,flightSteps,trace,explosion,shields,shieldShot,breakShield,shieldHole,fadeHud,shotImpact,shotAftermath,shotFalling,shotParachute,fallingOffsets,stackedFall,fallShield,shotNextPlayer,changeWind,windOverwrites]=JSON.parse(process.argv[10]);Object.assign(config,{skyType:sky,wallType:wall,wind,changeWind,mtnPercent:percent,playOrder:0,numPlayers:2,tracePaths:Number(trace),gravity:0.2,viscosity:0});"
        "if(shotImpact)config.tunneling=0;if(mountains){globalThis.fetch=async path=>({ok:fs.existsSync(path),arrayBuffer:async()=>fs.readFileSync(path)});await t.loadMTNFiles();}"
        "t.reinitTerrainBuffers();if(withPlayers){createPlayers(2);players.forEach((p,i)=>Object.assign(p,{name:names[i],tankType:types[i]}));game.round=1;game.initialShop=true;}seedRandom(seed);const results=[];for(let round=0;round<rounds;round++){"
        "if(withPlayers){game.state=STATE.ROUND_SETUP;gameTick();}else{prepareRoundBackground();t.generateTerrain();}"
        "t.drawSky();t.drawTerrain();drawWindIndicator(game.wind);if(withPlayers)drawAllTanks();"
        "if(fullFrame){drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});}"
        "if(shields)players.forEach((p,i)=>{p.activeShield=shields[i];p.shieldEnergy=SHIELD_CONFIG[shields[i]].energy;refreshShieldFlight(p);drawShield(p);});"
        "if(shields&&flightSteps)drawHud(players[game.currentPlayer],game.wind,game.round,{});"
        "if(breakShield){game.currentPlayer=fadeHud?1:0;drawHud(players[game.currentPlayer],game.wind,game.round,{});}"
        "if(shieldShot){game.currentPlayer=0;head.splice(0,2,players[1].x,players[1].y-SHIELD_CONFIG[3].radius);drawHud(players[game.currentPlayer],game.wind,game.round,{});}"
        "if(shotParachute)players[1].inventory[WPN.PARACHUTE]=1;"
        "const initialPlayers=players.map(p=>({tankType:p.tankType,x:p.x,y:p.y,power:p.power,...getTankAim(p),endX:getTankBarrel(p).endX,endY:getTankBarrel(p).endY}));"
        "const frames=[],motion=[],shieldUses=[],phases=[],flightPalettes=[],explosionPalettes=[];const encode=()=>Buffer.from(pixels.map(c=>c>=80&&c<110?c+40:c===120?80:c===127?87:c>=128&&c<=143?c-40:c)).toString('base64');"
        "if(fallingOffsets){if(fallShield!==null){players[1].activeShield=2;players[1].shieldEnergy=fallShield;}if(stackedFall){players[0].x=players[1].x;players[0].y=players[1].y;}players.forEach((p,i)=>p.y-=fallingOffsets[i]);const world=()=>{t.drawSky();t.drawTerrain();drawAllTanks();players.forEach(drawShield);drawPlayfieldBorder();};world();checkTanksFalling();for(let tick=0;tick<1000;tick++){world();const moving=stepFallingTanks(game.wind);world();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);const fading=shieldBreak.active;if(fading)drawShieldBreak();projectileDrawing.draw();frames.push(encode());flightPalettes.push([...palette6]);phases.push(fading?'shield':fallingFlash.delay?'lethal':moving?'falling':'aftermath');if(!moving)break;}}"
        "if(breakShield){if(shieldHole)eraseShieldContact(players[1],players[1].x,players[1].y-SHIELD_CONFIG[breakShield].radius);applyShieldDamage(players[1],players[1].shieldEnergy);while(shieldBreak.active){"
        "t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);"
        "players.forEach(drawShield);drawShieldBreak();frames.push(encode());flightPalettes.push([...palette6]);}"
        "if(!fadeHud){t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);projectileDrawing.draw();"
        "frames.push(encode());flightPalettes.push([...palette6]);}}"
        "if(head){clearProjectiles();launchProjectile(head[0],head[1],45,200,2,0);drawProjectileTrackingMarks(head[0],head[1],icon);if(erase){config.bombIcon=icon;projectileDrawing.advance(projectiles[0]);projectileDrawing.draw();projectileDrawing.finish(projectiles[0]);projectileDrawing.draw();}else if(!flightSteps)drawProjectileHead(head[0],head[1],icon);}"
        "if(flightSteps){config.bombIcon=icon;const shot=projectiles[0];for(let i=0;i<flightSteps;i++){"
        "t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);"
        "if(shields)players.forEach(drawShield);const status=stepSingleProjectile(shot,getPixel,game.wind);if(shotImpact&&status!=='flying'){if(!status.startsWith('hit_'))throw new Error('shot escaped '+status);processHit(shot,status);projectileDrawing.finish(shot);projectileDrawing.draw();frames.push(encode());flightPalettes.push([...palette6]);phases.push('impact');while(isExplosionActive()){t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);projectileDrawing.draw();stepExplosion();drawHud(players[game.currentPlayer],game.wind,game.round,{});frames.push(encode());flightPalettes.push([...palette6]);phases.push('blast');}if(shotAftermath){game.state=STATE.EXPLOSION;gameTick();for(let tick=0;(game.state===STATE.FALLING||game.state===STATE.EXPLOSION)&&tick<1000;tick++){const wasFalling=game.state===STATE.FALLING;if(wasFalling){t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();}gameTick();if(wasFalling){t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();}if(shotFalling&&wasFalling&&game.state===STATE.FALLING){drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);projectileDrawing.draw();frames.push(encode());flightPalettes.push([...palette6]);phases.push(isFallingSettling()?'settling':'falling');}}t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);projectileDrawing.draw();frames.push(encode());flightPalettes.push([...palette6]);phases.push('aftermath');}break;}if(shieldShot&&status==='hit_tank')processHit(shot,status);else if(status!=='flying')throw new Error('fixture hit '+status);"
        "projectileDrawing.advance(shot);projectileDrawing.draw();drawProjectileTrackingMarks(shot.x,shot.y,icon);"
        "frames.push(encode());flightPalettes.push([...palette6]);motion.push([shot.vx,shot.vy,shot.x,shot.y]);shieldUses.push(players.map(p=>p.shieldFlightUses));phases.push('flight');}if(shotImpact&&!phases.includes('impact'))throw new Error('shot did not impact');}"
        "if(explosion){startExplosion(...explosion,0);while(isExplosionActive()){"
        "t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);"
        "stepExplosion();frames.push(encode());explosionPalettes.push([...palette6]);}}"
        "if(restoreGrid)for(let y=38;y<=476;y+=7)for(let x=3;x<=356;x+=7)setPixel(x,y,getBackgroundColor(y,x));"
        "if(stackedFall){players.forEach(p=>{p.hudEnergy=undefined;p.hudPower=undefined;p.hudShieldEnergy=undefined;});drawHud(players[game.currentPlayer],game.wind,game.round,{});}"
        "if(shotParachute){players.forEach(p=>p.hudParachuteCount=undefined);drawHud(players[game.currentPlayer],game.wind,game.round,{});}"
        "const p=pixels.map(c=>c>=80&&c<110?c+40:c===120?80:c===127?87:c>=128&&c<=143?c-40:c);"
        "results.push({playerPower:players.map(p=>p.power),parachuteInventory:players.map(p=>p.inventory[WPN.PARACHUTE]),playerState:players.map(p=>({x:p.x,y:p.y,energy:p.energy,alive:p.alive})),initialPlayers,frames,motion,shieldUses,phases,flightPalettes,explosionPalettes,wind:game.wind,sky:resolvedSkyType,wall:getEffectiveWallType(),rng:getRandomState(),"
        "players:players.map(p=>({tankType:p.tankType,x:p.x,y:p.y,power:p.power,...getTankAim(p),endX:getTankBarrel(p).endX,endY:getTankBarrel(p).endY})),"
        "order:game.turnOrder,pixels:Buffer.from(p).toString('base64'),palette:[...palette6]});"
        "if(shotNextPlayer){if(!shotImpact)game.state=STATE.NEXT_TURN;if(game.state!==STATE.NEXT_TURN)throw new Error('fixture did not survive');const previousPlayer=game.currentPlayer;for(const [x,y,c] of windOverwrites)retainWorldPixel(x,y,c>=80&&c<=104?c+40:c>=120&&c<150?c-40:c);game.nextTurnTimer=15;gameTick();t.drawSky();t.drawTerrain();drawAllTanks();drawPlayfieldBorder();drawHud(players[game.currentPlayer],game.wind,game.round,{});drawWindIndicator(game.wind);if(shields)players.forEach(drawShield);projectileDrawing.draw();results.at(-1).nextPlayer={previousPlayer,state:game.state,shieldUses:players.map(p=>p.shieldFlightUses),overwrites:windOverwrites,wind:game.wind,player:game.currentPlayer,pixels:encode(),palette:[...palette6],rng:getRandomState()};}}console.log(JSON.stringify(results));",
        str(seed),str(sky),str(wall),str(args.wind),str(int(args.mountains)),str(args.mtn_percent),str(args.rounds),str(int(args.players)),str(int(args.full_frame)),json.dumps([names,args.tank_types,args.projectile_head,args.bomb_icon,args.erase_head,args.restore_sky_grid,args.flight_steps,args.trace,args.explosion,args.shields,args.shield_shot,args.shield_break,args.shield_hole,args.shield_fade_hud,args.shot_impact,args.shot_aftermath,args.shot_falling,args.shot_parachute,args.falling_offsets,args.stacked_fall,args.fall_shield,args.shot_next_player,args.change_wind,args.wind_overwrite])],cwd=root,text=True))
    call(0x32994,0x2C89,[seed])
    for round,actual in enumerate(actual_rounds):
        call(0x2927E,0x22CA)
        if args.players:
            call(0x2AE53,0x2431)
            slots=[(mem.read16(ds+0xE4F6+i*4)-0xD568)//0xCA for i in range(2)]
            start=mem.read16(ds+0xE4F4)
            assert actual['order']==slots[start:]+slots[:start], (seed,round,'order',actual['order'],slots,start)
            for i,player in enumerate(actual['initialPlayers']):
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
        if args.falling_offsets:
            stack_x=mem.read16(ds+0xD632+14);stack_y=mem.read16(ds+0xD632+16)
            for i,lift in enumerate(args.falling_offsets):
                tank=0xD568+i*0xCA;x=mem.read16(ds+tank+14);y=mem.read16(ds+tank+16)
                previous=extract_display_pixels(mem,ports)
                for py in range(y-16,y+1):
                    for px in range(x-16,x+17):
                        if i*8<=previous[py*360+px]<i*8+8:call(0x3AB39,0x3352,[px,py])
                if args.stacked_fall and i==0:
                    mem.write16(ds+tank+14,stack_x);y=stack_y
                mem.write16(ds+tank+16,y-lift)
                call(0x3FD3F,0x39A2,[tank,0x4FC8])
                call(0x3FB27,0x39A2,[tank,0x4FC8,1,0])
            if args.fall_shield is not None:
                tank=0xD632;cfg=0x618C;color=13
                mem.write16(ds+tank+0xC6,cfg);mem.write16(ds+tank+0xC8,0x4FC8)
                mem.write16(ds+tank+0x96,args.fall_shield)
                mem.write16(ds+0xEC80,color)
                rgb=[args.fall_shield*mem.read16(ds+cfg+o)//mem.read16(ds+cfg+2) for o in (6,8,10)]
                call(0x3A046,0x3352,[color,*rgb,1])
                call(0x404C9,0x39A2,[tank,0x4FC8,0x339,0x3221])
                call(0x389DA,0x3221,[tank,0x4FC8])
                call(0x301B2,0x2945,[mem.read16(ds+0x5182),mem.read16(ds+0x5184)])
            from verify_falling_frames import compare_falling
            compare_falling(cpu,mem,ports,handler,actual,args.output_dir)
            if args.stacked_fall:call(0x301B2,0x2945,[mem.read16(ds+0x5182),mem.read16(ds+0x5184)])
        if args.shields:
            # Settled shape composition, not the timed activation wrapper.
            mem.write16(ds+0xEC7C,0);mem.write16(ds+0xEC7E,0)
            mem.write16(ds+0x510E,int(mem.read16(ds+0x5154)==1))
            for i,kind in enumerate(args.shields):
                if not kind: continue
                tank=0xD568+i*0xCA;cfg=0x616C+kind*16
                mem.write16(ds+tank+0xC6,cfg);mem.write16(ds+tank+0xC8,0x4FC8)
                mem.write16(ds+tank+0x96,mem.read16(ds+cfg+2))
                color=mem.read16(ds+tank+0x1A)+5
                mem.write16(ds+0xEC80,color)
                call(0x3A046,0x3352,[color,*[mem.read16(ds+cfg+o) for o in (6,8,10)],1])
                call(0x404C9,0x39A2,[tank,0x4FC8,0x339,0x3221])
                call(0x389DA,0x3221,[tank,0x4FC8])
            call(0x238AE,0x1ADA)
            if args.flight_steps:call(0x301B2,0x2945,[mem.read16(ds+0x5182),mem.read16(ds+0x5184)])
        if args.shield_break:
            hud_tank=0xD632 if args.shield_fade_hud else 0xD568
            call(0x301B2,0x2945,[hud_tank,0x4FC8])
            mem.write16(ds+0x5182,hud_tank);mem.write16(ds+0x5184,0x4FC8)
            if args.shield_hole:
                cfg=0x616C+args.shield_break*16
                call(0x3AB39,0x3352,[mem.read16(ds+0xD632+14),mem.read16(ds+0xD632+16)-mem.read16(ds+cfg+4)])
            cpu.segs[1]=0x3221;cpu.ip=0x34;cpu.regs[4]=0x2400
            for j,value in enumerate((0x110,0x60,0xD632,0x4FC8,mem.read16(ds+0xD632+0x96))):mem.write16(stack+2*j,value)
            stage=0
            frame_count=51 if args.shield_fade_hud else 52
            while stage<frame_count:
                reason,count=run_fast(cpu,mem,ports,handler,1000000,bp_set={0x38502-0x6100,0x38528-0x6100,0x4C117-0x6100})
                assert reason=='breakpoint',('shield break',stage,reason,count)
                if cpu.segs[1]*16+cpu.ip==0x4C117-0x6100:
                    sp=(cpu.segs[2]<<4)+cpu.regs[4]
                    cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
                    continue
                native_frame=extract_display_pixels(mem,ports)
                port_frame=base64.b64decode(actual['frames'][stage]);pal=actual['flightPalettes'][stage]
                mapped=[pal[(i-40 if 120<=i<150 else 120 if i==80 else i+40 if 87<=i<=103 else i)*3:][:3] for i in range(256)]
                differences=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native_frame,port_frame)) if list(ports.palette[n])!=mapped[p]]
                if args.output_dir:
                    args.output_dir.mkdir(parents=True,exist_ok=True)
                    for name,frame,palette in (('emulator',native_frame,ports.palette),('web',port_frame,mapped)):
                        write_emu_png(dict(width=360,height=480,pixels=frame,palette=palette),args.output_dir/f'shield-break-{stage:03d}-{name}.png')
                assert not differences,('shield break',stage,len(differences),differences[:10])
                stage+=1
                if stage<frame_count:cpu.regs[4]+=8;cpu.ip+=3
            print(f'{frame_count} complete shield-break RGB frames match '+('with damaged tank HUD during fade.' if args.shield_fade_hud else 'through outline erasure.'),flush=True)
        if args.shield_shot:
            call(0x301B2,0x2945,[0xD568,0x4FC8])
            args.projectile_head=[mem.read16(ds+0xD632+14),mem.read16(ds+0xD632+16)-15]
            mem.write16(ds+0x5182,0xD568);mem.write16(ds+0x5184,0x4FC8)
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
                mem.write16(0x9002A,0xD568);mem.write16(0x9002C,0x4FC8)
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
                if args.shot_impact:
                    if args.shot_parachute:
                        target=ds+0xD568+0xCA
                        inventory=mem.read16(target+0xB2)+16*mem.read16(target+0xB4)
                        mem.write16(inventory+2*mem.read16(ds+0xD554),1)
                        mem.write16(target+0x28,1)
                        mem.write16(target+0x2C,5)
                        call(0x301B2,0x2945,[mem.read16(ds+0x5182),mem.read16(ds+0x5184)])
                    from verify_shot_sequence import compare_shot
                    compare_shot(cpu,mem,ports,handler,actual,args.output_dir,args.flight_steps,args.shot_aftermath,args.shot_falling)
                    if args.shot_parachute:
                        for i,count in enumerate(actual['parachuteInventory']):
                            target=ds+0xD568+i*0xCA
                            inventory=mem.read16(target+0xB2)+16*mem.read16(target+0xB4)
                            assert mem.read16(inventory+2*mem.read16(ds+0xD554))==count
                        # Separately verify the real full-HUD refresh after the
                        # already-compared stale aftermath frame.
                        call(0x301B2,0x2945,[mem.read16(ds+0x5182),mem.read16(ds+0x5184)])
                for step in range(0 if args.shot_impact else args.flight_steps):
                    if args.flight_collisions:
                        for off,pof in ((0,20),(2,28)):
                            mem.write16(0x90000+off,int(mem.read_float64(0x90000+pof))&65535)
                        for off in (0x1C7E,0xCE98,0xCE9A):mem.write16(ds+off,0)
                        cpu.segs[1]=0x1ADA;cpu.ip=0x21AA2-0x6100-0x1ADA0
                        cpu.regs[5]=0x2400;cpu.regs[4]=0x23E0;cpu.regs[6]=0
                        flight_stop=0x220DE if args.shields else 0x22064
                        for _ in range(100):
                            reason,count=run_fast(cpu,mem,ports,handler,1000000,
                                bp_set={flight_stop-0x6100,0x230C8-0x6100,0x4C117-0x6100})
                            assert reason=='breakpoint',(step,reason,count)
                            address=cpu.segs[1]*16+cpu.ip
                            assert address!=0x230C8-0x6100,('native fixture impact',step)
                            if address==flight_stop-0x6100:break
                            # Skip sound dispatch only; all pixel reads/writes and heads run.
                            sp=(cpu.segs[2]<<4)+cpu.regs[4]
                            cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
                        else:raise AssertionError('flight block did not finish')
                    else:block(0x21AA2,0x21D09)
                    if args.shields:
                        assert [mem.read16(ds+0xD568+i*0xCA+0x98) for i in range(2)]==actual['shieldUses'][step],('shield reserve',step)
                    motion=[mem.read_float64(0x90000+off) for off in (4,12,20,28)]
                    assert motion==actual['motion'][step],(step,motion,actual['motion'][step])
                    if not args.flight_collisions: call(0x22DFA,0x1ADA,[int(motion[2])&65535,int(motion[3])&65535])
                    native_frame=extract_display_pixels(mem,ports)
                    port_frame=base64.b64decode(actual['frames'][step])
                    if args.output_dir:
                        args.output_dir.mkdir(parents=True,exist_ok=True)
                        pal=actual['flightPalettes'][step]
                        mapped=[pal[(i-40 if 120<=i<150 else 120 if i==80 else i+40 if 87<=i<=103 else i)*3:][:3] for i in range(256)]
                        for name,frame,palette in (('emulator',native_frame,ports.palette),('web',port_frame,mapped)):
                            write_emu_png(dict(width=360,height=480,pixels=frame,palette=palette),args.output_dir/f'flight-{step:03d}-{name}.png')
                    for index,(native_color,port_color) in enumerate(zip(native_frame,port_frame)):
                        pi=port_color-40 if 120<=port_color<150 else 120 if port_color==80 else port_color+40 if 87<=port_color<=103 else port_color
                        assert actual['flightPalettes'][step][pi*3:pi*3+3]==list(ports.palette[native_color]),(seed,step,index%360,index//360,native_color,port_color)

            if args.shields and args.flight_steps and not args.shot_impact:
                print(f'{args.flight_steps} complete shielded-flight RGB frames, exact motion and reserve counts match; final reserves {actual["shieldUses"][-1]}.',flush=True)
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
        assert (actual['wind'],actual['sky'],actual['wall']) == (wind,resolved,resolved_wall), (seed,round,'state',(actual['wind'],actual['sky'],actual['wall']),(wind,resolved,resolved_wall))
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
        print(f'Round {round+1}, seed {seed}, sky {sky}->{resolved}, wall {wall}, max wind {args.wind}, changing wind {args.change_wind}, generator {selected}, tank types {args.tank_types}, head {args.projectile_head}, icon {args.bomb_icon}, erased {args.erase_head}, sky grid {args.restore_sky_grid}, flight steps {args.flight_steps}, native collisions {args.flight_collisions}, explosion {args.explosion}, trace {args.trace}, shields {args.shields}: complete {scope} pixels, RGB, state and RNG match EXE.',flush=True)

        if args.shot_next_player:
            from verify_next_player_frame import compare_next_player_frame
            compare_next_player_frame(cpu,mem,ports,handler,actual['nextPlayer'],args.output_dir)
