# Contributing

Single-author project, but the rules are written down so they survive the
author forgetting them.

## The one architectural rule

**Mechanics live in the MCP server. Judgment lives in the skills.**

If a change makes a model responsible for choosing a task, editing a checkbox,
writing a log entry, deciding a stage, or producing a bookkeeping commit, it is
in the wrong place. Those belong in `mcp/server.mjs`, where they are
deterministic and testable. Skill prose exists to tell a model *what to think
about*, never *what to do mechanically*.

The corollary: every behaviour change to the server needs a test, because the
server is the part that cannot be reasoned about at runtime by the thing using
it.

## Layout

| Path | What lives there |
|---|---|
| `mcp/server.mjs` | Every deterministic operation, and the JSON-RPC transport |
| `scripts/implement-guard.sh` | The Stop / SubagentStop hook |
| `scripts/lint.sh` | Dependency-free syntax and manifest lint |
| `scripts/check-diagrams.mjs` | Parses every Mermaid block; CI-only, needs mermaid + jsdom |
| `agents/*.md` | Stage agents: default model, effort, and the skill each preloads |
| `skills/*/SKILL.md` | The prose each stage follows |
| `templates/SPEC.md` | The spec skeleton users copy |
| `templates/foundry.config.example.json`, `templates/ccr/` | The global routing config and claude-code-router provider manifests |
| `test/` | Harness plus eight suites |
| `docs/` | Architecture, tool reference, routing guide, spec guide, runbook |

## Setup

```bash
git clone git@github.com:ericmann/foundry.git
cd foundry
pre-commit install     # optional, but CI runs the same checks
```

There is nothing to install. The server, the tests and the lint script have no
dependencies; `package.json` has no `dependencies` block and there is no
lockfile, on purpose — a plugin that needs `npm install` before it works is a
plugin that fails on someone else's machine.

## Tests

```bash
npm run lint                    # node --check, bash -n, JSON parse, exec bits
npm test                        # all eight suites
npm test -- guard protocol      # named suites only
node test/state.mjs             # one suite, directly
KEEP_REPO=1 npm test -- drive   # keep the temp repos for inspection

# documentation diagrams, which need two packages the plugin does not ship
npm install --no-save mermaid jsdom && node scripts/check-diagrams.mjs
```

| Suite | Covers |
|---|---|
| `plugin` | Manifests, agent and skill frontmatter, hook wiring, cross-references, documentation links, diagram style, CI pinning |
| `protocol` | JSON-RPC framing, handshake, tool discovery, error mapping |
| `state` | `foundry_status` and every branch of the `foundry_next` decision table |
| `implement` | `run_start`, `task_next`, `task_done`, `task_block`, `verify`, `run_finish` |
| `review` | `review_submit` and `summary_commit`, including every refusal |
| `routing` | Config merge and precedence, `foundry_agents_sync`, `foundry_config_show`, every refusal |
| `guard` | The Stop hook: blocking, counting, giving up, environment handling |
| `drive` | One complete flight end to end over real stdio |

Suites are plain Node programs that print TAP-ish lines and exit non-zero on
failure. `test/harness.mjs` provides temp git repos, an MCP client, fixtures
and the assertion helpers. Add assertions to the suite that owns the behaviour;
add a new suite only for a genuinely new surface.

Every suite creates its own throwaway repos under the system temp directory and
removes them on exit. Nothing touches the developer's git config: repo identity
is set per-repo.

## Style

- No dependencies. Not in the server, not in the tests, not in the lint script.
- Comments explain *why*, and in this codebase that usually means "why a model
  cannot be trusted with this". Ordinary code needs no narration.
- Error messages are written for a model that has to recover from them: say
  what is wrong, and what to do instead.
- Diagrams are Mermaid. Box-drawing characters are only allowed in a
  ` ```text ` fence (the repo-layout tree), and the `plugin` suite enforces it.
- Prose is not hard-wrapped at a column in Markdown tables or code, but
  paragraphs wrap around 80 characters to keep diffs readable.

## CI

Three workflows, all of which must be green:

- **ci** — the suite on Node 22, 24 and 26; again on macOS; again with the
  GitHub CLI removed, since `foundry_run_finish` treats `gh` as optional.
  EOL Node lines are not tested and not supported; the floor in
  `package.json` moves up as they age out.
- **lint** — `pre-commit` (yamllint, shellcheck, markdownlint, gitleaks, JSON
  and whitespace hygiene, plus `scripts/lint.sh`), `actionlint` over the
  workflows themselves, and a Mermaid parse of every diagram in the docs.
- **secret-scan** — gitleaks on every push and PR, and over the whole history
  weekly.

`pre-commit run --all-files` locally is the same set the lint job runs. If that
is clean and `npm test` passes, CI will agree.

## Versioning

`package.json`, `.claude-plugin/plugin.json` and the `VERSION` constant in
`mcp/server.mjs` must agree; the `plugin` suite fails if they drift. Bump all
three, add a `CHANGELOG.md` entry, and tag.
