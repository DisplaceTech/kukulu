# Foundry 0.5.0 — Specification

Version: 0.5.0
Status: ready for flight

The Foundry planner reads this file in full and derives the build plan from
it. This flight is Foundry building its own next release from the friction
its last two field deployments logged. The plugin running the flight is the
installed 0.4.0, read from the plugin cache. The code this flight edits is
the working tree, and nothing it changes affects the server that is running
the flight.

## 1. Overview

Foundry is a Claude Code plugin. It runs a spec-driven
plan → implement → review → fix → summarize pipeline unattended, with
mechanics in a dependency-free MCP server (`mcp/server.mjs`) and judgment
in skills (`skills/*/SKILL.md`). Release 0.5.0 closes every item in two
feedback files:
[`docs/feedback/2026-10-07-project-c.md`](feedback/2026-10-07-project-c.md)
(F-01–F-23, ten flights on 0.3.2 and 0.4.0) and
[`docs/feedback/2026-10-07-project-d.md`](feedback/2026-10-07-project-d.md)
(F-01–F-06, two flights on 0.4.0). It also makes Opus the default model for
every judgment role. Done means four things: every F-item in the appendix
map is closed by the requirement it names, `npm run check` and
`pre-commit run --all-files` pass, the version reads 0.5.0 everywhere, and
a draft PR against `main` is open.

**Why a minor version, not 0.4.1:** this release adds three tools
(eighteen becomes twenty-one) and new `docs/foundry.json` keys (`flight`,
`mutation`, `from`, `policies.archive`, `policies.finalize`,
`policies.mergeMethod`). It also adds a new end-of-flight lifecycle: a
signed, non-breaking flight's PR now marks itself ready and auto-merges
once CI is green, and a finished flight can be archived so the next one can
start in the same repository. That
lifecycle is the multi-flight work the 0.4 plan deferred to 0.5
(cleanflate F-12 and F-27). Both new feedback files show operators doing it
by hand: nine `chore(foundry): archive …` commits in project-c, and a
hand-made `docs/flights/1/` in project-d. The release also
changes the default model for three roles, which changes behavior for
every user who has not pinned their routing.

## 2. Goals and non-goals

- Goal: a summarizer never touches the `Write` tool for `docs/SUMMARY.md`.
  This refusal was logged eleven times across both projects and both
  versions (S-01).
- Goal: Foundry's own commits never hang or half-apply on a signing
  failure, including the planner's commit (S-02).
- Goal: a constraint or `extraVerify` command can say which task makes it
  true, so the plan does not need guard-wrapped commands (S-03).
- Goal: mutation testing can run a targeted subset of tests, a kill by an
  unrelated flaky test can be told apart from a real kill, and the review
  loop converges instead of re-sampling forever (S-04, S-05, S-11).
- Goal: the planner validates, renumbers and commits its plan through a
  tool, not with a hand-written regex (S-06).
- Goal: a finished flight is archived in one tool call, and a repository
  can run flight after flight (S-07, S-08).
- Goal: an operator recovers from a round-cap halt with a tool call, not
  a hand edit of `.foundry/state.json` (S-09).
- Goal: how a flight's PR ends depends on signing. If every commit is
  signed, the PR is marked ready and, unless the change is breaking, set
  to auto-merge once CI is green. If any commit is unsigned, the PR stays
  draft and the flight waits for a human to unlock signing, re-sign the
  branch, and finalize (S-14).
- Goal: Opus is the default for planner, reviewer and summarizer, and
  Sonnet for the implementer (S-10).
- Non-goal: background jobs for long verify commands (cleanflate F-13 and
  F-28). These remain deferred: the synchronous-handler invariant still
  holds, and neither new feedback file asks for them.
- Non-goal: a flight-id prefix on task ids. Archiving makes ids per-flight,
  so `TASK_ID`, `TASK_LINE` and the guard's regexes stay as they are, apart
  from the temporary split suffix S-06 allows in the planner's drafts.
- Non-goal: moving or trimming another flight's notes in a project's
  `CLAUDE.md`. The owner keeps them on purpose (project-c F-20).
- Non-goal: parsing test-runner output to name failing tests. Runner
  formats vary too much. S-05 settles the same question by re-running.
- Non-goal: merging, tagging or publishing *this* release. This flight
  runs on 0.4.0, which has no S-14, so its PR stays draft. The release is
  breaking (S-10, S-14 defaults), so a human would merge it in any case.
- Non-goal: a synchronous merge. S-14 only ever enables GitHub
  auto-merge, which waits for CI. It never runs `gh pr merge` without
  `--auto`.
