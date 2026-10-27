// End-to-end: one flight, start to finish, driven over the real stdio
// transport. spec → plan → build (with a blocked task and a skipped dependent)
// → handoff → CHANGES REQUESTED → fix round → APPROVED → summary → done.
//
// The focused suites prove each tool in isolation; this one proves they still
// compose, and that the state on disk after every stage is the state the next
// stage expects to find.

import {
  finish, ok, eq, like, isError,
  specRepo, plannedRepo, withServer, writeFile, readFile, hasFile, subject,
  planDoc, progressDoc, commitTask, runGuard, git, sh, mkFailingGhBin, mkBareRemote,
  cleanroomRepo, addPlan, runHook, testKeyFor, ROOT,
} from "./harness.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEntries, verifyChain, verifyCheckpoint, loadKey } from "../mcp/cleanroom.mjs";

const TASKS = [
  { id: "P0-01", title: "Create hello", goal: "write hello.txt", files: "hello.txt", tests: "test.sh", verification: "./test.sh" },
  { id: "P0-02", title: "Impossible task", goal: "fail", files: "nope.txt", depends: ["P0-01"] },
  { id: "P0-03", title: "Depends on the impossible one", goal: "skip me", files: "x", depends: ["P0-02"] },
];

const repo = specRepo("# Spec\nBuild something small.\n");
const noGh = { env: { PATH: `${mkFailingGhBin()}:${process.env.PATH}` } };
git(repo, ["remote", "add", "origin", mkBareRemote()]);

// An untracked operator file, predating the whole flight, must survive it
// unchanged: not committed, not moved, not deleted (F-09, F-17).
writeFile(repo, "KUKULU_FEEDBACK.md", "pipeline feedback notes, unrelated to this build\n");

