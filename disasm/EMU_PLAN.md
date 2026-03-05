# Plan: disasm/emu.py — Full x86 DOS Emulator for SCORCH.EXE

## Context

Scorched Earth v1.50 physics/AI have accumulated mismatches vs the web reimplementation that are hard to pin down by static RE alone. The fix: run the original EXE in a scriptable Python x86 emulator, inject game inputs, and read exact game state (projectile x/y/vx/vy per step) to diff against the web version. v86 runs the game in-browser but is not scriptable; this emulator is.

## Architecture Overview

Single file: `disasm/emu.py` (~1800 lines)

```
MZ Loader → Memory Model → CPU Core → INT/Port Dispatcher → Game Interface
                                ↑
                    instruction_set_x86._parse_ea()  (ModR/M helper reused)
                    instruction_set_x86._decode_fpu_int()  (Borland FPU decoder reused)
                    instruction_set_x86.decode()  (trace mode only)
```

- **Memory**: flat 1MB bytearray; reads/writes via `mem_read8/16`, `mem_write8/16`; VGA framebuffer at physical 0xA0000 captured to a 64KB bytearray
- **CPU state**: AX BX CX DX SI DI BP SP IP + CS DS SS ES + flags (CF ZF SF OF PF AF DF) + FPU stack (ST0-ST7 as Python floats)
- **FPU**: INT 34h-3Dh decoded by existing `instruction_set_x86.decode()` → dispatched to Python x87 implementations (FADD/FMUL/FDIV/FCOMP/FSTP/FLD/FILD etc.) — no re-decoding needed
- **Two run modes**: `--headless` (no display, dump CSV) and `--display` (framebuffer → PIL/pygame window)

## Key Findings from Exploration

- Entry point: CS:IP = 0:0 relative to load segment; SS:SP = 0x5EBA:0x0080
- 6,136 relocations must be applied at load time
- INT 21h: ~14 function codes (memory alloc 48/49/4A, file ops 3D/3E/3F/40/42, env 30/67, find 4E/4F)
- INT 10h: 53 calls, all in menu module (mode set, palette, font — can be stubbed)
- INT 16h: 1 call (keyboard wait — needs real stub)
- INT 1Ah: 1 call (timer ticks)
- INT 33h: 3 calls (mouse — stub as no-mouse)
- VGA 0xA000: direct framebuffer writes in menu module (9 patterns)
- Port I/O: ~8000 IN/OUT ops — mostly Fastgraph library (statically linked, just executes); intercept 0x3C8/0x3C9 (palette) and 0x3DA (vsync status)
- Borland FPU: 3,327 INT 34h-3Dh occurrences — decoder already handles these; just need execution

## Files

- **New**: `disasm/emu.py` — the emulator (all-in-one)
- **Reused**: `disasm/instruction_set_x86.py` — imports `_parse_ea()`, `_decode_fpu_int()`, `R8`, `R16`, `_MEM16` (no changes needed; these are module-level functions/tables)
- **Reused**: `disasm/dis.py` — address utilities (`ds_to_file`, `file_to_segoff`, `MZ_HEADER`, `DS_FILE_BASE`)

---

## Phase 1: MZ Loader + Memory + CPU Skeleton

**Goal**: Load EXE, apply relocations, set initial register state.

### Components

- `class Memory`: flat 1MB bytearray; `read8/16/32`, `write8/16/32` with physical addr; VGA page at 0xA0000
- `class CPU`: all 16-bit registers + segment regs + IP + flags struct + FPU stack list
- `load_exe(path)`: parse MZ header, place image at `load_seg` (0x0060 paragraph = PSP at 0), apply all 6136 relocations
  - Each relocation is `(off, seg)` LE word pair from offset 0x3E in the header
  - Physical addr = `load_base + seg*16 + off`
  - Add `load_base >> 4` to the word at that physical address
- `setup_psp(load_seg)`: minimal PSP at load_seg (INT 20h at offset 0, command line at 0x80)
- Initial registers: `DS=ES=load_seg+0x10`, `SS=load_seg+e_ss`, `SP=e_sp`, `CS=load_seg+e_cs`, `IP=e_ip`

