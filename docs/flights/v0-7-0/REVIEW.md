<!-- Kūkulu review, build/2026-10-19 -->
Round: 11

# Review: Kūkulu 0.7.0 build (build/2026-10-19)

## Verdict

APPROVED

What I checked:

- All 98 tasks are done. None are blocked or skipped.
- At `e7b9a40`, `kukulu_verify` passes.
  - All 27 `docs/kukulu.json` constraints are clean, and their fixture self-test passes.
  - `npm run lint` and `pre-commit run --all-files` pass.
  - The 13 suites pass: 3,566 assertions.
  - The guard self-test (`node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json`) passes with 469 cases, which is 457 plus R10-01's 12.
- `gh pr checks` on the draft PR, whose head is `e7b9a40` (same as `origin/build/2026-10-19`): all eleven checks pass, `test (macos)` included.
- Round 10 changed only `test/fixtures/guard-cases.json` and the pipeline files (`docs/HANDOFF.md`, `docs/PROGRESS.md`, `.kukulu/state.json`), per `git diff --name-only b0a1301..HEAD`.
  - It did not touch `mcp/`, `docs/SPEC.md`, `docs/plans/`, `docs/flights/`, `docs/site/`, `docs/kukulu.json`, `.gitignore`, `.gitattributes` or CI config.
  - The fixture diff has no removed lines. No existing fixture changed.
  - The R10-01 commit follows the template. All five commits since `b0a1301` are signed (`%G?` is `G`).
- R10-01 matches its task exactly. All twelve fixtures it names are present and end with ` (R10-01)`. Each uses policy `template`, Bash and cwd `__ROOT__`, and each gets the decision the task requires:
  - Nine are denied with reason `protected path`: `mv --target-directory=docs`, `mv --t=docs`, `ln --target-directory=docs`, `install --target-directory=docs`, `install --mode=644 … docs`, `install --owner=root … .kukulu`, `mv --suffix=.bak … docs`, `ln --s …` and `cp --s …`.
  - Three are allowed: `install --mode=644 a.txt build/`, `install -o root -g root a.txt build/` and `mv --suffix=.bak a.txt build/`.
- Both round-10 survivors are now killed. See Notes.

## Findings

None.

Categories 1 to 3 are clean across the branch:

- Rounds 1 to 9 fixed every earlier finding, and their reviews checked those fixes.
- Round 10 added fixtures only. They close the one remaining test gap, and both mutants that showed it are now killed.

## Spec issues

Carried from earlier rounds. None of these blocks approval, and each one is the owner's call.

- **The guard is lexical, and its option tables cannot be proved complete across GNU and BSD versions.** Fix tasks per round: 7, 7, 3, 3, 3, 2, 2, 1, 1, 1, then 0 in this round. The owner may want to amend SPEC D-03 to say that option parsing for wrappers and write commands is best-effort against each tool's documented options, and add that to `KNOWN_LIMITS`.
- **Read-family words are judged only in path-like arguments** (SPEC D-03 rule 6c). So `cat zlib.txt` is allowed, while `cat ./zlib.txt` is denied with `forbidden word in path argument`.
- **SPEC D-03 treats all of `git` as write-family.** So `git add docs/*` is denied with `protected path`.
- **SPEC F-04's `--roots`/`--words` defaults** were superseded by the owner's `e7ef4d4`.
- **D-03's write, network and wrapper lists are incomplete.** For example, `rsync evil/cleanroom.json docs/` and `tar xf evil.tar -C docs` are allowed. `KNOWN_LIMITS` names rsync.
- **The log's uncommitted tail is unsigned.**
- **D-08 check 3 does not pin `mcp/cleanroom.mjs`.**
- **D-03's known gaps do not mention shell expansion.**
- **SPEC §1 asks for the PR against `main`,** while `baseBranch` is `cleanroom`.

## Manual checks still owed

All are `NOT VERIFIED (human)`, copied from HANDOFF.md.

- Phase 0 (P0-07): run the installed 0.6.1 plugin's `kukulu_migrate` on a throwaway `.foundry/` project. Then run one task on it with the working-tree plugin.
- Phase 1 (P1-14): halt a throwaway flight with `kukulu_run_halt` and fix nothing.
  1. Call `kukulu_run_resume` and confirm the refusal names the dirty tree.
  2. Clean the tree and confirm the resume commit.
