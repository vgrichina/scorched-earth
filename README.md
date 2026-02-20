# Scorched Earth v1.50

The classic DOS artillery game (1995, Wendell Hicken), faithfully reverse-engineered from the original binary and rebuilt for the web.

**Play now:** [scorched-earth.berrry.app](https://scorched-earth.berrry.app)

## Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Adjust angle | Left/Right arrows | D-pad |
| Adjust power | Up/Down arrows | D-pad |
| Cycle weapon | Tab | WPN button |
| Fire | Space | FIRE button |
| Confirm | Enter | OK button |

Fullscreen: click the toggle button on the canvas, or use "START FULLSCREEN" from the landing page. On mobile, fullscreen auto-locks to landscape orientation.

## Project Structure

```
web/              Web reimplementation (pure HTML/CSS/JS, no dependencies)
  index.html      Game page with touch controls and fullscreen support
  css/style.css   Responsive layout, mobile landscape, fullscreen mode
  js/             Game modules (physics, rendering, AI, weapons, etc.)
earth/            Original DOS game files (gitignored, see below)
disasm/           Decoded disassembly and analysis intermediate files
  fpu_decode.py   Borland INT 34h-3Dh FPU instruction decoder
REVERSE_ENGINEERING.md   Master RE document with all findings
```

## Obtaining the Original Game Binary

The `earth/` directory is gitignored and must be populated manually for reverse engineering work.

**Scorched Earth v1.50** (1995) is freely distributed shareware by Wendell Hicken. To obtain it:

1. Download from [My Abandonware](https://www.myabandonware.com/game/scorched-earth-192) (598 KB DOS archive)
2. Extract the archive into the `earth/` directory
3. Verify: `earth/SCORCH.EXE` should be 415,456 bytes with a 0x6A00 byte MZ header

The key file for RE work is `SCORCH.EXE` (Borland C++ 1993, MZ DOS format). Use with `disasm/fpu_decode.py` to decode the Borland FPU emulation layer (INT 34h-3Dh):

```bash
python3 disasm/fpu_decode.py earth/SCORCH.EXE 0x24F01 0x2610F -c -f
```

See `REVERSE_ENGINEERING.md` for full binary layout, data structures, and decoded algorithms.

## Running Locally

No build step required. Serve the `web/` directory with any static HTTP server:

```bash
cd web && python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## License

The web reimplementation code is open source. The original Scorched Earth binary and assets are property of Wendell Hicken (shareware).
