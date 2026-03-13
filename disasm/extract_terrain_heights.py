#!/usr/bin/env python3
"""Extract terrain height array from emulator VGA framebuffer.

The EXE stores terrain as filled columns with palette indices in the
terrain gradient range (VGA 120-149 for 30-color gradient). However,
the SKY also uses this range. The actual boundary is found by scanning
from the BOTTOM up — terrain pixels are contiguous from the bottom,
sky pixels are contiguous from the top.

Strategy: for each column x, scan from bottom upward. The terrain is
everything from the bottom that is NOT a UI border pixel (palette 150-159).
The sky-terrain boundary is where the palette index transitions from
terrain gradient (80-119 or 120-149 depending on config) to sky gradient.

Actually simpler: scan from playfield_top downward. The FIRST pixel whose
palette index is in the terrain color range (which we detect empirically)
is the terrain surface.

Usage:
  python3 disasm/extract_terrain_heights.py scratch/game_playing.state
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state


def main():
    state_path = sys.argv[1] if len(sys.argv) > 1 else 'scratch/game_playing.state'

    mem = Memory()
    cpu = CPU()
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(state_path, cpu, mem, ports, int_handler)

    ds_base = cpu.segs[3] << 4
    w, h = ports.get_resolution()
    playfield_top = mem.read16(ds_base + 0xEF40)

    # Read all pixels
    if hasattr(mem, 'vga_planes') and len(mem.vga_planes) == 4:
        plane_stride = w // 4
        def get_pixel(x, y):
            plane = x & 3
            offset = y * plane_stride + (x >> 2)
            if offset < len(mem.vga_planes[plane]):
                return mem.vga_planes[plane][offset]
            return 0
    else:
        def get_pixel(x, y):
            return mem.read8(0xA0000 + y * w + x)

    # Empirically determine which palette indices are "terrain"
    # Sample the bottom row (just above the UI border at y=h-3)
    # to find terrain palette indices
    terrain_sample_y = h - 4  # above bottom border
    terrain_indices = set()
    for x in range(w):
        px = get_pixel(x, terrain_sample_y)
        if px != 0:  # not black
            terrain_indices.add(px)

    # Remove known UI palette indices (150-163 are UI colors)
    terrain_indices -= set(range(150, 164))

    # Also sample mid-screen to get sky indices
    sky_sample_y = playfield_top + 2
    sky_indices = set()
    for x in range(w):
        px = get_pixel(x, sky_sample_y)
        if px != 0:
            sky_indices.add(px)

    # Terrain indices = those found at bottom but NOT in sky
    # (some indices like 80 are terrain-only)
    # But if terrain covers the full column, sky_indices might contain terrain too
    # Better approach: just use palette color analysis
    # Terrain colors are warm (brown/green), sky colors are cool (blue)

    # Actually, the simplest reliable method:
    # For each column, scan from bottom up. Skip UI border pixels (150+).
    # The terrain is contiguous from the bottom. When we hit a non-terrain pixel
    # (sky gradient), that's the boundary.

    # First, figure out what the terrain base palette index is
    # The EXE uses VGA 120+ for terrain gradient (30 entries)
    # But terrain_type affects which range is used
    terrain_type = mem.read16(ds_base + 0x5110)

    print(f"Resolution: {w}x{h}, Playfield top: {playfield_top}")
    print(f"Terrain type: {terrain_type}")
    print(f"Bottom-row palette indices: {sorted(terrain_indices)[:10]}...")
    print(f"Sky-row palette indices: {sorted(sky_indices)[:10]}...")

    # Extract heights: scan from bottom up for each column
    heights = []
    for x in range(w):
        # Start from bottom, skip UI border (last 3 rows)
        terrain_top = h  # default: no terrain
        for y in range(h - 4, playfield_top - 1, -1):
            px = get_pixel(x, y)
            # UI border pixels (150+) — skip
            if px >= 150:
                continue
            # Check if this pixel matches the terrain color at the bottom of this column
            bottom_px = get_pixel(x, h - 4)
            if bottom_px >= 150:
                # This column has UI at bottom, skip
                break
            # If pixel matches bottom pixel's color group, it's terrain
            # Terrain gradient: all same base hue, palette 120+offset or 80+offset
            # Sky: different palette range
            # Simple heuristic: if same as bottom pixel OR within ±30 of bottom pixel
            if px == bottom_px or (abs(px - bottom_px) < 30 and px >= 80 and px < 150):
                terrain_top = y
            else:
                break  # hit sky
        heights.append(terrain_top)

    print(f"Height range: {min(heights)} - {max(heights)}")
    print(f"Sample heights[0:20]: {heights[:20]}")

    # Output as JSON
    output = {
        'width': w,
        'height': h,
        'playfieldTop': playfield_top,
        'terrainType': terrain_type,
        'heights': heights,
    }

    out_path = state_path.replace('.state', '_terrain.json')
    if len(sys.argv) > 2:
        out_path = sys.argv[2]
    with open(out_path, 'w') as f:
        json.dump(output, f)
    print(f"Written {out_path}")


if __name__ == '__main__':
    main()
