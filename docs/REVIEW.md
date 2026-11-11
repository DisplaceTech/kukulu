# Review: build/2026-11-11 (Kūkulu 0.8.1)
Round: 2

**Verdict: CHANGES REQUESTED**

Reviewed the round-1 fix commits `ea1a1c9` to `135b775` (R1-01 to R1-04) from `2f92562` to `7c49fa8`, against SPEC v0.8.1, PLAN.md's `## Review fixes (round 1)` and the round-1 findings. I ran `kukulu_verify` myself. All 33 constraints are `ok` with no hits, so R1-01 worked. Every suite passes (`state`, `implement`, `review`, `routing`, `cleanroom`, `attest` and the rest) except `plugin`, which fails one assertion. `npm run lint` and `pre-commit` fail on that same check, and finding 1 explains it. I ran 8 mutants through `kukulu_mutate` on the round's files. I also ran the guard forms below through both HEAD's `evaluate` and the merge base's (`git show 36df873:mcp/cleanroom.mjs` in a temp directory), and checked each against real bash.

`prChecks` is `fail`. Four checks fail on PR #6: `test (node 22)`, `test (node 24)`, `test (node 26)` and `pre-commit (yamllint / shellcheck / markdownlint / gitleaks)`. `test (no gh on PATH)` was pending. `gitleaks`, `actionlint`, `site checks` and Cloudflare Pages pass. The job logs show that every failure is the single `check-names` line of finding 1.

## Findings

### 1. Category 3: CI and local lint are red on `docs/PLAN.md:525` (`check-names`)

`scripts/check-names.mjs` reports `docs/PLAN.md:525: the display name is written Kūkulu in prose, with the macron; ASCII spellings belong in code spans only`. The line is R1-01's **Out of scope** field. It is text that my own round-1 submission put into PLAN.md through `kukulu_review_submit`: the display name spelled in ASCII, in prose. The implementer correctly declined to edit PLAN.md by hand.

- **What breaks:** `npm run lint`, `pre-commit run --all-files` and the `plugin` suite all fail, and so do the four CI checks named above. `kukulu_verify` cannot return `ok: true` while this stands.
- **Minimal fix:** in `docs/PLAN.md:525`, replace the ASCII spelling with the display name written with U+016B. Change no other byte of PLAN.md. This is the one hand edit of PLAN.md this review sanctions, because no tool can amend a committed fix section. (Task R2-01.)
- Logged as pipeline friction: `kukulu_review_submit` does not run the name check on the text it appends.

### 2. Guard regression: `<<` inside `${...}` or `$[...]` is still read as a heredoc (`mcp/cleanroom.mjs:599-696`, `stripHeredocs`)

R1-02 taught `stripHeredocs` to skip `<<` inside `$((...))`, `((...))` and comments. It still treats a `<<` inside a parameter expansion `${...}` or inside the old arithmetic form `$[...]` as a heredoc operator. The unterminated "body" then swallows every later line. Bash runs those lines, as the last column shows. Each form below was denied at the merge base and is allowed at HEAD (`\n` is a newline):

| Command | merge base | HEAD | bash runs the second line |
|---|---|---|---|
| `echo $[1<<n]\nrm -rf .kukulu/cleanroom` | denied | allowed | yes |
| `echo ${x#<<y}\nrm -rf .kukulu/cleanroom` | denied | allowed | yes |
| `echo ${x:-<<y}\nrm -rf .kukulu/cleanroom` | denied | allowed | yes |
| `y=${x/<</z}\nrm -rf .kukulu/cleanroom` | denied | allowed | yes |

This is principle 1's first case: a regression of an always-protected write by `rm -rf`, a command word the rules name. It is the same class as round-1 finding 2, which R1-02 fixed only for `((`.

For contrast, `echo ${#x}<<y` ends the expansion before the `<<`. Bash reads that as a real heredoc, and the guard does too, which is correct.

- **Minimal fix:** in `stripHeredocs`, copy a `${...}` region through to its matching `}` (quote-aware, nesting-aware) and a `$[...]` region through to its matching `]`, without looking for `<<` inside them. This works the way the `((` branch does. (Task R2-02.)

### 3. Category 3: two mechanics R1-02 added that no test covers (mutation survivors in `mcp/cleanroom.mjs`)

Each of these passed the targeted `cleanroom` suite (1371/1371), which includes the gate's guard self-test:

