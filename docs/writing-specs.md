# Writing a spec Kūkulu can build from

The spec is the only part of this pipeline a human writes, and it is the part that decides whether the rest of it is worth running. The planner reads `docs/SPEC.md` in full, resolves everything ambiguous in it, and emits a plan that a cheaper model executes without ever asking you a question. Anything you leave vague gets decided by a model at 3am and recorded in a log entry you will read later.

Start from [`templates/SPEC.md`](../templates/SPEC.md). The headings in it are the ones the planner looks for by name.

## What each section is for

| Section | What the planner does with it |
|---|---|
| **1. Overview** | Frames everything else. Keep it to three sentences. |
| **2. Goals and non-goals** | Non-goals become `**Out of scope:**` lines on individual tasks. If you do not state a non-goal, a task may build it. |
| **3. Engineering principles** | Becomes `## Constraints` in `CLAUDE.md`, and the first thing the reviewer checks. |
| **4. Architecture** | Becomes the module map and the boundaries the reviewer enforces. |
| **5. Data and configuration** | Config keys and defaults; every `⚠️ ASSUMPTION` becomes a tuning task. |
| **6. Interfaces** | The contracts tasks are written against, so two tasks touching both sides agree. |
| **7. Commands** | Copied verbatim into `docs/kukulu.json` as `verify`. Get these right. |
| **8. Phases** | Become the phases of the plan, in order, each ending in something a human can look at. |
| **9. Open questions** | Each one is resolved under `## Decisions` in `PLAN.md` with a rationale, or becomes a bounded spike task. |
| **Appendix** | Mockups and fixtures. The planner opens every file in `docs/`. |

## The four things that actually matter

### 1. Principles a reviewer can check mechanically

Section 3 matters most, because it is the only part that constrains every task. Write each principle so that checking it takes a grep rather than a judgment call:

- Good: "no `Date.now`, `Math.random` or `performance.now` under `src/core/`"
- Good: "every tunable is a key in `config.ts`; no numeric literal outside it"
- Good: "iteration order is deterministic: no `Object.keys` over a map that callers can mutate"
- Bad: "the core should be pure"
- Bad: "write clean, idiomatic code"

The reviewer treats a constraint violation as the most severe category of finding. It cannot enforce a principle it cannot check.

Better still, phrase a principle as a single-line pattern. It then becomes an entry in `docs/kukulu.json`'s `constraints`, with fixture lines proving the pattern catches every shape you meant it to. A hard-coded tunable, for instance, can be `const x = 5;`, `'x' => 5,`, or `x: 5,`, and a grep that catches only one shape silently misses the other two for as many review rounds as it takes someone to notice by reading. `kukulu_verify` then checks the rule mechanically on every task, so the reviewer does not have to remember to grep for it by hand each round. See [operations.md](./operations.md#constraints).

### 2. Commands that exit non-zero

Section 7 becomes `verify` in `docs/kukulu.json`, and `kukulu_verify` runs it after every task. Each command must fail loudly:

```text
npm run typecheck
npm run lint
npm test -- --run
```

A test runner in watch mode, a linter that only warns, or a script that ends in `|| true` will make every task pass and every review a surprise. If part of the suite is slow, put it in `extraVerify`: commands keyed by path prefix that run only when a task touches that area.

If the runner can narrow to one test class or file, name that command too, with an unquoted `{filter}` placeholder where the class or path goes:

```text
php artisan test --filter={filter}
```

The planner copies it into `mutation.targeted` in `docs/kukulu.json`, and the reviewer then mutation-tests a single file in seconds instead of running the whole suite.

### 3. Assumptions marked as assumptions

Any number you are guessing at gets `⚠️ ASSUMPTION` and a config key:

```text
Tick rate: 30 Hz ⚠️ ASSUMPTION — config key `sim.tickHz`, default 30.
```

The planner must name the key and its default in the task that introduces it, forbid hard-coding the number anywhere else, and schedule a tuning task at the point the value first matters. That task measures before and after and records the result in the commit and the log. Unmarked guesses become magic numbers scattered across the codebase.

### 4. Phases that end in something visible

Each phase ends with a task that pushes the branch and writes down what a human must check by hand: a screen, a device, a printout, a recorded run. The implementer cannot do that check; it writes `Manual check: NOT VERIFIED (human)` in the log and moves on. Those lines are collected into `HANDOFF.md` and again into `SUMMARY.md`, so the list of what you still owe the project arrives with the branch.

Never make a later task depend on a manual check. The run does not stop for you.

## Ambiguity is the failure mode

There is no human between tasks. Where a spec allows two readings, one of them gets chosen silently, implemented, tested against itself, and defended in review. The planner is instructed to pick a reading and record it, and the implementer to record an `Interpretation:` line whenever it does the same, but both are salvage. It is cheaper to write a sentence with only one meaning.

