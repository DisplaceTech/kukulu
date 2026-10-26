// The implement stage's tools: run_start, task_next, task_done, task_block,
// verify, run_finish. These run unattended, so every refusal matters as much
// as every success — a tool that silently accepts a bad state is a tool that
// lets a flight land somewhere nobody asked for.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  finish, ok, eq, like, isError,
  mkDir, plannedRepo, withServer, readFile, writeFile, hasFile, subject, useLegacyLayout,
  commitTask, markTasks, setState, git, mkBareRemote, mkFailingGhBin, mkFakeGhBin,
  headingSpacingProblems, planDoc, progressDoc, DEFAULT_TASKS, specRepo, mkFakeGpg, useFakeSigner,
} from "./harness.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const ALL_DONE = { "P0-01": "x", "P0-02": "x", "P0-03": "x" };
// run_finish will shell out to `gh` if it finds one; a stub that always fails
// keeps the pull-request path deterministic and offline.
const noGh = { env: { PATH: `${mkFailingGhBin()}:${process.env.PATH}` } };

/** A repo mid-run: on a build branch, lock armed, every task already done. */
function startedRepo(opts) {
  const repo = plannedRepo(opts);
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  markTasks(repo, ALL_DONE);
  writeFile(repo, ".gitignore", ".kukulu/implement.lock\n");
  writeFile(repo, ".kukulu/implement.lock", "0\n");
  setState(repo, { round: 0 });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: start implementation run"]);
  return repo;
}

// ---------------------------------------------------------------- run_start

for (const missing of ["docs/SPEC.md", "docs/PLAN.md", "docs/PROGRESS.md", "docs/kukulu.json"]) {
  const repo = plannedRepo();
  fs.rmSync(path.join(repo, missing));
  await withServer(repo, async ({ call }) => {
    const escaped = missing.replace(/[/.]/g, "\\$&");
    isError(await call("kukulu_run_start"), new RegExp(`${escaped} is missing`), `run_start refuses without ${missing}`);
  });
}

{
  const dir = mkDir();
  for (const f of ["docs/SPEC.md", "docs/PLAN.md"]) writeFile(dir, f, "x");
  writeFile(dir, "docs/kukulu.json", '{ "verify": ["true"] }');
  writeFile(dir, "docs/PROGRESS.md", "# p\n\n## Tasks\n\n## Log\n");
  await withServer(dir, async ({ call }) => {
    isError(await call("kukulu_run_start"), /not a git repository/, "run_start refuses outside a git repository");
  });
}

{
  // A *tracked* uncommitted change still refuses: it would otherwise ride
  // along into a task's first commit or be stranded switching branches.
  const repo = plannedRepo();
  writeFile(repo, "CLAUDE.md", "# rules\nedited, not committed\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_start"), /working tree is dirty on main/, "run_start refuses to branch from a dirty main");
  });
}

{
  // An *untracked* file never blocks a run from starting (F-09): branching
  // off HEAD does not touch it, and it is recorded as pre-existing.
  const repo = plannedRepo();
  writeFile(repo, "stray.txt", "sitting here untracked\n");
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.alreadyStarted, false, "an untracked file alone does not stop the run from starting");
  });
}

{
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", "feature/side-quest"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_start"), /runs start from 'main' or an existing 'build\/\*' branch/, "run_start refuses to hijack an unrelated branch");
    isError(await call("kukulu_run_start"), /set baseBranch to 'feature\/side-quest'.*git switch -c build\//s, "run_start's foreign-branch refusal names both fixes");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.alreadyStarted, false, "run_start reports a fresh start");
    eq(r.branch, `build/${TODAY}`, "run_start names the branch after the date");
    eq(r.round, 0, "a fresh run is round 0");
    eq(r.counts.open, 3, "run_start reports the open task count");
    ok(hasFile(repo, ".kukulu/implement.lock"), "run_start arms the Stop-hook lock");
    const lock = JSON.parse(readFile(repo, ".kukulu/implement.lock"));
    eq(lock.count, 0, "the lock starts its re-block counter at zero");
    eq(lock.round, 0, "the lock records the round it was armed for");
    eq(lock.cap, 60, "the lock carries the default guard cap");
    ok(lock.armedAt, "the lock records when it was armed");
    eq((await call("kukulu_status")).lockCounter, 0, "status reads the lock's counter");
    like(readFile(repo, ".gitignore"), /^\.kukulu\/implement\.lock$/m, "run_start gitignores the lock");
    like(readFile(repo, "docs/PROGRESS.md"), new RegExp(`^Branch: build/${TODAY}$`, "m"), "run_start stamps the branch into PROGRESS.md");
    like(readFile(repo, "docs/PROGRESS.md"), /^Started: \d{4}-\d\d-\d\dT/m, "run_start stamps a start timestamp");
    eq(subject(repo), "chore: start implementation run", "run_start commits the stamp");
    eq(git(repo, ["status", "--porcelain"]), "", "run_start leaves a clean tree");

    writeFile(repo, ".kukulu/implement.lock", JSON.stringify({ ...JSON.parse(readFile(repo, ".kukulu/implement.lock")), count: 40 }));
    const again = await call("kukulu_run_start");
    eq(again.alreadyStarted, true, "run_start is idempotent while the lock is held");
    eq(subject(repo), "chore: start implementation run", "the idempotent call commits nothing new");
    eq(JSON.parse(readFile(repo, ".kukulu/implement.lock")).count, 0, "resuming an already-started run resets the guard's counter");
  });
}

// A second run on the same day gets its own branch rather than stomping one.
{
  const repo = plannedRepo();
  git(repo, ["branch", `build/${TODAY}`]);
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_run_start")).branch, `build/${TODAY}-2`, "run_start sidesteps an existing branch for today");
  });
}

// Resuming on an existing build branch re-arms the lock without re-stamping.
{
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  writeFile(repo, ".gitignore", ".kukulu/implement.lock\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: pre-existing"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.alreadyStarted, false, "run_start resumes on an existing build branch");
    eq(r.branch, `build/${TODAY}`, "the existing build branch is reused");
    eq(readFile(repo, ".gitignore").match(/implement\.lock/g).length, 1, "the gitignore entry is not duplicated");
  });
}

{
  const repo = plannedRepo({ config: { branchPrefix: "wip/", baseBranch: "main" } });
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_run_start")).branch, `wip/${TODAY}`, "branchPrefix from kukulu.json is honoured");
  });
}

{
  const repo = plannedRepo({ config: { guardCap: 200 } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    eq(JSON.parse(readFile(repo, ".kukulu/implement.lock")).cap, 200, "a configured guardCap is carried into the lock");
  });
}

// A fix round says so in its bookkeeping commit.
{
  const repo = plannedRepo();
  setState(repo, { round: 2 });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: state"]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    eq(subject(repo), "chore: start review-fix round 2", "a fix round's start commit names the round");
  });
}

// ---------------------------------------------------------------- basePush

{
  const repo = plannedRepo();
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.basePush, "pushed", "run_start pushes the base branch before branching off it (F-18)");
    eq(git(repo, ["rev-parse", "origin/main"]), git(repo, ["rev-parse", "main"]), "the remote's main matches local main, including the plan commits");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_run_start")).basePush, "skipped: no origin remote", "without a remote, basePush says so");
  });
}

{
  const repo = plannedRepo({ config: { policies: { push: false } } });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_run_start")).basePush, "skipped: policy", "push: false skips the base branch push too");
  });
}

{
  // Resuming an existing build branch never pushes the base branch again —
  // basePush belongs only to the creation path.
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  writeFile(repo, ".gitignore", ".kukulu/implement.lock\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: pre-existing"]);
  await withServer(repo, async ({ call }) => {
    ok(!("basePush" in await call("kukulu_run_start")), "resuming an existing build branch reports no basePush at all");
  });
}

