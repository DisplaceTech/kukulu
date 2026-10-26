// The sandbox (0.8.0): the relay and the controller socket here; the log
// socket, proxy, container launcher and gate checks join them in later tasks.
// Nothing here needs a container engine, a GPU or a second machine.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { finish, ok, eq, like, ROOT, cleanroomRepo, plannedRepo, setState, startServer, withServer, mkFakeDocker, mkDir, writeFile } from "./harness.mjs";
import net from "node:net";
import { startControllerSocket, startLogSocket, startProxy, egressDecision, hostPortOf, planFor, containerArgs, projectIdFor, runtimeDirFor, main as sandboxMain } from "../scripts/sandbox.mjs";
import { startBridge } from "../scripts/sandbox-entry.mjs";
import { createHash } from "node:crypto";
import { readEntries, verifyChain, loadPolicy, lockdownActive } from "../mcp/cleanroom.mjs";

// A Unix socket path is limited to about 100 bytes on macOS, so sockets live under a short temp directory.
/** The host:port a URL names, as the sandbox derives a runner endpoint. */
const hostPortFor = (url) => { const { host, port } = hostPortOf(url); return `${host}:${port}`; };
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
}

// ---------------------------------------------------------------- containerArgs, the plan, the Containerfile and doctor (P2-05)

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
    "-v", "/run/user/1000/kukulu/abc:/run/kukulu", "-v", "kukulu-abc-home:/home/kukulu",
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

finish();
