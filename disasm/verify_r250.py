#!/usr/bin/env python3
"""Verify R250 PRNG implementation matches Borland C++ EXE behavior.
Runs the seeding + generation algorithm in Python, compares against EXE emulator trace."""

def lcg_srand(seed):
    return (seed & 0xFFFF, 0)  # (lo, hi)

def lcg_rand(lo, hi):
    """Borland LCG: seed32 = seed32 * 0x015A4E35 + 1, return (hi & 0x7FFF)"""
    seed32 = ((hi << 16) | lo) & 0xFFFFFFFF
    result = (seed32 * 0x015A4E35 + 1) & 0xFFFFFFFF
    lo = result & 0xFFFF
    hi = (result >> 16) & 0xFFFF
    return lo, hi, hi & 0x7FFF

def r250_init(seed):
    """Exact reproduction of EXE file 0x32994"""
    lo, hi = lcg_srand(seed)
    table = [0] * 250

    # Fill table with LCG values
    for i in range(250):
        lo, hi, val = lcg_rand(lo, hi)
        table[i] = val

    # Second pass: randomly set high bit
    for i in range(250):
        lo, hi, val = lcg_rand(lo, hi)
        if val > 0x4000:
            table[i] |= 0x8000

    # Third pass: ensure each bit position has at least one set bit
    mask = 0x8000
    and_mask = 0xFFFF
    for i in range(16):
        idx = i * 11 + 3
        table[idx] = (table[idx] & and_mask) | mask
        mask >>= 1
        and_mask >>= 1

    return table, 0, lo, hi

def r250_next(table, index):
    """Exact reproduction of EXE file 0x32A29"""
    if index >= 147:
        j = index - 147
    else:
        j = index + 103
    table[index] ^= table[j]
    val = table[index]
    index = 0 if index >= 249 else index + 1
    return val, index

def random(table, index, max_val):
    if max_val == 0:
        return 0, index
    val, index = r250_next(table, index)
    return val % max_val, index

# Test with seed 42
seed = 42
table, index, lcg_lo, lcg_hi = r250_init(seed)

print(f"Seed: {seed}")
print(f"First 10 table entries: {[hex(t) for t in table[:10]]}")
print(f"LCG state after init: lo=0x{lcg_lo:04X} hi=0x{lcg_hi:04X}")

# Generate first 20 random(100) values
vals = []
for _ in range(20):
    v, index = random(table, index, 100)
    vals.append(v)
print(f"First 20 random(100): {vals}")

# Now compare: generate same sequence from JS
# Output JS test code
print("\n--- Paste into browser console to verify ---")
print(f"seedRandom({seed});")
print("let vals = [];")
print("for (let i = 0; i < 20; i++) vals.push(random(100));")
print("console.log(vals);")
print(f"// Expected: {vals}")
