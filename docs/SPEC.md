# Kūkulu 0.7.2 — Specification

Version: 0.7.2 Status: draft for owner review

The Kūkulu planner reads this file in full and derives the build plan from it. The 0.7.1 spec is archived unchanged at [flights/v0-7-1/SPEC.md](flights/v0-7-1/SPEC.md); section ids written `0.7.1 A-nn` or `0.7.1 B-nn` refer to it. The plugin running this flight is the installed 0.7.1, read from the plugin cache. The flight edits the working tree, and nothing it changes affects the server running the flight.

This is a patch release with no new tools. It clears the friction that real flights logged between 2026-10-20 and 2026-10-25, before 0.8.0's larger flight runs on top of it. The guard closes the two known-gap candidates the 0.7.1 review named. Commit signing stops failing silently and stops outliving the run that turned it off. A flight's PR is titled after the flight and ends in a merge commit that names it. The release mechanics that every flight so far has done by hand become defaults. And the reviewer's tools work on an older `gh` and take more than one test path.

## Recommendation on size

This release is one flight (`flight=v0-7-2`), four phases, all serial. Each requirement names its function, its refusal text and its tests, and none of them asks for a parser to be completed. 0.7.1 principle 1 (the guard is a tripwire) carries over unchanged as principle 1 below, so a guard finding outside A-01 and A-02 is a known-gap candidate, not a fix task.

## 1. Overview

Kūkulu is a Claude Code plugin. A dependency-free MCP server (`mcp/server.mjs`) holds the mechanics, and the skills (`skills/*/SKILL.md`) hold the judgment. Release 0.7.2 closes:

- the items in `docs/feedback/2026-10-25-project-e.md`, `docs/feedback/2026-10-25-project-f.md` and `docs/feedback/2026-10-26-kukulu.md`;
- a beta user's request for a PR title that names the flight;
- the known-gap candidates and notes in the 0.7.1 flight's `SUMMARY.md`.

Done means:

- every requirement in §6 has its tests;
- `npm run lint`, `pre-commit run --all-files`, `npm test`, `npm run check:site` and the guard self-test pass;
- the version reads 0.7.2 everywhere;
- a draft PR is open against `main`.

**Why a patch version.** No tool is added or removed, and no tool's input schema loses or renames a field. Four things change for someone upgrading. None of them changes a contract:

- **Guard.** It denies rsync's deleting options on protected paths and treats `bsdtar` and `gtar` as `tar` (A-01, A-02). Both close holes.
- **Defaults.** `policies.archive` now defaults to `true` (C-02). The default PR title becomes the flight's name (C-01).
- **Signing.** `kukulu_pr_finalize` no longer waits for signatures that the signing policy never asked for (B-03).
- **Loosened inputs.** `kukulu_mutate`'s `filter` also accepts a list (D-02). `kukulu_pr_finalize`'s `breaking` becomes optional when a CHANGELOG decides it (C-03).

One `docs/kukulu.json` key is added (`prTitle`), and it is optional. The CHANGELOG lists all of this under Changed, with no "Breaking changes" heading.

**Patent note.** Nothing in this release goes beyond U.S. Provisional Application No. 64/178,095, so no section carries a NEW MATTER marker. Write "patent pending", never "patented".

## 2. Goals and non-goals

- Goal: rsync's deleting options cannot remove a protected path (A-01).
- Goal: `bsdtar` and `gtar` get every decision `tar` gets (A-02).
- Goal: the 0.7.1 review's advisory notes on the guard and the server are closed (A-03).
- Goal: a commit that fails because it could not be signed is recognized as a signing failure, whatever the signer printed (B-01).
- Goal: the local `commit.gpgsign false` that an `auto` fallback writes is lifted at the next run start, so a recovered signing agent signs again (B-02).
- Goal: `kukulu_pr_finalize` waits for signatures only when the signing policy expects them, and `kukulu_run_start` says up front which case applies (B-03).
- Goal: under `policies.signing` `required`, a broken signer is reported before the plan stage does its work (B-04).
- Goal: the draft PR's title names the flight, and the merge commit's subject repeats it (C-01).
- Goal: a flight archives itself by default (C-02).
- Goal: the breaking-change verdict comes from the CHANGELOG when there is one (C-03).
- Goal: a round cap the operator changes is recorded in PLAN.md's Decisions (C-04).
- Goal: `prChecks` reports CI on a `gh` without `pr checks --json` (D-01).
- Goal: `kukulu_mutate`'s `filter` takes several test paths (D-02).
- Goal: `kukulu_mutate` says what kind of change it undid in each restored file (D-03).
- Non-goal: a release tool (tagging, release notes, publishing). It is a new tool, which is 0.8.0's.
- Non-goal: signing the log's uncommitted tail. It is new matter and stays out of scope.
- Non-goal: any change under `site/` or `docs/site/`.
- Non-goal: new tools, removed tools, or renamed input fields.
- Non-goal: background jobs for long verify commands (cleanflate F-13, F-28). Still deferred.

