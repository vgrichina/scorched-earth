import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {pixels,reinitFramebuffer} from '../web/js/framebuffer.js';
import {terrainBitmap,reinitTerrainBuffers} from '../web/js/terrain.js';
import {startExplosion,stepExplosion,isExplosionActive,applyExplosionDamage,resumeExplosionDamage} from '../web/js/explosions.js';
import {players,createPlayer} from '../web/js/tank.js';
import {shieldBreak,SHIELD_TYPE,drawShieldBreak} from '../web/js/shields.js';
Object.assign(config,{screenWidth:80,screenHeight:120,graphicsMode:4,wallType:1});
reinitFramebuffer();reinitTerrainBuffers();
for(const radius of [10,40]){
 terrainBitmap.fill(120);pixels.fill(120);let completed=0;
 startExplosion(3,76,radius,0,()=>{
  completed++;
  assert.equal(terrainBitmap[76*80+3],0,'completion ran before crater restoration');
 });
 let phases=0;
 while(isExplosionActive()){
  pixels.set(terrainBitmap);
  const active=stepExplosion();
  if(active){
   phases++;
   assert.equal(completed,0,'completion ran during animation');
   assert(terrainBitmap.every(c=>c===120),'terrain removed before animation completed');
  }
 }
 assert.equal(completed,1,'completion must run exactly once');
 assert.equal(phases,Math.ceil(radius/(radius<40?1:2))+(radius>30?50:0));
 assert.equal(terrainBitmap[76*80+3],0,'center not cleared');
 assert.equal(terrainBitmap[76*80+76],0,'wrapped spill not cleared');
 assert.equal(terrainBitmap[10*80+3],120,'HUD terrain modified');
 assert.equal(terrainBitmap[76*80+40],120,'outside footprint modified');
 assert.equal(pixels[76*80+3],0,'blast pixel not restored to sky');
}
console.log('Terrain remains intact during growth/cycling; final restoration clears center and wrapped spill only.');
// Centered Baby Missile requests 100 damage: survival, exact depletion, overflow.
for (const shieldEnergy of [150,100,55]) {
 const player=createPlayer(0,'Target');
 Object.assign(player,{x:40,y:76,activeShield:SHIELD_TYPE.TELEPORT,shieldEnergy});
 players.splice(0,players.length,player);shieldBreak.active=false;
 terrainBitmap.fill(120);pixels.fill(120);
 startExplosion(40,76,10,0,()=>applyExplosionDamage(40,76,10,0,2));
 while(isExplosionActive()) {
  pixels.set(terrainBitmap);stepExplosion();
  if(isExplosionActive()) {
   assert.equal(player.shieldEnergy,shieldEnergy,'shield damaged before restoration');
   assert.equal(shieldBreak.active,false,'shield break started before restoration');
  }
 }
 assert.equal(player.shieldEnergy,Math.max(0,shieldEnergy-100));
 assert.equal(shieldBreak.active,shieldEnergy<=100);
 if(shieldBreak.active)assert.equal(player.energy,100,'overflow must wait for shield fade');
 while(shieldBreak.active)drawShieldBreak();
 resumeExplosionDamage();
 assert.equal(player.energy,100-Math.max(0,100-shieldEnergy));
 assert.equal(player.activeShield,SHIELD_TYPE.TELEPORT,'native retains shield configuration');
}
console.log('Blast completion applies shield absorption and starts break animation on exact depletion or overflow.');
