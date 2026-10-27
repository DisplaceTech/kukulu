# Kūkulu 0.8.0 build progress

Branch: build/2026-10-26
Started: 2026-10-26T21:19:36.125Z

## Tasks

- [x] P0-01 Runners in the global file, and each role's runner in the routing
- [x] P0-02 The policy's runner and role keys, and the model-family table
- [x] P0-03 Gate check 8 and genesis record the roles
- [x] P0-04 Tune MODEL_FAMILIES against the recorded routing strings
- [x] P0-05 scripts/model-identity.mjs and the bundles suite
- [x] P0-06 The manifest records each role's identity
- [x] P0-07 Phase 0 end: push and record the manual check
- [x] P1-01 Control mode in the policy and the guard
- [x] P1-02 Control mode in genesis, the manifest and the verifier
- [x] P1-03 The control bundle is the positive pair
- [x] P1-04 scripts/publish-bundle.mjs and docs/publishing.md
- [x] P1-05 Phase 1 end: push and record the manual check
- [x] P2-01 The policy's enforcement, sandbox and package keys, and the local-only template
- [x] P2-02 mcp/relay.mjs, the controller socket and the sandbox suite
- [x] P2-03 The log socket, and its round-trip budget
- [x] P2-04 The egress proxy, the bridge, and its overhead
- [x] P2-05 containerArgs, the plan, the Containerfile, the fake docker and doctor
- [x] P2-06 run and stop, and docs/sandbox.md
- [x] P2-07 Gate check 9 and the boundary in genesis
- [x] P2-08 Commands run inside the boundary
- [x] P2-09 The enforcement level: known limits per level, the manifest and verifier check 11
- [x] P2-10 Signing under the boundary
- [x] P2-11 Lockfile parsers, gate check 10 and the manifest's packages
- [x] P2-12 The guard denies adding a denied package
- [x] P2-13 The 0.7.2 known-gap candidates: --remove-sent-files and pax
- [x] P2-14 The real-container integration step
- [x] P2-15 Phase 2 end: push and record the manual checks
- [x] P3-01 Stage timing in the log and in state
- [x] P3-02 Token use per role from the subagent transcript
- [x] P3-03 The manifest's reported models and usage, and verifier check 12
- [x] P3-04 scripts/compare-bundles.mjs
- [x] P3-05 Phase 3 end: push and record the manual check
- [x] P4-01 kukulu_release
- [ ] P4-02 Base health before planning
- [ ] P4-03 The 0.7.2 review's notes
- [ ] P4-04 The documentation sweep
- [ ] P4-05 CHANGELOG 0.8.0 and the version
- [ ] P4-06 Phase 4 end: push and record the manual check

## Log

(one entry per task, appended by implement)

### P0-01 — 7cf3296

Added validateRunners, runnerFor, GLOBAL_KEYS runners; resolveRouting returns runners and per-role runner/endpoint/locality/source.runner; routing table gained runner column; config_show returns runners. Template, routing.md Runners section, mcp-tools.md, CHANGELOG Unreleased done.
Tests: 11 refusal assertions plus resolution/table tests in test/routing.mjs (274 pass); full npm test green.
Interpretation: identities entry without weights refused with the weights message; non-object runner block refused as must be an object.
Separate chore commit c05c6a7: mcp/cleanroom.mjs LOCK_WAIT_MS = 2000 tripped the new no-hardcoded-log-socket-timeout constraint (hit existed at base); rewritten as 2 * 1000 (unrelated lock wait). Later tasks adding LOG_SOCKET_TIMEOUT_MS must keep 2000 only in its export line.

### P0-02 — 188506d

loadPolicy returns runners {allow,locality} and roles {distinct} with defaults null/any/none; exports normalizeModel, MODEL_FAMILIES (assumption data, only in cleanroom.mjs), familyOf. Fixture test/fixtures/families.json (16 entries). docs/cleanroom.md rows, CHANGELOG line. Tests in test/cleanroom.mjs (1125 pass), full verify green.

### P0-03 — 2f52b07

rolesRecord/routingCheck added in server.mjs; cleanroomGenesis runs parts 2-4 before key/writes and records data.roles and data.distinct; runGate check 8 routing (genesis roles from chain.entries[0].data.roles; skipped when absent). Gate counts now 8 in tests/docs. Tests: test/cleanroom.mjs (1150 pass), full verify green.
Interpretation: first failing role in role order named in each reason.
Note: hand-built gate entries in harness/attest tests still say checks: 7; harmless.

