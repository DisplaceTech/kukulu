# Handoff: Kūkulu 0.9.0 (runner comparison metrics)

- Branch: `build/2026-11-14`, base `3832f3e` (main), head `4fbbda7` before this file.
- Tasks: 32 done, 0 blocked, 0 skipped, 0 open.
- Final `kukulu_verify` was green on the tree of P3-05 (lint, pre-commit, `npm test` with 5,275 assertions across sixteen suites, all 38 constraints). Later commits are empty task commits and progress records.
- No "do not merge" line: this release has nothing a human must run first (SPEC §6 G); the manual checks below are for the owner after merge.

## Blocked and skipped tasks

None.

## Interpretation choices

- P0-02: the "no state file" test uses a state that has a genesis but no round or timeline, because the log is only written once a genesis exists.
- P1-01: a usage error prints `runner-probe: <reason>` and then the usage text on stderr.
- P1-02: the MCP-limit refusal applies to an explicit `activateTimeoutMs`, and to the default only when `activate` is `warm`; the default lives in `runnerActivation()` on the one allowed line.
- P1-03: `activate` records are not copied into the chain as stage entries; the `start` entry carries `data.activate` (P1-05).
- P1-04: `nextDecision(forcedHalt)` gives the failed-activation halt exactly the shape of the other halts.
- P1-05: drift note 2 compares only the most recent successful activation of the same stage; `feedback.jsonl` always joins the timeline commit's paths.
- P1-06: markdownlint forbids spaces inside a code span, so the skill says "a space and `(reports <reported>)`".
- P2-02: a JSON lock with no `total` starts one at 1 on its first re-block; a `total` of 0 is still added, turning a `null` counter into 0.
- P2-03: `kukulu_next` alone never writes the state for the harness; the timeline write and `kukulu_run_start` do.
- P2-04: `outcome.caps` comes from `inputs.caps` even without a state; an absent `state.rounds` gives `rounds: null`, an empty one `[]`; `idleSeconds` is not clamped.
- P2-05: the controller keeps the last record per session in both sources; `usage.records` counts after supersession.
- P2-06: a fresh repository with a commit has a tree of zero changed files, not `null`; the archived flight is read when `state.archived` is set, `docs/kukulu.json` is absent and the live timeline is empty.
- P2-07: after an archive `usage.chainHead` is the archived log's head, which includes the archive checkpoint.
- P2-08: a `docs/METRICS.json` that is a directory is detected before the rollback snapshot (which cannot read a directory) and reported as `metricsNote`.
- P2-09: the metrics commit goes after `chore: finalize flight` (so a manual re-sign has cleared the override and the commit is signed), at the head of the awaiting-signing path, and before the rebase under `resign`. An existing test now expects an aborted rebase to leave the original head plus the metrics commit.
- P2-10: the comparison text ends in one newline (no trailing blank line) so `end-of-file-fixer` accepts the expected fixture.
- P2-11: `--trees` takes up to two following values that do not start with `--`.
- P3-03: the "limit this cannot remove" paragraph states only what the Kūkulu record itself can and cannot show; no new external fact.
- P3-04: the activation step is drawn in the architecture's existing stage-loop flowchart (the gate diagram). The gitignored feedback-file headers SPEC §1 mentions were not touched.
- P3-05: the Unreleased lines were regrouped into one entry in requirement order.

## ⚠️ ASSUMPTION values

- `activateTimeoutMs` default 1800000 ms (30 minutes): not changed. P1-07 measured the probe's fixed cost (median 55.0 ms over a bare Node start), the refused-connection latency (80.0 ms) and the timeout overshoot (74.8 ms for a 1000 ms limit); see `docs/spikes/P1-07.md`. No model load could be measured, so a new default is the owner's call.
- `MODEL_FAMILIES`: gained `laguna` as the last entry (P3-01, `docs/spikes/P3-01.md`); every existing string resolves as before.
- The 50 ms hook budget stays only in `test/cleanroom.mjs`; the new `Stop` general-mode path is asserted against it.
- `RUNNER_LIST_TIMEOUT_MS` (10000) is a fixed constant, not a tunable: the follow-up model listing only decorates a halt's reason.

## What a human must check by hand

