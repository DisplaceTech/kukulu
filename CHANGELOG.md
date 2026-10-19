# Changelog

All notable changes to this plugin. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The kukulu.tech landing page in `site/`, with the hosted `marketplace.json` that `claude plugin marketplace add https://kukulu.tech/marketplace.json` reads.
- `scripts/check-site.mjs`, `scripts/check-site-browser.mjs` and `scripts/serve-site.mjs`, with the `check:site`, `check:site:browser` and `site:serve` npm scripts.
- `kukulu_run_resume({ reason })` clears a halt that is not a round-cap halt with a `chore: run resumed` commit, so no operator edits `.kukulu/state.json` by hand.
- `kukulu_mutate` runs the active constraints over the mutated tree, reports them as `constraints`, and counts a rule with hits as a kill (`killed: constraint <id> caught the mutation`).
- A `site` CI workflow that runs the static and browser checks.

### Fixed

- `kukulu_plan_commit` refuses a plan committed on a branch that is neither `baseBranch` nor a `branchPrefix` branch, and `kukulu_run_start`'s foreign-branch refusal names both ways out.

### Breaking changes

- The `FOUNDRY_*` environment variables and the `foundry/` global config directory are no longer read; use `KUKULU_*` and `kukulu/config.json`.
- `kukulu_migrate` is removed, and a project on the pre-0.6.0 Foundry layout is refused. Migrate by hand: move `.foundry/state.json` and `.foundry/feedback.jsonl` to `.kukulu/`, `docs/foundry.json` to `docs/kukulu.json`, and the `.foundry/` lines of `.gitignore` to `.kukulu/`, then commit.
- The docs and skills no longer describe the old names or layout, except that archives of flights from before 0.6.0 keep `foundry.json`.
- The `deprecations` field is gone from `kukulu_status` and `kukulu_next`.

## [0.6.1] — 2026-10-16

Documentation only. No code or behavior change.

- Joined hard-wrapped lines in the README, `docs/`, `CONTRIBUTING.md`, the agents and the skills so the Markdown renders and diffs cleanly.
- Reworded the user-facing docs in plainer language and removed internal feedback IDs from prose.
- Corrected the README: go-flight takes several options, four conditions halt a flight, and the suite has about 2,200 assertions.
- Updated the wrapping rule in `CONTRIBUTING.md`.

## [0.6.0] — 2026-10-15

### Summary

Foundry is renamed Kūkulu, and the repository moved from `ericmann/foundry` to `DisplaceTech/kukulu`.

### Breaking changes

Plugin, marketplace and repository:

| Old | New |
|---|---|
| plugin id `foundry` | `kukulu` |
| marketplace `ericmann` | `displacetech` |
| `claude plugin install foundry@ericmann` | `claude plugin install kukulu@displacetech` |
| `claude plugin marketplace add ericmann/foundry` | `claude plugin marketplace add DisplaceTech/kukulu` |
| `https://github.com/ericmann/foundry` | `https://github.com/DisplaceTech/kukulu` |
| npm package `foundry-claude-plugin` | `kukulu-claude-plugin` |

Commands, agents and MCP:

| Old | New |
|---|---|
| `/foundry:go-flight`, `/foundry:plan-build`, `/foundry:implement`, `/foundry:review-build`, `/foundry:summarize`, `/foundry:pull-feedback` | `/kukulu:go-flight`, `/kukulu:plan-build`, `/kukulu:implement`, `/kukulu:review-build`, `/kukulu:summarize`, `/kukulu:pull-feedback` |
| plugin agents `foundry:planner`, `foundry:implementer`, `foundry:reviewer`, `foundry:summarizer` | `kukulu:planner`, `kukulu:implementer`, `kukulu:reviewer`, `kukulu:summarizer` |
| generated agents `.claude/agents/foundry-<role>.md` | `.claude/agents/kukulu-<role>.md` |
| MCP server `foundry` | `kukulu` |
| MCP tools `foundry_<name>` (all 21) | `kukulu_<name>` |
| allow rule `mcp__plugin_foundry_foundry` | `mcp__plugin_kukulu_kukulu` |
| restart line `FOUNDRY: RESTART REQUIRED` | `KUKULU: RESTART REQUIRED` |

Environment variables, paths and files:

