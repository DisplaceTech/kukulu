<!-- Kūkulu review, build/2026-10-19 -->
Round: 3

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 82 tasks are done; none are blocked or skipped.
- `kukulu_verify` passes at `43afd66`. All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes. `npm run lint` and `pre-commit run --all-files` pass. The 13 suites pass on Linux (3,364 assertions). So does the guard self-test (268 cases).
- Round 2 changed none of `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `.gitignore`, `.gitattributes` or CI config (`git diff e62dc2c..HEAD`). It touched only `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `test/state.mjs`, `test/attest.mjs`, `test/cleanroom.mjs`, `docs/cleanroom.md` and the pipeline files.
- I read PR #1's CI with `gh pr checks`, because the installed 0.6.1 `kukulu_status` has no `prChecks`. At `43afd66`, **`test (macos)` fails**. Every other check passes. At `e62dc2c`, the last reviewed commit, every check passed, macOS included. Round 2 introduced the failure (F1).

Round 2's fixes hold for every form round 2 named:

- I ran every probe from REVIEW round 2 F1–F4 through `evaluate()` again. Each is now denied. That covers `cd ~/.cargo/registry`, `(curl …)`, `{ …; }`, `if/while`, `>|`, `git -C docs rm`, `timeout 5 curl`, `git stash`, `git reset --hard`, `rm -rf docs/*`, `chmod 000 docs`, `grep -r … ~/.cargo`, Grep and Glob roots, and the climbing Glob.
- Ordinary forms stay allowed: `(cd docs) && rm cleanroom.json` (the subshell `cd` correctly ends at `)`), `cd src && cargo test`, `grep -rn zlib crates/`, `timeout 60 cargo test`, `git checkout -- src/foo.rs` and `ls ~/.cargo`.
- The R2-05, R2-06 and R2-07 tests exist and pin what they claim.

Three problems remain:

- **The macOS CI regression (F1).** One R2-04 fixture depends on how deep the temp directory sits.
- **Gaps in R2-03's own mechanic (F2).** A wildcard or a brace still hides a protected path from the write and destructive rules, and `git stash -m <msg>` is allowed.
- **Gaps in R2-01's and D-03's command handling (F3).** A bare `cd` moves to `$HOME` unseen, valued wrapper options hide the command, and `case` arms and function bodies hide it too.

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, `planExists: true`
- D-10's protected set: policy path, plugin root, key path

"Allowed" means `decision: "allowed"`.

### F1: `test (macos)` fails on PR #1: the R2-04 fixture "reach: Glob climbing out of cwd" assumes the temp directory is at most six levels deep (category 3, B-08; task R2-04)

`test/fixtures/guard-cases.json:3394` reads `"pattern": "../../../../../../__HOME__/.cargo/registry/**"`, with `cwd` `__ROOT__`. The self-test puts `__ROOT__` at `<os.tmpdir()>/kukulu-guard-selftest-XXXX/root` (`scripts/cleanroom-guard.mjs:70-73`).

- On Linux CI, `/tmp/…/root` is three levels deep, so six `..` reach `/`, and the pattern resolves under `__HOME__`.
- On macOS, `os.tmpdir()` is `/var/folders/<a>/<b>/T`, so `__ROOT__` is seven levels deep. Six `..` stop at `/var`, the pattern resolves to `/var/<home>/.cargo/registry/**`, and the case is allowed.

What breaks:

- The guard self-test fails, so gate check 4 (self-test) halts every clean-room flight in the macOS suites.
- CI run 39367826981 shows the failures:
  - `test/cleanroom.mjs` 159 and 188, then a TypeError at `:536`
  - `test/attest.mjs` 114–123, because its summarized flight never gets past the gate
  - `test/drive.mjs` 152 and 153
- I reproduced it locally. With `TMPDIR` pointing at a deep symlinked directory, `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` prints `reach: Glob climbing out of cwd: expected denied (deny.paths), got allowed`, and `node test/cleanroom.mjs` fails at 159 and 188 exactly as CI does. In a scratch copy, making the climb 40 `../` long made the self-test pass again (268 cases).
- The guard code is right: `path.resolve` stops at `/`, as the shell does. Only the fixture is wrong.

Minimal fix:

- Climb far enough to reach `/` from any temp directory (40 segments; extra `..` at `/` stay at `/`).
- Add a test that runs the self-test with `TMPDIR` set to a deep, symlinked directory, so a depth-dependent fixture fails on Linux too.