For example, prefer:

- "Scores are integers; ties are broken by earliest submission time" over "scores are ranked"
- "Retries: 3 attempts, 250ms base, exponential, jitter ±20% — config key `http.retry`" over "retry on failure"
- "The cache is per-process and not shared between workers" over "cache results"

## Independent components parallelize

A flight can run independent tasks at the same time (see [architecture.md](./architecture.md#parallel-workstreams)), but only where the planner can prove they do not touch the same files. A spec helps by describing its components as separable units, each with a named module or directory and an interface to the others, rather than as one intertwined feature. Say where the shared wiring lives (the registry, the routes table, the manifest): that is the part the planner will keep serial. And name any command that starts a port- or container-bound environment, so the plan can mark it exclusive and keep its tasks out of the parallel part.

## Rules that become true at a task

Some rules cannot hold from the first commit: "no `TODO` left in `src/`" is false until the cleanup task has run, and a script a later task creates cannot be checked before it exists. Say which task makes the rule true. The planner then gives the rule `from: "<that task's id>"` in `docs/kukulu.json`: the rule stays inactive until that task is in progress, and still self-tests its own fixtures. The old idiom, wrapping a command in `test ! -f X || bash X`, is no longer needed, and it was a trap: it passed forever if `X` was never written.

## Clean-room flights

Some builds must show that the builder never saw something: a reference implementation, a library's source, a dataset. Kūkulu's clean-room mode checks every tool call against a policy and keeps a signed, hash-chained log of what happened; [cleanroom.md](./cleanroom.md) has the whole reference. The spec's part is small:

1. **Write the policy.** Copy `templates/cleanroom.example.json` to `docs/cleanroom.json` and edit it: the paths and words the build must not touch (`deny`), the few places it may (`allow`), and any directory the build must not edit (`protected`). A policy with a pattern that has no `shouldMatch` and `shouldNotMatch` examples is refused, and the guard self-tests every pattern before a flight starts.
2. **Commit it on the base branch** before the first `/kukulu:go-flight`. The first `kukulu_next` writes the genesis entry and pins the policy's hash; changing the file afterwards fails the gate.
3. **Name the lockdown task.** `lockdown.after` takes the id of the plan's task after which the build may no longer use the network at all (the task that downloads its last fixture). Say in the spec which task that is, so the planner uses the same id.
4. **Configure the controls.** If the finished code is to be scored for similarity to prior art, give `cleanroom.similarity` in `docs/kukulu.json` the subject, a negative and a positive control and the test pairs ([operations.md](./operations.md) has the keys). Keep the prior art outside the repository.

Every commit the server makes in a clean-room flight ends with `Kukulu-Stage` and `Kukulu-Task` trailers, added by the server and not by a git hook, so `--no-verify` cannot skip them. The implementer adds the same two trailers to its task commits. You do not write a git hook for this. A commit without a `Kukulu-Stage` trailer is work outside the pipeline, and the attestation lists it as a coverage gap.

Tell the operator, in the spec, to say `record intervention: <what you did>` for anything done by hand, and `record verdict: #<seq>: false positive — <why>` for each denial that was a mistake of the guard; both are entries in the chain and not notes in a side file.

## A worked fragment

```markdown
## 3. Engineering principles

- No wall-clock or RNG under `src/core/`. Both arrive as injected
  dependencies (`Clock`, `Rng`) so every simulation is reproducible.
- Every tunable is a key in `src/config.ts` with a default. No bare numeric
  literals outside that file except 0, 1 and array indices.
- `src/core/` may not import from `src/io/` or `src/ui/`. The dependency
  arrow points one way.
- Every public function in `src/core/` has a unit test that fails if its
  mechanic is removed.

## 7. Commands

- typecheck: `npm run typecheck`
- lint: `npm run lint`
- test: `npm test -- --run`
- extra, when `src/core/` is touched: `npm run test:invariants`
```

That is enough for the planner to write a `kukulu.json` with a matching `extraVerify`, a `CLAUDE.md` with four checkable constraints, and a reviewer that can grep for violations rather than form an impression.

## Before you start the flight

- `docs/SPEC.md` is committed.
- Mockups and fixtures are in `docs/` and referenced from the appendix.
- Every command in section 7 runs, today, in a clean checkout.
- Every guessed number carries `⚠️ ASSUMPTION` and a config key.
- Every principle in section 3 can be checked with a grep or a test.

Then:

```bash
claude
> /kukulu:go-flight
```

(The README's per-project section covers the one-time permission rule an unattended flight needs.) The planner will report the decisions it made and the spec issues it found before any code is written. Read that report: it is the cheapest point at which to find out the spec says something you did not mean.
