#!/usr/bin/env python3
"""Read memory from a saved emulator state.

Usage:
  python3 disasm/mem_read.py STATE_FILE ADDRESS [options]
  python3 disasm/mem_read.py STATE_FILE LABEL_NAME [options]
  python3 disasm/mem_read.py --labels PATTERN        (no state file needed)

Address formats:
  LABEL_NAME     — Label name from labels.csv (e.g. WIND_SPEED, NUM_PLAYERS)
  DS:0x1234      — DS-relative offset
  SS:BP+0x06     — Stack-relative (reads from SS:BP+offset)
  SS:SP+0x00     — Stack pointer relative
  SEG:OFF        — Absolute segment:offset (e.g. 5F2A:274E)
  0x12345        — Physical/linear address

  When using a label name, the dtype column from labels.csv is used for
  auto-formatting (tables as rows, farptrs as seg:off, strings as text).
  Explicit format flags (-w, -s, -fp, etc.) override auto-formatting.

Label search (no state file needed):
  --labels [PAT]      — List DS labels matching glob pattern (default: all)
  --dump-labels [PAT] — Like --labels but reads current values from state

Options:
  -n N           — Number of items (default 1)
  -w             — Read as 16-bit words (default)
  -dw            — Read as 32-bit dwords
  -b             — Read as bytes
  -s             — Read as null-terminated string
  -fp            — Read as far pointers (seg:off)
  --follow       — For far pointers, also read first word at target
  --stack N      — Dump N stack words from SS:SP
  --regs         — Show all registers

Examples:
  python3 disasm/mem_read.py /tmp/cp1.state DS:0x50F6 -w
  python3 disasm/mem_read.py /tmp/cp1.state WIND_SPEED
  python3 disasm/mem_read.py /tmp/cp1.state NUM_PLAYERS
  python3 disasm/mem_read.py /tmp/cp1.state ground_color_table -n 6
  python3 disasm/mem_read.py /tmp/cp1.state SS:BP+0x06 -fp --follow
  python3 disasm/mem_read.py /tmp/cp1.state --regs
  python3 disasm/mem_read.py /tmp/cp1.state --stack 20
  python3 disasm/mem_read.py /tmp/cp1.state --dump-labels '*wind*'
  python3 disasm/mem_read.py --labels '*player*'
"""
import sys, os, re, argparse, csv, fnmatch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from disasm.emu.memory import Memory
from disasm.emu.cpu import CPU
from disasm.emu.loader import load_exe, setup_ivt, setup_cpu
from disasm.emu.ports import PortIO
from disasm.emu.interrupts import InterruptHandler
from disasm.emu.state import load_state


def load_labels():
    """Load labels.csv, return dict of name -> (ds_offset_int, dtype_or_None)
    and list of (ds_offset_int, name, dtype) for DS: entries only."""
    labels_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'labels.csv')
    by_name = {}  # name -> (ds_offset, dtype)
    all_ds = []   # (ds_offset, name, dtype)
    if not os.path.exists(labels_path):
        return by_name, all_ds
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
                    all_ds.append((off, name, dtype))
                except ValueError:
                    pass
    all_ds.sort(key=lambda x: x[0])
    return by_name, all_ds


def dump_struct(mem, phys, fmt_str, prefix='  '):
    """Dump a struct at phys using fmt_str. Returns struct size."""
    off = 0
    for field_spec in fmt_str.split(','):
        field_spec = field_spec.strip()
        if not field_spec:
            continue
        if '=' in field_spec:
            name, ftype = field_spec.split('=', 1)
        else:
            name, ftype = None, field_spec
        label = f'{name}: ' if name else ''

        if ftype == 'u8':
            val = mem.data[phys + off]
            print(f'{prefix}+{off:03X}  {label}0x{val:02X} ({val})')
            off += 1
        elif ftype == 's8':
            val = mem.data[phys + off]
            sval = val if val < 128 else val - 256
            print(f'{prefix}+{off:03X}  {label}{sval}')
            off += 1
        elif ftype in ('u16', 'ptr16'):
            val = mem.read16(phys + off)
            extra = f"  '{chr(val)}'" if 0x20 <= val < 0x7F else ''
            print(f'{prefix}+{off:03X}  {label}0x{val:04X} ({val}){extra}')
            off += 2
        elif ftype == 's16':
            val = mem.read16(phys + off)
            sval = val if val < 0x8000 else val - 0x10000
            print(f'{prefix}+{off:03X}  {label}{sval} (0x{val:04X})')
            off += 2
        elif ftype == 'u32':
            lo = mem.read16(phys + off)
            hi = mem.read16(phys + off + 2)
            val = (hi << 16) | lo
            print(f'{prefix}+{off:03X}  {label}0x{val:08X} ({val})')
            off += 4
        elif ftype == 'farptr':
            fp_off = mem.read16(phys + off)
            fp_seg = mem.read16(phys + off + 2)
            tgt = ((fp_seg << 4) + fp_off) & 0xFFFFF
            print(f'{prefix}+{off:03X}  {label}{fp_seg:04X}:{fp_off:04X} (phys {tgt:05X})')
            off += 4
        elif ftype.startswith('str:'):
            n = int(ftype[4:])
            raw = bytes(mem.data[phys + off:phys + off + n])
            s = raw.split(b'\x00')[0].decode('ascii', errors='replace')
            print(f'{prefix}+{off:03X}  {label}"{s}"')
            off += n
        elif ftype.startswith('pad:'):
            off += int(ftype[4:])
        else:
            print(f'{prefix}??? unknown format: {ftype}')
            break
    return off


