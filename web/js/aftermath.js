// Native outer_sim_loop (0x23298). Callers complete each operation before
// resuming: a death may change another tank's HP or remove its support.
export function* aftermathSequence(players,{afterFalling=false}={}) {
  let repeat;
  do {
    if (!afterFalling) {
      yield {kind:'settle'};
      yield {kind:'fall'};
    }
    afterFalling=false;
    yield {kind:'settle'};
    repeat=false;
    for (let index=0;index<players.length;index++) {
      const player=players[index];
      if (!player.alive || player.energy>0) continue;
      yield {kind:'death',index};
      repeat=true;
      yield {kind:'settle'};
      yield {kind:'fall'};
      yield {kind:'settle'};
    }
  } while (repeat);
}
