# Summary: Kūkulu 0.8.0 (build/2026-10-26)

**Do not merge until the owner has run one sandboxed clean-room flight from the working tree on Linux (`node scripts/sandbox.mjs run`) and its bundle verifies with `--require-enforcement container+proxy` (SPEC §8 Phase 2).**

## Merge line

`build/2026-10-26`, base `3aa6277` (main) → head `4a9a622`, 108 commits before this summary, 3 reviews, final verdict **APPROVED** (round 3). 47 of 47 tasks done (P0-01 to P4-06, R1-01 to R1-08, R2-01), none blocked or skipped. `kukulu_verify` green: 15 suites, 4,582 assertions. PR checks pass. `policies.finalize` is `ready`, so finalize marks the PR ready and never turns on auto-merge.

## What was built

**Phase 0, routing and identity (P0-01 to P0-07).** Runners now live in the global config under `runners`, and `kukulu_config_show` and the routing table show each role's runner. The clean-room policy gains `runners.allow`, `runners.locality` and `roles.distinct`. Gate check 8 (`routing`) refuses a flight whose roles break those rules, and genesis records each role's model, runner, identity and family. `scripts/model-identity.mjs` hashes a model's weight files into one digest. The `MODEL_FAMILIES` table was measured against recorded routing strings. The manifest records each role's identity.

**Phase 1, controls and publishing (P1-01 to P1-05).** Positive-control mode (`mode`, `control.priorArt`) is now in the policy and the guard. A passing control bundle verifies as `CONTROL (positive)` and exits 3. `--expect` names the mode a bundle must have. A verified control bundle can be the positive similarity pair by reference. `scripts/publish-bundle.mjs` writes a publishable copy with `SHA256SUMS` and `VERIFY.txt`, and can re-check one. `docs/publishing.md` documents it.

**Phase 2, the sandbox and enforcement (P2-01 to P2-15).** This is the largest phase. It adds the `container+proxy` enforcement level. New policy keys: `enforcement`, `sandbox.*` and `deny.packages`. The phase adds `mcp/relay.mjs` and the controller socket, so the server runs on the host and the agent runs in a container with `--network none`. The log socket lets the hooks inside append to the host's chain, and they fail closed when it cannot be reached. A CONNECT-only egress proxy allows only the runner endpoints and the hosts the policy allows. `scripts/sandbox.mjs` gets `doctor`, `run` and `stop`, plus an exact `containerArgs`. Gate check 9 (`boundary`) holds the container to its recorded image, network and mounts. Verify, build and mutate commands run inside the box. Signing has explicit rules under the boundary. Lockfile parsers feed gate check 10 (`packages`), and the guard denies `cargo add`, `npm install`, `pip install` and `uv add` of a denied package. Known limits now carry levels, and the verifier gains check 11 (`enforcement`) and `--require-enforcement`. The 0.7.2 known-gap candidates (`--remove-sent-files`, `pax`) are now handled. An opt-in real-container integration step was added.

**Phase 3, usage and comparison (P3-01 to P3-05).** `kukulu_next` records stage timing in `state.timeline` and as `stage` chain entries, committed as `chore: stage <stage>`. In clean-room mode, a `SubagentStop` logger appends per-model token `usage` entries. The manifest's `roles` gain `reported` and `usage`, and verifier check 12 (`roles`) recounts them. `scripts/compare-bundles.mjs` compares two bundles side by side.

**Phase 4, release tool, notes, docs and release (P4-01 to P4-06).** New tool `kukulu_release` tags the merged PR of the newest archived flight and makes a draft GitHub release from the CHANGELOG. When the previous flight is archived, `kukulu_next` checks the base's health against the archived constraints before planning. Also in this phase: the 0.7.2 review notes (rename-free diff classification), the documentation sweep, and CHANGELOG 0.8.0 with the version bump.

