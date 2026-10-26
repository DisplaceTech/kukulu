# Operations

How to run a flight, resume one, and unstick one. Everything Kūkulu knows is on disk and committed, so there is no hidden state: when something looks wrong, `kukulu_status` shows all of it.

## Running a flight

```bash
cd myproject
claude
> /kukulu:go-flight
```

The controller is model-invocable, so asking for it by name also works; the slash command is the documented shortcut. It prints the stage it is entering, delegates, and repeats. Each stage is one `Agent` call that either blocks until the stage finishes or returns at once and delivers its result later as a completion notification. The controller treats both the same way and never polls in between. When it stops, it prints the final stage, the number of reviews and fix rounds, the branch, and the path to `docs/SUMMARY.md` if one exists.

### Flight options

Text after the command is the flight's options:

```text
> /kukulu:go-flight max review rounds 6
```

The review-loop bounds are the only options. "max review rounds N" (or "maximum review depth of N rounds", or any phrasing that plainly asks for at most N reviews) sets both `maxRounds` and `maxRoundsHard` to N. The controller applies the options with `kukulu_flight_options` as soon as `docs/kukulu.json` exists, that is, right after the plan stage. The tool commits them as `chore: flight options (…)`. The controller prints anything it cannot map as `ignored flight option: …` and carries on without asking.

### First flight in a project

On a project's first flight, every stage runs on the plugin's own `kukulu:<role>` agent, with the routed model passed as an alias. The generated `kukulu-<role>` agents land in a `.claude/agents` directory this session created, and Claude Code loads a new agents directory only in the next session. `kukulu_next` names the plugin agent outright, so this is quiet. One difference matters: plugin agents ignore `permissionMode`, so the first flight's stages run under your session's own permission mode. Start the session in `acceptEdits` mode, or a stage may be refused the `Write` tool and fall back to writing files with a shell heredoc. From the second flight on, the generated agents carry the routed `effort` and `permissionMode` themselves.

An implementer that hits a permission prompt sits there until the guard's cap trips, hours later, having done nothing. The generated `kukulu-<role>` agents carry `permissionMode: acceptEdits`, which covers file edits.

MCP tool calls need one allow rule, since a subagent's permission mode does not cover them:

```json
{ "permissions": { "allow": ["mcp__plugin_kukulu_kukulu"] } }
```

`/kukulu:go-flight` calls `kukulu_agents_sync` before its loop, and `kukulu_agents_sync` writes this rule into the project's `.claude/settings.local.json` itself, merging it into whatever the file already holds, unless the rule is already covered there or in the committed `.claude/settings.json`. It never touches `~/.claude/settings.json`; put the rule there yourself if you want it to apply to every project instead of one. Its result's `permissions` field is `"added"`, `"present"`, or `"failed: <why>"`. A `settings.local.json` that fails to parse is reported, never overwritten. Without the rule, the first stage's first `kukulu_status` call is denied and the flight stalls silently.

## Checking on a run

From any Claude Code session in the project:

```text
> use kukulu_status
```

Or straight from a shell, without a session:

```bash
git log --oneline
cat docs/PROGRESS.md          # checkboxes and the per-task log
cat .kukulu/state.json       # round, verdict, halted
ls .kukulu/implement.lock    # present = a run is armed
```

The commit history is designed to be read on its own. Bookkeeping commits are prefixed (`chore:`, `progress:`, `review:`, `plan:`) and task commits start with their task id, so `git log --oneline` reads as a narrative of the run.

## Resuming

There is one command:

```text
> /kukulu:go-flight
```

`kukulu_next` re-reads disk and continues from wherever the flight stopped: mid-task, mid-round, or between stages. A task left `[~]` by a crashed run is handed back with `resumed: true`; a run that died before its handoff is detected by its leftover lock and sent back to the implementer to finish.

Resume after a compacted context, a closed laptop, a killed session, or a subagent that errored out. Resuming does not get a flight past a halt.

## Reopening a blocked task

A task blocks on something outside the flight's control, such as a download the sandbox could not reach or a missing credential. When that is fixed, put the task back with `kukulu_task_reopen` from any session in the project:

```text
> use kukulu_task_reopen with id P0-08 and reason "corpus file supplied at data/cantrbry.tar.gz"
```

Every task that was skipped because of it comes back too, transitively. A dependent that still waits on a different blocked task is skipped again. The next `kukulu_task_next` picks the reopened task up. If the run had already finished, the next `/kukulu:go-flight` hands out an implement stage for the same round. Inside a flight, the reviewer does the same thing through `kukulu_review_submit`'s `unblock`. Do not flip checkboxes in `docs/PROGRESS.md` by hand.

## Halts

Four things halt a flight on purpose.

