# Review: Kūkulu 0.7.2 build (build/2026-10-26)

Round: 1

## Verdict

CHANGES REQUESTED

Every constraint passes and `kukulu_verify` is green: lint, pre-commit, and `npm test` with 3855 assertions in 13 suites. The pull request's own CI does not pass, though. The `gitleaks` check fails on two commits of this branch. Mutation sampling also found two SPEC requirements with no test, plus four more mechanics in `mcp/server.mjs` that no test covers.

## Findings

### 1. Category 3: the PR's `gitleaks` CI check fails (P1-02, P1-04)

- **Where:** `test/state.mjs:131` (added in 9c1e707, P1-04) and `test/implement.mjs:1190` (line 1150 when added in b080d17, P1-02).
- **What is wrong:** both lines write a temp gitconfig containing the fake signer key `signingkey = 0123456789ABCDEF`, and gitleaks' `generic-api-key` rule flags them. `.gitleaks.toml` allowlists that value only in `^test/(harness|review)\.mjs$`. `kukulu_status` reports `prChecks: fail` with `gitleaks` failing (secret-scan workflow run 40362080213, "Scan a pull request's commits"). I reproduced it locally: `gitleaks git --no-banner --redact --log-opts="450fbfd..HEAD" .` scans 41 commits and finds 2 leaks.
- **Why local verify missed it:** the pre-commit `gitleaks` hook only scans staged changes, and `pre-commit run --all-files` has nothing staged, so it passes. CI scans the commit range.
- **What would break:** the PR can never go green. With `finalize: auto`, auto-merge waits forever on a required check.
- **Minimal fix:** the findings are already in history, so changing the test lines alone cannot clear the PR scan. Widen the narrow allowlist's `paths` to cover the two suites, `^test/(harness|review|state|implement)\.mjs$`, and keep the `0123456789ABCDEF` regex and the `AND` condition. Update its comment to match.

### 2. Category 3: B-02's "the earlier record stays" is untested (P1-02)

- **Where:** `mcp/server.mjs` `reprobeSigning`, the `outcome === "none"` branch (around line 2283).
- **What is wrong:** SPEC B-02 says a re-probe on an already-started run "never overwrites an `off (commit signing failed: …)` or `off (probe failed: …)` record with `"none"`". It also says the override goes back when the operator's setting is not configured. Two mutants survive `node test/implement.mjs`:
  - removing the `git config --local commit.gpgsign false` put-back;
  - replacing `if (outcome === "none")` with `if (false)`, which records `"none"` over the fallback and commits it.
- **Missing test:** an already-started run with `signingOverride: true`, `signing: "off (commit signing failed: …)"`, the local `false`, and no operator signing in global config.

### 3. Category 3: C-01's 120-character cut on the derived title is untested (P2-01)

- **Where:** `mcp/server.mjs` `prTitleFor`, `return [...title].slice(0, 120).join("");`.
- **What is wrong:** SPEC C-01 says "The title is cut to 120 characters". Replacing the line with `return title;` survives `node test/implement.mjs`. No test uses a heading longer than 120 characters.

### 4. Category 3: other mechanics in `mcp/server.mjs` no test covers (P1-02, P2-01, P3-01)

These mutants also survived their owning suite (one task for the file, source `mutation`):

- **Fresh-path `"none"` outcome:** deleting `else if (st.signing === "none") delete st.signingOverride;` in `startRun` survives `implement`. PLAN's B-02 decision says a fresh run whose lifted override finds no operator signing records `"none"` and drops `signingOverride`.
- **Code points in `prTitle` validation:** changing `[...t].length > 120` to `t.length > 120` survives `routing`. PLAN's C-01 decision counts code points, but every test title is ASCII.
- **Separator strip:** narrowing `/\s*[—–:-]\s*Spec(ification)?\s*$/i` to the em dash alone survives `implement`. Only `# Widget 1.0 — Specification` is tested, never `–`, `:`, `-` or `Spec`.
- **Fallback trigger:** changing `/unknown flag:? --json/i` to `/unknown flag: --json/` survives `state`. The optional colon and the case-insensitivity that SPEC D-01 names are never exercised.

### Mutants killed (evidence that the rest is covered)

- **`mcp/cleanroom.mjs`, guard self-test:**
  - the `RSYNC_DELETES` match;
  - the `--remove-source-files` under-protected-path branch;
  - `gtar` dropped from `TAR_WORDS`;
  - `recursiveOperands` back to `word === "tar"`.
- **`mcp/server.mjs`, `implement` suite:**
  - B-01's probe gate (`if (true)`);
  - B-02's override unset.
