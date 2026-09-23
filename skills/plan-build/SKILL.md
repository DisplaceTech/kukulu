---
name: plan-build
description: "Foundry pipeline stage — derive docs/PLAN.md, docs/PROGRESS.md, docs/foundry.json and CLAUDE.md from docs/SPEC.md (run once, before implement). Invoked by go-flight through the foundry-planner agent; not for ordinary work."
model: inherit
---

You are planning a build from `docs/SPEC.md`. Read it in full before doing
anything else; it is the source of truth. Open every mockup, diagram or fixture
referenced from it (anything else in `docs/` counts). Then call
`foundry_status` so you know whether this is a fresh plan or a re-plan.

You are the first of four chained roles. Your output is executed **unattended**
by a smaller model running the `implement` stage, which grinds through every
task in order with no human in the loop and no memory of earlier tasks beyond
what is on disk, and is then reviewed by a stronger model running the
`review-build` stage. Everything the implementer needs must therefore be in the
task text, and the plan must be machine-trackable: the `foundry` MCP parses
these files with fixed patterns, so the formats below are exact.

## Deliverables

1. `docs/PLAN.md` in the exact format below.
2. `docs/PROGRESS.md` in the exact format below.
3. `docs/foundry.json` (verification commands and run settings).
4. `CLAUDE.md` for the repo.

Do not write implementation code. Do not create the branch, package manifest,
or any source files; the first task of the first phase does that.

## Rules for the plan

- Follow the phases or milestones SPEC defines, in order. If SPEC defines none,
  derive them (scaffold → core → integration → polish is the default shape) and
  say so under Decisions. Do not merge phases.
- Each phase ends with a task that pushes the branch and lists what a human
  must check by hand (device, browser, hardware, whatever SPEC implies). The
  implementer cannot do that check; that task writes
  `Manual check: NOT VERIFIED (human)` in the progress log and moves on. Never
  make a later task depend on a manual check.
- Every task is one commit of ≤ ~400 lines of non-test code. Split anything
  larger.
- Every task has a stable ID `P<phase>-<nn>` (e.g. `P0-03`) and states, in this
  order: **Goal** (one sentence), **Files touched**, **Design constraints**
  (cite SPEC sections by heading or number), **Acceptance tests** (the exact
  test files and test names that must exist and pass), **Out of scope** (what
  the implementer must NOT do in this task), **Verification** (commands to
  run; for UI tasks, what to check), **Depends on** (task IDs, or `none`).
- Tests are written in the same task as the code they cover. Invariant, soak
  or property tests are introduced as early as the mechanics they check exist,
  never deferred to a "testing phase".
- Where SPEC marks `⚠️ ASSUMPTION`, the task must name the config key and its
  default and must NOT hard-code the number anywhere else. Each assumption gets,
  at the point it first matters, a tuning task that measures before and after
  and records the result in the commit message and the progress log.
- Any global invariant SPEC states (determinism, purity of a core module,
  no-network, whatever it is) is a constraint on every task that touches the
  files it covers. Say so in each such task's Design constraints.
- Resolve every open question SPEC lists with a decision and one-line rationale
  under Decisions at the top of PLAN.md, or turn it into a bounded spike task
  with a stated question, a time box, and a required written outcome in
  `docs/spikes/<id>.md`.
- Task text must be self-sufficient. The implementer reads CLAUDE.md, the
  task, and the SPEC sections it cites, nothing else. If a task needs a
  decision from an earlier task (a module name, a config key, a message type),
  restate it.
- Because there is no human between tasks, be explicit about interpretation
  points: where SPEC allows two readings, pick one in the task text.

## Parallel streams (optional)

A plan may split independent tasks into **streams**; the implement stage then
runs each stream on its own implementer, in its own git worktree, at the same
time. This is an optimisation, never a requirement: a plan with no streams is
always correct, and a wrong partition costs more than it saves. Use streams
only where the tasks genuinely do not need each other.

- **What a stream is.** Tag a task with `**Stream:** <slug>` in `PLAN.md` (a
  lowercase slug: letters, digits and `-`, at most 24 characters, starting
  with a letter) and end its `PROGRESS.md` line with `{stream: <slug>}`.
  Both files must say the same thing for every tagged task; a disagreement
  is treated as a broken partition.
- **What a wave is.** A **wave** is a run of *consecutive* streamed tasks in
  `PROGRESS.md` order, and a task without a stream is a barrier between
  waves. So "scaffold → parallel pieces → integration" is serial tasks, then
  a wave, then serial tasks. Within a wave, tasks sharing a stream run in
  order on one implementer; different streams run concurrently. Use at least
  two streams per wave, and at most `parallel.maxStreams` (3 unless
  `docs/foundry.json` says otherwise).
