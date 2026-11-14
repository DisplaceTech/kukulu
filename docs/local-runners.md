# Running a flight on local models

This page is for an operator who wants a whole flight to run on models served from one inference host, with no model call leaving the network. Kūkulu starts, stops and swaps nothing: it routes each role to a model string, asks the runner to be ready and records how long that took. Everything on the inference host, the proxy included, is yours to set up. Anthropic [does not support routing Claude Code to non-Claude models through any gateway](https://code.claude.com/docs/en/llm-gateway), so a local flight is your own setup, and what is written here about other software was read from the pages cited on the dates given.

## Direct mode

Direct mode has no router on the workstation: the harness talks to the runner's proxy itself. Launch Claude Code with these variables.

- `ANTHROPIC_BASE_URL` overrides the API endpoint to route requests through a proxy or gateway ([env-vars](https://code.claude.com/docs/en/env-vars)). Point it at the runner.
- `ANTHROPIC_AUTH_TOKEN` is the value of the `Authorization` header, sent with a `Bearer` prefix ([env-vars](https://code.claude.com/docs/en/env-vars)). Use it when the proxy checks a bearer token.
- `ANTHROPIC_API_KEY` is sent as the `X-Api-Key` header ([env-vars](https://code.claude.com/docs/en/env-vars)). Use it when the proxy checks that header instead.
- `ANTHROPIC_MODEL` is the model setting to use ([model-config](https://code.claude.com/docs/en/model-config)). Set it to the model the controller session runs on; see [The controller rule](#the-controller-rule).
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` is the model id the `haiku` alias resolves to, and is also used for background functionality ([env-vars](https://code.claude.com/docs/en/env-vars)). `ANTHROPIC_DEFAULT_SONNET_MODEL` and `ANTHROPIC_DEFAULT_OPUS_MODEL` are the ids the other two aliases resolve to ([env-vars](https://code.claude.com/docs/en/env-vars)).
- `ANTHROPIC_SMALL_FAST_MODEL` is deprecated in favor of the haiku variable ([env-vars](https://code.claude.com/docs/en/env-vars)).
- `CLAUDE_CODE_SUBAGENT_MODEL` is the default model for subagents not assigned one another way, and an agent definition's own `model` wins over it ([env-vars](https://code.claude.com/docs/en/env-vars)). Kūkulu writes each role's model into the generated agent file, so the routing config decides the stage models, not this variable.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, set to any non-empty value, disables auto-updates, telemetry and error reporting ([env-vars](https://code.claude.com/docs/en/env-vars)). Set it for a flight that must not call out.

Then route the roles to model strings the runner's proxy accepts. `templates/kukulu.config.example.json` has a `spark` runner (the host, `locality: "local"`, `activate: "warm"`, the prefix `spark/`) and a `spark` profile that routes all four roles to it. Copy the file to `~/.config/kukulu/config.json`, set the runner's endpoint to your host, and start the session with the profile:

```bash
export ANTHROPIC_BASE_URL=http://spark.example:8000
export ANTHROPIC_AUTH_TOKEN=...
KUKULU_PROFILE=spark claude
```

A role's model string is `spark/qwen38-27b`; the runner is asked for `qwen38-27b`, the string without its prefix, unless `servedAs` names another id (see [routing.md](./routing.md#runners)). `kukulu_config_show` prints the served id of every role, and `node scripts/runner-probe.mjs --endpoint <url> --models` lists what the runner serves.

## Resident and swapping layouts

Two models that fit on the host together can both stay resident, and then there is nothing to swap. Two that cannot be resident together need a model-swapping proxy on the inference host, so that a request for the other model unloads this one first. llama-swap is one: it serves the Anthropic endpoint `v1/messages`, lists models at `v1/models`, and a group's `swap`, `exclusive` and `persistent` fields decide what stays loaded ([llama-swap](https://github.com/mostlygeek/llama-swap), release v272). `templates/runners/llama-swap.example.yaml` is a commented example with a resident group and a swapping group for the `spark` profile's two stage models, and it says which release it was checked against.

## The controller rule

With a swapping layout there is one thing to watch. The probe makes the proxy load the stage's model. The controller's next request goes to the controller's own model. If that is a different model in the same swapping group, the proxy swaps back, and every stage pays for two loads.

Keep the controller and the harness's small-model calls on a model that stays resident: put it in a persistent group, then set the session's model (`ANTHROPIC_MODEL`) and the haiku variable (`ANTHROPIC_DEFAULT_HAIKU_MODEL`) to it, which also covers the background calls ([env-vars](https://code.claude.com/docs/en/env-vars)). The template's `resident-small` model is that model.

## Timeouts

Three limits must all be longer than the slowest load.

- `API_TIMEOUT_MS` is how long each API request attempt has to receive its response headers; the default is 600000 ms, 10 minutes ([env-vars](https://code.claude.com/docs/en/env-vars)). A request that waits behind a cold load needs more.
- `MCP_TOOL_TIMEOUT` and the per-server `timeout` of `.mcp.json` bound a tool call ([env-vars](https://code.claude.com/docs/en/env-vars)). The plugin sets its own, 24 hours, so `kukulu_next`, which waits for the warm-up, is not cut off.
- `activateTimeoutMs`, on the runner, bounds the warm-up request. It must be below the plugin's tool-call limit, and Kūkulu refuses a config where it is not.

The proxy's own readiness timeout (llama-swap's `healthCheckTimeout`, the seconds to wait for a model to be ready) must exceed the load too, or the proxy gives up before the model answers.

## What activation measures

With `activate: "warm"`, `kukulu_next` sends one one-token request before the stage and waits for the answer. The wait is recorded in the timeline, in the result's `activation`, in `kukulu_status`'s `activateSeconds` and in `METRICS.json`'s `wall.activateSeconds`, and `go-flight` prints `runner <name>: <served> ready in <seconds> s`. With `activate: "none"` the load hides inside the first request of the stage, and that request's time inflates the role's `activeMs`.

One limit this cannot remove: the warm-up proves the runner answered the request it was sent, not that no other model was loaded between that answer and the stage's first request. In a clean-room flight the chain records both the id asked for and the id the runner reported.

## A smoke test before a flight

Before a long flight, check the chain end to end.

1. `node scripts/runner-probe.mjs --endpoint <url> --models` lists the models the runner serves. Then `--warm <served id>` loads one and prints how long it took.
2. Start a session on the profile and run a small task that makes a tool loop, so you know the model can call tools.
3. Call one Kūkulu tool, such as `kukulu_config_show`, to see that the MCP server answers and the routing table shows the served ids.
4. During a stage, look at the proxy's log for the model ids the harness asks for. Anything other than the stage's model and the resident one is a variable above that is still unset.
