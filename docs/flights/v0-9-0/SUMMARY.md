# Summary: Kūkulu 0.9.0 (runner comparison metrics)

**Merge line:** `build/2026-11-14`, base `3832f3e` (main) → head `526e916`, 90 commits, 3 reviews, final verdict APPROVED.

## What was built

**Phase 0, usage records (P0-01 to P0-06).** A single usage-record schema for every harness, validated by `validateUsageRecord` in the new pure module `mcp/metrics.mjs`. Claude Code's adapter, `usageFromClaudeCode` in `scripts/cleanroom-log.mjs`, replaces `usageOf`. Every flight now records token use per role. In general mode the records go to `.kukulu/metrics/usage.jsonl`, which is excluded per clone and never committed. In clean-room mode they go to the signed chain, whose `usage` entry carries the full record. The logger is also registered on `Stop`, so the controller session's usage is recorded. Usage entries work under the sandbox and in the verifier.

**Phase 1, probe and activation (P1-01 to P1-08).** `scripts/runner-probe.mjs` sends one request to a runner (`--models` or `--warm <id>`) and never prints the runner's token. Runners gain four keys: `activate`, `activateTimeoutMs`, `servedAs` and `tokenEnv`. The served id now shows in `kukulu_config_show` and the routing table. With `activate: "warm"`, `kukulu_next` warms a stage's runner before the stage starts and records the wait in the timeline and in `kukulu_status.activateSeconds`. `go-flight` prints a `ready in` line. If a runner does not serve the stage's model, the flight halts and the reason names what the runner does serve; `kukulu_run_resume` clears the halt. In clean-room mode the stage's start entry records the model requested, the model reported and the wait. A `runner-drift` feedback entry is written when those differ. P1-07 measured what the probe costs.

