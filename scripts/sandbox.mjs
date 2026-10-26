// The sandbox launcher (SPEC C-01, C-02). This file grows by task: the
// controller socket here, then the log socket, the proxy, `doctor`, `run` and
// `stop`. It imports node: modules and ../mcp/cleanroom.mjs only.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendEntry, loadPolicy, CleanroomError } from "../mcp/cleanroom.mjs";

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

// ---------------------------------------------------------------- the plan and the container's arguments (SPEC C-01)

/** The project's identity for names and directories: 16 hex characters of the SHA-256 of its real path. */
export function projectIdFor(root) {
  return createHash("sha256").update(fs.realpathSync(root)).digest("hex").slice(0, 16);
}

/** Where the sockets live: `$XDG_RUNTIME_DIR/kukulu/<id>/`, else `~/.cache/kukulu/run/<id>/`. */
export function runtimeDirFor(projectId, env = process.env) {
  if (env.XDG_RUNTIME_DIR) return path.join(env.XDG_RUNTIME_DIR, "kukulu", projectId);
  return path.join(env.HOME || os.homedir(), ".cache", "kukulu", "run", projectId);
}

const expandPath = (entry, root, home) => {
  if (entry === "~" || entry.startsWith("~/")) return path.join(home, entry.slice(1));
  return path.resolve(root, entry);
};

const CREDENTIAL_ENV = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"];

/**
 * Everything `containerArgs` needs and `doctor`, `run` and the gate read, in one object. Nothing is
 * decided later: the mount list is the policy's, plus the fixed read-only set below.
 */
export function planFor({ policy, root, pluginRoot, runtimeDir, projectId, engine, harnessArgs = [], tty = false, env = process.env, policyPath = path.join(root, "docs", "cleanroom.json") }) {
  const home = env.HOME || os.homedir();
  const digest = /@(sha256:[0-9a-f]{64})$/.exec(policy.sandbox.image ?? "")?.[1] ?? null;
  const fixed = {
    KUKULU_CONTROLLER_SOCKET: "/run/kukulu/controller.sock",
    KUKULU_LOG_SOCKET: "/run/kukulu/log.sock",
    HTTPS_PROXY: "http://127.0.0.1:3128",
    HTTP_PROXY: "http://127.0.0.1:3128",
    NODE_USE_ENV_PROXY: "1",
    DISABLE_TELEMETRY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  for (const key of CREDENTIAL_ENV) if (env[key]) fixed[key] = env[key];
  return {
    engine,
    name: `kukulu-${projectId}`,
    home: `kukulu-${projectId}-home`,
    image: digest,
    imageName: (policy.sandbox.image ?? "").replace(/@sha256:[0-9a-f]{64}$/, ""),
    root,
    pluginRoot,
    runtimeDir,
    policyPath,
    readOnly: [
      policyPath,
      path.join(root, ".kukulu"),
      path.join(root, ".claude"),
      path.join(root, ".git", "config"),
      path.join(root, ".git", "hooks"),
      path.join(root, ".git", "info"),
      path.join(root, "docs", "SPEC.md"),
      pluginRoot,
    ],
    mounts: (policy.sandbox.mounts ?? []).map((m) => expandPath(m.path, root, home)),
    priorArt: (policy.control?.priorArt ?? []).map((p) => expandPath(p, root, home)),
    env: fixed,
    tty,
    harnessArgs,
  };
}

/** The exact `run` argument list. No other flag, ever (SPEC C-01). */
export function containerArgs(plan) {
  const args = ["run", "--rm", "--init", "--name", plan.name, "--network", "none", "--read-only", "--tmpfs", "/tmp", "--user", "kukulu", "-w", plan.root, "-i"];
  if (plan.tty) args.push("-t");
  args.push("-v", `${plan.root}:${plan.root}`);
  for (const p of [...plan.readOnly, ...plan.mounts, ...plan.priorArt]) args.push("-v", `${p}:${p}:ro`);
  args.push("-v", `${plan.runtimeDir}:/run/kukulu`, "-v", `${plan.home}:/home/kukulu`);
  for (const [k, v] of Object.entries(plan.env)) args.push("-e", `${k}=${v}`);
  args.push(plan.image, path.join(plan.pluginRoot, "scripts", "sandbox-entry.mjs"), ...plan.harnessArgs);
  return args;
}

// ---------------------------------------------------------------- doctor (SPEC C-01)

/** The policy file's path and its loaded policy for a project, honouring docs/kukulu.json's cleanroom.policy. */
function loadProjectPolicy(root) {
  let rel = "docs/cleanroom.json";
  try {
    const named = JSON.parse(fs.readFileSync(path.join(root, "docs", "kukulu.json"), "utf8"))?.cleanroom?.policy;
    if (typeof named === "string" && named) rel = named;
  } catch {
    // no config, or not JSON: the default applies
  }
  const policyPath = path.resolve(root, rel);
  return { policyPath, policy: loadPolicy(fs.readFileSync(policyPath, "utf8")) };
}

/** Each role's model, runner, endpoint and locality, read from the real server's `kukulu_config_show`. */
function readRunners(root, pluginRoot, env) {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sandbox-doctor", version: "0" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "kukulu_config_show", arguments: {} } },
  ];
  const childEnv = { ...env, KUKULU_PROJECT_DIR: root };
  delete childEnv.KUKULU_CONTROLLER_SOCKET;
  const run = spawnSync(process.execPath, [path.join(pluginRoot, "mcp", "server.mjs")], { input: messages.map((m) => JSON.stringify(m)).join("\n") + "\n", encoding: "utf8", env: childEnv, timeout: 30000 });
  for (const line of (run.stdout || "").split("\n").filter(Boolean)) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== 2) continue;
    if (msg.error) throw new Error(msg.error.message);
    const text = msg.result?.content?.[0]?.text ?? "";
    if (msg.result?.isError) throw new Error(text);
    return JSON.parse(text).roles;
  }
  throw new Error(`the server printed no kukulu_config_show answer${run.stderr ? `: ${run.stderr.trim().split("\n")[0]}` : ""}`);
}

