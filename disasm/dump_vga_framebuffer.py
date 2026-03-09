#!/usr/bin/env python3
"""Dump VGA framebuffer + palette from emulator checkpoint as JSON.
Used by web/compare.html for pixel-perfect visual comparison.

Usage:
  python3 disasm/dump_vga_framebuffer.py <state_file> [output.json]
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
    output_path = sys.argv[2] if len(sys.argv) > 2 else '/tmp/vga_dump.json'

    mem = Memory()
    cpu = CPU()
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(state_path, cpu, mem, ports, int_handler)

    ds_base = cpu.segs[3] << 4
    width, height = ports.get_resolution()

    # Actually, the emulator screenshot dimensions tell us: check VGA mode
    # For VGA planar modes (360×480), pixels are in planes
    # For mode 13h (320×200), linear at A000:0000

    # Read VGA palette
    palette = []
    for i in range(256):
        r, g, b = ports.palette[i]
        palette.append([r, g, b])

    # Read framebuffer pixels
    # In planar modes: 4 planes, each plane has width/4 bytes per row
    # mem.dump_screen_png already handles this correctly
    # Let's use the same method but export raw indices

    # Check if planar mode (has vga_planes)
    if hasattr(mem, 'vga_planes') and len(mem.vga_planes) == 4:
        # Planar VGA mode
        plane_stride = width // 4  # bytes per row per plane
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
        # Linear mode (mode 13h)
        pixels = []
        for y in range(height):
            for x in range(width):
                addr = 0xA0000 + y * width + x
                pixels.append(mem.read8(addr))

    result = {
        'width': width,
        'height': height,
        'palette': palette,
        'pixels': pixels,
    }

    # Also dump key state for the web port to initialize
    result['numPlayers'] = mem.read16(ds_base + 0x50D4)
    result['windSpeed'] = mem.read16(ds_base + 0x515A)
    if result['windSpeed'] > 0x7FFF: result['windSpeed'] -= 0x10000
    result['terrainType'] = mem.read16(ds_base + 0x5110)
    result['layoutMode'] = mem.read16(ds_base + 0xED58)

    # Player/tank positions from sub-struct (base DS:D568, stride 0xCA)
    tanks = []
    for p in range(result['numPlayers']):
        base = ds_base + 0xD568 + p * 0xCA
        tank = {
            'x': mem.read16(base + 0x0E),
            'y': mem.read16(base + 0x10),
            'alive': mem.read16(base + 0x18),
            'turretAngle': mem.read16(base + 0x92),
            'power': mem.read16(base + 0x02),
        }
        tanks.append(tank)
    result['tanks'] = tanks

    with open(output_path, 'w') as f:
        json.dump(result, f)

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"VGA dump: {width}x{height}, {size_mb:.1f}MB → {output_path}")
    print(f"Players: {result['numPlayers']}, Wind: {result['windSpeed']}")
    for i, t in enumerate(tanks):
        print(f"  Tank {i}: ({t['x']},{t['y']}) alive={t['alive']} ang={t['turretAngle']} pow={t['power']}")

if __name__ == '__main__':
    main()