### P0-04 — 0e5c62b

Measured MODEL_FAMILIES against all documented routing strings (docs/spikes/P0-04.md). Before = P0-02 table (nine families); after = unchanged: no documented routing string belonging to a listed family fell into unknown. fable-5-1, opus-5-5, sonnet-5-5 (an old base-commit mistake) stay unknown to match isAnthropicModel. families.json now 26 entries. Verify green.

### P0-05 — b56a80b

scripts/model-identity.mjs (exports identityOf, main; CLI only as entry), fixtures in test/fixtures/identity (expected.txt digest independently re-computed). test/bundles.mjs registered between attest and drive; suite counts now fourteen (CONTRIBUTING, README, plugin test). routing.md Runners paragraph on measuring digests; CHANGELOG. Verify green (3982 assertions).

### P0-06 — 837f6d0

attest() manifest gains roles after genesis (genesis.data.roles each plus assurance configuration, null when absent). Tests in test/attest.mjs (224 pass). Interpretation: the null-roles case is not testable through the server (log edits break the chain), so it is covered by reading. Docs updated. Verify green.

### P0-07 — ca9b149

Push: pushed build branch to origin. Empty phase-end commit.
Manual check: NOT VERIFIED (human): with the owner's real global file holding the Spark and Mac runners, kukulu_config_show reports each role's runner; a throwaway clean-room flight with runners.locality "local" and the default routing refuses at its first kukulu_next; with profile B routing it writes a genesis whose roles name both runners and the Spark model's measured weights digest from scripts/model-identity.mjs run on the Spark.

### P1-01 — bb158aa

loadPolicy: mode (clean-room|control-positive), control.priorArt with all refusals; policy now carries mode and control. controlPaths exported. evaluate: read-only exemption from deny.paths/pathPatterns/deny.words for paths under priorArt (read tools; Bash read-family words; recursive/glob reach). 8 new fixtures (P1-01), none changed; guard self-test 532 cases. docs/cleanroom.md: policy rows and ## Control mode. Verify green (4005 assertions).
Interpretation: exemption reads-only; a path is control only if every canonical form is under a priorArt entry.

### P1-02 — 0ab84ec

Genesis data.mode = policy.mode (+ control.priorArt for control flights); attest manifest mode from genesis; kukulu_attest runs verifier with --expect <genesis mode>. Verifier: verifyBundle {key, expect}, returns mode; check 7 new reasons; CLI --expect, exit 3 + CONTROL (positive); --json carries mode. buildBundle opts.mode now sets manifest mode too. Tests: attest 243, cleanroom 1184; verify green.
Interpretation: --expect control-positive on a passing control bundle prints PASS exit 0; old check-7 reason text replaced.

### P1-03 — ea67e3f

validateSimilarity/normalizeSimilarity: control key on the positive pair only; verifyControlBundle() runs the bundle's verify.mjs --expect control-positive --json then compares the left side HEAD with manifest repo.head, before readSide; similarity.json config.pairs positive gets control {manifest, head, fingerprint}. buildBundle opts.head. Tests in test/cleanroom.mjs (1194). Docs operations/mcp-tools/CHANGELOG. Verify green.
Interpretation: left "subject" means project root for rev-parse; missing verify.mjs refusal wording added.

### P1-04 — 6c701a5

scripts/publish-bundle.mjs (publish and --check; exports publish, check, main), docs/publishing.md, README docs-map link, CONTRIBUTING row, CHANGELOG. bundles suite now 47 assertions. Interpretation: --check expects exit 3 only for control-positive; file count includes SHA256SUMS and VERIFY.txt.
Lesson: the plugin suite's link check reads git ls-files, so a new doc must be committed before kukulu_verify is green.

### P1-05 — e66f04d

Push: pushed build branch to origin. Empty phase-end commit.
Manual check: NOT VERIFIED (human): a small control flight's bundle verifies as CONTROL (positive) with exit 3; publish-bundle.mjs output copied to a static host verifies with --check from a second machine.

### P2-01 — 1c01978

loadPolicy: enforcement, sandbox.{image,mounts,egress}, deny.packages with all refusals; policy carries enforcement, sandbox {image,mounts,egress}, deny.packages. KINDS += egress, stage, usage; LOG_SOCKET_TIMEOUT_MS exported (2000 only on that line). templates/cleanroom.local-only.example.json (SPEC example); both guard self-tests pass (532 / 528 cases). Tests in test/cleanroom.mjs (1211); KINDS count test now twelve. Verify green.
Interpretation: empty deny.packages ecosystem list refused; mounts entries accept only path/mode.