### Detailed Implementation Notes

- The MZ header is 0x6A00 bytes (28 bytes standard header + relocations + padding)
- Header fields needed:
  - `e_cblp` (0x02): bytes on last page
  - `e_cp` (0x04): pages in file (512-byte pages)
  - `e_crlc` (0x06): relocation count = 6136
  - `e_cparhdr` (0x08): header size in paragraphs → 0x6A00 / 16 = 0x6A0 paragraphs
  - `e_minalloc` (0x0A), `e_maxalloc` (0x0C): min/max extra paragraphs
  - `e_ss` (0x0E): initial SS relative to load segment = 0x5EBA
  - `e_sp` (0x10): initial SP = 0x0080
  - `e_cs` (0x14): initial CS relative to load segment = 0x0000
  - `e_ip` (0x16): initial IP = 0x0000
  - `e_lfarlc` (0x18): relocation table file offset = 0x3E
- Image size: `(e_cp * 512) - (e_cblp ? 512 - e_cblp : 0) - (e_cparhdr * 16)` = code+data bytes
- Load base: choose `load_seg = 0x0070` (paragraph), so physical base = 0x0700 (after PSP at 0x0600)
  - PSP at `load_seg - 0x10` = 0x0060, physical 0x0600
  - Actually for simplicity, set `load_seg = 0x0070`, PSP paragraph = 0x0060
- Memory layout:
  ```
  0x00000-0x003FF  IVT (256 entries × 4 bytes)
  0x00400-0x005FF  BIOS data area (mostly zeros)
  0x00600-0x006FF  PSP (256 bytes)
  0x00700-0x5XXXX  EXE image (code + data + BSS)
  0x5XXXX-0x9FFFF  Heap / stack
  0xA0000-0xAFFFF  VGA framebuffer
  ```

### Test

```bash
python3 disasm/emu.py --dump-regs
# Expected: prints initial register state, first 5 decoded instructions
```

---

## Phase 2: Core Instruction Executor

**Goal**: Execute all instruction types used by the game.

### Decode-Execute Loop

The emulator does its **own opcode dispatch** directly on raw bytes — it does NOT use `decode()` at runtime. Instead, it imports the low-level helpers from `instruction_set_x86.py`:

- **`_parse_ea(data, pos, seg_pfx)`** — already returns structured `(modrm_bytes, ea_str, mod, reg, rm)`. The emulator needs `mod`, `reg`, `rm`, and the displacement (which it reads from raw bytes based on `mod`). The `ea_str` text is ignored.
- **`R8`, `R16`** — register name tables (indices 0-7), used for `mod=3` operands.
- **`_MEM16`** — base register table for ModR/M rm field.

The emulator's execute loop:
1. Read opcode byte(s) at `CS:IP`
2. For Borland FPU (0xCD 0x34-0x3D): call `_decode_fpu_int()` to get instruction length and mnemonic, then execute the x87 op
3. For all other opcodes: dispatch directly by opcode value, call `_parse_ea()` for ModR/M operands, compute effective addresses from `mod/rm/disp` + segment registers, read/write memory/registers

This avoids the text-parsing problem entirely. The decoder's structured internals (`_parse_ea`, `mod`, `reg`, `rm`, displacement bytes) provide everything the executor needs. The text `decode()` function is only used for `--trace` mode (printing human-readable disassembly alongside execution).

**Helper to add**: A small `_ea_to_offset(mod, rm, disp, cpu)` function in the emulator that computes the 16-bit effective address from the ModR/M fields + CPU register state:
```python
def _ea_to_offset(mod, rm, disp, cpu):
    """Compute 16-bit EA from ModR/M fields. Returns (offset, default_seg)."""
    if mod == 0 and rm == 6:
        return disp, 'ds'
    base = [cpu.bx + cpu.si, cpu.bx + cpu.di, cpu.bp + cpu.si, cpu.bp + cpu.di,
            cpu.si, cpu.di, cpu.bp, cpu.bx][rm]
    default_seg = 'ss' if rm in (2, 3, 6) else 'ds'  # BP-based → SS
    return (base + disp) & 0xFFFF, default_seg
```

