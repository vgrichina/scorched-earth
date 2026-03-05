"""VGA port I/O handlers: palette, vsync, sequencer stubs."""


class PortIO:
    def __init__(self):
        self.palette = [(0, 0, 0)] * 256
        self._pal_write_idx = 0
        self._pal_write_comp = 0  # 0=R, 1=G, 2=B
        self._pal_read_idx = 0
        self._pal_read_comp = 0
        self._vsync_toggle = 0

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
        # All other ports: return 0xFF
        return 0xFF

    def port_out(self, port, val):
        if port == 0x3C8:
            # Set palette write index
            self._pal_write_idx = val & 0xFF
            self._pal_write_comp = 0
        elif port == 0x3C7:
            # Set palette read index
            self._pal_read_idx = val & 0xFF
            self._pal_read_comp = 0
        elif port == 0x3C9:
            # Write palette RGB component
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
        # 0x3C4/0x3C5, 0x3CE/0x3CF, 0x3D4/0x3D5: silently ignored
