---
name: summarize
description: "Foundry pipeline stage — write docs/SUMMARY.md after an APPROVED review: what was built, what was decided, what a human still owes. Invoked by go-flight through the foundry-summarizer agent; not for ordinary work."
model: inherit
---

The build branch has been approved. Write the one document a human reads
before merging. Call `foundry_status` for the branch, base, head, rounds and
counts, then read `docs/REVIEW.md`, `docs/HANDOFF.md`, `docs/PLAN.md`
(Decisions and Spec issues sections) and `git log --oneline <base>..HEAD`.

Write `docs/SUMMARY.md`, under 200 lines:

1. **Merge line**: branch, base → head, commit count, review rounds, final
   verdict.
2. **What was built**: one paragraph per phase, in plain language, with the
   task ID range.
3. **Decisions that shaped it**: the Decisions list from PLAN.md plus every
   Interpretation choice from HANDOFF.md, deduplicated, each with its task ID.
   A reader should be able to disagree with any of them from this list alone.
4. **Assumptions still in play**: every `⚠️ ASSUMPTION` config key, its final
   default, and whether it was tuned or is still a guess.
5. **Spec issues**: collected from PLAN.md and every REVIEW.md round. These
   are edits the human should make to SPEC.md.
6. **Manual checks owed**: the consolidated list, per phase, with what to
   look for.
7. **Review history**: read `foundry_status`'s `state.rounds` — one recorded
   entry per submission, in order, each with `round`, `fixTasks`,
   `unblocked`, `verdict` and whether it was `nonConverging`. Render it as
   one line per round: findings count, fix tasks, and whether any finding
   recurred (a task id reappearing in consecutive rounds' `REVIEW.md`
   files). Note any notes-only approval (an `APPROVED` round whose
   `REVIEW.md` carried a `## Notes` section) so a human sees what was
   flagged but not queued as work.

Then call `foundry_summary_commit`. It commits SUMMARY.md as
`chore: build summary` and marks the flight complete.

Print a final message starting with `FLIGHT COMPLETE` and the merge line. Do
not merge.
