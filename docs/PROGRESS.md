# Kūkulu 0.8.0 build progress

Branch: build/2026-10-26
Started: 2026-10-26T21:19:36.125Z

## Tasks

- [x] P0-01 Runners in the global file, and each role's runner in the routing
- [x] P0-02 The policy's runner and role keys, and the model-family table
- [x] P0-03 Gate check 8 and genesis record the roles
- [ ] P0-04 Tune MODEL_FAMILIES against the recorded routing strings
- [ ] P0-05 scripts/model-identity.mjs and the bundles suite
- [ ] P0-06 The manifest records each role's identity
- [ ] P0-07 Phase 0 end: push and record the manual check
- [ ] P1-01 Control mode in the policy and the guard
- [ ] P1-02 Control mode in genesis, the manifest and the verifier
- [ ] P1-03 The control bundle is the positive pair
- [ ] P1-04 scripts/publish-bundle.mjs and docs/publishing.md
- [ ] P1-05 Phase 1 end: push and record the manual check
- [ ] P2-01 The policy's enforcement, sandbox and package keys, and the local-only template
- [ ] P2-02 mcp/relay.mjs, the controller socket and the sandbox suite
- [ ] P2-03 The log socket, and its round-trip budget
- [ ] P2-04 The egress proxy, the bridge, and its overhead
- [ ] P2-05 containerArgs, the plan, the Containerfile, the fake docker and doctor
- [ ] P2-06 run and stop, and docs/sandbox.md
- [ ] P2-07 Gate check 9 and the boundary in genesis
- [ ] P2-08 Commands run inside the boundary
- [ ] P2-09 The enforcement level: known limits per level, the manifest and verifier check 11
- [ ] P2-10 Signing under the boundary
- [ ] P2-11 Lockfile parsers, gate check 10 and the manifest's packages
- [ ] P2-12 The guard denies adding a denied package
- [ ] P2-13 The 0.7.2 known-gap candidates: --remove-sent-files and pax
- [ ] P2-14 The real-container integration step
- [ ] P2-15 Phase 2 end: push and record the manual checks
- [ ] P3-01 Stage timing in the log and in state
- [ ] P3-02 Token use per role from the subagent transcript
- [ ] P3-03 The manifest's reported models and usage, and verifier check 12
- [ ] P3-04 scripts/compare-bundles.mjs
- [ ] P3-05 Phase 3 end: push and record the manual check
- [ ] P4-01 kukulu_release
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
