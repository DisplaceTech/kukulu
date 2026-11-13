# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 6

**Verdict: CHANGES REQUESTED**

This round reviews the R5-01 fix commit `80c02ca` and its no-op marker `6a0975f`. It also reviews the two operator commits that landed since round 5: `4937aa4`, the owner's edit of SPEC A-02 on 2026-11-13, and `9d2f86b`, from `kukulu_flight_options`. Because SPEC wins over PLAN, I reviewed the guard against the edited A-02, not only against R5-01's plan text, which predates the edit.

R5-01 does what its task asked:

- `git diff 36df873..HEAD -- test/fixtures/guard-cases.json` has no removed lines.
- All 11 new fixture names end in `(R5-01)`, and the commit touches only the task's five files.
- I ran four mutants against the guard self-test, and all were killed:
  - `commandPosition` always true: R5-01's `[[`-argument fixtures failed.
  - `commandPosition` always false: the R4-01 and R5-01 command-position fixtures failed.
  - The `negated` shell clause deleted: `shopt -s extglob` NL `!(x<<y)` NL rm failed.
  - `while` and `!` dropped from the reserved words: the `while [[` and `! [[` fixtures failed.

The edited SPEC adds requirements that no task has built yet. One of them is a regression from the merge base.

**`kukulu_verify` returned `ok: false`.**

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint` and `pre-commit run --all-files` fail on `check-names`.
- `npm test` fails 1 assertion in `plugin`, the same check-names run. The other 14 suites pass, including `cleanroom` (1419 assertions).

**`prChecks` is `fail`.** `test (node 22)`, `test (node 24)`, `test (node 26)` and `pre-commit (yamllint / shellcheck / markdownlint / gitleaks)` fail on run 43445500043/43445500035 for `9246985`. `gh pr checks` also lists `test (no gh on PATH)` as failing and `test (macos)` as pending. The run was still in progress, so its logs were not available. The local `kukulu_verify` reproduces the failures: the fast 7-16 s failures match a lint failure.

Clean-room mode is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

I ran each guard form through three copies of `evaluate` with the template policy: the merge base `36df873`, the round-5 review commit `d9b19ea`, and HEAD. Each copy came from `git show <rev>:mcp/cleanroom.mjs` in a scratch directory. I checked every form a finding depends on with real bash 5.2.21 (`bash -c`, `echo RANn` in place of the write).

## Findings

### 1. A heredoc piped into a shell is allowed; it was denied at the merge base (`mcp/cleanroom.mjs`, `stripHeredocs` body judgment, about line 704)

Category 1: a principle-1 regression of an always-protected write. The edited SPEC A-02 now requires these forms ("Judgment of a body", the pipe case; "Required fixtures", denied).

`stripHeredocs` judges a body as commands only when the *owning* segment is a shell. A body piped into a later segment whose command word is `sh`, `bash`, `zsh`, `dash` or `ksh`, with no `-c`, is treated as data. Bash runs every row below.

| Command | `36df873` | `d9b19ea` | HEAD |
|---|---|---|---|
| `cat <<EOF \| bash` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cat <<'EOF' \| sh` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cat <<EOF \|& bash` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |
| `cat <<EOF \| tee x \| bash` NL `rm -rf .kukulu/cleanroom` NL `EOF` | denied | allowed | allowed |

- **What breaks:** an implementer in a clean-room flight can delete the clean-room log, or overwrite `docs/cleanroom.json` or `.kukulu/state.json`, by piping a heredoc into a shell.
- **Fix:** a body is also judged as commands when its owning segment pipes (`|` or `|&`) into a later segment of the same pipeline whose command word is one of the five shells and that has no `-c`.
- **Fixtures:** the two pipe forms SPEC requires, plus the `|&` and `| tee x | bash` rows above, all denied. `cat <<'EOF' | grep x` with the priorArt JSON body stays allowed.
- **Task:** R6-02.

### 2. SPEC A-02's two readings are not implemented (`mcp/cleanroom.mjs`, `stripHeredocs` and its caller in `bashVerdict`)

Category 5, spec drift: a requirement of the edited SPEC with no implementation. Category 3 also applies, because SPEC's required fixtures are missing.

SPEC A-02 now requires every command to be read twice. The first reading uses the closed list of non-operator regions. The second treats every unquoted `<<` that is not `<<<` and has a delimiter word as an operator, digits-only delimiters included. The command is denied when either reading denies. HEAD has only the first reading.

The required fixture `cat <<1 > x.txt` NL `it's` NL `1` NL `rm -rf .kukulu/cleanroom` is **allowed at HEAD**. Bash reads `<<1` as a heredoc and runs the `rm`. The digits rule hides the operator, so the apostrophe in `it's` hides the `rm`. It is allowed at the merge base too, so this is not a regression, but SPEC now names it as required.

SPEC rule 6 also changed. In the first reading, `!(` is copied through like the other extglob openers. The second reading reads `!(` as a subshell, and "no other handling is required". R5-01 built a different mechanism instead: the `negated` list, which marks every heredoc inside a command-position `!(` as shell-read. Its effect is an over-denial: `!(cat <<EOF` NL `<protected write as data>` NL `EOF` NL `)` is denied, although bash reads that body as data. Once the second reading exists, that mechanism is redundant and contradicts rule 6's text.

Of SPEC's required A-02 fixtures, these are missing from `guard-cases.json`:

- `cat <<EOF | bash` and `cat <<'EOF' | sh` (finding 1)
- `cat <<1 > x.txt` …
- `x=$(!(cat <<EOF` … `))`. It is denied at HEAD, but no fixture pins it.
- `echo $((1<<y))` NL `rm -rf .kukulu/cleanroom`
- `cat <<'EOF' | grep x` …
- `[[ a =~ (x<<y) ]] && echo ok`
- `echo $((1<<3))`

**Fix:**

- Implement the second reading as SPEC A-02 "Two readings" states:
  - It runs only when the first reading skipped a `<<`.
  - Its bodies are judged by the same body rules, the R6-02 pipe case included.
  - When either reading denies, report the first denying reading's reason.
- Make rule 6's first reading copy a command-position `!(` through, and remove the `negated` marking.
- Add the missing fixtures.
- Every existing fixture must keep its expect and reason.

This is task R6-03. It depends on R6-02, because the second reading reuses the pipe body rule.

### 3. PR checks fail: `check-names` is red at `docs/kukulu.json:655` and `.kukulu/feedback.jsonl:8`

Category 3: a failing CI check. Neither hit comes from a task.

- **`docs/kukulu.json:655`:** `9d2f86b` (`kukulu_flight_options`, run by the installed 0.8.0) re-serialized the whole file with `JSON.stringify`. Every JSON escape of U+016B (the macron u), U+2014 (the em dash) and U+26A0 U+FE0F (the warning sign) became the literal character. The `progress-no-bare-macron` `shouldMatch` example `the ASCII identifier is k…kulu, never this` now holds a bare macron letter, which check-names refuses.
- **`.kukulu/feedback.jsonl:8`:** the controller's pipeline-friction entry quotes the macron letter in prose. `kukulu_feedback_log` committed it as written.

**What breaks:**

- `npm run lint`, pre-commit and the `plugin` suite fail.
- Every CI test job and the pre-commit job fail, so the PR cannot go green.
- Any later controller feedback that names the letter breaks the build again.

**Fix:**

- In `docs/kukulu.json`, restore the JSON escapes `9d2f86b` removed, so that `git diff d9b19ea -- docs/kukulu.json` shows only the `maxRounds` and `maxRoundsHard` lines.
- In `scripts/check-names.mjs`, exempt `.kukulu/feedback.jsonl` from the bare-letter check only. It is an append-only machine log of agents' words, the same kind of record as `docs/feedback/`, and rewriting a committed entry would rewrite history. The NFD check, the path check and the private-name check stay on.
- Add a `test/plugin.mjs` assertion that a temp directory whose `.kukulu/feedback.jsonl` holds the bare letter passes check-names, and that the same line in another file still fails.
- The failing checks `test (node 22)`, `test (node 24)`, `test (node 26)` and `pre-commit (yamllint / shellcheck / markdownlint / gitleaks)` prove the fix.

This is task R6-01.

## Spec issues

- **`kukulu_flight_options` rewrites `docs/kukulu.json` with literal non-ASCII.** `flightOptions` writes `JSON.stringify(raw, null, 2)`, in both the installed 0.8.0 and this branch (`mcp/server.mjs`, about line 4262). That turns every escape in the file into a literal character, the macron letter included. The controller has already logged this as feedback. SPEC 0.8.1 does not cover it, so it is not a task here. Should the writer keep non-ASCII escaped, or edit only the keys it changes? That is the owner's call for 0.8.1 or 0.9.0. Until then, any flight-options call in a repository whose config holds the letter breaks check-names.
- **A fix task written before a SPEC edit.** R5-01 was planned against the pre-edit A-02 and implemented after the edit. Nothing in the pipeline re-checks open fix tasks when SPEC changes mid-flight. I have logged this as review feedback.
- **Carried, still open for the owner:** A-01's "a cluster that contains `i`" wording is broader than the implementation's getopt reading of `-e`/`-f`/`-l` values.
- **Known-gap candidates:**
  - An escaped quote inside ANSI-C quoting: `echo $'\''; rm -rf .kukulu/cleanroom # '` is allowed at the merge base and at HEAD, so it is not a regression.
  - The over-denial from R5-01's `negated` marking (finding 2) is a known-gap candidate under the new A-02 triage rule on its own. It is listed under finding 2 only because SPEC rule 6 now states the intended mechanism.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## Notes

- **Mutation:** round 6 is past `review.mutationFixRounds` (2). All five mutants in `mcp/cleanroom.mjs` were killed, so no survivors are recorded this round.
- **Carried advisory survivors** (never tasks):
  - `conditionalEnd`'s closer boundary (round 5).
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape (round 4).
  - `expansionEnd`'s nesting and quote branches, and `validateMutation`'s `filterAt !== -1 &&` (round 3).
  - Round 5's `groupEnd` nesting survivor is now pinned. A fifth mutant, which made `groupEnd` return the first `)`, was killed by R5-01's `echo @(a|(x)<<y)` fixture.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description still omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
- **The R5-01 marker commit:** `6a0975f` is an empty commit that exists only because `kukulu_task_done` needs HEAD's subject to start with the task id, and a feedback commit landed after the task commit. It is harmless.