- Non-goal: anything under `docs/plans/` or `docs/feedback/`, beyond the
  "Addressed in" header lines S-13 adds.

## 3. Engineering principles

Each of these is checkable with a grep or a test. The first three become
`constraints` in `docs/foundry.json` (fixtures in section 5).

1. **No `async`/`await` in `mcp/server.mjs`.** Every tool handler is
   synchronous, and the JSON-RPC loop depends on that. A long operation
   uses `spawnSync` through `mcp/run-command.mjs`, never a promise.
2. **No runtime or dev dependencies.** `package.json` has no
   `dependencies` or `devDependencies` key, and there is no lockfile.
3. **No plugin agent defaults to `fable`.** No `agents/*.md` frontmatter
   line reads `model: fable`.
4. **Mechanics live in the server, judgment in the skills**
   (`CONTRIBUTING.md`). A new mechanical step, such as validating ids,
   writing an artifact, archiving or retrying a commit, is a server change
   with a test. It is never a skill sentence telling the model to do it by
   hand.
5. **Every server behavior change has a test** in the suite that owns that
   tool (see the table in `CONTRIBUTING.md`). Every new refusal has a test
   that triggers it and asserts its message.
6. **Tools validate, then mutate.** A tool that refuses must refuse before
   it writes any file. A tool whose final commit fails must leave the tree
   as it found it (S-02).
7. **Config never silently defaults a bad value.** Every new
   `docs/foundry.json` key is validated the way `validatePolicies`,
   `validateParallel` and `validateConstraints` already are, with an
   unknown-key refusal.
8. **Documentation moves with the code.** A task that adds or changes a
   tool updates `docs/mcp-tools.md` in the same commit. The tool count is
   stated as "Twenty-one tools" wherever the docs currently say "Eighteen".

## 4. Architecture