**Review fixes (R1-01 to R1-08, R2-01).** The sandbox runtime directory is mounted read-only, and gate check 9 accepts only the exact mount list. The constraint scan never reads through a symlinked file or directory that leaves the project (R1-02, completed by R2-01). Behind the sandbox, the plugin's own verifier runs and never one from the project tree. A control bundle always prints `CONTROL (positive)`. Fixes: the pre-release crate name and the stale "read-only" doc for `kukulu_next`. Several fixes added tests only: sandbox mechanics, the git `-c` options, the routing runner part, the control-path and lockfile sub-table rules, and `publish-bundle --check` integrity. Literal non-ASCII characters in scripts are now escapes.

## Decisions that shaped it

From PLAN.md's Decisions:

- Plan: five SPEC §8 phases in order, none merged. Fully serial. Slug `v0-8-0`, `baseBranch` `main`. The base was measured green, so there is no base-fix task.
- `policies` is `{ archive: true, finalize: "ready" }`: finalize marks the PR ready and never enables auto-merge, because the HANDOFF requires a live sandboxed run first.
- Constraints: the 28 v0-7-2 rules carried over unchanged, plus `sandbox-network-none`, `sandbox-no-escape-flags`, `relay-not-in-server` (from P2-02) and a fourth, `no-hardcoded-log-socket-timeout`.
- §9 Q1: runners live in the global file under `runners`, never `docs/kukulu.json` (owner decision).
- §9 Q2: local-only is configuration-asserted under `hook` and a fact under `container+proxy`, through gate check 9's egress part.
- §9 Q3: weight digests are measured on the inference host by `scripts/model-identity.mjs` and copied by hand. Genesis never hashes weights.
- §9 Q4: a control bundle gives `CONTROL (positive)` with exit 3. It exits 0 only with `--expect control-positive`.
- §9 Q5: the engine is `docker` then `podman`, Linux only. macOS runs it only inside a Linux VM, and `sandbox.mjs` refuses on `darwin`.
- §9 Q6: the controller runs on the host over Unix sockets. The server hands stdio to `relay.mjs` through `spawnSync` and stays synchronous.
- §9 Q7: under the boundary, commits inside are unsigned, commits outside are signed, and checkpoints vouch for every head.
- §9 Q8: package denial covers lockfiles and the cargo cache at every gate, plus four add commands in the guard. The proxy decides on host and port only.
- §9 Q9: `kukulu_release` makes a draft release by default, and `publish: true` only on an explicit ask. §9 Q10: the demo is not in this flight.
- A-01: `routingTable` gains a `runner` column. An endpoint port defaults to 443 for https and 80 for http.
- A-03: manifest `roles` are written in Phase 0. `assurance` becomes `egress` under `container+proxy` (P2-09), and `reported`/`usage` are added in P3-03.
- A-04: model normalization lowercases the name and strips every leading `<segment>/` or `<segment>,` prefix.
- A-02: a routing refusal before genesis is a `ToolError` starting `clean-room genesis refused: routing: `.
- B-02: a `subject` left side resolves to the project root for `rev-parse`.
- C-01: the image digest is the engine's image id, not a registry digest. The entrypoint is `ENTRYPOINT ["node"]` with the script path as the first argument. `--exec` runs a command instead of the harness. `-t` is used only on a TTY. `run` creates `.kukulu/` and `.claude/`, and refuses any other missing mount source.
- C-02: the log-socket client is inlined in each hook script, because gate check 3 pins them. The guard connects before deciding and denies when it cannot connect. The controller child's environment is fixed and drops `KUKULU_CONTROLLER_SOCKET`.
- C-03: egress entries are `stage: controller`, `role: session`. The gate part evaluates allowed entries against the current policy and ignores lockdown.
- C-04: self-tests stay on the host, and every project command runs inside. Stream run starts refuse under the sandbox.
- C-05: the implementer commits inside with `-c commit.gpgsign=false`. `signaturesExpected` treats the sandbox record like `"none"`.
- C-06: `coverageGaps` takes a `level`. Under `container+proxy`, trailed unsigned commits are counted and reported in one note.
- D-01: `kukulu_next` commits the timeline as `chore: stage <stage>` on whatever branch it is on.
- D-02: a second `SubagentStop` hook with no matcher, pinned by gate check 3. The verifier recount is a twelfth check, `roles`.
- E-01: the repository URL is parsed from `origin`. The tag is signed when `tag.gpgsign` is set or the archived flight recorded `signing: "on"`.
- Changelog lines go under Added, Changed or Fixed, with no Breaking changes heading.

