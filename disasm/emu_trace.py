#!/usr/bin/env python3
"""Emulator dynamic analysis tools: trace, watch, calltree, run.

All subcommands load a saved emulator checkpoint and perform dynamic analysis.

Subcommands:
  trace     — Execute N instructions with dis.py-style output + register deltas
  watch     — Run until a DS variable changes, show the instruction that changed it
  calltree  — Log CALL/RET as indented tree with function labels
  run       — Execute from address with register overrides, stop at RET

Usage:
  python3 disasm/emu_trace.py trace STATE_FILE [N] [--from ADDR] [--calls-only]
  python3 disasm/emu_trace.py watch STATE_FILE ADDRESS [--max N]
  python3 disasm/emu_trace.py calltree STATE_FILE [N] [--depth D]
  python3 disasm/emu_trace.py run STATE_FILE ADDR [N] [--until-ret] [--set REG=VAL ...]

Examples:
  python3 disasm/emu_trace.py trace /tmp/game_playing.state 200
  python3 disasm/emu_trace.py trace /tmp/game_playing.state 500 --from 0x25DE9
  python3 disasm/emu_trace.py trace /tmp/game_playing.state 5000 --calls-only
  python3 disasm/emu_trace.py watch /tmp/game_playing.state WIND_SPEED
  python3 disasm/emu_trace.py watch /tmp/game_playing.state DS:0x515C --max 10000000
  python3 disasm/emu_trace.py calltree /tmp/game_playing.state 1000000 --depth 3
  python3 disasm/emu_trace.py run /tmp/game_playing.state 0x25DE9 500 --set AX=3
  python3 disasm/emu_trace.py run /tmp/game_playing.state 0x25DE9 --until-ret
"""
import sys
import os
import argparse
import re

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from disasm.emu.memory import Memory
from disasm.emu.cpu import CPU
from disasm.emu.loader import load_exe, setup_ivt, setup_cpu
from disasm.emu.ports import PortIO
from disasm.emu.interrupts import InterruptHandler, EmuExit
from disasm.emu.execute import step, _push16
from disasm.emu.state import load_state

# dis.py's decode + label infrastructure
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from instruction_set_x86 import decode as x86_decode

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

MZ_HEADER = 0x6A00
DS_FILE_BASE = 0x055D80
REG_NAMES = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI']
SEG_NAMES = ['ES', 'CS', 'SS', 'DS']

# --------------------------------------------------------------------------
# Label loading (reuse from mem_read.py)
# --------------------------------------------------------------------------