// ---------------------------------------------------------------- task_next

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    const t = await call("kukulu_task_next");
    eq(t.done, false, "task_next hands back a task");
    eq(t.id, "P0-01", "task_next picks the first todo task");
    eq(t.title, "Create hello", "task_next returns the task title");
    like(t.text, /\*\*Goal:\*\* write hello\.txt/, "task_next returns the PLAN.md task text");
    eq(t.files, "hello.txt", "task_next extracts Files touched");
    eq(t.dependsOn.length, 0, "an independent task has no dependencies");
    eq(t.resumed, false, "a freshly picked task is not a resume");
    eq(t.counts.inProgress, 1, "task_next marks the task in progress");
    like(readFile(repo, "docs/PROGRESS.md"), /^- \[~\] P0-01 /m, "the checkbox becomes [~] on disk");

    const same = await call("kukulu_task_next");
    eq(same.id, "P0-01", "task_next re-hands the in-progress task after a crash");
    eq(same.resumed, true, "the re-handed task is flagged as a resume");
  });
}

// Dependency logs travel with the task; that is all the implementer gets.
{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("kukulu_task_done", { id: "P0-01", log: "Added hello.txt.\nInterpretation: greeting is lowercase." });
    const t = await call("kukulu_task_next");
    eq(t.id, "P0-02", "the loop advances to the next task");
    eq(t.dependsOn.join(","), "P0-01", "task_next reports declared dependencies");
    like(t.dependencyLogs["P0-01"], /greeting is lowercase/, "task_next carries the dependency's log entry");
    ok(!t.dependencyLogs["P0-03"], "unrelated log entries are not shipped");
  });
}

// A blocked dependency skips its dependents, transitively, in one pass.
{
  const tasks = [
    { id: "P0-01", title: "root", files: "a.txt" },
    { id: "P0-02", title: "middle", depends: ["P0-01"] },
    { id: "P0-03", title: "leaf", depends: ["P0-02"] },
    { id: "P0-04", title: "far leaf", depends: ["P0-03"] },
  ];
  const repo = plannedRepo({ tasks });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    await call("kukulu_task_block", { id: "P0-01", reason: "tried A / fails B / fix C" });
    const t = await call("kukulu_task_next");
    eq(t.done, true, "nothing is left once the chain collapses");
    eq(t.skipped.map((s) => s.id).join(","), "P0-02,P0-03,P0-04", "every dependent is skipped transitively");
    eq(t.skipped[1].dependsOn, "P0-02", "each skip records which dependency stopped it");
    eq(t.counts.skipped, 3, "the skipped count matches");
    eq(subject(repo), "progress: skip P0-02, P0-03, P0-04", "the skips land in one commit");
    like(readFile(repo, "docs/PROGRESS.md"), /### P0-02 — skipped\n\nSKIPPED: depends on P0-01/, "each skip is logged with its cause");
  });
}

{
  const repo = plannedRepo({ tasks: [{ id: "P0-01", title: "only" }] });
  writeFile(repo, "docs/PLAN.md", "# plan\n## Phase 0 — x\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "break the plan"]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    isError(await call("kukulu_task_next"), /no '### P0-01: <title>' heading/, "a task with no PLAN.md heading is a hard error");
  });
}

// ---------------------------------------------------------------- task_done

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    isError(await call("kukulu_task_done", {}), /id and log are required/, "task_done needs both arguments");
    isError(await call("kukulu_task_done", { id: "P9-99", log: "x" }), /not in docs\/PROGRESS\.md/, "task_done rejects an unknown id");
    isError(await call("kukulu_task_done", { id: "P0-01", log: "x" }), /is 'todo', not in progress/, "task_done refuses a task that was never selected");

    await call("kukulu_task_next");
    isError(await call("kukulu_task_done", { id: "P0-01", log: "x" }), /HEAD commit .* is not this task's commit/, "task_done refuses without the task's own commit");

    // Simulate blocked stops piling up the guard's counter before the task lands.
    writeFile(repo, ".kukulu/implement.lock", JSON.stringify({ ...JSON.parse(readFile(repo, ".kukulu/implement.lock")), count: 12 }));

    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    writeFile(repo, "leftover.txt", "forgotten\n");
    isError(await call("kukulu_task_done", { id: "P0-01", log: "x" }), /uncommitted changes remain[\s\S]*leftover\.txt/, "task_done refuses to leave work uncommitted");
    eq(JSON.parse(readFile(repo, ".kukulu/implement.lock")).count, 12, "a refused task_done does not touch the guard's counter");

    fs.rmSync(path.join(repo, "leftover.txt"));
    const r = await call("kukulu_task_done", { id: "P0-01", log: "Added hello.txt." });
    eq(r.counts.done, 1, "task_done marks the task done");
    eq(r.guardReset, true, "task_done reports that it reset the guard's counter");
    eq(JSON.parse(readFile(repo, ".kukulu/implement.lock")).count, 0, "...and the lock's counter is actually back to zero");
    eq(r.taskCommit, git(repo, ["rev-parse", "--short", "HEAD~1"]), "task_done records the task's commit sha");
    like(readFile(repo, "docs/PROGRESS.md"), /^### P0-01 — [0-9a-f]{7,}\n\nAdded hello\.txt\.$/m, "the log entry is stamped with that sha");
    eq(headingSpacingProblems(readFile(repo, "docs/PROGRESS.md")).join("; "), "", "PROGRESS.md is MD022-clean after task_done");
    eq(subject(repo), "progress: P0-01 done", "the bookkeeping commit is separate from the task commit");
    eq(git(repo, ["status", "--porcelain"]), "", "task_done leaves a clean tree");
  });
}

// The dependency label quoted in prose does not replace the real field.
{
  const tasks = [
    { id: "P0-01", title: "First", files: "a.txt" },
    { id: "P0-02", title: "Second", files: "b.txt", depends: ["P0-01"], constraints: "Quote the format as **Depends on:** P0-03 in the docs." },
    { id: "P0-03", title: "Third", files: "c.txt" },
  ];
  const repo = plannedRepo({ tasks });
  await withServer(repo, async ({ call }) => {
    const p = await call("kukulu_plan_commit");
    ok(!p.error, "kukulu_plan_commit reports no depends problem for a quoted label");
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "First", { "a.txt": "a\n" });
    await call("kukulu_task_done", { id: "P0-01", log: "ok" });
    const n = await call("kukulu_task_next");
    eq(n.id, "P0-02", "the second task is selected");
    eq(JSON.stringify(n.dependsOn), JSON.stringify(["P0-01"]), "a quoted dependency label in a task's prose does not replace its real dependency");
  });
}

// PLAN.md and PROGRESS.md written in the 0.6 spacing (no blank line after a heading) still parse.
{
  const repo = plannedRepo();
  writeFile(repo, "docs/PLAN.md", planDoc(DEFAULT_TASKS, { legacy: true }));
  writeFile(repo, "docs/PROGRESS.md", progressDoc(DEFAULT_TASKS, { legacy: true }));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: 0.6 spacing"]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    const n = await call("kukulu_task_next");
    eq(n.id, "P0-01", "a PROGRESS.md in the 0.6 spacing still parses: the first task is selected");
    like(n.text, /\*\*Goal:\*\* write hello\.txt/, "...and its PLAN.md block is found");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    const r = await call("kukulu_task_done", { id: "P0-01", log: "Added hello.txt." });
    eq(r.counts.done, 1, "...and a task completes");
    const next = await call("kukulu_task_next");
    eq(next.id, "P0-02", "...then the next one is selected");
    like(next.dependencyLogs["P0-01"], /Added hello\.txt\./, "...with its dependency's log entry");
  });
}

