#!/usr/bin/env python3
"""Compare native 0x16A7A cash/interest header strip with production rendering.

Explicit balances, colors and teams isolate bar layout and scaling. Entire
12-row strip is compared in RGB; this does not establish full-shop parity.
"""
import argparse,json,subprocess
from pathlib import Path
import struct,zlib
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state,extract_display_pixels
from emu.execute import run_fast
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('checkpoint');parser.add_argument('--output-dir',default='/tmp/scorched-shop-bars');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
cases=[dict(n=n,pattern=pattern,mode=mode,status=status)
 for n in (2,3,10) for pattern in ('zero','equal','ramp','large') for mode in (0,2) for status in (0,1)]
for case in cases:
 n=case['n'];kind=case['pattern']
 case['cash']=[0 if kind=='zero' else 500 if kind=='equal' else i*137+1 if kind=='ramp' else 2147483647-i*10000000 for i in range(n)]
 case['interest']=[0 if kind=='zero' else 12 if kind=='equal' else (n-i)*13 if kind=='ramp' else 1000000+i*99999 for i in range(n)]
 case['teamCash']=[max(0,70000-i*17000) for i in range(n)]
 case['grow']=min(2147483647,max(case['teamCash'] if case['mode'] else case['cash'])+70000)
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h);width,height=p.get_resolution()
actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',r'''
import {config} from './web/js/config.js';
import {players,createPlayers} from './web/js/tank.js';
import {getTeamScore} from './web/js/team-scoring.js';
import {drawShopCashBars,openShop} from './web/js/shop.js';
import {pixels,reinitFramebuffer} from './web/js/framebuffer.js';
import {palette6,setPaletteRgb} from './web/js/palette.js';
let input='';for await(const c of process.stdin)input+=c;const s=JSON.parse(input);
Object.assign(config,{screenWidth:s.width,screenHeight:s.height});reinitFramebuffer();
s.palette.forEach((rgb,i)=>setPaletteRgb(i,...rgb));
console.log(JSON.stringify(s.cases.map(c=>{
 Object.assign(config,{teamMode:c.mode,statusBar:c.status});createPlayers(c.n);
 players.forEach((p,i)=>{
  Object.assign(p,{cash:c.cash[i],earnedInterest:c.interest[i],team:i,colorIndex:i});
  Object.assign(getTeamScore(i),{type:2,cash:c.teamCash[i]});
 });
 openShop(0,10,{showPrivacy:false});
 pixels.fill(151);drawShopCashBars();
 const result=[Array.from(pixels.slice(17*s.width,29*s.width))];
 players.forEach((p,i)=>{p.cash=Math.trunc(p.cash/2);getTeamScore(i).cash=Math.trunc(getTeamScore(i).cash/2);});
 drawShopCashBars();result.push(Array.from(pixels.slice(17*s.width,29*s.width)));
 players[0].cash=c.grow;getTeamScore(0).cash=c.grow;
 drawShopCashBars();result.push(Array.from(pixels.slice(17*s.width,29*s.width)));
 return result;
})));
'''],input=json.dumps(dict(cases=cases,width=width,height=height,palette=p.palette)),text=True,cwd=root))
for index,(case,expected) in enumerate(zip(cases,actual)):
 m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
 load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
 def call(address,segment,arguments):
  c.segs[:]=[0,segment,0x8800,0x4fc8];c.ip=address-0x6100-segment*16;c.regs[4]=0x2400
  for i,v in enumerate([0x110,0x60,*arguments]):m.write16(0x88000+0x2400+2*i,v&65535)
  reason,_=run_fast(c,m,p,h,10000000,bp_set={0x710});assert reason=='breakpoint',(case,hex(address),reason)
 for off,value in ((0x519a,65535),(0x50ea,case['mode']),(0x50d4,case['n']),(0x5142,case['status']),(0x518e,5),(0xf0,1)):
  m.write16(ds+off,value)
 for i in range(case['n']):
  tank=0xd568+0xca*i;team=0xe1ec+0x16*i
  for off,value in ((tank+0xa0,i),(tank+0x1a,8*i),(tank+0x30,i),(team+2,2)):
   m.write16(ds+off,value)
  for off,value in ((tank+0xbe,case['cash'][i]),(tank+0xc2,case['interest'][i]),(team+0xe,case['teamCash'][i])):
   call(0x11b2c,0xb87,[off,0x4fc8,value&65535,value>>16])
 segment=m.read16(ds+0xef16);address=0x6100+16*segment+m.read16(ds+0xef14)
 call(address,segment,[0,17,width-1,28,151])
 call(0x16a7a,0xe4c,[])
 for phase,expected in enumerate(expected):
  if phase==1:
   for i in range(case['n']):
    tank=0xd568+0xca*i;team=0xe1ec+0x16*i
    for off,value in ((tank+0xbe,case['cash'][i]//2),(team+0xe,case['teamCash'][i]//2)):
     call(0x11b2c,0xb87,[off,0x4fc8,value&65535,value>>16])
    call(0x16d3a,0xe4c,[tank,0x4fc8])
  if phase==2:
   value=case['grow']
   for off in (0xd568+0xbe,0xe1ec+0xe):
    call(0x11b2c,0xb87,[off,0x4fc8,value&65535,value>>16])
   call(0x170ae,0xe4c,[0xd568,0x4fc8])
  native=extract_display_pixels(m,p)[17*width:29*width]
  def rgb(indices):return bytes(v*255//63 for i in indices for v in p.palette[i])
  native_rgb,port_rgb=rgb(native),rgb(expected)
  if native_rgb!=port_rgb or index==len(cases)-1:
   def png(path,data):
    def chunk(kind,value):return struct.pack('>I',len(value))+kind+value+struct.pack('>I',zlib.crc32(kind+value))
    rows=b''.join(b'\0'+data[y*width*3:(y+1)*width*3] for y in range(12))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,12,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))
   png(out/'native.png',native_rgb);png(out/'port.png',port_rgb)
  differences=[(i%width,17+i//width,native[i],expected[i]) for i in range(len(native)) if p.palette[native[i]]!=p.palette[expected[i]]]
  assert not differences,(case,len(differences),differences[:20])
print(f'{len(cases)*3} native cash/interest header strips match RGB, including Corporate cash and 2/3/10 players.')
