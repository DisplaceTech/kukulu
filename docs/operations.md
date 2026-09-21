# Operations

Running a flight, resuming one, and unsticking one. Everything Foundry knows is
on disk and committed, so there is no hidden state to reason about: when
something looks wrong, `foundry_status` is the whole truth.

## Running a flight

```bash
cd myproject
claude
> /foundry:go-flight
```

The controller is model-invocable, so asking for it by name works too; the
slash command is just the documented shortcut. It prints the stage it is
entering, delegates, and repeats. Each stage is one `Agent` call that either
blocks until the stage finishes or returns at once with the result delivered
later as a completion notification — the controller treats both the same
way and never polls in between. When it stops it prints the final stage, the
round count, the branch, and the path to `docs/SUMMARY.md` if one exists.

An implementer that hits a permission prompt sits there until the guard's cap
trips, hours later, having done nothing. The generated `foundry-<role>`
agents carry `permissionMode: acceptEdits`, which covers file edits; MCP
tool calls need one allow rule in `~/.claude/settings.json` or the project's
`.claude/settings.json` — `"permissions": { "allow": ["mcp__plugin_foundry_foundry"] }`
— which the README's per-project section explains. Without it, the first
stage's first `foundry_status` call is denied and the flight stops.

## Checking on a run

From any Claude Code session in the project:

```text
> use foundry_status
```

Or straight from a shell, without a session:

```bash
git log --oneline
cat docs/PROGRESS.md          # checkboxes and the per-task log
cat .foundry/state.json       # round, verdict, halted
ls .foundry/implement.lock    # present = a run is armed
```

The commit history is designed to be read on its own. Bookkeeping commits are
prefixed (`chore:`, `progress:`, `review:`, `plan:`) and task commits start
with their task id, so `git log --oneline` reads as a narrative of the run.

## Resuming

There is one command:

```text
> /foundry:go-flight
```

`foundry_next` re-reads disk and continues from wherever the flight stopped —
mid-task, mid-round, or between stages. A task left `[~]` by a crashed run is
handed back with `resumed: true`; a run that died before its handoff is
detected by its leftover lock and sent back to the implementer to finish.

Resuming is the answer to a compacted context, a closed laptop, a killed
session, and a subagent that errored out. It is not the answer to a halt.

## Halts

Two things halt a flight on purpose.

**Round cap.** `foundry_review_submit` writes a `halted` reason when the new
round exceeds `maxRounds` (default 3). The reviewer has now asked for changes
three times; the pipeline's opinion is that a human should look at why.

```bash
# read the reviews first — docs/REVIEW.md is overwritten each round,
# but every round is in the history
git log --oneline --grep '^review:'
git show <sha>:docs/REVIEW.md
```

To continue anyway: raise `maxRounds` in `docs/foundry.json`, set `"halted":
null` in `.foundry/state.json`, commit both, and re-run the flight.

**Missing spec.** No `docs/SPEC.md` means there is nothing to build from. Write
one; see [writing-specs.md](./writing-specs.md).

## When something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| Controller stops immediately with `halt` | Read the `reason` — missing spec, or `halted` in state | Fix the named cause, re-run |
| Implementer stops with tasks open | The guard blocked and the agent still stopped, or the cap tripped | Check the lock's counter; if it is at the cap, something is wedged — read the last task's log and block it by hand |
| Every task blocks with the same error | The plan assumes something that is not there | Stop the flight. Fix `SPEC.md`, re-plan; do not let it grind through 40 blocked tasks |
| `foundry_task_done` keeps refusing | The implementer is not committing with `<ID>:` as the subject, or is leaving files uncommitted | The commit template lives in `CLAUDE.md`; check the planner wrote one |
| `foundry_verify` fails on a clean checkout | The commands in `docs/foundry.json` are wrong | Fix them there — they came from `SPEC.md` §7, so fix that too |
| Run finishes but nothing was pushed | No `origin`, or the push failed | `push` in the handoff output says which; the branch is local and reviewable either way |
| No draft PR | `gh` is not installed or not authenticated | Optional by design; open one yourself |
| Reviewer approves work that is wrong | `CLAUDE.md` `## Constraints` are unverifiable | Tighten `SPEC.md` §3 so each rule is a grep, then re-plan |
| Controller prints `FOUNDRY: RESTART REQUIRED` and stops | The agents directory was populated for the first time in this project, and a changed role routes to a model the `Agent` tool cannot name directly | Expected, and rare after 0.3.0 — only the first sync of a router-routed role hits this. Run `/foundry:go-flight` again in a new session |
| `Agent` call fails with `Agent type 'foundry-<role>' not found` | Same cause as above, hit mid-flight instead of at the start | Same fix: relaunch and re-run |
| Flight stops immediately with a routing config error | The global file, a profile, or `docs/foundry.json`'s `roles`/`permissionMode` is malformed | Run `foundry_config_show` to see exactly what and where; fix it and re-run |

