import {randomFraction} from './utils.js';

// Native 0x32D84, scaled by 400 at 0x2EB9D. Three random components are
// sampled; the first two are divided by their squared 3D length. Tiny lengths
// retry all three samples. Effect 10 folds negative vertical speed positive.
export function randomDeathVelocity(fraction=randomFraction) {
  let x,y,z,squared;
  do {
    x=fraction()-0.5;y=fraction()-0.5;z=fraction()-0.5;
    squared=x*x+y*y+z*z;
  } while (squared<0.001);
  return {vx:x/squared*400,vy:Math.abs(y/squared*400)};
}

// One native 30-tick update, after the timer gate at 0x2ECE6. Pixel callbacks
// use native palette indices; the runtime supplies its palette mapping.
export function stepDeathParticles(particles,io,{left=3,right=356,top=38,bottom=476,wrap=false}={}) {
  let active=false;
  for (const particle of particles) {
    if (particle.vx===2000) continue; // Native inactive sentinel, not zero speed.
    particle.vy-=40;
    let x=particle.x+particle.vx/70;
    const y=particle.y-particle.vy/70;
    active=true;
    // The EXE does not accumulate fractional position when both integer
    // coordinates remain unchanged; gravity still advances above.
    if (Math.trunc(x)===Math.trunc(particle.x) && Math.trunc(y)===Math.trunc(particle.y)) continue;
    if (y<top || y>bottom) x=-1000;
    else if (x<left || x>right) {
      if (!wrap) x=-1000;
      else x+=x<left?right-left+1:-(right-left+1);
    }
    if (x===-1000 || io.getPixel(Math.trunc(x),Math.trunc(y))<105) {
      if (particle.x>=left && particle.x<=right && particle.y>=top && particle.y<=bottom)
        io.erasePixel(Math.trunc(particle.x),Math.trunc(particle.y));
      particle.vx=2000;
      io.stopped?.(particle);
    } else {
      io.erasePixel(Math.trunc(particle.x),Math.trunc(particle.y));
      io.setPixel(Math.trunc(x),Math.trunc(y),particle.color);
    }
    particle.x=x;particle.y=y;
  }
  return active;
}
