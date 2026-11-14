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

In general mode, every role agent's usage record is appended as one line to `.kukulu/metrics/usage.jsonl` when the agent stops. The directory is excluded per clone (in `.git/info/exclude`) and never committed, and it is emptied when the next flight's first stage starts. The hook is silent without `docs/kukulu.json` and inside the sandbox. Clean-room mode writes the chain's `usage` entry only, and never `usage.jsonl`.

## The controller's record

The logger also runs on `Stop`. A `Stop` record has `role: "controller"` and `agent: null`, and counts the session's own transcript with every sidechain row dropped, so it never holds a subagent's requests. Each `Stop` appends the cumulative record, and a reader keeps the last one per session. In clean-room mode the record goes into the chain as a `usage` entry with entry role `session`, which the per-role recount does not count.

## Known limits

- Requests the controller makes after its last `Stop` are not counted.
- A controller record covers its whole session, including anything the session did before the flight.
- Tokens of other subagents a stage spawns are not counted.

## Counters

`.kukulu/metrics/counters.json` is one JSON line of counters the server keeps beside the usage records. It is excluded per clone like the rest of the directory and emptied with it, and `kukulu_status` reports it as `counters` (`null` before anything is counted).

| Counter | Counts |
|---|---|
| `verifyRuns` | `kukulu_verify` calls that ran their commands |
| `verifyFailures` | those whose command results included a failure (a skipped command or a failing constraint alone is not one) |
| `guardReblocks` | `null` until the implement guard counts its re-blocks |
| `tasksReopened` | `kukulu_task_reopen` calls |
| `activateFailures` | times a runner failed to serve its model and the flight halted |

A counters file that cannot be written is a `countersNote` on the tool's result and never changes the result's `ok`, a refusal or a commit.
