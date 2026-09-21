// The implement stage's tools: run_start, task_next, task_done, task_block,
// verify, run_finish. These run unattended, so every refusal matters as much
// as every success — a tool that silently accepts a bad state is a tool that
// lets a flight land somewhere nobody asked for.

import fs from "node:fs";
import path from "node:path";
import {
  finish, ok, eq, like, isError,
  mkDir, plannedRepo, withServer, readFile, writeFile, hasFile, subject,
  commitTask, markTasks, setState, git, mkBareRemote, mkFailingGhBin,
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
  writeFile(repo, ".gitignore", ".foundry/implement.lock\n");
  writeFile(repo, ".foundry/implement.lock", "0\n");
  setState(repo, { round: 0 });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: start implementation run"]);
  return repo;
}

// ---------------------------------------------------------------- run_start

for (const missing of ["docs/SPEC.md", "docs/PLAN.md", "docs/PROGRESS.md", "docs/foundry.json"]) {
  const repo = plannedRepo();
  fs.rmSync(path.join(repo, missing));
  await withServer(repo, async ({ call }) => {
    const escaped = missing.replace(/[/.]/g, "\\$&");
    isError(await call("foundry_run_start"), new RegExp(`${escaped} is missing`), `run_start refuses without ${missing}`);
  });
}

{
  const dir = mkDir();
  for (const f of ["docs/SPEC.md", "docs/PLAN.md"]) writeFile(dir, f, "x");
  writeFile(dir, "docs/foundry.json", '{ "verify": ["true"] }');
  writeFile(dir, "docs/PROGRESS.md", "# p\n\n## Tasks\n\n## Log\n");
  await withServer(dir, async ({ call }) => {
    isError(await call("foundry_run_start"), /not a git repository/, "run_start refuses outside a git repository");
  });
}

{
  // A *tracked* uncommitted change still refuses: it would otherwise ride
  // along into a task's first commit or be stranded switching branches.
  const repo = plannedRepo();
  writeFile(repo, "CLAUDE.md", "# rules\nedited, not committed\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_run_start"), /working tree is dirty on main/, "run_start refuses to branch from a dirty main");
  });
}

{
  // An *untracked* file never blocks a run from starting (F-09): branching
  // off HEAD does not touch it, and it is recorded as pre-existing.
  const repo = plannedRepo();
  writeFile(repo, "stray.txt", "sitting here untracked\n");
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_start");
    eq(r.alreadyStarted, false, "an untracked file alone does not stop the run from starting");
  });
}

{
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", "feature/side-quest"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_run_start"), /runs start from 'main' or an existing 'build\/\*' branch/, "run_start refuses to hijack an unrelated branch");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_start");
    eq(r.alreadyStarted, false, "run_start reports a fresh start");
    eq(r.branch, `build/${TODAY}`, "run_start names the branch after the date");
    eq(r.round, 0, "a fresh run is round 0");
    eq(r.counts.open, 3, "run_start reports the open task count");
    ok(hasFile(repo, ".foundry/implement.lock"), "run_start arms the Stop-hook lock");
    const lock = JSON.parse(readFile(repo, ".foundry/implement.lock"));
    eq(lock.count, 0, "the lock starts its re-block counter at zero");
    eq(lock.round, 0, "the lock records the round it was armed for");
    eq(lock.cap, 60, "the lock carries the default guard cap");
    ok(lock.armedAt, "the lock records when it was armed");
    eq((await call("foundry_status")).lockCounter, 0, "status reads the lock's counter");
    like(readFile(repo, ".gitignore"), /^\.foundry\/implement\.lock$/m, "run_start gitignores the lock");
    like(readFile(repo, "docs/PROGRESS.md"), new RegExp(`^Branch: build/${TODAY}$`, "m"), "run_start stamps the branch into PROGRESS.md");
    like(readFile(repo, "docs/PROGRESS.md"), /^Started: \d{4}-\d\d-\d\dT/m, "run_start stamps a start timestamp");
    eq(subject(repo), "chore: start implementation run", "run_start commits the stamp");
    eq(git(repo, ["status", "--porcelain"]), "", "run_start leaves a clean tree");

    writeFile(repo, ".foundry/implement.lock", JSON.stringify({ ...JSON.parse(readFile(repo, ".foundry/implement.lock")), count: 40 }));
    const again = await call("foundry_run_start");
    eq(again.alreadyStarted, true, "run_start is idempotent while the lock is held");
    eq(subject(repo), "chore: start implementation run", "the idempotent call commits nothing new");
    eq(JSON.parse(readFile(repo, ".foundry/implement.lock")).count, 0, "resuming an already-started run resets the guard's counter");
  });
}