// ---------------------------------------------------------------- task_block

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    isError(await call("kukulu_task_block", { id: "P0-01" }), /id and reason are required/, "task_block needs a reason");
    isError(await call("kukulu_task_block", { id: "P9-99", reason: "x" }), /not in docs\/PROGRESS\.md/, "task_block rejects an unknown id");

    await call("kukulu_task_next");
    writeFile(repo, "half-done.txt", "debris\n");
    writeFile(repo, "docs/SPEC.md", "# Spec\nedited by mistake\n");
    writeFile(repo, ".kukulu/implement.lock", JSON.stringify({ ...JSON.parse(readFile(repo, ".kukulu/implement.lock")), count: 9 }));
    const r = await call("kukulu_task_block", { id: "P0-01", reason: "tried A / fails B / fix C" });
    eq(r.counts.blocked, 1, "task_block marks the task blocked");
    eq(JSON.parse(readFile(repo, ".kukulu/implement.lock")).count, 0, "task_block resets the guard's counter too");
    ok(!hasFile(repo, "half-done.txt"), "task_block deletes untracked debris");
    eq(readFile(repo, "docs/SPEC.md"), "# Spec\n", "task_block reverts tracked edits");
    ok(hasFile(repo, ".kukulu/implement.lock"), "task_block keeps the run's lock armed");
    like(readFile(repo, "docs/PROGRESS.md"), /### P0-01 — blocked\n\nBLOCKED: tried A \/ fails B \/ fix C/, "the block reason is logged verbatim");
    eq(headingSpacingProblems(readFile(repo, "docs/PROGRESS.md")).join("; "), "", "PROGRESS.md is MD022-clean after task_block");
    eq(subject(repo), "progress: P0-01 blocked", "the block is committed");
  });
}

// ---------------------------------------------------------------- task_reopen (2026-09-30 cleanflate F-03, F-18)

{
  const tasks = [
    { id: "P0-01", title: "Base", files: "a.txt" },
    { id: "P0-02", title: "Needs a download", files: "b.txt", depends: ["P0-01"] },
    { id: "P0-03", title: "Uses the download", files: "c.txt", depends: ["P0-02"] },
    { id: "P0-04", title: "Uses that", files: "d.txt", depends: ["P0-03"] },
    { id: "P0-05", title: "Unrelated blocker", files: "e.txt" },
    { id: "P0-06", title: "Needs the unrelated one", files: "f.txt", depends: ["P0-05"] },
  ];
  const repo = plannedRepo({ tasks });
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  markTasks(repo, { "P0-01": "x", "P0-02": "!", "P0-03": "-", "P0-04": "-", "P0-05": "!", "P0-06": "-" });
  setState(repo, { round: 0, implemented: true });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: round 0 implemented"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_task_reopen", { id: "P0-02" }), /id and reason are required/, "a reopen without a reason is refused");
    isError(await call("kukulu_task_reopen", { id: "P9-99", reason: "x" }), /not in docs\/PROGRESS\.md/, "an unknown task is refused");
    isError(await call("kukulu_task_reopen", { id: "P0-01", reason: "x" }), /'done'; only a blocked or skipped task/, "a done task cannot be reopened");

    const r = await call("kukulu_task_reopen", { id: "P0-02", reason: "the operator supplied the corpus file" });
    eq(r.reopenedDependents.join(","), "P0-03,P0-04", "the tasks skipped because of it come back too, transitively");
    eq(r.counts.todo, 3, "three tasks are open again");
    eq(r.counts.skipped, 1, "a task skipped for an unrelated blocker stays skipped");
    eq(r.counts.blocked, 1, "...and so does that blocker");
    eq(subject(repo), "progress: reopen P0-02 (+2 dependents)", "the reopen is one commit");
    eq(git(repo, ["status", "--porcelain"]), "", "...leaving a clean tree");
    const prog = readFile(repo, "docs/PROGRESS.md");
    like(prog, /### P0-02 — reopened\n\nREOPENED: the operator supplied the corpus file/, "the reason is logged");
    like(prog, /### P0-04 — reopened\n\nreopened: it was skipped because of P0-03, which is open again/, "a transitive dependent's log names its cause");
    eq(headingSpacingProblems(prog).join("; "), "", "PROGRESS.md is MD022-clean after task_reopen");

    const n = await call("kukulu_next");
    eq(n.stage, "implement", "a finished round with reopened tasks goes back to implement");

    const skippedOnly = await call("kukulu_task_reopen", { id: "P0-06", reason: "try it anyway" });
    eq(skippedOnly.reopenedDependents.length, 0, "a skipped task can be reopened on its own");
    eq(subject(repo), "progress: reopen P0-06", "...with a plain commit subject");
    await call("kukulu_run_start");
    const picked = [];
    for (;;) {
      const t = await call("kukulu_task_next");
      for (const sk of t.skipped) picked.push(`skip:${sk.id}`);
      if (t.done) break;
      picked.push(t.id);
      commitTask(repo, t.id, t.title, { [`${t.id}.txt`]: "ok\n" });
      await call("kukulu_task_done", { id: t.id, log: "done" });
    }
    eq(picked.join(","), "P0-02,P0-03,P0-04,skip:P0-06", "reopened tasks run in plan order, and one whose blocker is still blocked is skipped again");
  });
}

{
  const repo = plannedRepo();
  markTasks(repo, { "P0-01": "x", "P0-02": "!", "P0-03": "-" });
  setState(repo, { summarized: true });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_task_reopen", { id: "P0-02", reason: "x" }), /flight is complete/, "a summarized flight refuses a reopen");
  });
}

// ---------------------------------------------------------------- verify

{
  const repo = plannedRepo();
  fs.rmSync(path.join(repo, "docs/kukulu.json"));
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_verify"), /docs\/kukulu\.json is missing/, "verify needs a config");
  });
}

{
  const repo = plannedRepo({ config: { verify: [] } });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_verify"), /no 'verify' commands/, "verify needs at least one command");
  });
}

{
  const repo = plannedRepo({
    config: { verify: ["echo base"], extraVerify: { "src/": ["echo base", "echo extra"], "docs/": ["echo docs"] } },
  });
  await withServer(repo, async ({ call }) => {
    let v = await call("kukulu_verify");
    eq(v.ok, true, "verify passes when its commands pass");
    eq(v.results.length, 1, "with no files touched, only the base commands run");
    eq(v.results[0].stdoutTail, "base", "verify captures stdout");

    v = await call("kukulu_verify", { files: ["src/a.js"] });
    eq(v.results.length, 2, "extraVerify adds commands for a matching prefix");
    eq(v.results[1].command, "echo extra", "the extra command is the one configured for that prefix");

    v = await call("kukulu_verify", { files: ["src/a.js", "docs/b.md"] });
    eq(v.results.length, 3, "several prefixes can match at once");

    v = await call("kukulu_verify", { files: "src/a.js, docs/b.md" });
    eq(v.results.length, 3, "files may arrive as a delimited string");

    v = await call("kukulu_verify", { files: ["README.md"] });
    eq(v.results.length, 1, "a non-matching path adds nothing");
  });
}

{
  // from gates an extraVerify command
  const repo = plannedRepo({ config: { verify: ["true"], extraVerify: { "src/": [{ cmd: "false", from: "P0-02" }] } } });
  await withServer(repo, async ({ call }) => {
    let v = await call("kukulu_verify", { files: ["src/a.js"] });
    eq(v.ok, true, "an extraVerify command gated on an unstarted task does not fail verify");
    ok(v.results.some((r) => r.cmd === "false" && r.skipped === "inactive until P0-02" && Object.keys(r).length === 2), "...and is reported as skipped in its place");
    markTasks(repo, { "P0-01": "x", "P0-02": "~" });
    v = await call("kukulu_verify", { files: ["src/a.js"] });
    eq(v.ok, false, "once the task is in progress, the command runs and fails verify");
  });
}

{
  const repo = plannedRepo({
    config: { verify: [{ cmd: "sleep 2", timeoutMs: 200 }, "echo fast"], commandTimeoutMs: 60_000 },
  });
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.ok, false, "the slow command's own short timeout still fails the whole verify");
    eq(v.results[0].timedOut, true, "the object-form command times out on its own timeoutMs");
    eq(v.results[0].timeoutMs, 200, "...and reports which timeout it was given");
    eq(v.results[1].command, "echo fast", "a plain string entry in the same run is unaffected");
    eq(v.results[1].timeoutMs, 60_000, "...and uses the run's default commandTimeoutMs");
    eq(v.results[1].ok, true, "...and still passes");
  });
}

