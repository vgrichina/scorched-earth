#!/usr/bin/env python3
"""Make a rendering fixture with N owned items, then repaint via native tabs.

Inventory counts are injected, not purchased. Native dialog input/repaint is
used to establish the shop background before subsequent Inventory captures.
"""
import argparse,subprocess
from pathlib import Path
from compare_pipeline import Memory,CPU,PortIO,InterruptHandler,load_state
from emu.state import save_state
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('checkpoint');parser.add_argument('output');parser.add_argument('count',type=int)
parser.add_argument('--fuel-energy',type=int,default=0,help='Fractional fuel energy (tank +AA)');parser.add_argument('--fuel-stock',type=int,help='Override whole Fuel Tank stock');args=parser.parse_args();assert 1<=args.count<=48
root=Path(__file__).resolve().parent.parent
m,c,p=Memory(),CPU(),PortIO();p.mem=m;h=InterruptHandler(m,c,str(root/'earth'),p)
load_state(args.checkpoint,c,m,p,h);ds=0x4fc80
player=m.read16(ds+0xcab8)+16*m.read16(ds+0xcaba)
m.write16(player+0xaa,args.fuel_energy)
items=m.read16(player+0xb2)+16*m.read16(player+0xb4)
for i in range(48):m.write16(items+2*i,(1+i*17)%99+1 if i<args.count else 0)
if args.fuel_stock is not None:m.write16(items+2*m.read16(ds+0xd564),args.fuel_stock)
save_state(args.output+'-injected.state',c,m,p,h)
previous=args.output+'-injected.state'
for name,x in [('misc',222),('ready',201)]:
 prefix=args.output+'-'+name
 subprocess.run(['python3',str(root/'disasm/capture_shop_click.py'),previous,prefix,str(x),'240'],check=True)
 previous=prefix+'.state'
print('Input-ready rendering fixture:',previous)
