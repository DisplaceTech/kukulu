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
