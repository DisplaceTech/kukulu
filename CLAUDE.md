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

## Commands

- `npm run lint`: syntax and manifest lint, under 2 s.
- `pre-commit run --all-files`: hygiene, markdownlint, shellcheck, yamllint, gitleaks, about 4 s.
- `npm test`: all eleven suites, about 90 s.
- `npm test -- state review`: named suites only; `node test/review.mjs`: one suite directly; `KEEP_REPO=1 npm test -- drive`: keep the temp repos.
- `npm run check:site`: `node scripts/check-site.mjs --self-test && node scripts/check-site.mjs`, the static site rules (SPEC §3 rules 1–14); `node scripts/check-site.mjs --report` prints measured sizes and contrast against `docs/site/checks.json`.
- `npm run check:site:browser`: rule 15 in headless Chrome (needs Chrome or Chromium; `CHROME_PATH` overrides discovery; binds `servePort`, so one at a time); `--shots` writes `.site-shots/<width>-<scheme>.png`.
- `npm run site:serve`: serve `site/` on `127.0.0.1` with `site/_headers` applied (`SITE_PORT` or `--port N`); `node scripts/serve-site.mjs --self-test` checks it on an ephemeral port.

## Module map

| Path | Responsibility |
|---|---|
| `mcp/server.mjs` | Every deterministic operation and the JSON-RPC transport; one file |
| `mcp/run-command.mjs` | Runs one bounded command in its own process group (unchanged) |
| `scripts/implement-guard.mjs` | Stop/SubagentStop hook (unchanged) |
| `agents/*.md` | Default model, effort and `tools:` per role; the tool list is the contract |
| `skills/*/SKILL.md` | Stage prose |
| `templates/` | SPEC skeleton, routing example, constraint examples |
| `test/harness.mjs` + eleven suites | `plugin`, `protocol`, `state`, `implement`, `review`, `routing`, `constraints`, `feedback`, `streams`, `guard`, `drive` |
| `docs/*.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | User and maintainer docs |
| `site/` | The kukulu.tech landing page, deployed as-is by Cloudflare Pages; a closed file set |
| `docs/site/` | The site's inputs: approved mockup, screens, seeded assets, `checks.json`, `DEPLOY.md`; never deployed |
| `scripts/check-site.mjs` | Static site checks with `--self-test` and `--report`; exports `loadConfig`, `checkSite`, `parseHtml`, `visibleText` |
| `scripts/serve-site.mjs` | Local server for `site/`; exports `start({ port }) → { url, close }` |
| `scripts/check-site-browser.mjs` | Rule 15 through Chrome's DevTools protocol and Node's built-in `WebSocket` |

## Constraints

Mechanical rules are in the `constraints` of a flight's `docs/kukulu.json`, which the planner writes and the archive moves to `docs/flights/<slug>/` when the flight ends (the last archived set is `docs/flights/v0-5-0/foundry.json`). They run on every `kukulu_verify`:

- `server-synchronous`: no `async` or `await` anywhere in `mcp/server.mjs`, including comments and strings. Long work uses `spawnSync`.
- `no-dependencies`: `package.json` has no `dependencies` or `devDependencies`, and there is no lockfile.
- `no-fable-default`: no `agents/*.md` frontmatter line reads `model: fable`.
- `no-sync-merge`: `gh pr merge` only ever runs with `--auto`, written as one inline argument array in `mcp/server.mjs`.
- `no-gnu-sed-inplace`: no `sed -i` in `test/`, `scripts/` or `mcp/`; BSD sed on macOS rejects it. Write to a temp file and `mv`.
- `site-no-inline-style`, `site-no-inline-handler`, `site-404-no-script`, `site-one-script-form`: no `style=` or `<style>`, no `on*=` attribute, no script in `site/404.html`, and `site/index.html`'s only script is `<script src="/copy.js" defer></script>`.
- `site-root-relative-src`, `site-css-root-relative`, `site-self-contained`: every `src=`, `<link href=` and CSS `url()` in `site/` is root-relative (the canonical `https://kukulu.tech/` excepted), there is no `@import`, and nothing references `docs/`, `scripts/`, `assets/` or `../`.
- `site-display-name-ascii`, `site-no-theme-attr`, `site-no-cache-control`, `copy-buttons-start-hidden`: no `\bKukulu\b` in the site's HTML, no `data-theme`, no `Cache-Control` in `site/_headers`, and every `[data-copy-for]` button carries `hidden`.
- `no-hardcoded-copy-feedback`, `no-hardcoded-site-tunables`: the ⚠️ ASSUMPTION values in `docs/site/checks.json` (2400, 65536, 184320, 2048, 4.5, 8788) are never literals in the site scripts; `copyFeedbackMs` appears only in `copy.js`'s `const COPY_FEEDBACK_MS = 2400;`.
- `site-scripts-node-builtins`: the three site scripts import only `node:` modules or each other (`./`); no Playwright, Puppeteer or `ws`.

The reviewer checks these by reading, because no line pattern can express them:

- Refusals before writes; rollback on a failed commit (principle 3).
- `fable` stays a legal alias (`ANTHROPIC_ALIASES`, `AGENT_TOOL_ALIASES`).
- `TASK_ID`, `TASK_LINE` and the guard's task regexes are unchanged; only `kukulu_plan_commit`'s renumber mode accepts a suffix such as `P1-02a`. The guard's `RUN_START_TOOL` and agent-type set accept both the `kukulu` and the pre-0.6.0 `foundry` names until 0.7.0, and nothing else about them changes.
- No existing file under `docs/plans/` changes (new plans may be added); under `docs/feedback/` only the "addressed in" header lines (P3-04). Never edit `docs/SPEC.md`, and never edit `docs/PLAN.md` or `docs/PROGRESS.md` by hand.
- Nothing under `docs/site/` changes, and nothing under `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/` changes for the site. `check-site.mjs` and `serve-site.mjs` never write into `site/`; `check-site-browser.mjs` writes only to `.site-shots/`, and only with `--shots`.
- `site/` matches the mockup visually with semantic class names and shared rules; it is not the mockup with its inline styles moved into classes one by one.
- ⚠️ ASSUMPTION values each live in one place: `policies.archive`'s default `false` only in `cfg()`; the "at least three" sweep only in the review-build skill; the 60-line budget only in the plan-build skill.

## Task protocols

**Adding a tool.** Insert its `TOOLS` entry at the position the task names, and the name at the same position in `test/protocol.mjs`'s `EXPECTED_TOOLS`. Set the count in `test/plugin.mjs` to the number of `name: "kukulu_` entries in `TOOLS`, and spell the same number in words on the first line of `docs/mcp-tools.md` ("Nineteen tools", "Twenty tools", "Twenty-one tools"). Append `mcp__plugin_kukulu_kukulu__<tool>` to the `tools:` line of the agent the task names. Add a `## <tool>` section to `docs/mcp-tools.md`.

**Adding a `docs/kukulu.json` key.** Validate it in the config validator with a refusal for every bad shape. Add a row to `docs/operations.md`'s configuration table, and make sure `test/plugin.mjs`'s "config keys documented" loop covers it (it reads `cfg()`'s top-level keys; a nested key needs its own branch, like `policies` and `parallel`).

**Signing tests.** Never depend on the developer's own git config. A failing signer is local `commit.gpgsign true`, `gpg.format openpgp` and `gpg.program /nonexistent-signing-agent` (as the existing run-policies tests do). A working signer is `test/harness.mjs`'s `mkFakeGpg()` plus `useFakeSigner(repo, path)` (added by P1-13). A test that unsets the local `commit.gpgsign` must give the server an isolated global config (`startServer(repo, { env: { GIT_CONFIG_GLOBAL: <temp file> } })`).

**Commit-failure tests.** To make a Kūkulu commit fail without signing, write an executable `.git/hooks/commit-msg` that exits 1 when the message starts with the subject under test (for example `progress:`). Assert that every file the tool wrote is byte-identical afterwards, that `git diff --cached --name-only` is empty, and that HEAD did not move.

**Adding a site check.** A `check-site.mjs` failure is one line, `check-site: rule <n>: <file>: <what is wrong>; <what to do>`. Every new check gets a self-test case `{ rule, name, inject, expect }` in `CASES`; the self-test runs each case on a fresh temp copy of `site/`, `checks.json`, `package.json` and the site scripts, after a clean baseline that must pass. Never loosen a check to fit the page; fix the page.

**Measuring an assumption.** Before = the ⚠️ ASSUMPTION default from `docs/site/checks.json`; after = the value `node scripts/check-site.mjs --report` measures, with its headroom. Put both on the commit body's `Measurement:` line and in the progress log. Never change `docs/site/checks.json`; a new default is the human's call.

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

SPEC.md wins over PLAN.md, and PLAN.md wins over code comments.