| Old | New |
|---|---|
| `FOUNDRY_PROJECT_DIR`, `FOUNDRY_CONFIG`, `FOUNDRY_PROFILE`, `FOUNDRY_GUARD_CAP` | `KUKULU_PROJECT_DIR`, `KUKULU_CONFIG`, `KUKULU_PROFILE`, `KUKULU_GUARD_CAP` |
| `FOUNDRY_TEST_TIMEOUT_MS` (tests only) | `KUKULU_TEST_TIMEOUT_MS` |
| `.foundry/` (`state.json`, `feedback.jsonl`, `implement.lock`, `mutation.json`, `worktrees/`) | `.kukulu/` |
| `docs/foundry.json` | `docs/kukulu.json` |
| `~/.config/foundry/config.json`, `$XDG_CONFIG_HOME/foundry/config.json` | `~/.config/kukulu/config.json`, `$XDG_CONFIG_HOME/kukulu/config.json` |
| `templates/foundry.config.example.json` | `templates/kukulu.config.example.json` |

The plugin id is the slash-command and agent namespace, so the old `/foundry:*` commands, the `foundry_*` tools and the `foundry:*` agents stop resolving when `foundry` is uninstalled. They cannot be aliased.

### Migration

1. Install the new plugin and remove the old one:

   ```bash
   claude plugin marketplace add DisplaceTech/kukulu
   claude plugin install kukulu@displacetech
   claude plugin uninstall foundry@ericmann
   ```

2. In each project that has `.foundry/` or `docs/foundry.json`, run `/kukulu:go-flight migrate`. It calls `kukulu_migrate`, which moves the state, feedback and config files, rewrites the `.gitignore` lines, deletes the generated `foundry-<role>` agents, adds the new allow rule, and commits `chore: migrate .foundry layout to .kukulu`. It refuses unless the tree is clean and no run, mutation or stream worktree is in progress, and it restores every path if the commit fails.
3. Rename `FOUNDRY_*` variables in your shell and `.mcp.json` overrides to `KUKULU_*`, and move the global routing config to `~/.config/kukulu/config.json`.
4. Remove the old `mcp__plugin_foundry_foundry` entry from `.claude/settings.local.json`; `kukulu_migrate` leaves it in place.

Compatibility shims, removed in 0.7.0:

- A project that has `.foundry/` or `docs/foundry.json` and none of `.kukulu/` or `docs/kukulu.json` is read and written in place under the old names. A project that has both is refused by every tool.
- A non-empty `FOUNDRY_PROJECT_DIR`, `FOUNDRY_CONFIG`, `FOUNDRY_PROFILE` or `FOUNDRY_GUARD_CAP` is used when its `KUKULU_*` counterpart is unset or empty. The global routing config is read from the `foundry/` directory when `kukulu/config.json` does not exist.
- The Stop and SubagentStop guard still recognizes the agents `foundry-implementer` and `foundry:implementer` and the tool `foundry_run_start` in transcripts.
- Each of the server's shims (layout, environment variables, global config) adds a line to the `deprecations` array returned by `kukulu_status` and `kukulu_next`, and `/kukulu:go-flight` prints it; the guard hook reports nothing. A `KUKULU_*` value always wins over its `FOUNDRY_*` counterpart.
- An old-layout project whose next stage is `plan` halts with an instruction to run `/kukulu:go-flight migrate`, because planning would create `docs/kukulu.json` beside `.foundry/`.

### Compatibility

Archives, logs and feedback produced by earlier versions remain readable and are not modified. A flight archived as `docs/flights/<slug>/foundry.json` is still read by `kukulu_pr_finalize`, and `/kukulu:pull-feedback` reads `.foundry/feedback.jsonl` as well as `.kukulu/feedback.jsonl`. The record formats (`state.json`, `feedback.jsonl`) did not change and contain no product name. The test suite pins the SHA-256 of every file in `docs/flights/v0-5-0/` and loads that archive on the old layout. Git tags, commits and past changelog entries are unchanged.

### Licensing

Copyright in this project was assigned by Eric Mann to Displace Technologies LLC, effective October 15, 2026. Releases from 0.6.0 onward are published by Displace Technologies LLC under the Apache License 2.0. Licenses granted with earlier releases are unaffected.

### Other changes

