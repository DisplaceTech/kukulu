# Kūkulu 0.8.0 — Specification

Version: 0.8.0 Status: approved by the owner for the flight

The Kūkulu planner reads this file in full and derives the build plan from it. The 0.7.2 spec is archived unchanged at [flights/v0-7-2/SPEC.md](flights/v0-7-2/SPEC.md), and the 0.7.0 spec, which defined clean-room mode, at [flights/v0-7-0/SPEC.md](flights/v0-7-0/SPEC.md); ids written `0.7.0 D-08` or `0.7.2 B-03` refer to them. The plugin running this flight is the installed 0.7.2. The flight edits the working tree, and nothing it changes affects the server running the flight.

0.7.x proved the evidence chain: the hash-chained log, signed checkpoints, the gate, the signed bundle and the Node-only offline verifier. Reviewers of a clean-room claim press on three things the chain alone cannot answer, and this release answers each:

1. **Enforcement.** Was the prior art absent, or only denied by a hook? A sandbox backend runs the harness inside a container with no network of its own, with the controller and the signing key outside it, and the bundle states which enforcement level it was built under (C).
2. **Independence from frontier APIs.** Can it run air-gapped? A flight can declare that every role runs on a local runner, the gate holds it to that, and the bundle records which model ran each role and how its identity is known (A).
3. **Evidence beyond n=1, with calibrated controls.** A positive-control flight mode produces a bundle that can never pass as clean-room and feeds the contamination score as its positive pair (B), and a comparison script sets two bundles side by side, timing and token use included (D).

## Recommendation on size

This is the largest flight since 0.7.0 (98 tasks, 11 review rounds). Keep it to one flight (`flight=v0-8-0`), five phases, all serial. 0.7.1 principle 1 (the guard is a tripwire) carries over as principle 1 below: a guard finding outside C-08 is a known-gap candidate, not a fix task, and with the sandbox in place the guard's gaps stop mattering for reads at the higher enforcement level, which is the point of this release. Every requirement below names its module, its refusal text and its tests. Where a requirement needs a real container, a real local model or a second machine, the test that CI can run uses a fake, and the real run is a phase-end manual check.

## 1. Overview

Kūkulu is a Claude Code plugin. A dependency-free MCP server (`mcp/server.mjs`) holds the mechanics, and the skills (`skills/*/SKILL.md`) hold the judgment. Release 0.8.0 covers goals G-01 to G-10 of the owner's 0.8.0 strategy notes, the `kukulu_release` tool that 0.7.2 left for this release, and the friction and known-gap candidates the 0.7.2 flight logged.

Done means:

- every requirement in §6 has its tests;
- `npm run lint`, `pre-commit run --all-files`, `npm test`, `npm run check:site` and the guard self-test pass;
- the version reads 0.8.0 everywhere;
- a pull request is open against `main` and marked ready, not set to auto-merge (§5.1).

**Why a minor version.** One tool is added (`kukulu_release`, E-01), and the policy, the log and the bundle gain optional fields that an older plugin does not understand. Nothing an existing project relies on changes meaning:

- A policy without the new keys loads and behaves exactly as under 0.7.2. Every new key is optional, and its default is 0.7.2's behavior.
- A 0.7.x bundle verifies under the 0.8.0 verifier as enforcement level `hook`, with no routing record.
- The manifest's `version` stays `1`. Every field it gains is additive, and `version: 2` is reserved for 0.9.0's lineage format.
- A clean-room flight started on 0.7.x cannot continue on 0.8.0, because `hooks/hooks.json` and the hook scripts change and gate check 3 pins them. That has been true of every release with a guard change, and the CHANGELOG says so under Changed.

The CHANGELOG has no "Breaking changes" heading, so under 0.7.2 C-03 this flight's PR is not breaking.

**Patent note.** Two mechanisms go beyond U.S. Provisional Application No. 64/178,095 and are marked ⚠️ NEW MATTER where they are specified: model identity by weight-file digest, with API identity marked vendor-asserted (A-03), and the enforcement level as a verifier policy input with known limits per level (C-06). Both are published by this release on purpose; neither blocks anything. Write "patent pending", never "patented".

## 2. Goals and non-goals

- Goal: each role's model resolves to a declared runner, and the bundle records it (A-01).
- Goal: a policy can require that every role runs on a local runner, and the gate fails a flight that does not (A-02, G-01).
- Goal: genesis and the manifest record each role's model identity, measured for local models and vendor-asserted for API models (A-03, G-02).
- Goal: a policy can require that the implementer and the reviewer differ by model, or by model family (A-04, G-03).
- Goal: a positive-control flight produces a bundle that verifies as `CONTROL (positive)` and never as a clean-room pass (B-01, G-04).
- Goal: a verified control bundle is the contamination score's positive pair, by reference (B-02, G-04).
- Goal: a bundle can be published with its signer's fingerprint and re-verified from the published copy (B-03, G-05).
- Goal: a clean-room flight can run its harness inside a container with no network of its own, whose only door is a logging egress proxy, with the controller and the checkpoint key outside it (C-01 to C-05, G-06).
- Goal: the manifest states the enforcement level, the verifier can require one, and the known limits shrink at the higher level (C-06, G-07).
- Goal: package caches live inside the boundary, prior-art packages are kept out of the lockfiles and the caches, and the lockfiles' packages are listed as outside the claim (C-07, G-08).
- Goal: the 0.7.2 known-gap candidates are closed (C-08).
- Goal: the log records when each stage started and ended, and each role's token use (D-01, D-02, G-10).
- Goal: a script compares two bundles and, given both result trees, scores them against each other (D-03, G-09).
- Goal: a merged flight is tagged and released by a tool, not by hand (E-01).
- Goal: a base that already fails the last flight's constraints is reported before planning (E-02).
- Non-goal: completing the guard's parser. Principle 1 stands.
- Non-goal: kernel-level file audit, the two-team clean room, lineage across flights and standards packaging (strategy G-11 to G-14). They are 0.9.0's, and nothing in this flight builds any part of them. The verifier knows the name of the level `container+proxy+audit` only so that its ordering is fixed (C-06).
- Non-goal: a hosted verifier, a registry, or anything server-side.
- Non-goal: native OpenCode or Codex plugins. Running another harness inside the C-01 boundary is the harness-agnostic path, and this flight runs only Claude Code there.
- Non-goal: TLS interception in the egress proxy. It decides on host and port only (C-03), and the known limit says so.
- Non-goal: Apple's `container` runtime, Docker Desktop on macOS and Windows. macOS is supported by running the whole sandbox inside a Linux VM (C-01).
- Non-goal: background jobs for long verify commands (cleanflate F-13, F-28). Still deferred.
- Non-goal: signing the log's uncommitted tail. It is new matter and stays out of scope.
- Non-goal: any change under `site/` or `docs/site/`. A site change for the published sample bundle goes through `docs/site/copy-changes.json` after the flight, by the owner.

## 3. Engineering principles

Each is checkable by grep or test. Those marked `[rule:<id>]` are `constraints` in `docs/kukulu.json`. The rest are checked by the reviewer, by reading.