def resolve_address(addr_str, cpu, mem, labels_by_name=None):
    """Resolve address string to physical address. Returns (phys, description).
    Also tries label name lookup if labels_by_name is provided."""
    addr_str = addr_str.strip()

    # Try label name lookup first (if it doesn't look like an address pattern)
    if labels_by_name and not re.match(r'(DS:|ES:|SS:|0x|[0-9a-fA-F]{4}:)', addr_str, re.I):
        if addr_str in labels_by_name:
            off, dtype = labels_by_name[addr_str]
            ds = cpu.segs[3]
            phys = ((ds << 4) + off) & 0xFFFFF
            return phys, f'{addr_str} = DS:{off:04X} = {ds:04X}:{off:04X} (phys {phys:05X})'

    # SS:BP+offset or SS:SP+offset
    m = re.match(r'SS:(BP|SP)([+-]0x[0-9a-fA-F]+|[+-]\d+)?$', addr_str, re.I)
    if m:
        base_reg = m.group(1).upper()
        offset = int(m.group(2), 0) if m.group(2) else 0
        ss = cpu.segs[2]
        base_val = cpu.bp if base_reg == 'BP' else cpu.sp
        phys = ((ss << 4) + ((base_val + offset) & 0xFFFF)) & 0xFFFFF
        return phys, f'SS:{base_reg}{offset:+d} = {ss:04X}:{(base_val+offset)&0xFFFF:04X} (phys {phys:05X})'

    # DS:offset
    m = re.match(r'DS:(0x[0-9a-fA-F]+|\d+)$', addr_str, re.I)
    if m:
        off = int(m.group(1), 0)
        ds = cpu.segs[3]
        phys = ((ds << 4) + off) & 0xFFFFF
        return phys, f'DS:{off:04X} = {ds:04X}:{off:04X} (phys {phys:05X})'

    # ES:offset
    m = re.match(r'ES:(0x[0-9a-fA-F]+|\d+)$', addr_str, re.I)
    if m:
        off = int(m.group(1), 0)
        es = cpu.segs[0]
        phys = ((es << 4) + off) & 0xFFFFF
        return phys, f'ES:{off:04X} = {es:04X}:{off:04X} (phys {phys:05X})'

    # SEG:OFF (hex:hex)
    m = re.match(r'([0-9a-fA-F]{4}):(0x[0-9a-fA-F]+|[0-9a-fA-F]+)$', addr_str)
    if m:
        seg = int(m.group(1), 16)
        off = int(m.group(2), 16) if m.group(2).startswith('0x') else int(m.group(2), 16)
        phys = ((seg << 4) + off) & 0xFFFFF
        return phys, f'{seg:04X}:{off:04X} (phys {phys:05X})'

    # Physical address
    m = re.match(r'0x([0-9a-fA-F]+)$', addr_str)
    if m:
        phys = int(m.group(1), 16)
        return phys, f'phys {phys:05X}'

    raise ValueError(f'Cannot parse address: {addr_str}')