await withServer(repo, async ({ call }) => {
  // ---------------------------------------------------------------- routing

  const sync = await call("kukulu_agents_sync");
  eq(sync.changed.length, 4, "the flight starts by generating all four role agents");
  eq(sync.exclude, "added", "the exclude pattern is added before any run starts");

  // ---------------------------------------------------------------- plan

  let n = await call("kukulu_next");
  eq(n.stage, "plan", "a repo with only a spec needs a plan");
  // This is the project's first flight: the sync above created the agents
  // directory, which loads only in the next session, so every stage names
  // the plugin's own agent outright (cleanflate F-22). The fresh-process
  // block below covers the generated names.
  eq(n.agent, "kukulu:planner", "the plugin planner agent is named on a first flight");
  ok(n.model, "a resolved model is reported for the plan stage");

  writeFile(repo, "docs/PLAN.md", planDoc(TASKS));
  writeFile(repo, "docs/PROGRESS.md", progressDoc(TASKS));
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ verify: ["test -f hello.txt"], extraVerify: { "src/": ["echo extra"] }, maxRounds: 2 }, null, 2) + "\n");
  writeFile(repo, "CLAUDE.md", "# rules\n## Constraints\n- greet in lowercase\n");
  // The plan-build skill commits exactly its four deliverables, never a
  // blanket `-A` — which would otherwise sweep up the untracked operator
  // file seeded above.
  git(repo, ["add", "--", "docs/PLAN.md", "docs/PROGRESS.md", "docs/kukulu.json", "CLAUDE.md"]);
  git(repo, ["commit", "-qm", "plan: derive build plan from SPEC"]);

  n = await call("kukulu_next");
  eq(n.stage, "implement", "a plan on disk means it is time to build");
  eq(n.round, 0, "the first build is round 0");
  eq(n.agent, "kukulu:implementer", "the plugin implementer agent is named");
  ok(n.model, "a resolved model is reported for the implement stage");

  // ---------------------------------------------------------------- build

  let r = await call("kukulu_run_start");
  like(r.branch, /^build\/\d{4}-\d\d-\d\d/, `the run gets its own branch (${r.branch})`);
  ok(hasFile(repo, ".kukulu/implement.lock"), "the Stop-hook lock is armed for the whole run");

  let t = await call("kukulu_task_next");
  eq(t.id, "P0-01", "the first task comes off the top of the plan");

  let v = await call("kukulu_verify", { files: ["hello.txt"] });
  eq(v.ok, false, "verification fails before the work is done");

  isError(await call("kukulu_task_done", { id: "P0-01", log: "x" }), /HEAD commit/, "a task cannot be marked done without its commit");

  commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
  v = await call("kukulu_verify", { files: ["hello.txt", "src/a.js"] });
  eq(v.ok, true, "verification passes once the work is committed");
  eq(v.results[1].command, "echo extra", "a touched path prefix pulls in its extra verification");

  r = await call("kukulu_task_done", { id: "P0-01", log: "Added hello.txt.\nInterpretation: greeting is lowercase." });
  eq(r.counts.done, 1, "the first task is recorded as done");

  t = await call("kukulu_task_next");
  eq(t.id, "P0-02", "the loop moves on");
  like(t.dependencyLogs["P0-01"], /greeting is lowercase/, "the next task inherits what the last one learned");

  writeFile(repo, "junk.txt", "half-finished\n");
  r = await call("kukulu_task_block", { id: "P0-02", reason: "tried A / fails B / fix C" });
  ok(!hasFile(repo, "junk.txt"), "blocking a task throws away its debris");
  ok(hasFile(repo, ".kukulu/implement.lock"), "blocking a task does not end the run");

  t = await call("kukulu_task_next");
  eq(t.done, true, "no work is left");
  eq(t.skipped[0].id, "P0-03", "the dependent of a blocked task is skipped, not attempted");
  eq(t.counts.open, 0, "nothing is open");

  // ---------------------------------------------------------------- the guard

  eq(runGuard(repo), "", "with nothing open, the guard lets the implementer stop");
  writeFile(repo, "docs/PROGRESS.md", readFile(repo, "docs/PROGRESS.md").replace("- [-] P0-03", "- [ ] P0-03"));
  like(JSON.parse(runGuard(repo)).reason, /P0-03/, "with a task reopened, the guard pushes it back into the loop");
  git(repo, ["checkout", "-q", "--", "docs/PROGRESS.md"]);

  // ---------------------------------------------------------------- handoff

  isError(await call("kukulu_run_finish"), /HANDOFF/, "the run cannot end without a handoff");
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n## Round 0\nP0-02 blocked, P0-03 skipped.\n");
  r = await call("kukulu_run_finish");
  like(r.readyLine, /^READY FOR REVIEW/, r.readyLine);
  ok(!hasFile(repo, ".kukulu/implement.lock"), "the lock is disarmed at the handoff");
  eq(runGuard(repo), "", "and the guard stands down");

  n = await call("kukulu_next");
  eq(n.stage, "review", "a handoff means it is the reviewer's turn");
  eq(n.agent, "kukulu:reviewer", "the plugin reviewer agent is named");
  ok(n.model, "a resolved model is reported for the review stage");

  // ---------------------------------------------------------------- review

  writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 1\n**Verdict**: CHANGES REQUESTED\n");
  r = await call("kukulu_review_submit", {
    verdict: "CHANGES REQUESTED",
    tasks: [{
      title: "Fix hello", goal: "hello must actually greet", files: ["hello.txt"],
      constraints: "lowercase only", tests: "test.sh", outOfScope: "none", verification: "cat hello.txt", dependsOn: [], source: "review",
    }],
    unblock: [{ id: "P0-02", reason: "reviewer clarified the interface" }],
  });
  eq(r.fixTasks.join(","), "R1-01", "the finding becomes a task with an id");
  eq(r.unblocked.join(","), "P0-02", "the reviewer reopens the blocked task");
  eq(r.reopenedDependents.join(","), "P0-03", "...and the task skipped because of it");
  eq(subject(repo), "review: round 1", "the round is one commit");
  like(readFile(repo, "docs/PLAN.md"), /## Review fixes \(round 1\)\n\n### R1-01: Fix hello/, "the fix task is written into the plan");
  like(readFile(repo, "docs/PROGRESS.md"), /- \[ \] R1-01 Fix hello\n\n## Log/, "and onto the end of the task list");

  n = await call("kukulu_next");
  eq(n.stage, "implement", "changes requested sends the flight back to the implementer");
  eq(n.round, 1, "on round 1");
  eq(n.agent, "kukulu:implementer", "still the plugin implementer agent, on the fix round");

  // ---------------------------------------------------------------- fix round

  r = await call("kukulu_run_start");
  eq(subject(repo), "chore: start review-fix round 1", "the fix round announces itself");

  t = await call("kukulu_task_next");
  eq(t.id, "P0-02", "the unblocked task is first in line");
  commitTask(repo, "P0-02", "Impossible task", { "nope.txt": "possible after all\n" });
  await call("kukulu_task_done", { id: "P0-02", log: "Turned out to be possible." });

  t = await call("kukulu_task_next");
  eq(t.id, "P0-03", "then its reopened dependent");
  commitTask(repo, "P0-03", "Depends on the impossible one", { "x": "x\n" });
  await call("kukulu_task_done", { id: "P0-03", log: "Ran once its dependency landed." });

  t = await call("kukulu_task_next");
  eq(t.id, "R1-01", "then the reviewer's fix task");
  like(t.text, /hello must actually greet/, "which reads back exactly as the reviewer wrote it");
  commitTask(repo, "R1-01", "Fix hello", { "hello.txt": "hello\n" });
  await call("kukulu_task_done", { id: "R1-01", log: "hello.txt now greets." });

  eq((await call("kukulu_task_next")).done, true, "the fix round is complete");
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n## Round 1\nAll three tasks landed.\n");
  r = await call("kukulu_run_finish");
  eq(r.round, 1, "the handoff belongs to round 1");

  // ---------------------------------------------------------------- approval

  n = await call("kukulu_next");
  eq(n.stage, "review", "round 1 goes back for review");
  eq(n.agent, "kukulu:reviewer", "still the plugin reviewer agent, on round 1");

  writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 2\n**Verdict**: APPROVED\n");
  isError(await call("kukulu_summary_commit"), /docs\/SUMMARY\.md does not exist/, "there is no summary to commit yet");
  r = await call("kukulu_review_submit", { verdict: "APPROVED" });
  eq(r.round, 2, "the approval reports round 2, the number REVIEW.md carries");
  eq(subject(repo), "review: round 2 approved", "the approval is committed");

  n = await call("kukulu_next");
  eq(n.stage, "summarize", "an approved branch needs its summary");
  eq(n.agent, "kukulu:summarizer", "the plugin summarizer agent is named");
  ok(n.model, "a resolved model is reported for the summarize stage");

  writeFile(repo, "docs/SUMMARY.md", "# summary\nMerge build/... into main.\n");
  r = await call("kukulu_summary_commit");
  eq(r.reviews, 2, "the flight took two reviews");
  eq(r.fixRounds, 1, "...and one fix round between them");

  n = await call("kukulu_next");
  eq(n.stage, "done", "and the flight is done");
  eq(n.agent, null, "done still has no agent to delegate to");
  like(n.reason, /ready for a human to merge/, n.reason);
  like(n.reason, /after 2 reviews \(1 fix round\)/, "done counts reviews, not fix rounds (cleanflate F-21)");

  // ---------------------------------------------------------------- the record

  // kukulu_agents_sync never commits anything (the generated files are
  // excluded via .git/info/exclude, not tracked), so the branch's commit
  // history is exactly what it would have been without routing at all.
  // The only untracked thing left standing is the operator file the flight
  // found sitting there before it started (F-09, F-17).
  eq(git(repo, ["status", "--porcelain"]), "?? KUKULU_FEEDBACK.md", "the branch is clean apart from the pre-existing operator file");
  eq(readFile(repo, "KUKULU_FEEDBACK.md"), "pipeline feedback notes, unrelated to this build\n", "...which the whole flight left byte-for-byte untouched");
  const log = sh(repo, "git log --oneline --format=%s");
  for (const expected of [
    "chore: build summary", "review: round 2 approved", "chore: round 1 implemented",
    "chore: handoff for review", "R1-01: Fix hello", "P0-02: Impossible task",
    "review: round 1", "P0-01: Create hello", "plan: derive build plan from SPEC",
  ]) {
    ok(log.includes(expected), `the history records "${expected}"`);
  }
  ok(!log.includes("KUKULU_FEEDBACK"), "the operator file is never mentioned in a commit");
  eq(readFile(repo, "hello.txt"), "hello\n", "and the working tree holds the reviewed result");

  // Every push-worthy commit actually reached the remote (F-18): the base
  // branch (pushed by run_start before the build branch was cut) and the
  // build branch (pushed after every review_submit and summary_commit).
  eq(git(repo, ["rev-parse", "origin/main"]), git(repo, ["rev-parse", "main"]), "the remote's base branch carries the plan commits");
  // The controller's last kukulu_next closes the final stage span with a local `chore: stage end` commit nobody pushes.
  const lastPushed = git(repo, ["log", "--format=%H %s", "-10"]).split("\n").find((l) => !/^\w+ chore: stage /.test(l)).split(" ")[0];
  eq(git(repo, ["rev-parse", `origin/${r.branch}`]), lastPushed, "the remote build branch head matches the local head (ignoring the timeline's own commits)");
}, noGh);

