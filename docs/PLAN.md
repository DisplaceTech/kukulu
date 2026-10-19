# kukulu.tech build plan

Derived from docs/SPEC.md v0.1 on 2026-10-19. SPEC.md wins over this file.

## Decisions

- Phases → SPEC §8's two phases, in order. Task ids use SPEC's phase numbers (`P1-xx`, `P2-xx`); there is no Phase 0.
- SPEC §8 Phase 1 tasks 2 and 4 are each split in two, because each would be well over 400 lines (a full page of markup plus its stylesheet; ten static rules plus their self-test cases). Mapping: SPEC P1.1 = P1-01; P1.2 = P1-02 (styles foundation, head, header and hero, problem, How it works) + P1-03 (the rest of the page); P1.3 = P1-04; P1.4 = P1-05 (rules 3–7) + P1-06 (rules 9–14, the rest of rule 1, `check:site`, `lint.sh`); a tuning task P1-07; P1.5 = P1-08; P1.6 = P1-09. SPEC's "from P1 task 4" is therefore `from: "P1-06"`, and "from P2 task 1" is `from: "P2-01"`.
- Rule 1 split across tasks (Spec issue 1) → P1-01 checks the closed half (no file in `site/` outside the §4 list, no dotfile, no other `_` name); P1-06 adds the "every §4 file is present" half, once all of them exist. Rationale: SPEC wants rules 1, 2 and 8 running from P1-01, but `index.html` and four other files do not exist until P1-02–P1-04.
- The §4 file list for rule 1 → `index.html`, `404.html`, `styles.css`, `copy.js`, `_headers`, `robots.txt`, plus every file under `docs/site/assets/` at the same relative path. Rationale: it is exactly §4's list, and it stays in step with the seeded set by construction.
- Rule 11 inside `check-site.mjs` (Spec issue 2) → rule 11 runs `scripts/check-names.mjs` with the site directory as its root (`spawnSync(process.execPath, [checkNames, siteDir])`) and reports each line it prints as a rule 11 failure. Rationale: SPEC says `check-names.mjs` already enforces the rule, and the self-test still needs a rule 11 case.
- Self-test scope (Spec issue 3) → the self-test copies `site/`, `docs/site/checks.json`, `package.json` and whichever of the three site scripts exist into one temp directory per case. Reference inputs (`docs/site/mockup.html`, `docs/site/assets/`, `.claude-plugin/marketplace.json`, `scripts/check-names.mjs`) are read from the real repo and never modified. Rationale: rule 14 is about `package.json` and the scripts, so its injection needs copies of them.
- Failure message format → every failure is one line, `check-site: rule <n>: <file>: <what is wrong>; <what to do>`; config problems use `check-site: config: <file>: ...`. The self-test matches on `rule <n>` and a per-case substring.
- Assigning §5/§6 checks to rule numbers → the `COPY_FEEDBACK_MS` = `copyFeedbackMs` check, the 2,048-byte script budget, the four copy blocks' structure and the `[hidden]{display:none !important}` rule are rule 4 (the script rule). The light/dark token sets matching the mockup's are rule 9 alongside contrast.
- `\bKukulu\b` in rule 6 → case-sensitive. Rationale: the lowercase identifier `kukulu` appears in the hero commands and URLs and is correct there.
- Rule 6 reference text → computed from `docs/site/mockup.html` at check time with the same extraction as `site/index.html`; no copy of the mockup's headings, table or numbers is stored in the checker.
- Rule 12 reference text → the checker holds §6's `_headers` block as one string constant; `site/_headers` must equal it plus one trailing newline.
- `COPY_FEEDBACK_MS` placement vs "no globals" (Spec issue 4) → `copy.js` is one IIFE; line 1 opens it and line 2 is `  const COPY_FEEDBACK_MS = 2400;`. Rule 4 finds it with `/^\s*const COPY_FEEDBACK_MS = (\d+);$/m`, which must match exactly once. Rationale: a top-level `const` in a classic script is a global binding.
- `scripts/serve-site.mjs` tests (Spec issue 5) → it gains a `--self-test` flag that starts the server on `127.0.0.1` port 0, makes real requests, and exits non-zero on any mismatch. It is a `verify` command from P1-08. Rationale: SPEC names no test for the server, and port 0 cannot collide, so it is not `exclusive`.
- `start({ port })` → `async`; resolves to `{ url, close }`, where `close()` returns a Promise. Port precedence: `--port N`, then `SITE_PORT`, then `checks.json` `servePort`. `port: 0` is allowed and `url` reports the bound port.
- Shared config loading → `check-site.mjs` exports `loadConfig(file)`, and `serve-site.mjs` and `check-site-browser.mjs` import it from `./check-site.mjs`. Its CLI runs only when it is the entry script. Rationale: §4 allows exactly three new scripts, and each config key is validated in one place.
- SVG colour (Spec issue 6) → SVG colour that comes from a token is set by a class in `styles.css` (for example `.ic{stroke:var(--accent)}`) or by `currentColor`, never by `fill="var(--x)"`. Rationale: §3.3 allows presentation attributes or classes, and `var()` inside a presentation attribute is not reliable across browsers.
- 404 page → only §6's copy: skip link, header wordmark linking to `/`, `<main id="main">` with the h1, the paragraph and the link. No nav and no footer, because every word there would be copy §6 does not list.
- Tuning the ⚠️ ASSUMPTION values → one tuning task, P1-07, once every budget and the contrast rule are enforced (P1-06). It adds `--report` to `check-site.mjs` and records measured values against the defaults. It never changes `docs/site/checks.json`: SPEC §5 fixes the defaults, and a change is the human's call. `copyFeedbackMs` cannot be measured by a machine, so it is a manual check at P1-09; `servePort` has nothing to measure.
- `check:site` before P1-06 → `docs/kukulu.json` runs `node scripts/check-site.mjs --self-test && node scripts/check-site.mjs` from P1-01, the same command `check:site` names, so the rules P1-01–P1-05 write are verified on every task ("earlier tasks run the rules they have written directly", §7). From P1-06 `npm run check:site` runs as well.
- `pre-commit run --all-files` in `verify` → kept, as in the previous flight. CI's `lint` workflow runs the same hooks over the new HTML, CSS, YAML and JSON files.
- `npm test` extraVerify → on SPEC's paths, plus `.github/`, because `test/plugin.mjs` checks that every workflow's actions are pinned.
- Parallel streams → none; the plan is fully serial. Every page task builds on the markup and stylesheet of the one before it, and every checker task baselines against the finished page. The only independent pieces (`serve-site.mjs`, the CI workflow, the docs) are small, and `package.json` is shared wiring that four tasks edit.
- §9 questions → already decided in SPEC (no theme toggle, self-hosted fonts, marketplace name `displacetech`, no recording link). Recorded as given.

## Conventions

- One commit per task, titled `<ID>: <title>`, body per CLAUDE.md's Commit template.
- Every task runs the whole `verify` through `kukulu_verify`: `npm run lint`, `pre-commit run --all-files`, the site checks (from P1-01), `npm run check:site` (from P1-06) and the server self-test (from P1-08). `npm test` runs as extraVerify on `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/`, `package.json`, `scripts/lint.sh` and `.github/`. The browser check runs as an exclusive extraVerify on `site/`, `scripts/check-site-browser.mjs` and `scripts/serve-site.mjs` from P2-01.
- Each task restates the names it needs from earlier tasks.
- `site/` is the deploy directory; `docs/site/` is the flight's read-only input.

## Phase 1 — The page and its static checks

### P1-01: Seed site/ and start check-site.mjs with config validation and rules 1, 2 and 8

**Goal:** Copy the seeded files into `site/`, add `robots.txt`, and create `scripts/check-site.mjs` with config validation, rules 1 (closed half), 2 and 8, and a self-test that proves each.

**Files touched:** `site/marketplace.json`, `site/favicon.svg`, `site/favicon.ico`, `site/apple-touch-icon.png`, `site/og.png`, `site/fonts/` (the six `.woff2` files and two `OFL-*.txt` files), `site/robots.txt`, `scripts/check-site.mjs`

**Design constraints:**

