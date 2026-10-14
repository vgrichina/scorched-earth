import {config,GRAPHICS_MODES} from './config.js';
import {random} from './utils.js';
import {bresenhamCircleFill} from './explosions.js';

export function deathBurstPalette() {
  return Array.from({length:40},(_,index)=>{
    const value=Math.trunc((index<20?index:39-index)*63/19);
    return [value,value,value];
  });
}

// Native 0x3AF1F builds each burst from the center outward. Higher existing
// burst colors stop each scanline, preserving overlaps from earlier bursts.
export function drawDeathBurst({x,y,radius},options={}) {
  for (let ring=1;ring<=radius;ring++) {
    const color=220-Math.trunc(ring*20/radius);
    bresenhamCircleFill(x,y,ring,color,{...options,protectedMin:color+1,protectedMax:240});
  }
  const aspect=GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const scaleX=aspect<1?Math.trunc(aspect*65536):65536;
  const scaleY=aspect>1?Math.trunc(65536/aspect):65536;
  return {left:x+Math.floor(-radius*scaleX/65536),right:x+Math.floor(radius*scaleX/65536),
    top:y+Math.floor(-radius*scaleY/65536),bottom:y+Math.floor(radius*scaleY/65536)};
}

// Native effect 9 (0x3B07F): one central radius-30 burst followed by four
// randomly offset bursts at each radius from 20 down through 6.
export function* deathBurstSequence(x,y,roll=random) {
  yield {x,y,radius:30};
  const aspect=GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const scaleX=aspect<1?Math.trunc(aspect*65536):65536;
  const scaleY=aspect>1?Math.trunc(65536/aspect):65536;
  for (let radius=20;radius>5;radius--) {
    for (let burst=0;burst<4;burst++) {
      const distance=roll(40-radius);
      const angle=roll(360)*0.017453293;
      const dx=Math.trunc(Math.cos(angle)*distance);
      const dy=Math.trunc(Math.sin(angle)*distance);
      yield {x:x+Math.floor(dx*scaleX/65536),y:y+Math.floor(dy*scaleY/65536),radius};
    }
  }
}
