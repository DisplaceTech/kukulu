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

const defaultPort = (protocol) => (protocol === "https:" ? 443 : 80);

/** The `{ host, port }` of a URL (an allow.urls entry or a runner endpoint), with the port defaulted by scheme; null when it is not a URL. */
export function hostPortOf(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^\[|\]$/g, "").toLowerCase(), port: u.port ? Number(u.port) : defaultPort(u.protocol) };
  } catch {
    return null;
  }
}

/**
 * May the flight reach host:port (SPEC C-03)? The roles' runner endpoints always;
 * sandbox.egress and the allow.urls hosts only until lockdown; a literal IP only
 * when one of those lists names that literal; everything else never.
 */
export function egressDecision({ policy, endpoints, lockdown, host, port }) {
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  const runner = (endpoints ?? []).find((e) => String(e.host).toLowerCase() === name && Number(e.port) === Number(port));
  if (runner) return { allowed: true, reason: `runner endpoint ${runner.runner}` };
  const listed = [];
  for (const entry of policy.sandbox?.egress ?? []) {
    const at = entry.lastIndexOf(":");
    listed.push({ host: entry.slice(0, at).toLowerCase(), port: Number(entry.slice(at + 1)), reason: "sandbox.egress" });
  }
  for (const url of policy.allow?.urls ?? []) {
    const hp = hostPortOf(url);
    if (hp) listed.push({ ...hp, reason: "allow.urls" });
  }
  const named = listed.find((l) => l.host === name && l.port === Number(port));
  if (net.isIP(name) && !named) return { allowed: false, reason: "literal IP addresses are not allowed" };
  if (named) return lockdown ? { allowed: false, reason: "lockdown is active" } : { allowed: true, reason: named.reason };
  return { allowed: false, reason: "not allowed by this flight's policy" };
}

/**
 * A CONNECT-only HTTP proxy on a Unix socket (SPEC C-03). `decide(host, port)` returns
 * `{ allowed, reason }`; `record(entry)` hears every decision, a denial at once and an allowed
 * connection when it closes, with its byte counts. TLS is never intercepted: the tunnel is opaque.
 */
export function startProxy({ socketPath, decide, record }) {
  const server = net.createServer((client) => {
    let head = Buffer.alloc(0);
    client.on("error", () => {});
    const refuse = (target, reason) => {
      const body = `kukulu egress: ${target} is not allowed by this flight's policy`;
      client.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      record({ target, decision: "denied", reason });
    };
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        if (head.length > 65536) client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        return;
      }
      client.off("data", onData);
      client.pause();
      const line = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
      let target = null;
      let forward = null;
      let m = /^CONNECT (\S+) HTTP\/1\.[01]$/i.exec(line);
      if (m) {
        const hp = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(m[1]);
        if (hp) target = { host: hp[1].toLowerCase(), port: Number(hp[2]), connect: true };
      } else if ((m = /^[A-Z]+ (http:\/\/\S+) HTTP\/1\.[01]$/i.exec(line))) {
        const hp = hostPortOf(m[1]);
        if (hp) {
          target = { ...hp, connect: false };
          forward = head;
        }
      }
      if (!target) {
        client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        return;
      }
      const label = `${target.host}:${target.port}`;
      const verdict = decide(target.host, target.port);
      if (!verdict.allowed) {
        refuse(label, verdict.reason);
        return;
      }
      const started = Date.now();
      let bytesUp = 0;
      let bytesDown = 0;
      let finished = false;
      const upstream = net.connect(target.port, target.host);
      const done = () => {
        if (finished) return;
        finished = true;
        record({ target: label, decision: "allowed", reason: verdict.reason, data: { bytesUp, bytesDown, ms: Date.now() - started } });
      };
      upstream.on("error", () => {
        if (!finished && !client.writableEnded && bytesDown === 0 && target.connect) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        client.destroy();
        done();
      });
      upstream.once("connect", () => {
        const rest = head.subarray(end + 4);
        if (target.connect) {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (rest.length) {
            bytesUp += rest.length;
            upstream.write(rest);
          }
        } else {
          bytesUp += forward.length;
          upstream.write(forward);
        }
        client.on("data", (d) => { bytesUp += d.length; });
        upstream.on("data", (d) => { bytesDown += d.length; });
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
      upstream.on("close", () => {
        client.destroy();
        done();
      });
      client.on("close", () => {
        upstream.destroy();
        done();
      });
    };
    client.on("data", onData);
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
