#!/usr/bin/env python3
"""Extract all fg_setrgb(index, R, G, B) calls with immediate args from EXE.
Prints index, R, G, B for each call where all 4 args are immediate pushes."""

data = open('earth/SCORCH.EXE', 'rb').read()

# fg_setrgb call pattern: 9A 05 00 6B 45
CALL_PATTERN = bytes([0x9A, 0x05, 0x00, 0x6B, 0x45])

results = []
pos = 0x6A00  # skip header
while True:
    pos = data.find(CALL_PATTERN, pos)
    if pos == -1:
        break

    # Walk backwards to find 4 pushes
    # Each push is either: 6A xx (push imm8) or 68 xx xx (push imm16) or FF 36 xx xx (push [mem])
    args = []
    bp = pos
    for _ in range(4):
        # Check what's before bp
        if bp >= 2 and data[bp-2] == 0x6A:  # push imm8
            args.insert(0, ('imm', data[bp-1]))
            bp -= 2
        elif bp >= 3 and data[bp-3] == 0x68:  # push imm16
            args.insert(0, ('imm', data[bp-2] | (data[bp-1] << 8)))
            bp -= 3
        elif bp >= 4 and data[bp-4] == 0xFF and data[bp-3] == 0x36:  # push [mem16]
            addr = data[bp-2] | (data[bp-1] << 8)
            args.insert(0, ('mem', addr))
            bp -= 4
        else:
            args.insert(0, ('?', 0))

    # args[0]=index, args[1]=R, args[2]=G, args[3]=B (right-to-left push, so B pushed first)
    # Actually: fg_setrgb(index, R, G, B) in C → push B, push G, push R, push index
    # So reading backwards from call: index is closest, then R, G, B
    # Wait - stack grows down, args pushed right-to-left:
    #   push B  (first push, furthest from call)
    #   push G
    #   push R
    #   push index (last push, closest to call)
    # So args[0]=B (furthest), args[1]=G, args[2]=R, args[3]=index (closest to call)
    # Actually my loop reads backwards from call, so args[0] is closest = index
    # Let me re-check: I insert(0,...) each time, and go backwards
    # Iteration 1: bp before call → finds closest push = index → args = [index]
    # Iteration 2: bp before that → finds R → args = [R, index]
    # Iteration 3: → args = [G, R, index]
    # Iteration 4: → args = [B, G, R, index]
    # So: args = [B, G, R, index]
    idx_info = args[3]
    r_info = args[2]
    g_info = args[1]
    b_info = args[0]

    all_imm = all(a[0] == 'imm' for a in args)

    if all_imm:
        results.append((idx_info[1], r_info[1], g_info[1], b_info[1], pos))
    else:
        # Show mem refs too
        parts = []
        for name, info in zip(['idx','R','G','B'], [idx_info, r_info, g_info, b_info]):
            if info[0] == 'imm':
                parts.append(f"{name}={info[1]}")
            elif info[0] == 'mem':
                parts.append(f"{name}=[DS:{info[1]:04X}]")
            else:
                parts.append(f"{name}=?")
        results.append(tuple(parts) + (pos,))

    pos += 5

# Print grouped by index
print("=== All-immediate fg_setrgb calls ===")
print(f"{'Index':>5} {'R':>3} {'G':>3} {'B':>3}  file_offset")
print("-" * 45)
imm_calls = [(idx, r, g, b, off) for x in results if isinstance(x[0], int) for idx, r, g, b, off in [x]]
imm_calls.sort(key=lambda x: (x[0], x[4]))
for idx, r, g, b, off in imm_calls:
    print(f"{idx:>5} {r:>3} {g:>3} {b:>3}  0x{off:05X}")

print(f"\n=== Calls with memory-indirect args ({sum(1 for x in results if isinstance(x[0], str))}) ===")
for x in results:
    if isinstance(x[0], str):
        print(f"  {x[0]}, {x[1]}, {x[2]}, {x[3]}  @ 0x{x[4]:05X}")
