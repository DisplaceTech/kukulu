#!/usr/bin/env node
// Kūkulu clean-room logger: the PostToolUse and UserPromptSubmit hook (SPEC
// D-02, D-04, D-09). Like the guard it exits 0 at once, silently, in a project
// with no clean-room policy, before importing anything but node: built-ins.
// It never blocks a call: every path ends in exit 0.

import fs from "node:fs";
import path from "node:path";

const readStdin = () => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const parseInput = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** The policy path docs/kukulu.json names, else the default; an unreadable config means the default. */
function policyFile(root) {
  let rel = "docs/cleanroom.json";
  try {
    const named = JSON.parse(fs.readFileSync(path.join(root, "docs", "kukulu.json"), "utf8"))?.cleanroom?.policy;
    if (typeof named === "string" && named) rel = named;
  } catch {
    // no config, or not JSON: the default applies
  }
  return path.resolve(root, rel);
}

const input = parseInput(readStdin());
const root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
if (!fs.existsSync(policyFile(root))) process.exit(0);

let cr = null;
const UNREACHABLE = "the log socket is unreachable, so this call cannot be logged; restart the session with node scripts/sandbox.mjs run";

// Inside the boundary the log lives outside it: entries go to the log socket (SPEC C-02), and the logger never
// calls appendEntry then. The client is inlined here, never shared with the guard, because gate check 3 pins
// each script by hash. It throws when the socket cannot be reached or the reply is late or an error.
async function sendToSocket(entry, timeoutMs) {
  const net = await import("node:net");
  const reply = await new Promise((resolve) => {
    let buf = "";
    const c = net.createConnection(process.env.KUKULU_LOG_SOCKET);
    const timer = setTimeout(() => { c.destroy(); resolve(null); }, timeoutMs);
    c.once("connect", () => c.write(`${JSON.stringify(entry)}\n`));
    c.on("data", (d) => {
      buf += d;
      if (!buf.includes("\n")) return;
      clearTimeout(timer);
      c.end();
      try { resolve(JSON.parse(buf.split("\n")[0])); } catch { resolve(null); }
    });
    c.once("error", () => { clearTimeout(timer); resolve(null); });
    c.once("close", () => { clearTimeout(timer); resolve(null); });
  });
  if (!reply || reply.error) throw new Error(UNREACHABLE);
}

/** Append an entry to the log, or send it to the log socket when this process runs inside the boundary. */
async function record(logPath, fields) {
  if (process.env.KUKULU_LOG_SOCKET) return sendToSocket(fields, cr.LOG_SOCKET_TIMEOUT_MS);
  return cr.appendEntry(logPath, fields);
}

try {
  cr = await import("../mcp/cleanroom.mjs");
  if (!input) throw new Error("the hook input is empty or not a JSON object");
  const logPath = cr.logPathFor(root, process.env);
  const ctx = cr.projectContext(root);
  if (cr.loggingActive(ctx, logPath) && input.hook_event_name === "PostToolUse") {
    await record(logPath, { kind: "allowed", decision: "allowed", reason: null, ...cr.entryFields(input, ctx) });
  }
  if (cr.loggingActive(ctx, logPath) && input.hook_event_name === "UserPromptSubmit") {
    const fields = cr.entryFields(input, ctx);
    await record(logPath, {
      kind: "human",
      role: "operator",
      task: fields.task,
      model: fields.model,
      session: fields.session,
      tool: null,
      decision: null,
      target: cr.truncateTarget(String(input.prompt ?? "")),
    });
  }
  // Any other event is not ours.
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  if (process.env.KUKULU_LOG_SOCKET) {
    // Under the socket the call must not go unlogged: fail closed, with the reason on stderr.
    process.stderr.write(`kukulu clean-room logger: ${message === UNREACHABLE ? UNREACHABLE : `${UNREACHABLE} (${message})`}\n`);
    process.exit(1);
  }
  try {
    if (!cr) throw new Error(message);
    const logPath = cr.logPathFor(root, process.env);
    if (cr.loggingActive(cr.projectContext(root), logPath)) cr.appendEntry(logPath, { kind: "allowed", tool: "unknown", decision: null, reason: `logger-error: ${message}` });
  } catch (inner) {
    process.stderr.write(`kukulu clean-room logger: could not log (${message}); ${inner instanceof Error ? inner.message : String(inner)}\n`);
  }
}
process.exit(0);
