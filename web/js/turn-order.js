import { random } from './utils.js';

// EXE 0x2AE77 / 0x2AF29. Slot order is separate from the first turn.
export function shuffledRoundOrder(count, mode, lastFirst = -1) {
  const slots = Array.from({ length: count }, (_, i) => i);
  if (count < 2) return { slots, start: 0, lastFirst: mode === 3 ? 0 : lastFirst };
  for (let i = random(2); i < 50; i++) {
    const a = random(count);
    let b;
    do { b = random(count); } while (a === b);
    [slots[a], slots[b]] = [slots[b], slots[a]];
  }
  const start = mode === 3 && lastFirst >= 0
    ? slots.indexOf((lastFirst + 1) % count) : random(count);
  return { slots, start, lastFirst: mode === 3 ? slots[start] : lastFirst };
}

// EXE big-number subtraction (0x12978) zero-extends shorter operands and
// sign-extends the result at the longer operand's existing 16-bit limb width.
// Preserve its overflow behavior; ordinary JS subtraction changes rankings.
function scoreOperand(score) {
  const value = BigInt(Math.trunc(score));
  let bits = 16;
  while (BigInt.asIntN(bits, value) !== value) bits += 16;
  return { bits, value: BigInt.asUintN(bits, value) };
}

export function compareRoundPlayers(a, b) {
  const wins = ((a.wins - b.wins) << 16) >> 16;
  if (wins) return wins;
  const left = scoreOperand(a.score), right = scoreOperand(b.score);
  const difference = BigInt.asIntN(Math.max(left.bits, right.bits), left.value - right.value);
  // 0x12075 temporarily replaces the final limb with 0x8000 while stripping
  // leading FFFF words. Restoring a positive final limb loses the negative sign.
  const losesSign = difference >= -65536n && difference < -32768n;
  return difference < 0n && !losesSign ? -1 : 1;
}

// EXE 0x337C4 uses selection, not a general-purpose sort. Its comparator can
// overflow and returns +1 on equality, making algorithm choice observable.
export function roundOrder(players, mode, lastFirst = -1) {
  if (mode === 0 || mode === 3) return shuffledRoundOrder(players.length, mode, lastFirst);
  const count = players.length;
  const start = random(count);
  const ranked = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let best = -1;
    for (let candidate = 0; candidate < count; candidate++) {
      if (!used.has(candidate) && (best < 0 || compareRoundPlayers(players[best], players[candidate]) < 0)) best = candidate;
    }
    used.add(best);
    ranked.push(best);
  }
  if (mode === 1) ranked.reverse();
  const slots = new Array(count);
  ranked.forEach((id, i) => { slots[(i + start) % count] = id; });
  return { slots, start, lastFirst };
}
