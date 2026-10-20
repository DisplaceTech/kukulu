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
- [x] P3-16 The gate: checks 1 to 6
- [x] P3-17 Gate liveness
- [x] P3-18 Human entries and kukulu_cleanroom_record
- [x] P3-19 Clean-room status, prompts, skills and docs/cleanroom.md
- [x] P3-20 An end-to-end clean-room flight in the drive suite
- [x] P3-21 Phase 3 end: push and record the manual check
- [x] P4-01 cleanroom.similarity configuration
- [x] P4-02 The lexer core, Rust and the C family
- [x] P4-03 Lexers for Go, Python, JavaScript, TypeScript, Java and PHP
- [x] P4-04 Metrics, positioning and the verdict
- [x] P4-05 Calibration fixtures
- [x] P4-06 Tune similarity.separationMargin
- [x] P4-07 kukulu_similarity
- [x] P4-08 The summarize skill carries the contamination score
- [x] P4-09 Phase 4 end: push and record the calibration check
- [x] P5-01 The verifier: manifest, signature, chain and checkpoints
- [x] P5-02 The verifier: policy, guard, mode, denials, coverage and similarity
- [x] P5-03 Pre-0.6.0 logs and the cleanflate fixture
- [x] P5-04 Coverage gaps and cleanroom.idleGapHours
- [x] P5-05 Tune cleanroom.idleGapHours
- [x] P5-06 kukulu_attest
- [x] P5-07 Tamper tests over a real bundle; the archive moves it
- [x] P5-08 Attestation docs and the summarize step
- [x] P5-09 Phase 5 end: push and record the manual check
- [x] P6-01 Operations, architecture and writing-specs for 0.7.0
- [x] P6-02 mcp-tools.md and README for 0.7.0
- [x] P6-03 CHANGELOG 0.7.0, the version and the feedback header
- [x] P6-04 Apply the approved copy, a solid clean-room diagram and check-site rule 16
- [x] P6-05 Phase 6 end: push and record the manual check
- [x] R1-01 Guard: close the self-protection bypasses in Bash write rules
- [x] R1-02 Guard: network rule and deny.paths reach through git options, Glob patterns, $HOME and substitutions
- [x] R1-03 Guard: allow cleanflate's four remaining false positives by classifying pattern operands
- [x] R1-04 Test verifyChain's prev linkage and seq density in mcp/cleanroom.mjs
- [x] R1-05 Test the verifier's prev linkage and add the rehashed edit to the both-copies-agree fixtures
- [x] R1-06 Test the gate's liveness kind, genesis match and the trailer's default task
- [x] R1-07 Bound every gh call in prChecks; report mutationFixRounds where the reviewer can read it
- [x] R2-01 Guard: judge cd segments again and let the effective cwd reach the read rules
- [x] R2-02 Guard: grouping, reserved words, >|, git -C and more wrappers no longer hide the command or the target
- [x] R2-03 Guard: deny git forms that discard the log's uncommitted entries, glob operands of destructive forms, and chmod/chown of a protected ancestor
- [x] R2-04 Guard: a recursive read, a search root or a glob that reaches into deny.paths is denied
- [x] R2-05 Guard cases: allowed fixtures that pin grep's valued options, -e patterns and quoted >
- [x] R2-06 Test that a hung gh --version makes prChecks null within the bound
- [x] R2-07 Test that --legacy-log's default repository is the log's own repository, not an ancestor
- [x] R3-01 Make the Glob-climb guard fixture independent of the temp directory's depth (macOS CI)
- [x] R3-02 Guard: wildcards and braces no longer hide a protected path from writes, redirections and destructive forms; git stash -m and read-tree -u discard the log
- [x] R3-03 Guard: a bare cd moves to HOME, wrapper option values are skipped, and case arms and function bodies are judged
- [x] R4-01 Guard: env -S's value is the command again, and long-form and xargs/stdbuf/time option values no longer hide the command word
- [x] R4-02 Guard: compact function headers and arms without a space are stripped, and a cd operand without a slash is judged by rule 6b
- [x] R4-03 Guard: a cp, mv, ln or install into a directory is judged at the path it writes, so a protected file cannot be replaced without being named
- [x] R5-01 Guard: env -S's split words are parsed as env options, and one getopt-style scanner reads wrapper option bundles and long-option abbreviations
- [x] R5-02 Guard: cp, mv, ln and install read -t through the option scanner, and a source ending in / no longer stands for the destination
- [x] R5-03 Guard: a bare glob operand and a cd into a glob are judged by rule 6b's glob check
- [x] R6-01 Guard: xargs options with an optional argument never take the next token, env -S's \_ separates words, and the missing sudo/env valued options are listed
- [x] R6-02 Guard: cp -T and abbreviated --recursive/--archive are read, so a recursive copy onto a protected directory is judged at the directory
- [x] R7-01 Guard: cp long options are resolved against cp's own option list, and -T is read in a valued bundle
- [x] R7-02 Guard: xargs --process-slot-var and BSD xargs -J/-R/-S are valued
- [x] R8-01 Guard: cp, mv, ln and install each read their own valued options (cp --sparse/--no-preserve, install --strip-program, BSD install -S)
- [x] R9-01 Guard: mv, ln and install resolve long options against their own full lists (install --strip is a flag)
- [ ] R10-01 Guard: pin attached --name=value and ambiguous-prefix long options for mv, ln and install with fixtures

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

