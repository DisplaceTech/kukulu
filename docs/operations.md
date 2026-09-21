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
agents carry `permissionMode: acceptEdits`, which covers file edits.

MCP tool calls need one allow rule, since a subagent's permission mode does
not cover them:

```json
{ "permissions": { "allow": ["mcp__plugin_foundry_foundry"] } }
```

`foundry_agents_sync` — which `/foundry:go-flight` calls before its loop —
writes this itself into the project's `.claude/settings.local.json` (F-03),
read-merge-write, unless it is already covered there or in the committed
`.claude/settings.json`. It never touches `~/.claude/settings.json`; put the
rule there yourself if you want it to apply to every project instead of one.
Its result's `permissions` field is `"added"`, `"present"`, or
`"failed: <why>"` — a `settings.local.json` that fails to parse is reported,
never overwritten. Without the rule, the first stage's first
`foundry_status` call is denied and the flight stalls silently.

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

Three things halt a flight on purpose.

**Round cap.** `foundry_review_submit` writes a `halted` reason under either
of two conditions (F-13, F-15): the round count reaches `maxRoundsHard`
(default 6) regardless of how well the rounds are going, or the number of
*non-converging* rounds — a round whose fix-task count did not shrink from
the one before it — reaches `maxRounds` (default 3). A flight whose findings
go 15 → 3 → 2 → 1 never trips the soft cap, however many rounds that takes;
one that goes 4 → 4 → 4 does, on the third round, because none of them
improved on the last. `foundry_status`'s `state.rounds` has the count for
every round so far, and the halt message includes the trail.

```bash
# read the reviews first — docs/REVIEW.md is overwritten each round,
# but every round is in the history
git log --oneline --grep '^review:'
git show <sha>:docs/REVIEW.md
```

To continue anyway: raise `maxRounds` (or `maxRoundsHard`, whichever
tripped) in `docs/foundry.json`, set `"halted": null` in
`.foundry/state.json`, commit both, and re-run the flight.

**Missing spec.** No `docs/SPEC.md` means there is nothing to build from. Write
one; see [writing-specs.md](./writing-specs.md).

**An operator-level problem.** `foundry_run_halt` records a reason when the
implementer hits something no task-level retry fixes: a signing agent that
died, a full disk, a `verify` command that cannot even run, a vanished base
branch (F-05). Nothing is reset or cleaned — read the branch exactly as the
run left it.

To continue anyway, after fixing the actual problem: set `"halted": null` in
`.foundry/state.json`, commit it, and re-run the flight.

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
| `foundry_run_start` refuses with a signing message | `policies.signing` is `"required"` and either signing is not configured or a real signed commit failed | Fix the signing agent, or set `policies.signing` to `"off"` in `docs/foundry.json` |
| Flight halts with a reason naming a dead tool or agent | `foundry_run_halt` was called | Read the reason, fix the actual problem, clear `halted` in `.foundry/state.json`, re-run |
| A subagent's first `foundry_status` call is denied | The MCP allow rule is missing, or `foundry_agents_sync` reported `permissions: "failed: ..."` | Run `foundry_config_show` and check `permissionRule`; if a sync failed, the message names the broken `settings.local.json` — fix its JSON and re-run |

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
  "maxRoundsHard": 6,
  "commandTimeoutMs": 600000,
  "guardCap": 60,
  "policies": { "signing": "auto", "push": true, "pr": "draft" }
}
```

| Key | Default | Effect |
|---|---|---|
| `verify` | `[]` | Commands run after every task. At least one is required. Each entry is a string, or `{ cmd, timeoutMs }` to override `commandTimeoutMs` for that one command. |
| `extraVerify` | `{}` | Path prefix → extra commands (same string-or-`{ cmd, timeoutMs }` entries), run when a task touches that prefix |
| `build` | `[]` | Recorded for the plan's use; the MCP does not run it |
| `baseBranch` | `main` | Branch runs start from, and the merge-base reported as `base` |
| `branchPrefix` | `build/` | Prefix for run branches (`build/2026-09-18`, `-2`, …) |
| `maxRounds` | `3` | Non-converging review rounds allowed before the flight halts; a round whose fix-task count did not shrink from the last one counts against this |
| `maxRoundsHard` | `6` | Absolute review-round ceiling, regardless of convergence |
| `commandTimeoutMs` | `600000` | Per-command timeout for `foundry_verify` |
| `guardCap` | `60` | Re-blocks since the last task state change before the implement guard gives up; carried into `.foundry/implement.lock` at `foundry_run_start` and wins over `FOUNDRY_GUARD_CAP` |
| `policies.signing` | `"auto"` | `"off"` disables commit signing for the run; `"required"` refuses to start unless a real signed commit succeeds; `"auto"` uses signing when it works and falls back to off, recording why, when it does not |
| `policies.push` | `true` | `false` skips every push `foundry_run_start`, `foundry_run_finish`, `foundry_review_submit` and `foundry_summary_commit` would otherwise make |
| `policies.pr` | `"draft"` | `"none"` skips draft-PR creation in `foundry_run_finish` even when `gh` is available |
| `constraints` | `[]` | `CLAUDE.md` rules expressed as data and checked by `foundry_verify` — see [Constraints](#constraints) below |

Environment variables:

| Variable | Default | Effect |
|---|---|---|
| `FOUNDRY_PROJECT_DIR` | `cwd` | Project root the server operates on; set by `.mcp.json` |
| `FOUNDRY_GUARD_CAP` | `60` | Re-blocks since the last task state change before the guard gives up; `docs/foundry.json`'s `guardCap` wins over this when set |
| `FOUNDRY_CONFIG` | `~/.config/foundry/config.json` (or `$XDG_CONFIG_HOME/foundry/config.json`) | Path to the global routing config |
| `FOUNDRY_PROFILE` | the global file's own `"profile"` key, if any | Which profile in the global file to apply; wins over the file's own choice |

## Constraints

A `## Constraints` line in `CLAUDE.md` is prose a reviewer has to remember
to check by hand, three review rounds running, and can still miss a shape a
hand-written grep never covered (F-14). `docs/foundry.json`'s `constraints`
array turns a mechanically-checkable one into data with proof that its own
check works:

