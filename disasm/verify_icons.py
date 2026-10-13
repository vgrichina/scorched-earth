#!/usr/bin/env python3
"""Check all signed icon records against SCORCH.EXE, including offsets/shades."""
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent
exe = (root / 'earth/SCORCH.EXE').read_bytes()
source = (root / 'web/js/hud.js').read_text()
icons = json.loads(re.search(r'const ICONS = (\[.*?\]);', source, re.S).group(1))
assert len(icons) == 48, f'Expected 48 icons, found {len(icons)}'
failures = []
for i, icon in enumerate(icons):
    record = exe[0x595A6 + i * 125:0x595A6 + (i + 1) * 125]
    # 0x26110 consumes row-major signed bytes until -99, not width*height.
    end = record.index(0x9D, 3)
    samples = [v if v < 128 else v - 256 for v in record[3:end]]
    expected = dict(x=record[0], y=record[1], w=record[2],
                    h=(len(samples) + record[2] - 1) // record[2], px=samples)
    if icon != expected:
        failures.append(i)
if failures:
    print(f'Icon records differ: {failures}')
    sys.exit(1)
print('All 48 icon records match EXE offsets, widths, signed samples and lengths.')