def load_labels():
    """Load labels.csv → (by_name {name: (ds_off, dtype)},
                          by_file {file_off: name},
                          ds_labels {ds_off: name})"""
    labels_path = os.path.join(SCRIPT_DIR, 'labels.csv')
    by_name = {}
    by_file = {}
    ds_labels = {}
    if not os.path.exists(labels_path):
        return by_name, by_file, ds_labels
    with open(labels_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(',')
            if len(parts) < 2:
                continue
            addr, name = parts[0].strip(), parts[1].strip()
            dtype = parts[2].strip() if len(parts) > 2 else None
            if addr.upper().startswith('DS:'):
                try:
                    off = int(addr[3:], 16)
                    by_name[name] = (off, dtype)
                    ds_labels[off] = name
                    by_file[DS_FILE_BASE + off] = name
                except ValueError:
                    pass
            else:
                try:
                    foff = int(addr, 16)
                    by_file[foff] = name
                    by_name[name] = (foff, dtype)  # file offset, not DS
                except ValueError:
                    pass
    return by_name, by_file, ds_labels


def resolve_addr(addr_str, cpu, mem, labels_by_name):
    """Resolve address string to physical address. Returns (phys, desc)."""
    addr_str = addr_str.strip()

    # Label name
    if labels_by_name and not re.match(r'(DS:|ES:|SS:|0x|[0-9a-fA-F]{4}:)', addr_str, re.I):
        if addr_str in labels_by_name:
            off, dtype = labels_by_name[addr_str]
            ds = cpu.segs[3]
            phys = ((ds << 4) + off) & 0xFFFFF
            return phys, f'{addr_str} (DS:{off:04X})'

    # DS:offset
    m = re.match(r'DS:(0x[0-9a-fA-F]+|\d+)$', addr_str, re.I)
    if m:
        off = int(m.group(1), 0)
        ds = cpu.segs[3]
        phys = ((ds << 4) + off) & 0xFFFFF
        return phys, f'DS:{off:04X}'

    # File offset (0xNNNNN)
    m = re.match(r'0x([0-9a-fA-F]+)$', addr_str)
    if m:
        foff = int(m.group(1), 16)
        # Convert file offset to physical
        phys = foff - MZ_HEADER + 0x900  # image_base = 0x900
        return phys, f'file 0x{foff:05X}'

    raise ValueError(f'Cannot parse address: {addr_str}')


# --------------------------------------------------------------------------
# State loading helper
# --------------------------------------------------------------------------

def load_emu_state(state_path, exe_path='earth/SCORCH.EXE'):
    mem = Memory()
    setup_ivt(mem)
    info = load_exe(exe_path, mem)
    cpu = CPU()
    setup_cpu(cpu, info)
    ports = PortIO()
    ports.mem = mem
    ih = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(state_path, cpu, mem, ports, ih)
    return cpu, mem, ports, ih, info


def phys_to_file(phys, info):
    return phys - info['image_base'] + info['header_size']


def file_to_phys(foff, info):
    return foff - info['header_size'] + info['image_base']


def snapshot_regs(cpu):
    """Snapshot registers + flags for delta comparison."""
    return (
        list(cpu.regs), list(cpu.segs), cpu.ip,
        cpu.cf, cpu.zf, cpu.sf, cpu.of, cpu.df
    )


def reg_deltas(before, after):
    """Return list of 'REG:OLD→NEW' strings for changed registers."""
    old_regs, old_segs, old_ip, old_cf, old_zf, old_sf, old_of, old_df = before
    new_regs, new_segs, new_ip, new_cf, new_zf, new_sf, new_of, new_df = after
    parts = []
    for i, name in enumerate(REG_NAMES):
        if old_regs[i] != new_regs[i]:
            parts.append(f'{name}:{old_regs[i]:04X}→{new_regs[i]:04X}')
    for i, name in enumerate(SEG_NAMES):
        if old_segs[i] != new_segs[i]:
            parts.append(f'{name}:{old_segs[i]:04X}→{new_segs[i]:04X}')
    # Flags
    flag_parts = []
    if old_cf != new_cf: flag_parts.append(f'CF={new_cf}')
    if old_zf != new_zf: flag_parts.append(f'ZF={new_zf}')
    if old_sf != new_sf: flag_parts.append(f'SF={new_sf}')
    if old_of != new_of: flag_parts.append(f'OF={new_of}')
    if flag_parts:
        parts.append(' '.join(flag_parts))
    return parts


def disasm_at(mem_data, phys, info, labels_by_file, ds_labels):
    """Disassemble one instruction at physical address. Returns (length, text, ds_ref)."""
    foff = phys - info['image_base'] + info['header_size']
    # x86_decode works on raw bytes at a file offset; emulator memory at phys
    # corresponds to file offset. We pass mem_data and phys but decode expects
    # data indexed by file offset. Build a thin wrapper.
    length, mn, op_str, is_fpu, ds_ref = x86_decode(mem_data, phys, labels_by_file)

    # Annotate DS reference
    ann = ''
    if ds_ref is not None:
        ds_name = ds_labels.get(ds_ref)
        if ds_name:
            ann = f'  ; {ds_name}'
        else:
            ann = f'  ; DS:{ds_ref:04X}'

    text = mn + (' ' + op_str if op_str else '') + ann
    return length, text, ds_ref


def format_seg_off(cpu):
    return f'{cpu.segs[1]:04X}:{cpu.ip:04X}'


# --------------------------------------------------------------------------
# TRACE subcommand
# --------------------------------------------------------------------------

def cmd_trace(args):
    cpu, mem, ports, ih, info = load_emu_state(args.state_file, args.exe)
    labels_by_name, labels_by_file, ds_labels = load_labels()

    # --from: set CS:IP to start address
    if args.start_from:
        foff = None
        m = re.match(r'0x([0-9a-fA-F]+)$', args.start_from)
        if m:
            foff = int(m.group(1), 16)
        elif args.start_from in labels_by_name:
            off, _ = labels_by_name[args.start_from]
            foff = DS_FILE_BASE + off  # this is wrong for code labels...
            # Check if it's a file offset label
            if off > 0x10000:  # likely a file offset, not DS
                foff = off

        if foff is not None:
            phys = file_to_phys(foff, info)
            # Find appropriate CS for this file offset
            from dis import file_to_segoff
            seg, off = file_to_segoff(foff)
            cpu.segs[1] = seg
            cpu.ip = off

    n = args.count or 200
    for i in range(n):
        ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
        foff = phys_to_file(ip_phys, info)
        lbl = labels_by_file.get(foff)

        # Disassemble before executing
        length, text, ds_ref = disasm_at(mem.data, ip_phys, info, labels_by_file, ds_labels)

        if args.calls_only:
            # Only show CALL/RET instructions
            mn_lower = text.split()[0].lower() if text else ''
            if mn_lower not in ('call', 'retf', 'ret', 'iret'):
                # Still execute
                before = snapshot_regs(cpu)
                try:
                    step(cpu, mem, ports, ih)
                except EmuExit:
                    print(f'[EXIT at step {i}]')
                    return
                continue

        # Label marker
        if lbl:
            print(f'\n{lbl}:')

        before = snapshot_regs(cpu)

        # Show instruction
        segoff = format_seg_off(cpu)
        prefix = f'  0x{foff:05X}  {segoff}  {text:<40}'

        # Execute
        try:
            step(cpu, mem, ports, ih)
        except EmuExit:
            print(f'{prefix}')
            print(f'[EXIT at step {i}]')
            return

        after = snapshot_regs(cpu)
        deltas = reg_deltas(before, after)

        # Branch detection
        branch_info = ''
        mn_lower = text.split()[0].lower() if text else ''
        if mn_lower.startswith('j') and mn_lower != 'jmp':
            # Conditional jump: check if taken
            old_ip = before[2]  # old IP
            expected_next = (old_ip + length) & 0xFFFF
            if cpu.ip != expected_next:
                branch_info = ' — taken'
            else:
                branch_info = ' — not taken'

        delta_str = '  '.join(deltas)
        if delta_str or branch_info:
            print(f'{prefix}  {delta_str}{branch_info}')
        else:
            print(f'{prefix}')


# --------------------------------------------------------------------------
# WATCH subcommand
# --------------------------------------------------------------------------

def cmd_watch(args):
    cpu, mem, ports, ih, info = load_emu_state(args.state_file, args.exe)
    labels_by_name, labels_by_file, ds_labels = load_labels()

    phys, desc = resolve_addr(args.address, cpu, mem, labels_by_name)

    # Read initial value (16-bit word)
    init_val = mem.read16(phys)
    print(f'Watching {desc} (phys {phys:05X}), initial value: 0x{init_val:04X} ({init_val})')
    print(f'Running up to {args.max_steps} steps...')

    for i in range(args.max_steps):
        ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
        foff = phys_to_file(ip_phys, info)

        # Snapshot watched value
        old_val = mem.read16(phys)

        try:
            step(cpu, mem, ports, ih)
        except EmuExit:
            print(f'[EXIT at step {i}]')
            return

        new_val = mem.read16(phys)
        if new_val != old_val:
            # Disassemble the instruction that caused the change
            length, text, ds_ref = disasm_at(mem.data, ip_phys, info, labels_by_file, ds_labels)
            segoff = f'{cpu.segs[1]:04X}:{cpu.ip:04X}'
            lbl = labels_by_file.get(foff)
            lbl_str = f' ({lbl})' if lbl else ''
            print(f'@ step {i}  0x{foff:05X}  {text}')
            print(f'  {desc}: 0x{old_val:04X} → 0x{new_val:04X} ({old_val} → {new_val}){lbl_str}')

            if not args.keep_going:
                return

    print(f'No change after {args.max_steps} steps.')


# --------------------------------------------------------------------------
# CALLTREE subcommand
# --------------------------------------------------------------------------

def cmd_calltree(args):
    cpu, mem, ports, ih, info = load_emu_state(args.state_file, args.exe)
    labels_by_name, labels_by_file, ds_labels = load_labels()

    n = args.count or 1_000_000
    max_depth = args.depth or 50
    depth = 0
    call_stack = []

    for i in range(n):
        ip_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
        foff = phys_to_file(ip_phys, info)

        # Quick opcode check — only decode CALL/RET variants
        op = mem.data[ip_phys]
        # Skip prefixes
        raw_op = op
        pos = ip_phys
        while raw_op in (0x26, 0x2E, 0x36, 0x3E, 0xF0, 0xF2, 0xF3):
            pos += 1
            raw_op = mem.data[pos]

        is_call = raw_op in (0xE8, 0x9A)  # near call, far call
        is_call_indirect = False
        if raw_op == 0xFF:
            modrm = mem.data[pos + 1]
            reg = (modrm >> 3) & 7
            if reg in (2, 3):  # CALL r/m16, CALL FAR m16:16
                is_call = True
                is_call_indirect = True
        is_ret = raw_op in (0xC3, 0xCB, 0xC2, 0xCA, 0xCF)  # RET, RETF, RET imm, RETF imm, IRET

        before_ip = cpu.ip
        before_cs = cpu.segs[1]

        try:
            step(cpu, mem, ports, ih)
        except EmuExit:
            print(f'{"  " * depth}[EXIT at step {i}]')
            return

        if is_call and depth < max_depth:
            target_phys = ((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF
            target_foff = phys_to_file(target_phys, info)
            lbl = labels_by_file.get(target_foff, f'0x{target_foff:05X}')
            indent = '  ' * depth
            print(f'{indent}{lbl}  ({cpu.segs[1]:04X}:{cpu.ip:04X})')
            call_stack.append(depth)
            depth += 1

        elif is_ret and call_stack:
            depth = call_stack.pop()

    print(f'[{n} steps reached]')


# --------------------------------------------------------------------------
# RUN subcommand
# --------------------------------------------------------------------------

def cmd_run(args):
    cpu, mem, ports, ih, info = load_emu_state(args.state_file, args.exe)
    labels_by_name, labels_by_file, ds_labels = load_labels()

    # Set start address
    m = re.match(r'0x([0-9a-fA-F]+)$', args.address)
    if m:
        foff = int(m.group(1), 16)
        from dis import file_to_segoff
        seg, off = file_to_segoff(foff)
        cpu.segs[1] = seg
        cpu.ip = off
    elif args.address in labels_by_name:
        # Assume code label = file offset
        off_val, _ = labels_by_name[args.address]
        if off_val > 0x10000:  # file offset
            from dis import file_to_segoff
            seg, off = file_to_segoff(off_val)
            cpu.segs[1] = seg
            cpu.ip = off

    # Apply --set overrides
    if args.set_vals:
        ds_base = (cpu.segs[3] << 4) & 0xFFFFF
        for sv in args.set_vals:
            lhs, rhs = sv.split('=', 1)
            val = int(rhs, 0)
            lhs_up = lhs.upper()
            # Register?
            if lhs_up in REG_NAMES:
                idx = REG_NAMES.index(lhs_up)
                cpu.regs[idx] = val & 0xFFFF
            elif lhs_up.startswith('DS:'):
                off = int(lhs[3:], 16)
                phys = ds_base + off
                mem.data[phys] = val & 0xFF
                mem.data[phys + 1] = (val >> 8) & 0xFF
            elif lhs in labels_by_name:
                off, _ = labels_by_name[lhs]
                phys = ds_base + off
                mem.data[phys] = val & 0xFF
                mem.data[phys + 1] = (val >> 8) & 0xFF
            else:
                print(f'Warning: unknown --set target: {lhs}')

    # Snapshot initial state
    init_regs = list(cpu.regs)
    init_segs = list(cpu.segs)
    init_ip = cpu.ip

    # Track DS variable changes if any --set targeted DS
    watched_ds = {}
    ds_base = (cpu.segs[3] << 4) & 0xFFFFF
    if args.set_vals:
        for sv in args.set_vals:
            lhs, rhs = sv.split('=', 1)
            lhs_up = lhs.upper()
            if lhs_up.startswith('DS:') or lhs in labels_by_name:
                if lhs_up.startswith('DS:'):
                    off = int(lhs[3:], 16)
                else:
                    off, _ = labels_by_name[lhs]
                watched_ds[lhs] = (off, mem.read16(ds_base + off))

    n = args.count or 100_000
    initial_sp = cpu.regs[4]
    reason = 'max_steps'

    print(f'Running from {cpu.segs[1]:04X}:{cpu.ip:04X}, max {n} steps')
    if args.set_vals:
        for sv in args.set_vals:
            print(f'  set {sv}')

    for i in range(n):
        # --until-ret: stop when we return to original SP level
        if args.until_ret:
            op = mem.data[((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF]
            if op in (0xC3, 0xCB, 0xC2, 0xCA) and i > 0:
                # Execute the RET, then stop
                try:
                    step(cpu, mem, ports, ih)
                except EmuExit:
                    reason = 'exit'
                    break
                reason = 'ret'
                i += 1
                break

        try:
            step(cpu, mem, ports, ih)
        except EmuExit:
            reason = 'exit'
            break
    else:
        i = n

    print(f'Stopped: {reason} after {i+1} steps at {cpu.segs[1]:04X}:{cpu.ip:04X}')
    foff = phys_to_file(((cpu.segs[1] << 4) + cpu.ip) & 0xFFFFF, info)
    lbl = labels_by_file.get(foff)
    if lbl:
        print(f'  → {lbl} (0x{foff:05X})')

    # Show register changes
    print(f'\nRegisters:')
    for idx, name in enumerate(REG_NAMES):
        old = init_regs[idx]
        new = cpu.regs[idx]
        marker = ' *' if old != new else ''
        print(f'  {name}={new:04X}{f" (was {old:04X})" if old != new else ""}{marker}')

    # Show watched DS changes
    if watched_ds:
        print(f'\nWatched DS variables:')
        for name, (off, old_val) in watched_ds.items():
            new_val = mem.read16(ds_base + off)
            changed = ' *' if old_val != new_val else ' (unchanged)'
            print(f'  {name} = 0x{new_val:04X} ({new_val}){changed}')


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Emulator dynamic analysis tools')
    sub = parser.add_subparsers(dest='cmd', required=True)

    # trace
    p_trace = sub.add_parser('trace', help='Traced execution with register deltas')
    p_trace.add_argument('state_file', help='Checkpoint file')
    p_trace.add_argument('count', type=int, nargs='?', default=200, help='Instructions to trace (default 200)')
    p_trace.add_argument('--from', dest='start_from', help='Start address (file offset or label)')
    p_trace.add_argument('--calls-only', action='store_true', help='Only show CALL/RET instructions')
    p_trace.add_argument('--exe', default='earth/SCORCH.EXE')

    # watch
    p_watch = sub.add_parser('watch', help='Run until memory location changes')
    p_watch.add_argument('state_file', help='Checkpoint file')
    p_watch.add_argument('address', help='Address to watch (DS:offset or label name)')
    p_watch.add_argument('--max', dest='max_steps', type=int, default=10_000_000, help='Max steps (default 10M)')
    p_watch.add_argument('--keep-going', '-k', action='store_true', help='Continue after first change')
    p_watch.add_argument('--exe', default='earth/SCORCH.EXE')

    # calltree
    p_ct = sub.add_parser('calltree', help='Log CALL/RET as indented tree')
    p_ct.add_argument('state_file', help='Checkpoint file')
    p_ct.add_argument('count', type=int, nargs='?', default=1_000_000, help='Max steps (default 1M)')
    p_ct.add_argument('--depth', type=int, default=50, help='Max tree depth (default 50)')
    p_ct.add_argument('--exe', default='earth/SCORCH.EXE')

    # run
    p_run = sub.add_parser('run', help='Execute snippet with register overrides')
    p_run.add_argument('state_file', help='Checkpoint file')
    p_run.add_argument('address', help='Start address (file offset or label)')
    p_run.add_argument('count', type=int, nargs='?', help='Max steps (default 100K)')
    p_run.add_argument('--until-ret', action='store_true', help='Stop at first RET')
    p_run.add_argument('--set', dest='set_vals', nargs='+', metavar='REG=VAL',
                        help='Set register or DS variable (e.g. AX=3 DS:515C=200 WIND_SPEED=100)')
    p_run.add_argument('--exe', default='earth/SCORCH.EXE')

    args = parser.parse_args()

    if args.cmd == 'trace':
        cmd_trace(args)
    elif args.cmd == 'watch':
        cmd_watch(args)
    elif args.cmd == 'calltree':
        cmd_calltree(args)
    elif args.cmd == 'run':
        cmd_run(args)


if __name__ == '__main__':
    main()
