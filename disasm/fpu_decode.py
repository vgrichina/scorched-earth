#!/usr/bin/env python3
"""
Borland FPU Emulation Decoder for Scorched Earth v1.50

Decodes INT 34h-3Eh sequences (Borland's software FPU emulation) into
readable x87 mnemonics. Uses ndisasm for both reconstructed FPU opcodes
and regular x86 instruction decoding.

Usage:
    python3 fpu_decode.py <exe_path> <start_offset> <end_or_length> [-c] [-f]

    Offsets are file offsets (hex with 0x prefix or decimal).
    End can be absolute offset or +length (e.g. +1024).
    -c enables DS constant annotations.
    -f enables far call annotations (Borland RTL function labels)
        and function boundary markers (enter/retf).
"""

import sys
import struct
import subprocess
import tempfile
import os
import re

# INT number -> x87 base opcode byte
# Mapping verified via Ralf Brown's Interrupt List (RBIL):
#   INT 34h = D8h, INT 35h = D9h, etc. (sequential: opcode = 0xD8 + INT - 0x34)
INT_TO_OPCODE = {
    0x34: 0xD8,  # ESC0: dword memory / register (fadd/fmul/fcomp/fsub dword)
    0x35: 0xD9,  # ESC1: dword memory / misc (fld/fst/fldcw/fnstcw/fsqrt/fsin/fcos)
    0x36: 0xDA,  # ESC2: dword int memory (fiadd/fimul/ficom dword)
    0x37: 0xDB,  # ESC3: dword int memory / misc (fild/fist/fistp dword, fcomi)
    0x38: 0xDC,  # ESC4: qword memory / register (fadd/fmul/fsub/fdiv qword)
    0x39: 0xDD,  # ESC5: qword memory / misc (fld/fst/fstp qword, frstor/fsave)
    0x3A: 0xDE,  # ESC6: word int memory / register (fiadd/fimul word, faddp/fmulp)
    0x3B: 0xDF,  # ESC7: word int memory / misc (fild/fistp word, fnstsw ax)
    0x3C: 0xD8,  # near-data segment variant (DS: segment override + ESC0)
    # 0x3D = FWAIT (special)
    # 0x3E = D9 register-only forms (special, 4-byte: CD 3E xx 90)
}

# DS segment constants for annotation
DS_CONSTANTS = {
    0x1CC8: ("f32", 100.0, "distance divisor"),
    0x1D08: ("f64", 0.0174532930, "PI/180 deg-to-rad"),
    0x1D10: ("f64", 1.02, "+2% damage randomization"),
    0x1D18: ("f64", 0.98, "-2% damage randomization"),
    0x1D20: ("f32", 5000.0, "max effective distance"),
    0x1D28: ("f32", 1.825, "damage coefficient"),
    0x1D2C: ("f32", 1000000.0, "distance squared threshold"),
    0x1D30: ("f32", 1000.0, "scaling factor"),
    0x1D38: ("f32", -1.875, "polynomial coefficient"),
    0x1D40: ("f32", -1.75, "polynomial coefficient"),
    0x1D48: ("f32", -2.0, "polynomial coefficient"),
    0x1D50: ("f32", -3.140625, "~-PI"),
    0x1D54: ("f32", 0.75, "coefficient"),
    0x1D58: ("f32", 2000.0, "scaling"),
    0x1D5C: ("f32", 2.0, "doubling"),
    0x1D60: ("f64", 0.7, "damage falloff"),
    0x1D68: ("f64", 0.001, "epsilon threshold"),
}

# Known far call targets: (seg, offset) -> label
# Borland RTL math functions identified by decoding function entry points.
# Call targets use the segment:offset from the CALL FAR instruction operands,
# where segment 0x0 means "same segment as caller" (resolved by relocation).
KNOWN_CALLS = {
    (0x0, 0x1204): "_sin",           # INT 35h fsin at file 0x7C04
    (0x0, 0x13D1): "_cos",           # INT 35h fcos at file 0x7DD1
    (0x0, 0x0FC8): "_sqrt",          # INT 35h fsqrt at file 0x79C8
    (0x0, 0x14DF): "_ftol",          # fnstcw/fldcw/fistp at file 0x7EDF
    (0x0, 0x1421): "_atan2",         # fdivrp/fptan + quadrant adj at file 0x7E21
    (0x0, 0x04DC): "_tan",           # fptan at file 0x6EDC
    (0x0, 0x0500): "_fabs",          # clr sign bit + fld at file 0x6F00
    (0x0, 0xA2CE): "__stkchk",       # cmp sp,[DS:519A] stack overflow check
    (0x0, 0x1E97): "_malloc",        # memory allocation
}


