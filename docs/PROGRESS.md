# Kūkulu 0.9.0 build progress

Branch: build/2026-11-14
Started: 2026-11-14T04:52:50.030Z

## Tasks

- [x] P0-01 The usage record's contract, mcp/metrics.mjs and the metrics suite
- [x] P0-02 usageFromClaudeCode replaces usageOf, and the chain's usage entry carries the record
- [x] P0-03 General-mode usage in .kukulu/metrics/usage.jsonl, excluded per clone
- [x] P0-04 The logger on Stop, and the controller's usage record
- [x] P0-05 Usage entries under the sandbox and in the verifier
- [x] P0-06 Phase 0 end: push and record the manual check
- [x] P1-01 scripts/runner-probe.mjs
- [x] P1-02 Runner keys activate, activateTimeoutMs, servedAs and tokenEnv, and the served id
- [x] P1-03 kukulu_next warms the stage's runner and records the wait
- [x] P1-04 A runner that does not serve its model halts the flight
- [x] P1-05 Activation in the chain, and the runner-drift notes
- [x] P1-06 go-flight prints the activation line
- [x] P1-07 Measure what the probe costs and how it fails
- [x] P1-08 Phase 1 end: push and record the manual checks
- [x] P2-01 Counters for verify runs, verify failures and reopened tasks
- [x] P2-02 The implement guard keeps a cumulative total, read as guardReblocks
- [x] P2-03 The harness's name from initialize
- [x] P2-04 buildMetrics: outcome, wall time, rounds, tasks, friction and tree
- [ ] P2-05 buildMetrics: usage, roles and totals
- [ ] P2-06 kukulu_metrics
- [ ] P2-07 A clean-room flight's metrics read usage from the chain only
- [ ] P2-08 policies.metrics, and METRICS.json when kukulu_next ends or halts a flight
- [ ] P2-09 METRICS.json at kukulu_pr_finalize
- [ ] P2-10 compareMetrics and scripts/compare-flights.mjs
- [ ] P2-11 compare-flights --trees
- [ ] P2-12 Phase 2 end: push and record the manual check
- [ ] P3-01 MODEL_FAMILIES gains laguna
- [ ] P3-02 Templates: a spark profile with activation, and a llama-swap example
- [ ] P3-03 docs/local-runners.md
- [ ] P3-04 Documentation sweep for 0.9.0
- [ ] P3-05 CHANGELOG 0.9.0 and the version
- [ ] P3-06 Phase 3 end: push and record the manual checks

## Log

(one entry per task, appended by implement)

### P0-01 — 87d7cab

Added mcp/metrics.mjs (METRICS_VERSION, USAGE_ROLES, USAGE_KEYS, validateUsageRecord), test/metrics.mjs (21 assertions), registered metrics suite (sixteen suites in README/CONTRIBUTING/plugin test), docs/metrics.md, CHANGELOG Unreleased. Note: docs links test needs new docs files tracked (git add before running plugin suite). harness eq uses Object.is, so compare arrays via JSON.stringify.

### P0-02 — 0ccc4de

usageFromClaudeCode in scripts/cleanroom-log.mjs (stageAndRound helper reads state.json). Fixture agent-full.jsonl gives exact record (activeMs 17000). 35 metrics assertions; cleanroom suite unchanged green. Interpretation: 'no state file' test uses state with genesis but no round/timeline since log requires genesis. Note: running node test/cleanroom.mjs takes ~140s; run in background.

### P0-03 — 8e29dfa

General-mode branch in scripts/cleanroom-log.mjs (before the policy exit). Server: layoutFor gains metricsDir/usage/counters; ensureMetricsExcluded() called in startRun (after inRepo check, so also on already-started path) and next(); recordTimeline empties metrics files when timeline is empty. Tests: metrics (48), implement (396), state (326). Full verify green.

### P0-04 — 6d4982c

Logger registered on Stop (hooks.json second entry); usageFromClaudeCode handles Stop (role controller, transcript_path, sidechain rows dropped); clean-room Stop appends usage entry role session; gate check 3 requires Stop registration. Tests: metrics 57, plugin 604, cleanroom 1502 (incl. Stop 50 ms budget). Full verify green.

### P0-05 — 81302ea

Tests only: sandbox (231) shows SubagentStop/Stop usage records cross the log socket with fifteen fields + source box, and no .kukulu/metrics written under KUKULU_LOG_SOCKET; attest (314) shows full-record usage entries verify, check 12 recount unchanged, controller entry (role session) changes nothing. No behavior change needed. docs/sandbox.md sentence added.

### P0-06 — 61cc6b2

