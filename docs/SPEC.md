# Kūkulu 0.7.1 — Specification

Version: 0.7.1 Status: draft for owner review

The Kūkulu planner reads this file in full and derives the build plan from it. The 0.7.0 spec is archived unchanged at [flights/v0-7-0/SPEC.md](flights/v0-7-0/SPEC.md); section ids written `0.7.0 D-nn` or `0.7.0 F-nn` refer to it. The plugin running this flight is the installed 0.7.0, read from the plugin cache. The flight edits the working tree, and nothing it changes affects the server running the flight.

This is a cleanup patch release with no breaking changes and no new tools. It does three things. It states what the clean-room guard is (a tripwire, not a sandbox) and makes the code, the docs and the review loop agree. It closes the open spec issues from the 0.7.0 flight's `SUMMARY.md` and `REVIEW.md`. And it closes the friction that flight logged.

## Recommendation on size

This release is one flight (`flight=v0-7-1`), three phases, all serial. Most tasks touch `mcp/server.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` or `CHANGELOG.md`. Two things keep the review loop short:

- Principle 1 below says when a guard finding becomes a fix task. The 0.7.0 flight ran eleven review rounds, and nearly every one after round 2 was a newly found option spelling. That is no longer a fix task.
- Every guard change here is a named rule with named fixtures (A-02 to A-05). None of them is "make the parser complete".

## 1. Overview

Kūkulu is a Claude Code plugin. A dependency-free MCP server (`mcp/server.mjs`) holds the mechanics, and the skills (`skills/*/SKILL.md`) hold the judgment. Release 0.7.1 makes `KNOWN_LIMITS`, `docs/cleanroom.md`, the bundle manifest and the review-build skill say the same thing about the guard's limits. It also fixes four guard rules the 0.7.0 review flagged, pins `mcp/cleanroom.mjs` in the gate, and closes the five friction items in `docs/feedback/2026-10-20-kukulu.md`. Done means:

- every requirement in §6 has its tests;
- `npm run lint`, `pre-commit run --all-files`, `npm test`, `npm run check:site` and the guard self-test pass;
- the version reads 0.7.1 everywhere;
- a draft PR is open against `main`.

**Why a patch version.** No tool is added or removed, no tool's input schema loses or renames a field, and nothing that worked in 0.7.0 is refused, with two exceptions: the guard denies two command forms it allowed before (A-04), and a `kukulu_task_done` log that breaks an active constraint is refused (B-02). Both close holes rather than change contracts. One `docs/kukulu.json` key is added (`policies.syncBase`), and it is optional.

**Patent note.** Nothing in this release goes beyond U.S. Provisional Application No. 64/178,095, so no section carries a NEW MATTER marker. Signing the log's uncommitted tail would be new matter, and it is out of scope (§2). Write "patent pending", never "patented".

## 2. Goals and non-goals

- Goal: `KNOWN_LIMITS`, `docs/cleanroom.md`'s Known gaps, the manifest's `coverage.knownLimits` and the review-build skill list the same limits, in the same order, and say when a guard finding becomes a fix task (A-01).
- Goal: a bare read-family operand and the same operand written `./x` get the same decision (A-02).
- Goal: `git add docs/*` and other git forms that write only the index are allowed (A-03).
- Goal: `rsync` and `tar` extraction into a protected path are denied (A-04).
- Goal: a denial that comes only from install's BSD reading names a real directory (A-05).
- Goal: the gate, the genesis entry and the manifest pin `mcp/cleanroom.mjs` (A-06).
- Goal: `kukulu_plan_commit({ renumber: true })` also rewrites the ids in the flight's own CLAUDE.md notes section (B-01).
- Goal: a log or reason that an active constraint would flag is refused before it reaches `docs/PROGRESS.md` (B-02).
- Goal: commits added to the base branch after the build branch was cut reach the build branch without anyone running `git merge` by hand (B-03).
- Goal: the hard cap's documentation says what the code does (B-04).
- Non-goal: signing the log's uncommitted tail (0.7.0 REVIEW spec issue "the log's uncommitted tail is unsigned"). It is new matter and stays out of scope.
- Non-goal: FreeBSD-only and macOS-only options (install `-T`, `-M`; macOS cp `-S`). They are known gaps under principle 1.
- Non-goal: any change under `site/` or `docs/site/`. The page already says "in the plugin since 0.7.0", which stays true.
- Non-goal: new tools, removed tools, or renamed input fields.
- Non-goal: background jobs for long verify commands (cleanflate F-13, F-28). Still deferred.

