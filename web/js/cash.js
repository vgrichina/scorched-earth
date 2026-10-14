// Native cash access/update: 0x172C8, 0x173F6 and 0x1760C.
import {addScoreNumber} from './score-number.js';
import {config} from './config.js';
import {getTeamScore} from './team-scoring.js';

function cashOwner(player) {
  const team=config.teamMode!==0?getTeamScore(player.team):null;
  return team?.type===2?team:player;
}
export function playerCash(player) { return cashOwner(player).cash??0; }
export function addPlayerCash(player,amount) {
  const owner=cashOwner(player);
  owner.cash=Math.max(0,addScoreNumber(owner.cash??0,amount));
}