Push: pushed build/2026-11-14 to origin. Verify was green on the identical tree (P0-05). Manual check: NOT VERIFIED (human): after one general-mode flight on the working tree's plugin, .kukulu/metrics/usage.jsonl holds one record per stage and one controller record, and git status is clean

### P1-01 — 0e3fca2

scripts/runner-probe.mjs: exports probe() and main(); one JSON line; token redacted twice; no shebang. Tests in routing (327 assertions) use spawn (async) against local http fakes; opt-in real step prints '# skipped' without KUKULU_RUNNER_IT. Interpretation: usage error prints 'runner-probe: <reason>' then the usage text on stderr. Docs: routing.md paragraph, README layout line, CHANGELOG.

### P1-02 — c8470a3

server.mjs: RUNNER_KEYS gains four keys, runnerActivation() holds the 30-minute default on the single allowed line, servedId(), runnerFor carries activate/activateTimeoutMs/served/tokenEnv, resolveRouting refuses empty served id, routingTable has served+activate columns, configShow roles gain activate/served/activateTimeoutMs. validateRunners(runners, where, limit=mcpTimeoutMs()). routing suite 348. Interpretation: default timeout vs MCP limit checked only when activate is warm.

### P1-03 — 483527d

activateRunner(role) + activationRecord in server.mjs; next() probes via spawnSync(KUKULU_RUNNER_PROBE or scripts/runner-probe.mjs); recordTimeline(res, activation) orders end, activate, start (activate alone when unchanged), ignores activate when finding the open span, skips activate in chain stage entries (P1-05 owns that). kukulu_status.activateSeconds. Failed probe: result.activation.error, no record (P1-04 replaces). mkFakeProbe in harness. state suite 350.

### P1-04 — b82d986

Failed warm probe -> follow-up --models probe (RUNNER_LIST_TIMEOUT_MS=10000) -> next() calls nextDecision(forcedHalt) for a halt-shaped result; recordTimeline writes end + activate ok:false, sets state.halted (no haltCap), commit chore: stage end. readCounters/bumpCounter added (activateFailures; countersNote on failure). runProbe() shared helper. state suite 365. Interpretation: forcedHalt param on nextDecision.

### P1-05 — 82edb36

recordTimeline: start chain entry gains data.activate (ok activation only); drift 1 and 2 feedback entries (runner-drift, controller, auto) inside the timeline withRollback, feedback joins paths. Tests: state 373 (incl. real probe over node:http), cleanroom 1508, attest 315. Interpretation: drift 2 uses most recent ok activate of same stage.

### P1-06 — 523d090

go-flight step 1 prints the activation line; plugin test 606; operations.md mentions it. Interpretation: MD038 forbids a leading space in code span, so wording is 'a space and `(reports <reported>)`'. Final pre-commit and plugin suite green; full verify ran green except that markdownlint finding, fixed after.

### P1-07 — 2fa7baf

docs/spikes/P1-07.md written. Measurement: before 1800000 ms default (SPEC cold start 12 min 54 s); after unchanged. Medians of ten: bare node 24.9 ms, warm probe 80.0 ms (cost 55.0 ms), refused connection 80.0 ms, 1000 ms timeout returns at 1074.8 ms (overshoot 74.8 ms, ~25 of it node start). Full verify green.

### P1-08 — 18a0aad

Push: pushed build/2026-11-14 to origin. Verify green on identical tree (P1-07). Manual check: NOT VERIFIED (human): node scripts/runner-probe.mjs --endpoint <a real runner> --models lists its models; with activate "warm" on a runner whose proxy swaps models, kukulu_next returns only after the model answers and the go-flight transcript shows the ready in line

### P2-01 — df1df9a

verify() bumps verifyRuns/verifyFailures, taskReopen bumps tasksReopened, status.counters = readCounters(); countersNote on failure never changes ok. docs/metrics.md Counters table. implement 405, state 378.

### P2-02 — fae613d

Guard writeLock also writes total (JSON locks only); startRun arms total 0; countGuardReblocks() before lock removal in runFinish/runHalt; run_halt adds a metrics feedback entry on note. guard 84, implement 409, state 381. Interpretation: JSON lock without total starts one at first re-block; total 0 still added.

### P2-03 — bee6a07

harnessClient from initialize clientInfo; noteHarness(st) in startRun and recordTimeline state writes; status.harness. protocol suite 44. Full verify green.

### P2-04 — 1997a21

buildMetrics in mcp/metrics.mjs (pure); fixtures test/fixtures/metrics/v0-8-0.{inputs,expected}.json (expected hand-derived) and README; docs/metrics.md METRICS.json table. metrics suite 82. Interpretation: caps from inputs.caps even without state; absent rounds -> null, empty -> []; idleSeconds unclamped; usage/roles/totals null until P2-05.