| Path | Responsibility | Touched by |
|---|---|---|
| `mcp/server.mjs` | Every deterministic operation and the JSON-RPC transport | S-01–S-11, S-14 |
| `mcp/run-command.mjs` | One bounded command in its own process group | unchanged |
| `scripts/implement-guard.mjs` | Stop/SubagentStop hook | unchanged |
| `agents/*.md` | Default model, effort, and tool list per role | S-06, S-07, S-10, S-14 |
| `skills/*/SKILL.md` | Stage prose | S-12 |
| `templates/` | SPEC skeleton, routing example, constraint examples | S-03, S-04, S-10 |
| `test/*.mjs` | Harness plus eleven suites | every S-item |
| `docs/*.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | User and maintainer documentation | S-13 |

`mcp/server.mjs` is one file, so every server requirement touches the same
path, and the plan cannot carve parallel streams out of the server work. Skill
and documentation tasks depend on the server tasks whose tool shapes they
describe. The planner may run independent skill and doc tasks in a wave if
it can prove disjoint paths, but a serial plan is the expected and
acceptable shape.

**The agent tool lists** (`agents/*.md` `tools:`) are the contract for what
each role may call. They change as follows:

- `foundry_plan_commit` goes to the planner (S-06).
- `foundry_flight_archive` goes to the summarizer (S-07).
- `foundry_pr_finalize` goes to the summarizer (S-14).

`test/plugin.mjs` already asserts that these lists name real tools, and
`test/routing.mjs` asserts that generated agents copy them, so both must
keep passing.

## 5. Data and configuration

### New and changed `docs/foundry.json` keys

| Key | Type | Default | Validated by | Requirement |
|---|---|---|---|---|
| `flight` | string, `^[a-z0-9][a-z0-9-]{0,39}$` | absent | `cfg()` | S-07 |
| `constraints[].from` | task id string | absent (always active) | `validateConstraints` | S-03 |
| `extraVerify[prefix][]` object form `.from` | task id string | absent | `normalizeCommand` | S-03 |
| `mutation.targeted` | object: name → `{ cmd, timeoutMs? }`, `cmd` contains `{filter}` exactly once | `{}` | new `validateMutation` | S-04 |
| `policies.archive` | boolean | `false` ⚠️ ASSUMPTION | `validatePolicies` | S-07 |
| `policies.finalize` | `"auto"` \| `"ready"` \| `"draft"` | `"auto"` | `validatePolicies` | S-14 |
| `policies.mergeMethod` | `"merge"` \| `"squash"` \| `"rebase"` | `"merge"` (this repository's convention) | `validatePolicies` | S-14 |

`from` is also accepted on `verify` entries for symmetry. It is rarely
useful there, since a verify command that cannot run yet should not be in
`verify`.

### Routing defaults (S-10)

| Role | 0.4.0 | 0.5.0 |
|---|---|---|
| planner | fable · high | **opus** · high |
| implementer | sonnet · medium | sonnet · medium |
| reviewer | fable · high | **opus** · high |
| summarizer | fable · medium | **opus** · medium |

`fable` stays a legal alias everywhere it is accepted today. Only the
defaults change.

### Tunables introduced by this release

- Review-round mutation scope after round 1 (S-11): files changed since the
  previous review commit. Not a config key. This is a rule in the review
  skill, backed by `lastReviewCommit` in `foundry_status`.
- Module sweep size on a survivor (S-11): at least three ⚠️ ASSUMPTION
  further mutations in the same file. This is skill prose, not a config
  key, because the reviewer applies judgment to what "the same mechanic"
  is.
- Planner `CLAUDE.md` budget in an existing file (S-12): at most 60 ⚠️
  ASSUMPTION new lines in the flight's own section. Skill prose.

### Constraints for this flight's own `docs/foundry.json`

```json
[
  {
    "id": "server-synchronous",
    "description": "No async/await in mcp/server.mjs: every tool handler is synchronous.",
    "paths": ["mcp/server.mjs"],
    "pattern": "\\b(async|await)\\b",
    "shouldMatch": ["async function f() {}", "  const r = await run();", "const g = async () => 1;"],
    "shouldNotMatch": ["function f() {}", "// handlers stay synchronous", "const asynchronous = false;"]
  },
  {
    "id": "no-dependencies",
    "description": "package.json declares no dependencies or devDependencies.",
    "paths": ["package.json"],
    "pattern": "\"(dependencies|devDependencies)\"\\s*:",
    "shouldMatch": ["  \"dependencies\": {", "\"devDependencies\":{}"],
    "shouldNotMatch": ["  \"engines\": {", "  \"description\": \"no dependencies\","]
  },
  {
    "id": "no-fable-default",
    "description": "No plugin agent defaults to fable (S-10).",
    "paths": ["agents/"],
    "pattern": "^model:\\s*fable\\b",
    "shouldMatch": ["model: fable", "model:fable"],
    "shouldNotMatch": ["model: opus", "  model: fable is no longer the default"]
  }
]
```

The running 0.4.0 server does not know `from` (S-03) and refuses unknown
constraint keys, so this flight's own config cannot use it. Instead, the
S-10 task is the first task of the plan, which means `no-fable-default`
holds from that task's own verify onward.

## 6. Interfaces

Each requirement states the observable contract. Tests assert these shapes.

### S-01 — `foundry_summary_commit` writes the summary itself

- New optional argument `content` (string). When it is given, the tool
  validates it (non-empty, under 1 MiB) and that the verdict is
  `APPROVED`, then writes `docs/SUMMARY.md` itself and commits it as
  today. When it is absent, the tool behaves as in 0.4.0 and reads the
  file from disk.
- The summarize skill passes `content` and never calls `Write` or a
  heredoc for `SUMMARY.md`. The heredoc paragraph is removed from that
  skill. It stays in plan-build and implement, which never logged a
  refusal.
- Why an MCP argument rather than a better fallback: the refusal ("Subagents
  should return findings as text") comes from the harness, and there is no
  documented opt-out (no frontmatter field or permission mode). It hit every
  summarize run on both 0.3.2 and 0.4.0. A tool argument is not a `Write`
  call, so it removes the round-trip entirely.

### S-02 — signing failures never hang or half-apply a Foundry commit

- One commit helper, which replaces the bare commit inside
  `gitCommitIfChanged`, runs every commit the server makes with
  `GIT_TERMINAL_PROMPT=0` and a bounded timeout (the probe's 30 s). It
  behaves like this:
  - On a signing failure under `policies.signing: "auto"`, it retries the
    same commit once unsigned. It records `state.signing = "off (commit
    signing failed: <first line>)"`, sets local `commit.gpgsign=false`
    (as the probe already does), and appends one `signing` feedback entry.
  - Under `"required"`, it throws, and the calling tool rolls back
    (below).
- `foundry_review_submit` becomes all-or-nothing. It snapshots every path
  it will write (`REVIEW.md` staging, `PLAN.md`, `PROGRESS.md`,
  `state.json`, `feedback.jsonl`) before writing any of them. If its commit
  throws, it restores every snapshot and unstages, so a second call does not
  append the fix tasks twice. The rollback has a test.
- Any other tool that writes and then commits (`task_done`,
  `task_block`, `task_reopen`, `run_start`, `run_finish`,
  `flight_options`, `run_halt`, `summary_commit`, the new tools) gets the
  same snapshot and restore. Implement this once, as a helper, and do not
  copy it into each tool.
- An unsigned fallback also flips signing off for the rest of the run,
  so the implementer's own commits inherit local `commit.gpgsign=false`
  exactly as they do after a failed run-start probe. A pinentry that failed
  once will fail again, and an unattended agent cannot answer it.
  Whenever Foundry sets that local override because signing *failed*
  (this fallback, or the probe under `auto`), and not because the policy
  is `off`, it records `state.signingOverride: true` so that S-14 can
  undo it.
- The planner's own commit goes through `foundry_plan_commit` (S-06), so
  it gets the same behavior. The planner never runs `git commit` itself.

### S-03 — `from`: a rule that becomes active at a task

- `constraints[].from` and the object form of an
  `extraVerify`/`verify` entry accept `from: "<task id>"`. The id must
  match `TASK_ID` and must exist in `PLAN.md` when `PLAN.md` exists. A
  dangling id is refused with a message naming it.
- The rule is **active** when the `from` task is `[~]` (in progress) or
  `[x]` (done) in `PROGRESS.md`, or when no open task remains. It is
  inactive when the task is `[ ]`, `[!]` or `[-]`. The in-progress case is
  what makes the task that introduces the rule satisfy it.
- `foundry_verify`, `foundry_run_finish`'s scan and `foundry_mutate` skip
  inactive rules, but still run every constraint's fixture self-test.
  Results report inactive rules as `{ id, ok: true, inactive: "until
  <id>" }` for constraints and `{ cmd, skipped: "inactive until <id>" }`
  for commands. They do not count as failures.
- Stream-scoped calls read task state from the stream's own view, as the
  other stream-scoped tools already do.
- The plan-build skill and `docs/writing-specs.md` replace the
  `test ! -f X || bash X` guard idiom with `from`.

### S-04 — targeted mutation commands

- `docs/foundry.json` `mutation.targeted` maps a name to
  `{ cmd, timeoutMs? }`. For example:
  `{ "php": { "cmd": "php artisan test --filter={filter}" } }`.
  `validateMutation` checks that `{filter}` appears in `cmd` exactly once,
  and refuses unknown keys under `mutation`.
- `foundry_mutate` gains the arguments `targeted` (a name) and `filter`
  (a string matching `^[A-Za-z0-9_.:\\/-]{1,200}$`). Both are given or
  neither is, and they are mutually exclusive with `commands`. The server
  substitutes `filter` as one single-quoted shell word. Passing a filter
  that fails the regex, or an unknown name, is refused, and the message
  lists the legal names.
- The targeted command runs instead of the file's verify commands. The
  constraint self-test and scan semantics are unchanged.
- The planner fills `mutation.targeted` when SPEC section 7 names a
  filterable test command. The templates' `SPEC.md` section 7 and
  `docs/writing-specs.md` say how to name one.

### S-05 — a kill that is not a kill

- `foundry_mutate` always returns `failedCommands`: the `cmd` of every
  command that failed.
- With the new argument `confirmKill: true`, a kill triggers this check:
  after the restore, each failed command is re-run once on the unmutated
  tree, and the results come back as `confirm`.
  - If every one passes, the kill stands.
  - If any one fails again, the result is
    `killed: false, inconclusive: true`, with the verdict
    `inconclusive: <cmd> also fails without the mutation`.
- The review skill says to pass `confirmKill` whenever a kill's failure
  tail does not name the test the reviewer expected to catch it. With a
  targeted command the re-run is cheap, so the reviewer may pass it always.

### S-06 — `foundry_plan_commit`

- New tool. Arguments: `{ renumber?: boolean }`. It validates
  `docs/PLAN.md`, `docs/PROGRESS.md` and `docs/foundry.json` together, and
  refuses with **every** problem listed, not only the first. The checks:
  - Task headings must be exactly `### <ID>: <title>`.
  - Ids must be unique and sequential within each phase
    (`P<phase>-<nn>`, `nn` from `01`).
  - Every `Depends on` id must exist and come earlier in the plan.
  - There must be no dependency cycle.
  - `PLAN.md` and `PROGRESS.md` must hold the same id set, in the same
    order.
  - Stream tags must be well formed and the waves valid, by reusing
    `computeWaves`.
  - `foundry.json` must pass `cfg()`, and every `from` must name an id
    that exists (S-03).
  - `CLAUDE.md` must exist.
- With `renumber: true`, ids that break the sequence, including a
  temporary split suffix such as `P1-02a` (accepted only in this mode),
  are rewritten sequentially in document order. The rewrite covers every
  whole-word reference in `PLAN.md`, `PROGRESS.md`, and `foundry.json`
  `from` values. The tool returns the `{ old: new }` map. Renumbering is
  refused once a run has started (`PROGRESS.md` has a `Started` stamp, or
  any task is not `[ ]`).
- On success, it commits `PLAN.md`, `PROGRESS.md`, `foundry.json` and
  `CLAUDE.md` as `plan: derive build plan from SPEC` through the S-02
  helper. It returns `{ commit, tasks, phases, waves, renumbered }`.
- It is added to the planner's tool list. The plan-build skill replaces
  its manual commit step with this tool.

### S-07 — `foundry_flight_archive`

- New tool. Arguments: `{ slug?: string }`. The slug defaults to
  `foundry.json`'s `flight` key. If neither is set, the tool refuses and
  asks for one. The slug must match `^[a-z0-9][a-z0-9-]{0,39}$`.
- It refuses in each of these cases:
  - the flight is not summarized (`state.summarized` is not true);
  - the lock is present;
  - the tree is dirty, excluding `preexistingUntracked`;
  - `docs/flights/<slug>/` already exists.
- Otherwise it does the following:
  1. `git mv` these files into `docs/flights/<slug>/`, each where it
     exists: `docs/PLAN.md`, `PROGRESS.md`, `HANDOFF.md`, `REVIEW.md`,
     `SUMMARY.md`, `foundry.json`, and `.foundry/state.json` and
     `.foundry/feedback.jsonl`. Untracked files are moved with plain
     `mv`.
  2. **Copy** `docs/SPEC.md` there. The live spec stays, so the operator
     can edit it for the next flight.
  3. Reset state to `DEFAULT_STATE`, and commit everything as
     `chore: archive flight <slug>` through the S-02 helper.
  4. Push per policy.
- It returns `{ slug, dir, moved, copied, commit, push }`. After an
  archive, `foundry_next` returns `plan`, because SPEC is present and PLAN
  is absent.
- `policies.archive: true` makes the summarize skill call the tool
  right after `foundry_summary_commit`. The archive commit lands on the
  build branch, so the PR carries it. It is added to the summarizer's tool
  list.
- The pull-feedback skill reads `.foundry/feedback.jsonl` **and** every
  `docs/flights/*/feedback.jsonl`. The existing dedupe by `at` makes this
  safe (project-d had four entries only in an archived
  log).

### S-08 — `foundry_status` reports where planner artifacts came from

- New field `artifacts`, an object mapping each of `SPEC.md`, `PLAN.md`,
  `PROGRESS.md`, `HANDOFF.md`, `REVIEW.md`, `SUMMARY.md` and
  `foundry.json` to `"tracked"`, `"untracked"`, `"modified"` or
  `"absent"`.
- New field `strayArtifacts`, the list of those files that are untracked
  while `PLAN.md` is absent. These are the leftovers of an interrupted
  plan run.
- The plan-build skill says to regenerate every stray artifact from SPEC,
  never trust it, and name it in the plan report.
- New field `lastReviewCommit`: the sha of the most recent `review:` commit
  on the branch, or `null`. S-11 uses it.

### S-09 — recovering from a round-cap halt

- `foundry_flight_options` gains `resume: true`. It clears `state.halted`
  only when the halt is a round-cap halt (`maxRounds` or `maxRoundsHard`)
  and the bounds passed in the same call lift the cap that fired. In every
  other case it refuses with the reason, so a stream-merge or operator halt
  is never cleared this way.
- The round-cap halt message names this call (for example,
  ``call foundry_flight_options({ maxRounds: 4, resume: true })``) instead
  of "edit .foundry/state.json". It uses a correct ordinal ("3rd", not
  "3th").
- The go-flight skill maps an operator's "continue, allow N rounds" to that
  call.

### S-10 — routing defaults

- `agents/planner.md`, `agents/reviewer.md` and `agents/summarizer.md`
  change to `model: opus`, with efforts unchanged.
- `templates/foundry.config.example.json` changes to match, and so do
  the README, `docs/architecture.md` (the role table and diagram) and
  `docs/routing.md`.
- `test/routing.mjs` assertions about defaults change to match.
- `docs/architecture.md` explains why: Opus has outperformed Fable on
  the plan, review and summary roles in the operator's own flights, and the
  role table's "why" column still holds.

### S-11 — the review loop converges

The review-build skill prose changes in four places, and `lastReviewCommit`
(S-08) supplies the facts:

- **Round 1** (`reviewRound` 1): sample as today. When a mutant survives,
  sweep the same file with at least three further mutations of
  neighbouring mechanics. Then queue **one** R-task per file, listing
  every survivor found there, instead of one task per survivor.
- **Round 2 and later**: mutate only files changed in
  `git diff <lastReviewCommit>..HEAD`. A survivor outside that diff goes
  under `## Notes` in `REVIEW.md` as advisory, not an R-task, and the
  summarizer carries it into SUMMARY's notes.
