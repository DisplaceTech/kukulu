# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 8

**Verdict: CHANGES REQUESTED**

This round reviews the commits since the round-7 review (`766a5d2`):

- `61b3589`: the owner's SPEC A-02 edit. In the second reading, an invented operator's body is now judged as commands, and two new denied fixtures are required.
- `4029e37` (R7-01): pipeline continuation and grouping in `pipesIntoShell`.
- their progress and handoff commits.

R7-01 does what its plan asked. All four goal forms are denied at HEAD and were denied at the merge base `36df873`. So are `|&`, a blank line, `<<-` with tabs, two heredocs on one line, a second pipe, and `\` NL `bash` after `|`. The allowed forms stay allowed. `git diff 36df873..HEAD -- test/fixtures/guard-cases.json` removes no line, and the five new fixtures end in `(R7-01)`.

The owner's SPEC edit landed after R7-01 had been queued with that very change out of scope. Nothing in the round implemented it (finding 1). Reading the body-judgment code against the merge base also turned up a regression older than round 7 (finding 2), and more pipe-case forms that R7-01's stage model does not reach (finding 3).

**`kukulu_verify` returned `ok: true`.**

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint` and `pre-commit run --all-files` pass.
- `npm test` passes all 15 suites, 4818 assertions, including `cleanroom` with 1444.
- Both guard self-tests pass, with 645 and 641 cases.

**`prChecks`** is `pending`, with no failing checks. That is not a finding.

Clean-room mode is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

I ran every form below through three copies of `evaluate` with the template policy: the merge base `36df873`, the round-7 review commit `766a5d2`, and HEAD. Each copy came from `git show <rev>:mcp/cleanroom.mjs` in a scratch directory. I checked each with real bash 5.2.21, using `echo RAN` or `realpath` in place of the `rm`.

## Findings

### 1. SPEC A-02's invented-operator exception is not implemented, and its two required fixtures are missing (`mcp/cleanroom.mjs`, `stripHeredocs` and `bashReading`, about lines 600 and 1389)

Category 5, spec drift. It is also category 1, because principle 1 applies to a protected-path write.

Since `61b3589`, SPEC A-02 says: "In the second reading, the body of an operator that the first reading skipped is judged as commands, as a shell-read body is, never as data." It adds two required denied fixtures:

- `echo $((1<<3))` / `cat <<1 > x.txt` / `it's` / `1` / `rm -rf .kukulu/cleanroom`
- the same lines after `# a << b`

Both forms are allowed at `36df873`, at `766a5d2` and at HEAD, and bash prints `RAN` for both. All three of SPEC's triage conditions hold:

- the command is allowed under both readings;
- it writes a protected path;
- real bash runs it.

At HEAD, `stripHeredocs(command, true)` gives every operator `shell` from `ownsShell` or `pipesIntoShell` alone, so the invented `<<3` takes the rest of the command as a data body.

- **What breaks:** an implementer in a clean-room flight can delete the clean-room log with one arithmetic or comment line in front of SPEC's own `cat <<1` fixture.
- **Minimal fix:** the first reading records where each `<<` it skipped starts, both the `<<` inside a copied region and the digits-only case. The second reading marks the body of an operator at one of those offsets as shell-read, so `bashReading` judges it with `bashVerdict`, which applies both readings.
- **The depth cap:** `bashVerdict` returns `NO_ISSUES` when `depth > 4`. A body judged at `depth + 1` lets a chain of five or more invented operators reach that cap:

  ```text
  echo $((1<<3))
  echo $((1<<3))
  echo $((1<<3))
  echo $((1<<3))
  echo $((1<<3))
  cat <<1 > x.txt
  it's
  1
  rm -rf .kukulu/cleanroom
  ```

  Each level peels one line. Such a chain must stay denied. Two ways to get there:

  - judge an invented operator's body at the same depth (it is strictly shorter than the command, so the recursion still ends);
  - make the cap deny instead of allow.
- **Task:** R8-01.

### 2. A shell-read heredoc body is judged in the directory where the command started, so an earlier `cd` is ignored (`mcp/cleanroom.mjs`, `bashReading`, about line 1396)

Category 1: a principle-1 regression of an always-protected write that was denied at the merge base.

`bashReading` judges every heredoc body before its segment loop runs. That loop is where `cd` moves `shellCwd`. So a body runs, for the guard, in the directory the command started in, not in the one its owning segment runs in.

Bash resolves each `rm` below to `<root>/.kukulu/cleanroom` (checked with `realpath`):