### Instruction Groups

#### Data Movement
- `MOV r/m, r/imm/mem` — register-to-register, register-to-memory, immediate-to-register, immediate-to-memory
- `PUSH/POP r/m/seg/imm` — stack operations; PUSH decrements SP by 2, POP increments
- `XCHG r, r/m` — swap values
- `LEA r, m` — load effective address (compute address, don't dereference)
- `LES/LDS r, m` — load far pointer (offset to reg, segment to ES/DS)
- `LAHF/SAHF` — load/store AH from/to flags

#### Arithmetic
- `ADD/SUB/ADC/SBB r/m, r/imm` — with carry variants use CF
- `INC/DEC r/m` — increment/decrement (don't affect CF)
- `MUL/IMUL` — unsigned/signed multiply
  - 8-bit: AX = AL * r/m8
  - 16-bit: DX:AX = AX * r/m16
  - IMUL r, r/m, imm (three-operand form from 186+)
- `DIV/IDIV` — unsigned/signed divide
  - 8-bit: AL = AX / r/m8, AH = remainder
  - 16-bit: AX = DX:AX / r/m16, DX = remainder
- `NEG r/m` — two's complement negate
- `CBW` — sign-extend AL into AX
- `CWD` — sign-extend AX into DX:AX

#### Logic & Shift
- `AND/OR/XOR r/m, r/imm` — bitwise operations, clear CF/OF
- `NOT r/m` — bitwise complement (no flags affected)
- `TEST r/m, r/imm` — AND without storing result (flags only)
- `SHL/SHR/SAR r/m, 1/CL/imm` — shift left/right, arithmetic right
- `ROL/ROR/RCL/RCR r/m, 1/CL/imm` — rotate operations

#### Control Flow — Jumps
- `JMP` — short (rel8), near (rel16), far (seg:off), indirect `[r/m]`
- Conditional jumps (all short rel8 or near rel16):
  - `JZ/JE` (ZF=1), `JNZ/JNE` (ZF=0)
  - `JL/JNGE` (SF≠OF), `JLE/JNG` (ZF=1 or SF≠OF)
  - `JG/JNLE` (ZF=0 and SF=OF), `JGE/JNL` (SF=OF)
  - `JC/JB/JNAE` (CF=1), `JNC/JNB/JAE` (CF=0)
  - `JA/JNBE` (CF=0 and ZF=0), `JBE/JNA` (CF=1 or ZF=1)
  - `JO` (OF=1), `JNO` (OF=0)
  - `JS` (SF=1), `JNS` (SF=0)
  - `JP/JPE` (PF=1), `JNP/JPO` (PF=0)
  - `JCXZ` (CX=0)
- `LOOP/LOOPZ/LOOPNZ` — decrement CX, conditional jump

#### Control Flow — Calls
- `CALL near` — push IP, jump to rel16 target
- `CALL far` — push CS, push IP, jump to seg:off
- `CALL far [mem]` — indirect far call through memory pointer (FF /3): read off+seg from memory
- `RET` / `RET n` — pop IP, optionally add n to SP
- `RETF` / `RETF n` — pop IP, pop CS, optionally add n to SP

#### String Operations
- `MOVSB/MOVSW` — [ES:DI] ← [DS:SI], advance SI/DI by 1/2 (direction per DF)
- `STOSB/STOSW` — [ES:DI] ← AL/AX, advance DI
- `LODSB/LODSW` — AL/AX ← [DS:SI], advance SI
- `SCASB/SCASW` — compare AL/AX with [ES:DI], advance DI, set flags
- `CMPSB/CMPSW` — compare [DS:SI] with [ES:DI], advance both, set flags
- `REP` prefix — repeat CX times (for MOVS/STOS/LODS)
- `REPZ/REPE` prefix — repeat while CX>0 and ZF=1 (for CMPS/SCAS)
- `REPNZ/REPNE` prefix — repeat while CX>0 and ZF=0

#### Miscellaneous
- `NOP` — no operation
- `CLC/STC/CMC` — clear/set/complement carry flag
- `CLD/STD` — clear/set direction flag
- `CLI/STI` — clear/set interrupt flag (no-op in emulator)
- `ENTER n, 0` — push BP, mov BP SP, sub SP n (Borland function prolog)
- `LEAVE` — mov SP BP, pop BP (Borland function epilog)
- `INT imm8` — software interrupt (dispatched to handler)
- `IRET` — pop IP, pop CS, pop flags
- `HLT` — halt (raise exception or return to caller)
- `WAIT/FWAIT` — no-op (FPU sync, not needed in emulation)

#### Segment Overrides
- `CS:`, `DS:`, `ES:`, `SS:` prefixes — tracked as a modifier for the next memory access
- Default segments: `[BP±x]` uses SS, all other memory refs use DS, string destinations use ES

### Effective Address Computation

`effective_addr(mod, rm, disp, seg_override)` → physical address

ModR/M byte decodes to:
```
mod=00: [BX+SI], [BX+DI], [BP+SI], [BP+DI], [SI], [DI], [disp16], [BX]
mod=01: same + disp8 (sign-extended)
mod=10: same + disp16
mod=11: register (no memory access)
```
Note: mod=00, rm=110 is special: direct address `[disp16]`, not `[BP]`.

Physical address = `segment_reg * 16 + offset` (where offset = computed EA, truncated to 16 bits).

### Flags

Update CF, ZF, SF, OF, PF, AF after each arithmetic/logic operation per x86 spec:
- **CF**: carry/borrow out of MSB
- **ZF**: result is zero
- **SF**: MSB of result (sign)
- **OF**: signed overflow (carry into MSB ≠ carry out of MSB)
- **PF**: parity of low byte (even number of 1-bits)
- **AF**: auxiliary carry (carry out of bit 3) — needed for DAA/DAS but may not be used by game

Helper functions:
- `update_flags_add(op1, op2, result, width)` — sets all flags for ADD/ADC
- `update_flags_sub(op1, op2, result, width)` — sets all flags for SUB/SBB/CMP
- `update_flags_logic(result, width)` — sets ZF/SF/PF, clears CF/OF for AND/OR/XOR/TEST

### Test

```bash
python3 disasm/emu.py --boot-test
# Step through C runtime startup (0x6A00 onwards)
# Count instructions until first INT 21h call
# Should reach INT 21h/AH=30h (get DOS version) within ~20 instructions
```

---

## Phase 3: Interrupt + Port I/O Handlers

**Goal**: Handle all DOS/BIOS calls and hardware port I/O the game needs.

### INT Dispatcher (`handle_int(n)`)

| INT | Handler |
|-----|---------|
| 00h | Divide-by-zero: print regs, raise Python exception |
| 10h | BIOS video: AH=00 set mode (no-op), AH=10 palette (capture), AH=11 font (no-op), AH=0F return AL=13h |
| 16h | Keyboard: AH=00 blocking read from input queue; AH=01 peek (ZF=1 if empty) |
| 1Ah | Timer: AH=00 return fake tick count (incremented per step) |
| 21h | DOS (see below) |
| 33h | Mouse: AX=0 return AX=0 (no driver); all else no-op |
| 34h-3Dh | FPU: decode already done; execute x87 op on FPU stack (see Phase 4) |

### INT 21h Sub-functions

| AH | Function | Implementation |
|----|----------|----------------|
| 1Ah | Set DTA | Store DTA address (DS:DX) for FindFirst/FindNext |
| 25h | Set interrupt vector | Write seg:off to IVT at physical `int_num * 4` |
| 30h | Get DOS version | Return AL=3, AH=0A (DOS 3.10) |
| 35h | Get interrupt vector | Read seg:off from IVT at physical `int_num * 4` |
| 3Dh | Open file | Read ASCIIZ filename from DS:DX, map to Python `open()`, return handle in AX |
| 3Eh | Close file | Close Python file handle BX |
| 3Fh | Read file | Read CX bytes from handle BX into DS:DX buffer, return bytes read in AX |
| 40h | Write file | If BX=1 (stdout) or BX=2 (stderr), capture to debug output; else write to file |
| 42h | Seek | AL=method (0=SET,1=CUR,2=END), CX:DX=offset, return DX:AX=new position |
| 48h | Allocate memory | Allocate BX paragraphs → return AX=next_free_seg, advance heap allocator |
| 49h | Free memory | Free segment in ES (no-op for now, just return success) |
| 4Ah | Resize block | Resize block in ES to BX paragraphs (no-op, return success) |
| 4Ch | Exit | Raise `EmuExit` Python exception with return code in AL |
| 4Eh | Find first | Search for files matching DS:DX pattern, fill DTA with result |
| 4Fh | Find next | Continue file search from previous FindFirst |
| 58h | Get/set alloc strategy | Return AX=0 (first fit) |
| 67h | Set max handles | No-op, return success |

### File System Mapping

- Game files (`.CFG`, `.MTN`, `.EXE`) are in the `earth/` directory
- Map DOS filenames to `earth/<filename>` paths
- Handle table: Python dict mapping DOS handle (int) → Python file object
- Pre-assign handles: 0=stdin, 1=stdout, 2=stderr, 3=stdaux, 4=stdprn
- Next available handle starts at 5

### Port I/O (`handle_in(port)` / `handle_out(port, val)`)

| Port | Direction | Handler |
|------|-----------|---------|
| 0x3DA | IN | Return 0x08 (vsync not in progress) or cycle retrace bits for vsync wait loops |
| 0x3C8 | OUT | Set VGA palette write index register |
| 0x3C9 | OUT | Accumulate RGB triplet → `palette[idx] = (R, G, B)`, auto-increment index every 3 writes |
| 0x3C7 | OUT | Set VGA palette read index register |
| 0x3C9 | IN | Return palette data byte, auto-increment every 3 reads |
| 0x3C4 | OUT | VGA sequencer index (no-op) |
| 0x3C5 | OUT | VGA sequencer data (no-op) |
| 0x3CE | OUT | VGA graphics controller index (no-op) |
| 0x3CF | OUT | VGA graphics controller data (no-op) |
| 0x3D4 | OUT | VGA CRTC index (no-op) |
| 0x3D5 | OUT | VGA CRTC data (no-op) |
| other | IN | Return 0xFF |
| other | OUT | Silently ignore |

### VGA Palette State

```python
self.vga_palette = [(0,0,0)] * 256  # 256 RGB entries, each 0-63 (6-bit VGA)
self.vga_pal_write_idx = 0
self.vga_pal_write_component = 0  # 0=R, 1=G, 2=B, cycles on each OUT 0x3C9
self.vga_pal_read_idx = 0
self.vga_pal_read_component = 0
```

### IVT Setup

On `load_exe`, pre-populate IVT (physical 0x0000-0x03FF) with stub far pointers. Each stub is a 2-byte sequence (`IRET` = 0xCF) placed in a stub region at physical 0x0500. The Borland startup code will overwrite INT 34h-3Dh vectors with its own FPU library handlers — those point into EXE code and will execute normally.

```
For int_num 0..255:
  stub_addr = 0x0500 + int_num * 4
  mem[stub_addr] = 0xCF  (IRET)
  IVT[int_num] = far ptr to stub_addr  (seg = stub_addr >> 4, off = stub_addr & 0xF)
```

### Test

```bash
python3 disasm/emu.py --boot-test
# Game reaches past get_mips_count() and setup_physics_constants() without crash
# Print dt, gravity_step, wind_step from DS:CEAC/CE9C/CEA4
```

---

## Phase 4: FPU (x87) Execution

**Goal**: Implement all x87 ops used by the game.

### How FPU Instructions Arrive

The decoder (`instruction_set_x86.decode()`) already handles Borland's INT 34h-3Dh FPU encoding. It returns structured info like:
- `mnemonic = 'fstp'`, `op_str = 'qword [bp-0x08]'`, `is_fpu = True`

For the INT 34h-3Dh path: the INT instruction is 2 bytes (CD xx), followed by the x87 instruction bytes. The decoder reads through both and returns the full length. The emulator must:
1. Recognize INT 34h-3Dh
2. Skip the INT bytes
3. Execute the decoded x87 operation

### FPU State

```python
self.fpu_stack = [0.0] * 8   # ST(0)..ST(7)
self.fpu_top = 0              # top-of-stack pointer, wraps mod 8
self.fpu_status = 0           # status word (for FNSTSW)
self.fpu_control = 0x037F     # control word (default: round-to-nearest, all exceptions masked)
```

- `ST(i)` = `fpu_stack[(fpu_top + i) % 8]`
- Push: `fpu_top = (fpu_top - 1) % 8`, then write to `fpu_stack[fpu_top]`
- Pop: read from `fpu_stack[fpu_top]`, then `fpu_top = (fpu_top + 1) % 8`

### Operations (all using Python `float` = IEEE 754 double)

#### Load Operations
| Mnemonic | Operation |
|----------|-----------|
| `fld m32/m64` | Push float32/float64 from memory onto stack |
| `fld st(i)` | Push copy of ST(i) onto stack |
| `fild m16/m32` | Push integer from memory (converted to float) onto stack |
| `fldz` | Push 0.0 |
| `fld1` | Push 1.0 |
| `fldpi` | Push π |
| `fldl2e` | Push log2(e) |
| `fldl2t` | Push log2(10) |
| `fldln2` | Push ln(2) |
| `fldlg2` | Push log10(2) |

#### Store Operations
| Mnemonic | Operation |
|----------|-----------|
| `fst m32/m64` | Store ST(0) to memory (no pop) |
| `fstp m32/m64` | Store ST(0) to memory, pop |
| `fstp st(i)` | Copy ST(0) to ST(i), pop |
| `fist m16/m32` | Store ST(0) as integer to memory (no pop) |
| `fistp m16/m32` | Store ST(0) as integer to memory, pop |

#### Arithmetic
| Mnemonic | Operation |
|----------|-----------|
| `fadd m/st(i)` | ST(0) += operand |
| `faddp st(i), st` | ST(i) += ST(0), pop |
| `fsub m/st(i)` | ST(0) -= operand |
| `fsubp st(i), st` | ST(i) -= ST(0), pop |
| `fsubr m/st(i)` | ST(0) = operand - ST(0) |
| `fsubrp st(i), st` | ST(i) = ST(0) - ST(i), pop |
| `fmul m/st(i)` | ST(0) *= operand |
| `fmulp st(i), st` | ST(i) *= ST(0), pop |
| `fdiv m/st(i)` | ST(0) /= operand |
| `fdivp st(i), st` | ST(i) /= ST(0), pop |
| `fdivr m/st(i)` | ST(0) = operand / ST(0) |
| `fdivrp st(i), st` | ST(i) = ST(0) / ST(i), pop |

#### Comparison
| Mnemonic | Operation |
|----------|-----------|
| `fcom m/st(i)` | Compare ST(0) with operand, set C0/C2/C3 in status word |
| `fcomp m/st(i)` | Compare + pop |
| `fcompp` | Compare ST(0) with ST(1), pop both |
| `ftst` | Compare ST(0) with 0.0 |
| `fnstsw ax` | Store FPU status word to AX (for SAHF; Jcc pattern) |
| `fnstsw m16` | Store FPU status word to memory |

#### Transcendental
| Mnemonic | Operation |
|----------|-----------|
| `fsqrt` | ST(0) = sqrt(ST(0)) |
| `fabs` | ST(0) = abs(ST(0)) |
| `fchs` | ST(0) = -ST(0) |
| `fsin` | ST(0) = sin(ST(0)) |
| `fcos` | ST(0) = cos(ST(0)) |
| `fptan` | ST(0) = tan(ST(0)), push 1.0 |
| `fpatan` | ST(1) = atan2(ST(1), ST(0)), pop |
| `fyl2x` | ST(1) = ST(1) * log2(ST(0)), pop |
| `f2xm1` | ST(0) = 2^ST(0) - 1 (for |ST(0)| <= 1) |
| `fscale` | ST(0) = ST(0) * 2^trunc(ST(1)) |
| `frndint` | ST(0) = round(ST(0)) per rounding mode |

#### Miscellaneous
| Mnemonic | Operation |
|----------|-----------|
| `fxch st(i)` | Swap ST(0) and ST(i) |
| `fnstcw m16` | Store control word to memory (no-op or store 0x037F) |
| `fldcw m16` | Load control word from memory (no-op or update rounding mode) |
| `fwait` | No-op |
| `finit/fninit` | Reset FPU state |

### Memory Operand Sizing

The decoder's operand string indicates size:
- `dword [...]` → float32 (4 bytes) — use `struct.unpack('<f', ...)`
- `qword [...]` → float64 (8 bytes) — use `struct.unpack('<d', ...)`
- `word [...]` → int16 (for FILD/FIST)
- `dword [...]` with FILD/FIST → int32

### Test

```bash
python3 disasm/emu.py --run-func setup_physics_constants
# Expected: prints dt=0.02, gravity_step=10.0 (at default gravity 0.2), wind_step
```

---

## Phase 5: Game Loop + Interface

**Goal**: Navigate to gameplay, inject shots, export trajectory.

### Input Queue

```python
self.key_queue = collections.deque()  # FIFO of (scancode, ascii) tuples

def push_key(self, scancode, ascii_char=0):
    self.key_queue.append((scancode, ascii_char))
```

INT 16h AH=00 blocks until queue non-empty (in practice: the emulator must pre-fill the queue with a scripted key sequence before starting execution, or use a callback mechanism).

### Scripted Scenario (`--compare` mode)

1. Start execution at entry point
2. Auto-press keys to navigate menus:
   - Skip MIPS benchmark wait
   - Reach main menu
   - Select "2 Players"
   - Set AI vs AI (both players = AI)
   - Start round
3. Hook `sim_step` (file offset 0x21A80): before each call, record projectile state from DS offsets:
   - `DS:CE88` — projectile X (float64)
   - `DS:CE8C` — projectile Y (float64) (or nearby — verify exact offsets)
   - `DS:CE90` — velocity X
   - `DS:CE98` — velocity Y
4. After projectile lands (detected by explosion call or projectile-active flag going to 0), dump trajectory CSV to stdout

### Address Hooks

```python
self.hooks = {}  # file_offset → callback(emu)

def add_hook(self, file_offset, callback):
    """Register callback to fire when execution reaches this address."""
    self.hooks[file_offset] = callback
```

Before executing each instruction, compute file offset from CS:IP, check hooks dict, call if present.

Built-in hooks for trajectory logging:
- `on_enter(0x21A80)`: log projectile state (read float64s from DS:proj_x, DS:proj_y etc.)
- `on_enter(0x4C27F)`: log sound calls for event tracing (optional debug)

### Display Mode (`--display`)

After each INT 10h mode-set or Fastgraph `fg_displaypage` call:
1. Read VGA framebuffer: physical 0xA0000-0xAFFFF (64KB, 320×200 = 64000 bytes in mode 13h)
2. Map through palette: `pixel_color = vga_palette[framebuffer[y*320+x]]`
3. Scale 6-bit VGA (0-63) to 8-bit RGB (0-255): multiply by 4
4. Render via PIL (`Image.fromarray`) or pygame surface
5. Update window at ~30fps or on each `fg_displaypage` call

### CLI Interface

```bash
# Phase 1+2: Boot test
python3 disasm/emu.py --boot-test
# Expected: prints "Got DOS version call", "Heap init done"

# Phase 3+4: Physics function test
python3 disasm/emu.py --run-func setup_physics_constants
# Expected: prints dt=0.02, gravity_step=10.0 (at default gravity 0.2), wind_step

# Phase 5: Trajectory comparison
python3 disasm/emu.py --compare --angle 45 --power 500 --wind 0 --steps 200 > exe_traj.csv
node web/scripts/sim_traj.js --angle 45 --power 500 --wind 0 --steps 200 > web_traj.csv
diff exe_traj.csv web_traj.csv

# Display mode (visual debugging)
python3 disasm/emu.py --display

# Verbose trace (log every instruction)
python3 disasm/emu.py --boot-test --trace 2>&1 | head -1000
```

---

## Critical Implementation Notes

### 1. Relocations
6136 entries starting at file offset 0x3E in header. Each is a `(offset, segment)` pair of 16-bit LE words (4 bytes total per entry). Physical address of the word to patch = `load_base + segment*16 + offset`. Patch operation: add `load_seg` (the paragraph number where the image was loaded) to the 16-bit word at that physical address. This adjusts all far pointers and segment references in the code to account for the actual load position.

### 2. Far Calls Through Function Pointers
Game uses `CALL FAR [mem]` extensively (weapon dispatch, shield callbacks, etc.). The executor must handle:
- `FF /3` (mod=00, reg=011): `CALL FAR [r/m16]` — read 4 bytes from memory (offset:segment), push CS, push next-IP, set CS:IP
- `9A` opcode: `CALL FAR seg:off` — direct far call with inline seg:off

### 3. ENTER/LEAVE
Borland uses these for every function:
- `ENTER n, 0` = `PUSH BP; MOV BP, SP; SUB SP, n` (allocate n bytes of local vars)
- `LEAVE` = `MOV SP, BP; POP BP` (deallocate locals)
Required for correct BP-relative addressing of local variables and parameters.

### 4. Segment Arithmetic
The loader places code at `load_seg`. When code does `MOV AX, CS` or segment-loading patterns, values are segment numbers consistent with the loaded layout. All CS values from the EXE's relocation table are pre-adjusted at load time. The emulator must not further adjust these.

### 5. Stack Overflow Handler
At file offset corresponding to `0x0000:A2CE` (relative to load segment): called by every function prolog's stack check (`CMP [stack_limit], SP; CALL FAR 0:A2CE if overflow`). Implement as a stub that just does `RETF` (returns without action). If stack actually overflows the 1MB memory, raise a Python exception.

### 6. IVT at Physical 0
DOS IVT occupies physical addresses 0x000-0x3FF (256 entries × 4 bytes each). The memory model must allow read/write at these addresses. Borland startup installs INT 34h-3Dh handlers here — those will point into EXE code and execute the FPU emulation library correctly.

### 7. Performance Considerations
- Python will be slow for full emulation (~10K-50K instructions/sec estimated)
- For trajectory comparison, we only need to reach the projectile simulation loop — not render the full game
- Consider `--run-func` mode that jumps directly to a function with pre-set register/memory state
- Use `array` module or `ctypes` for memory instead of pure `bytearray` if performance is critical
- Potential optimization: skip known library functions (Fastgraph drawing routines) by hooking their entry points and returning immediately

### 8. Reusing Decoder Internals
The emulator does NOT call `decode()` at runtime — it dispatches opcodes directly from raw bytes and imports `_parse_ea()` from `instruction_set_x86.py` for ModR/M decoding. This gives structured access to `mod`, `reg`, `rm`, and displacements without any text parsing. The text `decode()` is only used in `--trace` mode for human-readable output. The FPU path reuses `_decode_fpu_int()` to get instruction length and mnemonic for the Borland INT 34h-3Dh sequences.

---

## Verification Summary

| Phase | Test Command | Expected Output |
|-------|-------------|-----------------|
| 1 | `--dump-regs` | Initial register state + first 5 instructions |
| 1+2 | `--boot-test` | "Got DOS version call", "Heap init done" |
| 3+4 | `--run-func setup_physics_constants` | dt=0.02, gravity_step=10.0 |
| 5 | `--compare --angle 45 --power 500` | CSV trajectory, <0.1px diff vs web |

## Open Questions

1. **Exact DS offsets for projectile state**: Need to verify DS:CE88 etc. are correct for x/y/vx/vy. May need to trace through `sim_step` in dis.py first.
2. **Menu navigation key sequence**: Need to map exact scancodes for navigating from boot to gameplay. May require trial-and-error with `--display` mode.
3. **Fastgraph library calls**: How many unique Fastgraph functions are called? Can we stub all of them (hook entry, set return values, skip)? This would massively speed up reaching gameplay.
4. **Memory allocator complexity**: Does the game rely on specific heap layout? Simple bump allocator may suffice.
5. **.CFG file dependency**: Does the game require SCORCH.CFG to exist with specific settings, or does it generate defaults? Need to ensure `earth/SCORCH.CFG` is accessible.
