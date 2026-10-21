# Kūkulu 0.7.1 build plan

Derived from docs/SPEC.md v0.7.1 on 2026-10-20. SPEC.md wins over this file.

## Decisions

- Phases → SPEC §8's three phases, in order, none merged. Inside Phase 0 the order is A-01 to A-06, so the triage rule (principle 1) is in the code, the docs and the review skill before any guard rule changes.
- Parallel streams → none; the plan is fully serial, as SPEC §9 Q3 and the size recommendation say. Nearly every task edits `mcp/server.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` or `CHANGELOG.md`.
- `baseBranch` → `main`, the branch the plan is committed on and the one SPEC §5.1 names; build branches are `build/<date>`.
- §9 Q1 (where known-gap candidates go) → a `Known-gap candidates` bullet list under REVIEW.md's `## Spec issues`, carried by the summarize skill into SUMMARY.md's `## Spec issues`. The pipeline never edits SPEC or `KNOWN_LIMITS` without a task.
- §9 Q2 (`policies.syncBase` default) → `true`, an owner decision and not an ⚠️ ASSUMPTION (§5.1); written once, in `cfgFrom`. The 0.7.0 flight's stale base cost a typo on the page and a hand-written HANDOFF fix.
- §9 Q3 (one flight) → `v0-7-1`, three phases, serial.
- Constraints → all 27 rules of `docs/flights/v0-7-0/kukulu.json` carried over with identical patterns, flags, paths, excludes and fixtures (principle 7), plus §5.3's `progress-no-bare-macron`. Two flight-specific `from` values are dropped because the tasks they waited for landed in 0.7.0: `no-foundry-names`' `from: P0-05` (the tree is clean of the name today, so the rule is active from the first task) and the guard self-test's `from: P3-11`. The file is written ASCII-only, with JSON escapes for the non-ASCII characters of the old descriptions and fixtures; the parsed values are unchanged.
- `extraVerify` → SPEC §7: the guard self-test on `scripts/cleanroom-guard.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json` and `templates/cleanroom.example.json`; `npm run check:site` on `site/`, `docs/site/` and the three site scripts. The browser check is not configured, because nothing under `site/` changes.
- `maxRounds` and `maxRoundsHard` → the defaults, 3 and 6; SPEC asks for no other tolerance, and principle 1 is meant to keep the loop short.
- This flight's `docs/kukulu.json` carries no `policies` block: the plugin running the flight is the installed 0.7.0, which would refuse `policies.syncBase` as an unknown key.
- A-01's docs test → in `test/cleanroom.mjs`, which already imports `KNOWN_LIMITS`; the bundle's `coverage.knownLimits` deep-equality goes in `test/attest.mjs`. `KNOWN_LIMITS` strings are plain text without backticks; the docs bullets may use code spans, and the test removes backticks before comparing the first five whitespace-separated words.
- A-02's word clause → judges every operand of a read-family command that does not start with `-` and is not a pattern, script or program operand (`patternOperands`), the same set R4-02 resolves for `deny.paths`. The outside-the-repository clause keeps computing "outside" from path-like operands only, as today, so the eight cleanflate false positives keep their decisions.
- A-03's `-o` → none of `diff`, `log` and `show` defines a short `-o` for output (`git commit -o` is `--only`), so only `--output=<file>` and `--output <file>` stay write targets.
- A-04's rsync sources → not write targets: reading a protected path is not writing it, as A-04's `tar cf build/a.tar docs` fixture says. The whole-call containment rule ("the destination equals or contains a protected path") applies, as for `cp`, when the call is recursive (`-r`, `-a`, `--recursive`, `--archive`, also inside a short bundle or by unique prefix); a non-recursive rsync is judged by its destination and landing paths.
- A-04's remote rsync operand → SPEC says it "is already a network command under `deny.network`", but `NETWORK_COMMANDS` has no rsync and `rsync host:x build/` is allowed today. P0-05 makes SPEC's sentence true: an rsync segment with a remote operand (`host:path`, `user@host:path`, `rsync://`) is `network command rsync is denied` under `deny.network`. See Spec issues.
- A-04's tar extraction at the repository root → denied, as the rule says: the root contains the always-protected paths. P0-05 adds that fixture so the consequence is explicit; see Spec issues.
- A-05's probe → `install -S evil/cleanroom.json docs` is denied today on Linux with `install writes it into null` (probed while planning), so P0-06 changes only the message, and the platform clause of A-05 does not apply. The task still runs the probe first and records the result.
- A-06's checkpoints → `CHECKPOINT_KEYS` does not change and a checkpoint does not carry `cleanroomHash`: `signCheckpoint` refuses any field outside the fixed set, and the verifier's duplicate of that set must keep verifying 0.7.0 logs. The pin lives in genesis, `state.cleanroom`, gate check 3 and the manifest. A manifest with `plugin.cleanroomHash` over a genesis without one verifies with the note `genesis has no cleanroomHash (flight started on 0.7.0 or earlier); plugin.cleanroomHash not compared`.
- B-01's note → added when `renumber: true` changed at least one id and CLAUDE.md has no `## Flight <slug> notes` section; when `docs/kukulu.json` has no `flight`, the note reads `docs/kukulu.json has no flight slug; ids in CLAUDE.md were not renumbered`.
- B-02's rendering → the text checked is what the server writes under the log heading: the `log` for `kukulu_task_done`, `BLOCKED: <reason>` for `kukulu_task_block`, `REOPENED: <reason>` for `kukulu_task_reopen`, each with trailing whitespace removed and checked line by line. `kukulu_run_halt` writes its reason to `.kukulu/state.json` and the feedback log, not to PROGRESS.md; SPEC still names it, so its reason is checked as written (see Spec issues). The quoted text is the matching line from at most 40 characters before the match, cut to 80 characters.
- B-02's coverage test → a `paths` entry covers `docs/PROGRESS.md` when it equals it, is a directory prefix of it (`docs/`, `docs`), or is `.`; an `exclude` entry removes it by the same test.
- B-02's order → each tool runs the check after its argument checks and before its first write; for `kukulu_task_block` that is before its `git reset --hard`.
- B-03's dirty tree → when the base is ahead but the tracked tree is dirty (apart from the clean-room log), nothing is merged and the result carries `baseSynced: { commits: <n>, merge: null, skipped: "the tracked tree has uncommitted changes" }`, so the caller can see the base is ahead; the next clean call merges.
- B-03's trigger points → `kukulu_run_start` without `stream`, on a branch that already existed (not one this call cut), including the `alreadyStarted` return; serial `kukulu_task_next` without `stream`, and only when the plan declares no streams (a parallel flight syncs only at `kukulu_run_start`). A missing local `baseBranch` ref is no sync.
- B-03's merge commit → `git merge --no-ff --no-commit <baseBranch>`, then the commit through `commitStaged` with a new no-pathspec mode (git refuses a partial commit during a merge), so the signing fallback and trailers (stage `implement`, task `-`) apply. In clean-room mode a checkpoint with event `base-sync` is appended first and the log is committed in the merge commit. A merge that fails with no conflicted paths (an untracked file in the way) refuses with git's first line in place of the file list.
- B-04 → behavior kept; the schema description, `docs/mcp-tools.md`, `docs/operations.md` (Halts and the `maxRoundsHard` row) and `docs/architecture.md`'s two sentences that say "reaches" all follow the code.
- B-05 → the summarize skill already writes the Attestation section with the manifest hash from `kukulu_attest`'s result (`skills/summarize/SKILL.md`, the **Attestation** paragraph), so P1-05 only adds the `docs/cleanroom.md` sentence and cites that line in its commit.
- Changelog → tasks add lines under `## [Unreleased]` (the first task that touches CHANGELOG.md creates it above `## [0.7.0]`), under `### Changed` or `### Fixed` only; P2-02 renames it to `## [0.7.1] — <date>` with the version bump. A-03 and A-04 go under Changed; every other item under Fixed. There is no Added or Breaking changes heading.
- HANDOFF.md → no "do not merge" line (SPEC §8 Phase 2); the v0-7-0 flight notes' bold first line does not apply to this flight.
- Flight slug → `v0-7-1`, as the operator passed it.

