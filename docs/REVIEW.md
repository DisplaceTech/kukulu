# Review: kukulu.tech landing page (build/landing)
Round: 1

## Verdict

CHANGES REQUESTED

Categories 1 and 2 are clean: every constraint passes with no hits and no fixture failures, and nothing outside SPEC §2's allowed file set changed. The page reproduces the mockup: the visible text is identical to `docs/site/mockup.html`'s (7,856 characters compared in full, aria-hidden subtrees included), and every `href`, `id`, `role`, `aria-*`, `scope` and `data-copy-for` value matches the mockup's in order, apart from the root-relative asset paths. The 1440, 768 and 360 px screenshots match `docs/site/screens/` in structure. `kukulu_verify` is green: lint, pre-commit, the check-site self-test (52 cases), serve-site self-test (21 checks), browser check (6 runs) and `npm test` (2,210 assertions).

Category 3 is not clean. Mutation sampling shows that many of the rules the checkers enforce can be switched off without any test noticing, including every assertion in the rule 15 browser check. The browser check also leaves a Chrome profile directory in the temp dir after every run, which P2-01 says must not happen. Under the round-1 rule, each file with a surviving mutant gets one fix task listing all of its survivors.

## Findings

### 1. Category 3: `scripts/check-site-browser.mjs` has no test, so all of rule 15's assertions survive mutation (P2-01)

- `scripts/check-site-browser.mjs:189`: the overflow assertion `if (r.scrollWidth > r.clientWidth)` replaced with `if (false)` survived `npm run check:site:browser`.
- `:197`: the console-error, CSP-violation and uncaught-exception reporting (`for (const e of events) failures.push(...)`) deleted: survived.
- `:194`: the font assertion `if (!r.font)` replaced with `if (false)`: survived.
- `:192`: the copy-button assertion (`b.hidden || b.w === 0 || b.h === 0`) replaced with `if (false)`: survived.

A page-side mutant does kill: `.wrap{width:1300px}` in `site/styles.css` failed at 360 and 768, and deleting `button.hidden = false;` from `copy.js` failed every run. So the check works today. The problem is that if the checker breaks, CI goes green and stays green. P2-01's negative test was run once by hand and never committed.

What breaks: a later edit can quietly disable rule 15, the only automated layout, CSP and font gate, in CI as well.

Minimal fix: add a `--self-test` that runs the same probe against temp copies of `site/` with one violation injected per assertion, served through `serve-site.mjs`'s `start()` given an optional `siteDir`. Wire it into verify and CI. See R1-03.

### 2. Category 5: the browser check leaks its temp Chrome profile on every run (P2-01)

`scripts/check-site-browser.mjs:219-221` sends `child.kill("SIGKILL")` and calls `fs.rmSync(profile, …)` straight away, without waiting for Chrome to exit. Chrome's child processes are still writing, so they recreate `Default/Cache/...` after the delete. After this review's runs, `/tmp` held 13 `check-site-browser-*` directories, each containing `Default/Cache/Cache_Data/index-dir/the-real-index`. P2-01 requires that "Chrome is killed and the temp profile removed on every exit path, including failure."

Separately, the profile is created (`:142`) before `start({})` (`:143`) and outside the `try`. If the port is already bound, the profile leaks without Chrome ever starting.

What breaks: every local run and every CI run leaves a directory behind, and they pile up on developer machines.

Minimal fix: close the browser (`Browser.close` over CDP, then SIGKILL as a fallback after a timeout), await the child's `exit` event before removing the profile, and create the profile inside the `try` after the server starts. The self-test from finding 1 asserts that the profile directory no longer exists after a run. See R1-03.

### 3. Category 3: `scripts/check-site.mjs` rules whose branches no self-test case covers (P1-01, P1-05, P1-06)

Each of these mutants survived `node scripts/check-site.mjs --self-test && node scripts/check-site.mjs`. A control mutant, deleting the proof-table `diff`, was killed by "rule 6: a changed table number", so the harness itself works.

- Rule 4, `:408`: the "status element is not empty" branch disabled.
- Rule 4, `:402`: the `.copy-label` reading "Copy" check disabled.
- Rule 4, `:404`: the "has no `<code>` target with that id" check disabled.
- Rule 4, `:381`: the "line 2 is the `COPY_FEEDBACK_MS` declaration" check disabled.
- Rule 5, `:433`: the og:image value check weakened to presence only.
- Rule 5, `:427`: the non-canonical `<link href>` root-relative check disabled.
- Rule 5, `:441`: the `@import` check disabled.
- Rule 8, `:305`: the `owner.name` comparison deleted.
- Rule 9, `:639`: the "print tokens differ from the light tokens" check disabled. The existing case removes the print block entirely, which takes a different path.
- Rule 9, `:656`: the "token is missing or not `#rgb`/`#rrggbb`" check disabled.
- Rule 10, `:700`: the `<img>` alt check disabled.
- Rule 10, `:717`: the button accessible-name check disabled.
- Rule 10, `:720`: the `<main id="main">` check disabled.
- Rule 12, `:765` and `:768`: the 2,000-character line limit and the 100-rule limit disabled.
- Rule 14, `:812`: the CommonJS `require` check disabled.
- Config, `:71`: the `contrastMin` 1–21 range check disabled.

