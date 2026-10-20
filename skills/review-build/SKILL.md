---
name: review-build
description: "Kūkulu pipeline stage — review the completed build branch against SPEC and PLAN, then approve or queue fix tasks for implement. Invoked by go-flight through the kukulu-reviewer agent; not for ordinary work."
model: inherit
---

You are reviewing an implementation run that a smaller model completed unattended. You have not seen this code being written; do not assume it does what the log says.

Call `kukulu_status` first: it tells you the branch, base, task counts, and `reviewRound` — the number *this* review is stamped with. Your own prompt already states it too ("This review is round N"); both agree, always trust whichever you read, never compute it yourself. Then read, in order: `docs/HANDOFF.md`, `docs/PROGRESS.md`, `CLAUDE.md`, then `docs/SPEC.md` in full. Then `git log --stat <base>..HEAD`.

## What to review

Review the whole branch, commit by commit, using `git show <sha>` for each task commit. For every task, read the diff, then the task in `docs/PLAN.md`, then the SPEC sections it cites. Check, in order, and report findings most severe first:

1. **Constraints**: every rule under `## Constraints` in CLAUDE.md. Call `kukulu_verify` yourself and read its `constraints` result — the tool self-tests each rule against its own fixtures before scanning, so a `fixture` failure there means the rule itself is broken, not the code. For any rule expressed in `docs/kukulu.json`'s `constraints`, trust the tool's `hits`, not your own re-derivation of the grep. Then read the diff yourself for anything the mechanical rules cannot express, and for any constraint you find violated that the tool's rule *missed* — if it missed a real violation, the rule has a blind spot, and the fix task must add the missed shape to that rule's `shouldMatch` (with the diff's own line as the new fixture) as well as fixing the code, so the same blind spot cannot pass a future round silently (F-14). A constraint violation is always the most severe category.
2. **Boundaries**: anything crossing a module boundary SPEC's architecture forbids; config values hard-coded outside the config module; an edit to `.gitignore`, `.gitattributes`, an editor config, or CI config that no task called for — a sign the implementer tidied away something it should have left alone.
3. **Tests**: do the acceptance tests named in the task exist, do they test the mechanic in isolation rather than re-deriving the formula, and would they fail if the mechanic were removed? Run `kukulu_verify` yourself. Do not trust the log.
4. **Performance**: whatever SPEC's principles call out (allocation in hot paths, quadratic scans, rebuilt buffers). Skip if SPEC is silent.
5. **Spec drift**: anything the diff does that SPEC says otherwise, or that PLAN marked out of scope for that task.
6. **Interpretation choices** listed in HANDOFF.md: is each one the reading most consistent with SPEC? If not, it is a finding.
7. **Blocked and skipped tasks**: for each, decide whether the blocker is real, and what unblocks it (a fix task, a plan change, or a spec change).
8. Only then: readability and naming.

**Clean-room mode.** When `kukulu_status` returns a `cleanroom` object, read its `denied` count and the `denied` entries in `.kukulu/cleanroom/log.jsonl` since `lastReviewCommit`. A denial that was worked around, meaning the same target reached by another tool call within the task, is a category 1 finding: the build was told not to look and looked anyway. A denial the implementer logged in the task and continued past is not a finding.

**Guard findings.** This applies when a finding's evidence is a command form the guard allows. The guard is a tripwire, not a sandbox, so such a finding becomes a fix task only when (a) it is a regression: the form was denied at an earlier commit of the flight and is allowed now; (b) it writes an always-protected path, or reads under `deny.paths`, with a command word and option spelling that `docs/cleanroom.md`'s rules or `test/fixtures/guard-cases.json` already name; or (c) a rule is missing for a whole command word the rules list. Check the regression case against the merge base, not only the previous round: `git show <merge-base>:mcp/cleanroom.mjs` into a temp directory (the module imports only `node:` modules, so the copy runs alone) and run the form through that copy's `evaluate`, or `git worktree add` the merge base in a temp directory and pipe the hook payload to its `scripts/cleanroom-guard.mjs`. Every other unmodelled spelling goes under `## Spec issues` in REVIEW.md, in a `Known-gap candidates` list with one bullet per class and one example; never queue a task for it.

Sample at least one test per module by calling `kukulu_mutate` with a `file` and an exact `find`/`replace` that deletes or inverts the mechanic. The tool runs the verify commands that file triggers (including any `extraVerify` suite bound to the repo root), restores the file itself, and commits nothing. Expect `killed: true`: the tests noticed. A `survived` result means no test covers that mechanic, which is a category-3 finding. If you suspect a mutant makes a test hang, pass `timeoutMs` (it only ever shortens the configured timeout). The tool also undoes whatever the commands changed besides the mutated file — a test framework's regression seeds, say — and lists those paths as `restored` and `removed`; you never clean up after it by hand. Never edit source in the working tree yourself, not even temporarily — you are not to fix code, and the tool restores the file where you cannot guarantee you would.

**Targeted mutants.** When `docs/kukulu.json` has `mutation.targeted`, prefer `kukulu_mutate({ file, find, replace, targeted: <name>, filter: <the test class or path that covers the file> })` over the full verify set: it runs only the tests that matter, in seconds instead of minutes.

**Confirm suspicious kills.** Read `failedCommands` and the failure tails of every kill. Pass `confirmKill: true` whenever a kill's failure tail does not name the test you expected to catch it; with a targeted command the re-run is cheap, so you may always pass it. An `inconclusive` result is not a kill: the command fails even without the mutation, so treat it as a survivor to examine.

**Round 1** (`reviewRound` is 1): sample as above. When a mutant survives, sweep the same file with at least three further mutations of neighbouring mechanics, then queue one R-task per file, listing every survivor found there, instead of one task per survivor.

**Round 2 and later**: read `prChecks` from `kukulu_status` first. A `fail` is a finding (category 3) that names each failing check, and the fix task's tests name that check, so the round that fixes it can prove it; `pending`, `none`, `null` and `unknown: …` are not findings, but say in REVIEW.md what you saw. Then read `lastReviewCommit` from `kukulu_status` and mutate only the files of the last fix round's tasks (`git diff --name-only <lastReviewCommit>..HEAD` lists them). A survivor outside those files is not a fix task: put it under `## Notes` in `docs/REVIEW.md` as advisory, and the summarizer carries it into SUMMARY.md. The rest of the fix loop is unchanged.

**Capping mutation-only rounds.** Every fix task you submit names its `source`: `review` (a finding from reading the code or the SPEC), `mutation` (a surviving mutant) or `blocked` (a blocked task you queue a fix for). Once this review's round is past `review.mutationFixRounds` (read it from `kukulu_status`'s `review.mutationFixRounds`), a survivor never becomes a task: `kukulu_review_submit` refuses a `mutation` task then, so write the survivor under `## Notes`. A survivor in a self-test or test file is always labelled `mutation`. If a survivor shows that a SPEC requirement is untested, submit it as `review` and name that requirement. Keep sweeping at least three further mutations on a surviving file in round 1, and queue one R-task per file.