### P3-16 — f82dd58
runGate/requireGate in the server: 6 checks (mode, policy, guard incl. hooks.json registrations, self-test through runShell 60 s, lockdown probe via evaluate, chain incl. genesis equality and newest-checkpoint signature); failure appends a gate entry then halts (kukulu_next) or throws (run_start, task_next, review_submit, summary_commit; stage-scoped task_next included). kukulu_next result gains gate: {ok, checked} (null in general mode); go-flight prints it. Harness tempPlugin(). The gate adds a gate entry on every kukulu_next, so the log is dirty after any next call (checkpoint commits it). P3-17 adds the 7th check.

### P3-17 — c49125d
Check 7 liveness added (checks:7). Harness logCall(repo). In test/cleanroom.mjs the post-genesis flows use live(repo, fn), a withServer wrapper that logs a call before each tool call (a few places that compare log bytes use raw withServer plus logCall). Lesson: a gate refusal also counts as an isError, so a commit-failure test must prove the failure is the commit's, not the gate's (the failed-progress-commit test did not at first).

### P3-18 — 247df17
New tool kukulu_cleanroom_record (23 tools; after flight_options; go-flight allowed-tools both spellings, mapping for record:/record intervention:/record verdict:, no agent). Logger now logs UserPromptSubmit as human/operator (target truncated). humanEntry() helper appends the operator entry in flight_options, run_resume and the resign path (committed before the rebase in its own commit). Interpretation: record is not behind the gate; refused before genesis. Review test for resign added to test/review.mjs using resignRepo with a seeded genesis. Docs/README/CHANGELOG updated.

### P3-19 — fa172c9
cleanroomStatus(st) in status(); CLEANROOM_SENTENCE appended to the run-policies sentence in next() when a policy file exists (implement, stream, review, summarize prompts end with it). Implement and review-build skills, docs/cleanroom.md (new, linked from README and operations/mcp-tools), README Clean-room mode section ("patent pending"). Note: a new doc must be git-added before kukulu_verify or the link check cannot see it.

### P3-20 — 825dd49
Clean-room drive flight: genesis, plan added after genesis, run_start, two tasks with simulated Write/Bash calls and one guard-denied Read under deny.paths, run_finish, APPROVED review, summary, final next; hooks invoked through runHook with CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT. 6 checkpoints verify, 8 server commits carry trailers. No harness change needed.

### P3-21 — b4969b2
Push: pushed build/2026-10-19. Also committed 387b6bd (outside a task): plan-build writes docs/kukulu.json before PLAN.md in clean-room mode, because the guard protects it once PLAN.md exists. Manual check: NOT VERIFIED (human): copy templates/cleanroom.example.json into a throwaway Rust project as docs/cleanroom.json, start a new Claude Code session with the working-tree plugin, ask it to read ~/.cargo/registry, confirm the denial appears in the session and in .kukulu/cleanroom/log.jsonl, type one instruction and confirm a human entry, then run /kukulu:go-flight and confirm 'gate: ok (7 checks)' before the plan stage

