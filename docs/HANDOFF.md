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