// A fresh server process trusts an agents directory that already existed
// before it started, even though this process never called agents_sync
// itself: only the directory's *first* population needs a session restart.
{
  const fresh = plannedRepo();
  await withServer(fresh, async ({ call }) => {
    await call("kukulu_agents_sync");
  });
  await withServer(fresh, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.agentFallback, false, "a fresh process against an already-synced repo trusts the generated agent immediately");
    eq(n.agent, "kukulu-implementer", "...and names it directly");
  });
}

// ---------------------------------------------------------------- parallel flights (0.4.0)
//
// The same loop go-flight runs, driven by hand: kukulu_next, then a simulated
// implementer per result. Stream implementers are simulated by calling the
// stream-scoped tools *interleaved* across streams (a's next, b's next, a's
// commit, b's commit …), not one stream to completion before the other, so
// the run exercises the server's one-call-at-a-time guarantee rather than
// assuming sequential streams. Nothing here asserts timing.

const W = (id, files, extra = {}) => ({ id, title: `Task ${id}`, goal: `do ${id}`, files: files.map((x) => `\`${x}\``).join(", "), ...extra });

/** The file a simulated implementer writes for a task: the first backticked path in Files touched (a directory gets `<id>.txt`). */
const fileFor = (t) => {
  const p = (t.files.match(/`([^`]+)`/) || [])[1] || `work/${t.id}.txt`;
  return p.endsWith("/") ? `${p}${t.id}.txt` : p;
};

/** A serial implementer: run_start, work until done. Returns "paused" at a wave boundary, else finishes the run. */
async function serialImplementer(call, repo) {
  await call("kukulu_run_start");
  for (;;) {
    const t = await call("kukulu_task_next");
    if (t.done) {
      if (t.paused) return "paused";
      break;
    }
    commitTask(repo, t.id, t.title, { [fileFor(t)]: `${t.id}\n` });
    await call("kukulu_task_done", { id: t.id, log: `did ${t.id}` });
  }
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
  await call("kukulu_run_finish");
  return "finished";
}

/** Stream implementers, interleaved one call at a time. Returns any conflict a finish reported. */
async function streamImplementers(call, names) {
  const st = Object.fromEntries(names.map((n) => [n, { phase: "start" }]));
  let conflict = null;
  while (Object.values(st).some((x) => x.phase !== "finished")) {
    for (const [name, x] of Object.entries(st)) {
      if (x.phase === "start") {
        x.cwd = (await call("kukulu_run_start", { stream: name })).cwd;
        x.phase = "next";
      } else if (x.phase === "next") {
        const t = await call("kukulu_task_next", { stream: name });
        if (t.done) x.phase = "finish";
        else {
          commitTask(x.cwd, t.id, t.title, { [fileFor(t)]: `${t.id}\n` });
          x.pending = t.id;
          x.phase = "record";
        }
      } else if (x.phase === "record") {
        await call("kukulu_task_done", { stream: name, id: x.pending, log: `did ${x.pending}` });
        x.phase = "next";
      } else if (x.phase === "finish") {
        const f = await call("kukulu_stream_finish", { stream: name });
        if (!f.merged) conflict = f;
        x.phase = "finished";
      }
    }
  }
  return conflict;
}

/** go-flight's loop. Returns the sequence of stages it walked, with the streams of each wave. */
async function fly(call, repo) {
  const events = [];
  for (let i = 0; i < 12; i++) {
    const n = await call("kukulu_next");
    events.push(n.streams ? `${n.stage}[${n.streams.map((x) => x.stream).join("+")}]` : n.stage);
    if (n.stage === "done" || n.stage === "halt") return events;
    if (n.stage === "implement") {
      if (n.streams) {
        const conflict = await streamImplementers(call, n.streams.map((x) => x.stream));
        if (conflict) return [...events, "conflict"];
      } else await serialImplementer(call, repo);
    } else if (n.stage === "review") {
      writeFile(repo, "docs/REVIEW.md", `# Review\nRound: ${n.reviewRound}\n**Verdict**: APPROVED\n`);
      await call("kukulu_review_submit", { verdict: "APPROVED" });
    } else if (n.stage === "summarize") {
      writeFile(repo, "docs/SUMMARY.md", "# summary\n");
      await call("kukulu_summary_commit");
    }
  }
  throw new Error(`the flight did not finish: ${events.join(" → ")}`);
}

