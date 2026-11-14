# Kūkulu 0.9.0 — Specification

Version: 0.9.0 Status: approved for build (owner, 2026-11-13)

The Kūkulu planner reads this file in full and derives the build plan from it. The 0.8.1 spec is archived at [flights/v0-8-1/SPEC.md](flights/v0-8-1/SPEC.md); ids written `0.8.1 D-02` or `0.8.0 D-01` refer to the archived specs. This spec is written against `main` at 0.8.1 (merged 2026-11-13 as `08452e9`): global and profile `policies`, the `.mcp.json` timeout and the Agent call's `description` all exist.

**Scope change.** 0.8.1 §2 and §9 question 1 gave 0.9.0 to OpenCode. Owner decision of 2026-11-12: 0.9.0 is runner comparison metrics. OpenCode as a second harness moves to 0.10.0, and Codex possibly to 0.11.0. This release builds the measurements those harnesses will be compared with, in a shape that does not depend on Claude Code.

This release makes two flights of one spec comparable:

- **Usage in every mode.** Token use and model wait time per role, the controller included, recorded in a harness-neutral record.
- **Runner activation.** Before a stage starts, the server proves the stage's runner serves the stage's model, waits while a swapping proxy loads it, and records how long that took.
- **Metrics.** Every flight ends with `METRICS.json`: time, tokens, review rounds and friction, keyed by role, runner and model.
- **Comparison.** `scripts/compare-flights.mjs` prints two flights side by side and can score their result trees against each other.
- **Local runners.** Documentation and templates for serving roles from one machine, with models resident together or swapped.

## Recommendation on size

One flight (`flight=v0-9-0`), four phases, all serial. Each requirement names its module, its refusal text where it has one, and its tests.

## 1. Overview

Kūkulu is a Claude Code plugin. A dependency-free MCP server (`mcp/server.mjs`) holds the mechanics, and the skills (`skills/*/SKILL.md`) hold the judgment. Release 0.9.0 adds what an operator needs to run one spec through two flights on different runners and compare them: speed, cost, review rounds, friction and the resulting code.

Done means:

- every requirement in §6 has its tests;
- `npm run lint`, `pre-commit run --all-files`, `npm test`, `npm run check:site` and the guard self-test pass;
- the version reads 0.9.0 everywhere;
- a draft PR is open against `main`.

**Why a minor version.** One tool is added (`kukulu_metrics`). No tool's input schema loses or renames a field. These change for someone upgrading:

- **Hooks.** `hooks/hooks.json` registers `scripts/usage-log.mjs`, and `scripts/cleanroom-log.mjs` handles `Stop`. Gate check 3 pins both, so a clean-room flight started on 0.8.x cannot continue on 0.9.0.
- **New optional runner keys.** `activate`, `activateTimeoutMs`, `servedAs` and `tokenEnv` (§5.1).
- **`kukulu_next`.** It can now take as long as a model load, and it can return a `halt` for a runner that does not answer (A-03).
- **New files.** `docs/METRICS.json` (committed) and `.kukulu/metrics/` (excluded per clone, never committed).
- **New refusal.** An `activateTimeoutMs` at or above the MCP timeout (A-02).

**Patent note.** The owner decides whether activation timing in the signed chain (A-03) or the harness-neutral usage record (B-01) goes beyond U.S. Provisional Application No. 64/178,095, and marks the section `⚠️ NEW MATTER` if so. Write "patent pending", never "patented".

## 2. Goals and non-goals

- Goal: every flight, clean-room or general, records token use and model wait time per role and for the controller session (B-01 to B-04).
- Goal: the usage record has one schema, filled by one adapter per harness. Claude Code's adapter is the only one this release ships (B-01).
- Goal: before a stage starts on a runner that asks for it, the server sends that runner one small request naming the stage's model, waits for the answer, and records the wait (A-01 to A-03).
- Goal: a runner that does not serve the stage's model halts the flight before the stage, with a reason that names what the runner does serve (A-03, A-04).
- Goal: a flight that reaches `done` or `halt` leaves `METRICS.json` beside its summary (C-01 to C-03).
- Goal: the metrics name the harness and its version, taken from the MCP `initialize` request (C-04).
- Goal: `scripts/compare-flights.mjs` compares two flights' metrics and, with `--trees`, their result trees (D-01).
- Goal: the docs and templates cover a fully local flight on one inference host, resident and swapping (E-01 to E-03).
- Non-goal: running under OpenCode or Codex. That is 0.10.0 and later. This release ships no second adapter and no fake second harness.
- Non-goal: scraping an inference engine's own `/metrics` endpoint. The Anthropic runner has none, so a measure taken there cannot be compared across runners. Deferred.
- Non-goal: grading a flight's output. Held-out tests, conformance scoring and energy cost are the operator's, outside the pipeline.
- Non-goal: starting, stopping or swapping models. Kūkulu sends a request and waits. Loading and unloading belong to the proxy on the inference host (E-01).
- Non-goal: MCP progress notifications (0.8.1 §9 question 5). Still deferred.
- Non-goal: strategy goals G-11 to G-14 and the 0.8.0 REVIEW's open spec issues. The owner assigns them a release (§9 question 1).
- Non-goal: any change to `scripts/compare-bundles.mjs`, the verifier's checks, or `site/`.