- Prefer a `mutation.targeted` command whenever one is configured.
- When a mutation-only round queues tasks, cite this rule. The narrow
  fix loop from 0.4 is kept.

### S-14 — signing decides how a flight's PR ends

This is the operator's policy (2026-10-07). If every commit is signed, the
PR is marked ready and, unless the change is breaking, auto-merges once CI
is green. If signing failed for any reason, the PR stays draft, and nothing
past the flight happens until a human has unlocked signing and re-signed
the branch. Only then is the PR marked ready and, where it makes sense,
merged.

- During the flight nothing changes: `foundry_run_finish` opens the PR
  as a draft, as it does today.
- New tool `foundry_pr_finalize({ breaking?, resign? })`. It is the
  flight's last call, made by the summarizer after
  `foundry_summary_commit` (and after `foundry_flight_archive` when
  `policies.archive` is true). It refuses before the summary is committed.
  `breaking` is required on the first call and recorded in state, so later
  calls default to the recorded value.
- **Signed check:** `git log --format='%H %G?' <merge-base>..HEAD`
  against `baseBranch`. A commit counts as signed when `%G?` is anything
  other than `N` (no signature) or `B` (bad signature). `E` counts as
  signed, because a signature is present and only the local key is
  missing. The check is the commits themselves, not `state.signing`.