for (const [config, re] of [
  [{ verify: [{ timeoutMs: 1000 }] }, /verify\[0\] is missing 'cmd'/],
  [{ verify: [{ cmd: "x", timeoutMs: 0 }] }, /verify\[0\]\.timeoutMs must be a positive integer/],
  [{ verify: [{ cmd: "x", timeoutMs: 1.5 }] }, /verify\[0\]\.timeoutMs must be a positive integer/],
  [{ verify: [42] }, /verify\[0\] must be a command string or \{ cmd, timeoutMs \}/],
  [{ extraVerify: { "src/": [{ timeoutMs: 1000 }] } }, /extraVerify\['src\/'\]\[0\] is missing 'cmd'/],
]) {
  const repo = plannedRepo({ config });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_verify"), re, `a malformed command entry refuses: ${JSON.stringify(config)}`);
  });
}

{
  const repo = plannedRepo({ config: { verify: ["echo out; echo boom >&2; exit 3"] } });
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.ok, false, "a failing command fails the whole verify");
    eq(v.results[0].exitCode, 3, "the exit code is reported");
    eq(v.results[0].stderrTail, "boom", "stderr is reported");
    eq(v.results[0].timedOut, false, "a plain failure is not a timeout");
  });
}

{
  const repo = plannedRepo({ config: { verify: ["seq 1 100"] } });
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.results[0].stdoutTail.split("\n").length, 60, "output is trimmed to the last 60 lines");
    eq(v.results[0].stdoutTail.split("\n")[0], "41", "the tail is the end of the output, not the start");
  });
}

{
  const repo = plannedRepo({ config: { verify: ["sleep 30"], commandTimeoutMs: 300 } });
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.ok, false, "a hung command fails rather than hanging the flight");
    eq(v.results[0].timedOut, true, "the timeout is reported as such");
  });
}

// ---------------------------------------------------------------- bounded commands (2026-09-30 cleanflate F-04, F-09, F-16)
//
// Every command runs in its own process group with a bounded tail of output,
// so a runaway one can neither hang the server nor take it down.

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

{
  // A timeout kills the whole tree, not just the shell: the grandchild here is
  // what a spinning test binary under `make test` looks like.
  const pidFile = path.join(mkDir("kukulu-pid-"), "grandchild.pid");
  const repo = plannedRepo({ config: { verify: [{ cmd: `sleep 60 & echo $! > ${pidFile}; wait`, timeoutMs: 500 }] } });
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.results[0].timedOut, true, "a command that outlives its timeout is reported as timed out");
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    await new Promise((r) => setTimeout(r, 200));
    ok(!alive(pid), "...and its grandchild is killed with it, not left orphaned");
  });
}

{
  const repo = plannedRepo({ config: { verify: ["yes"] } });
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.ok, false, "a command that never stops writing fails");
    eq(v.results[0].outputLimitExceeded, true, "...because it exceeded the output limit");
    eq(v.results[0].truncated, true, "...and its output is marked truncated");
    ok(v.results[0].stdoutTail.length <= 4000, "the tail stays bounded");
    const s = await call("kukulu_status");
    ok(!s.error && s.root, "the server is still up and answering afterwards");
  });
}

{
  // A background child that keeps stdout open used to hang the call forever.
  const repo = plannedRepo({ config: { verify: ["sleep 60 & echo started"] } });
  await withServer(repo, async ({ call }) => {
    const t0 = Date.now();
    const v = await call("kukulu_verify");
    ok(Date.now() - t0 < 15_000, "a leftover child holding stdout does not hang the call");
    eq(v.ok, true, "the command itself succeeded, so verify passes");
    eq(v.results[0].orphansKilled, true, "...and the leftover child is reported as killed");
    eq(v.results[0].stdoutTail, "started", "output written before the shell exited is kept");
  });
}

{
  const repo = plannedRepo({ config: { verify: [`node -e "process.stdout.write('x'.repeat(100000))"`] } });
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.ok, true, "a long single line is not a failure");
    eq(v.results[0].stdoutTail.length, 4000, "...but only its last 4000 characters are returned");
    eq(v.results[0].truncated, true, "...and the result says it was truncated");
  });
}

// ---------------------------------------------------------------- pre-existing untracked files

{
  const repo = plannedRepo();
  writeFile(repo, "KUKULU_FEEDBACK.md", "notes predating this run\n");
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    const s = await call("kukulu_status");
    eq(s.preexistingUntracked.join(","), "KUKULU_FEEDBACK.md", "run_start records what was already untracked");

    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    const r = await call("kukulu_task_done", { id: "P0-01", log: "Added hello.txt." });
    eq(r.counts.done, 1, "task_done succeeds with the pre-existing file still untracked");
    ok(hasFile(repo, "KUKULU_FEEDBACK.md"), "the file is untouched");

    await call("kukulu_task_next");
    const blocked = await call("kukulu_task_block", { id: "P0-02", reason: "tried A / fails B / fix C" });
    eq(blocked.counts.blocked, 1, "task_block succeeds with the pre-existing file present");
    ok(hasFile(repo, "KUKULU_FEEDBACK.md"), "task_block's git clean spares it, rather than deleting it");

    await call("kukulu_task_next"); // P0-03, skipped as a dependent of the blocked P0-02
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const f = await call("kukulu_run_finish");
    ok(f.readyLine, "run_finish succeeds with the pre-existing file still present");
    ok(hasFile(repo, "KUKULU_FEEDBACK.md"), "...and it is still there afterwards");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    writeFile(repo, "surprise.txt", "created mid-task, not before the run\n");
    isError(
      await call("kukulu_task_done", { id: "P0-01", log: "x" }),
      /uncommitted changes remain[\s\S]*surprise\.txt/,
      "a file created *after* run_start still fails task_done, listing it by name",
    );
    isError(
      await call("kukulu_task_done", { id: "P0-01", log: "x" }),
      /git checkout --.*git clean/,
      "the refusal says to commit, checkout or clean it - never to move or tidy it away",
    );
  });
}

// ---------------------------------------------------------------- run_finish

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    isError(await call("kukulu_run_finish"), /3 task\(s\) still open/, "run_finish refuses with open tasks");
  });
}

{
  const repo = startedRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_finish"), /docs\/HANDOFF\.md does not exist/, "run_finish requires a handoff");

    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    writeFile(repo, "surprise.txt", "not committed\n");
    isError(await call("kukulu_run_finish"), /working tree is not clean[\s\S]*surprise\.txt/, "run_finish refuses to hand off a dirty tree");

    fs.rmSync(path.join(repo, "surprise.txt"));
    const r = await call("kukulu_run_finish");
    eq(r.push, "skipped: no origin remote", "run_finish says so when there is nowhere to push");
    eq(r.pr, null, "no remote means no pull request");
    eq(r.counts.done, 3, "run_finish reports the final counts");
    like(r.readyLine, /^READY FOR REVIEW — branch build\/.*3 done \/ 0 blocked \/ 0 skipped of 3$/, "the ready line summarises the run");
    ok(!hasFile(repo, ".kukulu/implement.lock"), "run_finish disarms the Stop-hook lock");
    eq(subject(repo), "chore: round 0 implemented", "run_finish records the round as implemented");
    eq(JSON.parse(readFile(repo, ".kukulu/state.json")).implemented, true, "the implemented flag is persisted");
    eq(git(repo, ["status", "--porcelain"]), "", "run_finish leaves a clean tree");
  });
}

{
  const repo = startedRepo();
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_finish");
    eq(r.push, "pushed", "run_finish pushes when an origin exists");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "the remote has the branch");
  }, noGh);
}

{
  const repo = startedRepo();
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
  git(repo, ["remote", "add", "origin", "/nonexistent/kukulu-remote.git"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_finish");
    like(r.push, /^failed: /, "a failed push is reported, not swallowed");
    ok(!hasFile(repo, ".kukulu/implement.lock"), "a failed push still ends the run cleanly");
  }, noGh);
}

// ---------------------------------------------------------------- run policies

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.policies.signing, "auto", "policies.signing defaults to auto");
    eq(r.policies.push, true, "policies.push defaults to true");
    eq(r.policies.pr, "draft", "policies.pr defaults to draft");
    eq(r.signing, "none", "with commit.gpgsign unset (the test fixture's default), the outcome is none");
    eq((await call("kukulu_status")).policies.signing, "auto", "status reports the recorded policies");
  });
}

