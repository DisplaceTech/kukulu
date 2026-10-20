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
