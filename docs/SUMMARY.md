# Summary: Kūkulu 0.7.2 build

**Merge line:** `build/2026-10-26`, base `main` at 450fbfd → head 7396e69, 56 commits, 2 reviews, final verdict APPROVED (round 2).

## What was built

**Phase 0, the guard (P0-01 to P0-05).** First, P0-01 restores the agent `model:` and `effort:` defaults that 0.7.1 shipped. A commit made after the SPEC (418b291) had broken 44 test assertions and the `no-fable-default` constraint. Then the clean-room guard closes the two known-gap candidates from 0.7.1:

- rsync's deleting options (`--delete`, `--del`, `--delete-*`) are now treated as writes into their destination, and `--remove-source-files` is treated as a write to its sources (P0-02).
- `bsdtar` and `gtar` now get every decision `tar` gets (P0-03).
- The recursive rsync denial now names the protected path it reaches, and the 0.7.1 review's other advisory notes are addressed (P0-04).

**Phase 1, signing (P1-01 to P1-05).**

- A failed commit is now classified as a signing failure by an unsigned `commit-tree` probe, not by matching the signer's error text (P1-01).
- The local `commit.gpgsign false` that an `auto` fallback writes is lifted at the next `kukulu_run_start`, and signing is re-probed then (P1-02).
- `kukulu_pr_finalize` waits for signatures only when the policy expects them, and `kukulu_run_start` returns a `signingNote` (P1-03).
- Under `required`, a broken signer is reported by `kukulu_next` before the plan stage starts (P1-04).

**Phase 2, the PR and the release (P2-01 to P2-06).**

- The draft PR is titled `<flight>: <spec title>`, and a new optional key, `prTitle`, overrides it (P2-01).
- The merge commit's subject repeats the PR title and number (P2-02).
- `policies.archive` defaults to `true` (P2-03).
- `kukulu_pr_finalize` takes its breaking verdict from the newest `CHANGELOG.md` entry (P2-04).
- A round cap changed through `kukulu_flight_options` is recorded in PLAN.md's Decisions (P2-05).

**Phase 3, reviewer tools, documentation and release (P3-01 to P3-05).**

- `prChecks` falls back to the REST API on a gh without `pr checks --json`, such as 2.45.0 (P3-01).
- `kukulu_mutate`'s `filter` accepts a list (P3-02).
- `kukulu_mutate` reports whether each restored file differed in mode, content or by deletion (P3-03).
- CHANGELOG 0.7.2, the version bump and the feedback headers (P3-04).

**Review fixes (R1-01 to R1-03).**

- The fake signer key is allowlisted in `.gitleaks.toml` for the two more suites that use it, plus one allowlist scoped to the round 1 review commit (R1-01).
- Tests now cover B-02's kept fallback record and C-01's 120-character title cut (R1-02).
- Tests now kill the four remaining `mcp/server.mjs` mutation survivors (R1-03).

The tool count stays 25.

## Decisions that shaped it

From PLAN.md's Decisions:

- **Phases.** SPEC §8's four phases, run fully serial, none merged before the end. Flight slug `v0-7-2`, `baseBranch` `main`, `maxRounds` 3 and `maxRoundsHard` 6.
- **P0-01.** Restores the agent `model:` and `effort:` lines of `418b291^`, because the base was red: 44 assertions failed, and so did `no-fable-default`. It is a commit of its own, so the owner can drop it if the new defaults were meant.
- **Config.** `policies` is `{ "archive": true }` only. The 28 constraints of 0.7.1 are carried over unchanged, and `extraVerify` and `mutation.targeted` are the same as 0.7.1.
- **§9 Q1.** Finalize follows the signing policy (B-03, owner decision).
- **§9 Q2.** The default PR title is `<flight>: <spec title>` (C-01, owner decision).
- **§9 Q3.** `policies.archive` defaults to `true` (C-02, owner decision). It is no longer an ASSUMPTION.
- **§9 Q4.** The two known-gap candidates are fixed as guard rules, not added to `KNOWN_LIMITS` (A-01, A-02).
- **§9 Q6.** 0.7.1's suggested CLAUDE.md additions went into the guard-rule protocol and this flight's notes.
- **A-01 (P0-02), order.** Inside the rsync block the `--delete*` check runs first, then `--remove-source-files`, then the landing-path and containment checks.
- **A-01 (P0-02), reason text.** It reads `rsync --delete*` literally, and the destination is quoted as the command wrote it.
- **A-01 (P0-02), sources.** A `--remove-source-files` source is denied when it equals, contains or lies under a protected path. For the "under" case the reason names the source's own resolved path. This goes beyond SPEC's "equals or contains".
- **A-01 (P0-02), option matching.** Options are matched as whole tokens, or by the part before `=`. Abbreviations stay `KNOWN_LIMITS` entry 3.
- **A-03 (P0-04).** Only the reason of the fixture `rsync -a evil/ .kukulu/ (P0-05)` changes, and the change tightens it.
- **B-01 (P1-01).** The probe gets the empty tree's id from `git hash-object -t tree /dev/null`, so it works in SHA-256 repositories, and passes `--no-gpg-sign` explicitly. It runs only when `commit.gpgsign` reads true, and a probe that times out records `timed out`.
- **B-02 (P1-02), fresh run.** When the lifted override finds no operator signing, the run records `"none"` and deletes `signingOverride`.
- **B-02 (P1-02), already-started run.** The override is put back and the earlier `off (...)` record is kept.
- **B-02 (P1-02), repeat fallback.** A re-probe that falls back again is recorded like a fresh fallback.
- **B-02 (P1-02), same-call sync.** A fallback made by the same call's base sync is not re-probed in that call.
- **B-03 (P1-03), after an archive.** Finalize reads `signing` from the archived `state.json`. When `signing` is absent from both states, finalize waits, as it does today. `resign: true` counts as expecting signatures.
- **B-03 (P1-03), signingNote.** The `signingNote` texts are SPEC's two sentences. They are appended to `Run policies:` whenever `signing` is a string other than `"on"`.
- **B-04 (P1-04), unconfigured signer.** When `commit.gpgsign` is not true there is no probe and the plan reason is unchanged. `kukulu_run_start` still refuses that case under `required`.
- **B-04 (P1-04), policy source.** The policy is read from `docs/kukulu.json`, else the archived `kukulu.json` (or the pre-0.6.0 name). A config that is missing or malformed counts as not `required`.
- **C-01 (P2-01), length.** Length is counted in Unicode code points, both for the 120-character cut and for `prTitle` validation.
- **C-01 (P2-01), edge cases.** A heading that is only "Spec" is kept whole. `prTitle` is left out of the result when `pr create` failed.
- **C-01 (P2-02), merge subject.** The merge subject is `<title> (#<number>)`, not cut. The test `DRAFT_PR` carries `number` and `title`.
- **C-02 (P2-03).** `kukulu_config_show` gained an `archive` field, so the routing test has something to read.
- **C-03 (P2-04), placement.** The CHANGELOG check runs after the type checks and before `resign` and any write.
- **C-03 (P2-04), skill.** The summarize skill treats a `merge` value that starts with `enabled` as enabled.
- **C-04 (P2-05).** The new line goes after the last non-blank line of `## Decisions`. Nothing is recorded when there is no PLAN.md.
- **D-01 (P3-01), pagination.** One page of 100 check runs.
- **D-01 (P3-01), failing entries.** Seven entries fail in the fixture, not the six PLAN said. The reviewer confirmed that seven matches SPEC's mapping.
- **D-02 (P3-02).** A value that is not an array keeps today's string check and message.
- **D-03 (P3-03), comparison.** The working-tree blob is hashed with `git hash-object` for the comparison. Equal ids with different modes is `mode`.
- **D-03 (P3-03), project-f F-02.** Its cause was not identified, so `mode` is reported only when the blob ids are equal.
- **P1-03, README and architecture.** README's finalize sentence and table row, and `docs/architecture.md`'s finalize sentence, were corrected even though SPEC §4 does not list those files.
- **P3-04, CHANGELOG headings.** The entry uses only Changed and Fixed, with no Added and no Breaking changes heading. The `config_show` line sits under Changed. The feedback headers were edited on disk only, because those files are gitignored.
- **R1-01.** Besides widening the paths, a second gitleaks allowlist is scoped to commit 79f3342 and the same value, because the round 1 review quoted the fake key. The reviewer accepted it.

## Assumptions still in play

- No new ⚠️ ASSUMPTION keys.
- `policies.archive` now defaults to `true` in `cfgFrom` only. This is an owner decision, not an assumption.
- `review.mutationFixRounds`: 2. Untouched, still a guess.
- `cleanroom.similarity.separationMargin`: 0.0. Untouched, still a guess.
- `cleanroom.idleGapHours`: 3. Untouched, still a guess.
- `TARGET_MAX`: 4000. Untouched, still a guess.
- The site tunables in `docs/site/checks.json` (`copyFeedbackMs` 2400, `budget.textBytes` 65536, `budget.fontBytes` 184320, `budget.scriptBytes` 2048, `contrastMin` 4.5, `servePort` 8788) are untouched in this flight.

## Spec issues

From PLAN.md, each with how the plan resolved it:

- **§7 says every command runs on a clean `main`, but `418b291` fails 44 assertions and `no-fable-default`.** P0-01 restores the 0.7.1 defaults. If new defaults were meant, that is a SPEC change, and P0-01 is dropped.
- **Principle 5 cites an "existing unknown-key refusal" that does not exist for top-level keys.** `prTitle` is validated on its own, beside `flight`.
- **§4 omits `skills/go-flight/SKILL.md`, which B-04 needs.** P1-04 adds its one sentence.
- **B-02 says the already-started result "gains `signing`", but it already returns it.** It keeps it.
- **B-02 cannot recover an operator signing setting that was itself repo-local.** The fallback's `false` overwrote it. A later release could store the previous local value with the override.
- **B-03 reads `state.signing`, but C-02 archives before finalize, which resets state.** Finalize reads the archived `state.json`.
- **§6 E limits README changes, but B-03 made README's finalize sentence and row, and `docs/architecture.md`, wrong.** P1-03 corrected those sentences only.
- **B-01's SHA-1 empty-tree id is wrong in a SHA-256 repository.** The probe asks git for the id.
- **B-04 is silent on `required` with no `commit.gpgsign`.** There is no probe, and the plan reason is unchanged.
- **D-03's "differing blob ids" from `git diff --raw HEAD` cannot work, because the working-tree id is always zeros.** The working-tree blob is hashed.
- **§5.1's archive decision versus the 0.7.1 SUMMARY's ASSUMPTION list.** That list is history and stays.

