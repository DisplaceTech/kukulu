// Parallel workstreams (v0.4.0): stream tags, waves, partition validation,
// stream-scoped tools, worktrees and merge-back. Streams change how a flight
// flows, so every claim about them gets a real git repo and the real server.

import fs from "node:fs";
import path from "node:path";
import {
  finish, ok, eq, like, isError,
  plannedRepo, withServer, readFile, writeFile, hasFile,
  markTasks, setState, git, subject, commitTask, runGuard,
} from "./harness.mjs";

/** One task with concrete backticked Files touched; `stream` tags both PLAN.md and PROGRESS.md. */
const T = (id, files, extra = {}) => ({ id, title: `Task ${id}`, goal: `do ${id}`, files: files.map((f) => `\`${f}\``).join(", "), ...extra });

// serial, serial, [a, a, b, b], serial
const WAVE_PLAN = [
  T("P0-01", ["package.json"]),
  T("P0-02", ["docs/"]),
  T("P1-01", ["src/api/a.txt"], { stream: "api" }),
  T("P1-02", ["src/api/b.txt"], { stream: "api", depends: ["P1-01"] }),
  T("P1-03", ["src/ui/a.txt"], { stream: "ui" }),
  T("P1-04", ["src/ui/b.txt"], { stream: "ui" }),
  T("P2-01", ["README.md"]),
];

const wavesOf = async (repo, config) => {
  let waves;
  await withServer(repo, async ({ call }) => { waves = (await call("foundry_status")).waves; });
  return waves;
};

// ---------------------------------------------------------------- V4-01: waves and validation

{
  const waves = await wavesOf(plannedRepo({ tasks: WAVE_PLAN }));
  eq(waves.length, 1, "serial x2, a wave of two streams, then serial x1 is one wave");
  eq(waves[0].index, 1, "waves are numbered from 1");
  eq(waves[0].valid, true, "a disjoint two-stream wave is valid");
  eq(waves[0].reason, null, "...with no reason");
  eq(waves[0].streams.map((s) => `${s.stream}:${s.tasks.join("+")}`).join(","), "api:P1-01+P1-02,ui:P1-03+P1-04", "each stream lists its tasks in order");
  eq(waves[0].streams.map((s) => s.open).join(","), "2,2", "per-stream open counts");
}

{
  const tasks = [
    T("P0-01", ["a"], { stream: "x" }), T("P0-02", ["b"], { stream: "y" }),
    T("P0-03", ["c"]),
    T("P0-04", ["d"], { stream: "x" }), T("P0-05", ["e"], { stream: "y" }),
  ];
  const waves = await wavesOf(plannedRepo({ tasks }));
  eq(waves.length, 2, "two separated runs of streamed tasks are two waves");
  eq(waves.map((w) => w.index).join(","), "1,2", "numbered in order");
  eq(waves.every((w) => w.valid), true, "both valid");
}

{
  const repo = plannedRepo({ tasks: [T("P0-01", ["a"]), T("P0-02", ["b"])] });
  eq((await wavesOf(repo)).length, 0, "a plan with no streams has no waves");
}

// A path shared across streams.
{
  const tasks = [T("P0-01", ["src/shared.txt", "src/a.txt"], { stream: "a" }), T("P0-02", ["src/shared.txt"], { stream: "b" })];
  const [w] = await wavesOf(plannedRepo({ tasks }));
  eq(w.valid, false, "a path shared across streams makes the wave invalid");
  like(w.reason, /P0-01 \(stream a\) and P0-02 \(stream b\) both touch `src\/shared\.txt`/, "the reason names both tasks and the path");
}

// A directory token overlapping the other stream's file, in either direction.
for (const [da, db] of [["src/lib/", "src/lib/x.txt"], ["src/lib/x.txt", "src/lib/"], ["src/lib/", "src/lib/sub/"]]) {
  const tasks = [T("P0-01", [da], { stream: "a" }), T("P0-02", [db], { stream: "b" })];
  const [w] = await wavesOf(plannedRepo({ tasks }));
  eq(w.valid, false, `${da} vs ${db}: a directory overlapping a path under it is a conflict`);
  like(w.reason, /overlap/, "...reported as an overlap");
}

// The same path inside one stream is fine.
{
  const tasks = [T("P0-01", ["src/x.txt"], { stream: "a" }), T("P0-02", ["src/x.txt"], { stream: "a" }), T("P0-03", ["src/y.txt"], { stream: "b" })];
  const [w] = await wavesOf(plannedRepo({ tasks }));
  eq(w.valid, true, "two tasks of one stream may touch the same path");
}

// Cross-stream dependency inside the wave; a pre-wave dependency is fine.
{
  const tasks = [
    T("P0-01", ["root.txt"]),
    T("P1-01", ["a.txt"], { stream: "a", depends: ["P0-01"] }),
    T("P1-02", ["b.txt"], { stream: "b", depends: ["P0-01", "P1-01"] }),
  ];
  const [w] = await wavesOf(plannedRepo({ tasks }));
  eq(w.valid, false, "a dependency on a task of a different stream in the same wave is invalid");
  like(w.reason, /P1-02 \(stream b\) depends on P1-01 \(stream a\)/, "the reason names both tasks");
  const fine = [T("P0-01", ["root.txt"]), T("P1-01", ["a.txt"], { stream: "a", depends: ["P0-01"] }), T("P1-02", ["b.txt"], { stream: "b", depends: ["P0-01"] })];
  eq((await wavesOf(plannedRepo({ tasks: fine })))[0].valid, true, "a dependency on a pre-wave task is fine");
}

