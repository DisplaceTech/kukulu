# MCP tool reference

Twenty-four tools, served over stdio by `mcp/server.mjs` with no dependencies. The server is launched by Claude Code from [`.mcp.json`](../.mcp.json) with `KUKULU_PROJECT_DIR` set to the project root; every path below is relative to that root.

Three of them are read-only: `kukulu_status`, `kukulu_next` and `kukulu_config_show`. The flight controller may call those three and four more. `kukulu_agents_sync` writes only the generated agent files, the MCP allow rule and a `.git/info/exclude` line, never a task or a verdict. It may call `kukulu_run_halt` itself when it cannot even spawn a stage, so the next flight sees a clean halt instead of retrying blindly. `kukulu_flight_options` applies the operator's own go-flight options to the review-loop bounds (and, with `resume`, lifts a round-cap halt). `kukulu_pr_finalize` is allowed for the human-initiated re-sign only (`resign: true`, when the operator says signing is unlocked). Everything else changes project state and belongs to a stage agent. (`kukulu_mutate` changes a source file only for the length of one call and always restores it, and a stream's tools work in that stream's own worktree.)

`kukulu_next`, `kukulu_status`, `kukulu_config_show` and `kukulu_agents_sync` all resolve the merged routing config (see [routing.md](./routing.md)) as part of answering, so a malformed global config, profile or project override is a refusal from any of the four. This is deliberate: a flight must not run with a half-understood routing config.

Every commit a tool makes runs with no terminal prompt and a 30-second bound, so a signing agent that wants a pinentry cannot hang the server. Under `policies.signing: "auto"` a commit that fails to sign is retried once unsigned, and `state.signing` and `state.signingOverride` record that signing was turned off for the run; under `"required"` the tool refuses instead.

In clean-room mode every commit a tool makes ends with two trailers, added by the commit helper (not a git hook, so `--no-verify` cannot skip them), after a blank line: `Kukulu-Stage: <stage>` (`plan`, `implement`, `fix` in a review-fix round, `review`, `summarize` or `controller`) and `Kukulu-Task: <id>` (the task a `kukulu_task_done`, `kukulu_task_block` or `kukulu_task_reopen` names, else the first in-progress task, else `-`). They survive the unsigned retry. General mode adds none.

A tool that writes and then fails to commit leaves the tree as it found it: every file it wrote is restored byte for byte and nothing stays staged, so the same call can be made again.

A tool that refuses returns a normal MCP result with `isError: true` and a plain-English message. It is not a transport error: the model is expected to read it, fix what it did, and try again.

---

## `kukulu_status`

Everything the pipeline knows from disk. It is read-only and safe to call at any time, and a stage that has just been spawned with no context should call it first.

**Arguments:** none.

**Returns:**

| Field | Meaning |
|---|---|
| `root` | Absolute project root the server is operating on |
| `specPresent` … `configPresent` | Which pipeline documents exist |
| `lockPresent` | Whether an implementation run is armed |
| `lockCounter` | The implement guard's re-block counter, read from the lock (either format); `null` when there is no lock |
| `git` | `{ inRepo, branch, head, base, dirty, hasOrigin }`; `base` is the merge-base with `baseBranch` |
| `state` | `{ round, implemented, reviewed, verdict, summarized, halted, preexistingUntracked, policies, signing }` from `.kukulu/state.json` |
| `round` | Fix rounds already queued (0 = initial build) |
| `reviewRound` | Always `round + 1`: the number the *next* review must stamp on `docs/REVIEW.md`'s `Round:` line |
| `preexistingUntracked` | Paths that were already untracked before the current run started. Every dirty-tree check ignores them |
| `policies`, `signing` | The run's resolved policies and signing outcome, from `kukulu_run_start`; see [operations.md](./operations.md#configuration) |
| `longestCommandTimeoutMs` | The longest timeout of any `verify`, `extraVerify` or `parallel.setup` command (`null` with none). Tool calls are handled one at a time, so a parallel stream's bookkeeping call can wait behind another stream's longest verify; Claude Code's MCP tool-call timeout (`MCP_TOOL_TIMEOUT`) must exceed this plus headroom. See [operations.md](./operations.md#parallel-streams) |
| `feedbackCount` | Number of entries in `.kukulu/feedback.jsonl` so far, so a human watching a transcript can see friction accumulate without opening the file |
| `reviewRoundsInPlan` | How many `## Review fixes (round N)` sections `PLAN.md` carries |
| `branch`, `started` | The `Branch:` and `Started:` headers in `PROGRESS.md` |
| `counts` | `{ todo, inProgress, done, blocked, skipped, total, open }`; `open = todo + inProgress` |
| `blocked`, `skipped` | Task ids in those states |
| `waves` | The plan's parallel waves, numbered from 1: `[{ index, streams: [{ stream, tasks, open }], valid, reason }]`. A wave is a maximal run of consecutive tasks that all carry a `{stream: <slug>}` tag on their `PROGRESS.md` line; `valid` is false, with a `reason`, when its partition cannot be proven safe (see [architecture.md](./architecture.md#parallel-workstreams)). `[]` for a plan with no streams |
| `artifacts` | Where each of `docs/`'s `SPEC.md`, `PLAN.md`, `PROGRESS.md`, `HANDOFF.md`, `REVIEW.md`, `SUMMARY.md` and `kukulu.json` stands: `"absent"`, `"untracked"` (on disk, not in git), `"modified"` (tracked, with uncommitted changes) or `"tracked"` |
| `strayArtifacts` | The artifacts that are `"untracked"` while `PLAN.md` is `"absent"`: what an interrupted plan run leaves behind. `[]` otherwise |
| `cleanroom` | `null` without a policy file; else `{ policy, policyHash, mode, genesis, pinnedPolicyHash, chain: { entries, tip, lastCheckpoint }, denied, hooksLive, keyFingerprint, lockdown }`. `policy` is repo-relative and `policyHash` is the file's current SHA-256; `mode` is `clean-room` or `general`; `genesis` and `pinnedPolicyHash` are the values recorded in state, else `null`; `chain` counts the log's entries and names the newest hash and the seq of the newest checkpoint; `denied` counts `denied` entries; `hooksLive` is true when an `allowed` entry follows the newest `gate` (or the genesis, when there is no gate); `keyFingerprint` is `null` while there is no key; `lockdown` is whether the lockdown task is done. See [cleanroom.md](./cleanroom.md) |
| `lastReviewCommit` | Short sha of the newest `review:` commit between `baseBranch` and `HEAD`; `null` when there is none |
| `prChecks` | The pull request's CI checks, computed by this tool only (`kukulu_next` never calls `gh`): `null` when there is no `origin` remote, `gh` is unavailable, or the branch has no pull request; otherwise `{ state, failing }`, where `state` is `fail` (any check FAILURE, ERROR, CANCELLED, TIMED_OUT, ACTION_REQUIRED or STARTUP_FAILURE), else `pending` (any PENDING, QUEUED, IN_PROGRESS, WAITING, REQUESTED or EXPECTED), else `pass`, or `none` for an empty list, and `failing` is `[{ name, link }]`. `gh pr checks` runs with a 30 000 ms timeout; an error, a timeout or output that is not JSON gives `unknown: <why>` |
| `reviewVerdictInFile` | The verdict parsed out of `REVIEW.md`, if one exists |
| `agentsGenerated` | Role names whose `.claude/agents/kukulu-<role>.md` currently exists |
| `agentsGeneratedThisSession` | Role names this MCP server process itself wrote. Diagnostic only, for understanding why `kukulu_next` reported `agentFallback` |

**Refuses when:** `PROGRESS.md` exists but has no `## Tasks` section, `kukulu.json` is not valid JSON, or the merged routing config is malformed (see [routing.md](./routing.md)). All three are corruption, not absence, and guessing past them would produce wrong answers.

---

## `kukulu_next`

The stage machine. Its answer is a pure function of disk state; it never sees a subagent's report. It writes in two cases only: it records, once, that a parallel wave must run serially (see `streams` below), and in a project with a clean-room policy file it writes the flight's genesis (see below).

**Arguments:** none.

