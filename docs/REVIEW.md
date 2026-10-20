<!-- Kūkulu review, build/2026-10-19 -->
Round: 4

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 85 tasks are done. None are blocked or skipped.
- At `050cb9f`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,407 assertions.
  - The guard self-test passes: 310 cases.
- **PR #1's CI is all green at `050cb9f`, `test (macos)` included** (7m9s; `gh pr checks`, because the installed 0.6.1 `kukulu_status` has no `prChecks`). So round 3's F1 is fixed, and R3-01's owed manual check is done.
- Round 3 changed only `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` and the pipeline files (`git diff --name-only 42a0c08..HEAD`).
  - It did not touch `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `.gitignore`, `.gitattributes` or CI config.
  - The only existing fixture line that changed is R3-01's Glob-climb pattern. The other 42 fixtures were added.
- Every acceptance fixture that R3-02 and R3-03 name is in `guard-cases.json`, with the expected decision and reason. I also ran every round-3 probe (REVIEW round 3, F2 and F3) through `evaluate()` again. Each one is now denied, and every "stays allowed" form is still allowed.

Round 3's fixes hold for the forms round 3 named. Four problems remain, each a spelling the round-3 mechanics do not cover:

- **R3-03 made one form looser (F1).** `env -S curl https://evil` was denied at `43afd66` and is allowed at HEAD.
- **Gaps in R3-03's own mechanic (F2).** The compact function header `f(){`, a case arm with no space after `)`, the long-option spellings of the valued wrapper options, and the valued options of `xargs`, `stdbuf` and `time` all still hide the command.
- **Gap in the `cd` tracking from R2-01 and R3-03 (F3).** A `cd` operand without a `/` moves the shell without being judged, so `cd ~/.cargo && cd registry && cat x` reads the registry.
- **A gap in rule 6d since P3 that no round named (F4).** A write-family command whose destination is a directory overwrites a protected file without naming it. `cp x/cleanroom.json docs/` and `cp x/state.json .kukulu/` replace both the policy and the hash the gate pins it to.

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, cwd `/tmp/proj`, `planExists: true`
- D-10's protected set from `protectedPaths()`: policy path, plugin root, key path

The "at `43afd66`" column comes from `git show 43afd66:mcp/cleanroom.mjs`, run with the same inputs.

### F1: R3-03 skips `env -S`'s value, but that value *is* the command, so `env -S curl https://evil` became allowed (category 5, regression; SPEC D-03 canonicalization, rule 6a; task R3-03)

`mcp/cleanroom.mjs:562` reads:

```js
if (base === "env" && /^-[uCS]$/.test(flag) && i < tokens.length) i++;
```

- GNU `env -S STRING` (`--split-string`) splits STRING into words and runs them as the command, followed by the remaining arguments.
- So in `env -S curl https://evil`, the word `curl` is the command. The guard skips it as a flag value and takes `https://evil` as the command word.

| Command | at `43afd66` | at HEAD |
|---|---|---|
| `env -S curl https://evil` | denied (network) | **allowed** |
| `env -S 'curl https://evil'` | allowed | allowed |
| `env --split-string='curl https://evil'` | allowed | allowed |

Round 3's own F3 fix text listed `-S` among the values to skip. That was the review's mistake, and the implementer followed it exactly.

What breaks: one word in front of any network command gets past the network ban again. A fix round made the guard looser than it was before.

Minimal fix:

- Do not skip `-S`/`--split-string`'s value. Split it with `shellWords`, put the words back in its place, and keep judging, so the first of them becomes the command word.
- Alternatively, judge `<value> <rest…>` as a further command line, the way the `sh -c` string is judged.

### F2: The function header `f(){`, an arm `x)cmd`, the long-option spellings of the valued wrapper options, and the valued options of `xargs`, `stdbuf` and `time` still hide the command (category 5; SPEC D-03 "a wrapper (`sudo`, `env`, `time`, `command`, `xargs`, `nice`) with its flags"; tasks R3-03, R2-02, P3-09)

