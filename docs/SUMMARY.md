# Summary: build/2026-11-11 (Kūkulu 0.8.1)

**Merge line:** `build/2026-11-11`, base `main` at `36df873` to head `f7e7432` (before this summary), 170 commits, 11 reviews, final verdict **APPROVED** (review 11).

## What was built

**Phase 0, the guard (P0-01 to P0-03, then fix rounds R1-02 to R10-01).** The clean-room guard judges `sed` as a write only when it runs in place, so a read-only `sed -n` of a protected file is allowed. A heredoc body is now treated as data unless a shell reads it. Most of the review rounds went into making that rule hard to get around. The guard does not read `<<` as a heredoc when it appears inside arithmetic, `${...}`, `$[...]`, array assignments, backticks, `[[ ... ]]`, extglob groups or comments. Each heredoc command is read two ways and denied when either reading denies. A body piped into a shell anywhere later in the pipeline is judged as commands. Each body and substitution is judged in the directory where its owning segment runs. Every line of a data body is checked for writes to protected paths. Nesting deeper than the limit is denied. A command containing the guard's reserved characters U+E001 or U+E002 is refused.

**Phase 1, long tool calls and after the flight (P1-01 to P1-06).** The plugin's `.mcp.json` sets a 24-hour MCP tool-call timeout. A command timeout at or above that limit is refused when the config loads. After the archive, `kukulu_next` no longer writes a clean-room genesis. `kukulu_release` reads the merged flight from `origin/<base>` and reports `localState` and `fastForward`. `kukulu_plan_commit` refuses a flight slug that an archive already uses.

**Phase 2, policies and evidence (P2-01 to P2-06).** `policies.finalize` now defaults to `"ready"`. Policies can be set in the global file and in profiles, layered default < global < profile < project, and `kukulu_config_show` reports them with `policySources`. Similarity pairs can carry a `group`, which the scorer, `SIMILARITY.md` and `compare-bundles` all report. An alias that resolves to the declared model is no longer reported as a routing mismatch.

**Phase 3, stage handoffs, documentation and release (P3-01 to P3-06).** `kukulu_next` supplies the `description` for the `Agent` call. `kukulu_task_next` returns the task's own log as `taskLog`. The reviewer halts the flight with `owner action needed` when the only open item is blocked on the owner. A `cargo test` filter placed before `--` is refused. CHANGELOG 0.8.1 and the version bump are in.

## Decisions that shaped it

