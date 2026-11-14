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
