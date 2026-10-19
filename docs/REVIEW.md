# Review: kukulu.tech landing page (build/landing)
Round: 5

## Verdict

APPROVED

R4-01 did what it was asked to do. `PAGE_PROBE` now reads `document.readyState` before it awaits `document.fonts.ready`. `visit` fails, naming the viewport and scheme, when the state is not `complete`. The change is three lines in `scripts/check-site-browser.mjs`, and the commit follows the template.

I re-ran the round-4 survivor with `kukulu_mutate`, using `node scripts/check-site-browser.mjs --self-test` and `confirmKill`. The mutant deletes ``await withTimeout(loaded, COMMAND_TIMEOUT_MS, `the load event at ${label}`);`` in `visit`. It is now killed by "baseline passes", which fails with `360 dark: the page probe ran before the load event (readyState interactive)`. It is also killed by "a clean page after failing cases passes", which reports `readyState loading`. The confirm re-run on the unmutated tree passed all 12 cases, so the kill is real.

Categories 1 to 3 are clean across the whole branch:

- `kukulu_verify` passed all 19 constraints, with no hits and no fixture failures. Every verify and extraVerify command passed:
  - lint
  - pre-commit
  - check:site (69 cases, rules 1 to 14)
  - the serve-site self-test (29 checks)
  - the browser self-test (12 cases)
  - check:site:browser (6 runs)
- The code diff since the last review (`git diff --name-only 578f790..HEAD`) is `scripts/check-site-browser.mjs` only, plus the pipeline's own `.kukulu/state.json`, `docs/HANDOFF.md` and `docs/PROGRESS.md`.
- The SPEC commit is `b74724d`. Since then, nothing has changed under `docs/site/`, `docs/SPEC.md`, `docs/plans/`, `docs/feedback/`, `mcp/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/`.
- The only `.gitignore` change on the branch is the `.site-shots/` line that SPEC §8 calls for. `.gitattributes` and editor config are untouched.
- No tasks are blocked or skipped. 20 of 20 tasks are done.

## Findings

None.

## Interpretation choices (HANDOFF.md, round 4)

- R4-01 captures `readyState` before awaiting `document.fonts.ready`: correct, and the stricter of the two readings the task allowed. If it were read after the fonts wait, a load that finished during that wait could hide an early probe. The mutant result shows the guard fires at `interactive` and at `loading`.
- Interpretations from earlier rounds were judged in rounds 1 to 4 and are unchanged.

## Blocked and skipped tasks

None.

## Spec issues

1. Carried from round 1: SPEC §7 requires a self-test only for `check-site.mjs`. The browser check and the server now have self-tests too, but SPEC does not ask for them.
2. Carried from round 1: rule 12's line-length and rule-count limits cannot fail on their own while `_headers` must equal SPEC §6 verbatim.

## Manual checks still owed

- Phase 1: run `npm run site:serve` and compare the page with `docs/site/screens/` on desktop and at 360 px, in both color schemes.
  - Tab through the page: the skip link comes first, and every link and button shows a 2 px focus ring.
  - Check that touch targets are 44 px.
  - Press all four copy buttons and paste the result.
  - Judge the "Copied" duration (`copyFeedbackMs` 2400, ⚠️ ASSUMPTION).
  - So far only the 1440 dark headless screenshot has been compared. A real browser, a phone and focus behaviour are still unverified.
- Phase 2: deploy a Cloudflare Pages preview per `docs/site/DEPLOY.md` and run its launch checklist, including installing from the preview's `marketplace.json`.
  - Confirm the PR's `site`, `ci` and `lint` checks are green. The workflow, including the browser self-test step, has not run on GitHub.

## Notes

- The new `readyState` guard is itself unobservable while the load wait is in place: `readyState` is always `complete` once `Page.loadEventFired` has resolved. Mutating the guard alone therefore survives, as expected. Its job is to make deleting the wait fail, and the mutant above shows that it does.
- Carried from round 4: the self-test closes each case's server as soon as `visit` returns. On a runner slow enough that a favicon fetch outlasts `SETTLE_MS`, a case could fail spuriously. Nothing has failed.
- `/tmp/check-site-browser-*` still holds 17 directories, the same as in rounds 3 and 4. No run this round leaked a profile.
- Carried from earlier rounds:
  - The `serve-site.mjs` HEAD-body mutant is equivalent.
  - `copy.js` click behaviour is covered only by the manual check.
  - Trailing-slash paths in `serve-site.mjs` return 200.
