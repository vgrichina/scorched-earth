#!/usr/bin/env python3
"""Pixel-perfect comparison pipeline: emulator checkpoint → web port → diff.

Step 1: Extract VGA framebuffer + game state from emulator checkpoint
Step 2: Write state JSON for web_screenshot.mjs --from-state
Step 3: Run web_screenshot.mjs to render matching state
Step 4: Run compare_screenshots.py for pixel diff

Usage:
  python3 disasm/compare_pipeline.py scratch/game_playing.state
  python3 disasm/compare_pipeline.py scratch/menu.state --output-dir /tmp/compare
"""
import sys, os, json, subprocess, struct

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state


def extract_terrain_from_vga(pixels, width, height, palette, hud_bottom):
    """Extract terrain height array from VGA framebuffer.
    Scan each column from bottom up. Terrain is contiguous from the bottom;
    sky is contiguous from the top. The boundary is where palette indices
    transition from terrain gradient to sky gradient."""
    heights = []
    for x in range(width):
        # Sample bottom pixel (above UI border) to get terrain palette index
        bottom_px = pixels[(height - 4) * width + x]
        if bottom_px >= 150:
            # UI border at bottom of this column — no terrain
            heights.append(height)
            continue
        # Scan from bottom up: terrain is contiguous from bottom
        terrain_top = height
        for y in range(height - 4, hud_bottom - 1, -1):
            px = pixels[y * width + x]
            if px >= 150:
                continue  # UI border pixel
            # Terrain: same as bottom pixel or within ±30 and in range 80-149
            if px == bottom_px or (abs(px - bottom_px) < 30 and 80 <= px < 150):
                terrain_top = y
            else:
                break  # hit sky
        heights.append(terrain_top)
    return heights


def extract_state(state_path):
    """Extract full game state from emulator checkpoint."""
    mem = Memory()
    cpu = CPU()
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(state_path, cpu, mem, ports, int_handler)

    ds_base = cpu.segs[3] << 4
    width, height = ports.get_resolution()

    # Read palette
    palette = []
    for i in range(256):
        r, g, b = ports.palette[i]
        palette.append([r, g, b])

    # Read framebuffer pixels
    if hasattr(mem, 'vga_planes') and len(mem.vga_planes) == 4:
        plane_stride = width // 4
        pixels = []
        for y in range(height):
            for x in range(width):
                plane = x & 3
                offset = y * plane_stride + (x >> 2)
                if offset < len(mem.vga_planes[plane]):
                    pixels.append(mem.vga_planes[plane][offset])
                else:
                    pixels.append(0)
    else:
        pixels = []
        for y in range(height):
            for x in range(width):
                addr = 0xA0000 + y * width + x
                pixels.append(mem.read8(addr))

    # Game state
    num_players = mem.read16(ds_base + 0x50D4)
    wind = mem.read16(ds_base + 0x515A)
    if wind > 0x7FFF:
        wind -= 0x10000
    terrain_type = mem.read16(ds_base + 0x5110)
    layout_mode = mem.read16(ds_base + 0xED58)
    sky_type = mem.read16(ds_base + 0x5112)
    land_type = mem.read16(ds_base + 0x5114)

    # HUD area height (layout_mode 0 = spacious/25px, 1 = compact/17px)
    # EXE: HUD_Y stored at DS:0x518E
    hud_y = mem.read16(ds_base + 0x518E)
    playfield_top = mem.read16(ds_base + 0xEF40)  # SHIELD_DRAW_Y_MIN / playfield top

    # Tank data
    tanks = []
    for p in range(num_players):
        base = ds_base + 0xD568 + p * 0xCA
        tank = {
            'x': mem.read16(base + 0x0E),
            'y': mem.read16(base + 0x10),
            'alive': mem.read16(base + 0x18),
            'colorBase': mem.read16(base + 0x1A),
            'turretAngle': mem.read16(base + 0x92),
            'power': mem.read16(base + 0x02),
            'tankType': mem.read16(base + 0x12),
        }
        # Signed angle
        if tank['turretAngle'] > 0x7FFF:
            tank['turretAngle'] -= 0x10000
        tanks.append(tank)

    # Extract terrain heights from VGA pixels, skipping border columns
    # EXE: playfield border is 3px (pal 150/152/157) on each side
    # Columns 0-2 and W-3..W-1 are border, not terrain
    terrain_heights = extract_terrain_from_vga(
        pixels, width, height, palette, playfield_top
    )
    # Fix border columns: copy from nearest interior column
    for x in range(3):
        terrain_heights[x] = terrain_heights[3]
    for x in range(width - 3, width):
        terrain_heights[x] = terrain_heights[width - 4]

    return {
        'width': width,
        'height': height,
        'palette': palette,
        'pixels': pixels,
        'numPlayers': num_players,
        'wind': wind,
        'terrainType': terrain_type,
        'skyType': sky_type,
        'landType': land_type,
        'layoutMode': layout_mode,
        'hudY': hud_y,
        'playfieldTop': playfield_top,
        'tanks': tanks,
        'terrainHeights': terrain_heights,
    }


