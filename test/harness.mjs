// Shared test harness: temp git repos, an MCP client over stdio, TAP-ish
// assertions. Every suite in test/ is a standalone Node program that imports
// this, asserts, and calls finish(); test/run.mjs runs them all as children so
// one suite's crash can't take the rest down.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const SERVER = path.join(ROOT, "mcp", "server.mjs");
export const GUARD = path.join(ROOT, "scripts", "implement-guard.sh");

const KEEP = Boolean(process.env.KEEP_REPO);
const RPC_TIMEOUT_MS = Number(process.env.FOUNDRY_TEST_TIMEOUT_MS || 60_000);

// ---------------------------------------------------------------- assertions

let count = 0;
const failures = [];

export function ok(cond, msg) {
  count++;
  if (cond) {
    console.log(`ok ${count} - ${msg}`);
  } else {
    failures.push(msg);
    console.log(`not ok ${count} - ${msg}`);
  }
  return Boolean(cond);
}

export function eq(actual, expected, msg) {
  const good = Object.is(actual, expected);
  ok(good, msg);
  if (!good) console.log(`  #   expected: ${JSON.stringify(expected)}\n  #   actual:   ${JSON.stringify(actual)}`);
  return good;
}

export function like(actual, re, msg) {
  const s = typeof actual === "string" ? actual : JSON.stringify(actual);
  const good = re.test(s);
  ok(good, msg);
  if (!good) console.log(`  #   expected match: ${re}\n  #   actual:         ${JSON.stringify(s)}`);
  return good;
}

/** Assert a tool call came back as an error, and that its message matches. */
export function isError(res, re, msg) {
  const good = Boolean(res && res.error) && re.test(res.error);
  ok(good, msg);
  if (!good) console.log(`  #   expected error matching ${re}\n  #   got: ${JSON.stringify(res)}`);
  return good;
}

/** Print the plan line and exit non-zero if anything failed. */
export function finish() {
  console.log(`1..${count}`);
  if (failures.length) {
    console.log(`# FAILED ${failures.length}/${count}`);
    for (const f of failures) console.log(`#   - ${f}`);
  } else {
    console.log(`# passed ${count}/${count}`);
  }
  process.exit(failures.length ? 1 : 0);
}

// ---------------------------------------------------------------- temp repos

const madeRepos = [];
process.on("exit", () => {
  if (KEEP) return;
  for (const d of madeRepos) fs.rmSync(d, { recursive: true, force: true });
});

const gitIn = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** A throwaway git repo with an identity configured and one empty commit. */
export function mkRepo(prefix = "foundry-test-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  madeRepos.push(dir);
  gitIn(dir, ["init", "-q", "-b", "main"]);
  gitIn(dir, ["config", "user.email", "test@foundry.invalid"]);
  gitIn(dir, ["config", "user.name", "foundry test"]);
  gitIn(dir, ["config", "commit.gpgsign", "false"]);
  gitIn(dir, ["commit", "-q", "--allow-empty", "-m", "init"]);
  if (KEEP) console.log(`# repo: ${dir}`);
  return dir;
}

/** A throwaway directory that is deliberately *not* a git repo. */
export function mkDir(prefix = "foundry-plain-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  madeRepos.push(dir);
  return dir;
}

/** A bare repo usable as an `origin` for push tests. */
export function mkBareRemote() {
  const dir = mkDir("foundry-remote-");
  execFileSync("git", ["init", "-q", "--bare", dir], { encoding: "utf8" });
  return dir;
}

/**
 * A directory holding a `gh` stub that always fails, so run_finish's optional
 * pull-request path stays local and deterministic. Prepend it to PATH.
 */
export function mkFailingGhBin() {
  const dir = mkDir("foundry-bin-");
  const gh = path.join(dir, "gh");
  fs.writeFileSync(gh, "#!/bin/sh\nexit 1\n");
  fs.chmodSync(gh, 0o755);
  return dir;
}