## Clearing a wedged run by hand

Nothing here is magic; it is all files.

```bash
# stand the guard down (safe: the next run_start re-arms it)
rm -f .foundry/implement.lock

# mark a task blocked yourself, if a model cannot
$EDITOR docs/PROGRESS.md      # change [~] to [!], add a log entry under ## Log
git commit -am "progress: P3-07 blocked by hand"

# abandon a round and go back to review
$EDITOR .foundry/state.json   # implemented: true, reviewed: false
```

The one file not to hand-edit casually is `docs/PROGRESS.md` while a run is
armed — the guard counts its checkboxes, and the MCP rewrites it from its own
parse. Edit it between stages, not during one.

## Configuration

`docs/foundry.json`, written by the planner, read by the MCP:

```json
{
  "verify": ["npm run typecheck", "npm run lint", "npm test -- --run"],
  "extraVerify": { "src/core/": ["npm run test:invariants"] },
  "build": ["npm run build"],
  "baseBranch": "main",
  "branchPrefix": "build/",
  "maxRounds": 3,
  "commandTimeoutMs": 600000,
  "guardCap": 60
}
```

| Key | Default | Effect |
|---|---|---|
| `verify` | `[]` | Commands run after every task. At least one is required. |
| `extraVerify` | `{}` | Path prefix → extra commands, run when a task touches that prefix |
| `build` | `[]` | Recorded for the plan's use; the MCP does not run it |
| `baseBranch` | `main` | Branch runs start from, and the merge-base reported as `base` |
| `branchPrefix` | `build/` | Prefix for run branches (`build/2026-09-18`, `-2`, …) |
| `maxRounds` | `3` | Review rounds allowed before the flight halts |
| `commandTimeoutMs` | `600000` | Per-command timeout for `foundry_verify` |
| `guardCap` | `60` | Re-blocks since the last task state change before the implement guard gives up; carried into `.foundry/implement.lock` at `foundry_run_start` and wins over `FOUNDRY_GUARD_CAP` |

Environment variables:

| Variable | Default | Effect |
|---|---|---|
| `FOUNDRY_PROJECT_DIR` | `cwd` | Project root the server operates on; set by `.mcp.json` |
| `FOUNDRY_GUARD_CAP` | `60` | Re-blocks since the last task state change before the guard gives up; `docs/foundry.json`'s `guardCap` wins over this when set |
| `FOUNDRY_CONFIG` | `~/.config/foundry/config.json` (or `$XDG_CONFIG_HOME/foundry/config.json`) | Path to the global routing config |
| `FOUNDRY_PROFILE` | the global file's own `"profile"` key, if any | Which profile in the global file to apply; wins over the file's own choice |

## Routing

Which model runs each role, and where that comes from, is
[docs/routing.md](./routing.md)'s subject in full. The short version for
unattended use: `/foundry:go-flight` calls `foundry_agents_sync` before its
loop. Claude Code hot-reloads a routing change to an already-populated
`.claude/agents/` directory within seconds, so most edits need no restart at
all — `foundry_next` falls back to the plugin's own agent with the resolved
model until the change is picked up. Only a project's very first sync, and
only for a role routed to a model the `Agent` tool cannot name directly,
prints `FOUNDRY: RESTART REQUIRED` and stops. A plain re-run picks up where
it left off. To make a headless launcher handle that restart itself:

```bash
out=$(claude -p "/foundry:go-flight")
printf '%s\n' "$out"
case "$out" in
  *"FOUNDRY: RESTART REQUIRED"*) claude -p "/foundry:go-flight" ;;
esac
```

`foundry_config_show` prints the merged config and the source of every
value; run it whenever the resolved model for a role is not what you
expected.

## What the flight leaves behind

A `build/<date>` branch containing:

- one commit per task, titled `<ID>: <title>`
- interleaved `progress:` commits recording each state change with its sha
- `review: round N` commits, one per round, each carrying that round's
  `REVIEW.md` and the fix tasks it queued
- `docs/HANDOFF.md`, `docs/REVIEW.md` and `docs/SUMMARY.md` at the tip
- a draft PR, if `gh` was available

Read `SUMMARY.md` first. It is written for someone who was not there: what was
built, what was decided and by whom, which assumptions are still guesses, which
spec issues need your edit, and what you still have to check by hand.

Then merge it yourself. Nothing in Foundry merges anything.
