// Native 0x24894 sequence shared by Funky Bomb impacts and death effect 4.
// Callers await each damage operation before advancing, then execute the final
// ordinary explosion with settling. This generator does not erase a corpse.
import {startExplosion,stepExplosion,isExplosionActive,drawExplosion,applyExplosionDamage} from './explosions.js';
import {config,getActiveGraphicsMode} from './config.js';
import {getPixel,getBackgroundColor,setPixel} from './framebuffer.js';
import {terrain,terrainBitmap,PLAYFIELD_TOP} from './terrain.js';
import {setPaletteRgb} from './palette.js';
import {retainWorldPixel,projectileDrawing} from './projectile-render.js';
import {markTerrainCollapse,stepTerrainCollapse} from './terrain-collapse.js';
import {getEffectiveWallType,WALL} from './physics.js';
import {random} from './utils.js';
import {walkDeathFlameCircle} from './death-flames.js';
import {funkyPalette,chooseFunkyTargets,traverseFunkyTrail,drawFunkyBlast} from './death-funky.js';

export function* funkyBombStages(x,y,spread) {
  const origin={x,y};
  const targets=chooseFunkyTargets(origin.x,spread,{right:config.screenWidth-4,bottom:config.screenHeight-4});
  let colors=funkyPalette();
  const cycle=()=>{
    colors.push(colors.shift());
    colors.forEach((rgb,i)=>setPaletteRgb(170+i,...rgb));
  };
  setPaletteRgb(254,30,30,63);cycle();
  const options={right:config.screenWidth-4,bottom:config.screenHeight-4,top:PLAYFIELD_TOP};
  const restorePixel=(x,y)=>{
    if(x<3||x>config.screenWidth-4||y<PLAYFIELD_TOP||y>config.screenHeight-4) return;
    terrainBitmap[y*config.screenWidth+x]=0;
    retainWorldPixel(x,y,getBackgroundColor(y,x));
    if(terrain[x]===y)
      while(terrain[x]<config.screenHeight&&!terrainBitmap[terrain[x]*config.screenWidth+x]) terrain[x]++;
  };
  const io={getPixel:(x,y)=>{
    const c=getPixel(x,y);
    return c>=80&&c<110?c+40:c>=120&&c<=144?c-40:c;
  },setPixel:retainWorldPixel,restorePixel};
  const grow=(center,radius,base)=>{
    for(const _ of drawFunkyBlast(center.x,center.y,radius,base,
      {writePixel:retainWorldPixel,sound:!!config.soundEnabled})) {}
    const aspect=getActiveGraphicsMode().displayAspect;
    const scale=aspect<1?Math.trunc(aspect*65536):65536;
    const left=center.x+Math.floor(-radius*scale/65536),right=center.x+Math.floor(radius*scale/65536);
    markTerrainCollapse(left-1,right+1);
    if(getEffectiveWallType()===WALL.WRAP && (left<3||right>config.screenWidth-4))
      markTerrainCollapse(3,config.screenWidth-4);
    return {kind:'damage',...center,radius};
  };
  yield grow(origin,20,170);
  const scale=config.screenWidth<=320?[.5,.75,1][config.explosionScale]:[1,2,3][config.explosionScale];
  for(const [i,target] of targets.entries()) {
    target.control={x:(target.x+origin.x)>>1,y:PLAYFIELD_TOP};
    target.hit=traverseFunkyTrail(origin,target,target.control,io,options);
    target.radius=Math.trunc((15+random(10))*scale);
    yield grow(target.hit.y?target.hit:target,target.radius,170+(i%5)*12);
  }
  for(let i=0;i<80;i++) {cycle();yield {kind:'frame'};}
  for(const target of targets) {
    target.hit=traverseFunkyTrail(origin,target,target.control,io,{...options,color:120,hit:target.hit});
    cycle();yield {kind:'frame'};
  }
  for(const target of targets) {
    const center=target.hit.y?target.hit:target;
    walkDeathFlameCircle(center.x,center.y,target.radius,restorePixel);
  }
  yield {kind:'final',radius:Math.trunc(40*scale)};
}


// Weapon calls block the projectile loop until their entire native handler
// returns. Damage jobs may pause this sequence while a shield fades.
const impacts=[];
export function clearFunkyBombs() {impacts.length=0;}
export function isFunkyBombActive() {return impacts.length>0;}
export function startFunkyBomb(x,y,spread,attackerIndex) {
  impacts.push({x,y,attackerIndex,stages:funkyBombStages(x,y,spread),damageComplete:true});
}

export function stepFunkyBomb() {
  const anim=impacts[0];
  if(!anim) return false;
  drawFunkyBomb();
  if(anim.final) {
    if(isExplosionActive()) {stepExplosion();return true;}
    if(!anim.damageComplete) return true;
    anim.restoredPixels=null;
    if(stepTerrainCollapse()) return true;
    impacts.shift();
    return impacts.length>0;
  }
  if(!anim.damageComplete) return true;
  const next=anim.stages.next();
  if(next.done) throw new Error('Funky Bomb ended without its final explosion');
  const op=next.value;
  if(op.kind==='damage') {
    anim.damageComplete=false;
    applyExplosionDamage(op.x,op.y,op.radius,anim.attackerIndex,2,
      ()=>{anim.damageComplete=true;},{deferDeath:true});
  } else if(op.kind==='final') {
    anim.final=true;anim.damageComplete=false;
    startExplosion(anim.x,anim.y,op.radius,anim.attackerIndex,restored=>{
      anim.restoredPixels=restored;
      applyExplosionDamage(anim.x,anim.y,op.radius,anim.attackerIndex,7,
        ()=>{anim.damageComplete=true;},{deferDeath:true});
    },{captureRestoration:true});
    stepExplosion();
  }
  return true;
}

export function drawFunkyBomb() {
  const anim=impacts[0];
  if(!anim) return;
  projectileDrawing.draw();
  for(const [index,color] of anim.restoredPixels??[])
    setPixel(index%config.screenWidth,Math.floor(index/config.screenWidth),color);
  if(anim.final) drawExplosion();
}
