import struct, math

# DS:0x6164 = 0x2372, 0x1A5D, 0xA5DC, 0x404C in little-endian words
data = bytes([0x72, 0x23, 0x5D, 0x1A, 0xDC, 0xA5, 0x4C, 0x40])
val = struct.unpack('<d', data)[0]
print(f'DS:0x6164 as double: {val}')
print(f'  180/pi = {180/math.pi:.10f}')
print(f'  ratio: {val / (180/math.pi):.6f}')
