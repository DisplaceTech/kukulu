# Review: Kūkulu 0.8.0 (build/2026-10-26)
Round: 2

**Verdict: CHANGES REQUESTED**

Branch `build/2026-10-26`, base `3aa6277`, head `38159dc`; 46 tasks done (P0-01 to P4-06, R1-01 to R1-08), none blocked or skipped. Last review commit `545ff06`; this round reviewed the eight R1 commits and their files (`mcp/server.mjs`, `scripts/sandbox.mjs`, `scripts/verify-attestation.mjs`, `scripts/publish-bundle.mjs`, `scripts/compare-bundles.mjs`, `test/{attest,bundles,cleanroom,constraints,sandbox,harness}.mjs`, two fixtures, four docs, CHANGELOG).

- `kukulu_verify` is green on the head: every constraint ok with no fixture failure; lint, pre-commit and `npm test` (15 suites, 4,580 assertions).
- PR checks (`prChecks`): `pass`, nothing failing.
- Every R1 commit carries the five template fields; all 101 commits on the branch are signed (`G`).
- No file under `docs/SPEC.md`, `docs/flights/`, `docs/plans/`, `site/`, `docs/site/` or `docs/kukulu.json` changed; no `.gitignore`, `.gitattributes` or CI edit. `test/fixtures/guard-cases.json` was not touched this round.
- General-mode flight (`cleanroom: null`): no clean-room denials to review.

Mutation sample this round (targeted `node test/<suite>.mjs`, every kill confirmed on the unmutated tree): 17 mutants over the fix round's files, 17 killed, 0 survivors.

- `mcp/server.mjs`: the `/run/kukulu` source check, the home-volume type check, the "mount outside the expected set" check, the same-path source check, the constraint scan's `continue` after a skipped symlink, the sandbox verifier choice in `verifyControlBundle` and in `attest`, the pre-release crate regex (reverted to the old one), `core.fsmonitor=false` in `gitArgv`, and the runner half of routing part 1.
- `scripts/sandbox.mjs`: `:ro` on the runtime mount, the box `source` order, the `SIGTERM` in `stop`, and `sandbox.egress` hosts after lockdown.
- `scripts/verify-attestation.mjs`: `CONTROL (positive)` keyed on the exit code instead of the mode.
- `mcp/cleanroom.mjs`: `isControl` `every` to `some`, and the TOML reader without `own = false`.

## Findings

### F-01 (category 2, boundary): the constraint scan still reads host files through a symlinked directory. R1-02 is incomplete (P2-08, C-04)

- `mcp/server.mjs:3295` (`checkConstraints`) only checks a listed path when `fs.lstatSync(full).isSymbolicLink()` is true for the path itself. `git ls-files --cached` lists index entries whatever the working tree now holds, so a tracked file under a directory that has since been replaced by a symlink is listed. `lstat` on that file reports a regular file (it follows the parent link), and the scan reads it and returns each matching line as `hits[].text`.
- Reproduced through the real server: commit `src/keys/secret.js`, replace `src/keys` with a symlink to a directory outside the project holding `secret.js` with `console.log('top-secret');`, and call `kukulu_verify` with a rule over `src/`. Result: `{"ok":false,"hits":[{"file":"src/keys/secret.js","line":1,"text":"console.log('top-secret');"}],"skipped":["src/keys"]}`. The directory link is listed under `skipped`, but the file under it is still read and its content returned.
- What breaks: what R1-02 set out to prevent. Under the sandbox the box commits a dummy `keys/ed25519.pem` (through `kukulu_task_done`), swaps `keys` for a link to the operator's `~/.config/kukulu/cleanroom/`, and adds a `pattern: "."` rule (`docs/kukulu.json` is writable inside, the `config-writable` known limit). `kukulu_verify` then returns the checkpoint key line by line. R1-02's own Goal was "never reads or returns the content of a listed path whose real path lies outside the project root"; PLAN R1-02's design note ("a listed path that is a symlink (lstat)") wrote the blind spot into the task, and the test only covers a link at the file itself.
- Minimal fix: compute `fs.realpathSync(full)` for every listed file, not only for one whose own `lstat` is a link. Skip it, and list it under `skipped`, whenever the real path is neither the real root nor under it. Update the `docs/mcp-tools.md` sentence ("a listed path that is a symlink whose real path ...") to cover a file reached through a symlinked directory, and amend the R1-02 CHANGELOG line.
- Test: the reproduction above as a `test/constraints.mjs` case, "a tracked file reached through a symlinked directory that leaves the project is not scanned" (no hit text holds the secret; `skipped` names `src/keys/secret.js`). Keep the existing inside-link case passing.
- Task R2-01.

