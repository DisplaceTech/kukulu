# Flight feedback

Stumbling blocks a real flight hit, written down so the next release plan
can fix them instead of the next flight hitting them again. This is the
compound-engineering loop: a running flight calls `foundry_feedback_log`
the moment something is Foundry's own fault (a tool refused, a prompt was
ambiguous, a stall needed a workaround), which appends one JSON line to
that project's `.foundry/feedback.jsonl` and commits it immediately — so
the entry survives even if the flight never reaches `summarize`. A
maintainer then runs `/foundry:pull-feedback` against that project's
checkout to turn its log into a new, properly numbered file here, and a
release plan under [`../plans/`](../plans/) maps every item in it to a
task.

## Convention

- One file per flight: `<date>-<project>.md`, named for when the flight
  ran and what it built, not for the Foundry version it ran against (that
  goes in the file's own header).
- Items are numbered `F-01`, `F-02`, … in the order they were hit, newest
  entries at the bottom of the file. Never renumber a past item, even if a
  later flight's `F-` numbering in a different file starts over at 1 — the
  id only has to be unique within its own file.
- Each item states what happened, why, and (where there is one) the
  workaround used at the time. A suggestion for the fix is welcome but not
  required; the release plan is where the fix actually gets decided.
- The file's header names the plugin version the flight ran against and,
  once one exists, the release plan that addressed it — see
  [`2026-09-21-project-a.md`](./2026-09-21-project-a.md) for the shape.

## Pulling a project's log

`.foundry/feedback.jsonl` (JSONL, one entry per line: `at`, `stage`,
`round`, `category`, `message`, `source`) is the durable source a flight
writes as it runs. `/foundry:pull-feedback` reads a given project's copy of
that file and dedupes against every file already in this directory by each
entry's exact `at` timestamp — an entry pulled once and pulled again is
skipped silently, so re-running a pull against the same project is always
safe.

## What happens to a feedback file

A release plan (`docs/plans/vX.Y.md`) works through a feedback file
top to bottom, mapping every item to the task that closes it in an
item-to-task table. Nothing here obligates a fix — an item can turn out to
be a one-off, or the right call can be "leave this as-is, and say why" —
but every item gets a decision on record, not silence.
