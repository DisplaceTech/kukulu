<!-- Kūkulu review, build/2026-10-19 -->
Round: 10

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 97 tasks are done. None are blocked or skipped.
- At `580d523`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,554 assertions. The guard self-test passes with 457 cases.
- `gh pr checks` on the draft PR, whose head is `580d523`: all eleven checks pass, `test (macos)` included.
- Round 9 changed only `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` and the pipeline files (`git diff --name-only 2fddf2c..HEAD`).
  - It did not touch `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `docs/kukulu.json`, `.gitignore`, `.gitattributes` or CI config.
  - No existing fixture changed. Round 9 only added fixtures.
  - The R9-01 commit follows the template, and all five commits since `2fddf2c` are signed (`%G?` is `G`).
- R9-01's code is correct. `resolveLong` and `OTHER_LONG` (`mcp/cleanroom.mjs:1047-1068`) match the lists in the task. The new branch in `destinationPathsFor` (`:1105-1110`) makes a long option valued only when its resolved name is in that command's `COPY_SPECS` set. All twelve fixtures the task names are present, with the decisions it requires.
- Every round-9 probe now behaves as the task requires. I ran each one through `evaluate()` again, along with about 50 more mv, ln, install and cp long-option forms. These included exact names, unique and ambiguous prefixes, `=value`, `-t`, and protected landing paths. Every form that writes a protected path is denied.

The one finding is a test gap in the code R9-01 added. Nothing in the suite pins the `--name=value` half of the new branch. If that half is removed, `mv --target-directory=docs evil/cleanroom.json` is allowed, and no test fails.

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, cwd `/tmp/proj`, `planExists: true`
- D-10's protected set from `protectedPaths()`

### F1: no fixture pins the attached `--name=value` form for mv, ln or install, so dropping it from R9-01's new branch lets the policy be overwritten without a failing test (category 3; SPEC D-10 self-protection, D-03 rule 6d; task R9-01)

`mcp/cleanroom.mjs:1107-1109` reads the value of a valued long option from after the `=` (`value: eq === -1 ? null : t.slice(eq + 1)`). Before R9-01, mv, ln and install got this behaviour from `scanOption`. R9-01 moved those commands onto this new branch. The cp branch at `:1101-1103` has its own fixtures (`cp --target-directory=docs evil/cleanroom.json`, `cp --target=docs evil/cleanroom.json`, `cp --suffix=.bak -r assets build/`). mv, ln and install have none for an attached value with a valued option. The only attached-value fixtures for them use `--strip-program=true`, and `-t docs` or the last operand decides the outcome there.

`kukulu_mutate` confirms the gap. I replaced the value expression with `value: null` (on the new branch only), and the mutant **survived** the targeted `cleanroom` suite.

I also loaded a scratch copy of the module with the same mutation and ran it through `evaluate()`. All of these flip from denied at HEAD to **allowed**:

| Command | HEAD | mutant |
|---|---|---|
| `mv --target-directory=docs evil/cleanroom.json` | denied | allowed |
| `mv --t=docs evil/cleanroom.json` | denied | allowed |
| `ln --target-directory=docs evil/cleanroom.json` | denied | allowed |
| `install --target-directory=docs evil/cleanroom.json` | denied | allowed |
| `install --mode=644 evil/cleanroom.json docs` | denied | allowed |
| `install --owner=root evil/state.json .kukulu` | denied | allowed |
| `mv --suffix=.bak evil/cleanroom.json docs` | denied | allowed |

Each of these writes a D-10 protected path with the real GNU tool.

R9-01's design constraints also list `install --mode=644 a.txt build/` and `install -o root -g root a.txt build/` as allowed forms to keep. Neither is a fixture. R8-01 never named them, so this is a gap in the plan's list, not an implementer error.

A second survivor, in the same lines, is fixed with the same kind of fixture. I changed `resolveLong`'s `hits.length === 1` to `>= 1`, so an ambiguous prefix resolves to the first match, and the mutant survived.

- The rule R9-01 states, that an ambiguous prefix takes no value, is pinned only by `install --stri evil/cleanroom.json docs`. That fixture cannot fail: `--stri`'s first match is `--strip`, which is a flag either way.
- `ln --s evil/cleanroom.json docs` would kill it, because `--suffix` comes first in ln's list and is valued. So would `cp --s evil/cleanroom.json docs`, because `--sparse` comes first in cp's list.
- This survivor cannot be exploited today. GNU getopt rejects an ambiguous prefix, so the real command never runs.
- It is still the round-9 F2 shape, a stated rule whose only fixture cannot fail, and it costs one fixture per command.

Minimal fix: add fixtures only, with no code change. See R10-01.

What breaks without it: a future edit to that branch, such as a refactor that merges it with the cp branch or with `scanOption`, can silently reopen a one-command overwrite of the policy.

This task comes from mutation results in the round-9 diff, which the round-2-and-later rule makes fix tasks. The rule is cited under Notes.

## Spec issues

- **The guard is lexical, and the loop has still not fully converged.** Fix tasks per round: 7, 7, 3, 3, 3, 2, 2, 1, 1, and now 1. This round's task is test-only: the guard code R9-01 wrote is correct for every form I probed.
  - `maxRoundsHard` is 10, and this is round 10. If R10-01 lands, the round-11 review exceeds the hard cap. A CHANGES REQUESTED verdict there halts and needs the owner's `kukulu_flight_options`. An APPROVED verdict does not.
  - Carried from rounds 5 to 9: a table cannot be proved complete across GNU and BSD versions. The owner may prefer to amend SPEC D-03 to say that option parsing for wrappers and write commands is best-effort against the tools' documented options, and add that to `KNOWN_LIMITS`.
- **Read-family words are judged only in path-like arguments** (SPEC D-03 rule 6c), carried from rounds 5 to 9. So `cat zlib.txt` is allowed and `cat ./zlib.txt` is denied `forbidden word in path argument`.
- **SPEC D-03 makes `git` write-family as a whole** (carried from rounds 3 to 9). `git add docs/*` is denied `protected path`.
- Carried from rounds 2 to 9, still open:
  - SPEC F-04's `--roots`/`--words` defaults were superseded by the owner's `e7ef4d4`.
  - D-03's write, network and wrapper lists are incomplete. For example, `rsync evil/cleanroom.json docs/` and `tar xf evil.tar -C docs` are allowed. `KNOWN_LIMITS` names rsync.
  - The log's uncommitted tail is unsigned.
  - D-08 check 3 does not pin `mcp/cleanroom.mjs`.
  - D-03's known gaps omit shell expansion.
  - SPEC §1 asks for the PR against `main` while `baseBranch` is `cleanroom`.

## Manual checks still owed

All `NOT VERIFIED (human)`, copied from HANDOFF.md.

- Phase 0 (P0-07): run the installed 0.6.1 plugin's `kukulu_migrate` on a throwaway `.foundry/` project, then run one task on it with the working-tree plugin.
- Phase 1 (P1-14): halt a throwaway flight with `kukulu_run_halt` and fix nothing. Call `kukulu_run_resume` and confirm the refusal names the dirty tree. Clean the tree and confirm the resume commit.
- Phase 2 (P2-03): create `docs/feedback/.private-names` with one real name and run `npm run lint`. It must fail without printing the name. Delete the file and it must print the skipped line.
- Phase 3 (P3-21):
  1. Copy `templates/cleanroom.example.json` into a throwaway Rust project as `docs/cleanroom.json`.
  2. Start a new session with the working-tree plugin and ask it to read `~/.cargo/registry`.
  3. Confirm the denial appears in the session and in `.kukulu/cleanroom/log.jsonl`.
  4. Type one instruction and confirm a `human` entry.
  5. Run `/kukulu:go-flight` and confirm `gate: ok (7 checks)` before the plan stage.
- Phase 4 (P4-09): run `kukulu_similarity` against the cleanflate-bench subjects at `7f50ce6` (reference pairs from `d047d66`). Record the identifier and comment Jaccard values next to the canonical 0.021 / 0.019 / 0.095 and 0.0003 / 0.0010 / 0.032. The ordering must agree.
- Phase 5 (P5-09): copy a bundle to a machine without this repository and run `node verify.mjs . --key <fingerprint>`; confirm PASS. Change one byte of `log.jsonl` and confirm FAIL names the line.
- Phase 6 (P6-05):
  - Deploy the build branch as a Cloudflare Pages preview.
  - Read every clean-room line against what the suite proves.
  - Compare the page with the changed mockup at 360, 768 and 1440 px in both schemes.
  - Confirm the site, ci and lint checks are green on the PR.
- From HANDOFF's first line: the owner runs one clean-room flight from the working tree before merging.
- From HANDOFF: after this branch meets `cleanroom`, change `fromas of 0.7.0` to `as of 0.7.0` in `docs/site/mockup.html` and `site/index.html`.
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 10. Include:
  - `cd ~/.cargo/registry && cat x`
  - `(curl https://example.com)`
  - `cd && cat .cargo/registry/x`
  - `cp evil .kukulu/state.*`
  - `env -S -i curl https://example.com`
  - `cp -vt docs x/cleanroom.json`
  - `cd ~/.cargo && cd r* && cat x`
  - `xargs -i curl https://example.com`
  - `cp -rT evil docs`
  - `cp -r --o evil/. docs`
  - `xargs --process-slot-var V curl https://example.com`
  - `cp evil/cleanroom.json docs --sparse always`
  - `install --strip-program=true --strip evil/cleanroom.json docs`
  - `mv --target-directory=docs evil/cleanroom.json`
  - on macOS, `install -S evil/cleanroom.json docs`

## Notes

- **The fix task comes from mutation results.** This follows the review-build rule for round 2 and later: mutate only the files in `git diff --name-only <lastReviewCommit>..HEAD`, and a survivor there becomes a fix task. The source file in that diff is `mcp/cleanroom.mjs`. F1's main survivor is not equivalent: a scratch copy of the mutant allows real writes to the policy.
- **Mutation sampling.** I used the targeted `cleanroom` suite with `confirmKill` on `mcp/cleanroom.mjs`.
  - **Killed (4), each confirmed by a clean re-run.** Each failed through the gate's guard self-test ("the first kukulu_next in a clean-room project goes on to the plan stage": `halt`).
    - The new OTHER_LONG branch disabled.
    - `--strip-trailing-slashes` added to mv's valued set.
    - `--strip` removed from install's full list (the round-9 regression).
    - `spec.long.has(full)` dropped from the new branch.
  - **Survived (3):**
    - The attached value dropped (`value: null`) on the new branch. This is F1.
    - Ambiguous prefixes resolved to their first match. This is F1's second part.
    - The exact-match line in `resolveLong` removed. This one is equivalent. In all four lists, the only full name that is a prefix of another is install's `--strip` (of `--strip-program`). Its exact name is a flag, and ambiguity also gives no value, so the outcome is the same.
- **Readability.** When only the BSD reading of `install -S evil/cleanroom.json docs` finds a target, the denial reads `install writes it into null`. `destinationPaths` (`:1081`) reports `gnu.dir`, which is null there. The decision is right and only the message is odd. This dates from R8-01.
- Carried from round 9, advisory: FreeBSD-only install options (`-T tags`, `-M metalog`) and the unverified macOS cp `-S`.
- The running MCP server is the installed 0.6.1, as in rounds 6 to 9. So I read CI with `gh pr checks` directly.
- The project is in general mode (no `docs/cleanroom.json`), so there are no `denied` entries since `lastReviewCommit` to check.
