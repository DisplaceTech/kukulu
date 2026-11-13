# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 10

**Verdict: CHANGES REQUESTED**

This round reviews the commits since the round-9 review (`8f82541`): R9-01 (`705a752`), R9-02 (`c5451f8`), and their progress and handoff commits.

R9-01 and R9-02 do most of what their plan entries asked. Every acceptance form of both tasks is decided as the plan requires at HEAD, including the five SPEC-required forms that round 9 found allowed. `git diff 8f82541..HEAD -- test/fixtures/guard-cases.json` changes exactly the ten fixtures SPEC A-02 names, each from `allowed` to `denied` with `protected path: .*`, and the R9-01 commit body lists all ten. The twenty-one new fixtures end in `(R9-01)` or `(R9-02)`, and no fixture was removed.

Two holes remain, both in `mcp/cleanroom.mjs`:

- A data-body line that reaches the depth limit is allowed, and that hides any write on the same line (finding 1).
- R9-02 drops the private-use marker characters from the input instead of refusing them. A dropped character can turn a word that is not `cd` into `cd`, which is a new write regression against the merge base (finding 2).

**`kukulu_verify` returned `ok: true`.**

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint` and `pre-commit run --all-files` pass.
- `npm test` passes all 15 suites, 4864 assertions, including `cleanroom` with 1490.
- Both guard self-tests pass, with 685 and 681 cases.

**`prChecks`** is `pending`, with no failing checks. That is not a finding.

Clean-room mode is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

**Method.** I ran every form below through three copies of `evaluate` with the template policy: the merge base `36df873`, the round-9 review commit `8f82541`, and HEAD. Each copy came from `git show <rev>:mcp/cleanroom.mjs` in a scratch directory. I checked bash's behaviour for finding 2 with real bash, using `realpath -m` in place of the `rm`.

## Findings

### 1. A data-body line that reaches the depth limit is allowed and hides the line's writes (`mcp/cleanroom.mjs`, `judgeBody`'s data-line loop, about line 1465)

Category 5 (spec drift), with a category-1 effect: a write the merge base denied is allowed now.

SPEC A-02 "Judgment of a body" says three things that bear on this:

- "Reaching the depth limit (more than four nested levels of substitution, `-c` or `eval`) anywhere denies … It never allows."
- About every body line being checked for writes: "The merge base denied these on body lines too, so no write it denied is allowed now."
- For a data body, only a denial whose reason starts `protected path:` counts.

The data-line loop keeps only `protected path:` denials. In write-only mode, `bashVerdict`'s depth denial (`command nested too deep: …`) is the one other denial a line can still produce. The loop discards it, but the segment loop has already stopped at it, so the later segments of that line are never judged.

| Command | `36df873` | `8f82541` | HEAD |
|---|---|---|---|
| `cat <<'EOF' > notes.txt` NL `echo $(echo $(echo $(echo $(echo $(echo hi))))); rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| the same with `&& rm -rf .kukulu/cleanroom` | denied | allowed | allowed |
| `cat <<'EOF' > notes.txt` NL `eval eval eval eval eval echo; rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cat <<'EOF' > notes.txt` NL five nested `sh -c` strings`; rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cat <<'EOF' > notes.txt` NL `echo $(echo $(echo $(echo $(echo $(echo hi)))))` NL `EOF` | allowed | allowed | allowed (SPEC: denied) |
| `cat <<'EOF' > notes.txt` NL `echo $(echo $(echo $(echo $(echo $(rm -rf .kukulu/cleanroom)))))` NL `EOF` | allowed | allowed | allowed (SPEC: denied) |

The unquoted-delimiter versions are denied with the depth reason, because the substitutions of an unquoted body are judged by every rule.

- **What breaks:** SPEC's "never allows" sentence and its "no write it denied is allowed now" guarantee both fail. One five-deep substitution at the start of a quoted body line hides that line's `rm -rf .kukulu/cleanroom`.
- **Minimal fix:** in the data-line loop, a denial whose reason starts `command nested too deep:` counts too, so that line denies with the depth reason.
- **Task:** R10-01.

### 2. Dropping U+E001 and U+E002 from the input turns a non-`cd` word into `cd` (`mcp/cleanroom.mjs`, `bashVerdict`, line 1391)

Category 1: a regression against the merge base. It is also category 6, because the interpretation recorded for R9-02 departs from its task.

R9-02's plan entry allowed two fixes: carry ownership by offsets ("never by characters input can hold"), or refuse a command that contains U+E001 or U+E002. The implementation took a third reading, recorded in HANDOFF: `command = command.replace(/[]/g, "")` at the top of `bashVerdict`.