## 3. Engineering principles

Each is checkable by grep or test. Those marked `[rule:<id>]` are `constraints` in `docs/kukulu.json`. The rest are checked by the reviewer, by reading.

1. **The guard is a tripwire, not a sandbox.** This is the amended 0.7.0 D-03 text, carried over as written. "These rules" are the guard rules of 0.7.0 D-03 as A-02 to A-04 amend them, documented in `docs/cleanroom.md`. "The fixture set" is `test/fixtures/guard-cases.json`. "D-05", "D-06", "D-08" and "D-10" are the 0.7.0 sections.

   > **The guard is a tripwire, not a sandbox.** It judges a command by its text, so its wrapper and option parsing is best-effort. That covers the wrapper list, the options that take a value for wrappers and write-family commands, bundled short options, abbreviated long options, and operands that come after options. It follows the GNU coreutils, findutils and sudo on the CI images, and BSD/macOS forms where their manual pages differ. Neither the wrapper list nor the option tables can be proved complete across tool versions, so a spelling they do not model is a known gap, not a defect. What makes a bypass visible afterwards is the chain (D-05), the signed checkpoints (D-06) and the gate (D-08), not the guard. A review finding against the guard becomes a fix task only when:
   >
   > - it is a regression: a form denied at an earlier commit of the flight is allowed now;
   > - it writes a D-10 protected path, or reads under `deny.paths`, with a command word and option spelling these rules or the fixture set already name; or
   > - a rule above is missing for a whole command word it lists.
   >
   > Any other unmodelled spelling is a review note, and the reviewer adds its class to the known gaps below instead of queuing a task.

   The pipeline never edits this file, so "adds its class to the known gaps below" works like this. The reviewer writes the class as a bullet under a `Known-gap candidates` heading in REVIEW.md's `## Spec issues`. The summarizer carries it into SUMMARY.md. The owner decides whether a later release adds it to `KNOWN_LIMITS`. The reviewer checks this rule by reading every guard finding in a fix round.
