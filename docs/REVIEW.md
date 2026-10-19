# Review: kukulu.tech landing page (build/landing)
Round: 3

## Verdict

CHANGES REQUESTED

Round 2's two fix tasks (R2-01, R2-02) did what they were asked to do. I re-ran every mutant those tasks listed with `kukulu_mutate`, and all seven are now killed, each by the check the task named:

- check-site-browser.mjs: the `Runtime.consoleAPICalled` branch, the `Runtime.exceptionThrown` branch, the `r.buttons.length === 0` guard, and deleting `await exited`. That last one now fails with "Chrome process ... is still running".
- serve-site.mjs: the `n > 65535` bound, the `env === ""` fallthrough, and `404.html` read from `SITE_DIR`.

Categories 1 and 2 are clean. `kukulu_verify` passed every constraint, with no hits and no fixture failures. Lint, pre-commit, check:site (69 cases), the serve-site self-test (29 checks), the browser self-test (9 cases) and check:site:browser (6 runs) are all green. This round changed only `scripts/check-site-browser.mjs` and `scripts/serve-site.mjs`, plus the pipeline's own docs and state. Across the whole run, nothing under `docs/site/`, `docs/SPEC.md`, `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/` changed. The only `.gitignore` edit is `.site-shots/`, which P2-01 asked for.

Category 3 is not clean. Under the round-2-and-later rule in the review-build skill, I mutated only the files in `git diff --name-only 6762dbb..HEAD`. In `scripts/check-site-browser.mjs`, three neighbouring mechanics survive. One of them is a check that SPEC §3 rule 15 requires word for word. The task below is queued on mutation results alone, under that rule.

## Findings

### 1. Category 3: `scripts/check-site-browser.mjs`: the zero-size copy button check, the per-visit event reset and the settle wait survive mutation (R1-03, R2-01)

- `:197`: replacing `if (b.hidden || b.w === 0 || b.h === 0) failures.push(` with `if (b.hidden) failures.push(` survived `node scripts/check-site-browser.mjs --self-test`. SPEC §3 rule 15 requires that "every `[data-copy-for]` button has `hidden === false` and a non-zero bounding box". The only button case removes `hidden` support, so the bounding-box half is never exercised. A stylesheet rule that collapses the buttons, such as `display:none` on `[data-copy-for]`, would pass rule 15 unnoticed.
- `:182`: deleting `events = [];` at the start of `visit` survived. The baseline runs first, and every later case only checks that its own expected text is present, so nothing notices events leaking from one visit into the next. Without the reset, one console error at 360 dark is reported again under every later viewport and scheme. SPEC §6 says failures are reported "naming the viewport and scheme", and with the leak those names are wrong.
- `:189`: deleting `await new Promise((r) => setTimeout(r, SETTLE_MS));` survived. Every injected error fires during script execution, before the load event, so no case needs the settle wait. An error that fires shortly after `load` would be missed.

What breaks: rule 15's bounding-box assertion can be removed without CI noticing, and so can the event attribution and the post-load window.

Minimal fix: add three things to the self-test, all in the existing `{ name, expect, inject }` shape where possible, and all injecting into the temp copy only:

1. A case that appends `[data-copy-for]{display:none !important}` to the copy's `styles.css` and expects `is not shown`. The buttons keep `hidden === false` but have a 0x0 box.
2. A case that appends to the copy's `copy.js` a `load` listener that calls `console.error("late")` after a delay shorter than `SETTLE_MS`, and expects `console.error: late`. Derive the delay from `SETTLE_MS` (for example `Math.floor(SETTLE_MS / 3)`) rather than writing a bare literal.
3. After the `CASES` loop, probe a fresh, clean copy again and assert it has zero failures, as "a clean page after failing cases passes".

The task is R3-01.

## Interpretation choices (HANDOFF.md, round 2)

- R2-02, the over-range value is written `String(0xffff + 1)`: correct. The `no-hardcoded-site-tunables` constraint forbids the literal 65536, and the expression is commented.
- R2-01, `PROFILE_SETTLE_MS = 1000`: acceptable. It is a named constant, and the check now also proves the process has exited.
- Earlier rounds' interpretations were judged in rounds 1 and 2 and are unchanged.

## Blocked and skipped tasks

None.

## Spec issues

1. Carried from round 1: SPEC §7 requires a self-test only for `check-site.mjs`. The browser check and the server now have self-tests as well, but SPEC does not ask for them.
2. Carried from round 1: rule 12's line-length and rule-count limits cannot fail on their own while `_headers` must equal SPEC §6 verbatim.

## Manual checks still owed

- Phase 1: run `npm run site:serve` and compare with `docs/site/screens/` on desktop and at 360 px, in both color schemes. Tab through the page: the skip link comes first, and every link and button shows a 2 px focus ring. Check that touch targets are 44 px. Press all four copy buttons and paste the result. Judge the "Copied" duration (`copyFeedbackMs` 2400, ⚠️ ASSUMPTION). Only the 1440 dark headless screenshot has been compared; a real browser, a phone and focus behaviour are still unverified.
- Phase 2: deploy a Cloudflare Pages preview per `docs/site/DEPLOY.md` and run its launch checklist, including installing from the preview's `marketplace.json`. Confirm the PR's `site`, `ci` and `lint` checks are green. The workflow, now including the browser self-test step, has not run on GitHub.

## Notes

- `scripts/serve-site.mjs:96`: replacing `res.end(req.method === "HEAD" ? undefined : body)` with `res.end(body)` survives. The mutant is equivalent: Node's `http` server drops the body of a HEAD response itself, and the existing "HEAD / is 200 with no body" check passes either way. This is advisory, not a task.
- Other serve-site.mjs mutants in this round were killed: the `_headers` refusal and the path-traversal guard.
- Carried from round 2: the `prefers-color-scheme emulation did not take effect` guard (`check-site-browser.mjs:200`) cannot be killed by any site injection.
- Mutants from this and earlier reviews leave Chrome profiles in `/tmp`; the `await exited` deletion is the latest. `/tmp/check-site-browser-*` now holds 17 directories. The unmutated code leaves none behind.
- Carried from round 1: `copy.js` click behaviour is covered only by the manual check, and trailing-slash paths in `serve-site.mjs` return 200.
