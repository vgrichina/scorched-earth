"""Run Borland's installed software-FPU handlers instead of host math shortcuts.

Uses a checkpoint with initialized interrupt vectors and the original runtime
stack segment. No emulator implementation is changed outside this process.
"""
import argparse, json
from pathlib import Path
from compare_pipeline import Memory, CPU, PortIO, InterruptHandler, load_state
import emu.execute as execute

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m
h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)

def dispatch_software(cpu,mem,seg_override):
    address=cpu.segs[1]*16+cpu.ip
    interrupt=mem.read8(address+1)
    for value in [cpu.get_flags(),cpu.segs[1],(cpu.ip+2)&65535]:
        execute._push16(cpu,mem,value)
    cpu.segs[1]=mem.read16(interrupt*4+2)
    cpu.ip=mem.read16(interrupt*4)
    return 0

original=execute.exec_fpu_int
execute.exec_fpu_int=dispatch_software
try:
    for name,opcode,value in [('atan',0xf2,.5),('sin',0xec,.5),('cos',0xee,.5),('tan',0xf0,.5)]:
        c.segs[:]=[0,0x7000,0x5f4a,0x4fc8];c.ip=0;c.regs[4]=0x2400
        # FINIT; FLD; unary operation; FSTP. Buffers use otherwise free ES/DS space.
        c.segs[3]=0x7100
        code=bytes.fromhex('CD 37 E3 CD 39 06 00 01 CD 3E')+bytes([opcode,0x90])+bytes.fromhex('CD 39 1E 08 01')
        m.load_bytes(0x70000,code);m.write_float64(0x71100,value)
        reason,steps=execute.run_fast(c,m,p,h,1000000,bp_set={0x70000+len(code)})
        assert reason=='breakpoint',(reason,steps)
        print(json.dumps(dict(operation=name,input=value,result=m.read_float64(0x71108),instructions=steps)))
    d=0x4fc80;t=d+0xd568
    for off,value in [(2,8),(4,0),(6,0),(14,160),(16,300),(50,0),(148,-1),(162,100),(164,0)]:
        m.write16(t+off,value&65535)
    m.write16(d+0x515a,(-200)&65535);m.write_float64(d+0x512a,.2)
    c.segs[:]=[0,0x1a4a,0x5f4a,0x4fc8];c.ip=0x254e9-0x6100-0x1a4a0;c.regs[4]=0x2400
    for j,value in enumerate([0x110,0x60,0xd568,0x4fc8,80,300,0]):m.write16(0x618a0+2*j,value)
    reason,steps=execute.run_fast(c,m,p,h,1000000,bp_set={0x257ca-0x6100})
    assert reason=='breakpoint',(reason,steps)
    bp=c.segs[2]*16+c.regs[5]
    print(json.dumps(dict(operation='ballistic-intermediates',
                         phi=m.read_float64(bp-32),theta=m.read_float64(bp-24),
                         dx=m.read_float64(bp-8),dy=m.read_float64(bp-16),
                         denominator=m.read_float64(bp-88))))
    reason,steps=execute.run_fast(c,m,p,h,1000000,bp_set={0x710})
    assert reason=='breakpoint',(reason,steps)
    power=c.regs[0];power=power-65536 if power>=32768 else power
    print(json.dumps(dict(operation='ballistic-horizontal',power=power,angle=m.read16(t+50),instructions=steps)))
finally:
    execute.exec_fpu_int=original
