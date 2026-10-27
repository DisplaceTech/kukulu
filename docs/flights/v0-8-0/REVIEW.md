# Review: Kūkulu 0.8.0 (build/2026-10-26)
Round: 3

**Verdict: APPROVED**

Branch `build/2026-10-26`, base `3aa6277`, head `3f24f72`. All 47 tasks are done (P0-01 to P4-06, R1-01 to R1-08, R2-01), and none is blocked or skipped. The last review commit is `6630772`. This round reviewed R2-01 (`d62cd70`) and the files it touched: `mcp/server.mjs`, `test/constraints.mjs`, `docs/mcp-tools.md` and `CHANGELOG.md`.

- `kukulu_verify` is green on the head. Every constraint is ok with no fixture failure. Lint, pre-commit and `npm test` all pass: 15 suites, 4,582 assertions, with `constraints` up from 64 to 66.
- PR checks (`prChecks`): `pass`, with nothing failing.
- R2-01's commit carries the five template fields. All five commits since the last review are signed (`G`).
- No file changed under `docs/SPEC.md`, `docs/flights/`, `docs/plans/`, `site/`, `docs/site/` or `docs/kukulu.json` across the branch. Nothing touched `.gitignore`, `.gitattributes` or CI.
- This is a general-mode flight (`cleanroom: null`), so there are no clean-room denials to review.

## R2-01 against round 2's F-01

- `checkConstraints` (`mcp/server.mjs:3294-3301`) now calls `fs.realpathSync(full)` for every listed file that exists. It skips the file, and lists it under `skipped`, when the real path is neither the real root nor under `realRoot + path.sep`. It then reads the resolved path it checked, as the task's design note asked.
- The new `test/constraints.mjs` case is the round-2 reproduction: a tracked `src/keys/secret.js`, with `src/keys` swapped for a link to an outside directory. It asserts that no hit holds `top-secret` and that `skipped` names `src/keys/secret.js`. The two R1-02 cases (an outside file link, and an inside link that is still scanned) still pass.
- `docs/mcp-tools.md` now covers a symlinked directory. The R1-02 CHANGELOG line was amended in place under `## [0.8.0]` / `### Fixed`, and no heading was added.

Mutation sample this round used targeted `node test/constraints.mjs` with `confirmKill`. Out of 5 mutants on `mcp/server.mjs`, 4 were killed and 1 survived:

- Restoring the round-1 behaviour (only a path that is itself a link is resolved, and anything else is read as `full`) was killed. The two new assertions fail by name: "a tracked file reached through a symlinked directory ..." and "...and the rule lists the file under skipped".
- Deleting the `continue` after a skip was killed.
- Dropping `skipped` from the result was killed. Both "...lists ... under skipped" assertions fail.
- Treating every non-link path as the root was killed, by a crash rather than a named assertion.
- Removing `path.sep` from `realRoot + path.sep` survived. See Notes. Round 3 is past `review.mutationFixRounds` (2), so this cannot become a task. The code itself is correct.

## Findings

None in categories 1 to 3 or 5. R2-01 does what F-01 asked, and the mechanic is tested in isolation.

## Interpretation choices (HANDOFF)

R2-01 records none. The earlier choices were assessed in rounds 1 and 2, and nothing in this round changes them.

## Blocked and skipped tasks

None.

## Spec issues

- C-04 lets the server read project files outside the box "on files it reads", but does not say it must not follow a symlink out of the project. The constraint scan is now closed for both a linked file and a linked parent directory. Other outside reads that return content or derived data have the same class of problem: `packagesCheck` and `kukulu_attest`'s `packages` read tracked lockfiles, and `kukulu_attest` copies `SUMMARY.md`, `REVIEW.md`, `PROGRESS.md` and evidence files into the bundle. `kukulu_attest`'s clean-tree check makes a swap there much harder, and lockfiles yield only `name@version` strings. The next SPEC should state one rule for every outside read: resolve the real path, and refuse anything outside the project.
- Carried from rounds 1 and 2, still open for the next SPEC:
  - The runtime directory's read-only mount is now in the code, but C-01 does not say it.
  - B-02 says "that bundle's own `verify.mjs`", but under `container+proxy` the code runs the plugin's own verifier.
  - The log socket accepts every entry kind from the box (C-02).
- Known-gap candidates (principle 1; not tasks), unchanged:
  - Package-add words and subcommands the rule does not name: `pip3`, `pnpm`, `yarn`, `poetry add`, `cargo install <name>`, and an add through a requirements file.
  - An option value placed before the subcommand: `cargo --manifest-path x/Cargo.toml add flate2`.
  - Pax copy mode: `pax -rw src docs/`.

## Manual checks still owed

From HANDOFF.md, all `NOT VERIFIED (human)`:

- Phase 0, with the real global file holding the Spark and Mac runners:
  - `kukulu_config_show` reports each role's runner.
  - A throwaway clean-room flight with `runners.locality: "local"` and the default routing refuses at its first `kukulu_next`.
  - With profile B routing, the same flight writes a genesis that names both runners and the Spark model's `weights` digest from `scripts/model-identity.mjs`.
- Phase 1:
  - A small control flight's bundle verifies as `CONTROL (positive)` with exit 3.
  - `publish-bundle.mjs` output, copied to a static host, verifies with `--check` from a second machine.
- Phase 2, on Linux:
  - `doctor` passes, and `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs` passes.
  - A throwaway sandboxed clean-room flight runs to the end. Inside it, `curl https://example.com` fails, `ls ~/.cargo/registry` shows only the volume's own cache, and writing under `/run/kukulu` fails while the hooks still reach the log socket.
  - Its bundle verifies with `--require-enforcement container+proxy`, and its egress summary lists only the runner endpoints.
  - The same run inside a Linux VM on a Mac is a second, separate check.
- Phase 3: `compare-bundles.mjs`, run on the Phase 2 bundle and on a hook bundle from a real flight, prints wall time and tokens per role for both.
- Phase 4: on a scratch repository with a merged PR, `kukulu_release` makes a draft release whose notes match the CHANGELOG entry.
- The HANDOFF's first line still stands: do not merge until the owner has run one sandboxed clean-room flight from the working tree on Linux, and its bundle verifies with `--require-enforcement container+proxy`.

## Notes

- Advisory survivor, carried to SUMMARY.md: `mcp/server.mjs:3297`. Changing `real.startsWith(realRoot + path.sep)` to `real.startsWith(realRoot)` survives `test/constraints.mjs`. No case links to a sibling directory whose name has the project root as a prefix (for example root `/tmp/repo` and a link to `/tmp/repo-evil/secret.js`). The code is correct today. A future test could add that sibling-prefix link so the separator cannot be dropped silently.
- R2-01 now calls `realpathSync` once per listed file per rule, where before it was one `lstat`. With 32 rules over this repository the `constraints` suite and `kukulu_verify` show no measurable change.
- The `docs/HANDOFF.md` header still says "head `f165347` plus this handoff", while the round sections below it describe the later work. The next handoff could refresh it.
- Round 2's notes still apply:
  - The unreachable `mount /run/kukulu is writable` message at `mcp/server.mjs:244`.
  - The check-then-read window in the constraint scan. It is narrower now that the resolved path is read.
  - `docs/sandbox.md:83` still says "the only read-write mount".
  - The trailing local `chore: stage end` commit.
  - The `docs/attestation/` remove-and-recreate window.
  - The unquoted `KUKULU_SANDBOX` in `runShell`'s wrapper.
  - The `breaking: true` carried in `.kukulu/state.json`.
