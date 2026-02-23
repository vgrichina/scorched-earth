import struct

def d(words):
    """Decode little-endian words to IEEE double"""
    bs = b''.join(w.to_bytes(2, 'little') for w in words)
    return struct.unpack('<d', bs)[0]

def f(words):
    """Decode little-endian words to IEEE float"""
    bs = b''.join(w.to_bytes(2, 'little') for w in words)
    return struct.unpack('<f', bs)[0]

# DS:0x322E — double used as freq_base divisor: fdivr qword [0x322e]
const_322E = d([0x866E, 0xF01B, 0x21F9, 0x4009])
print(f"DS:0x322E (double) = {const_322E}")

# DS:0x3236 — double used as freq_cap divisor: fdivr qword [0x3236]
const_3236 = d([0x866E, 0xF01B, 0x21F9, 0x4019])
print(f"DS:0x3236 (double) = {const_3236}")

# DS:0x323E — float used as freq_multiplier scalar: fmul dword [0x323e]
const_323E = f([0x0000, 0x4080])
print(f"DS:0x323E (float)  = {const_323E}")

# DS:0x3242 — float used as amplitude scale: fmul dword [0x3242]
const_3242 = f([0x0000, 0x3F00])
print(f"DS:0x3242 (float)  = {const_3242}")

# DS:0x3246 — float used as budget deduction per harmonic: fmul dword [0x3246]
const_3246 = f([0x0000, 0x4000])
print(f"DS:0x3246 (float)  = {const_3246}")
