# kukulu.tech build progress
Branch: build/landing
Started: 2026-10-19T16:52:28.587Z

## Tasks
- [x] P1-01 Seed site/ and start check-site.mjs with config validation and rules 1, 2 and 8
- [x] P1-02 styles.css foundation and index.html through How it works
- [x] P1-03 index.html from Why it holds up to the footer
- [x] P1-04 copy.js, 404.html and _headers
- [x] P1-05 check-site.mjs rules 3 to 7
- [x] P1-06 check-site.mjs rules 9 to 14, check:site and the lint line
- [x] P1-07 Measure the budgets and contrast against their assumptions
- [x] P1-08 serve-site.mjs and site:serve
- [x] P1-09 Phase 1 end: push and record the manual check
- [x] P2-01 check-site-browser.mjs, check:site:browser and .site-shots/
- [x] P2-02 The site CI workflow
- [x] P2-03 README, CONTRIBUTING and CHANGELOG for the site
- [x] P2-04 Phase 2 end: push and record the manual check
- [ ] R1-01 check-site.mjs self-test cases for the uncovered rule branches
- [ ] R1-02 serve-site.mjs: test port precedence, validate SITE_PORT, test the NUL refusal
- [ ] R1-03 check-site-browser.mjs --self-test and no leaked Chrome profile

## Log
(one entry per task, appended by implement)

### P1-01 — 047ab27
Seeded site/ byte-identical + robots.txt; scripts/check-site.mjs with loadConfig, checkSite (ctx.fail(rule,file,what,fix) pattern; add rules by writing ruleN(ctx) and calling it in checkSite), CASES array (13 cases), selfTest, CLI. IMPLEMENTED_RULES constant drives the "ok (rules ...)" line; extend it per task. Self-test cases match `expect` against message. --report flag not yet accepted (unknown flag exits 2).

### P1-02 — 2958fe7
styles.css has fonts, tokens (dark :root, light media, print), base, and components for header/hero/problem/How. Class vocabulary: .wrap-stack/.wrap-stack-tight/.wrap-split, .sec-head, .body-text, .inline-code, .icon/.icon-accent/.icon-dot, .arrow/.arrow-head, .stage (scoped by .pipe/.ev), .copy-status (+.install override). index.html ends with `</main></body></html>` after How it works; P1-03 inserts sections before `</main>` and the footer after it, and must add .step/.codebox (mobile rules: .step single column, .codebox column with .copy aligned end) CSS. Interpretation: .btn-outline:hover uses ink bg/bg text rather than mockup's inline colour.

### P1-03 — c1ce17d
index.html complete (all sections + footer); styles.css gained rules for them incl. .step/.codebox mobile rules. 4 copy buttons (hidden) with 4 empty copy-status elements. Table th/td text copied verbatim from the mockup. Chart marks are classes (.mark-*, .label-*, .tick-*, .scale-*). Interpretation: none.

### P1-04 — 843dc24
copy.js (1009 bytes, line 2 is the COPY_FEEDBACK_MS const), 404.html (no styles.css change needed; reuses site-header/nav/brand/sec-head/h1), _headers verbatim from SPEC 6. 404 main is `<main id="main" class="wrap sec sec-last">`. Interpretation: failed copy leaves the label as "Copy"; timer set in .finally so both outcomes reset.

### P1-05 — 323b4ae
Rules 3-7 + parseHtml/textContent/visibleText/findAll exported; 32 self-test cases. Helpers for later rules: need(ctx,rule,rel) reads a site file or reports it missing; byTag/byId/hasClass/collapse; sub(t,file,from,to) for cases (throws if the target text is absent); CASES.push block placed before makeTemp (add more there). Real page passed all rules unchanged. Interpretation: rule 4 also asserts copy.js line 2 literally.

### P1-06 — b4ac94a
Rules 9-14 + rule 1 missing half; 51 self-test cases; ok line lists 1..14. package.json gains check:site; lint.sh runs check-site.mjs after check-names. Exports added: contrastReport(opts) -> {contrastMin, dark:[{fg,bg,fgValue,bgValue,ratio}], light:[...]} (throws on unusable styles.css), contrastRatio. Real site passed all rules unchanged. Interpretation: rule 9 needs exactly one @media print block with one :root rule, compares custom properties only. Codebase notes: the constraint site-scripts-node-builtins scans the checker's own source, so test strings that contain `from "x"` or require( must be assembled from pieces; check-names rejects a literal combining U+0304 in source (use the escape).

### P1-07 — d6a55a8
--report added (exported report(opts)); 52 self-test cases incl. a `report` case with a verify callback. Measurement (before = assumption -> after = measured): textBytes 65536 -> 49503 (24% headroom); fontBytes 184320 -> 165872 (10%); scriptBytes 2048 -> 1009 (51%); contrast min 4.5 -> lowest dark 5.51, light 4.91 (both --code-muted on --code-bg); copyFeedbackMs 2400 and servePort 8788 not machine-measurable. No config value changed.

### P1-08 — 223d23e
scripts/serve-site.mjs: exports async start({port}) -> {url, close}; port arg, SITE_PORT, then config servePort. Self-test 21 checks. close() calls closeAllConnections so it resolves promptly. CLI: --port N, --self-test; bad args exit 2. package.json gains site:serve. Interpretation: bad %-escape -> 403; missing file -> 404.html with headers for its own path.

### P1-09 — fc9cc90
Push: origin build/landing pushed (empty task commit follows the push; run_finish pushes again).
Manual check: NOT VERIFIED (human): run `npm run site:serve`, open it on desktop and at 360 px (device emulation or phone), both color schemes, and compare with docs/site/screens/. Tab through: skip link first, 2 px focus ring on every link and button. Confirm 44 px touch targets. Press all four copy buttons and paste. Judge whether "Copied" lasts long enough (copyFeedbackMs 2400, ASSUMPTION). Note: the page was written without a browser render in this run; all visual fidelity to the mockup is unverified.

### P2-01 — cab9422
scripts/check-site-browser.mjs works with /usr/bin/google-chrome (Node 24): 6 runs ok in ~4 s; --shots writes .site-shots/ (gitignored). Negative overflow check done by hand and reverted; CHROME_PATH=/nonexistent exits 1. Screenshot of 1440 dark viewed: structure matches mockup. No site/ changes needed.

### P2-02 — fd9e313
.github/workflows/site.yml added (checkout@v7, setup-node@v7 node 24, check:site, browser step with CHROME_PATH from command -v google-chrome). Manual check: NOT VERIFIED (human): the PR's `site` check is green on GitHub Actions (not run locally).

### P2-03 — cc2b17d
README (layout line, Website doc-map line, hosted-marketplace sentence under Quickstart 1), CONTRIBUTING (4 new rows), CHANGELOG (Unreleased/Added above 0.6.1). Version unchanged. Interpretation: sentence placed as an indented paragraph in the list item after the code block.

### P2-04 — 94e44b2
Push: origin build/landing pushed. Manual check: NOT VERIFIED (human): follow docs/site/DEPLOY.md to deploy the build branch as a Cloudflare Pages preview, run its launch checklist against the preview URL including installing the plugin from the preview's marketplace.json, and confirm the PR's site, ci and lint checks are green.