export const sh = (dir, cmd) => execFileSync("/bin/sh", ["-c", cmd], { cwd: dir, encoding: "utf8" }).trim();
export const git = gitIn;
export const readFile = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
export const writeFile = (dir, rel, body) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
export const hasFile = (dir, rel) => fs.existsSync(path.join(dir, rel));
export const subject = (dir) => gitIn(dir, ["log", "-1", "--format=%s"]);

// ---------------------------------------------------------------- fixtures

/** One PLAN.md task block in the exact shape the server's parser expects. */
export function planTask(t) {
  return [
    `### ${t.id}: ${t.title}`,
    `**Goal:** ${t.goal || t.title}`,
    `**Files touched:** ${t.files || "src/x"}`,
    `**Design constraints:** ${t.constraints || "none"}`,
    `**Acceptance tests:** ${t.tests || "none"}`,
    `**Out of scope:** ${t.outOfScope || "none"}`,
    `**Verification:** ${t.verification || "none"}`,
    `**Depends on:** ${t.depends && t.depends.length ? t.depends.join(", ") : "none"}`,
    "",
  ].join("\n");
}

export const DEFAULT_TASKS = [
  { id: "P0-01", title: "Create hello", goal: "write hello.txt", files: "hello.txt", tests: "test.sh", verification: "./test.sh" },
  { id: "P0-02", title: "Impossible task", goal: "fail", files: "nope.txt", depends: ["P0-01"] },
  { id: "P0-03", title: "Depends on the impossible one", goal: "skip me", files: "x", depends: ["P0-02"] },
];

export function planDoc(tasks) {
  return [
    "# Test build plan",
    "Derived from docs/SPEC.md v0.1.",
    "",
    "## Decisions",
    "- none",
    "",
    "## Phase 0 — Scaffold",
    "",
    ...tasks.map(planTask),
  ].join("\n");
}

export function progressDoc(tasks) {
  return [
    "# Test build progress",
    "Branch: (set by implement)",
    "Started: (set by implement)",
    "",
    "## Tasks",
    ...tasks.map((t) => `- [${t.state || " "}] ${t.id} ${t.title}`),
    "",
    "## Log",
    "(one entry per task, appended by implement)",
    "",
  ].join("\n");
}

/** A repo with only docs/SPEC.md committed — the state the planner starts in. */
export function specRepo(spec = "# Spec\n") {
  const repo = mkRepo();
  writeFile(repo, "docs/SPEC.md", spec);
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-qm", "spec"]);
  return repo;
}

/** A repo with the planner's four deliverables committed on `main`. */
export function plannedRepo({ tasks = DEFAULT_TASKS, config = {}, claude = "# rules\n" } = {}) {
  const repo = specRepo();
  writeFile(repo, "docs/PLAN.md", planDoc(tasks));
  writeFile(repo, "docs/PROGRESS.md", progressDoc(tasks));
  writeFile(repo, "docs/foundry.json", JSON.stringify({ verify: ["true"], maxRounds: 3, ...config }, null, 2) + "\n");
  writeFile(repo, "CLAUDE.md", claude);
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-qm", "plan: derive build plan from SPEC"]);
  return repo;
}

/** Force `.foundry/state.json` into a given shape, bypassing the tools. */
export function setState(repo, patch) {
  const p = path.join(repo, ".foundry", "state.json");
  const cur = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2) + "\n");
}

/** Rewrite PROGRESS.md checkboxes directly: `{ "P0-01": "x" }`. */
export function markTasks(repo, states) {
  const p = path.join(repo, "docs", "PROGRESS.md");
  const out = fs.readFileSync(p, "utf8").split("\n").map((line) => {
    const m = line.match(/^- \[.\] ([PR]\d+-\d+)(.*)$/);
    return m && states[m[1]] ? `- [${states[m[1]]}] ${m[1]}${m[2]}` : line;
  });
  fs.writeFileSync(p, out.join("\n"));
}