// A second run on the same day gets its own branch rather than stomping one.
{
  const repo = plannedRepo();
  git(repo, ["branch", `build/${TODAY}`]);
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_run_start")).branch, `build/${TODAY}-2`, "run_start sidesteps an existing branch for today");
  });
}

// Resuming on an existing build branch re-arms the lock without re-stamping.
{
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  writeFile(repo, ".gitignore", ".foundry/implement.lock\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: pre-existing"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_start");
    eq(r.alreadyStarted, false, "run_start resumes on an existing build branch");
    eq(r.branch, `build/${TODAY}`, "the existing build branch is reused");
    eq(readFile(repo, ".gitignore").match(/implement\.lock/g).length, 1, "the gitignore entry is not duplicated");
  });
}

{
  const repo = plannedRepo({ config: { branchPrefix: "wip/", baseBranch: "main" } });
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_run_start")).branch, `wip/${TODAY}`, "branchPrefix from foundry.json is honoured");
  });
}

{
  const repo = plannedRepo({ config: { guardCap: 200 } });
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    eq(JSON.parse(readFile(repo, ".foundry/implement.lock")).cap, 200, "a configured guardCap is carried into the lock");
  });
}

// A fix round says so in its bookkeeping commit.
{
  const repo = plannedRepo();
  setState(repo, { round: 2 });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: state"]);
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    eq(subject(repo), "chore: start review-fix round 2", "a fix round's start commit names the round");
  });
}

// ---------------------------------------------------------------- task_next

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    const t = await call("foundry_task_next");
    eq(t.done, false, "task_next hands back a task");
    eq(t.id, "P0-01", "task_next picks the first todo task");
    eq(t.title, "Create hello", "task_next returns the task title");
    like(t.text, /\*\*Goal:\*\* write hello\.txt/, "task_next returns the PLAN.md task text");
    eq(t.files, "hello.txt", "task_next extracts Files touched");
    eq(t.dependsOn.length, 0, "an independent task has no dependencies");
    eq(t.resumed, false, "a freshly picked task is not a resume");
    eq(t.counts.inProgress, 1, "task_next marks the task in progress");
    like(readFile(repo, "docs/PROGRESS.md"), /^- \[~\] P0-01 /m, "the checkbox becomes [~] on disk");

    const same = await call("foundry_task_next");
    eq(same.id, "P0-01", "task_next re-hands the in-progress task after a crash");
    eq(same.resumed, true, "the re-handed task is flagged as a resume");
  });
}

// Dependency logs travel with the task; that is all the implementer gets.
{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    await call("foundry_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("foundry_task_done", { id: "P0-01", log: "Added hello.txt.\nInterpretation: greeting is lowercase." });
    const t = await call("foundry_task_next");
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
    await call("foundry_run_start");
    await call("foundry_task_next");
    await call("foundry_task_block", { id: "P0-01", reason: "tried A / fails B / fix C" });
    const t = await call("foundry_task_next");
    eq(t.done, true, "nothing is left once the chain collapses");
    eq(t.skipped.map((s) => s.id).join(","), "P0-02,P0-03,P0-04", "every dependent is skipped transitively");
    eq(t.skipped[1].dependsOn, "P0-02", "each skip records which dependency stopped it");
    eq(t.counts.skipped, 3, "the skipped count matches");
    eq(subject(repo), "progress: skip P0-02, P0-03, P0-04", "the skips land in one commit");
    like(readFile(repo, "docs/PROGRESS.md"), /### P0-02 — skipped\nSKIPPED: depends on P0-01/, "each skip is logged with its cause");
  });
}

{
  const repo = plannedRepo({ tasks: [{ id: "P0-01", title: "only" }] });
  writeFile(repo, "docs/PLAN.md", "# plan\n## Phase 0 — x\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "break the plan"]);
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    isError(await call("foundry_task_next"), /no '### P0-01: <title>' heading/, "a task with no PLAN.md heading is a hard error");
  });
}