From REVIEW.md rounds 1 and 2: none against SPEC itself.

- **Known-gap candidates** (principle 1; not tasks), carried from round 1 and unchanged:
  - rsync's older alias of the source-removing option, for example `rsync --remove-sent-files docs/cleanroom.json build/`;
  - another archiver's extraction, which no rule names, for example `cd docs && pax -r -f a.tar`.

## Manual checks owed

All are NOT VERIFIED by a human:

- **Phase 0.** In a live clean-room session, `rsync -d --delete empty/ docs/` and `bsdtar -xf a.tar -C docs` are denied.
- **Phase 1.** With a real SSH signer and `SSH_AUTH_SOCK` pointing at the wrong agent, `kukulu_plan_commit` under `auto` commits unsigned and logs the fallback. With the socket fixed, `kukulu_run_start` signs again.
- **Phase 2.** Once 0.7.2 is installed, the next flight's draft PR is titled `<flight>: <spec title>`. This flight's own PR was opened by the running 0.7.1 as `Build: <branch>`.
- **Phase 3.** On gh 2.45.0, `kukulu_status` reports the PR's checks with `via: "gh api"`.
- **Review fixes.** The CI `gitleaks` check passes on the pushed branch. The round 2 review confirmed it passed on 327b356.

## Review history

- **Round 1: CHANGES REQUESTED.** 4 findings, 3 fix tasks (sources: 2 review, 1 mutation, 0 blocked), not non-converging.
  - The findings were the PR's `gitleaks` failure, B-02's untested kept record, C-01's untested 120-character cut, and four other uncovered mechanics in `mcp/server.mjs`.
- **Round 2: APPROVED.** 0 findings, 0 fix tasks. No finding recurred. All seven round 1 survivors were re-applied and killed.
  - This was a notes-only approval. The `## Notes` section flagged, without queuing work:
    - P0-01 reverts the owner's 418b291 agent defaults.
    - `classifyChanges` could pair records wrongly under `diff.renames`; it falls back to `content` safely, and `--no-renames` would make it exact.
    - Inline synthetic gh error lines in `test/state.mjs` and `test/review.mjs` could move to `test/fixtures/gh/`.
    - `docs/mcp-tools.md`'s `kukulu_run_start` Returns list omits the `off (commit signing failed: …)` value. This predates the flight.
    - The commit-scoped gitleaks allowlist names the full sha of 79f3342. A rebase merge would rewrite that sha.

## Pipeline friction

- plan, base-health: The base branch was red (a post-SPEC commit to agents/*.md broke 44 npm test assertions and the no-fable-default constraint), and nothing in the pipeline said so; the planner found it only by running the full suite itself, twice. A base-health check (constraints plus verify on the base) reported by kukulu_status or kukulu_next before the plan stage would surface this before planning.
- implement (from HANDOFF): `kukulu_mutate` is not available to the implementer, so the R1-02 and R1-03 mutants were applied by hand.
- review (from round 1): `pre-commit run --all-files` cannot catch a gitleaks finding in the commit range, because the hook scans only staged changes. Local verify was green while the PR's CI failed.

## Suggested CLAUDE.md additions

- The `kukulu_verify` output is large. While iterating, run single suites with `node test/<suite>.mjs`, since the full `npm test` takes about 100 s.
- Test processes have no gpg config. Assert a signed commit by the `gpgsig` header in `git cat-file -p HEAD`, not by `%G?`.
- `mkRepo` sets a local `commit.gpgsign false`. A test that wants the operator's own global signing must unset it and pass `GIT_CONFIG_GLOBAL`.
- `DEFAULT_STATE.signing` is `null`, not undefined. Test it with `== null`.
- Unescaped double quotes inside a `TOOLS` description string break `node --check` for the whole server. Keep quoted headings out of those strings.
- markdownlint MD038 trips on code spans such as a level-2 heading marker followed by a space. Describe the heading in words.

## Advisory mutation survivors

None. Round 2's Notes list no survivors outside the diff, and all seven round 1 survivors were killed.

## Breaking call

Breaking: yes. The flight changed a config default (`policies.archive` from `false` to `true`), the draft PR title, the merge commit subject, and when `kukulu_pr_finalize` waits for signatures. Existing users rely on all four. CHANGELOG 0.7.2 lists no Breaking changes, so the owner may overrule this.
