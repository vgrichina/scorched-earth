// Native effect 8 terrain helpers (0x2BCC3 and 0x2BD07).
// Callbacks use native palette indices, before the port's sky/soil remapping.
import {random} from './utils.js';

export function scorchDeathPixel(x,y,{getPixel,setPixel},roll=random) {
  if (getPixel(x,y)<=105) setPixel(x,y,170+roll(5));
}

export function clearDeathScorchColumn(x,y,{getPixel,restorePixel},roll=random) {
  const offset=roll(9)-4;
  // The native negative branch compares x-offset <= x before its first
  // iteration. Negative offsets therefore do nothing; preserve that bug.
  for(let column=x;column<=x+offset;column++) {
    if (getPixel(column,y)<105) restorePixel(column,y);
  }
}

export function deathScorchPalette(ground) {
  const colors=[];
  for(let i=0;i<5;i++) colors.push(ground.map((c,channel)=>
    Math.trunc(((i+1)*(channel===0?63:20)+(4-i)*c)/5)));
  for(let i=0;i<10;i++) colors.push([63-i*5,63-i*5,63]);
  return colors.concat([[63,63,10],[63,43,10],[53,53,10],
    [63,63,30],[63,63,10],[63,63,10]]);
}

// Native 0x2BD89: rendering adapters supply tank and palette operations.
// Yields expose completed sink rows, the beam, and individual sparks; they do
// not imply a verified wall-clock duration for any of these operations.
export function* deathScorchSequence(tank,io,{top=38,bottom=476,
  ground=[0,0,0],roll=random}={}) {
  io.palette(deathScorchPalette(ground));
  let depth=bottom-tank.y;
  if(depth>10) depth-=5;
  let target=tank.y+roll(depth)+5;
  if(target>bottom || target<tank.y) target=bottom-5;
  io.eraseBarrel(tank);
  let primed=false;
  while(tank.y<=target) {
    const offset=roll(19);
    if(offset===0) {
      if(!primed) {primed=true;continue;}
      io.drawTank(tank,true);
      tank.y++;
      io.drawTank(tank,false);
      clearDeathScorchColumn(tank.x,tank.y,io,roll);
      for(let x=-6;x<6;x++) scorchDeathPixel(tank.x+x,tank.y+2,io,roll);
      for(let x=-4;x<4;x++) scorchDeathPixel(tank.x+x,tank.y+3,io,roll);
      primed=false;
      yield 'sink';
    } else {
      if(offset===1) scorchDeathPixel(tank.x+roll(25)-12,tank.y,io,roll);
      scorchDeathPixel(tank.x+offset-9,tank.y+(offset&1),io,roll);
    }
  }
  for(let offset=0;offset<6;offset++) {
    for(let y=target;y>top;y--) {
      if(io.getPixel(tank.x+offset,y)>105) io.setPixel(tank.x+offset,y,175+offset);
      if(offset!==0 && io.getPixel(tank.x-offset,y)>105)
        io.setPixel(tank.x-offset,y,175+offset);
    }
  }
  io.setupTank(tank);
  io.beginCycle(175,10);
  yield 'beam';
  for(let i=0;i<200;i++) {
    io.cycle(175,10);
    const x=tank.x+roll(21)-10;
    const y=roll(target-top-5)+top+5;
    const color=185+roll(6);
    io.setPixel(x,y,color);
    yield 'spark';
  }
  for(let y=bottom;y>=top;y--) {
    for(let x=tank.x-15;x<=tank.x+15;x++) {
      if(io.getPixel(x,y)>=170) io.restorePixel(x,y);
    }
  }
  io.markDirty(tank.x-15,tank.x+15);
}
