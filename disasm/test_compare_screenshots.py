"""Exercise the screenshot gate's CLI status, including previously hidden diffs."""
import subprocess
import sys
import tempfile
from pathlib import Path

from compare_screenshots import write_png

# This directory's dis.py must not shadow Python's dis module during unittest import.
script_dir = sys.path.pop(0)
import unittest
sys.path.insert(0, script_dir)


class ScreenshotGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.emu = self.root / 'emu.png'
        self.web = self.root / 'web.png'
        write_png(self.emu, 1, 2, bytes([100, 100, 100, 255] * 2))

    def run_gate(self, *args):
        return subprocess.run(
            [sys.executable, str(Path(__file__).with_name('compare_screenshots.py')),
             str(self.emu), str(self.web), *args], capture_output=True, text=True)

    def test_identical_passes(self):
        self.web.write_bytes(self.emu.read_bytes())
        self.assertEqual(self.run_gate().returncode, 0)

    def test_one_level_color_difference_fails(self):
        write_png(self.web, 1, 2, bytes([101, 100, 100, 255, 100, 100, 100, 255]))
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertIn('Diff: 1 ', result.stdout)
        self.assertEqual(self.run_gate('--tolerance', '1').returncode, 0)

    def test_hud_is_compared_unless_explicitly_masked(self):
        write_png(self.web, 1, 2, bytes([0, 0, 0, 255, 100, 100, 100, 255]))
        self.assertEqual(self.run_gate().returncode, 1)
        self.assertEqual(self.run_gate('--mask-hud', '1').returncode, 0)

    def test_dimension_mismatch_fails_even_when_overlap_matches(self):
        write_png(self.web, 1, 1, bytes([100, 100, 100, 255]))
        result = self.run_gate()
        self.assertEqual(result.returncode, 2)
        self.assertIn('Size mismatch', result.stderr)


if __name__ == '__main__':
    unittest.main()
