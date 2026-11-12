# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 4

**Verdict: CHANGES REQUESTED**

I reviewed the round-3 fix commit `dc0577b` (R3-01) against SPEC v0.8.1 A-02, principle 1, and PLAN.md's `## Review fixes (round 3)`. `git diff 26bc850..HEAD` touches only the R3-01 files plus the pipeline's own PROGRESS, HANDOFF and state files.

I ran `kukulu_verify` myself and it returned `ok: true`:

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint`, `pre-commit run --all-files` and `npm test` pass: 4766 assertions in all 15 suites.
- The guard self-test passes on both templates, with 604 and 600 cases.

I ran 5 mutants of R3-01's mechanics through `kukulu_mutate`. I also ran about 60 guard forms through three copies of `evaluate`: HEAD's, the round-3 review commit's (`26bc850`) and the merge base's (`36df873`). Each copy came from `git show <rev>:mcp/cleanroom.mjs` and ran in a temp directory with the template policy. I checked every form that decides a finding against real bash 5.2.21, with `bash -c` and `echo RAN` in place of the write.

`prChecks` is `pending`, with no failing check.

Clean-room mode is off for this flight (`state.cleanroom.mode` is `general`), so there are no denials to read.

## R3-01 verified

- All 10 round-3 forms are now denied at HEAD, and they were allowed at `26bc850`. So are these variants: `a+=([1<<n]=3)`, `local a[1<<n]=3`, `a["]"<<n]=3`, `a=(")" <<n)`, a multi-line `a=(x` NL `<<n)`, `a=( $(echo) <<n)`, `` x=`echo \` <<n` ``, `` a[1]=`cat <<x` ``, `` a=(`cat <<x`) ``, `if a[1<<n]=3; then :; fi`, two assignments on one line, and `echo ok && a[1<<n]=3`.
- A real heredoc after an assignment or a backtick span is still data: `a=(1 2) cat <<EOF > notes.txt`, `a[0]=1 cat <<EOF > notes.txt` and `` echo `date` <<EOF > notes.txt `` are allowed, each followed by an `rm` body line and `EOF`.
- I tried to make the new copy-through regions hide an apostrophe body, using a heredoc inside `a=($(…))`, `a[$(…)]=1` and backticks, each closed later by a stray quote. All of them stay denied, because `extractSubstitutions` re-reads the substitution with `stripHeredocs`.
- `git diff 36df873..HEAD -- test/fixtures/guard-cases.json` has no removed lines. Every new fixture name ends in `(R3-01)`. `docs/cleanroom.md` and the CHANGELOG line moved with the code.
- Three mutants were killed by the guard self-test, each naming the expected R3-01 fixtures:
  - disabling the assignment branch;
  - dropping the `+=` step in `assignmentEnd`;
  - disabling the backtick branch.

## Findings

### 1. Guard regression: `<<` inside a `[[ … ]]` conditional or an extglob group is read as a heredoc (`mcp/cleanroom.mjs:599-713`, `stripHeredocs`)

This is category 1, a principle-1 regression of an always-protected write by `rm -rf`. It is the same class as the findings of rounds 1, 2 and 3.

In bash, a `<<` inside a `[[ … ]]` conditional's pattern or regex operand is text, and so is one inside an extended-glob group (`?(…)`, `*(…)`, `+(…)`, `@(…)`, `!(…)`). Bash parses `[[` patterns as extglob without `shopt`; elsewhere it needs `shopt -s extglob` on an earlier line. `stripHeredocs` treats such a `<<` as an operator, and its "body" swallows the lines after it. The P0-02 heredoc code introduced this, and no fix round has covered it.

For every form below, I replaced the write with `echo RAN`, and bash 5.2.21 (`bash -c`) printed RAN. Every form was denied at the merge base `36df873` and is allowed at both `26bc850` and HEAD. `NL` is a newline.

| Command | merge base | HEAD |
|---|---|---|
| `[[ a =~ (x<<y) ]]` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `[[ a =~ (x<<y) ]]` NL `rm -rf .kukulu/cleanroom` NL `y` | denied | allowed |
| `[[ a =~ ^(<<y)$ ]]` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `[[ a =~ x(<<y) ]]` NL `echo x > docs/cleanroom.json` | denied | allowed |
| `if [[ a =~ (<<y) ]]; then :; fi` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `[[ a == @(x<<y) ]]` NL `rm -rf .kukulu/cleanroom` (also `=`, `!=`, `?(`, `*(`, `+(`, `!(`) | denied | allowed |
| `[[ a == +(<<y) ]] && echo ok` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `shopt -s extglob` NL `echo @(x<<y)` NL `rm -rf .kukulu/cleanroom` (also `ls *(…)`, `+(…)`, `!(…)`, `?(…)`) | denied | allowed |
| `shopt -s extglob` NL `case a in @(x<<y)) ;; esac` NL `rm -rf .kukulu/cleanroom` | denied | allowed |