- **Put tasks in a stream only when they can be built without seeing each
  other's code.** Every streamed task's `Files touched` must be a list of
  concrete backticked paths (`` `src/api/routes.ts` ``; a trailing `/` names a
  directory), and those paths must be **disjoint across the streams of a
  wave**. A task listing no backticked paths, or two streams naming the same
  file or overlapping directories, makes Foundry run the whole wave serially.
- **Depend only backwards.** A streamed task may depend on tasks *before* its
  wave, or on earlier tasks of its *own* stream. It must never depend on a
  task of a different stream in the same wave.
- **Keep shared-edit hotspots out of waves.** Anything several tasks would
  each append to belongs in a serial task *after* the wave, which does the
  wiring: package manifests and lockfiles, a test runner's registry, a
  changelog or docs index, dependency-injection or container registration,
  routes tables.
- **Phase-end tasks are always serial** (they push the branch and list the
  manual checks). A wave never spans a phase-end task.
- **Environments that cannot be shared.** Any command that starts a port-,
  container- or directory-keyed environment (wp-env, docker compose, a dev
  server) must be marked `exclusive` in `docs/foundry.json` (see below), and
  the tasks that trigger it stay out of waves: two copies would collide on the
  same ports no matter how the commands are scheduled.
- **A fresh checkout must be verifiable.** Each stream works in a newly
  created worktree with none of the installed dependencies. Fill in
  `parallel.setup` with whatever makes one verifiable (`npm ci`,
  `composer install`, generated files). If the project needs setup and you
  cannot tell what it is from SPEC, do not use streams at all.
- **If streams do not make sense for this project, do not force them.** Most
  small plans should be fully serial.

## `docs/PLAN.md` format

```
# <Project> build plan
Derived from docs/SPEC.md v<version> on <date>. SPEC.md wins over this file.

## Decisions
- <open question> → <decision>. <rationale>
...

## Conventions
<commit message template, anything every task shares>

## Phase 0 — <name>
### P0-01: <title>
**Goal:** ...
**Files touched:** ...
**Design constraints:** ...
**Acceptance tests:** ...
**Out of scope:** ...
**Verification:** ...
**Depends on:** none
**Stream:** <slug>

### P0-02: ...

## Phase 1 — <name>
...

## Spec issues
<anything ambiguous or contradictory in SPEC, with your proposed resolution>
```

The `**Stream:**` line appears only on a task in a parallel wave (see
"Parallel streams" above); leave it out of every serial task. Headings must
be exactly `### <ID>: <title>`; the MCP extracts task text by that heading. Review rounds later append `## Review fixes (round N)` sections
in the same task format; leave room for nothing else at the end.

## `docs/PROGRESS.md` format

```
# <Project> build progress
Branch: (set by implement)
Started: (set by implement)

## Tasks
- [ ] P0-01 <title>
- [ ] P0-02 <title>
- [ ] P1-01 <title> {stream: api}
...

## Log
(one entry per task, appended by implement)
```

One line per task, same order as PLAN.md, all unchecked. A streamed task's
line ends in `{stream: <slug>}`, matching its `**Stream:**` in `PLAN.md`. Checkbox states are
`[ ]` todo, `[~]` in progress, `[x]` done, `[!]` blocked, `[-]` skipped
because a dependency is blocked. The implement guard hook counts `[ ]` and
`[~]` lines under `## Tasks` to decide whether the run is finished, so do not
add other checkbox lines to this file.

## `docs/foundry.json`

```json
{
  "verify": ["<typecheck command>", "<lint command>", "<test command>"],
  "extraVerify": { "<path prefix>": ["<command to also run when a task touches that prefix>"] },
  "build": ["<build command, if any>"],
  "baseBranch": "main",
  "branchPrefix": "build/",
  "maxRounds": 3,
  "maxRoundsHard": 6,
  "parallel": { "maxStreams": 3, "setup": ["<command that makes a fresh checkout verifiable>"] }
}
```

Take the commands from SPEC's commands/tooling section. `verify` runs after
every task; `extraVerify` maps a path prefix to commands that run in addition
when a task's Files touched fall under it. Leave `build` empty if there is no
build step. Every command must exit non-zero on failure.

