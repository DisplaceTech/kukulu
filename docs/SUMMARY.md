# Summary: Kūkulu 0.7.1 build

**Merge line:** `build/2026-10-20`, base `870405426ff3` (main) → head `f0d0c81`, 44 commits, 2 reviews, final verdict **APPROVED** (round 2).

## What was built

**Phase 0 — The guard as a tripwire (P0-01 to P0-08).** The clean-room guard is now described everywhere as a tripwire, not a sandbox. There is one list of eight known limits, and the code, the docs and the bundle manifest all read it; it now names shell expansion and option parsing. The review and summarize skills got a triage rule. A guard finding becomes a fix task only for a regression, for a protected-path write or denied read whose spelling is already named, or for a missing command word. Every other unmodelled spelling goes under Known-gap candidates. A bare read-family operand (`cat zlib.txt`) now gets the same decision as `./zlib.txt`. Index-only git forms (`git add docs/*`) are no longer write targets, but `git diff --output=<protected>` is still denied. These are now denied: rsync into a protected path, recursive rsync into a directory that contains one, rsync remote operands, tar extraction into a protected directory (the repository root included), and tar create, append or update onto a protected archive path. `install -S`'s BSD-only denial now names its directory instead of `null`. Gate check 3, the genesis entry and the manifest now pin `mcp/cleanroom.mjs` by hash (`cleanroomHash`), and the verifier compares the pin.

**Phase 1 — Pipeline friction (P1-01 to P1-06).** `kukulu_plan_commit` renumber mode now rewrites ids inside the flight's CLAUDE.md notes section. The task, block, reopen and halt tools refuse text that would break a constraint covering `docs/PROGRESS.md`, before anything is written. A new key, `policies.syncBase` (default `true`), makes `kukulu_run_start` on an existing build branch, and a serial `kukulu_task_next`, merge new base-branch commits into the build branch with a signed `chore: merge` commit. The documentation of the `maxRoundsHard` cap now says what `kukulu_review_submit` actually does. `docs/cleanroom.md` now says a bundle's SUMMARY.md is the summary as it was attested.

**Phase 2 — Documentation and release (P2-01 to P2-03).** The README calls the guard a tripwire. The CHANGELOG has a `## [0.7.1] — 2026-10-20` entry, the version reads 0.7.1 everywhere, and the release check is recorded.

**Review fixes (R1-01 to R1-02).** These are tests only. R1-01 adds three tests: one for syncBase's failed merge commit, one for its unsigned-retry signing fallback, and one showing a plan with streams never merges in `kukulu_task_next`. R1-02 adds eight guard fixtures for tar append/update and `--get`, rsync `-e`, and the rsync and tar wildcard checks. The guard self-test now runs 509 cases, and `npm test` runs 3715 assertions.

## Decisions that shaped it

