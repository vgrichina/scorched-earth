"""VGA port I/O handlers: palette, sequencer, CRTC, GC, vsync."""


class PortIO:
    def __init__(self):
        self.palette = [(0, 0, 0)] * 256
        self._pal_write_idx = 0
        self._pal_write_comp = 0  # 0=R, 1=G, 2=B
        self._pal_read_idx = 0
        self._pal_read_comp = 0
        self._vsync_toggle = 0

        # VGA Sequencer (port 0x3C4/0x3C5)
        self._seq_index = 0
        self.seq_regs = [0] * 8  # 8 sequencer registers
        self.seq_regs[2] = 0x0F  # Map Mask: all planes enabled by default

        # VGA CRTC (port 0x3D4/0x3D5)
        self._crtc_index = 0
        self.crtc_regs = [0] * 64

        # VGA Graphics Controller (port 0x3CE/0x3CF)
        self._gc_index = 0
        self.gc_regs = [0] * 16
        self.gc_regs[4] = 0  # Read Map Select: plane 0

        # Keyboard controller (port 0x60/0x61)
        self.kbd_scancode = 0  # last scancode from port 0x60
        self.kbd_queue = []    # pending scancodes to deliver

        # Mode tracking
        self.video_mode = 0x13  # default mode 13h
        self.mem = None  # set by __main__ for cache sync
    @property
    def mode_x(self):
        """True if VGA is in unchained/planar mode (Mode X): seq reg 4 chain-4 bit cleared."""
        return not (self.seq_regs[4] & 0x08)

    @property
    def map_mask(self):
        """Sequencer register 2: which planes are written."""
        return self.seq_regs[2] & 0x0F

    @property
    def read_plane(self):
        """GC register 4: which plane is read."""
        return self.gc_regs[4] & 0x03

    def _sync_mem(self):
        """Push cached VGA state to Memory for fast path."""
        if self.mem:
            self.mem._mode_x = not (self.seq_regs[4] & 0x08)
            self.mem._map_mask = self.seq_regs[2] & 0x0F
            self.mem._read_plane = self.gc_regs[4] & 0x03

    def set_mode(self, mode):
        """Called by INT 10h AH=00 to reset VGA state."""
        self.video_mode = mode & 0x7F
        self.seq_regs[4] = 0x08  # reset to chained (mode 13h default)
        self.seq_regs[2] = 0x0F
        self.gc_regs[4] = 0
        self._sync_mem()

    def port_in(self, port):
        if port == 0x3DA:
            # VGA status: toggle bit 3 (vsync) so wait loops terminate
            self._vsync_toggle ^= 0x08
            return self._vsync_toggle
        if port == 0x3C9:
            # Read palette RGB component
            idx = self._pal_read_idx
            comp = self._pal_read_comp
            val = self.palette[idx][comp]
            self._pal_read_comp += 1
            if self._pal_read_comp >= 3:
                self._pal_read_comp = 0
                self._pal_read_idx = (self._pal_read_idx + 1) & 0xFF
            return val
        if port == 0x3C5:
            return self.seq_regs[self._seq_index & 7]
        if port == 0x3D5:
            return self.crtc_regs[self._crtc_index & 0x3F]
        if port == 0x3CF:
            return self.gc_regs[self._gc_index & 0x0F]
        if port == 0x3C4:
            return self._seq_index
        if port == 0x3D4:
            return self._crtc_index
        if port == 0x60:
            return self.kbd_scancode
        if port == 0x61:
            return 0x00  # keyboard controller status
        if port == 0x201:
            return 0x00  # Joystick: no buttons pressed, all axes done
        # All other ports: return 0xFF
        return 0xFF

    def port_out(self, port, val):
        # VGA 16-bit OUT to even index ports: low byte = index, high byte = data
        if val > 0xFF and port in (0x3C4, 0x3CE, 0x3D4):
            self.port_out(port, val & 0xFF)
            self.port_out(port + 1, (val >> 8) & 0xFF)
            return
        if port == 0x3C8:
            self._pal_write_idx = val & 0xFF
            self._pal_write_comp = 0
        elif port == 0x3C7:
            self._pal_read_idx = val & 0xFF
            self._pal_read_comp = 0
        elif port == 0x3C9:
            idx = self._pal_write_idx
            r, g, b = self.palette[idx]
            comp = self._pal_write_comp
            if comp == 0:
                r = val & 0x3F
            elif comp == 1:
                g = val & 0x3F
            else:
                b = val & 0x3F
            self.palette[idx] = (r, g, b)
            self._pal_write_comp += 1
            if self._pal_write_comp >= 3:
                self._pal_write_comp = 0
                self._pal_write_idx = (self._pal_write_idx + 1) & 0xFF
        elif port == 0x3C4:
            self._seq_index = val & 0xFF
        elif port == 0x3C5:
            idx = self._seq_index & 7
            self.seq_regs[idx] = val & 0xFF
            if idx in (2, 4):
                self._sync_mem()
        elif port == 0x3D4:
            self._crtc_index = val & 0xFF
        elif port == 0x3D5:
            self.crtc_regs[self._crtc_index & 0x3F] = val & 0xFF
        elif port == 0x3CE:
            self._gc_index = val & 0xFF
        elif port == 0x3CF:
            self.gc_regs[self._gc_index & 0x0F] = val & 0xFF
            if self._gc_index & 0x0F == 4:
                self._sync_mem()

    def get_resolution(self):
        """Estimate screen resolution from CRTC registers."""
        if not self.mode_x:
            return 320, 200  # Standard mode 13h

        # Mode X: read CRTC vertical display end (reg 0x12) + overflow (reg 0x07)
        vde = self.crtc_regs[0x12]
        overflow = self.crtc_regs[0x07]
        height = vde | ((overflow & 0x02) << 7) | ((overflow & 0x40) << 3)
        height += 1  # VDE is 0-based

        # Horizontal: CRTC reg 0x01 (end horizontal display) + 1
        # In Mode X each clock = 4 pixels (unchained), not 8
        hde = self.crtc_regs[0x01]
        width = (hde + 1) * 4 if hde else 320

        # Double-scan: CRTC reg 0x09 bit 7 — halves visible height
        max_scan = self.crtc_regs[0x09]
        if max_scan & 0x80:
            height = (height + 1) // 2

        # Clamp to sane values
        if width < 160 or width > 400:
            width = 320
        if height < 100 or height > 600:
            height = 200

        return width, height
