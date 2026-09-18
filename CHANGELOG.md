# Changelog

All notable changes to this plugin. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Test suite split into seven focused suites (`plugin`, `protocol`, `state`,
  `implement`, `review`, `guard`, `drive`) on a shared harness, run by
  `test/run.mjs`. About 480 assertions, covering every tool's success and refusal
  paths, the JSON-RPC transport, the guard hook's environment handling, and the
  plugin's own manifests, cross-references and documentation links.
- `scripts/lint.sh` — dependency-free syntax, JSON and executable-bit lint,
  wired into `npm run lint` and pre-commit.
- CI: a Node matrix covering every line still supported upstream (22, 24,
  26), a macOS job, and a job with the GitHub CLI removed to prove
  `foundry_run_finish`'s optional `gh` path. Separate `lint` (pre-commit +
  actionlint) and `secret-scan` (gitleaks) workflows.
- Lint configuration: `.editorconfig`, `.markdownlint.yaml`, `.yamllint.yaml`,
  `.shellcheckrc`, `.pre-commit-config.yaml`.
- Documentation: `docs/architecture.md`, `docs/mcp-tools.md`,
  `docs/writing-specs.md`, `docs/operations.md`, `CONTRIBUTING.md` and this
  changelog. Diagrams are Mermaid, and the `plugin` suite fails the build if an
  ASCII-art diagram creeps back in.

### Fixed

- `foundry_task_next` always reported `resumed: true`, because it read the
  task's state back after marking it `[~]`. A genuinely resumed task is now
  distinguishable from a freshly selected one.
- `foundry_run_finish` pushed before committing the round's state, so the
  remote branch and the draft PR were missing the final `chore: round N
  implemented` commit. State is now recorded before the push.
- `foundry_verify` trimmed its output tails after slicing, yielding 59 lines
  when it promised 60 and dropping the first line of the window.
- Tool input schemas emitted `required: []` for no-argument tools, which
  stricter schema validators reject. The key is now omitted when empty.
- `scripts/implement-guard.sh` read its counter through a useless `cat`
  (shellcheck SC2002).

### Changed

- **Node floor raised from 18 to 22.** End-of-life Node lines are no longer
  supported or tested; 18 went EOL in April 2025 and 20 in April 2026. The CI
  matrix now tracks exactly the lines that are still supported upstream.
- `mcp/server.mjs` reports its version from a single `VERSION` constant, kept
  in sync with `package.json` and `.claude-plugin/plugin.json` by the `plugin`
  suite.
- README rewritten: Mermaid diagrams for the stage machine and the task loop,
  a documentation map, and the model/effort rationale.

## [0.1.0] — 2026-09-18

### Added

- Initial plugin: `/foundry:go-flight` flight controller, four stage agents
  (planner, implementer, reviewer, summarizer), five skills, the zero-
  dependency `foundry` MCP server with ten tools, the Stop/SubagentStop
  implement guard, and `templates/SPEC.md`.
