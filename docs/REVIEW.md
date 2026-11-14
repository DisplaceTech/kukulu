# Review: Kūkulu 0.9.0 (runner comparison metrics)
Round: 1

Branch `build/2026-11-14`, base `3832f3e` (main), head `ea5aa10`. 32 of 32 tasks done, none blocked or skipped.

## Verdict

CHANGES REQUESTED

`kukulu_verify` on the head is green: all 39 constraints self-test and scan clean, `npm run lint`, `pre-commit run --all-files` and `npm test` (5,275 assertions in sixteen suites) pass. Twelve mutants across every changed module were killed (see Notes). Three findings remain, one of them a token leak.

## Findings

### 1. Category 1 (reviewer-read constraint "no state, timeline, chain entry, feedback entry, tool result or halt reason holds a token value"; SPEC A-01): the probe leaks a prefix of the runner's token

- Where: `scripts/runner-probe.mjs:74` and `:97`. The error text of a non-2xx answer is built as `HTTP <status>: <body collapsed and cut to 300 characters>`, and only then does `redact(result, token)` replace the token's value. When the runner echoes the token in its body and the 300-character cut falls inside it, the remaining prefix no longer equals the token, so neither `redact` nor `main`'s second check on the serialized line removes it.
- Reproduced: a 401 whose body is 280 characters of padding, then ` auth was <x-api-key header>`, with the token `sk-SECRETTOKEN-0123456789abcdef`, prints `"error":"HTTP 401: xxxx… auth was sk-SECRETT"`.
- What breaks: the probe's `error` becomes the runner halt's reason (A-03), which is written to `state.halted` in the committed `.kukulu/state.json`, to `outcome.halted` in the committed `docs/METRICS.json`, and is pushed with the branch. Part of a secret reaches git history and the pull request. SPEC A-01 says the probe replaces every occurrence of the token in anything it prints, so that the value cannot reach the state or a halt reason.
- Minimal fix: redact the raw response body (and any error message) before it is collapsed and cut, so the cut can only shorten `<redacted>`, never the token; keep the final check on the serialized line.
- Task: P1-01.
- Why the existing test missed it: "a runner that echoes the Authorization header in a 401 body does not leak the token" (`test/routing.mjs:960`) uses a short body, so the cut never reaches the token.

### 2. Category 3 (tests) and SPEC C-02: `activateFailures` is lost when the failed activation is a flight's first timeline record