```json
{
  "constraints": [
    {
      "id": "no-hardcoded-tick-rate",
      "description": "The tick rate is config.TICK_RATE, never a literal.",
      "paths": ["src/"],
      "exclude": ["src/config/"],
      "pattern": "(tickRate|TICK_RATE)['\"]?\\s*(=|:|=>)\\s*[0-9]",
      "shouldMatch": ["const tickRate = 60;", "TICK_RATE: 60,", "'tickRate' => 60,"],
      "shouldNotMatch": ["const tickRate = config.TICK_RATE;"]
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique name; the fix task for a violation names it |
| `description` | no | For a human reading `docs/foundry.json` |
| `paths` | yes | Path prefixes to scan (matches `git ls-files`'s pathspec) |
| `exclude` | no | Path prefixes to skip within `paths` |
| `pattern` | yes | A JS `RegExp` source, checked line by line — no multi-line patterns |
| `flags` | no | `RegExp` flags, e.g. `"i"` |
| `shouldMatch` | yes, ≥ 1 | Lines the pattern must catch |
| `shouldNotMatch` | yes, ≥ 1 | Lines it must not |

`foundry_verify` runs constraints before any shell command, always against
the whole repo regardless of the `files` argument: first it self-tests every
rule against its own `shouldMatch`/`shouldNotMatch` fixtures — a fixture
that disagrees fails the rule outright, with `fixture` in the result naming
which line, and no file is scanned for that rule — then it scans every
*tracked* file under `paths` minus `exclude` (`git ls-files`, so an
untracked or gitignored file is never scanned) and reports each hit as
`{ file, line, text }`. A malformed rule (missing `id`/`paths`/`pattern`,
no fixtures, an unparseable `pattern`, a duplicate `id`) refuses the whole
call, naming the offending rule.

`templates/constraints.example.json` has three fully worked rules — a
forbidden import, a hard-coded tunable in three different syntactic shapes,
and a call forbidden outside the module that owns it — each with fixtures
covering the shapes an implementer might reach for. The plan-build skill
requires every mechanically-checkable `CLAUDE.md` constraint to have a
matching entry here; the review-build skill treats a rule that missed a
real violation as a defect in the rule, not just the code, and the fix
task closes the blind spot by adding the missed shape to `shouldMatch`.

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
- a draft PR, if `gh` was available and `policies.pr` is not `"none"`

When there is an `origin`, every one of those commits is pushed as it lands —
`foundry_run_finish`, `foundry_review_submit` and `foundry_summary_commit`
all push (unless `policies.push` is `false`) — and `foundry_run_start`
pushes the base branch itself before the first build branch is cut, so the
base branch on the remote carries the planner's commits too and a PR's diff
is the build, not the plan (F-18).

Read `SUMMARY.md` first. It is written for someone who was not there: what was
built, what was decided and by whom, which assumptions are still guesses, which
spec issues need your edit, and what you still have to check by hand.

Then merge it yourself. Nothing in Foundry merges anything.