| Command | `36df873` | `766a5d2` | HEAD |
|---|---|---|---|
| `cd build` NL `bash <<EOF` NL `rm -rf ../.kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cd build` NL `cat <<EOF \| bash` NL `rm -rf ../.kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cd build && sh <<'EOF'` NL `rm -rf ../.kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `(cd build; bash <<EOF` NL `rm -rf ../.kukulu/cleanroom` NL `EOF` NL `)` | denied | allowed | allowed |
| `bash <<EOF` NL `cd build` NL `EOF` NL `rm -rf .kukulu/cleanroom` | allowed | allowed | allowed |

The last row is different. The body's `cd build` runs in a child shell, so it does not move the parent's `rm`. The guard lets it leak into `shellCwd`.

The same ordering affects substitutions, which `bashReading` also judges before its loop. Each of these is allowed at all three revisions:

- `cd build` NL `cat <<EOF > out.txt` NL `$(rm -rf ../.kukulu/cleanroom)` NL `EOF`
- `cd build; echo $(rm -rf ../.kukulu/cleanroom)`
- the same with backticks

The opposite case is over-denied. `cd build` NL `bash <<EOF` NL `rm -rf .kukulu/cleanroom` NL `EOF` is denied at HEAD, but bash removes `build/.kukulu/cleanroom`.

- **What breaks:** one `cd` in front of `bash <<EOF` defeats the guard for every protected path.
- **Minimal fix:**
  - Judge each inner command where it runs: a heredoc body judged as commands, the substitutions in an unquoted body, and the command text's own `$(…)` and backtick substitutions. That place is the `shellCwd` (and `previousCwd`) at its owning segment, after every earlier segment's `cd` and inside any `(` subshell that segment is in.
  - A shell-read body runs in a child shell, so save and restore `shellCwd` and `previousCwd` around its judgment.
- **Task:** R8-02. It depends on R8-01, because both change how bodies are judged.

### 3. A pipe into a shell inside a compound stage, from a grouped owner, or after a comment is allowed; each was denied at the merge base (`mcp/cleanroom.mjs`, `pipesIntoShell`, about line 750)

Category 1: a principle-1 regression.

SPEC A-02's pipe case is a body whose owning segment "pipes (`|` or `|&`) into a later segment of the same pipeline" that runs a shell without `-c`. `pipesIntoShell` still models a pipeline as flat stages that end at the first `;`. Bash's pipeline elements can be compound commands, and a comment after `|` is blank.

Each row below was denied at `36df873`, is allowed at `766a5d2` and at HEAD, and bash prints `RAN`:

| Command |
|---|
| `cat <<EOF \| # c` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `bash` |
| `cat <<EOF \| ( set -e; bash )` NL `rm -rf .kukulu/cleanroom` NL `EOF` |
| `cat <<EOF \| if true; then bash; fi` NL `rm -rf .kukulu/cleanroom` NL `EOF` |
| `{ cat <<EOF; } \| bash` NL `rm -rf .kukulu/cleanroom` NL `EOF` |

- **What breaks:** the same protected-path deletion as round 7's finding, by a spelling one step further out.
- **Minimal fix:** rounds 6 and 7 each closed one more stage shape, so make this rule an over-approximation. A body is shell-read when the command text after its operator, with every heredoc body already removed, has an unquoted `|` or `|&` (not `||`, and not the `>|` redirection). It must also have, after that pipe and at any grouping depth, a segment that runs sh, bash, zsh, dash or ksh without `-c` once `stripGrouping` has removed its grouping and reserved words.
  - An over-denial is then possible, such as an unrelated later `echo x | bash`. SPEC's triage files that as a known-gap candidate, and it is acceptable.
  - These stay allowed:
    - `cat <<'EOF' | grep x` with the priorArt body;
    - R7-01's trailing-pipe `grep x` form;
    - `cat <<EOF | bash -c 'echo hi'`;
    - `cat > build/k.json <<'EOF'` with the priorArt body.
- **Task:** R8-03. It depends on R8-02.

## Spec issues

- **Known-gap candidates.** Each lies outside SPEC A-02's two shell-read cases or its triage, so none is queued:
  - **A shell stage that changes directory before reading stdin:** `cat <<EOF | ( cd build; bash )` NL `rm -rf ../.kukulu/cleanroom` NL `EOF`. R8-02 judges the body in its owner's directory, and bash runs it in `build`.
  - **`while read`-style consumers that hand only part of the body to a shell.**
  - **Carried from round 7:**
    - `cat <<EOF | bash -c bash`;
    - `. /dev/stdin` and `source` of stdin;
    - a body written to a file that a later segment runs (`indirect`);
    - an escaped quote inside ANSI-C quoting.
- **Carried from earlier rounds:**
  - `kukulu_flight_options` rewrites `docs/kukulu.json` with literal non-ASCII characters.
  - A-01's "a cluster that contains `i`" wording is broader than the getopt reading.
  - Nothing re-checks an open fix task against a mid-flight SPEC edit. This round's finding 1 is that case: logged as feedback `63ae64c`.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.
- **Rounds 6 and 7:** after push, the four PR checks pass: test on node 22, 24 and 26, and pre-commit.

## Notes

- **Mutation.** Round 8 is past `review.mutationFixRounds` (2), so survivors are advisory and never tasks. I ran four mutants on R7-01's `pipesIntoShell`, each against the guard self-tests. Two were killed:
  - The trailing-pipe continuation removed: `cat <<EOF | NL rm NL EOF NL bash (R7-01)` failed.
  - The grouping strip removed: both the `(bash)` and the `{ bash; }` `(R7-01)` fixtures failed.
- **Two survivors:**
  - **The explicit backslash-newline branch.** The generic `\` branch already keeps `\` NL inside the stage, so no fixture tells them apart.
  - **Seeding `delims` with the earlier `pending` heredocs on the operator's line.** Searching for this operator's own delimiter skips the earlier bodies too, unless one of them holds a line equal to it.
- **Carried advisory survivors:**
  - `bashVerdict`'s `shellCwd` reset before the second reading (R8-02 may pin it with `cd build` NL `cat <<1 > x` NL `it's` NL `1` NL `rm -rf ../.kukulu/cleanroom`);
  - `BARE_LETTER_EXEMPT`'s `^` anchor;
  - `conditionalEnd`'s closer boundary;
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape;
  - `expansionEnd`'s nesting and quote branches;
  - `validateMutation`'s `filterAt !== -1 &&`.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
