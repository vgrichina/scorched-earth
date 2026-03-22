#!/usr/bin/env python3
"""Dump complete game state from emulator checkpoint as JSON.
Used to initialize the web port for pixel-perfect comparison.

Usage:
  python3 disasm/dump_game_state.py <state_file> [output.json]

Output JSON has two main uses:
  1. renderFromState() — in-game playfield rendering (terrain, tanks, HUD)
  2. renderShopFromState() — shop UI rendering (cash, inventory, rounds)
"""
import sys, os, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.state import load_state

SUB_STRIDE = 0xCA
SUB_BASE_DS = 0xD568
WEAPON_COUNT = 48

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
    def ds_read16s(off):
        v = ds_read16(off)
        return v if v <= 0x7FFF else v - 0x10000

    state = {}

    state['numPlayers'] = ds_read16(0x50D4)
    state['numRounds'] = ds_read16(0x5160)
    state['roundNumber'] = ds_read16(0xE340)
    state['armsLevel'] = ds_read16(0x518A)
    state['skyType'] = ds_read16(0x5110)
    state['landType'] = ds_read16(0x5110)
    state['windSpeed'] = ds_read16s(0x515A)
    state['maxWind'] = ds_read16(0x515C)
    state['terrainType'] = ds_read16(0x5110)
    state['layoutMode'] = ds_read16(0xED58)
    state['hudY'] = ds_read16(0x518E)
    state['screenHeight'] = ds_read16(0xECB8)
    state['maxPower'] = ds_read16(0x50E4)
    state['playOrder'] = ds_read16(0x519C)
    state['wrapEnabled'] = ds_read16(0x510E)
    state['fallingTanks'] = ds_read16(0x5162)
    state['currentPlayerIdx'] = ds_read16(0xCE96)

    state['groundColorTable'] = [ds_read8(0x5036 + i) for i in range(6)]

    ptr_off = ds_read16(0x6242)
    ptr_seg = ds_read16(0x6244)
    height_phys = ptr_seg * 16 + ptr_off
    heights = []
    for x in range(320):
        h = mem.read16(height_phys + x * 2)
        if h > 0x7FFF: h -= 0x10000
        heights.append(h)
    state['terrainHeights'] = heights

    num_p = state['numPlayers']

    tanks = []
    for p in range(num_p):
        sub_phys = ds_base + SUB_BASE_DS + p * SUB_STRIDE
        tank = {}

        tank['x'] = mem.read16(sub_phys + 0x0E)
        tank['y'] = mem.read16(sub_phys + 0x10)
        tank['alive'] = mem.read16(sub_phys + 0x18)
        tank['colorBase'] = mem.read16(sub_phys + 0x1A)
        tank['turretAngle'] = mem.read16(sub_phys + 0x32)
        tank['turretDirection'] = mem.read16(sub_phys + 0x94)
        if tank['turretDirection'] > 0x7FFF:
            tank['turretDirection'] -= 0x10000
        tank['power'] = mem.read16(sub_phys + 0x02)
        tank['shieldType'] = mem.read16(sub_phys + 0x22)
        tank['shieldEnergy'] = mem.read16(sub_phys + 0x96)
        tank['selectedWeapon'] = mem.read16(sub_phys + 0x26)
        tank['activeShield'] = mem.read16(sub_phys + 0x22)

        tank['maxCash'] = mem.read16(sub_phys + 0x9C)
        cash_val = mem.read16(sub_phys + 0x9E)
        if cash_val > 0x7FFF:
            cash_val -= 0x10000
        tank['cash'] = cash_val

        inv_off = mem.read16(sub_phys + 0xB2)
        inv_seg = mem.read16(sub_phys + 0xB4)
        inv_phys = inv_seg * 16 + inv_off
        inventory = []
        for w in range(WEAPON_COUNT):
            inventory.append(mem.read16(inv_phys + w * 2))
        tank['inventory'] = inventory

        name_off = mem.read16(sub_phys + 0xB6)
        name_seg = mem.read16(sub_phys + 0xB8)
        name_phys = name_seg * 16 + name_off
        name_chars = []
        for i in range(12):
            c = mem.read8(name_phys + i)
            if c == 0:
                break
            name_chars.append(chr(c))
        tank['name'] = ''.join(name_chars)

        tanks.append(tank)
    state['tanks'] = tanks

    palette = []
    for i in range(256):
        r = ports.dac_palette[i * 3] if hasattr(ports, 'dac_palette') else 0
        g = ports.dac_palette[i * 3 + 1] if hasattr(ports, 'dac_palette') else 0
        b = ports.dac_palette[i * 3 + 2] if hasattr(ports, 'dac_palette') else 0
        palette.append([r, g, b])
    state['palette'] = palette

    state['hudTextColor'] = ds_read16(0xEF22)
    state['hudBgColor'] = ds_read16(0xEF28)

    r250_table = [ds_read16(0xEA12 + i * 2) for i in range(250)]
    state['r250Table'] = r250_table
    state['r250Index'] = ds_read16(0xEC06)

    vga_pixels = []
    for y in range(200):
        for x in range(320):
            vga_addr = 0xA0000 + y * 320 + x
            vga_pixels.append(mem.read8(vga_addr))
    state['vgaPixels'] = vga_pixels

    with open(output_path, 'w') as f:
        json.dump(state, f)

    print(f"Game state dumped to {output_path}")
    print(f"  Players: {num_p}, Rounds: {state['numRounds']}, Round: {state['roundNumber']}")
    print(f"  Wind: {state['windSpeed']}, Sky: {state['skyType']}, Arms: {state['armsLevel']}")
    print(f"  Terrain heights[0..9]: {heights[:10]}")
    for i, t in enumerate(tanks):
        inv_nonzero = [(w, t['inventory'][w]) for w in range(WEAPON_COUNT) if t['inventory'][w] > 0]
        print(f"  Tank {i}: {t['name']} @ ({t['x']},{t['y']}) alive={t['alive']} cash={t['cash']} color={t['colorBase']} inv={inv_nonzero}")


if __name__ == '__main__':
    main()
