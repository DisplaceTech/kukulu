# Kūkulu 0.8.1 build plan

Derived from docs/SPEC.md v0.8.1 on 2026-11-11. SPEC.md wins over this file.

## Decisions

- Phases → SPEC §8's four phases, in order, none merged: the guard (A), long tool calls and after the flight (B, C), policies and evidence (D, E), stage handoffs, documentation and release (F, G). Inside a phase the order is SPEC §6's.
- The base is green → `main` at `5b08f0f` passes `npm run lint`, both guard self-tests (554 and 550 cases) and `npm test` (4,588 assertions in fifteen suites), measured while planning. No base-fix task is needed.
- Parallel streams → none; the plan is fully serial, as SPEC's size recommendation says. Nearly every task edits `mcp/server.mjs`, `mcp/cleanroom.mjs`, `CHANGELOG.md` or `docs/operations.md`.
- Flight slug → `v0-8-1`, the operator's slug (`flight=v0-8-1`), which SPEC's size recommendation also names. `docs/flights/v0-8-1/` does not exist.
- `baseBranch` → `main`, the branch the plan is committed on and the one SPEC §5.1 names; build branches are `build/<date>`.
- `policies` → `{ "archive": true, "finalize": "ready" }` exactly as SPEC §5.1 says, because the running 0.8.0 server still defaults `finalize` to `"auto"`. `maxRounds` and `maxRoundsHard` stay 3 and 6.
- Constraints → the 32 rules of `docs/flights/v0-8-0/kukulu.json` with identical ids, descriptions, patterns, flags, paths, excludes and fixtures (principle 7), plus `no-hardcoded-mcp-timeout` (§5.4). The only edit to a carried rule is that `sandbox-network-none`, `sandbox-no-escape-flags` and `relay-not-in-server` lose their `from: "P2-02"`: that task landed in 0.8.0, so the rules are active from the start, and keeping the gate would have tied them to this flight's own P2-02 (see Spec issues). The `extraVerify` entries lose their `from: "P2-01"` for the same reason. The file is ASCII-only, with JSON escapes for non-ASCII characters.
- `extraVerify` and `mutation.targeted` → SPEC §7: the two guard self-tests as one `&&` command on the five clean-room paths; `npm run check:site` on `site/`, `docs/site/` and the three site scripts; `suite` = `node test/{filter}.mjs`.
- §9 Q1 (two flights) → this flight has the fixes; OpenCode and OpenRouter are 0.9.0's. Owner decision of 2026-11-11.
- §9 Q2 (`finalize`'s default) → `"ready"`, with global and profile overrides (P2-01, P2-02). Owner decision of 2026-11-11.
- §9 Q3 (similarity groups) → supported (P2-03, P2-04). Owner decision of 2026-11-11.
- §9 Q4 (the MCP timeout value) → 24 h, an ⚠️ ASSUMPTION written in `.mcp.json` only (P1-01); the constraint `no-hardcoded-mcp-timeout` keeps the number out of every other file, so docs and tests describe it as "24 hours" and read it from the file.
- §9 Q5 (no progress heartbeat) → deferred to 0.9.0; nothing in this plan touches the transport.
- §9 Q6 (the reviewer's halt) → a tool grant and a skill rule (P3-03); `kukulu_review_submit` does not change.
- A-01's mechanism → `sed` stays in both family lists; a new exported `sedInPlace(args)` in `mcp/cleanroom.mjs` decides whether a `sed` segment is a write, and rule 6d runs for `sed` only when it says so (P0-01). A `--` token ends the option scan (anything after it is an operand). The `w` command is a known gap.
- A-02's mechanism → a new exported `stripHeredocs(command)` in `mcp/cleanroom.mjs` returns the command text with every heredoc body and delimiter line removed, plus the bodies with what owns them; `splitSegments` strips heredocs before it cuts, and `bashVerdict` judges a shell-read body as a further command line and an unquoted-delimiter body's substitutions as today (P0-02).
- B-02's `commandTimeoutMs` → checked directly, before the commands, with `docs/kukulu.json commandTimeoutMs <n> is not below …` (the SPEC sentence without `.timeoutMs`); every command entry is then checked with the SPEC's `<where>.timeoutMs <n>` form. `mcpTimeoutMs()` reads `<plugin root>/.mcp.json` once per process (the file does not change while the server runs) and `cfgFrom` takes the limit as a third parameter, defaulting to `mcpTimeoutMs()`, so the archived-config path gets the same check (P1-02).
- C-01's order → `kukulu_next`'s mode-break halt stays where it is (it writes nothing); the genesis write and the gate move below the `halted`, `awaitingSigning` and archived-done returns (P1-03).
- C-02's result → `localState` is `"current"` when the local state's `archived.slug` equals origin's, else `stale: local <base> names <old slug>; origin/<base> names <slug>` (with `no archived flight` for a local state that has none); `fastForward` takes the five SPEC values verbatim; `finalizeConfig` reads `docs/kukulu.json`, else the archived `kukulu.json` under the local state's `archived.dir`, else the defaults (P1-04).
- C-03's refusal → one more entry in `kukulu_plan_commit`'s problem list, with `check: "flight"` and the SPEC's text as its message, so it is listed with every other problem and nothing is written (P1-05).
- D-01's second copy → `DEFAULT_STATE.policies` becomes `cfgFrom({}, null).policies`, so `kukulu_status.policies` before the first run lists every policy key with its default and no literal can disagree with `cfgFrom`. `kukulu_config_show` gains the resolved `policies` in P2-01, because D-01's test reads `finalize` from it; P2-02 adds `policySources` (P2-01, P2-02).
- D-02's messages → the project file's messages are unchanged; a global or profile message starts with the global file's absolute path (`<path> policies.<key>` or `<path> profiles.<name>.policies.<key>`) and, for an enum key, ends with `; got <JSON value>`, as SPEC's examples show (P2-02).
- D-02's sentence → `Run policies: signing=<s>, push=<on|off>, pr=<p>, finalize=<f> (<source>).` where `<source>` is `default`, `global`, `profile:<name>` or `project` (P2-02).
- E-01's config → a normalized pair carries `group` only when the policy gave one (`similarity.json`'s `config` stays "as given"); every row carries `group` (`"default"` when none). `SIMILARITY.md` gets one line per group after the statement, and a `group` column in the raw-scores table only when a pair named a group. `scripts/compare-bundles.mjs` reports `similarity.groups.<group>.{negative,positive}` and prints one line per group and metric; its cross-score section uses the `default` group's negative, else the first group's (P2-03, P2-04).
- F-01's absence → `description` is present on every `plan`, `implement`, `review` and `summarize` result and on every `streams[]` entry, and absent (not `null`) on `done` and `halt` (P3-01).
- F-04's detection → the command is split on whitespace; `cargo` followed, after any tokens starting with `-` or `+`, by `test` is a `cargo test`; the refusal fires when a token containing `{filter}` comes before the first token that is exactly `--`, or there is no such token (P3-04).
- B-01's Claude Code version → the implementer cannot browse, so `docs/operations.md` names the per-server `timeout` field and points at Claude Code's MCP documentation for the version that introduced it; the owner may fill the number in (see Spec issues).
- Changelog → P0-01 creates `## [Unreleased]` above `## [0.8.0] — 2026-10-27`; every task adds its lines under `### Added`, `### Changed` or `### Fixed`, each citing its feedback item (`project-g F-19`) or requirement; there is no Breaking changes heading. P3-05 renames the heading to `## [0.8.1] — <date>`.
- HANDOFF.md → no "do not merge" line (SPEC §6 G); the handoff lists the manual checks of all four phases.
- 2026-11-13: maxRounds set to 5 (was 3) by the operator through kukulu_flight_options.
- 2026-11-13: maxRoundsHard set to 8 (was 6) by the operator through kukulu_flight_options.

## Conventions

- Commit template: `CLAUDE.md` `## Commit template`, title `<ID>: <title>`, written to a file and committed with `git commit -F <file>`. `Measurement: n/a` on every task: nothing is tuned or measured in this flight.
- Every task's verification is `kukulu_verify` with its Files touched: `npm run lint`, `pre-commit run --all-files` and `npm test` (900 s) always; the guard self-tests for the clean-room paths; `npm run check:site` never fires because no task touches the site.
- Shared protocols are in `CLAUDE.md` `## Task protocols`: the guard-rule protocol (P0-01, P0-02), the clean-room tests protocol (P1-02, P1-03), the config-key protocol (P2-02, P2-03), the changelog protocol (every task), and the flight notes' plugin-copy and fake-origin notes (P1-02, P1-04).
- Tests are named by their assertion message; the names below are the messages to use. Write the macron letter in test and script source as a Unicode escape.
- "The running server" is the installed 0.8.0: none of this flight's behavior is active while it runs, so no task may rely on an earlier task's server change being live in the pipeline.

## Phase 0 — The guard

### P0-01: sed is a write only in place

**Goal:** A `sed` segment is judged by rule 6d only when it edits in place, so a read-only `sed -n` of a protected file is allowed and every in-place form stays denied.

**Files touched:** `mcp/cleanroom.mjs`, `scripts/verify-attestation.mjs`, `test/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-01, §3 principles 1, 3, 6, 8, 11, Appendix B.1; CLAUDE.md's guard-rule protocol (fixture names end `(P0-01)`); `cleanroom-module-pure`, `server-synchronous`, `verifier-node-only`, `no-gnu-sed-inplace` (the fixtures file is exempt; test source spells `-i` only inside a string handed to `evaluate`).
- `export function sedInPlace(args)` in `mcp/cleanroom.mjs`, `args` being the tokens after the word `sed`: true when an option token before the first operand or between operands is `-i`, `-i<suffix>`, `--in-place`, `--in-place=<suffix>`, or a short-option cluster (`^-[A-Za-z]+$`) containing `i`. The values of `-e`, `--expression`, `-f`, `--file`, `-l` and `--line-length` (the next token, or the rest of a `--expression=…` form) are not option tokens; after a bare `-i` an empty-string token is BSD sed's suffix, not an operand; a bare `--` ends the scan.
- Rule 6d in `evaluate`: the write-family branch runs for `sed` only when `sedInPlace(rest)` is true. Then the write targets are the file operands only: never the script token(s) `patternOperands("sed", rest)` already marks, never the values of the options above, never the empty token after a bare `-i`. The reason text stays `protected path: <abs path>`. A `sed` that is not in place is judged by the read rules (6b, 6c) exactly as `grep` is, which it already is.
- `READ_FAMILY` and `WRITE_FAMILY` do not change (`test/cleanroom.mjs`'s "WRITE_FAMILY is the fixed list" still holds).
- `KNOWN_LIMITS`' `indirect` entry text, in both `mcp/cleanroom.mjs` and `scripts/verify-attestation.mjs`, byte-identical: `Commands that run a command from their arguments (find -exec, watch, parallel, busybox) and programs outside the fixed network and write lists (unlink, shred, perl -i, sed's w command, cargo fetch) are not recognized.` The entry count stays twelve; `test/attest.mjs`'s "the two tables are identical" and `test/cleanroom.mjs`'s known-gaps table check keep passing because the `docs/cleanroom.md` row changes to match (`perl -i`, sed's `w` command, `cargo fetch`, with the backticks the row already uses).
- `docs/cleanroom.md` rule 6's write-family sentence says `sed` counts only in place: list the four in-place forms, that the script and the values of `-e`, `-f` and `-l` are never targets, and that any other `sed` is judged as a read like `grep`.
- Required fixtures, policy `template`, cwd `__ROOT__`, names ending ` (P0-01)`. Denied, reason `protected path`: `sed -i 1d .kukulu/cleanroom/log.jsonl`; `sed -ni 1p docs/cleanroom.json`; `sed --in-place=.bak s/a/b/ .mcp.json`; `sed -i.bak s/a/b/ .mcp.json`; `sed -Ei s/a/b/ .mcp.json`; `sed -e s/a/b/ -i .mcp.json`; `sed -i '' s/a/b/ .mcp.json`. Allowed: `sed -n 480p .kukulu/cleanroom/log.jsonl`; `sed -n 1p .mcp.json`; `cd __HOME__/plugin-root; sed -n 2910,2990p mcp/server.mjs` (the self-test's plugin root is `<home>/plugin-root`); `sed -n -e 1p -e 2p docs/cleanroom.json`; `sed -i s/a/b/ src/a.rs`.
- No existing fixture changes its decision or reason: `sed script over a deny.paths file is denied` stays denied by rule 6b, and the three existing `-i` fixtures stay denied. The commit body's `Interpretation:` line says "no existing fixture changed".
- `CHANGELOG.md`: create `## [Unreleased]` above `## [0.8.0] — 2026-10-27` with `### Fixed`: the guard judges `sed` as a write only in place, so a read-only `sed -n` of a protected file is allowed (project-g F-01, F-03, F-04, F-06, F-09, F-11, F-15); and `### Changed`: sed's `w` command is listed under the `indirect` known gap (A-01).

**Acceptance tests:** `test/cleanroom.mjs`: "sedInPlace reads -i, -i<suffix>, --in-place, --in-place=<suffix> and a cluster containing i" (a table over the seven denied forms plus `-ni`, `-Ei`, `-ie`, with `-n`, `-e s/a/b/`, `-n -e 1p -e 2p`, `-l 80 -n` and `-- -i` all false); "a read-only sed on the clean-room log is allowed" (direct `evaluate` of the first allowed fixture); "an in-place sed with -e before -i writes only the file operands" (the `-e s/a/b/ -i .mcp.json` form denied with `protected path: <root>/.mcp.json`, and `sed -e s/a/b/ -i src/a.rs` allowed); "sed -i '' keeps the BSD suffix out of the operands"; "KNOWN_LIMITS indirect names sed's w command" (the text contains `sed's w command` and the count is twelve). The existing "WRITE_FAMILY is the fixed list", the known-gaps table assertions, and `test/attest.mjs`'s "the two tables are identical" keep passing; every existing fixture keeps its decision and reason.

**Out of scope:** heredocs (P0-02); modelling sed's script language (`w`, `W`, `s///w` are a known gap by Appendix B.1); any other command word.

**Verification:** `kukulu_verify` (runs both guard self-tests); also `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` before committing.

**Depends on:** none

### P0-02: Heredoc bodies are data unless a shell reads them

**Goal:** `splitSegments` keeps a heredoc body out of the segment list, a body is judged as commands only when a shell reads it, and an apostrophe in a body no longer hides the commands after it.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-02, §3 principles 1, 3, 6, 8, Appendix B.2; CLAUDE.md's guard-rule protocol (fixture names end `(P0-02)`); `cleanroom-module-pure`, `server-synchronous`.
- `export function stripHeredocs(command)` → `{ text, bodies }`. The operator is an unquoted `<<` that is not `<<<`, then an optional `-`, optional blanks, and a delimiter word written bare, `'word'`, `"word"` or `\word` (the last three are quoted). The body starts on the line after the one holding the operator; two operators on one line read their bodies in order; a body ends at the first line equal to the word (after leading tabs are stripped for `<<-`); an unterminated body runs to the end of the command; quotes inside a body never affect splitting. `text` is the command with each body and its delimiter line removed (the operator and its word stay in the owning segment's text); each of `bodies` is `{ body, quoted, shell }`, where `shell` is true when the owning segment's command word (`commandWord(shellWords(<the segment text up to the operator>))`) is `sh`, `bash`, `zsh`, `dash` or `ksh` and none of that segment's tokens matches `/^-[A-Za-z]*c[A-Za-z]*$/` (the same test `bashVerdict` uses for `sh -c`).
- `splitSegments(command)` keeps its signature and return type: it splits `stripHeredocs(command).text`, so a direct caller gets segments without body lines.
- `bashVerdict(command, depth)`: first `stripHeredocs(command)`; judge `text` as today (`extractSubstitutions`, then `splitSegments`); then for each body: when `shell`, `bashVerdict(body, depth + 1)` (every line becomes a segment, judged as if written after the segment); else when not `quoted`, judge each `extractSubstitutions(body).inner` body with `bashVerdict(sub, depth + 1)`; a quoted non-shell body is not scanned. The owning segment's own words and redirections are judged as today, so `cat <<EOF > docs/cleanroom.json` is still denied by its redirection. A body handed to another interpreter (`python3 - <<'EOF'`) is data, under the existing `interpreter` known limit.
- `docs/cleanroom.md`: a heredoc paragraph under the Bash rules (after rule 6's list item, before "What is always protected") with the operator, body, unterminated, shell-read, substitution and other-interpreter rules above.
- Required fixtures, policy `template`, cwd `__ROOT__`, names ending ` (P0-02)`, each command written with real newlines in the JSON string. Denied: `cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom` (reason `protected path: .*\.kukulu/cleanroom`); `bash <<'EOF'` / `rm -rf .kukulu/cleanroom` / `EOF` (same reason); `cat <<EOF > docs/cleanroom.json` / `{}` / `EOF` (reason `protected path: .*docs/cleanroom\.json`); `cat <<EOF > out.txt` / `$(cat ~/.cargo/registry/a.rs)` / `EOF` (reason `denied path`). Allowed: `cat > build/k.json <<'EOF'` / `{"priorArt": ["~/.cargo/registry/", "~/.cargo/git/"]}` / `EOF`; `cat <<'EOF' > notes.txt` / `$(rm -rf .kukulu)` / `EOF`; `python3 - <<'EOF'` / `print("~/.cargo/git/x")` / `EOF`; `cat <<-EOF > build/a.txt` / a tab-indented body line / tab-indented `EOF` / `echo done`.
- The existing cleanflate false-positive fixtures with Python heredocs stay allowed. Any existing fixture whose decision changes is listed in the commit body with its reason; a denial may become an allow only when its body is data handed to a non-shell command. Expect none.
- `CHANGELOG.md` `### Fixed`: a heredoc body is data unless a shell reads it, so prior-art paths in a heredoc no longer refuse the call, and an apostrophe in a body no longer hides the commands after it (project-g F-11, A-02).

**Acceptance tests:** `test/cleanroom.mjs`: "stripHeredocs removes a body and keeps the operator" (bare, `'EOF'`, `"EOF"`, `\EOF`, `<<-` with tabs, two heredocs on one line, an unterminated body, and `<<<` left alone); "splitSegments does not cut inside a heredoc body" (the apostrophe command gives the segments `cat <<EOF > x.txt` and `rm -rf .kukulu/cleanroom`); "a shell-read heredoc body is judged as commands"; "a quoted-delimiter body is never scanned" (the `$(rm -rf .kukulu)` fixture allowed); "an unquoted-delimiter body's substitutions are judged" (the `~/.cargo/registry/a.rs` fixture denied); "the cleanflate Python heredoc fixtures stay allowed"; every existing fixture keeps its decision and reason.

**Out of scope:** `sed` (P0-01); here-strings (`<<<` is unchanged); modelling interpreters other than the five shells.

**Verification:** `kukulu_verify` (runs both guard self-tests); also `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` before committing.

**Depends on:** none

### P0-03: Phase 0 end: push and record the manual check

**Goal:** Push the branch and record Phase 0's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 0. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P0-03: Phase 0 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): in a live clean-room session with claude --plugin-dir ., sed -n 1p .kukulu/cleanroom/log.jsonl and a heredoc that writes prior-art paths into a scratch file are allowed, and the apostrophe case (cat <<EOF > x.txt / it's fine / EOF / rm -rf .kukulu/cleanroom) is denied`.

**Depends on:** none

## Phase 1 — Long tool calls and after the flight

### P1-01: The plugin sets its own MCP timeout

**Goal:** `.mcp.json`'s `kukulu` entry carries a per-server `timeout` of 24 hours, the docs describe long tool calls, and nothing else spells the number.

**Files touched:** `.mcp.json`, `test/plugin.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.3, §5.5, §6 B-01, §3 principle 8, §9 question 4; constraint `no-hardcoded-mcp-timeout` (the number appears in `.mcp.json` only: the test, the docs and the changelog say "24 hours" or read the file).
- `.mcp.json`: `"timeout": 86400000` in the `kukulu` entry, after `"args"` and before `"env"`.
- `test/plugin.mjs`: read `.mcp.json`, assert `Number.isInteger(timeout) && timeout >= 3600000` on `mcpServers.kukulu.timeout`.
- `docs/operations.md`: a new `## Long tool calls` section right after the `## When something goes wrong` table, covering: Claude Code's idle timeout (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, default 1800000 ms, 30 minutes, aborting a stdio tool call that sends no response and no progress); the per-server `timeout` of a `.mcp.json` entry as that server's wall clock and a floor under the idle timeout, which the plugin sets to 24 hours, naming the field and pointing at Claude Code's MCP documentation for the version that introduced it (and that the value must stay below Claude Code's default wall clock of about 28 hours); for an older Claude Code, setting `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` in the operator's `settings.json` `env`; and that a queued parallel-stream call still waits behind the running one. The two troubleshooting rows that name `MCP_TOOL_TIMEOUT` and the `## Parallel streams` "tool-call timeout" paragraph change to point at the section; `MCP_TOOL_TIMEOUT` no longer appears in `docs/operations.md` or `docs/mcp-tools.md`.
- `docs/mcp-tools.md`'s `longestCommandTimeoutMs` row names the plugin's limit (`.mcp.json`'s `timeout`, 24 hours) instead of `MCP_TOOL_TIMEOUT`, and links `operations.md#long-tool-calls`.
- `CHANGELOG.md` `### Added`: the plugin sets its own MCP tool-call timeout of 24 hours in `.mcp.json`, so a long verify or mutate call is no longer cut off at Claude Code's 30-minute idle limit (project-g F-08, F-12, F-14, B-01).

**Acceptance tests:** `test/plugin.mjs`: "the kukulu server entry sets a timeout of at least an hour"; "operations.md has a Long tool calls section and no longer names MCP_TOOL_TIMEOUT" (`## Long tool calls` present; `MCP_TOOL_TIMEOUT` absent from `docs/operations.md` and `docs/mcp-tools.md`).

**Out of scope:** reading the value in the server and refusing a command timeout (P1-02); progress notifications (§9 question 5).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-02: A command timeout the client would cut short is refused

**Goal:** The config loader refuses any command whose effective timeout is at or above the plugin's MCP limit, `longestCommandTimeoutMs` counts `mutation.targeted`, and `kukulu_status` reports `mcpTimeoutMs`.

**Files touched:** `mcp/server.mjs`, `test/routing.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-02, §3 principles 2, 3, 4, 5, 8, 9; `server-synchronous`, `no-hardcoded-mcp-timeout`, `no-hardcoded-mutation-fix-rounds` (cfgFrom's `review:` line is untouched); CLAUDE.md's clean-room tests protocol for the plugin copy.
- `mcpTimeoutMs()`: reads `timeout` from `mcpServers.kukulu` of `<PLUGIN_ROOT>/.mcp.json` (`PLUGIN_ROOT` is the server's own directory's parent, already defined). Returns `null` when the file, the `kukulu` entry or the field is missing, the file is not valid JSON, or the value is not a positive integer. Read once per process and cached.
- `cfgFrom(c, planIds, limit = mcpTimeoutMs())`: when `limit` is not null, after the existing validation: refuse `docs/kukulu.json commandTimeoutMs <n> is not below the plugin's MCP tool-call limit of <m> ms (.mcp.json "timeout"); Claude Code would abort the call before the command ends. Lower it, or split the command.` when `commandTimeoutMs >= limit`; then, for each normalized `verify`, `extraVerify`, `parallel.setup` and `mutation.targeted` entry whose `timeoutMs >= limit`, refuse with `<where>.timeoutMs <n> is not below the plugin's MCP tool-call limit of <m> ms (.mcp.json "timeout"); Claude Code would abort the call before the command ends. Lower it, or split the command.`, where `<where>` is the key the existing command refusals use (`docs/kukulu.json verify[0]`, `docs/kukulu.json extraVerify['site/'][1]`, `docs/kukulu.json parallel.setup[0]`, `docs/kukulu.json mutation.targeted.suite`). The check comes before any file is written, as the rest of `cfgFrom` does.
- `longestCommandTimeoutMs()` includes every `mutation.targeted` entry's `timeoutMs`. `status()` gains `mcpTimeoutMs: mcpTimeoutMs()` right after `longestCommandTimeoutMs`.
- `docs/mcp-tools.md`: a `mcpTimeoutMs` row in `kukulu_status`'s table (the plugin's MCP tool-call limit from `.mcp.json`, `null` when it sets none), and `longestCommandTimeoutMs`'s row says it now counts `mutation.targeted`. `docs/operations.md`: the `commandTimeoutMs`, `verify` and `mutation.targeted` rows and the `## Long tool calls` section name the refusal.
- `CHANGELOG.md` `### Added`: a `verify`, `extraVerify`, `parallel.setup` or `mutation.targeted` timeout at or above the plugin's MCP limit is refused when the config loads, and `kukulu_status` reports `mcpTimeoutMs` (B-02).
- Tests start a temp copy of the plugin: `test/harness.mjs`'s `tempPlugin()` (which copies `mcp/`, `scripts/`, `hooks/`, `templates/`, `agents/`, `skills/`, `test/fixtures/` and `package.json`) plus an `.mcp.json` the test writes into the copy with a small `timeout`, and `startServer(repo, { server: <copy>/mcp/server.mjs })`. A second copy without `timeout` (or without `.mcp.json`) gives no refusal and `mcpTimeoutMs: null`. The real `.mcp.json`'s number is never written in a test.

**Acceptance tests:** `test/routing.mjs`: "commandTimeoutMs at the MCP limit is refused"; "a verify entry at the MCP limit is refused" and the same for `extraVerify`, `parallel.setup` and `mutation.targeted` (each asserting the full message, with its `<where>`); "a command one millisecond below the limit loads"; "a plugin without a timeout refuses nothing and reports mcpTimeoutMs null". `test/state.mjs`: "kukulu_status reports mcpTimeoutMs from the plugin's .mcp.json" (an integer of at least 3600000 against the real plugin) and "longestCommandTimeoutMs counts mutation.targeted".

**Out of scope:** changing `.mcp.json` or its documentation beyond the rows named (P1-01); capping `kukulu_mutate`'s own `timeoutMs` argument.

**Verification:** `kukulu_verify`.

**Depends on:** P1-01

### P1-03: No clean-room genesis after the archive

**Goal:** `kukulu_next` writes a genesis only when the call gets past the halted, awaiting-signing and archived-done returns, so a finished flight never re-arms its clean-room log.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `docs/mcp-tools.md`, `docs/architecture.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-01, §3 principles 2, 3, 4, 8, Appendix B.4; `server-synchronous`; CLAUDE.md's clean-room tests protocol (per-repo temp key, `HOME` and `CLAUDE_PROJECT_DIR` set for a hook run).
- In `nextDecision`: the lines `if (policyPresent && !st.cleanroom) cleanroomGenesis(c, st);` and `gateResult = runGate("controller", st);` with its halt move below the `st.halted`, `st.awaitingSigning` and archived-done (`flight <slug> is archived in <dir>; …`) returns. The `cleanroomModeBreak` halt stays where it is. A call that ends in one of those three returns writes nothing and commits nothing (`gate` is `null` on its result). A new flight, with its edited `docs/SPEC.md`, gets past the archived-done return and its genesis is written as today.
- `docs/mcp-tools.md` `kukulu_next`: the genesis bullet says the genesis is written only once the call has passed the halted, awaiting-signing and archived-done returns, and that after `kukulu_flight_archive` no genesis is written until `docs/SPEC.md` changes. `docs/architecture.md`'s stage-machine text, where it places the genesis or the gate, says the same.
- `CHANGELOG.md` `### Fixed`: after a flight is archived, `kukulu_next` no longer writes a new clean-room genesis on the finished branch, so `git checkout <base>` needs no stash (project-g F-16, F-17, C-01).

**Acceptance tests:** `test/cleanroom.mjs`, in the genesis section: "kukulu_next after the archive returns done and writes no genesis" (a clean-room flight taken through `kukulu_summary_commit` and `kukulu_flight_archive` with the policy still present: `stage` is `done`, HEAD does not move, `.kukulu/cleanroom/log.jsonl` does not exist, `.kukulu/state.json` is byte-identical); "the hooks append nothing after the archive" (`runHook` of `scripts/cleanroom-log.mjs` with a PostToolUse payload, then no log file); "an edited SPEC after the archive writes the genesis and returns plan"; "a halted clean-room run with no genesis writes none" (state `{ halted: "stopped by hand" }` with a policy and no `cleanroom` record: `halt`, no log file, HEAD unchanged).

**Out of scope:** `kukulu_release` (P1-04); deleting the policy or switching the hooks off at archive time (Appendix B.4).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-04: kukulu_release reads the merged flight from origin

**Goal:** `kukulu_release` releases the flight that `origin/<base>` says was archived last, from any branch, with every refusal before the tag, and reports what it did to the local base.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/harness.mjs`, `docs/mcp-tools.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-02, §3 principles 2, 3, 4, 8, 9, 10, Appendix B.5; `server-synchronous`, `one-hash-one-signature`; every git call goes through `gitArgv` as the rest of the server's do.
- The new order of `release({ publish })`, every refusal before the tag: (1) validate `publish` as today; (2) `baseBranch` from `finalizeConfig(loadState())`; (3) `git fetch origin`; a failure refuses `git fetch origin failed: <first line>; kukulu_release reads the merged flight from origin/<base>, so it needs the remote`; (4) read `origin/<base>:.kukulu/state.json` and its `archived`; with none, `origin/<base> has no archived flight; merge the flight's pull request (it carries the archive) and call kukulu_release again`; (5) read `Branch:` from `origin/<base>:<archived.dir>/PROGRESS.md` (a missing or placeholder line refuses as today, naming `origin/<base>`) and the signing outcome from `origin/<base>:<archived.dir>/state.json`; (6) `gh pr view <branch>` and the merge commit as today; (7) a CHANGELOG at the merge with no numbered entry refuses `CHANGELOG.md at <sha7> (the merge of flight <slug>'s PR #<n>) has no numbered entry; add ## [x.y.z] before releasing`; (8) the tag check, create (`-s` or `-a` as today, from the archived `state.json` read in step 5), push and release as today, the tag made on the merge sha; the "is not checked out" refusal, the dirty-tree refusal and the `merge-base --is-ancestor` check are removed; (9) the local base is fast-forwarded only when the checked-out branch is the base and `trackedDirtyLines()` is empty (`git merge --ff-only origin/<base>`), else skipped.
- The result gains `flight: { slug, dir, from: "origin/<base>" }`, `localState` (`"current"`, or `stale: local <base> names <old slug>; origin/<base> names <slug>`, with `no archived flight` as `<old slug>` when the local state has none) and `fastForward` (`"done"`, `"up to date"`, `"skipped: <base> is not checked out"`, `"skipped: the tree has tracked changes"` or `"failed: <first line>"`). A repeated call still creates only what is missing. The tool's `TOOLS` description says it reads the merged flight from `origin/<base>` and needs no checkout.
- `test/review.mjs`'s `releaseRepo` helper (and `test/harness.mjs` only if the fake `gh` needs a new recorded file under `test/fixtures/gh/`) is extended so the archive commit lives on the merged build branch on origin while local `main` stays behind; existing release tests that pinned the removed refusals ("a base branch that is not checked out refuses", "a dirty tracked tree refuses", "no archived flight refuses") change to the new behavior.
- `docs/mcp-tools.md` `kukulu_release`: the new order, refusals, `flight`, `localState` and `fastForward`. `CONTRIBUTING.md`'s `review` suite row names `kukulu_release`.
- `CHANGELOG.md` `### Changed`: `kukulu_release` reads the merged flight from `origin/<base>`, needs no checkout and reports `fastForward` and `localState`; a stale local base no longer hides behind "no numbered entry" (project-g F-16, F-17, F-18, C-02).

**Acceptance tests:** `test/review.mjs`: "a local base behind origin releases the flight origin archived last, and localState is stale"; "kukulu_release from the build branch releases with fastForward skipped"; "a fetch failure refuses and nothing is tagged" (origin's URL pointed at a missing directory; no local or remote tag afterwards); "no numbered CHANGELOG entry names the merge, the flight and its PR"; "a fast-forward that fails is reported, not ignored" (local `main` with a commit origin lacks: `fastForward` starts `failed:`, and the release was still made); "origin with no archived flight refuses"; "a repeated kukulu_release creates only what is missing" (the existing test, kept green).

**Out of scope:** D-02's policy layers inside `finalizeConfig` (P2-02); merging anything; the controller skill text.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-05: A flight slug that collides with an archive is refused at plan time

**Goal:** `kukulu_plan_commit` refuses, before any write, a `flight` slug whose `docs/flights/<slug>/` already exists, and the plan-build skill says how to pick another.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `test/review.mjs`, `skills/plan-build/SKILL.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-03, §3 principles 2, 3, 4, 9; `server-synchronous`.
- In `validatePlanTexts` (so the problem is listed with every other one): when `configRaw.flight` is a non-empty string and `docs/flights/<flight>/` exists, add `{ check: "flight", message }` with the message `docs/flights/<slug>/ already holds an archived flight; set docs/kukulu.json's flight to an unused slug (for example <slug>-<version digits> or <slug>-2) and call kukulu_plan_commit again`, where `<version digits>` is the digits of the `Version:` line of `docs/SPEC.md` joined by `-` (`0.8.1` gives `0-8-1`), or `2` when there is none. Nothing is committed while any problem remains, as today.
- `skills/plan-build/SKILL.md`'s slug rule gains one sentence: when the derived slug is taken under `docs/flights/`, append the spec's version digits (`-0-8-1`), or failing that `-2`.
- `docs/mcp-tools.md` `kukulu_plan_commit`'s checks table gains the `flight` row.
- `test/review.mjs`: the existing "...and when the destination exists" assertion pins the full archive-time text `docs/flights/w1-share already exists; choose another slug, or remove the old archive` (see Spec issues).
- `CHANGELOG.md` `### Added`: `kukulu_plan_commit` refuses a flight slug an archive already uses (project-g F-10, C-03).

**Acceptance tests:** `test/state.mjs`, in the plan_commit section: "a flight slug that an archive already uses is refused with nothing written" (a committed `docs/flights/w1/` plus `flight: "w1"`: the error names `docs/flights/w1/`, suggests `w1-<digits>` and `w1-2`, HEAD does not move, no file changes); "a free slug passes". `test/review.mjs`: "the archive-time refusal names the taken directory and says to choose another slug".

**Out of scope:** renaming an archive; `kukulu_flight_archive`'s own refusal (text unchanged; only its test is pinned).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-06: Phase 1 end: push and record the manual checks

**Goal:** Push the branch and record Phase 1's manual checks for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P1-06: Phase 1 end: push and record the manual checks`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): with the working tree as the plugin, a kukulu_verify whose extraVerify sleeps 40 minutes returns its result instead of an idle-timeout error; after a clean-room flight's archive, git checkout main succeeds from the build branch with no stash`.

**Depends on:** none

## Phase 2 — Policies and evidence

### P2-01: finalize defaults to ready

**Goal:** `policies.finalize` defaults to `"ready"`, written only in `cfgFrom`, and no second copy of the policy defaults can disagree.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/routing.mjs`, `test/state.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.1, §6 D-01, §3 principles 3, 5, 8, §9 question 2; `no-sync-merge` (the `gh pr merge` array is untouched), `no-hardcoded-mutation-fix-rounds`.
- `cfgFrom`: `finalize: c.policies?.finalize ?? "ready"`, the only place the default is written (an owner decision, not an ⚠️ ASSUMPTION: say so in the comment). `DEFAULT_STATE.policies` becomes `cfgFrom({}, null).policies`, so `kukulu_status.policies` before the first run lists every policy key with its default; a test that pinned the old four-key shape changes to the eight keys. `"auto"` still works when set.
- `configShow()` gains `policies: cfg().policies` beside `archive` (which stays). `docs/mcp-tools.md` `kukulu_config_show` lists it.
- Every existing test that relied on the old default sets `finalize: "auto"` explicitly (`test/review.mjs`'s "merge unavailable" case and any other that expects a `pr merge --auto` call), and a new case covers the default.
- `docs/operations.md`: the configuration example and the `policies.finalize` row say `"ready"` is the default; the `## Signing` "All signed" bullet and the `## What the flight leaves behind` paragraph say `"ready"` (the default) only marks the PR ready and `"auto"` also enables auto-merge unless the flight is breaking. `docs/mcp-tools.md` `kukulu_pr_finalize`: the same. `README.md` step 4: with the default `policies.finalize: "ready"` a fully signed flight's pull request is marked ready for you to merge; `"auto"` also enables auto-merge unless the flight is breaking.
- `CHANGELOG.md` `### Changed`: `policies.finalize` defaults to `"ready"`: finalize marks the PR ready and enables auto-merge only when `"auto"` is set (project-g F-19, D-01).

**Acceptance tests:** `test/routing.mjs`: "kukulu_config_show reports finalize ready with no policies block". `test/review.mjs`: "kukulu_pr_finalize with no policies block marks the PR ready and runs no gh pr merge" (calls `["pr ready"]`, `merge` `skipped: policy`, `ready` true); the existing "merge unavailable" case passes with `finalize: "auto"`. `test/state.mjs`: "kukulu_status.policies before a run lists every policy default" (eight keys, `finalize` `"ready"`).

**Out of scope:** global and profile policies, `policySources` and the `Run policies:` sentence (P2-02).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-02: Policies in the global file and in profiles

**Goal:** Every policy key can be set in the global file or a profile, layered default < global < profile < project, validated with its source named, and reported with `policySources`.

**Files touched:** `mcp/server.mjs`, `test/routing.mjs`, `test/plugin.mjs`, `docs/operations.md`, `docs/routing.md`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.2, §6 D-02, §3 principles 2, 3, 5, 8, 9, Appendix B.6; CLAUDE.md's config-key protocol; `server-synchronous`, `no-hardcoded-mutation-fix-rounds`.
- `validatePolicies(policies, where = "docs/kukulu.json")`: the project file's messages are unchanged; with another `where`, every message starts with it (`<where> policies has an unknown key 'x'`, `<where> policies.push must be a boolean`) and the enum keys (`signing`, `pr`, `finalize`, `mergeMethod`) end with `; got <JSON value>` (`<global path> policies.finalize must be one of auto, ready, draft; got "x"`). `GLOBAL_KEYS` gains `policies`; `loadGlobalConfig` (or `resolveRouting`) validates `global.data.policies` with `where` = the global file's absolute path, and each `profiles.<name>.policies` with `where` = `<global path> profiles.<name>` (so the message reads `… profiles.fast.policies.push must be a boolean`); `validateRolesBlock` for a profile skips the `policies` key, and a profile may hold only `policies`.
- `resolvePolicies()` → `{ policies, sources }`: per key, default (`cfgFrom`'s defaults) < global `policies` < the active profile's `policies` (the profile `resolveRouting` selects: `KUKULU_PROFILE`, else the global `profile`) < project `policies`; `sources[key]` is `"default"`, `"global"`, `"profile:<name>"` or `"project"`. `cfg()` returns the layered `policies`; `cfgFrom` stays the project-only resolver; `finalizeConfig(st)` applies the same layers over the archived file's `policies`; `kukulu_run_start`'s `state.policies` is the layered result (it already reads `cfg().policies`).
- `configShow()` gains `policySources`; `policies` (added by P2-01) is now the layered result; `archive` stays.
- `kukulu_next`'s sentence: `Run policies: signing=<s>, push=<on|off>, pr=<p>, finalize=<f> (<source>).` with `<source>` from `resolvePolicies().sources.finalize`, followed by the clean-room and signing sentences as today.
- `docs/operations.md`'s configuration section: a "Policy layers" paragraph (default, global file `policies`, `profiles.<name>.policies`, project), naming the per-key precedence and the sources `kukulu_config_show` reports, with an example global file that sets `finalize` globally; the Environment table is unchanged. `docs/routing.md`'s global-file shape gains `policies` and a profile with only `policies`. `docs/mcp-tools.md`: `kukulu_config_show`'s `policies` and `policySources`; `kukulu_next`'s sentence. `README.md`'s routing sentence says the global file and a profile may also carry `policies`.
- `test/plugin.mjs`'s "config keys documented" loop, `policies` branch, also asserts `docs/operations.md` documents the global and profile layers: the text contains `` `profiles.<name>.policies` `` and a line with both `global file` and `` `policies` ``.
- `CHANGELOG.md` `### Added`: `policies` in the global file and in each profile, layered under the project file, with `policySources` in `kukulu_config_show` (project-g F-19, D-02).

**Acceptance tests:** `test/routing.mjs` (each with a global file written by `writeGlobalConfig` and `KUKULU_CONFIG`): "a global policy wins over the default"; "a profile policy wins over the global one"; "a project policy wins over the profile"; "a profile with only policies is accepted"; "a bad global policies shape refuses naming the global file" (the unknown key, the enum form with `; got`, and the boolean form); "a bad profile policies shape refuses naming the profile"; "policySources names where each key came from"; "kukulu_pr_finalize honors a global finalize draft" (no `pr ready`, no `pr merge`); "the Run policies sentence names finalize and its source". `test/plugin.mjs`: "operations.md documents the global and profile policies layers".

**Out of scope:** the default itself (P2-01); any new policy key; `templates/kukulu.config.example.json`.

**Verification:** `kukulu_verify`.

**Depends on:** P2-01

### P2-03: Grouped similarity pairs

**Goal:** A similarity pair may carry `group`, each group has exactly one negative, one positive and at least one test, and every test pair is positioned against its own group's bands.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `docs/operations.md`, `docs/writing-specs.md`, `docs/mcp-tools.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.1, §6 E-01 (the key, validation, scoring, controls and the first two output bullets), §3 principles 2, 3, 5, 8, 9, Appendix B.7; CLAUDE.md's config-key protocol; `server-synchronous`.
- `validateSimilarity`: a pair's legal keys gain `group`, a slug matching `PAIR_ID`, else `cleanroom.similarity.pairs[<i>].group must be a slug (letters, digits and -); got <JSON value>` (with the existing `docs/kukulu.json ` prefix). A pair without one belongs to `default`. Per group: exactly one `negative`, exactly one `positive`, at least one `test`. When no pair names a group, today's three refusal texts stand unchanged; otherwise they read `docs/kukulu.json cleanroom.similarity.pairs group "<g>" needs exactly one pair with role "negative" (found <n>)`, the same for `positive`, and `… group "<g>" needs at least one pair with role "test"`. `control` stays legal only on a positive pair (text unchanged).
- `normalizeSimilarity`: a normalized pair carries `group` only when the policy gave one, so `similarity.json`'s `config` keeps the pairs as given, groups included.
- `similarity()`: each test pair is positioned against the negative and positive of its own group (`p.group ?? "default"`); every row gains `group`; `verdictOf` is unchanged. `verifyControlBundle(sim)` checks every positive pair that has a `control` (returning a map from pair id to its record) and the recorded config marks each.
- `docs/SIMILARITY.md`: after the statement paragraph, one line per group, `- group <g>: negative <id>, positive <id>` (the statement no longer names a single negative and positive; it says the test pairs were placed between each group's controls); the raw-scores table gains a `group` column between `pair` and `role` only when a pair named a group. The same inputs still give the same bytes.
- `docs/operations.md`'s `cleanroom.similarity` row: `group` and the per-group rule replace "exactly one `negative`, exactly one `positive`". `docs/writing-specs.md` item 4: one band per language pairing, with `group`. `docs/mcp-tools.md` `kukulu_similarity`: rows carry `group`, the per-group lines, the grouped refusals. `CONTRIBUTING.md`'s `cleanroom` suite row names `kukulu_similarity`.
- `CHANGELOG.md` `### Added`: similarity pairs may carry `group`, one negative and one positive per group, in `kukulu_similarity`, `SIMILARITY.md` and `scripts/compare-bundles.mjs` (project-g F-10, E-01).

**Acceptance tests:** `test/cleanroom.mjs`, validator (as the existing `statusWith` table): "a bad group is refused"; "a group with two negatives is refused naming the group"; "a group with no positive is refused naming the group"; "a group with no test pair is refused naming the group"; "no groups keeps the old refusal texts" (the existing "two negative pairs" assertion kept). Scoring: "a test pair in group rust-c is positioned against its own group's bands" (two groups over `test/fixtures/similarity/` directories; the `rust-c` row's `c` recomputed from that group's negative and positive scores equals the row's, and differs from the `default` group's); "an ungrouped config gives the old rows plus group default" (every row's `group` is `default`, and the rows with `group` removed equal what the existing single-band scoring test pins); "a grouped config's similarity.json keeps the groups and an ungrouped one has none".

**Out of scope:** `scripts/compare-bundles.mjs` and `test/bundles.mjs` (P2-04); the verifier (it only hashes `similarity.json`); any new metric.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-04: compare-bundles keys its scores by group

**Goal:** `scripts/compare-bundles.mjs` reports each bundle's negative and positive controls per group and reads a bundle without groups as the `default` group.

**Files touched:** `scripts/compare-bundles.mjs`, `test/bundles.mjs`, `test/harness.mjs`, `docs/cleanroom.md`

**Design constraints:**

- SPEC §6 E-01 (the `scripts/compare-bundles.mjs` bullet), §3 principles 3, 8, 10; `scripts-node-builtins` (the script may import `../mcp/cleanroom.mjs` as it does today).
- The `similarity` item becomes `{ verdict, groups: { <group>: { negative: { <metric>: score }, positive: { … } } } }`, where a row without `group` belongs to `default`. The text output prints, per group and metric, `  <group> <metric>: negative <x> positive <y>`. The cross-score section (`--trees`) compares against the `default` group's negative, else the first group's. Everything else is unchanged; the script still writes nothing.
- `docs/cleanroom.md`'s "Comparing two bundles" paragraph says the similarity controls are listed per group.
- `test/harness.mjs`'s `buildComparePair` (or the test itself, by rewriting one bundle's `similarity.json`) can produce a grouped bundle; recorded data stays under `test/fixtures/compare/`.

**Acceptance tests:** `test/bundles.mjs`: "comparing a grouped and an ungrouped bundle keys the controls by group" (`--json`: A has `groups.default` and `groups.rust-c`, B has only `groups.default`); "the text output prints one control line per group and metric"; "the cross score uses the default group's negative".

**Out of scope:** the server's scoring and validation (P2-03); `--trees` semantics beyond which negative is printed.

**Verification:** `kukulu_verify`.

**Depends on:** P2-03

### P2-05: An alias is the model it resolves to

**Goal:** `sameModel(declared, reported)` exists in both `mcp/cleanroom.mjs` and `scripts/verify-attestation.mjs`, and verifier check 12 notes a reported model only when it is not the declared one.

**Files touched:** `mcp/cleanroom.mjs`, `scripts/verify-attestation.mjs`, `test/attest.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-02, §3 principles 3, 8, 11; `cleanroom-module-pure`, `verifier-node-only`, `server-synchronous`; the duplicated code is duplicated on purpose (CLAUDE.md's reviewer-checked list).
- `export function sameModel(declared, reported)`, identical in both files: after `normalizeModel` on both, true when they are equal; or `declared` is `opus`, `sonnet`, `haiku` or `fable` and `reported` starts with `claude-<declared>-`; or `declared` is `inherit` and `reported` starts with `claude-`; or `reported` is `declared` followed by `-` and exactly eight digits. False otherwise.
- Verifier check 12 emits its note, text unchanged (`<role>: the endpoint reported <models>; routing declared <model>`), only for a reported model that is not `sameModel` with the declared one.
- `docs/cleanroom.md`'s offline-verification text for check 12 says an alias and the ids it resolves to count as the same model.
- `CHANGELOG.md` `### Fixed`: the verifier no longer reports an alias-resolved model as a routing mismatch (project-g F-20, E-02).

**Acceptance tests:** `test/attest.mjs`: "sameModel gives identical answers in both copies" (a shared table of at least ten pairs covering each rule and a false case, both modules fed the same inputs); "an alias-resolved reported model gives no note" (`sonnet` declared, `claude-sonnet-5-5` reported); "a reported model of another family still gives the note" (`sonnet` against `claude-opus-5-5`, with the existing pinned text); the existing `KNOWN_LIMITS` identity assertions keep passing.

**Out of scope:** `familyOf`, `MODEL_FAMILIES`, genesis's routing check.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-06: Phase 2 end: push and record the manual check

**Goal:** Push the branch and record Phase 2's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P2-06: Phase 2 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): with policies.finalize "draft" in the owner's global file, kukulu_config_show in a project with no policies block reports finalize "draft" with policySources.finalize "global"`.

**Depends on:** none

## Phase 3 — Stage handoffs, documentation and release

### P3-01: kukulu_next supplies the Agent call's description

**Goal:** Every `kukulu_next` result that names a stage to spawn, and every `streams[]` entry, carries `description`, and go-flight passes it to the `Agent` tool.

**Files touched:** `mcp/server.mjs`, `skills/go-flight/SKILL.md`, `test/state.mjs`, `test/plugin.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 F-01, §3 principles 2, 3, 8; `server-synchronous`. In server source the macron letter is the Unicode escape of U+016B (backslash, `u`, `016b`), never the literal character.
- `stage()` adds `description` for `plan`, `implement`, `review` and `summarize`: `Kūkulu <stage>` when `st.round` is 0, `Kūkulu <stage> round <n>` from round 1 on; each `streams[]` entry gains `description: Kūkulu stream <name>`. Each is at most 60 characters (a stream slug is at most 24). `done` and `halt` carry no `description`.
- `skills/go-flight/SKILL.md`: the sentence at step 4's head lists `subagent_type`, `description`, `prompt` and optionally `model`; step 1's result list gains `description`; step 4, the parallel-wave paragraph and the fallback retry each pass `description` verbatim (the entry's own for a stream).
- `docs/mcp-tools.md` `kukulu_next`: `description` in the returns list and on `streams[]`.
- `CHANGELOG.md` `### Fixed`: `kukulu_next` supplies the `Agent` call's `description`, which go-flight passes on, so the first stage spawn no longer fails validation (project-g F-21, F-01).

**Acceptance tests:** `test/state.mjs`: "every spawnable stage carries a description" (`plan`, `implement`, `review`, `summarize` results, with `Kūkulu <stage>` at round 0 and `Kūkulu implement round 1` after a fix round, each at most 60 characters, written with the escape); "done and halt carry no description"; "each streams entry carries Kūkulu stream <name>" (a streamed plan via the harness's `planDoc`/`progressDoc`). `test/plugin.mjs`: "go-flight names description beside subagent_type and prompt".

**Out of scope:** `effort`; any change to the prompts' text.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-02: The implementer sees its own task's log

**Goal:** `kukulu_task_next` returns the task's own log entries as `taskLog`, and the skills say an unblock reason reaches the implementer verbatim and overrides the PLAN.md text.

**Files touched:** `mcp/server.mjs`, `skills/implement/SKILL.md`, `skills/review-build/SKILL.md`, `test/implement.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 F-02, §3 principles 2, 3, 8; `server-synchronous`.
- `taskNext`'s result gains `taskLog: pr.logs[task.id] ?? null`, the task's own log entries in the shape `dependencyLogs[<id>]` uses. The tool's `TOOLS` description says so.
- `skills/implement/SKILL.md` step 2 (Read): read `taskLog` before acting; the newest `unblocked` or `REOPENED` entry's reason overrides the PLAN.md text where the two disagree. `skills/review-build/SKILL.md`'s `unblock` sentence: a reason must state the concrete instruction (what to build instead), because it reaches the implementer verbatim through `taskLog`.
- `docs/mcp-tools.md` `kukulu_task_next`: the `taskLog` row.
- `CHANGELOG.md` `### Fixed`: `kukulu_task_next` returns the task's own log as `taskLog`, so an unblock reason reaches the implementer (project-g F-02, F-02).

**Acceptance tests:** `test/implement.mjs`: "an unblocked task's taskLog carries the reviewer's reason" (a blocked task unblocked through `kukulu_review_submit` with a `reason`, then `kukulu_task_next` on it); "a fresh task's taskLog is null"; "a reopened task's taskLog carries REOPENED" (`kukulu_task_reopen`, then `kukulu_task_next`).

**Out of scope:** the reviewer's halt (P3-03); changing what `dependencyLogs` carries.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-03: An owner-only block halts for the owner

**Goal:** The reviewer may call `kukulu_run_halt` when the only open item is a task blocked on something only the owner can do, and a halt made during the review stage resumes into review.

**Files touched:** `agents/reviewer.md`, `skills/review-build/SKILL.md`, `test/plugin.mjs`, `test/state.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 F-03, §3 principle 2, §9 question 6; `no-fable-default` (only the `tools:` line of `agents/reviewer.md` changes); `kukulu_review_submit` does not change.
- `agents/reviewer.md`'s `tools:` line gains `mcp__plugin_kukulu_kukulu__kukulu_run_halt` at its end.
- `skills/review-build/SKILL.md` gains one rule, placed with the verdict rules: when categories 1–3 are clean across the branch and every remaining open item is a task whose blocker only the owner can clear, the reviewer calls `kukulu_run_halt` with `owner action needed: <task id>: <what the owner must do>` and stops without submitting a verdict; after the owner acts and calls `kukulu_run_resume`, the next review unblocks the task with the owner's answer. `test/plugin.mjs`'s existing check that every `kukulu_*` tool the skill names is on the reviewer's `tools:` line keeps passing.
- `docs/operations.md` `## Halts`: the reviewer's owner-action halt and how to resume it. `docs/mcp-tools.md` `kukulu_run_halt`: the reviewer may call it for an owner-only block.
- `CHANGELOG.md` `### Added`: the reviewer halts the flight with `owner action needed: …` when the only open item is blocked on the owner (project-g F-07, F-03).

**Acceptance tests:** `test/plugin.mjs`: "agents/reviewer can call kukulu_run_halt"; "review-build tells the reviewer to halt with owner action needed". `test/state.mjs`: "a halt made during the review stage resumes into review" (state `implemented: true, reviewed: false, halted: "owner action needed: P0-02: supply the corpus"` on a clean build branch: `kukulu_next` is `halt`; after `kukulu_run_resume({ reason })`, `kukulu_next` is `review`).

**Out of scope:** a new verdict for `kukulu_review_submit`; the implementer's own halts.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-04: A cargo test filter goes after --

**Goal:** `validateMutation` refuses a `mutation.targeted` command that runs `cargo test` with `{filter}` before a standalone `--`, and the planner's instructions give the cargo form.

**Files touched:** `mcp/server.mjs`, `test/routing.mjs`, `skills/plan-build/SKILL.md`, `templates/SPEC.md`, `docs/operations.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 F-04, §3 principles 2, 3, 5, 9; `server-synchronous`.
- `validateMutation`: split `cmd` on whitespace; the command runs `cargo test` when a token `cargo` is followed, after any tokens starting with `-` or `+`, by a token `test`; it is refused when a token containing `{filter}` comes before the first token that is exactly `--`, or there is no such token: `docs/kukulu.json mutation.targeted.<name>.cmd runs cargo test with {filter} before --; cargo test takes one TESTNAME, so a list filter fails. Write it as "cargo test <options> -- {filter}"`. `cargo test --workspace -- {filter}` loads.
- `skills/plan-build/SKILL.md`'s `mutation.targeted` sentence and `templates/SPEC.md`'s commands paragraph give the cargo form beside the phpunit one: `"cargo test --workspace -- {filter}"`, because `cargo test` takes one TESTNAME and libtest, behind `--`, takes several.
- `docs/operations.md`'s `mutation.targeted` row names the cargo rule and the refusal.
- `CHANGELOG.md` `### Added`: a `cargo test` targeted command with `{filter}` before `--` is refused when the config loads (project-g F-05, F-13, F-04).

**Acceptance tests:** `test/routing.mjs`: "a cargo test targeted command with {filter} before -- is refused" (the full message); "cargo test --workspace -- {filter} loads"; "cargo +nightly test -- {filter} loads"; "a non-cargo command with {filter} and no -- still loads". `test/plugin.mjs`'s existing skill and template checks keep passing.

**Out of scope:** `kukulu_mutate`'s filter quoting; `cargo nextest`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-05: CHANGELOG 0.8.1 and the version

**Goal:** The release reads 0.8.1 everywhere and the changelog entry is complete.

**Files touched:** `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `mcp/server.mjs`, `README.md`

**Design constraints:**

- SPEC §1 ("the version reads 0.8.1 everywhere"), §6 G.
- Rename `## [Unreleased]` to `## [0.8.1] — <today>` with `### Added`, `### Changed` and `### Fixed` only, no Breaking changes heading. Read the lines earlier tasks added; each cites its feedback item or requirement; fill any gap so every §6 requirement (A-01, A-02, B-01, B-02, C-01, C-02, C-03, D-01, D-02, E-01, E-02, F-01 to F-04) has a line.
- `0.8.1` in `package.json`, `.claude-plugin/plugin.json`, `VERSION` in `mcp/server.mjs`, and README's version badge (`version-0.8.1`, alt `Version 0.8.1`). The tool count stays twenty-six.
- `docs/feedback/2026-11-11-project-g.md` is local and gitignored: only if it exists, add the header line `Addressed in: docs/SPEC.md v0.8.1 (flight v0-8-1)` after its title, in the form the earlier feedback files use; never stage it; no test reads it.

**Acceptance tests:** `test/plugin.mjs`'s existing "package.json and plugin.json agree on the version", "the MCP server reports the plugin's version" and "CHANGELOG.md's newest entry is the package version".

**Out of scope:** tagging, publishing or merging (that is `kukulu_release`, run by the owner after the merge).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-06: Phase 3 end: push and record the manual checks

**Goal:** Push the release branch and record Phase 3's manual checks for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 3, §6 G (HANDOFF). No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P3-06: Phase 3 end: push and record the manual checks`. The handoff written for `kukulu_run_finish` has no "do not merge" line and lists the manual checks of all four phases.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs; merging; releasing.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): on the next flight, go-flight's first Agent call carries description and does not fail validation; cargo test --workspace -- a b runs both filters on a stable Rust toolchain`.

**Depends on:** none

## Spec issues

- §3 principle 7 says every constraint of `docs/flights/v0-8-0/kukulu.json` carries over unchanged, but three of them carry `from: "P2-02"` and the guard self-test `extraVerify` entries carry `from: "P2-01"`, ids of the 0.8.0 plan; `kukulu_plan_commit` resolves `from` against this plan, where P2-02 is the global-policies task. Resolution: the gates are dropped (the 0.8.0 tasks landed, so the rules and commands are active from the start); patterns, paths and fixtures are untouched.
- §6 C-03 says the archive-time refusal "gets the test it has never had", but `test/review.mjs` already asserts `docs/flights/w1-share already exists` on `kukulu_flight_archive`. Resolution: P1-05 pins the full text (`…; choose another slug, or remove the old archive`) in that assertion rather than adding a duplicate.
- §6 B-01 asks `docs/operations.md` to name "the Claude Code version the docs name" for the per-server `timeout`. The implementer has no web access and nothing on disk names it. Resolution: the section names the field and points at Claude Code's MCP documentation for the version; the owner may fill in the number by hand.
- §6 D-01's test reads `finalize` from `kukulu_config_show`, which has no `policies` field until D-02. Resolution: P2-01 adds the resolved `policies` to `kukulu_config_show`; P2-02 adds `policySources`.
- §6 D-02 says the project file's messages are unchanged while its global examples end with `; got "x"`. Resolution: followed literally (P2-02): the `; got` suffix appears only with a non-project `where`.
- §6 E-01 says `similarity.json` keeps `config` "as given, groups included", while `normalizeSimilarity` fills defaults. Resolution: a normalized pair carries `group` only when the policy gave one; rows always carry it.
- §4 cites line numbers (`mcp/cleanroom.mjs:807-810`, `mcp/server.mjs:2517`, `:2982`); they are approximate (`nextDecision` holds the genesis write, not `next`). Tasks name functions, not lines.
- §6 F-02's changelog citation is the feedback item `project-g F-02`, which shares its id with requirement F-02; the changelog lines cite the feedback item first and the requirement second so the two are told apart.

## Review fixes (round 1)

### R1-01: Exclude docs/kukulu.json from no-hardcoded-mcp-timeout

**Goal:** The constraint no-hardcoded-mcp-timeout stops matching its own description, pattern and fixtures in docs/kukulu.json, so kukulu_verify's constraints result is ok when the code is clean.
**Files touched:** docs/kukulu.json
**Design constraints:** Change only that rule's exclude array: append "docs/kukulu.json". Do not touch its id, description, paths, pattern, shouldMatch or shouldNotMatch, or any other rule, command or key (SPEC principle 7: the carried rules stay unchanged). Keep the file ASCII-only with JSON escapes for non-ASCII characters, as it is now.
**Acceptance tests:** kukulu_verify: the constraints result for no-hardcoded-mcp-timeout is ok: true with hits [] and fixture null (it reports 10 hits in docs/kukulu.json today, which is the finding), and constraints.ok is true. The rule's own self-test (shouldMatch and shouldNotMatch) still passes.
**Out of scope:** Any change to .mcp.json, the server, the tests or the docs; changing how the constraint engine scans its own config (that is Kūkulu tooling, logged as feedback).
**Verification:** kukulu_verify with files ["docs/kukulu.json"]: ok true overall.
**Depends on:** none

### R1-02: Guard: heredoc misdetection, abbreviated sed long options, and untested sed and heredoc mechanics

**Goal:** No heredoc the shell does not read hides the commands after it, an abbreviated GNU --in-place counts as in place, and the sed empty-suffix, -l value and digits-only rules each have a test that fails without them.
**Files touched:** mcp/cleanroom.mjs, test/cleanroom.mjs, test/fixtures/guard-cases.json, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** SPEC 6 A-01 and A-02, principles 1, 3, 6 and 8; CLAUDE.md's guard-rule protocol: every new fixture name ends with ' (R1-02)', append cases with a script that loads the file and dumps it with indent=1 and no ASCII escaping, policy "template", cwd __ROOT__, and no existing fixture changes its expect or reason. cleanroom-module-pure and server-synchronous hold; no-gnu-sed-inplace: test source builds an in-place sed through the existing SED variable. Changes in mcp/cleanroom.mjs: (1) stripHeredocs: a << inside an arithmetic $((...)) or ((...)) is a shift, never a heredoc operator, whatever its operand (keep the digits-only rule as a special case of this); (2) stripHeredocs: an unquoted # that begins a word starts a comment that runs to the end of the line, and a << inside it is not an operator; (3) stripHeredocs: the delimiter word has quotes removed from all of it, as bash does (E'OF', "E"OF and E\OF all end at a line reading EOF), and the body is quoted when any part of the word was quoted; (4) sedScan: a long option that is an unambiguous prefix of --in-place (from --i), --expression (from --e), --file (from --fi) or --line-length (from --l), with or without =<value>, is treated exactly as the full name is (GNU getopt_long accepts unambiguous abbreviations; --f alone is ambiguous with --follow-symlinks and stays a plain option). docs/cleanroom.md: the heredoc paragraph says << in arithmetic and in a comment is not an operator and that the delimiter is the word after quote removal; rule 6's sed sentence names the abbreviations. CHANGELOG.md: one line under ## [0.8.1]'s ### Fixed citing A-01 and A-02.
**Acceptance tests:** New fixtures in test/fixtures/guard-cases.json, each ending (R1-02). Denied, reason protected path: 'echo $((1<<n))' newline 'rm -rf .kukulu/cleanroom'; '(( x = y << z ))' newline 'rm -rf .kukulu/cleanroom'; 'echo hi # see a<<b' newline 'rm -rf .kukulu/cleanroom'; "cat <<E'OF' > x.txt" newline 'hi' newline 'EOF' newline 'rm -rf .kukulu/cleanroom'; 'echo $((1<<3))' newline 'rm -rf .kukulu/cleanroom' (kills the survivor that drops the digits-only rule at mcp/cleanroom.mjs:649); 'sed --in s/a/b/ .mcp.json'; 'sed --in-pl=.bak s/a/b/ .mcp.json'. Allowed: "cat <<E'OF' > notes.txt" newline '$(rm -rf .kukulu)' newline 'EOF' (quoted after quote removal, so not scanned); "cd .kukulu/cleanroom; sed -i '' 1d ../../src/a.rs" (fails if the BSD empty-suffix skip at mcp/cleanroom.mjs:1535 is deleted, because 1d becomes a write target under .kukulu/cleanroom); 'cd .kukulu/cleanroom; sed -i -l 80 1d ../../src/a.rs' (fails if l is dropped from the value-taking letters at :1538). test/cleanroom.mjs: the sedInPlace table gains ["--in"], ["--in-pl=.bak"] and ["--in-place"] as true and ["--follow-symlinks", "-n"] as false; 'stripHeredocs ignores << in arithmetic and in a comment' (text unchanged, bodies []); 'stripHeredocs removes quotes from the whole delimiter word' (E'OF' gives quoted true and ends at EOF). Every existing fixture keeps its decision and reason. Each new denied fixture is allowed at HEAD before the fix, which is the regression.
**Out of scope:** A heredoc piped into a shell (cat <<EOF | bash), which SPEC A-02 defines as data (a spec issue for the owner); sed's w command; modelling sed's script language; option abbreviations of any other command word; the -ei cluster reading (a spec issue).
**Verification:** kukulu_verify with the files touched (runs both guard self-tests); also node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json before committing. The commit body lists that no existing fixture changed.
**Depends on:** none

### R1-03: kukulu_release: test the signing outcome read from origin, localState current and fastForward up to date

**Goal:** Every kukulu_release result SPEC C-02 defines has a test that fails without its mechanic: a tag signed because origin's archived state.json records signing on, localState "current", and fastForward "up to date".
**Files touched:** test/review.mjs, test/harness.mjs, test/fixtures/gh/
**Design constraints:** SPEC 6 C-02 steps 5, 8 and 9 and principles 3 and 10. Tests only: change mcp/server.mjs only if a new test exposes a real bug, and then the commit body says so. Recorded gh output lives in test/fixtures/gh/; extend the existing releaseRepo helper and mkFakeGhBin rather than writing a second fake gh. A working signer is test/harness.mjs's mkFakeGpg() plus useFakeSigner(repo, path), with tag.gpgsign left unset so that only origin's archived state.json can ask for a signature. Never depend on the developer's git config.
**Acceptance tests:** test/review.mjs: 'a tag is signed when origin's archived state.json records signing on' (the archived state.json on origin has signing "on", the local base has no archive or a different one, and tag.gpgsign is unset: git cat-file -p of the tag shows a signature; fails when mcp/server.mjs:5404 'if (!signed) signed = archivedSigning === "on";' becomes 'if (!signed) signed = false;'); 'localState is current when the local base names the same flight as origin' (fails when ':5424 localArchived?.slug === archived.slug ? "current"' becomes 'false ? "current"'); 'fastForward is up to date when the checked-out base already equals origin' (fails when ':5432' always returns "done"). Each of the three mutants survived node test/review.mjs (491/491) in round 1.
**Out of scope:** Changing release's order or refusal texts; D-02 layers in finalizeConfig; merging anything.
**Verification:** kukulu_verify with the files touched.
**Depends on:** none

### R1-04: Profile policies messages, cargo test detection on any cargo, and README's finalize row

**Goal:** A bad profile policy names profiles.<name>.policies.<key> as SPEC D-02 writes it, every cargo test in a targeted command is checked for {filter} before --, and README's kukulu_pr_finalize row states the ready default.
**Files touched:** mcp/server.mjs, test/routing.mjs, README.md
**Design constraints:** SPEC 6 D-02 (message form '... profiles.fast.policies.push must be a boolean'), 6 F-04 (the words cargo, then test, possibly with options between them, wherever they appear in the command), 6 G (README states the finalize default wherever a sentence states it), principles 5 and 9; server-synchronous. The project file's policies messages stay byte-identical; the global file's stay '<global path> policies.<key> ...'. For a profile the message is '<global path> profiles.<name>.policies.<key> ...' and '<global path> profiles.<name>.policies has an unknown key ...' (a dot, not a space, before policies). In validateMutation, check every occurrence of the word cargo, not only the first (words.indexOf at mcp/server.mjs:979). README.md:229: the kukulu_pr_finalize row says it marks the draft PR ready and enables auto-merge only under policies.finalize "auto" and not breaking. The refusal text of F-04 does not change, and the existing CHANGELOG lines already cover both fixes.
**Acceptance tests:** test/routing.mjs: 'a bad profile policies shape refuses naming the profile' asserts /profiles\.fast\.policies\.push must be a boolean$/ (it pins 'profiles\.fast policies' today, which is the finding), plus the unknown-key form /profiles\.fast\.policies has an unknown key 'nope'$/; 'a cargo test after another cargo command with {filter} before -- is refused' (cargo build --release && cargo test {filter}, with the full F-04 message); and 'cargo build && cargo test -- {filter} loads'.
**Out of scope:** Any new policy key; the global file's message form; cargo nextest; kukulu_mutate's filter quoting; other README rows.
**Verification:** kukulu_verify with the files touched.
**Depends on:** none

## Review fixes (round 2)

### R2-01: Fix the ASCII display name at docs/PLAN.md:525 that turns lint and CI red

**Goal:** npm run lint, pre-commit and the plugin suite pass again, and the four PR checks that fail on check-names today go green.
**Files touched:** docs/PLAN.md
**Design constraints:** This is the one hand edit of docs/PLAN.md this review sanctions: the bad text came from the round-1 review submission, and no tool can amend a committed fix section. On line 525 only (R1-01's Out of scope field), replace the seven-letter ASCII spelling of the display name, in the phrase about the constraint engine's own tooling, with Kūkulu written with U+016B. No other byte of docs/PLAN.md changes: the commit's diff is that one line. Do not edit scripts/check-names.mjs, loosen any check, or touch any other file. progress-no-bare-macron: the task log writes the macron letter only inside the display name, and the commit body may simply say 'the ASCII display name'.
**Acceptance tests:** The CI checks failing on PR #6 today, all from this one check-names line: test (node 22), test (node 24), test (node 26), and pre-commit (yamllint / shellcheck / markdownlint / gitleaks). Locally: node scripts/check-names.mjs exits 0, and test/plugin.mjs's check-names assertion passes (it is the plugin suite's only failure today).
**Out of scope:** Any other PLAN.md text; scripts/check-names.mjs; the server's review submission path (logged as pipeline friction).
**Verification:** kukulu_verify: ok true (npm run lint, pre-commit run --all-files and npm test all pass). git show --stat of the commit lists docs/PLAN.md with one line changed. After the round's push, kukulu_status prChecks shows those four checks passing.
**Depends on:** none

### R2-02: Guard: a << inside ${...} or $[...] is not a heredoc operator

**Goal:** No parameter expansion or old-style arithmetic that holds << hides the commands after it from the guard; the four forms denied at the merge base are denied again.
**Files touched:** mcp/cleanroom.mjs, test/cleanroom.mjs, test/fixtures/guard-cases.json, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** SPEC 6 A-02 and principles 1, 3, 6 and 8; CLAUDE.md's guard-rule protocol: every new fixture name ends with ' (R2-02)', append cases with a script that loads the file and dumps it with indent=1 and no ASCII escaping, policy "template", cwd __ROOT__, and no existing fixture changes its expect or reason. cleanroom-module-pure and server-synchronous hold. In stripHeredocs, outside quotes, as the existing (( branch does: a ${ copies through to its matching } (nesting-aware for inner ${ and {, honoring single quotes, double quotes and backslashes inside), and a $[ copies through to its matching ]; a << inside either is never an operator. An unclosed ${ or $[ is not special (the same reading R1-02 gave an unclosed ((). A << after the closing } is still an operator, so echo ${#x}<<y stays a real heredoc. docs/cleanroom.md: the heredoc paragraph names ${...} and $[...] beside $((...)), ((...)) and the comment. CHANGELOG.md: extend the existing ### Fixed line R1-02 added (the one citing A-01, A-02) to name ${...} and $[...]; add no new heading.
**Acceptance tests:** New fixtures in test/fixtures/guard-cases.json, each ending (R2-02). Denied, reason protected path: .*: 'echo $[1<<n]' newline 'rm -rf .kukulu/cleanroom'; 'echo ${x#<<y}' newline 'rm -rf .kukulu/cleanroom'; 'echo ${x:-<<y}' newline 'rm -rf .kukulu/cleanroom'; 'y=${x/<</z}' newline 'rm -rf .kukulu/cleanroom'. Each of the four is allowed at HEAD before the fix and denied at the merge base 36df873, which is the regression. Allowed: 'echo ${#x}<<y' newline 'rm -rf .kukulu/cleanroom' (bash reads a heredoc after the expansion, so the rm line is its unterminated body). test/cleanroom.mjs: 'stripHeredocs ignores << inside ${...} and $[...]' (text unchanged, bodies []). Every existing fixture keeps its decision and reason.
**Out of scope:** Judging an unterminated heredoc body as commands (a spec issue for the owner); a heredoc piped into a shell; backtick parsing; any other command word or guard rule.
**Verification:** kukulu_verify with the files touched (runs both guard self-tests); also node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json before committing. The commit body states that no existing fixture changed.
**Depends on:** none

### R2-03: Guard tests: sed's attached long-option value and the (( subshell check

**Goal:** The two mechanics R1-02 added that no test covers each have a fixture that fails without them.
**Files touched:** test/fixtures/guard-cases.json, test/cleanroom.mjs
**Design constraints:** Tests only: change mcp/cleanroom.mjs only if a new fixture exposes a real bug, and then the commit body says so. CLAUDE.md's guard-rule protocol: names end ' (R2-03)', append with indent=1 and no ASCII escaping, policy "template", cwd __ROOT__, no existing fixture changes. no-gnu-sed-inplace: test source builds an in-place sed through the existing SED variable.
**Acceptance tests:** Denied, reason protected path: .*: 'sed --expression=s/a/b/ -i .mcp.json' and 'sed --e=s/a/b/ -i .mcp.json' (both fail when sedScan's 'if (!hasValue && i + 1 < args.length) skip.add(++i);' loses '!hasValue &&', because -i is then swallowed as the value). Allowed: "((cd src); cat <<'EOF' > notes.txt" newline '$(rm -rf .kukulu)' newline 'EOF' newline ')' (a subshell holding a quoted heredoc, whose body is data; fails when arithmeticEnd's 'return command[i - 1] === ")" ? i : -1;' becomes 'return i;'). test/cleanroom.mjs: the sedInPlace table gains ["--expression=s/a/b/", "-i", "f"] as true. Both mutants survived the targeted cleanroom suite (1371/1371) in round 2.
**Out of scope:** Any change to the guard's behavior; other sed options; other command words.
**Verification:** kukulu_verify with the files touched; node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json before committing.
**Depends on:** R2-02

### R2-04: cargo test refusal: compare each cargo test with its own --

**Goal:** Every cargo test in a mutation.targeted command is refused when its {filter} is not after a standalone -- that follows that cargo test, whatever -- another command in the line carries.
**Files touched:** mcp/server.mjs, test/routing.mjs
**Design constraints:** SPEC 6 F-04 and principles 5 and 9; server-synchronous. In validateMutation, for each cargo occurrence whose next non-option word (k) is test, take the first -- after k and the first word containing {filter} after k; refuse when no -- follows k or when that filter comes before it. The refusal text is unchanged, so docs and CHANGELOG need no change. Today dashes and filterAt are computed once for the whole command (mcp/server.mjs:982-983), so cargo fmt -- --check && cargo test {filter} loads.
**Acceptance tests:** test/routing.mjs: 'a cargo test whose only -- belongs to an earlier command is refused' (cargo fmt -- --check && cargo test {filter}, asserting the full F-04 message, which fails at HEAD); 'cargo fmt -- --check && cargo test -- {filter} loads'. All existing cargo assertions keep passing.
**Out of scope:** cargo nextest; shell parsing of && and ; beyond word order; kukulu_mutate's filter quoting.
**Verification:** kukulu_verify with the files touched.
**Depends on:** none

## Review fixes (round 3)

### R3-01: Guard: a << in an array-subscript assignment, a compound array assignment or a backtick span is not a heredoc operator

**Goal:** No array-subscript assignment, compound array assignment or backtick span holding << hides the commands after it from the guard; the ten forms denied at the merge base 36df873 are denied again.
**Files touched:** mcp/cleanroom.mjs, test/cleanroom.mjs, test/fixtures/guard-cases.json, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** SPEC 6 A-02 and principles 1, 3, 6 and 8; CLAUDE.md's guard-rule protocol: every new fixture name ends with ' (R3-01)', append cases with a script that loads the file and dumps it with indent=1 and no ASCII escaping, policy "template", cwd __ROOT__, and no existing fixture changes its expect or reason. cleanroom-module-pure and server-synchronous hold. In stripHeredocs, outside quotes, add copy-through branches like the existing ${, $[ and (( ones, so a << inside the region is never an operator: (1) at a word start (index 0 or after whitespace or one of ; & | ( ) { }), an identifier [A-Za-z_][A-Za-z0-9_]* followed by [ whose matching ] (nesting-aware and quote-aware; expansionEnd already does this for [) is immediately followed by = or +=: the region runs through that ]; (2) at a word start, an identifier followed by =( or +=(: the region runs through the matching ) (nesting-aware, quote-aware); (3) an unescaped backtick: the region runs through the next unescaped backtick. An unclosed region is not special (the reading R1-02 and R2-02 gave an unclosed (( or ${). Matching a word start after a command word (echo a[1<<n]=3, declare a[1<<n]=3) is allowed: it only denies more. The $( branch does not change: bash 5.2 reads a $(cat <<x) body from the following lines, as the guard does today. docs/cleanroom.md: the heredoc paragraph names an array-subscript assignment, a compound array assignment and a backtick span beside $((...)), ((...)), ${...}, $[...] and the comment. CHANGELOG.md: extend the existing ### Fixed line citing A-01, A-02 to name them; add no new heading.
**Acceptance tests:** New fixtures in test/fixtures/guard-cases.json, each ending (R3-01). Denied, reason protected path: .*, each as the form then a newline then 'rm -rf .kukulu/cleanroom': 'a[1<<n]=3'; 'a[1<<n]+=3'; 'x=1 a[1<<n]=3'; 'a[x[1<<n]]=3'; 'f() { a[1<<n]=3; }'; 'x=$(a[1<<n]=3)'; 'a=([1<<n]=3)'; 'declare -a a=([1<<n]=3)'; 'a=(x <<n)'; 'echo `cat <<x`'. Each of the ten is denied at the merge base 36df873 and allowed at HEAD before the fix, and bash 5.2 runs the second line of every one, which is the regression. Allowed (bash reads a real heredoc, so the rm line is body): 'a[1]<<n' newline 'rm -rf .kukulu/cleanroom'; 'echo $(cat <<x)' newline 'rm -rf .kukulu/cleanroom' newline 'x'. test/cleanroom.mjs: 'stripHeredocs ignores << inside an array-subscript assignment, a compound array assignment and a backtick span' (text unchanged, bodies [] for a[1<<n]=3, a=([1<<n]=3) and echo `cat <<x`, each followed by a newline and rm -rf x). Every existing fixture keeps its decision and reason.
**Out of scope:** Judging an unterminated heredoc body as commands (a spec issue for the owner); a heredoc piped into a shell; the $( branch; [[ ]] and case patterns (bash refuses them as syntax errors and runs nothing after); any other command word or guard rule.
**Verification:** kukulu_verify with the files touched (runs both guard self-tests); also node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json before committing. The commit body states that no existing fixture changed.
**Depends on:** none

## Review fixes (round 4)

### R4-01: Guard: a << inside a [[ ... ]] conditional or an extglob group is not a heredoc operator

**Goal:** No [[ ... ]] conditional and no extglob pattern group hides the commands after it from the guard: a << inside one is never read as a heredoc operator (SPEC A-02, principle 1 regression against merge base 36df873).
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** Follow CLAUDE.md's 'Changing a guard rule' protocol: new fixture names end in ' (R4-01)', appended with a script that loads guard-cases.json and dumps it with indent=1 and no ASCII escaping; no existing fixture changes its expect or reason. In stripHeredocs, outside quotes, copy each region through without looking for <<, the way the ${, $[, ((, assignment and backtick branches already do; an unclosed region is not special. (a) A [[ at a word start followed by a blank, through the next ]] that is preceded by a blank and followed by a blank, ;, &, |, ), a newline or the end of the command; quote-aware. (b) One of ? * + @ ! directly followed by (, through its matching ), nesting-aware and quote-aware; the existing (( / $(( arithmetic branch must still win for $((2*(1<<3))). Copy-through may only hide an operator, never expose one. server-synchronous and cleanroom-module-pure apply to mcp/cleanroom.mjs (no async/await even in comments). Update the operator sentence of docs/cleanroom.md's heredoc paragraph and extend the existing A-02 CHANGELOG Fixed line.
**Acceptance tests:** guard-cases.json, denied (reason 'protected path: .*'), policy template, cwd __ROOT__: '[[ a =~ (x<<y) ]]' NL 'rm -rf .kukulu/cleanroom'; '[[ a =~ (x<<y) ]]' NL 'rm -rf .kukulu/cleanroom' NL 'y'; '[[ a =~ ^(<<y)$ ]]' NL rm; '[[ a =~ x(<<y) ]]' NL 'echo x > docs/cleanroom.json'; 'if [[ a =~ (<<y) ]]; then :; fi' NL rm; '[[ a == @(x<<y) ]]' NL rm; '[[ a == +(<<y) ]] && echo ok' NL rm; 'shopt -s extglob' NL 'echo @(x<<y)' NL rm; 'shopt -s extglob' NL 'ls !(x<<y)' NL rm; 'shopt -s extglob' NL 'case a in @(x<<y)) ;; esac' NL rm. Allowed: '[[ -n a ]] <<y' NL 'rm -rf .kukulu/cleanroom' (a real unterminated heredoc after the ]]); '[[ -n a ]] && cat <<EOF > notes.txt' NL 'rm -rf .kukulu/cleanroom' NL 'EOF'. test/cleanroom.mjs: one stripHeredocs assertion that '[[ a =~ (x<<y) ]]', '[[ a == @(x<<y) ]]' and 'echo @(x<<y)', each + NL 'rm -rf x', come back with text unchanged and no bodies. Each denied fixture is allowed at HEAD fb5ddd7 today, so these would have caught the finding.
**Out of scope:** Any other quoting or parsing change: ANSI-C $'\'' handling in splitRaw, heredocs piped into a shell, and the advisory mutation survivors (expansionEnd, assignmentEnd nesting, backtickEnd escape) are not this task. Do not change SPEC, PLAN, or existing fixtures.
**Verification:** node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json && node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json; npm test -- cleanroom; kukulu_verify ok. The reviewer will kukulu_mutate each new branch's condition to false and expect the R4-01 fixtures to fail.
**Depends on:** none

## Review fixes (round 5)

### R5-01: Guard: a !( subshell and an argument [[ do not hide a real heredoc

**Goal:** R4-01's copy-through branches no longer hide a real heredoc operator, so an apostrophe body cannot hide later commands again (SPEC A-02 'A hole', principle 1 regression against 58575de): [[ is a conditional only in command position, and !( in command position is judged under both its extglob-off (negated subshell) and extglob-on (pattern word) readings, denying when either denies.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** Follow CLAUDE.md's 'Changing a guard rule' protocol: new fixture names end in ' (R5-01)', appended with a script that loads guard-cases.json and dumps it with indent=1 and no ASCII escaping; no existing fixture changes its expect or reason (every R4-01 fixture keeps its verdict). In stripHeredocs: (a) the [[ branch applies only when the [[ is in command position: the start of the command, or after a newline, ;, &, |, ( or { (blanks skipped), or after one of the reserved words if, then, else, elif, while, until, do, time, ! (as whole words). Elsewhere [[ is an ordinary word with no special handling. (b) A ! directly followed by ( in that same command position is ambiguous (extglob off: ! plus a subshell, so a heredoc inside is real; extglob on: a pattern word, so a << inside is text). Do not copy it through; instead a heredoc whose operator lies inside that group has its body judged as commands (as a shell-read body is), so neither reading hides a write. ?(, *(, +(, @( anywhere and !( outside command position keep R4-01's copy-through. Share one command-position helper between (a) and (b). server-synchronous and cleanroom-module-pure apply (no async/await even in comments). Update the operator sentence of docs/cleanroom.md's heredoc paragraph to state both position rules, and extend the existing A-02 CHANGELOG Fixed line.
**Acceptance tests:** guard-cases.json, policy template, cwd __ROOT__. Denied with reason 'protected path: .*' (each allowed at HEAD f0b3c98, denied at 58575de, and bash runs the write): (1) '!(cat <<EOF' NL "it's" NL 'EOF' NL 'rm -rf .kukulu/cleanroom' NL "echo ')'" NL ')'; (2) 'echo ok && !(cat <<EOF' NL "it's" NL 'EOF' NL 'rm -rf .kukulu/cleanroom' NL ": ')'" NL ')'; (3) '!(cat <<EOF > x.txt' NL "it's" NL 'EOF' NL ") ; rm -rf .kukulu/cleanroom ; : ')'"; (4) 'echo [[ <<EOF' NL "it's" NL 'EOF' NL 'rm -rf .kukulu/cleanroom' NL ": ' x ]] '"; (5) 'cat a [[ <<EOF' NL "it's" NL 'EOF' NL 'echo x > docs/cleanroom.json' NL ": ' ]] '". Denied, pinning that command position still covers keywords and the extglob-on reading (denied at HEAD today, must stay so): 'shopt -s extglob' NL '!(x<<y)' NL 'rm -rf .kukulu/cleanroom'; 'while [[ a =~ (<<y) ]]; do :; done' NL rm; '! [[ a =~ (<<y) ]]' NL rm; 'echo ok && [[ a =~ (<<y) ]]' NL rm; 'shopt -s extglob' NL 'echo @(a|(x)<<y)' NL rm (pins groupEnd nesting). Allowed (pins the command-position check; denied at HEAD today as an over-denial): 'echo [[ <<EOF > notes.txt' NL 'rm -rf .kukulu/cleanroom' NL 'EOF' NL 'echo ]]'. test/cleanroom.mjs: one stripHeredocs assertion that 'echo [[ <<EOF\nit is\nEOF\nx ]]' yields one body ('it is') and that '[[ a =~ (x<<y) ]]\nrm -rf x' still yields none.
**Out of scope:** Any other quoting or parsing change: ANSI-C $'\'' handling in splitRaw, heredocs piped into a shell, $( ... ) wrapping a !( subshell beyond what the command-position rule closes by itself, and the advisory mutation survivors (conditionalEnd closer boundary, expansionEnd, assignmentEnd nesting, backtickEnd escape) are not this task. Do not change SPEC, PLAN, or existing fixtures.
**Verification:** node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json && node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json; npm test -- cleanroom; kukulu_verify ok. The reviewer will run the five regression forms through HEAD's evaluate and real bash, and kukulu_mutate the command-position helper to always-true and to always-false, expecting R5-01 fixtures to fail each time.
**Depends on:** none

## Review fixes (round 6)

### R6-01: Green the PR checks: restore docs/kukulu.json escapes and exempt the feedback log from check-names' bare-letter rule

**Goal:** npm run lint, pre-commit and the plugin suite pass again, so the failing PR checks test (node 22), test (node 24), test (node 26) and pre-commit (yamllint / shellcheck / markdownlint / gitleaks) go green: docs/kukulu.json gets back the JSON escapes that kukulu_flight_options (commit 9d2f86b) turned into literal characters (check-names hit at docs/kukulu.json:655), and scripts/check-names.mjs stops applying its bare-macron-letter rule to .kukulu/feedback.jsonl (hit at line 8), an append-only machine log of agents' words like docs/feedback/.
**Files touched:** docs/kukulu.json, scripts/check-names.mjs, test/plugin.mjs
**Design constraints:** docs/kukulu.json: re-escape only; every non-ASCII character 9d2f86b wrote literally goes back to its JSON escape form (U+016B, U+2014, U+26A0 U+FE0F), so `git diff d9b19ea -- docs/kukulu.json` shows only the maxRounds and maxRoundsHard lines; no key, value, constraint, fixture or ordering change. Write the file with a script that replaces each non-ASCII code unit by its lowercase four-hex JSON escape; never type the macron letter or its escape into a task_done log or reason. scripts/check-names.mjs: the exemption is for the exact path .kukulu/feedback.jsonl and for the bare-letter check only; the non-ASCII path check, the NFD check and the private-name check still run on it; never edit .kukulu/feedback.jsonl itself. Write the letter in test source only as the Unicode escape. Comments say why (the log records agents' words verbatim and is never rewritten).
**Acceptance tests:** test/plugin.mjs, next to the existing check-names temp-directory cases (around line 760): one assertion that a temp directory whose .kukulu/feedback.jsonl holds a line with the bare U+016B letter outside the display name passes check-names (status 0), and one that the same line in another file (say notes.md) still fails (status 1). The existing 'check-names passes on this repository' assertion is the one that fails today and must pass after the fix.
**Out of scope:** Changing kukulu_flight_options' or kukulu_feedback_log's JSON writer in mcp/server.mjs (a spec issue for the owner); any other check-names rule; any other docs/kukulu.json edit.
**Verification:** node scripts/check-names.mjs exits 0; npm run lint; npm test -- plugin; kukulu_verify ok: true; after push the four named PR checks pass.
**Depends on:** none

### R6-02: Guard: a heredoc piped into a shell has its body judged as commands

**Goal:** SPEC A-02's pipe case (Judgment of a body, second bullet; owner edit 4937aa4): a heredoc body is judged as commands when its owning segment pipes (| or |&) into a later segment of the same pipeline whose command word is sh, bash, zsh, dash or ksh with no -c. Closes a principle-1 regression: `cat <<EOF | bash` NL `rm -rf .kukulu/cleanroom` NL `EOF` was denied at the merge base 36df873 and is allowed at HEAD; bash runs the rm.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** Follow CLAUDE.md's 'Changing a guard rule' protocol: new fixture names end in ' (R6-01)'... no: end in the id this task is assigned (R6-02), after a space; append with a script that loads guard-cases.json and dumps it with indent=1 and no ASCII escaping; no existing fixture changes its expect or reason. The shell test reuses the existing owner-shell test (command word ^(?:ba|z|da|k)?sh$ and no -c cluster) on the later segment; the pipeline ends at the first ;, &&, ||, & or newline that is not inside the heredoc. A body piped into anything else (grep, tee alone, python3 -) stays data. server-synchronous and cleanroom-module-pure apply. Update docs/cleanroom.md's heredoc paragraph sentence on shell-read bodies to name the pipe case, and extend the existing A-02 CHANGELOG Fixed line.
**Acceptance tests:** guard-cases.json, policy template, cwd __ROOT__. Denied with reason 'protected path: .*': `cat <<EOF | bash` NL `rm -rf .kukulu/cleanroom` NL `EOF`; `cat <<'EOF' | sh` NL `rm -rf .kukulu/cleanroom` NL `EOF`; `cat <<EOF |& bash` NL `rm -rf .kukulu/cleanroom` NL `EOF`; `cat <<EOF | tee x | bash` NL `rm -rf .kukulu/cleanroom` NL `EOF` (each allowed at HEAD bb2fe81, denied at 36df873). Allowed: `cat <<'EOF' | grep x` NL `{"priorArt": ["~/.cargo/registry/", "~/.cargo/git/"]}` NL `EOF`; `cat <<EOF | bash -c 'echo hi'` NL `rm -rf .kukulu/cleanroom` NL `EOF` (bash -c does not read stdin as a script). test/cleanroom.mjs: one stripHeredocs assertion that `cat <<EOF | bash\nrm x\nEOF` yields one body with shell true and `cat <<EOF | grep x\nrm x\nEOF` one with shell false.
**Out of scope:** The second reading (R6-03), the !( handling, any other region or quoting change, and the known-gap ANSI-C $'\'' case.
**Verification:** node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json && node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json; npm test -- cleanroom; kukulu_verify ok. The reviewer will mutate the pipe clause out and expect the four (R6-02) denials to fail.
**Depends on:** none

### R6-03: Guard: read every heredoc command twice, denying when either reading denies (SPEC A-02 Two readings)

**Goal:** Implement SPEC A-02's 'Two readings, denied when either denies' (owner edit 4937aa4): the first reading is today's stripHeredocs with the closed list of non-operator regions; the second treats every unquoted << that is not <<< and has a delimiter word as an operator wherever it sits (no listed region skipped, a digits-only delimiter counts); each reading's bodies are judged by the body rules (R6-02's pipe case included), and the command is denied when either denies, with the first denying reading's reason. Also align list rule 6: the first reading copies a command-position !( through like ?(, *(, +(, @(, and the second reading reads it as a subshell, replacing R5-01's negated marking. Closes `cat <<1 > x.txt` NL `it's` NL `1` NL `rm -rf .kukulu/cleanroom`, allowed at HEAD though bash runs the rm.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** Follow CLAUDE.md's 'Changing a guard rule' protocol: new fixture names end in ' (R6-03)'; append with a script (indent=1, no ASCII escaping); no existing fixture changes its expect or reason, and every R4-01 and R5-01 fixture keeps its verdict; if the second reading would flip an existing fixture, block the task naming it instead of changing it. The second reading runs only when the first reading skipped a << (a listed region held one, or the digits-only rule applied); otherwise the readings are identical and run once. Quotes and backslash escapes apply the same way in both readings. Remove the negated list and its shell clause from stripHeredocs; commandPosition stays for rule 5's [[. The 50 ms hook budget test in test/cleanroom.mjs must still pass. server-synchronous and cleanroom-module-pure apply (no async/await even in comments). Rewrite docs/cleanroom.md's heredoc paragraph to state the closed list, the !( rule as SPEC rule 6 words it, and the two readings; extend the A-02 CHANGELOG Fixed line.
**Acceptance tests:** guard-cases.json, policy template, cwd __ROOT__. Denied with reason 'protected path: .*': `cat <<1 > x.txt` NL `it's` NL `1` NL `rm -rf .kukulu/cleanroom`; `x=$(!(cat <<EOF` NL `it's` NL `EOF` NL `rm -rf .kukulu/cleanroom` NL `: ')'` NL `))`; `echo $((1<<y))` NL `rm -rf .kukulu/cleanroom`. Allowed: `[[ a =~ (x<<y) ]] && echo ok`; `echo $((1<<3))`; `!(cat <<EOF` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `)` (body is data under both readings once the negated marking is gone). All SPEC A-02 required fixtures exist after this task (each under its own name if an equivalent command already exists). test/cleanroom.mjs: one assertion through the exported reading function(s) that the second reading of `cat <<1 > x.txt\nit's\n1\nrm x` yields a body `it's` while the first yields none, and that a command with no skipped << runs only one reading.
**Out of scope:** Changing the closed list itself (only SPEC edits change it), splitRaw's quoting, ANSI-C $'\'' handling, interpreter bodies, and the advisory survivors in conditionalEnd, expansionEnd, assignmentEnd and backtickEnd.
**Verification:** node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json && node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json; npm test -- cleanroom; kukulu_verify ok. The reviewer will mutate the second reading off (expecting the digits and !( apostrophe fixtures to fail) and run the round-5 REVIEW table forms through HEAD's evaluate and real bash.
**Depends on:** R6-02

## Review fixes (round 7)

### R7-01: Guard: a heredoc pipeline into a shell continues past the operator's line and through ( ) and { } grouping

**Goal:** SPEC A-02 Judgment of a body, pipe case: a body is judged as commands when its owning segment pipes (| or |&) into a later segment of the same pipeline whose command word is sh, bash, zsh, dash or ksh with no -c. pipesIntoShell scans only the operator's own line, so these forms, denied at the merge base 36df873 and run by bash, are allowed at HEAD: `cat <<EOF |` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `bash`; `cat <<EOF \` NL `| bash` NL `rm -rf .kukulu/cleanroom` NL `EOF`; `cat <<EOF | (bash)` NL `rm -rf .kukulu/cleanroom` NL `EOF`; `cat <<EOF | { bash; }` NL `rm -rf .kukulu/cleanroom` NL `EOF`.
**Files touched:** mcp/cleanroom.mjs, test/fixtures/guard-cases.json, test/cleanroom.mjs, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** Follow CLAUDE.md's 'Changing a guard rule' protocol: new fixture names end in ' (R7-01)'; append with a script (indent=1, no ASCII escaping); no existing fixture changes its expect or reason. Pipeline membership is decided over the whole pipeline: a backslash-newline is a blank; a | or |& that ends the operator's line (trailing blanks skipped) continues the pipeline on the first line after the last body that line opened; each later stage's command word is taken after the same grouping strip bashReading applies (stripGrouping), then commandWord as now (wrappers and basenames). The pipeline still ends at the first unquoted ;, &&, || or &, or at a newline that does not follow a |. Both readings use the same rule. Do not add `.`/`source`, `bash -c bash` or any other new shell-read case (spec issues for the owner). server-synchronous and cleanroom-module-pure apply. Update docs/cleanroom.md's heredoc paragraph (drop 'or newline' as the pipeline end where a | continues it) and extend the A-02 CHANGELOG Fixed line.
**Acceptance tests:** guard-cases.json, policy template, cwd __ROOT__. Denied with reason 'protected path: .*': the four forms in the goal. Allowed: `cat <<'EOF' |` NL `{"priorArt": ["~/.cargo/registry/", "~/.cargo/git/"]}` NL `EOF` NL `grep x`; the existing `cat <<'EOF' | grep x` and `cat <<EOF | bash -c 'echo hi'` (R6-02) fixtures stay allowed. test/cleanroom.mjs: one stripHeredocs assertion that `cat <<EOF |\nrm x\nEOF\nbash` yields one body with shell true and `cat <<EOF |\nrm x\nEOF\ngrep x` one with shell false.
**Out of scope:** The two-readings design and the SPEC issue about invented operators swallowing a real one (owner decision); `.`/`source` of stdin; a -c string that runs a shell; any region-list change; ANSI-C quoting.
**Verification:** node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json && node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json; npm test -- cleanroom; kukulu_verify ok. The reviewer will run the four forms through HEAD's evaluate and real bash, and mutate the continuation and grouping clauses expecting the (R7-01) denials to fail.
**Depends on:** none
