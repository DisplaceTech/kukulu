# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 7

**Verdict: CHANGES REQUESTED**

This round reviews the round-6 fix commits:

- `c4a5867` (R6-01): restores the `docs/kukulu.json` escapes and exempts the feedback log from check-names' bare-letter rule.
- `4a11151` (R6-02): judges a heredoc body as commands when it is piped into a shell.
- `b0d099f` (R6-03): the two readings.

It also covers their progress and handoff commits. R6-01 is clean. `git diff d9b19ea c4a5867 -- docs/kukulu.json` shows only the `maxRounds` and `maxRoundsHard` lines, and the file has no non-ASCII byte left. R6-03 matches SPEC A-02's "Two readings":

- the second reading runs only when the first skipped a `<<`;
- the `negated` marking is gone;
- the first reading copies a command-position `!(` through;
- every SPEC A-02 required fixture now exists.

R6-02 builds the pipe case only for a pipe on the operator's own line. SPEC's wording covers more than that, and the forms it misses are regressions from the merge base (finding 1).

**`kukulu_verify` returned `ok: true`.**

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint` and `pre-commit run --all-files` pass.
- `npm test` passes all 15 suites, 4811 assertions, including `cleanroom` with 1437. The 50 ms hook budget still holds.
- Both guard self-tests pass, with 640 and 636 cases.

**`prChecks`** is `pending`, with no failing checks. That is not a finding. Round 6's failing checks were caused by check-names, which now passes locally.

`git diff 36df873..HEAD -- test/fixtures/guard-cases.json` has no removed lines, so no existing fixture changed. All 13 new fixture names end in `(R6-02)` or `(R6-03)`.

Clean-room mode is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

I ran each guard form through three copies of `evaluate` with the template policy: the merge base `36df873`, the round-6 review commit `7c838e4`, and HEAD. Each copy came from `git show <rev>:mcp/cleanroom.mjs` in a scratch directory. I checked every form a finding depends on with real bash 5.2.21: `bash -c`, with `echo RAN` in place of the `rm`.

## Findings

### 1. A heredoc piped into a shell on a later line, or into a grouped shell, is allowed; it was denied at the merge base (`mcp/cleanroom.mjs`, `pipesIntoShell`, about line 742)

Category 1: a principle-1 regression of an always-protected write.

SPEC A-02 says a body is shell-read when "the owning segment pipes (`|` or `|&`) into a later segment of the same pipeline whose command word is one of those shells". `pipesIntoShell` scans only the rest of the operator's own line, `command.slice(from, eol)`. R6-02 recorded this as its interpretation, but it is narrower than SPEC. A bash pipeline continues past a trailing `|` and past a backslash-newline, and the heredoc body is read in between. A grouped stage also has a shell command word: `(bash)` and `{ bash; }` reduce to `bash` through the same `stripGrouping` that `bashReading` applies to every segment.

Every row below was denied at the merge base and is allowed at HEAD, and bash prints `RAN` for each:

| Command | `36df873` | `7c838e4` | HEAD |
|---|---|---|---|
| `cat <<EOF \|` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `bash` | denied | allowed | allowed |
| `cat <<EOF \` NL `\| bash` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cat <<EOF \| (bash)` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cat <<EOF \| { bash; }` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |

- **What breaks:** an implementer in a clean-room flight can delete the clean-room log, or overwrite `docs/cleanroom.json` or `.kukulu/state.json`, by putting the shell stage of the pipe on the line after the body, or inside `( )` or `{ }`.
- **Minimal fix:** decide pipeline membership from the whole pipeline, not from the operator's line:
  - a backslash-newline is a blank;
  - a `|` or `|&` that ends the line holding the operator (blanks after it skipped) continues the pipeline on the first line after the last body that line opened;
  - each later stage's command word is taken after the grouping strip `bashReading` uses (`stripGrouping`), then through `commandWord` as now.

  The pipeline still ends at the first unquoted `;`, `&&`, `||` or `&`, or at a newline that does not follow a `|`.
- **Fixtures:** the four rows above, all denied. These stay allowed:
  - `cat <<'EOF' | grep x` with the priorArt JSON body;
  - `cat <<'EOF' |` NL priorArt JSON NL `EOF` NL `grep x`;
  - the existing `cat <<EOF | bash -c 'echo hi'` fixture.
- **Task:** R7-01.

## Spec issues

- **SPEC A-02's "two readings" safety argument does not hold, and the owner must decide this before another round.**
  - **The argument.** SPEC says: "The second reading never hides a real operator. An operator it invents can only turn lines into data that the first reading still judges as commands. A hole now needs both readings to be wrong about the same `<<`."
  - **Why it fails.** The two readings can be wrong about *different* `<<`s:
    - The first reading hides the real operator `<<1` under rule 8's digits-only case.
    - The second reading invents an operator out of an earlier skipped `<<` (arithmetic, a comment). That operator's unterminated body swallows the rest of the command, real heredoc included, as data.
  - **Forms allowed at HEAD** (and at the merge base). Bash prints `RAN` for each:
    - `echo $((1<<3))` NL `cat <<1 > x.txt` NL `it's` NL `1` NL `rm -rf .kukulu/cleanroom`
    - `# a << b` NL `cat <<1 > x.txt` NL `it's` NL `1` NL `rm -rf .kukulu/cleanroom`
  - **The triage conflict.** Both forms meet all three of A-02's triage conditions: allowed under both readings, a protected-path write, and real bash runs it. They are SPEC's own required fixture `cat <<1 > x.txt` … with one line in front. But HEAD implements both readings exactly as SPEC words them, so a fix needs a SPEC change, and I have not queued a task.
  - **A proposed wording that restores the stated property:** "in the second reading, the body of an operator the first reading skipped is judged as commands (with both readings, recursively), not by the body rules."
    - With that wording, an invented operator can only add commands to judge, never turn commands into data.
    - It would over-deny only where a skipped `<<`'s supposed body holds a denied command, which is a known-gap class.
    - I checked `echo $((1<<3)) > a.txt` NL `cat > build/k.json <<'EOF'` NL priorArt JSON NL `EOF` by hand: under the proposed rule it would stay allowed, because the nested reading treats the quoted body as data.
