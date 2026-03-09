#!/usr/bin/env python3
"""Verify R250 implementation against actual EXE by running r250_init in the emulator.

Loads a checkpoint, pokes seed=42, runs r250_init function, reads back the table,
and compares against our Python R250 implementation.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler, EmuExit
from emu.execute import run_fast
from emu.state import load_state
from compare_rng import r250_init

def main():
    state_path = sys.argv[1] if len(sys.argv) > 1 else 'scratch/game_playing.state'
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 42

    mem = Memory()
    cpu = CPU()
    ports = PortIO()
    ports.mem = mem
    int_handler = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(state_path, cpu, mem, ports, int_handler)

    ds_base = cpu.segs[3] << 4

    # r250_init is at file 0x32994, which is seg 2BF9:0004 (near entry of the function)
    # The function takes one 16-bit arg on stack: the seed
    # We need to set up a proper far call frame

    # Save current state
    old_cs = cpu.segs[1]
    old_ip = cpu.ip
    old_sp = cpu.regs[4]  # SP

    # Set up the call: push seed, then call far to r250_init
    # Actually, easier: set CS:IP to r250_init entry, push seed + return address
    # r250_init entry is file 0x32994 = seg 2B3B:0BE4 (from dis.py output)
    # Wait, the caller does: push ax (seed); call far 0x2BF9:0x0004; pop cx
    # So r250_init at seg 2BF9:0004, expects [bp+06] = seed (far call frame)

    # Set up stack for far call
    sp = cpu.regs[4]
    # Push a dummy far return address (we'll use a HLT instruction)
    # Find a HLT or just use address 0xFFFF:0xFFFF
    sp -= 2
    mem.write16(cpu.segs[2] * 16 + sp, 0xFFFF)  # return CS
    sp -= 2
    mem.write16(cpu.segs[2] * 16 + sp, 0xFFFF)  # return IP
    sp -= 2
    mem.write16(cpu.segs[2] * 16 + sp, seed & 0xFFFF)  # arg: seed
    # Actually for far call, stack is: seed, ret_IP, ret_CS
    # The function reads [bp+06] which is seed (bp=sp after ENTER, so bp+06 = old_bp+ret_IP+ret_CS+arg)
    # For ENTER: push bp, bp=sp. So [bp+02]=ret_IP, [bp+04]=ret_CS, [bp+06]=seed
    # Stack layout (top to bottom): seed | ret_CS | ret_IP
    # Wait, far call pushes CS then IP. So stack after call far:
    # SP -> ret_IP | ret_CS | arg(seed)
    # After enter: BP -> old_BP | ret_IP | ret_CS | seed
    # So [BP+2] = ret_IP, [BP+4] = ret_CS, [BP+6] = seed ✓

    # Reset stack with plenty of room above stack_limit
    sp = 0x7F00  # well above stack_limit 0x2810
    sp -= 2; mem.write16(cpu.segs[2] * 16 + sp, seed & 0xFFFF)  # seed (pushed by caller)
    sp -= 2; mem.write16(cpu.segs[2] * 16 + sp, 0x0050)  # return CS (-> HLT at 0050:0000)
    sp -= 2; mem.write16(cpu.segs[2] * 16 + sp, 0x0000)  # return IP
    cpu.regs[4] = sp

    # Point CS:IP to r250_init entry
    # File 0x32994 = header 0x6A00 + code offset 0x2BF94
    # Actually from the disassembly: 0x32994 is seg 2B3B:0BE4
    # But the far call target was 2BF9:0004
    # Let's use the actual segment. File offset 0x32994 - 0x6A00 = 0x2BF94
    # seg = 0x2BF94 / 16 = 0x2BF9 with offset 0x0004. Yes.
    cpu.segs[1] = 0x2BF9  # CS
    cpu.ip = 0x0004

    # Place a HLT at 0050:0000 (phys 0x500, IVT stub area) so we stop when function returns
    hlt_phys = 0x500
    mem.write8(hlt_phys, 0xF4)  # HLT

    print(f"Running r250_init(seed={seed}) in emulator...")
    print(f"  CS:IP = {cpu.segs[1]:04X}:{cpu.ip:04X}, SP={cpu.regs[4]:04X}")
    print(f"  stack_limit DS:519A = {mem.read16(ds_base + 0x519A):04X}")
    print(f"  SS={cpu.segs[2]:04X}")
    try:
        reason, result = run_fast(cpu, mem, ports, int_handler, 500000,
                                   timer_period=0)
    except Exception as e:
        print(f"Stopped: {e}")

    print(f"CS:IP after run = {cpu.segs[1]:04X}:{cpu.ip:04X}, reason={reason}")

    # Read back R250 table
    emu_table = []
    for i in range(250):
        emu_table.append(mem.read16(ds_base + 0xEA12 + i * 2))
    emu_index = mem.read16(ds_base + 0xEC06)

    # Generate with our Python implementation
    py_table, py_index = r250_init(seed)

    # Compare
    mismatches = 0
    for i in range(250):
        if emu_table[i] != py_table[i]:
            if mismatches < 10:
                print(f"  MISMATCH table[{i}]: emu=0x{emu_table[i]:04X} py=0x{py_table[i]:04X}")
            mismatches += 1

    if emu_index != py_index:
        print(f"  MISMATCH index: emu={emu_index} py={py_index}")

    if mismatches == 0 and emu_index == py_index:
        print(f"PASS: All 250 table entries + index match!")
    else:
        print(f"FAIL: {mismatches} table mismatches")

    print(f"\nEmu table[0..9]: {[f'0x{t:04X}' for t in emu_table[:10]]}")
    print(f"Py  table[0..9]: {[f'0x{t:04X}' for t in py_table[:10]]}")

if __name__ == '__main__':
    main()
