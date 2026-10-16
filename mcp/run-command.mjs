#!/usr/bin/env node
// Run one shell command for the Kūkulu MCP server, bounded in time and in
// output, and print one JSON line describing what happened.
//
// The server's tool handlers are synchronous on purpose (one call at a time
// is what keeps PROGRESS.md and state.json safe), so it cannot supervise a
// child asynchronously itself. It runs this script with spawnSync instead,
// and this script does the supervising:
//
// - the command runs in its own process group, so a timeout kills the whole
//   tree (`make` → `cargo test` → a spinning test binary), not just the shell;
// - only a bounded tail of each stream is kept in memory, and a command that
//   writes more than `maxOutputBytes` in total is killed — a runaway mutant
//   printing forever can no longer exhaust the server's memory;
// - once the shell itself has exited, a grandchild still holding stdout or
//   stderr open gets `orphanGraceMs` to let go before its group is killed,
//   so a leftover background process cannot hang the call either.
//
// Input: one JSON argument { cmd, cwd, timeoutMs, maxOutputBytes, keepBytes,
// orphanGraceMs }. Output: one JSON line { exitCode, signal, timedOut,
// outputLimitExceeded, orphansKilled, stdout, stderr, stdoutBytes,
// stderrBytes }. POSIX only, like the rest of the plugin.

import { spawn } from "node:child_process";

const spec = JSON.parse(process.argv[2] || "{}");
const { cmd, cwd, timeoutMs, maxOutputBytes, keepBytes, orphanGraceMs = 2000 } = spec;
const KILL_GRACE_MS = 2000;

const child = spawn(cmd, { cwd, shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"] });

let timedOut = false;
let outputLimitExceeded = false;
let orphansKilled = false;
let exitCode = null;
let signal = null;
let totalBytes = 0;
let finished = false;

/** A stream's last `keepBytes` bytes, plus how many it produced in all. */
function collector() {
  const c = { chunks: [], kept: 0, bytes: 0 };
  c.push = (buf) => {
    c.bytes += buf.length;
    c.chunks.push(buf);
    c.kept += buf.length;
    while (c.chunks.length > 1 && c.kept - c.chunks[0].length >= keepBytes) c.kept -= c.chunks.shift().length;
  };
  c.text = () => {
    const all = Buffer.concat(c.chunks);
    return all.subarray(Math.max(0, all.length - keepBytes)).toString("utf8");
  };
  return c;
}
const out = collector();
const err = collector();

function killGroup(sig) {
  try {
    process.kill(-child.pid, sig);
  } catch {
    // the group is already gone
  }
}

/** SIGTERM the whole group, then SIGKILL whatever is still there. */
function stopGroup() {
  killGroup("SIGTERM");
  setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref();
}

const onData = (c) => (buf) => {
  c.push(buf);
  totalBytes += buf.length;
  if (!outputLimitExceeded && totalBytes > maxOutputBytes) {
    outputLimitExceeded = true;
    stopGroup();
  }
};
child.stdout.on("data", onData(out));
child.stderr.on("data", onData(err));

const timer = setTimeout(() => {
  timedOut = true;
  stopGroup();
}, timeoutMs);

let orphanTimer = null;
child.on("exit", (code, sig) => {
  exitCode = code;
  signal = sig;
  // The shell is gone; anything still holding our pipes is a leftover child.
  orphanTimer = setTimeout(() => {
    orphansKilled = true;
    killGroup("SIGKILL");
    child.stdout.destroy();
    child.stderr.destroy();
    report();
  }, orphanGraceMs);
});

child.on("close", report);
child.on("error", (e) => {
  err.push(Buffer.from(`${e.message}\n`));
  report();
});

// If the server's own backstop timeout kills this script, take the group down too.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => {
    killGroup("SIGKILL");
    process.exit(1);
  });
}

function report() {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (orphanTimer) clearTimeout(orphanTimer);
  // A command this script stopped is stopped for good, even a part of it
  // that ignored SIGTERM and had already let go of the pipes.
  if (timedOut || outputLimitExceeded) killGroup("SIGKILL");
  process.stdout.write(
    `${JSON.stringify({
      exitCode,
      signal,
      timedOut,
      outputLimitExceeded,
      orphansKilled,
      stdout: out.text(),
      stderr: err.text(),
      stdoutBytes: out.bytes,
      stderrBytes: err.bytes,
    })}\n`,
    () => process.exit(0),
  );
}
