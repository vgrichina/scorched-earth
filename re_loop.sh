#!/usr/bin/env bash
# RE loop: run Claude sessions until all Next Tasks are done.
# Usage: ./re_loop.sh [--max N] [--tasks N] [--dry-run]
set -euo pipefail

cleanup() {
  echo ""; echo "Interrupted — killing session..."
  kill %1 2>/dev/null || true
  exit 130
}
trap cleanup INT TERM

MAX=50; TASKS=1; DRY=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --max)   MAX="$2";   shift 2 ;;
    --tasks) TASKS="$2"; shift 2 ;;
    --dry-run) DRY=true; shift ;;
    *) echo "unknown: $1"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"
remaining() { grep -c '^- \[ \]' REVERSE_ENGINEERING.md 2>/dev/null || true; }
mkdir -p re_loop_sessions
RUN_TS=$(date '+%Y%m%d_%H%M%S')

for (( i=1; i<=MAX; i++ )); do
  [[ $(remaining) -eq 0 ]] && echo "All tasks done!" && break
  echo ""
  echo "=== Session $i ($(remaining) tasks left) ==="
  [[ "$DRY" == true ]] && echo "[dry-run]" && break

  LOG="re_loop_sessions/${RUN_TS}_session_$(printf '%03d' $i).txt"

  PROMPT="Continue the Scorched Earth v1.50 reverse-engineering and web port project.