for (const [bad, re] of [
  [{ policies: { signing: "sometimes" } }, /policies\.signing must be one of/],
  [{ policies: { push: "yes" } }, /policies\.push must be a boolean/],
  [{ policies: { pr: "regular" } }, /policies\.pr must be one of/],
  [{ policies: { branch: "x" } }, /policies has an unknown key 'branch'/],
]) {
  const repo = plannedRepo({ config: bad });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_start"), re, `run_start refuses a malformed policies.${Object.keys(bad.policies)[0]}`);
    isError(await call("kukulu_status"), re, "...and so does status, since cfg() validates on every read");
  });
}

{
  const repo = plannedRepo({ config: { policies: { signing: "off" } } });
  git(repo, ["config", "commit.gpgsign", "true"]); // as if a global/local signing setup were already active
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.signing, "off", "policies.signing: off records off without even probing");
    ok(JSON.parse(readFile(repo, ".kukulu/state.json")).signingOverride !== true, "an explicit off does not set signingOverride");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "false", "...and disables signing locally");
    ok(!hasFile(repo, ".kukulu/feedback.jsonl"), "an explicit off is the operator's own choice, not friction — no feedback entry");
  });
}

{
  // Signing left unconfigured entirely ("none") is likewise a choice, not
  // friction: only the auto-fallback path logs.
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.signing, "none", "no signing configured at all");
    ok(!hasFile(repo, ".kukulu/feedback.jsonl"), "no feedback entry for an unconfigured signer");
  });
}

{
  // commit.gpgsign true with no working signer: the probe has to actually
  // attempt a signed commit, not just check whether signing is configured.
  const repo = plannedRepo({ config: { policies: { signing: "required" } } });
  git(repo, ["config", "commit.gpgsign", "true"]);
  git(repo, ["config", "gpg.format", "openpgp"]); // override the host's own signing format so the probe below is deterministic
  git(repo, ["config", "gpg.program", "/nonexistent-signing-agent"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_start"), /policies\.signing is 'required'.*signing probe failed/s, "required signing that cannot actually sign refuses to start");
  });
}

{
  const repo = plannedRepo({ config: { policies: { signing: "auto" } } });
  git(repo, ["config", "commit.gpgsign", "true"]);
  git(repo, ["config", "gpg.format", "openpgp"]);
  git(repo, ["config", "gpg.program", "/nonexistent-signing-agent"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    like(r.signing, /^off \(probe failed: /, "auto falls back to off and records why, rather than refusing");
    eq(JSON.parse(readFile(repo, ".kukulu/state.json")).signingOverride, true, "a failed probe sets signingOverride");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "false", "...and disables signing locally so the first task commit does not hang");

    const lines = readFile(repo, ".kukulu/feedback.jsonl").trim().split("\n");
    eq(lines.length, 1, "the auto fallback is the one case that logs itself as friction");
    const entry = JSON.parse(lines[0]);
    eq(entry.category, "signing", "...tagged with the signing category");
    eq(entry.source, "auto", "...and recorded as an auto entry, not one the agent called explicitly");
    like(entry.message, /off \(probe failed:/, "the message carries the same fallback reason");
    like(git(repo, ["show", "--stat", "--format=", "HEAD"]), /\.kukulu\/feedback\.jsonl/, "it lands in the same commit as the run-start stamp");
  });
}

{
  // policies.feedback: false is a global kill switch, including for the
  // MCP's own internal auto-logging call sites, not just the tool.
  const repo = plannedRepo({ config: { policies: { signing: "auto", feedback: false } } });
  git(repo, ["config", "commit.gpgsign", "true"]);
  git(repo, ["config", "gpg.format", "openpgp"]);
  git(repo, ["config", "gpg.program", "/nonexistent-signing-agent"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    like(r.signing, /^off \(probe failed: /, "the fallback itself still happens");
    ok(!hasFile(repo, ".kukulu/feedback.jsonl"), "...but policies.feedback: false suppresses even the auto entry");
  });
}

{
  const repo = plannedRepo({ config: { policies: { push: false } } });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("kukulu_task_done", { id: "P0-01", log: "x" });
    await call("kukulu_task_block", { id: "P0-02", reason: "x / y / z" });
    await call("kukulu_task_next"); // skips P0-03, the blocked task's dependent
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const r = await call("kukulu_run_finish");
    eq(r.push, "skipped: policy", "push: false skips the push even though a remote exists");
    eq(r.pr, null, "no push means no pull request either");
  }, noGh);
}

{
  const repo = plannedRepo({ config: { policies: { pr: "none" } } });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("kukulu_task_done", { id: "P0-01", log: "x" });
    await call("kukulu_task_block", { id: "P0-02", reason: "x / y / z" });
    await call("kukulu_task_next"); // skips P0-03, the blocked task's dependent
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const r = await call("kukulu_run_finish");
    eq(r.push, "pushed", "push still happens; only the PR is policy-gated");
    eq(r.pr, "skipped: policy", "pr: none skips PR creation, reported explicitly");
  });
}

// The draft PR targets baseBranch, not the repository's default branch, and
// the summary reports the PR it finds (2026-09-30 cleanflate F-24, F-25).
{
  const repo = plannedRepo({ config: { baseBranch: "feature/perf" } });
  git(repo, ["checkout", "-q", "-b", "feature/perf"]);
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  const ghDir = mkFakeGhBin();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("kukulu_task_done", { id: "P0-01", log: "x" });
    await call("kukulu_task_block", { id: "P0-02", reason: "x / y / z" });
    await call("kukulu_task_next");
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const r = await call("kukulu_run_finish");
    eq(r.pr, "https://github.invalid/pull/1", "run_finish reports the draft PR it opened");
    like(readFile(ghDir, "calls.log"), /pr create --draft --base feature\/perf /, "...opened against baseBranch, not the default branch");

    setState(repo, { reviewed: true, verdict: "APPROVED", rounds: [{ round: 1, fixTasks: 0, unblocked: 0, verdict: "APPROVED" }] });
    writeFile(repo, "docs/SUMMARY.md", "# summary\n");
    const sum = await call("kukulu_summary_commit");
    eq(JSON.stringify(sum.pr), JSON.stringify({ url: "https://github.invalid/pull/1", state: "OPEN", draft: true, base: "feature/perf" }), "summary_commit reports the PR's url, state, draft flag and base");
  }, { env: { PATH: `${ghDir}:${process.env.PATH}` } });
}

{
  const repo = plannedRepo({ config: { baseBranch: "feature/perf" } });
  git(repo, ["checkout", "-q", "-b", "feature/perf"]);
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  const ghDir = mkFakeGhBin();
  writeFile(ghDir, "pr.json", '{"url":"https://github.invalid/pull/7","state":"OPEN","isDraft":true,"baseRefName":"main"}\n');
  setState(repo, { reviewed: true, verdict: "APPROVED", policies: { signing: "auto", push: false, pr: "draft", feedback: true } });
  writeFile(repo, "docs/SUMMARY.md", "# summary\n");
  await withServer(repo, async ({ call }) => {
    const sum = await call("kukulu_summary_commit");
    eq(sum.pr.expectedBase, "feature/perf", "a PR against the wrong base is flagged with the base it should have");
  }, { env: { PATH: `${ghDir}:${process.env.PATH}` } });
}

{
  const repo = plannedRepo();
  setState(repo, { reviewed: true, verdict: "APPROVED" });
  writeFile(repo, "docs/SUMMARY.md", "# summary\n");
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_summary_commit")).pr, "none", "with no remote, summary_commit says there is no PR");
  }, noGh);
}

// ---------------------------------------------------------------- run_halt

