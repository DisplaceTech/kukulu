<!-- Kūkulu review, build/2026-10-20 -->
Round: 1

# Review: Kūkulu 0.7.1 build

**Verdict:** CHANGES REQUESTED

Base `870405426ff3` (main), head `428bd99`, 17 tasks, all done, none blocked or skipped. I ran `kukulu_verify` myself and it is green. All 28 constraints pass with no hits and no fixture failures. `npm run lint`, `pre-commit run --all-files` and `npm test` (3695 assertions) pass. I also ran the guard self-test (`guard self-test: ok (501 cases)`) and `npm run check:site` by hand, and both pass. `docs/kukulu.json` parses identically to the base. Its constraints match `docs/flights/v0-7-0/kukulu.json` except for the dropped `no-foundry-names` `from` (a PLAN decision) and the added `progress-no-bare-macron`, so principle 7 holds. `git diff 870405426ff3..HEAD -- test/fixtures/guard-cases.json` only adds lines: no existing fixture changed, so principle 6 holds.

I mutation-sampled every changed module with targeted suites:

| File | Mutant | Result |
|---|---|---|
| `mcp/cleanroom.mjs` | rsync recursive containment removed | killed |
| `mcp/cleanroom.mjs` | tar `writesArchive` reduced to `c` only | **survived** |
| `mcp/cleanroom.mjs` | `--get` removed from `TAR_LONG_MODES` | **survived** |
| `mcp/cleanroom.mjs` | tar archive-file wildcard check removed | **survived** |
| `mcp/cleanroom.mjs` | rsync target wildcard check removed | **survived** |
| `mcp/cleanroom.mjs` | `e` removed from `RSYNC_SPEC.short` | **survived** |
| `mcp/server.mjs` | `git merge --abort` removed from syncBase's failed-commit catch | **survived** |
| `mcp/server.mjs` | the no-streams condition removed from taskNext's sync | **survived** |
| `mcp/server.mjs` | the signing-fallback retry given `-- <paths>` again during the merge | **survived** |
| `mcp/server.mjs` | `covers(c.exclude)` removed from refuseProgressText | killed |
| `mcp/server.mjs` | run_start's alreadyStarted result without `baseSynced` | killed |
| `mcp/server.mjs` | flightNotesRange never ends at the next level-2 heading | killed |
| `mcp/server.mjs` | gate `unpinned` always empty | killed |
| `scripts/verify-attestation.mjs` | the cleanroomHash mismatch failure disabled | killed |

## Findings

### 1. Category 3: B-03's failure, signing and parallel-plan paths are untested (P1-03)

`mcp/server.mjs` `syncBase` (around lines 2166–2200), `commitStaged`'s `pathspec` retry (around line 451), and `taskNext`'s sync condition (around line 2415). Three mechanics have no test that fails without them:

- **A failed merge commit.** The `catch` that runs `git merge --abort` after `commitStaged` throws can be deleted and every suite still passes. That breaks SPEC §3 principle 4 and CLAUDE.md principle 3 ("a tool whose final commit fails leaves the tree as it found it"), and CLAUDE.md's Commit-failure tests protocol. Without the abort, a rejected `chore: merge` commit leaves `MERGE_HEAD` and a staged merge behind, and the next tool call commits it under some other subject.
- **The signing fallback during the merge.** If the unsigned retry goes back to `git commit -- <paths>`, git refuses that during a merge, so a flight on `signing: auto` with a dead signer cannot sync. SPEC B-03 step 1 requires that "signing … behave like any other server commit". No test covers it.
- **A serial `kukulu_task_next` in a plan that declares streams.** If the `!parseProgress().tasks.some((t) => t.stream)` condition is removed, nothing fails. SPEC B-03 says "A parallel flight syncs only at `kukulu_run_start`".

Minimal fix: tests only, unless one exposes a bug. See R1-01.

### 2. Category 3: some A-04 spellings and the new wildcard checks have no fixture (P0-05)

