"""Select the next native slot and draw its HUD after a compared shot.
The shot's outer turn stack is absent: re-enter the verified slot-advance
block with its current slot. Native round-end checks, shield maintenance,
idle input, wind redraw and full HUD rendering execute through human input
entry. The enclosing shot stack and round-over branch are not covered.
"""
import base64
from emu.execute import run_fast
from compare_pipeline import extract_display_pixels,write_emu_png

def compare_next_player_frame(cpu,mem,ports,handler,actual,output_dir):
 ds,stack=0x4FC80,0x5F4A0
 for x,y,color in actual['overwrites']:
  cpu.segs[:]=[0,mem.read16(ds+0xEEF6),0x5F4A,0x4FC8]
  cpu.ip=mem.read16(ds+0xEEF4);cpu.regs[4]=0x2400
  for i,v in enumerate((0x110,0x60,x,y,color)):mem.write16(stack+0x2400+i*2,v)
  reason,_=run_fast(cpu,mem,ports,handler,100000,bp_set={0x710})
  assert reason=='breakpoint',('wind overwrite',reason)
 # Native sequential fire wrapper calls the wind renderer at 0x307B9
 # after the shot returns, before the outer loop advances the player slot.
 cpu.segs[:]=[0,0x22CA,0x5F4A,0x4FC8]
 cpu.ip=0x28F1D-0x6100-0x22CA0;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={0x710})
 assert reason=='breakpoint',('post-shot wind',reason)
 wind=mem.read16(ds+0x515A)
 if wind>=32768:wind-=65536
 assert wind==actual['wind'],('post-shot wind',wind,actual['wind'])
 current=0xD568+actual['previousPlayer']*0xCA
 count=mem.read16(ds+0x50D4)
 slot=next(i for i in range(count) if mem.read16(ds+0xE4F6+i*4)==current)
 cpu.segs[:]=[0,0x200F,0x5F4A,0x4FC8]
 cpu.ip=0x2ABDA-0x6100-0x200F0;cpu.regs[4]=0x23D0;cpu.regs[5]=0x2400;cpu.regs[6]=slot
 mem.write16(ds+0x50EE,0)
 # No key held: execute the real native keyboard poll in direct-scan mode.
 for off,value in ((0x502E,0),(0x5030,0),(0xD0B8,0x80),(0xD0B2,0)):
  mem.write16(ds+off,value)
 reason,_=run_fast(cpu,mem,ports,handler,4000000,bp_set={0x2F550-0x6100,0x43080-0x6100})
 address=cpu.segs[1]*16+cpu.ip+0x6100
 assert reason=='breakpoint' and address==0x2F550,('next human input',reason,hex(address))
 assert actual['state']=='aim',('port did not enter human aim',actual['state'])
 assert [mem.read16(ds+0xD568+i*0xCA+0x98) for i in range(count)]==actual['shieldUses'],'next-turn shield reserves differ'
 selected=(mem.read16(ds+0x5182)-0xD568)//0xCA
 assert selected==actual['player'],(selected,actual['player'])
 native=extract_display_pixels(mem,ports);port=base64.b64decode(actual['pixels']);pal=actual['palette']
 to_port=lambda i:i-40 if 120<=i<150 else i+40 if 80<=i<=104 else i
 mapped=[pal[to_port(i)*3:to_port(i)*3+3] for i in range(256)]
 assert len(native)==len(port)==360*480
 diffs=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native,port)) if list(ports.palette[n])!=mapped[p]]
 if output_dir:
  for name,pixels,palette in [('emulator',native,ports.palette),('web',port,mapped)]:
   write_emu_png(dict(width=360,height=480,pixels=pixels,palette=palette),output_dir/f'next-player-{name}.png')
 assert not diffs,('next-player full RGB',len(diffs),diffs[:15])
 rng=dict(index=mem.read16(ds+0xEC06),words=[mem.read16(ds+0xEA12+i*2) for i in range(250)])
 assert rng==actual['rng'],('next-player RNG differs',rng['index'],actual['rng']['index'])
 print(f'Next player {selected}: complete HUD/world RGB and RNG match through wind redraw, real round/shield/input checks and next human input entry (wind {wind}).',flush=True)
