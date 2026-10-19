# Review: kukulu.tech landing page (build/landing)
Round: 2

## Verdict

CHANGES REQUESTED

Round 1's three fix tasks (R1-01 to R1-03) did what they were asked to do. Every round-1 survivor I re-ran with `kukulu_mutate` is now killed:

- check-site.mjs: rule 4's empty-status branch and rule 14's `require` branch.
- serve-site.mjs: the NUL refusal and port-argument precedence.
- check-site-browser.mjs: the overflow, events-loop, font and copy-button assertions, and removal of the profile `rmSync`.

Categories 1 and 2 are clean. `kukulu_verify` passed every constraint with no hits and no fixture failures. Lint, pre-commit, check:site (69 cases), the serve-site self-test (26 checks), the browser self-test (6 cases), check:site:browser (6 runs) and `npm test` (2,210 assertions) are all green. Nothing under `site/`, `docs/site/`, `mcp/`, `skills/`, `agents/`, `hooks/`, `.claude-plugin/` or `.gitignore` changed in this round. The `docs/kukulu.json` and `site.yml` edits are the ones R1-03 called for. Two full runs left the `/tmp/check-site-browser-*` count unchanged at 14, so the leak fix works.

Category 3 is not clean. Mutating `scripts/check-site-browser.mjs` and `scripts/serve-site.mjs`, the two files this round's fixes touched most, still turns up survivors. The worst one brings back the round-1 profile leak while the new "the Chrome profile is removed" check still passes. Under the round-2 rule in the review-build skill, only files in `git diff --name-only a9f9960..HEAD` are mutated, and a survivor in one of those files becomes a fix task. Both tasks below are queued on mutation results alone, under that rule.

## Findings

### 1. Category 3: `scripts/check-site-browser.mjs`: the leak regression, two of rule 15's failure sources and the no-buttons guard survive mutation (R1-03)

- `:225`: deleting `if (child.exitCode === null && child.signalCode === null) await exited;` survived `node scripts/check-site-browser.mjs --self-test`. With that line gone, the profile is removed while Chrome is still running. Chrome then recreates it: the mutant run left `/tmp/check-site-browser-gHZzu1` holding `Local State`, `Variations` and `Default/`. This is exactly the round-1 finding 2 bug. The self-test's check at `:334` runs `fs.existsSync(profile)` the moment `withBrowser` returns, before Chrome has had time to write the directory back, so it cannot catch this.
- `:169`: replacing the `Runtime.consoleAPICalled` branch condition with `false` survived. SPEC §6 says "any `Runtime.consoleAPICalled` of type `error` ... fail[s] the check".
- `:171`: replacing the `Runtime.exceptionThrown` branch condition with `false` survived. SPEC §6 says "any `Runtime.exceptionThrown`" fails the check, and §3 rule 15 says "no uncaught exception". The only event case is the CSP violation, which arrives through `Log.entryAdded`.
- `:195`: replacing the `r.buttons.length === 0` guard with `false` survived. Without it, a page with no `[data-copy-for]` button passes rule 15's button assertion without testing anything.

What breaks: a later edit can quietly drop console-error or exception reporting from rule 15, or bring the profile leak back, and CI stays green.

Minimal fix: add self-test cases that append `console.error("self-test");` to the copy's `copy.js` (expect `console.error:`) and that append a top-level `throw new Error("self-test")` after the IIFE (expect `uncaught exception:`), and a case that renames every `data-copy-for` attribute (expect `no [data-copy-for] buttons`). Make the profile check prove that Chrome has exited, not just that the directory is gone at one instant. `withBrowser` should hand the session the child's pid. After it returns, the self-test asserts that `process.kill(pid, 0)` throws `ESRCH`, waits briefly, and only then asserts that the profile is absent. The task is R2-01.

### 2. Category 3: `scripts/serve-site.mjs`: SITE_PORT edge cases and the siteDir 404 page are untested (R1-02, R1-03)

