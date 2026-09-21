# Changelog

All notable changes to this plugin. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `foundry_next` and `foundry_agents_sync` report `agentFallback`,
  `fallbackAgent` and `restartRequired`. Claude Code hot-reloads a routing
  change to an already-populated `.claude/agents/` directory within
  seconds; only a project's very first sync, and only for a role routed to
  a model the `Agent` tool cannot name directly, still needs
  `FOUNDRY: RESTART REQUIRED` (F-02, F-04, F-06). Every other case falls
  back to the plugin's own agent with the resolved `model` and proceeds
  without stopping.
- **`foundry_agents_sync` sets up the MCP allow rule** (F-03): without
  `{ "permissions": { "allow": ["mcp__plugin_foundry_foundry"] } }`, the
  first `foundry_status` call in a subagent is denied under every
  permission mode and the flight stalls silently. The sync now read-merges
  this rule into `.claude/settings.local.json`, unless it is already
  covered there or in the committed `.claude/settings.json`, preserving
  every other key and allow entry; a `settings.local.json` that fails to
  parse is reported (`permissions: "failed: ..."`) rather than overwritten.
  `foundry_config_show` reports `permissionRule: "present" | "missing"`.
  Both `settings.local.json` and the generated agent files are excluded
  from git per clone via `.git/info/exclude`.
- **Run policies and `foundry_run_halt`** (F-05): after 14 tasks a signing
  agent stopped responding mid-flight, and the implementer had no way to
  learn the operator had already authorized unsigned commits, nor a clean
  way to stop. `docs/foundry.json` gains a `policies` block —
  `signing: "auto" | "off" | "required"`, `push: boolean`, `pr: "draft" |
  "none"` — resolved and recorded by `foundry_run_start`, which also probes
  signing for real (`git commit-tree -S`, never a dry run): `off` disables
  it locally; `required` refuses to start unless a genuine signed commit
  succeeds; `auto` falls back to disabling it and records why. Every stage
  prompt from `foundry_next` states the run's policies in one sentence. The
  new `foundry_run_halt` tool lets a run stop cleanly for an operator-level
  problem — a dead signing agent, a full disk, a vanished base branch —
  without resetting or cleaning the tree; `foundry_status` and
  `foundry_next` report the halt like any other. The implement skill
  documents when to disable signing mid-run versus when to halt. The server
  now defines thirteen tools.

### Changed

- Pre-existing untracked files are invisible to a run (F-09, F-17):
  `foundry_run_start` records every path already untracked before it arms
  the lock. `foundry_task_done` and `foundry_run_finish` ignore those paths
  in their dirty-tree checks, and `foundry_task_block`'s `git clean` now
  excludes them instead of deleting them outright. `foundry_run_start`'s own
  "working tree is dirty" gate on the base branch also now considers only
  *tracked* changes, since an untracked file blocking a run from starting at
  all defeated the purpose. `foundry_status` exposes the recorded list as
  `preexistingUntracked`. The implement and review-build skills say so:
  never move, delete, rename, or gitignore a file you did not create, and an
  unexplained edit to `.gitignore` or similar is a review finding.
- The implement guard's cap counts stalls, not stops (F-08): `foundry_task_done`,
  `foundry_task_block` and `foundry_run_start` all reset the re-block counter
  to zero, so the cap bounds re-blocks since the last time work actually
  moved, not the whole run. The default drops from 500 to 60 — at the
  ~6 blocked stops per healthy task observed in practice, 60 is ten tasks'
  worth of blocking with no progress. A new `guardCap` key in
  `docs/foundry.json` overrides the default per project, carried into
  `.foundry/implement.lock` at `foundry_run_start` and taking precedence
  over the `FOUNDRY_GUARD_CAP` environment variable. The trip message now
  names the stalled task. `foundry_task_done`'s return gains `guardReset`.
- The implement guard is a Node script (`scripts/implement-guard.mjs`,
  replacing `implement-guard.sh`) scoped to the implementer, not to every
  `Stop`/`SubagentStop` in the project (F-07). `hooks/hooks.json` matches
  `SubagentStop` to the implementer's agent type at the hook-registration
  level; the script itself also checks `agent_type`, and for a bare `Stop`
  checks whether the stopping session's own transcript called
  `foundry_run_start`. A controller session merely waiting on a background
  implementer is never blocked and never spends the re-block counter.
  `foundry_run_start` now writes `.foundry/implement.lock` as JSON
  (`{ count, armedAt, round }`); a legacy bare-number lock from a 0.2.x run
  still reads back correctly. `foundry_status` gains `lockCounter`.
- `go-flight` is model-invocable (F-01): `disable-model-invocation` is gone,
  so asking Claude to run the flight works alongside the literal
  `/foundry:go-flight` command. The loop section now describes an `Agent`
  call as event-driven rather than a blocking wait, since some harnesses
  return immediately and deliver the result as a later notification (F-04).

## [0.2.0] — 2026-09-19

### Added

