// Native team records at DS:E1EC, stride 0x16. Counts derive from the roster;
// wins and score persist across rounds and reset when new players are created.
export const teamScores=new Map();
export function resetTeamScores() { teamScores.clear(); }
export function getTeamScore(team) {
  if(!teamScores.has(team))teamScores.set(team,{wins:0,score:0});
  return teamScores.get(team);
}