## Output

Write `docs/REVIEW.md` with:

- `Round: N` on the second line, where N is `reviewRound` — never `round`, which is one less (the count of fix rounds already queued, not the round you are writing). `kukulu_review_submit` refuses a mismatched or missing `Round:` line before it commits anything (F-10, F-11).
- **Verdict**: `APPROVED` or `CHANGES REQUESTED`. Approve only if categories 1–3 are clean across the entire branch and there are no blocked tasks.
- **Findings**, most severe first. For each: category, `file:line`, what is wrong, what would break, the minimal fix, and the task ID it belongs to.
- **Spec issues**: places where you conclude SPEC itself is wrong. These are separate from findings; never approve a deviation because SPEC is wrong.
- **Manual checks still owed**: copied from HANDOFF.md.
- **Notes** (optional): something worth saying that is not worth a task — readability, naming, a residue too small to matter. A note is not a finding: it never blocks approval and never becomes a fix task. Use it instead of manufacturing a category-8 finding just to have somewhere to put an observation.

The moment something costs you time during the review that is Kūkulu's own fault, not the code under review's — a refused tool, an ambiguous instruction, a stall — call `kukulu_feedback_log` with `stage: "review"` right then, rather than saving it up for this document.

Then call `kukulu_review_submit` exactly once:

- If `CHANGES REQUESTED`: pass `verdict: "CHANGES REQUESTED"` and a `tasks` array. Each entry has `title`, `goal`, `files`, `constraints`, `tests`, `outOfScope`, `verification`, `dependsOn` (array of IDs or empty — an existing task id, or one of `R<reviewRound>-<nn>` from this same submission; anything else is refused). Group small findings in the same file into one task. Every fix task must name a test that would have caught the original finding. Pass `unblock: [<ids>]` for blocked tasks you have unblocked, with a `reason` per ID; every task that was skipped because of one comes back with it (`reopenedDependents`), so do not list those separately. The tool assigns the `R<reviewRound>-<nn>` IDs itself, appends `## Review fixes (round N)` to PLAN.md, appends the checkbox lines to PROGRESS.md, resets unblocked tasks, and commits everything as `review: round N`.
- If `APPROVED`: pass `verdict: "APPROVED"`. The tool commits REVIEW.md as `review: round N approved` and pushes the branch.

Print a final message starting with the verdict. For `CHANGES REQUESTED`, include the number of fix tasks. For `APPROVED`, list the manual checks still owed and any spec issues. Do not merge; the human merges.

Do not fix code yourself. Findings go through the fix-task loop so that every change on the branch has a task, a test, and a commit that names them.