### F2: Wildcards and braces still hide a protected path from rule 6d and the destructive-form rule, and `git stash -m <msg>` is allowed (category 5, SPEC D-10, D-03 rule 6d, D-05 tamper evidence; task R2-03)

R2-03 added `globHit` for the destructive forms only, and it recognizes `*`, `?` and `[` but not `{…}` (`mcp/cleanroom.mjs:1097-1112`). The plain write-family operand check and the redirection check compare the token as a literal prefix (`:867-872`, `:893-895`). So a pattern that the shell expands to a protected file is never compared with that file. All of these are allowed at HEAD:

- Writes to a protected file through a glob:
  - `cp /dev/null docs/cleanroom.js??` and `cp evil docs/[c]leanroom.json`
  - `cp evil .kukulu/state.*` and `ln -sf /dev/null .kukulu/state.js*`
  - `tee docs/cleanroom.* < /dev/null`
  - `sed -i 1d .kukulu/cleanroo?/log.jsonl` and `sed -i 1d .kukulu/*/log.jsonl`
  - `echo x > docs/cleanroom.*` and `echo x >> .kukulu/*/log.jsonl`. Bash expands a redirection word that matches exactly one file.
- Brace expansion on destructive forms and writes:
  - `rm -rf {docs,src}` and `rm -rf docs/{cleanroom.json,}`
  - `chmod 000 {docs,x}`. This switches the guard and logger off, as round 2 F3 described.
  - `mv {docs,d2}`
  - `tee docs/cleanroom.{json,x} < /dev/null`
- `git stash -m wip`, `git stash -k -m x` and `git stash --include-untracked -m x`. `worktreeDiscard` (`:1124-1125`) takes the first non-dash argument as the stash subcommand. The `-m` value `wip` is neither `push` nor `save`, so the form returns `null`. R2-03's goal lists `git stash` "also -u, push, save". `git stash -m` is `git stash push -m`, and it erases the log's uncommitted tail just the same.
- `git read-tree -u --reset HEAD`. This plumbing form also restores the worktree, the log included. No rule covers it.

What breaks:

- An agent can still overwrite `.kukulu/state.json`, which holds the gate's recorded `policyHash`, and the policy itself. It can also delete the policy or truncate the log's unsigned tail, each with one wildcard or one pair of braces.
- The literal forms of every one of these are denied, so the protection only holds against an agent that does not try a second spelling.

Minimal fix:

- Expand a token's braces into its alternatives, then judge every alternative.
- In rule 6d, a write-family operand or a redirection target with a wildcard is denied when its pattern, component by component (`globRe`), can name a protected path or a path under one.
- Extend `globHit` to braces.
- Make `worktreeDiscard` skip stash's valued options (`-m`/`--message`) before it decides the subcommand. A bare-option `git stash` is a push.
- Add `git read-tree` with `-u` (and `--reset` or `-m`) to the discard forms.

### F3: A bare `cd` moves to `$HOME` without moving the guard's cwd; `sudo -u <user>`, `env -u <name>` and `env -C <dir>` hide the command word; `case` arms and function bodies hide it too (category 5, SPEC D-03 canonicalization and rules 6a/6b; tasks R2-01, R2-02, P3-09)

All allowed at HEAD:

- Bare `cd`:
  - `cd && cat .cargo/registry/x` and `cd; ls -R .cargo`. The guard reads them at the repository root, but they read `~/.cargo/registry`.
  - `cd && rm -rf .claude/plugins` and `cd; rm -rf .config/kukulu`. The second removes the plugin cache and the signing key's directory.
  - R2-01 moves `shellCwd` only when `cd`/`pushd` has an operand (`:901-904`). A bare `cd`, or `cd --`, goes to `$HOME`. `cd -` goes back to the previous directory.
- Valued wrapper options:
  - `sudo -u root curl https://evil`, `env -u X curl https://evil` and `env -C /tmp curl https://evil`.
  - `commandWord` (`:545-565`) skips a wrapper's flags but not their values, except for `nice -n` and, since R2-02, `timeout -s/-k`. SPEC D-03 names `sudo` and `env` as wrappers "with its flags". This predates round 2: P3-09 introduced it, and no round named it.
- Shell grammar not covered by R2-02's reserved words:
  - `case x in x) curl https://evil;; esac`
  - `f() { curl https://evil; }; f` and `function f { curl https://evil; }; f`