- `if (!hasValue && i + 1 < args.length) skip.add(++i);` in `sedScan` changed to `if (i + 1 < args.length) skip.add(++i);` survived. An attached `--expression=<script>` (or `--e=…`, `--file=…`, `--l=…`) would then swallow the next token. So `sed --expression=s/a/b/ -i .mcp.json` would skip `-i` and be judged a read. It is denied at HEAD and at the merge base, so the mutant is a silent regression no fixture pins.
- `arithmeticEnd`'s `return command[i - 1] === ")" ? i : -1;` changed to `return i;` survived. The `))` check is what tells `((cd src); cat <<'EOF' …)`, a subshell holding a heredoc, apart from arithmetic. HEAD allows `((cd src); cat <<'EOF' > notes.txt\n$(rm -rf .kukulu)\nEOF\n)`, because the quoted body is data (SPEC A-02). Under the mutant it is denied. No fixture pins it.

Killed this round:

- the comment branch disabled;
- `--in-place`'s minimum prefix raised to 3;
- the backslash-quoted delimiter's `quoted = true` deleted;
- the R1-04 `cargo` loop cut to the first `cargo`;
- the profile joiner `"."` changed to `" "`;
- R1-03's `signed = archivedSigning === "on"` changed to `false`.

(Task R2-03.)

### 4. Category 5: the `cargo test` refusal uses the command's first `--`, not the one after that `cargo test` (`mcp/server.mjs:982-990`)

R1-04 made `validateMutation` loop over every `cargo`. But `dashes` and `filterAt` are still computed once for the whole command, so the check compares against the first `--` anywhere. `cargo fmt -- --check && cargo test {filter}` therefore loads, although its `cargo test` gets `{filter}` with no `--` of its own. SPEC F-04 requires that refusal. The reverse order, `cargo test {filter} && cargo fmt -- --check`, is refused only by accident of the same comparison.

- **Minimal fix:** for each `cargo … test` occurrence at word `k`, take the first `--` after `k` and the first `{filter}` word after `k`. Refuse when the filter comes before that `--`, or when no `--` follows. The refusal text does not change. (Task R2-04.)

## Spec issues

- **A-02's unterminated heredoc.** Every misdetected heredoc found so far is unterminated (its "delimiter" never appears as a line). When a heredoc is truly unterminated, bash warns and runs nothing after it. So judging an unterminated body as commands, as well as data, would cost nothing in a real command and would close this whole class of regression. SPEC says an unterminated body "runs to the end of the command" and is data, so I queued only the narrow fix. The owner may want that rule in a later release.
- **Carried from round 1, still open for the owner:**
  - A heredoc piped into a shell (`cat <<EOF | bash`) is judged as data.
  - A-01's "a cluster that contains `i`" wording is broader than the implementation's getopt reading of `-e`/`-f`/`-l` values.
- **Known-gap candidates:**
  - A heredoc piped into a shell (`cat <<EOF | sh`) is read as data.

## Manual checks still owed

From HANDOFF.md, all NOT VERIFIED (human):

- **Phase 0:** in a live clean-room session with `claude --plugin-dir .`, `sed -n 1p .kukulu/cleanroom/log.jsonl` and a heredoc that writes prior-art paths into a scratch file are allowed. The apostrophe case (`cat <<EOF > x.txt` / `it's fine` / `EOF` / `rm -rf .kukulu/cleanroom`) is denied.
- **Phase 1:** with the working tree as the plugin, a `kukulu_verify` whose `extraVerify` sleeps 40 minutes returns its result instead of an idle-timeout error. After a clean-room flight's archive, `git checkout main` succeeds from the build branch with no stash.
- **Phase 2:** with `policies.finalize "draft"` in the owner's global file, `kukulu_config_show` in a project with no policies block reports finalize `"draft"`, with `policySources.finalize` `"global"`.
- **Phase 3:** on the next flight, go-flight's first `Agent` call carries `description` and does not fail validation. `cargo test --workspace -- a b` runs both filters on a stable Rust toolchain.

## Notes

- **R1-01 to R1-04 verified:**
  - R1-01's exclude is the only change to `docs/kukulu.json`, and every constraint is clean.
  - R1-02's ten fixtures all carry `(R1-02)`, and `git diff 36df873..HEAD -- test/fixtures/guard-cases.json` has no removed lines.
  - R1-03's three tests each kill their round-1 mutant.
  - R1-04's profile messages match SPEC D-02's dotted form, and README's finalize row is right.
- Carried from round 1: `kukulu_next`'s `TOOLS` description still omits `description` from its result shape.
- Carried from round 1: P1-05's suggestion reads `<slug>-2 or <slug>-2` when the SPEC has no `Version:` line.
- R1-02's interpretation (an unclosed `((` is not arithmetic) is the safe reading: the heredoc is then still detected and its body read as data, as at a plain `<<`.