// A single-stream wave.
{
  const tasks = [T("P0-01", ["a"], { stream: "only" }), T("P0-02", ["b"], { stream: "only" })];
  const [w] = await wavesOf(plannedRepo({ tasks }));
  eq(w.valid, false, "a single-stream wave is invalid");
  like(w.reason, /only one stream/, "...with that reason");
}

// A streamed task with no concrete paths cannot be proven disjoint.
{
  const tasks = [T("P0-01", ["a"], { stream: "a" }), { id: "P0-02", title: "vague", files: "somewhere in src", stream: "b" }];
  const [w] = await wavesOf(plannedRepo({ tasks }));
  eq(w.valid, false, "a streamed task listing no backticked paths makes the wave invalid");
  like(w.reason, /P0-02 lists no backticked paths/, "...and names the task");
}

// PLAN.md and PROGRESS.md must agree.
{
  const tasks = [T("P0-01", ["a"], { stream: "a" }), T("P0-02", ["b"], { stream: "b", planStream: "c" })];
  const [w] = await wavesOf(plannedRepo({ tasks }));
  eq(w.valid, false, "a task whose PLAN.md stream disagrees with its PROGRESS.md tag invalidates its wave");
  like(w.reason, /P0-02: docs\/PLAN\.md says Stream 'c' but docs\/PROGRESS\.md tags it 'b'/, "...naming the task");
  const tasks2 = [T("P0-01", ["a"], { stream: "a" }), T("P0-02", ["b"], { stream: "b", planStream: "none" })];
  like((await wavesOf(plannedRepo({ tasks: tasks2 })))[0].reason, /says Stream none/, "a PLAN.md task with no Stream against a tag disagrees too");
}

// Exclusive commands.
{
  const tasks = [T("P0-01", ["src/a.txt"], { stream: "a" }), T("P0-02", ["tests/integration/t.txt"], { stream: "b" })];
  const config = { extraVerify: { "tests/integration/": [{ cmd: "wp-env run tests", exclusive: true }] } };
  const [w] = await wavesOf(plannedRepo({ tasks, config }));
  eq(w.valid, false, "a wave task under an extraVerify prefix holding an exclusive command is invalid");
  like(w.reason, /P0-02 touches tests\/integration\/, whose extraVerify includes an exclusive command/, "the reason names the task and the prefix");

  const dir = [T("P0-01", ["src/a.txt"], { stream: "a" }), T("P0-02", ["tests/"], { stream: "b" })];
  eq((await wavesOf(plannedRepo({ tasks: dir, config })))[0].valid, false, "a task touching a directory that contains the prefix is caught too");

  const plain = { extraVerify: { "tests/integration/": [{ cmd: "wp-env run tests" }] } };
  eq((await wavesOf(plannedRepo({ tasks, config: plain })))[0].valid, true, "the same command without exclusive is fine");

  const inVerify = { verify: [{ cmd: "wp-env run all", exclusive: true }] };
  const [v] = await wavesOf(plannedRepo({ tasks: [T("P0-01", ["a"], { stream: "a" }), T("P0-02", ["b"], { stream: "b" })], config: inVerify }));
  eq(v.valid, false, "an exclusive command in verify itself invalidates every wave");
  like(v.reason, /a verify command is exclusive/, "...saying why");
}

// The {stream: x} tag round-trips: it is parsed off the title and written back
// verbatim when the task's state changes. A single-stream wave is invalid, so
// it is served serially and task_next may pick a tagged task directly.
{
  const tasks = [T("P0-01", ["a"], { stream: "only" }), T("P0-02", ["b"], { stream: "only" })];
  const repo = plannedRepo({ tasks });
  like(readFile(repo, "docs/PROGRESS.md"), /- \[ \] P0-01 Task P0-01 \{stream: only\}\n/, "PROGRESS.md carries the tag");
  await withServer(repo, async ({ call }) => {
    const t = await call("foundry_task_next");
    eq(t.id, "P0-01", "the tagged task is picked");
    like(readFile(repo, "docs/PROGRESS.md"), /- \[~\] P0-01 Task P0-01 \{stream: only\}\n/, "marking it in progress keeps the tag, once, and the title clean");
    like(readFile(repo, "docs/PROGRESS.md"), /- \[ \] P0-02 Task P0-02 \{stream: only\}\n/, "an untouched tagged line is unchanged");
  });
}

// A tag written without the space keeps its exact spelling.
{
  const repo = plannedRepo({ tasks: [T("P0-01", ["a"], { stream: "only" }), T("P0-02", ["b"], { stream: "only" })] });
  fs.writeFileSync(path.join(repo, "docs/PROGRESS.md"), readFile(repo, "docs/PROGRESS.md").replace("{stream: only}", "{stream:only}"));
  await withServer(repo, async ({ call }) => {
    await call("foundry_task_next");
    like(readFile(repo, "docs/PROGRESS.md"), /- \[~\] P0-01 Task P0-01 \{stream:only\}\n/, "the tag is preserved byte for byte, not normalised");
  });
}

// Config validation.
for (const [bad, re, label] of [
  [{ maxStreams: 0 }, /parallel\.maxStreams must be a positive integer/, "maxStreams 0"],
  [{ maxStreams: "3" }, /parallel\.maxStreams must be a positive integer/, 'maxStreams "3"'],
  [{ foo: 1 }, /parallel has an unknown key 'foo'/, "an unknown parallel key"],
  [{ setup: "npm ci" }, /parallel\.setup must be an array/, "setup as a string"],
  [{ setup: [{ cmd: "x", exclusive: "yes" }] }, /parallel\.setup\[0\]\.exclusive must be a boolean/, "a non-boolean exclusive"],
]) {
  await withServer(plannedRepo({ config: { parallel: bad } }), async ({ call }) => {
    isError(await call("foundry_status"), re, `${label} refuses`);
  });
}
await withServer(plannedRepo({ config: { verify: [{ cmd: "true", exclusive: "yes" }] } }), async ({ call }) => {
  isError(await call("foundry_status"), /verify\[0\]\.exclusive must be a boolean/, "exclusive on a verify command must be a boolean");
});