`mcp/cleanroom.mjs` `tarParts` / `RSYNC_SPEC` / the 6d' block (around lines 953–990 and 1275–1380). These mutants survive both `test/cleanroom.mjs` (which runs every fixture) and the guard self-test:

- Reducing `writesArchive` to create mode only. SPEC A-04 names append and update (`-r`, `-u` and their long forms), and no fixture uses them.
- Dropping `--get` as an extraction. SPEC A-04 names `--get`.
- Treating rsync's `-e` as a flag. SPEC A-04 names `-e|--rsh` as taking a value. The only fixture, `rsync -e ssh -a src/ build/`, is allowed either way, so it proves nothing.
- Deleting the wildcard check on rsync's targets, or on tar's archive file.

The behavior is right today (I probed each form against `evaluate`). A later edit could remove any of these without a failing test. Minimal fix: fixtures only. See R1-02.

No other findings. No category 1 or 2 issue. No `.gitignore`, CI or editor-config edit. Every task's diff stays within its listed files, apart from P0-07's `test/harness.mjs` helper option, which its `Interpretation:` line declares. I read each HANDOFF interpretation choice against SPEC. The tar "lies under a protected path" extension and the `A`/`--delete` modes fail closed and are documented. Running the sync in review-fix `run_start` is what B-03's "on an existing build branch" says. `run_halt`'s reason check follows PLAN's recorded spec issue. Running every base fixture against the new code shows no regression of a denied form, since the self-test passes with no fixture changed.

## Spec issues

- §1 "Why a patch version" says the guard denies "two command forms it allowed before (A-04)". The build also newly denies A-02's bare read-family operand (`cat zlib.txt`), the rsync remote operand, and a tar extraction at the repository root. Both of the last two follow from A-04 as PLAN resolved it. The sentence undercounts.
- A-04's "a remote operand … is already a network command under `deny.network`" was false at the base. PLAN's spec issue records this, and P0-05 made it true.

### Known-gap candidates

- rsync's deleting options: `--delete` with `-d`/`--dirs`, `--remove-source-files`, and `--delete-*` in general. For example, `rsync -d --delete empty/ docs/` removes `docs/cleanroom.json` and is allowed.
- tar under another command word: `bsdtar`, `gtar`. For example, `bsdtar -xf a.tar -C docs` is allowed.

## Manual checks still owed

- Phase 0: in a live clean-room session with the working-tree plugin (`claude --plugin-dir .`), `git add docs/*` is allowed and `rsync evil/cleanroom.json docs/` is denied; CI is green on the pushed branch.
- Phase 1: on a throwaway flight with the working-tree plugin, commit to the base branch after the build branch is cut, then call `kukulu_task_next` and see the `chore: merge` commit.
- Phase 2: the draft PR targets `main`, and its ci, lint and site checks are green.
- Before merging, run `npm test` once on a machine with the signing agent the project uses.

## Notes

- `mcp/server.mjs` around line 2667: P1-02 inserted `constraintTests`, `constraintFixtureFailure` and `refuseProgressText` beneath `checkConstraints`'s doc comment, which ends "Line-based only; no multi-line patterns". That comment now sits above `const constraintTests` instead of the function it describes.
- `mcp/cleanroom.mjs` `KNOWN_LIMITS`'s doc comment still cites "SPEC D-03". P0-01's design constraint asked it to name SPEC A-01.
- The recursive rsync denial reason quotes the destination form, not the protected path. For example, `cd docs && rsync -a ../evil/ .` gives `protected path: /p/docs (rsync writes it into .)`. This matches the existing recursive `cp` message, so it is consistent, but it reads oddly.
- `kukulu_status`'s `prChecks` reads `unknown: unknown flag: --json`: the local `gh` does not support `gh pr checks --json`. A round-2 reviewer on this machine will not get a CI signal from it.
- `docs/kukulu.json` has `maxRounds: 6`, while PLAN's Decisions says it keeps the default 3.
