# MCP tool reference

Ten tools, served over stdio by `mcp/server.mjs` with no dependencies. The
server is launched by Claude Code from [`.mcp.json`](../.mcp.json) with
`FOUNDRY_PROJECT_DIR` set to the project root; every path below is relative to
that root.

Two of them — `foundry_status` and `foundry_next` — are read-only, and they are
the only two the flight controller is allowed to call. Everything else changes
state and belongs to a stage agent.

A tool that refuses returns a normal MCP result with `isError: true` and a
plain-English message. It is not a transport error: the model is expected to
read it, fix what it did, and try again.

---

## `foundry_status`

Everything the pipeline knows from disk. Read-only, safe to call at any time,
and the right first call for any stage that has just been spawned with no
context.

**Arguments:** none.

**Returns:**

| Field | Meaning |
|---|---|
| `root` | Absolute project root the server is operating on |
| `specPresent` … `configPresent` | Which pipeline documents exist |
| `lockPresent` | Whether an implementation run is armed |
| `git` | `{ inRepo, branch, head, base, dirty, hasOrigin }` — `base` is the merge-base with `baseBranch` |
| `state` | `{ round, implemented, reviewed, verdict, summarized, halted }` from `.foundry/state.json` |
| `round` | Current review round (0 = initial build) |
| `reviewRoundsInPlan` | How many `## Review fixes (round N)` sections `PLAN.md` carries |
| `branch`, `started` | The `Branch:` and `Started:` headers in `PROGRESS.md` |
| `counts` | `{ todo, inProgress, done, blocked, skipped, total, open }`; `open = todo + inProgress` |
| `blocked`, `skipped` | Task ids in those states |
| `reviewVerdictInFile` | The verdict parsed out of `REVIEW.md`, if one exists |

**Refuses when:** `PROGRESS.md` exists but has no `## Tasks` section, or
`foundry.json` is not valid JSON. Both are corruption, not absence, and
guessing past them would produce confident nonsense.

---

## `foundry_next`

The stage machine. A pure function of disk state — it never sees a subagent's
report.

**Arguments:** none.

**Returns:** `{ stage, agent, round, reason, prompt }`.

- `stage` — `plan` · `implement` · `review` · `summarize` · `done` · `halt`
- `agent` — the subagent to spawn (`foundry:planner`, `foundry:implementer`,
  `foundry:reviewer`, `foundry:summarizer`), or `null` for `done` and `halt`
- `reason` — one sentence, written for a human reading the transcript
- `prompt` — the text to hand the subagent **verbatim**

