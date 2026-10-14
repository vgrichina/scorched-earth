// Scorched Earth - Scoring System
// EXE source: score.cpp (seg 0x30B2, file base 0x36B20)
// EXE: scoreOnDamage at file 0x37688, scoreOnDeath at file 0x375E3
// EXE: normal round completion at file 0x37473 (caller 0x2AA7A)
// 3 modes: Standard (0), Corporate (1), Vicious (2)
// Per-damage: +30x enemy weapon, +2x enemy shield, -15x friendly weapon, -1x friendly shield
// Per-death: teams enabled → +500 enemy kill; teams disabled → +4000 enemy kill
//            -2000 teammate kill, -1500 self-destruction
// Teams: DS:0x5148 — when disabled (0, default), all players are enemies

import { config } from './config.js';
import { players } from './tank.js';

// Scoring mode constants
export const SCORE_MODE = {
  STANDARD:  0,
  CORPORATE: 1,
  VICIOUS:   2,
};

// EXE: score_on_damage at file 0x37688 — multiplier lookup per target relationship
// EXE: if teams_disabled (DS:0x5148 == 0): return — per-damage scoring only when teams enabled
export function scoreOnDamage(attacker, target, damage, isDamageToShield) {
  if (!attacker || attacker === target) return;  // self-hits: no score change
  if (!teamsEnabled()) return;  // EXE: per-damage scoring suppressed when teams disabled (default)

  const multiplier = isDamageToShield ? (isEnemy(attacker, target) ? 2 : -1)
                                       : (isEnemy(attacker, target) ? 30 : -15);

  attacker.score += damage * multiplier;
}

// EXE: score_on_death at file 0x375E3
// EXE: different_team → teams_enabled ? +500 : +4000
export function scoreOnDeath(attacker, victim) {
  if (!attacker) return;

  if (attacker === victim) {
    attacker.score -= 1500;  // self-destruction
  } else if (isEnemy(attacker, victim)) {
    // EXE: DS:0x5148 teams flag — +500 when teams enabled, +4000 when disabled
    attacker.score += teamsEnabled() ? 500 : 4000;
  } else {
    attacker.score -= 2000;  // killed teammate
  }
}

// Standard round awards are verified against 0x37473. The legacy nonstandard
// branches below still need replacement from their actual native callers.
const MAX_POWER = 100;
export function endOfRoundScoring(roundNumber) {
  // Normal round completion calls 0x37473 from 0x2AA7A. Standard scoring
  // awards a flat winner bonus; 0x37381 belongs to the separate cleanup path.
  if (config.scoringMode === SCORE_MODE.STANDARD) {
    const bonus = teamsEnabled() ? 5000 : players.length * 1000;
    for (const player of players) {
      if (!player.alive) continue;
      player.wins++;
      player.score += bonus;
    }
    return;
  }
  if (config.scoringMode === SCORE_MODE.VICIOUS) return;

  const alive = players.filter(p => p.alive);
  if (alive.length === 0) return;

  let pool;
  if (teamsEnabled()) {
    // EXE teams-enabled branch (file 0x37398): pool includes per-player contributions
    pool = roundNumber * 500 + 5000;
    for (const p of alive) {
      pool += MAX_POWER * 30;
      pool += (p.shieldEnergy || 0) * 2;
    }
  } else {
    // EXE teams-disabled branch (file 0x37412): flat pool based on player count
    pool = players.length * 1000 + roundNumber * 4000;
  }

  const share = Math.floor(pool / Math.max(1, roundNumber));
  for (const p of alive) {
    p.wins++;
    p.score += share;
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

// EXE: DS:0x5148 — teams enabled when any two players share a team number
// Currently no team assignment UI; each player is their own team → teamsEnabled() = false
function teamsEnabled() {
  // EXE checks DS:0x5148 != 0. Web port: check if any players share a team number.
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if (players[i].team === players[j].team) return true;
    }
  }
  return false;
}

// EXE: same_team at file 0x324ED — compares player.team_number (+0x30)
function isEnemy(a, b) {
  if (a.index === b.index) return false;
  // When teams exist, compare team numbers; otherwise all different players are enemies
  if (a.team !== undefined && b.team !== undefined) {
    return a.team !== b.team;
  }
  return true;
}

// Get sorted leaderboard
export function getLeaderboard() {
  return [...players].sort((a, b) => b.score - a.score);
}
