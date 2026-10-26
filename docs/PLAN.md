# Kūkulu 0.7.2 build plan

Derived from docs/SPEC.md v0.7.2 on 2026-10-26. SPEC.md wins over this file.

## Decisions

- Phases → SPEC §8's four phases, in order, none merged: the base fix (P0-01, below) and the guard (A), signing (B), the PR and the release (C), then the reviewer tools, documentation and release (D, E). Inside each phase the order is SPEC §6's.
- The base is not green → `main` at `418b291` ("Iterate on agent config for new flights", committed after the SPEC) fails 44 assertions in four suites (`plugin` 8, `state` 7, `routing` 23, `drive` 6, measured while planning) and the carried-over `no-fable-default` constraint, because `agents/*.md` name `fable-5-1`, `sonnet-5-5` and `opus-5-5`. SPEC §1 requires `npm test` to pass and principle 7 keeps `no-fable-default`, so P0-01 restores the four files' `model:` and `effort:` lines of `418b291^`, before any SPEC work, in a commit of its own that the owner can drop. The owner's per-role models already live in the global routing config, which no task touches.
- Parallel streams → none; the plan is fully serial, as SPEC's size recommendation and §9 Q5 say. Nearly every task edits `mcp/server.mjs` or `mcp/cleanroom.mjs`, plus `CHANGELOG.md` and `docs/mcp-tools.md`.
- Flight slug → `v0-7-2`, the slug SPEC's size recommendation and §9 Q5 name (the title-derived `kukulu-0-7-2` would make Phase 2's manual check wrong).
- `baseBranch` → `main`, the branch the plan is committed on and the one SPEC §5.1 names; build branches are `build/<date>`.
- `maxRounds` and `maxRoundsHard` → the defaults, 3 and 6; SPEC asks for no other tolerance. A later `kukulu_flight_options` change is recorded by the operator's tool, not here (that is what C-04 builds, and the running 0.7.1 does not have it).
- `policies` → `{ "archive": true }` only, as SPEC §5.1 says: the running 0.7.1 server still defaults it to `false`. Every other key keeps its default.
- Constraints → the 28 rules of `docs/flights/v0-7-1/kukulu.json`, carried over with identical patterns, flags, paths, excludes and fixtures (principle 7, §5.3); none added. The file is ASCII-only, with JSON escapes for non-ASCII characters; the parsed values are unchanged.
- `extraVerify` and `mutation.targeted` → SPEC §7, the same as 0.7.1: the guard self-test on `scripts/cleanroom-guard.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json` and `templates/cleanroom.example.json`; `npm run check:site` on `site/`, `docs/site/` and the three site scripts; `suite` = `node test/{filter}.mjs`.
- §9 Q1 (finalize follows the signing policy) → it does (B-03), an owner decision of 2026-10-26.
- §9 Q2 (the default PR title) → `<flight>: <spec title>` (C-01), an owner decision of 2026-10-26, over the slug alone and over keeping `Build: <branch>`.
- §9 Q3 (`policies.archive` defaults to true) → it does (C-02), an owner decision after two release flights that both needed it. It is no longer an ⚠️ ASSUMPTION; the planner has already moved it out of CLAUDE.md's ASSUMPTION list, and P2-03 makes the code match.
- §9 Q4 (the two known-gap candidates) → fixed as rules (A-01, A-02), not added to `KNOWN_LIMITS`: both are whole command words or options with one meaning (principle 1's third condition).
- §9 Q5 (one flight) → `v0-7-2`, four phases, serial.
- §9 Q6 (0.7.1 SUMMARY's suggested CLAUDE.md additions) → the guard-cases indentation goes into CLAUDE.md's shared guard-rule protocol; merge commits without pathspecs, `kukulu_verify`'s large output and the running plugin go into this flight's notes section. All four still apply.
- A-01's order → inside the rsync block, the `--delete*` check runs first, then `--remove-source-files`, then 0.7.1 A-04's landing-path and containment checks. So `rsync -r --del empty/ ./` is denied with the `--delete*` reason.
- A-01's reason text → `rsync --delete*` is written literally, with the `*`, whichever option of the family the command used; the destination is quoted as the command wrote it.
- A-01's `--remove-source-files` sources → a source is denied when it equals, contains or lies under a protected path. SPEC says "equals or contains"; a source under a protected directory (`.kukulu/cleanroom/log.jsonl`) is a protected file too, and removing it is a protected write. The reason names the protected path for equals and contains, and the source's resolved path when it lies under one.
- A-01's option matching → each option is matched as a whole token (`--delete-after`), or by its part before `=`; no rsync option of either family takes a value, and abbreviations stay a known gap under `KNOWN_LIMITS` entry 3.
- A-03's fixture → `rsync -a evil/ .kukulu/ (P0-05)` gets a reason that names the protected path; its current reason `protected path` would still match, so the change tightens it rather than repairs it.
- B-01's empty tree → the probe computes the empty tree's id with `git hash-object -t tree /dev/null` (no `-w`). In a SHA-1 repository that is SPEC's `4b825dc642cb6eb9a060e54bf8d69288fbee4904`, and in a SHA-256 repository it is the correct id, where the literal would make every probe fail and turn signing off.
- B-01's unsigned call → passes `--no-gpg-sign` explicitly, so a git that honours `commit.gpgsign` in `commit-tree` cannot sign it.
- B-02's "not configured" outcome → on the fresh path, when the override is lifted and the operator's own setting is not configured, `signing` is `"none"` and `signingOverride` is deleted: the override was the only thing saying "sign". On the already-started path, the override is put back and the state is left exactly as it was, so the earlier `off (…)` record stays (SPEC B-02).
- B-02's re-probe that falls back again → recorded exactly like the fresh path's fallback: the new `off (probe failed: …)` outcome, the override put back, and one `signing` feedback entry.
- B-03's `state.signing` after an archive → when the live state is a fresh post-archive state (it has `archived` and no `signing`), finalize reads `signing` from `<archived.dir>/state.json`, as it already does for `summarized`. A `signing` that is absent from both counts as configured (finalize waits), which is today's behavior.
- B-03's `signingNote` text → SPEC's two sentences with a capital first letter: "Commits in this run are unsigned and kukulu_pr_finalize will not wait for signatures." for `"off"` and `"none"`, and "Commits from here on are unsigned; kukulu_pr_finalize will wait for signatures, so unlock the signing agent and call kukulu_run_start again to resume signing, or re-sign at the end." for an outcome that starts `off (`. The `Run policies:` sentence appends the same text whenever `state.signing` is a string other than `"on"`; a null `signing` (no run started yet) adds nothing.
- B-04's unconfigured signer → when `commit.gpgsign` is not `true`, B-01's probe does not run (it is defined only when signing is in effect), so the plan reason is today's. `kukulu_run_start` still refuses that case under `required`, as today.
- B-04's policy source → `docs/kukulu.json`, else `<state.archived.dir>/kukulu.json`, else the default; a file that is not valid JSON, or whose `policies.signing` is not a string, counts as "not `required`" here, because `kukulu_next` must not throw at the plan stage over a config the planner is about to rewrite.
- C-01's length → counted in Unicode code points (`Array.from(title).length`), both for the 120-character cut and for `prTitle`'s validation, so a title is never cut inside a character.
- C-01's merge subject → `<title> (#<number>)` as GitHub writes squash subjects; not cut.
- C-03's placement → the CHANGELOG check runs after the argument type checks and before the `resign` path and any write, so a disagreeing `breaking` refuses on every call, `resign` included.
- C-04's placement → the new line goes after the last non-blank line of `## Decisions`, before the blank line that precedes the next `## ` heading. `<old>` is the resolved value before the call (3 or 6 when the key was absent). When `docs/PLAN.md` does not exist, nothing is recorded.
- D-01's pagination → one page of 100 check runs; a flight with more is out of scope.
- D-02's non-list values → anything that is not an array keeps today's string check and message; only an array gets the new list message.
- D-03's blob comparison → `git diff --raw HEAD` shows a zero id for the working-tree side, so for a path whose new id is all zeros the task hashes the working-tree file with `git hash-object -- <path>` (no `-w`) and compares it with the old id; equal ids with different modes is `mode`.
- README and `docs/architecture.md` under B-03 → README's "Read `docs/SUMMARY.md`" step and its `kukulu_pr_finalize` table row, and `docs/architecture.md`'s finalize sentence, say finalize waits for any unsigned commit. After B-03 that is false for `off` and unconfigured `auto`, so P1-03 corrects those sentences only (principle 8); see Spec issues.
- Changelog → tasks add lines under `## [Unreleased]` (the first task that touches CHANGELOG.md creates it above `## [0.7.1] — 2026-10-20`), under `### Changed` or `### Fixed` only. Changed: A-01, A-02, B-03, C-01 (title, subject and `prTitle`), C-02, C-03, D-02. Fixed: A-03's reason, B-01, B-02, B-04, C-04, D-01, D-03. P3-04 renames the heading to `## [0.7.2] — <date>`. There is no Added and no Breaking changes heading.
- HANDOFF.md → no "do not merge" line (SPEC §6 E).

## Conventions

- Commit template: `CLAUDE.md` `## Commit template`, title `<ID>: <title>`, written to a file and committed with `git commit -F <file>`. `Measurement: n/a` on every task: this flight tunes nothing.
- Every task's verification is `kukulu_verify` with its Files touched: `npm run lint`, `pre-commit run --all-files` and `npm test` (900 s) always; the guard self-test for clean-room paths.
- Shared protocols are in `CLAUDE.md` `## Task protocols`: the guard-rule protocol for P0-02 to P0-04, the signing-tests and commit-failure protocols for Phase 1 and P2-05.
- Tests are named by their assertion message; the names below are the messages to use.

## Phase 0 — The guard

### P0-01: The agent defaults pass the plugin's own checks again

**Goal:** `agents/*.md`'s `model:` and `effort:` lines read the values `README.md`, `test/plugin.mjs` and the `no-fable-default` constraint expect, so `npm test` and `kukulu_verify` pass on the base before any SPEC work starts.

**Files touched:** `agents/planner.md`, `agents/implementer.md`, `agents/reviewer.md`, `agents/summarizer.md`

**Design constraints:**

- SPEC §1 ("Done means" `npm test` passes), §3 principle 7 (`no-fable-default` carries over unchanged), §7 ("runs today on a clean checkout of `main`"); CLAUDE.md Constraints `no-fable-default`.
- The base commit `418b291` ("Iterate on agent config for new flights") set `model: fable-5-1`/`effort: medium` (planner), `model: sonnet-5-5` (implementer) and `model: opus-5-5` (reviewer, summarizer). That fails 44 assertions of `npm test` (`plugin` 8: "agents/<role> pins a known model" and "README's agent defaults match agents/<role>.md"; `state` 7; `routing` 23; `drive` 6: "the plugin <role> agent is named" and the like) and `no-fable-default` (`model: fable-5-1` matches `^model:\s*fable\b`). The server's `isAnthropicModel` also reads `sonnet-5-5` and `opus-5-5` as non-Anthropic models.
- Restore exactly the four files' `model:` and `effort:` lines of `418b291^` (`git show 418b291^:agents/<role>.md`): planner `opus`/`high`, implementer `sonnet`/`medium`, reviewer `opus`/`high`, summarizer `opus`/`medium`. Change no other line. The owner's per-role models for their own flights live in the global routing config (`~/.config/kukulu/config.json`), which this task never reads or touches.
- No `CHANGELOG.md` line: 0.7.1 shipped these values, so a user sees no change.
- The commit body says this reverts the agent lines of `418b291` and why, so the owner can drop the commit if they meant to change the shipped defaults.

**Acceptance tests:** the existing suites, unchanged: `npm test -- plugin state routing drive` passes (the planner checked that restoring these lines alone makes all four pass), including "agents/<role> pins a known model" and "README's agent defaults match agents/<role>.md" for all four roles; the `no-fable-default` constraint passes.

**Out of scope:** `test/plugin.mjs`'s `MODELS` list, README, the routing code, and any other agent frontmatter line (`tools:`, `skills:`, `color:`).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P0-02: rsync's deleting options are write targets

**Goal:** An rsync call with a `--delete*` option is denied when its destination equals or contains a protected path, and one with `--remove-source-files` is denied when a source equals, contains or lies under one.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 1, 3, 6 and 8, §6 A-01; CLAUDE.md guard-rule protocol; `cleanroom-module-pure` and `server-synchronous` (no `async`/`await` in `mcp/cleanroom.mjs`, comments and strings included; no new imports).
- `rsyncParts(rest)` returns `{ operands, recursive, deletes, removesSources }`. `deletes` is true when a token equals one of `--delete`, `--del`, `--delete-before`, `--delete-during`, `--delete-delay`, `--delete-after`, `--delete-excluded`, `--delete-missing-args`, or its part before `=` does; `removesSources` likewise for `--remove-source-files`. No abbreviation matching (a known gap under `KNOWN_LIMITS` entry 3). Do not change `RSYNC_SPEC` or how `recursive` is computed.
- In `evaluate`'s rsync block, when there are at least two operands, in this order: (1) with `deletes`, the destination (last operand) is denied when one of its write forms equals or contains a protected path: `protected path: <protected path> (rsync --delete* can remove it from <dest>)`, with `--delete*` written literally and `<dest>` as the command wrote it, naming the first protected path in `protectedPaths` order; (2) with `removesSources`, each source (every operand but the last) is denied when it equals or contains a protected path, `protected path: <protected path> (rsync --remove-source-files removes it)`, or lies under one, with the source's resolved path in that slot; (3) 0.7.1 A-04's existing landing-path and recursive containment checks, unchanged.
- `docs/cleanroom.md` rule 6's rsync sentence names both families: a call with `--delete`, `--del` or `--delete-*` is denied when its destination equals or contains a protected path, recursive or not, and `--remove-source-files` makes each source a write target. Change nothing else in the rule.
- `CHANGELOG.md` → create `## [Unreleased]` with `### Changed` above `## [0.7.1] — 2026-10-20` if it is absent; add: rsync's deleting options (`--delete`, `--del`, `--delete-*`) now deny a destination that equals or contains a protected path, and `--remove-source-files` denies a protected source (0.7.1 known-gap candidate).

**Acceptance tests:**

- `test/fixtures/guard-cases.json`, policy `"template"`, cwd `__ROOT__`, names `<command> (P0-02)`: denied `rsync -d --delete empty/ docs/` (reason `protected path: .*docs/cleanroom\.json \(rsync --delete\* can remove it from docs/\)`), `rsync --dirs --delete-after empty/ .kukulu/` (reason `rsync --delete\* can remove it from \.kukulu/`), `rsync -r --del empty/ ./` (reason `rsync --delete\* can remove it from \./`), `rsync --remove-source-files docs/cleanroom.json build/` (reason `protected path: .*docs/cleanroom\.json \(rsync --remove-source-files removes it\)`), `rsync --remove-source-files .kukulu/cleanroom/log.jsonl out/` (reason `rsync --remove-source-files removes it`); allowed `rsync -a --delete src/ build/`, `rsync --remove-source-files build/a.o out/`, `rsync -d empty/ docs/`.
- `test/cleanroom.mjs`, in the block "rsync and tar denials name what they hit": `run("rsync -d --delete empty/ docs/").reason` equals `protected path: /p/docs/cleanroom.json (rsync --delete* can remove it from docs/)` ("an rsync --delete denial names the protected path and the destination"), and `run("rsync --remove-source-files docs/cleanroom.json build/").reason` equals `protected path: /p/docs/cleanroom.json (rsync --remove-source-files removes it)` ("an rsync --remove-source-files denial names the protected path").
- Every existing fixture keeps its decision and reason.

**Out of scope:** `bsdtar`/`gtar` (P0-03); the recursive denial's reason text (P0-04); rsync option abbreviations; `KNOWN_LIMITS`; any other command word.

**Verification:** `kukulu_verify` (runs the guard self-test); also `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` before committing.

**Depends on:** none

### P0-03: bsdtar and gtar get every decision tar gets

**Goal:** Wherever `mcp/cleanroom.mjs` names the command word `tar`, the words `bsdtar` and `gtar` get the same treatment, and a reason names the word as written.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 1, 3, 6 and 8, §6 A-02; CLAUDE.md guard-rule protocol; `cleanroom-module-pure`, `server-synchronous`.
- Define the set of tar words once (for example `const TAR_WORDS = new Set(["tar", "bsdtar", "gtar"])`) and use it at every place that tests `word === "tar"`: the write rule in `evaluate` (0.7.1 A-04: extraction into a protected directory, create/append/update onto a protected archive) and `recursiveOperands` (the recursive-read list and its `plain()` branch). Search the file for every other `"tar"` comparison and route it through the same set. `tarParts` is unchanged: both aliases parse the options the GNU form does.
- A reason that names the command uses the word as written: `protected path: <path> (bsdtar extracts into docs; the archive's contents cannot be known)`.
- `docs/cleanroom.md`: wherever it names `tar` as a command (rule 6's recursive-form list and its tar extraction and create/append/update sentence), add "(also `bsdtar` and `gtar`)" or list them beside it.
- `CHANGELOG.md` `## [Unreleased]` `### Changed`: `bsdtar` and `gtar` now get every guard decision `tar` gets (0.7.1 known-gap candidate).

**Acceptance tests:**

- `test/fixtures/guard-cases.json`, policy `"template"`, cwd `__ROOT__`, names `<command> (P0-03)`: denied (reason `protected path`) `bsdtar -xf a.tar -C docs`, `gtar xf a.tar -C .kukulu`, `bsdtar -cf docs/cleanroom.json src`; denied (reason `deny\.paths`) `bsdtar -cf build/a.tar /usr/include` (first confirm `tar -cf build/a.tar /usr/include` is denied today; if it is not, drop this fixture and say so in the commit body); allowed `bsdtar -tf a.tar`, `gtar xf a.tar -C build`, `gtar cf build/a.tar docs`.
- `test/cleanroom.mjs`, in the block "rsync and tar denials name what they hit": `run("bsdtar -xf a.tar -C docs").reason` equals `protected path: /p/docs/cleanroom.json (bsdtar extracts into docs; the archive's contents cannot be known)` ("a bsdtar denial names the word as written").
- Every existing fixture keeps its decision and reason.

**Out of scope:** other tar implementations or wrappers (`star`, `pax`); new tar options; `KNOWN_LIMITS`.

**Verification:** `kukulu_verify`; also the guard self-test before committing.

**Depends on:** none

### P0-04: The 0.7.1 review's advisory notes on the guard and the server

**Goal:** The recursive rsync denial names the protected path it reaches, `KNOWN_LIMITS`' doc comment cites 0.7.1 A-01, and `checkConstraints`' doc comment sits above its function.

**Files touched:** `mcp/cleanroom.mjs`, `mcp/server.mjs`, `test/fixtures/guard-cases.json`, `test/cleanroom.mjs`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-03, §3 principle 6; CLAUDE.md guard-rule protocol; `cleanroom-module-pure`, `server-synchronous`.
- In the rsync landing-path loop, when the hit comes from recursive containment (a protected path under the destination), the reason is `protected path: <that protected path> (rsync writes it into <dest>)`, the first such path in `protectedPaths` order; a landing-path hit keeps naming the landing path, as today.
- The doc comment above `export const KNOWN_LIMITS` reads `(0.7.1 SPEC A-01)` where it now reads `(SPEC D-03)`.
- In `mcp/server.mjs`, move `checkConstraints`' doc comment from above `const constraintTests` to directly above `function checkConstraints`, and give `constraintTests` a one-line comment of its own saying what it does (one rule against one line). No code changes.
- Change the `reason` of the fixture named `rsync -a evil/ .kukulu/ (P0-05)`, and only that fixture's, to `protected path: .*\.kukulu/(cleanroom|state\.json) \(rsync writes it into \.kukulu/\)`. The commit body lists it by name.
- `CHANGELOG.md` `## [Unreleased]` `### Fixed`: the recursive rsync denial now names the protected path it reaches, not the destination (0.7.1 REVIEW note).

**Acceptance tests:**

- `test/fixtures/guard-cases.json`: the changed fixture above passes.
- `test/cleanroom.mjs`, in "rsync and tar denials name what they hit": `run("rsync -a evil/ .kukulu/").reason` equals `protected path: /p/.kukulu/cleanroom (rsync writes it into .kukulu/)` ("a recursive rsync denial names the protected path it reaches"); the existing "an rsync denial names its destination" still passes.

**Out of scope:** any other reason text; any behavior change in `checkConstraints`.

**Verification:** `kukulu_verify`; also the guard self-test before committing.

**Depends on:** none

### P0-05: Phase 0 end: push and record the manual check

**Goal:** Push the branch with the guard changes and record Phase 0's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 0. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task: `git commit --allow-empty -F <file>` with the subject `P0-05: Phase 0 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): in a live clean-room session with claude --plugin-dir ., rsync -d --delete empty/ docs/ and bsdtar -xf a.tar -C docs are denied`.

**Depends on:** none

## Phase 1 — Signing

### P1-01: A failed commit is classified as a signing failure by a probe

**Goal:** When a commit fails without timing out and its text does not match `SIGNING_FAILURE`, `commitStaged` asks a signed and an unsigned `commit-tree` probe, and treats the failure as a signing failure when only the signed one fails.

**Files touched:** `mcp/server.mjs`, `test/implement.mjs`, `test/fixtures/signing/ssh-agent-missing-key.txt`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-01, §3 principles 4, 10 and 11; CLAUDE.md signing-tests and commit-failure protocols; `server-synchronous`.
- New helper `signingProbe()` returning `{ signedOk, unsignedOk, line }`: the empty tree's id from `git hash-object -t tree /dev/null`; then `git commit-tree -S <tree> -m "kukulu signing probe"` and `git commit-tree --no-gpg-sign <tree> -m "kukulu signing probe"`, each through `spawnSync` with `timeout: SIGNING_TIMEOUT_MS` and `GIT_TERMINAL_PROMPT=0`. `line` is the signed call's first non-empty stderr line (or `timed out`, or `signing probe failed`). It writes only dangling commit objects: no ref, index or tree change.
- `commitStaged`: on a failure that did not time out and whose text does not match `SIGNING_FAILURE`, when `git config --get commit.gpgsign` reads `true`, run `signingProbe()`. If `!signedOk && unsignedOk`, continue down the existing `required`/`auto` paths with `line` = the probe's `line`; otherwise throw the original `git commit failed: …`. `SIGNING_FAILURE` itself does not change.
- `probeSigning` uses `signingProbe()`'s signed call instead of its own `commit-tree -S HEAD^{tree}`, so it also works on an unborn branch. Its outcomes and messages are unchanged.
- The fixture is one line that an SSH signer could print, containing none of `gpg failed to sign`, `failed to sign`, `signing failed`, `cannot exec`, `pinentry`, `ssh-keygen`, `gpg:` (for example `sign_and_send_pubkey: no mutual signature supported; agent refused operation`). The test writes a fake signer script into a temp directory that prints the fixture to stderr and exits 1; the repo gets repo-local `gpg.format ssh`, `gpg.ssh.program <fake>`, `user.signingkey key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKukuluTestKeyOnly` and `commit.gpgsign true`. Never a real key, never a PEM.
- `docs/operations.md` `## Signing`: a commit that fails for a reason git does not word as signing is checked with a signed and an unsigned probe on the empty tree, so an SSH signer's own error still counts as a signing failure.
- `CHANGELOG.md` `### Fixed`: a commit whose signer printed its own error (an SSH agent without the key) is now recognized as a signing failure, so `auto` falls back instead of failing the commit (project-e F-03).

**Acceptance tests:** `test/implement.mjs`:

- "an SSH signer's own error falls back under auto": `kukulu_plan_commit` succeeds, HEAD's subject is `plan: derive build plan from SPEC`, `git log -1 --format=%G?` is `N`, `state.signing` starts with `off (commit signing failed:` and contains the fixture's text, and `.kukulu/feedback.jsonl` holds exactly one entry with category `signing`.
- "an SSH signer's own error refuses under required": same repo with `policies.signing: "required"`; the refusal matches `policies.signing is 'required' and the commit could not be signed:` and contains the fixture's text, HEAD did not move, and `git diff --cached --name-only` is empty.
- "a commit that fails for another reason is not turned into a fallback": a working fake gpg (`mkFakeGpg`, `useFakeSigner`) and a `.git/hooks/commit-msg` that exits 1 for subject `plan:`; the refusal matches `^git commit failed:`, `state.signing` is unchanged, and local `commit.gpgsign` still reads `true`.

**Out of scope:** `kukulu_next`'s plan-stage probe (P1-04); the override's lifetime (P1-02); widening `SIGNING_FAILURE`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-02: The fallback's override is lifted at the next run start

**Goal:** When `state.signingOverride` is true, `kukulu_run_start` unsets the local `commit.gpgsign false` it wrote and re-probes the operator's own setting, on a fresh run and on an already-started one.

**Files touched:** `mcp/server.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-02, §3 principles 4 and 11; CLAUDE.md signing-tests protocol (a test that unsets the local `commit.gpgsign` gives the server an isolated `GIT_CONFIG_GLOBAL`); `server-synchronous`.
- `probeSigning(signingPolicy, st)`: when `st.signingOverride` is true and the policy is not `off`, run `git config --local --unset commit.gpgsign` first, then decide as today from the operator's setting. On `"on"`: delete `st.signingOverride`. On a fallback (`off (probe failed: …)`): the local `false` is written again and `signingOverride` stays true. On `"none"`: see the next bullet. Under `required`, put the override back before rethrowing.
- Fresh path (`startRun` past the already-started return): a `"none"` outcome after lifting the override deletes `signingOverride` and records `"none"`.
- Already-started path: only when `st.signingOverride` is true, re-probe. On `"on"` or a fallback, record the outcome (a fallback logs one `signing` feedback entry, as the fresh path does) and commit `.kukulu/state.json` and the feedback log with `gitCommitIfChanged(..., "chore: signing re-probed", { stage: implementStage(st) })`. On `"none"`, put the override back and change nothing, so an `off (commit signing failed: …)` or `off (probe failed: …)` record is never replaced by `"none"`. The result keeps `signing` (it already has it).
- A repo-local `commit.gpgsign false` with no `signingOverride` is the operator's choice: never unset, never re-probed.
- `docs/mcp-tools.md` `kukulu_run_start` and `docs/operations.md` `## Signing` say that the next run start lifts a fallback's override and re-probes, including on an already-started branch.
- `CHANGELOG.md` `### Fixed`: the local `commit.gpgsign false` an `auto` fallback writes is lifted at the next `kukulu_run_start`, so a recovered signing agent signs again and the next flight no longer runs unsigned without warning (project-f F-01, F-03; project-e F-06 to F-08).

**Acceptance tests:** `test/implement.mjs`, each with the operator's signing (fake gpg from `mkFakeGpg`, `gpg.format openpgp`, `user.signingkey`, `commit.gpgsign true`) in a temp `GIT_CONFIG_GLOBAL` file passed to `startServer`, and the repo-local `commit.gpgsign false` a fallback would leave:

- "an archived flight's override is lifted when the signer works": state is a post-archive state with `signingOverride: true`; `kukulu_run_start` returns `signing: "on"`, `git config --local --get commit.gpgsign` no longer reads `false`, `signingOverride` is absent, and the run-start commit's `%G?` is not `N`.
- "an archived flight's override comes back when the signer still fails": the fake gpg fails (its `fail-after` file at 0); `signing` starts with `off (probe failed:` and local `commit.gpgsign` reads `false` again with `signingOverride: true`.
- "a resumed run re-probes after the signer recovers": an already-started run with `signingOverride: true` and `signing: "off (commit signing failed: timed out)"`; `kukulu_run_start` returns `alreadyStarted: true` and `signing: "on"`, and the next commit (`chore: signing re-probed`) is signed.
- "an operator's own local false is left alone": no `signingOverride`, local `commit.gpgsign false`; `signing` is `"none"` and local `commit.gpgsign` still reads `false`.

**Out of scope:** finalize's signature wait (P1-03); `kukulu_pr_finalize`'s `resign` path, which keeps its own unset.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-03: kukulu_pr_finalize waits for signatures only when the policy expects them

**Goal:** Finalize holds the PR for signatures only under `required`, or under `auto` when signing was configured at run start; `kukulu_run_start` and `kukulu_next` say up front which case applies.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/implement.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `docs/architecture.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-03, Appendix B item 2, §3 principles 2, 3 and 8; `server-synchronous`; `no-sync-merge` (the `gh pr merge` array is untouched).
- `signaturesExpected(policy, signing)`: true when `policy === "required"`, or `policy === "auto"` and `signing !== "none"`. In `prFinalize` the policy is `finalizeConfig(st).policies.signing`, and `signing` is `st.signing`, else (a post-archive state with `archived` and no `signing`) the `signing` of `<archived.dir>/state.json`, read like `summarized` is.
- Not expected: `signedCheck` still runs and its `signed` and `unsigned` counts are reported, no `awaitingSigning` is recorded, the PR proceeds per `policies.finalize`, and the result gains `signatures: "not required: policies.signing is <policy>"` (policy `off`) or `"not required: signing is not configured"` (`auto` with `"none"`). Expected: behavior unchanged, `signatures: "required"`, on the awaiting result too.
- `signingNoteFor(signing)`: `null` for `"on"` or a non-string; "Commits in this run are unsigned and kukulu_pr_finalize will not wait for signatures." for `"off"` and `"none"`; "Commits from here on are unsigned; kukulu_pr_finalize will wait for signatures, so unlock the signing agent and call kukulu_run_start again to resume signing, or re-sign at the end." for a value starting `off (`. `kukulu_run_start`'s results (fresh, already-started and stream) gain `signingNote` when it is not null. `kukulu_next`'s `policySentence` appends ` <note>` when `st.signing` gives a note.
- Update `kukulu_pr_finalize`'s and `kukulu_run_start`'s `TOOLS` descriptions, `docs/mcp-tools.md` (both tools, and `kukulu_next`'s policy sentence), `docs/operations.md` `## Signing` (the finalize paragraph that says it looks only at the commits), `docs/architecture.md`'s sentence "when a commit is unsigned it leaves the PR a draft", and README's step 4 sentence and `kukulu_pr_finalize` row: finalize waits for an unsigned commit only when the policy expects signatures.
- `CHANGELOG.md` `### Changed`: `kukulu_pr_finalize` waits for signatures only under `required`, or `auto` with signing configured; `kukulu_run_start` returns a `signingNote` and every stage prompt carries it (owner decision; project-e F-06 to F-08, project-f F-01).

**Acceptance tests:**

- `test/review.mjs`: "finalize does not wait under signing off" (`policies.signing: "off"`, unsigned commits: `ready` true with the fake gh, `awaitingSigning` null, `signatures` is `not required: policies.signing is off`, `unsigned` > 0); "finalize does not wait under auto with no signing configured" (`state.signing: "none"`: `signatures` is `not required: signing is not configured`); "finalize still waits under auto after a fallback" (`state.signing` `off (commit signing failed: x)`: `merge` is `skipped: awaiting signing`, `signatures` is `required`); "finalize still waits under required" (an unsigned commit: awaiting); "finalize reads signing from the archived state" (a post-archive state, archived `signing: "none"`: not awaiting).
- `test/implement.mjs`: "run_start says commits are unsigned and finalize will not wait" (`policies.signing: "off"`: `signingNote` equals the first sentence); "run_start says finalize will wait after a fallback" (a probe fallback under `auto`: the second sentence); "run_start has no signingNote when signing is on".
- `test/state.mjs`: "the Run policies sentence carries the signing note" (`state.signing: "none"`: the implement prompt ends with the first sentence) and "...and not when signing is on".

**Out of scope:** the signed check itself (`%G?` handling); `resign`; the plan-stage probe (P1-04).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-04: A broken signer is reported before the plan stage under required

**Goal:** Under `policies.signing: "required"`, `kukulu_next` probes the signer when it returns stage `plan`, and a failing probe changes the reason so the controller stops before the planner runs.

**Files touched:** `mcp/server.mjs`, `skills/go-flight/SKILL.md`, `test/state.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-04, §3 principles 2, 3 and 4; `server-synchronous`.
- At the `return stage("plan", …)` in `next()`, read the policy from `docs/kukulu.json`, else `<state.archived.dir>/kukulu.json`, else the default (`auto`); unreadable JSON or a non-string `policies.signing` counts as not `required`. Only under `required`, and only when `git config --get commit.gpgsign` reads `true`, run `signingProbe()` (P1-01's helper; if it does not exist, write it as P1-01 describes). It writes no config and no state.
- When `signedOk` is false, the stage is still `plan` and the reason is `policies.signing is 'required' and the signing probe failed: <line>. Fix the signing agent before planning, or set policies.signing to 'auto' or 'off'.` Otherwise the reason is today's.
- `skills/go-flight/SKILL.md` step 2 gains one sentence: if `stage` is `plan` and `reason` starts with `policies.signing is 'required' and the signing probe failed`, print the reason and stop without starting the planner.
- `docs/mcp-tools.md` `kukulu_next` and `docs/operations.md` `## Signing` describe the plan-stage probe.
- `CHANGELOG.md` `### Fixed`: under `policies.signing: "required"`, `kukulu_next` reports a broken signer before the plan stage instead of after the planner's work (project-e F-03).

**Acceptance tests:**

- `test/state.mjs`: "a required policy with a failing signer stops before planning" (a repo with SPEC only, the policy in `<archived.dir>/kukulu.json`, a fake gpg that fails: `stage` is `plan`, the reason starts with the prefix above and no file or config changed: `git status --porcelain` is empty and local config is byte-identical); "a required policy with a working signer gives the plan reason"; "an auto policy with a failing signer gives the plan reason".
- `test/plugin.mjs`: "go-flight stops on a required-signing probe failure" (the skill contains `policies.signing is 'required' and the signing probe failed`).

**Out of scope:** probing under `auto` or `off`; `kukulu_run_start`'s own refusals.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-05: Phase 1 end: push and record the manual check

**Goal:** Push the branch with the signing changes and record Phase 1's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task, subject `P1-05: Phase 1 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): in a scratch repo with the owner's real SSH signer and SSH_AUTH_SOCK pointed at the wrong agent, kukulu_plan_commit under auto commits unsigned and logs the fallback; with the socket fixed, kukulu_run_start signs again`.

**Depends on:** none

## Phase 2 — The PR and the release

### P2-01: The draft PR is titled after the flight, and prTitle overrides it

**Goal:** `kukulu_run_finish` titles a new draft PR from `prTitle`, else `<flight>: <spec title>`, else `Build: <branch>`, with no round suffix.

**Files touched:** `mcp/server.mjs`, `test/harness.mjs`, `test/implement.mjs`, `test/routing.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-01, §5.1, Appendix B item 3, §3 principles 2, 5 and 8; CLAUDE.md "Adding a `docs/kukulu.json` key" protocol; `server-synchronous`.
- `cfgFrom` validates `prTitle` beside `flight` and returns it as `prTitle: c.prTitle ?? null,` (four-space indent, so `test/plugin.mjs`'s config-keys loop finds it). Refusal, before anything else uses the config: `docs/kukulu.json prTitle must be 1 to 120 characters on one line; got <what>`, where `<what>` is `JSON.stringify(value)` for a non-string, `""` for an empty string, `<n> characters` when longer than 120 code points, and `a newline` when it contains `\n` or `\r`.
- `prTitleFor(c, branch)`: `c.prTitle` as written; else the first `^# ` heading of `docs/SPEC.md` with `/\s*[—–:-]\s*Spec(ification)?\s*$/i` removed, prefixed `<flight>: ` when `c.flight` is set; else `Build: <branch>`. Cut to 120 code points. `runFinish` passes it to `gh pr create --title` and its result gains `prTitle` when it created a PR. An existing PR is reused and never retitled.
- `test/harness.mjs` `mkFakeGhBin`: `pr create` also records its `--title` and a `"number":1` in `pr.json` (JSON-escaped), so later tasks can read them back with `pr view`.
- Existing tests that assert `Build: <branch>` or `(review round <n>)` titles are updated to the new rule.
- `docs/operations.md` config table gets the `prTitle` row (string, derived default, 1 to 120 characters, the draft PR's title and the merge commit's subject); `docs/mcp-tools.md` `kukulu_run_finish` describes the title and `prTitle` in the result.
- `CHANGELOG.md` `### Changed`: the draft PR is titled `<flight>: <spec title>` (new optional key `prTitle` overrides it) instead of `Build: <branch>` (a beta user's request).

**Acceptance tests:**

- `test/implement.mjs`, with the fake gh and an ASCII SPEC heading such as `# Widget 1.0 — Specification`: "prTitle wins" (`--title` in `calls.log` is the configured value); "the derived title strips the Specification suffix" (`flight: "w-1"` gives `w-1: Widget 1.0`); "...and is the spec title alone without a flight" (`Widget 1.0`); "without a spec heading the title is Build: <branch>"; "the title has no round suffix at round 2"; "run_finish returns prTitle when it opened a PR".
- `test/routing.mjs`: one refusal each, asserting the message, for `prTitle: 42`, `""`, a 121-character string and `"a\nb"`; "a 120-character prTitle is accepted".

**Out of scope:** the merge subject (P2-02); renaming an existing PR.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-02: The merge commit's subject repeats the PR title

**Goal:** For `mergeMethod` `merge` or `squash`, `kukulu_pr_finalize` passes `--subject "<title> (#<number>)"` read from the PR itself; for `rebase` it passes none.

**Files touched:** `mcp/server.mjs`, `test/harness.mjs`, `test/review.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-01 ("The merge subject"), §5.3; `no-sync-merge`: the `gh pr merge` arguments stay one inline array literal with `"--auto"` right after `"merge"`; the subject goes after `--auto`, for example ``["pr", "merge", "--auto", `--${method}`, ...subjectArgs]``. Run `kukulu_verify` and confirm the constraint passes.
- Before the merge, for `merge`/`squash`: `gh pr view --json title,number`; on success the subject is `<title> (#<number>)`. On failure the merge runs without `--subject` and `merge` reads `enabled (default subject: <gh's first stderr line>)` when it succeeds.
- `test/harness.mjs`: if `mkFakeGhBin`'s `pr.json` does not yet carry `title` and `number` (P2-01 adds them), add them; and make `pr view` fail when its arguments include `title` and the file `<dir>/view-title-fails` exists (printing that file to stderr).
- `docs/mcp-tools.md` `kukulu_pr_finalize`: the merge subject and the `enabled (default subject: …)` text.
- `CHANGELOG.md` `### Changed`: the merge commit's subject is the PR's title and number (a beta user's request).

**Acceptance tests:** `test/review.mjs`, with the fake gh recording its arguments: "finalize passes the PR title as the merge subject" (merge: `calls.log` has `pr merge --auto --merge --subject <title> (#1)`); "...for squash too"; "...and no subject for rebase"; "a failed title lookup merges with the default subject" (`merge` is `enabled (default subject: <the file's line>)` and no `--subject`).

**Out of scope:** the PR title (P2-01); breaking (P2-04).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-03: policies.archive defaults to true

**Goal:** A flight archives itself by default; `false` keeps the old behavior.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/routing.mjs`, `test/state.mjs`, `test/drive.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-02, §5.1; CLAUDE.md Constraints (the reviewer bullet now names `true` as an owner decision; the planner already updated it).
- `cfgFrom`'s `archive: c.policies?.archive ?? false,` becomes `?? true`, still the only place the default is written; its comment changes from the ⚠️ ASSUMPTION line to one saying the default is an owner decision after two release flights that needed it. No skill changes: the summarize skill already archives on `archive: true`.
- `docs/operations.md`: the `policies.archive` row's default is `true`, not an ⚠️ ASSUMPTION, with why; the "Archive it." paragraph and the example config block say the same.
- Every existing test that relied on the old default sets `archive: false` explicitly or asserts the archive (search the suites for `archive`, `summary_commit` and `flight_archive`).
- `CHANGELOG.md` `### Changed`: `policies.archive` now defaults to `true`; set it to `false` to keep a finished flight in place (owner decision).

**Acceptance tests:**

- `test/review.mjs`: the loop at "summary_commit returns archive" now expects `true` with no `policies` block, `true` with `archive: true`, and `false` with `archive: false`.
- `test/routing.mjs`: "config_show reports archive true by default" and "...and false when it is set".

**Out of scope:** any change to `kukulu_flight_archive` itself or the summarize skill.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-04: The CHANGELOG decides whether a flight is breaking

**Goal:** When `CHANGELOG.md`'s newest entry exists, finalize's breaking verdict is whether that entry has a `### Breaking changes` heading, `breaking` becomes optional, and a disagreeing `breaking` refuses.

**Files touched:** `mcp/server.mjs`, `skills/summarize/SKILL.md`, `test/review.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-03, Appendix B item 4, §3 principles 2, 4 and 9; `server-synchronous`.
- `changelogVerdict()`: `null` unless `CHANGELOG.md` at the root exists and has a line starting `## [`; otherwise `{ breaking, heading }`, where the entry runs from that first `## [` line to the next line starting `## ` (or the end), `heading` is the `## [` line as written, and `breaking` is whether a line of the entry matches `/^###\s+Breaking changes\s*$/i`.
- In `prFinalize`, after the type checks and before the `resign` path and any write: with a verdict, a `breaking` that differs refuses with exactly `breaking: <value> disagrees with CHANGELOG.md's newest entry (<heading>), which <has|has no> a "### Breaking changes" section; the CHANGELOG decides. Call kukulu_pr_finalize again without breaking, and record the disagreement in SUMMARY.md's Breaking call as a note.`; otherwise the verdict is used, whatever `st.breaking` says. Without one, today's rule (`breaking` required on the first call, remembered after). Every result gains `breakingSource: "changelog"` or `"caller"`.
- The `breaking` schema description: optional when CHANGELOG.md decides, required on the first call otherwise.
- `skills/summarize/SKILL.md` Breaking call: when the repository has `CHANGELOG.md`, the line states the CHANGELOG's verdict and its reason, plus `Note:` and the summarizer's own disagreement if it has one, and the last call is `kukulu_pr_finalize({})`; otherwise the line and the `breaking` argument work as today.
- `docs/mcp-tools.md` `kukulu_pr_finalize`: the CHANGELOG rule, the refusal and `breakingSource`.
- `CHANGELOG.md` `### Changed`: `kukulu_pr_finalize` takes its breaking verdict from `CHANGELOG.md`'s newest entry when there is one, and `breaking` is optional then (0.7.1 SUMMARY's Breaking call).

**Acceptance tests:**

- `test/review.mjs`: "a CHANGELOG entry with Breaking changes is breaking" (`breaking` true, `merge` `skipped: breaking`, `breakingSource` `changelog`); "an entry without it is not breaking"; "a disagreeing breaking refuses and writes nothing" (the message above with `has no`; state, SUMMARY.md and HEAD unchanged); "an agreeing breaking passes"; "no CHANGELOG and no breaking gives the existing refusal" (`breaking is required on the first call`); "[Unreleased] counts as the newest entry when it is first".
- `test/plugin.mjs`: "the summarize skill lets the CHANGELOG decide breaking" (the skill names `CHANGELOG.md` in the Breaking call and contains `kukulu_pr_finalize({})`).

**Out of scope:** any other CHANGELOG parsing; the merge subject (P2-02).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-05: kukulu_flight_options records a changed round cap in PLAN.md

**Goal:** When `kukulu_flight_options` changes `maxRounds` or `maxRoundsHard`, it appends one dated line per changed cap to PLAN.md's `## Decisions` and commits PLAN.md with the config.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-04, Appendix B item 5, §3 principles 3 and 4; CLAUDE.md commit-failure protocol; `server-synchronous`.
- For each given cap whose new value differs from `before[k]` (the resolved value before the call): the line `- <YYYY-MM-DD>: <cap> set to <n> (was <old>) by the operator through kukulu_flight_options.`, using the server's `today()`. Insert all lines after the last non-blank line of the `## Decisions` section (before the blank line preceding the next `## ` heading); when there is no `## Decisions` heading, append `\n## Decisions\n\n<lines>\n` at the end of the file. When `docs/PLAN.md` does not exist, nothing is recorded.
- `P.plan` joins the `withRollback` set and the commit's paths only when a line is written. An unchanged value writes nothing to PLAN.md.
- This is the one sanctioned server write to PLAN.md outside `kukulu_plan_commit`; no other PLAN.md content changes.
- `CONTRIBUTING.md`: the `state` suite row names `kukulu_flight_options` (principle 3: no row names it today).
- `docs/mcp-tools.md` `kukulu_flight_options`: the Decisions line.
- `CHANGELOG.md` `### Fixed`: a round cap changed through `kukulu_flight_options` is recorded in PLAN.md's Decisions, so the plan no longer claims the default (0.7.1 SUMMARY note).

**Acceptance tests:** `test/state.mjs`: "a raised cap is recorded in PLAN.md's Decisions" (the line text exactly, placed before the next `## ` heading, and PLAN.md is in HEAD's commit with `docs/kukulu.json`); "an unchanged cap writes nothing to PLAN.md"; "a missing Decisions section is created"; "a failed flight-options commit leaves PLAN.md byte-identical" (a `commit-msg` hook failing `chore: flight options`; PLAN.md and kukulu.json byte-identical, nothing staged, HEAD unmoved).

**Out of scope:** recording any other option; the round-cap logic itself.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-06: Phase 2 end: push and record the manual check

**Goal:** Push the branch with the PR and release changes and record Phase 2's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task, subject `P2-06: Phase 2 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): once 0.7.2 is installed, the next flight's draft PR is titled <flight>: <spec title> (this flight's own PR is opened by the running 0.7.1 as Build: <branch>)`.

**Depends on:** none

## Phase 3 — Reviewer tools, documentation and release

### P3-01: prChecks falls back to the REST API on an older gh

**Goal:** When `gh pr checks --json` fails with `unknown flag: --json`, `prChecks` reads the head commit's check runs and statuses through `gh api` and reports them in the same shape, plus `via: "gh api"`.

**Files touched:** `mcp/server.mjs`, `test/harness.mjs`, `test/state.mjs`, `test/fixtures/gh/pr-checks-unknown-flag.txt`, `test/fixtures/gh/check-runs.json`, `test/fixtures/gh/status.json`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-01, §3 principle 10; `server-synchronous`.
- Trigger: `gh pr checks --json name,state,link` exits non-zero and its stderr matches `/unknown flag:? --json/i`. Then, each call bounded by `CHECKS_TIMEOUT_MS`: `gh pr view --json headRefOid` (parse JSON), `gh api repos/{owner}/{repo}/commits/<sha>/check-runs?per_page=100`, `gh api repos/{owner}/{repo}/commits/<sha>/status` (`{owner}` and `{repo}` written literally; gh fills them in).
- Mapping: a check run whose `status` is not `completed` is pending; a conclusion of `failure`, `cancelled`, `timed_out`, `action_required` or `startup_failure` fails, any other passes; name `name`, link `html_url`. A status (`statuses[]`) of `failure` or `error` fails, `pending` is pending, `success` passes; name `context`, link `target_url`. The overall state follows the JSON path's rule (none when both lists are empty, else fail, else pending, else pass), and the object gains `via: "gh api"`.
- A failing fallback call (non-zero, timeout, unparseable JSON) returns `unknown: <its first line>`, never throws. Every other path of `prChecks` is unchanged.
- Fixtures, committed: the stderr line gh 2.45.0 prints (`unknown flag: --json`, plus the usage line if you have it); a `check-runs` body with one run of each of `success`, `failure`, `cancelled`, `timed_out`, `action_required`, `startup_failure`, `neutral`, `skipped`, and one `in_progress`; a `status` body with one each of `success`, `failure`, `error`, `pending`. The test derives the pass, pending and none bodies from them at runtime (filtering lists); no recorded body is written inline in a `test/*.mjs`.
- `test/harness.mjs` `mkFakeGhBin`: `pr checks` prints `<dir>/checks-stderr` to stderr when it exists; `pr.json` carries a `headRefOid`; `api <path>` prints `<dir>/api-check-runs.json` or `<dir>/api-status.json` by whether the path contains `check-runs` or ends `/status`, and fails with `<dir>/api-fails` on stderr when that file exists.
- `docs/mcp-tools.md` `kukulu_status`: the fallback and `via`.
- `CHANGELOG.md` `### Fixed`: `kukulu_status`'s `prChecks` works on a gh without `pr checks --json` (gh 2.45.0) through the REST API (kukulu F-01; project-e F-02, F-04, F-05).

**Acceptance tests:** `test/state.mjs`: "prChecks falls back to gh api and reports a failure" (state `fail`, `failing` names and links exactly the six failing entries, `via` `gh api`); "...reports pass"; "...reports pending"; "...reports none"; "a failing gh api call is unknown" (`unknown: <the file's first line>`); the existing `prChecks` tests still pass.

**Out of scope:** pagination beyond 100 check runs; parsing gh's plain-text `pr checks` output.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-02: kukulu_mutate's filter takes a list

**Goal:** `filter` accepts a string, as today, or an array of 1 to 10 strings, each substituted single-quoted and space-separated into `{filter}`.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/protocol.mjs`, `docs/mcp-tools.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-02, §3 principles 3 and 9; `server-synchronous`.
- An array: empty, more than 10 entries or a non-string entry refuses with `filter must be a string or a list of 1 to 10 strings, each 1 to 200 characters from letters, digits and _ . : / -; got <JSON of the value>`; an entry that fails `MUTATION_FILTER` refuses with the existing message, naming that entry. A non-array keeps today's check and message. The `{filter}` slot receives `'a' 'b'` in the order given.
- The `filter` schema property becomes `{ type: ["string", "array"], items: { type: "string" }, description: … }`, and the description says it takes one test name or path, or a list of up to 10.
- `CONTRIBUTING.md`: the `review` suite row names `kukulu_mutate` (no row names it today).
- `docs/mcp-tools.md` `kukulu_mutate`: the list form.
- `CHANGELOG.md` `### Changed`: `kukulu_mutate`'s `filter` also accepts a list of up to 10 test paths (project-e F-01).

**Acceptance tests:**

- `test/review.mjs`: "a two-entry filter reaches the command as two quoted words" (a `mutation.targeted` command that writes its arguments one per line to a file in a temp directory outside the repo; the file holds exactly the two entries in order); "an empty filter list refuses", "an 11-entry filter list refuses", "a non-string filter entry refuses" (each asserting the new message); "an invalid filter entry refuses naming it".
- `test/protocol.mjs`: "kukulu_mutate's filter takes a string or a list" (the schema's `type` includes both).

**Out of scope:** changing `MUTATION_FILTER`; the untargeted `commands` path.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-03: kukulu_mutate says what kind of change it restored

**Goal:** `undoMutationResidue` classifies each path it restores as `mode`, `deleted` or `content`, and the result gains `restoredChanges` in the same order as `restored`.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-03, Appendix B item 6; `server-synchronous`.
- Before the checkout, `git diff --raw --abbrev=40 HEAD -- <restored paths>`; per line: type `D` is `deleted`; type `M` with different modes and equal blob ids is `mode`; everything else (`M` with different ids, `T`) is `content`. The working-tree side's id is all zeros, so for such a line hash the file with `git hash-object -- <path>` (no `-w`) and compare that with the old id.
- Return `{ restored, removed, restoredChanges: [{ path, change }] }`; `kukulu_mutate`'s result carries `restoredChanges` wherever it carries `restored`. Restoring itself does not change.
- If the classification reproduces project-f F-02's cause, record it in the commit's `Interpretation:` line.
- `docs/mcp-tools.md` `kukulu_mutate`: `restoredChanges`.
- `CHANGELOG.md` `### Fixed`: `kukulu_mutate` says whether each restored file differed in mode, content or by deletion (project-f F-02).

**Acceptance tests:** `test/review.mjs`, each with a command that touches a tracked file other than the mutated one: "a chmod residue is classified as mode", "an edit residue is classified as content", "a deletion residue is classified as deleted", and in each the file is restored (content and mode equal HEAD's).

**Out of scope:** preventing the restore; untracked residue (`removed`).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-04: CHANGELOG 0.7.2, the version and the feedback headers

**Goal:** The release reads 0.7.2 everywhere and the changelog entry is complete.

**Files touched:** `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `mcp/server.mjs`, `README.md`

**Design constraints:**

- SPEC §1 ("the version reads 0.7.2 everywhere"), §6 E.
- Rename `## [Unreleased]` to `## [0.7.2] — <today>`, with only `### Changed` and `### Fixed` (no Added, no Breaking changes, so under C-03 this flight is not breaking). Read the lines earlier tasks added: each item cites its feedback item (`project-e F-03`, `kukulu F-01`), "a beta user's request" (C-01) or the 0.7.1 SUMMARY/REVIEW item. Fill any gap, so every §6 requirement has a line.
- `0.7.2` in `package.json`, `.claude-plugin/plugin.json`, `VERSION` in `mcp/server.mjs`, and README's version badge (`version-0.7.2`, alt `Version 0.7.2`). The tool count stays twenty-five.
- README: change a sentence only if it states the archive default or the PR title (none did at plan time; confirm with a search).
- For each of `docs/feedback/2026-10-25-project-e.md`, `docs/feedback/2026-10-25-project-f.md` and `docs/feedback/2026-10-26-kukulu.md` that exists on this machine (they are gitignored), add one header line `Addressed in: docs/SPEC.md v0.7.2 (flight v0-7-2)` after its title, followed by a blank line, and change nothing else; never stage them.

**Acceptance tests:** `test/plugin.mjs`'s existing "package.json and plugin.json agree on the version", "the MCP server reports the plugin's version" and "CHANGELOG.md's newest entry is the package version".

**Out of scope:** tagging, publishing or merging.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-05: Phase 3 end: push and record the manual check

**Goal:** Push the release branch and record Phase 3's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 3. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P3-05: Phase 3 end: push and record the manual check`. The handoff written for `kukulu_run_finish` has no "do not merge" line (SPEC §6 E).

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs; merging.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): on a machine with gh 2.45.0, kukulu_status reports the PR's checks with via: "gh api"`.

**Depends on:** none

## Spec issues

- §7 says every command "runs today on a clean checkout of `main`", but at `418b291` `npm test` fails 44 assertions in the `plugin`, `state`, `routing` and `drive` suites, all from the agent defaults, and `kukulu_verify` fails `no-fable-default` (`agents/planner.md` reads `model: fable-5-1`). Resolution: P0-01 restores the agent defaults 0.7.1 shipped; if the owner meant to change the shipped defaults, that is a SPEC change (the `MODELS` list, README, `no-fable-default` and `isAnthropicModel` would all move with it), and P0-01's commit is dropped.
- Principle 5 says `prTitle` is validated "with the existing unknown-key refusal", but `cfgFrom` has no unknown-key refusal for top-level keys (only for `policies`, `parallel`, `mutation`, `review`, `cleanroom` and constraints). Resolution: `prTitle` gets its own validation beside `flight`; adding a top-level unknown-key refusal would refuse configs that work today, which a patch release should not do.
- §4 does not list `skills/go-flight/SKILL.md`, but B-04 requires its one sentence because step 2 stops only on `done` and `halt`. Resolution: P1-04 adds it.
- B-02 says the already-started result "gains `signing`, as the fresh path's already has", but it already returns `signing`. Resolution: it keeps it.
- B-02 unsets the local `commit.gpgsign` to reach "the operator's own setting". When that setting was itself repo-local, the fallback's `false` overwrote it and nothing can recover it; the re-probe then reads "not configured", and under B-03 finalize stops waiting. Resolution: built as SPEC says, and the tests keep the operator's setting in global config; a later release could store the previous local value with the override.
- B-03 reads `state.signing`, but with C-02 the archive runs before finalize and resets state. Resolution: finalize reads the archived `state.json`'s `signing`, as it already does for `summarized`.
- §6 E says README changes only for the archive default or the PR title, but README's step 4 sentence and its `kukulu_pr_finalize` row say finalize waits for any unsigned commit, which B-03 makes false (as does `docs/architecture.md`, which §4 does not list). Resolution: P1-03 corrects those sentences only (principle 8).
- B-01 names the empty tree by its SHA-1 id, which is wrong in a SHA-256 repository. Resolution: the probe asks git for the empty tree's id.
- B-04 does not say what happens under `required` when `commit.gpgsign` is not set. Resolution: no probe and today's plan reason, because B-01's probe runs only when signing is in effect; `kukulu_run_start` still refuses.
- D-03 describes "differing blob ids" from `git diff --raw HEAD`, whose working-tree id is always zeros. Resolution: the working-tree blob is hashed for the comparison.
- §5.1 calls `policies.archive`'s `true` an owner decision and asks CLAUDE.md to drop it from the ASSUMPTION list. The 0.7.1 SUMMARY's "Assumptions still in play" listed it too; it is history and stays.
