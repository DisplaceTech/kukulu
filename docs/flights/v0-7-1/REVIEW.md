<!-- Kūkulu review, build/2026-10-20 -->
Round: 2

# Review: Kūkulu 0.7.1 build

**Verdict:** APPROVED

Base `870405426ff3` (main), head `cee1ee1` at the start of this review. There are 19 tasks: the 17 planned and the two round-1 fixes (R1-01, R1-02). All are done, and none are blocked or skipped. Round 1 reviewed the whole branch. Since `lastReviewCommit` (`02b0bb0`), the fix round changed only `test/implement.mjs`, `test/streams.mjs` and `test/fixtures/guard-cases.json`, plus the pipeline's own state, PROGRESS and HANDOFF. Neither commit touches the server, the guard or any docs.

I ran `kukulu_verify` myself, with the three changed files as `files`, and it is green:

- All 28 constraints pass, with no hits and no fixture failures.
- `npm run lint`, `pre-commit run --all-files` and `npm test` pass (3715 assertions).
- The guard self-test passes (`guard self-test: ok (509 cases)`).

Two more checks found nothing:

- `git diff --numstat 870405426ff3..HEAD -- test/fixtures/guard-cases.json` reads `519 0`. The file only gained lines, so no existing fixture changed and principle 6 holds.
- No file under `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `.github/`, `.gitignore` or `.gitattributes` changed on the branch.

## CI

`kukulu_status`'s `prChecks` read `unknown: unknown flag: --json`, because the local `gh` 2.45.0 has no `gh pr checks --json`. This is not a finding. I logged it as pipeline feedback and read CI by hand instead. PR #3 is a draft from `build/2026-10-20`. On commit `cee1ee1`, all twelve check runs succeed:

- Cloudflare Pages
- actionlint and actionlint (workflow syntax)
- gitleaks
- mermaid (diagrams parse)
- pre-commit
- site checks
- test on node 22, 24 and 26, on macOS, and with no gh on PATH

## Mutation checks on the fix round

The round-2 files are tests and fixtures. So I re-ran every round-1 survivor against the mechanic those tests cover, and each one is now killed:

- The `mcp/server.mjs` mutants ran with the targeted suite and `confirmKill`. Each re-run on the unmutated tree passed.
- The `mcp/cleanroom.mjs` mutants also ran with the guard self-test alone. That showed which fixture catches each one, because the `cleanroom` suite only names the gate's self-test failure (test 159).

| File | Mutant | Result | Caught by |
|---|---|---|---|
| `mcp/server.mjs` | `git merge --abort` removed from syncBase's failed-commit catch | killed | implement: "...the tree is clean", "...and the base's file is absent" (R1-01) |
| `mcp/server.mjs` | signing-fallback retry given `-- <paths>` during the merge | killed | implement: "a base sync whose signing fails under signing auto is retried unsigned and lands the merge commit" (R1-01) |
| `mcp/server.mjs` | the no-streams condition removed from taskNext's sync | killed | streams: "a serial task_next in a plan with streams never merges the base" (R1-01) |
| `mcp/cleanroom.mjs` | tar `writesArchive` reduced to `c` | killed | four tar append/update fixtures (R1-02) |
| `mcp/cleanroom.mjs` | `--get` removed from the tar long modes | killed | `tar --get -f a.tar -C docs (R1-02)` |
| `mcp/cleanroom.mjs` | `e` removed from `RSYNC_SPEC.short` | killed | `rsync evil/cleanroom.json docs -e ssh (R1-02)` |
| `mcp/cleanroom.mjs` | rsync target wildcard check removed | killed | `rsync evil/x docs/cleanroom.js?? (R1-02)` |
| `mcp/cleanroom.mjs` | tar archive-file wildcard check removed | killed | `tar cf docs/cleanroom.js?? src (R1-02)` |

## Findings

None.

- **Categories 1 and 2:** no constraint or boundary issue.
- **Category 3:** each R1-01 test drives the mechanic through the tool and asserts the observable state: HEAD, the index, the tree and the merge's parents. Each test fails without its mechanic. The R1-02 fixtures follow the file's naming, policy and indentation conventions.
- **Interpretations and blocked tasks:** the round-1 HANDOFF section lists no new interpretation choices, and there are no blocked tasks.

## Spec issues

These carry over from round 1, and nothing in the fix round changes them:

- §1 "Why a patch version" says the guard denies "two command forms it allowed before (A-04)". The build also newly denies three more kinds of command: A-02's bare read-family operand (`cat zlib.txt`), the rsync remote operand, and a tar extraction at the repository root. The last two follow from A-04 as PLAN resolved it. The sentence undercounts.
- A-04's "a remote operand … is already a network command under `deny.network`" was false at the base. PLAN's spec issue records this, and P0-05 made it true.

### Known-gap candidates

- rsync's deleting options: `--delete` with `-d`/`--dirs`, `--remove-source-files`, and `--delete-*` in general. For example, `rsync -d --delete empty/ docs/` removes `docs/cleanroom.json` and is allowed.
- tar under another command word: `bsdtar`, `gtar`. For example, `bsdtar -xf a.tar -C docs` is allowed.

## Manual checks still owed

- Phase 0: in a live clean-room session with the working-tree plugin (`claude --plugin-dir .`), check that `git add docs/*` is allowed and `rsync evil/cleanroom.json docs/` is denied. Check that CI is green on the pushed branch (it is green on `cee1ee1`, see CI above).
- Phase 1: on a throwaway flight with the working-tree plugin, commit to the base branch after the build branch is cut. Then call `kukulu_task_next` and check for the `chore: merge` commit.
- Phase 2: check that the draft PR targets `main` and that its ci, lint and site checks are green.
- Before merging, run `npm test` once on a machine with the signing agent the project uses.

## Notes

- Mutating `mcp/cleanroom.mjs` under the targeted `cleanroom` suite always fails at "the first kukulu_next in a clean-room project goes on to the plan stage". The reason is that gate check 4 runs the guard self-test against the mutated module. After that the suite crashes on an unrelated `git checkout` (around `test/cleanroom.mjs:539`), so the fixture names never reach the failure tail. The kill is real, but to see which fixture caught a guard mutant, run the guard self-test command.
- In R1-01's failed-commit test, the "...no merge is left in progress" assertion still passes without `git merge --abort`, because commitStaged's own reset clears `MERGE_HEAD`. The tree and `base.txt` assertions in the same test do catch the missing abort.
- These round-1 notes still stand, and none of them blocks anything:
  - In `mcp/server.mjs`, `checkConstraints`'s doc comment now sits above `const constraintTests`.
  - `KNOWN_LIMITS`'s doc comment cites SPEC D-03 instead of A-01.
  - The recursive rsync denial quotes the destination form rather than the protected path.
  - `docs/kukulu.json` has `maxRounds: 6`, while PLAN's Decisions says it keeps the default 3.
