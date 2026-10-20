<!-- Kūkulu review, build/2026-10-19 -->
Round: 6

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

CHANGES REQUESTED

What I checked:

- All 91 tasks are done. None are blocked or skipped.
- At `b6846fe`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,488 assertions.
- Round 5 changed only `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md` and the pipeline files (`git diff --name-only b68996b..HEAD`). The one other change is the owner's `4c17d9a` (`maxRounds` 3 to 4 in `docs/kukulu.json`).
  - Round 5 did not touch `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `.gitignore`, `.gitattributes` or CI config.
  - No existing fixture line changed. Round 5 only added fixtures, 387 named cases in all.
  - Each task updated rule 6 in `docs/cleanroom.md`. Each commit follows the template and is signed.
- Every acceptance fixture that R5-01, R5-02 and R5-03 name is in `guard-cases.json`, with the expected decision. I ran every round-5 probe (REVIEW round 5, F1 to F3) through `evaluate()` again. Each one is now denied, and every "stays allowed" form is still allowed, including `cp -r src/ .` and `cp -r vendor/ docs/`.

Round 5's fixes hold for every form round 5 named. Two problems remain, and both are in the option parsing that rounds 4 and 5 built:

- **The wrapper scanner loosens the guard for xargs (F1).** `xargs -i curl https://evil` was denied at `2d0cfba` and is allowed since R4-01. `xargs -0i curl https://evil` was denied at `b68996b` and is allowed since R5-01. A fix round has made the guard looser for the third round running.
- **cp's other option forms still hide where a recursive copy lands (F2).** `cp -rT evil docs` and `cp --rec evil/. docs` each replace `docs/cleanroom.json`, and both are allowed.

I checked every bypass below against the real tools on this machine, using `echo` in place of `curl` and a scratch directory in place of the project. The tools are GNU coreutils 9.4, findutils 4.9.0 and sudo 1.9.15p5. Each form ran its command or replaced the file.

## Findings

Most severe first. Every probe ran `evaluate()` with these settings:

- policy: `templates/cleanroom.example.json`
- root `/tmp/proj`, home `/home/u`, cwd `/tmp/proj`, `planExists: true`
- D-10's protected set from `protectedPaths()`

The "at `2d0cfba`" and "at `b68996b`" columns come from `git show <rev>:mcp/cleanroom.mjs`, run with the same inputs.

### F1: xargs options whose argument is optional are read as taking the next token, so the command word is skipped (category 5, regression; SPEC D-03 canonicalization "a wrapper (`sudo`, `env`, `time`, `command`, `xargs`, `nice`) with its flags", rule 6a; tasks R4-01, R5-01)

`mcp/cleanroom.mjs:545` lists `-i`, `--replace`, `--max-lines` and `--eof` as valued xargs options. In GNU xargs they take an optional argument: `-i[replace-str]`, `--replace[=replace-str]`, `--max-lines[=max-lines]` and `--eof[=eof-str]`. Such an argument is only ever attached to the flag. The next token is never consumed, so it is the command. `scanOption` (`:573`) then skips that token as the value, and `commandWord` takes the URL as the command word.

| Command | at `2d0cfba` | at `b68996b` | at HEAD |
|---|---|---|---|
| `xargs -i curl https://evil` | denied | **allowed** | **allowed** |
| `xargs --replace curl https://evil` | denied | **allowed** | **allowed** |
| `xargs --max-lines curl https://evil` | denied | **allowed** | **allowed** |
| `xargs --eof curl https://evil` | denied | **allowed** | **allowed** |
| `xargs -0i curl https://evil` | denied | denied | **allowed** |

On this machine, `echo a | xargs -i echo X{}`, `xargs --replace echo Y{}`, `xargs -0i echo Z{}`, `xargs --max-lines echo W` and `xargs --eof echo V` each run `echo`.

What breaks: one optional-argument flag in front of a network command gets past the network ban. `xargs -i` is a common spelling. R4-01 opened the gap. R5-01 widened it to bundles: a bundle such as `-0i` now ends on a valued letter, so it consumes the next token.

Minimal fix:

- Give `scanOption` a third set, the options that take an optional argument.
- Such an option takes only an attached value: the rest of a short bundle, possibly empty, or the `=value` of a long option. It never takes the next token.
- xargs's optional options are short `-i -l -e` and long `--replace --max-lines --eof`. Move `-i`, `--replace`, `--max-lines` and `--eof` out of xargs's valued list.

Fold in two smaller gaps in the same mechanic:

- **env -S's own separator.** GNU env's `-S` string treats `\_` as a word separator outside quotes, and as a space inside them. `shellWords` reads `\_` as an escaped `_`.
  - So `env -S 'curl\_https://evil'` and `env -S"curl\_-s\_https://evil"` are allowed at every revision.
  - `env -S 'echo\_hi\_there'` prints `hi there` here.
  - R5-01's split claims to read the string as GNU env does.
  - Fix: replace each `\_` in the value with a space before `shellWords` splits it. That gives exactly GNU's meaning in both places.
- **Valued options missing from the table.**
  - sudo's `-R/--chroot` and `-T/--command-timeout`: `sudo -h` lists both here as `-R directory` and `-T timeout`.
  - BSD and macOS env's `-P altpath`. The suite runs on macOS.
  - `sudo -R / curl https://evil`, `sudo -T 60 curl https://evil` and `env -P /usr/bin curl https://evil` are allowed. The first two run only when sudoers permits them, and the third runs on BSD env.
  - Fix: add the three to `VALUED_OPTIONS`.

