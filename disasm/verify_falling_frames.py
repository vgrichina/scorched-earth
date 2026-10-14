"""Compare the native complete falling wrapper with two lifted tanks."""
import base64
import json
from emu.execute import run_fast
from emu.state import save_state
from compare_pipeline import extract_display_pixels,write_emu_png

def signed_energy(mem,base):
 value=mem.read16(base+0xA2)+(mem.read16(base+0xA4)<<16)
 return value-0x100000000 if value>=0x80000000 else value

def compare_falling(cpu,mem,ports,handler,actual,output_dir):
 ds=0x4FC80;stack=cpu.segs[2]*16
 cpu.segs[1]=0x1A05;cpu.ip=8;cpu.regs[4]=0x2400
 mem.write16(stack+0x2400,0x110);mem.write16(stack+0x2402,0x60)
 waits={0x4C117,0x104F6,0x28A80};stage=0;budgets=0;pending_landing=False
 for _ in range(10000):
  reason,_=run_fast(cpu,mem,ports,handler,10000000,bp_set={0x710,*[a-0x6100 for a in (0x20BDF,0x38502,0x201CF,0x31AE3,0x31AF8)],*[a-0x6100 for a in waits]})
  addr=cpu.segs[1]*16+cpu.ip
  if reason=='max_steps':
   budgets+=1;assert budgets<20,('falling instruction budget',hex(addr));continue
  assert reason=='breakpoint',(reason,hex(addr))
  if addr+0x6100 in waits:
   sp=stack+cpu.regs[4]
   if addr+0x6100==0x28A80:cpu.regs[0]=0x80
   cpu.ip=mem.read16(sp);cpu.segs[1]=mem.read16(sp+2);cpu.regs[4]+=4
   continue
  fading=addr==0x38502-0x6100
  lethal=addr+0x6100 in (0x31AE3,0x31AF8)
  done=addr==0x710
  rescanned=addr==0x201CF-0x6100
  if rescanned:
   moving=pending_landing and cpu.regs[0]>0
   pending_landing=False
  else:
   moving=not done and not fading and not lethal and cpu.regs[7]<sum(bool(mem.read16(ds+0xCE58+i*2)) for i in range(2))
   if addr==0x20BDF-0x6100:pending_landing=not moving
  if done or moving or fading or lethal:
   phase='aftermath' if done else 'shield' if fading else 'lethal' if lethal else 'falling'
   assert actual['phases'][stage]==phase,(stage,phase,actual['phases'])
   native=extract_display_pixels(mem,ports);port=base64.b64decode(actual['frames'][stage]);pal=actual['flightPalettes'][stage]
   mapped=[pal[(i-40 if 120<=i<150 else 120 if i==80 else i+40 if 87<=i<=103 else i)*3:][:3] for i in range(256)]
   diffs=[(i%360,i//360,n,p) for i,(n,p) in enumerate(zip(native,port)) if list(ports.palette[n])!=mapped[p]]
   if output_dir:
    output_dir.mkdir(parents=True,exist_ok=True)
    for name,pixels,palette in (('emulator',native,ports.palette),('web',port,mapped)):
     write_emu_png(dict(width=360,height=480,pixels=pixels,palette=palette),output_dir/f'fall-{stage:03d}-{phase}-{name}.png')
    if diffs:
     tanks=[]
     for i in range(2):
      base=ds+0xD568+i*0xCA
      energy=mem.read16(base+0xA2)+(mem.read16(base+0xA4)<<16)
      if energy>=0x80000000:energy-=0x100000000
      tanks.append(dict(x=mem.read16(base+14),y=mem.read16(base+16),energy=energy,
       alive=bool(mem.read16(base+0x18)),power=mem.read16(base+0x9E),
       shieldEnergy=mem.read16(base+0x96)))
     diagnostic=dict(frame=stage,phase=phase,nativePlayers=tanks,
      portFinalPlayers=actual['playerState'],differences=[dict(x=x,y=y,nativeIndex=n,
       portIndex=p,nativeRGB=list(ports.palette[n]),portRGB=mapped[p]) for x,y,n,p in diffs])
     (output_dir/f'fall-{stage:03d}-{phase}-diff.json').write_text(json.dumps(diagnostic,indent=2)+'\n')
   assert not diffs,(stage,phase,len(diffs),diffs[:12])
   print(f'Fall frame {stage}: {phase} RGB matches.',flush=True);stage+=1
  if done:
   assert stage==len(actual['frames'])
   native=[dict(x=mem.read16(ds+0xD568+i*0xCA+14),y=mem.read16(ds+0xD568+i*0xCA+16),energy=signed_energy(mem,ds+0xD568+i*0xCA),alive=bool(mem.read16(ds+0xD568+i*0xCA+0x18))) for i in range(2)]
   assert actual['playerState']==native,(actual['playerState'],native)
   if output_dir:save_state(output_dir/'after-falling.state',cpu,mem,ports,handler)
   print(f'{stage} two-tank RGB frames and final player states match.',flush=True);return
  if fading:cpu.regs[4]+=8;cpu.ip+=3
  else:run_fast(cpu,mem,ports,handler,1)
 raise AssertionError('falling wrapper did not return')
