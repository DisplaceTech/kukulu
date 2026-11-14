# Usage metrics

This page covers the usage record: what one agent's use of models looks like once a harness adapter has read its transcript. The record has one schema and one adapter per harness; Claude Code's adapter is the only one shipped.

## The usage record

```json
{
  "v": 1,
  "harness": "claude-code",
  "session": "<session id>",
  "agent": "kukulu-implementer",
  "role": "implementer",
  "stage": "implement",
  "round": 1,
  "models": { "<model the endpoint reported>": { "requests": 41, "input": 812345, "output": 20991, "cacheRead": 700112, "cacheWrite": 9120 } },
  "first": "2026-11-14T03:11:15.916Z",
  "last": "2026-11-14T04:02:40.101Z",
  "activeMs": 1432876,
  "toolCalls": 388,
  "toolErrors": 7,
  "apiErrors": 0,
  "cost": 4.812345
}
```

| Field | Type | Meaning | `null` when |
|---|---|---|---|
| `v` | integer | Schema version, always 1 | never |
| `harness` | string | The harness that produced the transcript | never |
| `session` | string | The harness's session id | the hook input has none |
| `agent` | string | The agent type | the record is the controller's |
| `role` | string | `planner`, `implementer`, `reviewer`, `summarizer` or `controller` | never |
| `stage` | string | The pipeline stage at the time of the hook | no state is on disk |
| `round` | integer | The review round at the time of the hook | no state is on disk |
| `models` | object | Per model the endpoint reported: `requests`, `input`, `output`, `cacheRead`, `cacheWrite` | never (may be empty) |
| `first`, `last` | string | Timestamps of the first and last counted request | no request was counted |
| `activeMs` | integer | Time spent waiting on a model, excluding tool execution | the transcript has no timestamps |
| `toolCalls` | integer | Tool uses | the format cannot say |
| `toolErrors` | integer | Tool results flagged as errors | the format cannot say |
| `apiErrors` | integer | Rows the transcript flags as API errors | the format has no such flag |
| `cost` | number | Sum of the reported cost, in dollars | any counted row lacks one |

A transcript that cannot be read yields an error record with only `v`, `harness`, `session`, `agent`, `role` and `error`. `validateUsageRecord` in `mcp/metrics.mjs` checks both shapes.

## How Claude Code's adapter counts

An `assistant` row with `message.usage` is a request, and each `requestId` counts once, by its first row. The row's `message.model` names the `models` entry (`unknown` when absent), and its token counts add to that entry. A row the transcript flags as an API error is counted in `apiErrors` and, when it carries usage, as a request under its own model name.

`activeMs` is the time spent waiting on a model. The conversation rows are the `user` and `assistant` rows that have a timestamp, in file order. For each counted request, the time is the timestamp of the request's last conversation row minus the timestamp of the conversation row just before its first row. That includes prefill, decode and the network, and excludes tool execution. A request with no conversation row before it adds nothing, and `activeMs` is `null` when no request was timed.

`toolCalls` counts `tool_use` items, `toolErrors` counts `tool_result` items with `is_error` true, and `cost` is the sum of the counted rows' reported cost when every counted row has one. `stage` and `round` come from `.kukulu/state.json` at the time of the hook.

## Where usage is recorded

In general mode, every role agent's usage record is appended as one line to `.kukulu/metrics/usage.jsonl` when the agent stops. The directory is excluded per clone (in `.git/info/exclude`) and never committed, and it is emptied when the next flight's first stage starts. The hook is silent without `docs/kukulu.json` and inside the sandbox.

Clean-room mode writes the chain's `usage` entry only, and never `usage.jsonl`. `kukulu_metrics` reads the two modes from different places: a general-mode flight from `usage.jsonl`, and a clean-room flight only from the signed chain (`usage.source` is `chain`), even when a `usage.jsonl` is present. `usage.chainHead` is the hash of the chain's last entry, so anyone holding the attestation bundle can recompute the per-role sums from its log and check them against the metrics. After an archive the chain is read from the archived flight's `cleanroom/log.jsonl`.

## The controller's record