The full decision order is in [architecture.md](./architecture.md#the-stage-machine).

---

## `foundry_run_start`

Begin or resume an implementation run. Idempotent: calling it on a run already
in progress returns `{ alreadyStarted: true }` and changes nothing.

**Arguments:** none.

**Does:**

1. Creates `build/<date>` from `baseBranch` (or `build/<date>-2`, `-3`, … if
   that name is taken), or reuses the current `branchPrefix*` branch.
2. Adds `.foundry/implement.lock` to `.gitignore` if it is not already there.
3. Writes the lock with its counter at `0`, arming the guard hook.
4. Fills in `Branch:` and `Started:` in `PROGRESS.md` if they are placeholders.
5. Commits as `chore: start implementation run`, or
   `chore: start review-fix round N`.

**Returns:** `{ alreadyStarted, branch, commit, counts, round }`.

**Refuses when:** any of `SPEC.md`, `PLAN.md`, `PROGRESS.md` or `foundry.json`
is missing; the directory is not a git repository; the working tree is dirty on
the base branch; or the current branch is neither the base branch nor a
`branchPrefix*` branch.

---

## `foundry_task_next`

Select the next task. This is the only legitimate way to choose what to work
on.

**Arguments:** none.

**Does:** picks the first `[~]` task (a resume), else the first `[ ]`. Before
handing it over, it checks the task's `**Depends on:**` list; if any dependency
is `[!]` or `[-]`, the task is marked `[-]`, logged as
`SKIPPED: depends on <id>`, and the search continues. Skips cascade
transitively and are committed together as `progress: skip <ids>`. The selected
task is marked `[~]` on disk before it is returned.

**Returns, when work remains:**

| Field | Meaning |
|---|---|
| `done` | `false` |
| `id`, `title` | Task identity |
| `text` | The task's full `### <ID>: <title>` block from `PLAN.md` |
| `files` | The `**Files touched:**` line, for `foundry_verify` |
| `dependsOn` | Dependency ids |
| `dependencyLogs` | Those dependencies' log entries from `PROGRESS.md` — the only context carried between tasks |
| `skipped` | Tasks skipped on the way to this one |
| `counts` | Task counts after the selection |
| `resumed` | `true` if the task was already `[~]` — a previous attempt died mid-task |

**Returns, when nothing remains:** `{ done: true, counts, skipped }`.

**Refuses when:** `PROGRESS.md` or `PLAN.md` is missing, or a task in
`PROGRESS.md` has no matching `### <ID>: <title>` heading in `PLAN.md`.

---

## `foundry_task_done`

Mark a task complete and write its log entry.

**Arguments:** `{ id, log }` — `log` is the entry body, kept under ~15 lines:
tests added, interpretation choices, config keys introduced, anything the
reviewer or a later task must know.

**Does:** marks the task `[x]`, appends `### <ID> — <sha>` plus the log body
under `## Log`, and commits `PROGRESS.md` as `progress: <ID> done`.

**Returns:** `{ id, taskCommit, progressCommit, counts }`.

**Refuses when:** the id is unknown; the task is not `[~]` (nobody selected
it); HEAD's commit subject does not start with `<ID>:`; or anything other than
`docs/PROGRESS.md` is uncommitted. The last two are the load-bearing ones — a
task is done when there is a commit, not when a model says so.

---

## `foundry_task_block`

Give up on a task without ending the run.

**Arguments:** `{ id, reason }` — the reason should read
`what you tried / what fails / what you think the fix is`.

**Does:** `git reset --hard HEAD` and `git clean -fd` (the lock survives, being
gitignored), marks the task `[!]`, logs `BLOCKED: <reason>`, and commits as
`progress: <ID> blocked`.

**Returns:** `{ id, progressCommit, counts }`.

**Refuses when:** the id is unknown, or either argument is missing.

---

## `foundry_verify`

Run the project's verification commands through the server rather than through
the model's Bash tool — which is what keeps an unattended run from stopping at
a permission prompt.

**Arguments:** `{ files?: string[] }` — the task's touched files. A
whitespace- or comma-delimited string is accepted too.

**Does:** runs every command in `verify`, then, for each `extraVerify` prefix
that any touched file starts with, appends its commands (skipping duplicates).
Each command runs in a shell from the project root with a timeout of
`commandTimeoutMs` (default 10 minutes).

**Returns:** `{ ok, results: [{ command, ok, exitCode, timedOut, stdoutTail, stderrTail }] }`,
where the tails are the last 60 lines of each stream.

**Refuses when:** `foundry.json` is missing or has no `verify` commands.

---

## `foundry_run_finish`

End an implementation run and hand off to review.

**Arguments:** none.

**Does:**

1. Commits `docs/HANDOFF.md` as `chore: handoff for review`.
2. Records the round as implemented in `.foundry/state.json` and commits it as
   `chore: round N implemented`.
3. Pushes to `origin` if there is one, and — if `gh` is on `PATH` — opens a
   draft PR with `HANDOFF.md` as the body, or reports the existing one.
4. Deletes the lock, standing the guard hook down.

**Returns:** `{ branch, base, head, handoffCommit, stateCommit, push, pr, counts, round, readyLine }`.
`push` is `"pushed"`, `"skipped: no origin remote"`, or `"failed: <git's
message>"` — a failed push does not fail the handoff, because the branch is
still perfectly reviewable locally.

**Refuses when:** any task is still open; `HANDOFF.md` does not exist; or the
tree is not clean after the handoff commit.

---

## `foundry_review_submit`

Record a verdict. Call it exactly once per review.

**Arguments:**

```jsonc
{
  "verdict": "APPROVED" | "CHANGES REQUESTED",
  "tasks": [                       // CHANGES REQUESTED only
    {
      "title": "…",                // required
      "goal": "…",                 // required
      "files": ["src/a.ts"],       // required, non-empty
      "tests": "…",                // required — the test that would have caught this
      "constraints": "…",
      "outOfScope": "…",
      "verification": "…",
      "dependsOn": ["R1-01"]
    }
  ],
  "unblock": [                     // CHANGES REQUESTED only
    { "id": "P2-04", "reason": "the API does exist; see SPEC §6" }
  ]
}
```

`unblock` also accepts bare id strings, which get a default reason.

**Does, for `APPROVED`:** records the verdict and commits `REVIEW.md` as
`review: approved`.

**Does, for `CHANGES REQUESTED`:** assigns `R<N>-<nn>` ids, appends
`## Review fixes (round N)` to `PLAN.md` in task format, appends the checkbox
lines to `PROGRESS.md` above `## Log`, resets unblocked tasks to `[ ]` with
their reasons logged, bumps the round, and commits everything as
`review: round N`. If the new round exceeds `maxRounds` it also writes a
`halted` reason into `.foundry/state.json`, which stops the next flight.

**Returns:** `{ verdict, round, commit }` for an approval;
`{ verdict, round, fixTasks, unblocked, commit, halted, counts }` for changes.

**Refuses when:** the verdict is neither legal value; `REVIEW.md` does not
exist; no implementation handoff has been recorded for this round; an approval
carries fix tasks or unblocks; changes are requested with neither; a fix task
is missing `title`, `goal`, `files` or `tests`; or an unblock names a task that
does not exist or is not blocked or skipped.

---

## `foundry_summary_commit`

**Arguments:** none.

**Does:** marks the flight complete and commits `docs/SUMMARY.md` as
`chore: build summary`.

**Returns:** `{ commit, branch, base, head, rounds }`.

**Refuses when:** `SUMMARY.md` does not exist, or the recorded verdict is not
`APPROVED`.

---

## Calling the server directly

It speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, so it can be driven
from a shell for debugging:

```bash
FOUNDRY_PROJECT_DIR=/path/to/project node mcp/server.mjs <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"foundry_status","arguments":{}}}
EOF
```

`test/harness.mjs` wraps the same transport, which is how every suite talks to
it.
