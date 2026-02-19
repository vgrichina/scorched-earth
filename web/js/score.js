// Scorched Earth - Scoring System (score.cpp RE)
// 3 modes: Standard (0), Corporate (1), Vicious (2)
// Per-damage scoring: +30x enemy weapon, +2x enemy shield, -15x friendly weapon, -1x friendly shield
// Per-death scoring: +4000 enemy, -2000 teammate, -1500 self

import { config } from './config.js';
import { players } from './tank.js';

// Scoring mode constants
export const SCORE_MODE = {
  STANDARD:  0,
  CORPORATE: 1,
  VICIOUS:   2,
};

// Called when damage is dealt (from RE: file 0x37688)
export function scoreOnDamage(attacker, target, damage, isDamageToShield) {
  if (!attacker || attacker === target) return;  // self-hits: no score change

  const multiplier = isDamageToShield ? (isEnemy(attacker, target) ? 2 : -1)
                                       : (isEnemy(attacker, target) ? 30 : -15);

  attacker.score += damage * multiplier;
}

// Called when a tank is destroyed (from RE: file 0x375E3)
export function scoreOnDeath(attacker, victim) {
  if (!attacker) return;

  if (attacker === victim) {
    attacker.score -= 1500;  // self-destruction
  } else if (isEnemy(attacker, victim)) {
    attacker.score += 4000;  // killed enemy
  } else {
    attacker.score -= 2000;  // killed teammate
  }
}

// End-of-round scoring pool (Standard and Corporate only, from RE: file 0x37381)
export function endOfRoundScoring(roundNumber) {
  if (config.scoringMode === SCORE_MODE.VICIOUS) return;

  const alive = players.filter(p => p.alive);
  if (alive.length === 0) return;

  // Pool calculation (from RE)
  const numPlayers = players.length;
  let pool = numPlayers * 1000 + roundNumber * 4000;

  for (const p of alive) {
    p.wins++;
    p.score += Math.floor(pool / Math.max(1, roundNumber));
  }
}

// Interest calculation between rounds
export function applyInterest() {
  for (const p of players) {
    const interest = Math.floor(p.cash * config.interest / 100);
    p.cash += interest;
  }
}

// Check if two players are enemies (no team system yet — all are enemies)
function isEnemy(a, b) {
  return a.index !== b.index;
}

// Get sorted leaderboard
export function getLeaderboard() {
  return [...players].sort((a, b) => b.score - a.score);
}