## 3. Engineering principles

Each is checkable by grep or test. Those marked `[rule:<id>]` are `constraints` in `docs/kukulu.json`. The rest are checked by the reviewer, by reading.

1. **The guard is a tripwire, not a sandbox.** This is 0.7.1 principle 1, carried over as written, with its triage rule: a guard finding becomes a fix task only when it is a regression, writes a protected path or reads under `deny.paths` with a command word and option spelling these rules or the fixture set already name, or is a whole command word missing from a rule. Every other unmodelled spelling goes under REVIEW.md's `## Spec issues` → `Known-gap candidates`, and the summarizer carries it into SUMMARY.md. After A-01 and A-02 land, "already name" includes the rsync options and the two tar command words they add.
2. **Mechanics live in the server, judgment in the skills.** Deriving the breaking verdict, recording a cap change, classifying a signing failure and titling the PR are server changes with tests, never skill sentences.
3. **Every server behavior change has a test** in the suite that owns the tool (CONTRIBUTING.md's table). If no row names the tool, the task adds the row. Every new refusal has a test that triggers it and asserts its message. Every guard change has deny and allow cases in `test/fixtures/guard-cases.json`, with names ending in `(<task id>)`.
4. **Tools validate, then mutate.** A refusal comes before any file is written, and a tool whose final commit fails leaves the tree as it found it. The signing probe (B-01, B-04) writes only a dangling commit object, never a ref, the index or the tree.
5. **Config never silently defaults a bad value.** `prTitle` is validated in the config validator, with the existing unknown-key refusal.
6. **No guard fixture changes its decision unless a task names it.** A task may add fixtures. It may change an existing fixture's `expect` or `reason` only when §6 names that fixture's form, and the commit body lists every one it changed. The reviewer checks with `git diff <merge-base>..HEAD -- test/fixtures/guard-cases.json`.
7. **Every constraint in `docs/flights/v0-7-1/kukulu.json` carries over unchanged**, including the site rules and `progress-no-bare-macron`. None is added.
8. **Documentation moves with the code.** A task that changes a tool's behavior updates `docs/mcp-tools.md` in the same commit. A task that changes a guard rule updates `docs/cleanroom.md` in the same commit. A task that adds or changes a config key or default updates `docs/operations.md` in the same commit.
9. **Error messages are written for a model**: say what is wrong and what to do instead. Comments explain why.
10. **No dependencies anywhere**, and tests never depend on an untracked file. Recorded `gh` and signer output lives in `test/fixtures/`, never inline in a `test/*.mjs`.
11. **Tests never touch the developer's signing setup.** A signer test uses `test/harness.mjs`'s fake signer or a fake program it writes into a temp directory, with repo-local git config, as CLAUDE.md's signing-tests protocol says.

## 4. Architecture

No module is added. These are the changes, by module:

| Path | Changes |
|---|---|
| `mcp/cleanroom.mjs` | rsync's deleting options (A-01); `bsdtar`/`gtar` (A-02); the recursive rsync denial's reason and the `KNOWN_LIMITS` comment (A-03) |
| `mcp/server.mjs` | `commitStaged`'s failure classification (B-01); `probeSigning` and `runStart` (B-02, B-03); `prFinalize`'s signed check (B-03); `next` at the plan stage (B-04); `runFinish`'s PR title and `prFinalize`'s merge subject, the config validator (C-01); `cfgFrom`'s archive default (C-02); `prFinalize`'s breaking verdict (C-03); `flightOptions` (C-04); `prChecks` (D-01); `mutate` and `undoMutationResidue` (D-02, D-03); the `checkConstraints` comment (A-03) |
| `skills/summarize/SKILL.md` | the Breaking call reads the CHANGELOG's verdict (C-03) |
| `test/fixtures/guard-cases.json` | new cases (A-01, A-02) |
| `test/fixtures/gh/`, `test/fixtures/signing/` | recorded `gh` output (D-01) and signer stderr (B-01) |
| `docs/cleanroom.md`, `docs/mcp-tools.md`, `docs/operations.md`, `README.md`, `CHANGELOG.md` | as each requirement says |

`run-command.mjs`, the hooks and the verifier do not change.

## 5. Data and configuration

### 5.1 `docs/kukulu.json`

| Key | Type | Default | Notes |
|---|---|---|---|
| `prTitle` | string | derived (C-01) | 1 to 120 characters, no newline. The title of the draft PR that `kukulu_run_finish` opens, and the subject of the merge commit. |
| `policies.archive` | boolean | `true` (was `false`) | C-02. Owner decision: every release flight so far has needed the archive. It is no longer an ⚠️ ASSUMPTION, so CLAUDE.md's ASSUMPTION list drops it. |

`baseBranch` for this flight is `main`, and build branches are `build/<date>`. This flight's own `docs/kukulu.json` sets `policies.archive: true`, because the running 0.7.1 server still defaults it to `false`.

### 5.2 Tunables

None added. The remaining ⚠️ ASSUMPTION defaults (`review.mutationFixRounds` 2, `cleanroom.similarity.separationMargin` 0.0, `cleanroom.idleGapHours` 3) stay where they are, unchanged.

### 5.3 Constraints

The constraints in `docs/flights/v0-7-1/kukulu.json` carry over unchanged (principle 7). `no-sync-merge` still holds after C-01, because `--subject` goes inside the same inline argument array, after `--auto`.

## 6. Interfaces

### A — The guard

#### A-01 — rsync's deleting options (0.7.1 known-gap candidate)

Today `rsync -d --delete empty/ docs/` removes `docs/cleanroom.json`. 0.7.1 A-04 judges only recursive calls as whole-destination writes, and `-d`/`--dirs` is not recursive. Two option families now write, whether the call is recursive or not:

- **Deleting the destination.** These options make the destination tree a write target as a whole: `--delete`, `--del`, and `--delete-before`, `--delete-during`, `--delete-delay`, `--delete-after`, `--delete-excluded` and `--delete-missing-args`. A call with any of them is denied when its destination equals or contains a protected path. The reason is `protected path: <abs path> (rsync --delete* can remove it from <dest>)`, with `<dest>` as the command wrote it.
- **Removing the sources.** `--remove-source-files` makes every source operand a write target. A source that equals or contains a protected path is denied with `protected path: <abs path> (rsync --remove-source-files removes it)`.

`rsyncParts` reports both families alongside `recursive`. The option is matched as written, or as `--opt=value` for those that take one; rsync's own abbreviation rules are a known gap under `KNOWN_LIMITS` entry 3. `docs/cleanroom.md` rule 6's rsync sentence names both families. Required fixtures:

- denied: `rsync -d --delete empty/ docs/`, `rsync --dirs --delete-after empty/ .kukulu/`, `rsync -r --del empty/ ./` (the root contains the protected set), `rsync --remove-source-files docs/cleanroom.json build/`;
- allowed: `rsync -a --delete src/ build/`, `rsync --remove-source-files build/a.o out/`, `rsync -d empty/ docs/` (no deleting option: 0.7.1 A-04's landing-path rule still judges it).

#### A-02 — `bsdtar` and `gtar` are `tar` (0.7.1 known-gap candidate)

Today `bsdtar -xf a.tar -C docs` is allowed, because only the command word `tar` has a rule. Wherever `mcp/cleanroom.mjs` names `tar`, the command words `bsdtar` and `gtar` get the same treatment: the write rule (0.7.1 A-04), the recursive-read list and `plain()`. A reason that names the command uses the word as written (`bsdtar writes …`). `docs/cleanroom.md` names the two aliases wherever it names `tar`. Required fixtures:

- denied: `bsdtar -xf a.tar -C docs`, `gtar xf a.tar -C .kukulu`, `bsdtar -cf docs/cleanroom.json src`;
- allowed: `bsdtar -tf a.tar`, `gtar xf a.tar -C build`, `gtar cf build/a.tar docs`.

#### A-03 — the 0.7.1 review's advisory notes

- The recursive rsync denial quotes the destination form. It now names the protected path it reaches, as every other `protected path:` reason does: `protected path: <abs path> (rsync writes it into <dest>)`. The fixture for `rsync -a evil/ .kukulu/` (0.7.1 A-04) may change its `reason`, and only that fixture's. The commit body lists it.
- The doc comment above `KNOWN_LIMITS` in `mcp/cleanroom.mjs` cites "SPEC D-03". It should cite 0.7.1 A-01.
- In `mcp/server.mjs`, `checkConstraints`'s doc comment sits above `const constraintTests`. It moves to directly above `function checkConstraints`, and `constraintTests` gets a one-line comment of its own.

No test is needed beyond the fixture for the reason. These are comment and message changes.

### B — Signing

#### B-01 — a failed commit is classified by a probe, not by its text (project-e F-03)

Today `commitStaged` treats a failed commit as a signing failure only when git's output matches `SIGNING_FAILURE`, or the commit timed out. An SSH-format signer prints its own error, and git adds `fatal: failed to write commit object`. That output most likely matched none of the words, which would explain project-e F-03. Under `auto` the commit then failed outright instead of falling back, and the planner's validated plan was left uncommitted.

The change: when a commit fails without timing out and its text does not match `SIGNING_FAILURE`, `commitStaged` asks a probe before giving up. The probe runs only when `commit.gpgsign` is in effect for the commit (`git config --get commit.gpgsign` is `true`). It makes two bounded `git commit-tree` calls on the empty tree (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`, which works on an unborn branch), one with `-S` and one without:

- If the signed call fails and the unsigned one succeeds, the failure is a signing failure. The existing `auto` and `required` paths then run, with `line` set to the signed probe's first stderr line.
- Otherwise the original `git commit failed: …` error stands.

`probeSigning` uses the same probe helper. Both calls write only dangling objects.

Tests in `test/implement.mjs` use a fake SSH signer written into a temp directory. It is a script that prints a line containing none of `SIGNING_FAILURE`'s words (recorded in `test/fixtures/signing/ssh-agent-missing-key.txt`) and exits 1. The repo is set to `gpg.format ssh`, `gpg.ssh.program <fake>`, `user.signingkey` a literal `key::` value and `commit.gpgsign true`, all repo-local.

- Under `auto`, `kukulu_plan_commit` commits unsigned, `state.signing` starts with `off (commit signing failed:` and quotes the fake's line, and one `signing` feedback entry is logged.
- Under `required`, it refuses with the existing required message, quoting the line, and nothing is committed.
- A commit that fails for a reason other than signing (a `commit-msg` hook that exits 1) still refuses with `git commit failed:`, and the probe does not turn it into a fallback.

#### B-02 — the fallback's override does not outlive its run (project-f F-01, F-03)

When an `auto` fallback fires, it writes `commit.gpgsign false` into the repo's local git config and sets `state.signingOverride`. Two things then go wrong:

- **The override outlives the flight.** `kukulu_flight_archive` carries `signingOverride` into the fresh state, but the next `kukulu_run_start`'s `probeSigning` reads the local `false` as "not configured" and records `signing: "none"`. The next flight then runs unsigned without one word of warning, which is what project-f's live state shows.
- **A resumed run never re-probes.** `kukulu_run_start` on an already-started branch returns before probing, so a signing agent that has come back is never used again in that run.

The changes:

- `probeSigning` takes the state. When `state.signingOverride` is true, it unsets the local `commit.gpgsign` before reading the setting, as `resign` already does. It then probes the operator's own setting, and puts the override back if the probe falls back again. When the probe succeeds, `signingOverride` is deleted and `signing` is `"on"`.
- The already-started path of `kukulu_run_start` re-probes when `signingOverride` is true, and only then. It records the new outcome. Its result gains `signing`, as the fresh path's already has. A re-probe never overwrites an `off (commit signing failed: …)` or `off (probe failed: …)` record with `"none"`: if the operator's setting is not configured, the earlier record stays.
- A repo-local `commit.gpgsign false` that Kūkulu did not write (no `signingOverride`) is the operator's choice, and it is never touched.

Tests in `test/implement.mjs`:

- An archived flight whose fallback fired, then a new flight with a working fake signer: `run_start` records `signing: "on"`, the local config no longer reads `false`, and the first commit is signed (`%G?` is not `N`).
- The same with the signer still failing: `signing` starts with `off (probe failed:`, and the override is back.
- A resumed run (already started) after the signer recovers: signs again.
- An operator's own local `false` with no override: untouched, `signing: "none"`.

#### B-03 — finalize waits for signatures only when the policy expects them (owner decision)

Today `kukulu_pr_finalize` holds the PR as a draft while any commit since the merge base is unsigned, whatever the signing policy is. So a project with `policies.signing: "off"`, or with `auto` and no signing configured, ends every flight "awaiting signing". From now on, finalize expects signatures when either:

- `policies.signing` is `required`; or
- `policies.signing` is `auto` and `state.signing` is not `"none"`. That is, the operator's signing was configured when the run started, including a run that fell back to `off (…)` partway.

When finalize does not expect signatures, the signed check still runs, and its counts are reported. The result gains `signatures: "not required: policies.signing is <policy>"`, or `"not required: signing is not configured"` for `auto` with `"none"`. No `awaitingSigning` is recorded, and the PR proceeds per `policies.finalize`. When it expects them, behavior is unchanged and `signatures` is `"required"`.

`kukulu_run_start`'s result gains a `signingNote` whenever the outcome is not `"on"`. It says, in one sentence, whether finalize will wait:

- `off` or `none` under `off`/`auto`: "commits in this run are unsigned and kukulu_pr_finalize will not wait for signatures."
- A fallback under `auto`: "commits from here on are unsigned; kukulu_pr_finalize will wait for signatures, so unlock the signing agent and call kukulu_run_start again to resume signing, or re-sign at the end."

While `state.signing` is not `"on"`, `kukulu_next`'s `Run policies:` sentence ends with the same sentence. That way every stage prompt carries it, not only the implementer's `run_start` result.

Tests in `test/review.mjs`:

- `signing: "off"` with unsigned commits: ready, with `signatures` not required.
- `auto` with `"none"`: same.
- `auto` after a fallback: awaiting, as today.
- `required` with an unsigned commit: awaiting, as today.

`docs/mcp-tools.md` (both tools) and `docs/operations.md`'s signing section say this.

#### B-04 — a broken signer is reported before the plan stage under `required` (project-e F-03)

The planner's work is lost to a signer that was never going to work. Under `auto`, B-01 makes `kukulu_plan_commit` fall back instead. Under `required`, the refusal is correct, but it comes after the work.

When `kukulu_next` returns stage `plan` and `policies.signing` is `required`, it runs B-01's probe. At the plan stage `docs/kukulu.json` usually does not exist yet, because the archive moved the previous flight's copy. So the policy is read from `docs/kukulu.json` if it exists, else from the previous flight's archived copy (`<state.archived.dir>/kukulu.json`), else the default, which is not `required`. That probe is side-effect free: it writes no config and no state. On failure, the stage is still `plan`, and the reason begins `policies.signing is 'required' and the signing probe failed: <line>. Fix the signing agent before planning, or set policies.signing to 'auto' or 'off'.` The go-flight skill stops on a reason with that prefix, instead of starting the planner. If the skill does not already stop on a reason it cannot act on, the task adds the one sentence.

Tests in `test/state.mjs`: `required` with a failing fake signer gives that reason; `required` with a working one, and `auto` with a failing one, give today's plan reason.

### C — The PR and the release

#### C-01 — the PR title names the flight (beta user request)

The request, verbatim: "would be cool to have an option for a custom PR title? … Thinking I have it flight, archive the flight, then merge commit...then if the pr title matches the flight name one could go through the history and more easily find the steps in plan and progress."

Today `kukulu_run_finish` titles the PR `Build: <branch>`, or `Build: <branch> (review round <n>)`. `kukulu_pr_finalize` runs `gh pr merge --auto --<method>` with no subject, so the merge commit reads `Merge pull request #<n> from <owner>/build/<date>`. The changes:

- **The title**, in order of preference:
  1. `prTitle` from `docs/kukulu.json`, used as written.
  2. Otherwise `<flight>: <spec title>`. `<flight>` is `docs/kukulu.json`'s `flight`, and `<spec title>` is `docs/SPEC.md`'s first level-1 heading with a trailing separator-plus-"Specification" removed (`/\s*[—–:-]\s*Spec(ification)?\s*$/i`). This spec's title is therefore `v0-7-2: Kūkulu 0.7.2`. Without a `flight`, the title is the spec title alone.
  3. Without a spec heading, it is `Build: <branch>`, as today.

  The round suffix is dropped. The title is cut to 120 characters.
- **An existing PR's title is left alone.** `kukulu_run_finish` reuses an open PR as it does today. A human may retitle it, and finalize reads whatever the PR is called.
- **The merge subject.** For `mergeMethod` `merge` or `squash`, `kukulu_pr_finalize` reads `gh pr view --json title,number` and passes `--subject "<title> (#<number>)"` in the same inline argument array, after `--auto`. For `rebase` there is no merge commit, so no subject is passed. If the `gh pr view` fails, the merge runs without `--subject`, and the result's `merge` text says `enabled (default subject: <gh's first line>)`.
- `prTitle` is validated: a non-string, an empty string, more than 120 characters or a newline each refuses with `docs/kukulu.json prTitle must be 1 to 120 characters on one line; got <what>`.
- `kukulu_run_finish`'s result gains `prTitle` when it opened a PR.

Tests (`test/implement.mjs` for the title, `test/review.mjs` for the subject, `test/routing.mjs` for validation, all with the fake `gh` recording its arguments):

- `prTitle` wins;
- the derived title with the separator stripped, with and without `flight`;
- the fallback without a heading;
- no round suffix at round 2;
- `--subject` for merge and squash, none for rebase;
- the view-failure text;
- each validation refusal.

`docs/operations.md` gets the `prTitle` row, and `test/plugin.mjs`'s config-keys loop covers it.

#### C-02 — archiving is the default

`cfgFrom`'s `archive: c.policies?.archive ?? false` becomes `?? true`. It is still the only place the default is written. `docs/operations.md`'s row says `true` and why. CLAUDE.md's ASSUMPTION list drops `policies.archive`, and its "Constraints" reviewer bullet that names the `false` default changes to name `true` as an owner decision. A project that wants the old behavior sets `false`. The summarize stage already archives when `kukulu_summary_commit` reports `archive: true`, so no skill changes.

Tests: `kukulu_config_show` and `kukulu_summary_commit` report `archive: true` with no `policies` block, and `false` when it is set. Every existing test that relied on the old default sets `archive: false` explicitly, or asserts the archive.

#### C-03 — the CHANGELOG decides "breaking" (0.7.1 SUMMARY's Breaking call)

In 0.7.1 the summarizer judged the flight breaking on its own, against both the SPEC and the CHANGELOG, which turned off auto-merge. The verdict now comes from the CHANGELOG when there is one.

The newest entry is the text from `CHANGELOG.md`'s first heading that starts with `## [` up to the next level-2 heading. When `CHANGELOG.md` exists at the root and has such an entry:

- The verdict is `true` exactly when that entry has a line matching `/^###\s+Breaking changes\s*$/i`.
- `breaking` becomes optional.
- If the caller passes a `breaking` that disagrees, `kukulu_pr_finalize` refuses before any write: `breaking: <value> disagrees with CHANGELOG.md's newest entry (<its heading line>), which <has|has no> a "### Breaking changes" section; the CHANGELOG decides. Call kukulu_pr_finalize again without breaking, and record the disagreement in SUMMARY.md's Breaking call as a note.`
- The result gains `breakingSource: "changelog"`.

Without a CHANGELOG or such an entry, today's behavior stands: `breaking` is required on the first call, and `breakingSource` is `"caller"`. A remembered `st.breaking` from an earlier call does not override the CHANGELOG.

`skills/summarize/SKILL.md`'s Breaking call changes:

- When the repository has `CHANGELOG.md`, the line states the CHANGELOG's verdict and its reason, plus `Note:` and the summarizer's disagreement if it has one. Its last call is `kukulu_pr_finalize({})`.
- Otherwise the line and the `breaking` argument work as today.

Tests in `test/review.mjs`:

- an entry with the heading gives `true` and no auto-merge;
- an entry without it gives `false`;
- a disagreeing `breaking` refuses, with nothing written;
- an agreeing `breaking` passes;
- no CHANGELOG with no `breaking` gives the existing refusal;
- `[Unreleased]` counts as the newest entry when it is first.

#### C-04 — a cap the operator changes is in PLAN.md (0.7.1 SUMMARY note)

In 0.7.1, `docs/kukulu.json` had `maxRounds: 6`, set through `kukulu_flight_options`, while PLAN.md's Decisions said the default 3 was kept. When `kukulu_flight_options` changes `maxRounds` or `maxRoundsHard` to a value that differs from the current one:

- It appends one line per changed cap to PLAN.md's `## Decisions` section, at the end of that section: `- <YYYY-MM-DD>: <cap> set to <n> (was <old>) by the operator through kukulu_flight_options.`
- If PLAN.md has no `## Decisions` heading, the section is appended at the end of the file.
- PLAN.md joins the tool's rollback set and its commit.
- An unchanged value writes nothing.

This is the one sanctioned server write to PLAN.md outside `kukulu_plan_commit`, and CLAUDE.md's "never edit `docs/PLAN.md` by hand" is unaffected.

Tests:

- a raised cap appends the line and commits PLAN.md with the config;
- an unchanged cap writes nothing;
- a missing section is created;
- a failed commit leaves PLAN.md byte-identical.

### D — The reviewer's tools

#### D-01 — `prChecks` on an older `gh` (kukulu F-01; project-e F-02, F-04, F-05)

On gh 2.45.0, `gh pr checks --json` fails with `unknown flag: --json`, and `prChecks` returns `unknown: unknown flag: --json`. That has happened in four review rounds across three flights. When `pr checks --json` exits non-zero with stderr matching `/unknown flag:? --json/i`, `prChecks` falls back to the REST API, which works on every gh version:

1. `gh pr view --json headRefOid` gives the head sha.
2. `gh api repos/{owner}/{repo}/commits/<sha>/check-runs?per_page=100` gives the check runs.
3. `gh api repos/{owner}/{repo}/commits/<sha>/status` gives the commit statuses.

Each call is bounded by `CHECKS_TIMEOUT_MS`. The fallback maps each check to the same state words the JSON path uses:

- **A check run** that is not `completed` is pending. A conclusion of `failure`, `cancelled`, `timed_out`, `action_required` or `startup_failure` fails, and any other conclusion passes. The link is `html_url`.
- **A status** of `failure` or `error` fails, `pending` is pending, and `success` passes. The link is `target_url`.

Any fallback call that fails returns `unknown: <first line>`, as the JSON path does. The return shape is unchanged, plus `via: "gh api"` when the fallback produced it.

Recorded outputs go in `test/fixtures/gh/`: the `unknown flag` stderr, a `check-runs` body with one of each conclusion, and a `status` body. `test/state.mjs` drives the fake `gh` with them and asserts pass, fail (with the failing names and links), pending, none, and a failing `gh api`.

#### D-02 — `filter` takes a list (project-e F-01)

`kukulu_mutate`'s `filter` accepts a string, as today, or an array of 1 to 10 strings. Each string must match `MUTATION_FILTER`. The `{filter}` slot receives the strings single-quoted and space-separated, in the order given (`'tests/test_identity.py' 'tests/test_substitute.py'`).

- An empty array, more than 10 entries or a non-string entry refuses: `filter must be a string or a list of 1 to 10 strings, each 1 to 200 characters from letters, digits and _ . : / -; got <what>`.
- An invalid entry refuses with the existing message, naming that entry.
- The schema gives `filter` both types, and its description says so.

Tests: a two-entry list reaches the command as two quoted words (asserted through a targeted command that echoes its arguments into a file outside the repo); each refusal.

#### D-03 — `kukulu_mutate` says what it restored (project-f F-02)

project-f F-02 saw `restored: [.github/workflows/ci.yml, scripts/e2e/tui.sh]` after a `cargo test` that writes no files, with the content unchanged afterwards. `undoMutationResidue` restores whatever `git diff --name-only HEAD` lists, without saying how each path differed. A mode change, or a file deleted and recreated, looks the same as an edit.

Before restoring, `undoMutationResidue` reads `git diff --raw HEAD -- <paths>` and classifies each path:

- `mode` when only the mode differs;
- `deleted` when the file is gone;
- `content` otherwise (the type letter `M` with differing blob ids, or `T`).

The result keeps `restored` (a list of paths) and gains `restoredChanges: [{ path, change }]` in the same order.

If the review of this task can reproduce F-02's cause from that classification, the task records it in its commit's `Interpretation:` line. No other behavior changes. Tests: a command that `chmod`s a tracked file gives `mode`, one that edits gives `content`, and one that deletes gives `deleted`. The file is restored in every case.

### E — Documentation and release

- `docs/mcp-tools.md`: `kukulu_run_start` (B-02, B-03), `kukulu_pr_finalize` (B-03, C-01, C-03), `kukulu_next` (B-04), `kukulu_run_finish` (C-01), `kukulu_flight_options` (C-04), `kukulu_status` (D-01) and `kukulu_mutate` (D-02, D-03). Its first line still reads "Twenty-five tools".
- `docs/operations.md`: the `prTitle` row, the `policies.archive` default, and the signing section (B-01 to B-04).
- `docs/cleanroom.md`: A-01 and A-02.
- `README.md`: no change unless a sentence states the archive default or the PR title. The tool count is unchanged.
- `CHANGELOG.md` `## [0.7.2] — <date>`, renamed from `## [Unreleased]` by the release task, under Changed and Fixed. Each item cites its feedback item (`project-e F-03`, `kukulu F-01`) or "a beta user's request" (C-01). There is no "Breaking changes" heading, so under C-03 this flight's own PR is not breaking.
- The version reads `0.7.2` in `package.json`, `.claude-plugin/plugin.json` and `VERSION` in `mcp/server.mjs`.
- The three feedback files in §1 get an "Addressed in" header line pointing at this spec. They are local and gitignored, so the task edits them only if they exist, edits only the header, and never stages them. No test reads them.
- `docs/HANDOFF.md` has no "do not merge" line.

## 7. Commands

Run from the repository root. Each exits non-zero on failure and runs today on a clean checkout of `main`.

- lint: `npm run lint` (under 3 s)
- hygiene: `pre-commit run --all-files` (about 4 s)
- test: `npm test` (about 100 s; `timeoutMs: 900000`)
- the guard self-test, as `extraVerify` on `scripts/cleanroom-guard.mjs`, `mcp/cleanroom.mjs`, `test/fixtures/guard-cases.json` and `templates/cleanroom.example.json`: `node scripts/cleanroom-guard.mjs --self-test templates/cleanroom.example.json`
- site, as `extraVerify` on `site/`, `docs/site/` and the three site scripts: `npm run check:site`
- targeted mutation: `node test/{filter}.mjs` as `mutation.targeted.suite`

## 8. Phases

### Phase 0 — The guard

A-01 to A-03. Ends with a push. Manual check, `NOT VERIFIED (human)`: in a live clean-room session with `claude --plugin-dir .`, `rsync -d --delete empty/ docs/` and `bsdtar -xf a.tar -C docs` are denied.

### Phase 1 — Signing

B-01 to B-04. Ends with a push. Manual check, `NOT VERIFIED (human)`: in a scratch repo, with the owner's real SSH signer and the agent socket pointed at the wrong agent, `kukulu_plan_commit` under `auto` commits unsigned and logs the fallback. Then, with the socket fixed, `kukulu_run_start` signs again.

### Phase 2 — The PR and the release

C-01 to C-04. Ends with a push. Manual check: this flight's own draft PR is titled `v0-7-2: Kūkulu 0.7.2`, once the release is installed. The running 0.7.1 server still opens it as `Build: <branch>`, so the check is on the next flight. `NOT VERIFIED (human)`.

### Phase 3 — Reviewer tools, documentation and release

D-01 to D-03, then E. Version bump, CHANGELOG, `docs/HANDOFF.md`. Manual check, `NOT VERIFIED (human)`: on a machine with gh 2.45.0, `kukulu_status` reports the PR's checks with `via: "gh api"`.

## 9. Open questions

None block the build. Each is decided here, so the planner records it under `## Decisions` as given:

1. **Whether finalize follows the signing policy.** It does (B-03): an owner decision of 2026-10-26.
2. **The default PR title.** `<flight>: <spec title>` (C-01): an owner decision of 2026-10-26, over the slug alone and over keeping `Build: <branch>`.
3. **Whether `policies.archive` defaults to true.** It does (C-02): an owner decision, after two release flights that both needed it.
4. **The two known-gap candidates.** Fixed as rules (A-01, A-02), not added to `KNOWN_LIMITS`. Both are whole command words or options with one meaning, which principle 1's third condition covers.
5. **One flight.** `v0-7-2`, four phases, serial.
6. **The 0.7.1 SUMMARY's "Suggested CLAUDE.md additions"**: the guard-cases indentation, merge commits without pathspecs, `kukulu_verify`'s large output, and the running plugin. The planner carries the ones that still apply into this flight's notes section.

## Appendix A: item map

### `docs/feedback/2026-10-25-project-e.md`

| Item | Disposition |
|---|---|
| F-01 `kukulu_mutate`'s `filter` takes one path | fixed, D-02 |
| F-02, F-04, F-05 `prChecks` fails on gh 2.45.0 | fixed, D-01 |
| F-03 the plan commit dead-ended on an SSH signer | fixed, B-01 (`auto` falls back) and B-04 (`required` is told first) |
| F-06, F-07, F-08 flights ended awaiting signing | addressed by B-02 (the override no longer leaves the next flight unsigned) and B-03 (no wait when the policy expects none). A flight whose configured signer failed mid-run still waits, by design, and `resign` covers it |

### `docs/feedback/2026-10-25-project-f.md`

| Item | Disposition |
|---|---|
| F-01 the first flight ended awaiting signing | as project-e F-06 |
| F-02 `kukulu_mutate` reported restoring files no test touches | D-03 (classify what was restored); the cause is recorded if the classification shows it |
| F-03 signing timed out and `auto` turned it off | the fallback worked as designed; B-02 makes the next run start sign again |

### `docs/feedback/2026-10-26-kukulu.md`

| Item | Disposition |
|---|---|
| F-01 `prChecks` fails on gh 2.45.0 | fixed, D-01 |

### Beta user request

| Item | Disposition |
|---|---|
| A custom PR title that matches the flight name | fixed, C-01 (default and `prTitle` override, plus the merge subject); C-02 makes the archive the request relies on the default |

### 0.7.1 `SUMMARY.md` and `REVIEW.md`

| Issue | Disposition |
|---|---|
| Known-gap candidate: rsync's deleting options | A-01 |
| Known-gap candidate: `bsdtar`, `gtar` | A-02 |
| Note: `checkConstraints`'s doc comment above `constraintTests` | A-03 |
| Note: the `KNOWN_LIMITS` comment cites D-03 | A-03 |
| Note: the recursive rsync denial quotes the destination | A-03 |
| Note: `maxRounds: 6` in config, 3 in PLAN's Decisions | C-04 |
| Breaking call contradicted the SPEC and CHANGELOG | C-03 |
| Note: mutating `mcp/cleanroom.mjs` under the targeted `cleanroom` suite crashes on an unrelated `git checkout` | declined: the kill is real, and the note's workaround (run the guard self-test directly) stands. Revisit if a 0.8.0 review hits it |
| Note: R1-01's "no merge in progress" assertion passes without `git merge --abort` | declined: the same test's tree and file assertions catch it |
| The ten "edits the owner should make" to the 0.7.1 SPEC | resolved as built: the archived spec and SUMMARY record them, and archived flight files never change |

## Appendix B: interpretation choices made in writing this spec

Each is a place where the brief allowed two readings:

1. **B-01's mechanism.** A probe decides, not a longer regex. Every signer's wording is different, and a regex would be one more table that cannot be proved complete. The probe costs two `commit-tree` calls, and only on a failed commit.
2. **B-03's "expects".** `auto` with signing configured still waits after a mid-run fallback, because the operator asked for signed commits and some are not. Only a run that never had signing configured, or a policy of `off`, stops waiting.
3. **C-01's reach.** The title is set when the PR is opened and never rewritten, so a human's retitle wins. The merge subject reads the PR's actual title for the same reason.
4. **C-03's entry.** The first `## [` heading, so `[Unreleased]` counts while a flight is still writing it, and the release task's renamed heading counts after.
5. **C-04's place.** PLAN.md's Decisions, written by the server. The other reading had the summarizer read the effective caps from state, which fixes SUMMARY.md but leaves PLAN.md wrong.
6. **D-03's scope.** It classifies what was restored and does not try to prevent the restore. Until the cause is known, restoring is the safe default.
