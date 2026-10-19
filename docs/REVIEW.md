# Review: kukulu.tech landing page (build/landing)
Round: 4

## Verdict

CHANGES REQUESTED

R3-01 did what it was asked to do. I re-ran the three mutants it listed with `kukulu_mutate`, using `node scripts/check-site-browser.mjs --self-test` and `confirmKill`. All three are now killed, each by the check the task named:

- Replacing `if (b.hidden || b.w === 0 || b.h === 0)` with `if (b.hidden)`: killed by "zero-size copy buttons are caught".
- Deleting `events = [];` in `visit`: killed by "a clean page after failing cases passes". The failure tail shows the CSP, console.error, late and exception events from earlier cases leaking into the clean visit.
- Deleting the `SETTLE_MS` wait: killed by "a console error after load is caught" (and by the clean-page check).

Categories 1 and 2 are clean:

- `kukulu_verify` passed all 19 constraints, with no hits and no fixture failures.
- Lint, pre-commit, check:site (69 cases), the serve-site self-test (29 checks), the browser self-test (12 cases) and check:site:browser (6 runs) all pass.
- This round's code diff (`git diff b64c22f..HEAD`) is `scripts/check-site-browser.mjs` only, plus the pipeline's own state and docs. The R3-01 commit follows the commit template.
- Since the spec commit (`1525201..HEAD`), nothing has changed under `docs/site/`, `docs/SPEC.md`, `docs/plans/`, `docs/feedback/`, `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/`, and `.gitattributes` is untouched.

Category 3 is not clean. I swept further mechanics in `scripts/check-site-browser.mjs`, the one code file in this round's diff, and one survives: the wait for the `load` event. SPEC §6 requires that wait word for word. The task below is queued on mutation results alone, under the review-build skill's round-2-and-later rule: a survivor in a file in `git diff --name-only <lastReviewCommit>..HEAD` becomes a fix task.

## Findings

### 1. Category 3: `scripts/check-site-browser.mjs:187`: the wait for the load event survives mutation (R1-03, P2-01)

- The mutation: deleting ``await withTimeout(loaded, COMMAND_TIMEOUT_MS, `the load event at ${label}`);`` in `visit`.
- The result: it survived `node scripts/check-site-browser.mjs --self-test`, with all 12 cases passing.
- Why it survives: I ran a probe mutant that throws unless `document.readyState === "complete"`, together with deleting the wait. It was killed, and every visit reported `probe ran before load: interactive`. So without the wait, the probe runs after the deferred `copy.js` has run but before `load`. On this page that is already enough for every rule-15 assertion to pass, and the `SETTLE_MS` wait picks up late events. No case distinguishes "after load" from "after DOMContentLoaded".
- What breaks: SPEC §6 says the check "waits for the `load` event and then `document.fonts.ready`". The wait can be deleted without CI noticing. Once it is gone, overflow, button size and font state are measured before images and other subresources have loaded. A layout that only overflows once an image arrives would pass rule 15.
- The minimal fix:
  1. Make `PAGE_PROBE` also return `document.readyState`, read before `await document.fonts.ready` or after it (either works, since `load` has already fired).
  2. In `visit`, push a failure naming the viewport and scheme when it is not `"complete"`, in the existing message style. For example: `${label}: the page probe ran before the load event (readyState <state>); wait for Page.loadEventFired before probing`.
  3. With the wait in place, `readyState` is always `"complete"` when the probe runs, so the normal run and the baseline stay green. Without the wait, the "baseline passes" case fails, as the experiment above shows.
- The task is R4-01.

## Interpretation choices (HANDOFF.md, round 3)

- R3-01, the late-error delay is `Math.floor(SETTLE_MS / 3)`: correct. It is derived from `SETTLE_MS` as the task required, it falls inside the settle window, and the mutant proves the wait is what catches it.
- Earlier rounds' interpretations were judged in rounds 1 to 3 and are unchanged.

## Blocked and skipped tasks

None. 19 of 19 tasks are done.

## Spec issues

1. Carried from round 1: SPEC §7 requires a self-test only for `check-site.mjs`. The browser check and the server now have self-tests as well, but SPEC does not ask for them.
2. Carried from round 1: rule 12's line-length and rule-count limits cannot fail on their own while `_headers` must equal SPEC §6 verbatim.

## Manual checks still owed

- Phase 1: run `npm run site:serve` and compare with `docs/site/screens/` on desktop and at 360 px, in both color schemes. Tab through the page: the skip link comes first, and every link and button shows a 2 px focus ring. Check that touch targets are 44 px. Press all four copy buttons and paste the result. Judge the "Copied" duration (`copyFeedbackMs` 2400, ⚠️ ASSUMPTION). Only the 1440 dark headless screenshot has been compared; a real browser, a phone and focus behaviour are still unverified.
- Phase 2: deploy a Cloudflare Pages preview per `docs/site/DEPLOY.md` and run its launch checklist, including installing from the preview's `marketplace.json`. Confirm the PR's `site`, `ci` and `lint` checks are green. The workflow, including the browser self-test step, has not run on GitHub.

## Notes

- Another mutant was killed this round: emulating `dark` for every scheme. `npm run check:site:browser` caught it through the `prefers-color-scheme emulation did not take effect` guard on every light run. Earlier rounds noted that the self-test alone cannot kill that guard; the normal run does.
- With the `SETTLE_MS` wait deleted, the self-test also reported `ERR_CONNECTION_REFUSED` for `/favicon.svg` and `/favicon.ico`. The browser requests the favicons after `load`, and the self-test closes each case's server as soon as `visit` returns. With the wait in place they arrive in time. If a slow CI runner ever takes longer than 150 ms to fetch a favicon, though, a self-test case could fail spuriously. This is advisory: the fix would be to keep each server open until the next visit begins, and nothing has failed.
- `loadWaiters` is filled before `Page.navigate`, so a fast load cannot be missed. That ordering is correct.
- `/tmp/check-site-browser-*` still holds 17 directories, the same as in round 3. No mutant this round leaked a profile.
- Carried from earlier rounds: the `serve-site.mjs` HEAD-body mutant is equivalent, `copy.js` click behaviour is covered only by the manual check, and trailing-slash paths in `serve-site.mjs` return 200.
