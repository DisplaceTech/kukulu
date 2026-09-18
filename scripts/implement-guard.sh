#!/usr/bin/env bash
# Foundry implement guard — Stop / SubagentStop hook.
#
# While .foundry/implement.lock exists, an implementation run is in progress.
# If docs/PROGRESS.md still has open tasks ([ ] or [~]), block the stop and
# push the agent back into the loop. A hard cap on re-blocks (default 500)
# prevents a runaway; the counter lives in the lock file.
#
# Everything here is deterministic: counting checkboxes and a counter.
# Exit 0 with no output = allow the stop.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
LOCK="$ROOT/.foundry/implement.lock"
PROGRESS="$ROOT/docs/PROGRESS.md"
CAP="${FOUNDRY_GUARD_CAP:-500}"

[ -f "$LOCK" ] || exit 0
[ -f "$PROGRESS" ] || exit 0

# Only count checkbox lines under "## Tasks" so log entries can't confuse it.
open=$(awk '/^## Tasks/{t=1;next} /^## /{t=0} t && /^- \[( |~)\] /{n++} END{print n+0}' "$PROGRESS")
[ "$open" -gt 0 ] || exit 0

count=$(tr -dc '0-9' < "$LOCK" 2>/dev/null)
count=$(( ${count:-0} + 1 ))
printf '%s\n' "$count" > "$LOCK"

if [ "$count" -gt "$CAP" ]; then
  # Give up rather than loop forever; leave the lock so the orchestrator sees it.
  printf '{"systemMessage":"foundry: implement guard cap (%s) reached with %s open tasks; run halted"}\n' "$CAP" "$open"
  exit 0
fi

next=$(awk '/^## Tasks/{t=1;next} /^## /{t=0} t && /^- \[~\] /{sub(/^- \[~\] /,""); print $1; exit}' "$PROGRESS")
[ -n "$next" ] || next=$(awk '/^## Tasks/{t=1;next} /^## /{t=0} t && /^- \[ \] /{sub(/^- \[ \] /,""); print $1; exit}' "$PROGRESS")

reason="foundry: implementation run is not finished — $open task(s) still open in docs/PROGRESS.md (next: $next). Do not stop. Call foundry_task_next and continue; call foundry_run_finish only when foundry_status reports zero open tasks."
# JSON-escape the reason (no quotes/backslashes/newlines in it, but be safe).
reason=${reason//\\/\\\\}; reason=${reason//\"/\\\"}
printf '{"decision":"block","reason":"%s"}\n' "$reason"
exit 0