def modrm_length_16bit(modrm_byte):
    """Calculate total operand length for 16-bit ModR/M addressing.

    Returns the number of bytes AFTER the CD xx prefix (modrm + displacement).
    """
    mod = (modrm_byte >> 6) & 3
    rm = modrm_byte & 7

    if mod == 3:
        return 1  # register only, just modrm
    elif mod == 0:
        if rm == 6:
            return 3  # modrm + disp16
        return 1  # modrm only
    elif mod == 1:
        return 2  # modrm + disp8
    else:  # mod == 2
        return 3  # modrm + disp16


def fpu_instruction_length(data, offset):
    """Calculate the total length of an FPU INT instruction at offset.

    Returns (length, int_number) or (0, 0) if not an FPU INT.
    """
    if offset + 1 >= len(data):
        return 0, 0

    if data[offset] != 0xCD:
        return 0, 0

    int_num = data[offset + 1]

    if int_num < 0x34 or int_num > 0x3E:
        return 0, 0

    if int_num == 0x3D:
        return 2, int_num  # FWAIT: just CD 3D

    if int_num == 0x3E:
        return 4, int_num  # CD 3E xx 90

    # All others: CD xx + modrm + optional displacement
    if offset + 2 >= len(data):
        return 0, 0

    modrm = data[offset + 2]
    operand_len = modrm_length_16bit(modrm)
    return 2 + operand_len, int_num


def reconstruct_fpu_bytes(data, offset, length, int_num):
    """Reconstruct real x87 opcode bytes from INT emulation sequence.

    Replaces the CD xx with the corresponding x87 opcode byte,
    keeps the modrm and displacement bytes.
    """
    if int_num == 0x3D:
        return bytes([0x9B])  # FWAIT

    if int_num == 0x3E:
        # Register-only D9 form: CD 3E xx 90 -> D9 xx
        return bytes([0xD9, data[offset + 2]])

    base_opcode = INT_TO_OPCODE[int_num]
    # Replace CD xx with base opcode, keep modrm + displacement
    result = bytes([base_opcode]) + data[offset + 2:offset + length]
    return result


def ndisasm_decode(raw_bytes, origin=0, bits=16):
    """Feed bytes to ndisasm and return decoded lines.

    Returns list of (offset_within_input, length, mnemonic_string).
    """
    if not raw_bytes:
        return []

    with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
        f.write(raw_bytes)
        tmppath = f.name

    try:
        result = subprocess.run(
            ['ndisasm', f'-b{bits}', '-o', f'0x{origin:x}', tmppath],
            capture_output=True, text=True, timeout=10
        )
        lines = []
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
            # ndisasm format: "00000000  9B            fwait"
            parts = line.split(None, 2)
            if len(parts) >= 3:
                off = int(parts[0], 16)
                hex_bytes = parts[1]
                mnemonic = parts[2]
                byte_len = len(hex_bytes) // 2
                lines.append((off, byte_len, mnemonic))
            elif len(parts) == 2:
                off = int(parts[0], 16)
                hex_bytes = parts[1]
                byte_len = len(hex_bytes) // 2
                lines.append((off, byte_len, f"db 0x{hex_bytes}"))
        return lines
    finally:
        os.unlink(tmppath)


def extract_ds_offset(data, offset, length, int_num):
    """Extract DS memory offset from FPU instruction if it uses direct addressing.

    Returns the DS offset or None.
    """
    if int_num in (0x3D, 0x3E):
        return None
    if offset + 2 >= len(data):
        return None

    modrm = data[offset + 2]
    mod = (modrm >> 6) & 3
    rm = modrm & 7

    # Direct addressing: mod=0, rm=6 -> disp16 follows modrm
    if mod == 0 and rm == 6 and offset + 4 < len(data):
        disp16 = struct.unpack('<H', data[offset + 3:offset + 5])[0]
        return disp16

    return None


def format_constant_annotation(ds_offset):
    """Format a DS constant annotation if the offset is known."""
    if ds_offset in DS_CONSTANTS:
        typ, val, desc = DS_CONSTANTS[ds_offset]
        return f"[{typ}] {val} ({desc})"
    return None