{
  const repo = startedRepo();
  writeFile(repo, "half-finished.txt", "in-flight work, not this tool's business to touch\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_halt", {}), /reason is required/, "run_halt needs a reason");

    const r = await call("kukulu_run_halt", { reason: "signing agent died: connection refused" });
    like(r.next, /kukulu_run_resume\(\{ reason: "<what you fixed>" \}\)/, "kukulu_run_halt's result names kukulu_run_resume");
    eq(r.halted, "signing agent died: connection refused", "run_halt reports the reason it recorded");
    ok(!hasFile(repo, ".kukulu/implement.lock"), "run_halt disarms the lock");
    eq(JSON.parse(readFile(repo, ".kukulu/state.json")).halted, "signing agent died: connection refused", "the reason is persisted in state");
    ok(hasFile(repo, "half-finished.txt"), "run_halt never resets or cleans the tree");
    ok(r.dirty, "run_halt reports that the tree is still dirty");

    eq(subject(repo), "chore: run halted", "one commit, not two, carries both the halt and its feedback entry");
    const changed = git(repo, ["show", "--stat", "--format=", "HEAD"]);
    like(changed, /\.kukulu\/state\.json/, "...touching state");
    like(changed, /\.kukulu\/feedback\.jsonl/, "...and the feedback log, in the same commit");
    const entry = JSON.parse(readFile(repo, ".kukulu/feedback.jsonl").trim());
    eq(entry.stage, "controller", "the halt is logged from the controller's own vantage point");
    eq(entry.category, "halt", "...tagged as a halt");
    eq(entry.source, "auto", "...recorded as an auto entry");
    like(entry.message, /signing agent died: connection refused/, "...carrying the halt reason verbatim");

    const n = await call("kukulu_next");
    eq(n.stage, "halt", "the flight now halts");
    like(n.reason, /^signing agent died: connection refused — once the cause is fixed, call kukulu_run_resume/, "...with the recorded reason, and kukulu_next's reason for an operator halt names kukulu_run_resume");
  });
}

{
  const repo = startedRepo({ config: { policies: { feedback: false } } });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_halt", { reason: "operator intervened" });
    eq(r.halted, "operator intervened", "the halt itself still works");
    ok(!hasFile(repo, ".kukulu/feedback.jsonl"), "policies.feedback: false skips even the auto entry");
  });
}

// ---------------------------------------------------------------- run_resume

{
  const repo = startedRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_resume", { reason: "fixed" }), /the flight is not halted; there is nothing to resume/, "kukulu_run_resume refuses when the flight is not halted");
    await call("kukulu_run_halt", { reason: "signing agent died" });
    isError(await call("kukulu_run_resume", { reason: "  " }), /reason must be a non-empty string/, "kukulu_run_resume refuses an empty reason");
    isError(await call("kukulu_run_resume", {}), /reason must be a non-empty string/, "...and a missing one");
    writeFile(repo, "stray.txt", "x\n");
    isError(await call("kukulu_run_resume", { reason: "fixed" }), /not clean:\n\?\? stray\.txt/, "kukulu_run_resume refuses a dirty tree listing the paths");
    fs.rmSync(path.join(repo, "stray.txt"));
    git(repo, ["branch", "-m", "main", "trunk"]);
    isError(await call("kukulu_run_resume", { reason: "fixed" }), /baseBranch 'main' does not exist as a local branch/, "kukulu_run_resume refuses when baseBranch is missing");
    git(repo, ["branch", "-m", "trunk", "main"]);
    const head = git(repo, ["rev-parse", "HEAD"]);
    const r = await call("kukulu_run_resume", { reason: "restarted the signing agent" });
    eq(r.resumed, true, "kukulu_run_resume clears the halt");
    eq(r.previousHalt, "signing agent died", "...reporting the halt it cleared");
    eq(subject(repo), "chore: run resumed", "...and commits chore: run resumed");
    ok(git(repo, ["rev-parse", "HEAD"]) !== head, "...as a new commit");
    eq(JSON.parse(readFile(repo, ".kukulu/state.json")).halted, null, "state.halted is null afterwards");
    const entries = readFile(repo, ".kukulu/feedback.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    const last = entries[entries.length - 1];
    eq(last.category + "/" + last.source + "/" + last.stage, "resume/human/controller", "kukulu_run_resume logs a resume feedback entry with source human");
    like(last.message, /restarted the signing agent/, "...naming the reason");
    ok((await call("kukulu_next")).stage !== "halt", "kukulu_next no longer halts after a resume");
  });
}

{
  const repo = startedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_halt", { reason: "operator stop" });
  });
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nif head -n1 "$1" | grep -q '^chore: run resumed'; then echo rejected >&2; exit 1; fi\n`);
  fs.chmodSync(hook, 0o755);
  const files = [".kukulu/state.json", ".kukulu/feedback.jsonl"];
  const before = files.map((f) => readFile(repo, f));
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    ok((await call("kukulu_run_resume", { reason: "fixed" })).error, "a failed resume commit is an error");
    files.forEach((f, i) => eq(readFile(repo, f), before[i], `...${f} is byte-identical`));
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD did not move");
  });
}

{
  const repo = startedRepo();
  await withServer(repo, async ({ call }) => {
    setState(repo, { halted: "review round 2 exceeds the cap", haltCap: { cap: "maxRounds", round: 2 } });
    git(repo, ["commit", "-qam", "chore: round-cap halt"]);
    isError(await call("kukulu_run_resume", { reason: "fixed" }), /kukulu_flight_options.*resume: true/, "kukulu_run_resume refuses a round-cap halt naming kukulu_flight_options");
  });
}

// ---------------------------------------------------------------- commit signing (S-02)

function failingSignerRepo(config) {
  const repo = plannedRepo({ config });
  git(repo, ["config", "--local", "commit.gpgsign", "true"]);
  git(repo, ["config", "--local", "gpg.format", "openpgp"]);
  git(repo, ["config", "--local", "gpg.program", "/nonexistent-signing-agent"]);
  return repo;
}

{
  const repo = failingSignerRepo({ policies: { signing: "auto" } });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_feedback_log", { stage: "plan", message: "something slow" });
    eq(r.logged, true, "auto: the feedback entry is logged");
    eq(subject(repo), "chore: pipeline friction (plan)", "auto: a Kūkulu commit whose signing fails is retried unsigned");
    const st = JSON.parse(git(repo, ["show", "HEAD:.kukulu/state.json"]));
    like(st.signing, /^off \(commit signing failed: /, "...the committed state records why");
    eq(st.signingOverride, true, "...and sets signingOverride");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "false", "...and signing is off locally");
    const entries = git(repo, ["show", "HEAD:.kukulu/feedback.jsonl"]).trim().split("\n").map((l) => JSON.parse(l));
    eq(entries.filter((e) => e.category === "signing").length, 1, "...with exactly one signing entry");
    ok(entries.some((e) => e.message === "something slow"), "...beside the logged entry");
    eq(git(repo, ["status", "--porcelain"]), "", "...and the tree is clean");
  });
}

{
  const repo = failingSignerRepo({ policies: { signing: "required" } });
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", { maxRounds: 5 }), /'required'.*could not be signed/, "required: a Kūkulu commit whose signing fails throws");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
  });
}

{
  const repo = failingSignerRepo({ policies: { signing: "auto" } });
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\nc="$(dirname "$0")/../hook-count"\nif [ -e "$c" ]; then echo "rejected by test hook" >&2; exit 1; fi\ntouch "$c"\nexit 0\n');
  fs.chmodSync(hook, 0o755);
  const rec = (f) => (hasFile(repo, f) ? readFile(repo, f) : null);
  const files = ["docs/kukulu.json", ".kukulu/state.json", ".kukulu/feedback.jsonl"];
  const before = files.map(rec);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", { maxRounds: 5 }), /failed even unsigned/, "auto: a failed unsigned retry leaves the tree as it found it: the call is an error");
    files.forEach((f, i) => eq(rec(f), before[i], `...${f} is unchanged`));
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD did not move");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "true", "...and local signing is restored");
  });
}

{
  // R2-03: the undo path must --unset a local commit.gpgsign that was unset before the fallback.
  const repo = failingSignerRepo({ policies: { signing: "auto" } });
  git(repo, ["config", "--local", "--unset", "commit.gpgsign"]);
  const globalCfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kukulu-gitcfg-")), "gitconfig");
  fs.writeFileSync(globalCfg, "[commit]\n\tgpgsign = true\n[gpg]\n\tformat = openpgp\n[gpg \"openpgp\"]\n\tprogram = /nonexistent-signing-agent\n");
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\nc="$(dirname "$0")/../hook-count"\nif [ -e "$c" ]; then echo "rejected by test hook" >&2; exit 1; fi\ntouch "$c"\nexit 0\n');
  fs.chmodSync(hook, 0o755);
  const rec = (f) => (hasFile(repo, f) ? readFile(repo, f) : null);
  const files = ["docs/kukulu.json", ".kukulu/state.json", ".kukulu/feedback.jsonl"];
  const before = files.map(rec);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", { maxRounds: 5 }), /failed even unsigned/, "auto: a failed unsigned retry leaves an unset local commit.gpgsign unset: the call is an error");
    files.forEach((f, i) => eq(rec(f), before[i], `...${f} is unchanged (unset case)`));
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged (unset case)");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD did not move (unset case)");
    const r = spawnSync("git", ["config", "--local", "--get", "commit.gpgsign"], { cwd: repo, encoding: "utf8" });
    ok(r.status !== 0 && r.stdout === "", "...and local commit.gpgsign is unset again, not left at false");
  }, { env: { GIT_CONFIG_GLOBAL: globalCfg } });
}

// ---------------------------------------------------------------- a signer that words its own error (B-01)

const SSH_ERROR = fs.readFileSync(new URL("./fixtures/signing/ssh-agent-missing-key.txt", import.meta.url), "utf8").trim();

/** A repo with an uncommitted plan and an SSH signer that prints the fixture's error and fails. */
function sshSignerRepo(policy) {
  const repo = specRepo();
  const plan = plannedRepo({ config: { policies: { signing: policy } } });
  for (const f of ["docs/PLAN.md", "docs/PROGRESS.md", "docs/kukulu.json", "CLAUDE.md"]) writeFile(repo, f, readFile(plan, f));
  const dir = mkDir("kukulu-ssh-");
  const signer = path.join(dir, "fake-ssh-keygen");
  fs.writeFileSync(signer, `#!/bin/sh\nprintf '%s\\n' '${SSH_ERROR}' >&2\nexit 1\n`);
  fs.chmodSync(signer, 0o755);
  git(repo, ["config", "--local", "gpg.format", "ssh"]);
  git(repo, ["config", "--local", "gpg.ssh.program", signer]);
  git(repo, ["config", "--local", "user.signingkey", "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKukuluTestKeyOnly"]);
  git(repo, ["config", "--local", "commit.gpgsign", "true"]);
  return repo;
}