- **All signed** (the PR policy is `draft` and a PR exists), handled by
  `policies.finalize`:
  - `"auto"`: run `gh pr ready`. Then, if `breaking` is false, run
    `gh pr merge --auto --<mergeMethod>`. If GitHub refuses auto-merge (the
    repository setting is off, say), report
    `merge: "unavailable: <gh's first line>"` and leave the PR ready.
  - `"ready"`: run `gh pr ready` and never merge.
  - `"draft"`: change nothing. This is the 0.4.0 behavior.
  - When `breaking` is true, the result is `merge: "skipped: breaking"`.
- **Any unsigned:** the PR stays draft, and the tool records
  `state.awaitingSigning: { unsigned: <count>, first: <sha>, since: <iso> }`,
  appends one `signing` feedback entry, commits state through the S-02
  helper, and returns
  `{ awaitingSigning, next: "<the human's steps, below>" }`. While
  `awaitingSigning` is set, `foundry_next` returns `done` with the reason
  `awaiting signing: …`, so a re-run of go-flight does nothing past the
  flight.
- **`resign: true`** (human-initiated only; every skill forbids an agent
  from passing it on its own):
  1. Run `probeSigning("required")`, and refuse if it fails.
  2. Refuse on a dirty tree or on `baseBranch`.
  3. Run `git rebase -f --rebase-merges --gpg-sign <merge-base>`. The
     `--rebase-merges` flag keeps the `--no-ff` stream merges. On a
     failure, run `git rebase --abort` and refuse with git's message.
  4. Clear the local `commit.gpgsign` override if `state.signingOverride`
     is set.
  5. Re-run the signed check, and refuse if anything is still unsigned.
  6. Run `git push --force-with-lease`, subject to the push policy.
  7. Clear `awaitingSigning`, set `state.signing = "on"`, and continue
     into the all-signed path above.