- SPEC §4 paths: every file under `docs/site/assets/` goes to the same relative path under `site/` (`docs/site/assets/fonts/x` → `site/fonts/x`). Copy with `cp` or `fs.copyFileSync`, byte for byte. Never edit, regenerate or re-encode them (§2 non-goal). Never edit anything under `docs/site/`.
- `site/robots.txt` is exactly two lines, `User-agent: *` and `Allow: /`, each ending in `\n`.
- §3.14: Node built-ins only, imported with the `node:` prefix (`node:fs`, `node:path`, `node:crypto`, `node:os`, `node:url`, `node:child_process`). No shebang line: the file is run as `node scripts/check-site.mjs`, and pre-commit's shebang hook would then demand the executable bit. Write a non-ASCII letter such as the macron as a `\u016b` escape in this file, as `scripts/check-names.mjs` does.
- §5: `loadConfig(file)` (exported) reads `docs/site/checks.json` and refuses with `check-site: config: <file>: <problem>; <what to do>` on: invalid JSON; a missing or unknown top-level key (the known keys are `budget`, `viewports`, `contrastMin`, `contrastPairs`, `copyFeedbackMs`, `servePort`); `budget` not an object with exactly `textBytes`, `fontBytes`, `scriptBytes`, each a positive integer; `viewports` not a non-empty array of positive integers; `contrastMin` not a number from 1 to 21; `contrastPairs` not a non-empty array of two-string arrays whose strings start with `--`; `copyFeedbackMs` not a positive integer; `servePort` not an integer from 1 to 65535. No default is ever filled in. Never write a config value as a literal anywhere in the script (constraints `no-hardcoded-site-tunables`, `no-hardcoded-copy-feedback`).
- Exported `checkSite(opts)` returns an array of `{ rule, file, message }`. `opts` (each defaulting to the real repo path, with the repo root resolved from `import.meta.url`): `siteDir`, `configPath`, `mockupPath` (`docs/site/mockup.html`), `assetsDir` (`docs/site/assets`), `pluginMarketplacePath` (`.claude-plugin/marketplace.json`), `packageJsonPath`, `scriptPaths` (those of `scripts/check-site.mjs`, `scripts/check-site-browser.mjs`, `scripts/serve-site.mjs` that exist), `checkNamesPath` (`scripts/check-names.mjs`). It reads only; it never writes into `site/` (§4 boundary).
- Rule 1 (closed half only; P1-06 adds the "missing file" half): fail for every file under `siteDir` (recursively) that is not in the §4 list, and name any dotfile, source map, README or `_`-prefixed name other than `_headers` explicitly. The §4 list is `index.html`, `404.html`, `styles.css`, `copy.js`, `_headers`, `robots.txt`, plus every file under `assetsDir` at its relative path. Hold the six names as one constant `SITE_FILES`; derive the rest from `assetsDir`.
- Rule 2: for every file under `assetsDir`, `siteDir/<same path>` exists and its SHA-256 equals the source's (`node:crypto`). Name the file and both digests.
- Rule 8 (§3.8): `site/marketplace.json` parses; its `name`, `owner.name`, and its single `plugins[0]` entry's `name`, `description` and `license` equal `.claude-plugin/marketplace.json`'s; `plugins` has exactly one entry; the entry's `source` deep-equals `{ "source": "url", "url": "https://github.com/DisplaceTech/kukulu.git" }`; no entry has a string `source` or a `version` key. Each problem is its own failure.
- Message format: `check-site: rule <n>: <file relative to the repo or temp root>: <what is wrong>; <what to do>`.
- CLI, run only when the module is the entry script (`process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`), so other scripts can import `loadConfig`. Without flags: validate the config, run `checkSite()`, print each failure to stderr, exit 1 if any, otherwise print `check-site: ok (rules 1, 2, 8)` (the list of implemented rules) and exit 0. With `--self-test`: run the self-test (below), print `check-site self-test: ok (<k> cases)` or each failing case, exit accordingly. An unknown flag exits 2 with a usage line.
- Self-test: a `CASES` array of `{ rule, name, inject, expect }`. For each case, and once for a baseline, make a fresh temp directory (`fs.mkdtempSync(path.join(os.tmpdir(), "check-site-"))`) holding copies of `site/` as `site/`, the config as `checks.json`, `package.json`, and the existing site scripts under `scripts/`. Remove it afterwards. The baseline (no injection) must produce zero failures, or the self-test fails with "the clean copy fails rule <n>: <message>; fix site/ first". For a case, `inject({ dir, site, config, pkg, scripts })` edits the copies, and the case passes only when `checkSite` on the copy returns a failure whose `rule` equals the case's and whose message includes `expect`. Config cases (`rule: "config"`) pass when `loadConfig` on the edited copy throws a message that includes `expect`.
- Cases this task adds, at least: rule 1, a `site/.DS_Store`; rule 1, a `site/index.js.map`; rule 1, a `site/_redirects`; rule 2, one byte appended to `site/favicon.svg`; rule 2, `site/og.png` deleted; rule 8, the entry's `source` set to `"./"`; rule 8, a `version` added to the entry; rule 8, `description` changed; config, an unknown top-level key; config, an unknown `budget` key; config, `viewports` as the string `"360"`; config, `servePort` 0; config, `copyFeedbackMs` removed.

**Acceptance tests:** `node scripts/check-site.mjs --self-test` passes every case above, by name. `node scripts/check-site.mjs` exits 0 on the seeded `site/` and prints `check-site: ok (rules 1, 2, 8)`. `sha256sum docs/site/assets/og.png site/og.png` prints the same digest twice.

**Out of scope:** rules 3–7 and 9–14; the "missing file" half of rule 1; `package.json` and `scripts/lint.sh` (P1-06); any HTML, CSS or JS under `site/`.

**Verification:** `kukulu_verify` (from this task it runs `node scripts/check-site.mjs --self-test && node scripts/check-site.mjs`). `git status --short site/` lists only the §4 seeded files and `robots.txt`.

**Depends on:** none

### P1-02: styles.css foundation and index.html through How it works

**Goal:** Create `site/styles.css` with the tokens, fonts, base rules and the components the top of the page uses, and `site/index.html` with the full `<head>`, the skip link, the header (nav and hero), the problem section and How it works, reproducing `docs/site/mockup.html` lines 1–283.

**Files touched:** `site/styles.css`, `site/index.html`

**Design constraints:**

