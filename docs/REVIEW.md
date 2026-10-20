# Review: Kūkulu 0.7.0 build (build/2026-10-19)

Round: 2

## Verdict

CHANGES REQUESTED

What I checked:

- All 75 tasks are done; none are blocked or skipped.
- `kukulu_verify` passes. Every one of the 27 `docs/kukulu.json` constraints is clean, and its fixture self-test passes. So do `npm run lint`, `pre-commit run --all-files` and the 13 suites (3,288 assertions).
- `npm run check:site` passes (76 self-test cases, rules 1–14 and 16), and so does the guard self-test (194 cases).
- No commit between the merge base `ef3860c` and HEAD touches `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/copy-changes.json`, `checks.json`, `assets/`, `screens/`, `.gitignore` or CI config. `fromas` no longer occurs in the page or the mockup.
- CI on PR #1 at `e7ef4d4`: every check passes except `test (macos)`, which was still pending when I looked. That is not a finding. The installed 0.6.1 `kukulu_status` has no `prChecks`, so I read the checks with `gh pr checks`.

Round 1's fixes hold:

- All six round-1 survivors are now killed: `verifyChain`'s prev check and seq check in both copies, liveness, the genesis match, and the trailer's default task.
- R1-07 bounds `gh pr view` and reports `review.mutationFixRounds`.
- I probed the bypass forms R1-01/R1-02 named, and each is now denied.

Probing `evaluate()` past those forms turned up four things:

- **A regression.** R1-01 stopped checking `cd` segments against `deny.paths`.
- **Shell grammar.** Grouping and reserved words still hide the command word, which defeats the network rule and every Bash rule.
- **Discarded log entries.** Git forms that discard uncommitted work can erase the log's unsigned tail without the gate noticing. A non-recursive `chmod` on an ancestor can switch the guard off.
- **Recursive reads.** A recursive read of an ancestor of a `deny.paths` entry reads the denied tree.

## Findings

Most severe first. Every probe below ran `evaluate()` with `templates/cleanroom.example.json`, root `/tmp/proj`, home `/home/u`, the plan present, and D-10's protected set. "Allowed" means `decision: "allowed"`.

### F1: Regression: a `cd` segment is no longer checked against `deny.paths`, and the cwd it sets never reaches the read rules (category 5, SPEC §5.2 `deny.paths`, D-03 rule 6b/6c), task R2-01

`mcp/cleanroom.mjs:777-781`. R1-01 handles `cd`/`pushd` by updating `shellCwd` and then running `continue`, which skips every rule for that segment, 6b included. At `1e8aea6` these were all denied (`denied path: /home/u/.cargo/registry (deny.paths)`); at HEAD they are allowed:

- `cd ~/.cargo/registry`
- `cd ~/.cargo/registry && cat x`
- `cd ~/.cargo/git`
- `pushd ~/.cargo/registry`

