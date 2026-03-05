"""Binary state dump and restore for the emulator.

Format (all little-endian):
  Magic: 8 bytes "EMUSTATE"
  Version: u32 (1)
  --- CPU ---
  regs[0..7]: 8 × u16
  segs[0..3]: 4 × u16
  ip: u16
  flags: u16 (packed via get_flags)
  halted: u8
  --- FPU ---
  fpu_top: u8
  fpu_sw: u16
  fpu_cw: u16
  fpu_stack[0..7]: 8 × f64
  --- Memory ---
  mode_x: u8
  map_mask: u8
  read_plane: u8
  data: 1MB raw bytes
  vga_planes: 4 × 64KB raw bytes
  --- Ports ---
  video_mode: u8
  pal_write_idx: u8
  pal_write_comp: u8
  pal_read_idx: u8
  pal_read_comp: u8
  vsync_toggle: u8
  seq_index: u8
  seq_regs: 8 bytes
  crtc_index: u8
  crtc_regs: 64 bytes
  gc_index: u8
  gc_regs: 16 bytes
  palette: 256 × 3 bytes (R,G,B)
  --- InterruptHandler ---
  tick_count: u32
  heap_seg: u16
  next_handle: u16
  dta_seg: u16
  dta_off: u16
"""

import struct

MAGIC = b'EMUSTATE'
VERSION = 1


def save_state(path, cpu, mem, ports, int_handler):
    with open(path, 'wb') as f:
        f.write(MAGIC)
        f.write(struct.pack('<I', VERSION))

        # CPU regs
        for r in cpu.regs:
            f.write(struct.pack('<H', r))
        for s in cpu.segs:
            f.write(struct.pack('<H', s))
        f.write(struct.pack('<H', cpu.ip))
        f.write(struct.pack('<H', cpu.get_flags()))
        f.write(struct.pack('<B', 1 if cpu.halted else 0))

        # FPU
        f.write(struct.pack('<B', cpu.fpu_top))
        f.write(struct.pack('<H', cpu.fpu_sw))
        f.write(struct.pack('<H', cpu.fpu_cw))
        for i in range(8):
            f.write(struct.pack('<d', cpu.fpu_stack[i]))

        # Memory
        f.write(struct.pack('<BBB',
                            1 if mem._mode_x else 0,
                            mem._map_mask,
                            mem._read_plane))
        f.write(bytes(mem.data))
        for plane in mem.vga_planes:
            f.write(bytes(plane))

        # Ports
        f.write(struct.pack('<BBBBBB',
                            ports.video_mode & 0xFF,
                            ports._pal_write_idx & 0xFF,
                            ports._pal_write_comp & 0xFF,
                            ports._pal_read_idx & 0xFF,
                            ports._pal_read_comp & 0xFF,
                            ports._vsync_toggle & 0xFF))
        f.write(struct.pack('<B', ports._seq_index & 0xFF))
        f.write(bytes(ports.seq_regs[:8]).ljust(8, b'\x00'))
        f.write(struct.pack('<B', ports._crtc_index & 0xFF))
        f.write(bytes(ports.crtc_regs[:64]).ljust(64, b'\x00'))
        f.write(struct.pack('<B', ports._gc_index & 0xFF))
        f.write(bytes(ports.gc_regs[:16]).ljust(16, b'\x00'))
        for r, g, b in ports.palette:
            f.write(struct.pack('<BBB', r & 0xFF, g & 0xFF, b & 0xFF))

        # InterruptHandler
        f.write(struct.pack('<IHHHH',
                            int_handler.tick_count,
                            int_handler._heap_seg & 0xFFFF,
                            int_handler._next_handle & 0xFFFF,
                            int_handler._dta_seg & 0xFFFF,
                            int_handler._dta_off & 0xFFFF))


def load_state(path, cpu, mem, ports, int_handler):
    with open(path, 'rb') as f:
        magic = f.read(8)
        if magic != MAGIC:
            raise ValueError(f"Bad magic: {magic!r}")
        ver, = struct.unpack('<I', f.read(4))
        if ver != VERSION:
            raise ValueError(f"Unknown version: {ver}")

        # CPU regs
        for i in range(8):
            cpu.regs[i], = struct.unpack('<H', f.read(2))
        for i in range(4):
            cpu.segs[i], = struct.unpack('<H', f.read(2))
        cpu.ip, = struct.unpack('<H', f.read(2))
        flags, = struct.unpack('<H', f.read(2))
        cpu.set_flags(flags)
        cpu.halted = bool(struct.unpack('<B', f.read(1))[0])

        # FPU
        cpu.fpu_top, = struct.unpack('<B', f.read(1))
        cpu.fpu_sw, = struct.unpack('<H', f.read(2))
        cpu.fpu_cw, = struct.unpack('<H', f.read(2))
        for i in range(8):
            cpu.fpu_stack[i], = struct.unpack('<d', f.read(8))

        # Memory
        mode_x, map_mask, read_plane = struct.unpack('<BBB', f.read(3))
        mem._mode_x = bool(mode_x)
        mem._map_mask = map_mask
        mem._read_plane = read_plane
        mem.data[:] = f.read(1 << 20)
        for i in range(4):
            mem.vga_planes[i][:] = f.read(0x10000)

        # Ports
        (ports.video_mode, ports._pal_write_idx, ports._pal_write_comp,
         ports._pal_read_idx, ports._pal_read_comp,
         ports._vsync_toggle) = struct.unpack('<BBBBBB', f.read(6))
        ports._seq_index, = struct.unpack('<B', f.read(1))
        seq_data = f.read(8)
        for i in range(8):
            ports.seq_regs[i] = seq_data[i]
        ports._crtc_index, = struct.unpack('<B', f.read(1))
        crtc_data = f.read(64)
        for i in range(64):
            ports.crtc_regs[i] = crtc_data[i]
        ports._gc_index, = struct.unpack('<B', f.read(1))
        gc_data = f.read(16)
        for i in range(16):
            ports.gc_regs[i] = gc_data[i]
        pal_data = f.read(768)
        for i in range(256):
            ports.palette[i] = (pal_data[i*3], pal_data[i*3+1], pal_data[i*3+2])

        # Sync memory VGA cache from ports
        ports._sync_mem()

        # InterruptHandler
        (int_handler.tick_count, int_handler._heap_seg,
         int_handler._next_handle, int_handler._dta_seg,
         int_handler._dta_off) = struct.unpack('<IHHHH', f.read(12))
