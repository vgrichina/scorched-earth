#!/usr/bin/env python3
"""Compare R250 RNG: Python (matching EXE) vs emulator checkpoint state.

Given a seed, generates the R250 table and first N random values.
Can also read the R250 table from an emulator checkpoint and compare.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ---- Borland R250 in Python (matching EXE) ----

def lcg_step(lo, hi):
    """Borland LCG: seed32 = seed32 * 0x015A4E35 + 1, return (hi & 0x7FFF)"""
    seed32 = ((hi << 16) | lo) & 0xFFFFFFFF
    result = (seed32 * 0x015A4E35 + 1) & 0xFFFFFFFF
    return result & 0xFFFF, (result >> 16) & 0xFFFF, (result >> 16) & 0x7FFF

def r250_init(seed):
    lo, hi = seed & 0xFFFF, 0
    table = [0] * 250
    for i in range(250):
        lo, hi, val = lcg_step(lo, hi)
        table[i] = val
    for i in range(250):
        lo, hi, val = lcg_step(lo, hi)
        if val > 0x4000:
            table[i] |= 0x8000
    mask, and_mask = 0x8000, 0xFFFF
    for i in range(16):
        idx = i * 11 + 3
        table[idx] = (table[idx] & and_mask) | mask
        mask >>= 1
        and_mask >>= 1
    return [t & 0xFFFF for t in table], 0

def r250_next(table, index):
    j = index - 147 if index >= 147 else index + 103
    table[index] = (table[index] ^ table[j]) & 0xFFFF
    val = table[index]
    index = 0 if index >= 249 else index + 1
    return val, index

def random_val(table, index, max_val):
    if max_val == 0:
        return 0, index
    val, index = r250_next(table, index)
    return val % max_val, index

# ---- Read from emulator checkpoint ----

def read_checkpoint_r250(state_path):
    from emu.memory import Memory
    from emu.cpu import CPU
    from emu.ports import PortIO
    from emu.interrupts import InterruptHandler
    from emu.state import load_state

    mem = Memory()
    cpu = CPU()
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(state_path, cpu, mem, ports, int_handler)

    ds_base = cpu.segs[3] << 4
    # R250 table: 250 words at DS:0xEA12
    table = []
    for i in range(250):
        table.append(mem.read16(ds_base + 0xEA12 + i * 2))
    # Index at DS:0xEC06
    index = mem.read16(ds_base + 0xEC06)
    # LCG state at DS:0xC2E6 (lo), DS:0xC2E8 (hi)
    lcg_lo = mem.read16(ds_base + 0xC2E6)
    lcg_hi = mem.read16(ds_base + 0xC2E8)
    return table, index, lcg_lo, lcg_hi

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 disasm/compare_rng.py <seed> [count]       # generate sequence")
        print("  python3 disasm/compare_rng.py --state <file> [N]   # read from checkpoint + generate N values")
        sys.exit(1)

    if sys.argv[1] == '--state':
        state_path = sys.argv[2]
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        table, index, lcg_lo, lcg_hi = read_checkpoint_r250(state_path)
        print(f"R250 state from {state_path}:")
        print(f"  Index: {index}")
        print(f"  LCG: lo=0x{lcg_lo:04X} hi=0x{lcg_hi:04X}")
        print(f"  Table[0..9]: {[f'0x{t:04X}' for t in table[:10]]}")
        print(f"\nNext {count} random(100) values:")
        vals = []
        for _ in range(count):
            v, index = random_val(table, index, 100)
            vals.append(v)
        print(vals)
        # Output JS code to inject same state
        print(f"\n--- JS injection code (paste in browser console) ---")
        print(f"// Inject R250 state from emulator checkpoint")
        print(f"import('js/utils.js').then(m => {{")
        print(f"  // Set table and index directly (requires export)")
        print(f"  console.log('R250 state injection needs internal access');")
        print(f"}});")
    else:
        seed = int(sys.argv[1])
        count = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        table, index = r250_init(seed)
        print(f"R250 init with seed {seed}:")
        print(f"  Table[0..9]: {[f'0x{t:04X}' for t in table[:10]]}")
        vals = []
        for _ in range(count):
            v, index = random_val(table, index, 100)
            vals.append(v)
        print(f"  First {count} random(100): {vals}")

        # Output verification JS
        print(f"\n--- Browser console verification ---")
        print(f"seedRandom({seed});")
        print(f"let v = []; for(let i=0;i<{count};i++) v.push(random(100)); console.log(JSON.stringify(v));")
        print(f"// Expected: {vals}")

if __name__ == '__main__':
    main()
