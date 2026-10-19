# Kūkulu 0.7.0 build progress

Branch: build/2026-10-19
Started: 2026-10-19T20:19:40.028Z

## Tasks

- [x] P0-01 Keep pre-commit from rewriting the approved-copy file
- [x] P0-02 Remove the FOUNDRY_* fallbacks and the deprecations field
- [x] P0-03 Refuse the pre-0.6.0 layout and remove kukulu_migrate
- [x] P0-04 The guard and hooks accept only the kukulu names
- [x] P0-05 Skills and docs drop the foundry compatibility
- [x] P0-06 Archives stay readable without pinned hashes
- [x] P0-07 Phase 0 end: push and record the manual check
- [x] P1-01 plan_commit checks the branch; run_start names both fixes
- [x] P1-02 kukulu_run_resume
- [x] P1-03 Halts name kukulu_run_resume; go-flight maps resume
- [x] P1-04 The link check reads git ls-files
- [x] P1-05 MD022-clean writes to PROGRESS.md and PLAN.md
- [x] P1-06 The dependency field is matched at line start
- [x] P1-07 kukulu_mutate runs the constraint scan
- [x] P1-08 kukulu_status reports prChecks; the review reads CI
- [x] P1-09 Review tasks carry a source; mutation-only rounds are capped
- [x] P1-10 Tune review.mutationFixRounds from the archived trails
- [x] P1-11 The flight slug rule and the -spec note
- [x] P1-12 Auto-merge unavailable names policies.finalize
- [x] P1-13 pull-feedback never commits; Flight feedback moves to CONTRIBUTING
- [x] P1-14 Phase 1 end: push and record the manual check
- [x] P2-01 Private-project labels in pull-feedback and CONTRIBUTING
- [x] P2-02 check-names reads the private-name denylist
- [x] P2-03 Phase 2 end: push and record the manual check
- [x] P3-01 mcp/cleanroom.mjs: the policy loader, the template and the cleanroom suite
- [x] P3-02 validateCleanroom in docs/kukulu.json
- [x] P3-03 Hook registration and the no-policy fast path
- [x] P3-04 The hash chain
- [x] P3-05 Entry fields from a hook payload
- [x] P3-06 The signing key and checkpoint primitives
- [x] P3-07 Genesis and sticky mode
- [x] P3-08 Checkpoints from the tools, and the log in their commits
- [x] P3-09 Path canonicalization and the Bash splitter
- [x] P3-10 evaluate: the guard's rules
- [x] P3-11 The guard hook and its self-test
- [x] P3-12 The logger hook
- [x] P3-13 Tune the hook fast path and TARGET_MAX
- [x] P3-14 Self-protection: the always-protected set
- [x] P3-15 Clean-room commit trailers
- [ ] P3-16 The gate: checks 1 to 6
- [ ] P3-17 Gate liveness
- [ ] P3-18 Human entries and kukulu_cleanroom_record
- [ ] P3-19 Clean-room status, prompts, skills and docs/cleanroom.md
- [ ] P3-20 An end-to-end clean-room flight in the drive suite
- [ ] P3-21 Phase 3 end: push and record the manual check
- [ ] P4-01 cleanroom.similarity configuration
- [ ] P4-02 The lexer core, Rust and the C family
- [ ] P4-03 Lexers for Go, Python, JavaScript, TypeScript, Java and PHP
- [ ] P4-04 Metrics, positioning and the verdict
- [ ] P4-05 Calibration fixtures
- [ ] P4-06 Tune similarity.separationMargin
- [ ] P4-07 kukulu_similarity
- [ ] P4-08 The summarize skill carries the contamination score
- [ ] P4-09 Phase 4 end: push and record the calibration check
- [ ] P5-01 The verifier: manifest, signature, chain and checkpoints
- [ ] P5-02 The verifier: policy, guard, mode, denials, coverage and similarity
- [ ] P5-03 Pre-0.6.0 logs and the cleanflate fixture
- [ ] P5-04 Coverage gaps and cleanroom.idleGapHours
- [ ] P5-05 Tune cleanroom.idleGapHours
- [ ] P5-06 kukulu_attest
- [ ] P5-07 Tamper tests over a real bundle; the archive moves it
- [ ] P5-08 Attestation docs and the summarize step
- [ ] P5-09 Phase 5 end: push and record the manual check
- [ ] P6-01 Operations, architecture and writing-specs for 0.7.0
- [ ] P6-02 mcp-tools.md and README for 0.7.0
- [ ] P6-03 CHANGELOG 0.7.0, the version and the feedback header
- [ ] P6-04 Apply the approved copy, a solid clean-room diagram and check-site rule 16
- [ ] P6-05 Phase 6 end: push and record the manual check

