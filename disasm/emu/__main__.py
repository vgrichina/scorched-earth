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
from emu.execute import step


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
    args = parser.parse_args()

    # Resolve exe path relative to project root
    exe_path = args.exe
    if not os.path.isabs(exe_path):
        # Try relative to CWD first, then relative to project root
        if not os.path.exists(exe_path):
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            exe_path = os.path.join(project_root, '..', args.exe)

    print(f"Loading {exe_path}...")
    mem_obj = Memory()
    setup_ivt(mem_obj)
    info = load_exe(exe_path, mem_obj)

    cpu = CPU()
    setup_cpu(cpu, info)

    print(f"Image loaded at seg 0x{info['image_seg']:04X} "
          f"(phys 0x{info['image_base']:05X}), {info['image_size']} bytes")
    print(f"Applied {info['num_relocs']} relocations")
    print(f"Entry: CS:IP = {cpu.segs[1]:04X}:{cpu.ip:04X}  "
          f"SS:SP = {cpu.segs[2]:04X}:{cpu.sp:04X}")
    print(cpu.dump())

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

    # Set up I/O
    ports = PortIO()
    earth_dir = os.path.join(os.path.dirname(exe_path))
    int_handler = InterruptHandler(mem_obj, cpu, earth_dir)

    # Heap starts after image + some space for stack
    stack_end = Memory.phys(info['entry_ss'], info['entry_sp']) + 0x1000
    int_handler.init_heap((stack_end >> 4) + 1)

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

    # Run
    print(f"\nExecuting (max {args.max_steps} steps)...")
    try:
        for i in range(args.max_steps):
            if cpu.halted:
                print(f"CPU halted after {i} instructions")
                break

            if args.trace and trace_decode:
                ip_phys = Memory.phys(cpu.segs[1], cpu.ip)
                try:
                    length, mn, op_str, _, _ = trace_decode(info['exe_data'], ip_phys)
                    print(f"  {cpu.segs[1]:04X}:{cpu.ip:04X}  {mn} {op_str}")
                except Exception:
                    print(f"  {cpu.segs[1]:04X}:{cpu.ip:04X}  ???")

            step(cpu, mem_obj, ports, int_handler, trace=args.trace)

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
        raise

    print("\nFinal state:")
    print(cpu.dump())


if __name__ == '__main__':
    main()
