#!/usr/bin/env python3
"""Generate terrain heights using EXE-exact R250 RNG + random walk kernel.
Compare against web port output for the same seed.

Usage:
  python3 disasm/compare_terrain.py <seed> [width] [height]
  python3 disasm/compare_terrain.py <seed> --compare <web_heights.json>
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare_rng import r250_init, random_val

def generate_rolling(seed, width=320, screen_height=200, land1=20, land2=20, flatland=0):
    """EXE random walk kernel (file 0x29808) with Rolling terrain params."""
    table, index = r250_init(seed)

    yStart = 26  # PLAYFIELD_TOP (HUD height)
    yEnd = screen_height - 1

    # Starting height
    r, index = random_val(table, index, yEnd - yStart - 60)
    y = r + yStart + 40

    walk_delta = 0
    heights = []

    for col in range(width):
        h = max(yStart + 20, min(int(y), yEnd - 1))
        heights.append(h)

        r100, index = random_val(table, index, 100)
        if r100 < land1:  # flat_chance: maintain momentum
            pass
        else:
            r3, index = random_val(table, index, 3)
            walk_delta = r3 - 1
            r100b, index = random_val(table, index, 100)
            if r100b < land2:  # bump_chance: amplify
                walk_delta *= 2

        if flatland and (walk_delta < -3 or walk_delta > 3):
            walk_delta = 0

        y += walk_delta

        if y < yStart + 40:
            y = yStart + 40
            if walk_delta < 0:
                walk_delta = 1
        if y > yEnd - 1:
            y = yEnd - 1
            if walk_delta > 0:
                walk_delta = 0

    return heights, table, index

def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 42
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 320
    height = int(sys.argv[3]) if len(sys.argv) > 3 else 200

    heights, _, _ = generate_rolling(seed, width, height)

    print(f"Seed={seed}, {width}x{height}")
    print(f"Heights[0..19]: {heights[:20]}")
    print(f"Heights range: {min(heights)}-{max(heights)}")

    # Output as JSON for comparison
    json_path = f'/tmp/terrain_exe_seed{seed}.json'
    with open(json_path, 'w') as f:
        json.dump({'seed': seed, 'width': width, 'height': height, 'heights': heights}, f)
    print(f"Saved to {json_path}")

    # Output JS verification code
    print(f"\n--- Browser console verification ---")
    print(f"// Open web/?seed={seed} and run in console:")
    print(f"import('./js/terrain.js').then(m => console.log(JSON.stringify(Array.from(m.terrain.slice(0, 20)))));")
    print(f"// Expected first 20: {heights[:20]}")

if __name__ == '__main__':
    main()
