# Handoff: build 0.8.1

- Branch: `build/2026-11-11`
- Base commit: `36df873` (main)
- Head commit: see the PR; the last task commit is `bcf4b65`
- Tasks: 21 done, 0 blocked, 0 skipped, 0 open

There is no "do not merge" line: this release has nothing a human must run first.

## Blocked and skipped tasks

None.

## Interpretation choices

- P0-01: a short option token that starts with a letter is scanned letter by letter, so `-i.bak` counts as in place. No existing guard fixture changed.
- P0-02: a heredoc delimiter made only of digits is never a heredoc (it is an arithmetic shift). No existing fixture changed.
- P1-02: `test/plugin.mjs` (not in Files touched) pattern-matches `cfgFrom`'s signature, so its matcher was widened for the new `limit` parameter. The `extraVerify` refusal location reads `extraVerify['<prefix>'][<i>]`, as the existing refusals write it.
- P1-03: "no log" after the archive means no `log.jsonl`; the `.kukulu/cleanroom` directory remains.
- P1-04: `localState` is judged before the fast-forward, so a stale local base reports `stale` even when `fastForward` is `done`. `test/harness.mjs` needed no change.
- P1-05: the version digits come from the first `Version:` line of `docs/SPEC.md`, tolerating a `Status` on the same line.
- P2-01: `finalizeRepo` in `test/review.mjs` merges `finalize: "auto"` into its policies (and takes `null` for no block), so the existing auto-merge cases keep their meaning.
- P2-02: `resolvePolicies` validates the global and profile policies itself and does not check that the selected profile exists (`resolveRouting` refuses that). `cfg()` and `finalizeConfig` return the layered policies; `cfgFrom` stays project-only. The finalize-draft test is in `test/routing.mjs` with its own repo setup.
- P2-03: `SIMILARITY.md` always lists a group line (`default` for an ungrouped config), so its bytes change for existing configs. `verifyControlBundle` returns a map by pair id so every positive pair with a control is checked.
- P2-04: `test/fixtures/compare/expected.txt` gained the `default` group name on each control line.
- P2-05: the verifier note still lists every reported model and fires when any one is not `sameModel` with the declared one.
- P3-03: the review-build skill does not name `kukulu_run_resume`, because the existing plugin test requires every tool a skill names to be on the reviewer's `tools:` line. No server change was needed: a halt during review already resumed into review.
- P3-04: a `cargo test` command with no standalone `--` is refused too.
- P3-05: every SPEC section 6 requirement already had a CHANGELOG line from its task.

## `⚠️ ASSUMPTION` config keys

None were added or tuned in this flight. `policies.finalize`'s `"ready"` default and `policies.archive` are owner decisions, written only in `cfgFrom`. The MCP timeout lives only in `.mcp.json`.

## Manual checks (NOT VERIFIED (human))