const feedbackLines = (repo) => (hasFile(repo, ".kukulu/feedback.jsonl") ? readFile(repo, ".kukulu/feedback.jsonl").trim().split("\n").map((l) => JSON.parse(l)) : []);
const flightRepo = (tasks, config = {}) => {
  const repo = plannedRepo({ tasks, config: { verify: ["true"], policies: { pr: "none", push: false }, ...config } });
  writeFile(repo, "OPERATOR_NOTES.md", "predates the flight\n"); // untracked, must survive
  return repo;
};

const PARALLEL_PLAN = [
  W("P0-01", ["package.json"]),
  W("P0-02", ["docs/"]),
  W("P1-01", ["src/api/a.txt"], { stream: "api" }),
  W("P1-02", ["src/api/b.txt"], { stream: "api", depends: ["P1-01"] }),
  W("P1-03", ["src/ui/a.txt"], { stream: "ui" }),
  W("P1-04", ["src/ui/b.txt"], { stream: "ui" }),
  W("P2-01", ["README.md"]),
];
const ALL_IDS = PARALLEL_PLAN.map((t) => t.id);

// The whole flight, with a real wave.
{
  const repo = flightRepo(PARALLEL_PLAN);
  await withServer(repo, async ({ call }) => {
    const events = await fly(call, repo);
    eq(events.join(" → "), "implement → implement[api+ui] → implement → review → summarize → done", "serial, then the wave's two streams, then serial again, then review, summary, done");

    const prog = readFile(repo, "docs/PROGRESS.md");
    for (const id of ALL_IDS) {
      eq((prog.match(new RegExp(`^- \\[x\\] ${id} `, "m")) || []).length, 1, `${id} is done exactly once in PROGRESS.md`);
      eq((prog.match(new RegExp(`^### ${id} — `, "gm")) || []).length, 1, `${id} has exactly one log entry`);
    }
    const history = git(repo, ["log", "--format=%s"]);
    for (const id of ALL_IDS) like(history, new RegExp(`^${id}: Task ${id}$`, "m"), `${id}'s commit is on the build branch`);
    eq(history.split("\n").filter((l) => l.startsWith("merge stream ")).sort().join("|"), "merge stream api (wave 1)|merge stream ui (wave 1)", "one merge commit per stream");
    eq(git(repo, ["worktree", "list"]).split("\n").length, 1, "no worktrees are left");
    eq(git(repo, ["branch", "--list", "*--*"]), "", "no stream branches are left");
    for (const p of ["src/api/a.txt", "src/api/b.txt", "src/ui/a.txt", "src/ui/b.txt", "README.md"]) ok(hasFile(repo, p), `${p} is in the final tree`);
    eq(git(repo, ["status", "--porcelain"]), "?? OPERATOR_NOTES.md", "the tree is clean apart from the operator's pre-existing file");
    eq(readFile(repo, "OPERATOR_NOTES.md"), "predates the flight\n", "which the whole flight left untouched");
    eq(feedbackLines(repo).length, 0, "a healthy parallel flight logs no friction");
    eq(runGuard(repo), "", "and the guard has nothing to say");
  });
}