- The mockup is the approved design and copy (SPEC §2): copy every word, number, link target and `aria-*` attribute exactly, including typographic quotes, `·`, `—` and `→`. Write Kūkulu with U+016B (§3.11) and never in ASCII (`\bKukulu\b`, constraint `site-display-name-ascii`).
- §3.3: no `style=` attribute anywhere (inline SVG included) and no `<style>` element (constraint `site-no-inline-style`). Every inline declaration becomes a class rule in `styles.css`. Class names are semantic (`.stage`, `.install`, `.step`, `.sheet`, `.stat`), and repeated declarations become shared rules (§4 boundaries). Token colours on SVG come from classes or `currentColor`, never `fill="var(--x)"`. Plain geometry stays as attributes (`width`, `height`, `viewBox`, `fill="none"`, `stroke-width`).
- §6 Head: copy the mockup's `<head>` (charset, viewport, title, description, canonical `https://kukulu.tech/`, `color-scheme`, both `theme-color` metas, icons, Open Graph and Twitter tags), with icon paths root-relative (`/favicon.svg`, `/favicon.ico`, `/apple-touch-icon.png`) and `og:image` exactly `https://kukulu.tech/og.png`. Add `<link rel="stylesheet" href="/styles.css">`, then `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/hanken-grotesk-latin-wght-normal.woff2">` and the same for `hanken-grotesk-latin-ext-wght-normal.woff2`. Add `<script src="/copy.js" defer></script>` exactly once, as the last element in `<head>` (constraint `site-one-script-form`). `copy.js` arrives in P1-04. `<html lang="en">`. Every `src=`, `<link href=` and CSS `url()` is root-relative (constraints `site-root-relative-src`, `site-css-root-relative`). Nothing references `docs/`, `assets/` or `../` (constraint `site-self-contained`).
- §6 Fonts: six `@font-face` rules copied from the mockup's (family, style, `font-weight` range, `font-display: swap`, `unicode-range`, `format("woff2-variations")`), with `src: url(/fonts/<file>)`.
- §6 Theme and §3.9: one top-level `:root{…}` rule holding every dark token with the mockup's names and values (line 41, including `--mono` and `color-scheme:dark`). Exactly one `@media (prefers-color-scheme: light){:root{…}}` holding the mockup's light overrides (line 42's declarations; the selector is plain `:root`, without `:not([data-theme="dark"])`). `@media print{:root{…}}` repeats the same light declarations. No `data-theme` anywhere (constraint `site-no-theme-attr`). Tokens the light rule does not redeclare are inherited.
- Base rules from the mockup: `*{box-sizing:border-box}`, `[hidden]{display:none !important}` (§6: without it the copy buttons would show when the script never ran), `html{scroll-behavior:smooth}`, turned off under `@media (prefers-reduced-motion: reduce)` (§6 Motion; nothing else animates), `body` (including `overflow-x:clip`), links, the `a:focus-visible, button:focus-visible` 2 px accent outline, `::selection`, `.skip` and `.skip:focus`, `.grid-bg`, `.wrap`, `.sec`, `.eyebrow`, `.h2`, `.copy` and `.copy.small` (44 px min-height), `pre.lines` with the CSS counter (§6 Line numbers).
- §6 Sections and ids: `<a class="skip" href="#main">Skip to content</a>` is the first element in `<body>` and the first focusable one. Then `<header>` with the nav (`#how`, `#start`, `#proof`, GitHub) and the hero (`id="top"`), then `<main id="main">`. In this task `<main>` holds the problem section and How it works (`id="how"`), and the document is closed (`</main></body></html>`) so it parses. P1-03 inserts the remaining sections before `</main>` and the footer after it.
- Hero install block (§6 Copy-to-clipboard): `<code id="install-session">` inside `<pre class="lines">`, one `<span class="ln">` per command, holding exactly `/plugin marketplace add https://kukulu.tech/marketplace.json` and `/plugin install kukulu@displacetech` (§3.7) on two lines with no trailing space. The button is `<button type="button" class="copy" data-copy-for="install-session" aria-label="Copy install commands" hidden>`, with the mockup's SVG and `<span class="copy-label">Copy</span>`. The `hidden` attribute is the one deliberate departure from the mockup (constraint `copy-buttons-start-hidden`). The status element is `<p class="copy-status" id="install-session-status" role="status" aria-live="polite"></p>`, empty.
- §6 Responsive: copy both breakpoints exactly for everything in these sections. At `max-width:860px` the pipeline (`.pipe`) and evidence (`.ev`) rows stack, `.fwd` arrows rotate below, `.loop` hides and `.loop-m` ("Misses go back to Implement for fixes") shows, `.conn` hides and `.conn-m` shows. At `max-width:640px` the gutter is 16 px, `.sec` padding is 80 px and the figure padding is 20 px. Code blocks never wrap; they scroll inside their own box (`overflow-x:auto`, `white-space:pre`).
- `aria-hidden="true"` subtrees in the mockup stay aria-hidden in production. They are what keeps decorative numbers out of rule 6's visible text.

**Acceptance tests:** none automated beyond the existing ones: `node scripts/check-site.mjs` still passes (rule 1 accepts `index.html` and `styles.css`), and `kukulu_verify` shows constraints `site-no-inline-style`, `site-no-inline-handler`, `site-one-script-form`, `site-root-relative-src`, `site-css-root-relative`, `site-display-name-ascii`, `site-self-contained`, `site-no-theme-attr` and `copy-buttons-start-hidden` ok with no hits. Rules 3–7 and 9–10, which check this markup, arrive in P1-05 and P1-06 and will fail then on any departure.

**Out of scope:** the Why it holds up, Get started, Proof, Where it's going and Built by sections and the footer (P1-03); `copy.js`, `404.html`, `_headers` (P1-04); any new copy, image, font or icon (§2 non-goals); editing `docs/site/`.

**Verification:** `kukulu_verify`. `grep -c 'style=' site/index.html` prints 0. Optional, by eye: `cd site && python3 -m http.server 8000` (any static server; `serve-site.mjs` arrives in P1-08), open `http://localhost:8000/` at 1440 px and 360 px in both schemes, and compare the top of the page with `docs/site/screens/`.

**Depends on:** P1-01

### P1-03: index.html from Why it holds up to the footer

**Goal:** Complete `site/index.html` with the Why it holds up, Get started (`#start`), Proof (`#proof`), Where it's going and Built by sections and the footer, plus their rules in `site/styles.css`, reproducing `docs/site/mockup.html` lines 285–540.

**Files touched:** `site/index.html`, `site/styles.css`

**Design constraints:**

- Every design constraint of P1-02 applies unchanged: mockup copy exactly, Kūkulu with U+016B, no `style=` or `<style>`, semantic classes with shared rules, token colours on SVG via classes or `currentColor`, root-relative URLs only, nothing referencing `docs/`, `aria-hidden` subtrees kept, no `data-theme`. The constraints `site-no-inline-style`, `site-display-name-ascii`, `site-self-contained`, `site-root-relative-src` and `copy-buttons-start-hidden` cover these files.
- The new sections go inside `<main id="main">` after How it works, in mockup order. `<footer>` follows `</main>`. Keep the ids and `aria-labelledby` targets the mockup uses (`why-h`, `cr-h`, `start`, `start-h`, `proof`, `proof-h`, `cal-h`, `next-h`, `by-h`), and the `role="group"`, `role="img"` and `aria-label` attributes.
- Heading levels and text exactly as the mockup's: h2 section titles, h3 "In the plugin today", h4 cards, h3 "Clean-room mode · coming in 0.7.0", h4 items, h3 steps, h2 `cleanflate` (its inner `<span>` may become a class). Rule 6 compares them in order.
- Get started steps 1–3 (§6 Copy-to-clipboard): each is a `<code id="...">` (`install-shell`, `spec-template`, `flight-cmd`) followed by `<button type="button" class="copy small" data-copy-for="<id>" aria-label="<mockup's label>" hidden><span class="copy-label">Copy</span></button>`, and then `<p class="copy-status" id="<id>-status" role="status" aria-live="polite"></p>`, empty. `install-shell` holds exactly `claude plugin marketplace add https://kukulu.tech/marketplace.json` and `claude plugin install kukulu@displacetech` on two lines (§3.7). `spec-template` keeps `&amp;&amp;` encoded. Step labels (`STEP 1` …) stay `aria-hidden="true"`.
- Proof table: every `<th>` and `<td>` text exactly as the mockup's (rule 6 compares them), including `2,226`, `2,962 of 2,962`, `1.24M`, `0.71–0.76×`, `$361`, and the caption. The calibration chart keeps `role="img"` and its `aria-label`; its visual marks and labels stay `aria-hidden`, positioned by classes (one class per marker; no `style=`).
- §6 Responsive at `max-width:640px`: Get started steps stack their label above the content (`.step` one column), and copy buttons sit under their code (`.codebox` column, the button aligned to the end). Code blocks never wrap; they scroll inside their box.
- Footer: the mockup's wordmark, licence line and GitHub link.

**Acceptance tests:** `node scripts/check-site.mjs` passes. `kukulu_verify` constraints ok with no hits. `grep -c 'data-copy-for=' site/index.html` prints 4, and `grep -c 'class="copy-status"' site/index.html` prints 4.

**Out of scope:** `copy.js`, `404.html`, `_headers`; any change to the sections P1-02 wrote other than shared CSS rules; new copy; editing `docs/site/`.

**Verification:** `kukulu_verify`. Optional, by eye: serve `site/` with any static server and compare the whole page with `docs/site/screens/desktop-dark.jpg`, `desktop-light.jpg`, `tablet-light.jpg` and `mobile-dark.jpg`.

**Depends on:** P1-02

### P1-04: copy.js, 404.html and _headers

**Goal:** Write the copy-to-clipboard script, the not-found page and the Cloudflare Pages headers file.

**Files touched:** `site/copy.js`, `site/404.html`, `site/_headers`

**Design constraints:**

- `copy.js` (§6 Copy-to-clipboard, §3.4): one IIFE. Line 1 opens it and line 2 is exactly `  const COPY_FEEDBACK_MS = 2400;`, the value of `copyFeedbackMs` in `docs/site/checks.json` (⚠️ ASSUMPTION, config key `copyFeedbackMs`, default 2400). The number appears nowhere else (constraint `no-hardcoded-copy-feedback`). No globals, no inline handlers, no other behaviour, at most 2,048 bytes (⚠️ ASSUMPTION `budget.scriptBytes`).
- On load: if `navigator.clipboard?.writeText` is a function, remove `hidden` from every `button[data-copy-for]`; otherwise do nothing (buttons stay hidden, text stays selectable).
- On click (one `addEventListener` per button): read the target `document.getElementById(button.dataset.copyFor).textContent`, drop one trailing `\n` if present and nothing else, and call `writeText`. On success set the button's `.copy-label` text to `Copied` and the status element `#<id>-status` to `Copied to the clipboard.`. On rejection set the status to `Copy failed. Select the text and copy it manually.` and leave the label. The icon and `aria-label` never change. After `COPY_FEEDBACK_MS` restore the label to `Copy` and empty the status. A second click before then clears the pending timer first.
- `404.html` (§6 404 page): `<!doctype html>`, `<html lang="en">`, head with charset, viewport, `<title>Page not found — Kūkulu</title>`, the `color-scheme` and both `theme-color` metas, the three icon links and `<link rel="stylesheet" href="/styles.css">`. Body: `<a class="skip" href="#main">Skip to content</a>` first, a `<header>` with the mockup's wordmark (SVG `aria-hidden="true"` and `Kūkulu`) in an `<a href="/">`, then `<main id="main">` with `<h1>Page not found.</h1>`, `<p>There is nothing at this address.</p>` and `<a href="/">Go to the home page</a>`. No script (constraint `site-404-no-script`), no `style=`, no nav, no footer, no other text. Any new class rules go in `styles.css`.
- `_headers` (§6 `site/_headers`): exactly SPEC §6's block, byte for byte: four rules in order (`/*`, `/marketplace.json`, `https://:project.pages.dev/*`, `https://:version.:project.pages.dev/*`), two-space indented header lines, one blank line between rules, a single trailing newline, no trailing spaces, no `Cache-Control` (constraint `site-no-cache-control`).
- `styles.css` is not in this task's files: the 404 page reuses existing classes (`.skip`, `.wrap`, `.sec`, the header and wordmark classes, `.h2` or the h1 class). If a 404-only rule is unavoidable, add it to `styles.css` and list it in the commit body.

**Acceptance tests:** `node scripts/check-site.mjs` passes. `wc -c < site/copy.js` is at most 2048. `grep -c '<script' site/404.html` prints 0. `grep -c 'Cache-Control' site/_headers` prints 0. Compare `site/_headers` with SPEC §6 line by line by eye; from P1-06, rule 12 fails on any byte difference.

**Out of scope:** rules 3–14 in the checker; `serve-site.mjs`; any behaviour in `copy.js` beyond §6; editing `docs/site/`.

**Verification:** `kukulu_verify`. By eye: serve `site/` with any static server on `localhost` (the clipboard API needs a secure context, and `localhost` counts), and check that the four Copy buttons appear, each copies its block, and the label reads Copied for about 2.4 s.

**Depends on:** P1-03

### P1-05: check-site.mjs rules 3 to 7

**Goal:** Add an HTML parser and rules 3 (no inline style), 4 (one script, no `on*` attributes, copy-block structure, script budget), 5 (no third-party requests), 6 (copy is the mockup's) and 7 (install commands) to `scripts/check-site.mjs`, each with self-test cases.

**Files touched:** `scripts/check-site.mjs`

**Design constraints:**

- Restated from P1-01: `checkSite(opts)` returns `{ rule, file, message }` failures. Messages read `check-site: rule <n>: <file>: <what is wrong>; <what to do>`. The self-test's `CASES` entries are `{ rule, name, inject, expect }`, run on a fresh temp copy per case, with a clean baseline that must pass every implemented rule. Node built-ins only (§3.14, constraint `site-scripts-node-builtins`). No config value is written as a literal (constraints `no-hardcoded-site-tunables`, `no-hardcoded-copy-feedback`). The script never writes into `site/`. Update the implemented-rules list in the ok line to `1, 2, 3, 4, 5, 6, 7, 8`.
- `parseHtml(text)` (exported): a small tolerant tokenizer and tree builder producing nodes `{ tag, attrs, attrSource, children, parent }` and text nodes `{ text }`. It handles comments, the doctype, raw-text elements (`script`, `style`, `template` contents are not parsed as markup), quoted, unquoted and boolean attributes, `/>` self-closing, void elements (`area base br col embed hr img input link meta source track wbr`), and SVG children closed by explicit end tags. `attrSource` is the raw source of the start tag, for regex rules. `textContent(node)` concatenates descendant text with entities decoded (named `amp lt gt quot apos nbsp`, plus decimal and hex numeric).
- `visibleText(html)` (exported), exactly §3.6: take `<body>`'s content; remove `<script>`, `<style>`, `<template>`, comments and every element with `aria-hidden="true"` together with its subtree; replace each remaining tag with a space; decode entities; collapse whitespace to single spaces; trim.
- Rule 3 (§3.3), on `site/index.html` and `site/404.html`: any element with a `style` attribute (SVG included) and any `<style>` element fails, naming the tag and line.
- Rule 4 (§3.4, §5, §6): `index.html` has exactly one `<script` and its source is exactly `<script src="/copy.js" defer></script>`; `404.html` has none. Any start tag whose `attrSource` matches `/\son[a-z]+\s*=/i` fails, in either file. `copy.js` is at most `budget.scriptBytes` bytes. `copy.js` matches `/^\s*const COPY_FEEDBACK_MS = (\d+);$/m` exactly once and the number equals `copyFeedbackMs`. In `index.html` there are exactly four `button[data-copy-for]`, for the ids `install-session`, `install-shell`, `spec-template` and `flight-cmd`. Each has `type="button"` and the `hidden` attribute and contains a `.copy-label` whose text is `Copy`. Its target `<code id>` exists, and a `p.copy-status` with id `<id>-status`, `role="status"` and `aria-live="polite"` exists and is empty. `styles.css` contains `[hidden]{display:none !important}`, compared with all whitespace removed.
- Rule 5 (§3.5), on both HTML files and `styles.css`: every `src` attribute, every `<link>` `href` and every CSS `url(...)` is root-relative (starts with `/` but not `//`). The exception is `<link rel="canonical">`, whose `href` must be exactly `https://kukulu.tech/`. Any `@import` fails. `index.html`'s `<meta property="og:image">` `content` is exactly `https://kukulu.tech/og.png`. `<a href>` to other sites is allowed.
- Rule 6 (§3.6), comparing `site/index.html` with `mockupPath`, both through the same functions: (a) the sequence of `h1`–`h4` as `h<level>: <collapsed textContent>` is equal, and the first difference is reported with its index; (b) the sequence of `<th>`/`<td>` collapsed texts inside the `<table>` is equal; (c) the sequence of number tokens in `visibleText` is equal (tokens are `/\d[\d,.]*/g` matches with trailing `.` and `,` stripped), and the first differing index is reported with three tokens of context either side; (d) `visibleText(index.html)` contains no `/\bKukulu\b/` (case-sensitive).
- Rule 7 (§3.7): `textContent` of `#install-session`, with one trailing `\n` dropped, equals `/plugin marketplace add https://kukulu.tech/marketplace.json\n/plugin install kukulu@displacetech`. `#install-shell` equals `claude plugin marketplace add https://kukulu.tech/marketplace.json\nclaude plugin install kukulu@displacetech`. The `@displacetech` suffix in both equals `name` in `site/marketplace.json`.
- Self-test cases to add, at least (each edits the temp copy of `site/index.html` unless named otherwise): rule 3, `style="color:red"` added to the `<h1>`; rule 3, `<style>p{}</style>` added to `<head>`; rule 3, `style="fill:red"` added to an inline `<svg>`; rule 4, `onclick="x()"` added to a button; rule 4, a second `<script src="/copy.js" defer></script>`; rule 4, `<script>` added to `404.html`; rule 4, `copy.js` padded past `budget.scriptBytes` (pad size computed from the config, not a literal); rule 4, the `COPY_FEEDBACK_MS` number in `copy.js` changed to config + 1; rule 4, `hidden` removed from one copy button; rule 4, `[hidden]` rule removed from `styles.css`; rule 5, `<img src="https://example.com/x.png" alt="">` added; rule 5, a font `url(/fonts/...)` in `styles.css` changed to `https://fonts.gstatic.com/x.woff2`; rule 5, the canonical changed to `https://kukulu.tech/index.html`; rule 6, the `<h1>` text changed; rule 6, one table `<td>` number changed (`2,226` to `2,227`); rule 6, the number `20` in the Built by paragraph changed to `21`; rule 6, the word Kūkulu in a visible paragraph replaced by the ASCII spelling; rule 7, the hero `kukulu@displacetech` changed to `kukulu@example`; rule 7, the shell `install` line removed.

**Acceptance tests:** `node scripts/check-site.mjs --self-test` passes every P1-01 case and every case above, by name. `node scripts/check-site.mjs` exits 0 on the real site and prints `check-site: ok (rules 1, 2, 3, 4, 5, 6, 7, 8)`. If the real page fails a rule, fix `site/` in this commit and say so under Interpretation. The checker is never loosened to fit the page.

**Out of scope:** rules 9–14 and the missing-file half of rule 1 (P1-06); `package.json`; `scripts/lint.sh`; editing `docs/site/`.

**Verification:** `kukulu_verify`.

**Depends on:** P1-01, P1-04

### P1-06: check-site.mjs rules 9 to 14, check:site and the lint line

**Goal:** Complete `scripts/check-site.mjs` with rules 9–14 and the missing-file half of rule 1, each with self-test cases, and wire `npm run check:site` and `scripts/lint.sh`.

**Files touched:** `scripts/check-site.mjs`, `package.json`, `scripts/lint.sh`

**Design constraints:**

- Restated from P1-01 and P1-05: the failure shape, message format, self-test `CASES` mechanics and clean baseline; `parseHtml`, `textContent` and `visibleText` from P1-05; Node built-ins only; no config literal (constraints `no-hardcoded-site-tunables`, `no-hardcoded-copy-feedback`); never write into `site/`. The ok line lists rules `1–14`.
- Rule 1, missing half (§3.1): every file in the §4 list (`SITE_FILES` plus every file under `assetsDir`) exists in `siteDir`.
- Rule 9 (§3.9): strip CSS comments, then find top-level blocks. Exactly one top-level rule with selector `:root` gives the dark custom properties. Exactly one `@media (prefers-color-scheme: light)` (whitespace-insensitive) containing exactly one rule `:root` gives the light overrides. An `@media print` block containing a `:root` rule must declare the same custom properties and values as the light rule. Compare with `mockupPath`'s `<style>`: the dark set equals the mockup's top-level `:root{…}` custom properties, and the light overrides equal the custom properties inside the mockup's `@media (prefers-color-scheme: light){…}` (its selector differs; compare declarations only). Hex values compare case-insensitively. The light set is the dark set overridden by the light declarations. For every pair in `contrastPairs` and each scheme, compute the WCAG 2 contrast ratio (relative luminance from sRGB) and fail when it is below `contrastMin`, naming the scheme, both tokens, both values and the ratio to two decimals. A token in a pair that is missing, or is not `#rgb` or `#rrggbb`, fails. Export `contrastReport(opts)` returning, per scheme, every pair's ratio (P1-07 uses it).
- Rule 10 (§3.10), on `index.html` and `404.html`: `<html lang="en">`; exactly one `h1`; the first heading is `h1` and no heading is more than one level deeper than the one before it; every `<img>` has an `alt` attribute; every `<svg>` has `aria-hidden="true"`, or has an ancestor with `aria-hidden="true"`, or has `role="img"` and a non-empty `aria-label`; every `href="#x"` has an element with `id="x"` in the same file (a bare `#` fails); the first focusable element in `<body>` (`a[href]`, `button`, `input`, `select`, `textarea`, `summary`, or any element with `tabindex` ≥ 0) is `<a class="skip" href="#main">`; every `<button>` has `type="button"` and an accessible name (non-empty `aria-label` or non-empty text outside `aria-hidden` subtrees); a `<main id="main">` exists.
- Rule 11 (§3.11): run `spawnSync(process.execPath, [checkNamesPath, siteDir], { encoding: "utf8" })`. On a non-zero exit, each non-empty stderr line is one rule 11 failure, with `do: write the macron as U+016B and only in the standalone word`.
- Rule 12 (§3.12): `site/_headers` equals SPEC §6's block plus exactly one trailing newline. Hold the block as one constant, `HEADERS`, copied from SPEC §6 byte for byte. Separately, fail any line over 2,000 characters and more than 100 rules (a rule is a non-blank line that does not start with whitespace). These two limits are Cloudflare's, not tunables.
- Rule 13 (§3.13): the byte sizes of `index.html + styles.css + copy.js + 404.html` total at most `budget.textBytes` (⚠️ ASSUMPTION, default 65536), and `site/fonts/*.woff2` total at most `budget.fontBytes` (⚠️ ASSUMPTION, default 184320). Name the measured total and the budget.
- Rule 14 (§3.14): `packageJsonPath` has no `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies` key. In every file of `scriptPaths`, every `import … from "<x>"`, `import "<x>"`, dynamic `import("<x>")` and `require(` names a specifier starting `node:` or `./`.
- `package.json`: add exactly `"check:site": "node scripts/check-site.mjs --self-test && node scripts/check-site.mjs"` to `scripts`. Nothing else changes (constraint `no-dependencies`).
- `scripts/lint.sh`: add `check node scripts/check-site.mjs` directly after the `check node scripts/check-names.mjs` line, with a one-line comment saying why (the site rules of SPEC §3 run on every lint). It must stay shellcheck-clean.
- Self-test cases to add, at least: rule 1, `site/robots.txt` deleted; rule 9, dark `--muted` set to `#333333` in `styles.css` (mockup mismatch and contrast); rule 9, `contrastMin` in the copied `checks.json` set to 21 (contrast message); rule 9, the `@media print` block removed; rule 9, the light rule's `--accent-text` changed; rule 10, `lang="en"` removed; rule 10, a second `<h1>`; rule 10, an `h4` placed directly after the `<h1>` in `404.html`; rule 10, `aria-hidden="true"` removed from a standalone `<svg>`; rule 10, an `<a href="#nowhere">`; rule 10, an `<a href="/">` inserted before the skip link; rule 10, `type="button"` removed from a button; rule 11, a visible Kūkulu in `index.html` replaced by its decomposed form (write it in the source as `"K" + "u\u0304" + "kulu"`); rule 12, `Referrer-Policy: no-referrer` changed to `same-origin`; rule 12, a `  Cache-Control: max-age=60` line added; rule 13, a comment of `budget.textBytes + 1` bytes appended before `</body>` (size from the config); rule 13, `budget.fontBytes` in the copied `checks.json` set to 1000; rule 14, `"devDependencies": { "left-pad": "1.3.0" }` added to the copied `package.json`; rule 14, `import pad from "left-pad";` added to the copied `scripts/check-site.mjs`.

**Acceptance tests:** `node scripts/check-site.mjs --self-test` passes every case from P1-01, P1-05 and this task, by name, with at least one case for each of rules 1–14. `npm run check:site` exits 0. `npm run lint` prints `lint: ok`; with an extra file present (`touch site/.x`) it exits 1 with a rule 1 message (remove the file afterwards). `npm test` stays green (extraVerify).

**Out of scope:** `--report` (P1-07); `serve-site.mjs`; the browser check; editing `docs/site/`.

**Verification:** `kukulu_verify` (from this task it also runs `npm run check:site`, and `npm test` through extraVerify on `package.json` and `scripts/lint.sh`).

**Depends on:** P1-05

### P1-07: Measure the budgets and contrast against their assumptions

**Goal:** Add `node scripts/check-site.mjs --report`, which prints every ⚠️ ASSUMPTION value next to what the site measures, and record the result.

**Files touched:** `scripts/check-site.mjs`

**Design constraints:**

- SPEC §5 assumptions: `budget.textBytes` (65536), `budget.fontBytes` (184320), `budget.scriptBytes` (2048), `contrastMin` (4.5), `copyFeedbackMs` (2400), `servePort` (8788). The report reads them all from `docs/site/checks.json` through `loadConfig` and writes none of them as literals (constraints `no-hardcoded-site-tunables`, `no-hardcoded-copy-feedback`).
- `--report` prints one JSON object to stdout and exits 0, even when a budget is exceeded (the plain run is what fails): `{ "textBytes": { "budget", "measured", "files": { "index.html", "styles.css", "copy.js", "404.html" } }, "fontBytes": { "budget", "measured" }, "scriptBytes": { "budget", "measured" }, "contrast": { "min", "dark": { "lowest", "pair" }, "light": { "lowest", "pair" } }, "copyFeedbackMs": { "value", "measured": null }, "servePort": { "value", "measured": null } }`. Contrast comes from P1-06's `contrastReport(opts)`. Ratios are rounded to two decimals.
- Follow the measurement protocol in CLAUDE.md: "before" is the assumption's default and "after" is the measured value with its headroom. Record both in the commit body's `Measurement:` line and in the progress log. Do not change `docs/site/checks.json`. If a value is over budget, the plain check already fails, so shrink the page, never the budget, and say so under Interpretation.
- A self-test case (rule `report`) asserts that `--report`'s `textBytes.measured` on the clean copy equals the sum of the four files' sizes.

**Acceptance tests:** `node scripts/check-site.mjs --report | node -e 'const r=JSON.parse(require("node:fs").readFileSync(0,"utf8")); if(!(r.textBytes.measured<=r.textBytes.budget && r.contrast.dark.lowest>=r.contrast.min)) process.exit(1)'` exits 0. `node scripts/check-site.mjs --self-test` passes, including the `report` case.

**Out of scope:** changing any config value; any change to `site/` unless a budget fails.

**Verification:** `kukulu_verify`. The commit body's `Measurement:` line reads, for example, `textBytes 65536 → measured N (H% headroom); fontBytes 184320 → 165872; scriptBytes 2048 → N; contrast min 4.5 → lowest dark R (pair), light R (pair); copyFeedbackMs and servePort not machine-measurable`.

**Depends on:** P1-06

### P1-08: serve-site.mjs and site:serve

**Goal:** Write `scripts/serve-site.mjs`, a local static server for `site/` that applies `site/_headers` as SPEC §6 describes, with a `--self-test`, and add `npm run site:serve`.

**Files touched:** `scripts/serve-site.mjs`, `package.json`

**Design constraints:**

- SPEC §6 `scripts/serve-site.mjs`. Node built-ins only (`node:http`, `node:fs`, `node:path`, `node:url`), plus `import { loadConfig } from "./check-site.mjs"` for `servePort` (constraint `site-scripts-node-builtins`). No shebang. It never writes into `site/` (§4 boundary).
- Exported `async function start({ port } = {})` resolves to `{ url, close }`. `close()` returns a Promise that resolves once the server has stopped. The server listens on `127.0.0.1` only. Port precedence: the `port` argument, then `SITE_PORT`, then `servePort` from `docs/site/checks.json` (⚠️ ASSUMPTION, default 8788, never written as a literal: constraint `no-hardcoded-site-tunables`). `port: 0` binds an ephemeral port, and `url` (`http://127.0.0.1:<port>/`) reports the real one.
- Headers: at start, parse `site/_headers` into rules (an unindented line is a path pattern; the indented `Name: value` lines below it are its headers). Skip patterns that start with `https://`. `/*` matches every path; any other pattern matches that exact path. Apply every matching rule's headers. Then drop the `Strict-Transport-Security` header and remove the `upgrade-insecure-requests` directive from `Content-Security-Policy` (with its separator, leaving no trailing `;`).
- `Content-Type` by extension: `.html` `text/html`, `.css` `text/css`, `.js` `text/javascript`, `.json` `application/json`, `.svg` `image/svg+xml`, `.png` `image/png`, `.ico` `image/x-icon`, `.woff2` `font/woff2`, `.txt` `text/plain`. The text types (`html`, `css`, `js`, `json`, `txt`) get `; charset=utf-8`. A `Content-Type` from `_headers` (for `/marketplace.json`) wins.
- Routing: only `GET` and `HEAD` (others get 405). Decode the path. `/` serves `index.html`. Resolve under `site/`. A path that resolves outside `site/`, contains a NUL, or fails to decode gets `403` with a plain-text body. A missing file, a directory, and `/_headers` itself (Pages does not serve it) get `404.html`'s content with status 404 and the `/*` headers.
- CLI (only when it is the entry script): `node scripts/serve-site.mjs [--port N]` starts and prints `serve-site: http://127.0.0.1:<port>/`. Ctrl-C closes it. `--self-test` starts on port 0, runs the checks below with `node:http` requests (not `fetch`, because the traversal checks need the raw path to reach the server), prints `serve-site self-test: ok (<n> checks)` or each failure, closes, and exits accordingly. A bad `--port` exits 2 with a usage line.
- Self-test checks, at least: `GET /` is 200 `text/html; charset=utf-8` with `X-Content-Type-Options: nosniff`, a CSP that contains `default-src 'none'` and not `upgrade-insecure-requests`, and no `Strict-Transport-Security`; `GET /marketplace.json` is `application/json; charset=utf-8` with `Access-Control-Allow-Origin: *`; `GET /styles.css` is `text/css; charset=utf-8`; `GET /copy.js` is `text/javascript; charset=utf-8`; one `/fonts/*.woff2` is `font/woff2`; `GET /favicon.ico` is `image/x-icon`; `GET /no-such-page` is 404 and its body contains `Page not found.`; `GET /_headers` is 404; raw paths `/../package.json` and `/%2e%2e/package.json` are 403; `POST /` is 405; `HEAD /` is 200 with no body.
- `package.json`: add exactly `"site:serve": "node scripts/serve-site.mjs"`. Nothing else changes.

**Acceptance tests:** `node scripts/serve-site.mjs --self-test` passes every check above. `npm run check:site` still passes (rule 14 now also scans `serve-site.mjs`). `npm test` green (extraVerify on `package.json`).

**Out of scope:** the browser check; caching, compression, directory listings, live reload; any change to `site/`.

**Verification:** `kukulu_verify` (from this task it runs `node scripts/serve-site.mjs --self-test`). By hand: `SITE_PORT=8790 npm run site:serve`, then `curl -sI http://127.0.0.1:8790/` shows the headers, and Ctrl-C stops it.

**Depends on:** P1-01, P1-04

### P1-09: Phase 1 end: push and record the manual check

**Goal:** Push the branch with the finished page and static checks, and record the Phase 1 manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 1, item 6. Follow the implement skill's phase-end rules: push if this run's policies allow it and `origin` exists. No code changes. If nothing changed, an empty commit `P1-09: Phase 1 end: push and record the manual check` (`git commit --allow-empty -F <file>`) carries the task.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code, the page or docs.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human)` for: run `npm run site:serve`, open it in a desktop browser and on a phone (or device emulation at 360 px), in both color schemes, and compare with `docs/site/screens/`; Tab through the page and confirm the skip link appears first and every link and button shows a visible 2 px focus ring; confirm touch targets are at least 44 px; press each of the four copy buttons and paste the result; judge whether "Copied" stays long enough (⚠️ ASSUMPTION `copyFeedbackMs`, 2400 ms).

**Depends on:** none

## Phase 2 — Browser checks, CI and docs

### P2-01: check-site-browser.mjs, check:site:browser and .site-shots/

**Goal:** Write `scripts/check-site-browser.mjs`, which drives headless Chrome over the DevTools protocol to assert SPEC §3 rule 15 at every viewport in both schemes, add `npm run check:site:browser`, and ignore `.site-shots/`.

**Files touched:** `scripts/check-site-browser.mjs`, `package.json`, `.gitignore`

**Design constraints:**

- SPEC §6 `scripts/check-site-browser.mjs` and §3.15. Node built-ins only, with Node's global `WebSocket` (Node ≥ 22). No Playwright, no Puppeteer, no `ws` (constraint `site-scripts-node-builtins`). Import `{ start }` from `./serve-site.mjs` and `{ loadConfig }` from `./check-site.mjs`. No shebang. `async`/`await` is fine here; the synchronous rule covers only `mcp/server.mjs`.
- Finding Chrome: `CHROME_PATH` if set (it must exist, or fail naming it); else the first of `google-chrome`, `chromium`, `chromium-browser` found on `PATH` (search `PATH` entries with `fs.accessSync(…, X_OK)`, no shell); else `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` if it exists. If none is found, exit 1 with `check-site-browser: no Chrome or Chromium found; set CHROME_PATH to its executable`. It never skips silently, and never exits 0 without having run.
- Launch: `spawn(chrome, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=<fs.mkdtempSync temp dir>", "--no-first-run", "--no-default-browser-check", "about:blank"])`. Read stderr until a line matches `/DevTools listening on (ws:\/\/\S+)/`, with a 30 s timeout that fails with Chrome's stderr so far. That URL is the browser target: `Target.createTarget({ url: "about:blank" })`, `Target.attachToTarget({ targetId, flatten: true })`, and send every page command with the returned `sessionId`. Enable `Runtime`, `Log` and `Page`. Every command has a timeout; Chrome is killed and the temp profile removed on every exit path, including failure.
- Server: `const server = await start({})`, so `SITE_PORT` and `servePort` (⚠️ ASSUMPTION, 8788) apply. Close it on exit. Viewports come from `viewports` in `docs/site/checks.json`, never literals.
- For each width in `viewports` and each scheme of `dark`, `light`: `Emulation.setDeviceMetricsOverride({ width, height: 900, deviceScaleFactor: 1, mobile: false })`, `Emulation.setEmulatedMedia({ features: [{ name: "prefers-color-scheme", value: scheme }] })`, then `Page.navigate` to the server URL and wait for `Page.loadEventFired`. Then `Runtime.evaluate` with `awaitPromise: true, returnByValue: true` an expression that awaits `document.fonts.ready` and returns `{ scrollWidth, clientWidth, buttons: [...document.querySelectorAll("[data-copy-for]")].map(b => ({ id: b.dataset.copyFor, hidden: b.hidden, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })), font: document.fonts.check('16px "Hanken Grotesk"', "\u016b"), light: matchMedia("(prefers-color-scheme: light)").matches }`.
- Assertions per run (§3.15), each failure naming `<width> <scheme>`: `scrollWidth <= clientWidth` of `document.documentElement`; every copy button has `hidden === false` and a non-zero width and height (the script ran, which needs the clipboard API: headless Chrome on `127.0.0.1` exposes `navigator.clipboard`; if it does not, fail, never skip); the font check is true; `light` equals `scheme === "light"`, which proves the emulation took effect. Any `Log.entryAdded` at level `error` (CSP violations arrive this way), any `Runtime.consoleAPICalled` of type `error` and any `Runtime.exceptionThrown` during the run fails it, with the message text.
- `--shots`: after each run's assertions, `Page.getLayoutMetrics`, then `Page.captureScreenshot({ format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: <cssContentSize.width>, height: <cssContentSize.height>, scale: 1 } })`, written to `.site-shots/<width>-<scheme>.png` (`fs.mkdirSync(".site-shots", { recursive: true })`). Nothing is written without `--shots`, and nothing ever goes outside `.site-shots/` (§4 boundary).
- Output: one line per run (`check-site-browser: 1440 dark ok`), then `check-site-browser: ok (<n> runs)` and exit 0, or every failure and exit 1. An unknown flag exits 2.
- `package.json`: add exactly `"check:site:browser": "node scripts/check-site-browser.mjs"`. `.gitignore`: add the one line `.site-shots/`.

**Acceptance tests:** `npm run check:site:browser` exits 0 and prints `check-site-browser: ok (6 runs)` with the default `viewports`. `node scripts/check-site-browser.mjs --shots` writes six PNGs to `.site-shots/`, and `git status --short` does not list them. `CHROME_PATH=/nonexistent node scripts/check-site-browser.mjs` exits non-zero and names `CHROME_PATH`. Negative check, done by hand and not committed: add `<div class="x"></div>` with `.x{width:2000px;height:1px}` to `site/`, confirm the check fails naming `360 dark`, then revert. Record it under Tests in the commit body. `npm run check:site` still passes (rule 14 now scans this script).

**Out of scope:** CI (P2-02); comparing screenshots automatically; any change to `site/` unless the check finds a real overflow or console error, in which case fix `site/` in this commit and say so under Interpretation.

**Verification:** `kukulu_verify`. From this task the exclusive extraVerify `npm run check:site:browser` (timeout 300000 ms) runs on `site/`, `scripts/check-site-browser.mjs` and `scripts/serve-site.mjs`. It binds `servePort`, so run it only from the main checkout.

**Depends on:** P1-01, P1-08

### P2-02: The site CI workflow

**Goal:** Add `.github/workflows/site.yml`, which runs `npm run check:site` and `npm run check:site:browser` on GitHub Actions.

**Files touched:** `.github/workflows/site.yml`

**Design constraints:**

- SPEC §8 Phase 2 item 2. Triggers: `push` to `main`, `pull_request`, `workflow_dispatch`. `permissions: contents: read`. `concurrency` grouped by `site-${{ github.ref }}` with `cancel-in-progress: true`, as `ci.yml` does. One job on `ubuntu-latest` with `timeout-minutes: 10`.
- Steps: `actions/checkout@v7`; `actions/setup-node@v7` with `node-version: 24` (pinned the way `ci.yml` pins them; `test/plugin.mjs` fails on an unpinned `uses:`); `npm run check:site`; and a browser step whose `run` is `CHROME_PATH="$(command -v google-chrome)"`, then `export CHROME_PATH`, then `npm run check:site:browser`. The runner image ships Google Chrome. No `npm install` or `npm ci`: there are no dependencies.
- A header comment saying what the workflow checks and why there is nothing to install, in the style of `ci.yml`. yamllint-clean per `.yamllint.yaml` (2-space indentation, `true`/`false` only).

**Acceptance tests:** `npm test` passes (extraVerify on `.github/`), including `test/plugin.mjs`'s "every action in CI is pinned to a released version". `pre-commit run --all-files` passes (yamllint).

**Out of scope:** changing `ci.yml`, `lint.yml` or `secret-scan.yml`; deploying anything (Cloudflare deploys through its own Git integration, docs/site/DEPLOY.md).

**Verification:** `kukulu_verify`. After the push, the PR's `site` check is green. Record it as NOT VERIFIED (human) if it has not finished.

**Depends on:** P1-06, P2-01

### P2-03: README, CONTRIBUTING and CHANGELOG for the site

**Goal:** Document the site in `README.md`, `CONTRIBUTING.md` and `CHANGELOG.md` as SPEC §8 Phase 2 item 3 lists.

**Files touched:** `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Design constraints:**

- `README.md` "Repo layout": one line for `site/` in the `text` tree, aligned with its neighbours, describing it as the kukulu.tech landing page deployed to Cloudflare Pages. "Documentation map": one line `- [**Website**](docs/site/DEPLOY.md): deploying kukulu.tech to Cloudflare Pages, and the launch checklist`. Quickstart step 1: after its bash block, one sentence giving the hosted alternative, with `claude plugin marketplace add https://kukulu.tech/marketplace.json` in a code span. No other README change.
- `CONTRIBUTING.md` "Layout" table: rows for `site/` (the kukulu.tech landing page, deployed as-is by Cloudflare Pages; `docs/site/` holds its inputs), `scripts/check-site.mjs` (static checks for SPEC rules 1–14, with `--self-test` and `--report`; run by `scripts/lint.sh` and `npm run check:site`), `scripts/check-site-browser.mjs` (layout, console and font checks in headless Chrome; needs Chrome or Chromium; `npm run check:site:browser`) and `scripts/serve-site.mjs` (local server for `site/` that applies `site/_headers`; `npm run site:serve`). Put them next to the other `scripts/` rows.
- `CHANGELOG.md`: a `## [Unreleased]` section directly above `## [0.6.1]`, with an `### Added` list: the kukulu.tech landing page in `site/` and its hosted `marketplace.json`; the three scripts and npm scripts; the `site` CI workflow. Do not change the version anywhere. `test/plugin.mjs` reads the newest `## [x.y.z]` heading, which stays 0.6.1.
- Prose: Kūkulu with U+016B. The ASCII spelling only inside code spans (`scripts/check-names.mjs` fails otherwise). No hard wraps (CONTRIBUTING's wrapping rule). Markdownlint-clean. Every relative link resolves (`test/plugin.mjs`).

**Acceptance tests:** `npm test` passes (extraVerify), including "every relative link in the documentation resolves" and "CHANGELOG.md's newest entry is the package version". `npm run lint` passes (check-names). `pre-commit run --all-files` passes (markdownlint).

**Out of scope:** `docs/*.md` other than through these three files; the version number; editing `docs/site/DEPLOY.md`.

**Verification:** `kukulu_verify`.

**Depends on:** none

### P2-04: Phase 2 end: push and record the manual check

**Goal:** Push the finished branch and record the Phase 2 manual check for a human.

**Files touched:** none

**Design constraints:** SPEC §8 Phase 2 item 4. Follow the implement skill's phase-end rules: push if this run's policies allow it and `origin` exists. No code changes. If nothing changed, an empty commit `P2-04: Phase 2 end: push and record the manual check` (`git commit --allow-empty -F <file>`) carries the task.

**Acceptance tests:** none beyond `kukulu_verify` being green.

**Out of scope:** any change to code, the page or docs; deploying anything.

**Verification:** `kukulu_verify`. The log entry carries `Manual check: NOT VERIFIED (human)` for: follow docs/site/DEPLOY.md to deploy the build branch as a Cloudflare Pages preview, then run its launch checklist against the preview URL, including installing the plugin from the preview's `marketplace.json`; and confirm the PR's `site`, `ci` and `lint` checks are green.

**Depends on:** none

## Spec issues

1. Rule 1 vs the Phase 1 task order. §3.1 says `site/` contains exactly the §4 files, and §8 P1.1 asks for rule 1 before the page exists, so a both-ways rule 1 would fail from P1-01 to P1-04. Resolution: P1-01 checks only for unexpected files; P1-06 adds the missing-file half.
2. Rule 11 is "checked by `check-names.mjs`", but §7's self-test needs a violation for every rule 1–14. Resolution: `check-site.mjs`'s rule 11 runs `check-names.mjs` over the site directory and reports its output as rule 11.
3. §7's self-test "copies `site/` and `docs/site/checks.json`", but rule 14 concerns `package.json` and the scripts. Resolution: the self-test also copies `package.json` and the existing site scripts; the reference inputs are read in place.
4. §5 puts `const COPY_FEEDBACK_MS = 2400;` "at the top of the file", and §6 says "no globals". Resolution: line 2, the first statement inside the IIFE.
5. §6 defines no test for `serve-site.mjs`. Resolution: a `--self-test` flag on port 0, run in `verify` from P1-08. This is a small extension of its CLI, which §6 gives as `[--port N]`.
6. §3.3 allows SVG presentation attributes, but the mockup's SVG colours are `var(--token)`, which presentation attributes do not reliably resolve. Resolution: token colours go through classes or `currentColor`.
7. §8 Phase 1 tasks 2 and 4 are each larger than one ~400-line commit. They are split (Decisions), so SPEC's "P1 task 4" is P1-06 in `from:`.
8. The working tree has `docs/SPEC.md` modified and `docs/site/` untracked; neither is committed on `main`. `kukulu_run_start` refuses while a tracked file (`docs/SPEC.md`) has uncommitted changes. If `docs/site/` stayed untracked, the run would record it as pre-existing and stream worktrees and CI would not see it. Resolution, for the human: commit `docs/SPEC.md` and `docs/site/` on `main` before the implement stage starts. The planner does not commit them, because only the plan files are its to commit.
9. `test/plugin.mjs` checks that every action in every workflow is pinned, which SPEC's extraVerify list (README, CONTRIBUTING, CHANGELOG, docs/, package.json, lint.sh) does not cover for the new `site.yml`. Resolution: `npm test` is also extraVerify on `.github/`.

## Review fixes (round 1)

### R1-01: check-site.mjs self-test cases for the uncovered rule branches
**Goal:** Give every rule branch in scripts/check-site.mjs that survived mutation in review round 1 a self-test case, so the self-test fails when any of them is disabled.
**Files touched:** scripts/check-site.mjs
**Design constraints:** Add cases only, to the existing CASES array, in the existing { rule, name, inject, expect } shape. Use sub/subAfter/editConfig/editMarketplace, which throw when the target text is absent. Never loosen or change a rule to fit a case; if a case cannot be made to fail, the rule is wrong, so fix the rule and say so under Interpretation. No config value as a literal (constraints no-hardcoded-site-tunables, no-hardcoded-copy-feedback); derive sizes from the copied checks.json. Strings that would trip constraints or check-names (a CommonJS require call, a bare import specifier, a combining macron) are assembled from pieces, as the existing rule 11 and rule 14 cases do. Node built-ins only. Never write into site/.
**Acceptance tests:** New cases, each by name, in node scripts/check-site.mjs --self-test: rule 4: install-shell-status given text ('has a status element that is not empty'); rule 4: a .copy-label reading something other than Copy ('has no .copy-label reading'); rule 4: the flight-cmd <code> id renamed ('has no <code> target'); rule 4: a blank line inserted after copy.js line 1 ('line 2 is not the COPY_FEEDBACK_MS declaration'); rule 5: og:image content set to /og.png ('og:image is'); rule 5: a <link rel="stylesheet" href="https://example.com/x.css"> in the head ('<link> href'); rule 5: '@import url(/x.css);' prepended to styles.css ('uses @import'); rule 8: owner.name changed in the copied marketplace.json ('owner.name'); rule 9: one token in the @media print block changed while the light rule stays ('@media print tokens differ'); rule 9: a contrast pair whose token is not a hex colour, e.g. ["--grid","--bg"] added to the copied checks.json ('not a #rgb/#rrggbb colour'); rule 10: an <img src="/og.png"> without alt ('no alt attribute'); rule 10: a <button type="button"></button> with no name ('no accessible name'); rule 10: <main id="main"> renamed in 404.html ('has no <main id="main">'); rule 12: a header line over the line limit ('characters, over'); rule 12: more rules than the rule limit ('rules, over'), both sized from the constants, not literals; rule 14: a CommonJS require call appended to the copied scripts/check-site.mjs ('CommonJS require'); config: contrastMin outside 1 to 21 ('"contrastMin" must be').
**Out of scope:** Changing any rule's behaviour (unless a case proves it wrong); site/; docs/site/checks.json; the other two scripts.
**Verification:** kukulu_verify green. Reviewer re-runs the round-1 survivors with kukulu_mutate (e.g. replacing `} else if (textContent(status) !== "") {` with `} else if (false) {`, or `if (requireCall.test(text)) ctx.fail(` with `if (false) ctx.fail(`) and expects each to be killed.
**Depends on:** none

### R1-02: serve-site.mjs: test port precedence, validate SITE_PORT, test the NUL refusal
**Goal:** Prove that scripts/serve-site.mjs chooses the port argument over SITE_PORT over servePort, refuses a bad SITE_PORT with a message naming it, and returns 403 for a path containing a NUL.
**Files touched:** scripts/serve-site.mjs
**Design constraints:** SPEC 6 and PLAN P1-08: start({ port }) resolves to { url, close }; precedence is the port argument, then SITE_PORT, then servePort from docs/site/checks.json via loadConfig (never a literal: constraint no-hardcoded-site-tunables). A SITE_PORT that is set but is not an integer from 0 to 65535 rejects start() with an Error whose message names SITE_PORT and says what to set instead; an unset or empty SITE_PORT falls through to servePort. The self-test must never bind servePort (it may collide with a running server): to test SITE_PORT, find a free port by listening on port 0 and closing, set process.env.SITE_PORT to it, call start({}) and check the url carries that port, then restore the environment in a finally. Node built-ins only; never write into site/.
**Acceptance tests:** New serve-site self-test checks: 'start({}) uses SITE_PORT' (url port equals the SITE_PORT value); 'the port argument beats SITE_PORT' (start({ port: 0 }) with SITE_PORT set binds a different, ephemeral port); 'a bad SITE_PORT is refused naming SITE_PORT' (SITE_PORT=abc rejects with a message containing SITE_PORT); 'GET /%00 is 403'.
**Out of scope:** Changing the 404 header behaviour; the browser check; caching or other server features.
**Verification:** kukulu_verify green. Reviewer re-runs kukulu_mutate replacing the precedence expression with `port ?? loadConfig(CONFIG_PATH).servePort` and dropping `|| decoded.includes("\0")`; both must be killed by node scripts/serve-site.mjs --self-test.
**Depends on:** none

### R1-03: check-site-browser.mjs --self-test and no leaked Chrome profile
**Goal:** Give scripts/check-site-browser.mjs a --self-test that proves each rule 15 assertion fails on an injected violation, wire it into verify and CI, and stop every run from leaving its temporary Chrome profile behind.
**Files touched:** scripts/check-site-browser.mjs, scripts/serve-site.mjs, .github/workflows/site.yml, docs/kukulu.json
**Design constraints:** SPEC 3.15 and 6; PLAN P2-01. start() in serve-site.mjs gains an optional siteDir (default site/), used for both the files and _headers; existing callers are unchanged. The self-test copies site/ into an fs.mkdtempSync directory under os.tmpdir() per case, injects one violation, serves it with start({ port: 0, siteDir }), runs the same per-run probe and assertions as the normal run at one viewport, and passes only when that case's assertion fails with its message; a clean baseline copy must pass first. Cases at least: an element wider than the viewport (overflow message); a third-party <img src="https://example.com/x.png" alt=""> (a CSP violation reported through Log.entryAdded); the copy.js script tag removed (copy button not shown); the latin-ext @font-face src pointed at a missing file (font check), and if no injection makes Chrome's document.fonts.check fail, record that under Interpretation instead of weakening the check. Temp copies and profiles are removed on every path; nothing is written into site/ or the repo except .site-shots/ with --shots. Shutdown: send Browser.close over CDP, fall back to SIGKILL after a bounded timeout, await the child's exit event, then remove the profile; create the profile inside the try after the server has started. The normal run's output and exit codes are unchanged; npm run check:site:browser stays `node scripts/check-site-browser.mjs` (SPEC 7). In docs/kukulu.json add `node scripts/check-site-browser.mjs --self-test` to the extraVerify entries for site/, scripts/check-site-browser.mjs and scripts/serve-site.mjs (timeoutMs 300000; it binds only port 0, so not exclusive), and run it in site.yml's browser step before npm run check:site:browser, with the same CHROME_PATH export. Node built-ins and the global WebSocket only (constraint site-scripts-node-builtins); no literal from checks.json (constraint no-hardcoded-site-tunables).
**Acceptance tests:** node scripts/check-site-browser.mjs --self-test prints one line per case and 'check-site-browser self-test: ok (<n> cases)': 'baseline passes', 'overflow is caught', 'a CSP violation is caught', 'hidden copy buttons are caught', 'a missing latin-ext font is caught', plus 'the Chrome profile is removed' (the profile path no longer exists after a run returns); serve-site.mjs --self-test still passes and gains 'start({ siteDir }) serves that directory'.
**Out of scope:** New rule 15 assertions; screenshots comparison; site/ changes; npm script names; check-site.mjs.
**Verification:** kukulu_verify green (npm test runs through extraVerify on .github/ and docs/). After two runs of npm run check:site:browser, `ls /tmp | grep -c check-site-browser-` does not grow. Reviewer re-runs kukulu_mutate on check-site-browser.mjs replacing `if (r.scrollWidth > r.clientWidth) failures.push(` with `if (false) failures.push(` and deleting `for (const e of events) failures.push(`${label}: ${e}`);`; both must be killed by the self-test.
**Depends on:** R1-02
