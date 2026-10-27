# Review: Kūkulu 0.8.0 (build/2026-10-26)
Round: 1

**Verdict: CHANGES REQUESTED**

Branch `build/2026-10-26`, base `3aa6277`, head `b6c200d`; 38 tasks done, none blocked or skipped. `kukulu_verify` is green on the head (every constraint ok with no fixture failure; lint, pre-commit and `npm test`: 15 suites, 4,520 assertions). No guard fixture changed its decision (`git diff 3aa6277..HEAD -- test/fixtures/guard-cases.json` adds 28 cases and removes none). No file under `docs/SPEC.md`, `docs/flights/`, `docs/plans/`, `site/`, `docs/site/` or `docs/kukulu.json` changed. Every task commit carries the five template fields. General-mode flight: no clean-room denials to review. PR checks: pass.

Mutation sample (targeted `node test/<suite>.mjs`): 27 mutants over 9 files; 16 killed, 11 survived. The survivors are listed under findings F-04 to F-07.

## Findings

### F-01 (category 2, boundary): the runtime directory is writable inside the container, so the box can run code on the host; gate check 9 does not hold the container to "exactly the mount list" — P2-05, P2-07

- `scripts/sandbox.mjs:311` mounts `${runtimeDir}:/run/kukulu` read-write, and `scripts/sandbox.mjs:515` puts `hooks-empty/` (the directory every outside git call uses as `core.hooksPath`, `mcp/server.mjs:610`) inside that directory. An agent in the container writes `/run/kukulu/hooks-empty/pre-commit` (the container user has the host uid, P2-14), and the next commit the controller makes on the host (every `kukulu_task_done`) runs it as the operator, with the checkpoint key in reach. That breaks SPEC §3 principle 7 outright. The same writable directory lets the box rewrite `run.json` (so `stop` sends SIGTERM to a pid of its choosing) and unlink and replace `log.sock` or `controller.sock` with its own listeners.
- `mcp/server.mjs:229-231` accepts `/run/kukulu` as writable. The HANDOFF's P2-07 interpretation says a socket needs a writable directory to be connected to; it does not (Linux checks write permission on the socket inode, not the mount; the common `docker.sock:ro` mount is the counter-example). PLAN P2-07 required "only the project and the home volume may be writable".
- SPEC C-01 says `inspect` must show "exactly the mount list above". `boundaryCheck` only compares the writable destinations and checks that the required read-only ones exist: an extra read-only mount (a prior-art directory, the host's `~/.cargo`) passes genesis, and so does a `/home/kukulu` that is a bind mount of a host directory instead of the `kukulu-<id>-home` volume (C-07: "the host's `~/.cargo`, `~/.npm` and `~/.cache/pip` are not mounted"). Later gates compare to genesis, so whatever genesis accepted stays accepted.
- Fix: mount the runtime directory `:ro`; gate check 9 requires the writable set to be exactly the project and `/home/kukulu`, `/run/kukulu` read-only with the runtime directory as its source, `/home/kukulu` the named volume `<container name>-home`, every same-path mount's source equal to its destination, and no destination outside the expected set. Docs (`docs/cleanroom.md:140`, `docs/sandbox.md`, `docs/architecture.md:118`) follow. Task R1-01.

### F-02 (category 2, boundary): the outside constraint scan reads through symlinks and returns the line text, so the box can read the checkpoint key — P2-08 (C-04)

- `mcp/server.mjs:3274` (`checkConstraints`) reads every listed path with `read(full)`, following symlinks, and returns each matching line as `hits[].text`. Under the sandbox that scan runs outside, on the host (C-04). An agent inside creates `leak -> ~/.config/kukulu/cleanroom/ed25519.pem` (the operator's home is visible in the plugin root and project paths) and a constraint with `pattern: "."` over `leak` in `docs/kukulu.json` (writable inside: the `config-writable` known limit; the planner writes it legitimately). `kukulu_verify` then returns the private key line by line. With the key the box can rewrite the log and re-sign checkpoints, which is exactly what principle 7 exists to prevent.
- Fix: the scan never reads a listed path whose real path lies outside the project root; it reports such paths without their content. Task R1-02.

### F-03 (category 2, boundary): the server runs a verifier from the project tree on the host — P1-03, P1-02, P2-08 (C-04)

- `mcp/server.mjs:3730` (`verifyControlBundle`) runs `<control dir>/verify.mjs` on the host. The control directory comes from `docs/kukulu.json` (writable inside) and may lie in the project (writable inside), so under the sandbox an agent supplies the script and `kukulu_similarity` executes it outside. C-04 says every command the server runs on the project's behalf runs inside; only git, the constraint scan, the guard self-test and the scorer stay outside.
- `mcp/server.mjs:4059` (`attest`) writes the bundle into `docs/attestation/` and then runs that copy of `verify.mjs`; the box can replace the file between the write and the spawn.
- Fix: under `KUKULU_SANDBOX`, both run the plugin's own `scripts/verify-attestation.mjs` (read-only inside) with the same arguments; outside the sandbox nothing changes (SPEC B-02 as written). See Spec issues. Task R1-03.

### F-04 (category 3, tests): SPEC requirements in `scripts/sandbox.mjs` with no test — P2-03, P2-04, P2-06

Survivors: `scripts/sandbox.mjs:79` with the order of `source: "box"` and the box's own `data` swapped (a box entry that brings `data.source: "controller"` would keep it; C-02 "every entry it could add carries `source: box`"); `scripts/sandbox.mjs:134` changed so `sandbox.egress` hosts stay allowed after lockdown (C-03 "the last two hold only until lockdown"); `stopSandbox` never signalling the `run.json` pid (PLAN P2-06). Killed: the `.kukulu`/`.claude` creation in `run`. SPEC C-01's test list also names "`run` refuses a tag-only image ... with nothing started", and `test/sandbox.mjs` has no such case (only `loadPolicy`'s refusal is tested in `test/cleanroom.mjs`). Task R1-05.

### F-05 (category 3, tests, plus two small defects): `mcp/server.mjs` — P2-08, P0-03, P2-11, P3-01

- Survivors: dropping `"-c", "core.fsmonitor=false"` from `gitArgv` (`mcp/server.mjs:610`; SPEC C-04's test is "a commit runs with the two `-c` options"); dropping the runner comparison from routing part 1 (`mcp/server.mjs:153`; SPEC A-02 part 1 compares model and runner). Killed: the halt closing the open stage, `--draft` under `publish`, the control head check, the sandbox signing record in finalize, the egress audit's `sandbox.egress` names.
- `mcp/server.mjs:284`: the cache's crate name regex `/^(.*)-\d[^-]*$/` matches nothing for a pre-release directory such as `flate2-1.0.0-rc.1`, so a denied crate at a pre-release version passes gate check 10. PLAN P2-11 says the crate is the part before the last `-<digit…>`.
- `docs/mcp-tools.md:5` still says "Three of them are read-only: `kukulu_status`, `kukulu_next` and `kukulu_config_show`"; since P3-01 `kukulu_next` commits the stage timeline (SPEC §3 principle 10).
- Task R1-06.

### F-06 (category 3, tests): `mcp/cleanroom.mjs` — P1-01, P2-11

Survivors: `isControl` with `every` changed to `some` (`mcp/cleanroom.mjs:896`), which would exempt a symlink under `control.priorArt` that resolves to a `deny.paths` file outside it; the TOML reader without `own = false` on a later table header (`mcp/cleanroom.mjs:2044`), so a sub-table's `name`/`version` keys would overwrite the package's own. Killed: `normalizeModel` stripping one prefix only, the pax extraction rule, the package-name split at `=`. Task R1-07.

### F-07 (category 3, tests, plus a flight-note violation): `scripts/publish-bundle.mjs` — P1-04, P3-04

- Survivors in `--check`: a file present but not listed in `SHA256SUMS` (`scripts/publish-bundle.mjs:105`), a listed file that is missing, a malformed `SHA256SUMS` line, a missing `SHA256SUMS`. Only the changed-byte case is tested. Killed: `compare-bundles.mjs`'s parameter mismatch, `model-identity.mjs`'s sort.
- `scripts/publish-bundle.mjs:66` writes the macron letter literally; CLAUDE.md's v0-8-0 notes and PLAN P1-04 require the Unicode escape in script source. `scripts/compare-bundles.mjs:12` writes the em dash literally where PLAN P3-04 asks for its escape.
- Task R1-08.

### F-08 (category 5/6, spec drift and an interpretation choice): `--expect control-positive` prints `PASS` — P1-02

`scripts/verify-attestation.mjs:612` prints `verify-attestation: PASS` for a passing control bundle when `--expect control-positive` is given, and `test/attest.mjs` asserts it ("...printing PASS"); `docs/cleanroom.md:87` documents it. SPEC B-01: "With `--expect control-positive`, a verified control bundle exits 0 and still prints `CONTROL (positive)`", and PLAN P1-02 says the same. The HANDOFF's P1-02 interpretation is not a reading SPEC allows. Task R1-04.

## Interpretation choices (HANDOFF)

- P1-02 (`PASS` under `--expect control-positive`): contradicts SPEC B-01; F-08.
- P2-07 (`/run/kukulu` writable): rests on a wrong premise and opens the host; F-01.
- The rest are consistent with SPEC: P0-01, P0-03, P0-04, P0-06 (covered by reading; the code writes `null` for a genesis without roles), P1-01, P1-03, P1-04, P2-01 to P2-06, P2-09 to P2-14, P3-01 to P3-04, P4-01, P4-03.

## Blocked and skipped tasks

None.

## Spec issues

- C-01 and C-04 put the empty hooks directory in the runtime directory and mount that directory at `/run/kukulu` without saying read-only; read together they hand the box a host hooks path. The SPEC should say the runtime directory is mounted read-only (F-01 fixes the code).
- B-02 says `kukulu_similarity` runs "that bundle's own `verify.mjs`". Under `container+proxy` that is project-controlled code on the host, against principle 7 and C-04. F-03 runs the plugin's verifier there instead; the next SPEC should say so.
- C-04 lets the server read project files outside "on files it reads" without saying it must not follow a symlink out of the project; F-02 is the result. The next SPEC should state the rule for every outside read that returns content.
- C-02's log socket appends any entry kind the box sends (`genesis`, `gate`, `checkpoint`, `egress`, `stage`, ...) with `source: "box"`. None of those can make a failing bundle pass today, but they can make a good one fail or pollute `compare-bundles` output. The SPEC could restrict the socket to the hook kinds (`allowed`, `denied`, `human`, `usage`).
- Known-gap candidates (principle 1; not tasks):
  - package-add words and subcommands the rule does not name: `pip3 install flate2`-style words (`pip3`, `pnpm`, `yarn`, `poetry add`), `cargo install <name>`, and an add through a file (`pip install -r requirements.txt`);
  - an option value before the subcommand: `cargo --manifest-path x/Cargo.toml add flate2` (the value is taken as the subcommand);
  - pax copy mode: `pax -rw src docs/`.

## Manual checks still owed

From HANDOFF.md, all `NOT VERIFIED (human)`:

- Phase 0: with the real global file holding the Spark and Mac runners, `kukulu_config_show` reports each role's runner; a throwaway clean-room flight with `runners.locality: "local"` and the default routing refuses at its first `kukulu_next`; with profile B routing it writes a genesis naming both runners and the Spark model's `weights` digest from `scripts/model-identity.mjs`.
- Phase 1: a small control flight's bundle verifies as `CONTROL (positive)` with exit 3; `publish-bundle.mjs` output copied to a static host verifies with `--check` from a second machine.
- Phase 2: on Linux, `doctor` passes and `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs` passes; a throwaway sandboxed clean-room flight runs to the end; inside it `curl https://example.com` fails and `ls ~/.cargo/registry` shows only the volume's own cache; its bundle verifies with `--require-enforcement container+proxy` and its egress summary lists only the runner endpoints. The same run inside a Linux VM on a Mac is a second, separate check. After R1-01, the same run also shows that writing under `/run/kukulu` fails inside while the hooks still reach the log socket.
- Phase 3: `compare-bundles.mjs` on the Phase 2 bundle and a hook bundle from a real flight prints wall time and tokens per role for both.
- Phase 4: on a scratch repository with a merged PR, `kukulu_release` makes a draft release whose notes match the CHANGELOG entry.
- The HANDOFF's first line stands: do not merge until the owner has run one sandboxed clean-room flight from the working tree on Linux and its bundle verifies with `--require-enforcement container+proxy`.

## Notes

- `kukulu_next` now commits on whatever branch the server is on, including the base branch before `kukulu_run_start`, and the flight's last call leaves a local `chore: stage end` commit that is never pushed (`test/drive.mjs` was relaxed to ignore it). PLAN decided this; the owner may want the trailing close to ride on the next pushed commit instead.
- `kukulu_attest` removes and recreates `docs/attestation/` in the project; under the sandbox the box could swap the directory for a symlink between the remove and the write. Small window; worth a look when F-03 is fixed.
- `runShell`'s wrapper interpolates `KUKULU_SANDBOX` unquoted (`mcp/server.mjs`, `runShell`); the launcher sets it, but quoting it costs nothing.
- `.pre-commit-config.yaml` gained an exclude for `test/fixtures/bundles/*/` (P2-09). No task named it, but the bundle's bytes are signed and the reason is stated in the file; not a finding.
- `.kukulu/state.json` carried `breaking: true` from the base commit into this flight. This flight's CHANGELOG has no Breaking changes heading, so finalize may report a disagreement; worth checking when finalizing.
