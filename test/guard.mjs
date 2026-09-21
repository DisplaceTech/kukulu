// The Stop / SubagentStop guard hook. It is the only thing standing between
// "the implementer stopped to report progress" and "the run quietly ended
// half-built", so its jobs — identify the implementer, block while work
// remains, give up eventually — are tested directly rather than through the
// server.

import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  finish, ok, eq, like,
  mkRepo, writeFile, readFile, progressDoc, GUARD,
} from "./harness.mjs";

const TASKS = [
  { id: "P0-01", title: "first", state: "x" },
  { id: "P0-02", title: "second", state: " " },
  { id: "P0-03", title: "third", state: " " },
];

const TRANSCRIPT = (repo) => path.join(repo, "transcript.jsonl");

/** Run the hook with full control over its stdin JSON and environment. */
function guard(repo, { input = {}, projectDir = repo, cap = null } = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  if (projectDir !== null) env.CLAUDE_PROJECT_DIR = projectDir;
  if (cap !== null) env.FOUNDRY_GUARD_CAP = String(cap);
  const payload = input === null ? "" : typeof input === "string" ? input : JSON.stringify(input);
  return execFileSync(process.execPath, [GUARD], { cwd: repo, input: payload, encoding: "utf8", env }).trim();
}

/** A SubagentStop from the implementer — the input shape most tests use. */
const implementerStop = (repo, extra = {}) => ({
  hook_event_name: "SubagentStop",
  agent_type: "foundry-implementer",
  transcript_path: TRANSCRIPT(repo),
  ...extra,
});

/** A Stop whose transcript does (or does not) call foundry_run_start. */
function stopWithTranscript(repo, calledRunStart, extra = {}) {
  writeFile(repo, "transcript.jsonl", calledRunStart ? '{"tool":"foundry_run_start"}\n' : '{"tool":"something_else"}\n');
  return { hook_event_name: "Stop", transcript_path: TRANSCRIPT(repo), ...extra };
}

const armed = (tasks = TASKS, lock = "0\n") => {
  const repo = mkRepo();
  writeFile(repo, "docs/PROGRESS.md", progressDoc(tasks));
  if (lock !== null) writeFile(repo, ".foundry/implement.lock", lock);
  return repo;
};

// ---------------------------------------------------------------- allowing the stop

eq(guard(armed(TASKS, null), { input: implementerStop }), "", "no lock means no run in progress: the stop is allowed");

{
  const repo = mkRepo();
  writeFile(repo, ".foundry/implement.lock", "0\n");
  eq(guard(repo, { input: implementerStop(repo) }), "", "a lock without a PROGRESS.md cannot block anything");
}

eq(
  guard(armed(TASKS.map((t) => ({ ...t, state: "x" }))), { input: implementerStop }),
  "",
  "every task done: the stop is allowed",
);
{
  const repo = armed([{ id: "P0-01", title: "a", state: "!" }, { id: "P0-02", title: "b", state: "-" }]);
  eq(guard(repo, { input: implementerStop(repo) }), "", "blocked and skipped tasks do not hold the run open");
}

// ---------------------------------------------------------------- identifying the implementer

{
  const repo = armed();
  const out = guard(repo, { input: implementerStop(repo) });
  const j = JSON.parse(out);
  eq(j.decision, "block", "a SubagentStop naming foundry-implementer blocks");
  eq(readFile(repo, ".foundry/implement.lock").trim(), "1", "the lock counts the re-block");
}

{
  const repo = armed();
  const j = JSON.parse(guard(repo, { input: implementerStop(repo, { agent_type: "foundry:implementer" }) }));
  eq(j.decision, "block", "the plugin-agent name foundry:implementer also blocks");
}

{
  const repo = armed();
  eq(guard(repo, { input: implementerStop(repo, { agent_type: "Explore" }) }), "", "a SubagentStop from an unrelated agent is allowed outright");
  eq(readFile(repo, ".foundry/implement.lock").trim(), "0", "...and the counter is untouched");
}

{
  const repo = armed();
  writeFile(repo, "transcript.jsonl", '{"tool":"foundry_run_start"}\n');
  const j = JSON.parse(guard(repo, { input: { hook_event_name: "SubagentStop", transcript_path: TRANSCRIPT(repo) } }));
  eq(j.decision, "block", "a SubagentStop with no agent_type falls back to the transcript check");
}

{
  const repo = armed();
  writeFile(repo, "transcript.jsonl", '{"tool":"something_else"}\n');
  eq(
    guard(repo, { input: { hook_event_name: "SubagentStop", transcript_path: TRANSCRIPT(repo) } }),
    "",
    "a SubagentStop with no agent_type and a transcript that never started a run is allowed",
  );
}

{
  const repo = armed();
  const j = JSON.parse(guard(repo, { input: stopWithTranscript(repo, true) }));
  eq(j.decision, "block", "a Stop whose own transcript called foundry_run_start blocks — the implement stage run by hand");
}

{
  const repo = armed();
  eq(guard(repo, { input: stopWithTranscript(repo, false) }), "", "a Stop whose transcript never called foundry_run_start is allowed — a controller merely waiting on a background flight (F-07)");
}

{
  const repo = armed();
  eq(guard(repo, { input: { hook_event_name: "Stop", transcript_path: path.join(repo, "missing.jsonl") } }), "", "a Stop with an unreadable transcript is allowed, not blocked by default");
}