**Phase 2, metrics and comparison (P2-01 to P2-12).** A counters file and `kukulu_status.counters` track verify runs, verify failures, reopened tasks, guard re-blocks (the implement guard's lock now keeps a cumulative `total`) and activation failures. The harness name and version come from MCP `initialize`. `buildMetrics` covers outcome, wall time, rounds, tasks, friction, tree, usage, roles and totals. A new read-only tool, `kukulu_metrics`, returns them. Clean-room metrics read usage from the signed chain only. `docs/METRICS.json` is written when `kukulu_next` ends or halts a flight, and `kukulu_pr_finalize` commits it as `chore: flight metrics`. `policies.metrics` turns this off. `scripts/compare-flights.mjs` prints two flights side by side, and `--trees` adds tree size and similarity.

**Phase 3, local runners, documentation and release (P3-01 to P3-06).** `MODEL_FAMILIES` gains `laguna`. A `spark` profile with `activate: "warm"` and a llama-swap example were added to the templates. New `docs/local-runners.md`, a documentation sweep, and `CHANGELOG.md` 0.9.0 with the version bump.

**Review fixes (R1-01 to R1-03, R2-01).** The probe now redacts the token before it cuts the error body (R1-01). The `activateFailures` count survives a flight's first timeline record (R1-02). Three tool descriptions were corrected (R1-03 and R2-01).

## Decisions that shaped it

- Phases follow SPEC §8 in order, with none merged. The counters reader and writer arrive early, in P1-04, with `activateFailures` (C-02).
- The base was green: 4,875 assertions, and all 39 constraints self-tested and scanned clean. No base-fix task.
- No parallel streams; the plan is fully serial.
- Flight slug is `v0-9-0`, `baseBranch` is `main`, `maxRounds` is 4 and `maxRoundsHard` is 10. There is no `policies` block: the running 0.8.1 would refuse `policies.metrics`.
- Constraints: the 33 rules from v0-8-1 unchanged, plus SPEC §5.5's three (`metrics-module-pure`, `server-no-network`, `no-hardcoded-activate-timeout`), plus three added by the plan: `probe-node-only`, `compare-flights-imports`, `metrics-harness-neutral`.
- (P1-02) The `activateTimeoutMs` default lives in `runnerFor`, not `loadGlobalConfig`. Validation is in `validateRunners`.
- §9 Q1–Q12 owner answers: 0.9.0 is the metrics release and OpenCode is 0.10.0. Activation sends one request, with no configured command. The served id strips the longest `match` prefix, and `servedAs` overrides it. The server writes metrics at done, halt and finalize. General mode writes usage through the existing logger, with no new hook script. The summarizer's record after an archive is reported missing, never zero. Local cost is `null`. Engine metrics are not scraped. Clean-room metrics read the chain only. No R6-03 changes.
- (B-01) `apiErrors` counts rows that carry `isApiErrorMessage`. Those rows are still counted as requests.
- (P0-02, P0-04) `isSidechain` rows are skipped only for the controller record. Skipping them everywhere would empty every subagent record.
- (P0-02) For `activeMs`, a row means a `user` or `assistant` row with a timestamp. Bookkeeping rows are ignored.
- A usage record's `stage` and `round` come from `.kukulu/state.json` alone.
- Records are written by `SubagentStop` of the four role agents and by `Stop` (role `controller`).
- When an agent stops more than once: in general mode the later record supersedes the earlier one. In clean-room mode all of them are summed, so the totals equal `rolesUsage`'s recount. The controller keeps the last record per session in both modes.
- (P0-04) Gate check 3 now also requires the logger on `Stop`.
- (P0-03) `kukulu_next` empties `.kukulu/metrics/` at a flight's first timeline record, and adds the exclusion as `kukulu_run_start` does.
- (P1-03) Timeline order: the previous span's `end`, then the `activate` record, then the new span's `start`. Activation is skipped when `restartRequired` is true.
- (P1-04) The follow-up `--models` probe is capped by `RUNNER_LIST_TIMEOUT_MS` (10000). A warm runner with no endpoint is refused when the config loads. The probe has no default timeout.
- (P2-06) `kukulu_metrics` is added last in `TOOLS`, as an operator tool on no agent's tool list.
- (P2-05) The controller's `cost` is always `null`.
- `verifyFailures` counts only command failures. A call that fails only a constraint is a run, not a failure.
- Principle 6's feedback entry is written only by calls that already commit. Otherwise the note is in the tool result only.
- `wall.endedAt` is the last timeline record's time, or the time of the build while a span is still open.
- Tuning: `activateTimeoutMs` was measured in P1-07 and the default left to the owner. `MODEL_FAMILIES` before and after is in P3-01.
- HANDOFF.md has no "do not merge" line.
- P0-02: the "no state file" test uses a state that has a genesis but no timeline.
- P1-01: a usage error prints `runner-probe: <reason>`, then the usage text.
- P1-02: the MCP-limit refusal applies to an explicit `activateTimeoutMs`, and to the default only when `activate` is `warm`.
- P1-03: `activate` records are not copied into the chain. The `start` entry carries `data.activate` (P1-05).
- P1-04: `nextDecision(forcedHalt)` gives the activation halt the same shape as the other halts.
- P1-05: drift note 2 compares only the most recent successful activation of the same stage. `feedback.jsonl` always joins the timeline commit.
- P1-06: the skill says "a space and `(reports <reported>)`" to satisfy markdownlint.
- P2-02: a JSON lock without `total` starts it at 1. A `total` of 0 is still added to.
- P2-03: `kukulu_next` alone never writes the harness to state.
- P2-04: `outcome.caps` comes from the inputs even without a state. An absent `state.rounds` reads as `null` and an empty one as `[]`. `idleSeconds` is not clamped.
- P2-05: the controller keeps the last record per session in both sources. `usage.records` counts after supersession.
- P2-06: a fresh repository's tree has zero changed files, not `null`. The archived flight is read when the live state is empty.
- P2-07: after an archive, `usage.chainHead` includes the archive checkpoint.
- P2-08: a `docs/METRICS.json` that is a directory is detected before the rollback snapshot and reported as `metricsNote`.
- P2-09: the metrics commit goes after `chore: finalize flight`, at the head of the awaiting-signing path, and before the rebase under `resign`.
- P2-10: the comparison text ends in exactly one newline.
- P2-11: `--trees` takes up to two following values that do not start with `--`.
- P3-03: the limits paragraph states only what the Kūkulu record can show.
- P3-04: the activation step is drawn in the existing gate flowchart. Feedback-file headers were not touched.
- P3-05: the Unreleased lines were regrouped into one entry, in requirement order.
- R1-02: an `afterReset` callback on `recordTimeline` was used instead of reordering `next()`.

## Assumptions still in play

- `runners.<name>.activateTimeoutMs`: default 1800000 ms (30 min). Still a guess. P1-07 measured the probe's fixed cost (55.0 ms median), the refused-connection latency (80.0 ms) and the timeout overshoot (74.8 ms on a 1000 ms limit), but no real model load. See `docs/spikes/P1-07.md`.
- `MODEL_FAMILIES`: gained `laguna` as its last entry, measured before and after in `docs/spikes/P3-01.md`. It remains an ⚠️ ASSUMPTION table.
- Carried over and unchanged: `review.mutationFixRounds` 2, `cleanroom.similarity.separationMargin` 0.0, `cleanroom.idleGapHours` 3, the 50 ms hook budget, `TARGET_MAX` 4000, the 100 ms log-socket budget.
- `RUNNER_LIST_TIMEOUT_MS` (10000) is a fixed constant, not a tunable.

## Spec issues

- B-01's `isSidechain` skip would empty every subagent record. It applies to the controller only; reword B-01.
- B-01's `activeMs` "row before" definition: only `user` and `assistant` rows with a timestamp count.
- B-01's `cost` reads a per-row `costUSD` that current Claude Code transcripts do not carry, so every role's cost is `null`. Phase 2's manual check ("no null in the Anthropic flight's cost column") cannot pass as written. Owner decision needed: a rate table (a new ⚠️ ASSUMPTION) or the session-wide `cost-state` row. Raised by the plan and by all three reviews.
- B-01: API-error rows (`<synthetic>`) are still counted as requests. Proposed: stop counting them in a later release.
- B-01's "both copies of the adapter" test and §9 Q5's "a second hook script" contradict principle 13 and Q10. Only one copy was built.
- B-05: clean-room sums count repeated stops again, but general mode supersedes them, so the two modes differ whenever the guard re-blocked. Proposed: the same supersede rule in both copies of `rolesUsage`.
- §5.5 and A-02 place `activateTimeoutMs` validation and the default in `loadGlobalConfig`. They are actually in `validateRunners` and `runnerFor`.
- A-02 lists no refusal for a warm runner with no endpoint. One was added.
- A-03 step 3's follow-up probe was unbounded. It is now capped at 10 s.
- §5.4: `kukulu_next` also adds the `.kukulu/metrics/` exclusion and empties the directory between flights.
- §3 principle 6: a feedback entry is written only by calls that already commit.
- §3 principle 15 says three constraints are added. Six were added.
- C-01: the controller has no runner, so its `cost` is always `null`.
- C-01's v0-8-0 fixture has no timeline, so synthetic inputs cover timelines.
- E-01's external links should be re-checked before release.
- A-01 should say that redaction comes before any truncation (review round 1, finding 1).

Known-gap candidates: none in the final REVIEW.md.

## Manual checks owed

- Phase 0: after one general-mode flight on the working tree's plugin, `.kukulu/metrics/usage.jsonl` holds one record per stage and one controller record, and `git status` is clean.
- Phase 1: `node scripts/runner-probe.mjs --endpoint <a real runner> --models` lists the runner's models. With `activate: "warm"` on a runner whose proxy swaps models, `kukulu_next` returns only after the model answers, and the go-flight transcript shows the `ready in` line.
- Phase 2: `node scripts/compare-flights.mjs` on two real flights of one spec prints all five sections. The cost column is expected to read `n/a` until the owner rules on cost.
- Phase 3: the commands in `docs/local-runners.md` start a fully local session against the owner's inference host.
- `KUKULU_RUNNER_IT=1 KUKULU_RUNNER_IT_ENDPOINT=<url> node test/routing.mjs` runs the opt-in real-runner step.

## Review history

- Round 1: CHANGES REQUESTED. 3 findings and 3 fix tasks (review 3, mutation 0, blocked 0): the probe leaked a token prefix (P1-01), `activateFailures` was lost on a flight's first record (P1-04), and three tool descriptions were stale (P1-03, P1-04, P2-01, P2-03, P2-08, P2-09).
- Round 2: CHANGES REQUESTED. 1 finding and 1 fix task (review 1): R1-03's descriptions misstated `activateSeconds`, and the `mcp-tools.md` overview was stale. This recurred: P1-03 and the description work were named in rounds 1 and 2.
- Round 3: APPROVED. 0 findings and 0 fix tasks. A notes-only approval: its `## Notes` flag that the overview does not mention the `runner-drift` and `metrics` feedback entries. It also carries forward the earlier notes:
  - the quadratic `activeMs` scan in `usageFromClaudeCode` (1,457 ms per hook run at 8,000 requests)
  - the logger does not add the `.kukulu/metrics/` exclusion itself
  - the awaiting-signing `unsigned` count misses the metrics commit
  - a literal macron letter in a `scripts/cleanroom-log.mjs` comment
  - `afterReset` runs outside `withRollback`, so a retried timeline commit counts `activateFailures` twice
  - a token straddling the probe's 1 MiB body cap survives only behind a megabyte of whitespace

  No round was non-converging.

## Pipeline friction

- plan, plan-prevalidation: kukulu_plan_commit checks the plan's structure but runs neither the constraints' fixture self-test and scan nor the project's lint over the new files, so to know the first kukulu_verify would not start red the planner had to hand-write a constraint self-test and scan script and run lint, pre-commit and the plugin suite with the untracked plan files staged through git add -N. A dry-run mode (or a constraints-only check in kukulu_plan_commit) would remove that.

## Suggested CLAUDE.md additions

- `kukulu_verify` runs the whole suite (about 8 minutes). The `cleanroom` suite alone takes about 150 s and the `state` suite about 120 s, so run them in the background.
- A new doc file must be tracked (`git add`) before `test/plugin.mjs` can pass its relative-link check.
- The harness's `eq` uses `Object.is`. Compare arrays and objects through `JSON.stringify`.
- `no-hardcoded-mcp-timeout` scans `test/` too. A test must not spell the limit's millisecond literal, even to assert its absence.
- `withRollback` snapshots paths with `readFileSync`, which throws on a directory. Check any path that may be a directory before it joins the list.
- A test that archives a flight needs `.kukulu/metrics/` excluded first, or the untracked `usage.jsonl` makes the tree dirty.
- `kukulu_pr_finalize` now makes a `chore: flight metrics` commit. Tests that assert the head after finalize expect it to follow `chore: finalize flight`.
- `end-of-file-fixer` strips a trailing blank line, so any expected-output fixture must end in exactly one newline.
- The probe reads its token from the environment only. The server never reads the variable named by `tokenEnv`, and a test searches the state, chain and feedback file for the marker.

## Advisory mutation survivors

None. Every mutant in all three rounds was killed.

## Breaking call

Breaking: no — CHANGELOG.md's newest entry (0.9.0) has no `### Breaking changes` section. Note: gate check 3 now pins the logger on `Stop`, so a clean-room flight started on 0.8.x cannot continue on 0.9.0. The changelog lists this under Changed, and the owner may want it called out as breaking for clean-room users.
