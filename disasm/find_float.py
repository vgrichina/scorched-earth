import struct

EXE_PATH = "earth/SCORCH.EXE"
DS_BASE = 0x055D80

def search_bytes(data, pattern, label):
    results = []
    start = 0
    while True:
        idx = data.find(pattern, start)
        if idx == -1:
            break
        ds_off = idx - DS_BASE
        ds_str = "DS:0x{:04X}".format(ds_off) if 0 <= ds_off < 0x10000 else "(outside DS)"
        print("  {}: file=0x{:06X}  {}".format(label, idx, ds_str))
        results.append(idx)
        start = idx + 1
    if not results:
        print("  {}: not found".format(label))
    return results

with open(EXE_PATH, "rb") as f:
    data = f.read()

for val in [1.5, 400.0, 160000.0, 5000.0]:
    p32 = struct.pack("<f", val)
    p64 = struct.pack("<d", val)
    print("float32 {}: {}".format(val, p32.hex()))
    search_bytes(data, p32, "f32")
    print("float64 {}: {}".format(val, p64.hex()))
    search_bytes(data, p64, "f64")
    print()
