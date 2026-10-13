import assert from 'node:assert/strict';
import { config } from '../web/js/config.js';
import { seedRandom, random } from '../web/js/utils.js';
import { initGameRound, game, gameTick, STATE, prepareRoundBackground } from '../web/js/game.js';
import { players, getTankPlacementX, resetAndPlaceTanks } from '../web/js/tank.js';
import { reinitTerrainBuffers, generateTerrain } from '../web/js/terrain.js';
import { shuffledRoundOrder } from '../web/js/turn-order.js';
Object.assign(config, { numPlayers: 5, playOrder: 3, wallType: 0, changeWind: false });
reinitTerrainBuffers();
seedRandom(42);
prepareRoundBackground();generateTerrain();
const expected = shuffledRoundOrder(5, 3);
reinitTerrainBuffers();seedRandom(42);
initGameRound(Array.from({ length: 5 }, (_, i) => ({
  name: `Tank ${i}`, aiType: 0, colorIndex: i, tankType: i,
})));
game.state = STATE.ROUND_SETUP;gameTick();
for (const [slot, id] of expected.slots.entries()) {
  assert.equal(players[id].x, getTankPlacementX(slot, 5));
  assert.equal(players[id].name, `Tank ${id}`);
  assert.equal(players[id].tankType, id);
}
const order = [...expected.slots.slice(expected.start), ...expected.slots.slice(0, expected.start)];
assert.deepEqual(game.turnOrder, order);
assert.equal(game.currentPlayer, order[0]);
// A dead tank is skipped, including when wrapping. No extra shuffle RNG.
players[order[1]].alive = false;
seedRandom(123);
const nextRandom = random(65535);
seedRandom(123);
for (const id of [...order.slice(2), order[0], ...order.slice(2), order[0]]) {
  game.state = STATE.NEXT_TURN;
  game.nextTurnTimer = 15;
  gameTick();
  assert.equal(game.currentPlayer, id);
  assert.deepEqual(game.turnOrder, order);
}
assert.equal(random(65535), nextRandom);
// All identities return next round, retaining their inventory and new slots.
players[0].cash = 12345;
const slots = [...expected.slots].reverse();
resetAndPlaceTanks(slots);
for (const [slot, id] of slots.entries()) {
  assert.equal(players[id].alive, true);
  assert.equal(players[id].x, getTankPlacementX(slot, 5));
}
assert.equal(players[0].cash, 12345);
console.log('Round lifecycle preserves slot identities, skips dead tanks and wraps without RNG.');