- (plan) Three phases in SPEC §8 order, fully serial, with no streams; `baseBranch` is `main`; flight slug `v0-7-1`.
- (plan, §9 Q1) Known-gap candidates are a bullet list under REVIEW.md's `## Spec issues`, and the summarize skill carries them into SUMMARY.md. The pipeline never edits SPEC or `KNOWN_LIMITS` without a task.
- (plan, §9 Q2) `policies.syncBase` defaults to `true`. This is an owner decision, not an assumption, and it is written once, in `cfgFrom`.
- (plan) Constraints: all 27 rules from v0-7-0 are carried over unchanged, and `progress-no-bare-macron` is added. Two `from` gates are dropped (`no-foundry-names`, the guard self-test). The file is ASCII-only, with JSON escapes.
- (plan) `maxRounds` and `maxRoundsHard` were meant to be 3 and 6, but `docs/kukulu.json` holds `maxRounds: 6` (see the review notes).
- (plan) This flight's `docs/kukulu.json` has no `policies` block, because the installed 0.7.0 would refuse `syncBase` as unknown.
- (plan, A-02 / P0-03) The word clause judges every operand that is not a dash and not a pattern, script or program operand. "Outside the repository" is still computed from path-like operands only. Path-like option tokens are judged as before.
- (plan, A-03 / P0-04) No short `-o` output option exists on `diff`, `log` or `show`, so only `--output` is a target. It is also recognized by the unique abbreviations `--outp` and `--outpu`.
- (plan, A-04 / P0-05) rsync sources are not write targets. Whole-call containment applies only to a recursive rsync. An rsync remote operand becomes a `deny.network` denial (which makes SPEC's sentence true). tar extraction at the repository root is denied (fail closed). tar also counts `A` (catenate) and `--delete` as writing an archive. An extraction into a directory under a protected path is denied, not only one into a directory that contains one. rsync and tar have their own rule block and are not in `WRITE_FAMILY`.
- (plan, A-05 / P0-06) The probe showed the BSD-only form was already denied, so only the message changed.
- (plan, A-06 / P0-07) `CHECKPOINT_KEYS` stays fixed, and checkpoints do not carry `cleanroomHash`. The pin lives in genesis, `state.cleanroom`, gate check 3 and the manifest. For a flight started on 0.7.0, the gate records `unpinned` and the verifier adds a note. `test/harness.mjs`'s `buildBundle` gained `opts.cleanroomHash`.
- (plan, B-01 / P1-01) A note is added when ids changed and the notes section or the flight slug is missing. Only a line starting `## ` ends the section; a `###` subsection stays inside it.
- (plan, B-02 / P1-02) The tools check the text exactly as the server would write it, line by line. The quote is the matching line, from at most 40 characters before the match, cut to 80. A `paths` entry of `.` or a directory prefix covers PROGRESS.md. The check runs after the argument checks and before any write (for `task_block`, before its reset). `run_halt`'s reason is checked although it is not written to PROGRESS.md. A constraint with no description prints `no description`.
- (plan, B-03 / P1-03) On a dirty tree there is no merge, and `baseSynced` reports `merge: null` with `skipped`. The sync runs at `run_start` on an existing branch (review-fix rounds included) and at a serial `task_next` only when the plan declares no streams. The merge is `--no-ff --no-commit`, then a no-pathspec commit through `commitStaged`, so the signing fallback and trailers apply. In clean-room mode a `base-sync` checkpoint is written first.
- (plan, B-04 / P1-04) The behavior is kept and the docs follow the code, including `docs/architecture.md` and `docs/operations.md`.
- (plan, B-05 / P1-05) The summarize skill was already correct, so only `docs/cleanroom.md` changed.
- (plan) CHANGELOG uses only Changed and Fixed headings. HANDOFF has no do-not-merge line.
- (P0-01) The literal macron letters in `docs/kukulu.json`'s constraint fixtures were rewritten as `\u` escapes, because check-names failed on them.
- (P2-02) The Unreleased entries were renamed only. The gitignored `docs/feedback/2026-10-20-kukulu.md` got its `Addressed in` line and is not staged.

## Assumptions still in play

No ⚠️ ASSUMPTION key was added or tuned in this flight. These keep their defaults and are still guesses:

- `policies.archive` = `false`
- `review.mutationFixRounds` = `2`
- `cleanroom.similarity.separationMargin` = `0.0`
- `cleanroom.idleGapHours` = `3`

`policies.syncBase` = `true` is an owner decision, not an assumption.

## Spec issues

Edits the owner should make to SPEC.md:

- A-04 says an rsync remote operand "is already a network command under `deny.network`". This was false at the base. P0-05 made it true. Either keep the sentence, or drop it and list rsync remotes as a known gap.
- A-04's tar rule denies every `tar x` at the repository root, because the root contains the always-protected set. This was kept as written (fail closed). SPEC should say so.
- A-04 does not say whether rsync sources are write targets, or whether containment is unconditional. The build resolved this: sources are not targets, and containment applies only to recursive calls.
- B-02 names `kukulu_run_halt`, but its reason does not go to PROGRESS.md. It is checked anyway.
- B-02's "matching text, at most 80 characters" is ambiguous. The build reads it as the matching line, from at most 40 characters before the match, cut to 80.
- B-03 does not cover a base that is ahead while the tree is dirty. The build skips the merge and reports `skipped`.
- A-03's "`-o` where the subcommand defines it" matches nothing in `diff`, `log` or `show`.
- B-04's doc fix also applies to `docs/architecture.md` and `docs/operations.md`'s `maxRoundsHard` row, which §4 does not list.
- A-06 does not say whether checkpoints carry `cleanroomHash`. They do not.
- (review) §1 "Why a patch version" says the guard denies "two command forms it allowed before (A-04)". It also newly denies A-02's bare read-family operand, the rsync remote operand and tar extraction at the root, so the sentence undercounts.

### Known-gap candidates

- rsync's deleting options are allowed: `--delete` with `-d`/`--dirs`, `--remove-source-files`, and `--delete-*` in general. For example, `rsync -d --delete empty/ docs/` removes `docs/cleanroom.json`.
- tar under another command word is allowed: `bsdtar` and `gtar`. For example, `bsdtar -xf a.tar -C docs`.

## Manual checks owed

- **Phase 0:** start a live clean-room session with the working-tree plugin (`claude --plugin-dir .`). Check that `git add docs/*` is allowed and `rsync evil/cleanroom.json docs/` is denied. Check that CI is green on the pushed branch: all twelve check runs were green on `cee1ee1`, so re-check on the final head.
- **Phase 1:** on a throwaway flight with the working-tree plugin, commit to the base branch after the build branch is cut. Then call `kukulu_task_next` and look for the `chore: merge` commit.
- **Phase 2:** check that the PR (#3) targets `main` and that its ci, lint and site checks are green.
- **Before merging:** run `npm test` once on a machine with the project's signing agent.

## Review history

- Round 1: CHANGES REQUESTED. 2 findings, 2 fix tasks (sources: review 2, mutation 0, blocked 0), not non-converging, no recurrence. The two findings were the untested syncBase failure, signing and parallel paths (P1-03 → R1-01), and the missing A-04 and wildcard fixtures (P0-05 → R1-02). Nine mutants survived.
- Round 2: APPROVED. 0 findings, 0 fix tasks, no recurrence. All nine round-1 survivors are now killed. This was a notes-only approval: REVIEW.md carries a `## Notes` section (below).

Notes flagged but not queued as work:

- Mutating `mcp/cleanroom.mjs` under the targeted `cleanroom` suite fails in the gate's self-test, and then the suite crashes on an unrelated `git checkout` (around `test/cleanroom.mjs:539`). The kill is real, but to see which fixture caught a mutant, run the guard self-test directly.
- In R1-01's failed-commit test, the "no merge is left in progress" assertion passes even without `git merge --abort`, because commitStaged's reset clears `MERGE_HEAD`. The tree and `base.txt` assertions in the same test do catch it.
- In `mcp/server.mjs`, `checkConstraints`'s doc comment now sits above `const constraintTests`.
- `KNOWN_LIMITS`'s doc comment cites SPEC D-03 instead of A-01.
- The recursive rsync denial quotes the destination form rather than the protected path.
- `docs/kukulu.json` has `maxRounds: 6`, while PLAN's Decisions says it keeps the default 3.

## Pipeline friction

- review, tool-gap: kukulu_status returned prChecks "unknown: unknown flag: --json" because the local gh (2.45.0) has no `gh pr checks --json`; the round-2 reviewer had to query CI by hand (gh pr checks without --json, or gh api .../check-runs). A fallback to the check-runs API or plain-text parsing would give the CI signal on older gh.

## Suggested CLAUDE.md additions

- `test/fixtures/guard-cases.json` is indented with one space. Append fixtures with a script that loads and dumps with `indent=1` and no ASCII escaping, so the diff stays one block per case.
- During a merge, git refuses `git commit -- <paths>`, so the server's merge commit uses a no-pathspec commit. When the merge is aborted, `withRollback` restores the clean-room log byte for byte.
- `kukulu_verify` output is large because it lists every constraint result. The useful part is `ok` and the `npm test` summary.
- The installed plugin (0.7.0) ran this flight, so none of the new behavior was active while it ran.

## Advisory mutation survivors

None.

## Breaking call

Breaking: yes. SPEC and CHANGELOG list no breaking changes, but the flight changes behavior an existing user relies on. The new `policies.syncBase` defaults to `true`, so `kukulu_run_start` and `kukulu_task_next` now merge the base branch automatically. The guard also newly denies command forms it allowed in 0.7.0 (`cat <bare file>`, rsync and tar into protected paths, rsync remotes, tar extraction at the root).
