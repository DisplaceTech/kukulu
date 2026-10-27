# Kūkulu 0.8.0 build plan

Derived from docs/SPEC.md v0.8.0 on 2026-10-26. SPEC.md wins over this file.

## Decisions

- Phases → SPEC §8's five phases, in order, none merged: routing and identity (A), controls and publishing (B), the sandbox and enforcement (C, with the two spikes), usage and comparison (D), then the release tool, the notes, the documentation and the release (E, F). Inside a phase the order is SPEC §6's, except that Phase 2 builds the policy keys first and the sandbox from the inside out (relay, log socket, proxy, container, gate), because each later task tests against the piece before it.
- The base is green → `main` at `984d4ab` passes `npm run lint`, `npm test` (3,871 assertions in thirteen suites) and the guard self-test (524 cases), measured while planning. No base-fix task is needed.
- Parallel streams → none; the plan is fully serial, as SPEC's size recommendation says. Nearly every task edits `mcp/server.mjs`, `mcp/cleanroom.mjs`, `CHANGELOG.md` or `docs/cleanroom.md`.
- Flight slug → `v0-8-0`, the operator's slug (`flight=v0-8-0`), which SPEC's size recommendation also names.
- `baseBranch` → `main`, the branch the plan is committed on and the one SPEC §5.1 names; build branches are `build/<date>`.
- `policies` → `{ "archive": true, "finalize": "ready" }` exactly as SPEC §5.1 says: the HANDOFF asks for a live sandboxed run before merging, so finalize marks the PR ready and never enables auto-merge. `maxRounds` and `maxRoundsHard` stay 3 and 6.
- Constraints → the 28 rules of `docs/flights/v0-7-2/kukulu.json`, carried over with identical patterns, flags, paths, excludes and fixtures (principle 9, §5.4), plus `sandbox-network-none`, `sandbox-no-escape-flags` and `relay-not-in-server` (§5.4, active from P2-02, the task that creates `scripts/sandbox.mjs` and `mcp/relay.mjs`), plus a fourth, `no-hardcoded-log-socket-timeout`, because `LOG_SOCKET_TIMEOUT_MS` is an ⚠️ ASSUMPTION that SPEC says lives in `mcp/cleanroom.mjs` only, and the plan-build rule turns every such single-line rule into data (see Spec issues). The file is ASCII-only, with JSON escapes for non-ASCII characters.
- `extraVerify` and `mutation.targeted` → SPEC §7: the guard self-test on the four clean-room paths, plus, from P2-01, the same self-test on `templates/cleanroom.local-only.example.json` on those four paths and on the template's own path; `npm run check:site` on the site paths; `suite` = `node test/{filter}.mjs`.
- §9 Q1 (where runners live) → the global file, under `runners` (A-01, P0-01); never `docs/kukulu.json`. An owner decision of 2026-10-26.
- §9 Q2 (how local-only is proved) → configuration-asserted under `hook` (`roles.assurance: "configuration"`), a fact under `container+proxy` through gate check 9's egress part (`"egress"`); the manifest says which (P0-06, P2-07, P2-09).
- §9 Q3 (how a weight digest is measured) → on the inference host, by `scripts/model-identity.mjs` (P0-05), copied into the global file by hand; genesis never hashes weights.
- §9 Q4 (a control bundle's verdict) → `CONTROL (positive)` with exit 3, never exit 0 without `--expect control-positive` (P1-02).
- §9 Q5 (the engine) → `docker` or `podman` on Linux, in that order of discovery; macOS only inside a Linux VM; `scripts/sandbox.mjs` refuses on `darwin` (P2-06). Tests inject the platform through `main(argv, { platform })`, so the suite runs on macOS CI without the refusal firing.
- §9 Q6 (where the controller runs) → on the host, reached over Unix sockets; `mcp/server.mjs` hands its stdio to `mcp/relay.mjs` through `spawnSync` and stays synchronous (P2-02).
- §9 Q7 (signing under the boundary) → commits inside are unsigned, the server's own commits outside are signed as usual, and the checkpoints vouch for every head (P2-10).
- §9 Q8 (package denial) → lockfiles and the cargo cache at every gate (P2-11), the four add commands in the guard (P2-12); the proxy decides on host and port only.
- §9 Q9 (the release tool's default) → a draft release; `publish: true` only when the operator says "release and publish" (P4-01).
- §9 Q10 (the demo) → not in this flight; D-01's `timeline` and `stage` entries (P3-01) give it timestamps.
- A-01's runner column → `routingTable` gains `runner` between `model` and `effort`, so both `kukulu_agents_sync.table` and `kukulu_config_show.table` show it; an unmatched model prints `–`, like a dropped effort.
- A-01's endpoint port → `https` defaults to 443 and `http` to 80 when the endpoint names none; the proxy (P2-04) and the egress gate (P2-07) compare `host:port` after that default.
- A-03's manifest `roles` → written in Phase 0 (P0-06) with `assurance: "configuration"` and without `reported` or `usage`; P2-09 sets `assurance: "egress"` under `container+proxy`, and P3-03 adds `reported` and `usage` once the `usage` entries exist. The verifier's note on a reported model is P3-03's.
- A-04's normalization → lowercase, then every leading `<segment>/` or `<segment>,` prefix removed (`OpenRouter/deepseek/deepseek-v4-pro` and `deepseek/deepseek-v4-pro` both become `deepseek-v4-pro`), so a provider name never makes two copies of one model look distinct.
- A-02's refusal before genesis → `kukulu_next` throws a `ToolError` whose text starts `clean-room genesis refused: routing: ` followed by the gate's own reason, with nothing written; the controller prints it and stops. After genesis the same reason is gate check 8's failing entry.
- B-02's `left` side → `"subject"` resolves to the project root, and `git -C <left> rev-parse HEAD` is read there; any other value is a directory as `kukulu_similarity` already resolves it.
- C-01's image reference → the policy's digest is the engine's image id (`<engine> image inspect --format {{.Id}} <name>`, which is `sha256:<64 hex>` for a locally built image as well as a pulled one), the `<name>` before `@` is a label, and `run` passes the id itself to `<engine> run`. A registry manifest digest would not exist for an image built locally, which is the documented way to make one.
- C-01's entrypoint → the image's `ENTRYPOINT` is `["node"]`; `containerArgs` puts `<plugin root>/scripts/sandbox-entry.mjs` first after the image, then the harness arguments, so the plugin root is passed at run time and nothing of the plugin is in the image.
- C-01's harness → `scripts/sandbox-entry.mjs` runs `claude --plugin-dir <plugin root> <arguments after -->`; when the first argument after `--` is `--exec`, the rest is run as a command instead (the integration step and docs/sandbox.md's smoke test use it). Node cannot `exec`, so the entry spawns the harness with inherited stdio and exits with its status.
- C-01's TTY → `-i` always, `-t` only when the launcher's stdin is a TTY; the plan object carries `tty`, so `containerArgs` stays a pure function.
- C-01's missing mount sources → `run` creates `.kukulu/` and `.claude/` when absent (both are the pipeline's own) and refuses, naming the path, for any other missing source; an engine would otherwise create a directory where a file belongs.
- C-02's log socket client → inlined in each hook script (about twenty lines each), not a shared sibling module, because gate check 3 pins the two scripts by hash and a helper outside the pin would be unpinned code on the guard's path.
- C-02's guard under the socket → the guard connects to the log socket before it decides any call and denies when it cannot, so "this call cannot be logged" is caught before the call runs, not after; the logger connects only when it has an entry to send.
- C-02's controller child environment → `KUKULU_PROJECT_DIR`, `KUKULU_SANDBOX=<container name>`, `KUKULU_SANDBOX_ENGINE=<engine>` and `KUKULU_SANDBOX_HOOKS_PATH=<runtime dir>/hooks-empty`, with `KUKULU_CONTROLLER_SOCKET` removed, so the server outside never relays to itself and C-04 knows the engine and the empty hooks directory.
- C-03's egress entries → `stage: "controller"`, `role: "session"`, `tool: null`, like the other controller-written entries; the runner endpoints come from `kukulu_config_show` run as a child process (`scripts/sandbox.mjs` may not import `mcp/server.mjs`).
- C-03's gate part → every `allowed` egress entry since genesis must name a `host:port` in the union of the runner endpoints, `sandbox.egress` and the `allow.urls` hosts, evaluated against the current policy and routing, lockdown ignored: the proxy applied lockdown when it decided, and the gate cannot date an entry against a task's completion.
- C-04's self-tests → the gate's and `kukulu_attest`'s guard self-test keep running on the host (`runShell(…, { inside: false })`); every verify, extraVerify, build and mutate command runs inside.
- C-04's streams → `kukulu_run_start({ stream })` refuses under `KUKULU_SANDBOX`, because `.kukulu/` is read-only inside and a worktree cannot be made there; a sandboxed flight is serial.
- C-05's agent commits → the implementer's own `git commit` inside the container would fail under a repo-local `commit.gpgsign true` with no signer, so the sandbox `signingNote` tells it to commit with `git -c commit.gpgsign=false commit -F <file>`; `signaturesExpected` treats the sandbox record like `"none"`.
- C-06's `coverageGaps` → gains a `level` option in both copies: under `container+proxy` an unsigned commit that carries a `Kukulu-Stage` trailer is counted, not listed, and the verifier prints the one note; an untrailed one is still an `untrailed-commit` gap, and under `hook` nothing changes.
- D-01's commit → `kukulu_next` commits `.kukulu/state.json` (and the log, in clean-room mode) as `chore: stage <stage>` whenever the timeline changes, on whatever branch it is on, as genesis already does; a repeated `kukulu_next` for the stage and round already open appends nothing, so a span is one start and one end. An open span counts up to now in `kukulu_status`'s per-stage seconds.
- D-02's hook registration → a second `SubagentStop` entry in `hooks/hooks.json`, after the implement guard's, with no matcher, so every subagent's stop is logged; the manifest's per-role sums take the entries whose `role` is `kukulu-<role>` or `kukulu:<role>`. Gate check 3 requires that registration too.
- D-02's verifier recount → a twelfth check, `roles`, after `enforcement`: `reported` and `usage` recounted from the `usage` entries, and the A-03 note printed from it (see Spec issues).
- E-01's repository URL → parsed from `origin` (`git@github.com:O/R.git` and `https://github.com/O/R(.git)` both give `https://github.com/O/R`); an origin that parses as neither is used as written.
- E-01's tag signing → `git tag -s` when `git config --get tag.gpgsign` is `true` or the archived flight's `state.json` records `signing: "on"`, else `git tag -a`; bounded by `SIGNING_TIMEOUT_MS` with `GIT_TERMINAL_PROMPT=0`.
- Changelog → tasks add lines under `## [Unreleased]` (P0-01 creates it above `## [0.7.2] — 2026-10-26`) under `### Added`, `### Changed` or `### Fixed`, each citing its goal (`G-06`), feedback item or note; there is no Breaking changes heading. P4-05 renames the heading to `## [0.8.0] — <date>`.
- HANDOFF.md → its first line, in bold, is the sentence SPEC §6 F gives; CLAUDE.md's flight notes carry it for the implementer.

## Conventions

- Commit template: `CLAUDE.md` `## Commit template`, title `<ID>: <title>`, written to a file and committed with `git commit -F <file>`. `Measurement: n/a` except on P0-04, P2-03 and P2-04, which tune or measure an ⚠️ ASSUMPTION.
- Every task's verification is `kukulu_verify` with its Files touched: `npm run lint`, `pre-commit run --all-files` and `npm test` (900 s) always; the guard self-tests for clean-room paths.
- Shared protocols are in `CLAUDE.md` `## Task protocols`: the tool protocol (P4-01), the suite protocol (P0-05, P2-02), the guard-rule protocol (P1-01, P2-12, P2-13), the fake-docker and socket protocols (Phase 2), the assumption protocols (P0-04, P2-03, P2-04).
- Tests are named by their assertion message; the names below are the messages to use. Write the macron letter in test source as a Unicode escape.

## Phase 0 — Routing and identity

### P0-01: Runners in the global file, and each role's runner in the routing

**Goal:** The global config's new `runners` key is validated, every role resolves to a runner, an endpoint and a locality, and `kukulu_config_show` and `kukulu_agents_sync` report them.

**Files touched:** `mcp/server.mjs`, `test/routing.mjs`, `docs/routing.md`, `docs/mcp-tools.md`, `templates/kukulu.config.example.json`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.3, §6 A-01, §3 principles 2, 3, 5, 10 and 11; `server-synchronous`.
- `GLOBAL_KEYS` gains `"runners"`. `validateRunners(runners, where)` with `where` = `global config <path> runners`, refusing in this order and naming the key path: not an object → `<where> must be an object`; a name not matching `/^[a-z0-9][a-z0-9-]{0,39}$/` → `<where>.<name> is not a runner name (lowercase letters, digits and -, at most 40 characters)`; `anthropic` → `<where>.anthropic is reserved for the built-in Anthropic runner`; an unknown key under a runner (legal: `endpoint`, `locality`, `match`, `identities`) → `<where>.<name> has an unknown key '<k>'`; `endpoint` not a string that `new URL` parses with protocol `http:` or `https:`, empty username and password, pathname `""` or `/`, empty search and hash → `<where>.<name>.endpoint must be http(s)://host[:port] with no path, query or credentials (got <JSON>)`; `locality` not `local`/`remote` → `<where>.<name>.locality must be "local" or "remote"`; `match` not a non-empty array of non-empty strings → `<where>.<name>.match must be a non-empty array of model-string prefixes`; the same prefix in two runners → `<where>.<a>.match and <where>.<b>.match both name the prefix "<p>"; a prefix may belong to one runner`; `identities` not an object of `{ weights, image? }` whose values match `/^sha256:[0-9a-f]{64}$/` → `<where>.<name>.identities["<model>"].<weights|image> must be sha256:<64 hex>` (an unknown key there is refused too).
- `runnerFor(model, runners)`: `isAnthropicModel(model)` → `{ runner: "anthropic", endpoint: "https://api.anthropic.com", locality: "remote" }`; else the configured runner whose `match` entry is the longest prefix of `model` (`model.startsWith(prefix)`); none → `{ runner: null, endpoint: null, locality: "unknown" }`. `resolveRouting()` returns `runners` (the validated map, `{}` when absent) and gives every `roles[role]` the three fields plus `source.runner`: `"builtin"`, `"global"` or `"none"`.
- `configShow()`'s `roles[role]` gains `runner`, `endpoint`, `locality` and `source.runner`; its result gains `runners`. `routingTable` renders `| role | agent | model | runner | effort | source |` with `runner` after `model` (`anthropic`, the name, or `–`); every existing test that asserts the table header or a row is updated.
- `templates/kukulu.config.example.json` gains SPEC §5.3's `runners` block, with digests of 64 zeros; the template must still load (the existing template tests).
- `docs/routing.md`: a `## Runners` section after `## The global file` with §5.3's table, the resolution rule, the built-in runner and locality `unknown` (Appendix B item 2). `docs/mcp-tools.md`: `kukulu_config_show`'s Returns and `kukulu_agents_sync`'s table column.
- `CHANGELOG.md`: create `## [Unreleased]` above `## [0.7.2] — 2026-10-26` with `### Added`: runners in the global config, and each role's runner, endpoint and locality in `kukulu_config_show` and the routing table (G-01, A-01).

**Acceptance tests:** `test/routing.mjs`, with a global file written by `writeGlobalConfig` and passed as `KUKULU_CONFIG`: "opus resolves to the built-in anthropic runner" (runner `anthropic`, endpoint `https://api.anthropic.com`, locality `remote`); "a claude-* id resolves to the built-in runner"; "the longest match prefix wins" (`spark` with `["spark/"]` and `spark-big` with `["spark/big-"]`; `spark/big-nemotron` resolves to `spark-big`); "an unmatched model resolves to runner null with locality unknown"; "config_show reports each role's runner with its source"; "the routing table has a runner column after model"; one refusal each, asserting the message: "a bad runner name refuses", "the reserved name anthropic refuses", "an unknown runner key refuses", "an endpoint with a path refuses", "an endpoint with credentials refuses", "a bad locality refuses", "an empty match list refuses", "a duplicate match prefix refuses", "a bad identity digest refuses".

**Out of scope:** the policy's `runners` keys and the gate (P0-02, P0-03); identity in genesis (P0-03); `scripts/model-identity.mjs` (P0-05); any change to `agents/*.md`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P0-02: The policy's runner and role keys, and the model-family table

**Goal:** `loadPolicy` accepts `runners.allow`, `runners.locality` and `roles.distinct` with their defaults and refusals, and `mcp/cleanroom.mjs` exports `MODEL_FAMILIES`, `normalizeModel` and `familyOf`.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `test/fixtures/families.json`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.2, §5.5, §6 A-02, A-04, Appendix B items 1 and 3, §3 principles 5 and 10; `cleanroom-module-pure`, `server-synchronous` (no `async`/`await`, no new imports).
- `POLICY_KEYS` gains `runners` and `roles`; `RUNNERS_KEYS = ["allow", "locality"]`, `ROLES_KEYS = ["distinct"]`, each with the unknown-key refusal `onlyKeys` gives. Defaults: `runners.allow` `null` (any runner), `runners.locality` `"any"`, `roles.distinct` `"none"`. Refusals: `policy runners.allow must be a non-empty array of runner names (lowercase letters, digits and -)`; `policy runners.locality must be "local" or "any" (got <JSON>)`; `policy roles.distinct must be "none", "model" or "family" (got <JSON>)`.
- `normalizeModel(s)`: lowercase, then remove every leading `<segment>/` or `<segment>,` prefix (`/^[^/,]+[/,]/`, repeated). `MODEL_FAMILIES` is ⚠️ ASSUMPTION data, written only in `mcp/cleanroom.mjs` with a comment saying so: an array of `{ family, pattern }` applied to the normalized string, in this order: `claude` (`/^(?:fable|opus|sonnet|haiku|inherit)$|^claude-/`), `qwen` (`/qwen/`), `nemotron` (`/nemotron/`), `mistral` (`/mistral|devstral|codestral|magistral|mixtral/`), `deepseek` (`/deepseek/`), `glm` (`/^glm|[-_/]glm/`), `llama` (`/llama/`), `gemma` (`/gemma/`), `gpt` (`/^gpt|[-_/]gpt|^o[1-9]\b/`). `familyOf(model)` returns the first match's `family`, else `unknown:<normalized string>`.
- `test/fixtures/families.json` is `[{ "model", "family" }]` with at least these: `opus`→`claude`, `claude-opus-5-5`→`claude`, `fable`→`claude`, `inherit`→`claude`, `spark/nemotron-3.5-super-nvfp4`→`nemotron`, `mac/qwen3.8-27b`→`qwen`, `Ollama/qwen3.6:35b-a3b`→`qwen`, `OpenRouter/deepseek/deepseek-v4-pro`→`deepseek`, `glm-5.2`→`glm`, `devstral-small-2`→`mistral`, `mistral-large`→`mistral`, `llama-3.3-70b`→`llama`, `gemma-3-27b`→`gemma`, `gpt-5`→`gpt`, `some-unknown-model`→`unknown:some-unknown-model`, `Vendor/Some-Unknown`→`unknown:some-unknown`.
- `docs/cleanroom.md`'s policy table gains rows for `runners.allow`, `runners.locality` and `roles.distinct`.
- `CHANGELOG.md` `### Added`: the policy keys `runners.allow`, `runners.locality` and `roles.distinct` (G-01, G-03).

