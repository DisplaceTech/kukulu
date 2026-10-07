# Foundry 0.5.0 build plan

Derived from docs/SPEC.md v0.5.0 on 2026-10-07. SPEC.md wins over this file.

## Decisions

- SPEC §9 Q1, what happens after signing fails → as the operator settled it: flip signing off for the rest of the run (S-02), keep the PR draft, and do nothing past the flight until a human unlocks signing and finalizes with a re-sign (S-14). Recorded as given; not reopened.
- SPEC §9 Q2, S-07 on `baseBranch` → allowed, as the operator settled it. An archive on `main` after a merge is deliberate and just as reviewable.
- SPEC §9 Q3, S-06 refusal format → both, as the operator settled it. `ToolError` gains an optional `data` object; `tools/call` returns it as `structuredContent` (`{ problems: [{ check, id?, message }] }`) next to the usual text on the `isError` result, and the text is one numbered list of every problem.
- Phases → SPEC §8's three phases, in order. Task ids use SPEC's phase numbers (`P1-xx`, `P2-xx`, `P3-xx`); there is no Phase 0. Rationale: the ids then match SPEC's own phase names.
- Parallel streams → none; the plan is fully serial. Every server task edits `mcp/server.mjs` (SPEC §4), and every skill and documentation task adds assertions to `test/plugin.mjs`, a shared hotspot.
- The first task (P1-01) does S-10 and also keeps Foundry's own flight artifacts out of this repository's checks. Rationale: on a clean checkout of `main` today `npm test` fails, because `test/plugin.mjs` checks that every `foundry_*` name in `docs/*.md` exists, and `docs/SPEC.md` names three tools this flight has not built yet; and the MCP writes `PROGRESS.md` log headings without a blank line after them, which `pre-commit run --all-files` (markdownlint) rejects from the first `foundry_task_done` on. SPEC says S-10 must be first, so both fixes ride in the same task (Spec issues 1 and 2).
- Test ownership → no new suite; the count stays "eleven suites" (SPEC §4). `foundry_plan_commit` is tested in `test/state.mjs`; the commit helper in `test/implement.mjs`; rollback in `test/review.mjs` and `test/implement.mjs`; `foundry_flight_archive`, `foundry_pr_finalize` and all `foundry_mutate` changes in `test/review.mjs`; the new `foundry_status` fields and `foundry_flight_options({ resume })` in `test/state.mjs`. P3-04 updates CONTRIBUTING.md's suite table to match.
- Interim tool counts → each tool-adding task sets the count to the number of tools the server then defines (nineteen after P1-10, twenty after P1-12, twenty-one after P1-13), in `test/plugin.mjs` and in words on the first line of `docs/mcp-tools.md`. Rationale: principle 8 moves docs with code, and a blocked task must not leave a wrong count behind.
- Tool order in `TOOLS` (and `EXPECTED_TOOLS`) → `foundry_plan_commit` directly after `foundry_next`; `foundry_flight_archive` then `foundry_pr_finalize` directly after `foundry_summary_commit`. Rationale: the list is in pipeline order.
- `from` on `build` and `parallel.setup` entries → refused. SPEC accepts it on `verify` and `extraVerify` only; a gate on a command Foundry never runs per task has no meaning.
- Which task state a stream-scoped call reads for `from` (S-03, "the stream's own view") → `docs/PROGRESS.md` in the main checkout, which every stream-scoped tool already treats as authoritative. A worktree's copy is stale by design.
- Commit helper policy source (S-02) → `cfg().policies.signing`, falling back to `"auto"` when the config cannot be read. Rationale: the planner's commit happens before any run has recorded `state.policies`.
- Signing failure detection (S-02) → a commit that failed and either timed out or printed a line matching `/gpg failed to sign|failed to sign|signing failed|cannot exec|pinentry|ssh-keygen|gpg:/i`. Every other commit failure throws, as today.
- Feedback stage of the helper's `signing` entry → the calling tool's stage (`review`, `summarize`, `plan`, or `implement` by default), passed in as an option.
- `state` after an archive (S-07) → `DEFAULT_STATE` plus `archived: { slug, dir, at }`, and `signingOverride: true` carried over when it was set. Rationale: `foundry_pr_finalize` runs after the archive and must find the archived flight's summary state and `foundry.json` (Spec issue 4); the local `commit.gpgsign` override outlives the flight, so the flag that describes it must too (Spec issue 6).
- `foundry_next` after an archive → `done` while `docs/SPEC.md` is byte-identical to the archived copy, and `plan` once the operator edits it. Rationale: with `policies.archive: true` the controller calls `foundry_next` straight after the summarizer, and returning `plan` would re-plan the flight that just finished (Spec issue 3).
- `foundry_pr_finalize` ordering with `resign: true` → clear the local override *before* `probeSigning("required")` and put it back if the probe or the rebase fails. Rationale: the probe reads `commit.gpgsign`, which the override forces to `false` (Spec issue 5).
- The human's steps "in SUMMARY" (S-14) → `foundry_pr_finalize` appends a `## Awaiting signing` section with the steps to the flight's SUMMARY.md (or the archived copy) in the same commit as its state. Rationale: SUMMARY.md is committed before `foundry_pr_finalize` runs, so the summarizer cannot know the outcome when it writes it; the server can, deterministically (Spec issue 7).
- `foundry_pr_finalize` details → it runs `gh pr ready` only on a draft PR (an already-ready PR counts as ready); `merge` is one of `"enabled"`, `"skipped: breaking"`, `"skipped: policy"`, `"skipped: no pull request"`, `"skipped: awaiting signing"`, `"unavailable: <gh's first line>"`; a non-resign call whose signed check passes also clears `awaitingSigning` and any recorded override, so the manual re-sign path ends in the same state as `resign: true`.
- Recognising a round-cap halt (S-09) → `foundry_review_submit` records `state.haltCap` (`{ cap, round, nonConverging }`) next to `state.halted`; `resume` only ever clears a halt that carries one.
- go-flight's "continue, allow N rounds" → `foundry_flight_options({ maxRounds: N, maxRoundsHard: N, resume: true })`, the same both-bounds mapping go-flight already uses for "max review rounds N", so it lifts whichever cap fired.
- go-flight's `flight=<slug>` → the controller appends one sentence, `Flight slug: <slug>.`, to the plan stage's prompt; it is the only change the controller ever makes to a prompt.
- The summarizer's final status word when the PR ends neither ready nor merging (finalize policy `draft`, or no PR) → `PR UNCHANGED: <merge value>`, next to SPEC's `READY`, `AUTO-MERGE ON` and `AWAITING SIGNING`.
- `⚠️ ASSUMPTION` values → `policies.archive` (default `false`) is a config key validated in `cfg()`; the sweep size "at least three" lives only in the review-build skill, and the 60-line `CLAUDE.md` budget only in the plan-build skill, as SPEC §5 says. No tuning task: none of them can be measured inside an unattended flight (each needs real flights after release). They stay listed as guesses for HANDOFF and SUMMARY.
- `lastReviewCommit` (S-08) → the short sha of the newest commit in `<baseBranch>..HEAD` whose subject starts `review:`; `null` when there is none or the range cannot be read.
- `artifacts` (S-08) → keyed by file name (`SPEC.md`, …, `foundry.json`); a file not on disk is `"absent"`, even if git still tracks it. `strayArtifacts` uses the same names.
- "Under 1 MiB" (S-01) → `Buffer.byteLength(content, "utf8") < 1048576`.
- The draft PR's body is `docs/HANDOFF.md` (`foundry_run_finish` passes it to `gh pr create`), so the "not to be merged" statement SPEC §8 Phase 3 asks for goes at the top of HANDOFF.md (CLAUDE.md, Task protocols).

## Conventions

- One commit per task, titled `<ID>: <title>`, body per CLAUDE.md's Commit template.
- Every task runs the whole verify: `npm run lint`, `pre-commit run --all-files`, `npm test` (about 90 s; configured with `timeoutMs: 600000`). There is no `extraVerify`.
- "The commit helper" means P1-02's `commitStaged`, reached through `gitCommitIfChanged`; "the rollback helper" means P1-03's `withRollback`.
- Each task's text restates the names it needs from earlier tasks; the implementer never has to read another task.
- The plan is fully serial.

## Phase 1 — server mechanics

### P1-01: Opus routing defaults, and flight artifacts out of the plugin's own checks

**Goal:** Planner, reviewer and summarizer default to `opus` (S-10), and this flight's own artifacts stop failing `npm test` and `pre-commit run --all-files`.

**Files touched:** `agents/planner.md`, `agents/reviewer.md`, `agents/summarizer.md`, `templates/foundry.config.example.json`, `test/routing.mjs`, `test/plugin.mjs`, `.pre-commit-config.yaml`, `README.md`, `docs/architecture.md`, `docs/routing.md`

**Design constraints:**

