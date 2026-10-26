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
- [x] P1-03 kukulu_pr_finalize waits for signatures only when the policy expects them
- [x] P1-04 A broken signer is reported before the plan stage under required
- [x] P1-05 Phase 1 end: push and record the manual check
- [x] P2-01 The draft PR is titled after the flight, and prTitle overrides it
- [x] P2-02 The merge commit's subject repeats the PR title
- [x] P2-03 policies.archive defaults to true
- [x] P2-04 The CHANGELOG decides whether a flight is breaking
- [x] P2-05 kukulu_flight_options records a changed round cap in PLAN.md
- [x] P2-06 Phase 2 end: push and record the manual check
- [x] P3-01 prChecks falls back to the REST API on an older gh
- [x] P3-02 kukulu_mutate's filter takes a list
- [x] P3-03 kukulu_mutate says what kind of change it restored
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

### P1-03 — 113286b

signaturesExpected/signingNoteFor helpers; prFinalize gains signatures field and skips awaiting when not expected; run_start results and kukulu_next policy sentence carry signingNote. Interpretation: resign:true => expected; archived null signing => expected. Docs, README, architecture, CHANGELOG updated. Verify green (3781).

### P1-04 — 9c1e707

requiredSigningPolicy(st) + plan-stage probe in next(); go-flight step 2 sentence; docs and CHANGELOG. 3 tests in state.mjs, 1 in plugin.mjs. Verify green (3794).

### P1-05 — dbdcb51

Pushed. Manual check: NOT VERIFIED (human): in a scratch repo with the owner's real SSH signer and SSH_AUTH_SOCK pointed at the wrong agent, kukulu_plan_commit under auto commits unsigned and logs the fallback; with the socket fixed, kukulu_run_start signs again

### P2-01 — 558ade0

prTitle config key validated in cfgFrom (returned as prTitle: c.prTitle ?? null); prTitleFor(c, branch); run_finish passes it to gh pr create and returns prTitle. mkFakeGhBin pr.json now has number and title. Docs row, mcp-tools, CHANGELOG. Interpretation: a "Spec"-only heading is kept; prTitle omitted from result when pr create failed. Verify green apart from a markdownlint fix applied before commit.

### P2-02 — 2423ffe

Merge subject from gh pr view --json title,number for merge/squash; failure yields "enabled (default subject: ...)". no-sync-merge passes (one inline array). Harness: view-title-fails; test DRAFT_PR carries number/title. Verify green.

### P2-03 — fdc6a9c

cfgFrom default archive ?? true (only place). Interpretation: kukulu_config_show gained an archive field so routing tests can assert the default; documented in mcp-tools and CHANGELOG Added. Docs operations updated. Verify green.

### P2-04 — eb40db1

changelogVerdict(); prFinalize refuses disagreement before any write, adds breakingSource to results; schema/description/skill/docs updated. Interpretation: summarize skill status line matches merge starting with "enabled". Verify green (3822).

### P2-05 — f2095ea

withDecisions() helper; flightOptions adds PLAN.md to rollback set and commit only when a cap changes. 4 tests in state.mjs; CONTRIBUTING row, mcp-tools, CHANGELOG. Verify green (3830).

### P2-06 — 9ddb1d3

Pushed. Manual check: NOT VERIFIED (human): once 0.7.2 is installed, the next flight's draft PR is titled <flight>: <spec title> (this flight's own PR is opened by the running 0.7.1 as Build: <branch>)

### P3-01 — af6f4ff

prChecksViaApi + ghJson helpers; trigger on non-zero exit with unknown-flag stderr. Interpretation: seven failing entries, not six (five run conclusions + failure + error statuses), per the stated mapping. Fixtures under test/fixtures/gh. Verify green (3836; pre-commit whitespace auto-fixed then rerun clean).

### P3-02 — 2eceaaa

filter array support in mutate(); schema type ["string","array"]; docs, CONTRIBUTING row, CHANGELOG. 5 review tests + 1 protocol test. Verify green (3843).

### P3-03 — f2ee15b

classifyChanges() reads git diff --raw -z before checkout; restoredChanges in undoMutationResidue and mutate result. 3 tests, docs, CHANGELOG. Could not identify project-f F-02's cause from here. Verify green (3855).