def file_offset_to_seg(file_offset, exe_data):
    """Convert file offset to segment:offset for MZ EXE.

    Uses the MZ header to find the code start, then computes
    a reasonable segment:offset pair.
    """
    # Read MZ header
    if len(exe_data) < 0x20:
        return 0, file_offset

    header_paragraphs = struct.unpack('<H', exe_data[0x08:0x0A])[0]
    header_size = header_paragraphs * 16

    # Code offset within loaded image
    code_offset = file_offset - header_size

    if code_offset < 0:
        return 0, file_offset

    # Use paragraph-aligned segments
    seg = code_offset // 16
    off = code_offset % 16

    return seg, off


def decode_region(exe_data, file_start, file_end, annotate_constants=False):
    """Decode a region of the EXE, handling both FPU INTs and regular x86.

    Yields (file_offset, seg, off, mnemonic, annotation) tuples.
    """
    data = exe_data
    pos = file_start

    # For segment calculation
    header_paragraphs = struct.unpack('<H', data[0x08:0x0A])[0]
    header_size = header_paragraphs * 16

    # We need to figure out a base segment for this region.
    # In the Scorched Earth EXE, code segments vary. We'll compute
    # relative to the load address and use a fixed segment base.
    # The first code byte's paragraph determines the segment.
    code_start = file_start - header_size
    base_seg = code_start >> 4
    base_off_adjust = code_start & 0xF

    # Accumulate x86 bytes for batch ndisasm decoding
    x86_buf = bytearray()
    x86_start_file = None

    def flush_x86():
        """Flush accumulated x86 bytes through ndisasm."""
        nonlocal x86_buf, x86_start_file
        if not x86_buf:
            return []

        code_off = x86_start_file - header_size
        seg_for_origin = code_off >> 4
        off_for_origin = code_off & 0xF

        # Use a virtual origin that matches the segment:offset
        virtual_origin = off_for_origin
        lines = ndisasm_decode(bytes(x86_buf), origin=virtual_origin)

        results = []
        for rel_off, length, mnemonic in lines:
            actual_file_off = x86_start_file + (rel_off - virtual_origin)
            actual_code_off = actual_file_off - header_size
            seg = actual_code_off >> 4
            off = actual_code_off & 0xF
            # Use a consistent segment base for the region
            seg = base_seg
            off = base_off_adjust + (actual_file_off - file_start)
            results.append((actual_file_off, seg, off, mnemonic, "; x86"))

        x86_buf.clear()
        x86_start_file = None
        return results

    results = []

    while pos < file_end:
        fpu_len, int_num = fpu_instruction_length(data, pos)

        if fpu_len > 0 and 0x34 <= int_num <= 0x3E:
            # Flush any pending x86
            results.extend(flush_x86())

            # Reconstruct x87 bytes and decode
            fpu_bytes = reconstruct_fpu_bytes(data, pos, fpu_len, int_num)
            code_off = pos - header_size
            seg = base_seg
            off = base_off_adjust + (pos - file_start)

            fpu_lines = ndisasm_decode(fpu_bytes, origin=0)

            annotation = f"; INT {int_num:02X}h"

            # Check for DS constant reference
            if annotate_constants:
                ds_off = extract_ds_offset(data, pos, fpu_len, int_num)
                if ds_off is not None:
                    const_ann = format_constant_annotation(ds_off)
                    if const_ann:
                        annotation += f"  DS:{ds_off:04X} = {const_ann}"
                    else:
                        annotation += f"  DS:{ds_off:04X}"

            if fpu_lines:
                _, _, mnemonic = fpu_lines[0]
                results.append((pos, seg, off, mnemonic, annotation))
            else:
                hex_str = ' '.join(f'{b:02x}' for b in data[pos:pos + fpu_len])
                results.append((pos, seg, off, f"db {hex_str}", annotation + " (decode failed)"))

            pos += fpu_len
        else:
            # Regular x86 byte
            if x86_start_file is None:
                x86_start_file = pos
            x86_buf.append(data[pos])
            pos += 1

    # Flush remaining x86
    results.extend(flush_x86())

    return results