## Conventions

- Commit template: `CLAUDE.md` `## Commit template`, title `<ID>: <title>`, written to a file and committed with `git commit -F <file>`. `Measurement: n/a` on every task: this flight tunes nothing.
- Every task's verification is `kukulu_verify` with its Files touched: `npm run lint`, `pre-commit run --all-files` and `npm test` (900 s) always; the guard self-test for clean-room paths; `npm run check:site` for site paths.
- Shared protocols are in `CLAUDE.md` `## Task protocols`; the guard-rule protocol there (fixture names ending `(<task id>)`, no fixture changes its decision unless the task names its form, `docs/cleanroom.md` in the same commit) applies to P0-03 to P0-06.
- Tests are named by their assertion message; the names below are the messages to use.

## Phase 0 — The guard as a tripwire

### P0-01: One list of known limits in the code and the docs

**Goal:** `KNOWN_LIMITS` becomes SPEC A-01's eight entries, and `docs/cleanroom.md` lists the same eight, opens the guard section with the tripwire paragraph and states when a guard gap is a defect.

**Files touched:** `mcp/cleanroom.mjs`, `docs/cleanroom.md`, `test/cleanroom.mjs`, `test/attest.mjs`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principle 1 (the quoted text), §6 A-01; CLAUDE.md Constraints `cleanroom-module-pure` and `server-synchronous` (no `async`/`await` in `mcp/cleanroom.mjs`, comments and strings included; no new imports).
- `KNOWN_LIMITS` is exactly eight plain-text strings (no backticks), in A-01's order, each ending in a period; tighten wording only, never substance. Entry 3 says the guard judges a command by its text, that its wrapper and option parsing follows GNU coreutils, findutils and sudo (and BSD/macOS forms where their manual pages differ), and that no table can be proved complete across tool versions. Entry 4 lists `find -exec`, `watch`, `parallel`, `busybox`, `unlink`, `shred`, `perl -i` and `cargo fetch`, and no longer `rsync`. Keep the doc comment above it naming SPEC A-01.
- `docs/cleanroom.md`:
  - `## Known gaps` becomes one short lead sentence and then a bulleted list of the eight entries, one bullet each, in the same order. Each bullet, with backticks removed, contains its entry's first five whitespace-separated words joined by single spaces. Code spans are fine in the bullets.
  - `### What the guard decides` opens, before the sentence that starts "Every path", with a paragraph that begins "The guard is a tripwire, not a sandbox." followed by principle 1's quoted text up to and including "…the signed checkpoints (D-06) and the gate (D-08), not the guard." The section references become links into this file: the chain to `#the-log`, the checkpoints to `#checkpoints-and-the-key`, the gate to `#genesis-sticky-mode-and-the-gate`, worded as "the chain", "the signed checkpoints" and "the gate" rather than D-numbers.
  - A new `### When a guard gap is a defect` subsection after `### What is always protected` states the three conditions of principle 1 as bullets, then the sentence that any other unmodelled spelling is a review note whose class the reviewer lists under `Known-gap candidates` in REVIEW.md's `## Spec issues`, which the summary carries and the owner decides on.
- Under `## [Unreleased]` (create it above `## [0.7.0]` if absent) → `### Fixed`: one line citing the 0.7.0 REVIEW spec issue "D-03 option parsing is best-effort" and "known gaps omit shell expansion".

**Acceptance tests:**

