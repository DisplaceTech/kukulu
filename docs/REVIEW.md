<!-- Kūkulu review, build/2026-10-19 -->
Round: 7

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 93 tasks are done. None are blocked or skipped.
- At `3f5f23a`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,513 assertions.
- Round 6 changed only `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` and the pipeline files (`git diff --name-only a633575..HEAD`).
  - Round 6 did not touch `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `.gitignore`, `.gitattributes` or CI config.
  - No existing fixture line changed. Round 6 only added fixtures.
  - Each task updated rule 6 in `docs/cleanroom.md`. Each commit follows the template and is signed (`%G?` is `G` on all seven commits).
- Every acceptance fixture that R6-01 and R6-02 name is in `guard-cases.json`, with the expected decision. I ran every round-6 probe through `evaluate()` again. Each one is now denied, including `cp -rt . evil/docs`. Every "stays allowed" form is still allowed.
- R6-01's `shellWords` change is right. Inside double quotes it now keeps a backslash that does not precede `` $ ` " \ `` or a newline, which is what bash does.
  - `"c\url" https://evil` is now allowed. That is correct: bash runs a command literally named `c\url`.
  - `bash -c "c\url …"`, `sh -c`, `eval` and the unquoted `c\url` are still denied.

Round 6's fixes hold for every form round 6 named. Two problems remain:

- **F1 (cp option parsing).** One gap is a regression from R5-02; the other is a spelling R6-02's own fix left out.
- **F2 (xargs).** Valued options are missing from the table.

I checked both bypasses against the real tools on this machine: GNU coreutils 9.4 and findutils 4.9.0. I used `echo` in place of `curl` and a scratch directory in place of the project. Each form ran its command or replaced the file.

The flight is now past `maxRoundsHard` (6), so this submission halts it for the owner (see Spec issues).

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, cwd `/tmp/proj`, `planExists: true`
- D-10's protected set from `protectedPaths()`

The "at `b68996b`" and "at `b6846fe`" columns come from `git show <rev>:mcp/cleanroom.mjs`, run with the same inputs.

### F1: destinationPaths reads cp's long options against install's valued set, and ignores `-T` in a valued bundle, so a recursive copy that replaces the policy passes (category 5, partly a regression; SPEC D-10 self-protection, D-03 rule 6d; tasks R5-02, R6-02)

**Gap 1: `--o` is read as `--owner`.**

- `destinationPaths` (`mcp/cleanroom.mjs:1064`) runs `scanOption(t, COPY_SPEC)` on every option token before it looks at `CP_LONG`.
- `COPY_SPEC.long` (`:1027`) is the valued set shared by cp, mv, ln and install: `--target-directory --suffix --mode --owner --group`.
- So for cp, `--o` is read as install's `--owner`, and it swallows the next token as its value.
- GNU cp has no `--owner`. To cp, `--o` is the unique prefix of `--one-file-system`, which takes no value.
- With the source swallowed, one operand is left. `destinationPaths` returns no targets, and nothing is judged.

**Gap 2: `-T` in a valued bundle.**

- In the valued-bundle branch (`:1068`), the letters before the valued letter are checked for recursion only, never for `-T`.
- So in `cp -rTS .bak evil docs`, the `T` is lost. The source is judged at `docs/evil`, not at `docs`.
- R6-02's task was to "read -T from a short bundle". It reads it only from bundles that have no valued letter.

| Command | at `b68996b` | at `b6846fe` | at HEAD |
|---|---|---|---|
| `cp -r --o evil/. docs` | denied | **allowed** | **allowed** |
| `cp -rT --o evil docs` | allowed | allowed | **allowed** |
| `cp --o -rT evil docs` | allowed | allowed | **allowed** |
| `cp -rTS .bak evil docs` | allowed | allowed | **allowed** |
| `cp -TrS.bak evil docs` | allowed | allowed | **allowed** |
| `cp -aTS~ evil .kukulu` | allowed | allowed | **allowed** |

On this machine, `cp -r --o evil/. docs`, `cp -rT --o evil docs` and `cp -rTS .bak evil docs` each replaced `docs/cleanroom.json` with `evil/cleanroom.json`. With `-S`, cp also left the old policy behind as `docs/cleanroom.json.bak`.

What breaks: one plain `cp` replaces the policy, or the state file that pins its hash. This is the fifth round in a row that finds this hole. `cp -r --o evil/. docs` is a fix round loosening the guard: R5-02 made it allowed, and round 6 missed it.

Minimal fix:

- For cp, resolve a long option through `cpLong` (the full `CP_LONG` list) before anything else. It is valued only when it resolves to `--target-directory` or `--suffix`.
- Keep `COPY_SPEC`'s long set for install, mv and ln. None of their long options collides with `--o`, `--m` or `--g` the way cp's `--one-file-system` does.
- In the valued-bundle branch, read `T` from the letters before the valued letter, the same way the line reads `[rRa]` (`cp -rTS .bak`, `cp -TrS.bak`).

### F2: xargs's `--process-slot-var` (GNU) and `-J`, `-R`, `-S` (BSD and macOS) are not in VALUED_OPTIONS, so their value is taken as the command word (category 5; SPEC D-03 canonicalization "a wrapper (… `xargs` …) with its flags", rule 6a; tasks R4-01, R5-01, R6-01)