- Phase 0: after one general-mode flight on the working tree's plugin, `.kukulu/metrics/usage.jsonl` holds one record per stage and one controller record, and `git status` is clean.
- Phase 1: `node scripts/runner-probe.mjs --endpoint <a real runner> --models` lists its models; with `activate: "warm"` on a runner whose proxy swaps models, `kukulu_next` returns only after the model answers and the go-flight transcript shows the `ready in` line.
- Phase 2: `node scripts/compare-flights.mjs` on two real flights of one spec prints all five sections with no null in the Anthropic flight's cost column. This Claude Code version's transcripts may carry no per-row cost, so the column is expected to read `n/a` until the owner rules (see PLAN.md Spec issues).
- Phase 3: the commands in `docs/local-runners.md` start a fully local session against the owner's inference host.
- `KUKULU_RUNNER_IT=1 KUKULU_RUNNER_IT_ENDPOINT=<url> node test/routing.mjs` runs the opt-in real-runner step (prints `# skipped` otherwise).

## Codebase notes

- `kukulu_verify` runs the whole suite (about 8 minutes); the `cleanroom` suite alone is about 150 s and the `state` suite about 120 s, so run them in the background.
- A new doc file must be tracked (`git add`) before `test/plugin.mjs` can pass its relative-link check.
- The harness's `eq` uses `Object.is`; compare arrays and objects through `JSON.stringify`.
- `no-hardcoded-mcp-timeout` scans `test/` too: a test must not spell the limit's millisecond literal even to assert its absence.
- `withRollback` snapshots paths with `readFileSync`, which throws on a directory; a path that may be a directory must be checked before it joins the list.
- A test that archives a flight needs `.kukulu/metrics/` excluded first (a real flight's `kukulu_run_start` or `kukulu_next` does it), or the untracked `usage.jsonl` makes the tree dirty.
- `kukulu_pr_finalize` now makes a `chore: flight metrics` commit; tests that assert the head after finalize expect it to follow `chore: finalize flight`.
- `end-of-file-fixer` strips a trailing blank line, so any expected-output fixture must end in exactly one newline.
- The probe reads its token from the environment only; the server never reads the variable named by `tokenEnv`, and a test searches the state, chain and feedback file for the marker.

## For a reviewer

- The server stays synchronous and opens no socket: the only network code is `scripts/runner-probe.mjs`, run through `spawnSync` (constraints `server-no-network`, `probe-node-only`).
- `mcp/metrics.mjs` is pure and harness-neutral; the one place that knows Claude Code's transcript format is `usageFromClaudeCode` in `scripts/cleanroom-log.mjs`.
- `scripts/implement-guard.mjs` changed only by the lock's `total` field (SPEC C-02); `RUN_START_TOOL`, the agent-type set and the task regexes are untouched.
- Gate check 3 now also requires the logger on `Stop`, so a clean-room flight begun on 0.8.x cannot continue on 0.9.0 (documented in the changelog and README).
- A-03's clean-room chain record is described as patent pending wherever it is mentioned.

## Round 1

- Tasks: 3 done (R1-01 to R1-03), 0 blocked. Final `kukulu_verify` green (5,283 assertions).
- R1-01: `scripts/runner-probe.mjs` replaces the token in the raw error body before collapsing whitespace and cutting to 300 characters; new straddle test in `test/routing.mjs`.
- R1-02: `recordTimeline` takes an `afterReset` callback run right after a flight's first-record emptying of `.kukulu/metrics/`; `next()` bumps `activateFailures` there, so the count survives (interpretation: callback rather than reordering `next()`, to keep "only when a record is written").
- R1-03: the `kukulu_next`, `kukulu_status` and `kukulu_pr_finalize` descriptions name the activation wait and halt, METRICS.json, counters, harness, activateSeconds and the `chore: flight metrics` commit; four assertions in `test/protocol.mjs`.
- Nothing for a human to check by hand.

## Round 2

- Tasks: 1 done (R2-01), 0 blocked. Final `kukulu_verify` green (5,286 assertions).
- R2-01: text only. `kukulu_status` now says activateSeconds is a per-runner total of successful activations in whole seconds; `kukulu_next`'s wave-record sentence has a verb; `docs/mcp-tools.md`'s overview no longer says `kukulu_next` writes only the stage timeline. Three assertions in `test/protocol.mjs`.
- Nothing for a human to check by hand.