- `test/cleanroom.mjs`: change the existing assertion to "KNOWN_LIMITS is the eight fixed strings" (length 8, every entry a string ending in "."); new "docs/cleanroom.md's Known gaps lists KNOWN_LIMITS one bullet each, in order" (read `docs/cleanroom.md` only after checking `git ls-files docs/cleanroom.md` lists it; take the lines between `## Known gaps` and the next `## ` heading or the end; the `- ` bullets must number 8 and bullet i, backticks removed, must contain entry i's first five words); new "docs/cleanroom.md opens the guard section with the tripwire paragraph" (the first paragraph under `### What the guard decides` starts with "The guard is a tripwire, not a sandbox."); new "docs/cleanroom.md has a When a guard gap is a defect subsection".
- `test/attest.mjs`: the existing coverage assertion becomes "the coverage section carries the known limits and the idle threshold" with `JSON.stringify(manifest.coverage.knownLimits) === JSON.stringify(KNOWN_LIMITS)` (import it from `mcp/cleanroom.mjs`) and `idleGapHours === 3`.

**Out of scope:** any guard rule (P0-03 to P0-06); the skills (P0-02); README (P2-01); `scripts/verify-attestation.mjs` (the verifier reads `knownLimits` from the manifest and has no list of its own).

**Verification:** `kukulu_verify` with `mcp/cleanroom.mjs` in Files touched, so the guard self-test runs.

**Depends on:** none

### P0-02: Guard-finding triage in the review and summarize skills

**Goal:** The review-build skill tells the reviewer when a guard finding becomes a fix task and where every other unmodelled spelling goes, and the summarize skill carries those candidates into SUMMARY.md.

**Files touched:** `skills/review-build/SKILL.md`, `skills/summarize/SKILL.md`, `test/plugin.mjs`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principle 1 (including the paragraph after the quote), §6 A-01's skill bullets, Appendix B item 5; CLAUDE.md "Prose names only real tools" (name no `kukulu_*` tool the server lacks); `no-hardcoded-mutation-fix-rounds` (no `2` beside `mutationFixRounds` in skills).
- `skills/review-build/SKILL.md`: a **Guard findings.** paragraph immediately after the **Clean-room mode.** paragraph. It applies when a finding's evidence is a command form the guard allows. It states the three conditions for a fix task (a regression: denied at an earlier commit of the flight, allowed now; a write to an always-protected path or a read under `deny.paths` with a command word and option spelling that `docs/cleanroom.md`'s rules or `test/fixtures/guard-cases.json` already name; a rule missing for a whole command word the rules list). It tells the reviewer to check the regression case against the merge base, not only the previous round: `git show <merge-base>:mcp/cleanroom.mjs` into a temp directory (the module imports only `node:` modules, so the copy runs alone) and run the form through that copy's `evaluate`, or `git worktree add` the merge base in a temp directory and pipe the hook payload to its `scripts/cleanroom-guard.mjs`. It puts every other unmodelled spelling under `## Spec issues` → `Known-gap candidates`, one bullet per class with one example, and never queues a task for it.
- `skills/summarize/SKILL.md`: in the **Spec issues** item, one sentence: copy the `Known-gap candidates` bullets from the final REVIEW.md, verbatim, into SUMMARY.md's `## Spec issues` under the same label.
- Write the display name with its macron in prose; the identifier `kukulu` stays ASCII.
- `CHANGELOG.md` → `### Fixed`: the review-build skill's guard triage, citing kukulu F-04 and F-05's root cause (0.7.0's eleven review rounds).

**Acceptance tests:** `test/plugin.mjs`: new "the review-build skill has a Guard findings paragraph after the clean-room paragraph" (the `**Guard findings.**` line comes after the `**Clean-room mode.**` line and contains "Known-gap candidates" and "merge base"); new "the summarize skill carries Known-gap candidates into SUMMARY.md"; the existing prose check that skills name only real tools still passes.

**Out of scope:** any other skill or agent; `KNOWN_LIMITS` and `docs/cleanroom.md` (P0-01).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P0-03: Bare and ./ read-family operands get the same decision

**Goal:** A read-family operand without a `/` is judged by the word clause like the same operand written `./x`, so `cat zlib.txt` and `cat ./zlib.txt` are both denied.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 3, 6 and 8, §6 A-02, Appendix B item 3 (fail closed: both denied); CLAUDE.md guard-rule protocol; `cleanroom-module-pure`, `server-synchronous`.
- In `evaluate`'s rule 6c (`// 6c. read-family commands and forbidden words`), the word clause today checks only `realPaths` (path-like operands that are not patterns). It must also check every operand that does not start with `-` and is not in `patternOperands(word, rest)`: the operands R4-02's bare block already resolves for `deny.paths`. Same reason as today: `forbidden word in path argument: <token>`, and the same `allow.paths` exemption (`exempt(tokenPath(t))`, resolved against the shell's current directory).
- The outside-the-repository clause keeps computing "outside" from path-like operands only, unchanged. Pattern, script and program operands (grep/rg/ag/ack patterns, the sed script, the awk program, find's `-name`/`-path`/`-regex` values) stay text.
- The eight `cleanflate false positive …` fixtures and `cleanflate real prior-art attempt …` keep their decisions and reasons. An existing fixture may change its `expect` or `reason` only when its command is a read-family command with a bare operand containing a `deny.words` entry (the form A-02 names); list every changed fixture by name in the commit body. Any other fixture whose decision changes means the change is wrong: fix the code, not the fixture.
- `docs/cleanroom.md`: the `deny.words` table row and rule 6's read-family clause say the word clause judges every operand of a read-family command that is not a pattern, script or program, with or without a `/`.
- `CHANGELOG.md` → `### Fixed`: `cat zlib.txt` is now denied like `cat ./zlib.txt` (0.7.0 REVIEW spec issue).

**Acceptance tests:** `test/fixtures/guard-cases.json`, policy `"template"`, tool Bash, cwd `__ROOT__`, names ending ` (P0-03)`: denied `cat zlib.txt`, `head -n 5 zlib.txt`, `less miniz.c` (reason `forbidden word in path argument`); allowed `grep -n zlib src/a.rs`, `sed -n 's/zlib/x/p' src/a.rs`; and allowed `cat zlib.txt` under an inline policy `{ "version": 1, "deny": { "words": ["zlib"] }, "allow": { "paths": ["."] } }` (a relative `allow.paths` entry is repo-relative, so `.` covers the repository root; the self-test substitutes `__ROOT__` only in `input`). `test/cleanroom.mjs`, which runs every fixture, passes.

**Out of scope:** git, rsync, tar and install (P0-04 to P0-06); `KNOWN_LIMITS`.

**Verification:** `kukulu_verify` (runs the guard self-test); `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` prints `ok`.

**Depends on:** none

### P0-04: git forms that write only the index are not write targets

**Goal:** The pathspec operands of `git add`, `commit`, `diff`, `status`, `log`, `show`, `blame`, `ls-files` and `grep` are no longer write-family targets, so `git add docs/*` and `git add docs/cleanroom.json` are allowed.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 3, 6 and 8, §6 A-03; CLAUDE.md guard-rule protocol; `cleanroom-module-pure`, `server-synchronous`.
- In rule 6d, for `word === "git"` with `gitParts(rest).sub` one of those nine subcommands, the operands after `subIndex` are skipped by the protected-path and wildcard checks, except the value of `--output=<file>` or `--output <file>` on `diff`, `log` and `show`, which stays a write target (none of the three defines a short `-o` for output; `git commit -o` is `--only`). git's global options before the subcommand are handled as now.
- Unchanged: every other git subcommand stays write-family, including `rm`, `mv`, `checkout`, `restore`, `clean`, the worktree-discard forms (`stash`, `reset --hard|--merge|--keep`, `checkout -f`, `switch -f|--discard-changes`, `read-tree -u`), `git config core.hooksPath`, redirections (`git log > docs/cleanroom.json` is still denied), rule 6b's `deny.paths` check and the network rule.
- Existing fixtures that may change decision are only those whose command is one of the nine subcommands naming a protected path or a wildcard that can name one; list each in the commit body.
- `docs/cleanroom.md` rule 6: "`git`" in the write-family list gains "(except the pathspecs of `add`, `commit`, `diff`, `status`, `log`, `show`, `blame`, `ls-files` and `grep`, which write only `.git/` or nothing; `--output` of `diff`, `log` and `show` is still a target)".
- `CHANGELOG.md` → `### Changed`: `git add docs/*`, `git add docs/cleanroom.json` and the other index-only forms are now allowed; `git diff --output=<protected>` is still denied.

**Acceptance tests:** `test/fixtures/guard-cases.json`, policy `"template"`, cwd `__ROOT__`, names ending ` (P0-04)`: allowed `git add docs/*`, `git add docs/cleanroom.json`, `git commit -m x docs/a.md`, `git -C . diff docs/kukulu.json`; denied (reason `protected path`) `git diff --output=docs/cleanroom.json`, `git diff --output docs/cleanroom.json`, `git checkout docs/cleanroom.json`, `git restore .kukulu`, `git log > docs/cleanroom.json`. `test/cleanroom.mjs` passes.

**Out of scope:** the network rule's git handling; any non-git command.

**Verification:** `kukulu_verify` (runs the guard self-test).

**Depends on:** none

### P0-05: rsync and tar extraction into a protected path are denied

**Goal:** Two write-family rules: `rsync` judges its destination like `cp`, and a `tar` extraction whose directory equals or contains a protected path is denied, as is a create, append or update whose archive file is protected.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 3, 6 and 8, §6 A-04, Appendix B item 4 (only rsync and tar); CLAUDE.md guard-rule protocol; `cleanroom-module-pure`, `server-synchronous`.
- **rsync.** Options are scanned with the existing getopt-style scanner (`scanOption`), with valued options `-e|--rsh`, `--rsync-path`, `-T|--temp-dir`, `--backup-dir`, `--files-from`, and the `--exclude`/`--include`/`--filter` families (`--exclude`, `--exclude-from`, `--include`, `--include-from`, `--filter`, short `-f`). The last non-option operand is the destination; the others are sources, which are not write targets. Judge the destination, each `<destination>/<basename of source>` landing path (a source ending in `/` or with basename `.` stands for the destination itself), and, when the call is recursive (`-r`, `-a`, `--recursive`, `--archive`, in a bundle such as `-av` or by unique prefix), the whole call when the destination equals or contains a protected path. Reason: `protected path: <path> (rsync writes it into <destination as written>)`. Reuse `destinationPaths`/`destinationPathsFor` with a `COPY_SPECS.rsync` entry if it fits; otherwise a small sibling function.
- **rsync remote operands.** An rsync segment with an operand of the form `host:path`, `user@host:path` (a `:` before the first `/`) or `rsync://…` is `network command rsync is denied` under `deny.network` (rule 6a). SPEC A-04 says this is already so; it is not today, and this task makes it true.
- **tar.** Extraction is `-x`, `--extract` or `--get`, `x` inside a short bundle (`-xf`, `-xvzf`), or an old-style first argument (not starting with `-`) containing `x` (`xf`, `xvzf`). Its directory is the value of `-C`/`--directory` (`-C dir`, `-Cdir`, `--directory=dir`, `--directory dir`), else the shell's current directory after any earlier `cd`. An extraction whose directory equals or contains a protected path is denied: `protected path: <protected path> (tar extracts into <directory>; the archive's contents cannot be known)`. This also denies an extraction at the repository root, which contains the always-protected paths. In create, append and update modes (`-c`, `-r`, `-u`, `--create`, `--append`, `--update`, or those letters in a bundle or an old-style first argument) the `-f`/`--file` value is a write target (in old style the values follow in letter order: `tar cf X src` gives `f` the value `X`). tar's short options that take a value: `-f -C -T -X -b -H -K -L -N -V -g`. Listing (`-t`, `tf`) writes nothing.
- Keep `tar` and `rsync` in `recursiveOperands` (the read reach rule) as they are.
- `docs/cleanroom.md` rule 6 names both rules, and the deny.network row of the policy table lists an rsync remote operand.
- `CHANGELOG.md` → `### Changed`: `rsync` into a protected path, a recursive `rsync` into a directory that contains one, an rsync remote operand, a `tar` extraction into a directory that equals or contains a protected path (including the repository root), and `tar c|r|u` onto a protected archive path are now denied.

**Acceptance tests:**

- `test/fixtures/guard-cases.json`, policy `"template"`, cwd `__ROOT__`, names ending ` (P0-05)`: denied (reason `protected path`) `rsync evil/cleanroom.json docs/`, `rsync -a evil/ .kukulu/`, `tar xf evil.tar -C docs`, `tar -x -f evil.tar --directory=.kukulu`, `cd docs && tar xf ../evil.tar`, `tar cf docs/cleanroom.json src`, `tar xf a.tar`; denied (reason `network command rsync is denied`) `rsync host:x build/` and `rsync -a rsync://h/m build/`; allowed `rsync -a src/ build/`, `rsync -e ssh -a src/ build/`, `tar xf a.tar -C build`, `tar tf docs.tar`, `tar cf build/a.tar docs`.
- `test/cleanroom.mjs`: new "a tar extraction denial names the directory" (`evaluate` on `tar xf evil.tar -C docs`, with the template policy, a known root and the protected list `protectedPaths` gives with `policyPath` `<root>/docs/cleanroom.json` and `planExists: true`, returns exactly `protected path: <root>/docs/cleanroom.json (tar extracts into docs; the archive's contents cannot be known)`, the first protected path in `protectedPaths` order under the directory) and "an rsync denial names its destination" (`rsync evil/cleanroom.json docs/` returns exactly `protected path: <root>/docs/cleanroom.json (rsync writes it into docs/)`).

**Out of scope:** `unlink`, `shred`, `perl -i`, `cargo fetch` (known gaps, Appendix B item 4); rsync `--remove-source-files` (a known-gap candidate); `KNOWN_LIMITS`.

**Verification:** `kukulu_verify` (runs the guard self-test).

**Depends on:** none

### P0-06: install's BSD-only denial names its directory

**Goal:** When only the BSD reading of `install -S` lands a source on a protected path, the denial names that reading's directory instead of `null`.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 3 and 6, §6 A-05; CLAUDE.md guard-rule protocol; `cleanroom-module-pure`, `server-synchronous`.
- First the probe: run `install -S evil/cleanroom.json docs` (policy template, cwd the repository root) through `evaluate` and record the decision and reason in the commit's `Interpretation:` line. When planning it was denied with `protected path: <root>/docs/cleanroom.json (install writes it into null)`. If the probe finds it allowed, make the BSD reading apply on every platform, say so in `Interpretation:`, and add that fixture as denied.
- Today `destinationPaths` returns `dir: gnu.dir` for install, which is `null` when only the BSD reading has a destination. Carry the directory per target (each target remembers the `dir` of the reading that produced it), so the reason is `protected path: <path> (install writes it into <dir>)` with the directory as written. cp, mv and ln messages do not change.
- The existing fixture `shell: install -S evil/cleanroom.json docs (R8-01)` keeps `expect: denied`; its reason may stay `protected path`.
- `CHANGELOG.md` → `### Fixed`: install's BSD-only denial named `null` as its directory (0.7.0 REVIEW Notes).

**Acceptance tests:**

- `test/fixtures/guard-cases.json`, policy `"template"`, cwd `__ROOT__`, names ending ` (P0-06)`: denied `install -S evil/cleanroom.json docs` (the BSD reading) with reason `protected path: .*/docs/cleanroom\.json \(install writes it into docs\)`; denied `install -S .bak evil/cleanroom.json docs` (the GNU reading) with the same reason pattern; allowed `install -S .bak a.txt build/`.
- `test/cleanroom.mjs`: new "install's BSD-only denial names its directory" (`evaluate` returns exactly `protected path: <root>/docs/cleanroom.json (install writes it into docs)` for the BSD-only form, and the reason does not contain `null`) and "install's GNU-reading denial names its directory".

**Out of scope:** FreeBSD `-T`/`-M` and macOS cp `-S` (non-goals, §2); any other install option.

**Verification:** `kukulu_verify` (runs the guard self-test).

**Depends on:** none

### P0-07: The gate, the genesis and the manifest pin mcp/cleanroom.mjs

**Goal:** `pluginHashes()` adds `cleanroomHash`, genesis records it, gate check 3 compares it, the manifest carries it as `plugin.cleanroomHash`, and the verifier compares it with genesis, while 0.7.0 records stay readable.

**Files touched:** `mcp/server.mjs`, `scripts/verify-attestation.mjs`, `test/cleanroom.mjs`, `test/attest.mjs`, `docs/cleanroom.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 3, 4, 8 and 10, §6 A-06; CLAUDE.md Constraints `server-synchronous`, `one-hash-one-signature` (`createHash("sha256")` only), `verifier-node-only` (the verifier imports only `node:` modules), the reviewer rule that the verifier duplicates the chain and signature code on purpose; CLAUDE.md "Clean-room tests" (doctored plugins are temp copies started with `startServer(repo, { server })`).
- `pluginHashes()` returns `{ guardHash, loggerHash, hooksHash, cleanroomHash }`, `cleanroomHash` being the SHA-256 (`policyHash`) of `mcp/cleanroom.mjs` under `PLUGIN_ROOT`. Genesis data and `state.cleanroom` record it after `hooksHash`.
- `checkpoint()` keeps signing exactly `CHECKPOINT_KEYS` (unchanged, in both `mcp/cleanroom.mjs` and the verifier): pass it only `guardHash`, `loggerHash` and `hooksHash`, never the spread of `pluginHashes()`, since `signCheckpoint` refuses any other field.
- Gate check 3 (`guard`) also compares `cleanroomHash` when `state.cleanroom.cleanroomHash` is recorded, failing with `mcp/cleanroom.mjs changed since genesis`. When it is not recorded (a flight started on 0.7.0), skip that one comparison and the passing gate entry's data gains `unpinned: ["mcp/cleanroom.mjs"]`. The gate's checks and count stay seven.
- `kukulu_attest`'s manifest `plugin` object gains `cleanroomHash` after `hooksHash` (it comes from `pluginHashes()`).
- `scripts/verify-attestation.mjs` check 6 (`guard`): when `manifest.plugin.cleanroomHash` and genesis `data.cleanroomHash` are both present and differ, fail `guard` with `the manifest's plugin.cleanroomHash differs from the genesis entry's cleanroomHash`. Manifest field absent: pass with the note `plugin.cleanroomHash absent (bundle from 0.7.0 or earlier)`. Manifest field present, genesis field absent: pass with the note `genesis has no cleanroomHash (flight started on 0.7.0 or earlier); plugin.cleanroomHash not compared`.
- `docs/cleanroom.md`: the gate's check 3 names the fourth file; the genesis paragraph lists the module's hash; the manifest field list's `plugin` line names it; one sentence on the 0.7.0 fallbacks (`unpinned`, the verifier's notes). `docs/mcp-tools.md` `kukulu_attest`: the `plugin.cleanroomHash` field; `kukulu_next`'s gate text, if it lists the pinned files, names the fourth.
- `CHANGELOG.md` → `### Fixed`: gate check 3 now pins `mcp/cleanroom.mjs` (0.7.0 REVIEW spec issue "D-08 check 3 does not pin `mcp/cleanroom.mjs`").

**Acceptance tests:**

- `test/cleanroom.mjs`: update the genesis assertions ("...whose data names mode, the five hashes, pluginVersion, keyFingerprint, baseBranch and head", with `cleanroomHash` after `hooksHash`; "...and records state.cleanroom" including `cleanroomHash`); new "the genesis records the hash of mcp/cleanroom.mjs"; new "an edited mcp/cleanroom.mjs under a temp PLUGIN_ROOT halts naming the file" (edit after genesis, as the existing guard and logger cases do; the gate fails `guard` with `mcp/cleanroom.mjs changed since genesis`); new "a genesis without cleanroomHash passes the gate and records unpinned" (delete the key from `state.cleanroom` and commit it as an old flight would have it; the gate entry's `data.unpinned` is `["mcp/cleanroom.mjs"]`).
- `test/attest.mjs`: new "the manifest's plugin object carries cleanroomHash"; new "a bundle without plugin.cleanroomHash verifies with the absent note"; new "a bundle whose plugin.cleanroomHash differs from genesis fails the guard check" (each re-signs the edited manifest, as the existing tamper tests do). The existing tamper tests keep passing.

**Out of scope:** `CHECKPOINT_KEYS`; the other six gate checks; the number of checks.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P0-08: Phase 0 end: push and record the manual check

**Goal:** Push the branch with the guard changes and record Phase 0's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 0. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task: `git commit --allow-empty -F <file>` with the subject `P0-08: Phase 0 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): in a live clean-room session with the working-tree plugin (claude --plugin-dir .), git add docs/* is allowed and rsync evil/cleanroom.json docs/ is denied; CI is green on the pushed branch`.

**Depends on:** none

## Phase 1 — Pipeline friction

### P1-01: renumber rewrites ids in the flight's CLAUDE.md notes

**Goal:** `kukulu_plan_commit({ renumber: true })` also rewrites the renumbered ids inside CLAUDE.md's `## Flight <slug> notes` section, and only there.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 2 to 4, §6 B-01, Appendix B item 6; CLAUDE.md reviewer rule that only `kukulu_plan_commit`'s renumber mode accepts a suffix id, and `TASK_ID`/`TASK_LINE` stay unchanged; CLAUDE.md "Commit-failure tests"; `server-synchronous`.
- `<slug>` is `docs/kukulu.json`'s `flight` (from the possibly renumbered config text). The section runs from the line `## Flight <slug> notes` to the line before the next line starting `## `, or the end of the file. Apply the same single-pass `swap` (`SPLIT_ID` and the same map) to that slice only; text outside it is history and stays byte-identical.
- Read CLAUDE.md with the other texts, before validation, and write it inside the existing `withRollback` (its path is already in `paths`), only when the slice changed. A failed commit leaves CLAUDE.md byte-identical.
- Notes: when the map is non-empty and the section is absent, add `CLAUDE.md has no "## Flight <slug> notes" section; ids there were not renumbered`; when the config has no `flight`, add `docs/kukulu.json has no flight slug; ids in CLAUDE.md were not renumbered`.
- `docs/mcp-tools.md` `kukulu_plan_commit`: the Arguments paragraph names the CLAUDE.md section, and the Returns paragraph lists the new notes.
- `CHANGELOG.md` → `### Fixed`: kukulu F-01.

**Acceptance tests:** `test/state.mjs`, in the renumber block: new "renumber rewrites a split id inside the flight's CLAUDE.md notes"; "renumber leaves the same id outside the notes section unchanged" (an earlier flight's section and the top of the file cite it); "the notes section ends at the next level-2 heading" (an id in the following `## ` section is unchanged); "renumber notes a CLAUDE.md without the flight's notes section" (the exact note text, CLAUDE.md byte-identical); "a failed renumber commit leaves CLAUDE.md byte-identical" (a `commit-msg` hook that rejects `plan:`; HEAD unmoved, nothing staged).

**Out of scope:** `R` ids; any other file; the validation checks.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-02: Refuse task and halt text that would break a PROGRESS.md constraint

**Goal:** `kukulu_task_done`'s `log`, `kukulu_task_block`'s and `kukulu_task_reopen`'s `reason` and `kukulu_run_halt`'s `reason` are checked against every active constraint that covers `docs/PROGRESS.md` and refused before anything is written.

**Files touched:** `mcp/server.mjs`, `test/implement.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 2, 3, 4 and 9, §5.3, §6 B-02, Appendix B item 7; CLAUDE.md principle "Tools validate, then mutate"; `server-synchronous`.
- One helper (for example `refuseProgressText(field, text, tool)`) used by all four tools. It takes `cfg().constraints`, keeps those whose `paths` cover `docs/PROGRESS.md` and whose `exclude` does not (an entry covers it when it equals it, is a directory prefix of it such as `docs/` or `docs`, or is `.`), drops those whose own `shouldMatch`/`shouldNotMatch` fixtures fail (`kukulu_verify` reports them), drops those `inactiveUntil(c.from, parseProgress())` says are waiting, and tests each line of the rendered text. Share the fixture self-test with `checkConstraints` rather than copying it.
- Rendered text: `kukulu_task_done` the `log`; `kukulu_task_block` `BLOCKED: <reason>`; `kukulu_task_reopen` `REOPENED: <reason>`; trailing whitespace removed, as `appendLog` does. `kukulu_run_halt` writes no PROGRESS.md text, but SPEC names it: check its `reason` as given.
- Refusal: `<field> would break constraint <id> (<description>) in docs/PROGRESS.md at "<excerpt>"; rewrite it without that text and call <tool> again`, where `<field>` is `log` or `reason`, `<tool>` the tool's name, and `<excerpt>` the matching line from at most 40 characters before the match, cut to 80 characters.
- Placement: after each tool's argument checks and before its first write. In `taskBlock` that is before `git reset --hard`; in `runHalt` before `withRollback`. The stream variants of done and block are checked the same way.
- `docs/mcp-tools.md`: the refusal on all four tools' **Refuses when:** lines.
- `CHANGELOG.md` → `### Fixed`: kukulu F-02 (a refusal, not a log-amend tool).

**Acceptance tests:** `test/implement.mjs`, each test writing its own constraint into the temp repo's `docs/kukulu.json` (for example id `no-todo` with paths `["docs/PROGRESS.md"]`, pattern `\bTODO\b`, and fixtures): "task_done refuses a log that breaks a PROGRESS.md constraint", "task_block refuses a reason that breaks a PROGRESS.md constraint", "task_reopen refuses a reason that breaks a PROGRESS.md constraint", "run_halt refuses a reason that breaks a PROGRESS.md constraint" (each asserts the full message, and that HEAD and `docs/PROGRESS.md` are byte-identical afterwards; for block, that the attempt's uncommitted file is still there, proving no reset ran); "an inactive constraint does not refuse a task log" (`from` a todo task); "a constraint scoped to other paths does not refuse a task log"; "a constraint whose fixtures fail does not refuse a task log".

**Out of scope:** a log-amend tool (no tools are added); running the project's lint commands; `kukulu_verify` itself.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-03: policies.syncBase merges the base branch into the build branch

**Goal:** With `policies.syncBase` true (the default), `kukulu_run_start` on an existing build branch and serial `kukulu_task_next` merge new local `baseBranch` commits into the build branch through the commit helper, and refuse on a conflict leaving everything as it was.

**Files touched:** `mcp/server.mjs`, `test/implement.mjs`, `test/plugin.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §3 principles 2 to 5, §5.1, §6 B-03, Appendix B item 8; CLAUDE.md "Adding a `docs/kukulu.json` key", "Signing tests", principle 3; `server-synchronous`; `no-sync-merge` (unaffected: it concerns `gh pr merge`).
- Config: `POLICY_KEYS` gains `syncBase`; `validatePolicies` refuses a non-boolean with `docs/kukulu.json policies.syncBase must be a boolean`; `cfgFrom` sets `syncBase: c.policies?.syncBase ?? true` (an owner decision, not an ⚠️ ASSUMPTION; no marker comment).
- One helper, `syncBase(tool)`: when `policies.syncBase` is true and the local `refs/heads/<baseBranch>` exists, count `git rev-list --count HEAD..<baseBranch>`; nothing is fetched. Count 0: do nothing. Tracked tree dirty apart from the clean-room log (`trackedDirtyLines()`): merge nothing and return `{ commits: n, merge: null, skipped: "the tracked tree has uncommitted changes" }`. Otherwise run `git merge --no-ff --no-commit <baseBranch>`. On failure collect `git diff --name-only --diff-filter=U`, run `git merge --abort`, and refuse `<baseBranch> has <n> commits this branch lacks and they conflict in <files>; resolve the merge by hand on <branch>, commit it, then call <tool> again, or set policies.syncBase to false` (with no conflicted paths, `the merge failed: <git's first line>` in place of `they conflict in <files>`). It never halts. On success, in clean-room mode append a `checkpoint` (event `base-sync`, stage `implement`) and stage the log, then commit through `commitStaged` with message `chore: merge <baseBranch> into <branch>` and trailers stage `implement`, task `-`; return `{ commits: n, merge: <short sha> }`.
- `commitStaged` gains a no-pathspec mode for this commit (git refuses `git commit -- <paths>` during a merge); the signing fallback retry uses the same mode. If the commit throws, `git merge --abort` and rethrow, so HEAD and the tree are as they were.
- `runStart`: only without `stream`, and only on a branch that already starts with `branchPrefix` (not one this call cuts from the base), before the `alreadyStarted` return and before any other write; both results gain `baseSynced` when the helper returns something. `taskNext`: only without `stream` and only when no task in PROGRESS.md has a stream; after `requireGate`, before a task is chosen; every result shape gains `baseSynced` when present. Stream worktrees never sync.
- Docs: `docs/operations.md` configuration table row `policies.syncBase` (`true`; what it merges, when, that nothing is fetched, the refusal, and that `false` keeps the 0.7.0 behavior), and the example JSON block if it lists policies. `docs/mcp-tools.md`: `kukulu_run_start` and `kukulu_task_next` describe the sync, `baseSynced`, and the refusal. `docs/cleanroom.md`: merged base commits carry no `Kukulu-Stage` trailer, so `coverage.gaps` lists them as `untrailed-commit`, which is the honest record.
- `test/plugin.mjs`: the config-keys loop's `policies` branch gains "operations.md documents policies.syncBase".
- `CHANGELOG.md` → `### Fixed`: kukulu F-03, naming the new optional key.

**Acceptance tests:** `test/implement.mjs` (temp repos; a base commit added after the build branch is cut): "run_start merges an ahead base into an existing build branch" (subject `chore: merge main into <branch>`, `baseSynced.commits` 1, the base's file present); "task_next merges an ahead base before choosing a task"; "an equal base is not merged" (HEAD unmoved, no `baseSynced`); "a conflicting base refuses and leaves HEAD and the tree byte-identical" (the full message; HEAD, `git status --porcelain` and the conflicting file unchanged; no `MERGE_HEAD`); "a dirty tree skips the base sync"; "syncBase false skips the base sync"; "a stream task_next never merges the base" (build a streamed plan with the harness's `plannedRepo`/`planDoc`, as `test/streams.mjs` does; if that needs helpers that exist only in `test/streams.mjs`, put this one assertion there and say so in `Interpretation:`); "validatePolicies refuses a non-boolean syncBase" (through any tool that reads config, asserting the message). `test/plugin.mjs`: "operations.md documents policies.syncBase".

**Out of scope:** fetching; syncing at `kukulu_next`, review or summarize; stream merges; halting on a conflict.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-04: The hard cap's documentation says what reviewSubmit does

**Goal:** Every description of `maxRoundsHard` says that a review numbered above it that requests changes halts the flight and an approving review ends it, and tests pin both behaviors.

**Files touched:** `mcp/server.mjs`, `test/review.mjs`, `test/protocol.mjs`, `docs/mcp-tools.md`, `docs/operations.md`, `docs/architecture.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-04, Appendix B item 9; Appendix A F-04/F-05 (no cap mechanism changes).
- Behavior unchanged. Only text: `kukulu_flight_options`' `maxRoundsHard` schema description becomes "a review numbered above this that requests changes halts the flight; an approving review ends it". The same words, or a sentence containing them, in `docs/mcp-tools.md` (`kukulu_flight_options` and `kukulu_review_submit`, whose "when the new round reaches `maxRoundsHard`" becomes "is numbered above"), `docs/operations.md` (the Halts section's Round cap paragraph and the `maxRoundsHard` configuration row) and `docs/architecture.md` (the convergence paragraph and the state-diagram label, which say "reaches"/"past").
- `CHANGELOG.md` → `### Fixed`: kukulu F-04 and F-05 (documentation; the caps worked as designed), and the 0.7.0 REVIEW note that the hard cap passed at round 11 with no halt.

**Acceptance tests:** `test/review.mjs`: new "an APPROVED review above maxRoundsHard succeeds and sets no halt" (state at round `maxRoundsHard`, submit APPROVED as round `maxRoundsHard + 1`; no `halted` in the result or state); new "a CHANGES REQUESTED review above maxRoundsHard halts with the hard-cap message" (matches `exceeds the hard cap maxRoundsHard=`). `test/protocol.mjs` (it reads the tool schemas): "flight_options describes maxRoundsHard as halting only a review that requests changes".

**Out of scope:** any change to the cap logic or `maxRounds`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-05: The bundle's SUMMARY.md is the summary as attested

**Goal:** `docs/cleanroom.md`'s bundle section says that the bundle's `SUMMARY.md` predates the Attestation section, which lives only in the repository's copy.

**Files touched:** `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-05. No mechanism changes.
- In `## Reading a bundle`, after the file table, one sentence: "the bundle's `SUMMARY.md` is the summary as attested; the Attestation section added afterwards cites the manifest's SHA-256 and lives only in the repository's copy".
- Check `skills/summarize/SKILL.md`'s **Attestation** paragraph: it already tells the summarizer to write the manifest hash (`manifest`) from `kukulu_attest`'s result. Do not edit the skill; cite that line (file and line number) in the commit's `Interpretation:` line. If it does not, block the task saying what is missing.
- `CHANGELOG.md` → `### Fixed`: the 0.7.0 SUMMARY spec issue on E-03/F-05 (documentation).

**Acceptance tests:** none new; `test/plugin.mjs`'s existing documentation checks pass.

**Out of scope:** the skill; the bundle format.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P1-06: Phase 1 end: push and record the manual check

**Goal:** Push the branch with the friction fixes and record Phase 1's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P1-06: Phase 1 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): on a throwaway flight run with the working-tree plugin, commit to the base branch after the build branch is cut, then call kukulu_task_next and see the chore: merge commit`.

**Depends on:** none

## Phase 2 — Documentation and release

### P2-01: README calls the guard a tripwire

**Goal:** README's feature list's clean-room sentence calls the guard a tripwire whose bypasses the chain and the gate make visible.

**Files touched:** `README.md`

**Design constraints:**

- SPEC §6 C (README bullet); `site-no-patented` (write "patent pending", never the other word).
- Change only that sentence. The tool count sentence ("The server exposes twenty-five tools.") and the tool table do not change; `docs/mcp-tools.md`'s first line still reads "Twenty-five tools".
- Display name with the macron in prose; no ASCII spelling outside code spans.

**Acceptance tests:** `test/plugin.mjs`'s existing README and tool-count checks pass.

**Out of scope:** any other README section, including "Upgrading to 0.7.0".

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-02: CHANGELOG 0.7.1, the version and the feedback header

**Goal:** The release reads 0.7.1 everywhere and the changelog entry is complete.

**Files touched:** `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `mcp/server.mjs`, `README.md`

**Design constraints:**

- SPEC §1 ("the version reads 0.7.1 everywhere"), §6 C.
- Rename `## [Unreleased]` to `## [0.7.1] — <today>` with only `### Changed` and `### Fixed` (no Added, no Breaking changes). Read the lines earlier tasks added: each fixed item cites `kukulu F-nn` (`docs/feedback/2026-10-20-kukulu.md`) or the 0.7.0 SUMMARY/REVIEW item; A-03 and A-04 are under Changed and say which forms are now allowed or denied. Fill any gap.
- `0.7.1` in `package.json`, `.claude-plugin/plugin.json`, `VERSION` in `mcp/server.mjs`, and README's version badge (`version-0.7.1`, alt `Version 0.7.1`).
- When `docs/feedback/2026-10-20-kukulu.md` exists on this machine (it is gitignored), add one header line `Addressed in: docs/SPEC.md v0.7.1 (flight v0-7-1)` after its title and change nothing else; no test reads it, and it is never staged.

**Acceptance tests:** `test/plugin.mjs`'s existing "package.json and plugin.json agree on the version", "the MCP server reports the plugin's version" and "CHANGELOG.md's newest entry is the package version".

**Out of scope:** tagging, publishing or merging.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-03: Phase 2 end: push and record the release check

**Goal:** Push the release branch and record what a human checks before merging.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2. No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P2-03: Phase 2 end: push and record the release check`. The handoff written for `kukulu_run_finish` has no "do not merge" line (SPEC §8 Phase 2).

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs; merging.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): the draft PR targets main and its ci, lint and site checks are green`.

**Depends on:** none

## Spec issues

- A-04 says an rsync remote operand "is already a network command under `deny.network`, and that is unchanged". It is not: `NETWORK_COMMANDS` has no rsync, and `rsync host:x build/` and `rsync rsync://h/m build/` are allowed at `a0264c4`. Resolution: P0-05 adds the network rule and its fixtures, making SPEC's sentence true. The owner may prefer to drop it and list rsync remotes as a known gap.
- A-04's tar rule denies an extraction whose directory contains a protected path, and the repository root contains the always-protected set, so every `tar x` at the root is denied. Resolution: kept as written (fail closed), with a fixture and a CHANGELOG line saying so.
- A-04 does not say whether rsync's sources are write targets, or whether the whole-call containment is unconditional. Resolution: sources are not targets (matching `tar cf build/a.tar docs`), and containment applies to a recursive call, as for `cp`.
- B-02 names `kukulu_run_halt`, but its reason is written to `.kukulu/state.json` and the feedback log, not to `docs/PROGRESS.md`. Resolution: its reason is checked as written, against the same constraints.
- B-02's "the matching text, at most 80 characters" could mean the regex match or the line. Resolution: the matching line, from at most 40 characters before the match, cut to 80.
- B-03 does not say what happens when the base is ahead but the tree is dirty. Resolution: no merge, and `baseSynced` reports `merge: null` with `skipped`.
- A-03's "and `-o` where the subcommand defines it": none of `diff`, `log` and `show` defines a short output option. Resolution: only `--output` is a target.
- B-04's documentation fix also applies to `docs/architecture.md` and `docs/operations.md`'s `maxRoundsHard` row, which SPEC §4 does not list. Resolution: P1-04 corrects them too (principle 8).
- A-06 does not say whether checkpoints carry `cleanroomHash`. Resolution: they do not; `CHECKPOINT_KEYS` stays fixed so 0.7.0 logs verify.

## Review fixes (round 1)

### R1-01: Test the base sync's failed commit, signing fallback and parallel-plan paths

**Goal:** Each of syncBase's three untested mechanics (SPEC §3 principle 4 and CLAUDE.md principle 3: a failed final commit leaves the tree as found; SPEC B-03 step 1: signing behaves like any other server commit; SPEC B-03: a parallel flight syncs only at kukulu_run_start) has a test that fails without it.
**Files touched:** test/implement.mjs, test/streams.mjs
**Design constraints:** SPEC §3 principle 4, §6 B-03; CLAUDE.md Task protocols 'Commit-failure tests' (an executable .git/hooks/commit-msg that exits 1 when the subject starts with `chore: merge`) and 'Signing tests' (a failing signer is local commit.gpgsign true, gpg.format openpgp, gpg.program /nonexistent-signing-agent); `server-synchronous`. Change mcp/server.mjs only if a new test exposes a real bug, and then name the bug in the commit's Interpretation line.
**Acceptance tests:** test/implement.mjs: new "a failed base-sync merge commit leaves HEAD, the tree and the index as they were" (base ahead by one commit, commit-msg hook rejecting `chore: merge`; kukulu_task_next is an error; HEAD unmoved, no .git/MERGE_HEAD, `git status --porcelain` empty, `git diff --cached --name-only` empty, base.txt absent). New "a base sync whose signing fails under signing auto is retried unsigned and lands the merge commit" (failing signer; the result has baseSynced.commits 1, HEAD is a two-parent commit with subject `chore: merge main into <branch>`, the tree is clean). test/streams.mjs: new "a serial task_next in a plan with streams never merges the base" (waveRepo, serial kukulu_run_start, then a base commit, then serial kukulu_task_next: no baseSynced, HEAD unmoved, base.txt absent), plus "...while a serial run_start on the existing build branch does" (baseSynced.commits 1).
**Out of scope:** Any change to syncBase's behavior or messages; fetching; stream worktree merges; docs.
**Verification:** kukulu_verify green. Then kukulu_mutate on mcp/server.mjs kills each mutant: (1) delete `git(["merge", "--abort"], { allowFail: true });` from the catch after commitStaged in syncBase (targeted suite, filter implement); (2) replace `"commit", "-q", "-m", message, ...pathspec(all)]);` with `"commit", "-q", "-m", message, "--", ...all]);` (filter implement); (3) replace `stream === undefined && !parseProgress().tasks.some((t) => t.stream) ? syncBase` with `stream === undefined ? syncBase` (filter streams).
**Depends on:** none

### R1-02: Guard fixtures for tar append/update, --get, rsync -e and the rsync/tar wildcard checks

**Goal:** Every A-04 spelling SPEC names (tar -r, -u and their long forms, --get, rsync -e|--rsh as a valued option), and the wildcard checks on rsync's targets and tar's archive file, has a fixture whose decision changes if the mechanic is removed.
**Files touched:** test/fixtures/guard-cases.json
**Design constraints:** SPEC §3 principles 3 and 6 (add fixtures only; no existing fixture's expect or reason changes), §6 A-04. Fixture names end in ` (R1-02)`, policy "template", tool Bash, cwd __ROOT__. Keep the file's one-space JSON indent (HANDOFF codebase notes). Do not change mcp/cleanroom.mjs: each form below is already denied today.
**Acceptance tests:** test/fixtures/guard-cases.json, all denied with reason `protected path`: `tar -rf docs/cleanroom.json x`, `tar uf docs/cleanroom.json src`, `tar --append --file=docs/cleanroom.json x`, `tar --update -f docs/cleanroom.json src`, `tar --get -f a.tar -C docs`, `rsync evil/cleanroom.json docs -e ssh` (the -e value must be skipped for docs to be the destination), `rsync evil/x docs/cleanroom.js??` and `tar cf docs/cleanroom.js?? src` (both with the `can be named by the wildcard` reason). test/cleanroom.mjs, which runs every fixture, and the guard self-test pass.
**Out of scope:** Any guard rule change; rsync deletion options and bsdtar/gtar (known-gap candidates in REVIEW.md); KNOWN_LIMITS; docs.
**Verification:** kukulu_verify with test/fixtures/guard-cases.json in files (runs the guard self-test). Then kukulu_mutate on mcp/cleanroom.mjs (targeted suite, filter cleanroom) kills each mutant: `writesArchive: ["c", "r", "u", "A", "D"].some` to `writesArchive: ["c"].some`; `"--extract": "x", "--get": "x",` to `"--extract": "x",`; `short: new Set("eTfBM"),` to `short: new Set("TfBM"),`; deleting the rsync block's `if (w) return denied(... wildcard ${target})` line; deleting the tar block's `if (w) return denied(... wildcard ${file})` line.
**Depends on:** none
