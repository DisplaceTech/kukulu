**Not to be merged** until a human has run one 0.5.0 flight from the working tree (claude --plugin-dir .). Do not merge, tag or release.

# Handoff: Foundry 0.5.0 build

- Branch: `build/2026-10-07`
- Base commit: `a917779` (main when the run started; merge base `a91777982208`)
- Head commit: see `foundry_run_finish` (the handoff commit follows the last task commit `7e72b78`)
- Tasks: 28 done, 0 blocked, 0 skipped, 0 open of 28
- Full `foundry_verify` (lint, `pre-commit run --all-files`, all eleven suites: 2043 assertions) was green at P3-05; P3-06 changed nothing.

## Blocked and skipped tasks

None.

## Interpretation choices

- **P1-01.** The relative-link check in `test/plugin.mjs` now ignores inline code spans for every document, because PLAN.md quotes an example link inside backticks (the line a later task writes into the feedback files). The task named only the `foundry_*` name check for FLIGHT_ARTIFACTS; the link, box-drawing and reachability checks still cover them.
- **P1-04.** With `content`, the verdict check comes first and the content checks follow; without `content`, the old order (does-not-exist, then verdict) is kept so the existing tests still hold. `summaryCommit`'s rollback also covers `feedback.jsonl`.
- **P1-05.** `foundry_mutate`'s `killed` ignores skipped (inactive) commands. A skipped command is exactly `{ cmd, skipped }`.
- **P1-06.** The `{filter}` regex is the plan's literal (`/^[A-Za-z0-9_.:\\/-]{1,200}$/`), which admits a backslash and no quote; substitution uses a replacer function so `$` in a filter is literal.
- **P1-09.** `runHalt` and the stream-merge halt delete any stale `haltCap`, so only a round-cap halt is resumable. The wording of the refusal for a bound that does not lift the cap is mine.
- **P1-10.** `from` existence is checked by `validatePlanTexts` itself (`cfgFrom(raw, null)` there), so a bad `from` gives one `from` problem and not also a `config` problem. `waves[].streams` is the list of stream names. Suffixed ids are excluded from the sequence check. `test/plugin.mjs`'s config-key extraction now reads `cfgFrom`, since `cfg()` became a wrapper.
- **P1-11.** "A run has started" means a `Started:` stamp not beginning with `(`, or any task box that is not a space.
- **P1-12.** `foundry_flight_archive` adds only paths that exist and commits pathspecs known to HEAD or the disk (git rejects the rest); it does not read `baseBranch` because nothing in the tool needs it.
- **P1-13.** A failed `gh pr ready` reports `merge: "unavailable: gh pr ready failed: <line>"`; with `policies.pr: "none"` and an existing PR object, `merge` is `"skipped: policy"`; the awaiting-signing result also carries `push` and `pr`.
- **P1-14.** The result carries `resignPush`; `push` is the ordinary push that follows. If resign refuses after step 4 (still-unsigned commits), the on-disk `signingOverride` flag stays although the local config has been unset.
- **P2-01.** The new summary sections continue the existing list as 9 to 11. Status order in the final message: AWAITING SIGNING, AUTO-MERGE ON, READY, PR UNCHANGED.
- **P2-03.** The stray-artifact instruction sits in the finishing section but tells the planner to call `foundry_status` before writing.
- **P2-06.** Within one pull, an `at` that appears in two logs keeps one copy; earlier pulls are handled by the existing dedupe.
- **P3-01.** `docs/mcp-tools.md` was audited and already complete (every Phase 1 task updated it in the same commit), so only README and the test changed.
- **P3-03.** The existing template-rule test now builds a plan holding the `from` task, since `cfg()` refuses a `from` naming a task that is not in PLAN.md. `templates/constraints.example.json` was rewritten by a JSON writer, so its arrays are multi-line now.
- **P3-04.** The "addressed in" clause is folded into each feedback file's first paragraph; no other line under `docs/feedback/` changed.

## ⚠️ ASSUMPTION values

| Key | Default | Where it lives | Tuned? |
|---|---|---|---|
| `policies.archive` | `false` | `cfgFrom()` only | No. It needs real flights after release. |
| "at least three" further mutations per surviving file | 3 | `skills/review-build/SKILL.md` only | No. |
| 60-line `## Flight <slug> notes` budget | 60 | `skills/plan-build/SKILL.md` only | No. |

## What a human must check by hand

- **Phase 1 (server).** Run one real flight on a throwaway spec with the working-tree plugin (`claude --plugin-dir .`) and confirm the summarizer passes `content` and no `Write` refusal appears. Re-signing with a real signing agent (`foundry_pr_finalize({ resign: true })`) has only been tested against a fake gpg program: NOT VERIFIED (human).
- **Phase 2 (skills).** Read each changed `SKILL.md` top to bottom for contradictions with the tool reference. NOT VERIFIED (human).
- **Phase 3 (docs and release).** CI is green on this PR. NOT VERIFIED (human).
- The Mermaid diagrams in `docs/architecture.md` parse (checked with mermaid and jsdom in a scratch copy: 7 of 7); CI runs the same check.

## For a reviewer who has not seen this code

- This build changes the plugin itself. `mcp/server.mjs` stays one synchronous file with no dependencies; `no-sync-merge` holds: the only `gh pr merge` is one inline array containing `--auto`.
- `withRollback(paths, fn)` is the one place a failed commit is undone; every writing tool uses it. `commitStaged` is the one place `git commit` runs.
- Tool count went from 18 to 21 (`foundry_plan_commit`, `foundry_flight_archive`, `foundry_pr_finalize`); the count is in `test/plugin.mjs`, `test/protocol.mjs` and the first line of `docs/mcp-tools.md`.
- `cfg()` is now a wrapper over `cfgFrom(raw, planIds)`; `parseProgress()` over `parseProgressText(text)`.
- New state fields: `signingOverride`, `awaitingSigning`, `breaking`, `haltCap`, `archived`.
- The version is 0.5.0 in `package.json`, `.claude-plugin/plugin.json` and the server; CHANGELOG.md has the release entry. Nothing was tagged or released.
- The three skills the summarize flow now depends on (`foundry_summary_commit` with `content`, `foundry_flight_archive`, `foundry_pr_finalize`) are exercised only against a fake `gh` and a fake gpg in the tests.
- No friction was logged against Foundry itself during this build beyond the two entries the plan stage left in `.foundry/feedback.jsonl`.
