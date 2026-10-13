#!/usr/bin/env python3
"""Send one key to an input-ready dialog without dropping its IRQ or release.

Example:
  python3 disasm/emu_dialog_key.py menu.state next --key 0x1f:115

Writes next.state and next.png. File-offset breakpoints assume the standard
EXE load address 0090:0000. --settle is an execution budget, not a guarantee
that the next screen has finished drawing; inspect the capture or use --stop-at.
"""
import argparse
from pathlib import Path

from emu.memory import Memory
from emu.cpu import CPU
from emu.ports import PortIO
from emu.interrupts import InterruptHandler
from emu.execute import run_fast, step
from emu.state import load_state, save_state


def deliver_key(cpu, mem, ports, interrupts, scancode, ascii_char):
    # run_fast's scheduled event is discarded if IF=0. Wait for the interrupted
    # code to enable IRQs, then inject without a competing timer interrupt.
    for _ in range(100000):
        if cpu.intf:
            break
        step(cpu, mem, ports, interrupts)
    else:
        raise RuntimeError('Keyboard delivery timed out waiting for IF=1')
    reason, _ = run_fast(cpu, mem, ports, interrupts, 1,
                        scheduled_keys={0: (scancode, ascii_char)})
    if reason != 'max_steps':
        raise RuntimeError(f'Keyboard delivery stopped: {reason}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('state')
    parser.add_argument('output', help='Output prefix (.state and .png are added)')
    parser.add_argument('--key', required=True, help='Scancode:ASCII, e.g. 0x20:100')
    parser.add_argument('--settle', type=int, default=3000000)
    parser.add_argument('--stop-at', type=lambda s: int(s, 0),
                        help='Optional EXE file offset to stop at after release')
    args = parser.parse_args()
    scancode, ascii_char = (int(part, 0) for part in args.key.split(':'))
    if not (0 < scancode < 128 and 0 <= ascii_char <= 255 and args.settle > 0):
        parser.error('Expected a make scancode, byte ASCII and positive settle budget')
    mem, cpu, ports = Memory(), CPU(), PortIO()
    ports.mem = mem
    earth = Path(__file__).resolve().parent.parent / 'earth'
    interrupts = InterruptHandler(mem, cpu, str(earth), ports)
    load_state(args.state, cpu, mem, ports, interrupts)
    tick_addr = (cpu.segs[3] << 4) + 0xEE78

    def run(budget, **kwargs):
        return run_fast(cpu, mem, ports, interrupts, budget,
                        timer_period=1000, tick_addr=tick_addr,
                        isr_divisor=200, **kwargs)

    # Clear a held key before waiting for dialog_poll_input or get_key_input.
    deliver_key(cpu, mem, ports, interrupts, scancode | 128, 0)
    reason, count = run(3000000, bp_set={0x460C3 - 0x6100, 0x28B31 - 0x6100})
    if reason != 'breakpoint':
        raise RuntimeError(f'Dialog never became input-ready: {reason}, {count} steps')
    deliver_key(cpu, mem, ports, interrupts, scancode, ascii_char)
    reason, _ = run(2000000)
    if reason != 'max_steps':
        raise RuntimeError(f'Key press stopped: {reason}')
    deliver_key(cpu, mem, ports, interrupts, scancode | 128, 0)
    breakpoints = {args.stop_at - 0x6100} if args.stop_at is not None else None
    reason, count = run(args.settle, bp_set=breakpoints)
    if reason != ('breakpoint' if breakpoints else 'max_steps'):
        raise RuntimeError(f'Capture did not reach requested stop: {reason}, {count} steps')
    save_state(args.output + '.state', cpu, mem, ports, interrupts)
    mem.dump_screen_png(args.output + '.png', ports)
    print(f'{reason}: {cpu.segs[1]:04X}:{cpu.ip:04X}; wrote {args.output}.state/.png')


if __name__ == '__main__':
    main()
