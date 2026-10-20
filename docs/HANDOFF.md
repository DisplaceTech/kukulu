# Handoff: Kūkulu 0.7.1 build

Branch `build/2026-10-20`, base commit `870405426ff3` (main), head `372c917` at the time of writing. 17 tasks: 17 done, 0 blocked, 0 skipped. `kukulu_verify` is green (lint, pre-commit, `npm test` with 3695 assertions, the guard self-test with 501 cases).

This is a patch release: no tool is added or removed, one optional config key is added (`policies.syncBase`), the version reads 0.7.1 everywhere.

## Blocked and skipped tasks

None.

## Interpretation choices

- P0-01: `docs/kukulu.json` (written by the planner) held literal macron letters in a constraint fixture, which failed `check-names` (lint, pre-commit, the plugin test). They were rewritten as JSON `\u` escapes; the parsed values are identical.
- P0-03: path-like option tokens are judged as before; the word clause now also covers every non-dash, non-pattern operand.
- P0-04: `--output` on `diff`, `log` and `show` is also read by the unique abbreviations `--outp` and `--outpu`, and stays a write target.
- P0-05: `tar` also counts `A` (catenate) and `--delete` as archive-writing; an extraction into a directory that lies under a protected path is denied as well as one that contains it; `rsync` and `tar` have their own rule block and were not added to `WRITE_FAMILY`, because their sources are only read.
- P0-06: the probe showed the BSD-only form was already denied (with `null` as its directory), so only the per-target directory was needed.
- P0-07: `test/harness.mjs`'s `buildBundle` gained `opts.cleanroomHash` (default none, the 0.7.0 shape) so the verifier cases can build pinned bundles.
- P1-01: a `###` subsection stays inside the flight's notes; only a line starting `## ` ends the section.
- P1-02: a constraint with no description prints `no description`; `.` and directory prefixes in `paths` or `exclude` cover `docs/PROGRESS.md`.
- P1-03: the stream assertion lives in `test/streams.mjs` and a clean-room assertion in `test/cleanroom.mjs`; `commitStaged` takes `opts.noPathspec` for the merge commit and its unsigned retry; the sync also runs in `kukulu_run_start` for review-fix rounds, since that call reuses the build branch.
- P1-05: `skills/summarize/SKILL.md` line 30 already tells the summarizer to write the manifest hash into an Attestation section, so the skill is untouched.
- P2-02: the Unreleased entries already carried their citations, so the heading was only renamed; `docs/feedback/2026-10-20-kukulu.md` (gitignored) got its `Addressed in` line and is not staged.

## ⚠️ ASSUMPTION keys

None added or tuned. `policies.syncBase` (default `true`) is an owner decision, not an assumption. `policies.archive`, `review.mutationFixRounds`, `cleanroom.idleGapHours` and the others keep their defaults.

## What a human must check

- Phase 0: in a live clean-room session with the working-tree plugin (`claude --plugin-dir .`), `git add docs/*` is allowed and `rsync evil/cleanroom.json docs/` is denied; CI is green on the pushed branch.
- Phase 1: on a throwaway flight with the working-tree plugin, commit to the base branch after the build branch is cut, then call `kukulu_task_next` and see the `chore: merge` commit.
- Phase 2: the draft PR targets `main`, and its ci, lint and site checks are green.
- Before merging, run `npm test` once on a machine with the signing agent the project uses.

## Codebase notes

- `test/fixtures/guard-cases.json` is indented with one space. Append fixtures with a script that loads and dumps with `indent=1` and no ASCII escaping, so the diff stays one block per case.
- During a merge `git commit -- <paths>` is refused, so the server's merge commit uses a no-pathspec commit; the clean-room log is put back byte for byte by `withRollback` when the merge is aborted.
- `kukulu_verify` output is large because every constraint result is listed; the useful part is `ok` and the `npm test` summary.
- The installed plugin (0.7.0) ran this flight, so none of the new behavior was active while it ran.

## For a reviewer

- The guard changes (P0-03 to P0-06) follow SPEC principle 1: a guard finding becomes a fix task only for a regression, a protected-path write or denied read with a spelling already named, or a missing command word. Other unmodelled spellings belong under Known-gap candidates.
- `checkpoint()` passes only the three `CHECKPOINT_KEYS` hashes; `cleanroomHash` is in genesis, state, gate check 3 and the manifest, never in a signed checkpoint.
- Gate check 3 skips the `mcp/cleanroom.mjs` comparison when a flight began on 0.7.0 and records `unpinned` in the passing gate entry.
