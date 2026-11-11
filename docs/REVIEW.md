# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 1

**Verdict: CHANGES REQUESTED**

Reviewed all 21 task commits from `36df873` to `6c85f34` against SPEC v0.8.1 and PLAN.md. I ran `kukulu_verify` myself. `npm run lint`, `pre-commit` and `npm test` pass (4,720 assertions in 15 suites). The constraints result is `ok: false`, and finding 1 explains why. I also ran 12 mutants through `kukulu_mutate` and checked the guard against the merge base's `mcp/cleanroom.mjs` (a copy of `git show 36df873:mcp/cleanroom.mjs`, with both copies' `evaluate` given the same payloads).

## Findings

### 1. Category 1: the constraint `no-hardcoded-mcp-timeout` matches its own definition (`docs/kukulu.json:772-821`)

The rule's `paths` include `docs/`, and its `exclude` does not list `docs/kukulu.json`. That file holds the rule's own description, its pattern and its `shouldMatch` fixtures, so the scan reports 10 hits there on every run. `kukulu_verify` has therefore returned `ok: false` on every task of the flight. It also blocks a `kukulu_task_done` log that names the value. `kukulu_mutate` reports every mutant as "killed: constraint no-hardcoded-mcp-timeout caught the mutation", even when the test command passed, so each mutate result has to be read by hand (logged as feedback).

The code itself is clean: no file outside `.mcp.json` and `docs/kukulu.json` spells the value. The rule is wrong, not the code.

- **What breaks:** no task can ever show a green verify, and a real violation of this rule or any other is hidden behind a result that is always red.
- **Minimal fix:** add `"docs/kukulu.json"` to that rule's `exclude`. Change nothing else in the rule. (Task R1-01, from the planner's config.)

### 2. Guard regression: a misdetected heredoc hides the commands after it (`mcp/cleanroom.mjs:599-668`, `stripHeredocs`)

`stripHeredocs` treats any unquoted `<<` with a non-empty, non-numeric word as a heredoc operator. An unterminated body then runs to the end of the command. When the guard sees a heredoc that bash does not, every later line is swallowed as data. Each form below is denied at the merge base and allowed now:

| Command (`\n` is a newline) | merge base | now |
|---|---|---|
| `echo $((1<<n))\nrm -rf .kukulu/cleanroom` | denied | allowed |
| `(( x = y << z ))\nrm -rf .kukulu/cleanroom` | denied | allowed |
| `echo hi # see a<<b\nrm -rf .kukulu/cleanroom` | denied | allowed |
| `cat <<E'OF' > x.txt\nhi\nEOF\nrm -rf .kukulu/cleanroom` | denied | allowed |
| `cat <<"E"OF > x.txt\nhi\nEOF\nrm -rf .kukulu/cleanroom` | denied | allowed |

