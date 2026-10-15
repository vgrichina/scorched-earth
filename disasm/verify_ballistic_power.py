"""Execute native 0x254E9 and compare ballistic power and angle side effects."""
import argparse, itertools, json, subprocess
from pathlib import Path
from compare_pipeline import Memory, CPU, PortIO, InterruptHandler, load_state
from emu.execute import run_fast
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint')
parser.add_argument('--trace-horizontal', action='store_true',
                    help='Trace the first horizontal shot before comparing all cases')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
m,c,p = Memory(),CPU(),PortIO(); p.mem=m
h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h)
d=0x4fc80; t=d+0xd568
cases=[]
for angle,wind,gravity,xy,geometry,strict,energy,direction in itertools.product(
    [0,1,30,45,89,90,91,135,179,180], [-200,0,200], [0.2,1.0,3.0],
    [(80,300),(240,100),(160,300)], [(8,0,0),(7,0,-4),(8,-3,-4),(8,-2,-5),(5,1,-5),(6,-1,-4)],
    [False,True], [0,25,100], [-1,1]):
    length,xoff,yoff=geometry
    tank=dict(x=160,y=300,barrelLen=length,barrelXOff=xoff,barrelYOff=yoff,direction=direction,energy=energy)
    for off,value in [(2,length),(4,xoff),(6,yoff),(0xe,160),(0x10,300),(0x32,angle),(0x94,direction),(0xa2,energy),(0xa4,0)]:
        m.write16(t+off,value&65535)
    m.write16(d+0x515a,wind&65535);m.write_float64(d+0x512a,gravity)
    c.segs[:]=[0,0x1a4a,0x8000,0x4fc8];c.ip=0x254e9-0x6100-0x1a4a0;c.regs[4]=0x2400
    for j,value in enumerate([0x110,0x60,0xd568,0x4fc8,*xy,int(strict)]):m.write16(0x82400+2*j,value)
    if args.trace_horizontal and not cases:
        trace = dict(fpuType=m.read16(d+0xbe30), angle=angle, wind=wind, gravity=gravity)
        for address in [0x25778,0x257b2,0x257ca]:
            reason,detail=run_fast(c,m,p,h,100000,bp_set={address-0x6100})
            assert reason=='breakpoint', (reason,detail)
            bp=0x80000+c.regs[5]
            trace[hex(address)] = dict(
                dx=m.read_float64(bp-8),dy=m.read_float64(bp-16),
                theta=m.read_float64(bp-24),phi=m.read_float64(bp-32),
                denominator=m.read_float64(bp-88) if address==0x257ca else None,
                st0=c.fpu_st(0))
        print(json.dumps(trace,indent=2),flush=True)
    reason,detail=run_fast(c,m,p,h,100000,bp_set={0x710})
    assert reason=='breakpoint',(angle,wind,gravity,xy,geometry,strict,reason,detail)
    signed=lambda v:v-65536 if v>=32768 else v
    cases.append(dict(tank=tank,target=dict(zip(['x','y'],xy)),angle=angle,wind=wind,gravity=gravity,strict=strict,
                      expected=dict(power=signed(c.regs[0]),angle=signed(m.read16(t+0x32)))))
code=r'''
import assert from 'node:assert/strict';
import {ballisticPower} from './web/js/ballistic-power.js';
let input='';for await(const chunk of process.stdin) input+=chunk;
const cases=JSON.parse(input);
const failures=[];
for(const c of cases) { const actual=ballisticPower(c.tank,c.target,c.angle,c.wind,c.gravity,c.strict);
 if(actual.power!==c.expected.power || actual.angle!==c.expected.angle) failures.push({...c,actual}); }
console.log(JSON.stringify({total:cases.length,failures:failures.length,byAngle:failures.reduce((a,c)=>(a[c.angle]=(a[c.angle]??0)+1,a),{}),examples:failures.slice(0,2)},null,2));
assert.equal(failures.length,0);
console.log(`${cases.length} native ballistic power/angle comparisons pass.`);
'''
subprocess.run(['node','--input-type=module','-e',code],cwd=root,input=json.dumps(cases),text=True,check=True)