// ---------------------------------------------------------------- task_done

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    isError(await call("foundry_task_done", {}), /id and log are required/, "task_done needs both arguments");
    isError(await call("foundry_task_done", { id: "P9-99", log: "x" }), /not in docs\/PROGRESS\.md/, "task_done rejects an unknown id");
    isError(await call("foundry_task_done", { id: "P0-01", log: "x" }), /is 'todo', not in progress/, "task_done refuses a task that was never selected");

    await call("foundry_task_next");
    isError(await call("foundry_task_done", { id: "P0-01", log: "x" }), /HEAD commit .* is not this task's commit/, "task_done refuses without the task's own commit");

    // Simulate blocked stops piling up the guard's counter before the task lands.
    writeFile(repo, ".foundry/implement.lock", JSON.stringify({ ...JSON.parse(readFile(repo, ".foundry/implement.lock")), count: 12 }));

    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    writeFile(repo, "leftover.txt", "forgotten\n");
    isError(await call("foundry_task_done", { id: "P0-01", log: "x" }), /uncommitted changes remain[\s\S]*leftover\.txt/, "task_done refuses to leave work uncommitted");
    eq(JSON.parse(readFile(repo, ".foundry/implement.lock")).count, 12, "a refused task_done does not touch the guard's counter");

    fs.rmSync(path.join(repo, "leftover.txt"));
    const r = await call("foundry_task_done", { id: "P0-01", log: "Added hello.txt." });
    eq(r.counts.done, 1, "task_done marks the task done");
    eq(r.guardReset, true, "task_done reports that it reset the guard's counter");
    eq(JSON.parse(readFile(repo, ".foundry/implement.lock")).count, 0, "...and the lock's counter is actually back to zero");
    eq(r.taskCommit, git(repo, ["rev-parse", "--short", "HEAD~1"]), "task_done records the task's commit sha");
    like(readFile(repo, "docs/PROGRESS.md"), /^### P0-01 — [0-9a-f]{7,}\nAdded hello\.txt\.$/m, "the log entry is stamped with that sha");
    eq(subject(repo), "progress: P0-01 done", "the bookkeeping commit is separate from the task commit");
    eq(git(repo, ["status", "--porcelain"]), "", "task_done leaves a clean tree");
  });
}

// ---------------------------------------------------------------- task_block

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    isError(await call("foundry_task_block", { id: "P0-01" }), /id and reason are required/, "task_block needs a reason");
    isError(await call("foundry_task_block", { id: "P9-99", reason: "x" }), /not in docs\/PROGRESS\.md/, "task_block rejects an unknown id");

    await call("foundry_task_next");
    writeFile(repo, "half-done.txt", "debris\n");
    writeFile(repo, "docs/SPEC.md", "# Spec\nedited by mistake\n");
    writeFile(repo, ".foundry/implement.lock", JSON.stringify({ ...JSON.parse(readFile(repo, ".foundry/implement.lock")), count: 9 }));
    const r = await call("foundry_task_block", { id: "P0-01", reason: "tried A / fails B / fix C" });
    eq(r.counts.blocked, 1, "task_block marks the task blocked");
    eq(JSON.parse(readFile(repo, ".foundry/implement.lock")).count, 0, "task_block resets the guard's counter too");
    ok(!hasFile(repo, "half-done.txt"), "task_block deletes untracked debris");
    eq(readFile(repo, "docs/SPEC.md"), "# Spec\n", "task_block reverts tracked edits");
    ok(hasFile(repo, ".foundry/implement.lock"), "task_block keeps the run's lock armed");
    like(readFile(repo, "docs/PROGRESS.md"), /### P0-01 — blocked\nBLOCKED: tried A \/ fails B \/ fix C/, "the block reason is logged verbatim");
    eq(subject(repo), "progress: P0-01 blocked", "the block is committed");
  });
}

// ---------------------------------------------------------------- verify

{
  const repo = plannedRepo();
  fs.rmSync(path.join(repo, "docs/foundry.json"));
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_verify"), /docs\/foundry\.json is missing/, "verify needs a config");
  });
}

{
  const repo = plannedRepo({ config: { verify: [] } });
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_verify"), /no 'verify' commands/, "verify needs at least one command");
  });
}

{
  const repo = plannedRepo({
    config: { verify: ["echo base"], extraVerify: { "src/": ["echo base", "echo extra"], "docs/": ["echo docs"] } },
  });
  await withServer(repo, async ({ call }) => {
    let v = await call("foundry_verify");
    eq(v.ok, true, "verify passes when its commands pass");
    eq(v.results.length, 1, "with no files touched, only the base commands run");
    eq(v.results[0].stdoutTail, "base", "verify captures stdout");

    v = await call("foundry_verify", { files: ["src/a.js"] });
    eq(v.results.length, 2, "extraVerify adds commands for a matching prefix");
    eq(v.results[1].command, "echo extra", "the extra command is the one configured for that prefix");

    v = await call("foundry_verify", { files: ["src/a.js", "docs/b.md"] });
    eq(v.results.length, 3, "several prefixes can match at once");

    v = await call("foundry_verify", { files: "src/a.js, docs/b.md" });
    eq(v.results.length, 3, "files may arrive as a delimited string");

    v = await call("foundry_verify", { files: ["README.md"] });
    eq(v.results.length, 1, "a non-matching path adds nothing");
  });
}