- SPEC §5 "Routing defaults (S-10)" and §6 S-10. The three agent files change to `model: opus`, with efforts unchanged (planner `high`, reviewer `high`, summarizer `medium`). The implementer stays `sonnet` / `medium`.
- `fable` stays a legal alias everywhere it is accepted today. Do not touch `ANTHROPIC_ALIASES`, `AGENT_TOOL_ALIASES` or `CLAUDE_FAMILY` in `mcp/server.mjs`, and keep `fable` in `test/plugin.mjs`'s `MODELS`.
- `templates/foundry.config.example.json`: the `roles` block mirrors the new defaults.
- README.md: the routing note ("planner and reviewer use `fable` …"), the defaults sentence ("default: `planner` (fable, high) …") and the Mermaid labels (`planner<br/>fable · high`, `reviewer<br/>…`, `summarizer<br/>…`) say `opus`.
- docs/architecture.md, "Why the models are split this way": the table says `opus` for planner, reviewer and summarizer; add one short paragraph under it giving the reason from SPEC §6 S-10 (Opus has outperformed Fable on the plan, review and summary roles in the operator's own flights; the table's "why" column still holds).
- docs/routing.md: the example `roles` block and the "Starting points" table say `opus`. Leave docs/operations.md's calibration table (`plan (fable)` rows) alone: it records what actually ran.
- Constraint `no-fable-default` (CLAUDE.md) holds from this task on.
- `test/plugin.mjs`: add `const FLIGHT_ARTIFACTS = ["docs/SPEC.md", "docs/PLAN.md", "docs/PROGRESS.md", "docs/HANDOFF.md", "docs/REVIEW.md", "docs/SUMMARY.md"]` with a comment saying why (these files describe a flight, and a flight's spec names tools it has not built yet). Exclude them from the loop that checks `foundry_*` and `foundry:*` names only. The relative-link check, the box-drawing check and the README-reachability check keep covering them.
- `.pre-commit-config.yaml`: give the `markdownlint` hook `exclude: '^docs/(PLAN|PROGRESS|HANDOFF|REVIEW|SUMMARY)\.md$|^docs/flights/'`, with a comment: the MCP writes these files (log headings with no blank line after them), so they cannot be kept lint-clean by hand, and `docs/flights/` will hold archived copies of them (S-07).
- No change to `mcp/server.mjs`.

**Acceptance tests:**

- `test/routing.mjs`: a new block in the "defaults, no global file" section, "plugin defaults: opus for planner, reviewer and summarizer, sonnet for the implementer", asserting model and effort for all four roles. The two existing assertions that expect an untouched planner to be `"fable"` (the profile test near line 321 and the generated-file test near line 331) expect `"opus"`.
- `test/plugin.mjs`: the existing "every foundry_* tool named in prose exists on the server" passes with `docs/SPEC.md` present; a new assertion per agent, "agents/<name> does not default to fable".
- All eleven suites pass, and `pre-commit run --all-files` passes.

**Out of scope:** any server change; docs/mcp-tools.md; the skills; docs/operations.md; anything under `docs/plans/` or `docs/feedback/`.

**Verification:** `foundry_verify` (all three commands). `grep -n "fable" agents/*.md templates/foundry.config.example.json` prints nothing.

**Depends on:** none

### P1-02: One commit helper with a bounded, prompt-free unsigned fallback

**Goal:** Every commit the server makes runs through one helper that cannot hang on a pinentry, retries once unsigned under `policies.signing: "auto"`, and throws under `"required"` (S-02).

**Files touched:** `mcp/server.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`, `docs/operations.md`

**Design constraints:**

- SPEC §6 S-02, bullets 1 and 4. Constraints `server-synchronous` and `no-dependencies` (CLAUDE.md): `spawnSync` only.
- Add `const SIGNING_TIMEOUT_MS = 30_000;` and use it in `probeSigning` in place of its literal `30_000`.
- New helper `commitStaged(rels, message, { stage } = {})`, called from `gitCommitIfChanged` in place of its bare `git(["commit", …])`. `gitCommitIfChanged(paths, message, { stage } = {})` keeps its return value (short sha, or `null` when nothing changed) for every existing caller.
- The helper runs `git commit -q -m <message> -- <rels>` with `spawnSync("git", …, { cwd: ROOT, encoding: "utf8", timeout: SIGNING_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })`.
- A signing failure is a failed commit that either timed out (`r.error?.code === "ETIMEDOUT"`, or `r.signal` set) or printed a stderr line matching `/gpg failed to sign|failed to sign|signing failed|cannot exec|pinentry|ssh-keygen|gpg:/i`. Any other failure throws `ToolError` with git's message, as today.
- The policy is `cfg().policies.signing`; if `cfg()` throws, use `"auto"` (the same approach as `feedbackEnabled()`).
- On a signing failure under `"auto"`:
  1. `git config --local commit.gpgsign false`;
  2. `st = loadState()`, `st.signing = "off (commit signing failed: <first stderr line, or 'timed out'>)"`, `st.signingOverride = true`, `saveState(st)`;
  3. if `policies.feedback` is on, `appendFeedback(stage || "implement", "Signing disabled for this run: " + st.signing, "signing", "auto")`;
  4. `git add -A` the caller's rels plus `.foundry/state.json` and `.foundry/feedback.jsonl` (whichever exist), then retry once with `git -c commit.gpgsign=false commit -q -m <message> -- <all of them>`. The record lands in the same commit as the caller's change. If the retry fails, throw `ToolError`.
- Under `"required"`, throw `ToolError("policies.signing is 'required' and the commit could not be signed: <line>. Nothing was committed; fix the signing agent or set policies.signing to 'off', then call this tool again.")`.
- In `startRun`, when `probeSigning` returns a value starting `off (probe failed`, also set `st.signingOverride = true`. Only a *failed* signing sets the flag, never policy `off` (S-02 bullet 4).
- Callers that know their stage pass it: `reviewSubmit` passes `"review"`, `summaryCommit` passes `"summarize"`, `feedbackLog` passes its own `stage` argument. Everything else uses the default.
- docs/mcp-tools.md: the intro says every Foundry commit runs with no terminal prompt and a 30-second bound, and falls back once to unsigned under `auto`, recording `state.signing` and `state.signingOverride`. docs/operations.md: the `policies.signing` row says the same.

**Acceptance tests** (`test/implement.mjs`, new section "commit signing (S-02)"; follow the signing test protocol in CLAUDE.md):

- "auto: a Foundry commit whose signing fails is retried unsigned": a planned repo with no run started and a failing signer; `foundry_feedback_log` succeeds; HEAD's subject is `chore: pipeline friction (plan)`; the committed `.foundry/state.json` has `signing` matching `/^off \(commit signing failed: /` and `signingOverride: true`; `git config --local commit.gpgsign` is `false`; feedback.jsonl holds the logged entry plus exactly one `category: "signing"` entry; `git status --porcelain` is empty.
- "required: a Foundry commit whose signing fails throws": the same setup with `policies.signing: "required"`; `foundry_flight_options({ maxRounds: 5 })` is an error matching `/'required'.*could not be signed/`; HEAD is unchanged.
- The existing run-start auto-fallback test also asserts `state.signingOverride === true`; the existing `policies.signing: "off"` test asserts `signingOverride` is not `true`.
- Every existing suite still passes.

**Out of scope:** snapshot and rollback (P1-03); what any tool commits or its commit message; the implement skill's own manual fallback paragraph.

**Verification:** `foundry_verify`.

**Depends on:** none

### P1-03: Snapshot and restore around every writing tool

**Goal:** A tool whose final commit throws leaves every file it wrote, and the index, exactly as it found them, so `foundry_review_submit` becomes all-or-nothing (S-02).

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-02, bullets 2 and 3; §3 principle 6. Constraint `server-synchronous`.
- One helper, `withRollback(paths, fn)`. Before `fn` runs, snapshot each absolute path: its bytes (a Buffer) or "absent". Run `fn` and return its result. If it throws: write every snapshot back (recreating parent directories; deleting a path that was absent), unstage with `git reset -q -- <repo-relative paths>` (`allowFail: true`; drop paths git does not know if `git reset` refuses them), then rethrow the original error. Never copy this logic into a tool.
- Wrap the write-then-commit section of each of these, snapshotting every path it writes before the first write:
  - `reviewSubmit`: `docs/REVIEW.md`, `docs/PLAN.md`, `docs/PROGRESS.md`, `.foundry/state.json`, `.foundry/feedback.jsonl`. REVIEW.md is the reviewer's file: restoring the snapshot keeps its content, and only its staging is undone.
  - `taskDone`, `taskReopen`, `runHalt`, `flightOptions`, `summaryCommit`: the files each one writes.
  - `taskBlock`: only the PROGRESS.md write and commit. Its `reset --hard`/`clean` of the failed attempt stays outside, on purpose.
  - `startRun`: `.gitignore`, `docs/PROGRESS.md`, `.foundry/state.json`, `.foundry/feedback.jsonl`. The branch checkout is not undone.
  - `runFinish`: its HANDOFF.md commit and its state commit.
- Every later tool that writes and commits (P1-04 onward) reuses `withRollback`.
- Refusals that happen before any write stay before any write.
- A push only ever follows a successful commit, so there is nothing to undo there.
- docs/mcp-tools.md: the intro says a tool whose commit fails leaves the tree as it found it; the `foundry_review_submit` section says it is all-or-nothing and safe to call again.

**Acceptance tests:**

- `test/review.mjs`, "review_submit rolls back when its commit fails (project-d F-04)": `plannedRepo` with `policies.signing: "required"`, `setState({ implemented: true })`, a REVIEW.md stamped `Round: 1`, and a failing signer (CLAUDE.md signing test protocol). `CHANGES REQUESTED` with one fix task is an error. Afterwards PLAN.md, PROGRESS.md and state.json are byte-identical to before the call, REVIEW.md keeps its content, `git diff --cached --name-only` is empty, and HEAD is unchanged. Then `git config commit.gpgsign false`, and the same submission succeeds: PLAN.md contains `## Review fixes (round 1)` exactly once and PROGRESS.md contains `R1-01` exactly once.
- `test/implement.mjs`, "task_done rolls back when its progress commit fails": a started run, a task committed as `P0-01: …`, then a `.git/hooks/commit-msg` that rejects any message starting `progress:` (follow the commit-failure test protocol in CLAUDE.md). `foundry_task_done` is an error; PROGRESS.md is byte-identical (the task is still `[~]`), nothing is staged, HEAD is the task commit.
- `test/implement.mjs`, "flight_options rolls back when its commit fails": a hook rejecting `chore: flight options`; `docs/foundry.json` is byte-identical afterwards.

**Out of scope:** new tools; changing what any tool commits or its messages.

**Verification:** `foundry_verify`.

**Depends on:** P1-02

### P1-04: foundry_summary_commit writes SUMMARY.md from content

**Goal:** `foundry_summary_commit` accepts the summary as a `content` argument and writes `docs/SUMMARY.md` itself, so the summarizer never needs `Write` (S-01).

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-01. Constraint `server-synchronous`. Principle 6: validate, then mutate.
- New optional argument `content` (schema: `{ type: "string", description: "the full text of docs/SUMMARY.md; the tool writes the file itself, so never Write it yourself" }`).
- Order of checks, all before any write: the existing `verdict !== "APPROVED"` refusal first; then, when `content` is given, it must be a string, non-empty after trimming, and `Buffer.byteLength(content, "utf8") < 1048576` (a named constant `SUMMARY_MAX_BYTES = 1024 * 1024`), each with its own refusal message; when `content` is absent, the existing "docs/SUMMARY.md does not exist" refusal.
- With `content`: write docs/SUMMARY.md (adding a final newline if missing) and commit exactly as today (`chore: build summary`), inside the rollback helper `withRollback` over SUMMARY.md, state.json and feedback.jsonl. Without it: unchanged 0.4.0 behavior, reading the file from disk.
- `PROMPTS.summarize` becomes: "Run the Foundry summarize stage. The review is APPROVED. Compose docs/SUMMARY.md as your summarize instructions specify and pass its full text as `content` to foundry_summary_commit, which writes and commits it; do not write the file yourself. Do not merge." followed by the policy sentence.
- The return shape is unchanged.
- docs/mcp-tools.md, `foundry_summary_commit`: the `content` argument, its limits and refusals, and that it is the preferred form.

**Acceptance tests** (`test/review.mjs`, approval section):

- "summary_commit writes SUMMARY.md from content": after an APPROVED review, with no SUMMARY.md on disk, `content: "# Summary\n…"` commits `chore: build summary` containing exactly that text.
- "content is refused before APPROVED, and nothing is written": with verdict `CHANGES REQUESTED`, the call is an error and docs/SUMMARY.md does not exist afterwards.
- "empty content is refused", "content of 1 MiB or more is refused", "non-string content is refused": each an error, with no file written.
- The existing tests that write SUMMARY.md to disk and call with no arguments still pass.

**Out of scope:** the summarize skill (P2-01); archiving; finalizing.

**Verification:** `foundry_verify`.

**Depends on:** P1-03

### P1-05: from: constraints and commands that activate at a task

**Goal:** A constraint, or a `verify`/`extraVerify` command, can name the task that makes it true with `from`, and stays inactive until that task starts (S-03).

**Files touched:** `mcp/server.mjs`, `test/constraints.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`, `docs/operations.md`

**Design constraints:**

- SPEC §5 table (`constraints[].from`, `extraVerify[prefix][]` object form `.from`) and §6 S-03. Constraint `server-synchronous`. Principle 7: no silent defaults.
- `CONSTRAINT_KEYS` gains `"from"`. `normalizeCommand` accepts `from` on the object form of `verify` and `extraVerify` entries and returns `{ cmd, timeoutMs, exclusive, from }`, with `from: null` by default. A `from` key on a `build` or `parallel.setup` entry is refused: `<where>.from is only valid on verify and extraVerify entries` (pass an `allowFrom` flag into `normalizeCommand`).
- A `from` value must be a string matching `/^[PR]\d+-\d+$/` (a fresh, non-global regex; never call `.test` on the global `TASK_ID`), else refuse with `<where>.from must be a task id such as P1-03`. When docs/PLAN.md exists, the id must have a `### <id>:` heading in it, else refuse with `<where>.from names <id>, which is not a task in docs/PLAN.md`.
- A rule is active when its `from` is null; when docs/PROGRESS.md does not exist; when no task is open (`counts(...).open === 0`); when the task is missing from PROGRESS.md; or when the task is `[~]` or `[x]`. It is inactive when the task is `[ ]`, `[!]` or `[-]`. Put this in one function, `inactiveUntil(from, pr)`, returning `null` (active) or the id.
- Task state always comes from docs/PROGRESS.md in the main checkout (`parseProgress()`), including for `foundry_verify({ stream })`.
- `checkConstraints` self-tests every rule's fixtures, active or not. An inactive rule that passes its self-test returns `{ id, ok: true, inactive: "until <from>", fixture: null, hits: [] }` without scanning. A rule whose fixtures fail still fails, active or not.
- `verify` and `mutate`: an inactive command is not run, and appears in `results`, in its place, as exactly `{ cmd: <cmd>, skipped: "inactive until <from>" }`. It never counts as a failure, and never as a kill.
- `runFinish`'s whole-tree scan applies the same rule.
- docs/mcp-tools.md: the `foundry_verify`, `foundry_mutate` and `foundry_run_finish` result shapes. docs/operations.md: `from` in the `verify` and `extraVerify` rows of the configuration table, and in the Constraints section.

**Acceptance tests:**

- `test/constraints.mjs`, "from gates a constraint on its task": a rule with `from: "P0-02"` whose pattern hits a committed file. `foundry_verify` is ok with the rule reported `inactive: "until P0-02"` while P0-02 is `[ ]`, `[!]` or `[-]`; it fails with the hit while P0-02 is `[~]` or `[x]`; and it fails once no task is open.
- `test/constraints.mjs`, "an inactive rule still self-tests": an inactive rule with a broken `shouldMatch` fixture fails, with `fixture` set.
- `test/constraints.mjs`, refusals, each asserting its message: a `from` naming a task not in PLAN.md (the message names it), a malformed `from` (`"step 2"`), `from` on a `build` entry, `from` on a `parallel.setup` entry.
- `test/implement.mjs`, "from gates an extraVerify command": an extraVerify entry `{ "cmd": "false", "from": "P0-02" }` under a prefix the task touches. While P0-02 is `[ ]`, `foundry_verify` is ok and `results` contains `{ cmd: "false", skipped: "inactive until P0-02" }`; once it is `[~]`, verify fails.

**Out of scope:** the plan-build skill and writing-specs.md (P2-03, P3-03); `foundry_plan_commit` (P1-10).

**Verification:** `foundry_verify`.

**Depends on:** none

### P1-06: Targeted mutation commands

**Goal:** `foundry_mutate` can run a configured, filterable test command instead of the full verify set (S-04).

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `docs/operations.md`

**Design constraints:**

- SPEC §5 table (`mutation.targeted`) and §6 S-04. Constraint `server-synchronous`. Principle 7.
- New `validateMutation(mutation)`, called from `cfg()`: `undefined` is fine; otherwise it must be an object whose only key is `targeted`; `targeted` is an object mapping a name to an object whose only keys are `cmd` and `timeoutMs`; `cmd` is a non-empty string containing `{filter}` exactly once; `timeoutMs`, if present, is a positive integer. Every refusal names the entry, e.g. `docs/foundry.json mutation.targeted.php.cmd must contain {filter} exactly once`. Unknown keys are refused at both levels.
- `cfg()` returns `mutation: { targeted: { <name>: { cmd, timeoutMs } } }`, with `timeoutMs` defaulting to `commandTimeoutMs`.
- `mutate` gains `targeted` (string) and `filter` (string). Both or neither (`targeted and filter must be passed together`); never together with `commands`. An unknown name, or a `filter` that fails `/^[A-Za-z0-9_.:\\/-]{1,200}$/` (a named constant), is refused, and the message lists the legal names (or says none are configured). Every refusal comes before the file is touched.
- Substitution: `cmd.replace("{filter}", "'" + filter + "'")`, one single-quoted shell word; the regex admits no quote, so the word cannot be broken out of. The targeted command runs instead of the file's verify commands; the per-call `timeoutMs` still only ever shortens it.
- `test/plugin.mjs`'s "config keys documented" loop gains a `mutation` branch that checks docs/operations.md mentions `` `mutation.targeted` ``.
- docs/mcp-tools.md: the new arguments, refusals and substitution. docs/operations.md: a `mutation.targeted` row in the configuration table.

**Acceptance tests** (`test/review.mjs`, the foundry_mutate section):

- "a targeted command runs instead of verify": `verify: ["false"]` and `mutation.targeted.unit = { cmd: "echo FILTER={filter}" }`; a mutation with `targeted: "unit", filter: "tests/Unit/FooTest.php"` survives (verify was not run), and the result's stdout tail contains `FILTER=tests/Unit/FooTest.php`.
- Refusals, each asserting its message and that the file is unchanged: `targeted` without `filter`; `filter` without `targeted`; `targeted` with `commands`; an unknown name (the message lists `unit`); a filter of `"a;rm -rf x"`.
- Config refusals: `{filter}` absent, `{filter}` twice, an unknown key under `mutation`, an unknown key in an entry, a non-integer `timeoutMs`.

**Out of scope:** `failedCommands`/`confirmKill` (P1-07); the review skill (P2-02).

**Verification:** `foundry_verify`.

**Depends on:** none

### P1-07: failedCommands and confirmKill in foundry_mutate

**Goal:** `foundry_mutate` names the commands that failed and can re-run them on the unmutated tree to tell a real kill from a test that fails anyway (S-05).

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-05. Constraint `server-synchronous`.
- Every result carries `failedCommands`: the command string of every result that is not ok (skipped entries are never failures).
- New argument `confirmKill` (boolean; anything else is refused). When the mutant was killed and `confirmKill` is true: after the file is restored and the residue undone, re-run each failed command once, with the same command text (the substituted one for a targeted run) and timeout, on the unmutated tree; then undo residue again against the same `before` snapshot; return the re-runs as `confirm`.
  - If every re-run passes, the kill stands (`killed: true`, the usual verdict).
  - If any fails again: `killed: false`, `inconclusive: true`, `verdict: "inconclusive: <that cmd> also fails without the mutation"` (the first such command).
- `confirm` is absent when nothing was re-run (a survivor, or no `confirmKill`).
- docs/mcp-tools.md: `failedCommands`, `confirmKill`, `confirm`, `inconclusive`.

**Acceptance tests** (`test/review.mjs`, the foundry_mutate section):

- "failedCommands names what failed": a kill without `confirmKill` returns `failedCommands` with the failing command.
- "a confirmed kill stands": verify is a test that fails only while the mutation is present; with `confirmKill: true`, `killed` is true and every `confirm` entry is ok.
- "a kill by a command that always fails is inconclusive": `verify: ["false"]`; with `confirmKill: true` the result has `killed: false`, `inconclusive: true`, and a verdict matching `/^inconclusive: false also fails without the mutation/`.
- "confirmKill on a survivor re-runs nothing": no `confirm` field.
- A non-boolean `confirmKill` is refused.

**Out of scope:** targeted commands (P1-06); the review skill (P2-02).

**Verification:** `foundry_verify`.

**Depends on:** none

### P1-08: foundry_status reports artifacts, strayArtifacts and lastReviewCommit

**Goal:** `foundry_status` says where each planner artifact came from, flags leftovers of an interrupted plan run, and names the last review commit (S-08).

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-08. Constraint `server-synchronous`. Read-only: `status()` writes nothing.
- `artifacts`: an object with exactly the keys `SPEC.md`, `PLAN.md`, `PROGRESS.md`, `HANDOFF.md`, `REVIEW.md`, `SUMMARY.md` and `foundry.json` (each under `docs/`). The value is `"absent"` when the file is not on disk; `"untracked"` when it is on disk and `git ls-files --error-unmatch` fails (or the project is not a git repo); `"modified"` when it is tracked and `git status --porcelain -- <path>` is not empty; `"tracked"` otherwise.
- `strayArtifacts`: the names whose value is `"untracked"`, but only while `PLAN.md` is `"absent"`; otherwise `[]`.
- `lastReviewCommit`: the short sha of the newest commit in `git log --format=%h%x09%s <baseBranch>..HEAD` whose subject starts with `review:`; `null` when there is none, or when the command fails.
- docs/mcp-tools.md, `foundry_status`: the three fields.

**Acceptance tests** (`test/state.mjs`):

- "an untracked foundry.json with no plan is a stray artifact (project-c F-04)": a spec-only repo plus an untracked `docs/foundry.json`; `artifacts["foundry.json"]` is `"untracked"`, `artifacts["PLAN.md"]` is `"absent"`, `artifacts["SPEC.md"]` is `"tracked"`, and `strayArtifacts` is `["foundry.json"]`.
- "a modified tracked artifact is modified": edit a committed docs/PLAN.md; `"modified"`, and `strayArtifacts` is `[]`.
- "lastReviewCommit": `null` on a build branch with no review; after a `review: round 1` commit on it, that commit's short sha; a `review:` commit made on `main` before the branch was cut is never reported.

**Out of scope:** the plan-build and review-build skills (P2-02, P2-03).

**Verification:** `foundry_verify`.

**Depends on:** none

### P1-09: Resume a round-cap halt through foundry_flight_options

**Goal:** An operator lifts a round-cap halt with one `foundry_flight_options({ …, resume: true })` call instead of hand-editing `.foundry/state.json` (S-09).

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `docs/operations.md`

**Design constraints:**

- SPEC §6 S-09. Constraint `server-synchronous`. Principle 6.
- `reviewSubmit`: when it sets `st.halted` for a cap, it also sets `st.haltCap`, either `{ cap: "maxRoundsHard", round: N }` or `{ cap: "maxRounds", round: N, nonConverging: <non-converging rounds so far> }`.
- The halt messages drop "edit .foundry/state.json …" and name the call instead:
  - soft cap: `round N is non-converging (findings per round: <trail>), the <ordinal(k)> non-converging round, reaching maxRounds=<m>; a human must decide whether to continue: call foundry_flight_options({ maxRounds: <k + 1>, resume: true })`;
  - hard cap: `review round N exceeds the hard cap maxRoundsHard=<h> (findings per round: <trail>); a human must decide whether to continue: call foundry_flight_options({ maxRoundsHard: <N>, resume: true })`.
- New `ordinal(n)` helper: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 101st, 111th.
- `flightOptions` gains `resume` (schema `{ type: "boolean" }`). With `resume: true`, every check comes before any write:
  - `resume` must be a boolean;
  - at least one bound must be passed (as today);
  - `st.halted` must be set, else refuse `the flight is not halted; there is nothing to resume`;
  - `st.haltCap` must be set, else refuse `this halt is not a round-cap halt, so resume cannot clear it: <st.halted>`. A stream-merge or operator halt is never cleared this way;
  - the bound passed in this call must lift the cap that fired: `maxRoundsHard >= haltCap.round` for `maxRoundsHard`, `maxRounds > haltCap.nonConverging` for `maxRounds`. Otherwise refuse, naming the value that would.
- On success, write docs/foundry.json, clear `halted` and `haltCap` in state, and commit both in one commit, `chore: flight options (<k=v, …>, resume)`, inside the rollback helper `withRollback`. Return `{ before, after, commit, resumed: true }`. Without `resume`, the behavior is unchanged.
- docs/mcp-tools.md: `resume` and `resumed`. docs/operations.md, "Halts": the round-cap paragraph names the call instead of the hand edit. The stream-merge and operator-halt instructions stay as they are.

**Acceptance tests:**

- `test/review.mjs`, convergence section: the soft-cap halt (maxRounds 2) contains `the 2nd non-converging round` and `foundry_flight_options({ maxRounds: 3, resume: true })`, and does not contain `edit .foundry/state.json`; the hard-cap halt (maxRoundsHard 2, round 3) contains `foundry_flight_options({ maxRoundsHard: 3, resume: true })`; a soft cap reached on the third non-converging round reads `3rd`, not `3th`. The existing assertions (`/reaching maxRounds=2/`, the trail) still pass, and `state.haltCap` is recorded.
- `test/state.mjs`, flight options section, with `setState({ halted: "<msg>", haltCap: { cap: "maxRounds", round: 4, nonConverging: 3 } })` and an open R-task: `{ maxRounds: 4, resume: true }` clears both fields, commits once, returns `resumed: true`, and `foundry_next` then returns `implement`; `{ maxRounds: 3, resume: true }` is refused naming 4, with state and docs/foundry.json unchanged; `{ resume: true }` alone is refused; `resume: "yes"` is refused; resume when not halted is refused; resume on `setState({ halted: "stopped by hand" })` is refused, naming the reason.
- A `maxRoundsHard` halt: `{ maxRoundsHard: 4, resume: true }` lifts `{ cap: "maxRoundsHard", round: 4 }`.

**Out of scope:** the go-flight skill (P2-05); changing how convergence is computed.

**Verification:** `foundry_verify`.

**Depends on:** none

### P1-10: foundry_plan_commit validates and commits the plan

**Goal:** A new tool, `foundry_plan_commit`, validates PLAN.md, PROGRESS.md, foundry.json and CLAUDE.md together, lists every problem at once, and commits the plan through the commit helper (S-06).

**Files touched:** `mcp/server.mjs`, `agents/planner.md`, `test/state.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-06 (all bullets except `renumber`, which is P1-11) and §9 Q3. Constraint `server-synchronous`. Principle 6: this task's tool writes nothing but the commit.
- Refactors, behavior-neutral for every existing caller:
  - `parseProgressText(text)`, which `parseProgress()` wraps;
  - `cfgFrom(raw, planIds)`, which `cfg()` wraps as `cfgFrom(loadConfig() || {}, <ids from docs/PLAN.md, or null if absent>)`. P1-05's `from` existence check uses `planIds`;
  - `computeWaves(pr, cc, planLines)` takes the plan lines as an optional third argument instead of always reading the file.
- A pure validator, `validatePlanTexts({ planText, progressText, configRaw, claudeExists, allowSuffix })`, returns `[{ check, id?, message }]`. It reads no files, so P1-11 can run it on rewritten text. The checks (`check` names in parentheses):
  - (`files`) PLAN.md, PROGRESS.md or docs/foundry.json is missing;
  - (`heading`) any line matching `/^#{2,4}\s*[PR]\d+-\d+/` that is not exactly `### <ID>: <title>`, where ID is `/[PR]\d+-\d+/`, or `/P\d+-\d+[a-z]?/` when `allowSuffix` is true;
  - (`duplicate`) an id with two headings;
  - (`sequence`) within each phase number, the `P` ids in document order are not `P<n>-01, P<n>-02, …` with no gap. `R` ids are exempt;
  - (`depends`) an id on a task's Depends on line that has no heading, or whose heading comes later in the document (a task depending on itself counts as later);
  - (`cycle`) a dependency cycle (depth-first search; report each cycle once);
  - (`progress`) PROGRESS.md's task ids differ from PLAN.md's, as a set or in order;
  - (`streams`) a malformed `**Stream:**` value, or any wave `computeWaves` judges invalid (message `wave <n>: <reason>`);
  - (`config`) `cfgFrom` throws (one problem, with its message);
  - (`from`) a `from` naming an id with no heading (one problem per id, listing all of them);
  - (`claude`) `CLAUDE.md` does not exist at the repository root.
  Drop a problem whose message exactly repeats an earlier one.
- `ToolError` gains an optional second constructor argument, `data`. In `handle()`'s `tools/call` branch, an error with `data` replies `{ content: [{ type: "text", text }], isError: true, structuredContent: e.data }`. Every other error reply is unchanged.
- On problems, throw `new ToolError(<one line saying how many problems there are>\n1. …\n2. …, { problems })`. Nothing is written or committed.
- On success, call `gitCommitIfChanged([PLAN.md, PROGRESS.md, docs/foundry.json, CLAUDE.md], "plan: derive build plan from SPEC", { stage: "plan" })` and return `{ commit, tasks: <number of tasks>, phases: [{ phase, tasks }], waves: [{ index, streams, valid }], renumbered: {} }`. `commit` is null when everything is already committed.
- The schema takes no arguments yet: `S({})`. P1-11 adds `renumber`.
- Follow the adding-a-tool protocol in CLAUDE.md: the `TOOLS` entry directly after `foundry_next`, the same position in `test/protocol.mjs`'s `EXPECTED_TOOLS`, the tool count in `test/plugin.mjs` and in words on docs/mcp-tools.md's first line, and `mcp__plugin_foundry_foundry__foundry_plan_commit` appended to `agents/planner.md`'s `tools:`.
- docs/mcp-tools.md: a `## foundry_plan_commit` section after `foundry_next`'s, covering every check, the refusal format and `structuredContent`.

**Acceptance tests:**

- `test/state.mjs`, new section "plan_commit (S-06)":
  - "a valid plan commits as plan: derive build plan from SPEC": a spec-only repo, then the four files written uncommitted (`planDoc`/`progressDoc` from the harness and a CLAUDE.md); the result has `tasks: 3`, and HEAD's subject is `plan: derive build plan from SPEC`. A second call returns `commit: null`.
  - "every problem at once (project-c F-07)": one plan with a malformed heading (`### P0-02 - Title`), a duplicate id, a numbering gap, a forward dependency, a self-dependency, PROGRESS.md in a different order, a constraint `from` naming `P9-01`, and no CLAUDE.md. The refusal text has a numbered line for each, the `structuredContent.problems` checks include `heading`, `duplicate`, `sequence`, `depends`, `cycle`, `progress`, `from` and `claude`, and HEAD is unchanged.
  - "a broken config is one problem": `policies.signing: "sometimes"` gives a `config` problem.
- `test/protocol.mjs`: the new name in `EXPECTED_TOOLS`; a raw `tools/call` of `foundry_plan_commit` in a repo with no plan returns `isError: true` with `structuredContent.problems` an array.
- `test/plugin.mjs`: the count; and "docs/mcp-tools.md states the tool count in words" (a small map from 18 to 25 to the words "Eighteen" … "Twenty-five").

**Out of scope:** `renumber` (P1-11); the plan-build skill (P2-03).

**Verification:** `foundry_verify`.

**Depends on:** P1-05

### P1-11: foundry_plan_commit renumbers split task ids

**Goal:** `foundry_plan_commit({ renumber: true })` rewrites out-of-sequence and temporarily suffixed ids (`P1-02a`) to a clean sequence everywhere they appear, then validates and commits (S-06).

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-06, the `renumber` bullet. Constraint `server-synchronous`. Principle 6: compute in memory, validate, and only then write.
- The schema gains `renumber: { type: "boolean" }`; a non-boolean is refused.
- `renumber: true` is refused once a run has started: PROGRESS.md's `Started:` value exists and does not start with `(`, or any task line is not `[ ]`. The message says renumbering is only for a plan no run has touched.
- Suffixed ids (`/P\d+-\d+[a-z]?/`) are accepted only in this mode. Without `renumber`, `P1-02a` is a `heading` problem from P1-10's validator, and its message suggests `renumber: true`.
- The map: walk PLAN.md's `### <id>:` headings in document order and number each phase's `P` ids `P<n>-01, P<n>-02, …`. Keep only the ids that change. `R` ids are never renumbered.
- Apply the map in one pass, never chained (P1-03 → P1-04 must not then become P1-05), with whole-word matching that never matches inside a longer id: `/(?<![A-Za-z0-9-])(P\d+-\d+[a-z]?)(?![A-Za-z0-9])/g` and a map lookup, over the full text of PLAN.md and PROGRESS.md; in docs/foundry.json, only the values of `"from"` keys, with a regex on the raw text (`/("from"\s*:\s*")([^"]+)(")/g`) so the file's formatting is kept.
- Run P1-10's `validatePlanTexts` on the rewritten texts with `allowSuffix: false`. If problems remain, refuse with them, having written nothing. Otherwise write the three files and commit inside the rollback helper `withRollback`. `renumbered` is the `{ old: new }` map.
- docs/mcp-tools.md: `renumber`, its refusals and `renumbered`.

**Acceptance tests** (`test/state.mjs`, the plan_commit section):

- "renumber rewrites a split task everywhere": tasks P1-01, P1-02, P1-02a and P1-03, where P1-03 depends on P1-02a, prose in P1-03 mentions "see P1-02a", and a constraint has `"from": "P1-03"`. The result's `renumbered` is `{ "P1-02a": "P1-03", "P1-03": "P1-04" }`. PLAN.md headings, the `Depends on` line, the prose, PROGRESS.md's lines and the `from` value are all rewritten; every `P1-02` reference is untouched; HEAD is the plan commit.
- "a suffix without renumber is refused, suggesting renumber": the same plan without the flag is refused and the message contains `renumber: true`.
- "renumber is refused once a run has started": a `Started:` stamp; separately, one `[x]` task. Both refused, with every file unchanged.

**Out of scope:** the plan-build skill (P2-03).

**Verification:** `foundry_verify`.

**Depends on:** P1-10

### P1-12: The flight key, policies.archive and foundry_flight_archive

**Goal:** A summarized flight is archived into `docs/flights/<slug>/` in one tool call, so the repository can run its next flight (S-07).

**Files touched:** `mcp/server.mjs`, `agents/summarizer.md`, `test/review.mjs`, `test/state.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `docs/operations.md`

**Design constraints:**

- SPEC §5 table (`flight`, `policies.archive`) and §6 S-07 (all but the pull-feedback bullet, which is P2-06). Constraint `server-synchronous`. Principles 6 and 7.
- `flight`: `const FLIGHT_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/`. The config validator refuses a `flight` that is not a string matching it; `cfg()` returns `flight` (`null` when absent). docs/operations.md gains a `flight` row.
- `policies.archive` is a ⚠️ ASSUMPTION: config key `policies.archive`, default `false`. `POLICY_KEYS` gains `archive`; `validatePolicies` refuses a non-boolean; `cfg().policies.archive` defaults to `false`. The default lives in `cfg()` only, nowhere else. docs/operations.md gains a `policies.archive` row, and `test/plugin.mjs`'s policies branch asserts it.
- `summaryCommit`'s result gains `archive: <cfg().policies.archive>`, so the summarizer reads the policy from the tool result.
- New tool `foundry_flight_archive({ slug })`, with `slug` an optional string:
  - The slug is the argument, else `cfg().flight`; neither: refuse `pass slug, or set "flight" in docs/foundry.json`. It must match `FLIGHT_SLUG`.
  - Refuse, in this order and before any change: `state.summarized` is not true; `.foundry/implement.lock` exists; the tree is dirty excluding `state.preexistingUntracked` (`porcelainExcludingPreexisting`); `docs/flights/<slug>/` already exists. Each message says what to do.
  - Read the config's push policy and `baseBranch` before moving anything.
  - Move each of these that exists into `docs/flights/<slug>/` under its base name: `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/HANDOFF.md`, `docs/REVIEW.md`, `docs/SUMMARY.md`, `docs/foundry.json`, `.foundry/state.json`, `.foundry/feedback.jsonl`. Use `git mv` for a tracked file and `fs.renameSync` for an untracked one.
  - Copy `docs/SPEC.md` there; the live spec stays.
  - Write a fresh `.foundry/state.json`: `{ ...DEFAULT_STATE, archived: { slug, dir, at }, ...(old.signingOverride ? { signingOverride: true } : {}) }` (Decisions).
  - Commit everything (every source, destination, the SPEC copy and the new state) as `chore: archive flight <slug>`, through `gitCommitIfChanged` with `{ stage: "summarize" }`, inside the rollback helper `withRollback` over all of those paths. If the commit throws, also remove `docs/flights/<slug>/` when it is left empty, then rethrow.
  - Push the current branch per policy (`pushBranch`).
  - Return `{ slug, dir: "docs/flights/<slug>", moved: [<source paths>], copied: ["docs/SPEC.md"], commit, push }`.
- `next()`: after the `halted` check and before the plan check, if `state.archived` is set, docs/PLAN.md is absent, and docs/SPEC.md is byte-identical to `<archived.dir>/SPEC.md`, return `done` with the reason `flight <slug> is archived in <dir>; edit docs/SPEC.md for the next flight, then run /foundry:go-flight`. Once SPEC.md differs, the existing rule returns `plan` (Decisions).
- Follow the adding-a-tool protocol in CLAUDE.md: the `TOOLS` entry directly after `foundry_summary_commit`, the same position in `EXPECTED_TOOLS`, the count, and `mcp__plugin_foundry_foundry__foundry_flight_archive` appended to `agents/summarizer.md`'s `tools:`.
- docs/mcp-tools.md: a `## foundry_flight_archive` section after `foundry_summary_commit`'s; `foundry_summary_commit`'s new `archive` field; `foundry_next`'s archived `done`.

**Acceptance tests:**

- `test/review.mjs`, new section "flight_archive (S-07)":
  - Refusals, each asserting its message and that nothing moved: no slug and no `flight`; slug `"Bad_Slug"`; not summarized; the lock present; a modified tracked file; `docs/flights/<slug>/` already there.
  - "archive moves the flight and keeps the spec": a summarized repo with PLAN, PROGRESS, HANDOFF, REVIEW, SUMMARY, foundry.json (`flight: "w1-share"`), state.json and feedback.jsonl committed. The result's `dir` is `docs/flights/w1-share`, with the eight files moved; HEAD's subject is `chore: archive flight w1-share`; docs/SPEC.md still exists and equals the copy; docs/PLAN.md is gone; `.foundry/state.json` equals `DEFAULT_STATE` plus `archived`; `git status --porcelain` is empty.
  - "a slug argument wins over flight", "a pre-existing untracked artifact is moved with mv", "signingOverride is carried over", "push follows policy" (a bare remote: `push: "pushed"`).
  - "a failed archive commit restores everything": a commit-msg hook rejecting `chore: archive` (CLAUDE.md commit-failure test protocol). docs/PLAN.md and the other sources are back, byte-identical; `docs/flights/<slug>/` does not exist; nothing is staged.
  - `foundry_summary_commit` returns `archive: false` by default and `true` with `policies.archive: true`.
- `test/state.mjs`: "after an archive, foundry_next is done until SPEC.md changes": right after an archive, `stage` is `done` and the reason names the slug; after editing docs/SPEC.md, `stage` is `plan`. `flight: "Bad"` and `policies.archive: "yes"` are refused (via `foundry_status`).
- `test/protocol.mjs` and `test/plugin.mjs`: the name and the count.

**Out of scope:** `foundry_pr_finalize` (P1-13); the summarize and pull-feedback skills (P2-01, P2-06).

**Verification:** `foundry_verify`.

**Depends on:** P1-03

### P1-13: foundry_pr_finalize signed check, ready, auto-merge and awaiting signing

**Goal:** A new tool, `foundry_pr_finalize`, ends a flight: a fully signed flight's draft PR is marked ready and, unless breaking, set to auto-merge; any unsigned commit keeps it draft and records `awaitingSigning` (S-14, without `resign`).

**Files touched:** `mcp/server.mjs`, `agents/summarizer.md`, `test/harness.mjs`, `test/review.mjs`, `test/state.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `docs/operations.md`

**Design constraints:**

- SPEC §5 table (`policies.finalize`, `policies.mergeMethod`) and §6 S-14, every bullet except `resign` (P1-14). Constraints `server-synchronous` and `no-sync-merge`: write the `gh pr merge` arguments as one inline array literal that includes `"--auto"`. Principles 6 and 7.
- Policies: `POLICY_KEYS` gains `finalize` (`"auto"` | `"ready"` | `"draft"`, default `"auto"`) and `mergeMethod` (`"merge"` | `"squash"` | `"rebase"`, default `"merge"`). `validatePolicies` refuses anything else, naming the legal values; `cfg().policies` carries both. docs/operations.md gets a row for each, and `test/plugin.mjs`'s policies branch asserts both.
- New tool `foundry_pr_finalize({ breaking })`, schema `breaking: { type: "boolean" }`. P1-14 adds `resign`.
- Preconditions, all before any write, each with its own refusal:
  - The summary is committed: `state.summarized === true`, or `state.archived` is set and `<state.archived.dir>/state.json` parses with `summarized: true`.
  - `breaking`, when given, is a boolean. When it is omitted, use `state.breaking`; when that is unset too, refuse with `breaking is required on the first call: pass true or false`.
  - The config is docs/foundry.json through `cfg()`; when that file is absent and `state.archived` is set, it is `<dir>/foundry.json`, validated the same way (`cfgFrom` from P1-10, or factor `cfg()` over a raw object here if P1-10 is not done).
  - `git merge-base <baseBranch> HEAD` succeeds; otherwise refuse, naming `baseBranch`.
- `signedCheck(mergeBase)` runs `git log --format=%H %G? <mergeBase>..HEAD`. A commit is unsigned when `%G?` is `N` or `B`; anything else, `E` included, is signed. It returns `{ signed, unsigned, first }`, where `first` is the oldest unsigned sha. It looks at the commits themselves, never at `state.signing`.
- `nextSteps(mergeBase)` returns exactly: `Unlock the signing agent, then tell the flight controller to finalize with re-signing: foundry_pr_finalize({ resign: true }). Or by hand: git rebase -f --rebase-merges --gpg-sign <mergeBase>, then git push --force-with-lease, then foundry_pr_finalize({}).`
- Any unsigned commit:
  - `state.breaking = breaking`;
  - `state.awaitingSigning = { unsigned, first, since }`, where `since` is now, or the previous value when it was already set;
  - one `signing` feedback entry (stage `summarize`), only when `awaitingSigning` was not already set;
  - append `## Awaiting signing` plus the steps to the flight's SUMMARY.md (docs/SUMMARY.md, or `<archived.dir>/SUMMARY.md`), unless that heading is already there;
  - commit state, feedback and SUMMARY as `chore: awaiting signing`, through the commit helper inside `withRollback`;
  - push per policy;
  - return `{ signed, unsigned, ready: false, merge: "skipped: awaiting signing", breaking, awaitingSigning, resigned: false, push, pr, next: nextSteps(mb) }`.
- All signed:
  - `state.breaking = breaking`; delete `awaitingSigning`;
  - if `state.signingOverride` is set, `git config --local --unset commit.gpgsign`, clear the flag and set `state.signing = "on"` (Decisions);
  - commit state as `chore: finalize flight` (commit helper, `withRollback`); if that commit itself turned out unsigned (re-run `signedCheck`), take the unsigned path instead;
  - push per policy; read the PR with `prState`.
  - If the PR policy is `draft` and `prState` returned an object, follow `policies.finalize`:
    - `"auto"`: `gh pr ready` when the PR is a draft. Then, if `breaking`, `merge: "skipped: breaking"`; otherwise `gh pr merge --auto --<mergeMethod>`, giving `merge: "enabled"` on success and `merge: "unavailable: <gh's first stderr line>"` on failure, with the PR left ready.
    - `"ready"`: `gh pr ready` when it is a draft; `merge: "skipped: policy"`.
    - `"draft"`: change nothing; `merge: "skipped: policy"`.
  - With no PR object: `ready: false`, `merge: "skipped: no pull request"`.
  - `ready` is true when the PR ends up not a draft.
  - Run every `gh` call with `spawnSync("gh", [...], { cwd: ROOT, encoding: "utf8" })`. Never run `gh pr merge` without `--auto`.
- `next()`: right after the `halted` check, while `state.awaitingSigning` is set, return `done` with the reason `awaiting signing: <unsigned> unsigned commit(s), oldest <short sha>. <nextSteps>`.
- `PROMPTS.summarize` gains: "After that, archive if foundry_summary_commit reports archive: true, and end with foundry_pr_finalize; never pass resign."
- Follow the adding-a-tool protocol in CLAUDE.md: the `TOOLS` entry directly after `foundry_flight_archive`, `EXPECTED_TOOLS`, the count, and `mcp__plugin_foundry_foundry__foundry_pr_finalize` appended to `agents/summarizer.md`'s `tools:`.
- `test/harness.mjs`:
  - `mkFakeGhBin` also handles `pr ready` (rewrite `pr.json` with `"isDraft":false`, exit 0) and `pr merge` (if `<dir>/merge-fails` exists, print its content to stderr and exit 1; otherwise exit 0). Every call is still logged to `calls.log`.
  - New `mkFakeGpg({ failAfter } = {})` writes and returns the absolute path of the fake gpg program below. With `failAfter`, it also writes `<dir>/fail-after` holding that number.
  - New `useFakeSigner(repo, gpgPath)` sets local `gpg.format openpgp`, `gpg.program <gpgPath>`, `user.signingkey 0123456789ABCDEF` and `commit.gpgsign true`.
- The fake gpg (verified against git 2.43: a signed commit reads `%G?` = `U`, an unsigned one `N`, `FAKE_GPG_VERIFY=bad` gives `B`, `err` gives `E`):

```text
#!/bin/sh
# Fake gpg for tests: signs anything; verify result from FAKE_GPG_VERIFY (good|bad|err).
dir=$(dirname "$0")
for a in "$@"; do
  if [ "$a" = "--verify" ]; then
    echo "[GNUPG:] NEWSIG"
    case "${FAKE_GPG_VERIFY:-good}" in
      bad) echo "[GNUPG:] BADSIG 0123456789ABCDEF foundry test" ;;
      err) echo "[GNUPG:] ERRSIG 0123456789ABCDEF 1 10 00 1700000000 9 -"; echo "[GNUPG:] NO_PUBKEY 0123456789ABCDEF" ;;
      *) echo "[GNUPG:] GOODSIG 0123456789ABCDEF foundry test" ;;
    esac
    exit 0
  fi
done
n=$(cat "$dir/sign-count" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$dir/sign-count"
if [ -f "$dir/fail-after" ] && [ "$n" -gt "$(cat "$dir/fail-after")" ]; then echo "gpg: signing failed: fake" >&2; exit 2; fi
cat >/dev/null
echo "[GNUPG:] SIG_CREATED D 1 10 00 1700000000 0123456789ABCDEF0123456789ABCDEF01234567" >&2
printf -- '-----BEGIN PGP SIGNATURE-----\n\nZmFrZQ==\n-----END PGP SIGNATURE-----\n'
```

- docs/mcp-tools.md: a `## foundry_pr_finalize` section after `foundry_flight_archive`'s (arguments, preconditions, signed check, each path, the return shape, every `merge` value); `foundry_next`'s awaiting-signing `done`.

**Acceptance tests:**

- `test/review.mjs`, new section "pr_finalize (S-14)". The setup is a planned repo, a `build/x` branch with task commits, `setState({ summarized: true, verdict: "APPROVED" })`, a bare origin, and the fake gh with a draft PR:
  - Refused before the summary is committed; the first call without `breaking` is refused; `breaking: "no"` is refused. Each leaves state unchanged.
  - "an unsigned commit keeps the PR draft": the result has `awaitingSigning.unsigned >= 1`, `ready: false`, `merge: "skipped: awaiting signing"`, and `next` containing `foundry_pr_finalize({ resign: true })` and `git rebase -f --rebase-merges --gpg-sign`. State records `awaitingSigning` and `breaking`; there is exactly one `signing` feedback entry; SUMMARY.md contains `## Awaiting signing` once; `foundry_next` returns `done` with a reason starting `awaiting signing:`. A second call adds no feedback entry and keeps `since`.
  - "all signed, auto, not breaking": with `useFakeSigner` before the branch's commits, `calls.log` shows `pr ready` and `pr merge --auto --merge`, and the result has `ready: true` and `merge: "enabled"`. With `mergeMethod: "squash"`, `--squash`. With `breaking: true`, there is no `pr merge` call and the result has `merge: "skipped: breaking"`. With `finalize: "ready"`, only `pr ready` runs, and the result has `merge: "skipped: policy"`. With `finalize: "draft"`, neither runs. With a `merge-fails` file, the result has `merge: "unavailable: <its first line>"` and `ready: true`.
  - "E counts as signed, B does not": the server started with `FAKE_GPG_VERIFY=err` reports no unsigned commits; with `bad`, every signed commit counts as unsigned.
  - "after an archive": finalize reads the archived foundry.json and summarized state, and appends the awaiting section to the archived SUMMARY.md.
- `test/state.mjs`: `policies.finalize: "sometimes"` and `policies.mergeMethod: "ff"` are refused.
- `test/protocol.mjs` and `test/plugin.mjs`: the name and the count (twenty-one, if P1-10 and P1-12 landed).

**Out of scope:** `resign` (P1-14); the summarize and go-flight skills (P2-01, P2-05).

**Verification:** `foundry_verify`.

**Depends on:** P1-03, P1-12

### P1-14: foundry_pr_finalize resign path

**Goal:** A human-initiated `foundry_pr_finalize({ resign: true })` re-signs the whole branch, force-pushes it, clears the awaiting state and continues into the all-signed path (S-14).

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-14, the `resign` bullets. Constraint `server-synchronous`. Principle 6. The tool is P1-13's `foundry_pr_finalize`; this task adds `resign: { type: "boolean" }` to its schema (a non-boolean is refused) and these steps, run after P1-13's preconditions and before its signed check:
  1. Refuse on a dirty tree (excluding `state.preexistingUntracked`) or when the current branch is `baseBranch`. Neither check changes anything.
  2. If `state.signingOverride` is set, run `git config --local --unset commit.gpgsign` first (Decisions; Spec issue 5). Then `probeSigning("required")`. If it throws, put the override back (`git config --local commit.gpgsign false`) and rethrow.
  3. Run `git rebase -f --rebase-merges --gpg-sign <mergeBase>` through `spawnSync` with `GIT_TERMINAL_PROMPT=0` and `timeout: cfg().commandTimeoutMs`. On any failure, run `git rebase --abort` (`allowFail`), put the override back if step 2 removed it, and refuse with git's first stderr lines.
  4. Clear `state.signingOverride`.
  5. Re-run `signedCheck`. If anything is still unsigned, refuse, naming the count and the first sha. The rewritten branch stays as it is, and the message says so.
  6. When pushes are allowed and `origin` exists, `git push --force-with-lease origin <branch>`; record `push` as `"pushed"`, `"skipped: policy"`, `"skipped: no origin remote"` or `"failed: <first line>"`.
  7. Delete `state.awaitingSigning`, set `state.signing = "on"`, and continue into P1-13's all-signed path, which commits state. Its own push is an ordinary one. The result has `resigned: true`.
- Neither the tool nor any later skill lets an agent pass `resign` on its own; the tool description says it is human-initiated only.
- docs/mcp-tools.md: `resign`, its steps and refusals.

**Acceptance tests** (`test/review.mjs`, the pr_finalize section; follow the signing test protocol in CLAUDE.md, including the isolated global config):

- "resign re-signs the branch and finalizes": unsigned task commits and one `--no-ff` merge commit on `build/x`; state with `awaitingSigning`, `signingOverride: true`, and local `commit.gpgsign false`; a fake signer through a temporary global config (`GIT_CONFIG_GLOBAL` in the server's env, holding `commit.gpgsign = true`, `gpg.format`, `gpg.program`, `user.signingkey`). The result has `resigned: true`. Every commit in `<mergeBase>..HEAD` has `%G?` other than `N`/`B`; the merge commit still has two parents; `git config --local commit.gpgsign` is unset; state has `signing: "on"` and no `awaitingSigning` or `signingOverride`; origin's `build/x` equals local HEAD; the fake gh shows `pr ready`.
- Refusals, each leaving HEAD and the local config unchanged: a dirty tree; on `main`; `resign: "yes"`.
- "a failing probe puts the override back": a nonexistent `gpg.program`; refused; local `commit.gpgsign` is `false` again.
- "a failing rebase is aborted": `mkFakeGpg({ failAfter: 1 })` (the probe signs once, and the rebase's first signature fails); refused; no `.git/rebase-merge` or `.git/rebase-apply` directory; HEAD unchanged; the override back.

**Out of scope:** the go-flight and summarize skills (P2-01, P2-05).

**Verification:** `foundry_verify`.

**Depends on:** P1-13

### P1-15: Phase 1 end: push and record the manual check

**Goal:** Push the branch after the server mechanics and record the Phase 1 manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1. Follow the implement skill's phase-end rules: push if this run's policies allow it and `origin` exists. No code changes; if nothing changed, an empty commit `P1-15: Phase 1 end: push and record the manual check` (`git commit --allow-empty -F <file>`) carries the task.

**Acceptance tests:** none beyond the full suite: `foundry_verify` is green.

**Out of scope:** any change to code, tests or docs.

**Verification:** `foundry_verify`. The log entry carries `Manual check: NOT VERIFIED (human)` for: "run one real flight on a throwaway spec with the working-tree plugin (`claude --plugin-dir .`) and confirm the summarizer passes `content` and no `Write` refusal appears".

**Depends on:** none

## Phase 2 — skills and agents

### P2-01: Summarize skill: content, archive, codebase notes, finalize

**Goal:** The summarize skill passes SUMMARY.md as `content`, archives when the policy says so, lifts codebase notes, makes the breaking call, and ends with `foundry_pr_finalize` (S-01, S-07, S-11, S-12, S-14).

**Files touched:** `skills/summarize/SKILL.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-01 (second bullet), S-07 (`policies.archive`), S-11 (advisory survivors), S-12 (summarize) and S-14 (the breaking call, the final call, the final message). §3 principle 4: the skill says what to think about; the tools do the mechanics.
- Remove the paragraph telling the summarizer to write SUMMARY.md with `Write` or a shell heredoc. In its place: compose the whole document, then pass it as `content` to `foundry_summary_commit`, which writes and commits it. Never call `Write`, `Edit` or a heredoc for SUMMARY.md. The word "heredoc" must not appear in this skill.
- New SUMMARY sections, added to the numbered list:
  - **Suggested CLAUDE.md additions**: every item under `## Codebase notes` in HANDOFF.md (project lessons such as a framework footgun), lifted as proposed additions to the project's CLAUDE.md.
  - **Advisory mutation survivors**: survivors the reviewer put under `## Notes` in REVIEW.md as outside the round's diff (S-11), carried over verbatim.
  - **Breaking call**: one line, `Breaking: yes|no — <reason>`. `breaking` is true when SPEC or CHANGELOG.md lists breaking changes for this work, or when the flight changed a public interface, a config default, or behavior an existing user relies on. When unsure, it is true.
- After `foundry_summary_commit`: if its result has `archive: true`, call `foundry_flight_archive` with no arguments; if that refuses, print the refusal and still finalize.
- Last call: `foundry_pr_finalize({ breaking })`, with the breaking call above. Never pass `resign`: only a human may ask for it. Say so plainly.
- The final message starts `FLIGHT COMPLETE`, then gives the merge line and one status: `AWAITING SIGNING` followed by the tool's `next` text verbatim when `awaitingSigning` is set; `AUTO-MERGE ON` when `merge` is `"enabled"`; `READY` when `ready` is true; otherwise `PR UNCHANGED: <merge>` (Decisions).
- Keep the existing sections (merge line, pipeline friction via `feedbackCount`, and the rest).
- `test/plugin.mjs`: drop `summarize` from the loop that requires the heredoc fallback (it stays for plan-build and implement), and add assertions that the summarize skill: does not contain `heredoc`; names `content`, `foundry_summary_commit`, `foundry_flight_archive` and `foundry_pr_finalize`; mentions `Codebase notes`; contains `AWAITING SIGNING`, `AUTO-MERGE ON` and `READY`; and forbids `resign`.

**Acceptance tests:** `test/plugin.mjs`: the assertions above, named "the summarize skill passes content and never writes SUMMARY.md itself (project-c F-03 …)", "…archives when policies.archive is true", "…ends with foundry_pr_finalize and never passes resign", "…lifts Codebase notes".

**Out of scope:** server changes; other skills.

**Verification:** `foundry_verify`. Read the skill top to bottom as the summarizer would.

**Depends on:** P1-04, P1-12, P1-13

### P2-02: Review-build skill: targeted mutants, confirmKill, converging rounds

**Goal:** The reviewer prefers targeted mutation commands, confirms kills that do not name the expected test, and scopes rounds after the first so the loop converges (S-04, S-05, S-11).

**Files touched:** `skills/review-build/SKILL.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-04 (reviewer side), S-05 (last bullet) and S-11 (all four changes). §3 principle 4.
- Targeted: when docs/foundry.json has `mutation.targeted`, prefer `foundry_mutate({ file, find, replace, targeted: <name>, filter: <the test class or path that covers the file> })` over the full verify set.
- confirmKill: read `failedCommands` and the failure tails. Pass `confirmKill: true` whenever a kill's failure tail does not name the test you expected to catch it; with a targeted command the re-run is cheap, so you may always pass it. An `inconclusive` result is not a kill: treat it as a survivor to examine.
- Round 1 (`reviewRound` 1): sample as today. When a mutant survives, sweep the same file with at least three further mutations of neighbouring mechanics (the ⚠️ ASSUMPTION sweep size; state the number once). Then queue one R-task per file, listing every survivor found there, instead of one task per survivor.
- Round 2 and later: read `lastReviewCommit` from `foundry_status`, and mutate only files in `git diff --name-only <lastReviewCommit>..HEAD`. A survivor outside that diff goes under `## Notes` in REVIEW.md as advisory, never as an R-task; the summarizer carries it into SUMMARY.
- When a mutation-only round queues tasks, cite this rule in REVIEW.md. The existing fix loop is unchanged.
- `test/plugin.mjs`: assertions that review-build names `targeted`, `confirmKill`, `failedCommands`, `lastReviewCommit`, `at least three`, `one R-task per file` and `## Notes`.

**Acceptance tests:** `test/plugin.mjs`: the assertions above, named "review-build prefers targeted mutation commands (project-c F-12)", "…confirms suspicious kills (project-c F-02)", "…scopes later rounds to the diff since lastReviewCommit (project-c F-16)".

**Out of scope:** server changes; other skills.

**Verification:** `foundry_verify`. Read the skill top to bottom as the reviewer would.

**Depends on:** P1-06, P1-07, P1-08

### P2-03: Plan-build skill: plan_commit, from, stray artifacts, per-flight CLAUDE.md

**Goal:** The planner commits through `foundry_plan_commit`, gates late rules with `from`, regenerates stray artifacts, sets `flight`, fills `mutation.targeted`, and edits an existing CLAUDE.md one flight section at a time (S-12, S-03, S-04, S-06, S-08).

**Files touched:** `skills/plan-build/SKILL.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-12 (plan-build), S-03 (last bullet), S-04 (planner bullet), S-06 (last bullet) and S-08 (skill bullet). §3 principle 4.
- Report: quote docs/foundry.json from disk (keep the `cat docs/foundry.json` instruction, which `test/plugin.mjs` checks), except the `constraints` bodies, which are listed by id with a fixture count (project-c F-01).
- CLAUDE.md: the 150-line cap applies only when the planner creates the file. In an existing CLAUDE.md, add or replace exactly one `## Flight <slug> notes` section of at most 60 lines (the ⚠️ ASSUMPTION budget; state the number once). Merge only flight-agnostic facts into the shared sections (Constraints, Commands, Task protocols), and leave other flights' sections untouched (project-c F-20).
- Finishing: replace the manual commit step ("Commit PLAN.md, PROGRESS.md, foundry.json and CLAUDE.md as …") with a call to `foundry_plan_commit`. If it refuses, fix every listed problem and call it again. When splitting a task mid-plan, give the new piece a temporary suffix id (`P1-02a`) and call `foundry_plan_commit({ renumber: true })` instead of renumbering by hand. The planner never runs `git commit` itself.
- `from`: when a constraint or `extraVerify` command can only pass once a given task lands, give it `from: "<that task's id>"`. Never wrap it in a guard such as `test ! -f X || bash X`.
- Stray artifacts: call `foundry_status`; regenerate every `strayArtifacts` entry from SPEC, never trust its content, and name it in the report.
- `flight`: set docs/foundry.json's `flight` from the operator's slug when the prompt carries `Flight slug: <slug>.`; otherwise derive it from SPEC's title (lowercase, every run of other characters becomes `-`, trimmed, at most 40 characters).
- `mutation.targeted`: fill it when SPEC section 7 names a filterable test command (`{filter}` placeholder, unquoted).
- The skill's docs/foundry.json example block gains `"flight"` and `"mutation"`. Keep the heredoc fallback paragraph (it stays for plan-build).
- `test/plugin.mjs`: assertions that plan-build names `foundry_plan_commit`, `renumber`, `from`, `strayArtifacts`, `## Flight <slug> notes`, `60 lines`, `mutation.targeted` and `"flight"`, and no longer contains `Commit PLAN.md, PROGRESS.md, foundry.json and CLAUDE.md as`.

**Acceptance tests:** `test/plugin.mjs`: the assertions above, named "plan-build commits through foundry_plan_commit (project-d F-03)", "…renumbers with renumber: true (project-c F-07)", "…gates late rules with from (project-d F-01)", "…caps only its own flight section of an existing CLAUDE.md (project-c F-20)", "…regenerates stray artifacts (project-c F-04)".

**Out of scope:** server changes; other skills.

**Verification:** `foundry_verify`. Read the skill top to bottom as the planner would.

**Depends on:** P1-05, P1-08, P1-11

### P2-04: Implement skill: codebase notes stay out of the feedback log

**Goal:** Project lessons go in the task log and HANDOFF.md's `## Codebase notes`, and `foundry_feedback_log` stays for Foundry's own friction (S-12).

**Files touched:** `skills/implement/SKILL.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-12 (implement). project-c F-08 and F-09.
- In "When Foundry itself costs you time", add: a lesson about the project (a framework footgun, a confusing library behavior) is not Foundry friction. Put it in the task's log entry and under a `## Codebase notes` heading in HANDOFF.md, never in `foundry_feedback_log`.
- In "Finishing", HANDOFF.md's list gains: `## Codebase notes`, every project lesson from this run's log entries, for the summarizer to lift into SUMMARY.
- Keep the heredoc fallback paragraph.
- `test/plugin.mjs`: assertions that the implement skill mentions `## Codebase notes` and says project lessons never go to `foundry_feedback_log`.

**Acceptance tests:** `test/plugin.mjs`: "the implement skill keeps project lessons out of the feedback log (project-c F-08, F-09)".

**Out of scope:** server changes; other skills.

**Verification:** `foundry_verify`.

**Depends on:** none

### P2-05: Go-flight skill: resume, signing unlocked, flight slug

**Goal:** The controller maps "continue, allow N rounds" to a resume, "signing is unlocked, finish it" to a re-sign finalize, and `flight=<slug>` into the planner prompt (S-09, S-14, S-12).

**Files touched:** `skills/go-flight/SKILL.md`, `test/plugin.mjs`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 S-09 (last bullet), S-14 (last bullet) and S-12 (go-flight). The controller still makes no engineering decisions.
- Flight options gain:
  - "continue, allow N rounds", or any phrasing that plainly asks to continue a halted flight with N rounds: when `foundry_next` returns `halt` and its reason names `resume: true`, call `foundry_flight_options({ maxRounds: N, maxRoundsHard: N, resume: true })` once, print its result, then go back to step 1 of the loop. If it refuses, print the refusal and stop.
  - "signing is unlocked, finish it" (or plainly the same request): call `foundry_pr_finalize({ resign: true })` once, print its result, and stop. This is the only way the controller ever calls `foundry_pr_finalize`, and the only `resign: true` anywhere in the pipeline.
  - `flight=<slug>`: when `foundry_next` returns `plan`, append one space and the sentence `Flight slug: <slug>.` to the prompt; otherwise pass prompts verbatim, as today.
- `allowed-tools` gains `mcp__plugin_foundry_foundry__foundry_pr_finalize` and `mcp__foundry__foundry_pr_finalize`. `argument-hint` mentions the new options.
- `test/plugin.mjs`: update the message of the "allowed nothing beyond …" assertion to include pr_finalize; add assertions that go-flight contains `resume: true`, `foundry_pr_finalize({ resign: true })` and `flight=`. The existing "cannot touch the tools that change project state" assertion must still pass.
- docs/mcp-tools.md: the intro's list of what the flight controller may call adds `foundry_pr_finalize`, for the human-initiated re-sign only.

**Acceptance tests:** `test/plugin.mjs`: "go-flight resumes a round-cap halt with foundry_flight_options (project-c F-13, F-18)", "…finishes a signing-blocked flight only with foundry_pr_finalize({ resign: true })", "…passes flight=<slug> to the planner".

**Out of scope:** server changes; other skills.

**Verification:** `foundry_verify`. Read the skill top to bottom as the controller would.

**Depends on:** P1-09, P1-14

### P2-06: Pull-feedback skill reads archived flight logs

**Goal:** `/foundry:pull-feedback` reads `.foundry/feedback.jsonl` and every `docs/flights/*/feedback.jsonl`, deduping by `at` as today (S-07).

**Files touched:** `skills/pull-feedback/SKILL.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-07 (last bullet). The project-d pull is the model: it had four entries only in an archived log.
- Step 1 reads `<path>/.foundry/feedback.jsonl` and every `<path>/docs/flights/*/feedback.jsonl`; it stops only when all of them are missing or empty. The existing dedupe by exact `at` makes reading both safe.
- The written file's header names every source log and how many items came from each, as `docs/feedback/2026-10-07-project-d.md` does.
- Still never write under `<path>`.
- `test/plugin.mjs`: an assertion that pull-feedback mentions `docs/flights/*/feedback.jsonl`.

**Acceptance tests:** `test/plugin.mjs`: "pull-feedback reads archived flight logs too".

**Out of scope:** server changes; other skills.

**Verification:** `foundry_verify`.

**Depends on:** P1-12

### P2-07: Phase 2 end: push and record the manual check

**Goal:** Push the branch after the skill changes and record the Phase 2 manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2. Follow the implement skill's phase-end rules. The agent `tools:` changes Phase 2 lists were already made by P1-10, P1-12 and P1-13; check that `agents/planner.md` names `foundry_plan_commit` and `agents/summarizer.md` names `foundry_flight_archive` and `foundry_pr_finalize`, and record in the log any that are missing because a Phase 1 task was blocked. If nothing changed, an empty commit carries the task.

**Acceptance tests:** none beyond the full suite: `foundry_verify` is green.

**Out of scope:** any change to code, tests or docs.

**Verification:** `foundry_verify`. The log entry carries `Manual check: NOT VERIFIED (human)` for: "read each changed SKILL.md top to bottom for contradictions with the tool reference".

**Depends on:** none

## Phase 3 — documentation and release

### P3-01: Tool reference and README for twenty-one tools

**Goal:** docs/mcp-tools.md and README.md describe all twenty-one tools, every new argument and return field, and the new end-of-flight behavior (S-13).

**Files touched:** `docs/mcp-tools.md`, `README.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-13 (mcp-tools.md and README bullets); §3 principle 8.
- docs/mcp-tools.md: the first line reads "Twenty-one tools". Audit every section against the server and fill any gap: `foundry_plan_commit` (checks, `renumber`, `structuredContent`); `foundry_flight_archive`; `foundry_pr_finalize` (`breaking`, `resign`, every `merge` value, `next`); `foundry_summary_commit` (`content`, `archive`); `foundry_mutate` (`targeted`, `filter`, `confirmKill`, `failedCommands`, `confirm`, `inconclusive`); `foundry_verify` and `foundry_run_finish` (`inactive`, `skipped`); `foundry_status` (`artifacts`, `strayArtifacts`, `lastReviewCommit`); `foundry_flight_options` (`resume`, `resumed`); `foundry_next` (awaiting-signing and archived `done`).
- README.md: a sentence before the MCP tools table saying there are twenty-one tools; rows for the three new tools; updated rows for `foundry_summary_commit`, `foundry_mutate`, `foundry_flight_options` and `foundry_status`. The quickstart line "Read `docs/SUMMARY.md`, then merge the branch yourself. Foundry never merges …" now says that a signed, non-breaking flight's PR is marked ready and set to auto-merge once CI is green under `policies.finalize: "auto"`, and that Foundry never merges synchronously.
- `test/plugin.mjs`: assertions that README's MCP tools table has a row for every tool the server defines, and that README states the count in words (reuse P1-10's number-word map if it exists; otherwise add it).

**Acceptance tests:** `test/plugin.mjs`: "README's tool table lists every server tool", "README states the tool count in words", plus the existing "docs/mcp-tools.md states the tool count in words".

**Out of scope:** operations.md, architecture.md, writing-specs.md (P3-02 to P3-04); any server change.

**Verification:** `foundry_verify`.

**Depends on:** P1-10, P1-12, P1-13

### P3-02: Operations: flight after flight, and signing

**Goal:** docs/operations.md explains running flight after flight and how signing works end to end (S-13).

**Files touched:** `docs/operations.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-13 (operations.md bullet), S-02, S-07, S-09, S-12 and S-14.
- New section `## Running flight after flight`: the `flight` key; `foundry_flight_archive` and what it moves and copies; `policies.archive` (a ⚠️ ASSUMPTION default of `false`); `foundry_next` staying `done` until docs/SPEC.md is edited; per-flight `## Flight <slug> notes` sections in an existing CLAUDE.md, with other flights' sections left alone; pull-feedback reading archived logs; `foundry_flight_options({ …, resume: true })` after a round-cap halt.
- New section `## Signing`: `policies.signing` (`auto`, `off`, `required`); the per-commit unsigned fallback under `auto`, `state.signing` and `state.signingOverride`; the rollback when a commit fails under `required`; `foundry_pr_finalize`'s signed check (`%G?`, with `E` signed and `N`/`B` not); `awaitingSigning` and `foundry_next`'s `done`; the human's steps (exactly the `next` text) and go-flight's "signing is unlocked, finish it"; `policies.finalize` and `policies.mergeMethod`.
- The configuration example block shows the new `policies` keys. Every new key has a row (`flight`, `mutation.targeted`, `policies.archive`, `policies.finalize`, `policies.mergeMethod`); add any row an earlier task missed.
- "What the flight leaves behind": replace "Nothing in Foundry merges anything" with the S-14 behavior (never a synchronous merge; at most GitHub auto-merge, which waits for CI) and mention `chore: archive flight <slug>`, `chore: finalize flight` and `chore: awaiting signing` commits.
- `test/plugin.mjs`: assertions that operations.md has `## Running flight after flight` and `## Signing`.

**Acceptance tests:** `test/plugin.mjs`: "operations.md explains running flight after flight", "operations.md has a signing section".

**Out of scope:** other docs; server changes.

**Verification:** `foundry_verify`.

**Depends on:** P1-09, P1-12, P1-13

### P3-03: Writing specs and templates: from, targeted mutation, provenance

**Goal:** docs/writing-specs.md and the templates teach `from`, `mutation.targeted`, and provenance logging with a commit-msg hook (S-13, S-03, S-04, cleanflate F-01).

**Files touched:** `docs/writing-specs.md`, `templates/SPEC.md`, `templates/constraints.example.json`, `test/plugin.mjs`, `test/constraints.mjs`

**Design constraints:**

- SPEC §6 S-03 (last bullet), S-04 (last bullet) and S-13 (writing-specs bullet); Appendix A "Carried from the 0.4 plan" (cleanflate F-01).
- writing-specs.md: a short section on rules that become true at a task: name the task, the planner gives the rule `from`, and the `test ! -f X || bash X` guard idiom is no longer needed (project-d F-01, project-c F-21).
- writing-specs.md and templates/SPEC.md section 7: how to name a filterable test command: give the command with an unquoted `{filter}` placeholder where a test class or path goes (for example `php artisan test --filter={filter}`), so the planner can fill `mutation.targeted` and the reviewer can mutate in seconds (project-c F-12, F-17, F-22).
- writing-specs.md: a "Provenance logging" section for a spec that must log or tag Foundry's own activity (cleanflate F-01). Never try to change Foundry's own commit subjects or its clean-tree checks. Use a commit-msg hook (`.githooks/commit-msg`, enabled with `git config core.hooksPath .githooks`) that appends a trailer derived from the subject (`<ID>:` gives `Task: <ID>`; `progress:`, `review:`, `plan:` and `chore:` give `Stage: foundry`); keep a live log gitignored and snapshot it at phase ends. Show the hook as a short sh fence.
- templates/constraints.example.json: a fourth worked rule using `from` (for example a "no TODO in src/" rule with `from: "P2-01"`, the task that clears the last one), with fixtures.
- `test/constraints.mjs`: "every template rule validates and passes its own fixtures": copy templates/constraints.example.json into a planned repo whose PLAN.md has the `from` task; `foundry_verify` reports no `fixture` failure.
- `test/plugin.mjs`: assertions that writing-specs.md mentions `from`, `mutation.targeted` and `commit-msg`; that templates/SPEC.md mentions `{filter}`; and that some template rule carries `from`.

**Acceptance tests:** the `test/plugin.mjs` and `test/constraints.mjs` assertions above.

**Out of scope:** other docs; server changes.

**Verification:** `foundry_verify`.

**Depends on:** P1-05, P1-06

### P3-04: Architecture, contributing table, and feedback headers

**Goal:** docs/architecture.md, CONTRIBUTING.md and both feedback files reflect 0.5.0 (S-13).

**Files touched:** `docs/architecture.md`, `CONTRIBUTING.md`, `docs/feedback/2026-10-07-project-c.md`, `docs/feedback/2026-10-07-project-d.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-13 (CONTRIBUTING and feedback bullets); §2 non-goal: under `docs/feedback/` only the header line changes.
- docs/architecture.md: the stage-machine diagram and the decision list gain the awaiting-signing `done` (right after `halted`) and the archived `done`; "Who may write what" covers `foundry_plan_commit`, `foundry_flight_archive` and `foundry_pr_finalize`; "State on disk" covers `docs/flights/<slug>/` and the new state fields (`signingOverride`, `awaitingSigning`, `breaking`, `haltCap`, `archived`). Keep the diagram Mermaid (`stateDiagram-v2`).
- CONTRIBUTING.md suite table: `state` adds `foundry_plan_commit`; `implement` adds the commit helper's signing fallback; `review` adds rollback, `foundry_flight_archive` and `foundry_pr_finalize`. Still "eleven suites".
- Each feedback file gains, in its header paragraph, the line in the shape docs/feedback/README.md documents: `addressed in [docs/SPEC.md](../SPEC.md) (Foundry 0.5.0); its Appendix A maps every F-item to the requirement that closed it.` No other change under `docs/feedback/`.
- `test/plugin.mjs`: an assertion that both 2026-10-07 feedback files say "addressed in".

**Acceptance tests:** `test/plugin.mjs`: "the 2026-10-07 feedback files name the spec that addressed them"; the existing link and Mermaid checks pass.

**Out of scope:** `docs/plans/`; other docs; server changes.

**Verification:** `foundry_verify`. If `npx` and network access are available, `npm install --no-save mermaid jsdom && node scripts/check-diagrams.mjs`; otherwise record that in the log and leave it to CI.

**Depends on:** P1-12, P1-13

### P3-05: Version 0.5.0 and the CHANGELOG

**Goal:** The version reads 0.5.0 everywhere, and CHANGELOG.md describes the release (S-13).

**Files touched:** `package.json`, `.claude-plugin/plugin.json`, `mcp/server.mjs`, `CHANGELOG.md`, `test/plugin.mjs`

**Design constraints:**

- SPEC §6 S-13 (CHANGELOG and version bullets) and §1 "Why a minor version". Constraint `no-dependencies`: touch only `version` in package.json.
- `0.5.0` in `package.json`, `.claude-plugin/plugin.json` and `mcp/server.mjs`'s `VERSION`; nothing else in the server.
- CHANGELOG.md: `## [0.5.0] — <today's date, YYYY-MM-DD>` above `[0.4.0]`. Lead with why this is a minor version (three new tools, eighteen to twenty-one; the new config keys; the end-of-flight lifecycle; the default model change). Then `### Added`, `### Changed`, `### Fixed` and `### Breaking changes`. The breaking changes are the routing defaults (S-10), the summarize skill no longer writing the file itself (S-01), and `policies.finalize: "auto"`, under which a signed, non-breaking flight's PR now auto-merges once CI is green (S-14). Each entry cites its feedback item as `project-c F-nn` or `project-d F-nn`, or "operator request" for S-10/S-14. Follow the existing entries' voice and link style.
- `test/plugin.mjs`: an assertion that CHANGELOG.md's first `## [x.y.z]` heading equals the package version.

**Acceptance tests:** `test/plugin.mjs`: "CHANGELOG.md's newest entry is the package version"; the existing version-agreement assertions pass.

**Out of scope:** tagging, releasing, merging; `docs/plans/`.

**Verification:** `foundry_verify`.

**Depends on:** none

### P3-06: Phase 3 end: push for the draft PR and record the manual check

**Goal:** Push the finished branch so `foundry_run_finish` opens the draft PR against `main`, marked not to be merged, and record the Phase 3 manual check.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 3 and §2 non-goals: do not merge, tag or release. Follow the implement skill's phase-end rules. The PR body is docs/HANDOFF.md, so the handoff written after this task must begin with the line given in CLAUDE.md's Task protocols ("HANDOFF.md for this flight"). If nothing changed, an empty commit carries the task.

**Acceptance tests:** `npm run check` and `pre-commit run --all-files` are clean (both are in `foundry_verify`).

**Out of scope:** merging, tagging, releasing; `gh pr merge` in any form.

**Verification:** `foundry_verify`. The log entry carries `Manual check: NOT VERIFIED (human)` for "CI is green on the PR".

**Depends on:** none

## Spec issues

1. §7 says all three commands "run today on a clean checkout of `main`". `npm test` does not: `test/plugin.mjs` fails "every foundry_* tool named in prose exists on the server", because docs/SPEC.md names `foundry_plan_commit`, which does not exist yet. Proposed resolution (P1-01): exclude the pipeline's own artifacts from that cross-reference check. A future spec that names tools still to be built would otherwise break every self-hosted flight.
2. The MCP writes PROGRESS.md log headings, and PLAN.md review-fix headings, with no blank line after them, which markdownlint (MD022) rejects. Since `pre-commit run --all-files` is a verify command, every task after the first `foundry_task_done` would fail, and so would CI's lint job on this flight's PR. Proposed resolution (P1-01): exclude those artifacts and `docs/flights/` from markdownlint. A later release could make the MCP write lint-clean Markdown instead.
3. S-07 says that after an archive `foundry_next` returns `plan`. With `policies.archive: true` the controller calls `foundry_next` straight after the summarizer, so the flight would immediately re-plan from the same, unchanged SPEC. Proposed resolution (P1-12): `done` while docs/SPEC.md equals the archived copy, `plan` once it is edited.
4. S-14 orders `foundry_pr_finalize` after `foundry_flight_archive`, but the archive resets state (so `summarized` reads false) and moves docs/foundry.json (so the policies are gone). Proposed resolution (P1-12, P1-13): the fresh state records `archived: { slug, dir, at }`, and `foundry_pr_finalize` reads the archived state and config.
5. S-14's `resign` steps run `probeSigning("required")` (step 1) before clearing the local `commit.gpgsign` override (step 4), but the probe reads `commit.gpgsign`, which the override forces to `false`, so it would always fail in exactly the case it exists for. Proposed resolution (P1-14): clear the override first, and put it back if the probe or rebase fails.
6. S-07's reset to `DEFAULT_STATE` would drop `state.signingOverride`, while the local git override it describes survives the archive. Proposed resolution (P1-12): carry the flag into the fresh state.
7. S-14 asks for the human's steps "in SUMMARY", but SUMMARY.md is committed before `foundry_pr_finalize` learns whether anything is unsigned. Proposed resolution (P1-13): the tool appends a `## Awaiting signing` section to the flight's SUMMARY.md in its own commit.
8. The implement skill's manual fallback (`git config --local commit.gpgsign false` on a hung commit) does not record `state.signingOverride`, so `resign` would not clear an override set that way. It is not in this flight's scope (S-12 lists other implement changes). Proposed follow-up: the implementer calls a tool instead of `git config`.
9. §4 lists the agent tool-list changes but not go-flight's `allowed-tools`, which must gain `foundry_pr_finalize` for S-14's "signing is unlocked, finish it" mapping. Resolution: P2-05 adds it.
10. S-04 says "the constraint self-test and scan semantics are unchanged" for a targeted mutation, but `foundry_mutate` does not run constraints at all today. Read as "no change".

## Review fixes (round 1)

### R1-01: commitStaged rolls back its own signing fallback when the unsigned retry fails
**Goal:** A Foundry commit whose signing fails under policies.signing "auto" and whose unsigned retry also fails leaves state.json, feedback.jsonl, the index and the local commit.gpgsign setting exactly as it found them (SPEC §3 principle 6, S-02).
**Files touched:** mcp/server.mjs, test/implement.mjs
**Design constraints:** SPEC §6 S-02 and §3 principle 6; CLAUDE.md constraints server-synchronous (spawnSync only, no async/await even in comments) and the reviewer-checked 'rollback on a failed commit'. Fix it once, inside commitStaged (mcp/server.mjs around line 108-145), not by widening each caller's withRollback list. Before the fallback writes anything (git config --local commit.gpgsign false, saveState, appendFeedback, git add), snapshot: the bytes of .foundry/state.json and .foundry/feedback.jsonl (or 'absent'), and the current local commit.gpgsign value (git config --local --get commit.gpgsign, allowFail; empty means unset). If the unsigned retry fails (status non-zero or error), restore both files byte-for-byte (delete one that was absent), unstage them with git reset -q -- <those rels> (allowFail), restore the local commit.gpgsign value (set it back, or --unset when it was unset), then throw the existing 'git commit failed even unsigned' ToolError. The successful-retry path is unchanged. Commit-failure tests follow CLAUDE.md's Commit-failure tests protocol; signing tests follow CLAUDE.md's Signing tests protocol (failing signer = local commit.gpgsign true, gpg.format openpgp, gpg.program /nonexistent-signing-agent).
**Acceptance tests:** test/implement.mjs, in the 'commit signing (S-02)' section, new block "auto: a failed unsigned retry leaves the tree as it found it": a failingSignerRepo with policies.signing "auto", plus an executable .git/hooks/commit-msg that keeps a counter file (for example .git/hook-count) and exits 0 on its first invocation and 1 on every later one, so the signed attempt reaches signing and fails, and the unsigned retry is rejected by the hook. Record docs/foundry.json, .foundry/state.json (or its absence) and .foundry/feedback.jsonl (or its absence) and HEAD. foundry_flight_options({ maxRounds: 5 }) is an error matching /failed even unsigned/; afterwards each recorded file is byte-identical (or still absent), git diff --cached --name-only is empty, HEAD did not move, and git config --local commit.gpgsign is still 'true'. This test fails on the current code (state.json and feedback.jsonl stay modified and staged, and commit.gpgsign is 'false').
**Out of scope:** Wrapping feedback_log, task_next's skip commit or the stream tools in withRollback; changing what counts as a signing failure or the 30 s bound; any skill or doc change beyond a one-line mention in docs/mcp-tools.md's intro if its rollback sentence becomes inaccurate.
**Verification:** foundry_verify (npm run lint, pre-commit run --all-files, npm test).
**Depends on:** none

### R1-02: Tests for four mcp/server.mjs mechanics that survive mutation
**Goal:** Every round-1 mutation survivor in mcp/server.mjs is killed by a test: targeted-filter quoting, strayArtifacts only while PLAN.md is absent, ordinal 11th-13th, and the non-resign all-signed pr_finalize clearing the signing override (S-04, S-08, S-09, S-14).
**Files touched:** test/review.mjs, test/state.mjs
**Design constraints:** Tests only; do not change mcp/server.mjs. Each test must fail against the named mutant (REVIEW.md round 1, finding 2). Signing tests follow CLAUDE.md's Signing tests protocol (mkFakeGpg + useFakeSigner for a working signer). Mutants to kill: (a) mcp/server.mjs mutate(): `t.cmd.replace("{filter}", () => `'${filter}'`)` changed to substitute `${filter}` unquoted; (b) status(): `out.strayArtifacts = out.artifacts["PLAN.md"] === "absent" ? ... : []` with the condition replaced by true; (c) ordinal(): the line `if (mod100 >= 11 && mod100 <= 13) return `${n}th`;` deleted; (d) prFinalize(): the all-signed block `if (st.signingOverride) { git(["config", "--local", "--unset", "commit.gpgsign"] ...); delete st.signingOverride; st.signing = "on"; }` deleted.
**Acceptance tests:** (a) test/review.mjs, targeted section: "a targeted filter is passed as one single-quoted word": mutation.targeted.unit = { cmd: "printf '%s\\n' {filter}" } and filter "tests\\Unit\\FooTest" (a real backslash, which MUTATION_FILTER admits); the result's stdout tail contains the backslashes verbatim (tests\Unit\FooTest). (b) test/state.mjs, artifacts section: "an untracked artifact beside a present plan is not stray": plannedRepo plus an untracked docs/HANDOFF.md; artifacts["HANDOFF.md"] is "untracked" and strayArtifacts is []. (c) test/review.mjs, convergence section: "an 11th non-converging round reads 11th": preload state (setState) with ten prior CHANGES REQUESTED rounds marked nonConverging and growing fixTasks, maxRounds 11 and maxRoundsHard high enough, then submit the next round with REVIEW.md stamped accordingly; the halt contains 'the 11th non-converging round' and not '11st'. (d) test/review.mjs, pr_finalize section: "a manual re-sign then finalize clears the override": a branch whose commits are all signed by the fake signer, state with signingOverride: true and signing 'off (probe failed: x)', local commit.gpgsign false; foundry_pr_finalize({ breaking: false }) leaves git config --local commit.gpgsign unset, and state.json has signing 'on' and no signingOverride.
**Out of scope:** Any change to mcp/server.mjs or docs; other mutation survivors outside mcp/server.mjs.
**Verification:** foundry_verify. Each new test must name its assertion so a reader can map it to (a)-(d).
**Depends on:** none

### R1-03: Agent tool contracts and README routing defaults are asserted
**Goal:** test/plugin.mjs fails when an agent loses a tool SPEC §4 gives it, or when README's defaults disagree with agents/*.md; README.md and docs/routing.md state the 0.5.0 defaults correctly (S-10, SPEC §4).
**Files touched:** README.md, docs/routing.md, test/plugin.mjs
**Design constraints:** SPEC §4 'The agent tool lists' and §6 S-10; PLAN P1-01 (README's routing note and defaults sentence say opus for planner, reviewer and summarizer). Fix README.md:56, which reads 'the planner and reviewer use `opus`', so that it names the summarizer too. Fix README.md:72, which reads '`summarizer` (fable, medium)', to say opus, medium. Fix docs/routing.md:302, which reads '`opus` (unchanged)', so it no longer calls the planner's default unchanged. Do not touch agents/*.md, docs/operations.md's calibration table, or anything under docs/plans/ or docs/feedback/. Constraint no-fable-default still holds.
**Acceptance tests:** test/plugin.mjs: (1) "agents/planner names foundry_plan_commit" and "agents/summarizer names foundry_summary_commit, foundry_flight_archive and foundry_pr_finalize": each is a separate assertion on the parsed tools: frontmatter list containing mcp__plugin_foundry_foundry__<tool>. Each fails if that entry is deleted from agents/summarizer.md or agents/planner.md, which round 1's mutants showed survive today. (2) "README's agent defaults match agents/*.md": for each agent, README contains `<name>` (<model>, <effort>), with model and effort read from that agent's frontmatter. This fails on the current README.md:72.
**Out of scope:** Server changes; skill prose; changing any agent's tools or model.
**Verification:** foundry_verify. grep -n 'fable' README.md prints nothing.
**Depends on:** none
