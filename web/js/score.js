// Scorched Earth - Scoring System
// EXE source: score.cpp (seg 0x30B2, file base 0x36B20)
// EXE: scoreOnDamage at file 0x37688, scoreOnDeath at file 0x375E3
// EXE: normal round completion at file 0x37473 (caller 0x2AA7A)
// Scoring: Basic (0), Standard (1), Greedy (2); team mode is independent.
// Per-damage: +30x enemy weapon, +2x enemy shield, -15x friendly weapon, -1x friendly shield
// Per-death: Basic scoring → +4000 enemy kill; other scoring → +500
//            -2000 teammate kill, -1500 self-destruction
// DS:0x5148 is SCORING; DS:0x50EA is TEAM_MODE (config writer verified).

import { config } from './config.js';
import { players } from './tank.js';
import {getTeamScore} from './team-scoring.js';

// Scoring mode constants
export const SCORE_MODE = {
  BASIC:    0,
  STANDARD: 1,
  GREEDY:   2,
};

// EXE: score_on_damage at file 0x37688 — multiplier lookup per target relationship
// EXE: if Basic scoring (DS:0x5148 == 0): return — per-damage scoring only with Standard/Greedy scoring
export function scoreOnDamage(attacker, target, damage, isDamageToShield) {
  if (!attacker || attacker === target) return;  // self-hits: no score change
  if (config.scoringMode === SCORE_MODE.BASIC) return;  // EXE: per-damage scoring suppressed with Basic scoring

  const multiplier = isDamageToShield ? (isEnemy(attacker, target) ? 2 : -1)
                                       : (isEnemy(attacker, target) ? 30 : -15);

  addPlayerScore(attacker,damage * multiplier);
}

// EXE: score_on_death at file 0x375E3
// EXE: different_team → Standard/Greedy scoring ? +500 : +4000
export function scoreOnDeath(attacker, victim) {
  if (!attacker) return;

  if (attacker === victim) {
    addPlayerScore(attacker,-1500);  // self-destruction
  } else if (isEnemy(attacker, victim)) {
    // DS:0x5148 selects +4000 for Basic, +500 for Standard/Greedy.
    addPlayerScore(attacker,config.scoringMode !== SCORE_MODE.BASIC ? 500 : 4000);
  } else {
    addPlayerScore(attacker,-2000);  // killed teammate
  }
}

// Native 0x377D9 adds the same amount to the team when team mode is enabled.
function addPlayerScore(player,amount) {
  player.score+=amount;
  if(config.teamMode!==0)getTeamScore(player.team).score+=amount;
}

export function endOfRoundScoring(_roundNumber) {
  // Normal round completion calls 0x37473. E340 is the living-player count,
  // not the round number; the separate cleanup routine 0x37381 is not used.
  const winner=players.find(p=>p.alive);
  if(!winner)return;
  const bonus=config.scoringMode!==SCORE_MODE.BASIC?5000:players.length*1000;
  if(config.teamMode===0) {
    for(const player of players) {
      if(!player.alive)continue;
      player.wins++;
      addPlayerScore(player,bonus);
    }
    return;
  }
  // With teams enabled, reward the first surviving team. Membership
  // includes dead teammates, who receive half a share but no personal win.
  const members=players.filter(p=>p.team===winner.team);
  const team=getTeamScore(winner.team);
  team.wins++;
  team.score+=Math.trunc(bonus/10);
  const share=Math.trunc(bonus/members.length);
  for(const player of members) {
    if(player.alive)player.wins++;
    addPlayerScore(player,player.alive?share:Math.trunc(share/2));
  }
}

// Interest calculation between rounds
// EXE: "Earned interest" DS:0x235C shown in shop title bar (cash_display at file 0x16A7C)
export function applyInterest() {
  for (const p of players) {
    const interest = Math.floor(p.cash * config.interest / 100);
    p.earnedInterest = interest;  // saved for shop display
    p.cash += interest;
  }
}

// Native 0x324ED: no-team mode treats every other player as an enemy.
// Team modes 1/2 compare team numbers; mode 3 also turns the last team hostile.
export function isEnemy(a, b) {
  if (a.index === b.index) return false;
  if (config.teamMode === 0) return true;
  if (config.teamMode === 3 && new Set(players.filter(p=>p.alive).map(p=>p.team)).size === 1) return true;
  // Team identifiers are assigned when players are created.
  if (a.team !== undefined && b.team !== undefined) {
    return a.team !== b.team;
  }
  return true;
}

// Get sorted leaderboard
export function getLeaderboard() {
  return [...players].sort((a, b) => b.score - a.score);
}