// maxStreams 1: the same plan, serially, with no merges.
{
  const repo = flightRepo(PARALLEL_PLAN, { parallel: { maxStreams: 1 } });
  await withServer(repo, async ({ call }) => {
    const events = await fly(call, repo);
    eq(events.join(" → "), "implement → review → summarize → done", "with maxStreams 1 one serial implementer does the whole plan");
    const history = git(repo, ["log", "--format=%s"]);
    eq(history.split("\n").filter((l) => l.startsWith("merge stream ")).length, 0, "and there are no merge commits");
    for (const id of ALL_IDS) like(readFile(repo, "docs/PROGRESS.md"), new RegExp(`^- \\[x\\] ${id} `, "m"), `${id} is done`);
    eq(feedbackLines(repo).length, 0, "nothing is logged: it was the operator's choice");
  });
}

// A deliberately overlapping partition degrades to serial, and says so once.
{
  const overlapping = PARALLEL_PLAN.map((t) => (t.id === "P1-03" ? W("P1-03", ["src/api/a.txt"], { stream: "ui" }) : t));
  const repo = flightRepo(overlapping);
  await withServer(repo, async ({ call }) => {
    const events = await fly(call, repo);
    eq(events.join(" → "), "implement → review → summarize → done", "an invalid wave is worked serially by one implementer");
    const fb = feedbackLines(repo);
    eq(fb.length, 1, "exactly one feedback entry");
    eq(fb[0].category, "stream-partition", "of category stream-partition");
    like(fb[0].message, /P1-01 \(stream api\) and P1-03 \(stream ui\) both touch `src\/api\/a\.txt`/, "naming the conflict");
    eq(git(repo, ["log", "--format=%s"]).split("\n").filter((l) => l === "chore: wave 1 runs serially").length, 1, "and one commit recording it");
    for (const id of ALL_IDS) like(readFile(repo, "docs/PROGRESS.md"), new RegExp(`^- \\[x\\] ${id} `, "m"), `${id} is done`);
  });
}

