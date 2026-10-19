# Build summary: kukulu.tech landing page

**Merge:** `build/landing`, base `main` (merge-base `9488ce6`) → head `3450e7e`, 62 commits, 5 reviews, final verdict **APPROVED** (round 5).

## What was built

**Phase 1: the page and its static checks (P1-01 to P1-09).** `site/` is the kukulu.tech landing page, written by hand from the approved mockup `docs/site/mockup.html` using semantic class names. It holds `index.html`, `404.html`, `styles.css`, `copy.js`, `_headers`, `robots.txt` and byte-identical copies of the seeded assets. Styling lives only in `styles.css`: dark tokens by default, light tokens through `prefers-color-scheme`, and a print block that repeats the light set. `copy.js` is a single IIFE under the 2,048-byte script budget, and it reveals the four copy buttons. `scripts/check-site.mjs` enforces SPEC §3 rules 1 to 14. It has `--self-test`, which started at 52 cases and now has 69, each injecting one violation into a fresh temp copy, and `--report`, which prints measured budgets and contrast. `scripts/serve-site.mjs` serves `site/` locally with `_headers` applied and has its own `--self-test`. The npm scripts are `check:site` and `site:serve`, and `scripts/lint.sh` gained a line for the site.

**Phase 2: browser checks, CI and docs (P2-01 to P2-04).** `scripts/check-site-browser.mjs` runs rule 15 in headless Chrome over the DevTools protocol using Node's built-in `WebSocket`. It covers three widths in two color schemes. It fails on overflow, hidden or zero-size copy buttons, missing fonts, console errors, CSP violations and uncaught exceptions, and on a probe that runs before the load event. It has a 12-case `--self-test` and `--shots`. A new `site` CI workflow runs the static checks, the browser self-test and the browser check. README, CONTRIBUTING and CHANGELOG describe the site and the hosted `marketplace.json`.

**Review fixes (R1-01 to R4-01).** These rounds added self-test coverage for every mutant that survived a review: 17 check-site cases, `SITE_PORT` validation and port precedence in serve-site, and the browser self-test. They also fixed a Chrome profile leak: the checker now sends `Browser.close`, waits for Chrome to exit, and only then removes the profile. R4-01 made the browser checker fail when its page probe runs before `load`.

## Decisions that shaped it

- P1-01..P2-04: the SPEC §8 phases are kept in order with no Phase 0. SPEC P1 tasks 2 and 4 were each split in two (P1-02 + P1-03, P1-05 + P1-06), and P1-07 was added as a tuning task. As a result SPEC's "P1 task 4" is `P1-06`.
- P1-01/P1-06: rule 1 is split. P1-01 refuses unexpected files, and P1-06 adds the "every §4 file present" half once all the files exist.
- Rule 1's file list is the §4 list plus every file under `docs/site/assets/`, kept in step with the seeded set by construction.
- Rule 11 runs `scripts/check-names.mjs` over the site directory and reports each line it prints as a rule 11 failure.
- The self-test copies `site/`, `checks.json`, `package.json` and the site scripts into each case's temp directory. Reference inputs are read in place and never modified.
- Every failure is reported as one line: `check-site: rule <n>: <file>: <what>; <what to do>`. Config problems use `check-site: config:`.
- Rule 4 also covers `COPY_FEEDBACK_MS`, the script budget, the four copy blocks and the `[hidden]` rule. Rule 9 also covers matching the mockup's token sets.
- `\bKukulu\b` in rule 6 is case-sensitive, because lowercase `kukulu` is correct in commands and URLs.
- Rule 6 extracts its reference text from the mockup at check time and stores no copy of it. Rule 12 stores §6's `_headers` block as one string constant.
- `copy.js` is one IIFE whose line 2 is `  const COPY_FEEDBACK_MS = 2400;`, so the script defines no globals.
- serve-site gets a `--self-test` on port 0, run in `verify` from P1-08. `start({ port })` is async. Port precedence is `--port`, then `SITE_PORT`, then `servePort`.
- `loadConfig` is exported from `check-site.mjs` and imported by the other two scripts, so each key is validated in one place.
- SVG token colour is set through classes or `currentColor`, never `fill="var(--x)"`.
- The 404 page has only §6's copy: no nav and no footer.
- P1-07 measures the ⚠️ ASSUMPTION values and never changes `docs/site/checks.json`.
- The plan is fully serial, with no parallel streams. `npm test` extraVerify also covers `.github/`, because of the pinned-actions check.
- P1-01: self-test cases match `expect` against the failure message, so rule 1 messages repeat the file name.
- P1-02: `.btn-outline:hover` uses an ink background with page-background text, because the mockup's inline hover colour made the text invisible. The stage and evidence cards share `.stage`, with `.pipe` and `.ev` scoped overrides.
- P1-04: the 404 page reuses existing classes and puts its link in its own paragraph. A failed copy leaves the button label as "Copy".
- P1-05: a missing site file is reported by the rule that needs it. Rule 4 also checks `copy.js` line 2 literally.
- P1-06: rule 9 needs exactly one `@media print` block holding one `:root` rule, and it compares custom properties only. Test strings that would trip constraints are assembled from pieces.
- P1-08: a bad %-escape in the path returns 403. A missing file gets `404.html`, served with its own path's headers.
- P2-03: the hosted-marketplace sentence is an indented paragraph in Quickstart step 1.
- R1-02: an empty `SITE_PORT` counts as unset. A non-integer value, or one above 65535, rejects `start()` with a message that names `SITE_PORT`.
- R1-03: the overflow case adds its width by appending a CSS rule to the temp copy, because the CSP blocks inline styles.
- R2-02: the over-range port is written `String(0xffff + 1)`, because the `no-hardcoded-site-tunables` constraint forbids the literal 65536.
- R3-01: the late console error fires after `Math.floor(SETTLE_MS / 3)`, inside the settle window.
- R4-01: `readyState` is captured before awaiting `document.fonts.ready`, so a load that finishes during the fonts wait cannot hide an early probe.