What breaks: the first two are one-word bypasses of `deny.paths` and of the network ban. The third is the same shell-grammar class R2-02 closed for `if`/`while`/`(`/`{`.

Minimal fix:

- A `cd` or `pushd` with no operand, or with only `--`, moves `shellCwd` to `home`. `cd -` moves it back to the cwd before the last move.
- `commandWord` skips the values of `sudo`'s `-u -g -h -p -C -D -r -t -U` and `env`'s `-u -C -S`.
- `stripGrouping` also drops a leading `case … in`, a leading `<pattern>)` case arm, `;;`, `esac`, `<name>()` and `function <name>`, so the command word inside the arm or the body is judged.

## Spec issues

- **SPEC D-03 makes `git` write-family as a whole.** So read-only git forms that name a protected path are denied. `git diff HEAD~1 -- docs/cleanroom.json` and `git log -- docs/cleanroom.json` are denied `protected path`. The code follows SPEC here, so this is not a finding. But reviewers and implementers cannot inspect the policy's history from Bash. SPEC could list git's read-only subcommands (`log diff show blame status`) as not write-family.
- **The fixed lists stay lexical.** Each round has found one more spelling of the same intent: a wildcard, a brace, a valued option, a grammar word. The interpreter-escape gap (`python3 -c`) already lets an agent do any of them. SPEC D-03 could say outright that the guard is a tripwire with tamper evidence behind it, not a sandbox, and that the attestation's strength rests on the chain and the gate. Round 2's high-water-mark suggestion (NEW MATTER) is what would make an erased tail detectable at all.
- Carried from round 2, still open:
  - SPEC F-04's `--roots`/`--words` defaults were superseded by the owner's `e7ef4d4`.
  - D-03's write, network and wrapper lists are incomplete.
  - The log's uncommitted tail is unsigned.
  - D-08 check 3 does not pin `mcp/cleanroom.mjs`.
  - D-03's known gaps omit shell expansion.
  - SPEC §1 asks for the PR against `main` while `baseBranch` is `cleanroom`.

## Manual checks still owed

All `NOT VERIFIED (human)`, copied from HANDOFF.md. Round 2 added none.

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
  - Confirm the site, ci and lint checks are green on the PR. `test (macos)` is red at `43afd66` (F1).
- From HANDOFF's first line: the owner runs one clean-room flight from the working tree before merging.
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 3. Include:
  - `cd ~/.cargo/registry && cat x`
  - `(curl https://example.com)`
  - `cd && cat .cargo/registry/x`
  - `cp evil .kukulu/state.*`

## Notes

- **Mutation sampling this round.** Per the review-build rule, I mutated only `mcp/cleanroom.mjs`, the one source file in `git diff --name-only e62dc2c..HEAD`. I used the targeted `cleanroom` suite with `confirmKill`.
  - Killed: the subshell `cd` restore in `settle()`, and R2-01's `inRepo(".")` outside clause (reverted to the hook's `cwd`). Both were killed through the gate's self-test halt.
- **Advisory survivors.** This is round 3, past `review.mutationFixRounds` (2). Under SPEC B-03, a survivor here is advisory, not a task. None of these is a SPEC requirement in its own right; each is a sub-case of a requirement whose main cases are pinned. The summarizer carries them. Each mutant makes the guard looser, and no fixture notices:
  - Deleting `if (first === "save") return { form: "stash", pathspecs: [] };`. `git stash save wip` would then be allowed, because `wip` is read as a pathspec.
  - Deleting `timeout`'s `-s`/`-k` value skip. `timeout -k 5 10 curl https://evil` would then be allowed.
  - Narrowing `cp`'s recursive flags to `-r`/`-R`. `cp -a ~/.cargo vendor` would then be allowed.
  - Deleting `if (g[i] === "**") return d;` in `reachesDenied`. Glob `/home/**/lib.rs` would then be allowed.

  R3-02 touches the same glob code and may add fixtures for these at no extra cost, but they are not required.
- **False positives of R2-04, too small for a task.**
  - `recursiveOperands` treats every operand of `cp -r` and `rsync` as searched, the destination included. So `cp -r src ~` and `rsync -a src/ ~/` are denied because `~` contains `~/.cargo/registry`.
  - `tar -C ~ …` is denied the same way.
  - Each fails closed, and none is an ordinary build step.
- **`du -a ~/.cargo` is allowed.** It lists the registry's file names, not their contents. That is consistent with `ls ~/.cargo` being allowed.