## Interpretation choices (HANDOFF)

The round-1 choices all fit SPEC and the R-tasks:

- R1-01: an unset `KUKULU_SANDBOX_HOOKS_PATH` fails the source check, and the recorded mounts keep three fields.
- R1-02: `skipped` appears only when it is non-empty.
- R1-03: the attest case lives in `test/attest.mjs`.
- R1-06: the crate name is what comes before the first `-X.Y.Z`. That gives the same answer as PLAN's "before the last `-<digit…>`" for every cargo directory name, `flate2-1.0.0-rc.1` included.

The round-1 review already assessed the base-flight choices, and nothing in this round changes them.

## Blocked and skipped tasks

None.

## Spec issues

- C-04 lets the server read project files outside the box "on files it reads" without saying that it must not follow a symlink out of the project. F-01 is the second instance (a symlinked parent directory, after round 1's symlinked file). The same class reaches other outside reads that return content or derived data: `packagesCheck` and `kukulu_attest`'s `packages` read tracked lockfiles, and `kukulu_attest` copies `SUMMARY.md`, `REVIEW.md`, `PROGRESS.md` and evidence files into the bundle. `kukulu_attest`'s clean-tree check makes a swap there much harder, and lockfiles yield only `name@version` strings. The next SPEC should state one rule for every outside read: resolve the real path and refuse anything outside the project.
- Carried from round 1, still open for the next SPEC:
  - The runtime directory's read-only mount (now in the code, C-01 does not say it).
  - B-02's "that bundle's own `verify.mjs`" under `container+proxy` (the code now runs the plugin's verifier there).
  - The log socket accepting every entry kind from the box (C-02).
- Known-gap candidates (principle 1; not tasks), unchanged from round 1:
  - Package-add words and subcommands the rule does not name: `pip3`, `pnpm`, `yarn`, `poetry add`, `cargo install <name>`, and an add through a requirements file.
  - An option value before the subcommand: `cargo --manifest-path x/Cargo.toml add flate2`.
  - Pax copy mode: `pax -rw src docs/`.

## Manual checks still owed

From HANDOFF.md, all `NOT VERIFIED (human)`:

- Phase 0: with the real global file holding the Spark and Mac runners, `kukulu_config_show` reports each role's runner. A throwaway clean-room flight with `runners.locality: "local"` and the default routing refuses at its first `kukulu_next`. With profile B routing it writes a genesis naming both runners and the Spark model's `weights` digest from `scripts/model-identity.mjs`.
- Phase 1: a small control flight's bundle verifies as `CONTROL (positive)` with exit 3, and `publish-bundle.mjs` output copied to a static host verifies with `--check` from a second machine.
- Phase 2: on Linux:
  - `doctor` passes and `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs` passes.
  - A throwaway sandboxed clean-room flight runs to the end. Inside it, `curl https://example.com` fails, `ls ~/.cargo/registry` shows only the volume's own cache, and writing under `/run/kukulu` fails while the hooks still reach the log socket.
  - Its bundle verifies with `--require-enforcement container+proxy`, and its egress summary lists only the runner endpoints.
  - The same run inside a Linux VM on a Mac is a second, separate check.
- Phase 3: `compare-bundles.mjs` on the Phase 2 bundle and a hook bundle from a real flight prints wall time and tokens per role for both.
- Phase 4: on a scratch repository with a merged PR, `kukulu_release` makes a draft release whose notes match the CHANGELOG entry.
- The HANDOFF's first line stands: do not merge until the owner has run one sandboxed clean-room flight from the working tree on Linux and its bundle verifies with `--require-enforcement container+proxy`.

## Notes

- `mcp/server.mjs:244` (`mount /run/kukulu is writable; ...`) can never be reached. A writable `/run/kukulu` already fails the writable-set comparison at line 229, which returns the generic `read-write mounts are ...` reason. The tests assert that generic reason. Harmless; the specific message could go or move ahead of the set comparison.
- The constraint scan checks a path and then reads it, so the box could swap the path for a link in between. The window is small, and F-01's fix should resolve the real path and read that same resolved path, which narrows it further.
- `docs/sandbox.md:83` still opens with "The project is the only read-write mount", while the paragraph R1-01 edited says the home volume is writable too. A wording fix for the next doc pass.
- Round 1's notes still apply: the trailing local `chore: stage end` commit, the `docs/attestation/` remove-and-recreate window, the unquoted `KUKULU_SANDBOX` in `runShell`'s wrapper, and the `breaking: true` carried in `.kukulu/state.json`.
