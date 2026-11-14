# Recorded metrics inputs

`v0-8-0.inputs.json` is the input of `buildMetrics` for the 0.8.0 flight, built
from its archive in `docs/flights/v0-8-0/`:

- `plugin` and `flight` are the flight's version and its `flight` key in
  `kukulu.json`.
- `spec` is the first heading of its `SPEC.md` and the SHA-256 of that file.
- `state` is its `state.json` as archived (it has no timeline, no harness
  list and no genesis, because 0.8.0 recorded none of those).
- `caps` are its `maxRounds` and `maxRoundsHard` from `kukulu.json`.
- `feedback` are the two entries of its `feedback.jsonl`.
- `tasks` are the counts of its `PROGRESS.md`: 47 tasks, all done.

There are no usage records, no counters and no git facts, because the 0.8.0
server kept none. `v0-8-0.expected.json` is the metrics object those inputs
must build to, worked out from the rules in `docs/metrics.md` and not copied
from the code's output. Both files are ASCII, with every other character
escaped as `\uXXXX`.

`full.inputs.json` is synthetic: every key of the inputs filled (a timeline with
two rounds and an activation, routing, one usage record for each of the five
roles, counters, feedback, task counts, git facts and a genesis), so that a test
can walk every field of the metrics object. It describes no real flight.

`a.METRICS.json` and `b.METRICS.json` are two synthetic flights, both outputs of
`buildMetrics`: A is a general-mode flight on the `anthropic` runner with three
rounds and every role recorded; B is a clean-room flight with a local runner for
the implementer and reviewer, one activation, a different spec hash and no
summarizer record. `compare.expected.txt` and `compare.expected.json` are what
`scripts/compare-flights.mjs` prints for them without and with `--json`; they
were read through once against the rules in `docs/metrics.md` before being kept.