What breaks: any of these rules can rot without notice. SPEC §7 says the self-test "fails unless each is caught". Today only one branch per rule is proven, and the rest are untested.

Minimal fix: one self-test case per survivor. See R1-01.

### 4. Category 3: `scripts/serve-site.mjs`: port precedence and the NUL refusal are untested (P1-08)

- `:69`: replacing the precedence expression with `port ?? loadConfig(CONFIG_PATH).servePort`, which ignores `SITE_PORT`, survived the whole verify set, including the browser check.
- `:97`: dropping `|| decoded.includes("\0")` survived. A request for `/%00` then gets a 404 instead of the 403 that P1-08 specifies.
- `SITE_PORT` is not validated. `SITE_PORT=abc` reaches `server.listen(NaN)` and fails with Node's generic port error, not a message that names `SITE_PORT`.

The `https://` rule filter at `:43` is an equivalent mutant: those patterns can never equal a request path. It is not a finding.

Minimal fix: self-test checks for argument over `SITE_PORT` over `servePort`, a refusal of a bad `SITE_PORT`, and `/%00` returning 403. See R1-02.

## Interpretation choices (HANDOFF.md)

- P1-01, P1-05, P1-06, P1-07, P2-03: consistent with SPEC and PLAN.
- P1-02 `.btn-outline:hover`: consistent. The mockup's own stylesheet rule is `background:var(--ink);color:var(--bg)`. Only the mockup's inline `color` overrode it.
- P1-04, label stays "Copy" on failure: this is what PLAN P1-04 specifies. See Notes for one edge case.
- P1-08, bad %-escape returns 403: PLAN P1-08 specifies this.
- P1-08, a missing file gets "its own path's headers": PLAN P1-08 says "the `/*` headers". The two readings differ only when a path with its own `_headers` rule (`/marketplace.json`) is missing. Then the 404 HTML body would go out as `Content-Type: application/json`. This is not observable with the shipped file set, so it is recorded under Notes and is not a task.

## Blocked and skipped tasks

None.

## Spec issues

1. SPEC §7 requires a self-test only for `check-site.mjs`. It gives the browser check none, so rule 15's assertions are proven only by a one-off manual negative check (P2-01). Finding 1 closes this gap with a test. The spec should say that the browser check proves its own assertions too.
2. Rule 12's line-length and rule-count limits cannot fail on their own while `_headers` must equal SPEC §6's block verbatim. They are kept and tested (R1-01) because SPEC lists them.

## Manual checks still owed

- Phase 1: run `npm run site:serve` and compare with `docs/site/screens/` on desktop and at 360 px, in both color schemes. Tab through the page: the skip link comes first, and every link and button shows a 2 px focus ring. Check that touch targets are 44 px. Press all four copy buttons and paste the result. Judge the "Copied" duration (`copyFeedbackMs` 2400, ⚠️ ASSUMPTION). The reviewer compared headless screenshots at 1440 dark and light, 768 light and 360 dark (scrollbar-narrowed widths of 1425, 753 and 345 px), and they match in structure. A real browser, a phone and focus behaviour are still unverified.
- Phase 2: deploy a Cloudflare Pages preview per `docs/site/DEPLOY.md` and run its launch checklist, including installing from the preview's `marketplace.json`. Confirm the PR's `site`, `ci` and `lint` checks are green. The new workflow has not run on GitHub.

## Notes

- `site/copy.js`: click behaviour (label, status text, the timer) is covered only by the manual copy-button check SPEC §8 prescribes. A mutant that changes "Copied" to "Copy" survives every command. This is not a fix task, because SPEC assigns the behaviour to a human. One edge case: a successful copy followed within 2.4 s by a failed one leaves the label at "Copied" while the status reads "Copy failed…".
- `scripts/serve-site.mjs`: `/marketplace.json/` (trailing slash) and `/index.html/` resolve to the files and are served with 200. Cloudflare would redirect them. This is harmless locally.
- `check-site-browser.mjs` collects console events only until 150 ms after the probe resolves. A late asynchronous error would be missed. This is acceptable for a page whose only script runs on load.
