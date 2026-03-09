// Test that web port R250 matches Python (EXE) implementation
// Run: node disasm/test_rng_match.mjs

// Inline the R250 implementation from web/js/utils.js to test standalone
let _lcgLo = 0, _lcgHi = 0;

function lcgSrand(seed) {
  _lcgLo = seed & 0xFFFF;
  _lcgHi = 0;
}

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
  for (let i = 0; i < 250; i++) {
    if (lcgRand() > 0x4000) _r250Table[i] |= 0x8000;
  }
  let mask = 0x8000, andMask = 0xFFFF;
  for (let i = 0; i < 16; i++) {
    const idx = i * 11 + 3;
    _r250Table[idx] = (_r250Table[idx] & andMask) | mask;
    mask >>>= 1;
    andMask >>>= 1;
  }
}

function r250Next() {
  const j = _r250Index >= 147 ? _r250Index - 147 : _r250Index + 103;
  _r250Table[_r250Index] ^= _r250Table[j];
  const val = _r250Table[_r250Index];
  _r250Index = _r250Index >= 249 ? 0 : _r250Index + 1;
  return val;
}

function random(max) {
  if (max === 0) return 0;
  return r250Next() % max;
}

// Test with seed 42
seedRandom(42);
const expected = [58, 26, 38, 61, 74, 17, 13, 67, 74, 62];
const actual = [];
for (let i = 0; i < 10; i++) actual.push(random(100));

console.log('Expected:', JSON.stringify(expected));
console.log('Actual:  ', JSON.stringify(actual));

const match = JSON.stringify(expected) === JSON.stringify(actual);
console.log(match ? 'PASS: JS R250 matches Python/EXE' : 'FAIL: mismatch!');

// Test table state
seedRandom(42);
const tableHex = Array.from(_r250Table.slice(0, 10)).map(v => '0x' + v.toString(16).toUpperCase().padStart(4, '0'));
console.log('Table[0..9]:', tableHex);
const expectedTable = ['0xB8D0', '0x5DF8', '0x74E5', '0xD408', '0x49B6', '0xC4D8', '0x52D6', '0x9A79', '0xB192', '0x1746'];
const tableMatch = JSON.stringify(tableHex) === JSON.stringify(expectedTable);
console.log(tableMatch ? 'PASS: Table init matches' : 'FAIL: table mismatch!');

// Extended test: 1000 values
seedRandom(42);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += random(1000);
console.log('Sum of 1000 random(1000):', sum);

process.exit(match && tableMatch ? 0 : 1);