## 3. Engineering principles

Each is checkable by grep or test. Those marked `[rule:<id>]` are `constraints` in `docs/kukulu.json`. The rest are checked by the reviewer, by reading.

1. **Mechanics live in the server, judgment in the skills.** Activation, counters and metrics are server and hook changes with tests. No skill computes or reports a number.
2. **One usage record, one adapter per harness.** Everything that knows a harness's transcript format lives in a function named `usageFrom<Harness>`. `mcp/metrics.mjs` never reads a transcript and never names a harness in a condition.
3. **`mcp/metrics.mjs` is pure and synchronous**: `node:` imports only, no child process, no `process.exit`, no console `[rule:metrics-module-pure]`.
4. **The server stays synchronous and opens no socket.** Network I/O happens only in `scripts/runner-probe.mjs`, run through `spawnSync`. `mcp/server.mjs` imports none of `node:http`, `node:https`, `node:net` or `node:dgram` `[rule:server-no-network]`. `[rule:server-synchronous]` carries over.
5. **The server never calls the `anthropic` runner.** No probe, no warm request and no key. A test asserts that no probe runs for a role on it.
6. **Measuring never stops a flight.** A failure to read usage, write a counter or build metrics becomes a note in the tool's result and one feedback entry. The one halt this release adds is a runner that does not serve its model (A-03).
7. **A number with no source is `null`, never 0.** `docs/metrics.md` names, for every field of `METRICS.json`, the file and field it is derived from.
8. **Hooks never dirty the tracked tree.** `scripts/usage-log.mjs` and the counters write only under `.kukulu/metrics/`, which `.git/info/exclude` names. This is the lesson of project-g F-16 and F-17.
9. **Tools validate, then mutate**, and config never silently defaults a bad value: every new runner key has a refusal for every bad shape, and the unknown-key refusals stay.
10. **Every server behavior change has a test** in the suite that owns the tool (CONTRIBUTING.md's table). `test/metrics.mjs` is new and gets a row. Every new refusal has a test that triggers it and asserts its message.
11. **Tests need no GPU, model or second machine.** Probe tests run against a `node:http` server the test starts. One opt-in step, `KUKULU_RUNNER_IT=1`, uses a real endpoint and is never part of `kukulu_verify`.
12. **No dependencies anywhere.** Every `scripts/*.mjs` imports only `node:` built-ins or sibling files `[rule:scripts-node-builtins]`.
13. **Pinned scripts keep their own copy.** Gate check 3 pins each hook script by hash, so `usageFromClaudeCode` exists in both `scripts/cleanroom-log.mjs` and `scripts/usage-log.mjs`. A test feeds both the same fixture and asserts identical output.
14. **Documentation moves with the code** (0.8.1 principle 8, unchanged).
15. **Every constraint in `docs/flights/v0-8-1/kukulu.json` carries over unchanged.** Three are added (§5.5).
16. **Error messages are written for a model**: say what is wrong and what to do instead.

## 4. Architecture

| Path | Changes |
|---|---|
| `mcp/metrics.mjs` (new) | Pure: `METRICS_VERSION`, `buildMetrics(inputs)`, `validateUsageRecord(record)`, `compareMetrics(a, b)` |
| `mcp/server.mjs` | `RUNNER_KEYS` and runner validation (A-02); `servedId`, `activateRunner`, `next`'s activation step (A-03, A-04); counters (C-02); `metrics` tool and the write at `done` and `halt` (C-01, C-03); `initialize` keeps `clientInfo` (C-04); `status` reports `counters`, `harness` and `activateSeconds`; `configShow` reports the new runner keys |
| `mcp/cleanroom.mjs` | `MODEL_FAMILIES` gains `laguna` (E-03); a `stage` entry's `data` may carry `activate` (A-03) |
| `scripts/runner-probe.mjs` (new) | One HTTP request to a runner, one JSON line out (A-01) |
| `scripts/usage-log.mjs` (new) | `SubagentStop` and `Stop` hook: appends a usage record to `.kukulu/metrics/usage.jsonl` (B-02, B-03) |
| `scripts/cleanroom-log.mjs` | `usageFromClaudeCode` with the new fields; a `usage` entry on `Stop` for the controller (B-01, B-03) |
| `scripts/implement-guard.mjs` | A cumulative re-block count beside the resetting one (C-02) |
| `scripts/compare-flights.mjs` (new) | Two flights side by side; `--trees`; `--json` (D-01) |
| `hooks/hooks.json` | `usage-log.mjs` on `SubagentStop` and `Stop` |
| `skills/go-flight/SKILL.md` | Prints `kukulu_next`'s `activation` line |
| `templates/kukulu.config.example.json`, `templates/runners/llama-swap.example.yaml` (new) | E-02 |
| `docs/metrics.md` (new), `docs/local-runners.md` (new), `docs/routing.md`, `docs/operations.md`, `docs/mcp-tools.md`, `docs/architecture.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | As each requirement says |
| `test/metrics.mjs` (new), `test/routing.mjs`, `test/state.mjs`, `test/guard.mjs`, `test/cleanroom.mjs`, `test/plugin.mjs`, `test/fixtures/transcripts/` | Tests and fixtures |

Boundaries the reviewer enforces: `mcp/metrics.mjs` imports nothing from `mcp/server.mjs`. `scripts/compare-flights.mjs` imports only `mcp/metrics.mjs` and `scorePair` from `mcp/cleanroom.mjs`. `scripts/runner-probe.mjs` imports no sibling file.

## 5. Data and configuration

### 5.1 The global file: runner keys

`RUNNER_KEYS` gains four optional keys. All are refused on a runner named `anthropic`, which stays reserved.

| Key | Type | Default | Notes |
|---|---|---|---|
| `runners.<name>.activate` | `"none"` \| `"warm"` | `"none"` | A-02. `"warm"` makes `kukulu_next` send one request before each stage on this runner |
| `runners.<name>.activateTimeoutMs` | integer ≥ 1000 | 1200000 | ⚠️ ASSUMPTION (§5.6). Refused at or above the MCP timeout |
| `runners.<name>.servedAs` | object | none | Exact role model string → the model id the endpoint serves. Without an entry the id is the model string with its matched `match` prefix removed (A-02) |
| `runners.<name>.tokenEnv` | string, `/^[A-Z][A-Z0-9_]*$/` | none | Name of an environment variable holding the runner's API token. The token itself is never written to config, state, the log or a result |

### 5.2 `docs/kukulu.json`

| Key | Type | Default | Notes |
|---|---|---|---|
| `policies.metrics` | boolean | `true` | C-03. `false` writes no `METRICS.json`. Layerable in the global file and a profile (0.8.1 D-02) |

### 5.3 `.kukulu/state.json`

| Field | Meaning |
|---|---|
| `harness` | `[{ name, version }]`: each distinct `clientInfo` an `initialize` request carried during the flight, in first-seen order (C-04) |
| `timeline[]` | May hold `{ event: "activate", stage, round, runner, served, ms, ok, at }` records between spans (A-03) |

### 5.4 `.kukulu/metrics/` (excluded per clone, never committed)

| File | Writer | Content |
|---|---|---|
| `usage.jsonl` | `scripts/usage-log.mjs` | One usage record per line (B-01) |
| `counters.json` | the server | `{ verifyRuns, verifyFailures, guardReblocks, tasksReopened, activateFailures }` (C-02) |

`kukulu_run_start` adds `.kukulu/metrics/` to `.git/info/exclude`, the way `kukulu_agents_sync` excludes the generated agents.

### 5.5 Constraints

The constraints in `docs/flights/v0-8-1/kukulu.json` carry over unchanged (principle 15). Three are added:

- `metrics-module-pure`: `mcp/metrics.mjs` has no `process.exit`, no console call, no `child_process` and no import outside `node:`. The pattern is `cleanroom-module-pure`'s, with the path changed.
- `server-no-network`: `mcp/server.mjs` has no import of `node:http`, `node:https`, `node:net` or `node:dgram`, with or without the `node:` prefix.
- `no-hardcoded-activate-timeout`: `1200000` appears once in `mcp/server.mjs`, on the line where `loadGlobalConfig` applies a runner's defaults.

### 5.6 Tunables

| Value | Where | Status |
|---|---|---|
| `activateTimeoutMs`: 1200000 ms (20 min) | One line in `loadGlobalConfig` | ⚠️ ASSUMPTION. It must sit above the slowest model load a runner makes. One published cold start of a 76 GiB checkpoint on a DGX Spark took 12 min 54 s |
| The warm request's `max_tokens`: 1 | `scripts/runner-probe.mjs` only | Fixed, not tunable: the request exists to be answered, not to generate |

## 6. Interfaces

### A — Runner probe and activation

#### A-01 — `scripts/runner-probe.mjs`

One request to one runner, then exit. `node:` imports only, so it runs anywhere Node does.

```text
node scripts/runner-probe.mjs --endpoint <http(s)://host[:port]> --models [--timeout-ms N] [--token-env NAME]
node scripts/runner-probe.mjs --endpoint <http(s)://host[:port]> --warm <served id> [--timeout-ms N] [--token-env NAME]
```

- `--models` sends `GET /v1/models` and reports the ids in the response's `data[].id`.
- `--warm` sends `POST /v1/messages` with `{ "model": <served id>, "max_tokens": 1, "messages": [{ "role": "user", "content": "ping" }] }` and the header `anthropic-version: 2023-06-01`.
- With `--token-env`, the variable's value is sent as both `x-api-key` and `Authorization: Bearer`. An unset variable is an error before any request.
- It prints exactly one JSON line: `{ "ok": true, "status": 200, "ms": 1834, "served": ["a", "b"] }` (`served` only for `--models`) or `{ "ok": false, "status": 404 | null, "ms": 31, "error": "<one line>" }`. `ok` is true only for a 2xx status. Exit status is 0 when `ok`, 1 otherwise, 2 for a usage error.
- A timeout aborts the request and reports `error: "no answer within <N> ms"`.
- It follows no redirect and writes no file.

Tests in `test/routing.mjs`, against a `node:http` server the test starts: a 200 for each mode, a 404 with a body, a server that never answers (timeout), a refused connection, an unset token variable, and the token reaching the fake in both headers.

#### A-02 — runner keys and the served id

`loadGlobalConfig` validates the four keys of §5.1, with a refusal for each bad shape:

```text
runners.<name>.activate must be "none" or "warm"
runners.<name>.activateTimeoutMs must be an integer of at least 1000
runners.<name>.activateTimeoutMs (<N> ms) is at or above the MCP timeout (<M> ms from .mcp.json); the client would abort kukulu_next first. Lower it, or raise the timeout
runners.<name>.servedAs must map a model string to a non-empty string
runners.<name>.tokenEnv must be an environment variable name such as SPARK_TOKEN
```

`servedId(runnerName, model)` returns `servedAs[model]` when set, else `model` with the longest matching `match` prefix removed. With `match: ["spark/"]`, the model `spark/qwen38-27b` is served as `qwen38-27b`. An empty result is refused when the config loads:

```text
runners.<name>.match entry '<prefix>' equals the model string '<model>', so no model id is left to ask the runner for; add a servedAs entry
```

`kukulu_config_show` and the routing table report `activate` and the served id for each role.

Tests in `test/routing.mjs`: each refusal, the default strip, a `servedAs` override, and the keys refused on `anthropic`.

#### A-03 — activation in `kukulu_next`

When `nextDecision` returns a stage with a role (`plan`, `implement`, `review`, `summarize`) and that role's runner has `activate: "warm"`, `next` runs the probe before it records the timeline:

1. `spawnSync(process.execPath, [runner-probe.mjs, "--endpoint", endpoint, "--warm", servedId, "--timeout-ms", activateTimeoutMs, …])`.
2. On `ok`, it appends `{ event: "activate", stage, round, runner, served, ms, ok: true, at }` to `state.timeline`, before the stage's `start` record, and the result carries `activation: { runner, served, ms }`.
3. On failure, it runs the probe once more with `--models`, appends the same record with `ok: false`, increments `activateFailures`, sets `state.halted` and returns `stage: "halt"` with this reason:

```text
runner <name> did not serve <served> within <N> ms (<error>). It serves: <ids, or "nothing it would list">. Fix the runner or the routing, then resume: kukulu_run_resume({ reason: "<what you fixed>" })
```

Rules:

- The probe runs every time, even when the previous stage used the same model. A loaded model answers a one-token request in about a second, and the harness may have asked the runner for another model in between.
- A parallel wave warms once, for the wave's role, before `streams` is returned.
- `stageSecondsOf` skips `activate` records, so a model load is never counted as stage time. `kukulu_status` gains `activateSeconds`: per runner, the sum of `ms` over `ok` records, in whole seconds.
- In clean-room mode the stage's `start` entry in the chain gains `data.activate: { runner, served, ms }`. No entry kind is added.
- The halt is not a round-cap halt, so `kukulu_run_resume` clears it (0.7.0).
- Behind the sandbox the server runs outside the container, so the probe reaches the runner directly and needs no egress entry.

The go-flight skill prints `runner <name>: <served> ready in <seconds> s` when a result carries `activation`.

**The limit this cannot remove.** The probe makes a swapping proxy load the stage's model. The controller's own next request, the one that spawns the stage, then goes to the controller's model. If the proxy must unload the stage's model to serve that request, the swap is undone before the stage starts. `docs/local-runners.md` states the rule (E-01): with models that cannot be resident together, the controller and the harness's small-model calls run on a model that stays resident.

Tests in `test/state.mjs`, with the probe replaced by a fake script named through an environment variable the tests set: an `ok` activation and its timeline record, `stageSeconds` unchanged by it, a failure's halt text and counter, resume after it, no probe for `activate: "none"`, no probe for the `anthropic` runner, one probe for a wave.

#### A-04 — activation and identity

Genesis already records each role's model, runner and identity (0.8.0 A-03), and this release does not change that record or the verifier. In clean-room mode a routing change since genesis already fails gate check 8 (`routingCheck`). Activation adds the same watch to general mode, as a note: if the served id for a role differs between two activations in one flight, the server logs one feedback entry with `category: "runner-drift"`. It is not a halt. Test in `test/state.mjs`.

### B — Usage records

#### B-01 — the usage record and Claude Code's adapter

One record describes one agent's use of models, from the harness's own transcript:

```json
{
  "v": 1,
  "harness": "claude-code",
  "session": "<session id>",
  "agent": "kukulu-implementer",
  "role": "implementer",
  "stage": "implement",
  "round": 1,
  "models": { "<model the endpoint reported>": { "requests": 41, "input": 812345, "output": 20991, "cacheRead": 700112, "cacheWrite": 9120 } },
  "first": "2026-11-14T03:11:15.916Z",
  "last": "2026-11-14T04:02:40.101Z",
  "activeMs": 1432876,
  "toolCalls": 388,
  "toolErrors": 7,
  "apiErrors": 0,
  "cost": 4.812345
}
```

- `role` is `planner`, `implementer`, `reviewer`, `summarizer` or `controller`. `stage` and `round` come from `.kukulu/state.json` at the time of the hook.
- `activeMs` is the time spent waiting on a model. For each counted request it is the timestamp of the request's last transcript row minus the timestamp of the row before its first row. It includes prefill, decode and the network, and excludes tool execution.
- `toolCalls` counts `tool_use` blocks. `toolErrors` counts `tool_result` blocks with `is_error: true`. `apiErrors` counts rows the transcript flags as API errors. This draft assumes the flag is `isApiErrorMessage`; the task that writes the adapter confirms the field against a recorded transcript, and the count is `null` when the format has no such flag.
- `cost` is the sum of `costUSD` when every counted row carries one, else `null`.
- A field the transcript cannot answer is `null`. An unreadable transcript yields `{ v, harness, session, agent, role, error }`.

`usageFromClaudeCode(hookInput)` replaces today's `usageOf`. Its counting rules are unchanged: an `assistant` row with `message.usage`, each `requestId` once. It skips rows with `isSidechain: true`, so a controller record never counts a subagent's requests.

`validateUsageRecord` in `mcp/metrics.mjs` is the contract a second harness's adapter must meet. Tests in `test/metrics.mjs`: the fixture transcript's exact record, a repeated `requestId`, a sidechain row, a missing `costUSD`, an unreadable file, and both copies of the adapter producing identical output (principle 13).

#### B-02 — `scripts/usage-log.mjs`, the general-mode hook

Registered on `SubagentStop` and `Stop`. It exits 0 at once, silently, when the project has no `docs/kukulu.json`, when `policies.metrics` is false, or when `KUKULU_LOG_SOCKET` is set (inside the sandbox `.kukulu/` is not writable, and the chain carries the usage there). Otherwise it appends one record to `.kukulu/metrics/usage.jsonl`. It never blocks a stop: every path ends in exit 0.

It writes in clean-room mode too. The chain's `usage` entries stay the signed evidence the verifier's check 12 recounts; `usage.jsonl` is what metrics read.

Tests in `test/metrics.mjs`: the appended record, the three silent exits, and a transcript that cannot be read.

#### B-03 — the controller's usage

On `Stop`, both hook scripts write a record with `role: "controller"`, computed from the whole main transcript. `Stop` fires more than once in a flight, so each record is cumulative, and readers keep the last one per session. `rolesUsage` matches only the four role agents, so the verifier's check 12 does not count these entries.

Known limit, stated in `docs/metrics.md`: requests the controller makes after its last `Stop` hook ran are not counted.

#### B-04 — usage under the sandbox

Inside the boundary `scripts/cleanroom-log.mjs` already sends each `usage` entry through the log socket. It now sends the B-01 fields in `data`. The server reads usage records from `.kukulu/metrics/usage.jsonl` when the file exists, else from the chain's `usage` entries. Test in `test/metrics.mjs`: the same flight read from each source yields the same metrics.

### C — Metrics

#### C-01 — `kukulu_metrics`

```text
kukulu_metrics({})  →  the metrics object (Appendix A), computed now, nothing written
```

Read-only. It refuses only what `kukulu_status` refuses. `buildMetrics` takes plain data: the state, the config's caps, the routing table, the usage records, the counters, the feedback entries, the task counts and three git facts (commits, `--shortstat` and the merge base). It never throws on a missing input; the field is `null`.

Derived fields, each documented in `docs/metrics.md`:

- `wall.seconds`: last timeline record minus the first.
- `wall.stageSeconds`: `stageSecondsOf`. `wall.activateSeconds`: the sum of `ok` activations. `wall.idleSeconds`: `wall.seconds` minus both.
- `rounds[]`: `state.rounds` joined with the timeline's spans for that round: `implementSeconds`, `reviewSeconds`, `findings` (the round's `fixTasks`), `sources`, `verdict`, `nonConverging`.
- `outcome.approvedAtRound`: the round of the first `APPROVED` verdict, else `null`.
- `roles.<role>`: the routing facts (`model`, `runner`, `locality`, `family`) and the sums of that role's usage records; `outputPerActiveSecond` is `output / (activeMs / 1000)`, rounded to one decimal; `cost` is `null` unless the role's runner is `anthropic`.
- `friction.feedback`: feedback entries counted by `category`.

Tests in `test/metrics.mjs`: a recorded flight's inputs (a fixture built from `docs/flights/v0-8-0/`) to its exact metrics; every `null` path; `cost` nulled for a local runner; a halted flight; a flight with no usage records.

#### C-02 — counters

The server keeps `.kukulu/metrics/counters.json`:

| Counter | Incremented by |
|---|---|
| `verifyRuns`, `verifyFailures` | each `kukulu_verify` call, and each one that reports a failing command |
| `tasksReopened` | `kukulu_task_reopen` |
| `activateFailures` | A-03 |
| `guardReblocks` | read from the lock's new `total` field when a run finishes or halts |

`scripts/implement-guard.mjs` keeps `total` beside `count` in the lock: `count` still resets on every task state change, `total` never does. A lock in the legacy bare-number format has no `total`, and the counter is `null` for that run.

This is a change to `scripts/implement-guard.mjs`. CLAUDE.md's reviewer rule says of `RUN_START_TOOL` and the agent-type set "nothing else about them changes"; both stay as they are, and the planner rewrites that rule so the lock's `total` field is the one permitted change to the implement guard in this flight.

`kukulu_status` reports `counters`. A counters file that cannot be written is a note in the tool's result (principle 6). Tests in `test/state.mjs` and `test/guard.mjs`.

#### C-03 — `METRICS.json` at the end of a flight

`METRICS.json` is written beside the summary, `docs/flights/<slug>/` when the flight was archived, else `docs/`, at two points, each only when `policies.metrics` is true:

- **`kukulu_pr_finalize`**, the summarizer's last call, builds the metrics and commits the file alone as `chore: flight metrics` before it pushes, so the file reaches the pull request. The summarizer archives before it finalizes, and the `done` that follows an archive finds a fresh state with no open span and commits nothing; writing the file there would leave a commit that is never pushed. Each `kukulu_pr_finalize` call that pushes, the `resign` call included, rewrites the file first.
- **`next`, on a `halt` or on a `done` with an open span** (a flight not archived, or one halted mid-stage), puts the file into the same `chore: stage end` commit as the timeline. The `done` that follows an archive writes and commits nothing, so 0.8.1 C-01's test (`kukulu_next` after the archive moves no HEAD and leaves `.kukulu/state.json` byte-identical) stands unchanged.

`archivedFiles()` gains `docs/METRICS.json`, so a flight archived later takes the file with it. A resumed flight overwrites it at its next write.

An archive moves `.kukulu/state.json`, `docs/kukulu.json` and `.kukulu/feedback.jsonl` into the flight's directory. After one, the metrics read those three inputs from `state.archived.dir`, and the usage records and counters from `.kukulu/metrics/`, which an archive does not move.

Known limit, stated in `docs/metrics.md`: at `kukulu_pr_finalize` the summarizer has not stopped, so its usage record (B-02) is not written yet, and the summarizer's role in the committed `METRICS.json` holds `null` sums. `kukulu_metrics` called after the flight shows it.

A failure to build or write it never changes the decision: the result carries `metricsNote`, as `timelineNote` does today.

Tests in `test/state.mjs`: the file after a non-archived `done` and after a `halt`; after `kukulu_pr_finalize` in an archived flight's directory, committed as `chore: flight metrics` before the push (the fake remote holds it); no commit from the `done` after an archive; absent under `policies.metrics: false`; and the note when the write fails. The test for `kukulu_pr_finalize` lives in `test/review.mjs`, the suite that owns the tool.

#### C-04 — the harness's name

The `initialize` handler keeps `params.clientInfo` when it has a string `name`. `kukulu_run_start` and `next` add it to `state.harness` when it is not there already. `METRICS.json` carries the list. A client that sends none yields `[{ name: "unknown", version: null }]`. Test in `test/protocol.mjs`.

### D — Comparison

#### D-01 — `scripts/compare-flights.mjs`

```text
node scripts/compare-flights.mjs <a> <b> [--trees <dir-a> <dir-b>] [--json]
```

`<a>` and `<b>` are each a `METRICS.json`, or a directory holding one (`docs/` of a project, or an archived flight's directory). It reads and prints; it never writes a file.

It prints five sections, each with A, B and the difference:

1. **Outcome**: verdict, halt, reviews, the round of approval, the caps.
2. **Wall time**: total, per stage, activation, idle.
3. **Rounds**: one row per round: findings, implement and review seconds.
4. **Roles**: per role: model, runner, family, requests, input and output tokens, active seconds, output per active second, tool errors, cost.
5. **Friction**: feedback by category, guard re-blocks, verify runs and failures, reopened tasks, activation failures.

A header names each flight's harness, plugin version, mode and spec hash, and prints one line when the two spec hashes differ: `the two flights were built from different specs; the comparison below is not like for like`.

With `--trees`, it adds a sixth section: files, lines and the `scorePair` similarity of the two trees, using the scorer `compare-bundles.mjs` uses, skipping `.git`, `node_modules` and `target`.

`--json` prints `compareMetrics`' object instead. Exit status is 0, or 2 for a bad argument or an unreadable or wrong-version file.

Tests in `test/metrics.mjs`: two fixture metrics files to exact text and exact JSON, the differing-spec line, `--trees` on `test/fixtures/similarity/`, and each exit-2 case.

### E — Local runners

#### E-01 — `docs/local-runners.md`

A new page, linked from `docs/routing.md` and the README. It covers, with every external fact cited:

- **Direct mode.** A fully local flight needs no router on the workstation: launch the harness with its base URL pointed at the runner, and route roles to model strings the runner's proxy accepts. The exact environment variables for Claude Code, each with a link to the page that documents it.
- **Resident and swapping layouts.** Two models resident together need no swap. Two that cannot be resident together need a model-swapping proxy on the inference host; the page points at `templates/runners/llama-swap.example.yaml`.
- **The controller rule** (A-03's limit): with a swapping layout, the controller and the harness's small-model calls run on a model that stays resident.
- **Timeouts.** The harness's request timeout and the MCP timeout must both exceed the slowest load, and `activateTimeoutMs` must sit below the MCP timeout (A-02).
- **What activation measures**, and that with `activate: "none"` a load is hidden inside the first request of a stage and inflates `activeMs`.
- **A smoke test** to run before a flight: a tool loop, a Kūkulu tool call, and a look at the proxy's log for which model ids the harness asks for during a stage.

#### E-02 — templates

- `templates/kukulu.config.example.json`: the `spark` runner gains `"activate": "warm"`, and a `spark` profile routes all four roles to it with a different family for the reviewer than for the implementer. `test/routing.mjs` still loads the template.
- `templates/runners/llama-swap.example.yaml`: one commented example with a resident group and a swapping group. A header line says which llama-swap release it was checked against.

#### E-03 — model families

`MODEL_FAMILIES` gains `{ family: "laguna", pattern: /laguna|poolside/ }`, and `test/fixtures/families.json` gains a row for it. The table stays an ⚠️ ASSUMPTION written only in `mcp/cleanroom.mjs`.

### F — Documentation and release

- `docs/mcp-tools.md`: `kukulu_metrics` (new); `kukulu_next` (A-03, C-03); `kukulu_status` (`counters`, `harness`, `activateSeconds`); `kukulu_config_show` (A-02); `kukulu_run_start` (§5.4).
- `docs/metrics.md` (new): the usage record, every `METRICS.json` field and its source, the known limits (B-03, and what `activeMs` includes).
- `docs/operations.md`: the new runner keys, `policies.metrics`, "What the flight leaves behind".
- `docs/architecture.md`: activation in the stage loop.
- `CONTRIBUTING.md`: the `test/metrics.mjs` row.
- `README.md`, `CHANGELOG.md` (Added, Changed; no "Breaking changes" heading), the version in `package.json`, `.claude-plugin/plugin.json` and `mcp/server.mjs`.

## 7. Commands

These are `docs/kukulu.json`'s today and stay as they are:

- lint: `npm run lint`
- hooks: `pre-commit run --all-files`
- test: `npm test` (timeout 900000 ms)
- extra, by path: as in `docs/flights/v0-8-1/kukulu.json`
- targeted, for `mutation.targeted`: `node test/{filter}.mjs`

## 8. Phases

### Phase 0 — Usage records

B-01 to B-04 and the `.kukulu/metrics/` exclusion. Ends with a push. Manual check, `NOT VERIFIED (human)`: after one general-mode flight on the working tree's plugin, `.kukulu/metrics/usage.jsonl` holds one record per stage and one controller record, and `git status` is clean.

### Phase 1 — Probe and activation

A-01 to A-04. Ends with a push. Manual checks, `NOT VERIFIED (human)`:

- `node scripts/runner-probe.mjs --endpoint <a real runner> --models` lists its models.
- With `activate: "warm"` on a runner whose proxy swaps models, `kukulu_next` returns only after the model answers, and the go-flight transcript shows the `ready in` line.

### Phase 2 — Metrics and comparison

C-01 to C-04 and D-01. Ends with a push. Manual check, `NOT VERIFIED (human)`: `node scripts/compare-flights.mjs` on two real flights of one spec prints all five sections with no `null` in the Anthropic flight's cost column.

### Phase 3 — Local runners, documentation and release

E-01 to E-03, then F. Manual check, `NOT VERIFIED (human)`: the commands in `docs/local-runners.md` start a fully local session against the owner's inference host.

## 9. Open questions

None block the build. Each is decided here, so the planner records it under `## Decisions` as given. The owner may overrule any of them before the flight.

1. **What 0.9.0 is.** Runner comparison metrics; OpenCode is 0.10.0 (owner decision of 2026-11-12, replacing 0.8.1 §9 question 1). Still open for the owner: which release takes strategy goals G-11 to G-14 and the 0.8.0 REVIEW's open spec issues.
2. **Activation by request, not by command.** `activate: "warm"` sends a request and waits. A configured shell command (`ssh host systemctl …`) would let Kūkulu drive a host with no proxy, at the cost of running an operator-written command from the server on every stage. Deferred until someone needs it.
3. **The served id.** The matched prefix is stripped, with `servedAs` as the override (A-02). Sending the role's model string unchanged was the alternative; it fails when a workstation router rewrites the string on the way to the runner.
4. **Where metrics are written.** By the server at `done` and `halt` (C-03), not by the summarizer, whose own usage is not known until it stops.
5. **Usage in every mode.** A second hook script writes an untracked file in general mode (B-02). Requiring clean-room mode for metrics was the alternative; it would keep everyday flights unmeasured.
6. **The summarizer's record after an archive.** The summarizer archives the flight and then stops, so its `SubagentStop` arrives after the archive, and 0.8.1 C-01 stops the clean-room log there. `usage-log.mjs` still writes its record, and `next` reads it at `done`. Under the sandbox that record is lost; `docs/metrics.md` lists it as a known limit.
7. **Cost for local runners.** `null`. Energy and hardware cost are the operator's arithmetic.
8. **Engine metrics.** Not scraped (§2). `outputPerActiveSecond` is the one throughput figure, because both kinds of runner can produce it.

## Appendix A: `METRICS.json`

```json
{
  "v": 1,
  "plugin": "0.9.0",
  "flight": "v0-9-0",
  "spec": { "title": "cleancbor — Specification", "sha256": "…" },
  "harness": [{ "name": "claude-code", "version": "…" }],
  "mode": "clean-room",
  "enforcement": "hook",
  "outcome": {
    "verdict": "APPROVED", "halted": null,
    "reviews": 3, "fixRounds": 2, "approvedAtRound": 3,
    "caps": { "maxRounds": 12, "maxRoundsHard": 12 }
  },
  "wall": {
    "startedAt": "…", "endedAt": "…", "seconds": 41230,
    "stageSeconds": { "plan": 1840, "implement": 30112, "review": 7420, "summarize": 610 },
    "activateSeconds": { "spark": 14 }, "idleSeconds": 1234
  },
  "rounds": [
    { "round": 1, "implementSeconds": 24010, "reviewSeconds": 2600, "findings": 8,
      "sources": { "review": 7, "mutation": 1, "blocked": 0 }, "verdict": "CHANGES REQUESTED", "nonConverging": false }
  ],
  "roles": {
    "implementer": {
      "model": "spark/qwen38-27b", "runner": "spark", "locality": "local", "family": "qwen",
      "reported": ["qwen38-27b"],
      "requests": 612, "input": 9120044, "output": 401220, "cacheRead": 8800310, "cacheWrite": 0,
      "activeSeconds": 21904, "outputPerActiveSecond": 18.3,
      "toolCalls": 4410, "toolErrors": 61, "apiErrors": 2, "cost": null
    },
    "controller": { "…": "…" }
  },
  "tasks": { "total": 41, "done": 41, "blocked": 0, "skipped": 0, "reopened": 1 },
  "friction": {
    "feedback": { "restart": 0, "runner-drift": 0 },
    "guardReblocks": 9, "verifyRuns": 97, "verifyFailures": 22, "activateFailures": 0
  },
  "tree": { "commits": 58, "filesChanged": 31, "insertions": 2904, "deletions": 112 }
}
```

## Appendix B: interpretation choices made in writing this spec

1. **Activation always probes.** Skipping the probe when the last stage used the same model would save about a second and would trust that nothing else asked the runner for another model in between. The harness's own background requests make that false.
2. **Activation lives in `kukulu_next`.** A separate tool the controller calls would put a mechanic in a skill's hands (principle 1), and it would not avoid the limit in A-03.
3. **Raw usage is not committed.** `usage.jsonl` stays excluded; `METRICS.json` is the committed product. A committed, hook-written file is what blocked releases in project-g.
4. **`outputPerActiveSecond` is not decode speed.** It divides output tokens by all model wait time, so a flight with long prompts reads slower than its engine's benchmark. It is the same measure on every runner, which is what a comparison needs.
5. **No change to bundles.** A clean-room bundle already carries the log the metrics are built from. Adding `METRICS.json` to the manifest would change the verifier, and that is not this release.
6. **Metrics at `kukulu_pr_finalize`, not at the `done` after an archive** (C-03). The `done` after an archive commits nothing (0.8.1 C-01), and a commit made there would come after the push. Writing at finalize gets the file into the pull request, at the cost of the summarizer's own usage, which is not known until it stops.

## Appendix C: what this draft was checked against

Read in full or in the relevant part: `docs/routing.md`, `docs/writing-specs.md`, `templates/SPEC.md`, `templates/kukulu.config.example.json`, `docs/SPEC.md` (0.8.1), `docs/kukulu.json`, `hooks/hooks.json`, `skills/go-flight/SKILL.md`, `scripts/cleanroom-log.mjs`, `scripts/compare-bundles.mjs` (header and `collect`), `docs/sandbox.md` (from "Running a flight"), and these parts of `mcp/server.mjs` and `mcp/cleanroom.mjs`: runner keys and resolution, `recordTimeline`, `stageSecondsOf`, the round caps, `PROMPTS`, the `initialize` handler, `archivedFiles` and `flightArchive`'s start, `MODEL_FAMILIES`, the `roles.distinct` check and `rolesUsage`.

Not read, so the planner should check each against the code before relying on this draft's wording: `verify`, `taskReopen`, `summaryCommit`, `runStart`'s exclude handling, how the state file is re-created after an archive, `scripts/implement-guard.mjs` beyond its lock format, `scripts/verify-attestation.mjs`, the test harness, and whether the verifier rejects an unknown key in a `stage` entry's `data` (A-03 adds one).