- The tool returns
  `{ signed, unsigned, ready, merge, breaking, awaitingSigning, resigned, push, pr }`.
- **The breaking call is the summarizer's judgment.** `breaking` is true
  when SPEC or `CHANGELOG.md` lists breaking changes for this work, or when
  the flight changed a public interface, a config default, or behavior an
  existing user relies on. When unsure, it is true. SUMMARY states the call
  and the reason in one line.
- **The human's steps, returned verbatim in `next` and in SUMMARY:**
  unlock the signing agent, then tell the controller to finalize with
  re-signing. That is `foundry_pr_finalize({ resign: true })`, or a manual
  `git rebase -f --rebase-merges --gpg-sign <merge-base>`, a
  force-push, then `foundry_pr_finalize({})`.
- go-flight maps "signing is unlocked, finish it" to
  `foundry_pr_finalize({ resign: true })` and to nothing else.

### S-12 — skill prose fixes

- **plan-build:**
  - The report quotes `docs/foundry.json` from disk, except for the
    `constraints` bodies, which it lists by id with a fixture count
    (project-c F-01).
  - The 150-line `CLAUDE.md` cap applies only when the planner creates
    the file. In an existing `CLAUDE.md`, the planner adds or replaces
    exactly one `## Flight <slug> notes` section of at most 60 lines.
    It merges only flight-agnostic facts into shared sections
    (Constraints, Commands, Task protocols), and leaves other flights'
    sections untouched (project-c F-20).
  - It calls `foundry_plan_commit` instead of committing, and uses
    `renumber` when it splits a task (S-06).
  - It uses `from` (S-03).
  - It handles stray artifacts (S-08).
  - It sets `flight` from the SPEC title or the operator's argument.
