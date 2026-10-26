// The sandbox (0.8.0): the relay and the controller socket here; the log
// socket, proxy, container launcher and gate checks join them in later tasks.
// Nothing here needs a container engine, a GPU or a second machine.

import fs from "node:fs";
import path from "node:path";
import { finish, eq, like, ROOT, mkDir, plannedRepo, startServer, withServer } from "./harness.mjs";
import { startControllerSocket, main as sandboxMain } from "../scripts/sandbox.mjs";

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

finish();
