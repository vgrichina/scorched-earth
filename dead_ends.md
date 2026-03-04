# Dead Ends & Investigation Notes

Known dead-end approaches — read before starting, append when you hit a wall.

## Round-Over Screen String Search
- **Tried**: `strings_dump.py -g "round"`, `strings_dump.py -g "over"`, `strings_dump.py -g "winner"` etc. to find round-over/game-over screen text
- **Failed because**: The round-over screen uses dynamically composed text from player names and format strings, not a single static "Round Over" string. The display routine builds the text at runtime.
- **Better approach**: Trace from the main game loop's round-end branch (play.cpp, after round_complete flag). Look for the screen-clear + text-draw sequence following the score tallying code. Use `xref.py --callers` on known score-update functions to find the call chain.
- **Session**: 025 (two separate runs hit identical dead end)

## Shield Far-Call Caller Search via od/grep
- **Tried**: Raw `od | grep` on the EXE binary to find far call bytes targeting shield functions (shield_hit_draw at 0x3B07F, shield_absorb_damage at 0x38344)
- **Failed because**: Far calls use MZ-relocated segment values — the raw bytes in the file don't contain the runtime segment, so byte-pattern searching can't find them. Session 033 burned 257 tool calls thrashing on this.
- **Better approach**: Use `python3 disasm/xref.py earth/SCORCH.EXE --callers 0x3B07F` which understands MZ relocations and computes valid call targets algebraically.
- **Session**: 033