- Plan: four phases in SPEC §8 order, fully serial, with no parallel streams; base `main` was green at planning time; slug `v0-8-1`; `baseBranch` is `main`; `policies` is `{ archive: true, finalize: "ready" }`; `maxRounds` 3 and `maxRoundsHard` 6 at the start.
- Plan: all 32 constraints were carried over from v0-8-0. Their `from: "P2-02"` gates and the `extraVerify` entries' `from: "P2-01"` gates were dropped, because those ids name 0.8.0 tasks. `no-hardcoded-mcp-timeout` was added.
- Plan: §9 Q1 to Q6 were owner decisions: fixes only in this flight; `finalize` defaults to `"ready"` with global and profile overrides; similarity groups are supported; the MCP timeout is 24 h, written only in `.mcp.json`; the progress heartbeat is deferred; the reviewer's halt is a tool grant plus a skill rule.
- P0-01: a new export, `sedInPlace(args)`. `--` ends the option scan. A short option that starts with a letter is scanned letter by letter, so `-i.bak` counts as in place. sed's `w` command is a known gap.
- P0-02: a new export, `stripHeredocs(command)`, runs in front of `splitSegments`. A delimiter made only of digits is never a heredoc.
- R1-02: an unclosed `((` is not arithmetic.
- R2-04: a `{filter}` placed before the `cargo test` it belongs to is not judged against it. Only a missing `--` refuses in that case.
- P3-04: a `cargo test` with no standalone `--` is refused too.
- R5-01: an unclosed `!(` group extends to the end of the command. This mechanism was later replaced by R6-03's two readings.
- R6-02: only the operator's own line was scanned for the pipeline. R7-01 widened this, and R8-03 replaced it with an over-approximation.
- R6-03: the SPEC acceptance fixture `!(cat <<EOF` / `rm -rf .kukulu/cleanroom` / `EOF` / `)` is kept as **denied**, against SPEC A-02 rule 6.
- R8-02: a substitution's own `cd` still leaked into later segments. R9-02 changed this, so substitutions and `-c` strings now restore the directory, while `eval` still moves it.
- R8-03: an unrelated later `echo x | bash` over-denies. This was accepted per the task.
- R9-01: a data body is checked only for writes (`writeOnly`), so a read cannot mask a write. Ten named fixtures flipped to denied.
- R10-01: `bashVerdict`'s internal marker drop is kept for recursive calls. The refusal sits at the Bash entry of `evaluate`.
- P1-02: the `cfgFrom` signature matcher in `test/plugin.mjs` was widened for the new `limit` parameter. The refusal location reads `extraVerify['<prefix>'][<i>]`. The `commandTimeoutMs` key gets its own message form.
- P1-03: "no log" after the archive means no `log.jsonl`. The `.kukulu/cleanroom` directory remains.
- P1-04: `localState` is judged before the fast-forward, so a stale local base reports `stale` even when `fastForward` is `done`. `finalizeConfig` falls back to the archived `kukulu.json`.
- P1-05: the version digits come from the first `Version:` line of the SPEC. The slug collision is problem check `flight`.
- P2-01: `DEFAULT_STATE.policies` is now `cfgFrom({}, null).policies`. `finalizeRepo` in the tests merges in `finalize: "auto"` so the existing auto-merge cases keep their meaning.
- P2-02: `resolvePolicies` validates global and profile policies but does not check that the profile exists. `cfg()` returns layered policies, while `cfgFrom` stays project-only. Messages for non-project sources start with the file path and end with `; got <value>`.
- P2-03: `SIMILARITY.md` always lists a group line (`default` when no group is set), so its bytes change for existing configs. `verifyControlBundle` returns a map keyed by pair id.
- P2-04: the cross-score section uses the `default` group's negative, else the first group's. The `compare` fixture gained `default` on each control line.
- P2-05: the verifier note fires when any reported model is not `sameModel` with the declared one.
- P3-01: `description` is absent, not `null`, on `done` and `halt` results.
- P3-03: the review-build skill does not name `kukulu_run_resume`, and no server change was needed.
- P3-05: every SPEC §6 requirement already had a CHANGELOG line from its own task.
- B-01: `docs/operations.md` names the per-server `timeout` field but not the Claude Code version that introduced it. The implementer had no web access to look it up.
- Operator decisions on 2026-11-13: `maxRounds` went 3 → 5 → 7 and `maxRoundsHard` went 6 → 8 → 10.

## Assumptions still in play

- The MCP tool-call timeout of 24 hours, in `.mcp.json` only. It is still a guess and was not tuned.
- No other `⚠️ ASSUMPTION` key was added or tuned. `policies.finalize "ready"` and `policies.archive true` are owner decisions, written only in `cfgFrom`. The earlier assumptions (`review.mutationFixRounds` 2, `TARGET_MAX` 4000, `LOG_SOCKET_TIMEOUT_MS` 2000, `separationMargin` 0.0, `idleGapHours` 3, `MODEL_FAMILIES`) are unchanged.

## Spec issues

From PLAN.md:

- §3 principle 7 carries constraints whose `from` gates name 0.8.0 task ids. The gates were dropped.
- §6 C-03 says the archive-time refusal "gets the test it has never had", but that test already existed. P1-05 pinned the full text instead.
- §6 B-01 asks for the Claude Code version that introduced the per-server timeout. Nothing on disk names it, so the owner should fill in the number in `docs/operations.md`.
- §6 D-01's test needs `kukulu_config_show.policies` before D-02 adds it. P2-01 added it.
- §6 D-02's `; got` suffix appears only for non-project sources, which is a literal reading of the SPEC.
- §6 E-01 says `config` stays "as given" while normalization fills defaults. `group` is kept only when given.
- §4's line numbers are approximate. The tasks name functions instead.
- §6 F-02's changelog citation shares its id with requirement F-02, so lines cite the feedback item first.

