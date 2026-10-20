# Kūkulu 0.7.0 build plan

Derived from docs/SPEC.md v0.7.0 on 2026-10-19. SPEC.md wins over this file.

## Decisions

- Phases → SPEC §8's seven phases, in order, none merged; inside a phase the requirement order of §8, with tuning tasks inserted where each assumption first matters.
- Parallel streams → none; the plan is fully serial. Nearly every task edits `mcp/server.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md` or `CHANGELOG.md`, and the disjoint pieces (the verifier, check-names) are small and feed later serial tasks. SPEC §4 allows a serial plan.
- `baseBranch` → `cleanroom`, the branch the plan is committed on (plan-build rule; B-01 makes it a check). See Spec issues for the draft PR's target.
- §9 Q1 (how the mode is switched on) → by the presence of the policy file at `cleanroom.policy`, no flag. A human writes the policy; the planner cannot forget a flag it never writes; sticky mode turns the file's appearance or disappearance into a halt.
- §9 Q2 (where the policy lives) → `docs/cleanroom.json`, separate from `docs/kukulu.json`. The planner writes the latter; the policy must be the human's.
- §9 Q3 (the log) → `.kukulu/cleanroom/log.jsonl`, tracked, committed at every checkpoint by the tool that writes it. A chained, tracked log needs no snapshot step.
- §9 Q4 (signing) → Ed25519 through `node:crypto`, key under `~/.config/kukulu/cleanroom/`, fingerprint out of band. A bundle must verify without git or ssh-keygen.
- §9 Q5 (the bundle) → `docs/attestation/`, moved to `docs/flights/<slug>/attestation/` by the archive, like every other artifact.
- §9 Q6 (the scorer) → lexical and dependency-free, with the disclosed positioning and bands, its limits printed every time. Tree-sitter or JPlag would need a dependency.
- §9 Q7 (denial verdicts) → `human` chain entries of kind `verdict`, written through `kukulu_cleanroom_record` and counted into the bundle, modelled on cleanflate-bench's `denial_verdicts.toml`.
- §9 Q8 (site copy) → applied only from the owner-committed `docs/site/copy-changes.json`; the flight never writes it.
- §9 Q9 (one flight) → all seven phases in flight `v0-7-0`.
- §9 Q10 (`source` on review tasks) → required, no default; a default would let an old habit label everything `review`.
- `no-foundry-names` activation → `from: P0-05`, not the first A-01 task. The rule spans `scripts/`, `hooks/` and `skills/`, which P0-04 and P0-05 clean; gated on P0-03 it could never pass.
- The retired tool name → `test/plugin.mjs`'s prose check allows `kukulu_migrate` only in `CHANGELOG.md` (history) and `README.md` (the 0.7.0 migration paragraph).
- General mode → recorded by `kukulu_run_start` inside the state it already commits, never by a commit of its own at the first `kukulu_next` (that would put a commit on every project's base branch). Genesis happens at a `kukulu_next` that finds a policy, no `state.cleanroom` and no `docs/PLAN.md`; a policy with `mode: "general"`, or a policy first seen after the plan exists, is the sticky-mode halt; so is a missing policy after genesis. The halt is computed, not stored, and `kukulu_run_resume` refuses it.
- Genesis and the key → genesis generates the signing key when it is absent, because its data carries `keyFingerprint`; `kukulu_run_start` still generates it when absent.
- `mcp/cleanroom.mjs`'s writes → `appendEntry` and `generateKey` are its only writes, on paths they are handed; everything else reads only. SPEC §4 says "no I/O beyond reading", D-05 and D-06 put both functions there.
- Clean-room mode in code → `state.cleanroom.genesis` is set (trailers, checkpoints, gate, prompt sentence).
- The always-dirty log → every dirty-tree check tolerates `.kukulu/cleanroom/log.jsonl` the way `kukulu_task_done` tolerates `PROGRESS.md`, since the hooks append to it on every tool call.
- The log across flights → `kukulu_flight_archive` moves `.kukulu/cleanroom/` (log and `similarity.json`) into `docs/flights/<slug>/cleanroom/` after its own checkpoint, so a next clean-room flight's genesis starts a fresh chain at seq 1.
- `docs/kukulu.json` protection (D-10) → protected once `docs/PLAN.md` exists. Genesis happens before the plan stage, and the planner must still write the file; a later change of `cleanroom.policy` is caught by the gate's policy check.
- Lockdown before a plan → `lockdownActive` is false while `docs/PROGRESS.md` does not exist; "no open task" applies only to an existing PROGRESS.md.
- `kukulu_status.cleanroom` → lands complete in P3-19; earlier tasks test `state.json` and the log directly.
- `prChecks` → computed only for the `kukulu_status` tool call, never when another tool calls `status()` internally, and `null` without an `origin` remote, so `kukulu_next` never waits on GitHub.
- Hook scripts before they are complete → between P3-03 and P3-11/P3-12, with a policy present the guard denies every call (`guard internal error: the guard is not implemented yet`) and the logger exits 0; fail closed.
- The 50 ms fast path → measured as the hook's median wall time over 10 runs minus the median of `node -e 0` (Node's own startup), plus a proof that `mcp/cleanroom.mjs` is never loaded. A whole-process 50 ms bound would be Node's boot time, not the hook's.
- Tuning tasks → each writes `docs/spikes/<ID>.md` plus the commit's `Measurement:` line; P3-13 measures two assumptions (the hook budget and `TARGET_MAX`) because both first matter once the hooks are complete. No default changes unless a task's measurement says it must; a new default is the human's call.
- Cleanflate's eight false positives (D-03) → the eight implement-stage denials in `provenance/SUMMARY.md`'s "Denied calls" at `85f2100` other than the heredoc (P5-02, 22:36:51): ts `2026-09-30T14:40:33.544Z`, `16:11:51.801Z`, `16:11:56.220Z`, `17:00:19.952Z`, `17:21:39.475Z`, `17:23:20.004Z`, `18:13:45.842Z`, `20:53:01.396Z`, with full commands from `provenance/tool-log.snapshot.jsonl`. The real attempt is ts `2026-09-29T14:54:47.458Z`.
- Recorded commands → only in `test/fixtures/` (data), and `no-gnu-sed-inplace` excludes `test/fixtures/`; one of the eight contains `sed -i`.
- `commits.txt` → the F-01 format with `,separator=%x2C` added to both trailer placeholders, because `valueonly` alone ends each value with a newline and splits a commit over several lines.
- The verifier's idle threshold → read from the manifest's `coverage.idleGapHours`, so the assumption lives only in `cfgFrom`.
- `scripts-node-builtins` → the SPEC rule widened to dynamic `import()`, `require(` and bare `import "x"`, excluding `scripts/check-diagrams.mjs` (CI-only, documented to need mermaid and jsdom) and `scripts/lint.sh`.
- Added mechanical rules beyond SPEC §5.4 → `cleanroom-module-pure`, `hooks-lazy-cleanroom`, `verifier-node-only`, `no-hardcoded-target-max`, `no-hardcoded-mutation-fix-rounds`, `site-no-patented` (G-04): each is a SPEC boundary that a line pattern can state.
- B-03's "review-history line" → the summarize skill's Review history item reads `sources` from `state.rounds`; `kukulu_summary_commit` renders no such line.
- B-04's slug rule → gains an explicit "fold accented letters to ASCII" step; without it "Kūkulu 0.7.0" gives `k-kulu-0-7-0`, not SPEC's `kukulu-0-7-0`.
- B-05 and C-01 → P1-13 creates CONTRIBUTING's `## Flight feedback` and the skill's no-commit rule and pointer to the label file; P2-01 writes the label procedure and the label file-naming rule.
- Rule 16 and the approval gate → one task (P6-04) applies the copy, makes the diagram solid and adds rule 16, because rule 16 fails until the copy is applied and SPEC wants no later task to depend on the approval.
- G-02's merge-base → `git merge-base <baseBranch> HEAD` with `baseBranch` from `docs/kukulu.json` (`cleanroom`), where the owner committed the approval.
- G-03's scope → Fig. 1 only: the room, the guard's blocked box, the provenance/controller row, the three evidence boxes and the legend's dashed swatch. Section 04's clean-room box is not part of Fig. 1 and stays dashed (see Spec issues).
- Changelog → tasks add lines under `## [Unreleased]`; P6-03 renames it to `## [0.7.0] — <date>` with the version bump, since `test/plugin.mjs` requires the newest numbered entry to equal the package version.
- markdownlint's exclusion of the pipeline artifacts in `.pre-commit-config.yaml` stays; SPEC does not ask to lift it.
- Flight slug → `v0-7-0`, as the operator passed it.

## Conventions

- Commit template: `CLAUDE.md` `## Commit template`, title `<ID>: <title>`, written to a file and committed with `git commit -F <file>`.
- Every task's verification is `kukulu_verify` with its Files touched: `npm run lint`, `pre-commit run --all-files` and `npm test` (900 s) always; `npm run check:site` and the exclusive `npm run check:site:browser` for site paths; the guard self-test for clean-room paths from P3-11.
- Shared protocols the implementer reads are in `CLAUDE.md` `## Task protocols` (adding or removing a tool, prose naming only real tools, changelog, tuning, clean-room tests, commit-failure tests, signing tests, adding a site check).
- Tests are named by their assertion message; the names below are the messages to use.

## Phase 0 — End of the foundry period

### P0-01: Keep pre-commit from rewriting the approved-copy file

**Goal:** `pre-commit run --all-files` passes on the base branch without modifying `docs/site/copy-changes.json`, which the owner committed without a final newline.

**Files touched:** `.pre-commit-config.yaml`

**Design constraints:**