{
  const repo = armed();
  eq(guard(repo, { input: null }), "", "empty stdin is allowed — a guard that cannot identify the stopping party never guesses block");
}

{
  const repo = armed();
  eq(guard(repo, { input: "{not json" }), "", "invalid JSON on stdin is allowed");
}

{
  const repo = armed();
  eq(guard(repo, { input: { hook_event_name: "PreCompact" } }), "", "an unrelated event is allowed");
}

// ---------------------------------------------------------------- the reason and what it names

{
  const repo = armed();
  const j = JSON.parse(guard(repo, { input: implementerStop(repo) }));
  like(j.reason, /2 task\(s\) still open/, "the reason counts what is left");
  like(j.reason, /next: P0-02/, "the reason names the next task");
  like(j.reason, /foundry_task_next/, "the reason says which tool to call");
  like(j.reason, /foundry_run_finish only when/, "the reason says when the run may end");
  guard(repo, { input: implementerStop(repo) });
  eq(readFile(repo, ".foundry/implement.lock").trim(), "2", "each re-block increments the counter");
}

{
  // An in-progress task is the one to resume, even when todo tasks precede it.
  const repo = armed([
    { id: "P0-01", title: "a", state: " " },
    { id: "P0-02", title: "b", state: "~" },
  ]);
  like(JSON.parse(guard(repo, { input: implementerStop(repo) })).reason, /next: P0-02/, "an in-progress task is named ahead of a todo one");
}

{
  // Checkbox lines elsewhere in the file are not tasks.
  const repo = mkRepo();
  writeFile(
    repo,
    "docs/PROGRESS.md",
    "# progress\n\n## Tasks\n- [x] P0-01 done\n\n## Log\n### P0-01 — abc1234\n- [ ] a leftover checkbox in a log entry\n",
  );
  writeFile(repo, ".foundry/implement.lock", "0\n");
  eq(guard(repo, { input: implementerStop(repo) }), "", "a checkbox under ## Log is not an open task");
}

// ---------------------------------------------------------------- lock formats

{
  const repo = armed(TASKS, "");
  like(JSON.parse(guard(repo, { input: implementerStop(repo) })).reason, /still open/, "an empty lock file still blocks");
  eq(readFile(repo, ".foundry/implement.lock").trim(), "1", "an empty lock file restarts the count at one");
}

{
  const repo = armed(TASKS, "not a number\n");
  const out = guard(repo, { input: implementerStop(repo) });
  eq(out.startsWith("{"), true, "a corrupt lock file does not crash the hook");
  eq(readFile(repo, ".foundry/implement.lock").trim(), "1", "a corrupt counter is reset from its digits");
}

{
  const repo = armed(TASKS, '{"count":4,"armedAt":"2026-09-21T00:00:00.000Z","round":0}\n');
  guard(repo, { input: implementerStop(repo) });
  const lock = JSON.parse(readFile(repo, ".foundry/implement.lock"));
  eq(lock.count, 5, "a JSON lock's counter increments");
  eq(lock.round, 0, "...and its other keys are preserved");
  eq(lock.armedAt, "2026-09-21T00:00:00.000Z", "...every one of them");
}

// ---------------------------------------------------------------- giving up

{
  const repo = armed();
  eq(JSON.parse(guard(repo, { input: implementerStop(repo), cap: 2 })).decision, "block", "under the cap, the hook blocks");
  eq(JSON.parse(guard(repo, { input: implementerStop(repo), cap: 2 })).decision, "block", "at the cap, the hook still blocks");
  const over = JSON.parse(guard(repo, { input: implementerStop(repo), cap: 2 }));
  eq(over.decision, undefined, "past the cap, the hook stops blocking");
  like(over.systemMessage, /cap \(2\) reached with 2 open tasks/, "the hook explains why it gave up");
  ok(readFile(repo, ".foundry/implement.lock").includes("3"), "the lock keeps counting past the cap");
}

// ---------------------------------------------------------------- environment

{
  const repo = armed();
  like(JSON.parse(guard(repo, { input: implementerStop(repo), projectDir: null })).reason, /still open/, "with no CLAUDE_PROJECT_DIR the hook falls back to the working directory");
}

{
  const repo = armed();
  const elsewhere = mkRepo();
  eq(guard(repo, { input: implementerStop(repo), projectDir: elsewhere }), "", "the hook reads CLAUDE_PROJECT_DIR, not the directory it was run from");
  like(JSON.parse(guard(elsewhere, { input: implementerStop(elsewhere), projectDir: repo })).reason, /still open/, "...and so finds the run even when invoked from elsewhere");
}

{
  const repo = armed();
  const input = { hook_event_name: "SubagentStop", agent_type: "foundry-implementer", cwd: repo };
  const j = JSON.parse(guard(repo, { input, projectDir: null }));
  eq(j.decision, "block", "with no CLAUDE_PROJECT_DIR, the input's own cwd is used next");
}

// ---------------------------------------------------------------- shape

{
  const repo = armed();
  const out = guard(repo, { input: implementerStop(repo) });
  eq(out.split("\n").length, 1, "the hook emits exactly one line of JSON");
  ok(typeof JSON.parse(out) === "object", "that line parses as an object");
}

finish();