- Phase 0: in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed, and the apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- Phase 1: with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error; after a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- Phase 2: with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"` with `policySources.finalize` `"global"`.
- Phase 3: on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation; `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## Codebase notes

- `kukulu_verify` reports `ok: false` on every task because the constraint `no-hardcoded-mcp-timeout` matches the literal inside `docs/kukulu.json` itself (its own description and fixtures). The file may not be edited in this flight, and every other check passed. The same constraint also refuses a `kukulu_task_done` log that spells the number. Logged as Kūkulu friction; the reviewer should treat that single hit as pre-existing.
- `kukulu_task_done` requires HEAD's subject to start with the task id, and `kukulu_feedback_log` makes its own commit, so log feedback only after `kukulu_task_done`; otherwise an empty marker commit with the task subject is needed.
- `stripHeredocs` is the new front of `splitSegments`; the internal `splitRaw` is the old splitter and is what `bashVerdict` calls on text whose heredoc bodies are already removed. Calling `splitSegments` on stripped text would swallow the lines after an operator as a body.
- Test source must not contain a line matching `sed -i` (the `no-gnu-sed-inplace` constraint also hits assertion names); `test/cleanroom.mjs` builds its in-place sed commands from a `SED` variable.
- `cfg()` now reads and validates the global config's `policies`, so a malformed global file is refused from more tools than before (anything that calls `cfg()`).

## For a reviewer

- Server behavior changes: `kukulu_release` was rewritten to read `origin/<base>` (refusals before the tag, fast-forward last); `nextDecision` moved genesis and the gate below the halted, awaiting-signing and archived-done returns; `cfgFrom` takes a `limit` (the plugin's MCP limit) and refuses longer command timeouts.
- `scripts/verify-attestation.mjs` duplicates `sameModel` and `normalizeModel` of `mcp/cleanroom.mjs` on purpose, and the `KNOWN_LIMITS` `indirect` text changed in both copies identically.
- Tool count stays twenty-six.

## Round 1

Fix tasks R1-01 to R1-04, all done (25 of 25 tasks done, none blocked).

- R1-01: `docs/kukulu.json` added to the exclude list of `no-hardcoded-mcp-timeout`; constraints are all ok.
- R1-02: guard heredoc scan ignores `<<` in arithmetic and comments, removes quotes from the whole delimiter word; `sed` accepts abbreviated long options. Interpretation: an unclosed `((` is not arithmetic. 10 new fixtures, no existing fixture changed.
- R1-03: three new `kukulu_release` tests (signed tag from origin's archived state, localState current, fastForward up to date); each mutant of the server line fails its test. No server change.
- R1-04: profile policy errors read `profiles.<name>.policies.<key>`; every `cargo` word is checked for `cargo test` with `{filter}` before `--`; README finalize row states the auto-merge condition.
- Known red: `check-names` fails on `docs/PLAN.md:525` (the plan's R1-01 text spells the display name in ASCII in prose). That breaks `npm run lint`, pre-commit and one `plugin` assertion. I cannot edit PLAN.md; logged as feedback. Every other suite passes.

## Round 2

Fix tasks R2-01 to R2-04, all done (29 of 29 tasks done, none blocked). `kukulu_verify` is ok after each task: lint, pre-commit, npm test, both guard self-tests.

- R2-01: the one-line fix of the ASCII display name at `docs/PLAN.md:525`; `check-names` is green again, so lint, pre-commit and the plugin suite pass (the Round 1 known red is closed).
- R2-02: `stripHeredocs` skips `${...}` and `$[...]` (nesting-aware, quote-aware; an unclosed one is not special). Five fixtures (R2-02); `docs/cleanroom.md` and the CHANGELOG line name both forms. No existing fixture changed.
- R2-03: tests only. Three fixtures (R2-03) and a `sedInPlace` row cover sed's attached long-option value and the `((` subshell check. No existing fixture changed.
- R2-04: `validateMutation` compares each `cargo test` with the first `--` after it. Interpretation: a `{filter}` that sits before the cargo test is not judged against it; only a missing `--` refuses then. Two routing assertions.

## Round 3

Fix task R3-01, done (30 of 30 tasks done, none blocked). `kukulu_verify` is ok: lint, pre-commit, npm test, both guard self-tests.

- R3-01: `stripHeredocs` copies through an array-subscript assignment (`a[1<<n]=3`), a compound array assignment (`a=([1<<n]=3)`) and a backtick span, so a `<<` inside is never an operator (unclosed is not special). 12 fixtures (R3-01): ten denied, two allowed. `docs/cleanroom.md` and the CHANGELOG line name them. No existing fixture changed.

## Round 4

- R4-01 (done, 0398316): `stripHeredocs` copies a `[[ ... ]]` conditional and a `?*+@!(...)` extglob group through unread, so a `<<` inside no longer hides later commands. The arithmetic branch still wins for `$((2*(1<<3)))`. No interpretation choices.
- Tests: 12 new `(R4-01)` fixtures in `test/fixtures/guard-cases.json`, one `stripHeredocs` assertion in `test/cleanroom.mjs`. `docs/cleanroom.md` and the A-02 CHANGELOG line extended.
- Counts: 31 done, 0 blocked, 0 skipped. `kukulu_verify` is green.

## Round 5

- R5-01 (80c02ca): `stripHeredocs` gains a shared `commandPosition` helper. `[[` is a conditional only in command position (start, after newline `;` `&` `|` `(` `{`, or after if/then/else/elif/while/until/do/time/`!`); elsewhere it is an ordinary word. `!(` in command position is not copied through: a heredoc inside it has its body judged as commands, covering both extglob readings. Interpretation: an unclosed `!(` group extends to the end of the command.
- 11 fixtures ending `(R5-01)` added (5 regressions, 5 pins, 1 allowed); no existing fixture changed. Guard self-tests pass on both templates.
- Known red baseline, not from this round: `npm run lint` and the plugin suite's check-names fail at `docs/kukulu.json:655` (a literal macron u in a `progress-no-bare-macron` shouldMatch example). Logged as feedback.
- HEAD of the task is a no-op marker commit `6a0975f` because the feedback commit landed after 80c02ca.

## Round 6

Tasks R6-01 to R6-03 are done (35 of 35 done, none blocked).

- R6-01: `docs/kukulu.json` re-escaped (diff against d9b19ea is the two maxRounds lines); `scripts/check-names.mjs` skips only the bare-letter rule for `.kukulu/feedback.jsonl`; two plugin assertions.
- R6-02: a heredoc body whose operator line pipes (`|` or `|&`) into a later sh, bash, zsh, dash or ksh stage without `-c` is judged as commands. Interpretation: only the operator's own line is scanned for the pipeline.
- R6-03: two readings of every heredoc command (the second only when the first skipped a `<<`), denied when either denies; the negated-subshell marking is gone. Interpretation and SPEC conflict: the acceptance fixture `!(cat <<EOF` / `rm -rf .kukulu/cleanroom` / `EOF` / `)` cannot be allowed, because reading one copies the group through and judges the rm line. It is kept as a denied fixture; the owner should reconcile SPEC A-02 rule 6 with it.
- Check by hand: after push, the four PR checks (test node 22/24/26, pre-commit) pass.

## Round 7

Task R7-01 is done (36 of 36 done, none blocked).

- R7-01: `pipesIntoShell` now decides pipeline membership over the whole pipeline: a backslash-newline is a blank, a trailing `|` continues on the first line after the bodies the line opened, and each stage is read after `stripGrouping` so `(bash)` and `{ bash; }` count. Five (R7-01) fixtures, two `stripHeredocs` assertions, `docs/cleanroom.md` and the A-02 CHANGELOG line updated. No Interpretation choices.
- Check by hand: after push, the PR checks pass.

## Round 8

Three fix tasks, all in the guard (SPEC A-02); no blocked or skipped tasks. Head after the round's last task: 7907422 (progress commit).

- R8-01: the second reading of `stripHeredocs` marks the body of an operator the first reading skipped as shell-read (`skippedAt` offsets); shell-read bodies are judged at the same depth, not depth + 1, so a chain of invented operators cannot reach the depth cap. Four (R8-01) fixtures, one assertion.
- R8-02: bodies and substitutions are judged inside the segment loop, in the directory their owning segment runs in. Private-use markers (BODY, SUBST) ride through `splitRaw`; `stripHeredocs` returns `marks` (text offset of each operator's end). A shell-read body runs with `shellCwd`/`previousCwd` saved and restored. Items no segment claims are judged after the loop. Eleven (R8-02) fixtures. Interpretation: a substitution's own `cd` still leaks as before (not changed).
- R8-03: `pipesIntoShell` is replaced by `pipesIntoShellLater`, a post-pass over the body-free text after each operator: the first unquoted `|`/`|&`, then any later segment that runs a shell after `stripGrouping`. Interpretation: an unrelated later `echo x | bash` over-denies (accepted per the task). Four (R8-03) fixtures, two assertions.
- No existing fixture changed its expect or reason. `docs/cleanroom.md` and the A-02 CHANGELOG line are updated. Full verify green (cleanroom suite 1467 assertions; guard self-tests 664 and 660 cases).
- Manual check: none.