From HANDOFF.md's Interpretation choices:

- P0-01: an `identities` entry without `weights` gets the weights refusal. A non-object runner block gets "must be an object".
- P0-03: each routing reason names the first failing role, in role order.
- P0-04: `fable-5-1`, `opus-5-5` and `sonnet-5-5` stay `unknown:` to match `isAnthropicModel`. No pattern was widened.
- P0-06: "genesis without roles gives roles null" is checked by reading only, because editing the log would break the chain.
- P1-01: the prior-art exemption covers reads only. A path counts as control only when every canonical form lies under `priorArt`.
- P1-02: `--expect control-positive` exits 0. Its PASS line was later corrected by R1-04 to `CONTROL (positive)`.
- P1-03: a control directory without `verify.mjs` refuses with its own wording.
- P1-04: `--check` expects exit 3 only for a control-positive bundle.
- P2-01: an empty `deny.packages` ecosystem list is refused. Mounts accept only `path` and `mode`.
- P2-02/P2-03: the controller uses `allowHalfOpen`. Under the log socket, the guard denies an unreachable socket even for an allowed call and before genesis.
- P2-04: a 403 carries `Content-Length`. An unreachable CONNECT upstream gets a 502. `hostPortOf` is exported.
- P2-05/P2-06: `planFor` takes an optional `policyPath`. Image presence means the engine reports exactly the pinned id. `main` returns a promise only for `run`.
- P2-07: `/run/kukulu` was allowed to be writable. Review F-01 overturned this, and R1-01 now mounts it `:ro`.
- P2-09: a manifest without `enforcement` is not compared against the known-limits list. Markdownlint excludes `test/fixtures/bundles/*/`, because those bytes are signed.
- P2-10: the finalize acceptance test lives in `test/review.mjs`.
- P2-11: a sub-table header ends a `[[package]]` block's keys. A lockfile from an ecosystem `deny.packages` does not name is not parsed.
- P2-12: the subcommand is the first operand that is not an option or `+toolchain`.
- P2-13: the rsync reason names the removal option as written. Pax copy mode is not modelled.
- P2-14: the container user takes a `KUKULU_UID` build argument (default 1000), so the bind-mounted project is writable.
- P3-01: the timeline commit is best effort. `commitStaged` gained `noSigningFallback`. A failed commit rolls back and returns a `timelineNote`.
- P3-02: a usage line without a model counts under `unknown`. Cost is rounded to six decimals.
- P3-03: the check-12 note names every reported model.
- P3-04: the comparison text format is the recorded `expected.txt`.
- P4-01: `kukulu_release` runs `git fetch origin` before reading the CHANGELOG at the merge commit. The newest entry must be the first `## [` heading and must be numbered.
- P4-03: the rename test needed `--no-renames` in `trackedChanges`, plus unstaging and removing a residue that HEAD lacks.
- R1-01: an unset `KUKULU_SANDBOX_HOOKS_PATH` fails the source check. Recorded boundary mounts keep `source`, `destination` and `rw`.
- R1-02: `skipped` appears only when it is non-empty.
- R1-03: the attest test lives in `test/attest.mjs`, and the sandbox-side control test in `test/sandbox.mjs`.
- R1-06: the crate name is what precedes the first `-X.Y.Z` segment.

## Assumptions still in play

| Key | Final default | Status |
|---|---|---|
| `MODEL_FAMILIES` (`mcp/cleanroom.mjs`) | the nine-family table | measured (`docs/spikes/P0-04.md`), unchanged |
| `LOG_SOCKET_BUDGET_MS` (`test/sandbox.mjs`) | 100 ms | measured (`docs/spikes/P2-03.md`: median about 26 ms, worst 47.5 ms), unchanged |
| `LOG_SOCKET_TIMEOUT_MS` (`mcp/cleanroom.mjs`) | 2000 ms | still a guess, not tuned |
| Proxy overhead per connection | informational | measured (`docs/spikes/P2-04.md`, about 1 ms); no default depends on it |
| `review.mutationFixRounds`, `TARGET_MAX`, `separationMargin`, `idleGapHours`, site tunables | unchanged from 0.7.x | carried, not retuned |

