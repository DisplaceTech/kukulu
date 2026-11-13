# Kūkulu 0.8.1 — Specification

Version: 0.8.1 Status: draft for owner review

The Kūkulu planner reads this file in full and derives the build plan from it. The 0.8.0 spec is archived unchanged at [flights/v0-8-0/SPEC.md](flights/v0-8-0/SPEC.md), and the 0.7.2 spec at [flights/v0-7-2/SPEC.md](flights/v0-7-2/SPEC.md); ids written `0.8.0 E-01` or `0.7.2 D-02` refer to them. The plugin running this flight is the installed 0.8.0. The flight edits the working tree, and nothing it changes affects the server running the flight. This repository has no `docs/cleanroom.json`, so the clean-room guard bugs this release fixes do not fire during the flight.

This is a patch release with no new tools. It clears the friction from the first two real clean-room flights on 0.8.0 (project-g, 2026-11-10 and 2026-11-11). Several fixes:

- **The guard.** It stops calling every `sed` a write, and it reads a heredoc body as data instead of as commands.
- **Long tool calls.** Calls of an hour or more stop dying at Claude Code's 30-minute idle limit.
- **After the flight.** A finished flight stops re-arming its own clean-room log. `kukulu_release` reads the merged flight from origin instead of from a possibly stale local branch.
- **`finalize`.** It defaults to marking the PR ready, and the owner can set it once for every project.
- **Similarity scoring.** It accepts one control band per language pairing.
- **The verifier.** It stops reporting an alias as a model mismatch.

The work that makes Kūkulu run under OpenCode is 0.9.0's, in a flight of its own (§2).

## Recommendation on size

One flight (`flight=v0-8-1`), four phases, all serial. Each requirement names its function, its refusal text and its tests. 0.7.1 principle 1 (the guard is a tripwire) carries over unchanged as principle 1 below. A guard finding outside A-01 and A-02 is a known-gap candidate, not a fix task.

## 1. Overview

Kūkulu is a Claude Code plugin. A dependency-free MCP server (`mcp/server.mjs`) holds the mechanics, and the skills (`skills/*/SKILL.md`) hold the judgment. Release 0.8.1 closes the 21 items in `docs/feedback/2026-11-11-project-g.md`. The masthead flight of 2026-11-10 logged no feedback (its SUMMARY records `feedbackCount` 0), so it contributes nothing.

Done means:

- every requirement in §6 has its tests;
- `npm run lint`, `pre-commit run --all-files`, `npm test`, `npm run check:site` and the guard self-test pass;
- the version reads 0.8.1 everywhere;
- a draft PR is open against `main`.

**Why a patch version.** No tool is added or removed, and no tool's input schema loses or renames a field. These change for someone upgrading:

- **The guard.** A `sed` that does not edit in place is judged as a read (A-01). A heredoc body is data, except when a shell reads it as a script (A-02). The first loosens a false positive. The second loosens false positives and closes one hole.
- **Defaults.** `policies.finalize` defaults to `"ready"`, so finalize no longer enables auto-merge unless someone asks for it (D-01). This is an owner decision.
- **New optional keys.** The global file, and each profile in it, may carry `policies` (D-02). A similarity pair may carry `group` (E-01). The plugin's `.mcp.json` sets a per-server `timeout` (B-01).
- **New refusals.** A command timeout at or above that limit (B-02). A flight slug that an archive already uses (C-03). A `cargo test` targeted command with `{filter}` before `--` (F-04).
- **Loosened.** `kukulu_release` no longer needs the base branch checked out (C-02).

The CHANGELOG lists these under Added, Changed and Fixed, with no "Breaking changes" heading.

**Patent note.** Nothing in this release goes beyond U.S. Provisional Application No. 64/178,095, so no section carries a NEW MATTER marker. Write "patent pending", never "patented".

## 2. Goals and non-goals

- Goal: a `sed` that does not edit in place is never judged a write (A-01).
- Goal: a heredoc's body is not split into commands unless a shell reads it, and an apostrophe in a body no longer hides the commands after it (A-02).
- Goal: a tool call that runs a long command is not aborted by Claude Code's idle timeout (B-01), and a command timeout the client would cut short is refused when the config loads (B-02).
- Goal: after a flight is archived, no clean-room genesis is written until the next flight begins (C-01).
- Goal: `kukulu_release` releases the flight that origin's base branch says was archived last, from any branch, and reports what it did to the local base (C-02).
- Goal: a flight slug that collides with an archive is refused at plan time, not at archive time (C-03).
- Goal: `policies.finalize` defaults to `"ready"` (D-01), and every policy can be set in the global file or a profile (D-02).
- Goal: similarity pairs can be grouped, with one negative and one positive per group (E-01).
- Goal: the verifier treats a model alias and the ids it resolves to as the same model (E-02).
- Goal: `kukulu_next` hands go-flight the Agent call's `description` (F-01).
- Goal: the implementer sees its own task's log, so an unblock reason reaches it (F-02).
- Goal: the reviewer has a sanctioned move when the only open item is blocked on the owner (F-03).
- Goal: a `cargo test` targeted command that cannot take a list filter is refused (F-04).
- Non-goal: running under OpenCode, and OpenRouter as a model source. That is 0.9.0, a flight of its own, with OpenCode as the driver and its own fake-harness tests. Claude Code stays the primary harness.
- Non-goal: MCP progress notifications. Claude Code's docs do not say whether it sends a `progressToken`, and B-01 covers the timeout without one. The transport work belongs with 0.9.0's second harness.
- Non-goal: G-11 to G-14 of the owner's strategy notes, and the 0.8.0 REVIEW's open spec issues. They belong to 0.9.0.
- Non-goal: background jobs for long verify commands (cleanflate F-13, F-28). Still deferred.
- Non-goal: any change under `site/` or `docs/site/`.

## 3. Engineering principles

Each is checkable by grep or test. Those marked `[rule:<id>]` are `constraints` in `docs/kukulu.json`. The rest are checked by the reviewer, by reading.

1. **The guard is a tripwire, not a sandbox.** This is 0.7.1 principle 1, carried over as written, with its triage rule. A guard finding becomes a fix task only when it is one of these:
   - a regression;
   - a protected-path write, or a read under `deny.paths`, using a command word and option spelling that these rules or the fixture set already name;
   - a whole command word missing from a rule.

   Every other unmodelled spelling goes under REVIEW.md's `## Spec issues` → `Known-gap candidates`, and the summarizer carries it into SUMMARY.md.
