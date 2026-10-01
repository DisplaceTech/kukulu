# Foundry flight feedback — cleanflate

Collected against plugin `foundry@ericmann` 0.3.2, across three flights in
one repository: phase 1 built the project, phases 2 and 3 tuned its
performance.

Pulled with `/foundry:pull-feedback` from three logs, because the project
archived each phase's `.foundry/feedback.jsonl` before starting the next:

| Phase | Source log | Items |
|---|---|---|
| 1 (build) | `docs/phase-1/foundry-feedback.jsonl` | F-01–F-07 |
| 2 (performance) | `docs/phase-2/foundry-feedback.jsonl` | F-08–F-11 |
| 3 (performance) | `.foundry/feedback.jsonl` | F-12–F-15 |
| all | the flight controller's own notes | F-16–F-30 |

F-16 onward were never logged to a `feedback.jsonl`. The flight controller
(the operator's own session) observed them while running the three flights,
and they are recorded here so the release plan sees them too. They have no
`at` timestamp, so a later `/foundry:pull-feedback` cannot dedupe against
them; none of them came from a log. Newest entries at the bottom.

## F-01 — no guidance for a spec that must log or tag Foundry's own activity

Phase 1. Logged by the planner (`stage: plan`, `category:
spec-interaction`, round 0, at `2026-09-29T14:32:54.043Z`):

> SPEC required a tracked, append-per-tool-call provenance log plus
> per-commit `[stage:][task:]` tags. Foundry's clean-tree check on task_done
> and its fixed `<ID>:` subjects and MCP-authored progress/review commits
> forced workarounds: a gitignored live log with phase-end snapshots, and a
> commit-msg hook. The skill has no guidance for projects that must log or
> tag Foundry's own activity.

## F-02 — an allowlisted download failed and blocked a foundational task

Phase 1. Logged by the implementer (`stage: implement`, `category: other`,
round 0, at `2026-09-29T14:53:58.015Z`):

> Canterbury corpus URL (<https://corpus.canterbury.ac.nz/resources/cantrbry.tar.gz>,
> the only allowlisted URL per SPEC/guard) returns HTTP 403 from Cloudflare
> bot management in this sandbox network, confirmed with retries and full
> browser-like headers; not a script bug. Silesia (also allowlisted)
> downloads fine (200). Per PLAN.md P0-08 explicit instruction ("Canterbury
> is required: if it cannot be downloaded after 3 attempts, block the
> task"), this blocks P0-08 and cascades to skip most corpus-dependent
> downstream tasks, which is a large portion of the remaining plan. This is
> an environment/network constraint outside the implementer's control, not
> something a different script approach can fix.

## F-03 — no tool reopens a blocked or skipped task once its blocker is fixed

Phase 1. Logged by the implementer (`stage: implement`, `category: other`,
round 0, at `2026-09-29T15:34:08.278Z`):

> Coordinator relayed operator instructions to unblock P0-08 (a human
> downloaded the Canterbury corpus and gave me the verified file+sha256). I
> implemented the actual fix (fetch-corpora.sh --from-file, SOURCES.json,
> README.md, committed as 361e93c) and it fully resolves the blocker on
> disk. But there is no MCP tool to reopen a [!] blocked (or [-] skipped)
> task: foundry_task_done requires the task to be 'in progress'
> (foundry_task_next must select it first), and foundry_task_next only ever
> selects the first [~] or first [ ] task, never reconsidering [!]/[-] rows.
> My instructions also explicitly forbid hand-editing docs/PROGRESS.md. Net
> effect: P0-08 stays marked blocked and its dependents (P0-09, P0-10,
> P0-11, P1-03, P1-11, P1-12) stay skipped in PROGRESS.md even though the
> underlying data now exists and the work is committed, and I have no
> sanctioned way to flip that state within this run. A `foundry_task_reopen`
> (or similar) tool would let a resolved-blocker mid-run actually get picked
> back up.

## F-04 — a hanging mutant stalled `foundry_mutate` for the full command timeout

Phase 1. Logged by the reviewer (`stage: review`, `category: stall`, round
0, at `2026-09-29T18:07:02.841Z`):

> foundry_mutate has no per-run wall-clock timeout short of the command's
> timeoutMs (1800s): a mutation that makes a test spin forever (e.g. an
> infinite decode loop) stalled the reviewer for 30 minutes and left
> orphaned spinning test binaries that had to be killed by hand. Parallel
> foundry_mutate calls also appear to queue behind a hung one and time out
> too.

## F-05 — the reviewer's unblock left the task's skipped dependents skipped

Phase 1. Logged by the reviewer (`stage: review`, `category: tool-gap`,
round 1, at `2026-09-29T18:44:14.491Z`):

> foundry_review_submit's unblock reset P0-08 to todo but left the 17 tasks
> cascade-skipped behind it as [-] skipped (counts: skipped 17 after
> submit). The reviewer has no sanctioned way to re-open skipped
> dependents, so the corpus-dependent acceptance/conformance tasks will not
> run in the fix round unless a human or controller re-opens them.

## F-06 — `foundry_mutate` has no per-call timeout override

Phase 1. Logged by the reviewer (`stage: review`, `category: tool-gap`,
round 1, at `2026-09-29T21:13:55.146Z`):

> foundry_mutate has no per-call timeout override, so a mutation suspected
> of hanging `make test` (R1-02's own would-have-caught mutation) would burn
> the full 30-minute verify timeout; I had to reproduce it in a scratchpad
> copy of the crate with `timeout 60` instead.

## F-07 — the project's guard denied a commit message that mentioned a forbidden word

Phase 1. Logged by the implementer (`stage: implement`, `category: other`,
round 2, at `2026-09-29T21:28:20.309Z`):

> git commit -m with a HEREDOC body that merely mentioned "curl" in prose
> (describing a fix to URL-extraction from Bash curl calls) was denied by
> the cleanroom guard's post-lockdown curl-denial pattern, even though the
> command was `git commit`, not `curl`. The guard's Bash pattern-matches the
> word "curl" anywhere in the command string, including inside a quoted
> commit message. Had to reword the commit message to avoid the literal
> word.

## F-08 — plan-build does not say where shared per-task protocols belong

Phase 2. Logged by the planner (`stage: plan`, `category:
ambiguous-prompt`, round 0, at `2026-09-29T23:19:54.328Z`):

> plan-build asks for a PLAN.md `## Conventions` section but also says the
> implementer reads only CLAUDE.md, the task and cited SPEC sections, so
> shared cross-task protocols (bench-before/after, gated-task rule, repro
> rule) had to be moved into CLAUDE.md as an extra section and
> cross-referenced from each task. The skill could say explicitly where
> shared per-task protocols belong.

## F-09 — `foundry_mutate` lost its connection, and its output overflowed

Phase 2. Logged by the reviewer (`stage: review`, `category:
tool-failure`, round 0, at `2026-09-30T04:36:03.646Z`):

> foundry_mutate returned "Connection closed" on the second call
> (fast_loop.rs dsym>=30 mutation) with no result; working tree was clean
> afterwards, but the verdict was lost and had to be retried. The first
> mutate call's result (136 KB of make test output) also overflowed the
> tool-result limit and had to be parsed from a saved file.

## F-10 — a killed mutant left a tracked proptest regressions file modified

Phase 2. Logged by the reviewer (`stage: review`, `category:
tool-side-effect`, round 0, at `2026-09-30T04:42:54.505Z`):

> foundry_mutate restored the mutated file but left a side effect: a killed
> mutant made proptest append a failing seed to the tracked
> crates/oracle/tests/chunking.proptest-regressions, dirtying the tree. The
> reviewer had to git checkout it by hand; mutate should restore (or
> snapshot) every tracked file its commands touch.

## F-11 — the MCP server disconnected after review round 1

Phase 2. Logged by the flight controller (`stage: controller`, `category:
mcp-disconnect`, round 1, at `2026-09-30T05:19:47.383Z`):

> The foundry MCP server disconnected right after review round 1 (the
> reviewer's foundry_mutate had twice returned "Connection closed"), so
> foundry_next was unavailable and the flight paused until the operator
> reconnected via /mcp.

## F-12 — task ids collide across flights in one repository

Phase 3. Logged by the planner (`stage: plan`, `category: id-collision`,
round 0, at `2026-09-30T14:31:59.576Z`):

> In a multi-flight project, the fixed task-ID shape `P<phase>-<nn>`
> repeats the previous flight's IDs, so artifacts named by task ID (here
> docs/perf/P2-01.json, P5-02.json from phase 2) would be silently
> overwritten and git-history task tags collide. I had to namespace every
> phase-3 artifact under docs/perf/phase3/ and scope reports by commit
> range. An optional flight prefix for task IDs (e.g. `F3-P0-01`) would
> avoid this.

## F-13 — guard-denied commands and polling for long background jobs

Phase 3. Logged by the implementer (`stage: implement`, `category:
tool-refusal`, round 0, at `2026-09-30T22:50:31.347Z`):

> The cleanroom guard denies whole Bash commands (including any background
> job started in the same command) when a heredoc or argument merely
> contains words like zlib, or a profiler word next to oracle, so large
> generated scripts had to be written with the Write tool and run
> separately; a denied command also silently skipped the bench it was meant
> to start. Also, waiting for 30+ minute background jobs needs repeated
> 10-minute polling calls.

## F-14 — a killed mutant left an untracked proptest regressions file

Phase 3. Logged by the reviewer (`stage: review`, `category:
mutate-residue`, round 0, at `2026-09-30T23:05:53.367Z`):

> foundry_mutate restored the mutated file but left an untracked
> crates/oracle/tests/reset.proptest-regressions written by the failing
> proptest; the reviewer had to delete it by hand before submitting (same
> class as the chunking.proptest-regressions friction SPEC §7 mentions, now
> for any proptest file).

## F-15 — `foundry_mutate` returned "Connection closed" on a runaway mutant

Phase 3. Logged by the reviewer (`stage: review`, `category: stall`, round
1, at `2026-09-30T23:39:27.336Z`):

> foundry_mutate on crates/cleanflate/src/fast_loop.rs (dsym >= 30 -> >=
> 32, commands make test) returned "Connection closed" with no result; the
> working tree was clean afterwards, but the verdict was lost and the
> mutant had to be abandoned. Possibly a runaway mutant (distance-0 copy)
> exceeding a transport limit rather than the command timeout.

## Controller-observed

## F-16 — the MCP server crashed during mutation testing

Phases 2 and 3 (phase-2 review round 1, phase-3 review round 2). The
`foundry` MCP server disconnected right after `foundry_mutate` ran a
mutant that most likely looped until it hit a 1 GiB output limit. The
flight stalled until the operator ran `/mcp`. `foundry_mutate` needs a
per-mutant timeout, a process-group kill and a bounded output size, and
must never take the server down. See also F-04, F-09, F-11 and F-15.

## F-17 — `foundry_mutate` leaves residue and overflows the tool result

Phases 2 and 3. After killed mutants it left modified and untracked
`*.proptest-regressions` files, and its output overflowed the tool-result
limit twice. It should restore the full tree state, including untracked
files it caused, and truncate its output. See also F-09, F-10 and F-14.

## F-18 — no way to reopen blocked or skipped tasks

Phase 1. P0-08 was blocked by an external download failure (F-02) and 17
dependent tasks were auto-skipped. After the operator supplied the file,
nothing in the toolset could reopen them; the controller flipped `[-]` to
`[ ]` in `PROGRESS.md` by hand. A tool such as `foundry_task_reopen`, or a
reviewer unblock that also reopens the task's skipped dependents, would
close this. See also F-03 and F-05.

## F-19 — over-eager cascade skipping

Phase 1. One blocked infrastructure task skipped 17 tasks, most of which
did not really need it. The planner should be told to keep `Depends on`
narrow, and skipping should be re-evaluated when the blocker clears.

## F-20 — no way to pass flight options to go-flight

Phase 2. The operator invoked `/foundry:go-flight` with "maximum review
depth of 6 rounds", but the skill has no argument handling, so the
controller edited `maxRounds` in `docs/foundry.json` by hand.

## F-21 — round numbers disagree across tools and messages

Phases 1–3.

- `foundry_review_submit` reported `"round": 3` when `REVIEW.md` was round
  4 (an `APPROVED` submission).
- `foundry_next`'s `done` reason says "after N review round(s)" but counts
  fix rounds rather than reviews (phase 3: "1 round" after 2 reviews).
- `foundry_status.reviewVerdictInFile` was `null` after an `APPROVED`
  review.

## F-22 — generated agents are not loadable in the first session

Phase 1. On the project's very first flight, `foundry-planner` and the
other generated agents were "not found", so the fallback path ran. That
works as designed, but the not-found error followed by the fallback retry
is noisy.

## F-23 — the Write tool is refused for some subagents

Phases 1–3. The summarizer and implementer were sometimes refused the
`Write` tool and wrote their documents with shell heredocs instead (the
documented fallback). Worth checking the generated agents' tool lists and
permission rules.

## F-24 — the draft PR ignored `baseBranch`

Phase 2. `docs/foundry.json` had `"baseBranch": "feature/perf"`, but the
draft PR was opened against `main`.

## F-25 — PR state is not reported

Phases 1–3. The summarizer could not tell whether a draft PR existed:
`foundry_summary_commit` reports only the push.

## F-26 — `foundry_verify` did not catch a constraint regression early

Phase 1. The constraint scan missed a forbidden-word regression that a
later full run caught. A full-tree constraint scan at `run_finish` or
review would catch it before the reviewer has to.

## F-27 — multi-phase projects need manual bookkeeping

Phases 2 and 3.

- Task ids (`P<phase>-<nn>`) collide across flights in the same repository,
  which collides artifacts named by task id and makes `[task:..]` tags in
  history ambiguous (F-12).
- Each new phase needed manual archiving of SPEC, PLAN, PROGRESS, REVIEW,
  SUMMARY, HANDOFF and `foundry.json`, plus `.foundry/state.json` and
  `feedback.jsonl`.
- The project needed its own `PHASE_BASE` scoping for reports.

A flight identifier (an id prefix or a flight number) and an
archive/new-phase command would cover all three.

## F-28 — long verify commands exceed the foreground tool limit

Phases 2 and 3. Full benches and heavy suites exceeded the 10-minute
foreground tool limit; agents had to run them in the background and poll
(F-13).

## F-29 — project guards that scan whole Bash commands deny commit messages

Phases 1 and 3. A project PreToolUse guard that scans whole Bash command
strings denied commit messages containing forbidden words (F-07, F-13).
Committing with the message in a file (`git commit -F`) keeps it out of the
command string.

## F-30 — what worked, and should stay

Phases 1–3.

- Per-role model routing.
- Mechanical constraint rules with fixtures.
- Gated "measure first or record a negative result" tasks.
- Reviewer mutation sampling, which caught real test gaps every round.
- The narrow fix-task loop: the three phases converged in 4, 3 and 2
  reviews.