The logger also runs on `Stop`. A `Stop` record has `role: "controller"` and `agent: null`, and counts the session's own transcript with every sidechain row dropped, so it never holds a subagent's requests. Each `Stop` appends the cumulative record, and a reader keeps the last one per session. In clean-room mode the record goes into the chain as a `usage` entry with entry role `session`, which the per-role recount does not count.

## Known limits

- Requests the controller makes after its last `Stop` are not counted.
- A controller record covers its whole session, including anything the session did before the flight.
- Tokens of other subagents a stage spawns are not counted.
- `outputPerActiveSecond` is output over the time spent waiting on a model, which includes prefill and the network; it is not decode speed.
- Clean-room sums count a re-blocked agent's earlier stops again, as check 12 does, while general mode keeps the last record per transcript.
- `cost` is `null` for local runners and for the controller.
- With `activate: "none"` a model load hides inside a stage's first request and inflates `activeMs`.

## Counters

`.kukulu/metrics/counters.json` is one JSON line of counters the server keeps beside the usage records. It is excluded per clone like the rest of the directory and emptied with it, and `kukulu_status` reports it as `counters` (`null` before anything is counted).

| Counter | Counts |
|---|---|
| `verifyRuns` | `kukulu_verify` calls that ran their commands |
| `verifyFailures` | those whose command results included a failure (a skipped command or a failing constraint alone is not one) |
| `guardReblocks` | The implement guard's cumulative re-blocks: the lock's `total`, added when a run finishes or halts. `null` for a flight whose runs never reported one (a legacy bare-number lock has no `total`) |
| `tasksReopened` | `kukulu_task_reopen` calls |
| `activateFailures` | times a runner failed to serve its model and the flight halted |

A counters file that cannot be written is a `countersNote` on the tool's result and never changes the result's `ok`, a refusal or a commit.

## Where the harness list comes from

`state.harness` is filled from the `clientInfo` the harness sends in the MCP `initialize` request (its `name` and `version`), added by `kukulu_run_start` and by `kukulu_next`'s timeline write. A client that sends none is recorded as `unknown`. The list is never used in a condition.

## METRICS.json

`buildMetrics` in `mcp/metrics.mjs` turns plain data into one object. It reads no file and no clock, and a missing input is a `null` field, never a zero: a role with no usage record has `usage: null` and `null` token fields, and `totals` sums only the roles that have records. It holds counts, timestamps and content hashes, never a commit hash. The table gives every field by its dotted path (`<role>`, `<stage>`, `<runner>` and `<category>` stand for the keys of a map) and where it comes from.

Counted usage records are the valid, non-error ones. The controller keeps only the last record of each session. In general mode (`usage.jsonl`) a later record with the same `session`, `agent` and `first` supersedes an earlier one; from the chain every role record is summed, as the verifier's role recount does.

