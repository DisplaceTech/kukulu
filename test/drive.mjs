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
} from "./harness.mjs";

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
writeFile(repo, "FOUNDRY_FEEDBACK.md", "pipeline feedback notes, unrelated to this build\n");

await withServer(repo, async ({ call }) => {
  // ---------------------------------------------------------------- routing

  const sync = await call("foundry_agents_sync");
  eq(sync.changed.length, 4, "the flight starts by generating all four role agents");
  eq(sync.exclude, "added", "the exclude pattern is added before any run starts");

  // ---------------------------------------------------------------- plan

  let n = await call("foundry_next");
  eq(n.stage, "plan", "a repo with only a spec needs a plan");
  eq(n.agent, "foundry-planner", "the generated planner agent is named");
  ok(n.model, "a resolved model is reported for the plan stage");

  writeFile(repo, "docs/PLAN.md", planDoc(TASKS));
  writeFile(repo, "docs/PROGRESS.md", progressDoc(TASKS));
  writeFile(repo, "docs/foundry.json", JSON.stringify({ verify: ["test -f hello.txt"], extraVerify: { "src/": ["echo extra"] }, maxRounds: 2 }, null, 2) + "\n");
  writeFile(repo, "CLAUDE.md", "# rules\n## Constraints\n- greet in lowercase\n");
  // The plan-build skill commits exactly its four deliverables, never a
  // blanket `-A` — which would otherwise sweep up the untracked operator
  // file seeded above.
  git(repo, ["add", "--", "docs/PLAN.md", "docs/PROGRESS.md", "docs/foundry.json", "CLAUDE.md"]);
  git(repo, ["commit", "-qm", "plan: derive build plan from SPEC"]);

  n = await call("foundry_next");
  eq(n.stage, "implement", "a plan on disk means it is time to build");
  eq(n.round, 0, "the first build is round 0");
  eq(n.agent, "foundry-implementer", "the generated implementer agent is named");
  ok(n.model, "a resolved model is reported for the implement stage");

  // ---------------------------------------------------------------- build

  let r = await call("foundry_run_start");
  like(r.branch, /^build\/\d{4}-\d\d-\d\d/, `the run gets its own branch (${r.branch})`);
  ok(hasFile(repo, ".foundry/implement.lock"), "the Stop-hook lock is armed for the whole run");

  let t = await call("foundry_task_next");
  eq(t.id, "P0-01", "the first task comes off the top of the plan");

  let v = await call("foundry_verify", { files: ["hello.txt"] });
  eq(v.ok, false, "verification fails before the work is done");

  isError(await call("foundry_task_done", { id: "P0-01", log: "x" }), /HEAD commit/, "a task cannot be marked done without its commit");

  commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
  v = await call("foundry_verify", { files: ["hello.txt", "src/a.js"] });
  eq(v.ok, true, "verification passes once the work is committed");
  eq(v.results[1].command, "echo extra", "a touched path prefix pulls in its extra verification");

  r = await call("foundry_task_done", { id: "P0-01", log: "Added hello.txt.\nInterpretation: greeting is lowercase." });
  eq(r.counts.done, 1, "the first task is recorded as done");

  t = await call("foundry_task_next");
  eq(t.id, "P0-02", "the loop moves on");
  like(t.dependencyLogs["P0-01"], /greeting is lowercase/, "the next task inherits what the last one learned");

  writeFile(repo, "junk.txt", "half-finished\n");
  r = await call("foundry_task_block", { id: "P0-02", reason: "tried A / fails B / fix C" });
  ok(!hasFile(repo, "junk.txt"), "blocking a task throws away its debris");
  ok(hasFile(repo, ".foundry/implement.lock"), "blocking a task does not end the run");

  t = await call("foundry_task_next");
  eq(t.done, true, "no work is left");
  eq(t.skipped[0].id, "P0-03", "the dependent of a blocked task is skipped, not attempted");
  eq(t.counts.open, 0, "nothing is open");

  // ---------------------------------------------------------------- the guard

  eq(runGuard(repo), "", "with nothing open, the guard lets the implementer stop");
  writeFile(repo, "docs/PROGRESS.md", readFile(repo, "docs/PROGRESS.md").replace("- [-] P0-03", "- [ ] P0-03"));
  like(JSON.parse(runGuard(repo)).reason, /P0-03/, "with a task reopened, the guard pushes it back into the loop");
  git(repo, ["checkout", "-q", "--", "docs/PROGRESS.md"]);

  // ---------------------------------------------------------------- handoff

  isError(await call("foundry_run_finish"), /HANDOFF/, "the run cannot end without a handoff");
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n## Round 0\nP0-02 blocked, P0-03 skipped.\n");
  r = await call("foundry_run_finish");
  like(r.readyLine, /^READY FOR REVIEW/, r.readyLine);
  ok(!hasFile(repo, ".foundry/implement.lock"), "the lock is disarmed at the handoff");
  eq(runGuard(repo), "", "and the guard stands down");

  n = await call("foundry_next");
  eq(n.stage, "review", "a handoff means it is the reviewer's turn");
  eq(n.agent, "foundry-reviewer", "the generated reviewer agent is named");
  ok(n.model, "a resolved model is reported for the review stage");

  // ---------------------------------------------------------------- review

  writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 0\n**Verdict**: CHANGES REQUESTED\n");
  r = await call("foundry_review_submit", {
    verdict: "CHANGES REQUESTED",
    tasks: [{
      title: "Fix hello", goal: "hello must actually greet", files: ["hello.txt"],
      constraints: "lowercase only", tests: "test.sh", outOfScope: "none", verification: "cat hello.txt", dependsOn: [],
    }],
    unblock: [{ id: "P0-02", reason: "reviewer clarified the interface" }],
  });
  eq(r.fixTasks.join(","), "R1-01", "the finding becomes a task with an id");
  eq(r.unblocked.join(","), "P0-02", "the reviewer reopens the blocked task");
  eq(subject(repo), "review: round 1", "the round is one commit");
  like(readFile(repo, "docs/PLAN.md"), /## Review fixes \(round 1\)\n\n### R1-01: Fix hello/, "the fix task is written into the plan");
  like(readFile(repo, "docs/PROGRESS.md"), /- \[ \] R1-01 Fix hello\n\n## Log/, "and onto the end of the task list");

  n = await call("foundry_next");
  eq(n.stage, "implement", "changes requested sends the flight back to the implementer");
  eq(n.round, 1, "on round 1");
  eq(n.agent, "foundry-implementer", "still the generated implementer agent, on the fix round");

  // ---------------------------------------------------------------- fix round

  r = await call("foundry_run_start");
  eq(subject(repo), "chore: start review-fix round 1", "the fix round announces itself");

  t = await call("foundry_task_next");
  eq(t.id, "P0-02", "the unblocked task is first in line");
  commitTask(repo, "P0-02", "Impossible task", { "nope.txt": "possible after all\n" });
  await call("foundry_task_done", { id: "P0-02", log: "Turned out to be possible." });

  t = await call("foundry_task_next");
  eq(t.id, "R1-01", "then the reviewer's fix task");
  like(t.text, /hello must actually greet/, "which reads back exactly as the reviewer wrote it");
  commitTask(repo, "R1-01", "Fix hello", { "hello.txt": "hello\n" });
  await call("foundry_task_done", { id: "R1-01", log: "hello.txt now greets." });

  eq((await call("foundry_task_next")).done, true, "the fix round is complete");
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n## Round 1\nBoth tasks landed.\n");
  r = await call("foundry_run_finish");
  eq(r.round, 1, "the handoff belongs to round 1");

  // ---------------------------------------------------------------- approval

  n = await call("foundry_next");
  eq(n.stage, "review", "round 1 goes back for review");
  eq(n.agent, "foundry-reviewer", "still the generated reviewer agent, on round 1");

  writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 1\n**Verdict**: APPROVED\n");
  isError(await call("foundry_summary_commit"), /docs\/SUMMARY\.md does not exist/, "there is no summary to commit yet");
  await call("foundry_review_submit", { verdict: "APPROVED" });
  eq(subject(repo), "review: approved", "the approval is committed");

  n = await call("foundry_next");
  eq(n.stage, "summarize", "an approved branch needs its summary");
  eq(n.agent, "foundry-summarizer", "the generated summarizer agent is named");
  ok(n.model, "a resolved model is reported for the summarize stage");

  writeFile(repo, "docs/SUMMARY.md", "# summary\nMerge build/... into main.\n");
  r = await call("foundry_summary_commit");
  eq(r.rounds, 1, "the flight took one review round");

  n = await call("foundry_next");
  eq(n.stage, "done", "and the flight is done");
  eq(n.agent, null, "done still has no agent to delegate to");
  like(n.reason, /ready for a human to merge/, n.reason);

  // ---------------------------------------------------------------- the record

  // foundry_agents_sync never commits anything (the generated files are
  // excluded via .git/info/exclude, not tracked), so the branch's commit
  // history is exactly what it would have been without routing at all.
  // The only untracked thing left standing is the operator file the flight
  // found sitting there before it started (F-09, F-17).
  eq(git(repo, ["status", "--porcelain"]), "?? FOUNDRY_FEEDBACK.md", "the branch is clean apart from the pre-existing operator file");
  eq(readFile(repo, "FOUNDRY_FEEDBACK.md"), "pipeline feedback notes, unrelated to this build\n", "...which the whole flight left byte-for-byte untouched");
  const log = sh(repo, "git log --oneline --format=%s");
  for (const expected of [
    "chore: build summary", "review: approved", "chore: round 1 implemented",
    "chore: handoff for review", "R1-01: Fix hello", "P0-02: Impossible task",
    "review: round 1", "P0-01: Create hello", "plan: derive build plan from SPEC",
  ]) {
    ok(log.includes(expected), `the history records "${expected}"`);
  }
  ok(!log.includes("FOUNDRY_FEEDBACK"), "the operator file is never mentioned in a commit");
  eq(readFile(repo, "hello.txt"), "hello\n", "and the working tree holds the reviewed result");

  // Every push-worthy commit actually reached the remote (F-18): the base
  // branch (pushed by run_start before the build branch was cut) and the
  // build branch (pushed after every review_submit and summary_commit).
  eq(git(repo, ["rev-parse", "origin/main"]), git(repo, ["rev-parse", "main"]), "the remote's base branch carries the plan commits");
  eq(git(repo, ["rev-parse", `origin/${r.branch}`]), git(repo, ["rev-parse", "HEAD"]), "the remote build branch head matches the local head");
}, noGh);

// A fresh server process trusts an agents directory that already existed
// before it started, even though this process never called agents_sync
// itself: only the directory's *first* population needs a session restart.
{
  const fresh = plannedRepo();
  await withServer(fresh, async ({ call }) => {
    await call("foundry_agents_sync");
  });
  await withServer(fresh, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.agentFallback, false, "a fresh process against an already-synced repo trusts the generated agent immediately");
    eq(n.agent, "foundry-implementer", "...and names it directly");
  });
}

finish();
