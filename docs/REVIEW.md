# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 9

**Verdict: CHANGES REQUESTED**

This round reviews the commits since the round-8 review (`a64ac22`):

- `2892ee4`: the owner's second SPEC A-02 edit. Every heredoc body line is now checked for protected-path writes, the pipe case becomes an over-approximation, bodies are judged where their segment runs, and the depth limit denies. Ten existing allowed fixtures are named to flip to denied.
- `850712f` and `52955b6`: flight options (`maxRounds` 7, `maxRoundsHard` 10) and the restored `docs/kukulu.json` escapes.
- R8-01 (`82b9410`), R8-02 (`fb45f7d`), R8-03 (`cca6aae`), and their progress and handoff commits.

R8-01, R8-02 and R8-03 do what their plan entries asked. Every goal form of the three tasks is denied at HEAD, and the allowed forms stay allowed. `git diff 36df873..HEAD -- test/fixtures/guard-cases.json` removes no line, and the nineteen new fixtures end in `(R8-01)`, `(R8-02)` or `(R8-03)`.

The owner's SPEC edit landed after the round-8 tasks were queued, and none of them implemented it (finding 1). That is the same ordering problem round 8 hit with `61b3589`, and feedback `63ae64c` already records it. R8-02's in-band markers add a new regression (finding 2). Reading the same code against the merge base turned up two more ownership and directory holes (also finding 2).

**`kukulu_verify` returned `ok: true`.**

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint` and `pre-commit run --all-files` pass.
- `npm test` passes all 15 suites, 4841 assertions, including `cleanroom` with 1467.
- Both guard self-tests pass, with 664 and 660 cases.

**`prChecks`** is `pending`, with no failing checks. That is not a finding.

Clean-room mode is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

**Method.** I ran every form below through three copies of `evaluate` with the template policy: the merge base `36df873`, the round-8 review commit `a64ac22`, and HEAD. Each copy came from `git show <rev>:mcp/cleanroom.mjs` in a scratch directory. I checked the bash behaviour with real bash, using `realpath` in place of the `rm`.

## Findings

### 1. The owner's A-02 edit of 2026-11-13 (`2892ee4`) is not implemented (`mcp/cleanroom.mjs`, `bashReading`'s `judgeBody` and `bashVerdict`, about lines 1349 and 1371)

Category 5, spec drift. It is also category 1: several rows are protected-path writes that the merge base denied.

SPEC A-02 "Judgment of a body" now requires four things:

- every body line is checked for protected-path writes, in every case, with the line's `$(…)` and backticks, whatever the delimiter's quoting;
- a quote ends at its line's end;
- a body is judged at its command's own depth;
- reaching the depth limit denies, with the reason `command nested too deep: more than four levels of substitution, sh -c or eval; split it into separate commands`.

HEAD still treats a data body as unscanned (quoted delimiter) or as substitutions only (unquoted), and `bashVerdict` still returns `NO_ISSUES` when `depth > 4`.

| Command (SPEC's required fixtures unless noted) | `36df873` | `a64ac22` | HEAD | SPEC |
|---|---|---|---|---|
| `cat <<'EOF' > notes.txt` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed | denied |
| `cat <<'EOF' > notes.txt` NL `$(rm -rf .kukulu)` NL `EOF` | denied | allowed | allowed | denied |
| `cat <<'EOF' > notes.txt` NL `it's` NL `rm -rf .kukulu/cleanroom` NL `EOF` | allowed | allowed | allowed | denied |
| `cat <<EOF > notes.txt` NL `cd sub` NL `rm -rf ../.kukulu/cleanroom` NL `EOF` | denied | allowed | allowed | denied |
| `echo $(bash <<EOF` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `)` (not in SPEC; bash runs the rm) | denied | allowed | allowed | denied by the write check |
| `diff <(bash <<EOF` NL `rm -rf .kukulu/cleanroom` NL `EOF` NL `) /dev/null` (not in SPEC; bash runs the rm) | denied | allowed | allowed | denied by the write check |
| `echo $(echo $(echo $(echo $(echo $(echo hi)))))`, five levels | allowed | allowed | allowed | denied, `command nested too deep: …` |

