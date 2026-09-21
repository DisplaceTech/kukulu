# MCP tool reference

Twelve tools, served over stdio by `mcp/server.mjs` with no dependencies. The
server is launched by Claude Code from [`.mcp.json`](../.mcp.json) with
`FOUNDRY_PROJECT_DIR` set to the project root; every path below is relative to
that root.

Three of them — `foundry_status`, `foundry_next` and `foundry_config_show` —
are read-only. The flight controller is allowed those plus
`foundry_agents_sync`, which writes only the generated agent files and a
`.git/info/exclude` line, never project state. Everything else changes
project state and belongs to a stage agent.

`foundry_next`, `foundry_status`, `foundry_config_show` and
`foundry_agents_sync` all resolve the merged routing config (see
[routing.md](./routing.md)) as part of answering, so a malformed global
config, profile or project override is a refusal from any of the four —
deliberately: a flight must not run with a half-understood routing config.

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
| `lockCounter` | The implement guard's re-block counter, read from the lock (either format); `null` when there is no lock |
| `git` | `{ inRepo, branch, head, base, dirty, hasOrigin }` — `base` is the merge-base with `baseBranch` |
| `state` | `{ round, implemented, reviewed, verdict, summarized, halted, preexistingUntracked }` from `.foundry/state.json` |
| `round` | Current review round (0 = initial build) |
| `preexistingUntracked` | Paths that were already untracked before the current run started — invisible to every dirty-tree check (F-09) |
| `reviewRoundsInPlan` | How many `## Review fixes (round N)` sections `PLAN.md` carries |
| `branch`, `started` | The `Branch:` and `Started:` headers in `PROGRESS.md` |
| `counts` | `{ todo, inProgress, done, blocked, skipped, total, open }`; `open = todo + inProgress` |
| `blocked`, `skipped` | Task ids in those states |
| `reviewVerdictInFile` | The verdict parsed out of `REVIEW.md`, if one exists |
| `agentsGenerated` | Role names whose `.claude/agents/foundry-<role>.md` currently exists |

**Refuses when:** `PROGRESS.md` exists but has no `## Tasks` section,
`foundry.json` is not valid JSON, or the merged routing config is malformed
(see [routing.md](./routing.md)). All three are corruption, not absence, and
guessing past them would produce confident nonsense.

---

## `foundry_next`

The stage machine. A pure function of disk state — it never sees a subagent's
report.

**Arguments:** none.

**Returns:** `{ stage, agent, agentFallback, fallbackAgent, restartRequired,
model, round, reason, prompt }`.

- `stage` — `plan` · `implement` · `review` · `summarize` · `done` · `halt`
- `agent` — the subagent to spawn: the generated `foundry-<role>` name when
  `.claude/agents/foundry-<role>.md` exists on disk, else the plugin's own
  `foundry:planner` / `foundry:implementer` / `foundry:reviewer` /
  `foundry:summarizer`; `null` for `done`, `halt`, and whenever
  `restartRequired` is true
- `agentFallback` — true when the generated agent file cannot yet be trusted
  to spawn in this session: it is absent, or this server process created the
  `.claude/agents` directory itself (see [routing.md](./routing.md) for why
  that one case needs a restart and a routing *change* to an existing
  directory does not)
- `fallbackAgent` — the plugin's own `foundry:<role>` name, always present
  for a stage that has a role, so a controller can retry with it if spawning
  `agent` fails with "not found"
- `restartRequired` — true only when `agentFallback` is true **and** the
  resolved model is not one the `Agent` tool can name directly (an
  Anthropic alias or a `claude-*` id); `false` for `done` and `halt`
- `model` — the resolved model string for that role from the routing config
  (see [routing.md](./routing.md)); `null` for `done` and `halt`
- `reason` — one sentence, written for a human reading the transcript
- `prompt` — the text to hand the subagent **verbatim**

