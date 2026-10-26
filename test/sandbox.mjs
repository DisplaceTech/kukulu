// The sandbox (0.8.0): the relay and the controller socket here; the log
// socket, proxy, container launcher and gate checks join them in later tasks.
// Nothing here needs a container engine, a GPU or a second machine.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { finish, ok, eq, like, ROOT, cleanroomRepo, plannedRepo, setState, startServer, withServer } from "./harness.mjs";
import { startControllerSocket, startLogSocket, main as sandboxMain } from "../scripts/sandbox.mjs";
import { readEntries, verifyChain } from "../mcp/cleanroom.mjs";

// A Unix socket path is limited to about 100 bytes on macOS, so sockets live under a short temp directory.
const shortDir = () => fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "ks-"));

const names = async (s) => (await s.rpc("tools/list", {})).result.tools.map((t) => t.name);

// ---------------------------------------------------------------- the relay and the controller socket (P2-02)

{
  const repo = plannedRepo();
  const dir = shortDir();
  const socketPath = path.join(dir, "c.sock");
  let direct;
  await withServer(repo, async (s) => { direct = await names(s); });

  const controller = startControllerSocket({
    socketPath,
    root: repo,
    pluginRoot: ROOT,
    containerName: "kukulu-test",
    engine: "docker",
    hooksPath: path.join(dir, "hooks-empty"),
    env: { ...process.env, KUKULU_CONFIG: path.join(repo, ".kukulu-test-no-global.json"), KUKULU_PROFILE: "" },
  });
  try {
    await controller.listening;
    const relayed = startServer(repo, { env: { KUKULU_CONTROLLER_SOCKET: socketPath } });
    try {
      await relayed.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "harness", version: "0" } });
      eq((await names(relayed)).join(","), direct.join(","), "the relay answers tools/list through the controller socket with the same tools as direct stdio");
      const status = await relayed.call("kukulu_status");
      eq(status.sandbox, "kukulu-test", "the server behind the controller reports sandbox");
      eq(status.root, repo, "...and works on the controller's project root");
    } finally {
      await relayed.stop();
    }
    await withServer(repo, async (s) => {
      eq((await s.call("kukulu_status")).sandbox, null, "a server with no sandbox reports sandbox null");
    });
  } finally {
    await controller.close();
  }
}