{
  const repo = plannedRepo({ config: { verify: ["echo out; echo boom >&2; exit 3"] } });
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.ok, false, "a failing command fails the whole verify");
    eq(v.results[0].exitCode, 3, "the exit code is reported");
    eq(v.results[0].stderrTail, "boom", "stderr is reported");
    eq(v.results[0].timedOut, false, "a plain failure is not a timeout");
  });
}

{
  const repo = plannedRepo({ config: { verify: ["seq 1 100"] } });
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.results[0].stdoutTail.split("\n").length, 60, "output is trimmed to the last 60 lines");
    eq(v.results[0].stdoutTail.split("\n")[0], "41", "the tail is the end of the output, not the start");
  });
}

{
  const repo = plannedRepo({ config: { verify: ["sleep 30"], commandTimeoutMs: 300 } });
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.ok, false, "a hung command fails rather than hanging the flight");
    eq(v.results[0].timedOut, true, "the timeout is reported as such");
  });
}

// ---------------------------------------------------------------- pre-existing untracked files

{
  const repo = plannedRepo();
  writeFile(repo, "FOUNDRY_FEEDBACK.md", "notes predating this run\n");
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    const s = await call("foundry_status");
    eq(s.preexistingUntracked.join(","), "FOUNDRY_FEEDBACK.md", "run_start records what was already untracked");

    await call("foundry_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    const r = await call("foundry_task_done", { id: "P0-01", log: "Added hello.txt." });
    eq(r.counts.done, 1, "task_done succeeds with the pre-existing file still untracked");
    ok(hasFile(repo, "FOUNDRY_FEEDBACK.md"), "the file is untouched");

    await call("foundry_task_next");
    const blocked = await call("foundry_task_block", { id: "P0-02", reason: "tried A / fails B / fix C" });
    eq(blocked.counts.blocked, 1, "task_block succeeds with the pre-existing file present");
    ok(hasFile(repo, "FOUNDRY_FEEDBACK.md"), "task_block's git clean spares it, rather than deleting it");

    await call("foundry_task_next"); // P0-03, skipped as a dependent of the blocked P0-02
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const f = await call("foundry_run_finish");
    ok(f.readyLine, "run_finish succeeds with the pre-existing file still present");
    ok(hasFile(repo, "FOUNDRY_FEEDBACK.md"), "...and it is still there afterwards");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    await call("foundry_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    writeFile(repo, "surprise.txt", "created mid-task, not before the run\n");
    isError(
      await call("foundry_task_done", { id: "P0-01", log: "x" }),
      /uncommitted changes remain[\s\S]*surprise\.txt/,
      "a file created *after* run_start still fails task_done, listing it by name",
    );
    isError(
      await call("foundry_task_done", { id: "P0-01", log: "x" }),
      /git checkout --.*git clean/,
      "the refusal says to commit, checkout or clean it - never to move or tidy it away",
    );
  });
}

// ---------------------------------------------------------------- run_finish

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    isError(await call("foundry_run_finish"), /3 task\(s\) still open/, "run_finish refuses with open tasks");
  });
}

{
  const repo = startedRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_run_finish"), /docs\/HANDOFF\.md does not exist/, "run_finish requires a handoff");

    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    writeFile(repo, "surprise.txt", "not committed\n");
    isError(await call("foundry_run_finish"), /working tree is not clean[\s\S]*surprise\.txt/, "run_finish refuses to hand off a dirty tree");

    fs.rmSync(path.join(repo, "surprise.txt"));
    const r = await call("foundry_run_finish");
    eq(r.push, "skipped: no origin remote", "run_finish says so when there is nowhere to push");
    eq(r.pr, null, "no remote means no pull request");
    eq(r.counts.done, 3, "run_finish reports the final counts");
    like(r.readyLine, /^READY FOR REVIEW — branch build\/.*3 done \/ 0 blocked \/ 0 skipped of 3$/, "the ready line summarises the run");
    ok(!hasFile(repo, ".foundry/implement.lock"), "run_finish disarms the Stop-hook lock");
    eq(subject(repo), "chore: round 0 implemented", "run_finish records the round as implemented");
    eq(JSON.parse(readFile(repo, ".foundry/state.json")).implemented, true, "the implemented flag is persisted");
    eq(git(repo, ["status", "--porcelain"]), "", "run_finish leaves a clean tree");
  });
}