- **`mcp/server.mjs`, `review` suite:**
  - `signaturesExpected` ignoring `"none"`;
  - the rebase no-subject rule;
  - the CHANGELOG entry ending at the next level-2 heading;
  - D-03's `mode` classification;
  - D-02's space-joined filter.
- **`mcp/server.mjs`, `state` suite:**
  - `startup_failure` in the run-failure set;
  - C-04's insertion point;
  - B-04 reading the archived `kukulu.json`.
- **`mcp/server.mjs`, `routing` suite:** the `archive` default of `true`.

## Constraints and boundaries

- All 28 constraints pass. No rule's fixture fails, and I found no violation the rules missed.
- **Refusals before writes:**
  - C-03's disagreement refusal comes before the `resign` path and any write.
  - C-04 adds `docs/PLAN.md` to `withRollback` only when a line is written, and its rollback test is in `test/state.mjs`.
  - B-04's probe writes no ref, config or state, which the test asserts against `.git/config` byte for byte.
- `no-sync-merge` holds: `--subject` is spread into the one inline array after `--auto`.
- No edits to `.gitignore`, `.gitattributes`, editor config or CI config.
- Nothing under `site/`, `docs/site/`, `docs/flights/`, `docs/plans/` or `docs/SPEC.md` changed.
- **Guard fixtures:** the only change to an existing fixture is the `reason` of `rsync -a evil/ .kukulu/ (P0-05)`, as A-03 permits. Every other change is an addition with a `(P0-02)` or `(P0-03)` suffix.
- **Guard regression check:** P0-04 split the landing-path test into a landing-path check followed by a recursive-containment check. For the destination, the decision set is the same as at the merge base. Only the reason differs, as A-03 asks.

## Interpretation choices (HANDOFF.md)

All are consistent with SPEC:

- P3-01's seven failing entries follow SPEC D-01's mapping exactly: five conclusions plus `failure` and `error`. PLAN's "six" was the planner's miscount.
- P2-03's `archive` field on `kukulu_config_show` is what SPEC C-02's test needs.
- P1-03's "`resign: true` expects signatures" and the archived-state read match Appendix B item 2 and PLAN's B-03 decision.

## Spec issues

- **Known-gap candidates** (principle 1; not tasks). Each was checked against this branch's `evaluate`, and each is allowed:
  - rsync's older alias of the source-removing option, for example `rsync --remove-sent-files docs/cleanroom.json build/`;
  - another archiver's extraction, which no rule names, for example `cd docs && pax -r -f a.tar`.

  `rsync -d --delete-aft empty/ docs/` is allowed too. It is already covered by `KNOWN_LIMITS` entry 3 (abbreviations), so it is not a new candidate.
- None against SPEC itself. The interpretation points PLAN raised under its own Spec issues were built as PLAN resolved them.

## Manual checks still owed

All are NOT VERIFIED by a human, copied from HANDOFF.md:

- **Phase 0:** in a live clean-room session, `rsync -d --delete empty/ docs/` and `bsdtar -xf a.tar -C docs` are denied.
- **Phase 1:** with a real SSH signer and `SSH_AUTH_SOCK` pointing at the wrong agent, `kukulu_plan_commit` under `auto` commits unsigned and logs the fallback. With the socket fixed, `kukulu_run_start` signs again.
- **Phase 2:** once 0.7.2 is installed, the next flight's draft PR is titled `<flight>: <spec title>`. This flight's own PR was opened by the running 0.7.1 as `Build: <branch>`.
- **Phase 3:** on gh 2.45.0, `kukulu_status` reports the PR's checks with `via: "gh api"`.

## Notes

- **P0-01 reverts the owner's 418b291 agent defaults.** It does so because `no-fable-default` and 44 assertions required it (PLAN Decisions, Spec issues). If the owner meant to change the shipped defaults, that is a SPEC change, and the commit can be dropped.
- **Inline gh error lines.** `test/state.mjs` writes the `api-fails` stderr (`HTTP 502: bad gateway`) inline, and the `view-title-fails` text in `test/review.mjs` is inline too. They are synthetic error lines, not recorded gh output, so principle 10 is read as satisfied. A later cleanup could move them under `test/fixtures/gh/`.
- **`kukulu_run_start` signing values.** The **Returns** list in `docs/mcp-tools.md` still omits `off (commit signing failed: …)`. That omission predates this flight.
- **`classifyChanges` and rename detection.** It reads `git diff --raw -z` in pairs. Under `diff.renames`, a rename record carries two paths and would shift the pairing. Worktree residue against HEAD makes a rename unlikely, and the fallback is `content`, so it is safe. Passing `--no-renames` would make it exact.
- **`gitleaks` and `kukulu_verify`.** `pre-commit run --all-files` cannot see this class of failure, because the hook scans only staged changes. The fix task's verification therefore names the CI check and the local `gitleaks git` range scan.