## Assumptions still in play

None of these values was changed; `docs/site/checks.json` is untouched. All six are still the SPEC defaults, and deciding to change any of them is the human's call.

| Key | Default | Status |
|---|---|---|
| `budget.textBytes` | 65536 | Measured at 49503 (24% headroom). The default holds but was not tuned. |
| `budget.fontBytes` | 184320 | Measured at 165872 (10% headroom). This is the tightest budget. |
| `budget.scriptBytes` | 2048 | Measured at 1009 (51% headroom). |
| `contrastMin` | 4.5 | The lowest measured pair is 5.51 in dark and 4.91 in light, both `--code-muted` on `--code-bg`. |
| `copyFeedbackMs` | 2400 | Still a guess. A machine cannot measure it, so it is a manual check. |
| `servePort` | 8788 | Still a guess, with nothing to measure. |

## Spec issues

Suggested edits to `docs/SPEC.md`:

1. Rule 1 conflicts with the Phase 1 task order. Say that rule 1's "every file present" half applies only once the page exists, which is P1-06 in this plan.
2. Rule 11 says it is "checked by `check-names.mjs`", yet §7 wants a self-test violation for every rule. Say that `check-site.mjs` runs `check-names.mjs` as rule 11.
3. §7's self-test should copy `package.json` and the site scripts too, because rule 14 is about them.
4. §5 puts `COPY_FEEDBACK_MS` "at the top of the file", but §6 says "no globals". Say "line 2, the first statement inside the IIFE".
5. §6 defines no test for `serve-site.mjs`. Add its `--self-test` to the CLI description, which today is only `[--port N]`.
6. §3.3 allows SVG presentation attributes, but the mockup's `var(--token)` colours do not resolve reliably in them. Require classes or `currentColor`.
7. §8 Phase 1 tasks 2 and 4 are each too large for one commit. Split them in the spec.
8. The SPEC and `docs/site/` were uncommitted when the run started. The spec process should say they must be committed on `main` before implement.
9. The `npm test` extraVerify paths should include `.github/`, because of the pinned-actions check on the new `site.yml`.
10. From reviews 1 to 5: §7 requires a self-test only for `check-site.mjs`. The browser check and the server now have self-tests too, and the spec should ask for them.
11. From reviews 1 to 5: rule 12's line-length and rule-count limits cannot fail on their own while `_headers` must equal §6 verbatim. Either drop those limits or relax the verbatim requirement.

## Manual checks owed

