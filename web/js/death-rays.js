// Native death effect 5 growth (0x1E0F3..0x1E236). Cleanup and damage belong
// to the death dispatcher; each step emits the four symmetric ray sets.
import {config,GRAPHICS_MODES} from './config.js';
import {random,walkExeLine} from './utils.js';
import {PLAYFIELD_TOP} from './terrain.js';
import {getEffectiveWallType,WALL} from './physics.js';
import {setPaletteRgb} from './palette.js';
import {writeWorldPixel} from './projectile-render.js';

export function createDeathRays(x,y,roll=random) {
  const radius=45+roll(60);
  setPaletteRgb(250,63,45,20);
  return {x,y,radius,growth:5,angle:0};
}

export function stepDeathRays(rays,{roll=random,writePixel=writeWorldPixel,
  wrap=getEffectiveWallType()===WALL.WRAP}={}) {
  if (rays.growth>=rays.radius) return false;
  const aspect=GRAPHICS_MODES[config.graphicsMode].displayAspect;
  const scaleX=aspect<1?Math.trunc(aspect*65536):65536;
  const scaleY=aspect>1?Math.trunc(65536/aspect):65536;
  const emit=(x,y)=>{
    if (y<PLAYFIELD_TOP || y>config.screenHeight-4) return;
    if (x<3 || x>config.screenWidth-4) {
      if (!wrap) return;
      x+=x<3?config.screenWidth-6:-(config.screenWidth-6);
    }
    // Even duplicate center/axis pixels consume another random value.
    if (roll(4)===2) writePixel(x,y,250);
  };
  for(let ray=0;ray<4;ray++) {
    const radians=rays.angle*0.017453293; // Native double at DS:1BDC.
    const dx=Math.floor(Math.trunc(rays.growth*Math.cos(radians))*scaleX/65536);
    const dy=Math.floor(Math.trunc(rays.growth*Math.sin(radians))*scaleY/65536);
    rays.angle+=roll(30);
    if (rays.angle>90) rays.angle-=90;
    walkExeLine(0,0,dx,dy,(x,y)=>{
      emit(rays.x+x,rays.y+y);
      emit(rays.x+x,rays.y-y);
      emit(rays.x-x,rays.y+y);
      emit(rays.x-x,rays.y-y);
    });
  }
  rays.growth+=2;
  return true;
}
