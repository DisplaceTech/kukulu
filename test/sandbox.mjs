// The sandbox (0.8.0): the relay and the controller socket here; the log
// socket, proxy, container launcher and gate checks join them in later tasks.
// Nothing here needs a container engine, a GPU or a second machine.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { finish, ok, eq, like, isError, ROOT, cleanroomRepo, plannedRepo, setState, startServer, withServer, mkFakeDocker, mkDir, writeFile, readFile, logCall, git, buildBundle, mkFakeGpg, useFakeSigner } from "./harness.mjs";
import net from "node:net";
import { startControllerSocket, startLogSocket, startProxy, egressDecision, hostPortOf, planFor, containerArgs, projectIdFor, runtimeDirFor, main as sandboxMain } from "../scripts/sandbox.mjs";
import { startBridge } from "../scripts/sandbox-entry.mjs";
import { createHash } from "node:crypto";
import { readEntries, verifyChain, loadPolicy, lockdownActive, appendEntry } from "../mcp/cleanroom.mjs";

// A Unix socket path is limited to about 100 bytes on macOS, so sockets live under a short temp directory.
/** The host:port a URL names, as the sandbox derives a runner endpoint. */
const hostPortFor = (url) => { const { host, port } = hostPortOf(url); return `${host}:${port}`; };
// Always /tmp, never TMPDIR: a Unix socket path is capped at 104 bytes on macOS, and its TMPDIR (/var/folders/...) leaves no room.
const shortDir = () => fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "ks-"));

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

// ---------------------------------------------------------------- the egress proxy and the bridge (P2-04)

/** A local TCP echo server, the fake runner. Resolves { port, close }. */
const startEcho = () => new Promise((resolve) => {
  const server = net.createServer((c) => { c.on("data", (d) => c.write(d)); c.on("error", () => {}); });
  server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) }));
});

/** Send raw bytes to a socket path or port and collect what comes back until the connection ends or `until` matches. */
const exchange = (target, bytes, { until = null, then = null } = {}) => new Promise((resolve) => {
  const c = typeof target === "number" ? net.connect(target, "127.0.0.1") : net.connect(target);
  let got = "";
  c.setEncoding("latin1");
  c.on("connect", () => c.write(bytes));
  c.on("data", (d) => {
    got += d;
    if (then && got.includes("\r\n\r\n") && !then.done) { then.done = true; c.write(then.send); }
    if (until && until.test(got)) c.end();
  });
  c.on("error", () => resolve(got));
  c.on("close", () => resolve(got));
});

