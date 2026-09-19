# Writing a spec Foundry can build from

The spec is the only part of this pipeline a human writes, and it is the part
that decides whether the rest of it is worth running. The planner reads
`docs/SPEC.md` in full, resolves everything ambiguous in it, and emits a plan
that a cheaper model executes without ever asking you a question. Anything you
leave vague gets decided by a model at 3am and recorded in a log entry you will
read later.

Start from [`templates/SPEC.md`](../templates/SPEC.md). The headings in it are
the ones the planner looks for by name.

## What each section is for

| Section | What the planner does with it |
|---|---|
| **1. Overview** | Frames everything else. Three sentences, not three pages. |
| **2. Goals and non-goals** | Non-goals become `**Out of scope:**` lines on individual tasks. An unstated non-goal is an invitation. |
| **3. Engineering principles** | Becomes `## Constraints` in `CLAUDE.md`, and the first thing the reviewer checks. |
| **4. Architecture** | Becomes the module map and the boundaries the reviewer enforces. |
| **5. Data and configuration** | Config keys and defaults; every `⚠️ ASSUMPTION` becomes a tuning task. |
| **6. Interfaces** | The contracts tasks are written against, so two tasks touching both sides agree. |
| **7. Commands** | Copied verbatim into `docs/foundry.json` as `verify`. Get these right. |
| **8. Phases** | Become the phases of the plan, in order, each ending in something a human can look at. |
| **9. Open questions** | Each one is resolved under `## Decisions` in `PLAN.md` with a rationale, or becomes a bounded spike task. |
| **Appendix** | Mockups and fixtures. The planner opens every file in `docs/`. |

## The four things that actually matter

### 1. Principles a reviewer can check mechanically

Section 3 is the highest-leverage part of the document, because it is the only
part that constrains *every* task. Write each principle so that checking it is
a grep, not an opinion:

- Good: "no `Date.now`, `Math.random` or `performance.now` under `src/core/`"
- Good: "every tunable is a key in `config.ts`; no numeric literal outside it"
- Good: "iteration order is deterministic — no `Object.keys` over a map that
  callers can mutate"
- Bad: "the core should be pure"
- Bad: "write clean, idiomatic code"

The reviewer treats a constraint violation as the most severe category of
finding. A principle it cannot check is a principle that does not exist.

### 2. Commands that exit non-zero

Section 7 becomes `verify` in `docs/foundry.json`, and `foundry_verify` runs it
after every task. Each command must fail loudly:

```text
npm run typecheck
npm run lint
npm test -- --run
```

A test runner in watch mode, a linter that only warns, or a script that ends in
`|| true` will make every task pass and every review a surprise. If part of the
suite is slow, that is what `extraVerify` is for — commands keyed by path
prefix that only run when a task touches that area.

### 3. Assumptions marked as assumptions

Any number you are guessing at gets `⚠️ ASSUMPTION` and a config key:

```text
Tick rate: 30 Hz ⚠️ ASSUMPTION — config key `sim.tickHz`, default 30.
```

The planner is required to name the key and its default in the task that
introduces it, forbid hard-coding the number anywhere else, and schedule a
tuning task at the point the value first matters — one that measures before and
after and records the result in the commit and the log. Unmarked guesses become
magic numbers scattered across the codebase.

### 4. Phases that end in something visible

Each phase ends with a task that pushes the branch and writes down what a human
must check by hand: a screen, a device, a printout, a recorded run. The
implementer cannot do that check; it writes
`Manual check: NOT VERIFIED (human)` in the log and moves on. Those lines are
collected into `HANDOFF.md` and again into `SUMMARY.md`, so the list of what
you still owe the project arrives with the branch.

Never make a later task depend on a manual check. The run does not stop for
you.

## Ambiguity is the failure mode

There is no human between tasks. Where a spec allows two readings, one of them
gets chosen silently, implemented, tested against itself, and defended in
review. The planner is instructed to pick a reading and record it, and the
implementer to record an `Interpretation:` line whenever it does the same — but
both of those are salvage. It is cheaper to write the sentence that had only
one meaning.

Concretely, prefer:

- "Scores are integers; ties are broken by earliest submission time" over
  "scores are ranked"
- "Retries: 3 attempts, 250ms base, exponential, jitter ±20% — config key
  `http.retry`" over "retry on failure"
- "The cache is per-process and not shared between workers" over "cache
  results"

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

That is enough for the planner to write a `foundry.json` with a matching
`extraVerify`, a `CLAUDE.md` with four checkable constraints, and a reviewer
that can grep for violations rather than form an impression.

## Before you start the flight

- `docs/SPEC.md` is committed.
- Mockups and fixtures are in `docs/` and referenced from the appendix.
- Every command in section 7 runs, today, in a clean checkout.
- Every guessed number carries `⚠️ ASSUMPTION` and a config key.
- Every principle in section 3 can be checked with a grep or a test.

Then:

```bash
claude
> /foundry:go-flight
```

(The README's per-project section covers the one-time permission rule an
unattended flight needs.) The planner will report the decisions it made and the spec issues it found
before any code is written. Read that report. It is the cheapest moment to
discover the spec meant something you did not intend.
