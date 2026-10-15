import assert from 'node:assert/strict';
import {config} from '../web/js/config.js';
import {menu,playerSetup,initPlayerSetup,menuTick} from '../web/js/menu.js';
import {game,STATE,initGameRound} from '../web/js/game.js';
import {players} from '../web/js/tank.js';
import {initInput} from '../web/js/input.js';
import {setRandomState,getRandomState} from '../web/js/utils.js';
const handlers={};
globalThis.window={addEventListener(type,handler){handlers[type]=handler;}};
initInput({addEventListener(){}});
config.numPlayers=2;
initPlayerSetup();menu.screen='player_setup';menu.playerSetupIdx=0;
function key(code,value=code) {
 handlers.keydown({code,key:value,preventDefault(){}});
 const result=menuTick();
 handlers.keyup({code,preventDefault(){}});
 return result;
}
function nameBob() {
 key('KeyB','B');key('KeyO','o');key('KeyB','b');key('Enter');
}
nameBob();
assert.equal(key('KeyD'),'player_setup');
assert.equal(menu.playerSetupIdx,1);
nameBob();key('Space',' ');
const words=Array(250).fill(0);words[1]=1;
setRandomState({index:0,words});
assert.equal(key('KeyD'),'start_game');
assert.deepEqual(playerSetup.map(p=>p.name),['Bob','Joe']);
assert.equal(getRandomState().index,2,'Bob collision rerolls to Joe before shopping');
initGameRound(playerSetup);
assert.equal(game.state,STATE.SHOP);
assert.deepEqual(players.map(p=>p.name),['Bob','Joe']);
assert.equal(players[0].aiType,0);
assert.equal(players[1].aiType,4);
console.log('Final Done resolves duplicate computer names before opening the initial shop.');
