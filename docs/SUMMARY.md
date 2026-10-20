# Summary: Kūkulu 0.7.0 build (build/2026-10-19)

**Do not merge until the owner has run one clean-room flight from the working tree and deployed the site preview (SPEC §8 Phase 6).**

## Merge line

`build/2026-10-19`, base `cleanroom` (merge base `ef3860c`) → head `6bc4a1d`. 248 commits before this summary. 11 reviews. Final verdict: APPROVED (round 11). 98 of 98 tasks done, none blocked or skipped. Flight `v0-7-0`, fully serial.

## What was built

- **Phase 0, end of the foundry period (P0-01 to P0-07).** The `FOUNDRY_*` fallbacks, the `deprecations` field and `kukulu_migrate` are removed. A project on the pre-0.6.0 layout is refused, with the manual migration in the message. The guard and hooks accept only the `kukulu` names. Skills and docs drop the compatibility text. Archives stay readable without pinned hashes. pre-commit no longer rewrites the approved-copy file.
- **Phase 1, friction and feedback (P1-01 to P1-14).** `kukulu_plan_commit` checks the branch. A new `kukulu_run_resume` exists, and halts name it. The link check reads `git ls-files`. Writes to PROGRESS.md and PLAN.md are MD022-clean. `kukulu_mutate` runs the constraint scan. `kukulu_status` reports `prChecks`, and the review reads CI. Review tasks carry a required `source`, and mutation-only rounds are capped by `review.mutationFixRounds`. There is a flight-slug rule, and an auto-merge-unavailable message that names `policies.finalize`. pull-feedback never commits.
- **Phase 2, private names (P2-01 to P2-03).** pull-feedback and CONTRIBUTING use private-project labels, and check-names reads a local denylist (`docs/feedback/.private-names`) without printing it.
- **Phase 3, clean-room isolation, provenance and gated stages (P3-01 to P3-21).** This adds `mcp/cleanroom.mjs`: a policy loader (`docs/cleanroom.json`), a hash-chained log (`.kukulu/cleanroom/log.jsonl`), Ed25519 checkpoints, genesis and sticky mode, and the guard and logger hooks with a self-test. Self-protection covers an always-protected set. Commits carry clean-room trailers. A six-check gate with liveness runs before each stage. Human entries are written through `kukulu_cleanroom_record`. A clean-room flight runs end to end in the drive suite.
- **Phase 4, contamination scoring (P4-01 to P4-09).** `cleanroom.similarity` config is added. A dependency-free lexer covers Rust, the C family, Go, Python, JS/TS, Java and PHP. Identifier and comment metrics produce a disclosed verdict, checked against calibration fixtures. The new tool is `kukulu_similarity`, and the summarize skill carries the score.
- **Phase 5, attestation and the verifier (P5-01 to P5-09).** `scripts/verify-attestation.mjs` checks the manifest, signature, chain, checkpoints, policy, guard, mode, denials, coverage and similarity using Node alone. It also reads pre-0.6.0 logs and the cleanflate fixture. Coverage gaps are judged with `cleanroom.idleGapHours`. `kukulu_attest` writes `docs/attestation/`. Tamper tests run over a real bundle, and the archive moves the bundle.
- **Phase 6, documentation, site and release (P6-01 to P6-05).** Operations, architecture, writing-specs, mcp-tools and README are updated for 0.7.0. The CHANGELOG has a 0.7.0 entry and the version is bumped. The owner's approved copy is applied to `site/`, the Fig. 1 clean-room diagram is solid, and check-site has a rule 16.
- **Review fixes (R1-01 to R10-01, 30 tasks).** Almost all of these harden the guard's lexical Bash parser. The areas were self-protection, network and `deny.paths` reach, cd/cwd tracking, grouping and reserved words, wrapper option tables (env -S, xargs, sudo, stdbuf, timeout), globs and braces, and cp/mv/ln/install destination resolution with per-tool long-option tables. The rest are test-only mutant kills (chain linkage, gate liveness, `prChecks` bounds, `repoRootOf`) and a macOS-depth fixture fix.

## Decisions that shaped it

From PLAN.md:

- Phases: SPEC §8's seven phases in order, none merged. Fully serial, because nearly every task edits `mcp/server.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md` or `CHANGELOG.md`.
- `baseBranch` is `cleanroom`, the branch the plan was committed on, so the draft PR targets `cleanroom`, not `main` (see Spec issues).
- §9 Q1 to Q10:
  - Q1: the mode switches on when a policy file exists at `cleanroom.policy`. There is no flag.
  - Q2: the policy is `docs/cleanroom.json`, separate from `docs/kukulu.json`.
  - Q3: the log is tracked and committed at every checkpoint.
  - Q4: signing is Ed25519 through `node:crypto`, with the key under `~/.config/kukulu/cleanroom/`.
  - Q5: the bundle is `docs/attestation/`, archived with the flight.
  - Q6: the scorer is a lexical, dependency-free one with its limits always printed.
  - Q7: denial verdicts are `human` entries of kind `verdict`.
  - Q8: site copy is applied only from the owner-committed `copy-changes.json`.
  - Q9: one flight, `v0-7-0`.
  - Q10: `source` is required on review tasks, with no default.
- `no-foundry-names` activates `from: P0-05`. `kukulu_migrate` is allowed only in CHANGELOG.md and README.md (a retired-tools list).
- `kukulu_run_start` records general mode in the state it already commits, so there is no extra commit on the base branch. Genesis happens at a `kukulu_next` that finds a policy, no `state.cleanroom` and no PLAN.md. A sticky-mode violation is a computed halt that `kukulu_run_resume` refuses.
- Genesis generates the signing key when it is absent, because genesis records `keyFingerprint`.
- `appendEntry` and `generateKey` are the only writes in `mcp/cleanroom.mjs`, each on a path it is handed.
- Clean-room mode means `state.cleanroom.genesis` is set. Every dirty-tree check tolerates `.kukulu/cleanroom/log.jsonl`. The archive moves `.kukulu/cleanroom/` so the next flight starts a fresh chain.
- `docs/kukulu.json` is protected once PLAN.md exists. Lockdown is inactive while PROGRESS.md is absent.
- `kukulu_status.cleanroom` is complete in P3-19. `prChecks` is computed only for the `kukulu_status` tool call, and is `null` without `origin`.
- Hooks fail closed before they are complete: the guard denies every call when a policy exists.
- The 50 ms hook fast path is measured as the median beyond `node -e 0`, plus proof that `mcp/cleanroom.mjs` is never loaded.
- Tuning tasks write `docs/spikes/<ID>.md`. No default changes without a measurement.
- Cleanflate's eight false positives are the eight implement-stage denials at `85f2100` other than the heredoc. Recorded commands live only in `test/fixtures/`, which `no-gnu-sed-inplace` excludes.
- `commits.txt` adds `,separator=%x2C` to both trailer placeholders. The verifier reads `coverage.idleGapHours` from the manifest.
- `scripts-node-builtins` is widened to dynamic `import()`, `require(` and bare imports, excluding `check-diagrams.mjs` and `lint.sh`. Six added constraints: `cleanroom-module-pure`, `hooks-lazy-cleanroom`, `verifier-node-only`, `no-hardcoded-target-max`, `no-hardcoded-mutation-fix-rounds` and `site-no-patented`.
- B-03's review-history `sources` is rendered by the summarize skill. B-04's slug folds accented letters to ASCII. P1-13 creates CONTRIBUTING's Flight feedback section and P2-01 adds the label rule.
- Rule 16, the copy and the solid diagram are one task (P6-04). G-02's merge base is taken against `baseBranch`. G-03 covers Fig. 1 only, so section 04's clean-room box stays dashed.
- Changelog lines go under Unreleased, and P6-03 renames that section to 0.7.0. markdownlint's exclusion of the pipeline artifacts stays.

Interpretation choices (HANDOFF.md):

