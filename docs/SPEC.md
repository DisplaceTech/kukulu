# kukulu.tech — Specification

Version: 0.1 Status: ready for a flight

The Kūkulu planner reads this file in full and derives the build plan from it. The previous spec (the 0.5.0 plugin flight) is archived unchanged at [flights/v0-5-0/SPEC.md](flights/v0-5-0/SPEC.md). Clean-room mode (0.7.0) gets its own spec after this flight is archived; nothing in this flight touches the plugin's behavior.

## 1. Overview

Build the public landing page for Kūkulu as a static site in `site/`, deployed to Cloudflare Pages at `https://kukulu.tech`. The page also serves the plugin marketplace file that its install command points at, so `site/marketplace.json` is a shipped product surface and not decoration. In this spec, `site/` always means the deploy directory at the repo root and `docs/site/` the flight's inputs. Done means: `site/` matches the approved mockup at 360, 768 and 1440 px in both color schemes, passes every check in §7, and a human has deployed a preview build and run the checklist in [docs/site/DEPLOY.md](site/DEPLOY.md).

## 2. Goals and non-goals

- Goal: one page, `site/index.html`, that reproduces [docs/site/mockup.html](site/mockup.html) visually and copies its text exactly. The mockup is the approved design and the approved copy.
- Goal: `site/marketplace.json` that lets `/plugin marketplace add https://kukulu.tech/marketplace.json` followed by `/plugin install kukulu@displacetech` install the plugin from GitHub.
- Goal: a strict, self-contained page: no framework, no build step, no third-party requests, no tracking, one small script whose only job is copy-to-clipboard.
- Goal: dependency-free checks (§7) that prove the rules in §3 mechanically, on every task and in CI.
- Goal: dark by default, light when the visitor's system asks for it (`prefers-color-scheme: light`), with no theme toggle.
- Non-goal: any change to the plugin's behavior, `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/`. The only files outside `site/` and the new scripts that change are `package.json` (scripts only), `scripts/lint.sh`, `.gitignore` (one line), a new CI workflow, `README.md`, `CONTRIBUTING.md` and `CHANGELOG.md` (§8), plus the flight's own Kūkulu artifacts (`docs/PLAN.md`, `docs/PROGRESS.md`, `docs/kukulu.json`, `docs/HANDOFF.md`, `docs/SUMMARY.md`, the CLAUDE.md flight notes).
- Non-goal: new copy. No metrics, testimonials, logos, customer names, feature claims or links that are not in the mockup. The only text not in the mockup is the 404 page, whose copy is fixed in §6.
- Non-goal: clean-room mode, its provenance log, guard or attestation bundle. The page describes them as coming in 0.7.0, exactly as the mockup words it.
- Non-goal: analytics, cookies, a theme toggle, a newsletter form, a demo-video embed, or a link to a run recording (it returns when a URL exists; see §9).
- Non-goal: regenerating or editing the seeded binary assets (fonts, icons, `og.png`). They are final.

## 3. Engineering principles

Each rule is checked by `scripts/check-site.mjs` unless it says otherwise.

