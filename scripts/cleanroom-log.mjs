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
try {
  cr = await import("../mcp/cleanroom.mjs");
  if (!input) throw new Error("the hook input is empty or not a JSON object");
  const logPath = cr.logPathFor(root, process.env);
  const ctx = cr.projectContext(root);
  if (cr.loggingActive(ctx, logPath) && input.hook_event_name === "PostToolUse") {
    cr.appendEntry(logPath, { kind: "allowed", decision: "allowed", reason: null, ...cr.entryFields(input, ctx) });
  }
  // UserPromptSubmit is logged by a later task; any other event is not ours.
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  try {
    if (!cr) throw new Error(message);
    const logPath = cr.logPathFor(root, process.env);
    if (cr.loggingActive(cr.projectContext(root), logPath)) cr.appendEntry(logPath, { kind: "allowed", tool: "unknown", decision: null, reason: `logger-error: ${message}` });
  } catch (inner) {
    process.stderr.write(`kukulu clean-room logger: could not log (${message}); ${inner instanceof Error ? inner.message : String(inner)}\n`);
  }
}
process.exit(0);