// A plan that ENDS with a wave: the flight still finishes through the handoff.
{
  const repo = flightRepo(PARALLEL_PLAN.slice(0, 6));
  await withServer(repo, async ({ call }) => {
    const events = await fly(call, repo);
    eq(events.join(" → "), "implement → implement[api+ui] → implement → review → summarize → done", "a trailing wave is followed by a serial implementer that writes the handoff");
    like(readFile(repo, "docs/PROGRESS.md"), /^- \[x\] P1-04 /m, "every wave task is done");
  });
}

// Review of PR #6: a review-fix round that unblocks a task inside a stream.
// The task keeps its {stream} tag, so the round re-opens that wave for just
// the unblocked stream; the reviewer's own R-tasks stay serial after it.
{
  const repo = flightRepo(PARALLEL_PLAN);
  await withServer(repo, async ({ call }) => {
    // Round 0 by hand: serial, then the wave with api's first task blocked (its dependent skipped), then serial.
    await serialImplementer(call, repo);
    const a = await call("kukulu_run_start", { stream: "api" });
    await call("kukulu_task_next", { stream: "api" });
    await call("kukulu_task_block", { stream: "api", id: "P1-01", reason: "needs an API that looks missing" });
    eq((await call("kukulu_task_next", { stream: "api" })).skipped.map((x) => x.id).join(","), "P1-02", "api's dependent is skipped");
    await call("kukulu_stream_finish", { stream: "api" });
    await streamImplementers(call, ["ui"]);
    eq(await serialImplementer(call, repo), "finished", "round 0 finishes");
    void a;

    writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 1\n**Verdict**: CHANGES REQUESTED\n");
    await call("kukulu_review_submit", {
      verdict: "CHANGES REQUESTED",
      tasks: [{ title: "Tidy readme", goal: "tidy", files: ["README.md"], tests: "none", dependsOn: [], source: "review" }],
      unblock: [{ id: "P1-01", reason: "the API exists" }, { id: "P1-02", reason: "follows P1-01" }],
    });
    like(readFile(repo, "docs/PROGRESS.md"), /- \[ \] P1-01 Task P1-01 \{stream: api\}/, "the unblocked task keeps its stream tag");

    const events = await fly(call, repo);
    eq(events.join(" → "), "implement[api] → implement → review → summarize → done", "the fix round runs the unblocked stream alone, then the serial R-task, then finishes");
    const prog = readFile(repo, "docs/PROGRESS.md");
    for (const id of [...ALL_IDS, "R1-01"]) like(prog, new RegExp(`^- \\[x\\] ${id} `, "m"), `${id} ends done`);
    eq(git(repo, ["worktree", "list"]).split("\n").length, 1, "no worktree is left behind");
  });
}

