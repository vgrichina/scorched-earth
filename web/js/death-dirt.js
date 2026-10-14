// Native death-mode path through 0x1C481. The same native routine also has
// projectile-only horizontal/downward paths, which are not death effect 6.
import {random} from './utils.js';

export function* deathDirtSequence(tank,io,{ground,maxY=479,top=38,
  left=3,right=356,fullHeight=false,wrap=false,sound=false,roll=random}={}) {
  const flash=prelude=>{
    const fraction=roll(100)/100;
    if(prelude && sound) {
      const frequency=100+roll(200);
      io.sound?.(frequency);
    }
    const rgb=tank.rgb.map((c,i)=>Math.trunc(c*fraction+(1-fraction)*ground[i]));
    io.palette(tank.baseColor+roll(5),rgb);
  };
  for(let i=0;i<50;i++) {flash(true);yield 'palette';}
  let low=tank.x-1,high=tank.x+1,lowSlope=.55,highSlope=.55,y=tank.y;
  let rows=fullHeight?maxY:Math.trunc(maxY/3);
  while(rows>0) {
    flash(false);
    for(let x=tank.x;x<=high;x++) {
      let px=x;
      if(wrap && x>right) {px=x-right+left-1;io.markDirty(left,right);}
      if(px<left || px>right) continue;
      const color=io.getPixel(px,y);
      if(color>=80 && color<=104) {
        high=px-1;
        if(high!==tank.x) highSlope=Math.abs((high-tank.x)/(y-tank.y));
      }
    }
    for(let x=tank.x;x>=low;x--) {
      // Native calculates a wrapped coordinate here, but then checks and
      // reads the original X. Preserve that asymmetry with the right side.
      if(wrap && x<left) io.markDirty(left,right);
      if(x<left || x>right) continue;
      const color=io.getPixel(x,y);
      if(color>=80 && color<=104) {
        low=x+1;
        if(low!==tank.x) lowSlope=Math.abs((low-tank.x)/(y-tank.y));
      }
    }
    io.markDirty(Math.trunc(low),Math.trunc(high));
    if(low===high) break;
    const width=Math.trunc(high-low+1);
    for(let i=0;i<Math.trunc(width/3);i++) {
      let x=Math.trunc(roll(width)+low);
      if(wrap) {
        if(x<left) x=right-(left-x-1);
        else if(x>right) x=x-right+left-1;
      }
      if(x>=left && x<=right) io.deposit(x,y);
    }
    low-=lowSlope;high+=highSlope;y--;
    if(y===top) rows=0;
    yield 'row';
    rows--;
  }
  io.markCircle(tank.x,16);
  io.eraseTank();
}
