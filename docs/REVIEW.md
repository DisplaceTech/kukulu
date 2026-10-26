# Review: Kūkulu 0.7.2 build (build/2026-10-26)

Round: 2

## Verdict

APPROVED

The round 1 fix tasks (R1-01, R1-02, R1-03) do what their tasks asked, and categories 1 to 3 are clean across the branch:

- Every constraint passes.
- `kukulu_verify` is green: lint, pre-commit, and `npm test` with 3871 assertions in 13 suites.
- The pull request's CI is green, including `gitleaks`.
- Every mutant that survived round 1 is now killed by the test written for it.

## Findings

None.

## CI (prChecks)

When the review started, `kukulu_status` reported `prChecks: pending` with nothing failing. `gitleaks`, both lint jobs, the site checks, mermaid and Cloudflare Pages had already passed; the five `test` jobs were still running.

All four workflows on 327b356 have since finished with success: `secret-scan` (run 40389148651), `lint`, `site`, and `ci` (run 40389148525, 9m44s). The `gitleaks` failure from round 1 (runs 40362080213 and 40366708432) is gone.

I also ran the range scan locally, `gitleaks git --no-banner --redact --log-opts="$(git merge-base main HEAD)..HEAD" .`. It scanned 51 commits and found no leaks.

## Fix round review

**R1-01 (32be844), `.gitleaks.toml`:**

- The path allowlist is widened to `^test/(harness|review|state|implement)\.mjs$`. It still uses `condition = "AND"` and the same one-value regex, and its comment was updated.
- The task said "no other file changes" and "only the paths widened". The commit also adds a second allowlist, scoped to the single commit 79f3342 (full sha checked) and the same value. The reason is that the round 1 review quoted the fake key in `docs/REVIEW.md`, and the range scan flagged that.
- It stays inside the task's file, it is as narrow as gitleaks allows, and the commit body records it as an interpretation. Widening the paths to `docs/` instead would have broken `test/plugin.mjs`'s tests-only paths check.
- I accept it. This review avoids quoting the value for the same reason.

**R1-02 (c373104), `test/implement.mjs`:**

- The resumed-run test sets up the fallback record exactly as the task specified, with an empty `GIT_CONFIG_GLOBAL` (signing-tests protocol). It asserts all five of the task's conditions.
- The 120-code-point test puts a non-ASCII character before the cut. It asserts both the `--title` gh received and `run_finish`'s `prTitle`.

**R1-03 (6efeb5b), `test/implement.mjs`, `test/routing.mjs`, `test/state.mjs`:**

- There are four tests, as specified.
- The stderr variant is derived at runtime from `test/fixtures/gh/pr-checks-unknown-flag.txt`, so no recorded body is inlined.
- The astral and non-ASCII characters are written as escapes.

`git diff 79f3342..HEAD` touches no file under `mcp/`, `skills/`, `agents/`, `hooks/`, `site/`, `docs/site/`, `docs/plans/`, `docs/flights/` or `docs/SPEC.md`. Nothing was edited in `.gitignore`, `.gitattributes` or CI config.

## Mutation sampling (round 2)

The last fix round changed only test files and `.gitleaks.toml`. So the meaningful check was to re-apply every round 1 survivor in `mcp/server.mjs` against the suite now meant to catch it. I used `kukulu_mutate` with the targeted suite and `confirmKill: true`. All seven were killed, and each confirm re-run passed on the unmutated tree:

- **`reprobeSigning`, `if (outcome === "none")` changed to `if (false)`:** killed by `implement`, "a resumed run with no operator signing keeps the fallback record" and three of its follow-ups.
- **`reprobeSigning`, the local `commit.gpgsign false` put-back deleted:** killed by `implement`, "...local commit.gpgsign reads false again".
- **`startRun`, `else if (st.signing === "none") delete st.signingOverride;` deleted:** killed by `implement`, "...and drops the override".
- **`prTitleFor`, the 120-code-point cut replaced by `return title;`:** killed by `implement`, "...gh gets exactly the first 120 code points" and "...and run_finish returns the same prTitle".
- **`prTitleFor`, the separator class narrowed to the em dash:** killed by `implement`, all three "the derived title strips an en dash, colon or hyphen separator and a bare Spec" cases.
- **`cfgFrom`, `[...t].length > 120` changed to `t.length > 120`:** killed by `routing`, "a prTitle of 61 astral characters is accepted, counted in code points".
- **`prChecks`, `/unknown flag:? --json/i` narrowed to `/unknown flag: --json/`:** killed by `state`, "prChecks falls back on an unknown flag message without the colon or in another case".

The round 1 review's other kills, in `mcp/cleanroom.mjs` and in the rest of `mcp/server.mjs`, cover code this round did not change.

## Constraints and boundaries

- All 28 constraints in `docs/kukulu.json` pass, with no fixture failure.
- No fix-round line violates a rule the mechanical checks cannot express.
- The round 1 review's boundary findings still hold, since no non-test source changed:
  - refusals come before writes;
  - `no-sync-merge` keeps one inline array;
  - the guard fixtures changed only as A-03 permits.

## Spec issues

- **Known-gap candidates** (principle 1; not tasks), carried from round 1 and unchanged:
  - rsync's older alias of the source-removing option, for example `rsync --remove-sent-files docs/cleanroom.json build/`;
  - another archiver's extraction, which no rule names, for example `cd docs && pax -r -f a.tar`.
- None against SPEC itself.

## Manual checks still owed

All are NOT VERIFIED by a human, copied from HANDOFF.md:

- **Phase 0:** in a live clean-room session, `rsync -d --delete empty/ docs/` and `bsdtar -xf a.tar -C docs` are denied.
- **Phase 1:** with a real SSH signer and `SSH_AUTH_SOCK` pointing at the wrong agent, `kukulu_plan_commit` under `auto` commits unsigned and logs the fallback. With the socket fixed, `kukulu_run_start` signs again.
- **Phase 2:** once 0.7.2 is installed, the next flight's draft PR is titled `<flight>: <spec title>`. This flight's own PR was opened by the running 0.7.1 as `Build: <branch>`.
- **Phase 3:** on gh 2.45.0, `kukulu_status` reports the PR's checks with `via: "gh api"`.

## Notes

These are carried from round 1, are advisory, and need no task:

- **P0-01 reverts the owner's 418b291 agent defaults.** It does so because `no-fable-default` and 44 assertions required it. If the owner meant to change the shipped defaults, that is a SPEC change, and the commit can be dropped.
- **`classifyChanges` and rename detection.** It reads `git diff --raw -z` in pairs. A rename record under `diff.renames` would shift the pairing. The fallback is `content`, so it is safe; passing `--no-renames` would make it exact.
- **Inline gh error lines.** The synthetic gh error lines in `test/state.mjs` (`api-fails`) and `test/review.mjs` (`view-title-fails`) are inline. They could move under `test/fixtures/gh/` in a later cleanup.
- **`kukulu_run_start` signing values.** The **Returns** list in `docs/mcp-tools.md` still omits the `off (commit signing failed: …)` value. That omission predates this flight.
- **Commit-scoped gitleaks allowlist.** It names the full sha of 79f3342, so it holds under the configured `mergeMethod: merge`. A rebase merge would rewrite that sha, but the review file at the branch tip no longer quotes the value, so only a scan of the rewritten history would notice.
