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
- [ ] P2-02 Policies in the global file and in profiles
- [ ] P2-03 Grouped similarity pairs
- [ ] P2-04 compare-bundles keys its scores by group
- [ ] P2-05 An alias is the model it resolves to
- [ ] P2-06 Phase 2 end: push and record the manual check
- [ ] P3-01 kukulu_next supplies the Agent call's description
- [ ] P3-02 The implementer sees its own task's log
- [ ] P3-03 An owner-only block halts for the owner
- [ ] P3-04 A cargo test filter goes after --
- [ ] P3-05 CHANGELOG 0.8.1 and the version
- [ ] P3-06 Phase 3 end: push and record the manual checks

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
