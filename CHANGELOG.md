# Changelog

All notable changes to this plugin. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-09-23

Parallel workstreams. This changes how a flight flows, which is why it is a
minor version and not a patch: `go-flight` now spawns more than one stage
agent at once, `PLAN.md` gains a field, and `foundry_next` gains a shape.
The motivating flight ran 26 tasks on one implementer for about 68 minutes
though many had disjoint file sets (F-05 of
[`docs/feedback/2026-09-23-project-b.md`](./docs/feedback/2026-09-23-project-b.md)).
A plan with no streams behaves exactly as it did in 0.3.2: every existing
suite passes unchanged.

### Added

- **Streams and waves.** A task may carry `**Stream:** <slug>` in `PLAN.md`
  and a `{stream: <slug>}` suffix on its `PROGRESS.md` line. A **wave** is a
  run of consecutive streamed tasks; any untagged task is a barrier. Within a
  wave, tasks of one stream run in order on one implementer and different
  streams run concurrently. `foundry_status` reports `waves`.
- **Partition validation that never halts.** A wave runs in parallel only if
  its partition is provably safe: `PLAN.md` and `PROGRESS.md` agree, every
  task lists concrete backticked `Files touched`, no two streams overlap (a
  trailing `/` is a directory), no task depends on another stream of the
  same wave, no task triggers an `exclusive` command, and there are at least
  two streams. Otherwise the wave runs serially and one `stream-partition`
  feedback entry says why.
- **`foundry_stream_finish`** (sixteen tools now): merges a finished
  stream's branch into the build branch (`--no-ff`) and removes its worktree
  and branch. A merge conflict is the one stream failure that halts:
  Foundry aborts the merge, keeps the stream, and records the paths and the
  manual steps.
- **Stream-scoped tools.** `foundry_run_start`, `foundry_task_next`,
  `foundry_task_done`, `foundry_task_block` and `foundry_verify` take
  `stream`. `foundry_run_start({ stream })` creates
  `.foundry/worktrees/<stream>` on `<build-branch>--<stream>` and runs
  `parallel.setup` in it. `PROGRESS.md`, `PLAN.md` and `state.json` live only
  in the main checkout, so merging a stream can never conflict on
  bookkeeping.
- **`foundry_next` hands out waves.** An implement result may carry
  `streams`, one entry per stream; `go-flight` spawns them all in a single
  message and waits for all before asking again. A stream that stopped early
  is simply handed out again.
- **`parallel.maxStreams`** (default 3; `1` turns parallelism off, silently),
  **`parallel.setup`** (commands run once in each new worktree — a fresh
  checkout has no installed dependencies) and **`exclusive: true`** on a
  command entry (wp-env and anything bound to a port or directory only ever
  runs from the main checkout, and its tasks stay out of waves).
- **`paused` at a wave boundary.** A serial implementer that has finished
  everything before a wave gets `{ done: true, paused: true, … }` from
  `foundry_task_next` and is told not to write a handoff; the lock is flagged
  so the guard lets it stop.
- **`foundry_status`'s `longestCommandTimeoutMs`**, because tool calls are
  handled one at a time (see below).

### Changed

- **"Exactly one stage at a time" is now "exactly one `foundry_next` result
  at a time."** A wave's streams count as one result.
- **The implement guard is stream-aware.** A stream's implementer is blocked
  only while its own stream has open tasks, and a stream that cannot be
  identified while a wave is in flight is allowed (the controller re-hands
  it out).