def decode_region_fast(exe_data, file_start, file_end, annotate_constants=False):
    """Optimized decoder: batch all FPU reconstructions and x86 runs,
    minimize subprocess calls to ndisasm.

    Strategy: First pass identifies all FPU and x86 runs. Then batch
    decode FPU instructions (one ndisasm call per batch) and x86 runs
    (one ndisasm call per contiguous run).
    """
    data = exe_data
    header_paragraphs = struct.unpack('<H', data[0x08:0x0A])[0]
    header_size = header_paragraphs * 16

    code_start = file_start - header_size
    base_seg = code_start >> 4
    base_off_adjust = code_start & 0xF

    # First pass: identify all chunks
    chunks = []  # list of (file_pos, type, length, int_num_or_none)
    pos = file_start
    x86_run_start = None

    while pos < file_end:
        fpu_len, int_num = fpu_instruction_length(data, pos)

        if fpu_len > 0 and 0x34 <= int_num <= 0x3E:
            if x86_run_start is not None:
                chunks.append((x86_run_start, 'x86', pos - x86_run_start, None))
                x86_run_start = None
            chunks.append((pos, 'fpu', fpu_len, int_num))
            pos += fpu_len
        else:
            if x86_run_start is None:
                x86_run_start = pos
            pos += 1

    if x86_run_start is not None:
        chunks.append((x86_run_start, 'x86', file_end - x86_run_start, None))

    # Second pass: batch FPU bytes into one blob with HLT separators.
    # HLT (0xF4) separators prevent ndisasm from misinterpreting boundaries.
    # 16 bytes of padding absorbs any cascading misparse from unrecognized opcodes.
    # FWAIT (9B) is handled separately because it acts as a prefix byte.
    HLT_PAD = bytes([0xF4] * 16)
    fpu_blob = bytearray()
    fpu_chunk_map = []  # (blob_offset, fpu_bytes_len, chunk_index)
    fpu_raw_bytes = {}  # chunk_index -> reconstructed bytes (for fallback)

    for i, (fpos, ctype, clen, int_num) in enumerate(chunks):
        if ctype == 'fpu':
            if int_num == 0x3D:
                fpu_chunk_map.append((-1, 1, i))  # FWAIT sentinel
                continue
            fpu_bytes = reconstruct_fpu_bytes(data, fpos, clen, int_num)
            blob_offset = len(fpu_blob)
            fpu_blob.extend(fpu_bytes)
            fpu_chunk_map.append((blob_offset, len(fpu_bytes), i))
            fpu_raw_bytes[i] = fpu_bytes
            fpu_blob.extend(HLT_PAD)

    # Decode all FPU bytes in one ndisasm call
    fpu_decoded = {}  # chunk_index -> mnemonic string
    if fpu_blob:
        fpu_lines = ndisasm_decode(bytes(fpu_blob), origin=0)
        offset_to_mnemonic = {}
        for off, length, mnemonic in fpu_lines:
            if mnemonic.strip() != 'hlt':
                offset_to_mnemonic[off] = mnemonic
        for blob_off, fpu_len, chunk_idx in fpu_chunk_map:
            if blob_off == -1:
                fpu_decoded[chunk_idx] = 'wait'  # FWAIT
            else:
                mnemonic = offset_to_mnemonic.get(blob_off)
                if mnemonic is None and chunk_idx in fpu_raw_bytes:
                    # Fallback: decode individually (handles rare unrecognized opcodes)
                    fb_lines = ndisasm_decode(fpu_raw_bytes[chunk_idx], origin=0)
                    if fb_lines:
                        mnemonic = fb_lines[0][2]
                fpu_decoded[chunk_idx] = mnemonic

    # Decode x86 runs (one ndisasm call per run)
    x86_decoded = {}  # chunk_index -> list of (rel_offset, length, mnemonic)
    for i, (fpos, ctype, clen, _) in enumerate(chunks):
        if ctype == 'x86':
            raw = data[fpos:fpos + clen]
            off_within_region = fpos - file_start
            virtual_origin = base_off_adjust + off_within_region
            lines = ndisasm_decode(bytes(raw), origin=virtual_origin)
            x86_decoded[i] = (fpos, lines, virtual_origin)

    # Third pass: produce output
    results = []
    for i, (fpos, ctype, clen, int_num) in enumerate(chunks):
        seg = base_seg
        off = base_off_adjust + (fpos - file_start)

        if ctype == 'fpu':
            annotation = f"; INT {int_num:02X}h"

            if annotate_constants:
                ds_off = extract_ds_offset(data, fpos, clen, int_num)
                if ds_off is not None:
                    const_ann = format_constant_annotation(ds_off)
                    if const_ann:
                        annotation += f"  DS:{ds_off:04X} = {const_ann}"
                    else:
                        annotation += f"  DS:{ds_off:04X}"

            mnemonic = fpu_decoded.get(i)
            if mnemonic and not mnemonic.startswith('db '):
                results.append((fpos, seg, off, mnemonic, annotation))
            else:
                # Show reconstructed opcode fields for manual analysis
                fpu_bytes = reconstruct_fpu_bytes(data, fpos, clen, int_num)
                base = fpu_bytes[0]
                if len(fpu_bytes) > 1:
                    modrm = fpu_bytes[1]
                    mod = (modrm >> 6) & 3
                    reg = (modrm >> 3) & 7
                    rm = modrm & 7
                    hex_str = ' '.join(f'{b:02x}' for b in fpu_bytes)
                    detail = f"{hex_str} (/{reg} mod={mod} rm={rm})"
                else:
                    detail = f"{fpu_bytes[0]:02x}"
                results.append((fpos, seg, off, f"db {detail}", annotation))

        elif ctype == 'x86':
            if i in x86_decoded:
                run_fpos, lines, virtual_origin = x86_decoded[i]
                for rel_off, length, mnemonic in lines:
                    actual_file_off = run_fpos + (rel_off - virtual_origin)
                    actual_off = base_off_adjust + (actual_file_off - file_start)
                    results.append((actual_file_off, seg, actual_off, mnemonic, "; x86"))

    return results