- **Phase 1:** run `npm run site:serve` and compare the page with `docs/site/screens/` on desktop and at 360 px, in both color schemes.
  - So far only the 1440 px dark headless screenshot has been compared.
  - Tab through the page: the skip link should come first, and every link and button should show a 2 px focus ring.
  - Check that touch targets are 44 px.
  - Press all four copy buttons and paste each result.
  - Judge whether the "Copied" duration (`copyFeedbackMs` 2400) feels right.
  - Check on a real browser and a phone.
- **Phase 2:** deploy a Cloudflare Pages preview following `docs/site/DEPLOY.md` and run its launch checklist. This includes installing from the preview's `marketplace.json`.
  - Confirm the PR's `site`, `ci` and `lint` checks are green. The new workflow, including its browser self-test step, has not run on GitHub yet.

## Review history

- Round 1: CHANGES REQUESTED. 4 findings, 3 fix tasks (R1-01..R1-03). These were the first findings, so nothing recurred.
- Round 2: CHANGES REQUESTED. 2 findings, 2 fix tasks (R2-01, R2-02). Both were gaps in round-1 fixes: R1-03's profile leak regression and R1-02's `SITE_PORT` edges.
- Round 3: CHANGES REQUESTED. 1 finding, 1 fix task (R3-01). **Recurred:** R1-03 again, plus R2-01, in the browser self-test.
- Round 4: CHANGES REQUESTED. 1 finding, 1 fix task (R4-01), flagged **non-converging**. **Recurred:** R1-03 for the third consecutive round (the load-event wait survived mutation). P2-01 also reappeared, after being cited in round 1.
- Round 5: APPROVED with 0 findings. This is a **notes-only approval**: `REVIEW.md` has a `## Notes` section, listed below under advisory survivors.

Every finding after round 1 was a mutation survivor in a self-test, mostly in `check-site-browser.mjs`. Each round's fix exposed the next uncovered branch.

## Pipeline friction

- controller / halt: "Run halted: kukulu_run_start refuses: working tree is dirty on main. docs/SPEC.md has uncommitted changes (160 insertions, 661 deletions) and docs/site/ is untracked. The plan was derived from this SPEC, so I did not stash or revert it, and I did not commit it because that is the owner's file. Fix: commit (or deliberately discard) docs/SPEC.md, then restart the implement stage."
- From HANDOFF.md (not logged): `kukulu_run_start` refuses any branch name other than `main` or `build/*`. The run therefore created `build/landing` by hand from `feature/landing`.

## Suggested CLAUDE.md additions

- The `site-scripts-node-builtins` constraint scans the checkers' own source. Test strings that contain an import `from "x"` or a CommonJS require call must therefore be assembled from pieces.
- `scripts/check-names.mjs` rejects a literal combining U+0304 anywhere, test source included. Write it as an escape.
- Headless Chrome (`/usr/bin/google-chrome`, Node 24) exposes `navigator.clipboard` on `127.0.0.1`. The copy buttons are therefore revealed, and the browser check passes without special flags.
- `kukulu_run_start` refuses branches other than `main` or `build/*`. Create a `build/*` branch before starting a run.
- The site CSP blocks style attributes, and Chrome reports each one as a console error. Self-test injections must append CSS rules instead of using inline styles.
- `document.fonts.check` does return false when the latin-ext face URL is missing.

## Advisory mutation survivors

Carried from REVIEW.md round 5, `## Notes`:

- The new `readyState` guard is itself unobservable while the load wait is in place: `readyState` is always `complete` once `Page.loadEventFired` has resolved. Mutating the guard alone therefore survives, as expected. Its job is to make deleting the wait fail, and the mutant above shows that it does.
- Carried from round 4: the self-test closes each case's server as soon as `visit` returns. On a runner slow enough that a favicon fetch outlasts `SETTLE_MS`, a case could fail spuriously. Nothing has failed.
- `/tmp/check-site-browser-*` still holds 17 directories, the same as in rounds 3 and 4. No run this round leaked a profile.
- Carried from earlier rounds:
  - The `serve-site.mjs` HEAD-body mutant is equivalent.
  - `copy.js` click behaviour is covered only by the manual check.
  - Trailing-slash paths in `serve-site.mjs` return 200.

## Breaking call

Breaking: no. The changes are additive: a new `site/`, three new scripts, new npm scripts and a new CI workflow, with nothing changed under `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/`. CHANGELOG lists only "Added" entries under Unreleased.
