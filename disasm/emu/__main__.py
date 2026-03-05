"""CLI entry point: python3 -m emu [options] or python3 disasm/emu/__main__.py"""

import sys
import os
import argparse

# Allow running from project root or disasm/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from emu.memory import Memory
from emu.cpu import CPU
from emu.loader import load_exe, setup_ivt, setup_cpu
from emu.ports import PortIO
from emu.interrupts import InterruptHandler, EmuExit
from emu.execute import step, run_fast
from emu.state import save_state, load_state


def main():
    parser = argparse.ArgumentParser(description='x86 DOS emulator for SCORCH.EXE')
    parser.add_argument('exe', nargs='?', default='earth/SCORCH.EXE',
                        help='Path to MZ executable (default: earth/SCORCH.EXE)')
    parser.add_argument('--dump-regs', action='store_true',
                        help='Load EXE, print initial registers and first instructions')
    parser.add_argument('--boot-test', action='store_true',
                        help='Run until first INT 21h or N instructions')
    parser.add_argument('--max-steps', type=int, default=100000,
                        help='Max instructions to execute (default: 100000)')
    parser.add_argument('--trace', action='store_true',
                        help='Print each instruction as it executes')
    parser.add_argument('--trace-ints', action='store_true',
                        help='Print INT calls')
    parser.add_argument('--dump-screen', type=str, metavar='FILE.png',
                        help='Dump VGA framebuffer to PNG on exit')
    parser.add_argument('--stdout', type=str, metavar='FILE',
                        help='Redirect DOS stdout (handle 1) to file')
    parser.add_argument('--stderr', type=str, metavar='FILE',
                        help='Redirect DOS stderr (handle 2) to file')
    parser.add_argument('--break', dest='breakpoints', action='append', default=[],
                        metavar='ADDR', help='Break at address (file offset 0xNNNNN, '
                        'or SEG:OFF in emulator space). Can repeat.')
    parser.add_argument('--save-state', type=str, metavar='FILE',
                        help='Save emulator state to binary file on exit')
    parser.add_argument('--load-state', type=str, metavar='FILE',
                        help='Load emulator state from binary file (skip EXE loading)')
    parser.add_argument('--timer', type=int, default=0, metavar='N',
                        help='Fire INT 08h (timer tick) every N instructions (0=off)')
    args = parser.parse_args()

    # Resolve exe path relative to project root
    exe_path = args.exe
    if not os.path.isabs(exe_path):
        # Try relative to CWD first, then relative to project root
        if not os.path.exists(exe_path):
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            exe_path = os.path.join(project_root, '..', args.exe)

    # Always load EXE for info dict (file offsets, exe_data for disassembly)
    print(f"Loading {exe_path}...")
    mem_obj = Memory()
    setup_ivt(mem_obj)
    info = load_exe(exe_path, mem_obj)

    cpu = CPU()
    setup_cpu(cpu, info)

    # Set up I/O (before potential state load)
    ports = PortIO()
    ports.mem = mem_obj
    earth_dir = os.path.join(os.path.dirname(exe_path))
    int_handler = InterruptHandler(mem_obj, cpu, earth_dir, ports)

    if args.load_state:
        print(f"Restoring state from {args.load_state}...")
        load_state(args.load_state, cpu, mem_obj, ports, int_handler)
        print(f"State restored. CS:IP = {cpu.segs[1]:04X}:{cpu.ip:04X}")
        print(cpu.dump())
    else:
        print(f"Image loaded at seg 0x{info['image_seg']:04X} "
              f"(phys 0x{info['image_base']:05X}), {info['image_size']} bytes")
        print(f"Applied {info['num_relocs']} relocations")
        print(f"Entry: CS:IP = {cpu.segs[1]:04X}:{cpu.ip:04X}  "
              f"SS:SP = {cpu.segs[2]:04X}:{cpu.sp:04X}")
        print(cpu.dump())

        # Heap starts after image + some space for stack
        stack_end = Memory.phys(info['entry_ss'], info['entry_sp']) + 0x1000
        int_handler.init_heap((stack_end >> 4) + 1)

    if args.dump_regs:
        # Also decode first 5 instructions using the text decoder
        try:
            from instruction_set_x86 import decode
            # Entry point file offset = header_size + e_cs*16 + e_ip
            e_cs = info['entry_cs'] - info['image_seg']
            pos = info['header_size'] + e_cs * 16 + info['entry_ip']
            print(f"\nFirst instructions at file offset 0x{pos:05X}:")
            for _ in range(10):
                length, mn, op_str, is_fpu, ds_ref = decode(info['exe_data'], pos)
                raw = ' '.join(f'{info["exe_data"][pos+i]:02X}' for i in range(length))
                print(f"  0x{pos:05X}  {raw:<20s}  {mn} {op_str}")
                pos += length
        except ImportError:
            print("(instruction_set_x86 not importable for disassembly)")
        return

    # Redirect DOS stdout/stderr to files if requested
    if args.stdout:
        int_handler._files[1] = open(args.stdout, 'wb')
    if args.stderr:
        int_handler._files[2] = open(args.stderr, 'wb')

    if args.trace_ints:
        def on_int(n, ah):
            print(f"  INT {n:02X}h AH={ah:02X}h")
        int_handler.on_int = on_int

    # Trace decoder for --trace
    trace_decode = None
    if args.trace:
        try:
            from instruction_set_x86 import decode as _decode
            trace_decode = _decode
        except ImportError:
            pass

    # Parse breakpoints → set of physical addresses
    bp_set = set()
    for bp_str in args.breakpoints:
        if ':' in bp_str:
            # SEG:OFF — emulator physical address
            seg_s, off_s = bp_str.split(':')
            phys = int(seg_s, 16) * 16 + int(off_s, 16)
            bp_set.add(phys)
            print(f"Breakpoint: {seg_s}:{off_s} (phys 0x{phys:05X})")
        else:
            # File offset → convert to emulator physical
            foff = int(bp_str, 16)
            phys = foff - info['header_size'] + info['image_base']
            bp_set.add(phys)
            print(f"Breakpoint: file 0x{foff:05X} (phys 0x{phys:05X})")

    # Run
    print(f"\nExecuting (max {args.max_steps} steps)...")

    if args.trace and trace_decode:
        # Slow path with per-instruction trace
        try:
            for i in range(args.max_steps):
                if cpu.halted:
                    print(f"CPU halted after {i} instructions")
                    break
                ip_phys = Memory.phys(cpu.segs[1], cpu.ip)
                if ip_phys in bp_set:
                    file_off = ip_phys - info['image_base'] + info['header_size']
                    print(f"\n*** Breakpoint hit at step {i}: "
                          f"{cpu.segs[1]:04X}:{cpu.ip:04X} (file 0x{file_off:05X})")
                    print(cpu.dump())
                    sp_phys = Memory.phys(cpu.segs[2], cpu.sp)
                    words = [mem_obj.read16(sp_phys + j*2) for j in range(8)]
                    print("Stack: " + " ".join(f"{w:04X}" for w in words))
                    break
                try:
                    length, mn, op_str, _, _ = trace_decode(info['exe_data'], ip_phys)
                    print(f"  {cpu.segs[1]:04X}:{cpu.ip:04X}  {mn} {op_str}")
                except Exception:
                    print(f"  {cpu.segs[1]:04X}:{cpu.ip:04X}  ???")
                step(cpu, mem_obj, ports, int_handler, trace=True)
            else:
                print(f"Reached max steps ({args.max_steps})")
        except EmuExit as e:
            print(f"\nProgram exited with code {e.code} after execution")
        except Exception as e:
            print(f"\nError: {e}")
            print(cpu.dump())
            ip_phys = Memory.phys(cpu.segs[1], cpu.ip)
            raw = ' '.join(f'{mem_obj.data[ip_phys+j]:02X}' for j in range(8))
            print(f"Bytes at CS:IP: {raw}")
    else:
        # Fast path using run_fast
        reason, result = run_fast(cpu, mem_obj, ports, int_handler, args.max_steps,
                                  bp_set=bp_set if bp_set else None,
                                  timer_period=args.timer)
        if reason == 'halted':
            print(f"CPU halted after {result} instructions")
        elif reason == 'breakpoint':
            ip_phys = result
            file_off = ip_phys - info['image_base'] + info['header_size']
            print(f"\n*** Breakpoint hit: "
                  f"{cpu.segs[1]:04X}:{cpu.ip:04X} (file 0x{file_off:05X})")
            print(cpu.dump())
            sp_phys = Memory.phys(cpu.segs[2], cpu.sp)
            words = [mem_obj.read16(sp_phys + j*2) for j in range(8)]
            print("Stack: " + " ".join(f"{w:04X}" for w in words))
        elif reason == 'exit':
            print(f"\nProgram exited with code {result} after execution")
        elif reason == 'error':
            print(f"\nError: {result}")
            print(cpu.dump())
            ip_phys = Memory.phys(cpu.segs[1], cpu.ip)
            raw = ' '.join(f'{mem_obj.data[ip_phys+j]:02X}' for j in range(8))
            print(f"Bytes at CS:IP: {raw}")
        elif reason == 'max_steps':
            print(f"Reached max steps ({args.max_steps})")

    # Save state if requested
    if args.save_state:
        save_state(args.save_state, cpu, mem_obj, ports, int_handler)
        print(f"\nState saved to {args.save_state}")

    # Dump screen if requested (even after error)
    if args.dump_screen:
        w, h = ports.get_resolution()
        mode_desc = f"Mode X {w}x{h}" if ports.mode_x else f"Mode 13h {w}x{h}"
        mem_obj.dump_screen_png(args.dump_screen, ports)
        print(f"\nScreen dumped to {args.dump_screen} ({mode_desc})")

    print("\nFinal state:")
    print(cpu.dump())

    # Disassemble at current CS:IP
    try:
        from instruction_set_x86 import decode
        ip_phys = mem_obj.phys(cpu.segs[1], cpu.ip)
        # Map to file offset: ip_phys - image_base + header_size
        file_off = ip_phys - info['image_base'] + info['header_size']
        print(f"\nCode at CS:IP {cpu.segs[1]:04X}:{cpu.ip:04X} (file 0x{file_off:05X}):")
        pos = file_off
        for _ in range(10):
            try:
                length, mn, op_str, is_fpu, ds_ref = decode(info['exe_data'], pos)
                raw = ' '.join(f'{info["exe_data"][pos+i]:02X}' for i in range(length))
                print(f"  0x{pos:05X}  {raw:<24s}  {mn} {op_str}")
                pos += length
            except Exception:
                break
    except ImportError:
        pass


if __name__ == '__main__':
    main()
