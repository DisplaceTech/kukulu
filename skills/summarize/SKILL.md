---
name: summarize
description: "Kūkulu pipeline stage — compose the summary after an APPROVED review and commit it through kukulu_summary_commit: what was built, what was decided, what a human still owes. Invoked by go-flight through the kukulu-summarizer agent; not for ordinary work."
model: inherit
---

The build branch has been approved. Write the one document a human reads before merging. Call `kukulu_status` for the branch, base, head, rounds and counts, then read `docs/REVIEW.md`, `docs/HANDOFF.md`, `docs/PLAN.md` (Decisions and Spec issues sections) and `git log --oneline <base>..HEAD`.

Compose the summary, under 200 lines, as one document in memory. Do not write it to disk yourself (see below):

1. **Merge line**: branch, base → head, commit count, number of reviews (the length of `state.rounds`; review N is the one stamped `Round: N`), final verdict.
2. **What was built**: one paragraph per phase, in plain language, with the task ID range.
3. **Decisions that shaped it**: the Decisions list from PLAN.md plus every Interpretation choice from HANDOFF.md, deduplicated, each with its task ID. A reader should be able to disagree with any of them from this list alone.
4. **Assumptions still in play**: every `⚠️ ASSUMPTION` config key, its final default, and whether it was tuned or is still a guess.
5. **Spec issues**: collected from PLAN.md and every REVIEW.md round. These are edits the human should make to SPEC.md. Copy the `Known-gap candidates` bullets from the final REVIEW.md, verbatim, into SUMMARY.md's `## Spec issues` under the same label.
6. **Manual checks owed**: the consolidated list, per phase, with what to look for.
7. **Review history**: read `kukulu_status`'s `state.rounds` — one recorded entry per submission, in order, each with `round`, `fixTasks`, `unblocked`, `verdict` and whether it was `nonConverging`, plus its `sources` counts (how many fix tasks came from `review`, `mutation` and `blocked`). Render it as one line per round: findings count, fix tasks, and whether any finding recurred (a task id reappearing in consecutive rounds' `REVIEW.md` files). Note any notes-only approval (an `APPROVED` round whose `REVIEW.md` carried a `## Notes` section) so a human sees what was flagged but not queued as work.
8. **Pipeline friction**: anything the Kūkulu pipeline itself did that cost time — a tool refusal worked around, a wrong or ambiguous prompt, a stall, a permission prompt, anything an implementer or reviewer had to route around rather than the project itself being hard. Call `kukulu_status` for `feedbackCount`; if it is greater than zero, read `.kukulu/feedback.jsonl` directly (`cat` it — it is small, plain JSONL) and render one line per entry, in the order logged: stage, category, and the message. Write "None" when `feedbackCount` is `0` — that is a real, useful line, not an empty section to skip. This section is what a human pulls into [`docs/feedback/`](../../docs/feedback/) to feed the next release plan.

Add these to the list, after the sections above:

9. **Suggested CLAUDE.md additions**: every item under `## Codebase notes` in `docs/HANDOFF.md` (project lessons such as a framework footgun), lifted as proposed additions to the project's `CLAUDE.md`. Write "None" when there are none.
10. **Advisory mutation survivors**: the survivors the reviewer put under `## Notes` in `docs/REVIEW.md` as lying outside the round's diff, carried over verbatim. Write "None" when there are none.
11. **Breaking call**: one line, `Breaking: yes|no — <reason>`. It is `yes` when `docs/SPEC.md` or `CHANGELOG.md` lists breaking changes for this work, or when the flight changed a public interface, a config default, or behavior an existing user relies on. When unsure, it is `yes`.

Pass the whole document as `content` to `kukulu_summary_commit`. The tool writes `docs/SUMMARY.md` itself and commits it as `chore: build summary`, marks the flight complete, and returns `pr` (the branch's pull request as `{ url, state, draft, base }`, or `"none"`, `"skipped: policy"` or `"unknown: <why>"`) and `archive`. Never call `Write` or `Edit`, or use a shell redirect, for `docs/SUMMARY.md`: the tool does it, and a refused `Write` is then not a problem you can have. A PR object with `expectedBase` targets the wrong branch; say so.

**Contamination score.** When `docs/kukulu.json` configures `cleanroom.similarity`, call `kukulu_similarity` once, after `kukulu_summary_commit` and before anything that archives. It scores inside the server and returns numbers only. Add a `## Contamination score` section to your summary text: the `verdict` line, then one line per metric of each test pair, verbatim from the result's rows (or from `docs/SIMILARITY.md`), and commit the longer text by calling `kukulu_summary_commit({ content })` a second time. A refusal goes in the Pipeline friction item, and the flight goes on.

**Attestation.** When `kukulu_status` reports a non-null `cleanroom`, call `kukulu_attest` once, after `kukulu_similarity` (when it is configured, so its score is in the bundle) and before `kukulu_flight_archive`. Pass `evidence` only for repo-relative, tracked files the spec or the handoff names as evidence (conformance results, fuzz logs); otherwise pass nothing. It writes `docs/attestation/`, runs the bundle's own verifier and commits the bundle only if that passes. Add an `## Attestation` section to your summary text: the directory, the manifest hash (`manifest`), the signer's `fingerprint`, and the verifier's result line (`verify-attestation: PASS`, plus the number of coverage gaps it printed as notes), then commit the longer text by calling `kukulu_summary_commit({ content })` once more. A refusal goes in the Pipeline friction item, and the flight goes on; say in the summary that no bundle was made.

If the result has `archive: true` (`policies.archive`), call `kukulu_flight_archive` with no arguments. It moves the flight's artifacts into `docs/flights/<slug>/`. If it refuses, print the refusal and go on to the last call anyway.

Your last tool call is `kukulu_pr_finalize({ breaking })`, with `breaking` true or false from your Breaking call. It marks the draft PR ready and, unless the flight is breaking, turns on auto-merge; it never merges anything itself. Never pass `resign`: re-signing history is for a human to ask for, after unlocking their signing agent, and no agent may ask on its own.

Print a final message starting with `FLIGHT COMPLETE`, then the merge line, then exactly one status:

- `AWAITING SIGNING` followed by the tool's `next` text verbatim, when `awaitingSigning` is set;
- otherwise `AUTO-MERGE ON` when `merge` is `"enabled"`;
- otherwise `READY` when `ready` is true;
- otherwise `PR UNCHANGED: <merge>`.

Add the PR's url and state, or that there is none. Do not merge.
