# Rename Foundry → Kūkulu (v0.6.0)

## Context

The repository moved from `ericmann/foundry` to `DisplaceTech/kukulu` (the
`origin` remote already points there), and copyright was assigned to
Displace Technologies LLC effective 2026-10-15. This change renames the
product throughout, keeps existing users' projects and recorded flight
evidence working, updates NOTICE and README, and prepares v0.6.0 on the branch
`rename/kukulu` as small, individually green commits for Eric to review and
merge with a merge commit.

The first Phase 2 commit copies this plan verbatim to
`docs/plans/rename-kukulu.md`. It is a new file, so the "nothing under
docs/plans/ changes" rule still holds for the existing files there.

Eric's answers (2026-10-15):

- **Evidence.** This repo has no provenance log, attestation bundle or
  offline verifier. The requirement maps onto what the repo does record:
  archived flights (`docs/flights/<slug>/`), `.foundry/state.json`,
  `.foundry/feedback.jsonl`, and signed git commits.
- **Marketplace.** The name is `displacetech` and the owner is Displace
  Technologies LLC. `plugin.json`'s `author` stays Eric Mann.
- **Shims.** Removed in 0.7.0. The 0.6.0 release notes say so.
- **Dictionary.** Use only the senses Eric supplied from the Pukui–Elbert
  entry (D9586). The stress could not be verified, so the pronunciation note
  says only that the first ū is long.

## 1. Inventory

Counts are `git grep -o` matches. "Live" is everything except the history
set; "history" is `docs/flights/`, `docs/plans/` (existing files),
`docs/feedback/`, `docs/SPEC.md` and the past entries in `CHANGELOG.md`. Case
variants total 3,410: 2,270 live and 1,140 history.