The full decision order is in [architecture.md](./architecture.md#the-stage-machine).

---

## `foundry_run_start`

Begin or resume an implementation run. Idempotent: calling it on a run already
in progress returns `{ alreadyStarted: true }` and changes nothing.

**Arguments:** none.

**Does:**

1. Records every currently untracked path as `preexistingUntracked` in
   `.foundry/state.json` — nothing this run finds already lying around is
   ever this run's business (F-09). Skipped on an idempotent resume, so the
   list is fixed at the start of each round, not re-scanned mid-run.
2. Creates `build/<date>` from `baseBranch` (or `build/<date>-2`, `-3`, … if
   that name is taken), or reuses the current `branchPrefix*` branch.
3. Adds `.foundry/implement.lock` to `.gitignore` if it is not already there.
4. Writes the lock as JSON — `{ count: 0, armedAt, round, cap }`, `cap` from
   `foundry.json`'s `guardCap` — arming the guard hook.
5. Fills in `Branch:` and `Started:` in `PROGRESS.md` if they are placeholders.
6. Resolves `foundry.json`'s `policies` (`signing`, `push`, `pr`) and records
   them in state, and — skipped on an idempotent resume — probes signing:
   `off` disables `commit.gpgsign` locally; `auto`/`required` with signing
   configured actually attempt a signed object (`git commit-tree -S`, not a
   dry run) and record `"on"` on success; `auto` falls back to disabling
   signing locally on failure, recording why; `required` refuses instead of
   falling back. See [operations.md](./operations.md#configuration).
7. Commits as `chore: start implementation run`, or
   `chore: start review-fix round N`.

**Returns:** `{ alreadyStarted, branch, commit, counts, round, policies,
signing }`. `signing` is `"on"`, `"off"`, `"none"` (not configured), or
`"off (probe failed: <reason>)"`.

**Refuses when:** any of `SPEC.md`, `PLAN.md`, `PROGRESS.md` or `foundry.json`
is missing; the directory is not a git repository; `policies` is malformed;
`policies.signing` is `"required"` and signing is not configured or the
probe fails; a *tracked* file has uncommitted changes on the base branch (an
untracked one never blocks a start — see above); or the current branch is
neither the base branch nor a
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
under `## Log`, commits `PROGRESS.md` as `progress: <ID> done`, and resets
the implement guard's re-block counter to zero (F-08).

**Returns:** `{ id, taskCommit, progressCommit, counts, guardReset: true }`.

**Refuses when:** the id is unknown; the task is not `[~]` (nobody selected
it); HEAD's commit subject does not start with `<ID>:`; or anything other than
`docs/PROGRESS.md` is uncommitted — a path already recorded as
`preexistingUntracked` at `foundry_run_start` never counts (F-09). The last
two are the load-bearing ones — a task is done when there is a commit, not
when a model says so.

---

## `foundry_task_block`

Give up on a task without ending the run.

**Arguments:** `{ id, reason }` — the reason should read
`what you tried / what fails / what you think the fix is`.

**Does:** `git reset --hard HEAD` and `git clean -fd`, excluding every path
recorded as `preexistingUntracked` (the lock survives too, being
gitignored) — a file that predates the run is never deleted by it, only
whatever the attempt itself left behind (F-09). Marks the task `[!]`, logs
`BLOCKED: <reason>`, commits as `progress: <ID> blocked`, and resets the
implement guard's re-block counter to zero (F-08).

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
3. Pushes to `origin` if `policies.push` is true and there is one, and — if
   `policies.pr` is not `"none"` and `gh` is on `PATH` — opens a draft PR
   with `HANDOFF.md` as the body, or reports the existing one.
4. Deletes the lock, standing the guard hook down.

**Returns:** `{ branch, base, head, handoffCommit, stateCommit, push, pr, counts, round, readyLine }`.
`push` is `"pushed"`, `"skipped: no origin remote"`, `"skipped: policy"`, or
`"failed: <git's message>"` — a failed push does not fail the handoff,
because the branch is still perfectly reviewable locally. `pr` is `null`
when there was nothing to try, `"skipped: policy"` when `policies.pr` is
`"none"`, a URL, or a `gh` failure message.

**Refuses when:** any task is still open; `HANDOFF.md` does not exist; or the
tree is not clean after the handoff commit — again, ignoring anything
recorded as `preexistingUntracked` (F-09).

---

## `foundry_run_halt`

Stop the flight for an operator-level reason the implementer cannot resolve
itself: a signing agent that died mid-run, a full disk, a `verify` command
that cannot even run, a base branch that vanished (F-05). Distinct from
`foundry_task_block`, which is for a single task the implementer cannot
finish — this is for a run that cannot continue at all.

**Arguments:** `{ reason }` — one sentence a human will read.

**Does:** records `reason` as `state.halted`, deletes the lock, and commits
`.foundry/state.json` and `docs/PROGRESS.md` together as `chore: run halted`
if either changed. Never resets or cleans the working tree — whatever state
the run was in when it could not continue is left exactly as it is.

**Returns:** `{ halted, branch, head, commit, dirty }`. `dirty` is true when
anything is left uncommitted, which after a halt is expected, not an error.

**Refuses when:** `reason` is missing.

The next `foundry_next` call returns `{ stage: "halt", reason }` with the
same reason. Clearing it is the same hand edit as any other halt — see
[operations.md](./operations.md#halts).

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

## `foundry_agents_sync`

Generate `.claude/agents/foundry-<role>.md` for each of the four roles from
the merged routing config. This is what `/foundry:go-flight` calls, once,
before its loop; see [routing.md](./routing.md) for the full precedence.

**Arguments:** none.

**Does:**

1. Resolves the routing config (plugin defaults < global file < profile <
   `docs/foundry.json` `roles`), per role, per key.
2. Renders each role's agent file — frontmatter copied from the plugin's own
   `agents/<role>.md` (`description`, `skills`, `color`), plus the resolved
   `model`, `effort` (only when the model is a known Anthropic alias or a
   `claude-*` id) and `permissionMode` — and writes it only when the
   rendered text differs from what is already on disk.
3. Ensures the MCP allow rule (`{ "permissions": { "allow":
   ["mcp__plugin_foundry_foundry"] } }`) is covered by either
   `.claude/settings.json` or `.claude/settings.local.json` (F-03):
   read-merge-write on the local file, preserving every other key and allow
   entry, creating the file only if neither already covers it. A
   `settings.local.json` that exists but fails to parse is never
   overwritten. See [operations.md](./operations.md#running-a-flight) for
   why this rule matters.
4. In a git repository, ensures both `.claude/agents/foundry-*.md` and
   `.claude/settings.local.json` are present in `.git/info/exclude` (not
   `.gitignore` — both encode a person's own machine, not the project, and
   this way needs no commit). Outside a git repository, this step is
   skipped, not an error.

**Returns:** `{ dir, globalConfig, globalConfigPath, profile, profileSource,
projectOverride, permissionMode, roles, effortDropped, changed, unchanged,
permissions, restartRequired, exclude, table }`.

- `roles` — `{ <role>: { agent, model, effort, source: { model, effort } } }`
  for all four roles; `source` is `default` | `global` | `profile:<name>` |
  `project`
- `effortDropped` — `{ <role>: <effort> }` for any role whose configured
  effort was dropped because its model is not an Anthropic one
- `changed` / `unchanged` — role names written this call / left alone
  because their rendered content was already correct
- `permissions` — `"added"` | `"present"` | `"failed: <why>"`, from the MCP
  allow rule step above
- `restartRequired` — true only when this call populated the
  `.claude/agents` directory for the *first* time in this project and at
  least one changed role's model is not one the `Agent` tool can name
  directly. Claude Code hot-reloads a change to an already-populated agents
  directory within seconds, so every other case — including every later
  routing edit — needs no restart; `foundry_next` falls back to the
  plugin's own agent with the resolved model in the meantime. See
  [routing.md](./routing.md).
- `exclude` — `"added"` | `"present"` | `"skipped: not a git repository"`
- `table` — the same information as a ready-to-print Markdown table

`/foundry:go-flight` checks `restartRequired` and stops with a fixed message
rather than spawning a stage against a model it cannot reach; see
[operations.md](./operations.md#routing).

**Refuses when:** the merged routing config is malformed — an unknown role
or role key, an invalid `effort` or `permissionMode` value, an unknown
top-level key in the global file, or a `FOUNDRY_PROFILE` (or the global
file's own `"profile"` key) naming a profile that does not exist. Nothing is
written on a refusal.

---

## `foundry_config_show`

The merged routing config, read-only, with the source of every value.

**Arguments:** none.

**Returns:** `{ globalConfig, globalConfigPath, profile, profileSource,
projectOverride, permissionMode, permissionModeSource, roles, effortDropped,
agentsGenerated, agentsStale, permissionRule, table }`.

`agentsGenerated` is the same field `foundry_status` returns.
`agentsStale` lists roles whose generated file exists but no longer matches
what `foundry_agents_sync` would write for the current config — this tool
never writes anything itself, so staleness is reported, not fixed.
`permissionRule` is `"present"` when either settings file already covers
the MCP allow rule, else `"missing"` — again reported, not fixed; only
`foundry_agents_sync` writes.

**Refuses when:** the same conditions as `foundry_agents_sync`, with the
same messages.

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