All of these are allowed at HEAD, and bash runs `curl` in every one:

- Grammar that `stripGrouping` (`:1243`, `:1251`) does not match:
  - `f(){ curl https://evil; }; f` and `function f(){ curl https://evil; }`. The header pattern `[\w.:-]+\s*\(\s*\)(?=\s|$)` requires whitespace after `()`, but `f(){` is the common compact spelling.
  - `case x in x)curl https://evil;; esac`. The arm pattern `^[^\s()]+\)(?:\s+|$)` requires whitespace after `)`.
- Long-option spellings of the values R3-03 skips in short form (`commandWord`, `:556-563`). `getopt_long` accepts the value as the next word:
  - `sudo --user root curl https://evil`
  - `env --unset X curl https://evil` and `env --chdir /tmp curl https://evil`
  - `timeout --signal KILL 5 curl https://evil` and `timeout --kill-after 5 10 curl https://evil`
  - `nice --adjustment 5 curl https://evil`
  - The `=` forms (`--user=root`) are one token, and those are already denied.
- Valued options of the other wrappers on the list, which SPEC D-03 names "with its flags":
  - `xargs -n 1 curl https://evil`, `xargs -I {} curl {}`, `xargs -P 4 curl`
  - `stdbuf -o L curl https://evil`
  - `time -o /tmp/t curl https://evil` and `time -f %e curl …`. This is `/usr/bin/time`, or `command time`.

What breaks: the same one-word bypass of the network ban that R3-03 closed for the short options. Any write or read command hides the same way.

Minimal fix:

- A table of valued options per wrapper, short and long, read by `commandWord`:
  - `sudo`: `-u -g -h -p -C -D -r -t -U` and `--user --group --host --prompt --close-from --chdir --role --type --other-user`
  - `env`: `-u -C` and `--unset --chdir`
  - `timeout`: `-s -k` and `--signal --kill-after`
  - `nice`: `-n` and `--adjustment`
  - `xargs`: `-n -L -P -I -i -d -E -s -a` and `--max-args --max-lines --max-procs --replace --delimiter --eof --max-chars --arg-file`
  - `stdbuf`: `-i -o -e` and `--input --output --error`
  - `time`: `-o -f` and `--output --format`
- The function-header lookahead also accepts `{`.
- The arm pattern accepts no whitespace after `)`, and an optional leading `(`.

### F3: A `cd`/`pushd` operand without a `/` is not judged by rule 6b, so two `cd`s reach a denied directory (category 5; SPEC D-03 canonicalization "made absolute against the input's `cwd`", rule 6b; tasks R2-01, R3-03)

Rule 6b (`:833`) judges only `isPathLike` tokens, meaning tokens with a `/` or a leading `~` or `.`. The `cd` handler (`:920-927`) still moves `shellCwd` to whatever the operand names. So the first `cd` reaches a directory outside every deny entry, and the second moves under one, unjudged:

- Allowed at HEAD and at `43afd66`:
  - `cd ~/.cargo && cd registry && cat x`
  - `cd ~/.cargo && pushd registry && cat x`
  - `cd ~/.cargo && ls registry`
- Already denied, for comparison: `cd ~/.cargo && cat registry/x` (path-like) and `cd ~/.cargo && grep -r foo registry` (recursive reach).

What breaks: `deny.paths` can be read by splitting the path across two `cd`s. That is the exact read the policy exists to stop.

Minimal fix:

- Every non-option operand of `cd`/`pushd` is a path for rule 6b, resolved against `shellCwd`.
- So is every non-option operand of a read-family command that `patternOperands` does not mark as text.
- A bare word that resolves under a `deny.paths` entry does name it, so this adds no false positive inside the repository.

### F4: A write-family command whose destination is a directory overwrites a protected file it never names (category 5; SPEC D-10 self-protection, D-03 rule 6d; task P3 rule 6d, never named by a review round)

Rule 6d (`:879-889`) judges each operand as a path. `cp`, `mv`, `ln` and `install` write to `<directory>/<basename of the source>` when the destination is a directory, and the guard never builds that path. All of these are allowed at HEAD and at `43afd66`:

- `cp evil/cleanroom.json docs/` and `cp evil/cleanroom.json docs`. These replace the policy.
- `cp evil/state.json .kukulu/` and `cd .kukulu && cp /tmp/state.json .`. These replace `state.json`, which holds the gate's pinned `policyHash`.
- `cp evil/.mcp.json .`. This replaces the MCP server configuration.
- `mv evil/cleanroom.json docs/`, `install evil/cleanroom.json docs/` and `ln -sf /evil/cleanroom.json docs/`.
- `cp -t docs evil/cleanroom.json` and `cp --target-directory=docs evil/cleanroom.json`.
- `cp -r evil/. .kukulu/`. A recursive copy into a directory that holds protected files.

What breaks:

- Two allowed calls replace both the policy and the hash the gate compares it with (`cp p/cleanroom.json docs/` and `cp p/state.json .kukulu/`), so gate check 2 passes under a policy the human never wrote.
- The verifier only reports such a change ("policy changed at seq n"). It does not fail.
- D-10 says no write-family command may touch these paths. The literal forms (`cp x docs/cleanroom.json`) are denied, so the protection holds only against an agent that names the file.

Minimal fix:

- For `cp`, `mv`, `ln` and `install`, find the destination directory: the `-t`/`--target-directory` value, else the last operand.
- For each source, judge `<destination>/<basename(source)>` as a write target with the existing literal and `wildcardNames` checks. A source basename of `.` or `/`-terminated stands for the destination itself.
- With a recursive `cp` (`-r -R -a`, `--recursive`, `--archive`), a destination that equals or contains a protected path is denied, as in the destructive-form check.
- Ordinary forms keep their decisions: `cp a.rs src/`, `cp a.txt docs/`, `cp target/release/x .`, `cp -r assets build/`, `cp README.md docs/`.

## Spec issues

- **The guard is lexical, and the loop has stopped converging on its own.** Round 3 found three more spellings, and this round found four. Two are in the round's own mechanics (F1, F2) and two predate it (F3, F4). Each fix is small and each is real, but `python3 -c` (a stated known gap) already does all of them.
  - SPEC D-03 could say outright that the guard is a tripwire, with tamper evidence behind it, not a sandbox. It could then list "argument parsing of wrappers and shell grammar is best-effort" as a known limit.
  - The owner may then prefer to approve with F2's long tail stated as a limit rather than run a fifth round.
  - F1 (a regression) and F4 (the protected set replaced by a plain `cp`) are worth fixing either way.
  - This round is past `maxRounds` (3). The decision is the owner's.
- **SPEC D-03 makes `git` write-family as a whole** (carried from round 3). R3-02 extends this to wildcards, so `git add docs/*` is now denied `protected path`, just as `git add docs/cleanroom.json` already was. The code follows SPEC. A list of git's read-only and index-only subcommands would remove these false positives.
- Carried from rounds 2 and 3, still open:
  - SPEC F-04's `--roots`/`--words` defaults were superseded by the owner's `e7ef4d4`.
  - D-03's write, network and wrapper lists are incomplete.
  - The log's uncommitted tail is unsigned.
  - D-08 check 3 does not pin `mcp/cleanroom.mjs`.
  - D-03's known gaps omit shell expansion.
  - SPEC §1 asks for the PR against `main` while `baseBranch` is `cleanroom`.

## Manual checks still owed

All `NOT VERIFIED (human)`, copied from HANDOFF.md.

