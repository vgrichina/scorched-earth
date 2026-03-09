"""Load a checkpoint, optionally inject keys + run, dump VGA framebuffer as PNG.

Usage:
  python3 disasm/emu_screenshot.py <state_file> <output.png>
  python3 disasm/emu_screenshot.py <state_file> <output.png> --run <steps>
  python3 disasm/emu_screenshot.py <state_file> <output.png> --run <steps> --fire
  python3 disasm/emu_screenshot.py <state_file> <output.png> --run <steps> --keys STEP:SC:ASC,...
  python3 disasm/emu_screenshot.py <state_file> <output.png> --run <steps> --poke DS:OFF=VAL,...
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler, EmuExit
from emu.execute import run_fast
from emu.state import load_state, save_state

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 disasm/emu_screenshot.py <state> <output.png> [--run N] [--fire] [--keys ...] [--poke ...] [--save state]")
        sys.exit(1)

    state_path = sys.argv[1]
    output_path = sys.argv[2]

    steps = 0
    fire = False
    key_spec = None
    poke_spec = None
    save_path = None
    i = 3
    while i < len(sys.argv):
        if sys.argv[i] == '--run':
            steps = int(sys.argv[i+1])
            i += 2
        elif sys.argv[i] == '--fire':
            fire = True
            i += 1
        elif sys.argv[i] == '--keys':
            key_spec = sys.argv[i+1]
            i += 2
        elif sys.argv[i] == '--poke':
            poke_spec = sys.argv[i+1]
            i += 2
        elif sys.argv[i] == '--save':
            save_path = sys.argv[i+1]
            i += 2
        else:
            i += 1

    mem = Memory()
    cpu = CPU()
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)

    load_state(state_path, cpu, mem, ports, int_handler)
    print(f"Loaded state from {state_path}")
    print(f"CS:IP = {cpu.segs[1]:04X}:{cpu.ip:04X}")

    ds_base = cpu.segs[3] << 4  # DS segment base

    # Direct memory pokes
    if poke_spec:
        for part in poke_spec.split(','):
            addr_str, val_str = part.split('=')
            val = int(val_str, 0)
            if addr_str.startswith('DS:'):
                off = int(addr_str[3:], 16)
                phys = ds_base + off
            else:
                phys = int(addr_str, 0)
            mem.write16(phys, val)
            print(f"  Poked {addr_str} = 0x{val:04X}")

    # Build scheduled_keys dict
    scheduled_keys = {}
    if fire:
        # Mode 2: game reads DS:D0B8 (last_scancode). INT 9 handler writes there.
        # Also need key-down in DS:D1BE table: word at DS:D1BE + scancode*2
        # Enter scancode = 0x1C. Write directly + schedule INT 9 for proper handling.
        # Direct poke: set last_scancode to Enter (0x1C) and key-down table entry
        mem.write16(ds_base + 0xD0B8, 0x1C)  # last_scancode = Enter
        mem.write16(ds_base + 0xD1BE + 0x1C * 2, 1)  # key-down[Enter] = pressed
        # Also schedule proper INT 9 delivery
        scheduled_keys[100] = (0x1C, 0x0D)           # Enter make
        scheduled_keys[2_000_000] = (0x9C, 0x00)     # Enter break
        print("Injected Enter key (fire): DS:D0B8=0x1C + key-down table + INT 9 scheduled")

    if key_spec:
        for part in key_spec.split(','):
            s, sc, asc = part.split(':')
            scheduled_keys[int(s)] = (int(sc, 0), int(asc, 0))
        print(f"Scheduled {len(key_spec.split(','))} key(s)")

    if steps > 0:
        print(f"Running {steps} steps...")
        timer_period = 1000  # fast timer to unblock HLT waits in fg_waitfor
        reason, result = run_fast(cpu, mem, ports, int_handler, steps,
                                  timer_period=timer_period,
                                  scheduled_keys=scheduled_keys if scheduled_keys else None)
        print(f"  -> {reason}")
        print(f"CS:IP = {cpu.segs[1]:04X}:{cpu.ip:04X}")

    mem.dump_screen_png(output_path, ports)
    print(f"Screenshot saved to {output_path}")

    if save_path:
        save_state(save_path, cpu, mem, ports, int_handler)
        print(f"State saved to {save_path}")

if __name__ == '__main__':
    main()
