"""Banked 8-bit VESA adapter used by the native Fastgraph driver."""
import struct

MODES = {0x100:(640,400), 0x101:(640,480), 0x103:(800,600), 0x105:(1024,768)}
VRAM_SIZE = 1 << 20
BANK_CALLBACK = 0xf1000
MODE_LIST = 0xf1100


def handle(cpu, mem, ports):
    function = cpu.ax & 0xff
    cpu.ax = 0x014f
    if ports is None:
        return
    if function == 0:
        info = bytearray(256)
        info[:4] = b'VESA'
        struct.pack_into('<H', info, 4, 0x0102)
        struct.pack_into('<HH', info, 14, 0x1100, 0xf000)
        struct.pack_into('<H', info, 18, VRAM_SIZE // 65536)
        mem.load_bytes(MODE_LIST, struct.pack('<5H', *MODES, 0xffff))
        mem.load_bytes(mem.phys(cpu.segs[0], cpu.regs[7]), info)
    elif function == 1:
        mode = cpu.cx & 0x3fff
        if mode not in MODES:
            return
        w,h = MODES[mode]
        info = bytearray(256)
        struct.pack_into('<HBBHHHHHHHHH', info, 0,
                         0x1b, 7, 0, 64, 64, 0xa000, 0, 0x1000, 0xf000, w, w, h)
        info[22:30] = bytes((8,16,1,8,1,4,64,VRAM_SIZE//(w*h)-1))
        # Fastgraph calls this real-mode entry point to switch banks.
        mem.load_bytes(BANK_CALLBACK, bytes.fromhex('b8054fcd10cb'))
        mem.load_bytes(mem.phys(cpu.segs[0], cpu.regs[7]), info)
    elif function == 2:
        mode = cpu.bx & 0x3fff
        if mode not in MODES or cpu.bx & 0x4000:
            return
        ports.vesa_mode = mode
        ports.vesa_bank = 0
        ports.vesa_start = 0
        if not cpu.bx & 0x8000:
            mem.vesa_vram[:] = bytes(VRAM_SIZE)
        ports._sync_mem()
    elif function == 3:
        cpu.bx = ports.vesa_mode or ports.video_mode
    elif function == 5:
        if not ports.vesa_mode or (cpu.bx & 0xff) != 0:
            return
        if cpu.bx >> 8 == 1:
            cpu.dx = ports.vesa_bank
        elif cpu.bx >> 8 == 0 and cpu.dx < VRAM_SIZE // 65536:
            ports.vesa_bank = cpu.dx
            ports._sync_mem()
        else:
            return
    elif function == 7:
        if not ports.vesa_mode:
            return
        w,h = MODES[ports.vesa_mode]
        if cpu.bx == 1:
            cpu.dx,cpu.cx = divmod(ports.vesa_start,w)
        elif cpu.bx in (0,0x80) and cpu.dx*w+cpu.cx+w*h <= VRAM_SIZE:
            ports.vesa_start = cpu.dx*w+cpu.cx
        else:
            return
    else:
        return
    cpu.ax = 0x004f