2. **Mechanics live in the server, judgment in the skills.** The Agent call's description, the task's own log, the slug collision, the cargo filter shape and the timeout limit are server changes with tests, never skill sentences alone.
3. **Every server behavior change has a test** in the suite that owns the tool (CONTRIBUTING.md's table). If no row names the tool, the task adds the row (`kukulu_release` and `kukulu_similarity` have none today). Every new refusal has a test that triggers it and asserts its message. Every guard change has deny and allow cases in `test/fixtures/guard-cases.json`, with names ending in `(<task id>)`.
4. **Tools validate, then mutate.** A refusal comes before any file is written, and a tool whose final commit fails leaves the tree as it found it.
5. **Config never silently defaults a bad value.** Global and profile `policies`, a pair's `group`, and the cargo filter shape are validated with refusals for every bad shape, and the unknown-key refusals stay.
6. **No guard fixture changes its decision unless a task names it.** A task may add fixtures. It may change an existing fixture's `expect` or `reason` only when §6 names that fixture's form, and the commit body lists every one it changed. The reviewer checks with `git diff <merge-base>..HEAD -- test/fixtures/guard-cases.json`.
7. **Every constraint in `docs/flights/v0-8-0/kukulu.json` carries over unchanged.** One is added (§5.4).
8. **Documentation moves with the code.**
   - A task that changes a tool's behavior updates `docs/mcp-tools.md` in the same commit.
   - A task that changes a guard rule updates `docs/cleanroom.md`.
   - A task that adds or changes a config key or default updates `docs/operations.md`.
9. **Error messages are written for a model**: say what is wrong and what to do instead. Comments explain why.
10. **No dependencies anywhere**, and tests never depend on an untracked file. Recorded `gh` and git output lives in `test/fixtures/`, never inline in a `test/*.mjs`.
11. **The duplicated verifier code stays duplicated.** E-02's model comparison goes into both `mcp/cleanroom.mjs` and `scripts/verify-attestation.mjs`. `test/attest.mjs` feeds both copies the same inputs and asserts identical results, as it does for `KNOWN_LIMITS`.

## 4. Architecture

No module is added. These are the changes, by module:

| Path | Changes |
|---|---|
| `mcp/cleanroom.mjs` | `sed` in place only (A-01); heredoc bodies in `splitSegments` and `evaluate` (A-02); the `indirect` known-limit text (A-01); `sameModel` (E-02); `position`'s callers by group (E-01) |
| `mcp/server.mjs` | `mcpTimeoutMs`, the command-timeout refusal, `longestCommandTimeoutMs` (B-01, B-02); `next`'s order (C-01, F-01); `release` (C-02); `planCommit` (C-03); `cfgFrom`, `validatePolicies`, `loadGlobalConfig`, `resolveRouting`, `configShow`, `finalizeConfig` (D-01, D-02); `validateSimilarity`, `normalizeSimilarity`, `similarity`, `verifyControlBundle` (E-01); `taskNext` (F-02); `validateMutation` (F-04) |
| `scripts/verify-attestation.mjs` | `sameModel`, duplicated (E-02) |
| `scripts/compare-bundles.mjs` | per-group scores (E-01) |
| `.mcp.json` | `"timeout"` (B-01) |
| `agents/reviewer.md` | `kukulu_run_halt` on its `tools:` line (F-03) |
| `skills/go-flight/SKILL.md`, `skills/implement/SKILL.md`, `skills/review-build/SKILL.md`, `skills/plan-build/SKILL.md`, `templates/SPEC.md` | F-01 to F-04, C-03 |
| `test/fixtures/guard-cases.json` | new cases (A-01, A-02) |
| `docs/cleanroom.md`, `docs/mcp-tools.md`, `docs/operations.md`, `docs/writing-specs.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | as each requirement says |

`run-command.mjs`, the hooks, the sandbox scripts and the relay do not change.

## 5. Data and configuration

### 5.1 `docs/kukulu.json`

| Key | Type | Default | Notes |
|---|---|---|---|
| `policies.finalize` | `"auto"` \| `"ready"` \| `"draft"` | `"ready"` (was `"auto"`) | D-01. Owner decision of 2026-11-11, not an ⚠️ ASSUMPTION. Written only in `cfgFrom`. |
| `cleanroom.similarity.pairs[].group` | slug | none (the implicit group `default`) | E-01 |

`baseBranch` for this flight is `main`, and build branches are `build/<date>`. This flight's own `docs/kukulu.json` sets `policies` to `{ "archive": true, "finalize": "ready" }`, because the running 0.8.0 server still defaults `finalize` to `"auto"`.

### 5.2 The global file (`~/.config/kukulu/config.json`)

`GLOBAL_KEYS` gains `policies`, and a profile under `profiles.<name>` may carry `policies` beside its roles (D-02). Both take every key `validatePolicies` accepts, with the same values.

### 5.3 The plugin's `.mcp.json`

The `kukulu` server entry gains `"timeout": 86400000` (B-01).

### 5.4 Constraints

The constraints in `docs/flights/v0-8-0/kukulu.json` carry over unchanged (principle 7). One is added:

- `no-hardcoded-mcp-timeout`: `86400000` appears in `.mcp.json` only. The server reads the value from that file (B-02), and the tests read it from there too.

### 5.5 Tunables

| Value | Where | Status |
|---|---|---|
| The per-server MCP timeout: 86400000 ms (24 h) | `.mcp.json` only | ⚠️ ASSUMPTION. It must sit above the longest command a project runs, which was 75 minutes for project-g's fuzz run, doubled for `kukulu_mutate`'s confirmation re-run. It must also sit below Claude Code's default wall clock, about 28 h. |

The remaining ⚠️ ASSUMPTION defaults from 0.8.0 stay where they are, unchanged.

## 6. Interfaces

### A — The guard

#### A-01 — `sed` is a write only in place (project-g F-01, F-03, F-04, F-06, F-09, F-11, F-15)

`sed` is in both `READ_FAMILY` and `WRITE_FAMILY` (`mcp/cleanroom.mjs:807-810`). The write rule (6d) judges every non-option operand of a write-family command as a write target, the script included. So:

- `sed -n 480p .kukulu/cleanroom/log.jsonl` is denied as a write to the log;
- `sed -n 1p .mcp.json` is denied, as is every read-only `sed` of any protected file;
- with cwd at the plugin root, `sed -n 2910,2990p mcp/server.mjs` is denied as `protected path: <plugin root>/2910,2990p`, because the plugin root is protected.

Seven of the 21 items are this one bug, across planner and reviewer, in both flights.

The change: a `sed` segment is a write-family command only when it edits in place. It edits in place when an option token, before the first operand or between operands, is one of these:

- `-i`;
- `-i<suffix>`;
- `--in-place` or `--in-place=<suffix>`;
- a short-option cluster (one `-`, then letters only) that contains `i`, such as `-ni`, `-Ei` or `-ie`.

The values of `-e`, `--expression`, `-f`, `--file`, `-l` and `--line-length` are not option tokens for this test. After a bare `-i`, an empty-string token is BSD sed's suffix, not an operand.

- **In place:** the write targets are the file operands only. They exclude the script that `patternOperands` already marks, and the values of the options above. The reason text is unchanged (`protected path: <abs path>`).
- **Not in place:** the 6d write rule does not apply. The read rules (6b, 6c) judge the segment as they judge `grep`, as they already do.

`sed` stays in both family lists, so `test/cleanroom.mjs`'s assertion on `WRITE_FAMILY`'s exact contents still holds.

`sed`'s `w` and `W` commands and the `s///w` flag write a file that no operand names. Today they are not caught either: the script token never resolves to a protected prefix. They become a known gap. `KNOWN_LIMITS`' `indirect` entry text gains "sed's `w` command" next to `perl -i`, in both copies, and the `docs/cleanroom.md` known-gaps row changes to match. The entry count stays twelve.

`docs/cleanroom.md`'s write-family sentence says that `sed` counts only in place.

Required fixtures:

- denied:
  - `sed -i 1d .kukulu/cleanroom/log.jsonl`
  - `sed -ni 1p docs/cleanroom.json`
  - `sed --in-place=.bak s/a/b/ .mcp.json`
  - `sed -i.bak s/a/b/ .mcp.json`
  - `sed -Ei s/a/b/ .mcp.json`
  - `sed -e s/a/b/ -i .mcp.json`
  - `sed -i '' s/a/b/ .mcp.json`
- allowed:
  - `sed -n 480p .kukulu/cleanroom/log.jsonl`
  - `sed -n 1p .mcp.json`
  - `sed -n 2910,2990p mcp/server.mjs` with cwd at the plugin root the fixture environment uses (reached by a `cd` in the same command)
  - `sed -n -e 1p -e 2p docs/cleanroom.json`
  - `sed -i s/a/b/ src/a.rs`

The existing fixture `sed script over a deny.paths file is denied` stays denied (rule 6b). No existing fixture changes its decision. All three existing `-i` fixtures stay denied.

#### A-02 — heredoc bodies (project-g F-11)

The guard has no heredoc handling. `splitSegments` cuts on every unquoted newline, so each line of a heredoc body becomes a segment of its own: its first word is judged as a command, and the rest as its arguments. Two consequences:

- **False positives.** A planner's `cat > docs/kukulu.json <<'EOF'` whose body lists the policy's prior-art paths is denied when a `deny.paths` path lands in an argument position. For example, the second item of a JSON array, `"~/.cargo/git/"]`, is judged as a path under `deny.paths`. Whether a body line is denied depends on its JSON layout.
- **A hole.** An apostrophe in an unquoted-delimiter body (`it's`) opens a quote in `splitSegments`, and line splitting stops until the next `'`. So `cat <<EOF > x.txt`, then `it's fine`, `EOF`, `rm -rf .kukulu/cleanroom` is allowed today, while the same command without the apostrophe is denied. That is a protected-path write with a command word the rules name, so principle 1 makes it a fix.

The change: `splitSegments` recognizes a heredoc and keeps its body out of the segment list.

- **The operator.** An unquoted `<<` that is not `<<<` (here-strings do not change), followed by an optional `-`, optional blanks, and a delimiter word. The word is written bare, `'word'`, `"word"` or `\word`, or quoted in any part (`E'OF'`). The delimiter is the word after quote removal, and the body counts as quoted when any part of the word was quoted. A `<<` in one of the regions listed under "Where `<<` is not an operator" is not an operator in the first reading (see "Two readings").
- **The body.** It starts on the line after the one holding the operator. Two heredocs on one line read their bodies in order. A body ends at the first line equal to the word, after leading tabs are stripped for `<<-`. Quotes inside a body never affect splitting.
- **An unterminated heredoc.** Its body runs to the end of the command.
- **After the body.** Splitting resumes on the line after the delimiter.

Where `<<` is not an operator. This is a closed list. Outside quotes, the first reading copies each region below through without looking for `<<`, and the region's own position rule decides whether it applies. A `<<` anywhere else is an operator.

1. **Arithmetic:** `$((…))`, and `((…))`.
2. **Parameter and legacy arithmetic expansion:** `${…}` and `$[…]`.
3. **Array assignments, at a word start:** the subscript of `name[…]=` or `name[…]+=`, and the list of `name=(…)` or `name+=(…)`.
4. **A backtick span.**
5. **A `[[ … ]]` conditional, in command position only.** Command position means one of these, with blanks skipped:
   - the start of the command;
   - after a newline, `;`, `&`, `|`, `(` or `{`;
   - after one of the reserved words `if`, `then`, `else`, `elif`, `while`, `until`, `do`, `time` or `!`, as a whole word.

   Anywhere else `[[` is an ordinary word (`echo [[ <<EOF` holds a real heredoc).
6. **An extglob group:** `?(`, `*(`, `+(`, `@(` or `!(`, through its matching `)`. In command position, `!(` is ambiguous. With `extglob` off (bash's default) it is `!` and a subshell, so a heredoc inside it is real. With `extglob` on it is a pattern word. The guard cannot see `shopt`, so the first reading copies `!(` through (the pattern reading) and the second reading reads it as a subshell. No other handling is required.
7. **A comment:** an unquoted `#` at a word start, to the end of the line.
8. **Not operators anywhere:** `<<<`, and a `<<` followed by no delimiter word. In the first reading only, a delimiter of digits only (`1<<3`) is also not an operator.

Two readings, denied when either denies. A region the first reading gets wrong can only hide an operator. Hiding a real operator exposes its body to the splitter, and an apostrophe in the body then hides the commands after it. That is the hole this requirement closes. Rounds 1 to 5 of the 0.8.1 review each found one more such region. So the guard reads every command twice:

- **First reading:** the closed list above applies.
- **Second reading:** every unquoted `<<` that is not `<<<` and has a delimiter word is an operator, wherever it sits. No region of the list is skipped, and a digits-only delimiter counts. Quotes and backslash escapes apply as in the first reading.
- Each reading's bodies are judged by the body rules below, with one exception. In the second reading, the body of an operator that the first reading skipped is judged as commands, as a shell-read body is, never as data. The command is denied when either reading denies, with the first denying reading's reason.
- The second reading runs only when the first reading skipped a `<<` (a listed region held one, or rule 8's digits case applied). Otherwise the two readings are identical. The 50 ms hook budget in `test/cleanroom.mjs` still holds.

This is why the pair is safe. The second reading never hides a real operator. An operator it invents gets a body, and that body is judged as commands, so nothing after it becomes data. Without that exception, an invented operator's unterminated body would swallow a later real heredoc as data, while the first reading hid that heredoc (round 7's `echo $((1<<3))` / `cat <<1 > x.txt` / `it's` / `1` / `rm -rf .kukulu/cleanroom`). A hole now needs both readings to be wrong about the same `<<`.

Triage for this requirement. Principle 1 still applies, and a heredoc finding becomes a fix task only when all three of these hold:

- the command is allowed under both readings;
- it writes a protected path, or reads a path under `deny.paths`;
- real bash runs that write or read.

Everything else is a known-gap candidate:

- an over-denial, whichever reading produces it;
- a region missing from the list, or a region with the wrong boundary;
- a construct that is a syntax error in bash.

The closed list changes only by an edit to this spec.

Judgment of a body:

- **Data, by default.** A body is not judged as commands or as arguments. The owning segment's own words and redirections are judged as today, so `cat <<EOF > docs/cleanroom.json` is still denied by its redirection.
- **A shell reads it as a script** in either of two cases. Then each body line is split and judged as commands, as if written after the segment.
  - The owning segment's command word is `sh`, `bash`, `zsh`, `dash` or `ksh` and the segment has no `-c`.
  - The owning segment pipes (`|` or `|&`) into a later segment of the same pipeline whose command word is one of those shells, with no `-c`: `cat <<EOF | bash`.

  The pipe case is a regression fix. At the merge base, with no heredoc handling, every body line was judged as a command, so `cat <<EOF | bash` / `rm -rf .kukulu/cleanroom` / `EOF` was denied. The first A-02 implementation reads it as data and allows it.
- **Substitutions in an unquoted-delimiter body.** The `$(…)` and backtick bodies are still extracted and judged, as `extractSubstitutions` does today, because the shell expands them. A quoted delimiter's body has no expansion and is not scanned.
- A body handed to another interpreter (`python3 - <<'EOF'`) is data. It stays under the existing `interpreter` known limit.

`docs/cleanroom.md` gets a heredoc paragraph under the Bash rules.

Required fixtures:

- denied:
  - the apostrophe case above (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`)
  - `bash <<'EOF'` / `rm -rf .kukulu/cleanroom` / `EOF`
  - `cat <<EOF > docs/cleanroom.json` / `{}` / `EOF`
  - `cat <<EOF > out.txt` / `$(cat ~/.cargo/registry/a.rs)` / `EOF`
  - `cat <<EOF | bash` / `rm -rf .kukulu/cleanroom` / `EOF`, and `cat <<'EOF' | sh` with the same body (the pipe case; both denied at the merge base)
  - `cat <<1 > x.txt` / `it's` / `1` / `rm -rf .kukulu/cleanroom` (a digits-only delimiter is real; the second reading)
  - `echo $((1<<3))` / `cat <<1 > x.txt` / `it's` / `1` / `rm -rf .kukulu/cleanroom`, and the same lines after `# a << b` (an invented operator's body is commands)
  - every form in round 5's REVIEW table (`!(cat <<EOF` … and `echo [[ <<EOF` …), each with an apostrophe body
  - `x=$(!(cat <<EOF` / `it's` / `EOF` / `rm -rf .kukulu/cleanroom` / `: ')'` / `))` (allowed at the merge base; the second reading closes it)
  - `shopt -s extglob` / `!(x<<y)` / `rm -rf .kukulu/cleanroom` and `echo $((1<<y))` / `rm -rf .kukulu/cleanroom` (the first reading, which must keep judging the line after a non-operator `<<`)
- allowed:
  - `cat <<'EOF' | grep x` / `{"priorArt": ["~/.cargo/registry/", "~/.cargo/git/"]}` / `EOF` (a pipe into a command that is not a shell carries data)
  - `[[ a =~ (x<<y) ]] && echo ok` and `echo $((1<<3))` (single lines, allowed under both readings)
  - `cat > build/k.json <<'EOF'` / `{"priorArt": ["~/.cargo/registry/", "~/.cargo/git/"]}` / `EOF`
  - `cat <<'EOF' > notes.txt` / `$(rm -rf .kukulu)` / `EOF`
  - `python3 - <<'EOF'` / `print("~/.cargo/git/x")` / `EOF`
  - `cat <<-EOF > build/a.txt` / tab-indented body / tab-indented `EOF` / `echo done`

The existing cleanflate false-positive fixtures with Python heredocs stay allowed. Any existing fixture whose decision changes is listed in the commit body with the reason. A denial may become an allow only when its body is data handed to a non-shell command.

### B — Long tool calls

#### B-01 — the plugin sets its own MCP timeout (project-g F-08, F-12, F-14)

Claude Code aborts a stdio MCP tool call that sends no response and no progress for 30 minutes (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, default 1800000 ms). Kūkulu's server is synchronous and sends no progress, so in project-g:

- a `kukulu_verify` running a 60- or 75-minute fuzz `extraVerify` was aborted twice while the command kept running;
- a targeted `kukulu_mutate` was aborted once, and 30 minutes were lost.

Claude Code's MCP documentation gives a per-server `timeout` (ms, in the server's `.mcp.json` entry). It is that server's wall-clock limit, and it is also a floor under the idle timeout: an idle abort never comes sooner than it.

The change: `.mcp.json`'s `kukulu` entry gains `"timeout": 86400000`. `test/plugin.mjs` asserts that the value is an integer of at least 3600000.

`docs/operations.md` replaces its `MCP_TOOL_TIMEOUT` advice with a "Long tool calls" section covering:

- the idle timeout;
- the per-server floor, and the Claude Code version the docs name for it;
- for an older Claude Code, setting `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` in the operator's `settings.json` `env`;
- that a queued parallel-stream call still waits behind the running one.

The two troubleshooting rows that name `MCP_TOOL_TIMEOUT` change to match. `docs/mcp-tools.md`'s `longestCommandTimeoutMs` row names the plugin's limit instead.

#### B-02 — a command timeout the client would cut short is refused

`mcpTimeoutMs()` reads `timeout` from the `kukulu` entry of `<plugin root>/.mcp.json`, where the plugin root is the server's own directory's parent. It returns `null` when the file, the entry or the field is missing, or when the value is not a positive integer.

When it is not null, the config loader refuses any command whose effective timeout is at or above it. That covers `commandTimeoutMs`, each `verify`, `extraVerify` and `parallel.setup` entry, and each `mutation.targeted` entry:

```text
<where>.timeoutMs <n> is not below the plugin's MCP tool-call limit of <m> ms (.mcp.json "timeout"); Claude Code would abort the call before the command ends. Lower it, or split the command.
```

`<where>` names the key as the existing command refusals do.

- `longestCommandTimeoutMs()` also counts `mutation.targeted`.
- `kukulu_status` gains `mcpTimeoutMs`.

Tests:

- `test/routing.mjs`: each command kind at the limit refuses and one below it loads. A plugin copy without `timeout` gives no refusal and `mcpTimeoutMs: null`. The refusal tests start a temp copy of the plugin whose `.mcp.json` has a small `timeout`, as CLAUDE.md's clean-room tests protocol does for plugin edits.
- `test/state.mjs`: `kukulu_status` reports the value.

### C — After the flight

#### C-01 — no genesis after the archive (project-g F-16, F-17)

`kukulu_next` writes a clean-room genesis whenever the policy file exists and the state has no `cleanroom` record (`mcp/server.mjs:2517`). That happens before it returns "flight … is archived" (`:2525`). The archive leaves `docs/cleanroom.json` in place and writes a fresh state with no `cleanroom` key. So go-flight's `kukulu_next` after the summarize stage writes and commits a new genesis on the finished build branch, and the hooks append to the log from then on. That log is:

- tracked;
- modified after every tool call;
- absent from the base branch.

So:

- `git checkout <base>` refuses ("local changes would be overwritten");
- the guard refuses `git stash` of the log, by design;
- a stash made by hand can never be popped on the base branch (modify/delete).

project-g's operator stashed by hand twice before v0.2.0 released, and those log entries are stranded.

The change: in `next`, the genesis write and the controller gate move below the `halted`, `awaitingSigning` and archived-done returns. A call that ends in one of those three returns writes nothing and commits nothing. A new flight, with its edited `docs/SPEC.md`, gets past the archived-done return, and its genesis is written as today.

Tests in `test/cleanroom.mjs` (the suite that owns genesis):

- After `kukulu_flight_archive` with the policy present, `kukulu_next` returns `done`. HEAD does not move, `.kukulu/cleanroom/log.jsonl` does not exist, and `.kukulu/state.json` is byte-identical.
- A clean-room hook script run after that appends nothing.
- With `docs/SPEC.md` then edited, `kukulu_next` writes the genesis and returns `plan`.
- A halted clean-room run with no genesis yet writes none.

#### C-02 — `kukulu_release` reads the merged flight from origin (project-g F-16, F-17, F-18)

Today `release` reads `.kukulu/state.json` and the archived `PROGRESS.md` from the local tree, before it fetches. It fast-forwards the base with `git merge --ff-only` and ignores a failure. It also requires the base branch checked out, but checks that last. In project-g, local `main` was 76 commits behind origin, so:

- its state named the previous flight's archive;
- the tool resolved that flight's PR #1;
- it refused with "CHANGELOG.md at aa84841 has no numbered entry", which named neither the stale base nor the failed fast-forward.

The new order. Every refusal comes before the tag:

1. Validate `publish`, as today.
2. Resolve `baseBranch` through `finalizeConfig`, which reads the project file, else the archived `kukulu.json`, else the default, plus D-02's layers.
3. `git fetch origin`. A failure refuses: `git fetch origin failed: <first line>; kukulu_release reads the merged flight from origin/<base>, so it needs the remote`.
4. Read `origin/<base>:.kukulu/state.json`, and from it `archived`. With none: `origin/<base> has no archived flight; merge the flight's pull request (it carries the archive) and call kukulu_release again`.
5. Read `Branch:` from `origin/<base>:<archived.dir>/PROGRESS.md`, and the archived signing outcome from `origin/<base>:<archived.dir>/state.json`.
6. Look up the PR and its merge commit, as today.
7. A CHANGELOG at the merge with no numbered entry refuses with: `CHANGELOG.md at <sha7> (the merge of flight <slug>'s PR #<n>) has no numbered entry; add ## [x.y.z] before releasing`.
8. Check the tag and create, sign and push it, then create the release, as today. The tag is made on the merge sha, which needs no checkout, so the "is not checked out" refusal and the ancestor check are removed.
9. Fast-forward the local base, which no longer gates the release:
   - if the checked-out branch is the base and `trackedDirtyLines()` is empty, run `git merge --ff-only origin/<base>`;
   - otherwise skip it.

   The result gains `fastForward`, which is one of `"done"`, `"up to date"`, `"skipped: <base> is not checked out"`, `"skipped: the tree has tracked changes"` or `"failed: <first line>"`.

The result also gains `flight: { slug, dir, from: "origin/<base>" }`. When the local state's `archived.slug` differs, `localState` says, for example, `stale: local main names <old slug>; origin/main names <slug>`. A repeated call still creates only what is missing.

Tests in `test/review.mjs`, with the fake `gh` and a bare origin:

- A local base behind origin, where origin has the new archive: the new flight is released, and `localState` is stale.
- The call made from the build branch: released, with `fastForward` skipped.
- A fetch failure refuses, and nothing is tagged.
- A CHANGELOG with no numbered entry gives the new text.
- A fast-forward that fails is reported, not ignored.

`docs/mcp-tools.md`'s entry and the tool's description change to match.

#### C-03 — a slug collision is refused at plan time (project-g F-10)

The planner's title-derived slug (`plan-build/SKILL.md:137`) matched an existing archive directory. Nothing checks this until `kukulu_flight_archive`, after the whole flight. Then the summarizer prints the refusal and goes on, and the flight stays unarchived.

`kukulu_plan_commit` refuses, before any write, when `docs/flights/<flight>/` exists:

```text
docs/flights/<slug>/ already holds an archived flight; set docs/kukulu.json's flight to an unused slug (for example <slug>-<version digits> or <slug>-2) and call kukulu_plan_commit again
```

The plan-build skill's slug rule gains one sentence: when the derived slug is taken under `docs/flights/`, append the spec's version digits, or failing that `-2`. Tests in `test/state.mjs`: a taken slug refuses with nothing written, and a free one passes. The existing archive-time refusal (`<dir> already exists; choose another slug …`) gets the test it has never had, in `test/review.mjs`.

### D — Policies

#### D-01 — `finalize` defaults to `ready` (project-g F-19)

The run policy said `pr=draft`, yet the default `finalize: "auto"` marked the PR ready and tried auto-merge on a repo that disallows it. That was not what the owner expected of a headless run. `cfgFrom`'s `finalize: c.policies?.finalize ?? "auto"` becomes `?? "ready"`, and it stays the only place the default is written. `DEFAULT_STATE.policies` either drops its stale copy of the policy defaults or takes them from `cfgFrom`, so no second copy can disagree. `"auto"` still works when it is set.

`kukulu_next`'s `Run policies:` sentence names `finalize` and its source (D-02).

Tests:

- `kukulu_config_show` reports `finalize: "ready"` with no `policies` block.
- `kukulu_pr_finalize` with no `policies` block marks the PR ready and runs no `gh pr merge`.
- Every existing test that relied on the old default sets `finalize: "auto"` explicitly.

#### D-02 — policies in the global file and in profiles (project-g F-19)

A project's planner must leave `policies` out of `docs/kukulu.json` unless SPEC asks, and in clean-room mode the guard then protects that file. So an owner has no durable place to set a policy for every flight. The change:

- The global file may carry `policies`, and each `profiles.<name>` may carry `policies` beside its role entries. A profile may hold only `policies`.
- **Validation.** Both are checked by `validatePolicies`, which takes a `where` prefix. Messages name the source, for example `~/.config/kukulu/config.json policies.finalize must be one of auto, ready, draft; got "x"` and `… profiles.fast.policies.push must be a boolean`. The project file's messages are unchanged.
- **Precedence**, per key: default < global < active profile (`KUKULU_PROFILE`, else the global `profile`) < project. `cfg()`, `finalizeConfig()` and `kukulu_run_start`'s resolved `state.policies` all use the layered result.
- **Reporting.** `kukulu_config_show` gains `policies` (resolved) and `policySources`, which maps each key to `"default"`, `"global"`, `"profile:<name>"` or `"project"`. The existing `archive` field stays.

`docs/operations.md`'s configuration section documents the layers with an example that sets `finalize` globally. `test/plugin.mjs`'s "config keys documented" loop covers the global `policies` key.

Tests in `test/routing.mjs`:

- each layer wins over the one below it;
- a profile with only `policies`;
- each bad shape, from each source, refuses with its source named;
- `policySources`;
- `kukulu_pr_finalize` honoring a global `finalize: "draft"`.

### E — Evidence

#### E-01 — grouped similarity pairs (project-g F-10)

A spec asked for two negative and two positive pairs, one band per language pairing: Rust against Rust, and Rust against C. `validateSimilarity` requires exactly one of each (`server.mjs:1032`), and every tool then fails, so the planner dropped the cross-language controls. The LIMITS line on cross-language pairs (`cleanroom.mjs:2539`) is the reason the spec wanted them. Owner decision of 2026-11-11: support it.

- **The key.** A pair may carry `group`, a slug (`PAIR_ID`). A pair without one belongs to the group `default`.
- **Validation per group:** exactly one `negative`, exactly one `positive` and at least one `test`. When no pair names a group, today's refusal texts stand unchanged. Otherwise they read `cleanroom.similarity.pairs group "<g>" needs exactly one pair with role "negative" (found <n>)`, and the same for `positive`, with `needs at least one pair with role "test"` for tests. A bad `group` refuses: `cleanroom.similarity.pairs[<i>].group must be a slug (letters, digits and -); got <what>`.
- **Scoring.** Each test pair is positioned against its own group's negative and positive. Rows gain `group`. `verdictOf` is unchanged, because pair ids are unique.
- **Controls.** `control` stays legal only on a positive pair, and `verifyControlBundle` checks every positive pair that has one.
- **Outputs.**
  - `SIMILARITY.md` names each group's negative and positive on its own line, and its raw-scores table gains a group column when groups are used.
  - `similarity.json` keeps `config` as given, groups included.
  - `scripts/compare-bundles.mjs` keys its per-role scores by group, and reads a bundle without groups as the `default` group.
  - The verifier, which only hashes `similarity.json`, does not change.

`docs/operations.md` (the "exactly one negative" sentence) and `docs/writing-specs.md` describe groups.

Tests:

- `test/cleanroom.mjs`, the validator: each refusal; no groups keeps the old texts.
- `test/cleanroom.mjs`, scoring: two groups, where a test in group `rust-c` is positioned against that group's bands and not the other's; a config without groups gives byte-identical rows apart from `group: "default"`.
- `test/bundles.mjs`: comparing a grouped and an ungrouped bundle.

#### E-02 — an alias is the model it resolves to (project-g F-20)

Verifier check 12 compares the declared and reported models as strings (`scripts/verify-attestation.mjs:413`). So a role routed as `sonnet` that reports `claude-sonnet-5-5` gets the note `implementer: the endpoint reported claude-sonnet-5-5; routing declared sonnet`. The owner confirms that this routing is intended. `familyOf` is too coarse to fix it, since it maps every Claude id to `claude`.

`sameModel(declared, reported)` goes into `mcp/cleanroom.mjs`, exported, and is duplicated in the verifier. After `normalizeModel` on both, the two are the same model when any of these holds:

- they are equal;
- `declared` is `opus`, `sonnet`, `haiku` or `fable`, and `reported` starts with `claude-<declared>-`;
- `declared` is `inherit` and `reported` starts with `claude-`;
- `reported` is `declared` followed by `-` and eight digits (a dated id).

Check 12 emits its note, with the text unchanged, only for a reported model that is not `sameModel`. Tests in `test/attest.mjs`:

- both copies give identical answers on a shared table of pairs;
- the alias case gives no note;
- `sonnet` against `claude-opus-5-5` still gives the note, with the existing pinned text.

### F — Stage handoffs

#### F-01 — `kukulu_next` supplies the Agent call's description (project-g F-21)

go-flight says the `Agent` tool takes `subagent_type`, `prompt` and optionally `model` (`skills/go-flight/SKILL.md:42`). The tool also requires `description`, so the first stage spawn failed with `InputValidationError`.

`kukulu_next`'s result gains `description` whenever it returns a stage to spawn, and each `streams[]` entry gains one:

- `Kūkulu <stage>`, for example `Kūkulu plan`;
- `Kūkulu <stage> round <n>` from round 1 on;
- `Kūkulu stream <name>` for a stream entry.

Each is at most 60 characters. In server source the macron letter is written as the Unicode escape of U+016B (backslash, `u`, `016b`), never the literal character.

go-flight's sentence lists `subagent_type`, `description`, `prompt` and optionally `model`. Each step that calls `Agent` (step 4, the parallel wave, the fallback retry) passes `description` verbatim. Tests:

- `test/state.mjs`: the field for each spawnable stage and for streams;
- `test/plugin.mjs`: the skill names `description`.

The second half of F-21, that pull-feedback must read archived logs, is already true of 0.8.0's pull-feedback, which read all three of project-g's logs.

#### F-02 — the implementer sees its own task's log (project-g F-02)

`kukulu_review_submit`'s `unblock` writes its reason only to PROGRESS.md's log. `kukulu_task_next` returns the task's PLAN.md text and its dependencies' logs, never the task's own (`taskNext`, `server.mjs:2982`). In project-g, PLAN.md's P1-10 still said that a missing `usingDict` blocks, while the unblock reason said to build without it. The implementer did the forbidden thing, re-blocked within a minute, and 17 reopened tasks were skipped again, which cost a whole round.

- `kukulu_task_next`'s result gains `taskLog`: the task's own log entries, in the shape `dependencyLogs` uses, or `null` when there are none. The tool's description says so.
- The implement skill says: read `taskLog` before acting. The newest `unblocked` or `REOPENED` entry's reason overrides the PLAN.md text where the two disagree.
- The review-build skill says an unblock reason must state the concrete instruction, because it now reaches the implementer verbatim.

Tests in `test/implement.mjs`: an unblocked task's `taskLog` carries the reason, a fresh task's is `null`, and a reopened task's carries `REOPENED`.

#### F-03 — an owner-only block halts for the owner (project-g F-07)

When the only open item is a task blocked on something only the owner can do, the reviewer has no sanctioned verdict. The skill forbids APPROVED while a task is blocked, the server refuses CHANGES REQUESTED with no task and no unblock, and the reviewer has no halt.

- `agents/reviewer.md`'s `tools:` line gains `mcp__plugin_kukulu_kukulu__kukulu_run_halt`.
- The review-build skill gains one rule. When categories 1–3 are clean across the branch and every remaining open item is a task whose blocker only the owner can clear, the reviewer:
  - calls `kukulu_run_halt` with `owner action needed: <task id>: <what the owner must do>`;
  - stops, without submitting a verdict.

  After the owner acts and calls `kukulu_run_resume`, the next review unblocks the task with the owner's answer.
- `kukulu_review_submit` does not change.

Tests in `test/plugin.mjs`: the reviewer's tool line, and the skill sentence. `test/state.mjs`: a halt made during the review stage resumes into review.

#### F-04 — a `cargo test` filter goes after `--` (project-g F-05, F-13)

project-g's targeted command `cargo test --workspace {filter}` received a list filter as `'a' 'b'`. `cargo test` takes one TESTNAME, so every list filter failed with "unexpected argument" and was reported inconclusive. That cost two mutation runs in two flights. libtest, behind `--`, takes several filters.

`validateMutation` refuses a `mutation.targeted` entry whose command runs `cargo test` (the words `cargo`, then `test`, possibly with options between them) with `{filter}` before a standalone `--`:

```text
mutation.targeted.<name>.cmd runs cargo test with {filter} before --; cargo test takes one TESTNAME, so a list filter fails. Write it as "cargo test <options> -- {filter}"
```

The plan-build skill's `mutation.targeted` sentence and `templates/SPEC.md` give the cargo form beside the phpunit one. Tests in `test/routing.mjs`: the refusal, and `cargo test --workspace -- {filter}` loading.

### G — Documentation and release

- `docs/mcp-tools.md`:
  - `kukulu_next` (C-01, D-01, F-01);
  - `kukulu_task_next` (F-02);
  - `kukulu_release` (C-02);
  - `kukulu_plan_commit` (C-03);
  - `kukulu_config_show` (D-02);
  - `kukulu_status` (B-02);
  - `kukulu_similarity` (E-01).

  Its first line still reads "Twenty-six tools".
- `docs/operations.md`: B-01's section and rows, the `finalize` default, D-02's layers, and E-01's groups.
- `docs/cleanroom.md`: A-01, A-02 and the `indirect` known-gap row.
- `docs/writing-specs.md`: E-01.
- `README.md`: the `finalize` default and the global policies, wherever a sentence states either. The tool count is unchanged.
- `CONTRIBUTING.md`: suite-table rows for `kukulu_release` (`review`) and `kukulu_similarity` (`cleanroom`).
- `CHANGELOG.md`: `## [0.8.1] — <date>`, renamed from `## [Unreleased]` by the release task; the first task creates `## [Unreleased]` above `## [0.8.0] — 2026-10-27`. Items go under Added, Changed and Fixed, each citing its feedback item (`project-g F-19`). There is no "Breaking changes" heading.
- The version reads `0.8.1` in `package.json`, `.claude-plugin/plugin.json` and `VERSION` in `mcp/server.mjs`.
- `docs/feedback/2026-11-11-project-g.md` gets an "Addressed in" header line pointing at this spec. It is local and gitignored, so the task edits it only if it exists, edits only the header, and never stages it. No test reads it.
- `docs/HANDOFF.md` has no "do not merge" line.

## 7. Commands

Run from the repository root. Each exits non-zero on failure and runs today on a clean checkout of `main`.

- lint: `npm run lint` (under 3 s)
- hygiene: `pre-commit run --all-files` (about 4 s)
- test: `npm test` (about 100 s today; `timeoutMs: 900000`)
- the guard self-test, as `extraVerify` on `scripts/cleanroom-guard.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `templates/cleanroom.example.json` and `templates/cleanroom.local-only.example.json`: `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json && node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json`
- site, as `extraVerify` on `site/`, `docs/site/` and the three site scripts: `npm run check:site`
- targeted mutation: `node test/{filter}.mjs` as `mutation.targeted.suite`
- the sandbox integration step, manual and not in `verify`: `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs`

## 8. Phases

### Phase 0 — The guard

A-01 and A-02. Ends with a push. Manual check, `NOT VERIFIED (human)`: in a live clean-room session with `claude --plugin-dir .`, these are allowed: `sed -n 1p .kukulu/cleanroom/log.jsonl`, and a heredoc that writes prior-art paths into a scratch file. The apostrophe case is denied.

### Phase 1 — Long tool calls and after the flight

B-01 to C-03. Ends with a push. Manual checks, `NOT VERIFIED (human)`:

- With the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error.
- After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.

### Phase 2 — Policies and evidence

D-01 to E-02. Ends with a push. Manual check, `NOT VERIFIED (human)`: with `policies.finalize: "draft"` in the owner's global file, `kukulu_config_show` in a project with no `policies` block reports `finalize: "draft"` from `global`.

### Phase 3 — Stage handoffs, documentation and release

F-01 to F-04, then G: the version bump, the CHANGELOG and `docs/HANDOFF.md`. Manual checks, `NOT VERIFIED (human)`:

- On the next flight, go-flight's first `Agent` call carries `description` and does not fail validation.
- `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## 9. Open questions

None block the build. Each is decided here, so the planner records it under `## Decisions` as given:

1. **Two flights.** 0.8.1, this flight, has the fixes. 0.9.0 has OpenCode as the driver with OpenRouter as a model source, built and tested with a fake harness, since the owner keeps Claude Code as their own driver. Owner decision of 2026-11-11.
2. **`finalize`'s default.** `"ready"`, with global and profile overrides (D-01, D-02). Owner decision of 2026-11-11.
3. **Similarity groups.** Supported (E-01). Owner decision of 2026-11-11.
4. **The MCP timeout value.** 24 h, an ⚠️ ASSUMPTION in `.mcp.json` only (§5.5). The owner may tune it.
5. **No progress heartbeat.** It is deferred to 0.9.0 (§2). B-01 covers the timeout through a documented setting. A heartbeat would need a second writer on the MCP channel from a child process, with pitfalls that no fake can test, such as inherited descriptors, non-blocking writes and half-written frames. And it helps only if Claude Code sends a `progressToken`, which its docs do not say.
6. **The reviewer's halt (F-03).** A tool grant and a skill rule, not a new verdict for `kukulu_review_submit`. A halt is already the pipeline's "a human must act" state, and resuming it needs nothing new.
7. **A-02's operator contexts.** These are a closed list with position rules, read twice. A command is denied when either reading denies, and A-02 has its own triage rule. Owner decision of 2026-11-13, made after five review rounds that each found one more context. A heredoc piped into a shell is judged as commands, because the first A-02 implementation regressed that case.

## Appendix A: item map

### `docs/feedback/2026-11-11-project-g.md`

| Item | Disposition |
|---|---|
| F-01, F-03, F-04, F-06, F-09, F-15 read-only `sed -n` denied as a protected-path write | fixed, A-01 |
| F-02 an unblock reason lived only in PROGRESS.md | fixed, F-02 |
| F-05, F-13 list filters break `cargo test` | fixed, F-04 (refused at config load, with the right form) |
| F-07 no verdict when the only open item is blocked on the owner | fixed, F-03 |
| F-08, F-12, F-14 long calls aborted at the 1800 s idle timeout | fixed, B-01 and B-02; a heartbeat is deferred (§9 question 5) |
| F-10 exactly one negative and one positive pair | fixed, E-01 |
| F-10 the title-derived slug collided with an archive | fixed, C-03 |
| F-11 `sed`'s script read as a path while planning | fixed, A-01 |
| F-11 a heredoc with prior-art paths refused | fixed, A-02 |
| F-16, F-17 the hook-written log blocked release and stranded stashes | fixed, C-01 (no re-armed genesis) and C-02 (no checkout needed) |
| F-18 "no numbered entry" hid a stale local base | fixed, C-02 |
| F-19 `finalize: "auto"` by default, with no durable owner setting | fixed, D-01 and D-02 |
| F-20 an alias reported as a model mismatch | fixed, E-02 |
| F-21 go-flight omits the Agent call's `description` | fixed, F-01 |
| F-21 pull-feedback must read archived logs | already true in 0.8.0; no change |

### The masthead flight (2026-11-10)

No feedback was logged. Its SUMMARY's note, that `kukulu_mutate` was unavailable in the implement session, is by design: mutation testing is the reviewer's tool.

## Appendix B: interpretation choices made in writing this spec

Each is a place where the brief allowed two readings:

1. **A-01's mechanism.** `sed` stays in both family lists and is gated on in-place options, rather than being removed from `WRITE_FAMILY`. Removal would drop the in-place denials that three fixtures pin. The `w` command is a known gap, because it is no worse than today and modelling sed's script language is a parser principle 1 rules out.
2. **A-02's shell case.** A body that a shell reads is judged as commands, because that is the one case where the guard knows exactly what the body means. A shell reads the body when it owns the heredoc or is piped the heredoc. Bodies for every other interpreter are data, as the `interpreter` known limit already says.
3. **B-01 over a heartbeat.** The documented per-server `timeout` is one line of config and needs no change to the transport. The heartbeat is §9 question 5.
4. **C-01's place.** The fix moves the genesis write, rather than having the archive delete the policy or switch the hooks off. The policy is the project's, and the next flight needs it in place.
5. **C-02's source of truth.** Origin's base branch, because the merged PR on origin is what a release tags. The local base is fast-forwarded as a convenience and reported, never relied on.
6. **D-02's scope.** Every policy key can be layered, not only `finalize`, so the next default an owner disagrees with needs no release.
7. **E-01's shape.** An optional `group` on each pair, with today's single-band config as the implicit `default` group, so existing policies and bundles keep their meaning.
8. **A-02's two readings.** The alternative was to make the list of non-operator contexts exact. That needs a bash parser, which principle 1 rules out, and every review round proved the list incomplete. A second reading that never hides an operator makes a wrong list cost an over-denial instead of a hole.
