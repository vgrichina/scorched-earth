import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {game,gameTick,initGameRound,STATE} from '../web/js/game.js';
import {players} from '../web/js/tank.js';
import {terrainBitmap,reinitTerrainBuffers} from '../web/js/terrain.js';
import {seedRandom,getRandomState} from '../web/js/utils.js';
import {initInput} from '../web/js/input.js';
const handlers={};
globalThis.window={addEventListener(type,handler){handlers[type]=handler;}};
initInput({addEventListener(){}});
function key(code){
  handlers.keydown({code,key:code,preventDefault(){}});
  gameTick();
  handlers.keyup({code,preventDefault(){}});
}
Object.assign(config,{numPlayers:2,playMode:0,playOrder:0,skyType:1,wallType:0,wind:0});
reinitTerrainBuffers();seedRandom(42);
const before=getRandomState();game.round=1;
initGameRound([{name:'Alice',aiType:0,colorIndex:0,tankType:3},
               {name:'Bob',aiType:0,colorIndex:1,tankType:3}]);
assert.equal(game.state,STATE.SHOP);
assert.deepEqual(getRandomState(),before,'Opening human shops must not generate terrain or shuffle slots');
assert.equal(terrainBitmap.some(Boolean),false);
assert.deepEqual(game.turnOrder,[]);
const cash=players[0].cash;
key('Enter'); // Buy the selected weapon using the real shop input path.
assert(players[0].cash<cash);
const bought=[...players[0].inventory],cashAfter=players[0].cash;
key('KeyD'); // Alice finishes.
assert.equal(game.shopPlayerIdx,1);
assert.equal(game.state,STATE.SHOP);
key('Space'); // Bob dismisses the privacy screen.
key('KeyD'); // Bob finishes.
assert.equal(game.state,STATE.ROUND_SETUP);
assert.equal(terrainBitmap.some(Boolean),false);
assert.deepEqual(getRandomState(),before);
gameTick();
assert.equal(game.state,STATE.TERRAIN_REVEAL);
assert.equal(game.round,1,'First setup must not skip to round 2');
assert(terrainBitmap.some(Boolean));
assert.equal(players[0].cash,cashAfter);
assert.deepEqual(players[0].inventory,bought);
assert(players.every(p=>p.y>38));
assert.equal(game.turnOrder.length,2);
assert.equal(game.currentPlayer,game.turnOrder[0]);
game.state=STATE.ROUND_SETUP;gameTick();
assert.equal(game.round,2);
assert.equal(players[0].cash,cashAfter);
assert.deepEqual(players[0].inventory,bought);
console.log('Initial human shops defer landscape/placement until Done and preserve purchases into rounds 1 and 2.');