On top of that, `shellCwd` is used only by the protected-path rules (HANDOFF's R1-01 interpretation). Relative tokens and the "outside the repository" clause still resolve against the hook's `cwd`. So these are allowed, though each reads under a denied root or names a denied word outside the repository:

- `cd ~/.cargo && cat registry/x`
- `cd /usr/include && cat zlib.h`
- `cd / && grep -r zlib .`

That interpretation is not consistent with SPEC. `deny.paths` applies to "a target", and the target of `cat registry/x` after `cd ~/.cargo` is `~/.cargo/registry/x`. No guard case covers a `cd` into a denied root, which is why no test caught the regression.

What breaks: the shipped template no longer stops the most ordinary way of reading the Cargo registry.

Minimal fix:

- Judge a `cd`/`pushd` segment with every rule, so its directory operand is a token under 6b.
- Resolve every relative token and the 6c outside-the-repository clause against the effective cwd.
- The eight cleanflate false positives stay allowed (FP1 runs after a `cd` inside the repository).

### F2: Grouping, reserved words, `>|` and `git -C` hide the command word or the target from every Bash rule (category 5, SPEC D-03 canonicalization and rules 6a/6d, D-10), task R2-02

`commandWord` (`mcp/cleanroom.mjs:541`) takes the first token of a segment, so a leading `(`, `{`, `!` or a reserved word becomes the "command". These are all allowed, both at `1e8aea6` and at HEAD:

- `(curl https://evil)`, `( curl https://evil )`, `{ curl https://evil; }`
- `if true; then curl https://evil; fi`, `while true; do curl https://evil; done`, `! curl https://evil`
- `(rm -rf .kukulu)`, `{ rm -rf .kukulu; }`, `(echo hi > .kukulu/state.json)`
- `(cd docs && rm cleanroom.json)`, because `(cd` is not `cd`

Three related forms are also allowed:

- `echo x >| .kukulu/state.json` and `echo x 2>|.kukulu/state.json`. `splitSegments` splits the clobber operator `>|` as a pipe, so the target becomes a segment's command word.
- `git -C docs rm cleanroom.json` and `git -C .kukulu clean -fdx`. R1-02's `gitSubcommand` is used only by the network rule. `destructiveOperands` (`:949`) takes `docs` as git's subcommand, and the operands resolve against the hook's cwd instead of `-C`'s directory.
- `timeout 5 curl https://evil`, `nohup curl …` and `exec curl …`. These wrappers are not in `WRAPPERS` (`:533`).

What breaks: one pair of parentheses defeats the network ban and every self-protection rule.

Minimal fix:

- Before taking the command word, drop leading `(`, `{`, `!` and the reserved words (`if then elif else while until do`), and split `(`/`)` glued to a word.
- Judge a relative operand against every cwd the shell could be in at that point: the cwd before a subshell's `cd` and the one after. Deny if any form is protected.
- Do not split on `|` directly after `>`.
- In write-family git forms, skip global options with `gitSubcommand` and resolve operands against `-C`'s directory.
- Add `exec`, `nohup`, `timeout` (with its duration), `stdbuf` and `setsid` to the wrappers.
- Commands that run a command from their arguments (`find -exec`, `watch`, `parallel`, `busybox`) and programs outside the fixed network and write lists (`unlink`, `shred`, `perl -i`, `cargo fetch`, `rsync`) stay unrecognised. Name them in `KNOWN_LIMITS` and `docs/cleanroom.md`.

### F3: Erasing the log's uncommitted tail, and hiding the policy behind a permission change (category 5, SPEC D-10, D-05 tamper evidence, D-02), task R2-03

These are allowed:

- `git stash`, `git stash -u`, `git stash push`
- `git reset --hard`, `git reset --hard HEAD~1`
- `git checkout -f main`, `git switch --discard-changes main`

The hooks append to `.kukulu/cleanroom/log.jsonl` on every call, so between two checkpoint commits the log always has uncommitted entries. Each form above restores the log to the last committed checkpoint. The `denied` entries since then disappear. The next `appendEntry` continues from the restored tip, so `verifyChain` passes and the newest checkpoint still verifies. The gate (`mcp/server.mjs:214-236`) has nothing to compare against. R1-01's ancestor rule covers `git rm|mv|checkout|restore|clean` only when an operand names a protected path. These forms name none.

The same class:

- `rm -rf docs/*` and `rm -rf *`: a glob operand of a destructive form removes the policy, though no literal operand contains it.
- `chmod 000 docs`, `chmod a-rwx .kukulu` and `chown nobody docs`: the ancestor rule applies to `chmod`/`chown` only with `-R` (`:946`). But one non-recursive permission change on an ancestor makes `fs.existsSync(docs/cleanroom.json)` false; I checked that on this machine. `scripts/cleanroom-guard.mjs:146` and the logger then take the no-policy fast path, so every later call is allowed and unlogged until the agent restores the mode. Because the logger is silent too, a gate run after the restore sees allowed entries around the window and passes. (The round-2 mutant that made every `chmod`/`chown` destructive survived for this reason: its stricter behaviour is the correct one.)

What breaks: an agent can delete the record of its own denials, or switch the guard off for a stretch, without breaking the chain.

Minimal fix:

- Deny `git stash` (except `list`/`show`), `git reset --hard|--merge|--keep`, `git checkout -f`/`--force` and `git switch -f|--discard-changes` when they have no pathspec, or when a pathspec equals or contains a protected path.
- Deny a destructive-form glob operand whose pattern matches the next component of a protected path below the glob's literal directory.
- Treat `chmod`/`chown` of any operand that equals or contains a protected path as destructive, recursive or not.

### F4: A recursive read of an ancestor of a `deny.paths` entry reads the denied tree (category 5, SPEC §5.2 `deny.paths` "a target under one is denied for every tool", D-03 rules 5 and 6b), task R2-04

These are all allowed, both at `1e8aea6` and at HEAD:

- `Grep { pattern: "inflate", path: "/home/u/.cargo" }` and `Glob { pattern: "**/*.rs", path: "/home/u/.cargo" }`
- `Glob { pattern: "~/.cargo/regist*/**/*.rs" }`, `Glob { pattern: "/home/u/.cargo/*/src/**" }` and `Glob { pattern: "../../home/u/.cargo/registry/**" }`. R1-02's check (`:738`) treats an absolute pattern as a literal path, so a wildcard before the denied component, or a relative pattern that climbs out, is never compared.
- `grep -r inflate ~/.cargo`, `rg inflate ~/.cargo`, `find ~/.cargo -name '*.rs'`, `ls -R ~/.cargo`
- `cp -r ~/.cargo /tmp/proj/vendor`, which copies the whole registry into the project
- `cat ~/.cargo/*/index/x`

A recursive operation's targets are everything under its operand, so each call above reads targets under `~/.cargo/registry/`.

What breaks: the prior-art roots the template denies can be read or copied in one call.

Minimal fix:

- For Grep, Glob and the recursive Bash forms (`grep -r|-R`, `rg`, `ag`, `ack`, `find`, `ls -R`, `tree`, `cp -r|-R|-a`, `tar`, `rsync`), deny an operand or search root that equals or contains a `deny.paths` entry or the key path.
- Match a glob token or Glob pattern, resolved against `path`/cwd, component by component against each `deny.paths` entry.
- `pathPatterns` regexes stay matched on named targets only; say so in `KNOWN_LIMITS`.

### F5: Survivors in `mcp/cleanroom.mjs`'s R1-02/R1-03 mechanics (category 3; mutation only), task R2-05

All three ran against `node test/cleanroom.mjs` (guard cases included), and all three survived. Each makes the guard stricter than intended, and no allowed fixture covers it:

- Deleting `if (valued.test(t)) i++;` (`:861` ff.). `grep -A 3 PATTERN path` then takes `3` as the pattern.
- Replacing `found.add(++i)` with `i++`. A `-e` value is then judged as a path.
- Deleting the quote tracking in `redirectTargets` (`:973`). `echo "a > .kukulu/state.json"` is then read as a redirection.

This task is queued on mutation results alone, which round 2 permits: the review-build rule mutates only the files changed since `lastReviewCommit`, and round 2 is not past `review.mutationFixRounds` (2).

### F6: `prChecks`' bounded `gh --version` is untested (category 3; mutation only), task R2-06

`mcp/server.mjs:3671`. Removing `timeout: CHECKS_TIMEOUT_MS` from `gh --version` survives `node test/state.mjs`. R1-07 named that bound, and docs/mcp-tools.md promises it ("a `gh --version` that times out reads as no `gh`"). The same mutation-only rule applies.

### F7: `repoRootOf`'s choice of root is untested (category 3; mutation only), task R2-07

`scripts/verify-attestation.mjs:335`, from the owner's commit `e7ef4d4`. Returning `path.dirname(dir)` instead of `dir` survives `node test/attest.mjs`. The test's in-repository word and its `/elsewhere` word are classified the same under either root, so an over-broad repository root would let a word outside the repository pass as inside. The same mutation-only rule applies.

## Spec issues

- **F-04's defaults are superseded.** SPEC F-04 says `--roots` and `--words` default to cleanflate's. The owner's `e7ef4d4` removes every default: `--roots` and `--words` are now required, and `--repo` defaults to the log's own repository. That is the owner's decision. SPEC F-04 should say so in the next revision. I do not treat it as drift.
- **D-03's fixed lists are incomplete.** The write family (`cp mv rm tee sed truncate chmod chown ln install dd git`), the network list and the wrapper list are constants in SPEC. They miss `unlink`, `rmdir`, `shred`, `find -delete`, `rsync --delete` and `perl -i` (writes). They also miss `cargo fetch|install|add`, `pip3`, `rsync`, `socat`, `telnet` and `aria2c` (network), and `timeout`, `nohup`, `exec` and `watch` (wrappers). R2-02 adds the wrappers and states the rest in `KNOWN_LIMITS`. SPEC should either extend the lists or name the class as a known gap.
- **The log's uncommitted tail is unsigned.** Even with R2-03, an interpreter escape (a known gap) can truncate `log.jsonl` back to the last checkpoint without breaking the chain. A high-water mark (the newest seq and hash) kept outside the worktree, for example beside the signing key, and compared by gate check 6 would detect it. That would be NEW MATTER for the owner's list.
- Carried from round 1, still open:
  - D-08 check 3 does not pin `mcp/cleanroom.mjs`.
  - D-03's known gaps omit shell expansion. R1-02 added it to `KNOWN_LIMITS`, but SPEC still lists four gaps.
  - SPEC §1 asks for the PR against `main` while `baseBranch` is `cleanroom`.

## Manual checks still owed

All `NOT VERIFIED (human)`, copied from HANDOFF.md. Round 1 added none.

- Phase 0 (P0-07): run the installed 0.6.1 plugin's `kukulu_migrate` on a throwaway `.foundry/` project, then run one task on it with the working-tree plugin.
- Phase 1 (P1-14): halt a throwaway flight with `kukulu_run_halt`, fix nothing, call `kukulu_run_resume` and confirm the refusal names the dirty tree; clean it and confirm the resume commit.
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
  - Confirm the site, ci and lint checks are green on the PR. `test (macos)` was pending at this review.
- From HANDOFF's first line: the owner runs one clean-room flight from the working tree before merging.
- After the review fixes, re-run the Phase 3 denial step in a live session with the R1-01, R1-02 and R2-01 to R2-04 bypass forms. Include `cd ~/.cargo/registry && cat x` and `(curl https://example.com)`.

## Notes

- **Mutants killed this round (13):**
  - Round 1's six survivors. The cleanroom suite names `verifyChain names a rehashed edit by its broken link` and `verifyChain names a seq gap`. The attest suite names `the verifier and mcp/cleanroom.mjs agree on a rehashed edit`. The cleanroom suite names the liveness, genesis and trailer tests.
  - R1-02's git global-option skip and `$HOME` expansion, the backtick substitution, the `cd` cwd update and the substitution depth cap. Each is killed through the gate's self-test halt and the guard cases.
  - R1-07's `gh pr view` bound (an RPC timeout in `test/state.mjs`).
- **Advisory survivor.** Disabling the `>&N` fd-duplication branch of `redirectTargets` survives. It is nearly equivalent: `2` and `-` resolve to unprotected paths.
- **`$HOME` inside single quotes.** `echo '$HOME/.cargo/registry'` is denied, because `$HOME` is expanded in every token, quoted or not. It is a harmless false positive. R2-01 or R2-02 may tighten it, but it is not required.
- **`prState`'s `gh` calls** (`mcp/server.mjs:3639`) are still unbounded. They predate the branch, and R1-07 marked them out of scope.
- **Machine path in the legacy test.** `test/attest.mjs` now passes `--repo /media/ericmann/Data/Projects/cleanflate` as fixture data for the excerpt. That is correct: it is the root that build ran in, and the verifier itself no longer carries it.
