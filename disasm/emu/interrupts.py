"""DOS/BIOS interrupt handlers for INT 10h, 16h, 1Ah, 21h, 33h."""

import os
import collections


class EmuExit(Exception):
    """Raised by INT 21h/4Ch to terminate emulation."""
    def __init__(self, code=0):
        self.code = code
        super().__init__(f"Program exit with code {code}")


class InterruptHandler:
    def __init__(self, mem, cpu, earth_dir='earth'):
        self.mem = mem
        self.cpu = cpu
        self.earth_dir = earth_dir

        # Keyboard input queue
        self.key_queue = collections.deque()

        # Timer tick counter
        self.tick_count = 0

        # File handle table: DOS handle → Python file object
        self._files = {}
        self._next_handle = 5  # 0-4 reserved for std streams

        # DTA (Disk Transfer Area)
        self._dta_seg = 0
        self._dta_off = 0x80  # default: PSP:0x80

        # Heap allocator: next free segment
        self._heap_seg = 0  # set by init_heap()

        # Find first/next state
        self._find_results = []
        self._find_idx = 0

        # Callback for tracing
        self.on_int = None  # optional callback(int_num, ah)

    def init_heap(self, after_image_seg):
        """Set heap start segment after the loaded image + stack."""
        self._heap_seg = after_image_seg

    def push_key(self, scancode, ascii_char=0):
        self.key_queue.append((scancode, ascii_char))

    # -- Main dispatcher ------------------------------------------------------

    def handle(self, int_num):
        """Handle software interrupt. Returns True if handled, False if should
        chain to IVT handler in memory."""
        if self.on_int:
            self.on_int(int_num, self.cpu.get_reg8(4))  # AH

        if int_num == 0x10:
            return self._int10()
        if int_num == 0x16:
            return self._int16()
        if int_num == 0x1A:
            return self._int1a()
        if int_num == 0x21:
            return self._int21()
        if int_num == 0x33:
            return self._int33()

        # INT 34h-3Dh: FPU — these should be handled by the executor, not here.
        # INT 00h: divide error
        if int_num == 0x00:
            raise RuntimeError(f"Divide by zero at CS:IP={self.cpu.segs[1]:04X}:{self.cpu.ip:04X}")

        # Unhandled: return False to chain to IVT
        return False

    # -- INT 10h: BIOS Video --------------------------------------------------

    def _int10(self):
        ah = self.cpu.get_reg8(4)
        if ah == 0x00:  # Set video mode
            pass  # no-op
        elif ah == 0x0F:  # Get video mode
            self.cpu.set_reg8(0, 0x13)  # AL = mode 13h
            self.cpu.set_reg8(4, 0x00)  # AH = 0 (page)
            self.cpu.set_reg8(4, 0)
        elif ah == 0x10:  # Palette
            pass  # handled by port I/O
        elif ah == 0x11:  # Font
            pass  # no-op
        return True

    # -- INT 16h: Keyboard ----------------------------------------------------

    def _int16(self):
        ah = self.cpu.get_reg8(4)
        if ah == 0x00:  # Blocking read
            if self.key_queue:
                sc, asc = self.key_queue.popleft()
                self.cpu.set_reg8(4, sc)  # AH = scancode
                self.cpu.set_reg8(0, asc)  # AL = ASCII
            else:
                # No key available — return ESC to unblock
                self.cpu.set_reg8(4, 0x01)  # ESC scancode
                self.cpu.set_reg8(0, 0x1B)  # ESC ASCII
        elif ah == 0x01:  # Peek
            if self.key_queue:
                sc, asc = self.key_queue[0]
                self.cpu.set_reg8(4, sc)
                self.cpu.set_reg8(0, asc)
                self.cpu.zf = 0  # key available
            else:
                self.cpu.zf = 1  # no key
        return True

    # -- INT 1Ah: Timer -------------------------------------------------------

    def _int1a(self):
        ah = self.cpu.get_reg8(4)
        if ah == 0x00:
            self.tick_count += 1
            self.cpu.cx = (self.tick_count >> 16) & 0xFFFF
            self.cpu.dx = self.tick_count & 0xFFFF
            self.cpu.set_reg8(0, 0)  # AL = midnight flag
        return True

    # -- INT 33h: Mouse -------------------------------------------------------

    def _int33(self):
        # No mouse driver: return AX=0 for init, no-op for rest
        self.cpu.ax = 0
        return True

    # -- INT 21h: DOS ---------------------------------------------------------

    def _int21(self):
        ah = self.cpu.get_reg8(4)

        if ah == 0x1A:  # Set DTA
            self._dta_seg = self.cpu.segs[3]  # DS
            self._dta_off = self.cpu.dx
            return True

        if ah == 0x25:  # Set interrupt vector
            int_num = self.cpu.get_reg8(0)  # AL
            off = self.cpu.dx
            seg = self.cpu.segs[3]  # DS
            self.mem.write16(int_num * 4, off)
            self.mem.write16(int_num * 4 + 2, seg)
            return True

        if ah == 0x30:  # Get DOS version
            self.cpu.set_reg8(0, 3)    # AL = major version
            self.cpu.set_reg8(4, 10)   # AH = minor version
            self.cpu.bx = 0
            self.cpu.cx = 0
            return True

        if ah == 0x35:  # Get interrupt vector
            int_num = self.cpu.get_reg8(0)  # AL
            off = self.mem.read16(int_num * 4)
            seg = self.mem.read16(int_num * 4 + 2)
            self.cpu.bx = off
            self.cpu.segs[0] = seg  # ES
            return True

        if ah == 0x3D:  # Open file
            return self._dos_open()
        if ah == 0x3E:  # Close file
            return self._dos_close()
        if ah == 0x3F:  # Read file
            return self._dos_read()
        if ah == 0x40:  # Write file
            return self._dos_write()
        if ah == 0x42:  # Seek
            return self._dos_seek()

        if ah == 0x48:  # Allocate memory
            paras = self.cpu.bx
            seg = self._heap_seg
            self._heap_seg += paras
            self.cpu.ax = seg
            self.cpu.cf = 0
            return True

        if ah == 0x49:  # Free memory
            self.cpu.cf = 0
            return True

        if ah == 0x4A:  # Resize memory block
            self.cpu.cf = 0
            return True

        if ah == 0x4C:  # Exit
            raise EmuExit(self.cpu.get_reg8(0))

        if ah == 0x4E:  # Find first
            return self._dos_find_first()
        if ah == 0x4F:  # Find next
            return self._dos_find_next()

        if ah == 0x58:  # Get/set allocation strategy
            self.cpu.ax = 0
            self.cpu.cf = 0
            return True

        if ah == 0x67:  # Set max handles
            self.cpu.cf = 0
            return True

        # Unknown — succeed silently
        self.cpu.cf = 0
        return True

    # -- DOS file operations --------------------------------------------------

    def _read_dos_string(self, seg, off):
        """Read NUL-terminated string from memory."""
        chars = []
        while True:
            b = self.mem.read8(self.mem.phys(seg, off))
            if b == 0:
                break
            chars.append(chr(b))
            off += 1
        return ''.join(chars)

    def _resolve_path(self, dos_path):
        """Map DOS filename to local earth/ path."""
        # Strip any drive letter
        if len(dos_path) >= 2 and dos_path[1] == ':':
            dos_path = dos_path[2:]
        dos_path = dos_path.replace('\\', '/')
        fname = os.path.basename(dos_path)
        return os.path.join(self.earth_dir, fname)

    def _dos_open(self):
        dos_path = self._read_dos_string(self.cpu.segs[3], self.cpu.dx)
        local_path = self._resolve_path(dos_path)
        mode = self.cpu.get_reg8(0)  # AL = access mode
        try:
            if mode == 0:
                f = open(local_path, 'rb')
            elif mode == 1:
                f = open(local_path, 'r+b')
            else:
                f = open(local_path, 'r+b')
            handle = self._next_handle
            self._next_handle += 1
            self._files[handle] = f
            self.cpu.ax = handle
            self.cpu.cf = 0
        except FileNotFoundError:
            self.cpu.ax = 2  # file not found
            self.cpu.cf = 1
        return True

    def _dos_close(self):
        handle = self.cpu.bx
        if handle in self._files:
            self._files[handle].close()
            del self._files[handle]
        self.cpu.cf = 0
        return True

    def _dos_read(self):
        handle = self.cpu.bx
        count = self.cpu.cx
        buf_addr = self.mem.phys(self.cpu.segs[3], self.cpu.dx)
        if handle in self._files:
            data = self._files[handle].read(count)
            self.mem.load_bytes(buf_addr, data)
            self.cpu.ax = len(data)
            self.cpu.cf = 0
        else:
            self.cpu.ax = 6  # invalid handle
            self.cpu.cf = 1
        return True

    def _dos_write(self):
        handle = self.cpu.bx
        count = self.cpu.cx
        buf_addr = self.mem.phys(self.cpu.segs[3], self.cpu.dx)
        data = self.mem.read_bytes(buf_addr, count)
        if handle in (1, 2):
            # stdout/stderr — print as debug
            try:
                print(data.decode('ascii', errors='replace'), end='')
            except Exception:
                pass
            self.cpu.ax = count
            self.cpu.cf = 0
        elif handle in self._files:
            self._files[handle].write(data)
            self.cpu.ax = count
            self.cpu.cf = 0
        else:
            self.cpu.ax = 6
            self.cpu.cf = 1
        return True

    def _dos_seek(self):
        handle = self.cpu.bx
        method = self.cpu.get_reg8(0)  # AL
        offset = (self.cpu.cx << 16) | self.cpu.dx
        if handle in self._files:
            self._files[handle].seek(offset, method)
            pos = self._files[handle].tell()
            self.cpu.dx = (pos >> 16) & 0xFFFF
            self.cpu.ax = pos & 0xFFFF
            self.cpu.cf = 0
        else:
            self.cpu.ax = 6
            self.cpu.cf = 1
        return True

    def _dos_find_first(self):
        pattern = self._read_dos_string(self.cpu.segs[3], self.cpu.dx)
        local_pattern = self._resolve_path(pattern)
        import glob
        matches = sorted(glob.glob(local_pattern))
        if matches:
            self._find_results = matches
            self._find_idx = 0
            self._fill_dta(matches[0])
            self._find_idx = 1
            self.cpu.cf = 0
        else:
            self.cpu.ax = 18  # no more files
            self.cpu.cf = 1
        return True

    def _dos_find_next(self):
        if self._find_idx < len(self._find_results):
            self._fill_dta(self._find_results[self._find_idx])
            self._find_idx += 1
            self.cpu.cf = 0
        else:
            self.cpu.ax = 18
            self.cpu.cf = 1
        return True

    def _fill_dta(self, filepath):
        """Write find result to DTA."""
        dta = self.mem.phys(self._dta_seg, self._dta_off)
        # DTA layout: 0x00-0x14 reserved, 0x15 attr, 0x16-0x19 time/date,
        # 0x1A-0x1D size, 0x1E-0x2A filename (13 bytes, NUL-terminated)
        fname = os.path.basename(filepath).upper()[:12]
        size = os.path.getsize(filepath) if os.path.exists(filepath) else 0
        self.mem.write8(dta + 0x15, 0x20)  # archive attribute
        self.mem.write16(dta + 0x16, 0)  # time
        self.mem.write16(dta + 0x18, 0)  # date
        self.mem.write32(dta + 0x1A, size & 0xFFFFFFFF)
        for i, ch in enumerate(fname.encode('ascii')):
            self.mem.write8(dta + 0x1E + i, ch)
        self.mem.write8(dta + 0x1E + len(fname), 0)