- **implement:** a lesson about the *project*, such as a framework
  footgun, goes in the task's log entry and under a `## Codebase notes`
  heading in `HANDOFF.md`, never in `foundry_feedback_log`. That log is
  for Foundry's own friction (project-c F-08, F-09). The summarizer
  lifts `Codebase notes` into SUMMARY as suggested `CLAUDE.md`
  additions.
- **review-build:** S-04, S-05, S-11.
- The summarizer's agent `tools:` gains `foundry_pr_finalize` (S-14).
- **summarize:** S-01's `content`, S-07's `policies.archive`, the
  `Codebase notes` section, and S-14: the breaking call, then
  `foundry_pr_finalize` as the last call. The final message reports
  `READY`, `AUTO-MERGE ON`, or `AWAITING SIGNING` with the human's steps.
- **go-flight:** S-09's resume, S-14's "signing is unlocked" mapping, and a
  `flight=<slug>` argument mapped into the planner prompt.
- **pull-feedback:** S-07's archived logs.

### S-13 — release documentation

- `docs/mcp-tools.md` covers all three new tools and every new argument
  and return field, and says "Twenty-one tools".
- `docs/operations.md` gains a "Running flight after flight" section
  (archive, `CLAUDE.md` per-flight sections, `resume`) and a signing
  section reflecting S-02.
- `docs/writing-specs.md` covers `from`, `mutation.targeted` and
  provenance logging, and closes the deferred cleanflate F-01 with the
  commit-msg hook pattern that flight used.
- `CONTRIBUTING.md`'s suite table is updated if a suite's coverage
  changes.
- `README.md` covers the defaults and the tool count.
- `CHANGELOG.md` gets `## [0.5.0] — <date>`, with Added, Changed, Fixed
  and **Breaking changes** sections. The breaking changes are the routing
  defaults, the summarize skill no longer writing the file itself, and
  `policies.finalize: "auto"`, under which a signed, non-breaking flight's
  PR now auto-merges once CI is green. Each
  entry cites its feedback item as `project-c F-nn` or
  `project-d F-nn`.
- The version reads `0.5.0` in `package.json`,
  `.claude-plugin/plugin.json` and `mcp/server.mjs` `VERSION`.
- Both feedback files get an "Addressed in" header line pointing at this
  spec, in the shape `docs/feedback/README.md` documents.

## 7. Commands

Run from the repository root. Each exits non-zero on failure, and all three
run today on a clean checkout of `main`.

- lint: `npm run lint` (under 2 s)
- hygiene: `pre-commit run --all-files` (about 4 s with the hook
  environments already installed; it also runs markdownlint, shellcheck,
  yamllint and gitleaks)
- test: `npm test` (about 90 s; give it `timeoutMs: 600000`)

There is no `extraVerify`. The whole suite is the verify, because every
task touches the server, a skill whose text `test/plugin.mjs` asserts, or
docs whose links it checks.

There is no `mutation.targeted` for this flight, because the 0.4.0 server
running it does not know the key. Every `foundry_mutate` call runs the full
suite, about 90 s, so the reviewer keeps each round's sample to about ten
mutants and leans on S-11's round-2 scoping.

## 8. Phases

### Phase 1 — server mechanics

S-10 first, so the `no-fable-default` constraint holds from then on. Then,
in this order: S-02 (the commit helper everything else uses), S-01, S-03,
S-04, S-05, S-08, S-09, S-06, S-07, S-14. Each requirement is one or more tasks,
with tests in the owning suite. A task that adds a tool also adds it to the
`EXPECTED_TOOLS` list in `test/protocol.mjs`, and to the agent tool lists
and the count in `test/plugin.mjs`.

**Manual check:** none beyond the suite. Write
`Manual check: NOT VERIFIED (human)` for "run one real flight on a
throwaway spec with the working-tree plugin
(`claude --plugin-dir .`) and confirm the summarizer passes `content`
and no `Write` refusal appears".

### Phase 2 — skills and agents

S-11, S-12, and the agent `tools:` changes (if Phase 1 did not already make
them). `test/plugin.mjs` asserts presence or absence of each changed skill
sentence: the summarize skill no longer contains the heredoc fallback, and
plan-build names `foundry_plan_commit` and `from`.