- **Per-role model routing.** Each of the four stage roles can be pointed at
  a different model — an Anthropic alias or id, or a model reached through
  a local router such as claude-code-router — from a global config file
  (`$FOUNDRY_CONFIG`, else `$XDG_CONFIG_HOME/foundry/config.json`, else
  `~/.config/foundry/config.json`), an optional named profile inside it
  (`FOUNDRY_PROFILE`, or the file's own `"profile"` key), and an optional
  per-project override in `docs/foundry.json`'s new `roles` and
  `permissionMode` keys. See `docs/routing.md`.
- **`foundry_agents_sync`** generates `.claude/agents/foundry-<role>.md`
  from the merged config, writing only files whose content changed, and
  excludes them from git via `.git/info/exclude`. `/foundry:go-flight` calls
  it once before its loop and prints the resolved table.
- **`foundry_config_show`** shows the merged routing config, read-only,
  with the source of every value (`default` | `global` | `profile:<name>` |
  `project`) and which generated agents are stale.
- **`foundry_next`** gains a `model` field and now names the generated
  `foundry-<role>` agent once one exists, instead of the plugin's own
  `foundry:<role>`. **`foundry_status`** gains `agentsGenerated`.
- **Templates**: `templates/foundry.config.example.json` and two
  claude-code-router provider manifests under `templates/ccr/`.
- **Test suite**: an eighth suite, `routing` (194 assertions), covering the
  config merge, both new tools and every refusal.

### Changed

- Project-level agents accept `permissionMode`, which every generated agent
  now carries (default `acceptEdits`) — once `/foundry:go-flight` has run
  once in a project, launching with `--permission-mode acceptEdits` is no
  longer required for the implementer's file edits. MCP tool calls inside a
  subagent still need a `permissions.allow` rule for
  `mcp__plugin_foundry_foundry`; the README shows it.
- `go-flight`'s `allowed-tools` now names the MCP tools the way a
  plugin-shipped server actually exposes them
  (`mcp__plugin_foundry_foundry__<tool>`), alongside the bare
  `mcp__foundry__<tool>` form a project `.mcp.json` gives. The bare form
  alone never matched a plugin install.
- Claude Code does not load an agent file written or edited after a session
  starts, so a routing config change (including the very first sync in a
  project) makes `/foundry:go-flight` print `FOUNDRY: RESTART REQUIRED` and
  stop, rather than risk spawning a stage against a model the session
  cannot actually reach.
- The server now defines twelve tools.

### Fixed

- The four stage skills (`implement`, `plan-build`, `review-build`,
  `summarize`) set `disable-model-invocation: true`, which — per Claude
  Code's own docs — also blocks a skill from being preloaded into a
  subagent. Every stage agent's `skills:` preload had therefore never
  actually taken effect. The four skills now set neither that flag nor
  their own `model`/`effort` (`model: inherit`), so the agent — plugin
  default or generated — is the sole owner of both, and preloading works.

## [0.1.0] — 2026-09-18

First release.

### Added

- **The pipeline.** `/foundry:go-flight` drives plan → implement → review →
  fix → summarize unattended, delegating each stage to its own subagent and
  stopping only at `done` or `halt`.
- **Four stage agents**, each pinned to a model and effort level: `planner`
  (fable, high), `implementer` (sonnet, medium), `reviewer` (fable, high),
  `summarizer` (fable, medium). Five skills back them, all invocable by hand.
- **The `foundry` MCP server** — zero dependencies, Node ≥ 22 — with ten tools
  covering stage selection, task selection, dependency skipping, checkbox
  edits, log entries, verification runs and every bookkeeping commit.
- **The implement guard**, a `Stop` / `SubagentStop` hook that refuses to let
  the implementer stop while tasks are open and gives up at
  `FOUNDRY_GUARD_CAP` (default 500) so a wedged run ends instead of spinning.
- **Blocked-task handling**: a task that cannot be finished is reset, logged
  and left for the reviewer, and its dependents are skipped transitively
  rather than attempted.
- **Review rounds**: findings become `R<N>-<nn>` tasks in `PLAN.md` and
  `PROGRESS.md`, bounded by `maxRounds`, each round one commit.
- **`templates/SPEC.md`**, the spec skeleton the planner reads by heading.
- **Test suite**: a shared harness plus seven suites (`plugin`, `protocol`,
  `state`, `implement`, `review`, `guard`, `drive`), about 480 assertions,
  covering every tool's success and refusal paths, the JSON-RPC transport, the
  guard hook's environment handling, and the plugin's own manifests,
  cross-references and documentation links.
- **CI**: the suite on every Node line still supported upstream (22, 24, 26),
  again on macOS, and again with the GitHub CLI removed to prove
  `foundry_run_finish` treats `gh` as optional. Separate `lint` workflow
  (pre-commit, actionlint, and a Mermaid parse of every diagram) and
  `secret-scan` workflow (gitleaks per push and over history weekly).
- **Documentation**: `README.md`, `docs/architecture.md`, `docs/mcp-tools.md`,
  `docs/writing-specs.md`, `docs/operations.md` and `CONTRIBUTING.md`.
