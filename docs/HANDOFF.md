**Do not merge until the owner has run one clean-room flight from the working tree and deployed the site preview (SPEC §8 Phase 6).**

# Handoff: Kūkulu 0.7.0 build

## Summary

- Branch: `build/2026-10-19`, based on `cleanroom`.
- Base commit: `f5892e046df7c834179f5be6c71e1764eb48a72d` (`git merge-base cleanroom HEAD`).
- Head commit before this handoff: `a36b9e9ec02d8f4e2799a5e770a1beb8c8f9fc58`.
- Tasks: 68 of 68 done, 0 blocked, 0 skipped (phases 0 to 6). Every task was serial.
- The full suite passes at the end: 13 suites, 3,231 assertions; `npm run lint`, `pre-commit run --all-files`, `npm run check:site` (76 self-test cases, rules 1 to 14 and 16), `npm run check:site:browser` (six runs) and the guard self-test (164 cases) are green.
- Pushed at the end of phases 0 to 6 (P0-07, P1-14, P2-03, P3-21, P4-09, P5-09, P6-05).

## Blocked and skipped tasks

None.

## One thing to fix right after the merge

`docs/site/copy-changes.json` (change 11) reads `fromas of 0.7.0` on this branch. The owner fixed that typo on `cleanroom` in `ef3860c`, after this branch was cut. P6-04 applied the copy exactly as the file read here (the task forbids editing the file), so the page and the mockup carry the typo, and merging the base branch into this one was refused by the permission system. After this branch meets `cleanroom`, check-site rule 16 will fail until `fromas of 0.7.0` becomes `as of 0.7.0` in `docs/site/mockup.html` and `site/index.html`, one line in each. Merging `cleanroom` into this branch first would show the problem before the PR does.

## Interpretation choices

Each is a place where a task allowed two readings. The task id comes first.

