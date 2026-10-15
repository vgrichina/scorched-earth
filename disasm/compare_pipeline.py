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


def extract_terrain_from_vga(pixels, width, height, playfield_top):
    """Extract terrain height array from VGA framebuffer.
    Scan each column top-down from playfield_top. Terrain = palette 80-119
    (EXE ground colors). Sky = palette 120-149. UI = palette >= 150 (skip).
    Player colors = 0-79 (skip/treat as non-terrain).
    For columns fully covered by UI (no terrain visible), interpolate from neighbors."""
    heights = []
    for x in range(width):
        terrain_top = height  # default: no terrain visible
        for y in range(playfield_top, height):
            px = pixels[y * width + x]
            if px >= 150:
                continue  # UI overlay
            if 0 <= px < 80:
                continue  # player/tank colors
            if 80 <= px < 120:
                terrain_top = y
                break
            # 120-149 = sky — keep scanning down
        heights.append(terrain_top)

    # Interpolate columns that are fully UI-covered (height == screen height)
    # These occur under menu buttons. Fill from nearest visible neighbor.
    for x in range(width):
        if heights[x] >= height:
            # Find nearest column with visible terrain
            left = right = None
            for dx in range(1, width):
                if x - dx >= 0 and heights[x - dx] < height:
                    left = heights[x - dx]
                    break
            for dx in range(1, width):
                if x + dx < width and heights[x + dx] < height:
                    right = heights[x + dx]
                    break
            if left is not None and right is not None:
                heights[x] = (left + right) // 2
            elif left is not None:
                heights[x] = left
            elif right is not None:
                heights[x] = right
    return heights


