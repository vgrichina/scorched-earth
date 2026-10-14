// Native death-effect palette prelude (0x1DF65), shared by effects 0..5.
// The death dispatcher owns sequencing, sound and the effect after this prelude.
import {palette6,setPaletteRgb} from './palette.js';
import {random} from './utils.js';

export function chooseDeathEffect(castleTerrain, roll = random) {
  let effect;
  do { effect=roll(11); } while (castleTerrain && effect===8);
  return effect;
}

// Native branches 1..3 use the already-scaled Missile/Baby Nuke/Nuke radii.
// Every blast deals damage; only the final blast requests immediate settling.
// The caller must complete each operation before advancing this sequence.
export function deathBlastSequence(effect, radii) {
  if (effect<1 || effect>3) throw new RangeError('Not a blast death effect');
  const sequence=[{kind:'palette'}];
  for (let i=0;i<effect;i++) {
    sequence.push({kind:'blast',radius:radii[i],settle:i===effect-1});
    if (i<effect-1) sequence.push({kind:'delay',duration:100});
  }
  sequence.push({kind:'erase'});
  return sequence;
}

export function createDeathPaletteCycle(baseColor) {
  return {baseColor,frame:0,frequency:1000};
}

export function stepDeathPaletteCycle(cycle) {
  if (cycle.frame>=40) return false;
  cycle.frequency+=200;
  if (cycle.frequency>4000) cycle.frequency=1000;
  // Native reads the current eight DAC entries each iteration, then rotates
  // the RGB triplets one entry toward the start (0x443B6 / 0x443EB).
  const saved=palette6.slice(cycle.baseColor*3,(cycle.baseColor+8)*3);
  for (let slot=0;slot<8;slot++) {
    const next=((slot+1)%8)*3;
    setPaletteRgb(cycle.baseColor+slot,...saved.slice(next,next+3));
  }
  cycle.frame++;
  return true;
}
