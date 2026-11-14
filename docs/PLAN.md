# Kūkulu 0.9.0 build plan

Derived from docs/SPEC.md v0.9.0 on 2026-11-13. SPEC.md wins over this file.

## Decisions

- Phases → SPEC §8's four phases, in order, none merged: usage records (B-01 to B-04 and the `.kukulu/metrics/` exclusion), probe and activation (A-01 to A-04), metrics and comparison (C-01 to C-04, D-01, with B-05), local runners, documentation and release (E, F). One thing crosses a phase line because A-03's own test needs it: the counters file's reader and writer are introduced in P1-04 with `activateFailures`, and Phase 2 adds the other counters (C-02).
- The base is green → `main` at `c48c034` passes `npm run lint`, both guard self-tests (693 and 689 cases) and `npm test` (4,875 assertions in fifteen suites), measured while planning. All 39 constraints of this flight's `docs/kukulu.json` self-test and scan clean on the base. No base-fix task is needed.
- Parallel streams → none; the plan is fully serial, as SPEC's size recommendation says. Nearly every task edits `mcp/server.mjs`, `scripts/cleanroom-log.mjs`, `test/metrics.mjs`, `docs/metrics.md` or `CHANGELOG.md`.
- Flight slug → `v0-9-0`, the operator's slug, which SPEC's size recommendation also names. `docs/flights/v0-9-0/` does not exist.
- `baseBranch` → `main`, the branch the plan is committed on; build branches are `build/<date>`.
- `maxRounds` 4 and `maxRoundsHard` 10 → SPEC §7. No `policies` block: the running 0.8.1 already defaults `archive` to `true` and `finalize` to `"ready"`, and it would refuse `policies.metrics` as an unknown key.
- Constraints → the 33 rules of `docs/flights/v0-8-1/kukulu.json`, byte for byte (principle 15; none carries a `from`), plus SPEC §5.5's three (`metrics-module-pure`, `server-no-network`, `no-hardcoded-activate-timeout`) and three plan-level rules that turn §3 principle 2 and §4's import boundaries into data, as the plan-build rules require of every line-expressible constraint: `probe-node-only`, `compare-flights-imports`, `metrics-harness-neutral`. No rule has a `from`: a rule over a file that does not exist yet scans nothing. The file is ASCII-only.
- `no-hardcoded-activate-timeout` → SPEC says the default sits "on the line where `loadGlobalConfig` applies a runner's defaults", but `loadGlobalConfig` neither validates nor defaults runners today: `validateRunners` validates and `runnerFor` resolves. The one permitted line is `activateTimeoutMs: r.activateTimeoutMs ?? 1800000,` in `runnerFor`'s result for a configured runner (P1-02). The rule also scans `scripts/`, `skills/`, `agents/` and `hooks/`; tests and docs may state the default.
- `extraVerify` and `mutation.targeted` → SPEC §7: as in `docs/flights/v0-8-1/kukulu.json`; `suite` = `node test/{filter}.mjs`.
- §9 Q1 (what 0.9.0 is) → runner comparison metrics; OpenCode is 0.10.0. Owner decision of 2026-11-12. Strategy goals G-11 to G-14 stay unassigned.
- §9 Q2 (activation by request) → `activate: "warm"` sends one request and waits (P1-03); no configured command.
- §9 Q3 (the served id) → the longest matching `match` prefix is stripped, `servedAs` overrides (P1-02).
- §9 Q4 (where metrics are written) → by the server, at `kukulu_next`'s `done` and `halt` and at `kukulu_pr_finalize` (P2-08, P2-09).
- §9 Q5 (usage in every mode) → general mode writes `.kukulu/metrics/usage.jsonl`, by `scripts/cleanroom-log.mjs` itself (principle 13 and Q10; Q5's "a second hook script" is the draft's wording, see Spec issues).
- §9 Q6 (the summarizer's record after an archive) → missing in the committed file, never zero (P2-05, P2-09); `docs/metrics.md` lists it.
- §9 Q7 (cost for local runners) → `null`. §9 Q8 (engine metrics) → not scraped. §9 Q9 (one source per mode) → the chain in clean-room mode (P2-07). §9 Q10 (no new hook script) → none is added. §9 Q11 (0.8.1 R6-03) → no code or fixture changes. §9 Q12 (the Claude Code version) → already in `docs/operations.md`; not a task.
- The `isApiErrorMessage` flag (B-01) → confirmed while planning against 368 local Claude Code transcripts (versions 2.1.304 to 2.1.325): three rows carry `isApiErrorMessage: true`, each an `assistant` row with `message.model` `"<synthetic>"` and a `message.usage`. `apiErrors` counts rows with that flag and is never `null` for this adapter. By "counting rules are unchanged", such a row is still counted as a request under its own model name (see Spec issues).
- Sidechain rows (B-01) → in those transcripts every row of a subagent's own transcript has `isSidechain: true` and no row of a main transcript does. Skipping them unconditionally would empty every subagent record, so the adapter skips `isSidechain: true` rows only for the controller record (`Stop`, reading `transcript_path`), which is what SPEC gives as the reason for the skip (P0-02, P0-04).
- `activeMs` (B-01) → "row" means a conversation row: a transcript line whose `type` is `user` or `assistant` and that has a string `timestamp`. Real transcripts interleave bookkeeping rows (`attachment`, `api-request`) and an `attachment` row with the response's own timestamp sits directly before two of the first five requests sampled, which would make the literal rule read 0 ms. A request with no conversation row before it adds nothing; `activeMs` is `null` only when no counted request could be timed.
- `stage` and `round` in a usage record → from `.kukulu/state.json` alone: `round` is `state.round`, `stage` is the stage of the open timeline span (the last `start` or `end` record when it is a `start`), each `null` when the file or the span is missing.
- Which stops write a record → `SubagentStop` of an agent whose type matches `^kukulu[-:](planner|implementer|reviewer|summarizer)$`, and `Stop` (role `controller`). Another agent type writes nothing in general mode; in clean-room mode it still gets its chain entry, as today, with `role: null` in `data`.
- Repeated stops → an agent that is pushed back by the implement guard stops again, and each record is computed from its whole transcript. In general mode a later record supersedes an earlier one with the same `session`, `agent` and `first`; the controller keeps the last record per `session` (B-03) in both modes. In clean-room mode the four role agents' entries are all summed, exactly as `rolesUsage` does, because B-05 requires the metrics to equal check 12's recount (see Spec issues).
- Gate check 3 → its registration list gains the logger on `Stop`, as it already has the logger on `SubagentStop`, so a `hooks.json` that drops the controller's usage entry fails the gate (P0-04). SPEC names only the hash pins.
- Appendix C's unread code → read while planning. `verify` and `taskReopen` take the counters at their call sites (P2-01); `summaryCommit` does not change; `runStart` has no exclude handling today, and `agentsSync`'s `ensureLineInFile(gitPath("info/exclude"), …)` is the model (P0-03); an archive writes a fresh state holding only `archived`, so the metrics read the archived `state.json`, `kukulu.json` and `feedback.jsonl` until the next flight's first timeline record (P2-06); the guard's lock is JSON with a legacy bare-number form (P2-02); the verifier checks an entry's top-level keys and a checkpoint's `data` only, so added keys in a `stage` or `usage` entry's `data` are accepted, and the log socket merges `source: "box"` into any `data` (P0-05, P1-05).
- A flight's own metrics directory → `kukulu_next` removes the files directly under `.kukulu/metrics/` when it writes a flight's first timeline record, so one flight's usage and counters never mix with the last one's; SPEC is silent (P0-03).
- The exclusion → `.kukulu/metrics/` is added to `.git/info/exclude` by `kukulu_run_start` (§5.4) and also by `kukulu_next`, because the planner's own record is written before the first run starts (P0-03).
- Activation's timeline order → `end` of the previous span (stamped before the probe ran), then the `activate` record, then the new `start` (stamped after), so a model load is in no stage's span. A call for the same stage and round writes the `activate` record alone. The open span is found by ignoring `activate` records (P1-03).
- Activation is skipped when `restartRequired` is true → the stage will not start in this session, so a model load would be wasted (P1-03).
- The follow-up `--models` probe (A-03 step 3) → bounded by the smaller of `activateTimeoutMs` and a fixed `RUNNER_LIST_TIMEOUT_MS = 10000` in `mcp/server.mjs`: the list only decorates the halt reason, and a runner that hangs must not cost a second full wait (P1-04).
- A warm runner without an endpoint → refused when the config loads, with a text SPEC does not list (P1-02).
- The probe's own default timeout → none: without `--timeout-ms` no timer is set. The server always passes it (P1-01).
- `kukulu_metrics` → added last in `TOOLS`, after `kukulu_config_show`; no agent's `tools:` line and no skill's `allowed-tools` gets it. It is an operator tool, like `kukulu_config_show` (P2-06).
- The controller's `cost` → `null`: routing knows no runner for the controller, and C-01 nulls `cost` unless the role's runner is `anthropic` (P2-05, see Spec issues).
- `verifyFailures` → a `kukulu_verify` call in which at least one command result failed; a call that fails only a constraint counts as a run, not a failure (C-02's "reports a failing command").
- Principle 6's feedback entry → the note is always in the tool's result; the feedback entry is appended only where the call is already making a commit that carries `.kukulu/feedback.jsonl` (`kukulu_next`'s timeline commit and `kukulu_run_halt`), once per distinct message. `kukulu_verify` commits nothing and `kukulu_task_done` needs HEAD to be the task's commit, so every other call returns the note only.
- `wall.endedAt` → the last timeline record's `at`, or the time the metrics are built while a span is still open (the summarize span is open at `kukulu_pr_finalize`).
- Tuning → `activateTimeoutMs` gets P1-07, which measures what this environment can (the probe's fixed cost, the refused-connection latency, the timeout's accuracy) and leaves the default to the owner; `MODEL_FAMILIES` gets its before-and-after inside P3-01.
- Changelog → P0-01 creates `## [Unreleased]` above `## [0.8.1] — 2026-11-13`; every task adds its lines under `### Added` or `### Changed`, each citing its requirement (`B-02`); no Breaking changes heading. P3-05 renames the heading.
- HANDOFF.md → no "do not merge" line; it lists the manual checks of all four phases.

## Conventions

- Commit template: `CLAUDE.md` `## Commit template`, title `<ID>: <title>`, written to a file and committed with `git commit -F <file>`. `Measurement: n/a` except on P1-07 and P3-01.
- Every task's verification is `kukulu_verify` with its Files touched: `npm run lint`, `pre-commit run --all-files` and `npm test` (900 s) always; both guard self-tests when a task touches `mcp/cleanroom.mjs`, `scripts/cleanroom-guard.mjs` or the guard fixtures; `npm run check:site` never fires.
- Shared protocols are in `CLAUDE.md` `## Task protocols`: the metrics-test protocol (hooks, the fake runner, the fake probe), the notes protocol (principle 6), adding a tool (P2-06), adding a test suite (P0-01), adding a `docs/kukulu.json` key (P2-08), tuning an assumption (P1-07, P3-01), the changelog protocol (every task).
- Tests are named by their assertion message; the names below are the messages to use. Write the macron letter in test and script source as a Unicode escape.
- "The running server" is the installed 0.8.1: none of this flight's behavior is active while it runs, so no task may rely on an earlier task's server change being live in the pipeline.
- Documentation may name `kukulu_metrics` only from P2-06 on (`test/plugin.mjs` fails on a tool the server does not define). The 24-hour MCP limit is never written in milliseconds outside `.mcp.json`.

## Phase 0 — Usage records

### P0-01: The usage record's contract, mcp/metrics.mjs and the metrics suite

**Goal:** `mcp/metrics.mjs` exists as a pure module holding the usage record's contract, and `test/metrics.mjs` is a registered suite.

**Files touched:** `mcp/metrics.mjs`, `test/metrics.mjs`, `test/run.mjs`, `test/plugin.mjs`, `CONTRIBUTING.md`, `README.md`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 B-01, §3 principles 2, 3, 7, 10, 14; constraints `metrics-module-pure` and `metrics-harness-neutral`: the module imports nothing outside `node:` (it needs no import at all), has no `process.exit`, no console call, no child process, and never names a harness or a transcript field (`claude-code`, `isSidechain`, `requestId`, `costUSD`, `transcript_path`), not even in a comment or an example.
- Exports: `METRICS_VERSION = 1`; `USAGE_ROLES = ["planner", "implementer", "reviewer", "summarizer", "controller"]`; `USAGE_KEYS`, the fifteen keys in this order: `v`, `harness`, `session`, `agent`, `role`, `stage`, `round`, `models`, `first`, `last`, `activeMs`, `toolCalls`, `toolErrors`, `apiErrors`, `cost`; `validateUsageRecord(record)`, which returns `[]` for a valid record and otherwise a list of strings `<field>: <what is wrong>`, one per problem, never throwing.
- A full record is valid when: it is a plain object whose keys are exactly `USAGE_KEYS` (any order; an unknown or missing key is a problem naming it); `v` is 1; `harness` is a non-empty string; `session` and `agent` are each a non-empty string or `null`; `role` is one of `USAGE_ROLES`; `stage` is a non-empty string or `null`; `round` is an integer of at least 0 or `null`; `models` is a plain object whose every value has exactly `requests`, `input`, `output`, `cacheRead`, `cacheWrite`, each an integer of at least 0; `first` and `last` are each a string `Date.parse` accepts or `null`; `activeMs`, `toolCalls`, `toolErrors`, `apiErrors` are each an integer of at least 0 or `null`; `cost` is a number of at least 0 or `null`.
- An error record is valid when its keys are exactly `v`, `harness`, `session`, `agent`, `role`, `error`, with the same rules for the first five and `error` a non-empty string.
- Follow "Adding a test suite" in CLAUDE.md: `["metrics", "usage records, counters, METRICS.json and scripts/compare-flights.mjs"]` goes after `bundles` and before `drive` in `test/run.mjs`; CONTRIBUTING's table gets a `metrics` row after the `bundles` row, covering: the usage record and its validator, the logger's usage adapter and general-mode writer, the counters, `mcp/metrics.mjs`, and `scripts/compare-flights.mjs` once they exist; the four counts and `test/plugin.mjs`'s assertion become sixteen ("README counts sixteen suites").
- `docs/metrics.md` is new: a title, one paragraph on what the page covers, and `## The usage record` with SPEC B-01's JSON example and a table of the fifteen fields (type, meaning, `null` when). It says the record has one schema and one adapter per harness, and that Claude Code's adapter is the only one shipped. It does not name `kukulu_metrics`. Add it to README's Documentation map (`test/plugin.mjs` requires every `docs/*.md` to be linked from the README) and `mcp/metrics.mjs` to README's repo layout.
- `CHANGELOG.md`: create `## [Unreleased]` above `## [0.8.1] — 2026-11-13` with `### Added`: the usage record, one schema for every harness, validated by `validateUsageRecord` in `mcp/metrics.mjs` (B-01).

**Acceptance tests:** `test/metrics.mjs`: "METRICS_VERSION is 1 and USAGE_KEYS lists the fifteen fields in order"; "SPEC B-01's example record is valid"; "a record with every nullable field null is valid"; "an error record is valid"; a table of bad shapes, each asserting the problem's field: "v 2", "an empty harness", "role null", "role 'operator'", "round -1", "a models entry missing cacheWrite", "a negative input", "activeMs 1.5", "cost -1", "first 'yesterday at noon'", "an unknown key", "a missing key", "an error record with an extra key", "an array", "null" ("validateUsageRecord names the field: <case>"); "validateUsageRecord never throws". `test/plugin.mjs`: "README counts sixteen suites". `npm test -- metrics` runs the suite alone.

**Out of scope:** `buildMetrics` and `compareMetrics` (P2-04, P2-05, P2-10); any hook or server change; naming `kukulu_metrics` anywhere.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`.

**Depends on:** none

### P0-02: usageFromClaudeCode replaces usageOf, and the chain's usage entry carries the record

**Goal:** The logger computes the full usage record from a subagent's transcript, and in clean-room mode the chain's `usage` entry carries it as `data`.

**Files touched:** `scripts/cleanroom-log.mjs`, `test/metrics.mjs`, `test/cleanroom.mjs`, `test/fixtures/transcripts/agent-full.jsonl`, `test/fixtures/transcripts/README.md`, `docs/cleanroom.md`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-01, B-04, §3 principles 2, 13; Decisions (sidechain rows, `activeMs`, `stage` and `round`, the `isApiErrorMessage` flag). Constraints on the script: `hooks-lazy-cleanroom` (no static import of `mcp/cleanroom.mjs`), `no-hardcoded-target-max` and `no-hardcoded-log-socket-timeout` (the literals 4000 and 2000 may not appear in it), `scripts-node-builtins`.
- `function usageFromClaudeCode(hookInput)` replaces `usageOf` in `scripts/cleanroom-log.mjs`; it is the only place that knows the transcript format, and it lives in the script itself (not in `mcp/cleanroom.mjs`), so the general-mode path of P0-03 needs no import. It reads the module's own `root` for the project position.
- It returns, keys in `USAGE_KEYS` order: `v: 1`; `harness: "claude-code"`; `session` (`session_id`, else `null`); `agent` (`agent_type`, else `null`); `role` (the role name when `agent_type` matches `^kukulu[-:](planner|implementer|reviewer|summarizer)$`, else `null`); `stage` and `round` from `<root>/.kukulu/state.json` (`round` is its integer `round`, else `null`; `stage` is the `stage` of the last record in `timeline` whose `event` is `start` or `end`, when that record is a `start`, else `null`; an unreadable file gives both `null`); then the counted fields.
- The transcript is `agent_transcript_path`, else `transcript_path`. Rows are its lines that parse as JSON objects; nothing is skipped for a subagent (P0-04 adds the controller's sidechain skip).
- Counting is unchanged: a row counts when `type` is `assistant` and `message.usage` is an object; a row whose string `requestId` was already counted is not counted again; the counted row's `message.model` (else `unknown`) names the `models` entry; `requests` +1 and `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` add to `input`, `output`, `cacheRead`, `cacheWrite` (a non-number adds 0). `first` and `last` are the earliest and latest `timestamp` of the counted rows. `cost` is the sum of the counted rows' `costUSD` rounded to six decimals when every counted row has a numeric one, else `null`.
- `activeMs`: conversation rows are the rows whose `type` is `user` or `assistant` and whose `timestamp` is a string, in file order. For each counted request, take its first row (the counted one) and its last row (the last conversation row with the same `requestId`; the row itself when it has no `requestId`); add `max(0, timestamp(last) − timestamp(the conversation row just before the first))`. A request with no conversation row before it adds nothing. `activeMs` is the integer sum, or `null` when no request was timed.
- `toolCalls`: the `tool_use` items in every row's `message.content` array. `toolErrors`: the `tool_result` items with `is_error === true`. `apiErrors`: the rows with `isApiErrorMessage === true`.
- An unreadable transcript, or one with nothing to count (`the transcript has no assistant line with usage`, as today), returns exactly `{ v, harness, session, agent, role, error }`, `error` being the first line of the message.
- Clean-room mode: the `SubagentStop` branch writes `data: usageFromClaudeCode(input)`; everything else about the entry is as today (every subagent gets one; `rolesUsage` and the verifier read `data.models` and `data.cost` as before).
- `test/fixtures/transcripts/agent-full.jsonl`: ten lines, timestamps `2026-11-14T10:00:SS.000Z` with SS as given, no content text beyond what is listed. (1) `user`, :00, content `[{"type":"text","text":"go"}]`. (2) `assistant`, :04, `requestId` `req_a`, model `m-one`, usage input 100, output 10, cache_read 1000, cache_creation 50, content one `tool_use`, `costUSD` 0.01. (3) `assistant`, :05, `req_a`, model `m-one`, the same usage with output 20, content one `tool_use`, `costUSD` 0.02. (4) `user`, :07, content two `tool_result` items, the second with `"is_error": true`. (5) `{"type":"attachment","timestamp":"…:10.000Z"}`. (6) `assistant`, :10, `req_b`, model `m-one`, usage input 200, output 30, content one `text`, `costUSD` 0.03. (7) `assistant`, :11, `"isSidechain": true`, `req_s`, model `m-side`, usage input 999, output 999, content one `tool_use`, `costUSD` 1. (8) `user`, :12, `"isSidechain": true`, content one `tool_result` with `"is_error": true`. (9) `assistant`, :13, `"isApiErrorMessage": true`, no `requestId`, model `<synthetic>`, usage input 0, output 0, content one `text`, no `costUSD`. (10) `assistant`, :20, `req_c`, model `m-two`, usage input 10, output 5, cache_read 5, content one `tool_use`, `costUSD` 0.001.
- That fixture read as a subagent's transcript gives: `models` `{ "m-one": { requests 2, input 300, output 40, cacheRead 1000, cacheWrite 50 }, "m-side": { 1, 999, 999, 0, 0 }, "<synthetic>": { 1, 0, 0, 0, 0 }, "m-two": { 1, 10, 5, 5, 0 } }`; `first` `2026-11-14T10:00:04.000Z`; `last` `2026-11-14T10:00:20.000Z`; `activeMs` 17000 (5000 + 3000 + 1000 + 1000 + 7000; the attachment row is ignored); `toolCalls` 4; `toolErrors` 2; `apiErrors` 1; `cost` `null` (line 9 has no `costUSD`).
- `docs/cleanroom.md`'s paragraph on the `usage` entry says `data` is the usage record of `docs/metrics.md` (naming the added fields), or the error form. `docs/metrics.md` gains `## How Claude Code's adapter counts`: the counting rule, what `activeMs` includes (prefill, decode, the network) and excludes (tool execution), the conversation-row rule, and that an API-error row is counted in `apiErrors` and, when it carries usage, as a request under its own model name. `test/fixtures/transcripts/README.md` describes the new file.
- `CHANGELOG.md`, `### Changed`: the clean-room chain's `usage` entry carries the full usage record (B-01, B-04).

**Acceptance tests:** `test/metrics.mjs`, running the hook with `runHook` in a `cleanroomRepo()` whose state has `cleanroom.genesis` and a `timeline` ending in `{ event: "start", stage: "implement", round: 0 }`, payload `{ hook_event_name: "SubagentStop", agent_type: "kukulu-implementer", agent_transcript_path, session_id: "s-1", cwd }`: "the fixture transcript gives the exact usage record" (the whole `data` object compared as JSON, including `stage: "implement"`, `round: 0`, `role: "implementer"`); "the record passes validateUsageRecord"; "a repeated requestId is counted once, by its first row"; "an attachment row before a request does not zero its active time"; "a missing costUSD makes cost null" and, with `subagent.jsonl`, "every counted row with a costUSD gives the sum" (0.043); "kukulu:reviewer maps to role reviewer"; "another agent type gets role null"; "an unreadable transcript gives the six-key error record"; "a transcript with nothing to count gives the error record"; "no state file gives stage null and round null"; "a closed span gives stage null". `test/cleanroom.mjs`: the existing "token use per subagent" assertions keep passing unchanged (models, first, last, cost, role, the two error cases, the chain verifying, both 50 ms budgets).

**Out of scope:** general mode and `usage.jsonl` (P0-03); `Stop` and the controller (P0-04); `rolesUsage` in either copy; `mcp/cleanroom.mjs`.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`; `node test/cleanroom.mjs`.

**Depends on:** P0-01

### P0-03: General-mode usage in .kukulu/metrics/usage.jsonl, excluded per clone

**Goal:** Without a clean-room policy the logger appends each role agent's usage record to `.kukulu/metrics/usage.jsonl`, and that directory never shows in `git status` or outlives its flight.

**Files touched:** `scripts/cleanroom-log.mjs`, `mcp/server.mjs`, `test/metrics.mjs`, `test/implement.mjs`, `test/state.mjs`, `docs/metrics.md`, `docs/mcp-tools.md`, `docs/architecture.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-02, B-05, §5.4, §3 principles 6, 8, 13, 17; Decisions (which stops write a record, the exclusion, a flight's own metrics directory). `server-synchronous`, `hooks-lazy-cleanroom`.
- `scripts/cleanroom-log.mjs`: where it now exits because there is no policy file, it first handles general mode. In this order: the event is not `SubagentStop` → exit 0 (the `PostToolUse` fast path does no more work than today); `docs/kukulu.json` does not exist → exit 0; `KUKULU_LOG_SOCKET` is set → exit 0; the record's `role` is `null` → exit 0; else create `<root>/.kukulu/metrics/` and append `JSON.stringify(usageFromClaudeCode(input))` and a newline to `usage.jsonl` (an error record is appended like any other). The whole branch is inside a `try`; every path ends in exit 0 with nothing on stdout or stderr. It reads no other config and imports nothing but `node:` modules.
- With a policy file the script behaves as after P0-02 and never writes `usage.jsonl`.
- `mcp/server.mjs`: add `metricsDir` (`.kukulu/metrics`), `usage` (`usage.jsonl` in it) and `counters` (`counters.json` in it) to `layoutFor`. `ensureMetricsExcluded()` adds the line `.kukulu/metrics/` to `.git/info/exclude` through `ensureLineInFile(gitPath("info/exclude"), …)` when inside a git repository, as `kukulu_agents_sync` does for the agent files. `startRun` calls it before it snapshots `untrackedPaths()` (on the already-started path too); `next()` calls it before deciding, inside a `try` whose failure is ignored.
- `recordTimeline`: when it is about to write records and the state's timeline is absent or empty (the flight's first record), it first removes every regular file directly under `.kukulu/metrics/`; a failure to remove is ignored. A later call removes nothing.
- 0.8.1 C-01 stands: `kukulu_next` after an archive still moves no HEAD and leaves `.kukulu/state.json` byte-identical (the exclude file is not tracked).
- `docs/metrics.md` gains `## Where usage is recorded`: general mode, the file, one line per stop, excluded per clone and never committed, emptied when the next flight's first stage starts, silent without `docs/kukulu.json` and inside the sandbox; clean-room mode writes the chain only. `docs/mcp-tools.md`: `kukulu_run_start` and `kukulu_next` say they exclude `.kukulu/metrics/`, and `kukulu_next` that it empties the directory at a flight's first timeline record. `docs/architecture.md`'s "State on disk" lists the directory.
- `CHANGELOG.md`, `### Added`: every flight records token use per role, in general mode to `.kukulu/metrics/usage.jsonl` (B-02, §5.4).

**Acceptance tests:** `test/metrics.mjs`, the hook run with `runHook` in a `plannedRepo()` (set `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` and `HOME`): "general mode appends one usage record on SubagentStop" (one line, valid by `validateUsageRecord`, equal to P0-02's expected record); "a second stop appends a second line"; "no docs/kukulu.json: exit 0, no file, no output"; "KUKULU_LOG_SOCKET set: exit 0 and no file"; "another agent type writes nothing"; "PostToolUse writes nothing"; "an unreadable transcript appends the error record and exits 0"; "clean-room mode writes no usage.jsonl line" (and the chain has the entry). `test/implement.mjs`: "kukulu_run_start adds .kukulu/metrics/ to .git/info/exclude" (once: a second call adds no second line); "a usage.jsonl written before the run is not in preexistingUntracked". `test/state.mjs`: "kukulu_next excludes .kukulu/metrics/"; "the first timeline record of a flight empties .kukulu/metrics/"; "a later kukulu_next leaves .kukulu/metrics/ alone". `test/cleanroom.mjs`'s "general mode writes nothing on SubagentStop" (it checks the clean-room log) and its 50 ms fast-path budget keep passing unchanged.

**Out of scope:** `Stop` and the controller's record (P0-04); reading `usage.jsonl` (P2-06); counters (P1-04, P2-01); `policies.metrics`.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`.

**Depends on:** P0-02

### P0-04: The logger on Stop, and the controller's usage record

**Goal:** The logger runs on `Stop` and records the controller session's usage, to `usage.jsonl` in general mode and as a chain `usage` entry in clean-room mode.

**Files touched:** `hooks/hooks.json`, `scripts/cleanroom-log.mjs`, `mcp/server.mjs`, `test/metrics.mjs`, `test/plugin.mjs`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `docs/metrics.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-03, §1 (hooks), §3 principle 13; Decisions (sidechain rows). No hook script is added; `scripts/implement-guard.mjs` does not change.
- `hooks/hooks.json`: `Stop` gets a second entry, after the implement guard's, with no matcher, running `"${CLAUDE_PLUGIN_ROOT}"/scripts/cleanroom-log.mjs`. Nothing else in the file changes.
- `usageFromClaudeCode`: when `hook_event_name` is `Stop`, `role` is `"controller"`, `agent` is `null`, the transcript is `transcript_path`, and every row with `isSidechain === true` is dropped before anything is counted, timed or tallied, so a controller record never holds a subagent's requests. `agent-full.jsonl` read that way gives `models` `{ "m-one": { 2, 300, 40, 1000, 50 }, "<synthetic>": { 1, 0, 0, 0, 0 }, "m-two": { 1, 10, 5, 5, 0 } }`, `first` :04, `last` :20, `activeMs` 18000 (5000 + 3000 + 3000 + 7000), `toolCalls` 3, `toolErrors` 1, `apiErrors` 1, `cost` `null`.
- General mode: `Stop` is handled like `SubagentStop` in P0-03's order (the event test accepts both). Each `Stop` appends the cumulative record; readers keep the last per session (P2-05).
- Clean-room mode: on `Stop`, when `loggingActive`, append `{ kind: "usage", ...entryFields(input, ctx), tool: null, decision: null, target: null, data: usageFromClaudeCode(input) }` through `record` (so it goes through the log socket inside the sandbox). The entry's `role` is `session`, so `rolesUsage` and the verifier's check 12 do not count it.
- `mcp/server.mjs`, gate check 3: the registration list gains `["Stop", "cleanroom-log.mjs"]`, refused as `hooks/hooks.json no longer registers cleanroom-log.mjs on Stop`.
- `docs/cleanroom.md`: the `usage` paragraph covers the controller's entry (cumulative, last per session, not counted by check 12) and check 3's list names `Stop`; the `kind` row's parenthesis no longer says only the subagent hook writes `usage`. `docs/mcp-tools.md`'s gate text names the `Stop` registration where it lists the others. `docs/metrics.md` gains the controller paragraph and `## Known limits` with: requests the controller makes after its last `Stop` are not counted; a controller record covers its whole session, including anything the session did before the flight; tokens of other subagents a stage spawns are not counted.
- `CHANGELOG.md`, `### Changed`: `hooks/hooks.json` registers the logger on `Stop`, so a clean-room flight started on 0.8.x cannot continue on 0.9.0 (gate check 3); `### Added`: the controller session's usage is recorded on every `Stop` (B-03).

**Acceptance tests:** `test/metrics.mjs`: "Stop appends a controller record in general mode" (exact JSON, `role: "controller"`, `agent: null`, valid); "a controller record skips sidechain rows"; "two Stops of one session append two cumulative records"; "Stop without docs/kukulu.json is silent"; "Stop in clean-room mode appends a usage entry with role session and data.role controller" (and writes no `usage.jsonl`); "rolesUsage does not count the controller's entry". `test/plugin.mjs`: "Stop has two entries", "hooks.json runs the clean-room logger on Stop after the implement guard", "...with no matcher"; the existing loop over `entries[0]` keeps passing. `test/cleanroom.mjs`: "the gate requires the logger on Stop" (a temp plugin copy with the `Stop` registration removed fails `guard` with the text above); "the Stop hook's general-mode path costs under 50 ms beyond Node's own startup" (beside the existing budget assertions, same method).

**Out of scope:** reading the records (P2-05, P2-07); the sandbox test (P0-05); any change to the implement guard.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`; `node test/plugin.mjs`; `node test/cleanroom.mjs`.

**Depends on:** P0-03

### P0-05: Usage entries under the sandbox and in the verifier

**Goal:** Tests prove that the full usage record crosses the log socket and that the verifier accepts it, with check 12 unchanged.

**Files touched:** `test/sandbox.mjs`, `test/attest.mjs`, `docs/sandbox.md`

**Design constraints:**

- SPEC §6 B-04, Appendix C. Checked while planning: `scripts/sandbox.mjs`'s `startLogSocket` merges `source: "box"` into whatever `data` it is sent, and `scripts/verify-attestation.mjs` checks an entry's keys only at the top level and a checkpoint's `data`; neither needs a change. If a test here shows otherwise, fix the cause in this task and say so in the commit body's `Interpretation:` line; `scripts/verify-attestation.mjs`'s checks, `CHECKPOINT_KEYS` and `rolesUsage` stay as they are.
- Follow "Sandbox sockets in tests" in CLAUDE.md: a short socket path under `os.tmpdir()`, `startLogSocket` in-process, closed in a `finally`.
- `docs/sandbox.md`: one sentence where the log socket is described: `usage` entries, the controller's included, cross it with the full usage record and `source: "box"`; nothing is written to `.kukulu/metrics/` inside the boundary.

**Acceptance tests:** `test/sandbox.mjs`: "a SubagentStop inside the boundary sends the usage record through the log socket" (the entry's `data` has the fifteen fields and `source: "box"`); "a Stop inside the boundary sends the controller's record"; "nothing is written under .kukulu/metrics/ when KUKULU_LOG_SOCKET is set". `test/attest.mjs`, with `buildBundle`'s `extra`: "a bundle whose usage entries carry the full record verifies"; "check 12's recount ignores the added fields" (the manifest's `roles.implementer.usage` equals the token sums); "a controller usage entry does not change any role's recount".

**Out of scope:** any behavior change; `scripts/compare-bundles.mjs`.

**Verification:** `kukulu_verify`; `node test/sandbox.mjs`; `node test/attest.mjs`.

**Depends on:** P0-04

### P0-06: Phase 0 end: push and record the manual check

**Goal:** Push the branch and record Phase 0's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 0. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P0-06: Phase 0 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): after one general-mode flight on the working tree's plugin, .kukulu/metrics/usage.jsonl holds one record per stage and one controller record, and git status is clean`.

**Depends on:** none

## Phase 1 — Probe and activation

### P1-01: scripts/runner-probe.mjs

**Goal:** One script sends one request to a runner and prints one JSON line, never leaking the runner's token.

**Files touched:** `scripts/runner-probe.mjs`, `test/routing.mjs`, `docs/routing.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-01, §5.6, §3 principles 4, 11, 12, Appendix B.7. Constraints `probe-node-only` (only `node:` imports, no sibling file) and `scripts-node-builtins`; no shebang, not executable; the CLI runs only when the file is the entry script; the script may use `async`.
- Exports `probe({ endpoint, mode, served, timeoutMs, token })` (async; `mode` is `"models"` or `"warm"`; resolves to the result object, never rejects) and `main(argv, { env, stdout, stderr })` (async; resolves to the exit status).
- Usage: `node scripts/runner-probe.mjs --endpoint <http(s)://host[:port]> --models [--timeout-ms N] [--token-env NAME]` and `… --warm <served id> […]`. A usage error prints the usage text to stderr, nothing to stdout, and returns 2: no `--endpoint`; an endpoint that is not `http(s)://host[:port]` with no path, query or credentials; both or neither of `--models` and `--warm`; `--warm` without an id; `--timeout-ms` that is not a positive integer; `--token-env` that does not match `/^[A-Z][A-Z0-9_]*$/`; an unknown option.
- `--models` sends `GET /v1/models`; `--warm` sends `POST /v1/messages` with the body `{ "model": <served id>, "max_tokens": 1, "messages": [{ "role": "user", "content": "ping" }] }` and the headers `content-type: application/json` and `anthropic-version: 2023-06-01`. Use `node:http` or `node:https` `request` by the endpoint's protocol; follow no redirect; write no file. The `1` of `max_tokens` is written only here.
- With `--token-env NAME`: an unset or empty variable prints `{ "ok": false, "status": null, "ms": 0, "error": "the environment variable <NAME> is not set" }` and returns 1 before any request. Otherwise its value is sent as `x-api-key` and as `authorization: Bearer <value>`. The value is read from `env` only and is never in argv.
- Output: exactly one JSON line on stdout. Success (`ok` true only for a 2xx status): `{ "ok": true, "status": 200, "ms": <integer>, "served": [ids] }` for `--models` (the `data[].id` strings of the JSON body), `{ "ok": true, "status": 200, "ms": <integer>, "reported": <the body's string model field, or null> }` for `--warm`. Failure: `{ "ok": false, "status": <number or null>, "ms": <integer>, "error": "<one line>" }`, where `error` is `HTTP <status>: <the body with whitespace runs collapsed to one space, cut to 300 characters>` (just `HTTP <status>` for an empty body) for a non-2xx answer, `no answer within <N> ms` when the timer aborted the request, `<code>: <message>` for a connection error (`ECONNREFUSED: …`), and `the response is not a JSON model list` for a 2xx `--models` body without a `data` array. A 2xx `--warm` body that is not JSON gives `reported: null`. Exit status 0 when `ok`, else 1. Read at most 1,048,576 bytes of any body.
- Without `--timeout-ms` no timer is set. With it, the timer covers the whole request, from the first byte sent to the last byte read.
- Redaction: when a token was read, every occurrence of its value in any string the result holds is replaced with `<redacted>` before the line is serialized, and the serialized line is checked once more, so a runner that echoes a header cannot leak it.
- `docs/routing.md`'s Runners section gains a paragraph on the probe: the two forms, the output, the exit statuses, and that it is how to check a runner by hand. README's repo layout lists the script. `CHANGELOG.md`, `### Added`: `scripts/runner-probe.mjs` (A-01).
- The opt-in step: with `KUKULU_RUNNER_IT=1` and `KUKULU_RUNNER_IT_ENDPOINT=<url>`, `test/routing.mjs` runs the real script with `--models` against that endpoint and asserts exit 0 and a non-empty `served`; without both variables it prints one `# skipped` line. It is never part of `kukulu_verify`.

**Acceptance tests:** `test/routing.mjs`, against a `node:http` server the test starts on `127.0.0.1` port 0 and closes in a `finally` (CLAUDE.md's metrics-test protocol), running the script with `spawn` so the test's own server can answer (never `spawnSync`, which would block it): "--models lists the ids of data[].id"; "--warm reports the body's model"; "--warm reports null when the body has no model"; "--warm sends model, max_tokens 1, one ping message and anthropic-version" (the fake records the request); "a 404 with a body is ok false, status 404, error HTTP 404: <body>, exit 1"; "a server that never answers is no answer within <N> ms" (with `--timeout-ms 300`); "a refused connection fails at once with status null" (a closed port, `--timeout-ms 60000`, the result's `ms` under 5000); "an unset token variable is an error before any request" (the fake sees none); "the token reaches the runner as x-api-key and as a Bearer authorization"; "a runner that echoes the Authorization header in a 401 body does not leak the token" (stdout and stderr contain `<redacted>` and not the value); "a redirect is not followed" (a 302 is `ok: false`, and the second fake sees no request); each usage error returns 2 with usage on stderr and nothing on stdout; "the probe prints exactly one line".

**Out of scope:** the server's use of the probe (P1-03); runner config keys (P1-02); any retry.

**Verification:** `kukulu_verify`; `node test/routing.mjs`.

**Depends on:** none

### P1-02: Runner keys activate, activateTimeoutMs, servedAs and tokenEnv, and the served id

**Goal:** The global file's runners accept the four new keys with a refusal for every bad shape, and every role resolves to the model id its runner is asked for.

**Files touched:** `mcp/server.mjs`, `test/routing.mjs`, `docs/routing.md`, `docs/operations.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.1, §5.5, §5.6, §6 A-02, §3 principles 9, 16; Decisions (`no-hardcoded-activate-timeout`, a warm runner without an endpoint). `server-synchronous`, `server-no-network`.
- `RUNNER_KEYS` gains `activate`, `activateTimeoutMs`, `servedAs`, `tokenEnv`. `validateRunners(runners, where, limit = mcpTimeoutMs())` refuses, each message starting with `where` as the existing runner refusals do (`global config <path> runners.<name>…`), with SPEC's texts after it:
  - `.activate must be "none" or "warm"`
  - `.activateTimeoutMs must be an integer of at least 1000`
  - `.activateTimeoutMs (<N> ms) is at or above the MCP timeout (<M> ms from .mcp.json); the client would abort kukulu_next first. Lower it, or raise the timeout` (when `limit` is not `null`; for an explicit value, and for the default when `activate` is `"warm"`)
  - `.servedAs must map a model string to a non-empty string` (not a plain object, an empty key, or a value that is not a non-empty string)
  - `.tokenEnv must be an environment variable name such as SPARK_TOKEN` (not a string matching `/^[A-Z][A-Z0-9_]*$/`)
  - `.activate is "warm" but the runner has no endpoint to send the request to; add endpoint, or set activate to "none"`
- The name `anthropic` stays refused as it is today (`…runners.anthropic is reserved for the built-in Anthropic runner`), whatever keys the block holds; that is how the four keys are refused on it.
- `servedId(runnerName, model, runners)` returns `runners[runnerName].servedAs[model]` when set, else `model` with the longest matching `match` prefix removed. `runnerFor`'s result for a configured runner gains `activate` (`r.activate ?? "none"`), `activateTimeoutMs`, `served` (`servedId(…)`) and `tokenEnv` (`r.tokenEnv ?? null`); for the built-in `anthropic` runner and for no runner they are `"none"`, `null`, `null`, `null`. The default is written on exactly this line, under a comment that marks it ⚠️ ASSUMPTION and does not repeat the number: `activateTimeoutMs: r.activateTimeoutMs ?? 1800000,`. No other line of `mcp/`, `scripts/`, `skills/`, `agents/` or `hooks/` may spell it, in any form.
- `resolveRouting`, once the roles are resolved: a role on a configured runner whose served id is the empty string is refused with `global config <path> runners.<name>.match entry '<prefix>' equals the model string '<model>', so no model id is left to ask the runner for; add a servedAs entry`.
- `resolveRouting().roles[role]` carries the four new fields. `kukulu_config_show`'s `roles.<role>` gains `activate`, `served` and `activateTimeoutMs`; its `runners` keeps echoing the file's blocks. The routing table becomes `| role | agent | model | runner | served | activate | effort | source |`, with `–` in `served` and `activate` for the `anthropic` runner and for no runner. Genesis's `rolesRecord` does not change (A-04).
- The token: only the variable's name is ever read from config; `mcp/server.mjs` never reads the variable's value.
- Docs: `docs/routing.md`'s Runners table gets the four rows and a paragraph on the served id with SPEC's `spark/qwen38-27b` example; `docs/operations.md`'s Routing section names the four keys, their defaults (the timeout as "1800000 ms, 30 minutes, ⚠️ ASSUMPTION") and the MCP-timeout rule, in words ("24 hours"), pointing at `docs/routing.md`; `docs/mcp-tools.md`'s `kukulu_config_show` and `kukulu_agents_sync` show the new fields and table columns.
- `CHANGELOG.md`, `### Added`: the runner keys `activate`, `activateTimeoutMs`, `servedAs` and `tokenEnv`, and the served id in `kukulu_config_show` and the routing table (A-02).

**Acceptance tests:** `test/routing.mjs`, with `writeGlobalConfig`: one assertion per refusal above, each matching its full text ("runners.<name>.activate 'hot' is refused", "activateTimeoutMs 999 is refused", "activateTimeoutMs 1000.5 is refused", "activateTimeoutMs at the MCP timeout is refused" (the test reads the limit from `.mcp.json` and never spells it; one below the limit is accepted), "servedAs as an array is refused", "servedAs with an empty value is refused", "tokenEnv 'spark-token' is refused", "activate warm without an endpoint is refused", "a match prefix equal to the model string is refused"); "the four keys on a runner named anthropic are refused as reserved"; "the default strips the longest matching prefix" (`spark/qwen38-27b` → `qwen38-27b`, and the longer of two prefixes wins); "servedAs overrides the strip"; "a servedAs entry rescues a prefix equal to the model"; "activate defaults to none and activateTimeoutMs to thirty minutes" (through `kukulu_config_show`); "an anthropic role has served null and activate none"; "the routing table has served and activate columns"; "kukulu_config_show echoes the new runner keys".

**Out of scope:** sending any request (P1-03); the template (P3-02); the policy file's runner rules.

**Verification:** `kukulu_verify`; `node test/routing.mjs`.

**Depends on:** none

### P1-03: kukulu_next warms the stage's runner and records the wait

**Goal:** Before a stage starts on a runner with `activate: "warm"`, `kukulu_next` runs the probe, waits for the answer and records it in the timeline and the result.

**Files touched:** `mcp/server.mjs`, `test/harness.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `docs/architecture.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-03 (⚠️ NEW MATTER; write "patent pending", never "patented"), §5.3, §3 principles 1, 4, 5, Appendix B.1, B.2; Decisions (activation's timeline order, skipped when `restartRequired`). `server-synchronous`, `server-no-network`: the server opens no socket; the request is made by the probe through `spawnSync`.
- `activateRunner(role)` in `mcp/server.mjs`: reads `resolveRouting().roles[role]`; returns `null` (no probe) when the runner is `null` or `anthropic` or `activate` is not `"warm"`. Otherwise it runs `spawnSync(process.execPath, [probePath, "--endpoint", endpoint, "--warm", served, "--timeout-ms", String(activateTimeoutMs), ...(tokenEnv ? ["--token-env", tokenEnv] : [])], { encoding: "utf8", timeout: activateTimeoutMs + RUNNER_BACKSTOP_MS })` and parses the last non-empty stdout line. `probePath` is `KUKULU_RUNNER_PROBE` when set (for tests only, read through `envVar("RUNNER_PROBE")`), else `<plugin root>/scripts/runner-probe.mjs`. A run that prints no parseable line is `{ ok: false, status: null, ms: <elapsed>, error: "the probe printed no result (exit <status>)" }`. The server passes its own environment to the child and never reads the token variable.
- `next()`: after `nextDecision()`, when the result's stage is `plan`, `implement`, `review` or `summarize` and `restartRequired` is false, call `activateRunner(ROLE_OF_STAGE[stage])` once (a parallel wave warms once, for the implementer, before `streams` is returned). The probe runs on every such call, also when the stage and round are unchanged.
- On `ok`: `recordTimeline` writes, in this order, the `end` of the open span when the stage or round changed (its `at` is the time taken before the probe ran), then `{ event: "activate", stage, round, runner, served, reported, ms, ok: true, at }`, then the new `start` (its `at` taken after the probe). For an unchanged stage and round it writes the `activate` record alone. The commit subject is `chore: stage <stage>` in both cases. The result gains `activation: { runner, served, reported, ms }`.
- The open span is the last record whose `event` is `start` or `end`, when it is a `start`; `activate` records are ignored when looking for it, in `recordTimeline` and in `stageSecondsOf`, so a model load is never counted as stage time.
- `kukulu_status` gains `activateSeconds`: per runner, the sum of `ms` over the timeline's `activate` records with `ok: true`, in whole seconds (`Math.round`); `{}` with none.
- In this task a probe that fails leaves the decision as it is, with `activation: { runner, served, reported: null, ms, error }` and no timeline record; P1-04 replaces that with the halt.
- `test/harness.mjs`: `mkFakeProbe()` returns `{ script, dir, answers(list), calls() }`: a temp directory holding `probe.mjs`, which appends its argv as one JSON line to `calls.jsonl`, prints the next entry of `answers.json` as one line (the last entry repeats) and exits 0 when that entry's `ok` is true, else 1. Describe it in the helper's comment.
- A test routes a role to a non-Anthropic model. For `restartRequired` to be false the generated agent files must exist before the server under test starts: call `kukulu_agents_sync` in one server process, stop it, and start a second with the same `KUKULU_CONFIG`.
- Docs: `docs/mcp-tools.md` (`kukulu_next`: the activation step, `activation`, the timeline record, that the call can take as long as a model load; `kukulu_status`: `activateSeconds`); `docs/architecture.md`'s stage machine gets the activation step between the decision and the timeline; `docs/operations.md`'s environment table lists `KUKULU_RUNNER_PROBE` as for tests only.
- `CHANGELOG.md`, `### Added`: `kukulu_next` warms a stage's runner before the stage starts and records the wait (A-03); `### Changed`: `kukulu_next` can take as long as a model load.

**Acceptance tests:** `test/state.mjs`, with `mkFakeProbe` and `KUKULU_RUNNER_PROBE`: "an ok activation returns activation with runner, served, reported and ms"; "the timeline holds end, activate, start in that order" (and the `end`'s `at` is not later than the `activate`'s); "the probe is called with --endpoint, --warm <served>, --timeout-ms and no token flag"; "tokenEnv adds --token-env <NAME>, never a value"; "the probe runs again for the same stage and round and writes the activate record alone"; "stageSeconds is unchanged by an activate record" (a state file with a ten-second span and an `activate` record inside and after it reports 10); "activateSeconds sums ok records per runner"; "activate none runs no probe"; "a role on the anthropic runner runs no probe"; "restartRequired runs no probe"; "a wave runs one probe"; "done and halt run no probe"; "a failed probe does not stop the stage in this task" (the result keeps its stage and carries `activation.error`; P1-04 replaces this assertion).

**Out of scope:** the failure halt and the counter (P1-04); the chain's `data.activate` and the drift notes (P1-05); go-flight's line (P1-06).

**Verification:** `kukulu_verify`; `node test/state.mjs`.

**Depends on:** P1-02

### P1-04: A runner that does not serve its model halts the flight

**Goal:** A failed activation halts the flight before the stage, with a reason naming what the runner does serve, and is counted.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-03 step 3, C-02 (`activateFailures`), §5.4, §3 principles 6, 16; Decisions (the follow-up `--models` probe, the phase crossing). `server-synchronous`, `server-no-network`.
- When the warm probe's result is not `ok`, `next()` runs the probe once more with the same `--endpoint` and `--token-env`, `--models` instead of `--warm <served>`, and `--timeout-ms` `Math.min(activateTimeoutMs, RUNNER_LIST_TIMEOUT_MS)`, where `const RUNNER_LIST_TIMEOUT_MS = 10000;` is a fixed constant in `mcp/server.mjs` (not a tunable: the list only decorates the reason).
- The reason, verbatim: `runner <name> did not serve <served> within <N> ms (<error>). It serves: <ids, or "nothing it would list">. Fix the runner or the routing, then resume: kukulu_run_resume({ reason: "<what you fixed>" })`. `<N>` is `activateTimeoutMs`, `<error>` the warm probe's `error`, `<ids>` the listing's `served` joined with `, `, and the words `nothing it would list` when the listing failed or is empty. The trailing `<what you fixed>` is literal.
- The result is a `halt` shaped as `nextDecision`'s own halts are (`agent: null`, `prompt: null`, no `description`, no `streams`) with that `reason` and `activation: { runner, served, reported: null, ms, error }`. `recordTimeline` writes the `end` of the open span, then `{ event: "activate", …, reported: null, ms, ok: false, at }`, sets `state.halted` to the reason (no `haltCap`), and commits as `chore: stage end`. If the write cannot be committed the result is still the halt, with `timelineNote`.
- The halt is not a round-cap halt: the next `kukulu_next` returns it without probing (the reason already names `kukulu_run_resume`), and `kukulu_run_resume` clears it.
- Counters (the path and `ensureMetricsExcluded()` are P0-03's): `readCounters()` returns the parsed `.kukulu/metrics/counters.json`, or `null` when it is absent or unreadable; `bumpCounter(name, by = 1)` reads it (starting from `{ verifyRuns: 0, verifyFailures: 0, guardReblocks: null, tasksReopened: 0, activateFailures: 0 }` when absent), adds, writes it back as one JSON line, calls `ensureMetricsExcluded()`, and returns `null` or a one-line note when the write fails. It never throws. This task increments `activateFailures` on every failed activation; a note becomes `countersNote` on the result (CLAUDE.md's notes protocol).
- Docs: `docs/mcp-tools.md` (`kukulu_next`: the halt and its reason); `docs/operations.md`'s Halts section gets the runner halt and how to resume it; `docs/metrics.md` gains `## Counters` with the file and `activateFailures`.
- `CHANGELOG.md`, `### Added`: a runner that does not serve the stage's model halts the flight before the stage, naming what it does serve (A-03, A-04).

**Acceptance tests:** `test/state.mjs`, with `mkFakeProbe` (P1-03's "a failed probe does not stop the stage in this task" is replaced by these): "a failed activation halts with the reason naming the runner, the served id, the wait and the error" (the full text); "the reason lists what the runner serves" and "...or nothing it would list"; "the follow-up probe is --models with the capped timeout"; "the timeline holds the activate record with ok false"; "state.halted is the reason and the commit is chore: stage end"; "activateFailures is 1, then 2" (in `counters.json`); "the next kukulu_next returns the halt without probing"; "kukulu_run_resume clears the halt and the next call probes again"; "a probe that prints nothing is a failure, not a crash"; "a counters file that cannot be written is a countersNote, and the halt stands" (make `.kukulu/metrics/counters.json` a directory).

**Out of scope:** the other counters and `kukulu_status.counters` (P2-01, P2-02); `METRICS.json` on the halt (P2-08); retrying a probe.

**Verification:** `kukulu_verify`; `node test/state.mjs`.

**Depends on:** P1-03, P0-03

### P1-05: Activation in the chain, and the runner-drift notes

**Goal:** In clean-room mode the stage's `start` entry records the activation, and a runner that answers under another model id, or a role whose served id changes mid-flight, is logged as friction.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `test/cleanroom.mjs`, `test/attest.mjs`, `docs/cleanroom.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-03 (the clean-room rule, the drift rule, "No token value reaches any of these records"), A-04, §3 principle 6, Appendix B.8. No entry kind is added; `mcp/cleanroom.mjs`, `KINDS`, `CHECKPOINT_KEYS` and the verifier do not change.
- Clean-room mode: when one `kukulu_next` call writes an `ok` `activate` record and a `start` record, that `start`'s chain entry gains `data.activate: { runner, served, reported, ms }`. An activation with no new `start` (same stage and round) and a failed one are in `state.timeline` only.
- Drift 1 (A-03): when `reported` is not `null` and `normalizeModel(reported) !== normalizeModel(served)`, append one feedback entry, `stage: "controller"`, `category: "runner-drift"`, `source: "auto"`: `runner <name> answered as <reported> when asked for <served> (stage <stage>, round <round>); the chain keeps both`.
- Drift 2 (A-04): when the timeline already holds an `ok` `activate` record for the same stage name whose `served` differs from this one's, append one feedback entry, same stage and category: `the <role> was served as <previous> at an earlier activation and is <served> now (runner <name>); the routing changed mid-flight`. Compare with the most recent such record only.
- Both are notes, never a halt. Each is appended only when `policies.feedback` is true, inside the same `withRollback` as the timeline, and `.kukulu/feedback.jsonl` joins that commit's paths.
- The end-to-end test with the real `scripts/runner-probe.mjs` lives in this task, so that P1-03 does not depend on the probe script.
- Docs: `docs/cleanroom.md`'s `stage` paragraph documents `data.activate` and what a reviewer can read from `served` beside `reported`; `docs/mcp-tools.md`'s `kukulu_next` documents both notes.
- `CHANGELOG.md`, `### Added`: in clean-room mode the stage's start entry records the model asked for, the model the runner reports and the wait (A-03, patent pending); a `runner-drift` feedback entry when the two differ or a role's served id changes (A-03, A-04).

**Acceptance tests:** `test/state.mjs`: "a reported id that differs from the served id logs one runner-drift entry" (and none when they are equal once normalized, such as `Spark/Qwen38-27b` and `qwen38-27b`); "the drift entry is in the same commit as the timeline"; "a role whose served id changed logs one runner-drift entry" (change `servedAs` between two calls); "policies.feedback false logs neither"; "the real probe answers through kukulu_next" (no `KUKULU_RUNNER_PROBE`; a `node:http` server the test starts is the runner; the tool call is awaited through the harness's async client, so the test's server can answer while the Kūkulu server waits on the probe: `activation.reported` is the fake's model and the fake saw one `POST /v1/messages` for the served id). `test/cleanroom.mjs`: "the start entry carries data.activate with runner, served, reported and ms"; "an activation with no new start writes no chain entry"; "the chain still verifies"; "no token value is in the state, the chain or the feedback file" (a `tokenEnv` variable set to a marker string, searched for in all three). `test/attest.mjs`: "a bundle whose stage entry carries data.activate verifies".

**Out of scope:** changing the gate, genesis or the verifier; halting on drift.

**Verification:** `kukulu_verify`; `node test/state.mjs`; `node test/cleanroom.mjs`.

**Depends on:** P1-03, P1-01

### P1-06: go-flight prints the activation line

**Goal:** The flight controller prints how long a runner took to be ready.

**Files touched:** `skills/go-flight/SKILL.md`, `test/plugin.mjs`, `docs/operations.md`

**Design constraints:**

- SPEC §6 A-03 (the go-flight sentence), §3 principle 1: the skill prints what the result carries and computes nothing beyond dividing `ms` by 1000 for display.
- `skills/go-flight/SKILL.md`, loop step 1: the result may carry `activation: { runner, served, reported, ms }`; when it does, print `runner <name>: <served> ready in <seconds> s`, and end the line with ` (reports <reported>)` when `reported` is not null and differs from `served`. A `halt` whose reason starts `runner ` is printed by step 2 like any other. The skill's frontmatter does not change.
- `docs/operations.md`'s "Running a flight" mentions the line and that `kukulu_next` returns only after the runner answers.

**Acceptance tests:** `test/plugin.mjs`: "go-flight prints the activation line" (the skill contains `runner <name>: <served> ready in <seconds> s`); "...and the reported id when it differs" (contains `(reports <reported>)`); the existing go-flight assertions keep passing.

**Out of scope:** any server change; `allowed-tools`.

**Verification:** `kukulu_verify`; `node test/plugin.mjs`.

**Depends on:** P1-03

### P1-07: Measure what the probe costs and how it fails

**Goal:** Record the probe's fixed cost and failure latencies beside the `activateTimeoutMs` default, so the owner can judge the assumption.

**Files touched:** `docs/spikes/P1-07.md`

**Design constraints:**

- SPEC §5.6 (`activateTimeoutMs`, ⚠️ ASSUMPTION, default 1800000 ms, written only on `runnerFor`'s line); CLAUDE.md "Tuning an assumption". The default does not change in this task: no model load can be measured here, and a new default is the owner's call.
- Question: what does one activation add to a stage start when the model is already loaded, and how fast do the two failure shapes return? Time box: one hour.
- Method, against a `node:http` server on `127.0.0.1` in a throwaway script outside the repository (not committed): (1) the wall time of `node scripts/runner-probe.mjs --endpoint … --warm x --timeout-ms 60000` answered at once, median of ten runs, beside the median of ten bare `node -e 0` runs; (2) the same against a closed port (the refused connection), median of ten; (3) against a server that accepts and never answers with `--timeout-ms 1000`, the overshoot beyond 1000 ms, median of ten.
- `docs/spikes/P1-07.md` (markdownlint-clean): the question, the method, the raw numbers, before (the default and SPEC's one published cold start of 12 min 54 s) and after (the measured fixed cost, the refused-connection latency, the timeout overshoot), and one sentence saying the default is unchanged and why. It must not contain the 24-hour limit in milliseconds.

**Acceptance tests:** none added; `kukulu_verify` is green.

**Out of scope:** changing the default or any code; committing the measuring script.

**Verification:** `kukulu_verify`. The commit body's `Measurement:` line and the progress log carry the three medians and both values of the default (before and after are the same).

**Depends on:** P1-01

### P1-08: Phase 1 end: push and record the manual checks

**Goal:** Push the branch and record Phase 1's manual checks for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P1-08: Phase 1 end: push and record the manual checks`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): node scripts/runner-probe.mjs --endpoint <a real runner> --models lists its models; with activate "warm" on a runner whose proxy swaps models, kukulu_next returns only after the model answers and the go-flight transcript shows the ready in line`.

**Depends on:** none

## Phase 2 — Metrics and comparison

### P2-01: Counters for verify runs, verify failures and reopened tasks

**Goal:** The server counts `kukulu_verify` calls, the ones that report a failing command, and reopened tasks, and `kukulu_status` reports the counters.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-02, §5.4, §3 principles 6, 7, 8; Decisions (`verifyFailures`, principle 6's feedback entry); CLAUDE.md's notes protocol. `server-synchronous`.
- Use `bumpCounter` and `readCounters` from P1-04. `verify()` increments `verifyRuns` on every call that gets as far as running its commands, and `verifyFailures` when at least one command result is not `ok` (a skipped command is not a failure, and a call that fails only a constraint is not one). `taskReopen` increments `tasksReopened` once per call, after its commit.
- A note from `bumpCounter` becomes `countersNote` on the tool's result and never changes `ok`, the refusals or the commit. `kukulu_verify` appends no feedback entry (it makes no commit); `kukulu_task_reopen` appends none either, because its commit is already made.
- `kukulu_status` gains `counters`: `readCounters()`'s object, or `null`.
- A stream's `kukulu_verify` counts in the main checkout's file (the server's root).
- Docs: `docs/mcp-tools.md` (`kukulu_status.counters`, `countersNote` on `kukulu_verify` and `kukulu_task_reopen`); `docs/metrics.md`'s Counters section gets the table of SPEC C-02 with these three rows.
- `CHANGELOG.md`, `### Added`: `.kukulu/metrics/counters.json` and `kukulu_status.counters` (C-02).

**Acceptance tests:** `test/implement.mjs`: "kukulu_verify counts a run"; "a failing command counts a failure"; "a passing run counts no failure"; "a failing constraint alone counts a run and no failure"; "a counters file that cannot be written is a countersNote and the result is unchanged". `test/state.mjs`: "kukulu_status.counters is null before anything is counted"; "kukulu_status reports the counters"; "kukulu_task_reopen counts tasksReopened"; "the counters file is not in git status" (after `kukulu_run_start`).

**Out of scope:** `guardReblocks` (P2-02); `METRICS.json`.

**Verification:** `kukulu_verify`; `node test/implement.mjs`; `node test/state.mjs`.

**Depends on:** P1-04

### P2-02: The implement guard keeps a cumulative total, read as guardReblocks

**Goal:** The lock carries a re-block count that never resets, and the server adds it to the counters when a run finishes or halts.

**Files touched:** `scripts/implement-guard.mjs`, `mcp/server.mjs`, `test/guard.mjs`, `test/state.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`, `docs/metrics.md`, `docs/architecture.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-02 (the lock's `total`). CLAUDE.md's reviewer rule: `RUN_START_TOOL` and the agent-type set stay as they are; the lock's `total` field is the one permitted change to `scripts/implement-guard.mjs` in this flight. Its decision rules, messages and cap handling do not change.
- `scripts/implement-guard.mjs`: wherever it writes the incremented `count` to a JSON lock it also writes `total`: the lock's integer `total` (0 when absent) plus one. A lock in the legacy bare-number form is rewritten as a bare number, as today, and gets no `total`.
- `mcp/server.mjs`: `startRun` arms the lock with `total: 0`; `resetLockCounter` and `setLockPaused` keep `total` (they already spread the lock's other keys; a test pins it). `runFinish` and `runHalt`, just before each removes the lock, read its `total`: an integer is added to `guardReblocks` (`null` counts as 0 before the addition); a lock without one (the legacy form) leaves the counter as it is, so it stays `null` for a flight whose runs never reported one.
- A `bumpCounter` note becomes `countersNote` on `kukulu_run_finish`'s or `kukulu_run_halt`'s result; `kukulu_run_halt` appends it as a feedback entry (`category: "metrics"`) inside the commit it already makes.
- Docs: `docs/mcp-tools.md` (`kukulu_run_start`'s lock shape, `kukulu_run_finish`, `kukulu_run_halt`); `docs/metrics.md`'s counter table gets `guardReblocks` and the legacy-lock rule; `docs/architecture.md` where the lock is described.
- `CHANGELOG.md`, `### Added`: the implement guard keeps a cumulative `total` beside `count`, reported as `guardReblocks` (C-02).

**Acceptance tests:** `test/guard.mjs`: "a re-block increments count and total"; "total survives a count reset" (rewrite the lock with `count: 0` as `resetLockCounter` does, block again: `count` 1, `total` 2); "a legacy bare-number lock gets no total"; "a re-block past the cap still counts in total". `test/implement.mjs`: "kukulu_run_start arms the lock with total 0"; "kukulu_task_done resets count and keeps total"; "kukulu_run_finish adds the lock's total to guardReblocks". `test/state.mjs`: "kukulu_run_halt adds the lock's total to guardReblocks"; "a legacy lock leaves guardReblocks null"; "two runs' totals add up".

**Out of scope:** any other change to the guard; `TASK_ID`, `TASK_LINE` and the guard's regexes.

**Verification:** `kukulu_verify`; `node test/guard.mjs`; `node test/implement.mjs`; `node test/state.mjs`.

**Depends on:** P1-04

### P2-03: The harness's name from initialize

**Goal:** The state records which harness, at which version, drove the flight.

**Files touched:** `mcp/server.mjs`, `test/protocol.mjs`, `docs/mcp-tools.md`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-04, §5.3. `server-synchronous`.
- The `initialize` handler keeps `params.clientInfo` in a process variable when its `name` is a non-empty string: `{ name, version }`, `version` being the string given or `null`. Until then the variable is `{ name: "unknown", version: null }`. The reply does not change.
- `state.harness` is a list of `{ name, version }` in first-seen order. `startRun`'s state write and `recordTimeline`'s state write each add the process's value when no entry has the same `name` and `version`. `kukulu_next` never writes the state for this alone, so 0.8.1 C-01's byte-identical test stands.
- `kukulu_status` gains `harness`: `state.harness`, or `[]`.
- Docs: `docs/mcp-tools.md` (`kukulu_status.harness`; `kukulu_run_start` and `kukulu_next` record it); `docs/metrics.md` notes the source of the harness list.
- `CHANGELOG.md`, `### Added`: the flight records the harness's name and version from the MCP `initialize` request (C-04).

**Acceptance tests:** `test/protocol.mjs`: "initialize's clientInfo reaches state.harness on the next timeline write" (`{ name: "claude-code", version: "9.9.9" }`, then `kukulu_next` in a planned repository, then `kukulu_status.harness`); "the same client is recorded once"; "a second client is appended in first-seen order" (a second server process with another `clientInfo`); "a client that sends no clientInfo is recorded as unknown with version null"; "a clientInfo without a version records version null"; "initialize's reply is unchanged".

**Out of scope:** `METRICS.json` (P2-04); any use of the harness name in a condition.

**Verification:** `kukulu_verify`; `node test/protocol.mjs`.

**Depends on:** none

### P2-04: buildMetrics: outcome, wall time, rounds, tasks, friction and tree

**Goal:** `buildMetrics` turns plain data into every part of `METRICS.json` that does not depend on usage records.

**Files touched:** `mcp/metrics.mjs`, `test/metrics.mjs`, `test/fixtures/metrics/v0-8-0.inputs.json`, `test/fixtures/metrics/v0-8-0.expected.json`, `test/fixtures/metrics/README.md`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-01, Appendix A, §3 principles 2, 3, 7; Decisions (`wall.endedAt`). `metrics-module-pure`, `metrics-harness-neutral`: `buildMetrics` takes plain data, reads no file and no clock, and never throws on a missing input; the field is `null`.
- `buildMetrics(inputs)` with `inputs = { plugin, flight, spec, state, caps, routing, usage, counters, feedback, tasks, git, genesis, now }`, every key optional. This task fills, in Appendix A's key order: `v` (`METRICS_VERSION`), `plugin`, `flight`, `spec` (`{ title, sha256 }` or `null`), `harness` (`state.harness` when it is a non-empty array, else `[{ name: "unknown", version: null }]`), `usage`, `mode`, `enforcement`, `outcome`, `wall`, `rounds`, `roles`, `totals`, `tasks`, `friction`, `tree`. `usage`, `roles` and `totals` are `null` until P2-05, which updates the expected fixture.
- `mode` and `enforcement`, when `inputs.genesis` is an object: `mode` is `genesis.mode ?? "clean-room"`; `enforcement` is `genesis.enforcement` when the object has that key (even `null`), else `"hook"` (a genesis written before 0.8.0 has neither). Without `inputs.genesis`: `"general"` and `null`.
- `outcome`: `verdict` (`state.verdict ?? null`), `halted` (`state.halted ?? null`), `reviews` (`state.rounds.length`), `fixRounds` (`state.round`), `approvedAtRound` (the `round` of the first entry of `state.rounds` whose verdict is `APPROVED`, else `null`), `caps` (`{ maxRounds, maxRoundsHard }` from `inputs.caps`, else `null`). Without a state, each is `null`.
- `wall`, from `state.timeline`: spans are a `start` closed by the next `end`; `activate` records are neither. `startedAt` is the first record's `at`; `endedAt` is the last record's `at`, or `inputs.now` when a span is open and `now` is given; `seconds` is their difference in whole seconds; `stageSeconds` sums the spans per stage (an open span counts to `now`, and is left out without `now`); `activateSeconds` sums `ms` of `ok` `activate` records per runner, in whole seconds; `idleSeconds` is `seconds` minus the sum of `stageSeconds` and of `activateSeconds`. An absent or empty timeline gives `startedAt`, `endedAt`, `seconds` and `idleSeconds` `null`, and `stageSeconds` and `activateSeconds` `null`.
- `rounds[]`: one entry per `state.rounds` entry, `{ round, implementSeconds, reviewSeconds, findings, sources, verdict, nonConverging }`. Review round N covers the timeline's spans whose `round` is N − 1 (the build is round 0 and review 1 reviews it): `implementSeconds` and `reviewSeconds` are the sums of the `implement` and `review` spans of that timeline round, `null` when there is none. `findings` is `fixTasks`, `sources` the entry's `sources` or `null`, `nonConverging` the entry's value or `false`.
- `tasks`: `{ total, done, blocked, skipped }` from `inputs.tasks` and `reopened` from `counters.tasksReopened`; each `null` without its source.
- `friction`: `feedback` counts `inputs.feedback` entries by `category`, always with the keys `restart` and `runner-drift` (0 when none), keys sorted; `null` when `inputs.feedback` is not an array. `guardReblocks`, `verifyRuns`, `verifyFailures`, `activateFailures` from `inputs.counters`, each `null` without it.
- `tree`: `inputs.git` is `{ commits, shortstat, mergeBase }`; `commits` passes through, and `filesChanged`, `insertions`, `deletions` are parsed from the `git diff --shortstat` line (a part the line omits is 0; an empty line is three zeros). When `inputs.git` or its `mergeBase` is `null`, all four are `null`. The merge base itself is never in the output.
- No 40-hex string may appear anywhere in the output (C-01, "No commit hashes"); `spec.sha256` and `usage.chainHead` are 64-hex.
- Fixtures: `v0-8-0.inputs.json` is built from `docs/flights/v0-8-0/` (its `state.json`, the caps and `flight` of its `kukulu.json`, its `feedback.jsonl` entries, the task counts of its `PROGRESS.md`; no usage, no counters, no git facts, `spec` with the title of its `SPEC.md` and the SHA-256 of that file) and `v0-8-0.expected.json` is the exact metrics for it, worked out from the rules above, not copied from the code's output. Both files are ASCII: escape every non-ASCII character as `\uXXXX`. `README.md` in the directory says where each input came from.
- `docs/metrics.md` gains `## METRICS.json` with a table: every field of the object by its dotted path, and the file and field it is derived from (principle 7). This task writes the rows for the fields it fills.
- `CHANGELOG.md`, `### Added`: `buildMetrics` in `mcp/metrics.mjs` (C-01).

**Acceptance tests:** `test/metrics.mjs`: "the recorded v0-8-0 flight builds to its exact metrics" (deep equality with the expected fixture); "an empty input builds an object with every top-level key and no throw"; "no timeline gives null wall fields"; "an open span counts to now and endedAt is now"; "activate records are no span and sum per runner"; "idleSeconds is seconds minus stage and activate seconds"; "a round's implement and review seconds come from the spans of the round before it"; "approvedAtRound is the first APPROVED round, else null"; "a halted flight keeps its halt reason and a null approvedAtRound"; "feedback is counted by category with restart and runner-drift always present"; "counters null gives null friction counters, never 0"; "the shortstat line parses, with an omitted part as 0"; "a null merge base gives a null tree"; "no 40-hex string is in the output" (`/\b[0-9a-f]{40}\b/` over the JSON of a build whose inputs hold a merge base). `docs/metrics.md` is checked in P2-05.

**Out of scope:** usage, roles and totals (P2-05); reading any file (P2-06); `compareMetrics` (P2-10).

**Verification:** `kukulu_verify`; `node test/metrics.mjs`.

**Depends on:** P0-01

### P2-05: buildMetrics: usage, roles and totals

**Goal:** `buildMetrics` sums usage records per role, and a role without a record is missing, never zero.

**Files touched:** `mcp/metrics.mjs`, `test/metrics.mjs`, `test/fixtures/metrics/v0-8-0.expected.json`, `test/fixtures/metrics/full.inputs.json`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-01 ("Missing is not zero", `roles.<role>`), B-03, B-05, Appendix A, Appendix B.4, §3 principles 7, 17; Decisions (repeated stops, the controller's `cost`). `metrics-module-pure`, `metrics-harness-neutral`.
- `inputs.usage` is `{ source: "chain" | "usage.jsonl", records: [usage records], chainHead: <string or null> }`; `inputs.routing` is `{ <role>: { model, runner, locality, family } }` for the four stage roles.
- Counted records: those that pass `validateUsageRecord` and are not the error form. Then, for `role: "controller"` in both sources, only the last record of each `session` is kept. For the other roles, when `source` is `"usage.jsonl"`, a record supersedes an earlier one with the same `session`, `agent` and `first`; when `source` is `"chain"`, every record is kept, so the sums equal `rolesUsage`'s.
- Output `usage`: `{ source, records: <the number of counted records after those rules>, chainHead }`; `null` when `inputs.usage` is absent.
- Output `roles` has the five keys of `USAGE_ROLES`, in that order. An entry with records: `model`, `runner`, `locality`, `family` (from `inputs.routing[role]`; all `null` for the controller and without routing), `reported` (the sorted model names of its records), `requests`, `input`, `output`, `cacheRead`, `cacheWrite` (sums over its records' `models`), `activeSeconds` (the sum of non-null `activeMs`, in whole seconds; `null` when none), `outputPerActiveSecond` (`output / (activeMs sum / 1000)`, rounded to one decimal; `null` when the sum is `null` or 0), `toolCalls`, `toolErrors`, `apiErrors` (sums of the non-null values; `null` when every record's is `null`), `cost` (`null` unless the role's `runner` is `"anthropic"`; then the sum rounded to six decimals when every record has a numeric `cost`, else `null`).
- An entry without records: `model`, `runner`, `locality`, `family`, then `usage: null`, then every other field above `null`. No field is 0 for a role that has no record.
- `totals`: `requests`, `input`, `output` summed over the roles with records, and `missing`, the roles without, in `USAGE_ROLES` order. When no role has a record the three sums are `null`.
- Fixtures: `v0-8-0.expected.json` gains the `usage` (`null`), `roles` (five missing entries) and `totals` this task defines for an input with no usage. `test/fixtures/metrics/full.inputs.json` is a synthetic input with every key filled (a timeline with two rounds and an activation, routing, usage records for every role, counters, feedback, tasks, git facts); ASCII only.
- `docs/metrics.md`: the table of `## METRICS.json` gets every remaining row, so that every dotted path of the object is named, in backticks, with its source; `## Known limits` gains: `outputPerActiveSecond` is not decode speed; clean-room sums count a re-blocked agent's earlier stops again, as check 12 does, while general mode keeps the last record per transcript; `cost` is `null` for local runners and for the controller; with `activate: "none"` a model load hides inside a stage's first request and inflates `activeMs`.
- `CHANGELOG.md`, `### Added`: per-role token use, model wait time and output per active second, with a missing role reported as missing (C-01).

**Acceptance tests:** `test/metrics.mjs`: "a role's entry sums its records' models"; "outputPerActiveSecond is output over active seconds, to one decimal"; "a missing summarizer record gives usage null and totals.missing ['summarizer']" (and every token field of that entry is `null`); "a flight with no usage records has every role missing and null totals"; "cost is the sum for a role on the anthropic runner"; "cost is null for a local runner even when the records carry one"; "cost is null when one record has none"; "the controller's cost is null"; "the controller keeps the last record per session and sums across sessions"; "in general mode a later record with the same session, agent and first supersedes the earlier one"; "from the chain every role record is summed"; "an error record and an invalid record are not counted"; "usage.records counts what was summed"; "usage is null without the input"; "the v0-8-0 fixture still builds to its exact metrics"; "docs/metrics.md names every field of METRICS.json" (build the metrics from `full.inputs.json`, walk every dotted key path, an array by its element's shape and a map keyed by role, stage, runner or category by one placeholder such as `roles.<role>.requests`, and require each path in backticks in the page).

**Out of scope:** reading `usage.jsonl` or the chain (P2-06, P2-07); `compareMetrics`.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`.

**Depends on:** P2-04

### P2-06: kukulu_metrics

**Goal:** One read-only tool returns the flight's metrics, computed now from what is on disk.

**Files touched:** `mcp/server.mjs`, `test/metrics.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `docs/metrics.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-01, C-03 (where the inputs live after an archive), §3 principles 6, 7, 17. `server-synchronous`, `server-no-network`; `mcp/metrics.mjs` imports nothing from the server (the server imports it).
- Follow "Adding a tool" in CLAUDE.md: `kukulu_metrics` goes last in `TOOLS`, after `kukulu_config_show`, and last in `EXPECTED_TOOLS`; the count is 27 ("Twenty-seven tools", "twenty-seven tools"; add `27: "Twenty-seven"` to `COUNT_WORDS`); no agent and no skill gets it. Input schema `S({})`. Description: read-only; the metrics object, computed now, nothing written.
- `metricsInputs()` gathers plain data and never throws on a missing input:
  - The flight's home: when `state.archived` is set, `docs/kukulu.json` does not exist and the live state's `timeline` is absent or empty (no new flight has started), the flight is the archived one, and the state, the config and the feedback are read from `<state.archived.dir>/state.json`, `kukulu.json` and `feedback.jsonl`, the task counts from its `PROGRESS.md` and the spec from its `SPEC.md`; otherwise from `.kukulu/state.json`, `docs/kukulu.json`, `.kukulu/feedback.jsonl`, `docs/PROGRESS.md` and `docs/SPEC.md`.
  - `plugin`: `VERSION`. `flight`: the config's `flight`, else `state.archived.slug`, else `null`. `spec`: the text of the first line matching `^# ` without the marker, and the SHA-256 of the file's bytes. `caps`: the config's resolved `maxRounds` and `maxRoundsHard`, `null` when the flight's config file does not exist.
  - `routing`: `resolveRouting().roles` reduced to `{ model, runner, locality, family: familyOf(model) }`; `null` when it throws.
  - `usage`, general mode: the lines of `.kukulu/metrics/usage.jsonl` that parse (others are skipped), `source: "usage.jsonl"`, `chainHead: null`; an absent file is no records. Clean-room mode is P2-07; until then a flight with a genesis gets `usage: null`.
  - `counters`: `readCounters()`. `feedback`: the parsed entries; an absent file is `[]`. `tasks`: `counts()` of the progress file, `null` without one.
  - `git`: `mergeBase` from `git merge-base <baseBranch> HEAD`, `commits` from `git rev-list --count <mergeBase>..HEAD`, `shortstat` from `git diff --shortstat <mergeBase>..HEAD`; `null` outside a repository or without a merge base.
  - `now`: the current time. `genesis`: `null` in this task.
- `kukulu_metrics({})` first calls `status()` (so it refuses exactly what `kukulu_status` refuses) and then returns `buildMetrics(metricsInputs())`. It writes nothing and makes no commit.
- Docs: `docs/mcp-tools.md` gets a `kukulu_metrics` section after `kukulu_config_show`'s, headed like the others (arguments, the object by reference to `docs/metrics.md`, refusals, that it writes nothing); README's tool table gets its row and the count sentence; `docs/metrics.md` gains `## Reading the metrics` (the tool, and that after an archive it reads the archived flight).
- `CHANGELOG.md`, `### Added`: `kukulu_metrics` (C-01).

**Acceptance tests:** `test/protocol.mjs`: "tools/list exposes 27 tools" and the order assertion, with `kukulu_metrics` last. `test/plugin.mjs`: "the server defines twenty-seven tools"; the count-in-words and README-table assertions pass. `test/metrics.mjs`: "kukulu_metrics returns the metrics object with v 1 and the plugin version"; "it reads usage.jsonl in general mode" (a planned repository with three recorded lines: the roles and `usage.source` match); "a corrupt usage line is skipped"; "it writes nothing and moves no HEAD" (`git status --porcelain` and HEAD before and after); "in a fresh repository every sourceless field is null"; "after an archive it reads the archived state, config and feedback, and the live .kukulu/metrics/" (make an approved, implemented flight with `setState` and `markTasks`, then call `kukulu_summary_commit` and `kukulu_flight_archive`); "once the next flight's first stage has started, the live flight is read again"; "it refuses what kukulu_status refuses" (a `docs/kukulu.json` that is not JSON); "tree counts the commits since the merge base".

**Out of scope:** the chain as a source (P2-07); writing `METRICS.json` (P2-08, P2-09); `policies.metrics`.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`; `node test/protocol.mjs`; `node test/plugin.mjs`.

**Depends on:** P2-05, P1-04

### P2-07: A clean-room flight's metrics read usage from the chain only

**Goal:** In clean-room mode the metrics read usage only from the signed chain, and their per-role sums equal the verifier's recount.

**Files touched:** `mcp/metrics.mjs`, `mcp/server.mjs`, `test/metrics.mjs`, `docs/metrics.md`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-05, §3 principle 17, §9 Q9, Appendix B.5. `metrics-module-pure`, `metrics-harness-neutral`. `rolesUsage`, the verifier and `scripts/compare-bundles.mjs` do not change.
- `mcp/metrics.mjs` exports `usageFromChain(entries)` (pure): from verified chain entries it returns `{ records, chainHead }`. `chainHead` is the last entry's `hash` (`null` for no entries). A record comes from each entry whose `kind` is `usage`: for an entry whose `role` matches `^kukulu[-:](planner|implementer|reviewer|summarizer)$` the record's `role` is that role name; for an entry whose `role` is `session` and whose `data.role` is `controller` it is `controller`; any other entry gives none. The record is `data` with `session` taken from the entry and `agent` from the entry's `role` (`null` for the controller), and every field of `USAGE_KEYS` that `data` lacks filled with `null` (`v` with 1 and `harness` with `data.harness ?? "unknown"`), so an entry written by 0.8.x, whose `data` is `{ models, first, last, cost }`, still counts. An entry whose `data` holds `error` becomes the error form.
- `metricsInputs()`: the flight is clean-room when the flight's state (live, or the archived one) has `cleanroom.genesis`. Then `usage` is `{ source: "chain", ...usageFromChain(entries) }`, the entries read with `readEntries` from the live log, or from `<state.archived.dir>/cleanroom/log.jsonl` after an archive; `.kukulu/metrics/usage.jsonl` is never read, even when present. `genesis` holds the genesis entry's `data.mode` and `data.enforcement`, each key only when the entry has it. A log that cannot be read gives `usage: null` and `genesis: { mode: "clean-room", enforcement: null }`.
- `docs/metrics.md`: `## Where usage is recorded` says which source each mode reads, what `usage.chainHead` is, and that anyone holding the bundle can recompute the sums from its log; `docs/cleanroom.md` points there from the `usage` paragraph.
- `CHANGELOG.md`, `### Added`: a clean-room flight's metrics read usage only from the signed chain and record `usage.source` and `chainHead` (B-05).

**Acceptance tests:** `test/metrics.mjs`: "usageFromChain maps role agents and the controller and skips other entries"; "a 0.8.x usage entry still counts"; "chainHead is the last entry's hash"; with a bundle from `buildBundle` whose `extra` appends usage entries for three roles (two for the implementer) and a controller entry: "each role's token sums equal rolesUsage's recount of the same log" and "...and the manifest's roles.<role>.usage" (`requests`, `input`, `output`, `cacheRead`, `cacheWrite`); "kukulu_metrics in clean-room mode reports usage.source chain and the log's head"; "a stray usage.jsonl is not read in clean-room mode"; "mode and enforcement come from the genesis entry"; "after an archive the chain is read from the archived log".

**Out of scope:** adding `METRICS.json` to a bundle or its manifest (Appendix B.5); any verifier change.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`.

**Depends on:** P2-06

### P2-08: policies.metrics, and METRICS.json when kukulu_next ends or halts a flight

**Goal:** A flight that reaches `done` or `halt` through `kukulu_next` leaves `METRICS.json` beside its summary, unless `policies.metrics` is false.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `test/plugin.mjs`, `test/routing.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.2, §6 C-03, §3 principles 6, 9; CLAUDE.md "Adding a `docs/kukulu.json` key" and the notes protocol. `server-synchronous`.
- `policies.metrics`: a boolean, default `true`, written only in `cfgFrom` (`metrics: c.policies?.metrics ?? true`), added to `POLICY_KEYS` and validated as the other booleans are (`docs/kukulu.json policies.metrics must be a boolean`, and the global and profile forms through `validatePolicies`' `where`). It layers like every policy (default < global < profile < project) and appears in `kukulu_config_show`'s `policies` and `policySources`. Existing assertions that list every policy key gain `metrics`.
- `layoutFor` gains `metrics` (`docs/METRICS.json`). `archivedFiles()` gains it, so an archive moves the file when it exists.
- `recordTimeline`: when the result's stage is `done` or `halt`, this call writes at least one timeline record, and the flight's resolved `policies.metrics` is true, it builds the metrics after the state is saved (so they include the records just written) and writes them as `JSON.stringify(metrics, null, 2)` plus a newline to `docs/METRICS.json`, inside the same `withRollback`, and that path joins the commit (`chore: stage end`). A `done` or `halt` that writes no timeline record writes no file and makes no commit, so the `done` after an archive still commits nothing (0.8.1 C-01).
- A failure to build or write the file never changes the decision or the timeline: catch it, leave the timeline write as it is, and add `metricsNote: "METRICS.json was not written: <first line of the message>"` to the result; append it as a feedback entry (`stage: "controller"`, `category: "metrics"`, once per distinct message) in the same commit when `policies.feedback` is true.
- A resumed flight overwrites the file at its next write.
- Docs: `docs/operations.md`'s configuration table gets `policies.metrics` and "What the flight leaves behind" gets `docs/METRICS.json` and `.kukulu/metrics/`; `docs/mcp-tools.md` (`kukulu_next`: the file and `metricsNote`; `kukulu_flight_archive`: the file moves); `docs/metrics.md` gains `## When METRICS.json is written`.
- `CHANGELOG.md`, `### Added`: `docs/METRICS.json`, written when a flight ends or halts, and `policies.metrics` (C-03, §5.2).

**Acceptance tests:** `test/state.mjs`: "a done with an open span writes docs/METRICS.json in the chore: stage end commit" (the file is in `git show --stat HEAD`, parses, and its `outcome.verdict` is the state's); "a halt writes it too, with outcome.halted"; "a halt from a failed activation writes it, with friction.activateFailures 1"; "a done that writes no timeline record writes no file and moves no HEAD"; "kukulu_next after an archive still moves no HEAD and leaves .kukulu/state.json byte-identical" (the existing test, unchanged); "policies.metrics false writes no file"; "a METRICS.json that cannot be written is a metricsNote and the decision stands" (make `docs/METRICS.json` a directory); "a resumed flight overwrites the file"; "kukulu_flight_archive moves docs/METRICS.json". `test/routing.mjs`: "policies.metrics layers from the global file and a profile" and "a non-boolean policies.metrics is refused, naming the file". `test/plugin.mjs`: "operations.md documents policies.metrics" (in the config-keys loop's `policies` branch).

**Out of scope:** `kukulu_pr_finalize` (P2-09); committing `usage.jsonl` or the counters.

**Verification:** `kukulu_verify`; `node test/state.mjs`; `node test/routing.mjs`; `node test/plugin.mjs`.

**Depends on:** P2-06

### P2-09: METRICS.json at kukulu_pr_finalize

**Goal:** `kukulu_pr_finalize` commits the flight's metrics before it pushes, so the file reaches the pull request.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `docs/mcp-tools.md`, `docs/metrics.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-03 (the first bullet, the known limit, "No commit hashes"), Appendix B.6, §3 principle 6. `server-synchronous`; `no-sync-merge` (the `gh pr merge` argument array does not change).
- `prFinalize`, when the finalize config's `policies.metrics` is true, after every refusal that comes before a write and before the call's first push: build the metrics and write them to `METRICS.json` beside the summary, `docs/flights/<slug>/METRICS.json` when the flight is the archived one (P2-06's rule for the flight's home), else `docs/METRICS.json`, and commit that file alone as `chore: flight metrics` with stage `summarize`, through `withRollback`. With `resign: true` it is written after the signing probe and the dirty-tree refusal and before the rebase, so the rebase signs it. Each `kukulu_pr_finalize` call that reaches this point rewrites the file once (the open summarize span makes `wall.endedAt` move with every call).
- The summarizer has not stopped when this runs, so its record is missing: the committed file has `roles.summarizer.usage: null` and `totals.missing` naming it, never zeros.
- A failure to build, write or commit never changes the call's outcome: `metricsNote` on the result. No feedback entry is written here: after an archive `.kukulu/feedback.jsonl` belongs to the next flight.
- Docs: `docs/mcp-tools.md` (`kukulu_pr_finalize`: the commit, where the file goes, `metricsNote`); `docs/metrics.md`'s "When METRICS.json is written" gets this point and the known limit (the summarizer's record is missing from the committed file; in general mode `kukulu_metrics` called after the flight includes it; in clean-room mode the log has stopped at the archive, so it stays missing); `docs/operations.md`'s leftovers list names the `chore: flight metrics` commit.
- `CHANGELOG.md`, `### Added`: `kukulu_pr_finalize` commits `METRICS.json` as `chore: flight metrics` before it pushes (C-03).

**Acceptance tests:** `test/review.mjs`, with the suite's existing finalize and archive helpers (a bare origin from `mkBareRemote`, `mkFakeGhBin`): "kukulu_pr_finalize writes METRICS.json in the archived flight's directory"; "it is committed alone as chore: flight metrics before the push" (the commit's only path is the file, and `git ls-remote` on the fake remote shows a head that contains it); "a non-archived flight gets docs/METRICS.json"; "the summarizer is missing, not zero" (`roles.summarizer.usage` is `null` and `totals.missing` includes it); "wall.endedAt is the time of the call while the summarize span is open"; "policies.metrics false writes and commits nothing"; "a write failure is a metricsNote and finalize completes"; "resign rewrites the file before the rebase" (with `mkFakeGpg` and `useFakeSigner`; the metrics commit is signed afterwards); "the file holds no 40-hex string".

**Out of scope:** changing what finalize does to the pull request; the summarizer skill.

**Verification:** `kukulu_verify`; `node test/review.mjs`.

**Depends on:** P2-08

### P2-10: compareMetrics and scripts/compare-flights.mjs

**Goal:** One script prints two flights' metrics side by side in five sections, or as JSON.

**Files touched:** `mcp/metrics.mjs`, `scripts/compare-flights.mjs`, `test/metrics.mjs`, `test/fixtures/metrics/a.METRICS.json`, `test/fixtures/metrics/b.METRICS.json`, `test/fixtures/metrics/compare.expected.txt`, `test/fixtures/metrics/compare.expected.json`, `test/fixtures/metrics/README.md`, `docs/metrics.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-01, C-01 ("not recorded", "partial"), §4 boundaries, §3 principle 12. Constraints `compare-flights-imports` (the script imports only `node:` modules and `../mcp/metrics.mjs` in this task), `scripts-node-builtins`, `metrics-module-pure`, `metrics-harness-neutral`. No shebang, not executable; the CLI runs only as the entry script; it reads and prints and never writes a file. Write non-ASCII characters in script source as escapes.
- `compareMetrics(a, b)` in `mcp/metrics.mjs` (pure) returns `{ v: METRICS_VERSION, header, sections }`. `header` is `{ a, b, sameSpec }`, each side `{ flight, harness, plugin, mode, specSha256 }`, and `sameSpec` true only when both hashes are strings and equal. `sections` is an object with the keys `outcome`, `wall`, `rounds`, `roles`, `friction`, each a list of rows `{ label, a, b, diff }`:
  - `outcome`: `verdict`, `halted`, `reviews`, `fixRounds`, `approvedAtRound`, `maxRounds`, `maxRoundsHard`.
  - `wall`: `seconds`, one `stage <name>` row per stage either flight has (plan, implement, review, summarize first, others sorted), `activate <runner>` per runner either has (sorted), `idle`.
  - `rounds`: per round number either flight has, `round <n> findings`, `round <n> implementSeconds`, `round <n> reviewSeconds`.
  - `roles`: per role of `USAGE_ROLES`, the rows `<role> model`, `runner`, `family`, `requests`, `input`, `output`, `activeSeconds`, `outputPerActiveSecond`, `toolErrors`, `cost`; then `totals requests`, `totals input`, `totals output`.
  - `friction`: `feedback <category>` per category either has (sorted), `guardReblocks`, `verifyRuns`, `verifyFailures`, `tasksReopened` (from `tasks.reopened`), `activateFailures`.
  - Values: a role with `usage: null` has the string `not recorded` in its usage rows (its `model`, `runner` and `family` rows keep their values). A totals value is `{ value, partial: [roles] }` when that flight's `totals.missing` is not empty. `diff` is `b − a` when both are numbers, `"="` when both are equal non-numbers, `"differs"` when both are non-null and unequal non-numbers, and `null` when either side is `null`, `not recorded` or partial.
- `scripts/compare-flights.mjs` exports `main(argv, io)` with `io = { out, err }` as `scripts/compare-bundles.mjs` does. Usage: `node scripts/compare-flights.mjs <a> <b> [--trees <dir-a> <dir-b>] [--json]`; in this task `--trees` is parsed and answered with exit 2 and `compare-flights: --trees is not available yet` (P2-11 replaces that). `<a>` and `<b>` are each a `METRICS.json` file or a directory holding one.
- Exit 2, with one `compare-flights: …` line on `err` (and the usage text for an argument error): not exactly two positionals; an unknown option; a path that does not exist; a directory without `METRICS.json`; a file that is not JSON; a file whose `v` is not `METRICS_VERSION` (`compare-flights: <path> is metrics version <v>; this script reads version 1`). Otherwise exit 0.
- Text output: a header naming each flight's slug, harness names and versions, plugin version, mode and the first twelve characters of its spec hash, one line per flight starting `A: ` and `B: `; when `sameSpec` is false, the line `the two flights were built from different specs; the comparison below is not like for like`; then the five sections under the titles `Outcome`, `Wall time`, `Rounds`, `Roles`, `Friction`, one row per line with the label, A, B and the difference in aligned columns, a blank line after each section. `null` prints as `n/a`, a partial total as `<value> partial (<roles> not recorded)`, a numeric difference with its sign.
- `--json` prints `JSON.stringify(compareMetrics(a, b), null, 2)` and a newline instead.
- Fixtures: `a.METRICS.json` (general mode, the `anthropic` runner for every role, three rounds, every role recorded) and `b.METRICS.json` (clean-room, a local runner for the implementer and reviewer, one activation, the summarizer missing, a different spec hash), both valid outputs of `buildMetrics`; `compare.expected.txt` and `compare.expected.json` are the exact outputs. ASCII only.
- Docs: `docs/metrics.md` gains `## Comparing two flights` (usage, the sections, `not recorded`, `partial`, the differing-spec line, exit statuses); README's repo layout lists the script and its Documentation map entry for `docs/metrics.md` mentions the comparison.
- `CHANGELOG.md`, `### Added`: `scripts/compare-flights.mjs` (D-01).

**Acceptance tests:** `test/metrics.mjs`: "compareMetrics is pure and returns the five sections"; "a numeric row's diff is b minus a"; "a missing role is not recorded and its diff is null"; "a total that leaves a role out is partial"; "compare-flights prints the exact text for the two fixtures" (`compare.expected.txt`); "--json prints compareMetrics' exact object" (`compare.expected.json`); "a directory holding METRICS.json is read"; "different spec hashes print the not-like-for-like line" and "the same spec prints no such line" (compare `a` with itself); each exit-2 case by its message ("one argument", "an unknown option", "a missing path", "a directory without METRICS.json", "a file that is not JSON", "a wrong version"); "compare-flights writes no file" (the fixture directory's listing is unchanged).

**Out of scope:** `--trees` (P2-11); comparing more than two flights; any change to `scripts/compare-bundles.mjs`.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`.

**Depends on:** P2-05

### P2-11: compare-flights --trees

**Goal:** With `--trees`, the comparison adds the size and the similarity of the two result trees.

**Files touched:** `scripts/compare-flights.mjs`, `test/metrics.mjs`, `test/fixtures/metrics/compare-trees.expected.txt`, `docs/metrics.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-01 (the sixth section), §4 boundaries. `compare-flights-imports`: the one added import is exactly `import { scorePair } from "../mcp/cleanroom.mjs";`.
- `--trees <dir-a> <dir-b>`: both must be directories, else exit 2 with `compare-flights: <path> is not a directory`. Each tree is walked in sorted order, skipping directories named `.git`, `node_modules` and `target`; a file is read when its extension is in the script's own extension-to-language map and it holds no NUL byte, as `scripts/compare-bundles.mjs`'s `readTree` does. The map is a copy of `DEFAULT_SIMILARITY_LANGUAGES` in `mcp/server.mjs` (the script may not import the server); a test keeps the two equal.
- The scorer is `scorePair(left, right, {})`, with its own default parameters.
- The sixth section, titled `Trees`: `files` and `lines` (per tree, with the difference) and one row per `scorePair` metric with its value to four decimals. A tree with no scorable file gives exit 2 with `compare-flights: <path> has no file with a known source extension`.
- With `--json`, the object gains `trees: { a: { files, lines }, b: { files, lines }, similarity: { <metric>: <score> } }`.
- `docs/metrics.md`'s comparison section documents `--trees`. `CHANGELOG.md`, `### Added`: `compare-flights --trees` (D-01).

**Acceptance tests:** `test/metrics.mjs`: "--trees on test/fixtures/similarity/a and b prints the exact sixth section" (`compare-trees.expected.txt`); "--trees scores a tree against itself at 1.0000"; "--trees skips .git, node_modules and target" (a temp copy with a file under each: the counts do not change); "--json carries trees"; "a --trees path that is not a directory is exit 2"; "a tree with no source file is exit 2"; "--trees with one directory is exit 2"; "the script's language map equals the server's DEFAULT_SIMILARITY_LANGUAGES" (read from the two sources' text).

**Out of scope:** similarity configuration; reading a bundle.

**Verification:** `kukulu_verify`; `node test/metrics.mjs`.

**Depends on:** P2-10

### P2-12: Phase 2 end: push and record the manual check

**Goal:** Push the branch and record Phase 2's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P2-12: Phase 2 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): node scripts/compare-flights.mjs on two real flights of one spec prints all five sections with no null in the Anthropic flight's cost column (see PLAN.md Spec issues: this Claude Code version's transcripts carry no per-row cost, so the column is expected to read n/a until the owner rules)`.

**Depends on:** none

## Phase 3 — Local runners, documentation and release

### P3-01: MODEL_FAMILIES gains laguna

**Goal:** A Laguna or Poolside model string resolves to the family `laguna`.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/families.json`, `test/cleanroom.mjs`, `docs/spikes/P3-01.md`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-03; the table stays an ⚠️ ASSUMPTION written only in `mcp/cleanroom.mjs`; CLAUDE.md "Tuning an assumption". `cleanroom-module-pure`, `server-synchronous`. Editing `mcp/cleanroom.mjs` runs both guard self-tests through `kukulu_verify`.
- `MODEL_FAMILIES` gains `{ family: "laguna", pattern: /laguna|poolside/ }` as its last entry, so no existing string changes family. Nothing else in the module changes.
- `test/fixtures/families.json` gains the rows `{ "model": "poolside/laguna-1", "family": "laguna" }`, `{ "model": "spark/laguna-xl-nvfp4", "family": "laguna" }` and `{ "model": "spark/poolside-malibu-2", "family": "laguna" }` (`normalizeModel` strips every leading `<segment>/`, so the name must survive that), in the file's one-space-indented style.
- Before and after: run the fixture table against `familyOf` before the change (every existing row resolves as recorded; the three new strings read `unknown:<normalized string>`) and after (all rows resolve). `docs/spikes/P3-01.md` (markdownlint-clean) records the method and both results, and the commit body's `Measurement:` line and the progress log carry them.
- `docs/cleanroom.md`: where the families are listed, add `laguna`. `CHANGELOG.md`, `### Added`: the model family `laguna` (E-03).

**Acceptance tests:** `test/cleanroom.mjs`: the existing families-fixture assertion covers the new rows; add "laguna is the last family, so no earlier pattern changes" and "a string naming both qwen and laguna stays qwen" (the first match wins).

**Out of scope:** any other family; `scripts/verify-attestation.mjs`; the guard.

**Verification:** `kukulu_verify` (runs both guard self-tests); `node test/cleanroom.mjs`.

**Depends on:** none

### P3-02: Templates: a spark profile with activation, and a llama-swap example

**Goal:** The templates show a fully local flight on one inference host: a runner that is warmed, a profile on it, and a proxy configuration with a resident and a swapping group.

**Files touched:** `templates/kukulu.config.example.json`, `templates/runners/llama-swap.example.yaml`, `test/routing.mjs`, `test/plugin.mjs`, `docs/routing.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-02. The YAML passes `yamllint` under `.yamllint.yaml` (two-space indentation, lines of at most 160 characters) through `pre-commit run --all-files`.
- `templates/kukulu.config.example.json`: the `spark` runner gains `"activate": "warm"`; `profiles` gains `"spark": { "planner": { "model": "spark/qwen38-27b" }, "implementer": { "model": "spark/qwen38-27b" }, "reviewer": { "model": "spark/nemotron-3.5-super-nvfp4" }, "summarizer": { "model": "spark/nemotron-3.5-super-nvfp4" } }` (families `qwen` and `nemotron`). Nothing else changes. Where `docs/routing.md` shows the file's `profiles`, add the `spark` profile there too.
- `templates/runners/llama-swap.example.yaml`, with this content (comments may be reworded, keys and values not):

```yaml
# Example llama-swap configuration for one inference host serving a flight.
# Checked against llama-swap v272 (2026-11-10), docs/config.example.yaml.
# A model id below is what a runner asks for: with match ["spark/"], the role
# model spark/qwen38-27b is served as qwen38-27b (or name it in servedAs).
---
# Seconds a model may take to become ready; keep it above the slowest cold load.
healthCheckTimeout: 1800

models:
  # Stays resident: the controller session and the harness's small-model calls.
  "resident-small":
    cmd: |
      llama-server --port ${PORT}
      --model /models/resident-small.gguf
  # The two stage models that cannot be resident together.
  "qwen38-27b":
    cmd: |
      llama-server --port ${PORT}
      --model /models/qwen38-27b.gguf
  "nemotron-3.5-super-nvfp4":
    cmd: |
      llama-server --port ${PORT}
      --model /models/nemotron-3.5-super-nvfp4.gguf

routing:
  router:
    use: group
    settings:
      groups:
        # Resident group: no other group can unload it.
        "resident":
          persistent: true
          swap: false
          exclusive: false
          members:
            - "resident-small"
        # Swapping group: one member at a time; loading one unloads the other
        # and leaves the resident group alone.
        "stages":
          swap: true
          exclusive: false
          members:
            - "qwen38-27b"
            - "nemotron-3.5-super-nvfp4"
```

- README's repo layout lists `templates/runners/`. `CHANGELOG.md`, `### Added`: the `spark` profile with `activate: "warm"` and `templates/runners/llama-swap.example.yaml` (E-02).

**Acceptance tests:** `test/routing.mjs`: the existing "the template loads" assertions keep passing; add "the template's spark runner is warmed", "the spark profile routes all four roles to the spark runner" (with `KUKULU_PROFILE=spark`, through `kukulu_config_show`: runner `spark`, served ids `qwen38-27b` and `nemotron-3.5-super-nvfp4`), "the spark profile's implementer and reviewer are different families" (`familyOf`). `test/plugin.mjs`: "the llama-swap template names the release it was checked against" (its second line matches `Checked against llama-swap v\d+`), "...has a persistent group and a swapping group", "...and its stage model ids are the spark profile's served ids".

**Out of scope:** running llama-swap; any other proxy's template; a YAML parser (the tests read the file as text).

**Verification:** `kukulu_verify`; `node test/routing.mjs`; `node test/plugin.mjs`.

**Depends on:** P1-02

### P3-03: docs/local-runners.md

**Goal:** One page tells an operator how to run a fully local flight on one inference host, resident or swapping.

**Files touched:** `docs/local-runners.md`, `docs/routing.md`, `README.md`, `test/plugin.mjs`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-01, A-03 ("The limit this cannot remove"), §2 non-goals (Kūkulu starts, stops and swaps nothing). Every external fact is cited with a link, and only the facts below are stated about other software; do not add one from memory. The implementer cannot browse: these were read on 2026-11-13 from the pages named.
- Claude Code's variables, from `https://code.claude.com/docs/en/env-vars` unless another page is named: `ANTHROPIC_BASE_URL` ("Override the API endpoint to route requests through a proxy or gateway"); `ANTHROPIC_AUTH_TOKEN` (the value of the `Authorization` header, sent with a `Bearer` prefix); `ANTHROPIC_API_KEY` (sent as the `X-Api-Key` header); `ANTHROPIC_MODEL` (the model setting to use; `https://code.claude.com/docs/en/model-config`); `ANTHROPIC_DEFAULT_HAIKU_MODEL` (the model id the `haiku` alias resolves to, "also used for background functionality"), `ANTHROPIC_DEFAULT_SONNET_MODEL` and `ANTHROPIC_DEFAULT_OPUS_MODEL` (the ids those aliases resolve to); `ANTHROPIC_SMALL_FAST_MODEL` (deprecated in favor of the haiku variable); `CLAUDE_CODE_SUBAGENT_MODEL` (the default model for subagents not assigned one another way; an agent definition's own `model` wins over it); `API_TIMEOUT_MS` (how long each API request attempt has to receive its response headers; default 600000 ms, 10 minutes); `MCP_TOOL_TIMEOUT` and the per-server `timeout` of `.mcp.json` (the plugin sets its own, 24 hours); `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (set to any non-empty value to disable auto-updates, telemetry and error reporting).
- Also cite `https://code.claude.com/docs/en/llm-gateway`: Anthropic "doesn't support routing Claude Code to non-Claude models through any gateway", so a local flight is the operator's own setup.
- llama-swap, from `https://github.com/mostlygeek/llama-swap` at release v272: it serves the Anthropic endpoint `v1/messages` and lists models at `v1/models`; `healthCheckTimeout` is the number of seconds to wait for a model to be ready; a group's `swap`, `exclusive` and `persistent` fields decide what stays loaded.
- Sections, in this order: `## Direct mode` (no router on the workstation: launch the harness with `ANTHROPIC_BASE_URL` at the runner and a credential variable, route roles to model strings the runner's proxy accepts, with a worked example using `templates/kukulu.config.example.json`'s `spark` profile and `KUKULU_PROFILE=spark`); `## Resident and swapping layouts` (two models resident together need no swap; two that cannot be need a model-swapping proxy on the inference host; point at `templates/runners/llama-swap.example.yaml`); `## The controller rule` (the probe makes the proxy load the stage's model, the controller's next request goes to the controller's model, so with a swapping layout the controller and the harness's small-model calls run on a model that stays resident: set the session's model and the haiku variable to it); `## Timeouts` (`API_TIMEOUT_MS` and the MCP timeout must both exceed the slowest load; `activateTimeoutMs` must sit below the MCP timeout; the proxy's own readiness timeout must exceed the load too); `## What activation measures` (the wait in the timeline and `METRICS.json`'s `wall.activateSeconds`; with `activate: "none"` a load hides inside the first request of a stage and inflates `activeMs`); `## A smoke test before a flight` (`node scripts/runner-probe.mjs --endpoint … --models`, then `--warm <id>`; a session that runs a tool loop; one Kūkulu tool call such as `kukulu_config_show`; a look at the proxy's log for which model ids the harness asks for during a stage).
- Write the display name with its macron in prose; write "24 hours", never the limit in milliseconds (`no-hardcoded-mcp-timeout` scans `docs/`); "patent pending" if the patent is mentioned at all.
- Link the page from `docs/routing.md` (the Runners section and "Starting points") and from README's Documentation map. `CHANGELOG.md`, `### Added`: `docs/local-runners.md` (E-01).

**Acceptance tests:** `test/plugin.mjs`: "docs/local-runners.md has its six sections" (the headings above, in order); "...cites a page for every Claude Code variable it names" (every backticked `ANTHROPIC_…`, `API_TIMEOUT_MS`, `MCP_TOOL_TIMEOUT` and `CLAUDE_CODE_…` name sits in a paragraph or list item that holds an `https://code.claude.com/docs/` link); "...points at the llama-swap template and the spark profile"; "...is linked from docs/routing.md"; the existing "every document in docs/ is linked from the README" and "every relative link in the documentation resolves" pass.

**Out of scope:** OpenCode, Codex or any second harness; a router on the workstation (that is `docs/routing.md`'s claude-code-router section); any code.

**Verification:** `kukulu_verify`; `node test/plugin.mjs`.

**Depends on:** P3-02

### P3-04: Documentation sweep for 0.9.0

**Goal:** Every document SPEC §6 F names says what 0.9.0 does, with no requirement left undocumented.

**Files touched:** `docs/mcp-tools.md`, `docs/metrics.md`, `docs/operations.md`, `docs/architecture.md`, `README.md`, `CONTRIBUTING.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 F, §3 principles 7, 14, §1 ("Why a minor version"). Earlier tasks documented their own changes; this task reads the result as a whole and fills what is missing. It changes no code.
- Check, and fix where short: `docs/mcp-tools.md` has `kukulu_metrics`; `kukulu_next` covers activation, the halt, `activation`, `metricsNote` and the timeline's `activate` record; `kukulu_status` covers `counters`, `harness` and `activateSeconds` in its Returns table; `kukulu_config_show` covers `activate`, `served` and the runner keys; `kukulu_run_start` covers the `.kukulu/metrics/` exclusion and the lock's `total`. `docs/metrics.md` covers the usage record, every `METRICS.json` field and its source, and the known limits (B-03's, what `activeMs` includes, the summarizer's record, the clean-room and general-mode difference on repeated stops, cost). `docs/operations.md` covers the runner keys, `policies.metrics`, the runner halt, and "What the flight leaves behind". `docs/architecture.md` shows activation in the stage loop and `.kukulu/metrics/` and `docs/METRICS.json` in "State on disk" and "Who may write what" (the logger writes `usage.jsonl`, the server the counters and `METRICS.json`). `CONTRIBUTING.md` has the `metrics` row and lists `mcp/metrics.mjs`, `scripts/runner-probe.mjs` and `scripts/compare-flights.mjs` in its layout.
- README: the feature list gains one item on runner comparison metrics (usage in every mode, activation, `METRICS.json`, `compare-flights`); "Files the pipeline owns" lists `docs/METRICS.json` and `.kukulu/metrics/`; a short `## Upgrading to 0.9.0` after the 0.7.0 one, with SPEC §1's five points (the logger on `Stop` and what it now writes; a clean-room flight started on 0.8.x cannot continue; the four runner keys; `kukulu_next` can take as long as a model load and can halt; the new files; the new refusal). The existing `## Upgrading to 0.7.0` section stays.
- Never write "patented"; A-03 is described as patent pending where the patent is mentioned.

**Acceptance tests:** `test/plugin.mjs`: "mcp-tools documents counters, harness and activateSeconds in kukulu_status"; "mcp-tools documents activation and metricsNote in kukulu_next"; "README has a 0.9.0 upgrade paragraph" (naming the `Stop` hook, the four runner keys, `METRICS.json` and `.kukulu/metrics/`); "README's file list names docs/METRICS.json"; "architecture.md shows activation in the stage loop"; "operations.md lists METRICS.json among what a flight leaves behind"; the existing documentation assertions (links, tool names, config keys, display name) pass.

**Out of scope:** any code change; `site/`; the version number and the changelog heading (P3-05).

**Verification:** `kukulu_verify`; `node test/plugin.mjs`.

**Depends on:** none

### P3-05: CHANGELOG 0.9.0 and the version

**Goal:** The release reads 0.9.0 everywhere and the changelog entry is complete.

**Files touched:** `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `mcp/server.mjs`, `README.md`

**Design constraints:**

- SPEC §1 ("the version reads 0.9.0 everywhere"), §6 F.
- Rename `## [Unreleased]` to `## [0.9.0] — <today>` with `### Added` and `### Changed` only, no Breaking changes heading. Read the lines earlier tasks added; fill any gap so every §6 requirement (A-01 to A-04, B-01 to B-05, C-01 to C-04, D-01, E-01 to E-03) has a line and `### Changed` carries §1's upgrade points. Never write "patented".
- `0.9.0` in `package.json`, `.claude-plugin/plugin.json`, `VERSION` in `mcp/server.mjs`, and README's version badge (`version-0.9.0`, alt `Version 0.9.0`). The tool count stays twenty-seven.
- `METRICS.json`'s `plugin` field follows `VERSION`; a fixture that pins the plugin version in an expected file is updated in this task.

**Acceptance tests:** `test/plugin.mjs`'s existing "package.json and plugin.json agree on the version", "the MCP server reports the plugin's version" and "CHANGELOG.md's newest entry is the package version"; `node test/metrics.mjs` still passes.

**Out of scope:** tagging, publishing or merging (that is `kukulu_release`, run by the owner after the merge).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-06: Phase 3 end: push and record the manual checks

**Goal:** Push the release branch and record Phase 3's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 3, §1 (Done means). No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P3-06: Phase 3 end: push and record the manual checks`. The handoff written for `kukulu_run_finish` has no "do not merge" line and lists the manual checks of all four phases.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs; merging; releasing.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): the commands in docs/local-runners.md start a fully local session against the owner's inference host`.

**Depends on:** none

## Spec issues

- §6 B-01 says the adapter "skips rows with `isSidechain: true`". In Claude Code 2.1.304 to 2.1.325 every row of a subagent's own transcript carries `isSidechain: true`, so an unconditional skip would leave every stage with no usage at all. Resolution: the skip applies to the controller record only (P0-04). The owner should confirm and reword B-01.
- §6 B-01 defines `activeMs` by "the row before its first row". Real transcripts hold bookkeeping rows between messages, and an `attachment` row often carries the response's own timestamp. Resolution: only `user` and `assistant` rows with a timestamp count as rows (P0-02).
- §6 B-01's `cost` is the sum of the rows' `costUSD`. None of 368 local transcripts has a `costUSD` on any row; this Claude Code version records cost only in a session-wide `cost-state` row (`totalCostUSD`, `modelUsage`), which cannot be split by role. As specified, `cost` will be `null` for every role, and Phase 2's manual check ("no `null` in the Anthropic flight's cost column") cannot pass. Proposed: the owner decides between pricing tokens from a rate table (a new ⚠️ ASSUMPTION) and reading `cost-state` for the controller session only. Not built here.
- §6 B-01 keeps the counting rules unchanged, so an API-error row (`message.model` `"<synthetic>"`, with a usage of zeros) is still counted as a request and `<synthetic>` shows in `reported`, in 0.8.x bundles as well. Proposed for a later release: do not count a flagged row as a request.
- §6 B-01's test list ends with "both copies of the adapter producing identical output (principle 13)", and §9 Q5 says "A second hook script"; principle 13 and §9 Q10 say there is one copy and no new script. Resolution: one copy; the test is replaced by the general-mode line and the chain entry carrying the identical record (P0-03).
- §6 B-05 requires the metrics' sums to equal `rolesUsage`'s recount, and `rolesUsage` adds every `usage` entry of a role. An implementer the guard pushes back stops again, and each stop's record covers its whole transcript, so clean-room sums (and 0.8.x bundles' `roles.<role>.usage`) count earlier stops again. The plan keeps the equality in clean-room mode and supersedes repeated stops in general mode, which makes the two modes differ whenever the guard re-blocked; `friction.guardReblocks` shows when. Proposed for a later release: the same supersede rule in both copies of `rolesUsage`.
- §5.5 places the `activateTimeoutMs` default "on the line where `loadGlobalConfig` applies a runner's defaults" and §6 A-02 says `loadGlobalConfig` validates the keys. Neither happens there today (`validateRunners`, called by `resolveRouting`, validates; `runnerFor` resolves). Moving validation into `loadGlobalConfig` would make every tool that reads policies refuse on a bad runner. Resolution: the keys are validated in `validateRunners` and defaulted in `runnerFor`.
- §6 A-02 lists no refusal for `activate: "warm"` on a runner with no `endpoint`. Resolution: refused when the config loads (P1-02).
- §6 A-03 step 3 runs a second probe after a failure with no stated bound; with a runner that accepts and never answers it would double the wait. Resolution: the listing is capped at 10 s (P1-04).
- §5.4 has only `kukulu_run_start` add the exclusion, but the planner's record and a plan-stage activation failure are written before any run starts, and nothing says when `.kukulu/metrics/` is emptied between flights. Resolution: `kukulu_next` adds the exclusion too and empties the directory at a flight's first timeline record (P0-03).
- §3 principle 6 wants "one feedback entry" for every measuring failure. A feedback entry needs a commit, `kukulu_verify` makes none, and a commit after the task's own would make `kukulu_task_done` refuse. Resolution: the note is always in the result; the entry is written only by calls that already commit.
- §3 principle 15 says "Three are added" to the constraints. The plan adds those three and three more that make §3 principle 2 and §4's import boundaries mechanical, because the plan-build rules require every line-expressible constraint to be data.
- §6 C-01 says `cost` is `null` "unless the role's runner is `anthropic`"; the controller has no runner in routing, so its `cost` is always `null`. The owner may want the controller's runner recorded some other way.
- §6 C-01's example for the recorded-flight test names `docs/flights/v0-8-0/`, whose state has no timeline (0.8.0 introduced it), so that fixture exercises the `null` wall fields; timelines are covered by synthetic inputs.
- §6 E-01 asks for links to pages the implementer cannot open. The planner read them on 2026-11-13 and P3-03 carries the facts and URLs; they should be re-checked before release.