- New tool `kukulu_migrate` (22 tools in total).
- `kukulu_status` and `kukulu_next` return a `deprecations` array.
- The secret-scan workflow runs the pinned gitleaks 8.28.0 binary, verified against the release checksum, instead of `gitleaks-action`, which requires a license key in an organization-owned repository.
- `scripts/check-names.mjs` runs in `npm run lint`: it fails on a macron letter outside the standalone name, on an ASCII spelling of the name in Markdown prose, and on an apostrophe where the ʻokina belongs.

## [0.5.0] — 2026-10-07

The end of a flight, finished: three new tools, new config keys, and the fixes
from the first flights on 0.4.0. **Breaking changes** are listed last.

The 0.4.0 flights were two project-c batches and two project-d
flights. Their friction is in
`docs/feedback/2026-10-07-project-c.md`
and
`docs/feedback/2026-10-07-project-d.md`,
and every item is mapped to what closed it in Appendix A of
[`docs/SPEC.md`](./docs/SPEC.md).

This is a minor version and not a patch: the server goes from eighteen tools
to twenty-one, `docs/foundry.json` gains keys (`flight`, `mutation.targeted`,
`policies.archive`, `policies.finalize`, `policies.mergeMethod`, and `from` on
constraints and commands), a flight now has an end-of-flight lifecycle
(archive, finalize, awaiting signing), and the default model for three roles
changes.

### Added

- **`foundry_plan_commit`** validates `PLAN.md`, `PROGRESS.md`, `foundry.json`
  and `CLAUDE.md` together, lists every problem at once (also as
  `structuredContent.problems`), and commits the plan; `renumber: true`
  rewrites a split task's temporary id (`P1-02a`) everywhere. The planner no
  longer runs `git commit` (project-d F-03, project-c F-07).
- **`foundry_flight_archive`** moves a summarized flight into
  `docs/flights/<slug>/`, keeps the live `SPEC.md`, and writes a fresh state,
  so the repository can run its next flight; `foundry_next` stays `done` until
  the spec is edited. `flight` names the flight and `policies.archive`
  (a ⚠️ ASSUMPTION, default `false`) makes the summarizer call it
  (project-c F-20, cleanflate F-12 and F-27).
- **`foundry_pr_finalize`** ends a flight. It checks that every commit is
  signed, from the commits and not from state (`%G?`: `N` and `B` are
  unsigned, `E` is signed). A signed flight's draft PR is marked ready and, unless
  `breaking`, set to auto-merge; an unsigned one stays a draft, records
  `awaitingSigning`, and `foundry_next` reports `done` until a human unlocks
  the signing agent and says so (`resign: true`, human-initiated only).
  `policies.finalize` and `policies.mergeMethod` shape it (operator request;
  project-d F-03).
- **`foundry_summary_commit` takes `content`** and writes `docs/SUMMARY.md`
  itself, and reports `archive` (project-c F-03, F-05, F-06, F-10, F-11,
  F-14, F-15, F-19, F-23; project-d F-02, F-06).
- **`from` on a constraint or a `verify`/`extraVerify` command** keeps it
  inactive until a named task starts, and it still self-tests its fixtures
  (project-d F-01, project-c F-21).
- **`mutation.targeted`** names filterable test commands; `foundry_mutate`
  takes `targeted` and `filter` and runs one instead of the whole suite
  (project-c F-12, F-17, F-22).
- **`foundry_mutate` names `failedCommands` and takes `confirmKill`**, which
  re-runs a kill on the unmutated tree and reports a test that fails anyway as
  `inconclusive` (project-c F-02).
- **`foundry_status` reports `artifacts`, `strayArtifacts` and
  `lastReviewCommit`** (project-c F-04, F-16).
- **`foundry_flight_options({ ..., resume: true })`** lifts a round-cap halt
  in one call; the halt message names it, with a correct ordinal
  (project-c F-13, F-18).

### Changed

- **Every commit the server makes goes through one helper** that cannot hang on
  a pinentry: no terminal prompt, a 30-second bound, and under
  `policies.signing: "auto"` one retry unsigned, recorded in `state.signing`
  and `state.signingOverride` (project-d F-03, F-05).
- **A tool whose commit fails leaves the tree as it found it.**
  `foundry_review_submit` in particular is now all-or-nothing and safe to call
  again (project-d F-04).
- **The reviewer prefers targeted mutants, confirms suspicious kills, and
  scopes rounds after the first** to the diff since the last review, with
  survivors outside it as advisory notes (project-c F-16).
