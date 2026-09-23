// Parallel workstreams (v0.4.0): stream tags, waves, partition validation,
// stream-scoped tools, worktrees and merge-back. Streams change how a flight
// flows, so every claim about them gets a real git repo and the real server.

import fs from "node:fs";
import path from "node:path";
import {
  finish, ok, eq, like, isError,
  plannedRepo, withServer, readFile, writeFile, hasFile,
  markTasks, setState, git, subject,
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

finish();
