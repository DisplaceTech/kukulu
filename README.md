# Foundry

A Claude Code plugin that turns `docs/SPEC.md` into a merged-ready branch
without a human between stages: **plan → implement → review → fix → … →
summarize**, with a strong model doing the judgment work and a cheap one doing
the mechanical work.

```
/foundry:go-flight
   │  (sonnet, low)      asks the MCP what's next, spawns the stage agent, repeats
   ├─ foundry:planner     fable,  high   → docs/PLAN.md, PROGRESS.md, foundry.json, CLAUDE.md
   ├─ foundry:implementer sonnet, medium → one commit per task, unattended, Stop-hook guarded
   ├─ foundry:reviewer    fable,  high   → docs/REVIEW.md, APPROVED | CHANGES REQUESTED (+ R-tasks)
   │     └─ back to implementer while changes are requested (bounded by maxRounds)
   └─ foundry:summarizer  fable,  medium → docs/SUMMARY.md
```

Model and effort are set per agent in `agents/*.md`. Every state transition,
task selection, checkbox edit, log entry, verification run and bookkeeping
commit is done by the `foundry` MCP server, so the prose in the skills only
directs judgment, never mechanics.

## Install

The MCP server has no dependencies; only Node ≥ 18 and git are needed.

```bash
# try it for one session
claude --plugin-dir /path/to/foundry

# or install from the repo (it is its own marketplace)
claude plugin marketplace add ericmann/foundry
claude plugin install foundry@ericmann
```

Plugin skills are namespaced, so the entry point is `/foundry:go-flight`
(the bare `/go-flight` form does not resolve for plugin skills).

## Per-project use

```bash
mkdir myproject && cd myproject && git init -b main
mkdir docs
cp /path/to/foundry/templates/SPEC.md docs/SPEC.md   # then write the spec
# drop mockups, fixtures, diagrams next to it in docs/
git add -A && git commit -m "spec"

claude --permission-mode acceptEdits
> /foundry:go-flight
```

`acceptEdits` (or `bypassPermissions` on a throwaway box) matters: plugin
subagents cannot set their own permission mode, and an unattended implementer
that hits a permission prompt will sit there until the Stop-hook cap trips.
`docs/foundry.json`'s `verify` commands run through the MCP, not through the
model's Bash tool, so they never prompt.

You can also run stages by hand with the same model switching, exactly as
before: `/foundry:plan-build`, `/foundry:implement`, `/foundry:review-build`,
`/foundry:summarize`. Each skill's frontmatter carries its model and effort,
so invoking it switches for that turn and switches back after.

## Files the pipeline owns

| File | Written by | Read by |
|---|---|---|
| `docs/SPEC.md` | you | everyone |
| `docs/PLAN.md` | planner (+ reviewer appends `## Review fixes (round N)`) | implementer, reviewer |
| `docs/PROGRESS.md` | MCP only | guard hook, everyone |
| `docs/foundry.json` | planner | MCP (`verify`, `extraVerify`, `maxRounds`, `baseBranch`, `branchPrefix`) |
| `CLAUDE.md` | planner | implementer, reviewer |
| `docs/HANDOFF.md` | implementer | reviewer, summarizer |
| `docs/REVIEW.md` | reviewer | summarizer |
| `docs/SUMMARY.md` | summarizer | you |
| `.foundry/state.json` | MCP (committed) | `foundry_next` |
| `.foundry/implement.lock` | MCP (gitignored) | guard hook |

`PROGRESS.md` checkbox states: `[ ]` todo · `[~]` in progress · `[x]` done ·
`[!]` blocked · `[-]` skipped (dependency blocked).

## MCP tools

| Tool | Does |
|---|---|
| `foundry_status` | Everything on disk: docs present, counts, branch/base/head, lock, round, verdict |
| `foundry_next` | The state machine. Returns `{stage, agent, round, reason, prompt}` |
| `foundry_run_start` | Create/reuse `build/<date>` branch, arm lock, stamp PROGRESS, commit. Idempotent |
| `foundry_task_next` | Pick first `[~]` else `[ ]`, auto-skip blocked-dependency tasks, mark `[~]`, return PLAN text + dependency logs |
| `foundry_task_done` | Requires HEAD subject `<ID>:` and clean tree; mark `[x]`, log with sha, commit |
| `foundry_task_block` | `git reset --hard && git clean -fd`, mark `[!]`, log `BLOCKED:`, commit |
| `foundry_verify` | Run `verify` + matching `extraVerify` commands; return exit codes and tails |
| `foundry_run_finish` | Requires zero open tasks + HANDOFF.md; commit, push, draft PR, disarm lock |
| `foundry_review_submit` | `APPROVED` → commit. `CHANGES REQUESTED` → assign `R<N>-<nn>`, append to PLAN + PROGRESS, unblock, commit `review: round N` |
| `foundry_summary_commit` | Commit SUMMARY.md, mark flight complete |

`foundry_next` decision order: no SPEC → halt · no PLAN/PROGRESS/foundry.json
→ plan · open tasks → implement (halt if round > maxRounds) · lock present →
implement (finish handoff) · not implemented → implement · not reviewed →
review · APPROVED and not summarized → summarize · summarized → done.

## The guard hook

`scripts/implement-guard.sh` runs on `Stop` and `SubagentStop`. While
`.foundry/implement.lock` exists and `## Tasks` has `[ ]` or `[~]` lines, it
returns `{"decision":"block"}` naming the next task. It counts re-blocks in
the lock file and gives up at `FOUNDRY_GUARD_CAP` (default 500) so a wedged
run ends instead of spinning.

## Resuming

Everything is on disk and committed, so `/foundry:go-flight` can be re-run
from any point: `foundry_next` reads the state and continues. If a round cap
halts the flight, raise `maxRounds` in `docs/foundry.json` and clear `halted`
in `.foundry/state.json`.

## Adapting

- Change models/effort in `agents/*.md` (and the matching `skills/*/SKILL.md`
  frontmatter for manual invocation).
- Project-specific constraints belong in `SPEC.md` §3; the planner turns them
  into `## Constraints` in `CLAUDE.md`, which is what the reviewer checks
  first. Nothing project-specific lives in the plugin.
- `templates/SPEC.md` shows the headings the planner looks for.

## Testing the server

`npm test` runs `test/drive.mjs`, which drives the server over stdio through a
full spec → plan → build → block → skip → handoff → CHANGES REQUESTED → fix
round → APPROVED → summary cycle in a temporary git repo, and exercises the
guard hook along the way. `npm run lint` syntax-checks the server, the test and
the hook. CI runs both on Node 18/20/22. Set `KEEP_REPO=1` to inspect the temp
repo afterwards.