- SPEC §6 G-01 (the flight never creates, edits or deletes `docs/site/copy-changes.json`); §7 (every command passes on a clean checkout); CLAUDE.md Constraints.
- Today `end-of-file-fixer` rewrites that file on every run, so every `kukulu_verify` fails and dirties the tree. Add `exclude: '^docs/site/copy-changes\.json$'` to the `end-of-file-fixer` hook, with a one-line comment saying why (the owner's approval file is applied verbatim and never edited by a flight). Change nothing else.
- If `pre-commit run --all-files` has already rewritten the file in your checkout, restore it with `git checkout -- docs/site/copy-changes.json` before committing; `git diff --quiet HEAD -- docs/site/copy-changes.json` must hold at the end.

**Acceptance tests:** `pre-commit run --all-files` passes twice in a row and leaves `git status --porcelain` empty; `test/plugin.mjs` still passes.

**Out of scope:** `docs/site/copy-changes.json` itself; every other hook.

**Verification:** `kukulu_verify`; `git diff --stat HEAD~1 -- docs/site/copy-changes.json` is empty.

**Depends on:** none

### P0-02: Remove the FOUNDRY_* fallbacks and the deprecations field

**Goal:** The server reads only `KUKULU_<name>` variables and the `kukulu/` global config, re-resolved on every call, and no longer returns a `deprecations` field.

**Files touched:** `mcp/server.mjs`, `.mcp.json`, `skills/go-flight/SKILL.md`, `test/routing.mjs`, `test/plugin.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-01 bullets 1, 3, 4 and 5 (the environment and global-config half); §3 principles 3, 5, 10, 17.
- `envVar(name)` returns `process.env["KUKULU_" + name]` when it is non-empty, else `undefined`. Delete `DEPRECATIONS` and `deprecate()`.
- `globalConfigPath()`: `KUKULU_CONFIG` when set, else `$XDG_CONFIG_HOME/kukulu/config.json`, else `~/.config/kukulu/config.json`; no `foundry/` fallback. It is called on every resolve and never memoized (no module-level cache of the path or the file).
- Remove `deprecations` from `kukulu_status`'s and `kukulu_next`'s results and from their `TOOLS` descriptions. `resolveLayout` loses its notice bookkeeping (the lines that push or splice a notice); leave its detection and its both-layouts refusal for P0-03.
- go-flight: step 1 no longer prints `deprecations` and its listed return shape drops the field.
- `.mcp.json`'s `env` drops `FOUNDRY_CONFIG` and `FOUNDRY_PROFILE`.
- `docs/mcp-tools.md`: drop the `deprecations` row of `kukulu_status` and the field from `kukulu_next`'s shape and bullets.
- `CHANGELOG.md` `## [Unreleased]` gains `### Breaking changes` bullets: the `FOUNDRY_*` variables and the `foundry/` global config are no longer read; the `deprecations` field is gone.

**Acceptance tests:**

- `test/routing.mjs`: the "pre-0.6.0 names" block becomes "FOUNDRY_CONFIG is ignored", "a foundry/config.json global file is not read", "FOUNDRY_PROFILE does not select a profile"; plus "kukulu_config_show re-reads the global config on every call" (one server process, isolated `XDG_CONFIG_HOME`, write `kukulu/config.json` between two `kukulu_config_show` calls, the second reflects it).
- `test/plugin.mjs`: the two `FOUNDRY_*` passthrough assertions become ".mcp.json no longer passes FOUNDRY_CONFIG" and "...or FOUNDRY_PROFILE".
- `test/state.mjs`: "kukulu_status has no deprecations field", "kukulu_next has no deprecations field"; remove the assertions that read `deprecations`.

**Out of scope:** the project layout fallback, `kukulu_migrate`, decision 4a (P0-03); the guard and `hooks/hooks.json` (P0-04); `docs/operations.md` (P0-05).

**Verification:** `kukulu_verify`; `grep -n 'FOUNDRY_\|DEPRECATIONS' mcp/server.mjs .mcp.json` prints nothing.

**Depends on:** none

### P0-03: Refuse the pre-0.6.0 layout and remove kukulu_migrate

**Goal:** Every tool refuses a project on the Foundry layout with A-01's message, and `kukulu_migrate`, decision 4a and the in-place layout fallback are gone.

**Files touched:** `mcp/server.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `test/state.mjs`, `test/review.mjs`, `test/implement.mjs`, `test/constraints.mjs`, `test/harness.mjs`, `skills/go-flight/SKILL.md`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-01 bullets 1, 2 and 5; A-04 bullet 1; §5.4's last paragraph; §3 principles 3, 10, 16, 17.
- Delete `LAYOUT.legacy`, `LEGACY_LAYOUT_NOTICE`, `legacyLayout`, `resolveLayout`'s legacy branch, `inLayoutNames` (and its use in `handle()`), decision 4a in `next()`, `LEGACY_AGENT_MARKER`, `migrate()` and its `TOOLS` entry. `P` becomes `const P = layoutFor(".kukulu", "kukulu.json")`, assigned once.
- On every `tools/call`, before the tool runs: when `.foundry/` or `docs/foundry.json` exists and neither `.kukulu/` nor `docs/kukulu.json` does, throw a `ToolError` with exactly: "this project is on the pre-0.6.0 Foundry layout, which 0.7.0 no longer reads. Move `.foundry/state.json` and `.foundry/feedback.jsonl` to `.kukulu/`, `docs/foundry.json` to `docs/kukulu.json`, and the `.foundry/` lines of `.gitignore` to `.kukulu/`, then commit (0.6.x's `kukulu_migrate` did this)." A project holding both layouts keeps its existing both-layouts refusal, with the `kukulu_migrate` hint removed.
- No line of `mcp/server.mjs` may contain "foundry" in any case (constraint `no-foundry-names`, active from P0-05). Build every legacy name from one constant, `const LEGACY = "foun" + "dry";` (`.${LEGACY}/`, `docs/${LEGACY}.json`, and the capitalised word in the message). `finalizeConfig`'s archive fallback keeps reading an archive's old config file, written on one line as `const archived = ["kukulu.json", "foun" + "dry.json"].map((n) => path.join(ROOT, st.archived.dir, n)).find(exists);`. Reword or delete every comment that names it.
- Follow "Adding a tool" in CLAUDE.md in reverse: remove `kukulu_migrate` from `EXPECTED_TOOLS`, set `test/plugin.mjs`'s count to the number of `name: "kukulu_` entries (21), "Twenty-one tools" on the first line of `docs/mcp-tools.md`, README's sentence and table row; delete `docs/mcp-tools.md`'s `## kukulu_migrate` section and the decision-4a text in `kukulu_next`'s reason bullet.
- `test/plugin.mjs`'s "every kukulu_* tool named in prose exists on the server" gains `RETIRED_TOOLS = ["kukulu_migrate"]`, allowed only in `CHANGELOG.md` and `README.md`; anywhere else it still fails. Add "kukulu_migrate appears only in CHANGELOG.md and README.md".
- go-flight: delete the "migrate" option bullet, `[migrate]` from `argument-hint`, and both spellings of `kukulu_migrate` from `allowed-tools`.
- Tests on the old layout: `useLegacyLayout` stays as a fixture builder; every test that used it to prove in-place reading becomes a refusal test; `test/review.mjs`'s `kukulu_migrate` tests are deleted. The v0-5-0 archived-flight test in `test/state.mjs` moves its project to `.kukulu/state.json` (the archive still holds `foundry.json`) and keeps its status and next assertions.
- `CHANGELOG.md` `## [Unreleased]` `### Breaking changes`: `kukulu_migrate` removed; the Foundry layout is refused, with the manual migration as one paragraph (the moves in the refusal message).

**Acceptance tests:**

- `test/state.mjs`: "a project with only .foundry/ is refused with the 0.7.0 layout message" (asserts `/pre-0\.6\.0 Foundry layout, which 0\.7\.0 no longer reads/` and that it names `docs/kukulu.json`), "a project with only docs/foundry.json is refused the same way", "a project with both layouts is refused", "every tool refuses the old layout" (`kukulu_status`, `kukulu_next`, `kukulu_verify` each `isError`), "status reads the archive record of a flight archived before 0.6.0" and "kukulu_next recognizes the archived flight" on the `.kukulu/` layout.
- `test/protocol.mjs`: `tools/list` lists `EXPECTED_TOOLS` in order.
- `test/plugin.mjs`: the count assertion, "docs/mcp-tools.md states the tool count in words", "kukulu_migrate appears only in CHANGELOG.md and README.md", "go-flight no longer offers migrate".

**Out of scope:** the guard and hooks (P0-04); `docs/operations.md`, `docs/architecture.md`, the summarize and pull-feedback skills (P0-05); the pinned hashes (P0-06).

**Verification:** `kukulu_verify`; `grep -n -i foundry mcp/server.mjs` prints nothing.

**Depends on:** none

### P0-04: The guard and hooks accept only the kukulu names

**Goal:** `scripts/implement-guard.mjs` and `hooks/hooks.json` recognise only the kukulu implementer names, run-start tool and state directory.

**Files touched:** `scripts/implement-guard.mjs`, `hooks/hooks.json`, `test/guard.mjs`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 A-02; §3 principle 10.
- `IMPLEMENTER_AGENT_TYPES = new Set(["kukulu-implementer", "kukulu:implementer"])`; `RUN_START_TOOL = /^(?:mcp__.+__)?kukulu_run_start$/`; `STATE_DIRS` becomes the single `.kukulu` (simplify the code that loops over it); the cap is the lock's `cap`, else `KUKULU_GUARD_CAP`, else 60, and `FOUNDRY_GUARD_CAP` is never read. `TASK_ID`, `TASK_LINE` and the task-line regex in `openTasks` do not change.
- The header comment drops every pre-0.6.0 clause.
- `hooks/hooks.json`'s `SubagentStop` matcher is exactly `^(kukulu:implementer|kukulu-implementer)$`.

**Acceptance tests:**

- `test/guard.mjs`: the four legacy cases become "a foundry-implementer stop is allowed", "a foundry:implementer stop is allowed", "a foundry_run_start call in the transcript does not make a Stop the implementer's", and "a .foundry/implement.lock is ignored"; plus "FOUNDRY_GUARD_CAP is not read".
- `test/plugin.mjs`: "...and still names the pre-0.6.0 implementer" becomes "SubagentStop's matcher names only the kukulu implementer" (exact string).

**Out of scope:** any other guard behavior; the server; skills.

**Verification:** `kukulu_verify`; `grep -n -i foundry scripts/implement-guard.mjs hooks/hooks.json` prints nothing.

**Depends on:** none

### P0-05: Skills and docs drop the foundry compatibility

**Goal:** No skill or doc describes a foundry fallback any more, and the `no-foundry-names` constraint, which this task activates, passes.

**Files touched:** `skills/summarize/SKILL.md`, `skills/pull-feedback/SKILL.md`, `docs/operations.md`, `docs/architecture.md`, `docs/mcp-tools.md`, `CHANGELOG.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 A-03 (and A-04 bullet 1 for what the docs keep); §3 principle 10.
- summarize: drop its `.foundry/feedback.jsonl` sentence. pull-feedback step 1: drop the parenthetical about `.foundry/feedback.jsonl`.
- `docs/operations.md`: delete the two "Before 0.6.0" paragraphs under the environment table; keep, as one sentence, that flights archived before 0.6.0 keep `foundry.json` in their archive directory and that finalizing one still reads it.
- `docs/architecture.md`: decision 4 loses "except on the pre-0.6.0 layout (decision 4a)" and the 4a bullet goes.
- `docs/mcp-tools.md`: no `deprecations`, no decision-4a text remains.
- This task is the `from` of `no-foundry-names`: when it is in progress the rule scans `mcp/`, `scripts/`, `hooks/`, `skills/`, `agents/` and `.mcp.json`. Every hit must be gone; `scripts/verify-attestation.mjs` does not exist yet.
- `CHANGELOG.md` Breaking changes: the docs no longer describe the old names.

**Acceptance tests:** `test/plugin.mjs`: "no skill mentions the .foundry/ layout" (every `skills/*/SKILL.md` fails `/\.foundry\//`), "operations.md no longer documents the FOUNDRY_* fallbacks". The `no-foundry-names` constraint passes in `kukulu_verify`.

**Out of scope:** `docs/flights/`, `docs/plans/`, `docs/SPEC.md`; CHANGELOG history below `## [Unreleased]`.

**Verification:** `kukulu_verify` (constraints included); `grep -rn -i foundry mcp scripts hooks skills agents .mcp.json` prints nothing.

**Depends on:** P0-02, P0-03, P0-04

### P0-06: Archives stay readable without pinned hashes

**Goal:** The v0-5-0 archive test computes its hashes at test start instead of pinning them, and finalizing a flight archived with `foundry.json` still reads that config.

**Files touched:** `test/state.mjs`, `test/review.mjs`

**Design constraints:**

- SPEC §6 A-04 bullet 2, the last sentence of §5.4, Appendix A item 7.
- Replace `PINNED` with the list of the nine recorded names (`HANDOFF.md`, `PLAN.md`, `PROGRESS.md`, `REVIEW.md`, `SPEC.md`, `SUMMARY.md`, `feedback.jsonl`, `foundry.json`, `state.json`): assert `docs/flights/v0-5-0/` holds exactly those, compute each SHA-256 at test start, copy them into a temp project on `.kukulu/`, run `kukulu_status` and `kukulu_next`, and assert every copy is byte-identical to its computed hash. No hash literal remains in the test.
- `kukulu_pr_finalize`'s test (in `test/review.mjs`, where finalize is tested): a summarized, archived project whose archive directory holds a `foundry.json` (no `kukulu.json`) naming a non-default `baseBranch` that exists; finalize uses that base (it is not refused for a missing merge base).

**Acceptance tests:** `test/state.mjs`: "docs/flights/v0-5-0 holds exactly the nine recorded files", "the tools leave every archived file byte-identical"; `test/review.mjs`: "kukulu_pr_finalize reads an archive's foundry.json when it has no kukulu.json".

**Out of scope:** any server change; renaming `docs/flights/v0-5-0/foundry.json`.

**Verification:** `kukulu_verify`; `grep -n '[0-9a-f]\{64\}' test/state.mjs` finds no archive hash.

**Depends on:** none

### P0-07: Phase 0 end: push and record the manual check

**Goal:** Push the branch with the foundry removal and record Phase 0's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 0. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task: `git commit --allow-empty -F <file>` with the subject `P0-07: Phase 0 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): run the installed 0.6.1 plugin's kukulu_migrate on a throwaway .foundry/ project, then run one task of a flight on it with the working-tree plugin (claude --plugin-dir .)`.

**Depends on:** none

## Phase 1 — Friction and feedback

### P1-01: plan_commit checks the branch; run_start names both fixes

**Goal:** `kukulu_plan_commit` refuses a plan committed on a branch that is neither `baseBranch` nor a `branchPrefix` branch, and `kukulu_run_start`'s foreign-branch refusal names both ways out.

**Files touched:** `mcp/server.mjs`, `skills/plan-build/SKILL.md`, `test/state.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-01; Appendix A item 1; §3 principles 2, 17.
- `validatePlanTexts` takes the current branch (`git rev-parse --abbrev-ref HEAD`; skip the check outside a repository) and adds check `branch`: legal when it equals the config's `baseBranch` or starts with its `branchPrefix` (defaults as `cfgFrom`). The problem's message is exactly `on '<branch>', but docs/kukulu.json baseBranch is '<base>'; set baseBranch to '<branch>' (the branch the plan is committed on) or switch to it`, so the numbered line reads `[branch] on '…`. A detached HEAD reports `HEAD` as the branch.
- `startRun`'s refusal becomes: `on branch '<b>'; runs start from '<base>' or an existing '<prefix>*' branch. Either set baseBranch to '<b>' in docs/kukulu.json and re-run \`kukulu_plan_commit\`, or \`git switch -c <prefix><date>\` from '<b>'.` with `<date>` from `today()`.
- plan-build skill: "set `baseBranch` to the branch you are on, unless SPEC names another", and that `kukulu_plan_commit` checks it.
- `docs/mcp-tools.md`: the `branch` row in `kukulu_plan_commit`'s check table; the new `kukulu_run_start` refusal text.

**Acceptance tests:** `test/state.mjs`: "plan_commit refuses a plan on a branch that is neither baseBranch nor a branchPrefix branch" (asserts the message and `check: "branch"`), "...accepts baseBranch", "...accepts a branchPrefix branch"; `test/implement.mjs`: "run_start's foreign-branch refusal names both fixes" (asserts `set baseBranch to` and `git switch -c build/`).

**Out of scope:** changing which branches `kukulu_run_start` accepts.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-02: kukulu_run_resume

**Goal:** A new tool, `kukulu_run_resume({ reason })`, clears a non-round-cap halt with a commit, so no operator edits `.kukulu/state.json` by hand.

**Files touched:** `mcp/server.mjs`, `test/implement.mjs`, `test/streams.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `skills/go-flight/SKILL.md`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-02 bullets 1–3; Appendix A items 2 and F-07; §3 principles 2, 3, 16, 17. Follow "Adding a tool" in CLAUDE.md: insert after `kukulu_run_halt`; the flight controller's `allowed-tools` gets both spellings; no agent gets it.
- `reason` must be a non-empty string after trimming. Refusals, in this order, before anything is written: the flight is not halted ("the flight is not halted; there is nothing to resume"); `state.haltCap` is set ("a round-cap halt is lifted by `kukulu_flight_options({ …, resume: true })`"); the tree is dirty apart from `preexistingUntracked` (list the lines); a stream worktree exists (name it); `baseBranch` does not exist as a local branch; or the halt is a stream-merge halt and that stream's branch still exists and is not in `git branch --merged <build-branch>`.
- To know a stream-merge halt, `kukulu_stream_finish`'s conflict path also records `state.haltStream = "<stream>"`; `kukulu_run_halt` and `kukulu_run_resume` delete it.
- Otherwise: `state.halted = null`, delete `haltStream`, append one feedback entry (`stage: "controller"`, `category: "resume"`, `source: "human"`, the message names the reason), commit state and feedback as `chore: run resumed`, inside `withRollback`. Returns `{ resumed: true, previousHalt, commit }`. The clean-room `human` entry is P3-18's.
- `docs/mcp-tools.md` gets a `## kukulu_run_resume` section; README a row.

**Acceptance tests:** `test/implement.mjs`: "kukulu_run_resume refuses when the flight is not halted", "...refuses a round-cap halt naming kukulu_flight_options", "...refuses a dirty tree listing the paths", "...refuses when baseBranch is missing", "...refuses an empty reason", "kukulu_run_resume clears the halt and commits chore: run resumed", "...logs a resume feedback entry with source human", "kukulu_next no longer halts after a resume", "a failed resume commit leaves state.json and feedback.jsonl byte-identical" (commit-failure protocol, subject `chore: run resumed`); `test/streams.mjs`: "kukulu_run_resume refuses while a stream worktree exists", "...refuses a stream-merge halt whose branch is unmerged"; `test/protocol.mjs` and `test/plugin.mjs`: the tool list and counts.

**Out of scope:** halt messages, go-flight's mapping and `docs/operations.md` (P1-03).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-03: Halts name kukulu_run_resume; go-flight maps resume

**Goal:** Every non-round-cap halt tells the operator to call `kukulu_run_resume`, go-flight maps "resume: <reason>" to it, and the docs lose every hand edit of `state.json`.

**Files touched:** `mcp/server.mjs`, `skills/go-flight/SKILL.md`, `docs/operations.md`, `docs/mcp-tools.md`, `README.md`, `test/plugin.mjs`, `test/streams.mjs`, `test/implement.mjs`

**Design constraints:**

- SPEC §6 B-02 bullet 4.
- `kukulu_next`'s halt for a stored halt without `haltCap` returns the reason followed by ` — once the cause is fixed, call kukulu_run_resume({ reason: "<what you fixed>" })`. `kukulu_run_halt`'s result gains `next` with the same instruction. `kukulu_stream_finish`'s conflict reason replaces its "set halted to null in .kukulu/state.json" step with `kukulu_run_resume`.
- go-flight: "resume: <reason>" (or "continue: <reason>" when the halt reason does not name `resume: true`) → call `kukulu_run_resume({ reason })` once, print the result, then go back to step 1 of the loop; a refusal is printed and the controller stops.
- `docs/operations.md`: the Halts section names `kukulu_run_resume` for the operator-level and stream-merge halts and contains no `$EDITOR` and no `"halted": null`; the stream-merge recovery steps under Parallel streams and the "When something goes wrong" rows say the same. README's "Resuming and halting" names both tools. `docs/mcp-tools.md`'s `kukulu_run_halt` section names `kukulu_run_resume` instead of the hand edit.

**Acceptance tests:** `test/plugin.mjs`: "go-flight maps resume: <reason> to kukulu_run_resume", "operations.md's Halts section names no hand edit of .kukulu/state.json"; `test/implement.mjs`: "kukulu_next's reason for an operator halt names kukulu_run_resume", "kukulu_run_halt's result names kukulu_run_resume"; `test/streams.mjs`: "a stream-merge halt names kukulu_run_resume".

**Out of scope:** changing what a round-cap halt says (it keeps naming `kukulu_flight_options`).

**Verification:** `kukulu_verify`.

**Depends on:** P1-02

### P1-04: The link check reads git ls-files

**Goal:** `test/plugin.mjs`'s documentation link check resolves links against tracked files only, so it can no longer pass because of a gitignored file on the maintainer's machine.

**Files touched:** `test/plugin.mjs`

**Design constraints:**

- SPEC §6 B-06; §3 principle 18; Appendix A item 6.
- Extract the check into `brokenLinks(root)`: the files are `git ls-files` in `root`; the Markdown set is the tracked `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` and top-level `docs/*.md`; a relative target (fragment stripped) resolves when its repo-relative path is a tracked file or a directory that contains one. A failure names `<file> → <target>`. The "every document in docs/ is linked from the README" check also lists tracked files only.

**Acceptance tests:** `test/plugin.mjs`: "every relative link in the documentation resolves" (kept, now through `brokenLinks(ROOT)`), "a link to an untracked file fails the link check, naming the file and target" (a temp git repo whose tracked `README.md` links an untracked `docs/x.md`), "...and passes once the target is tracked".

**Out of scope:** any change to the documents.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-05: MD022-clean writes to PROGRESS.md and PLAN.md

**Goal:** Every heading the server writes into `docs/PROGRESS.md` and `docs/PLAN.md` has a blank line after it (and before it, unless it is the first line), and both spacings still parse.

**Files touched:** `mcp/server.mjs`, `skills/plan-build/SKILL.md`, `test/harness.mjs`, `test/implement.mjs`, `test/review.mjs`

**Design constraints:**

- SPEC §6 B-09; kukulu-tech F-01.
- `appendLog` writes `""`, `### <ID> — <stamp>`, `""`, body; when it creates `## Log` it writes `""`, `## Log`, `""`. The `### <ID> — reopened` entries go through it. `reviewSubmit`'s block writes `## Review fixes (round N)` and each fix task's `### R<N>-<nn>: …` heading with one blank line after each (`formatTask` returns the heading, a blank line, then the fields).
- `parseProgressText` and `planTaskFrom` accept both the old (no blank line) and the new spacing; log bodies are compared trimmed.
- `test/harness.mjs` gains `headingSpacingProblems(text)` → a list of `line <n>: <heading> …` problems for any `#` heading not followed by a blank line or not preceded by one (except line 1). `planDoc`/`progressDoc` produce the new spacing; keep one fixture in the old spacing.
- plan-build skill: the PLAN.md and PROGRESS.md format blocks carry a blank line after every heading.

**Acceptance tests:** `test/implement.mjs`: "PROGRESS.md is MD022-clean after task_done", "...after task_block", "...after task_reopen", "a PROGRESS.md in the 0.6 spacing still parses"; `test/review.mjs`: "PLAN.md and PROGRESS.md are MD022-clean after a CHANGES REQUESTED submit", "a PLAN.md in the 0.6 spacing still parses".

**Out of scope:** the `.pre-commit-config.yaml` markdownlint exclusion; the dependency field (P1-06).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-06: The dependency field is matched at line start

**Goal:** `planTaskFrom` reads a task's dependencies only from a line that starts with the bold `Depends on:` label, so the label quoted in prose no longer hides the real dependency.

**Files touched:** `mcp/server.mjs`, `test/implement.mjs`

**Design constraints:** SPEC §6 B-10; kukulu-tech F-02. The regex becomes `/^\*\*Depends on:\*\*\s*(.*)$/im`; nothing else in `planTaskFrom` changes.

**Acceptance tests:** `test/implement.mjs`: "a quoted dependency label in a task's prose does not replace its real dependency" (a plan whose task's Design constraints line contains the bold label mid-line followed by another id, and whose real field names `P1-01`; `kukulu_task_next` returns `dependsOn: ["P1-01"]` and `kukulu_plan_commit` reports no `depends` problem).

**Out of scope:** any other field parsing.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-07: kukulu_mutate runs the constraint scan

**Goal:** `kukulu_mutate` runs the active constraints over the mutated tree, so a mutant only a constraint catches is reported as killed by that rule.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-07; kukulu-tech F-05.
- After applying the mutation and before the commands: `checkConstraints(cc.constraints, ROOT, state.preexistingUntracked)` (fixture self-test included; a rule with an unreached `from` stays inactive). The result gains `constraints: { ok, results }`. A rule with hits counts as a kill; a rule whose own fixture fails is reported but is not a kill.
- `killed` is true when any constraint has hits or any command fails. `verdict` is `killed: constraint <id> caught the mutation` (the first such id) when no command failed and a constraint did. `confirmKill` re-runs only failed commands, as today; a kill by a constraint alone stands without a `confirm`.
- The restore and residue logic is unchanged. `docs/mcp-tools.md`: replace "Constraints are not run" and document the field and verdict.

**Acceptance tests:** `test/review.mjs`: "a mutant only a constraint catches is killed by that rule" (verdict `/killed: constraint .* caught the mutation/`, `constraints.ok` false), "a mutant nothing catches survives with constraints.ok true", "confirmKill does not re-run anything for a constraint-only kill", "the mutated file is restored after a constraint kill".

**Out of scope:** changing `kukulu_verify`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-08: kukulu_status reports prChecks; the review reads CI

**Goal:** `kukulu_status` reports the pull request's CI checks as `prChecks`, and the review-build skill reads them from round 2 on.

**Files touched:** `mcp/server.mjs`, `test/harness.mjs`, `test/state.mjs`, `skills/review-build/SKILL.md`, `test/plugin.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-08; kukulu-tech F-03, F-04.
- Only the `kukulu_status` tool computes it (not `status()` as called by `next()` or other tools). `null` when there is no `origin` remote, `gh --version` fails, or `gh pr view` reports no pull request. Otherwise run `gh pr checks --json name,state,link` with a 30 000 ms `spawnSync` timeout and parse stdout as JSON whatever the exit status (gh exits non-zero for failing or pending checks).
- `state`: `fail` if any check's state is one of FAILURE, ERROR, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE; else `pending` if any is PENDING, QUEUED, IN_PROGRESS, WAITING, REQUESTED or EXPECTED; else `pass` when at least one check exists; `none` for an empty list. `failing: [{ name, link }]`. Unparseable output, a gh error or the timeout → the string `unknown: <why>`.
- `mkFakeGhBin` answers `pr checks` from `$dir/checks.json` (printed as is, exit status from `$dir/checks-exit`, default 0) and prints `[]` when that file is absent.
- review-build skill: from round 2 on, read `kukulu_status`'s `prChecks` first; a `fail` is a finding (category 3) naming the check, and its fix task's `tests` names it.

**Acceptance tests:** `test/state.mjs`: "prChecks is null without gh", "...null without an origin remote", "...null when the branch has no pull request", "...pass", "...fail lists the failing check with its link", "...pending", "...none for an empty list", "...unknown when gh pr checks prints no JSON", "kukulu_next does not call gh pr checks"; `test/plugin.mjs`: "review-build reads prChecks from round 2".

**Out of scope:** any change to the PR itself.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-09: Review tasks carry a source; mutation-only rounds are capped

**Goal:** Every fix task names its `source`, and past `review.mutationFixRounds` a `mutation` task is refused so the review loop converges.

**Files touched:** `mcp/server.mjs`, `skills/review-build/SKILL.md`, `skills/summarize/SKILL.md`, `test/review.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-03; §5.1 `review.mutationFixRounds` row; §5.3 first bullet; §9 Q10; CLAUDE.md "Adding a docs/kukulu.json key".
- `validateReview(review)`: absent is fine; must be an object; unknown keys refused (`docs/kukulu.json review has an unknown key '<k>'`); `mutationFixRounds` a positive integer. `cfgFrom` returns, preceded by a one-line `// ⚠️ ASSUMPTION:` comment that names the key but writes no standalone digit 2, exactly the line `    review: { mutationFixRounds: c.review?.mutationFixRounds ?? 2 },` (constraint `no-hardcoded-mutation-fix-rounds` allows the 2 only there). Every other use reads `cc.review.mutationFixRounds`.
- `reviewSubmit`: every task needs `source` in `review`, `mutation`, `blocked`, else `fix task '<title>' needs a source: "review", "mutation" or "blocked"`. When `N > cc.review.mutationFixRounds` and any task has `source: "mutation"`, refuse with SPEC's text, interpolating N and the configured value: `round <N> is past review.mutationFixRounds=<value>: a surviving mutant is advisory now. Put it under \`## Notes\` in REVIEW.md (the summarizer carries it) and resubmit; if the survivor shows a SPEC requirement is untested, resubmit it as source "review" naming that requirement.` Both checks run before any write.
- `state.rounds[]` entries gain `sources: { review, mutation, blocked }` (all zero for APPROVED).
- review-build skill: replace the round-2+ paragraph: mutate only the files of the last fix round's tasks; from round `mutationFixRounds + 1` a survivor never becomes a task; a survivor in a self-test or test file is always labelled `mutation`; keep "at least three", "one R-task per file" and `## Notes`.
- summarize skill, Review history item: render each round's `sources`.
- `docs/operations.md` row; `test/plugin.mjs`'s config-keys loop gains a `review` branch; existing `test/review.mjs` submissions add `source: "review"`.

**Acceptance tests:** `test/review.mjs`: "a fix task without source is refused naming the legal values", "...with another source is refused", "a mutation task past mutationFixRounds is refused and nothing is written" (REVIEW.md, PLAN.md, PROGRESS.md, state.json byte-identical, HEAD unchanged), "a review task past mutationFixRounds is accepted", "state.rounds records sources counts", "an APPROVED round records zero sources", "review.mutationFixRounds must be a positive integer", "review has an unknown key"; `test/plugin.mjs`: "operations.md documents review.mutationFixRounds", "review-build caps mutation-only rounds at mutationFixRounds".

**Out of scope:** tuning the default (P1-10).

**Verification:** `kukulu_verify` (the `no-hardcoded-mutation-fix-rounds` constraint included).

**Depends on:** none

### P1-10: Tune review.mutationFixRounds from the archived trails

**Goal:** Measure what `review.mutationFixRounds = 2` would have done to the archived flights' review loops and record whether the default holds.

**Files touched:** `docs/spikes/P1-10.md`, `mcp/server.mjs` (only if the default must change)

**Design constraints:**

- SPEC §5.3 first bullet; follow "Tuning an assumption" in CLAUDE.md. Before = 2 (⚠️ ASSUMPTION).
- Read `docs/flights/*/state.json` (`rounds`), each archive's `PLAN.md` "Review fixes" sections and `SUMMARY.md` review history; classify every fix task as a mutation survivor or a real defect; for each flight, list the rounds whose tasks a cap of 2 would have refused and the round approval would have come at.
- The default stays 2 unless a trail shows a real defect found by a mutation survivor in round 3 or later; only then set the smallest value that would have kept it, on cfgFrom's review line, and say so in the spike.

**Acceptance tests:** none new; `docs/spikes/P1-10.md` exists, is markdownlint-clean and holds the per-flight table, the method and the decision.

**Out of scope:** changing anything else in the review loop.

**Verification:** `kukulu_verify`; the commit body's `Measurement:` line names before, after and the evidence.

**Depends on:** P1-09

### P1-11: The flight slug rule and the -spec note

**Goal:** The plan-build skill derives `flight` from the text before SPEC's title dash, and `kukulu_plan_commit` notes a slug ending in `-specification` or `-spec`.

**Files touched:** `skills/plan-build/SKILL.md`, `mcp/server.mjs`, `test/plugin.mjs`, `test/state.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 B-04; Appendix A item 9.
- Skill rule: take the title's text before the first ` — `, ` - ` or `:`; fold accented letters to ASCII (a u with a macron becomes u); lowercase; turn runs of non-alphanumerics into `-`; remove trailing words `specification` and `spec`; trim `-`; cut to 40. State both examples verbatim: "kukulu.tech — Specification" gives `kukulu-tech`; "Kūkulu 0.7.0 — Specification" gives `kukulu-0-7-0`. An operator's `Flight slug: <slug>.` still wins.
- `kukulu_plan_commit`'s result gains `notes: [...]`; when the config's `flight` matches `/-spec(ification)?$/` it holds `flight '<slug>' ends in a spec suffix; derive it from the text before the title's dash (plan-build), e.g. '<slug without the suffix>'`. It is never a refusal.

**Acceptance tests:** `test/plugin.mjs`: "plan-build states the slug rule with both examples"; `test/state.mjs`: "plan_commit notes a flight slug ending in -specification", "...ending in -spec", "...and has no notes for v0-7-0", "...and still commits".

**Out of scope:** renaming archived flights.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-12: Auto-merge unavailable names policies.finalize

**Goal:** `kukulu_pr_finalize`'s `merge: "unavailable: …"` strings end with `; set policies.finalize to "ready" to stop asking`.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `docs/mcp-tools.md`

**Design constraints:** SPEC §6 B-11; Appendix A item 8. No behavior change; both `unavailable:` results (the failed `gh pr ready` and the failed `gh pr merge --auto`) gain the suffix.

**Acceptance tests:** `test/review.mjs`: "an unavailable auto-merge says to set policies.finalize to ready" (fake gh with `merge-fails`; `merge` matches `/^unavailable: .*; set policies\.finalize to "ready" to stop asking$/`).

**Out of scope:** any other finalize change.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-13: pull-feedback never commits; Flight feedback moves to CONTRIBUTING

**Goal:** The pull-feedback skill never commits, points at a tracked `CONTRIBUTING.md#flight-feedback` section, and names the private-label file.

**Files touched:** `skills/pull-feedback/SKILL.md`, `CONTRIBUTING.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 B-05; Appendix A item 5.
- Step 8 becomes "Do not commit; `docs/feedback/` is gitignored and this file stays on your machine." Step 7 takes the header shape from `CONTRIBUTING.md#flight-feedback` instead of `docs/feedback/README.md`. Step 3 says a project other than this repository and cleanflate is written under a `project-<letter>` label recorded in `docs/feedback/.private-names` (P2-01 writes the procedure).
- `CONTRIBUTING.md` gains `## Flight feedback`, restating (the local `docs/feedback/README.md` may not exist): what the loop is (`kukulu_feedback_log` appends one JSON line to `.kukulu/feedback.jsonl` with `at`, `stage`, `round`, `category`, `message`, `source`, and commits it; `/kukulu:pull-feedback` turns another project's log, including `docs/flights/*/feedback.jsonl`, into a file here, deduping by exact `at`); one file per flight, items `F-01`, `F-02`, … never renumbered; each item says what happened, why, and the workaround; the header names the plugin version and, once one exists, the release plan or spec that addressed it; a release plan gives every item a decision. Kūkulu names only; no other project's real name.

**Acceptance tests:** `test/plugin.mjs`: "pull-feedback never runs git commit", "...names .private-names", "...links CONTRIBUTING.md#flight-feedback, a tracked target", "CONTRIBUTING.md has a Flight feedback section"; the existing pull-feedback assertions still pass.

**Out of scope:** the label procedure (P2-01); editing `docs/feedback/` files.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-14: Phase 1 end: push and record the manual check

**Goal:** Push the branch with the friction fixes and record Phase 1's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1. No code change. Push if policies allow and `origin` exists. An empty commit (`git commit --allow-empty -F <file>`) carries the task.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): halt a throwaway flight with kukulu_run_halt, fix nothing, call kukulu_run_resume and confirm the refusal names the dirty tree; clean it and confirm the resume commit`.

**Depends on:** none

## Phase 2 — Private names

### P2-01: Private-project labels in pull-feedback and CONTRIBUTING

**Goal:** pull-feedback writes another project's feedback under a `project-<letter>` label and records the real name only in `docs/feedback/.private-names`.

**Files touched:** `skills/pull-feedback/SKILL.md`, `CONTRIBUTING.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 C-01.
- Step 3: this repository and cleanflate are written under their own names. Any other project gets the label `project-<letter>`: the next letter after the highest label in `docs/feedback/.private-names`, never earlier than `project-e` (a to d are taken). Append the line `<label> <real name>` to that file (create it with mode 0600) and write the real name nowhere else: not in the feedback file, a commit, a plan, a spec, a test name or the changelog. The destination is `docs/feedback/<date>-<label>.md`; inside it the project is only its label, and items are cited as `<label> F-nn`.
- CONTRIBUTING `## Flight feedback`: the file name is `<date>-<label>.md` (or the public name), and the label rule in one paragraph.

**Acceptance tests:** `test/plugin.mjs`: "pull-feedback assigns project-<letter> labels after the highest in .private-names", "...creates .private-names with mode 0600", "...writes the real name nowhere else", "CONTRIBUTING's Flight feedback names files by label".

**Out of scope:** the mechanical check (P2-02).

**Verification:** `kukulu_verify`.

**Depends on:** P1-13

### P2-02: check-names reads the private-name denylist

**Goal:** `scripts/check-names.mjs` fails on any private project name in a listed file outside `docs/feedback/`, without ever printing the name.

**Files touched:** `scripts/check-names.mjs`, `test/plugin.mjs`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-02, C-03; §3 principles 13, 18.
- When `<root>/docs/feedback/.private-names` exists: entries are its non-empty lines not starting with `#`; the label is the first word, the name everything after the first space, trimmed (an entry with no name is skipped). For every file it already lists (tracked, or untracked and not ignored; the walk when there is no `.git`) that is not under `docs/feedback/` or `test/fixtures/` (recorded history, Appendix D), fail on each case-insensitive whole-word occurrence (`\b` + the regex-escaped name + `\b`) with exactly `check-names: <file>:<line>: contains private project name #<n> (see docs/feedback/.private-names); replace it with its label`, n being the entry's 1-based index. The name never appears in any output.
- Without the file: print `check-names: private-name check skipped (no docs/feedback/.private-names)` and carry on; the exit status comes from the other rules.
- `scripts/lint.sh` is unchanged. CONTRIBUTING's Names section mentions the denylist check.

**Acceptance tests:** `test/plugin.mjs`, always in a temp root, never the maintainer's denylist: "a tracked file naming private project #2 fails check-names with file, line and #2", "...and no output contains the name", "the same name under docs/feedback/ passes", "without a denylist check-names prints the skipped line", "a private name is matched only as a whole word" (the name inside a longer word passes), "docs/feedback/.private-names is gitignored" (`git check-ignore` succeeds in ROOT).

**Out of scope:** the label procedure (P2-01).

**Verification:** `kukulu_verify`; `npm run lint` still passes on a checkout without the denylist.

**Depends on:** none

### P2-03: Phase 2 end: push and record the manual check

**Goal:** Push the branch with the private-name check and record Phase 2's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2. No code change. Push if policies allow and `origin` exists. An empty commit carries the task.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): create docs/feedback/.private-names with one real name on your machine and run npm run lint; it must fail without printing the name; delete the file and it must print the skipped line`.

**Depends on:** none

## Phase 3 — Clean-room isolation, provenance and gated stages

### P3-01: mcp/cleanroom.mjs: the policy loader, the template and the cleanroom suite

**Goal:** Create `mcp/cleanroom.mjs` with `loadPolicy` and `policyHash`, ship `templates/cleanroom.example.json`, and start the `cleanroom` test suite.

**Files touched:** `mcp/cleanroom.mjs`, `templates/cleanroom.example.json`, `test/cleanroom.mjs`, `test/run.mjs`, `CONTRIBUTING.md`

**Design constraints:**

- SPEC §4 (the `mcp/cleanroom.mjs` row and boundaries), §5.2 (every key), §6 D-01 bullets 1 and 3; §3 principles 4, 5, 12, 17. From now on constraints `server-synchronous`, `cleanroom-module-pure` and `one-hash-one-signature` apply to this file: synchronous, `node:` imports only, no `child_process`, `process.exit` or `console`.
- Exports `class CleanroomError extends Error` (the server maps it to `ToolError`; the hooks print its message).
- `loadPolicy(text) → policy`: refuses invalid JSON, a non-object, an unknown top-level key, `version` other than 1, and every bad shape in §5.2 with a message naming the key path (`deny.words[2] must be a non-empty string`): `deny.tools`, `deny.paths`, `deny.words`, `allow.paths`, `allow.urls`, `protected` arrays of non-empty strings; `deny.network` boolean; unknown keys inside `deny`, `allow`, `lockdown`; `pathPatterns` and `commandPatterns` entries `{ id, pattern, flags?, shouldMatch, shouldNotMatch }` with unique ids, a valid regex, at least one fixture of each kind and no unknown keys; every fixture self-tested on load, a disagreement refused as `policy deny.pathPatterns '<id>': shouldMatch "<line>" did not match` (or `shouldNotMatch "<line>" matched`); `lockdown.after` a task id (`/^[PR]\d+-\d+$/`). Returns the policy with defaults filled (`deny.network: true`, empty arrays).
- `policyHash(bytes) → hex`: SHA-256 of the file's bytes (a string is hashed as UTF-8).
- `templates/cleanroom.example.json` is §5.2's JSON, verbatim.
- `test/cleanroom.mjs` uses the harness's `ok`/`eq`/`like`/`finish`; register it in `test/run.mjs`'s `SUITES` as `["cleanroom", "clean-room mode: policy, guard, chain, checkpoints, gate, scoring"]`; CONTRIBUTING's suite table gains its row and the suite counts move from eleven to twelve.

**Acceptance tests:** `test/cleanroom.mjs`: "the example policy loads", "deny.network defaults to true", "policyHash is the SHA-256 of the bytes", and one refusal assertion each: "loadPolicy refuses invalid JSON", "...an unknown top-level key", "...version 2", "...deny.tools that is not an array", "...deny.network that is not a boolean", "...an unknown pathPatterns key", "...a duplicate pattern id", "...an invalid regex", "...a pattern without shouldNotMatch", "...a shouldMatch fixture that does not match, naming the line", "...lockdown.after that is not a task id", "...an unknown lockdown key".

**Out of scope:** `docs/kukulu.json` validation (P3-02); any server change.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-02: validateCleanroom in docs/kukulu.json

**Goal:** The server validates `docs/kukulu.json`'s `cleanroom` object and resolves the policy path and signing-key path.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `test/plugin.mjs`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.1 rows `cleanroom`, `cleanroom.policy`, `cleanroom.signingKey`; the paragraph after the table; CLAUDE.md "Adding a docs/kukulu.json key".
- `validateCleanroom(cleanroom)`: absent is fine; must be an object; known keys `policy` and `signingKey` (P4-01 adds `similarity`, P5-04 `idleGapHours`; until then they are unknown and refused); `policy` a non-empty repo-relative string (not absolute, no `~`, no `..` segment); `signingKey` a non-empty string. Called from `cfgFrom`.
- `cfgFrom` returns `cleanroom: { policy, signingKey }`: `policy` defaults to `docs/cleanroom.json`; `signingKey` is `KUKULU_CLEANROOM_KEY` when non-empty, else `cleanroom.signingKey`, else `~/.config/kukulu/cleanroom/ed25519.pem`, a leading `~` expanded to the home directory, returned absolute. Clean-room mode is on when the file at `path.join(ROOT, cc.cleanroom.policy)` exists; there is no flag.
- `docs/operations.md`: rows for `cleanroom`, `cleanroom.policy`, `cleanroom.signingKey`; the environment table gains `KUKULU_CLEANROOM_KEY`. `test/plugin.mjs`'s config-keys loop gains a `cleanroom` branch checking those three are documented.

**Acceptance tests:** `test/cleanroom.mjs` (through `kukulu_status` on a planned repo): "cleanroom.policy must be repo-relative" (absolute and `../x` refused), "cleanroom has an unknown key", "cleanroom.signingKey must be a string", "a valid cleanroom block is accepted"; `test/plugin.mjs`: "operations.md documents cleanroom.policy and cleanroom.signingKey".

**Out of scope:** reading the policy file (P3-07); `similarity` and `idleGapHours`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-03: Hook registration and the no-policy fast path

**Goal:** Register the guard on PreToolUse and the logger on PostToolUse and UserPromptSubmit, and make both exit at once, silently, in a project with no policy.

**Files touched:** `hooks/hooks.json`, `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs`, `scripts/lint.sh`, `test/plugin.mjs`, `test/cleanroom.mjs`, `test/harness.mjs`

**Design constraints:**

- SPEC §6 D-02; §4 boundaries; §5.3 hook budget (50 ms ⚠️ ASSUMPTION, a test bound only).
- `hooks/hooks.json` adds `PreToolUse` → `"${CLAUDE_PLUGIN_ROOT}"/scripts/cleanroom-guard.mjs`, and `PostToolUse` and `UserPromptSubmit` → `"${CLAUDE_PLUGIN_ROOT}"/scripts/cleanroom-log.mjs`, each with no matcher; Stop and SubagentStop stay.
- Both scripts start with `#!/usr/bin/env node`, are executable (mode 755 in git), read stdin JSON (empty or invalid input is tolerated), take the project from `CLAUDE_PROJECT_DIR`, else the input's `cwd`, else `process.cwd()`, read `docs/kukulu.json`'s `cleanroom.policy` (default `docs/cleanroom.json`; an unparseable config means the default) and, when that file does not exist, exit 0 with no output before importing anything beyond `node:` built-ins. `mcp/cleanroom.mjs` is loaded later with `await import()` relative to the script's own directory (constraint `hooks-lazy-cleanroom`).
- With a policy present, until P3-11 and P3-12 replace it: the guard writes `kukulu clean-room guard: guard internal error: the guard is not implemented yet` to stderr and exits 2; the logger exits 0. A comment names P3-11/P3-12.
- `scripts/lint.sh`'s executable-bit loop gains both scripts. `test/harness.mjs` gains `runHook(script, payload, env)` (spawns `node <script>` with the payload as stdin; returns `{ status, stdout, stderr, ms }`).

**Acceptance tests:** `test/plugin.mjs`: "hooks.json wires Stop, SubagentStop, PreToolUse, PostToolUse and UserPromptSubmit", "PreToolUse runs the clean-room guard with no matcher", "PostToolUse and UserPromptSubmit run the clean-room logger", "both clean-room hook scripts are executable with a shebang"; `test/cleanroom.mjs`: "with no policy the guard exits 0 with no output", "...the logger exits 0 with no output", "...and neither creates .kukulu/cleanroom/", "the fast path does not load mcp/cleanroom.mjs" (a temp plugin copy whose `mcp/cleanroom.mjs` throws on import), "the fast path costs under 50 ms beyond Node's own startup" (median of 10 runs minus the median of 10 runs of `node -e 0`; the number 50 appears only in this test), "with a policy present the guard denies until it is implemented".

**Out of scope:** evaluating or logging anything (P3-11, P3-12).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-04: The hash chain

**Goal:** `mcp/cleanroom.mjs` canonicalizes, hashes, appends and verifies log entries, with a directory lock so concurrent writers cannot fork the chain.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `docs/operations.md`

**Design constraints:**

- SPEC §6 D-05 (the table, `canonical`, `appendEntry`, `verifyChain`); §5.3 `TARGET_MAX` (4,000 ⚠️ ASSUMPTION); §3 principle 12.
- Exports: `ENTRY_KEYS` (`seq`, `prev`, `at`, `kind`, `stage`, `task`, `role`, `model`, `session`, `tool`, `target`, `decision`, `reason`), `KINDS` (the nine kinds), `ZERO_HASH` (64 zeros), `TARGET_MAX` written exactly `export const TARGET_MAX = 4000;` under a `// ⚠️ ASSUMPTION` comment (constraint `no-hardcoded-target-max`), `truncateTarget(s)`.
- `canonical(entry)`: `JSON.stringify` of an object built with `ENTRY_KEYS` in order, then `data` when present, and nothing else; an unknown field is a `CleanroomError`. `entryHash(prev, entry)` = SHA-256 hex of `prev + "\n" + canonical(entry)`.
- `appendEntry(logPath, fields) → entry`: create the parent directory; take the lock `mkdirSync(logPath + ".lock")`, retrying every 10 ms (a synchronous sleep with `Atomics.wait`) for up to 2000 ms, then throw a `CleanroomError` naming the lock; read the last non-empty line for `prev` and `seq`; fill `at` (`new Date().toISOString()`) and every missing field with `null`; write one line through a file opened with the append flag; release the lock in `finally`.
- `readEntries(logPath)` → parsed entries (an absent file is `[]`). `verifyChain(lines) → { ok, entries, tip, firstBad }`: every line parses, its keys are exactly `ENTRY_KEYS` (+ `data`) + `hash` in order, `seq` is dense from 1, `prev` links (seq 1 has `ZERO_HASH`), and every hash recomputes; `firstBad` is `{ line, seq, reason }`.
- `logPathFor(root, env)` → `env.KUKULU_CLEANROOM_LOG` when set, else `<root>/.kukulu/cleanroom/log.jsonl`. `docs/operations.md`'s environment table gains `KUKULU_CLEANROOM_LOG` (tests and the guard self-test only).

**Acceptance tests:** `test/cleanroom.mjs`: "appendEntry writes seq 1 with a 64-zero prev", "...links the second entry to the first", "canonical orders the keys and refuses an unknown field", "verifyChain accepts an intact chain", "...names a tampered middle line", "...a reordered line", "...a dropped line", "two processes appending 50 entries each leave one dense chain" (two concurrent child processes), "appendEntry gives up on a lock held over two seconds", "targets are truncated to TARGET_MAX".

**Out of scope:** what fills the fields (P3-05); the key and checkpoints (P3-06).

**Verification:** `kukulu_verify`.

**Depends on:** P3-01

### P3-05: Entry fields from a hook payload

**Goal:** `mcp/cleanroom.mjs` derives an entry's `stage`, `task`, `role`, `model`, `session`, `tool` and `target` from a hook payload and the project's files.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`

**Design constraints:**

- SPEC §6 D-05's table rows `stage` to `target`. cleanflate's `tools/cleanroom/log.py` (`target_of`) at the sibling checkout is the reference (CLAUDE.md flight notes say how to read it); port the behavior, not the code.
- `targetOf(toolName, toolInput)`: the file path for `Read`, `Write`, `Edit`, `MultiEdit` (`file_path`) and `NotebookEdit` (`notebook_path`); `path=<p> glob=<g> pattern=<x>` for `Grep` and `path=<p> pattern=<x>` for `Glob` (missing parts omitted); the URL for `WebFetch`; the query for `WebSearch`; the command for `Bash`; `<subagent_type>: <description>` for `Agent` and `Task`; otherwise `<tool_name> <JSON of tool_input>`. Always through `truncateTarget`.
- `projectContext(root)` reads (never writes) `docs/PROGRESS.md`, `.kukulu/implement.lock` and `.kukulu/state.json`, each `null` when absent or unreadable.
- `entryFields(hookInput, context)`: `role` = `agent_type` verbatim, else `session`; `stage` from `agent_type` (planner → `plan`, implementer → `implement`, or `fix` when `state.round ≥ 1`, reviewer → `review`, summarizer → `summarize`), else, with a lock present, `implement`/`fix` by the lock's round, else `null`; `task` = the first `[~]` id in PROGRESS.md, else `null`; `model` = the payload's `model` or `null`; `session` = `session_id` or `null`; `tool` = `tool_name` or `null`; `target` = `targetOf(...)`.

**Acceptance tests:** `test/cleanroom.mjs`: "targetOf: Read is the file path", "...Grep is path, glob and pattern", "...Bash is the command", "...Agent is subagent_type: description", "...an MCP tool is its name and arguments", "entryFields: an implementer in round 0 is implement", "...in round 1 is fix", "...a reviewer is review", "...the main session has role session", "...the task is the first in-progress task", "...model and session come from the payload".

**Out of scope:** any hook script.

**Verification:** `kukulu_verify`.

**Depends on:** P3-04

### P3-06: The signing key and checkpoint primitives

**Goal:** `mcp/cleanroom.mjs` generates and loads the Ed25519 key, fingerprints it, and signs and verifies checkpoint data.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`

**Design constraints:**

- SPEC §6 D-06 "Key" and "Checkpoint"; §9 Q4; §3 principle 12; CLAUDE.md "Clean-room tests" (keys only in temp directories; no PEM in any committed file).
- `generateKey(keyPath)`: refuse when it exists; create the parent directory (mode 0700); `generateKeyPairSync("ed25519")`; write the private key as PKCS#8 PEM with mode 0600 and `<keyPath>.pub` as SPKI PEM. `loadKey(keyPath) → { privateKey, publicKey, fingerprint }`, refusing an unreadable or non-Ed25519 key, naming the path. `keyFingerprint(publicKey)` = `sha256:` + hex of SHA-256 over the public key's SPKI DER.
- `CHECKPOINT_KEYS` = `chainTip`, `git`, `policyHash`, `guardHash`, `loggerHash`, `hooksHash`, `keyFingerprint`, `event`. `signCheckpoint(data, privateKey)` returns `{ ...data, signature }`, the signature being base64 of `crypto.sign(null, bytes, privateKey)` over `JSON.stringify` of `data` rebuilt in `CHECKPOINT_KEYS` order. `verifyCheckpoint(entry, publicKey) → boolean`: `kind` is `checkpoint` and the signature verifies over the same bytes.

**Acceptance tests:** `test/cleanroom.mjs`: "generateKey writes a 0600 private key and a .pub", "generateKey refuses an existing key", "keyFingerprint is sha256: over the public DER", "loadKey refuses a non-Ed25519 key", "a signed checkpoint verifies", "...fails with another key", "...fails after a field changes".

**Out of scope:** where the key lives and when it is generated (P3-07).

**Verification:** `kukulu_verify`.

**Depends on:** P3-04

### P3-07: Genesis and sticky mode

**Goal:** The first `kukulu_next` in a project with a policy writes the genesis entry and records the hashes, and any later change of mode halts the flight.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `test/harness.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-06 "Genesis", "Mode is sticky" and the key bullet's `kukulu_run_start` sentence; §3 principles 3, 17.
- The server imports `./cleanroom.mjs`. Helpers: the policy file (from `cc.cleanroom.policy`), the log (`logPathFor(ROOT, process.env)`), `pluginHashes()` = SHA-256 of `PLUGIN_ROOT`'s `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs` and `hooks/hooks.json`, and `ensureKey(cc)` = `loadKey`, generating first when the key file is absent.
- In `next()`, after the missing-spec check: (a) policy present, no `state.cleanroom` and no `docs/PLAN.md` → genesis: `ensureKey`; append `{ kind: "genesis", stage: "controller", data: { mode: "clean-room", policyHash, guardHash, loggerHash, hooksHash, pluginVersion: VERSION, keyFingerprint, baseBranch, head } }`; set `state.cleanroom = { genesis: <entry hash>, policyHash, guardHash, loggerHash, hooksHash }`; commit state and log as `chore: clean-room genesis` inside `withRollback`; then continue the decision table. (b) policy present with `state.cleanroom.mode === "general"`, or with no `state.cleanroom` while `docs/PLAN.md` exists, or (c) no policy while `state.cleanroom.genesis` is set → stage `halt` with `clean-room coverage is broken: the mode changed after genesis (<which case>); archive this flight with kukulu_flight_archive and start another`. The halt is computed each call, never stored.
- `kukulu_run_start`: with no policy and no `state.cleanroom`, set `state.cleanroom = { mode: "general" }` in the state it already commits; in clean-room mode call `ensureKey`. `kukulu_run_resume` refuses while (b) or (c) holds, with the same text.
- `test/harness.mjs`'s `startServer` sets `KUKULU_CLEANROOM_KEY` to a per-repo temp path unless the caller passes one; add `cleanroomRepo(opts)` (a planned or spec-only repo with `docs/cleanroom.json` from the template, committed).
- `docs/mcp-tools.md`: genesis and the sticky halt under `kukulu_next`; the key under `kukulu_run_start`.

**Acceptance tests:** `test/cleanroom.mjs`: "the first kukulu_next with a policy appends a genesis entry", "...whose data names mode, the four hashes, pluginVersion, keyFingerprint, baseBranch and head", "...records state.cleanroom", "...commits chore: clean-room genesis with the log and state", "...generates the key at KUKULU_CLEANROOM_KEY", "KUKULU_CLEANROOM_KEY wins over cleanroom.signingKey", "a project without a policy writes no log at kukulu_next", "kukulu_run_start records mode general without a policy", "a policy that appears after run_start halts with the mode-change reason", "a policy first seen after the plan exists halts", "a policy removed after genesis halts", "kukulu_run_resume refuses a mode-change halt and says to archive".

**Out of scope:** checkpoints (P3-08); the gate (P3-16).

**Verification:** `kukulu_verify`.

**Depends on:** P3-02, P3-04, P3-06, P1-02

### P3-08: Checkpoints from the tools, and the log in their commits

**Goal:** Each tool SPEC names appends a signed checkpoint in clean-room mode and commits the log with its own files, and every dirty-tree check tolerates the log.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `docs/mcp-tools.md`, `docs/operations.md`

**Design constraints:**

- SPEC §6 D-06 "Checkpoint" (the writers and the clean-tree sentence); §3 principle 3.
- `checkpoint(event, stage)` in clean-room mode (`state.cleanroom.genesis` set): `loadKey`; data `{ chainTip: <last entry's hash>, git: <full HEAD sha>, policyHash (of the current file), guardHash, loggerHash, hooksHash (current), keyFingerprint, event }`, signed with `signCheckpoint`, appended as kind `checkpoint`. Written by `kukulu_run_start` (event `run-start`), `kukulu_task_done`, `kukulu_task_block`, `kukulu_run_finish`, `kukulu_review_submit`, `kukulu_summary_commit` and `kukulu_flight_archive` (event = the tool's name), each before its final commit, with the log among the paths it commits and rolls back. General mode writes no checkpoint.
- Every dirty-tree check ignores `.kukulu/cleanroom/log.jsonl` as `kukulu_task_done` ignores `PROGRESS.md`: `kukulu_task_done`, `kukulu_run_finish`, `kukulu_flight_archive`, `kukulu_pr_finalize({ resign })`, `kukulu_run_resume`, and `kukulu_run_start`'s tracked-dirty check on the base branch. `kukulu_mutate`'s residue restore never touches it.
- `kukulu_flight_archive`, after its checkpoint, moves `.kukulu/cleanroom/log.jsonl` (and `similarity.json`, when present) into `docs/flights/<slug>/cleanroom/`, so a next flight's genesis starts at seq 1.
- `docs/mcp-tools.md` notes the checkpoint on each writer; `docs/operations.md` notes the archive's `cleanroom/` directory.

**Acceptance tests:** `test/cleanroom.mjs`: "kukulu_run_start appends a run-start checkpoint and commits the log", "kukulu_task_done appends a kukulu_task_done checkpoint", and the same for task_block, run_finish, review_submit, summary_commit and flight_archive, "every checkpoint verifies with the public key", "kukulu_task_done tolerates an uncommitted log append", "kukulu_run_finish tolerates it", "a failed progress commit restores the log byte for byte" (commit-failure protocol, `progress:`), "the archive moves the log into docs/flights/<slug>/cleanroom/", "general mode writes no checkpoint".

**Out of scope:** `kukulu_similarity` and `kukulu_attest` checkpoints (P4-07, P5-06).

**Verification:** `kukulu_verify`.

**Depends on:** P3-07

### P3-09: Path canonicalization and the Bash splitter

**Goal:** `mcp/cleanroom.mjs` splits a Bash command into top-level segments, finds each segment's command word, and canonicalizes every path the guard checks.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`

**Design constraints:**

- SPEC §6 D-03 "Canonicalization". cleanflate's `tools/cleanroom/guard.py` at the sibling checkout is the reference for the splitter's quote and escape handling.
- `splitSegments(command) → [string]`: splits on unquoted `;`, `&&`, `||`, `|`, `&` and newlines; single quotes are literal, double quotes honour backslash escapes, a backslash outside quotes escapes the next character. `shellWords(segment) → [token]` with quotes removed. `commandWord(tokens) → { word, args }`: skips leading `NAME=value` assignments and the wrappers `sudo`, `env`, `time`, `command`, `xargs`, `nice` together with their flags (`nice -n <value>` included).
- `isPathLike(token)`: contains `/` or starts with `~` or `.`, and is not a URL (`^[a-z][a-z0-9+.-]*://`); for `--opt=value` judge the value.
- `canonicalPaths(p, { cwd, home }) → [normalized, real?]`: `~` and `~/` expand to `home`; relative paths resolve against `cwd`; `path.normalize`; plus `fs.realpathSync.native` when the path exists and differs. Both forms are checked by every rule.

**Acceptance tests:** `test/cleanroom.mjs`: "splitSegments splits on ; && || | & and newlines", "...keeps a quoted |", "...handles escaped quotes", "commandWord skips assignments and wrappers with their flags", "isPathLike ignores URLs", "canonicalPaths expands ~", "...resolves relative to cwd", "...adds the real path through a symlinked repo".

**Out of scope:** the rules (P3-10).

**Verification:** `kukulu_verify`.

**Depends on:** P3-01

### P3-10: evaluate: the guard's rules

**Goal:** `evaluate(policy, hookInput, env)` implements D-03's seven rules and lockdown, proven on a fixture file that includes cleanflate's real false positives and its one real prior-art attempt.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `test/fixtures/guard-cases.json`

**Design constraints:**

- SPEC §6 D-03 rules 1–7, the lockdown paragraph and the known gaps; §5.2's `deny.network` list.
- Constants: `NETWORK_COMMANDS` (`curl`, `wget`, `gh`, `ssh`, `scp`, `nc`, `git clone`, `git fetch`, `git pull`, `pip download`, `cargo vendor`, `cargo download`, `npm install`, `npm i`, `npm ci`, `go get`, `composer install`), `READ_FAMILY` and `WRITE_FAMILY` exactly as D-03 lists them.
- `lockdownActive(policy, progressText)`: false without `lockdown.after` or without a PROGRESS text; true when that task is `[x]` or the text has no `[ ]`/`[~]` task.
- `evaluate(policy, hookInput, env) → { decision, reason }`, env `{ root, home, progressText, protected }` (`protected`: absolute prefixes; until P3-14 it is `policy.protected` resolved against `root`). First match denies, in D-03's order. Reasons: `tool <name> is denied by deny.tools`; `network access is denied (WebSearch)`; `WebFetch is denied: lockdown is active`; `WebFetch is denied: <url> is not in allow.urls`; `protected path: <path>`; `denied path: <path> (deny.paths)`; `denied path: <path> (pathPatterns <id>)`; `forbidden word in path argument: <token>`; `forbidden word in command outside the repository: <token>`; `network command <word> is denied`; `commandPatterns <id>`. "Inside the repository" means under `root` in either canonical form.
- `test/fixtures/guard-cases.json`: an array of `{ name, policy ("template" or an inline policy), input (a hook payload with `tool_name`, `tool_input`, `cwd`), progress?, expect: "allowed" | "denied", reason? (a regex source) }`, with `__ROOT__` and `__HOME__` substituted at run time. It covers every rule in both decisions, lockdown on and off, an interpreter escape documented as allowed, the eight cleanflate false positives as `allowed` and the real attempt as `denied` (reason `forbidden word in path argument`). Take the eight from `provenance/tool-log.snapshot.jsonl` at the sibling checkout's `85f2100` by ts: `2026-09-30T14:40:33.544Z`, `2026-09-30T16:11:51.801Z`, `2026-09-30T16:11:56.220Z`, `2026-09-30T17:00:19.952Z`, `2026-09-30T17:21:39.475Z`, `2026-09-30T17:23:20.004Z`, `2026-09-30T18:13:45.842Z`, `2026-09-30T20:53:01.396Z`; the attempt is `2026-09-29T14:54:47.458Z`. Replace `/media/ericmann/Data/Projects/cleanflate` with `__ROOT__` and the session scratchpad path with `__ROOT__/target/scratch`. If one of the eight is denied by the template policy, keep the case with its actual decision, name the rule in the task log, and do not change the rules to fit it.
- Recorded commands stay in this JSON file, never inline in `test/cleanroom.mjs`.

**Acceptance tests:** `test/cleanroom.mjs` runs every case of `test/fixtures/guard-cases.json` through `evaluate`, one assertion per case named `guard case: <name>`; plus "lockdownActive is false before the lockdown task", "...true once it is done", "...true when no task is open", "...false without a PROGRESS.md", "NETWORK_COMMANDS is the fixed list".

**Out of scope:** the hook script (P3-11); the always-protected set (P3-14).

**Verification:** `kukulu_verify`.

**Depends on:** P3-09

### P3-11: The guard hook and its self-test

**Goal:** `scripts/cleanroom-guard.mjs` evaluates every call against the policy, logs and blocks a denial, fails closed on any exception, and runs a fixture self-test.

**Files touched:** `scripts/cleanroom-guard.mjs`, `test/cleanroom.mjs`

**Design constraints:**

- SPEC §6 D-03's first paragraph and its self-test paragraph; §3 principle 11.
- After the P3-03 fast path: import `../mcp/cleanroom.mjs`, `loadPolicy`, build env (root, home, PROGRESS text, `protected`), `evaluate`. On `denied`: `appendEntry` a `denied` entry from `entryFields` with `decision: "denied"` and the reason, write `kukulu clean-room guard: <reason>` to stderr, exit 2. On `allowed`: exit 0 silently, no log (the logger logs it). Any exception anywhere (a bad payload, an unloadable policy, a throw in `evaluate`) is a denial with reason `guard internal error: <message>`, logged if the log can be written; the script never exits 0 from an error path.
- `--self-test <policy>`: set `KUKULU_CLEANROOM_LOG` to a temp file first; load `<policy>` (its own `pathPatterns`/`commandPatterns` fixtures self-test there); run every case of the plugin's `test/fixtures/guard-cases.json` (`template` resolves to the plugin's `templates/cleanroom.example.json`) plus one case per fixture line of the given policy's patterns (a `pathPatterns` `shouldMatch` line as a `Read` of that path must be denied by that pattern; a `commandPatterns` one as a `Bash` command; `shouldNotMatch` lines must not be denied by that pattern). Print `guard self-test: ok (<n> cases)` or one line per failure, and exit non-zero on any failure. It never writes the project's log.
- The `extraVerify` self-test command in `docs/kukulu.json` has `from: P3-11` and becomes active with this task.
- Replace P3-03's "with a policy present the guard denies until it is implemented" test.

**Acceptance tests:** `test/cleanroom.mjs`: "a denied Read exits 2 with the reason on stderr", "...and appends a denied entry with the payload's fields", "an allowed call exits 0 silently and logs nothing", "a malformed policy is a denial with guard internal error", "an exception in evaluate is a denial, never exit 0" (a temp plugin copy whose `evaluate` throws), "--self-test on the template prints guard self-test: ok", "--self-test fails on a policy whose own fixture disagrees", "--self-test never writes .kukulu/cleanroom/log.jsonl".

**Out of scope:** the logger (P3-12); protected paths (P3-14).

**Verification:** `kukulu_verify` (now including `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json`).

**Depends on:** P3-10, P3-05, P3-03

### P3-12: The logger hook

**Goal:** `scripts/cleanroom-log.mjs` appends one `allowed` entry for every tool call that reached PostToolUse, and never fails the call.

**Files touched:** `scripts/cleanroom-log.mjs`, `test/cleanroom.mjs`

**Design constraints:**

- SPEC §6 D-04.
- After the fast path: on `hook_event_name` `PostToolUse`, `appendEntry` `{ kind: "allowed", decision: "allowed", reason: null, ...entryFields(payload, projectContext(root)) }`. `UserPromptSubmit` exits 0 without logging until P3-18.
- Always exit 0. On its own failure, append `{ kind: "allowed", tool: "unknown", decision: null, reason: "logger-error: <message>" }` where it can, else write one line to stderr.

**Acceptance tests:** `test/cleanroom.mjs`: "PostToolUse appends one allowed entry per call", "...with stage, task, role, model, session and target", "the chain stays valid across guard and logger appends", "a logger failure appends a logger-error entry and exits 0" (an unparseable payload), "...prints one stderr line and exits 0 when the log cannot be written".

**Out of scope:** human entries (P3-18).

**Verification:** `kukulu_verify`.

**Depends on:** P3-05, P3-03

### P3-13: Tune the hook fast path and TARGET_MAX

**Goal:** Measure the hooks' fast-path cost against its 50 ms budget and real target lengths against `TARGET_MAX`, and record whether both defaults hold.

**Files touched:** `docs/spikes/P3-13.md`

**Design constraints:**

- SPEC §5.3 (hook budget 50 ms ⚠️ ASSUMPTION; `TARGET_MAX` 4,000 ⚠️ ASSUMPTION); follow "Tuning an assumption" in CLAUDE.md.
- Fast path: median, p90 and maximum over at least 30 runs of each hook in a project with no policy, minus `node -e 0`'s median; also the full (policy present) path's median, for information. Before = 50 ms; after = the measured overhead and the headroom.
- `TARGET_MAX`: the distribution of `target` lengths in cleanflate's `provenance/tool-log.snapshot.jsonl` at `85f2100` (CLAUDE.md flight notes): maximum, p99, and how many exceed 4,000. Before = 4,000; after = the measurement.
- Neither value changes in this task; a negative headroom is recorded for the human.

**Acceptance tests:** none new; `docs/spikes/P3-13.md` exists, is markdownlint-clean and holds both measurements and the method.

**Out of scope:** changing either value or the test bound.

**Verification:** `kukulu_verify`; the commit body has a `Measurement:` line for each assumption.

**Depends on:** P3-11, P3-12

### P3-14: Self-protection: the always-protected set

**Goal:** The guard protects the policy, the log, the state, the config, the settings, the hooks, the plugin, the signing key and git's own hooks from every write tool and write-family Bash form, and denies reads of the key.

**Files touched:** `mcp/cleanroom.mjs`, `scripts/cleanroom-guard.mjs`, `test/cleanroom.mjs`, `test/fixtures/guard-cases.json`

**Design constraints:**

- SPEC §6 D-10; rules 4, 5 and 6 of D-03.
- `protectedPaths(policy, env) → [absolute prefix]`, env `{ root, home, policyPath, pluginRoot, keyPath, planExists }`: the policy file; `<root>/.kukulu/cleanroom/`; `<root>/.kukulu/state.json`; `<root>/docs/kukulu.json` once `planExists` (the planner writes it in the plan stage, after genesis); `<root>/.claude/settings.json`, `<root>/.claude/settings.local.json`, `<root>/.claude/hooks/`; `<root>/.mcp.json`; `pluginRoot` and `<home>/.claude/plugins/`; `<home>/.claude/settings.json`; `keyPath` and `<keyPath>.pub`; `<root>/.git/hooks/`, `<root>/.git/config`, `<root>/.git/info/`; then `policy.protected`.
- Reads of the policy, the settings and `.mcp.json` stay allowed; a read of `keyPath` is denied as a `deny.paths` entry.
- The guard computes `keyPath` as the server does (`KUKULU_CLEANROOM_KEY`, else `cleanroom.signingKey` from `docs/kukulu.json`, else `~/.config/kukulu/cleanroom/ed25519.pem`), `pluginRoot` from `CLAUDE_PLUGIN_ROOT` else its own `..`, and `planExists` from `docs/PLAN.md`.
- Every Bash case (redirections, `cp`, `tee -a`, an in-place `sed`, `git config core.hooksPath`, `rm -rf .git/hooks`) is a case in `test/fixtures/guard-cases.json`.

**Acceptance tests:** `test/cleanroom.mjs`: "protectedPaths lists the always-protected set", one `guard case:` per write tool (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) against each protected category, per Bash form above, "reading docs/cleanroom.json is allowed", "reading .mcp.json is allowed", "reading the signing key is denied", "docs/kukulu.json is writable before docs/PLAN.md exists and protected after".

**Out of scope:** the gate (P3-16).

**Verification:** `kukulu_verify` (the guard self-test included).

**Depends on:** P3-10, P3-11

### P3-15: Clean-room commit trailers

**Goal:** Every commit the server makes in clean-room mode carries `Kukulu-Stage` and `Kukulu-Task` trailers, added by the commit helper.

**Files touched:** `mcp/server.mjs`, `skills/implement/SKILL.md`, `test/cleanroom.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 D-07.
- `commitStaged(rels, message, { stage, task })`: in clean-room mode append to the message a blank line and the trailers `Kukulu-Stage: <stage>` and `Kukulu-Task: <task or ->`, on the first commit and on the unsigned retry. Every caller passes a stage: `plan` (plan_commit), `implement` or `fix` by round (run_start, task_*, run_finish, stream tools), `review` (review_submit and the mutation-recovery commit), `summarize` (summary_commit, flight_archive, pr_finalize, later similarity and attest), `controller` (flight_options, run_halt, run_resume, feedback_log from the controller, next's genesis and serial-wave records, later cleanroom_record). The task is the id for task_done, task_block and task_reopen, else the first `[~]` task, else `-`.
- implement skill: in clean-room mode the commit template ends with `Kukulu-Stage: <implement or fix>` and `Kukulu-Task: <ID>` trailer lines.

**Acceptance tests:** `test/cleanroom.mjs`: "every server commit in clean-room mode carries the stage and task trailers" (a short flight; reads `git log --format=%(trailers:key=Kukulu-Stage,valueonly)` per server commit), "task_done's progress commit names its task", "general mode adds no trailers", "the trailers survive the unsigned retry" (failing-signer protocol in CLAUDE.md).

**Out of scope:** reading trailers (P5-04, P5-06).

**Verification:** `kukulu_verify`.

**Depends on:** P3-07

### P3-16: The gate: checks 1 to 6

**Goal:** In clean-room mode, `kukulu_next` and the stage-starting tools run a gate that verifies mode, policy, guard, self-test, lockdown and chain before anything proceeds, and log its result.

**Files touched:** `mcp/server.mjs`, `skills/go-flight/SKILL.md`, `test/cleanroom.mjs`, `test/harness.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 D-08 checks 1–6 and the paragraph after them. The gate's own `gate` entry before a refusal is the one sanctioned write-before-refuse (CLAUDE.md Constraints).
- `gate(stage)` runs inside `kukulu_next` whenever `state.cleanroom.genesis` is set (after genesis handling, before the decision table) and inside `kukulu_run_start`, `kukulu_task_next` (serial and stream), `kukulu_review_submit` and `kukulu_summary_commit` before any write. Checks in order, the first failure stopping: (1) mode: the policy file exists and `state.cleanroom.mode` is not `general`; (2) policy: `policyHash` of the file equals `state.cleanroom.policyHash`; (3) guard: the SHA-256 of `PLUGIN_ROOT`'s two hook scripts and `hooks/hooks.json` equal the recorded ones, and `hooks.json` still registers the guard on PreToolUse and the logger on PostToolUse and UserPromptSubmit; (4) self-test: `node <PLUGIN_ROOT>/scripts/cleanroom-guard.mjs --self-test <policy>` through `runShell` with a 60 000 ms bound exits 0; (5) lockdown: when `lockdown.after` is set and that task is `[x]`, `evaluate` of a `WebFetch` probe for `allow.urls[0]` is denied (passes trivially with no URL); (6) chain: `verifyChain` over the whole log is ok and the newest `checkpoint` entry verifies with the public key (passes with none yet).
- Pass: append `{ kind: "gate", stage, data: { checks: <number checked>, ok: true } }`. Fail: append `{ kind: "gate", data: { failed: "<check>", reason } }`, then `kukulu_next` returns stage `halt` with `clean-room gate failed: <check>: <reason>` and a tool throws a `ToolError` with the same text. Not committed by the gate.
- `kukulu_next`'s result gains `gate: { ok, checked: [names] }` (`null` in general mode). go-flight prints `gate: ok (<n> checks)` or the halt.
- `test/harness.mjs` gains `tempPlugin()` (copies `mcp/`, `scripts/`, `hooks/`, `templates/`, `agents/`, `skills/`, `test/fixtures/`, `package.json` to a temp directory and returns its path).

**Acceptance tests:** `test/cleanroom.mjs`: "the gate passes on an intact clean-room project and kukulu_next reports it", "a passing gate appends a gate entry", "an edited policy halts kukulu_next naming policy", "an edited guard under a temp PLUGIN_ROOT halts naming guard", "hooks.json without the PreToolUse registration halts naming guard", "a failing self-test halts naming self-test", "a lockdown that does not deny halts naming lockdown" (temp plugin whose `lockdownActive` returns false), "a tampered chain halts naming chain", "a checkpoint signed by another key halts naming chain", "a failing gate appends a gate entry with failed and reason", "kukulu_task_next refuses when the gate fails", "kukulu_run_start, kukulu_review_submit and kukulu_summary_commit refuse likewise", and in `test/plugin.mjs` "go-flight prints the gate line".

**Out of scope:** liveness (P3-17).

**Verification:** `kukulu_verify`.

**Depends on:** P3-08, P3-11

### P3-17: Gate liveness

**Goal:** The gate's seventh check proves the hooks are recording: between two gates at least one `allowed` entry must exist.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `test/harness.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 D-08 check 7 and D-08a.
- Check 7: when a `gate` entry already exists, at least one `allowed` entry must come after the newest one; otherwise fail with exactly "no tool call has been logged since the last gate; the clean-room hooks are not running in this session. Start a new session." The first gate needs nothing. A passing gate now records `checks: 7`.
- `test/harness.mjs` gains `logCall(repo, payload?)`, which runs the logger hook once (CLAUDE.md "Clean-room tests"); P3-16's tests that call `kukulu_next` twice log a call between them.

**Acceptance tests:** `test/cleanroom.mjs`: "two gates with no allowed entry between them halt with the liveness message", "an allowed entry between gates passes", "the first gate needs no allowed entry", "a passing gate records seven checks".

**Out of scope:** coverage gaps (P5-04).

**Verification:** `kukulu_verify`.

**Depends on:** P3-16

### P3-18: Human entries and kukulu_cleanroom_record

**Goal:** Every prompt typed in the project, every operator record and the human-initiated tools land in the chain as `human` entries.

**Files touched:** `mcp/server.mjs`, `scripts/cleanroom-log.mjs`, `skills/go-flight/SKILL.md`, `test/cleanroom.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-09; §9 Q7. Follow "Adding a tool" in CLAUDE.md: `kukulu_cleanroom_record` goes after `kukulu_flight_options`, on go-flight's `allowed-tools` in both spellings, on no agent.
- The logger, on `UserPromptSubmit`: `appendEntry` `{ kind: "human", role: "operator", target: truncateTarget(prompt), tool: null, decision: null }` with the payload's session and model.
- `kukulu_cleanroom_record({ text, kind? })`: refused outside clean-room mode; `kind` is `instruction` (default), `intervention` or `verdict`; a verdict's text must match `/^#(\d+): (prior-art attempt|false positive|offline test) — .+/` and its seq must name a `denied` entry, else refused. Appends `{ kind: "human", stage: "controller", role: "operator", target: text, data: { kind } }` and commits the log as `chore: clean-room record`; returns `{ recorded: true, seq, kind, commit }`.
- In clean-room mode, `kukulu_flight_options`, `kukulu_run_resume` and `kukulu_pr_finalize({ resign: true })` each append `{ kind: "human", stage: "controller", role: "operator", target: <JSON of the arguments>, data: { kind: "instruction", via: "<tool>" } }` in the commit they make.
- go-flight maps "record: <text>" to kind `instruction`, "record intervention: <text>" to `intervention`, and "record verdict: <text>" to `verdict`, calling the tool once and printing the result.

**Acceptance tests:** `test/cleanroom.mjs`: "UserPromptSubmit appends a human entry with role operator and the prompt", "kukulu_cleanroom_record records an instruction by default", "...an intervention", "...a verdict naming a denied seq", "...refuses a malformed verdict", "...refuses a verdict whose seq is not a denial", "...refuses outside clean-room mode", "...commits chore: clean-room record", "kukulu_flight_options appends a human entry", "kukulu_run_resume appends a human entry"; the resign path's human entry is asserted where the existing resign test's signer setup can be reused; `test/protocol.mjs` and `test/plugin.mjs`: the tool list and counts, "go-flight maps record: to kukulu_cleanroom_record".

**Out of scope:** counting verdicts (P5-06).

**Verification:** `kukulu_verify`.

**Depends on:** P3-12, P3-08, P1-02

### P3-19: Clean-room status, prompts, skills and docs/cleanroom.md

**Goal:** `kukulu_status.cleanroom` reports the mode's whole state, the stage prompts and skills say what the mode means for each role, and `docs/cleanroom.md` documents it.

**Files touched:** `mcp/server.mjs`, `skills/implement/SKILL.md`, `skills/review-build/SKILL.md`, `docs/cleanroom.md`, `README.md`, `docs/mcp-tools.md`, `test/cleanroom.mjs`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 D-01 bullet 2 and D-11; §1's patent note ("patent pending", never "patented"; constraint `site-no-patented` covers README).
- `kukulu_status.cleanroom`: `null` when the policy file is absent; else `{ policy (repo-relative), policyHash (current), mode ("clean-room", or "general" when state says so), genesis (hash or null), pinnedPolicyHash (state's or null), chain: { entries, tip, lastCheckpoint (seq or null) }, denied (count), hooksLive (true when an allowed entry exists after the newest gate, or after genesis when there is no gate), keyFingerprint (null when no key), lockdown (lockdownActive) }`.
- In clean-room mode the implement, stream, review and summarize prompts end with exactly: "This flight is in clean-room mode: every tool call is checked against docs/cleanroom.json and logged; a denied call is never worked around — note it in the task's log and continue another way."
- implement skill: a denial is not an obstacle to route around; the task log names it; never stage or edit `.kukulu/cleanroom/`. review-build skill: read `kukulu_status.cleanroom.denied` and the `denied` entries since `lastReviewCommit`; a denial worked around (the same target reached by another call within the task) is a category-1 finding.
- `docs/cleanroom.md`: what the mode does, the policy reference (§5.2's table), the log and checkpoint formats (D-05, D-06), the gate with liveness (D-08), the known gaps (D-03), recording instructions, interventions and verdicts with `kukulu_cleanroom_record`. Bundle sections come in P5-08. Name only tools that exist now. README gains a "Clean-room mode" section linking it.
- `docs/mcp-tools.md`: the `cleanroom` field of `kukulu_status` and the `gate` field of `kukulu_next`.

**Acceptance tests:** `test/cleanroom.mjs`: "kukulu_status.cleanroom is null without a policy", "...reports genesis, chain, denied, hooksLive, keyFingerprint and lockdown", "...hooksLive is false with no allowed entry since the last gate", "the implement prompt carries the clean-room sentence in clean-room mode", "...the review and summarize prompts too", "...and no prompt carries it in general mode"; `test/plugin.mjs`: "the implement skill says a denial is never worked around", "review-build treats a worked-around denial as category 1", "docs/cleanroom.md is linked from the README".

**Out of scope:** bundle docs (P5-08).

**Verification:** `kukulu_verify`.

**Depends on:** P3-08

### P3-20: An end-to-end clean-room flight in the drive suite

**Goal:** `test/drive.mjs` runs one whole clean-room flight over stdio with the hooks invoked as Claude Code would, and the resulting chain verifies.

**Files touched:** `test/drive.mjs`, `test/harness.mjs`

**Design constraints:**

- SPEC §6 D-12's last sentence; CLAUDE.md "Clean-room tests".
- A planned repo with `docs/cleanroom.json` from the template (`lockdown.after` naming its first task), `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_ROOT` set, a temp key. Every simulated tool call sends a PreToolUse payload to the guard (exit 2 means the call is not made) and then a PostToolUse payload to the logger; one UserPromptSubmit. Flow: `kukulu_next` (genesis and gate), `kukulu_run_start`, each task (`kukulu_task_next`, simulated Write and Bash calls, one denied Read under `deny.paths`, a commit, `kukulu_task_done`), `kukulu_run_finish`, an APPROVED `kukulu_review_submit`, `kukulu_summary_commit`.
- At the end: `verifyChain` is ok; the kinds include `genesis`, `gate`, `allowed`, `denied`, `checkpoint` and `human`; every checkpoint verifies; every server commit since genesis has both trailers.

**Acceptance tests:** `test/drive.mjs`: "a clean-room flight's chain verifies end to end", "...holds genesis, gate, allowed, denied, checkpoint and human entries", "...every checkpoint verifies", "...every server commit carries the trailers".

**Out of scope:** similarity and attestation (Phases 4 and 5).

**Verification:** `kukulu_verify`.

**Depends on:** P3-11, P3-12, P3-17, P3-18

### P3-21: Phase 3 end: push and record the manual check

**Goal:** Push the branch with clean-room isolation and provenance and record Phase 3's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 3. No code change. Push if policies allow and `origin` exists. An empty commit carries the task.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): copy templates/cleanroom.example.json into a throwaway Rust project as docs/cleanroom.json, start a new Claude Code session with the working-tree plugin, ask it to read ~/.cargo/registry, confirm the denial appears in the session and in .kukulu/cleanroom/log.jsonl, type one instruction and confirm a human entry, then run /kukulu:go-flight and confirm 'gate: ok (7 checks)' before the plan stage`.

**Depends on:** none

## Phase 4 — Contamination scoring

### P4-01: cleanroom.similarity configuration

**Goal:** The server validates `cleanroom.similarity` and resolves its defaults.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `test/plugin.mjs`, `docs/operations.md`

**Design constraints:**

- SPEC §6 E-01; §5.1 `cleanroom.similarity`; §5.3 similarity bullets; CLAUDE.md "Adding a docs/kukulu.json key".
- `validateCleanroom` accepts `similarity`, checked by `validateSimilarity`: an object; known keys `subject`, `pairs`, `languages`, `ngram`, `minIdentLen`, `commentNgram`, `identExclusions`, `near`, `separationMargin`; `subject` a non-empty array of non-empty strings; `pairs` entries `{ id, role, left, right }` with no other key, unique slug ids, `role` one of `negative`, `positive`, `test`, exactly one negative, exactly one positive, at least one test; `left`/`right` non-empty strings (absolute, `~`, repo-relative, or `subject`); `languages` maps an extension starting with `.` to one of `rust`, `c`, `cpp`, `go`, `python`, `javascript`, `typescript`, `java`, `php`; `ngram` a non-empty array of positive integers; `minIdentLen` and `commentNgram` positive integers; `identExclusions` a non-empty string; `near` a number greater than 0 and less than 0.5; `separationMargin` a number at least 0. Every message names the key.
- `cfgFrom` returns `cleanroom.similarity` normalized (or `null`), defaults `ngram [5, 10]`, `minIdentLen 6`, `commentNgram 5`, `near 0.25`, `separationMargin 0.0` (under a `// ⚠️ ASSUMPTION` comment; only here).
- `docs/operations.md` row `cleanroom.similarity` naming each key and default; the plugin config-keys branch for `cleanroom` checks it.

**Acceptance tests:** `test/cleanroom.mjs`: "a valid similarity block resolves with its defaults", one refusal each: "...two negative pairs", "...no test pair", "...an unknown pair role", "...an unknown similarity key", "...a language that is not shipped", "...ngram with a zero", "...near of 0.5", "...a negative separationMargin"; `test/plugin.mjs`: "operations.md documents cleanroom.similarity".

**Out of scope:** scoring (P4-04); the tool (P4-07).

**Verification:** `kukulu_verify`.

**Depends on:** P3-02

### P4-02: The lexer core, Rust and the C family

**Goal:** `tokenize(text, language)` lexes Rust, C and C++ into the normalized token vocabulary and their comments.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `test/fixtures/similarity/lexers/sample.rs`, `test/fixtures/similarity/lexers/sample.c`, `test/fixtures/similarity/lexers/sample.cpp`

**Design constraints:**

- SPEC §6 E-02's first paragraph.
- `LANGUAGES` lists the nine shipped lexers. `tokenize(text, language) → { tokens, comments }`, a hand-written lexer per family, refusing an unknown language. Line and block comments go to `comments` (Rust block comments nest); strings → `STR` (Rust raw `r#"…"#` and byte strings too), chars → `CHAR` (a Rust lifetime `'a` is not a char), numbers → `NUM`, identifiers → `ID`, primitive type names → `TYPE` (Rust `i8`…`u128`, `isize`, `usize`, `f32`, `f64`, `bool`, `char`, `str`; C and C++ `int`, `char`, `short`, `long`, `float`, `double`, `void`, `signed`, `unsigned`, `bool`, `size_t`, the `int8_t`…`uint64_t` family); the keyword classes `if`, `else`, `LOOP` (`for`, `while`, `loop`, `do`), `SWITCH` (`match`, `switch`), `return`, `break`, `continue`, `FN` (`fn`, `func`, `def`, `function`), `TYPEDEF` (`struct`, `enum`, `union`, `type`, `typedef`, `class`, `interface`); every other keyword is its own text; operators and punctuation are themselves. C and C++ preprocessor lines (first non-space `#`, with backslash continuations) are skipped.
- Each sample file is a short, original program (no third-party code) using every construct above.

**Acceptance tests:** `test/cleanroom.mjs`: "the rust lexer tokenizes its sample", "...classifies fn, match, loop and struct", "...normalizes identifiers, numbers, strings, chars and u32", "...keeps a lifetime out of CHAR", "...nests block comments", "the c lexer skips preprocessor lines", "...captures line and block comments", "the cpp lexer tokenizes its sample", "tokenize refuses an unknown language".

**Out of scope:** the other six lexers (P4-03); metrics (P4-04).

**Verification:** `kukulu_verify`.

**Depends on:** P3-01

### P4-03: Lexers for Go, Python, JavaScript, TypeScript, Java and PHP

**Goal:** `tokenize` handles the remaining six shipped languages with the same vocabulary.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `test/fixtures/similarity/lexers/sample.go`, `test/fixtures/similarity/lexers/sample.py`, `test/fixtures/similarity/lexers/sample.js`, `test/fixtures/similarity/lexers/sample.ts`, `test/fixtures/similarity/lexers/sample.java`, `test/fixtures/similarity/lexers/sample.php`

**Design constraints:** SPEC §6 E-02's first paragraph, as P4-02 restates it. Each language's comment markers (Python `#` and docstrings as comments; PHP `#`, `//` and `/* */`), string forms (Go raw backticks, JavaScript and TypeScript template literals as `STR`, Python triple quotes), its primitive type names and its keywords mapped to the shared classes. Each sample is a short, original program using those constructs.

**Acceptance tests:** `test/cleanroom.mjs`: "the <language> lexer tokenizes its sample without throwing" and "...classifies its keywords" for each of go, python, javascript, typescript, java and php.

**Out of scope:** metrics.

**Verification:** `kukulu_verify`.

**Depends on:** P4-02

### P4-04: Metrics, positioning and the verdict

**Goal:** `mcp/cleanroom.mjs` computes E-02's metrics for a pair, positions a test pair between the controls on fixed bands, and writes the verdict and the limits.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`

**Design constraints:**

- SPEC §6 E-02's metrics, positioning and honest-limits paragraphs.
- `scorePair(left, right, opts)`: `left`/`right` are arrays of `{ path, text, language }`; opts `{ ngram, minIdentLen, commentNgram, exclusions (a Set) }` → `{ "ngram_jaccard@<n>", "ngram_containment@<n>" for each n, ident_jaccard, ident_match_rate_left, comment_jaccard }`. Shingles are per file over normalized tokens (no shingle spans a file), unioned per side. Jaccard `|A∩B|/|A∪B|`, containment `|A∩B|/min(|A|,|B|)`, both 0 when the denominator is 0. Identifier sets are raw identifier texts of length at least `minIdentLen` minus `exclusions`; `ident_match_rate_left` is the share of left's identifiers present in right. `comment_jaccard` is over `commentNgram`-grams of the lower-cased, whitespace-normalized words of all comments.
- `position(sTest, sNeg, sPos, { near, separationMargin }) → { c, band }`: `not separated` when `sPos - sNeg <= separationMargin`; else `c = (sTest - sNeg) / (sPos - sNeg)` and bands `below negative` (c < 0), `at or near negative` (0 ≤ c ≤ near), `between`, `at or near positive` (1 − near ≤ c ≤ 1), `above positive` (c > 1).
- `verdictOf(rows)` (rows `{ pair, metric, score, c, band }`): "independence supported on every separable metric" only when every test pair is `below negative` or `at or near negative` on every separable metric; "no metric separates the controls" when none separates; otherwise a sentence naming the failing metrics and bands.
- `LIMITS`: E-02's honest limits as fixed strings (lexical approximation of cleanflate-bench's tree-sitter method, no clone detector, cross-language pairs score lower on token metrics, a structural metric needs a same-language positive control, one target library is n = 1).

**Acceptance tests:** `test/cleanroom.mjs`: "ngram_jaccard on two token streams", "containment uses the smaller set", "no shingle spans a file", "identifier sets drop short identifiers and exclusions", "comment_jaccard compares lower-cased word n-grams", "position bands at -0.1, 0, 0.25, 0.5, 0.75, 1 and 1.1", "not separated when pos minus neg is at most separationMargin", "the verdict supports independence on every separable metric", "...names the failing metrics and bands", "...says no metric separates the controls", "LIMITS lists the five limits".

**Out of scope:** reading files (P4-07).

**Verification:** `kukulu_verify`.

**Depends on:** P4-02

### P4-05: Calibration fixtures

**Goal:** Ship toy implementations of one small spec and prove the controls separate and the independent one positions at or near negative.

**Files touched:** `test/fixtures/similarity/a/`, `test/fixtures/similarity/b/`, `test/fixtures/similarity/b-derived/`, `test/fixtures/similarity/c/`, `test/cleanroom.mjs`

**Design constraints:**

- SPEC §6 E-04's first bullet.
- One small spec (a run-length encoder and decoder with a simple additive checksum), about 150 lines each, written for the test: `a/` and `b/` are independent Rust implementations (different structure, names and comments); `b-derived/` is `b` with about a third of its local identifiers renamed and its functions reordered, keeping its type and function names and comments, so it stays measurably derived; `c/` is a C implementation. `a/` also holds one `NOTES.txt` (an unmapped extension), and `a/` and `b/` share one planted identifier of at least six characters for the exclusion test.
- The test reads the files itself (`languages: { ".rs": "rust", ".c": "c", ".h": "c" }`) and calls `scorePair` and `position`: negative `(a, b)`, positive `(b, b-derived)`, test `(a, b-derived)` and `(c, b)`.

**Acceptance tests:** `test/cleanroom.mjs`: "b and b-derived score above a and b on every metric", "a against b-derived is at or near negative or below on ident_jaccard and comment_jaccard", "swapping the controls gives not separated on every metric", "the unmapped NOTES.txt is skipped and counted", "the exclusion list removes the planted identifier", "the c pair produces a row for every metric".

**Out of scope:** the tool (P4-07).

**Verification:** `kukulu_verify`.

**Depends on:** P4-04

### P4-06: Tune similarity.separationMargin

**Goal:** Measure the control gaps on the calibration fixtures and record whether `separationMargin = 0.0` is the right default.

**Files touched:** `docs/spikes/P4-06.md`

**Design constraints:** SPEC §5.3 `separationMargin` (0.0 ⚠️ ASSUMPTION; cleanflate-bench used strict `pos > neg`); follow "Tuning an assumption" in CLAUDE.md. Before = 0.0; after = `s_pos − s_neg` per metric on the fixtures, the smallest positive gap as headroom, and whether any metric's gap is close enough to zero that a margin would change its band. The value does not change in this task.

**Acceptance tests:** none new; `docs/spikes/P4-06.md` exists, is markdownlint-clean and holds the per-metric table and the method.

**Out of scope:** changing the default.

**Verification:** `kukulu_verify`; the commit body's `Measurement:` line.

**Depends on:** P4-05

### P4-07: kukulu_similarity

**Goal:** A new summarizer tool scores the configured pairs inside the server, writes `similarity.json` and `docs/SIMILARITY.md`, and, in clean-room mode, hashes what it read into the chain.

**Files touched:** `mcp/server.mjs`, `agents/summarizer.md`, `test/cleanroom.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-03 and E-03a. Follow "Adding a tool" in CLAUDE.md: after `kukulu_summary_commit`; the summarizer's `tools:` line.
- No arguments. Refusals, in order, before any write: `cleanroom.similarity` absent; the implement lock exists; the flight is not reviewed `APPROVED`; a pair directory missing or empty (`subject` means the `subject` list, `~` the home directory, relative paths the project); the `identExclusions` file missing (when set); in clean-room mode, the gate (P3-16) fails.
- Reads every file of every side inside the server (recursively, skipping `.git` and `node_modules`), maps extensions through `languages`, counts unmapped files as skipped, scores each test pair and positions it against the negative and positive pairs per metric, and computes the verdict.
- Writes `.kukulu/cleanroom/similarity.json` `{ config, files: [{ pair, side, path, sha256, bytes, language }], rows, verdict, limits, at }` and `docs/SIMILARITY.md` (the statement, one line per metric, the verdict, a table of raw scores, the limits; no timestamp, so a second run with the same inputs is byte-identical). Clean-room mode: append `{ kind: "score", stage: "summarize", data: { reads: <files read>, sha256: <SHA-256 of similarity.json's bytes> } }` and a checkpoint (event `kukulu_similarity`), and commit both files and the log as `chore: similarity scored`; general mode commits both files with no chain.
- Returns `{ verdict, rows, files: <count>, skipped: <count>, limits, commit }`. `kukulu_flight_archive` moves `docs/SIMILARITY.md` with the other artifacts.

**Acceptance tests:** `test/cleanroom.mjs`, with the P4-05 fixtures as pair directories: "kukulu_similarity refuses without cleanroom.similarity", "...while the implement lock exists", "...before an APPROVED review", "...for a missing pair directory", "...for an empty pair directory", "...for a missing exclusion list", "...when the gate fails", "it writes similarity.json and docs/SIMILARITY.md", "docs/SIMILARITY.md is byte-identical on a second run", "the score entry records reads and the sha256 of similarity.json", "...followed by a checkpoint", "general mode writes and commits with no chain", "the archive moves docs/SIMILARITY.md"; `test/protocol.mjs` and `test/plugin.mjs`: the tool list, counts and "agents/summarizer names kukulu_similarity".

**Out of scope:** the summarize skill (P4-08).

**Verification:** `kukulu_verify`.

**Depends on:** P4-01, P4-05, P3-16

### P4-08: The summarize skill carries the contamination score

**Goal:** The summarize skill runs `kukulu_similarity` when it is configured and copies its verdict into SUMMARY under `## Contamination score`.

**Files touched:** `skills/summarize/SKILL.md`, `test/plugin.mjs`

**Design constraints:** SPEC §6 E-03's last bullet. After `kukulu_summary_commit`, when `cleanroom.similarity` is configured: call `kukulu_similarity`, add `## Contamination score` (the verdict line and the per-metric lines, verbatim) to the summary text, and commit it with a second `kukulu_summary_commit({ content })`. A refusal is reported in SUMMARY's Pipeline friction item and the flight goes on.

**Acceptance tests:** `test/plugin.mjs`: "summarize calls kukulu_similarity when cleanroom.similarity is configured", "...under ## Contamination score"; the existing summarize assertions still pass.

**Out of scope:** attestation (P5-08).

**Verification:** `kukulu_verify`.

**Depends on:** P4-07

### P4-09: Phase 4 end: push and record the calibration check

**Goal:** Push the branch with contamination scoring and record Phase 4's calibration check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 4 and E-04's manual-check bullet. No code change. Push if policies allow and `origin` exists. An empty commit carries the task.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): run kukulu_similarity against the cleanflate-bench subjects at 7f50ce6 (reference pairs from d047d66) with cleanflate as the subject; record the identifier Jaccard for cleanflate vs C zlib, miniz_oxide vs C zlib and zlib-rs vs C zlib beside the canonical 0.021 / 0.019 / 0.095, and the comment Jaccard beside 0.0003 / 0.0010 / 0.032; the ordering must agree`.

**Depends on:** none

## Phase 5 — Attestation and the verifier

### P5-01: The verifier: manifest, signature, chain and checkpoints

**Goal:** `scripts/verify-attestation.mjs` checks a bundle's manifest, signature, chain and checkpoints offline with no dependencies, and the `attest` suite starts.

**Files touched:** `scripts/verify-attestation.mjs`, `test/attest.mjs`, `test/run.mjs`, `test/harness.mjs`, `CONTRIBUTING.md`

**Design constraints:**

- SPEC §6 F-03 checks 1–4 and its output contract; §4 (self-contained; constraints `verifier-node-only`, `scripts-node-builtins`, `one-hash-one-signature`). No shebang (it runs as `node …`, and pre-commit would demand the executable bit).
- The CLI runs only as the entry script; exported: `verifyBundle(dir, { key }) → { ok, reasons, notes, checks }` and its own chain and checkpoint functions, which duplicate `mcp/cleanroom.mjs`'s on purpose.
- `node scripts/verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--json]`: each failure prints one line `verify-attestation: <check>: <reason>`, each note one line, then `verify-attestation: PASS` or `verify-attestation: FAIL (<n> reasons)`; exit 0 or 1; `--json` prints one object instead. Check 1: `manifest.json` parses, `version` is 1, every listed file exists with its SHA-256 and size. Check 2: `manifest.sig` (base64 Ed25519 over `manifest.json`'s bytes) verifies with `publisher.pub`; with `--key` the fingerprint must equal it, else the note `signer: self-consistent, fingerprint not checked against an out-of-band value`. Check 3: `log.jsonl`'s chain verifies (dense seq, prev links, every hash) and matches `chain.first`, `chain.tip`, `chain.entries`. Check 4: every checkpoint verifies with `publisher.pub`, every `manifest.checkpoints` entry exists with that signature, and the genesis entry equals `manifest.genesis`. Every failure is reported, not only the first.
- `test/harness.mjs` gains `buildBundle(dir, opts)`, which writes a minimal valid bundle with `mcp/cleanroom.mjs` (a temp key, a chain with genesis and checkpoints, a manifest and its signature).
- Register `["attest", "the offline verifier, attestation bundles and pre-0.6.0 logs"]` in `test/run.mjs`; CONTRIBUTING's suite table gains `attest` and the counts read thirteen.

**Acceptance tests:** `test/attest.mjs`: "an intact bundle passes", "...passes with the right --key", "a wrong --key fails naming the signer", "a changed file fails check 1 naming it", "a missing listed file fails check 1", "a bad manifest.sig fails check 2", "a tampered log line fails check 3 naming its seq", "a chain.tip mismatch fails check 3", "a checkpoint signed by another key fails check 4", "a genesis that differs from manifest.genesis fails check 4", "the verifier and mcp/cleanroom.mjs agree on intact, tampered and reordered chains and on checkpoints", "--json prints one object".

**Out of scope:** checks 5–10 (P5-02); legacy logs (P5-03).

**Verification:** `kukulu_verify`.

**Depends on:** P3-04, P3-06

### P5-02: The verifier: policy, guard, mode, denials, coverage and similarity

**Goal:** The verifier adds F-03's checks 5 to 10, recomputing denials and coverage gaps from the log.

**Files touched:** `scripts/verify-attestation.mjs`, `test/attest.mjs`, `test/harness.mjs`

**Design constraints:**

- SPEC §6 F-03 checks 5–10; F-02's gap definitions.
- Check 5: every checkpoint's `policyHash` is in `policy.hashes`, in order; `policy.json`'s hash equals `policy.current`; a hash change between checkpoints is the note `policy changed at seq <n>`. Check 6: every checkpoint's `guardHash`, `loggerHash`, `hooksHash` equal the manifest's `plugin` values. Check 7: `genesis.data.mode` is `clean-room` and no `gate` entry records a `mode` failure. Check 8: recount denials (`total`, `byReason`) and verdict counts (from `human` entries with `data.kind: "verdict"`; `unclassified` = denials without a verdict) and compare with `manifest.denials`. Check 9: recompute `coverage.gaps` from the log, `commits.txt` and `manifest.coverage.idleGapHours`, compare, and print every gap. Check 10: `similarity.json`'s hash equals `manifest.similarity.sha256` when present.
- Gaps, in this order of kinds, each in log or file order: `{ kind: "silent-gates", from, to }` (two consecutive gate seqs with no entry between them); `{ kind: "untrailed-commit", sha, subject }` (a `commits.txt` line with an empty stage trailer); `{ kind: "intervention", seq }` (a `human` entry with `data.kind: "intervention"`); `{ kind: "idle", from, to, hours }` (consecutive entries with the same non-null stage more than `idleGapHours` apart; hours rounded to two decimals); `{ kind: "unsigned-commit", sha }` (`%G?` of `N` or `B`). `commits.txt` lines are `<sha>\x1f<%G?>\x1f<subject>\x1f<stage>\x1f<task>`.
- `buildBundle` grows to write `policy.json`, `commits.txt`, the coverage, the denials and an optional `similarity.json`.

**Acceptance tests:** `test/attest.mjs`: "a checkpoint policyHash missing from policy.hashes fails check 5", "a policy change between checkpoints is reported, not failed", "a differing guardHash fails check 6", "a gate entry recording a mode failure fails check 7", "a wrong denial count fails check 8", "a wrong verdict count fails check 8", "a missing coverage gap fails check 9", "each gap kind is recomputed", "a changed similarity.json fails check 10".

**Out of scope:** building the real bundle (P5-06).

**Verification:** `kukulu_verify`.

**Depends on:** P5-01

### P5-03: Pre-0.6.0 logs and the cleanflate fixture

**Goal:** `--legacy-log` reads the pre-rename tool log the cleanflate evidence cites, proven on an unmodified excerpt of it.

**Files touched:** `scripts/verify-attestation.mjs`, `test/fixtures/foundry-tool-log.jsonl`, `test/fixtures/foundry-tool-log.SOURCE`, `test/attest.mjs`

**Design constraints:**

- SPEC §6 F-04; Appendix D.
- The fixture: from `provenance/tool-log.snapshot.jsonl` at `85f210084a367dcc706c732f5776bf0563cdc0cd` (sibling checkout `../cleanflate`, or a clone of tag `v0.3.0-cleanroom`, per CLAUDE.md flight notes; block if neither is reachable), the 20 consecutive lines starting at the line with ts `2026-09-29T14:53:58.191Z` (the nearest at or before `14:54:00.000Z`; lines 109–128 of that file), byte for byte, nothing redacted, ending in a newline. It holds the denied `find / -path '*/libz-sys-*/src/lib.rs'` call (ts `14:54:47.458Z`) with eight lines before and eleven after. `foundry-tool-log.SOURCE` is one line naming the repository, path, commit, tag, line range, first and last ts, and "unmodified". The task log records the same.
- `node scripts/verify-attestation.mjs --legacy-log <file> [--roots <comma list>] [--words <comma list>] [--repo <path>]`: parses keys `ts`, the stage key, `task_id`, `model`, `tool`, `target`, `decision`, `reason`, optional `session_id` and `agent_type`; reports lines parsed and failed (never dropped silently), calls by tool and stage, denials with reasons, read-capable calls (`Read`, `Glob`, `Grep`, `Bash`, `WebFetch`), forbidden-read candidates (a path-like token under a root, or naming a word outside `--repo`), and the line `legacy log: no hash chain or signatures; integrity rests on the git history that holds it`. Defaults are cleanflate's: roots `~/.cargo/registry/`, `~/.cargo/git/`, `/usr/include/zlib.h`; words `zlib`, `miniz`, `flate2`, `libdeflate`, `libz-sys`, `libz_sys`, `zopfli`; repo `/media/ericmann/Data/Projects/cleanflate`. Exit 0 when every line parses, else 1.

**Acceptance tests:** `test/attest.mjs`: "the cleanflate fixture is 20 lines whose first and last ts match SOURCE", "every line of it parses", "it has exactly one denial", "its reason is forbidden word in path argument: */libz-sys-*/src/lib.rs", "it is a forbidden-read candidate on libz-sys", "the legacy line is printed", "read-capable calls are counted", "a malformed line is counted as failed and exits 1".

**Out of scope:** any change to the fixture's bytes.

**Verification:** `kukulu_verify`.

**Depends on:** P5-01

### P5-04: Coverage gaps and cleanroom.idleGapHours

**Goal:** `mcp/cleanroom.mjs` computes F-02's coverage gaps with the same definitions as the verifier, under a validated `cleanroom.idleGapHours`.

**Files touched:** `mcp/cleanroom.mjs`, `mcp/server.mjs`, `test/cleanroom.mjs`, `test/attest.mjs`, `test/plugin.mjs`, `docs/operations.md`

**Design constraints:**

- SPEC §6 F-02 (3 hours ⚠️ ASSUMPTION); CLAUDE.md "Adding a docs/kukulu.json key".
- `coverageGaps(entries, commitLines, { idleGapHours }) → gaps`, exactly P5-02's kinds, shapes and order: `silent-gates { from, to }`, `untrailed-commit { sha, subject }`, `intervention { seq }`, `idle { from, to, hours }`, `unsigned-commit { sha }`. `KNOWN_LIMITS`: D-03's four known gaps as fixed strings.
- `validateCleanroom` accepts `idleGapHours`, a positive number; `cfgFrom` defaults it to 3 under a `// ⚠️ ASSUMPTION` comment, only there. `docs/operations.md` row; the plugin config-keys `cleanroom` branch checks it.

**Acceptance tests:** `test/cleanroom.mjs`: "coverageGaps lists silent gate pairs", "...untrailed commits", "...interventions", "...idle spans over idleGapHours within one stage", "...not across stages", "...unsigned commits", "cleanroom.idleGapHours must be a positive number"; `test/attest.mjs`: "the verifier and mcp/cleanroom.mjs compute identical gaps"; `test/plugin.mjs`: "operations.md documents cleanroom.idleGapHours".

**Out of scope:** the bundle (P5-06).

**Verification:** `kukulu_verify`.

**Depends on:** P5-02, P3-02

### P5-05: Tune cleanroom.idleGapHours

**Goal:** Measure real same-stage gaps in cleanflate's log and record whether 3 hours is the right idle threshold.

**Files touched:** `docs/spikes/P5-05.md`

**Design constraints:** SPEC §6 F-02 (`cleanroom.idleGapHours`, 3 ⚠️ ASSUMPTION); follow "Tuning an assumption" in CLAUDE.md. Before = 3 hours; after = the distribution of gaps between consecutive same-stage entries in cleanflate's `provenance/tool-log.snapshot.jsonl` at `85f2100` (maximum, p99, and how many exceed 3 hours), noting that cleanflate's own SUMMARY treats gaps over 15 minutes as idle for active time. The value does not change in this task.

**Acceptance tests:** none new; `docs/spikes/P5-05.md` exists, is markdownlint-clean and holds the distribution and the method.

**Out of scope:** changing the default.

**Verification:** `kukulu_verify`; the commit body's `Measurement:` line.

**Depends on:** P5-04

### P5-06: kukulu_attest

**Goal:** A new summarizer tool writes the signed attestation bundle, runs the verifier on it, and commits it only when it passes.

**Files touched:** `mcp/server.mjs`, `agents/summarizer.md`, `test/attest.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 F-01. Follow "Adding a tool" in CLAUDE.md: after `kukulu_similarity`; the summarizer's `tools:` line.
- `{ evidence?: string[] }`. Refusals before any write: not clean-room mode; the summary not committed; the gate fails; the tree dirty apart from `preexistingUntracked` and the log; an evidence path missing, untracked, absolute or with a `..` segment.
- Writes `docs/attestation/` with F-01's files: `manifest.json` (every F-01 field, `coverage: { gaps (coverageGaps), knownLimits (KNOWN_LIMITS), idleGapHours }`, `plugin` including `verifierHash`), `log.jsonl`, `policy.json`, `similarity.json` when present, `SUMMARY.md`, `REVIEW.md`, `PROGRESS.md`, `kukulu.json`, `state.json`, `commits.txt`, `evidence/<path>` for each evidence file, `publisher.pub`, `verify.mjs` (a byte copy of `PLUGIN_ROOT/scripts/verify-attestation.mjs`) and `manifest.sig`. `commits.txt` is `git log --format='%H%x1f%G?%x1f%s%x1f%(trailers:key=Kukulu-Stage,valueonly,separator=%x2C)%x1f%(trailers:key=Kukulu-Task,valueonly,separator=%x2C)' <base>..HEAD` (the separator keeps each commit on one line). `files` lists every file but `manifest.json`, `manifest.sig` and `verify.mjs`.
- Counts: `denials.byReason`; verdict counts from `human` verdict entries, `unclassified` the rest; `calls.total`, `byTool`, `byStage`, `readCapable` (`Read`, `Glob`, `Grep`, `Bash`, `WebFetch`); `human.instructions` (prompts and instruction records), `interventions`, `verdicts`; `selfTest` from running the guard self-test now; `policy.hashes` the distinct checkpoint policy hashes in order; `checkpoints: [{ seq, event, git, signature, ok }]`.
- Run `node <bundle>/verify.mjs <bundle> --key <fingerprint> --json` before committing; a failing bundle is removed and the call refused with the verifier's reasons. Then append `{ kind: "attest", data: { manifest: <sha256> } }` and a checkpoint (event `kukulu_attest`), commit `docs/attestation/` and the log as `chore: attestation bundle`, push per policy. Returns `{ dir, files, manifest, fingerprint, commit, verify }`.

**Acceptance tests:** `test/attest.mjs` (a short clean-room flight in a temp repo, then attest): "kukulu_attest refuses outside clean-room mode", "...before the summary is committed", "...on a dirty tree", "...an untracked evidence path", "...an evidence path outside the repo", "...when the gate fails", "the bundle holds every F-01 file", "manifest.files lists every file but manifest.json, manifest.sig and verify.mjs, with hashes", "verify.mjs is a byte copy and its hash is plugin.verifierHash", "commits.txt has one line per commit with both trailers", "the verifier's PASS is returned", "an attest entry and a checkpoint follow the bundle"; `test/protocol.mjs` and `test/plugin.mjs`: the tool list, "Twenty-five tools" when every tool task landed, "agents/summarizer names kukulu_attest".

**Out of scope:** the tamper suite and the archive move (P5-07).

**Verification:** `kukulu_verify`.

**Depends on:** P5-02, P5-04, P3-16, P3-08

### P5-07: Tamper tests over a real bundle; the archive moves it

**Goal:** Prove the verifier rejects each kind of tamper on a bundle `kukulu_attest` built, runs alone from the bundle, and that the archive moves the bundle.

**Files touched:** `test/attest.mjs`, `mcp/server.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 F-03's last paragraph; F-01's last bullet.
- Build one bundle with `kukulu_attest`, copy it per case and tamper: a file (one byte of `SUMMARY.md`), the manifest (a count), the signature, a log line, a checkpoint (edit its data and rehash the chain from there), the policy (`policy.json`), the public key (another key's `.pub`), a commit trailer (`commits.txt`). Each fails with the named reason among its reasons; the untampered bundle passes with and without `--key`. Copy the bundle out, delete the temp repo, and run `node verify.mjs .` from the bundle directory: PASS.
- `kukulu_flight_archive` moves `docs/attestation/` into `docs/flights/<slug>/attestation/`.

**Acceptance tests:** `test/attest.mjs`: "a tampered file fails", "a tampered manifest fails", "a tampered signature fails", "a tampered log line fails", "a tampered checkpoint fails", "a tampered policy fails", "a swapped public key fails", "a tampered commit trailer fails", "the untampered bundle passes with and without --key", "the bundle's verify.mjs runs alone with the repo deleted", "the archive moves docs/attestation/ into the flight's directory".

**Out of scope:** docs (P5-08).

**Verification:** `kukulu_verify`.

**Depends on:** P5-06

### P5-08: Attestation docs and the summarize step

**Goal:** Document reading and verifying a bundle, and have the summarize skill attest before archiving.

**Files touched:** `docs/cleanroom.md`, `CONTRIBUTING.md`, `skills/summarize/SKILL.md`, `test/plugin.mjs`

**Design constraints:** SPEC §6 F-05. `docs/cleanroom.md` gains "Reading a bundle" (the manifest's fields, the coverage gaps) and "Verifying offline" (the command lines with `--key` and `--json`, sample PASS and FAIL output, `--legacy-log`). CONTRIBUTING's suite table has `cleanroom` and `attest`. The summarize skill, in clean-room mode, calls `kukulu_attest` after `kukulu_similarity` (when configured) and before `kukulu_flight_archive`, then adds `## Attestation` (the directory, the manifest hash, the fingerprint and the verifier's result line) to the summary and commits it with `kukulu_summary_commit({ content })`.

**Acceptance tests:** `test/plugin.mjs`: "summarize calls kukulu_attest before kukulu_flight_archive", "...adds ## Attestation", "docs/cleanroom.md documents verify-attestation.mjs with --key", "CONTRIBUTING's suite table lists cleanroom and attest".

**Out of scope:** any server change.

**Verification:** `kukulu_verify`.

**Depends on:** P5-06

### P5-09: Phase 5 end: push and record the manual check

**Goal:** Push the branch with attestation and record Phase 5's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 5. No code change. Push if policies allow and `origin` exists. An empty commit carries the task.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): copy a bundle to a machine without this repository, run node verify.mjs . --key <fingerprint from kukulu_status>, and confirm PASS; change one byte of log.jsonl and confirm FAIL names the line`.

**Depends on:** none

## Phase 6 — Documentation, site and release

### P6-01: Operations, architecture and writing-specs for 0.7.0

**Goal:** `docs/operations.md`, `docs/architecture.md` and `docs/writing-specs.md` describe 0.7.0 as built.

**Files touched:** `docs/operations.md`, `docs/architecture.md`, `docs/writing-specs.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 H bullets 2 and 3.
- operations: configuration rows for `cleanroom`, `cleanroom.policy`, `cleanroom.signingKey`, `cleanroom.similarity`, `cleanroom.idleGapHours`, `review.mutationFixRounds` (add any missing); Halts around `kukulu_run_resume`; environment rows `KUKULU_CLEANROOM_KEY` and `KUKULU_CLEANROOM_LOG` (tests and self-test only); no foundry paragraph.
- architecture: the pieces diagram (Mermaid) gains the two hook scripts; a "Clean-room mode" section with the gate's place in the stage machine (Mermaid allowed); no decision 4a.
- writing-specs: a "Clean-room flights" section (write the policy, commit it on the base branch, name the lockdown task, configure the pairs) replacing the commit-msg hook advice under "Provenance logging" with the built-in `Kukulu-Stage`/`Kukulu-Task` trailers. `test/plugin.mjs`'s "writing-specs.md shows a commit-msg hook for provenance logging" becomes "writing-specs.md has a Clean-room flights section naming the built-in trailers".
- Name only tools the server has.

**Acceptance tests:** `test/plugin.mjs`: "writing-specs.md has a Clean-room flights section naming the built-in trailers", "operations.md documents every cleanroom key", "architecture.md shows the clean-room hook scripts".

**Out of scope:** README, mcp-tools, CHANGELOG (P6-02, P6-03).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P6-02: mcp-tools.md and README for 0.7.0

**Goal:** `docs/mcp-tools.md` and `README.md` describe every 0.7.0 tool and field and the migration from 0.6.

**Files touched:** `docs/mcp-tools.md`, `README.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 H bullets 1 and 4.
- mcp-tools: the first line's count matches the server ("Twenty-five tools" when every tool task landed); sections for `kukulu_run_resume`, `kukulu_cleanroom_record`, `kukulu_similarity`, `kukulu_attest`; no `kukulu_migrate`; the new fields on `kukulu_status` (`prChecks`, `cleanroom`), `kukulu_next` (`gate`), `kukulu_mutate` (`constraints`), `kukulu_review_submit` (`source`, the mutation cap) and `kukulu_plan_commit` (`branch`, `notes`).
- README: the feature list names clean-room mode; the tool table and count match the server; the suite count ("thirteen suites" where it counts them); the Clean-room mode section; a 0.7.0 migration paragraph (the manual move from A-01's refusal, and that `FOUNDRY_*` variables are no longer read).

**Acceptance tests:** `test/plugin.mjs`: the existing count and table assertions; "README has a 0.7.0 migration paragraph", "mcp-tools documents prChecks, gate and source".

**Out of scope:** CHANGELOG and the version (P6-03).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P6-03: CHANGELOG 0.7.0, the version and the feedback header

**Goal:** The release reads 0.7.0 everywhere and the changelog entry is complete.

**Files touched:** `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `mcp/server.mjs`

**Design constraints:**

- SPEC §6 H bullets 5–7.
- Rename `## [Unreleased]` to `## [0.7.0] — <today>` with `### Added`, `### Changed`, `### Fixed`, `### Breaking changes` (the foundry removal, `source` required on review tasks, `kukulu_plan_commit`'s branch check, the `deprecations` field removed). Plain and technical; each fixed item cites `kukulu-tech F-nn` or `Appendix A item n`; other projects only by label. The kukulu.tech site lines already under Unreleased stay, under Added.
- `0.7.0` in `package.json`, `.claude-plugin/plugin.json` and `VERSION` in `mcp/server.mjs`.
- When `docs/feedback/2026-10-19-kukulu-tech.md` exists on this machine (it is gitignored), add one "Addressed in: docs/SPEC.md v0.7.0 (flight v0-7-0)" header line and change nothing else; no test reads it.

**Acceptance tests:** `test/plugin.mjs`'s existing "package.json and plugin.json agree on the version", "the MCP server reports the plugin's version", "CHANGELOG.md's newest entry is the package version".

**Out of scope:** tagging, publishing or merging.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P6-04: Apply the approved copy, a solid clean-room diagram and check-site rule 16

**Goal:** Apply the owner's approved copy to the mockup and the page, make Fig. 1's clean-room elements solid, and add check-site rule 16 so the approved copy stays applied.

**Files touched:** `docs/site/mockup.html`, `site/index.html`, `site/styles.css`, `scripts/check-site.mjs`

**Design constraints:**

- SPEC §6 G-01, G-02, G-03, G-04; §3 principles 14, 15; CLAUDE.md "Adding a site check" and the kukulu-tech site checklist (no inline style, rule 6 page equals mockup).
- First the approval gate: `base=$(git merge-base <baseBranch> HEAD)` with `baseBranch` from `docs/kukulu.json` (`cleanroom`). If `git log $base..HEAD -- docs/site/copy-changes.json` prints anything, or `git cat-file -e $base:docs/site/copy-changes.json` fails, call `kukulu_task_block` with "owner approval missing: commit docs/site/copy-changes.json on main (SPEC §6 G-01, Appendix C)".
- Before editing, count each pair's `old` in the original `docs/site/mockup.html` and `site/index.html`; any count other than exactly one blocks the task naming the pair's 1-based index and the file. Then apply every `{ old, new }` in order as exact string replacements in both files. `docs/site/copy-changes.json` is never edited, whatever its wording.
- G-03, Fig. 1 only: the room, the guard's blocked box, the provenance and controller row, and the three evidence boxes change from dashed to solid borders, in `site/styles.css` (`.room`, `.node-blocked`, `.room-foot`, `.ev .stage`) and in the mockup's inline styles; the legend's dashed swatch span is removed from both files (the legend row keeps its new text), and `.swatch-dashed` leaves `styles.css`. Section 04's clean-room box is not part of Fig. 1 and stays dashed. Proof numbers, bio and footer do not change.
- Rule 16 in `scripts/check-site.mjs`: when `docs/site/copy-changes.json` exists (option `copyChangesPath`), validate `{ approved: non-empty string, approvedAt: non-empty string, changes: non-empty array of { old: non-empty string, new: string } }` with unknown keys refused (`check-site: rule 16: docs/site/copy-changes.json: <what is wrong>; <what to do>`); for each pair n and each of the mockup and the page, `old` must be absent and `new` present, else `check-site: rule 16: <file>: approved copy change <n> not applied; apply docs/site/copy-changes.json`. `IMPLEMENTED_RULES` gains 16; `--report` is unchanged; the self-test's temp copy includes the copy-changes file and the mockup. Constraint `no-hardcoded-site-tunables` still holds.

**Acceptance tests:** `node scripts/check-site.mjs --self-test` with new `CASES`: "rule 16: a pair not applied to the page", "rule 16: a pair not applied to the mockup", "rule 16: an old string still present", "rule 16: a malformed copy-changes file"; `npm run check:site` and `npm run check:site:browser` pass; `git log <base>..HEAD -- docs/site/copy-changes.json` is empty.

**Out of scope:** `docs/site/copy-changes.json`, `checks.json`, `assets/`, `screens/`; any number in the Proof section.

**Verification:** `kukulu_verify` (with `site/` and `docs/site/` touched, `npm run check:site` and the exclusive `npm run check:site:browser` run too).

**Depends on:** none

### P6-05: Phase 6 end: push and record the manual check

**Goal:** Push the release branch and record Phase 6's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 6. No code change. Push if policies allow and `origin` exists. An empty commit carries the task. The handoff that follows (written for `kukulu_run_finish`) starts with the bold line in CLAUDE.md's flight notes.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code, docs or the site; merging.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): deploy the build branch as a Cloudflare Pages preview (docs/site/DEPLOY.md), read every clean-room line on the preview against what the suite proves, and compare the page with the changed mockup at 360, 768 and 1440 px in both schemes; confirm the three site, ci and lint checks are green on the PR`.

**Depends on:** none

## Spec issues

- `pre-commit run --all-files` fails on the base branch today: `docs/site/copy-changes.json` (committed in `fffe71e`) has no final newline, so `end-of-file-fixer` rewrites it on every run, contradicting §7 ("runs today on a clean checkout") and leaving every `kukulu_verify` red and the tree dirty. The flight may not edit that file. Resolution: the first task excludes it from `end-of-file-fixer`; the owner may instead add the newline on `cleanroom` before the run, which leaves the exclusion harmless.
- The draft PR's target. SPEC §1 wants the draft PR open against `main`, but the plan is committed on `cleanroom` and `baseBranch` must be the branch the plan is committed on, so `kukulu_run_finish` will open the PR against `cleanroom`. Resolution: the owner retargets the PR to `main` (or merges `cleanroom` into `main` before the implement stage and re-plans there).
- The approval is on `cleanroom`, not `main`. G-01 and G-02 say the owner commits `docs/site/copy-changes.json` on `main`; it was committed on `cleanroom` (`fffe71e`). With a merge-base against `main` the G-02 gate would block. Resolution: P6-04 takes the merge-base with `baseBranch` (`cleanroom`), where the file is present and untouched.
- The committed copy differs from Appendix C. The owner's file changes changes 4, 8 and 11; G-01 says the committed file supersedes the spec, so P6-04 applies it verbatim. Change 11's `new` reads "their general form is the plugin’s clean-room mode, fromas of 0.7.0." ("fromas" looks like an editing slip). The flight never edits that file; the owner should fix it on `cleanroom` before Phase 6 if it is a slip.
- Rule 16 is vacuous for two pairs. In change 8 (`new` "Clean-room mode") and change 12 (`new` "NEXT 01"), `new` already occurs on the page before applying, so "new present" proves nothing; "old absent" still catches an unapplied pair. No change proposed.
- `no-foundry-names` `from` the A-01 task cannot pass: the rule scans `scripts/`, `hooks/` and `skills/`, which A-02 and A-03 clean later. Resolution: `from: P0-05`.
- A-01's refusal message itself contains "Foundry", ".foundry/" and "docs/foundry.json", which `no-foundry-names` would catch in `mcp/server.mjs`. Resolution: the names are built from `"foun" + "dry"`, as §5.4 already does for the archive fallback.
- The prose check versus history. `test/plugin.mjs` fails on any `kukulu_*` name the server lacks, and `CHANGELOG.md`'s 0.6.0 entry names `kukulu_migrate`. Resolution: a retired-tools list allowed in `CHANGELOG.md` and `README.md` only.
- `mcp/cleanroom.mjs` "no I/O beyond reading" versus D-05's `appendEntry` and D-06's `generateKey`, which write. Resolution: those two are its only writes, on paths they are handed.
- "A project without a policy records `state.cleanroom = { mode: "general" }` at its first `kukulu_next`" would add a commit to every project's base branch (or leave `state.json` dirty and break `kukulu_run_start`). Resolution: `kukulu_run_start` records it in the state it already commits; a policy first seen once `docs/PLAN.md` exists is the sticky-mode halt.
- Genesis records `keyFingerprint`, but D-06 has `kukulu_run_start` generate the key, after genesis. Resolution: genesis generates the key when it is absent.
- D-10 protects all of `docs/kukulu.json` and says the planner writes it before genesis, but genesis happens at the first `kukulu_next`, before the plan stage. Resolution: protected once `docs/PLAN.md` exists; the gate's policy check catches a later change of `cleanroom.policy`.
- D-03 lockdown "when PROGRESS.md has no open task" would make lockdown active before any plan exists. Resolution: inactive while PROGRESS.md is absent.
- The log is never clean in a clean-room session (both hooks append on every call), yet several tools refuse a dirty tree. Resolution: every dirty-tree check tolerates `.kukulu/cleanroom/log.jsonl`.
- The log across flights is unspecified; a second clean-room flight would append its genesis to the first flight's chain. Resolution: the archive moves `.kukulu/cleanroom/` into the flight's archive.
- D-08's gate writes its `gate` entry before refusing, an exception to principle 3 that SPEC mandates. Recorded in CLAUDE.md as the one sanctioned exception.
- The 50 ms fast-path budget, read as whole-process wall time, is mostly Node's own startup. Resolution: the test measures the hook's time beyond `node -e 0`.
- F-01's `commits.txt` format puts a newline after each trailer value, so one commit spans several lines. Resolution: `,separator=%x2C` on both trailer placeholders.
- F-02 introduces `cleanroom.idleGapHours`, which §5.1's table omits (H lists it). Resolution: validated and documented with the other `cleanroom` keys (P5-04).
- `no-gnu-sed-inplace` would fail on the D-03 fixtures, which quote a recorded `sed -i` command. Resolution: the carried rule excludes `test/fixtures/`, and recorded commands live only there.
- `scripts-node-builtins` as written in §5.4 checks only static `import … from`; widening it to dynamic imports and `require` would hit `scripts/check-diagrams.mjs` (CI-only, needs mermaid and jsdom). Resolution: widened, with that file and `scripts/lint.sh` excluded.
- B-03's "`kukulu_summary_commit`'s review-history line" does not exist; the review history is rendered by the summarize skill. Resolution: the skill renders `sources`.
- B-04's derivation, applied literally to "Kūkulu 0.7.0", gives `k-kulu-0-7-0`, not the stated `kukulu-0-7-0`. Resolution: fold accented letters to ASCII first.
- B-05 and Phase 2 both claim CONTRIBUTING's Flight feedback section. Resolution: P1-13 creates it, P2-01 adds the label rule.
- G-02 says no later task depends on the approval task, but rule 16 fails until the copy is applied. Resolution: rule 16 lands in the same task (P6-04).
- G-03 cites "Appendix C, change 4" for the legend, but the legend is change 6 (the notes say so), and it speaks of `stroke-dasharray` where the page uses dashed CSS borders. Resolution: change 6 and border styles; section 04's dashed clean-room box is outside Fig. 1 and stays dashed — the owner may want it solid too.
- E-03 has the summarizer score "after `kukulu_summary_commit`" and copy the verdict into SUMMARY, and F-05 does the same for the attestation, so SUMMARY is committed two or three times and the bundle's `SUMMARY.md` predates its own `## Attestation` section. Resolution: the skill commits SUMMARY again with `kukulu_summary_commit({ content })` after each; accepted as is.
- D-03's "eight real cleanflate false positives" are not listed in SPEC. Resolution: the eight implement-stage denials in the Denied calls table at `85f2100` other than the heredoc, by ts; any of them the template policy still denies is kept with its actual decision and reported.

## Review fixes (round 1)

### R1-01: Guard: close the self-protection bypasses in Bash write rules
**Goal:** Source: review (REVIEW.md F1; SPEC D-10, D-03 rule 6d, principle 11). Make evaluate() deny Bash calls that remove or overwrite a protected path through forms it misses today: a redirection glued to the preceding word (`echo hi>.kukulu/state.json`, `x 2>docs/cleanroom.json`); a destructive write-family command naming a protected path's ancestor (`rm -rf .kukulu`, `rm -rf docs`, `mv docs docs2`, `rm -rf .git`, and the destructive git forms rm/mv/checkout/restore/clean); a bare operand without `/` or a leading `.` (every non-option operand of a write-family command is a path); and a relative operand after `cd <dir>`/`pushd <dir>` in an earlier segment of the same command (`cd docs && rm cleanroom.json`, `cd .kukulu && rm state.json`), which must resolve against the effective cwd.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md
**Design constraints:** mcp/cleanroom.mjs stays pure and synchronous (server-synchronous, cleanroom-module-pure). Recorded shell commands live only in test/fixtures/. Ordinary work stays allowed: `git add .`, `git add docs`, `git commit -F f`, `cp a.txt docs/`, `rm -rf target`, `mv a b` in the project. The ancestor rule applies only to destructive forms (rm, mv source, recursive chmod/chown, git rm/mv/checkout/restore/clean). Every existing guard case keeps its decision.
**Acceptance tests:** New guard-cases.json fixtures, run by test/cleanroom.mjs and the guard self-test, each asserting decision and a `protected path` reason: `echo hi>.kukulu/state.json` denied; `printf x 2>docs/cleanroom.json` denied; `rm -rf .kukulu` denied; `rm -rf docs` denied; `mv docs docs2` denied; `rm -rf .git` denied; `cd docs && rm cleanroom.json` denied; `cd .kukulu && rm state.json` denied; `git add .` allowed; `git add docs` allowed; `cp a.txt docs/` allowed; `rm -rf target` allowed. Each of these denied cases is allowed on the current code, so each would have caught F1.
**Out of scope:** Network-rule and deny.paths reach (R1-02); read-family false positives (R1-03); interpreter escapes such as python3 -c, which stay a documented gap.
**Verification:** kukulu_verify with the files above (includes `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json`); the self-test case count rises by the new fixtures.
**Depends on:** none

### R1-02: Guard: network rule and deny.paths reach through git options, Glob patterns, $HOME and substitutions
**Goal:** Source: review (REVIEW.md F2; SPEC section 5.2 deny.network and deny.paths 'a target under one is denied for every tool', D-03 rules 5 and 6a). Deny what the template policy allows today: `git -C /x clone https://a` and `git -c k=v fetch` (skip git's global options, including value-taking -C/-c/--git-dir/--work-tree, before matching the two-word network name); a Glob whose absolute or ~ pattern lies under deny.paths or matches a pathPattern (`/home/u/.cargo/registry/**/*.rs`, `~/.cargo/registry/**`); Bash tokens using `$HOME`/`${HOME}` (expanded like `~`); and commands inside `$(...)`, backticks, `<(...)` and the string argument of `sh|bash|zsh -c` and `eval`, which are evaluated as further commands. Anything the parser still cannot see is added to KNOWN_LIMITS and docs/cleanroom.md's known gaps.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md
**Design constraints:** Pure and synchronous module. KNOWN_LIMITS stays the single source the manifest and the verifier compare. If KNOWN_LIMITS changes, update the test that asserts its fixed strings, and keep the copy in scripts/verify-attestation.mjs identical if it has one. Existing cases keep their decisions.
**Acceptance tests:** New guard-cases.json fixtures: `git -C /x clone https://a` denied (network command git clone); `git -c a=b fetch` denied; Glob pattern `__HOME__/.cargo/registry/**/*.rs` with no path denied (deny.paths); Glob pattern `~/.cargo/registry/**` denied; `cat $HOME/.cargo/registry/x` and `cat ${HOME}/.cargo/registry/x` denied; `echo $(curl https://evil)` denied; ``echo `curl https://evil` `` denied; `bash -c 'curl https://evil'` denied; `eval 'cat ~/.cargo/registry/x'` denied; `git -C sub status` allowed; Glob pattern `src/**/*.rs` allowed. Every denied case is allowed on the current code. test/cleanroom.mjs's KNOWN_LIMITS assertion is updated if the list changes.
**Out of scope:** Write-protection forms (R1-01); read-family false positives (R1-03); parsing interpreter programs (python3 -c, node -e).
**Verification:** kukulu_verify with the files above, guard self-test included.
**Depends on:** R1-01

### R1-03: Guard: allow cleanflate's four remaining false positives by classifying pattern operands
**Goal:** Source: review (REVIEW.md F3; SPEC D-03 rule 6 read-family and D-12: the eight cleanflate false positives are shouldNotMatch). In read-family commands, treat the pattern or script operand as a non-path token: grep/egrep/fgrep/rg/ag/ack's first operand and -e values, sed's script operand and -e values, awk's program, and the values of find's -name/-iname/-path/-ipath/-regex. Those tokens are then judged only by SPEC's 'outside the repository' clause. False positives 1, 6, 7 and 8 in test/fixtures/guard-cases.json become expect allowed. FP1 also needs R1-01's cd tracking. The real prior-art attempt `find / -path '*/libz-sys-*/src/lib.rs'` stays denied, because `/` lies outside the repository.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md
**Design constraints:** Every existing deny case stays denied, including a cat/less of a path naming a word outside allow.paths, the prior-art attempt, and grep -r of a word with a path outside the repository. Recorded commands stay in test/fixtures/. No change to READ_FAMILY or WRITE_FAMILY membership.
**Acceptance tests:** guard-cases.json: the four fixtures 'cleanflate false positive 1/6/7/8' flip to expect allowed (their names lose 'still denied'). New cases: `grep -rn zlib /usr/include` denied (word with a path outside the repository); `sed -n 's/zlib/x/p' ~/.cargo/registry/a.rs` denied (deny.paths); `grep -n zlib src` allowed with cwd at the repository root. The existing 'cleanflate real prior-art attempt' case stays denied. test/cleanroom.mjs asserts all eight false positives are allowed.
**Out of scope:** Changing templates/cleanroom.example.json's words or allow.paths; changing SPEC.
**Verification:** kukulu_verify with the files above, guard self-test included. Record in the task log which rule now allows each of FP 1, 6, 7 and 8.
**Depends on:** R1-02

### R1-04: Test verifyChain's prev linkage and seq density in mcp/cleanroom.mjs
**Goal:** Source: mutation (REVIEW.md F4). Kill the surviving mutants in mcp/cleanroom.mjs verifyChain. Deleting the `entry.prev !== tip` check survives all 13 suites, so an edited entry with a recomputed hash would pass. Weakening `entry.seq !== i + 1` to `entry.seq < 0` survives test/cleanroom.mjs. Add fixtures that isolate each check.
**Files touched:** test/cleanroom.mjs
**Design constraints:** Test-only; no change to mcp/cleanroom.mjs. Build the fixtures with the module's own appendEntry/entryHash in a temp directory.
**Acceptance tests:** test/cleanroom.mjs: 'verifyChain names a rehashed edit by its broken link'. Edit a middle entry's target, recompute that entry's hash with entryHash(prev, rest), and assert ok false, firstBad.line is the next line and the reason matches /prev does not match/. Then 'verifyChain names a seq gap'. Build a chain whose seqs go 1, 2, 4 with every prev and hash consistent, and assert ok false and a reason matching /seq is 4 but this is entry 3/. Both fail with the mutants applied and pass without them.
**Out of scope:** The verifier's copy (R1-05); any change to chain semantics.
**Verification:** kukulu_verify with test/cleanroom.mjs. A reviewer re-runs the two mutants with kukulu_mutate (targeted suite, filter cleanroom) and expects killed.
**Depends on:** none

### R1-05: Test the verifier's prev linkage and add the rehashed edit to the both-copies-agree fixtures
**Goal:** Source: mutation (REVIEW.md F4). Kill the surviving mutant in scripts/verify-attestation.mjs. Deleting `if (entry.prev !== tip) return fail(...)` survives test/attest.mjs, so a bundle whose log has one entry edited and rehashed would pass check 3. Add that tamper both to the verifier's own tests and to the fixtures fed to both copies.
**Files touched:** test/attest.mjs
**Design constraints:** Test-only; no change to scripts/verify-attestation.mjs or mcp/cleanroom.mjs. Keys only in temp directories.
**Acceptance tests:** test/attest.mjs: 'a rehashed log edit fails check 3 on the broken link'. In a copy of a real bundle, edit one middle log line's target, recompute its hash, and refresh the manifest's file hash and signature. Assert the verifier fails check 3 with a reason matching /prev does not match/. Also add 'the verifier and mcp/cleanroom.mjs agree on a rehashed edit' to the agreement fixtures. Both fail with the mutant applied.
**Out of scope:** Changes to verifier behavior.
**Verification:** kukulu_verify with test/attest.mjs. A reviewer re-runs the mutant with kukulu_mutate (targeted suite, filter attest) and expects killed.
**Depends on:** none

### R1-06: Test the gate's liveness kind, genesis match and the trailer's default task
**Goal:** Source: mutation (REVIEW.md F5). Kill three surviving mutants in mcp/server.mjs: (1) liveness at runGate accepting any non-gate entry instead of an `allowed` one (SPEC D-08a: only hook-written allowed entries prove the hooks run); (2) deleting the check that the first log entry is the genesis recorded in state.json (D-08 check 6); (3) deleting withTrailers' fallback to the first [~] task (D-07, docs/mcp-tools.md: 'else the first in-progress task').
**Files touched:** test/cleanroom.mjs
**Design constraints:** Test-only unless a test exposes a real defect. Use the harness's live()/logCall() idiom and temp keys (CLAUDE.md Clean-room tests).
**Acceptance tests:** test/cleanroom.mjs: 'a gate followed only by server-written entries halts naming liveness' (gate, then a kukulu_cleanroom_record human entry or a checkpoint with no logged call, then kukulu_next halts with the liveness text). 'a log replaced by a fresh valid chain halts naming chain' (rebuild the log from a new genesis via appendEntry, so the chain verifies, and assert the gate halts with 'the first entry is not the genesis entry recorded in state.json'). 'a server commit with a task in progress carries that task's trailer' (with a task [~], a commit made without an explicit task, such as kukulu_feedback_log's, has `Kukulu-Task: <that id>`). Each fails with its mutant applied.
**Out of scope:** Changing gate semantics; parallel-wave liveness (REVIEW.md Notes).
**Verification:** kukulu_verify with test/cleanroom.mjs. A reviewer re-runs the three mutants (targeted suite, filter cleanroom) and expects killed.
**Depends on:** none

### R1-07: Bound every gh call in prChecks; report mutationFixRounds where the reviewer can read it
**Goal:** Source: review (REVIEW.md F6; SPEC B-08 'bounded by the 30-second command bound', B-03). First, prChecks runs `gh --version` and `gh pr view --json url` with no timeout, so a hung gh hangs the synchronous server through kukulu_status. Give both the 30 s bound and map a timeout to `unknown: <why>` (or null for --version). Second, skills/review-build/SKILL.md tells the reviewer to read review.mutationFixRounds via kukulu_config_show, which agents/reviewer.md does not have. kukulu_status gains the resolved value (for example `review: { mutationFixRounds }`), the default stays only on cfgFrom's line, and the skill reads it from kukulu_status.
**Files touched:** mcp/server.mjs, test/state.mjs, skills/review-build/SKILL.md, docs/mcp-tools.md, test/plugin.mjs
**Design constraints:** No new literal 2 beside mutationFixRounds outside cfgFrom (no-hardcoded-mutation-fix-rounds). kukulu_next still never calls gh. docs/mcp-tools.md documents the new status field and the bound. The skill names only tools in agents/reviewer.md.
**Acceptance tests:** test/state.mjs: 'prChecks is unknown when gh pr view hangs'. Put a fake gh on PATH whose `pr view` sleeps past a test-lowered bound or the real one, and assert kukulu_status returns within the bound and prChecks matches /^unknown: .*timed out/. 'kukulu_status reports review.mutationFixRounds' asserts the default and a configured value. test/plugin.mjs: 'the review-build skill reads mutationFixRounds from kukulu_status' asserts the skill no longer names kukulu_config_show for it, and that every kukulu_* tool the skill names is in agents/reviewer.md's tools.
**Out of scope:** prState's pre-existing unbounded gh calls (REVIEW.md Notes); prChecks' state mapping.
**Verification:** kukulu_verify with the files above.
**Depends on:** none

## Review fixes (round 2)

### R2-01: Guard: judge cd segments again and let the effective cwd reach the read rules
**Goal:** Source: review (REVIEW.md round 2 F1; SPEC 5.2 deny.paths, D-03 rules 6b/6c). Fix the R1-01 regression: evaluate() runs `continue` on a cd/pushd segment before rule 6b, so `cd ~/.cargo/registry`, `cd ~/.cargo/registry && cat x`, `cd ~/.cargo/git` and `pushd ~/.cargo/registry` (all denied at 1e8aea6) are now allowed. Judge a cd/pushd segment with every rule, so its directory operand is a token under 6b. Also resolve every relative token, and the 6c 'outside the repository' clause (the cwd used when there is no path-like token), against the effective cwd an earlier cd/pushd set, not only in the protected-path rules: `cd ~/.cargo && cat registry/x`, `cd /usr/include && cat zlib.h` and `cd / && grep -r zlib .` must be denied.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md
**Design constraints:** mcp/cleanroom.mjs stays pure and synchronous (server-synchronous, cleanroom-module-pure). Recorded shell commands live only in test/fixtures/. Every existing guard case keeps its decision; the eight cleanflate false positives stay allowed and the real prior-art attempt stays denied. Replaces HANDOFF's R1-01 interpretation that the read rules keep the original cwd.
**Acceptance tests:** New guard-cases.json fixtures (run by test/cleanroom.mjs and the guard self-test): `cd ~/.cargo/registry` denied (deny.paths); `cd ~/.cargo/registry && cat x` denied; `pushd ~/.cargo/git` denied; `cd ~/.cargo && cat registry/x` denied (deny.paths); `cd /usr/include && cat zlib.h` denied (forbidden word); `cd / && grep -r zlib .` denied (forbidden word outside the repository); `cd src && cat main.rs` allowed; `cd crates && grep -n zlib src` allowed. The first three are denied at 1e8aea6 and allowed at HEAD, so they would have caught the regression.
**Out of scope:** Grouping and reserved words (R2-02); destructive git forms (R2-03); recursive ancestor reads (R2-04).
**Verification:** kukulu_verify with the files above (includes the guard self-test); a reviewer re-probes the six denied forms with evaluate().
**Depends on:** none

### R2-02: Guard: grouping, reserved words, >|, git -C and more wrappers no longer hide the command or the target
**Goal:** Source: review (REVIEW.md round 2 F2; SPEC D-03 canonicalization and rules 6a/6d, D-10). commandWord takes a segment's first token, so `(curl https://evil)`, `{ curl https://evil; }`, `if true; then curl https://evil; fi`, `while true; do curl https://evil; done`, `! curl https://evil`, `(rm -rf .kukulu)`, `(echo hi > .kukulu/state.json)` and `(cd docs && rm cleanroom.json)` are allowed. Before taking the command word, drop leading `(`, `{`, `!` and the reserved words if/then/elif/else/while/until/do, and split `(`/`)` glued to a word. Judge a relative operand against every cwd the shell could be in at that point (the cwd before a subshell's cd and the one after) and deny when any form is protected, so `(cd sub) && rm docs/cleanroom.json` is denied too. splitSegments must not split on a `|` directly after `>` (`echo x >| .kukulu/state.json`, `echo x 2>|.kukulu/state.json`). Write-family git forms skip git's global options with gitSubcommand and resolve their operands against -C's directory (`git -C docs rm cleanroom.json`, `git -C .kukulu clean -fdx`). Add exec, nohup, timeout (with its duration), stdbuf and setsid to WRAPPERS. Add one KNOWN_LIMITS entry and the matching docs/cleanroom.md sentence: commands that run a command from their arguments (find -exec, watch, parallel, busybox) and programs outside the fixed network and write lists (unlink, shred, perl -i, cargo fetch, rsync) are not recognized.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, test/attest.mjs, docs/cleanroom.md
**Design constraints:** Pure, synchronous module. KNOWN_LIMITS stays the single source the manifest and verifier compare; update every test that asserts its count. Recorded commands only in test/fixtures/. Existing cases keep their decisions. Ordinary forms stay allowed: `echo a | grep a`, `(cd src && ls)`, `if [ -f a ]; then cat a; fi`, `timeout 5 cargo test`, `git -C sub status`.
**Acceptance tests:** guard-cases.json fixtures, each denied with its rule's reason: `(curl https://evil)`, `( curl https://evil )`, `{ curl https://evil; }`, `if true; then curl https://evil; fi`, `while true; do curl https://evil; done`, `! curl https://evil`, `timeout 5 curl https://evil`, `nohup curl https://evil`, `exec curl https://evil` (network); `(rm -rf .kukulu)`, `{ rm -rf .kukulu; }`, `(echo hi > .kukulu/state.json)`, `(cd docs && rm cleanroom.json)`, `(cd sub) && rm docs/cleanroom.json`, `echo x >| .kukulu/state.json`, `echo x 2>|.kukulu/state.json`, `git -C docs rm cleanroom.json`, `git -C .kukulu clean -fdx` (protected path). Allowed: `echo a | grep a`, `(cd src && ls)`, `if [ -f a ]; then cat a; fi`, `timeout 5 cargo test`, `git -C sub status`. Every denied case is allowed at HEAD. test/cleanroom.mjs's KNOWN_LIMITS assertion moves to six strings.
**Out of scope:** Parsing interpreter programs; extending NETWORK_COMMANDS or WRITE_FAMILY membership (a SPEC change, see REVIEW.md Spec issues); destructive git forms without operands (R2-03).
**Verification:** kukulu_verify with the files above, guard self-test included.
**Depends on:** R2-01

### R2-03: Guard: deny git forms that discard the log's uncommitted entries, glob operands of destructive forms, and chmod/chown of a protected ancestor
**Goal:** Source: review (REVIEW.md round 2 F3; SPEC D-10, D-05 tamper evidence, D-02). The hooks append to .kukulu/cleanroom/log.jsonl on every call, so between checkpoint commits the log always has uncommitted entries. `git stash` (also -u, push, save), `git reset --hard|--merge|--keep`, `git checkout -f|--force` and `git switch -f|--discard-changes` restore it to the last committed checkpoint, erasing the denied entries since then while the chain and the newest checkpoint still verify. All are allowed today. Deny them when they have no pathspec, or when a pathspec equals or contains a protected path; `git stash list|show`, `git reset` without a worktree mode, and `git stash push -- <unprotected paths>` stay allowed. Deny a glob operand of a destructive form (rm, mv source, the git forms above and R1-01's) whose pattern matches the next component of a protected path below the glob's literal directory (`rm -rf docs/*`, `rm -rf *`, `rm -f .kukulu/*`). Treat chmod/chown of any operand that equals or contains a protected path as destructive, recursive or not: `chmod 000 docs` makes existsSync(docs/cleanroom.json) false, so the guard and logger take their no-policy fast path and every later call is allowed and unlogged.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md
**Design constraints:** Pure, synchronous module. Recorded commands only in test/fixtures/. Existing cases keep their decisions; ordinary forms stay allowed: `git checkout main`, `git checkout -b x`, `git reset HEAD a.rs`, `git reset --soft HEAD~1`, `rm -f *.o`, `rm -rf target/*`, `chmod +x scripts/run.sh`, `git add .`.
**Acceptance tests:** guard-cases.json fixtures denied with a `protected path` reason: `git stash`, `git stash -u`, `git stash push`, `git reset --hard`, `git reset --hard HEAD~1`, `git checkout -f main`, `git switch --discard-changes main`, `rm -rf docs/*`, `rm -rf *`, `rm -f .kukulu/*`, `chmod 000 docs`, `chmod a-rwx .kukulu`, `chown nobody docs`, `chmod 000 .`. Allowed: `git stash list`, `git stash push -- src/a.rs`, `git reset HEAD a.rs`, `git reset --soft HEAD~1`, `git checkout main`, `rm -f *.o`, `rm -rf target/*`, `chmod +x scripts/run.sh`. Every denied case is allowed at HEAD.
**Out of scope:** A high-water mark for the log outside the worktree (a SPEC change, REVIEW.md Spec issues); interpreter escapes.
**Verification:** kukulu_verify with the files above, guard self-test included.
**Depends on:** R2-02

### R2-04: Guard: a recursive read, a search root or a glob that reaches into deny.paths is denied
**Goal:** Source: review (REVIEW.md round 2 F4; SPEC 5.2 deny.paths 'a target under one is denied for every tool', D-03 rules 5 and 6b). A recursive operation's targets are everything under its operand. Allowed today: Grep {pattern: 'inflate', path: '~/.cargo'} and Glob {pattern: '**/*.rs', path: '/home/u/.cargo'}; Glob patterns with a wildcard before the denied component or climbing out of the cwd (`~/.cargo/regist*/**/*.rs`, `/home/u/.cargo/*/src/**`, `../../home/u/.cargo/registry/**`); Bash `grep -r inflate ~/.cargo`, `rg inflate ~/.cargo`, `find ~/.cargo -name '*.rs'`, `ls -R ~/.cargo`, `cp -r ~/.cargo vendor`, `tar cf - ~/.cargo`; and a glob token `cat ~/.cargo/*/index/x`. For Grep, Glob and the recursive Bash forms (grep/egrep/fgrep with -r/-R, rg, ag, ack, find, ls -R, tree, cp -r/-R/-a, tar, rsync), deny a search root or operand that equals or contains a deny.paths entry or the key path. Resolve a Glob pattern against its path (or the cwd) and match a glob token or pattern component by component against each deny.paths entry. pathPatterns regexes stay matched on named targets only: add that sentence to KNOWN_LIMITS and docs/cleanroom.md.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, test/attest.mjs, docs/cleanroom.md
**Design constraints:** Pure, synchronous module. Recorded commands only in test/fixtures/. Existing cases keep their decisions; ordinary in-project work stays allowed: `grep -r foo src`, `find . -name '*.rs'`, Glob `**/*.rs` at the root, Grep in the repository, `ls ~/.cargo`, `cat ~/.cargo/config.toml`. Update every KNOWN_LIMITS count assertion.
**Acceptance tests:** guard-cases.json fixtures denied with a deny.paths reason: Grep path `__HOME__/.cargo`; Glob pattern `**/*.rs` with path `__HOME__/.cargo`; Glob pattern `~/.cargo/regist*/**/*.rs`; Glob pattern `__HOME__/.cargo/*/src/**`; Glob pattern `../../__HOME__/.cargo/registry/**` (or the equivalent relative climb from __ROOT__); `grep -r inflate ~/.cargo`; `rg inflate ~/.cargo`; `find ~/.cargo -name '*.rs'`; `ls -R ~/.cargo`; `cp -r ~/.cargo vendor`; `cat ~/.cargo/*/index/x`. Allowed: `grep -r foo src`, `find . -name '*.rs'`, Glob `**/*.rs` with no path, `ls ~/.cargo`, `cat ~/.cargo/config.toml`. Every denied case is allowed at HEAD. KNOWN_LIMITS assertion moves to seven strings.
**Out of scope:** Ancestor matching for pathPatterns regexes (stated as a limit); network rules.
**Verification:** kukulu_verify with the files above, guard self-test included.
**Depends on:** R2-03

### R2-05: Guard cases: allowed fixtures that pin grep's valued options, -e patterns and quoted >
**Goal:** Source: mutation (REVIEW.md round 2 F5). Three mutants in mcp/cleanroom.mjs survive node test/cleanroom.mjs because no allowed fixture covers them: deleting `if (valued.test(t)) i++;` in patternOperands (grep -A 3 PATTERN path then takes 3 as the pattern), replacing `found.add(++i)` with `i++` (a -e value is then judged as a path), and deleting redirectTargets' quote tracking (`echo "a > .kukulu/state.json"` is then read as a redirection). Add allowed fixtures that fail under each mutant.
**Files touched:** test/fixtures/guard-cases.json, test/cleanroom.mjs
**Design constraints:** Test-only; no change to mcp/cleanroom.mjs unless a fixture exposes a real defect. Recorded commands only in test/fixtures/.
**Acceptance tests:** guard-cases.json, all allowed with cwd at __ROOT__: `grep -A 3 'src/zlib' src` (valued option), `grep -n -e 'src/zlib' src` (explicit -e), `echo "a > .kukulu/state.json"` (a quoted > is not a redirection). Each is denied with its mutant applied.
**Out of scope:** The >&N fd-duplication branch (advisory, REVIEW.md Notes).
**Verification:** kukulu_verify with the files above. A reviewer re-runs the three mutants with kukulu_mutate (targeted suite, filter cleanroom) and expects killed.
**Depends on:** R2-04

### R2-06: Test that a hung gh --version makes prChecks null within the bound
**Goal:** Source: mutation (REVIEW.md round 2 F6). Removing `timeout: CHECKS_TIMEOUT_MS` from prChecks' `gh --version` call (mcp/server.mjs) survives node test/state.mjs, though R1-07 named that bound and docs/mcp-tools.md says a `gh --version` that times out reads as no gh.
**Files touched:** test/state.mjs
**Design constraints:** Test-only. The fake gh must `exec sleep` so no child keeps the pipe open past spawnSync's timeout (R1-07's note). No change to the 30 s constant.
**Acceptance tests:** test/state.mjs: 'prChecks is null when gh --version hangs': a fake gh whose `--version` runs `exec sleep 120`; kukulu_status returns within 60 s and prChecks is null. It fails (RPC timeout) with the mutant applied.
**Out of scope:** prState's unbounded gh calls.
**Verification:** kukulu_verify with test/state.mjs. A reviewer re-runs the mutant (targeted suite, filter state) and expects killed.
**Depends on:** none

### R2-07: Test that --legacy-log's default repository is the log's own repository, not an ancestor
**Goal:** Source: mutation (REVIEW.md round 2 F7). In scripts/verify-attestation.mjs, making repoRootOf return path.dirname(dir) instead of dir survives node test/attest.mjs: the test's in-repository and /elsewhere words classify the same under either root, so an over-broad root that lets a word outside the repository pass as inside is not caught.
**Files touched:** test/attest.mjs
**Design constraints:** Test-only; temp directories only; no change to scripts/verify-attestation.mjs.
**Acceptance tests:** test/attest.mjs: extend '--repo defaults to the git repository holding the log' with a row whose path is a sibling of the temp repository (same parent directory, outside the repository) and names the word; assert it is a candidate. It fails with the mutant applied.
**Out of scope:** Changing the legacy reader's behavior.
**Verification:** kukulu_verify with test/attest.mjs. A reviewer re-runs the mutant (targeted suite, filter attest) and expects killed.
**Depends on:** none