## Spec issues

From PLAN.md (each already resolved in the plan; SPEC should be corrected to match):

- C-02's test counts "26 tools", but the 26th lands after the relay. P2-02 compares the relayed list with a direct one instead.
- E-02 cites the wrong feedback item. The base-was-red friction is in `docs/flights/v0-7-2/feedback.jsonl`.
- §5.4 says three constraints are added, but §5.5's `LOG_SOCKET_TIMEOUT_MS` needs a fourth (`no-hardcoded-log-socket-timeout`).
- A-03's `roles.reported` depends on D-02's `usage` entries from Phase 3, so the manifest shape grows in two steps.
- D-02's verifier recount has no check number. It became check 12, `roles`.
- C-01's `<name>@sha256:` digest does not exist for a locally built image, so the engine's image id is used.
- C-01's entrypoint cannot carry a run-time plugin root. It is now `ENTRYPOINT ["node"]` plus a script argument.
- C-01's read-only `.kukulu/` rules out stream worktrees, so a sandboxed flight is serial.
- Under C-05, a read-only `commit.gpgsign true` breaks commits inside. The implementer now uses `-c commit.gpgsign=false`.
- D-01's timeline in `state.json` would dirty the base, so it is committed as `chore: stage <stage>`.
- `.mcp.json` must name `KUKULU_CONTROLLER_SOCKET` explicitly.
- §6 F gives HANDOFF's first line, but no task writes HANDOFF. CLAUDE.md and P4-06 carry it.

From REVIEW.md rounds 1 to 3 (open, for the next SPEC):

- C-04 lets the server read project files outside the box, but never says it must not follow a symlink out of the project. The constraint scan is now closed for linked files and linked parent directories. `packagesCheck`, `kukulu_attest`'s `packages` and `kukulu_attest`'s document and evidence copies are in the same class. State one rule for every outside read: resolve the real path and refuse anything outside the project.
- C-01 does not say the runtime directory is mounted read-only. The code now does this (R1-01).
- B-02 says "that bundle's own `verify.mjs`", but under `container+proxy` the code runs the plugin's own verifier (R1-03).
- The C-02 log socket accepts every entry kind from the box. It could be restricted to the hook kinds (`allowed`, `denied`, `human`, `usage`).

Known-gap candidates (principle 1; not tasks), verbatim from the final REVIEW.md:

- Package-add words and subcommands the rule does not name: `pip3`, `pnpm`, `yarn`, `poetry add`, `cargo install <name>`, and an add through a requirements file.
- An option value placed before the subcommand: `cargo --manifest-path x/Cargo.toml add flate2`.
- Pax copy mode: `pax -rw src docs/`.

## Manual checks owed

All `NOT VERIFIED (human)`:

- **Phase 0**, with the real global file holding the Spark and Mac runners:
  - `kukulu_config_show` reports each role's runner.
  - A throwaway clean-room flight with `runners.locality: "local"` and the default routing refuses at its first `kukulu_next`.
  - With profile B routing, the same flight writes a genesis that names both runners and the Spark model's `weights` digest from `scripts/model-identity.mjs`.
- **Phase 1**:
  - A small control flight's bundle verifies as `CONTROL (positive)` with exit 3.
  - `publish-bundle.mjs` output, copied to a static host, verifies with `--check` from a second machine.
- **Phase 2**, on Linux:
  - `doctor` passes, and `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs` passes. The implementer ran this once with docker 29.9.2 (189 assertions) and again after R1-01 (211/211, including `RUNTIME_WRITE_FAIL` and `SOCKET_OK`).
  - A throwaway sandboxed clean-room flight runs to the end. Inside it, `curl https://example.com` fails, `ls ~/.cargo/registry` shows only the volume's own cache, and writing under `/run/kukulu` fails while the hooks still reach the log socket.
  - Its bundle verifies with `--require-enforcement container+proxy`, and its egress summary lists only the runner endpoints.
  - The same run inside a Linux VM on a Mac is a second, separate check.
