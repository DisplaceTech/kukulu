// The sandbox launcher (SPEC C-01, C-02). This file grows by task: the
// controller socket here, then the log socket, the proxy, `doctor`, `run` and
// `stop`. It imports node: modules and ../mcp/cleanroom.mjs only.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendEntry } from "../mcp/cleanroom.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node scripts/sandbox.mjs doctor\n       node scripts/sandbox.mjs run [-- <harness arguments>]\n       node scripts/sandbox.mjs stop\n";

/**
 * Serve the MCP server over a Unix socket: each connection gets its own copy of
 * the real server, run here, outside the container, where the key and the
 * project's .kukulu live. Closing the connection kills that copy.
 */
export function startControllerSocket({ socketPath, root, pluginRoot = PLUGIN_ROOT, containerName, engine, hooksPath, env = process.env }) {
  const children = new Set();
  const server = net.createServer({ allowHalfOpen: true }, (conn) => {
    const childEnv = {
      ...env,
      KUKULU_PROJECT_DIR: root,
      KUKULU_SANDBOX: containerName,
      KUKULU_SANDBOX_ENGINE: engine,
      KUKULU_SANDBOX_HOOKS_PATH: hooksPath,
    };
    delete childEnv.KUKULU_CONTROLLER_SOCKET;
    const child = spawn(process.execPath, [path.join(pluginRoot, "mcp", "server.mjs")], { env: childEnv, stdio: ["pipe", "pipe", "inherit"] });
    children.add(child);
    conn.pipe(child.stdin);
    child.stdout.pipe(conn);
    // A client that goes away mid-write must not take the controller down.
    child.stdin.on("error", () => {});
    conn.on("error", () => child.kill());
    conn.on("close", () => child.kill());
    child.on("exit", () => {
      children.delete(child);
      conn.end();
    });
  });
  if (fs.existsSync(socketPath)) fs.rmSync(socketPath, { force: true });
  server.listen(socketPath);
  return {
    listening: new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    }),
    close() {
      for (const child of children) child.kill();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The log socket (SPEC C-02): the hooks inside the container send each entry here, and it is appended to the
 * chain outside, with data.source "box" so a reader can tell which entries were reported from inside. Each
 * line in is one entry's fields; each line out is `{ seq, hash }` or `{ error }`.
 */
export function startLogSocket({ socketPath, logPath }) {
  const server = net.createServer({ allowHalfOpen: true }, (conn) => {
    let buffered = "";
    conn.setEncoding("utf8");
    conn.on("data", (chunk) => {
      buffered += chunk;
      let nl;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (!line.trim()) continue;
        let reply;
        try {
          const fields = JSON.parse(line);
          fields.data = { ...(fields.data ?? {}), source: "box" };
          const entry = appendEntry(logPath, fields);
          reply = { seq: entry.seq, hash: entry.hash };
        } catch (e) {
          reply = { error: e instanceof Error ? e.message : String(e) };
        }
        conn.write(`${JSON.stringify(reply)}\n`);
      }
    });
    conn.on("end", () => conn.end());
    conn.on("error", () => {});
  });
  if (fs.existsSync(socketPath)) fs.rmSync(socketPath, { force: true });
  server.listen(socketPath);
  return {
    listening: new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function main(argv, { platform = process.platform, env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  void env;
  void cwd;
  void stdout;
  if (platform === "darwin") {
    stderr.write("scripts/sandbox.mjs runs on Linux; on macOS run it inside a Linux VM that holds the project (see docs/sandbox.md)\n");
    return 2;
  }
  // The subcommands are filled in by the tasks that build them.
  stderr.write(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
