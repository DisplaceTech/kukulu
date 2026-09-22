---
name: pull-feedback
description: "Read another project's .foundry/feedback.jsonl and write it into this repo's docs/feedback/ as a new, properly numbered file, so a real flight's friction can feed the next Foundry release plan. Invoke by name or as /foundry:pull-feedback."
allowed-tools: Read, Write, Bash, Glob
---

You are pulling one project's Foundry pipeline-friction log back into this
repo so it can feed a release plan. This is a maintainer tool, run
interactively by a human — not a pipeline stage, and not unattended. If the
user has not given you a path to the other project's checkout, ask for one;
this is the one skill in the plugin where asking a clarifying question is
appropriate.

## Steps

1. Read `<path>/.foundry/feedback.jsonl`. If it does not exist or is empty,
   say so and stop — there is nothing to pull. Never write to, delete, or
   modify anything under `<path>`; that project is not this run's to touch.
2. Parse every line as JSON. Skip any line that doesn't parse, and mention
   how many you skipped.
3. Determine the project name from `<path>`'s basename. If the path is `.`,
   ends in a generic name (e.g. `src`, `repo`, `app`), or is otherwise
   ambiguous, ask the user for a project name instead of guessing. Take
   today's date for the destination filename:
   `docs/feedback/<YYYY-MM-DD>-<project>.md`.
4. Before adding anything, read every existing file in `docs/feedback/*.md`
   and collect every entry's exact `at` timestamp string already recorded
   there (they appear in each `## F-<nn>` section's own text, alongside the
   Foundry-JSON fields already rendered). An entry from the log whose `at`
   already appears anywhere is a duplicate from an earlier pull — skip it
   silently, do not re-number it, and do not mention it beyond the final
   count.
5. For the entries that remain, sort by `at` and assign `F-<nn>` in that
   order. If the destination file already exists, continue its numbering
   (a second pull the same day appends `F-04` onward, it does not restart
   at `F-01`); a brand-new file starts at `F-01`.
6. Render each surviving entry as a `## F-<nn> — <short title>` section: a
   short title you derive from the entry's `stage` and `category` (e.g. "the
   `auto` signing fallback fired mid-run"), then one short paragraph built
   from the entry's `stage`, `category`, `round` and `message`. An
   auto-logged entry (`source: "auto"`) already reads as a full sentence —
   the message is the pipeline's own words — so little more than the
   heading and a restating sentence is needed. An agent-logged entry
   (`source: "agent"`) is already prose the agent wrote for exactly this
   purpose; quote it, do not paraphrase it, and do not invent detail the
   entry doesn't contain.
7. Write or append the file using the header shape
   [`docs/feedback/README.md`](../../docs/feedback/README.md) documents:
   name the plugin version the flight ran against (read it from the other
   project's installed plugin if you can determine it, otherwise write
   "version not determined" rather than guessing), and no "addressed in"
   line, since no release plan addresses it yet.
8. Commit the new or updated file in *this* repo only, as
   `docs: pull feedback from <project>`.
9. Report how many new entries were added and how many were skipped as
   duplicates.
