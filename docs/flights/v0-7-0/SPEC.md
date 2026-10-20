# Kūkulu 0.7.0 — Specification

Version: 0.7.0
Status: draft for owner review

The Kūkulu planner reads this file in full and derives the build plan from it. The previous spec (the kukulu.tech site flight) is archived unchanged at [flights/kukulu-tech/SPEC.md](flights/kukulu-tech/SPEC.md). The plugin running this flight is the installed 0.6.1, read from the plugin cache; the code the flight edits is the working tree, and nothing it changes affects the server running the flight.

This release has three jobs. It ends the pre-0.6.0 "foundry" compatibility period. It closes the friction the last two flights in this repository logged or that the operator observed. And it ships **clean-room mode**: the controls that built cleanflate by hand, ported into the plugin as general, configurable features, so that every clean-room line on kukulu.tech is true at release.

## Recommendation on size

This release is one flight (`flight=v0-7-0`): the planner plans all seven phases of §8 in order, and the result is tagged 0.7.0. It is large: the clean-room work alone is five new tools, three new hook scripts, a verifier and a new test suite, and every mutant on this repository costs a 90-second suite run. Three things keep it reviewable in one pass:

- Phases are ordered by dependency, and every phase ends with a push, so CI sees each phase on the draft PR before the next one builds on it.
- Review scope is bounded: B-03 caps mutation-only fix rounds at `review.mutationFixRounds`, so later rounds turn surviving self-test mutants into notes rather than tasks (the kukulu.tech flight needed five rounds without that cap).
- The site copy (Phase 6) is applied last and only from the owner-approved `docs/site/copy-changes.json`, so nothing on kukulu.tech changes until the features it describes are built and reviewed.

## 1. Overview

Kūkulu is a Claude Code plugin: a dependency-free MCP server (`mcp/server.mjs`) holds the mechanics and the skills (`skills/*/SKILL.md`) hold the judgment. Release 0.7.0 removes the foundry shims, closes every open item in `docs/feedback/2026-10-19-kukulu-tech.md` and the nine operator observations in Appendix A, adds a mechanical check that private project names never reach the repository, and adds clean-room mode: a policy guard on every tool call, a hash-chained provenance log with signed checkpoints, a gate the controller passes before every stage, calibrated contamination scoring against user-supplied control pairs, and a signed attestation bundle that a dependency-free verifier checks offline. Done means: every requirement in §6 has its tests, `npm run check`, `pre-commit run --all-files`, `npm run check:site` and `npm run check:site:browser` pass, the version reads 0.7.0 everywhere, kukulu.tech's copy says only what shipped, and a draft PR is open against `main`.

**Why a minor version, not 0.6.2:** it removes the `kukulu_migrate` tool, the `FOUNDRY_*` variables, the `.foundry/` layout fallback and the old agent names (all announced for 0.7.0), adds four tools (twenty-two becomes twenty-five), two hook events, three `docs/kukulu.json` keys and one new file in the project (`docs/cleanroom.json`), and changes what `kukulu_plan_commit` and `kukulu_review_submit` refuse.

**Patent note.** The clean-room method is the subject of U.S. Provisional Application No. 64/178,095 (Displace Technologies LLC). A mechanism in §6 that goes beyond what that application discloses carries an inline **⚠️ NEW MATTER** marker saying what is new; the marker is for the owner's running list for the non-provisional and changes nothing about how the task is built. Write "patent pending", never "patented".

## 2. Goals and non-goals

- Goal: no runtime trace of the foundry names remains in `mcp/`, `scripts/`, `hooks/`, `skills/`, `agents/` or `.mcp.json`, except that archives written before 0.6.0 stay readable (A-01–A-04).
- Goal: an operator clears any halt with a tool call, never a hand edit of `.kukulu/state.json` (B-02).
- Goal: a flight started on a feature branch is told how to proceed, and the planner can no longer commit a plan whose `baseBranch` is not the branch it is on (B-01).
- Goal: a review loop that finds only mutation survivors converges in a bounded number of rounds (B-03).
- Goal: `kukulu_mutate` runs the constraint scan, so a mutant only a constraint catches is reported as killed by that rule (B-07).
- Goal: a review from round 2 on reads the pull request's CI status (B-08).
- Goal: the MCP's own writes to `docs/PROGRESS.md` and `docs/PLAN.md` pass markdownlint MD022, and `**Depends on:**` is matched only at the start of a line (B-09, B-10).
- Goal: the names of other projects never enter a tracked file, and the check that enforces it never prints them (C-01–C-03).
- Goal: with `docs/cleanroom.json` present, every tool call in the project is checked against that policy before it runs, allowed or denied it is logged into a hash chain, the policy, guard, log and signing key are protected from the agents, and no stage starts until the controller has verified all of it (D-01–D-12).
- Goal: contamination is scored as a position between a negative and a positive control pair the user supplies, with fixed bands, and "not separated" when the controls do not separate (E-01–E-04).
- Goal: the evidence ships as a signed bundle that `node verify-attestation.mjs <dir>` checks offline, with no dependencies, including a Foundry-era log (F-01–F-05).
- Goal: kukulu.tech says the clean-room features are in the plugin, from copy the owner approved in writing before the flight (G-01–G-04).
- Non-goal: background jobs for long verify commands (cleanflate F-13, F-28). The synchronous-handler invariant holds; still deferred.
- Non-goal: a hotfix lane (a short reviewed stage for an operator fix, flagged in the attestation). cleanflate's two post-approval operator fixes motivate it; 0.7.0 records such a fix as a `human` entry (D-09) and the attestation names it as a coverage gap (F-02). The lane itself is 0.7.x.
- Non-goal: routing preflight, `require_distinct` implementer/reviewer, allowed-runner lists and fallback runners. 0.7.0 records the model of every logged call (D-05) and nothing more about routing.
- Non-goal: containers, VMs or network namespaces as isolation backends. The 0.7.0 guard is the hook; §6 D-03 lists what a hook cannot see.
- Non-goal: AST or embedding similarity, JPlag, Dolos, or any scorer that needs a dependency. The 0.7.0 scorer is lexical (E-02) and says so in its output.
- Non-goal: changing any ⚠️ ASSUMPTION value in `docs/site/checks.json`, any seeded site asset, or any number in the kukulu.tech Proof section. The cleanflate numbers on the page are the canonical ones (§6 G) and do not change.
- Non-goal: editing any file under `docs/plans/`, any archived flight under `docs/flights/`, `docs/SPEC.md`, or by hand `docs/PLAN.md` and `docs/PROGRESS.md`.
- Non-goal: a flight-id prefix on task ids. `TASK_ID`, `TASK_LINE` and the guard's task regexes do not change.
- Non-goal: merging, tagging or publishing this release. The flight ends in a draft PR; the owner merges and tags.

## 3. Engineering principles

Each is checkable by grep or test. Those marked `[rule:<id>]` are `constraints` in `docs/kukulu.json` (bodies in §5); the rest the reviewer checks by reading, as named.

