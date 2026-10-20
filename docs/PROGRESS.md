# Kūkulu 0.7.1 build progress

Branch: build/2026-10-20
Started: 2026-10-20T19:18:49.092Z

## Tasks

- [x] P0-01 One list of known limits in the code and the docs
- [x] P0-02 Guard-finding triage in the review and summarize skills
- [ ] P0-03 Bare and ./ read-family operands get the same decision
- [ ] P0-04 git forms that write only the index are not write targets
- [ ] P0-05 rsync and tar extraction into a protected path are denied
- [ ] P0-06 install's BSD-only denial names its directory
- [ ] P0-07 The gate, the genesis and the manifest pin mcp/cleanroom.mjs
- [ ] P0-08 Phase 0 end: push and record the manual check
- [ ] P1-01 renumber rewrites ids in the flight's CLAUDE.md notes
- [ ] P1-02 Refuse task and halt text that would break a PROGRESS.md constraint
- [ ] P1-03 policies.syncBase merges the base branch into the build branch
- [ ] P1-04 The hard cap's documentation says what reviewSubmit does
- [ ] P1-05 The bundle's SUMMARY.md is the summary as attested
- [ ] P1-06 Phase 1 end: push and record the manual check
- [ ] P2-01 README calls the guard a tripwire
- [ ] P2-02 CHANGELOG 0.7.1, the version and the feedback header
- [ ] P2-03 Phase 2 end: push and record the release check

## Log

(one entry per task, appended by implement)

### P0-01 — cd1140b

KNOWN_LIMITS now 8 entries (A-01 order); docs/cleanroom.md Known gaps bullets, tripwire paragraph with links, "When a guard gap is a defect" subsection; CHANGELOG Unreleased Fixed. Tests added in cleanroom.mjs and attest.mjs.
Interpretation: docs/kukulu.json (planner-written) had literal macron letters failing check-names/lint/plugin test; rewrote as JSON \u escapes, parsed values identical.

### P0-02 — 4f5352c

Added Guard findings paragraph to review-build, Known-gap candidates sentence to summarize, two plugin tests, CHANGELOG Fixed line. No interpretation choices.
