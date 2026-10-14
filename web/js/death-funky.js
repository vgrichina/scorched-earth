// Native Funky Bomb primitives, also used by death effect 4 (spread=-1).
import {random} from './utils.js';
import {bresenhamCircleFill} from './explosions.js';

export function funkyPalette() {
  const colors=[];
  for(const rgb of [[63,0,0],[63,32,10],[63,0,63],[63,12,12],[63,0,30]]) {
    for(let i=0;i<6;i++) colors.push(rgb.map(c=>Math.trunc(c*i/5)));
    for(let i=0;i<6;i++) colors.push(rgb.map(c=>Math.trunc(c*(5-i)/5)));
  }
  return colors;
}

export function chooseFunkyTargets(x,spread,{left=3,right=356,bottom=476,roll=random}={}) {
  const count=5+roll(6);
  return Array.from({length:count},()=>({
    x:spread===-1?left+roll(right-left):Math.max(left,Math.min(right,x+roll(spread*2)-spread)),
    y:bottom,
  }));
}

// 0x24CBF uses a 16.16 incremental quarter-ellipse, not projectile physics.
// Reads occur before viewport checks, and repeated integer positions are
// skipped. The saved collision point terminates a subsequent erase traversal.
export function traverseFunkyTrail(start,end,control,io,{left=3,right=356,
  top=38,bottom=476,color=254,hit={x:0,y:0}}={}) {
  let dx=(control.x-end.x)<<16,dy=(control.y-end.y)<<16;
  let ex=(control.x-start.x)<<16,ey=(control.y-start.y)<<16;
  const cx=((start.x<<16)-dx)|0,cy=((start.y<<16)-dy)|0;
  const extent=(Math.abs(dx)+Math.abs(ex)+Math.abs(dy)+Math.abs(ey))/65536;
  let threshold=804,shift=10;
  while(threshold>extent) {threshold=Math.trunc(threshold/2);shift--;}
  let remaining=(0x19220<<shift)>>16,previousX=-1,previousY=-1;
  for(;remaining>=0;remaining--) {
    const x=((cx+dx)|0)>>16,y=((cy+dy)|0)>>16;
    if(x!==previousX || y!==previousY) {
      const old=io.getPixel(x,y);
      if(old<105 || y<=top || y>bottom || x<=left || x>=right) {
        return {x,y:Math.min(y,bottom)};
      }
      if(x===hit.x && y===hit.y) return hit;
      if(color===120) io.restorePixel(x,y);
      else io.setPixel(x,y,color);
    }
    previousX=x;previousY=y;
    ex=(ex-(dx>>shift))|0;ey=(ey-(dy>>shift))|0;
    dx=(dx+(ex>>shift))|0;dy=(dy+(ey>>shift))|0;
  }
  return hit;
}

// 0x2476B grows from radius zero up to (but not including) the requested
// radius, preserving the two brighter indexed colors ahead of the new ring.
export function* drawFunkyBlast(x,y,radius,base,options={},roll=random) {
  for(let ring=0;ring<radius;ring++) {
    const color=base+6-Math.trunc(ring*6/radius);
    bresenhamCircleFill(x,y,ring,color,{...options,protectedMin:color+1,protectedMax:base+8});
    if(options.sound) roll(3000);
    yield ring;
  }
}
