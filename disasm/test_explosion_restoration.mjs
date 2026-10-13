import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {pixels,reinitFramebuffer} from '../web/js/framebuffer.js';
import {terrainBitmap,reinitTerrainBuffers} from '../web/js/terrain.js';
import {startExplosion,stepExplosion,isExplosionActive} from '../web/js/explosions.js';
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