// ---------------------------------------------------------------- V4-02: stream-scoped tools

/** WAVE_PLAN with the serial tasks before the wave already done, so the wave is current. */
function waveRepo({ tasks = WAVE_PLAN, config = {} } = {}) {
  const repo = plannedRepo({ tasks, config });
  markTasks(repo, { "P0-01": "x", "P0-02": "x" });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: serial tasks done"]);
  return repo;
}
const progressOf = (repo) => readFile(repo, "docs/PROGRESS.md");
const stateOf = (repo) => JSON.parse(readFile(repo, ".foundry/state.json"));

{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_run_start", { stream: "api" });
    eq(r.stream, "api", "run_start echoes the stream");
    eq(r.wave, 1, "...and the wave");
    ok(path.isAbsolute(r.cwd), "it returns an absolute worktree path");
    eq(r.cwd, path.join(repo, ".foundry", "worktrees", "api"), "...under .foundry/worktrees/<stream>");
    eq(r.created, true, "the worktree was created");
    like(r.streamBranch, /^build\/[\d-]+--api$/, "on a branch named <build-branch>--<stream>");
    like(git(repo, ["branch", "--list", r.streamBranch]), /--api/, "that branch exists");
    eq(git(r.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]), r.streamBranch, "and the worktree has it checked out");
    like(readFile(repo, ".gitignore"), /^\.foundry\/worktrees\/$/m, "the run's .gitignore gains the worktrees line");
    eq(git(repo, ["status", "--porcelain", "--untracked-files=all"]).split("\n").filter((l) => l.includes("worktrees")).length, 0, "the worktree does not show up as untracked in the main checkout");

    const again = await call("foundry_run_start", { stream: "api" });
    eq(again.cwd, r.cwd, "run_start is idempotent: same cwd");
    eq(again.created, false, "...and nothing is created twice");
    eq(again.alreadyStarted, true, "...on top of an already-started run");
  });
}

// Refusals.
{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_run_start", { stream: "nope" }), /stream 'nope' is not available in the current wave \(wave 1\); legal streams: api, ui/, "an unknown stream lists the legal ones");
    isError(await call("foundry_run_start", { stream: "Bad Name" }), /must be a lowercase slug/, "a malformed stream name is refused");
    isError(await call("foundry_task_next", { stream: "nope" }), /legal streams: api, ui/, "task_next refuses an unknown stream too");
  });
  const plain = plannedRepo({ tasks: [T("P0-01", ["a"]), T("P0-02", ["b"])] });
  await withServer(plain, async ({ call }) => {
    isError(await call("foundry_run_start", { stream: "api" }), /no parallel streams; omit the stream argument/, "a stream argument on a plan without streams is refused");
  });
  // The wave is not current while a serial task before it is still open.
  const early = plannedRepo({ tasks: WAVE_PLAN });
  await withServer(early, async ({ call }) => {
    isError(await call("foundry_run_start", { stream: "api" }), /no parallel wave is current/, "a wave behind an open serial task is not current");
  });
}