Deleting a character from the command changes what the guard reads. `c<U+E002>d` is not a command bash knows, but the guard reads it as `cd`:

| Command | `36df873` | `8f82541` | HEAD |
|---|---|---|---|
| `c<U+E002>d build; rm -rf .kukulu/cleanroom` | denied | allowed | allowed |
| `c<U+E001>d build; rm -rf .kukulu/cleanroom` | denied | allowed | allowed |
| `ev<U+E002>al 'cd build'; rm -rf .kukulu/cleanroom` | denied | allowed | allowed |

With real bash, in a root that has a `build/` directory, the first and third rows print `cd: command not found` and `eval: command not found`. `realpath -m .kukulu/cleanroom` then resolves to `<root>/.kukulu/cleanroom`, so the `rm` would remove the clean-room log.

All three of A-02's triage conditions hold: the command is allowed under both readings, it writes a protected path, and bash runs that write. It is also a regression under principle 1, because the merge base denied it.

- **What breaks:** one invisible character in a command word moves the guard's idea of the directory, and a relative `rm -rf` then deletes the log.
- **Minimal fix:**
  - Take the plan's sanctioned alternative: deny a Bash command whose text contains U+E001 or U+E002 before any other Bash judgment. That check belongs at the `tool === "Bash"` entry, on the hook's own command, not inside the recursive `bashVerdict`, where the markers are legitimate.
  - The reason must be model-facing, for example `command contains U+E001 or U+E002, characters the guard reserves; remove them and retry`.
  - Without the drop, the two R9-02 marker fixtures are denied with the new reason. Their `reason` changes, and the commit body lists them.
- **Task:** R10-01.

## Spec issues

- **Known-gap candidates.** Each is outside SPEC A-02's shell-read cases or its triage, so none is queued.
  - **`openSubstitutionStart`'s stack.** It pops a `$(` frame at any `)`, a `case` pattern's `)` included. For example, `echo $(case x in a) bash <<EOF` … gives the outer owner. With the R9-01 write check on every body line, this can only cost a read.
  - **Carried:** the read-only gaps that SPEC lists ("Known gaps (reads only)").
  - **Carried:** an escaped quote inside ANSI-C quoting.
- **Carried from earlier rounds:**
  - `kukulu_flight_options` rewrites `docs/kukulu.json` with literal non-ASCII characters.
  - A-01's "a cluster that contains `i`" wording is broader than the getopt reading.
  - Nothing re-checks an open fix task against a mid-flight SPEC edit (feedback `63ae64c`).
- **The round budget.** `maxRoundsHard` is 10. This round's fix round is therefore the last the flight options allow: a round-11 review that requests changes halts the flight for the owner.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.
- **Rounds 6 to 9:** after push, the four PR checks pass: test on node 22, 24 and 26, and pre-commit.

## Notes

- **Mutation.** Round 10 is past `review.mutationFixRounds` (2), so survivors are advisory and never tasks. I ran seven mutants on the round-9 code, and six were killed by the two guard self-tests:
  - R9-01's depth denial turned back into `NO_ISSUES`: `five nested substitutions (R9-01)` failed.
  - The data-line loop run with every rule (`writeOnly = false`): `quoted heredoc read line does not mask write (R9-01)` failed.
  - R9-02's input drop disabled: both marker fixtures failed.
  - The substitution's cwd restore removed: four `(R9-02)` fixtures failed.
  - The `-c` string's cwd restore removed: the `bash -c` and `sh -c` fixtures failed.
  - `withBodies`' `extra.invented` skip removed: the six-line `(R8-01)` chain failed with the depth reason.
- **One partial survivor:** `stripHeredocs`' inner-owner selection (`openSubstitutionStart`) reverted to `splitRaw(head).at(-1)`. It survived both guard self-tests and was killed only by the `test/cleanroom.mjs` assertion `a heredoc inside a substitution is owned by the segment inside it (R9-02)`; I confirmed that kill. `withBodies` hands the body back to the substitution, which re-reads its owner, so no `evaluate` decision depends on the outer `shell` flag today.
- **Carried advisory survivors:**
  - `pipesIntoShellLater`'s `>|` exclusion;
  - `BARE_LETTER_EXEMPT`'s `^` anchor;
  - `conditionalEnd`'s closer boundary;
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape;
  - `expansionEnd`'s nesting and quote branches;
  - `validateMutation`'s `filterAt !== -1 &&`.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