- **The summarizer lifts `## Codebase notes`** into the summary, and the
  implementer keeps project lessons out of the feedback log (project-c
  F-08, F-09).
- **The planner edits one `## Flight <slug> notes` section** of an existing
  `CLAUDE.md` instead of re-capping the file, and quotes `foundry.json` with
  constraints listed by id (project-c F-01, F-20).
- **The plugin's own checks skip flight artifacts**, so this repository's
  `docs/SPEC.md` and `docs/PLAN.md` no longer fail `npm test` or
  `pre-commit run --all-files`.
- Documentation: the tool reference, README, operations (new "Running flight
  after flight" and "Signing" sections), architecture, writing-specs
  (rules that become true at a task, targeted test commands, provenance
  logging with a `commit-msg` hook; cleanflate F-01) and the templates.

### Fixed

- A planner commit, or any server commit, whose signing agent wants a pinentry
  no longer hangs the flight (project-d F-03).
- `foundry_review_submit` no longer leaves PLAN, PROGRESS and state half
  applied when its commit fails (project-d F-04).

### Breaking changes

- **The default planner, reviewer and summarizer are `opus`** (the implementer
  stays `sonnet`), where 0.4.0 used `fable`. `fable` is still a legal alias in
  any routing config. Operator request.
- **The summarizer no longer writes `docs/SUMMARY.md` itself.** It passes the
  text as `content` to `foundry_summary_commit`, and the skill forbids a
  `Write` or heredoc. A custom summarize prompt that wrote the file still works
  with a file on disk, but the shipped skill does not.
- **`policies.finalize` defaults to `"auto"`: a signed, non-breaking flight's
  pull request is now marked ready and set to auto-merge once CI is green.**
  Foundry still never merges synchronously (`gh pr merge` only ever runs with
  `--auto`). Set `policies.finalize` to `"ready"` or `"draft"`, or
  `policies.pr` to `"none"`, to keep the 0.4.0 behavior. Operator request.

## [0.4.0] — 2026-09-30

Parallel workstreams, the fixes from the first real flights on 0.3.2, and a
new license.

The 0.3.2 flights were three cleanflate flights: a build, then two
performance phases. Their thirty friction items are in
`docs/feedback/2026-09-30-cleanflate.md`
and triaged in [`docs/plans/v0.4.md`](./docs/plans/v0.4.md#addendum-the-cleanflate-flights-032-feedback).
They are listed under "From the cleanflate flights" below. **Breaking
changes** are listed last, after the license.

Parallel workstreams change how a flight flows, which is why this is a
minor version and not a patch: `go-flight` now spawns more than one stage
agent at once, `PLAN.md` gains a field, and `foundry_next` gains a shape.
The motivating flight ran 26 tasks on one implementer for about 68 minutes
though many had disjoint file sets (F-05 of
`docs/feedback/2026-09-23-project-b.md`).
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
- **`foundry_stream_finish`**: merges a finished
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

### From the cleanflate flights

Added:

- **`foundry_task_reopen`** reopens a blocked or skipped task once its
  blocker is fixed, together with every task skipped because of it
  (transitively), and commits `PROGRESS.md` (F-03, F-18). Before this, one
  blocked download left 17 tasks skipped with no sanctioned way back.
- **`foundry_flight_options`** and go-flight arguments:
  `/foundry:go-flight max review rounds 6` sets `maxRounds` and
  `maxRoundsHard` in `docs/foundry.json` and commits them, so the
  controller never hand-edits the config (F-20). There are eighteen tools
  now.
- **`foundry_mutate` takes `timeoutMs`**, which caps every command's timeout
  for one call and never raises a configured one (F-06).
- **`foundry_summary_commit` reports the branch's PR** as `pr: { url,
  state, draft, base }`, with `expectedBase` when the PR targets the wrong
  branch. Otherwise `pr` is `"none"`, `"skipped: policy"` or
  `"unknown: <why>"` (F-25).
- **`foundry_run_finish` reports a whole-tree constraint scan** as
  `constraints: { ok, failing }` and in its ready line, without refusing the
  handoff (F-26).

Fixed:

- **A runaway command can no longer hang or crash the MCP server** (F-04,
  F-09, F-11, F-15, F-16). Every `verify`, `foundry_mutate` and
  `parallel.setup` command now runs under `mcp/run-command.mjs`, in its own
  process group:
  - a timeout kills the whole tree, so a test binary spinning under `make
    test` no longer survives as an orphan;
  - more than 64 MiB of output kills the command;
  - a leftover child still holding the pipes after the shell exits is
    killed after two seconds;
  - each tail is capped at 60 lines and 4000 characters.

  Results gain `outputLimitExceeded`, `orphansKilled` and `truncated`.
- **`foundry_mutate` cleans up after its commands** (F-10, F-14, F-17).
  Tracked files that were clean before the call are restored, new untracked
  files (proptest regression seeds, say) are removed, and both are reported
  as `restored` and `removed`.
- **A reviewer's `unblock` reopens the skipped dependents too**, reported as
  `reopenedDependents` (F-05).
- **Draft PRs target `baseBranch`.** `gh pr create` now always gets
  `--base`; before, a flight on `feature/perf` opened its PR against `main`
  (F-24).
- **Round numbering is consistent** (F-21): an approval returns the round
  `REVIEW.md` was stamped with, `done` counts reviews and fix rounds
  separately, and `foundry_status.reviewVerdictInFile` reads `**Verdict:**
  X`, a verdict under its own heading, and list items.
- **The constraint scan covers new, uncommitted files**, so a regression
  cannot slip past a verify run made before its commit (F-26). It still
  skips ignored files and files untracked before the run started.
- **No more "agent type not found" on a first flight** (F-22). Under
  fallback, `foundry_next` names the plugin agent outright.

Changed (skills):

- plan-build keeps `Depends on` narrow (F-19). It puts shared per-task
  protocols in `CLAUDE.md` under `## Task protocols`, where the implementer
  reads them (F-08), and routes long verification steps through
  `foundry_verify` with their own `timeoutMs` (F-28).
- The implementer commits with `git commit -F <file>`, so a project hook
  that scans whole Bash commands does not deny a message that merely
  mentions a forbidden word (F-07, F-29).
- The reviewer is told about `timeoutMs`, mutate's residue cleanup and the
  unblock cascade. The summarizer reports the PR.

Deferred, with a scoped plan in the triage: a flight identifier and an
archive command for multi-phase projects (F-12, F-27), background jobs for
very long verify steps (F-13, F-28), and spec guidance for provenance
logging (F-01).

### License

- Relicensed from MIT to Apache License 2.0. Releases 0.3.x and earlier
  remain available under MIT. A `NOTICE` file is added, and
  `package.json`, `.claude-plugin/plugin.json` and the marketplace entry
  carry `"license": "Apache-2.0"`. Contributions are accepted under Apache
  2.0 (inbound = outbound; see `CONTRIBUTING.md`).

### Breaking changes

These matter to anything that reads tool results or relies on the old
behavior. The skills shipped with this release are already updated.

- **`foundry_summary_commit` no longer returns `rounds`.** It was the
  fix-round count, which read as a review count. Use `reviews` and
  `fixRounds` instead.
- **`foundry_review_submit` with `APPROVED` returns `round: N`**, the number
  `REVIEW.md` is stamped with. It used to return the fix-round count, one
  less. The count is now `fixRounds`.
- **`foundry_next`'s `done` reason now reads "after K reviews (F fix
  rounds)"** instead of "after N review round(s)".
- **Under agent fallback, `foundry_next`'s `agent` is the plugin agent**
  (`foundry:<role>`) rather than the generated `foundry-<role>`, including
  on the first flight in a project. A controller that relied on trying the
  generated name first and retrying on "not found" still works, but no
  longer needs to.
- **An unblock reopens skipped dependents.** `foundry_review_submit`'s
  `counts` and the next fix round include them. Convergence still counts
  only explicit fix tasks and unblocks.
- **The constraint scan now covers untracked files that are not ignored.**
  A verify run can fail on a file that is not committed yet, which is the
  point. Files untracked before the run started are still exempt.
- **Commands are supervised.** A verify, mutate or setup command that
  leaves a background child holding its output open has that child killed
  two seconds after the shell exits. Previously the call would have hung.
  A command that writes more than 64 MiB in total is killed and fails, and
  output tails are capped at 4000 characters as well as 60 lines.
- **The license changes from MIT to Apache 2.0** (see above).

## [0.3.2] — 2026-09-23

Fixes from the first real flight on 0.3.1
(`docs/feedback/2026-09-23-project-b.md`),
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
