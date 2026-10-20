# Kūkulu 0.7.1 build progress

Branch: build/2026-10-20
Started: 2026-10-20T19:18:49.092Z

## Tasks

- [x] P0-01 One list of known limits in the code and the docs
- [x] P0-02 Guard-finding triage in the review and summarize skills
- [x] P0-03 Bare and ./ read-family operands get the same decision
- [x] P0-04 git forms that write only the index are not write targets
- [x] P0-05 rsync and tar extraction into a protected path are denied
- [x] P0-06 install's BSD-only denial names its directory
- [x] P0-07 The gate, the genesis and the manifest pin mcp/cleanroom.mjs
- [x] P0-08 Phase 0 end: push and record the manual check
- [x] P1-01 renumber rewrites ids in the flight's CLAUDE.md notes
- [x] P1-02 Refuse task and halt text that would break a PROGRESS.md constraint
- [x] P1-03 policies.syncBase merges the base branch into the build branch
- [x] P1-04 The hard cap's documentation says what reviewSubmit does
- [x] P1-05 The bundle's SUMMARY.md is the summary as attested
- [x] P1-06 Phase 1 end: push and record the manual check
- [x] P2-01 README calls the guard a tripwire
- [x] P2-02 CHANGELOG 0.7.1, the version and the feedback header
- [x] P2-03 Phase 2 end: push and record the release check
- [x] R1-01 Test the base sync's failed commit, signing fallback and parallel-plan paths
- [x] R1-02 Guard fixtures for tar append/update, --get, rsync -e and the rsync/tar wildcard checks

## Log

(one entry per task, appended by implement)

### P0-01 — cd1140b

KNOWN_LIMITS now 8 entries (A-01 order); docs/cleanroom.md Known gaps bullets, tripwire paragraph with links, "When a guard gap is a defect" subsection; CHANGELOG Unreleased Fixed. Tests added in cleanroom.mjs and attest.mjs.
Interpretation: docs/kukulu.json (planner-written) had literal macron letters failing check-names/lint/plugin test; rewrote as JSON \u escapes, parsed values identical.

### P0-02 — 4f5352c

Added Guard findings paragraph to review-build, Known-gap candidates sentence to summarize, two plugin tests, CHANGELOG Fixed line. No interpretation choices.

### P0-03 — 6324e0e

Word clause in rule 6c now covers every non-dash, non-pattern operand. 6 fixtures added (P0-03), no existing fixture changed. Docs and CHANGELOG updated. Helper for appending fixtures keeps the 1-space JSON indent of guard-cases.json.

### P0-04 — fad3e7e

INDEX_ONLY_GIT set + gitOutputValues in cleanroom.mjs; nine fixtures; docs and CHANGELOG. --output abbreviations --outp/--outpu also stay targets. No existing fixture changed decision.

### P0-05 — 5581206

rsyncParts/tarParts helpers + own rule block before 6d; rsync remote operand denied under deny.network. 14 fixtures, 2 exact-message tests. Interpretation: tar A/--delete count as archive-writing; extraction into a dir under a protected path also denied; rsync/tar not added to WRITE_FAMILY (exported set unchanged).

### P0-06 — 4b3bf80

Probe: BSD-only form was denied with "install writes it into null". Targets now carry their reading's dir. 3 fixtures, 3 message assertions. Docs and CHANGELOG updated.

### P0-07 — 3ef10a3

cleanroomHash added to pluginHashes/genesis/state/gate check 3/manifest/verifier check 6; checkpoint() restricted to the three CHECKPOINT_KEYS hashes. Unpinned fallback (gate data.unpinned) and verifier notes for 0.7.0 records. Interpretation: harness buildBundle got opts.cleanroomHash (test/harness.mjs outside the listed files). Docs and CHANGELOG updated.

### P0-08 — 83eb7c6

Push: pushed build/2026-10-20 to origin. Manual check: NOT VERIFIED (human): in a live clean-room session with the working-tree plugin (claude --plugin-dir .), git add docs/* is allowed and rsync evil/cleanroom.json docs/ is denied; CI is green on the pushed branch

### P1-01 — c71a003

flightNotesRange/swapFlightNotes in server.mjs; CLAUDE.md written inside withRollback only when changed; two new notes. Five test groups in state.mjs. Interpretation: ### subsections remain in the notes; heading match is exact modulo trailing whitespace. Final verify was green except a markdownlint MD038 in docs/mcp-tools.md that I fixed after (docs-only).

### P1-02 — 6104dc8

refuseProgressText + constraintFixtureFailure (shared with checkConstraints) in server.mjs; called in task_done (after state check), task_block (before reset), task_reopen, run_halt (before withRollback). Tests in implement.mjs; docs Refuses lines; CHANGELOG. Interpretation: no-description constraints print "no description".

### P1-03 — ff94a2b

syncBase helper in server.mjs (policies.syncBase, default true, validated, documented in operations.md); commitStaged opts.noPathspec; baseSynced on run_start/task_next results; withRollback restores the clean-room log on failure. Tests spread over implement, streams, cleanroom, plugin. Config key introduced: policies.syncBase. Interpretation: sync also runs for run_start in fix rounds (existing build branch); stream/clean-room assertions placed in streams.mjs/cleanroom.mjs.

### P1-04 — e9dd357

Text-only: schema description, mcp-tools, operations (3 places), architecture (3 places), CHANGELOG; 2 review tests and 1 protocol test pin behavior. No interpretation choices.

### P1-05 — 4b1ca00

One sentence added after the bundle file table in docs/cleanroom.md; CHANGELOG line. Cited skills/summarize/SKILL.md line 30 (Attestation paragraph) as already covering the manifest hash. Ran lint, pre-commit and plugin test (docs-only), not the full verify.

### P1-06 — f953a3f

Push: pushed build/2026-10-20 to origin. Manual check: NOT VERIFIED (human): on a throwaway flight run with the working-tree plugin, commit to the base branch after the build branch is cut, then call kukulu_task_next and see the chore: merge commit

### P2-01 — 4462297

README line 71 only: guard described as a tripwire, not a sandbox, whose bypasses the chain and the gate make visible. plugin test and markdownlint pass.

### P2-02 — d3cc52a

Version 0.7.1 in package.json, plugin.json, VERSION, README badge; CHANGELOG [Unreleased] renamed to [0.7.1] — 2026-10-20 (Changed + Fixed only). docs/feedback/2026-10-20-kukulu.md (gitignored) got the Addressed in header, not staged.

### P2-03 — ce49e6d

Push: pushed build/2026-10-20 to origin. Manual check: NOT VERIFIED (human): the draft PR targets main and its ci, lint and site checks are green

### R1-01 — c4a6c16

Added 2 tests in test/implement.mjs (failed merge commit rollback; signing-auto unsigned retry) and 1 in test/streams.mjs (serial task_next skips base in streams plan, serial run_start syncs). No server change. kukulu_verify green. Mutation runs (kukulu_mutate) not available to the implementer; not run.

### R1-02 — 4fe6928

Added 8 denied fixtures (R1-02) to test/fixtures/guard-cases.json (509 guard cases now); no guard change. Verify green. kukulu_mutate not available to implementer; mutants not run.
