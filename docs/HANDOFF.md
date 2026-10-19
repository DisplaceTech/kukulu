# Handoff: kukulu.tech landing page

- Branch: `build/landing` (created from `feature/landing` because `kukulu_run_start` refuses other branch names; the base is `main`, merge-base `9488ce6`).
- Head at handoff: `3619949`.
- Tasks: 13 done, 0 blocked, 0 skipped (P1-01 to P1-09, P2-01 to P2-04).
- `kukulu_verify` was green at the last code task: lint, pre-commit, `npm run check:site` (52 cases), `serve-site --self-test` (21 checks), `npm run check:site:browser` (6 runs), `npm test` (2,210 assertions).

## Blocked and skipped tasks

None.

## Interpretation choices

- P1-01: self-test cases match `expect` against the failure message, so rule 1 messages repeat the file name. `--report` came in P1-07.
- P1-02: `.btn-outline:hover` uses the stylesheet's ink background with page-background text (the mockup's inline colour made the hover text invisible). Stage and evidence cards share `.stage`, with `.pipe` and `.ev` scoped overrides.
- P1-04: the 404 page reuses existing classes and puts its link in its own paragraph. A failed copy leaves the button label as "Copy".
- P1-05: a missing site file is reported by the rule that needs it; rule 4 also asserts `copy.js` line 2 literally.
- P1-06: rule 9 needs exactly one `@media print` block holding one `:root` rule and compares custom properties only. Test strings that would trip constraints are assembled from pieces.
- P1-08: a bad %-escape in the path is a 403; a missing file gets `404.html` with its own path's headers.
- P2-03: the hosted-marketplace sentence is an indented paragraph in Quickstart step 1.

## ⚠️ ASSUMPTION values (none changed; `docs/site/checks.json` untouched)

| Key | Default | Measured |
|---|---|---|
| `budget.textBytes` | 65536 | 49503 (24% headroom) |
| `budget.fontBytes` | 184320 | 165872 (10%) |
| `budget.scriptBytes` | 2048 | 1009 (51%) |
| `contrastMin` | 4.5 | lowest dark 5.51, light 4.91 (both `--code-muted` on `--code-bg`) |
| `copyFeedbackMs` | 2400 | not machine-measurable |
| `servePort` | 8788 | not machine-measurable |

## Manual checks (human)

- Phase 1: run `npm run site:serve`, compare with `docs/site/screens/` on desktop and at 360 px in both schemes; Tab through (skip link first, 2 px focus ring); 44 px touch targets; press all four copy buttons and paste; judge the "Copied" duration. I viewed only the 1440 dark screenshot, and it matched the mockup's structure; every other visual comparison is unverified.
- Phase 2: deploy a Cloudflare Pages preview per `docs/site/DEPLOY.md`, run its launch checklist including installing from the preview's `marketplace.json`, and confirm the PR's `site`, `ci` and `lint` checks are green (the new workflow has not run on GitHub).

## Codebase notes

- The `site-scripts-node-builtins` constraint scans the checkers' own source, so test strings containing an import `from "x"` or a CommonJS require call must be assembled from pieces.
- `scripts/check-names.mjs` rejects a literal combining U+0304 anywhere, including in test source; write it as an escape.
- Headless Chrome (`/usr/bin/google-chrome`, Node 24) exposes `navigator.clipboard` on `127.0.0.1`, so the copy buttons are revealed and the browser check passes without special flags.
- `kukulu_run_start` refuses branches other than `main` or `build/*`; this run created `build/landing` by hand from `feature/landing`.

## For a reviewer

- `site/` is hand-written from the mockup with semantic classes; the seeded assets are byte-identical copies. `scripts/check-site.mjs` holds rules 1 to 14 with a 52-case self-test and a baseline that must be clean.
- Nothing under `docs/site/`, `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/` changed.

## Round 1

Review-fix round: 3 tasks (R1-01..R1-03), all done, none blocked. Head at handoff: e892d30 plus this file.

- R1-01: 17 new check-site.mjs self-test cases (69 total) for the surviving branches of rules 4, 5, 8, 9, 10, 12, 14 and the contrastMin config check. No rule changed.
- R1-02: serve-site.mjs gains `choosePort` (port argument, then SITE_PORT, then servePort). Interpretation: an empty SITE_PORT counts as unset; a non-integer or above 65535 value rejects start() with a message naming SITE_PORT. Self-test covers precedence and `GET /%00` is 403 (26 checks after R1-03). It never binds servePort.
- R1-03: check-site-browser.mjs has `--self-test` (6 cases, one Chrome for all). Chrome shutdown now sends Browser.close, falls back to SIGKILL, awaits exit, then removes the profile. serve-site `start()` takes `siteDir`. `docs/kukulu.json` extraVerify and `.github/workflows/site.yml` run the self-test. Interpretation: the overflow case adds its width by appending a CSS rule to the temp copy, since the page CSP blocks inline styles.
- Hand check: none. Old `/tmp/check-site-browser-*` directories from before this fix may remain; the count no longer grows.

Codebase notes (round 1): the site CSP blocks style attributes, which Chrome reports as a console error; `document.fonts.check` does return false when the latin-ext face URL is missing.

## Round 2

Review-fix round: 2 tasks (R2-01, R2-02), both done, none blocked.

- R2-01: check-site-browser.mjs self-test gains 'a console.error is caught', 'an uncaught exception is caught' and 'a page with no copy buttons is caught' (9 cases). withBrowser now hands its callback the Chrome pid; the profile case also asserts the process exited (kill 0 gives ESRCH) and the profile is still absent after PROFILE_SETTLE_MS.
- R2-02: serve-site.mjs self-test gains three checks (29 total): SITE_PORT above 65535, empty SITE_PORT, and the siteDir 404.html. Interpretation: the over-range value is `String(0xffff + 1)`, since constraint no-hardcoded-site-tunables forbids the literal 65536.
- Hand check: none. Reviewer re-runs kukulu_mutate as listed in the tasks.

Codebase notes (round 2): none.
