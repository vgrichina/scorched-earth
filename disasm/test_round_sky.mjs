import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {seedRandom} from '../web/js/utils.js';
import {initPalette, palette6} from '../web/js/palette.js';
import {initSkyBackground, reinitTerrainBuffers, generateTerrain, drawSky} from '../web/js/terrain.js';
import {pixels, reinitFramebuffer} from '../web/js/framebuffer.js';
import {initGameRound,game,gameTick,STATE} from '../web/js/game.js';
Object.assign(config,{numPlayers:2,wallType:0,wind:0,landType:2,playOrder:0});
for(const skyType of [2,3]) {
  config.skyType=skyType;reinitFramebuffer();reinitTerrainBuffers();seedRandom(42);
  game.round=1;initGameRound();game.state=STATE.ROUND_SETUP;gameTick();
  drawSky();const first=pixels.slice(),firstGround=[...palette6.slice(360,363)];
  const grounds=[firstGround];let changed=false;
  for(let round=0;round<3;round++) {
    game.state=STATE.ROUND_SETUP;gameTick();
    assert.equal(game.state,STATE.TERRAIN_REVEAL);
    drawSky();
    if(skyType===2) assert.deepEqual(pixels,first,'Consecutive Stars rounds must reuse their field');
    else changed ||= !pixels.every((value,i)=>value===first[i]);
    grounds.push([...palette6.slice(360,363)]);
  }
  assert(grounds.some(g=>String(g)!==String(firstGround)),'Round setup must select new ground colors');
  if(skyType===3) assert(changed,'Round setup must regenerate Storm clouds');
}
console.log('Game ROUND_SETUP refreshes ground/Storm and preserves consecutive Stars fields.');