**Round cap.** `kukulu_review_submit` writes a `halted` reason under either of two conditions: a review numbered above `maxRoundsHard` (default 6) requests changes, however well the rounds are going (an approving review above it ends the flight and halts nothing), or the number of *non-converging* rounds (rounds whose fix-task count did not shrink from the one before) reaches `maxRounds` (default 3). A flight whose findings go 15 → 3 → 2 → 1 never trips the soft cap, however many rounds that takes; one that goes 4 → 4 → 4 does, on the third round, because none of them improved on the last. `kukulu_status`'s `state.rounds` has the count for every round so far, and the halt message includes the trail.

```bash
# read the reviews first — docs/REVIEW.md is overwritten each round,
# but every round is in the history
git log --oneline --grep '^review:'
git show <sha>:docs/REVIEW.md
```

To continue anyway, make the call the halt message names: `kukulu_flight_options({ maxRounds: <k + 1>, resume: true })` for the soft cap, `kukulu_flight_options({ maxRoundsHard: <N>, resume: true })` for the hard one. It raises the bound in `docs/kukulu.json`, clears `halted` in `.kukulu/state.json` and commits both; it refuses if the bound would not lift the cap that fired, and it never clears any other halt. Then re-run the flight.

**Missing spec.** No `docs/SPEC.md` means there is nothing to build from. Write one; see [writing-specs.md](./writing-specs.md).

**An operator-level problem.** `kukulu_run_halt` records a reason when the implementer hits something no task-level retry fixes: a signing agent that died, a full disk, a `verify` command that cannot even run, a vanished base branch. Nothing is reset or cleaned up, so you can read the branch exactly as the run left it.

To continue once the problem is fixed, call `kukulu_run_resume({ reason: "<what you fixed>" })` (or tell `/kukulu:go-flight` `resume: <what you fixed>`). It clears the halt and commits `chore: run resumed`; it refuses while the tree is dirty or a stream worktree exists. A stream-merge halt is cleared the same way, after you merge or delete the stream's branch.

