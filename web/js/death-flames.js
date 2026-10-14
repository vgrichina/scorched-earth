// Native effect 7 (0x24148), using native palette indices in the I/O adapter.
import {random} from './utils.js';
import {config,GRAPHICS_MODES} from './config.js';
import {getEffectiveWallType,WALL} from './physics.js';

// 0x43ACA callback circle. Unlike the protected-color circle, callback order
// is observable: the flame callback consumes RNG when it encounters soil.
export function walkDeathFlameCircle(cx,cy,radius,visit,{wrap=getEffectiveWallType()===WALL.WRAP}={}) {
  const aspect=GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const scaleX=aspect<1?Math.trunc(aspect*65536):65536;
  const scaleY=aspect>1?Math.trunc(65536/aspect):65536;
  const left=3,right=config.screenWidth-4;
  const scan=(halfWidth,offsetY)=>{
    const y=cy+Math.floor(offsetY*scaleY/65536);
    if(y<38 || y>config.screenHeight-4) return;
    let a=cx+Math.floor(-halfWidth*scaleX/65536);
    let b=cx+Math.floor(halfWidth*scaleX/65536);
    if(a<left) {
      if(wrap) for(let x=right-(left-a-1);x<=right;x++) visit(x,y);
      a=left;if(a>b) return;
    }
    if(b>right) {
      if(wrap) for(let x=b-right+left-1;x>=left;x--) visit(x,y);
      b=right;if(a>b) return;
    }
    for(let x=a;x<=b;x++) visit(x,y);
  };
  const emit=(h,w)=>{scan(h,w);scan(h,-w);scan(w,h);scan(w,-h);};
  let x=0,y=radius*2,error=0;
  while(x<=y) {
    if(!(x&1)) emit(x>>1,(y+1)>>1);
    error+=2*x+1;x++;
    if(error>0) {error-=2*y-1;y--;}
  }
  emit(x>>1,(y+1)>>1);
}

export function deathFlamePalette() {
  const colors=[];
  for(let i=0;i<10;i++) {
    colors[i]=[43+i*2,10+i,10+i];
    colors[10+i]=[43+i*2,10+i*2,10+i];
    colors[20+i]=[43+i*2,43+i*2,10+i];
  }
  return colors;
}

export function drawDeathFlameCircle(x,y,radius,color,io,roll=random,options) {
  walkDeathFlameCircle(x,y,radius,(px,py)=>{
    const old=io.getPixel(px,py);
    if(old>=105 && old<200) io.setPixel(px,py,color);
    else if(old>=80 && old<=104) io.setPixel(px,py,81+roll(5));
  },options);
}

export function* deathFlameSequence(x,y,io,{ground,roll=random}={}) {
  io.palette(81,Array.from({length:5},(_,i)=>ground.map(c=>Math.trunc((i+1)*c/6))));
  io.palette(170,deathFlamePalette());
  let cx=x;
  for(let flame=0;flame<6;flame++) {
    cx=x+roll(11)-5;
    const length=10+roll(10);
    for(let step=0;step<length;step++) {
      const remaining=length-step;
      for(let layer=0;layer<3;layer++) {
        if(remaining<=layer*2) break;
        io.circle(cx,y-step*2,(remaining-layer*2)>>1,199-layer*10);
        roll(50); // Sound choice consumes RNG even when sound is disabled.
      }
      cx+=roll(5)-2;
      yield 'flame';
    }
  }
  for(let i=0;i<50;i++) {
    io.cycle(170,30);
    yield 'cycle'; // Native delay occurs before this iteration's sound RNG.
    roll(50);
  }
  // Native uses the final drifting flame X, not the tank's original X.
  for(let py=y-40;py<=y+20;py++) for(let px=cx-40;px<=cx+40;px++) {
    if(io.getPixel(px,py)>=170) io.restorePixel(px,py);
  }
}