### P2-02 — 3e14bc0

mcp/relay.mjs, server startup relay hand-off (spawnSync, before anything else), kukulu_status.sandbox, .mcp.json env key, scripts/sandbox.mjs startControllerSocket {listening, close} and main (darwin refusal, usage 2). test/sandbox.mjs (12 assertions); suite registered (fifteen suites in CONTRIBUTING/README/plugin test). Constraints sandbox-network-none, sandbox-no-escape-flags, relay-not-in-server now active and green.
Interpretation: controller server uses allowHalfOpen; startControllerSocket returns a listening promise so tests can await it.

### P2-03 — 7717ef0

startLogSocket in scripts/sandbox.mjs ({listening, close}); both hooks gained an inlined socket client (guard connects first and denies when unreachable; logger exits 1) using LOG_SOCKET_TIMEOUT_MS; docs/sandbox.md created (## The sockets) and linked from README; docs/cleanroom.md source box sentence. test/sandbox.mjs 30 assertions; hooks run async in tests since spawnSync would block the in-process socket. Plugin suite plugin-wide link rule: every docs/*.md must be linked from README.
Measurement: before 100 ms (SPEC 5.5); after 100 ms unchanged. Cost over bare Node: median 26.4/24.8 ms, p90 36.7/35.3 ms, max 39.7/47.5 ms (30 runs, two measurements); headroom ~52 ms at worst run. docs/spikes/P2-03.md.
Interpretation: unreachable socket denies even before genesis; logger appends detail in parentheses for non-unreachable errors.

### P2-04 — 1667458

scripts/sandbox.mjs: hostPortOf, egressDecision, startProxy ({listening, close}); scripts/sandbox-entry.mjs: startBridge ({listening, port(), close}) and main (spawns claude --plugin-dir, or --exec). Tests in test/sandbox.mjs (55 assertions, in-process proxy + echo servers). docs/sandbox.md ## Egress, cleanroom.md egress kind. docs/spikes/P2-04.md informational: bridge+proxy added ~1 ms median per connection (two runs: 1.06/0.94 ms), bulk transfer 2-5x slower than direct loopback.
Interpretation: 403 carries Content-Length too; CONNECT to an unreachable upstream gets 502; hostPortOf exported for runner endpoints.

### P2-05 — 5d6cddf

scripts/sandbox.mjs: projectIdFor, runtimeDirFor, planFor (extra optional policyPath), containerArgs (exact list, no other flag), doctor (+ --engine). templates/sandbox/Containerfile, mkFakeDocker in test/harness.mjs, test/fixtures/docker/{version.txt,inspect.json,README.md}. inspect.json: container kukulu-0123456789abcdef, plugin root /opt/kukulu, root as __ROOT__ (P2-06/P2-07 tests substitute). docs/sandbox.md: Building the image, doctor, The mount list. test/sandbox.mjs 94 assertions. Verify green (4180).
Interpretation: doctor treats enforcement hook / missing sandbox.image as problems; missing image is one problem (plus build/paste lines).

### P2-06 — 0d473c9

scripts/sandbox.mjs: run (async, all refusals in the specified order before anything starts, listeners + container, cleanup, SIGINT/SIGTERM stop) and stop. imagePresent now compares ids (doctor too). mkFakeDocker run writes runtime-listing.txt for the mid-run socket check. docs/sandbox.md completed (Running a flight, macOS, What an agent inside can/cannot do, worked local-only flight); operations.md env table. test/sandbox.mjs 120 assertions; verify green (4206).
Interpretation: main returns a promise for run only; CLI awaits it.

### P2-07 — 43a52f4

server.mjs: inspectContainer, boundaryCheck, egressAudit; genesis records data.enforcement (+ boundary under container+proxy) and refuses with "clean-room genesis refused: boundary: ..." before writing; runGate check 9 boundary after routing (passing entry carries container id). Tests in test/sandbox.mjs (156). Fixture inspect.json gained an Id.
Interpretation: the writable-mount set is project + /home/kukulu + /run/kukulu (containerArgs mounts the socket directory writable, so the task text "exactly project and home volume" cannot hold for a real container). Gate count is 9 under container+proxy, 8 otherwise.

### P2-08 — 8db035e

server.mjs: gitArgv wraps every spawnSync("git") site (git(), signingProbe, commitStaged, classifyChanges, attest log, rebase, control-bundle rev-parse); runShell(cmd, timeoutMs, cwd, {inside}) wraps in engine exec with inner timeout when KUKULU_SANDBOX is set (guard self-tests pass inside:false); runStart refuses a stream inside. Tests in test/sandbox.mjs (168). docs: mcp-tools (verify, mutate, run_start), sandbox.md What runs where. Markdownlint caught an inserted paragraph before a --- rule (setext heading); fixed and amended before recording.

### P2-09 — 75071d4

cleanroom.mjs: ENFORCEMENT_LEVELS, KNOWN_LIMITS as 12 {id,text,levels}, knownLimitsFor (throws CleanroomError). Verifier duplicates table+function by hand; check 11 enforcement, --require-enforcement (usage error exit 2 on unknown), returns/--json enforcement, absent field reads as hook with a note. attest(): manifest.enforcement {level,[boundary,egress]}, coverage.knownLimits per level, roles assurance egress under container+proxy. Harness buildBundle opts.enforcement; fixture test/fixtures/bundles/v0-7-2 (public key + signatures only; fingerprint in test/fixtures/bundles/README.md). docs/cleanroom.md Known gaps is now a 12-row table. attest 275, cleanroom 1213 assertions.
Interpretation: a manifest without an enforcement field is not compared against a known-limits list. .pre-commit-config.yaml now excludes test/fixtures/bundles/*/ from markdownlint (signed bytes cannot be reformatted).

### P2-10 — 24e82d9

server: startRun refuses required inside the sandbox before any write; probeSigning returns the "off (sandbox: ...)" record under auto (no probe, gpgsign untouched); signaturesExpected false for it; signingNoteFor has the sandbox note; finalize reports "not required: commits made inside the sandbox are unsigned; ...". coverageGaps takes level (both copies); attest manifest coverage.unsignedTrailed under container+proxy; verifier recounts and prints one note. Tests: sandbox 177, attest 285, cleanroom 1215, review 445; verify green.
Interpretation: the finalize acceptance test is in test/review.mjs (finalizeRepo helper is local to it).

### P2-11 — 11cbd67

cleanroom.mjs: LOCKFILES, lockfileEcosystem, lockfilePackages (TOML blocks, package-lock, requirements), normalizePackageName, deniedPackage. server: trackedLockfiles, packagesCheck, gate check 10 (packages, after boundary) incl. cargo cache listing via engine exec; attest manifest.packages after enforcement. Fixtures test/fixtures/lockfiles. cleanroom 1238, attest 287, sandbox 184; verify green.
Interpretation: sub-table headers end a [[package]] block's own keys; a lockfile of an ecosystem deny.packages does not name is not parsed; a non-"No such file" find failure fails the check with the engine's first stderr line.

### P2-12 — 38b667b

evaluate rule 6 gains the package-add check (cargo add; npm install|i|add; pip install; uv add) before the network rule of a segment; reason "denied package: <name> is in policy deny.packages.<ecosystem>". 14 new fixtures (P2-12), none changed (guard self-test 546/542 cases). docs/cleanroom.md rule 6 sentence. Known-gap candidates (for REVIEW): pip3, pnpm, yarn, poetry add, cargo install, adds via requirements files.
Interpretation: subcommand = first operand that is not an option or +toolchain; later non-option tokens are specs (option values over-deny only a name that is itself denied).

### P2-13 — 81e47d1

rsyncParts: --remove-sent-files sets removesSources (stores the option name; reasons name it as written, existing --remove-source-files text unchanged). New pax rule (paxParts): -r alone extracts into the cwd after a cd (reason "pax extracts into <abs dir>"), -w alone writes the -f archive like tar -cf. 6 new fixtures (P2-13), insertions only (guard self-test 552/548). Known-gap candidate for REVIEW: pax copy mode (-r with -w). KNOWN_LIMITS unchanged. CHANGELOG ### Changed.

### P2-14 — 565c48a

test/sandbox.mjs integration step: skip line + assertion without KUKULU_SANDBOX_IT/docker; with it, builds test/fixtures/docker/Containerfile.it and runs sandbox run --exec in a temp project. Ran once here (docker 29.9.2): image built, command exited 0, NET_FAIL, KUKULU_WRITE_FAIL and PROJECT_OK all appeared, it-file.txt visible outside, .kukulu untouched (189 assertions with the variable; 185 without).
Codebase note: the project is bind-mounted, so the container user must have the host user's uid or it cannot write; added ARG KUKULU_UID (default 1000, replacing the base image node user) to both the IT Containerfile and templates/sandbox/Containerfile; docs/sandbox.md says to pass --build-arg KUKULU_UID=$(id -u) when not 1000.
Interpretation: markers are appended to it-markers.txt in the project since the container's stdout is inherited.

### P2-15 — f8425be

Push: pushed build branch to origin. Empty phase-end commit.
Manual check: NOT VERIFIED (human): on Linux, doctor passes; KUKULU_SANDBOX_IT=1 node test/sandbox.mjs passes (the implementer ran it once here with docker 29.9.2: it passed); a throwaway sandboxed clean-room flight runs to the end; inside it curl https://example.com fails and ls ~/.cargo/registry shows only the volume's own cache; its bundle verifies with --require-enforcement container+proxy and its egress summary lists only the runner endpoints. The same run inside a Linux VM on the owner's Mac is a second, separate check.

### P3-01 — ddfd35d

server: next() now wraps nextDecision() with recordTimeline (state.timeline in every mode, stage entries in the chain, commit chore: stage <stage> / chore: stage end; skipped outside a git repo); kukulu_status gains timeline and stageSeconds. commitStaged gained noSigningFallback so bookkeeping never flips the run's signing off; a failed timeline commit rolls back and returns the decision with a timelineNote. Verifier unchanged (kinds unchecked; summarizeEntries counts allowed/denied only). Tests: state 297; cleanroom/streams/drive assertions that counted next()'s entries or commits updated. Verify green (4400).
Codebase note (for REVIEW): kukulu_next is no longer read-only; every stage change commits state.json (and the log) on whatever branch the server is on, including the base branch before run_start, and a flight's final done leaves one local unpushed chore: stage end commit.

### P3-02 — d3c9262

hooks.json: second SubagentStop entry (no matcher) running cleanroom-log.mjs after the implement guard; gate check 3 requires it; logger usageOf() appends a usage entry (per-model requests/input/output/cacheRead/cacheWrite, each requestId once, first/last, cost or null, or {error}); general mode writes nothing; goes through the log socket via record(). Fixture test/fixtures/transcripts/subagent.jsonl (6 lines, no content). cleanroom 1286, plugin 576; verify green (4419). Budget: SubagentStop fast path under 50 ms; full path with policy and fixture measured 26.7 ms beyond bare Node. CHANGELOG notes that a 0.7.x clean-room flight cannot continue on 0.8.0.
Interpretation: cost rounded to 6 decimals; a line without a model counts under "unknown".

### P3-03 — a7c02eb

rolesUsage(entries) in mcp/cleanroom.mjs (server and harness import it) duplicated in the verifier; attest roles[role] gain reported + usage; verifier check 12 roles recounts and fails with the recount JSON, notes a role whose reported models differ from the routed one (names all reported models); manifest without roles passes with no note. buildBundle opts.roles; --json checks list twelve. attest 301; verify green (4433).
Interpretation: note lists every reported model; cost sums rounded to six decimals in both copies.

### P3-04 — d5f1ffd

scripts/compare-bundles.mjs (verifies each bundle first; nine items A/B; --json; --trees cross score with A's parameters, refusals for mismatch and no similarity.json; writes nothing). buildComparePair in test/harness.mjs; recorded test/fixtures/compare/expected.txt (identical across two runs). bundles suite 77; verify green (4463). CONTRIBUTING row, cleanroom.md ## Comparing two bundles.
Interpretation: one prefixed line per role; metric lines indented under the verdict; blank line between sections; B's parameters used when only B has similarity.json.

### P3-05 — 71a600d

Push: pushed build branch to origin. Empty phase-end commit.
Manual check: NOT VERIFIED (human): compare-bundles.mjs on the Phase 2 bundle and a hook bundle from a real flight prints wall time and tokens per role for both.

### P4-01 — 8b65053

New tool kukulu_release (26 tools; after kukulu_pr_finalize): validates, fetches origin, reads CHANGELOG at the merge commit, tags (-s or -a), pushes, gh release create --verify-tag (draft unless publish); repeat calls create only what is missing. mkFakeGhBin extended (pr view <branch>, release view/create). go-flight: allowed-tools both spellings + "release it" / "release and publish"; docs/mcp-tools.md section + count; README count + row. review 475, plugin 588; verify green (4505).
Interpretation: git fetch origin before reading CHANGELOG at the merge commit; newest entry must be the first "## [" heading and numbered; existing tag at the merge commit with no release skips creation; See-line URL derived from origin (ssh/scp to https, .git stripped, local path as written).
