# Model routing

Which model and effort level runs each of Foundry's four stages — `planner`,
`implementer`, `reviewer`, `summarizer` — is not fixed in the plugin. It is
resolved per role, per key, from four layers, and turned into project-level
agent files that Claude Code will actually spawn.

## How routing works

Precedence, highest first:

1. `docs/foundry.json` → `"roles": { ... }` and `"permissionMode"` (project
   override, committed with the rest of the plan).
2. A named profile inside the global file — selected by `FOUNDRY_PROFILE`, or
   by the global file's own top-level `"profile"` key when the environment
   variable is unset.
3. The global file itself: `$FOUNDRY_CONFIG` if set, else
   `$XDG_CONFIG_HOME/foundry/config.json`, else
   `~/.config/foundry/config.json`.
4. The plugin's own defaults, in `agents/*.md`.

A profile or a project override is a *partial* overlay: it can set a role's
`model` without touching its `effort`, or vice versa. The merge happens per
role, per key — `foundry_config_show` reports, for every field, which of the
four layers it actually came from (`default`, `global`, `profile:<name>`, or
`project`).

Calling `foundry_agents_sync` (which `/foundry:go-flight` does automatically,
before its loop) turns the merged result into
`.claude/agents/foundry-<role>.md` — a project-level Claude Code subagent
file, one per role. `foundry_next` then names that generated agent instead of
the plugin's own `foundry:<role>` agent, whenever it exists. Project-level
agents accept any `model:` string, including a router-specific
`provider,model` or `provider/model` form, and they accept `permissionMode`,
which every generated file sets (default `acceptEdits`) — this is what
removes the need to launch a session with `--permission-mode acceptEdits`
for the implementer's file edits once agents have been generated at least
once. It does not cover MCP tool calls: verified directly, a generated
agent's `foundry_status` call is denied under both `acceptEdits` and
`bypassPermissions` unless the session carries an allow rule, and the rule
that works (and reaches subagents) is the scoped server name
`mcp__plugin_foundry_foundry` in `permissions.allow` —
`foundry_agents_sync` writes it for you; see
[operations.md](./operations.md#running-a-flight). Plugin-shipped agents cannot
do either of these things: [Claude Code's plugin
reference](https://code.claude.com/docs/en/plugins-reference) states that
"plugin subagents don't support the `hooks`, `mcpServers`, or
`permissionMode` frontmatter fields", which is why routing works by
generating files rather than by editing `agents/*.md` in place.

`effort` is only meaningful for an Anthropic model — a known alias
(`fable`, `opus`, `sonnet`, `haiku`, `inherit`) or a full `claude-*` id.
[Claude Code's subagent
reference](https://code.claude.com/docs/en/sub-agents) documents `model` as
accepting exactly those forms, "or `inherit`", with no mention of `effort`
applying to anything else. When a role resolves to any other model string,
Foundry drops its `effort` silently from the generated file and reports the
drop in `effortDropped`, rather than emitting a key the far end would not
understand.

**The one thing routing cannot do inside a single session.** Claude Code
hot-reloads a project-level agent file from `.claude/agents/` within seconds
of it changing, with one documented exception: the *first* agent file
created in a new `.claude/agents/` directory is not picked up until the
session restarts. A routing edit to an already-populated directory, by
contrast, is picked up live — this plugin relied on the stricter,
conservative assumption through 0.2.0 and confirmed the actual behaviour for
0.3.0.

So the only case `foundry_agents_sync` cannot make immediately usable is a
project's very first sync, and only when the routed model is not one the
`Agent` tool can name (a family alias, or a `claude-<family>-…` id that maps
to one) — for any such model, `foundry_next` falls back to the plugin's own
`foundry:<role>` agent with the resolved model until this session's next
launch, and the flight proceeds without stopping. `foundry_next` reports
this per stage as `agentFallback` and `fallbackAgent`; `foundry_agents_sync`
and `foundry_next` both report the one case that truly needs a restart as
`restartRequired`. `/foundry:go-flight` checks it before the loop and, when
true, prints the table and this line, then stops:

```text
FOUNDRY: RESTART REQUIRED — agent definitions were (re)generated; start a new session and run /foundry:go-flight again.
```

In practice this costs at most one extra launch per project — the first
time, and only for a role routed off-platform before that first sync — and
never again, and never mid-flight. See
[docs/operations.md](./operations.md#routing) for a two-line headless
wrapper that handles the restart itself.

While `agentFallback` is in effect, the controller spawns the plugin's own
`foundry:<role>` agent with `agentModel` passed as the `Agent` tool's
`model` argument. The tool takes only the aliases `sonnet`, `opus`, `haiku`
and `fable`, so a role routed to a full id such as `claude-opus-5-5` is
handed `opus` — the latest of that family, which may not be the pinned
version; `foundry_next` reports that as `agentModelExact: false` and the
controller prints a one-line note. Full ids are fine in routing config, and
are exact once the generated agent loads: only this first-population
fallback is approximated. A `claude-*` id of a family Foundry does not know
is treated like a non-Anthropic model: no fallback, so a restart. `effort` is lost in that case: it lives only in the
generated agent's own frontmatter, and the `Agent` tool has no `effort`
parameter to carry it around. This costs at most one stage's worth of
effort, since the generated file becomes usable from the very next session.

The generated files are excluded from git per clone, via
`.git/info/exclude` rather than `.gitignore` — they encode a person's own
routing, not the project's, and excluding them this way needs no commit on
the base branch before a run can start.

## The global file

`templates/foundry.config.example.json` is the shape:

```json
{
  "roles": {
    "planner":     { "model": "fable",  "effort": "high" },
    "implementer": { "model": "sonnet", "effort": "medium" },
    "reviewer":    { "model": "fable",  "effort": "high" },
    "summarizer":  { "model": "fable",  "effort": "medium" }
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

Copy it to `~/.config/foundry/config.json` (or point `$FOUNDRY_CONFIG`
somewhere else) and edit it there — it applies across every project on the
machine, unless a project's own `docs/foundry.json` overrides a role.

`"Ollama"` and `"OpenRouter"` above are not special strings Foundry
understands; they are provider *names* you give claude-code-router when you
add each provider (see below), and the model string is whatever that router
expects for "this provider, this model". Foundry copies it into `model:`
verbatim and never parses it.

To pick a profile without setting an environment variable — the common case
on a machine that always uses the same router setup — add `"profile":
"local"` to the global file itself. `FOUNDRY_PROFILE`, when set, always
wins over the file's own choice.

A project can still override any role for itself, in `docs/foundry.json`:

```json
{
  "verify": ["npm test"],
  "roles": { "reviewer": { "model": "haiku" } }
}
```

Only the keys you name change; everything else keeps coming from the
profile or the defaults. Run `foundry_config_show` in any Foundry-enabled
session to see the fully resolved table and where each value came from.

## Routing through claude-code-router (v3)

The model string Foundry writes is sent to Claude Code exactly as given, and
Claude Code sends it to whatever `ANTHROPIC_BASE_URL` the session is running
under. A `provider/model` string therefore only means something when the
session is launched through a router that understands that syntax — plain
Claude Code has no idea what to do with `Ollama/qwen3.6:35b-a3b`.
[claude-code-router](https://github.com/musistudio/claude-code-router) (CCR)
is one such router; this section covers its current release line (v3.x,
latest v3.1.1 as of this writing). All facts below are cited to CCR's own
docs at [ccrdesk.top](https://ccrdesk.top/) — read them yourself before
relying on any of this in an unattended flight.

1. **Install and start it.**

   ```bash
   npm install -g @musistudio/claude-code-router
   ccr ui
   ```

   `ccr ui` "[reuses or starts the background service and opens a
   browser](https://ccrdesk.top/en/guides/cli/)" at its management UI. The
   model gateway itself listens on `127.0.0.1:3456`.

2. **Add your providers.** Under *Providers → Add Provider*, each provider
   has a *Name* ("also used by routing, model selectors, logs, and config
   references"), an *API endpoint*, an *API key*, and *Models* ("Model IDs
   exposed by CCR") — [source](https://ccrdesk.top/en/configuration/providers/).
   For Ollama and OpenRouter, pick a built-in preset if the UI offers one for
   your endpoint, or fill in `templates/ccr/ollama.provider.json` /
   `templates/ccr/openrouter.provider.json` by hand; both use the
   `anthropic_messages` protocol, one of the four protocols CCR documents.
   You can also import either file directly once it is hosted somewhere CCR
   can fetch over HTTPS, via
   `ccr://provider?manifest=<url-encoded-https-url>` — CCR "fetches the
   manifest inside the app, shows a confirmation dialog, and writes config
   only after user approval"
   ([source](https://ccrdesk.top/en/provider-import/)); manifests must be
   HTTPS, JSON, under 128 KB, and not point at a local or private host, so a
   `localhost` Ollama manifest may need the UI form instead of the deeplink.

   For any role that should keep running on your Anthropic subscription
   through the router (rather than bypassing the router for that stage —
   see below), use *Providers → Import local agent login → Claude Code*,
   which "reads local Claude Code OAuth credentials. When a usable access
   token is available, CCR can import it as a `Claude Code API` provider"
   using the `anthropic_messages` protocol
   ([source](https://ccrdesk.top/en/configuration/providers/)). This reuses
   your own Claude Code sign-in through a third-party local proxy; that is a
   choice about your own credentials, and Foundry takes no position on it.

3. **Create a Claude Code Agent Config profile.** Under *Agent Config →
   Claude Code*, add a profile (call it `Foundry`). Set **Effect scope** to
   *"Only opened from CCR"* — CCR documents the alternative, *"System
   default"*, as making the profile "the system-default Claude Code
   profile," which is the opposite of what you want here: only Foundry
   sessions should go through the router
   ([source](https://ccrdesk.top/en/configuration/agents/claude-code/)).
   Leave the profile's own **Model** field and its per-tier **Fable / Opus /
   Sonnet / Haiku** overrides empty — those are a second routing layer CCR
   offers and Foundry does not need; Foundry's own routing config already
   picks each role's model.

4. **Launch through the profile.**

   ```bash
   ccr Foundry
   ```

   which "[launches an enabled Agent Config
   profile](https://ccrdesk.top/en/guides/cli/)". A plain `claude` launch,
   outside `ccr`, is completely untouched.

5. **Verify before trusting a long flight.** CCR's *Logs and observability*
   page shows which provider actually served each request. Check it after
   the planner's first call, not after the whole flight.

**What happens to a plain Anthropic model name (`fable`, `sonnet`,
`claude-fable-5-1`, …) sent through the router.** CCR's own routing docs say:

> "The built-in Claude Code route detects requests from Claude Code and
> routes main requests to the Claude Code Agent Config model when the client
> has not selected a recognized model."
>
> "Claude Code main requests prefer an explicit client-selected model that
> CCR recognizes."
>
> "The Agent Config model is only the default when the client model is
> missing or unrecognized; if it is unset, the built-in route remains
> inactive."
>
> — [ccrdesk.top/en/routing](https://ccrdesk.top/en/routing/)

Those three sentences are all CCR's documentation says on the subject as of
this writing, and none of them define what "recognized" means for a bare
alias like `fable` or a bare id like `claude-fable-5-1` — as opposed to an
explicit `provider/model` string, which is unambiguous. Do not assume a bare
Anthropic name will quietly reach Anthropic through the router on your
subscription; verify it in the log the first time, the way step 5 above
says. If a role must stay on Anthropic through the router, give it the
explicit form instead — `<the name you gave the imported provider>/<model
id>` — rather than relying on unspecified fallback behaviour.

CCR also supports routing a subagent's request independently of the main
session, via a literal `<CCR-SUBAGENT-MODEL>provider/model</CCR-SUBAGENT-MODEL>`
tag CCR "extracts and removes ... from the system prompt or the first two
user messages" before routing that one request
([source](https://ccrdesk.top/en/routing/)). Foundry does not use this — one
routing mechanism only, per the design — but it exists if you want to wire
something CCR-specific by hand outside Foundry.

## Caching and effort

Ollama's Anthropic-compatible endpoint (`/v1/messages`) does not support
prompt caching: Ollama's own docs list "prompt caching/`cache_control`" under
"not supported"
([source](https://docs.ollama.com/api/anthropic-compatibility)). Routing the
`implementer` role to a local Ollama model therefore means every turn
re-sends the full prompt from scratch — keep the model's context window and
your task sizes in mind. OpenRouter's Anthropic-compatible endpoint does
support `cache_control` breakpoints for several backing providers
([source](https://openrouter.ai/docs/features/prompt-caching)).

`effort` is dropped for any model that is not a known Anthropic alias or a
`claude-*` id — see "How routing works" above.

## Starting points

As of this writing, for a 48 GB Apple Silicon machine running Ollama
locally:

| Role | Suggestion | Why |
|---|---|---|
| `implementer` | Qwen 3.6-35B-A3B, or Qwen 3.6-27B (Q6) with a 64K context cap | The stage that runs for hours; a mixture-of-experts model this size fits comfortably and the implement loop's tasks are bounded and well-specified |
| `reviewer` | DeepSeek V4 Pro or GLM-5.2, via OpenRouter | Review needs the stronger judgment a hosted model gives, at a fraction of a flagship Anthropic model's cost |
| `planner` | `fable` (unchanged) | The plan is the whole product; everything downstream inherits its mistakes |

Set the context cap in Ollama itself (`num_ctx` on the model, or a
Modelfile) — the client side of the connection does not control it.

## Running a stage by hand

Each stage also runs on its own, outside `/foundry:go-flight`, by delegating
to its agent: `foundry-planner`, `foundry-implementer`, `foundry-reviewer`,
`foundry-summarizer` once `foundry_agents_sync` has run, or
`foundry:planner` and so on before it has. That keeps whatever model routing
assigned that role. Invoking `/foundry:plan-build`, `/foundry:implement`,
`/foundry:review-build` or `/foundry:summarize` directly, instead of through
the agent, runs the stage on your session's current model — the stage
skills themselves carry `model: inherit` and no model of their own.