{
  const runner = await startEcho();
  const other = await startEcho();
  const dir = shortDir();
  const policy = loadPolicy(JSON.stringify({ version: 1, allow: { urls: [`http://127.0.0.1:${other.port}/x`] }, lockdown: { after: "P0-01" }, sandbox: {} }));
  const endpoints = [{ runner: "fake", host: "127.0.0.1", port: runner.port }];
  let progress = "- [ ] P0-01 first\n";
  const records = [];
  const proxySocket = path.join(dir, "p.sock");
  const proxy = startProxy({
    socketPath: proxySocket,
    decide: (host, port) => egressDecision({ policy, endpoints, lockdown: lockdownActive(policy, progress), host, port }),
    record: (r) => records.push(r),
  });
  await proxy.listening;
  const settled = async (n) => { for (let i = 0; i < 100 && records.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };
  try {
    const reply = await exchange(proxySocket, `CONNECT 127.0.0.1:${runner.port} HTTP/1.1\r\nHost: x\r\n\r\n`, { then: { send: "hello runner" }, until: /hello runner$/ });
    like(reply, /^HTTP\/1\.1 200 Connection Established\r\n\r\nhello runner$/, "a CONNECT to the runner endpoint is allowed and the bytes are echoed");
    await settled(1);
    const r = records[0];
    eq(r.target + "|" + r.decision + "|" + r.reason, `127.0.0.1:${runner.port}|allowed|runner endpoint fake`, "...logged with its target, decision and reason");
    ok(r.data.bytesUp === 12 && r.data.bytesDown === 12 && typeof r.data.ms === "number", "...and its byte counts and elapsed time");

    const denied = await exchange(proxySocket, "CONNECT example.com:443 HTTP/1.1\r\n\r\n");
    const body = "kukulu egress: example.com:443 is not allowed by this flight's policy";
    eq(denied, `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`, "a CONNECT to another host gets 403 with the exact body");
    eq(records[1].target + "|" + records[1].decision + "|" + records[1].reason + "|" + ("data" in records[1]), "example.com:443|denied|not allowed by this flight's policy|false", "...and a denied record without data");

    const early = await exchange(proxySocket, `CONNECT 127.0.0.1:${other.port} HTTP/1.1\r\n\r\n`, { then: { send: "x" }, until: /x$/ });
    like(early, /^HTTP\/1\.1 200 /, "an allow.urls host is allowed before lockdown");
    await settled(3);
    eq(records[2].reason, "allow.urls", "...with reason allow.urls");
    progress = "- [x] P0-01 first\n";
    const late = await exchange(proxySocket, `CONNECT 127.0.0.1:${other.port} HTTP/1.1\r\n\r\n`);
    like(late, /^HTTP\/1\.1 403 Forbidden/, "...and denied after lockdown");
    eq(records[3].reason, "lockdown is active", "...with reason lockdown is active");

    const literal = await exchange(proxySocket, "CONNECT 203.0.113.9:443 HTTP/1.1\r\n\r\n");
    like(literal, /^HTTP\/1\.1 403 Forbidden/, "a literal IP the policy does not name is denied");
    eq(records.at(-1).reason, "literal IP addresses are not allowed", "...with the literal-IP reason");

    const plain = await exchange(proxySocket, "GET /path HTTP/1.1\r\nHost: x\r\n\r\n");
    like(plain, /^HTTP\/1\.1 400 Bad Request/, "a request that is neither CONNECT nor absolute-form gets 400");
    const tls = await exchange(proxySocket, "\u0016\u0003\u0001garbage\r\n\r\n");
    like(tls, /^HTTP\/1\.1 400 Bad Request/, "...and so does garbage");
    const before = records.length;

    const absolute = await exchange(proxySocket, `GET http://127.0.0.1:${runner.port}/x HTTP/1.1\r\nHost: x\r\n\r\n`, { until: /\r\n\r\n/ });
    like(absolute, /^GET http:\/\/127\.0\.0\.1:\d+\/x HTTP\/1\.1/, "an allowed absolute-form request is forwarded unchanged (the echo server returns it)");
    await settled(before + 1);
    eq(records.at(-1).decision, "allowed", "...and recorded");

    // the bridge: 127.0.0.1:<ephemeral> forwards to the proxy socket
    const bridge = startBridge({ port: 0, socketPath: proxySocket });
    await bridge.listening;
    try {
      const n = records.length;
      const viaBridge = await exchange(bridge.port(), `CONNECT 127.0.0.1:${runner.port} HTTP/1.1\r\n\r\n`, { then: { send: "through the bridge" }, until: /bridge$/ });
      like(viaBridge, /^HTTP\/1\.1 200 Connection Established\r\n\r\nthrough the bridge$/, "the bridge forwards 127.0.0.1:<port> to the proxy socket");
      await settled(n + 1);
      eq(records.length, n + 1, "...and the proxy recorded the connection");
    } finally {
      await bridge.close();
    }
  } finally {
    await proxy.close();
    await runner.close();
    await other.close();
  }

  const p = (extra) => loadPolicy(JSON.stringify({ version: 1, ...extra }));
  const ends = [{ runner: "r1", host: "Spark.Test", port: 8000 }, { runner: "r2", host: "api.example", port: 443 }];
  eq(JSON.stringify(egressDecision({ policy: p({}), endpoints: ends, lockdown: false, host: "spark.test", port: 8000 })), '{"allowed":true,"reason":"runner endpoint r1"}', "egressDecision compares hosts case-insensitively");
  eq(egressDecision({ policy: p({}), endpoints: ends, lockdown: false, host: "spark.test", port: 9000 }).allowed, false, "...and the port too");
  const bySchemeHttps = hostPortFor("https://api.example");
  eq(bySchemeHttps, "api.example:443", "egressDecision defaults an endpoint's port by scheme (https)");
  eq(hostPortFor("http://mac.test"), "mac.test:80", "...and http");
  eq(hostPortFor("http://mac.test:11434"), "mac.test:11434", "...and keeps an explicit port");
  eq(egressDecision({ policy: p({ sandbox: { image: undefined, egress: ["pypi.org:443"] }, enforcement: "hook" }), endpoints: [], lockdown: false, host: "pypi.org", port: 443 }).reason, "sandbox.egress", "sandbox.egress hosts are allowed before lockdown");
  eq(egressDecision({ policy: p({ allow: { urls: ["https://www.rfc-editor.org/rfc/rfc1951.txt"] } }), endpoints: [], lockdown: false, host: "www.rfc-editor.org", port: 443 }).reason, "allow.urls", "an allow.urls entry's https port defaults to 443");
  eq(egressDecision({ policy: p({ allow: { urls: ["https://www.rfc-editor.org/rfc/rfc1951.txt"] } }), endpoints: [], lockdown: true, host: "www.rfc-editor.org", port: 443 }).reason, "lockdown is active", "...and lockdown denies it");
  const afterLockdown = egressDecision({ policy: p({ sandbox: { image: undefined, egress: ["pypi.org:443"] }, enforcement: "hook" }), endpoints: [], lockdown: true, host: "pypi.org", port: 443 });
  eq(afterLockdown.allowed + "|" + afterLockdown.reason, "false|lockdown is active", "sandbox.egress hosts are denied after lockdown");
}

// ---------------------------------------------------------------- containerArgs, the plan, the Containerfile and doctor (P2-05)

// a box that names another source still gets "box" (SPEC C-02)
{
  const dir = shortDir();
  const logPath = path.join(dir, "forged-log.jsonl");
  const socketPath = path.join(dir, "f.sock");
  const logSocket = startLogSocket({ socketPath, logPath });
  await logSocket.listening;
  try {
    const reply = await new Promise((resolve, reject) => {
      const c = net.connect(socketPath, () => c.write(JSON.stringify({ kind: "allowed", stage: "implement", role: "session", data: { source: "controller", target: "/x" } }) + "\n"));
      c.setEncoding("utf8");
      c.on("data", (t) => { c.end(); resolve(t); });
      c.on("error", reject);
    });
    ok(!JSON.parse(reply).error, "(a forged entry is accepted as an entry)");
    eq(readEntries(logPath).at(-1).data.source, "box", "the log socket marks a box entry source box even when the box sends another source");
  } finally {
    await logSocket.close();
  }
}

{
  const digest = "sha256:" + "a".repeat(64);
  const policyText = (extra = {}) => JSON.stringify({
    version: 1,
    enforcement: "container+proxy",
    sandbox: { image: `kukulu-sandbox@${digest}`, mounts: [{ path: "tools/oracle", mode: "ro" }], egress: ["pypi.org:443"] },
    ...extra,
  });
  const root = "/work/proj";
  const base = (extra = {}) => ({ policy: loadPolicy(policyText(extra.policy)), root, pluginRoot: "/opt/kukulu", runtimeDir: "/run/user/1000/kukulu/abc", projectId: "abc", engine: "docker", env: { HOME: "/home/dev" }, ...extra.plan });

  const fixed = ["KUKULU_CONTROLLER_SOCKET=/run/kukulu/controller.sock", "KUKULU_LOG_SOCKET=/run/kukulu/log.sock", "HTTPS_PROXY=http://127.0.0.1:3128", "HTTP_PROXY=http://127.0.0.1:3128", "NODE_USE_ENV_PROXY=1", "DISABLE_TELEMETRY=1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"];
  const expected = (envs, { tty = false, extraRo = [], harness = [] } = {}) => [
    "run", "--rm", "--init", "--name", "kukulu-abc", "--network", "none", "--read-only", "--tmpfs", "/tmp", "--user", "kukulu", "-w", root, "-i", ...(tty ? ["-t"] : []),
    "-v", `${root}:${root}`,
    ...[`${root}/docs/cleanroom.json`, `${root}/.kukulu`, `${root}/.claude`, `${root}/.git/config`, `${root}/.git/hooks`, `${root}/.git/info`, `${root}/docs/SPEC.md`, "/opt/kukulu", `${root}/tools/oracle`, ...extraRo].flatMap((p) => ["-v", `${p}:${p}:ro`]),
    "-v", "/run/user/1000/kukulu/abc:/run/kukulu:ro", "-v", "kukulu-abc-home:/home/kukulu",
    ...envs.flatMap((e) => ["-e", e]),
    digest, "/opt/kukulu/scripts/sandbox-entry.mjs", ...harness,
  ];

  const plan = planFor(base({ policy: { mode: "control-positive", control: { priorArt: ["vendor/zlib"] } } }));
  eq(JSON.stringify(containerArgs(plan)), JSON.stringify(expected(fixed, { extraRo: [`${root}/vendor/zlib`] })), "containerArgs for a policy with mounts, prior art and egress is exactly the expected list");
  eq(plan.name + "|" + plan.home + "|" + plan.image + "|" + plan.imageName, `kukulu-abc|kukulu-abc-home|${digest}|kukulu-sandbox`, "the plan names the container, the home volume and the image");
  eq(plan.readOnly.length + "|" + plan.mounts.join() + "|" + plan.priorArt.join(), `8|${root}/tools/oracle|${root}/vendor/zlib`, "...and its read-only, mount and prior-art lists");

  const creds = planFor(base({ plan: { env: { HOME: "/home/dev", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k", UNRELATED: "x" } } }));
  eq(containerArgs(creds).filter((a) => /^(ANTHROPIC|UNRELATED)/.test(a)).join(","), "ANTHROPIC_API_KEY=k,ANTHROPIC_AUTH_TOKEN=t", "containerArgs passes only the credential variables that are set, in order");
  eq(containerArgs(planFor(base())).filter((a) => a === "-t").length, 0, "containerArgs has no -t without a TTY");
  const tty = containerArgs(planFor(base({ plan: { tty: true, harnessArgs: ["--model", "x"] } })));
  eq(JSON.stringify(tty), JSON.stringify(expected(fixed, { tty: true, harness: ["--model", "x"] })), "containerArgs adds -t only for a TTY plan, and appends the harness arguments");
  ok(!tty.some((a) => /--privileged|--cap-add|--pid|--security-opt|\.sock:/.test(a)), "...and never an escape flag");

  const real = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "kid-"));
  const link = real + "-link";
  fs.symlinkSync(real, link);
  const id = projectIdFor(link);
  eq(id, createHash("sha256").update(fs.realpathSync(real)).digest("hex").slice(0, 16), "projectIdFor is 16 hex characters of the real path's SHA-256");
  ok(/^[0-9a-f]{16}$/.test(id), "...as hex");
  eq(runtimeDirFor("abc", { XDG_RUNTIME_DIR: "/run/user/7" }), "/run/user/7/kukulu/abc", "runtimeDirFor uses XDG_RUNTIME_DIR");
  eq(runtimeDirFor("abc", { HOME: "/home/dev" }), "/home/dev/.cache/kukulu/run/abc", "...else ~/.cache/kukulu/run");

  const containerfile = fs.readFileSync(path.join(ROOT, "templates", "sandbox", "Containerfile"), "utf8");
  ok(/^ARG NODE_IMAGE=node:22-bookworm-slim$/m.test(containerfile) && /^FROM \$\{NODE_IMAGE\}$/m.test(containerfile) && /^ARG CLAUDE_CODE_VERSION=latest$/m.test(containerfile), "the Containerfile has the two build args");
  ok(/git ca-certificates/.test(containerfile) && /--no-install-recommends/.test(containerfile) && /rm -rf \/var\/lib\/apt\/lists/.test(containerfile), "...installs git and ca-certificates without recommends and clears the lists");
  ok(/npm install -g @anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}/.test(containerfile) && /useradd .*kukulu/.test(containerfile), "...installs claude-code and adds the kukulu user");
  ok(/^USER kukulu$/m.test(containerfile) && /^WORKDIR \/home\/kukulu$/m.test(containerfile) && /^ENTRYPOINT \["node"\]$/m.test(containerfile), "...runs as kukulu with a node entrypoint");
  ok(!/COPY|ADD /.test(containerfile), "...and copies nothing of the plugin in");

  // doctor, against the fake docker
  const doctorRepo = (extra = {}) => {
    const repo = cleanroomRepo({ policy: policyText(extra) });
    return repo;
  };
  const runDoctor = (repo, dockerDir, argv = ["doctor"], envExtra = {}) => {
    const out = [];
    const err = [];
    const code = sandboxMain(argv, {
      platform: "linux",
      cwd: repo,
      env: { PATH: `${dockerDir}:${process.env.PATH}`, HOME: process.env.HOME, XDG_RUNTIME_DIR: "/run/user/1000", KUKULU_CONFIG: path.join(repo, ".kukulu-test-no-global.json"), KUKULU_PROFILE: "", ...envExtra },
      stdout: { write: (t) => out.push(t) },
      stderr: { write: (t) => err.push(t) },
    });
    return { code, out: out.join(""), err: err.join("") };
  };
  const dockerDir = mkFakeDocker();
  writeFile(dockerDir, "image-missing", "");
  const repo = doctorRepo();
  const missing = runDoctor(repo, dockerDir);
  eq(missing.code, 1, "doctor reports a missing image with exit 1");
  like(missing.out, /^engine: docker \(Docker version 27\.0\.0, build test\)$/m, "...naming the engine");
  like(missing.out, /^image: kukulu-sandbox missing \(sha256:a{64}\)$/m, "...and the missing image");
  like(missing.out, /^build it with: docker build -t kukulu-sandbox --build-arg NODE_IMAGE=node:22-bookworm-slim --build-arg CLAUDE_CODE_VERSION=latest -f .*templates\/sandbox\/Containerfile .*templates\/sandbox$/m, "...with the build command");
  like(missing.out, /^then paste into docs\/cleanroom\.json: "image": "kukulu-sandbox@/m, "...and the digest line");
  like(missing.out, /^sandbox doctor: 1 problem\(s\)$/m, "...ending with the problem count");

  fs.rmSync(path.join(dockerDir, "image-missing"));
  const mismatch = runDoctor(repo, dockerDir);
  like(mismatch.out, /^image: kukulu-sandbox missing /m, "doctor treats an image of another id as missing");
  writeFile(dockerDir, "image-inspect.txt", `${digest}\n`);
  const present = runDoctor(repo, dockerDir);
  eq(present.code, 0, "doctor passes with the image present");
  eq(present.out.trimEnd().split("\n").at(-1), "sandbox doctor: ok", "...ending with sandbox doctor: ok");
  like(present.out, /^image: kukulu-sandbox present \(sha256:a{64}\)$/m, "...naming the image");
  for (const role of ["planner", "implementer", "reviewer", "summarizer"]) like(present.out, new RegExp(`^  ${role}: \\S+ on anthropic \\(https://api\\.anthropic\\.com, remote\\)$`, "m"), `...listing the ${role} runner`);
  like(present.out, new RegExp(`^  ${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(rw\\)$`, "m"), "...the project as the one read-write mount");
  like(present.out, /^  pypi\.org:443$/m, "...the egress allowlist, with sandbox.egress");
  like(present.out, /^  api\.anthropic\.com:443$/m, "...and the runner endpoints");
  like(present.out, /^  .*\/\.kukulu \(ro\)$/m, "...and the read-only mounts");
  const calls = fs.readFileSync(path.join(dockerDir, "calls.log"), "utf8");
  ok(/image inspect --format \{\{\.Id\}\} sha256:a{64}/.test(calls), "doctor asks the engine for the image by digest");
  ok(!/^(run|rm|stop) /m.test(calls), "...and never starts, stops or removes anything");

  const hookPolicy = cleanroomRepo();
  const refused = runDoctor(hookPolicy, dockerDir);
  eq(refused.code, 1, "doctor reports a hook-level policy as a problem");
  like(refused.out, /^problem: policy enforcement is "hook"/m, "...saying so");
  const noEngine = runDoctor(repo, mkDir("kukulu-noengine-"), ["doctor"], { PATH: "/nonexistent" });
  like(noEngine.out, /^problem: no container engine: install docker or podman$/m, "doctor reports no container engine");
  eq(runDoctor(repo, dockerDir, ["doctor", "--engine", "lxc"]).code, 2, "an unknown --engine is a usage error");
}

// ---------------------------------------------------------------- run and stop (P2-06)

{
  const digest = "sha256:" + "a".repeat(64);
  const policyText = (extra = {}) => JSON.stringify({ version: 1, enforcement: "container+proxy", sandbox: { image: `kukulu-sandbox@${digest}` }, ...extra });
  const xdg = shortDir();
  const sandboxRun = async (repo, dockerDir, argv, envExtra = {}) => {
    const out = [];
    const err = [];
    const code = await sandboxMain(argv, {
      platform: "linux",
      cwd: repo,
      env: { PATH: `${dockerDir}:${process.env.PATH}`, HOME: process.env.HOME, XDG_RUNTIME_DIR: xdg, KUKULU_CONFIG: path.join(repo, ".kukulu-test-no-global.json"), KUKULU_PROFILE: "", ...envExtra },
      stdout: { write: (t) => out.push(t) },
      stderr: { write: (t) => err.push(t) },
    });
    return { code, out: out.join(""), err: err.join("") };
  };
  const dockerWith = (files = {}) => {
    const dir = mkFakeDocker();
    writeFile(dir, "image-inspect.txt", `${digest}\n`);
    for (const [name, body] of Object.entries(files)) writeFile(dir, name, body);
    return dir;
  };
  const calls = (dir) => (fs.existsSync(path.join(dir, "calls.log")) ? fs.readFileSync(path.join(dir, "calls.log"), "utf8") : "");
  const started = (dir) => /^run /m.test(calls(dir));

  const hook = cleanroomRepo();
  const hookDocker = dockerWith();
  const underHook = await sandboxRun(hook, hookDocker, ["run"]);
  eq(underHook.code, 1, "run refuses under hook enforcement");
  eq(underHook.err, 'scripts/sandbox.mjs run needs policy enforcement "container+proxy" (this policy says "hook"); under hook enforcement run the session as usual\n', "...with the exact line");
  ok(!started(hookDocker) && calls(hookDocker) === "", "...and nothing started: the engine was not even asked");

  const repo = cleanroomRepo({ policy: policyText() });
  const noImage = dockerWith({ "image-missing": "" });
  const missing = await sandboxRun(repo, noImage, ["run"]);
  eq(missing.code + "|" + missing.err, `1|sandbox.image kukulu-sandbox@${digest} is not present; build it (doctor prints the command) or fix the digest\n`, "run refuses a missing image");
  ok(!started(noImage), "...starting nothing");
  const wrongId = dockerWith({ "image-inspect.txt": "sha256:" + "b".repeat(64) + "\n" });
  const wrong = await sandboxRun(repo, wrongId, ["run"]);
  like(wrong.err, /^sandbox\.image kukulu-sandbox@sha256:a{64} is not present/, "run refuses a digest mismatch");
  ok(!started(wrongId), "...starting nothing");

  const busy = dockerWith({ "inspect.json": readFile(ROOT, "test/fixtures/docker/inspect.json").replaceAll("__ROOT__", repo) });
  const running = await sandboxRun(repo, busy, ["run"]);
  eq(running.code, 1, "run refuses a running container");
  like(running.err, /^container kukulu-[0-9a-f]{16} is already running; run node scripts\/sandbox\.mjs stop first\n$/, "...with the stop hint");
  ok(!started(busy), "...starting nothing");

  const withMount = cleanroomRepo({ policy: policyText({ sandbox: { image: `kukulu-sandbox@${digest}`, mounts: [{ path: "tools/oracle", mode: "ro" }] } }) });
  const mountDocker = dockerWith();
  const noMount = await sandboxRun(withMount, mountDocker, ["run"]);
  eq(noMount.code, 1, "run refuses a missing mount source");
  eq(noMount.err, `${withMount}/tools/oracle does not exist; run needs every mount source on the host\n`, "...naming it");
  ok(!started(mountDocker), "...starting nothing");

  const good = dockerWith();
  const ran = await sandboxRun(repo, good, ["run", "--", "--model", "x"]);
  eq(ran.code, 0, "run returns the container's exit status");
  const id = projectIdFor(repo);
  const runtime = path.join(xdg, "kukulu", id);
  const runLine = calls(good).split("\n").find((l) => l.startsWith("run "));
  const plan = planFor({ policy: loadPolicy(policyText()), root: repo, pluginRoot: ROOT, runtimeDir: runtime, projectId: id, engine: "docker", harnessArgs: ["--model", "x"], tty: Boolean(process.stdin.isTTY), env: { HOME: process.env.HOME }, policyPath: path.join(repo, "docs", "cleanroom.json") });
  eq(runLine, containerArgs(plan).join(" "), "run starts the container with exactly the containerArgs line");
  eq(fs.readFileSync(path.join(good, "runtime-listing.txt"), "utf8").split("\n").filter(Boolean).sort().join(","), "controller.sock,hooks-empty,log.sock,proxy.sock,run.json", "...while the three sockets and run.json existed");
  ok(!fs.existsSync(path.join(runtime, "controller.sock")) && !fs.existsSync(path.join(runtime, "log.sock")) && !fs.existsSync(path.join(runtime, "proxy.sock")), "...and the sockets are gone after");
  ok(!fs.existsSync(path.join(runtime, "run.json")), "...and so is run.json");
  eq((fs.statSync(runtime).mode & 0o777).toString(8), "700", "the runtime directory is mode 0700");
  ok(fs.existsSync(path.join(repo, ".kukulu")) && fs.existsSync(path.join(repo, ".claude")), "run creates .kukulu and .claude when absent");

  const failing = dockerWith({ "run-exit": "3" });
  eq((await sandboxRun(repo, failing, ["run"])).code, 3, "run returns a non-zero container status");

  const stopDocker = dockerWith();
  const stopped = await sandboxRun(repo, stopDocker, ["stop"]);
  eq(stopped.code + "|" + stopped.out, "0|sandbox stop: ok\n", "stop prints ok");
  eq(calls(stopDocker).trimEnd().split("\n").at(-1), `stop kukulu-${id}`, "...after stopping the container");
  const stopTwice = await sandboxRun(repo, dockerWith({}), ["stop"]);
  eq(stopTwice.code, 0, "stop of a container that is not running is not an error");
  eq((await sandboxRun(repo, dockerWith(), ["stop", "extra"])).code, 2, "stop with an argument is a usage error");

  // stop signals the pid in run.json (PLAN P2-06)
  {
    const sleeper = spawn("sleep", ["60"], { stdio: "ignore" });
    const exited = new Promise((resolve) => sleeper.on("exit", (code, signal) => resolve(signal)));
    fs.mkdirSync(runtime, { recursive: true });
    const runFile = path.join(runtime, "run.json");
    fs.writeFileSync(runFile, JSON.stringify({ pid: sleeper.pid }));
    const stopSignal = await sandboxRun(repo, dockerWith(), ["stop"]);
    eq(stopSignal.code, 0, "stop with a run.json succeeds");
    eq(await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve("still running"), 5000))]), "SIGTERM", "stop signals the pid in run.json: the child exited on SIGTERM");
    ok(!fs.existsSync(runFile), "...and run.json is gone");
    sleeper.kill("SIGKILL");
  }

  // a tag-only image never reaches the engine
  {
    const tagged = cleanroomRepo({ policy: policyText({ sandbox: { image: "kukulu-sandbox:latest" } }) });
    const tagDocker = dockerWith();
    const refused = await sandboxRun(tagged, tagDocker, ["run"]);
    eq(refused.code, 1, "run refuses a tag-only image");
    like(refused.err, /sandbox\.image/, "...with the policy loader's message on stderr");
    ok(!started(tagDocker), "...and nothing started");
  }
}