- P0-02: also removed two `deprecations` assertions in `test/review.mjs`. P0-03: the legacy name is `"foun" + "dry"`, and the refusal runs in `checkLayout()` on every `tools/call`. P0-06: the missing-base proof was kept, and an existing-base case added.
- P1-02: the resume feedback entry honours `policies.feedback`, and the stream-merge branch is `<build>--<stream>`. P1-03: no duplicate resume hint. P1-04: "tracked" means `git ls-files`, so a new doc must be staged. P1-05: the parser drops the one blank line after a heading, and fixtures take `{ legacy: true }`.
- P1-07: the confirm re-run only happens after a failed command, and a constraint kill stands. P1-08: a `gh pr view` error yields `unknown: <why>`. P1-09: validation is exercised through `kukulu_review_submit`. P1-11: the skill spells the macron in words.
- P2-02: the "skipped" line goes to stdout, and the denylist skips `test/fixtures/` and `docs/feedback/`.
- P3-01: messages are prefixed `policy `, an absent `lockdown.after` is `null`, and pattern ids are unique per list. P3-04: missing fields canonicalize to `null`, and `appendEntry` refuses caller-supplied `seq`/`prev`/`at`/`hash`.
- P3-05: empty Grep/Glob parts are omitted, and the stage comes from the lock's round. P3-06: only the `CHECKPOINT_KEYS` fields are signed or verified.
- P3-07: server entries use role `session`. The sticky halt is checked before `st.halted`. General mode is recorded only by `kukulu_run_start`, although SPEC D-06 also says `kukulu_next`.
- P3-08: the log is filtered from porcelain by its path suffix, and `kukulu_task_block` snapshots the log around its reset. P3-09: a redirection `&` does not split, `realpath` resolves through the nearest existing ancestor, and `commandWord` returns the base name.
- P3-10: four of the eight cleanflate false positives were left denied, as written. R1-03 later allowed all four.
- P3-11: the self-test runs the policy's own pattern fixtures, and empty or non-object hook input is a denial. P3-12: the hooks write only after genesis or once a log exists.
- P3-13: cleanflate's log was already capped at 4,000 characters, so its true maximum cannot be observed. P3-14: `tokenPath` reads `name=value` (`dd of=`), and the planner writes `docs/kukulu.json` before PLAN.md in clean-room mode.
- P3-15: a missing stage falls back to `controller`, and stream merges carry trailers with task `-`. P3-16: the chain check requires the first entry to be the recorded genesis.
- P3-17: tests use `live()` so a logged call sits between gates. P3-18: `kukulu_cleanroom_record` is not gated, and the re-signing human entry is committed before the rebase.
- P3-19: the clean-room sentence is appended to the policy sentence. P3-20: the drive flight commits its plan after genesis.
- P4-01: defaults are visible only to the scorer, and `languages` defaults to common extensions. P4-02: `async`/`await` are spelled in pieces in `mcp/cleanroom.mjs`.
- P4-03: a Python triple-quoted string at the start of a line is a comment, and regex literals and nested templates are not parsed. P4-04: `tokenize` also returns raw identifiers. P4-05: the planted identifier is `CHECKSUM_SEED`.
- P4-06: the fixtures cannot size a margin for real controls. P4-07: files are counted distinct, a side with an unmapped extension is refused, and `docs/SIMILARITY.md` is archived.
- P5-01: the verifier's chain reasons match `mcp/cleanroom.mjs` byte for byte. P5-02: checks 5 to 9 report "not checked" when the chain fails. The latest verdict per denial wins. `policy.hashes` lists distinct checkpoint hashes in first-seen order.
- P5-03: the legacy forbidden-read heuristic is defined as written in HANDOFF. Exit 2 means misuse and exit 1 means a failed line. `--json` is supported.
- P5-04: `idleGapHours` defaults to 3, only in `cfgFrom`. A gap exactly at the limit is not a gap. The `KNOWN_LIMITS` wording is the implementer's.
- P5-06: the bundle is verified before the `attest` entry is appended. A second call replaces the bundle. The refusal order is fixed. P5-07: each tamper is tried both raw and with the manifest re-signed.
- P5-08: the attestation comes after the contamination score and before the archive. P6-01: the old `commit-msg` hook advice was removed. P6-02: README has an "Upgrading to 0.7.0" section. P6-03: the README badge is bumped too.
- P6-04: `.node-blocked` keeps only its border colour.
- R1-01, superseded by R2-01: the read rules once kept the original cwd. Now the effective cwd reaches every rule. Side effect: `git checkout .` at the repo root is denied.
- R1-02, R2-02: `KNOWN_LIMITS` gained entries 5 to 7. R3-01: TMPDIR is a real deep directory, not a symlink. R3-02: a leading wildcard does not match a dotfile. R3-03: case-arm patterns are recognised only inside a case.
- R4-01: an attached `-S<value>` is also split. R4-02: the bare-operand check runs after rule 6c. R4-03: containment covers every landing path.
- R6-01: inside double quotes, `shellWords` keeps a backslash unless it precedes `$`, a backtick, `"`, `\` or a newline, as bash does. R6-02: `-T` in a short bundle applies to mv/ln/install too. R7-01: other cp long options take a value only with `=`.
- R8-01: install `-S` is judged under both its GNU (suffix) and BSD (flag) readings, and the BSD reading also treats `-B` as valued.

## Assumptions still in play

| Key | Final default | Status |
|---|---|---|
| `review.mutationFixRounds` | 2 | Checked against the archived `v0-5-0` and `kukulu-tech` trails (P1-10). Unchanged, still a judgment call. |
| Hook fast-path budget | 50 ms | Measured (P3-13): guard median 6.0 ms, max 34.2 ms beyond bare `node`. Unchanged. |
| `TARGET_MAX` | 4,000 characters | Measured on 3,314 cleanflate entries (P3-13): 85 at the cap, none above. The source log was already capped, so this is still partly a guess. |
| `cleanroom.similarity.separationMargin` | 0.0 | Calibration smallest gap is 0.508 (P4-06), but the fixtures are built to separate. Still a guess until a real contamination run. |
| `cleanroom.idleGapHours` | 3 | Measured (P5-05): cleanflate's max same-stage gap is 0.502 h. Unchanged. |

`docs/site/checks.json` was not touched.

## Spec issues

Suggested edits to SPEC.md, from PLAN.md and the review rounds:

- §1: the draft PR should target `main`, but `baseBranch` is `cleanroom`. Retarget the PR, or state `cleanroom` as the base.
- G-01/G-02: the approval was committed on `cleanroom`, not `main`, so the gate takes the merge base against `baseBranch`.
- Appendix C differs from the committed copy (changes 4, 8 and 11). The "fromas" slip in change 11 was fixed in `ef3860c`. The branch merged `cleanroom` (`4925507`) and applied the corrected copy (`5db7eea`). No `fromas` remains in `site/`, the mockup or `copy-changes.json`.
- Rule 16 is vacuous for changes 8 and 12, whose `new` text is already on the page.
- `no-foundry-names` `from` A-01 cannot pass. Use `from: P0-05`. A-01's refusal text needs the split name `"foun" + "dry"`.
- The prose check against history needs a retired-tools allowance (CHANGELOG, README).
- `mcp/cleanroom.mjs` "no I/O beyond reading" conflicts with `appendEntry` and `generateKey`.
- Recording general mode at the first `kukulu_next` adds a base-branch commit. Move it to `kukulu_run_start`, as built.
- Genesis records `keyFingerprint`, but D-06 generates the key later. Genesis now generates it.
- D-10 protects `docs/kukulu.json` before the planner writes it. Protect it once PLAN.md exists. D-03 lockdown should be inactive while PROGRESS.md is absent.
- The log is always dirty, so say that dirty-tree checks tolerate it. Specify that the log moves with the archive.
- D-08's gate writes its entry before refusing. This is the one sanctioned exception to principle 3.
- The 50 ms budget should be measured beyond Node's startup.
- F-01's `commits.txt` format needs `,separator=%x2C`.
- §5.1's table should list `cleanroom.idleGapHours`.
- `no-gnu-sed-inplace` must exclude `test/fixtures/`.
- `scripts-node-builtins` should cover dynamic imports and `require`, with exclusions.
- B-03's "`kukulu_summary_commit` review-history line" does not exist. The skill renders it.
- B-04's slug derivation should fold accents first. B-05 and Phase 2 both claim CONTRIBUTING's section.
- G-02's "no later task depends on the approval" contradicts rule 16. G-03 cites change 4 for the legend, but it is change 6, and the page uses borders, not `stroke-dasharray`. Section 04's dashed box: the owner may want it solid too.
- E-03/F-05 commit SUMMARY several times, so the bundle's SUMMARY predates its own Attestation section.
- D-03 should list the eight cleanflate false positives explicitly.
- From review: the guard is lexical, and its option tables cannot be proved complete across GNU and BSD versions. Amend D-03 to say wrapper and write-command option parsing is best-effort, and add that to `KNOWN_LIMITS`.
- From review: read-family words are judged only in path-like arguments, so `cat zlib.txt` is allowed but `cat ./zlib.txt` is denied (rule 6c).
- From review: D-03 treats all of `git` as write-family, so `git add docs/*` is denied.
- From review: F-04's `--roots`/`--words` defaults were superseded by the owner's `e7ef4d4`.
- From review: D-03's write, network and wrapper lists are incomplete. For example, `rsync evil/cleanroom.json docs/` and `tar xf evil.tar -C docs` are allowed.
- From review: the log's uncommitted tail is unsigned. D-08 check 3 does not pin `mcp/cleanroom.mjs`. D-03's known gaps omit shell expansion.

## Manual checks owed

All are NOT VERIFIED (human).

- **Phase 0 (P0-07).** Run the installed 0.6.1 `kukulu_migrate` on a throwaway `.foundry/` project, then run one task with the working-tree plugin.
- **Phase 1 (P1-14).** Halt a throwaway flight with `kukulu_run_halt` and leave the tree dirty. `kukulu_run_resume` must refuse, naming the dirty tree. Clean the tree and confirm the resume commit.
- **Phase 2 (P2-03).** Put one real name in `docs/feedback/.private-names`. `npm run lint` must fail without printing the name. Delete the file, and it must print the skipped line.
- **Phase 3 (P3-21).** Use `templates/cleanroom.example.json` as `docs/cleanroom.json` in a throwaway Rust project and start a new session with the working-tree plugin.
  - Ask it to read `~/.cargo/registry`. The denial must show in the session and in `.kukulu/cleanroom/log.jsonl`.
  - Type one instruction and confirm a `human` entry.
  - Run `/kukulu:go-flight` and confirm `gate: ok (7 checks)` before the plan stage.
  - Re-run the denial step with the round 1 to 10 bypass forms. Each must be denied: `cd ~/.cargo/registry && cat x`, `(curl https://example.com)`, `cd && cat .cargo/registry/x`, `cp evil .kukulu/state.*`, `env -S -i curl https://example.com`, `cp -vt docs x/cleanroom.json`, `cd ~/.cargo && cd r* && cat x`, `xargs -i curl https://example.com`, `cp -rT evil docs`, `cp -r --o evil/. docs`, `xargs --process-slot-var V curl https://example.com`, `cp evil/cleanroom.json docs --sparse always`, `install --strip-program=true --strip evil/cleanroom.json docs`, `mv --target-directory=docs evil/cleanroom.json`, `ln --s evil/cleanroom.json docs`, and on macOS `install -S evil/cleanroom.json docs`.
- **Round 3.** `gh pr checks` must show `test (macos)` green. The round-11 review saw all eleven checks pass.
- **Phase 4 (P4-09).** Run `kukulu_similarity` on the cleanflate-bench subjects at `7f50ce6`, with reference pairs from `d047d66`. Record the identifier Jaccard against 0.021 / 0.019 / 0.095 and the comment Jaccard against 0.0003 / 0.0010 / 0.032. The ordering must agree.
- **Phase 5 (P5-09).** On a machine without this repo, `node verify.mjs . --key <fingerprint>` must print PASS. Change one byte of `log.jsonl`, and it must FAIL and name the line.
- **Phase 6 (P6-05).** Deploy a Cloudflare Pages preview (`docs/site/DEPLOY.md`). Read every clean-room line against what the suite proves. Compare against the changed mockup at 360, 768 and 1440 px in both schemes. Confirm the site, ci and lint checks are green.
- **Before merging.** The owner runs one clean-room flight from the working tree (HANDOFF's first line).
- **Typo.** The HANDOFF asked for `fromas of 0.7.0` to be fixed after the merge. It is already done on this branch (`5db7eea`). Only confirm that check-site rule 16 is green.

## Review history

| Round | Findings | Fix tasks | Recurrence | Verdict |
|---|---|---|---|---|
| 1 | 6 | 7 | none | CHANGES REQUESTED |
| 2 | 7 | 7 | R1-01, R1-02, R1-03, R1-07 recur; non-converging | CHANGES REQUESTED |
| 3 | 3 | 3 | R2-01 to R2-04 recur | CHANGES REQUESTED |
| 4 | 4 | 3 | P3-09, R2-01, R2-02 recur; non-converging | CHANGES REQUESTED |
| 5 | 3 | 3 | none; non-converging | CHANGES REQUESTED |
| 6 | 2 | 2 | R4-01, R4-03 recur | CHANGES REQUESTED |
| 7 | 2 | 2 | R4-01, R5-01, R5-02 recur; non-converging | CHANGES REQUESTED |
| 8 | 1 | 1 | R6-01 recurs | CHANGES REQUESTED |
| 9 | 2 | 1 | none (regression from R8-01); non-converging | CHANGES REQUESTED |
| 10 | 1 | 1 | R8-01, R9-01 recur; non-converging | CHANGES REQUESTED |
| 11 | 0 | 0 | none | APPROVED |

Round 11 approved with a `## Notes` section. Flagged there but not queued as work:

- PROGRESS.md's R10-01 log says 481 guard cases. The real count is 469.
- When only the BSD reading of `install -S evil/cleanroom.json docs` finds a target, the denial reads `install writes it into null`. The decision is right; only the message is wrong.
- FreeBSD-only install options (`-T`, `-M`) are not modelled. macOS cp `-S` is not verified.
- Round 11 passed `maxRoundsHard` (10). It was approved, so no halt followed.

Nearly every round after round 2 found gaps in the guard's lexical Bash parser, each one prompted by the previous round's fix. The round-cap halts at rounds 5 and 7 were resumed by a human.

## Pipeline friction

1. plan, renumber-scope: `kukulu_plan_commit({ renumber: true })` rewrites ids in PLAN.md, PROGRESS.md and kukulu.json's `from` values, but not in CLAUDE.md. A flight-notes section citing task ids had to be pre-edited by hand to the post-renumber ids.
2. implement, tool-refusal: a `task_done` log entry containing the macron letter (via a unicode escape) was committed into PROGRESS.md, and check-names then failed every `kukulu_verify`. No tool can amend a log line, so PROGRESS.md was edited by hand once. `kukulu_task_done` should reject text the project's lint would refuse, or a log-amend tool should exist.
3. implement, stale-base: the base branch gained `ef3860c` (a typo fix in `copy-changes.json`) after the build branch was cut. Merging the base was refused by the permission system, so P6-04 applied the typo. It was later resolved by merge `4925507` and `5db7eea`.
4. review, round-cap (auto): round 5 was non-converging (7 → 7 → 3 → 3 → 3), the 3rd such round, reaching maxRounds=3. A human called `kukulu_flight_options({ maxRounds: 4, resume: true })`.
5. review, round-cap (auto): round 7 exceeded maxRoundsHard=6 (7 → 7 → 3 → 3 → 3 → 2 → 2). A human raised the cap and resumed.

## Suggested CLAUDE.md additions

- The `.kukulu/cleanroom/` files are written by hooks after every tool call, so a dirty log is never a finding. Server dirty-tree checks match the path from the end of the porcelain line, because `git()` trims the first line's leading space.
- Link and orphan checks use `git ls-files`: `git add` a new document before `kukulu_verify` can see it.
- `mcp/cleanroom.mjs` is under `server-synchronous`. Spell `async`/`await` in pieces there, comments included. The old layout's name exists only as `"foun" + "dry"`.
- A test that runs a hook or the gate needs a logged tool call between two gates. Use `live()`, which calls `logCall()` first.
- Never write a literal macron letter, or an escape that decodes to one, into a `kukulu_task_done` log. check-names reads PROGRESS.md.
- `kukulu_feedback_log` commits immediately. Call it after `kukulu_task_done`, not between a task's commit and `kukulu_task_done`.
- A test needing a finished clean-room flight builds one once (`summarizedFlight()` in `test/attest.mjs`) and copies it per case, passing `KUKULU_CLEANROOM_KEY` to keep the key.
- In a clean-room project, `docs/kukulu.json` is protected once PLAN.md exists, so the plan-build skill writes it first.
- A fake `gh` that hangs must `exec sleep`, or the child keeps the pipe open past `spawnSync`'s timeout (round 1).
- `git -C dir` and a leading `(` hide the command word from a first-token parser. Strip the grammar before choosing the command (round 2).
- The guard resolves paths with `path.resolve`, never `realpath`. A fixture that climbs a fixed number of `..` depends on the temp directory's depth (round 3).

## Advisory mutation survivors

None. Both round-10 survivors (the attached value as `null`, and `resolveLong`'s `hits.length === 1` changed to `>= 1`) are killed in round 11.

## Breaking call

Breaking: yes. CHANGELOG 0.7.0 lists breaking changes: `kukulu_migrate` and the foundry layout and env vars are removed, `source` is required on review tasks, `kukulu_plan_commit` has a branch check, and the `deprecations` field is gone.