**Returns:** `{ stage, agent, agentFallback, fallbackAgent, restartRequired, model, agentModel, agentModelExact, round, reviewRound, reason, gate, prompt, streams? }`.

- `stage`: `plan` · `implement` · `review` · `summarize` · `done` · `halt`
- `gate`: `null` in general mode. In clean-room mode, `{ ok, checked: ["mode", "policy", "guard", "self-test", "lockdown", "chain", "liveness"] }`: the gate runs on every call once the flight has its genesis, before the decision table, and `kukulu_run_start`, `kukulu_task_next`, `kukulu_review_submit` and `kukulu_summary_commit` run it before any write. **mode**: the policy file exists and the flight was not recorded as general. **policy**: its SHA-256 equals the one recorded at genesis. **guard**: the SHA-256 of `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs` and `hooks/hooks.json` under the plugin root equal the recorded ones, and `hooks.json` still registers the guard on `PreToolUse` and the logger on `PostToolUse` and `UserPromptSubmit`. **self-test**: `node scripts/cleanroom-guard.mjs --self-test <policy>` exits 0 within 60 s. **lockdown**: once `lockdown.after` is `[x]`, a `WebFetch` of `allow.urls[0]` is denied. **chain**: every hash recomputes, the first entry is the recorded genesis, and the newest checkpoint verifies with the signing key. **liveness**: when a `gate` entry already exists, at least one `allowed` entry has been logged after the newest one; otherwise "no tool call has been logged since the last gate; the clean-room hooks are not running in this session. Start a new session." (the first gate needs none). A pass appends `{ kind: "gate", data: { checks, ok: true } }`; a failure appends `{ kind: "gate", data: { failed, reason } }` first (the one write before a refusal), then `kukulu_next` returns `halt` with "clean-room gate failed: <check>: <reason>" and each tool throws that text. The gate commits nothing; the next checkpoint commits the log.
- **Clean-room genesis and sticky mode.** When the file at `cleanroom.policy` exists, the first call, before the plan exists, validates the policy, generates the signing key if it is absent, appends a `genesis` entry to `.kukulu/cleanroom/log.jsonl` (its `data` names `mode`, `policyHash`, `guardHash`, `loggerHash`, `hooksHash`, `pluginVersion`, `keyFingerprint`, `baseBranch` and `head`), records `state.cleanroom = { genesis, policyHash, guardHash, loggerHash, hooksHash }`, and commits state and log as `chore: clean-room genesis`. A project without a policy writes no log. The mode is sticky: a policy that appears after the flight started in general mode (recorded by `kukulu_run_start`), a policy first seen after the plan exists, or a policy removed after genesis makes the stage `halt` with "clean-room coverage is broken: the mode changed after genesis (…); archive this flight with kukulu_flight_archive and start another". That halt is computed on every call, never stored, and `kukulu_run_resume` refuses it.
- `agent`: the subagent to spawn. This is the generated `kukulu-<role>` name when it can be trusted to spawn (`agentFallback` is false), else the plugin's own `kukulu:planner` / `kukulu:implementer` / `kukulu:reviewer` / `kukulu:summarizer`; `null` for `done`, `halt`, and whenever `restartRequired` is true. On a project's first flight, when this session created the agents directory, that means the plugin agent from the start, not a generated name that fails with "not found" and is retried
- `agentFallback`: true when the generated agent file cannot yet be trusted to spawn in this session: it is absent, or this server process created the `.claude/agents` directory itself (see [routing.md](./routing.md) for why that one case needs a restart and a routing *change* to an existing directory does not)
- `fallbackAgent`: the plugin's own `kukulu:<role>` name, always present for a stage that has a role, so a controller can retry with it if spawning a generated `agent` still fails with "not found"
- `restartRequired`: true only when `agentFallback` is true and the resolved model is one the `Agent` tool cannot name (a non-Anthropic model, or a `claude-*` id of a family Kūkulu does not know); `false` for `done` and `halt`
- `model`: the resolved model string for that role from the routing config (see [routing.md](./routing.md)); `null` for `done` and `halt`. Display only: it may be a full `claude-*` id, which the `Agent` tool's `model` parameter rejects
- `agentModel`: what to pass as the `Agent` tool's `model` when `agentFallback` is true: a family alias (`opus`, `sonnet`, `haiku`, `fable`), or `null` to pass none (`inherit`, and `done`/`halt`). A full `claude-<family>-…` id maps to its family alias
- `agentModelExact`: false when `agentModel` was mapped down from a full id, since an alias means the latest of that family, which may not be the version pinned in routing. Always true otherwise
- `reviewRound`: always `round + 1`. The review stage's prompt states it, and `kukulu_review_submit` refuses a `Round:` line that disagrees with it; see [architecture.md](./architecture.md#review-rounds)
- `reason`: one sentence, written for a human reading the transcript. A `done` reason counts reviews and fix rounds separately: "flight complete after 2 reviews (1 fix round); …". After [`kukulu_flight_archive`](#kukulu_flight_archive) it is `done` with the reason "flight <slug> is archived in <dir>; edit docs/SPEC.md for the next flight, then run /kukulu:go-flight", until `docs/SPEC.md` differs from the archived copy; then the stage is `plan` again. While `kukulu_pr_finalize` has recorded `state.awaitingSigning` the stage is `done` with the reason "awaiting signing: <n> unsigned commit(s), oldest <sha>." followed by the steps to take
- `prompt`: the text to hand the subagent verbatim. In clean-room mode the implement, stream, review and summarize prompts end with one more sentence: "This flight is in clean-room mode: every tool call is checked against docs/cleanroom.json and logged; a denied call is never worked around — note it in the task's log and continue another way." The implement, review and summarize prompts each end with a sentence stating this run's policies (see `kukulu_run_start`)
- `streams`: present only on an `implement` result that is a parallel wave: `[{ stream, agent, agentFallback, fallbackAgent, agentModel, agentModelExact, prompt }]`, one entry per stream to run concurrently. The controller spawns one implementer per entry, all at once, passes each entry's `prompt` verbatim, and waits for all of them before calling `kukulu_next` again. The list holds, in order: streams already in flight (a worktree exists; an unfinished one is handed out again, and a finished one is offered so it gets merged), then streams with open tasks in plan order, capped at `parallel.maxStreams`; the rest go out on a later call. It is absent when the flight is serial here: no streams, `maxStreams` of `1`, or a wave that runs serially. When `streams` is present, ignore the top-level `prompt`, which is the ordinary serial one.

  A wave whose partition is invalid (see [architecture.md](./architecture.md#parallel-workstreams)) runs serially. Once a build branch exists, `kukulu_next` records that in `state.serialWaves` with one `stream-partition` feedback entry (`stage: "plan"`, a bad partition being a planning defect), committed as `chore: wave <n> runs serially`; it is never a halt. Before a run has started, nothing is written to the base branch. An exclusive `verify` command makes every wave serial and is logged once per flight, as `stream-exclusive`.

The full decision order is in [architecture.md](./architecture.md#the-stage-machine).

---

## `kukulu_plan_commit`

Validate the plan as a whole and commit it. The planner calls it last, in place of `git add` and `git commit`.

**Arguments:** `{ renumber? }`, a boolean. `renumber: true` is for a planner that split a task and gave the new half a temporary suffix such as `P1-02a`: it renumbers every phase's `P` ids to `P<n>-01, P<n>-02, …` in document order, and rewrites each changed id everywhere it appears (all of `PLAN.md` and `PROGRESS.md` as whole words in one pass, never chained, plus the `"from"` values in `docs/kukulu.json`), then validates the rewritten texts and commits. `R` ids are never renumbered. It is refused once a run has started (a `Started:` stamp in `PROGRESS.md`, or any task that is not `[ ]`), and when problems remain after the rewrite it writes nothing. Without `renumber`, a suffixed id is a `heading` problem whose message suggests it.

**Does:** reads `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/kukulu.json` and `CLAUDE.md`, checks them together, and, only when nothing is wrong, commits them as `plan: derive build plan from SPEC` (through the same commit helper as every other tool, so an unsignable commit falls back to unsigned under `policies.signing: "auto"`). It writes nothing but that commit.

The checks, by the name each problem carries in `check`:

| `check` | Problem |
|---|---|
| `files` | `PLAN.md`, `PROGRESS.md` or `kukulu.json` is missing |
| `heading` | A line like a task heading (`## P0-02 …`, `### P0-02 - Title`) that is not exactly `### <ID>: <title>` |
| `duplicate` | An id with two headings |
| `sequence` | Within a phase, `P` ids are not `P<n>-01, P<n>-02, …` in document order with no gap (`R` ids are exempt) |
| `depends` | A **Depends on** id with no heading, or whose heading comes later (a task depending on itself counts) |
| `cycle` | A dependency cycle, reported once |
| `progress` | `PROGRESS.md`'s task ids differ from `PLAN.md`'s as a set or in order |
| `streams` | A malformed `**Stream:**` value, or any parallel wave judged invalid (`wave <n>: <reason>`) |
| `config` | `docs/kukulu.json` is not valid JSON or fails the same validation `cfg()` applies |
| `from` | A `from` (on a constraint, `verify` or `extraVerify` entry) names an id with no heading |
| `branch` | The current branch is neither the config's `baseBranch` nor a `branchPrefix*` branch: `on '<branch>', but docs/kukulu.json baseBranch is '<base>'; set baseBranch to '<branch>' (the branch the plan is committed on) or switch to it`. Skipped outside a git repository; a detached HEAD counts as `HEAD` |
| `claude` | `CLAUDE.md` does not exist at the repository root |

**Returns:** `{ commit, notes, tasks, phases: [{ phase, tasks }], waves: [{ index, streams, valid }], renumbered }`. `notes` is a list of advice that never blocks the commit: today, one entry when the config's `flight` slug ends in `-spec` or `-specification`, naming the slug without the suffix. `commit` is `null` when everything is already committed; `renumbered` is the `{ old: new }` map of ids `renumber: true` changed, `{}` otherwise.

**Refuses when:** any check fails. Every problem is listed in one reply: the message's first line counts them, then each gets one numbered line (`1. [heading] …`). The same list rides on the error reply as `structuredContent.problems`, `[{ check, id?, message }]`. Nothing is committed.

---

## `kukulu_run_start`

Begin or resume an implementation run. Idempotent: calling it on a run already in progress returns `{ alreadyStarted: true }` and changes nothing.

**Arguments:** `{ stream? }`. With `stream`, the call also sets up that stream of the current parallel wave (see [Stream mode](#stream-mode) below).

**Does:**

1. Records every currently untracked path as `preexistingUntracked` in `.kukulu/state.json`, so the run never treats a file that was already there as its own. Skipped on an idempotent resume, so the list is fixed at the start of each round, not re-scanned mid-run.
2. Resolves `kukulu.json`'s `policies` (`signing`, `push`, `pr`) and records them in state. Unless this is an idempotent resume, it then probes signing: `off` disables `commit.gpgsign` locally; `auto`/`required` with signing configured actually attempt a signed object (`git commit-tree -S`, not a dry run) and record `"on"` on success; `auto` falls back to disabling signing locally on failure, recording why; `required` refuses instead of falling back. See [operations.md](./operations.md#configuration).
3. When creating a new build branch (not resuming one), first pushes `baseBranch` to `origin` through the shared push helper, which honours `policies.push`. The planner's commits then reach the remote before the build branch diverges, and a later PR's diff is the build, not the plan. A failed or skipped base push is reported, never fatal.
4. In clean-room mode generates the signing key (`cleanroom.signingKey`, or `KUKULU_CLEANROOM_KEY`) if it is absent, as a PEM Ed25519 private key with mode 0600 and a `.pub` beside it; without a policy it records `state.cleanroom = { mode: "general" }` in the state it commits, which the sticky-mode check reads.
5. Creates `build/<date>` from `baseBranch` (or `build/<date>-2`, `-3`, … if that name is taken), or reuses the current `branchPrefix*` branch.
6. Adds `.kukulu/implement.lock` to `.gitignore` if it is not already there.
7. Arms the guard hook by writing the lock as JSON: `{ count: 0, armedAt, round, cap }`, with `cap` from `kukulu.json`'s `guardCap`.
8. Fills in `Branch:` and `Started:` in `PROGRESS.md` if they are placeholders.
9. Commits as `chore: start implementation run`, or `chore: start review-fix round N`.

**Returns:** `{ alreadyStarted, branch, commit, counts, round, policies, signing, basePush }`. `signing` is `"on"`, `"off"`, `"none"` (not configured), or `"off (probe failed: <reason>)"`. `basePush` is present only when a new build branch was created: `"pushed"`, `"skipped: policy"`, `"skipped: no origin remote"`, or `"failed: <git's first line>"`.

**Refuses when:** any of `SPEC.md`, `PLAN.md`, `PROGRESS.md` or `kukulu.json` is missing; the directory is not a git repository; `policies` is malformed; `policies.signing` is `"required"` and signing is not configured or the probe fails; a *tracked* file has uncommitted changes on the base branch (an untracked one never blocks a start; see above); or the current branch is neither the base branch nor a `branchPrefix*` branch. That refusal names both ways out: set `baseBranch` to the current branch in `docs/kukulu.json` and re-run `kukulu_plan_commit`, or `git switch -c <branchPrefix><date>` from it.

### Stream mode

`kukulu_run_start({ stream })` first does the ordinary start above (a no-op when the run is already going), then:

1. Refuses unless `stream` is one of the current wave's streams with open tasks (or already has a worktree). The current wave is the one holding the first open task, when that task is streamed. The refusal lists the legal streams.
2. Creates `.kukulu/worktrees/<stream>` on a new branch `<build-branch>--<stream>` cut from the build branch's HEAD, and runs `parallel.setup` in it, because a fresh checkout has none of the installed dependencies `verify` needs. The worktree lives inside the project, so the implementer's ordinary edit permission covers it.
3. Records, in `state.streams[<stream>]`, the worktree's untracked paths as they stand after setup, so dependency directories setup leaves behind are never mistaken for a task's uncommitted changes.
4. Returns the ordinary result plus `{ stream, wave, cwd, streamBranch, created, setup }`. `cwd` is the absolute worktree path: all of the stream's reading, editing and committing happens there. `branch` remains the *build* branch. Calling it again returns the same `cwd` with `created: false` and does not re-run setup.

If a setup command fails, the worktree (and a branch this call created) is removed, the wave is recorded in `state.serialWaves` with a `stream-setup` feedback entry, both committed as `chore: wave <n> runs serially`, and the call refuses saying so. A broken setup degrades the wave to serial; it never halts the flight.

Every other stream-scoped tool works the same way: `PROGRESS.md`, `PLAN.md` and `state.json` are read and written only in the main checkout, and the progress commits land on the build branch, never a stream branch. Stream implementers never edit `docs/PROGRESS.md`, `docs/HANDOFF.md` or anything under `.kukulu/`.

**Clean-room mode.** After genesis, this tool appends a signed `checkpoint` entry (event `run-start`) to `.kukulu/cleanroom/log.jsonl` before its final commit and commits the log with its own files; a failed commit restores the log byte for byte. General mode writes none. Uncommitted appends to the log never count as a dirty tree, because the hooks write to it after every tool call.

---

## `kukulu_task_next`

Select the next task. Implementers choose what to work on only through this tool.

**Arguments:** `{ stream? }`. With `stream`, only that stream's tasks in the current wave are considered, and the result also carries `stream`; a stream with nothing left returns `{ done: true, stream, … }`, the cue to call [`kukulu_stream_finish`](#kukulu_stream_finish).

Without `stream`, when the next open task belongs to a wave that runs in parallel and no stream worktree exists yet, the call returns `{ done: true, paused: true, wave, streams, counts, skipped, message }`. A serial implementer has done everything it can before the wave, and `message` tells it to stop without writing a handoff or calling `kukulu_run_finish`. The call also flags `.kukulu/implement.lock` with `paused: <wave>`, which the guard hook honours (any task state change clears it). While stream worktrees exist (streams running, or finished and unmerged), a stream-less call refuses instead: merge each back with `kukulu_stream_finish` first.

**Does:** picks the first `[~]` task (a resume), else the first `[ ]`. Before handing it over, it checks the task's `**Depends on:**` list; if any dependency is `[!]` or `[-]`, the task is marked `[-]`, logged as `SKIPPED: depends on <id>`, and the search continues. Skips cascade transitively and are committed together as `progress: skip <ids>`. The selected task is marked `[~]` on disk before it is returned.

**Returns, when work remains:**

| Field | Meaning |
|---|---|
| `done` | `false` |
| `id`, `title` | Task identity |
| `text` | The task's full `### <ID>: <title>` block from `PLAN.md` |
| `files` | The `**Files touched:**` line, for `kukulu_verify` |
| `dependsOn` | Dependency ids |
| `dependencyLogs` | Those dependencies' log entries from `PROGRESS.md`, the only context carried between tasks |
| `skipped` | Tasks skipped on the way to this one |
| `counts` | Task counts after the selection |
| `resumed` | `true` if the task was already `[~]` (a previous attempt died mid-task) |

**Returns, when nothing remains:** `{ done: true, counts, skipped }`.

**Refuses when:** `PROGRESS.md` or `PLAN.md` is missing, or a task in `PROGRESS.md` has no matching `### <ID>: <title>` heading in `PLAN.md`.

---

## `kukulu_task_done`

Mark a task complete and write its log entry.

**Arguments:** `{ id, log, stream? }`. `log` is the entry body, kept under ~15 lines: tests added, interpretation choices, config keys introduced, anything the reviewer or a later task must know. With `stream`, the HEAD commit and clean-tree checks run in that stream's worktree, and the task must belong to the stream; the progress commit still goes on the build branch. A stream implementer has no `HANDOFF.md`, so its interpretation choices belong here.

**Does:** marks the task `[x]`, appends `### <ID> — <sha>` plus the log body under `## Log`, commits `PROGRESS.md` as `progress: <ID> done`, and resets the implement guard's re-block counter to zero.

**Returns:** `{ id, taskCommit, progressCommit, counts, guardReset: true }`.

**Refuses when:** the id is unknown; the task is not `[~]` (nobody selected it); HEAD's commit subject does not start with `<ID>:`; or anything other than `docs/PROGRESS.md` is uncommitted (a path already recorded as `preexistingUntracked` at `kukulu_run_start` never counts). The last two checks matter most: a task is done when there is a commit, not when a model says so.

**Clean-room mode.** After genesis, this tool appends a signed `checkpoint` entry (event `kukulu_task_done`) to `.kukulu/cleanroom/log.jsonl` before its final commit and commits the log with its own files; a failed commit restores the log byte for byte. General mode writes none. Uncommitted appends to the log never count as a dirty tree, because the hooks write to it after every tool call.

---

## `kukulu_task_block`

Give up on a task without ending the run.

**Arguments:** `{ id, reason, stream? }`. The reason should read `what you tried / what fails / what you think the fix is`. With `stream`, the reset and clean happen in that stream's worktree only, leaving alone the main checkout, which holds every other stream's uncommitted bookkeeping.

**Does:** `git reset --hard HEAD` and `git clean -fd`, excluding every path recorded as `preexistingUntracked` (the lock survives too, being gitignored). It deletes only what the attempt itself left behind, never a file that predates the run. Marks the task `[!]`, logs `BLOCKED: <reason>`, commits as `progress: <ID> blocked`, and resets the implement guard's re-block counter to zero.

**Returns:** `{ id, progressCommit, counts }`.

**Refuses when:** the id is unknown, or either argument is missing.

**Clean-room mode.** After genesis, this tool appends a signed `checkpoint` entry (event `kukulu_task_block`; its hard reset keeps the hooks' uncommitted log entries) to `.kukulu/cleanroom/log.jsonl` before its final commit and commits the log with its own files; a failed commit restores the log byte for byte. General mode writes none. Uncommitted appends to the log never count as a dirty tree, because the hooks write to it after every tool call.

---

## `kukulu_task_reopen`

Reopen a blocked or skipped task once whatever stopped it is resolved: an operator supplied a file the sandbox could not download, say, or a flaky service came back. It is for an operator, or a session the operator directs. It is not in the flight controller's allowed tools; inside a flight, the reviewer's `unblock` does the same job.

**Arguments:** `{ id, reason }`. `reason` says what changed so the task can now succeed.

**Does:** sets the task back to `[ ]` and logs `REOPENED: <reason>` under a `### <ID> — reopened` entry. Then it reopens every skipped `[-]` task that depends on it, directly or through another task reopened here, each with a log entry naming its cause. It commits `PROGRESS.md` as `progress: reopen <ID>`, or `progress: reopen <ID> (+N dependents)` when there were any, and resets the guard's re-block counter. A reopened dependent that still has a *different* blocked dependency is skipped again by the next `kukulu_task_next`, so reopening generously is safe. After a finished run (`implemented: true`), the open tasks make `kukulu_next` hand out an implement stage for the same round again.

**Returns:** `{ id, reopenedDependents, commit, counts }`.

**Refuses when:** either argument is missing; the id is unknown; the task is neither blocked nor skipped; the flight is already summarized; or a stream worktree still exists.

---

## `kukulu_verify`

Run the project's verification commands through the server rather than the model's Bash tool, so an unattended run does not stop at a permission prompt.

**Arguments:** `{ files?: string[], stream? }`, where `files` is the task's touched files. A whitespace- or comma-delimited string is accepted too. With `stream`, every command and the constraint scan run in that stream's worktree, and the call refuses if the selected commands include an `exclusive` one (a command that only ever runs from the main checkout: validation keeps the tasks that trigger one out of waves, so reaching this is a bug to report).

**Does:** first it self-tests every rule in `docs/kukulu.json`'s `constraints` against the rule's own `shouldMatch`/`shouldNotMatch` fixtures. Only a rule that passes then scans for real hits: every file under its `paths` minus `exclude` that is tracked or untracked-but-not-ignored, skipping files that were already untracked when the run started (a new file not yet committed is scanned; see [operations.md](./operations.md#constraints)). This scan ignores `files` and always covers the whole repo. Then it runs every command in `verify`, and for each `extraVerify` prefix that any touched file starts with, appends its commands (skipping duplicates by command text). Each command runs in a shell from the project root with its own timeout: `commandTimeoutMs` (default 10 minutes) unless the command was given as `{ cmd, timeoutMs }` in `docs/kukulu.json`, which overrides it for that command alone.

Every command (here, in `kukulu_mutate` and in `parallel.setup`) runs under `mcp/run-command.mjs`, in its own process group. A timeout kills the whole tree, not just the shell, so a test binary spinning under `make test` does not survive it. A command that writes more than 64 MiB of output in total is killed. Once the shell has exited, a leftover child still holding its output open gets two seconds before its group is killed. None of these can hang the server or take it down.

**Returns:** `{ ok, constraints: { ok, results: [{ id, ok, fixture, hits, inactive? }] }, results: [{ command, ok, exitCode, timedOut, timeoutMs, stdoutTail, stderrTail }] }`, where a rule with an unreached `from` carries `inactive: "until <id>"` and a command with one appears as exactly `{ cmd, skipped: "inactive until <id>" }` (neither is ever a failure), plus `recoveredMutation` (a path) when it first had to restore a file a crashed [`kukulu_mutate`](#kukulu_mutate) left edited. The tails are the last 60 lines of each stream, and never more than 4000 characters; `timeoutMs` is whichever timeout that command actually ran with. A result may also carry `truncated: true` (a tail was cut), `outputLimitExceeded: true` (killed for writing too much; `ok` is false) and `orphansKilled: true` (a leftover child was killed after the shell exited; `ok` follows the shell's own exit status). For a constraint result: `fixture` is `null` when the rule's own self-test passed, else a message naming the disagreeing fixture line (and `hits` is then always empty, since a rule that fails its own test does not scan); `hits` is `{ file, line, text }` for each real match. Top-level `ok` is true only when every constraint and every command passed.

**Refuses when:** `kukulu.json` is missing or has no `verify` commands; any `verify`/`extraVerify`/`build` entry is malformed (neither a string nor `{ cmd, timeoutMs }`, missing `cmd`, or `timeoutMs` not a positive integer); or any `constraints` entry is malformed (missing `id`, `paths`, `pattern`, `shouldMatch` or `shouldNotMatch`, an unparseable `pattern`, or a duplicate `id`).

---

## `kukulu_mutate`

Mutation-test one file: prove that a test fails without the mechanic it covers. The reviewer uses it instead of hand-editing source and restoring it with `git checkout`. The auto-mode classifier refuses that in-tree edit for a reviewer told not to fix code, and a scratch copy cannot replace it for suites bound to the repo root (wp-env).

**Arguments:** `{ file, find, replace, commands?, timeoutMs?, targeted?, filter?, confirmKill? }`.

- `file`: a repo-relative path to a tracked text file with no uncommitted changes
- `find`: the exact text to replace; it must appear in the file exactly once (the refusal says how many times it did and asks for more context)
- `replace`: the mutated text; `""` deletes the match
- `commands`: optional. Run only these commands, each spelled exactly as in `docs/kukulu.json`'s `verify` or `extraVerify`
- `targeted`, `filter`: optional, together. Run the named `mutation.targeted` command from `docs/kukulu.json` instead of the file's verify commands, with `{filter}` replaced by `filter` as one single-quoted shell word. `filter` is 1 to 200 characters from letters, digits and `_ . : / -`. Refused, before the file is touched, when only one of the two is passed, when combined with `commands`, for an unknown name (the message lists the configured names), or for a filter with any other character
- `confirmKill`: optional boolean (anything else is refused). When the mutant is killed, each failed command is re-run once on the restored, unmutated tree. If every re-run passes the kill stands (a kill by a constraint alone stands without a `confirm`); if any fails again the result is `killed: false`, `inconclusive: true` and a verdict of `inconclusive: <cmd> also fails without the mutation`
- `timeoutMs`: optional. Cap every command's timeout for this call. It only ever shortens a configured timeout, never raises one; it is for a mutant you suspect makes a test hang

**Does:** writes `.kukulu/mutation.json` (a sentinel naming the file), applies the one replacement, runs the commands, and then, whatever happened (a timeout included), restores the file from `HEAD` and deletes the sentinel. Commands default to what `kukulu_verify` would run for that file: every `verify` command plus the `extraVerify` commands whose prefix the file falls under. After applying the mutation and before the commands it runs the active `docs/kukulu.json` constraints over the mutated tree (a rule with an unreached `from` stays inactive), so a mutant that only a constraint catches is a kill. It commits nothing, and the sentinel is excluded through `.git/info/exclude`, never `.gitignore`, so the tree under review stays clean.

It also undoes whatever else the commands changed, such as a test framework's regression seeds. Every tracked file that was clean before the call and differs from `HEAD` afterwards is restored, and every untracked file that is new is removed. A file that was already dirty or untracked before the call is never touched, and nor is an ignored file. Crash recovery restores only the mutated file: by the time it runs, a new untracked file may be the reviewer's own.

If the restore did not take, it says so (naming the file and the command to run by hand), leaves the sentinel, and auto-logs a `mutation-restore` feedback entry under the usual `policies.feedback` guard.

**Crash recovery:** if the server died between mutating and restoring, the sentinel is still there. `kukulu_mutate`, `kukulu_verify` and `kukulu_review_submit` each restore the file from it before doing anything else, report the path as `recoveredMutation`, and log a `mutation-recovered` feedback entry, committed on its own as `chore: pipeline friction (review)` so the tree is never left dirty. An unreadable sentinel is a refusal that tells you how to recover by hand.

**Returns:** `{ file, killed, verdict, failedCommands, results, constraints, restored, removed, recoveredMutation }`, plus `confirm` (the re-run results, present only when `confirmKill` re-ran something) and `inconclusive: true` when a re-run failed again. `failedCommands` lists the command text of every failed result. `restored` and `removed` list the residue paths it put back or deleted. `constraints` is `{ ok, results }` as `kukulu_verify` reports it, run on the mutated tree: a rule with hits counts as a kill, a rule whose own fixture fails is reported but is not one. `killed` is true when at least one command failed or a constraint has hits, meaning the tests or a rule noticed; a timeout counts as a failure, and a command skipped as inactive until a `from` task never does. `verdict` is `"killed: the tests caught the mutation"`, `"killed: constraint <id> caught the mutation"` (the first such id, when no command failed), or `"survived: no command failed — the mechanic is untested"`; a survivor is a category-3 review finding. `results` has the same per-command shape as `kukulu_verify`. Run `kukulu_verify` first: on a tree that already fails, every mutation looks killed.

**Refuses when:** an implementation run is in progress (`.kukulu/implement.lock` exists), since this is a review-stage tool; `file` is outside the project, missing, a symlink, untracked, binary, or has uncommitted changes; `find` is empty, or matches zero or several times, or equals `replace`; `timeoutMs` is not a positive integer; `commands` names something that is not a configured `verify`/`extraVerify` command (the message lists the legal ones); or the config has no `verify` commands.

---

## `kukulu_stream_finish`

Finish one stream of a parallel wave: merge its branch back into the build branch and clean up. A stream's implementer calls it when `kukulu_task_next({ stream })` reports `done`.

**Arguments:** `{ stream }`.

**Does:**

1. Lands any pending `PROGRESS.md` / `state.json` / feedback changes in the main checkout as `progress: sync before merging stream <s>`, so the merge starts from a clean tracked tree.
2. Runs `git merge --no-ff -m "merge stream <s> (wave <n>)"` of `<build-branch>--<stream>` in the main checkout. Nobody else works there during a wave, and the server handles one call at a time, so this cannot race another stream.
3. Removes the worktree (`git worktree remove --force`: `parallel.setup` leaves ignored dependency directories behind, and steps above have already refused on uncommitted tracked work) and deletes the stream branch.

A stream whose tasks were all blocked or skipped still finishes: the merge is a no-op (`mergeCommit: null`) and the worktree is cleaned up. Its blocked tasks go to review like any others.

**On a merge conflict** (the partition check makes one unlikely, not impossible), Kūkulu runs `git merge --abort`, keeps the stream's branch and worktree, sets `halted` in `.kukulu/state.json` with a reason naming the stream, the conflicting paths and the manual steps, auto-logs a `stream-merge` feedback entry, and commits both together as `chore: run halted (stream <s> merge conflict)`. This is the one stream failure that halts, because Kūkulu cannot guess a merge. It returns `{ stream, merged: false, halted, conflicts }` and `kukulu_next` says `halt`.

**Returns:** `{ stream, merged: true, mergeCommit, remainingStreams }`. `remainingStreams` names the wave's other streams that still have open tasks or an unmerged worktree.

**Refuses when:** `stream` is not one of the current wave's streams (see [`kukulu_run_start`](#stream-mode)); it has no worktree; it still has open tasks (they are named); its worktree has uncommitted changes (they are listed); the main checkout is not on the build branch or has uncommitted tracked changes; or its branch is missing.

`kukulu_run_finish` refuses while any stream worktree exists, naming each.

---

## `kukulu_run_finish`

End an implementation run and hand off to review.

**Arguments:** none.

**Does:**

1. Commits `docs/HANDOFF.md` as `chore: handoff for review`.
2. Records the round as implemented in `.kukulu/state.json` and commits it as `chore: round N implemented`.
3. Pushes to `origin` if `policies.push` is true and there is one, and, if `policies.pr` is not `"none"` and `gh` is on `PATH`, opens a draft PR against `baseBranch` (`--base`, always) with `HANDOFF.md` as the body, or reports the existing one.
4. Deletes the lock, standing the guard hook down.
5. Runs every constraint over the whole tree, as `kukulu_verify` does, and reports the result without refusing on it.

**Returns:** `{ branch, base, head, handoffCommit, stateCommit, push, pr, counts, round, constraints, readyLine }`. `constraints` is `{ ok, failing: [<rule ids>] }`, and a rule whose `from` task has not started is inactive there too; when any rule fails, the ready line ends with `; constraints failing: <ids>`. `push` is `"pushed"`, `"skipped: no origin remote"`, `"skipped: policy"`, or `"failed: <git's message>"`. A failed push does not fail the handoff, because the branch can still be reviewed locally. `pr` is `null` when there was nothing to try, `"skipped: policy"` when `policies.pr` is `"none"`, a URL, or a `gh` failure message.

**Refuses when:** any task is still open; `HANDOFF.md` does not exist; or the tree is not clean after the handoff commit, again ignoring anything recorded as `preexistingUntracked`.

**Clean-room mode.** After genesis, this tool appends a signed `checkpoint` entry (event `kukulu_run_finish`) to `.kukulu/cleanroom/log.jsonl` before its final commit and commits the log with its own files; a failed commit restores the log byte for byte. General mode writes none. Uncommitted appends to the log never count as a dirty tree, because the hooks write to it after every tool call.

---

## `kukulu_run_halt`

Stop the flight for an operator-level reason the implementer cannot resolve itself: a signing agent that died mid-run, a full disk, a `verify` command that cannot even run, a base branch that vanished. `kukulu_task_block` is for a single task the implementer cannot finish; this tool is for a run that cannot continue at all.

**Arguments:** `{ reason }`: one sentence a human will read.

**Does:** records `reason` as `state.halted`, deletes the lock, and commits `.kukulu/state.json` and `docs/PROGRESS.md` together as `chore: run halted` if either changed. It never resets or cleans the working tree; the tree is left as it was when the run stopped.

**Returns:** `{ halted, branch, head, commit, dirty, next }`. `next` is the instruction to call `kukulu_run_resume` once the cause is fixed. `dirty` is true when anything is left uncommitted, which after a halt is expected, not an error.

**Refuses when:** `reason` is missing.

The next `kukulu_next` call returns `{ stage: "halt", reason }` with the same reason. Once the cause is fixed, clear it with [`kukulu_run_resume`](#kukulu_run_resume); the `halt` reason from `kukulu_next` ends with that instruction. See [operations.md](./operations.md#halts).

---

## `kukulu_run_resume`

Clear a halt once whatever caused it is fixed, so nobody edits `.kukulu/state.json` by hand. A round-cap halt is not cleared here: it is lifted by [`kukulu_flight_options`](#kukulu_flight_options) with `resume: true`.

**Arguments:** `{ reason }`: what you fixed, a non-empty string.

**Does:** sets `state.halted` to `null` and deletes `state.haltStream`, appends one feedback entry (`stage: "controller"`, `category: "resume"`, `source: "human"`; skipped when `policies.feedback` is false) naming the reason, and commits state and feedback together as `chore: run resumed`. If the commit fails, both files are put back exactly.

**Returns:** `{ resumed: true, previousHalt, commit }`.

**Refuses when** (in this order, before anything is written): `reason` is empty; the flight is not halted; the halt is a round-cap halt; the working tree is dirty apart from files untracked before the run started (the lines are listed); a stream worktree still exists (it is named); `baseBranch` does not exist as a local branch; or the halt came from merging a stream (`kukulu_stream_finish` records `state.haltStream`) and that stream's branch still exists unmerged into the build branch.

---

## `kukulu_flight_options`

Apply the operator's flight options to `docs/kukulu.json`. go-flight calls it when `/kukulu:go-flight` was given options such as "maximum review depth of 6 rounds", so the controller never hand-edits the config.

**Arguments:** `{ maxRounds?, maxRoundsHard?, resume? }`. The first two are positive integers, and at least one must be given; `resume` is a boolean. See [operations.md](./operations.md#configuration) for what each bounds.

**Does:** sets the given keys in `docs/kukulu.json`, leaving every other key as it was, and commits the file as `chore: flight options (maxRounds=6, maxRoundsHard=6)`. Applying the same values twice commits nothing. A flight halted on a round cap stays halted unless `resume: true` is passed. Then, if the bound passed lifts the cap that fired (`maxRoundsHard >= the round`, or `maxRounds` above the non-converging count), the same commit also clears `halted` and `haltCap` in state, with the subject `chore: flight options (<k=v>, resume)`.

**Returns:** `{ before, after, commit }`, plus `resumed: true` after a resume. `before` and `after` are the effective bounds, defaults included.

**Refuses when:** neither key is given; a value is not a positive integer; `docs/kukulu.json` does not exist yet (before the plan stage); or, with `resume`, the flight is not halted, the halt is not a round-cap halt (a stream-merge or operator halt is never cleared this way), or the bound passed would not lift the cap that fired.

---

## `kukulu_cleanroom_record`

Put what the operator said, did or decided into the clean-room chain. It replaces the hand-kept intervention and denial-verdict files of earlier clean-room runs. For the flight controller only, on the operator's word: `/kukulu:go-flight` maps "record: <text>", "record intervention: <text>" and "record verdict: <text>" to it.

**Arguments:** `{ text, kind? }`. `kind` is `instruction` (the default), `intervention` (something done outside the pipeline: a file supplied, a fix made by hand, a tool installed) or `verdict` (a human classification of a denial). A verdict's text reads `#<seq>: prior-art attempt|false positive|offline test — <note>`, and `<seq>` must be a `denied` entry in the log.

**Does:** appends `{ kind: "human", stage: "controller", role: "operator", target: <text>, data: { kind } }` and commits the log as `chore: clean-room record`; a failed commit restores the log.

**Returns:** `{ recorded: true, seq, kind, commit }`.

**Refuses when:** the project has no clean-room flight past genesis; `text` is empty; `kind` is not one of the three; a verdict is malformed; or a verdict's seq is not a `denied` entry. It is not behind the gate, so an operator can record a verdict about the denial that halted the flight.

**Other human entries.** In clean-room mode `kukulu_flight_options`, `kukulu_run_resume` and `kukulu_pr_finalize({ resign: true })` each append a `human` entry (`data: { kind: "instruction", via: "<tool>" }`, `target` the call's arguments as JSON) in the commit they make, and the `UserPromptSubmit` hook appends one for every prompt typed into a session in the project.

---

## `kukulu_feedback_log`

Record one pipeline-friction entry: time lost to Kūkulu's own tooling rather than to the project it is building, such as a tool refusal, an ambiguous prompt, or a stall that needed a workaround. Any stage may call it, at the moment the friction happens rather than in end-of-stage prose, so the record survives a flight that halts, blocks, or is abandoned before it reaches `kukulu_summary_commit`.

**Arguments:** `{ stage, message, category? }`. `stage` is one of `plan` · `implement` · `review` · `summarize` · `controller`; `message` is one or two sentences; `category` is a short free-form label (e.g. `"tool-refusal"`, `"ambiguous-prompt"`, `"stall"`) and defaults to `"other"`.

**Does:** unless `policies.feedback` is `false`, appends one JSON line, `{ at, stage, round, category, message, source: "agent" }`, to `.kukulu/feedback.jsonl` (`at` is an ISO timestamp and `round` is filled in from `.kukulu/state.json`), and commits that file alone as `chore: pipeline friction (<stage>)`. Unlike every other write tool, it commits on every call instead of waiting for a later checkpoint. Friction is rare, so one small commit per entry adds little noise, and the file is never a *pending* uncommitted change by the time `kukulu_task_done` or `kukulu_run_finish` run their dirty-tree checks.

**Returns:** `{ logged: true, count, commit }` normally; `{ logged: false, reason: "disabled by policy" }` when `policies.feedback` is `false`. That case is never a refusal, so a model does not have to check whether logging is allowed before calling it.

**Refuses when:** `stage` is not one of the five legal values; `message` is missing or empty; `policies.feedback` is present but not a boolean.

Some events are logged automatically, without a model calling this tool: a `kukulu_run_halt`, a review round-cap halt, and a signing auto-fallback each fold a `source: "auto"` entry into the commit they are already making. See [operations.md](./operations.md#configuration) for `policies.feedback` and [architecture.md](./architecture.md) for the full list of what logs itself.

---

## `kukulu_review_submit`

Record a verdict. Call it exactly once per review. It is all-or-nothing: if its commit fails, every file it wrote is restored, nothing stays staged, and calling it again is safe.

**Arguments:**

```jsonc
{
  "verdict": "APPROVED" | "CHANGES REQUESTED",
  "tasks": [                       // CHANGES REQUESTED only
    {
      "title": "…",                // required
      "goal": "…",                 // required
      "files": ["src/a.ts"],       // required, non-empty
      "tests": "…",                // required — the test that would have caught this
      "constraints": "…",
      "outOfScope": "…",
      "verification": "…",
      "dependsOn": ["R1-01"],
      "source": "review"          // required: "review", "mutation" or "blocked"
    }
  ],
  "unblock": [                     // CHANGES REQUESTED only
    { "id": "P2-04", "reason": "the API does exist; see SPEC §6" }
  ]
}
```

`unblock` also accepts bare id strings, which get a default reason.

**Does, for `APPROVED`:** records the verdict, appends an entry to `state.rounds` (with `sources: { review: 0, mutation: 0, blocked: 0 }`), commits `REVIEW.md` as `review: round N approved`, and pushes the branch per `policies.push`.

**Does, for `CHANGES REQUESTED`:** assigns `R<N>-<nn>` ids, appends `## Review fixes (round N)` to `PLAN.md` in task format, appends the checkbox lines to `PROGRESS.md` above `## Log`, resets unblocked tasks to `[ ]` with their reasons logged, along with every task skipped because of them (transitively, each logged with its cause), bumps the round, appends an entry to `state.rounds` (its `sources` counts the fix tasks by `source`), commits everything as `review: round N`, and pushes the branch per `policies.push`. It halts (writes a `halted` reason into `.kukulu/state.json`, which stops the next flight) when the new round reaches `maxRoundsHard`, or when the count of non-converging rounds so far reaches `maxRounds`. [architecture.md](./architecture.md#review-rounds) defines "non-converging".

**Returns:** `{ verdict, round, fixRounds, commit, push }` for an approval; `{ verdict, round, fixTasks, unblocked, reopenedDependents, commit, halted, counts, push }` for changes. `round` is always the number this review was stamped with (`N`), never the count of fix rounds; for an approval, `fixRounds` is that count. `push` is the same shape `kukulu_run_finish` returns. `counts` describes `PROGRESS.md` as this call left it, including the fix tasks it just queued. Either shape also carries `recoveredMutation` (a path) when the call first had to restore a file a crashed [`kukulu_mutate`](#kukulu_mutate) left edited.

**Refuses when:** the verdict is neither legal value; `REVIEW.md` does not exist; no implementation handoff has been recorded for this round; `REVIEW.md`'s `Round:` line is missing or does not equal `reviewRound`; an approval carries fix tasks or unblocks; changes are requested with neither; a fix task is missing `title`, `goal`, `files` or `tests`, or its `source` is not `review`, `mutation` or `blocked`; the round is past `review.mutationFixRounds` and a fix task has `source: "mutation"` (a surviving mutant is a note in `REVIEW.md` by then); a fix task's `dependsOn` names something that is neither an existing task nor one of this submission's own ids; or an unblock names a task that does not exist or is not blocked or skipped.

**Clean-room mode.** After genesis, this tool appends a signed `checkpoint` entry (event `kukulu_review_submit`) to `.kukulu/cleanroom/log.jsonl` before its final commit and commits the log with its own files; a failed commit restores the log byte for byte. General mode writes none. Uncommitted appends to the log never count as a dirty tree, because the hooks write to it after every tool call.

---

## `kukulu_summary_commit`

**Arguments:** `content` (optional string): the full text of `docs/SUMMARY.md`. This is the preferred form: the tool writes the file itself (adding a final newline), so the summarizer never needs `Write`. It must be non-empty and under 1 MiB. Without it the tool commits the file already on disk, as in 0.4.0.

**Does:** marks the flight complete, commits `docs/SUMMARY.md` as `chore: build summary`, and pushes the branch per `policies.push`.

**Returns:** `{ commit, branch, base, head, reviews, fixRounds, push, pr, archive }`. `archive` is `policies.archive`, so the summarizer reads the policy from the result: when it is true, call [`kukulu_flight_archive`](#kukulu_flight_archive) next. `reviews` is how many reviews the flight took and `fixRounds` how many fix rounds came between them; after an approval, reviews = fixRounds + 1. `pr` is the branch's pull request from `gh pr view`, as `{ url, state, draft, base }`, with `expectedBase` added when it does not target `baseBranch`. Otherwise it is `"none"`, `"skipped: policy"` or `"unknown: <why>"` (`gh` missing or failing). This is never a refusal.

**Refuses when:** the recorded verdict is not `APPROVED` (before anything is written); `content` is not a string, is empty after trimming, or is 1 MiB or more; or `content` is absent and `SUMMARY.md` does not exist.

**Clean-room mode.** After genesis, this tool appends a signed `checkpoint` entry (event `kukulu_summary_commit`) to `.kukulu/cleanroom/log.jsonl` before its final commit and commits the log with its own files; a failed commit restores the log byte for byte. General mode writes none. Uncommitted appends to the log never count as a dirty tree, because the hooks write to it after every tool call.

---

## `kukulu_similarity`

Score how close the built code is to the prior art the operator named, inside the server. The agents never receive prior-art text through this tool, only numbers, and the scorer is refused while an implementer run is armed, so no implement-stage call can trigger a read of the comparison corpus. For the summarizer, after `kukulu_summary_commit`, when `cleanroom.similarity` is configured.

**Arguments:** none.

**Does:** reads every file of every pair side (recursively, skipping `.git` and `node_modules`; `subject` is the `subject` list, `~` the home directory, a relative path the project), maps extensions through `languages` and counts unmapped or binary files as skipped, scores each pair with the lexical metrics (`ngram_jaccard@n` and `ngram_containment@n` for each `n`, `ident_jaccard`, `ident_match_rate_left`, `comment_jaccard`), positions each test pair between the negative and the positive control per metric, and computes the verdict. It writes `.kukulu/cleanroom/similarity.json` (`{ config, files: [{ pair, side, path, sha256, bytes, language }], rows, verdict, limits, at }`) and `docs/SIMILARITY.md` (the statement, one line per metric, the verdict, the raw scores, the limits; no timestamp, so the same inputs give the same bytes), and commits both as `chore: similarity scored`. In clean-room mode it first appends a `score` entry (`data: { reads, sha256 }`: the number of files read and the SHA-256 of `similarity.json`) and a checkpoint (event `kukulu_similarity`), and commits the log with them. `kukulu_flight_archive` moves `docs/SIMILARITY.md` and `similarity.json` with the other artifacts.

**Returns:** `{ verdict, rows, files, skipped, limits, commit }`. `files` counts the distinct files read and `skipped` the distinct files left unread; `similarity.json` lists a file once for every pair side it appears in. A row is `{ pair, role, metric, score, c, band }`; `c` and `band` are `null` for the controls.

**Refuses when** (in this order, before any write): `cleanroom.similarity` is absent; the implement lock exists; the flight is not reviewed `APPROVED`; a pair directory is missing or empty, or no file in it has a mapped extension; `identExclusions` names a file that does not exist; or, in clean-room mode, the gate fails.

---

## `kukulu_flight_archive`

Archive a summarized flight so the repository can run its next one.

**Arguments:** `{ slug? }`, lowercase letters, digits and `-`, at most 40 characters. It defaults to the `flight` key in `docs/kukulu.json`; with neither, the tool refuses.

**Does:** moves `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/HANDOFF.md`, `docs/REVIEW.md`, `docs/SUMMARY.md`, `docs/SIMILARITY.md`, `docs/kukulu.json`, `.kukulu/state.json` and `.kukulu/feedback.jsonl` (each one that exists) into `docs/flights/<slug>/` (`git mv` for a tracked file, a plain rename for an untracked one), copies `docs/SPEC.md` there (the live spec stays), writes a fresh `.kukulu/state.json` that records `archived: { slug, dir, at }` and carries `signingOverride` over, commits everything as `chore: archive flight <slug>`, and pushes the branch per the push policy. If the commit fails, every file is put back and the empty archive directory removed.

After it, `kukulu_next` reports `done` until `docs/SPEC.md` is edited, then `plan`.

**Returns:** `{ slug, dir, moved, copied, commit, push }`.

**Refuses when** (in this order, before anything moves): there is no slug; the slug is malformed; the flight is not summarized; the implement lock is armed; the working tree is dirty (apart from files that were untracked before the run started); or `docs/flights/<slug>/` already exists.

**Clean-room mode.** After genesis, this tool appends a signed `checkpoint` entry (event `kukulu_flight_archive`, written before the log (and `similarity.json`, when present) moves into `docs/flights/<slug>/cleanroom/`, so the next flight's genesis is entry 1) to `.kukulu/cleanroom/log.jsonl` before its final commit and commits the log with its own files; a failed commit restores the log byte for byte. General mode writes none. Uncommitted appends to the log never count as a dirty tree, because the hooks write to it after every tool call.

---

## `kukulu_pr_finalize`

End a flight: mark its draft pull request ready and, unless the flight is breaking, ask GitHub to merge it once its checks pass. Kūkulu never merges a pull request itself; the only `gh pr merge` it ever runs carries `--auto`.

**Arguments:** `{ breaking, resign? }`, booleans. `breaking` is required on the first call; later calls reuse the remembered `state.breaking`. `resign` is human-initiated only: no agent passes it on its own (see below).

**Refuses when** (before anything is written): the summary is not committed (`state.summarized`, or, after an archive, the archived `state.json`); `breaking` is not a boolean or was never given; or there is no merge base with `baseBranch`. After an archive it reads `docs/flights/<slug>/kukulu.json` for the config.

**`resign: true`** is for an operator who has unlocked the signing agent after an awaiting-signing result. After the preconditions and before the signed check it: refuses a dirty tree (apart from files untracked before the run) or being on `baseBranch`; unsets the local `commit.gpgsign` override a fallback left behind, then proves signing with the `required` probe (on failure the override goes back and the probe's refusal is returned); runs `git rebase -f --rebase-merges --gpg-sign <merge-base>` (no prompts, bounded by `commandTimeoutMs`; on failure it aborts the rebase, restores the override and refuses with git's first lines); re-runs the signed check and refuses, naming the count and oldest sha, if anything is still unsigned (the rewritten branch is left as it is); force-pushes with `--force-with-lease` per the push policy, reported as `resignPush`; clears `awaitingSigning` and `signingOverride`, records `signing: "on"`, and carries on into the all-signed path below. The result has `resigned: true`.

**Signed check.** It runs `git log --format='%H %G?' <merge-base>..HEAD`. A commit whose `%G?` is `N` (none) or `B` (bad) is unsigned; anything else, `E` (the signature cannot be checked here) included, is signed. It judges the commits themselves, never `state.signing`.

**Any unsigned commit.** The pull request stays a draft. It records `state.awaitingSigning = { unsigned, first, since }` (`since` is kept across calls), logs one `signing` feedback entry the first time, appends an `## Awaiting signing` section with the steps to the flight's `SUMMARY.md` (once), commits as `chore: awaiting signing`, and pushes per policy. `kukulu_next` then reports `done` with the reason `awaiting signing: …`. Returns `{ signed, unsigned, ready: false, merge: "skipped: awaiting signing", breaking, awaitingSigning, resigned: false, push, pr, next }`; `next` is the instruction to unlock the signing agent and finalize again.

**All signed.** It records `breaking`, clears `awaitingSigning`, unsets the local `commit.gpgsign` and records `signing: "on"` if signing was switched off for the run, commits `chore: finalize flight` (taking the unsigned path if that commit itself came out unsigned), pushes, and then, when `policies.pr` is `draft` and the pull request exists, follows `policies.finalize`: `"auto"` runs `gh pr ready` and then `gh pr merge --auto --<policies.mergeMethod>`; `"ready"` runs only `gh pr ready`; `"draft"` changes nothing. Returns `{ signed, unsigned: 0, ready, merge, breaking, awaitingSigning: null, resigned: false, push, pr }`. `ready` is true when the pull request ends up not a draft. `merge` is `"enabled"`, `"skipped: breaking"`, `"skipped: policy"`, `"skipped: no pull request"`, or `"unavailable: <gh's first stderr line>; set policies.finalize to \"ready\" to stop asking"` (the pull request is left ready).

---

## `kukulu_agents_sync`

Generate `.claude/agents/kukulu-<role>.md` for each of the four roles from the merged routing config. `/kukulu:go-flight` calls it once, before its loop; see [routing.md](./routing.md) for the full precedence.

**Arguments:** none.

**Does:**

1. Resolves the routing config (plugin defaults < global file < profile < `docs/kukulu.json` `roles`), per role, per key.
2. Renders each role's agent file and writes it only when the rendered text differs from what is already on disk. The frontmatter is copied from the plugin's own `agents/<role>.md` (`description`, `tools`, `skills`, `color`), plus the resolved `model`, `effort` (only when the model is a known Anthropic alias or a `claude-*` id) and `permissionMode`.
3. Ensures the MCP allow rule (`{ "permissions": { "allow": ["mcp__plugin_kukulu_kukulu"] } }`) is covered by either `.claude/settings.json` or `.claude/settings.local.json`: read-merge-write on the local file, preserving every other key and allow entry, creating the file only if neither already covers it. A `settings.local.json` that exists but fails to parse is never overwritten. See [operations.md](./operations.md#running-a-flight) for why this rule matters.
4. In a git repository, ensures both `.claude/agents/kukulu-*.md` and `.claude/settings.local.json` are present in `.git/info/exclude`, not `.gitignore`: both describe one person's machine, not the project, and this way needs no commit. Outside a git repository, this step is skipped, not an error.

**Returns:** `{ dir, globalConfig, globalConfigPath, profile, profileSource, projectOverride, permissionMode, roles, effortDropped, changed, unchanged, permissions, restartRequired, exclude, table }`.

- `roles`: `{ <role>: { agent, model, effort, source: { model, effort } } }` for all four roles; `source` is `default` | `global` | `profile:<name>` | `project`
- `effortDropped`: `{ <role>: <effort> }` for any role whose configured effort was dropped because its model is not an Anthropic one
- `changed` / `unchanged`: role names written this call / left alone because their rendered content was already correct
- `permissions`: `"added"` | `"present"` | `"failed: <why>"`, from the MCP allow rule step above
- `restartRequired`: true only when this call populated the `.claude/agents` directory for the *first* time in this project and at least one changed role's model is not one the `Agent` tool can name directly. Claude Code hot-reloads a change to an already-populated agents directory within seconds, so every other case, including every later routing edit, needs no restart; `kukulu_next` falls back to the plugin's own agent with the resolved model in the meantime. See [routing.md](./routing.md).
- `exclude`: `"added"` | `"present"` | `"skipped: not a git repository"`
- `table`: the same information as a ready-to-print Markdown table

`/kukulu:go-flight` checks `restartRequired` and stops with a fixed message rather than spawning a stage against a model it cannot reach; see [operations.md](./operations.md#routing).

**Refuses when:** the merged routing config is malformed: an unknown role or role key, an invalid `effort` or `permissionMode` value, an unknown top-level key in the global file, or a `KUKULU_PROFILE` (or the global file's own `"profile"` key) naming a profile that does not exist. Nothing is written on a refusal.

---

## `kukulu_config_show`

The merged routing config, read-only, with the source of every value.

**Arguments:** none.

**Returns:** `{ globalConfig, globalConfigPath, profile, profileSource, projectOverride, permissionMode, permissionModeSource, roles, effortDropped, agentsGenerated, agentsStale, permissionRule, table }`.

`agentsGenerated` is the same field `kukulu_status` returns. `agentsStale` lists roles whose generated file exists but no longer matches what `kukulu_agents_sync` would write for the current config. `permissionRule` is `"present"` when either settings file already covers the MCP allow rule, else `"missing"`. This tool writes nothing, so both are reported, not fixed; only `kukulu_agents_sync` writes.

**Refuses when:** the same conditions as `kukulu_agents_sync`, with the same messages.

---

## Calling the server directly

It speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, so it can be driven from a shell for debugging:

```bash
KUKULU_PROJECT_DIR=/path/to/project node mcp/server.mjs <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kukulu_status","arguments":{}}}
EOF
```

`test/harness.mjs` wraps the same transport, and every suite talks to the server through it.
