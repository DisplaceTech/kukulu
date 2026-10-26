# Kūkulu — working rules

Kūkulu is a Claude Code plugin: a dependency-free MCP server (`mcp/server.mjs`) holds the mechanics, and the skills (`skills/*/SKILL.md`) hold the judgment. These rules apply to every change in this repository.

## Principles

- Mechanics live in the server, judgment in the skills. A new mechanical step (validating ids, writing an artifact, archiving, retrying a commit) is a server change with a test, never a skill sentence telling a model to do it by hand.
- Every server behavior change has a test in the suite that owns that tool (CONTRIBUTING.md's table). Every new refusal has a test that triggers it and asserts its message.
- Tools validate, then mutate: a refusal comes before any file is written, and a tool whose final commit fails leaves the tree as it found it.
- Config never silently defaults a bad value: every new `docs/kukulu.json` key is validated like `validatePolicies`, `validateParallel` and `validateConstraints`, with an unknown-key refusal.
- Documentation moves with the code: a task that adds or changes a tool updates `docs/mcp-tools.md` in the same commit.
- Error messages are written for a model: say what is wrong and what to do instead. Comments explain why, not what.
- No dependencies anywhere: server, tests, lint.
- Tests never depend on an untracked file: a test that reads documentation reads only paths in `git ls-files`, and a test that needs a denylist, a key or a policy writes its own in a temp directory.

## Commands

- `npm run lint`: syntax and manifest lint (check-names and check-site included), under 3 s.
- `pre-commit run --all-files`: hygiene, markdownlint, shellcheck, yamllint, gitleaks, about 4 s.
- `npm test`: every suite registered in `test/run.mjs`, about 100 s.
- `npm test -- state review`: named suites only; `node test/review.mjs`: one suite directly; `KEEP_REPO=1 npm test -- drive`: keep the temp repos.
- `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs`: the real-container integration step (Linux with docker on PATH; never in `verify`).
- `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.local-only.example.json`: the guard self-test on the local-only template (once P2-01 of flight v0-8-0 exists).
- `node scripts/sandbox.mjs doctor|run|stop`, `node scripts/model-identity.mjs <paths>`, `node scripts/publish-bundle.mjs <bundle> --key … --out …`, `node scripts/compare-bundles.mjs <a> <b>`: the 0.8.0 scripts; each runs only as the entry script and has no shebang.
- `npm run check:site`: `node scripts/check-site.mjs --self-test && node scripts/check-site.mjs`, the static site rules (SPEC §3 rules 1–14); `node scripts/check-site.mjs --report` prints measured sizes and contrast against `docs/site/checks.json`.
- `npm run check:site:browser`: rule 15 in headless Chrome (needs Chrome or Chromium; `CHROME_PATH` overrides discovery; binds `servePort`, so one at a time); `--shots` writes `.site-shots/<width>-<scheme>.png`.
- `npm run site:serve`: serve `site/` on `127.0.0.1` with `site/_headers` applied (`SITE_PORT` or `--port N`); `node scripts/serve-site.mjs --self-test` checks it on an ephemeral port.
- `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json`: the clean-room guard's fixed fixture set plus the policy's own fixtures (once the guard exists).
- `node scripts/verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--json]`: the offline bundle verifier; `--legacy-log <tool-log.jsonl>` reads a pre-0.6.0 log.

## Module map

| Path | Responsibility |
|---|---|
| `mcp/server.mjs` | Every deterministic operation and the JSON-RPC transport; one file |
| `mcp/cleanroom.mjs` | Pure, synchronous clean-room functions shared by the server, the hooks and the tests: policy, canonicalization, guard decision, chain, checkpoints, key, scorer, coverage (new in 0.7.0) |
| `mcp/run-command.mjs` | Runs one bounded command in its own process group (unchanged) |
| `mcp/relay.mjs` | Inside the sandbox: pipes the server's stdio to the controller socket; `node:` only, may use `async`; the server reaches it only through `spawnSync` (new in 0.8.0) |
| `scripts/sandbox.mjs`, `scripts/sandbox-entry.mjs` | The sandbox launcher and controller host (`doctor`, `run`, `stop`; the controller, log and proxy sockets), and the container's entrypoint (the loopback-to-socket bridge, then the harness) (new in 0.8.0) |
| `scripts/model-identity.mjs`, `scripts/publish-bundle.mjs`, `scripts/compare-bundles.mjs` | Weight-file digests on an inference host; a publishable bundle copy and its re-check; two bundles side by side (new in 0.8.0) |
| `templates/sandbox/Containerfile`, `templates/cleanroom.local-only.example.json` | The sandbox image template; the worked local-only, sandboxed policy |
| `scripts/implement-guard.mjs` | Stop/SubagentStop hook |
| `scripts/cleanroom-guard.mjs`, `scripts/cleanroom-log.mjs` | PreToolUse guard; PostToolUse and UserPromptSubmit logger (new in 0.7.0) |
| `scripts/verify-attestation.mjs` | The offline attestation verifier, `node:` imports only, copied into every bundle (new in 0.7.0) |
| `scripts/check-names.mjs` | Display-name rules and the private-name denylist check |
| `hooks/hooks.json` | Stop, SubagentStop, and from 0.7.0 PreToolUse, PostToolUse, UserPromptSubmit |
| `agents/*.md` | Default model, effort and `tools:` per role; the tool list is the contract |
| `skills/*/SKILL.md` | Stage prose |
| `templates/` | SPEC skeleton, routing example, constraint examples |
| `test/harness.mjs` + the suites | `plugin`, `protocol`, `state`, `implement`, `review`, `routing`, `constraints`, `feedback`, `streams`, `guard`, `drive`, from 0.7.0 `cleanroom` and `attest`, and from 0.8.0 `sandbox` and `bundles`; `test/fixtures/` holds recorded data |
| `docs/*.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | User and maintainer docs |
| `site/` | The kukulu.tech landing page, deployed as-is by Cloudflare Pages; a closed file set |
| `docs/site/` | The site's inputs: approved mockup, screens, seeded assets, `checks.json`, `DEPLOY.md`; never deployed |
| `scripts/check-site.mjs` | Static site checks with `--self-test` and `--report`; exports `loadConfig`, `checkSite`, `parseHtml`, `visibleText` |
| `scripts/serve-site.mjs` | Local server for `site/`; exports `start({ port }) → { url, close }` |
| `scripts/check-site-browser.mjs` | Rule 15 through Chrome's DevTools protocol and Node's built-in `WebSocket` |

## Constraints

Mechanical rules are in the `constraints` of a flight's `docs/kukulu.json`, which the planner writes and the archive moves to `docs/flights/<slug>/` when the flight ends (the last archived set is `docs/flights/v0-7-0/kukulu.json`). They run on every `kukulu_verify`:

- `server-synchronous`: no `async` or `await` anywhere in `mcp/server.mjs` or `mcp/cleanroom.mjs`, including comments and strings. Long work uses `spawnSync`.
- `no-dependencies`: `package.json` has no `dependencies` or `devDependencies`, and there is no lockfile.
- `no-fable-default`: no `agents/*.md` frontmatter line reads `model: fable`.
- `no-sync-merge`: `gh pr merge` only ever runs with `--auto`, written as one inline argument array in `mcp/server.mjs`.
- `no-gnu-sed-inplace`: no `sed -i` in `test/`, `scripts/` or `mcp/`; BSD sed on macOS rejects it. Write to a temp file and `mv`. `test/fixtures/` is exempt: it holds recorded commands as data, never run.
- `scripts-node-builtins`: every `scripts/*.mjs` imports (statically, dynamically or by `require`) only `node:` modules or `./`/`../` siblings; `scripts/check-diagrams.mjs` (CI-only, documented to need mermaid and jsdom) is exempt.
- `no-foundry-names`: no `foundry` in any case in `mcp/`, `scripts/`, `hooks/`, `skills/`, `agents/` or `.mcp.json`, except `scripts/verify-attestation.mjs`; a legacy name is built from `"foun" + "dry"`.
- `progress-no-bare-macron`: in `docs/PROGRESS.md` the macron u (U+016B) appears only inside the display name; never write the letter, or an escape that decodes to it, in a task log or reason.
- `one-hash-one-signature`: in `mcp/` and `scripts/`, `createHash` only with `"sha256"`, `generateKeyPairSync` only with `"ed25519"`, and no `createHmac`, `createSign` or `createVerify`.
- `cleanroom-module-pure`: `mcp/cleanroom.mjs` imports only `node:` modules, never `child_process`, and has no `spawnSync`/`execFileSync`/`execSync`, `process.exit`, `console.*(` or dynamic `import(`.
- `hooks-lazy-cleanroom`: the two clean-room hook scripts never import `mcp/cleanroom.mjs` statically; they `await import()` it after the no-policy check.
- `verifier-node-only`: `scripts/verify-attestation.mjs` imports only `node:` modules, so the copy in a bundle runs alone.
- `no-hardcoded-target-max`: 4000 is written only as `export const TARGET_MAX = 4000;` in `mcp/cleanroom.mjs`.
- `no-hardcoded-mutation-fix-rounds`: in `mcp/server.mjs`, `skills/` and `agents/`, a `2` beside `mutationFixRounds` appears only on cfgFrom's line `review: { mutationFixRounds: c.review?.mutationFixRounds ?? 2 },` (indented four spaces).
- `site-no-patented`: no "patented" in any case in `site/`, `docs/site/mockup.html`, `README.md` or `CHANGELOG.md`; write "patent pending".
- `site-no-inline-style`, `site-no-inline-handler`, `site-404-no-script`, `site-one-script-form`: no `style=` or `<style>`, no `on*=` attribute, no script in `site/404.html`, and `site/index.html`'s only script is `<script src="/copy.js" defer></script>`.
- `site-root-relative-src`, `site-css-root-relative`, `site-self-contained`: every `src=`, `<link href=` and CSS `url()` in `site/` is root-relative (the canonical `https://kukulu.tech/` excepted), there is no `@import`, and nothing references `docs/`, `scripts/`, `assets/` or `../`.
- `site-display-name-ascii`, `site-no-theme-attr`, `site-no-cache-control`, `copy-buttons-start-hidden`: no `\bKukulu\b` in the site's HTML, no `data-theme`, no `Cache-Control` in `site/_headers`, and every `[data-copy-for]` button carries `hidden`.
- `no-hardcoded-copy-feedback`, `no-hardcoded-site-tunables`: the ⚠️ ASSUMPTION values in `docs/site/checks.json` (2400, 65536, 184320, 2048, 4.5, 8788) are never literals in the site scripts; `copyFeedbackMs` appears only in `copy.js`'s `const COPY_FEEDBACK_MS = 2400;`.
- `sandbox-network-none` (from P2-02 of flight v0-8-0): in `scripts/sandbox.mjs`, no `--network`, `--net` or `--network=` followed by anything but `none`, in the two-token or the `=` form.
- `sandbox-no-escape-flags` (from P2-02): `scripts/sandbox.mjs` never contains `--privileged`, `--cap-add`, `--pid=host`, `--pid", "host`, `--security-opt", "seccomp=unconfined`, `docker.sock` or `podman.sock`, comments included.
- `relay-not-in-server` (from P2-02): `mcp/server.mjs` never imports `node:net`, `net` or `./relay.mjs`; it reaches the relay only through `spawnSync`.
- `no-hardcoded-log-socket-timeout`: 2000 is written only as `export const LOG_SOCKET_TIMEOUT_MS = 2000;` in `mcp/cleanroom.mjs`; the hooks and the sandbox read the export.
The reviewer checks these by reading, because no line pattern can express them:

- Refusals before writes; rollback on a failed commit (principle 3). The one sanctioned exception is the clean-room gate, which appends its own `gate` entry to the log before it refuses.
- `fable` stays a legal alias (`ANTHROPIC_ALIASES`, `AGENT_TOOL_ALIASES`).
- `TASK_ID`, `TASK_LINE` and the guard's task regexes are unchanged; only `kukulu_plan_commit`'s renumber mode accepts a suffix such as `P1-02a`. The implement guard's `RUN_START_TOOL` is `/^(?:mcp__.+__)?kukulu_run_start$/` and its agent-type set is `kukulu-implementer` and `kukulu:implementer`; nothing else about them changes.
- No existing file under `docs/plans/` changes (new plans may be added); under `docs/feedback/` only the "addressed in" header lines. Never edit `docs/SPEC.md`, and never edit `docs/PLAN.md` or `docs/PROGRESS.md` by hand.
- Under `docs/site/` only `mockup.html` changes, and only by applying the owner's `docs/site/copy-changes.json`; `checks.json`, `assets/`, `screens/` and `copy-changes.json` itself never change in a flight commit (`git log <merge-base>..HEAD -- docs/site/copy-changes.json` is empty). Nothing under `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/` changes for the site. `check-site.mjs` and `serve-site.mjs` never write into `site/`; `check-site-browser.mjs` writes only to `.site-shots/`, and only with `--shots`.
- `site/` matches the mockup visually with semantic class names and shared rules; it is not the mockup with its inline styles moved into classes one by one.
- The clean-room guard fails closed: every path in `scripts/cleanroom-guard.mjs` that throws ends in a denial (exit 2), never exit 0.
- `scripts/check-names.mjs` reports a private-name hit by file, line and denylist index only; no output ever contains the name.
- `scripts/verify-attestation.mjs` duplicates the chain and signature code of `mcp/cleanroom.mjs` on purpose, and a test feeds both the same fixtures and asserts identical results.
- `policies.archive`'s default `true` (an owner decision since 0.7.2, not an ⚠️ ASSUMPTION) is written only in `cfgFrom`.
- ⚠️ ASSUMPTION values each live in one place: the "at least three" sweep only in the review-build skill; the 60-line budget only in the plan-build skill; `review.mutationFixRounds`' 2, `cleanroom.similarity.separationMargin`'s 0.0 and `cleanroom.idleGapHours`' 3 only in `cfgFrom`; the 50 ms hook budget only in `test/cleanroom.mjs`; 4000 only in `TARGET_MAX`; the 100 ms log-socket budget only in `test/sandbox.mjs`; `MODEL_FAMILIES` only in `mcp/cleanroom.mjs`.
- `scripts/verify-attestation.mjs` duplicates `KNOWN_LIMITS`, `knownLimitsFor` and the `level`-aware `coverageGaps` of `mcp/cleanroom.mjs` on purpose, and `test/attest.mjs` feeds both copies the same inputs.
- The controller and the checkpoint key stay outside the boundary: nothing in `scripts/sandbox-entry.mjs` or `mcp/relay.mjs` reads a key, writes `.kukulu/`, or opens a network connection except the loopback bridge; `scripts/sandbox.mjs` is the only file that spawns a container engine.
- Every `spawnSync("git", …)` in `mcp/server.mjs` goes through `gitArgv` once P2-08 of flight v0-8-0 lands, so the sandbox's `-c core.hooksPath` and `-c core.fsmonitor=false` reach every git call.

## Task protocols

**Adding a tool.** Insert its `TOOLS` entry at the position the task names, and the name at the same position in `test/protocol.mjs`'s `EXPECTED_TOOLS`. Set the count in `test/plugin.mjs` to the number of `name: "kukulu_` entries in `TOOLS`, and spell the same number in words on the first line of `docs/mcp-tools.md` ("Nineteen tools", "Twenty tools", "Twenty-one tools") and in `README.md`'s "The server exposes <n> tools." sentence; add the tool's row to `README.md`'s tool table. Append `mcp__plugin_kukulu_kukulu__<tool>` to the `tools:` line of the agent the task names (for the flight controller: both spellings, `mcp__plugin_kukulu_kukulu__<tool>` and `mcp__kukulu__<tool>`, on go-flight's `allowed-tools`). Add a `## <tool>` section to `docs/mcp-tools.md`. Removing a tool is the same steps in reverse.

**Prose names only real tools.** `test/plugin.mjs` fails when README, `docs/*.md`, CONTRIBUTING, CHANGELOG, a skill or an agent names a `kukulu_*` tool the server does not define, so a document may name a new tool only from the task that adds it.

**Changelog.** Add each user-visible change under `CHANGELOG.md`'s `## [Unreleased]` (Added, Changed, Fixed, Breaking changes); the release task renames that heading. `test/plugin.mjs` requires the newest numbered entry to equal the package version.

**Tuning an assumption.** Before = the ⚠️ ASSUMPTION default SPEC names; after = what the task measures, with its headroom. Write the method, the raw numbers and both values to `docs/spikes/<ID>.md` (markdownlint-clean), and put them on the commit body's `Measurement:` line and in the progress log. Change a default only when the task says the measurement requires it; otherwise a new default is the human's call.

**Clean-room tests.** Never touch the developer's home: the harness's `startServer` gives every server a per-repo temp `KUKULU_CLEANROOM_KEY`, and a test that runs a hook script sets `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` and `HOME` itself. Generate keys at runtime in a temp directory and never commit a PEM (gitleaks). A test that edits the plugin (a hook script, `hooks/hooks.json`, `mcp/cleanroom.mjs`) does it in a temp copy of the plugin and starts that copy's `mcp/server.mjs` (`startServer(repo, { server })`). Hook payloads are JSON on stdin, shaped as Claude Code sends them. Recorded shell commands live in `test/fixtures/`, never inline in a `test/*.mjs`.

**Adding a `docs/kukulu.json` key.** Validate it in the config validator with a refusal for every bad shape. Add a row to `docs/operations.md`'s configuration table, and make sure `test/plugin.mjs`'s "config keys documented" loop covers it (it reads `cfg()`'s top-level keys; a nested key needs its own branch, like `policies` and `parallel`).

**Signing tests.** Never depend on the developer's own git config. A failing signer is local `commit.gpgsign true`, `gpg.format openpgp` and `gpg.program /nonexistent-signing-agent` (as the existing run-policies tests do). A working signer is `test/harness.mjs`'s `mkFakeGpg()` plus `useFakeSigner(repo, path)` (added by P1-13). A test that unsets the local `commit.gpgsign` must give the server an isolated global config (`startServer(repo, { env: { GIT_CONFIG_GLOBAL: <temp file> } })`). A fake SSH signer is a script written into a temp directory that prints a recorded line from `test/fixtures/signing/` to stderr and exits 1, with repo-local `gpg.format ssh`, `gpg.ssh.program <script>`, `user.signingkey key::<literal public key>` and `commit.gpgsign true`; never a real key or a PEM.

**Commit-failure tests.** To make a Kūkulu commit fail without signing, write an executable `.git/hooks/commit-msg` that exits 1 when the message starts with the subject under test (for example `progress:`). Assert that every file the tool wrote is byte-identical afterwards, that `git diff --cached --name-only` is empty, and that HEAD did not move.

**Adding a site check.** A `check-site.mjs` failure is one line, `check-site: rule <n>: <file>: <what is wrong>; <what to do>`. Every new check gets a self-test case `{ rule, name, inject, expect }` in `CASES`; the self-test runs each case on a fresh temp copy of `site/`, `checks.json`, `package.json` and the site scripts, after a clean baseline that must pass. Never loosen a check to fit the page; fix the page.

**Measuring an assumption.** Before = the ⚠️ ASSUMPTION default from `docs/site/checks.json`; after = the value `node scripts/check-site.mjs --report` measures, with its headroom. Put both on the commit body's `Measurement:` line and in the progress log. Never change `docs/site/checks.json`; a new default is the human's call.

**Changing a guard rule.** Every change to `evaluate` in `mcp/cleanroom.mjs` adds deny and allow cases to `test/fixtures/guard-cases.json` whose names end in `(<task id>)`, after a space. An existing fixture may change its `expect` or `reason` only when the task names that fixture's form, and the commit body lists every one it changed (`git diff <merge-base>..HEAD -- test/fixtures/guard-cases.json` is how the reviewer checks). The same commit updates the rule's text in `docs/cleanroom.md`. A fixture's `reason` is a regular expression; `__ROOT__` and `__HOME__` are substituted in `input` only, never in `policy` or `reason` (write a policy path repo-relative, and a reason path as `.*`). The file is indented with one space: append cases with a script that loads it and dumps it with `indent=1` and no ASCII escaping, so the diff stays one block per case. Run `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json` before committing.

**Adding a test suite.** Register it in `test/run.mjs`'s `SUITES` at the position the task names; add its row to CONTRIBUTING.md's suite table and update CONTRIBUTING's two suite counts ("Harness plus N suites", `# all N suites`); update README's two counts (the `test/` line of the repo layout and the "N suites, about …" sentence under Testing) and `test/plugin.mjs`'s "README counts N suites" assertion to the new number word. Thirteen before flight v0-8-0, fourteen after P0-05, fifteen after P2-02.

**The fake docker.** `test/harness.mjs`'s `mkFakeDocker()` returns a directory holding a `docker` script to prepend to `PATH`; it appends every invocation to `<dir>/calls.log` and answers from files in that directory (`version.txt`, `image-inspect.txt`, `image-missing`, `inspect.json`, `run-exit`, `exec-output`), with `exec` running the trailing `sh -c <command>` locally when no `exec-output` exists. Recorded engine output lives in `test/fixtures/docker/`, copied into the directory by the test; never inline in a `test/*.mjs`. A server under test gets `KUKULU_SANDBOX=<container name>`, `KUKULU_SANDBOX_ENGINE=docker` and `KUKULU_SANDBOX_HOOKS_PATH=<temp dir>` through `startServer(repo, { env })`. Tests never need a real engine; only the `KUKULU_SANDBOX_IT=1` step does.

**Sandbox sockets in tests.** A Unix socket path is limited to about 100 bytes on macOS, so put sockets under a short temp directory (`os.tmpdir()` plus a short name), never under the repo. Start listeners in-process through the exported `startControllerSocket`, `startLogSocket`, `startProxy` and `startBridge`, and close them in a `finally`. Run `scripts/sandbox.mjs`'s CLI through its exported `main(argv, { platform, env, cwd })`, passing `platform: "linux"`, so the darwin refusal never fires on macOS CI.

**HANDOFF.md.** `kukulu_run_finish` uses `docs/HANDOFF.md` as the draft PR's body. When a flight's spec says its result must not be merged yet (the 0.5.0 flight's did, until a human had run a flight from the working tree), put that instruction in the first line, in bold.

## Commit template

```text
<ID>: <title>

Goal: <one sentence>
Tests: <test files and assertion names added or changed>
Interpretation: <each choice where the task allowed two readings, or "none">
Measurement: n/a
Manual check: <NOT VERIFIED (human): what to check>, or "none"
```

Write the message to a file and commit with `git commit -F <file>`.

## Flight kukulu-tech-specification notes

This flight builds the kukulu.tech landing page in `site/` and its checkers. It changes no plugin behavior.

Principles (SPEC §3), as a checklist for every site task:

- `site/` holds exactly the §4 files: `index.html`, `404.html`, `styles.css`, `copy.js`, `_headers`, `robots.txt`, and every file under `docs/site/assets/` at the same path, byte-identical.
- `docs/site/mockup.html` is the approved design and copy. Copy its words, numbers, headings, table cells, link targets and `aria-*` exactly. Write the display name with U+016B, never in ASCII.
- No `style=` (inline SVG included), no `<style>`, no `on*=` attribute. All styling is in `site/styles.css`. A token colour on SVG comes from a class or `currentColor`, never `fill="var(--x)"`.
- One script, `<script src="/copy.js" defer></script>`, in `index.html` only. `copy.js` is one IIFE whose line 2 is `const COPY_FEEDBACK_MS = 2400;`, indented two spaces; at most 2,048 bytes.
- No third-party request: root-relative `src`, `<link href>` and `url()` only; canonical `https://kukulu.tech/`; `og:image` `https://kukulu.tech/og.png`.
- Tokens: one `:root{…}` (dark), one `@media (prefers-color-scheme: light){:root{…}}`, and `@media print` repeating the light rule, with the mockup's names and values. No `data-theme`, no theme toggle.
- Copy buttons start `hidden`; `styles.css` has `[hidden]{display:none !important}`.
- Node ≥ 22 built-ins only, `node:` prefix, no shebang in the new scripts (pre-commit would then demand the executable bit). Write a macron letter in script source as `\u016b`.

Names shared across tasks:

- `scripts/check-site.mjs` exports `loadConfig(file)` (validates `docs/site/checks.json`, refuses unknown keys and wrong types, never defaults), `checkSite(opts)` → `[{ rule, file, message }]`, `parseHtml`, `textContent`, `visibleText`, `contrastReport`. Its CLI runs only as the entry script: no flag, `--self-test`, `--report`.
- `scripts/serve-site.mjs` exports `async start({ port })` → `{ url, close }`. Port: argument, then `SITE_PORT`, then `servePort`.
- Rule numbers follow SPEC §3. Rule 4 also covers `COPY_FEEDBACK_MS`, the script budget, the four copy blocks and the `[hidden]` rule. Rule 9 also covers matching the mockup's token sets. Rule 11 runs `scripts/check-names.mjs` over the site directory.
- The four copy blocks: `install-session` (hero), `install-shell`, `spec-template`, `flight-cmd`, each with a `<id>-status` element.

Interpretation points decided for this flight: `\bKukulu\b` is case-sensitive; the 404 page has no nav and no footer; `docs/site/checks.json` values never change in this flight.

## Flight v0-7-0 notes

This flight builds Kūkulu 0.7.0 (SPEC §1): it ends the foundry compatibility period, closes the logged friction, and adds clean-room mode. The plugin running the flight is the installed 0.6.1, so nothing the flight changes affects the server running it.

- Every task is serial. `baseBranch` is `cleanroom`; build branches are `build/<date>`.
- Never edit `docs/SPEC.md`, `docs/site/copy-changes.json`, `docs/site/checks.json`, `docs/site/assets/`, `docs/site/screens/`, `docs/plans/` or `docs/flights/`.
- `kukulu_migrate` may be named only in `CHANGELOG.md` and `README.md` once P0-03 has removed it.
- Tool positions: `kukulu_run_resume` after `kukulu_run_halt`, `kukulu_cleanroom_record` after `kukulu_flight_options`, `kukulu_similarity` after `kukulu_summary_commit`, `kukulu_attest` after `kukulu_similarity`. Counts follow the server: 21 after P0-03, 25 at the end.
- Never write another project's real name in a tracked file. Use its label (`project-a` … `project-d` exist; cite items as `project-c F-08`). This repository and cleanflate are public.
- The display name is Kūkulu in prose; in script source write its macron letter as a Unicode escape, never the literal character.

Clean-room vocabulary (SPEC §5.2, §6 D–F), fixed for every task:

- Clean-room mode is on when the file at `cleanroom.policy` (default `docs/cleanroom.json`) exists. In code, "clean-room mode" means `state.cleanroom.genesis` is set; general mode is `state.cleanroom` absent or `{ mode: "general" }`, which `kukulu_run_start` records.
- The log is `.kukulu/cleanroom/log.jsonl` (`KUKULU_CLEANROOM_LOG` overrides it, for tests and the guard self-test only). The key is `KUKULU_CLEANROOM_KEY`, else `cleanroom.signingKey`, else `~/.config/kukulu/cleanroom/ed25519.pem`, with `<key>.pub` beside it.
- `mcp/cleanroom.mjs` exports, by these names: `CleanroomError`, `loadPolicy`, `policyHash`, `ENTRY_KEYS`, `KINDS`, `ZERO_HASH`, `TARGET_MAX`, `truncateTarget`, `canonical`, `entryHash`, `appendEntry`, `readEntries`, `verifyChain`, `logPathFor`, `targetOf`, `projectContext`, `entryFields`, `generateKey`, `loadKey`, `keyFingerprint`, `CHECKPOINT_KEYS`, `signCheckpoint`, `verifyCheckpoint`, `splitSegments`, `shellWords`, `commandWord`, `isPathLike`, `canonicalPaths`, `NETWORK_COMMANDS`, `READ_FAMILY`, `WRITE_FAMILY`, `lockdownActive`, `protectedPaths`, `evaluate`, `LANGUAGES`, `tokenize`, `scorePair`, `position`, `verdictOf`, `LIMITS`, `coverageGaps`, `KNOWN_LIMITS`. Its only writes are `appendEntry` and `generateKey`, on the paths they are handed; the server maps a `CleanroomError` to a `ToolError`.
- Hook stdin carries `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, `agent_type` and `agent_transcript_path` (subagents), `model` when present, `tool_response` (PostToolUse) and `prompt` (UserPromptSubmit). Exit 2 blocks the call and stderr reaches the model.
- Every dirty-tree check tolerates `.kukulu/cleanroom/log.jsonl` the way `kukulu_task_done` tolerates `docs/PROGRESS.md`, because the hooks append to it on every call. Never stage or edit that file by hand.
- Cleanflate's recorded data: the sibling checkout `../cleanflate` of the public `https://github.com/ericmann/cleanflate`, read at `85f210084a367dcc706c732f5776bf0563cdc0cd` (tag `v0.3.0-cleanroom`) with `git -C ../cleanflate show <sha>:<path>`. If it is absent, `git clone --depth 1 --branch v0.3.0-cleanroom` it into a temp directory; if neither works, block the task saying so.

The first line of `docs/HANDOFF.md`, in bold: **Do not merge until the owner has run one clean-room flight from the working tree and deployed the site preview (SPEC §8 Phase 6).**

SPEC.md wins over PLAN.md, and PLAN.md wins over code comments.

## Flight v0-7-1 notes

This flight builds Kūkulu 0.7.1 (SPEC §1): a cleanup patch with no new tools, no removed tools and no renamed input fields. The plugin running the flight is the installed 0.7.0, so nothing the flight changes affects the server running it; where the v0-7-0 notes above disagree with these, these win for this flight.

- Every task is serial. `baseBranch` is `main`; build branches are `build/<date>`. The draft PR targets `main`.
- The tool count stays 25: `docs/mcp-tools.md`'s first line keeps "Twenty-five tools" and README keeps "The server exposes twenty-five tools."
- `docs/HANDOFF.md` has no "do not merge" line: this release has nothing a human must run first (SPEC §8 Phase 2).
- Never edit `docs/SPEC.md`, `docs/flights/`, `docs/plans/`, `site/` or `docs/site/`. `docs/feedback/2026-10-20-kukulu.md` is gitignored: only P2-02 edits it, only its header, and never stages it.
- The running 0.7.0 server does not have B-02's refusal yet, so `progress-no-bare-macron` is enforced only by `kukulu_verify`, after the log is committed. Write the macron letter in a `kukulu_task_done` log or a reason only inside the display name; spell it "the macron u" or "U+016B" otherwise, and never as an escape in the JSON argument.
- This flight's `docs/kukulu.json` has no `policies` block: the running 0.7.0 server refuses `policies.syncBase` as an unknown key. Do not add one.

Guard vocabulary, fixed for every guard task (SPEC §3 principle 1, §6 A):

- The guard is a tripwire, not a sandbox: an option or wrapper spelling the tables do not model is a known gap, not a defect. Change only the rule the task names; do not widen a parser "while you are there".
- "These rules" are `docs/cleanroom.md`'s rule list; "the fixture set" is `test/fixtures/guard-cases.json`. Follow the guard-rule protocol in Task protocols, with the task's id at the end of each new fixture name, for example `git add docs/* (P0-04)`.
- Fixture `policy: "template"` loads `templates/cleanroom.example.json`: its `deny.words` include `zlib` and `miniz`, its `allow.paths` are `crates/cleanflate/`, `crates/oracle/` and `docs/`, so a bare `zlib.txt` at the root is outside them.
- The always-protected set reaches `<root>/docs/cleanroom.json`, `<root>/.kukulu/cleanroom`, `<root>/.kukulu/state.json` and, once the plan exists, `<root>/docs/kukulu.json`; `protectedPaths` lists them in that order.
- A reason names the path as resolved and the directory as the command wrote it: `protected path: <abs path> (<word> writes it into <dir>)`.
- `KNOWN_LIMITS` has eight entries after P0-01; `CHECKPOINT_KEYS` never changes in this flight.

Pipeline vocabulary (SPEC §6 B):

- B-02's helper reads the same constraints, `from` activation and fixture self-test as `kukulu_verify`; it never runs a verify command.
- B-03's merge happens only on a clean tracked tree, through `commitStaged`, with stage `implement` and task `-`; a conflict is `git merge --abort` plus a refusal, never a halt.
- `policies.syncBase` defaults to `true` in `cfgFrom` only; it is an owner decision, not an ⚠️ ASSUMPTION.

## Flight v0-7-2 notes

This flight builds Kūkulu 0.7.2 (SPEC §1): a patch with no new tools, no removed tools and no renamed input fields. The plugin running the flight is the installed 0.7.1, read from the plugin cache, so none of the new behavior is active while the flight runs. Where earlier flights' notes disagree with these (their task ids included), these win for this flight.

- Every task is serial. `baseBranch` is `main`; build branches are `build/<date>`. The draft PR targets `main`; the running 0.7.1 titles it `Build: <branch>`.
- The tool count stays 25: `docs/mcp-tools.md`'s first line keeps "Twenty-five tools" and README keeps "The server exposes twenty-five tools."
- `docs/HANDOFF.md` has no "do not merge" line (SPEC §6 E).
- Never edit `docs/SPEC.md`, `docs/flights/`, `docs/plans/`, `site/` or `docs/site/`. The three gitignored feedback files of SPEC §1 are edited only by P3-04, only in their header, and never staged.
- P0-01 is the only task that edits `agents/*.md`, and only their `model:` and `effort:` lines (the base commit `418b291` broke 44 assertions in the `plugin`, `state`, `routing` and `drive` suites, and `no-fable-default`). Until it lands, `npm test` and `kukulu_verify` fail on those checks alone.
- This flight's `docs/kukulu.json` sets only `policies.archive: true`, because the running 0.7.1 defaults it to `false`. Do not add `prTitle` or any other key to it.
- `CHANGELOG.md`: lines go under `## [Unreleased]`, `### Changed` or `### Fixed` only. There is no `### Breaking changes` heading, so this flight's own PR is not breaking (SPEC §6 E).
- Write the macron letter in a `kukulu_task_done` log or a reason only inside the display name; spell it "the macron u" otherwise. In test source write the macron letter as a Unicode escape, or use an ASCII stand-in heading such as `# Widget 1.0 — Specification`.
- Recorded `gh` output lives in `test/fixtures/gh/`, signer stderr in `test/fixtures/signing/`; commit them in the task that adds them. Extend `test/harness.mjs`'s `mkFakeGhBin` rather than writing a second fake `gh`.

Signing vocabulary (SPEC §6 B):

- `signingProbe()` (P1-01) returns `{ signedOk, unsignedOk, line }`: a `git commit-tree -S` and a `git commit-tree --no-gpg-sign` on the empty tree from `git hash-object -t tree /dev/null`, each bounded by `SIGNING_TIMEOUT_MS`; it writes only dangling objects. `commitStaged`, `probeSigning` and the plan-stage probe (P1-04) use it.
- `state.signing` is `"on"`, `"off"`, `"none"`, `off (probe failed: …)` or `off (commit signing failed: …)`. `state.signingOverride: true` means the server wrote the local `commit.gpgsign false`; a local `false` without it is the operator's and is never touched.
- `signaturesExpected(policy, signing)` and `signingNoteFor(signing)` (P1-03). The notes are "Commits in this run are unsigned and kukulu_pr_finalize will not wait for signatures." and "Commits from here on are unsigned; kukulu_pr_finalize will wait for signatures, so unlock the signing agent and call kukulu_run_start again to resume signing, or re-sign at the end."

PR vocabulary (SPEC §6 C):

- `prTitleFor(c, branch)` (P2-01): `prTitle`, else `<flight>: <spec title>`, else `Build: <branch>`, cut to 120 code points. `changelogVerdict()` (P2-04) reads `CHANGELOG.md`'s first `## [` entry.
- The `gh pr merge` arguments stay one inline array literal with `"--auto"` right after `"merge"`; `--subject` goes after it (`no-sync-merge`).

Guard vocabulary (SPEC §6 A, §3 principle 1):

- The guard is a tripwire, not a sandbox. Change only the rule the task names; an unmodelled spelling is a known gap, not a defect.
- Fixture `policy: "template"` loads `templates/cleanroom.example.json`. The always-protected set is `<root>/docs/cleanroom.json`, `<root>/.kukulu/cleanroom`, `<root>/.kukulu/state.json` and, once the plan exists, `<root>/docs/kukulu.json`, in `protectedPaths` order.
- Reasons: `protected path: <abs path> (rsync --delete* can remove it from <dest>)`, `(rsync --remove-source-files removes it)`, `(rsync writes it into <dest>)` and `(<word> extracts into <dir>; the archive's contents cannot be known)`, where `<word>` is `tar`, `bsdtar` or `gtar` as written.

Carried from the 0.7.1 summary:

- During a merge git refuses `git commit -- <paths>`, so the server's merge commit is a no-pathspec commit (`commitStaged`'s `noPathspec`); an aborted merge has `withRollback` restore the clean-room log byte for byte.
- `kukulu_verify`'s output is large because it lists every constraint result; the useful parts are `ok` and the `npm test` summary.
- The targeted `cleanroom` suite reports a guard mutant only as the gate's self-test failure; to see which fixture caught it, run the guard self-test directly.

SPEC.md wins over PLAN.md, and PLAN.md wins over code comments.

## Flight v0-8-0 notes

This flight builds Kūkulu 0.8.0 (SPEC §1): one new tool (`kukulu_release`), optional policy, log and manifest fields, and the sandbox. The plugin running the flight is the installed 0.7.2, so none of the new behavior is active while the flight runs; where earlier flights' notes disagree with these, these win.

- Every task is serial. `baseBranch` is `main`; build branches are `build/<date>`. The draft PR targets `main`; `policies` is `{ "archive": true, "finalize": "ready" }`, so finalize marks the PR ready and never enables auto-merge.
- Tool count: 25 until P4-01, then 26 ("Twenty-six tools" in `docs/mcp-tools.md`, "twenty-six tools" in README). `kukulu_release` goes after `kukulu_pr_finalize` and on go-flight's `allowed-tools` in both spellings; no stage agent gets it.
- Never edit `docs/SPEC.md`, `docs/flights/`, `docs/plans/`, `site/`, `docs/site/` or `docs/kukulu.json` (its `from` entries already name P2-01 and P2-02). Feedback files are not edited in this flight.
- `CHANGELOG.md`: lines go under `## [Unreleased]` (P0-01 creates it above `## [0.7.2] — 2026-10-26`), under `### Added`, `### Changed` or `### Fixed`, each citing its goal (`G-06`), feedback item or note. No Breaking changes heading (SPEC §1).
- The first line of `docs/HANDOFF.md`, in bold: **Do not merge until the owner has run one sandboxed clean-room flight from the working tree on Linux (`node scripts/sandbox.mjs run`) and its bundle verifies with `--require-enforcement container+proxy` (SPEC §8 Phase 2).**
- The macron letter: in prose Kūkulu; in script and test source as the Unicode escape of U+016B (backslash, `u`, `016b`), never the literal character; in a `kukulu_task_done` log or a reason only inside the display name.
- New scripts have no shebang and run their CLI only when `import.meta.url` is the entry script; `scripts/sandbox.mjs` and `scripts/compare-bundles.mjs` may import `../mcp/cleanroom.mjs`; `mcp/relay.mjs`, `scripts/sandbox-entry.mjs`, `scripts/model-identity.mjs` and `scripts/publish-bundle.mjs` import `node:` modules only. `scripts/sandbox.mjs` may not spell `--privileged`, `--cap-add`, `--pid=host`, `docker.sock` or `podman.sock` even in a comment.
- Spikes: `docs/spikes/P0-04.md` (MODEL_FAMILIES), `docs/spikes/P2-03.md` (the log socket's 100 ms budget), `docs/spikes/P2-04.md` (proxy overhead, informational). Each follows "Tuning an assumption" or "Measuring an assumption" with the `Measurement:` line.
- Recorded data lives in `test/fixtures/`: `families.json`, `identity/`, `docker/`, `lockfiles/`, `transcripts/`, `compare/`, `bundles/v0-7-2/`, `gh/`. A committed bundle holds a public key and signatures only; never a PEM private key.

Vocabulary fixed for every task (SPEC §5, §6):

- Runners live in the global file under `runners.<name>` (`endpoint`, `locality`, `match`, `identities`); the built-in runner is `anthropic` (`https://api.anthropic.com`, remote); an unmatched model has runner `null` and locality `unknown`. `resolveRouting().roles[role]` carries `model`, `runner`, `endpoint`, `locality`.
- `normalizeModel` lowercases and strips every `<segment>/` or `<segment>,` prefix; `familyOf` returns a `MODEL_FAMILIES` family or `unknown:<normalized>`.
- Genesis `data` gains `roles`, `distinct`, `mode` (`clean-room` or `control-positive`), `control.priorArt`, `enforcement` (`hook` or `container+proxy`) and `boundary`. Gate checks: 8 `routing`, 9 `boundary` (container+proxy only), 10 `packages` (deny.packages only); the gate line counts what ran.
- Entry kinds added: `egress` (the proxy's decisions), `stage` (`kukulu_next`'s start and end), `usage` (SubagentStop token sums). Entries reported from inside the boundary carry `data.source: "box"`.
- The verifier: check 11 `enforcement`, check 12 `roles`; `--expect clean-room|control-positive`, `--require-enforcement <level>`; exit 0 pass, 1 fail, 2 usage, 3 `CONTROL (positive)`. `ENFORCEMENT_LEVELS` is `hook` < `container+proxy` < `container+proxy+audit`; `knownLimitsFor("hook")` has ten texts, `knownLimitsFor("container+proxy")` five.
- The sandbox: container `kukulu-<project id>` (16 hex of the real root's SHA-256), home volume `kukulu-<id>-home`, runtime dir `$XDG_RUNTIME_DIR/kukulu/<id>/` (else `~/.cache/kukulu/run/<id>/`) holding `controller.sock`, `log.sock`, `proxy.sock`, `hooks-empty/`, `run.json`; inside, `/run/kukulu/*.sock`, `127.0.0.1:3128`; env `KUKULU_CONTROLLER_SOCKET`, `KUKULU_LOG_SOCKET`; the controller child gets `KUKULU_SANDBOX`, `KUKULU_SANDBOX_ENGINE`, `KUKULU_SANDBOX_HOOKS_PATH`. The policy's image digest is the engine's image id.
- Refusal texts are quoted in PLAN.md; copy them verbatim.

SPEC.md wins over PLAN.md, and PLAN.md wins over code comments.