- `:76`: dropping `|| n > 65535` survived. A `SITE_PORT=70000` would then reach `server.listen` and fail with Node's generic error, which R1-02's design constraint forbids.
- `:74`: dropping `|| env === ""` survived. With that mutant, an empty `SITE_PORT` is refused instead of falling through to `servePort`, which is the opposite of R1-02's recorded interpretation.
- `:125`: reading `404.html` from `SITE_DIR` instead of `root` survived both the serve-site self-test and the browser self-test. A `start({ siteDir })` server would then serve the repo's 404 page, not the one in the given directory. R1-03 says `siteDir` is used for the site's files.

What breaks: the R1-02 validation contract and the `siteDir` behaviour can regress without any test noticing.

Minimal fix: the self-test calls the module's own `choosePort` directly, so it never binds `servePort`, and checks two cases. With `SITE_PORT="65536"` it must throw with a message naming `SITE_PORT`. With `SITE_PORT=""` it must return `loadConfig(CONFIG_PATH).servePort`. In both cases the environment is restored in a `finally`. The existing siteDir check also requests a missing path and asserts status 404 with the body `alt 404\n`. The task is R2-02.

## Interpretation choices (HANDOFF.md, round 1)

- R1-02, "an empty SITE_PORT counts as unset": this is consistent with SPEC §5 ("`SITE_PORT` overrides it") and with the pre-fix truthiness test. It is untested; see finding 2.
- R1-03, the overflow width comes from a rule appended to the copied `styles.css`: correct. The page's CSP (`style-src 'self'`) blocks inline styles, and the copy is a temp directory, not `site/`.
- R1-03, one Chrome for every case: acceptable. Each case gets its own server and site copy, and `events` is reset on every visit.
- The round-0 interpretations were judged in round 1 and are unchanged.

## Blocked and skipped tasks

None.

## Spec issues

1. Carried from round 1: SPEC §7 requires a self-test only for `check-site.mjs`. The browser check now has one (R1-03), but SPEC still does not ask for it.
2. Carried from round 1: rule 12's line-length and rule-count limits cannot fail on their own while `_headers` must equal SPEC §6 verbatim.

## Manual checks still owed

- Phase 1: run `npm run site:serve` and compare with `docs/site/screens/` on desktop and at 360 px, in both color schemes. Tab through the page: the skip link comes first, and every link and button shows a 2 px focus ring. Check that touch targets are 44 px. Press all four copy buttons and paste the result. Judge the "Copied" duration (`copyFeedbackMs` 2400, ⚠️ ASSUMPTION). The round-1 reviewer compared headless screenshots, but a real browser, a phone and focus behaviour are still unverified.
- Phase 2: deploy a Cloudflare Pages preview per `docs/site/DEPLOY.md` and run its launch checklist, including installing from the preview's `marketplace.json`. Confirm the PR's `site`, `ci` and `lint` checks are green. The new workflow, now including the browser self-test step, has not run on GitHub.

## Notes

- `scripts/check-site-browser.mjs:200`: the `prefers-color-scheme emulation did not take effect` guard survives `if (false)`. No site injection can make Chrome ignore `Emulation.setEmulatedMedia`, so a self-test cannot kill this mutant. It is advisory, not a task.
- `scripts/serve-site.mjs` self-test, "the port argument beats SITE_PORT": the test asserts that the ephemeral port differs from the `SITE_PORT` value it just freed. If the kernel ever hands back the same port, the check fails spuriously. The chance is small, so this is not a task.
- Two of this review's mutants deliberately left Chrome profiles in `/tmp`: `check-site-browser-0CCk2o` (the `rmSync` deletion) and `check-site-browser-gHZzu1` (the `await exited` deletion). The real code does not leave them.
- Carried from round 1: `copy.js` click behaviour is covered only by the manual check; trailing-slash paths in `serve-site.mjs` serve 200; console events are collected only until 150 ms after the probe.