Two more gaps:

- The ten existing fixtures that SPEC names to flip to denied are all still `expect: "allowed"`. One example is `cat <<EOF | bash -c 'echo hi' NL rm -rf .kukulu/cleanroom NL EOF (R6-02)`.
- Two required fixtures have no case yet, though HEAD already decides them as SPEC wants:
  - `cat <<'EOF' | ( set -e; bash )` / `cat ~/.cargo/registry/a.rs` / `EOF`, which must be denied;
  - `cat <<'EOF' > notes.txt` / `cat ~/.cargo/registry/a.rs` / `EOF`, which must be allowed.

- **What breaks:**
  - A substitution nested five deep hides any command from the guard.
  - A heredoc owned by a shell inside `$(…)` or `<(…)` (see finding 2) can delete the clean-room log.
  - SPEC's own required fixtures fail.
- **Minimal fix:**
  - **Writes on body lines.** Judge each line of a data body on its own, as one command, in a body-local directory. That directory starts at the owning segment's, a `cd` line moves it, and it is discarded after the body. Count only a denial whose reason starts `protected path:`.
  - **No masking.** A read or word denial earlier on the same line must not hide a later write. Either run that judgment with only the write rules active, or collect every denial on the line.
  - **Substitutions.** An unquoted body's substitutions are still judged by every rule.
  - **Depth.** Turn the depth cap into the SPEC denial.
  - **Fixtures.** Flip the ten named fixtures and list them in the commit body.
- **Task:** R9-01.

### 2. Body ownership and directory are still wrong in three ways, one of them a new regression (`mcp/cleanroom.mjs`, `bashReading`, about lines 1365 and 1445; `stripHeredocs`, about line 727)

Category 1.

**a. A regression from R8-02.** R8-02 carries ownership through the segment split with the private-use characters U+E001 (`SUBST`) and U+E002 (`BODY`). The comment says these are "never in real input", but a command can contain them. A literal U+E002 in an earlier segment claims the body for that segment, so the body is judged in that segment's directory.

| Command | `36df873` | `a64ac22` | HEAD |
|---|---|---|---|
| `cd build; echo x<U+E002>; cd ..; bash <<EOF` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | denied | allowed |
| `cd build; echo x<U+E001>; cd ..; echo $(rm -rf .kukulu/cleanroom)` | denied | denied | allowed |

Bash resolves the first row's path to `<root>/.kukulu/cleanroom`.

**b. A heredoc whose operator is inside `$(…)` or `<(…)` is owned by the outer segment.** `stripHeredocs` takes the owner from `splitRaw(head).at(-1)`, which here is `echo $(bash`. So `bash` is not seen as the owner, and the body is classed as data. That breaks two things:

- **Reads.** `echo $(bash <<'EOF'` NL `cat ~/.cargo/registry/a.rs` NL `EOF` NL `)` is denied at `36df873` (`deny.paths`) and allowed at `a64ac22` and HEAD, and bash reads the file. SPEC A-02's first shell-read case names the owning segment's command word, and here that word is `bash`.
- **Directory.** The body's marker lands inside the substitution text, so no segment claims it, and the catch-all after the loop judges it at the final directory. `cd build; echo $(bash <<EOF` NL `rm -rf ../.kukulu/cleanroom` NL `EOF` NL `); cd ..` is allowed at every revision, and bash removes `<root>/.kukulu/cleanroom`. That contradicts SPEC's "judged in the directory the owning segment runs in".

**c. A `cd` inside a substitution or a `-c` string leaks into the parent.** Each of these is allowed at every revision:

- `x=$(cd build; pwd); rm -rf .kukulu/cleanroom`
- `` echo `cd build`; rm -rf .kukulu/cleanroom ``
- `cat <(cd build); rm -rf .kukulu/cleanroom`
- `bash -c 'cd build'; rm -rf .kukulu/cleanroom`
- `sh -c 'cd build'; rm -rf .kukulu/cleanroom`