1. **Mechanics live in the server, judgment in the skills.** A mechanical step (validating ids, hashing a file, appending a log entry, signing a checkpoint, building a bundle) is a server or script change with a test, never a skill sentence telling a model to do it by hand.
2. **Every server behavior change has a test** in the suite that owns the tool (`CONTRIBUTING.md`'s table; this release adds the `cleanroom` and `attest` suites). Every new refusal has a test that triggers it and asserts its message.
3. **Tools validate, then mutate.** A refusal comes before any file is written; a tool whose final commit fails leaves the tree as it found it. Reviewer reads.
4. **Config never silently defaults a bad value.** Every new `docs/kukulu.json` key and every `docs/cleanroom.json` key is validated with an unknown-key refusal.
5. **No `async`/`await` in `mcp/server.mjs` or `mcp/cleanroom.mjs`.** `[rule:server-synchronous]` (paths widened to both files).
6. **No dependencies anywhere.** `[rule:no-dependencies]`. Every new script imports only `node:` modules or sibling files under `scripts/` or `mcp/`. `[rule:scripts-node-builtins]` (widened from `site-scripts-node-builtins` to every `scripts/*.mjs`).
7. **No `fable` default.** `[rule:no-fable-default]`; `fable` stays a legal alias.
8. **No synchronous merge.** `[rule:no-sync-merge]`.
9. **No `sed -i`** in `test/`, `scripts/` or `mcp/`. `[rule:no-gnu-sed-inplace]`.
10. **No foundry names at runtime.** After A-01, no line of `mcp/`, `scripts/`, `hooks/`, `skills/`, `agents/` or `.mcp.json` contains `foundry` or `FOUNDRY`, except the three places the verifier and `kukulu_pr_finalize` need for history: the legacy record reader in `scripts/verify-attestation.mjs` (F-04), the `foundry.json` archive-name fallback in `kukulu_pr_finalize` and `kukulu_flight_archive`'s file list (A-04), and the verifier's fixture under `test/fixtures/`. `[rule:no-foundry-names]` with those paths excluded; `from:` the A-01 task.
11. **The guard fails closed.** Every code path in `scripts/cleanroom-guard.mjs` that throws ends in a denial, and the guard never exits 0 on an exception. Reviewer reads; D-03's tests cover the thrown case.
12. **Hashes are SHA-256 over bytes, signatures are Ed25519 over the canonical bytes of §6 D-06, and nothing else.** No other digest or signature primitive appears in `mcp/`, `scripts/` or the bundle. `[rule:one-hash-one-signature]`: pattern `createHash\(\s*(?:["'])(?!sha256)` and `generateKeyPairSync\(\s*(?:["'])(?!ed25519)`.
13. **Private names never reach a tracked file, and the check never prints one.** `scripts/check-names.mjs` reports a private-name hit by file, line and denylist index only. Reviewer reads; C-02's tests assert the message.
14. **The site changes only through approved copy.** `docs/site/mockup.html` and `site/index.html` change only by applying `docs/site/copy-changes.json` (G-01), and that file is never created or edited in a flight commit: `[rule:copy-changes-not-in-flight]` cannot be a line pattern, so the task that applies it checks `git log <merge-base>..HEAD -- docs/site/copy-changes.json` is empty (G-02), and the reviewer confirms it.
15. **Every existing site rule holds.** `site-no-inline-style`, `site-no-inline-handler`, `site-404-no-script`, `site-one-script-form`, `site-root-relative-src`, `site-css-root-relative`, `site-self-contained`, `site-display-name-ascii`, `site-no-theme-attr`, `site-no-cache-control`, `copy-buttons-start-hidden`, `no-hardcoded-copy-feedback`, `no-hardcoded-site-tunables` are carried over unchanged from `docs/flights/kukulu-tech/kukulu.json`.
16. **Documentation moves with the code.** A task that adds or changes a tool updates `docs/mcp-tools.md` in the same commit; the first line reads "Twenty-five tools" from the task that adds the last one.
17. **Error messages are written for a model**: what is wrong, what to do instead. Comments explain why.
18. **Tests never depend on an untracked file.** A test that reads documentation reads only paths in `git ls-files`; a test that needs a denylist, a key or a policy writes its own in a temp directory (B-06, C-03).

## 4. Architecture

| Path | Responsibility | Touched by |
|---|---|---|
| `mcp/server.mjs` | Every tool and the JSON-RPC transport; one file | A, B, D, E, F |
| `mcp/cleanroom.mjs` | **New.** Pure, synchronous functions shared by the server, the hooks and the tests: policy loading and validation, target canonicalization, the guard decision, chain canonicalization and hashing, checkpoint signing and verification, key loading. No I/O beyond reading the files it is handed; no `spawnSync`; imports `node:` only | D, E, F |
| `mcp/run-command.mjs` | One bounded command in its own process group | unchanged |
| `scripts/implement-guard.mjs` | Stop / SubagentStop hook | A-02 (name sets only) |
| `scripts/cleanroom-guard.mjs` | **New.** PreToolUse hook: evaluates the policy, denies, logs the denial | D-03 |
| `scripts/cleanroom-log.mjs` | **New.** PostToolUse and UserPromptSubmit hook: appends allowed calls and human instructions | D-04, D-09 |
| `scripts/verify-attestation.mjs` | **New.** The offline verifier; self-contained (no imports but `node:`), copied into every bundle | F-03, F-04 |
| `scripts/check-names.mjs` | Name rules plus the private-name denylist | C-02 |
| `scripts/check-site.mjs` | Site rules 1–14 plus rule 16 (approved copy) | G-02 |
| `hooks/hooks.json` | Stop, SubagentStop, and now PreToolUse, PostToolUse, UserPromptSubmit | A-02, D-03 |
| `agents/*.md` | Tool lists per role: the contract | E, F |
| `skills/*/SKILL.md` | Stage prose | B, C, D, E, F |
| `templates/` | SPEC skeleton; `cleanroom.example.json` (new) | D-01 |
| `test/` | Harness plus thirteen suites: the eleven today, `cleanroom` and `attest` | every requirement |
| `test/fixtures/foundry-tool-log.jsonl` | **New.** A redaction-free excerpt of cleanflate's real provenance log | F-04 |
| `docs/*.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | Docs | H |
| `site/`, `docs/site/mockup.html` | The page, changed only by G-01 | G |

Boundaries the reviewer enforces:

- `mcp/cleanroom.mjs` has no `spawnSync`, `execFileSync`, `process.exit` or `console`. The hook scripts and the server own I/O and exit codes.
- The hook scripts exit 0 in under 50 ms when the project has no `docs/cleanroom.json`, before loading `mcp/cleanroom.mjs` (D-02): projects not in clean-room mode must not pay for it.
- `scripts/verify-attestation.mjs` imports nothing but `node:` modules, so the copy inside a bundle runs alone. Its chain and signature code duplicates `mcp/cleanroom.mjs` on purpose; a test feeds both the same fixtures and asserts identical results.
- `mcp/server.mjs` is one file, so server requirements serialize. The planner may run `scripts/verify-attestation.mjs` (F-03), `scripts/check-names.mjs` (C-02) and the site (G) as parallel streams against the server work only where it can prove disjoint paths; a serial plan is acceptable.

**Agent tool lists** (`agents/*.md` `tools:`) change as follows: `kukulu_similarity` and `kukulu_attest` go to the summarizer. `kukulu_run_resume` and `kukulu_cleanroom_record` go to the go-flight controller's `allowed-tools` (both spellings, as today), not to any agent: both are human-initiated. `kukulu_migrate` leaves the controller's list.

## 5. Data and configuration

### 5.1 `docs/kukulu.json` keys added or changed

| Key | Type | Default | Validated by | Requirement |
|---|---|---|---|---|
| `cleanroom` | object | absent | new `validateCleanroom`, unknown-key refusal | D-01 |
| `cleanroom.policy` | string path | `docs/cleanroom.json` | must be repo-relative, no `..` | D-01 |
| `cleanroom.signingKey` | string path | `~/.config/kukulu/cleanroom/ed25519.pem` | `~` expanded; `KUKULU_CLEANROOM_KEY` wins over it | D-07 |
| `cleanroom.similarity` | object | absent | `validateSimilarity` | E-01 |
| `review.mutationFixRounds` | positive integer | 2 ⚠️ ASSUMPTION | new `validateReview`, unknown-key refusal | B-03 |

Clean-room mode is **on** when the file at `cleanroom.policy` exists; there is no `enabled` flag (§9 Q1). The planner never writes `cleanroom.policy` unless SPEC names a different path.

### 5.2 `docs/cleanroom.json` (the policy)

Written by the human before the flight, committed on `baseBranch`. Validated by `loadPolicy` in `mcp/cleanroom.mjs`; every bad shape and every unknown key is a refusal naming the key.

```json
{
  "version": 1,
  "deny": {
    "tools": ["WebSearch"],
    "network": true,
    "paths": ["~/.cargo/registry/", "~/.cargo/git/", "/usr/include/zlib.h"],
    "pathPatterns": [
      { "id": "build-script-output", "pattern": "/target/([^/]+/)*build/", "shouldMatch": ["/home/u/p/target/debug/build/x"], "shouldNotMatch": ["/home/u/p/target/debug/deps/x"] }
    ],
    "words": ["zlib", "miniz", "flate2", "libdeflate", "libz-sys", "libz_sys", "zopfli"],
    "commandPatterns": [
      { "id": "no-profiling-oracle", "pattern": "^(perf|objdump|gdb|lldb|valgrind)\\b.*\\b(oracle|libz|zlib)\\b", "shouldMatch": ["perf record target/release/oracle"], "shouldNotMatch": ["perf record target/release/examples/profile_decode"] }
    ]
  },
  "allow": {
    "paths": ["crates/cleanflate/", "crates/oracle/", "docs/"],
    "urls": ["https://www.rfc-editor.org/rfc/rfc1951.txt"]
  },
  "lockdown": { "after": "P0-10" },
  "protected": ["tools/"]
}
```

| Key | Required | Meaning |
|---|---|---|
| `version` | yes, `1` | Schema version |
| `deny.tools` | no, `[]` | Tool names denied outright |
| `deny.network` | no, `true` | Deny `WebFetch` not in `allow.urls`, `WebSearch`, and Bash segments whose command word is `curl`, `wget`, `gh`, `ssh`, `scp`, `nc`, `git clone`, `git fetch`, `git pull`, `pip download`, `cargo vendor`, `cargo download`, `npm install`/`npm i`/`npm ci`, `go get`, `composer install` (the fixed list is a constant in `mcp/cleanroom.mjs`; `shouldMatch` fixtures in its test) unless the URL is allowed and lockdown is off |
| `deny.paths` | no, `[]` | Prefixes. `~` expands to `HOME`; a relative entry is repo-relative. A target under one is denied for every tool |
| `deny.pathPatterns` | no, `[]` | `{ id, pattern, flags?, shouldMatch, shouldNotMatch }`, a regex over the resolved absolute path, with fixtures self-tested exactly as `constraints` are |
| `deny.words` | no, `[]` | Case-insensitive substrings. A target path, Glob or Grep pattern that contains one is denied unless under `allow.paths`; a read-family Bash segment (§6 D-03) whose path-like arguments or non-path arguments contain one is denied by the same rule |
| `deny.commandPatterns` | no, `[]` | Same shape as `pathPatterns`, over each top-level Bash segment |
| `allow.paths` | no, `[]` | Prefixes exempt from `deny.words` (the project's own tree). Never exempt from `deny.paths` or `pathPatterns` |
| `allow.urls` | no, `[]` | Exact URLs allowed for `WebFetch`, `curl` and `wget` until lockdown |
| `lockdown.after` | no | A task id (`TASK_ID`); once that task is `[x]` in `PROGRESS.md`, or when no open task remains, `allow.urls` is treated as empty. Absent means no lockdown (`allow.urls` holds all flight) |
| `protected` | no, `[]` | Extra paths (prefixes) the guard denies every write tool and write-family Bash segment on, in addition to the always-protected set in D-03 |

`templates/cleanroom.example.json` ships the example above, which is cleanflate's policy restated (its guard's `FORBIDDEN_WORDS`, roots and CR7 profiler rule).

### 5.3 Tunables introduced

- `review.mutationFixRounds`: 2 ⚠️ ASSUMPTION. The kukulu-tech flight's rounds 2–5 each queued one mutation-only task in the same self-test file and approval came at round 5; two rounds of mutation-driven fixes is where it would have stopped queueing. Tuned by the tuning task in Phase 1 only by reading `docs/flights/*/state.json` trails; it stays 2 unless a trail shows a real defect found by a round-3 mutation survivor.
- `similarity.near`: 0.25 (the band edge; fixed by the disclosed method, not an assumption). `similarity.separationMargin`: 0.0 ⚠️ ASSUMPTION — controls count as separated when `s_pos − s_neg > separationMargin`; cleanflate-bench used strict `pos > neg`. Config key under `cleanroom.similarity`.
- `similarity.ngram`: `[5, 10]`, `similarity.minIdentLen`: 6, `similarity.commentNgram`: 5. From cleanflate-bench's `config/bench.toml`; config keys.
- Hook fast-path budget: 50 ms ⚠️ ASSUMPTION, asserted by a test on the "no policy" exit; no config key, it is a test bound.
- Log entry target length: 4,000 characters ⚠️ ASSUMPTION (cleanflate's bound), constant `TARGET_MAX` in `mcp/cleanroom.mjs`.

### 5.4 Constraints for this flight's own `docs/kukulu.json`

Carry over every rule in `docs/flights/kukulu-tech/kukulu.json` unchanged except where named here, then add:

```json
[
  { "id": "server-synchronous", "description": "No async/await in the server or the clean-room module.", "paths": ["mcp/server.mjs", "mcp/cleanroom.mjs"], "pattern": "\\b(async|await)\\b", "shouldMatch": ["async function f() {}", "  const r = await run();"], "shouldNotMatch": ["function f() {}", "const asynchronous = false;"] },
  { "id": "scripts-node-builtins", "description": "Every script imports only node: modules or siblings.", "paths": ["scripts/"], "pattern": "^\\s*import\\b[^;]*\\bfrom\\s*(?:[\"'])(?!node:|\\./|\\.\\./)", "shouldMatch": ["import ws from \"ws\";", "import { chromium } from 'playwright';"], "shouldNotMatch": ["import fs from \"node:fs\";", "import { chain } from \"../mcp/cleanroom.mjs\";"] },
  { "id": "no-foundry-names", "description": "No foundry name at runtime after the removal task (A-01).", "paths": ["mcp/", "scripts/", "hooks/", "skills/", "agents/", ".mcp.json"], "exclude": ["scripts/verify-attestation.mjs"], "pattern": "foundry|FOUNDRY", "flags": "i", "shouldMatch": ["const old = process.env[`FOUNDRY_${name}`];", "\"foundry-implementer\""], "shouldNotMatch": ["const ROOT = envVar(\"PROJECT_DIR\");"], "from": "<the A-01 task>" },
  { "id": "one-hash-one-signature", "description": "SHA-256 and Ed25519 only.", "paths": ["mcp/", "scripts/"], "pattern": "createHash\\(\\s*(?:[\"'])(?!sha256)|generateKeyPairSync\\(\\s*(?:[\"'])(?!ed25519)", "shouldMatch": ["createHash(\"sha1\")", "generateKeyPairSync(\"rsa\", {"], "shouldNotMatch": ["createHash(\"sha256\")", "generateKeyPairSync(\"ed25519\")"] }
]
```

The `no-foundry-names` rule must also exclude the `foundry.json` fallback lines in `mcp/server.mjs` named in principle 10. A line pattern cannot exclude two lines of one file, so those two lines spell the name as `"foun" + "dry.json"`; the rule's `shouldNotMatch` carries that line. `kukulu_pr_finalize`'s own test (A-04) proves the concatenation still reads an old archive.

## 6. Interfaces

Each requirement states the observable contract. Tests assert these shapes. Unless a requirement says otherwise, "refuses" means a `ToolError` before any write.

### A — End of the foundry compatibility period

#### A-01 — runtime shims removed

- `mcp/server.mjs`: `envVar` reads only `KUKULU_<name>`; `DEPRECATIONS`, `deprecate`, `LAYOUT.legacy`, `LEGACY_LAYOUT_NOTICE`, `resolveLayout`'s legacy branch, `inLayoutNames`, `globalConfigPath`'s `foundry/` fallback, `kukulu_next` decision 4a, `LEGACY_AGENT_MARKER` and `kukulu_migrate` are deleted. `P` is `layoutFor(".kukulu", "kukulu.json")` once. The `deprecations` field leaves `kukulu_status` and `kukulu_next`; go-flight no longer prints it.
- A project that has `.foundry/` or `docs/foundry.json` and no `.kukulu/` or `docs/kukulu.json` is refused by every tool with: "this project is on the pre-0.6.0 Foundry layout, which 0.7.0 no longer reads. Move `.foundry/state.json` and `.foundry/feedback.jsonl` to `.kukulu/`, `docs/foundry.json` to `docs/kukulu.json`, and the `.foundry/` lines of `.gitignore` to `.kukulu/`, then commit (0.6.x's `kukulu_migrate` did this)." One test per layout shape.
- `.mcp.json` drops `FOUNDRY_CONFIG` and `FOUNDRY_PROFILE`. `test/plugin.mjs` asserts they are absent.
- `globalConfigPath()` is called on every resolve and never memoized: a test writes `~/.config/kukulu/config.json` (under an isolated `XDG_CONFIG_HOME`) between two `kukulu_config_show` calls on one server process and asserts the second reflects it. This is the owner's "re-read, never cache" rule and also closes Appendix A item 4 (the stale deprecation notice).
- `test/routing.mjs`'s "pre-0.6.0 names" block, `test/state.mjs`'s legacy-layout tests and `test/plugin.mjs` lines asserting the old variables become their refusal counterparts.

#### A-02 — guard and hooks

- `scripts/implement-guard.mjs`: `IMPLEMENTER_AGENT_TYPES` is `{"kukulu-implementer", "kukulu:implementer"}`; `RUN_START_TOOL` is `/^(?:mcp__.+__)?kukulu_run_start$/`; `STATE_DIRS` becomes the single `.kukulu`; `FOUNDRY_GUARD_CAP` is not read. `TASK_ID`, `TASK_LINE` and the task-line regex in `openTasks` do not change.
- `hooks/hooks.json`'s `SubagentStop` matcher is `^(kukulu:implementer|kukulu-implementer)$`.
- `test/guard.mjs`'s four legacy cases (lines near 97, 128, 325, 340) become "a `foundry-implementer` stop is allowed" and "a `.foundry/implement.lock` is ignored".

#### A-03 — skills and docs

- go-flight loses the `migrate` option and `kukulu_migrate` from `allowed-tools`; `argument-hint` drops `[migrate]`. summarize and pull-feedback drop their `.foundry/feedback.jsonl` sentences.
- `docs/operations.md` loses the two "Before 0.6.0" paragraphs; `docs/architecture.md` loses decision 4a; `docs/mcp-tools.md` loses `deprecations` and the `kukulu_migrate` section; `README.md` loses the migrate row. `CHANGELOG.md`'s 0.7.0 entry lists the removals under Breaking changes with the one-paragraph manual migration from A-01's refusal.

#### A-04 — archives stay readable

- `docs/flights/v0-5-0/foundry.json` is not renamed. `kukulu_pr_finalize` and `kukulu_flight_archive`'s file list keep reading an archive's `foundry.json` when `kukulu.json` is absent there (principle 10's spelling). `test/state.mjs`'s archived-flight test is rewritten: the project is on `.kukulu/`, its archive holds `foundry.json`, `kukulu_status` reads the archive record and `kukulu_next` returns `done`.
- The `PINNED` hash table in `test/state.mjs` is replaced (Appendix A item 7): the test asserts `docs/flights/v0-5-0/` holds exactly the nine recorded file names, computes their hashes at test start, runs the tools above against a temp copy, and asserts the copy is byte-identical to what it was. No hash is hard-coded, so a legitimate redaction of history never fails a test.

### B — Friction and feedback

#### B-01 — the branch a flight starts on

- `kukulu_plan_commit` gains a `branch` check: the current branch must equal `baseBranch` or start with `branchPrefix`. Otherwise the problem reads `[branch] on '<branch>', but docs/kukulu.json baseBranch is '<base>'; set baseBranch to '<branch>' (the branch the plan is committed on) or switch to it`. The plan-build skill says: set `baseBranch` to the branch you are on, unless SPEC names another.
- `kukulu_run_start`'s refusal on a foreign branch names both fixes: "on branch '<b>'; runs start from '<base>' or an existing '<prefix>*' branch. Either set baseBranch to '<b>' in docs/kukulu.json and re-run `kukulu_plan_commit`, or `git switch -c <prefix><date>` from '<b>'." The HANDOFF note that created `build/landing` by hand (Appendix A item 1) is what this prevents.

#### B-02 — `kukulu_run_resume`

- New tool, inserted after `kukulu_run_halt`. Arguments `{ reason }`, a non-empty string a human writes.
- Refuses when: the flight is not halted; the halt is a round-cap halt (`state.haltCap` set): "a round-cap halt is lifted by `kukulu_flight_options({ …, resume: true })`"; the tree is dirty apart from `preexistingUntracked`; a stream worktree exists; `baseBranch` does not exist; or, for a `stream-merge` halt, the stream's branch still exists unmerged into the build branch (`git branch --merged`).
- Otherwise sets `state.halted = null`, appends one `resume` feedback entry (`source: "human"`, the reason), in clean-room mode appends a `human` chain entry (D-09), and commits as `chore: run resumed`. Returns `{ resumed: true, previousHalt, commit }`.
- go-flight maps "resume: <reason>" (or "continue: <reason>" when the halt reason does not name `resume: true`) to this call once, prints the result, and goes back to step 1. The halt message for `kukulu_run_halt` and for a stream-merge halt names this tool instead of "edit .kukulu/state.json". `docs/operations.md`'s Halts section loses every hand edit.

#### B-03 — mutation follow-ups converge

- `kukulu_review_submit` tasks gain a required `source`: `"review"`, `"mutation"` or `"blocked"`. A task without it, or with another value, is refused naming the legal values. (The skill is updated in the same release, so there is no old caller.)
- When `reviewRound > review.mutationFixRounds` and a submitted task has `source: "mutation"`, the submission is refused: "round N is past review.mutationFixRounds=2: a surviving mutant is advisory now. Put it under `## Notes` in REVIEW.md (the summarizer carries it) and resubmit; if the survivor shows a SPEC requirement is untested, resubmit it as source \"review\" naming that requirement." Nothing is written on the refusal (it is a validation).
- `state.rounds[]` entries gain `sources: { review, mutation, blocked }` counts; `kukulu_summary_commit`'s review-history line reads them.
- The review-build skill replaces its round-2+ paragraph: mutate only the files of the last fix round's tasks, and from round `mutationFixRounds + 1` a survivor never becomes a task. A survivor in a self-test or test file is always labelled `mutation`.

#### B-04 — the flight slug

- The plan-build skill derives `flight` from SPEC's title as: the text before the first ` — `, ` - ` or `:`; lowercase; runs of non-alphanumerics to `-`; the trailing words `specification`, `spec` removed; trimmed of `-`; cut to 40. "kukulu.tech — Specification" gives `kukulu-tech`; "Kūkulu 0.7.0 — Specification" gives `kukulu-0-7-0`. `kukulu_plan_commit` warns (a `notes` array in its result, not a refusal) when `flight` ends in `-specification` or `-spec`. Test in `test/plugin.mjs` asserts the skill's rule text; test in `test/state.mjs` asserts the note.

#### B-05 — pull-feedback and private labels

- The pull-feedback skill: never commits (step 8 becomes "do not commit; `docs/feedback/` is gitignored and this file stays on your machine"); names the label rule (C-01); links `CONTRIBUTING.md#flight-feedback` instead of `docs/feedback/README.md`. `docs/feedback/README.md`'s conventions move into a `## Flight feedback` section of `CONTRIBUTING.md` (tracked), with the file-naming rule rewritten for labels.
- `test/plugin.mjs` asserts the skill contains no `git commit`, names `.private-names`, and links a tracked target.

#### B-06 — tests never depend on untracked files

- `test/plugin.mjs`'s link check resolves a relative link target against `git ls-files` (plus directories that contain a tracked file), not `fs.existsSync`. A link to a gitignored path fails with the file and target named. The `MD` list it iterates is also taken from `git ls-files`.
- A test proves it: a temp copy of the repo with an untracked `docs/x.md` linked from a tracked file fails the check.

#### B-07 — `kukulu_mutate` runs the constraint scan

- After applying the mutation and before the commands, `kukulu_mutate` runs the active constraints over the mutated tree (fixture self-test included). A hit counts as a kill: the result gains `constraints: { ok, results }`, `killed` is true when any constraint hits or any command fails, and `verdict` reads `killed: constraint <id> caught the mutation` when only a constraint did. `confirmKill` re-runs only commands, as today. Closes kukulu-tech F-05.

#### B-08 — the review reads CI

- `kukulu_status` gains `prChecks`: when `gh` is on `PATH` and the branch has a pull request, the result of `gh pr checks --json name,state,link` as `{ state: "pass" | "fail" | "pending" | "none", failing: [{ name, link }] }`; `"unknown: <why>"` when `gh` fails; `null` when there is no PR or no `gh`. Bounded by the 30-second command bound.
- The review-build skill: from round 2 on, read `prChecks` first; a `fail` is a finding (category 3) naming the check, and the fix task's `tests` names it. Closes kukulu-tech F-03 and F-04.

#### B-09 — MD022-clean writes

- Every heading the server writes into `docs/PROGRESS.md` (`## Tasks`, `## Log`, `### <ID> — <sha>`, `### <ID> — reopened`) and `docs/PLAN.md` (`## Review fixes (round N)`, `### R<N>-<nn>: …`) is followed by one blank line, and preceded by one when it is not the file's first line. `parseProgress` and `planTaskFrom` accept both the old and the new spacing. The plan-build skill's PROGRESS/PLAN templates carry the blank lines. A test runs a markdownlint-equivalent check (blank line after every heading) over a PROGRESS.md and PLAN.md after `task_done`, `task_block`, `task_reopen` and a `CHANGES REQUESTED` submit. Closes kukulu-tech F-01.

#### B-10 — `Depends on` at line start

- `planTaskFrom` matches `/^\*\*Depends on:\*\*\s*(.*)$/im` (line-anchored). A test plants the literal inside a task's prose and asserts the real dependency survives. Closes kukulu-tech F-02.

#### B-11 — auto-merge unavailable

- No behavior change. The `merge: "unavailable: …"` string gains the suffix `; set policies.finalize to "ready" to stop asking`. Test asserts it. Appendix A item 8.

### C — Private project names

#### C-01 — labels

- Pulled feedback for a project other than this repository and cleanflate (both public) is written as `docs/feedback/<date>-<label>.md`, where `<label>` is `project-<letter>`: the next letter after the highest already present in `docs/feedback/.private-names`. The skill appends `<label> <real name>` to that file (creating it, mode 0600) and never writes the real name anywhere else. Existing labels a–d are already taken (Appendix A).
- Inside a feedback file, the project is only ever called by its label; the flight controller's own notes, test names, comments, `CHANGELOG.md`, plans and specs cite items as `<label> F-nn`.

#### C-02 — the mechanical check

- `scripts/check-names.mjs` reads `docs/feedback/.private-names` when it exists: one entry per non-empty, non-`#` line, `<label> <name…>`; the name is everything after the first space, trimmed. For every file it already lists (tracked, or untracked and not ignored) that is **not** under `docs/feedback/`, it fails on any case-insensitive occurrence of a name as a whole word (`\b…\b`, with regex-escaping). The failure line is `check-names: <file>:<line>: contains private project name #<n> (see docs/feedback/.private-names); replace it with its label`. The name itself never appears in output.
- Without the file (CI, a fresh clone) it prints `check-names: private-name check skipped (no docs/feedback/.private-names)` and exits 0 for that rule.
- `.gitignore` already ignores `docs/feedback/*`; a test asserts `git check-ignore docs/feedback/.private-names` succeeds.

#### C-03 — tests

- `test/plugin.mjs`'s check-names block (which runs the script in a temp root) gains: a denylist with two names, a tracked hit → exit 1, message names file, line and `#2`, and `stderr` does not contain the name; the same name under `docs/feedback/` → exit 0; no denylist → the skipped line; a name that is also a common word is matched only as a whole word. The test never reads the maintainer's real denylist: it always passes its temp root.
- `scripts/lint.sh` is unchanged (it already runs check-names), so pre-commit and `npm run lint` enforce it wherever a denylist exists.

### D — Clean-room mode: isolation, provenance, gated stages

#### D-01 — policy and configuration

- `mcp/cleanroom.mjs` exports `loadPolicy(text) → policy` implementing §5.2 (every key validated; unknown keys refused; every `pathPatterns` and `commandPatterns` entry has fixtures that are self-tested on load, a disagreeing fixture naming the line). `validateCleanroom` in `cfg()` validates the `cleanroom` object of `docs/kukulu.json`.
- `policyHash(bytes)` is the SHA-256 of the file's bytes. `kukulu_status` gains `cleanroom`: `null` when the policy file is absent, else `{ policy, policyHash, mode: "clean-room", genesis, pinnedPolicyHash, chain: { entries, tip, lastCheckpoint }, denied, hooksLive, keyFingerprint, lockdown: boolean }`.
- `templates/cleanroom.example.json` is the §5.2 example and `test/cleanroom.mjs` loads it.

#### D-02 — hook registration and the fast path

- `hooks/hooks.json` registers `scripts/cleanroom-guard.mjs` on `PreToolUse` (no matcher: every tool, MCP tools included) and `scripts/cleanroom-log.mjs` on `PostToolUse` (every tool) and `UserPromptSubmit`. The Stop/SubagentStop entries stay.
- Both scripts read `CLAUDE_PROJECT_DIR` (else the input's `cwd`, else `process.cwd()`), check whether `docs/kukulu.json` names a `cleanroom.policy` (default `docs/cleanroom.json`) that exists, and exit 0 with no output within 50 ms when it does not, without importing `mcp/cleanroom.mjs`. A test measures it.
- `test/plugin.mjs` asserts the three registrations and that both scripts are executable (`scripts/lint.sh`'s executable-bit loop gains them).

#### D-03 — the guard (PreToolUse)

`evaluate(policy, hookInput, env) → { decision: "allowed" | "denied", reason }` in `mcp/cleanroom.mjs`; `scripts/cleanroom-guard.mjs` calls it, appends a `denied` entry on a denial, writes `kukulu clean-room guard: <reason>` to stderr and exits 2; otherwise exits 0 silently. Any exception anywhere ends in a denial with reason `guard internal error: <message>`, logged if the log can be written.

Canonicalization (before any rule): every path (`file_path`, `path`, `notebook_path`, a Bash path-like token) is `~`-expanded, made absolute against the input's `cwd`, normalized, and resolved through `fs.realpathSync.native` when it exists; both the normalized and the real form are checked. A Bash command is split into top-level segments on unquoted `;`, `&&`, `||`, `|`, `&` and newlines (a port of cleanflate's splitter, with its quote and escape handling), and each segment's command word is the first token that is not a `NAME=value` assignment or a wrapper (`sudo`, `env`, `time`, `command`, `xargs`, `nice`) with its flags.

Rules, in order, first match denies:

1. `tool_name` in `deny.tools`.
2. `WebSearch` when `deny.network`.
3. `WebFetch`: lockdown active → denied; URL in `allow.urls` → allowed; else denied.
4. Write tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) whose target is under a protected path (D-10's set plus `protected`) → denied `protected path`.
5. `Read`, `Glob`, `Grep`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`: target under `deny.paths` or matching a `pathPattern` → denied; target (or Glob `pattern`, Grep `glob`/`pattern`) containing a `deny.words` entry and not under `allow.paths` → denied `forbidden word`.
6. `Bash`, per segment:
   - `deny.network` tools (§5.2) → denied, unless the command word is `curl` or `wget` with every URL in the segment in `allow.urls` and lockdown off; `gh` and `git clone` are never allowed under `deny.network`.
   - any token under `deny.paths` or matching a `pathPattern` → denied.
   - a read-family command word (`cat less more head tail grep egrep fgrep rg ag ack find fd locate ls tree sed awk bat strings xxd od hexdump file zcat zless zgrep view vi vim nano emacs`, a constant): a path-like token containing a `deny.words` entry outside `allow.paths` → denied; a non-path token containing one while any path-like token (or the `cwd`, when there is none) lies outside the repository → denied. This is cleanflate's rule, which produced its false positives on `zlib` in `sed` expressions and `grep` patterns *inside* the project; the `allow.paths` carve-out and the "inside the repository" clause are what keep those allowed. Fixtures in `test/cleanroom.mjs` include the eight real cleanflate false positives (from `provenance/SUMMARY.md`) as `shouldNotMatch` and its one real prior-art attempt (`find / -path '*/libz-sys-*/src/lib.rs'`) as `shouldMatch`.
   - a write-family command word (`cp mv rm tee sed truncate chmod chown ln install dd git`) with a token under a protected path, or any `>`/`>>` redirection whose target is protected, or `git config` naming `core.hooksPath` → denied `protected path`.
   - a `commandPatterns` match → denied with its `id`.
7. Everything else, including `Agent`, `Task`, `Skill` and every `mcp__` tool → allowed.

Lockdown is active when `lockdown.after` names a task that is `[x]` in `docs/PROGRESS.md` or when `PROGRESS.md` has no open task. The guard reads `PROGRESS.md` itself.

Known gaps, stated in `docs/cleanroom.md` and in every bundle's manifest (`coverage.gaps`): interpreter escapes (`python3 -c`, `node -e`) are not parsed; subprocesses of a `make` target are not individual tool calls; MCP server internals are not tool calls; hooks load at session start, so a session that writes the policy is not covered until the next one (the gate's liveness check, D-08, catches a session with no hooks at all).

`scripts/cleanroom-guard.mjs --self-test <policy>` runs a fixed fixture set (`test/fixtures/guard-cases.json`: every rule above, deny and allow, with `__ROOT__`/`__HOME__` substitution as cleanflate's self-test did) plus the policy's own `pathPatterns`/`commandPatterns` fixtures, prints `guard self-test: ok (<n> cases)` or one line per failure, exits non-zero on any failure, and never writes the project's log (`KUKULU_CLEANROOM_LOG` points it at a temp file).

#### D-04 — the logger (PostToolUse)

`scripts/cleanroom-log.mjs` appends one `allowed` entry per tool call that reached PostToolUse. It always exits 0; on its own failure it appends an entry with `tool: "unknown"` and `reason: "logger-error: <message>"` where it can, else writes one stderr line.

#### D-05 — entry format

One JSON object per line of `.kukulu/cleanroom/log.jsonl`, keys in exactly this order:

| key | value |
|---|---|
| `seq` | 1-based integer, dense |
| `prev` | `hash` of the previous entry; 64 zeros for `seq` 1 |
| `at` | UTC ISO-8601, millisecond precision, `Z` |
| `kind` | `genesis` · `allowed` · `denied` · `human` · `gate` · `checkpoint` · `score` · `attest` · `resume` |
| `stage` | `plan` · `implement` · `fix` · `review` · `summarize` · `controller` · `null`: from `agent_type` when present (an implementer with `state.round ≥ 1` is `fix`), else the lock and round, else `null` |
| `task` | the first `[~]` task in `PROGRESS.md`, else `null` |
| `role` | `agent_type` verbatim, or `session` for the main session |
| `model` | the hook input's `model` when present, else `null` |
| `session` | `session_id`, else `null` |
| `tool` | `tool_name`; `null` for non-call kinds |
| `target` | as cleanflate's `target_of`: the path for file tools, `path=… glob=… pattern=…` for Grep, the URL, the query, the Bash command (truncated to `TARGET_MAX`), `<subagent_type>: <description>` for `Agent`; for `human` the text; for other kinds a short JSON string |
| `decision` | `allowed` · `denied` · `null` |
| `reason` | the denial reason, or `null` |
| `hash` | SHA-256 hex of `prev + "\n" + canonical(entry without hash)` |

`canonical` is `JSON.stringify` of the object with the keys above in that order and no others (extra fields such as a checkpoint's body go under one `data` key placed before `hash`), UTF-8, no whitespace. Appends go through `appendEntry(logPath, fields)` in `mcp/cleanroom.mjs`'s caller: take a directory lock (`mkdirSync(log + ".lock")`, retried for up to two seconds, then fail), read the last line for `prev` and `seq`, write one line with `O_APPEND`, release. The two hook scripts and the server all use it, so parallel streams cannot fork the chain.

`verifyChain(lines) → { ok, entries, tip, firstBad }` recomputes every hash and checks `seq` density and `prev` linkage.

#### D-06 — genesis, checkpoints and the key

- **Genesis.** The first `kukulu_next` call in a project with a policy file appends `{ kind: "genesis", data: { mode: "clean-room", policyHash, guardHash, loggerHash, hooksHash, pluginVersion, keyFingerprint, baseBranch, head } }` and records `state.cleanroom = { genesis: <hash>, policyHash, guardHash, loggerHash, hooksHash }`. The log file is created if absent and committed with state as `chore: clean-room genesis`. A project without a policy file at its first `kukulu_next` records `state.cleanroom = { mode: "general" }` and writes no log.
- **Mode is sticky.** A later `kukulu_next` with a policy file but `mode: "general"` in state, or without a policy file but a `genesis` in state, is `halt` with "clean-room coverage is broken: the mode changed after genesis (…)". `kukulu_run_resume` cannot clear it (the refusal says to archive the flight and start another).
- **Key.** `loadKey(path)` reads a PEM Ed25519 private key; `generateKey(path)` creates one with `generateKeyPairSync("ed25519")`, writes the private key (`0600`) and `<path>.pub` (SPKI PEM). `keyFingerprint` is `sha256:<hex>` over the public key's DER. `kukulu_run_start` in clean-room mode generates the key when it is absent, and `kukulu_status.cleanroom.keyFingerprint` reports it. The key path is always protected (D-10).
- **Checkpoint.** `{ kind: "checkpoint", data: { chainTip: <prev hash>, git: <HEAD sha>, policyHash, guardHash, loggerHash, hooksHash, keyFingerprint, event, signature } }` where `signature` is base64 Ed25519 over `canonical(data without signature)`. Written by: `kukulu_run_start` (event `run-start`), `kukulu_task_done`, `kukulu_task_block`, `kukulu_run_finish`, `kukulu_review_submit`, `kukulu_summary_commit`, `kukulu_similarity`, `kukulu_attest`, `kukulu_flight_archive` (event = tool name). Each of those tools adds `.kukulu/cleanroom/log.jsonl` to the paths it commits, and `kukulu_task_done`'s clean-tree check tolerates that file as it tolerates `PROGRESS.md`. `verifyCheckpoint(entry, publicKey) → boolean`.

#### D-07 — commit trailers

- Every commit the server makes in clean-room mode carries the trailers `Kukulu-Stage: <stage>` and `Kukulu-Task: <id or ->`, added by the commit helper (not a git hook, so `--no-verify` cannot skip them). The implement skill's commit template gains the same two lines for task commits. `scripts/verify-attestation.mjs` reads them from the bundle's `commits.txt` (F-02).

#### D-08 — the gate

`gate()` in `mcp/server.mjs` runs inside `kukulu_next` whenever `state.cleanroom.genesis` is set, before the decision table, and inside `kukulu_run_start`, `kukulu_task_next` (serial and stream), `kukulu_review_submit` and `kukulu_summary_commit` before any write. It checks, in order, and the first failure is `halt` (from `kukulu_next`) or a refusal (from a tool) with the check named:

1. **mode**: the policy file exists and `state.cleanroom.mode` is not `general`.
2. **policy**: `policyHash(policy bytes) === state.cleanroom.policyHash`.
3. **guard**: SHA-256 of `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs` and `hooks/hooks.json` under `PLUGIN_ROOT` equal the recorded ones, and `hooks.json` still registers both scripts on the three events.
4. **self-test**: `node scripts/cleanroom-guard.mjs --self-test <policy>` exits 0 (through `run-command.mjs`, 60 s bound).
5. **lockdown**: when `lockdown.after` is set and that task is `[x]`, the guard's computed lockdown state is active (a probe payload for an allowed URL must be denied).
6. **chain**: `verifyChain` over the whole log is `ok`, and the newest `checkpoint` entry verifies with the public key.
7. **liveness** (⚠️ NEW MATTER, D-08a).

A passing gate appends `{ kind: "gate", data: { checks: 7, ok: true } }`; a failing one appends `{ kind: "gate", data: { failed: "<check>", reason } }` before halting, so the refusal itself is in the chain. `kukulu_next`'s result gains `gate: { ok, checked: [...] }`, and go-flight prints `gate: ok (7 checks)` or the halt.

##### D-08a — liveness

⚠️ NEW MATTER: the gate proves the hooks are recording, not only that the log is intact. Between two consecutive `gate` entries there must be at least one `allowed` entry, except before the first gate. A session whose hooks are not loaded (a session started before `hooks.json` existed, a `--no-hooks` launch) produces gate entries with nothing between them, and the gate halts with "no tool call has been logged since the last gate; the clean-room hooks are not running in this session. Start a new session." The bundle's `coverage.gaps` lists every pair of gate entries with nothing between them.

#### D-09 — human instructions

- `UserPromptSubmit` → `scripts/cleanroom-log.mjs` appends `{ kind: "human", role: "operator", target: <prompt text, truncated to TARGET_MAX> }`. Every prompt typed into a session in the project is in the chain.
- `kukulu_cleanroom_record({ text, kind? })`: new tool, after `kukulu_flight_options`. `kind` is `instruction` (default) or `intervention` (something done outside the pipeline: a file supplied, a fix made by hand, a tool installed) or `verdict` (a human classification of a denial: `text` then starts with the denial's `seq`, as `#<seq>: prior-art attempt|false positive|offline test — <note>`; a malformed verdict is refused). Appends a `human` entry with `data: { kind }`, commits the log as `chore: clean-room record`. For the go-flight controller only; the skill maps "record: <text>" to it. This replaces cleanflate's hand-kept `human-interventions.md` and cleanflate-bench's `denial_verdicts.toml` with chain entries.
- `kukulu_flight_options`, `kukulu_run_resume` and `kukulu_pr_finalize({ resign: true })` each append a `human` entry with their arguments.

#### D-10 — self-protection

The always-protected set, computed by `protectedPaths(policy, env)`: the policy file; `.kukulu/cleanroom/`; `.kukulu/state.json`; `docs/kukulu.json`'s `cleanroom` object (the whole file is protected; the planner writes it before genesis, and a policy change mid-flight is what the gate exists to catch); `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/`; `.mcp.json`; `CLAUDE_PLUGIN_ROOT` (the installed plugin) and `~/.claude/plugins/`; `~/.claude/settings.json`; the signing key and its `.pub`; `.git/hooks/`, `.git/config` and `.git/info/`. Reads of the policy, settings and `.mcp.json` are allowed (agents must be able to read the rules); reads of the key are denied (rule 5 treats the key path as a `deny.paths` entry).

#### D-11 — status, skills and docs

- `kukulu_status.cleanroom` (D-01). `kukulu_next` prompts for implement, review and summarize end with one more sentence in clean-room mode: "This flight is in clean-room mode: every tool call is checked against docs/cleanroom.json and logged; a denied call is never worked around — note it in the task's log and continue another way."
- The implement skill adds cleanflate's CR6 as a rule: a denial is not an obstacle to route around; the log entry names it. The review-build skill adds: read `kukulu_status.cleanroom.denied` and the `denied` entries since `lastReviewCommit`; a denial that was worked around (the same target reached by another tool call within the task) is a category-1 finding.
- New `docs/cleanroom.md`: what the mode does, the policy reference (§5.2), the log and checkpoint formats (D-05, D-06), the gate (D-08), the known gaps, how to record interventions and verdicts, and how to read a bundle. `README.md` gains a Clean-room mode section linking it. `docs/mcp-tools.md` covers every new tool and field.

#### D-12 — tests (`test/cleanroom.mjs`)

Covers: `loadPolicy` (every key, every refusal, fixture self-test), `evaluate` (every rule, both decisions, the cleanflate false positives and the real attempt, interpreter escape documented as allowed, the thrown case), the splitter (quoted `|`, escaped quotes, newlines), canonicalization (symlinked repo, `~`, relative to `cwd`), the hook fast path (no policy → exit 0, < 50 ms, no log), the logger (one line per call, the error path), the chain (append, lock contention from two processes, `verifyChain` on a tampered middle line, a reordered line, a dropped line), the key (generate, fingerprint, 0600), checkpoints (sign, verify, a wrong key, a changed field), genesis and sticky mode, every gate check failing on its own (policy edited, guard edited under a temp `PLUGIN_ROOT`, self-test failing, lockdown wrong, chain broken, liveness), protected paths for every write tool and Bash form, `kukulu_cleanroom_record` kinds and the malformed verdict, `UserPromptSubmit` logging, trailers on every commit kind, and `kukulu_status.cleanroom`. `test/drive.mjs` gains one end-to-end clean-room flight over stdio with the hooks invoked by the harness as Claude Code would (payloads on stdin, `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_ROOT` set), asserting the chain at the end has genesis, gates, allowed, denied, checkpoints and a human entry, and verifies.

### E — Calibrated contamination scoring

#### E-01 — configuration

`cleanroom.similarity` in `docs/kukulu.json` (validated by `validateSimilarity`; every key refused when malformed; unknown keys refused):

```json
{
  "subject": ["crates/cleanflate/src/"],
  "pairs": [
    { "id": "independent", "role": "negative", "left": "/srv/corpus/zlib-rs/src/", "right": "/srv/corpus/miniz_oxide/src/" },
    { "id": "derived", "role": "positive", "left": "/srv/corpus/zlib-rs/src/", "right": "/srv/corpus/zlib-ng/" },
    { "id": "vs-c-zlib", "role": "test", "left": "subject", "right": "/srv/corpus/zlib/" }
  ],
  "languages": { ".rs": "rust", ".c": "c", ".h": "c" },
  "ngram": [5, 10],
  "minIdentLen": 6,
  "commentNgram": 5,
  "identExclusions": "docs/rfc-identifiers.txt",
  "near": 0.25,
  "separationMargin": 0.0
}
```

Exactly one `negative` and one `positive` pair are required; at least one `test` pair; `left`/`right` are directories (absolute, `~`, or repo-relative; the string `subject` means the `subject` list). `languages` maps extensions to one of the shipped lexers: `rust`, `c`, `cpp`, `go`, `python`, `javascript`, `typescript`, `java`, `php`. A file with an unmapped extension is skipped and counted.

#### E-02 — the lexical scorer

`tokenize(text, language) → { tokens: [norm…], comments: [string…] }` in `mcp/cleanroom.mjs`, a hand-written lexer per language family: line and block comments by the language's markers; string, char and numeric literals; identifiers; operators and punctuation as themselves. Normalization follows cleanflate-bench's documented vocabulary: identifiers → `ID`, numbers → `NUM`, strings → `STR`, chars → `CHAR`, primitive type names → `TYPE`, and the shared keyword classes `if`, `else`, `LOOP` (`for`, `while`, `loop`, `do`), `SWITCH` (`match`, `switch`), `return`, `break`, `continue`, `FN` (`fn`, `func`, `def`, `function`), `TYPEDEF` (`struct`, `enum`, `union`, `type`, `typedef`, `class`, `interface`); every other keyword is its text. Preprocessor lines in C are skipped.

Metrics per pair, `score(pair) → rows`:

- `ngram_jaccard@n` and `ngram_containment@n` for `n` in `ngram`: Jaccard `|A∩B|/|A∪B|` and containment `|A∩B|/min(|A|,|B|)` over the union of per-file shingle sets (no shingle spans a file).
- `ident_jaccard` and `ident_match_rate_left`: over the sets of identifiers of length ≥ `minIdentLen`, minus the exclusion list (one identifier per line; a missing file is a refusal).
- `comment_jaccard`: Jaccard over `commentNgram`-grams of the lower-cased, whitespace-normalized words of all comments.

Positioning per metric, as disclosed: `c = (s_test − s_neg)/(s_pos − s_neg)`; bands fixed before measuring: `below negative` (c < 0), `at or near negative` (0 ≤ c ≤ near), `between` (near < c < 1 − near), `at or near positive` (1 − near ≤ c ≤ 1), `above positive` (c > 1); `not separated` when `s_pos − s_neg ≤ separationMargin`. The verdict line is cleanflate-bench's: "independence supported on every separable metric" only when each test pair is `below negative` or `at or near negative` on every separable metric; otherwise the failing metrics and bands are named; "no metric separates the controls" when none does.

Honest limits, written into the output and `docs/cleanroom.md`: this is a lexical approximation of cleanflate-bench's tree-sitter token method (same normalization, no parse tree, so a C macro body and a Rust `impl … for` are handled by rule rather than by grammar); it has no clone detector; cross-language pairs score lower on token metrics by construction, as the bench found (its n-gram metrics did not separate its controls, and its identifier and comment metrics did); a structural metric needs a same-language positive control; one target library is n = 1. The tool prints these as `limits` every time.

#### E-03 — `kukulu_similarity`

- New tool, after `kukulu_summary_commit`. Arguments: none. Summarizer only.
- Refuses when: `cleanroom.similarity` is absent; the implement lock exists; the flight is not reviewed `APPROVED`; a pair directory is missing or empty; in clean-room mode, the gate fails.
- Does: reads every file of every pair (inside the server process, never through an agent tool), scores, writes `.kukulu/cleanroom/similarity.json` (`{ config, files: [{ pair, side, path, sha256, bytes, language }], rows, verdict, limits, at }`) and `docs/SIMILARITY.md` (the statement, one line per metric as cleanflate-bench renders it, the verdict, the reference table of raw scores, the limits), appends a `score` entry with `data: { reads: <count>, sha256: <hash of similarity.json> }` and a checkpoint, and commits both files as `chore: similarity scored`. Outside clean-room mode it writes the same files and commits, with no chain.
- Returns `{ verdict, rows, files: <count>, skipped: <count>, limits, commit }`.
- The summarize skill calls it after `kukulu_summary_commit` when `cleanroom.similarity` is configured, and copies the verdict line and the per-metric lines into SUMMARY under `## Contamination score`. `kukulu_flight_archive` moves `docs/SIMILARITY.md` with the other artifacts.

##### E-03a — scorer isolation

⚠️ NEW MATTER: the scorer runs only inside the server, is refused while any implementer run is armed, and hashes every byte it read into the chain. The agents never receive prior-art text through this tool, only numbers; the `score` entry's `files` list (path, size, SHA-256) lets a verifier confirm which prior art was measured and that nothing else was read by the scorer, and the refusal during an armed run means no implement-stage tool call can ever trigger a read of the comparison corpus.

#### E-04 — calibration and tests (`test/cleanroom.mjs`)

- Fixtures under `test/fixtures/similarity/`: three toy implementations of one small spec in Rust and C (an `a` and an independent `b`, a `b-derived` that is `b` renamed and reordered, and a C `c`), about 150 lines each, written for the test. Assertions: `b`/`b-derived` scores above `a`/`b` on every metric (the controls separate); `a` positioned against them is `at or near negative` or below on `ident_jaccard` and `comment_jaccard`; swapping the controls produces `not separated` for metrics whose scores invert; an unmapped extension is skipped and counted; the exclusion list removes a planted identifier; every lexer tokenizes its sample file without throwing and classifies its keywords.
- The tool: every refusal; the files written; the chain entry and checkpoint; the lock refusal; a Markdown statement that is byte-identical on a second run with the same inputs.
- Manual check (human, Phase 4 end): run `kukulu_similarity` against the cleanflate-bench subjects at `7f50ce6` (reference pairs from `d047d66`) with cleanflate as the subject and record the identifier Jaccard for cleanflate vs C zlib, miniz_oxide vs C zlib and zlib-rs vs C zlib next to the canonical 0.021 / 0.019 / 0.095 and the comment Jaccard next to 0.0003 / 0.0010 / 0.032 in the task log. The lexical scorer is not expected to reproduce them exactly; the ordering must agree. `NOT VERIFIED (human)`.

### F — Offline attestation

#### F-01 — `kukulu_attest`

- New tool, after `kukulu_similarity`. Arguments `{ evidence?: string[] }`, repo-relative paths of extra evidence files (conformance results, fuzz logs); each must exist and be tracked. Summarizer only.
- Refuses when: not in clean-room mode; the summary is not committed; the gate fails; the tree is dirty apart from `preexistingUntracked`; an evidence path is missing, untracked or outside the repo.
- Writes `docs/attestation/`:
  - `manifest.json`: `{ version: 1, flight, plugin: { version, guardHash, loggerHash, hooksHash }, repo: { baseBranch, base, head, branch }, mode, genesis: <entry>, policy: { path, hashes: [every distinct policyHash seen in checkpoints, in order], current }, chain: { entries, first, tip }, checkpoints: [{ seq, event, git, signature, ok }], denials: { total, byReason: {…}, verdicts: { "prior-art attempt": n, "false positive": n, "offline test": n, unclassified: n } }, calls: { total, byTool: {…}, byStage: {…}, readCapable: n }, human: { instructions, interventions, verdicts }, selfTest: { ok, cases, at }, coverage: { gaps: [...], knownLimits: [...] }, similarity: { sha256 } | null, files: [{ path, sha256, bytes }], signer: { fingerprint, publicKey: "publisher.pub" }, at }`
  - `log.jsonl` (the whole chain), `policy.json` (current), `similarity.json` when present, `SUMMARY.md`, `REVIEW.md`, `PROGRESS.md`, `kukulu.json`, `state.json`, `commits.txt` (`git log --format='%H%x1f%G?%x1f%s%x1f%(trailers:key=Kukulu-Stage,valueonly)%x1f%(trailers:key=Kukulu-Task,valueonly)' <base>..HEAD`), every `evidence` file at its own path under `evidence/`, `publisher.pub`, `verify.mjs` (a byte copy of `scripts/verify-attestation.mjs`), and `manifest.sig` (base64 Ed25519 over `manifest.json`'s bytes).
  - Every file but `manifest.json`, `manifest.sig` and `verify.mjs` is listed in `files` with its hash; `verify.mjs`'s hash is in `plugin.verifierHash`.
- Appends an `attest` entry with `data: { manifest: <sha256> }` and a checkpoint, commits `docs/attestation/` and the log as `chore: attestation bundle`, pushes per policy. Returns `{ dir, files, manifest: <sha256>, fingerprint, commit, verify: <the verifier's own result, run on the bundle before committing> }`. A bundle the verifier rejects is never committed (the refusal carries the verifier's reasons).
- `kukulu_flight_archive` moves `docs/attestation/` into `docs/flights/<slug>/attestation/`.

#### F-02 — coverage gaps

`coverage.gaps` lists, with the evidence: gate pairs with no entry between them (D-08a); commits in `commits.txt` without `Kukulu-Stage` trailers (work outside the pipeline, cleanflate's two post-approval fixes being the motivating case); `human` entries of kind `intervention`; time spans longer than 3 hours ⚠️ ASSUMPTION (`cleanroom.idleGapHours`, validated) between consecutive entries during a stage; unsigned commits (`%G?` is `N` or `B`). `coverage.knownLimits` is D-03's fixed list.

#### F-03 — the verifier

`node scripts/verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--json]`, dependency-free, no network, no git. Checks, in order, and prints every failure with a reason, then `verify-attestation: PASS` or `FAIL (<n> reasons)`, exit 0 or 1:

1. `manifest.json` parses, `version` is 1, every listed file exists, and its SHA-256 and size match.
2. `manifest.sig` verifies over `manifest.json` with `publisher.pub`; with `--key`, the public key's fingerprint equals it, else the report says `signer: self-consistent, fingerprint not checked against an out-of-band value`.
3. `log.jsonl`'s chain verifies (`seq` dense, `prev` linkage, every hash) and `chain.first`/`chain.tip`/`chain.entries` match.
4. Every checkpoint in the log verifies with `publisher.pub`; every one named in `manifest.checkpoints` exists with that signature; the genesis entry equals `manifest.genesis`.
5. Policy consistency: the `policyHash` in every checkpoint is in `policy.hashes`, in order; `policy.json`'s hash equals `policy.current`; a change of policy hash between checkpoints is reported (not a failure) as `policy changed at seq <n>`.
6. Guard consistency: every checkpoint's `guardHash`/`loggerHash`/`hooksHash` equal the manifest's; a differing one fails.
7. Mode: `genesis.data.mode` is `clean-room` and no `gate` entry records a mode failure.
8. Denials: recount from the log and compare with `manifest.denials`; verdict counts recomputed from `human` verdict entries.
9. Coverage: recompute `coverage.gaps` from the log and `commits.txt` and compare; every gap is printed.
10. `similarity.json`'s hash matches, when present.

`--json` prints the same as one object. The verifier's own tests (`test/attest.mjs`) build a bundle with `kukulu_attest`, then tamper with each of: a file, the manifest, the signature, a log line, a checkpoint, the policy, the public key, a commit trailer; each tamper fails with the named reason, and the untampered bundle passes with and without `--key`. The bundle's `verify.mjs` copy runs from the bundle directory with the repo deleted.

#### F-04 — Foundry-era logs

The verifier must still read the records the cleanflate evidence, the white paper and the patent example cite. `node scripts/verify-attestation.mjs --legacy-log <tool-log.jsonl>` accepts the pre-rename schema: keys `ts`, `foundry_stage`, `task_id`, `model`, `tool`, `target`, `decision`, `reason`, optional `session_id`, `agent_type`, with no chain and no signatures. It reports: lines parsed and lines failed (never dropped silently), calls by tool and stage, denials with reasons, read-capable calls (`Read`, `Glob`, `Grep`, `Bash`, `WebFetch`), the forbidden-read candidates by cleanflate-bench's rule (a path-like token under a root pattern or naming a word outside the repo root, both given as `--roots` and `--words` arguments, defaulting to cleanflate's), and the line `legacy log: no hash chain or signatures; integrity rests on the git history that holds it`. The exit status is 0 when every line parses, 1 otherwise.

`test/fixtures/foundry-tool-log.jsonl` is an unmodified excerpt of cleanflate's `provenance/tool-log.snapshot.jsonl` at the commit named in Appendix D: the 20 consecutive lines starting at `2026-09-29T14:54:00.000Z` or the nearest earlier line, which include the one real prior-art attempt (`find / -path '*/libz-sys-*/src/lib.rs'`, denied) and its surrounding allowed calls. Redact nothing. `test/attest.mjs` runs the verifier over it and asserts: every line parses, exactly one denial, the denial's reason is `forbidden word in path argument: */libz-sys-*/src/lib.rs`, it is a forbidden-read candidate on the `libz-sys` word, and the legacy line is printed. `no-foundry-names` excludes `test/fixtures/` as a path, and `scripts/verify-attestation.mjs` by name.

#### F-05 — docs

`docs/cleanroom.md` gains "Reading a bundle" and "Verifying offline" sections with the verifier's command lines and output; `CONTRIBUTING.md`'s suite table gains `cleanroom` and `attest`; the summarize skill calls `kukulu_attest` after `kukulu_similarity` (when configured) and before `kukulu_flight_archive`, and SUMMARY gains `## Attestation` with the directory, the manifest hash, the fingerprint and the verifier's result line.

### G — kukulu.tech says what shipped

#### G-01 — approved copy

The copy change is the owner's decision, made before the flight: the owner commits `docs/site/copy-changes.json` on `main` with exactly the content of Appendix C (editing it there is the approval; a wording the owner does not want is removed from the file, and the spec's version is then superseded by the committed file). The flight **never** creates, edits or deletes that file.

#### G-02 — the gate and the rule

- The Phase 6 task "apply approved copy" first runs `git log <merge-base>..HEAD -- docs/site/copy-changes.json`; if the output is non-empty, or the file is absent at the merge-base, the task calls `kukulu_task_block` with "owner approval missing: commit docs/site/copy-changes.json on main (SPEC §6 G-01, Appendix C)". No later task depends on it (the docs and version tasks come first in Phase 6), so a missing approval blocks one task, not the flight.
- Otherwise it applies every `{ old, new }` pair to `docs/site/mockup.html` and `site/index.html` (each `old` must occur exactly once in each file, else the task blocks naming the pair) and commits both with `docs/site/copy-changes.json` untouched.
- `scripts/check-site.mjs` gains **rule 16**: when `docs/site/copy-changes.json` exists, it parses (`{ approved, approvedAt, changes: [{ old, new }] }`, every field validated), and for every pair `old` is absent from and `new` present in both `docs/site/mockup.html` and `site/index.html`. Failure: `check-site: rule 16: <file>: approved copy change <n> not applied; apply docs/site/copy-changes.json`. Self-test cases: a pair not applied to the page; one not applied to the mockup; `old` still present; a malformed file. Rule 6 (page equals mockup) is unchanged and still holds, since both change together. `IMPLEMENTED_RULES` gains 16; `--report` is unchanged.
- The flight's `docs/kukulu.json` carries the kukulu-tech constraints, and the `nothing under docs/site/ changes` reading in CLAUDE.md becomes: nothing under `docs/site/` changes except `mockup.html` by G-02, and never `checks.json`, `assets/` or `screens/`.

#### G-03 — the diagram

The dashed clean-room elements of Fig. 1 (`stroke-dasharray` on the room, the guard, the provenance and controller rows, the evidence boxes, and the `.dashed` class or its equivalent in `styles.css`) become solid, in the same commit as G-02. The legend's dashed swatch is removed with its text (Appendix C, change 4). `check-site` rule 6's heading, table and number sequence checks are unaffected; rule 3 (no inline style) still holds. Screens under `docs/site/screens/` are not regenerated (non-goal); the manual check compares the live page to the mockup, which also changed.

#### G-04 — canonical numbers and bio

No number in the Proof section changes; they are the canonical cleanflate numbers (`cleanflate-bench` at `7f50ce6`, reference pairs from `d047d66`): 2,962 of 2,962 conformance streams; 0 divergences in 1.24M differential-fuzz executions; 0 forbidden reads among 2,226 read-capable tool calls, one attempt blocked; identifier Jaccard 0.021 / 0.019 / 0.095; comment overlap 0.0003 against 0.032; 0.71–0.76×; about 28 hours, $361, 11 operator interventions. The bio's titles ("VP of Engineering at a defense AI company and VP of Information Security at a public company") are correct and do not change. The footer's "Patent pending" stays; "patented" never appears (`site-no-patented` constraint: pattern `\bpatented\b`, flags `i`, paths `site/`, `docs/site/mockup.html`, `README.md`, `CHANGELOG.md`).

### H — Documentation and release

- `docs/mcp-tools.md`: "Twenty-five tools"; sections for `kukulu_run_resume`, `kukulu_cleanroom_record`, `kukulu_similarity`, `kukulu_attest`; `kukulu_migrate` removed; new fields on `kukulu_status`, `kukulu_next`, `kukulu_mutate`, `kukulu_review_submit`, `kukulu_plan_commit`.
- `docs/operations.md`: configuration table rows for `cleanroom`, `cleanroom.policy`, `cleanroom.signingKey`, `cleanroom.similarity`, `cleanroom.idleGapHours`, `review.mutationFixRounds`; Halts section rewritten around `kukulu_run_resume`; environment table gains `KUKULU_CLEANROOM_KEY` and `KUKULU_CLEANROOM_LOG` (test and self-test only); the foundry paragraphs removed. `test/plugin.mjs`'s "config keys documented" loop gains branches for `cleanroom` and `review`.
- `docs/architecture.md`: the pieces diagram gains the two hook scripts; a "Clean-room mode" section with the gate's place in the stage machine; decision 4a removed. `docs/writing-specs.md`: a "Clean-room flights" section (write the policy, commit it on the base branch, name the lockdown task, configure the pairs) replacing the commit-msg hook advice with the built-in trailers.
- `README.md`: feature list, tool table, suite count ("thirteen suites"), Clean-room mode section, the 0.7.0 migration paragraph.
- `CHANGELOG.md` `## [0.7.0] — <date>`: Added, Changed, Fixed, Breaking changes (foundry removal; `source` required on review tasks; `kukulu_plan_commit`'s branch check; the `deprecations` field removed). Plain and technical; each fixed item cites `kukulu-tech F-nn` or `Appendix A item n`; other projects only by label.
- The version reads `0.7.0` in `package.json`, `.claude-plugin/plugin.json` and `VERSION` in `mcp/server.mjs`.
- `docs/feedback/2026-10-19-kukulu-tech.md` gets an "addressed in" header line pointing at this spec (the file is local; the task edits it only if it exists, and the test for the header does not exist, per principle 18).

## 7. Commands

Run from the repository root. Each exits non-zero on failure and runs today on a clean checkout of `main`.

- lint: `npm run lint` (under 3 s; check-names and check-site included)
- hygiene: `pre-commit run --all-files` (about 4 s)
- test: `npm test` (about 100 s with the two new suites; `timeoutMs: 900000`)
- site, as `extraVerify` on `site/`, `docs/site/`, `scripts/check-site.mjs`, `scripts/serve-site.mjs`, `scripts/check-site-browser.mjs`: `npm run check:site` and `npm run check:site:browser` (`exclusive`, needs Chrome; `CHROME_PATH` as before)
- targeted mutation: `node test/{filter}.mjs` as `mutation.targeted.suite` (`filter` is a suite name such as `cleanroom`), so a reviewer mutates one suite's mechanic in seconds.
- the guard self-test, once D-03 exists, as `extraVerify` on `scripts/cleanroom-guard.mjs`, `mcp/cleanroom.mjs` and `templates/cleanroom.example.json`: `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` (`from:` the D-03 task).

`package.json` gains no `dependencies` or `devDependencies`.

## 8. Phases

Task order inside a phase is the requirement order unless stated. Every phase ends with a push and a `Manual check:` line.

### Phase 0 — End of the foundry period

A-01, A-02, A-03, A-04. First, so `no-foundry-names` holds from its first task onward. **Manual check:** none beyond the suite; write `NOT VERIFIED (human): run the installed 0.6.1 plugin's kukulu_migrate on a throwaway .foundry/ project, then run one task of a flight on it with the working-tree plugin (claude --plugin-dir .)`.

### Phase 1 — Friction and feedback

B-01, B-02, B-06, B-09, B-10, B-07, B-08, B-03 (with its tuning task reading the archived trails), B-04, B-11, B-05. **Manual check:** `NOT VERIFIED (human): halt a throwaway flight with kukulu_run_halt, fix nothing, call kukulu_run_resume and confirm the refusal names the dirty tree; clean it and confirm the resume commit`.

### Phase 2 — Private names

C-01, C-02, C-03, and the `CONTRIBUTING.md` section. **Manual check:** `NOT VERIFIED (human): create docs/feedback/.private-names with one real name on your machine and run npm run lint; it must fail without printing the name; delete the file and it must print the skipped line`.

### Phase 3 — Clean-room isolation, provenance and gated stages

D-01, D-02, D-05 (chain), D-06 (key, genesis, checkpoints), D-03 (guard), D-04 (logger), D-10 (protection), D-07 (trailers), D-08 and D-08a (gate), D-09 (human entries), D-11, D-12 (the drive flight last). **Manual check:** `NOT VERIFIED (human): copy templates/cleanroom.example.json into a throwaway Rust project as docs/cleanroom.json, start a new Claude Code session with the working-tree plugin, ask it to read ~/.cargo/registry, confirm the denial appears in the session and in .kukulu/cleanroom/log.jsonl, type one instruction and confirm a human entry, then run /kukulu:go-flight and confirm 'gate: ok (7 checks)' before the plan stage`.

### Phase 4 — Contamination scoring

E-01, E-02, E-04 fixtures and lexers, E-03 and E-03a, the summarize-skill change. **Manual check:** the E-04 calibration run against cleanflate-bench's subjects, recorded in the task log with the canonical numbers beside the measured ones.

### Phase 5 — Attestation and the verifier

F-03 (verifier, standalone), F-04 (legacy log, fixture), F-01 and F-02 (bundle), F-05. **Manual check:** `NOT VERIFIED (human): copy a bundle to a machine without this repository, run node verify.mjs . --key <fingerprint from kukulu_status>, and confirm PASS; change one byte of log.jsonl and confirm FAIL names the line`.

### Phase 6 — Documentation, site and release

H (docs, README, CHANGELOG, version) first; then G-02, G-03 (the approved-copy task, which blocks itself when Appendix C is not on `main`); then the last task pushes. `kukulu_run_finish` opens the draft PR with `docs/HANDOFF.md` as the body; its first line, in bold, says the PR is not to be merged until the owner has run one clean-room flight from the working tree and deployed the site preview. **Manual check:** `NOT VERIFIED (human): deploy the build branch as a Cloudflare Pages preview (docs/site/DEPLOY.md), read every clean-room line on the preview against what the suite proves, and compare the page with the changed mockup at 360, 768 and 1440 px in both schemes; confirm the three site, ci and lint checks are green on the PR`.

## 9. Open questions

None block the build. Decided, so the planner records each under `## Decisions` as given:

1. **How clean-room mode is switched on.** By the presence of the policy file at `cleanroom.policy`, not by a boolean. A human writes the policy; the planner cannot forget a flag it never writes; the gate's sticky-mode check turns the file's appearance or disappearance into a halt.
2. **Where the policy lives.** `docs/cleanroom.json`, a separate file from `docs/kukulu.json`, because the planner writes the latter and the policy must be the human's.
3. **Where the log lives and whether it is committed.** `.kukulu/cleanroom/log.jsonl`, tracked, committed at every checkpoint by the tool that writes the checkpoint. cleanflate kept a gitignored live log and snapshotted it; a tracked, chained log needs no snapshot step.
4. **Signing.** Ed25519 through `node:crypto`, key under `~/.config/kukulu/cleanroom/`, fingerprint distributed out of band. Not git signatures: a bundle must verify without git, and not `ssh-keygen -Y`: the verifier must run with Node alone.
5. **Where the bundle goes.** `docs/attestation/` in the flight, moved to `docs/flights/<slug>/attestation/` by the archive, like every other artifact.
6. **What the scorer is.** Lexical, dependency-free, with the disclosed positioning and bands; its limits are in its output. A tree-sitter or JPlag scorer would need a dependency.
7. **Denial verdicts.** Chain entries of kind `human`/`verdict`, written by the operator through `kukulu_cleanroom_record`, counted into the bundle. cleanflate-bench's `denial_verdicts.toml` is the model.
8. **The site copy.** Appendix C, applied only from an owner-committed `docs/site/copy-changes.json`. The flight never writes that file.
9. **One flight.** All seven phases in one flight, `v0-7-0`, in §8 order (top of this document).
10. **`source` on review tasks is required.** A default would let an old habit label every task `review` and defeat B-03.

## Appendix A: feedback and friction map

### `docs/feedback/2026-10-19-kukulu-tech.md`

| Item | Status today | Disposition |
|---|---|---|
| F-01 pipeline artifacts fail MD022 | open (`## Tasks` and `## Log` are still followed directly by content) | B-09 |
| F-02 `**Depends on:**` matched anywhere | open (`/\*\*Depends on:\*\*\s*(.*)/i`, unanchored) | B-10 |
| F-03 controller never sees PR CI | open | B-08 |
| F-04 review has no `gh pr checks` step | open | B-08 |
| F-05 `kukulu_mutate` skips the constraint scan | open ("Constraints are not run") | B-07 |
| F-06 `Write` refused for `SUMMARY.md` | closed by 0.5.0 S-01 | none |
| F-07 a non-round-cap halt outlives its fix | open | B-02 |

### Operator observations, this session (not in any log)

| # | Observation | Disposition |
|---|---|---|
| 1 | `kukulu_run_start` refuses branches other than base or `build/*`; `build/landing` was hand-made from `feature/landing` | B-01 |
| 2 | A non-round-cap halt needs a hand edit of `state.json` | B-02 |
| 3 | Rounds 2–5 each found one or two new survivors in the same self-test; approval at round 5 | B-03 |
| 4 | A running server kept reporting the moved `~/.config/foundry/config.json` | A-01 (shim removed; config path re-read on every call) |
| 5 | pull-feedback says "commit the file" and links an untracked README | B-05 |
| 6 | A link check passed only because gitignored files existed | B-06 |
| 7 | Byte-pinned archive hashes had to be re-pinned for a redaction | A-04 |
| 8 | Auto-merge unavailable, reported and moved on | B-11 (message only) |
| 9 | Slug defaulted to `kukulu-tech-specification` | B-04 |

### Older feedback files (history; checked for anything still open)

| File | Status |
|---|---|
| project-a (2026-09-21) | every item closed by the 0.3 plan; nothing open |
| project-b (2026-09-23) | closed by 0.3.2 and 0.4; nothing open |
| cleanflate (2026-09-30) | F-13, F-28 background jobs: still deferred (§2). F-01 provenance logging: superseded by D-07's built-in trailers. Everything else closed by 0.4.0 or 0.5.0 |
| project-c, project-d (2026-10-07) | every item closed by 0.5.0; nothing open |

## Appendix B: files the planner should read

- `docs/feedback/2026-10-19-kukulu-tech.md`, if present on this machine (it is gitignored); Appendix A restates every item, so its absence blocks nothing.
- `docs/flights/kukulu-tech/SUMMARY.md` (the review-history trail behind B-03) and `docs/flights/kukulu-tech/kukulu.json` (the site constraints to carry over).
- `docs/flights/v0-5-0/SPEC.md`: the house style for requirements, and S-02's commit helper that every new tool reuses.
- `mcp/server.mjs`: `cfg()`, `validatePolicies`, `validateMutation`, `gitCommitIfChanged`, `next`, `runStart`, `taskDone`, `reviewSubmit`, `summaryCommit`, `flightArchive`, `prFinalize`, `mutate`, `status`, `planCommit`, `flightOptions`, `runHalt`.
- `scripts/implement-guard.mjs` (the hook idiom: stdin JSON, exit codes), `scripts/check-names.mjs`, `scripts/check-site.mjs` (`CASES`, `IMPLEMENTED_RULES`, `--self-test`).
- `templates/constraints.example.json` (the fixture model that `pathPatterns` and `commandPatterns` copy).
- Claude Code's hook reference for `PreToolUse` (stdin fields `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, and `agent_type`/`agent_transcript_path` for a subagent; exit 2 blocks and stderr reaches the model), `PostToolUse` (adds `tool_response`) and `UserPromptSubmit` (adds `prompt`).

## Appendix C: the approved copy (`docs/site/copy-changes.json`)

The owner commits this file on `main` to approve the copy. Each `old` occurs exactly once in both `docs/site/mockup.html` and `site/index.html` today. Markup inside a string is kept exactly; only words change.

```json
{
  "approved": "Eric Mann",
  "approvedAt": "<date the owner commits this file>",
  "changes": [
    { "old": "Kūkulu is an open-source Claude Code plugin that turns a written spec into a planned, built, reviewed branch. Clean-room mode is coming in 0.7.0.\">", "new": "Kūkulu is an open-source Claude Code plugin that turns a written spec into a planned, built, reviewed branch, with a clean-room mode that guards, logs and attests the build.\">" },
    { "old": "An open-source Claude Code plugin that turns a written spec into a planned, built, reviewed branch. Clean-room mode is coming in 0.7.0.\">", "new": "An open-source Claude Code plugin that turns a written spec into a planned, built, reviewed branch, with a clean-room mode that guards, logs and attests the build.\">" },
    { "old": "Clean-room mode, coming in 0.7.0, adds an enforced guard, a tamper-evident log, calibrated similarity scoring and evidence a third party can verify offline.", "new": "Clean-room mode, in the plugin since 0.7.0, adds an enforced guard, a tamper-evident log, calibrated similarity scoring and evidence a third party can verify offline." },
    { "old": "Coming in 0.7.0", "new": "In the plugin since 0.7.0" },
    { "old": "The pipeline runs today. The clean room goes around it next.", "new": "The pipeline runs the build. The clean room goes around it." },
    { "old": "Dashed: clean-room mode, coming in 0.7.0", "new": "Clean-room mode, in the plugin" },
    { "old": "CLEAN ROOM · 0.7.0 · GUARD CHECKS EVERY TOOL CALL", "new": "CLEAN ROOM · GUARD CHECKS EVERY TOOL CALL" },
    { "old": "Clean-room mode · coming in 0.7.0", "new": "Clean-room mode · in the plugin since 0.7.0" },
    { "old": "A guard checks every tool call’s target against a declarative policy before it runs. The policy and the guard are protected from the agents.", "new": "A hook checks every tool call’s target against a declarative policy before it runs. The policy, the guard, the log and the signing key are protected from the agents." },
    { "old": "Similarity scored on a scale where 0 is an independent pair of implementations and 1 is a known derivation.", "new": "Similarity scored on a scale where 0 is an independent pair of implementations and 1 is a known derivation, against control pairs you supply." },
    { "old": "under the clean-room controls that come to the plugin in 0.7.0.", "new": "under project-local clean-room controls; their general form is the plugin’s clean-room mode, from 0.7.0." },
    { "old": "NEXT 01 · 0.7.0", "new": "NEXT 01" },
    { "old": "Clean-room mode in the plugin, for modernizing legacy software into memory-safe code.", "new": "A hotfix lane: a short, reviewed stage for an operator fix, flagged in the attestation." }
  ]
}
```

Notes for the owner: changes 1 and 2 are the `meta name="description"` and `og:description` tags. Change 4 is the spec-sheet cell `Clean room · Coming in 0.7.0`. Change 6 keeps the legend row but drops the dashed swatch (G-03). Change 13 replaces the roadmap's first item; "NEXT 02" (vendor-agnostic package) and "NEXT 03" (continuous fuzzing and multi-pair similarity calibration) stay as they are. The Proof section, the bio and the footer do not change. Two visible number sequences change (`0.7.0` moves and the legend loses none), and rule 6 compares page to mockup, so both files change together.

## Appendix D: the Foundry-era fixture

`test/fixtures/foundry-tool-log.jsonl`: 20 consecutive, unmodified lines of `provenance/tool-log.snapshot.jsonl` from the public `ericmann/cleanflate` repository at tag `v0.3.0-cleanroom` (`85f210084a367dcc706c732f5776bf0563cdc0cd`), chosen so that the line with `"ts":"2026-09-29T14:54:47.458Z"` (the denied `find / -path '*/libz-sys-*/src/lib.rs'`) is included with at least five allowed lines on each side. The task that adds it records the first and last `ts` and the source commit in its log entry and in a one-line header comment file beside it (`foundry-tool-log.SOURCE`), since JSONL has no comments. The fixture is history: `check-names` and `no-foundry-names` exclude `test/fixtures/`.
