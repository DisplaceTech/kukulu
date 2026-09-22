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
8. **Pipeline friction**: anything the Foundry pipeline itself did that cost
   time — a tool refusal worked around, a wrong or ambiguous prompt, a
   stall, a permission prompt, anything an implementer or reviewer had to
   route around rather than the project itself being hard. Call
   `foundry_status` for `feedbackCount`; if it is greater than zero, read
   `.foundry/feedback.jsonl` directly (`cat` it — it is small, plain JSONL)
   and render one line per entry, in the order logged: stage, category, and
   the message. Write "None" when `feedbackCount` is `0` — that is a real,
   useful line, not an empty section to skip. This section is what a human
   pulls into [`docs/feedback/`](../../docs/feedback/) to feed the next
   release plan.

Write `docs/SUMMARY.md` with the `Write` tool. If the harness refuses it
(some builds tell subagents to return findings as text instead), write it
with a shell heredoc in one `Bash` call and continue — do not argue with the
refusal, and do not return the summary as text in your own reply; the file
on disk is what `foundry_summary_commit` reads (F-16).

Then call `foundry_summary_commit`. It commits SUMMARY.md as
`chore: build summary` and marks the flight complete.

Print a final message starting with `FLIGHT COMPLETE` and the merge line. Do
not merge.