**Manual check:** read each changed `SKILL.md` top to bottom for
contradictions with the tool reference. Record it as
`NOT VERIFIED (human)`.

### Phase 3 — documentation and release

S-13. The last task pushes the branch. `foundry_run_finish` opens the draft
PR against `main`, and the PR body states that it is **not to be merged**
until a human has run one 0.5.0 flight from the working tree. Do not merge,
tag or release. (This flight runs on 0.4.0, which has no
`foundry_pr_finalize`, so the PR stays draft regardless.)

**Manual check:** CI is green on the PR.

## 9. Open questions

None remain open. The operator settled these on 2026-10-07. Record each
under `## Decisions` as given; do not reopen them.

1. **What happens after signing fails.** Flip signing off for the rest of
   the run (S-02), keep the PR draft, and do nothing past the flight until
   a human unlocks signing and finalizes with a re-sign (S-14).
2. **S-07 on `baseBranch`.** Allowed. An operator who archives on `main`
   after merging meant to, and the commit is just as reviewable there.
3. **S-06 refusal format.** Both: an array of `{ check, id?, message }` in
   the error's structured data where the transport allows it, and one
   joined, numbered string in the `ToolError` message, so a model reading
   only the error still sees every problem.

## Appendix A: feedback item map

Every item in both feedback files, mapped to what closes it.

### `2026-10-07-project-c.md`

| Item | Disposition |
|---|---|
| F-01 plan report swamped by constraints | S-12 (plan-build) |
| F-02 flaky unrelated test counted as a kill | S-05 |
| F-03, F-05, F-06, F-10, F-11, F-14, F-15, F-19, F-23 `SUMMARY.md` `Write` refused | S-01 |
| F-04 untracked `foundry.json` from an interrupted plan | S-08 + S-12 |
| F-07 renumbering ids after a split | S-06 |
| F-08, F-09 project footguns logged as Foundry feedback | S-12 (implement and summarize: `Codebase notes`). The footguns themselves are the project's, not Foundry's. |
| F-12, F-17, F-22 every mutant runs the full suite | S-04 |
| F-13, F-18 round-cap halts | Working as designed. S-11 removes the cause, and S-09 the hand edit. |
| F-16 fresh mutation samples never converge | S-11 |
| F-20 `CLAUDE.md` cap in a multi-flight repo | S-12 (plan-build), S-07 |
| F-21 `extraVerify` before its inputs exist | S-03 |

### `2026-10-07-project-d.md`

| Item | Disposition |
|---|---|
| F-01 constraints and `extraVerify` fixed for the whole flight | S-03 |
| F-02, F-06 `SUMMARY.md` `Write` refused | S-01 |
| F-03 the planner's commit hung on pinentry | S-02 + S-06 |
| F-04 `review_submit` half-applied on a commit failure | S-02 |
| F-05 `auto` fallback fired mid-flight | Working as designed. S-02 extends the same fallback to every commit, not only the run-start probe. |

### Operator request (2026-10-07)

| Item | Disposition |
|---|---|
| Opus as default planner, reviewer and summarizer; Sonnet implementer | S-10 |
| A signed flight's PR is ready and auto-merges unless breaking; a failed signing keeps it draft until a human re-signs | S-02, S-14 |

### Carried from the 0.4 plan's "Later" table

| Item | Disposition |
|---|---|
| cleanflate F-12, F-27 multi-phase projects | S-07, S-08, S-12. The flight-id prefix is declined (section 2). |
| cleanflate F-13, F-28 background jobs | Still deferred (section 2) |
| cleanflate F-01 provenance logging | S-13 (`writing-specs.md`) |
| cleanflate F-23 `Write` refused | S-01. Reproduced on non-first flights on 0.4.0, which was the condition for re-checking it. |

## Appendix B: files the planner should read

- `docs/feedback/2026-10-07-project-c.md` and
  `docs/feedback/2026-10-07-project-d.md`: the friction this
  release closes, with each agent's own words.
- `docs/plans/v0.4.md`: the house style for decisions, and the
  "Later" table this release partly pays down.
- `CONTRIBUTING.md`: the architectural rule, and the suite table.
- `docs/mcp-tools.md`: the contract every tool change must keep in step
  with.
- `mcp/server.mjs`: in particular `cfg()`, `validateConstraints`,
  `normalizeCommand`, `checkConstraints`, `verifyCommands`, `mutate`,
  `probeSigning`, `gitCommitIfChanged`, `reviewSubmit`, `summaryCommit`,
  `flightOptions` and `status`.
