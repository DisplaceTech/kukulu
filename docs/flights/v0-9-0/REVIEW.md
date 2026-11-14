# Review: Kūkulu 0.9.0 (runner comparison metrics)
Round: 3

Branch `build/2026-11-14`, base `3832f3e` (main), head `6a7d53b`. 36 of 36 tasks done (32 planned, R1-01 to R1-03, R2-01), none blocked or skipped. Last review commit `1413f8e`.

## Verdict

APPROVED

`kukulu_verify` on the head is green: all 39 constraints self-test and scan clean, `npm run lint`, `pre-commit run --all-files` and `npm test` (5,286 assertions in sixteen suites) pass. `prChecks` reads `{ state: "pending", failing: [] }`: not a finding. No branch commit touches `.gitignore`, `.gitattributes`, CI or editor config, `docs/SPEC.md`, `docs/plans/`, `site/` or `docs/site/`.

R2-01 (commit `051d602`) does what round 2 asked and nothing else: `kukulu_status`'s description now says `activateSeconds` is per runner, the total wait of its successful activations, in whole seconds (matching SPEC line 213, the code and `docs/mcp-tools.md`'s status table); `kukulu_next`'s wave-record sentence has its verb; `docs/mcp-tools.md:5` now says `kukulu_next` may first run the runner probe and writes the stage timeline, the wave record and, on done and halt, `docs/METRICS.json`. No behavior or input-schema change. No other tracked document still says `kukulu_next` writes only the timeline.

## Findings

None.

## Spec issues

- Unchanged from rounds 1 and 2: B-01's `cost` reads a per-row `costUSD` that current Claude Code transcripts do not carry, so Phase 2's "no null in the Anthropic flight's cost column" cannot pass as written; the owner decides (a rate table, or the session-wide `cost-state` row). SPEC A-01 should also say that redaction precedes any truncation (R1-01 does it in that order).

## Manual checks still owed

Copied from HANDOFF.md, all `NOT VERIFIED (human)`:

- Phase 0: after one general-mode flight on the working tree's plugin, `.kukulu/metrics/usage.jsonl` holds one record per stage and one controller record, and `git status` is clean.
- Phase 1: `node scripts/runner-probe.mjs --endpoint <a real runner> --models` lists its models; with `activate: "warm"` on a runner whose proxy swaps models, `kukulu_next` returns only after the model answers and the go-flight transcript shows the `ready in` line.
- Phase 2: `node scripts/compare-flights.mjs` on two real flights of one spec prints all five sections with no null in the Anthropic flight's cost column (expected to read `n/a` until the owner rules on cost; see Spec issues).
- Phase 3: the commands in `docs/local-runners.md` start a fully local session against the owner's inference host.
- `KUKULU_RUNNER_IT=1 KUKULU_RUNNER_IT_ENDPOINT=<url> node test/routing.mjs` runs the opt-in real-runner step.

## Notes

- Mutants on the round-2 fix files, run through the targeted `protocol` suite with `confirmKill` (the unmutated tree passes 51/51), all killed by exactly the new R2-01 assertion: `mcp/server.mjs` with `activateSeconds` described as the last activation's wait again; `mcp/server.mjs` with the wave sentence's "it also writes" removed; `docs/mcp-tools.md` with the old "writes only the stage timeline (and the wave record)" overview restored.
- `docs/mcp-tools.md`'s overview does not repeat that `kukulu_next` may append `runner-drift` and `metrics` feedback entries; the tool description and the `kukulu_next` section say so, and the task did not ask for it. Not worth a task.
- Round 1's and round 2's advisory notes stand for the summary: the quadratic `activeMs` scan in `usageFromClaudeCode`; the logger not adding the `.kukulu/metrics/` exclusion itself; the awaiting-signing `unsigned` count missing the metrics commit; the literal macron letter in a `scripts/cleanroom-log.mjs` comment; `afterReset` running outside `withRollback`, so a failed and retried timeline commit counts `activateFailures` twice (not a regression); and a token straddling the probe's 1 MiB body cap surviving only behind a megabyte of whitespace.