const ENGINES = ["docker", "podman"];

function doctor({ root, pluginRoot, env, engineOption, out }) {
  const problems = [];
  const line = (text) => out.write(`${text}\n`);
  const spawnEnv = { ...env };

  let engine = null;
  let version = null;
  for (const name of engineOption ? [engineOption] : ENGINES) {
    const r = spawnSync(name, ["--version"], { encoding: "utf8", env: spawnEnv });
    if (r.status === 0) {
      engine = name;
      version = (r.stdout || "").split("\n")[0].trim();
      break;
    }
  }
  if (engine) line(`engine: ${engine} (${version})`);
  else problems.push("no container engine: install docker or podman");

  let loaded = null;
  try {
    loaded = loadProjectPolicy(root);
  } catch (e) {
    problems.push(e instanceof CleanroomError || e instanceof Error ? e.message : String(e));
  }
  if (loaded && loaded.policy.enforcement !== "container+proxy") problems.push('policy enforcement is "hook"; the sandbox needs enforcement "container+proxy" in the policy');
  if (loaded && !loaded.policy.sandbox.image) problems.push("policy sandbox.image is not set");
  if (!loaded || !loaded.policy.sandbox.image) {
    for (const p of problems) line(`problem: ${p}`);
    line(`sandbox doctor: ${problems.length} problem(s)`);
    return 1;
  }
  const { policy, policyPath } = loaded;
  const projectId = projectIdFor(root);
  const plan = planFor({ policy, root, pluginRoot, runtimeDir: runtimeDirFor(projectId, env), projectId, engine: engine ?? "docker", env, policyPath });

  let present = false;
  if (engine) {
    present = spawnSync(engine, ["image", "inspect", "--format", "{{.Id}}", plan.image], { encoding: "utf8", env: spawnEnv }).status === 0;
    line(`image: ${plan.imageName} ${present ? "present" : "missing"} (${plan.image})`);
  }
  line("mounts:");
  for (const p of [...plan.readOnly, ...plan.mounts, ...plan.priorArt]) line(`  ${p} (ro)`);
  line(`  ${root} (rw)`);

  let roles = null;
  try {
    roles = readRunners(root, pluginRoot, env);
  } catch (e) {
    problems.push(`cannot read the runners from the server: ${e.message}`);
  }
  line("egress:");
  const egress = new Set(policy.sandbox.egress);
  for (const url of policy.allow.urls) {
    const hp = hostPortOf(url);
    if (hp) egress.add(`${hp.host}:${hp.port}`);
  }
  for (const role of Object.values(roles ?? {})) {
    if (role.endpoint) {
      const hp = hostPortOf(role.endpoint);
      if (hp) egress.add(`${hp.host}:${hp.port}`);
    }
  }
  for (const e of egress) line(`  ${e}`);
  line("runners:");
  for (const [role, r] of Object.entries(roles ?? {})) line(`  ${role}: ${r.model} on ${r.runner ?? "none"} (${r.endpoint ?? "no endpoint"}, ${r.locality})`);

  if (engine && !present) {
    problems.push(`the image ${plan.imageName} is missing (${plan.image})`);
    const byName = spawnSync(engine, ["image", "inspect", "--format", "{{.Id}}", plan.imageName], { encoding: "utf8", env: spawnEnv });
    const id = byName.status === 0 ? (byName.stdout || "").trim() : `<the output of ${engine} image inspect --format {{.Id}} ${plan.imageName}>`;
    line(`build it with: ${engine} build -t ${plan.imageName} --build-arg NODE_IMAGE=node:22-bookworm-slim --build-arg CLAUDE_CODE_VERSION=latest -f ${path.join(pluginRoot, "templates", "sandbox", "Containerfile")} ${path.join(pluginRoot, "templates", "sandbox")}`);
    line(`then paste into docs/cleanroom.json: "image": "${plan.imageName}@${id}"`);
  }
  if (problems.length) {
    for (const p of problems) line(`problem: ${p}`);
    line(`sandbox doctor: ${problems.length} problem(s)`);
    return 1;
  }
  line("sandbox doctor: ok");
  return 0;
}

export function main(argv, { platform = process.platform, env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  if (platform === "darwin") {
    stderr.write("scripts/sandbox.mjs runs on Linux; on macOS run it inside a Linux VM that holds the project (see docs/sandbox.md)\n");
    return 2;
  }
  const [command, ...rest] = argv;
  if (command === "doctor") {
    let engineOption = null;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--engine") engineOption = rest[++i];
      else {
        stderr.write(USAGE);
        return 2;
      }
    }
    if (engineOption !== null && !ENGINES.includes(engineOption)) {
      stderr.write(`sandbox: --engine takes docker or podman (got ${JSON.stringify(engineOption)})\n`);
      return 2;
    }
    return doctor({ root: path.resolve(env.KUKULU_PROJECT_DIR || cwd), pluginRoot: PLUGIN_ROOT, env, engineOption, out: stdout });
  }
  // run and stop are filled in by the task that builds them.
  stderr.write(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