{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    const a = await call("foundry_run_start", { stream: "api" });
    const b = await call("foundry_run_start", { stream: "ui" });
    const ta = await call("foundry_task_next", { stream: "api" });
    eq(ta.id, "P1-01", "task_next({stream: api}) returns api's first task");
    eq(ta.stream, "api", "...echoing the stream");
    const tb = await call("foundry_task_next", { stream: "ui" });
    eq(tb.id, "P1-03", "task_next({stream: ui}) returns ui's first task, never an api one");
    like(progressOf(repo), /- \[~\] P1-01 Task P1-01 \{stream: api\}\n/, "both are in progress at once, tags intact");
    like(progressOf(repo), /- \[~\] P1-03 Task P1-03 \{stream: ui\}\n/, "...in one PROGRESS.md");

    // A serial call may not reach into a parallel wave.
    isError(await call("foundry_task_next"), /belongs to parallel wave 1 \(streams: api, ui\).*foundry_next/, "a stream-less task_next refuses while the wave runs parallel");

    // Commit in the worktree, then task_done from the stream.
    commitTask(a.cwd, "P1-01", "Task P1-01", { "src/api/a.txt": "a\n" });
    const buildBranch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const d = await call("foundry_task_done", { stream: "api", id: "P1-01", log: "did a" });
    eq(d.stream, "api", "task_done echoes the stream");
    like(progressOf(repo), /- \[x\] P1-01 Task P1-01 \{stream: api\}\n/, "the task is done in the main checkout's PROGRESS.md, tag intact");
    like(progressOf(repo), /### P1-01 — [0-9a-f]+\ndid a/, "its log entry carries the worktree commit's sha");
    eq(git(repo, ["log", "-1", "--format=%s", buildBranch]), "progress: P1-01 done", "the progress commit is on the build branch");
    ok(!git(a.cwd, ["log", "--format=%s", `${buildBranch}..${a.streamBranch}`]).includes("progress:"), "...and never on the stream branch");
    eq(git(a.cwd, ["log", "--format=%s", `${buildBranch}..${a.streamBranch}`]), "P1-01: Task P1-01", "the stream branch holds only the task's own commit");
    ok(!hasFile(repo, "src/api/a.txt"), "the task's file is in the worktree, not the main checkout");

    // task_done refuses another stream's task, and a stream without a matching HEAD commit.
    isError(await call("foundry_task_done", { stream: "api", id: "P1-03", log: "x" }), /task P1-03 belongs to stream 'ui', not 'api'/, "task_done refuses another stream's task");
    isError(await call("foundry_task_done", { stream: "ui", id: "P1-03", log: "x" }), /HEAD commit .* is not this task's commit/, "the HEAD check runs in the stream's worktree");

    // Interleave: b commits and finishes while a moves on.
    commitTask(b.cwd, "P1-03", "Task P1-03", { "src/ui/a.txt": "u\n" });
    await call("foundry_task_done", { stream: "ui", id: "P1-03", log: "did u" });
    const ta2 = await call("foundry_task_next", { stream: "api" });
    eq(ta2.id, "P1-02", "a's next task follows a's own order");
    const tb2 = await call("foundry_task_next", { stream: "ui" });
    eq(tb2.id, "P1-04", "and b's follows b's");
    commitTask(b.cwd, "P1-04", "Task P1-04", { "src/ui/b.txt": "u2\n" });
    commitTask(a.cwd, "P1-02", "Task P1-02", { "src/api/b.txt": "a2\n" });
    await call("foundry_task_done", { stream: "api", id: "P1-02", log: "did a2" });
    await call("foundry_task_done", { stream: "ui", id: "P1-04", log: "did u2" });
    const prog = progressOf(repo);
    for (const id of ["P1-01", "P1-02", "P1-03", "P1-04"]) {
      eq((prog.match(new RegExp(`^- \\[x\\] ${id} `, "m")) || []).length, 1, `${id} is done exactly once after interleaved calls`);
      eq((prog.match(new RegExp(`^### ${id} — `, "gm")) || []).length, 1, `${id} has exactly one log entry`);
    }
    eq((await call("foundry_task_next", { stream: "api" })).done, true, "a stream with nothing left reports done, even though its wave is over and the next open task is serial");
    isError(await call("foundry_task_next"), /stream worktree\(s\) still exist \(api, ui\); merge each back with foundry_stream_finish/, "serial work is refused while finished streams are still unmerged");
    eq(git(repo, ["status", "--porcelain", "--untracked-files=no"]), "", "the main checkout ends with a clean tracked tree");
  });
}

// task_block in a stream resets that worktree only.
{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    const a = await call("foundry_run_start", { stream: "api" });
    await call("foundry_run_start", { stream: "ui" });
    await call("foundry_task_next", { stream: "api" });
    const tb = await call("foundry_task_next", { stream: "ui" });
    writeFile(a.cwd, "src/api/half.txt", "half-done\n");
    fs.writeFileSync(path.join(a.cwd, "package.json.bak"), "x");
    writeFile(repo, "precious.txt", "keep me\n"); // untracked in the main checkout
    const b = await call("foundry_task_block", { stream: "api", id: "P1-01", reason: "cannot" });
    eq(b.stream, "api", "task_block echoes the stream");
    ok(!hasFile(a.cwd, "src/api/half.txt"), "the worktree's uncommitted files are discarded");
    ok(hasFile(repo, "precious.txt"), "an untracked file in the main checkout is untouched");
    like(progressOf(repo), /- \[!\] P1-01 Task P1-01 \{stream: api\}\n/, "the task is blocked, tag intact");
    like(progressOf(repo), new RegExp(`- \\[~\\] ${tb.id} `), "another stream's in-progress mark survives the block");
    like(progressOf(repo), /### P1-01 — blocked\nBLOCKED: cannot/, "the block is logged");
    const next = await call("foundry_task_next", { stream: "api" });
    eq(next.skipped.map((x) => x.id).join(","), "P1-02", "a blocked task's dependent in the same stream is skipped");
  });
}

// verify({ stream }) runs in the worktree, and refuses an exclusive command.
{
  const repo = waveRepo({ config: { verify: ["pwd > .cwd-proof"], extraVerify: { "tests/integration/": [{ cmd: "true", exclusive: true }] } } });
  await withServer(repo, async ({ call }) => {
    const a = await call("foundry_run_start", { stream: "api" });
    const v = await call("foundry_verify", { stream: "api" });
    eq(v.ok, true, "verify runs in the stream");
    eq(readFile(a.cwd, ".cwd-proof").trim(), fs.realpathSync(a.cwd), "...from the worktree, not the main checkout");
    ok(!hasFile(repo, ".cwd-proof"), "nothing ran in the main checkout");
    isError(await call("foundry_verify", { stream: "api", files: ["tests/integration/t.php"] }), /"true" is exclusive: it only runs from the main checkout/, "a selection that includes an exclusive command refuses");
    const main = await call("foundry_verify", { files: ["tests/integration/t.php"] });
    eq(main.ok, true, "...while the same call without stream runs it from the main checkout");
    eq(readFile(repo, ".cwd-proof").trim(), fs.realpathSync(repo), "which is where it ran");
  });
}

// The serial fallback: a wave already degraded to serial is served by a stream-less task_next.
{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start"); // the ordinary start, on the build branch
    setState(repo, { serialWaves: [{ wave: 1, category: "stream-partition", reason: "test" }] });
    isError(await call("foundry_run_start", { stream: "api" }), /legal streams: none/, "a degraded wave no longer hands out streams");
    const t = await call("foundry_task_next");
    eq(t.id, "P1-01", "...and is served serially by a stream-less task_next");
  });
  const one = waveRepo({ config: { parallel: { maxStreams: 1 } } });
  await withServer(one, async ({ call }) => {
    eq((await call("foundry_task_next")).id, "P1-01", "maxStreams 1 serves every wave serially");
  });
}

