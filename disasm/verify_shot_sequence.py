"""Continuous flight-to-impact capture for verify_landscape_sequence.py.

Uses the real native collision -> impact dispatcher -> ordinary blast call chain.
Only sound/delay/input waits are bypassed. The blast completion capture follows
area damage at 0x43F69, matching production stepExplosion callbacks. Optional
aftermath reaches the impact handler return. Optional falling captures check
each moving pass; death and next-turn coverage remain to be added.
"""
import base64
import json
from emu.execute import run_fast
from emu.state import save_state
from compare_pipeline import extract_display_pixels, write_emu_png


def compare_shot(cpu, mem, ports, handler, actual, output_dir, max_steps, aftermath=False, falling=False, shields=False):
    ds=0x4FC80
    saw_falling=False
    pending_landing=False
    flight_stop=0x220DE if shields else 0x22064
    # Ordinary weapon, no saved blast background. Same initialized weapon table as
    # the checkpoint, including its resolution-dependent Large radius.
    for off,value in ((0xE344,actual.get('shotWeapon',0)),(0xEF46,0),(0x5104,0),(0x5106,0)):
        mem.write16(ds+off,value)
    mem.write16(0x9003A,0)
    stage=0
    impacted=False
    def capture(phase):
        nonlocal stage
        assert actual['phases'][stage]==phase,(stage,phase,actual['phases'][stage])
        native=extract_display_pixels(mem,ports)
        port=base64.b64decode(actual['frames'][stage])
        palette=actual['flightPalettes'][stage]
        mapped=[palette[(i-40 if 120<=i<150 else 120 if i==80 else i+40 if 87<=i<=103 else i)*3:][:3] for i in range(256)]
        differences=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native,port)) if list(ports.palette[n])!=mapped[p]]
        if output_dir:
            output_dir.mkdir(parents=True,exist_ok=True)
            for name,frame,pal in (('emulator',native,ports.palette),('web',port,mapped)):
                write_emu_png(dict(width=360,height=480,pixels=frame,palette=pal),output_dir/f'shot-{stage:03d}-{phase}-{name}.png')
        if differences and output_dir:
            save_state(output_dir/'mismatch.state',cpu,mem,ports,handler)
        assert not differences,(stage,phase,len(differences),[(x,y,n,p,ports.palette[n],mapped[p]) for x,y,n,p in differences[:10]])
        if phase!='flight' or stage%20==0:print(f'Shot frame {stage}: {phase} RGB matches.',flush=True)
        stage+=1
    for step in range(max_steps):
        for off,pof in ((0,20),(2,28)):
            mem.write16(0x90000+off,int(mem.read_float64(0x90000+pof))&65535)
        for off in (0x1C7E,0xCE98,0xCE9A):mem.write16(ds+off,0)
        cpu.segs[1]=0x1ADA;cpu.ip=0x21AA2-0x6100-0x1ADA0
        cpu.regs[5]=0x2400;cpu.regs[4]=0x23E0;cpu.regs[6]=0
        points={0x20F63,flight_stop,0x231D3,0x43D3A,0x43DDD,0x43E2E,0x43E71,0x43F69}
        if falling:points.update((0x20BDF,0x201CF,0x20EA2,0x31AE3,0x31AF8))
        waits={0x4C117,0x104F6,0x28A80}
        budgets=0
        for _ in range(1000):
            reason,count=run_fast(cpu,mem,ports,handler,10000000,bp_set={p-0x6100 for p in points|waits})
            offset=cpu.segs[1]*16+cpu.ip+0x6100
            if reason=='max_steps':
                budgets+=1
                print(f'Native aftermath still executing: {budgets*10}M instructions, file {offset:#x}.',flush=True)
                assert budgets<20,('shot aftermath instruction limit',hex(offset))
                continue
            assert reason=='breakpoint',('shot',step,hex(offset),reason,count)
            if offset==0x20F63:
                sp=(cpu.segs[2]<<4)+cpu.regs[4]
                raise AssertionError(('unexpected calibration',hex(mem.read16(sp+2)*16+mem.read16(sp)+0x6100)))
            if offset in waits:
                if offset==0x28A80:cpu.regs[0]=0x80
                sp=(cpu.segs[2]<<4)+cpu.regs[4]
                cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
                continue
            if offset in (0x31AE3,0x31AF8):
                capture('lethal')
                run_fast(cpu,mem,ports,handler,1)
                continue
            if offset in (0x20BDF,0x201CF):
                saw_falling=True
                if offset==0x201CF:
                    moving=pending_landing and cpu.regs[0]>0
                    pending_landing=False
                else:
                    moving=cpu.regs[7]<sum(bool(mem.read16(ds+0xCE58+i*2)) for i in range(2))
                    pending_landing=not moving
                if moving:capture('falling')
                run_fast(cpu,mem,ports,handler,1)
                continue
            if offset==0x20EA2:
                if saw_falling:capture('settling')
                run_fast(cpu,mem,ports,handler,1)
                continue
            if offset==0x231D3:
                assert impacted and aftermath
                native_players=[]
                for i in range(mem.read16(ds+0x50D4)):
                    base=ds+0xD568+i*0xCA
                    energy=mem.read16(base+0xA2)+(mem.read16(base+0xA4)<<16)
                    if energy>=0x80000000:energy-=0x100000000
                    native_players.append(dict(x=mem.read16(base+14),y=mem.read16(base+16),
                        energy=energy,alive=bool(mem.read16(base+0x18))))
                print('Aftermath player state:',native_players,flush=True)
                if 'playerState' in actual:
                    print('Port player state:',actual['playerState'],flush=True)
                capture('aftermath')
                if 'playerState' in actual:assert native_players==actual['playerState']
                assert [mem.read16(ds+0xD568+i*0xCA+0x9E) for i in range(len(native_players))]==actual['playerPower'],'aftermath shot powers differ'
                native_rng=dict(index=mem.read16(ds+0xEC06),
                    words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
                assert native_rng==actual['rng'],('shot aftermath RNG differs',native_rng['index'],actual['rng']['index'],actual.get('gameState'))
                assert stage==len(actual['frames']),(stage,len(actual['frames']))
                print(f'{stage} shot RGB frames, signed HP/alive state and complete RNG match through completed impact aftermath.',flush=True)
                return
            if offset==flight_stop:
                motion=[mem.read_float64(0x90000+off) for off in (4,12,20,28)]
                assert motion==actual['motion'][step],(step,motion,actual['motion'][step])
                if shields:
                    assert [mem.read16(ds+0xD568+i*0xCA+0x98) for i in range(2)]==actual['shieldUses'][step],('shield reserve',step)
                capture('flight')
                break
            if offset==0x43D3A:
                sp=(cpu.segs[2]<<4)+cpu.regs[4]
                print('Native impact:',[mem.read16(sp+o) for o in (4,6,8,10)],
                      'port motion:',actual['motion'][step:step+1],
                      'native motion:',[mem.read_float64(0x90000+o) for o in (4,12,20,28)],
                      'contact:',[mem.read16(ds+o) for o in (0xE1E4,0xE1E6,0xE1E8)],flush=True)
                impacted=True
                capture('impact')
                points.remove(offset)
                continue
            capture('blast')
            if offset==0x43F69:
                if actual.get('blastPlayerState') is not None:
                    state=[]
                    for i in range(mem.read16(ds+0x50D4)):
                        tank=ds+0xD568+i*0xCA
                        hp=mem.read16(tank+0xA2)+(mem.read16(tank+0xA4)<<16)
                        if hp>=0x80000000:hp-=0x100000000
                        state.append(dict(energy=hp,alive=bool(mem.read16(tank+0x18))))
                    assert state==actual['blastPlayerState'],('blast damage state',state,actual['blastPlayerState'])
                if aftermath:
                    if output_dir:
                        save_state(output_dir/'after-restoration.state',cpu,mem,ports,handler)
                        (output_dir/'after-restoration-port.json').write_text(json.dumps({
                            'frame':actual['frames'][stage], 'palette':actual['flightPalettes'][stage]}))
                    points.remove(offset)
                    continue
                assert stage==len(actual['frames']),(stage,len(actual['frames']))
                print(f'{stage} continuous shot RGB frames match through crater restoration and area damage; aftermath pending.',flush=True)
                return
            cpu.regs[4]+={0x43DDD:12,0x43E2E:4,0x43E71:4}[offset]
            cpu.ip+=3
        else:raise AssertionError('shot native block did not finish')
    raise AssertionError('native shot did not impact')


def compare_weapon_return(cpu,mem,ports,handler,actual,fired_weapon,output_dir):
    """Real post-flight inventory fallback and optional row-1 redraw."""
    ds=0x4FC80
    cpu.segs[1]=0x2945;cpu.ip=0x30771-0x6100-0x29450;cpu.regs[4]=0x2400
    reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={0x307B2-0x6100})
    assert reason=='breakpoint',('weapon return',reason)
    tank=ds+mem.read16(ds+0x5182)
    assert mem.read16(tank+0x16)==actual['weapon'],'post-flight weapon selection differs'
    if fired_weapon:
        inventory=mem.read16(tank+0xB2)+16*mem.read16(tank+0xB4)
        assert mem.read16(inventory+fired_weapon*2)==actual['ammo'],'post-flight ammo differs'
    native=extract_display_pixels(mem,ports);port=base64.b64decode(actual['pixels']);pal=actual['palette']
    mapped=[pal[(i-40 if 120<=i<150 else 120 if i==80 else i+40 if 87<=i<=103 else i)*3:][:3] for i in range(256)]
    if output_dir:
        for name,frame,palette in (('emulator',native,ports.palette),('web',port,mapped)):
            write_emu_png(dict(width=360,height=480,pixels=frame,palette=palette),output_dir/f'weapon-return-{name}.png')
    differences=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native,port)) if list(ports.palette[n])!=mapped[p]]
    assert not differences,('weapon return RGB',len(differences),differences[:10])
    print('Post-flight weapon selection, ammo and complete HUD/world RGB match.',flush=True)
