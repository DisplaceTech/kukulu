# Foundry — working rules

Foundry is a Claude Code plugin: a dependency-free MCP server
(`mcp/server.mjs`) holds the mechanics, and the skills (`skills/*/SKILL.md`)
hold the judgment. These rules apply to every change in this repository.

## Principles

- Mechanics live in the server, judgment in the skills. A new mechanical step
  (validating ids, writing an artifact, archiving, retrying a commit) is a
  server change with a test, never a skill sentence telling a model to do it
  by hand.
- Every server behavior change has a test in the suite that owns that tool
  (CONTRIBUTING.md's table). Every new refusal has a test that triggers it and
  asserts its message.
- Tools validate, then mutate: a refusal comes before any file is written, and
  a tool whose final commit fails leaves the tree as it found it.
- Config never silently defaults a bad value: every new `docs/foundry.json`
  key is validated like `validatePolicies`, `validateParallel` and
  `validateConstraints`, with an unknown-key refusal.
- Documentation moves with the code: a task that adds or changes a tool
  updates `docs/mcp-tools.md` in the same commit.
- Error messages are written for a model: say what is wrong and what to do
  instead. Comments explain why, not what.
- No dependencies anywhere: server, tests, lint.

## Commands

- `npm run lint`: syntax and manifest lint, under 2 s.
- `pre-commit run --all-files`: hygiene, markdownlint, shellcheck, yamllint,
  gitleaks, about 4 s.
- `npm test`: all eleven suites, about 90 s.
- `npm test -- state review`: named suites only; `node test/review.mjs`: one
  suite directly; `KEEP_REPO=1 npm test -- drive`: keep the temp repos.

## Module map

| Path | Responsibility |
|---|---|
| `mcp/server.mjs` | Every deterministic operation and the JSON-RPC transport; one file |
| `mcp/run-command.mjs` | Runs one bounded command in its own process group (unchanged) |
| `scripts/implement-guard.mjs` | Stop/SubagentStop hook (unchanged) |
| `agents/*.md` | Default model, effort and `tools:` per role; the tool list is the contract |
| `skills/*/SKILL.md` | Stage prose |
| `templates/` | SPEC skeleton, routing example, constraint examples |
| `test/harness.mjs` + eleven suites | `plugin`, `protocol`, `state`, `implement`, `review`, `routing`, `constraints`, `feedback`, `streams`, `guard`, `drive` |
| `docs/*.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | User and maintainer docs |

## Constraints

Mechanical rules are in `docs/foundry.json` `constraints` and run on every
`foundry_verify`:

- `server-synchronous`: no `async` or `await` anywhere in `mcp/server.mjs`,
  including comments and strings. Long work uses `spawnSync`.
- `no-dependencies`: `package.json` has no `dependencies` or
  `devDependencies`, and there is no lockfile.
- `no-fable-default`: no `agents/*.md` frontmatter line reads `model: fable`.
- `no-sync-merge`: `gh pr merge` only ever runs with `--auto`, written as one
  inline argument array in `mcp/server.mjs`.
- `no-gnu-sed-inplace`: no `sed -i` in `test/`, `scripts/` or `mcp/`; BSD sed
  on macOS rejects it. Write to a temp file and `mv`.

The reviewer checks these by reading, because no line pattern can express them:

- Refusals before writes; rollback on a failed commit (principle 3).
- `fable` stays a legal alias (`ANTHROPIC_ALIASES`, `AGENT_TOOL_ALIASES`).
- `TASK_ID`, `TASK_LINE` and the guard's regexes are unchanged; only
  `foundry_plan_commit`'s renumber mode accepts a suffix such as `P1-02a`.
- Nothing under `docs/plans/` changes; under `docs/feedback/` only the
  "addressed in" header lines (P3-04). Never edit `docs/SPEC.md`, and never
  edit `docs/PLAN.md` or `docs/PROGRESS.md` by hand.
- ⚠️ ASSUMPTION values each live in one place: `policies.archive`'s default
  `false` only in `cfg()`; the "at least three" sweep only in the review-build
  skill; the 60-line budget only in the plan-build skill.

## Task protocols

**Adding a tool.** Insert its `TOOLS` entry at the position the task names,
and the name at the same position in `test/protocol.mjs`'s `EXPECTED_TOOLS`.
Set the count in `test/plugin.mjs` to the number of `name: "foundry_` entries
in `TOOLS`, and spell the same number in words on the first line of
`docs/mcp-tools.md` ("Nineteen tools", "Twenty tools", "Twenty-one tools").
Append `mcp__plugin_kukulu_kukulu__<tool>` to the `tools:` line of the agent
the task names. Add a `## <tool>` section to `docs/mcp-tools.md`.

**Adding a `docs/foundry.json` key.** Validate it in the config validator with
a refusal for every bad shape. Add a row to `docs/operations.md`'s
configuration table, and make sure `test/plugin.mjs`'s "config keys
documented" loop covers it (it reads `cfg()`'s top-level keys; a nested key
needs its own branch, like `policies` and `parallel`).

**Signing tests.** Never depend on the developer's own git config.
A failing signer is local `commit.gpgsign true`, `gpg.format openpgp` and
`gpg.program /nonexistent-signing-agent` (as the existing run-policies tests
do). A working signer is `test/harness.mjs`'s `mkFakeGpg()` plus
`useFakeSigner(repo, path)` (added by P1-13). A test that unsets the local
`commit.gpgsign` must give the server an isolated global config
(`startServer(repo, { env: { GIT_CONFIG_GLOBAL: <temp file> } })`).

**Commit-failure tests.** To make a Foundry commit fail without signing,
write an executable `.git/hooks/commit-msg` that exits 1 when the message
starts with the subject under test (for example `progress:`). Assert that
every file the tool wrote is byte-identical afterwards, that `git diff
--cached --name-only` is empty, and that HEAD did not move.

**HANDOFF.md for this flight.** `foundry_run_finish` uses
`docs/HANDOFF.md` as the draft PR's body, so its first line must be:
`**Not to be merged** until a human has run one 0.5.0 flight from the
working tree (claude --plugin-dir .). Do not merge, tag or release.`

## Commit template

```text
<ID>: <title>

Goal: <one sentence>
Tests: <test files and assertion names added or changed>
Interpretation: <each choice where the task allowed two readings, or "none">
Measurement: n/a
Manual check: <NOT VERIFIED (human): what to check>, or "none"
```

Write the message to a file and commit with `git commit -F <file>`.

SPEC.md wins over PLAN.md, and PLAN.md wins over code comments.
