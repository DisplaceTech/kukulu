<!-- Kūkulu review, build/2026-10-19 -->
Round: 5

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 88 tasks are done. None are blocked or skipped.
- At `7b199c0`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,450 assertions.
- Round 4 changed only `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` and the pipeline files (`git diff --name-only 2d0cfba..HEAD`).
  - It did not touch `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `.gitignore`, `.gitattributes` or CI config.
  - No existing fixture line changed. Round 4 only added fixtures, 349 cases in all.
  - Each task updated rule 6 in `docs/cleanroom.md`.
- Every acceptance fixture that R4-01, R4-02 and R4-03 name is in `guard-cases.json`, with the expected decision and reason. I ran every round-4 probe (REVIEW round 4, F1 to F4) through `evaluate()` again. Each one is now denied, and every "stays allowed" form is still allowed.

Round 4's fixes hold for the forms round 4 named. Three problems remain:

- **R4-01 made one form looser again (F1).** `env -S -i curl https://evil` was denied at `2d0cfba` and is allowed at HEAD.
- **Option bundling and long-option abbreviation (F2).** The new `VALUED_OPTIONS` table and `destinationPaths` match only whole tokens, so `-iu`, `-tn`, `-vt` and `--target` still hide the command or the destination. The `-vt` form replaces the policy (D-10).
- **A bare glob operand (F3).** R4-02's new check judges a bare operand as a literal path only, so `cd ~/.cargo && cd r* && cat x` and `cd ~/.cargo && ls regis*` reach the registry.

I verified every bypass below against the real tools on this machine (GNU coreutils 9.4, findutils 4.9.0, sudo), using `echo` in place of `curl`. Each form ran its command.

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, cwd `/tmp/proj`, `planExists: true`
- D-10's protected set from `protectedPaths()`

The "at `2d0cfba`" column comes from `git show 2d0cfba:mcp/cleanroom.mjs`, run with the same inputs. That is the round-4 base.

### F1: After it splits `env -S`'s value, `commandWord` stops parsing options, so a split value that starts with an option hides the command (category 5, regression; SPEC D-03 canonicalization, rule 6a; task R4-01)

`mcp/cleanroom.mjs:572-583`: after the split words are put in place of the `-S` token, both branches `break` out of the option loop. The outer loop then takes the first split word as the command word, even when it is an option. GNU env parses the words of a split string as further arguments, options included: `env -S -i echo hi` prints `hi`.

| Command | at `2d0cfba` | at HEAD |
|---|---|---|
| `env -S -i curl https://evil` | denied (network) | **allowed** |
| `env -S '-i curl https://evil'` | allowed | allowed |
| `env -S'-u X curl https://evil'` | allowed | allowed |

At `2d0cfba`, round 3 skipped `-S`'s value (`-i`), and `curl` became the command. R4-01 now splits the value, but `break` makes `-i` the command word.

What breaks: one option in front of a network command gets past the network ban, and a fix round has made the guard looser for the second round running.

Minimal fix: after the split, put `i` back on the first split word and keep running the option loop (`continue`, not `break`). A leading `-i`, `-u X` or `-C dir` is then parsed as env's option, and the first non-option word ends the loop as usual.

### F2: A short-option bundle or a long-option abbreviation still hides a valued option's value, both in `commandWord` and in `destinationPaths`'s `-t` (category 5; SPEC D-10 self-protection, D-03 rules 6a and 6d; tasks R4-01, R4-03)

`commandWord` (`:586`) looks up a whole token in `VALUED_OPTIONS`. `destinationPaths` (`:997-999`) recognizes `-t` only alone, or first in a token (`/^-t./`). getopt does two things neither function handles:

- It scans a bundle `-abc` letter by letter. The first letter that takes a value consumes the rest of the token, or the next token if that letter is last.
- It accepts any unambiguous prefix of a long option (`--sig` for `--signal`).

All of these are allowed at HEAD:

- D-10 bypasses, each of which replaces a protected file (GNU `cp -vt d f` and `cp --target=d f` both write `d/f`):
  - `cp -vt docs evil/cleanroom.json` and `cp -rt docs evil/cleanroom.json`
  - `cp -vt .kukulu evil/state.json`
  - `install -Dt docs evil/cleanroom.json`
  - `ln -sft docs /evil/cleanroom.json`
  - `cp --target=docs evil/cleanroom.json` and `cp --target docs evil/cleanroom.json`
- Network bypasses:
  - `sudo -iu root curl https://evil` and `sudo -Eu root curl https://evil`. `sudo -iu root` is the common spelling.
  - `xargs -tn 1 curl https://evil` and `xargs -0I {} curl {}`
  - `env -vS 'curl https://evil'` and `env -vS'curl https://evil'`. These are the `-S` split inside a bundle.
  - `sudo --us root curl https://evil`, `timeout --sig KILL 5 curl https://evil`, `nice --adj 5 curl https://evil` and `env --split-str='curl https://evil'`

What breaks:

- Two plain calls, `cp -vt docs p/cleanroom.json` and `cp -vt .kukulu p/state.json`, replace the policy and the hash the gate pins it to. This is round 4's F4 again, spelled with one more letter.
- The network ban falls to one extra letter in front of the valued option.

Minimal fix:

- Write one option scanner, used by `commandWord` and by `destinationPaths`. Give it a wrapper's (or the write command's) valued short letters and valued long names. It handles:
  - a bundle `-abc`, where the first valued letter takes the rest of the token, or the next token if it is last
  - `--name=value`
  - `--name value`
  - an abbreviation `--na` that is a prefix of exactly one of the valued long names
- In `commandWord`, a bundle or abbreviation that resolves to env's `-S`/`--split-string` is split as in F1.
- In `destinationPaths`, `-t`/`--target-directory` resolved that way is the destination directory.
- The other valued options of cp, mv, ln and install (`-S -m -o -g`, `--suffix --mode --owner --group`) go through the same scanner.

Fold in one false positive of R4-03's own mechanic (`:1011`):

- A source that ends in `/` is treated as standing for the destination itself. GNU cp does not do this: `cp -r src/ dst` writes `dst/src` (checked on this machine).
- So `cp -r src/ .` and `cp -r vendor/ docs/` are denied `protected path` at HEAD, though they write `./src` and `docs/vendor`.
- Only a basename of `.` or `..` stands for the directory. `cp -r x/.. src` does copy into `src` itself, and that case is already handled correctly.
- REVIEW round 4's F4 text caused this. It described rsync's trailing-slash rule, not cp's, and R4-03 followed it.

### F3: R4-02's bare operand is judged only as a literal path, so a bare glob, or a `cd` into a glob, reaches a denied directory (category 5; SPEC D-03 rule 6b "a glob token whose wildcard components match a `deny.paths` entry"; task R4-02)

- R4-02 (`:883-888`) runs `pathVerdict` on a bare cd/pushd or read-family operand. `pathVerdict` is a literal prefix check.
- The glob check (`:892-896`) runs only on `isPathLike` tokens.
- A `cd` to a glob (`:970`) moves `shellCwd` to the literal glob text, so a later bare operand resolves under a directory name that matches nothing.

All of these are allowed at HEAD and at `2d0cfba`:

- `cd ~/.cargo && cd r* && cat x` and `cd ~/.cargo && cd ?egistry && cat x`
- `cd ~/.cargo && ls regis*`, `cd ~/.cargo && head -n 5 r*` and `cd ~/.cargo && grep foo r*`
- `cd ~/.carg? && cd registry && cat x`

The path-like spellings are already denied, for comparison: `cd ~/.cargo && cat regis*/x`, `cd ~/.cargo/r* && cat x`, `cat ~/.cargo/r*/x`.

What breaks: the gap R4-02 closed for `cd registry` stays open for `cd r*`. One wildcard reads the registry, which is the read `deny.paths` exists to stop.

Minimal fix:

- Run the glob check (`reachVerdict(token, shellCwd, false)`) on the same bare operands as R4-02's check, not only on `isPathLike` tokens.
- A `cd`/`pushd` to a glob operand keeps the wildcard in `shellCwd`. A later relative operand, joined to it, is then a glob, and the same check judges it. So `cd ~/.carg? && cd registry` is judged as `~/.carg?/registry`.
- Ordinary forms stay allowed: `cd src && ls *.rs`, `cd crates && cat */Cargo.toml`, `ls *.md`.