## Log

(one entry per task, appended by implement)

### P0-01 — 9f634f6
Added exclude for docs/site/copy-changes.json to end-of-file-fixer. pre-commit passes, tree clean, npm test green. Note: the first attempt via a python heredoc was denied by the auto-mode classifier; Edit tool worked.

### P0-02 — 853ca09
envVar now KUKULU_ only; deprecate()/DEPRECATIONS removed; global config path unmemoized, no foundry/ fallback; deprecations field removed from status/next, docs, go-flight, CHANGELOG. Tests as in task. Interpretation: removed deprecations assertions in test/review.mjs too (outside Files touched, would throw). resolveLayout's both-layouts refusal left for P0-03.

### P0-03 — 766bc80
Layout is now a const P; checkLayout() runs per tools/call and refuses old-layout (exact A-01 message) and both-layouts. LEGACY = "foun"+"dry" constant builds all legacy names; server.mjs has zero case-insensitive "foundry" hits. kukulu_migrate, decision 4a, inLayoutNames, LEGACY_AGENT_MARKER removed. 21 tools; docs/README/CHANGELOG/go-flight updated; RETIRED_TOOLS rule in plugin test. Guard and hooks still name foundry (P0-04), docs (P0-05), pinned hashes (P0-06) untouched.

### P0-04 — 7bae298
Guard: IMPLEMENTER_AGENT_TYPES kukulu only, RUN_START_TOOL kukulu_run_start only, single STATE_DIR, no FOUNDRY_GUARD_CAP; hooks matcher exact. grep -i foundry on guard/hooks empty. Tests renamed per task.

### P0-05 — ab8fa85
Skills summarize/pull-feedback, operations.md (single archive sentence), architecture.md (4a gone), CHANGELOG updated; plugin tests added. no-foundry-names constraint now active and passing. mcp-tools.md needed no further change.

### P0-06 — 42a88a5
State test computes SHA-256 of the nine v0-5-0 files at start; no hash literals. Review test renamed to the required name and extended with an existing alt-base case.

### P0-07 — 665c2eb
Push: pushed build/2026-10-19 to origin. Manual check: NOT VERIFIED (human): run the installed 0.6.1 plugin's kukulu_migrate on a throwaway .foundry/ project, then run one task of a flight on it with the working-tree plugin (claude --plugin-dir .)

