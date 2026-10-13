import { random, randomFraction } from './utils.js';

// EXE 0x29488: explicit Cavern bypasses the probability draw. All other
// settings draw before checking file availability; equality selects scanned.
// EXE 0x3343A then selects the file with the integer RNG.
export function selectScannedMountain(skyType, percent, fileCount) {
  if (skyType === 5) return -1;
  if (randomFraction() * 100 > percent || fileCount === 0) return -1;
  return random(fileCount);
}