def extract_display_pixels(mem, ports):
    """Read the visible VGA page; Mode 13h uses linear memory, Mode X planes."""
    width, height = ports.get_resolution()
    if ports.vesa_mode:
        return list(mem.vesa_vram[ports.vesa_start:ports.vesa_start + width * height])
    if not ports.mode_x:
        return list(mem.data[0xA0000:0xA0000 + width * height])
    start = (ports.crtc_regs[0x0C] << 8) | ports.crtc_regs[0x0D]
    stride = width // 4
    return [mem.vga_planes[x & 3][offset] if offset < mem.VGA_PLANE_SIZE else 0
            for y in range(height) for x in range(width)
            for offset in [start + y * stride + (x >> 2)]]


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

    # Capture the displayed page, not whichever page happens to start at zero.
    pixels = extract_display_pixels(mem, ports)

    # Game state
    num_players = mem.read16(ds_base + 0x50D4)
    wind = mem.read16(ds_base + 0x515A)
    if wind > 0x7FFF:
        wind -= 0x10000
    terrain_type = mem.read16(ds_base + 0x5110)
    layout_mode = mem.read16(ds_base + 0xED58)
    # Sky dispatch reads DS:5110 (0x39796 / 0x3AB39); DS:5112 is explosion scale.
    sky_type = terrain_type
    land_type = mem.read16(ds_base + 0x5114)

    # HUD area height (layout_mode 0 = spacious/25px, 1 = compact/17px)
    # EXE: HUD_Y stored at DS:0x518E
    hud_y = mem.read16(ds_base + 0x518E)
    playfield_top = mem.read16(ds_base + 0xEF40)  # SHIELD_DRAW_Y_MIN / playfield top

    # Round number
    round_number = mem.read16(ds_base + 0xE340)
    num_rounds = mem.read16(ds_base + 0x5160)
    current_ptr = (mem.read16(ds_base + 0x5184) << 4) + mem.read16(ds_base + 0x5182)
    current_offset = current_ptr - (ds_base + 0xD568)
    current_player = current_offset // 0xCA if current_offset >= 0 and current_offset % 0xCA == 0 else None
    if current_player is not None and current_player >= num_players:
        current_player = None
    arms_level = mem.read16(ds_base + 0x518A)
    weapon_count = mem.read16(ds_base + 0x1BB6)

    def bignum(address):
        obj=mem.read16(address)+16*mem.read16(address+2)
        if not obj or obj+8>len(mem.data):return None
        limbs=mem.read16(obj)+16*mem.read16(obj+2);count=mem.read16(obj+4)
        if not limbs or not 0<count<16 or limbs+2*count>len(mem.data):return None
        value=0
        for i in range(count):value=(value<<16)|mem.read16(limbs+2*i)
        if mem.read16(limbs)&0x8000:value-=1<<(16*count)
        return value
    teams=[dict(type=mem.read16(ds_base+0xe1ec+22*i+2),
                cash=bignum(ds_base+0xe1ec+22*i+0xe),
                earnedInterest=bignum(ds_base+0xe1ec+22*i+0x12)) for i in range(num_players)]

    # Tank data
    tanks = []
    for p in range(num_players):
        base = ds_base + 0xD568 + p * 0xCA

        # Player name: sub-struct +0xB6/+0xB8 is far pointer to name string
        name_off = mem.read16(base + 0xB6)
        name_seg = mem.read16(base + 0xB8)
        name_phys = (name_seg << 4) + name_off
        name_bytes = bytes([mem.read8(name_phys + i) for i in range(20)])
        name = name_bytes.split(b'\x00')[0].decode('ascii', errors='replace')

        tank = {
            'x': mem.read16(base + 0x0E),
            'y': mem.read16(base + 0x10),
            'alive': mem.read16(base + 0x18),
            'colorBase': mem.read16(base + 0x1A),
            'turretAngle': mem.read16(base + 0x92),
            'power': mem.read16(base + 0x9E),
            'tankType': mem.read16(base),
            'weaponIdx': mem.read16(base + 0x26),
            'name': name,
        }
        # Renderer consumes mutable barrel geometry and cached endpoint (0x3FB27).
        signed16 = lambda value: value if value < 0x8000 else value - 0x10000
        tank['direction'] = signed16(mem.read16(base + 0x94))
        tank['barrelXOff'] = signed16(mem.read16(base + 4))
        tank['barrelYOff'] = signed16(mem.read16(base + 6))
        tank['barrelEndX'] = mem.read16(base + 0x12)
        tank['barrelEndY'] = mem.read16(base + 0x14)
        # Signed angle
        if tank['turretAngle'] > 0x7FFF:
            tank['turretAngle'] -= 0x10000

        tank['cash']=bignum(base+0xbe)
        tank['earnedInterest']=bignum(base+0xc2)
        tank['team']=mem.read16(base+0x30)
        tank['parachuteArmed']=bool(mem.read16(base+0x28))

        # Inventory: far pointer at sub+0xB2 → word array of weapon_count entries
        inv_off = mem.read16(base + 0xB2)
        inv_seg = mem.read16(base + 0xB4)
        inv_phys = (inv_seg << 4) + inv_off
        inventory = []
        for w in range(weapon_count):
            qty = mem.read16(inv_phys + w * 2)
            if qty > 0x7FFF:
                qty -= 0x10000
            inventory.append(qty)
        tank['inventory'] = inventory

        # Selected weapon for shop display
        tank['selectedWeapon'] = mem.read16(base + 0x16)

        # Shield energy
        tank['shieldEnergy'] = mem.read16(base + 0x96)
        tank['fuelEnergy'] = mem.read16(base + 0xAA)
        tank['activeShield'] = mem.read16(base + 0x22)
        shield_ptr = (mem.read16(base + 0xC8) << 4) + mem.read16(base + 0xC6)
        shield_weapon = mem.read16(shield_ptr + 0x0E)
        tank['shieldWeaponIdx'] = shield_weapon if shield_weapon < 0x8000 else shield_weapon - 0x10000
        tank['shieldMaxEnergy'] = mem.read16(shield_ptr + 2)
        tank['guidanceWeaponIdx'] = mem.read16(base + 0x9A)

        tanks.append(tank)

    # Extract terrain heights from VGA framebuffer pixels
    terrain_heights = extract_terrain_from_vga(
        pixels, width, height, playfield_top
    )

    # Player setup keeps uncommitted edits in dialog widgets, not tank structs.
    def far_pointer(address):
        return mem.read16(address) + (mem.read16(address + 2) << 4)

    player_setup = None
    human = bool(mem.read16(ds_base + 0xD0AC))
    dialog = far_pointer(ds_base + (0xD0A4 if human else 0xD0A0))
    if dialog and mem.read16(dialog + 0x20 + 4 * 5 + 2):
        human_dialog = far_pointer(ds_base + 0xD0A4)
        name_widget = far_pointer(human_dialog + 0x20 + 4 * 5)
        tank_widget = far_pointer(dialog + 0x20 + 4 * 4)
        type_widget = far_pointer(dialog + 0x20)
        if (mem.read16(name_widget) == 4 and mem.read16(tank_widget) == 6
                and mem.read16(type_widget) == 6):
            name_address = far_pointer(name_widget + 0x16)
            name = bytearray()
            for j in range(80):
                value = mem.read8(name_address + j)
                if not value:
                    break
                name.append(value)
            done_widget = far_pointer(dialog + 0x24)
            player_setup = dict(name=name.decode('ascii', errors='replace'),
                                doneEnabled=bool(mem.read16(done_widget + 2)),
                                tankType=mem.read16(tank_widget + 0x0E),
                                human=human)
            if not human:
                ai_widget = far_pointer(dialog + 0x20 + 4 * 5)
                player_setup['aiType'] = mem.read16(ai_widget + 0x0E) + 1
            # text editor 0x49F52 is modal. Its buffer at DS:F15A is copied
            # to widget+16 only on return to 0x46FC2; BP-6 holds cursor X.
            frame = cpu.regs[5]
            stack = cpu.segs[2] << 4
            for _ in range(32):
                address = stack + frame
                return_file = far_pointer(address + 2) + 0x6100
                if return_file == 0x46FC2 and far_pointer(address + 6) == dialog:
                    buffer = bytes(mem.data[ds_base + 0xF15A:ds_base + 0xF15A + 100])
                    player_setup['editName'] = buffer.split(b'\0', 1)[0].decode('ascii', errors='replace')
                    player_setup['cursorX'] = mem.read16(address - 6)
                    # The editor starts with SI=0 but does not clear F15A.
                    # Its cursor remains at the initial X until text is entered.
                    if player_setup['cursorX'] == mem.read16(address + 0x0A):
                        player_setup['editName'] = ''
                    break
                parent = mem.read16(address)
                if not frame < parent < 0xFFF0:
                    break
                frame = parent

    return {
        'playerSetup': player_setup,
        'teams': teams,
        'shopCategory': mem.read16(ds_base+0xcab4),
        'shopSelectedItem': ((mem.read16(ds_base+0xcab6)+0x8000)%0x10000-0x8000)+mem.read16(ds_base+0xcac2),
        'shopScrollOffset': mem.read16(ds_base+0xcac2),
        'teamMode': mem.read16(ds_base+0x50ea),
        'statusBar': mem.read16(ds_base+0x5142),
        'width': width,
        'height': height,
        'palette': palette,
        'pixels': pixels,
        'numPlayers': num_players,
        'currentPlayer': current_player,
        'wind': wind,
        'wallType': mem.read16(ds_base + 0x5156),
        'resolvedWallType': mem.read16(ds_base + 0x5154),
        'terrainType': terrain_type,
        'skyType': sky_type,
        'landType': land_type,
        'layoutMode': layout_mode,
        'hudY': hud_y,
        'playfieldTop': playfield_top,
        'tanks': tanks,
        'terrainHeights': terrain_heights,
        'roundNumber': round_number,
        'numRounds': num_rounds,
        'armsLevel': arms_level,
        'suspendDirt': 100-mem.read16(ds_base+0x5158),
        'uselessItems': mem.read16(ds_base+0x50fe),
        'tracePaths': mem.read16(ds_base+0x5168),
        'fallingTanks': mem.read16(ds_base+0x5162),
        'tunneling': mem.read16(ds_base+0x513a),
        'playMode': mem.read16(ds_base+0x5188),
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
        'playerSetup': state['playerSetup'],
        'teams': state['teams'],
        'shopCategory': state['shopCategory'],
        'shopSelectedItem': state['shopSelectedItem'],
        'shopScrollOffset': state['shopScrollOffset'],
        'teamMode': state['teamMode'],
        'statusBar': state['statusBar'],
        'width': state['width'],
        'height': state['height'],
        'palette': state['palette'],
        'numPlayers': state['numPlayers'],
        'currentPlayer': state['currentPlayer'],
        'wind': state['wind'],
        'terrainType': state['terrainType'],
        'skyType': state['skyType'],
        'landType': state['landType'],
        'layoutMode': state['layoutMode'],
        'hudY': state['hudY'],
        'playfieldTop': state['playfieldTop'],
        'tanks': state['tanks'],
        'terrainHeights': state['terrainHeights'],
        'roundNumber': state['roundNumber'],
        'numRounds': state['numRounds'],
        'armsLevel': state['armsLevel'],
        'suspendDirt': state['suspendDirt'],
        'uselessItems': state['uselessItems'],
        'tracePaths': state['tracePaths'],
        'fallingTanks': state['fallingTanks'],
        'tunneling': state['tunneling'],
        'playMode': state['playMode'],
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
    cmd = ['node', web_screenshot, render_state, web_png]
    if render_state in ('game', 'shop', 'menu', 'player', 'player_setup'):
        cmd += ['--from-state', state_json]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
        sys.exit(result.returncode)
    else:
        print(f"  {result.stdout.strip()}")

    print(f"[4/4] Comparing pixels → {diff_png}")
    compare_script = os.path.join(script_dir, 'compare_screenshots.py')
    compare_cmd = [sys.executable, compare_script, emu_png, web_png, diff_png]
    result = subprocess.run(compare_cmd, capture_output=True, text=True)
    print(f"  {result.stdout.strip()}")
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    comparison_status = result.returncode

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
    sys.exit(comparison_status)


if __name__ == '__main__':
    main()