These are regressions (principle 1's first case) of an always-protected write by `rm -rf`, a command word the rules name.

- **Arithmetic and comments:** in `$((…))` and `((…))`, `<<` is a shift, and inside a comment it is not an operator. The implementer handled only an all-digit operand.
- **Partly quoted words:** bash removes the quotes from the whole delimiter word and treats it as quoted. The guard looks for the literal `E'OF'` and never finds it.
- **Minimal fix:** ignore `<<` inside an arithmetic `$((…))` or `((…))` and inside a `#` comment, and apply quote removal to the whole delimiter word. (Task R1-02.)

### 3. Guard regression: GNU sed's abbreviated `--in-place` is judged a read (`mcp/cleanroom.mjs:1528`, `sedScan`)

GNU `getopt_long` accepts any unambiguous prefix of a long option, and `--i` can only mean `--in-place`. So `sed --in s/a/b/ .mcp.json` and `sed --in-pl=.bak s/a/b/ .mcp.json` edit in place. Both were denied at the merge base and are allowed now, because `sedScan` matches only `--in-place` and `--in-place=`. The same applies to prefixes of `--expression`, `--file` and `--line-length`.

- **Minimal fix:** treat a long option that is a prefix of one of those four (at least `--i`, `--e`, `--f`, `--l`) the way the full name is treated. (Task R1-02.)

### 4. Category 3: `mcp/cleanroom.mjs` mechanics no test covers (mutation survivors)

Each of these passed `node test/cleanroom.mjs` (1359/1359) and both guard self-tests (574 and 570 cases):

- `if (t === "-i" && args[i + 1] === "") skip.add(++i);` deleted (`:1535`). The BSD empty suffix becomes the script, and the script becomes a write target. Today's fixtures pass only because `s/a/b/` resolves to an unprotected path.
- `c === "e" || c === "f" || c === "l"` changed to drop `l` (`:1538`). The value of `-l` becomes the script, and the script becomes a write target.
- `if (word === "" || /^\d+$/.test(word))` changed to `if (word === "")` (`:649`). The digits-only arithmetic rule has no test.

For contrast, these were killed: removing the shell-read body judgment (by the `bash <<'EOF'` fixture) and the verifier's `sameModel` call in check 12 (by `test/attest.mjs`). (Task R1-02.)

### 5. Category 3: `kukulu_release` results that no test covers (`mcp/server.mjs:5404`, `:5424`, `:5432`)

Each of these passed `node test/review.mjs` (491/491):

- `signed = archivedSigning === "on"` changed to `signed = false`. SPEC C-02 step 5 requires the signing outcome to be read from `origin/<base>:<archived.dir>/state.json`, and no test checks that a tag is signed because of it. This is an untested SPEC requirement.
- `localArchived?.slug === archived.slug ? "current"` changed to `false ? "current"`. The `"current"` value of `localState` is never asserted.
- `fastForward`'s `"up to date"` changed to always `"done"`. One of SPEC's five values is never asserted.

The killed control: making the timeout boundary `>` instead of `>=` failed four `test/routing.mjs` assertions. (Task R1-03.)

### 6. Category 5: the profile `policies` refusal does not match SPEC's text (`mcp/server.mjs:1503`)

SPEC D-02 gives `… profiles.fast.policies.push must be a boolean`. The server passes `where = "<path> profiles.<name>"`, and `validatePolicies` appends ` policies.<key>`, so the message reads `<path> profiles.fast policies.push must be a boolean`, with a space where SPEC has a dot. The test (`test/routing.mjs`, "a bad profile policies shape refuses naming the profile") pins the space form. PLAN's own parenthetical gives SPEC's form. (Task R1-04.)

### 7. Category 5: the `cargo test` refusal checks only the first `cargo` (`mcp/server.mjs:979`)

`words.indexOf("cargo")` finds only the first `cargo`. So `cargo build --release && cargo test {filter}` loads, although it runs `cargo test` with `{filter}` before `--`, which SPEC F-04 says must be refused. (Task R1-04.)

### 8. Category 5 (documentation): README's tool table still describes the old `finalize` default (`README.md:229`)

The `kukulu_pr_finalize` row says the tool "mark[s] the draft PR ready and, unless `breaking`, enable[s] auto-merge" unconditionally. SPEC §6 G requires README to state the new default wherever a sentence states it. (Task R1-04.)

## Spec issues

- **A-02's shell rule lets `cat <<EOF | bash` through.**
  - What changed: `cat <<EOF | bash` / `rm -rf .kukulu/cleanroom` / `EOF` was denied at the merge base, by accident of line splitting. It is allowed now, because the segment that owns the body is `cat`.
  - Why SPEC allows it: SPEC says a body is commands only when the owning segment's command word is a shell, and that "a denial may become an allow only when its body is data handed to a non-shell command".
  - What I did: the equivalent `printf '…' | bash` was never modelled, so I queued no task. The owner may want a later rule: a heredoc whose pipeline ends in `sh`, `bash`, `zsh`, `dash` or `ksh` is read as commands.
- **A-01's cluster rule is broader than sed.**
  - SPEC says any short-option cluster that contains `i` is in place. The implementation scans the cluster letter by letter and stops at `e`, `f` or `l`, whose value is the rest of the token. So `sed -ei .mcp.json` (the script is `i`) is judged a read.
  - That matches real sed and SPEC's goal ("a `sed` that does not edit in place is never judged a write"), but not the letter of the rule. I recommend changing SPEC's wording rather than the code.
- **Known-gap candidates:**
  - A heredoc piped into a shell (`cat <<EOF | sh`) is judged as data. This is the case above.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## Notes

- `kukulu_next`'s `TOOLS` description still lists its result as `{ stage, …, reason, prompt, streams? }` without `description`. `docs/mcp-tools.md` and go-flight do name it, so a model reading only the tool schema will not see it.
- P1-05: with no `Version:` line, the suggestion reads `<slug>-2 or <slug>-2`.
- Interpretation choices in HANDOFF.md:
  - P1-04 judges `localState` before the fast-forward. This is the more useful reading.
  - P2-03 always lists the group lines in `SIMILARITY.md`. SPEC's "names each group's negative and positive on its own line" allows it.
  - P3-03 leaves `kukulu_run_resume` out of the skill. This is forced by the plugin test.
  - P3-04 refuses a `cargo test` with no `--`. This is consistent with SPEC's "before a standalone `--`".
- Verified with no finding:
  - C-01's reorder, the D-01 single default and the D-02 layering.
  - The F-01 escapes, the F-02 `taskLog` and the F-03 tool line.
  - E-02 duplicated byte for byte, with the shared table in `test/attest.mjs`.
  - No existing guard fixture changed; the fixture diff is additions only.
  - No `.gitignore`, CI or editor-config edits.
