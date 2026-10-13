"""DOS relative seeks must preserve signed CX:DX displacements."""
import io
from emu.cpu import CPU
from emu.memory import Memory
from emu.interrupts import InterruptHandler

cpu = CPU()
handler = InterruptHandler(Memory(), cpu)
stream = io.BytesIO(bytes(range(256)) * 4)
handler._files[5] = stream
for handle, device, carry in ((0, 0x80, 0), (5, 0, 0), (99, None, 1)):
    cpu.ax, cpu.bx = 0x4400, handle
    handler.handle(0x21)
    assert cpu.cf == carry
    if not carry: assert cpu.dx == device
    else: assert cpu.ax == 6
for position, method, delta, expected in ((600, 1, -512, 88),
                                         (0, 2, -1, 1023),
                                         (20, 1, 40, 60),
                                         (900, 0, 72, 72)):
    stream.seek(position)
    cpu.ax = 0x4200 | method
    cpu.bx = 5
    cpu.cx = (delta >> 16) & 65535
    cpu.dx = delta & 65535
    handler.handle(0x21)
    assert cpu.cf == 0 and stream.tell() == expected
    assert (cpu.dx << 16 | cpu.ax) == expected
print('DOS signed relative/end seeks and absolute seeks pass.')
