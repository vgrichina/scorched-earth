#!/usr/bin/env python3
"""Dump complete game state from emulator checkpoint as JSON.
Used to initialize the web port for pixel-perfect comparison.

Usage:
  python3 disasm/dump_game_state.py <state_file> [output.json]
"""
import sys, os, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state

def read_farptr(mem, phys):
    off = mem.read16(phys)
    seg = mem.read16(phys + 2)
    return seg, off

def main():
    state_path = sys.argv[1] if len(sys.argv) > 1 else 'scratch/game_playing.state'
    output_path = sys.argv[2] if len(sys.argv) > 2 else '/tmp/game_state.json'

    mem = Memory()
    cpu = CPU()
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(state_path, cpu, mem, ports, int_handler)

    ds = cpu.segs[3]
    ds_base = ds << 4

    def ds_read16(off): return mem.read16(ds_base + off)
    def ds_read8(off): return mem.read8(ds_base + off)

    state = {}

    # Basic config
    state['numPlayers'] = ds_read16(0x50D4)
    state['windSpeed'] = ds_read16(0x515A)  # signed 16-bit
    if state['windSpeed'] > 0x7FFF: state['windSpeed'] -= 0x10000
    state['maxWind'] = ds_read16(0x515C)
    state['terrainType'] = ds_read16(0x5110)
    state['layoutMode'] = ds_read16(0xED58)
    state['hudY'] = ds_read16(0x518E)
    state['screenHeight'] = ds_read16(0xECB8)
    state['maxPower'] = ds_read16(0x50E4)
    state['playOrder'] = ds_read16(0x519C)
    state['wrapEnabled'] = ds_read16(0x510E)
    state['fallingTanks'] = ds_read16(0x5162)

    # Current player index
    state['currentPlayerIdx'] = ds_read16(0xCE96)

    # Ground color table (6 entries)
    state['groundColorTable'] = [ds_read8(0x5036 + i) for i in range(6)]

    # Terrain height array
    ptr_off = ds_read16(0x6242)
    ptr_seg = ds_read16(0x6244)
    height_phys = ptr_seg * 16 + ptr_off
    heights = []
    for x in range(320):
        h = mem.read16(height_phys + x * 2)
        if h > 0x7FFF: h -= 0x10000
        heights.append(h)
    state['terrainHeights'] = heights

    # Player structs (stride 0x6C = 108 bytes per player)
    # Player far ptrs at DS:CEB8 (array of far pointers)
    players = []
    for p in range(state['numPlayers']):
        p_off = ds_read16(0xCEB8 + p * 4)
        p_seg = ds_read16(0xCEB8 + p * 4 + 2)
        p_phys = p_seg * 16 + p_off

        player = {}
        # Key fields from player struct (108 bytes)
        # Offset 0x00: money (32-bit)
        player['money'] = mem.read16(p_phys) | (mem.read16(p_phys + 2) << 16)
        # Offset 0x08: power (16-bit)
        player['power'] = mem.read16(p_phys + 0x08)
        # Offset 0x0A: angle (16-bit signed)
        angle = mem.read16(p_phys + 0x0A)
        player['angle'] = angle if angle <= 0x7FFF else angle - 0x10000
        # Offset 0x0C: current weapon index
        player['weaponIdx'] = mem.read16(p_phys + 0x0C)
        # Offset 0x32: player name (null-terminated string, max 10 chars)
        name = []
        for i in range(10):
            c = mem.read8(p_phys + 0x32 + i)
            if c == 0: break
            name.append(chr(c))
        player['name'] = ''.join(name)
        # Offset 0x3C: is_dead flag
        player['isDead'] = mem.read16(p_phys + 0x3C)
        # Offset 0x40: color index
        player['colorIdx'] = mem.read16(p_phys + 0x40)

        players.append(player)
    state['players'] = players

    # Tank/sub structs (stride 0xCA = 202 bytes per tank)
    # Tank base at DS:D568
    tanks = []
    for p in range(state['numPlayers']):
        t_off = ds_read16(0xD568 + p * 4)
        t_seg = ds_read16(0xD568 + p * 4 + 2)
        t_phys = t_seg * 16 + t_off

        tank = {}
        # Offset 0x00: x position (16-bit)
        tank['x'] = mem.read16(t_phys + 0x00)
        # Offset 0x02: y position (16-bit)
        tank['y'] = mem.read16(t_phys + 0x02)
        # Offset 0x04: tank type (16-bit)
        tank['type'] = mem.read16(t_phys + 0x04)
        # Offset 0x06: alive flag
        tank['alive'] = mem.read16(t_phys + 0x06)

        tanks.append(tank)
    state['tanks'] = tanks

    # VGA palette (256 entries × 3 bytes RGB, 6-bit VGA values)
    palette = []
    for i in range(256):
        r = ports.dac_palette[i * 3] if hasattr(ports, 'dac_palette') else 0
        g = ports.dac_palette[i * 3 + 1] if hasattr(ports, 'dac_palette') else 0
        b = ports.dac_palette[i * 3 + 2] if hasattr(ports, 'dac_palette') else 0
        palette.append([r, g, b])
    state['palette'] = palette

    # HUD state
    state['hudTextColor'] = ds_read16(0xEF22)
    state['hudBgColor'] = ds_read16(0xEF28)

    # R250 RNG state (for future random calls)
    r250_table = [ds_read16(0xEA12 + i * 2) for i in range(250)]
    state['r250Table'] = r250_table
    state['r250Index'] = ds_read16(0xEC06)

    # Dump VGA framebuffer as flat array (320×200, palette indices)
    # This is the ground truth for pixel comparison
    vga_pixels = []
    for y in range(200):
        for x in range(320):
            vga_addr = 0xA0000 + y * 320 + x
            vga_pixels.append(mem.read8(vga_addr))
    state['vgaPixels'] = vga_pixels

    with open(output_path, 'w') as f:
        json.dump(state, f)

    print(f"Game state dumped to {output_path}")
    print(f"  Players: {state['numPlayers']}")
    print(f"  Wind: {state['windSpeed']}")
    print(f"  Terrain type: {state['terrainType']}")
    print(f"  Terrain heights[0..9]: {heights[:10]}")
    for i, (p, t) in enumerate(zip(players, tanks)):
        print(f"  Player {i}: {p['name']} @ ({t['x']},{t['y']}) pow={p['power']} ang={p['angle']} wpn={p['weaponIdx']} dead={p['isDead']}")

if __name__ == '__main__':
    main()
