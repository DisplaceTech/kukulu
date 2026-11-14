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
if (!fs.existsSync(policyFile(root))) {
  // General mode (SPEC B-02): a role agent's usage goes to .kukulu/metrics/usage.jsonl. Every other event, and every
  // project that is not a Kūkulu project, leaves here at once; the log socket means a sandbox, where the controller owns the files.
  try {
    if ((input?.hook_event_name === "SubagentStop" || input?.hook_event_name === "Stop") && fs.existsSync(path.join(root, "docs", "kukulu.json")) && !process.env.KUKULU_LOG_SOCKET) {
      const record = usageFromClaudeCode(input);
      if (record.role !== null) {
        const dir = path.join(root, ".kukulu", "metrics");
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, "usage.jsonl"), `${JSON.stringify(record)}\n`);
      }
    }
  } catch {
    // the hook never blocks anything
  }
  process.exit(0);
}

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

/** Stage and round from `.kukulu/state.json`, as the usage record wants them: null when the file cannot say. */
function stageAndRound() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, ".kukulu", "state.json"), "utf8"));
    const round = Number.isInteger(st?.round) ? st.round : null;
    const spans = Array.isArray(st?.timeline) ? st.timeline.filter((r) => r && (r.event === "start" || r.event === "end")) : [];
    const last = spans.at(-1);
    return { stage: last?.event === "start" && typeof last.stage === "string" ? last.stage : null, round };
  } catch {
    return { stage: null, round: null };
  }
}

/**
 * The usage record of one agent (docs/metrics.md), from its Claude Code transcript. This is the only place that
 * knows the transcript format. Each request counts once (the first line of a repeated requestId); an unreadable
 * transcript is the six-key error record, never a failure.
 */
function usageFromClaudeCode(hookInput) {
  // A Stop is the controller session's own: its role is fixed, it has no agent type, and the subagents' sidechain rows
  // in its transcript are dropped below so its record never holds their requests.
  const controller = hookInput.hook_event_name === "Stop";
  const type = !controller && typeof hookInput.agent_type === "string" ? hookInput.agent_type : null;
  const head = {
    v: 1,
    harness: "claude-code",
    session: typeof hookInput.session_id === "string" && hookInput.session_id ? hookInput.session_id : null,
    agent: type && type.length ? type : null,
    role: controller ? "controller" : (type?.match(/^kukulu[-:](planner|implementer|reviewer|summarizer)$/)?.[1] ?? null),
  };
  const file = controller ? hookInput.transcript_path : hookInput.agent_transcript_path || hookInput.transcript_path;
  try {
    const rows = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row && typeof row === "object" && !Array.isArray(row) && !(controller && row.isSidechain === true)) rows.push(row);
      } catch {
        continue;
      }
    }
    const n = (v) => (typeof v === "number" ? v : 0);
    const time = (row) => Date.parse(row.timestamp);
    const conv = rows.filter((r) => (r.type === "user" || r.type === "assistant") && typeof r.timestamp === "string" && !Number.isNaN(time(r)));
    const seen = new Set();
    const models = {};
    const stamps = [];
    let cost = 0;
    let costed = true;
    let counted = 0;
    let active = 0;
    let timed = false;
    for (const row of rows) {
      const usage = row.message?.usage;
      if (row.type !== "assistant" || !usage || typeof usage !== "object") continue;
      if (typeof row.requestId === "string") {
        if (seen.has(row.requestId)) continue;
        seen.add(row.requestId);
      }
      const m = (models[row.message.model ?? "unknown"] ??= { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      m.requests += 1;
      m.input += n(usage.input_tokens);
      m.output += n(usage.output_tokens);
      m.cacheRead += n(usage.cache_read_input_tokens);
      m.cacheWrite += n(usage.cache_creation_input_tokens);
      if (typeof row.timestamp === "string") stamps.push(row.timestamp);
      if (typeof row.costUSD === "number") cost += row.costUSD;
      else costed = false;
      counted += 1;
      const at = conv.indexOf(row);
      if (at > 0) {
        let lastRow = row;
        if (typeof row.requestId === "string") for (const r of conv) if (r.requestId === row.requestId) lastRow = r;
        active += Math.max(0, time(lastRow) - time(conv[at - 1]));
        timed = true;
      }
    }
    if (!counted) throw new Error("the transcript has no assistant line with usage");
    const items = (row) => (Array.isArray(row.message?.content) ? row.message.content : []);
    stamps.sort();
    return {
      ...head,
      ...stageAndRound(),
      models,
      first: stamps[0] ?? null,
      last: stamps.at(-1) ?? null,
      activeMs: timed ? Math.round(active) : null,
      toolCalls: rows.reduce((t, r) => t + items(r).filter((i) => i?.type === "tool_use").length, 0),
      toolErrors: rows.reduce((t, r) => t + items(r).filter((i) => i?.type === "tool_result" && i.is_error === true).length, 0),
      apiErrors: rows.filter((r) => r.isApiErrorMessage === true).length,
      cost: costed ? Math.round(cost * 1e6) / 1e6 : null,
    };
  } catch (e) {
    return { ...head, error: String(e instanceof Error ? e.message : e).split("\n")[0] };
  }
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
  if (cr.loggingActive(ctx, logPath) && input.hook_event_name === "SubagentStop") {
    await record(logPath, { kind: "usage", ...cr.entryFields(input, ctx), tool: null, decision: null, target: null, data: usageFromClaudeCode(input) });
  }
  if (cr.loggingActive(ctx, logPath) && input.hook_event_name === "Stop") {
    // The controller's cumulative record; its entry role is "session", so no per-role recount counts it.
    await record(logPath, { kind: "usage", ...cr.entryFields(input, ctx), tool: null, decision: null, target: null, data: usageFromClaudeCode(input) });
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