- Where: `mcp/server.mjs:5014` and `:4853`. `next()` calls `bumpCounter("activateFailures")` and then `recordTimeline(res, activation)`. When the state's timeline is empty (the flight's first record), `recordTimeline` deletes every file under `.kukulu/metrics/`, including the `counters.json` it was just given, and then builds `METRICS.json` from the emptied directory.
- Reproduced with the suite's own helpers (`mkFakeProbe`, `writeGlobalConfig`, `plannedRepo`, a warm `spark` implementer and no timeline): `kukulu_next` returns the halt, `counters.json` does not exist, `kukulu_status.counters` is `null`, and `docs/METRICS.json` has `friction.activateFailures: null`.
- What breaks: SPEC C-02 says A-03 increments `activateFailures`, and principle 7 says a number with a source is not `null`. A runner that fails on the first stage of a flight (the plan stage on a warm planner, which the plan's Decisions name as a case) halts the flight with no record of the failure in the metrics it writes. "activateFailures is 1, then 2" and "a halt from a failed activation writes it, with friction.activateFailures 1" pass only because their state already holds a `start plan` record.
- Minimal fix: empty `.kukulu/metrics/` before any counter of the call is bumped (for example in `next()` before the activation step, when the timeline is empty), or bump `activateFailures` after `recordTimeline` and before the metrics are built; either way the first record's emptying must never remove what the same call counted.
- Task: P1-04 (with P0-03's emptying and P2-08's write).

### 3. Category 5 (spec drift, model-facing contract): the `kukulu_next`, `kukulu_status` and `kukulu_pr_finalize` tool descriptions were not updated

- Where: `mcp/server.mjs:5825` (`kukulu_next`), `:5824` (`kukulu_status`), `:5934` (`kukulu_pr_finalize`), the `TOOLS` entries a client shows the model.
- What is wrong: `kukulu_next`'s description still says it "Writes only the stage timeline (state.timeline, and in clean-room mode a stage entry in the chain …)" and lists the result keys without `activation`, `metricsNote` or `countersNote`. Since P1-03, P1-04, P1-05 and P2-08 it also runs a runner probe that can take as long as a model load, can return a `halt` for a runner that does not serve its model, appends `runner-drift` and `metrics` feedback entries, writes `docs/METRICS.json` into the `chore: stage end` commit, and adds `.kukulu/metrics/` to `.git/info/exclude`. `kukulu_status`'s description does not name `counters`, `harness` or `activateSeconds`; `kukulu_pr_finalize`'s does not name the `chore: flight metrics` commit or `metricsNote`. SPEC §1 lists "`kukulu_next` can now take as long as a model load, and it can return a `halt`" as an upgrade point, and CLAUDE.md's principle is that documentation moves with the code; `docs/mcp-tools.md` was updated, the description a model actually reads was not, and "Writes only" is now false.
- What breaks: a controller or operator reading the tool list is told `kukulu_next` writes nothing but the timeline and returns quickly; nothing tells it that a long wait or a `runner …` halt is expected.
- Minimal fix: update the three descriptions to name the new behavior and result fields, matching `docs/mcp-tools.md`.
- Tasks: P1-03, P1-04, P2-01, P2-03, P2-08, P2-09.

## Spec issues

- I agree with every entry of PLAN.md's `## Spec issues`. The one that matters most to the owner: B-01's `cost` reads per-row `costUSD`, which current Claude Code transcripts do not carry, so every role's cost is `null` and Phase 2's manual check ("no `null` in the Anthropic flight's cost column") cannot pass as written. That is an owner decision (a rate table, or the session-wide `cost-state` row for the controller), not a fix task.
- SPEC A-01 says the probe "replaces every occurrence of the token's value", but also tells it to cut the error body to one line; it does not say which comes first. Finding 1 is the consequence. The SPEC should state that redaction precedes any truncation.

## Manual checks still owed

Copied from HANDOFF.md, all `NOT VERIFIED (human)`:

- Phase 0: after one general-mode flight on the working tree's plugin, `.kukulu/metrics/usage.jsonl` holds one record per stage and one controller record, and `git status` is clean.
- Phase 1: `node scripts/runner-probe.mjs --endpoint <a real runner> --models` lists its models; with `activate: "warm"` on a runner whose proxy swaps models, `kukulu_next` returns only after the model answers and the go-flight transcript shows the `ready in` line.
- Phase 2: `node scripts/compare-flights.mjs` on two real flights of one spec prints all five sections with no null in the Anthropic flight's cost column (expected to read `n/a` until the owner rules on cost; see Spec issues).
- Phase 3: the commands in `docs/local-runners.md` start a fully local session against the owner's inference host.
- `KUKULU_RUNNER_IT=1 KUKULU_RUNNER_IT_ENDPOINT=<url> node test/routing.mjs` runs the opt-in real-runner step.

## Notes

- Mutants, all killed: `mcp/metrics.mjs` (controller last-per-session dropped), `scripts/cleanroom-log.mjs` (`activeMs` timed to the first row, not the request's last), `scripts/implement-guard.mjs` (`total` not incremented), `scripts/runner-probe.mjs` (`max_tokens` 2), `scripts/compare-flights.mjs` (`.git`/`node_modules`/`target` not skipped), `mcp/cleanroom.mjs` (`laguna` without `poolside`), and in `mcp/server.mjs`: drift compared without `normalizeModel`, `verifyFailures` never bumped, the pre-rebase metrics commit removed under `resign`, and `kukulu_run_start`'s exclusion removed. No survivor, so no mutation task.
- `usageFromClaudeCode`'s `activeMs` loop calls `conv.indexOf(row)` and rescans `conv` for each counted request, which is quadratic in the transcript's length. Measured on a synthetic general-mode `Stop`: 1,000 requests 96 ms, 4,000 requests 443 ms, 8,000 requests 1,457 ms per hook run, re-run on every stop. SPEC states no budget for that path; an index from row to position and from `requestId` to its last row would make it linear.
- The logger creates `.kukulu/metrics/` without adding the exclusion itself; only `kukulu_run_start`, `kukulu_next` and `bumpCounter` do. A session in a clone that has `docs/kukulu.json` but has not yet called `kukulu_next` on 0.9.0 leaves `usage.jsonl` untracked in `git status` until it does.
- In the awaiting-signing path of `kukulu_pr_finalize`, the metrics commit is made after `signedCheck`, so `state.awaitingSigning.unsigned` counts one commit fewer than the branch holds. The next `resign` re-signs everything, so nothing is lost.
- `scripts/cleanroom-log.mjs`'s new general-mode comment spells the display name with the literal macron letter; the v0-9-0 notes ask for the escape in script source. It is a comment, and older comments in the same files do the same.