{
  const repo = startedRepo();
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_finish");
    eq(r.push, "pushed", "run_finish pushes when an origin exists");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "the remote has the branch");
  }, noGh);
}

{
  const repo = startedRepo();
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
  git(repo, ["remote", "add", "origin", "/nonexistent/foundry-remote.git"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_finish");
    like(r.push, /^failed: /, "a failed push is reported, not swallowed");
    ok(!hasFile(repo, ".foundry/implement.lock"), "a failed push still ends the run cleanly");
  }, noGh);
}

// ---------------------------------------------------------------- run policies

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_start");
    eq(r.policies.signing, "auto", "policies.signing defaults to auto");
    eq(r.policies.push, true, "policies.push defaults to true");
    eq(r.policies.pr, "draft", "policies.pr defaults to draft");
    eq(r.signing, "none", "with commit.gpgsign unset (the test fixture's default), the outcome is none");
    eq((await call("foundry_status")).policies.signing, "auto", "status reports the recorded policies");
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
    isError(await call("foundry_run_start"), re, `run_start refuses a malformed policies.${Object.keys(bad.policies)[0]}`);
    isError(await call("foundry_status"), re, "...and so does status, since cfg() validates on every read");
  });
}

{
  const repo = plannedRepo({ config: { policies: { signing: "off" } } });
  git(repo, ["config", "commit.gpgsign", "true"]); // as if a global/local signing setup were already active
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_start");
    eq(r.signing, "off", "policies.signing: off records off without even probing");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "false", "...and disables signing locally");
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
    isError(await call("foundry_run_start"), /policies\.signing is 'required'.*signing probe failed/s, "required signing that cannot actually sign refuses to start");
  });
}

{
  const repo = plannedRepo({ config: { policies: { signing: "auto" } } });
  git(repo, ["config", "commit.gpgsign", "true"]);
  git(repo, ["config", "gpg.format", "openpgp"]);
  git(repo, ["config", "gpg.program", "/nonexistent-signing-agent"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_start");
    like(r.signing, /^off \(probe failed: /, "auto falls back to off and records why, rather than refusing");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "false", "...and disables signing locally so the first task commit does not hang");
  });
}

{
  const repo = plannedRepo({ config: { policies: { push: false } } });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    await call("foundry_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("foundry_task_done", { id: "P0-01", log: "x" });
    await call("foundry_task_block", { id: "P0-02", reason: "x / y / z" });
    await call("foundry_task_next"); // skips P0-03, the blocked task's dependent
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const r = await call("foundry_run_finish");
    eq(r.push, "skipped: policy", "push: false skips the push even though a remote exists");
    eq(r.pr, null, "no push means no pull request either");
  }, noGh);
}

{
  const repo = plannedRepo({ config: { policies: { pr: "none" } } });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    await call("foundry_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("foundry_task_done", { id: "P0-01", log: "x" });
    await call("foundry_task_block", { id: "P0-02", reason: "x / y / z" });
    await call("foundry_task_next"); // skips P0-03, the blocked task's dependent
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const r = await call("foundry_run_finish");
    eq(r.push, "pushed", "push still happens; only the PR is policy-gated");
    eq(r.pr, "skipped: policy", "pr: none skips PR creation, reported explicitly");
  });
}

// ---------------------------------------------------------------- run_halt

{
  const repo = startedRepo();
  writeFile(repo, "half-finished.txt", "in-flight work, not this tool's business to touch\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_run_halt", {}), /reason is required/, "run_halt needs a reason");

    const r = await call("foundry_run_halt", { reason: "signing agent died: connection refused" });
    eq(r.halted, "signing agent died: connection refused", "run_halt reports the reason it recorded");
    ok(!hasFile(repo, ".foundry/implement.lock"), "run_halt disarms the lock");
    eq(JSON.parse(readFile(repo, ".foundry/state.json")).halted, "signing agent died: connection refused", "the reason is persisted in state");
    ok(hasFile(repo, "half-finished.txt"), "run_halt never resets or cleans the tree");
    ok(r.dirty, "run_halt reports that the tree is still dirty");

    const n = await call("foundry_next");
    eq(n.stage, "halt", "the flight now halts");
    eq(n.reason, "signing agent died: connection refused", "...with the recorded reason");
  });
}

finish();
