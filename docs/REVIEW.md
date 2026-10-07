# Review: Foundry 0.5.0 build (build/2026-10-07)
Round: 3

## Verdict

CHANGES REQUESTED

Two of the round-2 fixes are done. R2-01's portable `pr ready` flip turned
`test (macos)` green. `gh pr checks 7` now shows every test job passing,
and `no-gnu-sed-inplace` passes its fixtures with no hits. R2-03's test
kills the `--unset` mutant that survived round 2.

R2-02 did not fix CI. The PR's `gitleaks` check is still red (run
37679945856), and the operator asked that the PR not be approved while any
check is red.

Local `foundry_verify` is green. All five constraints pass with no hits and
no fixture failures. Lint, pre-commit and all eleven suites pass (2074
assertions).

Mutation sample, round 3. Per S-11, this round mutates only files changed in
`git diff f0ec6ed..HEAD` (`lastReviewCommit` f0ec6ed), plus the server line
that R2-03's test exists to cover.

| File | Mutant | Result |
|---|---|---|
| mcp/server.mjs:142 | R2-03: `undoFallback` no longer `--unset`s an unset local `commit.gpgsign` | killed (implement, 1) |
| .gitleaks.toml | R2-02: an extra `'''.*'''` path in the allowlist | killed (plugin) |
| .gitleaks.toml | R2-02: `useDefault = false` | killed (plugin) |
| .gitleaks.toml | R2-02: the `regexes` line deleted (paths-only allowlist) | **survived** |
| test/harness.mjs | R2-01: `sed -i` restored in the fake `pr ready` | survived `npm run lint`. Covered by the `no-gnu-sed-inplace` scan, whose `shouldMatch` fixture is this exact line. `foundry_mutate` does not run constraint scans (logged as feedback), so this is not a finding. |

## Findings

### 1. Tests (CI red): CI runs gitleaks 8.24.3, which ignores the `[[allowlists]]` table R2-02 added

- **Where:** `.gitleaks.toml:10-13` (R2-02, a5bbdca), and
  `.github/workflows/secret-scan.yml`, the `gitleaks/gitleaks-action@v3`
  step, which sets no `GITLEAKS_VERSION`.
- **What is wrong:** gitleaks-action v3 defaults to gitleaks **8.24.3**.
  Its source at the pinned SHA reads
  `process.env.GITLEAKS_VERSION || "8.24.3"`, and the run log says
  `gitleaks version: 8.24.3`. That version loads `.gitleaks.toml` (the log
  says "using existing gitleaks config"), but it does not understand the
  top-level `[[allowlists]]` array with `condition = "AND"`. It still
  reports `generic-api-key` at test/review.mjs:935 (57ef188) and
  test/harness.mjs:209 (63ce643). Round 2's reviewer, and R2-02's
  implementer, verified the fix with a local gitleaks 8.30.1, not with the
  version CI runs.
- **Reproduced:** I ran a scratch clone at HEAD 198863b against the
  official release binaries. Results over `a91777982208..HEAD`:
  - gitleaks 8.24.3: **2 leaks**.
  - gitleaks 8.28.0: no leaks. That is the version `.pre-commit-config.yaml`
    pins (`rev: v8.28.0`).
  - gitleaks 8.30.1: no leaks.

  With 8.28.0, the full history is also clean. With a probe commit that put
  the same value in `lib/other.js`, 8.28.0 reported 1 leak, so the AND scope
  works there.
- **Why not switch to a top-level `[allowlist]` instead:** I tested that in
  the same clone. Under 8.24.3, `[allowlist]` with `condition = "AND"`,
  `paths` and `regexes` passes. It also passed the out-of-path probe,
  though, because 8.24.3 ignores `condition` and ORs the fields. That would
  stop gitleaks from scanning `test/harness.mjs` and `test/review.mjs` at
  all. A regexes-only `[allowlist]` works on 8.24.3, but it allowlists the
  value in every file. Pinning CI to the pre-commit version keeps R2-02's
  narrow scope, and it gives the local hook and CI one gitleaks version.
- **What would break:** the `gitleaks` check stays red on this PR, and so
  does the weekly full-history scan after merge.
- **Minimal fix:** in `.github/workflows/secret-scan.yml`, add
  `GITLEAKS_VERSION: "8.28.0"` (no `v` prefix) to the action step's `env`.
  Make it equal to the gitleaks `rev` in `.pre-commit-config.yaml`. Leave
  `.gitleaks.toml` unchanged.
- **Task:** R3-01 (from R2-02).

### 2. Tests: deleting the allowlist's `regexes` line survives mutation

- **Where:** `test/plugin.mjs:537-540` (R2-02's assertion) and
  `.gitleaks.toml:13`.
- **What is wrong:** the assertion checks `useDefault = true` and that every
  `paths` entry starts with `^test/`. It never checks that the allowlist is
  scoped to the fixture value. Delete `regexes = ['''0123456789ABCDEF''']`
  and the allowlist becomes paths-only, which allowlists both whole test
  files. The suite still passes. R2-02's plan forbade exactly this ("Do not
  allowlist whole files").
- **What would break:** a real secret committed to `test/harness.mjs` or
  `test/review.mjs` would never be reported, locally or in CI.
- **Minimal fix:** extend the plugin.mjs assertion so the allowlist must
  have `condition = "AND"` and a `regexes` entry that is exactly
  `0123456789ABCDEF`. Same task as finding 1, because both touch the same
  assertion block and the same gitleaks setup.
- **Task:** R3-01.

## Interpretation choices (HANDOFF.md)

Round 2's fix log lists none. Earlier rounds' choices were reviewed in
rounds 1 and 2.

## Blocked and skipped tasks

None.

## Spec issues

Rounds 1 and 2's spec issues stand. They are not repeated here. One
addition:

1. Section 7 treats local verify as the whole verify. This round shows a
   third class of failure that local verify cannot see: CI tools whose
   versions are not pinned and differ from the local hook's. A later spec
   should require every CI scanner to be pinned to the same version as its
   pre-commit hook.

## Manual checks still owed

- Phase 1 (server): run one real flight on a throwaway spec with the
  working-tree plugin (`claude --plugin-dir .`) and confirm the summarizer
  passes `content` and no `Write` refusal appears. Re-signing with a real
  signing agent (`foundry_pr_finalize({ resign: true })`) is tested only
  against a fake gpg: NOT VERIFIED (human).
- Phase 2 (skills): read each changed `SKILL.md` top to bottom for
  contradictions with the tool reference. NOT VERIFIED (human).
- Phase 3 (docs and release): CI is green on this PR. NOT VERIFIED (human).
  It is currently **red**: `gitleaks` only (finding 1). Every `test` job,
  including `test (macos)`, now passes.
- The PR must not be merged until a human has run one 0.5.0 flight from the
  working tree (HANDOFF.md's first line).

## Notes

- The PR run's gitleaks command scanned
  `e902bfb^..533bd35`, which is 29 commits ending at P1-15. That suggests
  gitleaks-action builds its range from only the first page of the PR's
  commit list, so commits later in a long PR are not scanned on
  `pull_request`. The weekly full-history run covers them. This is outside
  this flight's scope.
- No mutant survived outside this round's diff, so there are no advisory
  survivors.