1. **The file set is closed.** `site/` contains exactly the files listed in §4 and nothing else: no source maps, no README, no dotfiles. `_headers` is the only file whose name starts with `_`.
2. **Seeded assets are byte-identical.** Every file under [docs/site/assets/](site/assets/) is copied into `site/` at the path in §4, and its SHA-256 equals the source's. `site/marketplace.json` is one of these.
3. **No inline style.** No `style=` attribute anywhere in `site/*.html` (inline SVG included) and no `<style>` element. All styling lives in `site/styles.css`. Inline SVG uses presentation attributes (`fill`, `stroke`, `stroke-width`) or classes.
4. **One script, loaded once.** `site/index.html` has exactly one `<script` tag: `<script src="/copy.js" defer></script>`. `site/404.html` has none. No attribute whose name starts with `on` appears in any HTML file (regex `/\son[a-z]+\s*=/i`, applied to tag source only, so `content=` does not match). `site/copy.js` is at most 2,048 bytes ⚠️ ASSUMPTION (config `budget.scriptBytes`).
5. **No third-party requests.** No `src=`, `<link href=`, CSS `url(...)` or `@import` points at another origin. Every one is a root-relative path (`/fonts/...`), except `<link rel="canonical">`, which is exactly `https://kukulu.tech/`, and the `og:image` meta, which is exactly `https://kukulu.tech/og.png`. `<a href>` to other sites is allowed and is how the page cites sources.
6. **Copy is the mockup's.** Every `h1`–`h4` text in `site/index.html` equals the mockup's, in the same order. Every `<th>` and `<td>` text in the proof table equals the mockup's. The sequence of number tokens in `site/index.html`'s visible text equals the mockup's. Visible text is the `<body>` content with `<script>`, `<style>`, `<template>`, comments and `aria-hidden="true"` subtrees removed, each remaining tag replaced by a space, entities decoded, and whitespace collapsed. Number tokens match `/\d[\d,.]*/g` with trailing `.` and `,` stripped. Visible text must also never contain `\bKukulu\b` (the ASCII spelling of the display name).
7. **Install commands are identical everywhere.** The two hero commands are exactly `/plugin marketplace add https://kukulu.tech/marketplace.json` and `/plugin install kukulu@displacetech`, and the shell commands in Get started are exactly `claude plugin marketplace add https://kukulu.tech/marketplace.json` and `claude plugin install kukulu@displacetech`. The `@displacetech` suffix equals the `name` in `site/marketplace.json`.
8. **The marketplace file stays in step with the repo's.** `site/marketplace.json` parses as JSON; its `name`, `owner.name`, and its single plugin entry's `name`, `description` and `license` equal `.claude-plugin/marketplace.json`'s; the entry's `source` is `{ "source": "url", "url": "https://github.com/DisplaceTech/kukulu.git" }`; no entry has a string (relative-path) `source` or a `version`. A URL-hosted marketplace cannot resolve relative paths, so this rule is what keeps the hero command working.
9. **Contrast holds in both schemes.** `site/styles.css` declares its color tokens as custom properties in one `:root{…}` rule (dark) and overrides some of them in the single rule `@media (prefers-color-scheme: light){:root{…}}` (light), with the names and values in the mockup's `<style>` block. The light set is the dark set overridden by that rule's declarations; tokens it doesn't redeclare (such as `--on-accent` and the `--code-*` tokens) are inherited. `@media print` repeats the light rule in its own block. `check-site.mjs` parses both sets and fails if any pair in `docs/site/checks.json`'s `contrastPairs` falls below `contrastMin` (4.5 ⚠️ ASSUMPTION). The palette as given passes every pair; the rule exists so a later edit cannot quietly break it.
10. **Accessible structure.** `<html lang="en">`; exactly one `h1`; heading levels never skip downward (h2 → h4 is an error); every `<img>` has `alt`; every inline `<svg>` has `aria-hidden="true"`, sits inside an `aria-hidden="true"` element, or has `role="img"` with `aria-label`; every `href="#x"` has a matching `id="x"`; the skip link is the first focusable element; every `<button>` has `type="button"` and an accessible name. The rule applies to `index.html` and `404.html`; `404.html` has the same skip link and a `<main id="main">`. Visible focus (2 px accent outline) and 44 px touch targets are checked by eye (§8).
11. **The display name.** Prose writes Kūkulu with the precomposed `U+016B`; identifiers, paths and URLs use `kukulu`. `scripts/check-names.mjs` already enforces where the macron may appear in every file, `site/` included. It checks the ASCII spelling in prose only in Markdown, so rule 6 covers it for the page.
12. **Headers are present.** `site/_headers` contains the rules in §6 verbatim, every line is at most 2,000 characters, and there are at most 100 rules (Cloudflare's limits).
13. **Size budget.** `index.html + styles.css + copy.js + 404.html` total at most 64 KiB ⚠️ ASSUMPTION (`budget.textBytes`); `site/fonts/*.woff2` total at most 180 KiB ⚠️ ASSUMPTION (`budget.fontBytes`).
14. **No dependencies.** The repo's existing `no-dependencies` constraint holds: `package.json` gains `scripts` entries only, and every new script uses Node built-ins only (Node ≥ 22).
15. **Layout holds at every width.** At 360, 768 and 1440 px (`docs/site/checks.json` `viewports`), in both color schemes, after `Emulation.setDeviceMetricsOverride({width, height: 900, deviceScaleFactor: 1, mobile: false})`, `document.documentElement.scrollWidth <= document.documentElement.clientWidth` (headless Chrome draws a classic scrollbar, so `innerWidth` is the wrong comparison); the page loads with no console error, no uncaught exception and no CSP violation; every `[data-copy-for]` button has `hidden === false` and a non-zero bounding box (the script ran); and `document.fonts.check('16px "Hanken Grotesk"', '\u016b')` is true (the latin-ext subset that carries the kahakō loaded). Checked by `scripts/check-site-browser.mjs` (§7).

## 4. Architecture

```text
site/                              the Cloudflare Pages build output directory, deployed as-is
├── index.html                     the landing page (from docs/site/mockup.html)
├── 404.html                       not-found page (§6); its presence also stops Pages' SPA fallback
├── styles.css                     every style rule; tokens on :root and the light media query
├── copy.js                        copy-to-clipboard, nothing else
├── _headers                       Cloudflare Pages response headers (§6)
├── robots.txt                     "User-agent: *" / "Allow: /"
├── marketplace.json               seeded from docs/site/assets/
├── favicon.svg                    seeded
├── favicon.ico                    seeded (16, 32, 48)
├── apple-touch-icon.png           seeded (180 × 180)
├── og.png                         seeded (1200 × 630 social card)
└── fonts/                         seeded: six .woff2 subsets and two OFL licence texts
scripts/
├── check-site.mjs                 static checks for §3 rules 1–14; --self-test mode
├── check-site-browser.mjs         §3 rule 15 through Chrome's DevTools protocol
└── serve-site.mjs                 local server for site/ that applies site/_headers
docs/site/                         inputs for this flight; never deployed
├── mockup.html                    approved design and copy (inline styles on purpose)
├── social-card.html               the source og.png was rendered from
├── screens/                       the mockup rendered at 1440 (dark, light), 768 (light), 360 (dark)
├── assets/                        the seeded files, copied byte for byte into site/
├── checks.json                    budgets, viewports, contrast pairs
└── DEPLOY.md                      Cloudflare Pages setup and the launch checklist
```

Boundaries the reviewer enforces:

- `site/` is self-contained. Nothing in it references `docs/`, `scripts/` or anything outside `site/`.
- `scripts/check-site.mjs` and `scripts/serve-site.mjs` never write into `site/`. `check-site-browser.mjs` writes screenshots only to `.site-shots/` (gitignored) and only when `--shots` is passed.
- The production page is not the mockup with its styles moved. Class names are semantic (`.stage`, `.install`, `.step`), and repeated inline declarations in the mockup become shared rules. The visual result is what has to match, not the markup.
- Components separate cleanly for parallel work: `site/` (page, styles, script, static files) and `scripts/` (the three checkers) touch disjoint files. `package.json`, `scripts/lint.sh` and the CI workflow are the shared wiring and stay serial.

## 5. Data and configuration

`docs/site/checks.json` holds every tunable the checkers read. The checkers fail with a clear message on an unknown key or a wrong type, as the plugin's own config validators do.

| Key | Default | Notes |
|---|---|---|
| `budget.textBytes` | 65536 | ⚠️ ASSUMPTION. index + styles + script + 404 |
| `budget.fontBytes` | 184320 | ⚠️ ASSUMPTION. The seeded fonts total 165,872 bytes (162 KiB) |
| `budget.scriptBytes` | 2048 | ⚠️ ASSUMPTION |
| `viewports` | `[360, 768, 1440]` | Widths for the browser check |
| `contrastMin` | 4.5 | ⚠️ ASSUMPTION. WCAG AA for body text |
| `contrastPairs` | see file | Token pairs, foreground first |
| `copyFeedbackMs` | 2400 | ⚠️ ASSUMPTION. How long a button reads "Copied" |
| `servePort` | 8788 | ⚠️ ASSUMPTION. `SITE_PORT` overrides it |

`copy.js` cannot read `checks.json` at runtime (it is not deployed), so the task that writes `copy.js` copies `copyFeedbackMs` into the line `const COPY_FEEDBACK_MS = 2400;` at the top of the file, and `check-site.mjs` asserts that number equals the config value.

Environment variables: `SITE_PORT` (serve and browser check), `CHROME_PATH` (browser check; see §7).

## 6. Interfaces

### The page

- **Sections, in order**, with the ids the mockup uses: header with nav and hero (`#top`), problem, How it works (`#how`), Why it holds up, Get started (`#start`), Proof (`#proof`), Where it's going, Built by, footer. `<main id="main">` wraps everything between the header and the footer.
- **Head.** The mockup's `<head>` is the reference: title, description, canonical, `color-scheme`, both `theme-color` metas, icons, Open Graph and Twitter tags. In production, icon and font paths are root-relative (`/favicon.svg`, `/fonts/...`) and `og:image` is `https://kukulu.tech/og.png`. Add `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/hanken-grotesk-latin-wght-normal.woff2">` and the same for `hanken-grotesk-latin-ext-wght-normal.woff2`.
- **Fonts.** Six `@font-face` rules in `styles.css`, copied from the mockup's (family names, `font-weight` ranges, `unicode-range` values and `font-display: swap`), pointing at `/fonts/`. No Google Fonts request: self-hosting the same pairing satisfies both "one Google Fonts pairing" and "no tracking".
- **Theme.** Dark tokens on `:root`. Light tokens under `@media (prefers-color-scheme: light)`. `@media print` uses the light tokens. The mockup's `data-theme` attribute is a preview aid only and does not ship.
- **Line numbers** in the hero code block are drawn with a CSS counter (as in the mockup's `pre.lines`), so they are not in the text a visitor selects or the script copies.
- **Responsive behavior** follows the mockup's two breakpoints exactly: at 860 px and below the pipeline and evidence rows stack, the return arrow becomes the inline "Misses go back to Implement for fixes" note, and the input-to-room connector switches to the single centered arrow. At 640 px and below the gutter is 16 px, section spacing is 80 px, Get started steps stack their label above the content, and copy buttons sit under their code. Code blocks never wrap; they scroll inside their own box.
- **Motion.** Smooth scrolling for in-page anchors, turned off under `prefers-reduced-motion: reduce`. Nothing else animates.

### Copy-to-clipboard (`copy.js`)

- Each copyable block is a `<code id="...">` with a `<button type="button" class="copy" data-copy-for="<that id>" hidden>` whose word sits in `<span class="copy-label">Copy</span>`, and a status element `<p class="copy-status" id="<that id>-status" role="status" aria-live="polite">` that starts empty. There are four, with the ids the mockup uses: `install-session` (hero), `install-shell`, `spec-template` and `flight-cmd` (Get started steps 1–3).
- `styles.css` contains `[hidden]{display:none !important}`; without it, `.copy{display:inline-flex}` would show the buttons even when the script never ran.
- On load, if `navigator.clipboard?.writeText` exists, the script removes `hidden` from every `[data-copy-for]` button. Without the API, or without JavaScript, the buttons stay hidden and the text is still selectable.
- On click: copy the target's `textContent` exactly (no trimming beyond a trailing newline), set the button's `.copy-label` text to "Copied" (the icon and `aria-label` stay unchanged) and its block's status to "Copied to the clipboard." On failure the status reads "Copy failed. Select the text and copy it manually." After `COPY_FEEDBACK_MS`, restore the label to "Copy" and clear the status.
- No globals, no inline handlers, no other behavior. An IIFE or a module-free script under `defer`.

### 404 page

`site/404.html` uses `styles.css`, the skip link, the header wordmark linking to `/`, a `<main id="main">`, and this copy exactly: title `Page not found — Kūkulu`, `h1` "Page not found.", paragraph "There is nothing at this address.", and a link "Go to the home page" to `/`. No script.

### `site/_headers`

Exactly these rules, in this order:

```text
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000

/marketplace.json
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *

https://:project.pages.dev/*
  X-Robots-Tag: noindex

https://:version.:project.pages.dev/*
  X-Robots-Tag: noindex
```

The last two rules keep the `pages.dev` copies of the site, including branch previews, out of search results; only `kukulu.tech` is indexed. Do not add `Cache-Control`: Cloudflare Pages already sends `max-age=0, must-revalidate` with ETags, and its documentation advises against custom caching.

### `scripts/serve-site.mjs`

`node scripts/serve-site.mjs [--port N]` serves `site/` on `127.0.0.1`, applies the path rules from `site/_headers` (the absolute-URL rules do not apply locally) except that it drops the CSP's `upgrade-insecure-requests` directive and the `Strict-Transport-Security` header, which would break plain-HTTP localhost, sends `Content-Type` by extension (`text/html`, `text/css`, `text/javascript`, `application/json`, `image/svg+xml`, `image/png`, `image/x-icon`, `font/woff2`, `text/plain`, with `; charset=utf-8` on the text types), serves `404.html` with status 404 for anything missing, refuses paths that escape `site/`, and prints the URL. It exports a `start({ port }) → { url, close }` function that the browser check imports, so both use the same server.

### `scripts/check-site-browser.mjs`

- Finds Chrome or Chromium from `CHROME_PATH`; otherwise from `google-chrome`, `chromium`, `chromium-browser` on `PATH`; otherwise from `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. If it finds none, it exits non-zero and says to set `CHROME_PATH`. It never skips silently.
- Launches it headless with `--remote-debugging-port=0` and a temporary profile, reads the browser's DevTools WebSocket URL from stderr, and drives it with Node's built-in `WebSocket` (Node ≥ 22). It does not use Playwright or Puppeteer. That URL is the browser target, so it creates a page with `Target.createTarget`, attaches with `Target.attachToTarget({ flatten: true })`, and sends every page command with the returned `sessionId`. It enables `Runtime`, `Log` and `Page`.
- For each viewport and each of `dark`/`light` (via `Emulation.setEmulatedMedia` with `prefers-color-scheme`), loads the page from `serve-site.mjs`, waits for the `load` event and then `document.fonts.ready`, and asserts rule 15. Any `Log.entryAdded` at level `error` (CSP violations arrive this way), any `Runtime.consoleAPICalled` of type `error`, and any `Runtime.exceptionThrown` fail the check, naming the viewport and scheme.
- With `--shots`, writes full-page PNGs to `.site-shots/<width>-<scheme>.png` for the human comparison in §8.

## 7. Commands

- lint: `npm run lint` — the existing syntax, manifest and name checks. From P1 task 4, `scripts/lint.sh` also runs `node scripts/check-site.mjs`.
- site checks: `npm run check:site` — runs `node scripts/check-site.mjs --self-test && node scripts/check-site.mjs`. True from P1 task 4 (`from:` that task); earlier tasks run the rules they have written directly. The self-test copies `site/` and `docs/site/checks.json` into a temp directory, injects one violation per rule in §3 (1–14), and fails unless each is caught with a message naming its rule.
- browser checks: `npm run check:site:browser` — `node scripts/check-site-browser.mjs`. Needs Chrome or Chromium. Run it as `extraVerify` on `site/`, `scripts/check-site-browser.mjs` and `scripts/serve-site.mjs`, true from P2 task 1 (`from:`). It binds a port, so mark it `exclusive`. It never skips silently, so every machine that runs this flight needs Chrome or Chromium installed.
- plugin tests: `npm test` — the existing eleven suites. Run it as `extraVerify` whenever a task touches `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/`, `package.json` or `scripts/lint.sh`, because `test/plugin.mjs` checks documentation links and the README. It must stay green; this flight adds no suite.
- local preview: `npm run site:serve` — `node scripts/serve-site.mjs`. For humans; not a verify command.

`package.json` gains exactly these `scripts`: `check:site`, `check:site:browser`, `site:serve`. No `dependencies` or `devDependencies`.

## 8. Phases

### Phase 1 — The page and its static checks

1. Copy the seeded files from `docs/site/assets/` into `site/` (§4 paths) and add `site/robots.txt`. Write `docs/site/checks.json` validation into `check-site.mjs` first, then rules 1, 2 and 8, with the self-test for each.
2. Write `site/styles.css` (tokens, fonts, base, components) and `site/index.html`, section by section in page order, from the mockup.
3. Write `site/copy.js`, `site/404.html` and `site/_headers`.
4. Complete `check-site.mjs` (rules 3–7 and 9–14) and its self-test; add `check:site` to `package.json` and the `check-site.mjs` line to `scripts/lint.sh`.
5. Write `scripts/serve-site.mjs` and `site:serve`.
6. End of phase: push. **Manual check (human):** run `npm run site:serve`, open it in a desktop browser and a phone (or device emulation at 360 px), in both color schemes, and compare against `docs/site/screens/`. Tab through the page: the skip link appears first and every link and button shows a visible focus ring. Press each copy button and paste the result.

### Phase 2 — Browser checks, CI and docs

1. Write `scripts/check-site-browser.mjs` and `check:site:browser`; add `.site-shots/` to `.gitignore`.
2. Add `.github/workflows/site.yml`: on push to `main`, pull requests and `workflow_dispatch`, on `ubuntu-latest` with Node 24, run `npm run check:site` and `npm run check:site:browser` (the runner image ships Google Chrome; set `CHROME_PATH` from `command -v google-chrome`). Pin actions the way `ci.yml` does.
3. Update `README.md`: a `site/` line in "Repo layout", a "Website" line in "Documentation map" linking `docs/site/DEPLOY.md` (the README sits at the repo root, so the link target is `docs/site/DEPLOY.md`), and, under Quickstart step 1, the hosted alternative (`claude plugin marketplace add https://kukulu.tech/marketplace.json`). Update `CONTRIBUTING.md`'s layout table with the three scripts and `site/`, and add an Unreleased entry to `CHANGELOG.md`.
4. End of phase: push. **Manual check (human):** follow [docs/site/DEPLOY.md](site/DEPLOY.md) to deploy the build branch as a Cloudflare Pages preview and run its launch checklist against the preview URL, including installing the plugin from the preview's `marketplace.json`.

## 9. Open questions

None block the build. Decided already, so the planner does not need to:

- **Theme.** No toggle (the brief allows no script beyond copy). Dark is the default; light follows the visitor's system setting.
- **Fonts.** Self-hosted, not loaded from Google Fonts, so the CSP can be `'self'` only and no visitor request leaves the site.
- **Marketplace name.** `displacetech`, matching `.claude-plugin/marketplace.json`, so `kukulu@displacetech` is the one install id everywhere.
- **Recording link.** Left out until there is a URL. Adding it later is a one-line change plus a mockup edit.

For the human, outside this flight (listed in DEPLOY.md's launch checklist): make `DisplaceTech/kukulu`, `ericmann/cleanflate` and `ericmann/cleanflate-bench` public before announcing the site, since the install command and the proof links depend on them.

## Appendix: mockups and fixtures

| File | What it is |
|---|---|
| [docs/site/mockup.html](site/mockup.html) | The approved page: layout, components, copy, tokens, breakpoints. Opens from disk; add `data-theme="light"` to `<html>` to force the light scheme |
| [docs/site/screens/desktop-dark.jpg](site/screens/desktop-dark.jpg) | Mockup at 1440 px, dark (rendered at half scale) |
| [docs/site/screens/desktop-light.jpg](site/screens/desktop-light.jpg) | Mockup at 1440 px, light (half scale) |
| [docs/site/screens/tablet-light.jpg](site/screens/tablet-light.jpg) | Mockup at 768 px, light (half scale) |
| [docs/site/screens/mobile-dark.jpg](site/screens/mobile-dark.jpg) | Mockup at 360 px, dark (three-quarter scale) |
| [docs/site/social-card.html](site/social-card.html) | Source of `og.png`; reference only |
| [docs/site/assets/](site/assets/) | Seeded files: `marketplace.json`, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og.png`, `fonts/` (Hanken Grotesk and JetBrains Mono variable subsets, latin and latin-ext, from Fontsource 5.3.0, with their SIL OFL 1.1 texts) |
| [docs/site/checks.json](site/checks.json) | Checker configuration (§5) |
| [docs/site/DEPLOY.md](site/DEPLOY.md) | Cloudflare Pages setup, DNS, and the launch checklist |