**Acceptance tests:** `test/cleanroom.mjs`: "defaults fill runners and roles" (`allow` null, `locality` any, `distinct` none); "runners.allow accepts a list of names"; "an empty runners.allow refuses"; "a bad runners.locality refuses"; "a bad roles.distinct refuses"; "an unknown runners key refuses"; "familyOf classifies every recorded routing string" (a loop over the fixture, one `eq` per entry); "normalizeModel strips every provider prefix"; "two unknown strings are their own families".

**Out of scope:** the gate and genesis (P0-03); tuning the table (P0-04).

**Verification:** `kukulu_verify` (runs the guard self-test).

**Depends on:** none

### P0-03: Gate check 8 and genesis record the roles

**Goal:** Genesis refuses a flight whose routing breaks the policy, records each role's model, runner, identity and family, and gate check 8 (`routing`) holds every later stage to it.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-02, A-03 (the genesis part), A-04, Appendix B items 2 and 3, §3 principles 2, 3, 4 and 10; `server-synchronous`.
- `rolesRecord(routing, policy)`: for each of the four roles `{ model, runner, endpoint, locality, identity, family }` from P0-01's `resolveRouting()`; `identity` is `{ source: "operator-measured", weights, image? }` when `routing.runners[runner]?.identities?.[model]` exists (digests copied as written), `{ source: "vendor-asserted" }` for runner `anthropic`, else `{ source: "none" }`; `family` is `familyOf(model)` (P0-02).
- `routingCheck(policy, roles, genesisRoles)` returns `null` or a reason, the first failing part stopping it: (1) with `genesisRoles`, every role's `model` and `runner` (null printed as `none`) equal the recorded ones, else `routing changed since genesis: <role> now resolves to <model> on <runner> (genesis: <model> on <runner>); restore the routing, or archive this flight and start another`; (2) with `policy.runners.allow`, every role's runner is in it (null never is): `<role> resolves to runner <runner>, which policy runners.allow does not name (<names joined by ", ">)`; (3) with `runners.locality` `"local"`, every locality is `local`: `<role> resolves to <model> on runner <runner> (locality <locality>); a local-only flight needs every role on a local runner. Route it to one in ~/.config/kukulu/config.json, or set runners.locality to "any"`; (4) `roles.distinct` `"model"`: `normalizeModel` of the implementer and the reviewer differ, else `the implementer and the reviewer both resolve to <normalized model>; policy roles.distinct "model" needs two different models. Route one of them elsewhere`; `"family"`: `familyOf` differ, else `the implementer (<model>) and the reviewer (<model>) are both family <family>; policy roles.distinct "family" needs two families`.
- `cleanroomGenesis`: after the policy loads and before the key is generated or anything is written, run parts 2 to 4 with `genesisRoles` null; a reason throws `ToolError("clean-room genesis refused: routing: " + reason)`. Genesis `data` gains `roles` (the record) and `distinct` (the policy's value), after `head`.
- `runGate`: after check 7, `checked.push("routing")`; `genesisRoles` is the chain's first entry's `data.roles` (absent for a flight that began on 0.7.x: part 1 is skipped); a reason is `failed("routing", reason)`. The passing entry's `checks` count becomes 8.
- `docs/cleanroom.md`: the genesis sentence names `roles` and `distinct`; the gate list gains item 8 with its four parts; the `gate: ok (7 checks)` text becomes `gate: ok (8 checks)`. `docs/mcp-tools.md` `kukulu_next`: the `gate.checked` list gains `routing`, the genesis `data` list gains `roles` and `distinct`, and the pre-genesis refusal is described.
- `CHANGELOG.md` `### Added`: gate check 8, `routing`, and the roles in genesis (G-01, G-02, G-03).

**Acceptance tests:** `test/cleanroom.mjs`, each with a global file passed through `startServer(repo, { env: { KUKULU_CONFIG } })` whose `runners` are `spark` (`http://spark.test:8000`, local, match `["spark/"]`, identities for `spark/nemotron-3.5-super-nvfp4` with 64-hex digests) and `mac` (`http://mac.test:11434`, local, match `["mac/"]`), and a policy written with `cleanroomRepo({ policy })`: "a local-only policy with every role on local runners passes genesis and the gate" (every role routed to `spark/…` or `mac/…` through the global `roles`; `kukulu_next` returns `plan` with `gate.checked` ending in `routing`, and genesis `data.roles.implementer.runner` is `spark`); "genesis records each identity source" (operator-measured with the digests copied, vendor-asserted for `opus`, none for an unmatched string); "the default routing fails a local-only policy at genesis with nothing written" (`isError` matching `clean-room genesis refused: routing: planner resolves to opus on runner anthropic \(locality remote\)`; no `.kukulu/cleanroom/log.jsonl`, no `state.cleanroom`, HEAD unmoved); "a runner outside runners.allow fails part 2 at genesis"; "changing a role's model after genesis fails the gate's routing check" (after genesis, write `roles.reviewer.model` into `docs/kukulu.json`; the next `kukulu_next` returns `halt` whose reason starts `clean-room gate failed: routing: routing changed since genesis`, and the log's last entry is a `gate` with `data.failed` `routing`); "roles.distinct model refuses two roles on one model at genesis"; "opus and sonnet pass model and fail family"; "a Qwen model and a Nemotron model pass family"; "two different unknown strings pass family".

**Out of scope:** the manifest (P0-06); `scripts/model-identity.mjs` (P0-05); gate checks 9 and 10.

**Verification:** `kukulu_verify`.

**Depends on:** P0-01, P0-02

### P0-04: Tune MODEL_FAMILIES against the recorded routing strings

**Goal:** The ⚠️ ASSUMPTION family table is measured against every routing string the repository documents, and the measurement is written down.

**Files touched:** `docs/spikes/P0-04.md`, `test/fixtures/families.json`, `mcp/cleanroom.mjs`

**Design constraints:**

- SPEC §5.5 (the `MODEL_FAMILIES` row), Appendix A; CLAUDE.md "Tuning an assumption" protocol.
- Method: collect every model string written in `docs/routing.md`, `templates/kukulu.config.example.json`, `templates/ccr/*.json`, `docs/SPEC.md`, `agents/*.md`, `docs/flights/*/SUMMARY.md` and `docs/flights/*/PLAN.md` (search for `model` lines and `provider/model` forms), classify each with `familyOf`, and tabulate: the string, the normalized form, the family, and whether it landed in `unknown:`. Before = the P0-02 table; after = the same table, or the table with a pattern widened only where a documented string plainly belongs to a listed family and landed in `unknown:` (that is what "the measurement requires" means here). Add every collected string to `test/fixtures/families.json`.
- Write the method, the raw table and both values to `docs/spikes/P0-04.md` (markdownlint-clean), and put them on the commit body's `Measurement:` line and in the progress log. Change nothing else in `mcp/cleanroom.mjs`.

**Acceptance tests:** `test/cleanroom.mjs`'s existing "familyOf classifies every recorded routing string" passes over the extended fixture.

**Out of scope:** new families; any string the repository does not document.

**Verification:** `kukulu_verify`.

**Depends on:** P0-02

### P0-05: scripts/model-identity.mjs and the bundles suite

**Goal:** A `node:`-only script hashes a model's weight files into one reproducible digest, and a new `bundles` suite tests it.

**Files touched:** `scripts/model-identity.mjs`, `test/bundles.mjs`, `test/run.mjs`, `test/fixtures/identity/`, `test/plugin.mjs`, `CONTRIBUTING.md`, `README.md`, `docs/routing.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 A-03 (the script), §3 principles 3, 11 and 12; `scripts-node-builtins`, `one-hash-one-signature`; CLAUDE.md "Adding a test suite" protocol. No shebang (pre-commit would demand the executable bit); the CLI runs only as the entry script.
- `node scripts/model-identity.mjs <file-or-dir>... [--image sha256:<64 hex>] [--json]`. For each argument in order: `fs.realpathSync` it; a file is one entry with `rel` its basename; a directory is walked recursively with `fs.statSync` (symlinks followed), files only, `rel` the posix path relative to the argument. Entries are sorted by `rel` (code-point order); each line is `<sha256 hex>  <rel>` (two spaces); `weights` is `sha256:` + the SHA-256 of the lines joined with `\n` and ending in `\n`. Text output: the lines, then `weights: sha256:<hex>`, then `image: <as given>` when `--image` is set. `--json`: `{ files: [{ path, sha256 }], weights, image }` (`image` null when absent). A missing path writes `model-identity: <path>: no such file or directory` to stderr and exits 2; no arguments, or an `--image` that does not match `/^sha256:[0-9a-f]{64}$/`, prints usage and exits 2. The script never writes a file.
- `test/fixtures/identity/`: `weights/a.bin`, `weights/sub/b.bin`, `config.json` (small text contents) and `expected.txt` holding the exact text output for `node scripts/model-identity.mjs test/fixtures/identity/weights test/fixtures/identity/config.json`, recorded once by hand and checked in.
- `test/run.mjs` registers `["bundles", "scripts/model-identity.mjs, publish-bundle.mjs and compare-bundles.mjs"]` after `attest`, before `drive`; follow the suite protocol for the count (fourteen).
- `docs/routing.md` `## Runners` gains a paragraph on measuring a digest with the script on the inference host and pasting it into `identities`.
- `CHANGELOG.md` `### Added`: `scripts/model-identity.mjs` (G-02, A-03).

**Acceptance tests:** `test/bundles.mjs`: "model-identity prints one line per file and the digest from expected.txt" (stdout byte-equal to the fixture); "the argument order does not change the digest" (the two arguments swapped give the same `weights:` line); "--json prints files, weights and image"; "a missing path exits 2 naming it"; "a bad --image exits 2"; "the script writes nothing" (the fixture directory's listing is unchanged). `test/plugin.mjs`'s README suite-count assertion reads "fourteen suites".

**Out of scope:** the manifest (P0-06); `publish-bundle.mjs` (P1-04); `compare-bundles.mjs` (P3-04).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P0-06: The manifest records each role's identity

**Goal:** `kukulu_attest` writes `roles` from genesis with `assurance: "configuration"`.

**Files touched:** `mcp/server.mjs`, `test/attest.mjs`, `docs/cleanroom.md`, `docs/mcp-tools.md`

**Design constraints:**

- SPEC §6 A-02 (the assurance sentence), A-03 (the manifest part), §3 principle 10; `server-synchronous`.
- In `attest()`'s manifest, after `genesis`: `roles`, an object with one entry per role from `genesis.data.roles` (`{ model, runner, endpoint, locality, identity, family, assurance: "configuration" }`), or `null` when the genesis has no `roles` (a flight that began on 0.7.x). `reported` and `usage` are not written yet (P3-03), and `assurance` is always `"configuration"` until P2-09.
- The verifier does not check `roles` yet. `docs/cleanroom.md`'s manifest field list and `docs/mcp-tools.md` `kukulu_attest` name the field.

**Acceptance tests:** `test/attest.mjs`, in the `kukulu_attest` section's full-flight repo: "the manifest's roles repeat genesis's roles with assurance configuration" (every role present, `assurance` `configuration`, `identity.source` `vendor-asserted` for the default routing); "a genesis without roles gives roles null" (a bundle from `buildBundle` has no `roles`; assert through the manifest the server would write, or skip if the harness cannot reach `attest()`: then assert on the full-flight repo only and say so in the commit body).

**Out of scope:** `reported`, `usage` and the verifier note (P3-03); `assurance: "egress"` (P2-09).

**Verification:** `kukulu_verify`.

**Depends on:** P0-03

### P0-07: Phase 0 end: push and record the manual check

**Goal:** Push the branch with the routing and identity work and record Phase 0's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 0. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task: `git commit --allow-empty -F <file>` with the subject `P0-07: Phase 0 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): with the owner's real global file holding the Spark and Mac runners, kukulu_config_show reports each role's runner; a throwaway clean-room flight with runners.locality "local" and the default routing refuses at its first kukulu_next; with profile B routing it writes a genesis whose roles name both runners and the Spark model's measured weights digest from scripts/model-identity.mjs run on the Spark`.

**Depends on:** none

## Phase 1 — Controls and publishing

### P1-01: Control mode in the policy and the guard

**Goal:** `loadPolicy` accepts `mode` and `control.priorArt`, and the guard never denies a read of a `control.priorArt` path in a control flight.

**Files touched:** `mcp/cleanroom.mjs`, `test/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.2, §6 B-01 (the policy and guard bullets), §3 principles 1, 3, 5, 6 and 10; CLAUDE.md guard-rule protocol (fixture names end `(P1-01)`); `cleanroom-module-pure`, `server-synchronous`.
- `POLICY_KEYS` gains `mode` and `control`; `CONTROL_KEYS = ["priorArt"]`. `mode` is `"clean-room"` (default) or `"control-positive"`, else `policy mode must be "clean-room" or "control-positive" (got <JSON>)`. `control.priorArt` is a non-empty array of non-empty strings, required exactly when `mode` is `control-positive` (`policy control.priorArt is required when mode is "control-positive": list the prior art the control flight is given`) and refused otherwise (`policy control.priorArt is only legal when mode is "control-positive" (mode is "clean-room")`). The loaded policy carries `mode` and `control: { priorArt }` (`[]` in clean-room mode).
- `controlPaths(policy, env)`: each `priorArt` entry resolved the way `deny.paths` entries are (`~`, absolute, repo-relative against `env.root`). In `evaluate`, a target of a read-family tool or a path-like Bash read operand that equals or lies under a control path is exempt from `deny.paths`, `deny.pathPatterns` and `deny.words`; the protected set, every write rule, `deny.tools`, the network rules and `commandPatterns` are unchanged. In clean-room mode the list is empty, so nothing changes.
- Fixtures, cwd `__ROOT__`: with policy `{ "version": 1, "mode": "control-positive", "control": { "priorArt": ["prior/"] }, "deny": { "network": false, "paths": ["prior/"], "words": ["zlib"] } }`: allowed `Read prior/zlib.c (P1-01)` (`file_path` `__ROOT__/prior/zlib.c`), allowed `cat prior/zlib.c (P1-01)`; with the same policy minus `mode` and `control`: denied `Read prior/zlib.c in clean-room mode (P1-01)` (reason `deny\.paths`), denied `cat prior/zlib.c in clean-room mode (P1-01)`; with the control policy: denied `Write docs/cleanroom.json in control mode (P1-01)` (reason `protected`).
- `docs/cleanroom.md`: policy rows for `mode` and `control.priorArt`; a `## Control mode` section with B-01's bullets (what stays the same, what differs; the verifier part is written by P1-02).
- `CHANGELOG.md` `### Added`: positive-control mode in the policy and the guard (G-04, B-01).

**Acceptance tests:** `test/cleanroom.mjs`: "control.priorArt is required under control-positive"; "control.priorArt is refused under clean-room"; "a bad mode refuses"; "a control.priorArt read is allowed in control mode" and "...and denied in clean-room mode" (direct `evaluate` calls mirroring the fixtures); every existing fixture keeps its decision and reason.

**Out of scope:** genesis, the gate, the manifest and the verifier (P1-02); `control` on a similarity pair (P1-03); mounting prior art (P2-05).

**Verification:** `kukulu_verify` (runs the guard self-test); also `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` before committing.

**Depends on:** none

### P1-02: Control mode in genesis, the manifest and the verifier

**Goal:** A control flight's genesis and manifest say `control-positive`, and the verifier reports such a bundle as `CONTROL (positive)` with exit 3, never as a pass, unless `--expect control-positive` is given.

**Files touched:** `mcp/server.mjs`, `scripts/verify-attestation.mjs`, `test/harness.mjs`, `test/attest.mjs`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-01, §9 Q4, §3 principles 2, 3, 4 and 10; `server-synchronous`, `verifier-node-only` (the verifier keeps its duplicated code and gains no import).
- Genesis `data.mode` is the loaded policy's `mode`; under `control-positive` it also records `control: { priorArt }` as written. `attest()` writes `mode: genesis.data.mode`. Gate check 1 (`mode`) passes a control flight: add the test; no code change is expected beyond the genesis value.
- `kukulu_attest` runs the bundle's verifier with `--expect <genesis mode>`, so a control bundle's own check exits 0.
- `verifyBundle(dir, { key, expect })` returns `{ ok, mode, reasons, notes, checks }`; `mode` is the genesis's `data.mode` (null when unreadable). Check 7 (`mode`): the genesis mode is `clean-room` or `control-positive` (`mode: the genesis records mode <JSON>, which is neither "clean-room" nor "control-positive"`), the manifest's `mode` equals it (`mode: the manifest says <m>, but the genesis records <g>`), no gate failed the mode check (as today), and, with `expect`, the mode equals it (`mode: the bundle is <mode>, expected <expect>`). The CLI: `--expect clean-room|control-positive` (any other value is a usage error, exit 2); a passing control bundle prints its notes and `verify-attestation: CONTROL (positive)` as the last line and exits 3, or 0 when `--expect control-positive` was given; a passing clean-room bundle prints `PASS` and exits 0; a failure prints `FAIL (<n> reasons)` and exits 1; `--json` gains `mode` and uses the same exit codes.
- `test/harness.mjs` `buildBundle` gains `opts.mode` (default `clean-room`): the genesis entry's `data.mode` and the manifest's `mode`.
- `docs/cleanroom.md`: the `## Control mode` section gains the verdict, exit 3 and `--expect`; "Verifying offline" lists exit 3; the manifest `mode` bullet names both values. `docs/mcp-tools.md` `kukulu_attest`: the `--expect` run.
- `CHANGELOG.md` `### Added`: the verifier's `CONTROL (positive)` verdict, exit 3 and `--expect` (G-04, B-01).

**Acceptance tests:** `test/attest.mjs`: "a control bundle exits 3 with CONTROL (positive)" (last line exact); "...and 0 with --expect control-positive"; "a clean-room bundle with --expect control-positive fails mode" (reason `mode: the bundle is clean-room, expected control-positive`); "a control bundle whose manifest is edited to say clean-room fails signature and mode" (edit `manifest.json` without re-signing); "--json carries mode"; "a bad --expect is a usage error". `test/cleanroom.mjs`: "a control-positive policy writes a genesis with mode and priorArt and passes gate check 1" (genesis `data.mode` and `data.control.priorArt`; the next `kukulu_next` passes the gate).

**Out of scope:** the similarity pair (P1-03); publishing (P1-04).

**Verification:** `kukulu_verify`.

**Depends on:** P1-01

### P1-03: The control bundle is the positive pair

**Goal:** A positive pair may name a verified control bundle, and `kukulu_similarity` checks it before reading any file and records it in `similarity.json`.

**Files touched:** `mcp/server.mjs`, `test/cleanroom.mjs`, `test/harness.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 B-02, Appendix B item 4, §3 principles 2, 4, 5 and 10; `server-synchronous`.
- `validateSimilarity`: a pair's legal keys gain `control`; `<at>.control is only legal on the pair with role "positive"`; `<at>.control must be a non-empty string: the directory of a verified control bundle`. `normalizeSimilarity` keeps `control` on the positive pair (`null` when absent).
- `similarity()`, after its existing refusals and before `readSide` reads anything: with `positive.control`, resolve it like a pair side (`~`, absolute, repo-relative); run `node <dir>/verify.mjs <dir> --expect control-positive --json` with `spawnSync` bounded by `GATE_SELF_TEST_MS`; refuse unless it exits 0 with `ok` true: `the positive pair's control bundle <dir> does not verify as a positive control: <first reason as "check: reason", else the first stderr line>`. Then read `git -C <left> rev-parse HEAD` (`"subject"` is the project root) and refuse unless it equals the control manifest's `repo.head`: `the positive pair's left side <dir> is at <sha>, but the control bundle was made at <sha>; check out the control flight's result there`. Record `control: { manifest: <sha256 of manifest.json's bytes>, head, fingerprint: manifest.signer.fingerprint }` on that pair in `similarity.json`'s `config.pairs`.
- `test/harness.mjs` `buildBundle` gains `opts.head` (the manifest's `repo.head`, default the existing placeholder).
- `docs/operations.md`'s `cleanroom.similarity` row and `docs/mcp-tools.md` `kukulu_similarity` describe `control` and the two refusals.
- `CHANGELOG.md` `### Added`: a verified control bundle as the positive pair by reference (G-04, B-02).

**Acceptance tests:** `test/cleanroom.mjs`, in the `kukulu_similarity` block, with a `left` directory that is a git repository holding the fixture files and a bundle built with `buildBundle(dir, { mode: "control-positive", head: <left's HEAD> })`: "a positive pair referencing a verified control bundle records it" (`similarity.json`'s positive pair has `control.manifest`, `control.head` and `control.fingerprint`); "a clean-room bundle as control refuses" (message starts `the positive pair's control bundle`); "a head mismatch refuses"; "control on a test pair refuses at config load"; "an empty control refuses".

**Out of scope:** scoring changes; the summarize skill.

**Verification:** `kukulu_verify`.

**Depends on:** P1-02

### P1-04: scripts/publish-bundle.mjs and docs/publishing.md

**Goal:** A `node:`-only script writes a publishable copy of a verified bundle with `SHA256SUMS` and `VERIFY.txt`, and re-checks a published copy.

**Files touched:** `scripts/publish-bundle.mjs`, `docs/publishing.md`, `test/bundles.mjs`, `CONTRIBUTING.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 B-03, §3 principles 3, 11 and 12; `scripts-node-builtins`, `one-hash-one-signature`; no shebang; the CLI runs only as the entry script; never the network.
- `node scripts/publish-bundle.mjs <bundle-dir> --key sha256:<fp> --out <dir>`: run `node <bundle>/verify.mjs <bundle> --key <fp> --json` (`spawnSync`); accept exit 0, or exit 3 (a control bundle); otherwise print `publish-bundle: <bundle> does not verify: <first reason>` and exit 1. Read `manifest.json` for `flight`, `mode` and `enforcement.level` (`hook` when absent). Refuse before writing when `<out>/<flight>` exists: `publish-bundle: <out>/<flight> already exists; remove it or choose another --out`, exit 1. Then copy every file byte for byte (subdirectories such as `evidence/` included), write `SHA256SUMS` (`<hex>  <path>` per copied file, posix paths, sorted by path in code-point order, not listing itself or `VERIFY.txt`) and `VERIFY.txt` with exactly these lines: `Kūkulu attestation bundle` (the macron letter written in the script as the Unicode escape of U+016B), `flight: <flight>`, `mode: <mode>`, `enforcement: <level>`, `signer: sha256:<fp>`, `verify: node verify.mjs . --key sha256:<fp>`, `expected exit status: 0` (or `expected exit status: 3, with the last line CONTROL (positive)` for a control bundle), and `Get the signer's fingerprint from a source other than this directory (the project's README, a signed tag, a DNS TXT record) and compare it with the signer line above before trusting this bundle.` Print `publish-bundle: wrote <out>/<flight> (<n> files)` and exit 0.
- `node scripts/publish-bundle.mjs --check <published-dir> --key sha256:<fp>`: every `SHA256SUMS` line's file exists and hashes to its digest (`publish-bundle: <path>: the SHA-256 differs from SHA256SUMS` for the first mismatch, exit 1), every file but `SHA256SUMS` and `VERIFY.txt` is listed, then the verifier runs as above with the expected exit; print `publish-bundle: ok <dir>` and exit 0. Missing `--key`, missing `--out`, both forms at once, or a malformed fingerprint: usage on stderr, exit 2.
- `docs/publishing.md`: the procedure of B-03 (build, publish on any static host, publish the fingerprint by another route, re-check from a second machine), and the sentence that a kukulu.tech page for a sample bundle is a site change through `docs/site/copy-changes.json`, made after the flight. README's documentation map links it; CONTRIBUTING's layout table gets the script's row.
- `CHANGELOG.md` `### Added`: `scripts/publish-bundle.mjs` and `docs/publishing.md` (G-05, B-03).

**Acceptance tests:** `test/bundles.mjs`, on bundles from `buildBundle`: "publish then --check passes"; "a changed byte in the published copy fails --check naming the file"; "the wrong --key refuses"; "an existing output directory refuses with nothing written" (the directory's listing is unchanged); "a control bundle publishes with expected exit status 3"; "SHA256SUMS lists every copied file in sorted sha256sum -c format"; "VERIFY.txt names the flight, the mode, the level, the signer and the command".

**Out of scope:** uploading anywhere; the site.

**Verification:** `kukulu_verify`.

**Depends on:** P1-02

### P1-05: Phase 1 end: push and record the manual check

**Goal:** Push the branch with the control and publishing work and record Phase 1's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task, subject `P1-05: Phase 1 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): a small control flight's bundle verifies as CONTROL (positive) with exit 3; publish-bundle.mjs output copied to a static host verifies with --check from a second machine`.

**Depends on:** none

## Phase 2 — The sandbox and enforcement

### P2-01: The policy's enforcement, sandbox and package keys, and the local-only template

**Goal:** `loadPolicy` accepts `enforcement`, `sandbox.*` and `deny.packages` with every refusal, `KINDS` gains the three new kinds, `LOG_SOCKET_TIMEOUT_MS` is exported, and the worked local-only template passes the guard self-test.

**Files touched:** `mcp/cleanroom.mjs`, `templates/cleanroom.local-only.example.json`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.2, §5.5, §6 C-01, C-03, C-07 (the policy parts), §3 principles 5 and 10; `cleanroom-module-pure`, `server-synchronous`, `no-hardcoded-log-socket-timeout` (`2000` appears only as `export const LOG_SOCKET_TIMEOUT_MS = 2000;`). Do not edit `docs/kukulu.json`: its `extraVerify` entries for the new template are already there and activate with this task.
- `POLICY_KEYS` gains `enforcement` and `sandbox`; `DENY_KEYS` gains `packages`; `SANDBOX_KEYS = ["image", "mounts", "egress"]`; `PACKAGE_ECOSYSTEMS = ["cargo", "npm", "pypi"]`. `enforcement`: `"hook"` (default) or `"container+proxy"`; `"container+proxy+audit"` → `policy enforcement "container+proxy+audit" is 0.9.0's level; this release cannot run it`; anything else → `policy enforcement must be "hook" or "container+proxy" (got <JSON>)`. `sandbox.image`: required exactly when `enforcement` is `container+proxy` (`policy sandbox.image is required when enforcement is "container+proxy": the image as <name>@sha256:<digest>`) and refused otherwise (`policy sandbox.image is only legal when enforcement is "container+proxy"`); shape `/^[A-Za-z0-9][A-Za-z0-9._\/-]*@sha256:[0-9a-f]{64}$/`, else `policy sandbox.image must be <name>@sha256:<64 hex>; a tag alone (got <JSON>) does not pin the image`. `sandbox.mounts`: array of `{ path, mode }` with `path` a non-empty string and `mode` exactly `"ro"` (`policy sandbox.mounts[<i>].mode must be "ro"; the project is the only read-write mount`); `sandbox.egress`: array of strings matching `/^[A-Za-z0-9.-]+:\d{1,5}$/` (`policy sandbox.egress[<i>] must be host:port`). `deny.packages`: an object whose keys are in `PACKAGE_ECOSYSTEMS`, each a non-empty array of non-empty strings. Defaults: `enforcement` `hook`, `sandbox` `{ image: null, mounts: [], egress: [] }`, `deny.packages` `{}`.
- `KINDS` gains `egress`, `stage` and `usage` (after `resume`); `appendEntry` accepts them. `export const LOG_SOCKET_TIMEOUT_MS = 2000;` with the ⚠️ ASSUMPTION comment: how long a hook waits for the log socket before it fails closed.
- `templates/cleanroom.local-only.example.json` is SPEC §5.2's example verbatim (the all-zero digest included). `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json` passes.
- `docs/cleanroom.md`: policy rows for `enforcement`, `sandbox.image`, `sandbox.mounts`, `sandbox.egress` and `deny.packages`; the log `kind` list gains the three kinds (named now, described by P2-04, P3-01 and P3-02); a sentence that the all-zero digest in the template is a placeholder `doctor` replaces.
- `CHANGELOG.md` `### Added`: the policy keys `enforcement`, `sandbox.*` and `deny.packages` and the local-only template (G-06, G-08).

**Acceptance tests:** `test/cleanroom.mjs`: "defaults fill enforcement, sandbox and deny.packages"; "container+proxy+audit is refused as 0.9.0's level"; "a bad enforcement refuses"; "sandbox.image is required under container+proxy"; "sandbox.image is refused under hook"; "a tag-only image refuses"; "a read-write mount refuses"; "a bad egress entry refuses"; "an unknown package ecosystem refuses"; "appendEntry accepts egress, stage and usage"; "the local-only template loads"; "the local-only template passes the guard self-test" (`spawnSync` of the self-test exits 0).

**Out of scope:** any use of the keys (P2-02 onward).

**Verification:** `kukulu_verify` (runs both guard self-tests).

**Depends on:** none

### P2-02: mcp/relay.mjs, the controller socket and the sandbox suite

**Goal:** A server started with `KUKULU_CONTROLLER_SOCKET` hands its stdio to `mcp/relay.mjs`, `scripts/sandbox.mjs` serves a controller socket that runs the real server per connection, and the new `sandbox` suite proves it.

**Files touched:** `mcp/relay.mjs`, `mcp/server.mjs`, `scripts/sandbox.mjs`, `.mcp.json`, `test/sandbox.mjs`, `test/run.mjs`, `test/plugin.mjs`, `CONTRIBUTING.md`, `README.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 C-02 (the MCP server bullet), §3 principles 2, 3, 7, 8, 11 and 13; `server-synchronous`, `relay-not-in-server`, `sandbox-network-none` and `sandbox-no-escape-flags` (all three activate with this task: `scripts/sandbox.mjs` must not contain `--privileged`, `--cap-add`, `--pid=host`, `docker.sock` or `podman.sock` even in a comment, and no `--network` value but `none`), `scripts-node-builtins`; CLAUDE.md "Adding a test suite" and "Sandbox sockets in tests" protocols. No shebang on the new scripts; each CLI runs only as the entry script.
- `mcp/relay.mjs` (`node:net`, `node:process` only; may use `async`): connect to `process.env.KUKULU_CONTROLLER_SOCKET`; pipe stdin to the socket and the socket to stdout until either side closes; exit 0 when the socket ends. On a connection error, read the first line of stdin, parse its `id` (null when it is not JSON), write one JSON-RPC error (`code` -32000, `message` `kukulu: cannot reach the controller at <path>; the sandbox's controller is not running. Restart the session with node scripts/sandbox.mjs run`) and exit 1.
- `mcp/server.mjs`: at start-up, before any file is read and before the transport starts, `if (envVar("CONTROLLER_SOCKET")) { const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, "mcp", "relay.mjs")], { stdio: "inherit" }); process.exit(r.status ?? 1); }`. `kukulu_status` gains `sandbox`: `envVar("SANDBOX") ?? null` (documented in `docs/mcp-tools.md`). `.mcp.json`'s `env` gains `"KUKULU_CONTROLLER_SOCKET": "${KUKULU_CONTROLLER_SOCKET:-}"`; if `test/plugin.mjs` asserts `.mcp.json`'s env keys, extend it.
- `scripts/sandbox.mjs` (imports: `node:` modules and `../mcp/cleanroom.mjs` only): `export function startControllerSocket({ socketPath, root, pluginRoot, containerName, engine, hooksPath, env = process.env })` → `{ close() }`: a `net.createServer` on `socketPath`; per connection spawn `process.execPath <pluginRoot>/mcp/server.mjs` with env `{ ...env, KUKULU_PROJECT_DIR: root, KUKULU_SANDBOX: containerName, KUKULU_SANDBOX_ENGINE: engine, KUKULU_SANDBOX_HOOKS_PATH: hooksPath }` and `KUKULU_CONTROLLER_SOCKET` deleted; pipe the connection to the child's stdin and its stdout back; kill the child when the connection closes. `export function main(argv, { platform = process.platform, env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {})` returns an exit code: on `darwin`, `scripts/sandbox.mjs runs on Linux; on macOS run it inside a Linux VM that holds the project (see docs/sandbox.md)` on stderr, 2; otherwise usage (`doctor`, `run [-- <harness arguments>]`, `stop`) and 2, until P2-05 and P2-06 fill the subcommands in. `if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))`.
- `test/run.mjs` registers `["sandbox", "the sandbox: relay, sockets, proxy, container, gate checks 9 and 10"]` after `attest`, before `bundles`; follow the suite protocol (fifteen). `CONTRIBUTING.md` layout rows for `mcp/relay.mjs` and `scripts/sandbox.mjs`.
- `CHANGELOG.md` `### Added`: the relay and the controller socket (G-06, C-02).

**Acceptance tests:** `test/sandbox.mjs`, with socket paths under a short temp directory: "the relay answers tools/list through the controller socket with the same tools as direct stdio" (start the controller socket in-process on a `plannedRepo`; spawn `node mcp/server.mjs` with `KUKULU_CONTROLLER_SOCKET` set and feed `initialize` then `tools/list`; the names equal the ones `startServer(repo)` lists directly); "the server behind the controller reports sandbox" (`kukulu_status.sandbox` through the relay equals the container name); "an unreachable controller socket gives the relay error" (exit 1, stdout is one JSON-RPC error with the message, `id` the request's); "sandbox.mjs refuses on darwin" (`main(["doctor"], { platform: "darwin" })` is 2 with the message). `test/plugin.mjs`'s README suite-count assertion reads "fifteen suites".

**Out of scope:** the log socket (P2-03), the proxy (P2-04), `doctor`, `run`, `stop` (P2-05, P2-06).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-03: The log socket, and its round-trip budget

**Goal:** Inside the boundary the two hook scripts send every entry to the log socket and fail closed when it is unreachable; outside, `scripts/sandbox.mjs` appends the entries with `source: "box"`; the round trip is measured against the 100 ms ⚠️ ASSUMPTION.

**Files touched:** `scripts/sandbox.mjs`, `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs`, `test/sandbox.mjs`, `docs/spikes/P2-03.md`, `docs/cleanroom.md`, `docs/sandbox.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §5.5 (the round-trip row), §6 C-02 (the log bullet and the spike), §3 principles 3, 7, 11 and 13; `hooks-lazy-cleanroom`, `scripts-node-builtins`, `no-hardcoded-log-socket-timeout`, `no-hardcoded-target-max`; CLAUDE.md "Measuring an assumption" and "Sandbox sockets in tests" protocols.
- `scripts/sandbox.mjs`: `export function startLogSocket({ socketPath, logPath })` → `{ close() }`: per connection, read newline-delimited JSON; each line is an entry's fields as a hook would hand `appendEntry`; set `fields.data = { ...(fields.data ?? {}), source: "box" }`, call `appendEntry(logPath, fields)` (the directory lock applies), reply `{ "seq", "hash" }` plus newline; on an error reply `{ "error": <message> }` plus newline.
- Both hooks, when `process.env.KUKULU_LOG_SOCKET` is set (after the no-policy fast path, which is unchanged): a client inlined in each script (about twenty lines; never a shared module, because gate check 3 pins these two files by hash) that connects, writes one line, waits at most `LOG_SOCKET_TIMEOUT_MS` (imported from `mcp/cleanroom.mjs` by the existing dynamic import) for the reply, and never calls `appendEntry` itself. The guard connects before it decides any call and denies when it cannot connect: `the log socket is unreachable, so this call cannot be logged; restart the session with node scripts/sandbox.mjs run`; on a denial it sends the entry through that connection; on an allowance it closes it. The logger connects when it has an entry to send; if it cannot, or the reply is an error or late, it writes `kukulu clean-room logger: the log socket is unreachable, so this call cannot be logged; restart the session with node scripts/sandbox.mjs run` to stderr and exits 1. Both still fail closed when they throw (the guard denies with `guard internal error: …`; the logger, under the socket, exits 1). Without `KUKULU_LOG_SOCKET` nothing changes.
- Spike `docs/spikes/P2-03.md`: 30 runs of the logger hook with a `PostToolUse` payload against an in-process log socket, wall time with `process.hrtime.bigint()` around `spawnSync`, minus the median of 30 `node -e 0` runs; median, p90 and maximum against the 100 ms budget, with the headroom; markdownlint-clean. Before = 100 ms (SPEC §5.5); after = 100 ms unless the measurement requires more, and then the test budget changes and the commit says so. The `Measurement:` line and the progress log carry the numbers.
- `test/sandbox.mjs` holds the budget as `const LOG_SOCKET_BUDGET_MS = 100;` with a ⚠️ ASSUMPTION comment; it lives nowhere else.
- `docs/cleanroom.md`: the log section says an entry reported from inside the boundary carries `data.source: "box"`; `docs/sandbox.md` is created with a `## The sockets` section (the three sockets, what each carries, what an agent inside can and cannot do with them: C-02's last paragraph); P2-06 fills in the rest.
- `CHANGELOG.md` `### Added`: the log socket (G-06, C-02).

**Acceptance tests:** `test/sandbox.mjs`, with a `cleanroomRepo` whose state has `cleanroom.genesis` set (`setState`) and the log socket started in-process on a temp log path: "a guard denial sent over the log socket lands in the chain with source box" (a denied `Read` under `deny.paths` with `KUKULU_LOG_SOCKET` and `CLAUDE_PROJECT_DIR` set; the log at the socket's path has one `denied` entry with `data.source` `box`, `verifyChain` passes, and the project's own log is untouched); "a logger entry sent over the log socket lands with source box"; "an unreachable log socket makes the guard deny with the restart reason" (exit 2, stderr matches the sentence); "an unreachable log socket makes the logger exit 1 with the reason"; "a hook round trip over the log socket stays within the budget" (asserted the way `test/cleanroom.mjs` asserts the 50 ms budget).

**Out of scope:** the proxy (P2-04); the container (P2-05, P2-06).

**Verification:** `kukulu_verify`.

**Depends on:** P2-02

### P2-04: The egress proxy, the bridge, and its overhead

**Goal:** `scripts/sandbox.mjs` serves a `CONNECT`-only HTTP proxy on `proxy.sock` that allows only the runner endpoints, `sandbox.egress` and the `allow.urls` hosts (the last two until lockdown), logs every decision as an `egress` entry, and `scripts/sandbox-entry.mjs` bridges `127.0.0.1:3128` to it; the overhead is measured.

**Files touched:** `scripts/sandbox.mjs`, `scripts/sandbox-entry.mjs`, `test/sandbox.mjs`, `docs/spikes/P2-04.md`, `docs/cleanroom.md`, `docs/sandbox.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §5.5 (the proxy row), §6 C-03 (all but the gate part), Appendix B item 5, §3 principles 3, 7, 11 and 13; `scripts-node-builtins` (`scripts/sandbox-entry.mjs` is `node:`-only); no shebang; `sandbox-network-none`, `sandbox-no-escape-flags`.
- `export function egressDecision({ policy, endpoints, lockdown, host, port })` in `scripts/sandbox.mjs` → `{ allowed, reason }`: `host` is lowercased and compared as written; `endpoints` is the list of `{ runner, host, port }` for the roles' runners (an endpoint's port defaults to 443 for `https` and 80 for `http`); allowed with reason `runner endpoint <name>` when `host:port` matches one; with `sandbox.egress` (reason `sandbox.egress`) or the host and port of an `allow.urls` entry (reason `allow.urls`) only while `lockdown` is false; a literal IP (`net.isIP(host)`) is denied (reason `literal IP addresses are not allowed`) unless one of those lists names that literal; everything else is denied with `not allowed by this flight's policy` (`lockdown is active` when the host would have been allowed before lockdown).
- `export function startProxy({ socketPath, decide, record })` → `{ close() }`: accepts only `CONNECT host:port HTTP/1.x` and absolute-form `http://host[:port]/...` requests (anything else gets `400`); `decide(host, port)` returns `{ allowed, reason }`; allowed `CONNECT`: `net.connect(port, host)` (the proxy resolves the name itself), reply `HTTP/1.1 200 Connection Established\r\n\r\n`, pipe both ways, count bytes up and down and the elapsed milliseconds, and call `record({ target: "host:port", decision: "allowed", reason, data: { bytesUp, bytesDown, ms } })` when the connection closes; an allowed absolute-form request opens TCP to the host, forwards the bytes unchanged and records the same way; a denied request gets `HTTP/1.1 403 Forbidden`, `Content-Type: text/plain`, `Connection: close` and the body `kukulu egress: <host:port> is not allowed by this flight's policy`, and `record({ target, decision: "denied", reason })` at once. `run` (P2-06) appends each record with `appendEntry(logPath, { kind: "egress", stage: "controller", role: "session", tool: null, target, decision, reason, data })` (`data` only for an allowed connection).
- `scripts/sandbox-entry.mjs`: `export function startBridge({ port, socketPath })` → `{ close() }`: a `net.createServer` on `127.0.0.1:<port>` whose connections are piped to `net.connect(socketPath)` both ways. `const PROXY_PORT = 3128;` and `const PROXY_SOCKET = "/run/kukulu/proxy.sock";` are written once. `main`: start the bridge, then spawn the harness with inherited stdio: `claude --plugin-dir <plugin root> <args>` where the plugin root is this file's `../`; when the first argument is `--exec`, spawn the rest as the command instead; exit with the child's status. Runs only as the entry script.
- Spike `docs/spikes/P2-04.md`: with an in-process proxy, the bridge and a local TCP server, 30 connections through the bridge and 30 direct: added latency per connection (median, p90, maximum) and throughput per MB for a 4 MiB transfer each way; recorded as numbers in a table; no default depends on it and no code changes.
- `docs/cleanroom.md`: the `egress` kind (its fields and `data`); `docs/sandbox.md`: `## Egress` (the rules, lockdown, the 403 body, the bridge, the literal-IP rule, that the router runs inside so model requests are what the proxy logs; TLS interception is a non-goal).
- `CHANGELOG.md` `### Added`: the egress proxy and `egress` entries (G-06, C-03).

**Acceptance tests:** `test/sandbox.mjs`, with an in-process proxy, a local TCP server on `127.0.0.1:<port>` as the fake runner (named literally in the endpoint), and a policy with `allow.urls` `["http://127.0.0.1:<port2>/x"]` and `lockdown.after` `P0-01`: "a CONNECT to the runner endpoint is allowed and logged with its byte counts" (`200` reply, bytes echoed, the recorded entry has `data.bytesUp`, `bytesDown` and `ms`); "a CONNECT to another host gets 403 and a denied entry" (body exact); "an allow.urls host is allowed before lockdown and denied after" (PROGRESS.md with `P0-01` `[x]`); "a literal IP the policy does not name is denied"; "a request that is neither CONNECT nor absolute-form gets 400"; "the bridge forwards 127.0.0.1:<port> to the proxy socket" (a `CONNECT` through `startBridge` on an ephemeral port reaches the proxy); "egressDecision defaults an endpoint's port by scheme".

**Out of scope:** the gate's egress part (P2-07); the container (P2-05, P2-06).

**Verification:** `kukulu_verify`.

**Depends on:** P2-02

### P2-05: containerArgs, the plan, the Containerfile, the fake docker and doctor

**Goal:** `scripts/sandbox.mjs` builds the exact `run` argument list from a plan object, `doctor` reports the engine, the image, the mounts, the egress allowlist and the runners, and the container image template and the fake `docker` exist.

**Files touched:** `scripts/sandbox.mjs`, `templates/sandbox/Containerfile`, `test/harness.mjs`, `test/fixtures/docker/`, `test/sandbox.mjs`, `docs/sandbox.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 C-01 (the `doctor` bullet, the container list, `containerArgs`, the Containerfile), C-07 (the home volume), §3 principles 7, 11, 12 and 13; `sandbox-network-none`, `sandbox-no-escape-flags`, `scripts-node-builtins`; CLAUDE.md "The fake docker" protocol.
- `export function projectIdFor(root)`: the first 16 hex characters of the SHA-256 of `fs.realpathSync(root)`. `export function runtimeDirFor(projectId, env)`: `$XDG_RUNTIME_DIR/kukulu/<id>/`, else `~/.cache/kukulu/run/<id>/`.
- `export function planFor({ policy, root, pluginRoot, runtimeDir, projectId, engine, harnessArgs = [], tty = false, env })` → `{ engine, name: "kukulu-<id>", home: "kukulu-<id>-home", image: <the policy's sha256:<digest> id>, imageName, root, pluginRoot, runtimeDir, policyPath, readOnly: [...], mounts: [...], priorArt: [...], env: {...}, tty, harnessArgs }`. `readOnly` is, in this order: the policy file, `<root>/.kukulu`, `<root>/.claude`, `<root>/.git/config`, `<root>/.git/hooks`, `<root>/.git/info`, `<root>/docs/SPEC.md`, the plugin root; `mounts` the resolved `sandbox.mounts` paths; `priorArt` the resolved `control.priorArt` paths; `env` the fixed variables (`KUKULU_CONTROLLER_SOCKET=/run/kukulu/controller.sock`, `KUKULU_LOG_SOCKET=/run/kukulu/log.sock`, `HTTPS_PROXY=http://127.0.0.1:3128`, `HTTP_PROXY=http://127.0.0.1:3128`, `NODE_USE_ENV_PROXY=1`, `DISABLE_TELEMETRY=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`) plus only those of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` set in `env`, in that order.
- `export function containerArgs(plan)` returns exactly: `["run", "--rm", "--init", "--name", name, "--network", "none", "--read-only", "--tmpfs", "/tmp", "--user", "kukulu", "-w", root, "-i", ...(tty ? ["-t"] : []), "-v", `${root}:${root}`, ...for each readOnly, mounts and priorArt path p: ["-v", `${p}:${p}:ro`], "-v", `${runtimeDir}:/run/kukulu`, "-v", `${home}:/home/kukulu`, ...for each env key k: ["-e", `${k}=${v}`], image, `${pluginRoot}/scripts/sandbox-entry.mjs`, ...harnessArgs]`. No other flag, ever.
- `doctor`: pick the engine (`--engine docker|podman`, else the first of `docker`, `podman` whose `--version` exits 0; none → the problem `no container engine: install docker or podman`); load the policy; the image is present when `<engine> image inspect --format {{.Id}} <sha256:digest>` exits 0; print `engine: <name> (<version line>)`, `image: <imageName> <present|missing> (<digest>)`, `mounts:` then one `  <path> (ro)` per readOnly, mount and prior-art path and `  <root> (rw)`, `egress:` then one line per `sandbox.egress` and `allow.urls` host and per runner endpoint, `runners:` then `  <role>: <model> on <runner> (<endpoint>, <locality>)` for the four roles, read by running `node <pluginRoot>/mcp/server.mjs` as a child with `KUKULU_PROJECT_DIR=<root>` and calling `kukulu_config_show` over JSON-RPC on its stdin. It ends with `sandbox doctor: ok` (exit 0) or `problem: <text>` lines followed by `sandbox doctor: <n> problem(s)` (exit 1). When the image is missing it also prints `build it with: <engine> build -t <imageName> --build-arg NODE_IMAGE=node:22-bookworm-slim --build-arg CLAUDE_CODE_VERSION=latest -f <pluginRoot>/templates/sandbox/Containerfile <pluginRoot>/templates/sandbox` and `then paste into docs/cleanroom.json: "image": "<imageName>@<the output of <engine> image inspect --format {{.Id}} <imageName>>"`. It writes nothing.
- `templates/sandbox/Containerfile`: `ARG NODE_IMAGE=node:22-bookworm-slim`, `FROM ${NODE_IMAGE}`, `ARG CLAUDE_CODE_VERSION=latest`, one `RUN` that installs `git` and `ca-certificates` with `apt-get` (no recommends, lists removed), installs `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` globally with npm, and adds the `kukulu` user with home `/home/kukulu`; `USER kukulu`; `WORKDIR /home/kukulu`; `ENTRYPOINT ["node"]`. Nothing of the plugin is copied in.
- `test/harness.mjs` `mkFakeDocker()`: a directory holding an executable `docker` shell script that appends `$*` to `<dir>/calls.log` and answers: `--version` → `<dir>/version.txt` if present, else `Docker version 27.0.0, build test`, exit 0; `image inspect …` → exit 1 when `<dir>/image-missing` exists, else print `<dir>/image-inspect.txt` (default `sha256:` + 64 zeros when the file is absent); `inspect …` → print `<dir>/inspect.json` when it exists, else exit 1; `run …` → exit 0 (or the number in `<dir>/run-exit`); `exec …` → print `<dir>/exec-output` and exit 0 when that file exists, else find the `sh -c <command>` tail and run it with `sh -c` in the `-w` directory, exiting with its status; `stop …`, `rm …`, `volume …` → exit 0; anything else → exit 1. `test/fixtures/docker/` holds `version.txt`, `inspect.json` (a running `kukulu-<id>` with `State.Running` true, `Image` `sha256:<64 zeros>`, `HostConfig.NetworkMode` `none`, and `Mounts` matching `containerArgs` for a root of `__ROOT__`, which the test substitutes) and `README.md` saying what each file records.
- `docs/sandbox.md`: `## Building the image` (the build command, the digest line, the derived two-line Containerfile with a router, `FROM <image>` then the router's install), `## doctor` (the output shape, produced against the test fixtures and labelled as such), `## The mount list` (each read-only path and why).
- `CHANGELOG.md` `### Added`: `scripts/sandbox.mjs doctor`, `containerArgs` and the image template (G-06, C-01).

**Acceptance tests:** `test/sandbox.mjs`, with the fake docker first on `PATH`: "containerArgs for a policy with mounts, prior art and egress is exactly the expected list" (deep-equal against the list built in the test from the same plan); "containerArgs passes only the credential variables that are set"; "containerArgs adds -t only for a TTY plan"; "doctor reports a missing image with the build command and the digest line" (exit 1, both lines present); "doctor passes with the recorded image and lists the four runners" (exit 0, `sandbox doctor: ok` last); "the Containerfile has the two build args, git, the kukulu user and the node entrypoint"; "projectIdFor is 16 hex characters of the real path's SHA-256".

**Out of scope:** `run` and `stop` (P2-06); gate check 9 (P2-07).

**Verification:** `kukulu_verify`.

**Depends on:** P2-02

### P2-06: run and stop, and docs/sandbox.md

**Goal:** `node scripts/sandbox.mjs run` refuses everything it must before starting anything, then starts the three listeners and the container in the foreground and stops the listeners when it exits; `stop` stops both.

**Files touched:** `scripts/sandbox.mjs`, `test/sandbox.mjs`, `docs/sandbox.md`, `docs/operations.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 C-01 (the `run` and `stop` bullets), C-02, C-03, C-04 (the empty hooks directory), §3 principles 4, 7, 11 and 13; `sandbox-network-none`, `sandbox-no-escape-flags`, `scripts-node-builtins`; CLAUDE.md "The fake docker" protocol.
- `run` refuses, in this order, with nothing started: `darwin` (P2-02's message); the policy does not load (its message); `enforcement` is not `container+proxy` (`scripts/sandbox.mjs run needs policy enforcement "container+proxy" (this policy says "<level>"); under hook enforcement run the session as usual`); no engine; the image is absent (`sandbox.image <imageName>@<digest> is not present; build it (doctor prints the command) or fix the digest`); a mount source other than `<root>/.kukulu` and `<root>/.claude` is missing (`<path> does not exist; run needs every mount source on the host`; those two are created, empty, when absent); `<engine> inspect` reports a container of this project's name running (`container kukulu-<id> is already running; run node scripts/sandbox.mjs stop first`). Each refusal is one line on stderr and exit 1.
- Then: create the runtime directory (mode 0700) with `hooks-empty/` inside; start the controller socket (P2-02; `hooksPath` is that directory), the log socket (P2-03; the project's `.kukulu/cleanroom/log.jsonl`) and the proxy (P2-04; `decide` from `egressDecision` with the policy, the endpoints read as `doctor` reads them, and `lockdownActive(policy, <PROGRESS.md text read at each decision>)`; `record` appends the entry); write `<runtimeDir>/run.json` `{ pid, name, startedAt }`; spawn `<engine> <containerArgs(plan)>` with `stdio: "inherit"` and `tty: process.stdin.isTTY`; on its exit close the listeners, remove `run.json` and return its status. On `SIGINT`/`SIGTERM`, run `<engine> stop <name>` and clean up the same way.
- `stop`: `<engine> stop kukulu-<id>` (a not-running container is not an error), signal the pid in `run.json` with `SIGTERM` when it is alive, remove `run.json`, print `sandbox stop: ok`.
- `docs/sandbox.md` completes: `## Running a flight` (`doctor`, `run`, `stop`, the runtime directory, the git identity must be in the repository's `.git/config` before the flight because inside there is no global git config, a sandboxed flight is serial), `## macOS` (Lima, OrbStack or colima machines holding the project and the key), `## What an agent inside can and cannot do`, `## A worked local-only flight` (profile B: plan and review on the Mac, implement on the Spark, with the local-only template as the policy and a global file naming both runners). `docs/operations.md`: the environment-variable table gains `KUKULU_SANDBOX`, `KUKULU_SANDBOX_ENGINE`, `KUKULU_SANDBOX_HOOKS_PATH`, `KUKULU_CONTROLLER_SOCKET` and `KUKULU_LOG_SOCKET` (set by the sandbox, never by hand). README's documentation map links `docs/sandbox.md`.
- `CHANGELOG.md` `### Added`: `scripts/sandbox.mjs run` and `stop` (G-06, C-01).

**Acceptance tests:** `test/sandbox.mjs`, through `main(argv, { platform: "linux", env, cwd })` with the fake docker on `PATH` and `XDG_RUNTIME_DIR` a short temp directory: "run refuses under hook enforcement with nothing started"; "run refuses a missing image"; "run refuses a digest mismatch" (the fake's `image-inspect.txt` holds another id); "run refuses a running container"; "run refuses a missing mount source naming it"; "run starts the listeners and the container, then stops them when it exits" (`calls.log` holds the exact `run` line from `containerArgs`; the three sockets existed while the fake ran, and are gone after; `run.json` is gone); "stop stops the container" (`calls.log` ends with `stop kukulu-<id>`).

**Out of scope:** gate check 9 (P2-07); running inside (P2-08).

**Verification:** `kukulu_verify`.

**Depends on:** P2-03, P2-04, P2-05

### P2-07: Gate check 9 and the boundary in genesis

**Goal:** Under `container+proxy` genesis records the boundary and gate check 9 (`boundary`) proves the server is behind the sandbox, the container is as recorded, and every allowed egress entry names a host the policy allows.

**Files touched:** `mcp/server.mjs`, `test/sandbox.mjs`, `docs/cleanroom.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-01 (gate check 9), C-03 (the gate part), §3 principles 2, 3, 4 and 10; `server-synchronous`, `relay-not-in-server`; CLAUDE.md "The fake docker" protocol.
- `inspectContainer(engine, name)`: `spawnSync(engine, ["inspect", name])`, parse the JSON array's first element into `{ id: Id, running: State.Running, image: Image, network: HostConfig.NetworkMode, mounts: Mounts.map(m => ({ source: m.Source, destination: m.Destination, rw: m.RW })) sorted by destination }`; a failure or unparseable output is a check failure naming the engine's first stderr line.
- `boundaryCheck(cc, policy, recorded)` returns `null` or `{ reason }`, in this order: `envVar("SANDBOX")` absent → `this flight's policy requires enforcement container+proxy, but this server is not behind a Kūkulu sandbox; start the session with node scripts/sandbox.mjs run`; inspect (engine from `KUKULU_SANDBOX_ENGINE`, default `docker`); not running → `boundary: container <name> is not running`; `image` not the policy's `sha256:<digest>` → `boundary: image is <now>, but the policy pins <digest>`; `network` not `none` → `boundary: network is <now>, but the policy requires none`; the read-write mounts are not exactly the project root and `/home/kukulu` → `boundary: read-write mounts are <list>; only the project and the home volume may be writable`; a required read-only destination missing (the policy file, `.kukulu`, `.claude`, `.git/config`, `.git/hooks`, `.git/info`, `docs/SPEC.md`, the plugin root, each `sandbox.mounts` and `control.priorArt` path, `/run/kukulu`) → `boundary: mount <path> is missing`; with `recorded`, each of `engine`, `image`, `network` and the mount list (sources, destinations and `rw`, ignoring order) equal → else `boundary: <field> is <now>, but genesis recorded <then>`. The container's `id` is returned for the gate entry.
- Genesis, when `policy.enforcement` is `container+proxy`: run `boundaryCheck` with `recorded` null before writing (a failure throws `ToolError("clean-room genesis refused: boundary: " + reason)`), and record `data.enforcement: "container+proxy"` and `data.boundary: { engine, image, network, mounts }`; under `hook`, `data.enforcement: "hook"` and no `boundary`.
- `runGate`, after `routing`, when the policy's `enforcement` is `container+proxy`: `checked.push("boundary")`; `boundaryCheck` with the genesis entry's `data.boundary`; then every `egress` entry after genesis whose `decision` is `allowed` must have a `target` in the union of the runner endpoints (`host:port` from `resolveRouting()`, port defaulted by scheme), `sandbox.egress` and the `allow.urls` hosts, lockdown ignored, else `boundary: egress entry <seq> allowed <host:port>, which no runner endpoint, sandbox.egress or allow.urls entry names`. The passing gate entry's `data` gains `container: <id>`.
- `docs/cleanroom.md`: gate item 9 with its parts, the genesis `boundary` and `enforcement` fields, `gate: ok (9 checks)`. `docs/mcp-tools.md` `kukulu_next`: `boundary` in `gate.checked` and the genesis `data` list.
- `CHANGELOG.md` `### Added`: gate check 9, `boundary` (G-06, C-01, C-03).

**Acceptance tests:** `test/sandbox.mjs`, with the fake docker on `PATH`, `KUKULU_SANDBOX=kukulu-<id>` and `KUKULU_SANDBOX_ENGINE=docker` in the server's env, the fixture `inspect.json` rewritten for the repo's real path, and a policy with `enforcement` `container+proxy` and the fixture's image id: "gate check 9 passes on the recorded inspect output and genesis records the boundary" (`gate.checked` ends in `boundary`; genesis `data.boundary.network` is `none`); "gate check 9 fails on network mode bridge"; "...on an extra read-write mount"; "...on a different image digest"; "...without KUKULU_SANDBOX" (the genesis refusal text); "...on an allowed egress entry for a host the policy does not name" (append the entry with `appendEntry`, then `kukulu_next` halts with the reason naming the seq).

**Out of scope:** running commands inside (P2-08); the manifest's `enforcement` (P2-09); check 10 (P2-11).

**Verification:** `kukulu_verify`.

**Depends on:** P0-03, P2-01, P2-05

### P2-08: Commands run inside the boundary

**Goal:** Under `KUKULU_SANDBOX`, every verify, extraVerify, build and mutate command runs through `<engine> exec` inside the container with an inner `timeout`, every git command the server runs ignores the repository's hooks, and a stream run start refuses.

**Files touched:** `mcp/server.mjs`, `test/sandbox.mjs`, `docs/mcp-tools.md`, `docs/sandbox.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-04, §3 principles 2, 3 and 7; `server-synchronous`, `no-sync-merge`; CLAUDE.md "The fake docker" protocol.
- `runShell(cmd, timeoutMs, cwd = ROOT, { inside = true } = {})`: when `envVar("SANDBOX")` is set and `inside` is true, the command handed to `mcp/run-command.mjs` is `${engine} exec -w ${shellQuote(cwd)} ${name} timeout -k 5 ${Math.ceil(timeoutMs / 1000)} sh -c ${shellQuote(cmd)}` with `engine` from `KUKULU_SANDBOX_ENGINE` (default `docker`) and `name` from `KUKULU_SANDBOX`; the result's `command` stays `cmd`. The gate's and `kukulu_attest`'s guard self-test calls pass `{ inside: false }`; every other call (verify, extraVerify, build, `kukulu_mutate`'s runs and confirm re-runs, `parallel.setup`) runs inside.
- `gitArgv(args)`: under `KUKULU_SANDBOX`, `["-c", "core.hooksPath=" + process.env.KUKULU_SANDBOX_HOOKS_PATH, "-c", "core.fsmonitor=false", ...args]` (`KUKULU_SANDBOX_HOOKS_PATH` absent → `<os.tmpdir()>/kukulu-hooks-empty`, created empty); else `args`. Every `spawnSync("git", …)` in `mcp/server.mjs` (`git()`, `signingProbe`, `commitStaged`'s `run`, `classifyChanges`, `attest`'s log, `prFinalize`'s rebase) goes through it; no other git call site remains.
- `kukulu_run_start({ stream })` under `KUKULU_SANDBOX` refuses before any write: `parallel streams are not supported inside the sandbox (.kukulu/ is read-only there); run a serial plan, or set parallel.maxStreams to 1`.
- `docs/mcp-tools.md` `kukulu_verify`, `kukulu_mutate` and `kukulu_run_start` say what changes under the sandbox; `docs/sandbox.md` `## What runs where` (commands inside, git and the scorer outside, hooks ignored).
- `CHANGELOG.md` `### Added`: commands inside the boundary (G-06, C-04).

**Acceptance tests:** `test/sandbox.mjs`, with the fake docker on `PATH` and `KUKULU_SANDBOX`, `KUKULU_SANDBOX_ENGINE` and `KUKULU_SANDBOX_HOOKS_PATH` in the server's env on a `plannedRepo` whose `verify` is `["echo ok"]`: "kukulu_verify runs each command through docker exec with the wrapper" (`calls.log` holds exactly `exec -w <repo> kukulu-x timeout -k 5 600 sh -c echo ok`; the result's `command` is `echo ok` and `ok` true); "kukulu_mutate runs inside too"; "a commit ignores the repository's hooks inside the sandbox" (an executable `.git/hooks/commit-msg` that exits 1 on `plan:`; `kukulu_plan_commit` succeeds under `KUKULU_SANDBOX` and refuses without it); "a stream run start refuses inside the sandbox"; "without KUKULU_SANDBOX nothing changes" (the same verify runs `echo ok` directly and `calls.log` does not exist).

**Out of scope:** signing (P2-10); the manifest (P2-09).

**Verification:** `kukulu_verify`.

**Depends on:** P2-02

### P2-09: The enforcement level: known limits per level, the manifest and verifier check 11

**Goal:** `KNOWN_LIMITS` becomes twelve `{ id, text, levels }` entries with `knownLimitsFor(level)` in both copies, the manifest carries `enforcement`, and the verifier checks it, accepts `--require-enforcement`, and reads an absent field as `hook`.

**Files touched:** `mcp/cleanroom.mjs`, `mcp/server.mjs`, `scripts/verify-attestation.mjs`, `test/harness.mjs`, `test/attest.mjs`, `test/fixtures/bundles/`, `docs/cleanroom.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4 (the duplicated table), §6 C-06, C-03 (the egress summary), Appendix B item 6, §3 principles 2, 3, 10 and 12; `cleanroom-module-pure`, `server-synchronous`, `verifier-node-only`, `one-hash-one-signature`.
- `mcp/cleanroom.mjs`: `export const ENFORCEMENT_LEVELS = ["hook", "container+proxy", "container+proxy+audit"];` (the order is the rank). `KNOWN_LIMITS` becomes `[{ id, text, levels }]`: the first eight entries keep their 0.7.2 texts word for word with ids `interpreter`, `expansion`, `spellings`, `indirect`, `patterns`, `make`, `mcp` (levels `["hook"]` for all but `session`) and `session` (`["hook", "container+proxy"]`); then `training` (`["hook", "container+proxy"]`: `What a model learned in training is outside every boundary; the similarity score, not the log, measures it.`), `packages` (`["hook", "container+proxy"]`: `Packages named in a lockfile are outside the claim; deny.packages and the gate keep named prior-art packages out of the lockfiles and the cache, and the manifest lists what the lockfiles name.`), `config-writable` (`["container+proxy"]`: `Inside the boundary docs/kukulu.json stays writable, because the planner writes it; only the guard protects it after the plan exists.`), `tls` (`["container+proxy"]`: `The proxy sees host and port, not paths or content inside TLS; whatever an allowed host serves is reachable.`). `export function knownLimitsFor(level)` returns the texts whose `levels` include it, in order, and throws `CleanroomError` for an unknown level. `scripts/verify-attestation.mjs` duplicates the table and the function by hand.
- `attest()`: `enforcement` after `mode`: `{ level }` with `level` = `genesis.data.enforcement ?? "hook"`; under `container+proxy` also `boundary: genesis.data.boundary` and `egress`: an object keyed by `host:port` with `{ allowed, denied }` counts from the `egress` entries. `coverage.knownLimits` is `knownLimitsFor(level)`. `roles[*].assurance` is `"egress"` under `container+proxy`, else `"configuration"`.
- The verifier: `verifyBundle` returns `enforcement: <level>` (an absent manifest field reads as `hook` with the note `enforcement absent (bundle from 0.7.x); read as hook`). Check 11, `enforcement`, after `similarity`: the level is in `ENFORCEMENT_LEVELS` (`enforcement: the manifest's level <JSON> is not one of hook, container+proxy, container+proxy+audit`); under `container+proxy` the genesis has a `boundary` and the manifest's equals it; the egress summary equals a recount from the entries (`enforcement: the egress summary differs from the log's: <recount as JSON>`); no `gate` entry since genesis has `data.failed` `boundary`; and `coverage.knownLimits` equals `knownLimitsFor(level)` (`enforcement: coverage.knownLimits is not the known-limit list for level <level>`). `--require-enforcement <level>` (an unknown level is a usage error, exit 2): a bundle whose level ranks below it fails `enforcement: the bundle was built under <level>, below the required <level>`. `--json` gains `enforcement`.
- `test/harness.mjs` `buildBundle` gains `opts.enforcement` (`hook` default; `container+proxy` writes the genesis `enforcement` and a `boundary` from `test/fixtures/docker/inspect.json`, and the manifest's `enforcement` with an egress summary from `opts.extra`'s entries) and writes `coverage.knownLimits` from `knownLimitsFor`. `test/fixtures/bundles/v0-7-2/` is a small bundle generated once with the pre-task harness shape (no `enforcement`, no `roles`) and committed as recorded data (a public key and signatures only; never a private key).
- `docs/cleanroom.md`: "Known gaps" becomes a table of the twelve limits with their levels; the manifest fields gain `enforcement`; "Verifying offline" lists check 11 and `--require-enforcement`; `docs/mcp-tools.md` `kukulu_attest` names `enforcement`.
- `CHANGELOG.md` `### Added`: the enforcement level in the manifest, verifier check 11, `--require-enforcement` and per-level known limits (G-07, C-06 ⚠️ NEW MATTER).

**Acceptance tests:** `test/attest.mjs`: "knownLimitsFor gives ten texts for hook and five for container+proxy, identically in both copies"; "an unknown level throws in both copies"; "a hook bundle with --require-enforcement container+proxy fails"; "a container+proxy bundle built from the recorded inspect fixture passes it"; "...and fails --require-enforcement container+proxy+audit"; "an edited egress summary fails check 11"; "a manifest whose knownLimits do not match its level fails check 11"; "the 0.7.2 bundle in test/fixtures verifies with the absent-enforcement note"; "--json carries enforcement"; "an unknown --require-enforcement value is a usage error"; the `--json` checks assertion lists eleven checks.

**Out of scope:** the signing note (P2-10); `packages` (P2-11); `roles.reported` and `usage` (P3-03).

**Verification:** `kukulu_verify`.

**Depends on:** P0-06, P2-07

### P2-10: Signing under the boundary

**Goal:** Inside the sandbox `kukulu_run_start` refuses `required`, records the sandbox outcome under `auto`, and finalize does not wait; the verifier reports trailed unsigned commits under `container+proxy` as one note.

**Files touched:** `mcp/server.mjs`, `mcp/cleanroom.mjs`, `scripts/verify-attestation.mjs`, `test/sandbox.mjs`, `test/attest.mjs`, `docs/operations.md`, `docs/mcp-tools.md`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-05, §9 Q7, §3 principles 2, 3, 4 and 10; `server-synchronous`, `verifier-node-only`; CLAUDE.md signing-tests protocol.
- `startRun`, before any write, under `KUKULU_SANDBOX`: `policies.signing` `required` → `policies.signing is 'required', but commits made inside the sandbox cannot be signed: the signing agent stays outside the boundary. Set policies.signing to 'auto' or 'off'; the signed checkpoints vouch for every commit's head`; `auto` → `st.signing = "off (sandbox: commits inside the boundary are unsigned; the signed checkpoints vouch for them)"` with no probe and no change to `commit.gpgsign` (the server's own commits outside keep the operator's setting); `off` as today. `signingNoteFor` returns, for a value starting `off (sandbox:`, `Commits made inside the sandbox are unsigned: commit with git -c commit.gpgsign=false commit -F <file>; the signed checkpoints vouch for every commit's head, and kukulu_pr_finalize will not wait for signatures.` `signaturesExpected(policy, signing)` is false when `signing` starts with `off (sandbox:`.
- `coverageGaps(entries, commitLines, { idleGapHours, level = "hook" })` in both copies: under `container+proxy` an unsigned commit (`N` or `B`) whose stage trailer is non-empty is not listed; `attest()` passes the level and the manifest's `coverage` gains `unsignedTrailed: <n>` under `container+proxy`; the verifier recounts it and prints `unsigned commits: <n> (expected under container+proxy: commits made inside the boundary are unsigned, and the checkpoints sign their heads)` as a note when `n` is above 0. An untrailed unsigned commit is still an `untrailed-commit` gap. Under `hook` nothing changes.
- `docs/operations.md` `## Signing`: the sandbox paragraph (SPEC §6 F); `docs/mcp-tools.md` `kukulu_run_start`'s `signing` values gain the sandbox record and `kukulu_pr_finalize`'s "Signatures expected" names it; `docs/cleanroom.md` coverage gaps: the note.
- `CHANGELOG.md` `### Added`: signing under the boundary (G-06, C-05).

**Acceptance tests:** `test/sandbox.mjs`: "run_start refuses policies.signing required inside the sandbox" (nothing written, HEAD unmoved); "run_start records the sandbox signing outcome under auto with its note"; "finalize does not wait under the sandbox record" (with the fake gh, `signatures` is `not required: …` and no `awaitingSigning`). `test/attest.mjs`: "a container+proxy bundle reports trailed unsigned commits as one note" (no `unsigned-commit` gap); "an untrailed unsigned commit is still a gap under container+proxy"; "under hook each unsigned commit is a gap".

**Out of scope:** the plan-stage probe; re-signing.

**Verification:** `kukulu_verify`.

**Depends on:** P2-09

### P2-11: Lockfile parsers, gate check 10 and the manifest's packages

**Goal:** `mcp/cleanroom.mjs` parses the six lockfile forms with name normalization, gate check 10 (`packages`) refuses a denied package in any tracked lockfile or in the sandbox's cargo cache, and the manifest lists every lockfile's packages as outside the claim.

**Files touched:** `mcp/cleanroom.mjs`, `mcp/server.mjs`, `test/cleanroom.mjs`, `test/attest.mjs`, `test/fixtures/lockfiles/`, `docs/cleanroom.md`, `docs/sandbox.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-07 (all but the guard rule), §9 Q8, §3 principles 2, 3, 4, 10 and 12; `cleanroom-module-pure`, `server-synchronous`; CLAUDE.md "The fake docker" protocol.
- `export const LOCKFILES = [["Cargo.lock", "cargo"], ["package-lock.json", "npm"], ["npm-shrinkwrap.json", "npm"], ["uv.lock", "pypi"], ["poetry.lock", "pypi"]]` plus the rule that a basename matching `/^requirements.*\.txt$/` is `pypi`; `export function lockfileEcosystem(basename)` → the ecosystem or null. `export function lockfilePackages(basename, text)` → `[{ name, version }]` (`version` null when unpinned): `Cargo.lock`, `uv.lock`, `poetry.lock`: every `[[package]]` block's `name = "…"` and `version = "…"` (a minimal TOML reader: blocks start at `[[package]]`, keys are `key = "value"` lines); `package-lock.json`, `npm-shrinkwrap.json`: every `packages` key starting `node_modules/`, the name being the part after the last `node_modules/`, with its `version`; `requirements*.txt`: each line that is not blank, a comment or an option (`-r`, `--…`), the name being the leading `[A-Za-z0-9._-]+`, the version the part after `==` when the specifier is `==`. `export function normalizePackageName(ecosystem, name)`: cargo lowercase with `_` → `-`; pypi PEP 503 (`[-_.]+` → `-`, lowercase); npm as written. `export function deniedPackage(policy, ecosystem, packages)` → the first `{ name, version }` whose normalized name is in the normalized `deny.packages[ecosystem]`, or null.
- Gate check 10, `packages`, after `boundary` (or after `routing` under `hook`), when `deny.packages` has any entry: `checked.push("packages")`; for every `git ls-files` path whose basename has an ecosystem, in `ls-files` order: parse, and on the first denied package `failed("packages", "<lockfile> contains <name> <version>, which policy deny.packages.<ecosystem> names; remove the dependency, and know that its source may already have been read")` (`version` `unpinned` when null). Under `container+proxy`, with `deny.packages.cargo` non-empty: `spawnSync(engine, ["exec", name, "find", "/home/kukulu/.cargo/registry/src", "-mindepth", "2", "-maxdepth", "2", "-type", "d"])`; each output line's basename is `<crate>-<version>` (the crate is the part before the last `-<digit…>`); a denied crate → `failed("packages", "the sandbox's cargo cache holds <dir>")`. A `find` that fails because the directory does not exist is an empty list.
- `attest()`: `packages` after `enforcement`: one `{ path, sha256, ecosystem, packages: ["name@version" | "name"], outsideClaim: true }` per tracked lockfile in `ls-files` order (`[]` with none).
- `test/fixtures/lockfiles/`: `Cargo.lock` (three packages, one `flate2`), `package-lock.json` (two top-level and one nested `node_modules/a/node_modules/b`), `npm-shrinkwrap.json`, `uv.lock`, `poetry.lock`, `requirements.txt` (a pin, an unpinned name, a `>=` spec, a comment, a `-r` line), `requirements-dev.txt`, and a `README.md` saying they are hand-written minimal forms, not real projects.
- `docs/cleanroom.md`: gate item 10; the manifest `packages` field; `gate: ok (10 checks)`. `docs/sandbox.md` `## Dependencies` (the home volume holds every cache, nothing of the host's `~/.cargo`, `~/.npm` or `~/.cache/pip` is mounted, prior-art packages are denied by policy, an oracle that must link prior art is built outside and mounted read-only through `sandbox.mounts`, with cleanflate's zlib oracle as the example). `docs/mcp-tools.md` `kukulu_next`'s `gate.checked` and `kukulu_attest`.
- `CHANGELOG.md` `### Added`: the lockfile parsers, gate check 10 and the manifest's `packages` (G-08, C-07).

**Acceptance tests:** `test/cleanroom.mjs`: "Cargo.lock yields every package name and version"; "package-lock.json yields top-level and nested packages"; "npm-shrinkwrap.json parses like package-lock.json"; "uv.lock and poetry.lock yield their packages"; "requirements.txt yields names and == pins only"; "cargo names compare with - and _ equal"; "PyPI names follow PEP 503"; "npm names compare as written"; "gate check 10 fails on a denied crate in Cargo.lock" (the reason exact); "gate check 10 passes a clean lockfile"; "lockfileEcosystem maps every form and nothing else". `test/sandbox.mjs`: "gate check 10 fails on a denied crate directory in the sandbox cache" (the fake docker's `exec-output` lists a `flate2-1.0.30` directory). `test/attest.mjs`: "the manifest lists each lockfile's packages outside the claim".

**Out of scope:** the guard's add-command rule (P2-12); any other package manager.

**Verification:** `kukulu_verify`.

**Depends on:** P2-01, P2-07

### P2-12: The guard denies adding a denied package

**Goal:** A Bash segment that adds a package named in `deny.packages` is denied with a reason naming the package and its ecosystem.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-07 (the guard paragraph), §3 principles 1, 3 and 6; CLAUDE.md guard-rule protocol (names end `(P2-12)`); `cleanroom-module-pure`, `server-synchronous`.
- Rule 6 gains, judged before the network-command check of the same segment so the reason names the package: a command word `cargo` with subcommand `add` (ecosystem cargo), `npm` with `install`, `i` or `add` (npm), `pip` with `install` (pypi), `uv` with `add` (pypi); every non-option operand after the subcommand is a package spec whose name is the part before the first of `@`, `=`, `<`, `>`, `~`, `!` or `[`; a name whose `normalizePackageName` (P2-11) is in the normalized `deny.packages[ecosystem]` is denied with `denied package: <name as written> is in policy deny.packages.<ecosystem>`. Other words (`pip3`, `pnpm`, `yarn`, `poetry add`) are not modelled: list them as known-gap candidates in the commit body.
- Fixtures, cwd `__ROOT__`, policy inline `{ "version": 1, "deny": { "network": false, "packages": { "cargo": ["flate2", "miniz_oxide"], "npm": ["left-pad"], "pypi": ["zlib-ng"] } } }`: denied (reason `denied package: .* deny\.packages\.cargo`) `cargo add flate2 (P2-12)`, `cargo add flate2@1 (P2-12)`, `cargo add miniz-oxide (P2-12)`; denied (`deny\.packages\.npm`) `npm install left-pad (P2-12)`, `npm i left-pad@2 (P2-12)`, `npm add left-pad (P2-12)`; denied (`deny\.packages\.pypi`) `pip install zlib-ng (P2-12)`, `pip install zlib_ng==1 (P2-12)`, `uv add zlib-ng (P2-12)`; allowed `cargo add serde (P2-12)`, `npm install react (P2-12)`, `pip install requests (P2-12)`, `uv add httpx (P2-12)`, `cargo build (P2-12)`.
- `docs/cleanroom.md` rule 6 gains the sentence.
- `CHANGELOG.md` `### Added`: the guard denies `cargo add`, `npm install|i|add`, `pip install` and `uv add` of a denied package (G-08, C-07).

**Acceptance tests:** the fixtures above through the guard self-test; `test/cleanroom.mjs`: "a denied package add names the package and the ecosystem" (`evaluate` on `cargo add flate2@1` gives the exact reason); every existing fixture keeps its decision and reason.

**Out of scope:** any other command word or spelling; lockfiles (P2-11).

**Verification:** `kukulu_verify`; also the guard self-test before committing.

**Depends on:** P2-11

### P2-13: The 0.7.2 known-gap candidates: --remove-sent-files and pax

**Goal:** rsync's `--remove-sent-files` gets the `--remove-source-files` rule, and `pax -r` extraction and `pax -w -f` archive writes get the tar rules.

**Files touched:** `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json`, `test/cleanroom.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 C-08, §3 principles 1, 3 and 6; CLAUDE.md guard-rule protocol (names end `(P2-13)`); `cleanroom-module-pure`, `server-synchronous`.
- `rsyncParts`: `--remove-sent-files` (whole token, or its part before `=`) sets `removesSources` exactly as `--remove-source-files` does; the reason keeps naming `--remove-source-files`? No: name the option as written: `protected path: <p> (rsync --remove-sent-files removes it)`.
- `pax`: with `-r` and no `-w` (short options may be bundled, `-rf a.tar`), the extraction directory is the current directory after an earlier `cd`, and the tar extraction rule applies: denied when it equals, contains or lies under a protected path, reason `protected path: <p> (pax extracts into <dir>; the archive's contents cannot be known)` with `<dir>` as resolved; with `-w` and no `-r`, the `-f <file>` operand (or `-f<file>`) is a write target: a protected archive path is denied like `tar -cf`. No `-r`, no `-w`: listing, nothing written. `-r` and `-w` together (copy mode) is not modelled: a known-gap candidate in the commit body. `KNOWN_LIMITS` does not change.
- Fixtures, policy `template`, cwd `__ROOT__`: denied `rsync --remove-sent-files docs/cleanroom.json build/ (P2-13)` (reason `rsync --remove-sent-files removes it`), `cd docs && pax -r -f a.tar (P2-13)` (reason `pax extracts into`), `pax -w -f docs/cleanroom.json src (P2-13)` (reason `protected path`); allowed `rsync --remove-sent-files build/a.o out/ (P2-13)`, `pax -f a.tar (P2-13)`, `cd build && pax -r -f a.tar (P2-13)`.
- `docs/cleanroom.md` rule 6 names `--remove-sent-files` beside `--remove-source-files` and `pax` beside the tar sentence.
- `CHANGELOG.md` `### Changed`: `rsync --remove-sent-files` and `pax` get the rules of their siblings (0.7.2 known-gap candidates, C-08).

**Acceptance tests:** the fixtures above through the guard self-test; `test/cleanroom.mjs`, in "rsync and tar denials name what they hit": "a pax extraction denial names the directory" (`run("cd docs && pax -r -f a.tar").reason` equals `protected path: /p/docs/cleanroom.json (pax extracts into /p/docs; the archive's contents cannot be known)`, with the block's own `/p` root); every existing fixture keeps its decision and reason.

**Out of scope:** pax copy mode; any other archiver.

**Verification:** `kukulu_verify`; also the guard self-test before committing.

**Depends on:** none

### P2-14: The real-container integration step

**Goal:** `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs` builds a minimal image, runs a command through the sandbox and checks the boundary; without the variable or `docker` the suite prints the skip line.

**Files touched:** `test/sandbox.mjs`, `test/fixtures/docker/Containerfile.it`, `docs/sandbox.md`, `CONTRIBUTING.md`

**Design constraints:**

- SPEC §6 C-01 (the integration paragraph), §7, §3 principle 13.
- At the end of `test/sandbox.mjs`: when `process.env.KUKULU_SANDBOX_IT === "1"` and `docker --version` exits 0, build `test/fixtures/docker/Containerfile.it` (`FROM node:22-bookworm-slim`; `apt-get` installs `git`, `ca-certificates` and `curl`; the `kukulu` user; `ENTRYPOINT ["node"]`; no Claude Code) as `kukulu-sandbox-it`, read its id with `docker image inspect --format {{.Id}}`, make a temp project (a git repository with `docs/SPEC.md`, `.claude/`, `.kukulu/`, and a policy with `enforcement` `container+proxy` and `image` `kukulu-sandbox-it@<id>`), and run `node scripts/sandbox.mjs run -- --exec sh -c '<script>'` where the script prints `NET_FAIL` when `curl -sS --max-time 10 https://example.com` fails, `KUKULU_WRITE_FAIL` when `echo x > .kukulu/x` fails, and `PROJECT_OK` after `echo hi > it-file.txt`; assert the three markers and that `it-file.txt` exists outside, then remove the image. Otherwise print exactly `sandbox integration: skipped (set KUKULU_SANDBOX_IT=1 with docker on PATH)` as a TAP comment and pass.
- `CONTRIBUTING.md` tests section and `docs/sandbox.md` name the step.

**Acceptance tests:** `test/sandbox.mjs`: "the integration step is skipped without KUKULU_SANDBOX_IT" (the line is printed) and, under the variable with docker present, "inside the container the network, .kukulu writes and project writes behave as the boundary says". The implementer runs the step once if `docker` is on `PATH` and records the outcome in the commit body; a failure to build the image is not a task failure (say so and leave the manual check to the phase end).

**Out of scope:** running Claude Code inside; macOS.

**Verification:** `kukulu_verify`.

**Depends on:** P2-06

### P2-15: Phase 2 end: push and record the manual checks

**Goal:** Push the branch with the sandbox and record Phase 2's manual checks for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task, subject `P2-15: Phase 2 end: push and record the manual checks`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): on Linux, doctor passes; KUKULU_SANDBOX_IT=1 node test/sandbox.mjs passes; a throwaway sandboxed clean-room flight runs to the end; inside it curl https://example.com fails and ls ~/.cargo/registry shows only the volume's own cache; its bundle verifies with --require-enforcement container+proxy and its egress summary lists only the runner endpoints. The same run inside a Linux VM on the owner's Mac is a second, separate check`.

**Depends on:** none

## Phase 3 — Usage and comparison

### P3-01: Stage timing in the log and in state

**Goal:** `kukulu_next` records when each stage starts and ends, as `stage` entries in clean-room mode and as `state.timeline` in every mode, and `kukulu_status` reports the timeline with per-stage seconds.

**Files touched:** `mcp/server.mjs`, `scripts/verify-attestation.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `docs/cleanroom.md`, `docs/architecture.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 D-01, §9 Q10, §3 principles 2, 3, 4 and 10; `server-synchronous`.
- In `next()`, after the result is computed and before it is returned: the open span is the last `timeline` record whose `event` is `start` with no later `end` for the same stage and round. A result whose stage is not `done` or `halt` and does not match the open span (stage and round) closes the open span (`{ event: "end", stage, round, at }`) and opens a new one (`{ event: "start", stage, round, at }`); a `done` or `halt` result closes the open span; a result matching the open span writes nothing. `at` is an ISO timestamp. In clean-room mode each record is also appended as `{ kind: "stage", stage: <stage>, role: "controller", data: { event, stage, round } }`, with `agent` (the result's `agent`) and `model` added to a `start`. When anything was written, commit `.kukulu/state.json` and the log as `chore: stage <stage>` (`chore: stage end` for a close alone) with stage `controller`, on whatever branch the server is on, through `withRollback` and `gitCommitIfChanged`. A `streams` result is an implement stage like any other.
- `kukulu_status` gains `timeline` (the records) and `stageSeconds`: for each stage, the sum of its spans' lengths in whole seconds, an open span counted up to now.
- The verifier's chain check accepts the kind (confirm; `verifyChain` checks keys, not kinds) and the manifest's `calls` stays limited to `allowed` and `denied` entries (confirm `summarizeEntries` ignores `stage`).
- `docs/mcp-tools.md` `kukulu_next` (the writes it makes) and `kukulu_status` (`timeline`, `stageSeconds`); `docs/cleanroom.md` the `stage` kind; `docs/architecture.md`'s `kukulu_next` paragraph says it also records the timeline.
- `CHANGELOG.md` `### Added`: stage timing in the log and `state.timeline` (G-10, D-01).

**Acceptance tests:** `test/state.mjs`: "three kukulu_next calls give start, end and start in order, in the chain and in timeline" (a `cleanroomRepo`: the first call opens `plan`; after `addPlan`, the second closes `plan` and opens `implement`; the third writes nothing; the chain's `stage` entries and `state.timeline` both read `start plan, end plan, start implement`, and `start` entries carry `agent` and `model`); "a halt closes the open stage" (`kukulu_run_halt`, then `kukulu_next` appends one `end`); "general mode writes timeline and no chain"; "kukulu_status reports the timeline and per-stage seconds"; "the timeline commit lands as chore: stage <stage>".

**Out of scope:** `usage` entries (P3-02); `compare-bundles.mjs` (P3-04).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P3-02: Token use per role from the subagent transcript

**Goal:** On `SubagentStop`, in clean-room mode, the logger reads the subagent's transcript and appends one `usage` entry with the per-model token sums; the gate requires that hook registration.

**Files touched:** `hooks/hooks.json`, `scripts/cleanroom-log.mjs`, `mcp/server.mjs`, `test/fixtures/transcripts/subagent.jsonl`, `test/cleanroom.mjs`, `test/plugin.mjs`, `docs/cleanroom.md`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 D-02, Appendix B item 7, §3 principles 2, 3, 10 and 12; `hooks-lazy-cleanroom`, `scripts-node-builtins`, `no-hardcoded-target-max`; CLAUDE.md clean-room tests protocol (the hook test sets `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` and `HOME`).
- `hooks/hooks.json`: a second object in the `SubagentStop` array, after the implement guard's, with no `matcher`, whose one hook runs `"${CLAUDE_PLUGIN_ROOT}"/scripts/cleanroom-log.mjs`. Gate check 3's `registers` list gains `["SubagentStop", "cleanroom-log.mjs"]`. `test/plugin.mjs`'s hook-wiring assertions are extended, not loosened.
- `scripts/cleanroom-log.mjs`, when `hook_event_name` is `SubagentStop` and logging is active: read `agent_transcript_path` (else `transcript_path`) line by line; for each JSON line with `type` `assistant` and a `message.usage` object, count it once per `requestId` (the first occurrence; a line without `requestId` counts on its own): `models[message.model]` sums `requests` (+1), `input` (`input_tokens`), `output` (`output_tokens`), `cacheRead` (`cache_read_input_tokens`), `cacheWrite` (`cache_creation_input_tokens`), each missing number read as 0; `first` and `last` are the smallest and largest `timestamp` among the counted lines; `cost` is the sum of `costUSD` when every counted line carries a number, else null. Append `{ kind: "usage", role: <agent_type>, tool: null, decision: null, data: { models, first, last, cost } }` (with `entryFields` for stage, task, model and session). A transcript that cannot be read or has no counted line gives `data: { error: "<first line of the message>" }`. Under `KUKULU_LOG_SOCKET` the entry goes through the socket (P2-03). General mode writes nothing.
- `test/fixtures/transcripts/subagent.jsonl`: six lines keeping only `type`, `requestId`, `timestamp`, `message.model` and `message.usage` (`costUSD` on every assistant line): four `assistant` lines of which two share one `requestId`, one `assistant` line without `requestId`, one `user` line; two models among them. No content, prompt or path from any session. `scripts/check-names.mjs` passes over it.
- `docs/cleanroom.md`: the `usage` kind and the SubagentStop hook; `docs/mcp-tools.md` nothing (no tool changes), unless `kukulu_status`'s cleanroom block needs a word.
- `CHANGELOG.md` `### Added`: token use per role from the subagent transcript (G-10, D-02). `### Changed`: a clean-room flight started on 0.7.x cannot continue on 0.8.0, because `hooks/hooks.json` and the hook scripts changed and gate check 3 pins them (SPEC §1).

**Acceptance tests:** `test/cleanroom.mjs`: "the logger sums a subagent transcript's usage with the duplicate requestId counted once" (the exact sums per model, `first`, `last` and `cost`); "an unreadable transcript gives a usage entry with error"; "general mode writes nothing on SubagentStop"; "the SubagentStop hook stays within the 50 ms budget on the fixture" (asserted like the existing budget test); "the gate requires the logger on SubagentStop" (a temp plugin whose `hooks.json` lacks the entry fails check 3 with `hooks/hooks.json no longer registers cleanroom-log.mjs on SubagentStop`). `test/plugin.mjs`: "hooks.json runs the clean-room logger on SubagentStop after the implement guard".

**Out of scope:** the manifest and the verifier (P3-03).

**Verification:** `kukulu_verify`.

**Depends on:** P2-01

### P3-03: The manifest's reported models and usage, and verifier check 12

**Goal:** The manifest's `roles` gain `reported` and `usage`, recounted by the verifier, which notes a reported model that routing did not declare.

**Files touched:** `mcp/server.mjs`, `scripts/verify-attestation.mjs`, `test/harness.mjs`, `test/attest.mjs`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 A-03 (the manifest's `reported` and the note), D-02 (the manifest's `usage`), §3 principles 2, 3, 10 and 12; `server-synchronous`, `verifier-node-only`.
- `rolesUsage(entries)`: for each role, the `usage` entries whose `role` is `kukulu-<role>` or `kukulu:<role>`; `reported` is the sorted distinct `data.models` keys; `usage` is `{ requests, input, output, cacheRead, cacheWrite, cost }` summed over those entries' models (`cost` null when any entry's is null; entries with `data.error` are skipped). `attest()` adds both to each `roles[role]`.
- The verifier: check 12, `roles`, after `enforcement`: when the manifest has `roles`, recount `reported` and `usage` from the entries and fail on a difference (`roles: <role>.<reported|usage> differs from the log's: <recount as JSON>`); then, for each role whose `reported` names a model other than `roles[role].model`, the note `<role>: the endpoint reported <names joined by ", ">; routing declared <model>`. A manifest without `roles` (0.7.x) passes with no note.
- `test/harness.mjs` `buildBundle` gains `opts.roles` (written into the genesis and the manifest, with `reported` and `usage` computed from `opts.extra`'s `usage` entries by the same rule, or given explicitly to build a bad one).
- `docs/cleanroom.md`: the manifest's `roles` fields; check 12 in "Verifying offline".
- `CHANGELOG.md` `### Added`: `roles.reported`, `roles.usage` and verifier check 12 (G-02, G-10).

**Acceptance tests:** `test/attest.mjs`: "the manifest's roles carry reported models and usage sums"; "an edited usage sum fails roles"; "a reported model other than the routed one prints the note" (the exact text); "a 0.7.x manifest without roles passes check 12 with no note"; the `--json` checks assertion lists twelve checks.

**Out of scope:** `compare-bundles.mjs` (P3-04).

**Verification:** `kukulu_verify`.

**Depends on:** P2-09, P3-02

### P3-04: scripts/compare-bundles.mjs

**Goal:** A script compares two bundles side by side and, given both result trees, scores them against each other with bundle A's parameters.

**Files touched:** `scripts/compare-bundles.mjs`, `test/bundles.mjs`, `test/fixtures/compare/expected.txt`, `test/harness.mjs`, `CONTRIBUTING.md`, `docs/cleanroom.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §4, §6 D-03, §3 principles 3, 11 and 12; `scripts-node-builtins` (imports `node:` modules and `../mcp/cleanroom.mjs` only); no shebang; the CLI runs only as the entry script; never writes a file.
- `node scripts/compare-bundles.mjs <bundle-a> <bundle-b> [--key-a sha256:<fp>] [--key-b sha256:<fp>] [--trees <dir-a> <dir-b>] [--json]`. First run each bundle's own `verify.mjs <dir> [--key <fp>] --json`; refuse (exit 1, `compare-bundles: <dir> does not verify: <first reason>`) unless each exits 0 or 3. Then print, from each manifest and log, one section per item with a line for A and a line for B, in this order and shape: `mode and enforcement` (`  A: <mode>, <level>` plus `; egress: <host:port> <allowed>/<denied>, …` when present); `gates` (`  A: <run> run, <failed> failed`); `human records` (`  A: <n> instructions, <n> interventions, <n> verdicts`); `denials by reason` (`  A: <reason>: <n>; …` or `  A: none`); `coverage gaps by kind` (`  A: <kind>: <n>; …` or `  A: none`); `similarity` (`  A: <verdict>` then one `    <metric>: negative <score> positive <score>` per metric, from `similarity.json`); `roles` (`  A: <role>: <model> on <runner> (<identity source>, <family>)` per role); `wall time per stage` (`  A: <stage> <seconds> s, …` from the `stage` entries' spans); `tokens per role and model` (`  A: <role>: <model> <input> in / <output> out, …` from the `usage` entries). A missing item prints `  A: —` (an em dash, U+2014, written in the script as its Unicode escape). With `--json`, one object with the same items under `a` and `b`.
- `--trees <dir-a> <dir-b>`: parameters from bundle A's `similarity.json` `config` (`ngram`, `minIdentLen`, `commentNgram`, `languages`); refuse when neither bundle has one (`compare-bundles: neither bundle has a similarity.json, so --trees has no scoring parameters`) and when B has one whose parameters differ (`compare-bundles: bundle B's similarity parameters differ from A's (<key>)`); read both trees like `kukulu_similarity` reads a side (mapped extensions, no binaries), score with `tokenize` and `scorePair`, and print a `cross score` section: one line per metric `  <metric>: cross <score>; A negative <score>; B negative <score>` followed by the sentence `Two independent clean-room builds should score at or near their negative controls.`
- `test/fixtures/compare/expected.txt` is the exact text output for the two bundles the test builds (a `hook` one and a `container+proxy` one with `stage` and `usage` entries, under `buildBundle`'s `clock` so the spans are fixed), recorded once and checked in; the test substitutes nothing.
- `CONTRIBUTING.md` layout row; `docs/cleanroom.md` a `## Comparing two bundles` paragraph naming the script.
- `CHANGELOG.md` `### Added`: `scripts/compare-bundles.mjs` (G-09, D-03).

**Acceptance tests:** `test/bundles.mjs`: "the text output for a hook and a container+proxy bundle matches expected.txt"; "--json prints both bundles' items"; "a failing bundle refuses"; "--trees on two fixture trees gives the cross score" (equal to `scorePair` on `test/fixtures/similarity/a` and `b` with the defaults); "mismatched parameters refuse"; "no similarity.json refuses --trees"; "the script writes nothing".

**Out of scope:** any change to the scorer.

**Verification:** `kukulu_verify`.

**Depends on:** P3-03

### P3-05: Phase 3 end: push and record the manual check

**Goal:** Push the branch with the usage and comparison work and record Phase 3's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 3. No code change. Push if this run's policies allow it and `origin` exists. An empty commit carries the task, subject `P3-05: Phase 3 end: push and record the manual check`.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): compare-bundles.mjs on the Phase 2 bundle and a hook bundle from a real flight prints wall time and tokens per role for both`.

**Depends on:** none

## Phase 4 — Release tool, notes, documentation and release

### P4-01: kukulu_release

**Goal:** A new tool tags the newest archived flight's merged PR, pushes the tag and creates a GitHub release from the CHANGELOG entry, as a draft unless asked to publish.

**Files touched:** `mcp/server.mjs`, `test/harness.mjs`, `test/review.mjs`, `test/protocol.mjs`, `test/plugin.mjs`, `skills/go-flight/SKILL.md`, `docs/mcp-tools.md`, `README.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-01, §9 Q9, §3 principles 2, 3, 4 and 10; CLAUDE.md "Adding a tool" protocol (position: after `kukulu_pr_finalize`, before `kukulu_agents_sync`; count 26 everywhere; both spellings on go-flight's `allowed-tools`; no stage agent gets it); `server-synchronous`, `no-sync-merge`.
- Input `{ publish?: boolean }` (anything else refused). Refusals, in order, before any write: no `state.archived` → `kukulu_release releases the newest archived flight, and none is archived; archive it first`; the archived `PROGRESS.md`'s `Branch:` is the branch; `gh pr view <branch> --json state,mergeCommit,number,url` (bounded like `prChecks`'s calls) must say `MERGED` → else `the flight's PR (<url>) is <state>; kukulu_release runs after a human merges it` (a `gh` failure refuses with its first line); `CHANGELOG.md` at the merge commit (`git show <sha>:CHANGELOG.md`) has a newest entry `## [x.y.z]` → `CHANGELOG.md at <sha> has no numbered entry; add ## [x.y.z] before releasing`; the tag `v<x.y.z>` exists locally (`git rev-parse --verify --quiet refs/tags/v…`) or on origin (`git ls-remote --tags origin refs/tags/v…`) → `the tag v<x.y.z> already exists (at <sha>); bump CHANGELOG.md's newest entry before releasing`, except when it points at the merge commit and `gh release view v<x.y.z>` fails (no release yet): then the tag steps are skipped; the local `baseBranch` must be checked out and clean, then `git fetch origin` and `git merge --ff-only origin/<base>` must leave it containing the merge commit → else `<base> does not contain the merge commit <sha> after a fast-forward pull; merge or rebase by hand, then call kukulu_release again`.
- Then: `git tag -s|-a v<x.y.z> -m v<x.y.z> <sha>` (`-s` when `git config --get tag.gpgsign` is `true` or the archived `state.json`'s `signing` is `"on"`; `GIT_TERMINAL_PROMPT=0`, `SIGNING_TIMEOUT_MS`; a failure refuses with git's first line and no tag); `git push origin refs/tags/v<x.y.z>` (a failure deletes the local tag and refuses); write the notes to a temp file: the entry's body (the lines between its heading and the next `## ` line, trimmed) then a blank line and `See [CHANGELOG.md](<repo url>/blob/v<x.y.z>/CHANGELOG.md) for the full list.` with the repository URL parsed from `origin`; `gh release create v<x.y.z> --verify-tag --title v<x.y.z> --notes-file <temp>` plus `--draft` unless `publish` is true. A failing `gh release create` after the push throws `the tag v<x.y.z> was pushed; create the release by hand with gh release create v<x.y.z> --verify-tag, or call kukulu_release again` with gh's first line appended. Result `{ tag, sha, release: <the URL gh printed>, draft }`.
- `test/harness.mjs` `mkFakeGhBin`: `pr view <branch> --json …` prints `<dir>/pr-view.json` when it exists (else the existing behavior); `release view …` exits 0 when `<dir>/release.json` exists, else 1; `release create …` records its arguments, copies `--notes-file`'s content to `<dir>/release-notes.txt`, fails with `<dir>/release-fails` on stderr when that file exists, else writes `<dir>/release.json` and prints `https://github.invalid/releases/tag/<tag>`.
- `skills/go-flight/SKILL.md` Flight options: "release it" → `kukulu_release({})` and "release and publish" → `kukulu_release({ publish: true })`, called once, result printed, then stop. `docs/mcp-tools.md`: the `## kukulu_release` section after `kukulu_pr_finalize`; the first line reads `Twenty-six tools`. README: `twenty-six tools` and the table row.
- `CHANGELOG.md` `### Added`: `kukulu_release` (E-01; the 2026-10-20 notes' open question 2).

**Acceptance tests:** `test/review.mjs`, with the fake gh and a bare `origin` holding a merged commit on `main` (the test builds `main`, a build branch, merges it with `--no-ff`, pushes, and writes `pr-view.json` with `MERGED` and that merge commit; `state.archived` points at an archive directory holding `PROGRESS.md` with the branch and `state.json`): "kukulu_release makes a draft release on the merged PR's commit" (`calls.log` has `release create v… --verify-tag --title v… --notes-file … --draft`, the tag exists on `origin` at the merge commit, the result's `draft` true); "publish omits --draft"; "no archived flight refuses"; "an unmerged PR refuses with no tag"; "no numbered CHANGELOG entry at the merge commit refuses"; "an existing tag refuses with no tag pushed"; "a base behind the merge commit is fast-forwarded"; "a failing gh release create leaves the pushed tag and says so"; "a second call creates only the release" (no second `tag` or `push` in the log); "the notes file holds the CHANGELOG entry body and the See line" (exact content); "a signed tag is made when tag.gpgsign is true" (with `mkFakeGpg` and `useFakeSigner`, `git cat-file -p` of the tag shows a signature). `test/protocol.mjs` and `test/plugin.mjs` count 26 and place the tool; `test/plugin.mjs`: "go-flight maps release it to kukulu_release".

**Out of scope:** merging; anything a stage agent could call.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P4-02: Base health before planning

**Goal:** When `kukulu_next` returns `plan` after an archived flight and no `docs/kukulu.json` exists, it scans the tracked tree with the archived constraints and tells the planner which ones the base fails.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-02, §3 principles 2 and 3; `server-synchronous`.
- At the `plan` return in `next()`, when `st.archived` is set and `P.config` does not exist: read `<archived.dir>/kukulu.json` (or the pre-0.6.0 name, as `requiredSigningPolicy` does; unreadable → today's prompt); run `checkConstraints(archived.constraints, ROOT, [])` (self-test plus scan, no command); when any rule has hits, the prompt gains one sentence after its last one: `The base fails <n> constraint(s) carried from flight <slug>: <id> (<file>:<line>), …; decide in the plan whether a task restores them or the spec changed them.` (one `<id> (<file>:<line>)` per failing rule, its first hit) and the reason gains `; base health: <n> failing`. Nothing is refused.
- `docs/mcp-tools.md` `kukulu_next`: the base-health paragraph.
- `CHANGELOG.md` `### Added`: base health before planning (E-02; the 0.7.2 flight's plan-stage friction, `docs/flights/v0-7-2/feedback.jsonl`).

**Acceptance tests:** `test/state.mjs`: "an archived flight with a constraint the base breaks gives the base-health sentence" (an archive whose `kukulu.json` has one rule the tree breaks; the prompt ends with the sentence and the reason with `base health: 1 failing`); "a clean base gives today's prompt"; "no archive gives today's prompt"; "a base-health scan runs no command" (the archived `verify` is `["false"]` and the call still returns `plan`).

**Out of scope:** running `verify`; refusing.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P4-03: The 0.7.2 review's notes

**Goal:** `classifyChanges` ignores renames, the synthetic gh error lines live in fixtures, and `kukulu_run_start`'s documented `signing` values are complete.

**Files touched:** `mcp/server.mjs`, `test/state.mjs`, `test/review.mjs`, `test/fixtures/gh/`, `docs/mcp-tools.md`, `CHANGELOG.md`

**Design constraints:**

- SPEC §6 E-03, §3 principles 3, 10 and 12.
- `classifyChanges` runs `git diff --raw --no-renames -z --abbrev=40 HEAD -- <paths>`; no other change to its mapping.
- Every string a test in `test/state.mjs` or `test/review.mjs` writes as a fake gh stderr or stdout body (`checks-stderr`, `view-title-fails`, `merge-fails`, `api-fails` and the like) moves to a file under `test/fixtures/gh/` (one per distinct line, named for what it records), read by the test; no recorded gh line stays inline.
- `docs/mcp-tools.md` `kukulu_run_start`'s Returns list names every `signing` value: `"on"`, `"off"`, `"none"`, `off (probe failed: …)`, `off (commit signing failed: …)` and `off (sandbox: …)`.
- `CHANGELOG.md` `### Fixed`: `classifyChanges` reads the diff without rename detection, so a rename never pairs records wrongly (0.7.2 REVIEW note).

**Acceptance tests:** `test/review.mjs`: "a renamed residue is classified as content under rename detection" (`diff.renames true` in the repo's config, a tracked file renamed by the mutation's command; `restoredChanges` names both paths with `deleted` and `content`). The moved fixtures: every existing test that used an inline line still passes.

**Out of scope:** any other note.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P4-04: The documentation sweep

**Goal:** Every documentation bullet of SPEC §6 F is true of the tree.

**Files touched:** `docs/sandbox.md`, `docs/publishing.md`, `docs/cleanroom.md`, `docs/routing.md`, `docs/operations.md`, `docs/mcp-tools.md`, `docs/architecture.md`, `README.md`, `CONTRIBUTING.md`

**Design constraints:**

- SPEC §6 F (every bullet), §3 principles 10 and 11; `site-no-patented` (write "patent pending").
- Walk §6 F bullet by bullet and fix what the earlier tasks left short, without rewriting what is right: `docs/sandbox.md` has every listed section, and the recorded `doctor` output is labelled as produced against the test fixtures; `docs/cleanroom.md` covers the new policy keys, gate checks 8 to 10 and `gate: ok (<n> checks)` counting up to ten, control mode, the new entry kinds, the manifest's new fields, checks 11 and 12, `--expect`, `--require-enforcement` and exit 3, and the twelve known limits with their levels; `docs/routing.md` covers runners, `scripts/model-identity.mjs`, local-model starting points, and says that prefix caching is off in some vLLM recipes and that Ollama's Anthropic endpoint does not cache prompts, so prefill dominates long flights, and that the context caps are the operator's to set on the runner; `docs/operations.md` has the egress and signing notes for a sandboxed flight and the environment variables; `docs/mcp-tools.md` says "Twenty-six tools" and covers every listed tool change; README has one paragraph on the sandbox under "Clean-room mode"; CONTRIBUTING has the rows for the `sandbox` and `bundles` suites and every new script; `docs/architecture.md`'s gate diagram and prose say ten checks and name the boundary (the drawing of SPEC §4 may go into `docs/sandbox.md`).
- Every relative link resolves (`test/plugin.mjs` checks); markdownlint-clean.

**Acceptance tests:** `test/plugin.mjs`'s documentation assertions pass; the implementer lists each §6 F bullet with "already true" or "fixed here" in the commit body.

**Out of scope:** CHANGELOG and the version (P4-05); `site/` and `docs/site/`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P4-05: CHANGELOG 0.8.0 and the version

**Goal:** The release reads 0.8.0 everywhere and the changelog entry is complete.

**Files touched:** `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `mcp/server.mjs`, `README.md`

**Design constraints:**

- SPEC §1 ("the version reads 0.8.0 everywhere"), §6 F.
- Rename `## [Unreleased]` to `## [0.8.0] — <today>` with `### Added`, `### Changed` and `### Fixed` only, no Breaking changes heading (§1). Read the lines earlier tasks added; each cites its goal (`G-06`), feedback item or note; fill any gap so every §6 requirement has a line, including the §1 sentence that a clean-room flight started on 0.7.x cannot continue on 0.8.0 (under Changed).
- `0.8.0` in `package.json`, `.claude-plugin/plugin.json`, `VERSION` in `mcp/server.mjs`, and README's version badge (`version-0.8.0`, alt `Version 0.8.0`). The tool count stays twenty-six.

**Acceptance tests:** `test/plugin.mjs`'s existing "package.json and plugin.json agree on the version", "the MCP server reports the plugin's version" and "CHANGELOG.md's newest entry is the package version".

**Out of scope:** tagging, publishing or merging (that is `kukulu_release`, run by the owner after the merge).

**Verification:** `kukulu_verify`.

**Depends on:** none

### P4-06: Phase 4 end: push and record the manual check

**Goal:** Push the release branch and record Phase 4's manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 4, §6 F (HANDOFF). No code change. Push if policies allow and `origin` exists. An empty commit carries the task, subject `P4-06: Phase 4 end: push and record the manual check`. The handoff written for `kukulu_run_finish` starts with the bold line CLAUDE.md's flight notes give.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code or docs; merging; releasing.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human): on a scratch repository with a merged PR, kukulu_release makes a draft release whose notes match the CHANGELOG entry; this release is the first one kukulu_release cuts, after the owner merges`.

**Depends on:** none

## Spec issues

- C-02's test says the relay lists "the server's 26 tools", but the 26th tool (`kukulu_release`, E-01) lands in Phase 4 and the relay in Phase 2. Resolution: P2-02's test compares the relayed `tools/list` with a direct stdio `tools/list` of the same server, so it is right at both counts.
- E-02 cites "kukulu F-01 of 2026-10-26", but `docs/feedback/2026-10-26-kukulu.md`'s F-01 is the gh 2.45.0 `prChecks` item of the v0-7-1 flight (fixed by 0.7.2 D-01); the base-was-red friction is the 0.7.2 flight's plan-stage entry in `docs/flights/v0-7-2/feedback.jsonl`, not yet pulled into a feedback file. Resolution: P4-02's CHANGELOG line cites that archived entry; no feedback file is edited (SPEC names none).
- §5.4 says three constraints are added, but §5.5 makes `LOG_SOCKET_TIMEOUT_MS = 2000` an ⚠️ ASSUMPTION living "in `mcp/cleanroom.mjs` only", which is a single-line rule the plan-build skill requires as data. Resolution: a fourth constraint, `no-hardcoded-log-socket-timeout`, with the same shape as `no-hardcoded-target-max`.
- A-03's manifest `roles.reported` needs D-02's `usage` entries, which Phase 3 adds. Resolution: Phase 0 writes `roles` without `reported` and `usage` (P0-06), Phase 3 adds them (P3-03); every verifier check tolerates a manifest from the earlier shape.
- D-02 says the manifest's `usage` is "recounted by the verifier" but assigns the recount to no check, and SPEC fixes check 11 as `enforcement`. Resolution: a twelfth check, `roles` (P3-03), so the eleven-check list stays as SPEC numbers it.
- C-01 names the image as `<name>@sha256:<64 hex>` and says `doctor` prints the digest "for the image the owner built", but a locally built image has no registry digest. Resolution: the digest is the engine's image id (`image inspect --format {{.Id}}`), which exists for a built image and a pulled one alike; `run` passes the id.
- C-01 sets the entrypoint to `node <plugin root>/scripts/sandbox-entry.mjs` with the plugin root "passed at run time", which an image's `ENTRYPOINT` cannot express. Resolution: `ENTRYPOINT ["node"]` and the script path as the first command argument.
- C-01 mounts `.kukulu/` read-only inside, so a parallel stream's worktree cannot be created there. Resolution: `kukulu_run_start({ stream })` refuses under `KUKULU_SANDBOX` (P2-08); a sandboxed flight is serial, and `docs/sandbox.md` says so.
- C-05 says commits inside are unsigned, but a repository whose `.git/config` (read-only inside) sets `commit.gpgsign true` makes the implementer's own `git commit` fail there, since no signer exists inside. Resolution: the sandbox `signingNote` tells the implementer to commit with `-c commit.gpgsign=false` (P2-10).
- D-01 records the timeline in `state.json` "in every mode", but an uncommitted `state.json` would make `kukulu_run_start` refuse a dirty base branch. Resolution: `kukulu_next` commits the timeline as `chore: stage <stage>` (P3-01), as it already commits genesis; this is one commit per stage transition, and the plan stage's lands on the base branch.
- C-02's `.mcp.json` passes three named variables to the server; whether an unnamed one is inherited is a Claude Code detail. Resolution: `.mcp.json` names `KUKULU_CONTROLLER_SOCKET` too (P2-02).
- §6 F lists `docs/HANDOFF.md`'s first line but no task writes HANDOFF (the implementer does, at `kukulu_run_finish`). Resolution: CLAUDE.md's flight notes give the line, and P4-06 repeats it.
- The 0.7.2 flight notes in CLAUDE.md say "`policies.archive` defaults to `true` … is written only in `cfgFrom`"; nothing changes there. Noted so the reviewer does not look for a task.

## Review fixes (round 1)

### R1-01: Mount the runtime directory read-only and hold gate check 9 to the exact mount list

**Goal:** Nothing inside the container can write the runtime directory (hooks-empty/, run.json, the sockets), and gate check 9 accepts only the exact mount list SPEC C-01 names, so the box can neither plant a hook the host's git runs nor start with an extra or substituted mount.
**Files touched:** scripts/sandbox.mjs, mcp/server.mjs, test/sandbox.mjs, test/fixtures/docker/inspect.json, test/fixtures/docker/README.md, docs/sandbox.md, docs/cleanroom.md, docs/architecture.md, CHANGELOG.md
**Design constraints:** SPEC §3 principle 7, §6 C-01 ("exactly the mount list above"), C-04, C-07; REVIEW F-01. containerArgs mounts "-v", `${runtimeDir}:/run/kukulu:ro` (sockets connect through a read-only bind mount; Linux checks the socket inode, not the mount). boundaryCheck refuses, with reasons written for a model and wrapped as today (`clean-room genesis refused: boundary: ...` / `clean-room gate failed: boundary: ...`): a writable set other than exactly the project root and /home/kukulu (`read-write mounts are <list>; only the project and the home volume may be writable`); /run/kukulu missing, writable, or whose source is not the directory holding KUKULU_SANDBOX_HOOKS_PATH; /home/kukulu that is not a volume named `<KUKULU_SANDBOX>-home` (inspectContainer keeps Type and Name); a same-path mount whose source differs from its destination; any destination outside the expected set (the project, the fixed read-only list, sandbox.mounts, control.priorArt, the plugin root, /run/kukulu, /home/kukulu), naming it. Keep sandbox-network-none, sandbox-no-escape-flags, server-synchronous and relay-not-in-server green. The fixture inspect.json changes /run/kukulu to RW false. Docs: docs/cleanroom.md gate item 9, docs/sandbox.md mount list and runtime directory, docs/architecture.md:118. CHANGELOG under ## [0.8.0] ### Fixed (or amend the Added line), citing the review.
**Acceptance tests:** test/sandbox.mjs: "containerArgs ... is exactly the expected list" updated to expect `<runtimeDir>:/run/kukulu:ro`; "gate check 9 halts on a writable /run/kukulu" and "genesis refuses a writable /run/kukulu" (the recorded fixture with RW true, reason naming only the project and the home volume); "gate check 9 halts on an extra read-only mount" (a Mounts entry /etc-ro RW false, reason naming the destination); "gate check 9 halts when /home/kukulu is a bind mount of a host directory"; "gate check 9 halts when a same-path mount's source differs"; the existing passing case still passes. Integration step (KUKULU_SANDBOX_IT=1): the script also prints RUNTIME_WRITE_FAIL when `touch /run/kukulu/x` fails and SOCKET_OK when `node -e` connects to /run/kukulu/log.sock; assert both. Run the integration step once if docker is on PATH and record the outcome in the commit body.
**Out of scope:** Restricting which entry kinds the log socket accepts (a spec issue); the proxy; signing.
**Verification:** kukulu_verify; KUKULU_SANDBOX_IT=1 node test/sandbox.mjs when docker is available.
**Depends on:** none

### R1-02: The constraint scan never reads through a symlink that leaves the project

**Goal:** kukulu_verify's constraint scan (which runs outside the boundary) never reads or returns the content of a listed path whose real path lies outside the project root, so a symlink cannot turn constraint hits into a read of the checkpoint key.
**Files touched:** mcp/server.mjs, test/constraints.mjs, docs/mcp-tools.md, CHANGELOG.md
**Design constraints:** SPEC §3 principle 7, §6 C-04; REVIEW F-02. In checkConstraints, a listed path that is a symlink (lstat) whose fs.realpathSync is not the root or under it is not read; the rule's result gains `skipped: [<path>]` (documented in docs/mcp-tools.md kukulu_verify) and the path never appears in any hit text. A symlink that resolves inside the project keeps today's behavior. Applies in every mode. server-synchronous. CHANGELOG ### Fixed under ## [0.8.0].
**Acceptance tests:** test/constraints.mjs: "a tracked symlink to a file outside the project is not scanned" (a temp file outside the repo holding a secret line, a committed symlink to it, a constraint whose pattern matches the secret; kukulu_verify's results contain no hit with that text and the rule lists the symlink under skipped); "a symlink inside the project is still scanned".
**Out of scope:** Other tools' reads; the similarity scorer's side walk (a note in REVIEW).
**Verification:** kukulu_verify.
**Depends on:** none

### R1-03: Behind the sandbox, run the plugin's verifier, never one from the project tree

**Goal:** Under KUKULU_SANDBOX, kukulu_similarity's control-bundle check and kukulu_attest's self-check run the plugin's own scripts/verify-attestation.mjs with the same arguments, so no script the box can write runs on the host.
**Files touched:** mcp/server.mjs, test/sandbox.mjs, docs/mcp-tools.md, docs/sandbox.md, CHANGELOG.md
**Design constraints:** SPEC §3 principle 7, §6 C-04, B-02; REVIEW F-03. verifyControlBundle (mcp/server.mjs:3730) and attest's verify run (mcp/server.mjs:4059) use path.join(PLUGIN_ROOT, "scripts", "verify-attestation.mjs") when envVar("SANDBOX") is set; without it nothing changes (SPEC B-02 as written). Refusal texts unchanged. server-synchronous. Docs: docs/mcp-tools.md kukulu_similarity and kukulu_attest say which verifier runs behind the sandbox; docs/sandbox.md What runs where. CHANGELOG ### Fixed under ## [0.8.0].
**Acceptance tests:** test/sandbox.mjs: "behind the sandbox a control bundle's own verify.mjs never runs" (a control bundle built with buildBundle whose verify.mjs is replaced by a script that writes a marker file and prints a passing JSON verdict; with KUKULU_SANDBOX set kukulu_similarity refuses with `the positive pair's control bundle ... does not verify as a positive control` and the marker does not exist; without KUKULU_SANDBOX the bundle's own script runs, as SPEC B-02 says); "behind the sandbox kukulu_attest checks the bundle with the plugin's verifier" (prove which file ran, for example with a temp plugin copy whose verifier records its own path, per CLAUDE.md's clean-room tests protocol).
**Out of scope:** Changing B-02 outside the sandbox; publish-bundle.mjs and compare-bundles.mjs (operator-run scripts).
**Verification:** kukulu_verify.
**Depends on:** none

### R1-04: --expect control-positive still prints CONTROL (positive)

**Goal:** A passing control bundle prints `verify-attestation: CONTROL (positive)` as its last line whether or not --expect control-positive is given; only the exit status differs (3 without, 0 with), as SPEC B-01 says.
**Files touched:** scripts/verify-attestation.mjs, test/attest.mjs, docs/cleanroom.md, CHANGELOG.md
**Design constraints:** SPEC §6 B-01, PLAN P1-02; REVIEW F-08. verifier-node-only; the verifier keeps its duplicated code. A clean-room bundle still prints PASS. --json output and exit codes unchanged. docs/cleanroom.md:87 describes the corrected output. If test/fixtures/bundles/ holds a verify.mjs copy, leave the recorded bundle's bytes alone.
**Acceptance tests:** test/attest.mjs: the "...printing PASS" assertion becomes "...and 0 with --expect control-positive, still printing CONTROL (positive) as the last line"; a clean-room bundle with --expect clean-room prints PASS.
**Out of scope:** Exit codes; --json; publish-bundle.mjs's VERIFY.txt.
**Verification:** kukulu_verify.
**Depends on:** none

### R1-05: Test the sandbox mechanics SPEC names: box source, lockdown on sandbox.egress, stop, tag-only image

**Goal:** test/sandbox.mjs covers four mechanics of scripts/sandbox.mjs that no test catches today: the log socket's source box wins over a box-supplied source, sandbox.egress hosts are denied after lockdown, stop signals the run.json pid, and run refuses a tag-only image with nothing started.
**Files touched:** test/sandbox.mjs, scripts/sandbox.mjs
**Design constraints:** SPEC §6 C-01 test list ("run refuses a tag-only image"), C-02 ("every entry it could add carries source: box"), C-03 ("the last two hold only until lockdown"), PLAN P2-06 (stop); REVIEW F-04. Change scripts/sandbox.mjs only if a test shows a defect. Recorded docker data stays in test/fixtures/docker/.
**Acceptance tests:** test/sandbox.mjs: "the log socket marks a box entry source box even when the box sends another source" (send data.source controller; the appended entry has box); "sandbox.egress hosts are denied after lockdown" (egressDecision with lockdown true, reason lockdown is active); "stop signals the pid in run.json" (a sleeping child's pid in run.json; after main(["stop"]) the child has exited on SIGTERM and run.json is gone); "run refuses a tag-only image with nothing started" (policy image without @sha256, exit 1, the loadPolicy message on stderr, no run line in calls.log). Each would fail against the mutants listed in REVIEW F-04.
**Out of scope:** Behavior changes beyond a defect a new test exposes.
**Verification:** kukulu_verify.
**Depends on:** R1-01

### R1-06: Test the git -c options and the runner part of routing, fix the cache crate name, correct kukulu_next's docs

**Goal:** The server's untested C-04 and A-02 mechanics get tests, gate check 10 recognizes a pre-release crate directory, and docs/mcp-tools.md stops calling kukulu_next read-only.
**Files touched:** mcp/server.mjs, test/sandbox.mjs, test/cleanroom.mjs, docs/mcp-tools.md, CHANGELOG.md
**Design constraints:** SPEC §6 C-04 ("a commit runs with the two -c options"), A-02 part 1 (model and runner), C-07, §3 principle 10; PLAN P2-11 (the crate is the part before the last -<digit...>); REVIEW F-05. The crate regex at mcp/server.mjs:284 takes the part before the last `-<digit>` segment, so flate2-1.0.0-rc.1 is flate2. docs/mcp-tools.md:5: two read-only tools, and kukulu_next writes only the stage timeline (and the wave record). server-synchronous. CHANGELOG ### Fixed under ## [0.8.0] for the crate name.
**Acceptance tests:** test/sandbox.mjs: "a commit inside the sandbox turns the repository's fsmonitor off" (a repo-local core.fsmonitor naming a script that writes a marker and exits 1; kukulu_plan_commit under KUKULU_SANDBOX leaves no marker, and without KUKULU_SANDBOX the marker appears); "gate check 10 fails on a denied crate at a pre-release version in the sandbox cache" (exec-output lists flate2-1.0.0-rc.1). test/cleanroom.mjs: "changing a role's runner after genesis fails the gate's routing check" (same model string, the global runners moved so its prefix belongs to another runner; kukulu_next halts with `routing changed since genesis` and the failing gate entry is in the chain).
**Out of scope:** Other gate checks; the timeline's commit policy.
**Verification:** kukulu_verify.
**Depends on:** R1-05

### R1-07: Test the control-path symlink rule and the lockfile sub-table rule

**Goal:** test/cleanroom.mjs kills the two surviving mutants in mcp/cleanroom.mjs: isControl requiring every canonical form under control.priorArt, and the TOML reader ending a [[package]] block's own keys at a later table header.
**Files touched:** test/cleanroom.mjs, test/fixtures/lockfiles/
**Design constraints:** REVIEW F-06; SPEC §6 B-01, C-07; PLAN P1-01 and P2-11 interpretations. A lockfile fixture added under test/fixtures/lockfiles/ keeps the README's statement that the files are hand-written minimal forms (a subdirectory if the basename must be poetry.lock or Cargo.lock). No change to mcp/cleanroom.mjs unless a test shows a defect.
**Acceptance tests:** test/cleanroom.mjs: "a symlink under control.priorArt that resolves to a deny.paths file outside it is still denied in control mode" (evaluate on a temp root with prior/link -> ../secret/zlib.c, deny.paths ["secret/"], control.priorArt ["prior/"]); "a sub-table after a [[package]] does not overwrite the package's name or version" (a [package.metadata]-style table holding name = "other" after the block; lockfilePackages returns the block's own name and version).
**Out of scope:** Other guard rules; other lockfile forms.
**Verification:** kukulu_verify.
**Depends on:** none

### R1-08: Test publish-bundle --check's integrity checks and escape the literal characters

**Goal:** publish-bundle.mjs --check's checks of SHA256SUMS (an unlisted file, a listed file that is missing, a malformed line, a missing SHA256SUMS) are tested, and the scripts write the macron letter and the em dash as Unicode escapes.
**Files touched:** scripts/publish-bundle.mjs, scripts/compare-bundles.mjs, test/bundles.mjs
**Design constraints:** SPEC §6 B-03 ("checks SHA256SUMS"), PLAN P1-04 (every file but SHA256SUMS and VERIFY.txt is listed; the macron letter written as the Unicode escape of U+016B), PLAN P3-04 (the em dash written as its escape), CLAUDE.md v0-8-0 notes; REVIEW F-07. scripts/publish-bundle.mjs:66 and scripts/compare-bundles.mjs:12 use escapes; output bytes unchanged (VERIFY.txt and test/fixtures/compare/expected.txt stay byte-identical). scripts-node-builtins.
**Acceptance tests:** test/bundles.mjs: "--check fails on a file not listed in SHA256SUMS, naming it"; "--check fails on a listed file that is missing"; "--check fails on a malformed SHA256SUMS line"; "--check fails cleanly when SHA256SUMS is missing" (exit 1, the message, no stack trace); "publish-bundle.mjs and compare-bundles.mjs hold no literal macron letter or em dash" (read the files, assert neither character appears); the existing VERIFY.txt and expected.txt assertions still pass.
**Out of scope:** Publishing behavior; the verifier.
**Verification:** kukulu_verify.
**Depends on:** none

## Review fixes (round 2)

### R2-01: The constraint scan never reads a file reached through a symlinked directory that leaves the project

**Goal:** kukulu_verify's constraint scan resolves the real path of every listed file, not only of a path that is itself a symlink, so a tracked file under a directory that was swapped for a symlink to a host directory is never read and its content never appears in a hit (REVIEW round 2 F-01; completes R1-02).
**Files touched:** mcp/server.mjs, test/constraints.mjs, docs/mcp-tools.md, CHANGELOG.md
**Design constraints:** SPEC §3 principle 7, §6 C-04; REVIEW round 2 F-01. In checkConstraints (mcp/server.mjs, around line 3295) compute fs.realpathSync(full) for every listed file that exists; when it is neither the real root nor under it (realRoot + path.sep), push the file to skippedLinks and continue without reading. Read the resolved path you checked, not the original, so the check and the read agree. A file whose real path stays inside the project is scanned as before, so the existing inside-link case keeps passing. server-synchronous (no async/await). docs/mcp-tools.md kukulu_verify Returns: the sentence 'A listed path that is a symlink whose real path lies outside the project is never read' becomes one that covers a file reached through a symlinked directory too. CHANGELOG: amend the existing R1-02 line under ## [0.8.0] ### Fixed (do not add a new heading).
**Acceptance tests:** test/constraints.mjs: "a tracked file reached through a symlinked directory that leaves the project is not scanned": commit src/keys/secret.js (a dummy line), then remove src/keys and replace it with a symlink to a temp directory outside the repo holding secret.js with console.log('top-secret');. kukulu_verify's constraint result contains no hit whose text includes top-secret, and its skipped list includes src/keys/secret.js. Against the current code this case fails (the server returns the hit, as REVIEW round 2 F-01 reproduced). The existing cases "a tracked symlink to a file outside the project is not scanned" and "a symlink inside the project is still scanned" still pass.
**Out of scope:** Other outside reads (packagesCheck, kukulu_attest's documents and lockfiles, the similarity scorer); they are listed under Spec issues in REVIEW.md. The unreachable /run/kukulu writable message (a note).
**Verification:** kukulu_verify
**Depends on:** none