def annotate_call(mnemonic):
    """Check if a mnemonic is a far call to a known function.

    Returns the label string or None.
    """
    # Match patterns like: call word 0x0:word 0x1421
    #                   or: call 0x0:0x1421
    m = re.match(r'call\s+(?:word\s+)?0x([0-9a-f]+):(?:word\s+)?0x([0-9a-f]+)', mnemonic, re.I)
    if m:
        seg = int(m.group(1), 16)
        off = int(m.group(2), 16)
        return KNOWN_CALLS.get((seg, off))
    return None


def format_output(results, annotate_calls=False):
    """Format decode results into aligned columns."""
    lines = []
    for file_off, seg, off, mnemonic, annotation in results:
        extra = ""
        if annotate_calls:
            # Annotate known far calls
            label = annotate_call(mnemonic)
            if label:
                extra = f"  → {label}"
            # Function boundary markers
            mnemonic_stripped = mnemonic.strip().lower()
            if mnemonic_stripped.startswith('enter '):
                lines.append("")
                lines.append(f"; {'=' * 60}")
                lines.append(f"; === FUNCTION at file 0x{file_off:05X} ===")
                lines.append(f"; {'=' * 60}")
            elif mnemonic_stripped in ('retf', 'ret') or mnemonic_stripped.startswith('retf '):
                extra += "  ; --- end ---"

        line = f"0x{file_off:05X}  {seg:04X}:{off:04X}  {mnemonic:<38s} {annotation}{extra}"
        lines.append(line)
    return '\n'.join(lines)


def print_stats(results):
    """Print summary statistics."""
    fpu_count = sum(1 for _, _, _, _, ann in results if not ann.endswith('x86'))
    x86_count = sum(1 for _, _, _, _, ann in results if ann.endswith('x86'))
    print(f"\n--- Statistics ---", file=sys.stderr)
    print(f"FPU instructions: {fpu_count}", file=sys.stderr)
    print(f"x86 instructions: {x86_count}", file=sys.stderr)
    print(f"Total: {fpu_count + x86_count}", file=sys.stderr)


def parse_offset(s):
    """Parse a numeric offset (hex with 0x prefix or decimal)."""
    s = s.strip()
    if s.startswith('0x') or s.startswith('0X'):
        return int(s, 16)
    return int(s)


def main():
    if len(sys.argv) < 4:
        print(__doc__.strip())
        sys.exit(1)

    exe_path = sys.argv[1]
    start = parse_offset(sys.argv[2])

    end_arg = sys.argv[3]
    if end_arg.startswith('+'):
        length = parse_offset(end_arg[1:])
        end = start + length
    else:
        end = parse_offset(end_arg)

    annotate = '-c' in sys.argv
    annotate_calls_flag = '-f' in sys.argv

    with open(exe_path, 'rb') as f:
        exe_data = f.read()

    if start >= len(exe_data):
        print(f"Error: start offset 0x{start:X} beyond file size 0x{len(exe_data):X}",
              file=sys.stderr)
        sys.exit(1)

    if end > len(exe_data):
        end = len(exe_data)
        print(f"Warning: clamped end to file size 0x{end:X}", file=sys.stderr)

    results = decode_region_fast(exe_data, start, end, annotate)
    output = format_output(results, annotate_calls=annotate_calls_flag)
    print(output)
    print_stats(results)


if __name__ == '__main__':
    main()
