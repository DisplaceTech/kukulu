# Review: Kūkulu 0.9.0 (runner comparison metrics)
Round: 2

Branch `build/2026-11-14`, base `3832f3e` (main), head `d5d9dfd`. 35 of 35 tasks done (32 planned, R1-01 to R1-03), none blocked or skipped. Last review commit `a379230`.

## Verdict

CHANGES REQUESTED

`kukulu_verify` on the head is green: all 39 constraints self-test and scan clean, `npm run lint`, `pre-commit run --all-files` and `npm test` (5,283 assertions in sixteen suites) pass. `prChecks` reads `{ state: "pending", failing: [] }`: not a finding. The three round-1 fixes do what they were asked, and each new test fails without its mechanic (see Notes). One finding remains, in the text R1-03 wrote.

## Findings

### 1. Category 5 (spec drift, model-facing contract): R1-03's `kukulu_status` description misstates `activateSeconds`, and `kukulu_next`'s description and `docs/mcp-tools.md`'s overview still say less than the tool does

- Where: `mcp/server.mjs:5827` (`kukulu_status`'s `TOOLS` description), `mcp/server.mjs:5828` (`kukulu_next`'s), `docs/mcp-tools.md:5`.
- What is wrong:
  - `kukulu_status`'s description now says `activateSeconds` is "how long the last runner activation waited". The code (`mcp/server.mjs:2505`–`2509`), SPEC (line 213: "per runner, the sum of `ms` over `ok` records, in whole seconds"), PLAN P1-03 and `docs/mcp-tools.md:51` all say it is an object keyed by runner holding the sum of every successful activation's wait, in whole seconds. R1-03's design constraints asked the descriptions to match `docs/mcp-tools.md`; this sentence contradicts it.
  - In `kukulu_next`'s description, R1-03 turned "Writes only the stage timeline … and, when a parallel wave's partition is invalid, a record …" into two sentences and left the second without a verb: "When a parallel wave's partition is invalid, a record (state, one feedback entry, one commit, only on a build branch) that the wave runs serially."
  - `docs/mcp-tools.md:5`, the overview a reader meets first, still says "`kukulu_next` answers from disk and writes only the stage timeline (and the wave record)", the claim R1-03 removed from the tool description because it is no longer true (it runs the runner probe, may append `runner-drift` and `metrics` feedback entries, and writes `docs/METRICS.json` on `done` and `halt`).
- What would break: a controller or operator reading `kukulu_status`'s description takes `activateSeconds` for one number about the last wait, when it is a per-runner object of totals, and misreads a flight's model-load cost; the overview tells a reader `kukulu_next` writes only the timeline.
- Minimal fix: say "activateSeconds (per runner, the total wait of its successful activations, in whole seconds)"; give the wave sentence its verb ("When a parallel wave's partition is invalid, it also writes a record … that the wave runs serially."); change `docs/mcp-tools.md:5` to say `kukulu_next` writes the stage timeline, the wave record and, on `done` and `halt`, `docs/METRICS.json`, and may run the runner probe first. No behavior changes.
- Task: R1-03 (descriptions), P1-03 (`activateSeconds`).

## Spec issues

- Unchanged from round 1: B-01's `cost` reads a per-row `costUSD` that current Claude Code transcripts do not carry, so Phase 2's "no null in the Anthropic flight's cost column" cannot pass as written; the owner decides (a rate table, or the session-wide `cost-state` row). SPEC A-01 should also say that redaction precedes any truncation (R1-01 now does it in that order).

## Manual checks still owed

Copied from HANDOFF.md, all `NOT VERIFIED (human)`:

- Phase 0: after one general-mode flight on the working tree's plugin, `.kukulu/metrics/usage.jsonl` holds one record per stage and one controller record, and `git status` is clean.
- Phase 1: `node scripts/runner-probe.mjs --endpoint <a real runner> --models` lists its models; with `activate: "warm"` on a runner whose proxy swaps models, `kukulu_next` returns only after the model answers and the go-flight transcript shows the `ready in` line.
- Phase 2: `node scripts/compare-flights.mjs` on two real flights of one spec prints all five sections with no null in the Anthropic flight's cost column (expected to read `n/a` until the owner rules on cost; see Spec issues).
- Phase 3: the commands in `docs/local-runners.md` start a fully local session against the owner's inference host.
- `KUKULU_RUNNER_IT=1 KUKULU_RUNNER_IT_ENDPOINT=<url> node test/routing.mjs` runs the opt-in real-runner step.

## Notes

- Mutants on the round-1 fix files, all killed with `confirmKill` (the unmutated tree passes): `scripts/runner-probe.mjs` with the pre-cut redaction removed (killed by "a token that straddles the 300-character cut is not leaked, not even in part"); `mcp/server.mjs` with `afterReset` run before the first-record emptying (killed by exactly the two new R1-02 assertions), and with `afterReset` never run (killed by "activateFailures is 1"); `mcp/server.mjs` with `chore: flight metrics` dropped from `kukulu_pr_finalize`'s description (killed by the new `test/protocol.mjs` assertion).
- R1-02 runs `afterReset` outside `withRollback`, so a timeline commit that fails and is retried on the next call counts `activateFailures` twice. The pre-fix code had the same property (the bump preceded `recordTimeline`), and the counter lives in the untracked `.kukulu/metrics/`, so this is not a regression.
- R1-01 redacts the body after it is capped at `MAX_BODY` (1 MiB). A token straddling that byte cap would survive as a prefix only if the first megabyte collapsed to fewer than 300 characters of output before it, which takes a runner that pads its answer with a megabyte of whitespace; not worth a task.
- Round 1's notes stand: the quadratic `activeMs` scan in `usageFromClaudeCode`, the logger not adding the `.kukulu/metrics/` exclusion itself, the awaiting-signing `unsigned` count missing the metrics commit, and the literal macron letter in a `scripts/cleanroom-log.mjs` comment.