## Spec issues

- **The guard is lexical, and the loop is still not converging.** Round 3 found three spellings, round 4 four, and this round three. Two of this round's are in round 4's own mechanics (F1, F3), and one is the getopt class that round 4's table only half covered (F2).
  - This round's fix tasks ask for a getopt-style scanner and a shared glob path for bare operands, instead of another list of spellings. If that holds, the classes close rather than the instances.
  - The owner may still prefer to amend SPEC D-03 to say outright that wrapper and option parsing is best-effort, and stop here.
  - F1 (a regression) and F2's `cp -vt` (the policy replaced by a plain `cp`) are worth fixing either way.
  - This round is past `maxRounds` (3). The decision is the owner's.
- **Read-family words are judged only in path-like arguments** (SPEC D-03 rule 6c). So `cat zlib.txt` is allowed and `cat ./zlib.txt` is denied `forbidden word in path argument`. The code follows SPEC, and the inconsistency predates round 4. SPEC could say whether a bare file operand of a read-family command is a "path-like argument".
- **SPEC D-03 makes `git` write-family as a whole** (carried from rounds 3 and 4). `git add docs/*` is denied `protected path`.
- Carried from rounds 2 to 4, still open:
  - SPEC F-04's `--roots`/`--words` defaults were superseded by the owner's `e7ef4d4`.
  - D-03's write, network and wrapper lists are incomplete. For example, `rsync evil/cleanroom.json docs/` and `tar xf evil.tar -C docs` are allowed. `KNOWN_LIMITS` names rsync.
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
  - Confirm the site, ci and lint checks are green on the PR.
- From HANDOFF's first line: the owner runs one clean-room flight from the working tree before merging.
- From HANDOFF: after this branch meets `cleanroom`, change `fromas of 0.7.0` to `as of 0.7.0` in `docs/site/mockup.html` and `site/index.html`.
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 5. Include:
  - `cd ~/.cargo/registry && cat x`
  - `(curl https://example.com)`
  - `cd && cat .cargo/registry/x`
  - `cp evil .kukulu/state.*`
  - `env -S -i curl https://example.com`
  - `cp -vt docs x/cleanroom.json`
  - `cd ~/.cargo && cd r* && cat x`

## Notes

- **These fix tasks are not driven by mutation results.** All three findings come from probing `evaluate()` against SPEC D-03 and D-10, and checking each form against the real tools. None comes from a surviving mutant, so each task is `review`-sourced.
- **Mutation sampling.** Per the review-build rule for round 2 and later, I mutated only `mcp/cleanroom.mjs`, the one source file in `git diff --name-only 2d0cfba..HEAD`. I used the targeted `cleanroom` suite with `confirmKill`. Three mutants were killed, and each was confirmed by a clean re-run:
  - Disabling the attached `-S<value>` split.
  - Dropping `READ_FAMILY` from R4-02's bare-operand check.
  - Dropping `time -o --output` from `VALUED_OPTIONS`.
  - All three failed through the gate's guard self-test ("the first kukulu_next in a clean-room project goes on to the plan stage": `halt`), which runs the fixture file.
- **Advisory survivors.** This is round 5, past `review.mutationFixRounds` (2), so these are not tasks. The summarizer carries them.
  - Deleting `destinationPaths`' attached-`-t` branch (`:999`). No fixture uses `cp -tdocs x`. R5-02's scanner replaces this line, and its fixtures should cover the attached form.
  - Deleting the `-S -m -o -g` value skip (`:1000`). This is harmless. Without it the value becomes an extra source, which only adds a landing path.
  - Deleting the wildcard check on landing paths (`:932-933`). The operand-wildcard check of R3-02 already denies `cp x/cleanroom.json do*`.
  - Deleting the arm pattern's optional leading `(` (`:1333`). This is harmless, because the grouping strip already drops a leading `(`.
  - The survivors from rounds 3 and 4 are still advisory.
