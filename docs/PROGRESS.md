# kukulu.tech build progress
Branch: build/landing
Started: 2026-10-19T16:52:28.587Z

## Tasks
- [x] P1-01 Seed site/ and start check-site.mjs with config validation and rules 1, 2 and 8
- [x] P1-02 styles.css foundation and index.html through How it works
- [x] P1-03 index.html from Why it holds up to the footer
- [x] P1-04 copy.js, 404.html and _headers
- [ ] P1-05 check-site.mjs rules 3 to 7
- [ ] P1-06 check-site.mjs rules 9 to 14, check:site and the lint line
- [ ] P1-07 Measure the budgets and contrast against their assumptions
- [ ] P1-08 serve-site.mjs and site:serve
- [ ] P1-09 Phase 1 end: push and record the manual check
- [ ] P2-01 check-site-browser.mjs, check:site:browser and .site-shots/
- [ ] P2-02 The site CI workflow
- [ ] P2-03 README, CONTRIBUTING and CHANGELOG for the site
- [ ] P2-04 Phase 2 end: push and record the manual check

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