- **R6-03's plan text, not SPEC, held the contradiction.** PLAN R6-03 listed `!(cat <<EOF` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `)` as allowed. Round 6's review wrote that, and it was wrong:
  - SPEC rule 6 has the first reading copy a command-position `!(` through, so its `rm` line is judged and denied.
  - SPEC A-02 does not list the form among its allowed fixtures.
  - Under SPEC's triage it is an over-denial, which makes it a known-gap candidate.

  The implementer was right to keep it denied and to log the conflict. HANDOFF's suggestion that the owner reconcile SPEC rule 6 with it needs no SPEC change.
- **Carried from round 6:**
  - `kukulu_flight_options` rewrites `docs/kukulu.json` with literal non-ASCII characters (`JSON.stringify`).
  - Nothing re-checks open fix tasks after a mid-flight SPEC edit.
  - A-01's "a cluster that contains `i`" wording is broader than the getopt reading of the `-e`/`-f`/`-l` values.
- **Known-gap candidates.** Each was denied at the merge base, is allowed at HEAD, and bash runs it. Each lies outside SPEC A-02's two named shell-read cases, which require one of the five shells "with no `-c`". Widening those cases is the owner's call, so none is queued:
  - **A `-c` string that is itself a shell reading stdin:** `cat <<EOF | bash -c bash` NL `rm -rf .kukulu/cleanroom` NL `EOF`.
  - **`.` or `source` of stdin:** `cat <<EOF | . /dev/stdin` NL `rm -rf .kukulu/cleanroom` NL `EOF`.
  - **A body written to a file that a later segment runs:** `cat <<EOF > s.sh` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `bash s.sh`. This is the existing `indirect` class.
  - **Carried, allowed at the merge base too:** an escaped quote inside ANSI-C quoting, `echo $'\''; rm -rf .kukulu/cleanroom # '`.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.
- **Round 6:** after push, the four PR checks pass: test on node 22, 24 and 26, and pre-commit.

## Notes

- **Mutation.** Round 7 is past `review.mutationFixRounds` (2), so survivors are advisory and never tasks. I ran seven mutants on the round-6 files. Five were killed:
  - The pipe clause removed: the four `(R6-02)` denials failed.
  - The `|&` skip removed: the `|&` fixture failed.
  - The second reading never run: the R5-01 apostrophe fixtures and the `(R6-03)` digits and `x=$(!(` fixtures failed.
  - The digits rule applied in both readings: the `cat <<1` fixture failed.
  - The pipe and grep `stripHeredocs` assertions were added by R6-02. I did not mutate them separately.
- **Two survivors:**
  - **`bashVerdict`'s reset of `shellCwd` and `previousCwd` before the second reading (`mcp/cleanroom.mjs`, about line 1332).** Without the reset, a command that `cd`s and then needs the second reading starts that reading in the wrong directory. Example: `cd build` NL `cat <<1 > x` NL `it's` NL `1` NL `rm -rf ../.kukulu/cleanroom`. HEAD denies it. A scratch copy without the reset resolves the `rm` against `build/build` and allows it. No fixture pins it.
  - **`BARE_LETTER_EXEMPT`'s `^` anchor in `scripts/check-names.mjs`.** Without it, a nested `x/.kukulu/feedback.jsonl` would be exempt too. No test covers a nested path.
- **Readability.** `bashVerdict` calls `stripHeredocs(command, false)` a second time only to read `skipped`, although `bashReading` has just computed it. Returning `skipped` from the first reading would save one scan. The hook budget holds either way.
- **Carried advisory survivors** (never tasks):
  - `conditionalEnd`'s closer boundary;
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape;
  - `expansionEnd`'s nesting and quote branches;
  - `validateMutation`'s `filterAt !== -1 &&`.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