Bash runs each `rm` in `<root>`. R8-02's commit body says this leak was left "as before". Principle 1 makes it a fix task, for two reasons:

- the write uses `rm -rf` on an always-protected path, spellings the rules name;
- `docs/cleanroom.md`'s cd rule already says a `cd` inside a subshell ends at its `)`.

`eval 'cd build'; rm -rf ../.kukulu/cleanroom` is denied at every revision and must stay denied, because `eval` runs in the current shell.

- **What breaks:** an implementer can move the guard's idea of the directory with one substitution, or one invisible character, and then delete the clean-room log by a relative path.
- **Minimal fix:**
  - **Ownership by offset.** Carry ownership by offsets into `stripped.text`, never by characters that input can hold. `stripHeredocs` already returns `marks`; the substitution start offsets and the segment spans can be mapped the same way. Refusing a command that contains U+E001 or U+E002 is an acceptable alternative.
  - **The inner owner.** A heredoc whose operator lies inside a substitution is owned by the segment inside that substitution: its shell-read test uses that segment's command word, and it is judged where the substitution is judged.
  - **Child shells.** Every substitution body and every `sh`/`bash`/`zsh`/`dash`/`ksh -c` string runs in a child shell, so save and restore `shellCwd` and `previousCwd` around its judgment. `eval` is unchanged.
- **Task:** R9-02. It depends on R9-01, because both change `judgeBody` and `judgeOwned`.

## Spec issues

- **Known-gap candidates.** Each is outside SPEC A-02's shell-read cases or its triage, so none is queued.
  - The read-only gaps that `2892ee4` now lists in SPEC ("Known gaps (reads only)"): `.`/`source` of stdin, `eval "$(cat)"`, `while read`, `bash -c bash`, a shell stage that `cd`s before it reads stdin, and a script file written by a heredoc and run later.
  - **Carried from round 7:** an escaped quote inside ANSI-C quoting.
- **Carried from earlier rounds:**
  - `kukulu_flight_options` rewrites `docs/kukulu.json` with literal non-ASCII characters. `52955b6` restored the escapes by hand again this round.
  - A-01's "a cluster that contains `i`" wording is broader than the getopt reading.
  - Nothing re-checks an open fix task against a mid-flight SPEC edit. Feedback `63ae64c` records it, and it recurred this round: `2892ee4` landed before R8-01 started, and finding 1 is the cost.
- **The round budget.** `maxRoundsHard` is 10, so this round's fix round is the last one the flight options allow. If round 10 finds more, the owner decides whether to raise it or to ship with the remainder under known gaps.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.
- **Rounds 6 to 8:** after push, the four PR checks pass: test on node 22, 24 and 26, and pre-commit.

## Notes

- **Mutation.** Round 9 is past `review.mutationFixRounds` (2), so survivors are advisory and never tasks. I ran seven mutants on the round-8 code, each against the two guard self-tests, and six were killed:
  - R8-01's `made ||` removed: four `(R8-01)`/`(R8-02)` fixtures failed.
  - The shell-read body judged at `depth + 1`: the six-line `(R8-01)` chain failed.
  - R8-02's `shellCwd`/`previousCwd` restore removed: `bash <<EOF NL cd build NL EOF NL rm … (R8-02)` failed.
  - R8-02's in-loop body placement removed (`nBody = 0`): `(cd build; bash <<EOF … ) (R8-02)` failed.
  - The post-loop catch-all removed: three `(R8-01)`/`(R8-02)` fixtures failed.
  - R8-03's `stripGrouping` call removed: the `(bash)`, `{ bash; }` and `then bash` fixtures failed.
- **One survivor:** `pipesIntoShellLater`'s `>|` exclusion. Its removal only over-denies, and no fixture has a `>|` before a later shell.
- **Carried advisory survivors:**
  - `BARE_LETTER_EXEMPT`'s `^` anchor;
  - `conditionalEnd`'s closer boundary;
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape;
  - `expansionEnd`'s nesting and quote branches;
  - `validateMutation`'s `filterAt !== -1 &&`;
  - R7-01's explicit backslash-newline branch, now gone with `pipesIntoShell`.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
