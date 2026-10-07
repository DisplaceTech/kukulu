# Foundry 0.5.0 build progress

Branch: build/2026-10-07
Started: 2026-10-07T17:30:53.739Z

## Tasks

- [x] P1-01 Opus routing defaults, and flight artifacts out of the plugin's own checks
- [x] P1-02 One commit helper with a bounded, prompt-free unsigned fallback
- [x] P1-03 Snapshot and restore around every writing tool
- [x] P1-04 foundry_summary_commit writes SUMMARY.md from content
- [x] P1-05 from: constraints and commands that activate at a task
- [x] P1-06 Targeted mutation commands
- [x] P1-07 failedCommands and confirmKill in foundry_mutate
- [x] P1-08 foundry_status reports artifacts, strayArtifacts and lastReviewCommit
- [x] P1-09 Resume a round-cap halt through foundry_flight_options
- [x] P1-10 foundry_plan_commit validates and commits the plan
- [x] P1-11 foundry_plan_commit renumbers split task ids
- [x] P1-12 The flight key, policies.archive and foundry_flight_archive
- [x] P1-13 foundry_pr_finalize signed check, ready, auto-merge and awaiting signing
- [x] P1-14 foundry_pr_finalize resign path
- [x] P1-15 Phase 1 end: push and record the manual check
- [x] P2-01 Summarize skill: content, archive, codebase notes, finalize
- [x] P2-02 Review-build skill: targeted mutants, confirmKill, converging rounds
- [x] P2-03 Plan-build skill: plan_commit, from, stray artifacts, per-flight CLAUDE.md
- [x] P2-04 Implement skill: codebase notes stay out of the feedback log
- [x] P2-05 Go-flight skill: resume, signing unlocked, flight slug
- [x] P2-06 Pull-feedback skill reads archived flight logs
- [x] P2-07 Phase 2 end: push and record the manual check
- [x] P3-01 Tool reference and README for twenty-one tools
- [x] P3-02 Operations: flight after flight, and signing
- [x] P3-03 Writing specs and templates: from, targeted mutation, provenance
- [x] P3-04 Architecture, contributing table, and feedback headers
- [x] P3-05 Version 0.5.0 and the CHANGELOG
- [x] P3-06 Phase 3 end: push for the draft PR and record the manual check
- [x] R1-01 commitStaged rolls back its own signing fallback when the unsigned retry fails
- [x] R1-02 Tests for four mcp/server.mjs mechanics that survive mutation
- [x] R1-03 Agent tool contracts and README routing defaults are asserted
- [ ] R2-01 The fake gh's pr ready works on BSD sed, and a constraint forbids sed -i
- [ ] R2-02 A scoped .gitleaks.toml allowlist clears the fake-signer fixture findings
- [ ] R2-03 Test that a failed unsigned retry unsets a commit.gpgsign that was unset locally

## Log

(one entry per task, appended by implement)

### P1-01 — 0427851
Agents/template/README/docs now opus for planner, reviewer, summarizer. Tests: routing defaults block, plugin per-agent no-fable, FLIGHT_ARTIFACTS skipped in tool-name check. Interpretation: link check ignores inline code spans (PLAN.md quotes an example link in backticks). pre-commit markdownlint excludes MCP-written artifacts and docs/flights/. All verify green.

### P1-02 — bba9c9b
Added commitStaged + SIGNING_TIMEOUT_MS in server.mjs; gitCommitIfChanged takes {stage}. Auto: sets local gpgsign false, state.signing/signingOverride, one "signing" feedback entry, retries unsigned in the same commit. Required: ToolError. startRun sets signingOverride on failed probe only. Tests in test/implement.mjs (S-02 section). Docs updated (mcp-tools intro, operations signing row).

### P1-03 — 319a41e
withRollback(paths, fn) added; wraps startRun, taskDone, taskBlock (progress write only), taskReopen, runFinish (handoff commit and state commit separately), flightOptions, runHalt, summaryCommit, reviewSubmit (both verdict branches). Tests: review_submit rollback + retry, task_done and flight_options rollback via commit-msg hook. Later writing tools must reuse withRollback. Docs: mcp-tools intro and review_submit section.

### P1-04 — bd1573f
summary_commit takes optional content (SUMMARY_MAX_BYTES 1 MiB), validates before writing, writes inside withRollback over SUMMARY/state/feedback. Interpretation: with content, verdict check first; without content, does-not-exist check stays first (existing test order). PROMPTS.summarize updated. Tests in review.mjs; docs/mcp-tools.md updated.

### P1-05 — b22a1c0
Added validateFrom, inactiveUntil(from, pr); CONSTRAINT_KEYS gains from; normalizeCommand returns from (null default) with allowFrom flag (build/parallel.setup refuse). checkConstraints, verify, mutate and run_finish's scan honour it. Interpretation: mutate's killed ignores skipped entries. Skipped command shape is exactly {cmd, skipped}. Tests in constraints.mjs and implement.mjs; docs updated.

