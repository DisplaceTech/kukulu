---
name: implement
description: "Sonnet: work through every open task in docs/PROGRESS.md unattended, then hand off for review-build"
disable-model-invocation: true
model: sonnet
effort: medium
---

You are implementing the build plan in `docs/PLAN.md`. You run **unattended**:
nobody is watching, nobody will answer a question, and you must not stop until
`foundry_status` reports zero open tasks. A Stop hook pushes you back into the
loop if you stop early, so stopping to "report progress" only wastes a turn.
Report once, at the end.

Never use AskUserQuestion. Never wait for input. Never ask whether to proceed.

## The MCP owns the bookkeeping

All task selection, checkbox edits, log entries, verification runs and commits
of `docs/PROGRESS.md` go through the `foundry` MCP tools. Do not edit
`docs/PROGRESS.md` or `docs/PLAN.md` by hand. Do not decide which task is
next; ask.

## State lives on disk, not in your memory

Your context will be compacted many times during this run. The only sources
of truth are `docs/PROGRESS.md` (via `foundry_status`), `docs/PLAN.md` (via
`foundry_task_next`), `CLAUDE.md`, `docs/SPEC.md`, and `git log`. If you are
ever unsure what to do next, call `foundry_task_next`.

## Setup

Call `foundry_run_start` once. It creates or reuses the `build/*` branch, arms
the Stop hook, fills in `Branch:` and `Started:`, and commits. It is idempotent;
calling it on a run already in progress is harmless.

## Per-task loop

Repeat until `foundry_task_next` returns `{ done: true }`:

1. **Select.** Call `foundry_task_next`. It marks the task `[~]` and returns
   the task text, the log entries of the tasks it depends on, and any tasks it
   auto-skipped because a dependency is blocked.
2. **Read.** Read `CLAUDE.md`, then the SPEC sections the task cites, then the
   dependency log entries you were given. Do not read ahead to later tasks.
3. **Tests first.** Write the acceptance tests named in the task and run them.
   Confirm they fail for the right reason.
4. **Implement** the smallest change that makes them pass, within Files
   touched.
5. **Verify.** Call `foundry_verify` with the task's Files touched. It runs the
   project's verify commands plus any path-specific extras and returns each
   command's exit status and tail. All must pass: no skipped tests, no lint
   suppressions added. Then do whatever the task's own Verification section
   asks that a command cannot cover, and describe what you verified.
6. **Commit** with the template in CLAUDE.md: title `<ID>: <title>`, body with
   Goal / Tests / Interpretation / Measurement (if tuning) / Manual check.
   Stage only the files the task touched. Do not stage `docs/PROGRESS.md`.
7. **Record.** Call `foundry_task_done` with the task ID and a log entry
   (under 15 lines): tests added, any Interpretation choices, config keys
   introduced, anything a later task or the reviewer must know. The tool marks
   the task `[x]`, stamps the commit sha, and commits PROGRESS.md.
8. Go to step 1. Do not summarise, do not ask, do not stop.

## Phase-end tasks

The last task of each phase pushes the branch and records what a human must
check by hand. If the repo has no `origin` remote, skip the push and put
`Push: no remote configured` in the log. Put `Manual check: NOT VERIFIED
(human)` in the log. Do not wait for anyone to look at it.

## Constraints you may not relax

Everything under `## Constraints` in `CLAUDE.md`, on every task. SPEC.md wins
over PLAN.md wins over code comments.

## When a task is under-specified or wrong

- Under-specified: do not guess silently. Implement the interpretation most
  consistent with SPEC and record it under Interpretation in the commit and in
  the log entry. Then continue.
- Tests fail and you cannot make them pass within Files touched after a real
  attempt (not more than ~3 distinct approaches): call `foundry_task_block`
  with the task ID and a reason of the form `what you tried / what fails /
  what you think the fix is`. The tool resets uncommitted changes, marks the
  task `[!]`, logs it, and commits. Continue with the next task.
- Impossible as written (contradicts SPEC, or depends on something that does
  not exist): `foundry_task_block` with the reason. Do not work around it.
- A blocked task never stops the run. The reviewer decides what to do with it.

## Finishing

When `foundry_task_next` returns `{ done: true }`:

1. Call `foundry_verify` with no files. If anything is red, fix it in a commit
   titled `chore: final green` and re-run.
2. Write `docs/HANDOFF.md`:
   - Branch, base commit, head commit, task counts by state (from
     `foundry_status`).
   - Blocked and skipped tasks with their reasons, verbatim from the log.
   - Every Interpretation choice, in one list with task IDs.
   - Every `⚠️ ASSUMPTION` config key with its current default and whether it
     was tuned.
   - What a human must check by hand, per phase.
   - Anything you would tell a reviewer who has not seen this code.
   If this is a review-fix round, rewrite only the `## Round N` section of
   HANDOFF.md rather than the whole file.
3. Call `foundry_run_finish`. It commits HANDOFF.md, pushes and opens a draft
   PR if it can, disarms the Stop hook, and returns the handoff summary.
4. Print one final message that starts with `READY FOR REVIEW` and contains
   the branch name, head sha, and the counts.

## Review-fix rounds

If `foundry_task_next` hands you tasks with IDs starting `R`, this is a fix
round. Everything above applies unchanged: the `R` tasks are tasks.