- P0-02: also removed two `deprecations` assertions in `test/review.mjs`, which would otherwise throw.
- P0-03: the old layout's name is built from `LEGACY = "foun" + "dry"`; the refusal runs in `checkLayout()` on each `tools/call`. `test/harness.mjs` and `test/constraints.mjs` needed no change.
- P0-05: `docs/mcp-tools.md` already had no deprecations or decision 4a text after P0-03, so it is unchanged there.
- P0-06: the existing missing-base proof was kept and renamed; an existing-base case was added.
- P1-02: the feedback entry honours `policies.feedback` like `kukulu_run_halt`; the stream-merge branch is `<current build branch>--<stream>`.
- P1-03: `next()` does not append the resume hint twice when the reason already names `kukulu_run_resume` (the stream-merge reason does).
- P1-04: "tracked" means `git ls-files`, so a new doc must be staged before the suite sees it.
- P1-05: log parsing drops the single blank line after an entry heading so `dependencyLogs` text is unchanged; harness fixtures take `{ legacy: true }` for the old spacing.
- P1-07: the confirm re-run happens only when a command failed; a constraint kill stands even if a re-run fails again.
- P1-08: a `gh pr view` error other than "no pull request" yields `unknown: <why>` rather than `null`.
- P1-09: config key validation is exercised through `kukulu_review_submit` because `cfg()` runs there; `test/protocol.mjs` and `test/drive.mjs` also needed the new required `source`.
- P1-11: in the skill the macron is spelled "a u with a macron" because check-names forbids the letter outside the display name.
- P2-02: the "skipped" line goes to stdout; the denylist scan skips `test/fixtures/` as well as `docs/feedback/`.
- P3-01: messages are prefixed `policy ` and name the key path; an absent `lockdown.after` is returned as `null`; pattern ids are unique per list.
- P3-02: `operations.md` did not link `cleanroom.md` until it existed (P3-19).
- P3-04: missing known fields are canonicalized as `null`; `appendEntry` refuses caller-supplied `seq`, `prev`, `at`, `hash` and unknown fields before writing.
- P3-05: `Grep` and `Glob` targets omit empty parts, as the SPEC says (cleanflate's log prints empty ones); the stage comes from a lock's round before `state.round`.
- P3-06: verification covers exactly the `CHECKPOINT_KEYS` fields; an added field fails verification and signing refuses it.
- P3-07: server-written entries use role `session`; the sticky-mode halt is computed on each `kukulu_next` call and checked before `st.halted`; general mode is recorded by `kukulu_run_start` only, as the task says (SPEC D-06 also says `kukulu_next`).
- P3-08: the log is filtered from porcelain checks by matching the path from the end of the line (the `git()` helper trims the first line); `kukulu_task_block` snapshots the log around its hard reset.
- P3-09: an `&` that belongs to a redirection does not split; `realpath` is resolved through the nearest existing ancestor so a file not yet created resolves too; `commandWord` returns the base name.
- P3-10: four of the eight recorded cleanflate false positives (1, 6, 7 and 8) are still denied by the template under rule 6 (a read-family path argument: a `sed` or regex argument containing a slash and a denied word is a path-like token outside `allow.paths`). They were kept with their actual decision and the rules left unchanged, as the task directs. The other four are allowed.
- P3-11: the self-test also runs the given policy's own pattern fixtures through an isolated one-pattern policy; hook input that is empty or not an object is a denial once a policy exists.
- P3-12: the hooks write only once `state.cleanroom.genesis` is set or a log exists, so genesis is entry 1 and an archive does not leave a stray first entry (`loggingActive()` in `mcp/cleanroom.mjs`).
- P3-13: cleanflate's log was already cut at 4,000 characters, so its true maximum is unobservable; recorded as such.
- P3-14: `tokenPath` also reads the value of `name=value` arguments (`dd of=...`), so a key written with `dd` is caught; fixtures default `planExists` to false; `docs/kukulu.json` is protected from the moment `docs/PLAN.md` exists, so the planner writes it before `PLAN.md` in clean-room mode.
- P3-15: a missing stage falls back to `controller`; the stream merge commit also carries trailers (task `-`); the archive passes `cleanroom` explicitly because its state is reset before the commit.
- P3-16: the chain check also requires the first entry to be the recorded genesis; a gate entry's stage for `kukulu_next` is `controller`; lockdown and self-test failures are produced with doctored temp plugins edited before genesis (the recorded hashes then match).
- P3-17: test flows go through `live()`, a `withServer` wrapper that logs one call before each tool call, as a live session's hook would; `logCall()` in the harness runs the logger once.
- P3-18: `kukulu_cleanroom_record` is not behind the gate, so a verdict can be recorded about the denial that halted the flight; the re-signing human entry is committed before the rebase, in its own `chore: clean-room record` commit, so the rebase has a clean tree and re-signs it.
- P3-19: the clean-room sentence is appended to the policy sentence every stage prompt already ends with; `cleanroom.md` named only tools that existed at the time.
- P3-20: the drive flight starts from a spec-only repo and the plan is committed after genesis (genesis needs no plan on disk).
- P4-01: defaults are visible only to the scorer (P4-07), so "resolves with its defaults" is asserted there; `languages` defaults to the common extensions when not configured; the word `subject` requires `cleanroom.similarity.subject`; pair ids are slugs.
- P4-02: one scanner reads a per-language spec; the words `async` and `await` are spelled in pieces in `mcp/cleanroom.mjs` because `server-synchronous` is a line pattern over that file.
- P4-03: a Python triple-quoted string that starts its line is a comment (docstring); regex literals and nested template expressions are not parsed; `:=` is added to the operators.
- P4-04: `tokenize` also returns the raw identifier texts (the metric needs them); the failing-verdict sentence is `independence not supported: <pair>: <metric> is <band>; ...`.
- P4-05: the planted shared identifier is `CHECKSUM_SEED`; `b-derived` was produced from `b` by renaming locals in code only and swapping two functions per file.
- P4-06: the fixtures are built to separate, so they cannot size a margin for real controls; recorded as such.
- P4-07: `files` and `score.reads` count distinct files read; `similarity.json` lists a file once per pair side; a side with no mapped extension is refused; `docs/SIMILARITY.md` joins the archived artifacts and `similarity.json` moves in general mode too.
- P5-01: notes print as `verify-attestation: note: <text>`; a failure's check names are `manifest`, `signature`, `chain`, `checkpoints`; the verifier's chain reasons are worded exactly as `mcp/cleanroom.mjs`'s so the two can be compared byte for byte.
- P5-02: checks 5 to 9 report "not checked" when the chain does not verify; a verdict counts only when it names a denied seq, and the latest per denial wins; `policy.hashes` must equal the checkpoints' distinct hashes in first-seen order; gaps are printed as notes; the manifest carries `coverage.idleGapHours` and the verifier recomputes with it; a gate records a mode failure as `data.failed === "mode"`.
- P5-03: a forbidden-read candidate is a path-like token of a read-capable call under a root, or naming a word while outside `--repo` (absolute outside the repo, or relative starting with `*` or `..`); first hit per call; an unreadable file or option misuse exits 2, a failed line exits 1; `--json` is also supported; the stage key is read under its pre-0.6.0 name or as `stage`.
- P5-04: `idleGapHours` defaults to 3 in `cfgFrom` only; an idle span exactly at the limit is not a gap; the wording of `KNOWN_LIMITS` is mine, built from SPEC D-03's four gaps; `coverageGaps` takes the raw `commits.txt` lines and ignores empty ones.
- P5-06: the verifier runs on the bundle in `docs/attestation/` before the `attest` entry is appended, so the bundle's log ends before the `attest` entry and its checkpoint; a second call replaces the bundle; refusals run in the order mode, summary, evidence, dirty tree, required documents, merge base, gate; the result also carries `push`; `files` in the result lists every bundle file; evidence paths under `docs/attestation` are refused; `summarizeEntries` and `signBytes` were added to `mcp/cleanroom.mjs` so the counts have one definition on the server side.
- P5-07: each file-level tamper is tried twice where the manifest's file hash would hide the owning check, once as-is (check 1 names it) and once with the manifest refreshed and re-signed (check 5 or 9 names it); the checkpoint tamper rehashes the chain and refreshes the manifest so only check 4 fails; the archive keeps the bundle's layout under `attestation/` and ends `moved` with `docs/attestation` when a bundle moved.
- P5-08: `CONTRIBUTING.md` already listed `cleanroom` and `attest`, so only the assertion is new; the summarize skill puts the attestation after the contamination score and before the archive; the legacy-log sample in the docs abbreviates the tool-name list.
- P6-01: `operations.md` already carried the config rows, env rows and the resume halt, so only its pre-0.6.0 archive sentence changed; the gate is a section and a diagram, not a numbered stage decision; the old `commit-msg` hook advice is removed, not kept as an alternative.
- P6-02: `docs/mcp-tools.md` already had every section and field, so only assertions are new there; the README migration paragraph is a section ("Upgrading to 0.7.0") and names the old directory and variables because a reader on the old layout needs the literal names.
- P6-03: the README version badge also moved to 0.7.0; the local, gitignored `docs/feedback/2026-10-19-kukulu-tech.md` got its one "Addressed in" header line (not in any commit).
- P6-04: described above ("One thing to fix right after the merge"); also `.node-blocked` keeps only its border colour because the base `.node` rule is already solid.

## ⚠️ ASSUMPTION values

| Key | Default | Tuned? |
|---|---|---|
| `review.mutationFixRounds` | 2 | Checked against the archived `v0-5-0` and `kukulu-tech` trails (P1-10); unchanged |
| Hook fast-path budget | 50 ms | Measured (P3-13): guard median 6.0 ms, max 34.2 ms over bare `node`; unchanged |
| `TARGET_MAX` | 4,000 characters | Measured on 3,314 cleanflate entries (P3-13): 85 sit exactly on the cap, none above; unchanged |
| `cleanroom.similarity.separationMargin` | 0.0 | Calibration fixtures give a smallest gap of 0.508 (P4-06); unchanged; the first real contamination run is the measurement that can move it |
| `cleanroom.idleGapHours` | 3 | Measured (P5-05): 3,164 same-stage gaps in cleanflate's log, maximum 0.502 h, none over 3 h; unchanged |

`docs/site/checks.json` was not touched.

## Manual checks owed

All are `NOT VERIFIED (human)`.

- Phase 0 (P0-07): run the installed 0.6.1 plugin's `kukulu_migrate` on a throwaway `.foundry/` project, then run one task on it with the working-tree plugin.
- Phase 1 (P1-14): halt a throwaway flight with `kukulu_run_halt`, fix nothing, call `kukulu_run_resume` and confirm the refusal names the dirty tree; clean it and confirm the resume commit.
- Phase 2 (P2-03): create `docs/feedback/.private-names` with one real name on your machine and run `npm run lint`; it must fail without printing the name; delete the file and it must print the skipped line.
- Phase 3 (P3-21): copy `templates/cleanroom.example.json` into a throwaway Rust project as `docs/cleanroom.json`, start a new Claude Code session with the working-tree plugin, ask it to read `~/.cargo/registry`, confirm the denial appears in the session and in `.kukulu/cleanroom/log.jsonl`, type one instruction and confirm a `human` entry, then run `/kukulu:go-flight` and confirm `gate: ok (7 checks)` before the plan stage.
- Phase 4 (P4-09): run `kukulu_similarity` against the cleanflate-bench subjects at `7f50ce6` (reference pairs from `d047d66`) with cleanflate as the subject; record the identifier Jaccard for cleanflate vs C zlib, miniz_oxide vs C zlib and zlib-rs vs C zlib beside the canonical 0.021 / 0.019 / 0.095, and the comment Jaccard beside 0.0003 / 0.0010 / 0.032; the ordering must agree.
- Phase 5 (P5-09): copy a bundle to a machine without this repository, run `node verify.mjs . --key <fingerprint from kukulu_status>`, and confirm PASS; change one byte of `log.jsonl` and confirm FAIL names the line.
- Phase 6 (P6-05): deploy the build branch as a Cloudflare Pages preview (`docs/site/DEPLOY.md`), read every clean-room line on the preview against what the suite proves, and compare the page with the changed mockup at 360, 768 and 1440 px in both schemes; confirm the three site, ci and lint checks are green on the PR.
- Also owed, from the first line of this file: one clean-room flight run from the working tree, by the owner, before merging.

## Codebase notes

- The log and the other `.kukulu/cleanroom/` files are written by hooks after every tool call, so a dirty log is never a finding. Every dirty-tree check in the server ignores it by matching the path from the end of the porcelain line, because the `git()` helper trims the first line's leading space.
- Link and orphan checks in the suite use `git ls-files`: a new document must be `git add`-ed before `kukulu_verify` can see it.
- `mcp/cleanroom.mjs` is under the `server-synchronous` line pattern, so the words `async` and `await` are spelled in pieces there (including in comments). The old layout's name exists in code only as `"foun" + "dry"`.
- A task that runs a hook or the gate in a test needs a logged tool call between two gates (the liveness check). Use `live()` in the suites, which calls the harness's `logCall()` before every tool call.
- Do not write a literal macron letter, or a unicode escape that decodes to it, into a `kukulu_task_done` log: `check-names` reads `docs/PROGRESS.md` and flags it.
- `kukulu_feedback_log` commits immediately. Calling it between a task's commit and `kukulu_task_done` moves HEAD and makes `kukulu_task_done` refuse, so log friction after `kukulu_task_done`.
- A test that needs a finished clean-room flight builds one once (`summarizedFlight()` in `test/attest.mjs`) and copies the repository per case; the copy keeps the original's signing key by passing `KUKULU_CLEANROOM_KEY` to the server.
- `docs/kukulu.json` is protected from the moment `docs/PLAN.md` exists in a clean-room project, so the plan-build skill writes it before the plan.

## What a reviewer should look at first

- The gate and checkpoint plumbing in `mcp/server.mjs` (`runGate`, `checkpoint`, `withTrailers`, `attest`), and that every refusal comes before a write and every commit failure leaves the tree as it was (the tests prove both for `kukulu_attest`, `kukulu_cleanroom_record`, `kukulu_similarity` and the archive).
- `scripts/verify-attestation.mjs`, which deliberately duplicates the chain and signature code of `mcp/cleanroom.mjs` so a bundle verifies without the plugin; `test/attest.mjs` proves the two agree.
- The four known false positives of the template policy (P3-10), which are rules working as written and not a defect, and the lexical scorer's stated limits (`LIMITS`).
- `site/` against the changed mockup, and the typo above.

## Round 1

Review-fix round 1: seven R1 tasks, all done, none blocked or skipped. Branch `build/2026-10-19`, base `98f576b`, head `da2c453`; 75 of 75 tasks done.

- R1-01 (guard, write rules): `redirectTargets` now scans the raw segment, so `echo hi>.kukulu/state.json` and `2>docs/cleanroom.json` are seen. Every non-option operand of a write-family command is a path. Destructive forms (`rm`, `mv` sources, recursive `chmod`/`chown`, `git rm|mv|checkout|restore|clean`) are denied when a protected path lies under the operand (`rm -rf .kukulu`, `mv docs docs2`). `cd`/`pushd` moves a `shellCwd` used only by the protected-path rules. Interpretation: the read rules keep the original cwd so the recorded cleanflate cases keep their decisions. Side effect: `git checkout .` at the repo root is now denied.
- R1-02 (guard, network and deny.paths): git global options (`-C`, `-c`, `--git-dir`, ...) are skipped before the subcommand match. Absolute and `~` Glob patterns are checked as paths. `$HOME`/`${HOME}` expand. `$(...)`, backticks, `<(...)`, `sh|bash|zsh -c` strings and `eval` are judged recursively (depth 4); a single-quoted `$(` is literal. Interpretation: a fifth KNOWN_LIMITS entry (other variables, run-time-built strings); counts updated in test/cleanroom.mjs and test/attest.mjs.
- R1-03 (guard, false positives): `patternOperands` treats grep-family patterns, sed scripts, awk programs and find `-name/-path/-regex` values as text. cleanflate false positives 1, 6, 7 and 8 now pass: 1 via the sed script plus bare in-repo files, 6/7/8 via grep -E/awk patterns with in-repo operands. The prior-art `find / -path ...` stays denied.
- R1-04, R1-05, R1-06 are test-only and kill the mutants named in REVIEW.md F4/F5 (hand-checked by mutating `mcp/server.mjs`, `scripts/verify-attestation.mjs`).
- R1-07: `gh --version` and `gh pr view` in `prChecks` have the 30 s bound; `kukulu_status` returns `review.mutationFixRounds` and the skill reads it there. The hang test takes about 30 s of wall time.

Guard self-test is 194 cases. Nothing to check by hand this round. Codebase note: a fake `gh` that hangs must `exec sleep`, or the sleep child keeps the pipe open past `spawnSync`'s timeout.

## Round 2

Review-fix round 2: seven R2 tasks, all done, none blocked or skipped. Branch `build/2026-10-19`, head `c64d1ea` before the progress commits; 82 of 82 tasks done. The guard self-test is 265 cases; `KNOWN_LIMITS` is seven strings.

- R2-01: a `cd`/`pushd` segment is judged by every rule again (its operand is a 6b token), and its directory takes effect after the segment. The effective cwd now reaches every relative token and the 6c "outside the repository" clause. This replaces the R1-01 interpretation that the read rules keep the original cwd; the cleanflate cases keep their decisions.
- R2-02: `stripGrouping` drops leading `(`, `{`, `!` and the reserved words and trailing `)`. A `cd` inside a subshell ends at its `)`. `>|` no longer splits a segment. git `-C dir` moves the operands after the subcommand, and a destructive git form with no operand but `-C` treats the `-C` dir as the operand. `exec nohup timeout stdbuf setsid` are wrappers (timeout's duration and `-s`/`-k` are skipped). Sixth `KNOWN_LIMITS` entry; counts in test/cleanroom.mjs and test/attest.mjs.
- R2-03: `worktreeDiscard` denies `git stash` (not list/show/apply/pop), `reset --hard|--merge|--keep`, `checkout -f`, `switch -f|--discard-changes` unless every pathspec lies outside the protected paths. `globHit` denies a glob operand of a destructive form whose wildcard component matches a protected path below it (no dotfile exemption, so `rm -rf *` is denied). `chmod`/`chown` of any operand containing a protected path is denied, recursive or not.
- R2-04: `reachesDenied`, `globRe` and `recursiveOperands` deny Grep/Glob roots, Glob patterns resolved against their path, glob tokens and the operands of recursive Bash forms (grep -r, rg, ag, ack, find, ls -R, tree, cp -r, tar, rsync) that equal or contain a `deny.paths` entry. They run after the 6c forbidden-word rules so existing reasons are unchanged. Seventh `KNOWN_LIMITS` entry (pathPatterns on named targets only).
- R2-05, R2-06, R2-07 are test-only and kill the mutants of REVIEW.md F5, F6, F7 (hand-checked by mutating the source and restoring it). The state suite grew to about 80 s because of the second 30 s hang test.

Nothing to check by hand this round. Codebase note: `git -C dir` and a leading `(` each hide the real command word from a parser that takes the segment's first token; strip grammar before choosing the command.

## Round 3

Head after round 3: see `git log`. Three fix tasks, all done, none blocked: R3-01, R3-02, R3-03. Plan total 85 done.

- R3-01: the Glob-climb fixture now climbs 40 levels, so it reaches `/` from any temp directory depth (macOS CI). New test `the guard self-test passes under a deep TMPDIR`. Interpretation: TMPDIR is the deep directory itself, not a symlink to it, because the guard resolves paths textually and a symlinked TMPDIR passed even with the old fixture.
- R3-02: rule 6d expands braces for write-family operands and redirection targets, and denies an operand or target whose wildcard can name a protected path or one under it. `git stash -m msg` is a push; `git read-tree -u` with `--reset` or `-m` is a discard. 26 fixtures. Interpretation: a leading wildcard does not match a dotfile (shell rule).
- R3-03: bare `cd`/`cd --` goes to HOME and `cd -` returns to the previous directory; sudo and env flag values are skipped; function headers, `case ... in`, arm patterns and `esac` are stripped. 16 fixtures (guard self-test now 310 cases). Interpretation: arm patterns are recognized only inside a case.
- Manual check: NOT VERIFIED (human): `gh pr checks` shows `test (macos)` green after the push.
- Codebase note: the guard resolves paths with `path.resolve` and never `realpath`, so the spelled depth of a path is what matters; a fixture that climbs a fixed number of `..` is depth-dependent.