### P1-06 — a4f7a0c
validateMutation + cfg().mutation.targeted (timeoutMs defaults to commandTimeoutMs); mutate takes targeted/filter (MUTATION_FILTER constant), validated before the file is touched. Interpretation: filter regex literal from plan (admits backslash, no quotes). Tests in review.mjs; plugin.mjs config-key loop has a mutation branch; docs updated.

### P1-07 — 4005111
mutate returns failedCommands always; confirmKill (boolean, validated) re-runs failed commands on the restored tree, undoes residue against the same before snapshot, returns confirm, and flips to killed:false/inconclusive:true if a re-run fails. Tests in review.mjs; docs/mcp-tools.md updated.

### P1-08 — 700aa76
status() gains artifacts (7 keys), strayArtifacts (untracked while PLAN.md absent) and lastReviewCommit (review: commits in baseBranch..HEAD; base falls back to main if cfg throws). Read-only. Tests in state.mjs; mcp-tools.md updated.

### P1-09 — fa3a9a6
reviewSubmit sets st.haltCap and new halt messages naming foundry_flight_options({... resume: true}); ordinal() helper. flightOptions resume validates everything before writes, commits config+state in one commit "chore: flight options (k=v, resume)" via withRollback, returns resumed:true. Interpretation: runHalt and stream-merge halts delete stale haltCap so they are never resumable; lifting-bound refusal text is my wording. Docs: mcp-tools, operations Halts.

### P1-10 — eda2c5d
New foundry_plan_commit (after foundry_next; 19 tools). Refactors: parseProgressText, cfgFrom(raw, planIds) (cfg() wraps; validateFrom takes planIds), computeWaves(pr, cc, planLines). validatePlanTexts({planText, progressText, configRaw, configError, claudeExists, allowSuffix}) is pure and returns [{check,id?,message}] - P1-11 reuses it. ToolError(message, data) -> structuredContent in handle(). Interpretation: from is checked in the validator with cfgFrom(raw, null) so no duplicate config problem; suffixed ids skipped by sequence check; waves[].streams = names. plugin.mjs cfg-keys regex now matches cfgFrom. Tests: state/protocol/plugin; docs/mcp-tools.md section + count.

### P1-11 — ac6ac5f
plan_commit gains renumber (boolean). renumberMap + single-pass SPLIT_ID rewrite over PLAN/PROGRESS text and "from" values in foundry.json raw text; validatePlanTexts runs on rewritten text; nothing written when problems remain; files written inside withRollback. Heading problem for suffixed ids now suggests renumber: true. Refused when Started: is stamped or any task box is not a space. Tests in state.mjs; docs updated. Phase 1 ends here: push is handled by run_finish (see below).

### P1-12 — 3fe6425
Added flight key (FLIGHT_SLUG), policies.archive (default false, only in cfgFrom), summary_commit.archive field, foundry_flight_archive (after summary_commit; 20 tools), next() archived done. Archive commit adds only existing paths and commits pathspecs known to HEAD/disk; all inside withRollback with empty-dir cleanup on failure. Interpretation: baseBranch not read (unused). ASSUMPTION: policies.archive default false, not tuned. Tests in review/state/protocol/plugin; docs updated. Phase 1 complete; push deferred to run_finish.

### P1-13 — 63ce643
Added policies.finalize (auto) and policies.mergeMethod (merge), signedCheck, nextSteps, finalizeConfig, foundry_pr_finalize (after flight_archive; 21 tools), next() awaiting-signing done, PROMPTS.summarize sentence. Harness: fake gh pr ready/merge, mkFakeGpg, useFakeSigner. Interpretation: gh pr ready failure -> merge "unavailable: gh pr ready failed: <line>"; pr policy none + existing PR -> "skipped: policy". resign is P1-14. Tests in review/state/protocol/plugin; docs updated.

### P1-14 — 57ef188
resign (boolean, validated) added to foundry_pr_finalize: dirty/base-branch refusals, override unset + probeSigning("required") with restore, bounded prompt-free rebase -f --rebase-merges --gpg-sign with abort+restore, re-check, force-with-lease push (resignPush), then the all-signed path with resigned:true. Tests in review.mjs with isolated GIT_CONFIG_GLOBAL fake signer. Interpretation: refusal after step 4 leaves state.json's override flag (config already unset). Manual check: NOT VERIFIED (human): re-sign with a real signing agent.

### P1-15 — 533bd35
Push: pushed build/2026-10-07 to origin at phase end (full verify was green at P1-14). Manual check: NOT VERIFIED (human): run one real flight on a throwaway spec with the working-tree plugin (claude --plugin-dir .) and confirm the summarizer passes content and no Write refusal appears.

### P2-01 — d2ee0fd
Summarize skill rewritten: composes the document, passes content to foundry_summary_commit (no Write/heredoc), adds sections 9-11 (Suggested CLAUDE.md additions, Advisory mutation survivors, Breaking call), archives when archive: true, ends with foundry_pr_finalize({ breaking }) and never resign; final message statuses AWAITING SIGNING / AUTO-MERGE ON / READY / PR UNCHANGED. plugin.mjs: summarize dropped from heredoc loop, new assertions.

