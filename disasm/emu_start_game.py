"""Run emulator from boot, through menu, skip player dialogs, into game start.

Uses hooks to bypass dialog input waits by injecting keys at the right moments
and forcing dialog returns when needed.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emu.memory import Memory
from emu.cpu import CPU
from emu.loader import load_exe, setup_ivt, setup_cpu
from emu.ports import PortIO
from emu.interrupts import InterruptHandler, EmuExit
from emu.execute import run_fast
from emu.state import save_state, load_state

def main():
    exe_path = 'earth/SCORCH.EXE'
    mem = Memory()
    setup_ivt(mem)
    info = load_exe(exe_path, mem)
    cpu = CPU()
    setup_cpu(cpu, info)
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)
    stack_end = Memory.phys(info['entry_ss'], info['entry_sp']) + 0x1000
    int_handler.init_heap((stack_end >> 4) + 1)

    header_size = info['header_size']
    image_base = info['image_base']

    def file_to_phys(foff):
        return foff - header_size + image_base

    def phys_to_file(phys):
        return phys - image_base + header_size

    # Phase 1: Boot to call_main_menu
    print("Phase 1: Boot to main menu call...")
    bp = {file_to_phys(0x2A850)}
    reason, result = run_fast(cpu, mem, ports, int_handler, 10_000_000, bp_set=bp)
    print(f"  -> {reason} at {cpu.segs[1]:04X}:{cpu.ip:04X} "
          f"(file 0x{phys_to_file(result):05X})" if reason == 'breakpoint' else f"  -> {reason}")

    # Phase 2: Run menu, inject S + Enter to start game
    print("Phase 2: Menu → Start game...")
    bp2 = {file_to_phys(0x2A855)}  # after main_menu returns
    keys = {
        3_000_000: (0x1F, 0x73),    # 'S' for Start
        3_001_000: (0x9F, 0),        # S key-up
        8_000_000: (0x1C, 0x0D),    # Enter to confirm
        8_001_000: (0x9C, 0),        # Enter key-up
    }
    reason, result = run_fast(cpu, mem, ports, int_handler, 200_000_000,
                              bp_set=bp2, scheduled_keys=keys)
    print(f"  -> {reason} at {cpu.segs[1]:04X}:{cpu.ip:04X}" if reason == 'breakpoint'
          else f"  -> {reason}")

    # Phase 3: Post-menu init → will hit player setup dialogs
    # Use a hook on dialog_poll_input to force "Done" by writing return value
    print("Phase 3: Game init + skip player dialogs...")

    poll_phys = file_to_phys(0x460C3)  # dialog_poll_input
    poll_count = [0]

    def force_dialog_done(cpu, mem):
        """When dialog_poll_input is called, inject 'D' key into the queue
        to trigger the Done button."""
        poll_count[0] += 1
        if poll_count[0] % 100 == 1:  # inject periodically
            ds_base = (cpu.segs[3] << 4) & 0xFFFFF
            # Write 'D' scancode to circular buffer (mode 1)
            tail = mem.read16(ds_base + 0x5034)
            head = mem.read16(ds_base + 0x5032)
            new_tail = (tail + 1) & 0x7F
            if new_tail != head:
                mem.write16(ds_base + 0xD2BE + tail * 2, 0x20)  # D scancode
                mem.write16(ds_base + 0xD3BE + tail * 2, 0)
                mem.write16(ds_base + 0x5034, new_tail)
            # Also write to last_scancode for mode 0/2
            mem.write16(ds_base + 0xD0B8, 0x20)

    hooks = {poll_phys: force_dialog_done}

    # Break at game round call (0x2A9FE) or play_start (0x2F830)
    bp3 = {file_to_phys(0x2A9FE), file_to_phys(0x2F830)}
    reason, result = run_fast(cpu, mem, ports, int_handler, 500_000_000,
                              bp_set=bp3, hooks=hooks)
    foff = phys_to_file(result) if reason == 'breakpoint' else 0
    print(f"  -> {reason} at {cpu.segs[1]:04X}:{cpu.ip:04X}"
          f" (file 0x{foff:05X})" if reason == 'breakpoint'
          else f"  -> {reason}")
    print(f"  dialog_poll_input called {poll_count[0]} times")

    # Save state + screenshot
    save_state('/tmp/scorch_game_start.state', cpu, mem, ports, int_handler)
    mem.dump_screen_png('/tmp/scorch_game_start.png', ports)
    print(f"\nState saved to /tmp/scorch_game_start.state")
    print(f"Screen saved to /tmp/scorch_game_start.png")
    print(cpu.dump())

if __name__ == '__main__':
    main()