Before picking a task:
1. Read disasm/dead_ends.md for known investigation dead-ends (avoid repeating these).
2. Read the 2-3 most recent STANDALONE session summaries in re_loop_sessions/ (format: YYYYMMDD_session_NNN.txt — NOT the verbose YYYYMMDD_HHMMSS_*.txt tool-call logs. Skim them to understand what was just investigated.

Then read REVERSE_ENGINEERING.md '## Next Tasks' section. Pick the top $TASKS unchecked items (\`- [ ]\`).

Tasks fall into two categories:

**RE investigation tasks** (disasm tools — dis.py is primary, plus ds_lookup.py, xref.py, struct_dump.py):
1. Run 2-3 investigation tool calls.
2. Immediately write findings to REVERSE_ENGINEERING.md.
3. Repeat: a few more tool calls, then write again.
4. Add new labels/symbols to disasm/labels.csv; add explanatory notes to disasm/comments.csv.
Do not batch all investigation before writing — write after every few tool calls.

**Web port fix tasks** (editing web/js/*.js files):
1. Read the relevant web/js file first.
2. Apply the fix described in REVERSE_ENGINEERING.md (binary addresses and values are already documented).
3. Update REVERSE_ENGINEERING.md to note what was changed.
No need to re-investigate the binary — all values are already documented.

**If stuck**: If after 10 tool calls you have not made progress on an investigation, STOP. Add what you learned to disasm/dead_ends.md. Then break the stuck task into 2-3 smaller sub-tasks in REVERSE_ENGINEERING.md (e.g., 'Find function X callers using --callers mode', 'Trace code path Y from known label Z'). Mark the original task [x] with note 'Split into sub-tasks'. Move to the next task.

Mark task done (\`- [x]\`) once fully documented/implemented.
End your final message with: SESSION_SUMMARY: <one line>

RE tools (all under disasm/):
  # Primary disassembler — zero deps, handles FPU natively, annotates DS refs:
  python3 disasm/dis.py 0xXXXXX 40           # by file offset (default 40 instructions)
  python3 disasm/dis.py DS:0xXXXX 20         # by DS offset
  python3 disasm/dis.py SEG:OFF 30            # by segment:offset (e.g. 1A4A:0)

  # Knowledge base — add new findings here:
  # disasm/labels.csv:   file_offset_hex,name   OR   DS:offset_hex,name
  # disasm/comments.csv: file_offset_hex,comment OR   DS:offset_hex,comment

  # Supporting tools:
  python3 disasm/ds_lookup.py earth/SCORCH.EXE DS:0xXXXX -s
  python3 disasm/ds_lookup.py earth/SCORCH.EXE DS:0xXXXX -w -n 32
  python3 disasm/ds_lookup.py earth/SCORCH.EXE DS:0xXXXX -f32 -n 4  # float32 values
  python3 disasm/decode_float64.py earth/SCORCH.EXE DS:0xXXXX -f32 -n 4  # same + raw bytes
  python3 disasm/xref.py earth/SCORCH.EXE DS:0xXXXX --code
  python3 disasm/xref.py earth/SCORCH.EXE --callers 0xFILEOFF  # far-call callers of function
  python3 disasm/find_callers.py earth/SCORCH.EXE 0xFILEOFF    # far+near callers of function
  python3 disasm/seg_offset.py SEG:OFF DS:0xXXXX 0xFILEOFF     # convert between address forms
  python3 disasm/struct_dump.py earth/SCORCH.EXE weapon -n 60
  python3 disasm/strings_dump.py earth/SCORCH.EXE -g \"pattern\"
  python3 disasm/icon_dump.py earth/SCORCH.EXE 0 -n 8

IMPORTANT tool rules — violations will be blocked:
- Use the Read tool (NOT cat/head/tail via Bash) to read files
- Use the Grep tool (NOT grep/rg via Bash) to search file contents
- Use the Glob tool (NOT ls/find via Bash) to list files
- Do NOT run python3 inline scripts — write a .py file first, then run it

Do not re-document already-covered addresses. Stop after $TASKS tasks."

  echo "$PROMPT" | claude -p \
    --output-format stream-json \
    --max-turns 150 \
    --allowedTools "Bash(python3 disasm/dis.py*),Bash(python3 disasm/ds_lookup.py*),Bash(python3 disasm/xref.py*),Bash(python3 disasm/find_callers.py*),Bash(python3 disasm/struct_dump.py*),Bash(python3 disasm/strings_dump.py*),Bash(python3 disasm/decode_float64.py*),Bash(python3 disasm/seg_offset.py*),Bash(python3 disasm/icon_dump.py*),Bash(python3 disasm/palette_dump.py*),Bash(git add*),Bash(git commit*),Bash(git log*),Bash(git status*),Bash(git diff*),Read,Edit,Write,Glob,Grep" \
    | jq --unbuffered -r '
        if .type == "assistant" then
          .message.content[] |
          if .type == "text" then .text
          elif .type == "tool_use" then
            if .name == "Bash" then
              "  \u25b6 \(.input.command | split("\n")[0] | .[0:120])"
            elif .name == "Read" then
              "  \u25b6 Read \(.input.file_path | split("/")[-1])\(if .input.offset then " +\(.input.offset)" else "" end)"
            elif .name == "Write" then
              "  \u25b6 Write \(.input.file_path | split("/")[-1])"
            elif .name == "Edit" then
              "  \u25b6 Edit \(.input.file_path | split("/")[-1])"
            elif .name == "Grep" then
              "  \u25b6 Grep \"\(.input.pattern)\" \(.input.path // "")"
            elif .name == "Glob" then
              "  \u25b6 Glob \(.input.pattern)"
            else
              "  \u25b6 \(.name) \(.input | keys | join(" "))"
            end
          else empty
          end
        else empty
        end
      ' | tee "$LOG" &
  wait $!

  SUMMARY=$(git diff REVERSE_ENGINEERING.md | grep '^+- \[x\]' | head -1 | sed 's/^+- \[x\] //' || true)
  [[ -z "$SUMMARY" ]] && SUMMARY="session $i progress"

  git add REVERSE_ENGINEERING.md web/ disasm/labels.csv disasm/comments.csv disasm/dead_ends.md
  if git diff --cached --quiet; then
    echo "No changes — retrying same task..."
    continue
  fi

  git commit -m "RE loop session $i: $SUMMARY"
  echo "Committed: $SUMMARY"
  sleep 1
done

echo ""
echo "Done. Remaining tasks: $(remaining)"