From the review rounds:

- R6-03: SPEC A-02 rule 6 versus the denied `!(cat <<EOF … )` acceptance fixture. The owner should reconcile them.
- A-01's "a cluster that contains `i`" wording is broader than the getopt reading.
- `kukulu_flight_options` rewrites `docs/kukulu.json` with literal non-ASCII characters.
- Nothing re-checks an open fix task against a mid-flight SPEC edit (feedback `63ae64c`).

- **Known-gap candidates** (none queued):
  - `openSubstitutionStart` pops a `$(` frame at any `)`, a `case` pattern's `)` included. With the per-line write check on every data body, this can only cost a read.
  - Carried: the read-only gaps SPEC lists ("Known gaps (reads only)").
  - Carried: an escaped quote inside ANSI-C quoting.

## Manual checks owed

All are NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` is allowed, and so is a heredoc that writes prior-art paths into a scratch file. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the global file, `kukulu_config_show` in a project with no policies block reports `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and passes validation. `cargo test --workspace -- a b` runs both filters on stable Rust.
- **Rounds 6 to 10:** after push, the four PR checks pass: test on node 22, 24 and 26, and pre-commit. `prChecks` was `pending` at summary time.

## Review history

"Builds on the previous round" means the round's finding reopened code that the previous round's fix task had just changed. Every review carried a `## Notes` section.

- Round 1: 8 findings, 4 fix tasks (R1-01 to R1-04), 4 from review and 0 from mutation. This was the first round.
- Round 2: 4 findings, 4 fix tasks (R2-01 to R2-04), 3 from review and 1 from mutation. Non-converging. It builds on round 1: R1-02's guard survivors and R1-04's `cargo` check recurred, and the PLAN.md:525 red came from R1-01's task text.
- Round 3: 1 finding, 1 fix task (R3-01). It builds on round 2: R2-02 left the `stripHeredocs` region skipping incomplete.
- Round 4: 1 finding, 1 fix task (R4-01). Non-converging. It builds on round 3, in the same `stripHeredocs` area.
- Round 5: 1 finding, 1 fix task (R5-01). Non-converging. It builds on round 4: R4-01 reopened A-02's apostrophe hole. Round cap reached; the operator raised `maxRounds`.
- Round 6: 3 findings, 3 fix tasks (R6-01 to R6-03). Non-converging. It builds on round 5, because SPEC A-02 was edited mid-flight after R5-01 was queued. A `docs/kukulu.json` escape regression came from `kukulu_flight_options`.
- Round 7: 1 finding, 1 fix task (R7-01). It builds on round 6: R6-02's pipe detection was incomplete.
- Round 8: 3 findings, 3 fix tasks (R8-01 to R8-03). Non-converging. It builds on round 7, because SPEC A-02 was edited again after R7-01 was queued. Round cap reached; the operator raised it again.
- Round 9: 2 findings, 2 fix tasks (R9-01, R9-02). It builds on round 8: R8-02's ownership regression, plus the owner's A-02 edit `2892ee4`.
- Round 10: 2 findings, 1 fix task (R10-01). It builds on round 9: R9-01's depth check and R9-02's marker drop.
- Round 11: 0 findings, 0 fix tasks, **APPROVED**. This was a notes-only approval: one new advisory survivor plus carried notes (see below and Advisory mutation survivors).

Carried notes from round 1, flagged but never queued:

- `kukulu_next`'s `TOOLS` description omits `description` from its result shape.
- P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.

## Pipeline friction

One line per feedback entry, in the order logged (12 entries):