/** Commit a task's work the way the implementer is told to: `<ID>: <title>`. */
export function commitTask(repo, id, title, files = {}) {
  const paths = Object.keys(files);
  for (const [rel, body] of Object.entries(files)) writeFile(repo, rel, body);
  // Stage only the task's own files, the way the implement skill requires:
  // docs/PROGRESS.md belongs to the MCP, never to a task commit.
  gitIn(repo, ["add", "--", ...paths]);
  gitIn(repo, ["commit", "-qm", `${id}: ${title}`, "--", ...paths]);
  return gitIn(repo, ["rev-parse", "--short", "HEAD"]);
}

// ---------------------------------------------------------------- MCP client

/**
 * Spawn the server against `repo` and return a small JSON-RPC client.
 * `messages` records every frame the server emits, so suites can assert that
 * notifications produce no reply.
 */
export function startServer(repo, { env = {}, server = SERVER } = {}) {
  // Isolate every suite from the developer's own machine: point FOUNDRY_CONFIG
  // at a path that does not exist and force FOUNDRY_PROFILE unset, so a real
  // ~/.config/foundry/config.json (or an inherited FOUNDRY_PROFILE) can never
  // leak into a test. A suite that wants to test the global file passes its
  // own FOUNDRY_CONFIG/FOUNDRY_PROFILE via `env` to override these.
  const isolation = {
    FOUNDRY_CONFIG: path.join(repo, ".foundry-test-no-global.json"),
    FOUNDRY_PROFILE: "",
  };
  const proc = spawn(process.execPath, [server], {
    env: { ...process.env, FOUNDRY_PROJECT_DIR: repo, ...isolation, ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  const messages = [];
  let nextId = 1;
  let buf = "";

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        messages.push({ unparseable: line });
        continue;
      }
      messages.push(msg);
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        waiter(msg);
      }
    }
  });

  const send = (obj) => proc.stdin.write(JSON.stringify(obj) + "\n");

  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`rpc timeout after ${RPC_TIMEOUT_MS}ms: ${method}`));
      }, RPC_TIMEOUT_MS);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  /** Fire-and-forget: no id, so a spec-compliant server must not answer. */
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

  /** Raw bytes, for framing and parse-error tests. */
  const raw = (text) => proc.stdin.write(text);

  /** Call a tool; returns the parsed JSON result, or `{ error: <text> }`. */
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r.error) return { error: r.error.message };
    const text = r.result.content[0].text;
    if (r.result.isError) return { error: text };
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };

  const stop = () =>
    new Promise((resolve) => {
      proc.once("exit", resolve);
      proc.stdin.end();
      setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 2000).unref();
    });

  const settle = () => new Promise((r) => setTimeout(r, 50));

  return { proc, rpc, notify, raw, call, stop, messages, settle };
}

/** Spawn a server, hand it to `fn`, and always shut it down afterwards. */
export async function withServer(repo, fn, opts) {
  const s = startServer(repo, opts);
  try {
    await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "harness", version: "0" } });
    return await fn(s);
  } finally {
    await s.stop();
  }
}

// ---------------------------------------------------------------- frontmatter

/** Minimal YAML frontmatter reader: scalars and `- ` lists, which is all we use. */
export function frontmatter(body) {
  const m = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      (out[key] = Array.isArray(out[key]) ? out[key] : []).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const value = kv[2].trim().replace(/^["'](.*)["']$/, "$1");
    out[key] = value === "" ? [] : value === "true" ? true : value === "false" ? false : value;
  }
  return out;
}

/** Split a file's text into its parsed frontmatter and the body that follows. */
export function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: frontmatter(text), body: m[2] };
}

/** Write a Foundry global routing-config fixture; returns its path. */
export function writeGlobalConfig(dir, obj) {
  return writeFile(dir, "foundry-global.json", JSON.stringify(obj, null, 2) + "\n");
}

// ---------------------------------------------------------------- guard hook

/** Run the Stop-hook script against `repo`; returns its stdout, trimmed. */
export function runGuard(repo, env = {}) {
  return execFileSync("/bin/bash", [GUARD], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
  }).trim();
}
