<!-- Kūkulu review, build/2026-10-19 -->
Round: 9

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 96 tasks are done. None are blocked or skipped.
- At `b0d1722`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,542 assertions.
- `gh pr checks` on the draft PR, whose head is `b0d1722`: all eleven checks pass, `test (macos)` included.
- Round 8 changed only `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` and the pipeline files (`git diff --name-only 43abb3e..HEAD`).
  - It did not touch `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `docs/kukulu.json`, `.gitignore`, `.gitattributes` or CI config.
  - No existing fixture changed. Round 8 only added fixtures.
  - The R8-01 commit follows the template, and all five commits since `43abb3e` are signed (`%G?` is `G`).
- All twelve acceptance fixtures R8-01 names are in `guard-cases.json`, with the expected decision and reason. I ran every round-8 probe through `evaluate()` again, along with the forms R8-01's design constraints say must stay allowed or denied. Each one now behaves as the task requires, except the one in F1.

R8-01 fixed every form that round 8 named. But adding `--strip-program` to install's valued set introduced a regression: install's own flag `--strip` now swallows the next token. The task's own guard for this class of bug, "`mv --st evil/cleanroom.json docs` stays denied", has no fixture, so the suite cannot catch the same mistake on mv either (F2).

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, cwd `/tmp/proj`, `planExists: true`
- D-10's protected set from `protectedPaths()`

### F1: install's `--strip` is read as an abbreviation of `--strip-program`, so it swallows the source and the policy can be replaced or deleted (category 5, a regression introduced by R8-01; SPEC D-10 self-protection, D-03 rule 6d; task R8-01)

The cause:

- For every command except cp, `destinationPathsFor` (`mcp/cleanroom.mjs:1089`) reads options with `scanOption(t, spec)`.
- `scanOption` (`:581-592`) resolves a long option against the valued set only. It takes an exact match in that set, or else any prefix that names exactly one member.
- R8-01 added `--strip-program` to install's two sets (`:1031-1037`). `--strip` is not in either set, but it is a prefix of `--strip-program`, so the guard reads it as valued and takes the next token as its value.
- In GNU install, `--strip` is a long option of its own (`-s`, a flag). getopt takes an exact match before any prefix. So the token after `--strip` is an operand.
- cp does not have this problem, because `cpLong` (`:1048-1053`) resolves against cp's full list first. mv, ln and install have no such list.

| Command | at `43abb3e` | at HEAD |
|---|---|---|
| `install --strip-program=true --strip evil/cleanroom.json docs` | denied | **allowed** |
| `install --strip-program true --strip evil/cleanroom.json docs` | denied | **allowed** |
| `install --strip-program=true --strip -t docs evil/cleanroom.json` | denied | **allowed** |
| `install --strip evil/cleanroom.json docs` | denied | **allowed** |
| `install -v --strip evil/cleanroom.json docs` | denied | **allowed** |
| `install --strip evil/state.json .kukulu` | denied | **allowed** |

`install -s evil/cleanroom.json docs`, `install --strip x evil/cleanroom.json docs` and `install --strip --strip-program=true evil/cleanroom.json docs` are denied, because there the swallowed token is not the source.

I ran these with the real tool (GNU coreutils 9.4) in a scratch directory:

- `install --strip-program=true --strip evil/cleanroom.json docs` exited 0 and replaced `docs/cleanroom.json` with the evil copy. The `-t docs` form did the same.
- `install --strip evil/cleanroom.json docs` printed `strip process terminated abnormally` and exited 1. It had already overwritten `docs/cleanroom.json`, then unlinked it, so the policy was gone.

What breaks: one plain `install` replaces or deletes the policy, or the state file that pins its hash. Both are D-10 protected paths.

Minimal fix:

- Resolve the long options of mv, ln and install against each command's own full list from `--help`, the way `cpLong` does for cp. An exact name wins. Otherwise a prefix counts only if it names exactly one option in that list. The option takes a value only when the resolved name is in that command's valued set.
- The GNU coreutils 9.4 lists:
  - install: `--backup --compare --context --debug --directory --group --help --mode --no-target-directory --owner --preserve-context --preserve-timestamps --strip --strip-program --suffix --target-directory --verbose --version`
  - mv: `--backup --context --debug --exchange --force --help --interactive --no-clobber --no-copy --no-target-directory --strip-trailing-slashes --suffix --target-directory --update --verbose --version` (`--exchange` is 9.5)
  - ln: `--backup --directory --force --help --interactive --logical --no-dereference --no-target-directory --physical --relative --suffix --symbolic --target-directory --verbose --version`
- After the fix, `--strip` is a flag and `--strip-p` is `--strip-program`.
- `--stri` names two options, so it is unresolved and takes no value. Install rejects it as ambiguous, and the guard then reads the token after it as an operand. That can only deny more.
- Update `docs/cleanroom.md` rule 6 to say that mv, ln and install resolve their long options against their own lists, as cp does.

### F2: R8-01's design constraint "`mv --st evil/cleanroom.json docs` stays denied" has no fixture, and the only `--st` fixture cannot fail (category 3; task R8-01)

The task's acceptance list has `mv --st a.txt build/` (allowed). Its design constraints add that `mv --st evil/cleanroom.json docs` stays denied. That second form is not in `guard-cases.json`.

The allowed fixture passes whether or not mv reads `--st` as valued. If `--st` swallowed `a.txt`, the command would have no source and so no target, and it would still be allowed.

`kukulu_mutate` confirms the gap. I added `--strip-program` to mv's long set (`:1029`), which is the exact mistake the task's goal warns against. The mutant **survived** the targeted `cleanroom` suite. Under it, `mv --st evil/cleanroom.json docs` would be allowed.

Fix: add denied fixtures that put a protected landing path right after the option, for mv and for install (F1). F1's fix must keep them denied. See R9-01's acceptance tests.

## Spec issues

- **The guard is lexical, and the loop still has not converged.** Fix tasks per round: 7, 7, 3, 3, 3, 2, 2, 1, and now 1.
  - F1 is a regression, which is new. Every earlier round's finding was a pre-existing gap.
  - It is still the same class as rounds 5 to 8: an option table that does not match the real tool's getopt.
  - A table cannot be proved complete across GNU and BSD versions. The owner may still prefer to amend SPEC D-03 instead: it could say that wrapper and write-command option parsing is best-effort against the tools' documented options, and add that to `KNOWN_LIMITS`.
  - F1 is worth fixing either way. It is a plain `install` that replaces the policy.
  - `maxRounds` is 10. If R9-01 lands cleanly, round 10 is the last review the configuration allows.
- **Read-family words are judged only in path-like arguments** (SPEC D-03 rule 6c), carried from rounds 5 to 8. So `cat zlib.txt` is allowed and `cat ./zlib.txt` is denied `forbidden word in path argument`.
- **SPEC D-03 makes `git` write-family as a whole** (carried from rounds 3 to 8). `git add docs/*` is denied `protected path`.
- Carried from rounds 2 to 8, still open:
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
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 9. Include:
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
  - on macOS, `install -S evil/cleanroom.json docs`

## Notes

- **The fix task is not driven by mutation results alone.** F1 comes from probing `evaluate()` against SPEC D-10 and D-03, and from checking each form against the real tool. F2 is the mutation survivor that shows the suite would not have caught F1's class on mv either.
- **Mutation sampling.** Per the review-build rule for round 2 and later, I mutated only `mcp/cleanroom.mjs`, the one source file in `git diff --name-only 43abb3e..HEAD`. I used the targeted `cleanroom` suite with `confirmKill`.
  - **Killed (2), each confirmed by a clean re-run.** Both failed through the gate's guard self-test ("the first kukulu_next in a clean-room project goes on to the plan stage": `halt`).
    - The BSD install reading dropped from the union.
    - `--sparse` removed from cp's valued set.
  - **Survived (3):**
    - `--strip-program` added to mv's set. This is F2.
    - `--strip-program` removed from GNU install's set only. This one is equivalent: the BSD reading carries the same long set, and the union still denies.
    - cp's bundle split `t.search(/[tS]/)` changed to `/[t]/`. This is advisory, not a task. When there is no `t`, `slice(1, -1)` is a superset of the letters before `S`, so the mutant can only deny more (`cp -S.bak src build/` would read the `a` in `.bak` as `-a`). Only an allowed fixture would kill it.
- **Out of scope, as R8-01 decided (FreeBSD-only install options).** These are advisory:
  - `install -T tag evil/cleanroom.json docs` is allowed. FreeBSD's `-T tags` is valued, but both readings treat `-T` as `--no-target-directory`.
  - `install -Mdocs/cleanroom.json a b` is allowed. FreeBSD's `-M metalog` writes its value, and an attached option value is not judged as a path. The detached form is denied.
  - Neither can run on GNU or macOS install.
- **Unverified, macOS cp `-S`.** I could not confirm whether macOS cp has a `-S` flag. If it does, `cp -S evil/cleanroom.json docs` is the round-8 install `-S` mechanic on cp: the guard swallows the source as a suffix and allows the command. On GNU the same command fails with "missing destination file operand". The owner can check `man cp` on a Mac. I am not queuing this without a source.
- The running MCP server is the installed 0.6.1, as in rounds 6 to 8. So I read CI with `gh pr checks` directly.
- The project is in general mode (no `docs/cleanroom.json`), so there are no `denied` entries since `lastReviewCommit` to check.