def write_emu_png(state, out_path):
    """Write emulator framebuffer as PNG (minimal, no dependencies)."""
    width, height = state['width'], state['height']
    pixels = state['pixels']
    palette = state['palette']

    # Build RGBA pixel data
    rgba = bytearray(width * height * 4)
    for i in range(width * height):
        idx = pixels[i]
        r6, g6, b6 = palette[idx]
        # VGA 6-bit to 8-bit
        r = (r6 << 2) | (r6 >> 4)
        g = (g6 << 2) | (g6 >> 4)
        b = (b6 << 2) | (b6 >> 4)
        rgba[i*4] = r
        rgba[i*4+1] = g
        rgba[i*4+2] = b
        rgba[i*4+3] = 255

    # Write minimal PNG
    import zlib
    def write_png(path, w, h, rgba_data):
        def chunk(ctype, data):
            c = ctype + data
            return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

        ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
        raw = b''
        for y in range(h):
            raw += b'\x00'  # filter none
            raw += bytes(rgba_data[y*w*4:(y+1)*w*4])
        idat = zlib.compress(raw, 9)

        with open(path, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n')
            f.write(chunk(b'IHDR', ihdr))
            f.write(chunk(b'IDAT', idat))
            f.write(chunk(b'IEND', b''))

    write_png(out_path, width, height, rgba)


def write_state_json(state, out_path):
    """Write state JSON for web_screenshot.mjs --from-state."""
    # Don't include raw pixels (too large) — just game state + terrain
    state_for_web = {
        'width': state['width'],
        'height': state['height'],
        'palette': state['palette'],
        'numPlayers': state['numPlayers'],
        'wind': state['wind'],
        'terrainType': state['terrainType'],
        'skyType': state['skyType'],
        'landType': state['landType'],
        'layoutMode': state['layoutMode'],
        'hudY': state['hudY'],
        'playfieldTop': state['playfieldTop'],
        'tanks': state['tanks'],
        'terrainHeights': state['terrainHeights'],
    }
    with open(out_path, 'w') as f:
        json.dump(state_for_web, f)


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 disasm/compare_pipeline.py <checkpoint.state> [--state menu|shop|game] [--output-dir DIR]")
        sys.exit(1)

    state_path = sys.argv[1]
    output_dir = '/tmp/compare'
    render_state = 'game'  # default: in-game rendering
    for i, arg in enumerate(sys.argv[2:], 2):
        if arg == '--output-dir' and i + 1 < len(sys.argv):
            output_dir = sys.argv[i + 1]
        elif arg == '--state' and i + 1 < len(sys.argv):
            render_state = sys.argv[i + 1]

    os.makedirs(output_dir, exist_ok=True)
    basename = os.path.splitext(os.path.basename(state_path))[0]

    print(f"[1/4] Extracting state from {state_path}...")
    state = extract_state(state_path)
    print(f"  Resolution: {state['width']}x{state['height']}")
    print(f"  Players: {state['numPlayers']}, Wind: {state['wind']}")
    print(f"  Terrain type: {state['terrainType']}, Playfield top: {state['playfieldTop']}")

    emu_png = os.path.join(output_dir, f'{basename}_emu.png')
    state_json = os.path.join(output_dir, f'{basename}_state.json')
    web_png = os.path.join(output_dir, f'{basename}_web.png')
    diff_png = os.path.join(output_dir, f'{basename}_diff.png')

    print(f"[2/4] Writing emulator PNG → {emu_png}")
    write_emu_png(state, emu_png)

    print(f"  Writing state JSON → {state_json}")
    write_state_json(state, state_json)

    print(f"[3/4] Rendering web port → {web_png}")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    web_screenshot = os.path.join(script_dir, 'web_screenshot.mjs')
    # render_state selects the web_screenshot.mjs renderer:
    #   'game' → renderFromState (terrain + tanks + HUD from emulator state)
    #   'menu' → renderMenu (main menu with terrain preview)
    #   'shop' → renderShop (weapon shop UI)
    cmd = ['node', web_screenshot, render_state, web_png, '--mode', '4']
    if render_state == 'game':
        cmd += ['--from-state', state_json]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
    else:
        print(f"  {result.stdout.strip()}")

    print(f"[4/4] Comparing pixels → {diff_png}")
    compare_script = os.path.join(script_dir, 'compare_screenshots.py')
    # Mask HUD text rows from diff (EXE framebuffer retains stale rendered values)
    mask_hud = state['playfieldTop'] if render_state == 'game' else 0
    compare_cmd = ['python3', compare_script, emu_png, web_png, diff_png]
    if mask_hud:
        compare_cmd += ['--mask-hud', str(mask_hud)]
    result = subprocess.run(compare_cmd, capture_output=True, text=True)
    print(f"  {result.stdout.strip()}")

    print(f"\n[4b/4] Comparing terrain shape...")
    shape_script = os.path.join(script_dir, 'compare_terrain_shape.py')
    result = subprocess.run(
        ['python3', shape_script, emu_png, web_png],
        capture_output=True, text=True
    )
    if result.stdout.strip():
        for line in result.stdout.strip().split('\n'):
            print(f"  {line}")

    print(f"\nOutputs in {output_dir}/:")
    print(f"  {basename}_emu.png  — emulator VGA capture")
    print(f"  {basename}_web.png  — web port render")
    print(f"  {basename}_diff.png — pixel diff overlay")
    print(f"  {basename}_state.json — extracted game state")


if __name__ == '__main__':
    main()