{
  const repo = sshSignerRepo("auto");
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_plan_commit");
    ok(Boolean(r.commit), "an SSH signer's own error falls back under auto: kukulu_plan_commit succeeds");
    eq(subject(repo), "plan: derive build plan from SPEC", "...with the plan subject");
    eq(git(repo, ["log", "-1", "--format=%G?"]), "N", "...unsigned");
    const st = JSON.parse(readFile(repo, ".kukulu/state.json"));
    like(st.signing, /^off \(commit signing failed:/, "...state.signing records the fallback");
    ok(st.signing.includes(SSH_ERROR), "...and the signer's own text");
    const entries = readFile(repo, ".kukulu/feedback.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    eq(entries.length + "|" + entries[0].category, "1|signing", "...with exactly one signing feedback entry");
  });
}

{
  const repo = sshSignerRepo("required");
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const e = await call("kukulu_plan_commit");
    isError(e, /policies\.signing is 'required' and the commit could not be signed:/, "an SSH signer's own error refuses under required");
    ok(JSON.stringify(e).includes(SSH_ERROR), "...naming the signer's text");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD did not move");
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...and nothing is staged");
  });
}

{
  const repo = specRepo();
  const plan = plannedRepo({ config: { policies: { signing: "auto" } } });
  for (const f of ["docs/PLAN.md", "docs/PROGRESS.md", "docs/kukulu.json", "CLAUDE.md"]) writeFile(repo, f, readFile(plan, f));
  useFakeSigner(repo, mkFakeGpg());
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, "#!/bin/sh\nif head -n1 \"$1\" | grep -q '^plan:'; then echo \"rejected by test hook\" >&2; exit 1; fi\n");
  fs.chmodSync(hook, 0o755);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_plan_commit"), /^git commit failed:/, "a commit that fails for another reason is not turned into a fallback");
    ok(!hasFile(repo, ".kukulu/state.json") || !/signing/.test(JSON.parse(readFile(repo, ".kukulu/state.json")).signing ?? ""), "...state.signing is unchanged");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "true", "...and local commit.gpgsign still reads true");
  });
}

// ---------------------------------------------------------------- rollback

