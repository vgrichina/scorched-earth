"""DOS MTN enumeration must match wildcard names without regard to case."""
from pathlib import Path
from tempfile import TemporaryDirectory
from emu.cpu import CPU
from emu.memory import Memory
from emu.interrupts import InterruptHandler

with TemporaryDirectory() as directory:
    for name in ('ROCK001.MTN', 'ice002.mtn', 'NOTES.TXT'):
        Path(directory, name).write_bytes(b'fixture')
    cpu, mem = CPU(), Memory()
    handler = InterruptHandler(mem, cpu, directory)
    handler._dta_seg = 0x8000
    handler._dta_off = 0
    mem.data[0x90000:0x90006] = b'*.mtn\0'
    cpu.segs[3], cpu.dx, cpu.cx, cpu.ax = 0x9000, 0, 0, 0x4E00
    handler.handle(0x21)
    names = []
    while not cpu.cf:
        names.append(bytes(mem.data[0x8001E:0x8002B]).split(b'\0')[0])
        cpu.ax = 0x4F00
        handler.handle(0x21)
    assert names == [b'ICE002.MTN', b'ROCK001.MTN'], names
    assert cpu.ax == 18
    name = b'ROCK001.MTN\0'
    mem.data[0x90000:0x90000+len(name)] = name
    # Repeated scans must not exhaust the guest's small file-handle table.
    for _ in range(40):
        cpu.ax, cpu.dx = 0x3D00, 0
        handler.handle(0x21)
        assert cpu.cf == 0 and cpu.ax == 5
        cpu.bx, cpu.ax = cpu.ax, 0x3E00
        handler.handle(0x21)
        assert cpu.cf == 0
print('DOS case-insensitive wildcard enumeration and end-of-search pass.')
print('DOS closed handles are reused across 40 open/close cycles.')
