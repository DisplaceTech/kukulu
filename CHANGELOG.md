# Changelog

All notable changes to this plugin. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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