// parallel.setup runs once per new worktree; a failing setup degrades the wave to serial.
{
  const repo = waveRepo({ config: { parallel: { setup: ["echo x >> .setup-ran"] } } });
  await withServer(repo, async ({ call }) => {
    const a = await call("foundry_run_start", { stream: "api" });
    eq(a.setup.length, 1, "run_start reports the setup results");
    eq(readFile(a.cwd, ".setup-ran"), "x\n", "setup ran in the new worktree");
    await call("foundry_run_start", { stream: "api" });
    eq(readFile(a.cwd, ".setup-ran"), "x\n", "and does not run again on resume");
    like(JSON.stringify(stateOf(repo).streams.api.preexistingUntracked), /\.setup-ran/, "what setup left untracked is recorded, so it is not mistaken for the task's changes");
    commitTask(a.cwd, "P1-01", "Task P1-01", { "src/api/a.txt": "a\n" });
    await call("foundry_task_next", { stream: "api" });
    const d = await call("foundry_task_done", { stream: "api", id: "P1-01", log: "ok" });
    ok(d.taskCommit, "task_done ignores the untracked files setup left behind");
  });
}
{
  const repo = waveRepo({ config: { parallel: { setup: ["echo boom >&2; exit 3"] } } });
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_run_start", { stream: "api" }), /setup command "echo boom >&2; exit 3" failed for stream api: boom\. Wave 1 now runs serially/, "a failing setup command refuses, saying the wave now runs serially");
    ok(!hasFile(repo, ".foundry/worktrees/api"), "the worktree is removed");
    eq(git(repo, ["branch", "--list", "*--api"]), "", "...and so is the stream branch");
    eq(stateOf(repo).serialWaves.map((w) => `${w.wave}:${w.category}`).join(","), "1:stream-setup", "the wave is recorded in serialWaves");
    const fb = readFile(repo, ".foundry/feedback.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    eq(fb.length, 1, "exactly one feedback entry");
    eq(fb[0].category, "stream-setup", "...of category stream-setup");
    eq(fb[0].source, "auto", "...written by the MCP itself");
    eq(subject(repo), "chore: wave 1 runs serially", "committed together with the state change");
    isError(await call("foundry_run_start", { stream: "ui" }), /legal streams: none/, "no other stream of that wave is handed out afterwards");
    eq((await call("foundry_task_next")).id, "P1-01", "and the wave is now served serially");
  });
}


// ---------------------------------------------------------------- V4-03: stream_finish

/** Work one stream's tasks start to finish: run_start, then task_next / commit / task_done per task. */
async function workStream(call, stream, work) {
  const started = await call("foundry_run_start", { stream });
  for (const [id, file, body] of work) {
    const t = await call("foundry_task_next", { stream });
    eq(t.id, id, `${stream}: task_next hands out ${id}`);
    commitTask(started.cwd, id, `Task ${id}`, { [file]: body });
    await call("foundry_task_done", { stream, id, log: `did ${id}` });
  }
  return started;
}
const API = [["P1-01", "src/api/a.txt", "a\n"], ["P1-02", "src/api/b.txt", "b\n"]];
const UI = [["P1-03", "src/ui/a.txt", "u\n"], ["P1-04", "src/ui/b.txt", "v\n"]];

{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    const a = await workStream(call, "api", API);
    const u = await workStream(call, "ui", UI);
    const build = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);

    const f1 = await call("foundry_stream_finish", { stream: "api" });
    eq(f1.merged, true, "the first stream merges");
    ok(f1.mergeCommit, "and reports its merge commit");
    eq(f1.remainingStreams.join(","), "ui", "remainingStreams names the other stream");
    ok(!hasFile(repo, ".foundry/worktrees/api"), "the worktree is removed");
    eq(git(repo, ["branch", "--list", a.streamBranch]), "", "the stream branch is deleted");
    eq(subject(repo), "merge stream api (wave 1)", "the merge commit says which stream and wave");
    eq(readFile(repo, "src/api/a.txt"), "a\n", "the stream's files are in the main checkout");
    ok(!hasFile(repo, "src/ui/a.txt"), "the other stream's are not, yet");

    const f2 = await call("foundry_stream_finish", { stream: "ui" });
    eq(f2.merged, true, "the second stream merges");
    eq(f2.remainingStreams.length, 0, "nothing remains");
    eq(git(repo, ["log", "--merges", "--format=%s", `${git(repo, ["merge-base", "main", "HEAD"])}..HEAD`]).split("\n").filter((l) => l.startsWith("merge stream")).length, 2, "two merge commits, one per stream");
    const log = git(repo, ["log", "--format=%s"]);
    for (const id of ["P1-01", "P1-02", "P1-03", "P1-04"]) like(log, new RegExp(`^${id}: Task ${id}$`, "m"), `${id}'s commit is reachable from the build branch`);
    eq(git(repo, ["worktree", "list"]).split("\n").length, 1, "no worktrees remain");
    eq(git(repo, ["status", "--porcelain", "--untracked-files=no"]), "", "the main checkout is clean");
    eq(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), build, "still on the build branch");
    const t = await call("foundry_task_next");
    eq(t.id, "P2-01", "serial work resumes once every stream is merged");
    void u;
  });
}

