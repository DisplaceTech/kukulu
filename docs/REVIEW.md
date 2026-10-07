# Review: Foundry 0.5.0 build (build/2026-10-07)
Round: 2

## Verdict

CHANGES REQUESTED

The round-1 fixes landed as specified. R1-01 snapshots and restores inside
`commitStaged`. R1-02's four tests each kill the mutant they were written
for. R1-03 pins the agent tool lists and the README defaults. Local
`foundry_verify` is green: all four constraints pass with no hits and no
fixture failures, and lint, pre-commit and all eleven suites pass (2066
assertions).

The PR's CI is red, though, and local verify cannot see why. `gh pr checks 7`
shows `test (macos)` and `gitleaks` failing. I confirmed both myself. One
mechanic in R1-01's diff also survives mutation. The operator relayed the CI
failures mid-review, and asked that the PR not be approved while CI is red.

Mutation sample, round 2. Per S-11, this round mutates only files changed in
`git diff fb5c5a3..HEAD`. Each mutant ran the full suite.

| File | Mutant | Result |
|---|---|---|
| mcp/server.mjs | R1-01: retry-failure branch no longer calls `undoFallback()` | killed (implement, 4) |
| mcp/server.mjs | R1-01: `undoFallback` drops the `git reset` of state/feedback | killed (implement, 1) |
| mcp/server.mjs | R1-01: `undoFallback` no longer deletes a file that was absent | killed (implement, 2) |
| mcp/server.mjs | R1-01: `undoFallback` no longer `--unset`s a `commit.gpgsign` that was unset locally | **survived** |
| mcp/server.mjs | R1-02 (a): `{filter}` substituted unquoted | killed (review) |
| mcp/server.mjs | R1-02 (b): `strayArtifacts` condition forced true | killed (state) |
| mcp/server.mjs | R1-02 (c): `ordinal()` loses the 11th–13th rule | killed (review, 2) |
| mcp/server.mjs | R1-02 (d): all-signed `pr_finalize` no longer clears the override | killed (review, 3) |
| agents/summarizer.md | R1-03: `foundry_pr_finalize` dropped from `tools:` | killed (plugin) |
| README.md | R1-03: `summarizer` (opus, medium) back to fable | killed (plugin) |

## Findings

### 1. Tests (CI red): the fake `gh pr ready` uses GNU-only `sed -i`, so five review assertions fail on macOS

- **Where:** `test/harness.mjs:154` (`mkFakeGhBin`, the `pr ready` branch),
  added by P1-13 (63ce643):
  `sed -i 's/"isDraft":true/"isDraft":false/' "$dir/pr.json"`.
- **What is wrong:** BSD sed reads the next argument after `-i` as the
  backup suffix, so the script becomes the file name and `isDraft` never
  flips. CI run 37675515745, job `test (macos)`, fails `...ready is true`
  five times (review assertions 277, 282, 287, 292 and 302: the
  `foundry_pr_finalize` all-signed cases). Every Linux job passes, which is
  why local verify is green.
- **What would break:** CI stays red on a supported platform. Every
  macOS contributor sees the review suite fail.
- **Minimal fix:** write the change portably, for example
  `sed '…' "$dir/pr.json" > "$dir/pr.json.tmp" && mv "$dir/pr.json.tmp" "$dir/pr.json"`.
  No other `sed -i` exists under `test/`, `scripts/` or `mcp/` today. Add a
  `docs/foundry.json` constraint that forbids `sed -i` there, and use this
  line as its `shouldMatch` fixture. A Linux-only verify then catches the
  next one.
- **Task:** R2-01 (from P1-13).

### 2. Tests (CI red): gitleaks flags the fake-signer key id in two PR commits

- **Where:** `test/harness.mjs:209` in 63ce643 (P1-13), and
  `test/review.mjs:935` in 57ef188 (P1-14), which is line 973 at HEAD. Both
  are the fixture key id `0123456789ABCDEF`. Rule: `generic-api-key`.