| Field | Derived from |
|---|---|
| `v` | `METRICS_VERSION` |
| `plugin`, `flight` | the plugin's `package.json` version; `flight` in `docs/kukulu.json` |
| `spec.title`, `spec.sha256` | the first heading of `docs/SPEC.md` and the SHA-256 of that file |
| `harness[].name`, `harness[].version` | `state.harness`, else `[{ name: "unknown", version: null }]` |
| `usage.source`, `usage.records`, `usage.chainHead` | where the usage records were read from (`chain` or `usage.jsonl`), how many were summed after the rules below, and the chain's head hash; `null` without usage input |
| `mode`, `enforcement` | the genesis entry's `mode` (default `clean-room`) and `enforcement` (default `hook` for a genesis written before 0.8.0); `general` and `null` without a genesis |
| `outcome.verdict`, `outcome.halted` | `state.verdict`, `state.halted` |
| `outcome.reviews` | the length of `state.rounds` |
| `outcome.fixRounds` | `state.round` |
| `outcome.approvedAtRound` | the `round` of the first entry of `state.rounds` whose verdict is `APPROVED`, else `null` |
| `outcome.caps.maxRounds`, `outcome.caps.maxRoundsHard` | `maxRounds` and `maxRoundsHard` of `docs/kukulu.json` |
| `wall.startedAt`, `wall.endedAt` | the first and the last record of `state.timeline` (`endedAt` is the time of the call while a span is open) |
| `wall.seconds` | `wall.endedAt` minus `wall.startedAt`, in whole seconds |
| `wall.stageSeconds.<stage>` | the timeline's spans (a `start` closed by the next `end`) summed per stage; an `activate` record is not a span |
| `wall.activateSeconds.<runner>` | the `ms` of the timeline's successful `activate` records, summed per runner, in whole seconds |
| `wall.idleSeconds` | `wall.seconds` minus the stage seconds and the activate seconds |
| `rounds[].round`, `rounds[].findings`, `rounds[].sources`, `rounds[].verdict`, `rounds[].nonConverging` | the matching entry of `state.rounds` (`findings` is its `fixTasks`, `sources` its object of finding sources) |
| `rounds[].implementSeconds`, `rounds[].reviewSeconds` | the `implement` and `review` spans of the timeline round before it (review round N reviews the build of round N - 1); `null` when there is none |
| `roles.<role>.model`, `roles.<role>.runner`, `roles.<role>.locality`, `roles.<role>.family` | the resolved routing of the role (`null` for the controller and without routing) |
| `roles.<role>.usage` | `null` for a role with no usage record (the role is also in `totals.missing`), and absent from an entry that has records |
| `roles.<role>.reported` | the sorted model names the role's records show the endpoint reported |
| `roles.<role>.requests`, `roles.<role>.input`, `roles.<role>.output`, `roles.<role>.cacheRead`, `roles.<role>.cacheWrite` | the sums of the role's records' `models` |
| `roles.<role>.activeSeconds` | the sum of the records' non-null `activeMs`, in whole seconds |
| `roles.<role>.outputPerActiveSecond` | `output` over the active seconds, rounded to one decimal; `null` without active time |
| `roles.<role>.toolCalls`, `roles.<role>.toolErrors`, `roles.<role>.apiErrors` | sums of the records' non-null values; `null` when every record's is `null` |
| `roles.<role>.cost` | the sum of the records' `cost`, rounded to six decimals, for a role on the `anthropic` runner when every record has one; `null` otherwise |
| `totals.requests`, `totals.input`, `totals.output` | sums over the roles that have records; `null` when none has |
| `totals.missing` | the roles with no usage record, in the order planner, implementer, reviewer, summarizer, controller |
| `tasks.total`, `tasks.done`, `tasks.blocked`, `tasks.skipped` | the task counts of `docs/PROGRESS.md` |
| `tasks.reopened` | the `tasksReopened` counter |
| `friction.feedback.<category>` | the entries of `.kukulu/feedback.jsonl` counted by `category`, always with `restart` and `runner-drift` |
| `friction.guardReblocks`, `friction.verifyRuns`, `friction.verifyFailures`, `friction.activateFailures` | the counters of `.kukulu/metrics/counters.json`; `null` without the file |
| `tree.commits` | the number of commits since the merge base |
| `tree.filesChanged`, `tree.insertions`, `tree.deletions` | the `git diff --shortstat` line against the merge base (an omitted part is 0); all four `tree` fields are `null` without a merge base |

## Reading the metrics

`kukulu_metrics` returns the object described above, computed at the moment of the call from what is on disk; it writes nothing. After `kukulu_flight_archive` it reads the archived flight (its state, configuration, feedback, task counts and spec) until the next flight's first stage starts, and the live `.kukulu/metrics/` for the usage records.

## When METRICS.json is written

`kukulu_next` writes `docs/METRICS.json` when it returns `done` or `halt`, that call wrote at least one record to the timeline (the open stage's `end`), and `policies.metrics` is true (the default). It is built after the state is saved, so it includes those records, and it joins the `chore: stage end` commit. A `done` that writes no record, such as the one after an archive, writes no file. A resumed flight overwrites the file at its next end or halt. A file that cannot be written is a `metricsNote` on the result and a `metrics` feedback entry; the decision and the timeline are unaffected. `kukulu_flight_archive` moves the file into the flight's directory.