1. plan, carried-constraints: Carried constraints kept `from: "P2-01"`/`"P2-02"` gates that `kukulu_plan_commit` resolved against the new plan; the planner had to strip them by hand.
2. implement, verify-constraint: `no-hardcoded-mcp-timeout` failed on `docs/kukulu.json` itself, so `kukulu_verify` was `ok:false` on every task, and it also blocked `kukulu_task_done` logs that mention the value.
3. review, mutate-false-kill: `kukulu_mutate` counted every mutant as killed by `no-hardcoded-mcp-timeout`, which already failed on the unmutated tree. A constraint that fails at baseline should not count as a kill.
4. implement, tool-refusal: the reviewer-written R1-01 task text in PLAN.md spelled the display name in ASCII, so check-names failed at PLAN.md:525, and the implementer could not edit PLAN.md.
5. review, tool-gap: `kukulu_review_submit` appended task text to PLAN.md without running check-names on it, which turned lint, pre-commit and CI red for a whole fix round.
6. review (auto), round-cap: round 5 was non-converging (4 → 4 → 1 → 1 → 1), which reached `maxRounds=3` and needed a human decision.
7. implement, verify-red-baseline: check-names failed at `docs/kukulu.json:655` on a literal macron u, outside every task's files.
8. controller, tool-side-effect: `kukulu_flight_options` (`9d2f86b`) re-serialized `docs/kukulu.json` and turned the escapes back into the literal macron letter. The writer should keep non-ASCII escaped or edit only the keys it changes.
9. review, stale-plan-task: R5-01 was queued before the owner's SPEC A-02 edit (`4937aa4`) and ran unchanged, which cost a full fix round. Nothing re-checks open fix tasks against a SPEC edit.
10. review, verbose-output: `kukulu_mutate` returns the full 33-entry constraints result on every call. An ok-only summary would save reviewer context.
11. review, spec-drift-unchecked: the owner's SPEC A-02 edit (`61b3589`) after R7-01 was queued went unflagged, and the reviewer had to rediscover it from git log.
12. review (auto), round-cap: round 8 was non-converging (4 → 4 → 1 → 1 → 1 → 3 → 1 → 3), which reached `maxRounds=5` and needed a human decision.

## Suggested CLAUDE.md additions

- `kukulu_task_done` requires HEAD's subject to start with the task id, and `kukulu_feedback_log` makes its own commit. Log feedback only after `kukulu_task_done`; otherwise an empty marker commit with the task subject is needed.
- `stripHeredocs` is the new front of `splitSegments`. The internal `splitRaw` is the old splitter, and it is what `bashVerdict` calls on text whose heredoc bodies are already removed. Calling `splitSegments` on stripped text would swallow the lines after an operator as a body.
- Test source must not contain a line matching `sed -i`, because the `no-gnu-sed-inplace` constraint also hits assertion names. `test/cleanroom.mjs` builds its in-place sed commands from a `SED` variable.
- `cfg()` reads and validates the global config's `policies`, so a malformed global file is refused by every tool that calls `cfg()`.
- A constraint whose own `docs/kukulu.json` entry spells the forbidden literal must exclude `docs/kukulu.json` (R1-01 fixed this for `no-hardcoded-mcp-timeout`).

## Advisory mutation survivors

- **Advisory survivor: `bashVerdict`'s internal marker drop** (`mcp/cleanroom.mjs`, about line 1396). With the drop removed, both guard self-tests still pass. The entry refusal now keeps U+E001 and U+E002 out of the input. The segment loop strips every marker before it builds a `-c` or `eval` string, and `withBodies` strips the body tokens. As far as I can find, no recursive call receives a marker, so the drop is defensive dead code. Its comment ("one in the input would pass for a marker, so it is dropped first") no longer describes a reachable case. Removing the drop, or rewording the comment, is a readability cleanup for a later flight.
- **Carried advisory survivors:**
  - `stripHeredocs`' inner-owner selection (killed only by the `test/cleanroom.mjs` R9-02 ownership assertion);
  - `pipesIntoShellLater`'s `>|` exclusion;
  - `BARE_LETTER_EXEMPT`'s `^` anchor;
  - `conditionalEnd`'s closer boundary;
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape;
  - `expansionEnd`'s nesting and quote branches;
  - `validateMutation`'s `filterAt !== -1 &&`.

## Breaking call

Breaking: no. `CHANGELOG.md`'s newest entry, `## [0.8.1] — 2026-11-11`, has no `### Breaking changes` section.

Note: `policies.finalize`'s default changed from `"auto"` to `"ready"`. That is a config default existing users relied on: without an explicit `"auto"`, PRs no longer get auto-merge. It was an owner decision and it fails toward the safer behavior, but a strict reading would call it breaking.
