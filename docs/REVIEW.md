# Review: Foundry 0.5.0 build (build/2026-10-07)
Round: 1

## Verdict

CHANGES REQUESTED

The branch is in good shape. `foundry_verify` is green: all four constraints
pass with no hits and no fixture failures, and lint, pre-commit and all
eleven suites pass (2043 assertions). Every task in PLAN.md landed in its own
commit with its tests. Nothing under `docs/plans/` or `docs/SPEC.md` changed.
Under `docs/feedback/`, only the "addressed in" header lines changed.
`TASK_ID`, `TASK_LINE`, the guard and the `fable` aliases are untouched.

Three things block approval. One is a principle-6 hole in the new commit
helper. The second is a group of round-1 mutation survivors in
`mcp/server.mjs` and `agents/summarizer.md`. The third is S-10 drift in
README.md, which is not tested.

Mutation sample, round 1 (full suite per mutant, as SPEC section 7 expects):

| File | Mutant | Result |
|---|---|---|
| mcp/server.mjs | targeted `{filter}` substituted unquoted | **survived** |
| mcp/server.mjs | `strayArtifacts` ignores "only while PLAN.md is absent" | **survived** |
| mcp/server.mjs | `ordinal()` loses the 11th–13th rule | **survived** |
| mcp/server.mjs | `inactiveUntil` drops the in-progress (`~`) case | killed (implement, constraints) |
| mcp/server.mjs | `signedCheck` no longer treats `B` as unsigned | killed (review) |
| mcp/server.mjs | `withRollback` no longer writes snapshots back | killed (implement, review) |
| mcp/server.mjs | renumber's "a task is not `[ ]`" started-check removed | killed (state) |
| mcp/server.mjs | all-signed `pr_finalize` no longer clears `signingOverride` | **survived** |
| skills/summarize/SKILL.md | "Never pass `resign`" inverted | killed (plugin) |
| agents/summarizer.md | `foundry_pr_finalize` dropped from `tools:` | **survived** |
| agents/summarizer.md | `foundry_flight_archive` dropped from `tools:` | **survived** |
| agents/summarizer.md | `foundry_summary_commit` dropped from `tools:` | **survived** |
| agents/summarizer.md | `model: opus` → `model: sonnet` | killed (routing) |

Following the round-1 rule (S-11), each file with a survivor got at least
three more mutations, and each such file gets one R-task listing every
survivor found in it.

## Findings

### 1. Constraint (principle 6, "rollback on a failed commit"): the signing fallback can half-apply

- **Where:** `mcp/server.mjs:133-144` (`commitStaged`). Callers affected:
  `taskDone`, `taskBlock` and `taskReopen` (`withRollback([P.progress])`);
  `runFinish`'s handoff commit; `flightOptions` without `resume` (`[P.config]`);
  `reviewSubmit` APPROVED (`[P.review, P.state]`); `prFinalize`'s all-signed
  commit (`[P.state]`); `planCommit` (PLAN, PROGRESS, config, CLAUDE.md).
- **What is wrong:** under `policies.signing: "auto"`, a first commit that
  fails at signing makes `commitStaged` do three things before it retries: set
  local `commit.gpgsign false`, write `.foundry/state.json` (`signing`,
  `signingOverride`), and append a `signing` entry to
  `.foundry/feedback.jsonl`. It then stages both files. If the unsigned retry
  also fails, it throws, and the caller's `withRollback` restores only the
  caller's own paths. Most callers do not list state.json or feedback.jsonl,
  so the tool leaves both files modified and staged. Where state.json *is*
  restored, the local `commit.gpgsign=false` override survives while state no
  longer records `signingOverride`, so S-14's resign and finalize paths can
  never undo it.
- **What would break:** a retry can fail because a slow hook times out a
  second time, or because a hook rejects only the second attempt. When it
  does, the tree is dirty after a refused tool, and the next `task_done` or
  `run_finish` refuses on a dirty tree. The local signing override is then
  orphaned for every later flight.
- **Minimal fix:** before its fallback writes anything, `commitStaged`
  snapshots state.json, feedback.jsonl and the local `commit.gpgsign` value.
  If the retry fails, it restores all three and unstages the two files before
  it throws. That fixes every caller in one place. Do not widen each
  `withRollback` list instead.
- **Task:** R1-01 (from P1-02/P1-03).

### 2. Tests: four `mcp/server.mjs` mechanics survive mutation

- `mcp/server.mjs:2386`: the targeted command substitutes `filter` unquoted
  (`'${filter}'` becomes `${filter}`) and the suite still passes. The only test
  uses a filter with no shell-significant character. SPEC S-04 requires one
  single-quoted shell word, and `MUTATION_FILTER` admits a backslash, which an
  unquoted word would eat.
- `mcp/server.mjs:1454`: `strayArtifacts` reports untracked artifacts even
  while PLAN.md exists, and the suite still passes. SPEC S-08 says "untracked
  while `PLAN.md` is absent". No test has an untracked artifact next to a
  present plan.
- `mcp/server.mjs:2626`: `ordinal()` loses its 11th–13th rule and the suite
  still passes. PLAN P1-09 lists 11th, 12th, 13th, 111th. Only 2nd and 3rd
  are tested.