### P4-01 — 2c96318
validateSimilarity + normalizeSimilarity (defaults: ngram [5,10], minIdentLen 6, commentNgram 5, near 0.25, separationMargin 0.0 under the ASSUMPTION comment; languages default to the common extension map; identExclusions null). No tool exposes the normalized block yet, so default values are asserted in P4-07's tests. docs/operations.md row avoids naming kukulu_similarity (plugin prose test forbids tool names that do not exist yet); P4-07 should name it.

### P4-02 — 3777b0d
tokenize/LANGUAGES in mcp/cleanroom.mjs: one scanner driven by SPECS per language (lineComments, blockComments, nestedBlocks, stringQuotes, charQuotes, rustStrings, lifetimes, preprocessor, wideLiterals, cxxRawStrings, types, keywords). Rust lifetimes lex as ID. Other six languages: in LANGUAGES, no spec yet (tokenize says "not available in this build") until P4-03; add specs to SPECS and extend the scanner flags (python triple quotes and # comments, go raw strings, js template literals, php $ identifiers). IMPORTANT: mcp/cleanroom.mjs must not contain the words async or await (server-synchronous is a line pattern); ASYNC_AWAIT builds them from pieces for the JS/TS/Rust keyword lists. Three original sample files in test/fixtures/similarity/lexers/.

### P4-03 — e8177fd
Six more SPECS (go, python, javascript, typescript, java, php) plus scanner flags: tripleQuotes, docstrings, stringPrefixes, backtickStrings (raw/template), dollarIdent, phpTags; ":=" operator. Samples for each language in test/fixtures/similarity/lexers/. Known approximations: JS regex literals and template-literal substitutions are not parsed; Python soft keywords (match) stay IDs; PHP keywords are case-sensitive here.

### P4-04 — 41a0090
scorePair, position, verdictOf, BANDS, LIMITS added; tokenize now returns identifiers too. Verdict forms: "independence supported on every separable metric", "no metric separates the controls", else "independence not supported: <pair>: <metric> is <band>; ..." (my wording of the spec's "names the failing metrics and bands"). Row keys: ngram_jaccard@n, ngram_containment@n, ident_jaccard, ident_match_rate_left, comment_jaccard.

### P4-05 — e37d3d5
Fixtures a/ b/ b-derived/ c/ under test/fixtures/similarity (original RLE + additive checksum, ~120 lines per Rust side, C pair, NOTES.txt). Measured (default ngram 5,10): ngram_jaccard@5 neg 0.292 pos 0.972 derived-vs-a 0.285; ident_jaccard neg 0.133 pos 0.769 test 0.133; comment_jaccard neg 0.011 pos 0.597 test 0.011; the c-vs-b pair ngram@5 0.006. Test helper side(dir) in the test file reads and counts skipped files (P4-07 does the server-side reading).

### P4-06 — ef658a3
Measurement: separationMargin before 0.0, after 0.0 (unchanged). Fixture gaps s_pos - s_neg: 0.508 to 0.771, smallest 0.508 (ngram_containment@5) = headroom; no metric near zero. Fixtures cannot size a margin for real controls (cleanflate-bench's n-gram metrics did not separate its real controls); the first real run is the measurement that can move it. Evidence in docs/spikes/P4-06.md.

### P4-07 — 4afd826
New tool kukulu_similarity (24 tools; after summary_commit; summarizer tools line). Reads corpora inside the server only; refusals in spec order; writes .kukulu/cleanroom/similarity.json + docs/SIMILARITY.md (deterministic, no timestamp); clean-room: score entry {reads, sha256} + checkpoint kukulu_similarity, committed with the log. P.similarityDoc added to the archived files; cleanroomMovables now moves similarity.json in general mode as well. Interpretation: a side whose files all lack a mapped extension is refused (like empty); `files`/reads = distinct files read, skipped = distinct unmapped/binary files. operations.md now names kukulu_similarity. Docs/README/CHANGELOG updated.

### P4-08 — 70f9af2
summarize skill gains the Contamination score paragraph (similarity once after summary_commit, before archive; verdict + per-metric lines verbatim; second summary_commit; a refusal is Pipeline friction). Plugin assertions added.

### P4-09 — f25abdb
Push: pushed build/2026-10-19. Manual check: NOT VERIFIED (human): run kukulu_similarity against the cleanflate-bench subjects at 7f50ce6 (reference pairs from d047d66) with cleanflate as the subject; record the identifier Jaccard for cleanflate vs C zlib, miniz_oxide vs C zlib and zlib-rs vs C zlib beside the canonical 0.021 / 0.019 / 0.095, and the comment Jaccard beside 0.0003 / 0.0010 / 0.032; the ordering must agree

### P5-01 — 8d43d74
scripts/verify-attestation.mjs: verifyBundle(dir,{key}) -> {ok, reasons:[{check,reason}], notes, checks}, exports verifyChain/verifyCheckpoint (duplicates of the module's, same wording), CLI (<dir> [--key] [--json], exit 0/1, usage errors exit 2). Checks 1-4 named manifest, signature, chain, checkpoints; P5-02 adds policy, guard, mode, denials, coverage, similarity. Harness: buildBundle(dir, {key, checkpointKey, policyText}), signBundleManifest, rewriteManifest. Suite attest registered; suite counts now thirteen (CONTRIBUTING, README). Lesson: in a quoted heredoc write single backslashes and unescaped backticks; double escaping bit three times.

### P5-02 — 4f7ef0a
Verifier checks 5-10 named policy, guard, mode, denials, coverage, similarity; checks 5-9 say 'not checked' when the chain fails. Gaps recomputed in the spec order and printed as notes 'coverage gap: <json>'; manifest.coverage.idleGapHours is read from the manifest. A verdict counts only when it names a denied seq; mode failure = gate data.failed 'mode'. Harness buildBundle options: clock, extra(log), commits, gaps, idleGapHours, similarity, mode; manifest denials counted independently from entries. attest suite 96 assertions.

### P5-03 — 6dc5f82
Fixture test/fixtures/foundry-tool-log.jsonl: cleanflate provenance/tool-log.snapshot.jsonl at 85f210084a367dcc706c732f5776bf0563cdc0cd (tag v0.3.0-cleanroom, sibling checkout ../cleanflate), lines 109-128, first ts 2026-09-29T14:53:58.191Z, last ts 2026-09-29T14:56:41.968Z, unmodified (cmp-verified against git show); SOURCE file beside it. verify-attestation.mjs --legacy-log <file> [--roots] [--words] [--repo] [--json]: parsed/failed counts, calls by tool/stage, denials, read-capable calls (13 in the fixture), forbidden-read candidates (the denied libz-sys find), the legacy integrity line. Legacy stage key spelled in pieces in the verifier. attest suite 118 assertions.

### P5-04 — 4c1edc4
mcp/cleanroom.mjs: coverageGaps(entries, commitLines, {idleGapHours}) and KNOWN_LIMITS (4 strings, D-03). Same kinds/shapes/order as the verifier; identical output proven in attest. cleanroom.idleGapHours: validated positive finite number, default 3 (ASSUMPTION, only in cfgFrom, not yet tuned: P5-05), operations.md row, plugin loop assertion. Harness default idleGapHours is 4 for bundles (independent of the default).

### P5-05 — 5b7837e
docs/spikes/P5-05.md. Measurement: cleanroom.idleGapHours before 3 h (ASSUMPTION); after 3 h, unchanged. cleanflate snapshot at 85f2100 (3,314 entries): 3,164 consecutive same-stage gaps, median 5 s, p99 0.160 h, maximum 0.502 h (30.1 min), 0 over 3 h, 3 over 15 min (cleanflate SUMMARY treats >15 min as idle for active time, a different question). One continuous flight, so the data cannot place a real hand-over; first flight with an overnight pause or a person stepping in is the next measurement.

### P5-06 — 9d41f96
kukulu_attest (TOOLS after kukulu_similarity; 25 tools; summarizer tools line; mcp-tools.md section + first line; README row + count; CHANGELOG). attest({evidence}): refusals in order mode, summary, evidence shape/files, dirty tree, required docs, merge base, gate (all before any write but the gate entry). Writes docs/attestation/ (F-01 files, commits.txt via git log with comma-separated trailers, manifest signed by signBytes, verify.mjs byte copy), runs node verify.mjs <dir> --key <fp> --json inside withRollback, then appends attest entry + checkpoint(kukulu_attest) and commits chore: attestation bundle; push per policy. mcp/cleanroom.mjs gained summarizeEntries and signBytes. Test flight helper summarizedFlight() in test/attest.mjs (copyOf + KUKULU_CLEANROOM_KEY override). attest suite 180 assertions.

### P5-07 — a97b423
test/attest.mjs: tamper matrix over a real kukulu_attest bundle (file, manifest, signature, log line, checkpoint with rehashed chain, policy, public key swap and forger re-sign, commit trailer; each both as-is and with a refreshed manifest where the owning check would otherwise be hidden), untampered pass with/without --key, verify.mjs alone with the repo deleted. flightArchive moves docs/attestation/ to docs/flights/<slug>/attestation/ (layout kept; moved gains docs/attestation); mcp-tools.md and the tool description updated. attest suite 207 assertions.

### P5-08 — 08f6d6d
docs/cleanroom.md: Reading a bundle (files, manifest fields, the five gap kinds) and Verifying offline (command lines with --key/--json, the ten checks, sample PASS/FAIL, the --legacy-log reader and its fixture output). skills/summarize: Attestation paragraph (non-null cleanroom status; after kukulu_similarity, before kukulu_flight_archive; ## Attestation then a further kukulu_summary_commit({content})). plugin suite asserts all of it plus CONTRIBUTING rows. No server change.

### P5-09 — cdeb8be
Empty commit cdeb8be; pushed build/2026-10-19 to origin (f25abdb..cdeb8be). Manual check: NOT VERIFIED (human): copy a bundle to a machine without this repository, run node verify.mjs . --key <fingerprint from kukulu_status>, and confirm PASS; change one byte of log.jsonl and confirm FAIL names the line.

### P6-01 — 0ac72fd
docs/architecture.md: pieces diagram gains cleanroom-guard, cleanroom-log, mcp/cleanroom.mjs and the log; new Clean-room mode section with the gate flowchart (no decision 4a). docs/writing-specs.md: Provenance logging replaced by Clean-room flights (policy, commit on base branch, lockdown task, controls, built-in trailers, record intervention/verdict). docs/operations.md: pre-0.6.0 sentence loses the old name (rows already present). plugin suite 556 assertions.

### P6-02 — 4ffc136
README: Clean-room mode in the feature list, the attestation sentence with a link to Verifying offline, and an 'Upgrading to 0.7.0' section (manual move of the old layout, FOUNDRY_* no longer read, kukulu_migrate was 0.6.x). docs/mcp-tools.md needed no new text (all sections/fields were added with their tools); plugin suite now asserts them: 563 assertions.

### P6-03 — 1862012
CHANGELOG [0.7.0] — 2026-10-19 with Summary, Added, Changed, Fixed (each cites kukulu-tech F-nn or Appendix A item n), Breaking changes (foundry removal, source required, plan_commit branch check, deprecations removed); version 0.7.0 in package.json, plugin.json, VERSION and the README badge. docs/feedback/2026-10-19-kukulu-tech.md (gitignored, local) got the line 'Addressed in: docs/SPEC.md v0.7.0 (flight v0-7-0)'. Plugin suite 563 assertions.

### P6-04 — ad97c6b
Approval gate passed: base f5892e0 from git merge-base cleanroom HEAD; docs/site/copy-changes.json exists there and git log base..HEAD for it is empty. All 13 pairs had exactly one old match in the mockup and in site/index.html; applied in order to both. Fig. 1 (room, blocked box, room-foot, evidence stages) solid in styles.css and the mockup's inline styles; the legend's dashed swatch removed (.swatch-dashed gone); section 04's box stays dashed. check-site rule 16 (copyChangesPath; IMPLEMENTED_RULES 1-14 and 16) with 7 CASES (self-test now 76 cases); the temp copy carries the mockup and the copy-changes file. npm run check:site and check:site:browser pass. CAUTION: change 11 reads 'fromas of 0.7.0' (owner fixed it at ef3860c on the base branch after this branch was cut; merging the base was refused by the permission system). After merge, replace 'fromas of 0.7.0' with 'as of 0.7.0' in docs/site/mockup.html and site/index.html or rule 16 fails.

### P6-05 — d3c7978
Empty commit d3c7978; pushed build/2026-10-19 to origin (cdeb8be..d3c7978). Manual check: NOT VERIFIED (human): deploy the build branch as a Cloudflare Pages preview (docs/site/DEPLOY.md), read every clean-room line on the preview against what the suite proves, and compare the page with the changed mockup at 360, 768 and 1440 px in both schemes; confirm the three site, ci and lint checks are green on the PR.

### R1-01 — f094133
Added 14 guard fixtures (8 denied, 6 allowed). evaluate(): redirectTargets scans raw segment (glued redirects), write-family operands all treated as paths, destructiveOperands ancestor rule, cd/pushd tracked via shellCwd.
Interpretation: shellCwd (after cd) only used by protected-path rules (6d) so existing read-rule cases (cleanflate sed case) keep decisions. git checkout . is now denied (root contains protected paths).
docs/cleanroom.md rule 6 updated. Self-test 178 cases.

### R1-02 — 31dbdae
13 new guard fixtures; self-test 191 cases. bashVerdict(command, depth) now recursive over $()/backtick/<()/sh -c/eval bodies (depth cap 4), $HOME expansion, gitSubcommand skips global options, absolute/~ Glob patterns checked via pathVerdict.
Interpretation: added a fifth KNOWN_LIMITS entry (variables other than HOME, run-time-built strings); updated counts in test/cleanroom.mjs and test/attest.mjs (outside listed files, required). Single-quoted $( stays literal.
docs/cleanroom.md rules 5, 6 and known gaps updated.

### R1-03 — cde4ddf
patternOperands(word, rest) classifies grep-family first operand/-e values, sed script/-e values, awk program, find -name/-path/-regex values as non-path in rule 6c. Self-test 194 cases.
Now allowed by: FP1 (sed -i script + bare files, cwd in repo -> outside clause false), FP6 (grep pattern with slashes; path operand 'crates' in repo), FP7 and FP8 (grep -E/awk patterns; operands in repo). Prior-art find / -path still denied (/ outside repo).
Interpretation: rule 6b still checks all tokens against deny.paths; shellCwd not used in read rules.

### R1-04 — b32c003
Added two fixtures (rehashed edit -> line 4 prev mismatch; seq 1,2,4 gap with consistent hashes). Checked by hand: with the prev check disabled or seq check weakened to `< 0`, the new assertions fail (the first via a TypeError crash before optional chaining was added; assertions now use firstBad?.).

### R1-05 — 71a90c1
Added check-3 test (rehashed edit with refreshed manifest and signature -> "entry 4 (line 4): prev does not match") and two agreement assertions. Hand-checked: with the verifier's prev check disabled all three fail.

### R1-06 — 8374d6c
Three tests added; each hand-mutated in mcp/server.mjs and confirmed to fail (liveness `!== "gate"`, genesis check deleted, trailer fallback removed); server.mjs restored.
Interpretation: kukulu_feedback_log commit has stage from its argument (implement), so the trailer assertion is Stage: implement, Task: P0-01.

### R1-07 — a91fbb6
prChecks: gh --version and gh pr view now timeout CHECKS_TIMEOUT_MS (30 s); view timeout -> "unknown: gh pr view failed: timed out after 30000 ms". kukulu_status gains review: { mutationFixRounds } from cfg(); skill reads it from there. docs/mcp-tools.md status table and prChecks bound updated; tool description updated.
Interpretation: hang test uses the real bound (adds ~30 s to the state suite). Codebase note: a fake gh that hangs must `exec sleep`, otherwise the sleep child keeps the pipe open past spawnSync's timeout.

### R2-01 — 1a86074
8 cd fixtures added to guard-cases.json. cd/pushd segments now judged by all rules; shellCwd update moved to end of the segment loop; forms()/inRepo/6c outside clause use shellCwd. Replaces R1-01 interpretation (read rules keep original cwd).

### R2-02 — 7973e02
23 fixtures (9 network, 9 protected, 5 allowed). stripGrouping drops leading ( { ! and reserved words, trailing ); subshell cd restored at ). splitSegments keeps >|. gitParts handles -C for operands and destructive forms (empty operand + -C => "."). WRAPPERS += exec nohup timeout stdbuf setsid (timeout duration skipped). KNOWN_LIMITS now 6; counts updated in test/cleanroom.mjs and test/attest.mjs; docs/cleanroom.md updated.

### R2-03 — 141737d
24 fixtures (14 denied, 10 allowed). worktreeDiscard() for git stash/reset/checkout/switch; globHit() for destructive glob operands (first wildcard component, no dotfile exemption); chmod/chown always destructive. Reason names the .kukulu/cleanroom path for pathspec-less forms. Stash list/show/apply/pop allowed.

### R2-04 — 31444ac
16 fixtures (11 denied, 5 allowed). reachesDenied()/globRe()/recursiveOperands() added; Grep/Glob roots, Glob patterns (resolved against path/cwd), glob tokens and recursive Bash operands checked against deny.paths. Reach checks run after 6c so forbidden-word reasons of existing cases stay. KNOWN_LIMITS now 7 (counts updated). Interpretation: operands of find/ls -R/tree default to ".".

### R2-05 — da6ea52
3 allowed fixtures added; each of the three mutants applied by hand makes the guard self-test fail (all killed). No change to mcp/cleanroom.mjs.

### R2-06 — 3f6ca12
Added hung-gh --version test (fake gh exec sleep 120); passes at HEAD in the state suite, fails by RPC timeout with the timeout removed from the --version call (mutant applied by hand, server.mjs restored). state suite now takes ~80 s because of the extra 30 s bound.

### R2-07 — c64d1ea
Added a sibling-of-repo row to the --repo default test (candidates [2,3]); with repoRootOf returning path.dirname(dir) the assertion fails (checked by hand, script restored).

### R3-01 — a3374f1
Fixture climb now 40 '../'. Test 'the guard self-test passes under a deep TMPDIR' in test/cleanroom.mjs (fails with old fixture, verified).
Interpretation: used the deep dir itself as TMPDIR rather than a symlink: guard resolves textually (no realpath), so symlinked TMPDIR passed even with the old fixture and proved nothing.
Manual check: NOT VERIFIED (human): macOS CI job green after push.

### R3-02 — 3a7bcdb
New braceExpand and wildcardNames helpers in mcp/cleanroom.mjs; rule 6d uses expanded operands/redirects; stash -m value skipped; read-tree -u added. 26 fixtures (294 cases total). docs/cleanroom.md rule 6 updated. KNOWN_LIMITS unchanged.
Interpretation: leading wildcard does not match dotfiles (shell rule); read-tree -u requires --reset or -m.

### R3-03 — 87b8a02
previousCwd tracking, bare cd -> HOME, sudo/env flag values skipped in commandWord, stripGrouping drops function headers, case/esac and (inside a case) arm patterns. 16 fixtures (310 cases). docs/cleanroom.md rule 6 updated.
Interpretation: arm patterns only recognized inside a case, to keep `(cd x; ls)` working.

### R4-01 — 56d7874
VALUED_OPTIONS table replaces if-chain; env -S/--split-string/-S<v> value re-split into command words. 17 fixtures added. Interpretation: attached -S<value> also split. KNOWN_LIMITS unchanged.

### R4-02 — f41a21c
Header lookahead accepts `{`; arm pattern allows optional leading `(` and no trailing space; bare cd/pushd/read-family operands judged by pathVerdict. Interpretation: bare check placed after 6c to keep existing reasons (cd /usr/include && cat zlib.h expects forbidden word). 10 fixtures.

### R4-03 — a653575
destinationPaths() builds <dir>/<basename> for cp/mv/ln/install (-t, --target-directory, last operand; valued -S -m -o -g skipped); judged by literal and wildcardNames checks; recursive cp denies a landing path containing a protected path. 16 fixtures. Interpretation: containment check applies to every landing path of a recursive cp.

### R5-01 — 28f8cbb
Added exported scanOption(token, {short,long}) in mcp/cleanroom.mjs (getopt bundle, =value, unique-prefix long names); VALUED_SPEC derived from VALUED_OPTIONS (env gets S/--split-string). commandWord no longer breaks after env split: words are spliced and the option loop continues. 17 fixtures added; self-test 370 cases ok; docs/cleanroom.md rule 6 updated. R5-02 can import scanOption.

### R5-02 — b037814
destinationPaths now uses scanOption with COPY_SPEC (t S m o g; --target-directory --suffix --mode --owner --group); recursive letters in a bundle before the valued letter still count. standsForDir only for basename ./../empty. 12 fixtures; self-test 382 ok; docs rule 6 updated.

### R5-03 — 28dc670
Glob check in bashVerdict now also covers bare cd/pushd/read-family operands, and any such operand when shellCwd (kept as literal glob text after cd to a glob) contains a wildcard. 9 fixtures; self-test 391 ok; docs rule 6 updated.

### R6-01 — fc939a0
scanOption gained optShort/optLong (attached-only values); xargs -i -l -e, --replace --max-lines --eof moved there. env -S value has backslash-underscore replaced by a space. Added sudo -R/-T/--chroot/--command-timeout, env -P. 14 fixtures added.
Interpretation: shellWords now keeps a backslash in double quotes unless it precedes $ ` " \ newline (bash semantics); needed for env -S"curl\_x". docs/cleanroom.md rule 6 updated. KNOWN_LIMITS unchanged.

### R6-02 — 558c7fe
destinationPaths reads -T (bundle) and --no-target-directory (unique prefix of CP_LONG); with -T the last operand is the destination and every source stands for it. --recursive/--archive read by unique prefix. 11 fixtures added (7 denied, cp -rt . evil/docs denied, 3 allowed).
Interpretation: -T in a short bundle applies to mv/ln/install too; long-prefix reading is cp only.

### R7-01 — 414e166
cp long options now resolved via cpLong first (valued only --target-directory/--suffix); -T read from letters before the valued letter in a bundle. 9 fixtures added (6 denied, 3 allowed). docs/cleanroom.md rule 6 updated. Self-test 425 cases ok; npm test green.

### R7-02 — 59baf7a
Added --process-slot-var and -J -R -S to xargs valued options; 8 fixtures (incl. -iE optShort bundle). docs/cleanroom.md rule 6 updated. Self-test 433 cases ok; npm test green.

### R8-01 — 6137334
Per-command valued option sets (COPY_SPECS) in mcp/cleanroom.mjs: cp -t -S --target-directory --suffix --sparse --no-preserve (via cpLong); mv/ln -t -S + long two; install -g -m -o -S -t + --strip-program.
Interpretation: install -S judged under GNU (valued) and BSD (flag; -B valued) readings, deny if either writes a protected path.
Tests: 12 R8-01 fixtures in guard-cases.json (8 denied, 4 allowed); guard self-test 445 ok; full npm test 165/165.
docs/cleanroom.md rule 6 updated.

### R9-01 — 7d1d2f2
Added resolveLong and OTHER_LONG (GNU 9.4 lists for mv, ln, install) in mcp/cleanroom.mjs; destinationPathsFor resolves those commands' long options against them, valued only when the resolved name is in COPY_SPECS. cp unchanged. 12 fixtures added (10 denied, 2 allowed); docs/cleanroom.md rule 6 updated. Interpretation: none. Verify green.