- Phase 2 (P2-03): create `docs/feedback/.private-names` with one real name and run `npm run lint`.
  1. It must fail without printing the name.
  2. Delete the file, run it again, and confirm it prints the skipped line.
- Phase 3 (P3-21):
  1. Copy `templates/cleanroom.example.json` into a throwaway Rust project as `docs/cleanroom.json`.
  2. Start a new session with the working-tree plugin and ask it to read `~/.cargo/registry`.
  3. Confirm the denial appears in the session and in `.kukulu/cleanroom/log.jsonl`.
  4. Type one instruction and confirm a `human` entry.
  5. Run `/kukulu:go-flight` and confirm `gate: ok (7 checks)` before the plan stage.
- Phase 4 (P4-09): run `kukulu_similarity` against the cleanflate-bench subjects at `7f50ce6`, with reference pairs from `d047d66`.
  - Record the identifier and comment Jaccard values next to the canonical values: 0.021 / 0.019 / 0.095 (identifier) and 0.0003 / 0.0010 / 0.032 (comment).
  - The ordering must agree.
- Phase 5 (P5-09): copy a bundle to a machine without this repository.
  1. Run `node verify.mjs . --key <fingerprint>` and confirm PASS.
  2. Change one byte of `log.jsonl` and confirm FAIL names the line.
- Phase 6 (P6-05):
  - Deploy the build branch as a Cloudflare Pages preview.
  - Read every clean-room line against what the suite proves.
  - Compare the page with the changed mockup at 360, 768 and 1440 px in both colour schemes.
  - Confirm the site, ci and lint checks are green on the PR.
- From HANDOFF's first line: the owner runs one clean-room flight from the working tree before merging.
- From HANDOFF: after this branch meets `cleanroom`, change `fromas of 0.7.0` to `as of 0.7.0` in `docs/site/mockup.html` and `site/index.html`.
- Re-run the Phase 3 denial step in a live session with the bypass forms from rounds 1 to 10. Each must be denied. Include:
  - `cd ~/.cargo/registry && cat x`
  - `(curl https://example.com)`
  - `cd && cat .cargo/registry/x`
  - `cp evil .kukulu/state.*`
  - `env -S -i curl https://example.com`
  - `cp -vt docs x/cleanroom.json`
  - `cd ~/.cargo && cd r* && cat x`
  - `xargs -i curl https://example.com`
  - `cp -rT evil docs`
  - `cp -r --o evil/. docs`
  - `xargs --process-slot-var V curl https://example.com`
  - `cp evil/cleanroom.json docs --sparse always`
  - `install --strip-program=true --strip evil/cleanroom.json docs`
  - `mv --target-directory=docs evil/cleanroom.json`
  - `ln --s evil/cleanroom.json docs`
  - on macOS, `install -S evil/cleanroom.json docs`

## Notes

- **Mutation sampling.** `git diff --name-only b0a1301..HEAD` contains no source file, only the fixture file.
  - R10-01's verification asks the reviewer to re-run the two round-10 mutants on `mcp/cleanroom.mjs`. I ran both with the targeted `cleanroom` suite and `confirmKill: true`, and both are **killed**.
    - The new mv/ln/install branch's attached value replaced with `value: null`.
    - `resolveLong`'s `hits.length === 1` changed to `>= 1`.
  - Each kill failed through the gate's guard self-test ("the first kukulu_next in a clean-room project goes on to the plan stage": expected `plan`, got `halt`). The unmutated re-run passes 1013/1013.
  - Both mutants survived at `580d523`, and round 10 changed only fixtures, so the new fixtures are what kill them.
- **Log inaccuracy.** PROGRESS.md's R10-01 log entry says the guard self-test is "now 481 cases". It is 469, as HANDOFF.md and the task's verification line say. The tool wrote PROGRESS.md, so this is left as a note.
- **Readability (carried from round 10).** When only the BSD reading of `install -S evil/cleanroom.json docs` finds a target, the denial reads `install writes it into null`. `destinationPaths` reports `gnu.dir`, which is null there. The decision is right; only the message is odd.
- **Advisory (carried).** FreeBSD-only install options (`-T tags`, `-M metalog`) and macOS cp `-S` (not verified) are not modelled.
- **Hard cap.** `maxRoundsHard` is 10 and this is round 11. This round is approved, so no halt follows.
- The project is in general mode (there is no `docs/cleanroom.json`), so there are no `denied` log entries since `lastReviewCommit` to check.