- `mcp/server.mjs:2916-2920`: the non-resign all-signed path no longer
  unsets the local `commit.gpgsign` override or clears `signingOverride`, and
  the suite still passes. PLAN's Decisions and SPEC S-14's manual re-sign path
  (`git rebase … --gpg-sign`, force-push, `foundry_pr_finalize({})`) rely on
  this path. The resign test never reaches it, because resign deletes
  `signingOverride` first.
- **Fix:** tests only, one per survivor, each of which fails against the
  mutant above.
- **Task:** R1-02.

### 3. Tests: the agent tool lists, the contract SPEC section 4 names, are not asserted

- **Where:** `agents/summarizer.md:6`, and the same gap for `agents/planner.md`.
- **What is wrong:** you can delete `foundry_pr_finalize`,
  `foundry_flight_archive` or `foundry_summary_commit` from the summarizer's
  `tools:` and every suite still passes. `test/plugin.mjs` checks that the
  listed tools exist, but never that a role has the tools its skill tells it
  to call.
- **What would break:** the summarizer's last call (`foundry_pr_finalize`) or
  its archive call would be denied in a real flight, silently, after the
  summary is committed.
- **Fix:** assertions in `test/plugin.mjs` that SPEC section 4's additions
  are present: planner has `foundry_plan_commit`; summarizer has
  `foundry_summary_commit`, `foundry_flight_archive` and `foundry_pr_finalize`.
- **Task:** R1-03.

### 4. Spec drift (S-10, PLAN P1-01): README still gives the summarizer `fable`

- **Where:** `README.md:72` reads `summarizer` (fable, medium). `README.md:56`
  says only "the planner and reviewer use `opus`". `docs/routing.md:302` calls
  the planner's `opus` "(unchanged)", but it changed in this release.
- **What is wrong:** SPEC S-10 and PLAN P1-01 require the README's defaults
  sentence to say `opus` for the summarizer. The implementer changed planner
  and reviewer only. No test compares the README to the agents' frontmatter.
- **What would break:** users read the wrong default for the role whose
  default changed.
- **Fix:** correct the three lines, and add a `test/plugin.mjs` assertion that
  README's "Four stage agents" sentence names each agent with its frontmatter
  model and effort.
- **Task:** R1-03 (same test file as finding 3).

## Interpretation choices (HANDOFF.md)

Every listed choice is the reading most consistent with SPEC:

- P1-04's check order.
- P1-05's handling of skipped commands in `killed`.
- P1-06's literal filter regex.
- P1-09's clearing of a stale `haltCap`.
- P1-10's `from` check inside the validator.
- P1-11's definition of "started".
- P1-12's pathspec handling.
- P1-13's `gh pr ready` failure and `pr: none` values.
- P1-14's extra `resignPush`.
- P2-01's status order.
- P3-03's template rewrite.

None of them is a finding.

## Blocked and skipped tasks

None.

## Spec issues

1. **S-14 under `policies.signing: "off"`.** The signed check deliberately
   ignores policy, so a project that chose not to sign ends every flight in
   `awaitingSigning`. That means a `signing` feedback entry, a
   `## Awaiting signing` section appended to SUMMARY.md, and `foundry_next`
   reporting `done: awaiting signing`, even with `policies.finalize: "draft"`.
   S-14's text frames this as "if signing failed", which an explicit `off` is
   not. A later spec should decide whether `off` (or `finalize: "draft"`)
   skips the awaiting path.
2. **S-02's 30-second bound** classes any timed-out commit as a signing
   failure. A commit hook that runs longer than 30 s turns signing off for
   the run. SPEC asks for the probe's bound, so this is spec-conformant, but
   the classification is broader than "signing".

## Manual checks still owed

- Phase 1 (server): run one real flight on a throwaway spec with the
  working-tree plugin (`claude --plugin-dir .`) and confirm the summarizer
  passes `content` and no `Write` refusal appears. Re-signing with a real
  signing agent (`foundry_pr_finalize({ resign: true })`) is tested only
  against a fake gpg: NOT VERIFIED (human).
- Phase 2 (skills): read each changed `SKILL.md` top to bottom for
  contradictions with the tool reference. NOT VERIFIED (human).
- Phase 3 (docs and release): CI is green on this PR. NOT VERIFIED (human).
- The PR must not be merged until a human has run one 0.5.0 flight from the
  working tree (HANDOFF.md's first line).

## Notes

- `foundry_feedback_log`, `foundry_task_next`'s auto-skip commit, the stream
  tools' commits, and `foundry_next`'s serial-wave record are not wrapped in
  `withRollback`. SPEC S-02's list does not name them, so this is not a
  finding. R1-01's fix in `commitStaged` covers their fallback half of the
  problem anyway.
- The `filter` refusal message lists `_ . : / -` but not the backslash that
  `MUTATION_FILTER` admits.
- `prFinalize`'s all-signed path unsets the local override before its commit
  and outside the rollback. If that commit fails, state again says
  `signingOverride: true` while the config is already unset. This is
  harmless, because a later call unsets again with `allowFail`.