1. **The guard is a tripwire, not a sandbox.** 0.7.1 principle 1, carried over as written, with its triage rule: a guard finding becomes a fix task only when it is a regression, writes a protected path or reads under `deny.paths` with a command word and option spelling these rules or the fixture set already name, or is a whole command word missing from a rule. Every other unmodelled spelling goes under REVIEW.md's `## Spec issues` → `Known-gap candidates`. After C-08 lands, "already name" includes `--remove-sent-files` and `pax`.
2. **Mechanics live in the server, judgment in the skills.** Resolving runners, checking role separation, recording identity, verifying the control bundle, wrapping verify commands in the boundary, recording stage timing and token use, and tagging a release are server or script changes with tests, never skill sentences.
3. **Every server behavior change has a test** in the suite that owns the tool (CONTRIBUTING.md's table). If no row names the tool or script, the task adds the row. Every new refusal has a test that triggers it and asserts its message. Every guard change has deny and allow cases in `test/fixtures/guard-cases.json`, with names ending in `(<task id>)`. Every new gate check has a passing case and a failing case whose failing gate entry is asserted in the chain.
4. **Tools validate, then mutate.** A refusal comes before any file is written, and a tool whose final commit fails leaves the tree as it found it. The gate's own failing entry stays the one sanctioned write before a refusal.
5. **Config never silently defaults a bad value.** Every new key in the policy, the global config and `docs/kukulu.json` is validated with an unknown-key refusal and a refusal for every bad shape, like `loadPolicy` and `validateCleanroom` do today.
6. **No guard fixture changes its decision unless a task names it.** As in 0.7.2 principle 6. The reviewer checks with `git diff <merge-base>..HEAD -- test/fixtures/guard-cases.json`.
7. **The controller and the checkpoint key stay outside the boundary.** Under `container+proxy`, nothing inside the container can read the Ed25519 private key, write `.kukulu/`, the policy file, `.claude/`, `.git/config`, `.git/hooks` or `.git/info`, or reach the network except through the proxy. The container is started with no network (`--network none`), never privileged, with no added capability, never with the host's PID namespace and never with the engine's socket mounted `[rule:sandbox-network-none]` `[rule:sandbox-no-escape-flags]`.
8. **The server stays synchronous.** `mcp/server.mjs` and `mcp/cleanroom.mjs` stay free of `async` and `await` `[rule:server-synchronous]`. Socket and proxy code lives in `mcp/relay.mjs` and `scripts/sandbox.mjs`, which the server reaches only through `spawnSync`.
9. **Every constraint in `docs/flights/v0-7-2/kukulu.json` carries over unchanged**, including the site rules and `progress-no-bare-macron`. Three are added (§5.4).
10. **Documentation moves with the code.** A task that changes a tool's behavior updates `docs/mcp-tools.md` in the same commit; one that changes a guard rule or a gate check updates `docs/cleanroom.md`; one that adds or changes a config key or default updates `docs/operations.md`, or `docs/routing.md` for the global file.
11. **Error messages are written for a model**: say what is wrong and what to do instead. Comments explain why.
12. **No dependencies anywhere**, and tests never depend on an untracked file. Recorded `docker`, `gh`, transcript and proxy data lives in `test/fixtures/`, never inline in a `test/*.mjs`. The container image template installs Claude Code inside the image; that is the image's content, not a dependency of Kūkulu, and `package.json` gains nothing.
13. **Tests never need a container engine, a GPU or a second machine.** Every test in `npm test` runs with a fake `docker` (a script in a temp directory that records its arguments and answers from `test/fixtures/docker/`), an in-process proxy and fake runners. One integration suite step runs a real container only when `KUKULU_SANDBOX_IT=1` and `docker` is on `PATH`, and prints `sandbox integration: skipped (set KUKULU_SANDBOX_IT=1 with docker on PATH)` otherwise.

## 4. Architecture

New files:

| Path | Responsibility |
|---|---|
| `mcp/relay.mjs` | Inside the boundary: pipes the MCP server's stdio to the controller socket and back. May use `async`; imports only `node:` modules |
| `scripts/sandbox.mjs` | The launcher and the controller host: `doctor`, `run`, `stop`. Starts the controller socket, the log socket and the egress proxy outside the container, then the container. Imports only `node:` modules and `../mcp/cleanroom.mjs` |
| `scripts/sandbox-entry.mjs` | The container's entrypoint: the loopback-to-socket proxy bridge, then `exec`s the harness. `node:` imports only |
| `scripts/model-identity.mjs` | Run on an inference host: hashes weight files into one digest. `node:` imports only |
| `scripts/publish-bundle.mjs` | Verifies a bundle and writes a publishable copy, or re-verifies a published one. `node:` imports only |
| `scripts/compare-bundles.mjs` | Compares two bundles, and optionally scores their result trees. Imports only `node:` modules and `../mcp/cleanroom.mjs` |
| `templates/sandbox/Containerfile` | The container image the sandbox runs: Node 22, git, Claude Code, an unprivileged `kukulu` user |
| `templates/cleanroom.local-only.example.json` | A worked local-only, sandboxed policy (§5.2) |
| `test/sandbox.mjs` | The `sandbox` suite: C-01 to C-07 |
| `test/bundles.mjs` | The `bundles` suite: B-03 and D-03 |
| `docs/sandbox.md`, `docs/publishing.md` | How to run a sandboxed flight; how to publish a bundle |

Changed:

| Path | Changes |
|---|---|
| `mcp/cleanroom.mjs` | `loadPolicy`'s new keys (§5.2); `KINDS` gains `egress`, `stage` and `usage`; `MODEL_FAMILIES` and `familyOf` (A-04); `KNOWN_LIMITS` as objects and `knownLimitsFor` (C-06); the package parsers (C-07); C-08's guard rules; `summarizeEntries` counts the new kinds |
| `mcp/server.mjs` | runner resolution and the global `runners` key (A-01); gate checks 8 to 10 (A-02, A-04, C-01, C-07); genesis and the manifest (A-03, B-01, C-06, C-07); the relay hand-off at startup (C-02); `runShell` and the mutate runner inside the boundary (C-04); signing under the boundary (C-05); the control pair in `kukulu_similarity` (B-02); `stage` entries from `kukulu_next` (D-01); `kukulu_release` (E-01); base health in `kukulu_next` (E-02) |
| `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs` | the log socket (C-02); `SubagentStop` usage entries (D-02) |
| `scripts/verify-attestation.mjs` | control mode and `--expect` (B-01); `--require-enforcement` and the enforcement checks (C-06); the new kinds in the chain and recounts (D-01, D-02) |
| `hooks/hooks.json` | `SubagentStop` also runs `cleanroom-log.mjs` (D-02) |
| `skills/go-flight/SKILL.md` | the release options (E-01) |
| `test/run.mjs` | registers `sandbox` and `bundles`: fifteen suites |

`run-command.mjs` and the implement guard do not change. `scripts/verify-attestation.mjs` stays `node:`-only `[rule:verifier-node-only]`, and its duplicated chain and signature code stays duplicated on purpose; the new `knownLimitsFor` table is duplicated the same way, and `test/attest.mjs` feeds both copies the same levels and asserts identical lists.

The boundary, drawn:

```text
host (outside)                                   container (inside, --network none)
──────────────                                   ──────────────────────────────────
scripts/sandbox.mjs ── spawns ──▶ docker run ──▶ scripts/sandbox-entry.mjs
 ├ controller.sock ◀────────────────────────────── mcp/server.mjs → mcp/relay.mjs  (MCP)
 │   └ spawns node mcp/server.mjs per connection   (KUKULU_CONTROLLER_SOCKET set)
 │       (KUKULU_SANDBOX=<container name>)
 ├ log.sock ◀──────────────────────────────────── cleanroom-guard.mjs, cleanroom-log.mjs
 │   └ appendEntry(.kukulu/cleanroom/log.jsonl)   (KUKULU_LOG_SOCKET set)
 └ proxy.sock ◀── 127.0.0.1:3128 bridge ◀──────── claude, a router, git, cargo …
     └ CONNECT host:port, allowlist, egress entries   (HTTPS_PROXY=http://127.0.0.1:3128)
checkpoint key, git signing, verify-command wrapping (docker exec), similarity: outside only
```

## 5. Data and configuration

### 5.1 `docs/kukulu.json`

No key is added. This flight's own `docs/kukulu.json` sets `policies: { "archive": true, "finalize": "ready" }`: the HANDOFF's first line asks for a live sandboxed run before merging, so finalize marks the PR ready and never enables auto-merge. The running 0.7.2 server knows both keys. `baseBranch` is `main`, and build branches are `build/<date>`.

### 5.2 `docs/cleanroom.json` (the policy)

The schema stays `version: 1`. These keys are added, all optional; with none of them the policy means what it meant under 0.7.2. `loadPolicy` validates each, refuses an unknown key under each object, and fills the defaults shown:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `"clean-room"` or `"control-positive"` | `"clean-room"` | B-01. The flight's kind; recorded in genesis and the manifest |
| `control.priorArt` | array of paths | none | B-01. Required, non-empty, exactly when `mode` is `"control-positive"`, and refused otherwise. The prior art the control flight is given; repo-relative, absolute or `~` |
| `runners.allow` | array of runner names | any runner | A-02. A role resolving to a runner not in the list fails gate check 8 |
| `runners.locality` | `"local"` or `"any"` | `"any"` | A-02. `"local"` fails gate check 8 for any role whose runner is not `local` |
| `roles.distinct` | `"none"`, `"model"` or `"family"` | `"none"` | A-04. How the implementer and the reviewer must differ |
| `enforcement` | `"hook"` or `"container+proxy"` | `"hook"` | C-01, C-06. The level the flight must run under; `container+proxy+audit` is refused here as `0.9.0's level; this release cannot run it` |
| `sandbox.image` | string `<name>@sha256:<64 hex>` | none | C-01. Required exactly when `enforcement` is `"container+proxy"`, refused otherwise. An image named by tag alone is refused |
| `sandbox.mounts` | array of `{ path, mode: "ro" }` | `[]` | C-01. Extra read-only mounts, such as a prebuilt oracle binary. `mode` must be `"ro"`; the project is the only read-write mount |
| `sandbox.egress` | array of `host:port` | `[]` | C-03. Hosts the proxy allows besides the flight's runner endpoints, until lockdown |
| `deny.packages` | `{ cargo?, npm?, pypi? }`, each an array of names | `{}` | C-07. Prior-art packages that no lockfile or cache may contain |

The planner never writes the policy: the owner commits it on the base branch before the flight, as today. `templates/cleanroom.local-only.example.json` is a worked policy using every new key, for the cleanflate rebuild:

```json
{
  "version": 1,
  "mode": "clean-room",
  "runners": { "allow": ["spark", "mac"], "locality": "local" },
  "roles": { "distinct": "family" },
  "enforcement": "container+proxy",
  "sandbox": {
    "image": "kukulu-sandbox@sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "mounts": [{ "path": "tools/oracle", "mode": "ro" }],
    "egress": []
  },
  "deny": {
    "network": true,
    "words": ["zlib", "miniz", "flate2", "libdeflate", "libz-sys", "libz_sys", "zopfli"],
    "packages": { "cargo": ["flate2", "miniz_oxide", "libz-sys", "zlib-rs", "libdeflater"] }
  },
  "allow": { "paths": ["crates/cleanflate/", "docs/"], "urls": ["https://www.rfc-editor.org/rfc/rfc1951.txt"] },
  "lockdown": { "after": "P0-10" },
  "protected": ["tools/"]
}
```

The template's image digest is all zeros on purpose, and `docs/sandbox.md` says to replace it with the digest `node scripts/sandbox.mjs doctor` prints for the image the owner built. `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json` passes, and that command joins the guard self-test's `extraVerify` entries (§7).

### 5.3 The global file (`~/.config/kukulu/config.json`)

`GLOBAL_KEYS` gains `runners`. A runner is a place a model is served from. It lives in the global file, not in `docs/kukulu.json`, because endpoints are facts about one person's machines:

```json
{
  "runners": {
    "spark": {
      "endpoint": "http://spark.tail1234.ts.net:8000",
      "locality": "local",
      "match": ["spark/"],
      "identities": {
        "spark/nemotron-3.5-super-nvfp4": { "weights": "sha256:<64 hex>", "image": "sha256:<64 hex>" }
      }
    },
    "mac": { "endpoint": "http://mac.tail1234.ts.net:11434", "locality": "local", "match": ["mac/"] }
  }
}
```

| Key | Type | Meaning |
|---|---|---|
| `runners.<name>` | object | `<name>` is a slug (`/^[a-z0-9][a-z0-9-]{0,39}$/`); `anthropic` is reserved and refused |
| `.endpoint` | `http(s)://host[:port]` | Where the runner serves; the port defaults by scheme. A path, query or credentials in it are refused |
| `.locality` | `"local"` or `"remote"` | Whether the endpoint is the operator's own hardware |
| `.match` | non-empty array of strings | Prefixes of a role's model string. Two runners sharing a prefix are refused |
| `.identities` | object | Optional. Exact model string → `{ weights, image? }`, each `sha256:<64 hex>`, from `scripts/model-identity.mjs` (A-03) |

Every validation failure names the key path, as `validateGlobal` does today.

### 5.4 Constraints

The 28 constraints in `docs/flights/v0-7-2/kukulu.json` carry over unchanged (principle 9). Three are added:

- `sandbox-network-none` (from the task that creates `scripts/sandbox.mjs`): in `scripts/sandbox.mjs`, no `--network`, `--net` or `--network=` followed by anything but `none`, in either the `"--network", "x"` or the `"--network=x"` form. The planner writes the fixtures for all four shapes.
- `sandbox-no-escape-flags` (same activation): in `scripts/sandbox.mjs`, no `--privileged`, `--cap-add`, `--pid=host`, `--pid", "host"`, `--security-opt", "seccomp=unconfined`, `docker.sock` or `podman.sock`.
- `relay-not-in-server` (from the task that creates `mcp/relay.mjs`): `mcp/server.mjs` never imports `node:net`, `net` or `./relay.mjs`. It reaches the relay only through `spawnSync`.

`server-synchronous`, `cleanroom-module-pure`, `hooks-lazy-cleanroom`, `scripts-node-builtins`, `verifier-node-only`, `one-hash-one-signature` and `no-foundry-names` keep their paths. The new scripts fall under `scripts-node-builtins`, and `scripts/sandbox.mjs` and `scripts/compare-bundles.mjs` import `../mcp/cleanroom.mjs`, which that rule's sibling clause already allows.

### 5.5 Tunables

| Value | Where | Status |
|---|---|---|
| `MODEL_FAMILIES`' initial contents (A-04) | `mcp/cleanroom.mjs` only | ⚠️ ASSUMPTION: a table of family patterns, measured against the routing strings real flights use |
| Hook round trip over the log socket: 100 ms per call | `test/sandbox.mjs` only | ⚠️ ASSUMPTION, budgeted like the 50 ms hook budget in `test/cleanroom.mjs`; measured by C-02's spike |
| `LOG_SOCKET_TIMEOUT_MS = 2000` | `mcp/cleanroom.mjs` only, exported | ⚠️ ASSUMPTION: how long a hook waits for the log socket before it fails closed |
| Proxy overhead per connection | measured only | C-03's spike records it in `docs/spikes/<ID>.md`; no default depends on it |

The remaining ⚠️ ASSUMPTION defaults from 0.7.2 stay where they are, unchanged.

## 6. Interfaces

### A — Routing and identity

#### A-01 — runners

Today a role resolves to a model string, and Kūkulu knows nothing about where it is served. From now on each role also resolves to a runner:

- An Anthropic model (`isAnthropicModel`: a known alias or a `claude-*` id) resolves to the built-in runner `anthropic`: endpoint `https://api.anthropic.com`, locality `remote`.
- Any other model string resolves to the configured runner whose `match` has the longest prefix of it.
- A model string that matches nothing resolves to runner `null`, and its locality is `unknown`.

`resolveRouting` returns `runner`, `endpoint` and `locality` per role. `kukulu_config_show` reports them with their source, and `kukulu_agents_sync`'s table gains a `runner` column after `model`. In general mode nothing else changes: an unrouted model is legal, as today.

Tests in `test/routing.mjs`: the built-in runner for `opus` and a `claude-*` id; the longest prefix wins; an unmatched string gives `null`; each validation refusal in §5.3 (bad name, reserved name, endpoint with a path, duplicate prefix, bad identity digest).

#### A-02 — the local-only gate (G-01)

Gate check 8, `routing`, runs in clean-room mode after check 7. It has three parts, and the first failing one stops it:

1. **Same routing as genesis.** Every role's resolved `model` and `runner` equal the ones genesis recorded (A-03). The reason is `routing changed since genesis: <role> now resolves to <model> on <runner> (genesis: <model> on <runner>); restore the routing, or archive this flight and start another`.
2. **Allowed runners.** When the policy has `runners.allow`, every role's runner is in it: `<role> resolves to runner <runner>, which policy runners.allow does not name (<list>)`.
3. **Locality.** When the policy's `runners.locality` is `"local"`, every role's locality is `local`: `<role> resolves to <model> on runner <runner> (locality <locality>); a local-only flight needs every role on a local runner. Route it to one in ~/.config/kukulu/config.json, or set runners.locality to "any"`.

Genesis runs parts 2 and 3 before it writes anything (part 1 has nothing to compare yet), so a flight that is not local-only from the start refuses at its first `kukulu_next` with nothing in the log.

Under enforcement `hook` this claim is configuration-asserted: the gate checks what routing says, not where requests went. The manifest says so (`roles.assurance: "configuration"`, A-03). Under `container+proxy`, C-03's egress check makes it a fact, and `roles.assurance` is `"egress"`.

Tests in `test/cleanroom.mjs`, with a temp global config through `KUKULU_CONFIG`: a local-only policy with every role on fake local runners passes; the default routing (all `anthropic`) fails part 3 at genesis with nothing written; a runner outside `runners.allow` fails part 2; changing a role's model after genesis fails part 1 at the next `kukulu_next`, with the failing gate entry in the chain.

#### A-03 — model identity in the evidence (G-02) ⚠️ NEW MATTER

Genesis's `data` gains `roles`: for each of the four roles, `{ model, runner, endpoint, locality, identity }`. `identity` is one of:

- `{ source: "operator-measured", weights, image? }` when the runner's `identities` names the model string. The digests are copied from the global file.
- `{ source: "vendor-asserted" }` for the `anthropic` runner. The vendor's API is the only witness to which model served a request.
- `{ source: "none" }` otherwise.

`scripts/model-identity.mjs` is how a digest is measured. It runs on the inference host, where the weights are, because the controller usually cannot read them:

```text
node scripts/model-identity.mjs <file-or-dir>... [--image sha256:<64 hex>] [--json]
```

It walks each directory (files only, symlinks resolved, sorted by path relative to the argument it came from), hashes every file with SHA-256, and prints one `<sha256>  <relative path>` line per file and then `weights: sha256:<hex>`. The digest is the SHA-256 of those lines, joined with `\n` and ending in `\n`, so anyone with the same files gets the same digest. `--image` is copied into the output as given. `--json` prints `{ files, weights, image }`. A missing path exits 2 with the path named. The script never writes a file.

The manifest gains `roles`: genesis's roles, plus, for each role, the distinct model names its endpoint reported in D-02's `usage` entries (`reported`), and `assurance` (`"configuration"` or `"egress"`, A-02). When a role's `reported` list names a model other than the routed one, the verifier prints `verify-attestation: note: <role>: the endpoint reported <names>; routing declared <model>`. That is a note, not a failure, because routers and APIs report names in their own forms.

Tests: `test/cleanroom.mjs` asserts genesis's `roles` for each identity source; `test/bundles.mjs` runs `model-identity.mjs` on a fixture directory and asserts the per-file lines and the digest against values recorded in `test/fixtures/identity/expected.txt`, and that the order of arguments does not change the digest for the same tree.

#### A-04 — role separation (G-03)

The policy's `roles.distinct` is checked by gate check 8, after part 3, and by genesis before it writes:

- `"model"`: the implementer's and the reviewer's model strings must differ after normalization (lowercase, any `provider/` or `provider,` prefix removed). Reason: `the implementer and the reviewer both resolve to <model>; policy roles.distinct "model" needs two different models. Route one of them elsewhere`.
- `"family"`: their families must differ. Reason: `the implementer (<model>) and the reviewer (<model>) are both family <family>; policy roles.distinct "family" needs two families`.

`familyOf(model)` in `mcp/cleanroom.mjs` normalizes the string as above and returns the `family` of the first `MODEL_FAMILIES` entry whose pattern matches it. A model that matches none is its own family: the normalized string itself, prefixed `unknown:`. `MODEL_FAMILIES` is ⚠️ ASSUMPTION data: an array of `{ family, pattern }` that starts with `claude` (the Anthropic aliases and `claude-*`), `qwen`, `nemotron`, `mistral` (Mistral and Devstral), `deepseek`, `glm`, `llama`, `gemma` and `gpt`. Genesis records `roles.distinct` and each role's family, so the bundle shows what was compared.

Tests in `test/cleanroom.mjs`: `opus` and `sonnet` pass `"model"` and fail `"family"`; a Qwen model and a Nemotron model pass `"family"`; two unknown strings that differ pass `"family"`; the refusal texts; `familyOf` over a table of routing strings recorded in `test/fixtures/families.json`.

### B — Controls and publishing

#### B-01 — positive-control mode (G-04)

A policy with `mode: "control-positive"` runs a flight that is deliberately given the prior art listed in `control.priorArt`, so its output measures what a contaminated build looks like. Everything else is the same as clean-room mode: the guard runs, the log is chained and signed, the gate runs, and the bundle is written. The differences:

- Genesis `data.mode` is `"control-positive"`, and genesis records `control.priorArt` as written.
- The guard never denies a read of a `control.priorArt` path, even under `deny.paths` or `deny.words`. The protected set is unchanged, because the evidence must be as intact as in a clean-room flight. Under `container+proxy`, each `control.priorArt` path is mounted read-only into the container (C-01).
- The manifest's `mode` is `"control-positive"`.
- Gate check 1 (`mode`) accepts a control flight whose genesis says `control-positive`. Switching `mode` in the policy after genesis is a policy change, and check 2 fails it, as today.

The verifier treats a control bundle as a different verdict, never as a weaker pass:

- A verified control bundle prints `verify-attestation: CONTROL (positive)` as its last line and exits **3**. It never prints `PASS` and never exits 0, unless `--expect control-positive` is given.
- `--expect clean-room|control-positive` makes a bundle of the other mode a failure: `mode: the bundle is <mode>, expected <mode>`. With `--expect control-positive`, a verified control bundle exits 0 and still prints `CONTROL (positive)`.
- `--json` gains `mode`.
- Exit status 2 stays a usage error, and 1 a failure.

Tests in `test/attest.mjs`: a control flight's bundle exits 3 with `CONTROL (positive)`; with `--expect control-positive` it exits 0; a clean-room bundle with `--expect control-positive` fails; a control bundle whose manifest is edited to say `clean-room` fails `signature` and `mode`; a `control.priorArt` read is allowed in control mode and denied in clean-room mode, by a fixture pair in `guard-cases.json`.

#### B-02 — the control bundle is the positive pair

A `cleanroom.similarity` pair with role `positive` may carry `control: "<bundle dir>"`, and only such a pair may. `kukulu_similarity` then, before reading any file:

1. Runs that bundle's own `verify.mjs <dir> --expect control-positive --json`, and refuses unless it passes: `the positive pair's control bundle <dir> does not verify as a positive control: <first reason>`.
2. Reads `git -C <left> rev-parse HEAD` for the pair's `left` directory and refuses unless it equals the control manifest's `repo.head`: `the positive pair's left side <dir> is at <sha>, but the control bundle was made at <sha>; check out the control flight's result there`.
3. Records `control: { manifest: <sha256 of its manifest.json>, head, fingerprint }` on that pair in `similarity.json`.

The pair's `right` side is the prior art itself, as for any positive pair. `validateSimilarity` refuses `control` on a pair whose role is not `positive`, and a `control` that is not a non-empty string. A positive pair without `control` works as today.

Tests in `test/cleanroom.mjs`: a pair referencing a verified control bundle records it; a clean-room bundle as `control` refuses; a head mismatch refuses; `control` on a test pair refuses at config load.

#### B-03 — a publishable bundle (G-05)

```text
node scripts/publish-bundle.mjs <bundle-dir> --key sha256:<fp> --out <dir>
node scripts/publish-bundle.mjs --check <published-dir> --key sha256:<fp>
```

The first form runs the bundle's own `verify.mjs` with `--key` and refuses unless it exits 0, or 3 for a control bundle. It then writes `<out>/<flight>/`:

- a byte copy of every bundle file;
- `SHA256SUMS`, in `sha256sum -c` format, sorted by path;
- `VERIFY.txt`, which states the flight, the mode, the enforcement level, the signer's fingerprint, the exact command `node verify.mjs . --key sha256:<fp>` with that bundle's expected exit status, and one sentence telling the reader to get the fingerprint from somewhere other than this directory.

It refuses before writing when `<out>/<flight>` already exists. The second form re-runs the verifier on a published copy and checks `SHA256SUMS`. Both print one result line and exit 0 on success, 1 on failure and 2 on a usage error. Neither ever uses the network.

`docs/publishing.md` is the procedure:

- build the bundle;
- publish the directory on any static host;
- publish the fingerprint by at least one route other than that host, such as the project README, a signed git tag message, or a DNS TXT record;
- re-check the published copy from a second machine with `--check`.

It says that a kukulu.tech page for a sample bundle is a site change through `docs/site/copy-changes.json`, made after the flight.

Tests in `test/bundles.mjs`, on a bundle the test builds with the fake signer: publish then `--check` passes; a byte changed in the published copy fails `--check`, naming the file; the wrong `--key` refuses; an existing output directory refuses with nothing written.

### C — The sandbox

#### C-01 — the boundary (G-06 L1)

`scripts/sandbox.mjs` is the only way to run a `container+proxy` flight. It runs on Linux with `docker` or `podman` on `PATH`, picked by `--engine docker|podman`, else whichever is found first, in that order. On macOS the operator runs it inside a Linux VM (Lima, OrbStack or colima machines) that holds the project and the checkpoint key. `docs/sandbox.md` says so, and the script refuses on `darwin` with `scripts/sandbox.mjs runs on Linux; on macOS run it inside a Linux VM that holds the project (see docs/sandbox.md)`.

```text
node scripts/sandbox.mjs doctor
node scripts/sandbox.mjs run [-- <harness arguments>]
node scripts/sandbox.mjs stop
```

- **`doctor`** loads the policy and prints: the engine and its version; whether `sandbox.image` exists locally, with its digest; the mounts that `run` would make; the egress allowlist; and the runners every role resolves to. It ends with `sandbox doctor: ok` or one line per problem. When the image is missing, it prints the build command for `templates/sandbox/Containerfile` and the digest line to paste into the policy. It writes nothing.
- **`run`** refuses unless the policy's `enforcement` is `container+proxy`, the image exists with the policy's digest, and no container of this project's name is running. It then starts the three listeners (C-02, C-03) under `$XDG_RUNTIME_DIR/kukulu/<project id>/`, or `~/.cache/kukulu/run/<project id>/` without it. `<project id>` is the first 16 hex characters of the SHA-256 of the project root's real path. It then runs the container in the foreground with a TTY, and stops the listeners when the container exits.
- **`stop`** stops the container and the listeners.

The container, named `kukulu-<project id>`, is started with exactly:

- `--network none`, `--read-only` for the image's root filesystem, `--tmpfs /tmp`, `--user` the image's `kukulu` user, `--init`, `--rm`;
- the project root at the same absolute path, read-write, and as the working directory, so every path the server returns means the same file on both sides;
- read-only over it: the policy file, `.kukulu/`, `.claude/`, `.git/config`, `.git/hooks`, `.git/info` and `docs/SPEC.md`;
- the plugin root (`CLAUDE_PLUGIN_ROOT` as installed) at the same path, read-only;
- each `sandbox.mounts` path and each `control.priorArt` path at the same path, read-only;
- the runtime directory at `/run/kukulu`, holding the three sockets;
- a named volume `kukulu-<project id>-home` as the `kukulu` user's home, holding `CLAUDE_CONFIG_DIR` and every package cache (C-07);
- the environment `KUKULU_CONTROLLER_SOCKET`, `KUKULU_LOG_SOCKET`, `HTTPS_PROXY`, `HTTP_PROXY` (`http://127.0.0.1:3128`), `NODE_USE_ENV_PROXY=1`, `DISABLE_TELEMETRY=1` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, plus only those of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` that are set in the operator's shell. No other variable of the host's environment is passed.

The argument list is built by one exported function, `containerArgs(plan)`, from a plan object that `run` and `doctor` share. Tests assert its output exactly, through the fake `docker`.

`templates/sandbox/Containerfile` starts `FROM` a Node 22 Debian slim image named by a build argument, installs `git`, `ca-certificates` and Claude Code with npm at a version given by a second build argument, adds the `kukulu` user with home `/home/kukulu`, and sets the entrypoint to `node <plugin root>/scripts/sandbox-entry.mjs`. The plugin root is passed at run time; nothing of the plugin is copied into the image. A router that the flight routes through (claude-code-router, for per-role local endpoints) is installed in the image by the operator's own derived image, and runs inside the boundary so that its upstream requests leave through the proxy (C-03). `docs/sandbox.md` shows the two-line derived Containerfile.

**Gate check 9, `boundary`**, runs when the policy's `enforcement` is `container+proxy`:

- The server must have been started by `scripts/sandbox.mjs`, which sets `KUKULU_SANDBOX=<container name>`. Otherwise the check fails: `this flight's policy requires enforcement container+proxy, but this server is not behind a Kūkulu sandbox; start the session with node scripts/sandbox.mjs run`.
- `<engine> inspect <name>` must show the container running, with the policy's image digest, network mode `none`, and exactly the mount list above.
- The inspected facts must equal the ones genesis recorded (`data.boundary: { engine, image, network, mounts }`), apart from the container's id, which every new session changes. The gate entry records the id.

A mismatch names the field: `boundary: <field> is <now>, but genesis recorded <then>`.

Tests in `test/sandbox.mjs`, all through the fake `docker`:

- `containerArgs` for a policy with mounts, prior art and egress, asserted exactly;
- `run` refuses a tag-only image, a missing image, a digest mismatch and a running container, each with nothing started;
- `doctor` output for a missing image;
- gate check 9 passes on recorded `inspect` output, fails on a network mode `bridge`, an extra read-write mount or a different digest, and fails without `KUKULU_SANDBOX`.

The `KUKULU_SANDBOX_IT=1` step builds a minimal image from `test/fixtures/docker/Containerfile.it` (no Claude Code), runs it through `run -- <command>`, and asserts: `curl https://example.com` fails inside; writing `.kukulu/x` fails inside; writing a project file succeeds; the file appears outside.

#### C-02 — the controller and the log outside (G-06)

- **The MCP server.** When `mcp/server.mjs` starts with `KUKULU_CONTROLLER_SOCKET` set, it does nothing else. It calls `spawnSync(process.execPath, [<plugin root>/mcp/relay.mjs], { stdio: "inherit" })` and exits with the relay's status. `relay.mjs` connects to the socket and pipes stdin to it and it to stdout until either side closes. If it cannot connect, it writes one JSON-RPC error for the first request and exits 1: `kukulu: cannot reach the controller at <path>; the sandbox's controller is not running. Restart the session with node scripts/sandbox.mjs run`. Outside, `scripts/sandbox.mjs` spawns `node <plugin root>/mcp/server.mjs` for each connection, with `KUKULU_PROJECT_DIR` and `KUKULU_SANDBOX` set, and pipes the connection to it. The server outside is the ordinary server, and every tool works there, with the checkpoint key on the host.
- **The log.** When `KUKULU_LOG_SOCKET` is set, the two clean-room hook scripts do not append to the log themselves. They send each entry's fields as one JSON line to the log socket and wait at most `LOG_SOCKET_TIMEOUT_MS` for the reply `{ seq, hash }`. Outside, `sandbox.mjs` appends the entry with `appendEntry` under the usual directory lock, after setting `data.source: "box"`. That marks every entry reported from inside the boundary, as distinct from entries the controller wrote. If the guard cannot reach the socket, it denies the call: `kukulu clean-room guard: the log socket is unreachable, so this call cannot be logged; restart the session with node scripts/sandbox.mjs run`. If the logger cannot reach it, it exits 1 with the same sentence on stderr. Both still fail closed when they throw.

An agent inside the boundary can connect to both sockets. It cannot use that to hide a read: the log is append-only at the controller; the prior art is not mounted; and every entry it could add carries `source: "box"`. `docs/sandbox.md` says so.

C-02's spike measures one hook's round trip over the log socket on the owner's development machine. It records the numbers in `docs/spikes/<ID>.md` against the 100 ms ⚠️ ASSUMPTION (§5.5), and `test/sandbox.mjs` asserts the budget on its in-process socket.

Tests in `test/sandbox.mjs`:

- An in-process controller socket answers `tools/list` through a real `relay.mjs` with the server's 26 tools.
- An unreachable socket gives the relay error.
- A guard denial and a logger entry sent over an in-process log socket land in the chain, with `data.source: "box"`, and verify.
- An unreachable log socket makes the guard deny, with that reason.

#### C-03 — the egress proxy (G-06 L2)

`sandbox.mjs` listens on `proxy.sock` as an HTTP proxy that accepts only `CONNECT host:port` and absolute-form `http://` requests. Inside, `sandbox-entry.mjs` bridges `127.0.0.1:3128` to that socket before it starts the harness. With `--network none`, a client that ignores the proxy settings has no route at all, and fails.

A connection is allowed when its `host:port` is:

- the endpoint of a runner some role resolves to, for this flight (the `anthropic` runner's is `api.anthropic.com:443`);
- in `sandbox.egress`; or
- the host and port of an `allow.urls` entry.

The last two hold only until lockdown (`lockdownActive`). After lockdown only the runner endpoints remain. Every other connection is refused with HTTP 403 and the body `kukulu egress: <host:port> is not allowed by this flight's policy`.

Every decision is an `egress` entry in the chain, appended by the controller: `tool: null`, `target: "<host:port>"`, `decision: "allowed"|"denied"`, `reason` (the rule that decided), and `data: { bytesUp, bytesDown, ms }` for an allowed connection, appended when it closes. A host name is matched as written, case-insensitively. The proxy resolves it itself and never accepts a literal IP address unless the allowlist names that address.

Gate check 9 gains a last part under `container+proxy`: every `allowed` `egress` entry since genesis names an allowed `host:port` under the rules above. This is what turns A-02's local-only claim into a fact. With the router inside the boundary, the model requests themselves are what the proxy logs.

C-03's spike measures the proxy's added latency per connection and per MB through the bridge, and records it in `docs/spikes/<ID>.md`. No default depends on it.

Tests in `test/sandbox.mjs`, with an in-process proxy and a local TCP server as a fake runner endpoint:

- a CONNECT to the runner is allowed and logged with its byte counts;
- one to another host gets 403 and a `denied` entry;
- an `allow.urls` host is allowed before lockdown and denied after;
- a literal IP is denied;
- gate check 9 fails on a chain holding an `allowed` entry for a host the policy does not name.

#### C-04 — commands run inside the boundary

Under `KUKULU_SANDBOX`, every command the server runs on the project's behalf runs inside the container, never on the host. That covers `kukulu_verify`'s `verify`, `extraVerify` and `build` commands, and `kukulu_mutate`'s test runs. The server keeps running git, the constraint scan, the guard self-test and the similarity scorer itself, outside, on files it reads.

`runShell` and the mutate runner wrap the command as `<engine> exec -w <root> <name> timeout -k 5 <seconds> sh -c <command>`. The inner `timeout` is there because killing the `exec` client on the host does not stop the process inside. Its `<seconds>` is the command's own timeout rounded up.

Every git command the server runs under `KUKULU_SANDBOX` gets `-c core.hooksPath=<an empty directory in the runtime directory> -c core.fsmonitor=false`. Nothing the agent wrote inside the repository then runs on the host. `.git/config` and `.git/hooks` are read-only inside as well (C-01).

Tests in `test/sandbox.mjs`: with `KUKULU_SANDBOX` and the fake `docker`, `kukulu_verify` runs each command through `docker exec` with the wrapper, asserted exactly; a commit runs with the two `-c` options; without `KUKULU_SANDBOX` nothing changes (an existing `test/implement.mjs` verify test still passes unmodified).

#### C-05 — signing under the boundary

Commits made inside the container cannot be signed by the operator's agent, because no signing socket is passed in, and that is on purpose. Under `KUKULU_SANDBOX`:

- `kukulu_run_start` refuses `policies.signing: "required"`: `policies.signing is 'required', but commits made inside the sandbox cannot be signed: the signing agent stays outside the boundary. Set policies.signing to 'auto' or 'off'; the signed checkpoints vouch for every commit's head`.
- Under `auto`, `state.signing` is `off (sandbox: commits inside the boundary are unsigned; the signed checkpoints vouch for them)`, and 0.7.2 B-03 treats that record like `"none"`: finalize does not wait.
- The commits the server makes outside are signed as usual.

In a bundle whose enforcement is `container+proxy`, the verifier reports unsigned commits that carry a `Kukulu-Stage` trailer as one note: `unsigned commits: <n> (expected under container+proxy: commits made inside the boundary are unsigned, and the checkpoints sign their heads)`. It does not list one `unsigned-commit` gap for each. An unsigned commit without the trailer is still an `untrailed-commit` gap. Under `hook`, gaps are listed as today.

Tests: `test/sandbox.mjs` for the refusal and the `auto` record; `test/attest.mjs` for the aggregated note under `container+proxy` and per-commit gaps under `hook`.

#### C-06 — the enforcement level in the bundle (G-07) ⚠️ NEW MATTER

The manifest gains `enforcement`:

- `level`: `"hook"` or `"container+proxy"`;
- under `container+proxy`, genesis's `boundary` and an `egress` summary: for each `host:port`, how many connections were allowed and how many denied, recounted by the verifier from the `egress` entries.

`KNOWN_LIMITS` becomes an array of `{ id, text, levels }`. `knownLimitsFor(level)` returns the texts whose `levels` include it, in order. `coverage.knownLimits` is that list for the bundle's level, so the list visibly shrinks at the higher level:

| id | text, abridged | hook | container+proxy |
|---|---|---|---|
| `interpreter` | interpreter escapes are not parsed | yes | no |
| `expansion` | shell expansion beyond `~` and `$HOME` is not evaluated | yes | no |
| `spellings` | unmodelled option and wrapper spellings | yes | no |
| `indirect` | commands run from arguments; programs outside the fixed lists | yes | no |
| `patterns` | `pathPatterns` match named paths only | yes | no |
| `make` | subprocesses of a make target are not tool calls | yes | no |
| `mcp` | MCP server internals are not tool calls | yes | no |
| `session` | hooks load at session start | yes | yes |
| `training` | what a model learned in training is outside every boundary; the similarity score, not the log, measures it | yes | yes |
| `packages` | packages named in a lockfile are outside the claim; `deny.packages` and the gate keep named prior-art packages out | yes | yes |
| `config-writable` | inside the boundary `docs/kukulu.json` stays writable, because the planner writes it; only the guard protects it after the plan | no | yes |
| `tls` | the proxy sees host and port, not paths or content inside TLS; whatever an allowed host serves is reachable | no | yes |

The texts of the first eight stay word for word as in 0.7.2. The four new ones are written in full in `mcp/cleanroom.mjs`, and `docs/cleanroom.md`'s "Known gaps" section prints all twelve with their levels. The ordering of levels is `hook` < `container+proxy` < `container+proxy+audit`. The verifier knows all three names, and 0.8.0 never writes the third.

The verifier gains:

- check 11, `enforcement`: the manifest's level is a known name; a `container+proxy` bundle has a genesis `boundary`; the egress summary recounts from the log; and every gate entry since genesis passed check 9.
- `--require-enforcement <level>`: a bundle below that level fails with `enforcement: the bundle was built under <level>, below the required <level>`.
- an absent `enforcement`, as in every 0.7.x bundle, reads as `hook`, with the note `enforcement absent (bundle from 0.7.x); read as hook`.
- `--json` gains `enforcement`.

Tests in `test/attest.mjs`: a `hook` bundle with `--require-enforcement container+proxy` fails; a `container+proxy` bundle built from recorded `inspect` fixtures passes it; an edited egress summary fails check 11; a 0.7.2 bundle from `test/fixtures/` verifies with the note; `knownLimitsFor` gives ten texts for `hook` and five for `container+proxy`, identically in both copies.

#### C-07 — the dependency-cache back door (G-08)

Under `container+proxy`, every package cache lives in the container's home volume (C-01), never in the host's. The host's `~/.cargo`, `~/.npm` and `~/.cache/pip` are not mounted. The policy's `deny.packages` names prior-art packages per ecosystem.

`mcp/cleanroom.mjs` gains pure parsers, `lockfilePackages(name, text)`, for:

- `Cargo.lock`: every `[[package]]`'s `name` and `version`;
- `package-lock.json` and `npm-shrinkwrap.json`: every `packages` key `node_modules/<name>`, with its `version`;
- `uv.lock` and `poetry.lock`: every `[[package]]`'s `name` and `version`;
- `requirements*.txt`: each requirement line's name, and the pin when it is `==`.

Names compare after normalization: cargo's `-` and `_` are equal; PyPI names follow PEP 503; npm names are compared as written.

**Gate check 10, `packages`**, runs when `deny.packages` is non-empty. It finds every lockfile in the tracked tree (`git ls-files`) and refuses on the first denied package: `packages: <lockfile> contains <name> <version>, which policy deny.packages.<ecosystem> names; remove the dependency, and know that its source may already have been read`. Under `container+proxy`, it then lists the cargo registry's unpacked sources in the home volume with `<engine> exec <name> find /home/kukulu/.cargo/registry/src -mindepth 2 -maxdepth 2 -type d`, and refuses on a denied crate's directory: `packages: the sandbox's cargo cache holds <dir>`.

The guard denies a Bash segment that adds a denied package: `cargo add <name>`, `npm install|i|add <name>`, `pip install <name>` and `uv add <name>`, with the package name as written or with a version suffix (`name@1`, `name==1`). The reason is `denied package: <name> is in policy deny.packages.<ecosystem>`. This is a rule 6 addition under the guard-rule protocol, with its fixtures.

The manifest gains `packages`: for each lockfile, its `path`, `sha256`, `ecosystem` and the `name@version` list, under `outsideClaim: true`. An oracle that must link prior art, such as cleanflate's zlib oracle, is built outside the boundary and mounted read-only through `sandbox.mounts`. `docs/sandbox.md` shows that with cleanflate as the example.

Tests:

- `test/cleanroom.mjs`: each parser on fixtures in `test/fixtures/lockfiles/`; name normalization; gate check 10 fails on a denied crate in `Cargo.lock`, and on a cache directory listed by the fake `docker`.
- `test/fixtures/guard-cases.json`: the four add commands denied and allowed.
- `test/attest.mjs`: the manifest's `packages`.

#### C-08 — the 0.7.2 known-gap candidates

- `--remove-sent-files` is rsync's older name for `--remove-source-files`, and it gets the same rule (0.7.2 A-01). Fixtures: denied, `rsync --remove-sent-files docs/cleanroom.json build/`; allowed, `rsync --remove-sent-files build/a.o out/`.
- `pax` gets the tar rules: `-r` extracts into the current directory (after an earlier `cd`), and `-w -f <file>` writes an archive file. Fixtures: denied, `cd docs && pax -r -f a.tar`, `pax -w -f docs/cleanroom.json src`; allowed, `pax -f a.tar` (listing), `cd build && pax -r -f a.tar`.

`docs/cleanroom.md` rule 6 names both, and `KNOWN_LIMITS` does not change for them.

### D — Usage and comparison

#### D-01 — stage timing in the log (G-10)

In clean-room mode, `kukulu_next` appends a `stage` entry each time it returns a stage other than `done` or `halt`: `role: "controller"`, `data: { event: "start", stage, round, agent, model }`. It first appends `data: { event: "end", stage, round }` for the stage the previous result started, if one is open, so a stage's wall time is the span between its two entries. A `done` or `halt` result also closes the open stage.

`state.json` gains `timeline`, the same `{ event, stage, round, at }` records, in every mode, so a general flight has timings too. `kukulu_status` reports `timeline` and, per stage, the total seconds.

The verifier's `chain` check accepts the kind, and the manifest's `calls` stays limited to tool calls.

Tests in `test/state.mjs`: three `kukulu_next` calls give start, end and start in order, in the chain and in `timeline`; a `halt` closes the open stage; general mode writes `timeline` and no chain.

#### D-02 — token use per role (G-10)

`hooks/hooks.json` adds `cleanroom-log.mjs` to `SubagentStop`, after the implement guard. On that event, in clean-room mode, the logger reads `agent_transcript_path` and appends one `usage` entry: `role` the `agent_type`, and `data: { models, first, last, cost }`.

- `models` maps each `message.model` to `{ requests, input, output, cacheRead, cacheWrite }`. The counts are sums of `message.usage`'s `input_tokens`, `output_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens` over the transcript's `assistant` lines, counted once per `requestId`.
- `first` and `last` are the earliest and latest `timestamp`.
- `cost` is the sum of the lines' `costUSD` when every counted line carries a number, else `null`.

A transcript that cannot be read gives a `usage` entry with `data: { error: "<first line>" }`, never a crash. In sandbox mode the entry goes through the log socket like every other.

`test/fixtures/transcripts/` holds a trimmed subagent transcript. Keep only `type`, `requestId`, `timestamp`, `message.model` and `message.usage` on each line, with two lines sharing one `requestId`. No content, prompt or path is kept from the session it was trimmed from, and `scripts/check-names.mjs` runs over it.

The manifest's `roles` (A-03) gains `usage` per role: these sums, recounted by the verifier from the `usage` entries.

Tests in `test/cleanroom.mjs`: the logger on the fixture gives the expected sums with the duplicate counted once; an unreadable path gives the error entry; general mode writes nothing; the hook stays within the 50 ms budget on the fixture.

#### D-03 — comparing two bundles (G-09)

```text
node scripts/compare-bundles.mjs <bundle-a> <bundle-b> [--key-a sha256:<fp>] [--key-b sha256:<fp>] [--trees <dir-a> <dir-b>] [--json]
```

It first runs each bundle's own `verify.mjs` (with its key when given), and refuses unless each exits 0 or 3. Then it prints one section per item, each with a line for A and a line for B:

- mode and enforcement level, with the egress summary;
- gates run and failed;
- human records (instructions, interventions, verdicts);
- denials by reason;
- coverage gaps by kind;
- similarity verdicts and the scores of the negative and positive controls, when present;
- each role's model, runner, identity source and family;
- wall time per stage, from `stage` entries;
- tokens per role and model, from `usage` entries.

A bundle that lacks an item, such as a 0.7.x bundle without `stage` entries, prints `—` for it.

With `--trees`, it scores the two result trees against each other with `tokenize` and `scorePair` from `mcp/cleanroom.mjs`. It uses the scoring parameters recorded in bundle A's `similarity.json` (`config.ngram`, `config.minIdentLen`, `config.commentNgram`, `config.languages`). It refuses when neither bundle has a `similarity.json`, and when B's parameters differ from A's. It prints the cross score next to each bundle's negative-control score, with the sentence: `Two independent clean-room builds should score at or near their negative controls.` It verifies nothing about the trees beyond reading them, and never writes a file.

Tests in `test/bundles.mjs`, on two bundles built by the test: the text output for a `hook` and a `container+proxy` bundle against `test/fixtures/compare/expected.txt`; `--json`; a failing bundle refuses; `--trees` on two fixture trees gives the cross score; mismatched parameters refuse.

### E — Release and pipeline

#### E-01 — `kukulu_release`

A new tool, inserted after `kukulu_pr_finalize`. It runs after a human has merged the flight's PR, and it is the step 0.7.0, 0.7.1 and 0.7.2 all did by hand. Input: `{ publish?: boolean }` (default `false`).

It refuses, before writing anything, unless each of these holds:

1. The newest archived flight is found. That is `state.archived.dir`, read from `state.json`. Otherwise: `kukulu_release releases the newest archived flight, and none is archived; archive it first`.
2. Its branch's PR is merged. `gh pr view <branch> --json state,mergeCommit,number,url` must say `MERGED`. Otherwise: `the flight's PR (<url>) is <state>; kukulu_release runs after a human merges it`.
3. `CHANGELOG.md`'s newest numbered entry (`## [x.y.z]`) exists at the merge commit, and the tag `v<x.y.z>` does not exist locally or on `origin`.
4. The local `baseBranch` contains the merge commit after a fast-forward pull.

It then:

- creates an annotated tag `v<x.y.z>` on the merge commit, signed when `git config --get tag.gpgsign` or the flight's recorded `signing` is `"on"`, with the message `v<x.y.z>`;
- pushes the tag;
- runs `gh release create v<x.y.z> --verify-tag --title v<x.y.z> --notes-file <temp>` with `--draft` unless `publish` is true.

The notes are the CHANGELOG entry's body, followed by `See [CHANGELOG.md](<repo url>/blob/v<x.y.z>/CHANGELOG.md) for the full list.`

The result is `{ tag, sha, release: <url>, draft }`. If `gh release create` fails after the tag was pushed, the tag stays, and the error says `the tag v<x.y.z> was pushed; create the release by hand with gh release create v<x.y.z> --verify-tag, or call kukulu_release again`. A second call then skips the tag steps, because the tag exists at that commit, and creates only the release. That is the one exception to refusal 3's "tag exists": the tag exists at the merge commit and no release does.

The go-flight skill maps two operator phrasings: "release it" to `kukulu_release({})`, and "release and publish" to `kukulu_release({ publish: true })`. Both are called once, their result printed, then stop. No stage agent has the tool. Both spellings go on go-flight's `allowed-tools`, per the tool protocol.

Tests in `test/review.mjs`, with the fake `gh` and a bare repo as `origin`:

- the happy path makes a draft;
- `publish` omits `--draft`;
- each refusal leaves no tag;
- a failing `gh release create` leaves the pushed tag, and a second call creates only the release;
- the notes file's content is asserted.

The count is 26 tools, and every count names it (CLAUDE.md's tool protocol).

#### E-02 — base health before planning (kukulu F-01 of 2026-10-26)

In 0.7.2, the planner found the base branch red only by running the suite itself. When `kukulu_next` returns stage `plan` and a previous flight is archived, it scans the tracked tree with the archived `kukulu.json`'s `constraints`, the same scan `kukulu_verify` runs, with no command run. It does this only when `docs/kukulu.json` does not exist yet.

When any constraint fails, the plan prompt gains one sentence: `The base fails <n> constraint(s) carried from flight <slug>: <id> (<file>:<line>), …; decide in the plan whether a task restores them or the spec changed them.` The reason gains `base health: <n> failing`. Nothing is refused, because the spec may have changed the rule on purpose.

Tests in `test/state.mjs`: an archived flight with a constraint the base breaks gives the sentence; a clean base gives today's prompt; no archive gives today's prompt.

#### E-03 — the 0.7.2 review's notes

- `classifyChanges` reads `git diff --raw --no-renames`, so a rename never pairs records wrongly.
- The synthetic gh error lines inline in `test/state.mjs` and `test/review.mjs` move to `test/fixtures/gh/`, as principle 12 asks.
- `docs/mcp-tools.md`'s `kukulu_run_start` Returns list names every `signing` value, `off (commit signing failed: …)` and C-05's sandbox record included.

### F — Documentation and release

- `docs/sandbox.md` (new):
  - building the image, and the derived image with a router;
  - `doctor` and `run`;
  - the mount list and why each part is read-only;
  - the sockets;
  - what an agent inside can and cannot do;
  - macOS through a Linux VM;
  - a worked local-only flight with the strategy notes' profile B as the routing example: plan and review on the Mac, implement on the Spark;
  - a recorded run's `doctor` output.
- `docs/publishing.md` (new): B-03.
- `docs/cleanroom.md`:
  - the new policy keys;
  - gate checks 8 to 10, and the go-flight line `gate: ok (<n> checks)` now counting up to ten;
  - control mode;
  - the new entry kinds;
  - the manifest's new fields;
  - verifier check 11, `--expect` and `--require-enforcement`, and exit status 3;
  - the twelve known limits with their levels.
- `docs/routing.md`: runners, `scripts/model-identity.mjs`, and local-model starting points. It says that prefix caching is off in some vLLM recipes and that Ollama's Anthropic endpoint does not cache prompts, so prefill dominates long flights; the context caps are the operator's to set on the runner.
- `docs/operations.md`: the egress and signing notes for a sandboxed flight.
- `docs/mcp-tools.md`:
  - its first line reads "Twenty-six tools";
  - `kukulu_release`;
  - `kukulu_next` (D-01, E-02);
  - `kukulu_similarity` (B-02);
  - `kukulu_run_start` (C-05);
  - `kukulu_config_show` and `kukulu_agents_sync` (A-01);
  - `kukulu_status` (D-01).
- `README.md`: "The server exposes twenty-six tools.", the tool table row, and one paragraph on the sandbox under clean-room mode.
- `CONTRIBUTING.md`: rows for the `sandbox` and `bundles` suites and for each new script.
- `CHANGELOG.md`: `## [0.8.0] — <date>`, renamed from `## [Unreleased]` by the release task, under Added, Changed and Fixed. Each item cites its goal (`G-06`), feedback item or note. There is no "Breaking changes" heading (§1).
- The version reads `0.8.0` in `package.json`, `.claude-plugin/plugin.json` and `VERSION` in `mcp/server.mjs`.
- `docs/HANDOFF.md`'s first line, in bold: **Do not merge until the owner has run one sandboxed clean-room flight from the working tree on Linux (`node scripts/sandbox.mjs run`) and its bundle verifies with `--require-enforcement container+proxy` (SPEC §8 Phase 2).**

## 7. Commands

Run from the repository root. Each exits non-zero on failure and runs today on a clean checkout of `main`.

- lint: `npm run lint` (under 3 s)
- hygiene: `pre-commit run --all-files` (about 4 s)
- test: `npm test` (about 100 s today; `timeoutMs: 900000`)
- the guard self-test, as `extraVerify` on `scripts/cleanroom-guard.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json` and `templates/cleanroom.example.json`: `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json`. From the task that creates `templates/cleanroom.local-only.example.json`, the same entries also run it on that file, and the file is an `extraVerify` key of its own.
- site, as `extraVerify` on `site/`, `docs/site/` and the three site scripts: `npm run check:site`
- targeted mutation: `node test/{filter}.mjs` as `mutation.targeted.suite`
- the sandbox integration step, manual and not in `verify`: `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs`

## 8. Phases

### Phase 0 — Routing and identity

A-01 to A-04. Ends with a push. Manual check, `NOT VERIFIED (human)`: with the owner's real global file holding the Spark and Mac runners, `kukulu_config_show` reports each role's runner. A throwaway clean-room flight with `runners.locality: "local"` and the default routing refuses at its first `kukulu_next`. With profile B routing, it writes a genesis whose `roles` name both runners and the Spark model's measured `weights` digest, taken from `scripts/model-identity.mjs` run on the Spark.

### Phase 1 — Controls and publishing

B-01 to B-03. Ends with a push. Manual check, `NOT VERIFIED (human)`: a small control flight's bundle verifies as `CONTROL (positive)` with exit 3. `publish-bundle.mjs` output copied to a static host verifies with `--check` from a second machine.

### Phase 2 — The sandbox and enforcement

C-01 to C-08, with C-02's and C-03's spikes. Ends with a push. Manual check, `NOT VERIFIED (human)`, on Linux:

- `doctor` passes;
- `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs` passes;
- a throwaway sandboxed clean-room flight runs to the end;
- inside it `curl https://example.com` fails and `ls ~/.cargo/registry` shows only the volume's own cache;
- its bundle verifies with `--require-enforcement container+proxy`, and its egress summary lists only the runner endpoints.

The same run inside a Linux VM on the owner's Mac is a second, separate check.

### Phase 3 — Usage and comparison

D-01 to D-03. Ends with a push. Manual check, `NOT VERIFIED (human)`: `compare-bundles.mjs` on the Phase 2 bundle and a `hook` bundle from a real flight prints wall time and tokens per role for both.

### Phase 4 — Release tool, notes, documentation and release

E-01 to E-03, then F. Version bump, CHANGELOG, `docs/HANDOFF.md`. Manual check, `NOT VERIFIED (human)`: on a scratch repository with a merged PR, `kukulu_release` makes a draft release whose notes match the CHANGELOG entry. This release is the first one `kukulu_release` cuts, after the owner merges.

## 9. Open questions

None block the build. Each is decided here, so the planner records it under `## Decisions` as given:

1. **Where runners live.** The global file, not `docs/kukulu.json` (A-01): endpoints are one person's machines. An owner decision of 2026-10-26.
2. **How local-only is proved.** Configuration-asserted under `hook`, a fact under `container+proxy` through the egress check, and the manifest says which (A-02, C-03).
3. **How a weight digest is measured.** On the inference host, by `scripts/model-identity.mjs`, and copied into the global file (A-03). The controller usually cannot read the weights, and hashing tens of gigabytes at every genesis would stall the synchronous server.
4. **What a control bundle's verifier verdict is.** `CONTROL (positive)` with exit 3, never exit 0 without `--expect control-positive` (B-01), so a script that treats exit 0 as a clean-room pass can never be fooled by a control.
5. **The container engine.** `docker` or `podman` on Linux; macOS through a Linux VM (C-01). Apple's `container` and Docker Desktop are not supported in this release.
6. **Where the controller runs.** On the host, reached over Unix sockets, with the server unchanged and handed stdio by `spawnSync` (C-02). That keeps principle 8 and the key outside.
7. **Signing under the boundary.** Commits inside are unsigned, and the checkpoints vouch for their heads (C-05). Passing the operator's signing agent into the boundary would defeat its purpose.
8. **Package denial without TLS interception.** Lockfiles and the cache are checked at every gate, and the guard denies the add commands (C-07); the proxy decides on host and port only.
9. **The release tool's default.** A draft release, and `publish: true` only when the operator asks (E-01). This answers the 2026-10-20 notes' open question 2.
10. **The demo.** The owner's next clean-room flight, run on the released 0.8.0 for the No Excuses application and filmed as a timelapse, is not part of this flight. D-01's `timeline` and `stage` entries give it timestamps to annotate.

## Appendix A: item map

### The owner's 0.8.0 strategy notes (2026-10-23 to 25)

| Goal | Disposition |
|---|---|
| G-01 local-only flight profile | A-01, A-02; proved under `container+proxy` by C-03 |
| G-02 model identity in the evidence | A-03 (⚠️ NEW MATTER) |
| G-03 role-separation policy | A-04 |
| G-04 positive-control mode | B-01, B-02 |
| G-05 publishable sample bundle | B-03; the site page is a later copy change |
| G-06 sandbox enforcement backend, L1 and L2 | C-01 to C-05 |
| G-07 enforcement level in the bundle | C-06 (⚠️ NEW MATTER) |
| G-08 dependency-cache back door | C-07 |
| G-09 bundle comparison | D-03 |
| G-10 usage and timing in the log | D-01, D-02 |
| G-11 to G-14 | 0.9.0; not in this flight |
| ⚠️ ASSUMPTION: proxy and sandbox overhead | C-02's and C-03's spikes (§5.5) |
| ⚠️ ASSUMPTION: local-model context caps | documented in `docs/routing.md` (F); the operator's to set |
| ⚠️ ASSUMPTION: the family table | `MODEL_FAMILIES` (§5.5) |

### The 2026-10-20 notes and their 2026-10-25 reconciliation

| Item | Disposition |
|---|---|
| Release mechanics as a tool | E-01 |
| Open question 2, publish or draft | draft by default (§9 Q9) |
| Open question 4, Claude Desktop | not in this flight |

### The 0.7.2 flight (`docs/flights/v0-7-2/`)

| Item | Disposition |
|---|---|
| kukulu F-01 (2026-10-26): the base was red and nothing said so | E-02 |
| Known-gap candidate: `rsync --remove-sent-files` | C-08 |
| Known-gap candidate: `pax` extraction | C-08 |
| Note: `classifyChanges` and `diff.renames` | E-03 |
| Note: inline gh error lines in the tests | E-03 |
| Note: `kukulu_run_start`'s Returns list omits a `signing` value | E-03 |
| Note: the commit-scoped gitleaks allowlist assumes merge commits | no change: `policies.mergeMethod` stays `merge` here, and `docs/operations.md` already says rebase rewrites shas |

## Appendix B: interpretation choices made in writing this spec

Each is a place where the strategy notes allowed two readings:

1. **The policy key for local-only.** The notes' working name was `cleanroom.allowedRunners`. It is `runners.allow` plus `runners.locality` in the policy, not in `docs/kukulu.json`, because the policy is what genesis pins and the gate compares.
2. **"Resolves to a remote endpoint."** A role whose model matches no runner has locality `unknown`, which fails a local-only flight like `remote` does. An unknown endpoint cannot be shown to be local.
3. **`requireDistinct`.** It is `roles.distinct: "model" | "family"` and covers the implementer and the reviewer only, as the notes say. The planner and the summarizer are unconstrained.
4. **The positive control's output.** "Feeds `kukulu_similarity`" is read as a reference from the clean-room flight's positive pair to the verified control bundle (B-02). The other reading would score inside the control flight, and that would measure nothing.
5. **Proxy log entries "hashed into the chain".** They are ordinary chain entries of kind `egress`, appended by the controller, not a separate log whose digest is chained. One chain stays the only evidence format until 0.9.0.
6. **The enforcement names.** `hook` and `container+proxy`, as the notes spell them. `container+proxy+audit` is only a known name, so that a 0.9.0 bundle fails `--require-enforcement` cleanly on an older verifier instead of being misread.
7. **"Usage when the runner reports it."** Token counts come from the subagent transcript, which records what each endpoint reported. Cost is recorded only when every counted line carries one, so a partial cost is never presented as a total.
