# Foundry 0.5.0 build progress

Branch: build/2026-10-07
Started: 2026-10-07T17:30:53.739Z

## Tasks

- [x] P1-01 Opus routing defaults, and flight artifacts out of the plugin's own checks
- [x] P1-02 One commit helper with a bounded, prompt-free unsigned fallback
- [ ] P1-03 Snapshot and restore around every writing tool
- [ ] P1-04 foundry_summary_commit writes SUMMARY.md from content
- [ ] P1-05 from: constraints and commands that activate at a task
- [ ] P1-06 Targeted mutation commands
- [ ] P1-07 failedCommands and confirmKill in foundry_mutate
- [ ] P1-08 foundry_status reports artifacts, strayArtifacts and lastReviewCommit
- [ ] P1-09 Resume a round-cap halt through foundry_flight_options
- [ ] P1-10 foundry_plan_commit validates and commits the plan
- [ ] P1-11 foundry_plan_commit renumbers split task ids
- [ ] P1-12 The flight key, policies.archive and foundry_flight_archive
- [ ] P1-13 foundry_pr_finalize signed check, ready, auto-merge and awaiting signing
- [ ] P1-14 foundry_pr_finalize resign path
- [ ] P1-15 Phase 1 end: push and record the manual check
- [ ] P2-01 Summarize skill: content, archive, codebase notes, finalize
- [ ] P2-02 Review-build skill: targeted mutants, confirmKill, converging rounds
- [ ] P2-03 Plan-build skill: plan_commit, from, stray artifacts, per-flight CLAUDE.md
- [ ] P2-04 Implement skill: codebase notes stay out of the feedback log
- [ ] P2-05 Go-flight skill: resume, signing unlocked, flight slug
- [ ] P2-06 Pull-feedback skill reads archived flight logs
- [ ] P2-07 Phase 2 end: push and record the manual check
- [ ] P3-01 Tool reference and README for twenty-one tools
- [ ] P3-02 Operations: flight after flight, and signing
- [ ] P3-03 Writing specs and templates: from, targeted mutation, provenance
- [ ] P3-04 Architecture, contributing table, and feedback headers
- [ ] P3-05 Version 0.5.0 and the CHANGELOG
- [ ] P3-06 Phase 3 end: push for the draft PR and record the manual check

## Log

(one entry per task, appended by implement)

### P1-01 — 0427851
Agents/template/README/docs now opus for planner, reviewer, summarizer. Tests: routing defaults block, plugin per-agent no-fable, FLIGHT_ARTIFACTS skipped in tool-name check. Interpretation: link check ignores inline code spans (PLAN.md quotes an example link in backticks). pre-commit markdownlint excludes MCP-written artifacts and docs/flights/. All verify green.

### P1-02 — bba9c9b
Added commitStaged + SIGNING_TIMEOUT_MS in server.mjs; gitCommitIfChanged takes {stage}. Auto: sets local gpgsign false, state.signing/signingOverride, one "signing" feedback entry, retries unsigned in the same commit. Required: ToolError. startRun sets signingOverride on failed probe only. Tests in test/implement.mjs (S-02 section). Docs updated (mcp-tools intro, operations signing row).
