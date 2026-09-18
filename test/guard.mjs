// The Stop / SubagentStop guard hook. It is the only thing standing between
// "the implementer stopped to report progress" and "the run quietly ended
// half-built", so its two jobs — block while work remains, give up eventually —
// are tested directly rather than through the server.

import { execFileSync } from "node:child_process";
import {
  finish, ok, eq, like,
  mkRepo, writeFile, readFile, progressDoc, GUARD,
} from "./harness.mjs";

const TASKS = [
  { id: "P0-01", title: "first", state: "x" },
  { id: "P0-02", title: "second", state: " " },
  { id: "P0-03", title: "third", state: " " },
];

/** Run the hook with full control over its environment. */
function guard(repo, { projectDir = repo, cap = null, cwd = repo } = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  if (projectDir !== null) env.CLAUDE_PROJECT_DIR = projectDir;
  if (cap !== null) env.FOUNDRY_GUARD_CAP = String(cap);
  return execFileSync("/bin/bash", [GUARD], { cwd, encoding: "utf8", env }).trim();
}

const armed = (tasks = TASKS, lock = "0\n") => {
  const repo = mkRepo();
  writeFile(repo, "docs/PROGRESS.md", progressDoc(tasks));
  if (lock !== null) writeFile(repo, ".foundry/implement.lock", lock);
  return repo;
};

// ---------------------------------------------------------------- allowing the stop

eq(guard(armed(TASKS, null)), "", "no lock means no run in progress: the stop is allowed");

{
  const repo = mkRepo();
  writeFile(repo, ".foundry/implement.lock", "0\n");
  eq(guard(repo), "", "a lock without a PROGRESS.md cannot block anything");
}

eq(guard(armed(TASKS.map((t) => ({ ...t, state: "x" })))), "", "every task done: the stop is allowed");
eq(guard(armed([{ id: "P0-01", title: "a", state: "!" }, { id: "P0-02", title: "b", state: "-" }])), "", "blocked and skipped tasks do not hold the run open");

// ---------------------------------------------------------------- blocking the stop

{
  const repo = armed();
  const out = guard(repo);
  const j = JSON.parse(out);
  eq(j.decision, "block", "open tasks block the stop");
  like(j.reason, /2 task\(s\) still open/, "the reason counts what is left");
  like(j.reason, /next: P0-02/, "the reason names the next task");
  like(j.reason, /foundry_task_next/, "the reason says which tool to call");
  like(j.reason, /foundry_run_finish only when/, "the reason says when the run may end");
  eq(readFile(repo, ".foundry/implement.lock").trim(), "1", "the lock counts the re-block");
  guard(repo);
  eq(readFile(repo, ".foundry/implement.lock").trim(), "2", "each re-block increments the counter");
}

{
  // An in-progress task is the one to resume, even when todo tasks precede it.
  const repo = armed([
    { id: "P0-01", title: "a", state: " " },
    { id: "P0-02", title: "b", state: "~" },
  ]);
  like(JSON.parse(guard(repo)).reason, /next: P0-02/, "an in-progress task is named ahead of a todo one");
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
  eq(guard(repo), "", "a checkbox under ## Log is not an open task");
}

{
  const repo = armed(TASKS, "");
  like(JSON.parse(guard(repo)).reason, /still open/, "an empty lock file still blocks");
  eq(readFile(repo, ".foundry/implement.lock").trim(), "1", "an empty lock file restarts the count at one");
}

{
  const repo = armed(TASKS, "not a number\n");
  eq(guard(repo).startsWith("{"), true, "a corrupt lock file does not crash the hook");
  eq(readFile(repo, ".foundry/implement.lock").trim(), "1", "a corrupt counter is reset from its digits");
}

// ---------------------------------------------------------------- giving up

{
  const repo = armed();
  eq(JSON.parse(guard(repo, { cap: 2 })).decision, "block", "under the cap, the hook blocks");
  eq(JSON.parse(guard(repo, { cap: 2 })).decision, "block", "at the cap, the hook still blocks");
  const over = JSON.parse(guard(repo, { cap: 2 }));
  eq(over.decision, undefined, "past the cap, the hook stops blocking");
  like(over.systemMessage, /cap \(2\) reached with 2 open tasks/, "the hook explains why it gave up");
  ok(readFile(repo, ".foundry/implement.lock").includes("3"), "the lock keeps counting past the cap");
}

// ---------------------------------------------------------------- environment

{
  const repo = armed();
  like(JSON.parse(guard(repo, { projectDir: null })).reason, /still open/, "with no CLAUDE_PROJECT_DIR the hook falls back to the working directory");
}

{
  const repo = armed();
  const elsewhere = mkRepo();
  eq(guard(repo, { projectDir: elsewhere }), "", "the hook reads CLAUDE_PROJECT_DIR, not the directory it was run from");
  like(JSON.parse(guard(elsewhere, { projectDir: repo })).reason, /still open/, "...and so finds the run even when invoked from elsewhere");
}

// ---------------------------------------------------------------- shape

{
  const repo = armed();
  const out = guard(repo);
  eq(out.split("\n").length, 1, "the hook emits exactly one line of JSON");
  ok(typeof JSON.parse(out) === "object", "that line parses as an object");
}

finish();
