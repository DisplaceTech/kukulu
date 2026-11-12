# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 5

**Verdict: CHANGES REQUESTED**

I reviewed the round-4 fix commit `0398316` (R4-01) against SPEC v0.8.1 A-02, principle 1, and PLAN.md's `## Review fixes (round 4)`. `git diff 7d43582..HEAD` touches only the R4-01 files plus the pipeline's own PROGRESS, HANDOFF and state files. `git diff 36df873..HEAD -- test/fixtures/guard-cases.json` has no removed lines, and every new fixture name ends in `(R4-01)`.

I ran `kukulu_verify` myself and it returned `ok: true`:

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint`, `pre-commit run --all-files` and `npm test` pass: 4779 assertions in all 15 suites.
- The guard self-test passes on both templates, with 616 and 612 cases.

`prChecks` is `pending`, with no failing check. Clean-room mode is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

I ran guard forms through three copies of `evaluate`, each from `git show <rev>:mcp/cleanroom.mjs` in a temp directory with the template policy: the merge base `36df873`, the commit before R4-01 (`58575de`), and HEAD. I checked every form that decides a finding against real bash 5.2.21 with `bash -c`, with `echo RAN` in place of the write.

## R4-01 verified

- All ten R4-01 denied fixtures are denied at HEAD and were allowed at `58575de`. The two allowed fixtures stay allowed.
- `while [[ a =~ (<<y) ]]; do :; done`, `! [[ a =~ (<<y) ]]`, `echo ok && [[ a =~ (<<y) ]]` and `shopt -s extglob` NL `!(x<<y)`, each followed by NL `rm -rf .kukulu/cleanroom`, are denied at HEAD and were allowed at `58575de`.
- Two mutants were killed by the guard self-test, each naming the expected R4-01 fixtures. One disabled the `[[` branch and the other disabled the extglob-group branch.

## Findings

### 1. R4-01 reopens A-02's apostrophe hole: a real heredoc inside a `!(` subshell or after an argument `[[` is hidden (`mcp/cleanroom.mjs:633-642`, `stripHeredocs`)

This is category 1, a principle-1 regression of an always-protected write. Each form below was **denied at `58575de`, the commit before R4-01, and is allowed at HEAD**. It is the exact hole A-02 names (SPEC §A-02, "A hole"): an apostrophe in a body opens a quote in the splitter and hides the commands after it.

R4-01's two new copy-through branches match regions that bash does not read as a conditional or a pattern group. A real heredoc operator inside such a region is copied through unread. Its body then reaches `splitRaw` as plain text, and an apostrophe there hides every line up to the next `'`.

- **`!(` in command position.** With extglob off, the default for `bash -c`, bash reads this as `!` (pipeline negation) followed by a `( … )` subshell, so the heredoc inside is real. The group branch (`/[?*+@!]/.test(c) && command[i + 1] === "("`) has no position check.
- **`[[` as an argument.** `[[` is a reserved word only where a command word is expected. After `echo` or `cat a` it is an ordinary word, and the `<<` after it is a real operator. The `[[` branch accepts any word start (`/[\s;&|(){}]/` before it, so a blank qualifies).

`NL` is a newline. Bash printed RAN for every row.

| Command | `58575de` | HEAD |
|---|---|---|
| `!(cat <<EOF` NL `it's` NL `EOF` NL `rm -rf .kukulu/cleanroom` NL `echo ')'` NL `)` | denied | allowed |
| `echo ok && !(cat <<EOF` NL `it's` NL `EOF` NL `rm -rf .kukulu/cleanroom` NL `: ')'` NL `)` | denied | allowed |
| `!(cat <<EOF > x.txt` NL `it's` NL `EOF` NL `) ; rm -rf .kukulu/cleanroom ; : ')'` | denied | allowed |
| `echo [[ <<EOF` NL `it's` NL `EOF` NL `rm -rf .kukulu/cleanroom` NL `: ' x ]] '` | denied | allowed |
| `cat a [[ <<EOF` NL `it's` NL `EOF` NL `echo x > docs/cleanroom.json` NL `: ' ]] '` | denied | allowed |

The same commands with `! (` (a blank after the `!`) or a plain `(` are denied at HEAD. Only the R4-01 branches open the hole.

Round 4's review called matching `[[` as an argument "acceptable", on the grounds that copy-through only hides operators. That reasoning was wrong. Hiding a *real* heredoc operator exposes its body to the splitter, and an apostrophe there is the A-02 hole.

- **What breaks:** an implementer in a clean-room flight can delete or overwrite the clean-room log, `docs/cleanroom.json` or `.kukulu/state.json` with no denial. The commands were denied before R4-01.
- **Minimal fix:**
  - **`[[`:** copy a `[[` region through only in command position. That means the start of the command, after a newline, `;`, `&`, `|`, `(` or `{` (blanks skipped), or after one of the reserved words `if`, `then`, `else`, `elif`, `while`, `until`, `do`, `time` and `!`. Anywhere else `[[` is a word and gets no special handling.
  - **`!(` in command position:** bash's reading depends on `shopt extglob`, which the guard cannot see. With extglob off it is a negated subshell. With extglob on it is a pattern word, and `shopt -s extglob` NL `!(x<<y)` NL `rm -rf .kukulu/cleanroom` runs the `rm`. That form is denied at HEAD and must stay denied. So the guard must deny when *either* reading denies. One way: do not copy `!(` through in command position, and judge the body of any heredoc whose operator sits inside that group as commands, the way a shell-read body is judged. Then neither the apostrophe nor the misread "body" hides a write.
  - **Other cases:** `!(` outside command position and `?(`, `*(`, `+(`, `@(` keep R4-01's behaviour. At command position those four are a syntax error with extglob off and a pattern word with it on, so copy-through is right for them.

  This is task R5-01.

## Spec issues

- **A-02's operator contexts (fifth round of the same class).** Round 4 recommended a closed list of the bash contexts where `<<` is not an operator. This round shows that the list also needs each context's *position* rule:
  - `[[` only in command position;
  - `!(` ambiguous in command position.

  An unconditional copy-through is as unsafe as none. I still recommend that the owner write the list, with these position rules, into A-02.
- **Carried, still open for the owner:**
  - A heredoc piped into a shell (`cat <<EOF | bash`) is judged as data.
  - A-01's "a cluster that contains `i`" wording is broader than the implementation's getopt reading of `-e`/`-f`/`-l` values.
- **Known-gap candidates:**
  - A heredoc piped into a shell: `cat <<EOF | sh` reads its body as data.
  - An escaped quote inside ANSI-C quoting: `echo $'\''; rm -rf .kukulu/cleanroom # '` is allowed at the merge base and at HEAD (not a regression).
  - A heredoc with an apostrophe body inside `$( ... )` inside a `!(` subshell: `x=$(!(cat <<EOF` NL `it's` NL `EOF` NL `rm -rf .kukulu/cleanroom` NL `: ')'` NL `))` is allowed at the merge base, at `58575de` and at HEAD. It is not a regression, and R5-01's command-position rule may close it as a side effect.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## Notes

- **Mutation survivors (advisory).** Round 5 is past `review.mutationFixRounds` (2), so these are never tasks:
  - `conditionalEnd`'s closer boundary: replacing the `]]` test with a bare `c === "]" && command[i + 1] === "]"` (no blank before, no delimiter after) survived the guard self-test.
  - `groupEnd`'s nesting: replacing `else if (c === ")" && --depth === 0) return i;` with `else if (c === ")") return i;` survived. `shopt -s extglob` NL `echo @(a|(x)<<y)` NL `rm -rf .kukulu/cleanroom` would pin it.
- **Carried from round 4:**
  - `assignmentEnd`'s list nesting and `backtickEnd`'s escape have no pinning fixture.
- **Carried from round 3:**
  - `expansionEnd`'s nesting and quote branches have no pinning fixture.
  - `validateMutation`'s `filterAt !== -1 &&` is untested either way.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description still omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