// A stream whose tasks were all blocked still merges (a no-op) and cleans up.
{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start", { stream: "api" });
    await call("foundry_task_next", { stream: "api" });
    await call("foundry_task_block", { stream: "api", id: "P1-01", reason: "cannot" });
    await call("foundry_task_next", { stream: "api" }); // skips P1-02, which depends on the blocked task
    const f = await call("foundry_stream_finish", { stream: "api" });
    eq(f.merged, true, "a wholly blocked stream still finishes");
    eq(f.mergeCommit, null, "with no merge commit, since it had nothing to merge");
    ok(!hasFile(repo, ".foundry/worktrees/api"), "and its worktree is cleaned up");
  });
}

// Refusals.
{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_stream_finish", { stream: "api" }), /legal streams: api, ui|has no worktree/, "a stream that was never started cannot be finished");
    const a = await call("foundry_run_start", { stream: "api" });
    await call("foundry_task_next", { stream: "api" });
    isError(await call("foundry_stream_finish", { stream: "api" }), /stream 'api' still has open tasks: P1-01, P1-02/, "open tasks refuse, naming them");
    commitTask(a.cwd, "P1-01", "Task P1-01", { "src/api/a.txt": "a\n" });
    await call("foundry_task_done", { stream: "api", id: "P1-01", log: "ok" });
    await call("foundry_task_next", { stream: "api" });
    commitTask(a.cwd, "P1-02", "Task P1-02", { "src/api/b.txt": "b\n" });
    await call("foundry_task_done", { stream: "api", id: "P1-02", log: "ok" });
    writeFile(a.cwd, "src/api/stray.txt", "left over\n");
    isError(await call("foundry_stream_finish", { stream: "api" }), /uncommitted changes in its worktree:\n\?\? src\/api\/stray\.txt/, "a dirty worktree refuses, listing the files");
    ok(hasFile(a.cwd, "src/api/stray.txt"), "...and leaves it alone");
    fs.rmSync(path.join(a.cwd, "src/api/stray.txt"));
    eq((await call("foundry_stream_finish", { stream: "api" })).merged, true, "once clean it merges");
  });
}

// run_finish refuses while a stream worktree exists.
{
  const repo = waveRepo({ tasks: WAVE_PLAN.slice(0, 6) });
  await withServer(repo, async ({ call }) => {
    await workStream(call, "api", API);
    await workStream(call, "ui", UI);
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    isError(await call("foundry_run_finish"), /stream worktree\(s\) still exist \(api, ui\); merge each back with foundry_stream_finish/, "run_finish refuses with unmerged worktrees, naming them");
    await call("foundry_stream_finish", { stream: "api" });
    await call("foundry_stream_finish", { stream: "ui" });
    const r = await call("foundry_run_finish");
    ok(r.commit || r.branch, "run_finish succeeds once every stream is merged");
  });
}

// A merge conflict (the partition said the streams were disjoint; the commits say otherwise) halts, recoverably.
{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    const a = await call("foundry_run_start", { stream: "api" });
    const u = await call("foundry_run_start", { stream: "ui" });
    for (const [stream, cwd, first, second, marker] of [["api", a.cwd, "P1-01", "P1-02", "from api"], ["ui", u.cwd, "P1-03", "P1-04", "from ui"]]) {
      await call("foundry_task_next", { stream });
      commitTask(cwd, first, `Task ${first}`, { "shared.txt": `${marker}\n` });
      await call("foundry_task_done", { stream, id: first, log: "ok" });
      await call("foundry_task_next", { stream });
      commitTask(cwd, second, `Task ${second}`, { [`${stream}-only.txt`]: "x\n" });
      await call("foundry_task_done", { stream, id: second, log: "ok" });
    }
    const first = await call("foundry_stream_finish", { stream: "api" });
    eq(first.merged, true, "the first stream merges cleanly");
    const second = await call("foundry_stream_finish", { stream: "ui" });
    eq(second.merged, false, "the second conflicts");
    like(second.halted, /merging stream 'ui' .* conflicted in shared\.txt/, "the halt reason names the stream and the conflicting path");
    like(second.halted, /git merge --no-ff .*--ui.*git worktree remove --force \.foundry\/worktrees\/ui.*clear 'halted'/, "and the manual steps");
    eq(second.conflicts.join(","), "shared.txt", "the conflicting paths are returned");
    eq(git(repo, ["status", "--porcelain", "--untracked-files=no"]), "", "the merge is aborted: the main checkout is clean");
    ok(!hasFile(repo, ".git/MERGE_HEAD"), "no merge is left in progress");
    ok(hasFile(u.cwd, "shared.txt"), "the stream's worktree is kept");
    like(git(repo, ["branch", "--list", u.streamBranch]), /--ui/, "and so is its branch");
    eq(readFile(repo, "shared.txt"), "from api\n", "the build branch still holds the first stream's version");
    const n = await call("foundry_next");
    eq(n.stage, "halt", "foundry_next now says halt");
    like(n.reason, /conflicted/, "with the reason");
    const fb = readFile(repo, ".foundry/feedback.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    eq(fb.filter((e) => e.category === "stream-merge").length, 1, "exactly one stream-merge feedback entry");
    eq(fb[0].source, "auto", "written by the MCP");
    eq(subject(repo), "chore: run halted (stream ui merge conflict)", "state and feedback are committed together");
  });
}


// ---------------------------------------------------------------- V4-04: foundry_next hands out waves

const feedbackOf = (repo) => (hasFile(repo, ".foundry/feedback.jsonl") ? readFile(repo, ".foundry/feedback.jsonl").trim().split("\n").map((l) => JSON.parse(l)) : []);