**A stream merge conflict.** When a parallel stream's branch conflicts on merge, `kukulu_stream_finish` aborts the merge, keeps the stream's branch and worktree, and halts with the conflicting paths in the reason. Kūkulu cannot guess a merge. See [Parallel streams](#parallel-streams) for the recovery.

## When something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| Controller stops immediately with `halt` | Read the `reason`: missing spec, or `halted` in state | Fix the named cause; for a halt other than a round cap, call `kukulu_run_resume`, then re-run |
| The controller session itself gets blocked from stopping | Should not happen after 0.3.0: the guard only considers a stop it can attribute to the implementer | Check that `hooks/hooks.json`'s `SubagentStop` matcher is intact and that no project override replaced it; otherwise, file a bug |
| Implementer stops with tasks open mid-task | The guard blocked and the agent still stopped, or the per-task stall cap tripped | Check `kukulu_status`'s `lockCounter` against the effective cap (`guardCap`, else `KUKULU_GUARD_CAP`, else 60); at the cap, something is wedged on one task: read its log and block it by hand |
| Every task blocks with the same error | The plan assumes something that is not there | Stop the flight. Fix `SPEC.md` and re-plan; do not let it grind through 40 blocked tasks |
| `kukulu_task_done` keeps refusing | The implementer is not committing with `<ID>:` as the subject, or is leaving files uncommitted | The commit template lives in `CLAUDE.md`; check the planner wrote one |
| `kukulu_verify` fails on a clean checkout | The commands in `docs/kukulu.json` are wrong | Fix them there. They came from `SPEC.md` §7, so fix that too |
| Run finishes but nothing was pushed | No `origin`, or the push failed | `push` in the handoff output says which; the branch is local and reviewable either way |
| No draft PR | `gh` is not installed or not authenticated | Optional by design; open one yourself |
| Reviewer approves work that is wrong | `CLAUDE.md` `## Constraints` are unverifiable | Tighten `SPEC.md` §3 so each rule is a grep, then re-plan |
| Controller prints `KUKULU: RESTART REQUIRED` and stops | The agents directory was populated for the first time in this project, and a changed role routes to a model the `Agent` tool cannot name directly | Expected, and rare after 0.3.0: only the first sync of a router-routed role hits this. Run `/kukulu:go-flight` again in a new session |
| `Agent` call fails with `Agent type 'kukulu-<role>' not found` | Same cause as above, hit mid-flight instead of at the start | Same fix: relaunch and re-run |
| Flight stops immediately with a routing config error | The global file, a profile, or `docs/kukulu.json`'s `roles`/`permissionMode` is malformed | Run `kukulu_config_show` to see what is wrong and where; fix it and re-run |
| `kukulu_run_start` refuses with a signing message | `policies.signing` is `"required"` and either signing is not configured or a real signed commit failed | Fix the signing agent, or set `policies.signing` to `"off"` in `docs/kukulu.json` |
| Flight halts with a reason naming a dead tool or agent | `kukulu_run_halt` was called | Read the reason, fix the problem, call `kukulu_run_resume({ reason })`, re-run |
| Flight halts with "non-converging" or "hard cap" in the reason | Review findings stopped shrinking for `maxRounds` rounds, or a review numbered above `maxRoundsHard` requested changes | Read `kukulu_status`'s `state.rounds` for the trail of counts; if the reviewer is still converging, raise `maxRounds`/`maxRoundsHard`; otherwise a human needs to look at why findings keep recurring |
| `kukulu_review_submit` refuses over the `Round:` line | `docs/REVIEW.md`'s `Round:` line is missing or does not equal `reviewRound` | The error names the expected value; `kukulu_status`'s `reviewRound` always has it too |
| `kukulu_next` keeps handing out the same stream | A stream's implementer stops before `kukulu_stream_finish` (the guard cap, a crash, a refused call) | Expected: `kukulu_run_start({ stream })` resumes its worktree. If it never makes progress, read that stream's task log; see [Parallel streams](#parallel-streams) to abandon it |
| A stream's tool call times out while another stream is verifying | Tool calls are handled one at a time, so it queued behind the other stream's longest command | Raise Claude Code's `MCP_TOOL_TIMEOUT` above `kukulu_status`'s `longestCommandTimeoutMs`; see [Parallel streams](#parallel-streams) |
| A wave ran serially though the plan declared streams | Its partition was invalid, its `parallel.setup` failed, or `parallel.maxStreams` is `1` | Read `kukulu_status`'s `waves[].reason` and `.kukulu/feedback.jsonl` for a `stream-partition`, `stream-setup` or `stream-exclusive` entry. That is a planning defect to fix in the next plan; the flight is not stuck |
| A verify or mutate command ran away (an infinite loop, endless output) | Before 0.4.0 this could hang the reviewer for the whole timeout, leave test processes spinning, or disconnect the MCP server | Nothing, now: the command's whole process group is killed at its timeout or at 64 MiB of output, and the result says `timedOut` or `outputLimitExceeded`. A reviewer who suspects a hanging mutant passes `timeoutMs` to `kukulu_mutate` |
| A step takes longer than the ten-minute limit on a foreground Bash call | Full benchmarks and heavy suites | Make it a `verify`/`extraVerify` command with its own `timeoutMs`, so it runs through `kukulu_verify`, and raise `MCP_TOOL_TIMEOUT` above `kukulu_status`'s `longestCommandTimeoutMs` |
| A project hook denies a `git commit` whose message only mentions a forbidden word | The hook scans the whole Bash command line, including the quoted message | The implement skill commits with `git commit -F <file>`; Kūkulu's own bookkeeping commits never pass through Bash |
| A subagent's first `kukulu_status` call is denied | The MCP allow rule is missing, or `kukulu_agents_sync` reported `permissions: "failed: ..."` | Run `kukulu_config_show` and check `permissionRule`; if a sync failed, the message names the broken `settings.local.json`. Fix its JSON and re-run |

## Clearing a wedged run by hand

All of the run's state is in files you can edit.

```bash
# stand the guard down (safe: the next run_start re-arms it)
rm -f .kukulu/implement.lock

# put a blocked task (and what it skipped) back: use kukulu_task_reopen,
# not an editor — see "Reopening a blocked task" above

# mark a task blocked yourself, if a model cannot
$EDITOR docs/PROGRESS.md      # change [~] to [!], add a log entry under ## Log
git commit -am "progress: P3-07 blocked by hand"

# abandon a round and go back to review
$EDITOR .kukulu/state.json   # implemented: true, reviewed: false
```

Do not hand-edit `docs/PROGRESS.md` casually while a run is armed: the guard counts its checkboxes, and the MCP rewrites it from its own parse. Edit it between stages, not during one.

## Running flight after flight

A repository usually runs more than one flight. Three things make the second one start cleanly.

**Name the flight.** Set `"flight"` in `docs/kukulu.json` to a slug (`^[a-z0-9][a-z0-9-]{0,39}$`), or pass `flight=<slug>` to `/kukulu:go-flight` and the planner writes it for you. The slug names the flight's archive directory.

**Archive it.** `kukulu_flight_archive` moves a summarized flight into `docs/flights/<slug>/`: `PLAN.md`, `PROGRESS.md`, `HANDOFF.md`, `REVIEW.md`, `SUMMARY.md`, `kukulu.json`, `.kukulu/state.json` and `.kukulu/feedback.jsonl`, each one that exists. It copies `docs/SPEC.md` there but leaves the live spec where it is, writes a fresh `.kukulu/state.json` recording the archive, and commits everything as `chore: archive flight <slug>`. It refuses unless the flight is summarized, no run is armed, the working tree is clean and the destination is free. If its commit fails, it puts every file back. By default the summarizer does not call it. Set `policies.archive` to `true` (a ⚠️ ASSUMPTION, default `false`, until it has been proven in real flights) and the summarizer calls it after `kukulu_summary_commit`, or call it yourself. In clean-room mode it also moves `.kukulu/cleanroom/log.jsonl` (and `similarity.json`, when present) into `docs/flights/<slug>/cleanroom/`, so the next flight's genesis starts at entry 1.

**Edit the spec.** After an archive, `kukulu_next` reports `done` ("flight `<slug>` is archived in `docs/flights/<slug>`") for as long as `docs/SPEC.md` is byte-identical to the archived copy. Edit it for the next flight and `kukulu_next` returns `plan` again.

`CLAUDE.md` outlives a flight. The planner creates it under 150 lines, but for the next flight it adds or replaces one `## Flight <slug> notes` section and leaves other flights' sections alone, merging only flight-agnostic facts into the shared sections. `/kukulu:pull-feedback` reads `docs/flights/*/feedback.jsonl` as well as the live log, so friction from archived flights is not lost. When a flight halts on a round cap, the halt message names the call that lifts it: `kukulu_flight_options({ …, resume: true })` (see [Halts](#halts)).

## Signing

`policies.signing` decides what Kūkulu does about commit signing:

- `"auto"` (the default) signs when signing works and falls back when it does not. At `kukulu_run_start` it makes a real signed object to prove the agent answers. Later, every commit Kūkulu makes runs with no terminal prompt and a 30-second bound; if one fails to sign, the commit is retried once unsigned, local `commit.gpgsign` is set to `false`, and `state.signing` (`off (commit signing failed: …)`) and `state.signingOverride: true` record it, together with one `signing` feedback entry. Only a failed signing sets `signingOverride`, never `"off"`.
- `"off"` never signs and records `off`.
- `"required"` refuses to start without working signing, and a commit that cannot be signed throws and leaves the tree as it found it (every file the tool wrote is restored, nothing stays staged), so the same call can be made again once the agent is back.

A commit that fails for a reason git does not word as signing is checked with a signed and an unsigned probe on the empty tree, so an SSH signer's own error still counts as a signing failure.

Under `"required"`, `kukulu_next` also probes the signer when it returns the `plan` stage, so a broken signer is reported before the planner works rather than when its commit fails; `/kukulu:go-flight` prints that reason and stops.

When a fallback has set `state.signingOverride`, the next `kukulu_run_start` lifts the local `commit.gpgsign false` it wrote and probes the operator's own setting again, on a fresh run and on an already-started branch (where it commits the outcome as `chore: signing re-probed`); a repo-local `false` without `signingOverride` is the operator's choice and is never touched.

At the end of a flight, `kukulu_pr_finalize` looks at the commits themselves, never at `state.signing`, to count them, but it holds the PR for signatures only when the policy expects them: `required`, or `auto` when signing was configured at run start (`state.signing` is not `none`, including after a fallback). Under `off`, or `auto` with signing never configured, it reports the counts, records no `awaitingSigning`, proceeds per `policies.finalize`, and says `signatures: "not required: …"`. `kukulu_run_start` and every stage prompt say up front which case applies (`signingNote`). Every commit since the merge base with `baseBranch` is checked with `git log --format='%H %G?'`. `N` (none) and `B` (bad) are unsigned; anything else, `E` included, counts as signed, because a machine without your public key still holds a signed commit.

- **All signed.** The draft PR is marked ready and, per `policies.finalize`, set to auto-merge. `"auto"` (the default) does both unless the flight is `breaking`; `"ready"` only marks it ready; `"draft"` leaves it alone. `policies.mergeMethod` (`"merge"`, `"squash"` or `"rebase"`) is the method passed to `gh pr merge --auto`. If auto-merge cannot be enabled the PR is left ready and the result says `unavailable: <why>`.
- **Any unsigned commit.** The PR stays a draft. `state.awaitingSigning` records the count, the oldest unsigned sha and when it began; one `signing` feedback entry is logged; an `## Awaiting signing` section is appended to `SUMMARY.md`; the commit is `chore: awaiting signing`; and `kukulu_next` reports `done` with "awaiting signing: …" until it is resolved. The steps are, verbatim from the tool's `next` text: unlock the signing agent, then tell the flight controller to finalize with re-signing, `kukulu_pr_finalize({ resign: true })`; or by hand, `git rebase -f --rebase-merges --gpg-sign <merge-base>`, then `git push --force-with-lease`, then `kukulu_pr_finalize({})`.

The controller calls `kukulu_pr_finalize({ resign: true })` only when you tell go-flight "signing is unlocked, finish it"; no agent ever passes `resign` on its own. A flight that finalizes cleanly leaves `chore: finalize flight` behind it, and re-enables the operator's own signing setting if a fallback had switched it off.

## Configuration

`docs/kukulu.json`, written by the planner, read by the MCP:

```json
{
  "verify": ["npm run typecheck", "npm run lint", "npm test -- --run"],
  "extraVerify": { "src/core/": ["npm run test:invariants"] },
  "build": ["npm run build"],
  "baseBranch": "main",
  "branchPrefix": "build/",
  "maxRounds": 3,
  "maxRoundsHard": 6,
  "commandTimeoutMs": 600000,
  "guardCap": 60,
  "policies": { "signing": "auto", "push": true, "pr": "draft", "archive": false, "finalize": "auto", "mergeMethod": "merge" },
  "flight": "w1-share",
  "mutation": { "targeted": { "unit": { "cmd": "npm test -- {filter}" } } }
}
```

| Key | Default | Effect |
|---|---|---|
| `verify` | `[]` | Commands run after every task. At least one is required. Each entry is a string, or `{ cmd, timeoutMs, exclusive, from }`: `from` names a task id (such as `P1-03`) and keeps the command inactive until that task is in progress or done; `timeoutMs` overrides `commandTimeoutMs` for that one command, and `exclusive: true` marks a command that starts a port-, container- or directory-keyed environment (wp-env, docker compose) so it only ever runs from the main checkout, never a parallel stream's worktree. |
| `extraVerify` | `{}` | Path prefix → extra commands (same entries as `verify`, including `from`), run when a task touches that prefix |
| `build` | `[]` | Recorded for the plan's use; the MCP does not run it |
| `baseBranch` | `main` | Branch runs start from, and the merge-base reported as `base` |
| `branchPrefix` | `build/` | Prefix for run branches (`build/2026-09-18`, `-2`, …) |
| `maxRounds` | `3` | Non-converging review rounds allowed before the flight halts; a round whose fix-task count did not shrink from the last one counts against this. Settable per flight with `/kukulu:go-flight max review rounds N` |
| `maxRoundsHard` | `6` | Absolute review-round ceiling, regardless of convergence: a review numbered above it that requests changes halts the flight; an approving review ends it |
| `commandTimeoutMs` | `600000` | Per-command timeout for `kukulu_verify`, `kukulu_mutate` and `parallel.setup`; a timeout kills the command's whole process group |
| `guardCap` | `60` | Re-blocks since the last task state change before the implement guard gives up; carried into `.kukulu/implement.lock` at `kukulu_run_start` and wins over `KUKULU_GUARD_CAP` |
| `policies.signing` | `"auto"` | `"off"` disables commit signing for the run; `"required"` refuses to start unless a real signed commit succeeds; `"auto"` uses signing when it works and falls back to off, recording why, when it does not; this includes any later commit whose signing fails or exceeds 30 seconds, which is retried once unsigned and recorded in `state.signing` and `state.signingOverride` (under `"required"` that commit refuses instead) |
| `policies.push` | `true` | `false` skips every push `kukulu_run_start`, `kukulu_run_finish`, `kukulu_review_submit` and `kukulu_summary_commit` would otherwise make |
| `policies.pr` | `"draft"` | `"none"` skips draft-PR creation in `kukulu_run_finish` even when `gh` is available |
| `policies.archive` | `false` | ⚠️ ASSUMPTION. `true` makes the summarizer call `kukulu_flight_archive` after the summary, moving the finished flight into `docs/flights/<flight>/` so the repository can run another. Off until it has been proven in real flights |
| `policies.finalize` | `"auto"` | What `kukulu_pr_finalize` does to a fully signed flight's draft pull request: `"auto"` marks it ready and, unless the flight is breaking, enables auto-merge; `"ready"` only marks it ready; `"draft"` leaves it alone |
| `policies.syncBase` | `true` | `kukulu_run_start` on an existing build branch and a serial `kukulu_task_next` merge the local base branch into the build branch when it has commits the branch lacks (`git merge --no-ff`, committed as `chore: merge <base> into <branch>`; nothing is fetched). A conflict aborts the merge and refuses, naming the files, and never halts; a tracked tree with uncommitted changes skips the sync and says so in `baseSynced`. `false` keeps the 0.7.0 behavior of never merging the base. Streams never sync |
| `policies.mergeMethod` | `"merge"` | The method `kukulu_pr_finalize` passes to `gh pr merge --auto`: `"merge"`, `"squash"` or `"rebase"`. Kūkulu never merges without `--auto` |
| `flight` | absent | A slug (`^[a-z0-9][a-z0-9-]{0,39}$`) naming this flight; the default `slug` for `kukulu_flight_archive` |
| `policies.feedback` | `true` | `false` disables `kukulu_feedback_log` (it returns `{ logged: false }` without writing) and every internal auto-log point |
| `parallel.maxStreams` | `3` | The most streams of one wave handed to implementers at once; `1` runs every wave serially, silently |
| `parallel.setup` | `[]` | Commands (same entries as `verify`) run once in each newly created stream worktree, before its implementer starts, such as the dependency install a fresh checkout needs (`npm ci`, `composer install`) |
| `mutation.targeted` | `{}` | Name → `{ cmd, timeoutMs }`: a test command with exactly one `{filter}` slot that `kukulu_mutate` can run instead of the whole verify set, e.g. `{ "php": { "cmd": "vendor/bin/phpunit --filter {filter}" } }`. The reviewer passes `targeted` and `filter`; the filter is limited to letters, digits and `_ . : / -` and is substituted as one single-quoted word. `timeoutMs` defaults to `commandTimeoutMs` |
| `review.mutationFixRounds` | `2` | ⚠️ ASSUMPTION. The number of fix rounds that a surviving mutant alone may open. A fix task is submitted with a `source` of `review`, `mutation` or `blocked`; once the review's round is past this value, `kukulu_review_submit` refuses a `mutation` task, and the survivor is a note in REVIEW.md instead. A positive integer |
| `cleanroom` | absent | An object that configures clean-room mode (see [cleanroom.md](./cleanroom.md)): `policy`, `signingKey`, `similarity` and `idleGapHours`. Any other key is refused. The mode is on when the policy file exists; there is no flag |
| `cleanroom.policy` | `docs/cleanroom.json` | Repo-relative path of the policy file; absolute paths, `~` and `..` are refused |
| `cleanroom.signingKey` | `~/.config/kukulu/cleanroom/ed25519.pem` | Path of the Ed25519 private key that signs checkpoints; a leading `~` is the home directory. `KUKULU_CLEANROOM_KEY` wins over it |
| `cleanroom.idleGapHours` | `3` | ⚠️ ASSUMPTION. Hours between two consecutive log entries of one stage before the span is listed as an `idle` coverage gap in an attestation bundle (`coverage.gaps`). A positive number |
| `cleanroom.similarity` | absent | The controls and test pairs a contamination score is measured against (`kukulu_similarity`). Keys: `subject` (directories being measured), `pairs` (`{ id, role, left, right }` with exactly one `negative`, exactly one `positive` and at least one `test`; `left` and `right` are directories, or `subject`), `languages` (extension to one of `rust`, `c`, `cpp`, `go`, `python`, `javascript`, `typescript`, `java`, `php`; the common extensions by default), `ngram` (`[5, 10]`), `minIdentLen` (`6`), `commentNgram` (`5`), `identExclusions` (a file of identifiers to ignore), `near` (`0.25`, a number above 0 and below 0.5) and `separationMargin` (`0`, ⚠️ ASSUMPTION: controls count as separated when the positive score exceeds the negative by more than this). Any other key is refused |
| `constraints` | `[]` | `CLAUDE.md` rules expressed as data and checked by `kukulu_verify`; see [Constraints](#constraints) below |

Environment variables:

| Variable | Default | Effect |
|---|---|---|
| `KUKULU_PROJECT_DIR` | `cwd` | Project root the server operates on; set by `.mcp.json` |
| `KUKULU_GUARD_CAP` | `60` | Re-blocks since the last task state change before the guard gives up; `docs/kukulu.json`'s `guardCap` wins over this when set |
| `KUKULU_CONFIG` | `~/.config/kukulu/config.json` (or `$XDG_CONFIG_HOME/kukulu/config.json`) | Path to the global routing config |
| `KUKULU_CLEANROOM_KEY` | `cleanroom.signingKey` | Path of the checkpoint-signing key; wins over the config key |
| `KUKULU_CLEANROOM_LOG` | `.kukulu/cleanroom/log.jsonl` | Where the clean-room hash chain is written; for tests and the guard's self-test only |
| `KUKULU_PROFILE` | the global file's own `"profile"` key, if any | Which profile in the global file to apply; wins over the file's own choice |

Flights archived before 0.6.0 keep their configuration file under its old name, and finalizing one still reads it; an archive is a record and is never rewritten.

## Calibrating

The defaults above came from timing one real flight (a 76-task plan, four review rounds, on the `sonnet`/`fable` split). Knowing where they came from helps when a plan of very different size or shape needs different numbers:

| Stage | Tasks / findings | Wall clock | Subagent tokens |
|---|---|---|---|
| plan (fable) | 76 planned | 41 min | 315k |
| implement round 0 (sonnet) | 76 | 8h 51m | 431k* |
| review round 1 (fable) | 15 findings | 20 min | 264k |
| implement round 1 (sonnet) | 15 | 2h 13m | 845k |
| review round 2 (fable) | 3 findings | 12 min | 304k |
| implement round 2 (sonnet) | 3 | 27 min | — |
| review round 3 (fable) | 2 findings | ~10 min | — |
| implement round 3 (sonnet) | 2 | 16 min | — |

\* Under-reported relative to the tool-use count: the run was resumed once mid-round after a signing-agent stall (see `policies.signing`), and the figure likely covers only the second segment.

What each default came from:

- **`guardCap: 60`.** The implementer ends its turn several times per task (after each verify, after each commit); this flight averaged roughly six re-blocks per completed task. Sixty is ten tasks' worth of blocking with no progress: well past normal noise, and low enough to catch a wedged task quickly. Counting since the last task state change, instead of over the whole run, lets one small number work for a 3-task plan and a 300-task one alike.
- **`commandTimeoutMs: 600000` (10 minutes).** The default suits ordinary typecheck/lint/unit-test commands. This flight's browser- and container-driven tasks (`wp-env`, Playwright) needed 15 minutes; give those specific commands their own `{ cmd, timeoutMs }` (see per-command timeouts, above) instead of raising the default for everything.
- **`maxRounds: 3` / `maxRoundsHard: 6`.** This flight's findings shrank every round (15 → 3 → 2), so it would never have tripped the soft cap at any reasonable `maxRounds`. The hard cap is for a flight that never converges at all; six rounds leaves room past three non-converging ones without letting a broken loop run forever.

## Constraints

A `## Constraints` line in `CLAUDE.md` is prose. A reviewer has to remember to check it by hand, three review rounds running, and can still miss a shape a hand-written grep never covered. `docs/kukulu.json`'s `constraints` array turns a mechanically checkable constraint into data, with proof that its own check works:

```json
{
  "constraints": [
    {
      "id": "no-hardcoded-tick-rate",
      "description": "The tick rate is config.TICK_RATE, never a literal.",
      "paths": ["src/"],
      "exclude": ["src/config/"],
      "pattern": "(tickRate|TICK_RATE)['\"]?\\s*(=|:|=>)\\s*[0-9]",
      "shouldMatch": ["const tickRate = 60;", "TICK_RATE: 60,", "'tickRate' => 60,"],
      "shouldNotMatch": ["const tickRate = config.TICK_RATE;"]
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique name; the fix task for a violation names it |
| `description` | no | For a human reading `docs/kukulu.json` |
| `paths` | yes | Path prefixes to scan (matches `git ls-files`'s pathspec) |
| `exclude` | no | Path prefixes to skip within `paths` |
| `pattern` | yes | A JS `RegExp` source, checked line by line, so no multi-line patterns |
| `flags` | no | `RegExp` flags, e.g. `"i"` |
| `shouldMatch` | yes, ≥ 1 | Lines the pattern must catch |
| `shouldNotMatch` | yes, ≥ 1 | Lines it must not |
| `from` | no | A task id such as `P1-03`. The rule stays inactive (reported `inactive: "until P1-03"`, no scan) while that task is todo, blocked or skipped, and applies once it is in progress or done, or once no task is open. Its fixtures are self-tested either way. Use it for a rule that only becomes true when a task has run |

`kukulu_verify` runs constraints before any shell command, always against the whole repo regardless of the `files` argument. First it self-tests every rule against its own `shouldMatch`/`shouldNotMatch` fixtures. A fixture that disagrees fails the rule outright, with `fixture` in the result naming which line, and no file is scanned for that rule. Then it scans every file under `paths` minus `exclude` that is tracked, or untracked but not ignored (`git ls-files --cached --others --exclude-standard`), and reports each hit as `{ file, line, text }`. A new file the implementer has not committed yet is scanned, so a regression cannot slip past a verify run made before its commit; a gitignored file, or one that was already untracked when the run started (`preexistingUntracked`), never is. `kukulu_run_finish` runs the same scan over the whole tree at handoff and reports it as `constraints: { ok, failing }` (and in its ready line), without refusing the handoff, so the reviewer starts from it. A malformed rule (missing `id`/`paths`/`pattern`, no fixtures, an unparseable `pattern`, a duplicate `id`) refuses the whole call, naming the offending rule.

`templates/constraints.example.json` has three worked rules, each with fixtures covering the shapes an implementer might reach for: a forbidden import, a hard-coded tunable in three different syntactic shapes, and a call forbidden outside the module that owns it. The plan-build skill requires every mechanically-checkable `CLAUDE.md` constraint to have a matching entry here; the review-build skill treats a rule that missed a real violation as a defect in the rule as well as the code, and the fix task closes the blind spot by adding the missed shape to `shouldMatch`.

## Routing

[docs/routing.md](./routing.md) covers which model runs each role and where that choice comes from. The short version for unattended use: `/kukulu:go-flight` calls `kukulu_agents_sync` before its loop. Claude Code hot-reloads a routing change to an already-populated `.claude/agents/` directory within seconds, so most edits need no restart: until the change is picked up, `kukulu_next` falls back to the plugin's own agent with the resolved model. Only a project's first sync, and only for a role routed to a model the `Agent` tool cannot name directly, prints `KUKULU: RESTART REQUIRED` and stops. A plain re-run picks up where it left off. To make a headless launcher handle that restart itself:

```bash
out=$(claude -p "/kukulu:go-flight")
printf '%s\n' "$out"
case "$out" in
  *"KUKULU: RESTART REQUIRED"*) claude -p "/kukulu:go-flight" ;;
esac
```

`kukulu_config_show` prints the merged config and the source of every value; run it whenever the resolved model for a role is not what you expected.

## Parallel streams

A plan may split independent tasks into streams that run on separate implementers at the same time, each in its own git worktree, and merge back as they finish; [architecture.md](./architecture.md#parallel-workstreams) explains how and why. This section covers what the operator has to handle.

**Config** (`docs/kukulu.json`; see [Configuration](#configuration)). `parallel.maxStreams` caps how many streams of one wave run at once (default 3; `1` turns parallelism off, silently). `parallel.setup` lists commands run once in each new worktree before its implementer starts. A fresh checkout has none of the installed dependencies `verify` needs, so this is where `npm ci` or `composer install` goes. A command entry marked `"exclusive": true` starts something keyed to the directory or a port it runs from (wp-env, docker compose, a dev server) and only ever runs from the main checkout; any task that triggers one is kept out of waves, and an exclusive command in `verify` itself makes every wave serial.

**The tool-call timeout.** The server handles one tool call at a time, so while one stream's `kukulu_verify` runs a long suite, a sibling stream's `kukulu_task_done` waits behind it, for up to that suite's timeout. Claude Code's MCP tool-call timeout (the `MCP_TOOL_TIMEOUT` environment variable) must therefore exceed the longest command timeout plus headroom, or the waiting call fails on the client side. `kukulu_status` reports `longestCommandTimeoutMs` (across `verify`, `extraVerify` and `parallel.setup`) to compare against. Verification is serialized on purpose: suites often share ports, containers or databases, and most of a stream's wall clock is model time, not test time.

**A wave that ran serially.** This is not a fault. An invalid partition, a failed `parallel.setup`, or an exclusive command each degrade the wave to serial and log one feedback entry (`stream-partition`, `stream-setup` or `stream-exclusive`) in `.kukulu/feedback.jsonl`. Pull it back with `/kukulu:pull-feedback`: it is material for the next plan.

**A stream that stopped early.** The next `kukulu_next` hands it out again; `kukulu_run_start({ stream })` resumes its worktree and `kukulu_task_next` resumes its in-progress task. Look at what is in flight with:

```bash
git worktree list
ls .kukulu/worktrees/
# per-wave, per-stream open counts:
#   kukulu_status -> waves
```

**Recovering from a `stream-merge` halt.** The halt reason names the stream, its branch and the conflicting paths. From the main checkout, on the build branch:

```bash
git merge --no-ff <build-branch>--<stream>     # resolve the conflicts, then commit
git worktree remove --force .kukulu/worktrees/<stream>
git branch -d <build-branch>--<stream>
# then call kukulu_run_resume({ reason: "merged stream <stream> by hand" }), which commits chore: run resumed
```

Then re-run the flight; the stream's tasks are already done, so it goes on to the next wave or the handoff.

**Abandoning a stream** you cannot recover: block its open tasks by hand (see [Clearing a wedged run](#clearing-a-wedged-run-by-hand)), then `git worktree remove --force .kukulu/worktrees/<stream>` and `git branch -D <build-branch>--<stream>`. Nothing is lost that was not already committed to the stream branch, which you can still inspect until you delete it.

## What the flight leaves behind

A `build/<date>` branch containing:

- one commit per task, titled `<ID>: <title>`
- interleaved `progress:` commits recording each state change with its sha
- for a plan with parallel streams, one `merge stream <s> (wave <n>)` commit per stream, and `chore: wave <n> runs serially` for any wave that could not run in parallel
- `review: round N` commits, one per round, each carrying that round's `REVIEW.md` and the fix tasks it queued
- `docs/HANDOFF.md`, `docs/REVIEW.md` and `docs/SUMMARY.md` at the tip
- a draft PR, if `gh` was available and `policies.pr` is not `"none"`
- `chore: finalize flight` or `chore: awaiting signing`, from `kukulu_pr_finalize`, and `chore: archive flight <slug>` when the flight was archived

When there is an `origin`, every one of those commits is pushed as it lands: `kukulu_run_finish`, `kukulu_review_submit` and `kukulu_summary_commit` all push (unless `policies.push` is `false`). `kukulu_run_start` also pushes the base branch itself before the first build branch is cut, so the base branch on the remote carries the planner's commits too and a PR's diff is the build, not the plan.

Read `SUMMARY.md` first. It is written for someone who was not there: what was built, what was decided and by whom, which assumptions are still guesses, which spec issues need your edit, and what you still have to check by hand.

Then look at the pull request. Kūkulu never merges synchronously: it never runs `gh pr merge` without `--auto`. At most, `kukulu_pr_finalize` asks GitHub to merge a signed, non-breaking flight's PR once CI is green (`policies.finalize: "auto"`); GitHub does the merge, not Kūkulu. A breaking flight, or one with an unsigned commit, is yours to merge.
