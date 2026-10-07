# Review: Foundry 0.5.0 build (build/2026-10-07)
Round: 4

## Verdict

APPROVED

R3-01 fixed the one problem round 3 left open. `.github/workflows/secret-scan.yml`
now sets `GITLEAKS_VERSION: "8.28.0"`, the same as the pre-commit gitleaks
`rev: v8.28.0`. `test/plugin.mjs` checks that the two versions match. It
also checks that `.gitleaks.toml` keeps `condition = "AND"` and a
`regexes` entry of exactly `0123456789ABCDEF`.

`.gitleaks.toml` is unchanged, as R3-01 required.

CI on the pushed head 6fd3e44 (PR 7) is all green. That covers `gitleaks`,
whose run 37682086186 logs `gitleaks version: 8.28.0` and "no leaks found".
It also covers actionlint, mermaid, pre-commit and all five `test` jobs,
including `test (macos)`.

Local `foundry_verify` is green:

- All five constraints pass, with no hits and no fixture failures.
- `npm run lint` and `pre-commit run --all-files` pass.
- All eleven suites pass, 2076 assertions.

Mutation sample, round 4. Per S-11, I mutated only files changed in
`git diff 43b6cf7..HEAD` (`lastReviewCommit` 43b6cf7), plus `.gitleaks.toml`,
whose round-3 survivor R3-01 was written to kill.

| File | Mutant | Result |
|---|---|---|
| .gitleaks.toml | the `regexes` line deleted, leaving a paths-only allowlist (survived in round 3) | killed (plugin) |
| .gitleaks.toml | `condition = "AND"` changed to `"OR"` | killed (plugin) |
| .github/workflows/secret-scan.yml | the `GITLEAKS_VERSION` pin deleted | killed (plugin) |

## Findings

None.

## Interpretation choices (HANDOFF.md)

Round 3's fix log says it made none. Rounds 1 through 3 reviewed the
earlier rounds' interpretation choices.

## Blocked and skipped tasks

None. All 35 tasks are done.

## Spec issues

The spec issues from rounds 1 through 3 still stand, and I do not repeat
them here. One of them remains relevant to this round. Section 7 treats
local verify as the whole verify. Round 3 showed that CI scanners must be
pinned to the same version as their pre-commit hook. This branch now
follows that rule for gitleaks, but no SPEC requires it.

## Manual checks still owed

- **Phase 1 (server).** Run one real flight on a throwaway spec with the
  working-tree plugin (`claude --plugin-dir .`). Confirm that the
  summarizer passes `content` and that no `Write` refusal appears.
  Re-signing with a real signing agent
  (`foundry_pr_finalize({ resign: true })`) has been tested only against a
  fake gpg. NOT VERIFIED (human).
- **Phase 2 (skills).** Read each changed `SKILL.md` top to bottom for
  contradictions with the tool reference. NOT VERIFIED (human).
- **Phase 3 (docs and release).** CI is green on this PR. I observed it
  green at 6fd3e44 (every check passes). A human should confirm this after
  this review commit is pushed.
- **Before merge.** Do not merge the PR until a human has run one 0.5.0
  flight from the working tree (HANDOFF.md's first line). Do not merge,
  tag or release.

## Notes

- The PR's gitleaks run still says "29 commits scanned", the same as in
  round 3. gitleaks-action seems to build its `pull_request` range from
  only the first page of the PR's commits. The two commits that hold the
  fixture value (P1-13 and P1-14) fall inside that range, so this PR run
  did test the allowlist. Later commits in the PR are covered only by the
  weekly full-history scan. That is outside this flight's scope.
- No mutant survived outside this round's diff, so there are no advisory
  survivors.