function rejectCommitsStarting(repo, prefix) {
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nif head -n1 "$1" | grep -q '^${prefix}'; then echo "rejected by test hook" >&2; exit 1; fi\n`);
  fs.chmodSync(hook, 0o755);
}

{
  // task_done rolls back when its progress commit fails
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    writeFile(repo, "hello.txt", "hi\n");
    git(repo, ["add", "hello.txt"]);
    git(repo, ["commit", "-qm", "P0-01: hello"]);
    const head = git(repo, ["rev-parse", "HEAD"]);
    const before = readFile(repo, "docs/PROGRESS.md");
    rejectCommitsStarting(repo, "progress:");
    isError(await call("kukulu_task_done", { id: "P0-01", log: "done" }), /commit failed/, "task_done rolls back when its progress commit fails: the call is an error");
    eq(readFile(repo, "docs/PROGRESS.md"), before, "...PROGRESS.md is byte-identical (still in progress)");
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD is the task commit");
  });
}

{
  const repo = plannedRepo();
  rejectCommitsStarting(repo, "chore: flight options");
  const before = readFile(repo, "docs/kukulu.json");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", { maxRounds: 7 }), /commit failed/, "flight_options rolls back when its commit fails: the call is an error");
    eq(readFile(repo, "docs/kukulu.json"), before, "...docs/kukulu.json is byte-identical");
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
  });
}

// ---------------------------------------------------------------- pre-0.6.0 layout (refused since 0.7.0)

{
  const repo = plannedRepo();
  setState(repo, { round: 0 });
  useLegacyLayout(repo);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_start"), /pre-0\.6\.0 Foundry layout, which 0\.7\.0 no longer reads/, "run_start refuses the pre-0.6.0 layout");
    ok(!hasFile(repo, ".foundry/implement.lock") && !hasFile(repo, ".kukulu"), "...arming nothing and creating no .kukulu/");
  });
}

// ---------------------------------------------------------------- PROGRESS.md constraints on task and halt text

const todoRule = (extra = {}) => ({ id: "no-todo", description: "no TODO in the progress log", paths: ["docs/PROGRESS.md"], pattern: "\\bTODO\\b", shouldMatch: ["TODO fix"], shouldNotMatch: ["all done"], ...extra });
const refusal = (field, tool, line) => new RegExp(`^${field} would break constraint no-todo \\(no TODO in the progress log\\) in docs/PROGRESS\\.md at "${line}"; rewrite it without that text and call ${tool} again$`);

{
  const repo = plannedRepo({ config: { constraints: [todoRule()] } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    const before = readFile(repo, "docs/PROGRESS.md");
    const head = git(repo, ["rev-parse", "HEAD"]);
    isError(await call("kukulu_task_done", { id: "P0-01", log: "Added hello.\nleave a TODO for later" }), refusal("log", "kukulu_task_done", "leave a TODO for later"), "task_done refuses a log that breaks a PROGRESS.md constraint");
    eq(readFile(repo, "docs/PROGRESS.md"), before, "...docs/PROGRESS.md is byte-identical");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
    ok((await call("kukulu_task_done", { id: "P0-01", log: "Added hello." })).counts.done === 1, "(the same task is done with a clean log)");
  });
}

{
  const repo = plannedRepo({ config: { constraints: [todoRule()] } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    writeFile(repo, "attempt.txt", "half done\n");
    const before = readFile(repo, "docs/PROGRESS.md");
    const head = git(repo, ["rev-parse", "HEAD"]);
    isError(await call("kukulu_task_block", { id: "P0-01", reason: "needs a TODO list" }), refusal("reason", "kukulu_task_block", "BLOCKED: needs a TODO list"), "task_block refuses a reason that breaks a PROGRESS.md constraint");
    eq(readFile(repo, "docs/PROGRESS.md"), before, "...docs/PROGRESS.md is byte-identical");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
    ok(hasFile(repo, "attempt.txt"), "...and the attempt's uncommitted file is still there, so no reset ran");
  });
}

{
  const repo = plannedRepo({ config: { constraints: [todoRule()] } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    await call("kukulu_task_block", { id: "P0-01", reason: "missing file" });
    const before = readFile(repo, "docs/PROGRESS.md");
    const head = git(repo, ["rev-parse", "HEAD"]);
    isError(await call("kukulu_task_reopen", { id: "P0-01", reason: "now a TODO" }), refusal("reason", "kukulu_task_reopen", "REOPENED: now a TODO"), "task_reopen refuses a reason that breaks a PROGRESS.md constraint");
    eq(readFile(repo, "docs/PROGRESS.md"), before, "...docs/PROGRESS.md is byte-identical");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
  });
}

{
  const repo = plannedRepo({ config: { constraints: [todoRule()] } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    const before = readFile(repo, "docs/PROGRESS.md");
    const head = git(repo, ["rev-parse", "HEAD"]);
    isError(await call("kukulu_run_halt", { reason: "disk full, TODO clean up" }), refusal("reason", "kukulu_run_halt", "disk full, TODO clean up"), "run_halt refuses a reason that breaks a PROGRESS.md constraint");
    eq(readFile(repo, "docs/PROGRESS.md"), before, "...docs/PROGRESS.md is byte-identical");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
  });
}

for (const [label, rule] of [
  ["an inactive constraint", todoRule({ from: "P0-02" })],
  ["a constraint scoped to other paths", todoRule({ paths: ["src/"] })],
  ["a constraint excluded from PROGRESS.md", todoRule({ paths: ["docs/"], exclude: ["docs/PROGRESS.md"] })],
  ["a constraint whose fixtures fail", todoRule({ shouldMatch: ["no such line"] })],
]) {
  const repo = plannedRepo({ config: { constraints: [rule] } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    ok((await call("kukulu_task_done", { id: "P0-01", log: "a TODO in the log" })).counts.done === 1, `${label} does not refuse a task log`);
  });
}

{
  // A directory entry covers the file too.
  const repo = plannedRepo({ config: { constraints: [todoRule({ paths: ["docs"] })] } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    isError(await call("kukulu_task_done", { id: "P0-01", log: "a TODO in the log" }), /^log would break constraint no-todo/, "a constraint on the directory docs covers docs/PROGRESS.md");
  });
}

// ---------------------------------------------------------------- policies.syncBase

/** A started run whose build branch lags `main`: one commit (`base.txt`) is added to main after the branch was cut. */
async function baseAhead(repo, { onBuild = null, onBase = null } = {}) {
  let branch;
  await withServer(repo, async ({ call }) => {
    branch = (await call("kukulu_run_start")).branch;
  });
  if (onBuild) {
    onBuild(branch);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "build side"]);
  }
  git(repo, ["checkout", "-q", "main"]);
  writeFile(repo, "base.txt", "from the base\n");
  if (onBase) onBase();
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "base side"]);
  git(repo, ["checkout", "-q", branch]);
  return branch;
}

{
  const repo = plannedRepo();
  const branch = await baseAhead(repo);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.alreadyStarted + "|" + r.baseSynced.commits, "true|1", "run_start merges an ahead base into an existing build branch");
    eq(subject(repo), `chore: merge main into ${branch}`, "...as chore: merge <base> into <branch>");
    eq(readFile(repo, "base.txt"), "from the base\n", "...and the base's file is present");
    eq(git(repo, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ").length, 3, "...as a merge commit with two parents");
    eq(r.baseSynced.merge, git(repo, ["rev-parse", "--short", "HEAD"]), "...reported by its short sha");
    eq(git(repo, ["status", "--porcelain"]), "", "...leaving a clean tree");
    const again = await call("kukulu_run_start");
    ok(again.baseSynced === undefined, "a second run_start finds nothing to merge");
  });
}

{
  const repo = plannedRepo();
  const branch = await baseAhead(repo);
  await withServer(repo, async ({ call }) => {
    const t = await call("kukulu_task_next");
    eq(t.id + "|" + t.baseSynced.commits, "P0-01|1", "task_next merges an ahead base before choosing a task");
    eq(subject(repo), `chore: merge main into ${branch}`, "...the merge commit comes first");
    eq(readFile(repo, "base.txt"), "from the base\n", "...and the base's file is present");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    const head = git(repo, ["rev-parse", "HEAD"]);
    const t = await call("kukulu_task_next");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "an equal base is not merged: HEAD is unmoved");
    ok(t.baseSynced === undefined, "...and the result has no baseSynced");
  });
}

{
  const repo = plannedRepo();
  const branch = await baseAhead(repo, { onBuild: () => writeFile(repo, "shared.txt", "build\n"), onBase: () => writeFile(repo, "shared.txt", "base\n") });
  const head = git(repo, ["rev-parse", "HEAD"]);
  const file = readFile(repo, "shared.txt");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_task_next"), new RegExp(`^main has 1 commits this branch lacks and they conflict in shared\\.txt; resolve the merge by hand on ${branch.replace(/[/.]/g, "\\$&")}, commit it, then call kukulu_task_next again, or set policies\\.syncBase to false$`), "a conflicting base refuses with the files and the way out");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD is unmoved");
    eq(git(repo, ["status", "--porcelain"]), "", "...the tree is as it was");
    eq(readFile(repo, "shared.txt"), file, "...the conflicting file is byte-identical");
    ok(!hasFile(repo, ".git/MERGE_HEAD"), "...and no merge is left in progress");
    isError(await call("kukulu_run_start"), /conflict in shared\.txt; resolve the merge by hand[\s\S]*kukulu_run_start again/, "run_start refuses the same way, naming itself");
  });
}

{
  const repo = plannedRepo();
  await baseAhead(repo);
  writeFile(repo, "docs/PLAN.md", readFile(repo, "docs/PLAN.md") + "\nedited\n");
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const t = await call("kukulu_task_next");
    eq(t.baseSynced.merge + "|" + t.baseSynced.commits + "|" + /uncommitted/.test(t.baseSynced.skipped), "null|1|true", "a dirty tree skips the base sync and says so");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD is unmoved");
  });
}

{
  const repo = plannedRepo({ config: { policies: { syncBase: false } } });
  await baseAhead(repo);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const t = await call("kukulu_task_next");
    ok(t.baseSynced === undefined && git(repo, ["rev-parse", "HEAD"]) === head && !hasFile(repo, "base.txt"), "syncBase false skips the base sync");
  });
}

{
  const repo = plannedRepo();
  const branch = await baseAhead(repo);
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nif head -n1 "$1" | grep -q '^chore: merge'; then echo rejected >&2; exit 1; fi\n`);
  fs.chmodSync(hook, 0o755);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    ok((await call("kukulu_task_next")).error, "a failed base-sync merge commit leaves HEAD, the tree and the index as they were");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD is unmoved");
    ok(!hasFile(repo, ".git/MERGE_HEAD"), "...no merge is left in progress");
    eq(git(repo, ["status", "--porcelain"]), "", "...the tree is clean");
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    ok(!hasFile(repo, "base.txt"), "...and the base's file is absent on " + branch);
  });
}

{
  const repo = plannedRepo({ config: { policies: { signing: "auto" } } });
  const branch = await baseAhead(repo);
  git(repo, ["config", "commit.gpgsign", "true"]);
  git(repo, ["config", "gpg.format", "openpgp"]);
  git(repo, ["config", "gpg.program", "/nonexistent-signing-agent"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_run_start");
    eq(r.baseSynced?.commits, 1, "a base sync whose signing fails under signing auto is retried unsigned and lands the merge commit");
    eq(subject(repo), `chore: merge main into ${branch}`, "...with the usual subject");
    eq(git(repo, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ").length, 3, "...as a two-parent commit");
    eq(git(repo, ["status", "--porcelain"]), "", "...and a clean tree");
  });
}

{
  const repo = plannedRepo({ config: { policies: { syncBase: "yes" } } });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_run_start"), /docs\/kukulu\.json policies\.syncBase must be a boolean/, "validatePolicies refuses a non-boolean syncBase");
  });
}

finish();