// ---------------------------------------------------------------- gate check 9 and the boundary in genesis (P2-07)

{
  const zero = "sha256:" + "0".repeat(64);
  const policy = JSON.stringify({ version: 1, enforcement: "container+proxy", sandbox: { image: `kukulu-sandbox@${zero}`, mounts: [{ path: "tools/oracle", mode: "ro" }], egress: ["pypi.org:443"] } });
  const name = "kukulu-0123456789abcdef";
  const HOOKS = "/run/user/1000/kukulu/0123456789abcdef/hooks-empty";
  const boundaryRepo = () => {
    const repo = cleanroomRepo({ policy });
    const dockerDir = mkFakeDocker();
    const inspect = JSON.parse(readFile(ROOT, "test/fixtures/docker/inspect.json").replaceAll("__ROOT__", repo).replaceAll("/opt/kukulu", ROOT));
    return { repo, dockerDir, inspect, put: (obj) => writeFile(dockerDir, "inspect.json", JSON.stringify(obj)) };
  };
  const envFor = (dockerDir, extra = {}) => ({ env: { PATH: `${dockerDir}:${process.env.PATH}`, KUKULU_SANDBOX: name, KUKULU_SANDBOX_ENGINE: "docker", KUKULU_SANDBOX_HOOKS_PATH: HOOKS, ...extra } });
  const logOf = (repo) => readEntries(path.join(repo, ".kukulu", "cleanroom", "log.jsonl"));
  const live = async (repo, opts, fn) => withServer(repo, async (s) => fn({ ...s, call: async (n, a) => { logCall(repo); return s.call(n, a); } }), opts);

  {
    const b = boundaryRepo();
    b.put(b.inspect);
    await live(b.repo, envFor(b.dockerDir), async ({ call }) => {
      const n = await call("kukulu_next");
      eq(n.stage, "plan", "genesis passes under container+proxy with the recorded inspect output");
      eq(n.gate.checked.join(","), "mode,policy,guard,self-test,lockdown,chain,liveness,routing,boundary", "gate check 9 passes: gate.checked ends in boundary");
      const genesis = logOf(b.repo)[0];
      eq(genesis.data.enforcement + "|" + genesis.data.boundary.engine + "|" + genesis.data.boundary.network + "|" + genesis.data.boundary.image, `container+proxy|docker|none|${b.inspect[0].Image}`, "genesis records enforcement and the boundary");
      ok(genesis.data.boundary.mounts.every((m) => "source" in m && "destination" in m && "rw" in m) && genesis.data.boundary.mounts.length === b.inspect[0].Mounts.length, "...with every mount's source, destination and rw");
      const second = await call("kukulu_next");
      eq(second.gate.ok, true, "the next gate passes too");
      const gates = logOf(b.repo).filter((e) => e.kind === "gate" && e.data.ok);
      eq(gates.at(-1).data.checks + "|" + gates.at(-1).data.container, `9|${b.inspect[0].Id}`, "...recording nine checks and the container id");
    });
  }

  // each way the container can differ, after genesis (the gate) and, for the first, at genesis too
  for (const [label, mutate, want] of [
    ["network mode bridge", (i) => { i[0].HostConfig.NetworkMode = "bridge"; }, /boundary: network is bridge, but the policy requires none/],
    ["an extra read-write mount", (i) => { i[0].Mounts.push({ Type: "bind", Source: "/etc", Destination: "/etc-rw", RW: true }); }, /boundary: read-write mounts are \/etc-rw, .*; only the project and the home volume may be writable/],
    ["a different image digest", (i) => { i[0].Image = "sha256:" + "b".repeat(64); }, new RegExp(`boundary: image is sha256:b{64}, but the policy pins ${zero}`)],
    ["a container that is not running", (i) => { i[0].State.Running = false; }, new RegExp(`boundary: container ${name} is not running`)],
    ["a missing read-only mount", (i) => { i[0].Mounts = i[0].Mounts.filter((m) => !m.Destination.endsWith("/docs/SPEC.md")); }, /boundary: mount .*\/docs\/SPEC\.md is missing/],
    ["a read-write policy file", (i) => { i[0].Mounts.find((m) => m.Destination.endsWith("/docs/cleanroom.json")).RW = true; }, /boundary: read-write mounts are/],
    ["a writable /run/kukulu", (i) => { const m = i[0].Mounts.find((x) => x.Destination === "/run/kukulu"); m.RW = true; }, /boundary: read-write mounts are [^;]*; only the project and the home volume may be writable/],
    ["an extra read-only mount", (i) => { i[0].Mounts.push({ Type: "bind", Source: "/etc", Destination: "/etc-ro", RW: false }); }, /boundary: mount \/etc-ro is not one the policy and the sandbox define/],
    ["a bind-mounted home", (i) => { const m = i[0].Mounts.find((x) => x.Destination === "/home/kukulu"); m.Type = "bind"; delete m.Name; m.Source = "/home/victim"; }, /boundary: mount \/home\/kukulu is a bind mount of \/home\/victim, but it must be the volume kukulu-0123456789abcdef-home/],
    ["a same-path mount with another source", (i) => { i[0].Mounts.find((m) => m.Destination.endsWith("/docs/SPEC.md")).Source = "/tmp/other-spec.md"; }, /boundary: mount .*\/docs\/SPEC\.md has source \/tmp\/other-spec\.md/],
    ["a runtime directory from elsewhere", (i) => { i[0].Mounts.find((m) => m.Destination === "/run/kukulu").Source = "/tmp/elsewhere"; }, /boundary: mount \/run\/kukulu has source \/tmp\/elsewhere/],
  ]) {
    const b = boundaryRepo();
    mutate(b.inspect);
    b.put(b.inspect);
    await live(b.repo, envFor(b.dockerDir), async ({ call }) => {
      isError(await call("kukulu_next"), new RegExp(`^clean-room genesis refused: ${want.source}`), `genesis refuses ${label}`);
    });
    ok(!fs.existsSync(path.join(b.repo, ".kukulu", "cleanroom", "log.jsonl")), "...writing nothing");
  }

  for (const [label, mutate, want] of [
    ["network mode bridge", (i) => { i[0].HostConfig.NetworkMode = "bridge"; }, /boundary: network is bridge, but the policy requires none/],
    ["an extra read-write mount", (i) => { i[0].Mounts.push({ Type: "bind", Source: "/etc", Destination: "/etc-rw", RW: true }); }, /boundary: read-write mounts are/],
    ["a different image digest", (i) => { i[0].Image = "sha256:" + "b".repeat(64); }, /boundary: image is sha256:b{64}/],
    ["a changed mount source", (i) => { i[0].Mounts.find((m) => m.Destination === "/home/kukulu").Source = "/elsewhere"; }, /boundary: mounts are .*, but genesis recorded/],
    ["a writable /run/kukulu", (i) => { i[0].Mounts.find((m) => m.Destination === "/run/kukulu").RW = true; }, /boundary: read-write mounts are [^;]*; only the project and the home volume/],
    ["an extra read-only mount", (i) => { i[0].Mounts.push({ Type: "bind", Source: "/etc", Destination: "/etc-ro", RW: false }); }, /boundary: mount \/etc-ro is not one/],
    ["a bind-mounted home", (i) => { const m = i[0].Mounts.find((x) => x.Destination === "/home/kukulu"); m.Type = "bind"; delete m.Name; }, /boundary: mount \/home\/kukulu is a bind mount/],
    ["a same-path mount with another source", (i) => { i[0].Mounts.find((m) => m.Destination.endsWith("/docs/SPEC.md")).Source = "/tmp/other-spec.md"; }, /boundary: mount .*\/docs\/SPEC\.md has source/],
  ]) {
    const b = boundaryRepo();
    b.put(b.inspect);
    await live(b.repo, envFor(b.dockerDir), async ({ call }) => {
      await call("kukulu_next");
      mutate(b.inspect);
      b.put(b.inspect);
      const h = await call("kukulu_next");
      eq(h.stage, "halt", `gate check 9 halts on ${label}`);
      like(h.reason, new RegExp(`^clean-room gate failed: ${want.source}`), "...with the boundary reason");
      eq(logOf(b.repo).filter((e) => e.kind === "gate").at(-1).data.failed, "boundary", "...and the failing gate entry is in the chain");
    });
  }

  {
    const b = boundaryRepo();
    b.put(b.inspect);
    await live(b.repo, envFor(b.dockerDir, { KUKULU_SANDBOX: "" }), async ({ call }) => {
      isError(await call("kukulu_next"), /^clean-room genesis refused: boundary: this flight's policy requires enforcement container\+proxy, but this server is not behind a K\u016bkulu sandbox; start the session with node scripts\/sandbox\.mjs run$/, "genesis refuses without KUKULU_SANDBOX");
    });
  }

  {
    const b = boundaryRepo();
    b.put(b.inspect);
    await live(b.repo, envFor(b.dockerDir), async ({ call }) => {
      await call("kukulu_next");
      const log = path.join(b.repo, ".kukulu", "cleanroom", "log.jsonl");
      appendEntry(log, { kind: "egress", stage: "controller", role: "session", tool: null, target: "pypi.org:443", decision: "allowed", reason: "sandbox.egress", data: { bytesUp: 1, bytesDown: 1, ms: 1 } });
      appendEntry(log, { kind: "egress", stage: "controller", role: "session", tool: null, target: "api.anthropic.com:443", decision: "allowed", reason: "runner endpoint anthropic", data: { bytesUp: 1, bytesDown: 1, ms: 1 } });
      appendEntry(log, { kind: "egress", stage: "controller", role: "session", tool: null, target: "example.org:443", decision: "denied", reason: "not allowed by this flight's policy" });
      ok((await call("kukulu_next")).gate.ok, "allowed egress to a named host and a denied entry pass the audit");
      appendEntry(log, { kind: "egress", stage: "controller", role: "session", tool: null, target: "evil.example:443", decision: "allowed", reason: "x", data: { bytesUp: 1, bytesDown: 1, ms: 1 } });
      const seq = readEntries(log).at(-1).seq;
      const h = await call("kukulu_next");
      eq(h.stage, "halt", "an allowed egress entry for a host the policy does not name halts");
      eq(h.reason, `clean-room gate failed: boundary: egress entry ${seq} allowed evil.example:443, which no runner endpoint, sandbox.egress or allow.urls entry names`, "...naming the seq and the host");
    });
  }

  {
    const dir = mkFakeDocker();
    const hookRepo = cleanroomRepo();
    await live(hookRepo, envFor(dir), async ({ call }) => {
      const n = await call("kukulu_next");
      eq(n.gate.checked.at(-1), "routing", "under hook enforcement there is no boundary check");
      const g = logOf(hookRepo)[0];
      eq(g.data.enforcement + "|" + ("boundary" in g.data), "hook|false", "...and genesis records enforcement hook and no boundary");
    });
  }
}

// ---------------------------------------------------------------- commands run inside the boundary (P2-08)

{
  const inside = (dockerDir, extra = {}) => ({ env: { PATH: `${dockerDir}:${process.env.PATH}`, KUKULU_SANDBOX: "kukulu-x", KUKULU_SANDBOX_ENGINE: "docker", KUKULU_SANDBOX_HOOKS_PATH: mkDir("kukulu-hooks-empty-"), ...extra } });
  const callsOf = (dir) => (fs.existsSync(path.join(dir, "calls.log")) ? fs.readFileSync(path.join(dir, "calls.log"), "utf8") : null);

  {
    const repo = plannedRepo({ config: { verify: ["echo ok"] } });
    const dockerDir = mkFakeDocker();
    await withServer(repo, async ({ call }) => {
      const v = await call("kukulu_verify");
      const run = v.results.find((r) => r.command === "echo ok");
      eq(run.ok, true, "kukulu_verify reports the command ok");
      eq(callsOf(dockerDir).trimEnd(), `exec -w ${repo} kukulu-x timeout -k 5 600 sh -c echo ok`, "kukulu_verify runs each command through docker exec with the wrapper");
      eq(run.command + "|" + run.stdoutTail, "echo ok|ok", "...and the result keeps the command as written");
    }, inside(dockerDir));
  }

  {
    const repo = plannedRepo({ config: { verify: ["echo ok"] } });
    writeFile(repo, "src/add.mjs", "export const add = (a, b) => a + b;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "add the source"]);
    const dockerDir = mkFakeDocker();
    await withServer(repo, async ({ call }) => {
      const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" });
      ok(!r.error, "kukulu_mutate runs" + (r.error ? ": " + r.error : ""));
      like(callsOf(dockerDir), /^exec -w .* kukulu-x timeout -k 5 600 sh -c echo ok$/m, "kukulu_mutate runs inside too");
      eq(readFile(repo, "src/add.mjs"), "export const add = (a, b) => a + b;\n", "...and still restores the file");
    }, inside(dockerDir));
  }

  {
    const commitHook = '#!/bin/sh\nif head -1 "$1" | grep -q "^plan:"; then echo "hook says no" >&2; exit 1; fi\nexit 0\n';
    const hooked = () => {
      const repo = plannedRepo();
      // Un-commit the plan so that kukulu_plan_commit has something to commit.
      git(repo, ["reset", "-q", "HEAD~1"]);
      writeFile(repo, ".git/hooks/commit-msg", commitHook);
      fs.chmodSync(path.join(repo, ".git", "hooks", "commit-msg"), 0o755);
      return repo;
    };
    const dockerDir = mkFakeDocker();
    const sandboxed = hooked();
    await withServer(sandboxed, async ({ call }) => {
      const r = await call("kukulu_plan_commit");
      ok(!r.error && r.commit, "a commit ignores the repository's hooks inside the sandbox" + (r.error ? ": " + r.error : ""));
    }, inside(dockerDir));
    const outside = hooked();
    await withServer(outside, async ({ call }) => {
      isError(await call("kukulu_plan_commit"), /hook says no/, "...and the same hook refuses the commit without KUKULU_SANDBOX");
    });
  }

  {
    // a repository-local fsmonitor is a program git would run on the host (SPEC C-04)
    const withMonitor = () => {
      const repo = plannedRepo();
      git(repo, ["reset", "-q", "HEAD~1"]);
      const marker = path.join(mkDir("kukulu-fsmonitor-"), "ran");
      const script = path.join(path.dirname(marker), "monitor.sh");
      fs.writeFileSync(script, `#!/bin/sh\ntouch ${marker}\nexit 1\n`, { mode: 0o755 });
      git(repo, ["config", "core.fsmonitor", script]);
      return { repo, marker };
    };
    const dockerDir = mkFakeDocker();
    const inner = withMonitor();
    await withServer(inner.repo, async ({ call }) => {
      const r = await call("kukulu_plan_commit");
      ok(!r.error && r.commit, "a commit inside the sandbox turns the repository's fsmonitor off" + (r.error ? ": " + r.error : ""));
    }, inside(dockerDir));
    ok(!fs.existsSync(inner.marker), "...so the fsmonitor script never ran");
    const outer = withMonitor();
    await withServer(outer.repo, async ({ call }) => {
      await call("kukulu_plan_commit");
    });
    ok(fs.existsSync(outer.marker), "...while without KUKULU_SANDBOX the same script runs");
  }

  {
    const repo = plannedRepo();
    const dockerDir = mkFakeDocker();
    await withServer(repo, async ({ call }) => {
      isError(await call("kukulu_run_start", { stream: "api" }), /^parallel streams are not supported inside the sandbox \(\.kukulu\/ is read-only there\); run a serial plan, or set parallel\.maxStreams to 1$/, "a stream run start refuses inside the sandbox");
      ok(!fs.existsSync(path.join(repo, ".kukulu", "implement.lock")), "...before any write");
    }, inside(dockerDir));
  }

  {
    const repo = plannedRepo({ config: { verify: ["echo ok"] } });
    const dockerDir = mkFakeDocker();
    await withServer(repo, async ({ call }) => {
      const v = await call("kukulu_verify");
      eq(v.results.find((r) => r.command === "echo ok").stdoutTail, "ok", "without KUKULU_SANDBOX the verify command runs directly");
      eq(callsOf(dockerDir), null, "...and the engine is never called");
    }, { env: { PATH: `${dockerDir}:${process.env.PATH}` } });
  }
}

// ---------------------------------------------------------------- signing under the boundary (P2-10)

{
  const insideEnv = (dockerDir) => ({ env: { PATH: `${dockerDir}:${process.env.PATH}`, KUKULU_SANDBOX: "kukulu-x", KUKULU_SANDBOX_ENGINE: "docker", KUKULU_SANDBOX_HOOKS_PATH: mkDir("kukulu-hooks-empty-") } });
  const dockerDir = mkFakeDocker();
  const SANDBOX_RECORD = "off (sandbox: commits inside the boundary are unsigned; the signed checkpoints vouch for them)";

  {
    const repo = plannedRepo({ config: { policies: { signing: "required" } } });
    const head = git(repo, ["rev-parse", "HEAD"]);
    const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    await withServer(repo, async ({ call }) => {
      isError(await call("kukulu_run_start"), /^policies\.signing is 'required', but commits made inside the sandbox cannot be signed: the signing agent stays outside the boundary\. Set policies\.signing to 'auto' or 'off'; the signed checkpoints vouch for every commit's head$/, "run_start refuses policies.signing required inside the sandbox");
    }, insideEnv(dockerDir));
    eq(git(repo, ["rev-parse", "HEAD"]) + "|" + git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), `${head}|${branch}`, "...HEAD and the branch unmoved");
    ok(!fs.existsSync(path.join(repo, ".kukulu", "implement.lock")), "...and no lock written");
    await withServer(repo, async ({ call }) => {
      isError(await call("kukulu_run_start"), /^policies\.signing is 'required' but commit\.gpgsign is not set/, "without the sandbox, required takes its usual path");
    });
  }

  {
    const repo = plannedRepo({ config: { policies: { signing: "auto" } } });
    // A working signer: a probe would record "on", so SANDBOX_RECORD shows it was skipped, and the server's own commits sign
    // without the auto fallback writing commit.gpgsign false (a broken signer passed only where the global config signed).
    useFakeSigner(repo, mkFakeGpg());
    await withServer(repo, async ({ call }) => {
      const r = await call("kukulu_run_start");
      ok(!r.error, "run_start works under auto inside the sandbox" + (r.error ? ": " + r.error : ""));
      eq(r.signing, SANDBOX_RECORD, "...recording the sandbox signing outcome");
      eq(r.signingNote, "Commits made inside the sandbox are unsigned: commit with git -c commit.gpgsign=false commit -F <file>; the signed checkpoints vouch for every commit's head, and kukulu_pr_finalize will not wait for signatures.", "...with its note");
      eq(git(repo, ["config", "--local", "--get", "commit.gpgsign"]), "true", "...leaving commit.gpgsign as the operator set it");
    }, insideEnv(dockerDir));
  }

  {
    const repo = plannedRepo({ config: { policies: { signing: "off" } } });
    await withServer(repo, async ({ call }) => {
      const r = await call("kukulu_run_start");
      eq(r.signing, "off", "signing off is unchanged inside the sandbox");
    }, insideEnv(dockerDir));
  }
}

// ---------------------------------------------------------------- the control bundle's verifier behind the sandbox (R1-03)

{
  const FIX = (d) => path.join(ROOT, "test", "fixtures", "similarity", d);
  const leftRepo = mkDir("kukulu-control-left-");
  fs.cpSync(FIX("b"), leftRepo, { recursive: true });
  git(leftRepo, ["init", "-q", "-b", "main"]);
  git(leftRepo, ["config", "user.email", "t@example.com"]);
  git(leftRepo, ["config", "user.name", "T"]);
  git(leftRepo, ["add", "-A"]);
  git(leftRepo, ["commit", "-qm", "control result"]);
  const headSha = git(leftRepo, ["rev-parse", "HEAD"]);
  const marker = path.join(mkDir("kukulu-marker-"), "ran.txt");
  const bundle = buildBundle(path.join(mkDir("kukulu-control-bundle-"), "bundle"), { head: headSha });
  // A clean-room bundle is no positive control, but its planted verifier says it is.
  // The bundle's own verifier is planted to write a marker and claim a pass.
  fs.writeFileSync(path.join(bundle.dir, "verify.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "ran"); console.log(JSON.stringify({ ok: true, reasons: [] }));\n`);
  const similarity = {
    subject: [FIX("a")],
    pairs: [
      { id: "independent", role: "negative", left: FIX("a"), right: FIX("b") },
      { id: "derived", role: "positive", left: leftRepo, right: FIX("b-derived"), control: bundle.dir },
      { id: "vs-c", role: "test", left: "subject", right: FIX("c") },
    ],
    languages: { ".rs": "rust", ".c": "c", ".h": "c" },
  };
  const mk = () => {
    const repo = plannedRepo({ config: { flight: "w1", cleanroom: { similarity } } });
    setState(repo, { implemented: true, reviewed: true, verdict: "APPROVED", summarized: true });
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "chore: approved"]);
    return repo;
  };
  await withServer(mk(), async ({ call }) => {
    isError(await call("kukulu_similarity"), /^the positive pair's control bundle .* does not verify as a positive control: mode: the bundle is clean-room, expected control-positive/, "behind the sandbox a control bundle's own verify.mjs never runs: the plugin's verifier rejects it");
    ok(!fs.existsSync(marker), "...and the planted script left no marker");
  }, { env: { KUKULU_SANDBOX: "kukulu-x", KUKULU_SANDBOX_ENGINE: "docker" } });
  await withServer(mk(), async ({ call }) => {
    const r = await call("kukulu_similarity");
    ok(!r.error && fs.existsSync(marker), "without the sandbox the bundle's own script runs, as SPEC B-02 says");
  });
}

// ---------------------------------------------------------------- gate check 10 in the sandbox's cargo cache (P2-11)

{
  const zero = "sha256:" + "0".repeat(64);
  const policy = JSON.stringify({ version: 1, enforcement: "container+proxy", sandbox: { image: `kukulu-sandbox@${zero}`, mounts: [{ path: "tools/oracle", mode: "ro" }] }, deny: { packages: { cargo: ["flate2", "libz_sys"] } } });
  const name = "kukulu-0123456789abcdef";
  const runCase = async (listing) => {
    const repo = cleanroomRepo({ policy });
    const dockerDir = mkFakeDocker();
    const inspect = JSON.parse(readFile(ROOT, "test/fixtures/docker/inspect.json").replaceAll("__ROOT__", repo).replaceAll("/opt/kukulu", ROOT));
    writeFile(dockerDir, "inspect.json", JSON.stringify(inspect));
    if (listing !== null) writeFile(dockerDir, "exec-output", listing);
    let out;
    await withServer(repo, async (s) => {
      logCall(repo);
      out = await s.call("kukulu_next");
      out.calls = fs.readFileSync(path.join(dockerDir, "calls.log"), "utf8");
    }, { env: { PATH: `${dockerDir}:${process.env.PATH}`, KUKULU_SANDBOX: name, KUKULU_SANDBOX_ENGINE: "docker", KUKULU_SANDBOX_HOOKS_PATH: "/run/user/1000/kukulu/0123456789abcdef/hooks-empty" } });
    return out;
  };
  const cache = "/home/kukulu/.cargo/registry/src/index.crates.io-6f17d22bba15001f";
  const bad = await runCase(`${cache}/serde-1.0.200\n${cache}/flate2-1.0.30\n`);
  eq(bad.stage, "halt", "gate check 10 fails on a denied crate directory in the sandbox cache");
  eq(bad.reason, `clean-room gate failed: packages: the sandbox's cargo cache holds ${cache}/flate2-1.0.30`, "...naming the directory");
  like(bad.calls, /^exec kukulu-0123456789abcdef find \/home\/kukulu\/\.cargo\/registry\/src -mindepth 2 -maxdepth 2 -type d$/m, "...by asking the container to list the registry sources");
  const prerelease = await runCase(`${cache}/flate2-1.0.0-rc.1\n`);
  eq(prerelease.reason, `clean-room gate failed: packages: the sandbox's cargo cache holds ${cache}/flate2-1.0.0-rc.1`, "gate check 10 fails on a denied crate at a pre-release version in the sandbox cache");
  const spelled = await runCase(`${cache}/libz-sys-1.1.8\n`);
  like(spelled.reason ?? "", /the sandbox's cargo cache holds .*libz-sys-1\.1\.8/, "cargo names compare with - and _ equal in the cache too");
  const clean = await runCase(`${cache}/serde-1.0.200\n${cache}/flate2x-1.0.0\n`);
  eq(clean.stage, "plan", "a cache without a denied crate passes");
  eq(clean.gate.checked.slice(-2).join(","), "boundary,packages", "...and packages comes after boundary");
  const empty = await runCase("");
  eq(empty.stage, "plan", "an empty cache listing passes");
}

// ---------------------------------------------------------------- the real-container integration step (P2-14)

// Only with KUKULU_SANDBOX_IT=1 and docker on PATH: everything above runs with a fake engine.
const SKIP_LINE = "sandbox integration: skipped (set KUKULU_SANDBOX_IT=1 with docker on PATH)";
const dockerVersion = spawnSync("docker", ["--version"], { encoding: "utf8" });
if (process.env.KUKULU_SANDBOX_IT === "1" && dockerVersion.status === 0) {
  const context = mkDir("kukulu-it-context-");
  fs.copyFileSync(path.join(ROOT, "test", "fixtures", "docker", "Containerfile.it"), path.join(context, "Containerfile"));
  const build = spawnSync("docker", ["build", "-t", "kukulu-sandbox-it", "--build-arg", `KUKULU_UID=${process.getuid()}`, "-f", path.join(context, "Containerfile"), context], { encoding: "utf8" });
  ok(build.status === 0, "the integration image builds" + (build.status === 0 ? "" : `: ${(build.stderr || "").trim().split("\n").slice(-3).join(" | ")}`));
  if (build.status === 0) {
    try {
      const id = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", "kukulu-sandbox-it"], { encoding: "utf8" }).stdout.trim();
      const repo = cleanroomRepo({ policy: JSON.stringify({ version: 1, enforcement: "container+proxy", sandbox: { image: `kukulu-sandbox-it@${id}` } }) });
      const script = [
        "curl -sS --max-time 10 https://example.com >/dev/null 2>&1 || echo NET_FAIL >> it-markers.txt",
        "(echo x > .kukulu/x) 2>/dev/null || echo KUKULU_WRITE_FAIL >> it-markers.txt",
        "echo hi > it-file.txt && echo PROJECT_OK >> it-markers.txt",
        "(touch /run/kukulu/x) 2>/dev/null || echo RUNTIME_WRITE_FAIL >> it-markers.txt",
        "node -e \"require('net').connect('/run/kukulu/log.sock').on('connect',()=>{console.log('SOCKET_OK');process.exit(0)}).on('error',()=>process.exit(1))\" >/dev/null 2>&1 && echo SOCKET_OK >> it-markers.txt",
      ].join("; ");
      const err = [];
      const code = await sandboxMain(["run", "--", "--exec", "sh", "-c", script], {
        platform: "linux",
        cwd: repo,
        env: { ...process.env, XDG_RUNTIME_DIR: shortDir(), KUKULU_CONFIG: path.join(repo, ".kukulu-test-no-global.json"), KUKULU_PROFILE: "" },
        stdout: { write: () => {} },
        stderr: { write: (t) => err.push(t) },
      });
      eq(code, 0, "the sandboxed command exits 0" + (code === 0 ? "" : `: ${err.join("")}`));
      const markers = fs.existsSync(path.join(repo, "it-markers.txt")) ? fs.readFileSync(path.join(repo, "it-markers.txt"), "utf8") : "";
      ok(/^NET_FAIL$/m.test(markers) && /^KUKULU_WRITE_FAIL$/m.test(markers) && /^PROJECT_OK$/m.test(markers) && /^RUNTIME_WRITE_FAIL$/m.test(markers) && /^SOCKET_OK$/m.test(markers), "inside the container the network, .kukulu writes and project writes behave as the boundary says (" + markers.trim().split("\n").join(",") + ")");
      eq(fs.readFileSync(path.join(repo, "it-file.txt"), "utf8"), "hi\n", "...and the project write is visible outside");
      ok(!fs.existsSync(path.join(repo, ".kukulu", "x")), "...while .kukulu stayed untouched");
    } finally {
      spawnSync("docker", ["rmi", "-f", "kukulu-sandbox-it"], { encoding: "utf8" });
    }
  }
} else {
  console.log(`# ${SKIP_LINE}`);
  ok(true, "the integration step is skipped without KUKULU_SANDBOX_IT");
}

finish();