- **Verification is serialized, deliberately.** Every tool handler is
  synchronous, so the server handles one call at a time — which is what makes
  concurrent implementers safe with one `PROGRESS.md` and one `state.json`.
  Suites often share ports, containers or databases, and most of a stream's
  wall clock is model time. The consequence is that a stream's bookkeeping
  call can wait behind another stream's longest verify, so Claude Code's
  `MCP_TOOL_TIMEOUT` must exceed the longest command timeout plus headroom
  (documented in [`docs/operations.md`](./docs/operations.md#parallel-streams)).
- The `plan-build` skill teaches the planner when streams are safe and when
  not to use them; the `implement` skill gains a Stream mode section.
- **Review-fix tasks are serial.** The reviewer does not assign streams, so
  `R<N>-<nn>` tasks always run serially. A task the reviewer *unblocks* keeps
  its `{stream}` tag, so a fix round re-runs just that stream in its own
  worktree before the serial fix tasks.

### License

- Relicensed from MIT to Apache License 2.0. Releases 0.3.x and earlier
  remain available under MIT. A `NOTICE` file is added, and
  `package.json`, `.claude-plugin/plugin.json` and the marketplace entry
  carry `"license": "Apache-2.0"`. Contributions are accepted under Apache
  2.0 (inbound = outbound; see `CONTRIBUTING.md`).

## [0.3.2] — 2026-09-23

Fixes from the first real flight on 0.3.1
([`docs/feedback/2026-09-23-project-b.md`](./docs/feedback/2026-09-23-project-b.md)),
whose friction the new feedback channel captured by itself. No pipeline
behavior change: no stage gained judgment, no `foundry_next` transition
moved, and nothing about rounds, verdicts or policies changed.

### Fixed

- **The implement guard no longer blocks the flight controller** (F-01).
  The guard treated a `Stop` as the implementer's when the session
  transcript contained the text `foundry_run_start`, and a controller's
  always does — the implement prompt it relays says "Call
  foundry_run_start" — so every controller turn end was blocked and each
  block spent a re-block from `guardCap`. The guard now parses the
  transcript and matches only an actual `foundry_run_start` `tool_use`.
- **Fallback spawns pass a model the `Agent` tool accepts** (F-02). The
  tool's `model` parameter takes only `sonnet`/`opus`/`haiku`/`fable`, but
  the controller passed the routed value, so a role routed to a full id
  such as `claude-opus-5-5` failed with `InputValidationError` on the
  fallback path. `foundry_next` now returns `agentModel` (the alias to pass,
  or `null`) and `agentModelExact` (false when a full id was mapped to its
  family, in which case the controller prints a one-line note). A
  `claude-*` id of an unknown family counts as unreachable and needs a
  restart, like a non-Anthropic model; generated agent files still carry
  the full id verbatim.
- **`foundry_review_submit`'s `counts` include the fix tasks it just
  queued** (F-03). They were taken before the new `R<N>-<nn>` lines were
  appended, so a submit that queued three tasks reported `open: 0`.

### Added

- **`foundry_mutate`** (F-04): the reviewer's mutation check as an MCP
  tool. It applies one exact find/replace to one clean tracked file, runs
  the verify commands that file triggers (`verify` plus matching
  `extraVerify`, so root-bound suites such as wp-env run), always restores
  the file, and commits nothing. A sentinel lets `foundry_mutate`,
  `foundry_verify` and `foundry_review_submit` repair a file left mutated
  by a crash, reported as `recoveredMutation`. Fifteen tools now.

### Changed

- **`review-build` uses `foundry_mutate` instead of hand edits.** The
  reviewer is told never to edit source in the working tree, even
  temporarily; a surviving mutation is a category-3 finding. The reviewer
  agent gains the tool.

Parallel workstreams (F-05 of the same file) change how a flight flows and
are planned for 0.4.0 in [`docs/plans/v0.4.md`](./docs/plans/v0.4.md).

## [0.3.1] — 2026-09-21

Bookkeeping, not a pipeline behavior change: no stage gained judgment, no
transition changed. This release automates the one manual step the
compound-engineering loop still had — writing down what Foundry itself
cost a flight time.

### Added

- **`foundry_feedback_log` and `.foundry/feedback.jsonl`**: a durable,
  append-only, self-committing log of pipeline friction. Any stage calls
  it the moment something is Foundry's own fault — a tool refused, a
  prompt was ambiguous, a stall needed a workaround — and the entry
  survives even a flight that never reaches `summarize`, since the tool
  commits on every call rather than waiting for a later stage to notice
  and transcribe it. `foundry_status` reports `feedbackCount`. Fourteen
  tools now.
- **Three MCP-internal auto-log points**: `foundry_run_halt` records why a
  run stopped; `foundry_review_submit` records a round-cap halt
  (non-converging or hard-cap); `foundry_run_start` records an `auto`
  signing-policy fallback. None of these call the tool itself — they
  append directly, in the same commit as the state change that triggered
  them, so no extra commit appears. An explicit `signing: "off"` or an
  unconfigured `"none"` is the operator's own choice, not friction, and
  logs nothing.
- **Every stage skill logs friction directly**: `implement`, `review-build`
  and `plan-build` now call `foundry_feedback_log` the moment something
  costs them time, instead of writing it into a document a later stage
  might read. `go-flight` logs a failed permission sync and every
  `RESTART REQUIRED` branch before it stops.
- **`policies.feedback`** (default `true`): set `false` in
  `docs/foundry.json` to disable `foundry_feedback_log` and every internal
  auto-log point in one place.
- **`/foundry:pull-feedback`**: a standalone, model-invocable maintainer
  skill that reads another project's `.foundry/feedback.jsonl` and writes
  it into this repo's `docs/feedback/` as a new, properly numbered file,
  deduping against every existing file by each entry's exact timestamp so
  a repeat pull never duplicates an entry.

### Changed

- **The `## Pipeline friction` heading convention is retired.** The
  `implement` and `review-build` skills no longer write a "Pipeline
  friction" section into `docs/HANDOFF.md` or `docs/REVIEW.md` — that
  material now lives in `.foundry/feedback.jsonl` from the moment it
  happens, not collected after the fact from a heading only the
  summarizer read. The `summarize` skill's own "Pipeline friction" section
  in `docs/SUMMARY.md` still exists, but now reads `foundry_status`'s
  `feedbackCount` and `.foundry/feedback.jsonl` directly instead of
  scanning headings across `HANDOFF.md` and every round's `REVIEW.md`.

## [0.3.0] — 2026-09-21

### Added

- `foundry_next` and `foundry_agents_sync` report `agentFallback`,
  `fallbackAgent` and `restartRequired`. Claude Code hot-reloads a routing
  change to an already-populated `.claude/agents/` directory within
  seconds; only a project's very first sync, and only for a role routed to
  a model the `Agent` tool cannot name directly, still needs
  `FOUNDRY: RESTART REQUIRED` (F-02, F-04, F-06). Every other case falls
  back to the plugin's own agent with the resolved `model` and proceeds
  without stopping.
- **`foundry_agents_sync` sets up the MCP allow rule** (F-03): without
  `{ "permissions": { "allow": ["mcp__plugin_foundry_foundry"] } }`, the
  first `foundry_status` call in a subagent is denied under every
  permission mode and the flight stalls silently. The sync now read-merges
  this rule into `.claude/settings.local.json`, unless it is already
  covered there or in the committed `.claude/settings.json`, preserving
  every other key and allow entry; a `settings.local.json` that fails to
  parse is reported (`permissions: "failed: ..."`) rather than overwritten.
  `foundry_config_show` reports `permissionRule: "present" | "missing"`.
  Both `settings.local.json` and the generated agent files are excluded
  from git per clone via `.git/info/exclude`.
- **Run policies and `foundry_run_halt`** (F-05): after 14 tasks a signing
  agent stopped responding mid-flight, and the implementer had no way to
  learn the operator had already authorized unsigned commits, nor a clean
  way to stop. `docs/foundry.json` gains a `policies` block —
  `signing: "auto" | "off" | "required"`, `push: boolean`, `pr: "draft" |
  "none"` — resolved and recorded by `foundry_run_start`, which also probes
  signing for real (`git commit-tree -S`, never a dry run): `off` disables
  it locally; `required` refuses to start unless a genuine signed commit
  succeeds; `auto` falls back to disabling it and records why. Every stage
  prompt from `foundry_next` states the run's policies in one sentence. The
  new `foundry_run_halt` tool lets a run stop cleanly for an operator-level
  problem — a dead signing agent, a full disk, a vanished base branch —
  without resetting or cleaning the tree; `foundry_status` and
  `foundry_next` report the halt like any other. The implement skill
  documents when to disable signing mid-run versus when to halt. The server
  now defines thirteen tools.
- **The compound step: feedback in, friction out.** `FEEDBACK.md` — the
  untracked notes from the flight this release was built to fix — moves to
  `docs/feedback/2026-09-21-project-a.md`, the first entry in a tracked
  convention (`docs/feedback/README.md`) for collecting what a real flight
  hits. `docs/SUMMARY.md` gains a "Pipeline friction" section: anything the
  pipeline itself cost time on, not the project it built, collected from a
  new `## Pipeline friction` heading the implement and review-build skills
  now record in `HANDOFF.md` and each round's `REVIEW.md`. "None" is a
  valid entry. README's Contributing section explains the loop: a flight's
  friction feeds a feedback file, and a release plan works through it.
- **Documentation pass for 0.3.** `docs/operations.md` gains a
  "Calibrating" section with the real per-stage timings and token counts a
  76-task flight produced, and what each tuned default (`guardCap: 60`,
  `commandTimeoutMs: 600000`, `maxRounds: 3` / `maxRoundsHard: 6`) was set
  from. Every key `cfg()` returns now has a row in the config table (a new
  `plugin` suite assertion enforces it going forward). The symptom table
  gains rows for a `Round:` refusal, a non-converging or hard-cap halt, a
  missing permission rule, and states plainly that the controller itself
  should never be blocked by the guard after 0.3.0. Two claims 0.3 itself
  had made false were caught and fixed: `docs/architecture.md`'s decision
  order still listed the round-cap check `foundry_next` no longer makes
  (V3-10 removed it from `next()` but not from the doc), and its tool count
  still said twelve. `docs/plans/` joins the documentation map.
- **Stage agents declare their tools explicitly** (F-16): all four
  plugin agents (and the generated `foundry-<role>` files, which copy it
  verbatim) now carry a `tools:` frontmatter list — the six general tools
  plus exactly the `foundry` MCP tools that role actually calls, in the
  plugin-prefixed form, never `Agent` (a stage never spawns). The
  summarize, plan-build and implement skills also state a shell-heredoc
  fallback for writing their deliverable file if the harness refuses the
  `Write` tool, so a refusal costs no turn and the file is never returned
  as text instead of being written. The plan-build skill's report must now
  quote `docs/foundry.json` from disk (`cat docs/foundry.json`), not from
  memory, and the planner sets `baseBranch` to the branch it is actually on
  when it commits — closing the gap where a planner's report and the file
  it wrote once disagreed (F-06).
- **Constraints as data, checked mechanically** (F-14): three consecutive
  review rounds found a hard-coded tunable that `CLAUDE.md`'s own grep
  missed — array `=>` syntax only, then an allow-list left in place, then
  plain `= N;` — because the rule lived only in prose and had to be
  re-checked by hand each round. `docs/foundry.json` gains a `constraints`
  array: `{ id, description, paths, exclude?, pattern, flags?, shouldMatch,
  shouldNotMatch }`. `foundry_verify` self-tests every rule against its own
  fixtures before scanning a single file — a fixture that disagrees fails
  the rule outright, reported as `fixture` in the result — then scans every
  *tracked* file (untracked and gitignored files are never touched) under
  `paths` minus `exclude`, reporting each hit as `{ file, line, text }`.
  Line-based only. This runs whole-repo on every `foundry_verify` call,
  regardless of `files`. `templates/constraints.example.json` ships three
  fully worked rules with fixtures covering multiple syntactic shapes. The
  plan-build skill requires a `constraints` entry for every mechanically
  checkable `CLAUDE.md` rule; the review-build skill treats a rule that
  missed a real violation as a defect in the rule, closed by adding the
  missed shape to `shouldMatch`; the implement skill treats a constraint
  hit as a failing test. New `constraints` test suite.
- **Per-command verify timeouts.** A `verify`, `extraVerify` or `build`
  entry in `docs/foundry.json` may now be `{ "cmd": "...", "timeoutMs": N }`
  instead of a bare string, so one slow end-to-end command can get a longer
  timeout without raising `commandTimeoutMs` for every other command. A
  malformed entry (missing `cmd`, a non-positive or non-integer
  `timeoutMs`) refuses with the offending entry named. `foundry_verify`'s
  per-result `timeoutMs` reports which timeout each command actually ran
  with. The plan-build skill's `docs/foundry.json` template documents the
  form and every key introduced since 0.2.0 (`guardCap`, `policies`,
  `maxRoundsHard`), which had gone undocumented there.

### Changed

- **Converging review rounds no longer halt the flight** (F-13, F-15): every
  round used to count against `maxRounds` regardless of whether findings
  were shrinking, so a flight whose findings went 15 → 3 → 2 could halt on
  a round that was, by every measure, converging. `maxRounds` (default 3)
  now bounds *non-converging* rounds only — a round whose fix-task count
  did not shrink from the round before it; round 1 is always allowed. A
  new `maxRoundsHard` (default 6) is the absolute ceiling regardless of
  convergence. `state.rounds` records every submission
  (`{ round, fixTasks, unblocked, verdict, nonConverging, at }`), and the
  halt message shows the trail of counts. The summarize skill's review
  history now reads it directly instead of reconstructing it from git.
- **The MCP owns the review round number** (F-10, F-11): `foundry_status`
  and `foundry_next` expose `reviewRound` (always `round + 1`), and the
  review prompt states it explicitly ("This review is round N") instead of
  leaving a reviewer to derive it from `round` and risk being off by one.
  `foundry_review_submit` now reads `docs/REVIEW.md`'s `Round:` line and
  refuses, for either verdict, when it is missing or does not equal
  `reviewRound`. It also validates every fix task's `dependsOn`: each must
  name an existing task or one of the same submission's own new ids.
  Approval now commits as `review: round N approved` (was `review:
  approved`), so `git log --grep '^review:'` lists every round uniformly.
- **Every push-worthy commit is actually pushed** (F-18): after a flight,
  the `review:` commit from `foundry_review_submit` and the `chore: build
  summary` commit from `foundry_summary_commit` used to stay local, and the
  base branch never received the planner's commits at all, so a PR
  silently included `PLAN.md`/`PROGRESS.md`/`foundry.json` as if they were
  build work. Both tools now push after their commit, `foundry_run_start`
  pushes the base branch before cutting the first build branch, and all
  three honour `policies.push`. A shared helper makes every push report the
  same shape: `"pushed"`, `"skipped: policy"`, `"skipped: no origin
  remote"`, or `"failed: <git's first line>"`.
- Pre-existing untracked files are invisible to a run (F-09, F-17):
  `foundry_run_start` records every path already untracked before it arms
  the lock. `foundry_task_done` and `foundry_run_finish` ignore those paths
  in their dirty-tree checks, and `foundry_task_block`'s `git clean` now
  excludes them instead of deleting them outright. `foundry_run_start`'s own
  "working tree is dirty" gate on the base branch also now considers only
  *tracked* changes, since an untracked file blocking a run from starting at
  all defeated the purpose. `foundry_status` exposes the recorded list as
  `preexistingUntracked`. The implement and review-build skills say so:
  never move, delete, rename, or gitignore a file you did not create, and an
  unexplained edit to `.gitignore` or similar is a review finding.
- The implement guard's cap counts stalls, not stops (F-08): `foundry_task_done`,
  `foundry_task_block` and `foundry_run_start` all reset the re-block counter
  to zero, so the cap bounds re-blocks since the last time work actually
  moved, not the whole run. The default drops from 500 to 60 — at the
  ~6 blocked stops per healthy task observed in practice, 60 is ten tasks'
  worth of blocking with no progress. A new `guardCap` key in
  `docs/foundry.json` overrides the default per project, carried into
  `.foundry/implement.lock` at `foundry_run_start` and taking precedence
  over the `FOUNDRY_GUARD_CAP` environment variable. The trip message now
  names the stalled task. `foundry_task_done`'s return gains `guardReset`.
- The implement guard is a Node script (`scripts/implement-guard.mjs`,
  replacing `implement-guard.sh`) scoped to the implementer, not to every
  `Stop`/`SubagentStop` in the project (F-07). `hooks/hooks.json` matches
  `SubagentStop` to the implementer's agent type at the hook-registration
  level; the script itself also checks `agent_type`, and for a bare `Stop`
  checks whether the stopping session's own transcript called
  `foundry_run_start`. A controller session merely waiting on a background
  implementer is never blocked and never spends the re-block counter.
  `foundry_run_start` now writes `.foundry/implement.lock` as JSON
  (`{ count, armedAt, round }`); a legacy bare-number lock from a 0.2.x run
  still reads back correctly. `foundry_status` gains `lockCounter`.
- `go-flight` is model-invocable (F-01): `disable-model-invocation` is gone,
  so asking Claude to run the flight works alongside the literal
  `/foundry:go-flight` command. The loop section now describes an `Agent`
  call as event-driven rather than a blocking wait, since some harnesses
  return immediately and deliver the result as a later notification (F-04).

## [0.2.0] — 2026-09-19

### Added

- **Per-role model routing.** Each of the four stage roles can be pointed at
  a different model — an Anthropic alias or id, or a model reached through
  a local router such as claude-code-router — from a global config file
  (`$FOUNDRY_CONFIG`, else `$XDG_CONFIG_HOME/foundry/config.json`, else
  `~/.config/foundry/config.json`), an optional named profile inside it
  (`FOUNDRY_PROFILE`, or the file's own `"profile"` key), and an optional
  per-project override in `docs/foundry.json`'s new `roles` and
  `permissionMode` keys. See `docs/routing.md`.
- **`foundry_agents_sync`** generates `.claude/agents/foundry-<role>.md`
  from the merged config, writing only files whose content changed, and
  excludes them from git via `.git/info/exclude`. `/foundry:go-flight` calls
  it once before its loop and prints the resolved table.
- **`foundry_config_show`** shows the merged routing config, read-only,
  with the source of every value (`default` | `global` | `profile:<name>` |
  `project`) and which generated agents are stale.
- **`foundry_next`** gains a `model` field and now names the generated
  `foundry-<role>` agent once one exists, instead of the plugin's own
  `foundry:<role>`. **`foundry_status`** gains `agentsGenerated`.
- **Templates**: `templates/foundry.config.example.json` and two
  claude-code-router provider manifests under `templates/ccr/`.
- **Test suite**: an eighth suite, `routing` (194 assertions), covering the
  config merge, both new tools and every refusal.

### Changed

- Project-level agents accept `permissionMode`, which every generated agent
  now carries (default `acceptEdits`) — once `/foundry:go-flight` has run
  once in a project, launching with `--permission-mode acceptEdits` is no
  longer required for the implementer's file edits. MCP tool calls inside a
  subagent still need a `permissions.allow` rule for
  `mcp__plugin_foundry_foundry`; the README shows it.
- `go-flight`'s `allowed-tools` now names the MCP tools the way a
  plugin-shipped server actually exposes them
  (`mcp__plugin_foundry_foundry__<tool>`), alongside the bare
  `mcp__foundry__<tool>` form a project `.mcp.json` gives. The bare form
  alone never matched a plugin install.
- Claude Code does not load an agent file written or edited after a session
  starts, so a routing config change (including the very first sync in a
  project) makes `/foundry:go-flight` print `FOUNDRY: RESTART REQUIRED` and
  stop, rather than risk spawning a stage against a model the session
  cannot actually reach.
- The server now defines twelve tools.

### Fixed

- The four stage skills (`implement`, `plan-build`, `review-build`,
  `summarize`) set `disable-model-invocation: true`, which — per Claude
  Code's own docs — also blocks a skill from being preloaded into a
  subagent. Every stage agent's `skills:` preload had therefore never
  actually taken effect. The four skills now set neither that flag nor
  their own `model`/`effort` (`model: inherit`), so the agent — plugin
  default or generated — is the sole owner of both, and preloading works.

## [0.1.0] — 2026-09-18

First release.

### Added

- **The pipeline.** `/foundry:go-flight` drives plan → implement → review →
  fix → summarize unattended, delegating each stage to its own subagent and
  stopping only at `done` or `halt`.
- **Four stage agents**, each pinned to a model and effort level: `planner`
  (fable, high), `implementer` (sonnet, medium), `reviewer` (fable, high),
  `summarizer` (fable, medium). Five skills back them, all invocable by hand.
- **The `foundry` MCP server** — zero dependencies, Node ≥ 22 — with ten tools
  covering stage selection, task selection, dependency skipping, checkbox
  edits, log entries, verification runs and every bookkeeping commit.
- **The implement guard**, a `Stop` / `SubagentStop` hook that refuses to let
  the implementer stop while tasks are open and gives up at
  `FOUNDRY_GUARD_CAP` (default 500) so a wedged run ends instead of spinning.
- **Blocked-task handling**: a task that cannot be finished is reset, logged
  and left for the reviewer, and its dependents are skipped transitively
  rather than attempted.
- **Review rounds**: findings become `R<N>-<nn>` tasks in `PLAN.md` and
  `PROGRESS.md`, bounded by `maxRounds`, each round one commit.
- **`templates/SPEC.md`**, the spec skeleton the planner reads by heading.
- **Test suite**: a shared harness plus seven suites (`plugin`, `protocol`,
  `state`, `implement`, `review`, `guard`, `drive`), about 480 assertions,
  covering every tool's success and refusal paths, the JSON-RPC transport, the
  guard hook's environment handling, and the plugin's own manifests,
  cross-references and documentation links.
- **CI**: the suite on every Node line still supported upstream (22, 24, 26),
  again on macOS, and again with the GitHub CLI removed to prove
  `foundry_run_finish` treats `gh` as optional. Separate `lint` workflow
  (pre-commit, actionlint, and a Mermaid parse of every diagram) and
  `secret-scan` workflow (gitleaks per push and over history weekly).
- **Documentation**: `README.md`, `docs/architecture.md`, `docs/mcp-tools.md`,
  `docs/writing-specs.md`, `docs/operations.md` and `CONTRIBUTING.md`.