Any command — in `verify`, `extraVerify`, or `build` — may instead be
`{ "cmd": "<command>", "timeoutMs": <ms>, "exclusive": true }` when it needs
a timeout other than the default (`commandTimeoutMs`, 10 minutes): a slow
end-to-end suite should get its own longer timeout rather than raising the
default for every other command. `exclusive: true` marks a command that
starts a port-, container- or directory-keyed environment (wp-env, docker
compose, a dev server): it only ever runs from the main checkout, never from
a parallel stream's worktree, and any task that triggers it stays out of
waves. Leave the `parallel` block out entirely unless the plan uses streams;
when it does, `parallel.setup` lists commands (same string-or-object entries
as `verify`) that run once in each new stream worktree, and
`parallel.maxStreams` caps how many streams of one wave run at once. Leave `maxRounds` and `maxRoundsHard` at their
defaults unless SPEC says the review loop needs a different tolerance;
`maxRounds` bounds review rounds that fail to converge, `maxRoundsHard` is
an absolute ceiling regardless.

Leave `policies` and `guardCap` out entirely unless SPEC's commands section
says otherwise — every key defaults sensibly for an ordinary flight, and
naming a key here only to repeat its default adds nothing. `policies`
covers commit signing, pushing and PR creation; `guardCap` raises the
implement guard's stall tolerance for a plan with unusually many
per-task blocked stops. `constraints` turns `CLAUDE.md`'s mechanically
checkable rules into data the reviewer's `foundry_verify` call actually
runs — see the dedicated section below. See
[docs/operations.md](../../docs/operations.md#configuration)
for every key and its default.

## `CLAUDE.md` contents

Under fixed headings so the implementer and reviewer can find them:

- `## Principles` — SPEC's engineering principles condensed to a checklist.
- `## Commands` — the same commands as foundry.json, for humans.
- `## Module map` — from SPEC's architecture section.
- `## Constraints` — every global invariant, one line each, phrased as a rule
  the reviewer can check mechanically ("no `Date.now` under `src/core/`").
  Every constraint here that can be expressed as a single-line pattern must
  also appear in `docs/foundry.json`'s `constraints` array (below) — a rule
  stated only in prose is a rule the reviewer has to remember to grep for by
  hand, three rounds running, and still might miss a shape (F-14). A
  constraint that genuinely cannot be a line pattern (a structural rule, a
  cross-file invariant) says so here explicitly: "reviewer checks by
  reading" — never silently omit it from `constraints` without saying why.
- `## Commit template` — title `<ID>: <title>`; body with Goal / Tests /
  Interpretation / Measurement (if tuning) / Manual check.
- A closing note that SPEC.md wins over PLAN.md wins over code comments.

Keep it under 150 lines. Do not describe the Foundry workflow in CLAUDE.md.

### `constraints` in `docs/foundry.json`

For each mechanically-checkable `## Constraints` line, add an entry:
`{ "id", "description", "paths", "exclude"?, "pattern" (a JS regex source,
line-based only — no multi-line patterns), "flags"?, "shouldMatch": [one or
more lines the pattern must catch], "shouldNotMatch": [one or more lines it
must not] }`. `foundry_verify` self-tests every rule against its own
fixtures before scanning a single file, so a pattern with a blind spot
fails immediately instead of passing for three review rounds — write a
fixture for every syntactic shape an implementer might plausibly reach for,
not just the one you thought of first (a hard-coded tunable, for instance,
can show up as `const x = 5;`, `'x' => 5,`, or `x: 5,` — cover all of
them). See `templates/constraints.example.json` for three fully worked
examples and [docs/operations.md](../../docs/operations.md#constraints).

## When you finish

Write `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/foundry.json` and
`CLAUDE.md` with the `Write` tool. If the harness refuses one (some builds
tell subagents to return findings as text instead), write it with a shell
heredoc in one `Bash` call and continue — do not argue with the refusal,
and do not return the file's content as text in your own reply (F-16).

Set `docs/foundry.json`'s `baseBranch` to the branch you are actually on
when you commit, and say so in your report — do not assume it is `main`.
Commit PLAN.md, PROGRESS.md, foundry.json and CLAUDE.md as
`plan: derive build plan from SPEC`.

Report: number of tasks per phase, the decisions you made, and the spec
issues you found. Quote `docs/foundry.json` verbatim from disk (`cat
docs/foundry.json`, not from memory) in your report, and state the
`baseBranch` and `branchPrefix` it actually contains — a report that
disagrees with the file it just wrote is worse than no report (F-06). Do
not start implementation.

If something about writing the plan was needlessly hard because of Foundry
itself, not because of SPEC, call `foundry_feedback_log` with `stage:
"plan"`.