{
  const repo = plannedRepo();
  const dir = shortDir();
  const missing = path.join(dir, "none.sock");
  const s = startServer(repo, { env: { KUKULU_CONTROLLER_SOCKET: missing } });
  s.raw(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`);
  const code = await new Promise((resolve) => s.proc.once("exit", resolve));
  eq(code, 1, "an unreachable controller socket makes the relay exit 1");
  eq(s.messages.length, 1, "...after exactly one message on stdout");
  const msg = s.messages[0];
  eq(msg.id + "|" + msg.error.code, "7|-32000", "...a JSON-RPC error carrying the request's id");
  eq(msg.error.message, `kukulu: cannot reach the controller at ${missing}; the sandbox's controller is not running. Restart the session with node scripts/sandbox.mjs run`, "...with the restart message");
}

{
  const lines = [];
  const code = sandboxMain(["doctor"], { platform: "darwin", stderr: { write: (t) => lines.push(t) } });
  eq(code, 2, "sandbox.mjs refuses on darwin");
  eq(lines.join(""), "scripts/sandbox.mjs runs on Linux; on macOS run it inside a Linux VM that holds the project (see docs/sandbox.md)\n", "...with the message");
  const usage = [];
  eq(sandboxMain([], { platform: "linux", stderr: { write: (t) => usage.push(t) } }), 2, "no subcommand is a usage error");
  like(usage.join(""), /^usage: node scripts\/sandbox\.mjs doctor/, "...printing usage");
}

// ---------------------------------------------------------------- the log socket (P2-03)

// ⚠️ ASSUMPTION: a hook's round trip over the log socket costs under this many milliseconds beyond Node's own startup.
const LOG_SOCKET_BUDGET_MS = 100;

const GUARD = path.join(ROOT, "scripts", "cleanroom-guard.mjs");
const LOGGER = path.join(ROOT, "scripts", "cleanroom-log.mjs");

/** The hook scripts, run asynchronously: an in-process log socket cannot answer while a spawnSync blocks the event loop. */
const runHookAsync = (script, payload, env) => new Promise((resolve) => {
  const started = process.hrtime.bigint();
  const proc = spawn(process.execPath, [script], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => { stdout += d; });
  proc.stderr.on("data", (d) => { stderr += d; });
  proc.on("close", (status) => resolve({ status, stdout, stderr, ms: Number(process.hrtime.bigint() - started) / 1e6 }));
  proc.stdin.end(JSON.stringify(payload));
});

{
  const repo = cleanroomRepo();
  setState(repo, { cleanroom: { genesis: "a".repeat(64) } });
  const dir = shortDir();
  const logPath = path.join(dir, "box-log.jsonl");
  const socketPath = path.join(dir, "l.sock");
  const logSocket = startLogSocket({ socketPath, logPath });
  await logSocket.listening;
  const env = { CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT, KUKULU_LOG_SOCKET: socketPath };
  const projectLog = path.join(repo, ".kukulu", "cleanroom", "log.jsonl");
  try {
    const denial = await runHookAsync(GUARD, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/usr/include/zlib.h" }, cwd: repo, session_id: "s-1" }, env);
    eq(denial.status, 2, "a guard denial over the log socket still exits 2");
    like(denial.stderr, /denied path: \/usr\/include\/zlib\.h \(deny\.paths\)/, "...with the reason on stderr");
    const entries = readEntries(logPath);
    eq(entries.length + "|" + entries[0].kind + "|" + entries[0].data.source, "1|denied|box", "a guard denial sent over the log socket lands in the chain with source box");
    ok(verifyChain(fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean)).ok, "...in a chain that verifies");
    ok(!fs.existsSync(projectLog), "...and the project's own log is untouched");

    const allowed = await runHookAsync(GUARD, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: path.join(repo, "docs", "SPEC.md") }, cwd: repo }, env);
    eq(allowed.status, 0, "an allowed call exits 0 over the log socket");
    eq(readEntries(logPath).length, 1, "...and the guard sends nothing for it");

    const logged = await runHookAsync(LOGGER, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(repo, "docs", "SPEC.md") }, cwd: repo, session_id: "s-1" }, env);
    eq(logged.status, 0, "the logger exits 0 over the log socket");
    const after = readEntries(logPath);
    eq(after.length + "|" + after[1].kind + "|" + after[1].data.source, "2|allowed|box", "a logger entry sent over the log socket lands with source box");
    ok(!fs.existsSync(projectLog), "...and the project's own log is still untouched");

    // the round trip, against the budget: the median logger run minus the median bare Node start, over ten runs each
    const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const bare = [];
    for (let i = 0; i < 10; i++) bare.push((await new Promise((resolve) => { const t = process.hrtime.bigint(); spawn(process.execPath, ["-e", "0"]).on("close", () => resolve(Number(process.hrtime.bigint() - t) / 1e6)); })));
    const hook = [];
    for (let i = 0; i < 10; i++) hook.push((await runHookAsync(LOGGER, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(repo, "docs", "SPEC.md") }, cwd: repo }, env)).ms);
    const cost = median(hook) - median(bare);
    ok(cost < LOG_SOCKET_BUDGET_MS, `a hook round trip over the log socket stays within the budget (${cost.toFixed(1)} ms)`);
  } finally {
    await logSocket.close();
  }

  const gone = { ...env, KUKULU_LOG_SOCKET: path.join(dir, "gone.sock") };
  const guard = await runHookAsync(GUARD, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: path.join(repo, "docs", "SPEC.md") }, cwd: repo }, gone);
  eq(guard.status, 2, "an unreachable log socket makes the guard deny, even for an allowed call");
  eq(guard.stderr, "kukulu clean-room guard: the log socket is unreachable, so this call cannot be logged; restart the session with node scripts/sandbox.mjs run\n", "...with the restart reason");
  const logger = await runHookAsync(LOGGER, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(repo, "docs", "SPEC.md") }, cwd: repo }, gone);
  eq(logger.status, 1, "an unreachable log socket makes the logger exit 1");
  eq(logger.stderr, "kukulu clean-room logger: the log socket is unreachable, so this call cannot be logged; restart the session with node scripts/sandbox.mjs run\n", "...with the reason");
  ok(!fs.existsSync(projectLog), "...and neither wrote the project's log");

  // A reply that is an error is as bad as no reply: here the socket's log path is a directory, so every append fails.
  const broken = startLogSocket({ socketPath: path.join(dir, "bad.sock"), logPath: dir });
  await broken.listening;
  try {
    const r = await runHookAsync(LOGGER, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/x" }, cwd: repo }, { ...env, KUKULU_LOG_SOCKET: path.join(dir, "bad.sock") });
    eq(r.status, 1, "a log socket that replies with an error makes the logger exit 1");
    like(r.stderr, /^kukulu clean-room logger: the log socket is unreachable, so this call cannot be logged; restart the session with node scripts\/sandbox\.mjs run/, "...with the restart reason");
  } finally {
    await broken.close();
  }
}

finish();
