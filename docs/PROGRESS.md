# Kūkulu 0.8.1 build progress

Branch: build/2026-11-11
Started: 2026-11-11T18:32:19.610Z

## Tasks

- [x] P0-01 sed is a write only in place
- [x] P0-02 Heredoc bodies are data unless a shell reads them
- [x] P0-03 Phase 0 end: push and record the manual check
- [x] P1-01 The plugin sets its own MCP timeout
- [x] P1-02 A command timeout the client would cut short is refused
- [x] P1-03 No clean-room genesis after the archive
- [x] P1-04 kukulu_release reads the merged flight from origin
- [x] P1-05 A flight slug that collides with an archive is refused at plan time
- [x] P1-06 Phase 1 end: push and record the manual checks
- [x] P2-01 finalize defaults to ready
- [x] P2-02 Policies in the global file and in profiles
- [x] P2-03 Grouped similarity pairs
- [x] P2-04 compare-bundles keys its scores by group
- [x] P2-05 An alias is the model it resolves to
- [x] P2-06 Phase 2 end: push and record the manual check
- [x] P3-01 kukulu_next supplies the Agent call's description
- [x] P3-02 The implementer sees its own task's log
- [x] P3-03 An owner-only block halts for the owner
- [x] P3-04 A cargo test filter goes after --
- [x] P3-05 CHANGELOG 0.8.1 and the version
- [x] P3-06 Phase 3 end: push and record the manual checks
- [x] R1-01 Exclude docs/kukulu.json from no-hardcoded-mcp-timeout
- [x] R1-02 Guard: heredoc misdetection, abbreviated sed long options, and untested sed and heredoc mechanics
- [x] R1-03 kukulu_release: test the signing outcome read from origin, localState current and fastForward up to date
- [x] R1-04 Profile policies messages, cargo test detection on any cargo, and README's finalize row
- [x] R2-01 Fix the ASCII display name at docs/PLAN.md:525 that turns lint and CI red
- [x] R2-02 Guard: a << inside ${...} or $[...] is not a heredoc operator
- [x] R2-03 Guard tests: sed's attached long-option value and the (( subshell check
- [x] R2-04 cargo test refusal: compare each cargo test with its own --
- [x] R3-01 Guard: a << in an array-subscript assignment, a compound array assignment or a backtick span is not a heredoc operator
- [x] R4-01 Guard: a << inside a [[ ... ]] conditional or an extglob group is not a heredoc operator
- [x] R5-01 Guard: a !( subshell and an argument [[ do not hide a real heredoc
- [x] R6-01 Green the PR checks: restore docs/kukulu.json escapes and exempt the feedback log from check-names' bare-letter rule
- [ ] R6-02 Guard: a heredoc piped into a shell has its body judged as commands
- [ ] R6-03 Guard: read every heredoc command twice, denying when either reading denies (SPEC A-02 Two readings)

## Log

(one entry per task, appended by implement)

### P0-01 — c5fe324

sedInPlace and internal sedScan added to mcp/cleanroom.mjs; rule 6d runs for sed only in place, targets are file operands only. KNOWN_LIMITS indirect text updated in both copies and the docs row. 12 fixtures (P0-01) added; no existing fixture changed. Tests added in test/cleanroom.mjs. Full npm test passed. Note: constraint no-hardcoded-mcp-timeout reports hits inside docs/kukulu.json itself (its own description and examples); that file may not be edited, so it is unrelated to this task.

### P0-02 — d8622ce

Work is in commit 2360d70 (a feedback commit landed after it, so d8622ce is an empty marker commit). stripHeredocs exported; splitSegments splits stripped text (internal splitRaw is the old splitter); bashVerdict judges shell-read bodies as commands, unquoted non-shell bodies' substitutions only, quoted bodies not at all. A delimiter of digits only is not a heredoc. 8 fixtures (P0-02), none existing changed. Docs and CHANGELOG added. Full npm test passed; only the no-hardcoded-mcp-timeout constraint hits (docs/kukulu.json itself, pre-existing). Lesson: call kukulu_feedback_log only after kukulu_task_done, since it moves HEAD.

### P0-03 — 01bc90e

Push: done (origin build/2026-11-11). Manual check: NOT VERIFIED (human): in a live clean-room session with claude --plugin-dir ., a read-only sed -n 1p of the log and a heredoc that writes prior-art paths into a scratch file are allowed, and the apostrophe case (cat <<EOF > x.txt / it's fine / EOF / rm -rf .kukulu/cleanroom) is denied.

### P1-01 — a172d62

.mcp.json kukulu entry has timeout (24 hours) after args. New operations.md section Long tool calls; MCP_TOOL_TIMEOUT removed from operations.md and mcp-tools.md; longestCommandTimeoutMs row links the section. Tests in test/plugin.mjs; full npm test passed. Only the pre-existing no-hardcoded-mcp-timeout hits inside docs/kukulu.json remain in verify.

### P1-02 — bc56369

mcpTimeoutMs() (cached, reads PLUGIN_ROOT/.mcp.json) and cfgFrom(c, planIds, limit) refusal for commandTimeoutMs and each verify/extraVerify/parallel.setup/mutation.targeted timeoutMs at or above the limit. status gains mcpTimeoutMs; longestCommandTimeoutMs counts mutation.targeted. Docs and CHANGELOG updated. Interpretation: test/plugin.mjs (not in Files touched) had a regex on cfgFrom's signature, widened for the new parameter. Tests: routing (refusals, below-limit, no-timeout plugin), state (status fields). Earlier full npm test run was green except that plugin crash, now fixed and plugin suite passes.

### P1-03 — b9f9c48

In nextDecision the genesis, gate and gate-failure halt moved below the halted, awaiting-signing and archived-done returns (mode-break halt unchanged). Tests in test/cleanroom.mjs, appended to the existing archive flight block plus a halted-no-genesis block. Docs (mcp-tools, architecture) and CHANGELOG updated. Interpretation: no log means no log.jsonl; the cleanroom directory itself remains after archive. Full npm test passed.

### P1-04 — 27f15a0

release() rewritten to the plan order: fetch origin, read origin/<base>:.kukulu/state.json archived, Branch and signing from the archived dir on origin, gh pr view, CHANGELOG refusal with flight and PR, tag/push/release as before, then fastForward and localState last; the checkout, dirty-tree and ancestor refusals are removed. TOOLS description and docs/mcp-tools.md, CONTRIBUTING review row, CHANGELOG updated. releaseRepo in test/review.mjs now puts the archive commit on the merged build branch with local main behind; old pinned-refusal tests replaced. Interpretation: localState is judged before the fast-forward (stale even when fastForward is done). test/harness.mjs unchanged. Full npm test passed.

### P1-05 — 0f797fc

validatePlanTexts adds a flight problem when docs/flights/<slug>/ exists, suggesting <slug>-<version digits> and <slug>-2 (Version digits from the first Version: line of docs/SPEC.md, tolerating a Status after it on the same line). Skill sentence, mcp-tools check row and CHANGELOG added. Tests in test/state.mjs (taken slug refused, nothing written; free slug passes) and the archive-time refusal pinned in test/review.mjs. Full npm test passed.

### P1-06 — 5fbf2cb

Push: done. Manual check: NOT VERIFIED (human): with the working tree as the plugin, a kukulu_verify whose extraVerify sleeps 40 minutes returns its result instead of an idle-timeout error; after a clean-room flight's archive, git checkout main succeeds from the build branch with no stash.

### P2-01 — 98508c7

cfgFrom defaults finalize to ready (only place); DEFAULT_STATE.policies = cfgFrom({}, null).policies (eight keys); configShow returns policies. Docs, README step 4 and CHANGELOG updated. Interpretation: test/review.mjs finalizeRepo merges finalize auto into its policies (null means no block) so the existing auto-merge cases keep their meaning; new default case added. Tests: routing, review, state. All suites passed after the review fix (earlier run showed only review failing).

### P2-02 — 534904e

validatePolicies(policies, where) with named messages and enum "; got"; GLOBAL_KEYS gains policies; profiles may hold only policies (validateRolesBlock allowPolicies). resolvePolicies() layers default<global<profile<project with sources; cfg() and finalizeConfig return layered policies, cfgFrom stays project-only. configShow gains policySources (policies now layered); Run policies sentence names finalize and its source. Docs (operations Policy layers, routing, mcp-tools, README) and CHANGELOG. Interpretation: resolvePolicies does not check the selected profile exists (resolveRouting refuses); finalize-draft test is in routing.mjs with its own repo setup. Full npm test passed.

### P2-03 — 87dc13d

validateSimilarity: group slug, per-group role counts, grouped refusal texts only when a group is named. normalizeSimilarity keeps group only when given. similarity(): per-group controls, rows gain group (after pair), SIMILARITY.md lists one line per group and gains a group column only when grouped; verifyControlBundle now returns a map pair id to record for every positive pair with a control. Interpretation: SIMILARITY.md always lists group lines (default for ungrouped); the statement test was updated accordingly. Docs, CONTRIBUTING row, CHANGELOG. Full npm test passed. P2-04 must make compare-bundles read the grouped rows (the CHANGELOG line already names it).

### P2-04 — a2224f9

compare-bundles: similarity item is { verdict, groups: { g: { negative, positive } } } (rows without group are default); text prints "  <group> <metric>: negative x positive y"; cross score negative is the default group's, else the first. Harness buildComparePair gained aGrouped; recorded expected.txt updated (default group name added to control lines); docs/cleanroom.md updated. Full npm test passed.

### P2-05 — 1578ca5

sameModel exported from mcp/cleanroom.mjs and duplicated (with a normalizeModel copy) in scripts/verify-attestation.mjs; check 12 notes only when a reported model is not sameModel with the declared one, text unchanged. Tests in test/attest.mjs (shared table of 14 pairs in both copies, alias no note, other family note). Docs and CHANGELOG updated. Full npm test and both guard self-tests passed.

### P2-06 — e5bc294

Push: done. Manual check: NOT VERIFIED (human): with policies.finalize "draft" in the owner's global file, kukulu_config_show in a project with no policies block reports finalize "draft" with policySources.finalize "global".

### P3-01 — c6a0426

stage() adds description for plan/implement/review/summarize (the display name with its macron as a Unicode escape, plus round n from round 1); streams entries get the stream form. go-flight skill passes description in step 4, the wave paragraph and the fallback retry. mcp-tools and CHANGELOG updated. Tests: state (every stage, round 1, none on done/halt, streams), plugin (go-flight text). Full npm test passed.

### P3-02 — e7ff8f7

taskNext result gains taskLog (pr.logs[id] ?? null, same shape as dependencyLogs entries); TOOLS description, implement skill step 2, review-build unblock sentence, mcp-tools row and CHANGELOG updated. Tests in test/implement.mjs for unblocked, fresh and reopened tasks. Full npm test passed.

### P3-03 — 623fb25

agents/reviewer.md tools line gains kukulu_run_halt; review-build skill gains the owner-action rule (without naming kukulu_run_resume, which the reviewer cannot call, per the existing plugin test); operations Halts section (now five) and mcp-tools run_halt updated; CHANGELOG. The resume-into-review behavior already worked, so no server change; test/state.mjs pins it. Full npm test passed.

### P3-04 — c0f9a07

validateMutation refuses cargo test (after any -/+ tokens) with {filter} before a standalone -- or with no --; full message per plan. plan-build skill, templates/SPEC.md, operations row and CHANGELOG updated. Tests in routing. Interpretation: a cargo test with no -- is refused; only a token exactly cargo is recognized. Full npm test passed.

### P3-05 — bca723e

Unreleased renamed to 0.8.1 dated 2026-11-11 (Added, Fixed, Changed only); every section 6 requirement already had a line. 0.8.1 in package.json, plugin.json, VERSION and the README badge. Gitignored feedback file got its Addressed in header (not staged). Full npm test passed.

### P3-06 — bcf4b65

Push: done. Manual check: NOT VERIFIED (human): on the next flight, go-flight's first Agent call carries description and does not fail validation; cargo test --workspace -- a b runs both filters on a stable Rust toolchain.

### R1-01 — 79aba45

Appended docs/kukulu.json to no-hardcoded-mcp-timeout's exclude (commit ea1a1c9). kukulu_verify constraints.ok true, rule hits [].
Remaining red: check-names on docs/PLAN.md:525 (ASCII display name in the plan's own R1-01 text); not editable by me, logged as feedback. Causes lint, pre-commit and one plugin assertion to fail.

### R1-02 — 795fa97

stripHeredocs: skips ((..)) with matching close, comments, quote removal across whole delimiter word. sedScan: abbreviated long options via sedLongOption. 10 fixtures (R1-02), 2 new unit tests, sedInPlace table extended; cleanroom suite 1371/1371 and guard self-test ok (584). No existing fixture changed. Did not run kukulu_verify (the full suite already run; remaining lint red is PLAN.md:525 from R1-01). Interpretation: unclosed (( is not arithmetic. Digits-only rule kept but the arithmetic fixture is now caught by the arithmetic path, so that mutant is only killed by non-arithmetic use.

### R1-03 — e13894d

Added 3 review tests (signed tag from origin's archived state.json with GIT_CONFIG_GLOBAL isolated; localState current; fastForward up to date). Mutating the three server lines makes exactly those assertions fail. review suite 497/497. No server, harness or fixture change was needed.

### R1-04 — 135b775

validatePolicies gains a joiner so profile messages read profiles.<name>.policies.<key>; validateMutation loops over every cargo word; README finalize row says auto-merge only under policies.finalize "auto". routing suite 302/302; full npm test all pass except plugin's check-names on docs/PLAN.md:525 (plan text from reviewer, not editable). Interpretation: profile non-object policies message uses the dotted form too.

### R2-01 — e472f15

Replaced the ASCII display name on docs/PLAN.md line 525 with the macron form (one-line diff). check-names exits 0; kukulu_verify ok. Manual check: PR checks should go green after push.

### R2-02 — 07e0992

Added expansionEnd and a branch in stripHeredocs so << inside ${...} / $[...] is not an operator (unclosed is not special). Five fixtures (R2-02), one unit test; no existing fixture changed. docs/cleanroom.md and CHANGELOG line extended. verify ok.

### R2-03 — d776945

Tests only: three guard fixtures (R2-03) and a sedInPlace table row for --expression=s/a/b/ -i f. No guard change, no existing fixture changed. verify ok.

### R2-04 — 0fcd760

validateMutation now computes the first -- and the first {filter} after each cargo test's own position. Interpretation: a filter before the cargo test (none after it) is not judged against it; only a missing -- refuses then. Two routing assertions added. verify ok.

### R3-01 — dc0577b

Added assignmentEnd and backtickEnd copy-through branches in stripHeredocs (subscript assignment, compound array assignment, backtick span; unclosed is not special). 12 new fixtures (10 denied, 2 allowed) ending (R3-01); stripHeredocs unit test; docs/cleanroom.md and CHANGELOG line extended. No existing fixture changed. Guard self-tests ok (604/600), verify green.

### R4-01 — 0398316

Added conditionalEnd and groupEnd copy-through branches in stripHeredocs ([[ ... ]] and ?*+@!( groups); arithmetic branch still wins. 12 fixtures (R4-01) added, one stripHeredocs assertion, docs/cleanroom.md and CHANGELOG A-02 line extended. Guard self-tests and full verify green. Interpretation: none.

### R5-01 — 6a0975f

Work is in commit 80c02ca (HEAD is a no-op marker, because the feedback commit landed after it). Added commandPosition helper in mcp/cleanroom.mjs shared by the [[ branch and the new !( branch. !( in command position is not copied through: heredocs whose operator lies inside the group (unclosed group runs to end of command) are marked shell, so bodies are judged as commands under both extglob readings. 11 (R5-01) fixtures added (5 regression denials, 5 pinned denials, 1 allowed); no existing fixture changed. test/cleanroom.mjs stripHeredocs assertion added. docs/cleanroom.md and CHANGELOG A-02 line extended. Guard self-tests pass on both templates (627/623). Verify: npm test fails only plugin suite check-names at docs/kukulu.json:655 (literal macron u in a shouldMatch example, pre-existing at HEAD, outside this task); logged as feedback. Manual check: none.

### R6-01 — c4a5867

Re-escaped docs/kukulu.json via script (diff vs d9b19ea is only maxRounds lines). check-names: exact-path bare-letter exemption for .kukulu/feedback.jsonl; other checks still run. Two plugin assertions added. Verify ok.