{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.stage, "implement", "a current wave is an implement stage");
    eq(n.streams.length, 2, "a valid two-stream wave returns both streams");
    eq(n.streams.map((x) => x.stream).join(","), "api,ui", "in plan order");
    ok(n.streams[0].prompt !== n.streams[1].prompt, "with distinct prompts");
    like(n.streams[0].prompt, /stream `api` of wave 1.*foundry_run_start with stream: "api".*cwd.*foundry_stream_finish with stream: "api".*do not call foundry_run_finish/, "each prompt names its stream and the whole loop");
    like(n.streams[1].prompt, /stream `ui`/, "the second names its own");
    like(n.streams[0].prompt, /Run policies: signing=/, "and ends with the run policies");
    eq(n.streams[0].agent, n.agent, "each entry carries the stage's agent");
    ok("agentModel" in n.streams[0] && "agentFallback" in n.streams[0] && "agentModelExact" in n.streams[0], "and the fallback fields");
    like(n.reason, /wave 1: 2 stream\(s\) to run in parallel \(api, ui\)/, "the reason says so");
    eq(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "main", "next() on the base branch changed nothing");
  });
}

// maxStreams 1 disables parallelism silently.
{
  const repo = waveRepo({ config: { parallel: { maxStreams: 1 } } });
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    const n = await call("foundry_next");
    eq(n.stage, "implement", "still an implement stage");
    ok(!("streams" in n), "maxStreams 1 returns no streams");
    eq(feedbackOf(repo).length, 0, "and logs nothing: it is the operator's choice");
  });
}

// Three streams, maxStreams 2: the first two go out, the third after they finish.
{
  const tasks = [
    T("P0-01", ["package.json"]),
    T("P1-01", ["src/a.txt"], { stream: "a" }), T("P1-02", ["src/b.txt"], { stream: "b" }), T("P1-03", ["src/c.txt"], { stream: "c" }),
  ];
  const repo = plannedRepo({ tasks, config: { parallel: { maxStreams: 2 } } });
  markTasks(repo, { "P0-01": "x" });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "serial done"]);
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.streams.map((x) => x.stream).join(","), "a,b", "the first maxStreams streams go out");
    await workStream(call, "a", [["P1-01", "src/a.txt", "a\n"]]);
    await workStream(call, "b", [["P1-02", "src/b.txt", "b\n"]]);
    const mid = await call("foundry_next");
    eq(mid.streams.map((x) => x.stream).join(","), "a,b", "finished-but-unmerged streams are offered first, so they get merged");
    await call("foundry_stream_finish", { stream: "a" });
    await call("foundry_stream_finish", { stream: "b" });
    const after = await call("foundry_next");
    eq(after.streams.map((x) => x.stream).join(","), "c", "the third goes out on the next foundry_next");
    await workStream(call, "c", [["P1-03", "src/c.txt", "c\n"]]);
    const last = await call("foundry_next");
    eq(last.streams.map((x) => x.stream).join(","), "c", "and is offered until it is merged, though the plan has no open tasks left");
    await call("foundry_stream_finish", { stream: "c" });
    const done = await call("foundry_next");
    ok(!("streams" in done), "once every stream is merged, no streams are offered");
    like(done.reason, /lock present but no open tasks|no handoff/, "the flight falls through to the ordinary handoff");
  });
}

// An unfinished stream is handed out again (a stopped implementer is not a stuck flight).
{
  const repo = waveRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start", { stream: "api" });
    await call("foundry_task_next", { stream: "api" });
    const n = await call("foundry_next");
    eq(n.streams.map((x) => x.stream).join(","), "api,ui", "an in-flight stream comes first and is re-handed out");
    const again = await call("foundry_run_start", { stream: "api" });
    eq(again.created, false, "run_start resumes its worktree");
    const t = await call("foundry_task_next", { stream: "api" });
    eq(t.resumed, true, "and task_next resumes the in-progress task");
  });
}

// An invalid partition degrades the wave to serial: once recorded, once logged, never halting.
{
  const tasks = [T("P0-01", ["shared.txt"], { stream: "a" }), T("P0-02", ["shared.txt"], { stream: "b" })];
  const repo = plannedRepo({ tasks });
  await withServer(repo, async ({ call }) => {
    const before = await call("foundry_next");
    ok(!("streams" in before), "an invalid wave offers no streams");
    eq(feedbackOf(repo).length, 0, "before a run starts on a build branch, nothing is recorded on the base branch");
    eq(git(repo, ["log", "--format=%s", "-1"]), "plan: derive build plan from SPEC", "no commit landed on the base branch");

    await call("foundry_run_start");
    for (let i = 0; i < 3; i++) {
      const n = await call("foundry_next");
      eq(n.stage, "implement", `call ${i + 1}: the flight is not halted`);
      ok(!("streams" in n), `call ${i + 1}: still serial`);
    }
    const fb = feedbackOf(repo);
    eq(fb.length, 1, "exactly one feedback entry across three foundry_next calls");
    eq(fb[0].category, "stream-partition", "of category stream-partition");
    eq(fb[0].stage, "plan", "against the plan stage, since a bad partition is a planning defect");
    like(fb[0].message, /Wave 1 runs serially: .*both touch `shared\.txt`/, "naming the conflict");
    eq(git(repo, ["log", "--format=%s"]).split("\n").filter((l) => l === "chore: wave 1 runs serially").length, 1, "and exactly one 'wave 1 runs serially' commit");
    eq(stateOf(repo).serialWaves.length, 1, "state records the wave once");
    const t = await call("foundry_task_next");
    eq(t.id, "P0-01", "the wave's tasks are served serially");
  });
}

