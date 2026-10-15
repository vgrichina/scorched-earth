"""Compare Choose Target overlay to a captured native dialog and restoration."""
import argparse,json,subprocess
from pathlib import Path
from compare_pipeline import extract_state
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');args=parser.parse_args()
s=extract_state(args.checkpoint);w=s['width'];x=(w-1-82)//2;y=38
native=[ch for yy in range(y,y+28) for xx in range(x,x+83) for ch in s['palette'][s['pixels'][yy*w+xx]]]
code=r'''
import assert from 'node:assert/strict';
import {config} from './web/js/config.js';
import {pixels} from './web/js/framebuffer.js';
import {palette6,setPaletteRgb} from './web/js/palette.js';
import {drawGuidanceTarget,closeGuidanceTarget} from './web/js/guidance-target.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{screenWidth:s.width,screenHeight:s.height});s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
pixels.fill(87);const before=pixels.slice();drawGuidanceTarget();drawGuidanceTarget();
const rgb=[];for(let y=38;y<66;y++)for(let x=s.x;x<s.x+83;x++)rgb.push(...palette6.slice(pixels[y*s.width+x]*3,pixels[y*s.width+x]*3+3));
closeGuidanceTarget();assert.deepEqual(pixels,before);console.log(JSON.stringify(rgb));
'''
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=Path(__file__).resolve().parent.parent,input=json.dumps(dict(width=w,height=s['height'],palette=s['palette'],x=x)),text=True))
diff=[(x+(i//3)%83,y+(i//3)//83,a,b) for i,(a,b) in enumerate(zip(native,actual)) if a!=b]
assert not diff,(len(diff),diff[:12])
print('Native Choose Target panel RGB matches; repeated draws restore the underlying framebuffer exactly.')
