# <Project> — Specification

Version: 0.1
Status: draft

The Foundry planner reads this file in full and derives the build plan from
it. Headings below are the ones the planner looks for by name; keep them, add
whatever else you need. Mark any number you are guessing at with
`⚠️ ASSUMPTION` and give it a config key, so it becomes tunable rather than
hard-coded.

## 1. Overview

What this is, in three sentences. Who it is for. What "done" looks like.

## 2. Goals and non-goals

- Goal: ...
- Non-goal: ...

## 3. Engineering principles

Rules that apply to every task. Phrase each one so a reviewer can check it
mechanically. Examples: "no wall-clock or RNG in `src/core/`", "every tunable
is a config key", "iteration order is deterministic". These become
`## Constraints` in CLAUDE.md and the first review category.

## 4. Architecture

Module map: directory → responsibility → what it may import. Boundaries the
reviewer should enforce.

## 5. Data and configuration

Config keys, their defaults, and which are `⚠️ ASSUMPTION`.

## 6. Interfaces

APIs, message types, file formats, CLI surface — whatever the pieces use to
talk to each other.

## 7. Commands

The exact commands for typecheck, lint, test, build, and any headless or
smoke run. The planner copies these into `docs/foundry.json`; every one must
exit non-zero on failure.

## 8. Phases

Ordered milestones. Each phase should end in something a human can look at.
Say what the manual check is (a device, a browser, a printout).

## 9. Open questions

Anything undecided. The planner either decides it (and records why) or turns
it into a bounded spike task.

## Appendix: mockups and fixtures

List the other files in `docs/` and what each shows.
