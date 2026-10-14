import assert from 'node:assert/strict';
import {createPlayers,players,stepFallingTanks,deathAnimations,fallingFlash} from '../web/js/tank.js';
import {pixels,setPixel} from '../web/js/framebuffer.js';
import {terrainBitmap} from '../web/js/terrain.js';
import {clearTerrainCollapse} from '../web/js/terrain-collapse.js';
import {config} from '../web/js/config.js';
import {game,gameTick,STATE} from '../web/js/game.js';

createPlayers(3);
config.numPlayers=3;
config.impactDamage=1;
clearTerrainCollapse();
terrainBitmap.fill(0);
pixels.fill(80);
players.forEach((p,i)=>{
  Object.assign(p,{x:i===2?200:50,y:i===0?100:101,energy:100,
    alive:true,falling:i===0,fallDamageAccum:i===0?60:0});
  p.inventory.fill(0);
});
setPixel(50,101,8); // Faller supported by victim.
setPixel(50,102,120);
setPixel(200,102,120);
const flashes=[];
let moving=stepFallingTanks();
while(fallingFlash.delay){
  flashes.push({delay:fallingFlash.delay,energy:players.map(p=>p.energy)});
  moving=stepFallingTanks();
}
assert.equal(moving,false);
assert.deepEqual(flashes,[
  {delay:5,energy:[40,-10,100]}, {delay:10,energy:[40,-10,100]},
  {delay:5,energy:[0,-10,100]}, {delay:10,energy:[0,-10,100]},
]);
assert.deepEqual(players.map(p=>p.energy),[0,-10,100]);
assert.deepEqual(players.map(p=>p.alive),[true,true,true]);
assert.equal(deathAnimations.length,0);

Object.assign(game,{state:STATE.EXPLOSION,afterFalling:true,currentPlayer:2,round:1});
gameTick();
assert.deepEqual(players.map(p=>p.alive),[false,true,true]);
assert.equal(deathAnimations.length,1);
assert.equal(players[0].pendingFallDeath,false);
assert.equal(players[1].pendingFallDeath,true);
gameTick();
assert.equal(deathAnimations.length,1);
assert.equal(game.state,STATE.EXPLOSION);
assert.equal(players[1].alive,true,'later victim stays alive throughout the first death effect');
// Finish a deterministic effect, then remove the later victim's support.
// Native drops that still-alive victim before dispatching its death.
deathAnimations[0].effect=0;
deathAnimations[0].cycle={frame:40,baseColor:0};
pixels.fill(80);
setPixel(200,102,120);
config.fallingTanks=true;
gameTick();
assert.equal(deathAnimations.length,0);
assert.equal(players[1].alive,true);
assert.equal(game.state,STATE.FALLING,'a death effect must be followed by another falling pass');
console.log('Lethal impact/crush preserve signed HP through falling; aftermath dispatches one death and retains later victims until their turn. Death-effect pixels are not covered.');