- Phase 0 (P0-07): run the installed 0.6.1 plugin's `kukulu_migrate` on a throwaway `.foundry/` project, then run one task on it with the working-tree plugin.
- Phase 1 (P1-14): halt a throwaway flight with `kukulu_run_halt` and fix nothing. Call `kukulu_run_resume` and confirm the refusal names the dirty tree. Clean the tree and confirm the resume commit.
- Phase 2 (P2-03): create `docs/feedback/.private-names` with one real name and run `npm run lint`. It must fail without printing the name. Delete the file and it must print the skipped line.
- Phase 3 (P3-21):
  1. Copy `templates/cleanroom.example.json` into a throwaway Rust project as `docs/cleanroom.json`.
  2. Start a new session with the working-tree plugin and ask it to read `~/.cargo/registry`.
  3. Confirm the denial appears in the session and in `.kukulu/cleanroom/log.jsonl`.
  4. Type one instruction and confirm a `human` entry.
  5. Run `/kukulu:go-flight` and confirm `gate: ok (7 checks)` before the plan stage.
- Phase 4 (P4-09): run `kukulu_similarity` against the cleanflate-bench subjects at `7f50ce6` (reference pairs from `d047d66`). Record the identifier and comment Jaccard values next to the canonical 0.021 / 0.019 / 0.095 and 0.0003 / 0.0010 / 0.032. The ordering must agree.
- Phase 5 (P5-09): copy a bundle to a machine without this repository and run `node verify.mjs . --key <fingerprint>`; confirm PASS. Change one byte of `log.jsonl` and confirm FAIL names the line.
- Phase 6 (P6-05):
  - Deploy the build branch as a Cloudflare Pages preview.
  - Read every clean-room line against what the suite proves.
  - Compare the page with the changed mockup at 360, 768 and 1440 px in both schemes.
  - Confirm the site, ci and lint checks are green on the PR. At `050cb9f` they are, `test (macos)` included.
- R3-01's owed check, "`gh pr checks` shows `test (macos)` green after the push": done by this review at `050cb9f`.
- From HANDOFF's first line: the owner runs one clean-room flight from the working tree before merging.
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 4. Include:
  - `cd ~/.cargo/registry && cat x`
  - `(curl https://example.com)`
  - `cd && cat .cargo/registry/x`
  - `cp evil .kukulu/state.*`
  - `env -S curl https://example.com`
  - `cp x/cleanroom.json docs/`

## Notes

- **These fix tasks are not driven by mutation results.** All four findings come from probing `evaluate()` against SPEC D-03 and D-10. None comes from a surviving mutant, so each task is `review`-sourced.
- **Mutation sampling.** Per the review-build rule for round 2 and later, I mutated only the files in `git diff --name-only 42a0c08..HEAD`. I used the targeted `cleanroom` suite with `confirmKill`. Killed:
  - `guard-cases.json`'s 40-level climb cut back to six levels. This was caught by the new "the guard self-test passes under a deep TMPDIR", so R3-01's regression test does what it claims.
  - The bare-`cd`-to-HOME move.
  - `env`'s `-C` value skip.
  - The case-arm strip.
  - The `read-tree -u` discard form.
- **Advisory survivors.** This is round 4, past `review.mutationFixRounds` (2), so these are not tasks. The summarizer carries them.
  - Deleting `braceExpand` on redirection targets (`:868`). This is harmless: bash refuses a redirection whose word brace-expands to more than one word ("ambiguous redirect"), and a group without a comma is not expanded, so the mechanic guards a form the shell never runs.
  - Deleting `wildcardNames`' dotfile exemption (`:1169`). No fixture pins it. Without it the guard only gets stricter, for example `cp a ?kukulu/x`.
  - Round 3's four survivors (`stash save`, `timeout -s/-k`, `cp -a`, `**` in `reachesDenied`) are still advisory.
- **R3-02's interpretation line is inaccurate.** It says "`cp a *` stays allowed". With the example policy, `cp a *` is denied, because `*` can name `tools/` (the policy's `protected` entry). That is correct: if `tools` sorts last, `cp` writes into it. The dotfile rule itself matches the shell. No fixture asserts the claim, so nothing is wrong but the sentence.
- **R3-01's test name.** It reads "…under a deep TMPDIR", not the plan's "…deep, symlinked TMPDIR". The implementer's reason holds: `os.tmpdir()` returns `TMPDIR` as spelled, and the guard resolves textually, so a shallow symlink hides the depth. The mutant above confirms that the deep path fails with the old fixture.
