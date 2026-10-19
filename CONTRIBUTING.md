# Contributing

Single-author project, but the rules are written down so they survive the author forgetting them.

## The one architectural rule

**Mechanics live in the MCP server. Judgment lives in the skills.**

If a change makes a model responsible for choosing a task, editing a checkbox, writing a log entry, deciding a stage, or producing a bookkeeping commit, it is in the wrong place. Those belong in `mcp/server.mjs`, where they are deterministic and testable. Skill prose exists to tell a model *what to think about*, never *what to do mechanically*.

Every behaviour change to the server therefore needs a test, because the thing using the server cannot reason about it at runtime.

## Layout

| Path | What lives there |
|---|---|
| `mcp/server.mjs` | Every deterministic operation, and the JSON-RPC transport |
| `mcp/run-command.mjs` | Runs one verify/mutate/setup command in its own process group, bounded in time and output, for the synchronous server |
| `scripts/implement-guard.mjs` | The Stop / SubagentStop hook |
| `scripts/lint.sh` | Dependency-free syntax and manifest lint |
| `scripts/check-names.mjs` | Fails on a misplaced kahakō or an ASCII spelling of the display name in prose; run by `scripts/lint.sh` |
| `scripts/check-diagrams.mjs` | Parses every Mermaid block; CI-only, needs mermaid + jsdom |
| `scripts/check-site.mjs` | Static checks for the site's SPEC rules 1–14, with `--self-test` and `--report`; run by `scripts/lint.sh` and `npm run check:site` |
| `scripts/check-site-browser.mjs` | Layout, console and font checks in headless Chrome; needs Chrome or Chromium; `npm run check:site:browser` |
| `scripts/serve-site.mjs` | Local server for `site/` that applies `site/_headers`; `npm run site:serve` |
| `site/` | The kukulu.tech landing page, deployed as-is by Cloudflare Pages; `docs/site/` holds its inputs |
| `agents/*.md` | Stage agents: default model, effort, and the skill each preloads |
| `skills/*/SKILL.md` | The prose each stage follows |
| `templates/SPEC.md` | The spec skeleton users copy |
| `templates/kukulu.config.example.json`, `templates/ccr/` | The global routing config and claude-code-router provider manifests |
| `templates/constraints.example.json` | Three worked `docs/kukulu.json` `constraints` rules, with fixtures |
| `test/` | Harness plus eleven suites |
| `docs/` | Architecture, tool reference, routing guide, spec guide, runbook |
| `docs/plans/` | The task-by-task plan behind each release |
| `docs/feedback/` | Stumbling blocks a real flight hit, feeding the next release plan; gitignored, local to the maintainer |

## Setup

```bash
git clone git@github.com:DisplaceTech/kukulu.git
cd kukulu
pre-commit install     # optional, but CI runs the same checks
```

There is nothing to install. The server, the tests and the lint script have no dependencies; `package.json` has no `dependencies` block and there is no lockfile. That is on purpose: a plugin that needs `npm install` before it works will fail on someone else's machine.

## Names

The display name is **Kūkulu**, with the macron (kahakō) over the first u, U+016B, stored NFC. Use it in prose: docs, README, titles, release notes and messages a person reads. Everything a machine reads is ASCII: `kukulu` for ids, namespaces, tool names, paths, keys and URLs, and `KUKULU_` for environment variables. Never put the macron in an identifier, path, key or URL. The word ʻōlelo Hawaiʻi is written with the ʻokina, U+02BB, not an apostrophe.

`node scripts/check-names.mjs` enforces this and runs inside `npm run lint`, pre-commit and CI. It fails on a macron outside the standalone word, a decomposed u + U+0304, a non-ASCII path, the ASCII spelling of the display name in Markdown prose (code spans, fenced blocks and URLs are exempt), and an apostrophe where the ʻokina belongs. Archived flights, `docs/plans/`, `docs/feedback/`, `docs/SPEC.md` and the changelog below its newest entry are history and are not checked for prose.

## Tests

```bash
npm run lint                    # node --check, bash -n, JSON parse, exec bits
npm test                        # all eleven suites
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
| `state` | `kukulu_status` and every branch of the `kukulu_next` decision table; `kukulu_plan_commit` (every check, `renumber`) |
| `implement` | `run_start`, `task_next`, `task_done`, `task_block`, `verify`, `run_finish`; the commit helper's signing fallback |
| `review` | `review_submit` and `summary_commit`, including every refusal and rollback on a failed commit; `kukulu_flight_archive`; `kukulu_pr_finalize` |
| `routing` | Config merge and precedence, `kukulu_agents_sync`, `kukulu_config_show`, every refusal |
| `constraints` | `docs/kukulu.json` constraints, fixture self-tests, the scan, every refusal |
| `feedback` | `kukulu_feedback_log`, `.kukulu/feedback.jsonl`, and the `policies.feedback` opt-out |
| `streams` | Parallel workstreams: stream tags, waves, partition validation, stream-scoped tools, worktrees, `kukulu_stream_finish`, `kukulu_next`'s `streams`, pausing at a wave |
| `guard` | The Stop / SubagentStop hook: scoping, blocking, counting, giving up, environment handling |
| `drive` | Complete flights end to end over real stdio: one serial, and parallel ones (a wave, `maxStreams: 1`, an overlapping partition) |

Suites are plain Node programs that print TAP-ish lines and exit non-zero on failure. `test/harness.mjs` provides temp git repos, an MCP client, fixtures and the assertion helpers. Add assertions to the suite that owns the behaviour; add a new suite only for a new surface.

Every suite creates its own throwaway repos under the system temp directory and removes them on exit. Nothing touches the developer's git config: repo identity is set per-repo.

## Style

- No dependencies in the server, the tests or the lint script.
- Comments explain *why*, and in this codebase that usually means "why a model cannot be trusted with this". Ordinary code needs no narration.
- Error messages are written for a model that has to recover from them: say what is wrong, and what to do instead.
- Diagrams are Mermaid. Box-drawing characters are only allowed in a ` ```text ` fence (the repo-layout tree), and the `plugin` suite enforces it.
- Markdown prose is not hard-wrapped: each paragraph and list item is one line, and the renderer wraps it. `.markdownlint.yaml` turns the line-length rule off for this reason.

## CI

Three workflows, all of which must be green:

- **ci**: the suite on Node 22, 24 and 26; again on macOS; again with the GitHub CLI removed, since `kukulu_run_finish` treats `gh` as optional. EOL Node lines are not tested and not supported; the floor in `package.json` moves up as they age out.
- **lint**: `pre-commit` (yamllint, shellcheck, markdownlint, gitleaks, JSON and whitespace hygiene, plus `scripts/lint.sh`), `actionlint` over the workflows themselves, and a Mermaid parse of every diagram in the docs.
- **secret-scan**: gitleaks on every push and PR, and over the whole history weekly.

Locally, `pre-commit run --all-files` runs the same set of checks as the lint job. If that is clean and `npm test` passes, CI will agree.

## Versioning

`package.json`, `.claude-plugin/plugin.json` and the `VERSION` constant in `mcp/server.mjs` must agree; the `plugin` suite fails if they drift. Bump all three, add a `CHANGELOG.md` entry, and tag.

## License

Kūkulu is licensed under the [Apache License 2.0](./LICENSE) from 0.4.0 on. Contributions are accepted under the same license (inbound = outbound): by submitting a contribution you agree it is licensed under Apache 2.0, as section 5 of the license describes, with no additional terms.
