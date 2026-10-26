# Handoff: Kūkulu 0.7.2 build

Branch `build/2026-10-26`, base `main` at 450fbfd (plan commit 6d2af7c). Tasks: 21 done, 0 blocked, 0 skipped. `kukulu_verify` is green (3855 assertions, guard self-test 524 cases). Nothing here needs a human to run before merging.

## Blocked and skipped

None.

## Interpretation choices

- P0-02: a rsync source that lies under a protected path names its own resolved path in the reason; equal or containing names the protected path.
- P0-03: `tar -cf build/a.tar /usr/include` is denied by the shared `plain()` path, so the `deny.paths` fixture was kept.
- P0-04: the changed fixture is `rsync -a evil/ .kukulu/ (P0-05)`, reason only.
- P1-01: the probe runs only when `commit.gpgsign` reads true; a timed-out probe's line is `timed out`.
- P1-02: a fallback made by the same call's base sync is not re-probed in that call (`overrideBefore` is captured before the sync); only a pre-existing override is.
- P1-03: `resign: true` counts as expecting signatures; an archived state with a null `signing` is treated as expected (conservative).
- P1-04: the plan-stage policy is read from `docs/kukulu.json`, else the archived `kukulu.json` (or the pre-0.6.0 name); no config counts as not `required`.
- P2-01: a spec heading that is only "Spec" (no separator) is kept whole; `prTitle` is omitted from the result when `pr create` failed.
- P2-02: the test `DRAFT_PR` now carries `number` and `title`.
- P2-03: `kukulu_config_show` gained an `archive` field (documented), because it did not report policies and the planned routing test needed something to read.
- P2-04: the summarize skill's status line matches `merge` values starting with `enabled`, since P2-02 can return `enabled (default subject: ...)`.
- P3-01: seven entries fail in the fixture (five check-run conclusions plus the `failure` and `error` statuses), not the six the task text says; the test asserts those seven.
- P3-03: could not identify project-f F-02's cause from here; the classification is `mode` only when blob ids are equal.
- P3-04: the `config_show` archive line sits under Changed (the entry has only Changed and Fixed). The three feedback files got their `Addressed in:` header on disk only (gitignored, never staged).

## Assumptions

No new ⚠️ ASSUMPTION keys. `policies.archive` now defaults to `true` in `cfgFrom` only, as an owner decision, not tuned. `review.mutationFixRounds` (2) is untouched.

## Manual checks (all NOT VERIFIED by a human)

- Phase 0: in a live clean-room session, `rsync -d --delete empty/ docs/` and `bsdtar -xf a.tar -C docs` are denied.
- Phase 1: with a real SSH signer and `SSH_AUTH_SOCK` pointing at the wrong agent, `kukulu_plan_commit` under `auto` commits unsigned and logs the fallback; with the socket fixed, `kukulu_run_start` signs again.
- Phase 2: once 0.7.2 is installed, the next flight's draft PR is titled `<flight>: <spec title>`. This flight's own PR was opened by the running 0.7.1 as `Build: <branch>`.
- Phase 3: on gh 2.45.0, `kukulu_status` reports the PR's checks with `via: "gh api"`.

## For the reviewer

- P0-01 reverts the agent `model:`/`effort:` lines of 418b291 (they failed 44 assertions and `no-fable-default`). Drop that commit if the shipped defaults were meant to change.
- The running server is 0.7.1, so new refusals (for example the CHANGELOG-decides-breaking rule) apply only after 0.7.2 is installed. This entry has no Breaking changes section, so under the new rule it is not breaking.
- `no-sync-merge` still passes: the `gh pr merge` array is one inline literal with `"--auto"` right after `"merge"`.
- Fixtures changed: only `rsync -a evil/ .kukulu/ (P0-05)`'s reason; the rest are additions.

## Codebase notes

- `kukulu_verify` output is large; run single suites with `node test/<suite>.mjs` while iterating, since the full `npm test` takes about 100 s.
- Test processes have no gpg config, so a signed commit is asserted by the `gpgsig` header in `git cat-file -p HEAD`, not by `%G?`.
- `mkRepo` sets a local `commit.gpgsign false`; a test that wants the operator's own global signing must unset it and pass `GIT_CONFIG_GLOBAL`.
- `DEFAULT_STATE.signing` is `null`, not undefined; test with `== null`.
- Unescaped double quotes inside a `TOOLS` description string break `node --check` for the whole server; keep quoted headings out of those strings.
- A markdownlint MD038 trips on code spans such as `` `## ` ``; describe the heading in words.

## Round 1

Branch build/2026-10-26; three fix tasks, all done (24 of 24 tasks done, none blocked or skipped).

- R1-01: `.gitleaks.toml` allowlist widened to `test/(harness|review|state|implement).mjs`. Interpretation: the round 1 review (79f3342) also quotes the fake key in `docs/REVIEW.md`, which the range scan flagged; a second allowlist scoped to that commit and the same value covers it, because a docs path would break `test/plugin.mjs`'s tests-only paths check. Local `gitleaks git` range scan reports no leaks.
- R1-02: tests for B-02's kept fallback record on a resumed run and C-01's 120-code-point title cut (`test/implement.mjs`).
- R1-03: tests killing the four remaining server mutants (fresh-path none, code-point length check, title separators, gh unknown-flag fallback) in `implement`, `routing` and `state`. `mcp/server.mjs` is unchanged.
- Mutants were applied by hand, since `kukulu_mutate` is not available to the implementer; each was killed by its new test.
- Check after the push that the CI `gitleaks` check passes.
