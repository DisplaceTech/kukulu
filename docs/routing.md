# Model routing

The plugin does not fix which model and effort level run each of Kūkulu's four stages (`planner`, `implementer`, `reviewer`, `summarizer`). They are resolved per role and per key from four layers, and turned into project-level agent files that Claude Code spawns.

## How routing works

Precedence, highest first:

1. `docs/kukulu.json` → `"roles": { ... }` and `"permissionMode"` (project override, committed with the rest of the plan).
2. A named profile inside the global file, selected by `KUKULU_PROFILE` or, when that environment variable is unset, by the global file's own top-level `"profile"` key.
3. The global file itself: `$KUKULU_CONFIG` if set, else `$XDG_CONFIG_HOME/kukulu/config.json`, else `~/.config/kukulu/config.json`.
4. The plugin's own defaults, in `agents/*.md`.

A profile or a project override is a *partial* overlay: it can set a role's `model` without touching its `effort`, or vice versa. The merge happens per role and per key, and `kukulu_config_show` reports, for every field, which of the four layers it came from (`default`, `global`, `profile:<name>`, or `project`).

Calling `kukulu_agents_sync` (which `/kukulu:go-flight` does automatically, before its loop) turns the merged result into `.claude/agents/kukulu-<role>.md`, one project-level Claude Code subagent file per role. Whenever that generated agent exists, `kukulu_next` names it instead of the plugin's own `kukulu:<role>` agent. Project-level agents accept any `model:` string, including a router-specific `provider,model` or `provider/model` form. They also accept `permissionMode`, which every generated file sets (default `acceptEdits`), so once agents have been generated at least once you no longer need to launch a session with `--permission-mode acceptEdits` for the implementer's file edits. That does not cover MCP tool calls. Tested directly, a generated agent's `kukulu_status` call is denied under both `acceptEdits` and `bypassPermissions` unless the session carries an allow rule, and the rule that works (and reaches subagents) is the scoped server name `mcp__plugin_kukulu_kukulu` in `permissions.allow`. `kukulu_agents_sync` writes it for you; see [operations.md](./operations.md#running-a-flight). Plugin-shipped agents can do neither of these things. [Claude Code's plugin reference](https://code.claude.com/docs/en/plugins-reference) states that "plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields", which is why routing generates files instead of editing `agents/*.md` in place.

`effort` is only meaningful for an Anthropic model: a known alias (`fable`, `opus`, `sonnet`, `haiku`, `inherit`) or a full `claude-*` id. [Claude Code's subagent reference](https://code.claude.com/docs/en/sub-agents) documents `model` as accepting exactly those forms, "or `inherit`", with no mention of `effort` applying to anything else. When a role resolves to any other model string, Kūkulu drops its `effort` silently from the generated file and reports the drop in `effortDropped`, instead of emitting a key the far end would not understand.

Routing has one limit inside a single session. Claude Code hot-reloads a project-level agent file from `.claude/agents/` within seconds of it changing, with one documented exception: the first agent file created in a new `.claude/agents/` directory is not picked up until the session restarts. A routing edit to an already-populated directory is picked up live. Through 0.2.0 this plugin relied on the stricter, conservative assumption; the actual behaviour was confirmed for 0.3.0.

So the only case `kukulu_agents_sync` cannot make usable immediately is a project's very first sync, and then only when the routed model is not one the `Agent` tool can name. For a model it can name (a family alias, or a `claude-<family>-…` id that maps to one), `kukulu_next` falls back to the plugin's own `kukulu:<role>` agent with the resolved model until this session's next launch, and the flight proceeds without stopping. `kukulu_next` reports this per stage as `agentFallback` and `fallbackAgent`. `kukulu_agents_sync` and `kukulu_next` both report the one case that needs a restart as `restartRequired`. `/kukulu:go-flight` checks it before the loop and, when true, prints the table and this line, then stops:

```text
KUKULU: RESTART REQUIRED — agent definitions were (re)generated; start a new session and run /kukulu:go-flight again.
```

In practice this costs at most one extra launch per project: the first time, and only for a role routed off-platform before that first sync. It never happens again, and never mid-flight. See [docs/operations.md](./operations.md#routing) for a two-line headless wrapper that handles the restart itself.

While `agentFallback` is in effect, the controller spawns the plugin's own `kukulu:<role>` agent with `agentModel` passed as the `Agent` tool's `model` argument. The tool takes only the aliases `sonnet`, `opus`, `haiku` and `fable`, so a role routed to a full id such as `claude-opus-5-5` is handed `opus`, the latest of that family, which may not be the pinned version. `kukulu_next` reports that as `agentModelExact: false`, and the controller prints a one-line note. Full ids are fine in routing config and are exact once the generated agent loads; only this first-population fallback is approximated. `effort` is lost on the fallback path too, because it lives only in the generated agent's own frontmatter and the `Agent` tool has no `effort` parameter to carry it. This costs at most one stage's worth of effort, since the generated file is usable from the next session.

A `claude-*` id of a family Kūkulu does not know is treated like a non-Anthropic model: no fallback, so a restart.

The generated files are excluded from git per clone, through `.git/info/exclude` rather than `.gitignore`. They encode one person's routing, not the project's, and excluding them this way needs no commit on the base branch before a run can start.

## The global file

`templates/kukulu.config.example.json` is the shape:

```json
{
  "roles": {
    "planner":     { "model": "opus",    "effort": "high" },
    "implementer": { "model": "sonnet", "effort": "medium" },
    "reviewer":    { "model": "opus",    "effort": "high" },
    "summarizer":  { "model": "opus",    "effort": "medium" }
  },
  "profiles": {
    "local": {
      "implementer": { "model": "Ollama/qwen3.6:35b-a3b" },
      "reviewer":    { "model": "OpenRouter/deepseek/deepseek-v4-pro" }
    },
    "cheap": {
      "implementer": { "model": "haiku", "effort": "medium" },
      "summarizer":  { "model": "haiku", "effort": "low" }
    }
  },
  "permissionMode": "acceptEdits"
}
```

Copy it to `~/.config/kukulu/config.json` (or point `$KUKULU_CONFIG` somewhere else) and edit it there. It applies to every project on the machine unless a project's own `docs/kukulu.json` overrides a role.

`"Ollama"` and `"OpenRouter"` above are the provider names you give claude-code-router when you add each provider (see below); Kūkulu attaches no meaning to them. The model string is whatever that router expects for "this provider, this model", and Kūkulu copies it into `model:` verbatim without parsing it.

To pick a profile without setting an environment variable (the common case on a machine that always uses the same router setup), add `"profile": "local"` to the global file itself. `KUKULU_PROFILE`, when set, always wins over the file's own choice.

A project can still override any role for itself, in `docs/kukulu.json`:

```json
{
  "verify": ["npm test"],
  "roles": { "reviewer": { "model": "haiku" } }
}
```

Only the keys you name change; everything else keeps coming from the profile or the defaults. Run `kukulu_config_show` in any Kūkulu-enabled session to see the resolved table and where each value came from.

## Routing through claude-code-router (v3)

The model string Kūkulu writes reaches Claude Code unchanged, and Claude Code sends it to whatever `ANTHROPIC_BASE_URL` the session is running under. A `provider/model` string therefore only means something when the session is launched through a router that understands that syntax; plain Claude Code cannot do anything with `Ollama/qwen3.6:35b-a3b`. [claude-code-router](https://github.com/musistudio/claude-code-router) (CCR) is one such router. This section covers its current release line (v3.x, latest v3.1.1 as of this writing). All facts below are cited to CCR's own docs at [ccrdesk.top](https://ccrdesk.top/); read them yourself before relying on any of this in an unattended flight.

1. **Install and start it.**

   ```bash
   npm install -g @musistudio/claude-code-router
   ccr ui
   ```

   `ccr ui` "[reuses or starts the background service and opens a browser](https://ccrdesk.top/en/guides/cli/)" at its management UI. The model gateway itself listens on `127.0.0.1:3456`.

2. **Add your providers.** Under *Providers → Add Provider*, each provider has a *Name* ("also used by routing, model selectors, logs, and config references"), an *API endpoint*, an *API key*, and *Models* ("Model IDs exposed by CCR") ([source](https://ccrdesk.top/en/configuration/providers/)). For Ollama and OpenRouter, pick a built-in preset if the UI offers one for your endpoint, or fill in `templates/ccr/ollama.provider.json` / `templates/ccr/openrouter.provider.json` by hand; both use the `anthropic_messages` protocol, one of the four protocols CCR documents. You can also import either file directly once it is hosted somewhere CCR can fetch over HTTPS, via `ccr://provider?manifest=<url-encoded-https-url>`. CCR "fetches the manifest inside the app, shows a confirmation dialog, and writes config only after user approval" ([source](https://ccrdesk.top/en/provider-import/)). Manifests must be HTTPS, JSON, under 128 KB, and must not point at a local or private host, so a `localhost` Ollama manifest may need the UI form instead of the deeplink.

   For any role that should keep running on your Anthropic subscription through the router (rather than bypassing the router for that stage; see below), use *Providers → Import local agent login → Claude Code*, which "reads local Claude Code OAuth credentials. When a usable access token is available, CCR can import it as a `Claude Code API` provider" using the `anthropic_messages` protocol ([source](https://ccrdesk.top/en/configuration/providers/)). This reuses your own Claude Code sign-in through a third-party local proxy; that is a choice about your own credentials, and Kūkulu takes no position on it.

3. **Create a Claude Code Agent Config profile.** Under *Agent Config → Claude Code*, add a profile (call it `kukulu`). Set **Effect scope** to *"Only opened from CCR"*. CCR documents the alternative, *"System default"*, as making the profile "the system-default Claude Code profile," which is the opposite of what you want here: only Kūkulu sessions should go through the router ([source](https://ccrdesk.top/en/configuration/agents/claude-code/)). Leave the profile's own **Model** field and its per-tier **Fable / Opus / Sonnet / Haiku** overrides empty. Those are a second routing layer CCR offers, and Kūkulu does not need it, because Kūkulu's own routing config already picks each role's model.

4. **Launch through the profile.**

   ```bash
   ccr kukulu
   ```

   which "[launches an enabled Agent Config profile](https://ccrdesk.top/en/guides/cli/)". A plain `claude` launch, outside `ccr`, is not affected.

5. **Verify before trusting a long flight.** CCR's *Logs and observability* page shows which provider actually served each request. Check it after the planner's first call, not after the whole flight.

On what happens to a plain Anthropic model name (`fable`, `sonnet`, `claude-fable-5-1`, …) sent through the router, CCR's own routing docs say:

> "The built-in Claude Code route detects requests from Claude Code and routes main requests to the Claude Code Agent Config model when the client has not selected a recognized model."
>
> "Claude Code main requests prefer an explicit client-selected model that CCR recognizes."
>
> "The Agent Config model is only the default when the client model is missing or unrecognized; if it is unset, the built-in route remains inactive."
>
> — [ccrdesk.top/en/routing](https://ccrdesk.top/en/routing/)

As of this writing, those three sentences are all CCR's documentation says on the subject, and none of them defines what "recognized" means for a bare alias like `fable` or a bare id like `claude-fable-5-1`. An explicit `provider/model` string, by contrast, is unambiguous. Do not assume a bare Anthropic name will reach Anthropic through the router on your subscription; verify it in the log the first time, as step 5 above says. If a role must stay on Anthropic through the router, give it the explicit form, `<the name you gave the imported provider>/<model id>`, instead of relying on unspecified fallback behaviour.

CCR also supports routing a subagent's request independently of the main session, via a literal `<CCR-SUBAGENT-MODEL>provider/model</CCR-SUBAGENT-MODEL>` tag CCR "extracts and removes ... from the system prompt or the first two user messages" before routing that one request ([source](https://ccrdesk.top/en/routing/)). Kūkulu does not use this, because its design keeps to one routing mechanism, but it is there if you want to wire something CCR-specific by hand outside Kūkulu.

## Caching and effort

Ollama's Anthropic-compatible endpoint (`/v1/messages`) does not support prompt caching: Ollama's own docs list "prompt caching/`cache_control`" under "not supported" ([source](https://docs.ollama.com/api/anthropic-compatibility)). Routing the `implementer` role to a local Ollama model therefore means every turn re-sends the full prompt, so keep the model's context window and your task sizes in mind. OpenRouter's Anthropic-compatible endpoint does support `cache_control` breakpoints for several backing providers ([source](https://openrouter.ai/docs/features/prompt-caching)).

`effort` is dropped for any model that is not a known Anthropic alias or a `claude-*` id (see "How routing works" above).

## Starting points

As of this writing, for a 48 GB Apple Silicon machine running Ollama locally:

| Role | Suggestion | Why |
|---|---|---|
| `implementer` | Qwen 3.6-35B-A3B, or Qwen 3.6-27B (Q6) with a 64K context cap | The stage that runs for hours; a mixture-of-experts model this size fits comfortably and the implement loop's tasks are bounded and well-specified |
| `reviewer` | DeepSeek V4 Pro or GLM-5.2, via OpenRouter | Review needs the stronger judgment a hosted model gives, at a fraction of a flagship Anthropic model's cost |
| `planner` | `opus` (the default) | The plan is the whole product; everything downstream inherits its mistakes |

Set the context cap in Ollama itself (`num_ctx` on the model, or a Modelfile); the client side of the connection does not control it.

## Running a stage by hand

Each stage also runs on its own, outside `/kukulu:go-flight`, by delegating to its agent: `kukulu-planner`, `kukulu-implementer`, `kukulu-reviewer`, `kukulu-summarizer` once `kukulu_agents_sync` has run, or `kukulu:planner` and so on before it has. That keeps whatever model routing assigned to that role. Invoking `/kukulu:plan-build`, `/kukulu:implement`, `/kukulu:review-build` or `/kukulu:summarize` directly, instead of through the agent, runs the stage on your session's current model, because the stage skills carry `model: inherit` and no model of their own.
