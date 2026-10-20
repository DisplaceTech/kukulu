<!-- Kūkulu review, build/2026-10-19 -->
Round: 8

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 95 tasks are done. None are blocked or skipped.
- At `05d2c3b`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,530 assertions.
- `gh pr checks` at `05d2c3b` (the pushed head): all eleven checks pass, `test (macos)` included.
- Round 7 changed only `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` and the pipeline files (`git diff --name-only 68aa74c..HEAD`). The one `docs/kukulu.json` change is the owner's `90be269` (`maxRounds` and `maxRoundsHard` raised to 10 through `kukulu_flight_options`).
  - Round 7 did not touch `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `.gitignore`, `.gitattributes` or CI config.
  - No existing fixture line changed. Round 7 only added fixtures.
  - Both commits follow the template, and every commit since `68aa74c` is signed (`%G?` is `G` on all eight).
- Every acceptance fixture that R7-01 and R7-02 name is in `guard-cases.json`, with the expected decision and reason. I ran every round-7 probe through `evaluate()` again. Each one is now denied, and every "stays allowed" form is still allowed.
- R7-02 is complete. I checked GNU findutils 4.9.0's long options for prefixes the guard now resolves differently from xargs (`--p`, `--a`, `--d`, `--e`, `--r`, `--s`, `--m`, `--i`) and found none.

R7-01 fixed the forms round 7 named. But its stated interpretation, that every other cp long option "takes a value only with `=`", is wrong for two of cp's options. Install has a third.

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, cwd `/tmp/proj`, `planExists: true`
- D-10's protected set from `protectedPaths()`

### F1: destinationPaths has no entry for cp's `--sparse` and `--no-preserve` or install's `--strip-program`, all of which take a required value, so a valued option after the destination turns its value into the destination (category 5, with the category-6 interpretation behind it; SPEC D-10 self-protection, D-03 rule 6d; task R7-01)

The cause:

- `destinationPaths` (`mcp/cleanroom.mjs:1064-1071`) values a cp long option only when `cpLong` resolves it to `--target-directory` or `--suffix`.
- `COPY_SPEC.long` (`:1027`) is install's set without `--strip-program`.
- `cp --help` (GNU coreutils 9.4) lists `--sparse=WHEN` and `--no-preserve=ATTR_LIST`. Both are required arguments, unlike the optional `--backup[=CONTROL]`, `--preserve[=ATTR_LIST]`, `--reflink[=WHEN]`, `--update[=UPDATE]` and `--context[=CTX]`.
- `install --help` lists `--strip-program=PROGRAM` the same way.
- getopt takes a required argument's value from the next token, and GNU getopt permutes options. So `cp SRC DIR --sparse always` is cp copying `SRC` into `DIR`.
- The guard reads `always` as a third operand, and so as the destination. `docs/cleanroom.json` is never judged.

| Command | at `b68996b` | at `68aa74c` | at HEAD |
|---|---|---|---|
| `cp evil/cleanroom.json docs --sparse always` | allowed | allowed | **allowed** |
| `cp evil/cleanroom.json docs --no-preserve mode` | allowed | allowed | **allowed** |
| `cp -r evil/. docs --sparse always` | allowed | allowed | **allowed** |
| `cp -rT evil docs --no-preserve all` | allowed | allowed | **allowed** |
| `cp evil/cleanroom.json docs --sp always` | allowed | allowed | **allowed** |
| `cp evil/state.json .kukulu --sparse never` | allowed | allowed | **allowed** |
| `install evil/cleanroom.json docs --strip-program strip` | allowed | allowed | **allowed** |

The attached forms (`--sparse=always`) and the valued option before the operands (`cp --sparse always evil/cleanroom.json docs`) are denied, as is `cp evil/cleanroom.json docs --suffix .bak`.

I checked these against the real tools on this machine (GNU coreutils 9.4) in a scratch directory. `cp evil/cleanroom.json docs --sparse always`, `cp evil/cleanroom.json docs --no-preserve mode`, `cp -r evil/. docs --sparse auto` and `install evil/cleanroom.json docs --strip-program strip` each replaced `docs/cleanroom.json`. Install only warned that it was ignoring `--strip-program`.

**Same mechanic, BSD.** BSD and macOS install has a `-S` that takes no value ("safe copy" in the FreeBSD and macOS `install(1)` synopsis `install [-bCcpSsv] [-B suffix] …`). `COPY_SPEC.short` makes `-S` valued for every one of the four commands. So `install -S evil/cleanroom.json docs` is allowed: the guard takes `evil/cleanroom.json` as the suffix, which leaves one operand and no targets.

- On GNU, the same command fails ("missing destination file operand").
- On macOS, where the suite runs (`test (macos)`), it installs the file at `docs/cleanroom.json`.
- I could not run BSD install here, so this form comes from its synopsis, on the same grounds as R6-01's `env -P` and R7-02's `xargs -J -R -S`.

What breaks: one plain `cp` or `install` replaces the policy, or the state file that pins its hash. None of these forms is a regression. They have been allowed since the destination logic was written. R7-01 was the task that resolved cp's long options against cp's own list, and its interpretation fixed the valued set at two options when cp has four.

Minimal fix:

- Give each of cp, mv, ln and install its own valued set, taken from its `--help`:
  - cp: `-S -t`, `--target-directory --suffix --sparse --no-preserve`
  - mv and ln: `-S -t`, `--target-directory --suffix`
  - install: `-g -m -o -S -t`, `--group --mode --owner --suffix --target-directory --strip-program`
- Keep cp's long options resolved through `cpLong`. A prefix such as `--sp` or `--no-p` is valued when it resolves to one of cp's four valued options.
- Do not add `--strip-program` to a set mv or ln reads. mv's `--st` is `--strip-trailing-slashes`, and reading it as `--strip-program` would swallow the source, which is the same mistake as round 7's `--o`.
- For an option whose arity differs between GNU and BSD (install's `-S`), judge the command under both readings and deny when either one writes a protected path.
- Update `docs/cleanroom.md` rule 6, which now says that "only `--target-directory` and `--suffix` take one".

## Spec issues

- **The guard is lexical, and the loop still has not converged.** Fix tasks per round: 7, 7, 3, 3, 3, 2, 2, and now 1.
  - This round's finding is not a regression. It is the same class as rounds 5 to 7: an option-arity table that does not match the real tool.
  - A table cannot be proved complete across GNU and BSD versions. The owner may still prefer to amend SPEC D-03 instead: it could say that wrapper and write-command option parsing is best-effort against the tools' documented options, and add that to `KNOWN_LIMITS`.
  - F1 is worth fixing either way. It is a plain `cp` that replaces the policy.
- **Read-family words are judged only in path-like arguments** (SPEC D-03 rule 6c), carried from rounds 5 to 7. So `cat zlib.txt` is allowed and `cat ./zlib.txt` is denied `forbidden word in path argument`.
- **SPEC D-03 makes `git` write-family as a whole** (carried from rounds 3 to 7). `git add docs/*` is denied `protected path`.
- Carried from rounds 2 to 7, still open:
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
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 8. Include:
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
  - on macOS, `install -S evil/cleanroom.json docs`

## Notes

- **This fix task is not driven by mutation results.** F1 comes from probing `evaluate()` against SPEC D-03 and D-10 and checking each form against the real tools. It does not come from a surviving mutant.
- **Mutation sampling.** Per the review-build rule for round 2 and later, I mutated only `mcp/cleanroom.mjs`, the one source file in `git diff --name-only 68aa74c..HEAD`. I used the targeted `cleanroom` suite with `confirmKill`.
  - Five mutants were killed, each confirmed by a clean re-run:
    - R7-01's `-T` read from the letters before a valued letter, removed
    - R7-01's cp long-option branch disabled, so cp falls back to `COPY_SPEC`
    - R7-01's attached `=` value replaced by "always attached"
    - R7-02's `-S` removed from xargs's valued list
    - `scanOption`'s optional-short check deleted (round 7's survivor)
  - All five failed through the gate's guard self-test ("the first kukulu_next in a clean-room project goes on to the plan stage": `halt`), which runs the fixture file.
  - Round 7's survivor is now killed, by R7-02's `xargs -iE curl https://evil` fixture.
- No survivors this round. The advisory survivors from rounds 3 to 6 are still open.
- The running MCP server is the installed 0.6.1:
  - Its `kukulu_review_submit` takes no `source` field.
  - Its `kukulu_status` reports neither `prChecks` nor `review.mutationFixRounds`.
  - So I read CI with `gh pr checks` directly, and applied the working-tree review-build rule (cap 2) by hand, as rounds 6 and 7 did.
- The project is in general mode (no `docs/cleanroom.json`), so there are no `denied` entries since `lastReviewCommit` to check.
