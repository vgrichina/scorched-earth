"""Select the next native slot and draw its HUD after a compared shot.
The shot's outer turn stack is absent: re-enter the verified slot-advance
block with its current slot. Shield maintenance/input/round-end checks are
intercepted. The full HUD renderer runs. Wind/interstitials are not covered.
"""
import base64
from emu.execute import run_fast
from compare_pipeline import extract_display_pixels,write_emu_png

def compare_next_player_frame(cpu,mem,ports,handler,actual,output_dir):
 ds,stack=0x4FC80,0x5F4A0
 current=0xD568+actual['previousPlayer']*0xCA
 count=mem.read16(ds+0x50D4)
 slot=next(i for i in range(count) if mem.read16(ds+0xE4F6+i*4)==current)
 cpu.segs[:]=[0,0x200F,0x5F4A,0x4FC8]
 cpu.ip=0x2ABDA-0x6100-0x200F0;cpu.regs[4]=0x23D0;cpu.regs[5]=0x2400;cpu.regs[6]=slot
 mem.write16(ds+0x50EE,0)
 for _ in range(20):
  reason,_=run_fast(cpu,mem,ports,handler,2000000,bp_set={a-0x6100 for a in (0x2B405,0x238AE,0x28A80,0x2AB99)})
  address=cpu.segs[1]*16+cpu.ip+0x6100
  assert reason=='breakpoint',('next HUD',reason,hex(address))
  if address==0x2AB99:break
  if address==0x2B405:cpu.regs[0]=0
  sp=stack+cpu.regs[4]
  cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
 else:raise AssertionError('next-player HUD did not complete')
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
 assert rng==actual['rng'],'next-player RNG differs'
 print(f'Next player {selected}: complete HUD/world RGB and RNG match after slot selection and full HUD redraw.',flush=True)
