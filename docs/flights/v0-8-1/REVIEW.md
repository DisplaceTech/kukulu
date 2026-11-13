# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 11

**Verdict: APPROVED**

This round reviews the commits since the round-10 review (`9d35198`): R10-01 (`fdf5b5e`) and its progress, handoff and stage commits. The earlier commits of the branch were reviewed in rounds 1 to 10, and the files they touched have not changed since.

R10-01 closes both round-10 findings, and does it the way its plan entry asked.

- **Finding 1 (depth on a data-body line).** `judgeBody`'s data-line loop now counts a `command nested too deep:` denial as well as a `protected path:` one. In write-only mode those are the only two denials `bashVerdict` can still produce, so no other denial can stop a line's segments early and hide a write.
- **Finding 2 (reserved characters).** The `tool === "Bash"` entry of `evaluate` refuses a command that holds U+E001 or U+E002, before any other Bash judgment. The reason is the exact text the plan gave.

## Checks

**`kukulu_verify` returned `ok: true`.**

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint` and `pre-commit run --all-files` pass.
- `npm test` passes all 15 suites, 4873 assertions, including `cleanroom` with 1499.
- Both guard self-tests pass when run directly, with 693 and 689 cases.

**Fixtures.** I compared `test/fixtures/guard-cases.json` at `9d35198` and at HEAD by name.

- No fixture was removed.
- Only two existing fixtures changed: `marker U+E002 in input then heredoc rm (R9-02)` and `marker U+E001 in input then substitution rm (R9-02)`. Each changed only its `reason`, to `command contains U\+E00[12].*`, and the commit body lists both.
- The eight new fixtures end in `(R10-01)`.

**Forms.** I ran every acceptance form of R10-01 through three copies of `evaluate` with the template policy: the merge base `36df873`, the round-10 review commit `9d35198`, and HEAD. Every form is decided as the plan requires at HEAD. Every form the merge base denied for a write is denied at HEAD.

I also probed variants the plan did not list, and HEAD denies them all:

- five nested `sh -c` strings on a quoted data-body line, followed by `; rm -rf .kukulu/cleanroom`;
- the `eval` chain with `||`;
- a quoted heredoc inside `$(...)` whose line reaches the depth limit;
- a quoted heredoc holding `cd build` and then `rm -rf ../.kukulu/cleanroom`;
- read, network and word denials followed by a write on the same line;
- an ANSI-C `$'...\n...'` string with a nested heredoc, handed to `eval` or `bash -c`, followed by a write.

The prior-art data bodies that SPEC A-02 says are allowed are still allowed, `sed -n 1p .kukulu/cleanroom/log.jsonl` among them.

**Mutation.** Round 11 is past `review.mutationFixRounds` (2), so a survivor here is advisory and never a task. I ran three mutants on R10-01's code, each against both guard self-tests:

- **Depth clause removed from the data-line loop:** killed by four `(R10-01)` fixtures. The kill was confirmed on the unmutated tree.
- **Reserved-character refusal disabled:** killed by the three `(R10-01)` marker fixtures and the two R9-02 marker fixtures. The kill was confirmed on the unmutated tree.
- **`bashVerdict`'s internal marker drop removed:** survived (see Notes).

**`prChecks`** is `pending`, with no failing checks. That is not a finding.

**Clean-room mode** is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

**Out-of-scope paths.** Nothing under `docs/SPEC.md`, `docs/flights/`, `docs/plans/`, `site/` or `docs/site/` changed since the last review. No ignore, attributes, editor or CI file changed on the branch.

## Findings

None.

## Spec issues

- **Known-gap candidates** (none queued):
  - `openSubstitutionStart` pops a `$(` frame at any `)`, a `case` pattern's `)` included. With the per-line write check on every data body, this can only cost a read.
  - Carried: the read-only gaps SPEC lists ("Known gaps (reads only)").
  - Carried: an escaped quote inside ANSI-C quoting.
- **Carried from earlier rounds:**
  - `kukulu_flight_options` rewrites `docs/kukulu.json` with literal non-ASCII characters.
  - A-01's "a cluster that contains `i`" wording is broader than the getopt reading.
  - Nothing re-checks an open fix task against a mid-flight SPEC edit (feedback `63ae64c`).
  - The R6-03 note: the acceptance fixture `!(cat <<EOF` / `rm -rf .kukulu/cleanroom` / `EOF` / `)` is denied, not allowed. The owner should reconcile SPEC A-02 rule 6 with it.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.
- **Rounds 6 to 10:** after push, the four PR checks pass: test on node 22, 24 and 26, and pre-commit.

## Notes

- **Advisory survivor: `bashVerdict`'s internal marker drop** (`mcp/cleanroom.mjs`, about line 1396). With the drop removed, both guard self-tests still pass. The entry refusal now keeps U+E001 and U+E002 out of the input. The segment loop strips every marker before it builds a `-c` or `eval` string, and `withBodies` strips the body tokens. As far as I can find, no recursive call receives a marker, so the drop is defensive dead code. Its comment ("one in the input would pass for a marker, so it is dropped first") no longer describes a reachable case. Removing the drop, or rewording the comment, is a readability cleanup for a later flight.
- **Carried advisory survivors:**
  - `stripHeredocs`' inner-owner selection (killed only by the `test/cleanroom.mjs` R9-02 ownership assertion);
  - `pipesIntoShellLater`'s `>|` exclusion;
  - `BARE_LETTER_EXEMPT`'s `^` anchor;
  - `conditionalEnd`'s closer boundary;
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape;
  - `expansionEnd`'s nesting and quote branches;
  - `validateMutation`'s `filterAt !== -1 &&`.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