- **Phase 3**: run `compare-bundles.mjs` on the Phase 2 bundle and on a hook bundle from a real flight. It should print wall time and tokens per role for both.
- **Phase 4**: on a scratch repository with a merged PR, `kukulu_release` makes a draft release whose notes match the CHANGELOG entry.
- **Merge gate**: the HANDOFF's first line stands. Do not merge until the sandboxed clean-room flight above has run from the working tree and its bundle verifies with `--require-enforcement container+proxy`.

## Review history

- Round 1: 8 findings (F-01 to F-08: three boundary defects, four test gaps, one spec drift), 8 fix tasks (R1-01 to R1-08; sources: review 7, mutation 1, blocked 0). CHANGES REQUESTED.
- Round 2: 1 finding, 1 fix task (R2-01; review 1). CHANGES REQUESTED. **Recurred:** F-01 reopened round 1's F-02 (P2-08). R1-02 had closed the symlinked file, but a file under a symlinked directory was still read.
- Round 3: 0 findings, 0 fix tasks. **APPROVED, with a `## Notes` section.** The notes flagged these without queuing work:
  - The advisory mutation survivor (below).
  - The per-file `realpathSync` cost, measured as negligible.
  - HANDOFF's stale head line.
  - The unreachable `mount /run/kukulu is writable` message at `mcp/server.mjs:244`.
  - The check-then-read window in the constraint scan.
  - `docs/sandbox.md:83`'s "the only read-write mount".
  - The trailing local `chore: stage end` commit.
  - The `docs/attestation/` remove-and-recreate window.
  - The unquoted `KUKULU_SANDBOX` in `runShell`'s wrapper.
  - The `breaking: true` carried in `.kukulu/state.json` from the base.
- No round was non-converging.

## Pipeline friction

- review, verbose-output: `kukulu_mutate` returns the full constraints result list (32 rules, all ok) on every call, even with a targeted command; across ~25 sampled mutants that block is most of each result and buries the failure tail the reviewer needs. Returning only failing constraints (or a count) would cut the noise.

## Suggested CLAUDE.md additions

- `kukulu_next` is no longer read-only. Every stage change commits `.kukulu/state.json` (and the log in clean-room mode) as `chore: stage <stage>` on whatever branch the server is on, including the base branch before `kukulu_run_start`. The last call of a flight leaves one local unpushed `chore: stage end` commit. Tests that count `kukulu_next`'s entries or commits must allow for this.
- `test/plugin.mjs` reads `git ls-files`. A new document must be committed, and linked from the README, before `kukulu_verify` is green.
- A hook that talks to an in-process socket cannot be run with `spawnSync`, because it blocks the event loop. Run such hooks with `spawn`.
- The project is bind-mounted into the container, so the container user needs the host user's uid (`KUKULU_UID`, P2-14).
- A literal `2000` anywhere in `mcp/cleanroom.mjs` and the sandbox scripts trips `no-hardcoded-log-socket-timeout`. Write other two-second values as `2 * 1000`.
- Markdownlint turns a paragraph directly above a `---` rule into a setext heading. Recorded bundles under `test/fixtures/bundles/` are excluded from markdownlint because their bytes are signed.

## Advisory mutation survivors

- Advisory survivor, carried to SUMMARY.md: `mcp/server.mjs:3297`. Changing `real.startsWith(realRoot + path.sep)` to `real.startsWith(realRoot)` survives `test/constraints.mjs`. No case links to a sibling directory whose name has the project root as a prefix (for example root `/tmp/repo` and a link to `/tmp/repo-evil/secret.js`). The code is correct today. A future test could add that sibling-prefix link so the separator cannot be dropped silently.

## Breaking call

Breaking: no — CHANGELOG.md's newest entry (`## [0.8.0] — 2026-10-26`) has no `### Breaking changes` section. Note: I partly disagree. Under Changed, a clean-room flight started on 0.7.x cannot continue on 0.8.0, and `kukulu_next` now commits on every stage change. A user may rely on either behavior. The PR will not auto-merge either way, because `policies.finalize` is `ready`. Also, `.kukulu/state.json` carried a stale `breaking: true` from the base, and the CHANGELOG verdict overrides it.