| # | Category | Old | New | Live / hist | Decision |
|---|---|---|---|---|---|
| 1 | Plugin id | `foundry` (plugin.json `name`, marketplace entry) | `kukulu` | 2 / 0 | rename |
| 2 | Display name | plugin.json `displayName` `Foundry`; prose `Foundry` | `Kūkulu` | 94 / 91 | rename live; history stays |
| 3 | Marketplace | `ericmann`, owner Eric Mann | `displacetech`, owner Displace Technologies LLC | 1 / 0 | rename |
| 4 | Slash commands | `/foundry:<skill>` | `/kukulu:<skill>` | 58 / 24 | rename (no shim possible: the plugin id is the namespace) |
| 5 | MCP server name | `.mcp.json` key `foundry`, `serverInfo.name` | `kukulu` | 2 / 0 | rename |
| 6 | MCP tool names | `foundry_*` (21 tools) | `kukulu_*` | 1,302 / 717 | rename (old full names are unreachable once 1 and 5 change, so no aliases) |
| 7 | MCP allow rule | `mcp__plugin_foundry_foundry` (`MCP_ALLOW_RULE`, agents `tools:`, go-flight `allowed-tools`, docs) | `mcp__plugin_kukulu_kukulu` | 47 / 15 | rename; `kukulu_migrate` and `agents_sync` add the new rule |
| 8 | Agent names | `foundry:<role>` (plugin agents), `foundry-<role>` (generated `.claude/agents/foundry-<role>.md`) | `kukulu:<role>`, `kukulu-<role>` | 68 / 10 | rename; the guard and hooks matcher also accept `foundry-implementer` until 0.7.0 |
| 9 | Skill refs | `foundry:plan-build` etc. in agents' `skills:` | `kukulu:…` | (in 4) | rename |
| 10 | State dir | `.foundry/` (state.json, feedback.jsonl, implement.lock, mutation.json, worktrees/) | `.kukulu/` | 201 / 93 | rename; read the old location as a fallback until 0.7.0 |
| 11 | Project config | `docs/foundry.json` | `docs/kukulu.json` | 198 / 114 | rename; fallback until 0.7.0 |
| 12 | Archived config | `docs/flights/<slug>/foundry.json` | new archives write `kukulu.json` | (in 11) | finalize and status read either, permanently (history) |
| 13 | Env vars | `FOUNDRY_PROJECT_DIR`, `FOUNDRY_CONFIG`, `FOUNDRY_PROFILE`, `FOUNDRY_GUARD_CAP` | `KUKULU_*` | 85 / 9 | rename; `FOUNDRY_*` honored with a warning until 0.7.0 |
| 14 | Test-only env | `FOUNDRY_TEST_TIMEOUT_MS` | `KUKULU_TEST_TIMEOUT_MS` | 1 / 0 | rename, no shim |
| 15 | Global config | `$XDG_CONFIG_HOME/foundry/config.json`, `~/.config/foundry/config.json` | `…/kukulu/config.json` | 9 / 1 | rename; old path read when the new one is absent, until 0.7.0 |
| 16 | Sentinels and prefixes | `FOUNDRY: RESTART REQUIRED`; guard `foundry:` message prefix; `foundry signing probe`; `foundry could not supervise` | `KUKULU: RESTART REQUIRED`; `kukulu:`; `kukulu signing probe`; `Kūkulu could not supervise` | 9 / 4 | rename |
| 17 | Git ignore lines | `.foundry/implement.lock`, `.foundry/worktrees/`, `.claude/agents/foundry-*.md` (`.gitignore`, `.git/info/exclude`) | `.kukulu/…`, `kukulu-*.md` | — | rename; `kukulu_migrate` rewrites them in user projects |
| 18 | Package | `package.json` `foundry-claude-plugin` | `kukulu-claude-plugin` | 1 / 0 | rename |
| 19 | Repo URLs | `ericmann/foundry`, raw.githubusercontent URL, `marketplace add ericmann/foundry` | `DisplaceTech/kukulu`, `https://github.com/DisplaceTech/kukulu` | 3 / 0 | rename |
| 20 | Tooling ids | pre-commit hook id `foundry-lint`, `.gitleaks.toml` title, test temp prefixes `foundry-test-` etc., `test@foundry.invalid`, the fake signer's name | `kukulu-…`, `test@kukulu.invalid` | ~15 / 0 | rename (the fake key id `0123456789ABCDEF` is unchanged, so the gitleaks allowlist still matches) |
| 21 | This repo's live state | `.foundry/state.json` (tracked) | `.kukulu/state.json` | 1 file | move with `kukulu_migrate` (dogfood); bytes unchanged |
| 22 | CLAUDE.md, CONTRIBUTING, docs/*.md (non-history), skills, agents, templates, README | mixed | per rows 2–19 | — | rename |
| 23 | History | `docs/flights/v0-5-0/**`, `docs/plans/v0.3*.md`, `docs/plans/v0.4.md`, `docs/feedback/**`, `docs/SPEC.md` (the 0.5.0 spec; CLAUDE.md forbids editing it), CHANGELOG entries 0.1.0–0.5.0, git tags, commit messages | — | 1,140 | leave as history |

No older aliases turned up beyond `foundry-implementer` and
`foundry:implementer`, which are already both accepted. The hook matcher and
the guard's `RUN_START_TOOL` regex have to change for row 6. That is
deliberate: CLAUDE.md's "guard regexes unchanged" rule was scoped to the 0.5.0
flight. `TASK_ID` and `TASK_LINE` do not change.

No record format embeds the name. Neither `feedback.jsonl` entries
(`at/stage/round/category/message`), `state.json` nor `implement.lock` has a
field containing `foundry`. The only name-bearing evidence is therefore file
and directory names: rows 10, 11 and 12.

## 2. Name rules, per category

- **Display `Kūkulu`.** The `ū` is U+016B, NFC. It appears in README, docs,
  skills and agents prose, `plugin.json` `displayName`, NOTICE, the CHANGELOG
  0.6.0 entry, server comments, and human- or model-facing message strings
  ("Run the Kūkulu plan stage", "something Kūkulu's own tooling cost time
  on"). It never appears in an identifier.
- **Identifier `kukulu` / `KUKULU_`.** This covers rows 1 and 4–20: ids,
  namespaces, tool names, paths, keys, env vars, URLs, sentinels and log
  prefixes. Uppercase ASCII sentinels (`KUKULU: RESTART REQUIRED`) count as
  identifiers.
- **ʻokina.** Write ʻōlelo Hawaiʻi with U+02BB.
- **Repo.** `DisplaceTech/kukulu`, `https://github.com/DisplaceTech/kukulu`.

### Name check (commit 1)

`scripts/check-names.mjs` uses no dependencies. It runs from
`scripts/lint.sh`, so `npm run lint`, pre-commit and CI all run it, and it is
documented in CONTRIBUTING.md. It takes an optional root argument, which is
how the tests feed it fixtures. It fails when:

1. **Bad ū.** A `ū` is not inside the standalone word `Kūkulu`, meaning one
   touching `[A-Za-z0-9_./:@-]` on either side, so never part of a path, id,
   key, URL or env var.
2. **NFD form.** The file contains decomposed `u` + U+0304.
3. **Non-ASCII path.** A tracked file path contains non-ASCII characters.
4. **ASCII spelling in prose.** In a live `*.md` file, after stripping fenced
   blocks, inline code and URLs, the ASCII word spelled K-u-k-u-l-u
   (case-sensitive, capital K) appears.
5. **Apostrophe ʻokina.** A live `*.md` file contains `Hawai'i`, `Hawai’i`,
   `'ōlelo` or `‘ōlelo`.

History paths (row 23) are skipped for rules 4 and 5. `test/plugin.mjs` gets
one assertion per rule: write a bad fixture into a temp dir, run the script,
assert exit 1 and the message. One more assertion runs it clean on the repo.

## 3. Compatibility and migration

### Existing projects (shims removed in 0.7.0)

- **Layout resolver** in `mcp/server.mjs`. Today `P` is a const built from
  `ROOT`. It becomes a `let P`, rebuilt at the start of every tool dispatch
  by `resolveLayout()`:
  - The new layout (`.kukulu/` or `docs/kukulu.json` present) wins.
  - Otherwise the legacy layout (`.foundry/` or `docs/foundry.json` present)
    makes the server read and write in place.
  - Otherwise the new layout is used.
  - Both present is a refusal: "both .foundry/ and .kukulu/ exist; run
    kukulu_migrate, or remove the one you do not use."

  Messages that hardcode `docs/foundry.json` become `${rel(P.config)}`, so
  they name the file actually in use.
- **Deprecation line.** In the legacy layout, `kukulu_status` and
  `kukulu_next` return
  `deprecations: ["Kūkulu: this project uses the Foundry layout (.foundry/, docs/foundry.json); run kukulu_migrate. Support ends in 0.7.0."]`.
  The go-flight skill prints each line once. Env and global-config fallbacks
  add their own line the same way.
- **Env vars.** A non-empty `KUKULU_X` wins. Otherwise a non-empty
  `FOUNDRY_X` is used, with a deprecation line. `.mcp.json` passes both
  spellings through (`"FOUNDRY_CONFIG": "${FOUNDRY_CONFIG:-}"`). The guard
  reads `KUKULU_GUARD_CAP`, then `FOUNDRY_GUARD_CAP`.
- **Global config.** Use `…/kukulu/config.json`; if it is absent and
  `…/foundry/config.json` exists, read that and add a deprecation line.
- **Guard and hooks.** The guard checks the lock and worktrees under both
  `.kukulu/` and `.foundry/`, and accepts the implementer agent types
  `kukulu-implementer`, `kukulu:implementer` and `foundry-implementer`.
  `RUN_START_TOOL` becomes `/^(?:mcp__.+__)?(?:kukulu|foundry)_run_start$/`,
  so a transcript from an old session still parses. `hooks.json`'s matcher
  gets the same set.
- **New tool `kukulu_migrate`.** It is inserted after
  `kukulu_flight_archive`, goes on the summarizer's `tools:` line, and is
  also allowed in go-flight. It validates first:
  - the legacy layout is present and the new one absent;
  - no lock is armed;
  - no `mutation.json` and no stream worktrees exist;
  - the tree is clean.

  Then it runs `git mv` on the tracked `.foundry/state.json`,
  `.foundry/feedback.jsonl` and `docs/foundry.json`, and moves any untracked
  remainder. It rewrites the `.foundry/` lines in `.gitignore` and the
  `.claude/agents/foundry-*.md` line in `.git/info/exclude`. It deletes
  generated `.claude/agents/foundry-<role>.md` files whose content matches
  what `agents_sync` would have generated (anything else is left and
  reported), and adds `mcp__plugin_kukulu_kukulu` to `settings.local.json`.
  Finally it commits `chore: migrate .foundry layout to .kukulu`. On a
  failed commit it restores every path. Archived flights under
  `docs/flights/` are never touched. It returns
  `{ moved, gitignore, exclude, removedAgents, permissions, commit }`.
- **Plugin reinstall (manual, documented).** Run
  `claude plugin marketplace add DisplaceTech/kukulu`, then
  `claude plugin install kukulu@displacetech`, then
  `claude plugin uninstall foundry@ericmann`. Slash commands become
  `/kukulu:*`. A plugin id cannot be aliased.
- **0.7.0 removal.** Remove the resolver's legacy branch, the `FOUNDRY_*`
  and `foundry/config.json` fallbacks, `foundry-implementer` in the guard and
  hooks, and the `foundry` alternative in `RUN_START_TOOL`.
  `kukulu_migrate` stays.

### Existing evidence (permanent, not a shim)

- Archived flights keep `foundry.json`. `finalizeConfig` reads
  `<archived.dir>/kukulu.json`, then `foundry.json`. `kukulu_status`'s
  archived-flight reporting does the same. New archives write `kukulu.json`.
- The `pull-feedback` skill reads `<path>/.kukulu/feedback.jsonl`, then
  `<path>/.foundry/feedback.jsonl`.
- Signed commits, tags and commit subjects are untouched, because no history
  is rewritten.
- **The proof test** is a new block in `test/state.mjs` (status and finalize
  config) plus `test/feedback.mjs`. It copies `docs/flights/v0-5-0/` into a
  temp repo without changing it, and writes the matching legacy
  `.foundry/state.json` (`archived.dir` = that dir). It first asserts each
  source file's SHA-256 against hashes hardcoded in the test (computed from
  the v0.5.0 tag), so any edit to the historical data fails the suite. It
  then asserts that `kukulu_status` reports the archived flight and that the
  finalize path loads its `foundry.json`. A second test runs a full legacy
  project (`.foundry/` + `docs/foundry.json`) through `kukulu_status`, a
  task cycle and `kukulu_migrate`, asserting the deprecation line, the
  migrated tree and the byte-identical moved files.

## 4. Commit sequence

Branch `rename/kukulu` from `main`. Each commit passes `npm run lint`,
`pre-commit run --all-files` and `npm test`, and uses the CLAUDE.md template
with `ID` = `RN-NN`. A commit that changes a tool updates `docs/mcp-tools.md`
in the same commit.

1. **RN-00** `docs: add the Kūkulu rename plan`: this file as
   `docs/plans/rename-kukulu.md`.
2. **RN-01** `lint: add the name check`: `scripts/check-names.mjs`,
   `lint.sh`, test/plugin.mjs assertions, CONTRIBUTING section.
3. **RN-02** `Rename the plugin id, marketplace and MCP server to kukulu`:
   rows 1, 3, 5, 7 and 9, plus agents' `skills:` and `tools:` prefixes,
   go-flight `allowed-tools`, `MCP_ALLOW_RULE`, `/kukulu:*` in skills and
   docs, and the tests that assert them.
4. **RN-03** `Rename the MCP tools from foundry_* to kukulu_*`: row 6 across
   the server, guard (accepting both), skills, agents, tests (12 files),
   docs, README tool table, and `EXPECTED_TOOLS`.
5. **RN-04** `Rename generated agents to kukulu-<role>`: row 8, the hooks
   matcher, the guard agent types, the exclude line, and `RESTART REQUIRED`
   sentinels (row 16).
6. **RN-05** `Read KUKULU_* env vars and ~/.config/kukulu, falling back to
   the Foundry names`: rows 13–15, `.mcp.json`, harness isolation vars,
   deprecation lines, tests for precedence and the warning,
   `docs/operations.md` and `docs/routing.md`.
7. **RN-06** `Move project state to .kukulu/ and docs/kukulu.json with a
   legacy fallback`: rows 10–12 and 17, the resolver, the mixed-layout
   refusal, the `deprecations` field, guard paths, archive/finalize
   either-name reading, the v0-5-0 fixture hash test and the legacy-project
   test, the go-flight print, the pull-feedback fallback, and docs.
8. **RN-07** `Add kukulu_migrate`: the tool, the tool-count protocol per
   CLAUDE.md, the summarizer `tools:` line, refusal tests (one per refusal,
   message asserted), the commit-failure rollback test (commit-msg hook),
   and the docs section.
9. **RN-08** `Migrate this repository's own state to .kukulu/`: run
   `kukulu_migrate` against the repo through a one-off harness call, or by
   hand with `git mv` if the tool refuses. `.gitignore` gets the
   `.kukulu/implement.lock` line.
10. **RN-09** `Rename package, tooling ids and repository URLs`: rows 18–20.
11. **RN-10** `Write Kūkulu as the display name in docs, skills and
    messages`: row 2 and remaining prose in README, docs (non-history),
    skills, agents, templates, CLAUDE.md, CONTRIBUTING, server comments and
    messages.
12. **RN-11** `Assign copyright to Displace Technologies LLC`: rewrite NOTICE
    to the given text with `Copyright 2026`. LICENSE is untouched: its
    appendix template line is part of the license text, and the repo has no
    SPDX headers or per-file copyright lines to update. Set
    `marketplace.json` `owner`. No patent marking.
13. **RN-12** `README: add "The name"; drop the MIT footer`: add the section
    after the intro (contents below) and remove the line "Releases 0.3.x and
    earlier remain available under the MIT License."
14. **RN-13** `Bump the version to 0.6.0`: `plugin.json`, `package.json`, the
    server's `VERSION`, and the CHANGELOG `## [0.6.0] — 2026-10-15` entry.
    `test/plugin.mjs` requires the newest CHANGELOG heading to equal the
    version, so the entry lands here, with the Phase 3 release-notes
    sections. If the merge date differs, Eric adjusts the date before
    merging.

Then push `rename/kukulu` (no force) and open the PR with
`gh pr create --draft`, using the title given. The body covers:

- a summary and the name rules;
- the compatibility, migration and removal decisions;
- a per-category checklist with the counts from section 1;
- the README section, with the placeholder flagged for Eric;
- the evidence statement, naming the v0-5-0 hash test and the legacy-project
  test;
- confirmation that `docs/flights/`, `docs/feedback/`, existing
  `docs/plans/`, `docs/SPEC.md` and past CHANGELOG entries are unchanged
  (`git diff --stat main -- <paths>` empty).

Then stop. Visibility is untouched.

## README "The name" (draft content for RN-12)

> ## The name
>
> *Kūkulu* is a word in ʻōlelo Hawaiʻi, the Hawaiian language. As a verb it
> means to build, construct or establish; as a noun, a pillar or post, and
> also a side, border, hedge or horizon (Pukui and Elbert, *Hawaiian
> Dictionary*, [wehewehe.org entry](https://www.wehewehe.org/gsdl2.85/cgi-bin/hdict?e=q-11000-00---off-0hdict--00-1----0-10-0---0---0direct-10-ED--4--textpukuielbert%2ctextmamaka-----0-1l--11-en-Zz-1---Zz-1-home-k%c5%abkulu--00-4-1-00-0--4----0-0-11-00-2utfZz-8-00&a=d&d=D9586)).
> The first *u* is long; that is what the kahakō over it marks.
>
> Kūkulu builds from a specification and nothing else: the spec is the only
> foundation a flight stands on. What a flight leaves behind — the plan, the
> per-task commits, the review record — is the evidence the build stands on.
>
> \[PLACEHOLDER — Eric: a sentence or two in your own words on why you chose
> the name.\]
>
> The name comes from ʻōlelo Hawaiʻi. This project is not affiliated with or
> endorsed by any Native Hawaiian organization and does not claim to speak for
> Hawaiian culture. We write the name with its kahakō as a matter of respect
> for the language, and ask contributors to do the same in prose.

## Phase 3 (after Eric merges and says go)

- Run `git tag v0.6.0 <merge commit>` and push the tag.
- Run `gh release create v0.6.0` with notes identical to the CHANGELOG entry
  (Summary / Breaking changes / Migration / Compatibility / Licensing, using
  Eric's exact licensing sentence / Other changes). No narrative.

## Verification

- At each commit: `npm run lint`, `pre-commit run --all-files`, `npm test`.
- `node scripts/check-names.mjs` passes on the tree and fails on each bad
  fixture.
- `git diff --stat main -- docs/flights docs/feedback docs/SPEC.md
  docs/plans/v0.3.md docs/plans/v0.3.1.md docs/plans/v0.3.2.md
  docs/plans/v0.4.md` is empty, and the CHANGELOG diff only adds lines above
  `## [0.5.0]`.
- `git grep -n -i foundry -- ':!docs/flights' ':!docs/plans' ':!docs/feedback' ':!docs/SPEC.md'`
  returns only the deliberate compatibility sites: the resolver, env
  fallbacks, guard and hooks alternatives, migrate, archived-name reading,
  tests of those, migration docs, and the CHANGELOG 0.6.0 entry.
- Manual check, not verified by the tests (human): install from the working
  tree (`claude --plugin-dir .`) in a project still on the old layout,
  confirm the deprecation line, run `kukulu_migrate`, then
  `/kukulu:go-flight`.
