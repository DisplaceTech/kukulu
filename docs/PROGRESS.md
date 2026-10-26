# Kūkulu 0.7.2 build progress

Branch: build/2026-10-26
Started: 2026-10-26T14:17:50.269Z

## Tasks

- [x] P0-01 The agent defaults pass the plugin's own checks again
- [x] P0-02 rsync's deleting options are write targets
- [x] P0-03 bsdtar and gtar get every decision tar gets
- [x] P0-04 The 0.7.1 review's advisory notes on the guard and the server
- [x] P0-05 Phase 0 end: push and record the manual check
- [x] P1-01 A failed commit is classified as a signing failure by a probe
- [x] P1-02 The fallback's override is lifted at the next run start
- [ ] P1-03 kukulu_pr_finalize waits for signatures only when the policy expects them
- [ ] P1-04 A broken signer is reported before the plan stage under required
- [ ] P1-05 Phase 1 end: push and record the manual check
- [ ] P2-01 The draft PR is titled after the flight, and prTitle overrides it
- [ ] P2-02 The merge commit's subject repeats the PR title
- [ ] P2-03 policies.archive defaults to true
- [ ] P2-04 The CHANGELOG decides whether a flight is breaking
- [ ] P2-05 kukulu_flight_options records a changed round cap in PLAN.md
- [ ] P2-06 Phase 2 end: push and record the manual check
- [ ] P3-01 prChecks falls back to the REST API on an older gh
- [ ] P3-02 kukulu_mutate's filter takes a list
- [ ] P3-03 kukulu_mutate says what kind of change it restored
- [ ] P3-04 CHANGELOG 0.7.2, the version and the feedback headers
- [ ] P3-05 Phase 3 end: push and record the manual check

## Log

(one entry per task, appended by implement)

### P0-01 — 294355a

Restored model/effort lines of the four agents from 418b291^. kukulu_verify green (npm test 3715 assertions). No interpretation choices.

### P0-02 — eca89a1

rsyncParts now returns deletes/removesSources; evaluate checks them before A-04 checks. 8 fixtures (P0-02), 2 assertions. Interpretation: under-case source reason uses the source's resolved path. Self-test 517 cases; verify green. CHANGELOG [Unreleased] section created.

### P0-03 — 39e6520

TAR_WORDS set used in evaluate write rule and recursiveOperands; reason uses word as written. 7 fixtures, 1 assertion; verify green (524 self-test cases). Interpretation: /usr/include fixture kept (plain() path shared with tar).

### P0-04 — ded73e6

Recursive containment now has its own branch naming the held protected path; landing-path hits unchanged. Fixture "rsync -a evil/ .kukulu/ (P0-05)" reason changed as specified. Comments moved/fixed in server.mjs and cleanroom.mjs. Verify green.

### P0-05 — e07e416

Pushed build/2026-10-26. Manual check: NOT VERIFIED (human): in a live clean-room session with claude --plugin-dir ., rsync -d --delete empty/ docs/ and bsdtar -xf a.tar -C docs are denied

### P1-01 — 3b4d7f5

Added signingProbe() (signed + unsigned commit-tree on empty tree); commitStaged consults it when text is unmatched and commit.gpgsign is true; probeSigning reuses it. 3 tests in test/implement.mjs, fixture test/fixtures/signing/ssh-agent-missing-key.txt. Docs and CHANGELOG updated. Verify green.

### P1-02 — b080d17

probeSigning(policy, st) lifts the override and puts it back on throw; fresh path drops override on none; reprobeSigning for already-started runs commits chore: signing re-probed. Interpretation: override created by this call's base sync is not re-probed (overrideBefore captured before sync). 4 tests; verify green.