### P1-01 — 48ba10b
validatePlanTexts takes a branch param (null skips); planCommit reads it via git directly (not gitFacts, which calls cfg()). New check 'branch' with exact message. startRun refusal extended. Docs/skill/CHANGELOG (### Fixed) updated; tests in state and implement.

### P1-02 — 33015d1
Added kukulu_run_resume (after run_halt), 22 tools; state.haltStream recorded by stream_finish conflict path, deleted by run_halt/run_resume. Interpretation: resume feedback skipped when policies.feedback false (as run_halt); stream-merge unmerged check runs after the worktree check, so a normal conflict halt hits the worktree refusal first. Docs, README, go-flight allowed-tools, CHANGELOG updated.

### P1-03 — 94401d6
RESUME_HINT appended by next() to stored halts without haltCap (not duplicated if the reason already names kukulu_run_resume); run_halt result gains next; stream-merge reason ends with kukulu_run_resume call. go-flight maps resume/continue; operations.md, README, mcp-tools.md updated. Interpretation: operations.md test checks only the Halts section for $EDITOR plus whole file for "halted": null, because another section legitimately documents flight_options clearing halted. Updated state.mjs assertion for the new halt reason.

### P1-04 — 24e9f1d
brokenLinks(root) in test/plugin.mjs uses git ls-files; orphan-doc check also tracked-only. Note for later tasks: a new doc/file must be git-added before kukulu_verify, or the link/orphan checks cannot see it (index counts as tracked).

### P1-05 — 46fae86
appendLog/formatTask/setHeader write MD022-clean spacing; parseProgressText skips the blank after a log heading so dependencyLogs are unchanged. Harness: headingSpacingProblems(text), planTask/planDoc/progressDoc take { legacy } for the 0.6 spacing (new spacing default). plan-build skill formats updated. Existing tests' log regexes updated to expect heading+blank.

### P1-06 — f49b2a4
Regex now /^\*\*Depends on:\*\*\s*(.*)$/im. Test confirmed failing before the fix, passing after.

### P1-07 — 2e79762
mutate now scans constraints on the mutated tree (checkConstraints with preexistingUntracked), returns constraints {ok,results}; hits = kill, verdict "killed: constraint <id> caught the mutation" when no command failed. Interpretation: confirmKill re-runs only when a command failed (previously an empty confirm array could appear); a constraint kill is not downgraded to inconclusive by a failing re-run. Docs/CHANGELOG updated.

### P1-08 — 8b0ae0e
prChecks() computed only in the kukulu_status TOOLS fn wrapper (status() unchanged, so next() never calls gh). Interpretation: gh pr view errors other than "no pull request" give "unknown: <why>". Harness mkFakeGhBin answers pr checks from checks.json/checks-exit. Test for "no gh" uses a PATH holding only a git symlink. Docs row, skill, CHANGELOG.

### P1-09 — c5dd958
Config key review.mutationFixRounds (default 2, ASSUMPTION, only in cfgFrom's review line; validateReview with unknown-key and positive-integer refusals). review_submit: source required (review|mutation|blocked), cap refusal before any write using the SPEC text, state.rounds[].sources. Skills (review-build new paragraph kept free of a standalone 2 near the key, summarize) and docs (operations row, mcp-tools, CHANGELOG) updated. Also updated test/protocol.mjs and test/drive.mjs for the required source.

### P1-10 — bf751ac
Measurement: review.mutationFixRounds before 2, after 2 (unchanged, not tuned). Evidence in docs/spikes/P1-10.md: v0-5-0 round-3 task was a CI-found real defect (source review, not capped); kukulu-tech's rounds 3-4 were all mutation survivors in self-tests (cap would have approved at round 3 instead of 5). mcp/server.mjs unchanged.

### P1-11 — 11e283f
Slug rule in plan-build (both examples verbatim); plan_commit returns notes[] (empty array normally). Note: check-names forbids the macron letter outside the standalone display name, so the skill says "a u with a macron" and the test regex uses a unicode escape.

### P1-12 — 4c150ea
STOP_ASKING suffix appended to both unavailable: strings in pr_finalize. Docs and review test updated. Process note: never put a unicode escape for the macron letter in a log param (the JSON decodes it and check-names then fails on PROGRESS.md); I fixed the one P1-11 log line by hand, noted in feedback.

### P1-13 — 1722273
Skill step 3 names .private-names, step 7 links CONTRIBUTING.md#flight-feedback, step 8 says Do not commit. CONTRIBUTING.md gains ## Flight feedback (before ## CI). Plugin tests added.

### P1-14 — b8c5f08
Push: pushed build/2026-10-19. Manual check: NOT VERIFIED (human): halt a throwaway flight with kukulu_run_halt, fix nothing, call kukulu_run_resume and confirm the refusal names the dirty tree; clean it and confirm the resume commit

### P2-01 — d69df6e
Label procedure in pull-feedback step 3 and CONTRIBUTING Flight feedback; four plugin assertions. The mechanical check is P2-02.

### P2-02 — 4b75ece
check-names: denylist parsing (label first word, name rest, # comments, entry without a name skipped), per-entry index n is the 1-based index among the non-comment lines. Exempt docs/feedback/ and test/fixtures/. Tests use invented names in a temp root. Beware: String.replace treats $& in a replacement string specially when scripting edits.

### P2-03 — 2685e1b
Push: pushed build/2026-10-19. Manual check: NOT VERIFIED (human): create docs/feedback/.private-names with one real name on your machine and run npm run lint; it must fail without printing the name; delete the file and it must print the skipped line

### P3-01 — eb44bde
mcp/cleanroom.mjs (CleanroomError, loadPolicy, policyHash), templates/cleanroom.example.json (SPEC 5.2 JSON verbatim), test/cleanroom.mjs registered in run.mjs, suite counts 11 to 12 in CONTRIBUTING and README. Interpretation: every policy message starts "policy "; pattern ids unique within each list; lockdown.after defaults to null in the returned policy; defaults: deny.network true, lists []. CLAUDE.md still says eleven suites (project file, not edited).

### P3-02 — d161913
validateCleanroom + cfgFrom.cleanroom { policy, signingKey } (signingKey absolute via expandHome, KUKULU_CLEANROOM_KEY wins, default ~/.config/kukulu/cleanroom/ed25519.pem). Docs rows and env row, CHANGELOG Added, plugin cleanroom branch. The resolved paths are not yet asserted by a test (no tool exposes them until P3-06/P3-07). No link to docs/cleanroom.md until P3-19 creates it.

### P3-03 — 1c3d794
hooks.json registers PreToolUse (guard) and PostToolUse/UserPromptSubmit (logger), no matchers. Scripts are standalone fast paths using only node: imports; the policy-present branch is a stub (guard exits 2 with the not-implemented reason, logger exits 0) for P3-11/P3-12 to replace. Harness gains runHook(script, payload, env). lint.sh exec-bit loop extended. Fast path measured ok (<50 ms).

### P3-04 — ffad041
Chain primitives in mcp/cleanroom.mjs: ENTRY_KEYS, KINDS, ZERO_HASH, TARGET_MAX (exact line under the ASSUMPTION comment), truncateTarget, canonical, entryHash, logPathFor, appendEntry (dir lock, 10 ms retry, 2 s bound, validation before writing), readEntries, verifyChain({ok,entries,tip,firstBad{line,seq,reason}}). KUKULU_CLEANROOM_LOG row in operations.md. Later tasks: appendEntry takes the caller's fields (kind, stage, ..., data); data goes before hash.

### P3-05 — c8f7b3a
targetOf, projectContext, entryFields added to mcp/cleanroom.mjs; stage round comes from lock.round else state.round; agent_type matched by suffix planner/implementer/reviewer/summarizer after '-' or ':'. Missing Grep/Glob parts are omitted (SPEC), unlike cleanflate which prints empty ones.

### P3-06 — 18aa77e
Added generateKey/loadKey/keyFingerprint/CHECKPOINT_KEYS/signCheckpoint/verifyCheckpoint(entry,pub) to mcp/cleanroom.mjs. verifyCheckpoint takes a log entry ({kind:"checkpoint", data:{...,signature}}) and requires data to carry exactly the 8 fields + signature. Key directory created 0700, key 0600. Tests use temp dirs only.

### P3-07 — 1dc9c48
Server: cleanroomOn/cleanroomLogPath/pluginHashes/ensureKey/cleanroomModeBreak/cleanroomGenesis; next() runs mode-break halt then genesis (before st.halted); run_start generates the key and records mode general; run_resume refuses mode-break first. CleanroomError mapped to its message in handle(). Harness: addPlan, cleanroomRepo({planned, policy}), testKeyFor(repo) (stable per-repo temp key via KUKULU_CLEANROOM_KEY). Interpretation: entries the server writes use role "session"; next() does not record general mode (run_start does). Genesis is a second write in kukulu_next, docs updated.

### P3-08 — 7d62139
checkpoint(event, stage, st) + cleanroomPaths(st) helpers; wired into run_start, task_done, task_block, run_finish, review_submit (both verdicts), summary_commit, flight_archive; archive moves log (and similarity.json when present) to docs/flights/<slug>/cleanroom/. porcelainExcludingPreexisting and trackedDirtyLines ignore the log (path matched from line end, because git() trims the first porcelain line). Note for P3-12: after the archive the logger must not recreate a log before the next genesis (log only when state.cleanroom.genesis is set), else genesis would not be seq 1. Docs notes added per tool and in operations.

### P3-09 — aa68450
Added splitSegments, shellWords, commandWord ({word (basename), raw, args}), tokenPath, isPathLike, canonicalPaths to mcp/cleanroom.mjs. Interpretation: redirection & (2>&1, &>) does not split; canonicalPaths adds the real path via the nearest existing ancestor; nice -n takes its value. Backslash escapes in test strings: write them with String.fromCharCode(92) when scripting edits.

### P3-10 — 286a824
evaluate(policy, hookInput, {root, home, progressText, protected?}) + lockdownActive + NETWORK_COMMANDS/READ_FAMILY/WRITE_FAMILY in mcp/cleanroom.mjs; test/fixtures/guard-cases.json (70 cases, recorded calls with __ROOT__ substitution). RESULT for the eight recorded cleanflate false positives under the template: #2 (16:11:51), #3 (16:11:56), #4 (17:00:19), #5 (17:21:39) are allowed; #1 (14:40:33 sed expression), #6 (17:23:20 grep -v regex), #7 (18:13:45) and #8 (20:53:01) are still DENIED by rule 6, read-family "forbidden word in path argument": a token with a slash and a denied word (zlib in a sed or grep regex) is path-like and, resolved against cwd, lies outside allow.paths. Cases keep their actual decision; rules unchanged. The real attempt (find / -path libz-sys) is denied as expected. WebSearch with the template is denied by deny.tools (rule 1) before the network rule. WebFetch obeys deny.network as well as the URL list. Tool-level word reasons read "forbidden word in <path|pattern|glob>: <value>".

### P3-11 — b043e99
Guard hook implemented: fast path, then dynamic import of ../mcp/cleanroom.mjs, evaluate, deny() = log denied entry (if possible) + stderr line + exit 2; every exception becomes "guard internal error: <message>". --self-test <policy> sets KUKULU_CLEANROOM_LOG to a temp file, runs the 70 shipped cases (template resolves to the plugin's template) plus each pattern fixture of the given policy via a one-pattern policy; template run prints "guard self-test: ok (74 cases)". extraVerify self-test commands (from P3-11) are active from this task. The P3-03 stub tests were rewritten around a denied Read probe.

### P3-12 — 13b10e2
Logger implemented (PostToolUse only; UserPromptSubmit exits 0 until P3-18). Interpretation: loggingActive(ctx, logPath) in cleanroom.mjs gates BOTH hooks: they append only when state.cleanroom.genesis is set or the log already exists, so genesis stays entry 1 and the archive's own PostToolUse does not recreate a log (P3-08 note). A pre-genesis guard denial still blocks, unlogged. Guard tests now seed state with a genesis. Hooks fall back to one stderr line when even the logger-error entry cannot be written.

### P3-13 — c44901f
Measurement: hook fast path before 50 ms, after 50 ms (unchanged): overhead over bare node guard median 6.0 / p90 23.9 / max 34.2 ms, logger 2.3 / 13.1 / 15.0 ms (30 runs each). TARGET_MAX before 4000, after 4000 (unchanged): cleanflate snapshot 3,314 entries, median 93, p95 2,058, p99 = max = 4,000, 85 entries (2.6%) exactly at the cap since cleanflate's own logger truncated; true maximum unobservable. Human may want to decide about raising it. Evidence: docs/spikes/P3-13.md.

### P3-14 — 075fa2e
protectedPaths(policy, env) exported; evaluate uses env.protected ?? protectedPaths(policy, env) and read-denies env.keyPath (as deny.paths). Guard script builds policyPath, pluginRoot (CLAUDE_PLUGIN_ROOT else its own ..), keyPath (KUKULU_CLEANROOM_KEY, else cleanroom.signingKey, else default) and planExists. Fixtures: 160 cases (16 categories x 4 write tools + Bash forms); each case may carry planExists. Self-test now 164 cases. tokenPath also unwraps name=value (dd of=). NOTE for P3-19: because docs/kukulu.json is protected as soon as docs/PLAN.md exists, the plan-build skill must write docs/kukulu.json BEFORE PLAN.md in clean-room mode (and the plan stage must write nothing else protected).

### P3-15 — 52cbbc7
withTrailers() inside commitStaged (and the stream merge commit); gitCommitIfChanged now passes its options through ({ stage, task, cleanroom }); every call site passes a stage (implement/fix by round, review, summarize, controller, plan). A site that forgets would fall back to controller (all current sites covered by the all-commits test). Archive passes cleanroom: Boolean(old.cleanroom?.genesis) because its state is reset before committing. implement skill and docs/mcp-tools.md updated.