2. **Mechanics live in the server, judgment in the skills.** A mechanical step (merging the base branch, checking a log against constraints, rewriting ids) is a server change with a test, never a skill sentence telling a model to do it by hand.
3. **Every server behavior change has a test** in the suite that owns the tool (CONTRIBUTING.md's table). Every new refusal has a test that triggers it and asserts its message. Every guard change has deny and allow cases in `test/fixtures/guard-cases.json`, with names ending in `(<task id>)`.
4. **Tools validate, then mutate.** A refusal comes before any file is written, and a tool whose final commit fails leaves the tree as it found it. A merge that conflicts is aborted, and the tree and HEAD are left as they were (B-03). The reviewer reads for this.
5. **Config never silently defaults a bad value.** `policies.syncBase` is validated in `validatePolicies`, with the existing unknown-key refusal.
6. **No guard fixture changes its decision unless a task names it.** A task may add fixtures. It may change an existing fixture's `expect` or `reason` only when §6 names that fixture's form, and the commit body lists every one it changed. The reviewer checks with `git diff <merge-base>..HEAD -- test/fixtures/guard-cases.json`.
7. **Every constraint in `docs/flights/v0-7-0/kukulu.json` carries over unchanged**, including the site rules, plus the one in §5.3.
8. **Documentation moves with the code.** A task that changes a tool's behavior updates `docs/mcp-tools.md` in the same commit. A task that changes a guard rule updates `docs/cleanroom.md` in the same commit.
9. **Error messages are written for a model**: say what is wrong and what to do instead. Comments explain why.
10. **No dependencies anywhere**, and tests never depend on an untracked file. Both are carried over from 0.7.0.

## 4. Architecture

No module is added. These are the changes, by module:

| Path | Changes |
|---|---|
| `mcp/cleanroom.mjs` | `KNOWN_LIMITS` (A-01); `evaluate`'s read-family word rule, git write-family subcommands, `rsync`/`tar`, the install message (A-02 to A-05) |
| `mcp/server.mjs` | genesis and gate check 3 pin `mcp/cleanroom.mjs`, plus the manifest's `plugin.cleanroomHash` (A-06); `planCommit` (B-01); `taskDone`, `taskBlock`, `taskReopen`, `runHalt` text checks (B-02); `runStart` and serial `taskNext` base sync, `validatePolicies` (B-03); `flight_options` schema text (B-04) |
| `scripts/verify-attestation.mjs` | reads `plugin.cleanroomHash` when present (A-06) |
| `skills/review-build/SKILL.md` | guard-finding triage (A-01) |
| `skills/summarize/SKILL.md` | carries known-gap candidates (A-01) |
| `test/fixtures/guard-cases.json` | new cases (A-02 to A-05) |
| `docs/cleanroom.md`, `docs/mcp-tools.md`, `docs/operations.md`, `README.md`, `CHANGELOG.md` | as each requirement says |

The commit helper and `run-command.mjs` do not change.

## 5. Data and configuration

### 5.1 `docs/kukulu.json`

| Key | Type | Default | Notes |
|---|---|---|---|
| `policies.syncBase` | boolean | `true` | B-03. When true, the server merges new base-branch commits into the build branch. The default is an owner decision, not an ⚠️ ASSUMPTION: the 0.7.0 flight showed what a stale base costs. A project that wants the old behavior sets `false`. |

`baseBranch` for this flight is `main`, and build branches are `build/<date>`.

### 5.2 Tunables

None added. Every 0.7.0 ⚠️ ASSUMPTION stays where it is, with its default unchanged.

### 5.3 Constraints added to this flight's `docs/kukulu.json`

- `progress-no-bare-macron`: in `docs/PROGRESS.md`, a macron u is allowed only inside the display name. Pattern `(?<!K)\u016b|\u016b(?!kulu)`, written so the JSON stays ASCII. `shouldMatch` gets a log line with the letter alone and one with it in a code span. `shouldNotMatch` gets the display name in prose. This is the rule B-02 uses to refuse the log line that broke 0.7.0 (feedback F-02). It needs no `from`: the planner's own PROGRESS.md must already pass it.

## 6. Interfaces

### A — The guard as a tripwire

#### A-01 — one list of limits, one triage rule

`KNOWN_LIMITS` becomes these eight strings, in this order, each ending in a period. The wording may be tightened, but not the substance:

1. Interpreter escapes (`python3 -c`, `node -e`) are not parsed.
2. Shell expansion beyond `~` and `$HOME` is not evaluated: other variables, and strings assembled at run time.
3. Option and wrapper spellings the tables do not model are not recognized: the guard judges a command by its text, its wrapper and option parsing follows GNU coreutils, findutils and sudo (and BSD/macOS forms where their manual pages differ), and no table can be proved complete across tool versions.
4. Commands that run a command from their arguments (`find -exec`, `watch`, `parallel`, `busybox`) and programs outside the fixed network and write lists (`unlink`, `shred`, `perl -i`, `cargo fetch`) are not recognized.
5. `pathPatterns` regexes are matched on the paths a call names, not on the files a recursive read or a glob reaches below a directory.
6. Subprocesses of a `make` target are not individual tool calls.
7. MCP server internals are not tool calls.
8. Hooks load at session start, so a session that writes the policy is not covered until the next one; the gate's liveness check catches a session with no hooks at all.

Entry 4 drops `rsync`, because A-04 now models it. `test/cleanroom.mjs` and `test/attest.mjs` assert eight entries. A new test asserts that `docs/cleanroom.md`'s `## Known gaps` section has exactly one bullet per entry, in the same order, and that each bullet contains the entry's first five words. That test reads `docs/cleanroom.md` through `git ls-files`. It also asserts that a bundle's `coverage.knownLimits` deep-equals `KNOWN_LIMITS`.

`docs/cleanroom.md`:

- `## Known gaps` becomes a bulleted list of the eight entries, not a paragraph.
- A new paragraph opens the guard section, before the rules: "The guard is a tripwire, not a sandbox", followed by principle 1's quoted text minus the triage bullets. Its section references become links into `docs/cleanroom.md`'s own sections for the chain, the checkpoints and the gate.
- The triage rule goes in a short "When a guard gap is a defect" subsection, which says the same thing as principle 1.

`skills/review-build/SKILL.md` gains a **Guard findings** paragraph after the clean-room paragraph. It applies when a finding's evidence is a command form the guard allows. The paragraph:

- states the three conditions for a fix task;
- tells the reviewer to check the regression case by running the form against the guard at the merge base (with `git show <merge-base>:mcp/cleanroom.mjs` into a temp copy, or `git worktree add` at the merge base in a temp directory);
- puts every other unmodelled spelling under `## Spec issues` → `Known-gap candidates`, as one bullet with the class and one example.

`skills/summarize/SKILL.md` copies the `Known-gap candidates` bullets from the final REVIEW.md into SUMMARY.md's `## Spec issues`. Neither skill names a tool that does not exist.

#### A-02 — bare and `./` read-family operands agree

Today `cat zlib.txt` is allowed and `cat ./zlib.txt` is denied with `forbidden word in path argument` (0.7.0 REVIEW spec issue). The word clause that judges path-like tokens will now also judge every non-option operand of a read-family command that is not a pattern, script or program. Those are the same operands 0.7.0 R4-02 already resolves as paths for `deny.paths`. With this rule, `cat zlib.txt` is denied with the same reason as `./zlib.txt`. The pattern, script and program operands (grep/rg/ag/ack patterns, the sed script, the awk program, find's `-name`/`-path`/`-regex` values) stay text, so the eight cleanflate false-positive fixtures keep their decisions. Required fixtures:

- denied: `cat zlib.txt`, `head -n 5 zlib.txt`, `less miniz.c`;
- allowed: `grep -n zlib src/a.rs` (a pattern), `sed -n 's/zlib/x/p' src/a.rs` (a script), and `cat zlib.txt` under a policy whose `allow.paths` covers the repository root.

#### A-03 — git forms that write only the index or nothing

Today every git operand is a write-family operand, so `git add docs/*` is denied with `protected path … (can be named by the wildcard docs/*)`. This changes so that the pathspec operands of `git add`, `commit`, `diff`, `status`, `log`, `show`, `blame`, `ls-files` and `grep` are not write targets: those subcommands write only `.git/` or nothing. An exception: the value of `--output` (and `-o` where the subcommand defines it) on `diff`, `log` and `show` is still a write target. git's global options are skipped as they are now. Every other git subcommand stays write-family as it is now, including the 0.7.0 destructive and worktree-discard forms. Required fixtures:

- allowed: `git add docs/*`, `git add docs/cleanroom.json` (staging a protected file is not writing it), `git commit -m x docs/a.md`, `git -C . diff docs/kukulu.json`;
- denied: `git diff --output=docs/cleanroom.json`, `git checkout docs/cleanroom.json`, `git restore .kukulu`.

#### A-04 — `rsync` and `tar`

Today `rsync evil/cleanroom.json docs/` and `tar xf evil.tar -C docs` are allowed (0.7.0 REVIEW spec issue). This adds two write-family rules:

- **`rsync`**: the last non-option operand is the destination, and every other operand is a source. As with `cp`, the guard judges the destination, each `<destination>/<basename>` landing path, and, when the destination equals or contains a protected path, the whole call. Options that take a value are skipped by the existing getopt-style scanner. `-e|--rsh` and `--rsync-path` take a value, and so do the `--exclude`/`--include`/`--filter` families, `--files-from`, `--backup-dir` and `--temp-dir`/`-T`. A remote operand (`host:path` or `rsync://`) is already a network command under `deny.network`, and that is unchanged.
- **`tar`**: an extraction writes under its directory. Extraction is `-x`, `--extract` or `--get`, or an old-style first argument containing `x` (`xf`, `xvzf`). The directory is the value of `-C`/`--directory`, or the shell's cwd. An extraction whose directory equals or contains a protected path is denied `protected path` (the archive's contents cannot be known). In create, append and update modes (`-c`, `-r`, `-u` and their long forms), the `-f`/`--file` value is a write target.

`docs/cleanroom.md` rule 6 names both. Required fixtures:

- denied: `rsync evil/cleanroom.json docs/`, `rsync -a evil/ .kukulu/`, `tar xf evil.tar -C docs`, `tar -x -f evil.tar --directory=.kukulu`, `cd docs && tar xf ../evil.tar`, `tar cf docs/cleanroom.json src`;
- allowed: `rsync -a src/ build/`, `tar xf a.tar -C build`, `tar tf docs.tar` (a listing), `tar cf build/a.tar docs` (reading a protected path is not writing it).

#### A-05 — install's BSD-only denial names its directory

When only the BSD reading of `install -S` lands on a protected path, the denial reads `install writes it into null` (0.7.0 REVIEW Notes). The reason now names the directory of whichever reading found the target. Fixtures assert the exact reason for both readings: `protected path: <path> (install writes it into <dir>)`, with no `null`. On Linux CI, `install -S evil/cleanroom.json docs` is judged under both readings, as 0.7.0 R8-01 requires. If the probe in the task finds that it is allowed today, the task makes the BSD reading apply on every platform, says so in its commit's `Interpretation:` line, and adds that fixture as denied.

#### A-06 — the gate pins `mcp/cleanroom.mjs`

Today gate check 3 hashes `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs` and `hooks/hooks.json`, but `evaluate` lives in `mcp/cleanroom.mjs` (0.7.0 REVIEW spec issue). The changes:

- `pluginHashes()` adds `cleanroomHash`, the SHA-256 of `mcp/cleanroom.mjs` under `PLUGIN_ROOT`.
- Genesis records it.
- Gate check 3 compares it, with a failure that names the file.
- The manifest's `plugin` object gains `cleanroomHash`.
- `scripts/verify-attestation.mjs` reports a mismatch between the manifest's `plugin.cleanroomHash` and genesis's `cleanroomHash` under the existing check that compares plugin hashes.

Old records stay readable:

- A genesis entry without `cleanroomHash` (a flight started on 0.7.0) is not refused. Check 3 skips that one comparison, and the gate entry records `data.unpinned: ["mcp/cleanroom.mjs"]`.
- A manifest without `plugin.cleanroomHash` verifies, with the note `verify-attestation: note: plugin.cleanroomHash absent (bundle from 0.7.0 or earlier)`.

Tests cover all of these:

- the pinned pass;
- a doctored temp-plugin copy whose `mcp/cleanroom.mjs` changed after genesis (gate halts, naming the file);
- a genesis without the key (gate passes, `unpinned` recorded);
- the verifier on a bundle without the field (pass with the note) and with a mismatched field (fail).

`test/attest.mjs`'s existing tamper tests keep passing. `docs/cleanroom.md`'s gate section names the fourth file.

### B — Friction from the 0.7.0 flight

#### B-01 — `renumber` reaches the flight notes (feedback F-01)

`kukulu_plan_commit({ renumber: true })` rewrites ids in `docs/PLAN.md`, `docs/PROGRESS.md` and `docs/kukulu.json`'s `from` values. It will also rewrite them in CLAUDE.md, but only inside the section headed `## Flight <slug> notes`, where `<slug>` is `docs/kukulu.json`'s `flight`. That section runs from its heading to the next level-2 heading or the end of the file. It uses the same single-pass map, so ids are never chained. Ids outside that section are history (earlier flights' notes cite their own task ids) and stay as they are. If the section is absent, CLAUDE.md is untouched and the result's `notes` says `CLAUDE.md has no "## Flight <slug> notes" section; ids there were not renumbered`. CLAUDE.md joins the rollback set (it is already in `paths`). Tests:

- a split id is renumbered inside the section;
- the same id outside the section is unchanged;
- the section ends at the next heading;
- the missing-section note;
- a failed commit leaves CLAUDE.md byte-identical.

#### B-02 — text the project's rules would refuse never reaches PROGRESS.md (feedback F-02)

Before writing, `kukulu_task_done`'s `log`, `kukulu_task_block`'s `reason`, `kukulu_task_reopen`'s `reason` and `kukulu_run_halt`'s `reason` are checked. The check runs the caller's string, as the server would render it into `docs/PROGRESS.md`, against every active constraint whose `paths` (minus `exclude`) cover `docs/PROGRESS.md`. These are the same constraints and the same `from` activation that `kukulu_verify` uses. A hit refuses with `<field> would break constraint <id> (<description>) in docs/PROGRESS.md at "<the matching text, at most 80 characters>"; rewrite it without that text and call <tool> again`, and nothing is written or committed. A constraint whose own fixtures fail is skipped here, because `kukulu_verify` reports it. No log-amend tool is added, since this release adds no tools. The refusal makes one unnecessary for this failure. Tests: one refusal per tool, with its message asserted; an inactive rule does not refuse; a rule scoped to other paths does not refuse; and HEAD and `docs/PROGRESS.md` are unchanged after each refusal. `docs/mcp-tools.md` adds the refusal to all four tools.

#### B-03 — the base branch is synced into the build branch (feedback F-03)

When `policies.syncBase` is true, `kukulu_run_start` (on an existing build branch) and serial `kukulu_task_next` (before choosing a task) check `git rev-list --count HEAD..<baseBranch>` against the local `baseBranch` ref. Nothing is fetched. If the count is greater than 0 and the tracked tree is clean, apart from the tolerated clean-room log:

1. The server runs `git merge --no-ff --no-edit <baseBranch>` through the commit helper, so signing, clean-room trailers (stage `implement`, task `-`) and the checkpoint behave like any other server commit. The message is `chore: merge <baseBranch> into <branch>`.
2. A conflict runs `git merge --abort`, leaves HEAD and the tree as they were, and refuses: `<baseBranch> has <n> commits this branch lacks and they conflict in <files>; resolve the merge by hand on <branch>, commit it, then call <tool> again, or set policies.syncBase to false`. It does not halt the flight. The implementer may call `kukulu_run_halt` with that reason.
3. On success, the tool's result gains `baseSynced: { commits: <n>, merge: <sha> }`.

Stream worktrees and `kukulu_task_next` with a `stream` never sync. A parallel flight syncs only at `kukulu_run_start`. In clean-room mode, the merged base commits have no `Kukulu-Stage` trailer, so `coverage.gaps` lists them as work outside the pipeline. That is the honest record, and `docs/cleanroom.md` says so.

Tests in `test/implement.mjs`:

- an ahead base is merged at `run_start` and at `task_next`;
- an equal base does nothing;
- a conflicting base refuses with the message, leaving HEAD and the tree byte-identical;
- `syncBase: false` skips it;
- a stream `task_next` never merges;
- `validatePolicies` refuses a non-boolean.

`docs/operations.md` gets the configuration row, and `test/plugin.mjs`'s config-keys loop covers it through the existing `policies` branch.

#### B-04 — round caps (feedback F-04, F-05; 0.7.0 REVIEW Notes)

F-04 and F-05 are the round caps working as designed. A human raised them and resumed, which is what they are for. No cap mechanism changes. A-01's triage rule is the fix for why they fired: fix rounds that each found one more option spelling.

The documentation is wrong, though. `kukulu_flight_options`'s schema says "a review numbered above this halts the flight", but the code (`reviewSubmit`) halts only a review that requests changes. An approving review above the cap ends the flight normally, as round 11 of 0.7.0 did with `maxRoundsHard` 10. The schema description, `docs/mcp-tools.md` and `docs/operations.md`'s Halts section will say: "a review numbered above this that requests changes halts the flight; an approving review ends it". Tests:

- an APPROVED `kukulu_review_submit` at round `maxRoundsHard + 1` succeeds and sets no halt;
- a CHANGES REQUESTED one at the same round halts with the existing message.

#### B-05 — the bundle's own SUMMARY (0.7.0 SUMMARY spec issue on E-03/F-05)

The bundle's `SUMMARY.md` predates the Attestation section that the summarize skill adds after `kukulu_attest`. That is true by construction: a file cannot contain the hash of the manifest that lists it. No mechanism changes. `docs/cleanroom.md`'s bundle section says: "the bundle's `SUMMARY.md` is the summary as attested; the Attestation section added afterwards cites the manifest's SHA-256 and lives only in the repository's copy". The summarize skill writes that section with the manifest hash from `kukulu_attest`'s result. If the skill already does, the task only checks it and cites the line.

### C — Documentation and release

- `docs/mcp-tools.md`: B-01, B-02, B-03 and B-04 changes on their tools, and `kukulu_attest`'s manifest field (A-06). Its first line still reads "Twenty-five tools".
- `docs/operations.md`: the `policies.syncBase` row and the Halts wording (B-04).
- `docs/cleanroom.md`: A-01 to A-06 and B-05, as each says.
- `README.md`: the feature list's clean-room sentence calls the guard a tripwire whose bypasses the chain and gate make visible. There is no other change, and the tool count is unchanged.
- `CHANGELOG.md` `## [0.7.1] — <date>`, renamed from `## [Unreleased]` by the release task, under Changed and Fixed. Each fixed item cites `kukulu F-nn` (from `docs/feedback/2026-10-20-kukulu.md`) or the 0.7.0 SUMMARY/REVIEW item. There is no "Breaking changes" heading. A-03 and A-04 go under Changed and say which forms are now allowed or denied.
- The version reads `0.7.1` in `package.json`, `.claude-plugin/plugin.json` and `VERSION` in `mcp/server.mjs`.
- `docs/feedback/2026-10-20-kukulu.md` gets an "Addressed in" header line pointing at this spec. The file is local and gitignored, so the task edits it only if it exists, and no test reads it.

## 7. Commands

Run from the repository root. Each exits non-zero on failure and runs today on a clean checkout of `main`.

- lint: `npm run lint` (under 3 s)
- hygiene: `pre-commit run --all-files` (about 4 s)
- test: `npm test` (about 100 s; `timeoutMs: 900000`)
- the guard self-test, as `extraVerify` on `scripts/cleanroom-guard.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json` and `templates/cleanroom.example.json`: `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json`
- site, as `extraVerify` on `site/`, `docs/site/` and the three site scripts: `npm run check:site` (the browser check stays available but is not required, since nothing under `site/` changes)
- targeted mutation: `node test/{filter}.mjs` as `mutation.targeted.suite`

## 8. Phases

### Phase 0 — The guard as a tripwire

A-01 to A-06. A-01 comes first, so the review of every later guard task applies principle 1. Ends with a push. Manual check: none needed beyond CI. `NOT VERIFIED (human)`: in a live clean-room session, `git add docs/*` is allowed and `rsync evil/cleanroom.json docs/` is denied.

### Phase 1 — Pipeline friction

B-01 to B-05. Ends with a push. Manual check, `NOT VERIFIED (human)`: on a throwaway flight, commit to the base branch after the build branch is cut, then call `kukulu_task_next` and see the `chore: merge` commit.

### Phase 2 — Documentation and release

C. Version bump, CHANGELOG, `docs/HANDOFF.md`. There is no "do not merge" line: this release has nothing a human must run first.

## 9. Open questions

None block the build. Each is decided here, so the planner records it under `## Decisions` as given:

1. **Where known-gap candidates go.** Into REVIEW.md's `## Spec issues`, then SUMMARY.md, because the pipeline never edits this spec or `KNOWN_LIMITS` without a task (principle 1).
2. **Whether `policies.syncBase` defaults to true.** It does (§5.1). The 0.7.0 flight's stale base cost a typo on the page and a hand-written HANDOFF fix.
3. **One flight.** `v0-7-1`, three phases, serial.

## Appendix A: item map

### `docs/feedback/2026-10-20-kukulu.md`

| Item | Disposition |
|---|---|
| F-01 `renumber` leaves CLAUDE.md ids | fixed, B-01 |
| F-02 a `task_done` log broke check-names | fixed, B-02 and §5.3 (refusal, not a log-amend tool, since no tools are added) |
| F-03 the base branch moved after the build branch was cut | fixed, B-03 |
| F-04 review hit `maxRounds` while non-converging | declined as a mechanism change (the cap worked); root cause addressed by A-01; documentation fixed in B-04 |
| F-05 review hit `maxRoundsHard` | as F-04 |

### 0.7.0 `SUMMARY.md` and `REVIEW.md` spec issues

| Issue | Disposition |
|---|---|
| D-03 option parsing is best-effort; add to `KNOWN_LIMITS` | A-01, principle 1 |
| `cat zlib.txt` allowed, `cat ./zlib.txt` denied | A-02 |
| all of git is write-family (`git add docs/*` denied) | A-03 |
| write lists incomplete (`rsync`, `tar -C`) | A-04 |
| install's BSD-only denial reads `into null` (REVIEW Notes) | A-05 |
| D-08 check 3 does not pin `mcp/cleanroom.mjs` | A-06 |
| known gaps omit shell expansion | A-01 (entry 2; already in `KNOWN_LIMITS`, now in the docs list too) |
| hard cap passed at round 11 with no halt (REVIEW Notes) | B-04 (documentation; behavior kept) |
| the bundle's SUMMARY predates its Attestation section | B-05 |
| §1 PR against `main` while `baseBranch` is `cleanroom` | resolved: `baseBranch` is `main` (§5.1) |
| F-04 `--roots`/`--words` defaults superseded by `e7ef4d4` | resolved as built: required arguments, `--repo` defaulting to the log's repository; `docs/cleanroom.md` already says so. The uncommitted 0.7.0 SPEC edit recorded the same text, and the archive keeps the spec as committed |
| the log's uncommitted tail is unsigned | out of scope: new matter (§2) |
| FreeBSD-only install `-T`/`-M`, macOS cp `-S` | out of scope: known gaps under A-01 entry 3 |
| PROGRESS.md's R10-01 log says 481 cases, not 469 | declined: archived flight files never change |
| §1/G-01/G-02 base `cleanroom`; Appendix C changes 4, 8, 11; rule 16 vacuous for 8 and 12; `no-foundry-names` `from`; the retired-tools allowance; `mcp/cleanroom.mjs` writes; general mode at `run_start`; genesis generates the key; `docs/kukulu.json` protected once PLAN.md exists; lockdown inactive without PROGRESS.md; dirty-log tolerance and the log moving with the archive; the gate's write-before-refuse exception; the 50 ms budget beyond Node startup; `commits.txt` separator; `cleanroom.idleGapHours` in §5.1; `no-gnu-sed-inplace` excluding fixtures; `scripts-node-builtins` widening; B-03's review-history line; B-04's accent folding; B-05/Phase 2 overlap; G-02/G-03 wording; the eight cleanflate false positives listed explicitly | resolved as built in 0.7.0: each is how the code already behaves, and the archived spec plus `HANDOFF.md` record it. No task |

## Appendix B: interpretation choices made in writing this spec

Each is a place where the brief allowed two readings:

1. **The D-03 text as a principle.** It is quoted verbatim as principle 1. "Adds its class to the known gaps below" became a REVIEW.md bullet carried into SUMMARY.md, because the pipeline never edits this spec. The other reading was a doc-only fix task per candidate.
2. **`KNOWN_LIMITS` versus the amended D-03 list.** The amended text listed six gaps, and the code has seven. Matching them takes the union of both, eight entries (A-01). The other reading cut the code to six and lost the `find -exec`/`rsync` and `pathPatterns` limits.
3. **A-02's direction.** Both forms are denied (fail closed), not both allowed. A repository's `target/` directory can hold dependency sources under in-repo paths.
4. **A-04's scope.** Only `rsync` and `tar`, which the review named, become rules. `unlink`, `shred`, `perl -i` and `cargo fetch` stay known gaps. The other reading made every listed program a rule.
5. **When a guard finding is a regression.** The reviewer tests against the merge base, not only the previous round.
6. **B-01's scope.** Only the current flight's notes section is renumbered, because the rest of CLAUDE.md cites earlier flights' ids.
7. **B-02's mechanism.** The rules come from the project's constraints, not from running its lint commands, which would be slow and project-specific. Because of that, this repository needs §5.3's constraint for check-names' rule.
8. **B-03's trigger points.** Sync happens at `kukulu_run_start` and serial `kukulu_task_next`, not at `kukulu_next` or review. In 0.7.0, F-03's commit landed mid-run, so `run_start` alone would have missed it. It refuses on a conflict instead of halting, so the implementer decides.
9. **B-04.** The cap behavior is kept and the docs follow it, rather than also halting an approving review above the cap.
10. **The FreeBSD/macOS exclusion.** It covers only the options REVIEW named. It is not a reason to drop principle 1's "BSD/macOS forms where their manual pages differ".