// An exclusive verify command makes every wave serial, logged once per flight.
{
  const tasks = [
    T("P0-01", ["a"], { stream: "a" }), T("P0-02", ["b"], { stream: "b" }),
    T("P0-03", ["c"]),
    T("P0-04", ["d"], { stream: "a" }), T("P0-05", ["e"], { stream: "b" }),
  ];
  const repo = plannedRepo({ tasks, config: { verify: [{ cmd: "true", exclusive: true }] } });
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    await call("foundry_next");
    eq(feedbackOf(repo).length, 1, "one stream-exclusive entry for the first wave");
    eq(feedbackOf(repo)[0].category, "stream-exclusive", "of category stream-exclusive");
    markTasks(repo, { "P0-01": "x", "P0-02": "x", "P0-03": "x" });
    await call("foundry_next");
    eq(stateOf(repo).serialWaves.map((w) => w.wave).join(","), "1,2", "the second wave is recorded serial too");
    eq(feedbackOf(repo).length, 1, "but the flight-wide cause is logged only once");
  });
}


// ---------------------------------------------------------------- V4-05: pausing at a wave boundary

// A serial implementer that has finished everything before a wave is told to
// stop — not refused — and the guard hook lets it.
{
  const repo = plannedRepo({ tasks: WAVE_PLAN });
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    const stopInput = { hook_event_name: "SubagentStop", agent_type: "foundry-implementer", cwd: repo };
    for (const [id, file] of [["P0-01", "package.json"], ["P0-02", "docs/notes.md"]]) {
      const t = await call("foundry_task_next");
      eq(t.id, id, `the serial implementer gets ${id}`);
      commitTask(repo, id, `Task ${id}`, { [file]: "x\n" });
      await call("foundry_task_done", { id, log: "ok" });
    }
    const p = await call("foundry_task_next");
    eq(p.done, true, "at the boundary task_next reports done");
    eq(p.paused, true, "...and paused");
    eq(p.wave, 1, "naming the wave");
    eq(p.streams.join(","), "api,ui", "and its streams");
    like(p.message, /P1-01.*wave 1.*Stop now\. Do NOT write docs\/HANDOFF\.md and do NOT call foundry_run_finish/, "with an unmistakable instruction not to finish the run");
    eq(p.counts.open, 5, "the plan's open tasks are still open");
    eq(JSON.parse(readFile(repo, ".foundry/implement.lock")).paused, 1, "the lock is flagged paused");
    eq(runGuard(repo, stopInput), "", "so the guard lets the serial implementer stop with tasks open");
    isError(await call("foundry_run_finish"), /open task|foundry_task_next|HANDOFF/i, "and run_finish is refused anyway, the safety net if the instruction is ignored");

    const n = await call("foundry_next");
    eq(n.streams.length, 2, "the controller's next foundry_next hands out the wave");
    const a = await call("foundry_run_start", { stream: "api" });
    await call("foundry_task_next", { stream: "api" });
    commitTask(a.cwd, "P1-01", "Task P1-01", { "src/api/a.txt": "a\n" });
    await call("foundry_task_done", { stream: "api", id: "P1-01", log: "ok" });
    ok(!("paused" in JSON.parse(readFile(repo, ".foundry/implement.lock"))), "any task state change clears the flag");
  });
}

// A degraded (serial) wave is not a boundary: the serial implementer just carries on.
{
  const repo = waveRepo({ config: { parallel: { maxStreams: 1 } } });
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    const t = await call("foundry_task_next");
    eq(t.id, "P1-01", "a wave that runs serially is worked by the serial implementer");
    ok(!("paused" in t), "with no pause");
    ok(!("paused" in JSON.parse(readFile(repo, ".foundry/implement.lock"))), "and no flag on the lock");
  });
}

// Skips at the boundary are still committed.
{
  const tasks = [
    T("P0-01", ["package.json"]),
    T("P0-02", ["docs/x.md"], { depends: ["P0-01"] }),
    T("P1-01", ["src/api/a.txt"], { stream: "api" }), T("P1-02", ["src/ui/a.txt"], { stream: "ui" }),
  ];
  const repo = plannedRepo({ tasks });
  await withServer(repo, async ({ call }) => {
    await call("foundry_run_start");
    await call("foundry_task_next");
    await call("foundry_task_block", { id: "P0-01", reason: "cannot" });
    const p = await call("foundry_task_next");
    eq(p.paused, true, "after a block and a dependency skip the boundary is still reported");
    eq(p.skipped.map((x) => x.id).join(","), "P0-02", "with the skip reported");
    eq(subject(repo), "progress: skip P0-02", "and the skip committed");
  });
}


// ---------------------------------------------------------------- V4-08: status reports the longest command timeout

{
  await withServer(plannedRepo({ config: { verify: ["true"] } }), async ({ call }) => {
    eq((await call("foundry_status")).longestCommandTimeoutMs, 600000, "the default command timeout when nothing overrides it");
  });
  const config = {
    verify: [{ cmd: "true", timeoutMs: 1000 }],
    extraVerify: { "tests/": [{ cmd: "true", timeoutMs: 900000 }] },
    parallel: { setup: [{ cmd: "true", timeoutMs: 1200000 }] },
  };
  await withServer(plannedRepo({ config }), async ({ call }) => {
    eq((await call("foundry_status")).longestCommandTimeoutMs, 1200000, "the longest of verify, extraVerify and parallel.setup wins");
  });
  await withServer(plannedRepo({ config: { verify: [] } }), async ({ call }) => {
    eq((await call("foundry_status")).longestCommandTimeoutMs, null, "null with no commands");
  });
}

finish();