`VALUED_OPTIONS.xargs` (`mcp/cleanroom.mjs:548`) has no `--process-slot-var`.

- `xargs --help` on this machine (findutils 4.9.0) lists `--process-slot-var=VAR`. It requires an argument, and as a separate token it takes the next one.
- `echo a | xargs --process-slot-var V echo PSV` prints `PSV a` here.
- The guard reads the token as a plain flag. It then takes `V` as the command word, and `curl` is never seen.
- `--p` is a unique prefix of the same option, both in GNU xargs and once the option is in the table.

The BSD and macOS xargs synopsis lists three valued options the table lacks: `-J replstr`, `-R replacements` and `-S replsize`. The suite runs on macOS (`test (macos)`), and R6-01 added BSD `env -P` on the same grounds. I could not run BSD xargs here, so these three are from its synopsis.

Allowed at every revision since `2d0cfba`:

- `xargs --process-slot-var V curl https://evil` and `xargs --p V curl https://evil`
- `xargs -J % curl https://evil`, `xargs -R 1 curl https://evil` and `xargs -S 255 curl https://evil`

`xargs --process-slot-var=V curl https://evil` is denied, because the value is attached.

What breaks: one valued xargs option in front of a network command gets past the network ban.

Minimal fix:

- Add `--process-slot-var` to xargs's long valued list.
- Add `-J`, `-R` and `-S` to its short valued list. GNU xargs has none of the three, so no GNU spelling changes meaning.

Fold in one test gap from this round's mutation sampling (see Notes):

- Deleting the optional-short check in `scanOption` (`:593`) survives.
- No fixture has an optional letter before a valued one in a bundle, such as `xargs -iE curl https://evil`.
- At HEAD, `-iE` is `-i` with the replace string `E`, and curl is the command. `echo a | xargs -iE echo ran-iE` prints `ran-ia` here.
- Without the check, `E` is read as the valued `-E`, which swallows `curl`, and the guard allows the command.
- A fixture for `xargs -iE curl https://evil` belongs with F2's fixtures. It tests the D-03 wrapper-flag requirement, so the fix task cites the review, not mutation.

## Spec issues

- **The guard is lexical, and the loop is still not converging.** Fix tasks per round: 7, 7, 3, 3, 3, 2, and now 2. Each round since round 4 has found its holes in the option scanning of the round before.
  - F1's `cp -r --o` is the fourth round running in which a fix round made the guard looser (R4-01, R5-01, R5-02).
  - This round is past `maxRoundsHard` (6), so `kukulu_review_submit` halts the flight.
  - The owner may prefer to amend SPEC D-03 instead. It could say that wrapper and write-command option parsing is best-effort, add that to `KNOWN_LIMITS`, and stop the loop here.
  - F1 is worth fixing either way. It is a plain `cp` that replaces the policy, and one of its forms was denied before round 5.
  - The decision is the owner's: lift the cap with `kukulu_flight_options({ maxRoundsHard: 7, resume: true })`, or amend the spec.
- **Read-family words are judged only in path-like arguments** (SPEC D-03 rule 6c), carried from rounds 5 and 6. So `cat zlib.txt` is allowed and `cat ./zlib.txt` is denied `forbidden word in path argument`.
- **SPEC D-03 makes `git` write-family as a whole** (carried from rounds 3 to 6). `git add docs/*` is denied `protected path`.
- Carried from rounds 2 to 6, still open:
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
- From round 3: `gh pr checks` shows `test (macos)` green after the push.
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 7. Include:
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

## Notes

- **These fix tasks are not driven by mutation results.** Both findings come from probing `evaluate()` against SPEC D-03 and D-10, and from checking each form against the real tools. Neither comes from a surviving mutant, so each task is `review`-sourced.
- **Mutation sampling.** Per the review-build rule for round 2 and later, I mutated only `mcp/cleanroom.mjs`, the one source file in `git diff --name-only a633575..HEAD`. I used the targeted `cleanroom` suite with `confirmKill`.
  - Five mutants were killed, each confirmed by a clean re-run:
    - env -S's `\_` replacement removed
    - the `-T` stands-for-the-destination clause (`asSelf`) removed
    - `cpLong` prefix matching made exact-only
    - the double-quote backslash rule reverted to "always escape"
    - an optional long option's empty value turned back into "takes the next token"
  - All five failed through the gate's guard self-test ("the first kukulu_next in a clean-room project goes on to the plan stage": `halt`), which runs the fixture file.
- **One survivor.** Deleting `scanOption`'s optional-short check (`:593`) survives.
  - It changes a decision only for a bundle with an optional letter before a valued one (`xargs -iE curl …`).
  - This round is past `review.mutationFixRounds` (2), so the survivor alone is not a task.
  - It points at an untested D-03 wrapper-flag form, so F2's task adds the `-iE` fixture.
- The advisory survivors from rounds 3 to 6 are still open.
- The running MCP server is the installed 0.6.1. Its `kukulu_review_submit` takes no `source` field, and its `kukulu_status` reports no `review.mutationFixRounds`. I applied the working-tree review-build rule (cap 2, the default in `cfg()`) by hand, as round 6 did.
- The project is in general mode (no `docs/cleanroom.json`), so there are no `denied` entries since `lastReviewCommit` to check.