The guard agrees with bash on these forms, which stay allowed: `[[ -n a ]] <<y` NL `rm …` (a real, unterminated heredoc after the `]]`) and `cat x <<y` NL `rm …`. I also checked where bash reports a syntax error and runs nothing after it, so the guard's verdict does not matter:

- `[[ a <<b ]]` and `[[ a < <<b ]]`;
- `[[ a =~ x<<y ]]` with no group;
- `echo @(x<<y)` with extglob off;
- `>#<<x`;
- `for`, `select` and `case` word lists.

- **What breaks:** an implementer in a clean-room flight can delete or overwrite the clean-room log, `docs/cleanroom.json` or `.kukulu/state.json` with no denial.
- **Minimal fix:** in `stripHeredocs`, outside quotes, copy each of these regions through without looking for `<<`, the way the `${`, `$[`, `((`, assignment and backtick branches do. An unclosed region is not special.
  - A `[[` at a word start followed by a blank, through the next `]]` that a blank precedes and that a blank, `;`, `&`, `|`, `)`, a newline or the end of the command follows. The scan is quote-aware.
  - One of `?`, `*`, `+`, `@`, `!` directly followed by `(`, through its matching `)`, nesting-aware and quote-aware. The `$((`/`((` branch must still win for `$((2*(1<<3)))`.
  - Copy-through may only deny more: it hides an operator, never exposes one. So matching `[[` as an argument (`echo [[ <<x … ]]`) is acceptable. (Task R4-01.)

## Spec issues

- **A-02's operator contexts (fourth round of the same class).** Round 3 recommended judging an unterminated body as commands too. That would not close this class: the second row of finding 1 is a misdetected heredoc whose "delimiter" line `y` follows the write. Bash runs the write and then fails on `y`, while the guard reads the write as a terminated body. The class closes only when A-02 names the complete set of bash contexts where `<<` is not an operator. After R4-01 these are:
  - quotes;
  - `#` comments;
  - `$((…))` and `((…))`;
  - `$[…]` and `${…}`;
  - assignment subscripts;
  - compound array assignments;
  - backtick spans;
  - `[[ … ]]`;
  - extglob groups.

  I found no other context in bash 5.2 where a `<<` is text and the next line still runs. I recommend that the owner write that list into A-02, so later rounds review against a closed set.
- **Carried from earlier rounds, still open for the owner:**
  - A heredoc piped into a shell (`cat <<EOF | bash`) is judged as data.
  - A-01's "a cluster that contains `i`" wording is broader than the implementation's getopt reading of `-e`/`-f`/`-l` values.
- **Known-gap candidates:**
  - A heredoc piped into a shell: `cat <<EOF | sh` reads its body as data.
  - An escaped quote inside ANSI-C quoting: `echo $'\''; rm -rf .kukulu/cleanroom # '` is allowed at the merge base and at HEAD (not a regression, and outside A-01 and A-02). `splitRaw` ends `$'…'` at the `\'`, so the next `'` opens a quote that hides the write. Bash runs the write.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## Notes

- **Mutation survivors (advisory).** Round 4 is past `review.mutationFixRounds` (2), so these are never tasks:
  - `assignmentEnd`'s list nesting: replacing `else if (c === ")" && --depth === 0) return i;` with `else if (c === ")") return i;` survived the guard self-test. `a=( $(echo) <<n)` NL `rm -rf .kukulu/cleanroom` would pin it: it is denied at HEAD, and the mutant allows it.
  - `backtickEnd`'s escape: dropping `if (command[i] === "\\") i++;` survived. `` x=`echo \` <<n` `` NL `rm -rf .kukulu/cleanroom` would pin it: it is denied at HEAD.
- **Carried from round 3:**
  - `expansionEnd`'s nesting and quote branches have no pinning fixture. `echo ${x:-${y}<<z}` and `echo ${x:-"}"<<y}`, each followed by NL `rm -rf .kukulu/cleanroom`, would pin them.
  - `validateMutation`'s `filterAt !== -1 &&` is untested either way.
- `stripHeredocs` calls `assignmentEnd` (like `expansionEnd`, `arithmeticEnd` and `backtickEnd`) twice per match, once in the condition and once in the body. Each call is linear, so this costs nothing that matters.
- **Carried from round 1:**
  - `kukulu_next`'s `TOOLS` description still omits `description` from its result shape.
  - P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
