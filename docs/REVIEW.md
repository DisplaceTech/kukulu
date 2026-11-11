# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 3

**Verdict: CHANGES REQUESTED**

I reviewed the round-2 fix commits from `bfe95b6` to `1069f19`: `e472f15` (R2-01), `07e0992` (R2-02), `d776945` (R2-03) and `0fcd760` (R2-04). I checked them against SPEC v0.8.1, PLAN.md's `## Review fixes (round 2)` and the round-2 findings.

I ran `kukulu_verify` myself and it returned `ok: true`:

- All 33 constraints are `ok`, with no hits and no fixture failures.
- `npm run lint`, `pre-commit run --all-files` and `npm test` pass: 4753 assertions in all 15 suites.

I ran 4 mutants through `kukulu_mutate` on the round's code. I also ran each guard form below through HEAD's `evaluate`, through the merge base's (`git show 36df873:mcp/cleanroom.mjs` in a temp directory), and through the round-1 and round-2 review commits' copies. I checked every form against real bash 5.2.21.

`prChecks` is `pending`, with no failing check. The round-2 failures (`test (node 22/24/26)` and `pre-commit`) are no longer reported as failing. R2-01 fixed `check-names` locally, so I expect them to pass.

## Findings

### 1. Guard regression: `<<` in an array-subscript assignment, a compound array assignment or a backtick span is read as a heredoc (`mcp/cleanroom.mjs:599-701`, `stripHeredocs`)

This is the same class as round-1 finding 2 and round-2 finding 2. In each of these contexts bash does not treat `<<` as a heredoc operator for the outer command. `stripHeredocs` does, so its unterminated "body" swallows every later line. Bash runs those lines: I ran each form below in bash with `echo RAN` as the second line, and RAN was printed every time. Every form below was denied at the merge base `36df873` and is allowed at HEAD (`NL` is a newline). It was also allowed at both earlier review commits, so neither fix round caused or noticed it.

| Command | merge base | HEAD |
|---|---|---|
| `a[1<<n]=3` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `a[1<<n]+=3` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `x=1 a[1<<n]=3` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `a[x[1<<n]]=3` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `f() { a[1<<n]=3; }` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `x=$(a[1<<n]=3)` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `a=([1<<n]=3)` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `declare -a a=([1<<n]=3)` NL `rm -rf .kukulu/cleanroom` | denied | allowed |
| `a=(x <<n)` NL `rm -rf .kukulu/cleanroom` (bash reports a syntax error on line 1, then runs line 2) | denied | allowed |
| `` echo `cat <<x` `` NL `rm -rf .kukulu/cleanroom` | denied | allowed |

These are principle 1's first case: a regression of an always-protected write by `rm -rf`, a command word the rules name. Round 2's R2-02 put backtick parsing out of scope. The backtick form is queued anyway because it is a regression against the merge base, not a new spelling.

Bash agrees with the guard on these forms, which stay allowed: `echo a[1<<n]=3` and `declare a[1<<n]=3` (bash reads a heredoc, so the next line is its body), `echo {a,<<b}`, `let x=1<<n`, `a[1]<<n`, and `echo $(cat <<x)` NL `rm …` NL `x` (bash 5.2 reads the substitution's heredoc body from the lines that follow).

- **What breaks:** an implementer in a clean-room flight can delete or overwrite the clean-room log, `docs/cleanroom.json` or `.kukulu/state.json` with no denial.
- **Minimal fix:** in `stripHeredocs`, outside quotes, copy each of these regions through without looking for `<<`, the way the `${`, `$[` and `((` branches do:
  - At a word start, an identifier followed by `[`, with its matching `]` (nesting-aware and quote-aware, as `expansionEnd` already is), where the `]` is followed by `=` or `+=`. The region runs through that `]`.
  - At a word start, an identifier followed by `=(` or `+=(`, through its matching `)`.
  - An unescaped backtick, through the next unescaped backtick.
  - An unclosed region is not special.
  - Matching a word start after a command word too (`echo a[1<<n]=3`) is acceptable. It only denies more, because the next lines are then judged as commands. (Task R3-01.)

## Spec issues

- **A-02's unterminated heredoc (third round of the same class).** Every misdetected heredoc found in three rounds is unterminated: its delimiter never appears as a line. When a heredoc really is unterminated, bash warns and runs nothing after it. So judging an unterminated body as commands as well as data costs nothing in a real command, and it would close this whole class for good. That includes contexts nobody has listed yet. Fix rounds keep finding one more bash context per round (`$((`, then `${`/`$[`, now subscripts, compound assignments and backticks), so the loop will not converge on its own. SPEC A-02 says an unterminated body "runs to the end of the command" and is data, so I queued only the narrow fix again. I recommend that the owner adopt the unterminated-body rule, in this release or the next.
- **Carried from earlier rounds, still open for the owner:**
  - A heredoc piped into a shell (`cat <<EOF | bash`) is judged as data.
  - A-01's "a cluster that contains `i`" wording is broader than the implementation's getopt reading of `-e`/`-f`/`-l` values.
- **Known-gap candidates:**
  - A heredoc piped into a shell: `cat <<EOF | sh` reads its body as data.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## Notes

- **R2-01 to R2-04 verified:**
  - R2-01 changes exactly one line of PLAN.md, the sanctioned one, and `check-names` passes.
  - R2-02 closes all four round-2 forms. `expansionEnd` can only hide a `<<`, never expose one, so a mismatch with bash there can only deny more.
  - R2-03 adds three fixtures that pin the forms the round-2 survivors changed. I did not re-run those two mutants this round.
  - R2-04 kills the mutant that reverts to the command's first `--`.
  - `git diff 36df873..HEAD -- test/fixtures/guard-cases.json` has no removed lines. Every new fixture name ends in its task id. The CHANGELOG and `docs/cleanroom.md` lines moved with R2-02.
- **Mutation survivors.** Round 3 is past `review.mutationFixRounds` (2), so these are advisory and never tasks:
  - `expansionEnd`'s nesting: replacing `else if (c === open) depth++; else if (c === close && --depth === 0) return i;` with `else if (c === close) return i;` survived the `cleanroom` suite. No fixture has an inner `${…}` before the `<<`. `echo ${x:-${y}<<z}` NL `rm -rf .kukulu/cleanroom` would pin it: it is denied at HEAD, and bash runs line 2.
  - `expansionEnd`'s quote branch: deleting `else if (c === "'" || c === '"') quote = c;` survived. `echo ${x:-"}"<<y}` NL `rm -rf .kukulu/cleanroom` would pin it: it is denied at HEAD, and bash runs line 2.
  - `validateMutation`'s `filterAt !== -1 &&`: deleting it survived the `routing` suite. A command whose `{filter}` comes before a `cargo test -- …` with no filter after it is not tested either way. That is the reading R2-04's interpretation chose.
- Carried from round 1: `kukulu_next`'s `TOOLS` description still omits `description` from its result shape.
- Carried from round 1: P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