### F2: destinationPaths reads cp's `-T` not at all and its recursive flags only spelled out, so a recursive copy that lands on a protected directory passes (category 5; SPEC D-10 self-protection, D-03 rule 6d; tasks R4-03, R5-02)

`destinationPaths` (`mcp/cleanroom.mjs:1027-1060`) has two gaps:

- **`-T`.** With `-T` (`--no-target-directory`), cp treats the last operand as the destination itself, not as a directory to copy into. `cp -rT evil docs` copies `evil`'s contents into `docs` and replaces `docs/cleanroom.json`. The function does not recognize `-T`, so it judges `docs/evil`, and that holds no protected path.
- **Abbreviated recursive flags.** Recursion is recognized only from short bundles or the exact `--recursive` and `--archive` (`:1046`). GNU cp accepts any unique prefix, such as `--rec` or `--arch`. So `cp --rec evil/. docs` is not seen as recursive, though `cp --recursive evil/. docs` is denied.

All of these are allowed at HEAD and at `b68996b`:

- `cp -rT evil docs`, `cp -Tr evil docs/` and `cp -r --no-target-directory evil docs`
- `cp -r --no-t evil docs`
- `cp -aT evil .kukulu`, which replaces `.kukulu/state.json`
- `cp --rec evil/. docs` and `cp --arch evil/. .kukulu`

On this machine, `cp -rT evil docs`, `cp -r --no-t evil docs` and `cp --rec evil/. docs` each replaced `docs/cleanroom.json` with `evil/cleanroom.json`.

What breaks: one plain `cp` replaces the policy, or the state file that pins its hash. This is round 4's F4 and round 5's F2, in the flag spellings that round 5's fix left whole-token: `-T`, and long-option abbreviation for the non-valued flags.

Minimal fix:

- In `destinationPaths`, read `-T` from a short bundle, and `--no-target-directory` by unique prefix among cp's long options (`--no-t` is enough).
- With `-T`, the last operand is the destination, and every source stands for it. Each target is then `dir`, and the existing recursive-containment check denies `docs`.
- Read `--recursive` and `--archive` by unique prefix too (`--rec`, `--arch`). Among cp's long options, `--rec` is unique (against `--reflink` and `--remove-destination`), and so is `--ar` (against `--attributes-only`).

## Spec issues

- **The guard is lexical, and the loop is still not converging.** Round 3 found three spellings, round 4 four, round 5 three, and this round two. Both of this round's findings are in the option scanning of rounds 4 and 5. F1 is a regression a fix round introduced, for the third round running.
  - This round is past `maxRounds` (4), and it is `maxRoundsHard` (6).
  - The owner may prefer to amend SPEC D-03. It could state that wrapper and option parsing is best-effort, list it in `KNOWN_LIMITS`, and stop here.
  - F1 is worth fixing either way: it makes the guard looser than it was at `2d0cfba`. So is F2's `cp -rT` (the policy replaced by a plain `cp`).
  - The decision is the owner's.
- **Read-family words are judged only in path-like arguments** (SPEC D-03 rule 6c), carried from round 5. So `cat zlib.txt` is allowed and `cat ./zlib.txt` is denied `forbidden word in path argument`.
- **SPEC D-03 makes `git` write-family as a whole** (carried from rounds 3 to 5). `git add docs/*` is denied `protected path`.
- Carried from rounds 2 to 5, still open:
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
- From round 3: `gh pr checks` shows `test (macos)` green after the push.
- After the review fixes, re-run the Phase 3 denial step in a live session with the bypass forms of rounds 1 to 6. Include:
  - `cd ~/.cargo/registry && cat x`
  - `(curl https://example.com)`
  - `cd && cat .cargo/registry/x`
  - `cp evil .kukulu/state.*`
  - `env -S -i curl https://example.com`
  - `cp -vt docs x/cleanroom.json`
  - `cd ~/.cargo && cd r* && cat x`
  - `xargs -i curl https://example.com`
  - `cp -rT evil docs`

## Notes

- **These fix tasks are not driven by mutation results.** Both findings come from probing `evaluate()` against SPEC D-03 and D-10, and checking each form against the real tools. Neither comes from a surviving mutant, so each task is `review`-sourced.
- **Mutation sampling.** Per the review-build rule for round 2 and later, I mutated only `mcp/cleanroom.mjs`, the one source file in `git diff --name-only b68996b..HEAD`. I used the targeted `cleanroom` suite with `confirmKill`.
  - Five mutants were killed, each confirmed by a clean re-run:
    - bundle scanning limited to the first letter
    - long-option abbreviation removed
    - the env split's `continue` turned back into `break`
    - the glob-cwd clause of R5-03 removed
    - the trailing-slash rule restored
  - All five failed through the gate's guard self-test ("the first kukulu_next in a clean-room project goes on to the plan stage": `halt`), which runs the fixture file.
- **Advisory survivor.** This round is past `review.mutationFixRounds` (2), so this is not a task. The summarizer carries it.
  - Deleting the bundle-recursive line in `destinationPaths` (`:1044`, "A bundle's letters before the valued one still count") survives.
  - R5-02's own fixture `cp -rt docs evil/cleanroom.json` is denied without it, by the plain landing-path check.
  - The form the line exists for is `cp -rt . evil/docs`. It is denied at HEAD, and no fixture has it.
  - R6-02 touches the same recursive detection, so its acceptance list includes that form as a stays-denied fixture.
- The survivors from rounds 3 to 5 are still advisory.
- The project is in general mode (no `docs/cleanroom.json`), so there are no `denied` entries since `lastReviewCommit` to check.