### P2-02 — c5f5793
review-build skill gains targeted mutants, confirmKill/failedCommands/inconclusive guidance, round 1 sweep (at least three, one R-task per file), round 2+ scoping via lastReviewCommit with out-of-diff survivors under ## Notes. The sweep size lives only in this skill. plugin.mjs assertions added.

### P2-03 — 6b6f186
plan-build skill: foundry_plan_commit replaces the manual commit (with renumber: true for split ids), from guidance (never test-or-skip guards), strayArtifacts regeneration, flight slug derivation, mutation.targeted, CLAUDE.md flight-section rule (150 lines only on creation; one ## Flight <slug> notes section, 60 lines, stated once), report lists constraints by id. Heredoc fallback paragraph kept. plugin.mjs assertions added.

### P2-04 — 21d1127
implement skill: project lessons are not Foundry friction (log entry + HANDOFF ## Codebase notes, never foundry_feedback_log); HANDOFF list gains ## Codebase notes. Heredoc fallback kept. plugin.mjs assertions added.

### P2-05 — d48a6d5
go-flight skill: three new options (continue allow N rounds -> flight_options resume; signing unlocked -> pr_finalize resign, the only resign in the pipeline; flight=<slug> -> planner prompt sentence), allowed-tools and argument-hint updated; plugin.mjs assertions; mcp-tools intro lists pr_finalize for the human-initiated re-sign.

### P2-06 — ef4733b
pull-feedback skill now reads .foundry/feedback.jsonl plus every docs/flights/*/feedback.jsonl, stops only when all are missing/empty, header names each source log with its item count. Interpretation: duplicates within one pull keep one copy by exact at. plugin.mjs assertions. Phase 2 push deferred to run_finish.

### P2-07 — 006c321
Push: pushed build/2026-10-07 to origin. Agent tools check: agents/planner.md names foundry_plan_commit; agents/summarizer.md names foundry_flight_archive and foundry_pr_finalize (none missing). Manual check: NOT VERIFIED (human): read each changed SKILL.md top to bottom for contradictions with the tool reference.

### P3-01 — 2e5b296
README: count sentence, rows for plan_commit/flight_archive/pr_finalize, updated status/flight_options/mutate/summary_commit rows, quickstart step 4 now describes auto-merge under policies.finalize and that Foundry never merges synchronously. docs/mcp-tools.md audited: complete already (each P1 task updated it), first line says Twenty-one. plugin.mjs: README table coverage and count words.

### P3-02 — 77667b2
operations.md: new ## Running flight after flight and ## Signing sections, config example shows new policies/flight/mutation, what-the-flight-leaves-behind rewritten for S-14 (no synchronous merge; auto-merge only) and the three new commit kinds. All config rows present. plugin.mjs heading assertions.

### P3-03 — a04b419
writing-specs.md gains {filter} guidance, Rules that become true at a task, Provenance logging (commit-msg hook sh fence); templates/SPEC.md section 7 names {filter}; templates/constraints.example.json gains no-todo-in-src with from P2-01 (file reformatted, multi-line arrays). Tests: constraints.mjs template test now builds a plan containing the from task; plugin.mjs assertions.

### P3-04 — ffb76d2
architecture.md: stateDiagram gains done_signing/done_archived, decision list renumbered to 12 with the two new dones, Who-may-write diagram and paragraph cover plan_commit/flight_archive/pr_finalize, State on disk lists new state fields and docs/flights/<slug>/. CONTRIBUTING suite table updated (still eleven). Both 2026-10-07 feedback headers say addressed in docs/SPEC.md (Foundry 0.5.0); nothing else under docs/feedback changed. Diagram check run in a scratch copy: 7/7 parse. plugin.mjs assertion added.

### P3-05 — 6d6c97b
Version 0.5.0 in package.json, plugin.json and server VERSION only. CHANGELOG [0.5.0] with Added/Changed/Fixed/Breaking changes (opus defaults, summarizer no longer writes the file, policies.finalize auto). plugin.mjs assertion that the newest changelog heading equals the package version. No tag, release or merge.

### P3-06 — 7e72b78
Push: pushed build/2026-10-07 to origin; foundry_run_finish opens the draft PR. Not merged, tagged or released. Manual check: NOT VERIFIED (human): CI is green on the PR.

### R1-01 — 7686bdc
commitStaged snapshots state.json, feedback.jsonl and local commit.gpgsign before fallback; restores all (and unstages) if the unsigned retry fails. Test added in implement.mjs (counter hook). No interpretation choices.

### R1-02 — 8640e32
Added tests for mutants (a)-(d) in test/review.mjs and test/state.mjs; each confirmed failing against its mutant, server.mjs restored. Interpretation: (c) drives 12 equal-count rounds with maxRounds 11 (rounds 2-12 non-converging). (d) uses a global fake-signer config so the finalize commit is signed.

### R1-03 — 2f95667
test/plugin.mjs asserts planner/summarizer MCP tools and README agent defaults (model, effort) vs agents/*.md. README lines fixed (opus summarizer; reflowed so patterns match on one line); routing.md "(unchanged)" became "(the default)".