def main():
    parser = argparse.ArgumentParser(description='Read memory from emulator state')
    parser.add_argument('state_file', nargs='?', help='Path to saved state file')
    parser.add_argument('address', nargs='?', help='Address to read (DS:offset, label name, SEG:OFF, etc.)')
    parser.add_argument('-n', type=int, default=1, help='Number of items')
    parser.add_argument('-w', action='store_true', help='Read as 16-bit words (default)')
    parser.add_argument('-dw', action='store_true', help='Read as 32-bit dwords')
    parser.add_argument('-b', action='store_true', help='Read as bytes')
    parser.add_argument('-s', action='store_true', help='Read as string')
    parser.add_argument('-fp', action='store_true', help='Read as far pointers')
    parser.add_argument('--follow', action='store_true', help='Follow far pointers')
    parser.add_argument('--stack', type=int, metavar='N', help='Dump N stack words')
    parser.add_argument('--regs', action='store_true', help='Show registers')
    parser.add_argument('--frames', type=int, metavar='N', nargs='?', const=10,
                        help='Walk BP chain (stack frames), show N frames')
    parser.add_argument('--deref', action='store_true',
                        help='Treat ADDRESS as a far pointer, read from target')
    parser.add_argument('--fmt', metavar='SPEC',
                        help='Struct format: comma-sep fields. '
                        'u8 s8 u16 s16 u32 ptr16 farptr str:N pad:N. '
                        'Prefix with name= for labels, e.g. type=u16,enabled=u16,x=s16')
    parser.add_argument('--each-fp', metavar='FMT',
                        help='Read -n far pointers at ADDRESS, apply FMT struct to each target')
    parser.add_argument('--labels', metavar='PATTERN', nargs='?', const='*',
                        help='Search/list DS labels matching glob pattern (e.g. "*wind*")')
    parser.add_argument('--dump-labels', metavar='PATTERN', nargs='?', const='*',
                        help='Like --labels but also reads current value from state')
    parser.add_argument('--exe', default='earth/SCORCH.EXE', help='EXE path')
    args = parser.parse_args()

    # Load labels
    labels_by_name, labels_all_ds = load_labels()

    # --labels: search without loading state (no state_file needed)
    if args.labels is not None:
        pat = args.labels
        for off, name, dtype in labels_all_ds:
            if fnmatch.fnmatch(name.lower(), pat.lower()):
                dt = f'  [{dtype}]' if dtype else ''
                print(f'  DS:0x{off:04X}  {name}{dt}')
        return

    # Everything below requires a state file
    if not args.state_file:
        parser.error('state_file is required (except with --labels)')

    # Load state
    mem = Memory()
    setup_ivt(mem)
    info = load_exe(args.exe, mem)
    cpu = CPU()
    setup_cpu(cpu, info)
    ports = PortIO()
    ports.mem = mem
    ih = InterruptHandler(mem, cpu, 'earth', ports)
    load_state(args.state_file, cpu, mem, ports, ih)

    # --dump-labels: search and read values
    if args.dump_labels is not None:
        pat = args.dump_labels
        ds = cpu.segs[3]
        for off, name, dtype in labels_all_ds:
            if not fnmatch.fnmatch(name.lower(), pat.lower()):
                continue
            phys = ((ds << 4) + off) & 0xFFFFF
            # Auto-format based on dtype
            if dtype and 'str' in dtype:
                chars = []
                for i in range(64):
                    b = mem.data[phys + i]
                    if b == 0:
                        break
                    chars.append(chr(b) if 0x20 <= b < 0x7F else f'\\x{b:02X}')
                val_str = f'"{("".join(chars))}"'
            elif dtype and 'farptr' in dtype:
                fp_off = mem.read16(phys)
                fp_seg = mem.read16(phys + 2)
                val_str = f'{fp_seg:04X}:{fp_off:04X}'
            elif dtype and dtype.startswith('data/table:'):
                stride = int(dtype.split(':')[1])
                val_str = f'[table stride={stride}, first word=0x{mem.read16(phys):04X}]'
            else:
                val = mem.read16(phys)
                sval = val if val < 0x8000 else val - 0x10000
                val_str = f'0x{val:04X} ({sval})'
            dt = f'  [{dtype}]' if dtype else ''
            print(f'  DS:0x{off:04X}  {name} = {val_str}{dt}')
        return

    if args.regs:
        print(f'AX={cpu.ax:04X} BX={cpu.bx:04X} CX={cpu.cx:04X} DX={cpu.dx:04X}')
        print(f'SI={cpu.si:04X} DI={cpu.di:04X} BP={cpu.bp:04X} SP={cpu.sp:04X}')
        print(f'CS={cpu.segs[1]:04X} DS={cpu.segs[3]:04X} ES={cpu.segs[0]:04X} SS={cpu.segs[2]:04X} IP={cpu.ip:04X}')
        cs_ip_phys = (cpu.segs[1] << 4) + cpu.ip
        foff = cs_ip_phys - info['image_base'] + info['header_size']
        print(f'CS:IP phys={cs_ip_phys:05X} file=0x{foff:05X}')

    if args.stack is not None:
        ss = cpu.segs[2]
        sp = cpu.sp
        print(f'\nStack dump SS:SP = {ss:04X}:{sp:04X}:')
        for i in range(args.stack):
            addr = ((ss << 4) + ((sp + i * 2) & 0xFFFF)) & 0xFFFFF
            val = mem.read16(addr)
            print(f'  SS:{(sp + i*2) & 0xFFFF:04X}  [{i:+3d}]  0x{val:04X}  ({val})')

    if args.frames is not None:
        ss = cpu.segs[2]
        bp = cpu.bp
        hdr = info['header_size']
        base = info['image_base']
        print(f'\nStack frames (BP chain) from BP={bp:04X}:')
        for i in range(args.frames):
            old_bp = mem.read16((ss << 4) + bp)
            ret_off = mem.read16((ss << 4) + bp + 2)
            ret_seg = mem.read16((ss << 4) + bp + 4)
            phys = (ret_seg << 4) + ret_off
            foff = phys - base + hdr
            # Show first 4 args at bp+6..bp+12
            a = [mem.read16((ss << 4) + bp + 6 + j*2) for j in range(4)]
            print(f'  [{i}] BP={bp:04X}  ret={ret_seg:04X}:{ret_off:04X} (file 0x{foff:05X})'
                  f'  args: {" ".join(f"{v:04X}" for v in a)}')
            if old_bp == 0 or old_bp <= bp:
                break
            bp = old_bp

    if args.address is None:
        if not args.regs and args.stack is None and args.frames is None:
            parser.print_help()
        return

    phys, desc = resolve_address(args.address, cpu, mem, labels_by_name)

    # Auto-detect dtype from labels if no explicit format given
    auto_dtype = None
    if labels_by_name and args.address in labels_by_name:
        _, auto_dtype = labels_by_name[args.address]

    # Dereference: treat address as far pointer, read from target
    if args.deref:
        off = mem.read16(phys)
        seg = mem.read16(phys + 2)
        tgt = ((seg << 4) + off) & 0xFFFFF
        print(f'{desc} -> farptr {seg:04X}:{off:04X} (phys {tgt:05X})')
        phys = tgt
    else:
        print(f'\n{desc}')

    # --each-fp: read N far pointers, apply fmt to each target
    if args.each_fp:
        for i in range(args.n):
            fp_off = mem.read16(phys + i * 4)
            fp_seg = mem.read16(phys + i * 4 + 2)
            tgt = ((fp_seg << 4) + fp_off) & 0xFFFFF
            print(f'\n  [{i}] {fp_seg:04X}:{fp_off:04X} (phys {tgt:05X})')
            dump_struct(mem, tgt, args.each_fp, prefix='    ')
        return

    # Struct format mode
    if args.fmt:
        stride = dump_struct(mem, phys, args.fmt)
        for idx in range(1, args.n):
            print(f'\n  --- [{idx}] at +0x{stride*idx:X} ---')
            dump_struct(mem, phys + stride * idx, args.fmt)
        return

    # Auto-format from dtype if no explicit format flags
    no_explicit = not (args.s or args.b or args.fp or args.dw or args.fmt or args.each_fp)
    if no_explicit and auto_dtype:
        if 'str' in auto_dtype:
            args.s = True
        elif auto_dtype == 'data/farptr':
            args.fp = True
            if args.n == 1:
                args.n = 4
        elif auto_dtype.startswith('data/table:'):
            stride = int(auto_dtype.split(':')[1])
            print(f'  [table: stride={stride} bytes, showing {args.n} entries as raw words]')
            for idx in range(args.n):
                base = phys + stride * idx
                words = [mem.read16(base + j*2) for j in range(min(stride//2, 8))]
                print(f'  [{idx:2d}] +0x{stride*idx:04X}  {" ".join(f"{w:04X}" for w in words)}')
            return

    if args.s:
        # String
        chars = []
        for i in range(256):
            b = mem.data[phys + i]
            if b == 0:
                break
            chars.append(chr(b) if 0x20 <= b < 0x7F else f'\\x{b:02X}')
        print(f'  "{("".join(chars))}"')
    elif args.b:
        # Bytes
        for i in range(args.n):
            val = mem.data[phys + i]
            print(f'  +{i:03X}  0x{val:02X}  ({val})')
    elif args.fp:
        # Far pointers
        for i in range(args.n):
            off = mem.read16(phys + i * 4)
            seg = mem.read16(phys + i * 4 + 2)
            tgt = ((seg << 4) + off) & 0xFFFFF
            line = f'  [{i:2d}]  {seg:04X}:{off:04X}  (phys {tgt:05X})'
            if args.follow:
                val = mem.read16(tgt)
                line += f'  → 0x{val:04X} ({val})'
            print(line)
    elif args.dw:
        # Dwords
        for i in range(args.n):
            lo = mem.read16(phys + i * 4)
            hi = mem.read16(phys + i * 4 + 2)
            val = (hi << 16) | lo
            print(f'  +{i*4:03X}  0x{val:08X}  ({val})')
    else:
        # Words (default)
        for i in range(args.n):
            val = mem.read16(phys + i * 2)
            extra = ''
            if 0x20 <= val < 0x7F:
                extra = f"  '{chr(val)}'"
            print(f'  +{i*2:03X}  0x{val:04X}  ({val}){extra}')


if __name__ == '__main__':
    main()