// ---------------------------------------------------------------- a clean-room flight

{
  // The hooks run as Claude Code runs them: a PreToolUse payload to the guard (exit 2 means the call is not made),
  // then a PostToolUse payload to the logger, with CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT in the environment.
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "cleanroom.example.json"), "utf8"));
  policy.lockdown.after = "P0-01";
  const repo = cleanroomRepo({ policy: JSON.stringify(policy, null, 2) });
  const env = { CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT };
  const GUARD = path.join(ROOT, "scripts", "cleanroom-guard.mjs");
  const LOGGER = path.join(ROOT, "scripts", "cleanroom-log.mjs");
  const session = { session_id: "drive-1", model: "claude-test" };
  const sim = (tool_name, tool_input, run = () => null) => {
    const pre = runHook(GUARD, { hook_event_name: "PreToolUse", tool_name, tool_input, cwd: repo, ...session }, env);
    if (pre.status === 2) return { denied: true, stderr: pre.stderr };
    const value = run();
    runHook(LOGGER, { hook_event_name: "PostToolUse", tool_name, tool_input, cwd: repo, ...session }, env);
    return { denied: false, value };
  };
  const mcp = async (call, name, args = {}) => {
    const tool = `mcp__plugin_kukulu_kukulu__${name}`;
    const out = sim(tool, args, () => null);
    if (out.denied) throw new Error(`the guard denied ${tool}: ${out.stderr}`);
    return call(name, args);
  };
  const prompt = (text) => runHook(LOGGER, { hook_event_name: "UserPromptSubmit", prompt: text, cwd: repo, ...session }, env);
  const tasks = [
    { id: "P0-01", title: "Create hello", goal: "write hello.txt", files: "hello.txt" },
    { id: "P0-02", title: "Create world", goal: "write world.txt", files: "world.txt", depends: ["P0-01"] },
  ];

  await withServer(repo, async ({ call }) => {
    const first = await mcp(call, "kukulu_next");
    eq(first.stage + "|" + first.gate.ok, "plan|true", "the first kukulu_next in a clean-room project writes genesis and passes the gate");
    prompt("Build it, and do not look anything up.");
    addPlan(repo, { tasks, config: { flight: "w1" } });
    const next = await mcp(call, "kukulu_next");
    eq(next.stage + "|" + next.gate.ok, "implement|true", "the plan stage gives way to implement");
    await mcp(call, "kukulu_run_start");
    for (const t of tasks) {
      await mcp(call, "kukulu_task_next");
      const file = t.files;
      sim("Write", { file_path: path.join(repo, file), content: "x\n" }, () => fs.writeFileSync(path.join(repo, file), "x\n"));
      sim("Bash", { command: `cat ${file}` });
      if (t.id === "P0-01") {
        const denied = sim("Read", { file_path: path.join(os.homedir(), ".cargo", "registry", "src", "index", "x.rs") });
        ok(denied.denied && /deny\.paths/.test(denied.stderr), "a Read under deny.paths is denied by the guard in the flight");
      }
      commitTask(repo, t.id, t.title, { [file]: "x\n" });
      const done = await mcp(call, "kukulu_task_done", { id: t.id, log: `wrote ${file}` });
      eq(done.counts.done >= 1, true, `${t.id} is done`);
    }
    sim("Write", { file_path: path.join(repo, "docs", "HANDOFF.md"), content: "# Handoff\n" }, () => fs.writeFileSync(path.join(repo, "docs", "HANDOFF.md"), "# Handoff\n"));
    await mcp(call, "kukulu_run_finish");
    sim("Write", { file_path: path.join(repo, "docs", "REVIEW.md"), content: "r" }, () => fs.writeFileSync(path.join(repo, "docs", "REVIEW.md"), "# Review\nRound: 1\n**Verdict**: APPROVED\n"));
    await mcp(call, "kukulu_review_submit", { verdict: "APPROVED" });
    await mcp(call, "kukulu_summary_commit", { content: "# Summary\nDone.\n" });
    const end = await mcp(call, "kukulu_next");
    eq(end.stage, "done", "the clean-room flight runs to done");
    ok(end.gate.ok, "...passing the gate at the end");
  });

  const logPath = path.join(repo, ".kukulu", "cleanroom", "log.jsonl");
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  const chain = verifyChain(lines);
  eq(chain.ok, true, "a clean-room flight's chain verifies end to end");
  const kinds = new Set(chain.entries.map((e) => e.kind));
  eq(["genesis", "gate", "allowed", "denied", "checkpoint", "human"].every((k) => kinds.has(k)), true, "...holds genesis, gate, allowed, denied, checkpoint and human entries");
  eq(chain.entries[0].kind, "genesis", "...starting with the genesis entry");
  const publicKey = loadKey(testKeyFor(repo)).publicKey;
  const cps = chain.entries.filter((e) => e.kind === "checkpoint");
  eq(cps.length >= 6 && cps.every((e) => verifyCheckpoint(e, publicKey)), true, `...every checkpoint verifies (${cps.length})`);
  const serverSubjects = /^(chore|progress|review):/;
  const commits = git(repo, ["log", "--reverse", "--format=%H%x09%s"]).split("\n").map((l) => l.split("\t")).filter(([, subj]) => serverSubjects.test(subj) && subj !== "chore: clean-room policy");
  const trailer = (sha, key) => git(repo, ["log", "-1", `--format=%(trailers:key=${key},valueonly)`, sha]).trim();
  const bare = commits.filter(([sha]) => !trailer(sha, "Kukulu-Stage") || !trailer(sha, "Kukulu-Task"));
  eq(bare.map(([, subj]) => subj).join(" | "), "", `...every server commit carries the trailers (${commits.length} commits)`);
  eq(chain.entries.filter((e) => e.kind === "human")[0].target, "Build it, and do not look anything up.", "...and the prompt is in the chain");
  eq(readEntries(logPath).length, chain.entries.length, "...as is every entry the hooks wrote");
}

finish();