- **What is wrong:** the `secret-scan` workflow's `gitleaks` job scans
  every commit in the PR, and finds 2 leaks. The local pre-commit hook scans
  staged changes only, so it never saw them. I reproduced the finding in a
  scratch clone with gitleaks 8.30.1 by running
  `gitleaks git --log-opts="a91777982208..HEAD"` (2 leaks).
- **What does not fix it:** I tested the operator's first suggestion in the
  scratch clone. A new commit that appends `// gitleaks:allow` to both lines
  still yields **2 leaks**, because the findings live in the old commits'
  patches, and history must not be rewritten.
- **What does fix it:** in the same scratch clone, a root `.gitleaks.toml`
  scoped to these two paths and this value gives `no leaks found`, both
  over the PR range and over the whole history. The file was:

  ```toml
  [extend]
  useDefault = true

  [[allowlists]]
  description = "fake-signer fixture key id in tests"
  condition = "AND"
  paths = ['''^test/(harness|review)\.mjs$''']
  regexes = ['''0123456789ABCDEF''']
  ```

  gitleaks loads `.gitleaks.toml` from the scanned directory unless
  `GITLEAKS_CONFIG` is set. `secret-scan.yml` does not set it, and the
  checkout is the repository root, so the action and the pre-commit hook
  both use it. The CI job going green on the PR confirms this.
- **What would break:** a permanently red `gitleaks` check on this PR, and
  on the weekly full-history scan once it merges.
- **Task:** R2-02 (from P1-13, P1-14).

### 3. Tests: R1-01's restore of an unset local `commit.gpgsign` survives mutation

- **Where:** `mcp/server.mjs:142`, in `commitStaged`'s `undoFallback`:
  `else git(["config", "--local", "--unset", "commit.gpgsign"], …)`.
- **What is wrong:** you can delete that `else` branch and the whole suite
  still passes. R1-01's only test starts with local `commit.gpgsign true`,
  so it exercises only the "set it back" branch.
- **What would break:** the common real setup has signing on in the user's
  global `~/.gitconfig` and nothing set locally. There, a failed unsigned
  retry would leave local `commit.gpgsign=false` behind, while state.json
  has been restored without `signingOverride`. That is the orphaned
  override round-1 finding 1 set out to remove. Signing would stay off in
  that repository for every later flight, and S-14's finalize and resign
  paths would never undo it.
- **Minimal fix:** a test only. The server code is correct today.
- **Task:** R2-03 (from R1-01).

## Interpretation choices (HANDOFF.md)

Round 1's choices were reviewed then. Round 1's fix log lists one new
choice: R1-02 (c) drives 12 equal-count rounds with `maxRounds` 11. That is
consistent with S-09, and the test kills its mutant. It is not a finding.

## Blocked and skipped tasks

None.

## Spec issues

Round 1's two spec issues stand. They are not repeated here.

1. Section 7 says local verify is the whole verify. This flight shows that
   it cannot see two classes of CI failure: platform-specific shell in test
   fixtures, and history-wide secret scans. A later spec could add a
   history-range gitleaks scan to verify, and a macOS job to the plan's
   manual checks.

## Manual checks still owed

- Phase 1 (server): run one real flight on a throwaway spec with the
  working-tree plugin (`claude --plugin-dir .`) and confirm the summarizer
  passes `content` and no `Write` refusal appears. Re-signing with a real
  signing agent (`foundry_pr_finalize({ resign: true })`) is tested only
  against a fake gpg: NOT VERIFIED (human).
- Phase 2 (skills): read each changed `SKILL.md` top to bottom for
  contradictions with the tool reference. NOT VERIFIED (human).
- Phase 3 (docs and release): CI is green on this PR. NOT VERIFIED (human).
  It is currently **red** (findings 1 and 2).
- The PR must not be merged until a human has run one 0.5.0 flight from the
  working tree (HANDOFF.md's first line).

## Notes

- No mutant survived outside this round's diff, so there are no advisory
  survivors.
- `commitStaged`'s `catch` around `git add` and the retry is hard to reach,
  because `run` is `spawnSync` and does not throw. It is harmless.
