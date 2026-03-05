"""MZ EXE loader: parse header, apply relocations, set up PSP."""

import struct
import os


def load_exe(path, mem):
    """Load MZ EXE into Memory, apply relocations.
    Returns dict with load info: load_seg, entry_cs, entry_ip, entry_ss, entry_sp,
    ds_seg, image_size, num_relocs.
    """
    with open(path, 'rb') as f:
        exe = f.read()

    # Parse MZ header
    if exe[0:2] != b'MZ' and exe[0:2] != b'ZM':
        raise ValueError(f"Not an MZ executable: {path}")

    e_cblp = struct.unpack_from('<H', exe, 0x02)[0]
    e_cp = struct.unpack_from('<H', exe, 0x04)[0]
    e_crlc = struct.unpack_from('<H', exe, 0x06)[0]
    e_cparhdr = struct.unpack_from('<H', exe, 0x08)[0]
    e_ss = struct.unpack_from('<H', exe, 0x0E)[0]
    e_sp = struct.unpack_from('<H', exe, 0x10)[0]
    e_cs = struct.unpack_from('<H', exe, 0x14)[0]
    e_ip = struct.unpack_from('<H', exe, 0x16)[0]
    e_lfarlc = struct.unpack_from('<H', exe, 0x18)[0]

    header_size = e_cparhdr * 16
    image_size = e_cp * 512
    if e_cblp:
        image_size -= (512 - e_cblp)
    image_size -= header_size
    image_data = exe[header_size:header_size + image_size]

    # Load segment: PSP at load_seg, image at load_seg + 0x10
    load_seg = 0x0060  # PSP paragraph
    image_seg = load_seg + 0x10  # image starts one segment (256 bytes) after PSP
    image_base = image_seg << 4  # physical address

    # Copy image into memory
    mem.load_bytes(image_base, image_data)

    # Apply relocations
    reloc_count = e_crlc
    for i in range(reloc_count):
        rpos = e_lfarlc + i * 4
        r_off = struct.unpack_from('<H', exe, rpos)[0]
        r_seg = struct.unpack_from('<H', exe, rpos + 2)[0]
        phys = image_base + r_seg * 16 + r_off
        old_val = mem.read16(phys)
        mem.write16(phys, (old_val + image_seg) & 0xFFFF)

    # Set up minimal PSP at load_seg
    psp_base = load_seg << 4
    mem.write16(psp_base, 0x20CD)  # INT 20h at PSP:0000
    # Command line at PSP:0x80: length=0, CR terminator
    mem.write8(psp_base + 0x80, 0)
    mem.write8(psp_base + 0x81, 0x0D)
    # PSP:0x02 = top of memory segment
    mem.write16(psp_base + 0x02, 0x9FFF)
    # PSP:0x2C = environment segment (point to a small empty env block)
    env_seg = 0x0050
    mem.write16(psp_base + 0x2C, env_seg)
    # Write empty environment at env_seg (double NUL = end of env)
    env_base = env_seg << 4
    mem.write8(env_base, 0)
    mem.write8(env_base + 1, 0)
    # After env: word 0x0001 + program name
    mem.write16(env_base + 2, 1)
    prog_name = os.path.basename(path).upper().encode('ascii') + b'\x00'
    mem.load_bytes(env_base + 4, prog_name)

    # Compute DS segment (from labels.csv: DS file base = 0x055D80, header = 0x6A00)
    # DS physical = image_base + (0x055D80 - 0x6A00) = image_base + 0x4F380
    # DS segment = (image_base + 0x4F380) >> 4
    # But actually DS is set by the C runtime, not by the loader.
    # The initial DS=ES=PSP segment per DOS convention.

    info = {
        'load_seg': load_seg,
        'image_seg': image_seg,
        'entry_cs': image_seg + e_cs,
        'entry_ip': e_ip,
        'entry_ss': image_seg + e_ss,
        'entry_sp': e_sp,
        'image_base': image_base,
        'image_size': image_size,
        'num_relocs': reloc_count,
        'header_size': header_size,
        'exe_data': exe,
    }
    return info


def setup_ivt(mem):
    """Pre-populate IVT with IRET stubs.
    Each INT vector points to an IRET instruction in a stub area at 0x0500.
    """
    stub_base = 0x0500
    for i in range(256):
        stub_addr = stub_base + i
        mem.write8(stub_addr, 0xCF)  # IRET
        # IVT entry at i*4: offset, segment
        stub_seg = stub_addr >> 4
        stub_off = stub_addr & 0xF
        mem.write16(i * 4, stub_off)
        mem.write16(i * 4 + 2, stub_seg)


def setup_cpu(cpu, info):
    """Set initial CPU state from load info."""
    cpu.segs[cpu.CS] = info['entry_cs']
    cpu.ip = info['entry_ip']
    cpu.segs[cpu.SS] = info['entry_ss']
    cpu.sp = info['entry_sp']
    cpu.segs[cpu.DS] = info['load_seg']  # DS = PSP segment per DOS convention
    cpu.segs[cpu.ES] = info['load_seg']  # ES = PSP segment per DOS convention
    cpu.ax = 0
    cpu.bx = 0
    cpu.cx = 0
    cpu.dx = 0
    cpu.si = 0
    cpu.di = 0
    cpu.bp = 0
