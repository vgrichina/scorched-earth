// Test that web port terrain generation matches EXE for the same seed
// Run: node disasm/test_terrain_match.mjs
//
// We inline the web port's R250 RNG + rolling terrain generator to test standalone.

// --- R250 RNG (from web/js/utils.js) ---
let _lcgLo = 0, _lcgHi = 0;
function lcgSrand(seed) { _lcgLo = seed & 0xFFFF; _lcgHi = 0; }
function lcgRand() {
  const seed = (_lcgHi << 16 | _lcgLo) >>> 0;
  const result = (Math.imul(seed, 0x015A4E35) + 1) >>> 0;
  _lcgLo = result & 0xFFFF;
  _lcgHi = (result >>> 16) & 0xFFFF;
  return _lcgHi & 0x7FFF;
}
const _r250Table = new Uint16Array(250);
let _r250Index = 0;
function seedRandom(seed) {
  lcgSrand(seed & 0xFFFF);
  _r250Index = 0;
  for (let i = 0; i < 250; i++) _r250Table[i] = lcgRand();
  for (let i = 0; i < 250; i++) { if (lcgRand() > 0x4000) _r250Table[i] |= 0x8000; }
  let mask = 0x8000, andMask = 0xFFFF;
  for (let i = 0; i < 16; i++) {
    const idx = i * 11 + 3;
    _r250Table[idx] = (_r250Table[idx] & andMask) | mask;
    mask >>>= 1; andMask >>>= 1;
  }
}
function r250Next() {
  const j = _r250Index >= 147 ? _r250Index - 147 : _r250Index + 103;
  _r250Table[_r250Index] ^= _r250Table[j];
  const val = _r250Table[_r250Index];
  _r250Index = _r250Index >= 249 ? 0 : _r250Index + 1;
  return val;
}
function random(max) { return max === 0 ? 0 : r250Next() % max; }

function clamp(val, min, max) { return val < min ? min : val > max ? max : val; }

// --- Rolling terrain generator (from web/js/terrain.js) ---
function generateRolling(width, screenHeight, land1, land2, flatland) {
  const yStart = 26;  // PLAYFIELD_TOP
  const yEnd = screenHeight - 1;
  const terrain = new Uint16Array(width);

  let y = random(yEnd - yStart - 60) + yStart + 40;
  let walkDelta = 0;

  for (let col = 0; col < width; col++) {
    terrain[col] = clamp(Math.floor(y), yStart + 20, yEnd - 1);

    if (random(100) < land1) {
      // maintain momentum
    } else {
      walkDelta = random(3) - 1;
      if (random(100) < land2) {
        walkDelta *= 2;
      }
    }

    if (flatland && (walkDelta < -3 || walkDelta > 3))
      walkDelta = 0;

    y += walkDelta;

    if (y < yStart + 40) { y = yStart + 40; if (walkDelta < 0) walkDelta = 1; }
    if (y > yEnd - 1) { y = yEnd - 1; if (walkDelta > 0) walkDelta = 0; }
  }

  return terrain;
}

// --- Test ---
const seed = 42;
seedRandom(seed);
const terrain = generateRolling(320, 200, 20, 20, 0);

const expected = [71, 71, 69, 70, 70, 70, 70, 68, 66, 67, 67, 66, 68, 68, 68, 67, 67, 67, 67, 66];
const actual = Array.from(terrain.slice(0, 20));

console.log('Expected:', JSON.stringify(expected));
console.log('Actual:  ', JSON.stringify(actual));

const match = JSON.stringify(expected) === JSON.stringify(actual);
console.log(match ? 'PASS: Terrain heights match EXE' : 'FAIL: terrain mismatch');

if (!match) {
  // Show first divergence
  for (let i = 0; i < 20; i++) {
    if (expected[i] !== actual[i]) {
      console.log(`  First diff at col ${i}: expected=${expected[i]} actual=${actual[i]}`);
      break;
    }
  }
}

// Full comparison
const exeData = JSON.parse(await import('fs').then(fs => fs.readFileSync('/tmp/terrain_exe_seed42.json', 'utf8')));
let fullMatch = true;
let firstDiff = -1;
for (let i = 0; i < 320; i++) {
  if (terrain[i] !== exeData.heights[i]) {
    if (firstDiff < 0) firstDiff = i;
    fullMatch = false;
  }
}
if (fullMatch) {
  console.log('PASS: All 320 columns match!');
} else {
  console.log(`FAIL: First diff at col ${firstDiff}: exe=${exeData.heights[firstDiff]} web=${terrain[firstDiff]}`);
  let diffCount = 0;
  for (let i = 0; i < 320; i++) {
    if (terrain[i] !== exeData.heights[i]) diffCount++;
  }
  console.log(`  Total mismatches: ${diffCount}/320`);
}

process.exit(fullMatch ? 0 : 1);
